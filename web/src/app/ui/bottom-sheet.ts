import {
  afterNextRender,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  model,
  untracked,
} from '@angular/core';
import { spring, springs } from './motion';

export type SheetSnap = 'peek' | 'half' | 'full';

const interactive = 'button, a, input, select, textarea, [role="slider"], [contenteditable]';
/**
 * Pointer travel (px) under which a press on the grabber is a tap, not a drag: an input
 * threshold like the platforms' touch slop, not a visual value.
 */
const tapSlop = 8;

/**
 * Bottom sheet: 28px top radius, grabber, drag to snap (peek / half / full) on the sheet spring.
 * Place it in a positioned container; it sits on the container's bottom edge. Mark the element
 * that should stay visible in the peek state with `uiSheetPeek`. The grabber is a button that
 * toggles peek and full ("Show more" / "Show less" for screen readers), and moving keyboard
 * focus into the content opens the sheet fully, so focused content is never off screen.
 */
@Component({
  selector: 'section[uiBottomSheet]',
  template: `
    <button
      type="button"
      class="handle"
      [attr.aria-label]="snap() === 'full' ? 'Show less' : 'Show more'"
      (pointerdown)="startDrag($event, true)"
      (click)="keyToggle($event)"
    >
      <span class="grabber"></span>
    </button>
    <ng-content />
  `,
  host: {
    '[attr.data-snap]': 'snap()',
    '(pointerdown)': 'startDrag($event, false)',
    '(focusin)': 'focusIn($event)',
  },
  styles: `
    :host {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      box-sizing: border-box;
      max-height: 100%;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-16);
      padding: var(--spacing-10) var(--spacing-20) var(--spacing-24);
      background: var(--ui-surface);
      border-top: var(--border-width-hairline) solid var(--ui-sheet-border);
      border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
      box-shadow: var(--ui-sheet-shadow);
      touch-action: none;
      will-change: transform;
    }
    :host([data-snap='full']) {
      touch-action: pan-y;
    }
    .handle {
      flex: none;
      display: block;
      margin: calc(var(--spacing-10) * -1) calc(var(--spacing-20) * -1) calc(var(--spacing-16) * -1);
      padding: var(--spacing-10) var(--spacing-20) var(--spacing-16);
      border: 0;
      background: transparent;
      touch-action: none;
      cursor: grab;
    }
    /* The sheet clips anything outside it, so the focus ring goes around the grabber itself. */
    .handle:focus-visible {
      outline: none;
    }
    .handle:focus-visible .grabber {
      outline: var(--focus-width) solid var(--ui-focus);
      outline-offset: var(--focus-offset);
    }
    .grabber {
      display: block;
      margin: 0 auto;
      width: var(--spacing-grabber-width);
      height: var(--spacing-grabber-height);
      border-radius: var(--radius-bar);
      background: var(--ui-grabber);
    }
  `,
})
export class BottomSheet {
  readonly snap = model<SheetSnap>('full');

  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private offset = 0;
  private target: SheetSnap | null = null;
  private dragging = false;
  private ready = false;
  private stop = () => {};

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.jump();
      this.ready = true;
      const observer = new ResizeObserver(() => {
        if (!this.dragging) this.jump();
      });
      observer.observe(this.el);
      if (this.el.parentElement) observer.observe(this.el.parentElement);
      destroyRef.onDestroy(() => {
        observer.disconnect();
        this.stop();
      });
    });
    effect(() => {
      const snap = this.snap();
      untracked(() => {
        if (this.ready && !this.dragging && snap !== this.target) this.animateTo(snap, 0);
      });
    });
  }

  /** translateY for each snap point, from the sheet and container heights. */
  private positions(): Record<SheetSnap, number> {
    const height = this.el.offsetHeight;
    const container = this.el.parentElement?.clientHeight ?? height;
    const peek = this.el.querySelector<HTMLElement>('[uiSheetPeek]');
    const padding = parseFloat(getComputedStyle(this.el).paddingBottom);
    const peekHeight = peek ? peek.offsetTop + peek.offsetHeight + padding : height;
    const peekOffset = Math.max(0, height - peekHeight);
    const halfOffset = Math.min(peekOffset, Math.max(0, height - container / 2));
    return { full: 0, half: halfOffset, peek: peekOffset };
  }

  private apply(): void {
    this.el.style.transform = `translateY(${this.offset}px)`;
  }

  private jump(): void {
    this.stop();
    this.offset = this.positions()[this.snap()];
    this.target = this.snap();
    this.apply();
  }

  private animateTo(snap: SheetSnap, velocity: number): void {
    this.stop();
    this.target = snap;
    this.stop = spring(springs.sheet, this.offset, this.positions()[snap], velocity, (y) => {
      this.offset = y;
      this.apply();
    });
  }

  /** Focus moving into the content opens the sheet; focusing the grabber itself doesn't. */
  protected focusIn(event: FocusEvent): void {
    if (!(event.target as Element).closest('.handle')) this.snap.set('full');
  }

  /**
   * Keyboard and assistive-technology activation of the grabber (click with detail 0).
   * Pointer taps are handled at the end of the drag, so a drag never also toggles.
   */
  protected keyToggle(event: MouseEvent): void {
    if (event.detail === 0) this.toggle();
  }

  private toggle(): void {
    this.snap.set(this.snap() === 'full' ? 'peek' : 'full');
  }

  protected startDrag(event: PointerEvent, fromHandle: boolean): void {
    if (event.button !== 0 || this.dragging) return;
    if (!fromHandle && (this.snap() === 'full' || (event.target as Element).closest(interactive))) {
      return;
    }
    this.stop();
    this.dragging = true;
    const positions = this.positions();
    const startY = event.clientY;
    const startOffset = this.offset;
    let lastY = startY;
    let lastTime = event.timeStamp;
    let velocity = 0;
    let moved = false;
    this.el.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => {
      // A few pixels of finger wobble is still a tap.
      if (Math.abs(e.clientY - startY) > tapSlop) moved = true;
      this.offset = Math.min(positions.peek, Math.max(0, startOffset + e.clientY - startY));
      this.apply();
      const dt = (e.timeStamp - lastTime) / 1000;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastTime = e.timeStamp;
    };
    const end = () => {
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', end);
      this.el.removeEventListener('pointercancel', end);
      this.dragging = false;
      if (fromHandle && !moved) {
        this.offset = startOffset;
        this.apply();
        this.toggle();
        return;
      }
      const nearest = (Object.keys(positions) as SheetSnap[]).reduce((a, b) =>
        Math.abs(positions[a] - this.offset) <= Math.abs(positions[b] - this.offset) ? a : b,
      );
      this.animateTo(nearest, velocity);
      this.snap.set(nearest);
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }
}
