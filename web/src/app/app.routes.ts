import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'styleguide',
    title: 'Styleguide · Dispatchly',
    loadComponent: () => import('./styleguide/styleguide').then((m) => m.Styleguide),
  },
];
