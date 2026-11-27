import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { Map as MapLibreMap, MapLayerMouseEvent, PaddingOptions } from 'maplibre-gl';
import { MapView, centralDelhi } from '../map/map-view';
import {
  addMarkers,
  dashboardRiderStyle,
  selectedRiderExtent,
  setMarkerData,
  type DashboardRiderStatus,
  type MarkerExtent,
} from '../map/markers';
import { tokens } from '../tokens';
import { prefersReducedMotion } from '../ui/motion';
import { DispatchStore } from './dispatch-store';
import { etaMinutes, type OrderSummary } from './queue';
import { lngLat, splitRoute, type LngLat } from './route-geometry';

const ms = (duration: string) => parseFloat(duration);
const CROSSFADE = ms(tokens.motion.duration.base);
const CAMERA = ms(tokens.motion.duration.camera);
const DIMMED = tokens.opacity.markersDisconnected;
/** Other riders' routes move with their riders, but at city zoom once a second is plenty. */
const OTHER_ROUTES_EVERY_MS = 1000;
/**
 * Riders other than the selected one are redrawn at 30 fps (PLAN.md §6.2): every redraw rebuilds
 * the rider source's tiles, which drops frames with 500 riders on slower CPUs, and at city zoom a
 * rider moves about a pixel a second, so 30 fps looks the same. The selected rider keeps every
 * frame. The slack keeps a 60 Hz display on every other frame despite timer jitter.
 */
const OTHER_RIDERS_EVERY_MS = 1000 / 30 - 4;
/** The zoom a selection flies to, unless the map is already closer. */
const SELECTED_ZOOM = 14;
/** Where the dashboard opens: central Delhi, as in the design. */
const HOME_ZOOM = 12.6;

const RIDER_LAYERS = ['riders', 'riders-pointer'];
const NEW_ORDER_LAYERS = ['new-orders'];

interface Fade {
  status: DashboardRiderStatus;
  from: DashboardRiderStatus;
  start: number;
}

/**
 * The dashboard's live map (PLAN.md §5.2, §6.2): every rider drawn from the interpolated motion on
 * each animation frame as GeoJSON (never DOM markers), restaurants, needs-rider pulses, drops and
 * routes, the selected rider's halo, route and name/ETA pill, and the camera flight to a selection.
 */
@Component({
  selector: 'app-live-map',
  imports: [MapView],
  template: `<app-map-view
    class="map"
    theme="dark"
    [center]="home"
    [zoom]="homeZoom"
    (ready)="ready($event)"
  />`,
  styles: `
    :host {
      display: block;
    }
    .map {
      position: absolute;
      inset: 0;
    }
    /* The credit stays in view above a bottom sheet (--credit-bottom), moving as the sheet does. */
    :host ::ng-deep .maplibregl-ctrl-bottom-right {
      bottom: var(--credit-bottom, 0);
      transition: bottom var(--duration-panel) var(--ease-standard);
    }
  `,
})
export class LiveMap {
  private readonly store = inject(DispatchStore);

  /** Room the panels take on each side, so the camera centres things in the visible map. */
  readonly padding = input<Required<PaddingOptions>>({ top: 0, right: 0, bottom: 0, left: 0 });
  /** Disconnected for a while: markers at 50% (PLAN.md §5.2). */
  readonly dimmed = input(false);
  /** Map layers off: riders only, without restaurants and other riders' routes and drops. */
  readonly quiet = input(false);

  /**
   * Height (px) of the map's bottom-right corner, which holds the credit: two lines on a narrow
   * map until it collapses to its "i" button. The dashboard keeps selections clear of it.
   */
  readonly creditHeight = signal(0);

  protected readonly home = centralDelhi;
  protected readonly homeZoom = HOME_ZOOM;

  private readonly destroyRef = inject(DestroyRef);
  private map?: MapLibreMap;
  private readonly loaded = signal(false);
  private readonly reducedMotion = prefersReducedMotion();
  private readonly style = dashboardRiderStyle();
  private readonly fades = new Map<number, Fade>();
  private opacity = 0;
  private lastFrame = 0;
  private otherRoutesAt = -Infinity;
  private otherRoutesKey = '';
  private otherRidersAt = -Infinity;
  private otherRidersKey: number | null = null;
  /** The selected rider or route was drawn last frame. */
  private focusShown = false;
  private flownTo = '';
  /** The camera flight under way, if any. */
  private flight: { center: LngLat; zoom: number; extent: MarkerExtent | null } | null = null;
  private stopPulse = () => {};

  /** The selected order with its live state. */
  private readonly selectedOrder = computed(() => {
    const code = this.store.selection()?.code;
    return code ? (this.store.entries().get(code)?.order ?? null) : null;
  });

  constructor() {
    let frame = 0;
    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(frame);
      this.stopPulse();
    });

    // Draw on every frame once the map is up.
    effect(() => {
      if (!this.loaded()) return;
      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        this.draw(now);
      };
      frame = requestAnimationFrame(loop);
    });

    // Restaurants, needs-rider pulses and drops change only with the data.
    effect(() => {
      if (!this.loaded()) return;
      const places = this.places(
        this.quiet() ? [] : this.store.restaurants(),
        this.store.queue(),
        this.selectedOrder(),
        this.quiet(),
      );
      untracked(() => setMarkerData(this.map!, { places }));
    });

    effect(() => {
      if (!this.loaded()) return;
      const padding = this.padding();
      untracked(() => this.pad(padding));
    });

    // Picking an order or rider flies the camera there (800 ms; a jump with reduced motion).
    effect(() => {
      if (!this.loaded()) return;
      const selection = this.store.selection();
      const key = selection ? `${selection.code}|${selection.riderId}` : '';
      if (!selection || key === this.flownTo) {
        this.flownTo = key;
        return;
      }
      this.flownTo = key;
      untracked(() => this.flyToSelection(selection.riderId));
    });

    effect(() => {
      if (!this.loaded()) return;
      const label = this.describe();
      untracked(() => this.map!.getCanvas().setAttribute('aria-label', label));
    });
  }

  protected ready(map: MapLibreMap): void {
    this.map = map;
    this.stopPulse = addMarkers(map, 'dark', 'dashboard');
    map.on('moveend', () => (this.flight = null));
    for (const layer of RIDER_LAYERS) {
      map.on('click', layer, (e) => this.pickRider(e));
      this.pointer(map, layer);
    }
    for (const layer of NEW_ORDER_LAYERS) {
      map.on('click', layer, (e) => {
        const code = e.features?.[0]?.properties?.['code'];
        if (typeof code === 'string') this.store.selectOrder(code);
      });
      this.pointer(map, layer);
    }
    const corner = map.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
    if (corner) {
      const observer = new ResizeObserver(() =>
        this.creditHeight.set(corner.getBoundingClientRect().height),
      );
      observer.observe(corner);
      this.destroyRef.onDestroy(() => observer.disconnect());
    }
    this.loaded.set(true);
  }

  zoomIn(): void {
    this.map?.zoomIn(this.zoomOptions());
  }

  zoomOut(): void {
    this.map?.zoomOut(this.zoomOptions());
  }

  /** MapLibre's own zoom animation, or none with reduced motion. (An undefined duration would
   * replace its default and break the animation, so it's left out.) */
  private zoomOptions(): { duration: number } | undefined {
    return this.reducedMotion ? { duration: 0 } : undefined;
  }

  /** Back to the city view. */
  goHome(): void {
    this.fly(this.home, HOME_ZOOM);
  }

  /** Back to the selection, or to the city when nothing is selected. */
  recenter(): void {
    const selection = this.store.selection();
    if (!selection || !this.flyToSelection(selection.riderId)) this.fly(this.home, HOME_ZOOM);
  }

  /** Flies to a place, e.g. a search result. */
  flyTo(target: LngLat, zoom = SELECTED_ZOOM): void {
    this.fly(target, zoom);
  }

  /**
   * Flies to `center`. With an `extent`, all that the marker there takes up (the selected rider
   * with its pill) is centred, so the pill doesn't run off the visible map.
   */
  private fly(
    center: LngLat,
    zoom = Math.max(this.map?.getZoom() ?? 0, SELECTED_ZOOM),
    extent: MarkerExtent | null = null,
  ): void {
    if (!this.map) return;
    const padding = this.padding();
    const offset: [number, number] = extent
      ? [-(extent.left + extent.right) / 2, -(extent.top + extent.bottom) / 2]
      : [0, 0];
    // (jumpTo has no offset; an ease that takes no time is the same jump.)
    if (this.reducedMotion) this.map.easeTo({ center, zoom, padding, offset, duration: 0 });
    else this.map.flyTo({ center, zoom, padding, offset, duration: CAMERA, essential: false });
    // Ending a flight (arriving, a drag, a new flight) fires moveend, which forgets it.
    this.flight = this.map.isMoving() ? { center, zoom, extent } : null;
  }

  /**
   * New room around the map (a panel or the sheet opened). A flight under way takes it along;
   * otherwise the map stays put on screen and only the centre it keeps moves, so nothing jumps,
   * unless the panel now covers the selected rider (the sheet pulled up over them): then the
   * camera brings them back into view.
   */
  private pad(padding: Required<PaddingOptions>): void {
    const map = this.map!;
    if (this.flight) {
      this.fly(this.flight.center, this.flight.zoom, this.flight.extent);
      return;
    }
    const before = map.getPadding();
    const shown = this.selectionShown(before);
    const closer = (['top', 'right', 'bottom', 'left'] as const).some(
      (side) => padding[side] > (before[side] ?? 0),
    );
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const center = map.unproject([
      (width + padding.left - padding.right) / 2,
      (height + padding.top - padding.bottom) / 2,
    ]);
    map.jumpTo({ center, padding });
    // Only when a panel came closer over a rider who was in view: one panned away on purpose
    // stays away, and more room (the sheet lowered) moves nothing.
    if (shown && closer && !this.selectionShown(padding)) {
      this.flyToSelection(this.store.selection()?.riderId ?? null);
    }
  }

  /**
   * Whether the selected rider, with their halo and pill, is in the map left clear by `padding`:
   * all of them where they fit, or else their middle (where the camera puts them).
   */
  private selectionShown(padding: PaddingOptions): boolean {
    const rider = this.selectedRider();
    if (!rider) return false;
    const map = this.map!;
    const { x, y } = map.project([rider.lng, rider.lat]);
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const { left = 0, top = 0, right = 0, bottom = 0 } = padding;
    const { extent } = rider;
    const within = (from: number, to: number, start: number, end: number) =>
      end - start <= to - from
        ? start >= from && end <= to
        : (start + end) / 2 >= from && (start + end) / 2 <= to;
    return (
      within(left, width - right, x + extent.left, x + extent.right) &&
      within(top, height - bottom, y + extent.top, y + extent.bottom)
    );
  }

  /** The selected rider where they are now, and how far they reach with their pill. */
  private selectedRider(
    riderId = this.store.selection()?.riderId ?? null,
  ): { lng: number; lat: number; extent: MarkerExtent } | null {
    const rider = riderId === null ? null : this.store.motion.sampleOne(riderId, performance.now());
    if (!rider) return null;
    const name = this.store.riders().get(riderId!)?.name;
    const label = this.pillLabel(name, this.selectedOrder(), Date.now());
    return { lng: rider.lng, lat: rider.lat, extent: selectedRiderExtent(label) };
  }

  /**
   * Flies to the selection: its rider, centred with the name/ETA pill beside them, or else its
   * order's restaurant. False when there's nowhere to go.
   */
  private flyToSelection(riderId: number | null): boolean {
    const rider = this.selectedRider(riderId);
    if (rider) {
      this.fly([rider.lng, rider.lat], undefined, rider.extent);
      return true;
    }
    const order = this.selectedOrder();
    if (!order) return false;
    this.fly(lngLat(order.restaurantLocation));
    return true;
  }

  private pickRider(e: MapLayerMouseEvent): void {
    const id = e.features?.[0]?.properties?.['id'];
    if (typeof id === 'number') this.store.selectRider(id);
  }

  private pointer(map: MapLibreMap, layer: string): void {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }

  private draw(now: number): void {
    const map = this.map!;
    const elapsed = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    const frames = this.store.motion.sample(now);
    const orders = this.store.orderOfRider();
    const selection = this.store.selection();
    const order = this.selectedOrder();
    const riders = this.store.riders();
    const wallClock = Date.now();

    // Markers fade in with the first data, and to 50% while disconnected.
    const target = frames.length === 0 ? 0 : this.dimmed() ? DIMMED : 1;
    const step = this.reducedMotion ? 1 : elapsed / CROSSFADE;
    this.opacity =
      this.opacity < target
        ? Math.min(target, this.opacity + step)
        : Math.max(target, this.opacity - step);

    // A new selection moves a rider between the two sources at once, so it never shows twice or
    // goes missing for a frame.
    const selectedId = selection?.riderId ?? null;
    const othersDue =
      now - this.otherRidersAt >= OTHER_RIDERS_EVERY_MS || selectedId !== this.otherRidersKey;
    const features: Feature<Point>[] = [];
    const focus: Feature<Point>[] = [];
    let selectedAt: LngLat | null = null;
    for (const rider of frames) {
      if (!othersDue && rider.id !== selectedId) continue;
      const status: DashboardRiderStatus =
        rider.status === 'Available'
          ? 'available'
          : orders.get(rider.id)?.isLate
            ? 'late'
            : 'on-delivery';
      const properties: Record<string, unknown> = {
        id: rider.id,
        status,
        bearing: rider.bearing,
        opacity: this.opacity,
        ...this.crossfade(rider.id, status, now),
      };
      const feature: Feature<Point> = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [rider.lng, rider.lat] },
        properties,
      };
      if (rider.id === selectedId) {
        selectedAt = [rider.lng, rider.lat];
        properties['selected'] = true;
        properties['label'] = this.pillLabel(riders.get(rider.id)?.name, order, wallClock);
        focus.push(feature);
      } else {
        features.push(feature);
      }
    }

    const data: Parameters<typeof setMarkerData>[1] = {};
    if (othersDue) {
      this.otherRidersAt = now;
      this.otherRidersKey = selectedId;
      data.riders = { type: 'FeatureCollection', features };
      for (const id of this.fades.keys()) if (!this.store.motion.has(id)) this.fades.delete(id);
    }
    // Other riders' routes change slowly: they're redrawn every second, or at once when the
    // selection or the map layers change.
    const othersKey = `${this.quiet()}|${selectedId ?? ''}`;
    if (now - this.otherRoutesAt >= OTHER_ROUTES_EVERY_MS || othersKey !== this.otherRoutesKey) {
      this.otherRoutesAt = now;
      this.otherRoutesKey = othersKey;
      const lines = this.quiet() ? [] : this.routesOfOthers(frames, orders, selectedId);
      data.routes = { type: 'FeatureCollection', features: lines };
    }
    // The selected rider and its route move every frame; once they're gone, cleared once.
    const route = this.selectedRoute(order, selectedAt);
    if (focus.length || route.length || this.focusShown) {
      this.focusShown = focus.length > 0 || route.length > 0;
      data.focus = { type: 'FeatureCollection', features: focus };
      data['focus-route'] = { type: 'FeatureCollection', features: route };
    }
    setMarkerData(map, data);
  }

  /** Status changes cross-fade colour, size, pointer and late ring over 220 ms (PLAN.md §6.2). */
  private crossfade(id: number, status: DashboardRiderStatus, now: number) {
    let fade = this.fades.get(id);
    if (!fade) {
      fade = { status, from: status, start: -Infinity };
      this.fades.set(id, fade);
    } else if (fade.status !== status) {
      fade.from = fade.status;
      fade.status = status;
      fade.start = now;
    }
    const k = this.reducedMotion ? 1 : Math.min(1, (now - fade.start) / CROSSFADE);
    const is = (s: DashboardRiderStatus, which: DashboardRiderStatus) => (s === which ? 1 : 0);
    const mix = (a: number, b: number) => a + (b - a) * k;
    if (k >= 1) {
      return {
        pointer: is(status, 'on-delivery'),
        ring: is(status, 'late'),
      };
    }
    const from = this.style[fade.from];
    const to = this.style[status];
    return {
      color: mixColor(from.color, to.color, k),
      radius: mix(from.radius, to.radius),
      pointer: mix(is(fade.from, 'on-delivery'), is(status, 'on-delivery')),
      ring: mix(is(fade.from, 'late'), is(status, 'late')),
    };
  }

  /** "Aman · 8 min" beside the selected rider; just the first name when they have no order. */
  private pillLabel(name: string | undefined, order: OrderSummary | null, now: number): string {
    const first = (name ?? '').split(' ')[0] ?? '';
    if (!order || order.status === 'Delivered' || order.status === 'Searching') return first;
    return `${first} · ${etaMinutes(order.estimatedDeliveryAt, now)} min`;
  }

  /** The selected order's route: dotted where the rider has been, glowing orange ahead of them. */
  private selectedRoute(order: OrderSummary | null, rider: LngLat | null): Feature<LineString>[] {
    if (!order || !rider || order.status === 'Delivered' || order.status === 'Cancelled') return [];
    const route = order.route.map(lngLat);
    if (order.status === 'Assigned') {
      // On the way to the restaurant, then the ride to the drop.
      return [line('active', [rider, lngLat(order.restaurantLocation), ...route.slice(1)])];
    }
    const [travelled, remaining] = splitRoute(route, rider);
    return [line('travelled', travelled), line('active', remaining)];
  }

  /** Riders carrying food: a faint line from them to their drop (PLAN.md §4.2). */
  private routesOfOthers(
    frames: readonly { id: number; lat: number; lng: number }[],
    orders: ReadonlyMap<number, OrderSummary>,
    selectedRider: number | null,
  ): Feature<LineString>[] {
    const lines: Feature<LineString>[] = [];
    for (const rider of frames) {
      const order = orders.get(rider.id);
      if (!order || rider.id === selectedRider || !carrying(order)) continue;
      lines.push(line('other', splitRoute(order.route.map(lngLat), [rider.lng, rider.lat])[1]));
    }
    return lines;
  }

  private places(
    restaurants: ReturnType<DispatchStore['restaurants']>,
    queue: ReturnType<DispatchStore['queue']>,
    selected: OrderSummary | null,
    quiet: boolean,
  ): FeatureCollection<Point> {
    const features: Feature<Point>[] = restaurants.map((r) =>
      point(lngLat(r.location), {
        kind: selected?.restaurantId === r.id ? 'restaurant-active' : 'restaurant',
      }),
    );
    for (const { order, state } of queue) {
      if (state !== 'active') continue;
      if (order.status === 'Searching') {
        features.push(
          point(lngLat(order.restaurantLocation), { kind: 'new-order', code: order.code }),
        );
      } else if (!quiet && order.code !== selected?.code && carrying(order)) {
        features.push(point(lngLat(order.dropLocation), { kind: 'other-drop' }));
      }
    }
    if (selected && selected.status !== 'Cancelled') {
      features.push(point(lngLat(selected.dropLocation), { kind: 'drop' }));
    }
    return { type: 'FeatureCollection', features };
  }

  /** What a screen reader hears for the map, e.g. "Live map of 142 riders across central Delhi". */
  private describe(): string {
    const riders = this.store.riders();
    const base = `Live map of ${riders.size} riders across central Delhi`;
    const selection = this.store.selection();
    const rider = selection?.riderId != null ? riders.get(selection.riderId) : undefined;
    const order = this.selectedOrder();
    if (!rider) return base;
    return order && carrying(order)
      ? `${base}; ${rider.name} is selected, riding toward ${order.dropArea}`
      : `${base}; ${rider.name} is selected`;
  }
}

/** Picked up and on the way to the drop. */
function carrying(order: OrderSummary): boolean {
  return order.status === 'PickedUp' || order.status === 'InTransit';
}

function line(kind: 'active' | 'travelled' | 'other', coordinates: LngLat[]): Feature<LineString> {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { kind } };
}

function point(coordinates: LngLat, properties: Record<string, unknown>): Feature<Point> {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties };
}

/** Mixes two `#rrggbb` colours. */
function mixColor(a: string, b: string, k: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) =>
    Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * k),
  );
  return `rgb(${mixed.join(',')})`;
}
