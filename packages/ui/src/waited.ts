import { useCallback, useState, useSyncExternalStore } from "react";

/*
 * How long a read may run before the page says it is reading, as one clock: every read keeps what it
 * replaces on screen until its answer comes (DESIGN.md) and says so only past `PATIENCE_MS`. It is a
 * store React reads (`useSyncExternalStore`), whose subscription is the wait, in place of a timer in
 * each pane's effect.
 */

const PATIENCE_MS = 400;

/** True once the wait named `on` has run `PATIENCE_MS` unbroken; null waits on nothing, and a new
 *  name or a broken wait begins afresh. */
export function useWaited(on: string | null): boolean {
  const [clock] = useState<{ due: string | null }>(() => ({ due: null }));
  const subscribe = useCallback(
    (notify: () => void) => {
      clock.due = null;
      if (on === null) return () => undefined;
      const timer = setTimeout(() => {
        clock.due = on;
        notify();
      }, PATIENCE_MS);
      return () => clearTimeout(timer);
    },
    [clock, on],
  );
  const read = () => clock.due;
  const due = useSyncExternalStore(subscribe, read, read);
  return on !== null && due === on;
}
