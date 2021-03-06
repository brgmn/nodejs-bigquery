/**
 * Copyright 2014 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import * as arrify from 'arrify';
import * as assert from 'assert';
import * as extend from 'extend';
import * as proxyquire from 'proxyquire';
import * as pfy from '@google-cloud/promisify';
import {util} from '@google-cloud/common';
import * as sinon from 'sinon';

function FakeOperation() {
  this.calledWith_ = arguments;
  this.interceptors = [];
  this.id = this.calledWith_[0].id;
}

let promisified = false;
const fakePfy = extend({}, pfy, {
  promisifyAll: function(Class) {
    if (Class.name === 'Job') {
      promisified = true;
    }
  },
});

let extended = false;
const fakePaginator = {
  paginator: {
    extend: function(Class, methods) {
      if (Class.name !== 'Job') {
        return;
      }

      methods = arrify(methods);
      assert.deepStrictEqual(methods, ['getQueryResults']);
      extended = true;
    },
    streamify: function(methodName) {
      return methodName;
    },
  }
};

describe('BigQuery/Job', function() {
  const BIGQUERY: any = {
    projectId: 'my-project',
    Promise: Promise,
  };
  const JOB_ID = 'job_XYrk_3z';
  const LOCATION = 'asia-northeast1';

  let Job;
  let job;

  before(function() {
    Job = proxyquire('../src/job.js', {
      '@google-cloud/common': {
        Operation: FakeOperation
      },
      '@google-cloud/paginator': fakePaginator,
      '@google-cloud/promisify': fakePfy,
    }).Job;
  });

  beforeEach(function() {
    job = new Job(BIGQUERY, JOB_ID);
  });

  describe('initialization', function() {
    it('should paginate all the things', function() {
      assert(extended);
    });

    it('should promisify all the things', function() {
      assert(promisified);
    });

    it('should assign this.bigQuery', function() {
      assert.deepStrictEqual(job.bigQuery, BIGQUERY);
    });

    it('should inherit from Operation', function() {
      assert(job instanceof FakeOperation);

      const calledWith = job.calledWith_[0];

      assert.strictEqual(calledWith.parent, BIGQUERY);
      assert.strictEqual(calledWith.baseUrl, '/jobs');
      assert.strictEqual(calledWith.id, JOB_ID);
      assert.deepStrictEqual(calledWith.methods, {
        exists: true,
        get: true,
        setMetadata: true,
        getMetadata: {
          reqOpts: {
            qs: {location: undefined},
          },
        },
      });
    });

    it('should accept a location option', function() {
      const options = {location: 'US'};
      const job = new Job(BIGQUERY, JOB_ID, options);

      assert.strictEqual(job.location, options.location);
    });

    it('should send the location via getMetadata', function() {
      const job = new Job(BIGQUERY, JOB_ID, {location: LOCATION});
      const calledWith = job.calledWith_[0];

      assert.deepStrictEqual(calledWith.methods.getMetadata, {
        reqOpts: {
          qs: {location: LOCATION},
        },
      });
    });
  });

  describe('cancel', function() {
    it('should make the correct API request', function(done) {
      job.request = function(reqOpts) {
        assert.strictEqual(reqOpts.method, 'POST');
        assert.strictEqual(reqOpts.uri, '/cancel');
        done();
      };

      job.cancel(assert.ifError);
    });

    it('should include the job location', function(done) {
      const job = new Job(BIGQUERY, JOB_ID, {location: LOCATION});

      job.request = function(reqOpts) {
        assert.deepStrictEqual(reqOpts.qs, {location: LOCATION});
        done();
      };

      job.cancel(assert.ifError);
    });
  });

  describe('getQueryResults', function() {
    const pageToken = 'token';
    const options = {
      a: 'a',
      b: 'b',
      location: 'US',
    };

    const RESPONSE = {
      pageToken: pageToken,
      jobReference: {jobId: JOB_ID},
    };

    beforeEach(function() {
      BIGQUERY.request = function(reqOpts, callback) {
        callback(null, RESPONSE);
      };

      BIGQUERY.mergeSchemaWithRows_ = function(schema, rows) {
        return rows;
      };
    });

    it('should make the correct request', function(done) {
      BIGQUERY.request = function(reqOpts) {
        assert.strictEqual(reqOpts.uri, '/queries/' + JOB_ID);
        done();
      };

      job.getQueryResults(assert.ifError);
    });

    it('should optionally accept options', function(done) {
      const options = {a: 'b'};
      const expectedOptions = extend({location: undefined}, options);

      BIGQUERY.request = function(reqOpts) {
        assert.deepStrictEqual(reqOpts.qs, expectedOptions);
        done();
      };

      job.getQueryResults(options, assert.ifError);
    });

    it('should inherit the location', function(done) {
      const job = new Job(BIGQUERY, JOB_ID, {location: LOCATION});

      BIGQUERY.request = function(reqOpts) {
        assert.deepStrictEqual(reqOpts.qs, {location: LOCATION});
        done();
      };

      job.getQueryResults(assert.ifError);
    });

    it('should return any errors to the callback', function(done) {
      const error = new Error('err');
      const response = {};

      BIGQUERY.request = function(reqOpts, callback) {
        callback(error, response);
      };

      job.getQueryResults(function(err, rows, nextQuery, resp) {
        assert.strictEqual(err, error);
        assert.strictEqual(rows, null);
        assert.strictEqual(nextQuery, null);
        assert.strictEqual(resp, response);
        done();
      });
    });

    it('should return the rows and response to the callback', function(done) {
      job.getQueryResults(function(err, rows, nextQuery, resp) {
        assert.ifError(err);
        assert.deepStrictEqual(rows, []);
        assert.strictEqual(resp, RESPONSE);
        done();
      });
    });

    it('should merge the rows with the schema', function(done) {
      const response = {
        schema: {},
        rows: [],
      };

      const mergedRows = [];

      BIGQUERY.request = function(reqOpts, callback) {
        callback(null, response);
      };

      BIGQUERY.mergeSchemaWithRows_ = function(schema, rows) {
        assert.strictEqual(schema, response.schema);
        assert.strictEqual(rows, response.rows);
        return mergedRows;
      };

      job.getQueryResults(function(err, rows) {
        assert.ifError(err);
        assert.strictEqual(rows, mergedRows);
        done();
      });
    });

    it('should return the query when the job is not complete', function(done) {
      BIGQUERY.request = function(reqOpts, callback) {
        callback(null, {
          jobComplete: false,
        });
      };

      job.getQueryResults(options, function(err, rows, nextQuery) {
        assert.ifError(err);
        assert.deepStrictEqual(nextQuery, options);
        assert.notStrictEqual(nextQuery, options);
        done();
      });
    });

    it('should populate nextQuery when more results exist', function(done) {
      job.getQueryResults(options, function(err, rows, nextQuery) {
        assert.ifError(err);
        assert.strictEqual(nextQuery.pageToken, pageToken);
        done();
      });
    });
  });

  describe('getQueryResultsStream', function() {
    it('should have streamified getQueryResults', function() {
      assert.strictEqual(job.getQueryResultsStream, 'getQueryResultsAsStream_');
    });
  });

  describe('getQueryResultsAsStream_', function() {
    it('should call getQueryResults correctly', function(done) {
      const options = {a: 'b', c: 'd'};

      job.getQueryResults = function(options_, callback) {
        assert.deepStrictEqual(options_, {
          a: 'b',
          c: 'd',
          autoPaginate: false,
        });
        callback(); // done()
      };

      job.getQueryResultsAsStream_(options, done);
    });
  });

  describe('poll_', function() {
    it('should call getMetadata', function(done) {
      job.getMetadata = function() {
        done();
      };

      job.poll_(assert.ifError);
    });

    describe('API error', function() {
      const error = new Error('Error.');

      beforeEach(function() {
        job.getMetadata = function(callback) {
          callback(error);
        };
      });

      it('should return an error', function(done) {
        job.poll_(function(err) {
          assert.strictEqual(err, error);
          done();
        });
      });
    });

    describe('job failure', function() {
      const error = new Error('Error.');
      const apiResponse = {
        status: {
          errors: error,
        },
      };

      let sandbox;

      beforeEach(function() {
        sandbox = sinon.createSandbox();
        job.getMetadata = function(callback) {
          callback(null, apiResponse, apiResponse);
        };
      });

      it('should detect and return an error from the response', function(done) {
        sandbox.stub(util, 'ApiError').callsFake(body => {
          assert.strictEqual(body, apiResponse.status);
          return error;
        });

        job.poll_(function(err) {
          assert.strictEqual(err, error);
          done();
        });
      });

      afterEach(() => {
        sandbox.restore();
      });
    });

    describe('job pending', function() {
      const apiResponse = {
        status: {
          state: 'PENDING',
        },
      };

      beforeEach(function() {
        job.getMetadata = function(callback) {
          callback(null, apiResponse, apiResponse);
        };
      });

      it('should execute callback', function(done) {
        job.poll_(function(err, metadata) {
          assert.ifError(err);
          assert.strictEqual(metadata, undefined);
          done();
        });
      });
    });

    describe('job complete', function() {
      const apiResponse = {
        status: {
          state: 'DONE',
        },
      };

      beforeEach(function() {
        job.getMetadata = function(callback) {
          callback(null, apiResponse, apiResponse);
        };
      });

      it('should emit complete with metadata', function(done) {
        job.poll_(function(err, metadata) {
          assert.ifError(err);
          assert.strictEqual(metadata, apiResponse);
          done();
        });
      });
    });
  });
});
