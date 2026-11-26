/**
 * Open pull requests that repeat another open pull request's commits: a head that holds another's
 * head without standing on it lists that one's commits as its own, as a `gh stack link` above a top
 * that never took in the one beneath it does. `bun run land` refuses a landing that holds one, and
 * `stack.ts` lists them, each with the base that mends it.
 */
import { git, gitSays } from "./gate.ts";
import { beneath, type Pull } from "./pulls.ts";

export function doubled(
  open: readonly Pull[],
  holds: (head: string, other: string) => boolean,
): { readonly pull: Pull; readonly repeats: readonly Pull[] }[] {
  return open.flatMap((pull) => {
    const below = beneath(open, pull);
    const repeats = open.filter(
      (other) =>
        other !== pull &&
        !below.includes(other) &&
        !beneath(open, other).includes(pull) &&
        holds(pull.headRefOid, other.headRefOid),
    );
    return repeats.length === 0 ? [] : [{ pull, repeats }];
  });
}

/** One line for each open pull request that repeats another's commits, read after fetching every
 *  open head, naming the head it should stand on: of the pull requests it repeats, the one whose
 *  head holds all the others'. */
export function doubledLines(
  root: string,
  open: readonly Pull[],
  about: (pull: Pull, repeats: readonly Pull[]) => boolean = () => true,
): string[] {
  if (open.length > 0) git(root, ["fetch", "-q", "origin", ...open.map((pull) => pull.headRefOid)]);
  const holds = (head: string, other: string) => gitSays(root, ["merge-base", "--is-ancestor", other, head]);
  const kept = doubled(open, holds).filter(({ pull, repeats }) => about(pull, repeats));
  return kept.map(({ pull, repeats }) => {
    const nearest = repeats.find((one) =>
      repeats.every((other) => other === one || holds(one.headRefOid, other.headRefOid)),
    );
    const named = repeats.map((other) => `#${String(other.number)}`).join(", ");
    const mend =
      nearest === undefined
        ? "split it from those it holds"
        : `base it on ${nearest.headRefName}, and link its native stack in that order`;
    return `#${String(pull.number)} (${pull.headRefName}, on ${pull.baseRefName}) repeats the commits of ${named}: ${mend}.`;
  });
}
