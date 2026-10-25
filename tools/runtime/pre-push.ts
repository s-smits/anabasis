/**
 * What `.githooks/pre-push` checks before anything leaves this clone: every step of the gate but the
 * tests. It reads Git's ref lines on stdin. A pushed commit is unproved until
 * `bun run land -- <top> --sanitize` or `--merge` has run its static steps and nearby tests over its
 * own checkout, and the whole gate, the full suite among it, on the top's head
 * (`tools/runtime/land.ts`).
 *
 * Until 25 October the hook was that proof: every commit a push added got the static steps and its
 * nearby tests over a checkout of its own, and the pushed head holding the newest the whole gate. In
 * this clone the six-commit push of #372 to #377 on 25 October took 591 seconds of gate, the whole
 * gate alone 315 of them, and a one-commit push 311 to 696; `bun run land` then ran the same proof
 * again over the stack. Tests are now run where the stack is proved, once, when its author chooses.
 *
 * What a push adds is the commits along each pushed head's first parents that neither a
 * remote-tracking ref of this clone nor the branch the push replaces holds (`addedLine`), so a
 * history merged in from another line is counted and left alone; until 11 October v1's hook read
 * every commit new to the remote, 444 of them v2's history merged into PR #141. Each added commit gets
 * `git diff --check` against its first parent, and the lines each pushed head that no other pushed
 * head holds adds since the remote get the secret scan (`scanAdded`), documentation included. Where
 * one of them changes more than documentation, each such head gets the gate's `--checks` pass over a
 * checkout of its own (`proveCommits`): the install, the UI's install and build, the format check,
 * typecheck, strict lint, and the simplify census, whose count is printed and gates nothing. The
 * working tree may hold anything. A pass is remembered by the head's tree, so a push its lease
 * refused goes out again without paying twice.
 *
 * The push queue and the refusal of a push stacked on a base the push before it replaced went with
 * the tests. The queue kept a push from gating the commits of one still at its gate, which cost a
 * whole suite on 20 October; the checks now read one tree, whatever lies beneath it. A head that does
 * not hold the pull request beneath it is refused by `bun run land` before anything is merged.
 */
import { runtimeProcess } from "../../src/meta/process.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { plural } from "../../src/meta/text.ts";
import { report, scanAdded } from "../secrets/scan.ts";
import {
  addedLine,
  changesSource,
  diffFromParentSays,
  git,
  gitSays,
  lines,
  parentOf,
  proveCommits,
  short,
} from "./gate.ts";

/** Git names a ref that does not exist by an all-zero object name (githooks(5), pre-push). */
const ABSENT = /^0+$/u;

const say = (line: string): void => console.error(`pre-push: ${line}`);

/** The commits among `line` that fail `git diff --check`, each shown as Git shows it. */
function unclean(root: string, line: readonly string[]): string[] {
  const failing = line.filter((commit) => !diffFromParentSays(root, commit, ["--check"]));
  for (const commit of failing) {
    const shown = runSync(["git", "--no-pager", "show", "--check", "--format=%h %s", commit], { cwd: root });
    console.error(decodeOutput(shown.stdout).trimEnd());
  }
  return failing;
}

/** Whether the secret scan finds a credential-shaped literal in what each tip adds; it prints them. */
function secretsIn(root: string, line: readonly string[], tips: readonly string[]): boolean {
  const found = tips.flatMap((tip) => {
    const first = line.find((commit) => gitSays(root, ["merge-base", "--is-ancestor", commit, tip]));
    if (first === undefined) return [];
    const { hits, refusedPaths } = scanAdded([parentOf(root, first), tip]);
    return hits.length + refusedPaths.length === 0 ? [] : [report(hits, refusedPaths)];
  });
  for (const shown of found) console.error(shown);
  return found.length > 0;
}

async function main(): Promise<number> {
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]);
  const updates = lines(await Bun.stdin.text()).flatMap((line) => {
    const [, local = "", , remote = ""] = line.split(" ");
    return ABSENT.test(local) ? [] : [{ local, remote }];
  });
  if (updates.length === 0) {
    say("every update is a deletion; nothing from this tree is published, so nothing is checked.");
    return 0;
  }
  const heads = [...new Set(updates.map((update) => update.local))];
  // A branch someone else moved is not in this clone, and its old commits cannot be read here.
  const replaced = updates.flatMap(({ remote }) =>
    !ABSENT.test(remote) && gitSays(root, ["cat-file", "-e", `${remote}^{commit}`]) ? [remote] : [],
  );
  const line = addedLine(root, heads, [...replaced, "--remotes"], say);
  if (line.length === 0) {
    say("nothing this push adds is new to the remote, so nothing is checked.");
    return 0;
  }
  const failing = unclean(root, line);
  if (failing.length > 0) {
    say(`git diff --check fails on ${failing.map(short).join(", ")}. Nothing was pushed.`);
    return 1;
  }
  const holds = (below: string, above: string): boolean =>
    gitSays(root, ["merge-base", "--is-ancestor", below, above]);
  const tips = heads.filter((head) => heads.every((other) => other === head || !holds(head, other)));
  if (secretsIn(root, line, tips)) {
    say("the secret scan found a credential-shaped literal in what this push adds. Nothing was pushed.");
    return 1;
  }
  const source = line.filter((commit) => changesSource(root, commit));
  if (source.length === 0) {
    say(
      `documentation only: git diff --check and the secret scan passed on ${plural(line.length, "commit")}.`,
    );
    return 0;
  }
  say(
    `git diff --check and the secret scan passed on ${plural(line.length, "commit")}; the tests wait for bun run land -- <top> --sanitize.`,
  );
  const failed = await proveCommits(
    root,
    tips
      .filter((tip) => source.some((commit) => holds(commit, tip)))
      .map((commit) => ({ commit, pass: "checks" })),
    { who: "pre-push", jobs: 1, say, mark: () => undefined },
  );
  if (failed === null) return 0;
  say(`every published commit passes alone, so the fix goes into the commit that brought the failure,`);
  say(`not into one on top: stage it, then git commit --fixup=<that commit> and`);
  say(`  GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <that commit>~1`);
  say(`${short(failed.commit)} FAILS ${failed.step}. Nothing was pushed. Log: ${failed.log}`);
  return 1;
}

if (import.meta.main) runtimeProcess.exit(await main());
