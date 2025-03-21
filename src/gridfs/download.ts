import { Readable } from 'stream';
import {
  MongoRuntimeError,
  MongoGridFSChunkError,
  MongoGridFSStreamError,
  MongoInvalidArgumentError
} from '../error';
import type { Document } from '../bson';
import type { FindOptions } from '../operations/find';
import type { Sort } from '../sort';
import type { Callback } from '../utils';
import type { Collection } from '../collection';
import type { ReadPreference } from '../read_preference';
import type { GridFSChunk } from './upload';
import type { FindCursor } from '../cursor/find_cursor';
import type { ObjectId } from 'bson';

/** @public */
export interface GridFSBucketReadStreamOptions {
  sort?: Sort;
  skip?: number;
  /** 0-based offset in bytes to start streaming from */
  start?: number;
  /** 0-based offset in bytes to stop streaming before */
  end?: number;
}

/** @public */
export interface GridFSBucketReadStreamOptionsWithRevision extends GridFSBucketReadStreamOptions {
  /** The revision number relative to the oldest file with the given filename. 0
   * gets you the oldest file, 1 gets you the 2nd oldest, -1 gets you the
   * newest. */
  revision?: number;
}

/** @public */
export interface GridFSFile {
  _id: ObjectId;
  length: number;
  chunkSize: number;
  filename: string;
  contentType?: string;
  aliases?: string[];
  metadata?: Document;
  uploadDate: Date;
}

/** @internal */
export interface GridFSBucketReadStreamPrivate {
  bytesRead: number;
  bytesToTrim: number;
  bytesToSkip: number;
  chunks: Collection<GridFSChunk>;
  cursor?: FindCursor<GridFSChunk>;
  expected: number;
  files: Collection<GridFSFile>;
  filter: Document;
  init: boolean;
  expectedEnd: number;
  file?: GridFSFile;
  options: {
    sort?: Sort;
    skip?: number;
    start: number;
    end: number;
  };
  readPreference?: ReadPreference;
}

/**
 * A readable stream that enables you to read buffers from GridFS.
 *
 * Do not instantiate this class directly. Use `openDownloadStream()` instead.
 * @public
 */
export class GridFSBucketReadStream extends Readable {
  /** @internal */
  s: GridFSBucketReadStreamPrivate;

  /**
   * An error occurred
   * @event
   */
  static readonly ERROR = 'error' as const;
  /**
   * Fires when the stream loaded the file document corresponding to the provided id.
   * @event
   */
  static readonly FILE = 'file' as const;
  /**
   * Emitted when a chunk of data is available to be consumed.
   * @event
   */
  static readonly DATA = 'data' as const;
  /**
   * Fired when the stream is exhausted (no more data events).
   * @event
   */
  static readonly END = 'end' as const;
  /**
   * Fired when the stream is exhausted and the underlying cursor is killed
   * @event
   */
  static readonly CLOSE = 'close' as const;

  /** @internal
   * @param chunks - Handle for chunks collection
   * @param files - Handle for files collection
   * @param readPreference - The read preference to use
   * @param filter - The filter to use to find the file document
   */
  constructor(
    chunks: Collection<GridFSChunk>,
    files: Collection<GridFSFile>,
    readPreference: ReadPreference | undefined,
    filter: Document,
    options?: GridFSBucketReadStreamOptions
  ) {
    super();
    this.s = {
      bytesToTrim: 0,
      bytesToSkip: 0,
      bytesRead: 0,
      chunks,
      expected: 0,
      files,
      filter,
      init: false,
      expectedEnd: 0,
      options: {
        start: 0,
        end: 0,
        ...options
      },
      readPreference
    };
  }

  /**
   * Reads from the cursor and pushes to the stream.
   * Private Impl, do not call directly
   * @internal
   */
  _read(): void {
    if (this.destroyed) return;
    waitForFile(this, () => doRead(this));
  }

  /**
   * Sets the 0-based offset in bytes to start streaming from. Throws
   * an error if this stream has entered flowing mode
   * (e.g. if you've already called `on('data')`)
   *
   * @param start - 0-based offset in bytes to start streaming from
   */
  start(start = 0): this {
    throwIfInitialized(this);
    this.s.options.start = start;
    return this;
  }

  /**
   * Sets the 0-based offset in bytes to start streaming from. Throws
   * an error if this stream has entered flowing mode
   * (e.g. if you've already called `on('data')`)
   *
   * @param end - Offset in bytes to stop reading at
   */
  end(end = 0): this {
    throwIfInitialized(this);
    this.s.options.end = end;
    return this;
  }

  /**
   * Marks this stream as aborted (will never push another `data` event)
   * and kills the underlying cursor. Will emit the 'end' event, and then
   * the 'close' event once the cursor is successfully killed.
   *
   * @param callback - called when the cursor is successfully closed or an error occurred.
   */
  abort(callback?: Callback<void>): void {
    this.push(null);
    this.destroyed = true;
    if (this.s.cursor) {
      this.s.cursor.close(error => {
        this.emit(GridFSBucketReadStream.CLOSE);
        callback && callback(error);
      });
    } else {
      if (!this.s.init) {
        // If not initialized, fire close event because we will never
        // get a cursor
        this.emit(GridFSBucketReadStream.CLOSE);
      }
      callback && callback();
    }
  }
}

function throwIfInitialized(stream: GridFSBucketReadStream): void {
  if (stream.s.init) {
    throw new MongoGridFSStreamError('Options cannot be changed after the stream is initialized');
  }
}

function doRead(stream: GridFSBucketReadStream): void {
  if (stream.destroyed) return;
  if (!stream.s.cursor) return;
  if (!stream.s.file) return;

  stream.s.cursor.next((error, doc) => {
    if (stream.destroyed) {
      return;
    }
    if (error) {
      stream.emit(GridFSBucketReadStream.ERROR, error);
      return;
    }
    if (!doc) {
      stream.push(null);

      process.nextTick(() => {
        if (!stream.s.cursor) return;
        stream.s.cursor.close(error => {
          if (error) {
            stream.emit(GridFSBucketReadStream.ERROR, error);
            return;
          }

          stream.emit(GridFSBucketReadStream.CLOSE);
        });
      });

      return;
    }

    if (!stream.s.file) return;

    const bytesRemaining = stream.s.file.length - stream.s.bytesRead;
    const expectedN = stream.s.expected++;
    const expectedLength = Math.min(stream.s.file.chunkSize, bytesRemaining);
    if (doc.n > expectedN) {
      return stream.emit(
        GridFSBucketReadStream.ERROR,
        new MongoGridFSChunkError(
          `ChunkIsMissing: Got unexpected n: ${doc.n}, expected: ${expectedN}`
        )
      );
    }

    if (doc.n < expectedN) {
      return stream.emit(
        GridFSBucketReadStream.ERROR,
        new MongoGridFSChunkError(`ExtraChunk: Got unexpected n: ${doc.n}, expected: ${expectedN}`)
      );
    }

    let buf = Buffer.isBuffer(doc.data) ? doc.data : doc.data.buffer;

    if (buf.byteLength !== expectedLength) {
      if (bytesRemaining <= 0) {
        return stream.emit(
          GridFSBucketReadStream.ERROR,
          new MongoGridFSChunkError(`ExtraChunk: Got unexpected n: ${doc.n}`)
        );
      }

      return stream.emit(
        GridFSBucketReadStream.ERROR,
        new MongoGridFSChunkError(
          `ChunkIsWrongSize: Got unexpected length: ${buf.byteLength}, expected: ${expectedLength}`
        )
      );
    }

    stream.s.bytesRead += buf.byteLength;

    if (buf.byteLength === 0) {
      return stream.push(null);
    }

    let sliceStart = null;
    let sliceEnd = null;

    if (stream.s.bytesToSkip != null) {
      sliceStart = stream.s.bytesToSkip;
      stream.s.bytesToSkip = 0;
    }

    const atEndOfStream = expectedN === stream.s.expectedEnd - 1;
    const bytesLeftToRead = stream.s.options.end - stream.s.bytesToSkip;
    if (atEndOfStream && stream.s.bytesToTrim != null) {
      sliceEnd = stream.s.file.chunkSize - stream.s.bytesToTrim;
    } else if (stream.s.options.end && bytesLeftToRead < doc.data.byteLength) {
      sliceEnd = bytesLeftToRead;
    }

    if (sliceStart != null || sliceEnd != null) {
      buf = buf.slice(sliceStart || 0, sliceEnd || buf.byteLength);
    }

    stream.push(buf);
  });
}

function init(stream: GridFSBucketReadStream): void {
  const findOneOptions: FindOptions = {};
  if (stream.s.readPreference) {
    findOneOptions.readPreference = stream.s.readPreference;
  }
  if (stream.s.options && stream.s.options.sort) {
    findOneOptions.sort = stream.s.options.sort;
  }
  if (stream.s.options && stream.s.options.skip) {
    findOneOptions.skip = stream.s.options.skip;
  }

  stream.s.files.findOne(stream.s.filter, findOneOptions, (error, doc) => {
    if (error) {
      return stream.emit(GridFSBucketReadStream.ERROR, error);
    }

    if (!doc) {
      const identifier = stream.s.filter._id
        ? stream.s.filter._id.toString()
        : stream.s.filter.filename;
      const errmsg = `FileNotFound: file ${identifier} was not found`;
      // TODO(NODE-3483)
      const err = new MongoRuntimeError(errmsg);
      err.code = 'ENOENT'; // TODO: NODE-3338 set property as part of constructor
      return stream.emit(GridFSBucketReadStream.ERROR, err);
    }

    // If document is empty, kill the stream immediately and don't
    // execute any reads
    if (doc.length <= 0) {
      stream.push(null);
      return;
    }

    if (stream.destroyed) {
      // If user destroys the stream before we have a cursor, wait
      // until the query is done to say we're 'closed' because we can't
      // cancel a query.
      stream.emit(GridFSBucketReadStream.CLOSE);
      return;
    }

    try {
      stream.s.bytesToSkip = handleStartOption(stream, doc, stream.s.options);
    } catch (error) {
      return stream.emit(GridFSBucketReadStream.ERROR, error);
    }

    const filter: Document = { files_id: doc._id };

    // Currently (MongoDB 3.4.4) skip function does not support the index,
    // it needs to retrieve all the documents first and then skip them. (CS-25811)
    // As work around we use $gte on the "n" field.
    if (stream.s.options && stream.s.options.start != null) {
      const skip = Math.floor(stream.s.options.start / doc.chunkSize);
      if (skip > 0) {
        filter['n'] = { $gte: skip };
      }
    }
    stream.s.cursor = stream.s.chunks.find(filter).sort({ n: 1 });

    if (stream.s.readPreference) {
      stream.s.cursor.withReadPreference(stream.s.readPreference);
    }

    stream.s.expectedEnd = Math.ceil(doc.length / doc.chunkSize);
    stream.s.file = doc as GridFSFile;

    try {
      stream.s.bytesToTrim = handleEndOption(stream, doc, stream.s.cursor, stream.s.options);
    } catch (error) {
      return stream.emit(GridFSBucketReadStream.ERROR, error);
    }

    stream.emit(GridFSBucketReadStream.FILE, doc);
  });
}

function waitForFile(stream: GridFSBucketReadStream, callback: Callback): void {
  if (stream.s.file) {
    return callback();
  }

  if (!stream.s.init) {
    init(stream);
    stream.s.init = true;
  }

  stream.once('file', () => {
    callback();
  });
}

function handleStartOption(
  stream: GridFSBucketReadStream,
  doc: Document,
  options: GridFSBucketReadStreamOptions
): number {
  if (options && options.start != null) {
    if (options.start > doc.length) {
      throw new MongoInvalidArgumentError(
        `Stream start (${options.start}) must not be more than the length of the file (${doc.length})`
      );
    }
    if (options.start < 0) {
      throw new MongoInvalidArgumentError(`Stream start (${options.start}) must not be negative`);
    }
    if (options.end != null && options.end < options.start) {
      throw new MongoInvalidArgumentError(
        `Stream start (${options.start}) must not be greater than stream end (${options.end})`
      );
    }

    stream.s.bytesRead = Math.floor(options.start / doc.chunkSize) * doc.chunkSize;
    stream.s.expected = Math.floor(options.start / doc.chunkSize);

    return options.start - stream.s.bytesRead;
  }
  throw new MongoInvalidArgumentError('Start option must be defined');
}

function handleEndOption(
  stream: GridFSBucketReadStream,
  doc: Document,
  cursor: FindCursor<GridFSChunk>,
  options: GridFSBucketReadStreamOptions
) {
  if (options && options.end != null) {
    if (options.end > doc.length) {
      throw new MongoInvalidArgumentError(
        `Stream end (${options.end}) must not be more than the length of the file (${doc.length})`
      );
    }
    if (options.start == null || options.start < 0) {
      throw new MongoInvalidArgumentError(`Stream end (${options.end}) must not be negative`);
    }

    const start = options.start != null ? Math.floor(options.start / doc.chunkSize) : 0;

    cursor.limit(Math.ceil(options.end / doc.chunkSize) - start);

    stream.s.expectedEnd = Math.ceil(options.end / doc.chunkSize);

    return Math.ceil(options.end / doc.chunkSize) * doc.chunkSize - options.end;
  }
  throw new MongoInvalidArgumentError('End option must be defined');
}
