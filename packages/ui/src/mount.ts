import { useEffect } from "react";

/*
 * The page's one effect, and the only place it may be written (`ana/no-react-effect`). An effect
 * runs after its frame has painted, so what it sets is drawn a frame late and what it reads is the
 * last render's, which shows as loading lines flashed for a few frames and focus left on the page's
 * body, so no component holds one (the operator's rule, after
 * github.com/alejandrobailo/no-use-effect). What is left is a component that acts once on
 * the world as it mounts: it is mounted where the act is due, and keyed by what it acts on, so a
 * new act is a new mount and no dependency list is read.
 */

/** Run `effect` once as the component mounts, and its cleanup as it unmounts. */
export function useMountEffect(effect: () => void | (() => void)): void {
  useEffect(effect, []);
}
