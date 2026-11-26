import { booleanAttribute, Component, input } from '@angular/core';

/**
 * Icon-only buttons. Always give them an aria-label.
 * - raised: 32px, raised fill, round (dashboard close) or square with a 9px radius (filter)
 * - floating: 44px round, floats over the map (tracking back, help, recenter)
 * - outline: 44px round with a 1px border (tracking call, message)
 * - map: 42px, 12px radius, panel fill (dashboard map controls)
 */
@Component({
  selector: 'button[uiIconButton], a[uiIconButton]',
  template: `<ng-content />`,
  host: {
    '[attr.data-variant]': 'uiIconButton() || "raised"',
    '[attr.data-shape]': 'shape()',
    '[attr.aria-busy]': 'loading() || null',
    '[attr.aria-disabled]': 'loading() || null',
  },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      padding: 0;
      border: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition:
        transform var(--duration-instant) var(--ease-standard),
        background-color var(--duration-fast) var(--ease-standard),
        color var(--duration-fast) var(--ease-standard);
    }
    :host ::ng-deep svg {
      width: var(--icon-size-18);
      height: var(--icon-size-18);
    }
    :host(:active:not(:disabled, [aria-disabled='true'])),
    :host([data-state='pressed']) {
      transform: scale(var(--scale-press));
    }

    :host([data-variant='raised']) {
      width: var(--spacing-icon-button-small);
      height: var(--spacing-icon-button-small);
      border-radius: var(--radius-circle);
      background: var(--ui-raised);
      color: var(--ui-icon);
    }
    :host([data-variant='raised'][data-shape='square']) {
      border-radius: var(--radius-filter-button);
    }
    :host([data-variant='raised']) ::ng-deep svg {
      width: var(--icon-size-16);
      height: var(--icon-size-16);
    }
    :host([data-variant='floating']) {
      width: var(--spacing-floating-button);
      height: var(--spacing-floating-button);
      border-radius: var(--radius-circle);
      border: var(--border-width-hairline) solid var(--ui-floating-border);
      background: var(--ui-surface-floating);
      color: var(--ui-map-control-icon);
      box-shadow: var(--ui-floating-shadow);
    }
    :host([data-variant='floating']) ::ng-deep svg {
      width: var(--icon-size-20);
      height: var(--icon-size-20);
    }
    :host([data-variant='outline']) {
      width: var(--spacing-action-button);
      height: var(--spacing-action-button);
      border-radius: var(--radius-circle);
      border: var(--border-width-hairline) solid var(--ui-outline);
      background: var(--ui-surface);
      color: var(--ui-text-primary);
    }
    :host([data-variant='map']) {
      width: var(--spacing-map-control);
      height: var(--spacing-map-control);
      border-radius: var(--radius-control);
      border: var(--border-width-hairline) solid var(--ui-surface-border);
      background: var(--ui-surface-floating);
      color: var(--ui-map-control-icon);
      box-shadow: var(--ui-floating-shadow);
    }

    :host([data-variant='raised']:hover),
    :host([data-variant='raised'][data-state='hover']) {
      background: var(--ui-raised-hover);
    }
    :host([data-variant='floating']:hover),
    :host([data-variant='floating'][data-state='hover']),
    :host([data-variant='outline']:hover),
    :host([data-variant='outline'][data-state='hover']),
    :host([data-variant='map']:hover),
    :host([data-variant='map'][data-state='hover']) {
      background: var(--ui-hover);
    }

    :host(:disabled),
    :host([aria-disabled='true']) {
      color: var(--ui-text-disabled);
      cursor: not-allowed;
    }
    :host([aria-busy='true']) {
      cursor: progress;
      pointer-events: none;
    }
  `,
})
export class IconButton {
  readonly uiIconButton = input<'raised' | 'floating' | 'outline' | 'map' | ''>('');
  readonly shape = input<'round' | 'square'>('round');
  readonly loading = input(false, { transform: booleanAttribute });
}
