/**
 * Local CI gate (`bun run gate [-- --static]`) and multi-commit prover (`proveCommits`, used by
 * `bun run land` and `.githooks/pre-push`).
 *
 * Runs `ci.yml`'s Darwin steps (`install`, `format:check`, `secrets`, `ui:deps`, then in parallel
 * `ui:gate`, `typecheck`, `lint --strict`, `source-policy.ts`, `simplify --gate`, and `test`).
 * Under `--static`, replaces the full test suite with tests within one import hop of changed root
 * files (`NEAR.root = 1`) and non-browser UI tests within three hops (`NEAR.ui = 3`). Passes are
 * cached in `ana-gate-passed` under the common Git directory by tree hash, parent tree hash (for
 * static passes), checker digest, and pinned Bun version (`ANA_GATE_FRESH=1` bypasses the cache).
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
} from "../../src/meta/filesystem.ts";
import { sha256 } from "../../src/meta/digest.ts";
import { keysIf } from "../../src/meta/optional-key.ts";
import { availableParallelism, tmpdir } from "../../src/meta/os.ts";
import { basename, dirname, isAbsolute, join, relative } from "../../src/meta/path.ts";
import { parseArgs, type ParseArgsOptionsConfig, runtimeProcess } from "../../src/meta/process.ts";
import { killProcessGroup, runSync, runTextSyncOrThrow, zeroExitText } from "../../src/meta/subprocess.ts";
import type { StatusState } from "./pulls.ts";

type Pass = "static" | "whole";

/** One commit and the pass it needs; null for a commit that changes documentation alone, which the
 *  static steps have nothing to read in. */
export interface Proof {
  readonly commit: string;
  readonly pass: Pass | null;
}

/** The lowest commit that failed, the step it failed and the log that holds the output; `verdict`
 *  false where the step's runner dropped twice and so said nothing about the commit. */
interface Failure {
  readonly commit: string;
  readonly step: string;
  readonly log: string;
  readonly verdict: boolean;
}

/** Where passes run, and how many at once there: `remote` is the `ANA_CHECK_HOST` each carries to the
 *  check runner, a host's name, and undefined leaves the caller's own as it stands. */
export interface Place {
  readonly remote?: string;
  readonly slots: number;
}

/** A proof in the queue, with its place in the landing's line. */
interface Queued extends Proof {
  readonly index: number;
}

interface Prover {
  /** `land` or `pre-push`: what each line and each log is named after. */
  readonly who: string;
  /** At least one; a place whose pass gave no verdict takes no more while another remains. */
  readonly places: readonly Place[];
  readonly say: (line: string) => void;
  /** Told every verdict, recorded earlier or new, so land can post it as a status, and `pending` when
   *  a commit's proof starts, so a red left by an earlier landing clears once it is proved again. */
  readonly mark: (commit: string, state: StatusState, description: string) => void;
  /** Ends every proof under way, each pass's whole process group, and starts none: land's, when a
   *  head moved under a commit being proved or the landing was interrupted. A stopped pass is no
   *  verdict and is recorded nowhere. */
  readonly stop?: AbortSignal;
}

/** The documentation set. A commit changing nothing beyond it gets no static steps, and a push of
 *  such commits alone gets `git diff --check` and nothing more. No test reads these files. */
export const DOCUMENTATION = [
  ":(exclude)AGENTS.md",
  ":(exclude)README.md",
  ":(exclude)docs/**",
  ":(exclude).claude/**/*.md",
];
/** UI package path and setup files (`UI_ROOT`, `UI_SETUP`); `uiStep` runs the full `ui:gate` when `packages/ui` or `UI_SETUP` changes, or builds the UI and runs non-browser UI tests within `NEAR.ui` import hops when root files imported by the UI change. */
const UI_PACKAGE = "packages/ui/package.json";
export const UI_ROOT = "packages/ui";
/** The test runner every pass goes through, so a change to it proves nothing narrower than the whole run. */
export const TEST_SUITE = "tools/runtime/test-suite.ts";
export const UI_SETUP = ["package.json", "bun.lock", TEST_SUITE];
const UI_TEST = /^packages\/ui\/test\/[^/]+\.test\.tsx?$/u;
const BROWSER_FILE = /^packages\/ui\/test\/browser-[^/]+\.test\.ts$/u;
/** What each file imports, read once per CI gate (`importsOf`). */
const IMPORTS = new Map<string, string[]>();
const TRANSPILERS = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };
/** Maximum import distance for nearby tests, as defined in the head comment. */
const NEAR = { root: 1, ui: 3 } as const;
const FIRST = [
  ["install", ["install", "--frozen-lockfile"]],
  ["format", ["run", "format:check"]],
  ["secrets", ["run", "secrets"]],
] as const;
const BESIDE = [
  ["typecheck", ["run", "typecheck"]],
  ["lint", ["run", "lint", "--", "--strict"]],
  // The size rules are off in the lint because this script owns them (`rules-off.tsv`), so a step
  // has to run it, or a file past the ceiling stands unseen.
  ["source-policy", ["tools/loc/source-policy.ts"]],
  ["simplify", ["run", "simplify", "--", "--gate"]],
] as const;
export const TEST_FILE = /^test\/[^/]+\.test\.ts$/u;
const GATE = join(import.meta.dir, "gate.ts");
const PROVED = {
  static: "its static steps and nearby tests passed on its own checkout",
  whole: "passed the whole gate on its own checkout",
} as const satisfies Record<Pass, string>;
const WHAT = {
  static: "the static steps and its nearby tests",
  whole: "the whole gate",
} as const satisfies Record<Pass, string>;
const FAILED = { failure: "failed on its own checkout", error: "its runner gave no verdict" } as const;
const FLAGS = { static: ["--static"], whole: [] } as const satisfies Record<Pass, readonly string[]>;
/** The test wrapper's line that sends the files the idle wall left unfinished to a second run,
 *  which then decides, in the words a pulse repeats. */
const RERUN = /idle-wall: retrying (.*) one at a time /u;
const RESULT = /^\((?:pass|fail|skip|todo)\) /u;
/** The most of one failed test's output a failed pass prints; the log holds the rest. */
const TEST_REPORT_LINES = 200;
/** A pass keeps its output in a log and prints nothing for minutes, which reads like a hung push. */
const PULSE_MS = (Number(runtimeProcess.env.ANA_GATE_PULSE_SECONDS) || 60) * 1000;
const LOG_DAYS = 14;
/** The check runner's exits that say nothing about the commit (`tools/runtime/router/run.ts`): 255
 *  where ssh dropped or the task left no status, 75 where no slot came free in time, and 69 where the
 *  host does not answer or lacks the disk. Counting 255 alone would fail a commit whose queue timed
 *  out, and the landing would print a fix for a commit nothing had read. */
const NO_VERDICT = new Set([255, 75, 69]);

/** What an exit of a step, or of the gate over a commit, says about the commit. */
const verdictOf = (code: number): "passed" | "failed" | "none" =>
  code === 0 ? "passed" : NO_VERDICT.has(code) ? "none" : "failed";

export const lines = (text: string): string[] => text.split("\n").filter((line) => line.length > 0);
export const short = (sha: string): string => sha.slice(0, 9);

/** What `parseArgs` reads of `argv`, positionals allowed, or null once it has said which word the
 *  command does not take and its `usage`: a misuse, exit 2 at the caller, never a failed landing's 1. */
export function argsOr<const T extends ParseArgsOptionsConfig>(
  argv: readonly string[],
  usage: string,
  options: T,
) {
  try {
    return parseArgs({ args: [...argv], options, allowPositionals: true });
  } catch (error) {
    const misuse =
      error instanceof Error && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS");
    if (!misuse) throw error;
    console.error(`${error.message}\n${usage}`);
    return null;
  }
}

/** Git's output in `root`, trimmed. A failure throws with Git's own message. */
export const git = (root: string, args: readonly string[]): string =>
  runTextSyncOrThrow(["git", ...args], { cwd: root }).trim();

/** Whether a Git command in `root` exits 0: an ancestry test, or a diff that finds nothing. */
export const gitSays = (root: string, args: readonly string[]): boolean =>
  runSync(["git", ...args], { cwd: root }).exitCode === 0;

/** Whether `git diff <flags>` from a commit's first parent to the commit, over `paths`, exits 0. A
 *  root commit is read against the empty tree. */
export function diffFromParentSays(
  root: string,
  commit: string,
  flags: readonly string[],
  paths: readonly string[] = [],
) {
  return gitSays(root, ["diff", ...flags, parentOf(root, commit), commit, "--", ...paths]);
}

/** A commit's first parent, or for a root commit the empty tree (`git hash-object -t tree /dev/null`). */
export function parentOf(root: string, commit: string): string {
  const parent = runSync(["git", "rev-parse", "-q", "--verify", `${commit}^1`], { cwd: root });
  return zeroExitText(parent) ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
}

/** The record's key for a pass, by content: the commit's tree, which holds the lockfile, and for a
 *  static pass its first parent's tree too, since the diff between them chooses its tests; with
 *  the checker and the Bun the CI gate ran under. That Bun is the one the commit's `package.json`
 *  pins, since the `bun` router runs a pass under the pin of the tree it runs in, never the
 *  landing's own; so a landing from a checkout pinning another Bun keeps the passes below it. It is
 *  read from `"packageManager": "bun@X"` as the router reads it, or is the running Bun where the
 *  commit pins none. */
function contentKey(root: string, commit: string, pass: Pass, checker: string): string {
  const tree = git(root, ["rev-parse", `${commit}^{tree}`]);
  const from = pass === "static" ? `${git(root, ["rev-parse", `${parentOf(root, commit)}^{tree}`])}..` : "";
  const manifest = zeroExitText(runSync(["git", "show", `${commit}:package.json`], { cwd: root })) ?? "";
  const bun = /"packageManager"\s*:\s*"bun@([^"+]+)/u.exec(manifest)?.[1] ?? Bun.version;
  return `tree ${from}${tree} ${pass} checker-${checker} bun-${bun}`;
}

export const changesSource = (root: string, commit: string): boolean =>
  !diffFromParentSays(root, commit, ["--quiet"], [".", ...DOCUMENTATION]);

/**
 * The commits a push or a landing adds, oldest first: those along each head's first parents that
 * nothing in `known` reaches. A commit reached only through a merge's other parent belongs to a line
 * made elsewhere, and is only counted: a merge of another line's history can add hundreds of
 * commits new to the remote, and gating each would run the CI gate over commits none of which
 * carried it. The merge is the
 * pusher's, and its proof reads the combined tree.
 */
export function addedLine(
  root: string,
  heads: readonly string[],
  known: readonly string[],
  say: (line: string) => void,
): string[] {
  const range = [...heads, "--not", ...known];
  const line = lines(git(root, ["rev-list", "--first-parent", "--reverse", "--topo-order", ...range]));
  const aside = Number(git(root, ["rev-list", "--count", ...range])) - line.length;
  if (aside > 0) {
    say(
      `commits that came in through a merge's other parent, from a line made elsewhere: ${String(aside)}. The merge is gated; they are not.`,
    );
  }
  return line;
}

/** The transpiler that reads `file`, none for a file that is not a script. */
const transpilerOf = (file: string): Bun.Transpiler | undefined =>
  /\.[cm]?[jt]sx$/u.test(file) ? TRANSPILERS.tsx : /\.[cm]?[jt]s$/u.test(file) ? TRANSPILERS.ts : undefined;

/** Resolve file's repository imports relative to root using Bun's resolver. Exclude packages and
 *  runtime modules such as node:fs and bun:test. Files without a supported transpiler have no imports. */
export function importsOf(root: string, file: string): string[] {
  const known = IMPORTS.get(join(root, file));
  if (known !== undefined) return known;
  let found: { path: string }[];
  try {
    found = transpilerOf(file)?.scanImports(readFileSync(join(root, file), "utf8")) ?? [];
  } catch {
    found = [];
  }
  const inside = found.flatMap(({ path: specifier }) => {
    try {
      const resolved = Bun.resolveSync(specifier, dirname(join(root, file)));
      const path = relative(root, resolved);
      return !isAbsolute(resolved) || path.startsWith("..") || path.includes("node_modules/") ? [] : [path];
    } catch {
      return [];
    }
  });
  IMPORTS.set(join(root, file), inside);
  return inside;
}

/** The files `start` reaches within `depth` imports, itself among them. */
function within(root: string, start: string, depth: number): Set<string> {
  const reached = new Set([start]);
  let layer = [start];
  for (let hop = 0; hop < depth && layer.length > 0; hop += 1) {
    layer = layer.flatMap((file) => importsOf(root, file)).filter((file) => !reached.has(file));
    for (const file of layer) reached.add(file);
  }
  return reached;
}

/** The files the working tree changed since `base`, beyond the documentation set: a commit's own
 *  in a pass's checkout, and its uncommitted and untracked ones too where the CI gate is run by hand.
 *  A script whose transpiled form is the same on both sides changed its comments or layout alone,
 *  so it chooses no test, as documentation chooses none; the whole pass at the top still runs every
 *  test. A commit rewriting the comments of 94 test files otherwise chose all 1,573, and its static
 *  pass failed five landings under the load. */
export const changedSince = (root: string, base: string): Set<string> =>
  new Set([
    ...lines(git(root, ["diff", "--name-only", base, "--", ".", ...DOCUMENTATION])).filter((file) => {
      const code = (text: string | null): string | null => {
        try {
          return text === null ? null : (transpilerOf(file)?.transformSync(text) ?? null);
        } catch {
          return null;
        }
      };
      const after = code(existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null);
      return (
        after === null ||
        after !== code(zeroExitText(runSync(["git", "show", `${base}:${file}`], { cwd: root })))
      );
    }),
    ...lines(git(root, ["ls-files", "--others", "--exclude-standard", "--", ".", ...DOCUMENTATION])),
  ]);

/** The files under `path` that `pattern` matches, tracked or new, in `root`. */
const listed = (root: string, path: string, pattern: RegExp): string[] =>
  lines(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", path])).filter((file) =>
    pattern.test(file),
  );

/** A file of `changed` the wall reaches by any number of imports, where one is: the wall's tests
 *  are the one proof of each platform's wall, so a change there proves nothing short of both. */
export const reachingWall = (root: string, changed: ReadonlySet<string>): string | undefined => {
  const reached = new Set(
    listed(root, "src/wall", /\.ts$/u).flatMap((file) => [...within(root, file, Infinity)]),
  );
  return [...changed].find((file) => reached.has(file));
};

/** The root's test files near `changed` in `root`, at `NEAR.root`: the one choice of the static
 *  pass, `preflight` and `ci-fixes`. */
export const testsNear = (root: string, changed: ReadonlySet<string>): string[] =>
  nearbyTests(root, changed, listed(root, "test", TEST_FILE), NEAR.root);

/** The UI's test files near `changed` in `root`, at `NEAR.ui`, its browser files under `all` only. */
export const uiTestsNear = (root: string, changed: ReadonlySet<string>, files: "all" | "no-browser") =>
  nearbyTests(
    root,
    changed,
    listed(root, UI_ROOT, UI_TEST).filter((file) => files === "all" || !BROWSER_FILE.test(file)),
    NEAR.ui,
  );

/** The test files among `tests` near `changed`, by the rule in the head comment, at `depth` imports. */
function nearbyTests(
  root: string,
  changed: ReadonlySet<string>,
  tests: readonly string[],
  depth: number,
): string[] {
  const reaches = new Map(tests.map((test) => [test, within(root, test, depth)] as const));
  const near = new Set(
    tests.filter((test) => [...(reaches.get(test) ?? [])].some((file) => changed.has(file))),
  );
  const reached = new Set([...reaches.values()].flatMap((files) => [...files]));
  for (const file of changed) {
    if (reached.has(file) || TEST_FILE.test(file) || UI_TEST.test(file)) continue;
    for (const test of tests) {
      const text = readFileSync(join(root, test), "utf8");
      if (text.includes(file) || text.includes(basename(file))) near.add(test);
    }
  }
  return [...near].toSorted();
}

/** The UI's step of a pass, by the rule in `UI_PACKAGE`'s comment, over what `changed` since `base`;
 *  its exit code. */
async function uiStep(root: string, pass: Pass, base: string | null, changed: ReadonlySet<string> | null) {
  if (
    changed === null ||
    [...changed].some((file) =>
      [UI_ROOT, ...UI_SETUP].some((path) => file === path || file.startsWith(`${path}/`)),
    )
  ) {
    return step(root, "ui", ["run", "ui:gate"], "pipe");
  }
  const files = lines(git(root, ["ls-files", UI_ROOT])).filter((file) => /\.tsx?$/u.test(file));
  const read = new Set(files.flatMap((file) => [...within(root, file, Infinity)]));
  if (![...changed].some((file) => read.has(file))) {
    console.log(`gate: step ui skipped: nothing it reads changed since ${short(base ?? "")}`);
    return 0;
  }
  const tests = uiTestsNear(root, changed, pass === "whole" ? "all" : "no-browser");
  for (const args of [["run", "ui:build"], ...(tests.length > 0 ? [["run", "test", "--", ...tests]] : [])]) {
    const code = await step(root, "ui", args, "pipe");
    if (code !== 0) return code;
  }
  return 0;
}

/** One step, its output where the caller's goes, whole once it ends where it is piped; its exit code.
 *  A step routed to a runner exits `NO_VERDICT` where the connection dropped, which says nothing
 *  about the commit, so it runs once more rather than failing a landing on a dropped connection. */
async function step(root: string, name: string, args: readonly string[], io: "pipe" | "inherit" = "inherit") {
  const run = async (): Promise<number> => {
    const child = Bun.spawn(["bun", ...args], { cwd: root, stdout: io, stderr: io });
    if (io === "inherit") return child.exited;
    const [said, warned] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    runtimeProcess.stdout.write(said);
    runtimeProcess.stderr.write(warned);
    return child.exited;
  };
  let code = await run();
  if (verdictOf(code) === "none") code = await run();
  const verdict = verdictOf(code);
  if (verdict !== "passed") {
    console.error(
      `gate: step ${name} ${verdict === "none" ? "gave no verdict" : "failed"} (exit ${String(code)})`,
    );
  }
  return code;
}

async function gate(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { static: { type: "boolean", default: false } },
  });
  const pass: Pass = values.static ? "static" : "whole";
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]);
  for (const [name, args] of FIRST) {
    const code = await step(root, name, args);
    if (code !== 0) return code;
  }
  // One reading of what changed serves the nearby tests and the UI's step.
  const base =
    pass === "static"
      ? parentOf(root, "HEAD")
      : zeroExitText(runSync(["git", "merge-base", "HEAD", "origin/main"], { cwd: root }));
  const changed = base === null ? null : changedSince(root, base);
  const near = pass === "whole" || changed === null ? [] : testsNear(root, changed);
  if (pass === "static" && near.length === 0) console.log("gate: no test file is near what HEAD changed.");
  // The strict lint reads whether the UI's dependencies are there as it starts, so they are
  // installed before the steps that run side by side.
  const ui = existsSync(join(root, UI_PACKAGE));
  const installed = ui ? await step(root, "ui-deps", ["run", "ui:deps"]) : 0;
  if (installed !== 0) return installed;
  const codes = await Promise.all([
    ui ? uiStep(root, pass, base, changed) : 0,
    ...BESIDE.map(([name, args]) => step(root, name, args, "pipe")),
    pass === "whole" || near.length > 0
      ? step(root, "test", ["run", "test", ...(near.length > 0 ? ["--", ...near] : [])])
      : 0,
  ]);
  // A failure says more than a dropped runner, which says nothing about the commit.
  return codes.find((code) => verdictOf(code) === "failed") ?? codes.find((code) => code !== 0) ?? 0;
}

/** What a pass's log says so far, for the pulse: tests passed and failed, and a rerun under way. */
function pulse(log: string, started: number): string {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {
    // The child has not written its first line yet.
  }
  const rerun = RERUN.exec(text)?.[1];
  const minutes = Math.floor((Date.now() - started) / 60_000);
  const passed = text.match(/\(pass\)/gu)?.length ?? 0;
  // Bun prints each failure again in its closing summary, word for word, duration included.
  const failed = new Set(text.match(/\(fail\) .*/gu)).size;
  const rerunning =
    rerun === undefined
      ? ""
      : `; the idle wall ended the suite, so its ${rerun} are running again one at a time and that run decides`;
  return `still running after ${String(minutes)} min: ${String(passed)} tests passed, ${String(failed)} failed so far${rerunning}.`;
}

/** Each failed test once, with what it printed and its assertion, so that whoever fixes it reads
 *  them at the failure line. The log's last lines alone can miss them: an assertion can stand
 *  thousands of lines above the end of a bailed run, which the other workers' files filled. */
function failedTests(output: readonly string[]): string[] {
  const seen = new Set<string>();
  const report: string[] = [];
  let start = 0;
  for (const [index, line] of output.entries()) {
    if (!RESULT.test(line)) continue;
    if (line.startsWith("(fail) ") && !seen.has(line)) {
      seen.add(line);
      report.push(...output.slice(Math.max(start, index - TEST_REPORT_LINES), index + 1));
    }
    start = index + 1;
  }
  return report;
}

/** One line for a failure, the same for every caller. */
export const failedLine = (failure: Failure): string =>
  failure.verdict
    ? `${short(failure.commit)} FAILS ${failure.step} ON ITS OWN`
    : `${short(failure.commit)} GAVE NO VERDICT ON ${failure.step}: its runner said nothing of it twice`;

/**
 * The checker that runs every pass, as one digest: this CI gate and the files its imports reach, read
 * from the caller's checkout as it stands, since `GATE` runs from there over each target. Its
 * steps run `bun run …` in the target's checkout (`step`), so the lint plugins and configs, the
 * test wrapper, `package.json` and `bun.lock` they use are the target's, which its tree keys. The
 * digest reads the gate as Bun bundles it, so only code the gate runs keys it: a comment, a type or
 * an export it never calls in a `src/meta` file it imports leaves every remembered pass standing,
 * where hashing those files whole proved the whole stack again after each such pull request.
 */
async function checkerDigest(): Promise<string> {
  const built = await Bun.build({ entrypoints: [GATE], target: "bun", minify: { whitespace: true } });
  const [bundle] = built.outputs;
  if (!built.success || bundle === undefined) throw new Error(`could not bundle ${GATE}`);
  return sha256(await bundle.text()).slice(0, 16);
}

/**
 * The places of one proof, each with the passes it runs now. A static pass takes the place with the
 * most room, the first listed among equals; the whole pass takes the first place once nothing runs
 * anywhere, so no host runs two suites of one landing. A place leaves only while another remains.
 */
function seating(places: readonly Place[]) {
  const busy = new Map(places.map((place) => [place, 0]));
  const room = ([place, running]: readonly [Place, number]): number => place.slots - running;
  return {
    /** The place `pass` now holds, or undefined until one has room for it. */
    take(pass: Pass, running: number): Place | undefined {
      const entries = [...busy];
      const open =
        pass === "whole"
          ? entries.slice(0, running === 0 ? 1 : 0)
          : entries.filter((entry) => room(entry) > 0).toSorted((one, other) => room(other) - room(one));
      const place = open[0]?.[0];
      if (place !== undefined) busy.set(place, (busy.get(place) ?? 0) + 1);
      return place;
    },
    free(place: Place): void {
      const running = busy.get(place);
      if (running !== undefined) busy.set(place, running - 1);
    },
    /** Sets `place` aside where another place remains, and says whether it did. */
    leave(place: Place): boolean {
      if (![...busy.keys()].some((other) => other !== place)) return false;
      busy.delete(place);
      return true;
    },
  };
}

/** The clone's record of passes and what it remembers, unless `ANA_GATE_FRESH=1`, and the folder of
 *  the passes' logs, cleared of those older than `LOG_DAYS`. */
async function remembered(root: string) {
  const [common = "", logs = ""] = lines(
    git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-path", "ana-gate"]),
  );
  const record = join(common, "ana-gate-passed");
  mkdirSync(logs, { recursive: true });
  runSync(["find", logs, "-name", "*.log", "-mtime", `+${String(LOG_DAYS)}`, "-delete"]);
  const fresh = runtimeProcess.env.ANA_GATE_FRESH === "1";
  const text = fresh
    ? ""
    : await Bun.file(record)
        .text()
        .catch(() => "");
  return { record, logs, passed: new Set(lines(text)) };
}

/** A pass that failed or gave no verdict, named by the step its log says did so, and printed. */
function reported(who: string, commit: string, log: string, verdict: boolean): Failure {
  const output = lines(readFileSync(log, "utf8"));
  const said = output.map((line) => /^gate: step (\S+) (failed|gave no verdict)/u.exec(line));
  const failedStep = said.findLast((line) => line !== null && (line[2] === "failed") === verdict)?.[1];
  const failure = { commit, step: failedStep ?? "the gate", log, verdict };
  console.error([...failedTests(output), ...output.slice(-30)].join("\n"));
  console.error(`${who}: ${failedLine(failure)}. Log: ${log}`);
  return failure;
}

/**
 * Runs each commit's pass over a checkout of it, as many at once as `places` has slots, and returns
 * the lowest failure. The whole CI gate waits until every commit beneath it has passed. Nothing new
 * starts after a failure, since every commit above a fix changes id with it. A pass whose runner gave
 * no verdict is proved again at another place, and its own takes no more, while one remains: a host
 * that drops or has no slot in time costs its share alone. Passes side by side on this machine share
 * its cores: each suite left to itself takes two fewer workers than the host has, so three at once
 * load a host several times over, and their browser files time out by the dozen. So a static pass
 * at the caller's own place gets its share of the cores, unless the caller's
 * environment names `ANA_TEST_WORKERS`; a host the runner reaches chooses its own (`task.sh`).
 */
export async function proveCommits(
  root: string,
  proofs: readonly Proof[],
  prover: Prover,
): Promise<Failure | null> {
  const { who, say, mark, stop } = prover;
  const { record, logs, passed } = await remembered(root);
  const checker = await checkerDigest();
  const free: string[] = [];
  const made: string[] = [];
  const failures: (Failure & { index: number })[] = [];
  const seats = seating(prover.places);
  const queue: Queued[] = proofs.map((proof, index) => ({ ...proof, index }));
  const run = async (at: string, proof: Queued, pass: Pass, place: Place): Promise<void> => {
    const { index, commit } = proof;
    const { remote, slots } = place;
    const share = String(Math.max(2, Math.floor((availableParallelism() - 2) / slots)));
    let tree = free.pop();
    if (tree === undefined) {
      tree = mkdtempSync(join(tmpdir(), "ana-gate-"));
      made.push(tree);
      git(root, ["worktree", "add", "-q", "--detach", tree, commit]);
    }
    // A step may leave a file behind, and the suite rewrites its timings; neither is the next commit's.
    git(tree, ["checkout", "-q", "-f", "--detach", commit]);
    git(tree, ["clean", "-fdq"]);
    const log = join(logs, `${who}-${short(commit)}-${pass}.log`);
    say(`${at}: ${WHAT[pass]}${remote === undefined ? "" : ` on ${remote}`}. Log: ${log}`);
    mark(commit, "pending", WHAT[pass]);
    const fd = openSync(log, "w");
    const started = Date.now();
    const pulsing = setInterval(() => say(`${short(commit)} ${pulse(log, started)}`), PULSE_MS);
    const child = Bun.spawn(["bun", GATE, ...FLAGS[pass]], {
      cwd: tree,
      env: {
        ...keysIf(pass === "static" && remote === undefined, () => ({ ANA_TEST_WORKERS: share })),
        ...runtimeProcess.env,
        ANA_TEST_BAIL: "1",
        ...keysIf(remote !== undefined, () => ({ ANA_CHECK_HOST: remote, ANA_RUNNER_SPARE_HELD: "1" })),
      },
      // Its own group, so a stop reaches the steps and the runner's ssh beneath it.
      detached: stop !== undefined,
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
    });
    const end = (): void => killProcessGroup(child, "SIGTERM");
    stop?.addEventListener("abort", end, { once: true });
    const code = await child.exited;
    stop?.removeEventListener("abort", end);
    clearInterval(pulsing);
    closeSync(fd);
    free.push(tree);
    seats.free(place);
    if (code !== 0 && stop?.aborted === true) {
      say(`${at}: stopped.`);
      return;
    }
    if (code === 0) {
      appendFileSync(record, `${contentKey(root, commit, pass, checker)}\n`);
      mark(commit, "success", PROVED[pass]);
      say(`${at}: passed.`);
      return;
    }
    // The gate's exit says whether the commit failed; its log only names the step that said so.
    const verdict = verdictOf(code) === "failed";
    if (!verdict && seats.leave(place)) {
      say(`${at}: ${place.remote ?? "its place"} gave no verdict, so takes no more; proving it elsewhere.`);
      const above = queue.findIndex((other) => other.index > index);
      queue.splice(above === -1 ? queue.length : above, 0, proof);
      return;
    }
    failures.push({ index, ...reported(who, commit, log, verdict) });
    const state = verdict ? "failure" : "error";
    mark(commit, state, FAILED[state]);
  };
  const running = new Set<Promise<boolean>>();
  try {
    // Until the queue, into which a pass given no verdict comes back, and the passes under way are empty.
    for (;;) {
      const next = queue[0];
      if (failures.length > 0 || stop?.aborted === true || (next === undefined && running.size === 0)) break;
      if (next === undefined) {
        await Promise.race(running);
        continue;
      }
      const { index, commit, pass } = next;
      const at = `${String(index + 1)} of ${String(proofs.length)}, ${short(commit)}`;
      const had = (kind: Pass): boolean => passed.has(contentKey(root, commit, kind, checker));
      const earlier = had("whole") ? "whole" : pass !== null && had(pass) ? pass : null;
      if (pass === null || earlier !== null) {
        queue.shift();
        say(`${at}: ${earlier === null ? "documentation only" : "passed earlier on these exact bytes"}.`);
        mark(commit, "success", earlier === null ? "documentation only" : PROVED[earlier]);
        continue;
      }
      const place = seats.take(pass, running.size);
      if (place === undefined) {
        await Promise.race(running);
        continue;
      }
      queue.shift();
      const task: Promise<boolean> = run(at, next, pass, place).then(() => running.delete(task));
      running.add(task);
    }
    await Promise.all(running);
  } finally {
    // A rejected mark (land's `Moved`) leaves other proofs running in their checkouts: each is let
    // finish, and its pass recorded for the retry, before any checkout is removed.
    await Promise.allSettled(running);
    for (const tree of made) runSync(["git", "worktree", "remove", "--force", tree], { cwd: root });
  }
  return failures.toSorted((a, b) => a.index - b.index)[0] ?? null;
}

if (import.meta.main) runtimeProcess.exit(await gate(Bun.argv.slice(2)));
