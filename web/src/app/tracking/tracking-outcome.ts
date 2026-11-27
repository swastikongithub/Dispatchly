import { Component, input } from '@angular/core';
import { LucideCheck, LucideX } from '@lucide/angular';
import { tokens } from '../tokens';

/**
 * Delivered or cancelled, in the ETA's place on the tracking sheet: "Your order", the outcome in
 * the ETA's type, and a check (or a cross). Not in the designs, so it's built from the ETA's type
 * and the avatar's circle (PLAN.md §5.5).
 */
@Component({
  selector: 'app-tracking-outcome',
  imports: [LucideCheck, LucideX],
  template: `
    <div>
      <div class="label">Your order</div>
      <h1 class="title">{{ stage() === 'delivered' ? 'Delivered' : 'Cancelled' }}</h1>
    </div>
    <span class="icon" [attr.data-stage]="stage()" aria-hidden="true">
      @if (stage() === 'delivered') {
        <svg lucideCheck [strokeWidth]="strokeHeavy"></svg>
      } @else {
        <svg lucideX [strokeWidth]="strokeHeavy"></svg>
      }
    </span>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .label {
      font-size: var(--text-ui);
      color: var(--ui-text-secondary);
    }
    .title {
      margin: var(--spacing-4) 0 0;
      font-family: var(--font-display);
      font-size: var(--text-eta-hero);
      font-weight: var(--text-eta-hero--font-weight);
      letter-spacing: var(--text-eta-hero--letter-spacing);
      line-height: var(--text-eta-hero--line-height);
    }
    .icon {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--spacing-avatar);
      height: var(--spacing-avatar);
      margin-bottom: var(--spacing-4);
      border-radius: var(--radius-circle);
      background: var(--ui-accent-tint);
      color: var(--ui-accent-text);
    }
    .icon[data-stage='cancelled'] {
      background: var(--ui-raised);
      color: var(--ui-text-secondary);
    }
    .icon svg {
      width: var(--icon-size-22);
      height: var(--icon-size-22);
    }
    /* The check comes in once, as the slide to confirm's does. */
    .icon[data-stage='delivered'] {
      animation: check-in var(--duration-success-check) var(--ease-enter);
    }
    @keyframes check-in {
      from {
        opacity: 0;
        transform: scale(var(--scale-map-frame-enter));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .icon[data-stage='delivered'] {
        animation: none;
      }
    }
  `,
})
export class TrackingOutcome {
  readonly stage = input.required<'delivered' | 'cancelled'>();

  protected readonly strokeHeavy = tokens.icon.strokeHeavy;
}
