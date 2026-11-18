// streamJsonPatchEntries.ts - WebSocket JSON patch streaming utility
import { produce } from 'immer';
import type { Operation } from 'rfc6902';
import { applyUpsertPatch } from '@/shared/lib/jsonPatch';
import { openLocalApiWebSocket } from '@/shared/lib/localApiTransport';

type PatchContainer<E = unknown> = { entries: E[] };

export interface StreamOptions<E = unknown> {
  initial?: PatchContainer<E>;
  /** called after each successful patch application */
  onEntries?: (entries: E[]) => void;
  onConnect?: () => void;
  onError?: (err: unknown) => void;
  /** called once when a "finished" event is received */
  onFinished?: (entries: E[]) => void;
}

interface StreamController<E = unknown> {
  /** Current entries array (immutable snapshot) */
  getEntries(): E[];
  /** Full { entries } snapshot */
  getSnapshot(): PatchContainer<E>;
  /** Best-effort connection state */
  isConnected(): boolean;
  /** Subscribe to updates; returns an unsubscribe function */
  onChange(cb: (entries: E[]) => void): () => void;
  /** Close the stream */
  close(): void;
}

/**
 * Connect to a WebSocket endpoint that emits JSON messages containing:
 *   {"JsonPatch": [{"op": "add", "path": "/entries/0", "value": {...}}, ...]}
 *   {"Finished": ""}
 *
 * Maintains an in-memory { entries: [] } snapshot and returns a controller.
 *
 * Messages are batched per animation frame and applied using immer for
 * structural sharing, avoiding a full deep clone on every message.
 */
export function streamJsonPatchEntries<E = unknown>(
  url: string,
  opts: StreamOptions<E> = {}
): StreamController<E> {
  let connected = false;
  let closed = false;
  let ws: WebSocket | null = null;
  let snapshot: PatchContainer<E> = structuredClone(
    opts.initial ?? ({ entries: [] } as PatchContainer<E>)
  );

  const subscribers = new Set<(entries: E[]) => void>();
  if (opts.onEntries) subscribers.add(opts.onEntries);

  // --- rAF batching state ---
  let pendingOps: Operation[] = [];
  let rafId: number | null = null;

  const notify = () => {
    for (const cb of subscribers) {
      try {
        cb(snapshot.entries);
      } catch {
        /* swallow subscriber errors */
      }
    }
  };

  const flush = () => {
    rafId = null;
    if (pendingOps.length === 0) return;

    const ops = dedupeOps(pendingOps);
    pendingOps = [];

    snapshot = produce(snapshot, (draft) => {
      applyUpsertPatch(draft, ops);
    });
    notify();
  };

  const handleMessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data);

      // Handle JsonPatch messages — accumulate ops for next rAF flush
      if (msg.JsonPatch) {
        const raw = msg.JsonPatch as Operation[];
        pendingOps.push(...raw);
        if (rafId === null) {
          rafId = requestAnimationFrame(flush);
        }
      }

      // Handle Finished messages — flush synchronously before closing
      if (msg.finished !== undefined) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        flush();
        opts.onFinished?.(snapshot.entries);
        ws?.close();
      }
    } catch (err) {
      opts.onError?.(err);
    }
  };

  void (async () => {
    try {
      const opened = await openLocalApiWebSocket(url);

      if (closed) {
        opened.close();
        return;
      }

      ws = opened;
      ws.addEventListener('open', () => {
        connected = true;
        opts.onConnect?.();
      });

      ws.addEventListener('message', handleMessage);

      ws.addEventListener('error', (err) => {
        connected = false;
        opts.onError?.(err);
      });

      ws.addEventListener('close', () => {
        connected = false;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      });
    } catch (error) {
      if (!closed) {
        opts.onError?.(error);
      }
    }
  })();

  return {
    getEntries(): E[] {
      return snapshot.entries;
    },
    getSnapshot(): PatchContainer<E> {
      return snapshot;
    },
    isConnected(): boolean {
      return connected;
    },
    onChange(cb: (entries: E[]) => void): () => void {
      subscribers.add(cb);
      // push current state immediately
      cb(snapshot.entries);
      return () => subscribers.delete(cb);
    },
    close(): void {
      closed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      ws?.close();
      subscribers.clear();
      connected = false;
    },
  };
}

/**
 * Collapse ops that touch the same path within one batch, so a streaming
 * entry updated many times in a frame is applied once.
 *
 * - Paths keep the order they first appeared in, so a new entry that is
 *   updated later in the batch is still inserted before entries added after
 *   it (keeping indices right).
 * - `add` then `replace` on a path becomes one `add` with the final value.
 * - A batch with `remove`, `move` or `copy` is returned unchanged: those
 *   shift indices, so merging by path would be unsafe.
 *
 * Example:
 *   add /e/1 a, add /e/2 b, replace /e/1 c  ->  add /e/1 c, add /e/2 b
 */
export function dedupeOps(ops: Operation[]): Operation[] {
  if (ops.some((op) => op.op !== 'add' && op.op !== 'replace')) {
    return ops;
  }
  const byPath = new Map<string, Operation>();
  for (const op of ops) {
    const previous = byPath.get(op.path);
    if (previous && previous.op === 'add' && op.op === 'replace') {
      byPath.set(op.path, { ...previous, value: op.value });
    } else {
      // First write, or a later add/replace that supersedes it. Map keeps the
      // first-seen insertion order of the key.
      byPath.set(op.path, op);
    }
  }
  return [...byPath.values()];
}
