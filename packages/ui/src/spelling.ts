import { useMountEffect } from "./mount.ts";
import { changedRoute, type Navigation, searchOf } from "./route.ts";

/*
 * The address written back in its one spelling once the campaigns are read. The route is read from
 * the address (`route.ts`), and the selection from the route and the list (`selectionOf`,
 * `shell.tsx`); where the address leaves the campaign out, names one the list does not hold, names a
 * pane the page does not have, a move or an event that is no place in a log, or a parameter the route
 * does not read, the shown selection is written back without a new history entry. Until 14 October
 * only a campaign or a project that differed was written back, so the rest stayed in the address and
 * a click on the pane already open pushed a second entry.
 *
 * Writing the history acts on the world, so it is done as a component mounts (`mount.ts`): the shell
 * mounts `SpelledAddress` only where the address differs from its spelling, keyed by that spelling,
 * so each spelling is written once, and an address that already holds it mounts nothing.
 */

/** What the address is spelled from: the selection shown, and the navigation that writes it. */
interface Shown {
  readonly project: string | null;
  readonly campaign: string | null;
  readonly navigation: Navigation;
}

/** What the address is now and what it is spelled as, as one key, or null where the two agree. A page
 *  rendered without a window has no address to spell. */
export function respelled({ project, campaign, navigation }: Shown): string | null {
  const spelled = searchOf(changedRoute(navigation.route, { project, campaign }));
  const now = typeof window === "undefined" ? spelled : window.location.search;
  return spelled === now ? null : `${now} ${spelled}`;
}

/** Writes the shown selection's spelling into the address as it mounts, with no history entry. */
export function SpelledAddress({ project, campaign, navigation }: Shown): null {
  useMountEffect(() => navigation.replace({ project, campaign }));
  return null;
}
