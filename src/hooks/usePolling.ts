import { useEffect, useRef } from 'react';

/**
 * Poll a function at a fixed interval with automatic cleanup.
 * Calls `fn` immediately on mount, then every `intervalMs`.
 * Skips stale responses via a cancellation flag.
 *
 * @param fn - Async function to poll. Receives `cancelled()` checker.
 * @param intervalMs - Polling interval in milliseconds.
 * @param deps - Dependency array (re-creates the polling loop when changed).
 * @param enabled - Set to false to pause polling (default: true).
 */
export default function usePolling(
  fn: (cancelled: () => boolean) => Promise<void>,
  intervalMs: number,
  deps: React.DependencyList,
  enabled = true
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let isCancelled = false;
    const cancelled = () => isCancelled;

    const run = () => fnRef.current(cancelled);

    run();
    const interval = setInterval(run, intervalMs);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled, ...deps]);
}
