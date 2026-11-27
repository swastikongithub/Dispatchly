import {
  chipOf,
  clockTime,
  compareOrders,
  deliveriesToday,
  etaMinutes,
  inTab,
  km,
  metaOf,
  minutesSeconds,
  onlineFor,
  type OrderSummary,
} from './queue';

const now = Date.parse('2026-11-27T14:27:00Z'); // 7:57 PM in Delhi

function order(overrides: Partial<OrderSummary>): OrderSummary {
  return {
    code: 'DL-4817',
    status: 'InTransit',
    isLate: false,
    minutesLate: 0,
    restaurantName: 'Saffron & Smoke',
    restaurantArea: 'Khan Market',
    dropArea: 'Lajpat Nagar II',
    riderId: 17,
    riderName: 'Aman Verma',
    searchRadiusMeters: 1500,
    createdAt: '2026-11-27T14:10:00Z',
    promisedBy: '2026-11-27T14:40:00Z',
    estimatedDeliveryAt: '2026-11-27T14:35:00Z',
    restaurantId: 1,
    restaurantLocation: { lat: 28.6, lng: 77.227 },
    dropLocation: { lat: 28.57, lng: 77.24 },
    route: [],
    ...overrides,
  };
}

describe('queue', () => {
  it('puts Needs rider first, then Running late, then the rest by ETA', () => {
    const queue = [
      order({ code: 'DL-1', estimatedDeliveryAt: '2026-11-27T14:50:00Z' }),
      order({ code: 'DL-2', isLate: true, estimatedDeliveryAt: '2026-11-27T14:55:00Z' }),
      order({ code: 'DL-3', status: 'Searching', createdAt: '2026-11-27T14:26:00Z' }),
      order({ code: 'DL-4', estimatedDeliveryAt: '2026-11-27T14:31:00Z' }),
      order({ code: 'DL-5', status: 'Searching', createdAt: '2026-11-27T14:25:00Z' }),
      order({ code: 'DL-6', isLate: true, estimatedDeliveryAt: '2026-11-27T14:40:00Z' }),
    ];
    expect(queue.sort(compareOrders).map((o) => o.code)).toEqual([
      'DL-5',
      'DL-3',
      'DL-6',
      'DL-2',
      'DL-4',
      'DL-1',
    ]);
  });

  it('filters the tabs', () => {
    const searching = order({ status: 'Searching' });
    const late = order({ isLate: true });
    const onTime = order({});
    expect([searching, late, onTime].filter((o) => inTab(o, 'needs-rider'))).toEqual([searching]);
    expect([searching, late, onTime].filter((o) => inTab(o, 'late'))).toEqual([late]);
    expect([searching, late, onTime].filter((o) => inTab(o, 'all'))).toHaveLength(3);
  });

  it('labels each status as the designs do', () => {
    expect(chipOf({ status: 'Searching', isLate: true })).toEqual({
      tone: 'needs-rider',
      label: 'Needs rider',
    });
    expect(chipOf({ status: 'Assigned', isLate: false })).toEqual({
      tone: 'available',
      label: 'Assigned',
    });
    expect(chipOf({ status: 'PickedUp', isLate: false })).toEqual({
      tone: 'accent',
      label: 'Picked up',
    });
    expect(chipOf({ status: 'InTransit', isLate: false })).toEqual({
      tone: 'accent',
      label: 'On the way',
    });
    expect(chipOf({ status: 'InTransit', isLate: true })).toEqual({
      tone: 'late',
      label: 'Running late',
    });
    expect(chipOf({ status: 'Delivered', isLate: true })).toEqual({
      tone: 'neutral',
      label: 'Delivered',
    });
  });

  it('writes the row meta line', () => {
    expect(metaOf(order({ status: 'Searching', createdAt: '2026-11-27T14:26:48Z' }), now)).toEqual({
      start: 'Searching within 1.5 km',
      end: 'waiting 0:12',
      tone: 'muted',
    });
    expect(metaOf(order({ estimatedDeliveryAt: '2026-11-27T14:34:20Z' }), now)).toEqual({
      start: 'Aman Verma',
      end: '8 min',
      tone: 'eta',
    });
    expect(
      metaOf(
        order({
          riderName: 'Imran Ali',
          isLate: true,
          minutesLate: 5,
          estimatedDeliveryAt: '2026-11-27T14:39:00Z',
        }),
        now,
      ),
    ).toEqual({ start: 'Imran Ali', end: '12 min · +5', tone: 'late' });
  });

  it('formats times, distances and counts', () => {
    expect(clockTime('2026-11-27T14:35:00Z')).toBe('8:05 PM');
    expect(etaMinutes('2026-11-27T14:26:00Z', now)).toBe(1);
    expect(km(620)).toBe('0.6 km');
    expect(km(3_140)).toBe('3.1 km');
    expect(km(5_000)).toBe('5 km');
    expect(minutesSeconds(12_400)).toBe('0:12');
    expect(minutesSeconds(724_000)).toBe('12:04');
    expect(onlineFor('2026-11-27T09:15:00Z', now)).toBe('Online 5h 12m');
    expect(onlineFor('2026-11-27T14:15:00Z', now)).toBe('Online 12m');
    expect(deliveriesToday(9)).toBe('9 deliveries today');
    expect(deliveriesToday(1)).toBe('1 delivery today');
  });
});
