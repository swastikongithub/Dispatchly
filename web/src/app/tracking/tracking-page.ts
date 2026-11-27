import { Location, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  LucideCheck,
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircleQuestionMark,
  LucideLocateFixed,
  LucideMessageCircle,
  LucidePhone,
  LucideStar,
  LucideX,
} from '@lucide/angular';
import type { PaddingOptions } from 'maplibre-gl';
import { DemoSession } from '../core/auth/demo-session';
import { LiveHub } from '../core/live/live-hub';
import { clockTime, etaMinutes } from '../dispatch/queue';
import { tokens } from '../tokens';
import { Avatar, BottomSheet, Button, Eta, IconButton, Panel, SegmentedProgress } from '../ui';
import { prefersReducedMotion } from '../ui/motion';
import {
  announcement,
  distanceAway,
  firstName,
  lineLabel,
  progressOf,
  restaurantLine,
  sentenceOf,
  stageOf,
  STEPS,
  summaryLine,
  type EtaChanged,
  type Heard,
  type OrderDetails,
  type RiderPosition,
} from './tracking-flow';
import { TrackingMap } from './tracking-map';
import { TrackingStore } from './tracking-store';

const px = (value: string) => parseFloat(value);
const ms = (duration: string) => parseFloat(duration);
/** Desktop: the sheet becomes a 400px panel floating on the left (PLAN.md §5.3). */
const PANEL_LAYOUT = `(min-width: ${tokens.layout.breakpoints.dashboardDrawer})`;
const INSET = px(tokens.layout.phoneOverlayInset);
const PANEL_WIDTH = px(tokens.layout.trackingDesktopSheetWidth);
const RECENTER_TOP = px(tokens.layout.trackingRecenterTop);
const BUTTON = px(tokens.size.floatingButton);
/** The map the design keeps above a phone's sheet: down to just below the recenter button. */
const MAP_KEPT = RECENTER_TOP + BUTTON + INSET;
/** Room kept for the map credit above the sheet: a touch target, as on the order page. */
const CREDIT_ROW = px(tokens.layout.minTouchTarget);
/** "Updating…" once the connection has been gone this long, as the dashboard's "Reconnecting…". */
const UPDATING_AFTER = ms(tokens.motion.duration.reconnectingAfter);
const STARS = [1, 2, 3, 4, 5] as const;
const afterPickup = (order: OrderDetails) =>
  order.status === 'PickedUp' || order.status === 'InTransit';

/**
 * Customer tracking `/track/:code` (PLAN.md §5.3, designs/html/tracking.html): the light map with
 * the rider on their way, and a sheet (a floating panel on desktop) with the ETA, the four steps,
 * a sentence about what's happening, the rider with Call and Message, the delivery code and the
 * order. Get help offers the rider's and the restaurant's numbers.
 */
@Component({
  selector: 'app-tracking-page',
  imports: [
    Avatar,
    BottomSheet,
    Button,
    Eta,
    IconButton,
    LucideCheck,
    LucideChevronLeft,
    LucideChevronRight,
    LucideCircleQuestionMark,
    LucideLocateFixed,
    LucideMessageCircle,
    LucidePhone,
    LucideStar,
    LucideX,
    NgTemplateOutlet,
    Panel,
    RouterLink,
    SegmentedProgress,
    TrackingMap,
  ],
  providers: [TrackingStore],
  templateUrl: './tracking-page.html',
  styleUrl: './tracking-page.css',
  host: {
    class: 'theme-light',
    '(document:keydown.escape)': 'closeHelp(true)',
    '(document:pointerdown)': 'pointerDown($event)',
    '[style.--top-bar-bottom.px]': 'padding().top',
  },
})
export class TrackingPage {
  /** The order code from the URL. */
  readonly code = input.required<string>();

  protected readonly store = inject(TrackingStore);
  private readonly session = inject(DemoSession);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly topBar = viewChild.required<ElementRef<HTMLElement>>('topBar');
  private readonly helpButton = viewChild.required<ElementRef<HTMLElement>>('helpButton');
  private readonly helpPanel = viewChild<ElementRef<HTMLElement>>('helpPanel');
  private readonly sheetRef = viewChild(BottomSheet);
  private readonly sheetEl = viewChild(BottomSheet, { read: ElementRef<HTMLElement> });
  private readonly detailsEl = viewChild<ElementRef<HTMLElement>>('details');
  private readonly injector = inject(Injector);
  protected readonly map = viewChild.required(TrackingMap);

  protected readonly panel = signal(matchMedia(PANEL_LAYOUT).matches);
  protected readonly sheetSnap = signal<'peek' | 'half' | 'full'>('full');
  protected readonly helpOpen = signal(false);
  protected readonly detailsOpen = signal(false);
  /** The sheet's height while Details is open, so it keeps its size and the map its room. */
  protected readonly sheetLock = signal<number | null>(null);
  protected readonly rating = signal<number | null>(null);
  /** The last key change, for screen readers (PLAN.md §5.3). */
  protected readonly announced = signal('');

  protected readonly steps = STEPS;
  protected readonly strokeHeavy = tokens.icon.strokeHeavy;
  protected readonly stars = STARS;
  protected readonly lineLabel = lineLabel;

  protected readonly displayCode = computed(() => this.code().toUpperCase());
  protected readonly order = this.store.order;
  protected readonly stage = computed(() => {
    const order = this.order();
    return order ? stageOf(order, this.store.remaining()) : null;
  });
  protected readonly done = computed(
    () => this.stage() === 'delivered' || this.stage() === 'cancelled',
  );
  protected readonly progress = computed(() => {
    const order = this.order();
    return order ? progressOf(order, this.store.remaining()) : { current: 0, partial: 0 };
  });
  protected readonly sentence = computed(() => {
    const order = this.order();
    return order ? sentenceOf(order, this.store.remaining(), this.store.street()) : '';
  });
  protected readonly eta = computed(() => {
    const order = this.order();
    return order ? `${etaMinutes(order.estimatedDeliveryAt, this.store.now())} min` : '';
  });
  protected readonly arrival = computed(() => {
    const order = this.order();
    return order ? clockTime(order.estimatedDeliveryAt) : '';
  });
  /** "3.1 km away", or "Updating…" while the connection is gone and the rider shows where they were. */
  protected readonly distance = computed(() =>
    this.updating()
      ? 'Updating…'
      : distanceAway(this.order()?.rider ? this.store.remaining() : null),
  );
  protected readonly riderFirst = computed(() => firstName(this.order()?.rider?.name ?? ''));
  protected readonly restaurant = computed(() => {
    const order = this.order();
    return order ? restaurantLine(order) : '';
  });
  protected readonly summary = computed(() => {
    const order = this.order();
    return order ? summaryLine(order) : '';
  });
  /** The code read digit by digit ("4 8 2 1"), not as a number. */
  protected readonly codeLabel = computed(() => {
    const code = this.order()?.deliveryCode ?? '';
    return `Delivery code ${code.split('').join(' ')}`;
  });

  private readonly lostAt = signal<number | null>(null);
  /** The connection has been gone for more than 5 s: the last known state stays, marked as such. */
  protected readonly updating = computed(() => {
    this.store.now();
    const lost = this.lostAt();
    return lost !== null && performance.now() - lost > UPDATING_AFTER;
  });

  /** Where the top bar ends, so the sheet stops below it and the camera keeps clear of it. */
  private readonly topBarBottom = signal(0);
  private readonly screenHeight = signal(innerHeight);
  /** Room the sheet or panel and the top bar take on each side of the map. */
  protected readonly padding = computed<Required<PaddingOptions>>(() => {
    const top = this.topBarBottom();
    if (this.panel()) return { top, right: 0, bottom: 0, left: INSET + PANEL_WIDTH };
    return { top, right: 0, bottom: this.sheetRef()?.covers() ?? 0, left: 0 };
  });
  /**
   * The recenter button sits where the design puts it, kept clear of the top bar above, and below
   * of a sheet open past it and of the map credit's row (a touch target tall) just above the sheet.
   */
  protected readonly recenterTop = computed(() => {
    const below = this.topBarBottom() + INSET;
    if (this.panel()) return below;
    const above = this.screenHeight() - this.padding().bottom - CREDIT_ROW - INSET - BUTTON;
    return Math.max(below, Math.min(RECENTER_TOP, above));
  });
  /**
   * The map credit rides above the sheet while there's room for it under the top bar; above
   * that, it stays at the bottom behind the sheet, as on the order page.
   */
  private readonly creditRides = computed(
    () =>
      !this.panel() &&
      this.screenHeight() - this.padding().bottom - this.topBarBottom() >= CREDIT_ROW,
  );
  protected readonly creditBottom = computed(() =>
    this.creditRides() ? this.padding().bottom : 0,
  );
  /**
   * The map's padding: the camera keeps the pins clear of the credit's row too. It frames for a
   * sheet no taller than the design leaves room for, so a sheet raised past that on a short phone
   * covers part of the route for a while, instead of squeezing the route into the strip above it
   * and moving the camera again when it comes back down.
   */
  protected readonly mapPadding = computed<Required<PaddingOptions>>(() => {
    const padding = this.padding();
    if (this.panel()) return padding;
    const sheet = Math.min(padding.bottom, this.screenHeight() - MAP_KEPT);
    return { ...padding, bottom: sheet + (this.creditRides() ? CREDIT_ROW : 0) };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const media = matchMedia(PANEL_LAYOUT);
    const listener = () => this.panel.set(media.matches);
    media.addEventListener('change', listener);
    destroyRef.onDestroy(() => media.removeEventListener('change', listener));

    const host: HTMLElement = inject(ElementRef).nativeElement;
    afterNextRender(() => {
      const bar = this.topBar().nativeElement;
      const observer = new ResizeObserver(() => {
        this.topBarBottom.set(bar.getBoundingClientRect().bottom);
        this.screenHeight.set(host.clientHeight);
      });
      observer.observe(bar);
      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    });

    // The sheet opens fully, as designed, where it then stays below the recenter button's place
    // in the design. On a shorter phone that would leave little map, so it opens halfway, the
    // rest a drag or a scroll away.
    let opened = false;
    effect(() => {
      if (this.store.phase() !== 'ready' || opened) return;
      opened = true;
      afterNextRender(
        () => {
          const sheet = this.sheetEl()?.nativeElement;
          const room = host.clientHeight - MAP_KEPT;
          if (sheet && sheet.offsetHeight > room) this.sheetSnap.set('half');
        },
        { injector: this.injector },
      );
    });

    // Join the order's group, then read the order (docs/realtime.md, "Recovery").
    const hub = new LiveHub({
      token: async () => (await this.session.signIn('Customer')).token,
      onConnect: async (connection) => {
        const code = this.displayCode();
        this.store.holdMessages();
        try {
          await connection.invoke('JoinOrder', code);
        } catch (error) {
          // Not this customer's order, or none: the read says so too, and the page shows it.
          const notFound =
            error instanceof Error && error.message.endsWith('HubException: not_found');
          if (!notFound) throw error;
        }
        await this.store.load(code);
        if (this.store.phase() === 'not-found') void hub.stop();
      },
      onUnauthorized: () => this.session.expire(),
    });
    hub.on('order:changed', (order: OrderDetails, at: string) =>
      this.store.onOrderChanged(order, at),
    );
    hub.on('rider:position', (position: RiderPosition) => this.store.onPosition(position));
    hub.on('eta:changed', (eta: EtaChanged) => this.store.onEtaChanged(eta));
    // Sign in first, so the order request carries the token.
    void this.session.signIn('Customer').then(
      () => hub.start(),
      () => {
        this.store.failed.set(true);
        void hub.start();
      },
    );
    destroyRef.onDestroy(() => void hub.stop());

    // Track how long the connection has been gone. With no connection at all, the order is
    // still read once, so the customer sees where it was.
    effect(() => {
      const state = hub.state();
      untracked(() => {
        if (state === 'live') this.lostAt.set(null);
        else if (state !== 'connecting' && this.lostAt() === null) {
          this.lostAt.set(performance.now());
        }
        if (state === 'offline' && this.store.phase() === 'loading' && !this.store.failed()) {
          void this.store.load(this.displayCode());
        }
      });
    });

    // Say the key changes once, politely.
    let heard: Heard | null = null;
    effect(() => {
      const order = this.order();
      if (!order) return;
      const now: Heard = {
        status: order.status,
        minutes: afterPickup(order)
          ? etaMinutes(order.estimatedDeliveryAt, this.store.now())
          : null,
      };
      untracked(() => {
        const text = announcement(heard, now);
        heard = now;
        if (text) this.announced.set(text);
      });
    });

    // A rating given earlier in this tab stays.
    effect(() => {
      const saved = sessionStorage.getItem(this.ratingKey());
      untracked(() => this.rating.set(saved ? Number(saved) : null));
    });
  }

  /** Back to where the customer came from, or to a new order when they opened the link. */
  protected back(): void {
    const opened = (history.state as { navigationId?: number } | null)?.navigationId ?? 1;
    if (opened > 1) this.location.back();
    else void this.router.navigate(['/order']);
  }

  protected retry(): void {
    void this.store.load(this.displayCode());
  }

  /**
   * Details opens the order's lines under the summary. The sheet keeps its height, as the map
   * keeps its room, and the lines scroll into view in it.
   */
  protected toggleDetails(): void {
    const open = !this.detailsOpen();
    this.sheetLock.set(open ? (this.sheetEl()?.nativeElement.offsetHeight ?? null) : null);
    this.detailsOpen.set(open);
    if (!open) return;
    afterNextRender(
      () =>
        this.detailsEl()?.nativeElement.scrollIntoView({
          block: 'nearest',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        }),
      { injector: this.injector },
    );
  }

  protected toggleHelp(): void {
    if (this.helpOpen()) {
      this.closeHelp(true);
      return;
    }
    this.helpOpen.set(true);
    afterNextRender(
      () => this.helpPanel()?.nativeElement.querySelector<HTMLElement>('a, button')?.focus(),
      { injector: this.injector },
    );
  }

  /** Esc, the close button or a tap outside; focus goes back to Get help when it was inside. */
  protected closeHelp(restoreFocus: boolean): void {
    if (!this.helpOpen()) return;
    const inside = this.helpPanel()?.nativeElement.contains(document.activeElement);
    this.helpOpen.set(false);
    if (restoreFocus && inside) this.helpButton().nativeElement.focus();
  }

  protected pointerDown(event: PointerEvent): void {
    if (!this.helpOpen()) return;
    const target = event.target as Node | null;
    const panel = this.helpPanel()?.nativeElement;
    if (target && (panel?.contains(target) || this.helpButton().nativeElement.contains(target))) {
      return;
    }
    this.closeHelp(false);
  }

  protected rate(stars: number): void {
    this.rating.set(stars);
    sessionStorage.setItem(this.ratingKey(), String(stars));
  }

  protected tel(phone: string): string {
    return `tel:${phone.replace(/[^\d+]/g, '')}`;
  }

  protected sms(phone: string): string {
    return `sms:${phone.replace(/[^\d+]/g, '')}`;
  }

  private readonly ratingKey = computed(() => `dispatchly.rating.${this.displayCode()}`);
}
