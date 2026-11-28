/**
 * What `.githooks/pre-push` checks before anything leaves this clone, reading Git's ref lines on
 * stdin: `git diff --check` on each added commit, the formatter on changed files (`unformatted`),
 * the secret scan on added lines (`scanAdded`), and under `ANA_PUSH_VERIFY=1 git push` the CI
 * gate's `--static` pass with the tests near what each head changed (`proveCommits`). Added commits
 * are those along each head's first parents that no remote-tracking ref or replaced branch holds
 * (`addedLine`). The hook is not the proof: `bun run land -- <top> --sanitize` or `--merge` runs it
 * (`tools/runtime/land.ts`), and a static pass is remembered by tree so `land` does not repeat a
 * pushed head's. Once the checks pass, a detached process marks each pushed head and the pull
 * requests above it pending (`mark`).
 */
import { openSync } from "../../src/meta/filesystem.ts";
import { repoRoot } from "../../src/meta/git.ts";
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
import { api, gh, MERGEABLE_CONTEXT, openPulls, postStatus, type Pull } from "./pulls.ts";

/** Git names a ref that does not exist by an all-zero object name (githooks(5), pre-push). */
const ABSENT = /^0+$/u;

/** How long the mark waits for GitHub to hold the pushed heads; a push it never receives marks nothing. */
const MARK_WAIT_MS = 120_000;

/** What `format:check` reads: every file biome formats. */
const FORMATTED = /\.(?:[cm]?[jt]sx?|jsonc?|css)$/u;

const say = (line: string): void => console.error(`pre-push: ${line}`);

function unclean(root: string, line: readonly string[]): string[] {
  const failing = line.filter((commit) => !diffFromParentSays(root, commit, ["--check"]));
  for (const commit of failing) {
    const shown = runSync(["git", "--no-pager", "show", "--check", "--format=%h %s", commit], { cwd: root });
    console.error(decodeOutput(shown.stdout).trimEnd());
  }
  return failing;
}

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

/** The files each tip changes that biome would rewrite, each as `<tip>:<path>`. A rebase, a
 *  cherry-pick or `--no-verify` records a commit without the pre-commit hook, so a head could reach
 *  `bun run land` unformatted. Biome reads each file's bytes at the tip from stdin, so the working
 *  tree may hold anything. A file biome could not format carries biome's last line, since without
 *  `node_modules` every changed file reads as one biome would rewrite. */
function unformatted(root: string, line: readonly string[], tips: readonly string[]): string[] {
  const biome = join(import.meta.dir, "../../node_modules/@biomejs/biome/bin/biome");
  return tips.flatMap((tip) => {
    const first = line.find((commit) => gitSays(root, ["merge-base", "--is-ancestor", commit, tip]));
    if (first === undefined) return [];
    const changed = lines(
      git(root, ["diff", "--name-only", "--diff-filter=ACMR", parentOf(root, first), tip]),
    );
    return changed.flatMap((path) => {
      if (!FORMATTED.test(path)) return [];
      const input = runSync(["git", "show", `${tip}:${path}`], { cwd: root }).stdout;
      const output = runSync([capturedExecPath, biome, "format", `--stdin-file-path=${path}`], {
        cwd: root,
        input,
      });
      const site = `${short(tip)}:${path}`;
      // Biome echoes a file its configuration ignores, such as one under vendor/, and exits 1.
      if (decodeOutput(input) === decodeOutput(output.stdout)) return [];
      if (output.exitCode !== 0) {
        const reason = decodeOutput(output.stderr).trim().split("\n").at(-1) ?? "";
        return [`${site} (biome exited ${output.exitCode}: ${reason.trim()})`];
      }
      return [site];
    });
  });
}

/** Marks `mergeable` pending on each pushed head and on each open pull request stacked above a
 *  pushed branch, which still carries the success a landing posted. It runs after the push,
 *  detached (`main`), since GitHub takes a status only on a commit it holds, and here rather than
 *  as a GitHub workflow so GitHub runs only `ci.yml`. A failure to mark is said and nothing more. */
async function mark(root: string, pushed: readonly { readonly branch: string; readonly sha: string }[]) {
  const deadline = Date.now() + MARK_WAIT_MS;
  while (!pushed.every(({ sha }) => gh(root, ["api", api(`commits/${sha}`), "--silent"]).ok)) {
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
    // A landing started straight after the push may have proved a pushed head already; pending would
    // turn its verdict back.
    ...pushed
      .filter(
        ({ sha }) =>
          gh(root, [
            "api",
            api(`commits/${sha}/status`),
            "--jq",
            `[.statuses[] | select(.context == "${MERGEABLE_CONTEXT}")] | length`,
          ]).out === "0",
      )
      .map(({ branch, sha }) => ({ name: branch, sha })),
    ...above.map((pull) => ({ name: `#${String(pull.number)}`, sha: pull.headRefOid })),
  ];
  const description = "waiting for bun run land to prove every commit up to this head";
  const failed = heads.filter(
    ({ sha }) => !postStatus(root, sha, { context: MERGEABLE_CONTEXT, state: "pending", description }),
  );
  const named = (each: readonly { readonly name: string }[]) => each.map(({ name }) => name).join(", ");
  const done = heads.filter((head) => !failed.includes(head));
  if (done.length > 0) say(`marked ${named(done)} pending.`);
  if (failed.length > 0) say(`could not mark ${named(failed)} pending.`);
}

async function main(): Promise<number> {
  const root = repoRoot();
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
  const misformatted = unformatted(root, line, tips);
  if (misformatted.length > 0) {
    say(
      `biome would rewrite ${misformatted.join(", ")}; run bun fmt <paths> and amend, or bun install where biome did not run. Nothing was pushed.`,
    );
    return false;
  }
  const source = line.filter((commit) => changesSource(root, commit));
  if (source.length === 0) {
    say(
      `documentation only: git diff --check, the formatter and the secret scan passed on ${plural(line.length, "commit")}.`,
    );
    return true;
  }
  // git's own `--verify` only says that the hook runs, so a push cannot carry the choice as a flag.
  if (runtimeProcess.env.ANA_PUSH_VERIFY !== "1") {
    say(
      `git diff --check, the formatter and the secret scan passed on ${plural(line.length, "commit")}; ANA_PUSH_VERIFY=1 adds the static steps and nearby tests, and bun run land -- <top> --sanitize proves the stack.`,
    );
    return true;
  }
  say(
    `git diff --check, the formatter and the secret scan passed on ${plural(line.length, "commit")}; the suite waits for bun run land -- <top> --sanitize.`,
  );
  const failed = await proveCommits(
    root,
    tips
      .filter((tip) => source.some((commit) => holds(commit, tip)))
      .map((commit) => ({ commit, pass: "static" as const })),
    { who: "pre-push", places: [{ slots: 1 }], say, mark: () => undefined },
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
