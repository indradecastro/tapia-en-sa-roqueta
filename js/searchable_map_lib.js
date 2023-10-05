var SearchableMapLib = SearchableMapLib || {};
var SearchableMapLib = {

  // parameters to be defined on initialize() 
  map_centroid: [],
  defaultZoom: 9,
  filePath: '',
  fileType: '',
  csvOptions: '',
  listOrderBy: '',
  recordName: '',
  recordNamePlural: '',
  debug: false,

  // internal properties
  radius: '',
  csvData: null,
  geojsonData: null,
  currentResults: null,
  currentResultsLayer: null,
  currentPinpoint: null,
  lastClickedLayer: null,

  initialize: function(options){
    options = options || {};

    SearchableMapLib.map_centroid = options.map_centroid || [41.881832, -87.623177],
    SearchableMapLib.defaultZoom = options.defaultZoom || 9,
    SearchableMapLib.filePath = options.filePath || "",
    SearchableMapLib.fileType = options.fileType || "csv",
    SearchableMapLib.csvOptions = options.csvOptions || {separator: ',', delimiter: '"'},
    SearchableMapLib.listOrderBy = options.listOrderBy || "",
    SearchableMapLib.recordName = options.recordName || "result",
    SearchableMapLib.recordNamePlural = options.recordNamePlural || "results",
    SearchableMapLib.radius = options.defaultRadius || 1000,
    SearchableMapLib.debug = options.debug || false

    if (SearchableMapLib.debug)
      console.log('debug mode is on');

    //reset filters
    $("#search-address").val(SearchableMapLib.convertToPlainString($.address.parameter('address')));

    var loadRadius = SearchableMapLib.convertToPlainString($.address.parameter('radius'));
    if (loadRadius != "") 
        $("#search-radius").val(loadRadius);
    else 
        $("#search-radius").val(SearchableMapLib.radius);

    $(":checkbox").prop("checked", "checked");

    geocoder = new google.maps.Geocoder();
    // initiate leaflet map
    if (!SearchableMapLib.map) {
      SearchableMapLib.map = new L.Map('mapCanvas', {
        center: SearchableMapLib.map_centroid,
        zoom: SearchableMapLib.defaultZoom,
        scrollWheelZoom: false
      });

      SearchableMapLib.google = L.gridLayer.googleMutant({type: 'roadmap' });

      SearchableMapLib.map.addLayer(SearchableMapLib.google);

      //add hover info control
      SearchableMapLib.info = L.control({position: 'topright'});

      SearchableMapLib.info.onAdd = function (map) {
          this._div = L.DomUtil.create('div', 'info'); // create a div with a class "info"
          this.update();
          return this._div;
      };

      // method that we will use to update the control based on feature properties passed
      var hover_template;
      $.get( "../templates/hover.ejs", function( template ) {
        hover_template = template;
      });
      SearchableMapLib.info.update = function (props) {
        if (props) {
          this._div.innerHTML = ejs.render(hover_template, {obj: props});
        }
        else {
          this._div.innerHTML = 'Pasa el ratón por encima de un ' + SearchableMapLib.recordName;
        }
      };

      SearchableMapLib.info.clear = function(){
        this._div.innerHTML = 'Pasa el ratón por encima de un ' + SearchableMapLib.recordName;
      };

      //add results control
      SearchableMapLib.results_div = L.control({position: 'topright'});

      SearchableMapLib.results_div.onAdd = function (map) {
        this._div = L.DomUtil.create('div', 'results-count');
        this._div.innerHTML = "";
        return this._div;
      };

      SearchableMapLib.results_div.update = function (count){
        var recname = SearchableMapLib.recordNamePlural;
        if (count == 1) {
            recname = SearchableMapLib.recordName;
        }

        this._div.innerHTML = count.toLocaleString('en') + ' ' + recname + ' ';
      };

      SearchableMapLib.results_div.addTo(SearchableMapLib.map);
      SearchableMapLib.info.addTo(SearchableMapLib.map);

      $.when($.get(SearchableMapLib.filePath)).then(
      function (data) {

        if (SearchableMapLib.fileType == 'geojson') {
          if (SearchableMapLib.debug) console.log('loading geojson');
          // sometimes the server returns the file as text and we have to parse it
          if (typeof data == 'string')
            SearchableMapLib.geojsonData = JSON.parse(data);
          else
            SearchableMapLib.geojsonData = data
        }
        else if (SearchableMapLib.fileType == 'csv' ){
          // convert CSV
          if (SearchableMapLib.debug) console.log('converting to csv');
          SearchableMapLib.geojsonData = convertCsvToGeojson(data)
        }
        else {
          // error!
          console.log ("fileType must be 'csv' or 'geojson'")
        }

        if (SearchableMapLib.debug) {
          console.log('data loaded:');
          console.log(SearchableMapLib.geojsonData);
        }

        SearchableMapLib.doSearch();

      });
    }
  },

  doSearch: function() {
    SearchableMapLib.clearSearch();
    var address = $("#search-address").val();
    SearchableMapLib.radius = $("#search-radius").val();

    if (SearchableMapLib.radius == null && address != "") {
      SearchableMapLib.radius = 1000;
    }

    if (address != "") {

      geocoder.geocode( { 'address': address }, function(results, status) {
        if (status == google.maps.GeocoderStatus.OK) {
          SearchableMapLib.currentPinpoint = [results[0].geometry.location.lat(), results[0].geometry.location.lng()];
          $.address.parameter('address', encodeURIComponent(address));
          $.address.parameter('radius', SearchableMapLib.radius);
          SearchableMapLib.address = address;
          SearchableMapLib.createSQL(); // Must call create SQL before setting parameters.
          SearchableMapLib.setZoom();
          SearchableMapLib.addIcon();
          SearchableMapLib.addCircle();
          SearchableMapLib.renderMap();
          SearchableMapLib.renderList();
          SearchableMapLib.getResults();
        }
        else {
          alert("No hemos podido encontrar la dirección que has introducido: " + status);
        }
      });
    }
    else { //search without geocoding callback
      SearchableMapLib.map.setView(new L.LatLng( SearchableMapLib.map_centroid[0], SearchableMapLib.map_centroid[1] ), SearchableMapLib.defaultZoom)
      SearchableMapLib.createSQL(); // Must call create SQL before setting parameters.
      SearchableMapLib.renderMap();
      SearchableMapLib.renderList();
      SearchableMapLib.getResults();
    }

  },

  renderMap: function() {
    SearchableMapLib.currentResultsLayer.addTo(SearchableMapLib.map);
  },

  renderList: function() {
    var results = $('#results-list');
    results.empty();

    if (SearchableMapLib.currentResults.features.length == 0) {
      results.append("<p class='no-results'>Sin resultados. ¿Puedes ampliar el radio de búsqueda?.</p>");
    }
    else {
      var row_content;
      $.get( "../templates/table-row.ejs", function( template ) {
          for (idx in SearchableMapLib.currentResults.features) {
            row_content = ejs.render(template, {obj: SearchableMapLib.currentResults.features[idx].properties});

            results.append(row_content);
          }
        });
      }
  },

  getResults: function() {
    if (SearchableMapLib.debug) {
      console.log('results length')
      console.log(SearchableMapLib.currentResults.features.length)
    }

    var recname = SearchableMapLib.recordNamePlural;
    if (SearchableMapLib.currentResults.features.length == 1) {
        recname = SearchableMapLib.recordName;
    }

    SearchableMapLib.results_div.update(SearchableMapLib.currentResults.features.length);

    $('#list-result-count').html(SearchableMapLib.currentResults.features.length.toLocaleString('en') + ' ' + recname + ' ')
  },

  modalPop: function(data) {
    if (SearchableMapLib.debug) {
      console.log('launch modal')
      console.log(data);
    }
    var modal_content;
    $.get( "../templates/popup.ejs", function( template ) {
        modal_content = ejs.render(template, {obj: data});
        $('#modal-pop').modal();
        $('#modal-main').html(modal_content);
    });
  },

  clearSearch: function(){
    if (SearchableMapLib.currentResultsLayer) {
      SearchableMapLib.currentResultsLayer.remove();
    }
    if (SearchableMapLib.centerMark)
      SearchableMapLib.map.removeLayer( SearchableMapLib.centerMark );
    if (SearchableMapLib.radiusCircle)
      SearchableMapLib.map.removeLayer( SearchableMapLib.radiusCircle );
  },

  createSQL: function() {
    var address = $("#search-address").val();

    // this is a fun hack to do a deep copy of the GeoJSON data
    SearchableMapLib.currentResults = JSON.parse(JSON.stringify(SearchableMapLib.geojsonData));

    if(SearchableMapLib.currentPinpoint != null && address != '') {
        var point = turf.point([SearchableMapLib.currentPinpoint[1], SearchableMapLib.currentPinpoint[0]]);
        var buffered = turf.buffer(point, SearchableMapLib.radius, {units: 'meters'});

        SearchableMapLib.currentResults = turf.pointsWithinPolygon(SearchableMapLib.currentResults, buffered);

        if (SearchableMapLib.debug) {
          console.log('found points within')
          console.log(SearchableMapLib.currentResults);
        }
    }

    //-----custom filters-----

    //-----name search filter-----
    var name_search = $("#search-name").val().replace("'", "\\'");
    if (name_search != '') {
      SearchableMapLib.currentResults.features = $.grep(SearchableMapLib.currentResults.features, function(r) {
          return r.properties["General"].toLowerCase().indexOf(name_search.toLowerCase()) > -1;
        });
    }
    //-----end name search filter-----
     
    // -----end of custom filters-----

    SearchableMapLib.currentResultsLayer = L.geoJSON(SearchableMapLib.currentResults, {
        pointToLayer: function (feature, latlng) {
          return L.marker(latlng, {icon: SearchableMapLib.getIcon(feature.properties["Type"])} );
        },
        onEachFeature: onEachFeature
      }
    );

    //messy - clean this up later
    function onEachFeature(feature, layer) {
      layer.on({
        mouseover: hoverFeature,
        mouseout: removeHover,
        click: modalPop
      });
    }

    function hoverFeature(e) {
      SearchableMapLib.info.update(e.target.feature.properties);
    }

    function removeHover(e) {
      SearchableMapLib.info.update();
    }

    function modalPop(e) {
      SearchableMapLib.modalPop(e.target.feature.properties)
    }

  },

  setZoom: function() {
    var zoom = '';
    if (SearchableMapLib.radius >= 10000) zoom = 11; // 10 kms
    else if (SearchableMapLib.radius >= 5000) zoom = 12; // 5 kms
    else if (SearchableMapLib.radius >= 1000) zoom = 13; // 1 km
    else zoom = 16;

    SearchableMapLib.map.setView(new L.LatLng( SearchableMapLib.currentPinpoint[0], SearchableMapLib.currentPinpoint[1] ), zoom)
  },

  addIcon: function() {
    SearchableMapLib.centerMark = new L.Marker(SearchableMapLib.currentPinpoint, { icon: (new L.Icon({
            iconUrl: '/img/blue-pushpin.png',
            iconSize: [32, 32],
            iconAnchor: [10, 32]
    }))});

    SearchableMapLib.centerMark.addTo(SearchableMapLib.map);
  },

  addCircle: function() {
    SearchableMapLib.radiusCircle = L.circle(SearchableMapLib.currentPinpoint, {
        radius: SearchableMapLib.radius,
        fillColor:'#1d5492',
        fillOpacity:'0.1',
        stroke: false,
        clickable: false
    });

    SearchableMapLib.radiusCircle.addTo(SearchableMapLib.map);
  },

  //converts a slug or query string in to readable text
  convertToPlainString: function(text) {
    if (text == undefined) return '';
    return decodeURIComponent(text);
  },

  // -----custom functions-----
  getIcon: function(type){
    if (type == "Pharmacy") return redIcon;
    if (type == "Government") return blueIcon;
    if (type == "Other") return yellowIcon;
    return greenIcon;
  },
  // -----end custom functions-----

}
