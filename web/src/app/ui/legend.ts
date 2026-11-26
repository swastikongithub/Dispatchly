import { Component, input } from '@angular/core';
import { Roll } from './roll';

export interface LegendItem {
  kind: 'available' | 'on-delivery' | 'late' | 'restaurant';
  label: string;
  count?: number;
}

/** Map legend: coloured dots with counts, in a 14px-radius panel. */
@Component({
  selector: 'ui-legend',
  imports: [Roll],
  template: `
    <ul>
      @for (item of items(); track item.kind) {
        <li>
          <span class="dot" [attr.data-kind]="item.kind" aria-hidden="true"></span>
          <span [class.ui-skeleton]="loading()">
            {{ item.label }}
            @if (item.count !== undefined) {
              <ui-roll [value]="item.count" />
            }
          </span>
        </li>
      }
    </ul>
  `,
  host: { '[attr.aria-busy]': 'loading() || null' },
  styles: `
    :host {
      box-sizing: border-box;
      display: block;
      width: fit-content;
      background: var(--ui-surface-floating);
      border: var(--border-width-hairline) solid var(--ui-surface-border);
      border-radius: var(--radius-item);
      box-shadow: var(--ui-floating-shadow);
      padding: var(--spacing-11) var(--spacing-16);
      font-size: var(--text-meta);
      color: var(--ui-text-body);
      font-variant-numeric: tabular-nums;
    }
    ul {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-10) var(--spacing-20);
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-8);
    }
    .dot {
      flex: none;
      width: var(--spacing-dot-legend);
      height: var(--spacing-dot-legend);
      border-radius: var(--radius-circle);
    }
    [data-kind='available'] {
      background: var(--ui-available);
    }
    [data-kind='on-delivery'] {
      background: var(--ui-accent);
    }
    [data-kind='late'] {
      background: var(--ui-late);
      box-shadow: var(--shadow-late-ring);
    }
    [data-kind='restaurant'] {
      background: var(--ui-restaurant);
      border-radius: var(--radius-bar);
    }
  `,
})
export class Legend {
  readonly items = input.required<readonly LegendItem[]>();
  readonly loading = input(false);
}
