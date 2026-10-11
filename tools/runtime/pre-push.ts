/**
 * What `.githooks/pre-push` gates: the work a push adds, on the repository's own gate
 * (`tools/runtime/gate.ts`), before anything leaves this clone. It reads Git's ref lines on stdin.
 *
 * Until 11 October 2026 v2 had no hook, and v1's was unset that day: pushing PR #141 would have run it
 * over 448 commits, 444 of them v2's history merged in, none of which carried v1's gate. So a
 * commit is this push's work only when it lies on a pushed head's first-parent line and neither a
 * remote-tracking ref of this clone nor the branch the push replaces holds it (`addedLine`). A
 * history merged in from another line is counted and left alone; the merge commit is gated.
 *
 * Of that work, a commit whose patch (`git patch-id --stable`) the replaced branch held is a replay a
 * rebase carried to a new base, and `bun run land` proves it where it then sits. That lets a pull
 * request go up alone, or with the stack above it replayed, without paying for every commit above
 * it. A commit changing documentation alone has nothing for the static steps to read, and a push
 * with nothing else gets `git diff --check` over each of its commits and stops. Every other commit
 * gets the static steps and its nearby tests over its own checkout, and the lowest pushed head
 * holding the newest of them gets the whole gate instead, since that is the pull request the work is
 * in. A pass is remembered by commit id, so a push its lease refused goes out again without paying
 * twice. The whole gate runs over a checkout too, so the working tree may hold anything.
 */
import { runtimeProcess } from "../../src/meta/process.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { plural } from "../../src/meta/text.ts";
import {
  addedLine,
  changesSource,
  diffFromParentSays,
  git,
  gitSays,
  lines,
  type Proof,
  proveCommits,
  short,
} from "./gate.ts";

/** Git names a ref that does not exist by an all-zero object name (githooks(5), pre-push). */
const ABSENT = /^0+$/u;

const say = (line: string): void => console.error(`pre-push: ${line}`);

/** Commit id to `git patch-id --stable`. A merge prints no patch, so it is never a replay. */
function patchIds(root: string, commits: readonly string[]): Map<string, string> {
  if (commits.length === 0) return new Map();
  const patches = runSync(["git", "diff-tree", "--stdin", "-p", "--root"], {
    cwd: root,
    input: `${commits.join("\n")}\n`,
  }).stdout;
  const ids = decodeOutput(runSync(["git", "patch-id", "--stable"], { cwd: root, input: patches }).stdout);
  return new Map(
    lines(ids).map((line) => {
      const [id = "", commit = ""] = line.split(" ");
      return [commit, id];
    }),
  );
}

async function main(): Promise<number> {
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]);
  const updates = lines(await Bun.stdin.text()).flatMap((line) => {
    const [, local = "", , remote = ""] = line.split(" ");
    return ABSENT.test(local) ? [] : [{ local, remote }];
  });
  if (updates.length === 0) {
    say("every update is a deletion; nothing from this tree is published, so no gate runs.");
    return 0;
  }
  const heads = updates.map((update) => update.local);
  // A branch someone else moved is not in this clone, and its old commits cannot be read here.
  const replaced = updates.flatMap(({ remote }) =>
    !ABSENT.test(remote) && gitSays(root, ["cat-file", "-e", `${remote}^{commit}`]) ? [remote] : [],
  );
  const line = addedLine(root, heads, [...replaced, "--remotes"], say);
  const held = new Set(
    replaced.length === 0
      ? []
      : patchIds(root, lines(git(root, ["rev-list", ...replaced, "--not", ...heads]))).values(),
  );
  const patches = patchIds(root, line);
  const fresh = line.filter((commit) => !held.has(patches.get(commit) ?? ""));
  if (fresh.length < line.length) {
    say(
      `replays of commits the remote already held: ${String(line.length - fresh.length)}. bun run land gates them where they now sit.`,
    );
  }
  const source = fresh.filter((commit) => changesSource(root, commit));
  const newest = source.at(-1);
  if (newest === undefined) {
    if (fresh.length === 0) {
      say("nothing this push adds is new work, so no gate runs.");
      return 0;
    }
    const unclean = fresh.filter((commit) => !diffFromParentSays(root, commit, ["--check"]));
    for (const commit of unclean) {
      const shown = runSync(["git", "--no-pager", "show", "--check", "--format=%h %s", commit], {
        cwd: root,
      });
      console.error(decodeOutput(shown.stdout).trimEnd());
    }
    if (unclean.length > 0) {
      say(`git diff --check fails on ${unclean.map(short).join(", ")}. Nothing was pushed.`);
      return 1;
    }
    say(
      `documentation only: git diff --check passed on ${plural(fresh.length, "commit")}, and no gate runs.`,
    );
    return 0;
  }
  const holding = heads.filter((head) => gitSays(root, ["merge-base", "--is-ancestor", newest, head]));
  const whole =
    holding.find((head) =>
      holding.every((other) => gitSays(root, ["merge-base", "--is-ancestor", head, other])),
    ) ??
    holding[0] ??
    newest;
  const proofs: Proof[] = [
    ...source.flatMap((commit): Proof[] => (commit === whole ? [] : [{ commit, pass: "static" }])),
    { commit: whole, pass: "whole" },
  ];
  const failed = await proveCommits(root, proofs, { who: "pre-push", jobs: 1, say, mark: () => undefined });
  if (failed === null) return 0;
  const at = short(failed.commit);
  say(`every published commit passes alone, so the fix goes into the commit that brought the failure,`);
  say(`not into one on top. For ${at}, stage it, then:`);
  say(`  git commit --fixup=${at}`);
  say(`  GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash ${at}~1`);
  say(`${at} FAILS ${failed.step} ON ITS OWN. Nothing was pushed. Log: ${failed.log}`);
  return 1;
}

if (import.meta.main) runtimeProcess.exit(await main());
