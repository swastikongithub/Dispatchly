import { Component, input, output } from '@angular/core';
import { LucideArrowLeftRight, LucidePhone, LucideX } from '@lucide/angular';
import { Avatar } from './avatar';
import { Button } from './button';
import { Chip, ChipTone } from './chip';
import { Eta } from './eta';
import { IconButton } from './icon-button';
import { Progress } from './progress';
import { Timeline, TimelineStep } from './timeline';

export interface RiderCardData {
  name: string;
  vehicle: string;
  chipTone: ChipTone;
  chipLabel: string;
  orderId: string;
  eta: string;
  destination: string;
  arrival: string;
  remaining: string;
  /** 0 to 1. */
  progress: number;
  steps: readonly TimelineStep[];
  deliveriesToday: string;
  online: string;
}

/**
 * Selected rider card: avatar, name, vehicle + plate, chip, big ETA, progress bar, timeline,
 * stats and two actions. The vehicle line truncates to one line with the full text in title
 * (PLAN.md §11.3); the full text stays in the DOM for screen readers.
 */
@Component({
  selector: 'ui-rider-card',
  imports: [
    Avatar,
    Button,
    Chip,
    Eta,
    IconButton,
    Progress,
    Timeline,
    LucidePhone,
    LucideArrowLeftRight,
    LucideX,
  ],
  template: `
    <div class="head">
      <ui-avatar [name]="rider().name" [loading]="loading()" aria-hidden="true" />
      <div class="who">
        <div class="name" [class.ui-skeleton]="loading()">{{ rider().name }}</div>
        <div class="vehicle" [class.ui-skeleton]="loading()" [attr.title]="rider().vehicle">
          {{ rider().vehicle }}
        </div>
      </div>
      <button
        type="button"
        uiIconButton="raised"
        aria-label="Close rider details"
        (click)="close.emit()"
      >
        <svg lucideX aria-hidden="true"></svg>
      </button>
    </div>
    <div class="order">
      @if (loading()) {
        <span class="ui-skeleton chip-placeholder">On the way</span>
      } @else {
        <ui-chip [tone]="rider().chipTone" size="md">{{ rider().chipLabel }}</ui-chip>
      }
      <span [class.ui-skeleton]="loading()">Order {{ rider().orderId }}</span>
    </div>
    <ui-eta
      variant="panel"
      [value]="rider().eta"
      [sub]="'to ' + rider().destination"
      [time]="rider().arrival"
      [distance]="rider().remaining"
      [loading]="loading()"
    />
    <ui-progress [value]="loading() ? 0 : rider().progress" label="Delivery progress" />
    <ui-timeline [steps]="rider().steps" [loading]="loading()" />
    <div class="stats">
      <span [class.ui-skeleton]="loading()">{{ rider().deliveriesToday }}</span>
      <span [class.ui-skeleton]="loading()">{{ rider().online }}</span>
    </div>
    <div class="actions">
      <button type="button" uiButton="secondary" [loading]="loading()" (click)="call.emit()">
        <svg lucidePhone aria-hidden="true"></svg>Call rider
      </button>
      <button
        type="button"
        uiButton="secondary"
        [loading]="loading() || reassigning()"
        (click)="reassign.emit()"
      >
        <svg lucideArrowLeftRight aria-hidden="true"></svg>Reassign
      </button>
    </div>
  `,
  host: {
    class: 'ui-panel',
    role: 'complementary',
    'aria-label': 'Selected rider',
    '[attr.aria-busy]': 'loading() || null',
  },
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-16);
      padding: var(--spacing-18);
      min-width: 0;
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--spacing-12);
    }
    .who {
      flex: 1;
      min-width: 0;
    }
    .name {
      font-size: var(--text-spec);
      font-weight: var(--font-weight-semibold);
      width: fit-content;
    }
    .vehicle {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: fit-content;
    }
    .order {
      display: flex;
      align-items: center;
      gap: var(--spacing-10);
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .chip-placeholder {
      font-size: var(--text-caption);
      padding: var(--spacing-3) var(--spacing-9);
      border-radius: var(--radius-pill);
    }
    .stats {
      display: flex;
      justify-content: space-between;
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      border-top: var(--border-width-hairline) solid var(--ui-divider);
      padding-top: var(--spacing-14);
      font-variant-numeric: tabular-nums;
    }
    .actions {
      display: flex;
      gap: var(--spacing-8);
    }
    .actions button {
      flex: 1;
    }
  `,
})
export class RiderCard {
  readonly rider = input.required<RiderCardData>();
  readonly loading = input(false);
  readonly reassigning = input(false);
  readonly close = output<void>();
  readonly call = output<void>();
  readonly reassign = output<void>();
}
