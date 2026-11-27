import { signal } from '@angular/core';
import type { HubConnection } from '@microsoft/signalr';

/**
 * - `connecting`: the first connect.
 * - `live`: connected, groups joined.
 * - `reconnecting`: lost, retrying; the last state stays on screen.
 * - `offline`: automatic reconnect gave up; retrying slowly with a fresh token.
 */
export type HubState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface LiveHubOptions {
  /** A current JWT; called on every connect, so an expired one can be replaced. */
  token: () => Promise<string>;
  /**
   * Runs on the first connect and after every reconnect: join groups, then fetch the snapshot
   * (docs/realtime.md, "Recovery"). Throw to drop the connection and try again later.
   */
  onConnect: (hub: LiveHub) => Promise<void>;
  /** Called when a join was refused because the token is no longer valid. */
  onUnauthorized?: () => void;
}

type Handler = (...args: unknown[]) => void;

/** The backoff from docs/realtime.md, then a slower retry with a fresh token. */
const RECONNECT_DELAYS = [0, 2_000, 5_000, 10_000, 30_000];
const SLOW_RETRY_MS = 30_000;

/**
 * The SignalR connection to `/hubs/live` (docs/realtime.md). The client library loads only when a
 * screen starts a hub. Register handlers with `on` before `start`.
 */
export class LiveHub {
  readonly state = signal<HubState>('connecting');

  private connection?: HubConnection;
  private readonly handlers: [string, Handler][] = [];
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopped = false;

  constructor(private readonly options: LiveHubOptions) {}

  on<A extends unknown[]>(message: string, handler: (...args: A) => void): void {
    // The hub sends what docs/realtime.md says; the handler's parameter types state it.
    const entry: [string, Handler] = [message, handler as unknown as Handler];
    this.handlers.push(entry);
    this.connection?.on(...entry);
  }

  invoke(method: string, ...args: unknown[]): Promise<void> {
    if (!this.connection) return Promise.reject(new Error('The live hub has not started.'));
    return this.connection.invoke(method, ...args);
  }

  async start(): Promise<void> {
    const { HubConnectionBuilder, LogLevel } = await import('@microsoft/signalr');
    if (this.stopped) return;
    const connection = new HubConnectionBuilder()
      .withUrl('/hubs/live', { accessTokenFactory: this.options.token })
      .withAutomaticReconnect(RECONNECT_DELAYS)
      .configureLogging(LogLevel.Warning)
      .build();
    for (const [message, handler] of this.handlers) connection.on(message, handler);
    connection.onreconnecting(() => this.state.set('reconnecting'));
    connection.onreconnected(() => void this.joined());
    connection.onclose(() => {
      if (this.stopped) return;
      this.state.set('offline');
      this.retryLater();
    });
    this.connection = connection;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retry);
    await this.connection?.stop();
  }

  private async connect(): Promise<void> {
    try {
      await this.connection!.start();
    } catch {
      if (this.stopped) return;
      this.state.set('offline');
      this.retryLater();
      return;
    }
    this.attempts = 0;
    await this.joined();
  }

  private async joined(): Promise<void> {
    try {
      await this.options.onConnect(this);
      if (!this.stopped) this.state.set('live');
    } catch (error) {
      if (this.stopped) return;
      const unauthorized =
        error instanceof Error && error.message.endsWith('HubException: unauthorized');
      if (unauthorized) this.options.onUnauthorized?.();
      // Start over: a fresh connection asks for a fresh token. A refused token is replaced
      // straight away; anything else waits its turn in the backoff.
      await this.connection!.stop();
      if (unauthorized && !this.stopped) {
        clearTimeout(this.retry);
        void this.connect();
      }
    }
  }

  /** The same backoff as automatic reconnect, then every 30 s. */
  private retryLater(): void {
    clearTimeout(this.retry);
    const delay = RECONNECT_DELAYS[this.attempts++] ?? SLOW_RETRY_MS;
    this.retry = setTimeout(() => void this.connect(), delay);
  }
}
