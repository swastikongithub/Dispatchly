import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, type Api } from '../core/api/api-client';
import { tokens } from '../tokens';
import { prefersReducedMotion } from '../ui/motion';
import { compareOrders, inTab, type OrderSummary, type QueueTab } from './queue';
import { RiderMotion, defaultMotion, type RiderPoint } from './rider-motion';

export type LiveRider = Api['LiveRider'];
export type LiveStats = Api['LiveStats'];
export type LiveSnapshot = Api['LiveSnapshot'];
export type RestaurantPin = Api['RestaurantPin'];
export type RidersBatch = Api['RidersBatch'];

/**
 * - `active`: in the queue.
 * - `done`: just delivered; shows "Delivered" for 3 s where it was.
 * - `leaving`: fading out (220 ms), then removed.
 */
export type EntryState = 'active' | 'done' | 'leaving';

export interface QueueEntry {
  /** As the server last sent it. */
  order: OrderSummary;
  /** What it sorts by: its last active state, so a delivered row stays put while it fades. */
  sortAs: OrderSummary;
  state: EntryState;
  /** Just placed: the row highlights once (PLAN.md §6.3). */
  fresh: boolean;
}

export interface Selection {
  code: string | null;
  riderId: number | null;
}

const ms = (duration: string) => parseFloat(duration);
const DELIVERED_FADE_DELAY = ms(tokens.motion.duration.deliveredFadeDelay);
const LEAVE = ms(tokens.motion.duration.base);
const HIGHLIGHT = ms(tokens.motion.duration.rowHighlight);
/** Riders who came on shift since the snapshot have no name; fetch it again at most this often. */
const REFRESH_FOR_NEW_RIDERS_MS = 30_000;

/**
 * The dispatcher dashboard's live state (PLAN.md §5.2): a snapshot, kept current by hub messages
 * under the rules in docs/realtime.md. Messages that arrive while a snapshot loads are buffered
 * and then applied only if newer than it, per order, once for the batch and once for the stats.
 */
@Injectable()
export class DispatchStore {
  private readonly api = inject(ApiClient);

  readonly motion = new RiderMotion({ ...defaultMotion, instant: prefersReducedMotion() });

  /** `loading` until the first snapshot is in. */
  readonly phase = signal<'loading' | 'ready'>('loading');
  /** The last snapshot request failed: the panel offers a retry; everything else keeps its data. */
  readonly failed = signal(false);
  readonly entries = signal<ReadonlyMap<string, QueueEntry>>(new Map());
  readonly riders = signal<ReadonlyMap<number, LiveRider>>(new Map());
  readonly restaurants = signal<readonly RestaurantPin[]>([]);
  readonly stats = signal<LiveStats | null>(null);
  /** `performance.now()` when the last `riders:batch` arrived. */
  readonly lastBatch = signal<number | null>(null);
  /** Wall-clock time, once a second: for "waiting 0:12", "8 min", "updated 2s ago". */
  readonly now = signal(Date.now());

  private readonly selectedCode = signal<string | null>(null);
  private readonly selectedRider = signal<number | null>(null);

  readonly queue = computed(() =>
    [...this.entries().values()].sort((a, b) => compareOrders(a.sortAs, b.sortAs)),
  );

  readonly counts = computed(() => {
    const active = this.queue()
      .filter((e) => e.state === 'active')
      .map((e) => e.order);
    const count = (tab: QueueTab) => active.filter((o) => inTab(o, tab)).length;
    return { all: active.length, 'needs-rider': count('needs-rider'), late: count('late') };
  });

  /** Each rider's active order. */
  readonly orderOfRider = computed(() => {
    const byRider = new Map<number, OrderSummary>();
    for (const { order, state } of this.entries().values()) {
      if (state === 'active' && order.riderId !== null) byRider.set(order.riderId, order);
    }
    return byRider;
  });

  /**
   * The selected order and its rider. Picking either selects both; it follows live changes
   * (a reassigned order brings its new rider) and falls back to the rider once the order leaves.
   */
  readonly selection = computed<Selection | null>(() => {
    const code = this.selectedCode();
    const entry = code ? this.entries().get(code) : undefined;
    if (entry && entry.state !== 'leaving') return { code, riderId: entry.order.riderId };
    const riderId = this.selectedRider();
    if (riderId !== null && this.riders().has(riderId)) {
      return { code: this.orderOfRider().get(riderId)?.code ?? null, riderId };
    }
    return null;
  });

  private snapshotAt = -Infinity;
  private statsAt = -Infinity;
  private readonly orderAt = new Map<string, number>();
  private buffer: (() => void)[] | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private lastRefresh = 0;

  constructor() {
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      for (const timer of this.timers) clearTimeout(timer);
    });
  }

  selectOrder(code: string): void {
    this.selectedCode.set(code);
    this.selectedRider.set(this.entries().get(code)?.order.riderId ?? null);
  }

  selectRider(id: number): void {
    this.selectedRider.set(id);
    this.selectedCode.set(this.orderOfRider().get(id)?.code ?? null);
  }

  clearSelection(): void {
    this.selectedCode.set(null);
    this.selectedRider.set(null);
  }

  /** From here until the snapshot is in, hub messages wait (docs/realtime.md, "Recovery"). */
  holdMessages(): void {
    this.buffer ??= [];
  }

  /** GET /live/snapshot, then the messages that came in meanwhile. Rejects if the request fails. */
  async loadSnapshot(): Promise<void> {
    this.holdMessages();
    this.lastRefresh = performance.now();
    // A new attempt: the panel shows it loading again rather than the last failure.
    this.failed.set(false);
    try {
      this.applySnapshot(await firstValueFrom(this.api.get('/api/v1/live/snapshot')));
      this.failed.set(false);
      this.phase.set('ready');
    } catch (error) {
      this.failed.set(true);
      throw error;
    } finally {
      const buffered = this.buffer ?? [];
      this.buffer = null;
      for (const apply of buffered) apply();
    }
  }

  onBatch(batch: RidersBatch, receivedAt = performance.now()): void {
    if (this.buffer) {
      this.buffer.push(() => this.onBatch(batch, receivedAt));
      return;
    }
    const at = Date.parse(batch.at);
    if (at <= this.snapshotAt) return;
    const points = batch.riders as RiderPoint[];
    this.motion.push(at, points, receivedAt);
    this.lastBatch.set(receivedAt);

    // Keep each rider's status current, and drop riders who went off shift.
    const riders = this.riders();
    const onShift = new Set<number>();
    let next: Map<number, LiveRider> | null = null;
    let unknown = false;
    for (const [id, , , , status] of points) {
      onShift.add(id);
      const rider = riders.get(id);
      if (!rider) unknown = true;
      else if (rider.status !== status) (next ??= new Map(riders)).set(id, { ...rider, status });
    }
    for (const id of riders.keys()) if (!onShift.has(id)) (next ??= new Map(riders)).delete(id);
    if (next) this.riders.set(next);
    if (unknown && performance.now() - this.lastRefresh > REFRESH_FOR_NEW_RIDERS_MS) {
      this.loadSnapshot().catch(() => {});
    }
  }

  onOrderChanged(order: OrderSummary, atText: string): void {
    if (this.buffer) {
      this.buffer.push(() => this.onOrderChanged(order, atText));
      return;
    }
    const at = Date.parse(atText);
    if (at <= Math.max(this.snapshotAt, this.orderAt.get(order.code) ?? -Infinity)) return;
    this.orderAt.set(order.code, at);

    const entries = new Map(this.entries());
    const existing = entries.get(order.code);
    const active = order.status !== 'Delivered' && order.status !== 'Cancelled';
    if (active) {
      entries.set(order.code, {
        order,
        sortAs: order,
        state: 'active',
        fresh: existing?.fresh ?? true,
      });
      if (!existing) this.later(HIGHLIGHT, () => this.update(order.code, { fresh: false }));
    } else if (existing?.state === 'active') {
      entries.set(order.code, { ...existing, order, state: 'done' });
      this.later(DELIVERED_FADE_DELAY, () => {
        this.update(order.code, { state: 'leaving' });
        this.later(LEAVE, () => this.remove(order.code));
      });
    } else {
      return;
    }
    this.entries.set(entries);
    this.trackRider(order, existing?.order);
  }

  onStatsChanged(stats: LiveStats, atText: string): void {
    if (this.buffer) {
      this.buffer.push(() => this.onStatsChanged(stats, atText));
      return;
    }
    const at = Date.parse(atText);
    if (at <= this.statsAt) return;
    this.statsAt = at;
    this.stats.set(stats);
  }

  private applySnapshot(snapshot: LiveSnapshot): void {
    const at = Date.parse(snapshot.at);
    this.snapshotAt = at;
    this.statsAt = at;
    this.orderAt.clear();
    this.riders.set(new Map(snapshot.riders.map((r) => [r.id, r])));
    this.motion.push(
      at,
      snapshot.riders.map((r) => [r.id, r.location.lat, r.location.lng, r.bearing, r.status]),
      performance.now(),
    );
    const previous = this.entries();
    this.entries.set(
      new Map(
        snapshot.orders.map((order): [string, QueueEntry] => [
          order.code,
          {
            order,
            sortAs: order,
            state: 'active',
            fresh: previous.get(order.code)?.fresh ?? false,
          },
        ]),
      ),
    );
    this.restaurants.set(snapshot.restaurants);
    this.stats.set(snapshot.stats);
  }

  /** Keeps riders' order codes and delivery counts in step with the order. */
  private trackRider(order: OrderSummary, before: OrderSummary | undefined): void {
    const riders = this.riders();
    const next = new Map(riders);
    let changed = false;
    const set = (id: number, patch: Partial<LiveRider>) => {
      const rider = next.get(id);
      if (!rider) return;
      next.set(id, { ...rider, ...patch });
      changed = true;
    };
    const active = order.status !== 'Delivered' && order.status !== 'Cancelled';
    if (before?.riderId != null && (before.riderId !== order.riderId || !active)) {
      set(before.riderId, { orderCode: null });
    }
    if (order.riderId !== null) {
      if (active) set(order.riderId, { orderCode: order.code });
      else if (order.status === 'Delivered' && before) {
        const rider = next.get(order.riderId);
        if (rider)
          set(order.riderId, { orderCode: null, deliveriesToday: rider.deliveriesToday + 1 });
      }
    }
    if (changed) this.riders.set(next);
  }

  private update(code: string, patch: Partial<QueueEntry>): void {
    const entry = this.entries().get(code);
    if (!entry) return;
    this.entries.set(new Map(this.entries()).set(code, { ...entry, ...patch }));
  }

  private remove(code: string): void {
    if (this.entries().get(code)?.state !== 'leaving') return;
    const entries = new Map(this.entries());
    entries.delete(code);
    this.entries.set(entries);
  }

  private later(delay: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, delay);
    this.timers.add(timer);
  }
}
