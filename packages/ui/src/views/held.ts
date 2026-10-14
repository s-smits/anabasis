import { useEffect, useState } from "react";

/*
 * What a detail shows while the next is read. `live.ts` says that an answer to the previous request
 * is no answer to the one asked now, and every caller used to put a loading line in its place at
 * once: on 14 October a browser test counted the harness strip's files and the inspector replaced
 * by "Reading …" for one to three frames on every card chosen and every file opened, on a server
 * that answered within 20 ms. Here the last view that was ready stays while the next is read, the
 * part it stands in marked busy and closed to the pointer, and the loading line comes only once
 * the read has taken longer than `PATIENCE_MS`, so a quick answer replaces the last with no frame
 * between, and a slow one still says that it is reading.
 */

/** How long a read may take before its place says it is reading. */
const PATIENCE_MS = 300;

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
  const [late, setLate] = useState<string | null>(null);
  const waiting = asked !== null && ready === null;
  useEffect(() => {
    if (asked === null) setLast(null);
    if (ready === null) return;
    setLast(ready);
    setLate(null);
  }, [asked, ready]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setLate(asked), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [waiting, asked]);
  if (asked === null) return { view: null, stale: false, slow: false };
  if (ready !== null) return { view: ready, stale: false, slow: false };
  return { view: last, stale: last !== null, slow: late === asked };
}
