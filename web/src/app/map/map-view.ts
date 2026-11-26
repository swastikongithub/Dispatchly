import {
  afterNextRender,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import type { Map as MapLibreMap } from 'maplibre-gl';

/** Central Delhi, where the seed data and the designs are set (PLAN.md §12). */
export const centralDelhi: [number, number] = [77.2167, 28.6139];

let stylesheet: Promise<void> | undefined;

/** Loads MapLibre's own stylesheet once, only on screens that show a map (PLAN.md §6.4). */
function loadStylesheet(): Promise<void> {
  stylesheet ??= new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'maplibre.css';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
  return stylesheet;
}

/**
 * A MapLibre map in the Dispatchly dark or light style (app/map/style-*.json, served at
 * /map/style-*.json). MapLibre is loaded lazily with the component.
 */
@Component({
  selector: 'app-map-view',
  template: '',
  styles: `
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: var(--ui-canvas);
    }

    /*
     * The OpenStreetMap credit (required by its licence) in the theme's surface and text colours.
     * maplibre.css loads after these styles, so each rule is one class more specific than its own.
     */
    :host ::ng-deep .maplibregl-ctrl.maplibregl-ctrl-attrib {
      background-color: var(--ui-surface-floating);
      color: var(--ui-text-secondary);
      font-family: var(--font-text);
      font-size: var(--text-caption);
    }
    :host ::ng-deep .maplibregl-ctrl.maplibregl-ctrl-attrib a {
      color: var(--ui-text-secondary);
    }
    :host ::ng-deep .maplibregl-ctrl.maplibregl-ctrl-attrib a:hover {
      color: var(--ui-text-primary);
    }
    :host ::ng-deep .maplibregl-ctrl.maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button {
      background: transparent;
    }
    /* MapLibre's own "i" icon, drawn in the text colour instead of black. */
    :host ::ng-deep .maplibregl-ctrl.maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button::before {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--ui-text-secondary);
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill-rule='evenodd' viewBox='0 0 20 20'%3E%3Cpath d='M4 10a6 6 0 1 0 12 0 6 6 0 1 0-12 0m5-3a1 1 0 1 0 2 0 1 1 0 1 0-2 0m0 3a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0'/%3E%3C/svg%3E")
        center / contain no-repeat;
    }
    :host ::ng-deep .maplibregl-ctrl.maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button:focus {
      box-shadow: none;
    }
    :host
      ::ng-deep
      .maplibregl-ctrl.maplibregl-ctrl-attrib
      .maplibregl-ctrl-attrib-button:focus-visible,
    :host ::ng-deep .maplibregl-ctrl.maplibregl-ctrl-attrib a:focus-visible {
      outline: var(--focus-width) solid var(--ui-focus);
      outline-offset: var(--focus-offset);
    }
  `,
})
export class MapView {
  readonly theme = input<'dark' | 'light'>('dark');
  readonly center = input<[number, number]>(centralDelhi);
  readonly zoom = input(12);
  readonly interactive = input(true);
  readonly ready = output<MapLibreMap>();

  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private map?: MapLibreMap;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(async () => {
      const [{ Map, setWorkerUrl, getVersion }] = await Promise.all([
        import('maplibre-gl'),
        loadStylesheet(),
      ]);
      if (destroyRef.destroyed) return;
      // MapLibre looks for its worker next to its own module, which bundling moves; the worker
      // is copied to /maplibre/ instead (angular.json assets).
      setWorkerUrl(
        new URL(`maplibre/maplibre-gl-worker.mjs?v=${getVersion()}`, document.baseURI).href,
      );
      this.map = new Map({
        container: this.el,
        style: styleUrl(this.theme()),
        center: this.center(),
        zoom: this.zoom(),
        interactive: this.interactive(),
        // MapLibre's default: the full credit while it fits, collapsing to its "i" button on
        // narrow maps once the map is moved.
        attributionControl: {},
      });
      this.map.once('load', () => this.ready.emit(this.map!));
      destroyRef.onDestroy(() => this.map?.remove());
    });
    effect(() => {
      const theme = this.theme();
      untracked(() => this.map?.setStyle(styleUrl(theme)));
    });
  }
}

function styleUrl(theme: 'dark' | 'light'): string {
  return `map/style-${theme}.json`;
}
