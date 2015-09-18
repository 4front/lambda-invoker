var AWS = require('aws-sdk');
var _ = require('lodash');
var debug = require('debug')('lambda-invoker');

require('simple-errors');

module.exports = function(options) {
  if (!options.functionName)
    throw new Error("Required option functionName not provided");

  _.defaults(options, {
    contentType: 'application/json'
  });

  var functionName = options.functionName;

  var awsOptions = _.omit(options, 'functionName', 'contentType');

  if (options.profile) {
    awsOptions.credentials = new AWS.SharedIniFileCredentials({profile: options.profile});
    delete awsOptions.profile;
  }

  if (process.env.HTTPS_PROXY) {
    if (!awsOptions.httpOptions)
      awsOptions.httpOptions = {};

    if (!awsOptions.httpOptions.agent) {
      var HttpsProxyAgent = require('https-proxy-agent');
      awsOptions.httpOptions.agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
    }
  }

  var lambda = new AWS.Lambda(awsOptions);

  return function(req, res, next) {
    var params = {
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Payload: JSON.stringify(_.pick(req, 'body', 'query', 'cookies', 'params', 'method', 'path'))
    };

    debug('invoking lambda %s with event payload %s', functionName, JSON.stringify(params.Payload));

    var isError = false;
    var lambdaFunctionError = null;
    var awsRequest = lambda.invoke(params);
    awsRequest
      .on('error', function(err) {
        debug('error received');
        return next(err);
      })
      .on('httpHeaders', function(statusCode, headers) {
        debug("headers received");
        lambdaFunctionError= headers['x-amz-function-error'];
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
        }
        else {
          // Pipe the response from the Lambda out to the response
          res.write(data);
        }
      })
      .on('end', function() {
        if (lambdaFunctionError) {
          var errorJson = JSON.parse(errorBuffer);
          errorJson.functionName = options.functionName;
          errorJson.errorType = lambdaFunctionError;
          next(Error.create("Error invoking lambda", errorJson));
        }
        else
          res.end();
      });
  };
};