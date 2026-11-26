import { Component, input, output } from '@angular/core';
import { Chip, ChipTone } from './chip';

/**
 * Order queue row: ID + chip / restaurant → area (one line, ellipsis) / rider + ETA.
 * The selected row is raised with a 12px radius. Use inside a <ul>.
 */
@Component({
  selector: 'li[uiOrderRow]',
  imports: [Chip],
  template: `
    <button
      type="button"
      class="row"
      [attr.aria-current]="selected() || null"
      [attr.data-state]="state()"
      [disabled]="disabled() || loading()"
      (click)="select.emit()"
    >
      <span class="line">
        <span class="id" [class.ui-skeleton]="loading()">{{ orderId() }}</span>
        @if (loading()) {
          <span class="ui-skeleton chip-placeholder">On the way</span>
        } @else {
          <ui-chip [tone]="chipTone()" size="sm">{{ chipLabel() }}</ui-chip>
        }
      </span>
      <span class="route" [class.ui-skeleton]="loading()" [attr.title]="from() + ' → ' + to()">
        {{ from() }} <span class="to">→ {{ to() }}</span>
      </span>
      <span class="line meta">
        <span [class.ui-skeleton]="loading()">{{ metaStart() }}</span>
        <span class="end" [attr.data-tone]="metaEndTone()" [class.ui-skeleton]="loading()">{{
          metaEnd()
        }}</span>
      </span>
    </button>
  `,
  host: {
    '[attr.data-selected]': 'selected() || null',
    '[attr.data-highlight]': 'highlight() || null',
    '[attr.aria-busy]': 'loading() || null',
  },
  styles: `
    :host {
      display: block;
      border-bottom: var(--border-width-hairline) solid var(--ui-divider);
    }
    :host(:last-child) {
      border-bottom: 0;
    }
    :host([data-selected]) {
      padding: var(--spacing-4) 0;
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
    .row:hover:not(:disabled),
    .row[data-state='hover'] {
      background: var(--ui-hover);
    }
    .row:active:not(:disabled),
    .row[data-state='pressed'] {
      transform: scale(var(--scale-press));
    }
    .row[aria-current] {
      background: var(--ui-selected);
      padding: var(--spacing-11) var(--spacing-10);
    }
    .row:disabled {
      cursor: not-allowed;
      color: var(--ui-text-disabled);
    }
    .row:disabled .to,
    .row:disabled .meta {
      color: var(--ui-text-disabled);
    }
    :host([aria-busy]) .row {
      cursor: progress;
    }
    /* A new order fades its background from the accent tint over 1.2 s (PLAN.md §6.3). */
    :host([data-highlight]) .row {
      animation: highlight var(--duration-row-highlight) var(--ease-standard);
    }
    @keyframes highlight {
      from {
        background: var(--ui-accent-tint);
      }
    }
    .line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--spacing-8);
    }
    .id {
      font-size: var(--text-meta);
      font-weight: var(--font-weight-semibold);
      font-variant-numeric: tabular-nums;
    }
    .chip-placeholder {
      font-size: var(--text-caption);
      padding: var(--spacing-3) var(--spacing-8);
      border-radius: var(--radius-pill);
    }
    .route {
      font-size: var(--text-ui);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .to {
      color: var(--ui-text-secondary);
    }
    .meta {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
    }
    .end {
      font-variant-numeric: tabular-nums;
    }
    .end[data-tone='eta'] {
      color: var(--ui-text-primary);
      font-weight: var(--font-weight-semibold);
    }
    .end[data-tone='late'] {
      color: var(--ui-late-text);
      font-weight: var(--font-weight-semibold);
    }
  `,
})
export class OrderRow {
  readonly orderId = input.required<string>();
  readonly chipTone = input.required<ChipTone>();
  readonly chipLabel = input.required<string>();
  readonly from = input.required<string>();
  readonly to = input.required<string>();
  readonly metaStart = input.required<string>();
  readonly metaEnd = input.required<string>();
  /** `muted` for "waiting 0:12", `eta` for "8 min", `late` for "12 min · +5". */
  readonly metaEndTone = input<'muted' | 'eta' | 'late'>('eta');
  readonly selected = input(false);
  readonly highlight = input(false);
  readonly disabled = input(false);
  readonly loading = input(false);
  /** Styleguide only. */
  readonly state = input<'hover' | 'pressed' | 'focus' | null>(null);
  readonly select = output<void>();
}
