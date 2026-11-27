import {
  afterNextRender,
  afterRenderEffect,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { spring, springs } from './motion';

export type SheetSnap = 'peek' | 'half' | 'full';

/** Elements that need the pointer themselves (to select text or slide), so it never drags the sheet. */
const ownsPointer = 'input, select, textarea, [role="slider"], [contenteditable]';
/**
 * Pointer travel (px) under which a press is a tap (on the grabber, a row or a button), not a
 * drag: an input threshold like the platforms' touch slop, not a visual value.
 */
const tapSlop = 8;
/**
 * A pause (ms) in wheel events that ends a scroll, after which the sheet settles on a stop: an
 * input threshold like tapSlop, not a motion value.
 */
const wheelGap = 160;
/** px per line, for wheels that scroll by lines (DOM_DELTA_LINE). */
const wheelLine = 16;

/** The sheet's translateY at each stop. */
export type SheetStops = Record<SheetSnap, number>;

/**
 * Where a scroll of `delta` px over the sheet (positive: scrolling down, to see more) takes it
 * from `offset`, its translateY. The sheet moves first: it rises until it's fully open, and then
 * the content scrolls (null: the browser scrolls it). Scrolling back lowers the sheet; once it's
 * fully open, only if the scroll began at the top of the content (`fromTop`), so a flick back up
 * a long list stops at the top instead of closing the sheet.
 */
export function wheelTarget(
  offset: number,
  delta: number,
  stops: SheetStops,
  fromTop: boolean,
): number | null {
  if (delta > 0) return offset > stops.full ? Math.max(stops.full, offset - delta) : null;
  if (offset <= stops.full && !fromTop) return null;
  return Math.min(stops.peek, offset - delta);
}

/**
 * The stop a sheet at `offset` settles on: the next one in the direction it was moving (-1 up,
 * 1 down), or the nearest when it wasn't moving.
 */
export function settleStop(stops: SheetStops, offset: number, direction: number): SheetSnap {
  const ahead = (Object.keys(stops) as SheetSnap[]).filter((stop) =>
    direction < 0
      ? stops[stop] <= offset + 0.5
      : direction > 0
        ? stops[stop] >= offset - 0.5
        : true,
  );
  return ahead.reduce((a, b) =>
    Math.abs(stops[a] - offset) <= Math.abs(stops[b] - offset) ? a : b,
  );
}

/**
 * Bottom sheet: 28px top radius, grabber, drag to snap (peek / half / full) on the sheet spring.
 * Place it in a positioned container; it sits on the container's bottom edge. Mark the element
 * that should stay visible in the peek state with `uiSheetPeek`. The grabber is a button that
 * toggles peek and full ("Show more" / "Show less" for screen readers), and moving keyboard
 * focus into the content opens the sheet fully, so focused content is never off screen.
 *
 * Scrolling over the sheet moves the sheet first, in step with the scroll: a wheel, trackpad or
 * finger raises it until it's fully open, then scrolls the content; scrolling back from the top
 * of the content lowers it. A finger can drag from anywhere, rows and buttons included; under
 * `tapSlop` it's still a tap.
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
    <span #shade class="shade" aria-hidden="true"></span>
  `,
  host: {
    '[attr.data-snap]': 'snap()',
    '(pointerdown)': 'startDrag($event, false)',
    '(touchmove)': 'touchMove($event)',
    '(wheel)': 'onWheel($event)',
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
    /* At peek, hides what starts right below the peek element, so the peek ends cleanly; it
       fades as the sheet rises. */
    .shade {
      position: absolute;
      left: 0;
      right: 0;
      background: var(--ui-surface);
      pointer-events: none;
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
  /** How much of its container (px, from the bottom) the sheet covers where it comes to rest. */
  readonly covers = signal(0);

  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private readonly shade = viewChild.required<ElementRef<HTMLElement>>('shade');
  /** Where the peek ends: the sheet's offset at peek, and the band below the peek element. */
  private peek = { offset: 0, line: 0, band: 0 };
  private offset = 0;
  /** The sheet's height when its stops were last measured. */
  private height = 0;
  private target: SheetSnap | null = null;
  private dragging = false;
  private ready = false;
  private stop = () => {};
  /** px/s as the sheet last moved, so the next motion carries on from it. */
  private velocity = 0;
  /** A spring is moving the sheet. */
  private moving = false;
  /** A wheel or trackpad scroll in progress: where it's taking the sheet, and which way. */
  private scroll: { to: number; direction: number; fromTop: boolean; last: number } | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** What the last press was on, until the focus it gives (if any) arrives. */
  private pressed: Element | null = null;
  /** A finger on the fully open sheet's content, until it shows whether it pulls the sheet down. */
  private pull: {
    startY: number;
    scroller: HTMLElement;
    claimed: boolean;
    claim: () => void;
  } | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.jump();
      this.ready = true;
      // New content or a new screen size moves the stops: in motion, the sheet carries on to
      // where its stop now is; at rest, it stays on it.
      const observer = new ResizeObserver(() => {
        if (this.dragging || this.scroll) return;
        if (this.moving && this.target) this.animateTo(this.target, this.velocity);
        else this.jump();
      });
      observer.observe(this.el);
      if (this.el.parentElement) observer.observe(this.el.parentElement);
      destroyRef.onDestroy(() => {
        observer.disconnect();
        this.stop();
        clearTimeout(this.settleTimer);
      });
    });
    // After rendering, so the stops are measured with the content that came with the change
    // (a selection swaps the order list for the rider card as it moves the sheet to half).
    afterRenderEffect(() => {
      const snap = this.snap();
      untracked(() => {
        if (!this.ready || this.dragging || snap === this.target) return;
        this.endScroll();
        this.animateTo(snap, 0);
      });
    });
  }

  /** translateY for each snap point, from the sheet and container heights. */
  private positions(): Record<SheetSnap, number> {
    const height = this.el.offsetHeight;
    const container = this.el.parentElement?.clientHeight ?? height;
    const band = parseFloat(getComputedStyle(this.el).paddingBottom);
    const peek = this.el.querySelector<HTMLElement>('[uiSheetPeek]');
    // Measured on screen, as the content's own elements may be positioned.
    const top = this.el.getBoundingClientRect().top - this.el.scrollTop;
    const line = peek ? peek.getBoundingClientRect().bottom - top : height - band;
    const peekOffset = Math.max(0, height - line - band);
    this.peek = { offset: peekOffset, line, band };
    const halfOffset = Math.min(peekOffset, Math.max(0, height - container / 2));
    // New content made the sheet taller or shorter (the rider card for the order list): it keeps
    // its top where it is on screen and moves on from there, rather than jump for a frame.
    if (this.height && height !== this.height) {
      this.offset += height - this.height;
      this.apply();
    }
    this.height = height;
    return { full: 0, half: halfOffset, peek: peekOffset };
  }

  private apply(): void {
    this.el.style.transform = `translateY(${this.offset}px)`;
    const { offset, line, band } = this.peek;
    const shade = this.shade().nativeElement.style;
    shade.top = `${line}px`;
    shade.height = `${band}px`;
    shade.opacity = String(band > 0 ? clamp((this.offset - offset + band) / band) : 0);
  }

  private jump(): void {
    this.stop();
    this.moving = false;
    this.velocity = 0;
    this.offset = this.positions()[this.snap()];
    this.target = this.snap();
    this.covers.set(this.el.offsetHeight - this.offset);
    this.apply();
  }

  private animateTo(snap: SheetSnap, velocity: number): void {
    this.target = snap;
    const to = this.positions()[snap];
    this.covers.set(this.el.offsetHeight - to);
    this.moveTo(to, velocity);
  }

  /** Springs the sheet to `to` (translateY), keeping track of its speed. */
  private moveTo(to: number, velocity: number): void {
    this.stop();
    let from = this.offset;
    let last = performance.now();
    this.moving = true;
    this.stop = spring(
      springs.sheet,
      this.offset,
      to,
      velocity,
      (y) => {
        const now = performance.now();
        if (now > last) this.velocity = ((y - from) / (now - last)) * 1000;
        from = y;
        last = now;
        this.offset = y;
        this.apply();
      },
      () => {
        this.velocity = 0;
        this.moving = false;
      },
    );
  }

  /**
   * Focus moving into the content (the keyboard, or the content moving it) opens the sheet.
   * Focusing the grabber doesn't, and neither does the focus a press gives what it pressed: a tap
   * on a row selects it at the height the sheet is.
   */
  protected focusIn(event: FocusEvent): void {
    const target = event.target as Element;
    const pressed = this.pressed;
    this.pressed = null;
    if (target.closest('.handle') || (pressed && target.contains(pressed))) return;
    this.snap.set('full');
  }

  /** A wheel or trackpad over the sheet moves it first; see `wheelTarget`. */
  protected onWheel(event: WheelEvent): void {
    // Pinch zoom comes as a wheel with ctrlKey; sideways scrolls aren't for the sheet.
    if (this.dragging || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? wheelLine
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? (this.el.parentElement?.clientHeight ?? this.el.offsetHeight)
          : 1;
    const delta = event.deltaY * unit;
    if (!delta) return;
    if (!this.scroll || event.timeStamp - this.scroll.last > wheelGap) {
      this.scroll = {
        to: this.offset,
        direction: 0,
        fromTop: this.scrollerAt(event.target).scrollTop <= 0,
        last: 0,
      };
    }
    const scroll = this.scroll;
    scroll.last = event.timeStamp;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.settle(), wheelGap);
    const to = wheelTarget(scroll.to, delta, this.positions(), scroll.fromTop);
    if (to === null) return;
    event.preventDefault();
    if (to === scroll.to) return;
    scroll.direction = Math.sign(to - scroll.to);
    scroll.to = to;
    this.moveTo(to, this.velocity);
  }

  /** The scroll has stopped: the sheet glides on to the next stop the way it was going. */
  private settle(): void {
    const scroll = this.endScroll();
    if (!scroll?.direction) return;
    const snap = settleStop(this.positions(), scroll.to, scroll.direction);
    this.animateTo(snap, this.velocity);
    this.snap.set(snap);
  }

  private endScroll() {
    const scroll = this.scroll;
    this.scroll = null;
    clearTimeout(this.settleTimer);
    return scroll;
  }

  /**
   * What scrolls under `target`: the nearest scrollable element up to the sheet (such as the
   * expanded order list), or the sheet itself.
   */
  private scrollerAt(target: EventTarget | null): HTMLElement {
    for (
      let el = target instanceof Element ? target : null;
      el && el !== this.el;
      el = el.parentElement
    ) {
      if (
        el instanceof HTMLElement &&
        el.scrollHeight > el.clientHeight &&
        /auto|scroll/.test(getComputedStyle(el).overflowY)
      ) {
        return el;
      }
    }
    return this.el;
  }

  /**
   * A finger on the fully open sheet's content: pulling down from the top of it lowers the sheet.
   * Decided on the first move, while the browser can still be kept from scrolling.
   */
  protected touchMove(event: TouchEvent): void {
    const pull = this.pull;
    if (!pull || !event.cancelable) return;
    if (pull.claimed) {
      event.preventDefault();
      return;
    }
    const dy = event.touches[0].clientY - pull.startY;
    if (dy > 0 && pull.scroller.scrollTop <= 0) {
      event.preventDefault();
      pull.claim();
    } else if (dy < 0) {
      // Scrolling the content: that's the browser's.
      this.pull = null;
    }
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
    this.pressed = event.target as Element;
    if (event.button !== 0 || this.dragging) return;
    if (!fromHandle && (event.target as Element).closest(ownsPointer)) return;
    // Fully open, the content scrolls. A finger pulling down from its top lowers the sheet (see
    // touchMove); a mouse there selects and clicks as usual.
    const pulls = !fromHandle && this.snap() === 'full';
    const scroller = this.scrollerAt(event.target);
    if (pulls && (event.pointerType === 'mouse' || scroller.scrollTop > 0)) return;
    this.stop();
    this.moving = false;
    this.endScroll();
    this.dragging = true;
    const positions = this.positions();
    const startY = event.clientY;
    const startOffset = this.offset;
    const startScroll = scroller.scrollTop;
    // Where the sheet starts following the pointer: once it's past the tap slop.
    let originY = startY;
    let lastY = startY;
    let lastTime = event.timeStamp;
    let velocity = 0;
    let moved = false;
    let claimed = !pulls;
    if (pulls) {
      const pull = {
        startY,
        scroller,
        claimed: false,
        claim: () => (claimed = pull.claimed = true),
      };
      this.pull = pull;
    }

    const move = (e: PointerEvent) => {
      if (!claimed) return;
      if (!moved) {
        // A few pixels of finger wobble is still a tap.
        if (Math.abs(e.clientY - startY) <= tapSlop) return;
        moved = true;
        originY = e.clientY;
        // A drag from here: the sheet keeps the pointer, so the press doesn't also click a row.
        this.el.setPointerCapture(e.pointerId);
      }
      const y = startOffset + e.clientY - originY;
      this.offset = Math.min(positions.peek, Math.max(0, y));
      // Dragged on past fully open, the content scrolls on.
      if (y < 0 && !fromHandle) scroller.scrollTop = startScroll - y;
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
      this.pull = null;
      if (!moved) {
        // A tap: the grabber toggles; anywhere else, the sheet carries on to its stop.
        if (fromHandle) this.toggle();
        else this.animateTo(this.snap(), 0);
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

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
