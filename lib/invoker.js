var AWS = require('aws-sdk');
var _ = require('lodash');
var bodyParser = require('body-parser');
var urljoin = require('url-join');
var debug = require('debug')('lambda-invoker');

require('simple-errors');

module.exports = function(options) {
  if (!options.functionName) {
    throw new Error('Required option functionName not provided');
  }

  _.defaults(options, {
    contentType: 'application/json',
    timeout: 3000
  });

  var functionName = options.functionName;

  return function(req, res, next) {
    var lambda = createLambda(req, options);

    bodyParser.json()(req, res, function() {
      var payload = _.pick(req, 'body', 'query', 'cookies',
        'params', 'method', 'path', 'originalUrl', 'ext');

      payload.url = urljoin(req.secure ? 'https://' : 'http://', req.hostname, req.originalUrl);

      // TODO: Don't pass all of req.ext.. just take a subset

      var params = {
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        LogType: 'None',
        Payload: JSON.stringify(payload)
      };

      debug('invoking lambda %s with event payload %s', functionName,
        JSON.stringify(params.Payload));

      var lambdaFunctionError = null;
      var awsRequest = lambda.invoke(params);
      awsRequest
        .on('error', function(err) {
          debug('error received');
          return next(err);
        })
        .on('httpHeaders', function(statusCode, headers) {
          debug('headers received');
          lambdaFunctionError = headers['x-amz-function-error'];
        });

      var errorBuffer = '';

      res.set('Content-Type', options.contentType);
      awsRequest.createReadStream()
        .on('data', function(data) {
          debug('data received');

          // If the Lambda response is an error, then buffer up the response JSON
          // otherwise pipe it straight out to the http response.
          if (lambdaFunctionError) {
            errorBuffer += data.toString();
          } else {
            // Pipe the response from the Lambda out to the response
            res.write(data);
          }
        })
        .on('end', function() {
          if (lambdaFunctionError) {
            var errorJson = JSON.parse(errorBuffer);
            errorJson.functionName = options.functionName;
            errorJson.errorType = lambdaFunctionError;
            next(Error.create('Error invoking lambda', errorJson));
          } else {
            res.end();
          }
        });
    });
  };

  function createLambda(req) {
    var awsOptions = _.omit(options, 'functionName', 'contentType', 'timeout');

    if (!awsOptions.httpOptions) awsOptions.httpOptions = {};

    // Ensure that the passed in options cannot exceed system level limits
    if (_.isNumber(req.app.settings.networkTimeout)) {
      if (!options.timeout || options.timeout > req.app.settings.networkTimeout) {
        options.timeout = req.app.settings.networkTimeout;
      }
    }

    awsOptions.httpOptions.timeout = options.timeout;

    if (options.profile) {
      awsOptions.credentials = new AWS.SharedIniFileCredentials({
        profile: options.profile
      });
      delete awsOptions.profile;
    }

    if (process.env.HTTPS_PROXY) {
      if (!awsOptions.httpOptions.agent) {
        var HttpsProxyAgent = require('https-proxy-agent');
        awsOptions.httpOptions.agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
      }
    }

    return new AWS.Lambda(awsOptions);
  }
};
