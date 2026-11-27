import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LucideChevronDown } from '@lucide/angular';
import { DemoSession } from '../core/auth/demo-session';
import { LiveHub, type HubState } from '../core/live/live-hub';
import { tokens } from '../tokens';
import {
  Avatar,
  BottomSheet,
  Button,
  Legend,
  MapControls,
  Stat,
  Wordmark,
  type LegendItem,
  type SheetSnap,
} from '../ui';
import { DispatchStore, type LiveStats, type RidersBatch } from './dispatch-store';
import { LiveMap } from './live-map';
import { OrdersPanel } from './orders-panel';
import type { OrderSummary } from './queue';
import { SearchPalette } from './search-palette';
import { SelectedRider } from './selected-rider';
import { Toasts } from './toasts';

const ms = (duration: string) => parseFloat(duration);
const RECONNECTING_AFTER = ms(tokens.motion.duration.reconnectingAfter);
const DIM_AFTER = ms(tokens.motion.duration.markersDimAfter);
const px = (value: string) => parseFloat(value);
const FULL_LAYOUT = `(min-width: ${tokens.layout.breakpoints.dashboardFull})`;
const SHEET_LAYOUT = `(max-width: ${px(tokens.layout.breakpoints.dashboardDrawer) - 1}px)`;
/** Narrower than the phone design (390 px): the top bar shows the mark without the name. */
const NARROW_LAYOUT = `(max-width: ${px(tokens.layout.phoneDesignSize) - 1}px)`;

/**
 * The dispatcher dashboard `/dispatch` (PLAN.md §5.2, design: dashboard.png): the live map with
 * the top bar, the order queue, the selected rider, the legend and map controls over it.
 */
@Component({
  selector: 'app-dispatch-page',
  imports: [
    Avatar,
    BottomSheet,
    Button,
    Legend,
    LiveMap,
    LucideChevronDown,
    MapControls,
    NgTemplateOutlet,
    OrdersPanel,
    SearchPalette,
    SelectedRider,
    Stat,
    Toasts,
    Wordmark,
  ],
  providers: [DispatchStore],
  templateUrl: './dispatch-page.html',
  styleUrl: './dispatch-page.css',
  host: {
    class: 'theme-dark',
    '(document:keydown)': 'onKey($event)',
  },
})
export class DispatchPage {
  protected readonly store = inject(DispatchStore);
  private readonly session = inject(DemoSession);

  protected readonly map = viewChild.required(LiveMap);
  private readonly orders = viewChild(OrdersPanel);
  private readonly search = viewChild.required(SearchPalette);
  private readonly toasts = viewChild.required(Toasts);
  private readonly topBar = viewChild.required<ElementRef<HTMLElement>>('topBar');
  private readonly controls = viewChild.required<ElementRef<HTMLElement>>('controls');
  private readonly bottomSheet = viewChild(BottomSheet);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  /** The screen's height, where the top bar ends, and (small screens) where the map controls end. */
  private readonly screenHeight = signal(innerHeight);
  private readonly topBarBottom = signal(0);
  private readonly controlsBottom = signal(0);
  /** Small screens: how much of the screen the bottom sheet covers where it rests. */
  protected readonly sheetCover = computed(() =>
    this.sheet() ? (this.bottomSheet()?.covers() ?? 0) : 0,
  );

  protected readonly hubState = signal<HubState>('connecting');
  /** When the connection was lost, on the `performance.now()` clock. */
  private readonly lostAt = signal<number | null>(null);

  protected readonly sheet = signal(matchMedia(SHEET_LAYOUT).matches);
  protected readonly wide = signal(matchMedia(FULL_LAYOUT).matches);
  protected readonly narrow = signal(matchMedia(NARROW_LAYOUT).matches);
  protected readonly sheetSnap = signal<SheetSnap>('peek');
  /** Small screens: the stats open from the Live chip. */
  protected readonly statsOpen = signal(false);
  /** Map layers: just the riders, without restaurants and other riders' routes. */
  protected readonly quiet = signal(false);
  /** The drawer starts below the top bar. */
  protected readonly drawerTop = computed(() => this.topBarBottom());

  protected readonly loading = computed(() => this.store.phase() === 'loading');
  protected readonly stats = computed<LiveStats | null>(() => this.store.stats());
  protected readonly account = computed(() => this.session.current()?.name ?? 'Dispatcher');
  protected readonly hasSelection = computed(() => this.store.selection()?.riderId != null);
  protected readonly averageDelivery = computed(() => {
    const minutes = this.stats()?.averageDeliveryMinutes;
    return minutes == null ? '–' : `${minutes} min`;
  });

  /** "Reconnecting…" once the connection has been gone for more than 5 s (PLAN.md §5.2). */
  protected readonly reconnecting = computed(() => {
    this.store.now();
    const lost = this.lostAt();
    return lost !== null && performance.now() - lost > RECONNECTING_AFTER;
  });
  /** Markers dim to 50% after 10 s. */
  protected readonly dimmed = computed(() => {
    this.store.now();
    const lost = this.lostAt();
    return lost !== null && performance.now() - lost > DIM_AFTER;
  });

  /** "updated 2s ago": since the last rider positions. */
  protected readonly updatedAgo = computed(() => {
    this.store.now();
    const last = this.store.lastBatch();
    return last === null ? null : Math.max(0, Math.floor((performance.now() - last) / 1000));
  });

  protected readonly legend = computed<LegendItem[]>(() => {
    const stats = this.stats();
    return [
      { kind: 'available', label: 'Available', count: stats?.ridersFree ?? 0 },
      { kind: 'on-delivery', label: 'On a delivery', count: stats?.ridersOnDelivery ?? 0 },
      { kind: 'late', label: 'Running late', count: stats?.runningLate ?? 0 },
      { kind: 'restaurant', label: 'Restaurant' },
    ];
  });

  /**
   * The map credit rides above the sheet while there's room under the map controls; above
   * that, it stays at the bottom behind the sheet rather than run into them.
   */
  protected readonly creditBottom = computed(() => {
    const cover = this.sheetCover();
    const room = this.screenHeight() - cover - this.controlsBottom();
    return room >= px(tokens.layout.minTouchTarget) ? cover : 0;
  });

  /**
   * Small screens: the sheet comes to rest over the map controls. They fade out rather than show
   * half above its edge, and come back as it lowers.
   */
  protected readonly controlsCovered = computed(
    () => this.sheet() && this.screenHeight() - this.sheetCover() < this.controlsBottom(),
  );

  /** Room the panels take, so the camera centres a selection in the map that's visible. */
  protected readonly padding = computed(() => {
    const space = px(tokens.layout.dashboardPadding);
    const top = this.topBarBottom() + space;
    if (this.sheet()) {
      // Never more than the screen below the top bar, so the map keeps a centre.
      const bottom = Math.min(this.sheetCover() + space, this.screenHeight() - top - space);
      return { top, right: space, bottom, left: space };
    }
    const left = px(tokens.layout.ordersPanelWidth) + 2 * space;
    const right = this.hasSelection() ? px(tokens.layout.riderCardWidth) + 2 * space : space;
    return { top, right, bottom: space, left };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const bar = this.topBar().nativeElement;
      const controls = this.controls().nativeElement;
      const observer = new ResizeObserver(() => {
        this.screenHeight.set(this.host.clientHeight);
        this.topBarBottom.set(bar.getBoundingClientRect().bottom);
        this.controlsBottom.set(controls.getBoundingClientRect().bottom);
      });
      for (const element of [this.host, bar, controls]) observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    for (const [query, target] of [
      [SHEET_LAYOUT, this.sheet],
      [FULL_LAYOUT, this.wide],
      [NARROW_LAYOUT, this.narrow],
    ] as const) {
      const media = matchMedia(query);
      const listener = () => target.set(media.matches);
      media.addEventListener('change', listener);
      destroyRef.onDestroy(() => media.removeEventListener('change', listener));
    }

    const hub = new LiveHub({
      token: async () => (await this.session.signIn('Dispatcher')).token,
      onConnect: async (connection) => {
        this.store.holdMessages();
        await connection.invoke('JoinDispatch');
        await this.store.loadSnapshot().catch(() => {});
      },
      onUnauthorized: () => this.session.expire(),
    });
    hub.on('riders:batch', (batch: RidersBatch) => this.store.onBatch(batch));
    hub.on('order:changed', (order: OrderSummary, at: string) =>
      this.store.onOrderChanged(order, at),
    );
    hub.on('stats:changed', (stats: LiveStats, at: string) => this.store.onStatsChanged(stats, at));
    // Sign in first, so the snapshot request carries the token.
    void this.session.signIn('Dispatcher').then(
      () => hub.start(),
      () => {
        this.store.failed.set(true);
        void hub.start();
      },
    );
    destroyRef.onDestroy(() => void hub.stop());

    // Track how long the connection has been gone, and say so when it's back.
    effect(() => {
      const state = hub.state();
      this.hubState.set(state);
      untracked(() => {
        if (state === 'live') {
          if (this.reconnecting()) this.toasts().show('Reconnected');
          this.lostAt.set(null);
        } else if (state !== 'connecting' && this.lostAt() === null) {
          this.lostAt.set(performance.now());
        }
      });
    });

    // On small screens the sheet opens to show the selected rider.
    effect(() => {
      if (this.hasSelection() && this.sheet()) untracked(() => this.sheetSnap.set('half'));
    });
  }

  protected close(): void {
    this.store.clearSelection();
  }

  protected searchOrders(): void {
    this.search().focus();
  }

  /** Keyboard (PLAN.md §5.2): ↑ / ↓ orders, Enter selects, Esc closes, / or Ctrl K search, + / − zoom. */
  protected onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
    const onMap = !!target?.closest('.maplibregl-canvas-container, .maplibregl-canvas');
    switch (event.key) {
      case 'Escape':
        if (this.store.selection()) {
          event.preventDefault();
          this.close();
        }
        break;
      case '/':
        if (typing) return;
        event.preventDefault();
        this.search().focus();
        break;
      case 'ArrowDown':
      case 'ArrowUp':
        if (typing || onMap) return;
        event.preventDefault();
        this.orders()?.focusRow(event.key === 'ArrowDown' ? 1 : -1);
        break;
      case '+':
      case '=':
        if (typing || onMap) return;
        event.preventDefault();
        this.map().zoomIn();
        break;
      case '-':
      case '_':
        if (typing || onMap) return;
        event.preventDefault();
        this.map().zoomOut();
        break;
    }
  }
}
