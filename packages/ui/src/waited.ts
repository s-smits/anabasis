import { useCallback, useState, useSyncExternalStore } from "react";

/*
 * How long a read may run before the page says it is reading, and the one clock that says when it
 * has. Every read keeps what it replaces on screen until its answer comes (DESIGN.md), and says
 * that it is reading only past `PATIENCE_MS`, so a quick answer replaces the last with no frame
 * between, and a slow one is still said. On 14 October the shell, the Campaign pane's detail and
 * the Log and Tasks panes each held a timer of their own for this, in an effect, at 400, 300 and
 * 250 ms. This is the one: a store React reads (`useSyncExternalStore`), whose subscription is the
 * wait, begun and ended with what is waited on.
 */

/** How long a read runs before the page says so. */
const PATIENCE_MS = 400;

/** True once the wait named `on` has run `PATIENCE_MS` unbroken; null waits on nothing, and a wait
 *  under a new name, or one that broke, begins afresh. */
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
