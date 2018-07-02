angular.module('adage.activity.service', [
  'ngResource',
  'adage.utils'
])

.factory('Activity', ['$cacheFactory', '$resource', '$q', '$log', 'ApiBasePath',
  function($cacheFactory, $resource, $q, $log, ApiBasePath) {
    var Activity = $resource(ApiBasePath + 'activity');

    Activity.cache = $cacheFactory('activity');

    Activity.putCache = function(mlmodelID, sampleID, value) {
      var cacheID = '' + mlmodelID + '-' + sampleID;
      Activity.cache.put(cacheID, value);
      $log.info('populating cache with ' + sampleID);
      return value;
    };
    Activity.getCache = function(mlmodelID, sampleID) {
      var cacheID = '' + mlmodelID + '-' + sampleID;
      return Activity.cache.get(cacheID);
    };

    Activity.getForSample = function(mlmodelID, sampleID) {
      return $q(function(resolve, reject) {
        var sampleActivity = Activity.getCache(mlmodelID, sampleID);
        if (!!sampleActivity) {
          resolve(sampleActivity);
        } else {
          $log.info('cache miss for ' + sampleID);
          // cache miss, so populate the entry
          Activity.get({
            'mlmodel': mlmodelID,
            'sample': sampleID,
            'order_by': 'signature'
          }).$promise
            .then(function(responseObject) {
              if (responseObject && responseObject.objects.length > 0) {
                Activity.putCache(mlmodelID, sampleID, responseObject.objects);
              }
              // Note: no else clause here on purpose.
              // An empty responseObject means no activity data for this sample.
              // We detect this error and handle it in updateHeatmapActivity.
            })
            .then(function() {
              resolve(Activity.getCache(mlmodelID, sampleID));
            })
            .catch(function(httpResponse) {
              reject(httpResponse);
            });
        }
      });
    };

    Activity.listSamplesNotCached = function(mlmodelID, sampleList) {
      var notCached = [];
      sampleList.forEach(function(sampleID) {
        if (!Activity.getCache(mlmodelID, sampleID)) {
          notCached.push(sampleID);
        }
      });
      return notCached;
    };

    return Activity;
  }
])

;
