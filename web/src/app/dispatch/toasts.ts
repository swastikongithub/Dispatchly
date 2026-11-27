import { Component, DestroyRef, inject, signal } from '@angular/core';
import { tokens } from '../tokens';

interface Toast {
  id: number;
  text: string;
}

const DISMISS_MS = parseFloat(tokens.motion.duration.toastDismiss);
const MAX_VISIBLE = tokens.motion.toast.maxVisible;

/**
 * Toasts (PLAN.md §6.3): slide up in 220 ms, go after 4 s, at most 2 on screen. Announced
 * politely. Not in the designs, so drawn as a small panel (§5.5).
 */
@Component({
  selector: 'app-toasts',
  template: `
    <ol aria-live="polite" aria-atomic="false">
      @for (toast of toasts(); track toast.id) {
        <li class="ui-panel" animate.enter="toast-in" animate.leave="toast-out">
          {{ toast.text }}
        </li>
      }
    </ol>
  `,
  styles: `
    :host {
      display: block;
      pointer-events: none;
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-8);
    }
    li {
      padding: var(--spacing-11) var(--spacing-16);
      border-radius: var(--radius-item);
      font-size: var(--text-meta);
      font-weight: var(--font-weight-semibold);
      color: var(--ui-text-primary);
    }
    .toast-in {
      animation: toast-in var(--duration-base) var(--ease-enter);
    }
    .toast-out {
      animation: toast-out var(--duration-base) var(--ease-exit) forwards;
    }
    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(100%);
      }
    }
    @keyframes toast-out {
      to {
        opacity: 0;
      }
    }
  `,
})
export class Toasts {
  protected readonly toasts = signal<readonly Toast[]>([]);
  private next = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
  }

  show(text: string): void {
    const toast = { id: this.next++, text };
    this.toasts.update((list) => [...list, toast].slice(-MAX_VISIBLE));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.toasts.update((list) => list.filter((t) => t !== toast));
    }, DISMISS_MS);
    this.timers.add(timer);
  }
}
