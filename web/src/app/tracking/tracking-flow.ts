import type { Api } from '../core/api/api-client';
import { clockTime, km } from '../dispatch/queue';
import { itemsLabel, rupees } from '../order/order-flow';

/**
 * The tracking page's wording and progress (PLAN.md §5.3). The server decides the status, ETA,
 * lateness and the rider's street; these only say it for a person reading the sheet.
 */

export type OrderDetails = Api['OrderDetails'];
export type OrderLine = Api['OrderLine'];
export type OrderStatus = Api['OrderStatus'];
export type RiderPosition = Api['RiderPosition'];
export type EtaChanged = Api['EtaChanged'];

export type Stage =
  | 'searching'
  | 'heading'
  | 'at-restaurant'
  | 'picked-up'
  | 'on-the-way'
  | 'around-the-corner'
  | 'delivered'
  | 'cancelled';

/** The four steps of the progress bar, as in the design. */
export const STEPS = ['Placed', 'Picked up', 'On the way', 'Delivered'] as const;

/**
 * Within this many metres of the door the rider is "around the corner": a minute or two away on
 * a scooter in city traffic.
 */
export const AROUND_THE_CORNER_METERS = 500;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** "Aman" from "Aman Verma". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Where the order is, for the sentence and the sheet; `remaining` is the rider's latest distance. */
export function stageOf(order: OrderDetails, remaining: number | null): Stage {
  switch (order.status) {
    case 'Searching':
      return 'searching';
    case 'Assigned':
      return order.rider?.status === 'AtRestaurant' ? 'at-restaurant' : 'heading';
    case 'PickedUp':
      return 'picked-up';
    case 'InTransit':
      return remaining !== null && remaining <= AROUND_THE_CORNER_METERS
        ? 'around-the-corner'
        : 'on-the-way';
    case 'Delivered':
      return 'delivered';
    case 'Cancelled':
      return 'cancelled';
  }
}

/** The status sentence (PLAN.md §5.3), written for a person. */
export function sentenceOf(
  order: OrderDetails,
  remaining: number | null,
  street: string | null,
): string {
  const rider = firstName(order.rider?.name ?? 'Your rider');
  switch (stageOf(order, remaining)) {
    case 'searching':
      return 'Finding the nearest rider…';
    case 'heading':
      return `${rider} is heading to ${order.restaurant.name}`;
    case 'at-restaurant':
      return `${rider} is at ${order.restaurant.name}`;
    case 'picked-up':
    case 'on-the-way': {
      const at = order.pickedUpAt ? ` at ${clockTime(order.pickedUpAt)}` : '';
      const where = street ? `is riding down ${street}` : 'is on the way';
      return `${rider} picked up your order${at} and ${where}.`;
    }
    case 'around-the-corner':
      return `${rider} is around the corner`;
    case 'delivered':
      return order.deliveredAt ? `Delivered at ${clockTime(order.deliveredAt)}` : 'Delivered';
    case 'cancelled':
      return 'Your order was cancelled.';
  }
}

export interface ProgressState {
  /** Index into `STEPS`. */
  current: number;
  /** How far through the current step, 0 to 1. */
  partial: number;
}

/**
 * The segment of the current step fills with distance (PLAN.md §5.3): Placed as the rider closes
 * in on the restaurant, On the way as they close in on the door.
 */
export function progressOf(order: OrderDetails, remaining: number | null): ProgressState {
  switch (order.status) {
    case 'Searching':
    case 'Cancelled':
      return { current: 0, partial: 0 };
    case 'Assigned': {
      if (order.rider?.status === 'AtRestaurant') return { current: 0, partial: 1 };
      // Before pickup the remaining distance runs via the restaurant (docs/realtime.md).
      const from = assignedDistance(order);
      if (!from || remaining === null) return { current: 0, partial: 0 };
      const toRestaurant = Math.max(0, remaining - order.distanceMeters);
      return { current: 0, partial: clamp(1 - toRestaurant / from) };
    }
    case 'PickedUp':
      return { current: 1, partial: 1 };
    case 'InTransit': {
      if (remaining === null || order.distanceMeters <= 0) return { current: 2, partial: 0 };
      return { current: 2, partial: clamp(1 - remaining / order.distanceMeters) };
    }
    case 'Delivered':
      return { current: 3, partial: 1 };
  }
}

/** How far the current rider was from the restaurant when the order went to them. */
function assignedDistance(order: OrderDetails): number | null {
  for (let i = order.timeline.length - 1; i >= 0; i--) {
    const entry = order.timeline[i]!;
    if (entry.type === 'Assigned' || entry.type === 'Reassigned') return entry.distanceMeters;
  }
  return null;
}

/** "Saffron & Smoke, Khan Market". */
export function restaurantLine(order: OrderDetails): string {
  return `${order.restaurant.name}, ${order.restaurant.area}`;
}

/** "2 items · ₹640 · Paid online". */
export function summaryLine(order: OrderDetails): string {
  const count = order.items.reduce((sum, line) => sum + line.quantity, 0);
  const paid = order.payment === 'Online' ? 'Paid online' : 'Cash on delivery';
  return `${itemsLabel(count)} · ${rupees(order.totalPaise)} · ${paid}`;
}

/** One line of the order's details: "2 × Dal makhani", "₹360". */
export function lineLabel(line: OrderLine): { name: string; price: string } {
  return {
    name: `${line.quantity} × ${line.name}`,
    price: rupees(line.quantity * line.unitPricePaise),
  };
}

/** "3.1 km away", or nothing while no rider is on the way. */
export function distanceAway(meters: number | null): string {
  return meters === null ? '' : `${km(meters)} away`;
}

/** What the page last told a screen reader about, to say only what changed. */
export interface Heard {
  status: OrderStatus;
  /** Minutes to the ETA, while the order is on its way. */
  minutes: number | null;
}

const afterPickup = (status: OrderStatus) => status === 'PickedUp' || status === 'InTransit';

/**
 * The key changes, announced politely (PLAN.md §5.3): "Picked up", "Arriving in 2 minutes",
 * "Delivered". The page reads as it is on first load, so nothing is announced then.
 */
export function announcement(before: Heard | null, now: Heard): string | null {
  if (!before) return null;
  if (now.status !== before.status) {
    if (now.status === 'Delivered') return 'Delivered';
    if (now.status === 'Cancelled') return 'Order cancelled';
    if (afterPickup(now.status) && !afterPickup(before.status)) return 'Picked up';
  }
  if (
    afterPickup(now.status) &&
    now.minutes !== null &&
    now.minutes <= 2 &&
    (before.minutes === null || before.minutes > 2)
  ) {
    return `Arriving in ${now.minutes} ${now.minutes === 1 ? 'minute' : 'minutes'}`;
  }
  return null;
}
