import { Component, input } from '@angular/core';
import { Roll } from './roll';

/**
 * Stat: number + label. `bar` is the dashboard top bar (17/600 over a 12px label);
 * `landing` is the landing stat strip (44px display over a 15px label, divider on top).
 */
@Component({
  selector: 'ui-stat',
  imports: [Roll],
  template: `
    <div class="value" [class.ui-skeleton]="loading()">
      @if (loading()) {
        000
      } @else {
        <ui-roll [value]="value()" />
      }
    </div>
    <div class="label">{{ label() }}</div>
  `,
  host: {
    '[attr.data-variant]': 'variant()',
    '[attr.data-tone]': 'tone()',
    '[attr.aria-busy]': 'loading() || null',
  },
  styles: `
    :host {
      display: block;
      font-variant-numeric: tabular-nums;
    }
    .value {
      font-size: var(--text-spec);
      font-weight: var(--font-weight-semibold);
      width: fit-content;
    }
    :host([data-tone='late']) .value {
      color: var(--ui-late-text);
    }
    .label {
      font-size: var(--text-caption);
      color: var(--ui-text-secondary);
    }
    :host([data-variant='landing']) {
      padding: var(--spacing-20) var(--spacing-24) var(--spacing-20) 0;
      border-top: var(--border-width-hairline) solid var(--color-dark-stat-divider);
    }
    :host([data-variant='landing']) .value {
      font-family: var(--font-display);
      font-size: var(--text-stat-large);
      font-weight: var(--text-stat-large--font-weight);
      letter-spacing: var(--text-stat-large--letter-spacing);
    }
    :host([data-variant='landing']) .label {
      font-size: var(--text-body-small);
      color: var(--color-dark-text-secondary-alt);
      margin-top: var(--spacing-4);
    }
  `,
})
export class Stat {
  readonly value = input.required<string | number>();
  readonly label = input.required<string>();
  readonly variant = input<'bar' | 'landing'>('bar');
  readonly tone = input<'default' | 'late'>('default');
  readonly loading = input(false);
}
