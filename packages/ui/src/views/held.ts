import { useState } from "react";
import { useWaited } from "../waited.ts";

/*
 * What a detail shows while the next is read. `live.ts` says that an answer to the previous request
 * is no answer to the one asked now, and every caller used to put a loading line in its place at
 * once: on 14 October a browser test counted the harness strip's files and the inspector replaced
 * by "Reading …" for one to three frames on every card chosen and every file opened, on a server
 * that answered within 20 ms. Here the last view that was ready stays while the next is read, the
 * part it stands in marked busy and closed to the pointer, and the loading line comes only once
 * the read has outlasted the page's patience (`waited.ts`), so a quick answer replaces the last
 * with no frame between, and a slow one still says that it is reading. The last view is kept as
 * the render finds it, with no effect between.
 */

/** The view to show: the one ready now, else the last that was; `stale` where it is the last, and
 *  `slow` once the read has outlasted the patience. */
export interface Held<View> {
  readonly view: View | null;
  readonly stale: boolean;
  readonly slow: boolean;
}

/** `asked` names the request now, or null while none is made, which lets the last view go; `ready`
 *  is the view of its answer, or null while it is read. `ready` is compared by identity, so a caller
 *  passes an answer as `live.ts` keeps it or a view memoised on one. */
export function useHeld<View>(asked: string | null, ready: View | null): Held<View> {
  const [last, setLast] = useState<View | null>(ready);
  const kept = asked === null ? null : (ready ?? last);
  if (kept !== last) setLast(kept);
  const slow = useWaited(asked !== null && ready === null ? asked : null);
  if (asked === null) return { view: null, stale: false, slow: false };
  if (ready !== null) return { view: ready, stale: false, slow: false };
  return { view: last, stale: last !== null, slow };
}
