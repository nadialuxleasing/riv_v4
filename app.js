/* ============================================================================
   LUX VISION · Núcleo del visor (v2.2 — refactor UI/UX + interacción geométrica)
   ----------------------------------------------------------------------------
   Todo lo municipal vive en `config.js`. Este archivo es agnóstico al municipio.

   Índice de módulos:

     01 · Configuración y constantes
     02 · Estado global
     03 · Helpers
     04 · Mapa (inicialización, tema, mapas base)
     05 · Widget de coordenadas en vivo
     06 · Buscador de direcciones (Nominatim / OSM)
     06.B · Geocodificación inversa (clic → dirección en la ficha)
     07 · Carga de datos GeoJSON + Google Sheets (reclamos en CSV) + FALLBACK
     08 · Construcción de capas (simbología 100% desde CONFIG.simbologia)
     09 · Leyenda dinámica (mismos colores que el mapa)
     10 · Interacción con el mapa (click → ficha, Street View, popup)
     11 · Ficha lateral dinámica (por capa, sin estructuras fijas)
     12 · Branding y fecha de actualización
     13 · Botones de capas del encabezado
     14 · KPIs
     15 · Filtros por distrito (turf + buffer configurable + fallback a luminarias)
     16 · Selección espacial por rectángulo (BBOX con queryRenderedFeatures)
     17 · Panel de estadísticas
     18 · Utilidades de UI
     19 · Exportación PDF
     20 · Arranque
   ============================================================================ */


/* ══════════════════════════════════════════════════════════════════════
   01 · CONFIGURACIÓN Y CONSTANTES
   ══════════════════════════════════════════════════════════════════════ */

const APP_CONFIG = window.LUX_CONFIG;
if (!APP_CONFIG) {
    throw new Error('[LUX] Falta config.js o window.LUX_CONFIG no está definido.');
}

const FUENTES_DATA  = APP_CONFIG.fuentes;
const CONFIG_CAPAS  = APP_CONFIG.capas;
const PALETA        = APP_CONFIG.simbologia;
const CONFIG_UI     = APP_CONFIG.ui;

/** GeoJSON vacío de referencia. */
const geojsonVacio = { type: 'FeatureCollection', features: [] };

/** Mapas base disponibles. */
const ESTILOS_MAPA = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: {
        version: 8,
        sources: { 'osm-tiles': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
        layers: [{ id: 'osm-layer', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }]
    },
    satellite: {
        version: 8,
        sources: { 'satellite-tiles': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Tiles © Esri' } },
        layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', minzoom: 0, maxzoom: 24 }]
    }
};

/** IDs de las capas con ficha técnica. */
const capasInteractivas = () => Object.values(CONFIG_CAPAS).map(c => c.id);

/** Capas prioritarias para filtrado por distrito (si el rendimiento es crítico). */
const CAPAS_PRIORITARIAS = CONFIG_UI.filtradoPrioritario || ['luminarias', 'arbolado'];


/* ══════════════════════════════════════════════════════════════════════
   02 · ESTADO GLOBAL
   ══════════════════════════════════════════════════════════════════════ */

let estiloActual = localStorage.getItem('map-style') || 'light';
let modoCalorArbolado = false;
let filtroCategoriaLuminarias = null;

let capasData = {
    luminarias: geojsonVacio,
    arbolado: geojsonVacio,
    vialidades: geojsonVacio,
    reclamos: geojsonVacio,
    cordon: geojsonVacio,
    banquina_vereda: geojsonVacio,
    cuneta: geojsonVacio
};

let distritosData = geojsonVacio;

const visibilidadCapas = {
    luminarias: true, arbolado: true, vialidades: true,
    reclamos: true, cordon: true, banquina_vereda: true, cuneta: true
};

window.datosActualesParaKPI = capasData;

let filtroActivo = { tipo: 'todos', nombre: null, geometria: null };

/** Guarda el feature actualmente seleccionado (para limpiar estados). */
let featureSeleccionado = null;


/* ══════════════════════════════════════════════════════════════════════
   03 · HELPERS
   ══════════════════════════════════════════════════════════════════════ */

function getCampo(props, camposAlt, def = null) {
    if (!props || !Array.isArray(camposAlt)) return def;
    for (const c of camposAlt) {
        if (props[c] !== undefined && props[c] !== null && props[c] !== '') return props[c];
    }
    return def;
}

function getCampoUpper(props, campos, def = '') {
    return String(getCampo(props, campos, def)).trim().toUpperCase();
}

function getCampoNumero(props, campos, def = 0) {
    const val = getCampo(props, campos, null);
    if (val === null) return def;
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
}

function getConfigPorCapaId(layerId) {
    for (const key of Object.keys(CONFIG_CAPAS)) {
        if (CONFIG_CAPAS[key].id === layerId) return { key, config: CONFIG_CAPAS[key] };
    }
    return null;
}

function datosActuales() {
    return window.datosActualesParaKPI || capasData;
}

function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (el) el.innerText = valor;
}

/** Aplica un conjunto filtrado a todas las fuentes y refresca UI. */
function aplicarDatosFiltrados(filtradas) {
    Object.keys(capasData).forEach(key => {
        const sourceId = `${key}-source`;
        if (map.getSource(sourceId)) map.getSource(sourceId).setData(filtradas[key]);
    });
    window.datosActualesParaKPI = filtradas;
    filtroCategoriaLuminarias = null;
    calcularKPIs();
    refrescarStatsSiAbierto();
}

function restaurarDatosCompletos() {
    filtroActivo = { tipo: 'todos', nombre: null, geometria: null };
    aplicarDatosFiltrados(capasData);
    limpiarSeleccion();
    resetearFicha();
    const sel = document.getElementById('filtro-distrito');
    if (sel) sel.value = 'Todos';
}


/* ══════════════════════════════════════════════════════════════════════
   04 · MAPA
   ══════════════════════════════════════════════════════════════════════ */

const map = new maplibregl.Map({
    container: 'map',
    style: ESTILOS_MAPA[estiloActual],
    center: APP_CONFIG.municipio.mapaInicial.center,
    zoom: APP_CONFIG.municipio.mapaInicial.zoom,
    preserveDrawingBuffer: true
});

const styleSelect = document.getElementById('map-style-select');
const themeToggleBtn = document.getElementById('theme-toggle');
let modoVisual = localStorage.getItem('theme-mode') || 'light';

function cambiarEstiloMapa(nuevoEstilo) {
    if (!ESTILOS_MAPA[nuevoEstilo]) return;
    estiloActual = nuevoEstilo;
    localStorage.setItem('map-style', nuevoEstilo);
    if (styleSelect.value !== nuevoEstilo) styleSelect.value = nuevoEstilo;
    map.setStyle(ESTILOS_MAPA[estiloActual]);
    map.once('idle', () => inyectarFuentesYCapas());
}

function aplicarModoVisual(modo) {
    modoVisual = modo;
    const esOscuro = modo === 'dark';
    document.documentElement.classList.toggle('dark', esOscuro);
    document.documentElement.dataset.theme = esOscuro ? 'dark' : 'light';
    if (themeToggleBtn) {
        themeToggleBtn.setAttribute('aria-pressed', String(esOscuro));
        themeToggleBtn.title = esOscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    }
    localStorage.setItem('theme-mode', modo);
}
aplicarModoVisual(modoVisual);

styleSelect.addEventListener('change', (e) => {
    const estilo = e.target.value;
    if (estilo === 'dark' || estilo === 'light') aplicarModoVisual(estilo);
    cambiarEstiloMapa(estilo);
});

themeToggleBtn.addEventListener('click', () => {
    const nuevoModo = modoVisual === 'dark' ? 'light' : 'dark';
    aplicarModoVisual(nuevoModo);
    if (nuevoModo === 'dark') cambiarEstiloMapa('dark');
    if (nuevoModo === 'light' && estiloActual === 'dark') cambiarEstiloMapa('light');
});

function aplicarModoCalorArbolado(activo) {
    modoCalorArbolado = Boolean(activo);
    if (map.getLayer('arbolado-heatmap-layer')) {
        map.setLayoutProperty('arbolado-heatmap-layer', 'visibility', activo ? 'visible' : 'none');
    }
    if (map.getLayer('arbolado-layer')) {
        map.setPaintProperty('arbolado-layer', 'circle-opacity', activo ? 0.22 : 0.85);
    }
    const btn = document.getElementById('btn-heatmap-arbolado');
    if (btn) btn.classList.toggle('is-active', activo);
}


/* ══════════════════════════════════════════════════════════════════════
   05 · WIDGET DE COORDENADAS EN VIVO
   ══════════════════════════════════════════════════════════════════════ */

function inicializarWidgetCoordenadas() {
    const el = document.getElementById('coords-value');
    if (!el) return;
    const dec = CONFIG_UI.coordenadas.decimales;

    const formatear = (lngLat) =>
        `Lat ${lngLat.lat.toFixed(dec)} · Lon ${lngLat.lng.toFixed(dec)}`;

    map.on('mousemove', (e) => { el.textContent = formatear(e.lngLat); });
    map.on('mouseout',  () => { el.textContent = '— · —'; });
    map.on('click', (e) => { el.textContent = formatear(e.lngLat); });
}


/* ══════════════════════════════════════════════════════════════════════
   06 · BUSCADOR DE DIRECCIONES (NOMINATIM / OSM)
   ══════════════════════════════════════════════════════════════════════ */

function inicializarBuscadorOSM() {
    const input   = document.getElementById('osm-search-input');
    const resultados = document.getElementById('osm-search-results');
    if (!input || !resultados) return;

    let temporizador = null;
    let marcadorBusqueda = null;

    const construirUrl = (q) => {
        const p = new URLSearchParams({ ...CONFIG_UI.busqueda.params, q });
        if (CONFIG_UI.busqueda.viewbox) p.set('viewbox', CONFIG_UI.busqueda.viewbox);
        if (CONFIG_UI.busqueda.bounded) p.set('bounded', CONFIG_UI.busqueda.bounded);
        return `${CONFIG_UI.busqueda.url}?${p.toString()}`;
    };

    const limpiarResultados = () => { resultados.innerHTML = ''; resultados.classList.add('hidden'); };

    const irALugar = (item) => {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        map.flyTo({ center: [lon, lat], zoom: CONFIG_UI.busqueda.zoomResultado });

        if (marcadorBusqueda) marcadorBusqueda.remove();
        marcadorBusqueda = new maplibregl.Marker({ color: PALETA.seleccion.ANILLO })
            .setLngLat([lon, lat])
            .setPopup(new maplibregl.Popup().setText(item.display_name))
            .addTo(map);

        input.value = item.display_name;
        limpiarResultados();
    };

    const renderResultados = (items) => {
        resultados.innerHTML = '';
        if (!items.length) { limpiarResultados(); return; }
        items.forEach(item => {
            const li = document.createElement('button');
            li.type = 'button';
            li.className = 'osm-result-item';
            li.textContent = item.display_name;
            li.addEventListener('click', () => irALugar(item));
            resultados.appendChild(li);
        });
        resultados.classList.remove('hidden');
    };

    input.addEventListener('input', () => {
        clearTimeout(temporizador);
        const q = input.value.trim();
        if (q.length < 3) { limpiarResultados(); return; }

        temporizador = setTimeout(async () => {
            try {
                const res = await fetch(construirUrl(q));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                renderResultados(await res.json());
            } catch (err) {
                console.error('[LUX] Error en búsqueda Nominatim', err);
                limpiarResultados();
            }
        }, CONFIG_UI.busqueda.debounceMs);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#osm-search-box')) limpiarResultados();
    });
}


/* ══════════════════════════════════════════════════════════════════════
   06.B · GEOCODIFICACIÓN INVERSA
   ══════════════════════════════════════════════════════════════════════ */

let consultaInversaEnCurso = false;

function mostrarClicEnFicha(lngLat) {
    const el = document.getElementById('coords-click-value');
    if (el) {
        const dec = CONFIG_UI.coordenadas.decimales;
        el.textContent = `Lat ${lngLat.lat.toFixed(dec)} · Lon ${lngLat.lng.toFixed(dec)}`;
    }
    consultaInversaNominatim(lngLat);
}

function consultaInversaNominatim(lngLat) {
    if (!CONFIG_UI.busqueda.reverseGeocode || consultaInversaEnCurso) return;
    const cont = document.getElementById('info-ubicacion');
    if (!cont) return;

    consultaInversaEnCurso = true;
    const p = new URLSearchParams({
        format: 'jsonv2', lat: lngLat.lat, lon: lngLat.lng,
        'accept-language': 'es', zoom: 18
    });

    fetch(`${CONFIG_UI.busqueda.reverseUrl}?${p.toString()}`)
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then(json => {
            const direccion = json?.display_name;
            if (direccion) {
                cont.textContent = direccion;
                cont.classList.remove('hidden');
            } else {
                cont.classList.add('hidden');
            }
        })
        .catch(err => {
            console.warn('[LUX] Reverse geocoding no disponible', err);
            cont.classList.add('hidden');
        })
        .finally(() => { consultaInversaEnCurso = false; });
}


/* ══════════════════════════════════════════════════════════════════════
   07 · CARGA DE DATOS (CON FALLBACK PARA RECLAMOS)
   ══════════════════════════════════════════════════════════════════════ */

function normalizarGeoJSON(data, key) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        console.error(`[LUX] GeoJSON inválido en la fuente "${key}"`, data);
        return geojsonVacio;
    }
    return data;
}

function parsearCSV(texto) {
    const filas = [];
    let fila = [], campo = '', entreComillas = false;
    for (let i = 0; i < texto.length; i++) {
        const ch = texto[i];
        if (entreComillas) {
            if (ch === '"') {
                if (texto[i + 1] === '"') { campo += '"'; i++; }
                else entreComillas = false;
            } else campo += ch;
        } else if (ch === '"') entreComillas = true;
        else if (ch === ',') { fila.push(campo); campo = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && texto[i + 1] === '\n') i++;
            fila.push(campo); campo = '';
            if (fila.length > 1 || fila[0] !== '') filas.push(fila);
            fila = [];
        } else campo += ch;
    }
    if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
}

function csvReclamosAGeoJSON(texto) {
    const cfgCsv = APP_CONFIG.reclamosCsv || {};
    const filas = parsearCSV(texto);
    if (filas.length < 2) return geojsonVacio;

    const cabeceras = filas[0].map(h => h.trim());
    const idxDe = (variantes) => {
        for (const v of variantes || []) {
            const i = cabeceras.findIndex(h => h.toLowerCase() === String(v).toLowerCase());
            if (i >= 0) return i;
        }
        return -1;
    };

    const iLat = idxDe(cfgCsv.camposCoordenadas?.lat);
    const iLng = idxDe(cfgCsv.camposCoordenadas?.lng);
    const iNro  = idxDe(['Nro', 'nro', 'codigo', 'CODIGO']);
    const iUsr  = idxDe(APP_CONFIG.popupReclamos.usuario);
    const iArea = idxDe(APP_CONFIG.popupReclamos.area);
    const iTipo = idxDe(APP_CONFIG.popupReclamos.tipo);
    const iDesc = idxDe(APP_CONFIG.popupReclamos.descripcion);
    const iFec  = idxDe(APP_CONFIG.popupReclamos.fecha);
    const iSol  = idxDe(APP_CONFIG.popupReclamos.fechaSolucion);

    if (iLat < 0 || iLng < 0) {
        console.warn('[LUX] CSV de reclamos sin columnas de coordenadas reconocibles.');
        return geojsonVacio;
    }

    const val = (fila, i) => (i >= 0 ? String(fila[i] ?? '').trim() : '');
    const features = [];
    filas.slice(1).forEach(fila => {
        const lat = parseFloat(val(fila, iLat).replace(',', '.'));
        const lng = parseFloat(val(fila, iLng).replace(',', '.'));
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
                nro: val(fila, iNro), usuario: val(fila, iUsr), area: val(fila, iArea),
                tipo: val(fila, iTipo), descripcion: val(fila, iDesc),
                fecha: val(fila, iFec), fecha_solucion: val(fila, iSol)
            }
        });
    });

    console.info(`[LUX] Reclamos integrados: ${features.length} registros.`);
    return { type: 'FeatureCollection', features };
}

/**
 * Carga los reclamos desde Google Sheets con FALLBACK automático a un
 * GeoJSON local (`reclamos_rv.geojson`) si la petición remota falla
 * por red, CORS, HTTP != 200 o payload inválido.
 */
function cargarReclamosDesdeSheets() {
    const url = APP_CONFIG.reclamosCsv?.url || FUENTES_DATA.reclamos;
    const fallbackUrl = APP_CONFIG.reclamosCsv?.fallbackUrl
        || FUENTES_DATA.reclamosFallback
        || './reclamos_rv.geojson';

    const cargarFallback = (motivo) => {
        console.warn(`[LUX] Reclamos: usando fallback local "${fallbackUrl}" — motivo: ${motivo}`);
        return fetch(fallbackUrl, { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
                return res.json();
            })
            .then(json => ({ key: 'reclamos', data: normalizarGeoJSON(json, 'reclamos') }))
            .catch(err => {
                console.error('[LUX] Fallback de reclamos también falló', err);
                return { key: 'reclamos', data: geojsonVacio };
            });
    };

    return fetch(url, { cache: 'no-store' })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ct = res.headers.get('content-type') || '';
            return (ct.includes('json') && !url.includes('out:csv')) ? res.json() : res.text();
        })
        .then(payload => {
            const data = (typeof payload === 'string')
                ? csvReclamosAGeoJSON(payload)
                : normalizarGeoJSON(payload, 'reclamos');

            if (!data.features || data.features.length === 0) {
                return cargarFallback('CSV remoto sin features válidas');
            }
            console.info(`[LUX] Reclamos remotos OK: ${data.features.length} registros.`);
            return { key: 'reclamos', data };
        })
        .catch(error => cargarFallback(error?.message || String(error)));
}

function cargarTodosLosGeoJSON() {
    const peticiones = Object.keys(FUENTES_DATA).map(key => {
        if (key === 'reclamos' || key === 'reclamosFallback') return null;
        return fetch(FUENTES_DATA[key], { cache: 'no-store' })
            .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json(); })
            .then(json => ({ key, data: normalizarGeoJSON(json, key) }))
            .catch(error => {
                console.error(`[LUX] No se pudo cargar la fuente "${key}"`, error);
                return { key, data: geojsonVacio };
            });
    }).filter(Boolean);

    // Reclamos: loader dedicado con fallback.
    peticiones.push(cargarReclamosDesdeSheets());

    Promise.all(peticiones).then(resultados => {
        resultados.forEach(res => {
            if (res.key === 'distritos') distritosData = res.data;
            else capasData[res.key] = res.data;
        });

        window.datosActualesParaKPI = capasData;
        inyectarFuentesYCapas();
        registrarInteraccionMapa();
        configurarBotonesPrenderApagar();
        calcularKPIs();
        inicializarFiltroDistritos();
        actualizarFechaDesdeCapas();
        renderizarLeyenda();
        sincronizarColoresDesplegables();
    });
}


/* ══════════════════════════════════════════════════════════════════════
   08 · CONSTRUCCIÓN DE CAPAS
   ══════════════════════════════════════════════════════════════════════ */

function colorPorTecnologiaLuminaria() {
    const campos = CONFIG_CAPAS.luminarias.simbologiaCampo;
    const valor = ['upcase', ['to-string', ['coalesce', ...campos.map(c => ['get', c]), '']]];
    return ['case',
        ['in', 'LED', valor], PALETA.luminarias.LED,
        ['any', ['in', 'SAP', valor], ['in', 'SODIO', valor]], PALETA.luminarias.SODIO,
        PALETA.luminarias.OTROS];
}

function colorPorEstadoArbolado() {
    const campo = CONFIG_CAPAS.arbolado.kpis.estado.campo;
    return ['match', ['upcase', ['coalesce', ...campo.map(c => ['get', c]), 'OTROS']],
        'BUENO',   PALETA.arbolado.BUENO,
        'REGULAR', PALETA.arbolado.REGULAR,
        'MALO',    PALETA.arbolado.MALO,
        PALETA.arbolado.OTROS];
}

function inyectarFuentesYCapas() {
    const vis = key => visibilidadCapas[key] ? 'visible' : 'none';
    const datos = datosActuales();

    agregarCapaLinea('cordon', 'cordon-source', 'cordon-layer',
        { color: PALETA.lateralVial.CORDON, ancho: 1.8, opacidad: 0.82 });
    agregarCapaLinea('banquina_vereda', 'banquina-vereda-source', 'banquina-vereda-layer',
        { color: PALETA.lateralVial.BANQUINA_VEREDA, ancho: 1.6, opacidad: 0.78 });
    agregarCapaLinea('cuneta', 'cuneta-source', 'cuneta-layer',
        { color: PALETA.lateralVial.CUNETA, ancho: 1.5, opacidad: 0.78 });

    // ── Vialidades: color por JURISDICCIÓN (DPV / MUNICIPAL / OTRO) ────

    if (!map.getSource('vialidades-source')) {
        map.addSource('vialidades-source', { type: 'geojson', data: datos.vialidades });
        map.addLayer({
            id: 'vialidades-layer', type: 'line', source: 'vialidades-source',
            paint: {
                'line-width': 3.2,
                'line-color': [
                    'match',
                    ['upcase', ['coalesce',
                        ['get', 'zona'], ['get', 'ZONA'],
                        ['get', 'jurisdiccion'], ['get', 'JURISDICCION'],
                        ''
                    ]],
                    'MUNICIPAL', PALETA.vialidadesPorZona.MUNICIPAL,
                    'MUN',       PALETA.vialidadesPorZona.MUNICIPAL,
                    'DPV',       PALETA.vialidadesPorZona.DPV,
                    PALETA.vialidadesPorZona.OTRO
                ]
            },
            layout: { visibility: vis('vialidades'), 'line-cap': 'round', 'line-join': 'round' }
        });
    }

    if (!map.getSource('arbolado-source')) {
        map.addSource('arbolado-source', { type: 'geojson', data: datos.arbolado });
        const hm = PALETA.heatmapArbolado;
        map.addLayer({
            id: 'arbolado-heatmap-layer', type: 'heatmap', source: 'arbolado-source', maxzoom: 18,
            paint: {
                'heatmap-weight': 1,
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 17, 1.5],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 17, 28],
                'heatmap-opacity': 0.72,
                'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
                    0, hm[0], 0.25, hm[1], 0.5, hm[2], 0.75, hm[3], 1, hm[4]]
            },
            layout: { visibility: modoCalorArbolado ? 'visible' : 'none' }
        });
        map.addLayer({
            id: 'arbolado-layer', type: 'circle', source: 'arbolado-source',
            paint: {
                'circle-radius': 4, 'circle-opacity': 0.85, 'circle-stroke-width': 0.5,
                'circle-stroke-color': 'rgba(15, 23, 42, 0.4)',
                'circle-color': colorPorEstadoArbolado()
            },
            layout: { visibility: vis('arbolado') }
        });
    }

    if (!map.getSource('luminarias-source')) {
        map.addSource('luminarias-source', { type: 'geojson', data: datos.luminarias });
        map.addLayer({
            id: 'luminarias-layer', type: 'circle', source: 'luminarias-source',
            paint: {
                'circle-color': colorPorTecnologiaLuminaria(),
                'circle-radius': 4, 'circle-stroke-width': 0.8, 'circle-stroke-color': '#0f172a'
            },
            layout: { visibility: vis('luminarias') }
        });
    }

    if (!map.getSource('reclamos-source')) {
        map.addSource('reclamos-source', { type: 'geojson', data: datos.reclamos });
        map.addLayer({
            id: 'reclamos-layer', type: 'circle', source: 'reclamos-source',
            paint: {
                'circle-color': PALETA.reclamos.HALO, 'circle-radius': 10,
                'circle-opacity': 0.38, 'circle-blur': 0.35,
                'circle-stroke-width': 1.8, 'circle-stroke-color': PALETA.reclamos.TRAZO,
                'circle-stroke-opacity': 0.90
            },
            layout: { visibility: vis('reclamos') }
        });
        map.addLayer({
            id: 'reclamos-punteado-layer', type: 'symbol', source: 'reclamos-source',
            layout: { 'text-field': '···', 'text-size': 12, 'text-allow-overlap': true, visibility: vis('reclamos') },
            paint: {
                'text-color': PALETA.reclamos.TEXTO, 'text-opacity': 0.95,
                'text-halo-color': PALETA.reclamos.TRAZO, 'text-halo-width': 0.6
            }
        });
    }
}

function agregarCapaLinea(dataKey, sourceId, layerId, estilo) {
    if (map.getSource(sourceId)) return;
    map.addSource(sourceId, { type: 'geojson', data: datosActuales()[dataKey] });
    map.addLayer({
        id: layerId, type: 'line', source: sourceId,
        paint: { 'line-color': estilo.color, 'line-width': estilo.ancho, 'line-opacity': estilo.opacidad },
        layout: { visibility: visibilidadCapas[dataKey] ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' }
    });
}


/* ══════════════════════════════════════════════════════════════════════
   09 · LEYENDA DINÁMICA
   ══════════════════════════════════════════════════════════════════════ */

function renderizarLeyenda() {
    const cont = document.getElementById('legend-body');
    if (!cont) return;
    const S = PALETA;

    const filaPunto = (color, texto) =>
        `<div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full border border-slate-500" style="background:${color}"></span>${texto}</div>`;
    const filaLinea = (color, texto, alto = 3) =>
        `<div class="flex items-center gap-2"><span class="w-7 rounded" style="height:${alto}px;background:${color}"></span>${texto}</div>`;

    cont.innerHTML = `
        <div class="legend-group-title">Luminarias</div>
        ${filaPunto(S.luminarias.LED, 'LED')}
        ${filaPunto(S.luminarias.SODIO, 'Sodio / SAP')}
        ${filaPunto(S.luminarias.OTROS, 'Otros')}
        <div class="legend-group-title">Arbolado</div>
        ${filaPunto(S.arbolado.BUENO, 'Bueno')}
        ${filaPunto(S.arbolado.REGULAR, 'Regular')}
        ${filaPunto(S.arbolado.MALO, 'Malo')}
        <div class="legend-group-title">Vialidad</div>
                <div class="legend-group-title">Vialidad (por jurisdicción)</div>
        ${filaLinea(PALETA.vialidadesPorZona.MUNICIPAL, 'Municipal')}
        ${filaLinea(PALETA.vialidadesPorZona.DPV, 'DPV')}
        ${filaLinea(PALETA.vialidadesPorZona.OTRO, 'Otro')}
        <div class="legend-group-title">Lateral Vial</div>

        ${filaLinea(S.lateralVial.CORDON, 'Cordón', 2)}
        ${filaLinea(S.lateralVial.BANQUINA_VEREDA, 'Banquina / Vereda', 2)}
        ${filaLinea(S.lateralVial.CUNETA, 'Cuneta', 2)}
        <div class="legend-group-title">Solicitudes</div>
        <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full blur-[1px] border" style="background:${S.reclamos.HALO}33;border-color:${S.reclamos.TRAZO}"></span>
            Solicitud
        </div>`;
}

function sincronizarColoresDesplegables() {
    document.querySelectorAll('[data-sym]').forEach(el => {
        const [grupo, categoria] = el.dataset.sym.split(':');
        const color = PALETA[grupo]?.[categoria];
        if (color) {
            el.style.background = color;
            el.classList.remove('bg-cyan-400', 'bg-orange-400', 'bg-slate-400',
                               'bg-slate-700', 'bg-slate-500', 'bg-slate-300',
                               'bg-slate-800', 'bg-slate-600');
        }
    });
}


/* ══════════════════════════════════════════════════════════════════════
   10 · INTERACCIÓN CON EL MAPA
   ══════════════════════════════════════════════════════════════════════ */

let interaccionRegistrada = false;

function registrarInteraccionMapa() {
    if (interaccionRegistrada) return;
    interaccionRegistrada = true;

    map.on('click', (e) => {
        if (herramientaBbox.activa) return;

        mostrarClicEnFicha(e.lngLat);

        const features = map.queryRenderedFeatures(e.point, { layers: capasInteractivas() });

        // ── DESELECCIÓN: clic en área libre sin entidades ──
        if (!features || features.length === 0) {
            limpiarSeleccion();
            resetearFicha();
            return;
        }

        const feature = features[0];
        featureSeleccionado = feature;

        if (feature.layer.id === CONFIG_CAPAS.reclamos.id) {
            abrirPopupReclamo(feature);
        }
        mostrarFicha(feature);
    });

    map.on('mousemove', (e) => {
        if (herramientaBbox.activa) return;
        const features = map.queryRenderedFeatures(e.point, { layers: capasInteractivas() });
        map.getCanvas().style.cursor = (features && features.length) ? 'pointer' : '';
    });
}

/** Selecciona la ficha lateral del feature clicado. */
function mostrarFicha(feature) {
    const props = feature.properties || {};
    const configInfo = getConfigPorCapaId(feature.layer.id);
    if (!configInfo) return;
    const { key, config } = configInfo;

    setTexto('info-id', getCampo(props, config.idCampo, 'N/A'));
    setTexto('info-elemento', config.elementoFijo || getCampo(props, ['elemento', 'ELEMENTO'], '-'));

    if (key === 'arbolado' && config.fichaPrimaria) {
        renderizarFichaArbolado(props, config);
    } else {
        renderizarFichaGenerica(props, config);
    }

    actualizarStreetView(feature);
}

/**
 * FICHA DINÁMICA POR CAPA (requerimiento 5).
 * Renderiza SOLO los campos de la capa seleccionada dentro de
 * `#campos-dinamicos`, limpiando el contenedor en cada llamada para
 * evitar residuos de la selección anterior.
 */
function renderizarFichaGenerica(props, config) {
    const cont = document.getElementById('campos-dinamicos');
    if (!cont) return;

    // 1) Limpieza total del contenedor dinámico (evita campos residuales).
    cont.innerHTML = '';

    // 2) Ocultar la ficha estructurada del arbolado si estaba visible.
    const bloqueArb = document.getElementById('ficha-arbolado');
    if (bloqueArb) bloqueArb.classList.add('hidden');

    // 3) Render de cada campo del config de la capa actual.
    const celda = (textoLabel, valor) => `
        <div class="ficha-celda border-b border-r border-slate-200 dark:border-slate-800">
            <span class="ficha-label">${textoLabel}</span>
            <span class="ficha-valor">${String(valor)}</span>
        </div>`;

    const renderCampo = ([, , camposAlt, textoLabel]) => {
        const valor = getCampo(props, camposAlt, null);
        const sinDato = valor === null || valor === undefined || valor === ''
            || valor === 'null' || valor === 'Sin Dato' || valor === 'N/A';
        return sinDato ? '' : celda(textoLabel, valor);
    };

    // Primarios (siempre visibles).
    cont.insertAdjacentHTML('beforeend',
        (config.camposFicha || []).map(renderCampo).join(''));

    // Secundarios (acordeón "Ver más campos").
    const contSec = document.getElementById('campos-secundarios');
    if (contSec) {
        contSec.innerHTML = (config.camposSecundarios || []).map(renderCampo).join('');
        contSec.classList.toggle('hidden', !contSec.innerHTML.trim());
    }

    // Reset visual del acordeón.
    const label = document.getElementById('label-ver-mas');
    const chevron = document.getElementById('chevron-ver-mas');
    if (label) label.textContent = 'Ver más campos';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
}

/**
 * FICHA ESTRUCTURADA DEL ARBOLADO (8 campos + "ver más").
 * Se renderiza en los contenedores dedicados, ocultando el dinámico.
 */
function renderizarFichaArbolado(props, config) {
    const bloqueArb = document.getElementById('ficha-arbolado');
    const contDinamico = document.getElementById('campos-dinamicos');
    const contSec = document.getElementById('campos-secundarios');
    if (!bloqueArb) return;

    if (contDinamico) contDinamico.innerHTML = '';
    if (contSec) { contSec.innerHTML = ''; contSec.classList.add('hidden'); }

    bloqueArb.classList.remove('hidden');

    const celda = (etiqueta, valor) => `
        <div class="ficha-celda border-b border-r border-slate-200 dark:border-slate-800">
            <span class="ficha-label">${etiqueta}</span>
            <span class="ficha-valor">${(valor !== null && valor !== '') ? valor : '-'}</span>
        </div>`;

    document.getElementById('ficha-arbolado-primaria').innerHTML =
        config.fichaPrimaria.map(c => celda(c.etiqueta, getCampo(props, c.campos, null))).join('');

    document.getElementById('ficha-arbolado-secundaria').innerHTML =
        config.fichaSecundaria.map(c => celda(c.etiqueta, getCampo(props, c.campos, null))).join('');

    // Reset visual del acordeón (aplica al panel de arbolado).
    const label = document.getElementById('label-ver-mas');
    const chevron = document.getElementById('chevron-ver-mas');
    if (label) label.textContent = 'Ver más campos';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
}

/**
 * RESETEO DE LA FICHA LATERAL: borra cualquier residuo de la selección
 * previa, vuelve al estado neutro y oculta los bloques dinámicos.
 */
function resetearFicha() {
    featureSeleccionado = null;

    setTexto('info-id', '-');
    setTexto('info-elemento', '-');

    const contDinamico = document.getElementById('campos-dinamicos');
    if (contDinamico) contDinamico.innerHTML = '';

    const contSec = document.getElementById('campos-secundarios');
    if (contSec) { contSec.innerHTML = ''; contSec.classList.add('hidden'); }

    const bloqueArb = document.getElementById('ficha-arbolado');
    if (bloqueArb) bloqueArb.classList.add('hidden');
    const arbPrim = document.getElementById('ficha-arbolado-primaria');
    const arbSec  = document.getElementById('ficha-arbolado-secundaria');
    if (arbPrim) arbPrim.innerHTML = '';
    if (arbSec)  { arbSec.innerHTML = ''; arbSec.classList.add('hidden'); }

    const iframe = document.getElementById('street-view-frame');
    const ph = document.getElementById('sv-placeholder');
    if (iframe) { iframe.src = ''; iframe.classList.add('hidden'); }
    if (ph) ph.classList.remove('hidden');

    const btnSv = document.getElementById('btn-sv-external');
    if (btnSv) {
        btnSv.href = '#';
        btnSv.classList.add('pointer-events-none', 'opacity-50');
    }

    const ubic = document.getElementById('info-ubicacion');
    if (ubic) { ubic.textContent = ''; ubic.classList.add('hidden'); }

    const coordClick = document.getElementById('coords-click-value');
    if (coordClick) coordClick.textContent = '— · —';

    window.activoSeleccionadoLat = null;
    window.activoSeleccionadoLon = null;

    const label = document.getElementById('label-ver-mas');
    const chevron = document.getElementById('chevron-ver-mas');
    if (label) label.textContent = 'Ver más campos';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
}

function coordsDelFeature(feature) {
    const geom = feature.geometry;
    if (!geom) return null;
    if (geom.type === 'Point') return geom.coordinates;
    if (geom.type === 'LineString' && geom.coordinates.length) {
        return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    }
    return null;
}

function actualizarStreetView(feature) {
    const coords = coordsDelFeature(feature);
    if (!coords) return;

    const [lon, lat] = coords;
    const strLat = lat.toString();
    const strLon = lon.toString();

    window.activoSeleccionadoLat = strLat;
    window.activoSeleccionadoLon = strLon;
    destacarPuntoEnMapa(lon, lat);

    const iframe = document.getElementById('street-view-frame');
    const placeholder = document.getElementById('sv-placeholder');

    if (placeholder) placeholder.classList.add('hidden');
    if (iframe) {
        iframe.classList.remove('hidden');
        iframe.src = `https://maps.google.com/maps?q=${strLat},${strLon}&cbll=${strLat},${strLon}&layer=c&panoid=&cbp=12,0,0,0,0&source=embed&output=svembed`;
    }

    const btn = document.getElementById('btn-sv-external');
    if (btn) {
        btn.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${strLat},${strLon}`;
        btn.classList.remove('pointer-events-none', 'opacity-50');
    }
}

function destacarPuntoEnMapa(lng, lat) {
    const sourceId = 'source-seleccion-activo';
    const punto = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } }]
    };

    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(punto);
        return;
    }

    map.addSource(sourceId, { type: 'geojson', data: punto });
    map.addLayer({
        id: 'layer-seleccion-glow', type: 'circle', source: sourceId,
        paint: { 'circle-radius': 22, 'circle-color': PALETA.seleccion.ANILLO, 'circle-opacity': 0.15 }
    });
    map.addLayer({
        id: 'layer-seleccion-ring', type: 'circle', source: sourceId,
        paint: {
            'circle-radius': 16, 'circle-color': 'transparent',
            'circle-stroke-width': 2, 'circle-stroke-color': PALETA.seleccion.ANILLO,
            'circle-stroke-opacity': 0.6
        }
    });
    map.addLayer({
        id: 'layer-seleccion-activo', type: 'circle', source: sourceId,
        paint: {
            'circle-radius': 8, 'circle-color': PALETA.seleccion.CENTRO,
            'circle-stroke-width': 3, 'circle-stroke-color': PALETA.seleccion.ANILLO
        }
    });
}

function limpiarSeleccion() {
    const sourceId = 'source-seleccion-activo';
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData({ type: 'FeatureCollection', features: [] });
    }
}


/* ══════════════════════════════════════════════════════════════════════
   11 · POPUP DE SOLICITUDES
   ══════════════════════════════════════════════════════════════════════ */

function abrirPopupReclamo(feature) {
    const props = feature.properties || {};
    const coords = coordsDelFeature(feature) || [];
    const P = APP_CONFIG.popupReclamos;

    const descripcion   = getCampo(props, P.descripcion, 'Sin descripción');
    const tipo          = getCampo(props, P.tipo, 'No especificado');
    const usuario       = getCampo(props, P.usuario, 'No especificado');
    const area          = getCampo(props, P.area, 'Sin área');
    const fecha         = getCampo(props, P.fecha, 'Sin dato');
    const fechaSolucion = getCampo(props, P.fechaSolucion, 'Pendiente');

    const html = `
        <div style="font-family: var(--font-ui, sans-serif); padding: 12px; max-width: 300px; color: #0f172a;">
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #e2e8f0; padding-bottom:8px; margin-bottom:10px;">
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:#dc2626; letter-spacing:0.05em;">Detalle del Reclamo</span>
                <span style="font-size:9.5px; font-weight:700; background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px;">${tipo}</span>
            </div>
            <p style="font-size:11.5px; margin:0 0 10px 0; background:#f8fafc; padding:8px; border-radius:6px; border:1px solid #f1f5f9;">${descripcion}</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                <div style="background:#f8fafc; padding:6px 8px; border-radius:6px;"><small style="font-size:8.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Área</small><br><b style="font-size:10.5px;">${area}</b></div>
                <div style="background:#f8fafc; padding:6px 8px; border-radius:6px;"><small style="font-size:8.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Usuario</small><br><b style="font-size:10.5px;">${usuario}</b></div>
                <div style="background:#f1f5f9; padding:6px 8px; border-radius:6px;"><small style="font-size:8.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Fecha</small><br><b style="font-size:10.5px;">${fecha}</b></div>
                <div style="background:#f1f5f9; padding:6px 8px; border-radius:6px;"><small style="font-size:8.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Solución</small><br><b style="font-size:10.5px; color:#059669;">${fechaSolucion}</b></div>
            </div>
        </div>
    `;

    new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '310px' })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);
}


/* ══════════════════════════════════════════════════════════════════════
   12 · BRANDING Y FECHA DE ACTUALIZACIÓN
   ══════════════════════════════════════════════════════════════════════ */

function aplicarConfiguracionMunicipal() {
    const { municipio } = APP_CONFIG;
    document.title = `Lux Vision — ${municipio.tituloAplicacion}`;

    const h1 = document.querySelector('header h1');
    if (h1) {
        h1.innerHTML = `${municipio.tituloAplicacion} <span class="text-slate-500 mx-1.5">•</span> Municipio de ${municipio.nombre}`;
    }

    // Asignación por ID (más robusto que por orden de querySelectorAll).
    const brandLux = document.getElementById('brand-lux');
    const brandMun = document.getElementById('brand-municipio');
    if (brandLux) brandLux.href = municipio.branding.logoLux.href;
    if (brandMun) brandMun.href = municipio.branding.logoMunicipio.href;

    const imgLux = brandLux?.querySelector('img');
    const imgMun = brandMun?.querySelector('img');
    if (imgLux) imgLux.src = municipio.branding.logoLux.src;
    if (imgMun) imgMun.src = municipio.branding.logoMunicipio.src;
}

function actualizarFechaDesdeCapas() {
    const camposFecha = APP_CONFIG.camposGlobales.fechaActualizacion;
    let fechaMax = null;

    (capasData.luminarias.features || []).forEach(f => {
        const val = getCampo(f.properties || {}, camposFecha, null);
        if (!val || val === 'null' || val === 'None') return;

        let fecha = null;
        const strVal = String(val).trim();
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(strVal)) {
            const [d, m, y] = strVal.split(/[\/\-]/);
            fecha = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
        } else {
            fecha = new Date(strVal);
        }

        if (fecha && !isNaN(fecha.getTime()) && fecha.getFullYear() >= 2020) {
            if (!fechaMax || fecha > fechaMax) fechaMax = fecha;
        }
    });

    const el = document.getElementById('fecha-ultima-actualizacion');
    if (!el) return;
    el.innerText = fechaMax
        ? fechaMax.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : 'Sin dato';
}


/* ══════════════════════════════════════════════════════════════════════
   13 · BOTONES DE CAPAS DEL ENCABEZADO
   ══════════════════════════════════════════════════════════════════════ */

function configurarBotonesPrenderApagar() {
    const definiciones = {
        luminarias:  { btn: 'btn-mod-luminarias', layers: ['luminarias-layer'] },
        arbolado:    { btn: 'btn-mod-arbolado',   layers: ['arbolado-layer'] },
        vialidades:  { btn: 'btn-mod-vialidades', layers: ['vialidades-layer'] },
        cordon:      { btn: 'btn-mod-cordon',     layers: ['cordon-layer', 'banquina-vereda-layer', 'cuneta-layer'], keys: ['cordon', 'banquina_vereda', 'cuneta'] },
        reclamos:    { btn: 'btn-mod-reclamos',   layers: ['reclamos-layer', 'reclamos-punteado-layer'] }
    };

    const setEstadoVisual = (btn, activo) => {
        if (!btn) return;
        btn.classList.toggle('layer-button-off', !activo);
        btn.classList.toggle('layer-button-on', activo);
        btn.setAttribute('aria-pressed', String(activo));
    };

    const aplicarVisibilidad = (key, activo) => {
        const def = definiciones[key];
        (def.keys || [key]).forEach(k => { visibilidadCapas[k] = activo; });
        def.layers.forEach(layerId => {
            if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', activo ? 'visible' : 'none');
        });
        setEstadoVisual(document.getElementById(def.btn), activo);
    };

    const estanTodosActivos = () => Object.keys(definiciones).every(key =>
        (definiciones[key].keys || [key]).every(k => visibilidadCapas[k]));

    Object.entries(definiciones).forEach(([key, def]) => {
        const btn = document.getElementById(def.btn);
        if (!btn || btn.dataset.ready === '1') return;
        btn.dataset.ready = '1';

        const keys = def.keys || [key];
        setEstadoVisual(btn, keys.some(k => visibilidadCapas[k]));
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            aplicarVisibilidad(key, !keys.some(k => visibilidadCapas[k]));
            actualizarBotonTodos();
        });
    });

    const btnTodos = document.getElementById('btn-mod-todos');
    const actualizarBotonTodos = () => {
        if (!btnTodos) return;
        btnTodos.classList.toggle('opacity-50', !estanTodosActivos());
        btnTodos.setAttribute('aria-pressed', String(estanTodosActivos()));
    };

    if (btnTodos && btnTodos.dataset.ready !== '1') {
        btnTodos.dataset.ready = '1';
        btnTodos.addEventListener('click', (e) => {
            e.preventDefault();
            const encender = !estanTodosActivos();
            Object.keys(definiciones).forEach(key => aplicarVisibilidad(key, encender));
            actualizarBotonTodos();
        });
    }
    actualizarBotonTodos();
}


/* ══════════════════════════════════════════════════════════════════════
   14 · KPIs
   ══════════════════════════════════════════════════════════════════════ */

function calcularKPIs() {
    const datos = datosActuales();

    // ── Luminarias ──
    const luminarias = datos.luminarias?.features || [];
    const totalLum = luminarias.length;
    const camposTec = CONFIG_CAPAS.luminarias?.kpis?.tecnologia?.campo
        || ['sap', 'SAP', 'tipo', 'TIPO', 'tecnologia', 'TECNOLOGIA', 'tipologia', 'TIPOLOGIA'];

    let led = 0, sodio = 0, otrosLum = 0;
    luminarias.forEach(f => {
        const tipo = getCampoUpper(f.properties || {}, camposTec, '');
        if (tipo.includes('LED')) led++;
        else if (tipo.includes('SAP') || tipo.includes('SODIO')) sodio++;
        else otrosLum++;
    });
    setTexto('kpi-total', totalLum.toLocaleString());
    setTexto('kpi-led', `${led.toLocaleString()} (${pct(led, totalLum)})`);
    setTexto('kpi-sodio', `${sodio.toLocaleString()} (${pct(sodio, totalLum)})`);
    setTexto('kpi-lum-otros', `${otrosLum.toLocaleString()} (${pct(otrosLum, totalLum)})`);

    // ── Arbolado ──
    const arbolado = datos.arbolado?.features || [];
    const campoEstado = CONFIG_CAPAS.arbolado?.kpis?.estado?.campo || ['estado_s', 'ESTADO_S', 'ESTADO'];
    const estados = { BUENO: 0, REGULAR: 0, MALO: 0, OTROS: 0 };
    arbolado.forEach(f => {
        const v = getCampoUpper(f.properties || {}, campoEstado, '');
        if (v === 'BUENO') estados.BUENO++;
        else if (v === 'REGULAR') estados.REGULAR++;
        else if (v === 'MALO') estados.MALO++;
        else estados.OTROS++;
    });
    setTexto('kpi-arb-total', arbolado.length.toLocaleString());
    const idsEstado = { BUENO: 'kpi-arb-bueno', REGULAR: 'kpi-arb-regular', MALO: 'kpi-arb-malo', OTROS: 'kpi-arb-otros' };
    Object.entries(idsEstado).forEach(([k, id]) => {
        setTexto(id, `${estados[k].toLocaleString()} (${pct(estados[k], arbolado.length)})`);
    });

    // ── Vialidades por superficie ──
    const viales = datos.vialidades?.features || [];
    const cfgVial = CONFIG_CAPAS.vialidades?.kpis?.superficie || {};
    const kmVial = { PAVIMENTADO: 0, CONSOLIDADA: 0, TIERRA: 0, 'SIN DATO': 0 };
    viales.forEach(f => {
        const props = f.properties || {};
        const sup = getCampoUpper(props, cfgVial.campo || ['superficie', 'SUPERFICIE'], 'SIN DATO');
        const km = getCampoNumero(props, cfgVial.campoKm || ['km', 'KM'], 0);
        if (sup.includes('PAVIMENTADO')) kmVial.PAVIMENTADO += km;
        else if (sup.includes('CONSOLIDADA')) kmVial.CONSOLIDADA += km;
        else if (sup.includes('TIERRA')) kmVial.TIERRA += km;
        else kmVial['SIN DATO'] += km;
    });
    const totalKm = Object.values(kmVial).reduce((a, b) => a + b, 0);
    setTexto('kpi-vial-total', `${totalKm.toFixed(1)} km`);
    setTexto('kpi-vial-pav', `${kmVial.PAVIMENTADO.toFixed(1)} km`);
    setTexto('kpi-vial-cons', `${kmVial.CONSOLIDADA.toFixed(1)} km`);
    setTexto('kpi-vial-tierra', `${kmVial.TIERRA.toFixed(1)} km`);
    setTexto('kpi-vial-sd', `${kmVial['SIN DATO'].toFixed(1)} km`);

    // ── Vialidades por zona ──
    const cfgZonaVial = CONFIG_CAPAS.vialidades?.kpis?.zona;
    if (cfgZonaVial) {
        const kmZona = { DPV: 0, MUNICIPAL: 0, OTRO: 0 };
        viales.forEach(f => {
            const props = f.properties || {};
            const z = getCampoUpper(props, cfgZonaVial.campo, '');
            const km = getCampoNumero(props, cfgZonaVial.campoKm || ['km', 'KM'], 0);
            if (z.includes('DPV')) kmZona.DPV += km;
            else if (z.includes('MUN')) kmZona.MUNICIPAL += km;
            else kmZona.OTRO += km;
        });
        setTexto('kpi-vial-dpv', `${kmZona.DPV.toFixed(1)} km`);
        setTexto('kpi-vial-mun', `${kmZona.MUNICIPAL.toFixed(1)} km`);
        setTexto('kpi-vial-otro', `${kmZona.OTRO.toFixed(1)} km`);
    }

    // ── Lateral vial ──
    const kmCordon = sumarKmPresencia(datos, 'cordon');
    const kmBanq = sumarKmPresencia(datos, 'banquina_vereda');
    const kmCuneta = sumarKmPresencia(datos, 'cuneta');
    setTexto('kpi-cordon-total', `${(kmCordon + kmBanq + kmCuneta).toFixed(1)} km`);
    setTexto('kpi-cordon-con', `${kmCordon.toFixed(1)} km`);
    setTexto('kpi-banquina-con', `${kmBanq.toFixed(1)} km`);
    setTexto('kpi-cuneta-con', `${kmCuneta.toFixed(1)} km`);

    // ── Solicitudes ──
    const reclamos = datos.reclamos?.features || [];
    const campoTipoRec = CONFIG_CAPAS.reclamos?.kpis?.tipo?.campo || ['TIPO_S', 'tipo_s'];
    const rec = { INFRA: 0, MANT: 0, OBRA: 0, LED: 0, REP: 0 };
    reclamos.forEach(f => {
        const v = getCampoUpper(f.properties || {}, campoTipoRec, '');
        if (v === 'INFRAESTRUCTURA') rec.INFRA++;
        else if (v === 'MANTENIMIENTO OPERATIVO') rec.MANT++;
        else if (v === 'OBRA / EXTENSION DE RED' || v === 'OBRA / EXTENSIÓN DE RED') rec.OBRA++;
        else if (v === 'RECONVERSION LED' || v === 'RECONVERSIÓN LED') rec.LED++;
        else if (v === 'REPARACION / REPOSICION' || v === 'REPARACIÓN / REPOSICIÓN') rec.REP++;
    });
    setTexto('kpi-rec-total', reclamos.length.toLocaleString());
    setTexto('kpi-rec-infra', rec.INFRA.toLocaleString());
    setTexto('kpi-rec-mant', rec.MANT.toLocaleString());
    setTexto('kpi-rec-obra', rec.OBRA.toLocaleString());
    setTexto('kpi-rec-led', rec.LED.toLocaleString());
    setTexto('kpi-rec-rep', rec.REP.toLocaleString());
}

function pct(parte, total) {
    return total ? ((parte / total) * 100).toFixed(1) + '%' : '0%';
}

function sumarKmPresencia(datos, capaKey) {
    const cfg = CONFIG_CAPAS[capaKey]?.kpis?.presencia;
    if (!cfg) return 0;
    return (datos[capaKey]?.features || []).reduce((acc, f) => {
        const props = f.properties || {};
        const presente = getCampoUpper(props, cfg.campo, '') === String(cfg.valorEsperado || 'SI').toUpperCase();
        return acc + (presente ? getCampoNumero(props, cfg.campoKm, 0) : 0);
    }, 0);
}


/* ══════════════════════════════════════════════════════════════════════
   15 · FILTROS POR DISTRITO (turf + prioridad de capas)
   ══════════════════════════════════════════════════════════════════════ */

const norm = s => String(s || '').trim().toUpperCase();

function geometriaConsultaDistrito(distritoFeature) {
    const metros = CONFIG_UI.filtroDistrito.bufferMetros || 0;
    if (metros > 0 && typeof turf !== 'undefined') {
        try {
            return turf.buffer(distritoFeature, metros / 1000, { units: 'kilometers' });
        } catch (err) {
            console.warn('[LUX] turf.buffer falló; se usa el polígono sin buffer', err);
        }
    }
    return distritoFeature;
}

function featureIntersectaGeometria(feature, geometriaConsulta) {
    try {
        if (typeof turf === 'undefined') throw new Error('[LUX] Turf.js no cargado');
        const geom = feature.geometry;
        if (!geom) return false;
        if (geom.type === 'Point') {
            return turf.booleanPointInPolygon(feature, geometriaConsulta);
        }
        return turf.booleanIntersects(feature, geometriaConsulta);
    } catch (err) {
        const pt = coordsRepresentativas(feature);
        const polys = (geometriaConsulta.geometry?.type === 'FeatureCollection')
            ? geometriaConsulta.features : [geometriaConsulta];
        return pt ? polys.some(p => puntoEnPoligono(pt, p.geometry)) : false;
    }
}

function puntoEnPoligono(pt, geom) {
    const [x, y] = pt;
    const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
        : geom.type === 'MultiPolygon' ? geom.coordinates.map(r => r[0])
        : [];
    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
    }
    return inside;
}

function coordsRepresentativas(feature) {
    const g = feature.geometry;
    if (!g) return null;
    if (g.type === 'Point') return g.coordinates;
    if (g.type === 'LineString') return g.coordinates[Math.floor(g.coordinates.length / 2)];
    if (g.type === 'Polygon') return g.coordinates[0][0];
    if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
    return null;
}

/**
 * Filtro espacial por distrito (Select by Location).
 * Optimización: los puntos usan booleanPointInPolygon (más rápido);
 * las líneas usan booleanIntersects. Si turf falla, cae al ray-casting.
 */
function aplicarFiltroGeometrico(geometriaConsulta, nombreFiltro) {
    const filtradas = {};
    const capasPuntuales = ['luminarias', 'arbolado', 'reclamos'];
    const capasLineales  = ['vialidades', 'cordon', 'banquina_vereda', 'cuneta'];

    capasPuntuales.forEach(key => {
        const features = (capasData[key]?.features || []).filter(f => {
            const pt = coordsRepresentativas(f);
            if (!pt) return false;
            try {
                if (typeof turf === 'undefined') throw new Error('turf no disponible');
                return turf.booleanPointInPolygon(turf.point(pt), geometriaConsulta);
            } catch {
                const polys = (geometriaConsulta.geometry?.type === 'FeatureCollection')
                    ? geometriaConsulta.features : [geometriaConsulta];
                return polys.some(p => puntoEnPoligono(pt, p.geometry));
            }
        });
        filtradas[key] = { type: 'FeatureCollection', features };
    });

    capasLineales.forEach(key => {
        const features = (capasData[key]?.features || []).filter(f =>
            featureIntersectaGeometria(f, geometriaConsulta)
        );
        filtradas[key] = { type: 'FeatureCollection', features };
    });

    filtroActivo = { tipo: 'distrito', nombre: nombreFiltro, geometria: geometriaConsulta };
    aplicarDatosFiltrados(filtradas);
}

function aplicarFiltroDistrito(nombreDistrito) {
    if (!nombreDistrito || norm(nombreDistrito) === norm('Todos')) {
        restaurarDatosCompletos();
        return;
    }
    const campoNombre = APP_CONFIG.camposGlobales.distritoNombre;
    const distritoFeat = (distritosData.features || []).find(f =>
        norm(getCampo(f.properties || {}, campoNombre, '')) === norm(nombreDistrito)
    );
    if (!distritoFeat) {
        console.warn(`[LUX] Distrito no encontrado: "${nombreDistrito}"`);
        return;
    }
    aplicarFiltroGeometrico(geometriaConsultaDistrito(distritoFeat), nombreDistrito);
}

function inicializarFiltroDistritos() {
    const select = document.getElementById('filtro-distrito');
    if (!select) return;

    const campoNombre = APP_CONFIG.camposGlobales.distritoNombre;
    const nombres = [...new Set(
        (distritosData.features || [])
            .map(f => getCampo(f.properties || {}, campoNombre, ''))
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    nombres.forEach(nombre => {
        const op = document.createElement('option');
        op.value = nombre;
        op.innerText = nombre;
        select.appendChild(op);
    });

    select.addEventListener('change', (e) => aplicarFiltroDistrito(e.target.value));
}


/* ══════════════════════════════════════════════════════════════════════
   16 · SELECCIÓN ESPACIAL POR RECTÁNGULO (BBOX)
   ══════════════════════════════════════════════════════════════════════ */

const herramientaBbox = {
    activa: false,
    arrastrando: false,
    inicioPx: null,
    capaRect: null,
    listeners: []
};

function crearOverlayRectangulo() {
    if (herramientaBbox.capaRect) herramientaBbox.capaRect.remove();
    const el = document.createElement('div');
    el.id = 'bbox-rect-overlay';
    document.getElementById('map').appendChild(el);
    herramientaBbox.capaRect = el;
    return el;
}

function alternarHerramientaBbox() {
    herramientaBbox.activa ? desactivarHerramientaBbox() : activarHerramientaBbox();
}

function activarHerramientaBbox() {
    herramientaBbox.activa = true;
    map.getCanvas().style.cursor = 'crosshair';
    map.dragPan.disable();

    const cont = document.getElementById('map');
    const overlay = crearOverlayRectangulo();
    const S = CONFIG_UI.seleccionBBox;

    const alMousedown = (e) => {
        if (e.button !== 0) return;
        herramientaBbox.arrastrando = true;
        herramientaBbox.inicioPx = { x: e.clientX, y: e.clientY };
        Object.assign(overlay.style, {
            display: 'block',
            borderColor: S.color,
            background: S.relleno,
            left: `${e.clientX}px`, top: `${e.clientY}px`, width: '0px', height: '0px'
        });
    };

    const alMousemove = (e) => {
        if (!herramientaBbox.arrastrando) return;
        const dx = e.clientX - herramientaBbox.inicioPx.x;
        const dy = e.clientY - herramientaBbox.inicioPx.y;
        Object.assign(overlay.style, {
            left: `${Math.min(e.clientX, herramientaBbox.inicioPx.x)}px`,
            top: `${Math.min(e.clientY, herramientaBbox.inicioPx.y)}px`,
            width: `${Math.abs(dx)}px`,
            height: `${Math.abs(dy)}px`
        });
    };

    const alMouseup = (e) => {
        if (!herramientaBbox.arrastrando) return;
        herramientaBbox.arrastrando = false;
        overlay.style.display = 'none';

        const rectCont = cont.getBoundingClientRect();
        const x1 = Math.min(e.clientX, herramientaBbox.inicioPx.x) - rectCont.left;
        const y1 = Math.min(e.clientY, herramientaBbox.inicioPx.y) - rectCont.top;
        const x2 = Math.max(e.clientX, herramientaBbox.inicioPx.x) - rectCont.left;
        const y2 = Math.max(e.clientY, herramientaBbox.inicioPx.y) - rectCont.top;

        // Clic sin arrastre → deseleccionar y resetear.
        if (Math.abs(x2 - x1) < 4 && Math.abs(y2 - y1) < 4) {
            limpiarSeleccion();
            resetearFicha();
            restaurarDatosCompletos();
            return;
        }

        // BBox en píxeles para queryRenderedFeatures nativo.
        const bboxPx = [[x1, y1], [x2, y2]];

        // Incluye capas PUNTUALES (árboles, luminarias, reclamos) y LINEALES.
        const layerIds = [
            'luminarias-layer', 'arbolado-layer', 'reclamos-layer',
            'vialidades-layer', 'cordon-layer', 'banquina-vereda-layer', 'cuneta-layer'
        ].filter(id => map.getLayer(id));

        const featuresPx = map.queryRenderedFeatures(bboxPx, { layers: layerIds });

        // Traducir px → lngLat para el pipeline de filtrado.
        const nw = map.unproject([x1, y1]);
        const se = map.unproject([x2, y2]);
        const bbox = [nw.lng, nw.lat, se.lng, se.lat];

        aplicarSeleccionBbox(bbox, featuresPx);
    };

    cont.addEventListener('mousedown', alMousedown);
    window.addEventListener('mousemove', alMousemove);
    window.addEventListener('mouseup', alMouseup);
    herramientaBbox.listeners = [
        [cont, 'mousedown', alMousedown],
        [window, 'mousemove', alMousemove],
        [window, 'mouseup', alMouseup]
    ];

    const btn = document.getElementById('btn-bbox-select');
    if (btn) btn.classList.add('tool-active');
}

function desactivarHerramientaBbox() {
    herramientaBbox.activa = false;
    herramientaBbox.arrastrando = false;
    map.getCanvas().style.cursor = '';
    map.dragPan.enable();

    herramientaBbox.listeners.forEach(([obj, evt, fn]) => obj.removeEventListener(evt, fn));
    herramientaBbox.listeners = [];
    if (herramientaBbox.capaRect) {
        herramientaBbox.capaRect.remove();
        herramientaBbox.capaRect = null;
    }

    const btn = document.getElementById('btn-bbox-select');
    if (btn) btn.classList.remove('tool-active');
}

/**
 * Filtra todas las capas contra el BBOX.
 * Usa `map.queryRenderedFeatures` para garantizar la inclusión de
 * entidades PUNTUALES (árboles, luminarias, reclamos) y refuerza con
 * turf.booleanIntersects para las líneas que cruzan el rectángulo.
 */
function aplicarSeleccionBbox(bbox, featuresPx = null) {
    let poligonoBbox;
    try {
        if (typeof turf === 'undefined') throw new Error('turf no disponible');
        poligonoBbox = turf.bboxPolygon(bbox);
    } catch (err) {
        const [minX, minY, maxX, maxY] = bbox;
        poligonoBbox = {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]] }
        };
    }

    // Índice de features detectadas por el motor nativo (dedupe por coords).
    const setNativoPorCapa = {};
    if (Array.isArray(featuresPx)) {
        featuresPx.forEach(f => {
            const capaKey = getConfigPorCapaId(f.layer?.id)?.key;
            if (!capaKey) return;
            const geom = f.geometry;
            if (!geom) return;
            const clave = geom.type === 'Point'
                ? JSON.stringify(geom.coordinates)
                : JSON.stringify(geom.coordinates?.[0] || '');
            (setNativoPorCapa[capaKey] ||= new Set()).add(clave);
        });
    }

    const filtradas = {};
    Object.keys(capasData).forEach(key => {
        const features = (capasData[key].features || []).filter(f => {
            // 1) Test geométrico estricto.
            if (featureIntersectaGeometria(f, poligonoBbox)) return true;
            // 2) Refuerzo: si el motor nativo lo detectó como punto, incluirlo.
            const geom = f.geometry;
            if (!geom || geom.type !== 'Point') return false;
            return setNativoPorCapa[key]?.has(JSON.stringify(geom.coordinates)) || false;
        });
        filtradas[key] = { type: 'FeatureCollection', features };
    });

    filtroActivo = { tipo: 'bbox', nombre: 'Selección por área', geometria: poligonoBbox };
    aplicarDatosFiltrados(filtradas);

    const totalSel = Object.values(filtradas).reduce((a, g) => a + g.features.length, 0);
    console.info(`[LUX] Selección BBOX: ${totalSel} entidades (puntos + líneas).`);
}


/* ══════════════════════════════════════════════════════════════════════
   17 · PANEL DE ESTADÍSTICAS
   ══════════════════════════════════════════════════════════════════════ */

const statsChartInstances = {};

function destruirChartsStats() {
    Object.keys(statsChartInstances).forEach(k => {
        statsChartInstances[k]?.destroy();
        delete statsChartInstances[k];
    });
}

function refrescarStatsSiAbierto() {
    const panel = document.getElementById('stats-panel');
    if (panel && !panel.classList.contains('translate-x-full')) {
        renderizarEstadisticas();
    }
}

function renderizarEstadisticas() {
    const cont = document.getElementById('stats-content');
    if (!cont) return;
    destruirChartsStats();

    const datos = datosActuales();

    const filaLimpia = (label, val, color) => `
        <div class="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
            <span class="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                <span class="w-2 h-2 rounded-full" style="background-color:${color};"></span>${label}
            </span>
            <span class="font-semibold text-xs text-slate-900 dark:text-slate-100">${val}</span>
        </div>`;

    const seccion = (titulo, contenido) => `
        <div class="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2">${titulo}</h3>
            ${contenido}
        </div>`;

    const fmtKW = v => v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kW';

    const totalLum = datos.luminarias?.features?.length || 0;
    const totalArb = datos.arbolado?.features?.length || 0;
    const totalRec = datos.reclamos?.features?.length || 0;

    let totalKmViales = 0;
    (datos.vialidades?.features || []).forEach(f =>
        totalKmViales += getCampoNumero(f.properties, ['km', 'KM'], 0));

    const kmCordon = sumarKmPresencia(datos, 'cordon');
    const kmBanq = sumarKmPresencia(datos, 'banquina_vereda');
    const kmCuneta = sumarKmPresencia(datos, 'cuneta');
    const totalKmLateral = kmCordon + kmBanq + kmCuneta;

    const maxVal = Math.max(totalLum, totalArb, totalRec, totalKmViales) || 1;
    const barra = (label, valor, colorClass) => {
        const pctBar = (valor / maxVal) * 100;
        return `
            <div class="space-y-1.5 mb-2.5">
                <div class="flex justify-between items-center text-xs">
                    <span class="font-medium text-slate-700 dark:text-slate-300">${label}</span>
                    <span class="font-semibold text-slate-900 dark:text-slate-100">${typeof valor === 'number' ? valor.toLocaleString() : valor}</span>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-md h-2 overflow-hidden">
                    <div class="${colorClass} h-2 rounded-md transition-all duration-500" style="width:${pctBar}%"></div>
                </div>
            </div>`;
    };

    let led = 0, otras = 0, wattsLed = 0, wattsOtras = 0, wattsTotal = 0;
    (datos.luminarias?.features || []).forEach(f => {
        const props = f.properties || {};
        const val = getCampoUpper(props, CONFIG_CAPAS.luminarias.kpis.tecnologia.campo, '');
        const pot = getCampoNumero(props, ['potencia', 'POTENCIA'], 0);
        if (val.includes('LED')) { led++; wattsLed += pot; } else { otras++; wattsOtras += pot; }
        wattsTotal += pot;
    });

    const especies = {};
    (datos.arbolado?.features || []).forEach(f => {
        const esp = getCampo(f.properties, CONFIG_CAPAS.arbolado.kpis.especie.campo, 'Sin especie');
        const k = (esp === '' || esp === 'NULL') ? 'Sin especie' : esp;
        especies[k] = (especies[k] || 0) + 1;
    });
    const topEspecies = Object.entries(especies).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxEsp = topEspecies[0]?.[1] || 1;

    const chipFiltro = filtroActivo.tipo !== 'todos'
        ? `<div class="text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-900/30 border border-cyan-200 dark:border-cyan-800 rounded-lg px-3 py-2">
               Filtro activo: ${filtroActivo.nombre} · <button id="btn-limpiar-filtro" class="underline cursor-pointer">quitar</button>
           </div>`
        : '';

    cont.className = 'space-y-4 p-2 overflow-y-auto max-h-[calc(100vh-80px)] pr-2';
    cont.innerHTML = `
        ${chipFiltro}
        ${seccion('Resumen General', `
            ${barra('Luminarias', totalLum, 'bg-blue-600')}
            ${barra('Árboles', totalArb, 'bg-emerald-600')}
            ${barra('Solicitudes', totalRec, 'bg-rose-500')}
            ${barra('Lateral Vial (km)', parseFloat(totalKmLateral.toFixed(1)), 'bg-slate-500')}
            ${barra('Vialidades (km)', parseFloat(totalKmViales.toFixed(1)), 'bg-indigo-600')}
        `)}
        ${seccion('Luminarias por Tecnología', `<div class="relative h-48 w-full"><canvas id="chart-tecnologia"></canvas></div>`)}
        ${seccion('Potencia Instalada', `
            <div class="space-y-2">
                ${filaLimpia('Total', fmtKW(wattsTotal / 1000), '#4f46e5')}
                ${filaLimpia('LED', fmtKW(wattsLed / 1000), PALETA.luminarias.LED)}
                ${filaLimpia('Otras', fmtKW(wattsOtras / 1000), '#94a3b8')}
            </div>`)}
        ${seccion('Arbolado por Especie', `
            <div class="space-y-3 pt-1">
                ${topEspecies.map(([nombre, cant]) => {
                    const p = (cant / maxEsp) * 100;
                    return `<div class="space-y-1">
                        <div class="flex justify-between text-xs">
                            <span class="truncate max-w-[150px] text-slate-700 dark:text-slate-300">${nombre}</span>
                            <span class="font-semibold">${cant.toLocaleString()}</span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-800 rounded h-1.5 overflow-hidden">
                            <div class="bg-emerald-600 h-1.5 rounded" style="width:${p}%"></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`)}
    `;

    const btnLimpiar = document.getElementById('btn-limpiar-filtro');
    if (btnLimpiar) btnLimpiar.addEventListener('click', () => {
        restaurarDatosCompletos();
    });

    const isDark = document.documentElement.classList.contains('dark');
    const labelColor = isDark ? '#e2e8f0' : '#334155';
    const ctx = document.getElementById('chart-tecnologia')?.getContext('2d');
    if (ctx) {
        statsChartInstances.tecnologia = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: [`LED (${led})`, `Otras (${otras})`],
                datasets: [{ data: [led, otras], backgroundColor: [PALETA.luminarias.LED, '#94a3b8'], borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { color: labelColor, font: { size: 11 }, boxWidth: 0, padding: 12 } } }
            }
        });
    }
}

function inicializarPanelEstadisticas() {
    const btn = document.getElementById('btn-stats');
    const btnClose = document.getElementById('btn-close-stats');
    const panel = document.getElementById('stats-panel');
    if (!btn || !btnClose || !panel) return;

    btn.addEventListener('click', () => {
        renderizarEstadisticas();
        panel.classList.remove('translate-x-full');
    });
    btnClose.addEventListener('click', () => {
        panel.classList.add('translate-x-full');
        destruirChartsStats();
    });
}


/* ══════════════════════════════════════════════════════════════════════
   18 · UTILIDADES DE UI
   ══════════════════════════════════════════════════════════════════════ */

function inicializarLeyenda() {
    const btn = document.getElementById('legend-toggle');
    const panel = document.getElementById('legend-panel');
    const chevron = document.getElementById('legend-chevron');
    if (!btn || !panel || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';
    panel.classList.add('hidden');

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const abrir = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !abrir);
        if (chevron) chevron.textContent = abrir ? '▴' : '▾';
    });
}

function inicializarAcordeonFicha() {
    const btn = document.getElementById('btn-ver-mas-campos');
    const panelGenerico = document.getElementById('campos-secundarios');
    const panelArbolado = document.getElementById('ficha-arbolado-secundaria');
    const chevron = document.getElementById('chevron-ver-mas');
    const label = document.getElementById('label-ver-mas');
    if (!btn || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const arbVisible = panelArbolado && !panelArbolado.parentElement.classList.contains('hidden');
        const objetivo = arbVisible ? panelArbolado : panelGenerico;
        if (!objetivo) return;
        const abrir = objetivo.classList.contains('hidden');
        objetivo.classList.toggle('hidden', !abrir);
        if (chevron) chevron.style.transform = abrir ? 'rotate(180deg)' : 'rotate(0deg)';
        if (label) label.textContent = abrir ? 'Ver menos campos' : 'Ver más campos';
    });
}

function inicializarFiltroCategoriasLuminarias() {
    document.querySelectorAll('[data-lum-category]').forEach(el => {
        if (el.dataset.ready === '1') return;
        el.dataset.ready = '1';
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            aplicarFiltroCategoriaLuminarias(el.dataset.lumCategory);
        });
    });
}

function inicializarHeatmapArbolado() {
    const btn = document.getElementById('btn-heatmap-arbolado');
    if (!btn || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        aplicarModoCalorArbolado(!modoCalorArbolado);
    });
}

function inicializarHerramientaBbox() {
    const btn = document.getElementById('btn-bbox-select');
    if (!btn || btn.dataset.ready === '1') return;
    btn.dataset.ready = '1';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        alternarHerramientaBbox();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && herramientaBbox.activa) desactivarHerramientaBbox();
    });
}

function clasificarTecnologiaLuminaria(feature) {
    const cfg = CONFIG_CAPAS.luminarias.kpis.tecnologia;
    const valor = getCampoUpper(feature?.properties || {}, cfg.campo, '');
    if (valor.includes('LED')) return 'LED';
    if (valor.includes('SAP') || valor.includes('SODIO')) return 'SODIO';
    return 'OTROS';
}

function aplicarFiltroCategoriaLuminarias(categoria) {
    filtroCategoriaLuminarias = (filtroCategoriaLuminarias === categoria) ? null : categoria;

    const base = datosActuales().luminarias || capasData.luminarias;
    const features = filtroCategoriaLuminarias
        ? (base.features || []).filter(f => clasificarTecnologiaLuminaria(f) === filtroCategoriaLuminarias)
        : (base.features || []);

    const source = map.getSource(CONFIG_CAPAS.luminarias.source);
    if (source) source.setData({ type: 'FeatureCollection', features });

    document.querySelectorAll('[data-lum-category]').forEach(el => {
        el.classList.toggle('is-active', el.dataset.lumCategory === filtroCategoriaLuminarias);
    });

    const counts = { LED: 0, SODIO: 0, OTROS: 0 };
    features.forEach(f => counts[clasificarTecnologiaLuminaria(f)]++);
    setTexto('kpi-total', features.length.toLocaleString());
    setTexto('kpi-led', `${counts.LED.toLocaleString()} (${pct(counts.LED, features.length)})`);
    setTexto('kpi-sodio', `${counts.SODIO.toLocaleString()} (${pct(counts.SODIO, features.length)})`);
    setTexto('kpi-lum-otros', `${counts.OTROS.toLocaleString()} (${pct(counts.OTROS, features.length)})`);
}


/* ══════════════════════════════════════════════════════════════════════
   19 · EXPORTACIÓN PDF
   ══════════════════════════════════════════════════════════════════════ */

function inicializarExportacionPDF() {
    const btnPdf = document.getElementById('btn-export-pdf');
    if (!btnPdf || btnPdf.dataset.ready === '1') return;
    btnPdf.dataset.ready = '1';

    btnPdf.addEventListener('click', () => {
        const { municipio } = APP_CONFIG;

        let mapaBase64 = null;
        let aspectHeight = 220;
        try {
            mapaBase64 = map.getCanvas().toDataURL('image/png');
            const mapaDom = document.getElementById('map');
            if (mapaDom && mapaDom.clientWidth > 0) {
                aspectHeight = Math.round(714 * (mapaDom.clientHeight / mapaDom.clientWidth));
            }
        } catch (err) {
            console.error('[LUX] No se pudo capturar el mapa', err);
        }

        const kpi = id => document.getElementById(id)?.innerText || '0';
        const infoId = document.getElementById('info-id')?.innerText || '-';
        const haySeleccion = infoId && infoId !== '-' && infoId.trim() !== '';

        let tablaFichaHtml = '';
        let enlaceGeoHtml = '';

        if (haySeleccion) {
            const g = id => document.getElementById(id)?.innerText || '-';
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${window.activoSeleccionadoLat},${window.activoSeleccionadoLon}`;
            enlaceGeoHtml = `
                <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:12px 15px; margin-bottom:20px; font-size:11px;">
                    <div style="font-weight:bold; color:#0369a1; margin-bottom:4px;">Geolocalización:</div>
                    <a href="${mapUrl}" target="_blank" style="color:#0284c7; word-break:break-all; font-weight:bold;">${mapUrl}</a>
                </div>`;

            tablaFichaHtml = `
                <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; margin-bottom:25px;">
                    <div style="background:#f8fafc; padding:10px 15px; border-bottom:1px solid #e2e8f0;">
                        <span style="font-size:11px; font-weight:bold; color:#475569; text-transform:uppercase; letter-spacing:0.05em;">Parámetros del Componente</span>
                        <span style="float:right; font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px;">ID: ${infoId}</span>
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <tbody>
                            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 12px; color:#64748b; width:40%;">Tipo de Elemento</td><td style="padding:8px 12px; font-weight:bold;">${g('info-elemento')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9; background:#fafaf9;"><td style="padding:8px 12px; color:#64748b;">Tecnología</td><td style="padding:8px 12px; font-weight:bold;">${g('info-tipo')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 12px; color:#64748b;">Potencia</td><td style="padding:8px 12px;">${g('info-potencia')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9; background:#fafaf9;"><td style="padding:8px 12px; color:#64748b;">Marca / Modelo</td><td style="padding:8px 12px;">${g('info-marca')} / ${g('info-modelo')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 12px; color:#64748b;">Calle</td><td style="padding:8px 12px; font-weight:bold;">${g('info-calle')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9; background:#fafaf9;"><td style="padding:8px 12px; color:#64748b;">Soporte</td><td style="padding:8px 12px;">${g('info-soporte')}</td></tr>
                            <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 12px; color:#64748b;">Función</td><td style="padding:8px 12px;">${g('info-funcion')} (${g('info-brazo')})</td></tr>
                            <tr><td style="padding:8px 12px; color:#64748b; background:#fafaf9;">Fecha Act</td><td style="padding:8px 12px; background:#fafaf9;">${g('info-fecha-act')}</td></tr>
                        </tbody>
                    </table>
                </div>`;
        } else {
            tablaFichaHtml = `<div style="padding:20px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; text-align:center; color:#64748b; font-size:11.5px; margin-bottom:25px;">Reporte general. Haga clic sobre un activo para incluir su ficha técnica.</div>`;
        }

        const printContainer = document.createElement('div');
        Object.assign(printContainer.style, {
            position: 'absolute', left: '-9999px', top: '-9999px',
            width: '794px', backgroundColor: '#fff', padding: '40px',
            fontFamily: 'Archivo, Inter, sans-serif', color: '#1e293b'
        });

        printContainer.innerHTML = `
            <div style="background:#040d3d; color:#fff; margin:-40px -40px 25px -40px; padding:25px 40px; border-bottom:4px solid #5a9cf2;">
                <h1 style="font-size:20px; margin:0 0 5px 0; text-transform:uppercase; letter-spacing:0.03em;">Reporte de Activos Urbanos</h1>
                <p style="font-size:11px; margin:0; color:#94a3b8;">Municipio de ${municipio.nombre} &bull; ${municipio.tituloAplicacion}</p>
            </div>

            <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;">Total de Activos Urbanos</h2>
            <div style="display:flex; gap:10px; margin-bottom:25px;">
                <div style="flex:1; background:#ecfeff; border:1px solid #06b6d4; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#0891b2; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Luminarias</div><div style="font-size:16px; font-weight:bold; color:#0891b2;">${kpi('kpi-total')}</div></div>
                <div style="flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#64748b; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Arbolado</div><div style="font-size:16px; font-weight:bold;">${kpi('kpi-arb-total')}</div></div>
                <div style="flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#64748b; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Vialidades</div><div style="font-size:16px; font-weight:bold;">${kpi('kpi-vial-total')}</div></div>
                <div style="flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#64748b; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Lateral Vial</div><div style="font-size:16px; font-weight:bold;">${kpi('kpi-cordon-total')}</div></div>
                <div style="flex:1; background:#fff5f5; border:1px solid #feb2b2; border-radius:6px; padding:10px; text-align:center;"><div style="font-size:9px; color:#c53030; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase;">Solicitudes</div><div style="font-size:16px; font-weight:bold; color:#c53030;">${kpi('kpi-rec-total')}</div></div>
            </div>

            <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;">Vista del Mapa</h2>
            <div style="width:100%; height:${aspectHeight}px; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; margin-bottom:25px; background:#f1f5f9;">
                ${mapaBase64
                    ? `<img src="${mapaBase64}" style="width:100%; height:100%; object-fit:contain; background:#0f172a;" />`
                    : `<div style="padding-top:80px; text-align:center; color:#64748b;">Mapa no disponible</div>`}
            </div>

            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                <h2 style="font-size:13px; color:#040d3d; border-left:4px solid #5a9cf2; padding-left:8px; text-transform:uppercase; letter-spacing:0.05em; margin:0;">Ficha del Elemento</h2>
                ${enlaceGeoHtml}
            </div>

            ${tablaFichaHtml}

            <div style="padding:12px; background:#f8fafc; border-radius:6px; border-left:4px solid #cbd5e1; font-size:10px; color:#64748b;">
                <strong>Nota:</strong> Generado el ${new Date().toLocaleString('es-AR')}.
            </div>
        `;

        document.body.appendChild(printContainer);

        html2canvas(printContainer, { scale: 2, useCORS: true, logging: false })
            .then(canvas => {
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
                pdf.save(`Reporte_Activos_${haySeleccion ? infoId.replace(/\s+/g, '_') : 'General'}.pdf`);
                document.body.removeChild(printContainer);
            })
            .catch(err => {
                console.error('[LUX] Error al generar el PDF', err);
                document.body.removeChild(printContainer);
            });
    });
}


/* ══════════════════════════════════════════════════════════════════════
   20 · ARRANQUE
   ══════════════════════════════════════════════════════════════════════ */

aplicarConfiguracionMunicipal();

map.on('load', () => cargarTodosLosGeoJSON());

document.addEventListener('DOMContentLoaded', () => {
    inicializarWidgetCoordenadas();
    inicializarBuscadorOSM();
    inicializarFiltroCategoriasLuminarias();
    inicializarHeatmapArbolado();
    inicializarHerramientaBbox();
    inicializarPanelEstadisticas();
    inicializarLeyenda();
    inicializarAcordeonFicha();
    inicializarExportacionPDF();
});

window.LUX = {
    map,
    get datos() { return datosActuales(); },
    get capas() { return capasData; },
    get filtro() { return filtroActivo; },
    aplicarFiltroDistrito,
    aplicarSeleccionBbox,
    restaurarDatosCompletos,
    calcularKPIs,
    resetearFicha,
    limpiarSeleccion
};
