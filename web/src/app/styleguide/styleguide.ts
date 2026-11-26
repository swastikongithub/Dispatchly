import { Component, signal } from '@angular/core';
import {
  LucideArrowRight,
  LucideChevronDown,
  LucideChevronLeft,
  LucideListFilter,
  LucideNavigation2,
  LucidePhone,
  LucideX,
  LucideLayers2,
} from '@lucide/angular';
import {
  Avatar,
  BottomSheet,
  Button,
  Chip,
  Eta,
  IconButton,
  Legend,
  LegendItem,
  MapControls,
  OrderRow,
  Panel,
  Progress,
  RiderCardData,
  RiderCard,
  SearchField,
  Segmented,
  SegmentedProgress,
  SheetSnap,
  SlideToConfirm,
  Stat,
  Wordmark,
} from '../ui';

/** Every §4.3 component in every state, in the dark and light themes (PLAN.md §4.3). */
@Component({
  selector: 'app-styleguide',
  imports: [
    Avatar,
    BottomSheet,
    Button,
    Chip,
    Eta,
    IconButton,
    Legend,
    MapControls,
    OrderRow,
    Panel,
    Progress,
    RiderCard,
    SearchField,
    Segmented,
    SegmentedProgress,
    SlideToConfirm,
    Stat,
    Wordmark,
    LucideArrowRight,
    LucideChevronDown,
    LucideChevronLeft,
    LucideLayers2,
    LucideListFilter,
    LucideNavigation2,
    LucidePhone,
    LucideX,
  ],
  templateUrl: './styleguide.html',
  styleUrl: './styleguide.css',
})
export class Styleguide {
  protected readonly themes = ['dark', 'light'] as const;
  protected readonly states = [
    'default',
    'hover',
    'pressed',
    'focus',
    'disabled',
    'loading',
  ] as const;

  protected readonly filters = [
    { value: 'all', label: 'All 60' },
    { value: 'needs-rider', label: 'Needs rider 2' },
    { value: 'late', label: 'Late 3' },
  ];
  protected readonly filter = signal('all');

  protected readonly snaps = [
    { value: 'peek', label: 'Peek' },
    { value: 'half', label: 'Half' },
    { value: 'full', label: 'Full' },
  ];
  protected readonly snapName = signal<string>('full' satisfies SheetSnap);

  protected readonly legend: LegendItem[] = [
    { kind: 'available', label: 'Available', count: 84 },
    { kind: 'on-delivery', label: 'On a delivery', count: 55 },
    { kind: 'late', label: 'Running late', count: 3 },
    { kind: 'restaurant', label: 'Restaurant' },
  ];

  protected readonly rider: RiderCardData = {
    name: 'Aman Verma',
    vehicle: 'Honda Activa · DL 3S CK 2041',
    chipTone: 'accent',
    chipLabel: 'On the way',
    orderId: '#DL-4817',
    eta: '8 min',
    destination: 'Lajpat Nagar II',
    arrival: '8:05 PM',
    remaining: '3.1 km left',
    progress: 0.55,
    steps: [
      {
        title: 'Assigned',
        time: '7:42 PM',
        detail: 'Nearest of 4 free riders, 0.6 km away',
        state: 'done',
      },
      {
        title: 'Picked up',
        time: '7:51 PM',
        detail: 'Saffron & Smoke, Khan Market',
        state: 'done',
      },
      { title: 'On the way', time: 'Now', detail: 'Riding down Mathura Road', state: 'current' },
      { title: 'Delivered', time: '~8:05 PM', detail: 'B-14, Lajpat Nagar II', state: 'pending' },
    ],
    deliveriesToday: '9 deliveries today',
    online: 'Online 5h 12m',
  };

  /** Live values, so the digit roll can be seen. */
  protected readonly stats = signal({ riders: 142, orders: 60, avg: 24, late: 3, eta: 8 });
  protected roll(): void {
    const n = (base: number, spread: number) => base + Math.round((Math.random() - 0.5) * spread);
    this.stats.set({
      riders: n(142, 30),
      orders: n(60, 16),
      avg: n(24, 8),
      late: n(3, 4),
      eta: n(8, 6),
    });
  }

  protected confirmed = signal(0);
}
