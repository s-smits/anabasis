/**
 * The gate: what CI runs, as one command over the tree it is run in, and the same gate run over each
 * commit a push or a landing would publish, in a checkout of its own.
 *
 *   bun run gate                 install, the UI's own gate, format, typecheck, strict lint, the suite
 *   bun run gate -- --static     the same, with the suite replaced by the tests near what HEAD changed
 *
 * The steps are `ci.yml`'s two Darwin jobs, cheapest first, so a format slip fails in a second
 * rather than after the linter. The strict lint fails on everything a plain one does, so it runs
 * once. Every step fails in one spelling, `gate: step <name> failed (exit <n>)`, which the pre-push
 * hook and `bun run land` repeat without knowing each tool's wording.
 *
 * `--static` is what each commit below the one that gets the whole gate receives: v1's rule of 24
 * September 2026 that every published commit passes alone, because a session reading the history
 * copies a red commit and its repair as the way work is done. "Near" is one import, v1's depth: at
 * three imports, three commits of 11-17 files each selected 62-70 per cent of the suite's recorded
 * time against 14-19 at one, and the top then ran the whole suite again. A test is near when the
 * commit changed it, when it imports a changed file directly, or, for a changed file no test
 * imports (a fixture, or a command a test spawns by its path), when its text names the file.
 *
 * `proveCommits` runs this gate over a list of commits for `.githooks/pre-push` and `bun run land`:
 * in scratch worktrees made for the run, its output in a log under the Git directory, a pulse while
 * a pass runs, and each pass remembered in `ana-gate-passed` under the common Git directory, so a
 * commit that passed is not run again from any worktree. A pass is remembered by content
 * (`contentKey`): a whole pass by the commit's tree, a static one by its tree and its parent's, both
 * with the checker and the Bun version. The checker is this gate and what it imports, read from the
 * caller's checkout (`checkerDigest`), since it runs from there over every target: a changed gate
 * runs again on trees it passed before. Until 19 October a pass was remembered by commit id, and a
 * restack, which rewrites every id, kept nothing: that day a restack of 13 pull requests onto main,
 * under which only PR #205 had changed a skill script and its test, ran the whole gate again on the
 * top for about 20 minutes at a load of 11 on 8 cores, and left `bun run land` to prove all 13 from
 * scratch. A line recorded by commit id is not read: it names no checker, so it would stand for
 * whatever gate runs now, and each such commit is proved once more instead. The key covers the
 * target's tree and the caller's gate; it does not see the host: its tools, its environment and its
 * load. `ANA_GATE_FRESH=1` reads no remembered pass, so every commit selected for proof is run
 * again, and its passes are remembered as any others.
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
import { sha256, sha256OfFile } from "../../src/meta/digest.ts";
import { isString } from "../../src/meta/json-shape.ts";
import { availableParallelism, tmpdir } from "../../src/meta/os.ts";
import { basename, dirname, join, relative } from "../../src/meta/path.ts";
import { parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { runSync, runTextSyncOrThrow } from "../../src/meta/subprocess.ts";

type Pass = "static" | "whole";

/** One commit and the pass it needs; null for a commit that changes documentation alone, which the
 *  static steps have nothing to read in. */
export interface Proof {
  readonly commit: string;
  readonly pass: Pass | null;
}

/** The lowest commit that failed, the step it failed and the log that holds the output. */
interface Failure {
  readonly commit: string;
  readonly step: string;
  readonly log: string;
}

interface Prover {
  /** `pre-push` or `land`: what each line and each log is named after. */
  readonly who: string;
  readonly jobs: number;
  readonly say: (line: string) => void;
  /** Told every verdict, recorded earlier or new, so land can post it as a status. */
  readonly mark: (commit: string, state: "success" | "failure", description: string) => void;
}

/** The documentation set. A commit changing nothing beyond it gets no static steps, and a push of
 *  such commits alone gets `git diff --check` and nothing more. No test reads these files. */
const DOCUMENTATION = [
  ":(exclude)AGENTS.md",
  ":(exclude)README.md",
  ":(exclude)docs/**",
  ":(exclude).claude/**/*.md",
];
/** The UI's own gate, in a tree that holds the UI: `packages/ui` keeps its own lock, compiler
 *  settings and tests, which the root's typecheck and suite do not reach, and the lint leaves it
 *  out until its dependencies are installed (`tools/runtime/lint.ts`). A commit from before the UI
 *  came back has no such step to run. A static pass over a commit that leaves `packages/ui` alone
 *  runs the UI's gate without its browser files (`uiStatic`): of the 35 gate logs in this clone on
 *  18 October, the UI step's 16 failing cases were all in browser files, in 5 static passes of
 *  `bun run land` over commits that changed nothing under `packages/ui`. A whole pass, and a static
 *  pass over a commit that touches the UI, run every UI file. */
const UI_PACKAGE = "packages/ui/package.json";
const UI_ROOT = "packages/ui";
const BROWSER_FILE = /^packages\/ui\/test\/browser-[^/]+\.test\.ts$/u;
const STEPS = [
  ["install", ["install", "--frozen-lockfile"]],
  ["ui", ["run", "ui:gate"]],
  ["format", ["run", "format:check"]],
  ["typecheck", ["run", "typecheck"]],
  ["lint", ["run", "lint", "--", "--strict"]],
] as const;
const TEST_FILE = /^test\/[^/]+\.test\.ts$/u;
const GATE = join(import.meta.dir, "gate.ts");
const PROVED = {
  static: "its static steps and nearby tests passed on its own checkout",
  whole: "passed the whole gate on its own checkout",
} as const satisfies Record<Pass, string>;
const WHAT = {
  static: "the static steps and its nearby tests",
  whole: "the whole gate",
} as const satisfies Record<Pass, string>;
/** The test wrapper's two lines that send failed files to a second run, which then decides, in the
 *  words a pulse repeats. A `host-wall: error:` or `idle-wall: error:` line keeps the failures. */
const RERUNS: readonly (readonly [RegExp, (said: string) => string])[] = [
  [
    /host-wall: (.*); running their /u,
    (said) => `; ${said}, so the failed files are running again in one fresh process and that run decides`,
  ],
  [
    /idle-wall: retrying (.*) one at a time /u,
    (said) =>
      `; the idle wall ended the suite, so its ${said} are running again one at a time and that run decides`,
  ],
];
/** A pass keeps its output in a log and prints nothing for minutes, which reads like a hung push. */
const PULSE_MS = (Number(runtimeProcess.env.ANA_GATE_PULSE_SECONDS) || 60) * 1000;
const LOG_DAYS = 14;

export const lines = (text: string): string[] => text.split("\n").filter((line) => line.length > 0);
export const short = (sha: string): string => sha.slice(0, 9);

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

/** A commit's first parent, or the empty tree for a root commit. */
function parentOf(root: string, commit: string): string {
  const parent = runSync(["git", "rev-parse", "-q", "--verify", `${commit}^1`], { cwd: root });
  return parent.exitCode === 0
    ? new TextDecoder().decode(parent.stdout).trim()
    : git(root, ["hash-object", "-t", "tree", "/dev/null"]);
}

/** The checker that runs every pass, as one digest: this gate and the files its imports reach, read
 *  from the caller's checkout as it stands, since `GATE` runs from there over each target. Its
 *  steps run `bun run …` in the target's checkout (`step`), so the lint plugins and configs, the
 *  test wrapper, `package.json` and `bun.lock` they use are the target's, which its tree keys. Until
 *  20 October the digest took every file of `tools/runtime` and `src/meta`, so a caller whose lint
 *  or `src/meta/git.ts` had changed proved again what an equal gate had passed: along the chain of
 *  #267 to #288 it took four values where the gate's own files took two, and the chain's bottom
 *  commits were proved three times. */
function checkerDigest(): string {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const reached = new Set<string>();
  const reach = (file: string): void => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (path.startsWith(".")) reach(Bun.resolveSync(path, dirname(file)));
    }
  };
  reach(GATE);
  const top = join(import.meta.dir, "..", "..");
  const digests = [...reached].toSorted().map((file) => `${relative(top, file)} ${sha256OfFile(file)}`);
  return sha256(digests.join("\n")).slice(0, 16);
}

/** The record's key for a pass, by content: the commit's tree, which holds the lockfile, and for a
 *  static pass its first parent's tree too, since the diff between them chooses its tests; with
 *  the checker and the Bun the gate ran under. */
function contentKey(root: string, commit: string, pass: Pass, checker: string): string {
  const tree = git(root, ["rev-parse", `${commit}^{tree}`]);
  const from = pass === "whole" ? "" : `${git(root, ["rev-parse", `${parentOf(root, commit)}^{tree}`])}..`;
  return `tree ${from}${tree} ${pass} checker-${checker} bun-${Bun.version}`;
}

export const changesSource = (root: string, commit: string): boolean =>
  !diffFromParentSays(root, commit, ["--quiet"], [".", ...DOCUMENTATION]);

/**
 * The commits a push or a landing adds, oldest first: those along each head's first parents that
 * nothing in `known` reaches. A commit reached only through a merge's other parent belongs to a line
 * made elsewhere, and is only counted: on 11 October 2026 PR #141 added 448 commits to v1's main,
 * 444 of them v2's history through one merge, and v1's hook, which gated every commit new to the
 * remote, would have run its gate over each although none of them carried it. The merge is the
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

/** Every repository-relative file a test imports directly, resolved as Bun resolves it. */
function importsOf(root: string, test: string, text: string): string[] {
  let found: { path: string }[];
  try {
    found = new Bun.Transpiler({ loader: "ts" }).scanImports(text);
  } catch {
    return [];
  }
  return found.flatMap(({ path: specifier }) => {
    try {
      const inside = relative(root, Bun.resolveSync(specifier, dirname(join(root, test))));
      return inside.startsWith("..") || inside.includes("node_modules/") ? [] : [inside];
    } catch {
      return [];
    }
  });
}

/** The test files near what HEAD changed, by the rule in the head comment. */
async function nearbyTests(root: string): Promise<string[]> {
  const changed = new Set(
    lines(
      git(root, ["show", "--first-parent", "--format=", "--name-only", "HEAD", "--", ".", ...DOCUMENTATION]),
    ),
  );
  const tests = lines(git(root, ["ls-files", "test"])).filter((file) => TEST_FILE.test(file));
  const texts = new Map(
    await Promise.all(tests.map(async (test) => [test, await Bun.file(join(root, test)).text()] as const)),
  );
  const near = new Set(tests.filter((test) => changed.has(test)));
  const imported = new Set<string>();
  for (const [test, text] of texts) {
    for (const file of importsOf(root, test, text)) {
      imported.add(file);
      if (changed.has(file)) near.add(test);
    }
  }
  for (const file of changed) {
    if (imported.has(file) || TEST_FILE.test(file)) continue;
    for (const [test, text] of texts) {
      if (text.includes(file) || text.includes(basename(file))) near.add(test);
    }
  }
  return [...near].toSorted();
}

/** The UI's gate for a static pass: the whole of it where HEAD changed `packages/ui`, and else its
 *  dependencies, its build and every test file but the browser's (`BROWSER_FILE`). */
function uiStatic(root: string): number {
  if (!diffFromParentSays(root, "HEAD", ["--quiet"], [UI_ROOT])) return step(root, "ui", ["run", "ui:gate"]);
  const tests = lines(git(root, ["ls-files", `${UI_ROOT}/test`])).filter(
    (file) => /\.test\.tsx?$/u.test(file) && !BROWSER_FILE.test(file),
  );
  for (const args of [
    ["run", "ui:deps"],
    ["run", "ui:build"],
    ["run", "test", "--", ...tests],
  ]) {
    const code = step(root, "ui", args);
    if (code !== 0) return code;
  }
  return 0;
}

/** One step, its output where the caller's goes; its exit code. */
function step(root: string, name: string, args: readonly string[]): number {
  const code = Bun.spawnSync(["bun", ...args], { cwd: root, stdout: "inherit", stderr: "inherit" }).exitCode;
  if (code !== 0) console.error(`gate: step ${name} failed (exit ${String(code)})`);
  return code;
}

async function gate(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { static: { type: "boolean", default: false } } });
  const root = git(runtimeProcess.cwd(), ["rev-parse", "--show-toplevel"]);
  for (const [name, args] of STEPS) {
    if (name === "ui" && !existsSync(join(root, UI_PACKAGE))) continue;
    const code = name === "ui" && values.static ? uiStatic(root) : step(root, name, args);
    if (code !== 0) return code;
  }
  if (!values.static) return step(root, "test", ["run", "test"]);
  const near = await nearbyTests(root);
  if (near.length > 0) return step(root, "test", ["run", "test", "--", ...near]);
  console.log("gate: no test file is near what HEAD changed.");
  return 0;
}

/** What a pass's log says so far, for the pulse: tests passed and failed, and a rerun under way. */
function pulse(log: string, started: number): string {
  let text = "";
  try {
    text = readFileSync(log, "utf8");
  } catch {
    // The child has not written its first line yet.
  }
  const rerun = RERUNS.flatMap(([pattern, said]) => {
    const match = pattern.exec(text)?.[1];
    return match === undefined ? [] : [said(match)];
  });
  const minutes = Math.floor((Date.now() - started) / 60_000);
  const passed = text.match(/\(pass\)/gu)?.length ?? 0;
  const failed = text.match(/\(fail\)/gu)?.length ?? 0;
  return `still running after ${String(minutes)} min: ${String(passed)} tests passed, ${String(failed)} failed so far${rerun[0] ?? ""}.`;
}

/**
 * Runs each commit's pass over a checkout of it, up to `jobs` at once, and returns the lowest
 * failure. The whole gate waits until every commit beneath it has passed. Nothing new starts after a
 * failure, since every commit above a fix changes id with it. Passes side by side share the cores:
 * each suite left to itself takes two fewer workers than the host has, and on 20 October three at
 * once took a host of 12 cores to a load of 42, where their browser files timed out by the dozen.
 */
export async function proveCommits(
  root: string,
  proofs: readonly Proof[],
  prover: Prover,
): Promise<Failure | null> {
  const { who, say, mark } = prover;
  const record = join(
    git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    "ana-gate-passed",
  );
  const logs = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "ana-gate"]);
  mkdirSync(logs, { recursive: true });
  runSync(["find", logs, "-name", "*.log", "-mtime", `+${String(LOG_DAYS)}`, "-delete"]);
  const checker = checkerDigest();
  const passed = new Set(
    runtimeProcess.env.ANA_GATE_FRESH === "1"
      ? []
      : lines(
          await Bun.file(record)
            .text()
            .catch(() => ""),
        ),
  );
  const free: string[] = [];
  const made: string[] = [];
  const failures: (Failure & { index: number })[] = [];
  const share = String(Math.max(2, Math.floor((availableParallelism() - 2) / prover.jobs)));
  const run = async (at: string, index: number, commit: string, pass: Pass): Promise<void> => {
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
    say(`${at}: ${WHAT[pass]}. Log: ${log}`);
    const fd = openSync(log, "w");
    const started = Date.now();
    const pulsing = setInterval(() => say(`${short(commit)} ${pulse(log, started)}`), PULSE_MS);
    const child = Bun.spawn(["bun", GATE, ...(pass === "static" ? ["--static"] : [])], {
      cwd: tree,
      env:
        pass === "whole" || runtimeProcess.env.ANA_TEST_WORKERS !== undefined
          ? runtimeProcess.env
          : { ...runtimeProcess.env, ANA_TEST_WORKERS: share },
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
    });
    const code = await child.exited;
    clearInterval(pulsing);
    closeSync(fd);
    free.push(tree);
    if (code === 0) {
      appendFileSync(record, `${contentKey(root, commit, pass, checker)}\n`);
      mark(commit, "success", PROVED[pass]);
      say(`${at}: passed.`);
      return;
    }
    const output = lines(readFileSync(log, "utf8"));
    const failed = output.map((line) => /^gate: step (\S+) failed/u.exec(line)?.[1]).findLast(isString);
    failures.push({ index, commit, step: failed ?? "the gate", log });
    mark(commit, "failure", "failed on its own checkout");
    console.error(output.slice(-30).join("\n"));
    console.error(`${who}: ${short(commit)} FAILS ${failed ?? "the gate"} ON ITS OWN. Log: ${log}`);
  };
  const running = new Set<Promise<void>>();
  try {
    for (const [index, { commit, pass }] of proofs.entries()) {
      const at = `${String(index + 1)} of ${String(proofs.length)}, ${short(commit)}`;
      const had = (kind: Pass): boolean => passed.has(contentKey(root, commit, kind, checker));
      const earlier = had("whole") ? "whole" : pass !== null && had(pass) ? pass : null;
      if (pass === null || earlier !== null) {
        say(`${at}: ${earlier === null ? "documentation only" : "passed earlier on these exact bytes"}.`);
        mark(commit, "success", earlier === null ? "documentation only" : PROVED[earlier]);
        continue;
      }
      if (pass === "whole") await Promise.all(running);
      while (running.size >= prover.jobs) await Promise.race(running);
      if (failures.length > 0) break;
      const task: Promise<void> = run(at, index, commit, pass).then(() => {
        running.delete(task);
      });
      running.add(task);
    }
    await Promise.all(running);
  } finally {
    for (const tree of made) runSync(["git", "worktree", "remove", "--force", tree], { cwd: root });
  }
  return failures.toSorted((a, b) => a.index - b.index)[0] ?? null;
}

if (import.meta.main) runtimeProcess.exit(await gate(Bun.argv.slice(2)));
