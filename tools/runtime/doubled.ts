#!/usr/bin/env bun
/**
 * Open pull requests that repeat another open pull request's commits.
 *
 *   bun tools/runtime/doubled.ts [--pull <number>]
 *
 * A pull request shows the commits from its base to its head, so where its head holds the head of
 * another open pull request that is not on its chain of bases, it lists that one's commits as its
 * own. On 30 October 2026 `gh stack link 524 531` appended #531 above GitHub's top of stack 524,
 * #529, because #530 had never been linked into it, and based #531 on #529's branch: #531 then
 * listed #530's commits beside its own eight, and nothing said so until the operator read it.
 * Pull requests may stack in any order. What is refused is a head that holds another's without
 * standing on it: `bun run land` refuses a landing that holds one, `stack.ts` lists them, and the
 * workflow `stacked.yml` fails on a pull request in one as it opens, moves or changes its base,
 * which `mergeable.yml`, run on pushes only, never saw. Exit 1 names each, with the base that
 * mends it.
 */
import { parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { git, gitSays } from "./gate.ts";
import { openPulls, type Pull } from "./pulls.ts";

/** The open pull requests beneath `pull`, each the one whose head the one above is based on. */
function beneath(open: readonly Pull[], pull: Pull): Pull[] {
  const byHead = new Map(open.map((each) => [each.headRefName, each]));
  const found: Pull[] = [];
  for (let below = byHead.get(pull.baseRefName); below !== undefined && !found.includes(below); ) {
    found.push(below);
    below = byHead.get(below.baseRefName);
  }
  return found;
}

/** Each open pull request whose head holds the head of another (`holds(head, other)`) that is
 *  neither beneath it nor stacked above it, with those others. */
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

/** One line for each open pull request that repeats another's commits and that `about` keeps, read
 *  with this checkout's Git after fetching every open head, and naming the head it should stand on:
 *  of the pull requests it repeats, the one whose head holds all the others'. */
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

if (import.meta.main) {
  const { values } = parseArgs({ args: runtimeProcess.argv.slice(2), options: { pull: { type: "string" } } });
  const root = runtimeProcess.cwd();
  const asked = values.pull === undefined ? null : Number(values.pull);
  const lines = doubledLines(
    root,
    openPulls(root),
    (pull, repeats) => asked === null || [pull, ...repeats].some((each) => each.number === asked),
  );
  for (const line of lines) console.error(line);
  if (lines.length === 0) console.log("no open pull request repeats another's commits");
  runtimeProcess.exitCode = lines.length === 0 ? 0 : 1;
}
