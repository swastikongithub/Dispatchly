import { Component, input, output } from '@angular/core';
import { LucideLayers2, LucideLocateFixed, LucideMinus, LucidePlus } from '@lucide/angular';
import { IconButton } from './icon-button';

/** Map controls: layers, recenter, and zoom in/out stacked in one 12px-radius group. */
@Component({
  selector: 'ui-map-controls',
  imports: [IconButton, LucideLayers2, LucideLocateFixed, LucidePlus, LucideMinus],
  template: `
    <button
      type="button"
      uiIconButton="map"
      aria-label="Map layers"
      [disabled]="disabled()"
      (click)="layers.emit()"
    >
      <svg lucideLayers2 aria-hidden="true"></svg>
    </button>
    <button
      type="button"
      uiIconButton="map"
      aria-label="Recenter map"
      [disabled]="disabled()"
      (click)="recenter.emit()"
    >
      <svg lucideLocateFixed aria-hidden="true"></svg>
    </button>
    <div class="zoom" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom in" [disabled]="disabled()" (click)="zoomIn.emit()">
        <svg lucidePlus aria-hidden="true"></svg>
      </button>
      <button type="button" aria-label="Zoom out" [disabled]="disabled()" (click)="zoomOut.emit()">
        <svg lucideMinus aria-hidden="true"></svg>
      </button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      gap: var(--spacing-8);
      align-items: flex-end;
    }
    .zoom {
      display: flex;
      flex-direction: column;
      border-radius: var(--radius-control);
      border: var(--border-width-hairline) solid var(--ui-surface-border);
      background: var(--ui-surface-floating);
      box-shadow: var(--ui-floating-shadow);
      overflow: hidden;
    }
    .zoom button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--spacing-map-control);
      height: var(--spacing-map-control);
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--ui-map-control-icon);
      cursor: pointer;
      transition: background-color var(--duration-fast) var(--ease-standard);
    }
    .zoom button:first-child {
      border-bottom: var(--border-width-hairline) solid var(--ui-input-border);
    }
    .zoom button:hover:not(:disabled) {
      background: var(--ui-hover);
    }
    .zoom button:active:not(:disabled) svg {
      transform: scale(var(--scale-press));
    }
    .zoom button:focus-visible {
      outline-offset: calc(var(--focus-offset) * -1 - var(--focus-width));
    }
    .zoom button:disabled {
      color: var(--ui-text-disabled);
      cursor: not-allowed;
    }
    .zoom svg {
      width: var(--icon-size-18);
      height: var(--icon-size-18);
      transition: transform var(--duration-instant) var(--ease-standard);
    }
  `,
})
export class MapControls {
  readonly disabled = input(false);
  readonly layers = output<void>();
  readonly recenter = output<void>();
  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
}
