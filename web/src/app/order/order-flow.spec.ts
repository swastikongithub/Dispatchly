import { distance, type LngLat } from '../dispatch/route-geometry';
import {
  clampPin,
  itemCount,
  itemsLabel,
  placeRequest,
  rupees,
  totalPaise,
  withQuantity,
  type Address,
  type Restaurant,
} from './order-flow';

const saffron: Restaurant = {
  id: 7,
  name: 'Saffron & Smoke',
  area: 'Khan Market',
  address: 'Shop 21, Middle Lane, Khan Market',
  location: { lat: 28.6003, lng: 77.2271 },
  prepMinutes: 12,
  distanceMeters: 3412,
  menu: [
    { id: 'smoked-butter-chicken', name: 'Smoked butter chicken', pricePaise: 46000 },
    { id: 'dal-makhani', name: 'Dal makhani', pricePaise: 18000 },
    { id: 'garlic-naan', name: 'Garlic naan', pricePaise: 6000 },
  ],
};

const home: Address = {
  label: 'Home',
  address: 'B-14, Lajpat Nagar II',
  area: 'Lajpat Nagar II',
  location: { lat: 28.5677, lng: 77.2433 },
};

describe('the cart', () => {
  it('adds, changes and removes quantities without touching the old cart', () => {
    const empty = {};
    const one = withQuantity(empty, 'dal-makhani', 1);
    const two = withQuantity(one, 'garlic-naan', 2);

    expect(empty).toEqual({});
    expect(one).toEqual({ 'dal-makhani': 1 });
    expect(two).toEqual({ 'dal-makhani': 1, 'garlic-naan': 2 });
    expect(withQuantity(two, 'garlic-naan', 0)).toEqual({ 'dal-makhani': 1 });
  });

  it('keeps each quantity between 0 and the 20 the server takes', () => {
    expect(withQuantity({}, 'dal-makhani', 25)).toEqual({ 'dal-makhani': 20 });
    expect(withQuantity({ 'dal-makhani': 1 }, 'dal-makhani', -1)).toEqual({});
  });

  it('counts items and totals them at menu prices', () => {
    const cart = { 'smoked-butter-chicken': 1, 'dal-makhani': 1, 'garlic-naan': 2 };

    expect(itemCount(cart)).toBe(4);
    expect(totalPaise(saffron.menu, cart)).toBe(46000 + 18000 + 2 * 6000);
  });

  it('ignores items the menu no longer has', () => {
    expect(totalPaise(saffron.menu, { 'dal-makhani': 1, 'cold-brew': 2 })).toBe(18000);
  });
});

describe('wording', () => {
  it('writes rupees without paise, grouped the Indian way', () => {
    expect(rupees(64000)).toBe('₹640');
    expect(rupees(6000)).toBe('₹60');
    expect(rupees(12345600)).toBe('₹1,23,456');
    expect(rupees(0)).toBe('₹0');
  });

  it('counts items as the tracking summary does', () => {
    expect(itemsLabel(1)).toBe('1 item');
    expect(itemsLabel(2)).toBe('2 items');
  });
});

describe('the request', () => {
  it('sends the lines in menu order, the pin and the saved address', () => {
    const request = placeRequest(
      saffron,
      { 'garlic-naan': 2, 'smoked-butter-chicken': 1 },
      home,
      [77.2436, 28.5679],
      'Online',
    );

    expect(request).toEqual({
      restaurantId: 7,
      items: [
        { menuItemId: 'smoked-butter-chicken', quantity: 1 },
        { menuItemId: 'garlic-naan', quantity: 2 },
      ],
      drop: {
        lat: 28.5679,
        lng: 77.2436,
        address: 'B-14, Lajpat Nagar II',
        area: 'Lajpat Nagar II',
        label: 'Home',
      },
      payment: 'Online',
    });
  });
});

describe('the drop pin', () => {
  const saved: LngLat = [home.location.lng, home.location.lat];

  it('stays where it is near the saved address', () => {
    const near: LngLat = [77.2445, 28.5684];

    expect(clampPin(saved, near, 250)).toEqual(near);
  });

  it('is pulled back to the edge of the radius when moved too far', () => {
    const far: LngLat = [77.26, 28.58];

    const pin = clampPin(saved, far, 250);

    expect(distance(saved, pin)).toBeCloseTo(250, 0);
    // Along the same direction it was moved in.
    const along = (pin[0] - saved[0]) / (far[0] - saved[0]);
    expect((pin[1] - saved[1]) / (far[1] - saved[1])).toBeCloseTo(along, 6);
  });
});
