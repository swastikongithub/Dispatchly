import { Component, computed, input } from '@angular/core';

const DIGITS = '0123456789';

/**
 * A number that rolls its digits vertically when it changes (400 ms, tabular figures,
 * PLAN.md §6.3). Screen readers get the plain value; reduced motion makes the roll instant.
 */
@Component({
  selector: 'ui-roll',
  template: `
    <span class="sr-only">{{ value() }}</span>
    <span class="chars" aria-hidden="true">
      @for (char of chars(); track char.key) {
        @if (char.digit === null) {
          <span>{{ char.text }}</span>
        } @else {
          <span class="column">
            <span class="strip" [style.--digit]="char.digit">
              @for (d of digits; track d) {
                <span>{{ d }}</span>
              }
            </span>
          </span>
        }
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-block;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .chars {
      display: inline-flex;
      white-space: pre;
    }
    .column {
      display: inline-block;
      height: 1lh;
      overflow: hidden;
    }
    .strip {
      display: flex;
      flex-direction: column;
      transform: translateY(calc(var(--digit) * -1lh));
      transition: transform var(--duration-digit-roll) var(--ease-standard);
    }
  `,
})
export class Roll {
  readonly value = input.required<string | number>();
  protected readonly digits = DIGITS;
  /** Keyed from the right, so the units column stays put when the number grows. */
  protected readonly chars = computed(() => {
    const text = String(this.value());
    return [...text].map((c, i) => ({
      key: `${text.length - i}:${DIGITS.includes(c) ? 'd' : c}`,
      text: c,
      digit: DIGITS.includes(c) ? Number(c) : null,
    }));
  });
}
