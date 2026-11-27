import { Component, computed, input, output } from '@angular/core';
import { LucidePhone, LucideX } from '@lucide/angular';
import { Avatar, IconButton } from '../ui';
import { callLink, firstName, type OrderDetails } from './tracking-flow';

/**
 * Get help (PLAN.md §11.7): the rider's and the restaurant's numbers, each with Call. Not in the
 * designs, so it's built from the panel, avatar and icon buttons only (§5.5). The tracking page
 * places it below its help button, and closes it on Esc or a tap outside.
 */
@Component({
  selector: 'app-tracking-help',
  imports: [Avatar, IconButton, LucidePhone, LucideX],
  template: `
    <div class="head">
      <h2 class="title" id="tracking-help-title">Get help</h2>
      <button type="button" uiIconButton="raised" aria-label="Close help" (click)="closed.emit()">
        <svg lucideX aria-hidden="true"></svg>
      </button>
    </div>
    @if (order(); as order) {
      <ul>
        @if (order.rider?.phone; as phone) {
          <li>
            <ui-avatar [name]="order.rider!.name" size="sm" aria-hidden="true" />
            <span class="who">
              <span class="name">{{ order.rider!.name }}</span>
              <span class="sub">Your rider · {{ phone }}</span>
            </span>
            <a
              uiIconButton="outline"
              [href]="callLink(phone)"
              [attr.aria-label]="'Call ' + riderFirst()"
            >
              <svg lucidePhone aria-hidden="true"></svg>
            </a>
          </li>
        }
        <li>
          <ui-avatar [name]="order.restaurant.name" size="sm" aria-hidden="true" />
          <span class="who">
            <span class="name">{{ order.restaurant.name }}</span>
            <span class="sub">Restaurant · {{ order.restaurant.phone }}</span>
          </span>
          <a
            uiIconButton="outline"
            [href]="callLink(order.restaurant.phone)"
            [attr.aria-label]="'Call ' + order.restaurant.name"
          >
            <svg lucidePhone aria-hidden="true"></svg>
          </a>
        </li>
      </ul>
    } @else {
      <p class="lead">
        @if (notFound()) {
          There’s no order #{{ code() }} to get help with.
        } @else {
          Your rider’s and the restaurant’s numbers show here once your order loads.
        }
      </p>
    }
  `,
  host: {
    class: 'ui-panel',
    role: 'dialog',
    'aria-labelledby': 'tracking-help-title',
  },
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-12);
      padding: var(--spacing-18);
      background: var(--ui-surface);
      border-radius: var(--radius-panel);
      box-shadow: var(--ui-floating-shadow);
      animation: drop-in var(--duration-base) var(--ease-enter);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-12);
    }
    .title {
      margin: 0;
      font-size: var(--text-spec);
      font-weight: var(--font-weight-semibold);
    }
    .lead {
      margin: 0;
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--spacing-10);
      padding: var(--spacing-8) 0;
      border-bottom: var(--border-width-hairline) solid var(--ui-divider);
    }
    li:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .who {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .name {
      font-size: var(--text-ui);
      font-weight: var(--font-weight-semibold);
    }
    .sub {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    @keyframes drop-in {
      from {
        opacity: 0;
        transform: translateY(calc(var(--spacing-8) * -1));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `,
})
export class TrackingHelp {
  /** The order, once it has loaded. */
  readonly order = input.required<OrderDetails | null>();
  /** The order code from the link, for when there's no such order. */
  readonly code = input.required<string>();
  readonly notFound = input(false);
  readonly closed = output<void>();

  protected readonly callLink = callLink;
  protected readonly riderFirst = computed(() => firstName(this.order()?.rider?.name ?? ''));
}
