import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number; wasClean: boolean }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

vi.mock('@/shared/lib/localApiTransport', () => ({
  openLocalApiWebSocket: async (url: string) => new FakeSocket(url),
}));

const { getSharedJsonPatchStream, sharedStreamCount, STREAM_CLOSE_GRACE_MS } =
  await import('./sharedJsonPatchStream');

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('shared JSON-patch streams', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });
  afterEach(async () => {
    vi.useRealTimers();
  });

  it('opens one socket for many subscribers of the same endpoint', async () => {
    const s1 = getSharedJsonPatchStream('/a', () => ({ items: {} }));
    const s2 = getSharedJsonPatchStream('/a', () => ({ items: {} }));
    expect(s1).toBe(s2);
    const off1 = s1.subscribe(() => {});
    const off2 = s2.subscribe(() => {});
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);
    off1();
    off2();
  });

  it('gives a late subscriber the current data without a new socket', async () => {
    const s = getSharedJsonPatchStream('/b', () => ({ items: {} }));
    const off1 = s.subscribe(() => {});
    await flush();
    FakeSocket.instances[0]!.emit({
      JsonPatch: [{ op: 'add', path: '/items/x', value: 1 }],
    });
    FakeSocket.instances[0]!.emit({ Ready: true });
    const off2 = s.subscribe(() => {});
    expect(s.getSnapshot().data).toEqual({ items: { x: 1 } });
    expect(s.getSnapshot().isInitialized).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
    off1();
    off2();
  });

  it('keeps the socket through a quick unsubscribe/resubscribe', async () => {
    vi.useFakeTimers();
    const s = getSharedJsonPatchStream('/c', () => ({ items: {} }));
    const off = s.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync();
    off();
    await vi.advanceTimersByTimeAsync(STREAM_CLOSE_GRACE_MS - 100);
    const again = s.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(STREAM_CLOSE_GRACE_MS * 2);
    expect(FakeSocket.instances.filter((w) => w.url === '/c')).toHaveLength(1);
    expect(FakeSocket.instances[0]!.closed).toBe(false);
    again();
  });

  it('closes after the grace period and reopens fresh when revived', async () => {
    vi.useFakeTimers();
    const s = getSharedJsonPatchStream('/d', () => ({ items: {} }));
    const before = sharedStreamCount();
    const off = s.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync();
    FakeSocket.instances[0]!.emit({
      JsonPatch: [{ op: 'add', path: '/items/y', value: 2 }],
    });
    off();
    await vi.advanceTimersByTimeAsync(STREAM_CLOSE_GRACE_MS + 10);
    expect(FakeSocket.instances[0]!.closed).toBe(true);
    expect(sharedStreamCount()).toBe(before - 1);

    const revived = s.subscribe(() => {});
    await vi.runOnlyPendingTimersAsync();
    expect(s.getSnapshot().data).toEqual({ items: {} });
    expect(FakeSocket.instances.filter((w) => w.url === '/d')).toHaveLength(2);
    expect(sharedStreamCount()).toBe(before);
    revived();
  });
});
