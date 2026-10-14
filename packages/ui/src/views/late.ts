import { useEffect, useState } from "react";
import type { Live } from "../live.ts";

/*
 * A read that is still running, said only once it has run long enough to be noticed.
 *
 * The Log pane put a "Reading the log" placeholder in its table's place for every page and every
 * filter, and the Tasks pane hid its grid behind "Reading the task" for every task opened, each for
 * the few frames the local server takes to answer (seen in the browser tests of 14 October): a
 * flash on every click. DESIGN.md asks for the previous content to stay until its replacement is
 * ready, and so the panes keep it; a read that takes longer than `LATE_MS` is then marked as
 * running, so a slow server is still said, and a fast one never flickers.
 */

/** How long a read runs before the page says so. */
const LATE_MS = 250;

/** How long a level of the Moves pane waits, with the previous on screen, before it is late. */
const PATIENCE_MS = 400;

/** Whether the read `live` holds has run for `LATE_MS` without an answer, or a failure; null is no
 *  read asked for. */
export function useLate(live: Pick<Live<unknown>, "current" | "error"> | null): boolean {
  const running = live !== null && !live.current && live.error === null;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!running) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), LATE_MS);
    return () => clearTimeout(timer);
  }, [running]);
  return running && late;
}

/** Whether `waiting`, the request still without its answer, has waited past the patience; null
 *  while nothing waits. A level of the Moves pane asks it of the move and solve it opens. */
export function useLateFor(waiting: string | null): boolean {
  const [late, setLate] = useState<string | null>(null);
  // Reset as the wait ends, during render, so that the same request asked again waits afresh.
  if (waiting === null && late !== null) setLate(null);
  useEffect(() => {
    if (waiting === null) return undefined;
    const timer = setTimeout(() => setLate(waiting), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return waiting !== null && late === waiting;
}
