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
import { MapView } from '../map/map-view';
import { addMarkers, setMarkerData } from '../map/markers';
import type { Map as MapLibreMap } from 'maplibre-gl';

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
    MapView,
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

  /** Sample markers around central Delhi, in every marker state. */
  protected showMarkers(map: MapLibreMap, theme: 'dark' | 'light'): void {
    const point = (lng: number, lat: number, properties: Record<string, unknown>) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      properties,
    });
    const line = (coordinates: number[][], kind: string) => ({
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates },
      properties: { kind },
    });
    const collection = <T>(features: T[]) => ({ type: 'FeatureCollection' as const, features });
    const restaurant = [77.2195, 28.6178];
    const rider = [77.2262, 28.6085];
    const drop = [77.2366, 28.5995];
    const activeRoute = [rider, [77.2291, 28.6052], [77.2318, 28.6021], [77.2341, 28.5999], drop];

    if (theme === 'dark') {
      addMarkers(map, 'dark', 'dashboard');
      setMarkerData(map, {
        routes: collection([
          line([restaurant, [77.2228, 28.6131], rider], 'travelled'),
          line(activeRoute, 'active'),
          line(
            [
              [77.2079, 28.6203],
              [77.2121, 28.6151],
              [77.2112, 28.6082],
            ],
            'other',
          ),
          line(
            [
              [77.2398, 28.6162],
              [77.2431, 28.6105],
              [77.2472, 28.6071],
            ],
            'other',
          ),
        ]),
        places: collection([
          point(restaurant[0]!, restaurant[1]!, { kind: 'restaurant-active' }),
          point(77.2091, 28.6244, { kind: 'restaurant' }),
          point(77.2401, 28.6208, { kind: 'restaurant' }),
          point(drop[0]!, drop[1]!, { kind: 'drop' }),
          point(77.2112, 28.6082, { kind: 'other-drop' }),
          point(77.2472, 28.6071, { kind: 'other-drop' }),
          point(77.2172, 28.5968, { kind: 'new-order' }),
        ]),
        riders: collection([
          point(rider[0]!, rider[1]!, {
            status: 'on-delivery',
            bearing: 153,
            selected: true,
            label: 'Aman · 8 min',
          }),
          point(77.2079, 28.6203, { status: 'on-delivery', bearing: 140 }),
          point(77.2398, 28.6162, { status: 'on-delivery', bearing: 215 }),
          point(77.2152, 28.6105, { status: 'available' }),
          point(77.2311, 28.6151, { status: 'available' }),
          point(77.2458, 28.5951, { status: 'available' }),
          point(77.2052, 28.6006, { status: 'late' }),
        ]),
      });
    } else {
      addMarkers(map, 'light', 'tracking');
      setMarkerData(map, {
        routes: collection([
          line([restaurant, [77.2228, 28.6131], rider], 'travelled'),
          line(activeRoute, 'active'),
        ]),
        places: collection([
          point(restaurant[0]!, restaurant[1]!, { kind: 'restaurant', label: 'Saffron & Smoke' }),
          point(drop[0]!, drop[1]!, { kind: 'home', label: 'Home' }),
        ]),
        riders: collection([point(rider[0]!, rider[1]!, { status: 'on-delivery', bearing: 153 })]),
      });
    }
  }
}
