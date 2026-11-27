import { Component, ElementRef, input, model, viewChild } from '@angular/core';
import { LucideSearch } from '@lucide/angular';

const isApple =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Search field: 40px, input colour, search icon and a Ctrl K / ⌘K hint that focuses it. */
@Component({
  selector: 'ui-search-field',
  imports: [LucideSearch],
  template: `
    <label class="field" [attr.data-state]="state()">
      <svg lucideSearch aria-hidden="true"></svg>
      <input
        #input
        type="search"
        [placeholder]="placeholder()"
        [attr.aria-label]="label()"
        [disabled]="disabled()"
        [value]="value()"
        [attr.role]="combobox() ? 'combobox' : null"
        [attr.aria-autocomplete]="combobox() ? 'list' : null"
        [attr.aria-expanded]="combobox() ? expanded() : null"
        [attr.aria-controls]="combobox() ? controls() : null"
        [attr.aria-activedescendant]="combobox() ? activeDescendant() : null"
        autocomplete="off"
        (input)="value.set(input.value)"
      />
      <kbd>{{ shortcut }}</kbd>
    </label>
  `,
  host: {
    '(document:keydown)': 'onShortcut($event)',
  },
  styles: `
    :host {
      display: block;
    }
    .field {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--spacing-10);
      height: var(--spacing-search-field);
      padding: 0 var(--spacing-8) 0 var(--spacing-12);
      background: var(--ui-input);
      border: var(--border-width-hairline) solid var(--ui-input-border);
      border-radius: var(--radius-control);
      color: var(--ui-text-muted);
      cursor: text;
      transition: border-color var(--duration-fast) var(--ease-standard);
    }
    .field:hover,
    .field[data-state='hover'] {
      border-color: var(--ui-kbd-border);
    }
    .field:has(input:focus-visible),
    .field[data-state='focus'] {
      outline: var(--focus-width) solid var(--ui-focus);
      outline-offset: var(--focus-offset);
    }
    svg {
      flex: none;
      width: var(--icon-size-18);
      height: var(--icon-size-18);
    }
    input {
      flex: 1;
      min-width: 0;
      background: transparent;
      border: 0;
      outline: none;
      color: var(--ui-text-primary);
      font: inherit;
      font-size: var(--text-ui);
    }
    input::placeholder {
      color: var(--ui-text-muted);
    }
    input::-webkit-search-cancel-button {
      display: none;
    }
    kbd {
      font-family: inherit;
      font-size: var(--text-caption);
      color: var(--ui-text-muted);
      border: var(--border-width-hairline) solid var(--ui-kbd-border);
      border-radius: var(--radius-kbd);
      padding: var(--spacing-2) var(--spacing-6);
      white-space: nowrap;
    }
    .field:has(input:disabled) {
      color: var(--ui-text-disabled);
      cursor: not-allowed;
    }
    input:disabled,
    input:disabled::placeholder {
      color: var(--ui-text-disabled);
      cursor: not-allowed;
    }
  `,
})
export class SearchField {
  readonly placeholder = input('Search riders, orders, places');
  readonly label = input('Search riders, orders and places');
  readonly value = model('');
  readonly disabled = input(false);
  /** Styleguide only: force the hover or focus look. */
  readonly state = input<'hover' | 'focus' | null>(null);
  /** As a combobox: the input owns a list of results (`controls`) and its active option. */
  readonly combobox = input(false);
  readonly expanded = input(false);
  readonly controls = input<string | null>(null);
  readonly activeDescendant = input<string | null>(null);

  protected readonly shortcut = isApple ? '⌘K' : 'Ctrl K';
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  focus(): void {
    this.input().nativeElement.focus();
  }

  blur(): void {
    this.input().nativeElement.blur();
  }

  protected onShortcut(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === 'k' && (isApple ? event.metaKey : event.ctrlKey)) {
      event.preventDefault();
      this.focus();
    }
  }
}
