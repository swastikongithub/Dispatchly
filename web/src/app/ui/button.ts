import { booleanAttribute, Component, input } from '@angular/core';

/**
 * Text buttons from the designs, on a native <button> or <a>:
 * - primary: orange pill, ink text, 16/600, 14×24 (landing "Open live dashboard")
 * - contrast: light pill, ink text, 14/600, 9×16 (landing header "Open dashboard")
 * - outline: 1px 16% white border pill, 16/600, 14×18 (landing "Track a demo order")
 * - secondary: raised fill, 44px tall with a 12px radius (dashboard), or 48px with 14px (size="lg", rider)
 * - menu: raised fill, 10px radius, 14/500, 8×12 (dashboard "Central Delhi")
 * Put a Lucide icon inside as <svg lucideX aria-hidden="true">; its size is set here.
 */
@Component({
  selector: 'button[uiButton], a[uiButton]',
  template: `<ng-content />`,
  host: {
    '[attr.data-variant]': 'uiButton() || "primary"',
    '[attr.data-size]': 'size()',
    '[attr.aria-busy]': 'loading() || null',
    '[attr.aria-disabled]': 'loading() || unavailable() || null',
  },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-8);
      border: 0;
      font: inherit;
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
      text-decoration: none;
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition:
        transform var(--duration-instant) var(--ease-standard),
        opacity var(--duration-fast) var(--ease-standard),
        background-color var(--duration-fast) var(--ease-standard),
        color var(--duration-fast) var(--ease-standard);
    }
    :host ::ng-deep svg {
      flex: none;
      width: var(--icon-size-16);
      height: var(--icon-size-16);
    }

    /* Pressed: scale(0.98) for 100 ms on every button (PLAN.md §6.1). */
    :host(:active:not(:disabled, [aria-disabled='true'])),
    :host([data-state='pressed']) {
      transform: scale(var(--scale-press));
    }

    /* Pills hover like every link on the landing page; raised buttons get a lighter surface. */
    :host([data-variant='primary']) {
      background: var(--ui-accent);
      color: var(--ui-on-accent);
      border-radius: var(--radius-pill);
      font-size: var(--text-body);
      padding: var(--spacing-14) var(--spacing-24);
    }
    :host([data-variant='contrast']) {
      background: var(--ui-text-primary);
      color: var(--ui-canvas);
      border-radius: var(--radius-pill);
      font-size: var(--text-ui);
      padding: var(--spacing-9) var(--spacing-16);
    }
    :host([data-variant='outline']) {
      background: transparent;
      color: var(--ui-text-primary);
      border: var(--border-width-hairline) solid var(--ui-outline);
      border-radius: var(--radius-pill);
      font-size: var(--text-body);
      padding: var(--spacing-14) var(--spacing-18);
    }
    :host([data-variant='outline']) ::ng-deep svg {
      width: var(--icon-size-18);
      height: var(--icon-size-18);
    }
    :host([data-variant='primary']:hover),
    :host([data-variant='contrast']:hover),
    :host([data-variant='outline']:hover),
    :host([data-variant='primary'][data-state='hover']),
    :host([data-variant='contrast'][data-state='hover']),
    :host([data-variant='outline'][data-state='hover']) {
      opacity: var(--opacity-link-hover);
    }

    :host([data-variant='secondary']) {
      background: var(--ui-selected);
      color: var(--ui-text-primary);
      height: var(--spacing-action-button);
      border-radius: var(--radius-control);
      font-size: var(--text-ui);
      padding: 0 var(--spacing-16);
    }
    :host([data-variant='secondary'][data-size='lg']) {
      background: var(--ui-raised-strong);
      height: var(--spacing-action-button-tall);
      border-radius: var(--radius-item);
      font-size: var(--text-body-small);
    }
    :host([data-variant='secondary'][data-size='lg']) ::ng-deep svg {
      width: var(--icon-size-17);
      height: var(--icon-size-17);
    }
    :host([data-variant='menu']) {
      gap: var(--spacing-6);
      background: var(--ui-raised);
      color: var(--ui-text-primary);
      border-radius: var(--radius-small-control);
      font-size: var(--text-ui);
      font-weight: var(--font-weight-medium);
      padding: var(--spacing-8) var(--spacing-12);
    }
    :host([data-variant='secondary']:hover),
    :host([data-variant='secondary'][data-state='hover']),
    :host([data-variant='menu']:hover),
    :host([data-variant='menu'][data-state='hover']) {
      background: var(--ui-raised-hover);
    }

    /* Disabled and loading: the text steps back and the button stops reacting. */
    :host(:disabled),
    :host([aria-disabled='true']) {
      color: var(--ui-text-disabled);
      cursor: not-allowed;
      opacity: 1;
    }
    :host([data-variant='primary']:disabled),
    :host([data-variant='primary'][aria-disabled='true']),
    :host([data-variant='contrast']:disabled),
    :host([data-variant='contrast'][aria-disabled='true']) {
      background: var(--ui-track);
    }
    :host([aria-busy='true']) {
      cursor: progress;
      pointer-events: none;
    }
  `,
})
export class Button {
  readonly uiButton = input<'primary' | 'contrast' | 'outline' | 'secondary' | 'menu' | ''>('');
  readonly size = input<'md' | 'lg'>('md');
  readonly loading = input(false, { transform: booleanAttribute });
  /**
   * Looks and reads as disabled but stays focusable, so its title can say why. The click
   * handler must check it too.
   */
  readonly unavailable = input(false, { transform: booleanAttribute });
}
