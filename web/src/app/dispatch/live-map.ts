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
  setMarkerData,
  type DashboardRiderStatus,
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
  `,
})
export class LiveMap {
  private readonly store = inject(DispatchStore);

  /** Room the panels take on each side, so the camera centres things in the visible map. */
  readonly padding = input<PaddingOptions>({ top: 0, right: 0, bottom: 0, left: 0 });
  /** Disconnected for a while: markers at 50% (PLAN.md §5.2). */
  readonly dimmed = input(false);
  /** Map layers off: riders only, without restaurants and other riders' routes and drops. */
  readonly quiet = input(false);

  protected readonly home = centralDelhi;
  protected readonly homeZoom = HOME_ZOOM;

  private map?: MapLibreMap;
  private readonly loaded = signal(false);
  private readonly reducedMotion = prefersReducedMotion();
  private readonly style = dashboardRiderStyle();
  private readonly fades = new Map<number, Fade>();
  private opacity = 0;
  private lastFrame = 0;
  private otherRoutes: Feature<LineString>[] = [];
  private otherRoutesAt = -Infinity;
  private flownTo = '';
  private stopPulse = () => {};

  /** The selected order with its live state. */
  private readonly selectedOrder = computed(() => {
    const code = this.store.selection()?.code;
    return code ? (this.store.entries().get(code)?.order ?? null) : null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    let frame = 0;
    destroyRef.onDestroy(() => {
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
      untracked(() => this.map!.setPadding(padding));
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
      untracked(() => {
        const target = this.focusOf(selection.riderId, this.selectedOrder());
        if (target) this.fly(target);
      });
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
    this.loaded.set(true);
  }

  zoomIn(): void {
    this.map?.zoomIn({ duration: this.reducedMotion ? 0 : undefined });
  }

  zoomOut(): void {
    this.map?.zoomOut({ duration: this.reducedMotion ? 0 : undefined });
  }

  /** Back to the city view. */
  goHome(): void {
    this.fly(this.home, HOME_ZOOM);
  }

  /** Back to the selection, or to the city when nothing is selected. */
  recenter(): void {
    const selection = this.store.selection();
    const target = selection ? this.focusOf(selection.riderId, this.selectedOrder()) : null;
    if (target) this.fly(target);
    else this.fly(this.home, HOME_ZOOM);
  }

  /** Flies to a place, e.g. a search result. */
  flyTo(target: LngLat, zoom = SELECTED_ZOOM): void {
    this.fly(target, zoom);
  }

  private fly(center: LngLat, zoom = Math.max(this.map?.getZoom() ?? 0, SELECTED_ZOOM)): void {
    if (!this.map) return;
    if (this.reducedMotion) this.map.jumpTo({ center, zoom });
    else this.map.flyTo({ center, zoom, duration: CAMERA, essential: false });
  }

  private focusOf(riderId: number | null, order: OrderSummary | null): LngLat | null {
    const rider = riderId === null ? null : this.store.motion.sampleOne(riderId, performance.now());
    if (rider) return [rider.lng, rider.lat];
    return order ? lngLat(order.restaurantLocation) : null;
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

    const features: Feature<Point>[] = [];
    let selectedAt: LngLat | null = null;
    for (const rider of frames) {
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
      if (selection?.riderId === rider.id) {
        selectedAt = [rider.lng, rider.lat];
        properties['selected'] = true;
        properties['label'] = this.pillLabel(riders.get(rider.id)?.name, order, wallClock);
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [rider.lng, rider.lat] },
        properties,
      });
    }
    for (const id of this.fades.keys()) if (!this.store.motion.has(id)) this.fades.delete(id);

    if (now - this.otherRoutesAt >= OTHER_ROUTES_EVERY_MS) {
      this.otherRoutesAt = now;
      this.otherRoutes = this.quiet()
        ? []
        : this.routesOfOthers(frames, orders, selection?.riderId ?? null);
    }
    setMarkerData(map, {
      riders: { type: 'FeatureCollection', features },
      routes: {
        type: 'FeatureCollection',
        features: [...this.otherRoutes, ...this.selectedRoute(order, selectedAt)],
      },
    });
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
