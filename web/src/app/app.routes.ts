import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'dispatch',
    title: 'Dispatch · Dispatchly',
    loadComponent: () => import('./dispatch/dispatch-page').then((m) => m.DispatchPage),
  },
  {
    path: 'order',
    title: 'New order · Dispatchly',
    loadComponent: () => import('./order/order-page').then((m) => m.OrderPage),
  },
  {
    path: 'track/:code',
    title: 'Track your order · Dispatchly',
    loadComponent: () => import('./tracking/tracking-page').then((m) => m.TrackingPage),
  },
  {
    path: 'styleguide',
    title: 'Styleguide · Dispatchly',
    loadComponent: () => import('./styleguide/styleguide').then((m) => m.Styleguide),
  },
  // Until the landing page (W7), the home page is the dashboard.
  { path: '', pathMatch: 'full', redirectTo: 'dispatch' },
];
