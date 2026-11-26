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
        attributionControl: { compact: true },
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
