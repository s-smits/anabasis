import { useWaited } from "../waited.ts";
import type { Live } from "../live.ts";

/*
 * A read that is still running, said only once it has outlasted the page's patience (`waited.ts`): the
 * panes keep the previous content until its replacement is ready (DESIGN.md), so a slow server is still
 * said and a fast one never flickers.
 */

/** Whether the read `live` holds has outlasted the page's patience without an answer or a failure;
 *  null is no read asked for. */
export function useLate(live: Pick<Live<unknown>, "current" | "error"> | null): boolean {
  const running = live !== null && !live.current && live.error === null;
  return useWaited(running ? "read" : null);
}
