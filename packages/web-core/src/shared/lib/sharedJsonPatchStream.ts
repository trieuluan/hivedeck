// sharedJsonPatchStream.ts — one WebSocket per JSON-patch stream endpoint,
// shared by every component that subscribes to it.
//
// Why: each `useJsonPatchWsStream` call used to open its own socket, so a page
// with seven `useApprovals()` callers opened seven identical sockets, and every
// route change (doubled by React StrictMode in dev) opened and dropped dozens
// more. Chromium lets only one WebSocket handshake per host proceed at a time,
// so the chat's socket queued behind abandoned ones for 20–160 s. Sharing the
// connection, and keeping it a few seconds after the last subscriber leaves,
// removes that churn.
import { produce } from 'immer';
import type { Operation } from 'rfc6902';
import { applyUpsertPatch } from '@/shared/lib/jsonPatch';
import { openLocalApiWebSocket } from '@/shared/lib/localApiTransport';

type WsMsg =
  | { JsonPatch: Operation[] }
  | { Ready: true }
  | { finished: boolean };

export interface StreamSnapshot<T> {
  data: T | undefined;
  isConnected: boolean;
  isInitialized: boolean;
  error: string | null;
}

/** How long a stream stays open after its last subscriber leaves. */
export const STREAM_CLOSE_GRACE_MS = 3000;

class SharedStream<T extends object> {
  private snapshot: StreamSnapshot<T>;
  private readonly listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private opening = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempts = 0;
  private finished = false;
  private disposed = false;

  constructor(
    private readonly endpoint: string,
    private readonly initialData: () => T,
    private readonly onDispose: () => void,
    private readonly onRevive: () => void
  ) {
    this.snapshot = {
      data: initialData(),
      isConnected: false,
      isInitialized: false,
      error: null,
    };
    // Looked up during a render that never subscribes (discarded render):
    // don't keep it forever.
    this.scheduleClose();
  }

  private scheduleClose() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.dispose(), STREAM_CLOSE_GRACE_MS);
  }

  getSnapshot = (): StreamSnapshot<T> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) {
      // A component kept this instance across its close: bring it back
      // with fresh state; the server resends everything on connect.
      this.disposed = false;
      this.finished = false;
      this.retryAttempts = 0;
      this.snapshot = {
        data: this.initialData(),
        isConnected: false,
        isInitialized: false,
        error: null,
      };
      this.onRevive();
    }
    this.listeners.add(listener);
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.ensureOpen();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.scheduleClose();
    };
  };

  private set(patch: Partial<StreamSnapshot<T>>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private ensureOpen() {
    if (this.ws || this.opening || this.finished || this.retryTimer) return;
    this.opening = true;
    void (async () => {
      let ws: WebSocket;
      try {
        ws = await openLocalApiWebSocket(this.endpoint);
      } catch (error) {
        this.opening = false;
        if (this.disposed) return;
        console.error('Failed to open WebSocket stream:', error);
        this.scheduleReconnect();
        return;
      }
      this.opening = false;
      if (this.disposed) {
        ws.close();
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.retryAttempts = 0;
        this.set({ isConnected: true, error: null });
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMsg = JSON.parse(event.data);
          if ('JsonPatch' in msg) {
            const current = this.snapshot.data;
            if (!msg.JsonPatch.length || !current) return;
            const next = produce(current, (draft) => {
              applyUpsertPatch(draft, msg.JsonPatch);
            });
            this.set({ data: next });
          }
          if ('Ready' in msg) {
            this.set({ isInitialized: true, error: null });
          }
          // Terminal: keep the data, do not reconnect.
          if ('finished' in msg) {
            this.finished = true;
            ws.close(1000, 'finished');
            this.ws = null;
            this.set({ isConnected: false });
          }
        } catch (err) {
          console.error('Failed to process WebSocket message:', err);
          this.set({ error: 'Failed to process stream update' });
        }
      };

      ws.onclose = (evt) => {
        if (this.ws === ws) this.ws = null;
        if (this.disposed) return;
        this.set({ isConnected: false });
        if (this.finished || (evt?.code === 1000 && evt?.wasClean)) return;
        this.retryAttempts += 1;
        if (!this.snapshot.isInitialized && this.retryAttempts > 6) {
          this.set({ error: 'Connection failed' });
        }
        this.scheduleReconnect();
      };
    })();
  }

  private scheduleReconnect() {
    if (this.retryTimer || this.disposed) return;
    // Exponential backoff: 1s, 2s, 4s, then 8s.
    const delay = Math.min(8000, 1000 * Math.pow(2, this.retryAttempts));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.listeners.size > 0) this.ensureOpen();
    }, delay);
  }

  private dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.retryTimer = null;
    this.closeTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    }
    this.onDispose();
  }
}

const streams = new Map<string, SharedStream<object>>();

/** The shared stream for an endpoint, created on first use. */
export function getSharedJsonPatchStream<T extends object>(
  endpoint: string,
  initialData: () => T
): SharedStream<T> {
  let stream = streams.get(endpoint) as SharedStream<T> | undefined;
  if (!stream) {
    const created: SharedStream<T> = new SharedStream<T>(
      endpoint,
      initialData,
      () => {
        if (streams.get(endpoint) === (created as unknown))
          streams.delete(endpoint);
      },
      () => {
        if (!streams.has(endpoint))
          streams.set(endpoint, created as unknown as SharedStream<object>);
      }
    );
    stream = created;
    streams.set(endpoint, stream as unknown as SharedStream<object>);
  }
  return stream;
}

/** Test helper: number of live shared streams. */
export function sharedStreamCount(): number {
  return streams.size;
}
