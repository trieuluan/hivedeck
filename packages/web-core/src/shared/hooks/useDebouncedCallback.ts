import { useRef, useEffect } from 'react';

/**
 * Returns a debounced version of the callback that delays invocation
 * until after `delay` milliseconds have elapsed since the last call.
 * Also returns a cancel function to clear any pending invocation.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number
): {
  debounced: (...args: Args) => void;
  cancel: () => void;
  flush: () => void;
} {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  const pendingRef = useRef<{
    args: Args;
    callback: (...args: Args) => void;
  } | null>(null);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Return stable function reference
  const debouncedRef = useRef((...args: Args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    pendingRef.current = { args, callback: callbackRef.current };
    timeoutRef.current = setTimeout(() => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      pending?.callback(...pending.args);
    }, delay);
  });

  // Cancel function to clear pending timeout
  const cancelRef = useRef(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    pendingRef.current = null;
  });

  // Flush a pending invocation immediately, preserving its arguments.
  const flushRef = useRef(() => {
    if (!timeoutRef.current || !pendingRef.current) return;
    const pending = pendingRef.current;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    pendingRef.current = null;
    pending.callback(...pending.args);
  });

  return {
    debounced: debouncedRef.current,
    cancel: cancelRef.current,
    flush: flushRef.current,
  };
}
