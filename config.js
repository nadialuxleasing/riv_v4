/* ============================================================================
   LUX VISION · CONFIGURACIÓN MUNICIPAL (v2.1 — refactor actualizado)
   ----------------------------------------------------------------------------
   ÚNICO archivo de configuración para replicar o actualizar el visor GIS.

   Índice:
    1 · municipio      → identidad, centro/zoom y logos
    2 · geoserver      → URL reservada (futura migración WFS)
    3 · fuentes        → rutas de los GeoJSON / integración externa (Google Sheets)
    4 · camposGlobales → atributos compartidos (fecha, distrito)
    5 · popupReclamos  → campos del popup de solicitudes
    6 · simbolologia   → PALETA CROMÁTICA ÚNICA (mapa + desplegables + leyenda)
    7 · ui             → tipografía, coordenadas, búsqueda OSM, ficha lateral, BBox
    8 · capas          → definición exacta por capa (campos específicos requeridos)
   ============================================================================ */

window.LUX_CONFIG = {

  /* ── 1 · IDENTIDAD DEL MUNICIPIO ─────────────────────────────────────── */
  municipio: {
    nombre: 'Rivadavia',
    tituloAplicacion: 'Sistema de Monitoreo de Activos Urbanos',
    locale: 'es-AR',
    mapaInicial: { center: [-68.468, -33.191], zoom: 15 },
    branding: {
      logoLux:       { src: 'logo_lux_byn.png', href: '#' },
      logoMunicipio: { src: 'logo_riv_2.png',   href: '#' }
    }
  },

  /* ── 2 · SERVIDOR DE MAPAS (reservado para migración futura a WFS) ──── */
  geoserver: {
    base: 'http://localhost:8090/geoserver/visor_rivadavia/ows?service=WFS&version=1.0.0&request=GetFeature'
  },

  /* ── 3 · FUENTES DE DATOS (GeoJSON estáticos y Google Sheets para reclamos) ─ */
  fuentes: {
    luminarias:      './luminarias_riv_wgs84.geojson',
    arbolado:        './arboles_V2.geojson',
    vialidades:      './vialidad_ej_6.geojson', // Actualizado a vialidad_ej_6
    cordon:          './cordon.geojson',
    banquina_vereda: './banquina_vereda.geojson',
    cuneta:          './cuneta.geojson',
    distritos:       './distritos_riv_ide.geojson',
    /* Reclamos conectados dinámicamente al Google Sheet (exportable en CSV o API) */
    reclamos:        'https://docs.google.com/spreadsheets/d/1xrjKtepiEjcvpucty6ZAzoh_3C88Plcg/gviz/tq?tqx=out:csv'
  },

  /* ── 4 · ATRIBUTOS GLOBALES ──────────────────────────────────────────── */
  camposGlobales: {
    fechaActualizacion: ['fecha_act', 'FECHA_ACT', 'Fecha_Act'],
    distritoNombre:     ['nombre', 'NOMBRE', 'distrito', 'DISTRITO', 'name']
  },

  /* ── 5 · POPUP DE SOLICITUDES ────────────────────────────────────────── */
  popupReclamos: {
    descripcion:  ['Descripción del reclamo', 'Descripción del Reclamo', 'Descripcion del reclamo', 'DESCRIPCION_DEL_RECLAMO', 'descripcion'],
    tipo:         ['Tipo de reclamo', 'Tipo', 'TIPO', 'tipo', 'TIPO_RECLAMO'],
    usuario:      ['Usuario', 'USUARIO', 'usuario', 'User'],
    area:         ['Área', 'Area', 'AREA', 'area'],
    fecha:        ['Fecha', 'FECHA', 'fecha', 'Fecha Solución'],
    fechaSolucion:['Fecha Solución', 'FECHA_SOLUCION', 'fecha_solucion']
  },

  /* ── 5.B · CONEXIÓN GOOGLE SHEETS (solicitudes/reclamos) ────────────────
     La capa de solicitudes se construye DINÁMICAMENTE desde la exportación
     CSV pública del Sheet. Los 7 campos funcionales se mapean a claves
     canónicas (nro, usuario, area, tipo, descripcion, fecha, fecha_solucion)
     y las coordenadas se detectan entre las variantes configuradas abajo
     (agregue aquí los nombres exactos de sus columnas si difieren). */
  reclamosCsv: {
    url: 'https://docs.google.com/spreadsheets/d/1xrjKtepiEjcvpucty6ZAzoh_3C88Plcg/gviz/tq?tqx=out:csv',
    camposCoordenadas: {
      lat: ['lat', 'Lat', 'LAT', 'latitud', 'Latitud', 'LATITUD', 'y', 'Y'],
      lng: ['lng', 'Lng', 'LNG', 'lon', 'Lon', 'LON', 'long', 'Long', 'LONGITUD', 'longitud', 'x', 'X']
    }
  },

  /* ── 6 · PALETA CROMÁTICA ÚNICA ────────────────────────────────────────
     ORIGEN ÚNICO DE VERDAD para la simbología del mapa, los puntos de color
     de los desplegables KPI y la leyenda. 
     NOTA: Se incrementó el contraste en 'reclamos' (halo y trazo más visibles). */
  simbologia: {
    luminarias: { LED: '#22d3ee', SODIO: '#e2f916', OTROS: '#e6b290' },
    arbolado:   { BUENO: '#4f7a61', REGULAR: '#78926f', MALO: '#a5a36f', OTROS: '#8d9b8f' },
    vialidades: { PAVIMENTADO: '#587b9b', CONSOLIDADA: '#7e9b83', TIERRA: '#b29169', 'SIN DATO': '#9aa3a8' },
    lateralVial:{ CORDON: '#b8875d', BANQUINA_VEREDA: '#9a8f72', CUNETA: '#6f93a3' },
    /* Reclamos con alta visibilidad requerida en mapa */
    reclamos:   { HALO: '#ff0055', TRAZO: '#ffffff', TEXTO: '#ff3366', MARKER_SIZE: 12 },
    seleccion:  { CENTRO: '#31fff5', ANILLO: '#22d3ee' },
    heatmapArbolado: [
      'rgba(79,122,97,0)', 'rgba(132,158,111,0.30)', 'rgba(166,166,105,0.48)',
      'rgba(184,135,93,0.62)', 'rgba(169,92,86,0.78)'
    ]
  },

  /* ── 7 · UI / HERRAMIENTAS ───────────────────────────────────────────── */
  ui: {
    coordenadas: { decimales: 6, mostrarProyectadas: false },
    busqueda: {
      url: 'https://nominatim.openstreetmap.org/search',
      params: { format: 'jsonv2', limit: 6, addressdetails: 0, 'accept-language': 'es' },
      debounceMs: 400,
      viewbox: '-68.75,-33.05,-68.15,-33.45',
      bounded: 1,
      zoomResultado: 17,
      /* Geocodificación inversa: clic en el mapa → dirección en la ficha lateral */
      reverseUrl: 'https://nominatim.openstreetmap.org/reverse',
      reverseGeocode: true
    },
    seleccionBBox: { color: '#22d3ee', relleno: 'rgba(34,211,238,0.08)' },
    filtroDistrito: { bufferMetros: 0 }
  },

  /* ── 8 · DEFINICIÓN DE CAPAS Y CAMPOS ESPECÍFICOS ────────────────────── */
  capas: {

    luminarias: {
      id: 'luminarias-layer',
      source: 'luminarias-source',
      label: 'Luminarias',
      /* 8 campos principales visibles + contenedor para desplegar el resto */
      camposFicha: [
        ['info-id',          'label-id',          ['id_elemento', 'ID_ELEMENTO', 'id', 'ID'], 'ID Elemento'],
        ['info-tecnologia',  'label-tecnologia',  ['tecnologia', 'TECNOLOGIA', 'sap', 'SAP'], 'Tecnología'],
        ['info-potencia',    'label-potencia',    ['potencia', 'POTENCIA'], 'Potencia'],
        ['info-marca',       'label-marca',       ['marca', 'MARCA'], 'Marca'],
        ['info-modelo',      'label-modelo',      ['modelo', 'MODELO'], 'Modelo'],
        ['info-soporte',     'label-soporte',     ['soporte', 'SOPORTE'], 'Soporte'],
        ['info-funcion',     'label-funcion',     ['funcion', 'FUNCION'], 'Función'],
        ['info-calle',       'label-calle',       ['calle', 'CALLE'], 'Calle']
      ],
      camposSecundarios: [
        ['info-fecha-act',   'label-fecha-act',   ['fecha_act', 'FECHA_ACT'], 'Fecha Act.'],
        ['info-streetview',  'label-streetview',  ['streetview', 'STREETVIEW'], 'StreetView'],
        ['info-brazo',       'label-brazo',       ['brazo', 'BRAZO'], 'Brazo'],
        ['info-zona',        'label-zona',        ['zona', 'ZONA'], 'Zona']
      ],
      kpis: {
        tecnologia: {
          campo: ['tecnologia', 'TECNOLOGIA', 'sap', 'SAP'],
          grupos: {
            'LED':   (v) => String(v).toUpperCase().includes('LED'),
            'SODIO': (v) => String(v).toUpperCase().includes('SAP') || String(v).toUpperCase().includes('SODIO'),
            'OTROS': (v) => true
          }
        },
        soporte: { campo: ['soporte', 'SOPORTE'] },
        funcion: { campo: ['funcion', 'FUNCION'] },
        zona:    { campo: ['zona', 'ZONA'] },
        potencia:{ campo: ['potencia', 'POTENCIA'] }
      },
      idCampo: ['id_elemento', 'ID_ELEMENTO', 'id', 'ID'],
      simbologiaCampo: ['tecnologia', 'TECNOLOGIA', 'sap', 'SAP']
    },

    vialidades: {
      id: 'vialidades-layer',
      source: 'vialidades-source',
      label: 'Vialidad',
      camposFicha: [
        ['info-id',          'label-id',          ['id', 'ID'], 'ID'],
        ['info-zona',        'label-zona',        ['zona', 'ZONA'], 'Zona'],
        ['info-superficie',  'label-superficie',  ['superficie', 'SUPERFICIE'], 'Superficie'],
        ['info-sentido',     'label-sentido',     ['sentido', 'SENTIDO'], 'Sentido'],
        ['info-km',          'label-km',          ['km', 'KM'], 'KM'],
        ['info-fecha-act',   'label-fecha-act',   ['fecha_act', 'FECHA_ACT'], 'Fecha Act.'],
        ['info-streetview',  'label-streetview',  ['streetview', 'STREETVIEW'], 'StreetView'],
        ['info-jerarquia',   'label-jerarquia',   ['jerarquia', 'JERARQUIA'], 'Jerarquía']
      ],
      camposSecundarios: [
        ['info-tipo',        'label-tipo',        ['tipo', 'TIPO'], 'Tipo']
      ],
      kpis: {
        superficie: {
          campo: ['superficie', 'SUPERFICIE'],
          grupos: {
            'PAVIMENTADO': (v) => String(v).toUpperCase().includes('PAVIMENTADO'),
            'CONSOLIDADA': (v) => String(v).toUpperCase().includes('CONSOLIDADA'),
            'TIERRA':      (v) => String(v).toUpperCase().includes('TIERRA'),
            'SIN DATO':    (v) => true
          },
          campoKm: ['km', 'KM']
        },
        /* Clasificación por administración de la zona: DPV / Municipal / Otro */
        zona: {
          campo: ['zona', 'ZONA'],
          grupos: {
            'DPV':       (v) => String(v).toUpperCase().includes('DPV'),
            'MUNICIPAL': (v) => String(v).toUpperCase().includes('MUN'),
            'OTRO':      (v) => true
          },
          campoKm: ['km', 'KM']
        }
      },
      idCampo: ['id', 'ID'],
      elementoFijo: 'Vialidad'
    },

    cordon: {
      id: 'cordon-layer',
      source: 'cordon-source',
      label: 'Cordón',
      camposFicha: [
        ['info-id-tramo',    'label-id-tramo',    ['id_tramo', 'ID_TRAMO'], 'ID Tramo'],
        ['info-zona',        'label-zona',        ['zona', 'ZONA'], 'Zona'],
        ['info-km',          'label-km',          ['km', 'KM'], 'KM'],
        ['info-lado',        'label-lado',        ['lado', 'LADO'], 'Lado'],
        ['info-cordon',      'label-cordon',      ['cordon', 'CORDON'], 'Cordón'],
        ['info-cord-estado', 'label-cord-estado', ['cord_estado', 'CORD_ESTADO'], 'Estado Cordón'],
        ['info-km-cordon',   'label-km-cordon',   ['km_cordon', 'KM_CORDON'], 'KM Cordón'],
        ['info-fecha',       'label-fecha',       ['fecha', 'FECHA'], 'Fecha']
      ],
      camposSecundarios: [],
      kpis: { presencia: { campo: ['cordon', 'CORDON'], campoKm: ['km_cordon', 'KM_CORDON'], valorEsperado: 'SI' } },
      idCampo: ['id_tramo', 'ID_TRAMO', 'id', 'ID'],
      elementoFijo: 'Cordón'
    },

    banquina_vereda: {
      id: 'banquina-vereda-layer',
      source: 'banquina-vereda-source',
      label: 'Banquina / Vereda',
      camposFicha: [
        ['info-id-tramo',    'label-id-tramo',    ['id_tramo', 'ID_TRAMO'], 'ID Tramo'],
        ['info-zona',        'label-zona',        ['zona', 'ZONA'], 'Zona'],
        ['info-km',          'label-km',          ['km', 'KM'], 'KM'],
        ['info-lado',        'label-lado',        ['lado', 'LADO'], 'Lado'],
        ['info-banq-vrda',   'label-banq-vrda',   ['banq_vrda', 'BANQ_VRDA'], 'Banq. / Vereda'],
        ['info-b-v-estado',  'label-b-v-estado',  ['b_v_estado', 'B_V_ESTADO'], 'Estado B/V'],
        ['info-km-b-v',      'label-km-b-v',      ['km_b_v', 'KM_B_V'], 'KM B/V'],
        ['info-fecha',       'label-fecha',       ['fecha', 'FECHA'], 'Fecha']
      ],
      camposSecundarios: [],
      kpis: { presencia: { campo: ['banq_vrda', 'BANQ_VRDA'], campoKm: ['km_b_v', 'KM_B_V'], valorEsperado: 'SI' } },
      idCampo: ['id_tramo', 'ID_TRAMO', 'id', 'ID'],
      elementoFijo: 'Banquina / Vereda'
    },

    cuneta: {
      id: 'cuneta-layer',
      source: 'cuneta-source',
      label: 'Cuneta',
      camposFicha: [
        ['info-id-tramo',    'label-id-tramo',    ['id_tramo', 'ID_TRAMO'], 'ID Tramo'],
        ['info-zona',        'label-zona',        ['zona', 'ZONA'], 'Zona'],
        ['info-km',          'label-km',          ['km', 'KM'], 'KM'],
        ['info-lado',        'label-lado',        ['lado', 'LADO'], 'Lado'],
        ['info-cuneta',      'label-cuneta',      ['cuneta', 'CUNETA'], 'Cuneta'],
        ['info-cun-mat',     'label-cun-mat',     ['cun_mat', 'CUN_MAT'], 'Material Cuneta'],
        ['info-km-cuneta',   'label-km-cuneta',   ['km_cuneta', 'KM_CUNETA'], 'KM Cuneta'],
        ['info-fecha',       'label-fecha',       ['fecha', 'FECHA'], 'Fecha']
      ],
      camposSecundarios: [],
      kpis: { presencia: { campo: ['cuneta', 'CUNETA'], campoKm: ['km_cuneta', 'KM_CUNETA'], valorEsperado: 'SI' } },
      idCampo: ['id_tramo', 'ID_TRAMO', 'id', 'ID'],
      elementoFijo: 'Cuneta'
    },

    arbolado: {
      id: 'arbolado-layer',
      source: 'arbolado-source',
      label: 'Árboles',
      /* Estructura estricta solicitada: 8 campos principales */
      fichaPrimaria: [
        { etiqueta: 'ID',         campos: ['id', 'ID'] },
        { etiqueta: 'CALLE',      campos: ['calle', 'CALLE'] },
        { etiqueta: 'DIMENSION',  campos: ['dimension', 'DIMENSION'] },
        { etiqueta: 'ESTADO_S',   campos: ['estado_s', 'ESTADO_S', 'ESTADO'] },
        { etiqueta: 'ESPECIE',    campos: ['especie', 'ESPECIE'] },
        { etiqueta: 'TRONCO',     campos: ['tronco', 'TRONCO'] },
        { etiqueta: 'BASE',       campos: ['base', 'BASE'] },
        { etiqueta: 'F_STREET_W', campos: ['f_street_v', 'F_STREET_V', 'f_street_w', 'F_STREET_W'] }
      ],
      /* Resto de campos bajo "Ver más campos" */
      fichaSecundaria: [
        { etiqueta: 'Ubicación',                 campos: ['ubicacion', 'UBICACION'] },
        { etiqueta: 'Distancia entre arboles (m)', campos: ['distancia', 'DISTANCIA', 'dist_arboles', 'DIST_ARBOLES'] },
        { etiqueta: 'Presencia de nicho',        campos: ['nicho', 'NICHO', 'presencia_nicho', 'PRESENCIA_NICHO'] },
        { etiqueta: 'Estado vegetativo',         campos: ['estado_vegetativo', 'ESTADO_VEGETATIVO'] },
        { etiqueta: 'Estado sanitario',          campos: ['estado_sanitario', 'ESTADO_SANITARIO'] },
        { etiqueta: 'Antigüedad',                campos: ['antiguedad', 'ANTIGUEDAD'] },
        { etiqueta: 'Riego',                     campos: ['riego', 'RIEGO'] },
        { etiqueta: 'Observaciones',             campos: ['observaciones', 'OBSERVACIONES', 'obs'] },
        { etiqueta: 'calle',                     campos: ['calle_norm', 'CALLE_NORM', 'calle_n'] },
        { etiqueta: 'rumbo',                     campos: ['rumbo', 'RUMBO'] }
      ],
      kpis: {
        estado: {
          campo: ['estado_s', 'ESTADO_S', 'ESTADO'],
          grupos: {
            'BUENO':   (v) => String(v).toUpperCase() === 'BUENO',
            'REGULAR': (v) => String(v).toUpperCase() === 'REGULAR',
            'MALO':    (v) => String(v).toUpperCase() === 'MALO',
            'OTROS':   (v) => true
          }
        },
        especie: { campo: ['especie', 'ESPECIE'] }
      },
      idCampo: ['id', 'ID'],
      elementoFijo: 'Arbolado'
    },

    reclamos: {
      id: 'reclamos-layer',
      source: 'reclamos-source',
      label: 'Solicitudes',
      camposFicha: [
        ['info-codigo',      'label-codigo',      ['Nro', 'nro', 'codigo', 'CODIGO'], 'Código (Nro)'],
        ['info-usuario',     'label-usuario',     ['Usuario', 'usuario', 'USUARIO'], 'Usuario'],
        ['info-area',        'label-area',        ['Área', 'area', 'AREA'], 'Área'],
        ['info-tipo',        'label-tipo',        ['Tipo de reclamo', 'tipo', 'TIPO'], 'Tipo de reclamo'],
        ['info-descripcion', 'label-descripcion', ['Descripción del reclamo', 'descripcion', 'DESCRIPCION'], 'Descripción'],
        ['info-fecha',       'label-fecha',       ['Fecha', 'fecha', 'FECHA'], 'Fecha'],
        ['info-solucion',    'label-solucion',    ['Fecha Solución', 'fecha_solucion', 'FECHA_SOLUCION'], 'Fecha Solución']
      ],
      camposSecundarios: [],
      kpis: {
        tipo: {
          campo: ['tipo', 'TIPO', 'Tipo de reclamo', 'TIPO_RECLAMO'],
          grupos: {
            'Luminaria': (v) => String(v).toUpperCase().includes('LUMINARIA'),
            'Otros':     (v) => true
          }
        }
      },
      idCampo: ['Nro', 'nro', 'id', 'ID'],
      elementoFijo: 'Reclamo'
    }

  }
};
