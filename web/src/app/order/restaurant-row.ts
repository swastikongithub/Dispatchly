import { Component, input, output } from '@angular/core';

/**
 * A restaurant in the order page's list, in the order row's style (PLAN.md §5.5): name and
 * distance / area and prep time, hairline dividers, and the selected row raised with a 12px
 * radius. Use inside a <ul>.
 */
@Component({
  selector: 'li[appRestaurantRow]',
  template: `
    <button
      type="button"
      class="row"
      [attr.aria-current]="selected() || null"
      [disabled]="loading()"
      (click)="select.emit()"
    >
      <span class="line">
        <span class="name" [class.ui-skeleton]="loading()">{{ name() }}</span>
        <span class="distance" [class.ui-skeleton]="loading()">{{ distance() }}</span>
      </span>
      <span class="meta" [class.ui-skeleton]="loading()">
        {{ area() }} · Ready in {{ prepMinutes() }} min
      </span>
    </button>
  `,
  host: { '[attr.aria-busy]': 'loading() || null' },
  styles: `
    :host {
      display: block;
      border-bottom: var(--border-width-hairline) solid var(--ui-divider);
    }
    :host(:last-child) {
      border-bottom: 0;
    }
    .row {
      box-sizing: border-box;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      padding: var(--spacing-11) var(--spacing-6);
      border: 0;
      border-radius: var(--radius-control);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        transform var(--duration-instant) var(--ease-standard),
        background-color var(--duration-fast) var(--ease-standard);
    }
    .row:hover:not(:disabled) {
      background: var(--ui-hover);
    }
    .row:active:not(:disabled) {
      transform: scale(var(--scale-press));
    }
    .row[aria-current] {
      background: var(--ui-selected);
    }
    :host([aria-busy]) .row {
      cursor: progress;
    }
    .line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: var(--spacing-8);
    }
    .name {
      min-width: 0;
      font-size: var(--text-ui);
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .distance {
      flex: none;
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .meta {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class RestaurantRow {
  readonly name = input.required<string>();
  readonly area = input.required<string>();
  /** "0.8 km". */
  readonly distance = input.required<string>();
  readonly prepMinutes = input.required<number>();
  readonly selected = input(false);
  readonly loading = input(false);
  readonly select = output<void>();
}
