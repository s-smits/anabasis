import { useEffect, useState } from "react";

/*
 * Whether a state has held for a while without a break: the shell keeps the previous campaign on
 * screen while the next is read and says it is reading only past a wait (`PENDING_MS`, `shell.tsx`).
 * A timer is the one thing here that needs an effect, and it stands in this hook rather than in a
 * component (the operator's rule of 14 October, after github.com/alejandrobailo/no-use-effect).
 */

/** What is waited on: whether the state holds now, and for how long it must. */
interface Waiting {
  readonly holding: boolean;
  readonly ms: number;
}

/** True once `holding` has been true for `ms` without a break; false again the moment it is not. */
export function useWaited({ holding, ms }: Waiting): boolean {
  const [waited, setWaited] = useState(false);
  // Reset in render, so that a state that broke and holds again waits afresh.
  if (!holding && waited) setWaited(false);
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setWaited(true), ms);
    return () => clearTimeout(timer);
  }, [holding, ms]);
  return holding && waited;
}
