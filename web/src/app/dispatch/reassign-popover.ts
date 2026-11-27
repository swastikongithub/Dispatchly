import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, problemOf, type Api } from '../core/api/api-client';
import { Avatar, Button } from '../ui';
import { prefersReducedMotion } from '../ui/motion';
import { km } from './queue';

type Candidate = Api['ReassignCandidate'];

/** The widest search radius, which reassignment uses (PLAN.md §3.5). */
const WIDEST_RADIUS_M = 5_000;

/**
 * Reassign confirmation (PLAN.md §5.2): the next nearest free riders with their distance from the
 * restaurant, then a confirm that sends the order to the first of them. Not in the designs, so it
 * is built from the panel, avatar and buttons only (§5.5).
 */
@Component({
  selector: 'app-reassign-popover',
  imports: [Avatar, Button],
  template: `
    <h3 class="title" [id]="titleId">Reassign order #{{ code() }}?</h3>
    @switch (phase()) {
      @case ('loading') {
        <p class="lead ui-skeleton">It goes to the nearest free rider.</p>
        <ul aria-hidden="true">
          @for (row of placeholders; track row) {
            <li>
              <ui-avatar name="Rider" size="sm" [loading]="true" />
              <span class="who ui-skeleton">Rider name</span>
              <span class="distance ui-skeleton">0.0 km</span>
            </li>
          }
        </ul>
      }
      @case ('ready') {
        @if (candidates().length) {
          <p class="lead">It goes to the nearest free rider.</p>
          <ul>
            @for (rider of candidates(); track rider.riderId; let first = $first) {
              <li [class.next]="first">
                <ui-avatar [name]="rider.name" size="sm" aria-hidden="true" />
                <span class="who">
                  <span class="name">{{ rider.name }}</span>
                  <span class="vehicle">{{ rider.vehicle }} · {{ rider.plate }}</span>
                </span>
                <span class="distance">{{ distance(rider) }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="lead">{{ noneFree }}</p>
        }
      }
      @case ('error') {
        <p class="lead" role="alert">{{ error() }}</p>
      }
    }
    <div class="actions">
      <button type="button" uiButton="secondary" (click)="closed.emit()">Cancel</button>
      @if (phase() !== 'error' && (phase() === 'loading' || candidates().length)) {
        <button
          #confirm
          type="button"
          uiButton="primary"
          [loading]="phase() === 'loading' || sending()"
          (click)="send()"
        >
          {{ confirmLabel() }}
        </button>
      }
    </div>
  `,
  host: {
    class: 'ui-panel',
    role: 'dialog',
    '[attr.aria-labelledby]': 'titleId',
    '(keydown.escape)': 'onEscape($event)',
  },
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-12);
      padding: var(--spacing-18);
    }
    .title {
      margin: 0;
      font-size: var(--text-spec);
      font-weight: var(--font-weight-semibold);
      font-variant-numeric: tabular-nums;
    }
    .lead {
      margin: 0;
      width: fit-content;
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--spacing-10);
      padding: var(--spacing-8) 0;
      border-bottom: var(--border-width-hairline) solid var(--ui-divider);
    }
    li:last-child {
      border-bottom: 0;
    }
    .who {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      font-size: var(--text-ui);
    }
    .name {
      font-weight: var(--font-weight-semibold);
    }
    .next .name {
      color: var(--ui-accent-text);
    }
    .vehicle {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .distance {
      font-size: var(--text-meta);
      color: var(--ui-text-secondary);
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
export class ReassignPopover {
  private readonly api = inject(ApiClient);
  private readonly injector = inject(Injector);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  readonly code = input.required<string>();
  readonly closed = output<void>();
  /** The order went to another rider; the live update brings the change. */
  readonly reassigned = output<Api['OrderDetails']>();

  protected readonly titleId = `reassign-${Math.random().toString(36).slice(2)}`;
  protected readonly placeholders = [0, 1, 2];
  protected readonly noneFree = `No other free rider within ${km(WIDEST_RADIUS_M)}.`;
  protected readonly phase = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly candidates = signal<readonly Candidate[]>([]);
  protected readonly error = signal('');
  protected readonly sending = signal(false);
  protected readonly confirmLabel = computed(() => {
    const next = this.candidates()[0];
    return next ? `Reassign to ${next.name.split(' ')[0]}` : 'Reassign';
  });

  constructor() {
    afterNextRender(() => {
      this.host.querySelector<HTMLElement>('button')?.focus();
      void this.load();
    });
  }

  protected distance(rider: Candidate): string {
    return km(rider.distanceMeters);
  }

  protected onEscape(event: Event): void {
    // Esc closes this first; the rider card stays open.
    event.stopPropagation();
    this.closed.emit();
  }

  protected async send(): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    try {
      const order = await firstValueFrom(
        this.api.post('/api/v1/orders/{code}/reassign', { path: { code: this.code() } }),
      );
      this.reassigned.emit(order);
    } catch (error) {
      this.fail(error);
    } finally {
      this.sending.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const candidates = await firstValueFrom(
        this.api.get('/api/v1/orders/{code}/reassign/candidates', { path: { code: this.code() } }),
      );
      this.candidates.set(candidates);
      this.phase.set('ready');
    } catch (error) {
      this.fail(error);
    }
    this.reveal();
  }

  /**
   * Brings the whole confirmation into view once it has its final height. In the phone sheet the
   * loaded riders push the buttons down, below the fold.
   */
  private reveal(): void {
    afterNextRender(
      () =>
        this.host.scrollIntoView({
          block: 'nearest',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        }),
      { injector: this.injector },
    );
  }

  private fail(error: unknown): void {
    const code = problemOf(error)?.code;
    this.error.set(
      code === 'no_free_rider'
        ? this.noneFree
        : code === 'order_not_reassignable'
          ? 'This order has been picked up, so it stays with its rider.'
          : 'Couldn’t reach the server. Try again in a moment.',
    );
    this.phase.set('error');
  }
}
