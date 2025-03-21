'use strict';
const test = require('./shared').assert;
const { expect } = require('chai');
const { ReturnDocument, ObjectId } = require('../../src');
const setupDatabase = require('./shared').setupDatabase;

// instanceof cannot be use reliably to detect the new models in js due to scoping and new
// contexts killing class info find/distinct/count thus cannot be overloaded without breaking
// backwards compatibility in a fundamental way
//

describe('CRUD API', function () {
  before(function () {
    return setupDatabase(this.configuration);
  });

  it('should correctly execute findOne method using crud api', async function () {
    const configuration = this.configuration;
    const client = configuration.newClient();
    await client.connect();
    const db = client.db(configuration.db);
    const collection = db.collection('t');

    await collection.insertOne({ findOneTest: 1 });

    const findOneResult = await collection.findOne({ findOneTest: 1 });

    expect(findOneResult).to.have.property('findOneTest', 1);
    expect(findOneResult).to.have.property('_id').that.is.instanceOf(ObjectId);

    const findNoneResult = await collection.findOne({ findOneTest: 2 });
    expect(findNoneResult).to.be.null;

    await collection.drop();
    await client.close();
  });

  it('should correctly execute find method using crud api', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);

        db.collection('t').insert([{ a: 1 }, { a: 1 }, { a: 1 }, { a: 1 }], function (err) {
          expect(err).to.not.exist;

          //
          // Cursor
          // --------------------------------------------------
          const makeCursor = () => {
            // Possible methods on the the cursor instance
            return db
              .collection('t')
              .find({})
              .filter({ a: 1 })
              .addCursorFlag('noCursorTimeout', true)
              .addQueryModifier('$comment', 'some comment')
              .batchSize(2)
              .comment('some comment 2')
              .limit(2)
              .maxTimeMS(50)
              .project({ a: 1 })
              .skip(0)
              .sort({ a: 1 });
          };

          //
          // Exercise count method
          // -------------------------------------------------
          var countMethod = function () {
            // Execute the different methods supported by the cursor
            const cursor = makeCursor();
            cursor.count(function (err, count) {
              expect(err).to.not.exist;
              test.equal(2, count);
              eachMethod();
            });
          };

          //
          // Exercise legacy method each
          // -------------------------------------------------
          var eachMethod = function () {
            var count = 0;

            const cursor = makeCursor();
            cursor.forEach(
              () => {
                count = count + 1;
              },
              err => {
                expect(err).to.not.exist;
                test.equal(2, count);
                toArrayMethod();
              }
            );
          };

          //
          // Exercise toArray
          // -------------------------------------------------
          var toArrayMethod = function () {
            const cursor = makeCursor();
            cursor.toArray(function (err, docs) {
              expect(err).to.not.exist;
              test.equal(2, docs.length);
              nextMethod();
            });
          };

          //
          // Exercise next method
          // -------------------------------------------------
          var nextMethod = function () {
            const cursor = makeCursor();
            cursor.next(function (err, doc) {
              expect(err).to.not.exist;
              test.ok(doc != null);

              cursor.next(function (err, doc) {
                expect(err).to.not.exist;
                test.ok(doc != null);

                cursor.next(function (err, doc) {
                  expect(err).to.not.exist;
                  expect(doc).to.not.exist;
                  streamMethod();
                });
              });
            });
          };

          //
          // Exercise stream
          // -------------------------------------------------
          var streamMethod = function () {
            var count = 0;
            const cursor = makeCursor();
            const stream = cursor.stream();
            stream.on('data', function () {
              count = count + 1;
            });

            cursor.once('close', function () {
              test.equal(2, count);
              explainMethod();
            });
          };

          //
          // Explain method
          // -------------------------------------------------
          var explainMethod = function () {
            const cursor = makeCursor();
            cursor.explain(function (err, result) {
              expect(err).to.not.exist;
              test.ok(result != null);

              client.close(done);
            });
          };

          // Execute all the methods
          countMethod();
        });
      });
    }
  });

  it('should correctly execute aggregation method using crud api', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient({ maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);

        db.collection('t1').insert([{ a: 1 }, { a: 1 }, { a: 2 }, { a: 1 }], function (err) {
          expect(err).to.not.exist;

          var testAllMethods = function () {
            // Get the cursor
            var cursor = db.collection('t1').aggregate([{ $match: {} }], {
              allowDiskUse: true,
              batchSize: 2,
              maxTimeMS: 50
            });

            // Exercise all the options
            cursor
              .geoNear({ geo: 1 })
              .group({ group: 1 })
              .limit(10)
              .match({ match: 1 })
              .maxTimeMS(10)
              .out('collection')
              .project({ project: 1 })
              .redact({ redact: 1 })
              .skip(1)
              .sort({ sort: 1 })
              .batchSize(10)
              .unwind('name');

            // Execute the command with all steps defined
            // will fail
            cursor.toArray(function (err) {
              test.ok(err != null);
              testToArray();
            });
          };

          //
          // Exercise toArray
          // -------------------------------------------------
          var testToArray = function () {
            var cursor = db.collection('t1').aggregate();
            cursor.match({ a: 1 });
            cursor.toArray(function (err, docs) {
              expect(err).to.not.exist;
              test.equal(3, docs.length);
              testNext();
            });
          };

          //
          // Exercise next
          // -------------------------------------------------
          var testNext = function () {
            var cursor = db.collection('t1').aggregate();
            cursor.match({ a: 1 });
            cursor.next(function (err) {
              expect(err).to.not.exist;
              testEach();
            });
          };

          //
          // Exercise each
          // -------------------------------------------------
          var testEach = function () {
            var count = 0;
            var cursor = db.collection('t1').aggregate();
            cursor.match({ a: 1 });
            cursor.forEach(
              () => {
                count = count + 1;
              },
              err => {
                expect(err).to.not.exist;
                test.equal(3, count);
                testStream();
              }
            );
          };

          //
          // Exercise stream
          // -------------------------------------------------
          var testStream = function () {
            var cursor = db.collection('t1').aggregate();
            var count = 0;
            cursor.match({ a: 1 });
            const stream = cursor.stream();
            stream.on('data', function () {
              count = count + 1;
            });

            stream.once('end', function () {
              test.equal(3, count);
              testExplain();
            });
          };

          //
          // Explain method
          // -------------------------------------------------
          var testExplain = function () {
            var cursor = db.collection('t1').aggregate();
            cursor.explain(function (err, result) {
              expect(err).to.not.exist;
              test.ok(result != null);

              client.close(done);
            });
          };

          testAllMethods();
        });
      });
    }
  });

  it('should correctly execute insert methods using crud api', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);

        //
        // Legacy insert method
        // -------------------------------------------------
        var legacyInsert = function () {
          db.collection('t2_1').insertMany([{ a: 1 }, { a: 2 }], function (err, r) {
            expect(err).to.not.exist;
            expect(r).property('insertedCount').to.equal(2);

            bulkAPIInsert();
          });
        };

        //
        // Bulk api insert method
        // -------------------------------------------------
        var bulkAPIInsert = function () {
          var bulk = db.collection('t2_2').initializeOrderedBulkOp();
          bulk.insert({ a: 1 });
          bulk.insert({ a: 1 });
          bulk.execute(function (err) {
            expect(err).to.not.exist;

            insertOne();
          });
        };

        //
        // Insert one method
        // -------------------------------------------------
        var insertOne = function () {
          db.collection('t2_3').insertOne({ a: 1 }, { writeConcern: { w: 1 } }, function (err, r) {
            expect(err).to.not.exist;
            expect(r).property('insertedId').to.exist;
            insertMany();
          });
        };

        //
        // Insert many method
        // -------------------------------------------------
        var insertMany = function () {
          var docs = [{ a: 1 }, { a: 1 }];
          db.collection('t2_4').insertMany(docs, { writeConcern: { w: 1 } }, function (err, r) {
            expect(err).to.not.exist;
            expect(r).property('insertedCount').to.equal(2);

            // Ordered bulk unordered
            bulkWriteUnOrdered();
          });
        };

        //
        // Bulk write method unordered
        // -------------------------------------------------
        var bulkWriteUnOrdered = function () {
          db.collection('t2_5').insertMany(
            [{ c: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t2_5').bulkWrite(
                [
                  { insertOne: { document: { a: 1 } } },
                  { insertOne: { document: { g: 1 } } },
                  { insertOne: { document: { g: 2 } } },
                  { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
                  { updateMany: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
                  { deleteOne: { filter: { c: 1 } } },
                  { deleteMany: { filter: { c: 1 } } }
                ],
                { ordered: false, writeConcern: { w: 1 } },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(3, r.nInserted);
                  test.equal(1, r.nUpserted);
                  test.equal(1, r.nRemoved);

                  // Crud fields
                  test.equal(3, r.insertedCount);
                  test.equal(3, Object.keys(r.insertedIds).length);
                  test.equal(1, r.matchedCount);
                  test.equal(1, r.deletedCount);
                  test.equal(1, r.upsertedCount);
                  test.equal(1, Object.keys(r.upsertedIds).length);

                  // Ordered bulk operation
                  bulkWriteUnOrderedSpec();
                }
              );
            }
          );
        };

        //
        // Bulk write method unordered
        // -------------------------------------------------
        var bulkWriteUnOrderedSpec = function () {
          db.collection('t2_6').insertMany(
            [{ c: 1 }, { c: 2 }, { c: 3 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(3);

              db.collection('t2_6').bulkWrite(
                [
                  { insertOne: { document: { a: 1 } } },
                  { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
                  { updateMany: { filter: { a: 3 }, update: { $set: { a: 3 } }, upsert: true } },
                  { deleteOne: { filter: { c: 1 } } },
                  { deleteMany: { filter: { c: 2 } } },
                  { replaceOne: { filter: { c: 3 }, replacement: { c: 4 }, upsert: true } }
                ],
                { ordered: false, writeConcern: { w: 1 } },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(1, r.nInserted);
                  test.equal(2, r.nUpserted);
                  test.equal(2, r.nRemoved);

                  // Crud fields
                  test.equal(1, r.insertedCount);
                  test.equal(1, Object.keys(r.insertedIds).length);
                  test.equal(1, r.matchedCount);
                  test.equal(2, r.deletedCount);
                  test.equal(2, r.upsertedCount);
                  test.equal(2, Object.keys(r.upsertedIds).length);

                  // Ordered bulk operation
                  bulkWriteOrdered();
                }
              );
            }
          );
        };

        //
        // Bulk write method ordered
        // -------------------------------------------------
        var bulkWriteOrdered = function () {
          db.collection('t2_7').insertMany(
            [{ c: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t2_7').bulkWrite(
                [
                  { insertOne: { document: { a: 1 } } },
                  { insertOne: { document: { g: 1 } } },
                  { insertOne: { document: { g: 2 } } },
                  { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
                  { updateMany: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
                  { deleteOne: { filter: { c: 1 } } },
                  { deleteMany: { filter: { c: 1 } } }
                ],
                { ordered: true, writeConcern: { w: 1 } },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(3, r.nInserted);
                  test.equal(1, r.nUpserted);
                  test.equal(1, r.nRemoved);

                  // Crud fields
                  test.equal(3, r.insertedCount);
                  test.equal(3, Object.keys(r.insertedIds).length);
                  test.equal(1, r.matchedCount);
                  test.equal(1, r.deletedCount);
                  test.equal(1, r.upsertedCount);
                  test.equal(1, Object.keys(r.upsertedIds).length);

                  bulkWriteOrderedCrudSpec();
                }
              );
            }
          );
        };

        //
        // Bulk write method ordered
        // -------------------------------------------------
        var bulkWriteOrderedCrudSpec = function () {
          db.collection('t2_8').insertMany(
            [{ c: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t2_8').bulkWrite(
                [
                  { insertOne: { document: { a: 1 } } },
                  { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
                  { updateMany: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
                  { deleteOne: { filter: { c: 1 } } },
                  { deleteMany: { filter: { c: 1 } } },
                  { replaceOne: { filter: { c: 3 }, replacement: { c: 4 }, upsert: true } }
                ],
                { ordered: true, writeConcern: { w: 1 } },
                function (err, r) {
                  // expect(err).to.not.exist;
                  test.equal(1, r.nInserted);
                  test.equal(2, r.nUpserted);
                  test.equal(1, r.nRemoved);

                  // Crud fields
                  test.equal(1, r.insertedCount);
                  test.equal(1, Object.keys(r.insertedIds).length);
                  test.equal(1, r.matchedCount);
                  test.equal(1, r.deletedCount);
                  test.equal(2, r.upsertedCount);
                  test.equal(2, Object.keys(r.upsertedIds).length);

                  client.close(done);
                }
              );
            }
          );
        };

        legacyInsert();
      });
    }
  });

  it('should correctly execute update methods using crud api', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);

        //
        // Legacy update method
        // -------------------------------------------------
        var legacyUpdate = function () {
          db.collection('t3_1').update(
            { a: 1 },
            { $set: { a: 2 } },
            { upsert: true },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('upsertedCount').to.equal(1);

              updateOne();
            }
          );
        };

        //
        // Update one method
        // -------------------------------------------------
        var updateOne = function () {
          db.collection('t3_2').insertMany(
            [{ c: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t3_2').updateOne(
                { a: 1 },
                { $set: { a: 1 } },
                { upsert: true },
                function (err, r) {
                  expect(err).to.not.exist;
                  expect(r).property('upsertedCount').to.equal(1);
                  test.equal(0, r.matchedCount);
                  test.ok(r.upsertedId != null);

                  db.collection('t3_2').updateOne({ c: 1 }, { $set: { a: 1 } }, function (err, r) {
                    expect(err).to.not.exist;
                    expect(r).property('modifiedCount').to.equal(1);
                    test.equal(1, r.matchedCount);
                    test.ok(r.upsertedId == null);

                    replaceOne();
                  });
                }
              );
            }
          );
        };

        //
        // Replace one method
        // -------------------------------------------------
        var replaceOne = function () {
          db.collection('t3_3').replaceOne({ a: 1 }, { a: 2 }, { upsert: true }, function (err, r) {
            expect(err).to.not.exist;
            expect(r).property('upsertedCount').to.equal(1);
            test.equal(0, r.matchedCount);
            test.ok(r.upsertedId != null);

            db.collection('t3_3').replaceOne(
              { a: 2 },
              { a: 3 },
              { upsert: true },
              function (err, r) {
                expect(err).to.not.exist;
                expect(r).property('modifiedCount').to.equal(1);
                expect(r).property('upsertedCount').to.equal(0);
                expect(r).property('matchedCount').to.equal(1);

                updateMany();
              }
            );
          });
        };

        //
        // Update many method
        // -------------------------------------------------
        var updateMany = function () {
          db.collection('t3_4').insertMany(
            [{ a: 1 }, { a: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(2);

              db.collection('t3_4').updateMany(
                { a: 1 },
                { $set: { a: 2 } },
                { upsert: true, writeConcern: { w: 1 } },
                function (err, r) {
                  expect(err).to.not.exist;
                  expect(r).property('modifiedCount').to.equal(2);
                  test.equal(2, r.matchedCount);
                  test.ok(r.upsertedId == null);

                  db.collection('t3_4').updateMany(
                    { c: 1 },
                    { $set: { d: 2 } },
                    { upsert: true, writeConcern: { w: 1 } },
                    function (err, r) {
                      expect(err).to.not.exist;
                      test.equal(0, r.matchedCount);
                      test.ok(r.upsertedId != null);

                      client.close(done);
                    }
                  );
                }
              );
            }
          );
        };

        legacyUpdate();
      });
    }
  });

  it('should correctly execute remove methods using crud api', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);

        //
        // Legacy update method
        // -------------------------------------------------
        var legacyRemove = function () {
          db.collection('t4_1').insertMany(
            [{ a: 1 }, { a: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              test.equal(2, r.insertedCount);

              db.collection('t4_1').remove({ a: 1 }, { single: true }, function (err, r) {
                expect(err).to.not.exist;
                test.equal(1, r.deletedCount);

                deleteOne();
              });
            }
          );
        };

        //
        // Update one method
        // -------------------------------------------------
        var deleteOne = function () {
          db.collection('t4_2').insertMany(
            [{ a: 1 }, { a: 1 }],
            { writeConcern: { w: 1 } },
            (err, r) => {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(2);

              db.collection('t4_2').deleteOne({ a: 1 }, (err, r) => {
                expect(err).to.not.exist;
                expect(r).property('deletedCount').to.equal(1);

                deleteMany();
              });
            }
          );
        };

        //
        // Update many method
        // -------------------------------------------------
        var deleteMany = function () {
          db.collection('t4_3').insertMany(
            [{ a: 1 }, { a: 1 }],
            { writeConcern: { w: 1 } },
            (err, r) => {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(2);

              db.collection('t4_3').deleteMany({ a: 1 }, (err, r) => {
                expect(err).to.not.exist;
                expect(r).property('deletedCount').to.equal(2);

                client.close(done);
              });
            }
          );
        };

        legacyRemove();
      });
    }
  });

  it('should correctly execute findAndModify methods using crud api', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);

        //
        // findOneAndRemove method
        // -------------------------------------------------
        var findOneAndRemove = function () {
          db.collection('t5_1').insertMany(
            [{ a: 1, b: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t5_1').findOneAndDelete(
                { a: 1 },
                { projection: { b: 1 }, sort: { a: 1 } },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(1, r.lastErrorObject.n);
                  test.equal(1, r.value.b);

                  findOneAndReplace();
                }
              );
            }
          );
        };

        //
        // findOneAndRemove method
        // -------------------------------------------------
        var findOneAndReplace = function () {
          db.collection('t5_2').insertMany(
            [{ a: 1, b: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t5_2').findOneAndReplace(
                { a: 1 },
                { c: 1, b: 1 },
                {
                  projection: { b: 1, c: 1 },
                  sort: { a: 1 },
                  returnDocument: ReturnDocument.AFTER,
                  upsert: true
                },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(1, r.lastErrorObject.n);
                  test.equal(1, r.value.b);
                  test.equal(1, r.value.c);

                  findOneAndUpdate();
                }
              );
            }
          );
        };

        //
        // findOneAndRemove method
        // -------------------------------------------------
        var findOneAndUpdate = function () {
          db.collection('t5_3').insertMany(
            [{ a: 1, b: 1 }],
            { writeConcern: { w: 1 } },
            function (err, r) {
              expect(err).to.not.exist;
              expect(r).property('insertedCount').to.equal(1);

              db.collection('t5_3').findOneAndUpdate(
                { a: 1 },
                { $set: { d: 1 } },
                {
                  projection: { b: 1, d: 1 },
                  sort: { a: 1 },
                  returnDocument: ReturnDocument.AFTER,
                  upsert: true
                },
                function (err, r) {
                  expect(err).to.not.exist;
                  test.equal(1, r.lastErrorObject.n);
                  test.equal(1, r.value.b);
                  test.equal(1, r.value.d);

                  client.close(done);
                }
              );
            }
          );
        };

        findOneAndRemove();
      });
    }
  });

  it('should correctly execute removeMany with no selector', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);
        expect(err).to.not.exist;

        // Delete all items with no selector
        db.collection('t6_1').deleteMany({}, function (err) {
          expect(err).to.not.exist;

          client.close(done);
        });
      });
    }
  });

  it('should correctly execute crud operations with w:0', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);
        expect(err).to.not.exist;

        var col = db.collection('shouldCorrectlyExecuteInsertOneWithW0');
        col.insertOne({ a: 1 }, { writeConcern: { w: 0 } }, function (err, result) {
          expect(err).to.not.exist;
          expect(result).property('acknowledged').to.be.false;
          expect(result).property('insertedId').to.exist;

          col.insertMany([{ a: 1 }], { writeConcern: { w: 0 } }, function (err, result) {
            expect(err).to.not.exist;
            expect(result).to.exist;

            col.updateOne(
              { a: 1 },
              { $set: { b: 1 } },
              { writeConcern: { w: 0 } },
              function (err, result) {
                expect(err).to.not.exist;
                expect(result).to.exist;

                col.updateMany(
                  { a: 1 },
                  { $set: { b: 1 } },
                  { writeConcern: { w: 0 } },
                  function (err, result) {
                    expect(err).to.not.exist;
                    expect(result).to.exist;

                    col.deleteOne({ a: 1 }, { writeConcern: { w: 0 } }, function (err, result) {
                      expect(err).to.not.exist;
                      expect(result).to.exist;

                      col.deleteMany({ a: 1 }, { writeConcern: { w: 0 } }, function (err, result) {
                        expect(err).to.not.exist;
                        expect(result).to.exist;

                        client.close(done);
                      });
                    });
                  }
                );
              }
            );
          });
        });
      });
    }
  });

  it('should correctly execute updateOne operations with w:0 and upsert', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);
        expect(err).to.not.exist;

        db.collection('try').updateOne(
          { _id: 1 },
          { $set: { x: 1 } },
          { upsert: true, writeConcern: { w: 0 } },
          function (err, r) {
            expect(err).to.not.exist;
            test.ok(r != null);

            client.close(done);
          }
        );
      });
    }
  });

  it('should correctly execute crud operations using w:0', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });
      client.connect(function (err, client) {
        var db = client.db(configuration.db);
        expect(err).to.not.exist;

        var collection = db.collection('w0crudoperations');
        collection.insertOne({}, function (err) {
          expect(err).to.not.exist;
          client.close(done);
        });

        // collection.insertOne({a:1});
        // collection.insertMany([{b:1}]);
        // collection.updateOne({c:1}, {$set:{a:1}}, {upsert:true});

        // db.collection('try').updateOne({_id:1}, {$set:{x:1}}, {upsert:true, w:0}, function(err, r) {
        //   expect(err).to.not.exist;
        //   test.ok(r != null);

        //   client.close();
        //   done();
        // });
      });
    }
  });

  it('should correctly throw error on illegal callback when unordered bulkWrite encounters error', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });

      var ops = [];
      // Create a set of operations that go over the 1000 limit causing two messages
      for (var i = 0; i < 1005; i++) {
        ops.push({ insertOne: { _id: i, a: i } });
      }

      ops.push({ insertOne: { _id: 0, a: i } });

      client.connect(function (err, client) {
        var db = client.db(configuration.db);
        expect(err).to.not.exist;

        db.collection('t20_1').bulkWrite(
          ops,
          { ordered: false, writeConcern: { w: 1 } },
          function (err) {
            test.ok(err !== null);
            client.close(done);
          }
        );
      });
    }
  });

  it('should correctly throw error on illegal callback when ordered bulkWrite encounters error', {
    // Add a tag that our runner can trigger on
    // in this case we are setting that node needs to be higher than 0.10.X to run
    metadata: {
      requires: { topology: ['single', 'replicaset', 'sharded', 'ssl', 'heap', 'wiredtiger'] }
    },

    test: function (done) {
      var configuration = this.configuration;
      var client = configuration.newClient(configuration.writeConcernMax(), { maxPoolSize: 1 });

      var ops = [];
      // Create a set of operations that go over the 1000 limit causing two messages
      for (var i = 0; i < 1005; i++) {
        ops.push({ insertOne: { _id: i, a: i } });
      }

      ops.push({ insertOne: { _id: 0, a: i } });

      client.connect(function (err, client) {
        var db = client.db(configuration.db);
        expect(err).to.not.exist;

        db.collection('t20_1').bulkWrite(
          ops,
          { ordered: true, writeConcern: { w: 1 } },
          function (err) {
            test.ok(err !== null);
            client.close(done);
          }
        );
      });
    }
  });
});
