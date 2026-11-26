import { useMountEffect } from "./mount.ts";
import { changedRoute, type Navigation, searchOf } from "./route.ts";

/*
 * The address written back in its one spelling once the campaigns are read: where it leaves the
 * campaign out, names what the list or page does not hold, or carries a parameter the route does not
 * read, the shown selection replaces it with no new history entry. Writing the history acts on the
 * world, so `SpelledAddress` does it as it mounts (`mount.ts`), keyed by the spelling, so each is
 * written once.
 */

interface Shown {
  readonly project: string | null;
  readonly campaign: string | null;
  readonly navigation: Navigation;
}

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
