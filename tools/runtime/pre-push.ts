/**
 * What `.githooks/pre-push` checks before anything leaves this clone: `git diff --check` on each commit
 * a push adds and the secret scan on what it adds, and, where the push asks with
 * `ANA_PUSH_VERIFY=1 git push`, every step of the CI gate with the suite replaced by the tests one
 * import away from what each pushed head changed (`--static`). It reads Git's ref lines on stdin. A
 * pushed commit is unproved until `bun run land -- <top> --sanitize` or `--merge` has run its own
 * static pass, and the whole CI gate, the full suite among it, on the top's head
 * (`tools/runtime/land.ts`). A static pass is remembered by its tree and its parent's, so `land` does
 * not run a pushed head's again.
 *
 * Until 25 October the hook was that proof: every commit a push added got the static steps and its
 * nearby tests over a checkout of its own, and the pushed head holding the newest the whole CI gate. In
 * this clone the six-commit push of #372 to #377 on 25 October took 591 seconds of CI gate, the whole
 * CI gate alone 315 of them, and a one-commit push 311 to 696; `bun run land` then ran the same proof
 * again over the stack. From 25 October the hook ran every step but the tests, and from 28 October
 * every step with the nearby tests, on the pushed heads only. On 29 October the operator made the
 * levels four: `--no-verify` checks nothing, a plain push the two checks that cost seconds,
 * `ANA_PUSH_VERIFY=1` the static pass, and `land --sanitize` every commit of the stack with the suite
 * at its top. A plain push of #508 had waited minutes on its nearby tests before it could leave.
 *
 * What a push adds is the commits along each pushed head's first parents that neither a
 * remote-tracking ref of this clone nor the branch the push replaces holds (`addedLine`), so a
 * history merged in from another line is counted and left alone; until 11 October v1's hook read
 * every commit new to the remote, 444 of them v2's history merged into PR #141. Each added commit gets
 * `git diff --check` against its first parent, and the lines each pushed head that no other pushed
 * head holds adds since the remote get the secret scan (`scanAdded`), documentation included. Where
 * the push asks and one of them changes more than documentation, each such head gets the CI gate's
 * `--static` pass over a checkout of its own (`proveCommits`): the install, the UI's steps as far as
 * they are due, the format check, typecheck, strict lint, and the tests near what the head's own
 * commit changed. Once the checks pass, a detached process marks each pushed head and the open
 * pull requests stacked above it pending, as soon as GitHub holds the push (`mark`). The working tree may hold anything. A pass is remembered by content, so a push its
 * lease refused goes out again without paying twice.
 *
 * The push queue and the refusal of a push stacked on a base the push before it replaced went with
 * the tests. The queue kept a push from gating the commits of one still at its CI gate, which cost a
 * whole suite on 20 October; the checks now read one tree, whatever lies beneath it. A head that does
 * not hold the pull request beneath it is refused by `bun run land` before anything is merged.
 */
import { openSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "../../src/meta/process.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { plural } from "../../src/meta/text.ts";
import { report, scanAdded } from "../secrets/scan.ts";
import {
  addedLine,
  changesSource,
  diffFromParentSays,
  failedLine,
  git,
  gitSays,
  lines,
  parentOf,
  proveCommits,
  short,
} from "./gate.ts";
import { gh, MERGEABLE_CONTEXT, openPulls, type Pull } from "./pulls.ts";

/** Git names a ref that does not exist by an all-zero object name (githooks(5), pre-push). */
const ABSENT = /^0+$/u;

/** How long the mark waits for GitHub to hold the pushed heads. A push GitHub never receives, such
 *  as one its lease refused, marks nothing. */
const MARK_WAIT_MS = 120_000;

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

/** Marks `mergeable` pending on each pushed head, and on the head of each open pull request stacked
 *  above a pushed branch, which still carries the success a landing posted over what was beneath it.
 *  It runs after the push, detached from the hook (`main`), since GitHub takes a status only on a
 *  commit it holds. Until 30 October the workflow `mergeable.yml` did this on GitHub after each
 *  push, 113 runs in a day; the operator moved it here, so that GitHub runs only `ci.yml`, and
 *  asked that a pushed pull request still show the check. A failure to mark is said and nothing more. */
async function mark(root: string, pushed: readonly { readonly branch: string; readonly sha: string }[]) {
  const deadline = Date.now() + MARK_WAIT_MS;
  while (
    !pushed.every(({ sha }) => gh(root, ["api", `repos/{owner}/{repo}/commits/${sha}`, "--silent"]).ok)
  ) {
    if (Date.now() > deadline) {
      say(
        `GitHub does not hold ${pushed.map(({ sha }) => short(sha)).join(", ")}, so nothing was marked pending.`,
      );
      return;
    }
    await Bun.sleep(2000);
  }
  let open: Pull[];
  try {
    open = openPulls(root);
  } catch (error) {
    say(`nothing was marked pending: ${String(error)}`);
    return;
  }
  const branches = pushed.map(({ branch }) => branch);
  const above: Pull[] = [];
  for (let bases = branches; bases.length > 0; ) {
    const next = open.filter(
      (pull) =>
        bases.includes(pull.baseRefName) && !branches.includes(pull.headRefName) && !above.includes(pull),
    );
    above.push(...next);
    bases = next.map((pull) => pull.headRefName);
  }
  const heads = [
    // A landing started straight after the push may have proved a pushed head already; pending
    // would turn its verdict back.
    ...pushed
      .filter(
        ({ sha }) =>
          gh(root, [
            "api",
            `repos/{owner}/{repo}/commits/${sha}/status`,
            "--jq",
            `[.statuses[] | select(.context == "${MERGEABLE_CONTEXT}")] | length`,
          ]).out === "0",
      )
      .map(({ branch, sha }) => ({ name: branch, sha })),
    ...above.map((pull) => ({ name: `#${String(pull.number)}`, sha: pull.headRefOid })),
  ];
  const failed = heads.filter(
    ({ sha }) =>
      !gh(root, [
        "api",
        "-X",
        "POST",
        `repos/{owner}/{repo}/statuses/${sha}`,
        "-f",
        "state=pending",
        "-f",
        `context=${MERGEABLE_CONTEXT}`,
        "-f",
        "description=waiting for bun run land to prove every commit up to this head",
        "--silent",
      ]).ok,
  );
  const named = (each: readonly { readonly name: string }[]) => each.map(({ name }) => name).join(", ");
  const done = heads.filter((head) => !failed.includes(head));
  if (done.length > 0) say(`marked ${named(done)} pending.`);
  if (failed.length > 0) say(`could not mark ${named(failed)} pending.`);
}

async function main(): Promise<number> {
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]);
  const [first, ...rest] = runtimeProcess.argv.slice(2);
  if (first === "--mark") {
    await mark(
      root,
      rest.map((pair) => ({
        branch: pair.slice(0, pair.lastIndexOf("=")),
        sha: pair.slice(pair.lastIndexOf("=") + 1),
      })),
    );
    return 0;
  }
  const updates = lines(await Bun.stdin.text()).flatMap((line) => {
    const [, local = "", ref = "", remote = ""] = line.split(" ");
    return ABSENT.test(local) ? [] : [{ local, branch: ref.replace(/^refs\/heads\//u, ""), remote }];
  });
  const passed = await checked(root, updates);
  if (passed && updates.length > 0) {
    const log = join(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "ana-mark.log");
    capturedSpawn(
      [
        capturedExecPath,
        import.meta.path,
        "--mark",
        ...updates.map(({ branch, local }) => `${branch}=${local}`),
      ],
      { cwd: root, detached: true, stdin: "ignore", stdout: openSync(log, "a"), stderr: openSync(log, "a") },
    ).unref();
    say(
      `the pushed heads and those stacked above them are marked pending once GitHub holds the push (${log}).`,
    );
  }
  return passed ? 0 : 1;
}

/** Whether what the push adds passes the checks its level asks for; each refusal is said. */
async function checked(
  root: string,
  updates: readonly { readonly local: string; readonly remote: string }[],
): Promise<boolean> {
  if (updates.length === 0) {
    say("every update is a deletion; nothing from this tree is published, so nothing is checked.");
    return true;
  }
  const heads = [...new Set(updates.map((update) => update.local))];
  // A branch someone else moved is not in this clone, and its old commits cannot be read here.
  const replaced = updates.flatMap(({ remote }) =>
    !ABSENT.test(remote) && gitSays(root, ["cat-file", "-e", `${remote}^{commit}`]) ? [remote] : [],
  );
  const line = addedLine(root, heads, [...replaced, "--remotes"], say);
  if (line.length === 0) {
    say("nothing this push adds is new to the remote, so nothing is checked.");
    return true;
  }
  const failing = unclean(root, line);
  if (failing.length > 0) {
    say(`git diff --check fails on ${failing.map(short).join(", ")}. Nothing was pushed.`);
    return false;
  }
  const holds = (below: string, above: string): boolean =>
    gitSays(root, ["merge-base", "--is-ancestor", below, above]);
  const tips = heads.filter((head) => heads.every((other) => other === head || !holds(head, other)));
  if (secretsIn(root, line, tips)) {
    say("the secret scan found a credential-shaped literal in what this push adds. Nothing was pushed.");
    return false;
  }
  const source = line.filter((commit) => changesSource(root, commit));
  if (source.length === 0) {
    say(
      `documentation only: git diff --check and the secret scan passed on ${plural(line.length, "commit")}.`,
    );
    return true;
  }
  // git's own `--verify` only says that the hook runs, so a push cannot carry the choice as a flag.
  if (runtimeProcess.env.ANA_PUSH_VERIFY !== "1") {
    say(
      `git diff --check and the secret scan passed on ${plural(line.length, "commit")}; ANA_PUSH_VERIFY=1 adds the static steps and nearby tests, and bun run land -- <top> --sanitize proves the stack.`,
    );
    return true;
  }
  say(
    `git diff --check and the secret scan passed on ${plural(line.length, "commit")}; the suite waits for bun run land -- <top> --sanitize.`,
  );
  const failed = await proveCommits(
    root,
    tips
      .filter((tip) => source.some((commit) => holds(commit, tip)))
      .map((commit) => ({ commit, pass: "static" as const })),
    { who: "pre-push", jobs: 1, say, mark: () => undefined },
  );
  if (failed === null) return true;
  if (failed.verdict) {
    say(`every published commit passes alone, so the fix goes into the commit that brought the failure,`);
    say(`not into one on top: stage it, then git commit --fixup=<that commit> and`);
    say(`  GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <that commit>~1`);
  }
  say(`${failedLine(failed)}. Nothing was pushed${failed.verdict ? "" : "; push again"}. Log: ${failed.log}`);
  return false;
}

if (import.meta.main) runtimeProcess.exit(await main());
