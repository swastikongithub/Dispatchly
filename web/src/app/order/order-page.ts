import { Location, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideMinus,
  LucidePlus,
} from '@lucide/angular';
import type { PaddingOptions } from 'maplibre-gl';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../core/api/api-client';
import { DemoSession } from '../core/auth/demo-session';
import { km } from '../dispatch/queue';
import { tokens } from '../tokens';
import { BottomSheet, Button, IconButton, Panel, Segmented, type SegmentOption } from '../ui';
import {
  itemCount,
  itemsLabel,
  placeRequest,
  rupees,
  totalPaise,
  withQuantity,
  type Address,
  type Cart,
  type Payment,
  type Restaurant,
} from './order-flow';
import { OrderMap, type OrderStep } from './order-map';
import { RestaurantRow } from './restaurant-row';

const px = (value: string) => parseFloat(value);
/** Desktop: the sheet becomes a 400px panel floating on the left (PLAN.md §5.3, as tracking). */
const PANEL_LAYOUT = `(min-width: ${tokens.layout.breakpoints.dashboardDrawer})`;
const INSET = px(tokens.layout.phoneOverlayInset);
const PANEL_WIDTH = px(tokens.layout.trackingDesktopSheetWidth);
/** Skeleton rows while the restaurants load, as the dashboard's order list shows. */
const SKELETON_ROWS = 6;

/**
 * Order placement `/order` (PLAN.md §5.5, built from the system for approval): the light map
 * with a bottom sheet that walks the customer through picking a restaurant, setting the drop pin
 * on their saved address and placing the order, which opens its tracking page.
 */
@Component({
  selector: 'app-order-page',
  imports: [
    BottomSheet,
    Button,
    IconButton,
    LucideChevronLeft,
    LucideChevronRight,
    LucideMinus,
    LucidePlus,
    NgTemplateOutlet,
    OrderMap,
    Panel,
    RestaurantRow,
    Segmented,
  ],
  templateUrl: './order-page.html',
  styleUrl: './order-page.css',
  host: { class: 'theme-light' },
})
export class OrderPage {
  private readonly api = inject(ApiClient);
  private readonly session = inject(DemoSession);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly topBar = viewChild.required<ElementRef<HTMLElement>>('topBar');
  private readonly sheetRef = viewChild(BottomSheet);

  protected readonly panel = signal(matchMedia(PANEL_LAYOUT).matches);
  protected readonly step = signal<OrderStep>('restaurant');
  protected readonly sheetSnap = signal<'peek' | 'half' | 'full'>('half');

  protected readonly address = signal<Address | null>(null);
  protected readonly restaurants = signal<Restaurant[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly selectedId = signal<number | null>(null);
  protected readonly hovered = signal<number | null>(null);
  protected readonly cart = signal<Cart>({});
  protected readonly payment = signal<Payment>('Online');
  protected readonly placing = signal(false);
  protected readonly placeFailed = signal(false);

  protected readonly selected = computed(
    () => this.restaurants().find((r) => r.id === this.selectedId()) ?? null,
  );
  protected readonly count = computed(() => itemCount(this.cart()));
  protected readonly total = computed(() =>
    rupees(totalPaise(this.selected()?.menu ?? [], this.cart())),
  );
  protected readonly skeletons = Array.from({ length: SKELETON_ROWS }, (_, i) => i);
  protected readonly payments: SegmentOption[] = [
    { value: 'Online', label: 'Pay online' },
    { value: 'Cash', label: 'Cash on delivery' },
  ];
  protected readonly km = km;
  protected readonly rupees = rupees;
  protected readonly itemsLabel = itemsLabel;

  /** Where the top bar ends, so the sheet stops below it and the camera keeps clear of it. */
  private readonly topBarBottom = signal(0);
  protected readonly orderMap = viewChild.required(OrderMap);

  /** Room the sheet or panel and the top bar take on each side of the map. */
  protected readonly padding = computed<Required<PaddingOptions>>(() => {
    const top = this.topBarBottom();
    if (this.panel()) return { top, right: 0, bottom: 0, left: INSET + PANEL_WIDTH };
    return { top, right: 0, bottom: this.sheetRef()?.covers() ?? 0, left: 0 };
  });
  /** The map credit sits above the sheet. */
  protected readonly creditBottom = computed(() => (this.panel() ? 0 : this.padding().bottom));

  constructor() {
    const destroyRef = inject(DestroyRef);
    const media = matchMedia(PANEL_LAYOUT);
    const listener = () => this.panel.set(media.matches);
    media.addEventListener('change', listener);
    destroyRef.onDestroy(() => media.removeEventListener('change', listener));

    afterNextRender(() => {
      const bar = this.topBar().nativeElement;
      const observer = new ResizeObserver(() =>
        this.topBarBottom.set(bar.getBoundingClientRect().bottom),
      );
      observer.observe(bar);
      destroyRef.onDestroy(() => observer.disconnect());
    });

    void this.load();
  }

  /** The saved address, then the restaurants nearest to it. */
  protected async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      await this.session.signIn('Customer');
      const [address] = await firstValueFrom(this.api.get('/api/v1/customer/addresses'));
      if (!address) throw new Error('No saved address.');
      this.address.set(address);
      const near = `${address.location.lat},${address.location.lng}`;
      this.restaurants.set(
        await firstValueFrom(this.api.get('/api/v1/restaurants', { query: { near } })),
      );
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected choose(restaurant: Restaurant): void {
    if (restaurant.id !== this.selectedId()) this.cart.set({});
    this.selectedId.set(restaurant.id);
    this.hovered.set(null);
    this.go('drop');
  }

  protected pick(id: number): void {
    const restaurant = this.restaurants().find((r) => r.id === id);
    if (restaurant) this.choose(restaurant);
  }

  protected confirmDrop(): void {
    this.go('summary');
  }

  protected quantity(id: string): number {
    return this.cart()[id] ?? 0;
  }

  protected change(id: string, by: number): void {
    this.cart.update((cart) => withQuantity(cart, id, (cart[id] ?? 0) + by));
  }

  protected setPayment(value: string): void {
    this.payment.set(value as Payment);
  }

  /** Back a step, or off the page from the first one. */
  protected back(): void {
    const step = this.step();
    if (step === 'summary') this.go('drop');
    else if (step === 'drop') this.go('restaurant');
    else this.location.back();
  }

  protected async place(): Promise<void> {
    const restaurant = this.selected();
    const address = this.address();
    const pin = this.orderMap().pin();
    if (!restaurant || !address || !pin || this.count() === 0 || this.placing()) return;
    this.placing.set(true);
    this.placeFailed.set(false);
    try {
      const order = await firstValueFrom(
        this.api.post('/api/v1/orders', {
          body: placeRequest(restaurant, this.cart(), address, pin, this.payment()),
        }),
      );
      await this.router.navigate(['/track', order.code]);
    } catch {
      this.placeFailed.set(true);
      this.placing.set(false);
    }
  }

  private go(step: OrderStep): void {
    this.step.set(step);
    this.placeFailed.set(false);
    // The list opens halfway so the map shows the pins; the pin step leaves the map to the pin;
    // the summary opens fully, as it's what's being read.
    this.sheetSnap.set(step === 'restaurant' ? 'half' : step === 'drop' ? 'peek' : 'full');
  }
}
