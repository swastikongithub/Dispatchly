import { Component, computed, inject, output, signal, viewChild } from '@angular/core';
import { LucideArrowRight } from '@lucide/angular';
import { Chip, SearchField, type ChipTone } from '../ui';
import { DispatchStore } from './dispatch-store';
import { chipOf } from './queue';
import { lngLat, type LngLat } from './route-geometry';

interface Result {
  id: string;
  group: 'Riders' | 'Orders' | 'Places';
  title: string;
  /** Orders show "restaurant → area" with the arrow icon. */
  from?: string;
  detail: string;
  chip?: { tone: ChipTone; label: string };
  pick: () => void;
}

const PER_GROUP = 4;

/**
 * Search (PLAN.md §5.2, `/` or Ctrl K / ⌘K): riders, orders and places as you type; ↑ / ↓ and
 * Enter fly to the result. A combobox over the top bar's search field; the results list is not
 * in the designs, so it reuses the panel, chip and order-row type styles (§5.5).
 */
@Component({
  selector: 'app-search-palette',
  imports: [SearchField, Chip, LucideArrowRight],
  template: `
    <ui-search-field
      [(value)]="query"
      [combobox]="true"
      [expanded]="open()"
      [controls]="listId"
      [activeDescendant]="activeId()"
      (keydown)="onKey($event)"
      (focusin)="focused.set(true)"
      (focusout)="onFocusOut($event)"
    />
    @if (open()) {
      <div class="results ui-panel">
        <ul [id]="listId" role="listbox" aria-label="Search results">
          @for (result of results(); track result.id; let i = $index) {
            @if (i === 0 || results()[i - 1].group !== result.group) {
              <li class="group" role="presentation">{{ result.group }}</li>
            }
            <li
              role="option"
              [id]="optionId(i)"
              [attr.aria-selected]="i === active()"
              (pointerdown)="$event.preventDefault()"
              (click)="pick(result)"
              (pointermove)="active.set(i)"
            >
              <span class="line">
                <span class="title">{{ result.title }}</span>
                @if (result.chip; as chip) {
                  <ui-chip [tone]="chip.tone" size="sm">{{ chip.label }}</ui-chip>
                }
              </span>
              <span class="detail">
                @if (result.from) {
                  {{ result.from }}
                  <svg lucideArrowRight class="arrow" aria-hidden="true"></svg
                  ><span class="sr-only">to</span>
                }
                {{ result.detail }}
              </span>
            </li>
          } @empty {
            <li class="none" role="presentation">Nothing matches “{{ query().trim() }}”.</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .results {
      position: absolute;
      top: calc(100% + var(--spacing-8));
      left: 0;
      right: 0;
      z-index: 2;
      padding: var(--spacing-6);
      max-height: min(70vh, calc(100dvh - var(--spacing-120)));
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .group {
      padding: var(--spacing-10) var(--spacing-10) var(--spacing-4);
      font-size: var(--text-caption);
      font-weight: var(--font-weight-semibold);
      color: var(--ui-text-secondary);
    }
    [role='option'] {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      padding: var(--spacing-10);
      border-radius: var(--radius-control);
      cursor: pointer;
    }
    [role='option'][aria-selected='true'] {
      background: var(--ui-selected);
    }
    .line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-8);
    }
    .title {
      font-size: var(--text-ui);
      font-weight: var(--font-weight-semibold);
      font-variant-numeric: tabular-nums;
    }
    .detail,
    .none {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .none {
      padding: var(--spacing-10);
    }
    .arrow {
      display: inline-block;
      width: var(--icon-size-14);
      height: var(--icon-size-14);
      vertical-align: middle;
    }
  `,
})
export class SearchPalette {
  private readonly store = inject(DispatchStore);

  /** A place was picked: fly the map there. */
  readonly place = output<LngLat>();

  protected readonly listId = `search-${Math.random().toString(36).slice(2)}`;
  protected readonly query = signal('');
  protected readonly focused = signal(false);
  protected readonly active = signal(0);
  protected readonly open = computed(() => this.focused() && this.query().trim().length > 0);

  private readonly field = viewChild.required(SearchField);

  protected readonly results = computed<Result[]>(() => {
    const words = this.query().trim().toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const matches = (...texts: (string | null | undefined)[]) => {
      const text = texts.filter(Boolean).join(' ').toLowerCase();
      return words.every((word) => text.includes(word));
    };

    const riders: Result[] = [];
    const orderOf = this.store.orderOfRider();
    for (const rider of this.store.riders().values()) {
      if (riders.length === PER_GROUP) break;
      if (!matches(rider.name, rider.plate)) continue;
      const order = orderOf.get(rider.id);
      riders.push({
        id: `rider-${rider.id}`,
        group: 'Riders',
        title: rider.name,
        detail: `${rider.vehicle} · ${rider.plate}`,
        chip: order ? chipOf(order) : { tone: 'available', label: 'Available' },
        pick: () => this.store.selectRider(rider.id),
      });
    }

    const orders: Result[] = [];
    for (const { order, state } of this.store.queue()) {
      if (orders.length === PER_GROUP) break;
      if (state !== 'active') continue;
      if (!matches(order.code, order.restaurantName, order.dropArea, order.riderName)) continue;
      orders.push({
        id: `order-${order.code}`,
        group: 'Orders',
        title: `#${order.code}`,
        from: order.restaurantName,
        detail: order.dropArea,
        chip: chipOf(order),
        pick: () => this.store.selectOrder(order.code),
      });
    }

    // Places: the areas the city's restaurants are in, flown to at their middle.
    const areas = new Map<string, LngLat[]>();
    for (const restaurant of this.store.restaurants()) {
      if (!matches(restaurant.area)) continue;
      const points = areas.get(restaurant.area) ?? [];
      points.push(lngLat(restaurant.location));
      areas.set(restaurant.area, points);
    }
    const places: Result[] = [...areas]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, PER_GROUP)
      .map(([area, points]) => ({
        id: `place-${area}`,
        group: 'Places',
        title: area,
        detail: `${points.length} ${points.length === 1 ? 'restaurant' : 'restaurants'}`,
        pick: () => this.place.emit(middle(points)),
      }));

    return [...riders, ...orders, ...places];
  });

  protected readonly activeId = computed(() =>
    this.open() && this.results().length ? this.optionId(this.active()) : null,
  );

  focus(): void {
    this.field().focus();
  }

  protected optionId(index: number): string {
    return `${this.listId}-${index}`;
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (!count) return;
        event.preventDefault();
        this.active.set((this.active() + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
        this.scrollActive();
        break;
      case 'Enter': {
        const result = this.results()[this.active()];
        if (result) {
          event.preventDefault();
          this.pick(result);
        }
        break;
      }
      case 'Escape':
        // Esc clears the search first; the rider card stays open.
        event.stopPropagation();
        if (this.query()) this.query.set('');
        else this.field().blur();
        break;
      default:
        // Typing starts again from the top result.
        if (event.key.length === 1 || event.key === 'Backspace') this.active.set(0);
    }
  }

  protected onFocusOut(event: FocusEvent): void {
    const host = (event.currentTarget as HTMLElement).parentElement;
    if (!host?.contains(event.relatedTarget as Node | null)) this.focused.set(false);
  }

  protected pick(result: Result): void {
    result.pick();
    this.query.set('');
    this.active.set(0);
  }

  private scrollActive(): void {
    queueMicrotask(() =>
      document.getElementById(this.optionId(this.active()))?.scrollIntoView({ block: 'nearest' }),
    );
  }
}

function middle(points: readonly LngLat[]): LngLat {
  const sum = points.reduce(([x, y], [a, b]) => [x + a, y + b], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}
