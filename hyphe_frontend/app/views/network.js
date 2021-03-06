'use strict';

angular.module('hyphe.networkController', ['angular-md5'])

  .controller('network', ['$scope', 'api', 'utils', 'md5', 'corpus', '$window'
  ,function($scope, api, utils, md5, corpus, $window) {
    
    var sigmaInstance
    
    $scope.currentPage = 'network'
    $scope.Page.setTitle('Network')
    $scope.corpusName = corpus.getName()
    $scope.corpusId = corpus.getId()

    $scope.links
    $scope.webentities
    $scope.network

    $scope.spatializationRunning = false
    $scope.overNode = false

    $scope.loading = true
    $scope.settingsChanged = false

    $scope.filteringCollapsed = false
    $scope.keyCollapsed = false
    
    $scope.categorizingCollapsed = true
    $scope.categorization = 'HYPHE_internal_status'
    $scope.uniqCategories = {}
    $scope.uniqCategoriesExist = false
    var maxCatLegend = 6

    // Different presets for settings
    $scope.presets = [
      {
        name: "Corpus"
      , settings:{
          in: true
        , undecided: true
        , out: false
        , discovered: false
        , discoveredMinDegree: 0
        , hideIsolated: true
        }
      }
    , {
        name: "Prospection"
      , settings:{
          in: true
        , undecided: true
        , out: false
        , discovered: true
        , discoveredMinDegree: 3
        , hideIsolated: true
        }
      }
    , {
        name: "Full"
      , settings:{
          in: true
        , undecided: true
        , out: true
        , discovered: true
        , discoveredMinDegree: 0
        , hideIsolated: true
        }
      }
    ]
    $scope.presetNames = $scope.presets.map(function(d){ return d.name })

    $scope.presetsOpen = false

    // Actual active settings, here specified as default
    $scope.settings = {
      in: true
    , undecided: true
    , out: false
    , discovered: false
    , discoveredMinDegree: 0
    , hideIsolated: false
    }

    // What is displayed (before validate or cancel)
    $scope.discoveredMinDegree =  $scope.settings.discoveredMinDegree
    $scope.statuses = {
      in: $scope.settings.in
    , undecided: $scope.settings.undecided
    , out: $scope.settings.out
    , discovered: $scope.settings.discovered
    , discoveredMinDegree: $scope.settings.discoveredMinDegree
    , hideIsolated: $scope.settings.hideIsolated
    }

    $scope.counts = {}

    // Sigma stuff
    $scope.$on("$destroy", function(){
      killSigma()
    })
    
    $scope.sigmaRecenter = function(){
      var c = sigmaInstance.cameras[0]
      c.goTo({
        ratio: 1
        ,x: 0
        ,y: 0
      })
    }

    $scope.sigmaZoom = function(){
      var c = sigmaInstance.cameras[0]
      c.goTo({
        ratio: c.ratio / c.settings('zoomingRatio')
      })
    }

    $scope.sigmaUnzoom = function(){
      var c = sigmaInstance.cameras[0]
      c.goTo({
        ratio: c.ratio * c.settings('zoomingRatio')
      })
    }

    $scope.toggleSpatialization = function(){
      if($scope.spatializationRunning){
        sigmaInstance.stopForceAtlas2()
        $scope.spatializationRunning = false
      } else {
        sigmaInstance.startForceAtlas2()
        $scope.spatializationRunning = true
      }
    }

    $scope.runSpatialization = function(){
      $scope.spatializationRunning = true
      sigmaInstance.startForceAtlas2()
    }

    $scope.stopSpatialization = function(){
      $scope.spatializationRunning = false
      sigmaInstance.killForceAtlas2()
    }

    $scope.downloadNetwork = function(){
      var network = $scope.network

      var blob = new Blob(json_graph_api.buildGEXF(network), {'type':'text/gexf+xml;charset=utf-8'});
      saveAs(blob, $scope.corpusName + ".gexf");
    }

    $scope.touchSettings = function(){

      // Check if difference with current settings
      var difference = false
      for(var k in $scope.settings){
        if($scope.settings[k] != $scope.statuses[k]){
          difference = true
        }
      }
      $scope.settingsChanged = difference

      // Check status of preset buttons
      for(var p in $scope.presets){
        var presetDifference = false
        for(var k in $scope.settings){
          if($scope.presets[p].settings[k] != $scope.statuses[k]){
            presetDifference = true
          }
        }
        $scope.presets[p].status = !presetDifference
      }
    }

    $scope.applyPreset = function(p){
      for(var k in $scope.settings){
        $scope.statuses[k] = $scope.presets[p].settings[k]
      }
      $scope.touchSettings()
      $scope.presetsOpen = false
    }

    $scope.revertSettings = function(){
      for(var k in $scope.settings){
        $scope.statuses[k] = $scope.settings[k]
      }
      $scope.touchSettings()
    }

    $scope.applySettings = function(){
      for(var k in $scope.settings){
        $scope.settings[k] = $scope.statuses[k]
      }
      $scope.touchSettings()

      killSigma()
      buildNetwork()
      initSigma()

    }

    var statusColors = {
      IN:              "#333"
      ,UNDECIDED:      "#ADA299"
      ,OUT:            "#FAA"
      ,DISCOVERED:     "#93BDE0"
    }
    , categoriesColor = [
      "#7dce47"
      ,"#74dbff"
      ,"#d4c237"
      ,"#7951c3"
      ,"#d26229"
      ,"#f36dcb"
      ,"#ada299"
    ]
    , colorize = function(node){
      if ($scope.categorization === "HYPHE_internal_status") {
        return statusColors[node.status] || "#F00"
      }
      if (node.categories[$scope.categorization]) {
        return $scope.uniqCategories[$scope.categorization].colors[node.categories[$scope.categorization]] || categoriesColor[6]
      }
      return "#F00"
    }

    $scope.updateCategorization = function(){
      sigmaInstance.graph.nodes().forEach(function(node){
        node.color = colorize(node)
      })
      $scope.categorizingCollapsed = true
      $scope.keyCollapsed = false
      if (!$scope.spatializationRunning)
        sigmaInstance.refresh()
    }

    // Init
    loadCorpus()

    // Functions
    function loadCorpus(){
      $scope.status = {message: 'Loading web entities'}
      api.getWebentities(
        {
           sort: []
          ,count: -1
          ,semiLight: true
        }
        ,function(result){
          $scope.webentities = {
            all: result,
            in: []
            ,out: []
            ,undecided: []
            ,discovered: []
            ,discovered_2: []
            ,discovered_3: []
            ,discovered_4: []
            ,discovered_5: []
          }
          result.forEach(function(we){
            $scope.webentities[we.status.toLowerCase()].push(we)
            if (we.status == "DISCOVERED"){
              [2, 3, 4, 5].forEach(function(min){
                if (we.indegree >= min) $scope.webentities["discovered_"+min].push(we)
              })
            }
          })
          $scope.counts.in = $scope.webentities.in.length
          $scope.counts.undecided = $scope.webentities.undecided.length
          $scope.counts.out = $scope.webentities.out.length
          $scope.counts.discovered = $scope.webentities.discovered.length

          loadLinks()
        }
        ,function(data, status, headers, config){
          $scope.status = {message: 'Error loading web entities', background:'danger'}
        }
      )

    }

    function loadLinks(){
      $scope.status = {message: 'Loading links'}
      api.getNetwork(
        {}
        ,function(links){
          $scope.links = links

          /*$window.links = links
          console.log('LINKS', links)*/
          
          buildNetwork()
          $scope.status = {}

          $scope.loading = false
          initSigma()

        }
        ,function(data, status, headers, config){
          $scope.status = {message: 'Error loading links', background:'danger'}
        }
      )
    }

    function initSigma(){
      sigmaInstance = new sigma('sigma');

      $window.s = sigmaInstance // For debugging purpose
      
      sigmaInstance.settings({
        defaultLabelColor: '#666'
        ,edgeColor: 'default'
        ,defaultEdgeColor: '#ECE8E5'
        ,defaultNodeColor: '#999'
        ,minNodeSize: 0.3
        ,maxNodeSize: 5
        ,zoomMax: 5
        ,zoomMin: 0.002
      });

      //var nodesIndex = {}

      // Populate
      $window.g = $scope.network
      $scope.network.nodes
        .forEach(function(node){
          //nodesIndex[node.id] = node
          var degree = node.inEdges.length + node.outEdges.length
          sigmaInstance.graph.addNode({
            id: node.id
            ,label: node.label
            ,'x': Math.random()
            ,'y': Math.random()
            ,'degree': degree
            ,'hidden': node.hidden
            ,'size': 1 + Math.log(1 + 0.1 * degree )
            ,'color': colorize(node)
            ,status: node.status
            ,categories: node.categories
          })
        })
      $scope.network.edges
        .forEach(function(link, i){
          sigmaInstance.graph.addEdge({
            'id': 'e'+i
            ,'source': link.sourceID
            ,'target': link.targetID
          })
        })

      // Force Atlas 2 settings
      sigmaInstance.configForceAtlas2({
        slowDown: 2 * (1 + Math.log($scope.network.nodes.length))
        ,worker: true
        ,scalingRatio: 10
        ,strongGravityMode: true
        ,gravity: 0.1
        ,barnesHutOptimize: $scope.network.nodes.length > 1000
      })

      // Bind interactions
      sigmaInstance.bind('overNode', function(e) {
        if(Object.keys(e.data.captor).length > 0){  // Sigma bug turnaround
          $scope.overNode = true
          $scope.$apply()
        }
      })

      sigmaInstance.bind('outNode', function(e) {
        if(Object.keys(e.data.captor).length > 0){  // Sigma bug turnaround
          $scope.overNode = false
          $scope.$apply()
        }
      })

      sigmaInstance.bind('clickNode', function(e) {
        var weId = e.data.node.id
        ,path = window.location.href.replace(window.location.hash, "") + '#/project/' + $scope.corpusId + '/webentity/' + weId
        $window.open(path, '_blank')
      })

      $scope.runSpatialization()
    }

    function killSigma(){
      if (sigmaInstance) {
        $scope.stopSpatialization()
        sigmaInstance.kill()
      }
    }

    function buildNetwork(){
      $scope.network = {}
      $scope.network.attributes = []

      $scope.categorization = 'HYPHE_internal_status'
      $scope.uniqCategories = {}
      $scope.uniqCategoriesExist = false

      $scope.network.nodesAttributes = [
        {id:'attr_status', title:'Status', type:'string'}
      , {id:'attr_crawling', title:'Crawling status', type:'string'}
      , {id:'attr_indexing', title:'Indexing status', type:'string'}
      , {id:'attr_home', title:'Homepage', type:'string'}
      , {id:'attr_creation', title:'Creation', type:'integer'}
      , {id:'attr_modification', title:'Last modification', type:'integer'}
      , {id:'attr_hyphe_indegree', title:'Hyphe Indegree', type:'integer'}
      ]
      
      // Extract categories from nodes
      var categories = [], tmpCategories = {}
      $scope.webentities.all.forEach(function(we){
        for(var category in we.tags.USER){
          categories.push(category)
        }
      })

      categories = utils.extractCases(categories)
      categories.forEach(function(cat){
        $scope.network.nodesAttributes.push({id:'attr_'+md5.createHash(cat), title:cat, type:'string'})
      })
      var existingNodes = {}  // This index is useful to filter edges with unknown nodes
                              // ...and when the backend gives several instances of the same web entity

      var wes = [];
      ["in", "undecided", "out"].forEach(function(st){
        if ($scope.settings[st]) {
          wes = wes.concat($scope.webentities[st])
        }
      })
      if ($scope.settings.discovered){
        wes = wes.concat($scope.webentities["discovered"+($scope.settings.discoveredMinDegree > 0 ? "_"+$scope.settings.discoveredMinDegree : "")])
      }

      // Identify tag categories with unique values for the filtered webentities
      wes.forEach(function(we){
        for(var category in we.tags.USER){
          if (!tmpCategories[category]){
            tmpCategories[category] = {
              maxitems: 0
              ,missing_values: wes.length
              ,values: {}
            }
          }
          tmpCategories[category].maxitems = Math.max(we.tags.USER[category].length, tmpCategories[category].maxitems)
          tmpCategories[category].missing_values -= 1
          we.tags.USER[category].forEach(function(tag){
            if (!tmpCategories[category].values[tag]) {
              tmpCategories[category].values[tag] = 0
            }
            tmpCategories[category].values[tag]++
          })
        }
      })

      for (var category in tmpCategories){
        var cat = tmpCategories[category],
          catkeys = Object.keys(cat.values)
        if (cat.maxitems === 1){
          var othervalues = catkeys.length >= maxCatLegend || (!cat.missing_values && catkeys.length > maxCatLegend)
          $scope.uniqCategoriesExist = true
          $scope.uniqCategories[category] = cat
          $scope.uniqCategories[category].legend = catkeys.sort(function(a, b){
              return cat.values[b] - cat.values[a]
            })
            .slice(0, maxCatLegend - othervalues - !!cat.missing_values)
            .map(function(c, i){
              return {
                name: c
                ,color: categoriesColor[i]
              }
            })
          $scope.uniqCategories[category].colors = {}
          $scope.uniqCategories[category].legend.forEach(function(c){
            $scope.uniqCategories[category].colors[c.name] = c.color
          })
          if (catkeys.length >= maxCatLegend){
            $scope.uniqCategories[category].legend.push({
              name: 'other tag values'
              ,color: categoriesColor[6]
            })
          }
          if (cat.missing_values){
            $scope.uniqCategories[category].legend.push({
              name: 'no tag value'
              ,color: '#F00'
            })
          }
        }
      }

      $scope.network.nodes = wes.filter(function(n){
        return n !== undefined
      }).map(function(we){
        if(existingNodes[we.id] === undefined){
          var tagging = [], wecategories = {}
          for(var category in we.tags.USER){
            tagging.push({cat:category, values:we.tags.USER[category]})
          }
          Object.keys($scope.uniqCategories).forEach(function(category){
            wecategories[category] = ((we.tags.USER || {})[category] || [''])[0]
          })
          existingNodes[we.id] = true
          return {
            id: we.id
            ,label: we.name
            ,status: we.status
            ,categories: wecategories
            ,attributes: [
              {attr:'attr_status', val: we.status || 'error' }
              ,{attr:'attr_crawling', val: we.crawling_status || '' }
              ,{attr:'attr_indexing', val: we.indexing_status || '' }
              ,{attr:'attr_creation', val: we.creation_date || 'unknown' }
              ,{attr:'attr_modification', val: we.last_modification_date || 'unknown' }
              ,{attr:'attr_home', val: we.homepage || '' }
              ,{attr:'attr_hyphe_indegree', val: we.indegree || '0' }
            ].concat(tagging.map(function(catvalues){
              return {attr:'attr_'+md5.createHash(catvalues.cat), val:catvalues.values.join(' | ')}
            }))
          }
        } else {
          console.log('Duplicate id in web entities list', we.id)
        }
      }).filter(function(we){ // filter duplicates
        return we !== undefined
      })
      
      $scope.network.edgesAttributes = [
        {id:'attr_count', title:'Hyperlinks Count', type:'integer'}
      ]

      $scope.network.edges = $scope.links
      .filter(function(link){
        // Check that nodes exist and remove autolinks
        return existingNodes[link[0]] && existingNodes[link[1]] && link[0] !== link[1]
      })
      .map(function(link){
        return {
          sourceID: link[0]
          ,targetID: link[1]
          ,attributes: [
            {attr:'attr_count', val:link[2]}
          ]
        }
      })
      json_graph_api.buildIndexes($scope.network)

      if ( $scope.statuses.hideIsolated ) {
        $scope.network.nodes.forEach(function(n){
          if (n.inEdges.length + n.outEdges.length == 0) {
            n.hidden = true
          } else {
            n.hidden = false
          }
        })
      }

      // console.log('Network', $scope.network)
    }
  }])
