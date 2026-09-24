/**
 * One `bun test` invocation over the repository suite, under its own output-idle wall.
 *
 * It used to be seven sequential shards of four workers each, paying Bun's start-up and the
 * timings read seven times over and leaving three workers idle at every shard's tail. Now it is
 * one process: `--parallel` with two workers fewer than the machine has free,
 * `--max-concurrency=4` inside a file, and the files ordered slowest-first from the recorded
 * timings so the long files start at t=0 and the short ones fill the gaps. The wrapper always
 * writes the timings back (`--update-timings`): the file is ignored by Git, so each checkout
 * learns its own order from its first run. `ANA_TEST_WORKERS` overrides the worker count. Two
 * fewer than the cores because most heavy tests spawn confined children -- Seatbelt or Bubblewrap
 * cells, generated-tool workers, git -- so a worker running four concurrent tests already loads
 * more than one core.
 *
 * The host the suite shares. The cores a machine has are not the cores this suite gets, and a
 * failure it did not cause is not a verdict on the branch. The worker count subtracts half the
 * one-minute load average, so a runner already carrying four jobs of its own is not asked for
 * three times itself, while a laptop that merely looks busy keeps its workers. Then, when the
 * first process fails, the run is attributed before it is believed: if a clock ended every
 * failure, or the host passed twice its cores in load while they ran, the failed files run again
 * alone and that verdict is the suite's. A failure on a quiet host, and more failed files than a
 * busy host explains, both stand as they were printed.
 *
 * The wall. `--timeout=60000` bounds each test, not the worker. Bun 1.4 sometimes leaves a
 * `--test-worker` spinning at full CPU with exited, unreaped children after a subprocess-heavy
 * file; no test is running, so the per-test wall never fires, and an unattended run holds the
 * queue until someone notices. Every chunk of output resets a clock; 180 s of silence (three
 * per-test walls) ends the whole process group and lists what it was running. The wedge sits in
 * the worker's own tail, so the wall then runs the files never reported again, once, in one fresh
 * process without workers, and that verdict is the suite's for the files it reports -- a file
 * silent there as well was tested by neither process, so its silence is a failure and not a pass.
 * The wall fails the suite outright when more than a few files are missing, which is an early
 * wedge rather than a tail. A failure printed before the wall is kept: the rerun covers the files
 * the first process never finished, never the verdict of one it did. The suite owns the wall, so
 * `bun run test` and the gate share one behaviour; `ANA_TEST_IDLE_SECONDS` shortens it for its own
 * test, and `wallSeconds` widens it in proportion to load the suite did not create.
 *
 * Around the command: one fresh temporary root, and a check that every explicitly named test file
 * exists, since Bun treats an unknown path as a filter and would silently run only its neighbours.
 */
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "../../src/meta/filesystem.ts";
import { availableParallelism, loadavg, tmpdir } from "../../src/meta/os.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { killProcessGroup, terminateAndReapProcessGroup } from "../../src/meta/subprocess.ts";

const REPO_ROOT = join(import.meta.dir, "../..");
// Absolute, so a focused `--cwd` request still reads and refreshes the repository file.
const TIMINGS = join(REPO_ROOT, "test/.test-timings.json");
// Flags whose next argument is a path or pattern, not a test file to check.
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
/** Bun prints no `(pass)` line when any of these is set, as a quieter mode for agents, and
 *  `runWalled` counts a file as reported only from its result lines. Inherited from an agent's
 *  shell, every passing file read as unreported, so no clock-only, crowded-host or idle-wall rerun
 *  could run. The suite owns the output it parses, so its child never sees them. */
const AGENT_MARKERS = new Set(["CLAUDECODE", "AGENT", "REPL_ID"]);

const PER_TEST_WALL_MS = 60_000;
const COMMON_FLAGS = [
  "--max-concurrency=4",
  `--timeout=${String(PER_TEST_WALL_MS)}`,
  `--timings=${TIMINGS}`,
  "--update-timings",
];

/** `reported` holds every file whose results Bun printed and `failed` those among them with a
 *  `(fail)` line; `inFlight` is the file whose block was printed last, so with one streaming
 *  worker it is the file the wall interrupted. `exitCode` is null when the wall ended the group.
 *  `failures` counts the `(fail)` lines and `clockEnded` how many a wall ended rather than an
 *  assertion: a run where the two agree failed on time alone. `errors` counts what Bun printed
 *  outside any test, which appears in no result line and so in neither set. */
export interface WalledRun {
  exitCode: number | null;
  reported: Set<string>;
  failed: Set<string>;
  inFlight: string | null;
  failures: number;
  clockEnded: number;
  errors: number;
  peakLoad: number;
}

/** Bun names a per-test wall on the line after the result. Either way the clock decided, and
 *  nothing was asserted about the code. */
const TIMED_OUT_NOTICE = /^\s*\^ this test timed out after \d+ms\.$/;

/** Bun heads an error that belongs to no test with this banner and prints no result line for it:
 *  a module that would not load, a stray throw between tests. It reaches the suite on stderr, and
 *  Bun counts it in its own exit code. */
const UNHANDLED_ERROR = /^# Unhandled error/;

/** Why the suite did what it did with a first process's result. `stands` takes that verdict with
 *  nothing to say; the rest each print one sentence naming `subject`. */
type Reason =
  | "stands"
  | "already-failed"
  | "none-left"
  | "never-finished"
  | "unreported"
  | "too-many-failed"
  | "clock-only"
  | "crowded-host"
  | "unhandled-error";

/** What to do with a first process's result: run `rerun` again and take that verdict, or let the
 *  first verdict stand. `subject` is the files the reason is about, for the sentence the caller
 *  prints. */
interface Attribution {
  rerun: readonly string[] | null;
  exitCode: number;
  because: Reason;
  subject: readonly string[];
}

/** Whose verdict a rerun may give. It exists to settle named files, so its exit code speaks for
 *  the files it printed a result for and for no others: a file silent in the first process -- which
 *  is why it is here -- and silent again is one no process has tested, and returning zero would
 *  report a pass nothing observed. So `main` reads this rather than the rerun's own exit code. */
interface RerunVerdict {
  exitCode: number;
  silent: readonly string[];
}

const RERUN_FILE_LIMIT = 8;

/** One spelling for a file, so a name the request gave and a header Bun printed compare as the
 *  same file. Darwin reaches its temp root through a symlink -- `/var` is `/private/var` -- and Bun
 *  prints the header from the path it opened, so without this the two sides meet as different
 *  strings and every file under that root reads as never reported. A path that is gone keeps the
 *  spelling it was given. */
function fileIdentity(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

/** The one-minute load average: the trailing count of runnable work on this machine. Its own test
 *  pins it through `ANA_TEST_HOST_LOAD`, which also lets an operator tell the suite the host is
 *  quiet when the reading is not to be believed. */
function hostLoad(): number {
  const pinned = Bun.env.ANA_TEST_HOST_LOAD;
  if (pinned === undefined) return loadavg()[0] ?? 0;
  if (!/^\d+(?:\.\d+)?$/.test(pinned)) throw new Error("ANA_TEST_HOST_LOAD must be a non-negative number");
  return Number(pinned);
}

/** Two workers fewer than the cores, less half of the load the host carries beyond them, and at
 *  least two; `ANA_TEST_WORKERS` overrides. A runner carrying several CPU-bound jobs of its own
 *  can sit at a load average many times its core count, where six workers at four concurrent tests
 *  each ask for about three times the machine and the gate returns wall failures on a branch whose
 *  files pass alone.
 *
 *  Beyond them, because a load average equal to the cores is a machine that is busy rather than
 *  oversubscribed, and the reading counts threads blocked in the kernel as well as threads wanting
 *  a core. Halving rather than subtracting the whole reading is what lets a twelve-core laptop at
 *  a load just under its cores keep its full worker count, while a host oversubscribed threefold
 *  still reaches the floor of two.
 *
 *  The number is not the whole condition, though, and nothing here is re-tuned on one reading. A
 *  load average cannot say what the load is made of: a Spotlight reindex contends for the disk
 *  rather than for cores, and a laptop that this formula leaves on ten workers can still report
 *  none of its files before the idle wall while the same push at four workers runs green. The
 *  lever for that is the override, or a less loaded host. */
/** The silence a starved host earns. Work on a machine carrying more runnable threads than it
 *  has cores takes proportionally longer to print its first line, and a suite waiting for a core
 *  looks exactly like one that is wedged. Scaling by the same reading `workerCount` uses keeps
 *  the wall at its flat value on a quiet machine and doubles it at the load above which
 *  `attribute` already stops blaming the branch.
 *
 *  The suite's own workers cannot reach the multiplier: two of them spinning on a twelve-core
 *  laptop is a load of two, so a real wedge still ends at the flat wall. It widens only for load
 *  from outside — a laptop other work holds at a load of 30.9 on 12 cores gives its files 463 s
 *  rather than 180. */
export function wallSeconds(idleSeconds: number, busy = hostLoad(), cores = availableParallelism()): number {
  return Math.round(idleSeconds * Math.max(1, busy / cores));
}

export function workerCount(override: string | undefined, busy = hostLoad()): number {
  const cores = availableParallelism();
  return positiveInteger(
    "ANA_TEST_WORKERS",
    override,
    Math.max(2, cores - 2 - Math.round(Math.max(0, busy - cores) / 2)),
  );
}

/** The working directory a request names and the positions of the test files it names. */
function scanRequest(requested: readonly string[]) {
  // Files are checked after the whole scan, so a `--cwd` given after a file still applies to it.
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

/** The test files a request names, checked to exist: Bun treats an unknown path as a filter and
 *  would silently run only its neighbours. Filters and flag operands stay in the request. */
function requestedFiles(requested: readonly string[]): string[] {
  const { cwd, fileIndexes } = scanRequest(requested);
  const files = requested.filter((_, index) => fileIndexes.includes(index));
  for (const file of files) {
    if (!existsSync(resolve(cwd, file))) throw new Error(`requested test file does not exist: ${file}`);
  }
  return files.map((file) => fileIdentity(resolve(cwd, file)));
}

/** The request with its test files removed: the filters, preloads, reporters and working
 *  directory a rerun must keep, so it tests what the first process was asked to test. */
export function requestWithoutFiles(requested: readonly string[]): string[] {
  const { fileIndexes } = scanRequest(requested);
  return requested.filter((_argument, index) => !fileIndexes.includes(index));
}

/** The one test command. An empty request runs the whole `test/` tree; a focused request runs the
 *  named files. Both order files slowest-first from the recorded timings and refresh them. */
export function testCommand(requested: readonly string[], workers: string | undefined): string[] {
  requestedFiles(requested);
  // Inside a file, four concurrent tests at once: most of them spawn child processes.
  const command = [
    runtimeProcess.execPath,
    "test",
    `--parallel=${String(workerCount(workers))}`,
    ...COMMON_FLAGS,
  ];
  return requested.length === 0 ? [...command, "test"] : [...command, ...requested];
}

/** One line per descendant as the tree stood when the wall fired: pid, CPU share and command
 *  line, so a stalled log says which worker spun and what the rest of the group was running.
 *  Returns those pids: the group kill below cannot reach a descendant that started its own
 *  session, and the tree is only observable before its parent is gone. */
async function describeTree(pid: number): Promise<number[]> {
  const ps = Bun.spawn(["ps", "-axo", "pid=,ppid=,%cpu=,args="], { stdout: "pipe", stderr: "ignore" });
  const rows = (await new Response(ps.stdout).text())
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/, 3));
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
  const lines = (
    await new Response(
      Bun.spawn(["ps", "-o", "pid=,%cpu=,args=", "-p", [...descendants].join(",") || "0"], {
        stdout: "pipe",
        stderr: "ignore",
      }).stdout,
    ).text()
  )
    .trimEnd()
    .split("\n")
    .map((line) => line.slice(0, 240));
  console.error(`idle-wall: descendants when the wall fired (pid, %cpu, command):\n${lines.join("\n")}`);
  return [...descendants];
}

/** End the listed descendants the group kill left behind. A Bubblewrap verifier runs with
 *  `--new-session`, so it is outside the group, and `--die-with-parent` does not end one whose
 *  wedged worker the wall has killed: it stays in `waitpid` indefinitely, holding a generated-tools
 *  worker from a suite root that no longer exists. */
async function killStrays(pids: number[]): Promise<void> {
  const alive = (pid: number): boolean => {
    try {
      runtimeProcess.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const strays = pids.filter(alive);
  for (const pid of strays) {
    try {
      runtimeProcess.kill(pid, "SIGKILL");
    } catch {
      // the stray may have exited between the scan and the kill
    }
  }
  for (let elapsed = 0; elapsed < 500 && strays.some(alive); elapsed += 10) await Bun.sleep(10);
  if (strays.length > 0) {
    console.error(
      `idle-wall: ended ${String(strays.length)} descendant(s) outside the group: ${strays.join(", ")}`,
    );
  }
  const survivors = strays.filter(alive);
  if (survivors.length > 0) console.error(`idle-wall: descendants survived SIGKILL: ${survivors.join(", ")}`);
}

/** The group under the wall right now, so an interrupt reaching the suite ends it too. */
let active: Bun.Subprocess | null = null;

/** One `bun test` process under the idle wall, relaying its output. Bun prints file headers
 *  relative to `cwd`, the request's working directory. */
async function runWalled(
  command: string[],
  temporaryRoot: string,
  idleSeconds: number,
  cwd: string,
): Promise<WalledRun> {
  // Its own process group, so the wall can end every descendant at once and a grandchild cannot
  // outlive the kill. An interrupt reaching the suite is forwarded to the group before exiting.
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
  const reported = new Set<string>();
  const failed = new Set<string>();
  let failures = 0,
    clockEnded = 0,
    errors = 0,
    awaitingNotice = false,
    peakLoad = hostLoad();
  let lastOutputAt = performance.now();
  let pending = "";
  let header: string | null = null;
  /** One output line: a file header, a result line under it, or the wall's own notice. */
  const scanLine = (line: string): void => {
    if (/^\S+\.(?:test|spec)\.[cm]?[jt]sx?:$/.test(line)) {
      header = fileIdentity(resolve(cwd, line.slice(0, -1)));
      awaitingNotice = false;
      return;
    }
    if (header === null || !/^\((?:pass|fail|skip|todo)\) /.test(line)) {
      if (awaitingNotice && TIMED_OUT_NOTICE.test(line)) {
        clockEnded++;
        awaitingNotice = false;
      } else if (UNHANDLED_ERROR.test(line)) errors++;
      return;
    }
    reported.add(header);
    awaitingNotice = false;
    if (!line.startsWith("(fail) ")) return;
    failed.add(header);
    failures++;
    // The result line reports the test's own duration, so a test that ran past the suite's wall
    // was ended by it whether or not the notice followed.
    const duration = /\[(\d+(?:\.\d+)?)ms\]$/.exec(line.trimEnd());
    if (duration !== null && Number(duration[1]) >= PER_TEST_WALL_MS) clockEnded++;
    else awaitingNotice = true;
  };
  const relay = async (
    source: ReadableStream<Uint8Array>,
    sink: typeof Bun.stdout,
    scan: boolean,
  ): Promise<void> => {
    const writer = sink.writer();
    for await (const chunk of source) {
      lastOutputAt = performance.now();
      await writer.write(chunk);
      await writer.flush();
      if (!scan) continue;
      // Bun prints "<path>:" on its own line, to stderr, then the file's results. With several
      // workers the whole block arrives when the file completes; a single worker streams it, so a
      // file counts as reported once a result line has followed its header.
      const lines = (pending + new TextDecoder().decode(chunk)).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) scanLine(line);
    }
    await writer.end();
  };
  let walled = false;
  const ticker = setInterval(() => {
    const busy = hostLoad();
    peakLoad = Math.max(peakLoad, busy);
    const wall = wallSeconds(idleSeconds, busy);
    if (walled || performance.now() - lastOutputAt < wall * 1000) return;
    walled = true;
    clearInterval(ticker);
    void (async () => {
      console.error(
        `idle-wall: no output for ${String(wall)} s at a load average of ${busy.toFixed(1)} on ${String(availableParallelism())} cores; ending the test group.`,
      );
      const descendants = await describeTree(child.pid);
      const reaped = await terminateAndReapProcessGroup(child);
      if (!reaped) console.error("idle-wall: some process in the group survived SIGKILL.");
      await killStrays(descendants);
    })().catch((cause: unknown) => {
      killProcessGroup(child, "SIGKILL");
      console.error("idle-wall: cleanup failed", cause);
    });
  }, 1000);
  await Promise.all([relay(child.stdout, Bun.stdout, false), relay(child.stderr, Bun.stderr, true)]);
  const exitCode = await child.exited;
  clearInterval(ticker);
  // Once the wall has fired, the group's own exit (137 after the kill) is not the verdict.
  return {
    exitCode: walled ? null : exitCode,
    reported,
    failed,
    inFlight: header,
    failures,
    clockEnded,
    errors,
    peakLoad,
  };
}

/** Every rule that decides whose verdict the suite reports, in one place and away from the
 *  spawning. They are all attribution rather than execution -- a clock decided rather than an
 *  assertion, the host was carrying more runnable work than it has cores twice over, too many
 *  files failed for a busy host to explain, a file printed no result at all -- so deciding them
 *  here costs a plain call where deciding them inside `main` cost a real sub-suite each. `cores`
 *  is a parameter so a test can state the host it is reasoning about. */
export function attribute(
  first: WalledRun,
  asked: readonly string[],
  cores: number = availableParallelism(),
): Attribution {
  const failed = [...first.failed];
  // An error Bun printed outside any test is in its exit code and in no result line, so nothing in
  // `failed` speaks for it and running those files again cannot unsay it: a clock-only or
  // crowded-host rerun would return zero and take the error with it.
  if (first.errors > 0) {
    return { rerun: null, exitCode: first.exitCode ?? 1, because: "unhandled-error", subject: [] };
  }
  if (first.exitCode === null) {
    // The wall ended the group. A failure it had already printed is the verdict: the rerun covers
    // the files the first process never finished, never the verdict of one it did.
    if (failed.length > 0) return { rerun: null, exitCode: 1, because: "already-failed", subject: failed };
    // The file printed last may be a streamed block the wall cut short, so it runs again too.
    const remaining = asked.filter((file) => !first.reported.has(file) || file === first.inFlight);
    if (remaining.length === 0 || remaining.length > RERUN_FILE_LIMIT) {
      return { rerun: null, exitCode: 1, because: "none-left", subject: remaining };
    }
    return { rerun: remaining, exitCode: 1, because: "never-finished", subject: remaining };
  }
  if (first.exitCode === 0 || first.failures === 0) {
    return { rerun: null, exitCode: first.exitCode, because: "stands", subject: [] };
  }
  // Two failures the branch did not cause: every one of them ended by a clock, and any of them on
  // a host carrying more work than the suite asked of it. Either way the machine decided.
  const because: Reason | null =
    first.clockEnded === first.failures ? "clock-only" : first.peakLoad > cores * 2 ? "crowded-host" : null;
  if (because === null) return { rerun: null, exitCode: first.exitCode, because: "stands", subject: [] };
  // A file Bun printed no result for did not fail an assertion or a clock: its module would not
  // load, or the process ended before it ran. Nothing in `failed` speaks for it, so rerunning
  // `failed` cannot clear the run.
  const unreported = asked.filter((file) => !first.reported.has(file));
  if (unreported.length > 0) {
    return { rerun: null, exitCode: first.exitCode, because: "unreported", subject: unreported };
  }
  if (failed.length > RERUN_FILE_LIMIT) {
    return { rerun: null, exitCode: first.exitCode, because: "too-many-failed", subject: failed };
  }
  return { rerun: failed, exitCode: first.exitCode, because, subject: failed };
}

export function rerunVerdict(again: WalledRun, rerun: readonly string[]): RerunVerdict {
  const silent = rerun.filter((file) => !again.reported.has(file));
  return { exitCode: silent.length > 0 ? 1 : (again.exitCode ?? 1), silent };
}

async function main(): Promise<number> {
  // Repository helpers inspect siblings around their temporary fixtures. Give them one fresh
  // parent under the host temp root without replacing TMPDIR: Darwin's compiler ignores TMPDIR,
  // while the isolation profiles use its original value to admit the real compiler scratch.
  const temporaryRoot = mkdtempSync(join(tmpdir(), "ana-test-suite-"));
  const idleSeconds = positiveInteger(
    "ANA_TEST_IDLE_SECONDS",
    Bun.env.ANA_TEST_IDLE_SECONDS,
    IDLE_WALL_SECONDS,
  );
  const requested = Bun.argv.slice(2);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    runtimeProcess.once(signal, () => {
      if (active !== null) killProcessGroup(active, signal);
      rmSync(temporaryRoot, { recursive: true, force: true });
      runtimeProcess.exit(130);
    });
  }
  const relative = (files: Iterable<string>) =>
    [...files]
      .map((file) => (file.startsWith(`${REPO_ROOT}/`) ? file.slice(REPO_ROOT.length + 1) : file))
      .join(" ");
  /** The files this invocation asked for, resolved the way the output scanner resolves a header.
   *  With no request that is every file Bun discovers under `test/`, which the suite keeps flat. */
  const askedFor = () =>
    requested.length === 0
      ? readdirSync(join(REPO_ROOT, "test"))
          .filter((name) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name))
          .map((name) => fileIdentity(join(REPO_ROOT, "test", name)))
      : requestedFiles(requested);
  try {
    const { cwd } = scanRequest(requested);
    const first = await runWalled(
      testCommand(requested, Bun.env.ANA_TEST_WORKERS),
      temporaryRoot,
      idleSeconds,
      cwd,
    );
    const asked = askedFor();
    const step = attribute(first, asked);
    if (step.because !== "stands") {
      // The ticker printed the wall it enforced and the load that set it; repeating the flat
      // value here would name a wall that may not be the one that fired.
      const silence = "the suite was ended by the idle wall";
      const machine =
        first.clockEnded === first.failures
          ? `${String(first.failures)} test(s) failed on time alone, none on an assertion`
          : `the host reached a load average of ${first.peakLoad.toFixed(1)} on ${String(availableParallelism())} cores while these ran`;
      const rerunning = `running their ${String(step.subject.length)} file(s) again in one fresh process: ${relative(step.subject)}`;
      // A Record, so a new reason cannot be added without a sentence that names its subject.
      const said: Record<Exclude<Reason, "stands">, string> = {
        "already-failed": `idle-wall: error: ${silence}; ${String(step.subject.length)} file(s) had already failed: ${relative(step.subject)}`,
        // Nothing reported, so the branch was not measured and a second identical push will not
        // measure it either. The override is the only lever that does not need this file read.
        "none-left": `idle-wall: error: ${silence} with ${String(step.subject.length)} of ${String(asked.length)} files unfinished; the suite learned nothing about this branch. Retry with fewer workers (ANA_TEST_WORKERS=4) or on a less loaded host.`,
        "never-finished": `idle-wall: ${String(step.subject.length)} of ${String(asked.length)} files were never finished; running them again in one fresh process: ${relative(step.subject)}`,
        unreported: `host-wall: error: ${machine}, but ${String(step.subject.length)} file(s) printed no result at all: ${relative(step.subject)}`,
        "too-many-failed": `host-wall: error: ${machine}, but ${String(step.subject.length)} files failed, which is more than a busy host explains: ${relative(step.subject)}`,
        "clock-only": `host-wall: ${machine}; ${rerunning}`,
        "crowded-host": `host-wall: ${machine}; ${rerunning}`,
        "unhandled-error": `host-wall: error: ${String(first.errors)} error(s) printed outside any test, which running any file again cannot clear.`,
      };
      console.error(said[step.because]);
    }
    if (step.rerun === null) return step.exitCode;
    // One fresh process without workers over those files, keeping the request's filters.
    const again = await runWalled(
      [runtimeProcess.execPath, "test", ...COMMON_FLAGS, ...requestWithoutFiles(requested), ...step.rerun],
      temporaryRoot,
      idleSeconds,
      cwd,
    );
    if (again.exitCode === null) {
      console.error("idle-wall: error: the rerun was ended by the idle wall named above.");
    }
    const verdict = rerunVerdict(again, step.rerun);
    if (verdict.silent.length > 0) {
      console.error(
        `host-wall: error: the rerun printed no result for ${String(verdict.silent.length)} of the ${String(step.rerun.length)} file(s) it was given: ${relative(verdict.silent)}`,
      );
    }
    return verdict.exitCode;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) runtimeProcess.exit(await main());
