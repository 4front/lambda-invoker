var express = require('express');

var app = express();

app.get('/lambda', require('./lib/invoker')({
  functionName: 'sample-4front-lambda',
  region: 'us-west-2'
}));

app.listen(9000, function() {
  console.log("listening");
});
