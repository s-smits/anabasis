/**
 * Local CI gate (`bun run gate [-- --static]`) and multi-commit prover (`proveCommits`, for `bun
 * run land` and `.githooks/pre-push`). It runs `ci.yml`'s Darwin steps; `--static` runs only tests
 * within `NEAR` import hops of the changed files. Passes are cached by tree, checker digest and
 * pinned Bun (`ANA_GATE_FRESH=1` bypasses the cache).
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
import { repoRoot } from "../../src/meta/git.ts";
import { keysIf } from "../../src/meta/optional-key.ts";
import { availableParallelism, tmpdir } from "../../src/meta/os.ts";
import { basename, dirname, isAbsolute, join, relative } from "../../src/meta/path.ts";
import { parseArgs, type ParseArgsOptionsConfig, runtimeProcess } from "../../src/meta/process.ts";
import { killProcessGroup, runSync, runTextSyncOrThrow, zeroExitText } from "../../src/meta/subprocess.ts";
import { NO_VERDICT, type Place, placeEnv, type Seat, spread } from "../runs/host-config.ts";
import type { StatusState } from "./pulls.ts";

type Pass = "static" | "whole";

export interface Proof {
  readonly commit: string;
  readonly pass: Pass | null;
}

interface Failure {
  readonly commit: string;
  readonly step: string;
  readonly log: string;
  readonly verdict: boolean;
}

interface Queued extends Proof {
  readonly index: number;
}

interface Prover {
  readonly who: string;
  readonly places: readonly Place[];
  readonly say: (line: string) => void;
  readonly mark: (commit: string, state: StatusState, description: string) => void;
  readonly stop?: AbortSignal;
}

export const DOCUMENTATION = [
  ":(exclude)AGENTS.md",
  ":(exclude)README.md",
  ":(exclude)docs/**",
  ":(exclude).claude/**/*.md",
];
const UI_PACKAGE = "packages/ui/package.json";
export const UI_ROOT = "packages/ui";
export const TEST_SUITE = "tools/runtime/test-suite.ts";
export const UI_SETUP = ["package.json", "bun.lock", TEST_SUITE];
const UI_TEST = /^packages\/ui\/test\/[^/]+\.test\.tsx?$/u;
const BROWSER_FILE = /^packages\/ui\/test\/browser-[^/]+\.test\.ts$/u;
const IMPORTS = new Map<string, string[]>();
const TRANSPILERS = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };
export const NEAR = { root: 1, ui: 3 } as const;
const FIRST = [
  ["install", ["install", "--frozen-lockfile"]],
  ["format", ["run", "format:check"]],
  ["secrets", ["run", "secrets"]],
] as const;
const BESIDE = [
  ["typecheck", ["run", "typecheck"]],
  ["lint", ["run", "lint", "--", "--strict"]],
  // The size rules are off in the lint because this script owns them, so a step has to run it.
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
const RERUN = /idle-wall: retrying (.*) one at a time /u;
const RESULT = /^\((?:pass|fail|skip|todo)\) /u;
const TEST_REPORT_LINES = 200;
/** A pass prints nothing for minutes, which reads like a hung push. */
const PULSE_MS = (Number(runtimeProcess.env.ANA_GATE_PULSE_SECONDS) || 60) * 1000;
const LOG_DAYS = 14;
const verdictOf = (code: number): "passed" | "failed" | "none" =>
  code === 0 ? "passed" : NO_VERDICT.has(code) ? "none" : "failed";

export const lines = (text: string): string[] => text.split("\n").filter((line) => line.length > 0);
export const short = (sha: string): string => sha.slice(0, 9);

/** Null once it has said which word the command does not take: a misuse (exit 2), not a failed land (1). */
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

export const git = (root: string, args: readonly string[]): string =>
  runTextSyncOrThrow(["git", ...args], { cwd: root }).trim();

export const gitSays = (root: string, args: readonly string[]): boolean =>
  runSync(["git", ...args], { cwd: root }).exitCode === 0;

export function diffFromParentSays(
  root: string,
  commit: string,
  flags: readonly string[],
  paths: readonly string[] = [],
) {
  return gitSays(root, ["diff", ...flags, parentOf(root, commit), commit, "--", ...paths]);
}

export function parentOf(root: string, commit: string): string {
  const parent = runSync(["git", "rev-parse", "-q", "--verify", `${commit}^1`], { cwd: root });
  return zeroExitText(parent) ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
}

/** A pass's key by content, with the Bun the commit's `package.json` pins: the `bun` router runs a pass
 *  under its own tree's pin, never the landing's, so a landing pinning another Bun keeps the passes below. */
function contentKey(root: string, commit: string, pass: Pass, checker: string): string {
  const tree = git(root, ["rev-parse", `${commit}^{tree}`]);
  const from = pass === "static" ? `${git(root, ["rev-parse", `${parentOf(root, commit)}^{tree}`])}..` : "";
  const manifest = zeroExitText(runSync(["git", "show", `${commit}:package.json`], { cwd: root })) ?? "";
  const bun = /"packageManager"\s*:\s*"bun@([^"+]+)/u.exec(manifest)?.[1] ?? Bun.version;
  return `tree ${from}${tree} ${pass} checker-${checker} bun-${bun}`;
}

export const changesSource = (root: string, commit: string): boolean =>
  !diffFromParentSays(root, commit, ["--quiet"], [".", ...DOCUMENTATION]);

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

const transpilerOf = (file: string): Bun.Transpiler | undefined =>
  /\.[cm]?[jt]sx$/u.test(file) ? TRANSPILERS.tsx : /\.[cm]?[jt]s$/u.test(file) ? TRANSPILERS.ts : undefined;

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

export function within(root: string, start: string, depth: number): Set<string> {
  const reached = new Set([start]);
  let layer = [start];
  for (let hop = 0; hop < depth && layer.length > 0; hop += 1) {
    layer = layer.flatMap((file) => importsOf(root, file)).filter((file) => !reached.has(file));
    for (const file of layer) reached.add(file);
  }
  return reached;
}

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

const listed = (root: string, path: string, pattern: RegExp): string[] =>
  lines(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", path])).filter((file) =>
    pattern.test(file),
  );

/** A changed file the wall reaches by any number of imports: the wall's tests are the one proof of
 *  each platform's wall, so a change there proves nothing short of both. */
export const reachingWall = (root: string, changed: ReadonlySet<string>): string | undefined => {
  const reached = new Set(
    listed(root, "src/sandbox", /\.ts$/u).flatMap((file) => [...within(root, file, Infinity)]),
  );
  return [...changed].find((file) => reached.has(file));
};

export const testsNear = (root: string, changed: ReadonlySet<string>): string[] =>
  nearbyTests(root, changed, listed(root, "test", TEST_FILE), NEAR.root);

export const uiTestsNear = (root: string, changed: ReadonlySet<string>, files: "all" | "no-browser") =>
  nearbyTests(
    root,
    changed,
    listed(root, UI_ROOT, UI_TEST).filter((file) => files === "all" || !BROWSER_FILE.test(file)),
    NEAR.ui,
  );

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
  const root = repoRoot();
  for (const [name, args] of FIRST) {
    const code = await step(root, name, args);
    if (code !== 0) return code;
  }
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
  const failed = new Set(text.match(/\(fail\) .*/gu)).size;
  const rerunning =
    rerun === undefined
      ? ""
      : `; the idle wall ended the suite, so its ${rerun} are running again one at a time and that run decides`;
  return `still running after ${String(minutes)} min: ${String(passed)} tests passed, ${String(failed)} failed so far${rerunning}.`;
}

/** An assertion can stand thousands of lines above the end of a bailed run. */
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

export const failedLine = (failure: Failure): string =>
  failure.verdict
    ? `${short(failure.commit)} FAILS ${failure.step} ON ITS OWN`
    : `${short(failure.commit)} GAVE NO VERDICT ON ${failure.step}: its runner said nothing of it twice`;

async function checkerDigest(): Promise<string> {
  const built = await Bun.build({ entrypoints: [GATE], target: "bun", minify: { whitespace: true } });
  const [bundle] = built.outputs;
  if (!built.success || bundle === undefined) throw new Error(`could not bundle ${GATE}`);
  return sha256(await bundle.text()).slice(0, 16);
}

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

function reported(who: string, commit: string, log: string, verdict: boolean): Failure {
  const output = lines(readFileSync(log, "utf8"));
  const said = output.map((line) => /^gate: step (\S+) (failed|gave no verdict)/u.exec(line));
  const failedStep = said.findLast((line) => line !== null && (line[2] === "failed") === verdict)?.[1];
  const failure = { commit, step: failedStep ?? "the gate", log, verdict };
  console.error([...failedTests(output), ...output.slice(-30)].join("\n"));
  console.error(`${who}: ${failedLine(failure)}. Log: ${log}`);
  return failure;
}

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
  const at = ({ index, commit }: Queued) =>
    `${String(index + 1)} of ${String(proofs.length)}, ${short(commit)}`;
  const earlierOf = ({ commit, pass }: Proof): Pass | null => {
    const had = (kind: Pass): boolean => passed.has(contentKey(root, commit, kind, checker));
    return had("whole") ? "whole" : pass !== null && had(pass) ? pass : null;
  };
  const run = async (proof: Queued, { place, leave }: Seat): Promise<"done" | "elsewhere"> => {
    const { index, commit, pass } = proof;
    const earlier = earlierOf(proof);
    if (pass === null || earlier !== null) {
      say(
        `${at(proof)}: ${earlier === null ? "documentation only" : "passed earlier on these exact bytes"}.`,
      );
      mark(commit, "success", earlier === null ? "documentation only" : PROVED[earlier]);
      return "done";
    }
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
    say(`${at(proof)}: ${WHAT[pass]}${remote === undefined ? "" : ` on ${remote}`}. Log: ${log}`);
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
        ...placeEnv(place),
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
    if (code !== 0 && stop?.aborted === true) {
      say(`${at(proof)}: stopped.`);
      return "done";
    }
    if (code === 0) {
      appendFileSync(record, `${contentKey(root, commit, pass, checker)}\n`);
      mark(commit, "success", PROVED[pass]);
      say(`${at(proof)}: passed.`);
      return "done";
    }
    const verdict = verdictOf(code) === "failed";
    if (!verdict && leave()) {
      say(
        `${at(proof)}: ${place.remote ?? "its place"} gave no verdict, so takes no more; proving it elsewhere.`,
      );
      return "elsewhere";
    }
    failures.push({ index, ...reported(who, commit, log, verdict) });
    const state = verdict ? "failure" : "error";
    mark(commit, state, FAILED[state]);
    return "done";
  };
  try {
    await spread(
      prover.places,
      proofs.map((proof, index) => ({ ...proof, index })),
      {
        run,
        startsAlone: (proof) => proof.pass === "whole" && earlierOf(proof) === null,
        halt: () => failures.length > 0 || stop?.aborted === true,
      },
    );
  } finally {
    // A rejected mark (land's `Moved`) leaves other proofs running in their checkouts: `spread` lets
    // each finish, and its pass recorded for the retry, before any checkout is removed.
    for (const tree of made) runSync(["git", "worktree", "remove", "--force", tree], { cwd: root });
  }
  return failures.toSorted((a, b) => a.index - b.index)[0] ?? null;
}

if (import.meta.main) runtimeProcess.exit(await gate(Bun.argv.slice(2)));
