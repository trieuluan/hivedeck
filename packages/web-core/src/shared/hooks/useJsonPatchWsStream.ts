import { useCallback, useSyncExternalStore } from 'react';
import {
  getSharedJsonPatchStream,
  type StreamSnapshot,
} from '@/shared/lib/sharedJsonPatchStream';

interface UseJsonPatchStreamResult<T> {
  data: T | undefined;
  isConnected: boolean;
  isInitialized: boolean;
  error: string | null;
}

const DISABLED: StreamSnapshot<never> = {
  data: undefined,
  isConnected: false,
  isInitialized: false,
  error: null,
};

const noopSubscribe = () => () => {};
const disabledSnapshot = () => DISABLED;

/**
 * Consume a WebSocket stream of JSON-patch messages (`{JsonPatch}`, `{Ready}`,
 * `{finished}`) applied to an object built by `initialData`.
 *
 * Every caller with the same endpoint shares one connection and one copy of
 * the data (see `sharedJsonPatchStream`); a newcomer gets the current state
 * immediately instead of opening another socket. `initialData` is used by the
 * first subscriber of an endpoint.
 */
export const useJsonPatchWsStream = <T extends object>(
  endpoint: string | undefined,
  enabled: boolean,
  initialData: () => T
): UseJsonPatchStreamResult<T> => {
  const active = enabled && !!endpoint;

  // The stream is looked up per endpoint; `initialData` only matters the
  // first time, so it is deliberately left out of the dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stream = active
    ? getSharedJsonPatchStream(endpoint!, initialData)
    : null;

  const subscribe = useCallback(
    (onChange: () => void) =>
      stream ? stream.subscribe(onChange) : noopSubscribe(),
    [stream]
  );
  const getSnapshot = stream ? stream.getSnapshot : disabledSnapshot;

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot as () => StreamSnapshot<T>
  );
  return snapshot;
};
