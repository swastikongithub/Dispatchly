// Builds the MapLibre styles (PLAN.md §4.2) from design-tokens.json: real OpenStreetMap vector
// tiles (OpenFreeMap, OpenMapTiles schema, no key) drawn in the colours and widths of
// designs/html/map-*.html (PLAN.md §11.5). Widths and label sizes are the designs' 1:1 values.
//
// Labels have no `glyphs` URL: MapLibre then draws them with the page's own Inter Variable,
// taking the weight and style from the first font name ("Inter Variable SemiBold" → 600).

const weightNames = { 500: 'Medium', 600: 'SemiBold' };
const family = 'Inter Variable';

// OpenMapTiles road classes for the design's four road types. The design's network is sparse:
// a ring road, a few arterials and minor roads, and a barely visible street grid.
const roads = {
  ringRoad: ['motorway', 'trunk'],
  arterial: ['primary'],
  minorRoad: ['secondary'],
};
const streets = ['tertiary', 'minor', 'service'];

const name = [
  'coalesce',
  ['get', 'name:en'],
  ['get', 'name_en'],
  ['get', 'name:latin'],
  ['get', 'name'],
];
const isClass = (classes) => ['match', ['get', 'class'], classes, true, false];
const round = (n) => Math.round(n * 1000) / 1000;

export function mapStyle(tokens, theme) {
  const color = tokens.color.map[theme];
  const map = tokens.map;
  const label = map.label.mapStyle;
  const tracking = parseFloat(tokens.type.mapLabel.tracking);
  const labelFont = [`${family} ${weightNames[map.label.weight]}`, family];
  const waterFont = [`${family} ${weightNames[map.label.waterWeight]} Italic`, family];
  const line = { 'line-cap': 'round', 'line-join': 'round' };
  const linesOf = (classes) => ['all', ['==', ['geometry-type'], 'LineString'], isClass(classes)];

  const casing = (type) => ({
    id: `${kebab(type)}-casing`,
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    filter: linesOf(roads[type]),
    layout: line,
    paint: { 'line-color': color.casing, 'line-width': map[type].casing },
  });
  const road = (type, fill) => ({
    id: kebab(type),
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    filter: linesOf(roads[type]),
    layout: line,
    paint: { 'line-color': fill, 'line-width': map[type].width },
  });
  const placeLabel = (id, sourceLayer, filter) => ({
    id,
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': sourceLayer,
    filter,
    layout: {
      'text-field': name,
      'text-font': labelFont,
      'text-size': label.size,
      'text-letter-spacing': tracking,
      'text-transform': 'uppercase',
      // Labels never wrap in the designs.
      'text-max-width': 100,
    },
    paint: {
      'text-color': color.label,
      // The design's halo is an SVG stroke centred on the outline, so half of it shows.
      'text-halo-color': color.land,
      'text-halo-width': round(label.halo / 2),
    },
  });

  return {
    version: 8,
    name: `Dispatchly ${theme}`,
    metadata: {
      generator: 'web/scripts/build-tokens.mjs from design-tokens.json. Do not edit.',
    },
    sources: {
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': color.land } },
      {
        id: 'green',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: isClass(['grass', 'wood']),
        paint: { 'fill-color': color.park },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': color.park },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': color.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        layout: line,
        paint: { 'line-color': color.water, 'line-width': map.minorRoad.width },
      },
      // Residential and service streets: the design's barely visible street grid.
      {
        id: 'street',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: linesOf(streets),
        layout: line,
        paint: { 'line-color': color.street, 'line-width': map.streetGrid.stroke },
      },
      // Casings under every fill, in the design's order: ring, arterial, minor.
      casing('ringRoad'),
      casing('arterial'),
      casing('minorRoad'),
      road('minorRoad', color.road),
      road('arterial', color.road),
      road('ringRoad', color.ringRoad),
      {
        id: 'water-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        filter: ['all', isClass(['river', 'canal']), ['has', 'name']],
        layout: {
          'symbol-placement': 'line',
          'text-field': name,
          'text-font': waterFont,
          'text-size': label.waterSize,
          'text-letter-spacing': round(label.waterTracking / label.waterSize),
          'text-transform': 'uppercase',
        },
        paint: { 'text-color': color.waterLabel },
      },
      placeLabel('park-label', 'park', [
        'all',
        ['==', ['geometry-type'], 'Point'],
        ['has', 'name'],
      ]),
      placeLabel('place-label', 'place', isClass(['suburb', 'quarter', 'neighbourhood'])),
    ],
  };
}

function kebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
