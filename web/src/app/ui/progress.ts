import { Component, computed, input } from '@angular/core';

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Progress bar: 6px track (5px on cards), orange fill, 3px radius. The fill slides with a
 * transform rather than animating width (PLAN.md §6.1), easing over 600 ms.
 */
@Component({
  selector: 'ui-progress',
  template: `<span class="fill" [style.--progress]="fraction()"></span>`,
  host: {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'percent()',
    '[attr.aria-label]': 'label()',
  },
  styles: `
    :host {
      display: block;
      height: var(--spacing-progress-bar);
      border-radius: var(--radius-bar);
      background: var(--ui-track);
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: var(--radius-bar);
      background: var(--ui-accent);
      transform: translateX(calc((var(--progress) - 1) * 100%));
      transition: transform var(--duration-progress) var(--ease-standard);
    }
  `,
})
export class Progress {
  /** 0 to 1. */
  readonly value = input.required<number>();
  readonly label = input.required<string>();
  protected readonly fraction = computed(() => clamp(this.value()));
  protected readonly percent = computed(() => Math.round(this.fraction() * 100));
}

/** Four-step progress from the tracking sheet: 4px gaps, the current step partly filled. */
@Component({
  selector: 'ui-segmented-progress',
  template: `
    <div class="bars">
      @for (step of steps(); track step; let i = $index) {
        <span class="bar">
          <span class="fill" [style.--progress]="fill(i)"></span>
        </span>
      }
    </div>
    <ol class="labels">
      @for (step of steps(); track step; let i = $index) {
        <li [attr.aria-current]="i === current() ? 'step' : null">{{ step }}</li>
      }
    </ol>
  `,
  host: {
    role: 'group',
    '[attr.aria-label]': 'label()',
  },
  styles: `
    :host {
      display: block;
    }
    .bars {
      display: flex;
      gap: var(--spacing-4);
    }
    .bar {
      flex: 1;
      height: var(--spacing-progress-bar);
      border-radius: var(--radius-bar);
      background: var(--ui-track);
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      background: var(--ui-accent);
      transform: translateX(calc((var(--progress) - 1) * 100%));
      transition: transform var(--duration-progress) var(--ease-standard);
    }
    .labels {
      display: flex;
      list-style: none;
      margin: var(--spacing-8) 0 0;
      padding: 0;
      font-size: var(--text-caption);
      color: var(--ui-text-secondary);
    }
    li {
      flex: 1;
    }
    li[aria-current] {
      color: var(--ui-text-primary);
      font-weight: var(--font-weight-semibold);
    }
  `,
})
export class SegmentedProgress {
  readonly steps = input.required<readonly string[]>();
  /** Index of the current step. */
  readonly current = input.required<number>();
  /** How far through the current step, 0 to 1. */
  readonly partial = input(0);
  readonly label = input.required<string>();
  protected fill(i: number): number {
    if (i < this.current()) return 1;
    if (i > this.current()) return 0;
    return clamp(this.partial());
  }
}
