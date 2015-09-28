var assert = require('assert');
var AWS = require('aws-sdk');
var sinon = require('sinon');
var supertest = require('supertest');
var express = require('express');
var invoker = require('../lib/invoker');
var eventEmitter = require('event-emitter');
var sbuff = require('simple-bufferstream');
var querystring = require('querystring');

require('dash-assert');
require('simple-errors');

describe("lambdaInvoker", function() {
  var pluginOptions, app, lambdaStub, lambdaRequest,
    jsonResponse, lambdaHeaders, lambdaError;

  beforeEach(function() {
    app = express();
    pluginOptions = {};
    jsonResponse = {};
    lambdaRequest = eventEmitter();
    lambdaHeaders = {};
    lambdaError = null;

    app.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    app.use(require('cookie-parser')());

    app.use('/lambda/:name', function(req, res, next) {
      invoker(pluginOptions)(req, res, next);
    });

    app.use(function(err, req, res, next) {
      res.statusCode = 500;
      res.json(Error.toJson(err));
    });

    lambdaStub = {
      invoke: sinon.spy(function(params, callback) {
        lambdaRequest.createReadStream = function() {
          lambdaRequest.emit('httpHeaders', 500, lambdaHeaders);
          if (lambdaError)
            lambdaRequest.emit('error', lambdaError);

          return sbuff(JSON.stringify(jsonResponse));
        }

        return lambdaRequest;
      })
    };

    sinon.stub(AWS, 'Lambda', function() {
      return lambdaStub;
    });
  });

  afterEach(function() {
    sinon.restore(AWS, 'Lambda');
  });

  it("invokes lambda with success response", function(done) {
    jsonResponse = {
      name: 'bob',
      age: 50
    };

    pluginOptions.functionName = 'getUser';

    supertest(app).get('/lambda/get-user')
      .expect(200)
      .expect(function(res) {
        assert.isTrue(lambdaStub.invoke.calledWith(sinon.match({
          FunctionName: pluginOptions.functionName,
          InvocationType: 'RequestResponse',
          LogType: 'None'
        })));

        assert.deepEqual(res.body, jsonResponse);
      })
      .end(done);
  });

  it('passes through http req properties', function(done) {
    var requestBody = {
      foo: 'one',
      list: ['a', 'b']
    };

    var query = {
      param1: '1'
    };

    var cookies = {cookie1: 'one', cookie2: 'two'};

    pluginOptions.functionName = 'createUser';
    supertest(app).post('/lambda/create-user?' + querystring.stringify(query))
      .send(requestBody)
      .set('Cookie', 'cookie1=one;cookie2=two')
      .expect(200)
      .expect(function(res) {
        var lambdaArgs = lambdaStub.invoke.getCall(0).args[0];
        var eventPayload = JSON.parse(lambdaArgs.Payload);

        assert.deepEqual(eventPayload.body, requestBody);
        assert.deepEqual(eventPayload.query, query);
        assert.deepEqual(eventPayload.params, {name: 'create-user'});
        assert.deepEqual(eventPayload.cookies, cookies);
        assert.equal(eventPayload.path, '/');
        assert.equal(eventPayload.method, 'POST');
      })
      .end(done);
  });

  it('lambda function returns an error', function(done) {
    pluginOptions.functionName = 'getUser';

    var errorHeader = "lambda error";
    jsonResponse = {
      message: "this is an error"
    };

    lambdaHeaders['x-amz-function-error'] = errorHeader;

    supertest(app).get('/lambda/get-user')
      .expect(500)
      .expect(function(res) {
        assert.isMatch(res.body, {
          message: jsonResponse.message,
          errorType: errorHeader,
          status: 500,
          functionName: 'getUser'
        });
      })
      .end(done);
  });
});
