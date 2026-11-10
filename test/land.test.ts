/**
 * `bun run land` over a real two-pull-request stack in a fixture repository with its own origin, with
 * GitHub and the gate's steps replaced at their command boundaries. The fake `gh` answers from the
 * environment and logs every call, so a case reads which statuses were posted, on what, and in which
 * order against each merge; the fake `bun` (`test/helpers/fake-bun.ts`) logs each gate's steps. The
 * open pull requests are ANA_FAKE_PULLS; `ci.yml` has passed on the top's head unless ANA_FAKE_CI
 * says otherwise, or ANA_FAKE_CI_AFTER names a file only a dispatch creates. ANA_FAKE_CI_STATES
 * names a file whose lines answer successive run reads, the last repeating: `none` lists no run and
 * `down` fails as a 502 would. ANA_FAKE_STACK is the open native stack the top is in, as its number
 * and its members, `down` failing the read; by default stack 7 of #11 and #12. Once `gh stack link`
 * has been called, a read answers ANA_FAKE_LINKED where it is set. The top's merge is
 * asked for under the id ANA_FAKE_STACK_UUID and ends as ANA_FAKE_STACK_END says, `refused`
 * refusing the asking, with ANA_FAKE_STACK_SHA as its commit, by default the top's.
 * ANA_FAKE_SHOWN names a file of the statuses GitHub shows already, one `sha context state
 * description` a line, tab-separated, as the GraphQL reading's `--jq` prints them.
 * Nothing here reaches GitHub, and nothing is pushed but to the fixture's own bare origin.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";

import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { fakeBun, gatesRun, logLines } from "./helpers/fake-bun.ts";
import { STACK_MEMBERS } from "../tools/runtime/pulls.ts";

const land = join(import.meta.dir, "..", "tools", "runtime", "land.ts");
const fixture = mkdtempSync(join(tmpdir(), "ana-land-"));
const work = join(fixture, "work");
const origin = join(fixture, "origin.git");
const bin = join(fixture, "bin");
const ghLog = join(fixture, "gh.log");
const gateLog = join(fixture, "gates.log");
const fake = (mkdirSync(bin), fakeBun(bin, gateLog));
/** The status `land` posts on each commit it proves (`COMMIT_CONTEXT`, `tools/runtime/land.ts`). */
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
  if [ -n "$ANA_FAKE_LINKED" ] && grep -q '^stack link' "$ANA_GH_LOG"; then printf '%s\n' "$ANA_FAKE_LINKED"
  else printf '%s\n' "$ANA_FAKE_STACK"; fi ;;
"stack link"*) ;;
"api -X"*) case "$*" in *"state=success -f context=mergeable"*)
  [ -z "$ANA_FAKE_PULLS_NEXT" ] || touch "$ANA_FAKE_PULLS_NEXT.read" ;; esac ;;
"api repos/"*) echo true ;;
esac
`;

const git = (...args: string[]): string => execTextSync("git", args, { cwd: work }).trim();
function commit(file: string, text: string, message: string): string {
  writeFileSync(join(work, file), text);
  git("add", "-A");
  git("commit", "-qm", message);
  return git("rev-parse", "HEAD");
}
const publish = (): string =>
  execTextSync("git", ["-C", origin, "fetch", "-q", work, "+refs/heads/*:refs/heads/*"]);
const short = (sha: string): string => sha.slice(0, 9);

writeFileSync(join(bin, "gh"), GH);
chmodSync(join(bin, "gh"), 0o755);
mkdirSync(join(work, ".github", "workflows"), { recursive: true });
mkdirSync(join(work, "src"));
mkdirSync(join(work, "test"));
git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@localhost");
git("config", "user.name", "fixture");
const workflow = (dispatch: string): string => `name: ci\non:\n  pull_request:\n${dispatch}jobs: {}\n`;
writeFileSync(join(work, ".github", "workflows", "ci.yml"), workflow("  workflow_dispatch:\n"));
writeFileSync(join(work, "README.md"), "one\n");
writeFileSync(
  join(work, "test", "owner.test.ts"),
  'import { owner } from "../src/owner.ts";\nexport { owner };\n',
);
const trunk = commit("src/owner.ts", "export const owner = 1;\n", "base");
git("checkout", "-q", "-b", "a");
const lower = commit("src/a.ts", "export const a = 1;\n", "a");
const lowerMore = commit("src/owner.ts", "export const owner = 2;\n", "a more");
const lowerDocs = commit("README.md", "two\n", "a docs");
git("checkout", "-q", "-b", "b");
const upper = commit("src/b.ts", "export const b = 1;\n", "b");
git("checkout", "-q", "-b", "beside", "main");
const beside = commit("src/c.ts", "export const c = 1;\n", "beside");
git("checkout", "-q", "-b", "merged");
git("merge", "-qm", "merge a through the second parent", "a");
const merged = git("rev-parse", "HEAD");
git("checkout", "-q", "-b", "tests", "main");
commit("test/c.test.ts", "export {};\n", "a test");
const testsTop = commit("src/d.ts", "export const d = 1;\n", "d");
git("checkout", "-q", "-b", "nodispatch", "main");
const noDispatch = commit(".github/workflows/ci.yml", workflow(""), "no dispatch");
git("checkout", "-q", "-b", "c", "b");
const stacked = commit("src/e.ts", "export const e = 1;\n", "c");
// A head where ci.yml failed, and its fix: the only test near the fix is test/a.test.ts.
git("checkout", "-q", "-b", "fix", "b");
writeFileSync(join(work, "test", "a.test.ts"), 'import { a } from "../src/a.ts";\nexport { a };\n');
writeFileSync(join(work, "test", "far.test.ts"), "export {};\n");
const fixesWorkflow = workflow("  workflow_dispatch:\n    inputs:\n      tests:\n      ui_tests:\n");
const broken = commit(".github/workflows/ci.yml", fixesWorkflow, "a head ci.yml failed on");
const fixed = commit("src/a.ts", "export const a = 2;\n", "the fix");
// The same fix where the wall imports the file it changes, two imports from its own folder.
git("checkout", "-q", "-b", "wallfix", "b");
mkdirSync(join(work, "src", "wall"), { recursive: true });
writeFileSync(join(work, "test", "a.test.ts"), 'import { a } from "../src/a.ts";\nexport { a };\n');
writeFileSync(join(work, "src", "wall", "policy.ts"), 'import { a } from "../a.ts";\nexport { a };\n');
const wallBroken = commit(
  ".github/workflows/ci.yml",
  fixesWorkflow,
  "a head ci.yml failed on, beside the wall",
);
const wallFixed = commit("src/a.ts", "export const a = 2;\n", "the fix the wall reads");
git("checkout", "-q", "b");
execTextSync("git", ["init", "-q", "--bare", origin]);
execTextSync("git", ["-C", origin, "config", "uploadpack.allowAnySHA1InWant", "true"]);
publish();
git("remote", "add", "origin", origin);

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

const pull = (number: number, head: string, base: string, sha: string, isDraft = false) => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: sha,
  isDraft,
  labels: [{ name: "importance:I2" }, { name: "landing" }],
});
/** A pull request carrying `names` as its labels in place of its importance and category labels. */
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

const landEnv = (env: Record<string, string>): Record<string, string | undefined> => ({
  ...Bun.env,
  ...fake,
  ANA_GH_LOG: ghLog,
  ANA_FAKE_PULLS: stack(),
  ANA_FAKE_STACK: "7 11,12",
  ANA_FAKE_STACK_END: "merged",
  ANA_FAKE_STACK_UUID: "u1",
  ANA_FAKE_STACK_SHA: upper,
  ...env,
});

/** One landing, as a session runs it with `--once`; following its stack is proved on its own. */
function runLand(args: readonly string[], env: Record<string, string> = {}) {
  return spawnTextSync(capturedExecPath, [land, ...args, "--once"], { cwd: work, env: landEnv(env) });
}

const statuses = (context: string): string[] =>
  logLines(ghLog).flatMap((line) => {
    const match = /\/statuses\/(\w+) -f state=(\w+) -f context=(\S+)/u.exec(line);
    return match?.[3] === context ? [`${match[2]} ${match[1]}`] : [];
  });
const described = (context: string): string[] =>
  logLines(ghLog).flatMap((line) => {
    const match =
      /\/statuses\/(\w+) -f state=\w+ -f context=(\S+) -f description=(.+) --silent( -f target_url=\S+)?$/u.exec(
        line,
      );
    return match?.[2] === context ? [`${match[1]} ${match[3]}`] : [];
  });
/** The commits whose last `context` status this landing posted is still pending. */
const leftPending = (context: string): string[] => {
  const last = new Map(statuses(context).map((row) => [row.split(" ")[1], row.split(" ")[0]]));
  return [...last].flatMap(([sha, state]) => (state === "pending" ? [String(sha)] : []));
};
const writes = (): string[] =>
  logLines(ghLog).filter((line) => line.includes("-X") || line.startsWith("workflow"));
const forgetPasses = (): void => rmSync(join(work, ".git", "ana-gate-passed"), { force: true });

const ciStates = (...rows: string[]): string => {
  const file = join(fixture, "ci-states");
  writeFileSync(file, `${rows.join("\n")}\n`);
  return file;
};

beforeEach(() => {
  rmSync(ghLog, { force: true });
  rmSync(gateLog, { force: true });
  forgetPasses();
});

describe("bun run land", () => {
  it("proves each commit once, then sanitizes cached verdicts only when asked", () => {
    const result = runLand(["12"]);
    expect(result.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([`${lower} -`, `${lowerMore} test/owner.test.ts`, `${upper} suite`]);
    // Each line names the pull request that holds its commit, so a long landing shows where it is.
    expect(result.stdout).toContain(`3 of 4, pr11 ${short(lowerDocs)}: documentation only.`);
    expect(result.stdout).toContain(`4 of 4, pr12 ${short(upper)}: passed.`);
    expect(result.stdout).toContain("--sanitize shows it on GitHub");
    expect(writes()).toEqual([]);
    rmSync(gateLog, { force: true });
    const sanitized = runLand(["12", "--sanitize"]);
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

  it("merges over the passes a sanitize left, running no gate again", () => {
    expect(runLand(["12", "--sanitize"]).status).toBe(0);
    rmSync(gateLog, { force: true });
    const landed = runLand(["12", "--merge"]);
    expect(landed.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([]);
    expect(landed.stdout).toContain("passed earlier on these exact bytes");
  });

  it("posts only the statuses GitHub does not show already, and reads the chain once over remembered passes", () => {
    expect(runLand(["12", "--sanitize"]).status).toBe(0);
    const posted = logLines(ghLog).flatMap((line) => {
      const match = /\/statuses\/(\w+) -f state=(\w+) -f context=(\S+) -f description=(.+) --silent$/u.exec(
        line,
      );
      return match === null ? [] : [[match[1], match[3], match[2], match[4]]];
    });
    // The last of each commit and context stands, and one has gone stale since.
    const latest = new Map(
      posted.map(([sha, context, ...rest]) => [`${String(sha)} ${String(context)}`, [sha, context, ...rest]]),
    );
    const stale = latest.get(`${upper} ana/commit`) ?? [];
    latest.set(`${upper} ana/commit`, [upper, COMMIT, "pending", "an earlier landing"]);
    const shown = join(fixture, "shown");
    writeFileSync(shown, `${[...latest.values()].map((row) => row.join("\t")).join("\n")}\n`);
    rmSync(ghLog, { force: true });
    const again = runLand(["12", "--sanitize"], { ANA_FAKE_SHOWN: shown });
    expect(again.status).toBe(0);
    expect(described(COMMIT)).toEqual([`${upper} ${String(stale[3])}`]);
    expect(statuses("mergeable")).toEqual([]);
    // Nothing is proved, so the landing's own reading stands for every head it turns green.
    expect(logLines(ghLog).filter((line) => line.startsWith("pr list"))).toHaveLength(1);
  });

  it("posts a verdict again over the same one GitHub showed before the landing turned it pending", () => {
    expect(runLand(["12", "--sanitize"]).status).toBe(0);
    const shown = join(fixture, "shown-green");
    const rows = logLines(ghLog).flatMap((line) => {
      const match = /\/statuses\/(\w+) -f state=(\w+) -f context=(\S+) -f description=(.+) --silent$/u.exec(
        line,
      );
      return match === null ? [] : [[match[1], match[3], match[2], match[4]].join("\t")];
    });
    writeFileSync(shown, `${rows.join("\n")}\n`);
    rmSync(ghLog, { force: true });
    forgetPasses();
    const again = runLand(["12", "--sanitize"], { ANA_FAKE_SHOWN: shown });
    expect(again.status).toBe(0);
    // Proved afresh, each commit reads pending and then its verdict, the one GitHub showed before.
    expect(statuses(COMMIT).filter((row) => row.endsWith(upper))).toEqual([
      `pending ${upper}`,
      `success ${upper}`,
    ]);
    expect(statuses("mergeable").filter((row) => row.endsWith(upper))).toEqual([
      `pending ${upper}`,
      `success ${upper}`,
    ]);
  });

  it("with --auto lands a pull request stacked on the top during its proof, and merges the new top", () => {
    const next = join(fixture, "stacked-pulls");
    rmSync(`${next}.read`, { force: true });
    writeFileSync(next, stack(upper, pull(15, "c", "b", stacked)));
    const result = runLand(["12", "--auto", "--merge"], {
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

  it("with no pull request named lands the stack that holds the oldest stacked pull request, up to its top", () => {
    const result = runLand(["--sanitize"], {
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

  it("with latest named lands the open stack whose top has the highest number, up to its top", () => {
    const result = runLand(["latest", "--sanitize"], {
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

  it("with latest named and no pull request open refuses before it takes the landing", () => {
    const result = runLand(["latest", "--sanitize"], { ANA_FAKE_PULLS: "[]" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no pull request is open");
  });

  it("proves every landing head and turns the stack green when a lower head is a merge's second parent", () => {
    const result = runLand(["12", "--sanitize"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "merged", "a", merged)]),
    });
    expect(result.status).toBe(0);
    // A head reads pending from the moment a commit it holds is proved afresh, until it passes.
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

  it("stops at the first commit that fails and names its pull request and where the fix goes", () => {
    const result = runLand(["12", "--sanitize"], { ANA_FAKE_FAIL: `${lower} lint` });
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

  // The runner's exits that say nothing of the commit: a dropped connection, no slot in time, and a
  // host that does not answer or lacks the disk (`tools/runtime/router/run.sh`).
  for (const code of ["255", "75", "69"]) {
    it(`runs a step again where its runner exited ${code}, and passes on the second run`, () => {
      const result = runLand(["12", "--sanitize"], {
        ANA_FAKE_DROP: `${upper} test`,
        ANA_FAKE_DROP_CODE: code,
      });
      expect(result.status).toBe(0);
      expect(logLines(gateLog).filter((line) => line === `${upper}\trun test`)).toHaveLength(2);
      expect(statuses(COMMIT)).toContain(`success ${upper}`);
    });

    it(`reads two exits of ${code} as no verdict: an error status, no fix recipe, and land again`, () => {
      const result = runLand(["12", "--sanitize"], {
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
      expect(statuses("mergeable")).toEqual([
        `pending ${lowerDocs}`,
        `pending ${upper}`,
        `success ${lowerDocs}`,
        `error ${upper}`,
      ]);
    });
  }

  it("refuses a head that holds none of the heads the pull request beneath it had", () => {
    const result = runLand(["12", "--sanitize"], { ANA_FAKE_PULLS: stack(beside) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "#12 holds none of the heads GitHub records for the pull request beneath it",
    );
    expect(gatesRun(gateLog)).toEqual([]);
  });

  it("replays a pull request whose parent was rewritten onto it with --sanitize, pushes it and proves it", () => {
    git("checkout", "-q", "-b", "ra", lowerMore);
    const rewritten = commit("README.md", "two, fixed\n", "a docs");
    git("branch", "rb", upper);
    git("checkout", "-q", "b");
    publish();
    const env = {
      ANA_FAKE_PULLS: JSON.stringify([pull(21, "ra", "main", "@ra"), pull(22, "rb", "ra", "@rb")]),
      ANA_FAKE_PULLS_ORIGIN: origin,
      // Newest first: the parent's head now, then the one #22 was built on.
      ANA_FAKE_TIMELINE: `${rewritten}\n${lowerDocs}`,
      ANA_FAKE_STACK: "8 21,22",
    };
    const proving = runLand(["22"], env);
    expect(proving.status).toBe(1);
    expect(proving.stderr).toContain("#22 (rb) does not contain #21's head");
    expect(proving.stderr).toContain("--sanitize or --merge replays it.");
    expect(gatesRun(gateLog)).toEqual([]);
    const result = runLand(["22", "--sanitize"], env);
    expect(result.status).toBe(0);
    const moved = execTextSync("git", ["-C", origin, "rev-parse", "rb"]).trim();
    expect(result.stdout).toContain(`replaying what moved beneath: #22 ${short(upper)} -> ${short(moved)}`);
    expect(result.stdout).toContain(`git rebase --onto ${short(moved)} ${short(upper)} rb`);
    expect(git("rev-parse", `${moved}^`)).toBe(rewritten);
    expect(git("show", `${moved}:README.md`)).toBe("two, fixed");
    expect(git("show", `${moved}:src/b.ts`)).toBe("export const b = 1;");
    expect(gatesRun(gateLog).at(-1)).toBe(`${moved} suite`);
  });

  it("refuses an unlabelled landing that --sanitize would replay before force-pushing anything", () => {
    git("checkout", "-q", "-b", "ua", lowerMore);
    const rewritten = commit("README.md", "two, mended\n", "a docs");
    git("branch", "ub", upper);
    git("checkout", "-q", "b");
    publish();
    const result = runLand(["32", "--sanitize"], {
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

  // #531 on 30 October 2026: based on the branch beneath #530 while its head held #530's.
  it("refuses a head that holds another open pull request's without standing on it", () => {
    const result = runLand(["14"], { ANA_FAKE_PULLS: stack(upper, pull(14, "c", "a", stacked)) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#14 (c, on a) repeats the commits of #12: base it on b");
    expect(gatesRun(gateLog)).toEqual([]);
  });

  // The last merge leaves main at the top's tree only while the bottom contains main's head.
  it("refuses a stack whose bottom does not contain main's head", () => {
    git("checkout", "-q", "main");
    const moved = commit("src/owner.ts", "export const owner = 3;\n", "hotfix");
    publish();
    try {
      const result = runLand(["12", "--sanitize"]);
      expect(result.status).toBe(1);
      // Its replay onto main's head conflicts with the hotfix, so nothing is pushed.
      expect(result.stderr).toContain(`#11 does not replay cleanly onto ${short(moved)}`);
      expect(gatesRun(gateLog)).toEqual([]);
    } finally {
      git("reset", "-q", "--hard", trunk);
      git("checkout", "-q", "b");
      publish();
    }
  });

  it("refuses a stack whose bottom is based on a branch that is neither main nor an open pull request", () => {
    const result = runLand(["12"], { ANA_FAKE_PULLS: JSON.stringify([pull(12, "b", "a", upper)]) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "#12 (b) is based on a, which is neither main nor an open pull request's head.",
    );
  });

  it("refuses a landing in which a pull request carries no importance label or two, or no category label, naming each, before gating anything", () => {
    const unranked = JSON.stringify([
      labelled(pull(11, "a", "main", lowerDocs)),
      labelled(pull(12, "b", "a", upper), "importance:I1", "importance:I3", "runs"),
      labelled(pull(13, "beside", "main", beside)),
    ]);
    for (const flags of [[], ["--sanitize"], ["--merge"]]) {
      rmSync(ghLog, { force: true });
      const result = runLand(["12", ...flags], { ANA_FAKE_PULLS: unranked });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "#11 carries no importance label, and no category label; #12 carries importance:I1 and importance:I3. Give each pull request exactly one",
      );
      expect(result.stderr).not.toContain("#13");
      expect(gatesRun(gateLog)).toEqual([]);
      expect(logLines(ghLog).filter((call) => call.startsWith("api -X POST"))).toEqual([]);
    }
    // An importance label with no category is refused; one of each among others lands.
    const uncategorised = JSON.stringify([
      labelled(pull(11, "a", "main", lowerDocs), "importance:I0", "bug"),
      pull(12, "b", "a", upper),
    ]);
    const refused = runLand(["12"], { ANA_FAKE_PULLS: uncategorised });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("#11 carries no category label. Give each pull request");
    expect(refused.stderr).not.toContain("#12");
    const ranked = JSON.stringify([
      labelled(pull(11, "a", "main", lowerDocs), "importance:I0", "docs"),
      pull(12, "b", "a", upper),
    ]);
    expect(runLand(["12"], { ANA_FAKE_PULLS: ranked }).status).toBe(0);
  });

  it("refuses to merge a pull request beside another open chain on main, before gating anything", () => {
    const result = runLand(["13", "--merge"], { ANA_FAKE_STACK: "", ANA_FAKE_STACK_SHA: beside });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "land: #11 (a) starts another chain on main, which this merge would leave short of main's new head",
    );
    expect(gatesRun(gateLog)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("merges a pull request beside another open chain on main when --alone names it", () => {
    const result = runLand(["13", "--merge", "--alone"], { ANA_FAKE_STACK: "", ANA_FAKE_STACK_SHA: beside });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `land: #13 merged into main as #13, at ${short(beside)}: ${short(beside)}.`,
    );
  });

  it("merges a lone pull request in no stack through its own merge, pinned to its gated head", () => {
    const result = runLand(["13", "--merge"], {
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

  it("refuses a landing whose stack GitHub did not say, before gating", () => {
    const result = runLand(["12", "--merge"], { ANA_FAKE_STACK: "down" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "land: GitHub did not say which stack #11 is in: gh: Bad Gateway (HTTP 502) Land again. Nothing was merged.",
    );
    expect(gatesRun(gateLog)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  /** #15 opened on #12, above GitHub's top of stack 7. */
  const opened = { ANA_FAKE_PULLS: stack(upper, pull(15, "c", "b", stacked)), ANA_FAKE_STACK_SHA: stacked };
  const linkCalls = (): string[] => logLines(ghLog).filter((line) => line.startsWith("stack link"));

  it("links a pull request opened above GitHub's top into the stack, naming the whole chain, before gating", () => {
    const result = runLand(["15", "--sanitize"], { ...opened, ANA_FAKE_LINKED: "7 11,12,15" });
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

  it("links a landing of several pull requests in no stack, and merges it as one", () => {
    const result = runLand(["12", "--merge"], { ANA_FAKE_STACK: "", ANA_FAKE_LINKED: "7 11,12" });
    expect(result.status).toBe(0);
    expect(linkCalls()).toEqual(["stack link 11 12"]);
    expect(result.stdout).toContain("land: #11, #12 merged into main as stack 7");
  });

  it("refuses a stack that holds the chain in another order, naming unstack then link, and links nothing", () => {
    const result = runLand(["12", "--sanitize"], { ANA_FAKE_STACK: "7 12,11", ANA_FAKE_LINKED: "7 11,12" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "land: GitHub's stack 7 holds #12, #11, and the chain of bases up to #12 holds #11, #12. A link never " +
        "reorders a stack: run gh stack unstack 7, then gh stack link 11 12, and land again. Nothing was merged.",
    );
    expect(linkCalls()).toEqual([]);
    expect(gatesRun(gateLog)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("without a flag says the link it would run, and links nothing", () => {
    const result = runLand(["15"], opened);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "land: #11, #12, #15 are not one stack on GitHub; --sanitize or --merge runs gh stack link 11 12 15.",
    );
    expect(linkCalls()).toEqual([]);
    expect(writes()).toEqual([]);
  });

  const stackMerge = (end: string, more: Record<string, string> = {}) =>
    runLand(["12", "--merge"], {
      ANA_FAKE_STACK: "7 11,12,14",
      ANA_FAKE_STACK_END: end,
      ANA_FAKE_STACK_UUID: "u1",
      ...more,
    });
  const askedStack = `api -X PUT repos/{owner}/{repo}/pulls/12/merge-async -f merge_method=merge -f merge_action=direct_merge -f sha=${upper}`;

  it("merges a landing GitHub holds as a stack whole, through the stack's merge, after the statuses", () => {
    const result = stackMerge("merged", { ANA_FAKE_STACK_SHA: upper });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `land: #11, #12 merged into main as stack 7, at ${short(upper)}: ${short(upper)}.`,
    );
    expect(statuses("ana/stack-gate")).toEqual([`success ${lowerDocs}`, `success ${upper}`]);
    const calls = logLines(ghLog);
    const asked = calls.findIndex((line) => line.startsWith(askedStack));
    expect(calls.findLastIndex((line) => line.includes("context=ana/stack-gate"))).toBeLessThan(asked);
    // After the merge, the open pull requests are read once more for any left on the top's branch.
    expect(calls.slice(asked + 1).map((line) => line.split(" --jq")[0]?.split(" --json")[0])).toEqual([
      "api repos/{owner}/{repo}/pulls/12/merge-async/u1",
      "pr list --state open --limit 200",
    ]);
    expect(calls.some((line) => /pulls\/\d+\/merge -f/u.test(line) || line.includes("-X PATCH"))).toBe(false);
    expect(calls.some((line) => line.startsWith("pr edit"))).toBe(false);
  });

  it("says a failed read of the open pull requests after a merge and still ends as merged", () => {
    writeFileSync(ghLog, "");
    const result = stackMerge("merged", { ANA_FAKE_STACK_SHA: upper, ANA_FAKE_PULLS_DOWN_MERGED: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("merged into main as stack 7");
    expect(result.stdout).toContain("land: could not list the open pull requests");
    expect(logLines(ghLog).some((line) => line.startsWith("pr edit"))).toBe(false);
  });

  it("moves a pull request left on the merged top's branch onto main, and none based elsewhere", () => {
    // #15 is stacked on #12 and in no stack of GitHub's, as #560 was in the landing of v0.9.1.
    const result = stackMerge("merged", {
      ANA_FAKE_PULLS: stack(upper, pull(15, "c", "b", stacked)),
      ANA_FAKE_STACK: "7 11,12",
      ANA_FAKE_STACK_SHA: upper,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("land: #15 is based on main.");
    expect(logLines(ghLog).filter((line) => line.startsWith("pr edit"))).toEqual(["pr edit 15 --base main"]);
  });

  it("cuts the release at the merge it made with --tag, with notes GitHub writes, and refuses a tag origin holds before gating", () => {
    const result = runLand(["12", "--merge", "--tag", "v9.9.9"], {
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
    const taken = runLand(["12", "--merge", "--tag", "v9.9.8"]);
    expect(taken.status).toBe(1);
    expect(taken.stderr).toContain("v9.9.8 is already a tag on origin.");
    expect(writes()).toEqual([]);

    // An origin that cannot be asked is no proof that the tag is free.
    git("remote", "set-url", "origin", join(fixture, "nowhere.git"));
    try {
      const unasked = runLand(["12", "--merge", "--tag", "v9.9.7"]);
      expect(unasked.status).toBe(1);
      expect(unasked.stderr).toContain("origin could not be asked whether it holds v9.9.7.");
      expect(writes()).toEqual([]);
    } finally {
      git("remote", "set-url", "origin", origin);
    }
  });

  it("takes the status back from every head when GitHub refuses or fails a stack's merge, and says nothing merged", () => {
    for (const [end, why] of [
      ["failed", "its merge ended failed: failed"],
      ["refused", "gh: Stack is not mergeable (HTTP 422)"],
    ] as const) {
      writeFileSync(ghLog, "");
      const result = stackMerge(end);
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

  it("takes the status back from every head when GitHub's merge cannot be read as landed", () => {
    const result = stackMerge("enqueued");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("land: GitHub's merge of stack 7 went into the merge queue");
    expect(statuses("ana/stack-gate")).toEqual([
      `success ${lowerDocs}`,
      `success ${upper}`,
      `pending ${lowerDocs}`,
      `pending ${upper}`,
    ]);
  });

  it("refuses a stack whose members are not the chain of bases, before any status is posted", () => {
    const result = runLand(["12", "--merge"], { ANA_FAKE_STACK: "7 13,12" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "land: GitHub's stack 7 holds #13, #12, and the chain of bases up to #12 holds #11, #12. A link never " +
        "reorders a stack: run gh stack unstack 7, then gh stack link 11 12, and land again. Nothing was merged.",
    );
    expect(statuses("ana/stack-gate")).toEqual([]);
  });

  it("dispatches ci.yml on the top's head before gating when it has no run, and waits for it", () => {
    const dispatched = join(fixture, "ci-dispatched");
    rmSync(dispatched, { force: true });
    const result = runLand(["12", "--merge"], { ANA_FAKE_CI_AFTER: dispatched });
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

  it("shows on the top's head that it waits for the ci.yml run it reuses, linked, until that run passes", () => {
    const result = runLand(["12", "--merge"], {
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

  it("refuses to merge when ci.yml failed on the top's head, brings its failed log home, and does not dispatch it again", () => {
    const result = runLand(["12", "--merge"], { ANA_FAKE_CI: "completed\tfailure\t9\thttps://ci/9" });
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

    // A log GitHub refuses to give is said to be missing, never saved as an empty log.
    expect(
      runLand(["12", "--merge"], {
        ANA_FAKE_CI: "completed\tfailure\t9\thttps://ci/9",
        ANA_FAKE_LOG_DOWN: "1",
      }).status,
    ).toBe(1);
    expect(readFileSync(log, "utf8")).toContain(
      "gh could not fetch the failed jobs' log: gh: Bad Gateway (HTTP 502)",
    );
  });
  it("refuses to restore green when a parent moves off its child while the child is being proved, and leaves nothing pending", () => {
    const next = join(fixture, "moved-pulls");
    rmSync(`${next}.read`, { force: true });
    writeFileSync(next, JSON.stringify([pull(11, "a", "main", beside), pull(12, "b", "a", upper)]));
    const result = runLand(["12", "--sanitize"], { ANA_FAKE_PULLS_NEXT: next });
    expect(statuses("mergeable")).toEqual([
      `pending ${lowerDocs}`,
      `pending ${upper}`,
      `success ${lowerDocs}`,
      `error ${upper}`,
    ]);
    expect(leftPending(COMMIT)).toEqual([]);
    expect(result.status).toBe(1);
    // The landing starts again on the moved heads, and the replay finds no head of #11 that #12 holds.
    expect(result.stderr).toContain(
      "#12 holds none of the heads GitHub records for the pull request beneath it",
    );
  });

  it("lands again on the heads as they stand when a head moves while it is proved", () => {
    const next = join(fixture, "moved-pulls");
    rmSync(`${next}.read`, { force: true });
    writeFileSync(next, JSON.stringify([pull(11, "a", "main", lowerMore), pull(12, "b", "a", upper)]));
    const result = runLand(["12", "--sanitize"], { ANA_FAKE_PULLS_NEXT: next });
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

  it("stops the whole gate under way once its head moves, and lands the moved heads", () => {
    const later = join(fixture, "later-pulls");
    rmSync(`${later}.read`, { force: true });
    writeFileSync(later, JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "b", "a", stacked)]));
    const result = runLand(["12", "--sanitize"], {
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
    // `upper`'s whole gate is stopped, then it is proved again beneath the new top's whole gate.
    const proved = gatesRun(gateLog).map((gate) => gate.split(" ")[0]);
    expect(proved.slice(-3)).toEqual([upper, upper, stacked]);
    expect(leftPending(COMMIT)).toEqual([]);
  });

  it("follows its stack once a landing ends, lands again when a head moves, and ends when the pull request closes", async () => {
    const later = join(fixture, "followed-pulls");
    rmSync(`${later}.read`, { force: true });
    writeFileSync(later, JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "b", "a", stacked)]));
    const child = Bun.spawn([capturedExecPath, land, "12"], {
      cwd: work,
      env: landEnv({ ANA_FAKE_PULLS_LATER: later, ANA_LAND_WATCH_MS: "100" }),
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let out = "";
    const readUntil = async (follows: number): Promise<void> => {
      while (out.split("land: following:").length <= follows) {
        const { value, done } = await reader.read();
        if (done) return;
        out += decoder.decode(value);
      }
    };
    await readUntil(1);
    writeFileSync(`${later}.read`, "");
    await readUntil(2);
    writeFileSync(later, JSON.stringify([pull(11, "a", "main", lowerDocs)]));
    expect(await child.exited).toBe(0);
    await readUntil(Infinity);
    expect(out).toContain("#12 is no longer open; following ends.");
    // The second landing proves only the moved head; `upper`'s pass is remembered.
    const gates = gatesRun(gateLog);
    expect(gates.filter((gate) => gate.startsWith(upper))).toHaveLength(1);
    expect(gates.at(-1)).toBe(`${stacked} suite`);
  }, 60_000);

  it("reads the chain again before each proof starts, so a head moved on proves its new commits and not the old head", () => {
    const next = join(fixture, "moved-pulls");
    rmSync(`${next}.read`, { force: true });
    writeFileSync(next, JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "b", "a", stacked)]));
    const result = runLand(["12", "--sanitize"], { ANA_FAKE_PULLS_NEXT: next });
    expect(result.status).toBe(0);
    const gates = gatesRun(gateLog);
    expect(gates).not.toContain(`${upper} suite`);
    expect(gates.filter((gate) => gate.startsWith(upper))).toHaveLength(1);
    expect(gates.at(-1)).toBe(`${stacked} suite`);
    expect(statuses("mergeable").findLast((row) => row.endsWith(stacked))).toBe(`success ${stacked}`);
    // The old head was left pending when the chain moved on, and the landing settles it as it ends.
    expect(statuses("mergeable").at(-1)).toBe(`error ${upper}`);
    expect(leftPending("mergeable")).toEqual([]);
  });

  it("reruns a failed ci.yml run's jobs where no runner took them, and merges once they pass", () => {
    const result = runLand(["12", "--merge"], {
      ANA_FAKE_CI_STATES: ciStates(
        "completed\tfailure\t9\thttps://ci/9",
        "in_progress\t\t9\thttps://ci/9",
        "completed\tsuccess\t9\thttps://ci/9",
      ),
      ANA_FAKE_UNTAKEN: "no runner took darwin, darwin-ui",
      ANA_CI_POLL_MS: "1",
    });
    expect(result.stdout).toContain(
      `ci.yml run 9 failed on #12's head ${short(upper)} where no runner took darwin, darwin-ui; its failed jobs run again`,
    );
    expect(logLines(ghLog)).toContain("run rerun 9 --failed");
    expect(statuses("ci.yml").at(-1)).toBe(`success ${upper}`);
  });

  describe("after a full run failed in its tests on an earlier head of the top's branch", () => {
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
        // Bun's closing list repeats the failure after the last file's header, and names no file.
        `linux\t${step}\t2026-11-07T10:00:00.5Z test/far.test.ts:`,
        `linux\t${step}\t2026-11-07T10:00:00.6Z 1 tests failed:`,
        `linux\t${step}\t2026-11-07T10:00:00.7Z (fail) the owner > holds one [1.00ms]`,
      ].join("\n"),
    );
    const fixesLand = (env: Record<string, string>) =>
      runLand(["12", "--merge"], {
        ANA_FAKE_PULLS: fixPulls,
        ANA_FAKE_CI_STATES: ciStates(
          "none",
          "completed\tsuccess\t3\thttps://ci/3\t2026-11-07T11:00:00Z\tci-fixes",
        ),
        ANA_FAKE_FAILED_LOG: failedLog,
        ANA_FAKE_CI_BRANCH: `${broken}\tfailure\t9`,
        ANA_FAKE_STACK_SHA: fixed,
        ...env,
      });
    const dispatches = (): string[] => logLines(ghLog).filter((line) => line.startsWith("workflow run"));

    it("dispatches ci-fixes with the files that failed and the tests one import from the fix, and merges once it passes", () => {
      const result = fixesLand({});
      expect(result.status).toBe(0);
      expect(dispatches()).toEqual([
        "workflow run ci.yml --ref fix -f tests=test/a.test.ts test/far.test.ts test/owner.test.ts -f ui_tests=",
      ]);
      expect(result.stdout).toContain(`dispatched ci-fixes, 3 test files since run 9 on ${short(broken)},`);
      expect(described("ci.yml").at(-1)).toBe(`${fixed} ci.yml's ci-fixes run 3 passed on this head`);
    });

    it("dispatches the full run where the failed run failed beyond its tests", () => {
      const result = fixesLand({ ANA_FAKE_CI_STEPS: `${step}, The climb simulation` });
      expect(dispatches()).toEqual(["workflow run ci.yml --ref fix"]);
      expect(result.stdout).toContain(
        `ci.yml runs in full: run 9 on ${short(broken)} failed beyond its tests (The climb simulation).`,
      );
    });

    it("dispatches the full run where the wall imports what the fix changed, since only both platforms' suites prove it", () => {
      const result = fixesLand({
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

    it("dispatches the full run where the failed run's test step was cut short", () => {
      const result = fixesLand({ ANA_FAKE_CI_STEPS: `${step} cancelled` });
      expect(dispatches()).toEqual(["workflow run ci.yml --ref fix"]);
      expect(result.stdout).toContain(`failed beyond its tests (${step} cancelled)`);
    });

    it("dispatches the full run where what runs the suite changed since", () => {
      const result = fixesLand({ ANA_FAKE_CI_BRANCH: `${upper}\tfailure\t9` });
      expect(dispatches()).toEqual(["workflow run ci.yml --ref fix"]);
      expect(result.stdout).toContain("ci.yml runs in full: .github/workflows/ci.yml changed since run 9.");
    });
  });

  it("refuses before gating when no run exists and ci.yml takes no dispatch", () => {
    const result = runLand(["15", "--merge"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(15, "nodispatch", "main", noDispatch)]),
      ANA_FAKE_STACK: "",
      ANA_FAKE_CI_STATES: ciStates("none"),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `no ci.yml run exists on #15's head ${short(noDispatch)}, and ci.yml there takes no workflow_dispatch to start one.`,
    );
    expect(logLines(ghLog).some((line) => line.startsWith("workflow run"))).toBe(false);
    expect(gatesRun(gateLog)).toEqual([]);
  });

  it("refuses before gating when GitHub does not list ci.yml's runs, and dispatches none", () => {
    // A run follows, so code that read the failed list as "none" dispatches, passes and fails here.
    const result = runLand(["12", "--merge"], {
      ANA_FAKE_CI_STATES: ciStates("down", "completed\tsuccess\t19\thttps://ci/19"),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `GitHub did not list ci.yml's runs on #12's head ${short(upper)}. Land again.`,
    );
    expect(logLines(ghLog).some((line) => line.startsWith("workflow run"))).toBe(false);
    expect(gatesRun(gateLog)).toEqual([]);
  });
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
    expect(read.stdout.trim()).toBe("7 12,13");
  });
});
