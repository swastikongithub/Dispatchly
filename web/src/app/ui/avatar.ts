import { Component, computed, input } from '@angular/core';

/** Initials avatar: 44px accent tint (rider), 28px small. The 36px account button is `button[uiAvatar]`. */
@Component({
  selector: 'ui-avatar, button[uiAvatar]',
  template: `{{ initials() }}`,
  host: {
    '[attr.data-size]': 'size()',
    '[class.ui-skeleton]': 'loading()',
  },
  styles: `
    :host {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: var(--spacing-avatar);
      height: var(--spacing-avatar);
      padding: 0;
      border: 0;
      border-radius: var(--radius-circle);
      background: var(--ui-accent-tint);
      color: var(--ui-accent-text);
      font: inherit;
      font-size: var(--text-body-small);
      font-weight: var(--font-weight-bold);
    }
    :host(.ui-skeleton) {
      border-radius: var(--radius-circle);
      background: var(--ui-raised);
    }
    :host([data-size='sm']) {
      width: var(--spacing-avatar-small);
      height: var(--spacing-avatar-small);
      font-size: var(--text-caption);
    }
    :host([data-size='button']) {
      width: var(--spacing-avatar-button);
      height: var(--spacing-avatar-button);
      background: var(--ui-track);
      color: var(--ui-text-primary);
      font-size: var(--text-meta);
      font-weight: var(--font-weight-semibold);
      cursor: pointer;
      transition:
        transform var(--duration-instant) var(--ease-standard),
        background-color var(--duration-fast) var(--ease-standard);
    }
    :host([data-size='button']:hover),
    :host([data-size='button'][data-state='hover']) {
      background: var(--ui-selected-hover);
    }
    :host([data-size='button']:active),
    :host([data-size='button'][data-state='pressed']) {
      transform: scale(var(--scale-press));
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input<'md' | 'sm' | 'button'>('md');
  readonly loading = input(false);
  /** The first letters of the first two words, skipping words like "&" ("Saffron & Smoke": SS). */
  protected readonly initials = computed(() =>
    this.name()
      .split(/\s+/)
      .filter((part) => /^\p{L}/u.test(part))
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join(''),
  );
}
