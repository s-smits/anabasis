import { useEffect } from "react";

/*
 * The page's one effect, and the only place one may be written (`ana/no-react-effect`): an effect runs
 * after its frame has painted, so what it sets is drawn a frame late. What is left is a component that
 * acts once on the world as it mounts, keyed by what it acts on, so a new act is a new mount and no
 * dependency list is read.
 */

export function useMountEffect(effect: () => void | (() => void)): void {
  useEffect(effect, []);
}
