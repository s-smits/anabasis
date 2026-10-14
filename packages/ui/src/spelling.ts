import { useEffect } from "react";
import type { Navigation } from "./route.ts";

/*
 * The address written back in its one spelling once the campaigns are read. The route is read from
 * the address (`route.ts`), and the selection from the route and the list (`selectionOf`,
 * `shell.tsx`); where the address leaves the campaign out, names one the list does not hold, names a
 * pane the page does not have, a move or an event that is no place in a log, or a parameter the route
 * does not read, the shown selection is written back without a new history entry. Until 14 October
 * only a campaign or a project that differed was written back, so the rest stayed in the address and
 * a click on the pane already open pushed a second entry. Writing the history is a side effect of a
 * render's result, so it is an effect, and it stands in this hook rather than in a component (the
 * operator's rule of 14 October, after github.com/alejandrobailo/no-use-effect).
 */

/** What the address is written from: whether the list is read, the selection, and the navigation. */
interface Shown {
  readonly listed: boolean;
  readonly project: string | null;
  readonly campaign: string | null;
  readonly navigation: Navigation;
}

/** Replace the address with the route's spelling of what is shown; `navigate` changes nothing where
 *  that spelling already holds, so no history entry is added. */
export function useSpelledAddress({ listed, project, campaign, navigation }: Shown): void {
  const { route, replace } = navigation;
  useEffect(() => {
    if (!listed) return;
    replace({ project, campaign });
  }, [listed, project, campaign, route, replace]);
}
