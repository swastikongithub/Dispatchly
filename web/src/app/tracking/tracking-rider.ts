import { Component, computed, input } from '@angular/core';
import { LucideMessageCircle, LucidePhone } from '@lucide/angular';
import { Avatar, IconButton } from '../ui';
import { callLink, firstName, messageLink, type OrderDetails } from './tracking-flow';

type Rider = NonNullable<OrderDetails['rider']>;

/**
 * The rider on the tracking sheet (designs/html/tracking.html): avatar, name, vehicle and plate,
 * then Call and Message with their number (PLAN.md §11.7). Until the order loads, it's a
 * placeholder of the same size.
 */
@Component({
  selector: 'app-tracking-rider',
  imports: [Avatar, IconButton, LucideMessageCircle, LucidePhone],
  template: `
    @if (rider(); as rider) {
      <ui-avatar [name]="rider.name" aria-hidden="true" />
      <div class="who">
        <div class="name">{{ rider.name }}</div>
        <div class="vehicle" [attr.title]="rider.vehicle + ' · ' + rider.plate">
          {{ rider.vehicle }} · {{ rider.plate }}
        </div>
      </div>
      @if (rider.phone; as phone) {
        <a uiIconButton="outline" [href]="callLink(phone)" [attr.aria-label]="'Call ' + first()">
          <svg lucidePhone aria-hidden="true"></svg>
        </a>
        <a
          uiIconButton="outline"
          [href]="messageLink(phone)"
          [attr.aria-label]="'Message ' + first()"
        >
          <svg lucideMessageCircle aria-hidden="true"></svg>
        </a>
      }
    } @else {
      <ui-avatar name="Rider" [loading]="true" />
      <div class="who">
        <div class="name ui-skeleton">Aman Verma</div>
        <div class="vehicle ui-skeleton">Honda Activa · DL 3S CK 2041</div>
      </div>
    }
  `,
  host: { '[attr.aria-hidden]': 'rider() ? null : "true"' },
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--spacing-12);
      background: var(--ui-raised);
      border-radius: var(--radius-panel);
      padding: var(--spacing-12);
    }
    .who {
      flex: 1;
      min-width: 0;
    }
    .name {
      font-size: var(--text-body);
      font-weight: var(--font-weight-semibold);
      width: fit-content;
    }
    /* One line with an ellipsis; the full text is in its title (PLAN.md §11.3). */
    .vehicle {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: fit-content;
    }
  `,
})
export class TrackingRider {
  /** The order's rider, or null while the order loads. */
  readonly rider = input.required<Rider | null>();

  protected readonly first = computed(() => firstName(this.rider()?.name ?? ''));
  protected readonly callLink = callLink;
  protected readonly messageLink = messageLink;
}
