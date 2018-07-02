angular.module('adage.activity.service', [
  'ngResource',
  'adage.utils'
])

.factory('Activity', ['$cacheFactory', '$resource', '$q', '$log', 'ApiBasePath',
  function($cacheFactory, $resource, $q, $log, ApiBasePath) {
    var Activity = $resource(ApiBasePath + 'activity');

    Activity.cache = $cacheFactory('activity');

    var loadCache = function(responseObject) {
      if (responseObject && responseObject.objects.length > 0) {
        var sampleID = responseObject.objects[0].sample;
        $log.info('response[0]', responseObject.objects[0]);
        Activity.cache.put(sampleID, responseObject.objects);
        $log.info('populating cache with ' + sampleID);
      }
      // Note: no else clause here on purpose.
      // An empty responseObject means no activity data for this sample.
      // We detect this error and handle it in updateHeatmapActivity.
    };

    Activity.getForSample = function(mlmodel, sampleID) {
      return $q(function(resolve, reject) {
        var sampleActivity = Activity.cache.get(sampleID);
        if (!!sampleActivity) {
          resolve(sampleActivity);
        } else {
          $log.info('cache miss for ' + sampleID);
          // cache miss, so populate the entry
          Activity.get({
            'mlmodel': mlmodel,
            'sample': sampleID,
            'order_by': 'signature'
          }).$promise
            .then(loadCache)
            .then(function() {
              resolve(Activity.cache.get(sampleID));
            })
            .catch(function(httpResponse) {
              reject(httpResponse);
            });
        }
      });
    };


    Activity.listSamplesNotCached = function(sampleList) {
      var notCached = [];
      sampleList.forEach(function(sampleID) {
        if (!Activity.cache.get(sampleID)) {
          notCached.push(sampleID);
        }
      });
      return notCached;
    };

    return Activity;
  }
])

;
