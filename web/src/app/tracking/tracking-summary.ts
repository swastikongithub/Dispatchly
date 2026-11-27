import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  viewChild,
} from '@angular/core';
import { LucideChevronRight } from '@lucide/angular';
import { prefersReducedMotion } from '../ui/motion';
import { lineLabel, restaurantLine, summaryLine, type OrderDetails } from './tracking-flow';

/**
 * The order at the foot of the tracking sheet (designs/html/tracking.html): "Saffron & Smoke, Khan
 * Market · 2 items · ₹640 · Paid online · Details ›". Details opens the order's lines and where
 * it goes under it (PLAN.md §11.7), and scrolls them into view. Until the order loads, it's a
 * placeholder of the same size.
 */
@Component({
  selector: 'app-tracking-summary',
  imports: [LucideChevronRight],
  template: `
    @if (order(); as order) {
      <button
        type="button"
        class="summary"
        aria-controls="order-details"
        [attr.aria-expanded]="open()"
        (click)="toggled.emit()"
      >
        <span class="text">
          <span class="title">{{ restaurant() }}</span>
          <span class="sub">{{ summary() }}</span>
        </span>
        <span class="link" [class.open]="open()">
          Details<svg lucideChevronRight aria-hidden="true"></svg>
        </span>
      </button>
      <div #details id="order-details" class="details" [hidden]="!open()">
        <ul class="lines" aria-label="Items">
          @for (line of lines(); track line.id) {
            <li>
              <span>{{ line.name }}</span>
              <span class="price">{{ line.price }}</span>
            </li>
          }
        </ul>
        <div class="deliver-to">
          <span class="deliver-title">Deliver to {{ order.drop.label ?? 'your door' }}</span>
          <span class="deliver-sub">{{ order.drop.address }}</span>
        </div>
      </div>
    } @else {
      <div class="text" aria-hidden="true">
        <span class="title ui-skeleton">Saffron &amp; Smoke, Khan Market</span>
        <span class="sub ui-skeleton">2 items · ₹640 · Paid online</span>
      </div>
    }
  `,
  styles: `
    /* The summary and the details sit in the sheet's column, spaced as the rest of it. */
    :host {
      display: contents;
    }
    .summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--spacing-12);
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: transform var(--duration-instant) var(--ease-standard);
    }
    .summary:active {
      transform: scale(var(--scale-press));
    }
    /* As in the design: the name on its own line, the line under it inline in the row's text. */
    .text {
      min-width: 0;
      display: block;
    }
    .title {
      display: block;
      width: fit-content;
      font-size: var(--text-body-small);
      font-weight: var(--font-weight-semibold);
    }
    .sub {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .link {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--text-ui);
      font-weight: var(--font-weight-semibold);
      color: var(--ui-accent-text);
    }
    .link svg {
      width: var(--icon-size-16);
      height: var(--icon-size-16);
      transition: transform var(--duration-base) var(--ease-standard);
    }
    .link.open svg {
      transform: rotate(90deg);
    }
    .details {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-12);
      /* Scrolled into view with the sheet's (and the panel's) bottom padding under it. */
      scroll-margin-bottom: var(--spacing-24);
      animation: fade-in var(--duration-base) var(--ease-enter);
    }
    .details[hidden] {
      display: none;
    }
    .lines {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .lines li {
      display: flex;
      justify-content: space-between;
      gap: var(--spacing-12);
      padding: var(--spacing-8) 0;
      border-bottom: var(--border-width-hairline) solid var(--ui-divider);
      font-size: var(--text-ui);
    }
    .lines li:first-child {
      padding-top: 0;
    }
    .price {
      flex: none;
      color: var(--ui-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .deliver-to {
      display: flex;
      flex-direction: column;
    }
    .deliver-title {
      font-size: var(--text-ui);
      font-weight: var(--font-weight-semibold);
    }
    .deliver-sub {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .details {
        animation: none;
      }
      .link svg {
        transition: none;
      }
    }
  `,
})
export class TrackingSummary {
  /** The order, or null while it loads. */
  readonly order = input.required<OrderDetails | null>();
  /** Whether Details is open; the page decides, as it keeps the sheet's height meanwhile. */
  readonly open = input(false);
  readonly toggled = output<void>();

  private readonly injector = inject(Injector);
  private readonly details = viewChild<ElementRef<HTMLElement>>('details');

  protected readonly restaurant = computed(() => {
    const order = this.order();
    return order ? restaurantLine(order) : '';
  });
  protected readonly summary = computed(() => {
    const order = this.order();
    return order ? summaryLine(order) : '';
  });
  protected readonly lines = computed(() =>
    (this.order()?.items ?? []).map((line) => ({ id: line.menuItemId, ...lineLabel(line) })),
  );

  constructor() {
    // Opened: bring the lines into view in the sheet (or the panel).
    effect(() => {
      if (!this.open()) return;
      afterNextRender(
        () =>
          this.details()?.nativeElement.scrollIntoView({
            block: 'nearest',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          }),
        { injector: this.injector },
      );
    });
  }
}
