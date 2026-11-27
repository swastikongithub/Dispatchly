import {
  AROUND_THE_CORNER_METERS,
  announcement,
  distanceAway,
  firstName,
  lineLabel,
  progressOf,
  restaurantLine,
  sentenceOf,
  stageOf,
  summaryLine,
  type OrderDetails,
} from './tracking-flow';

/** The hero order (PLAN.md §12) on its way: picked up at 7:51 PM, due at 8:05 PM, 3.1 km out. */
const hero: OrderDetails = {
  code: 'DL-4817',
  status: 'InTransit',
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
    status: 'Delivering',
    location: { lat: 28.5859, lng: 77.2368 },
    bearing: 153,
    street: 'Mathura Road',
  },
  items: [
    {
      menuItemId: 'smoked-butter-chicken',
      name: 'Smoked butter chicken',
      quantity: 1,
      unitPricePaise: 46000,
    },
    { menuItemId: 'dal-makhani', name: 'Dal makhani', quantity: 1, unitPricePaise: 18000 },
  ],
  totalPaise: 64000,
  payment: 'Online',
  deliveryCode: '4821',
  route: [
    { lat: 28.6003, lng: 77.2271 },
    { lat: 28.5677, lng: 77.2433 },
  ],
  distanceMeters: 6900,
  remainingMeters: 3100,
  searchRadiusMeters: 1500,
  createdAt: '2026-11-27T14:02:00Z',
  readyAt: '2026-11-27T14:14:00Z',
  promisedBy: '2026-11-27T14:40:00Z',
  // 8:05 PM in Delhi.
  estimatedDeliveryAt: '2026-11-27T14:35:00Z',
  assignedAt: '2026-11-27T14:03:00Z',
  // 7:51 PM in Delhi.
  pickedUpAt: '2026-11-27T14:21:00Z',
  deliveredAt: null,
  timeline: [
    {
      type: 'Placed',
      at: '2026-11-27T14:02:00Z',
      riderId: null,
      riderName: null,
      freeRiders: null,
      distanceMeters: null,
      previousRiderId: null,
      previousRiderName: null,
    },
    {
      type: 'Assigned',
      at: '2026-11-27T14:03:00Z',
      riderId: 17,
      riderName: 'Aman Verma',
      freeRiders: 4,
      distanceMeters: 600,
      previousRiderId: null,
      previousRiderName: null,
    },
    {
      type: 'ArrivedAtRestaurant',
      at: '2026-11-27T14:12:00Z',
      riderId: 17,
      riderName: 'Aman Verma',
      freeRiders: null,
      distanceMeters: null,
      previousRiderId: null,
      previousRiderName: null,
    },
    {
      type: 'PickedUp',
      at: '2026-11-27T14:21:00Z',
      riderId: 17,
      riderName: 'Aman Verma',
      freeRiders: null,
      distanceMeters: null,
      previousRiderId: null,
      previousRiderName: null,
    },
    {
      type: 'OnTheWay',
      at: '2026-11-27T14:22:00Z',
      riderId: 17,
      riderName: 'Aman Verma',
      freeRiders: null,
      distanceMeters: null,
      previousRiderId: null,
      previousRiderName: null,
    },
  ],
};

const searching: OrderDetails = {
  ...hero,
  status: 'Searching',
  rider: null,
  remainingMeters: null,
  pickedUpAt: null,
  assignedAt: null,
  timeline: hero.timeline.slice(0, 1),
};
const heading: OrderDetails = {
  ...hero,
  status: 'Assigned',
  rider: { ...hero.rider!, status: 'Assigned' },
  pickedUpAt: null,
  timeline: hero.timeline.slice(0, 2),
};
const atRestaurant: OrderDetails = {
  ...heading,
  rider: { ...hero.rider!, status: 'AtRestaurant' },
  timeline: hero.timeline.slice(0, 3),
};
const pickedUp: OrderDetails = { ...hero, status: 'PickedUp', timeline: hero.timeline.slice(0, 4) };
// 8:04 PM in Delhi.
const delivered: OrderDetails = {
  ...hero,
  status: 'Delivered',
  deliveredAt: '2026-11-27T14:34:00Z',
  remainingMeters: null,
};
const cancelled: OrderDetails = { ...searching, status: 'Cancelled' };

describe('the stage of an order', () => {
  it('follows the status, and the rider waiting at the restaurant', () => {
    expect(stageOf(searching, null)).toBe('searching');
    expect(stageOf(heading, 6600)).toBe('heading');
    expect(stageOf(atRestaurant, 6900)).toBe('at-restaurant');
    expect(stageOf(pickedUp, 6900)).toBe('picked-up');
    expect(stageOf(hero, 3100)).toBe('on-the-way');
    expect(stageOf(delivered, null)).toBe('delivered');
    expect(stageOf(cancelled, null)).toBe('cancelled');
  });

  it('is around the corner once the rider is close to the door', () => {
    expect(stageOf(hero, AROUND_THE_CORNER_METERS)).toBe('around-the-corner');
    expect(stageOf(hero, AROUND_THE_CORNER_METERS + 1)).toBe('on-the-way');
    // Picked up but still at the restaurant is never around the corner, however close it is.
    expect(stageOf({ ...pickedUp, distanceMeters: 300 }, 300)).toBe('picked-up');
  });
});

describe('the status sentence', () => {
  it('reads as in the design for each stage', () => {
    expect(sentenceOf(searching, null, null)).toBe('Finding the nearest rider…');
    expect(sentenceOf(heading, 6600, 'Lodhi Road')).toBe('Aman is heading to Saffron & Smoke');
    expect(sentenceOf(atRestaurant, 6900, null)).toBe('Aman is at Saffron & Smoke');
    expect(sentenceOf(hero, 3100, 'Mathura Road')).toBe(
      'Aman picked up your order at 7:51 PM and is riding down Mathura Road.',
    );
    expect(sentenceOf(hero, 400, 'Mathura Road')).toBe('Aman is around the corner');
    expect(sentenceOf(delivered, null, null)).toBe('Delivered at 8:04 PM');
    expect(sentenceOf(cancelled, null, null)).toBe('Your order was cancelled.');
  });

  it('says the rider is on the way when no street is near them', () => {
    expect(sentenceOf(pickedUp, 6900, null)).toBe(
      'Aman picked up your order at 7:51 PM and is on the way.',
    );
  });

  it('uses the first name only', () => {
    expect(firstName('Aman Verma')).toBe('Aman');
    expect(firstName('Ritika')).toBe('Ritika');
    expect(firstName('  Imran   Ali ')).toBe('Imran');
  });
});

describe('the four-step progress', () => {
  it('fills Placed as the rider reaches the restaurant', () => {
    expect(progressOf(searching, null)).toEqual({ current: 0, partial: 0 });
    // Assigned 600 m from the restaurant and now 300 m from it: halfway there.
    expect(progressOf(heading, hero.distanceMeters + 300)).toEqual({ current: 0, partial: 0.5 });
    expect(progressOf(heading, hero.distanceMeters + 900)).toEqual({ current: 0, partial: 0 });
    expect(progressOf(atRestaurant, hero.distanceMeters)).toEqual({ current: 0, partial: 1 });
  });

  it('fills On the way with the distance covered', () => {
    expect(progressOf(pickedUp, hero.distanceMeters)).toEqual({ current: 1, partial: 1 });
    const onTheWay = progressOf(hero, 3100);
    expect(onTheWay.current).toBe(2);
    expect(onTheWay.partial).toBeCloseTo(1 - 3100 / 6900);
    expect(progressOf(hero, 9000)).toEqual({ current: 2, partial: 0 });
    expect(progressOf(delivered, null)).toEqual({ current: 3, partial: 1 });
  });

  it('measures the way to the restaurant from the latest assignment', () => {
    const reassigned: OrderDetails = {
      ...heading,
      timeline: [
        ...heading.timeline,
        {
          ...hero.timeline[1]!,
          type: 'Reassigned',
          distanceMeters: 1000,
          previousRiderId: 9,
          previousRiderName: 'Karan Mehta',
        },
      ],
    };
    expect(progressOf(reassigned, hero.distanceMeters + 250)).toEqual({
      current: 0,
      partial: 0.75,
    });
  });
});

describe('the order summary', () => {
  it('names the restaurant with its area', () => {
    expect(restaurantLine(hero)).toBe('Saffron & Smoke, Khan Market');
  });

  it('counts items, totals in rupees and says how it was paid', () => {
    expect(summaryLine(hero)).toBe('2 items · ₹640 · Paid online');
    const cash: OrderDetails = {
      ...hero,
      payment: 'Cash',
      items: [{ ...hero.items[0]!, quantity: 3 }],
      totalPaise: 138000,
    };
    expect(summaryLine(cash)).toBe('3 items · ₹1,380 · Cash on delivery');
    expect(summaryLine({ ...hero, items: [hero.items[1]!], totalPaise: 18000 })).toBe(
      '1 item · ₹180 · Paid online',
    );
  });

  it('lists each line with its quantity and price', () => {
    expect(lineLabel({ ...hero.items[1]!, quantity: 2 })).toEqual({
      name: '2 × Dal makhani',
      price: '₹360',
    });
  });

  it('says how far away the rider is', () => {
    expect(distanceAway(3100)).toBe('3.1 km away');
    expect(distanceAway(null)).toBe('');
  });
});

describe('what screen readers hear', () => {
  const heard = (status: OrderDetails['status'], minutes: number | null = null) => ({
    status,
    minutes,
  });

  it('announces pickup, two minutes out and delivery, once each', () => {
    expect(announcement(heard('Assigned'), heard('PickedUp', 12))).toBe('Picked up');
    expect(announcement(heard('Assigned'), heard('InTransit', 12))).toBe('Picked up');
    expect(announcement(heard('PickedUp', 12), heard('InTransit', 12))).toBeNull();
    expect(announcement(heard('InTransit', 3), heard('InTransit', 2))).toBe(
      'Arriving in 2 minutes',
    );
    expect(announcement(heard('InTransit', 2), heard('InTransit', 2))).toBeNull();
    expect(announcement(heard('InTransit', 2), heard('InTransit', 1))).toBeNull();
    expect(announcement(heard('InTransit', 4), heard('InTransit', 1))).toBe('Arriving in 1 minute');
    expect(announcement(heard('InTransit', 1), heard('Delivered'))).toBe('Delivered');
    expect(announcement(heard('Searching'), heard('Cancelled'))).toBe('Order cancelled');
  });

  it('stays quiet on the first load and before pickup', () => {
    expect(announcement(null, heard('InTransit', 2))).toBeNull();
    expect(announcement(heard('Searching'), heard('Assigned', 2))).toBeNull();
  });
});
