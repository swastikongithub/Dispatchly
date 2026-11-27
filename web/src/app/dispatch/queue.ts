import type { Api } from '../core/api/api-client';
import type { ChipTone } from '../ui';

/**
 * The order queue's display rules (PLAN.md §5.2, §3.3). The server decides status, ETA and
 * lateness; these only sort, filter and word what it sent.
 */

export type OrderSummary = Api['OrderSummary'];
export type QueueTab = 'all' | 'needs-rider' | 'late';

/** Delhi time for "8:05 PM": the city the dashboard runs, whatever the browser's zone. */
const clock = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

const MINUTE = 60_000;

/** Needs rider first, then Running late, then everything else (the server's OrderQueue.Sort). */
function rank(order: OrderSummary): number {
  if (order.status === 'Searching') return 0;
  return order.isLate ? 1 : 2;
}

/** Queue order: Needs rider (oldest first), then Running late, then by ETA. */
export function compareOrders(a: OrderSummary, b: OrderSummary): number {
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  const key = (o: OrderSummary) =>
    Date.parse(o.status === 'Searching' ? o.createdAt : o.estimatedDeliveryAt);
  return key(a) - key(b) || a.code.localeCompare(b.code);
}

export function inTab(order: OrderSummary, tab: QueueTab): boolean {
  switch (tab) {
    case 'needs-rider':
      return order.status === 'Searching';
    case 'late':
      return order.isLate;
    default:
      return true;
  }
}

export interface Chip {
  tone: ChipTone;
  label: string;
}

/** Status → chip, with the labels from the designs (PLAN.md §3.3). */
export function chipOf(order: Pick<OrderSummary, 'status' | 'isLate'>): Chip {
  switch (order.status) {
    case 'Searching':
      return { tone: 'needs-rider', label: 'Needs rider' };
    case 'Delivered':
      return { tone: 'neutral', label: 'Delivered' };
    case 'Cancelled':
      return { tone: 'neutral', label: 'Cancelled' };
  }
  if (order.isLate) return { tone: 'late', label: 'Running late' };
  switch (order.status) {
    case 'Assigned':
      return { tone: 'available', label: 'Assigned' };
    case 'PickedUp':
      return { tone: 'accent', label: 'Picked up' };
    default:
      return { tone: 'accent', label: 'On the way' };
  }
}

export interface RowMeta {
  start: string;
  end: string;
  tone: 'muted' | 'eta' | 'late';
}

/** The row's third line: "Searching within 1.5 km · waiting 0:12", "Aman Verma · 8 min", "Imran Ali · 12 min · +5". */
export function metaOf(order: OrderSummary, now: number): RowMeta {
  if (order.status === 'Searching') {
    return {
      start: `Searching within ${km(order.searchRadiusMeters)}`,
      end: `waiting ${minutesSeconds(now - Date.parse(order.createdAt))}`,
      tone: 'muted',
    };
  }
  const rider = order.riderName ?? '';
  if (order.status === 'Delivered' || order.status === 'Cancelled') {
    return { start: rider, end: '', tone: 'muted' };
  }
  const eta = `${etaMinutes(order.estimatedDeliveryAt, now)} min`;
  return order.isLate
    ? { start: rider, end: `${eta} · +${order.minutesLate}`, tone: 'late' }
    : { start: rider, end: eta, tone: 'eta' };
}

/** Whole minutes until the ETA, at least 1 while the order is on its way. */
export function etaMinutes(estimatedDeliveryAt: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(estimatedDeliveryAt) - now) / MINUTE));
}

/** "8:05 PM", in Delhi. */
export function clockTime(at: string | number): string {
  return clock.format(typeof at === 'number' ? at : Date.parse(at));
}

/** "0.6 km", "3.1 km", "5 km". */
export function km(meters: number): string {
  const value = Math.round(meters / 100) / 10;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} km`;
}

/** "0:12", "12:04". */
export function minutesSeconds(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "Online 5h 12m", "Online 12m". */
export function onlineFor(since: string | null, now: number): string {
  if (!since) return '';
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / MINUTE));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `Online ${hours}h ${minutes % 60}m` : `Online ${minutes}m`;
}

/** "9 deliveries today", "1 delivery today". */
export function deliveriesToday(count: number): string {
  return `${count} ${count === 1 ? 'delivery' : 'deliveries'} today`;
}
