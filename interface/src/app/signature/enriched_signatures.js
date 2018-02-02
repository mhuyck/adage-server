/**
 * "adage.enrichedSignatures" module.
 */

angular.module('adage.enrichedSignatures', [
  'adage.signature.resources',
  'adage.participation.resources',
  'adage.gene.resource',
  'adage.utils',
  'greenelab.stats'
])

.config(['$stateProvider', function($stateProvider) {
  $stateProvider.state('enriched_signatures', {
    url: '/signature/enriched_signatures?mlmodel&genes',
    views: {
      main: {
        templateUrl: 'signature/enriched_signatures.tpl.html',
        controller: 'EnrichedSignaturesCtrl as ctrl'
      }
    },
    data: {pageTitle: 'Enriched Signatures'}
  });
}])

.controller('EnrichedSignaturesCtrl', ['$stateParams', 'Signature', '$q',
  '$log', 'errGen', 'Participation', 'MathFuncts', 'Gene',
  function EnrichedSignatureController($stateParams, Signature, $q, $log,
    errGen, Participation, MathFuncts, Gene) {
    var self = this;
    self.isValidModel = false;
    // Do nothing if the model ID in URL is falsey. The error will be taken
    // care of by "<ml-model-validator>" component.
    if (!$stateParams.mlmodel) {
      return;
    }

    self.modelInUrl = $stateParams.mlmodel;
    self.statusMessage = 'Connecting to the server ...';
    self.pValueCutoff = 0.05;
    self.enrichedSignatures = [];

    // Do nothing if no genes are specified in URL.
    if (!$stateParams.genes || !$stateParams.genes.split(',').length) {
      self.statusMessage = 'No genes are specified.';
      self.enrichedSignatures = [];
      return;
    }

    var genesInUrl = [];
    $stateParams.genes.split(',').forEach(function(token) {
      var id = parseInt(token);
      if (!isNaN(id) && genesInUrl.indexOf(id) === -1) {
        genesInUrl.push(id);
      }
    });

    // Promise that gets all signatures of given mlmodel in URL:
    var p1 = Signature.get(
      {mlmodel: self.modelInUrl, limit: 0},
      function success(response) {
        self.signatures = Object.create(null);
        response.objects.forEach(function(element) {
          self.signatures[element.id] = element.name;
        });
      },
      function error(err) {
        var message = errGen('Failed to get signatures: ', err);
        $log.error(message);
        self.statusMessage = message + '. Please try again later.';
      }
    ).$promise;

    // Promise that gets the total number of genes:
    var p2 = Gene.get(
      {},
      function success(response) {
        self.geneNum = response.meta.total_count;
      },
      function error(err) {
        var message = errGen('Failed to get total gene number: ', err);
        $log.error(message);
        self.statusMessage = message + '. Please try again later.';
      }
    ).$promise;

    var participations;
    // Promise that gets all participation records that are related to
    // the genes in URL:
    var p3 = Participation.get(
      {'related_genes': $stateParams.genes, 'limit': 0},
      function success(response) {
        participations = response.objects;
      },
      function error(err) {
        var message = errGen(
          'Failed to get signature-gene participations: ', err);
        $log.error(message);
        self.statusMessage = message + '. Please try again later.';
      }
    ).$promise;

    var pValueSigDigits = 3;
    // groupedGenes is an object that behaves like a 2-D table of genes.
    // groupedGenes[participationTypeID][signatureID] is an object whose
    // keys are IDs and values are names of those genes that participate
    // with signatureID and with participationTypeID.
    var groupedGenes = Object.create(null);

    // Helper function that calculates the enrichment for each signature
    // that includes at least one gene in the url.
    var calculateEnrichments = function(typeName, genesBySignatures) {
      var m = genesInUrl.length;
      var N = self.geneNum;
      var pValueArray = [];
      var matchedGenesBySignature = [];
      var signatures = Object.keys(genesBySignatures);
      signatures.forEach(function(signatureID) {
        var genes = genesBySignatures[signatureID];
        var n = Object.keys(genes).length, k = 0;
        var matchedGenes = [], selectedGene;
        var pValue;
        for (var i = 0; i < genesInUrl.length; i++) {
          selectedGene = genesInUrl[i];
          if (genes[selectedGene]) {
            k++;
            matchedGenes.push(genes[selectedGene]);
          }
        }
        matchedGenesBySignature.push(matchedGenes);
        pValue = 1 - MathFuncts.hyperGeometricTest(k, m, n, N);
        pValueArray.push(pValue);
      });

      var significantSignatures = [];
      var correctedPValues = MathFuncts.multTest.fdr(pValueArray);
      correctedPValues.forEach(function(element, index) {
        var correctedPValue = element.toPrecision(pValueSigDigits);
        if (correctedPValue < self.pValueCutoff) {
          var signatureID = signatures[index];
          significantSignatures.push({
            'url': '#/signature/' + signatureID,
            'name': self.signatures[signatureID],
            'participationType': typeName,
            'genes': matchedGenesBySignature[index].join(', '),
            'pValue': correctedPValue
          });
        }
      });

      significantSignatures.sort(function(a, b) {
        return a.pValue - b.pValue;
      });

      return significantSignatures;
    };

    // Main function to calculate the enrichment.
    var getEnrichedSignatures = function() {
      var i, j, typeName, signatureID;
      for (i = 0; i < participations.length; i++) {
        signatureID = participations[i].signature;
        // Ignore signatures that are not in current mlmodel
        if (!self.signatures[signatureID]) {
          continue;
        }

        typeName = participations[i].participation_type.name;
        if (!groupedGenes[typeName]) {
          groupedGenes[typeName] = Object.create(null);
        }

        if (!groupedGenes[typeName][signatureID]) {
          groupedGenes[typeName][signatureID] = Object.create(null);
        }
        geneID = participations[i].gene.id;
        geneName = (participations[i].gene.standard_name ?
                    participations[i].gene.standard_name :
                    participations[i].gene.systematic_name);
        groupedGenes[typeName][signatureID][geneID] = geneName;
      }

      var participationTypes = Object.keys(groupedGenes);
      var genesBySignatures, enrichment;
      for (i = 0; i < participationTypes.length; i++) {
        typeName = participationTypes[i];
        genesBySignatures = groupedGenes[typeName];
        enrichment = calculateEnrichments(typeName, genesBySignatures);
        for (j = 0; j < enrichment.length; j++) {
          self.enrichedSignatures.push(enrichment[j]);
        }
      }
      self.statusMessage = '';
    };

    // Wait for the previous wo promises to finish before calculating
    // the enriched signatures.
    $q.all([p1, p2, p3]).then(getEnrichedSignatures);
  }
])
;
