import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient, type Api } from '../api/api-client';

export type Role = Api['Role'];
export type Session = Api['DemoSession'];

const KEY = 'dispatchly.session';
/** Sign in again when a token has less than this left, so a call never goes out on an expiring one. */
const MARGIN_MS = 60_000;

function stored(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/**
 * The demo sign-in (`POST /auth/demo`, PLAN.md §1.3): one click gives a JWT for a role. The token
 * lives in sessionStorage for the tab. W8 adds the role picker and route guards on top of this.
 */
@Injectable({ providedIn: 'root' })
export class DemoSession {
  private readonly api = inject(ApiClient);
  private pending?: Promise<Session>;

  readonly current = signal<Session | null>(stored());

  /** A session for `role` with time left on it: the one held, or a fresh demo sign-in. */
  signIn(role: Role): Promise<Session> {
    const held = this.current();
    if (held && held.role === role && Date.parse(held.expiresAt) - Date.now() > MARGIN_MS) {
      return Promise.resolve(held);
    }
    this.pending ??= firstValueFrom(this.api.post('/api/v1/auth/demo', { body: { role } }))
      .then((session) => {
        sessionStorage.setItem(KEY, JSON.stringify(session));
        this.current.set(session);
        return session;
      })
      .finally(() => (this.pending = undefined));
    return this.pending;
  }

  /** Drops the token, e.g. after the server refused it; the next `signIn` gets a new one. */
  expire(): void {
    sessionStorage.removeItem(KEY);
    this.current.set(null);
  }
}

/** Sends the session's token with every API call. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(DemoSession).current()?.token;
  return token && request.url.startsWith('/api/')
    ? next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))
    : next(request);
};
