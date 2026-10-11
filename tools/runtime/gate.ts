/**
 * The gate: what CI runs, as one command over the tree it is run in, and the same gate run over each
 * commit a push or a landing would publish, in a checkout of its own.
 *
 *   bun run gate                 install, format, typecheck, strict lint, the suite
 *   bun run gate -- --static     the same, with the suite replaced by the tests near what HEAD changed
 *
 * The steps are `ci.yml`'s Darwin job, cheapest first, so a format slip fails in a second rather
 * than after the linter. The strict lint fails on everything a plain one does, so it runs once.
 * Every step fails in one spelling, `gate: step <name> failed (exit <n>)`, which the pre-push hook
 * and `bun run land` repeat without knowing each tool's wording.
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
 * a pass runs, and each pass remembered by commit id in `ana-gate-passed` under the common Git
 * directory, so a commit that passed is not run again from any worktree. A fix rewrites only its
 * own commit and those above it, so after a failure the commits beneath it keep their passes.
 */
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
} from "../../src/meta/filesystem.ts";
import { isString } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
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
  ":(exclude)CLAUDE.md",
  ":(exclude)README.md",
  ":(exclude)docs/**",
  ":(exclude).claude/**/*.md",
];
const STEPS = [
  ["install", ["install", "--frozen-lockfile"]],
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
  const parent = runSync(["git", "rev-parse", "-q", "--verify", `${commit}^1`], { cwd: root });
  const from =
    parent.exitCode === 0
      ? new TextDecoder().decode(parent.stdout).trim()
      : git(root, ["hash-object", "-t", "tree", "/dev/null"]);
  return gitSays(root, ["diff", ...flags, from, commit, "--", ...paths]);
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
    const code = step(root, name, args);
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
 * failure, since every commit above a fix changes id with it.
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
  const passed = new Set(
    lines(
      await Bun.file(record)
        .text()
        .catch(() => ""),
    ),
  );
  const free: string[] = [];
  const made: string[] = [];
  const failures: (Failure & { index: number })[] = [];
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
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
    });
    const code = await child.exited;
    clearInterval(pulsing);
    closeSync(fd);
    free.push(tree);
    if (code === 0) {
      appendFileSync(record, `${commit} ${pass}\n`);
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
      const earlier = passed.has(`${commit} whole`)
        ? "whole"
        : pass !== null && passed.has(`${commit} ${pass}`)
          ? pass
          : null;
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
