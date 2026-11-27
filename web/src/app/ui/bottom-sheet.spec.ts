import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BottomSheet, SheetSnap, settleStop, wheelTarget } from './bottom-sheet';

@Component({
  imports: [BottomSheet],
  template: `
    <section uiBottomSheet [(snap)]="snap">
      <p uiSheetPeek>Peek</p>
      <button type="button" class="content">Call rider</button>
    </section>
  `,
})
class Host {
  readonly snap = signal<SheetSnap>('full');
}

describe('bottom sheet grabber', () => {
  beforeEach(() => {
    // jsdom has neither; reduced motion makes the spring jump straight to its target.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const handle = el.querySelector<HTMLButtonElement>('button.handle')!;
    const click = (detail: number) => {
      handle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
      fixture.detectChanges();
    };
    return { fixture, el, handle, click, snap: fixture.componentInstance.snap };
  }

  it('is a button labelled for screen readers that toggles peek and full', () => {
    const { handle, click, snap } = render();
    expect(handle.getAttribute('aria-label')).toBe('Show less');
    click(0);
    expect(snap()).toBe('peek');
    expect(handle.getAttribute('aria-label')).toBe('Show more');
    click(0);
    expect(snap()).toBe('full');
  });

  it('leaves pointer clicks to the drag, so a drag never also toggles', () => {
    const { click, snap } = render();
    click(1);
    expect(snap()).toBe('full');
  });

  it('opens fully when focus moves into the content, but not onto the grabber', () => {
    const { fixture, el, handle, click, snap } = render();
    click(0);
    handle.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(snap()).toBe('peek');
    el.querySelector('.content')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(snap()).toBe('full');
  });

  it("stays put when a tap focuses what it pressed (a row selects at the sheet's height)", () => {
    const { fixture, el, click, snap } = render();
    click(0);
    const content = el.querySelector('.content')!;
    // A tap: the press, the release, then the browser focuses what was pressed.
    content.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    content.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    content.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(snap()).toBe('peek');
    // Focus that the tap didn't give (keyboard, or moved by the content) still opens it.
    content.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    expect(snap()).toBe('full');
  });
});

describe('bottom sheet scrolling', () => {
  // translateY of each stop, in px.
  const stops = { full: 0, half: 300, peek: 500 };

  it('raises the sheet with the scroll until it is fully open, then leaves the scroll to the content', () => {
    expect(wheelTarget(300, 120, stops, false)).toBe(180);
    expect(wheelTarget(60, 120, stops, false)).toBe(0);
    expect(wheelTarget(0, 120, stops, true)).toBeNull();
  });

  it('lowers the sheet when scrolling back, from the top of its content only', () => {
    expect(wheelTarget(300, -100, stops, false)).toBe(400);
    expect(wheelTarget(450, -100, stops, false)).toBe(500);
    // Fully open: a scroll back that began at the top lowers it; one that scrolled the content up
    // to the top (a flick through the list) stops there.
    expect(wheelTarget(0, -100, stops, true)).toBe(100);
    expect(wheelTarget(0, -100, stops, false)).toBeNull();
  });

  it('comes to rest at the next stop in the direction it was moving', () => {
    expect(settleStop(stops, 250, -1)).toBe('full');
    expect(settleStop(stops, 250, 1)).toBe('half');
    expect(settleStop(stops, 320, 1)).toBe('peek');
    expect(settleStop(stops, 300, -1)).toBe('half');
    expect(settleStop(stops, 0, -1)).toBe('full');
    expect(settleStop(stops, 120, 0)).toBe('full');
  });
});
