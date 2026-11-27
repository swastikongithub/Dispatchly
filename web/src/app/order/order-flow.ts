import type { Api } from '../core/api/api-client';
import { distance, type LngLat } from '../dispatch/route-geometry';

/**
 * The order page's rules (PLAN.md §1.2: pick a restaurant → set the drop pin → place the order).
 * The server prices the order and decides everything after it; these only keep the cart and word
 * what the customer is about to send.
 */

export type Restaurant = Api['NearbyRestaurant'];
export type MenuEntry = Api['MenuEntry'];
export type Address = Api['CustomerAddress'];
export type Payment = Api['PaymentMethod'];
export type PlaceOrder = Api['PlaceOrderRequest'];

/** Quantities by menu item id. Items not in it aren't in the order. */
export type Cart = Readonly<Record<string, number>>;

/** The most of one item the server takes (Order.MaxQuantity). */
export const MAX_QUANTITY = 20;

/** `cart` with `id` set to `quantity` (0 takes it out), kept within what the server takes. */
export function withQuantity(cart: Cart, id: string, quantity: number): Cart {
  const { [id]: _, ...rest } = cart;
  const kept = Math.min(MAX_QUANTITY, Math.max(0, Math.round(quantity)));
  return kept > 0 ? { ...rest, [id]: kept } : rest;
}

export function itemCount(cart: Cart): number {
  return Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
}

/** The total at the menu's prices, as the server will charge it. */
export function totalPaise(menu: readonly MenuEntry[], cart: Cart): number {
  return menu.reduce((sum, item) => sum + item.pricePaise * (cart[item.id] ?? 0), 0);
}

const indian = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** "₹640", "₹1,23,456": rupees, grouped the Indian way. */
export function rupees(paise: number): string {
  return `₹${indian.format(paise / 100)}`;
}

/** "1 item", "2 items", as in the tracking summary. */
export function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

/** `POST /orders`: the cart's lines in menu order, delivered to `pin` at the saved `address`. */
export function placeRequest(
  restaurant: Restaurant,
  cart: Cart,
  address: Address,
  pin: LngLat,
  payment: Payment,
): PlaceOrder {
  return {
    restaurantId: restaurant.id,
    items: restaurant.menu
      .filter((item) => (cart[item.id] ?? 0) > 0)
      .map((item) => ({ menuItemId: item.id, quantity: cart[item.id]! })),
    drop: {
      lat: pin[1],
      lng: pin[0],
      address: address.address,
      area: address.area,
      label: address.label,
    },
    payment,
  };
}

/**
 * The drop pin fine-tunes a saved address, so it stays within `radius` metres of it: a pin moved
 * further is pulled back to the edge, along the way it was moved. Over a few hundred metres a flat
 * projection is plenty.
 */
export function clampPin(saved: LngLat, pin: LngLat, radius: number): LngLat {
  const away = distance(saved, pin);
  if (away <= radius) return pin;
  const k = radius / away;
  return [saved[0] + (pin[0] - saved[0]) * k, saved[1] + (pin[1] - saved[1]) * k];
}
