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
import type {
  LngLatBoundsLike,
  Map as MapLibreMap,
  MapLibreEvent,
  PaddingOptions,
} from 'maplibre-gl';
import { lngLat, splitRoute, type LngLat } from '../dispatch/route-geometry';
import { MapView, centralDelhi } from '../map/map-view';
import { addMarkers, searchPulse, setMarkerData, viewScale } from '../map/markers';
import { tokens } from '../tokens';
import { prefersReducedMotion } from '../ui/motion';
import { firstName, stageOf, type OrderDetails } from './tracking-flow';
import { TrackingStore } from './tracking-store';

const ms = (duration: string) => parseFloat(duration);
const CAMERA = ms(tokens.motion.duration.camera);
/** The camera re-frames the rider and the drop at most this often (PLAN.md §5.3). */
const REFRAME = ms(tokens.motion.duration.cameraReframeMin);
/** Framing a few places never zooms in past this, as on the order page. */
const FIT_MAX_ZOOM = 15;

const g = tokens.marker.geometry.tracking;
/** Room around framed places for the pills above their pins, clear of the screen's edge. */
const FIT_MARGIN = Math.round(
  (g.home.r + g.home.stroke + g.pill.height) * viewScale('tracking') +
    parseFloat(tokens.layout.phoneOverlayInset),
);

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const onTheRoad = (order: OrderDetails | null) =>
  order?.status === 'Assigned' || order?.status === 'PickedUp' || order?.status === 'InTransit';

/**
 * The tracking page's light map (PLAN.md §5.3): the route from the restaurant to the door, the
 * part behind the rider dotted grey and the part ahead orange, and the rider drawn where they are
 * on every frame, between the positions the server sends (§6.2). The camera keeps the rider and
 * the drop in view in the room the sheet leaves, re-framing smoothly at most every 5 s, until the
 * customer moves the map; then `following` turns false and the page offers to recenter.
 */
@Component({
  selector: 'app-tracking-map',
  imports: [MapView],
  template: `<app-map-view
    class="map"
    theme="light"
    [center]="start"
    [zoom]="startZoom"
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
export class TrackingMap {
  private readonly store = inject(TrackingStore);

  /** Room the sheet or panel and the top bar take, so the camera frames the visible map. */
  readonly padding = input<Required<PaddingOptions>>({ top: 0, right: 0, bottom: 0, left: 0 });
  /** False once the customer has moved the map, until they recenter it. */
  readonly following = signal(true);

  protected readonly start = centralDelhi;
  protected readonly startZoom = 12;

  private readonly reducedMotion = prefersReducedMotion();
  private map?: MapLibreMap;
  private readonly loaded = signal(false);
  /** A flight or glide from `frame` is under way. */
  private moving = false;
  /** What the last frame drew, so a rider standing still isn't sent again. */
  private drawn = '';

  /** Around the corner, the camera closes in on the rider and the door. */
  private readonly lastStretch = computed(() => {
    const order = this.store.order();
    return !!order && stageOf(order, this.store.remaining()) === 'around-the-corner';
  });
  /** What changes what the camera frames: the step, the rider, where the rider is headed. */
  private readonly framing = computed(() => {
    const order = this.store.order();
    if (!order) return '';
    return `${order.status}|${order.rider?.id ?? ''}|${order.rider?.status ?? ''}|${this.lastStretch()}`;
  });

  /** For screen readers, in place of the design's "Map: Aman is between Khan Market and …". */
  private readonly label = computed(() => {
    const order = this.store.order();
    if (!order) return 'Map';
    const home = `your ${(order.drop.label ?? 'drop').toLowerCase()} in ${order.drop.area}`;
    const rider = order.rider ? firstName(order.rider.name) : null;
    if (rider && (order.status === 'PickedUp' || order.status === 'InTransit')) {
      return `Map: ${rider} is between ${order.restaurant.area} and ${home}`;
    }
    if (rider && order.status === 'Assigned') {
      return `Map: ${rider} is on the way to ${order.restaurant.name} in ${order.restaurant.area}`;
    }
    return `Map: ${order.restaurant.name} in ${order.restaurant.area} and ${home}`;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    let frame = 0;
    let stopPulse = () => {};
    const reframe = setInterval(() => {
      if (this.loaded() && this.following() && !this.moving) this.frame(false);
    }, REFRAME);
    destroyRef.onDestroy(() => {
      cancelAnimationFrame(frame);
      clearInterval(reframe);
      stopPulse();
      this.map?.off('movestart', this.onMoveStart).off('moveend', this.onMoveEnd);
    });

    // The rider and the route are drawn on every frame once the map is up.
    effect(() => {
      if (!this.loaded()) return;
      const loop = () => {
        frame = requestAnimationFrame(loop);
        this.draw();
      };
      frame = requestAnimationFrame(loop);
    });

    // The restaurant and the door change only with the order.
    effect(() => {
      if (!this.loaded()) return;
      const order = this.store.order();
      untracked(() => setMarkerData(this.map!, { places: this.places(order) }));
    });

    // The radar ripples around the restaurant while the order looks for a rider.
    effect(() => {
      if (!this.loaded()) return;
      const searching = this.store.order()?.status === 'Searching';
      untracked(() => {
        stopPulse();
        stopPulse = searching ? searchPulse(this.map!) : () => {};
      });
    });

    // A new step or rider is framed straight away, unless the customer has moved the map.
    effect(() => {
      if (!this.loaded() || !this.framing()) return;
      untracked(() => {
        if (this.following()) this.frame(true);
      });
    });

    effect(() => {
      if (!this.loaded()) return;
      const padding = this.padding();
      untracked(() => this.pad(padding));
    });

    effect(() => {
      if (!this.loaded()) return;
      const label = this.label();
      untracked(() => this.map!.getCanvas().setAttribute('aria-label', label));
    });
  }

  /** Back to following the rider, after the customer moved the map. */
  recenter(): void {
    this.following.set(true);
    if (this.loaded()) this.frame(true);
  }

  protected ready(map: MapLibreMap): void {
    this.map = map;
    addMarkers(map, 'light', 'tracking');
    map.on('movestart', this.onMoveStart);
    map.on('moveend', this.onMoveEnd);
    map.jumpTo({ padding: this.padding() });
    this.loaded.set(true);
  }

  /** A drag, pinch or wheel (they carry the browser's event) hands the camera to the customer. */
  private readonly onMoveStart = (event: MapLibreEvent<unknown> & { originalEvent?: unknown }) => {
    if (!event.originalEvent) return;
    this.moving = false;
    this.following.set(false);
  };

  private readonly onMoveEnd = () => {
    this.moving = false;
  };

  /** Where the rider is drawn now: between their last positions, or where the order last saw them. */
  private rider(order: OrderDetails | null): { at: LngLat; bearing: number } | null {
    const rider = order?.rider;
    if (!rider || !onTheRoad(order)) return null;
    const frame = this.store.motion.sampleOne(rider.id, performance.now());
    return frame
      ? { at: [frame.lng, frame.lat], bearing: frame.bearing }
      : { at: lngLat(rider.location), bearing: rider.bearing };
  }

  private draw(): void {
    const order = this.store.order();
    const rider = this.rider(order);
    const key = `${order?.status}|${order?.route.length}|${rider?.at.join()}|${rider?.bearing}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const riders: FeatureCollection = rider
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: rider.at },
              properties: { bearing: rider.bearing },
            },
          ],
        }
      : empty;
    setMarkerData(this.map!, { riders, routes: this.routes(order, rider?.at ?? null) });
  }

  /** The way to the door: dotted behind the rider, orange ahead, all dotted once delivered. */
  private routes(order: OrderDetails | null, rider: LngLat | null): FeatureCollection {
    if (!order) return empty;
    const route =
      order.route.length >= 2
        ? order.route.map(lngLat)
        : [lngLat(order.restaurant.location), lngLat(order.drop.location)];
    const lines: Feature<LineString>[] = [];
    if (order.status === 'Delivered') {
      lines.push(line('travelled', route));
    } else if (rider && order.status === 'Assigned') {
      // On the way to the restaurant, then the ride to the door.
      lines.push(line('active', [rider, lngLat(order.restaurant.location), ...route.slice(1)]));
    } else if (rider) {
      const [travelled, remaining] = splitRoute(route, rider);
      lines.push(line('travelled', travelled), line('active', remaining));
    }
    return { type: 'FeatureCollection', features: lines };
  }

  private places(order: OrderDetails | null): FeatureCollection {
    if (!order) return empty;
    const features: Feature<Point>[] = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: lngLat(order.restaurant.location) },
        properties: {
          kind: 'restaurant',
          label: order.restaurant.name,
          searching: order.status === 'Searching',
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: lngLat(order.drop.location) },
        properties: { kind: 'home', label: order.drop.label ?? 'Home' },
      },
    ];
    return { type: 'FeatureCollection', features };
  }

  /**
   * What the camera keeps in view: the whole way, from the restaurant to the door, and the rider,
   * as the design shows it; for the last stretch, the rider and the door (PLAN.md §5.3).
   */
  private framed(order: OrderDetails): LngLat[] {
    const drop = lngLat(order.drop.location);
    const rider = this.rider(order)?.at;
    if (rider && this.lastStretch()) return [rider, drop];
    const places = [lngLat(order.restaurant.location), drop];
    return rider ? [rider, ...places] : places;
  }

  /**
   * Frames the step inside the padding: a flight for a new step (`fly`), a smooth glide for the
   * regular re-frame, or a jump with reduced motion.
   */
  private frame(fly: boolean): void {
    const map = this.map!;
    const order = this.store.order();
    if (!order) return;
    const points = this.framed(order);
    const padding = this.padding();
    const bounds: LngLatBoundsLike = [
      [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
      [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
    ];
    // Fitted inside the padding plus a margin for the pills. An equal margin on every side leaves
    // the middle where the padding alone puts it, so the camera keeps that padding.
    const fit = map.cameraForBounds(bounds, {
      padding: {
        top: padding.top + FIT_MARGIN,
        right: padding.right + FIT_MARGIN,
        bottom: padding.bottom + FIT_MARGIN,
        left: padding.left + FIT_MARGIN,
      },
      absolutePadding: true,
      maxZoom: FIT_MAX_ZOOM,
    });
    if (fit?.center === undefined || fit.zoom === undefined) return;
    const camera = { center: fit.center, zoom: fit.zoom, padding };
    if (this.reducedMotion) {
      map.jumpTo(camera);
      return;
    }
    if (fly) map.flyTo({ ...camera, duration: CAMERA, essential: false });
    else map.easeTo({ ...camera, duration: CAMERA });
    // Ending a move (arriving, a drag, another move) fires moveend, which clears this.
    this.moving = map.isMoving();
  }

  /**
   * New room around the map (the sheet moved). While following, the camera frames the step again
   * in the new room; otherwise the map stays put on screen and only the centre it keeps moves.
   */
  private pad(padding: Required<PaddingOptions>): void {
    const map = this.map!;
    if (this.following()) {
      this.frame(false);
      return;
    }
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const center = map.unproject([
      (width + padding.left - padding.right) / 2,
      (height + padding.top - padding.bottom) / 2,
    ]);
    map.jumpTo({ center, padding });
  }
}

function line(kind: 'active' | 'travelled', coordinates: LngLat[]): Feature<LineString> {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { kind } };
}
