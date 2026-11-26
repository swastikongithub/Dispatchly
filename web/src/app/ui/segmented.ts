import { Component, input, model } from '@angular/core';

export interface SegmentOption {
  value: string;
  label: string;
}

/** Segmented control: input-coloured track, 3px padding, the active segment raised. */
@Component({
  selector: 'ui-segmented',
  template: `
    @for (option of options(); track option.value) {
      <button
        type="button"
        class="segment"
        [attr.aria-pressed]="option.value === value()"
        [attr.data-state]="forceState()[option.value] ?? null"
        [disabled]="disabled()"
        (click)="value.set(option.value)"
      >
        {{ option.label }}
      </button>
    }
  `,
  host: { role: 'group', '[attr.aria-label]': 'label()' },
  styles: `
    :host {
      display: flex;
      gap: var(--spacing-4);
      background: var(--ui-input);
      border-radius: var(--radius-segmented-track);
      padding: var(--spacing-3);
    }
    .segment {
      flex: 1;
      border: 0;
      border-radius: var(--radius-tab);
      padding: var(--spacing-7) 0;
      background: transparent;
      color: var(--ui-text-muted);
      font: inherit;
      font-size: var(--text-meta);
      font-weight: var(--font-weight-medium);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      cursor: pointer;
      transition:
        transform var(--duration-instant) var(--ease-standard),
        background-color var(--duration-fast) var(--ease-standard),
        color var(--duration-fast) var(--ease-standard);
    }
    .segment:hover:not(:disabled),
    .segment[data-state='hover'] {
      color: var(--ui-text-primary);
    }
    .segment:active:not(:disabled),
    .segment[data-state='pressed'] {
      transform: scale(var(--scale-press));
    }
    .segment[aria-pressed='true'] {
      background: var(--ui-segment-active);
      color: var(--ui-text-primary);
      font-weight: var(--font-weight-semibold);
    }
    .segment:disabled {
      color: var(--ui-text-disabled);
      cursor: not-allowed;
    }
  `,
})
export class Segmented {
  readonly options = input.required<readonly SegmentOption[]>();
  readonly label = input.required<string>();
  readonly value = model<string>('');
  readonly disabled = input(false);
  /** Styleguide only: show a segment in a forced state ({ value: 'hover' }). */
  readonly forceState = input<Record<string, string>>({});
}
