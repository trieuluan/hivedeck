import { useCallback, useEffect, useRef, useState } from 'react';

export type Notice = { kind: 'ok' | 'error'; text: string };

export function useNotice(ms = 6000) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback(
    (next: Notice | null) => {
      clearTimeout(timer.current);
      setNotice(next);
      if (next?.kind === 'ok')
        timer.current = setTimeout(() => setNotice(null), ms);
    },
    [ms]
  );
  return [notice, show] as const;
}

export const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);
