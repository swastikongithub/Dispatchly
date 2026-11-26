import { Component, input } from '@angular/core';

export interface TimelineStep {
  title: string;
  detail: string;
  /** Clock time, or "Now" for the current step. */
  time: string;
  state: 'done' | 'current' | 'pending';
}

/** Order timeline: 10px dots, done = orange, current = orange ring with halo, pending = grey ring. */
@Component({
  selector: 'ui-timeline',
  template: `
    <ol>
      @for (step of steps(); track step.title; let last = $last) {
        <li
          [attr.data-state]="step.state"
          [attr.aria-current]="step.state === 'current' ? 'step' : null"
        >
          <span class="rail" aria-hidden="true">
            <span class="dot"></span>
            @if (!last) {
              <span class="line"></span>
            }
          </span>
          <span class="body" [class.last]="last">
            <span class="head">
              <span [class.ui-skeleton]="loading()">{{ step.title }}</span>
              <span class="time" [class.ui-skeleton]="loading()">{{ step.time }}</span>
            </span>
            <span class="detail" [class.ui-skeleton]="loading()">{{ step.detail }}</span>
          </span>
        </li>
      }
    </ol>
  `,
  host: { '[attr.aria-busy]': 'loading() || null' },
  styles: `
    :host {
      display: block;
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    li {
      display: flex;
      gap: var(--spacing-12);
    }
    .rail {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: none;
      width: var(--spacing-dot-timeline-current);
    }
    .dot {
      box-sizing: border-box;
      width: var(--spacing-dot-timeline);
      height: var(--spacing-dot-timeline);
      border-radius: var(--radius-circle);
      margin-top: var(--spacing-4);
      background: var(--ui-accent);
      transition:
        background-color var(--duration-base) var(--ease-standard),
        border-color var(--duration-base) var(--ease-standard);
    }
    .line {
      flex: 1;
      width: var(--spacing-timeline-line);
      min-height: var(--spacing-timeline-step-min-height);
      background: var(--ui-accent);
      opacity: var(--opacity-timeline-done);
    }
    [data-state='current'] .dot {
      width: var(--spacing-dot-timeline-current);
      height: var(--spacing-dot-timeline-current);
      margin-top: var(--spacing-3);
      background: transparent;
      border: var(--border-width-timeline-current) solid var(--ui-accent);
      box-shadow: var(--shadow-live-ring);
    }
    [data-state='current'] .line {
      background: var(--ui-timeline-line);
      opacity: 1;
    }
    [data-state='pending'] .dot {
      background: transparent;
      border: var(--border-width-timeline-pending) solid var(--ui-timeline-pending);
    }
    [data-state='pending'] .line {
      background: var(--ui-timeline-line);
      opacity: 1;
    }
    .body {
      flex: 1;
      min-width: 0;
      padding-bottom: var(--spacing-12);
    }
    .body.last {
      padding-bottom: 0;
    }
    .head {
      display: flex;
      justify-content: space-between;
      gap: var(--spacing-8);
      font-size: var(--text-ui);
      font-weight: var(--font-weight-semibold);
    }
    [data-state='pending'] .head {
      color: var(--ui-text-body);
    }
    .time {
      font-size: var(--text-meta);
      font-weight: var(--font-weight-medium);
      color: var(--ui-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    [data-state='current'] .time {
      font-weight: var(--font-weight-semibold);
      color: var(--ui-accent-text);
    }
    .detail {
      display: block;
      width: fit-content;
      max-width: 100%;
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      margin-top: var(--spacing-2);
    }
  `,
})
export class Timeline {
  readonly steps = input.required<readonly TimelineStep[]>();
  readonly loading = input(false);
}
