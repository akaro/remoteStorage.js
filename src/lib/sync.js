//start: store has a tree with three types of node: dir, object, media.
//object and media nodes have fields:
//lastModified, type (media/object), mimeType/objectType, data, access, outgoingChange (client-side timestamp or false), sync
//dir nodes have fields:
//lastModified, type (dir), children (hash filename -> remote timestamp), added/changed/removed, access, startSync, stopSync

define(['./wireClient', './store'], function(wireClient, store) {
  var prefix = '_remoteStorage_', busy=false;
   
  function getState(path) {
    if(busy) {
      return 'busy';
    } else {
      return 'connected';
    }
  }
  function handleChild(basePath, path, lastModified, force, accessInherited, startOne, finishOne) {
    var node = store.getNode(basePath+path);//will return a fake dir with empty children list for item
    var access = accessInherited || node.access;
    if(node.outgoingChange) {
      //TODO: deal with media; they don't need stringifying, but have a mime type that needs setting in a header
      startOne();
      wireClient.set(basePath+path, JSON.stringify(node.data), finishOne);
    } else if(node.revision<lastModified) {
      if(node.startForcing) { force = true; }
      if(node.stopForcing) { force = false; }
      if((force || node.keep) && access) {
        startOne();
        wireClient.get(basePath+path, function (err, data) {
          if(data) {
            var node = store.getNode(basePath+path);
            node.data = data;
            store.updateNode(basePath+path, node);
          }
          pullMap(basePath+path, store.getNode(basePath+path).children, force, access, function(err2) {
            finishOne(err || err2);
          });//recurse without forcing
        });
      } else {
        //store.forget(basePath+path);
        startOne();
        pullMap(basePath+path, node.children, force, access, finishOne);
      }
    }// else everything up to date
  }
  function pullMap(basePath, map, force, accessInherited, cb) {
    var outstanding=0, errors=false;
    function startOne() {
      outstanding++;
    }
    function finishOne(err) {
      if(err) {
        errors = true;
      }
      outstanding--;
      if(outstanding==0) {
        cb(errors);
      }
    }
    startOne();
    for(var path in map) {
      handleChild(basePath, path, map[path], force, accessInherited, startOne, finishOne);
    }
    finishOne();
  }
  function syncNow(path, cb) {
    busy=true;
    var map={};
    map[path]= Infinity;
    pullMap('', map, false, false, function() {
      busy=false;
      cb();
    });
  }
  return {
    syncNow: syncNow,
    getState : getState
  };
});
