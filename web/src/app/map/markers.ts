import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  ExpressionSpecification,
} from 'maplibre-gl';
// GeoJSON types ship with maplibre-gl (its @types/geojson dependency).
import type { FeatureCollection } from 'geojson';
import { tokens } from '../tokens';

/**
 * Map markers exactly as design-tokens.json → marker (PLAN.md §4.2): GeoJSON sources drawn as
 * circle, line and symbol layers, never DOM markers. Geometry is in the designs' SVG units and
 * scaled by each view's frame / viewBox, so a marker is the size it is in that view's design.
 *
 * Sources: `dispatch-routes` (LineString, kind: active | travelled | other),
 * `dispatch-places` (Point, kind: restaurant | restaurant-active | drop | other-drop |
 * new-order | home, label?), `dispatch-riders` (Point, status: available | on-delivery | late,
 * bearing, selected?, label?).
 */

export type MarkerView = 'dashboard' | 'tracking';
type Theme = 'dark' | 'light';

const geometry = tokens.marker.geometry;
const status = tokens.color.status;
const accent = tokens.color.accent;
const family = 'Inter Variable';

/** px per SVG unit: the view's frame over its viewBox, as the design scales it ("slice"). */
export function viewScale(view: MarkerView): number {
  const { viewBox, frame } = tokens.map.label[view];
  const [vw, vh] = viewBox.split('x').map(Number);
  const [fw, fh] = frame.split('x').map(Number);
  return Math.max(fw! / vw!, fh! / vh!);
}

const dash = (pattern: string, width: number) => pattern.split(' ').map((n) => Number(n) / width);
const kind = (k: string | string[]): ExpressionSpecification =>
  Array.isArray(k) ? ['match', ['get', 'kind'], k, true, false] : ['==', ['get', 'kind'], k];
const notSelected: ExpressionSpecification = ['!=', ['get', 'selected'], true];
const isSelected: ExpressionSpecification = ['==', ['get', 'selected'], true];

/** Draws an image for MapLibre at device resolution. `draw` works in px from the centre. */
function image(
  map: MapLibreMap,
  id: string,
  size: number,
  draw: (c: CanvasRenderingContext2D) => void,
  extra = {},
) {
  if (map.hasImage(id)) map.removeImage(id);
  const ratio = Math.max(1, Math.round(devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil(size * ratio);
  const c = canvas.getContext('2d')!;
  c.scale(ratio, ratio);
  c.translate(size / 2, size / 2);
  draw(c);
  map.addImage(id, c.getImageData(0, 0, canvas.width, canvas.height), {
    pixelRatio: ratio,
    ...extra,
  });
}

function roundedSquare(c: CanvasRenderingContext2D, size: number, radius: number) {
  c.beginPath();
  c.roundRect(-size / 2, -size / 2, size, size, radius);
}

/** A stretchable pill for `icon-text-fit`, with its corners kept round. */
function pill(
  map: MapLibreMap,
  id: string,
  height: number,
  fill: string,
  border?: { width: number; color: string },
) {
  const ratio = Math.max(1, Math.round(devicePixelRatio || 1));
  const w = height * 2 + 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * ratio);
  canvas.height = Math.ceil(height * ratio);
  const c = canvas.getContext('2d')!;
  c.scale(ratio, ratio);
  const inset = border ? border.width / 2 : 0;
  c.beginPath();
  c.roundRect(inset, inset, w - 2 * inset, height - 2 * inset, height / 2 - inset);
  c.fillStyle = fill;
  c.fill();
  if (border) {
    c.lineWidth = border.width;
    c.strokeStyle = border.color;
    c.stroke();
  }
  const r = (height / 2) * ratio;
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, c.getImageData(0, 0, canvas.width, canvas.height), {
    pixelRatio: ratio,
    stretchX: [[r, canvas.width - r]],
    stretchY: [[r - 0.5, r + 0.5]],
    content: [r, 0, canvas.width - r, canvas.height],
  });
}

/** Distance from the rider's centre to the pointer's tip, from a path such as "M0 -16L4.6 -9.5H-4.6Z". */
function pointerReach(path: string): number {
  return Math.abs(Number(/^M0 (-?[\d.]+)/.exec(path)![1]));
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * Adds the marker sources, images and layers to a map whose style has loaded. Call again after
 * `setStyle`. Returns a function that stops the needs-rider pulse.
 */
export function addMarkers(map: MapLibreMap, theme: Theme, view: MarkerView): () => void {
  for (const id of ['dispatch-routes', 'dispatch-places', 'dispatch-riders']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: emptyCollection() });
  }
  const s = viewScale(view);
  const land = tokens.color.map[theme].land;
  const layers = view === 'dashboard' ? dashboardLayers(map, s, land) : trackingLayers(map, s);
  for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
  return view === 'dashboard' ? pulse(map) : () => {};
}

export function setMarkerData(
  map: MapLibreMap,
  data: Partial<Record<'routes' | 'places' | 'riders', FeatureCollection>>,
): void {
  for (const [key, collection] of Object.entries(data)) {
    (map.getSource(`dispatch-${key}`) as GeoJSONSource | undefined)?.setData(collection);
  }
}

function dashboardLayers(map: MapLibreMap, s: number, land: string): LayerSpecification[] {
  const g = geometry.dashboard;
  const dark = tokens.color.marker.dark;
  const textPrimary = tokens.color.dark.textPrimary;
  const pointerBox = 2 * pointerReach(g.selected.pointer) * s;

  // Heading pointers sit in a square centred on the rider, so they rotate around it.
  const drawPointer = (path: string) => (c: CanvasRenderingContext2D) => {
    c.scale(s, s);
    c.fillStyle = status.onDelivery;
    c.fill(new Path2D(path));
  };
  image(map, 'marker-pointer', pointerBox, drawPointer(g.onDelivery.pointer));
  image(map, 'marker-pointer-selected', pointerBox, drawPointer(g.selected.pointer));
  image(map, 'marker-blocker', 2 * g.late.ringR * s, () => {});
  for (const [id, r] of [
    ['marker-restaurant', g.restaurant],
    ['marker-restaurant-active', g.restaurantActive],
  ] as const) {
    image(map, id, (r.size + r.stroke) * s, (c) => {
      roundedSquare(c, r.size * s, r.radius * s);
      c.fillStyle = status.restaurantPin;
      c.fill();
      c.lineWidth = r.stroke * s;
      c.strokeStyle = land;
      c.stroke();
    });
  }
  const n = g.newOrder;
  image(map, 'marker-new-order', (n.size + n.stroke) * s, (c) => {
    roundedSquare(c, n.size * s, n.radius * s);
    c.fillStyle = accent.orange;
    c.fill();
    c.lineWidth = n.stroke * s;
    c.strokeStyle = land;
    c.stroke();
  });
  image(map, 'marker-ring-dashed', 2 * (n.outerRingR + n.ringStroke) * s, (c) => {
    c.beginPath();
    c.arc(0, 0, n.ringR * s, 0, Math.PI * 2);
    c.setLineDash(n.ringDash.split(' ').map((d) => Number(d) * s));
    c.lineWidth = n.ringStroke * s;
    c.strokeStyle = accent.orange;
    c.stroke();
  });
  image(map, 'marker-ring', 2 * (n.outerRingR + n.outerRingStroke) * s, (c) => {
    c.beginPath();
    c.arc(0, 0, n.outerRingR * s, 0, Math.PI * 2);
    c.lineWidth = n.outerRingStroke * s;
    c.strokeStyle = accent.orange;
    c.stroke();
  });
  pill(map, 'marker-pill', g.pill.height * s, dark.pill);

  const line = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const riderColor: ExpressionSpecification = [
    'match',
    ['get', 'status'],
    'available',
    status.available,
    'late',
    status.late,
    status.onDelivery,
  ];
  const riderRadius: ExpressionSpecification = [
    'match',
    ['get', 'status'],
    'available',
    g.available.r * s,
    'late',
    g.late.r * s,
    g.onDelivery.r * s,
  ];
  const pillPadding = ((g.pill.height - g.pill.fontSize) / 2) * s;

  return [
    // Routes of other riders → active route glow → active route (PLAN.md §4.2)
    {
      id: 'route-others',
      type: 'line',
      source: 'dispatch-routes',
      filter: kind('other'),
      layout: line,
      paint: {
        'line-color': accent.orange,
        'line-width': g.routeOthers.width * s,
        'line-opacity': g.routeOthers.opacity,
      },
    },
    {
      id: 'route-travelled',
      type: 'line',
      source: 'dispatch-routes',
      filter: kind('travelled'),
      layout: line,
      paint: {
        'line-color': dark.routeTravelled,
        'line-width': g.routeTravelled.width * s,
        'line-dasharray': dash(g.routeTravelled.dash, g.routeTravelled.width),
      },
    },
    {
      id: 'route-glow',
      type: 'line',
      source: 'dispatch-routes',
      filter: kind('active'),
      layout: line,
      paint: {
        'line-color': accent.orange,
        'line-width': g.routeActive.glow * s,
        'line-opacity': g.routeActive.glowOpacity,
      },
    },
    {
      id: 'route-active',
      type: 'line',
      source: 'dispatch-routes',
      filter: kind('active'),
      layout: line,
      paint: { 'line-color': accent.orange, 'line-width': g.routeActive.width * s },
    },
    // Restaurants
    {
      id: 'restaurants',
      type: 'symbol',
      source: 'dispatch-places',
      filter: kind(['restaurant', 'restaurant-active']),
      layout: {
        'icon-image': ['concat', 'marker-', ['get', 'kind']],
        'icon-allow-overlap': true,
      },
    },
    // Drops and new orders
    {
      id: 'drops-other',
      type: 'circle',
      source: 'dispatch-places',
      filter: kind('other-drop'),
      paint: {
        'circle-radius': g.otherDrop.r * s,
        'circle-color': land,
        'circle-stroke-width': g.otherDrop.stroke * s,
        'circle-stroke-color': dark.otherDropStroke,
      },
    },
    {
      id: 'drops',
      type: 'circle',
      source: 'dispatch-places',
      filter: kind('drop'),
      paint: {
        'circle-radius': g.drop.r * s,
        'circle-color': land,
        'circle-stroke-width': g.drop.stroke * s,
        'circle-stroke-color': textPrimary,
      },
    },
    {
      id: 'new-order-ring-outer',
      type: 'symbol',
      source: 'dispatch-places',
      filter: kind('new-order'),
      layout: {
        'icon-image': 'marker-ring',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': n.outerRingOpacity },
    },
    {
      id: 'new-order-ring',
      type: 'symbol',
      source: 'dispatch-places',
      filter: kind('new-order'),
      layout: {
        'icon-image': 'marker-ring-dashed',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': n.ringOpacity },
    },
    {
      id: 'new-orders',
      type: 'symbol',
      source: 'dispatch-places',
      filter: kind('new-order'),
      layout: { 'icon-image': 'marker-new-order', 'icon-allow-overlap': true },
    },
    // Riders: late ring, dot, and the heading pointer (which also keeps labels off riders, §11.1)
    {
      id: 'riders-late-ring',
      type: 'circle',
      source: 'dispatch-riders',
      filter: ['all', notSelected, ['==', ['get', 'status'], 'late']],
      paint: {
        'circle-radius': g.late.ringR * s,
        'circle-color': 'transparent',
        'circle-stroke-width': g.late.ringStroke * s,
        'circle-stroke-color': status.late,
        'circle-stroke-opacity': g.late.ringOpacity,
      },
    },
    {
      id: 'riders',
      type: 'circle',
      source: 'dispatch-riders',
      filter: notSelected,
      paint: {
        'circle-radius': riderRadius,
        'circle-color': riderColor,
        'circle-stroke-width': g.available.stroke * s,
        'circle-stroke-color': land,
        'circle-color-transition': { duration: parseFloat(tokens.motion.duration.base) },
      },
    },
    {
      id: 'riders-pointer',
      type: 'symbol',
      source: 'dispatch-riders',
      filter: notSelected,
      layout: {
        'icon-image': [
          'case',
          ['==', ['get', 'status'], 'on-delivery'],
          'marker-pointer',
          'marker-blocker',
        ],
        'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
      },
    },
    // Selected rider halo → selected rider → label pill
    {
      id: 'selected-halo-outer',
      type: 'circle',
      source: 'dispatch-riders',
      filter: isSelected,
      paint: {
        'circle-radius': g.selected.outerHaloR * s,
        'circle-color': accent.orange,
        'circle-opacity': g.selected.outerHaloOpacity,
      },
    },
    {
      id: 'selected-halo',
      type: 'circle',
      source: 'dispatch-riders',
      filter: isSelected,
      paint: {
        'circle-radius': g.selected.haloR * s,
        'circle-color': accent.orange,
        'circle-opacity': g.selected.haloOpacity,
      },
    },
    {
      id: 'selected',
      type: 'circle',
      source: 'dispatch-riders',
      filter: isSelected,
      paint: {
        'circle-radius': g.selected.r * s,
        'circle-color': accent.orange,
        'circle-stroke-width': g.selected.stroke * s,
        'circle-stroke-color': textPrimary,
      },
    },
    {
      id: 'selected-pointer',
      type: 'symbol',
      source: 'dispatch-riders',
      filter: isSelected,
      layout: {
        'icon-image': 'marker-pointer-selected',
        'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
      },
    },
    {
      id: 'selected-pill',
      type: 'symbol',
      source: 'dispatch-riders',
      filter: ['all', isSelected, ['has', 'label']],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': [`${family} SemiBold`, family],
        'text-size': g.pill.fontSize * s,
        'text-anchor': 'left',
        // The pill's left edge and vertical centre, from the design's offset.
        'text-offset': [
          (g.pill.offset[0] + (g.pill.height - g.pill.fontSize) / 2) / g.pill.fontSize,
          (g.pill.offset[1] + g.pill.height / 2) / g.pill.fontSize,
        ],
        'text-allow-overlap': true,
        'icon-image': 'marker-pill',
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [pillPadding, pillPadding, pillPadding, pillPadding],
        'icon-allow-overlap': true,
      },
      paint: { 'text-color': dark.pillText },
    },
  ];
}

function trackingLayers(map: MapLibreMap, s: number): LayerSpecification[] {
  const g = geometry.tracking;
  const light = tokens.color.marker.light;
  const ink = tokens.color.ink;
  const orange = accent.orangeOnLight;
  const r = g.restaurant;
  image(map, 'marker-restaurant', (r.size + r.stroke) * s, (c) => {
    roundedSquare(c, r.size * s, r.radius * s);
    c.fillStyle = ink;
    c.fill();
    c.lineWidth = r.stroke * s;
    c.strokeStyle = light.pinStroke;
    c.stroke();
    c.beginPath();
    c.arc(0, 0, r.dotR * s, 0, Math.PI * 2);
    c.fillStyle = light.pinStroke;
    c.fill();
  });
  const pointerBox = 2 * pointerReach(g.rider.pointer) * s;
  image(map, 'marker-pointer-selected', pointerBox, (c) => {
    c.scale(s, s);
    c.fillStyle = orange;
    c.fill(new Path2D(g.rider.pointer));
  });
  pill(map, 'marker-pill', g.pill.height * s, light.pill, {
    width: g.pill.stroke * s,
    color: light.pillBorder,
  });
  pill(map, 'marker-pill-ink', g.pill.height * s, light.pillInk);

  const line = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const pillPadding = ((g.pill.height - g.pill.fontSize) / 2) * s;
  const pillLayout = (above: number) => ({
    'text-field': ['get', 'label'],
    'text-font': [`${family} SemiBold`, family],
    'text-size': g.pill.fontSize * s,
    'text-anchor': 'bottom',
    'text-offset': [0, -above / (g.pill.fontSize * s)],
    'text-allow-overlap': true,
    'icon-text-fit': 'both',
    'icon-text-fit-padding': [pillPadding, pillPadding, pillPadding, pillPadding],
    'icon-allow-overlap': true,
  });

  return [
    {
      id: 'route-travelled',
      type: 'line',
      source: 'dispatch-routes',
      filter: kind('travelled'),
      layout: line,
      paint: {
        'line-color': light.routeTravelled,
        'line-width': g.routeTravelled.width * s,
        'line-dasharray': dash(g.routeTravelled.dash, g.routeTravelled.width),
      },
    },
    {
      id: 'route-casing',
      type: 'line',
      source: 'dispatch-routes',
      filter: kind('active'),
      layout: line,
      paint: { 'line-color': light.routeCasing, 'line-width': g.routeActive.casing * s },
    },
    {
      id: 'route-active',
      type: 'line',
      source: 'dispatch-routes',
      filter: kind('active'),
      layout: line,
      paint: { 'line-color': orange, 'line-width': g.routeActive.width * s },
    },
    {
      id: 'restaurants',
      type: 'symbol',
      source: 'dispatch-places',
      filter: kind(['restaurant', 'restaurant-active']),
      layout: { 'icon-image': 'marker-restaurant', 'icon-allow-overlap': true },
    },
    {
      id: 'home',
      type: 'circle',
      source: 'dispatch-places',
      filter: kind(['home', 'drop']),
      paint: {
        'circle-radius': g.home.r * s,
        'circle-color': ink,
        'circle-stroke-width': g.home.stroke * s,
        'circle-stroke-color': light.pinStroke,
      },
    },
    {
      id: 'home-dot',
      type: 'circle',
      source: 'dispatch-places',
      filter: kind(['home', 'drop']),
      paint: { 'circle-radius': g.home.dotR * s, 'circle-color': light.pinStroke },
    },
    {
      id: 'selected-halo',
      type: 'circle',
      source: 'dispatch-riders',
      paint: {
        'circle-radius': g.rider.haloR * s,
        'circle-color': orange,
        'circle-opacity': g.rider.haloOpacity,
      },
    },
    {
      id: 'selected-ring',
      type: 'circle',
      source: 'dispatch-riders',
      paint: { 'circle-radius': g.rider.ringR * s, 'circle-color': light.pinStroke },
    },
    {
      id: 'selected',
      type: 'circle',
      source: 'dispatch-riders',
      paint: { 'circle-radius': g.rider.r * s, 'circle-color': orange },
    },
    {
      id: 'selected-pointer',
      type: 'symbol',
      source: 'dispatch-riders',
      layout: {
        'icon-image': 'marker-pointer-selected',
        'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
      },
    },
    {
      id: 'place-pill',
      type: 'symbol',
      source: 'dispatch-places',
      filter: ['all', kind(['restaurant', 'restaurant-active']), ['has', 'label']],
      layout: {
        ...pillLayout((r.size / 2 + r.stroke) * s + pillPadding),
        'icon-image': 'marker-pill',
      },
      paint: { 'text-color': light.pillText },
    },
    {
      id: 'home-pill',
      type: 'symbol',
      source: 'dispatch-places',
      filter: ['all', kind(['home', 'drop']), ['has', 'label']],
      layout: {
        ...pillLayout((g.home.r + g.home.stroke) * s + pillPadding),
        'icon-image': 'marker-pill-ink',
      },
      paint: { 'text-color': light.pillInkText },
    },
  ] as LayerSpecification[];
}

/**
 * The needs-rider pulse: the rings expand and fade on a 2 s loop, the only infinite animation
 * (PLAN.md §6.3). With reduced motion the rings stay still, as drawn in the design.
 */
function pulse(map: MapLibreMap): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const n = geometry.dashboard.newOrder;
  const period = parseFloat(tokens.motion.duration.needsRiderPulse);
  const grow = n.outerRingR / n.ringR;
  let frame = requestAnimationFrame(function tick(now) {
    if (!map.getLayer('new-order-ring')) return;
    for (const [id, offset, opacity] of [
      ['new-order-ring', 0, n.ringOpacity],
      ['new-order-ring-outer', 0.5, n.outerRingOpacity],
    ] as const) {
      const t = (((now / period + offset) % 1) + 1) % 1;
      // Each ring grows from the inner ring's radius to the outer ring's, fading out.
      map.setLayoutProperty(
        id,
        'icon-size',
        (1 + (grow - 1) * t) * (id === 'new-order-ring' ? 1 : 1 / grow),
      );
      map.setPaintProperty(id, 'icon-opacity', opacity * (1 - t));
    }
    frame = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(frame);
}
