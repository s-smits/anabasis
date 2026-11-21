import { useWaited } from "../waited.ts";
import type { Live } from "../live.ts";

/*
 * A read that is still running, said only once it has run long enough to be noticed.
 *
 * A pane that put a "Reading the log" placeholder in its table's place for every page and every
 * filter, or hid its grid behind "Reading the task" for every task opened, each for the few frames
 * the local server takes to answer, would flash on every click. DESIGN.md asks for the previous
 * content to stay until its replacement is ready, and so the panes keep it; a read that outlasts
 * the page's patience (`waited.ts`) is then marked as running, so a slow server is still said, and
 * a fast one never flickers.
 */

/** Whether the read `live` holds has outlasted the page's patience without an answer or a failure;
 *  null is no read asked for. */
export function useLate(live: Pick<Live<unknown>, "current" | "error"> | null): boolean {
  const running = live !== null && !live.current && live.error === null;
  return useWaited(running ? "read" : null);
}
