import { Component, input } from '@angular/core';

export type ChipTone = 'accent' | 'available' | 'late' | 'needs-rider';

/**
 * Status chip: 12/600 pill with a tint background and the status text colour.
 * `needs-rider` is the outlined chip with a 6px dot from the order queue.
 * Sizes follow the designs: sm 3×8 (order row), md 3×9 (rider card), lg 4×10 (rider sheet).
 */
@Component({
  selector: 'ui-chip',
  template: `
    @if (tone() === 'needs-rider') {
      <span class="dot" aria-hidden="true"></span>
    }
    <ng-content />
  `,
  host: {
    '[attr.data-tone]': 'tone()',
    '[attr.data-size]': 'size()',
    '[attr.data-strong]': 'strong() || null',
  },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-6);
      flex: none;
      border-radius: var(--radius-pill);
      font-size: var(--text-caption);
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
      padding: var(--spacing-3) var(--spacing-8);
      /* Status changes cross-fade colours and label (PLAN.md §6.3). */
      transition:
        background-color var(--duration-base) var(--ease-standard),
        color var(--duration-base) var(--ease-standard),
        border-color var(--duration-base) var(--ease-standard);
    }
    :host([data-size='md']) {
      padding: var(--spacing-3) var(--spacing-9);
    }
    :host([data-size='lg']) {
      padding: var(--spacing-4) var(--spacing-10);
    }
    :host([data-strong]) {
      font-weight: var(--font-weight-bold);
    }
    :host([data-tone='accent']) {
      background: var(--ui-accent-tint);
      color: var(--ui-accent-text);
    }
    :host([data-tone='available']) {
      background: var(--ui-available-tint);
      color: var(--ui-available-text);
    }
    :host([data-tone='late']) {
      background: var(--ui-late-tint);
      color: var(--ui-late-text);
    }
    :host([data-tone='needs-rider']) {
      color: var(--ui-accent-text);
      border: var(--border-width-hairline) solid var(--color-accent-orange-outline);
      padding: var(--spacing-2) var(--spacing-8);
    }
    .dot {
      width: var(--spacing-dot-chip);
      height: var(--spacing-dot-chip);
      border-radius: var(--radius-circle);
      background: var(--ui-accent);
    }
  `,
})
export class Chip {
  readonly tone = input<ChipTone>('accent');
  readonly size = input<'sm' | 'md' | 'lg'>('sm');
  readonly strong = input(false);
}
