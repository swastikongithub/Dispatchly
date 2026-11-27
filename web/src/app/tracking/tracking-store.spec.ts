import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ApiClient } from '../core/api/api-client';
import type { OrderDetails, RiderPosition } from './tracking-flow';
import { TrackingStore } from './tracking-store';

const t0 = Date.parse('2026-11-27T14:30:00Z');
const iso = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();

const event = (type: OrderDetails['timeline'][number]['type'], riderId: number | null = 17) => ({
  type,
  at: iso(-60_000),
  riderId,
  riderName: riderId ? 'Aman Verma' : null,
  freeRiders: null,
  distanceMeters: type === 'Assigned' || type === 'Reassigned' ? 600 : null,
  previousRiderId: null,
  previousRiderName: null,
});

function order(overrides: Partial<OrderDetails> = {}): OrderDetails {
  return {
    code: 'DL-4817',
    status: 'Assigned',
    isLate: false,
    minutesLate: 0,
    restaurant: {
      id: 1,
      name: 'Saffron & Smoke',
      area: 'Khan Market',
      address: 'Shop 21, Middle Lane, Khan Market',
      phone: '+91 00000 10001',
      location: { lat: 28.6003, lng: 77.2271 },
    },
    drop: {
      customerFirstName: 'Priya',
      label: 'Home',
      address: 'B-14, Lajpat Nagar II',
      area: 'Lajpat Nagar II',
      location: { lat: 28.5677, lng: 77.2433 },
    },
    rider: {
      id: 17,
      name: 'Aman Verma',
      vehicle: 'Honda Activa',
      plate: 'DL 3S CK 2041',
      phone: '+91 00000 20017',
      status: 'Assigned',
      location: { lat: 28.605, lng: 77.22 },
      bearing: 90,
      street: 'Lodhi Road',
    },
    items: [],
    totalPaise: 64000,
    payment: 'Online',
    deliveryCode: '4821',
    route: [],
    distanceMeters: 6900,
    remainingMeters: 7500,
    searchRadiusMeters: 1500,
    createdAt: iso(-120_000),
    readyAt: iso(600_000),
    promisedBy: iso(1_800_000),
    estimatedDeliveryAt: iso(1_500_000),
    assignedAt: iso(-60_000),
    pickedUpAt: null,
    deliveredAt: null,
    timeline: [event('Placed', null), event('Assigned')],
    ...overrides,
  };
}

function position(at: number, overrides: Partial<RiderPosition> = {}): RiderPosition {
  return {
    at: iso(at),
    code: 'DL-4817',
    riderId: 17,
    location: { lat: 28.604, lng: 77.221 },
    bearing: 120,
    remainingMeters: 7400,
    street: 'Mathura Road',
    ...overrides,
  };
}

describe('TrackingStore', () => {
  let response: Subject<OrderDetails>;

  function setup() {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval'] });
    vi.setSystemTime(t0);
    TestBed.configureTestingModule({
      // A fresh response for each request, completed by the test.
      providers: [
        TrackingStore,
        { provide: ApiClient, useValue: { get: () => (response = new Subject<OrderDetails>()) } },
      ],
    });
    return TestBed.inject(TrackingStore);
  }

  async function loaded(store: TrackingStore, data = order()) {
    const loading = store.load('DL-4817');
    response.next(data);
    response.complete();
    await loading;
  }

  afterEach(() => vi.useRealTimers());

  it('starts from the order, with its rider’s distance and street', async () => {
    const store = setup();
    expect(store.phase()).toBe('loading');
    await loaded(store);

    expect(store.phase()).toBe('ready');
    expect(store.order()?.code).toBe('DL-4817');
    expect(store.remaining()).toBe(7500);
    expect(store.street()).toBe('Lodhi Road');
  });

  it('says an order that isn’t yours or doesn’t exist is not found', async () => {
    const store = setup();
    const loading = store.load('DL-9999');
    response.error(
      new HttpErrorResponse({ status: 404, error: { code: 'not_found', title: 'Not found' } }),
    );
    await loading;

    expect(store.phase()).toBe('not-found');
    expect(store.failed()).toBe(false);
  });

  it('keeps what it shows when a reload fails, and says it failed', async () => {
    const store = setup();
    let loading = store.load('DL-4817');
    response.error(new HttpErrorResponse({ status: 0 }));
    await loading;
    expect(store.phase()).toBe('loading');
    expect(store.failed()).toBe(true);

    await loaded(store);
    expect(store.failed()).toBe(false);
    loading = store.load('DL-4817');
    response.error(new HttpErrorResponse({ status: 503 }));
    await loading;
    expect(store.phase()).toBe('ready');
    expect(store.order()?.code).toBe('DL-4817');
    expect(store.failed()).toBe(true);
  });

  it('applies the messages that came in while the order loaded only if they are newer', async () => {
    const store = setup();
    store.holdMessages();
    const loading = store.load('DL-4817');
    // Built before the request went out, then after it.
    store.onPosition(position(-500, { remainingMeters: 7450, street: 'Lodhi Road' }));
    store.onEtaChanged({
      at: iso(-400),
      code: 'DL-4817',
      estimatedDeliveryAt: iso(1_620_000),
      isLate: true,
      minutesLate: 1,
    });
    store.onPosition(position(800));
    response.next(order());
    response.complete();
    await loading;

    expect(store.remaining()).toBe(7400);
    expect(store.street()).toBe('Mathura Road');
    expect(store.order()?.isLate).toBe(false);
    expect(store.motion.has(17)).toBe(true);

    // Out of order: an older position is dropped.
    store.onPosition(position(2800, { remainingMeters: 7300 }));
    store.onPosition(position(1800, { remainingMeters: 7350 }));
    expect(store.remaining()).toBe(7300);
  });

  it('moves the ETA as the server does, never back to an older one', async () => {
    const store = setup();
    await loaded(store);

    const eta = (at: number, minutes: number) => ({
      at: iso(at),
      code: 'DL-4817',
      estimatedDeliveryAt: iso(minutes * 60_000),
      isLate: minutes > 25,
      minutesLate: Math.max(0, minutes - 25),
    });
    store.onEtaChanged(eta(4000, 27));
    store.onEtaChanged(eta(2000, 24));
    expect(store.order()?.estimatedDeliveryAt).toBe(iso(27 * 60_000));
    expect(store.order()?.isLate).toBe(true);
    expect(store.order()?.minutesLate).toBe(2);
  });

  it('takes the order as it moves on, and never back to an earlier step', async () => {
    const store = setup();
    await loaded(store);

    const pickedUp = order({
      status: 'PickedUp',
      rider: { ...order().rider!, status: 'Delivering', street: null },
      pickedUpAt: iso(1000),
      remainingMeters: 6900,
      timeline: [...order().timeline, event('ArrivedAtRestaurant'), event('PickedUp')],
    });
    store.onOrderChanged(pickedUp, iso(1000));
    // An arrival sent before the pickup, delivered late.
    store.onOrderChanged(
      order({ timeline: [...order().timeline, event('ArrivedAtRestaurant')] }),
      iso(900),
    );

    expect(store.order()?.status).toBe('PickedUp');
    expect(store.remaining()).toBe(6900);
    expect(store.street()).toBeNull();
  });

  it('follows a new rider after a reassignment and ignores the old one', async () => {
    const store = setup();
    await loaded(store);
    store.onPosition(position(1000));
    expect(store.motion.has(17)).toBe(true);

    const neha = { ...order().rider!, id: 18, name: 'Neha Gupta', street: null };
    store.onOrderChanged(
      order({ rider: neha, timeline: [...order().timeline, event('Reassigned', 18)] }),
      iso(1500),
    );
    expect(store.order()?.rider?.name).toBe('Neha Gupta');
    expect(store.motion.has(17)).toBe(false);

    // Aman's last position, sent before the change, arrives after it.
    store.onPosition(position(1400, { remainingMeters: 100 }));
    store.onPosition(position(3000, { riderId: 17, remainingMeters: 90 }));
    expect(store.remaining()).toBe(7500);
    store.onPosition(position(3000, { riderId: 18, remainingMeters: 7200 }));
    expect(store.remaining()).toBe(7200);
    expect(store.motion.has(18)).toBe(true);
  });

  it('ignores messages for other orders', async () => {
    const store = setup();
    await loaded(store);
    store.onPosition(position(1000, { code: 'DL-4810', remainingMeters: 10 }));
    store.onOrderChanged(
      order({
        code: 'DL-4810',
        status: 'Delivered',
        timeline: [...order().timeline, event('PickedUp'), event('Delivered')],
      }),
      iso(1000),
    );
    expect(store.remaining()).toBe(7500);
    expect(store.order()?.status).toBe('Assigned');
  });

  it('ticks the clock every second for the countdown', async () => {
    const store = setup();
    await loaded(store);
    const before = store.now();
    vi.advanceTimersByTime(1000);
    expect(store.now()).toBe(before + 1000);
  });
});
