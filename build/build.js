var fs=require('fs'),
  requirejs = require('requirejs'),
  modules = require('./modules');

// fs.extra - from https://gist.github.com/992478
(function () {
  "use strict";

  var fs = require('fs')
    , util = require('util')
    ;

  fs.copy = function (src, dst, cb) {
    function copy(err) {
      var is
        , os
        ;

      if (!err) {
        return cb(new Error("File " + dst + " exists."));
      }

      fs.stat(src, function (err) {
        if (err) {
          return cb(err);
        }
        is = fs.createReadStream(src);
        os = fs.createWriteStream(dst);
        util.pump(is, os, cb);
      });
    }

    fs.stat(dst, copy);
  };

  fs.move = function (src, dst, cb) {
    function copyIfFailed(err) {
      if (!err) {
        return cb(null);
      }
      fs.copy(src, dst, function(err) {
        if (!err) {
          // TODO 
          // should we revert the copy if the unlink fails?
          fs.unlink(src, cb);
        } else {
          cb(err);
        }
      });
    }

    fs.stat(dst, function (err) {
      if (!err) {
        return cb(new Error("File " + dst + " exists."));
      }
      fs.rename(src, dst, copyIfFailed);
    });
  };
}());

function deepCopy(object) {
  var o = {}, keys = Object.keys(object);
  for(var i=0;i<keys.length;i++) {
    var k = keys[i], v = object[keys[i]];
    o[k] = (typeof(v) === 'object') ? deepCopy(v) : v;
  }
  return o;
}


//normal build:
var defaults = {
  baseUrl: '../src',
  name: '../build/lib/almond',
  wrap: {
    startFile: 'start.frag',
    endFile:'end.frag'
  }
};

function build(output, inputs, options) {
  var config = deepCopy(defaults);
  if(! options) {
    options = {};
  }
  if(! (inputs instanceof Array)) {
    inputs = [inputs];
  }
  if(options.start) {
    config.wrap.startFile = options.start;
  }
  if(options.end) {
    config.wrap.endFile = options.end;
  }
  if(options.debug) {
    config.optimize = 'none';
  }

  config.include = inputs;
  config.out = output + '.js';

  console.log('BUILD', output, 'FROM', inputs, 'WITH', options);

  requirejs.optimize(config);
}

if(process.argv[2] == 'debug') {
  build('latest/remoteStorage-debug', 'remoteStorage', { debug: true });
  build('latest/remoteStorage-modules-debug', 'remoteStorage-modules', { end: 'endModules.frag', debug: true });
} else {
  build('latest/remoteStorage.min', 'remoteStorage');
  build('latest/remoteStorage-debug', 'remoteStorage', { debug: true });
  build('latest/remoteStorage-node.min', 'remoteStorage', { start: 'startNode.frag', end: 'endNode.frag' });
  build('latest/remoteStorage-node-debug', 'remoteStorage', { start: 'startNode.frag', end: 'endNode.frag', debug: true });


  build('latest/remoteStorage-modules.min', 'remoteStorage-modules', { end: 'endModules.frag' });
  build('latest/remoteStorage-modules-debug', 'remoteStorage-modules', { end: 'endModules.frag', debug: true });

  build('latest/remoteStorage-node-modules.min', 'remoteStorage-modules', { start: 'startNode.frag', end: 'endNodeModules.frag' });
  build('latest/remoteStorage-node-modules-debug', 'remoteStorage-modules', { start: 'startNode.frag', end: 'endNodeModules.frag', debug: true });

  function cp(s, d) {
    if(fs.existsSync(d)) {
      fs.unlink(d);
    }
    fs.copy(s, d, function(err) { if(err) console.log("copy failed: " + err) });
  }

  cp('latest/remoteStorage.min.js', 'latest/remoteStorage.js');
  cp('latest/remoteStorage-node.min.js', 'latest/remoteStorage-node.js');
  cp('latest/remoteStorage-modules.min.js', 'latest/remoteStorage-modules.js');
}

// var mods = modules.map(function(module) {
//   return 'modules/' + module.name;
// });

// build('latest/remoteStorage-modules', mods, { end: 'endModules.frag' });
// build('latest/remoteStorage-modules-debug', mods, { end: 'endModules.frag', debug: true });
