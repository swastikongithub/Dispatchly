import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type {
  LngLatBoundsLike,
  Map as MapLibreMap,
  MapLibreEvent,
  PaddingOptions,
} from 'maplibre-gl';
import { distance, lngLat, type LngLat } from '../dispatch/route-geometry';
import { MapView, centralDelhi } from '../map/map-view';
import { addMarkers, setMarkerData, viewScale } from '../map/markers';
import { tokens } from '../tokens';
import { prefersReducedMotion } from '../ui/motion';
import { clampPin, type Address, type Restaurant } from './order-flow';

export type OrderStep = 'restaurant' | 'drop' | 'summary';

const CAMERA = parseFloat(tokens.motion.duration.camera);
/** Close enough to put the pin on a door: a few streets across. */
const PIN_ZOOM = 16;
/** Framing a few places never zooms in past this. */
const FIT_MAX_ZOOM = 15;
/**
 * How far the drop pin may move from the saved address (m). It fine-tunes the address, whose
 * text stays the same, so it can't wander off to another street.
 */
export const PIN_RADIUS = 250;

const g = tokens.marker.geometry.tracking;
/** Room around framed places for the pills above their pins, clear of the screen's edge. */
const FIT_MARGIN = Math.round(
  (g.home.r + g.home.stroke + g.pill.height) * viewScale('tracking') +
    parseFloat(tokens.layout.phoneOverlayInset),
);

/**
 * The order page's light map (PLAN.md §5.5): the restaurants near the saved address as ink pins,
 * the address as the Home pin, and the chosen restaurant's name pill. Drawn as GeoJSON layers with
 * the tracking markers. In the drop step the Home pin stays in the middle of the visible map and
 * the map moves under it, kept within `PIN_RADIUS` of the address.
 */
@Component({
  selector: 'app-order-map',
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
export class OrderMap {
  readonly step = input.required<OrderStep>();
  readonly restaurants = input<readonly Restaurant[]>([]);
  readonly address = input<Address | null>(null);
  /** The chosen restaurant, shown with its name pill. */
  readonly selected = input<Restaurant | null>(null);
  /** A restaurant pointed at in the list, which shows its name pill too. */
  readonly hovered = input<number | null>(null);
  /** Room the sheet or panel and the top bar take, so the camera frames the visible map. */
  readonly padding = input<Required<PaddingOptions>>({ top: 0, right: 0, bottom: 0, left: 0 });

  /** A restaurant's pin was clicked. */
  readonly pick = output<number>();
  /** Where the drop pin is: the saved address, or where it was moved to. */
  readonly pin = signal<LngLat | null>(null);

  protected readonly start = centralDelhi;
  protected readonly startZoom = 12;

  private readonly reducedMotion = prefersReducedMotion();
  private map?: MapLibreMap;
  private readonly loaded = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.map?.off('move', this.follow).off('moveend', this.keepNear));

    // The pin starts on the saved address.
    effect(() => {
      const address = this.address();
      untracked(() => {
        if (address && !this.pin()) this.pin.set(lngLat(address.location));
      });
    });

    // Redraw the places whenever what they show changes.
    effect(() => {
      if (!this.loaded()) return;
      const data = this.places(
        this.step(),
        this.restaurants(),
        this.selected(),
        this.hovered(),
        this.address(),
        this.pin(),
      );
      untracked(() => setMarkerData(this.map!, { places: data }));
    });

    // Each step frames what it's about.
    effect(() => {
      if (!this.loaded()) return;
      const step = this.step();
      // Read here so the camera moves again when they arrive.
      const restaurants = this.restaurants();
      const selected = this.selected();
      const address = this.address();
      untracked(() => this.frame(step, restaurants, selected, address));
    });

    effect(() => {
      if (!this.loaded()) return;
      const padding = this.padding();
      untracked(() => this.pad(padding));
    });
  }

  protected ready(map: MapLibreMap): void {
    this.map = map;
    addMarkers(map, 'light', 'tracking');
    map.on('click', 'restaurants', (e) => {
      const id = e.features?.[0]?.properties?.['id'];
      if (typeof id === 'number' && this.step() === 'restaurant') this.pick.emit(id);
    });
    map.on('mouseenter', 'restaurants', () => {
      if (this.step() === 'restaurant') map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'restaurants', () => (map.getCanvas().style.cursor = ''));
    map.on('move', this.follow);
    map.on('moveend', this.keepNear);
    map.jumpTo({ padding: this.padding() });
    this.loaded.set(true);
  }

  /**
   * In the drop step, the pin is wherever the middle of the visible map is while the customer
   * moves the map (or it glides back near the address). The flight into the step doesn't take
   * the pin along: it flies to the pin.
   */
  private readonly follow = (event: MapLibreEvent<unknown> & { originalEvent?: unknown }) => {
    if (this.step() !== 'drop' || !this.map || !(event.originalEvent || this.gliding)) return;
    const { lng, lat } = this.map.getCenter();
    this.pin.set([lng, lat]);
  };

  /** The map is gliding the pin back within its radius. */
  private gliding = false;

  /** A pin moved too far from the address glides back to the edge of its radius. */
  private readonly keepNear = () => {
    this.gliding = false;
    const address = this.address();
    const pin = this.pin();
    if (this.step() !== 'drop' || !this.map || !address || !pin) return;
    const kept = clampPin(lngLat(address.location), pin, PIN_RADIUS);
    if (distance(kept, pin) < 1) return;
    this.gliding = true;
    this.map.easeTo({ center: kept, duration: this.reducedMotion ? 0 : CAMERA / 2 });
  };

  private frame(
    step: OrderStep,
    restaurants: readonly Restaurant[],
    selected: Restaurant | null,
    address: Address | null,
  ): void {
    const map = this.map!;
    const home = this.pin() ?? (address ? lngLat(address.location) : null);
    if (step === 'drop') {
      if (!home) return;
      const options = { center: home, zoom: PIN_ZOOM, padding: this.padding() };
      if (this.reducedMotion) map.jumpTo(options);
      else map.flyTo({ ...options, duration: CAMERA, essential: false });
      return;
    }
    const points: LngLat[] =
      step === 'summary'
        ? [...(selected ? [lngLat(selected.location)] : []), ...(home ? [home] : [])]
        : [...restaurants.map((r) => lngLat(r.location)), ...(home ? [home] : [])];
    if (points.length === 0) return;
    const bounds: LngLatBoundsLike = [
      [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
      [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
    ];
    const padding = this.padding();
    const camera = map.cameraForBounds(bounds, {
      padding: {
        top: padding.top + FIT_MARGIN,
        right: padding.right + FIT_MARGIN,
        bottom: padding.bottom + FIT_MARGIN,
        left: padding.left + FIT_MARGIN,
      },
      maxZoom: FIT_MAX_ZOOM,
    });
    if (!camera) return;
    // cameraForBounds centres the whole map; with the padding set, the visible part is centred.
    const options = { center: camera.center, zoom: camera.zoom, padding };
    if (this.reducedMotion) map.jumpTo(options);
    else map.flyTo({ ...options, duration: CAMERA, essential: false });
  }

  /**
   * New room around the map (the sheet moved). In the drop step the pin stays in the middle of
   * what's visible; otherwise the map stays put on screen and only the centre it keeps moves.
   */
  private pad(padding: Required<PaddingOptions>): void {
    const map = this.map!;
    const pin = this.pin();
    if (this.step() === 'drop' && pin) {
      map.jumpTo({ center: pin, padding });
      return;
    }
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const center = map.unproject([
      (width + padding.left - padding.right) / 2,
      (height + padding.top - padding.bottom) / 2,
    ]);
    map.jumpTo({ center, padding });
  }

  private places(
    step: OrderStep,
    restaurants: readonly Restaurant[],
    selected: Restaurant | null,
    hovered: number | null,
    address: Address | null,
    pin: LngLat | null,
  ): FeatureCollection {
    const shown = step === 'restaurant' ? restaurants : selected ? [selected] : [];
    const features: Feature<Point>[] = shown.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: lngLat(r.location) },
      properties: {
        kind: 'restaurant',
        id: r.id,
        ...(r.id === selected?.id || r.id === hovered ? { label: r.name } : {}),
      },
    }));
    if (address && pin) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pin },
        properties: { kind: 'home', label: address.label },
      });
    }
    return { type: 'FeatureCollection', features };
  }
}
