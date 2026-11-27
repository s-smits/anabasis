/**
 * `bun run land` over a real two-pull-request stack in a fixture repository with its own origin,
 * GitHub and the gate's steps replaced at their command boundaries: the fake `gh` answers from the
 * environment and logs every call, and the fake `bun` (`test/helpers/fake-bun.ts`) logs each gate's
 * steps. ANA_FAKE_PULLS are the open pull requests; `ci.yml` has passed on the top's head unless
 * ANA_FAKE_CI says otherwise or ANA_FAKE_CI_AFTER names a file only a dispatch creates;
 * ANA_FAKE_CI_STATES answers successive run reads (`none`, `down`). ANA_FAKE_STACK is the native
 * stack the top is in (default stack 7 of #11 and #12), ANA_FAKE_LINKED answers after `gh stack
 * link`, and the top's merge runs under ANA_FAKE_STACK_UUID, ends as ANA_FAKE_STACK_END says, at
 * ANA_FAKE_STACK_SHA. ANA_FAKE_SHOWN lists statuses GitHub already shows, `sha context state
 * description` tab-separated. Nothing reaches GitHub, and pushes go only to the fixture's bare
 * origin.
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { runCaptured } from "../src/meta/subprocess.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { fakeBun, gatesRun, logLines, wherePassesRan } from "./helpers/fake-bun.ts";
import { STACK_MEMBERS } from "../tools/runtime/pulls.ts";

const land = join(import.meta.dir, "..", "tools", "runtime", "land.ts");
const fixture = mkdtempSync(join(tmpdir(), "ana-land-"));
const templateWork = join(fixture, "template-work");
const templateOrigin = join(fixture, "template-origin.git");
const bin = join(fixture, "bin");
const fake = (mkdirSync(bin), fakeBun(bin, ""));
const COMMIT = "ana/commit";

const GH = String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$ANA_GH_LOG"
case "$*" in
"pr list"*) if [ -n "$ANA_FAKE_PULLS_DOWN_MERGED" ] && grep -q merge-async "$ANA_GH_LOG"; then
  echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1
elif [ -n "$ANA_FAKE_PULLS_NEXT" ] && [ -e "$ANA_FAKE_PULLS_NEXT.read" ]; then
  cat "$ANA_FAKE_PULLS_NEXT"
elif [ -n "$ANA_FAKE_PULLS_LATER" ] && [ -e "$ANA_FAKE_PULLS_LATER.read" ]; then
  cat "$ANA_FAKE_PULLS_LATER"
elif [ -n "$ANA_FAKE_PULLS_ORIGIN" ]; then
  out=$ANA_FAKE_PULLS
  for ref in $(git -C "$ANA_FAKE_PULLS_ORIGIN" for-each-ref --format='%(refname:short)' refs/heads); do
    out=$(printf '%s' "$out" | sed "s|\"@$ref\"|\"$(git -C "$ANA_FAKE_PULLS_ORIGIN" rev-parse "$ref")\"|g")
  done
  printf '%s\n' "$out"
else
  printf '%s\n' "$ANA_FAKE_PULLS"
fi ;;
"repo view"*) echo main ;;
"api graphql"*timelineItems*) printf '%s\n' "$ANA_FAKE_TIMELINE" ;;
"api graphql"*) [ -z "$ANA_FAKE_SHOWN" ] || cat "$ANA_FAKE_SHOWN" ;;
"run list --workflow ci.yml --branch"*) printf '%s\n' "$ANA_FAKE_CI_BRANCH" ;;
"run list"*) if [ -n "$ANA_FAKE_CI_STATES" ]; then
  row=$(head -n 1 "$ANA_FAKE_CI_STATES")
  [ "$(wc -l < "$ANA_FAKE_CI_STATES")" -le 1 ] || { tail -n +2 "$ANA_FAKE_CI_STATES" > "$ANA_FAKE_CI_STATES.n"; mv "$ANA_FAKE_CI_STATES.n" "$ANA_FAKE_CI_STATES"; }
  case "$row" in down) echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1 ;; none) ;; *) printf '%s\n' "$row" ;; esac
elif [ -z "$ANA_FAKE_CI_AFTER" ] || [ -e "$ANA_FAKE_CI_AFTER" ]; then
  if [ -n "$ANA_FAKE_CI" ]; then printf '%s\n' "$ANA_FAKE_CI"; else printf 'completed\tsuccess\t1\thttps://ci/1\n'; fi
fi ;;
"run view"*"no runner took"*) [ -z "$ANA_FAKE_UNTAKEN" ] || printf '%s\n' "$ANA_FAKE_UNTAKEN" ;;
"run view"*"if .conclusion"*) printf '%s\n' "$ANA_FAKE_CI_STEPS" ;;
"run view"*"--log-failed") [ -z "$ANA_FAKE_LOG_DOWN" ] || { echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1; }
  if [ -n "$ANA_FAKE_FAILED_LOG" ]; then cat "$ANA_FAKE_FAILED_LOG"
  else printf 'darwin\tRun the suite\t(fail) a test that broke on the clean runner\n'; fi ;;
"run view"*) echo "darwin: Run the suite" ;;
"workflow run"*) [ -z "$ANA_FAKE_CI_AFTER" ] || touch "$ANA_FAKE_CI_AFTER" ;;
"api -X PUT"*"/merge-async"*) [ "$ANA_FAKE_STACK_END" != refused ] || { echo "gh: Stack is not mergeable (HTTP 422)" >&2; exit 1; }
  printf 'pending\t%s\t\t\n' "$ANA_FAKE_STACK_UUID" ;;
"api repos/{owner}/{repo}/pulls/"*"/merge-async/"*) printf '%s\t\t%s\t%s\n' "$ANA_FAKE_STACK_END" "$ANA_FAKE_STACK_SHA" "$ANA_FAKE_STACK_END" ;;
"api repos/{owner}/{repo}/stacks"*) [ "$ANA_FAKE_STACK" != down ] || { echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1; }
  asked=$(printf '%s' "$ANA_FAKE_TOP_STACK" | cut -d' ' -f1)
  if [ -n "$ANA_FAKE_LINKED" ] && grep -q '^stack link' "$ANA_GH_LOG"; then printf '%s\n' "$ANA_FAKE_LINKED"
  elif [ -n "$ANA_FAKE_TOP_STACK" ] && case "$*" in *"pull_request=$asked "*) true ;; *) false ;; esac; then
    printf '%s\n' "$ANA_FAKE_TOP_STACK" | cut -d' ' -f2-
  else printf '%s\n' "$ANA_FAKE_STACK"; fi ;;
"stack link"*) ;;
"api -X"*) case "$*" in *"state=success -f context=mergeable"*)
  [ -z "$ANA_FAKE_PULLS_NEXT" ] || touch "$ANA_FAKE_PULLS_NEXT.read" ;; esac ;;
"api repos/"*) echo true ;;
esac
`;

const initGit = (...args: string[]): string => execTextSync("git", args, { cwd: templateWork }).trim();
function initCommit(file: string, text: string, message: string): string {
  writeFileSync(join(templateWork, file), text);
  initGit("add", "-A");
  initGit("commit", "-qm", message);
  return initGit("rev-parse", "HEAD");
}
const short = (sha: string): string => sha.slice(0, 9);

writeFileSync(join(bin, "gh"), GH);
chmodSync(join(bin, "gh"), 0o755);
mkdirSync(join(templateWork, ".github", "workflows"), { recursive: true });
mkdirSync(join(templateWork, "src"));
mkdirSync(join(templateWork, "test"));
initGit("init", "-q", "-b", "main");
initGit("config", "user.email", "fixture@localhost");
initGit("config", "user.name", "fixture");
const workflow = (dispatch: string): string => `name: ci\non:\n  pull_request:\n${dispatch}jobs: {}\n`;
writeFileSync(join(templateWork, ".github", "workflows", "ci.yml"), workflow("  workflow_dispatch:\n"));
writeFileSync(join(templateWork, "README.md"), "one\n");
writeFileSync(
  join(templateWork, "test", "owner.test.ts"),
  'import { owner } from "../src/owner.ts";\nexport { owner };\n',
);
initCommit("src/owner.ts", "export const owner = 1;\n", "base");
initGit("checkout", "-q", "-b", "a");
const lower = initCommit("src/a.ts", "export const a = 1;\n", "a");
const lowerMore = initCommit("src/owner.ts", "export const owner = 2;\n", "a more");
const lowerDocs = initCommit("README.md", "two\n", "a docs");
initGit("checkout", "-q", "-b", "b");
const upper = initCommit("src/b.ts", "export const b = 1;\n", "b");
initGit("checkout", "-q", "-b", "beside", "main");
const beside = initCommit("src/c.ts", "export const c = 1;\n", "beside");
initGit("checkout", "-q", "-b", "merged");
initGit("merge", "-qm", "merge a through the second parent", "a");
const merged = initGit("rev-parse", "HEAD");
initGit("checkout", "-q", "-b", "tests", "main");
initCommit("test/c.test.ts", "export {};\n", "a test");
const testsTop = initCommit("src/d.ts", "export const d = 1;\n", "d");
initGit("checkout", "-q", "-b", "nodispatch", "main");
const noDispatch = initCommit(".github/workflows/ci.yml", workflow(""), "no dispatch");
initGit("checkout", "-q", "-b", "c", "b");
const stacked = initCommit("src/e.ts", "export const e = 1;\n", "c");
initGit("checkout", "-q", "-b", "fix", "b");
writeFileSync(join(templateWork, "test", "a.test.ts"), 'import { a } from "../src/a.ts";\nexport { a };\n');
writeFileSync(join(templateWork, "test", "far.test.ts"), "export {};\n");
const fixesWorkflow = workflow("  workflow_dispatch:\n    inputs:\n      tests:\n      ui_tests:\n");
const broken = initCommit(".github/workflows/ci.yml", fixesWorkflow, "a head ci.yml failed on");
const fixed = initCommit("src/a.ts", "export const a = 2;\n", "the fix");
initGit("checkout", "-q", "-b", "wallfix", "b");
mkdirSync(join(templateWork, "src", "sandbox"), { recursive: true });
writeFileSync(join(templateWork, "test", "a.test.ts"), 'import { a } from "../src/a.ts";\nexport { a };\n');
writeFileSync(
  join(templateWork, "src", "sandbox", "policy.ts"),
  'import { a } from "../a.ts";\nexport { a };\n',
);
const wallBroken = initCommit(
  ".github/workflows/ci.yml",
  fixesWorkflow,
  "a head ci.yml failed on, beside the wall",
);
const wallFixed = initCommit("src/a.ts", "export const a = 2;\n", "the fix the wall reads");
initGit("checkout", "-q", "b");
execTextSync("git", ["init", "-q", "--bare", templateOrigin]);
execTextSync("git", ["-C", templateOrigin, "config", "uploadpack.allowAnySHA1InWant", "true"]);
execTextSync("git", ["-C", templateOrigin, "fetch", "-q", templateWork, "+refs/heads/*:refs/heads/*"]);
initGit("remote", "add", "origin", templateOrigin);

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

const pull = (number: number, head: string, base: string, sha: string, isDraft = false) => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: sha,
  isDraft,
  labels: [{ name: "importance:I2" }, { name: "landing" }],
});
const labelled = (open: ReturnType<typeof pull>, ...names: string[]) => ({
  ...open,
  labels: names.map((name) => ({ name })),
});
const stack = (top = upper, ...more: ReturnType<typeof pull>[]): string =>
  JSON.stringify([
    pull(11, "a", "main", lowerDocs),
    pull(12, "b", "a", top),
    pull(13, "beside", "main", beside),
    ...more,
  ]);

const statusesOf = (ghLog: string, context: string): string[] =>
  logLines(ghLog).flatMap((line) => {
    const match = /\/statuses\/(\w+) -f state=(\w+) -f context=(\S+)/u.exec(line);
    return match?.[3] === context ? [`${match[2]} ${match[1]}`] : [];
  });
const describedOf = (ghLog: string, context: string): string[] =>
  logLines(ghLog).flatMap((line) => {
    const match =
      /\/statuses\/(\w+) -f state=\w+ -f context=(\S+) -f description=(.+) --silent( -f target_url=\S+)?$/u.exec(
        line,
      );
    return match?.[2] === context ? [`${match[1]} ${match[3]}`] : [];
  });
const leftPendingOf = (ghLog: string, context: string): string[] => {
  const last = new Map(statusesOf(ghLog, context).map((row) => [row.split(" ")[1], row.split(" ")[0]]));
  return [...last].flatMap(([sha, state]) => (state === "pending" ? [String(sha)] : []));
};
const writesOf = (ghLog: string): string[] =>
  logLines(ghLog).filter((line) => line.includes("-X") || line.startsWith("workflow"));
const linkCallsOf = (ghLog: string): string[] =>
  logLines(ghLog).filter((line) => line.startsWith("stack link"));

/** An isolated copy of the template repository and origin, with its own logs and async `runLand`,
 *  so tests run concurrently without contending on `.git/ana-land.lock`. Post-gating tests pass
 *  `"proved"` to start from the `.git/ana-gate-passed` cache a prior `land` wrote. */
let provedPasses: Promise<string> | null = null;
function rememberedPasses(): Promise<string> {
  if (provedPasses !== null) return provedPasses;
  provedPasses = (async () => {
    const seed = sandbox();
    const calls: [readonly string[], Record<string, string>][] = [
      [["12"], {}],
      [["13"], { ANA_FAKE_STACK: "", ANA_FAKE_STACK_SHA: beside }],
      [["15"], { ANA_FAKE_PULLS: stack(upper, pull(15, "c", "b", stacked)), ANA_FAKE_STACK_SHA: stacked }],
      [
        ["12"],
        {
          ANA_FAKE_PULLS: JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "fix", "a", fixed)]),
          ANA_FAKE_STACK_SHA: fixed,
        },
      ],
      [
        ["12"],
        {
          ANA_FAKE_PULLS: JSON.stringify([
            pull(11, "a", "main", lowerDocs),
            pull(12, "wallfix", "a", wallFixed),
          ]),
          ANA_FAKE_STACK_SHA: wallFixed,
        },
      ],
    ];
    for (const [args, env] of calls) {
      const done = await seed.runLand(args, env);
      if (done.status !== 0) throw new Error(`seed land failed: ${done.stderr}`);
    }
    const cache = join(fixture, "ana-gate-passed");
    copyFileSync(join(seed.work, ".git", "ana-gate-passed"), cache);
    return cache;
  })();
  return provedPasses;
}

function sandbox() {
  const dir = mkdtempSync(join(fixture, "case-"));
  const work = join(dir, "work");
  const origin = join(dir, "origin.git");
  const ghLog = join(dir, "gh.log");
  const gateLog = join(dir, "gates.log");
  cpSync(templateWork, work, { recursive: true });
  cpSync(templateOrigin, origin, { recursive: true });
  const git = (...args: string[]): string => execTextSync("git", args, { cwd: work }).trim();
  git("remote", "set-url", "origin", origin);
  const commit = (file: string, text: string, message: string): string => {
    writeFileSync(join(work, file), text);
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  const publish = (): string =>
    execTextSync("git", ["-C", origin, "fetch", "-q", work, "+refs/heads/*:refs/heads/*"]);
  const landEnv = (env: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
    ...Bun.env,
    ANA_GATE_FRESH: "",
    ANA_CI_POLL_MS: "10",
    ...fake,
    ANA_FAKE_LOG: gateLog,
    // No host list, and the fixture's main worktree holds no `.env.runs`, so every proof stays here.
    ANA_HOSTS: "",
    ANA_RUNNER_SPARE_HELD: undefined,
    ANA_GH_LOG: ghLog,
    ANA_FAKE_PULLS: stack(),
    ANA_FAKE_STACK: "7 11,12",
    ANA_FAKE_STACK_END: "merged",
    ANA_FAKE_STACK_UUID: "u1",
    ANA_FAKE_STACK_SHA: upper,
    ...env,
  });
  const runLandRaw = async (args: readonly string[], env: Record<string, string | undefined> = {}) => {
    const result = await runCaptured([capturedExecPath, land, ...args], { cwd: work, env: landEnv(env) });
    return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  };
  /** One landing, with the top's whole gate as at a merge (`--whole`); the default one-import pass
   *  and `--watch` are each proved on their own. */
  const runLand = (args: readonly string[], env: Record<string, string | undefined> = {}) =>
    runLandRaw([...args, "--whole"], env);
  const stackMerge = (end: string, more: Record<string, string> = {}) =>
    runLand(["12", "--merge"], {
      ANA_FAKE_STACK: "7 11,12,14",
      ANA_FAKE_STACK_END: end,
      ANA_FAKE_STACK_UUID: "u1",
      ...more,
    });
  const ciStates = (...rows: string[]): string => {
    const file = join(dir, "ci-states");
    writeFileSync(file, `${rows.join("\n")}\n`);
    return file;
  };
  return {
    dir,
    work,
    origin,
    ghLog,
    gateLog,
    git,
    commit,
    publish,
    landEnv,
    runLand,
    runLandRaw,
    stackMerge,
    ciStates,
    statuses: (context: string) => statusesOf(ghLog, context),
    described: (context: string) => describedOf(ghLog, context),
    leftPending: (context: string) => leftPendingOf(ghLog, context),
    writes: () => writesOf(ghLog),
    linkCalls: () => linkCallsOf(ghLog),
    forgetPasses: () => rmSync(join(work, ".git", "ana-gate-passed"), { force: true }),
  };
}

async function provedSandbox() {
  const box = sandbox();
  copyFileSync(await rememberedPasses(), join(box.work, ".git", "ana-gate-passed"));
  return box;
}

describe.concurrent("bun run land", () => {
  it("proves each commit once, then sanitizes cached verdicts only when asked", async () => {
    const { runLand, gateLog, ghLog, writes, described, statuses } = sandbox();
    const result = await runLand(["12"]);
    expect(result.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([`${lower} -`, `${lowerMore} test/owner.test.ts`, `${upper} suite`]);
    expect(result.stdout).toContain(`3 of 4, pr11 ${short(lowerDocs)}: documentation only.`);
    expect(result.stdout).toContain(`4 of 4, pr12 ${short(upper)}: passed.`);
    expect(result.stdout).toContain("--sanitize shows it on GitHub");
    expect(writes()).toEqual([]);
    rmSync(gateLog, { force: true });
    const sanitized = await runLand(["12", "--sanitize"]);
    expect(sanitized.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([]);
    expect(sanitized.stdout).toContain("passed earlier on these exact bytes");
    expect(sanitized.stdout).toContain("every commit passed; each shows ana/commit on GitHub.");
    expect(described(COMMIT)).toEqual([
      `${lower} its static steps and nearby tests passed on its own checkout`,
      `${lowerMore} its static steps and nearby tests passed on its own checkout`,
      `${lowerDocs} documentation only`,
      `${upper} passed the whole gate on its own checkout`,
    ]);
    expect(statuses("mergeable")).toEqual([`success ${lowerDocs}`, `success ${upper}`]);
    expect(writes().filter((line) => !/context=(ana\/commit|mergeable) /u.test(line))).toEqual([]);
    expect(logLines(ghLog).some((line) => line.startsWith("run list"))).toBe(false);
  });

  it("proves the top as every other commit, by its nearby tests, unless it merges or --whole is named", async () => {
    const { runLand, runLandRaw, gateLog, described } = sandbox();
    const result = await runLandRaw(["12", "--sanitize"]);
    expect(result.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([`${lower} -`, `${lowerMore} test/owner.test.ts`, `${upper} -`]);
    expect(described(COMMIT)).toContain(
      `${upper} its static steps and nearby tests passed on its own checkout`,
    );
    // A merge gives the top the whole gate, which the sanitize's nearby tests do not stand in for.
    rmSync(gateLog, { force: true });
    expect((await runLand(["12", "--merge"])).status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([`${upper} suite`]);
  });

  it("merges over the passes a sanitize left, running no gate again", async () => {
    const { runLand, gateLog } = sandbox();
    expect((await runLand(["12", "--sanitize"])).status).toBe(0);
    rmSync(gateLog, { force: true });
    const landed = await runLand(["12", "--merge"]);
    expect(landed.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([]);
    expect(landed.stdout).toContain("passed earlier on these exact bytes");
  });

  it("posts only the statuses GitHub does not show already, and reads the chain once over remembered passes", async () => {
    const { dir, runLand, ghLog, described, statuses } = sandbox();
    expect((await runLand(["12", "--sanitize"])).status).toBe(0);
    const posted = logLines(ghLog).flatMap((line) => {
      const match = /\/statuses\/(\w+) -f state=(\w+) -f context=(\S+) -f description=(.+) --silent$/u.exec(
        line,
      );
      return match === null ? [] : [[match[1], match[3], match[2], match[4]]];
    });
    const latest = new Map(
      posted.map(([sha, context, ...rest]) => [`${String(sha)} ${String(context)}`, [sha, context, ...rest]]),
    );
    const stale = latest.get(`${upper} ana/commit`) ?? [];
    latest.set(`${upper} ana/commit`, [upper, COMMIT, "pending", "an earlier landing"]);
    const shown = join(dir, "shown");
    writeFileSync(shown, `${[...latest.values()].map((row) => row.join("\t")).join("\n")}\n`);
    rmSync(ghLog, { force: true });
    const again = await runLand(["12", "--sanitize"], { ANA_FAKE_SHOWN: shown });
    expect(again.status).toBe(0);
    expect(described(COMMIT)).toEqual([`${upper} ${String(stale[3])}`]);
    expect(statuses("mergeable")).toEqual([]);
    expect(logLines(ghLog).filter((line) => line.startsWith("pr list"))).toHaveLength(1);
  });

  it("posts a verdict again over the same one GitHub showed before the landing turned it pending", async () => {
    const { dir, runLand, ghLog, statuses, forgetPasses } = sandbox();
    expect((await runLand(["12", "--sanitize"])).status).toBe(0);
    const shown = join(dir, "shown-green");
    const rows = logLines(ghLog).flatMap((line) => {
      const match = /\/statuses\/(\w+) -f state=(\w+) -f context=(\S+) -f description=(.+) --silent$/u.exec(
        line,
      );
      return match === null ? [] : [[match[1], match[3], match[2], match[4]].join("\t")];
    });
    writeFileSync(shown, `${rows.join("\n")}\n`);
    rmSync(ghLog, { force: true });
    forgetPasses();
    const again = await runLand(["12", "--sanitize"], { ANA_FAKE_SHOWN: shown });
    expect(again.status).toBe(0);
    expect(statuses(COMMIT).filter((row) => row.endsWith(upper))).toEqual([
      `pending ${upper}`,
      `success ${upper}`,
    ]);
    expect(statuses("mergeable").filter((row) => row.endsWith(upper))).toEqual([
      `pending ${upper}`,
      `success ${upper}`,
    ]);
  });

  it("with --auto lands a pull request stacked on the top during its proof, and merges the new top", async () => {
    const { dir, runLand, gateLog, ghLog } = sandbox();
    const next = join(dir, "stacked-pulls");
    rmSync(`${next}.read`, { force: true });
    writeFileSync(next, stack(upper, pull(15, "c", "b", stacked)));
    const result = await runLand(["12", "--auto", "--merge"], {
      ANA_FAKE_PULLS_NEXT: next,
      ANA_FAKE_STACK: "7 11,12,15",
      ANA_FAKE_STACK_SHA: stacked,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "a pull request was stacked on #12 while it landed; landing the new top.",
    );
    expect(gatesRun(gateLog)).toContain(`${stacked} suite`);
    const merges = logLines(ghLog).filter((line) => line.includes("/merge-async") && line.includes("-X PUT"));
    expect(merges.map((line) => /pulls\/(\d+)\//u.exec(line)?.[1])).toEqual(["15"]);
  });

  it("with no pull request named lands the stack that holds the oldest stacked pull request, up to its top", async () => {
    const { runLand } = sandbox();
    const result = await runLand(["--sanitize"], {
      ANA_FAKE_PULLS: JSON.stringify([
        pull(9, "beside", "main", beside),
        pull(11, "a", "main", lowerDocs),
        pull(12, "b", "a", upper),
        pull(16, "tests", "main", testsTop),
      ]),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("#11, #12 onto main");
  });

  it("with latest named lands the open stack whose top has the highest number, up to its top", async () => {
    const { runLand } = sandbox();
    const result = await runLand(["latest", "--sanitize"], {
      ANA_FAKE_PULLS: JSON.stringify([
        pull(9, "beside", "main", beside),
        pull(11, "a", "main", lowerDocs),
        pull(12, "b", "a", upper),
        pull(16, "tests", "main", testsTop),
      ]),
      ANA_FAKE_STACK: "8 16",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("#16 onto main");
  });

  it("proves every landing head and turns the stack green when a lower head is a merge's second parent", async () => {
    const { runLand, gateLog, statuses } = sandbox();
    const result = await runLand(["12", "--sanitize"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "merged", "a", merged)]),
    });
    expect(result.status).toBe(0);
    expect(statuses("mergeable")).toEqual([
      `pending ${merged}`,
      `pending ${lowerDocs}`,
      `success ${lowerDocs}`,
      `success ${merged}`,
    ]);
    expect(statuses(COMMIT)).toContain(`success ${lowerDocs}`);
    expect(gatesRun(gateLog)).toContain(`${lowerMore} test/owner.test.ts`);
    expect(gatesRun(gateLog).at(-1)).toBe(`${merged} suite`);
  });

  it("proves only the commits from the pull request --from names, and turns no head green", async () => {
    const { runLand, gateLog, statuses } = sandbox();
    // The commits beneath #12 would fail, so a partial proof that reached them would fail too.
    const result = await runLand(["12", "--sanitize", "--from", "12"], { ANA_FAKE_FAIL: `${lower} lint` });
    expect(result.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([`${upper} suite`]);
    expect(statuses(COMMIT)).toEqual([`pending ${upper}`, `success ${upper}`]);
    expect(result.stdout).toContain(`1 of 1, pr12 ${short(upper)}: passed.`);
    expect(statuses("mergeable")).toEqual([]);
    expect((await runLand(["12", "--sanitize", "--from", "13"])).stderr).toContain("#13 is not in #11, #12.");
    expect((await runLand(["12", "--merge", "--from", "12"])).status).toBe(2);
  });

  it("stops at the first commit that fails and names its pull request and where the fix goes", async () => {
    const { runLand, gateLog, statuses } = sandbox();
    const result = await runLand(["12", "--sanitize"], { ANA_FAKE_FAIL: `${lower} lint` });
    expect(result.status).toBe(1);
    expect(gatesRun(gateLog)).toEqual([`${lower} -`]);
    expect(result.stderr).toContain(
      `the fix belongs in ${short(lower)}, on #11 (a), not in a commit on top.`,
    );
    expect(result.stderr).toContain(`git commit --fixup=${short(lower)}`);
    expect(result.stderr).toContain("then replay #12 on it, bottom-up, and push them together");
    const last = result.stderr.trimEnd().split("\n").at(-1) ?? "";
    expect(last).toStartWith(`land: ${short(lower)} FAILS lint ON ITS OWN. Nothing was merged. Log: `);
    expect(statuses(COMMIT)).toEqual([`pending ${lower}`, `failure ${lower}`]);
    expect(statuses("mergeable")).toEqual([
      `pending ${lowerDocs}`,
      `pending ${upper}`,
      `failure ${lowerDocs}`,
      `failure ${upper}`,
    ]);
    expect(statuses("ana/stack-gate")).toEqual([]);
  });

  for (const code of ["255", "75", "69"]) {
    const scope = code === "255" ? ["12", "--sanitize"] : ["12", "--sanitize", "--from", "12"];
    it(`runs a step again where its runner exited ${code}, and passes on the second run`, async () => {
      const { runLand, gateLog, statuses } = sandbox();
      const result = await runLand(scope, {
        ANA_FAKE_DROP: `${upper} test`,
        ANA_FAKE_DROP_CODE: code,
      });
      expect(result.status).toBe(0);
      expect(logLines(gateLog).filter((line) => line === `${upper}\trun test`)).toHaveLength(2);
      expect(statuses(COMMIT)).toContain(`success ${upper}`);
    });

    it(`reads two exits of ${code} as no verdict: an error status, no fix recipe, and land again`, async () => {
      const { runLand, statuses } = sandbox();
      const result = await runLand(scope, {
        ANA_FAKE_DROP: `${upper} test`,
        ANA_FAKE_DROPS: "2",
        ANA_FAKE_DROP_CODE: code,
      });
      expect(result.status).toBe(1);
      const last = result.stderr.trimEnd().split("\n").at(-1) ?? "";
      expect(last).toStartWith(
        `land: ${short(upper)} GAVE NO VERDICT ON test: its runner said nothing of it twice. Nothing was merged. Land again. Log: `,
      );
      expect(result.stderr).not.toContain("the fix belongs in");
      expect(statuses(COMMIT)).toContain(`error ${upper}`);
      if (code === "255") {
        expect(statuses("mergeable")).toEqual([
          `pending ${lowerDocs}`,
          `pending ${upper}`,
          `success ${lowerDocs}`,
          `error ${upper}`,
        ]);
      }
    });
  }

  const host = (name: string, checks?: number) => ({
    name,
    ssh: name,
    tree: "/srv/tree",
    bun: "bun",
    checks,
  });
  const hosts = JSON.stringify([host("alpha", 1), host("unset"), host("beta", 3)]);

  it("pools proofs under all across non-benchmark check hosts where ANA_CHECK_HOST is unset or empty, capped by concurrency and capacity", async () => {
    for (const checkHost of [undefined, "   "]) {
      const { runLand, gateLog, statuses } = sandbox();
      const result = await runLand(["12", "--sanitize"], { ANA_HOSTS: hosts, ANA_CHECK_HOST: checkHost });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("proving on all (4) at once");
      expect(wherePassesRan(gateLog)).toContain(`${upper} all`);
      expect(logLines(gateLog)).toContain(`spare\t${upper}\tall`);
      expect(statuses(COMMIT)).toContain(`success ${upper}`);
    }
    const capped = sandbox();
    const highJobs = await capped.runLand(["12", "--sanitize", "--jobs", "50"], {
      ANA_HOSTS: hosts,
      ANA_CHECK_HOST: undefined,
    });
    expect(highJobs.status).toBe(0);
    expect(highJobs.stdout).toContain("proving on all (6) at once");
    const small = sandbox();
    const withBench = JSON.stringify([host("alpha", 1), host("bench", 4)]);
    const evalRunner = JSON.stringify([
      { name: "outside", host: "bench", store: "store", sitting: "sit", packs: ["outside"] },
    ]);
    const benchRun = await small.runLand(["12", "--sanitize"], {
      ANA_HOSTS: withBench,
      EVAL_RUNNER: evalRunner,
      ANA_CHECK_HOST: undefined,
    });
    expect(benchRun.status).toBe(0);
    expect(benchRun.stdout).toContain("proving on all (1) at once");
    const onlyBench = sandbox();
    const benchOnlyRun = await onlyBench.runLand(["12", "--sanitize"], {
      ANA_HOSTS: JSON.stringify([host("bench", 4)]),
      EVAL_RUNNER: evalRunner,
      ANA_CHECK_HOST: undefined,
    });
    expect(benchOnlyRun.status).toBe(0);
    expect(benchOnlyRun.stdout).not.toContain("proving on all");
    expect(wherePassesRan(onlyBench.gateLog)).toContain(`${upper} bench`);
  });

  it("proves at the one place an explicit ANA_CHECK_HOST names, without ANA_RUNNER_SPARE_HELD, whatever the host list holds", async () => {
    const { runLand, gateLog } = sandbox();
    const result = await runLand(["12", "--sanitize"], { ANA_HOSTS: hosts, ANA_CHECK_HOST: "here" });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("proving on");
    // Every pass inherits the caller's ANA_CHECK_HOST, which the runner reads as this machine.
    const ran = wherePassesRan(gateLog);
    expect(ran.length).toBeGreaterThan(0);
    expect(ran.filter((line) => !line.endsWith(" here"))).toEqual([]);
    expect(logLines(gateLog).filter((line) => line.startsWith("spare\t"))).toEqual([]);
  });

  it("replays a pull request whose parent was rewritten onto it with --sanitize, pushes it and proves it", async () => {
    const { origin, git, commit, publish, runLand, gateLog } = sandbox();
    git("checkout", "-q", "-b", "ra", lowerMore);
    const rewritten = commit("README.md", "two, fixed\n", "a docs");
    git("branch", "rb", upper);
    git("checkout", "-q", "b");
    publish();
    const env = {
      ANA_FAKE_PULLS: JSON.stringify([pull(21, "ra", "main", "@ra"), pull(22, "rb", "ra", "@rb")]),
      ANA_FAKE_PULLS_ORIGIN: origin,
      ANA_FAKE_TIMELINE: `${rewritten}\n${lowerDocs}`,
      ANA_FAKE_STACK: "8 21,22",
    };
    const proving = await runLand(["22"], env);
    expect(proving.status).toBe(1);
    expect(proving.stderr).toContain("#22 (rb) does not contain #21's head");
    expect(proving.stderr).toContain("--sanitize or --merge replays it.");
    expect(gatesRun(gateLog)).toEqual([]);
    const result = await runLand(["22", "--sanitize"], env);
    expect(result.status).toBe(0);
    const moved = execTextSync("git", ["-C", origin, "rev-parse", "rb"]).trim();
    expect(result.stdout).toContain(`replaying what moved beneath: #22 ${short(upper)} -> ${short(moved)}`);
    expect(result.stdout).toContain(`git rebase --onto ${short(moved)} ${short(upper)} rb`);
    expect(git("rev-parse", `${moved}^`)).toBe(rewritten);
    expect(git("show", `${moved}:README.md`)).toBe("two, fixed");
    expect(git("show", `${moved}:src/b.ts`)).toBe("export const b = 1;");
    expect(gatesRun(gateLog).at(-1)).toBe(`${moved} suite`);
  });

  it("refuses an unlabelled landing that --sanitize would replay before force-pushing anything", async () => {
    const { origin, git, commit, publish, runLand } = sandbox();
    git("checkout", "-q", "-b", "ua", lowerMore);
    const rewritten = commit("README.md", "two, mended\n", "a docs");
    git("branch", "ub", upper);
    git("checkout", "-q", "b");
    publish();
    const result = await runLand(["32", "--sanitize"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(31, "ua", "main", "@ua"), labelled(pull(32, "ub", "ua", "@ub"))]),
      ANA_FAKE_PULLS_ORIGIN: origin,
      ANA_FAKE_TIMELINE: `${rewritten}\n${lowerDocs}`,
      ANA_FAKE_STACK: "8 31,32",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#32 carries no importance label");
    expect(result.stdout).not.toContain("replaying what moved beneath");
    expect(execTextSync("git", ["-C", origin, "rev-parse", "ub"]).trim()).toBe(upper);
  });

  it("refuses a stack whose bottom does not contain main's head", async () => {
    const { git, commit, publish, runLand, gateLog } = sandbox();
    git("checkout", "-q", "main");
    const moved = commit("src/owner.ts", "export const owner = 3;\n", "hotfix");
    publish();
    const result = await runLand(["12", "--sanitize"]);
    expect(result.status).toBe(1);
    // Its replay onto main's head conflicts with the hotfix, so nothing is pushed.
    expect(result.stderr).toContain(`#11 does not replay cleanly onto ${short(moved)}`);
    expect(gatesRun(gateLog)).toEqual([]);
  });

  it("refuses a landing in which a pull request carries no importance label or two, or no category label, naming each, before gating anything", async () => {
    const { runLand, gateLog, ghLog } = sandbox();
    const unranked = JSON.stringify([
      labelled(pull(11, "a", "main", lowerDocs)),
      labelled(pull(12, "b", "a", upper), "importance:I1", "importance:I3", "runs"),
      labelled(pull(13, "beside", "main", beside)),
    ]);
    for (const flags of [[], ["--sanitize"], ["--merge"]]) {
      rmSync(ghLog, { force: true });
      const result = await runLand(["12", ...flags], { ANA_FAKE_PULLS: unranked });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "#11 carries no importance label, and no category label; #12 carries importance:I1 and importance:I3. Give each pull request exactly one",
      );
      expect(result.stderr).not.toContain("#13");
      expect(gatesRun(gateLog)).toEqual([]);
      expect(logLines(ghLog).filter((call) => call.startsWith("api -X POST"))).toEqual([]);
    }
    const uncategorised = JSON.stringify([
      labelled(pull(11, "a", "main", lowerDocs), "importance:I0", "bug"),
      pull(12, "b", "a", upper),
    ]);
    const refused = await runLand(["12"], { ANA_FAKE_PULLS: uncategorised });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("#11 carries no category label. Give each pull request");
    expect(refused.stderr).not.toContain("#12");
    const ranked = JSON.stringify([
      labelled(pull(11, "a", "main", lowerDocs), "importance:I0", "docs"),
      pull(12, "b", "a", upper),
    ]);
    expect((await runLand(["12"], { ANA_FAKE_PULLS: ranked })).status).toBe(0);
  });

  it("refuses to merge a landing that holds a draft, and proves one without marking it ready", async () => {
    const { runLand, gateLog, ghLog, writes, statuses } = sandbox();
    const held = JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "b", "a", upper, true)]);
    const result = await runLand(["12", "--merge"], { ANA_FAKE_PULLS: held });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("land: #12: no merge takes a draft");
    expect(gatesRun(gateLog)).toEqual([]);
    expect(writes()).toEqual([]);
    rmSync(ghLog, { force: true });
    expect((await runLand(["12", "--sanitize"], { ANA_FAKE_PULLS: held })).status).toBe(0);
    expect(statuses("mergeable")).toContain(`success ${upper}`);
    expect(logLines(ghLog).filter((call) => call.startsWith("pr ready"))).toEqual([]);
  });

  it("merges a pull request beside another open chain on main when --alone names it", async () => {
    const { runLand } = await provedSandbox();
    const result = await runLand(["13", "--merge", "--alone"], {
      ANA_FAKE_STACK: "",
      ANA_FAKE_STACK_SHA: beside,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `land: #13 merged into main as #13, at ${short(beside)}: ${short(beside)}.`,
    );
  });

  it("merges a lone pull request in no stack through its own merge, pinned to its gated head", async () => {
    const { runLand, ghLog } = await provedSandbox();
    const result = await runLand(["13", "--merge"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(11, "a", "main", lowerDocs), pull(13, "beside", "main", beside)]),
      ANA_FAKE_STACK: "",
      ANA_FAKE_STACK_SHA: beside,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `land: #13 merged into main as #13, at ${short(beside)}: ${short(beside)}.`,
    );
    expect(logLines(ghLog)).toContain(
      `api -X PUT repos/{owner}/{repo}/pulls/13/merge-async -f merge_method=merge -f merge_action=direct_merge -f sha=${beside} --jq [.status, .details.uuid // "", .details.sha // "", .details.message // ""] | join("\\t")`,
    );
  });

  const opened = { ANA_FAKE_PULLS: stack(upper, pull(15, "c", "b", stacked)), ANA_FAKE_STACK_SHA: stacked };

  it("links a pull request opened above GitHub's top into the stack, naming the whole chain, before gating", async () => {
    const { runLand, gateLog, ghLog, linkCalls } = sandbox();
    const result = await runLand(["15", "--sanitize"], { ...opened, ANA_FAKE_LINKED: "7 11,12,15" });
    expect(result.status).toBe(0);
    expect(linkCalls()).toEqual(["stack link 11 12 15"]);
    expect(result.stdout).toContain(
      "land: linked #11, #12, #15 into one stack on GitHub: gh stack link 11 12 15.",
    );
    const lines = logLines(ghLog);
    expect(lines.indexOf("stack link 11 12 15")).toBeLessThan(
      lines.findIndex((line) => line.includes("/statuses/")),
    );
    expect(gatesRun(gateLog)).toContain(`${stacked} suite`);
  });

  it("names the members a partial merge left closed below the chain, since a link that drops them is refused", async () => {
    const { runLand, linkCalls } = await provedSandbox();
    const result = await runLand(["15", "--sanitize"], {
      ...opened,
      ANA_FAKE_STACK: "7 11,12 9,10",
      ANA_FAKE_LINKED: "7 11,12,15 9,10",
    });
    expect(result.status).toBe(0);
    expect(linkCalls()).toEqual(["stack link 9 10 11 12 15"]);
  });

  it("links a landing of several pull requests in no stack, and merges it as one", async () => {
    const { runLand, linkCalls } = await provedSandbox();
    const result = await runLand(["12", "--merge"], { ANA_FAKE_STACK: "", ANA_FAKE_LINKED: "7 11,12" });
    expect(result.status).toBe(0);
    expect(linkCalls()).toEqual(["stack link 11 12"]);
    expect(result.stdout).toContain("land: #11, #12 merged into main as stack 7");
  });

  it("refuses a stack that holds the chain in another order, naming unstack then link, and links nothing", async () => {
    const { runLand, gateLog, linkCalls, writes } = sandbox();
    const result = await runLand(["12", "--sanitize"], {
      ANA_FAKE_STACK: "7 12,11",
      ANA_FAKE_LINKED: "7 11,12",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "land: GitHub's stack 7 holds #12, #11, and the chain of bases up to #12 holds #11, #12. A link never " +
        "reorders a stack: run gh stack unstack 7, then gh stack link 11 12, and land again. Nothing was merged.",
    );
    expect(linkCalls()).toEqual([]);
    expect(gatesRun(gateLog)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  /** `bun run split` left #15 in a native stack of its own, above stack 7 of #11 and #12. */
  const divided = { ...opened, ANA_FAKE_TOP_STACK: "15 8 15" };

  it("proves every native stack of a divided chain from the trunk, marking each head, and links nothing", async () => {
    const { runLand, gateLog, linkCalls, statuses } = sandbox();
    const result = await runLand(["15", "--sanitize"], divided);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "land: GitHub holds #11, #12, #15 as native stacks from #11, #15; proving them all.",
    );
    expect(linkCalls()).toEqual([]);
    expect(gatesRun(gateLog).filter((line) => !line.startsWith(stacked))).not.toEqual([]);
    expect(statuses("mergeable").filter((row) => row.startsWith("success"))).toEqual([
      `success ${lowerDocs}`,
      `success ${upper}`,
      `success ${stacked}`,
    ]);
  });

  /** `bun run split` left #11 and #12 in native stacks of their own, and #15 was opened on #12 since. */
  const openedAbove = { ...opened, ANA_FAKE_STACK: "7 11", ANA_FAKE_TOP_STACK: "12 8 12" };

  it("refuses to merge the upper of divided stacks before the lower, gating nothing", async () => {
    const { runLand, gateLog, writes } = sandbox();
    const result = await runLand(["15", "--merge"], divided);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "GitHub's stack holding #15 starts at #15: land the stacks beneath first.",
    );
    expect(gatesRun(gateLog)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("proves and links from the stack beneath a top opened in no stack above a divided chain", async () => {
    const { runLand, linkCalls } = await provedSandbox();
    const result = await runLand(["15", "--sanitize"], {
      ...opened,
      ANA_FAKE_STACK: "7 11",
      ANA_FAKE_TOP_STACK: "12 8 12",
      ANA_FAKE_LINKED: "8 12,15",
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "land: GitHub holds #11, #12, #15 as native stacks from #11, #12; proving them all.",
    );
    expect(linkCalls()).toEqual(["stack link 12 15"]);
  });

  it("ends a held landing only where this one proves its pull request, from the trunk or --from", async () => {
    const { work, landEnv } = sandbox();
    const landing = JSON.stringify(join(import.meta.dir, "../tools/runtime/landing.ts"));
    const ends = async (env: Record<string, string>, from: number | null): Promise<string> =>
      (
        await runCaptured(
          [
            capturedExecPath,
            "-e",
            `import { claimOf } from ${landing};
           const claim = claimOf(".", 15, { auto: false, kind: "sanitizing", from: ${String(from)} });
           console.log(["#11", "#12", "#15"].map((pull) => claim.over(pull + " sanitizing")).join(" "));`,
          ],
          { cwd: work, env: landEnv(env) },
        )
      ).stdout.trim();
    expect(await ends(opened, null)).toBe("true true true");
    expect(await ends(divided, null)).toBe("true true true");
    expect(await ends(openedAbove, null)).toBe("true true true");
    expect(await ends(opened, 15)).toBe("false false true");
    expect(await ends(opened, 12)).toBe("false true true");
  });

  it("without a flag says the link it would run, and links nothing", async () => {
    const { runLand, linkCalls, writes } = await provedSandbox();
    const result = await runLand(["15"], opened);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "land: #11, #12, #15 are not one stack on GitHub; --sanitize or --merge runs gh stack link 11 12 15.",
    );
    expect(linkCalls()).toEqual([]);
    expect(writes()).toEqual([]);
  });

  const askedStack = `api -X PUT repos/{owner}/{repo}/pulls/12/merge-async -f merge_method=merge -f merge_action=direct_merge -f sha=${upper}`;

  it("merges a landing GitHub holds as a stack whole, through the stack's merge, after the statuses", async () => {
    const { stackMerge, ghLog, statuses } = await provedSandbox();
    const result = await stackMerge("merged", { ANA_FAKE_STACK_SHA: upper });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `land: #11, #12 merged into main as stack 7, at ${short(upper)}: ${short(upper)}.`,
    );
    expect(statuses("ana/stack-gate")).toEqual([`success ${lowerDocs}`, `success ${upper}`]);
    const calls = logLines(ghLog);
    const asked = calls.findIndex((line) => line.startsWith(askedStack));
    expect(calls.findLastIndex((line) => line.includes("context=ana/stack-gate"))).toBeLessThan(asked);
    expect(calls.slice(asked + 1).map((line) => line.split(" --jq")[0]?.split(" --json")[0])).toEqual([
      "api repos/{owner}/{repo}/pulls/12/merge-async/u1",
      "pr list --state open --limit 200",
    ]);
    expect(calls.some((line) => /pulls\/\d+\/merge -f/u.test(line) || line.includes("-X PATCH"))).toBe(false);
    expect(calls.some((line) => line.startsWith("pr edit"))).toBe(false);
  });

  it("says a failed read of the open pull requests after a merge and still ends as merged", async () => {
    const { stackMerge, ghLog } = await provedSandbox();
    const result = await stackMerge("merged", { ANA_FAKE_STACK_SHA: upper, ANA_FAKE_PULLS_DOWN_MERGED: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("merged into main as stack 7");
    expect(result.stdout).toContain("land: could not list the open pull requests");
    expect(logLines(ghLog).some((line) => line.startsWith("pr edit"))).toBe(false);
  });

  it("moves a pull request left on the merged top's branch onto main, and none based elsewhere", async () => {
    const { stackMerge, ghLog } = await provedSandbox();
    const result = await stackMerge("merged", {
      ANA_FAKE_PULLS: stack(upper, pull(15, "c", "b", stacked)),
      ANA_FAKE_STACK: "7 11,12",
      ANA_FAKE_STACK_SHA: upper,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("land: #15 is based on main.");
    expect(logLines(ghLog).filter((line) => line.startsWith("pr edit"))).toEqual(["pr edit 15 --base main"]);
  });

  it("cuts the release at the merge it made with --tag, with notes GitHub writes, and refuses a tag origin holds before gating", async () => {
    const { dir, origin, git, runLand, ghLog, writes } = await provedSandbox();
    const result = await runLand(["12", "--merge", "--tag", "v9.9.9"], {
      ANA_FAKE_STACK: "7 11,12,14",
      ANA_FAKE_STACK_END: "merged",
      ANA_FAKE_STACK_UUID: "u1",
      ANA_FAKE_STACK_SHA: upper,
    });
    expect(result.status).toBe(0);
    const calls = logLines(ghLog);
    const cut = calls.findIndex((line) => line.startsWith("release create"));
    expect(calls[cut]).toBe(`release create v9.9.9 --target ${upper} --title v9.9.9 --generate-notes`);
    expect(cut).toBeGreaterThan(calls.findIndex((line) => line.startsWith(askedStack)));

    execTextSync("git", ["-C", origin, "tag", "v9.9.8", upper]);
    writeFileSync(ghLog, "");
    const taken = await runLand(["12", "--merge", "--tag", "v9.9.8"]);
    expect(taken.status).toBe(1);
    expect(taken.stderr).toContain("v9.9.8 is already a tag on origin.");
    expect(writes()).toEqual([]);

    git("remote", "set-url", "origin", join(dir, "nowhere.git"));
    const unasked = await runLand(["12", "--merge", "--tag", "v9.9.7"]);
    expect(unasked.status).toBe(1);
    expect(unasked.stderr).toContain("origin could not be asked whether it holds v9.9.7.");
    expect(writes()).toEqual([]);
  });

  it("takes the status back from every head when GitHub refuses or fails a stack's merge, and says nothing merged", async () => {
    for (const [end, why] of [
      ["failed", "its merge ended failed: failed"],
      ["refused", "gh: Stack is not mergeable (HTTP 422)"],
    ] as const) {
      const { stackMerge, statuses } = await provedSandbox();
      const result = await stackMerge(end);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`land: GitHub did not merge stack 7: ${why}`);
      expect(result.stderr).toContain("land: nothing merged; #11, #12 are open.");
      expect(statuses("ana/stack-gate")).toEqual([
        `success ${lowerDocs}`,
        `success ${upper}`,
        `pending ${lowerDocs}`,
        `pending ${upper}`,
      ]);
    }
  });

  it("takes the status back from every head when GitHub's merge cannot be read as landed", async () => {
    const { stackMerge, statuses } = await provedSandbox();
    const result = await stackMerge("enqueued");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("land: GitHub's merge of stack 7 went into the merge queue");
    expect(statuses("ana/stack-gate")).toEqual([
      `success ${lowerDocs}`,
      `success ${upper}`,
      `pending ${lowerDocs}`,
      `pending ${upper}`,
    ]);
  });

  it("dispatches ci.yml on the top's head before gating when it has no run, and waits for it", async () => {
    const { dir, runLand, ghLog, statuses } = await provedSandbox();
    const dispatched = join(dir, "ci-dispatched");
    rmSync(dispatched, { force: true });
    const result = await runLand(["12", "--merge"], { ANA_FAKE_CI_AFTER: dispatched });
    expect(result.status).toBe(0);
    const calls = logLines(ghLog);
    const dispatch = calls.indexOf("workflow run ci.yml --ref b");
    expect(dispatch).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(calls.findIndex((line) => line.includes("context=ana/commit")));
    expect(
      calls.filter((line) => line.startsWith("run list")).every((line) => line.includes(`--commit ${upper}`)),
    ).toBe(true);
    expect(result.stdout).toContain(`ci.yml passed on #12's head ${short(upper)}: https://ci/1`);
    expect(statuses("ci.yml")).toEqual([`success ${upper}`]);
  });

  it("shows on the top's head that it waits for the ci.yml run it reuses, linked, until that run passes", async () => {
    const { runLand, ghLog, statuses, ciStates } = await provedSandbox();
    const result = await runLand(["12", "--merge"], {
      ANA_CI_POLL_MS: "10",
      ANA_FAKE_CI_STATES: ciStates(
        "in_progress\t\t5\thttps://ci/5\t2026-10-28T19:49:13Z",
        "in_progress\t\t5\thttps://ci/5\t2026-10-28T19:49:13Z",
        "completed\tsuccess\t5\thttps://ci/5\t2026-10-28T19:49:13Z",
      ),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `ci.yml run 5 of 2026-10-28T19:49:13Z is already on #12's head ${short(upper)}, in_progress; its verdict stands`,
    );
    expect(statuses("ci.yml")).toEqual([`pending ${upper}`, `success ${upper}`]);
    expect(
      logLines(ghLog)
        .filter((line) => line.includes("context=ci.yml"))
        .every((line) => line.endsWith("-f target_url=https://ci/5")),
    ).toBe(true);
    const calls = logLines(ghLog);
    expect(calls.findLastIndex((line) => line.includes("context=ci.yml"))).toBeLessThan(
      calls.findIndex((line) => line.includes("/merge-async")),
    );
  });

  it("refuses to merge when ci.yml failed on the top's head, brings its failed log home, and does not dispatch it again", async () => {
    const { git, runLand, ghLog, statuses } = await provedSandbox();
    const result = await runLand(["12", "--merge"], { ANA_FAKE_CI: "completed\tfailure\t9\thttps://ci/9" });
    expect(result.status).toBe(1);
    const log = join(
      git("rev-parse", "--path-format=absolute", "--git-path", "ana-gate"),
      `land-ci-${short(upper)}.log`,
    );
    expect(result.stderr).toContain("darwin: Run the suite");
    expect(result.stderr).toContain("(fail) a test that broke on the clean runner");
    expect(readFileSync(log, "utf8")).toContain("(fail) a test that broke on the clean runner");
    expect(result.stderr).toContain(
      `ci.yml ended failure on #12's head ${short(upper)}: https://ci/9. Its failed jobs' log: ${log}. Fix the ` +
        "commit it names, or run gh run rerun 9 if the runner was at fault, and land again. Nothing was merged.",
    );
    expect(statuses("ci.yml")).toEqual([`failure ${upper}`]);
    expect(
      logLines(ghLog).some((line) => /^(workflow run|run rerun)/u.test(line) || line.includes("/merge")),
    ).toBe(false);
    expect(statuses("ana/stack-gate")).toEqual([]);

    expect(
      (
        await runLand(["12", "--merge"], {
          ANA_FAKE_CI: "completed\tfailure\t9\thttps://ci/9",
          ANA_FAKE_LOG_DOWN: "1",
        })
      ).status,
    ).toBe(1);
    expect(readFileSync(log, "utf8")).toContain(
      "gh could not fetch the failed jobs' log: gh: Bad Gateway (HTTP 502)",
    );
  });
  it("refuses to restore green when a parent moves off its child while the child is being proved, and leaves nothing pending", async () => {
    const { dir, runLand, statuses, leftPending } = sandbox();
    const next = join(dir, "moved-pulls");
    rmSync(`${next}.read`, { force: true });
    writeFileSync(next, JSON.stringify([pull(11, "a", "main", beside), pull(12, "b", "a", upper)]));
    const result = await runLand(["12", "--sanitize"], { ANA_FAKE_PULLS_NEXT: next });
    expect(statuses("mergeable")).toEqual([
      `pending ${lowerDocs}`,
      `pending ${upper}`,
      `success ${lowerDocs}`,
      `error ${upper}`,
    ]);
    expect(leftPending(COMMIT)).toEqual([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "#12 holds none of the heads GitHub records for the pull request beneath it",
    );
  });

  it("lands again on the heads as they stand when a head moves while it is proved", async () => {
    const { dir, runLand, gateLog, statuses } = sandbox();
    const next = join(dir, "moved-pulls");
    rmSync(`${next}.read`, { force: true });
    writeFileSync(next, JSON.stringify([pull(11, "a", "main", lowerMore), pull(12, "b", "a", upper)]));
    const result = await runLand(["12", "--sanitize"], { ANA_FAKE_PULLS_NEXT: next });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "a pull request's head or the trunk moved while its commits were gated. Landing again on the heads as they stand.",
    );
    expect(statuses("mergeable")).toEqual([
      `pending ${lowerDocs}`,
      `pending ${upper}`,
      `success ${lowerDocs}`,
      `success ${lowerMore}`,
      `success ${upper}`,
    ]);
    expect(gatesRun(gateLog).filter((gate) => gate.startsWith(upper))).toEqual([`${upper} suite`]);
  });

  it("stops the whole gate under way once its head moves, and lands the moved heads", async () => {
    const { dir, runLand, gateLog, leftPending } = sandbox();
    const later = join(dir, "later-pulls");
    rmSync(`${later}.read`, { force: true });
    writeFileSync(later, JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "b", "a", stacked)]));
    const result = await runLand(["12", "--sanitize"], {
      ANA_FAKE_PULLS_LATER: later,
      ANA_FAKE_SUITE: "(pass) one",
      ANA_FAKE_SUITE_TOUCH: `${later}.read`,
      ANA_LAND_WATCH_MS: "100",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${short(upper)}: stopped.`);
    expect(result.stdout).toContain(
      "#12 moved under a commit being proved. Landing again on the heads as they stand.",
    );
    const proved = gatesRun(gateLog).map((gate) => gate.split(" ")[0]);
    expect(proved.slice(-3)).toEqual([upper, upper, stacked]);
    expect(leftPending(COMMIT)).toEqual([]);
  });

  describe.concurrent("after a full run failed in its tests on an earlier head of the top's branch", () => {
    const fixPulls = JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "fix", "a", fixed)]);
    const failedLog = join(fixture, "failed.log");
    const step = "Run bun run test -- $TESTS";
    writeFileSync(
      failedLog,
      [
        `linux\t${step}\t2026-11-07T10:00:00.1Z test/owner.test.ts:`,
        `darwin\t${step}\t2026-11-07T10:00:00.2Z test/far.test.ts:`,
        `linux\t${step}\t2026-11-07T10:00:00.3Z (fail) the owner > holds one [1.00ms]`,
        `darwin\t${step}\t2026-11-07T10:00:00.4Z (pass) far > stays [1.00ms]`,
        // A file that fails between its tests, or as it loads, prints no `(fail)` line.
        `darwin\t${step}\t2026-11-07T10:00:00.46Z # Unhandled error between tests`,
        `linux\t${step}\t2026-11-07T10:00:00.5Z test/far.test.ts:`,
        `linux\t${step}\t2026-11-07T10:00:00.6Z 1 tests failed:`,
        `linux\t${step}\t2026-11-07T10:00:00.7Z (fail) the owner > holds one [1.00ms]`,
      ].join("\n"),
    );
    let fixPasses: Promise<string> | null = null;
    const rememberedFixPasses = (): Promise<string> => {
      fixPasses ??= (async () => {
        const seed = await provedSandbox();
        const seeded = await seed.runLand(["12", "--sanitize"], {
          ANA_FAKE_PULLS: fixPulls,
          ANA_FAKE_STACK_SHA: fixed,
        });
        expect(seeded.status, seeded.stderr).toBe(0);
        const cache = join(fixture, "ana-gate-passed-fixes");
        copyFileSync(join(seed.work, ".git", "ana-gate-passed"), cache);
        return cache;
      })();
      return fixPasses;
    };
    const fixesLand = async (env: Record<string, string>) => {
      const box = sandbox();
      copyFileSync(await rememberedFixPasses(), join(box.work, ".git", "ana-gate-passed"));
      const result = await box.runLand(["12", "--merge"], {
        ANA_FAKE_PULLS: fixPulls,
        ANA_FAKE_CI_STATES: box.ciStates(
          "none",
          "completed\tsuccess\t3\thttps://ci/3\t2026-11-07T11:00:00Z\tci-fixes",
        ),
        ANA_FAKE_FAILED_LOG: failedLog,
        ANA_FAKE_CI_BRANCH: `${broken}\tfailure\t9`,
        ANA_FAKE_STACK_SHA: fixed,
        ...env,
      });
      return {
        result,
        described: box.described,
        dispatches: () => logLines(box.ghLog).filter((line) => line.startsWith("workflow run")),
      };
    };

    it("dispatches ci-fixes with the files that failed and the tests one import from the fix, and merges once it passes", async () => {
      const { result, dispatches, described } = await fixesLand({});
      expect(result.status).toBe(0);
      expect(dispatches()).toEqual([
        "workflow run ci.yml --ref fix -f tests=test/a.test.ts test/far.test.ts test/owner.test.ts -f ui_tests=",
      ]);
      expect(result.stdout).toContain(`dispatched ci-fixes, 3 test files since run 9 on ${short(broken)},`);
      expect(described("ci.yml").at(-1)).toBe(`${fixed} ci.yml's ci-fixes run 3 passed on this head`);
    });

    it("dispatches the full run where the failed run failed beyond its tests", async () => {
      const { result, dispatches } = await fixesLand({ ANA_FAKE_CI_STEPS: `${step}, The climb simulation` });
      expect(dispatches()).toEqual(["workflow run ci.yml --ref fix"]);
      expect(result.stdout).toContain(
        `ci.yml runs in full: run 9 on ${short(broken)} failed beyond its tests (The climb simulation).`,
      );
    });

    it("dispatches the full run where the wall imports what the fix changed, since only both platforms' suites prove it", async () => {
      const { result, dispatches } = await fixesLand({
        ANA_FAKE_PULLS: JSON.stringify([
          pull(11, "a", "main", lowerDocs),
          pull(12, "wallfix", "a", wallFixed),
        ]),
        ANA_FAKE_CI_BRANCH: `${wallBroken}\tfailure\t9`,
        ANA_FAKE_STACK_SHA: wallFixed,
      });
      expect(dispatches()).toEqual(["workflow run ci.yml --ref wallfix"]);
      expect(result.stdout).toContain(
        "ci.yml runs in full: src/a.ts, which the wall imports, changed since run 9.",
      );
    });

    it("dispatches the full run where the failed run's test step was cut short", async () => {
      const { result, dispatches } = await fixesLand({ ANA_FAKE_CI_STEPS: `${step} cancelled` });
      expect(dispatches()).toEqual(["workflow run ci.yml --ref fix"]);
      expect(result.stdout).toContain(`failed beyond its tests (${step} cancelled)`);
    });

    for (const conclusion of ["timed_out", "action_required", "stale", ""]) {
      it(`dispatches the full run when the prior run ended ${conclusion || "without a conclusion"}`, async () => {
        const { result, dispatches } = await fixesLand({ ANA_FAKE_CI_BRANCH: `${broken}\t${conclusion}\t9` });
        expect(dispatches()).toEqual(["workflow run ci.yml --ref fix"]);
        expect(result.stdout).toContain(
          `ci.yml runs in full: run 9 ended ${conclusion || "without a conclusion"}.`,
        );
      });
    }

    it("dispatches the full run where what runs the suite changed since", async () => {
      const { result, dispatches } = await fixesLand({ ANA_FAKE_CI_BRANCH: `${upper}\tfailure\t9` });
      expect(dispatches()).toEqual(["workflow run ci.yml --ref fix"]);
      expect(result.stdout).toContain("ci.yml runs in full: .github/workflows/ci.yml changed since run 9.");
    });
  });
});

const REFUSED: readonly (readonly [
  string,
  readonly string[],
  (ciStates: (...rows: string[]) => string) => Record<string, string | undefined>,
  number,
  string,
])[] = [
  [
    "latest with nothing open",
    ["latest", "--sanitize"],
    () => ({ ANA_FAKE_PULLS: "[]" }),
    1,
    "no pull request is open",
  ],
  [
    "an unreadable host list",
    ["12", "--sanitize"],
    () => ({ ANA_HOSTS: "[{", ANA_CHECK_HOST: undefined }),
    2,
    "land: ANA_HOSTS is not JSON",
  ],
  ["an unknown flag", ["12", "--sanitise"], () => ({}), 2, "Unknown option '--sanitise'"],
  [
    "a head holding none of the heads beneath it",
    ["12", "--sanitize"],
    () => ({ ANA_FAKE_PULLS: stack(beside) }),
    1,
    "#12 holds none of the heads GitHub records for the pull request beneath it",
  ],
  [
    "a head repeating another pull request's commits",
    ["14"],
    () => ({ ANA_FAKE_PULLS: stack(upper, pull(14, "c", "a", stacked)) }),
    1,
    "#14 (c, on a) repeats the commits of #12: base it on b",
  ],
  [
    "a bottom based on neither main nor an open pull request",
    ["12"],
    () => ({ ANA_FAKE_PULLS: JSON.stringify([pull(12, "b", "a", upper)]) }),
    1,
    "#12 (b) is based on a, which is neither main nor an open pull request's head.",
  ],
  [
    "a merge beside another chain on main",
    ["13", "--merge"],
    () => ({ ANA_FAKE_STACK: "", ANA_FAKE_STACK_SHA: beside }),
    1,
    "land: #11 (a) starts another chain on main, which this merge would leave short of main's new head",
  ],
  [
    "a stack GitHub did not say",
    ["12", "--merge"],
    () => ({ ANA_FAKE_STACK: "down" }),
    1,
    "land: GitHub did not say which stack #11 is in: gh: Bad Gateway (HTTP 502) Land again. Nothing was merged.",
  ],
  [
    "a native stack in another order than the bases",
    ["12", "--merge"],
    () => ({ ANA_FAKE_STACK: "7 13,12" }),
    1,
    "run gh stack unstack 7, then gh stack link 11 12, and land again. Nothing was merged.",
  ],
  [
    "no ci.yml run and no dispatch to start one",
    ["15", "--merge"],
    (ciStates) => ({
      ANA_FAKE_PULLS: JSON.stringify([pull(15, "nodispatch", "main", noDispatch)]),
      ANA_FAKE_STACK: "",
      ANA_FAKE_CI_STATES: ciStates("none"),
    }),
    1,
    `no ci.yml run exists on #15's head ${short(noDispatch)}, and ci.yml there takes no workflow_dispatch`,
  ],
  [
    // GitHub fails every try; a run follows, so code that read the failed list as "none" dispatches and passes.
    "a ci.yml run list GitHub failed to give",
    ["12", "--merge"],
    (ciStates) => ({
      ANA_FAKE_CI_STATES: ciStates("down", "down", "down", "completed\tsuccess\t19\thttps://ci/19"),
    }),
    1,
    `GitHub did not list ci.yml's runs on #12's head ${short(upper)}. Land again.`,
  ],
];

describe.concurrent("a landing refused before anything is proved or written", () => {
  it.each(REFUSED)("%s", async (_, args, env, status, says) => {
    const { runLand, gateLog, writes, ciStates } = sandbox();
    const result = await runLand(args, env(ciStates));
    expect([result.status, result.stderr.includes(says)]).toEqual([status, true]);
    expect(result.stderr).not.toContain("land.ts:");
    expect(gatesRun(gateLog)).toEqual([]);
    expect(writes()).toEqual([]);
  });
});

it("reads the chain again before each proof starts, so a head moved on proves its new commits and not the old head", async () => {
  const { dir, runLand, gateLog, statuses, leftPending } = sandbox();
  const next = join(dir, "moved-pulls");
  rmSync(`${next}.read`, { force: true });
  writeFileSync(next, JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "b", "a", stacked)]));
  const result = await runLand(["12", "--sanitize"], { ANA_FAKE_PULLS_NEXT: next });
  expect(result.status).toBe(0);
  const gates = gatesRun(gateLog);
  expect(gates).not.toContain(`${upper} suite`);
  expect(gates.filter((gate) => gate.startsWith(upper))).toHaveLength(1);
  expect(gates.at(-1)).toBe(`${stacked} suite`);
  expect(statuses("mergeable").findLast((row) => row.endsWith(stacked))).toBe(`success ${stacked}`);
  expect(statuses("mergeable").at(-1)).toBe(`error ${upper}`);
  expect(leftPending("mergeable")).toEqual([]);
});

describe("the stack a landing reads after a partial merge", () => {
  it("leaves the members already merged out of the next landing's chain", () => {
    const stacks = JSON.stringify([
      {
        number: 7,
        open: true,
        pull_requests: [
          { number: 11, state: "closed" },
          { number: 12, state: "open" },
          { number: 13, state: "open" },
        ],
      },
    ]);
    const read = spawnTextSync("jq", ["-r", STACK_MEMBERS], { stdin: stacks });
    expect(read.stdout.trim()).toBe("7 12,13 11");
  });
});
