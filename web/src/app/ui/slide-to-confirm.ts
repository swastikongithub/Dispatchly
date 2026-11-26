import {
  afterRenderEffect,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideArrowRight, LucideCheck } from '@lucide/angular';
import { tokens } from '../tokens';
import { ms, prefersReducedMotion, spring, springs } from './motion';

const threshold = tokens.motion.threshold.slideToConfirm;
const holdDuration = ms(tokens.motion.duration.holdToConfirm);

/**
 * Slide to confirm: 64px track, 54px orange knob, chevron hint. Fires at 85% of the travel and
 * springs back otherwise. Keyboard: hold Enter or Space for 600 ms. Assistive technology can
 * activate it directly. Emits `confirm` once; call `reset()` to use it again.
 */
@Component({
  selector: 'ui-slide-to-confirm',
  imports: [LucideArrowRight, LucideCheck],
  template: `
    <button
      #track
      type="button"
      class="track"
      [disabled]="disabled()"
      [attr.aria-busy]="loading() || null"
      [attr.data-state]="state()"
      [attr.data-confirmed]="confirmed() || null"
      [style.--progress]="progress()"
      (keydown)="onKeyDown($event)"
      (keyup)="onKeyUp($event)"
      (blur)="cancelHold()"
      (click)="onClick($event)"
    >
      <span class="knob" [class.grabbing]="grabbing()" (pointerdown)="startDrag($event)">
        @if (confirmed()) {
          <svg lucideCheck class="check" [strokeWidth]="strokeHeavy" aria-hidden="true"></svg>
        } @else {
          <svg lucideArrowRight [strokeWidth]="strokeHeavy" aria-hidden="true"></svg>
        }
      </span>
      <span class="label">{{ label() }}</span>
      <svg class="hint" viewBox="0 0 28 16" aria-hidden="true">
        <path d="M3 3l5 5-5 5M12 3l5 5-5 5M21 3l5 5-5 5" />
      </svg>
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    .track {
      position: relative;
      box-sizing: border-box;
      width: 100%;
      height: var(--spacing-slide-track);
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border: var(--border-width-hairline) solid var(--ui-kbd-border);
      border-radius: var(--radius-slide-track);
      background: var(--ui-raised-strong);
      color: var(--ui-text-primary);
      font: inherit;
      font-size: var(--text-body);
      font-weight: var(--font-weight-semibold);
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: background-color var(--duration-fast) var(--ease-standard);
    }
    .track:hover:not(:disabled),
    .track[data-state='hover'] {
      background: var(--ui-raised-hover);
    }
    .track[data-state='focus'] {
      outline: var(--focus-width) solid var(--ui-focus);
      outline-offset: var(--focus-offset);
    }
    .knob {
      position: absolute;
      left: var(--spacing-slide-thumb-inset);
      top: var(--spacing-slide-thumb-inset);
      width: var(--spacing-slide-thumb);
      height: var(--spacing-slide-thumb);
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-circle);
      background: var(--ui-accent);
      color: var(--ui-on-accent);
      transform: translateX(var(--x, 0px));
      touch-action: none;
      cursor: grab;
    }
    .knob svg {
      width: var(--icon-size-22);
      height: var(--icon-size-22);
      transition: transform var(--duration-instant) var(--ease-standard);
    }
    .knob.grabbing,
    .track[data-state='pressed'] .knob {
      cursor: grabbing;
    }
    .knob.grabbing svg,
    .track[data-state='pressed'] .knob svg {
      transform: scale(var(--scale-press));
    }
    .check {
      animation: check-in var(--duration-success-check) var(--ease-enter);
    }
    @keyframes check-in {
      from {
        opacity: 0;
      }
    }
    .label,
    .hint {
      opacity: calc(1 - var(--progress, 0));
    }
    .hint {
      position: absolute;
      right: var(--spacing-slide-hint-right);
      top: var(--spacing-slide-hint-top);
      width: var(--spacing-slide-hint-width);
      height: var(--spacing-slide-hint-height);
      fill: none;
      stroke: var(--ui-slide-hint);
      stroke-width: var(--icon-stroke);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .track:disabled {
      color: var(--ui-text-disabled);
      cursor: not-allowed;
    }
    .track:disabled .knob {
      background: var(--ui-track);
      color: var(--ui-text-disabled);
      cursor: not-allowed;
    }
    .track[aria-busy='true'] {
      cursor: progress;
      pointer-events: none;
    }
  `,
})
export class SlideToConfirm {
  readonly label = input.required<string>();
  readonly disabled = input(false);
  /** True while the confirmed action is being saved. */
  readonly loading = input(false);
  /** Styleguide only: force a visual state. */
  readonly state = input<'hover' | 'pressed' | 'focus' | null>(null);
  readonly confirm = output<void>();

  protected readonly confirmed = signal(false);
  protected readonly grabbing = signal(false);
  protected readonly progress = signal(0);
  protected readonly strokeHeavy = tokens.icon.strokeHeavy;

  private readonly track = viewChild.required<ElementRef<HTMLButtonElement>>('track');
  private x = 0;
  private stop = () => {};
  private holdFrame = 0;

  constructor() {
    // Saving a confirmation: the knob stays at the end with its check.
    afterRenderEffect(() => {
      if (this.loading() && !this.confirmed()) {
        this.confirmed.set(true);
        this.set(this.travel());
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      cancelAnimationFrame(this.holdFrame);
    });
  }

  /** Puts the knob back at the start, ready for the next confirmation. */
  reset(): void {
    this.confirmed.set(false);
    this.animateTo(0, 0);
  }

  /** Knob travel in px: the track's inner width minus the knob and its inset on both sides. */
  private travel(): number {
    const track = this.track().nativeElement;
    const knob = track.querySelector<HTMLElement>('.knob')!;
    return Math.max(0, track.clientWidth - knob.offsetWidth - 2 * knob.offsetLeft);
  }

  private set(x: number): void {
    const travel = this.travel();
    this.x = Math.min(travel, Math.max(0, x));
    this.track().nativeElement.style.setProperty('--x', `${this.x}px`);
    this.progress.set(travel ? this.x / travel : 0);
  }

  private animateTo(x: number, velocity: number): void {
    this.stop();
    this.stop = spring(springs.slideToConfirm, this.x, x, velocity, (v) => this.set(v));
  }

  private fire(velocity = 0): void {
    if (this.confirmed()) return;
    this.confirmed.set(true);
    this.animateTo(this.travel(), velocity);
    this.confirm.emit();
  }

  protected startDrag(event: PointerEvent): void {
    if (event.button !== 0 || this.disabled() || this.loading() || this.confirmed()) return;
    event.preventDefault();
    this.stop();
    const track = this.track().nativeElement;
    track.setPointerCapture(event.pointerId);
    this.grabbing.set(true);
    const startX = event.clientX - this.x;
    let lastX = event.clientX;
    let lastTime = event.timeStamp;
    let velocity = 0;

    const move = (e: PointerEvent) => {
      this.set(e.clientX - startX);
      const dt = (e.timeStamp - lastTime) / 1000;
      if (dt > 0) velocity = (e.clientX - lastX) / dt;
      lastX = e.clientX;
      lastTime = e.timeStamp;
      if (this.progress() >= threshold) finish();
    };
    const finish = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', finish);
      track.removeEventListener('pointercancel', finish);
      this.grabbing.set(false);
      if (this.progress() >= threshold) this.fire(velocity);
      else this.animateTo(0, velocity);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', finish);
    track.addEventListener('pointercancel', finish);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Holding replaces the native click, so a single key press doesn't confirm by accident.
    event.preventDefault();
    if (event.repeat || this.holdFrame || this.confirmed()) return;
    this.stop();
    if (prefersReducedMotion()) {
      this.holdFrame = window.setTimeout(() => this.completeHold(), holdDuration);
      return;
    }
    const from = this.x;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / holdDuration);
      this.set(from + (this.travel() - from) * t);
      if (t < 1) this.holdFrame = requestAnimationFrame(step);
      else this.completeHold();
    };
    this.holdFrame = requestAnimationFrame(step);
  }

  protected onKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.cancelHold();
    }
  }

  protected cancelHold(): void {
    if (!this.holdFrame) return;
    cancelAnimationFrame(this.holdFrame);
    clearTimeout(this.holdFrame);
    this.holdFrame = 0;
    if (!this.confirmed()) this.animateTo(0, 0);
  }

  private completeHold(): void {
    this.holdFrame = 0;
    this.fire();
  }

  /** A click with no pointer or key behind it comes from assistive technology: confirm. */
  protected onClick(event: MouseEvent): void {
    if (event.detail === 0 && !this.holdFrame) this.fire();
  }
}
