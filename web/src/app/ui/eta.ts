import { Component, input } from '@angular/core';
import { Roll } from './roll';

/**
 * ETA block: big display number on the left, arrival time and distance aligned right.
 * - hero: tracking sheet, "Arriving in" above a 56px number
 * - panel: dashboard rider card, 44px number with the destination below
 */
@Component({
  selector: 'ui-eta',
  imports: [Roll],
  template: `
    <div class="main">
      @if (variant() === 'hero') {
        <div class="label" [class.ui-skeleton]="loading()">{{ label() }}</div>
      }
      <div class="value" [class.ui-skeleton]="loading()">
        @if (loading()) {
          00 min
        } @else {
          <ui-roll [value]="value()" />
        }
      </div>
      @if (variant() === 'panel') {
        <div class="sub" [class.ui-skeleton]="loading()">
          {{ loading() ? 'to the drop' : sub() }}
        </div>
      }
    </div>
    <div class="side">
      <div class="time" [class.ui-skeleton]="loading()">{{ loading() ? '0:00 PM' : time() }}</div>
      <div class="distance" [class.ui-skeleton]="loading()">
        {{ loading() ? '0.0 km left' : distance() }}
      </div>
    </div>
  `,
  host: { '[attr.data-variant]': 'variant()', '[attr.aria-busy]': 'loading() || null' },
  styles: `
    :host {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-variant-numeric: tabular-nums;
    }
    .label {
      font-size: var(--text-ui);
      color: var(--ui-text-secondary);
      width: fit-content;
    }
    .value {
      font-family: var(--font-display);
      font-weight: var(--text-eta-panel--font-weight);
      font-size: var(--text-eta-panel);
      letter-spacing: var(--text-eta-panel--letter-spacing);
      line-height: var(--text-eta-panel--line-height);
      width: fit-content;
    }
    .sub {
      font-size: var(--text-ui);
      color: var(--ui-text-secondary);
      margin-top: var(--spacing-6);
      width: fit-content;
    }
    .side {
      text-align: right;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .time {
      font-size: var(--text-body-small);
      font-weight: var(--font-weight-semibold);
    }
    .distance {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      margin-top: var(--spacing-2);
    }

    :host([data-variant='hero']) .value {
      font-weight: var(--text-eta-hero--font-weight);
      font-size: var(--text-eta-hero);
      letter-spacing: var(--text-eta-hero--letter-spacing);
      line-height: var(--text-eta-hero--line-height);
      margin-top: var(--spacing-4);
    }
    :host([data-variant='hero']) .side {
      padding-bottom: var(--spacing-4);
    }
    :host([data-variant='hero']) .time {
      font-size: var(--text-spec);
    }
    :host([data-variant='hero']) .distance {
      font-size: var(--text-ui);
    }
  `,
})
export class Eta {
  readonly variant = input<'hero' | 'panel'>('panel');
  readonly label = input('Arriving in');
  readonly value = input('');
  readonly sub = input('');
  readonly time = input('');
  readonly distance = input('');
  readonly loading = input(false);
}
