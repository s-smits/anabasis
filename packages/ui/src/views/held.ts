import { useState } from "react";
import { useWaited } from "../waited.ts";

/*
 * What a detail shows while the next is read: the last ready view stays, marked busy and closed to the
 * pointer, rather than a "Reading …" line flashing on every card or file chosen; the loading line comes
 * only past the page's patience (`waited.ts`). The last view is kept as the render finds it, with no
 * effect between.
 */

/** The view to show: the one ready now, else the last that was; `stale` where it is the last, and
 *  `slow` once the read has outlasted the patience. */
interface Held<View> {
  readonly view: View | null;
  readonly stale: boolean;
  readonly slow: boolean;
}

/** `asked` names the request now, or null to let the last view go; `ready` is its answer's view, or
 *  null while read, compared by identity, so pass an answer as `live.ts` keeps it or a view
 *  memoised on one. */
export function useHeld<View>(asked: string | null, ready: View | null): Held<View> {
  const [last, setLast] = useState<View | null>(ready);
  const kept = asked === null ? null : (ready ?? last);
  if (kept !== last) setLast(kept);
  const slow = useWaited(asked !== null && ready === null ? asked : null);
  if (asked === null) return { view: null, stale: false, slow: false };
  if (ready !== null) return { view: ready, stale: false, slow: false };
  return { view: last, stale: last !== null, slow };
}
