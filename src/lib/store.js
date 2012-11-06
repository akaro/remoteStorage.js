define(['./util', './platform'], function (util, platform, localStorageAdapter) {

  "use strict";

  /*
    Methods that should return promises
      - getNode
      - forget
      - forgetAll
      - setNodeData
      - getNodeData
      - setNodeAccess
      - setNodeForce
      - clearDiff
      - determineDirTimestamp
      - updateNode
   */

  // Namespace: store
  //
  // The store stores data locally. It treats all data as raw nodes, that have *metadata* and *payload*.
  // Metadata and payload are stored under separate keys.


  var logger = util.getLogger('store');

  // foreign nodes are prefixed with a user address
  var userAddressRE = /^[^@]+@[^:]+:\//;

  var events = util.getEventEmitter('error', 'change', 'foreign-change');

  var dataStore = null;

  // Method: setAdapter
  // Set the storage adapter. See <StorageAdapter> for a description of
  // the required interface.
  function setAdapter(adapter) {
    dataStore = adapter;
    // forward changes from data store (e.g. made in other tabs)  
    dataStore.on('change', function(event) {
      if(! util.isDir(event.path)) {
        fireChange('device', event.path, event.oldValue);
      }
    });
  }

  //
  // Type: Node
  //
  // Represents a node within the local store.
  //
  // Properties:
  //   startAccess - either "r" or "rw". Flag means, that this node has been claimed access on (see <remoteStorage.claimAccess>) (default: null)
  //   startForce  - boolean flag to indicate that this node shall always be synced. (see <BaseClient.use> and <BaseClient.release>) (default: null)
  //   timestamp   - last time this node was (apparently) updated (default: 0)
  //   lastUpdatedAt - Last time this node was upated from remotestorage
  //   mimeType    - MIME media type
  //   diff        - (directories only) marks children that have been modified.
  //

  // Event: change
  // See <BaseClient.Events>

  function fireChange(origin, path, oldValue) {
    return getNode(path).
      get('data', 'timestamp').
      then(function(newValue, timestamp) {
        events.emit('change', {
          path: path,
          origin: origin,
          oldValue: oldValue,
          newValue: newValue,
          timestamp: timestamp
        });
      });
  }

  // Event: foreign-change
  // Fired when a foreign node is updated.

  function fireForeignChange(path, oldValue) {
    return getNode(path).
      get('data', 'timestamp').
      then(function(newValue, timestamp) {
        events.emit('foreign-change', {
          path: path,
          oldValue: oldValue,
          newValue: newValue,
          timestamp: timestamp
        });
      });
  }
  
  //
  // Event: error
  // See <BaseClient.Events>

  //
  // Method: on
  //
  // Install an event handler
  // See <util.EventEmitter.on> for documentation.

  // Method: getNode
  // Get a node.
  //
  // Parameters:
  //   path - absolute path
  //
  // Returns:
  //   a node object. If no node is found at the given path, a new empty
  //   node object is constructed instead.
  function getNode(path) {
    if(! path) {
      // FIXME: fail returned promise instead.
      throw new Error("No path given!");
    }
    validPath(path);
    return dataStore.get(path).then(function(node) {
      if(! node) {
        node = {//this is what an empty node looks like
          startAccess: null,
          startForce: null,
          startForceTree: null,
          timestamp: 0,
          lastUpdatedAt: 0,
          mimeType: "application/json"
        };
        if(util.isDir(path)) {
          node.diff = {};
          node.data = {};
        }
      } else {
        if(node.mimeType == 'application/json') {
          node.data = JSON.parse(node.data);
        }
      }
      return node;
    });
  }


  // Method: forget
  // Forget node at given path
  //
  // Parameters:
  //   path - absolute path
  function forget(path) {
    validPath(path);
    return dataStore.remove(path);
  }

  // Method: forgetAll
  // Forget all data stored by <store>.
  //
  function forgetAll() {
    return dataStore.forgetAll();
  }

  // Function: setNodeData
  //
  // update a node's payload
  //
  // Parameters:
  //   path      - absolute path from the storage root
  //   data      - node data to set, or undefined to delete the node
  //   outgoing  - boolean, whether this update is to be propagated
  //   timestamp - timestamp to set for the update
  //   mimeType  - MIME media type of the node's data
  //
  // Fires:
  //   change w/ origin=remote - unless this is an outgoing change
  //
  function setNodeData(path, data, outgoing, timestamp, mimeType) {
    logger.debug('PUT', path, { data: data, mimeType: mimeType });
    return getNode(path).then(function(node) {
      if(! outgoing) {
        if(typeof(timestamp) !== 'number') {
          throw "Attempted to set non-number timestamp in incoming change: " + timestamp + ' (' + typeof(timestamp) + ')';
        }
        node.lastUpdatedAt = timestamp;
      }
      
      if(! mimeType) {
        mimeType = 'application/json';
      }
      node.mimeType = mimeType;

      if(typeof(node.data) == 'object' && node.data instanceof ArrayBuffer) {
        metadata.binary = true;
        node.data = util.encodeBinary(node.data);
      } else {
        metadata.binary = false;
      }

      return updateNode(path, (node.data ? node : undefined), outgoing, false, timestamp, oldValue);
    });
  }

  // Method: getNodeData
  // get a node's data
  //
  // Parameters:
  //   path - absolute path
  //   raw  - (optional) don't attempt to unpack JSON data
  //
  function getNodeData(path, raw) {
    logger.debug('GET', path);
    validPath(path);

    return getNode(path, function(node) {
      var data = node.data;
      if(data) {
        if(node.binary) {
          data = util.decodeBinary(node.data);
        } else if((!raw) && (node.mimeType == "application/json")) {
          try {
            data = JSON.parse(node.data);
          } catch(exc) {
            events.emit('error', "Invalid JSON node at " + path + ": " + node.data);
          }
        }
      }
      return data;
    });
  }

  function removeNode(path, timestamp) {
    return setNodeData(path, undefined, false, timestamp || getCurrTimestamp());
  }

  function updateMetadata(path, attributes, node) {
    function doUpdate(node) {
      util.extend(node, attributes);
      return updateNode(path, node, false, true);
    }
    if(node) {
      return doUpdate(node);
    } else {
      return getNode(path).then(doUpdate);
    }
  }

  // Method: setNodeAccess
  //
  // Set startAccess flag on a node.
  //
  // Parameters:
  //   path  - absolute path to the node
  //   claim - claim to set. Either "r" or "rw"
  //
  function setNodeAccess(path, claim) {
    return getNode(path).then(function(node) {
      if((claim !== node.startAccess) &&
         (claim === 'rw' || node.startAccess === null)) {
        return updateMetadata(path, {
          startAccess: claim
        }, node);
      }
    });
  }

  // Method: setNodeForce
  //
  // Set startForce and startForceTree flags on a node.
  //
  // Parameters:
  //   path      - absolute path to the node
  //   dataFlag  - whether to sync data
  //   treeFlag  - whether to sync the tree
  //
  function setNodeForce(path, dataFlag, treeFlag) {
    return updateMetadata(path, {
      startForce: dataFlag,
      startForceTree: treeFrag
    });
  }

  // Method: clearDiff
  //
  // Clear diff flag of given node on it's parent.
  //
  // Recurses upwards, when the parent's diff becomes empty.
  //
  // Clearing the diff is usually done, once the changes have been
  // propagated through sync.
  //
  // Parameters:
  //   path      - absolute path to the node
  //   timestamp - new timestamp (received from remote) to set on the node.
  //
  function clearDiff(path, timestamp) {
    logger.debug('clearDiff', path);
    return getNode(path).then(function(node) {

      function clearDiffOnParent() {
        var parentPath = util.containingDir(path);
        if(parentPath) {
          var baseName = util.baseName(path);
          return getNode(parentPath).then(function(parent) {
            delete parent.diff[baseName];
            return updateNode(parentPath, parent, false, true).then(function() {
              if(Object.keys(parent.diff).length === 0) {
                return clearDiff(parentPath, timestamp, callback);
              }
            });
          });
        }
      }

      if(util.isDir(path) && Object.keys(node.data).length === 0 &&
         !(node.startAccess || node.startForce || node.startForceTree)) {
        // remove empty dir
        return updateNode(path, undefined, false, false).then(clearDiffOnParent);
      } else if(timestamp) {
        // set last updated
        node.timestamp = node.lastUpdatedAt = timestamp;
        return updateNode(path, node, false, true).then(clearDiffOnParent);
      } else {
        return clearDiffOnParent();
      }
    });
  }

  // Method: fireInitialEvents
  //
  // Fire a change event with origin=device for each node present in store.
  //
  // This is so apps don't need to add event handlers *and* initially request
  // listings to fill their views.
  //
  function fireInitialEvents() {
    logger.info('fire initial events');

    function iter(path) {
      if(util.isDir(path)) {
        return getNode(path).then(function(node) {
          if(node.data) {
            var keys = Object.keys(node.data);
            var next = function() {
              if(keys.length > 0) {
                return iter(path + keys.shift()).then(next);
              }
            }
            return next();
          }
        });
      } else {
        return fireChange('device', path);
      }
    }

    return iter('/');
  }

  function getFileName(path) {
    var parts = path.split('/');
    if(util.isDir(path)) {
      return parts[parts.length-2]+'/';
    } else {
      return parts[parts.length-1];
    }
  }

  function getCurrTimestamp() {
    return new Date().getTime();
  }

  function validPath(path) {
    if(! (path[0] == '/' || userAddressRE.test(path))) {
      throw new Error("Invalid path: " + path);
    }
  }

  function isForeign(path) {
    return path[0] != '/';
  }

  function determineDirTimestamp(path) {
    return getNode(path).
      get('data').then(function(data) {
        var t = 0;
        if(data) {
          for(var key in data) {
            if(data[key] > t) {
              t = data[key];
            }
          }
        }
        return t > 0 ? t : getCurrTimestamp();
      });
  }

  // FIXME: this argument list is getting too long!!!
  function updateNode(path, node, outgoing, meta, timestamp, oldValue) {
    validPath(path);

    function adjustTimestamp() {
      function setTimestamp(t) {
        if(t) { timestamp = t };
        if(node && typeof(timestamp) == 'number') {
          node.timestamp = timestamp;
        }
      }
      var promise = util.getPromise();
      if((!meta) && (! timestamp)) {
        if(outgoing) {
          timestamp = getCurrTimestamp();
          setTimestamp();
          return promise.fulfillLater();
        } else if(util.isDir(path)) {
          return determineDirTimestamp(path).then(setTimestamp);
        } else {
          return promise.failLater(new Error('no timestamp given for node ' + path));
        }
      }
    }

    function storeNode() {
      if(node) {
        return dataStore.remove(path);
      } else {
        return dataStore.set(path, node);
      }
    }

    function updateParent() {
      var parentPath = util.containingDir(path);
      var baseName = util.baseName(path);
      if(parentPath) {
        return getNode(parentPath).
          then(function(parent) {
            if(meta) { // META
              if(! parent.data[baseName]) {
                parent.data[baseName] = 0;
                return updateNode(parentPath, parent, false, true, timestamp);
              }
            } else if(outgoing) { // OUTGOING
              if(node) {
                parent.data[baseName] = timestamp;
              } else {
                delete parent.data[baseName];
              }
              parent.diff[baseName] = timestamp;
              return updateNode(parentPath, parent, false, false, timestamp);
            } else { // INCOMING
              if(node) { // add or change
                if((! parent.data[baseName]) || parent.data[baseName] < timestamp) {
                  parent.data[baseName] = timestamp;
                  delete parent.diff[baseName];
                  return updateNode(parentPath, parent, false, false, timestamp);
                }
              } else { // deletion
                delete parent.data[baseName];
                delete parent.diff[baseName];
                return updateNode(parentPath, parent, false, false, timestamp);
              }
            }
          });
      }
    }

    function fireEvents() {
      if((! outgoing) && (! util.isDir(path))) {
        // fire changes
        if(isForeign(path)) {
          return fireForeignChange(path, oldValue);
        } else {
          return fireChange('remote', path, oldValue);
        }
      }
    }

    return adjustTimestamp().
      then(storeNode).
      then(updateParent).
      then(fireEvents);
  }

  return {
    
    events: events,

    // method         , local              , used by
                                           
    getNode           : getNode,          // sync
    getNodeData       : getNodeData,      // sync
    setNodeData       : setNodeData,      // sync
    clearDiff         : clearDiff,        // sync
    removeNode        : removeNode,       // sync

    on                : events.on,
    setNodeAccess     : setNodeAccess,
    setNodeForce      : setNodeForce,
    forget            : forget,
    
    forgetAll         : forgetAll,        // widget
    fireInitialEvents : fireInitialEvents,// widget

    setAdapter        : setAdapter
  };

  // Interface: StorageAdapter
  //
  // Backend for the <store>.
  //
  // Currently supported:
  // * memory
  // * localStorage
  //
  // Planned:
  // * indexedDB
  // * WebSQL
  //
  // Method: get(path)
  // Get node metadata and payload for given path
  // Returns a promise.
  //
  // Method: set(path, metadata, payload)
  // Set node metadata and payload for given path
  // Returns a promise.
  //
  // Method: remove(path)
  // Remove node metadata and payload for given path
  // Returns a promise.
  //
  // Method: forgetAll()
  // Remove all data.
  // Returns a promise.
  //
  // Method: on(eventName)
  // Install an event handler.
  //
  // Event: change
  // Fired when the store changes from another source (such as another tab / window).
  //
  // Event: ready
  // Fired when the store is ready.
  //

});
