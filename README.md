# LUX VISION — Visor de Activos Urbanos

Visor GIS municipal (MapLibre GL) para monitorear luminarias, arbolado,
vialidades, lateral vial (cordón / banquina-vereda / cuneta) y solicitudes
de vecinos, con ficha técnica, Street View, estadísticas y exportación PDF.

## Estructura

| Archivo      | Rol                                                        |
|--------------|------------------------------------------------------------|
| `config.js`  | **Único archivo a editar** para replicar en otro municipio |
| `app.js`     | Núcleo del visor (no requiere cambios entre municipios)    |
| `styles.css` | Estilos y tokens visuales                                  |
| `index.html` | Estructura y CDN (MapLibre, Chart.js, jsPDF, html2canvas)  |

## Replicar en otro municipio

1. **Identidad** — en `config.js → municipio`: nombre, título, centro/zoom
   inicial del mapa y logos.
2. **Datos** — exportar las capas como GeoJSON (WGS84) y apuntarlas en
   `config.js → fuentes`. Nombres de archivo sugeridos: uno por capa, más
   `distritos` para el filtro por distrito.
3. **Mapeo de atributos** — declarar en `camposGlobales`, `popupReclamos` y
   en cada `capas.*` los nombres de los campos de TUS datos. El visor tolera
   mayúsculas/minúsculas: declará todas las variantes (`campo`, `CAMPO`).
4. **Servir** — cualquier servidor estático sirve (`npx serve`, nginx, etc.).
   No requiere build.

## Notas

- Los KPI y el panel de estadísticas reflejan el filtro por distrito activo.
- `window.LUX` (consola) expone mapa, datos y funciones para depurar.
- La URL de GeoServer en `config.js → geoserver` queda reservada para una
  futura migración de GeoJSON estático a WFS.
