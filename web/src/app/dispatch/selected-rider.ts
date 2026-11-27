import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, type Api } from '../core/api/api-client';
import { RiderCard, type RiderCardData, type TimelineStep } from '../ui';
import { DispatchStore, type LiveRider } from './dispatch-store';
import {
  chipOf,
  clockTime,
  deliveriesToday,
  etaMinutes,
  km,
  onlineFor,
  type OrderSummary,
} from './queue';
import { ReassignPopover } from './reassign-popover';
import { distance, lineLength, lngLat, splitRoute } from './route-geometry';

type OrderDetails = Api['OrderDetails'];

/**
 * The selected rider card (PLAN.md §5.2): who the rider is, their order's ETA, progress and
 * timeline, their day, and Call rider / Reassign. Live numbers come from the dashboard's state;
 * the timeline from GET /orders/{code}, fetched again when the order changes.
 */
@Component({
  selector: 'app-selected-rider',
  imports: [RiderCard, ReassignPopover],
  template: `
    @if (card(); as data) {
      <ui-rider-card
        [class.bare]="popover() === 'inline'"
        [rider]="data"
        [loading]="loading()"
        [canReassign]="canReassign()"
        [reassignHint]="canReassign() ? null : 'Already picked up'"
        [reassignOpen]="reassigning()"
        (close)="closed.emit()"
        (call)="call()"
        (reassign)="reassigning.set(true)"
      />
      @if (reassigning() && order(); as current) {
        <app-reassign-popover
          class="popover"
          [attr.data-placement]="popover()"
          [code]="current.code"
          (closed)="closeReassign()"
          (reassigned)="closeReassign()"
        />
      }
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    /* In the bottom sheet, the sheet is the panel. */
    .bare {
      background: transparent;
      border: 0;
      box-shadow: none;
      padding: 0;
    }
    /* Beside the card, level with its actions; in the bottom sheet, below them. */
    .popover[data-placement='side'] {
      position: absolute;
      right: calc(100% + var(--spacing-12));
      bottom: 0;
      width: var(--spacing-rider-card-width);
      z-index: 1;
    }
    .popover[data-placement='inline'] {
      margin-top: var(--spacing-12);
    }
  `,
})
export class SelectedRider {
  private readonly store = inject(DispatchStore);
  private readonly api = inject(ApiClient);

  readonly closed = output<void>();
  /** Where the Reassign confirmation opens. */
  readonly popover = input<'side' | 'inline'>('side');

  protected readonly reassigning = signal(false);
  private readonly details = signal<OrderDetails | null>(null);

  protected readonly rider = computed<LiveRider | null>(() => {
    const id = this.store.selection()?.riderId;
    return id == null ? null : (this.store.riders().get(id) ?? null);
  });

  protected readonly order = computed<OrderSummary | null>(() => {
    const code = this.store.selection()?.code;
    return code ? (this.store.entries().get(code)?.order ?? null) : null;
  });

  /** Waiting for the first details of the selected order. */
  protected readonly loading = computed(() => {
    const order = this.order();
    return order !== null && this.details()?.code !== order.code;
  });

  protected readonly canReassign = computed(() => this.order()?.status === 'Assigned');

  protected readonly card = computed<RiderCardData | null>(() => {
    const rider = this.rider();
    if (!rider) return null;
    const now = this.store.now();
    const base = {
      name: rider.name,
      vehicle: `${rider.vehicle} · ${rider.plate}`,
      deliveriesToday: deliveriesToday(rider.deliveriesToday),
      online: onlineFor(rider.onlineSince, now),
    };
    const order = this.order();
    if (!order) {
      return {
        ...base,
        chipTone: rider.status === 'Available' ? 'available' : 'accent',
        chipLabel: rider.status === 'Available' ? 'Available' : 'Assigned',
        orderId: null,
        eta: '',
        destination: '',
        arrival: '',
        remaining: '',
        progress: 0,
        steps: [],
      };
    }
    const details = this.details()?.code === order.code ? this.details() : null;
    const chip = chipOf(order);
    const delivered = order.status === 'Delivered';
    return {
      ...base,
      chipTone: chip.tone,
      chipLabel: chip.label,
      orderId: `#${order.code}`,
      eta: delivered ? 'Delivered' : `${etaMinutes(order.estimatedDeliveryAt, now)} min`,
      destination: order.dropArea,
      arrival: clockTime(order.estimatedDeliveryAt),
      remaining: delivered ? '' : `${km(this.remainingMeters(rider.id, order))} left`,
      progress: progress(order, details, now),
      steps: details ? steps(order, details) : placeholderSteps,
    };
  });

  constructor() {
    // The details behind the timeline: fetched for each selected order and again when it changes.
    effect(() => {
      const order = this.order();
      if (!order) return;
      untracked(() => void this.fetch(order.code));
    });
    // A new selection starts with the confirmation closed.
    effect(() => {
      this.store.selection()?.riderId;
      untracked(() => this.reassigning.set(false));
    });
  }

  protected call(): void {
    const phone = this.rider()?.phone;
    if (phone) window.location.href = `tel:${phone.replace(/\s+/g, '')}`;
  }

  protected closeReassign(): void {
    this.reassigning.set(false);
  }

  private async fetch(code: string): Promise<void> {
    try {
      const details = await firstValueFrom(
        this.api.get('/api/v1/orders/{code}', { path: { code } }),
      );
      // Only if it's still the order on screen.
      if (this.order()?.code === code) this.details.set(details);
    } catch {
      // The card keeps what it has; the next change of the order fetches again.
    }
  }

  /** Metres still to ride from where the rider is drawn: via the restaurant before pickup. */
  private remainingMeters(riderId: number, order: OrderSummary): number {
    const at = this.store.motion.sampleOne(riderId, performance.now());
    const route = order.route.map(lngLat);
    if (!at) return lineLength(route);
    const here = lngLat(at);
    if (order.status === 'Assigned') {
      return distance(here, lngLat(order.restaurantLocation)) + lineLength(route);
    }
    return lineLength(splitRoute(route, here)[1]);
  }
}

const placeholderSteps: TimelineStep[] = ['Assigned', 'Picked up', 'On the way', 'Delivered'].map(
  (title) => ({ title, detail: 'Saffron & Smoke, Khan Market', time: '0:00 PM', state: 'pending' }),
);

/** How far along the delivery is in time, from assignment to the ETA. */
function progress(order: OrderSummary, details: OrderDetails | null, now: number): number {
  if (order.status === 'Delivered') return 1;
  const start = Date.parse(details?.assignedAt ?? order.createdAt);
  const end = Date.parse(order.estimatedDeliveryAt);
  return end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;
}

/** Assigned → Picked up → On the way → Delivered, as in the design. */
function steps(order: OrderSummary, details: OrderDetails): TimelineStep[] {
  const assignment = [...details.timeline]
    .reverse()
    .find((e) => e.type === 'Assigned' || e.type === 'Reassigned');
  const free = assignment?.freeRiders ?? null;
  const away = assignment?.distanceMeters ?? null;
  const assignedDetail =
    free !== null && away !== null
      ? `Nearest of ${free} free ${free === 1 ? 'rider' : 'riders'}, ${km(away)} away`
      : '';
  const stage = { Assigned: 1, PickedUp: 2, InTransit: 2, Delivered: 4 }[
    order.status as 'Assigned' | 'PickedUp' | 'InTransit' | 'Delivered'
  ];
  const state = (index: number): TimelineStep['state'] =>
    index < stage ? 'done' : index === stage ? 'current' : 'pending';
  const at = (time: string | null | undefined) => (time ? clockTime(time) : '');
  const restaurant = `${details.restaurant.name}, ${details.restaurant.area}`;
  return [
    {
      title: 'Assigned',
      time: at(assignment?.at ?? details.assignedAt),
      detail: assignedDetail,
      state: state(0),
    },
    {
      title: 'Picked up',
      time: details.pickedUpAt ? at(details.pickedUpAt) : `~${at(details.readyAt)}`,
      detail: restaurant,
      state: state(1),
    },
    {
      title: 'On the way',
      time: state(2) === 'current' ? 'Now' : '',
      detail: `Riding to ${details.drop.area}`,
      state: state(2),
    },
    {
      title: 'Delivered',
      time: details.deliveredAt ? at(details.deliveredAt) : `~${at(order.estimatedDeliveryAt)}`,
      detail: details.drop.address,
      state: state(3),
    },
  ];
}
