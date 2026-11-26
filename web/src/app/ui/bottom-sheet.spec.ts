import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BottomSheet, SheetSnap } from './bottom-sheet';

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
});
