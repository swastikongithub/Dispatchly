import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LucideListFilter } from '@lucide/angular';
import { tokens } from '../tokens';
import { Button, IconButton, OrderRow, Segmented, type SegmentOption } from '../ui';
import { prefersReducedMotion } from '../ui/motion';
import { DispatchStore, type QueueEntry } from './dispatch-store';
import { chipOf, inTab, metaOf, type QueueTab } from './queue';

/** Rows shown before "Show all N orders", as in the design. */
const COLLAPSED_ROWS = 6;
const ms = (duration: string) => parseFloat(duration);

const EMPTY: Record<QueueTab, string> = {
  all: 'No active orders right now.',
  'needs-rider': 'Nothing needs a rider right now.',
  late: 'Nothing is running late right now.',
};

/**
 * The order queue (PLAN.md §5.2): tabs with live counts, rows in queue order. New rows slide in
 * from the top and highlight; the rest glide to their new places (FLIP, 280 ms); delivered rows
 * show for 3 s, then fade and the list closes up.
 */
@Component({
  selector: 'app-orders-panel',
  imports: [Button, IconButton, OrderRow, Segmented, LucideListFilter],
  template: `
    <div class="head">
      <h2 class="title">
        Orders
        <span class="count" [class.ui-skeleton]="loading()">{{ counts().all }} active</span>
      </h2>
      <button
        type="button"
        uiIconButton="raised"
        shape="square"
        aria-label="Filter orders"
        (click)="filter.emit()"
      >
        <svg lucideListFilter aria-hidden="true"></svg>
      </button>
    </div>
    <ui-segmented
      class="tabs"
      label="Filter orders"
      [options]="tabs()"
      [disabled]="loading()"
      [value]="tab()"
      (valueChange)="setTab($event)"
    />
    @if (store.failed()) {
      <p class="notice" role="alert">
        Couldn’t load the orders.
        <button type="button" uiButton="menu" (click)="retry()">Try again</button>
      </p>
    }
    <ul #list class="rows" [class.expanded]="expanded()" aria-label="Order queue">
      @if (loading()) {
        @for (row of skeletonRows; track row) {
          <li
            uiOrderRow
            [loading]="true"
            orderId="#DL-0000"
            chipTone="accent"
            chipLabel="On the way"
            from="Restaurant, Area"
            to="Drop area"
            metaStart="Rider name"
            metaEnd="0 min"
          ></li>
        }
      } @else {
        @for (entry of visible(); track entry.order.code) {
          <li
            uiOrderRow
            [attr.data-code]="entry.order.code"
            [attr.data-state]="entry.state"
            [orderId]="'#' + entry.order.code"
            [chipTone]="chip(entry).tone"
            [chipLabel]="chip(entry).label"
            [from]="entry.order.restaurantName + ', ' + entry.order.restaurantArea"
            [to]="entry.order.dropArea"
            [metaStart]="meta(entry).start"
            [metaEnd]="meta(entry).end"
            [metaEndTone]="meta(entry).tone"
            [selected]="entry.order.code === selectedCode()"
            [highlight]="entry.fresh"
            (select)="store.selectOrder(entry.order.code)"
          ></li>
        } @empty {
          @if (!store.failed()) {
            <li class="empty">{{ empty() }}</li>
          }
        }
      }
    </ul>
    @if (!loading() && !expanded() && filtered().length > collapsedRows) {
      <button type="button" class="show-all" (click)="expand()">
        Show all {{ filtered().length }} orders
      </button>
    }
  `,
  host: {
    class: 'ui-panel',
    role: 'region',
    'aria-label': 'Orders',
    '[attr.aria-busy]': 'loading() || null',
  },
  styles: `
    :host {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding: var(--spacing-16) var(--spacing-12) var(--spacing-12);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--spacing-4);
    }
    .title {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-panel-title);
      font-weight: var(--text-panel-title--font-weight);
      letter-spacing: var(--text-panel-title--letter-spacing);
    }
    .count {
      font-family: var(--font-text);
      font-size: var(--text-ui);
      font-weight: var(--font-weight-medium);
      letter-spacing: normal;
      color: var(--ui-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .tabs {
      margin: var(--spacing-14) var(--spacing-4) var(--spacing-8);
    }
    /* Rows that don't fit are clipped (collapsed) or scroll (expanded). The list keeps room
       for the focus ring around its rows. */
    .rows {
      flex: 0 1 auto;
      list-style: none;
      min-height: 0;
      overflow: hidden;
      --ring: calc(var(--focus-width) + var(--focus-offset));
      margin: calc(var(--ring) * -1);
      padding: var(--ring);
    }
    .rows.expanded {
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    /* A delivered row fades before it goes (PLAN.md §6.3). */
    .rows > [data-state='leaving'] {
      opacity: 0;
      transition: opacity var(--duration-base) var(--ease-exit);
    }
    .empty {
      padding: var(--spacing-11) var(--spacing-6);
      font-size: var(--text-ui);
      color: var(--ui-text-secondary);
    }
    .notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-8);
      margin: 0 var(--spacing-4) var(--spacing-8);
      font-size: var(--text-ui);
      color: var(--ui-text-secondary);
    }
    .show-all {
      align-self: flex-start;
      margin-top: var(--spacing-6);
      padding: var(--spacing-10) var(--spacing-6) var(--spacing-4);
      border: 0;
      background: transparent;
      color: var(--ui-accent-text);
      font: inherit;
      font-size: var(--text-ui);
      font-weight: var(--font-weight-semibold);
      cursor: pointer;
      border-radius: var(--radius-tab);
      transition: opacity var(--duration-fast) var(--ease-standard);
    }
    .show-all:hover {
      opacity: var(--opacity-link-hover);
    }
    .show-all:active {
      transform: scale(var(--scale-press));
    }
  `,
})
export class OrdersPanel {
  protected readonly store = inject(DispatchStore);

  /** The filter button: the dashboard opens search for orders. */
  readonly filter = output<void>();

  protected readonly collapsedRows = COLLAPSED_ROWS;
  protected readonly skeletonRows = Array.from({ length: COLLAPSED_ROWS }, (_, i) => i);
  protected readonly tab = signal<QueueTab>('all');
  protected readonly expanded = signal(false);
  protected readonly loading = computed(() => this.store.phase() === 'loading');
  protected readonly counts = this.store.counts;
  protected readonly selectedCode = computed(() => this.store.selection()?.code ?? null);
  protected readonly empty = computed(() => EMPTY[this.tab()]);

  protected readonly tabs = computed<SegmentOption[]>(() => {
    const counts = this.counts();
    const loading = this.loading();
    const label = (name: string, count: number) => (loading ? name : `${name} ${count}`);
    return [
      { value: 'all', label: label('All', counts.all) },
      { value: 'needs-rider', label: label('Needs rider', counts['needs-rider']) },
      { value: 'late', label: label('Late', counts.late) },
    ];
  });

  /** The tab's rows; rows on their way out stay where they were until they've gone. */
  protected readonly filtered = computed(() => {
    const tab = this.tab();
    return this.store.queue().filter((e) => e.state !== 'active' || inTab(e.order, tab));
  });

  protected readonly visible = computed(() =>
    this.expanded() ? this.filtered() : this.filtered().slice(0, COLLAPSED_ROWS),
  );

  private readonly list = viewChild<ElementRef<HTMLUListElement>>('list');
  /** A new tab or the full list is a different view, not live movement: it doesn't animate. */
  private skipFlip = false;

  constructor() {
    // FLIP (PLAN.md §6.3): note where each row is before the list changes, then glide it from
    // there to where it lands. New rows slide in from the top.
    let first = new Map<string, number>();
    effect(() => {
      this.visible();
      untracked(() => (first = this.positions()));
    });
    afterRenderEffect(() => {
      this.visible();
      const before = first;
      untracked(() => this.play(before));
    });
  }

  protected setTab(value: string): void {
    this.skipFlip = true;
    this.tab.set(value as QueueTab);
    this.expanded.set(false);
  }

  protected expand(): void {
    this.skipFlip = true;
    this.expanded.set(true);
  }

  protected chip(entry: QueueEntry) {
    return chipOf(entry.order);
  }

  protected meta(entry: QueueEntry) {
    return metaOf(entry.order, this.store.now());
  }

  protected retry(): void {
    this.store.loadSnapshot().catch(() => {});
  }

  /** Moves keyboard focus to the next or previous row (↑ / ↓ on the dashboard). */
  focusRow(step: 1 | -1): void {
    const buttons = [...(this.list()?.nativeElement.querySelectorAll('li > button') ?? [])];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as Element);
    const next =
      current === -1
        ? step === 1
          ? 0
          : buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, current + step));
    (buttons[next] as HTMLElement).focus();
  }

  private rows(): HTMLElement[] {
    return [...(this.list()?.nativeElement.querySelectorAll<HTMLElement>('li[data-code]') ?? [])];
  }

  private positions(): Map<string, number> {
    return new Map(
      this.rows().map((row) => [row.dataset['code']!, row.getBoundingClientRect().top]),
    );
  }

  private play(before: Map<string, number>): void {
    if (this.skipFlip) {
      this.skipFlip = false;
      return;
    }
    if (before.size === 0 || prefersReducedMotion()) return;
    const duration = ms(tokens.motion.duration.panel);
    const easing = tokens.motion.easing.enter;
    for (const row of this.rows()) {
      const was = before.get(row.dataset['code']!);
      const top = row.getBoundingClientRect().top;
      if (was === undefined) {
        row.animate(
          [
            { transform: `translateY(-${row.offsetHeight}px)`, opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration, easing },
        );
      } else if (Math.abs(was - top) > 0.5) {
        row.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], {
          duration,
          easing,
        });
      }
    }
  }
}
