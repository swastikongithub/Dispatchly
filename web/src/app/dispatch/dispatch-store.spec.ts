import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ApiClient } from '../core/api/api-client';
import { DispatchStore, type LiveRider, type LiveSnapshot, type LiveStats } from './dispatch-store';
import type { OrderSummary } from './queue';

const t0 = Date.parse('2026-11-27T14:30:00Z');
const iso = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();

function order(code: string, overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    code,
    status: 'InTransit',
    isLate: false,
    minutesLate: 0,
    restaurantName: 'Saffron & Smoke',
    restaurantArea: 'Khan Market',
    dropArea: 'Lajpat Nagar II',
    riderId: 17,
    riderName: 'Aman Verma',
    searchRadiusMeters: 1500,
    createdAt: iso(-20 * 60_000),
    promisedBy: iso(15 * 60_000),
    estimatedDeliveryAt: iso(8 * 60_000),
    restaurantId: 1,
    restaurantLocation: { lat: 28.6, lng: 77.227 },
    dropLocation: { lat: 28.57, lng: 77.24 },
    route: [],
    ...overrides,
  };
}

function rider(id: number, overrides: Partial<LiveRider> = {}): LiveRider {
  return {
    id,
    name: `Rider ${id}`,
    vehicle: 'Honda Activa',
    plate: `DL 3S CK ${id}`,
    phone: '+91 00000 00000',
    status: 'Delivering',
    location: { lat: 28.6, lng: 77.2 },
    bearing: 0,
    orderCode: null,
    onlineSince: iso(-3_600_000),
    deliveriesToday: 3,
    ...overrides,
  };
}

const stats: LiveStats = {
  ridersOnline: 2,
  ridersFree: 1,
  ridersOnDelivery: 1,
  activeOrders: 2,
  needsRider: 1,
  runningLate: 0,
  averageDeliveryMinutes: 24,
  deliveredToday: 10,
};

function snapshot(overrides: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    at: iso(0),
    riders: [rider(17, { orderCode: 'DL-4817' }), rider(18, { status: 'Available' })],
    orders: [
      order('DL-4817'),
      order('DL-4823', { status: 'Searching', riderId: null, riderName: null }),
    ],
    stats,
    restaurants: [
      { id: 1, name: 'Saffron & Smoke', area: 'Khan Market', location: { lat: 28.6, lng: 77.227 } },
    ],
    ...overrides,
  };
}

describe('DispatchStore', () => {
  let response: Subject<LiveSnapshot>;

  function setup() {
    response = new Subject<LiveSnapshot>();
    TestBed.configureTestingModule({
      // A fresh response for each request, completed by the test.
      providers: [
        DispatchStore,
        { provide: ApiClient, useValue: { get: () => (response = new Subject<LiveSnapshot>()) } },
      ],
    });
    return TestBed.inject(DispatchStore);
  }

  async function loaded(store: DispatchStore, data = snapshot()) {
    const loading = store.loadSnapshot();
    response.next(data);
    response.complete();
    await loading;
  }

  afterEach(() => vi.useRealTimers());

  it('starts from the snapshot, in queue order, with live counts', async () => {
    const store = setup();
    expect(store.phase()).toBe('loading');
    await loaded(store);

    expect(store.phase()).toBe('ready');
    expect(store.queue().map((e) => e.order.code)).toEqual(['DL-4823', 'DL-4817']);
    expect(store.counts()).toEqual({ all: 2, 'needs-rider': 1, late: 0 });
    expect(store.restaurants()).toHaveLength(1);
    expect(store.motion.size).toBe(2);
  });

  it('applies only messages newer than the snapshot, buffering those that arrive while it loads', async () => {
    const store = setup();
    const loading = store.loadSnapshot();
    // Sent while the snapshot was being read: one older than it, one newer.
    store.onOrderChanged(order('DL-4817', { isLate: true, minutesLate: 2 }), iso(-500));
    store.onOrderChanged(
      order('DL-4823', { status: 'Assigned', riderId: 18, riderName: 'Rider 18' }),
      iso(500),
    );
    store.onStatsChanged({ ...stats, runningLate: 9 }, iso(-100));
    response.next(snapshot());
    response.complete();
    await loading;

    const entries = store.entries();
    expect(entries.get('DL-4817')!.order.isLate).toBe(false);
    expect(entries.get('DL-4823')!.order.status).toBe('Assigned');
    expect(store.riders().get(18)!.orderCode).toBe('DL-4823');
    expect(store.stats()!.runningLate).toBe(0);

    // Out of order for one order: the older message is dropped.
    store.onOrderChanged(order('DL-4823', { status: 'PickedUp', riderId: 18 }), iso(2000));
    store.onOrderChanged(order('DL-4823', { status: 'Assigned', riderId: 18 }), iso(1000));
    expect(store.entries().get('DL-4823')!.order.status).toBe('PickedUp');
  });

  it('highlights a new order once and keeps a delivered one for 3 s before it fades out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const store = setup();
    await loaded(store);

    store.onOrderChanged(order('DL-4830', { status: 'Searching', riderId: null }), iso(1000));
    expect(store.entries().get('DL-4830')!.fresh).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(store.entries().get('DL-4830')!.fresh).toBe(false);

    store.onOrderChanged(order('DL-4817', { status: 'Delivered' }), iso(2000));
    expect(store.entries().get('DL-4817')!.state).toBe('done');
    expect(store.queue().map((e) => e.order.code)).toEqual(['DL-4823', 'DL-4830', 'DL-4817']);
    expect(store.counts().all).toBe(2);
    expect(store.riders().get(17)).toMatchObject({ orderCode: null, deliveriesToday: 4 });
    vi.advanceTimersByTime(3000);
    expect(store.entries().get('DL-4817')!.state).toBe('leaving');
    vi.advanceTimersByTime(220);
    expect(store.entries().has('DL-4817')).toBe(false);
  });

  it('keeps the selection through a reassignment and falls back to the rider when the order leaves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const store = setup();
    await loaded(store);

    store.selectOrder('DL-4817');
    expect(store.selection()).toEqual({ code: 'DL-4817', riderId: 17 });
    store.onOrderChanged(order('DL-4817', { status: 'Assigned', riderId: 18 }), iso(1000));
    expect(store.selection()).toEqual({ code: 'DL-4817', riderId: 18 });
    expect(store.riders().get(17)!.orderCode).toBeNull();

    store.onOrderChanged(order('DL-4817', { status: 'Delivered', riderId: 18 }), iso(2000));
    vi.advanceTimersByTime(3220);
    expect(store.selection()).toEqual({ code: null, riderId: 17 });

    store.selectRider(18);
    expect(store.selection()).toEqual({ code: null, riderId: 18 });
    store.clearSelection();
    expect(store.selection()).toBeNull();
  });

  it('drops riders who went off shift, and their selection', async () => {
    const store = setup();
    await loaded(store);
    store.selectRider(18);

    store.onBatch({ at: iso(2000), riders: [[17, 28.6, 77.21, 90, 'Delivering']] }, 100);
    expect(store.riders().has(18)).toBe(false);
    expect(store.selection()).toBeNull();
    expect(store.lastBatch()).toBe(100);
  });

  it('keeps its data and reports the failure when the snapshot request fails', async () => {
    const store = setup();
    await loaded(store);
    const loading = store.loadSnapshot();
    response.error(new Error('offline'));
    await expect(loading).rejects.toThrow('offline');
    expect(store.failed()).toBe(true);
    expect(store.phase()).toBe('ready');
    expect(store.queue()).toHaveLength(2);
  });
});
