angular.module('adage.heatmap.service', [
  'adage.sample.service',
  'adage.activity.service',
  'adage.utils'
])

.factory('Heatmap', ['$log', '$q', 'Sample', 'Activity', 'errGen',
  function($log, $q, Sample, Activity, errGen) {
    var Heatmap = {
      mlmodel: {
        id: undefined
      },
      vegaData: {
        samples: [],  // only samples with activity data can be in the heatmap
        signatureOrder: []
      },
      samplesMissingActivity: [],

      init: function(mlModelId, samples) {
        this.mlmodel = {
          id: mlModelId
        };
        this.vegaData = {
          samples: angular.copy(samples),
          signatureOrder: []
        };
      },

      loadData: function() {
        // retrieve activity data for heatmap to display
        if (!this.mlmodel.id) {
          $log.warn('Heatmap.loadData called before setting mlmodel');
          return;
        }
        if (!this.vegaData.samples) {
          $log.warn('Heatmap.loadData called before setting sample list');
          return;
        }
        var promises = [];
        promises.push(this.loadSampleObjects());
        promises.push(this.rebuildHeatmapActivity());
        return $q.all(promises);
      },

      loadSampleObjects: function() {
        return Sample.getSampleListPromise(this.vegaData.samples)
          .then(function(sampleList) {
            Heatmap.vegaData.sampleObjects = sampleList;
          }).catch(function(errObject) {
            $log.warn('Heatmap.loadSampleObjects error:', errObject);
          });
      },
      getSampleActivity: function() {
        // reformat data from vegaData.activity to a form that can be used
        // by hcluster.js: need a separate array of objects for each sample
        return this.vegaData.samples.map(function(val) {
          var sampleObject = Sample.getCached(val);
          if (!sampleObject) {
            // we haven't yet loaded full sample data so yield a stubby version
            return {id: val};
          }
          sampleObject.activity = Activity.getCache(Heatmap.mlmodel.id, val)
            .map(
              // distill .activity to an array of just "value"s
              function(val) {
                return val.value;
              }
            );
          return sampleObject;
        });
      },
      getSignatureObjects: function() {
        // The vegaData.activity array organizes activity data in a
        // representation convenient to render using vega.js: each element of
        // the array corresponds to one mark on the heatmap. For clustering by
        // hcluster.js, on the other hand, we need to reorganize the data so
        // that all activity for each *signature* is collected in an array. The
        // result is essentially the same as that from `getSampleActivity`
        // above, but transposed. We achieve this without too many intermediate
        // steps via two nested Array.prototype.map() operations:

        // (1) first, we obtain a list of signatures by retrieving signature
        //     activity for the first sample in our heatmap
        var firstSampleSignatures = Activity.getCache(
          Heatmap.mlmodel.id,
          this.vegaData.samples[0]
        );
        // (2a) next, we build a new array (`retval`) comprised of
        //      `signatureObject`s by walking through the
        //      `firstSampleSignatures` and constructing a `signatureObject`
        //      for each. [outer .map()]
        var retval = firstSampleSignatures.map(function(val, index) {
          var signatureObject = {
            'id': val.signature,
            'activity': Heatmap.vegaData.samples.map(
              // (2b) the array of activity for each signature is built by
              //      plucking the activity `.value` for each sample within the
              //      `index`th signature from `Activity.cache` [inner .map()]
              function(sampleId) {
                var cachedActivity = Activity.getCache(
                  Heatmap.mlmodel.id,
                  sampleId
                );
                if (cachedActivity[index].signature !== val.signature) {
                  // ensure we're pulling out the right signature
                  $log.error(
                    'getSignatureObjects: signature IDs do not match. First ' +
                    ' sample = ', val, ', but sample ' + sampleId + ' =',
                    cachedActivity[index]
                  );
                }
                return cachedActivity[index].value;
              }
            )
          };
          return signatureObject;
        });

        // (3) the two nested .map()s are all we need to do to organize the
        //     data for the convenience of hcluster.js, so we're done
        return retval;
      },

      logError: function(httpResponse) {
        $log.error(errGen('Query errored', httpResponse));
      },
      rebuildHeatmapActivity: function() {
        if (!this.mlmodel.id) {
          // ignore "rebuild" requests until a model is specified
          $log.info(
            'rebuildHeatmapActivity: skipping because mlmodel=', this.mlmodel
          );
          return;
        }
        if (!this.vegaData.samples) {
          $log.warn('Heatmap.loadData called before setting sample list');
          return;
        }
        var updateHeatmapActivity = function() {
          // when all promises are fulfilled, we can update vegaData
          var newActivity = [];
          var excludeSamples = [];

          Heatmap.vegaData.samples.forEach(function(sampleID) {
            var sampleActivity = Activity.getCache(
              Heatmap.mlmodel.id,
              sampleID
            );
            if (sampleActivity === undefined) {
              // this sample has no activity data, so move it out of the heatmap
              $log.error(
                'updateHeatmapActivity: no activity for sample id', sampleID
              );
              excludeSamples.push(sampleID);
            } else {
              newActivity = newActivity.concat(sampleActivity);
              // re-initialize signatureOrder, if needed
              if (Heatmap.vegaData.signatureOrder.length === 0) {
                Heatmap.vegaData.signatureOrder = sampleActivity.map(
                  function(val) {
                    return val.signature;
                  }
                );
              }
            }
          });
          excludeSamples.forEach(function(id) {
            // remove from the heatmap
            pos = Heatmap.vegaData.samples.indexOf(id);
            Heatmap.vegaData.samples.splice(pos, 1);

            // add to the non-heatmap list if not already present
            if (Heatmap.samplesMissingActivity.indexOf(id) === -1) {
              Heatmap.samplesMissingActivity.push(id);
            }
          });
          Heatmap.vegaData.activity = newActivity;
        };

        // preflight the cache and request anything missing
        var activityPromises = Activity.getForSampleList(
          Heatmap.mlmodel.id,
          Heatmap.vegaData.samples
        );
        // when the cache is ready, update the heatmap activity data
        return $q.all(activityPromises)
          .then(updateHeatmapActivity)
          .catch(this.logError);
      },

      _getIDs: function(val) {
        return val.id;
      },
      clusterSamples: function() {
        // our callbacks will need this closure defined here
        var defer = $q.defer();

        setTimeout(function() {
          // We'd like the clustering code to run asynchronously so our caller
          // can display a status update and then remove it when finished.
          // setTimeout(fn, 0) is a trick for triggering this behavior
          defer.resolve(true);  // triggers the cascade of .then() calls below
        }, 0);

        return defer.promise.then(function() {
          // do the actual clustering (in the .data call here)
          var sampleClust = hcluster()
            .distance('euclidean')
            .linkage('avg')
            .posKey('activity')
            .data(Heatmap.getSampleActivity());
          Heatmap.vegaData.samples = sampleClust.orderedNodes().map(
            Heatmap._getIDs
          );
        });
      },
      clusterSignatures: function() {
        // our callbacks will need this closure defined here
        var defer = $q.defer();

        setTimeout(function() {
          // Using the setTimeout(fn, 0) trick as described above
          defer.resolve(true);  // triggers the cascade of .then() calls below
        }, 0);

        return defer.promise.then(function() {
          // do the actual clustering (in the .data call here)
          var signatureClust = hcluster()
            .distance('euclidean')
            .linkage('avg')
            .posKey('activity')
            .data(Heatmap.getSignatureObjects());
          // update the heatmap
          Heatmap.vegaData.signatureOrder =
            signatureClust.orderedNodes().map(Heatmap._getIDs);
        });
      }
    };
    return Heatmap;
  }
])

;
