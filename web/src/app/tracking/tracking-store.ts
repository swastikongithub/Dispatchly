import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../core/api/api-client';
import { RiderMotion, defaultMotion } from '../dispatch/rider-motion';
import { prefersReducedMotion } from '../ui/motion';
import type { EtaChanged, OrderDetails, RiderPosition } from './tracking-flow';

/**
 * - `loading`: until the order first loads.
 * - `ready`: the order is on screen.
 * - `not-found`: no such order, or not yours (they look alike on purpose).
 */
export type TrackingPhase = 'loading' | 'ready' | 'not-found';

/**
 * The customer's order as it happens (PLAN.md §5.3): `GET /orders/{code}`, kept current by the
 * `order:{code}` group under the rules in docs/realtime.md. Messages that arrive while the order
 * loads are held, then applied only if built after the request went out.
 *
 * - `order:changed` comes with every new step of the order, each one adding to its timeline, so
 *   a longer timeline is a later order, whatever the clocks say.
 * - `rider:position` and `eta:changed` apply when newer than the last of their kind.
 */
@Injectable()
export class TrackingStore {
  private readonly api = inject(ApiClient);

  readonly motion = new RiderMotion({ ...defaultMotion, instant: prefersReducedMotion() });

  readonly phase = signal<TrackingPhase>('loading');
  /** The last request failed: with nothing on screen yet, the page offers a retry. */
  readonly failed = signal(false);
  readonly order = signal<OrderDetails | null>(null);
  /** The distance the rider still has to cover, from their latest position (docs/realtime.md). */
  readonly remaining = signal<number | null>(null);
  /** The main road the rider is on, or null when none is near. */
  readonly street = signal<string | null>(null);
  /** Wall-clock time, once a second: for the countdown. */
  readonly now = signal(Date.now());

  private code: string | null = null;
  private positionAt = -Infinity;
  private etaAt = -Infinity;
  private buffer: (() => void)[] | null = null;

  constructor() {
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  /** From here until the order is in, hub messages wait (docs/realtime.md, "Recovery"). */
  holdMessages(): void {
    this.buffer ??= [];
  }

  /** `GET /orders/{code}`, then the messages that came in meanwhile. */
  async load(code: string): Promise<void> {
    this.holdMessages();
    this.code = code;
    // The order has no `at`, so held messages are compared with when it was asked for.
    const requestedAt = Date.now();
    // A new attempt: the page shows it loading again rather than the last failure.
    this.failed.set(false);
    try {
      const order = await firstValueFrom(this.api.get('/api/v1/orders/{code}', { path: { code } }));
      this.show(order);
      this.positionAt = requestedAt;
      this.etaAt = requestedAt;
      this.phase.set('ready');
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.order.set(null);
        this.phase.set('not-found');
      } else {
        this.failed.set(true);
      }
    } finally {
      const held = this.buffer ?? [];
      this.buffer = null;
      for (const apply of held) apply();
    }
  }

  onOrderChanged(order: OrderDetails, _at: string): void {
    if (this.buffer) {
      this.buffer.push(() => this.onOrderChanged(order, _at));
      return;
    }
    const shown = this.order();
    if (order.code !== this.code || !shown) return;
    if (order.timeline.length <= shown.timeline.length) return;
    this.show(order);
  }

  onPosition(position: RiderPosition, receivedAt = performance.now()): void {
    if (this.buffer) {
      this.buffer.push(() => this.onPosition(position, receivedAt));
      return;
    }
    const at = Date.parse(position.at);
    const rider = this.order()?.rider;
    if (position.code !== this.code || position.riderId !== rider?.id || at <= this.positionAt) {
      return;
    }
    this.positionAt = at;
    const { lat, lng } = position.location;
    this.motion.push(at, [[rider.id, lat, lng, position.bearing, rider.status]], receivedAt);
    this.remaining.set(position.remainingMeters);
    this.street.set(position.street);
  }

  onEtaChanged(eta: EtaChanged): void {
    if (this.buffer) {
      this.buffer.push(() => this.onEtaChanged(eta));
      return;
    }
    const at = Date.parse(eta.at);
    const order = this.order();
    if (eta.code !== this.code || !order || at <= this.etaAt) return;
    this.etaAt = at;
    this.order.set({
      ...order,
      estimatedDeliveryAt: eta.estimatedDeliveryAt,
      isLate: eta.isLate,
      minutesLate: eta.minutesLate,
    });
  }

  /**
   * Shows a fresh read of the order. A new rider starts with no motion: the map draws them where
   * the order says until their positions come in.
   */
  private show(order: OrderDetails): void {
    const before = this.order()?.rider?.id ?? null;
    if ((order.rider?.id ?? null) !== before) {
      this.motion.clear();
      this.positionAt = -Infinity;
    }
    this.order.set(order);
    this.remaining.set(order.remainingMeters);
    this.street.set(order.rider?.street ?? null);
  }
}
