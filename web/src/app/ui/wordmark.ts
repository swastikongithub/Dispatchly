import { Component, input } from '@angular/core';
import { tokens } from '../tokens';

/** Ring + orange dot mark, optionally with "Dispatchly" in Inter Tight 700. */
@Component({
  selector: 'ui-wordmark',
  template: `
    <svg class="mark" [attr.viewBox]="viewBox" aria-hidden="true">
      <circle
        [attr.cx]="mark.ring.cx"
        [attr.cy]="mark.ring.cy"
        [attr.r]="mark.ring.r"
        [attr.stroke-width]="mark.ring.stroke"
        fill="none"
        stroke="currentColor"
      />
      <circle
        class="dot"
        [attr.cx]="mark.dot.cx"
        [attr.cy]="mark.dot.cy"
        [attr.r]="mark.dot.r"
        [attr.stroke-width]="mark.dot.stroke"
      />
    </svg>
    @if (!markOnly()) {
      <span class="name">Dispatchly</span>
    }
  `,
  host: { '[attr.data-size]': 'size()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--brand-gap-dashboard);
      color: var(--ui-text-primary);
      /* The dot is cut out of the surface the mark sits on. */
      --wordmark-cutout: var(--ui-surface);
    }
    .mark {
      width: var(--brand-mark-size-dashboard);
      height: var(--brand-mark-size-dashboard);
      flex: none;
    }
    .dot {
      fill: var(--color-accent-orange);
      stroke: var(--wordmark-cutout);
    }
    .name {
      font-family: var(--font-display);
      font-weight: var(--font-weight-bold);
      font-size: var(--brand-wordmark-size-dashboard);
      letter-spacing: var(--tracking-wordmark);
    }
    :host([data-size='landing-header']) {
      gap: var(--brand-gap-landing-header);
      --wordmark-cutout: var(--color-dark-landing-canvas);
    }
    :host([data-size='landing-header']) .mark {
      width: var(--brand-mark-size-landing-header);
      height: var(--brand-mark-size-landing-header);
    }
    :host([data-size='landing-header']) .name {
      font-size: var(--brand-wordmark-size-landing);
    }
    :host([data-size='landing-footer']) {
      gap: var(--brand-gap-landing-footer);
      --wordmark-cutout: var(--color-dark-landing-canvas);
    }
    :host([data-size='landing-footer']) .mark {
      width: var(--brand-mark-size-landing-footer);
      height: var(--brand-mark-size-landing-footer);
    }
  `,
})
export class Wordmark {
  readonly size = input<'dashboard' | 'landing-header' | 'landing-footer'>('dashboard');
  readonly markOnly = input(false);
  protected readonly mark = tokens.brand.mark;
  protected readonly viewBox = `0 0 ${tokens.brand.mark.viewBox} ${tokens.brand.mark.viewBox}`;
}
