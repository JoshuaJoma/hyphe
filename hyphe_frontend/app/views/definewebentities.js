'use strict';

angular.module('hyphe.definewebentitiesController', [])

  .controller('DefineWebEntities', ['$scope', 'store', 'utils', 'api', 'QueriesBatcher', '$location', 'PrefixConflictsIndex', 'corpus'
  ,function($scope, store, utils, api, QueriesBatcher, $location, PrefixConflictsIndex, corpus) {
    $scope.currentPage = 'definewebentities'
    $scope.Page.setTitle('Define Web Entities')
    $scope.corpusName = corpus.getName()
    $scope.corpusId = corpus.getId()

    $scope.list = []
    $scope.list_byId = {}
    
    $scope.activeRow = 0
    
    $scope.paginationPage = 1
    $scope.paginationLength = 50    // How many items per page
    $scope.paginationNumPages = 10  // How many pages to display in the pagination

    $scope.createdList = []
    $scope.existingList = []
    $scope.conflictedList = []
    $scope.errorList = []
    
    $scope.retry = false
    $scope.creating = false
    $scope.loadingWebentities = false
    $scope.simulatingCreationRules = false
    $scope.crawlExisting = false
    $scope.retryConflicted = true

    var orderableUrl = function(url){
      return url.replace(/^https?:\/\/((www\d?|m(obile)?).)?/i, '')
    }

    // Build the basic list of web entities
    var list
    if(store.get('parsedUrls_type') == 'list'){
      list = store.get('parsedUrls')
        .sort(function(a, b){
          return orderableUrl(a).localeCompare(orderableUrl(b) || a.localeCompare(b))
        })
        .map(function(url, i){
          return {
              id: i
              ,url: url
            }
        })
    } else if(store.get('parsedUrls_type') == 'table') {
      var settings = store.get('parsedUrls_settings')
      ,table = store.get('parsedUrls')
      
      // Table headline
      $scope.headline = table.shift().filter(function(d,i){return i != settings.urlColId})
      
      list = table.map(function(row, i){
        var meta = {}
        table[0].forEach(function(colName,j){
          if(j != settings.urlColId)
            meta[colName] = row[j]
        })
        return {
          id:i
          ,url:row[settings.urlColId]
          ,row:row.filter(function(d,i){return i != settings.urlColId})
          ,meta:meta
        }
      })
    }

    if(!list || !list.length){
      $location.path('/project/'+$scope.corpusId+'/importurls')
    }

    // Clean store
    store.remove('parsedUrls')
    store.remove('parsedUrls_type')
    store.remove('parsedUrls_settings')

    // Build the list
    bootstrapUrlList(list)

    // Fetching parent web entities
    var fetchParentWebEntities = function(){
      $scope.loadingWebentities = true
      var queriesBatcher = new QueriesBatcher()
      $scope.list.forEach(function(obj){
        queriesBatcher.addQuery(
            api.getLruParentWebentities             // Query call
            ,{lru: obj.lru}                         // Query settings
            ,function(webentities){                 // Success callback
                obj.parentWebEntities = webentities
                obj.status = 'loaded'
              }
            ,function(data, status, headers){       // Fail callback
                obj.status = 'error'
                console.log('[row '+(obj.id+1)+'] Error while fetching parent webentities for', obj.url, data, 'status', status, 'headers', headers)
                if(data && data[0] && data[0].code == 'fail'){
                  obj.infoMessage = data[0].message
                }
              }
            ,{                                      // Options
                label: obj.lru
                ,before: function(){
                    obj.status = 'pending'
                  }
              }
          )
      })

      queriesBatcher.atEachFetch(function(list,pending,success,fail){
        var summary = {
          total: list.length + pending.length + success.length + fail.length
          ,pending: pending.length
          ,loaded: success.length + fail.length
        }
        ,percent = Math.round((summary.loaded / summary.total) * 100)
        ,percent_pending = Math.round((summary.pending / summary.total) * 100)
        ,msg = percent + '% loaded'
        $scope.status = {message: msg, progress:percent, progressPending:percent_pending}
      })

      queriesBatcher.atFinalization(function(list,pending,success,fail){
        $scope.loadingWebentities = false
        $scope.status = {}
      })

      queriesBatcher.run()
    }

    // Slider commands
    $scope.moveAllSliders = function (mode) {
      switch (mode) {
        case 'left':
          $scope.list.forEach(function (obj) {
            var lruLength = obj.lru.split('|').length
            if (lruLength > 3) {
              var offset = obj.prefixLength - 3

              if (offset !== 0) {
                if($scope.conflictsIndex)
                  $scope.conflictsIndex.removeFromLruIndex(obj)

                obj.prefixLength -= offset
                obj.truePrefixLength -= offset
                updateNameAndStatus(obj)

                if($scope.conflictsIndex)
                  $scope.conflictsIndex.addToLruIndex(obj)
              }
            }
          })
          break

        case 'right':
          $scope.list.forEach(function (obj) {
            var lruLength = obj.lru.split('|').length
            if (lruLength > 3) {
              var offset = lruLength - obj.truePrefixLength - 1

              if (offset !== 0) {
                if($scope.conflictsIndex)
                  $scope.conflictsIndex.removeFromLruIndex(obj)

                obj.prefixLength += offset
                obj.truePrefixLength += offset
                updateNameAndStatus(obj)

                if($scope.conflictsIndex)
                  $scope.conflictsIndex.addToLruIndex(obj)
              }
            }
          })
          break
      }

      // FIXME: factor this function with the similar one in hyphePrefixSlider directive
      function updateNameAndStatus(obj) {
        obj.truePrefixLength = obj.prefixLength - 1 + obj.tldLength
        var webentityFound
        obj.parentWebEntities.forEach(function(we){
          if(!webentityFound && we.stems_count == obj.truePrefixLength){
            webentityFound = we
          }
        })
        if(webentityFound){
          obj.name = webentityFound.name
          obj.statusText = 'Already exists'
          obj.WEstatus = 'exists'
        } else {
          obj.name = utils.nameLRU(utils.LRU_truncate(obj.lru, obj.truePrefixLength + !obj.tldLength))
          obj.statusText = 'New'
          obj.WEstatus = 'new'
        }
      }
    }

    // Create web entities
    $scope.createWebEntities = function(){
      $scope.creating = true
      $scope.retry = false
      $scope.status = {message:'Creating web entities'}

      // Keep track of created web entity prefixes
      var createdPrefixes = {}

      // Mark all "existing"
      $scope.list.forEach(function(obj){
          var webentityFound
          (obj.parentWebEntities || []).forEach(function(we){
            if(!webentityFound && we.stems_count == obj.truePrefixLength){
              webentityFound = we
            }
          })
          if(webentityFound){
            obj.status = 'existing'
            obj.webentity = webentityFound
          }
        })

      // Query the rest
      var queriesBatcher = new QueriesBatcher()
      $scope.list
        .filter(function(obj){
            var webentityFound
            (obj.parentWebEntities || []).forEach(function(we){
              if(!webentityFound && we.stems_count == obj.truePrefixLength){
                webentityFound = we
              }
            })
            return obj.status == 'loaded' && webentityFound === undefined
          })
        .forEach(function(obj){
          // Stack the query
          queriesBatcher.addQuery(
              api.declareWebentity                  // Query call
              ,function(){                          // Query settings as a function
                  // Compute prefix variations
                  obj.prefixes = utils.LRU_variations(utils.LRU_truncate(obj.lru, obj.truePrefixLength), {
                    wwwlessVariations: true
                    ,wwwVariations: true
                    ,httpVariations: true
                    ,httpsVariations: true
                    ,smallerVariations: false
                  })

                  if(obj.prefixes.some(function(lru){
                    return createdPrefixes[lru]
                  })){
                    obj.status = 'conflict'
                    obj.prefixes.forEach(function(lru){
                      createdPrefixes[lru] = obj.id
                    })
                    return {_API_ABORT_QUERY:true}
                  }
                  obj.prefixes.forEach(function(lru){
                    createdPrefixes[lru] = obj.id
                  })

                  return {
                    prefixes: obj.prefixes
                    ,name: utils.nameLRU(utils.LRU_truncate(obj.lru, obj.truePrefixLength + !obj.tldLength))
                    ,startPages: [obj.url]
                  }
                }
              ,function(we){                        // Success callback
                  obj.status = 'created'
                  obj.webentity = we
                }
              ,function(data, status, headers){     // Fail callback
                  obj.status = 'error'
                  console.log('[row '+(obj.id+1)+'] Error while declaring webentity for', obj.lru, data, 'status', status, 'headers', headers)
                  if(data && data[0] && data[0].code == 'fail'){
                    obj.infoMessage = data[0].message
                  }
                }
              ,{                                    // Options
                  label: obj.lru
                  ,before: function(){
                      obj.status = 'pending'
                    }
                }
            )
        })

      queriesBatcher.atEachFetch(function(list,pending,success,fail){
        var summary = {
          total: list.length + pending.length + success.length + fail.length
          ,pending: pending.length
          ,loaded: success.length + fail.length
        }
        ,percent = Math.round((summary.loaded / summary.total) * 100)
        ,percent_pending = Math.round((summary.pending / summary.total) * 100)
        ,msg = percent + '% created'
        $scope.status = {message: msg, progress:percent, progressPending:percent_pending}
      })

      // FINALIZATION
      queriesBatcher.atFinalization(function(list,pending,success,fail){
        // Move treated web entities to other lists
        $scope.list = $scope.list.filter(function(obj){
            
            // Existing
            if(obj.status == 'existing'){
              $scope.existingList.push(obj)
              return false
            }

            // Created
            if(obj.status == 'created'){
              $scope.createdList.push(obj)
              return false
            }

            // Conflicted
            if(obj.status == 'conflict'){
              $scope.conflictedList.push(obj)
              return true
            }

            // The rest: errors
            $scope.errorList.push(obj)
            return true

            // NB: we return true because this way items stay in the list for monitoring
          })

        // Status message
        var count = $scope.createdList.length
        ,msg = count + ' web entit' + (count>1 ? 'ies' : 'y') + ' created'
        $scope.status = {message: msg}
        
        $scope.creating = false
      })

      queriesBatcher.run()
    }

    $scope.doRetry = function(withConflictsFlag){
      var withConflicts = $scope.retryConflicted || withConflictsFlag
      $scope.conflictedList = []
      $scope.errorList = []
      $scope.retry = true

      var list = $scope.list
      if(!withConflicts){
        list = list.filter(function(obj){
          return obj.status != 'conflict'
        })
      }

      // Reinitialize
      bootstrapUrlList(list)

      // Reload
      fetchParentWebEntities()
    }

    $scope.doCrawl = function(crawlExisting){

      function cleanObj(obj){
        return {
            webentity: obj.webentity
            // ,meta: obj.meta
          }
      }
      var list = $scope.createdList
        .map(cleanObj)
        .filter(function(obj){return obj.webentity.id !== undefined})
      
      // Remove doublons
      list = utils.extractCases(list, function(obj){
        return obj.webentity.id
      })

      if(crawlExisting){
        $scope.existingList.forEach(function(obj){
          if(obj.webentity.id !== undefined){
            list.push(cleanObj(obj))
          }
        })
      }

      if(list.length > 0){
        store.set('webentities_toCrawl', list)
        $location.path('/project/'+$scope.corpusId+'/prepareCrawls')
      } else {
        $scope.status = {message:'No Web Entity to send', background:'danger'}
      }
    }

    $scope.removeLine = function(objId){
      $scope.list = $scope.list.filter(function(obj){
        return obj.id != objId
      })
      delete $scope.list_byId[objId]
      if (!$scope.list.length && !$scope.existingList.length && !$scope.createdList.length) {
        $location.path('/project/'+$scope.corpusId+'/importurls')
      }
    }


    // Functions

    function bootstrapUrlList(list){
      if(list){
        // Filter out invalid URLs
        list = list.filter(function(obj){
          return obj.url && utils.URL_validate(obj.url)
        })

        $scope.status = {message: 'Simulating Web Entities Creation Rules'}
        $scope.simulatingCreationRules = true
        api.getCreationRulesResult({
          urlList: list.map(function(obj){ return obj.url })
        },function(simulatedPrefixIndex){
          $scope.simulatedPrefixIndex = simulatedPrefixIndex
          // Bootstrap the object and record in model
          $scope.list = list.map(bootstrapPrefixObject)
          console.log(list, $scope.list)
          // Building an index of these objects to find them by id
          $scope.list.forEach(function(obj){
            $scope.list_byId[obj.id] = obj
          })

          // Catching conflicts: we use this index of LRU prefixes set in the UI
          $scope.conflictsIndex = new PrefixConflictsIndex($scope.list_byId)
          // NB: it is recorded in the model because the hyphePrefixSliderButton directives needs to access it
          $scope.list.forEach(function(obj){
            $scope.conflictsIndex.addToLruIndex(obj)
          })

          if($scope.list.length==0){
            $location.path('/project/'+$scope.corpusId+'/importurls')
          }

          $scope.status = {}
          $scope.simulatingCreationRules = false
          fetchParentWebEntities()
        },function(error){
          console.log(error)
          $scope.status = {message: error.message}
          $scope.simulatingCreationRules = false
        })
      } else {
        $scope.list = []
      }
    }

    function bootstrapPrefixObject(obj){
      obj.url = utils.URL_fix(obj.url)
      obj.lru = utils.URL_to_LRU(utils.URL_stripLastSlash(obj.url))
      obj.tld = utils.LRU_getTLD(obj.lru)
      obj.tldLength = obj.tld !== "" ? obj.tld.split('.').length : 0
      obj.json_lru = utils.URL_to_JSON_LRU(utils.URL_stripLastSlash(obj.url))
      obj.pretty_lru = utils.URL_to_pretty_LRU(utils.URL_stripLastSlash(obj.url))
        .map(function(stem){
            var maxLength = 12
            if(stem.length > maxLength+3){
              return stem.substr(0,maxLength) + '...'
            }
            return stem
          })
      obj.simulatedPrefix = $scope.simulatedPrefixIndex[obj.url]
      obj.prefixLength = obj.simulatedPrefix ? obj.simulatedPrefix.split('|').length - 1 : !!obj.tldLength + 2 + !!obj.json_lru.port
      obj.truePrefixLength = obj.prefixLength - 1 + obj.tldLength
      obj.conflicts = []
      obj.status = 'loading'
      return obj
    }
  }])
