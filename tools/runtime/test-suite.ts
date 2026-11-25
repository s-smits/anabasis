/**
 * Repository test runner: `bun test --parallel` ordered slowest-first from
 * `test/.test-timings.json` (`--update-timings`, `--max-concurrency=4`), with workers sized by
 * `workerCount` (`ANA_TEST_WORKERS` overrides; at most 4 for browser UI files; `ANA_TEST_BAIL=1`
 * passes `--bail`). An output-idle wall (`IDLE_WALL_SECONDS`, scaled by host load) ends a wedged
 * run with SIGTERM then SIGKILL and reruns unfinished files in one workerless process, keeping any
 * failure already reported. Runs in a scratch directory under `SUITE_SCRATCH_ROOT`, cleaned on exit
 * or by `bun run runs retire`.
 */
import { boundText } from "../../src/meta/bounded-text.ts";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync } from "../../src/meta/filesystem.ts";
import { availableParallelism, loadavg } from "../../src/meta/os.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { processAnswers, runtimeProcess } from "../../src/meta/process.ts";
import { compareCodeUnits } from "../../src/meta/stable-json.ts";
import { SUITE_SCRATCH_ROOT } from "../../src/wall/policy.ts";
import { claim, releaseRoot } from "../../src/wall/seat-root.ts";
import {
  decodeOutput,
  interruptAndReapProcessGroup,
  killProcessGroup,
  runSync,
} from "../../src/meta/subprocess.ts";

const REPO_ROOT = join(import.meta.dir, "../..");
const TIMINGS = join(REPO_ROOT, "test/.test-timings.json");
const OPERAND_FLAGS = new Set([
  "-t",
  "--test-name-pattern",
  "--reporter-outfile",
  "--coverage-dir",
  "--path-ignore-patterns",
  "--timings",
  "--changed",
  "--preload",
  "-r",
  "--config",
  "--env-file",
  "--cwd",
]);
const IDLE_WALL_SECONDS = 180;
/** With any of the first three set Bun prints no `(pass)` line, so every passing file would read as
 *  unreported; under `GITHUB_ACTIONS` it prints forms the parser does not read. */
const AGENT_MARKERS = new Set(["CLAUDECODE", "AGENT", "REPL_ID", "GITHUB_ACTIONS"]);

export const PER_TEST_WALL_MS = 60_000;
const COMMON_FLAGS = [
  "--max-concurrency=4",
  `--timeout=${String(PER_TEST_WALL_MS)}`,
  `--timings=${TIMINGS}`,
  "--update-timings",
  ...(Bun.env.ANA_TEST_BAIL === "1" ? ["--bail"] : []),
];

interface WalledRun {
  exitCode: number | null;
  reported: Set<string>;
  failed: Set<string>;
  interrupted: Set<string>;
  incomplete: Set<string>;
  inFlight: string | null;
  errors: number;
}

type ProcessOutput = Omit<WalledRun, "exitCode">;

interface OutputReader {
  run: ProcessOutput;
  scanLine: (line: string) => void;
}

interface WallState {
  lastOutputAt: number;
  walled: boolean;
}

const GRACE_MS = 15_000;

type Reason = "stands" | "already-failed" | "none-left" | "never-finished" | "unhandled-error";

interface Attribution {
  rerun: readonly string[] | null;
  exitCode: number;
  because: Reason;
  subject: readonly string[];
}

/** One spelling for a file: Darwin reaches its temp root through `/var`, which is `/private/var`, and Bun
 *  prints the header from the path it opened, so otherwise every file there reads as never reported. */
function fileIdentity(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

function hostLoad(): number {
  const pinned = Bun.env.ANA_TEST_HOST_LOAD;
  if (pinned === undefined) return loadavg()[0] ?? 0;
  if (!/^\d+(?:\.\d+)?$/.test(pinned)) throw new Error("ANA_TEST_HOST_LOAD must be a non-negative number");
  return Number(pinned);
}

function workerCount(override: string | undefined): number {
  if (override !== undefined) {
    if (!/^[1-9]\d*$/.test(override)) throw new Error("ANA_TEST_WORKERS must be a positive integer");
    return Number(override);
  }
  const cores = availableParallelism();
  return Math.max(2, cores - 2 - Math.round(Math.max(0, hostLoad() - cores) / 2));
}

function scanRequest(requested: readonly string[]) {
  let cwd = REPO_ROOT;
  const fileIndexes: number[] = [];
  let operand = false;
  for (const [index, argument] of requested.entries()) {
    if (operand) {
      operand = false;
      continue;
    }
    if (argument === "--cwd") cwd = resolve(REPO_ROOT, requested[index + 1] ?? ".");
    if (argument.startsWith("--cwd=")) cwd = resolve(REPO_ROOT, argument.slice(6));
    if (OPERAND_FLAGS.has(argument)) {
      operand = true;
      continue;
    }
    if (argument.startsWith("-") || !argument.includes("/") || /[*?[\]{}()|\\^$+]/.test(argument)) continue;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(argument)) fileIndexes.push(index);
  }
  return { cwd, fileIndexes };
}

/** Bun treats an unknown path as a filter and would silently run only its neighbours. */
function requestedFiles(requested: readonly string[]): string[] {
  const { cwd, fileIndexes } = scanRequest(requested);
  const files = requested.filter((_, index) => fileIndexes.includes(index));
  for (const file of files) {
    if (!existsSync(resolve(cwd, file))) throw new Error(`requested test file does not exist: ${file}`);
  }
  return files.map((file) => fileIdentity(resolve(cwd, file)));
}

function testCommand(requested: readonly string[], workers: string | undefined): string[] {
  requestedFiles(requested);
  // Four tests at once a file, as most spawn children. Workers share one global, so no test may lean on a
  // fresh one: isolating file after file is where Bun's spawnSync loses a child's exit (oven-sh/bun#34069).
  // Browser files each start a server and Chrome, so they run on fewer workers.
  const browsers = workers === undefined && requested.some((path) => path.includes("packages/ui/test"));
  const command = [
    runtimeProcess.execPath,
    "test",
    `--parallel=${String(browsers ? Math.min(4, workerCount(workers)) : workerCount(workers))}`,
    "--no-isolate",
    ...COMMON_FLAGS,
  ];
  // `./test` names the directory. Bun reads a bare `test` as a filter on every path it discovers,
  // which takes in any ignored tree holding a test file, such as a bundle copied under `notes/`.
  return requested.length === 0 ? [...command, "./test"] : [...command, ...requested];
}

function interruptReader(
  norm: (p: string) => string,
  interrupted: Set<string>,
  incomplete: Set<string>,
): (line: string) => boolean {
  let list: "running" | "not-started" | null = null;
  return (line) => {
    if (line.startsWith("Interrupted while still running:")) {
      list = "running";
      return true;
    }
    if (/^\d+ file\(s\) had not started:$/.test(line)) {
      list = "not-started";
      return true;
    }
    if (list !== null && /^ {2}\S/.test(line)) {
      const testPath = norm(line);
      (list === "running" ? interrupted : incomplete).add(testPath);
      return true;
    }
    list = null;
    const ended = /^✗ (.+?) \((worker crashed|aborted:|no live workers)/.exec(line);
    if (ended === null) return false;
    const [, testPath = "", how] = ended;
    (how === "worker crashed" ? interrupted : incomplete).add(norm(testPath));
    return true;
  };
}

/** Each descendant's pid, CPU share and command line as the wall fired. Returns the pids: the group kill
 *  cannot reach one that started its own session, and the tree is observable only before its parent goes. */
async function describeTree(pid: number): Promise<number[]> {
  const ps = Bun.spawn(["ps", "-axo", "pid=,ppid=,%cpu=,args="], { stdout: "pipe", stderr: "ignore" });
  const rows = (await new Response(ps.stdout).text())
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  const parentOf = new Map(rows.map(([child, parent]) => [Number(child), Number(parent)]));
  const descendants = new Set<number>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [child, parent] of parentOf) {
      if (!descendants.has(child) && (parent === pid || descendants.has(parent))) {
        descendants.add(child);
        grew = true;
      }
    }
  }
  const lines = rows
    .filter(([child]) => descendants.has(Number(child)))
    .map((row) => boundText(row.toSpliced(1, 1).join(" "), 240).shown);
  console.error(`idle-wall: descendants when the wall fired (pid, %cpu, command):\n${lines.join("\n")}`);
  return [...descendants];
}

async function killStrays(pids: number[]): Promise<void> {
  const strays = pids.filter(processAnswers);
  for (const pid of strays) {
    try {
      runtimeProcess.kill(pid, "SIGKILL");
    } catch {
      // the stray may have exited between the scan and the kill
    }
  }
  for (let elapsed = 0; elapsed < 500 && strays.some(processAnswers); elapsed += 10) await Bun.sleep(10);
  if (strays.length > 0) {
    console.error(
      `idle-wall: ended ${String(strays.length)} descendant(s) outside the group: ${strays.join(", ")}`,
    );
  }
  const survivors = strays.filter(processAnswers);
  if (survivors.length > 0) console.error(`idle-wall: descendants survived SIGKILL: ${survivors.join(", ")}`);
}

function endNaming(roots: readonly string[]): void {
  for (const row of decodeOutput(runSync(["ps", "-axo", "pid=,args="]).stdout).split("\n")) {
    const [, pid = "", args = ""] = /^\s*(\d+)\s+(.*)$/.exec(row) ?? [];
    if (Number(pid) === runtimeProcess.pid || !roots.some((root) => args.includes(root))) continue;
    try {
      runtimeProcess.kill(Number(pid), "SIGKILL");
    } catch {
      // it may have exited since the scan
    }
  }
}

let active: Bun.Subprocess | null = null;

function startWall(child: Bun.Subprocess, state: WallState): ReturnType<typeof setInterval> {
  const ticker = setInterval(() => {
    const busy = hostLoad();
    // Scaled by load the suite's own workers cannot reach, so a real wedge still ends at the flat wall.
    const wall = Math.round(IDLE_WALL_SECONDS * Math.max(1, busy / availableParallelism()));
    if (state.walled || performance.now() - state.lastOutputAt < wall * 1000) return;
    state.walled = true;
    clearInterval(ticker);
    (async () => {
      console.error(
        `idle-wall: no output for ${String(wall)} s at a load average of ${busy.toFixed(1)} on ${String(availableParallelism())} cores; interrupting the test run.`,
      );
      const descendants = await describeTree(child.pid);
      const reaped = await interruptAndReapProcessGroup(child, GRACE_MS);
      if (!reaped) console.error("idle-wall: some process in the group survived SIGKILL.");
      await killStrays(descendants);
    })().catch((cause: unknown) => {
      killProcessGroup(child, "SIGKILL");
      console.error("idle-wall: cleanup failed", cause);
    });
  }, 1000);
  return ticker;
}

function outputReader(cwd: string): OutputReader {
  const run: ProcessOutput = {
    reported: new Set<string>(),
    failed: new Set<string>(),
    interrupted: new Set<string>(),
    incomplete: new Set<string>(),
    inFlight: null,
    errors: 0,
  };
  const norm = (p: string) =>
    fileIdentity(
      resolve(
        cwd,
        p
          .trim()
          .replace(/:$/, "")
          .replace(/ \(\d+s\)$/, "")
          .replaceAll("\\", "/"),
      ),
    );
  const readInterrupt = interruptReader(norm, run.interrupted, run.incomplete);
  const scanLine = (line: string): void => {
    if (readInterrupt(line)) return;
    if (/^\S+\.(?:test|spec)\.[cm]?[jt]sx?:$/.test(line)) {
      run.inFlight = fileIdentity(resolve(cwd, line.slice(0, -1)));
      return;
    }
    const header = run.inFlight;
    if (header === null || !/^\((?:pass|fail|skip|todo)\) /.test(line)) {
      if (line.startsWith("# Unhandled error")) run.errors++;
      return;
    }
    run.reported.add(header);
    if (line.startsWith("(fail) ")) run.failed.add(header);
  };
  return { run, scanLine };
}

async function runWalled(command: string[], temporaryRoot: string, cwd: string): Promise<WalledRun> {
  // Its own process group, so the wall ends every descendant at once and no grandchild outlives the kill.
  const child = Bun.spawn(command, {
    cwd: REPO_ROOT,
    env: {
      ...Object.fromEntries(Object.entries(Bun.env).filter(([name]) => !AGENT_MARKERS.has(name))),
      ANA_TEST_TMPDIR: temporaryRoot,
    },
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  active = child;
  const state: WallState = { lastOutputAt: performance.now(), walled: false };
  let pending = "";
  const { run, scanLine } = outputReader(cwd);
  const relay = async (
    source: ReadableStream<Uint8Array>,
    sink: typeof Bun.stdout,
    holds: "results" | "output",
  ): Promise<void> => {
    const writer = sink.writer();
    for await (const chunk of source) {
      state.lastOutputAt = performance.now();
      await writer.write(chunk);
      await writer.flush();
      if (holds === "output") continue;
      const lines = (pending + new TextDecoder().decode(chunk)).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) scanLine(line);
    }
    await writer.end();
  };
  const ticker = startWall(child, state);
  await Promise.all([relay(child.stdout, Bun.stdout, "output"), relay(child.stderr, Bun.stderr, "results")]);
  const exitCode = await child.exited;
  clearInterval(ticker);
  return { ...run, exitCode: state.walled ? null : exitCode };
}

function attribute(first: WalledRun, asked: readonly string[]): Attribution {
  // An error Bun printed outside any test is in its exit code and in no result line, so running those
  // files again could return zero and take the error with it.
  if (first.errors > 0) {
    return { rerun: null, exitCode: first.exitCode ?? 1, because: "unhandled-error", subject: [] };
  }
  if (first.exitCode !== null) {
    return { rerun: null, exitCode: first.exitCode, because: "stands", subject: [] };
  }
  if (first.failed.size > 0) {
    return { rerun: null, exitCode: 1, because: "already-failed", subject: [...first.failed] };
  }
  const remaining = [
    ...new Set([
      ...first.interrupted,
      ...first.incomplete,
      ...asked.filter((file) => !first.reported.has(file) || file === first.inFlight),
    ]),
  ];
  if (remaining.length === 0) return { rerun: null, exitCode: 1, because: "none-left", subject: remaining };
  return { rerun: remaining, exitCode: 1, because: "never-finished", subject: remaining };
}

async function main(): Promise<number> {
  // A short fresh parent, so no socket path a test makes outgrows its limit, apart from TMPDIR: Darwin's
  // compiler ignores TMPDIR, while the isolation profiles use its original value to admit compiler scratch.
  mkdirSync(SUITE_SCRATCH_ROOT, { recursive: true });
  const temporaryRoot = mkdtempSync(`${SUITE_SCRATCH_ROOT}/`);
  claim(temporaryRoot);
  const roots = [temporaryRoot, realpathSync(temporaryRoot)];
  const requested = Bun.argv.slice(2);
  const endOn = (signal: "SIGINT" | "SIGTERM" | "SIGHUP") => () => {
    if (active !== null) killProcessGroup(active, signal);
    endNaming(roots);
    const exit = () => runtimeProcess.exit(130);
    releaseRoot(temporaryRoot).then(exit, exit);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) runtimeProcess.once(signal, endOn(signal));
  const relative = (files: Iterable<string>) =>
    [...files]
      .map((file) => (file.startsWith(`${REPO_ROOT}/`) ? file.slice(REPO_ROOT.length + 1) : file))
      .join(" ");
  const askedFor = () =>
    requested.length === 0
      ? readdirSync(join(REPO_ROOT, "test"))
          .filter((name) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name))
          .toSorted(compareCodeUnits)
          .map((name) => fileIdentity(join(REPO_ROOT, "test", name)))
      : requestedFiles(requested);
  try {
    const { cwd } = scanRequest(requested);
    const first = await runWalled(testCommand(requested, Bun.env.ANA_TEST_WORKERS), temporaryRoot, cwd);
    const asked = askedFor();
    const step = attribute(first, asked);
    if (step.because !== "stands") {
      const silence = "the suite was ended by the idle wall";
      const interrupted = step.subject.filter((file) => first.interrupted.has(file)).length;
      const said: Record<Exclude<Reason, "stands">, string> = {
        "already-failed": `idle-wall: error: ${silence}; ${String(step.subject.length)} file(s) had already failed: ${relative(step.subject)}`,
        "none-left": `idle-wall: error: ${silence} with no file left unfinished that it can name, so nothing can run again and there is no exit code to take as the verdict.`,
        "never-finished": `idle-wall: retrying ${String(interrupted)} interrupted and ${String(step.subject.length - interrupted)} unfinished file(s) one at a time in one fresh process: ${relative(step.subject)}`,
        "unhandled-error": `test-suite: error: ${String(first.errors)} error(s) printed outside any test, which running any file again cannot clear.`,
      };
      console.error(said[step.because]);
    }
    if (step.rerun === null) return step.exitCode;
    const { fileIndexes } = scanRequest(requested);
    const again = await runWalled(
      [
        runtimeProcess.execPath,
        "test",
        ...COMMON_FLAGS,
        ...requested.filter((_argument, index) => !fileIndexes.includes(index)),
        ...step.rerun,
      ],
      temporaryRoot,
      cwd,
    );
    if (again.exitCode === null) {
      console.error("idle-wall: error: the rerun was ended by the idle wall named above.");
    }
    return again.exitCode ?? 1;
  } finally {
    endNaming(roots);
    // A test the idle wall ended can leave something under the root its removal fails on, and a suite
    // with no failure would otherwise exit 1 over it.
    await releaseRoot(temporaryRoot).catch(() => {
      console.error(`test-suite: ${temporaryRoot} is still in use, and is left to the daily sweep`);
    });
  }
}

if (import.meta.main) runtimeProcess.exit(await main());
