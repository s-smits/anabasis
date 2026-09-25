/**
 * The one test command, and whose verdict the suite reports.
 *
 * Three questions, and the cost of answering each is why they are separated. What command does a
 * request become — pure, so it is read straight off `testCommand`. Given what one process printed,
 * whose verdict stands — pure since `attribute` was lifted out of `main`, where each of these rules
 * used to cost a real spawned sub-suite to settle. And does the wall actually fire and end a tree
 * that ignores SIGTERM — which nothing but a real wedged sub-suite can answer, so two cases pay for
 * it and the rest do not.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { availableParallelism, tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  type WalledRun,
  attribute,
  requestWithoutFiles,
  rerunVerdict,
  testCommand,
  wallSeconds,
  workerCount,
} from "../tools/runtime/test-suite.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
const A_TEST_TS = "a.test.ts";
const B_TEST_TS = "b.test.ts";

afterAll(cleanupScratch);

const REPO_ROOT = join(import.meta.dir, "..");

/** Poll `check` until it holds or `ms` passes. Two cases here wait on a real child's side effects
 *  and nothing else in the suite does, so it stays where it is used. */
async function until(check: () => boolean, ms: number): Promise<boolean> {
  for (const deadline = performance.now() + ms; performance.now() < deadline; ) {
    if (check()) return true;
    await Bun.sleep(50);
  }
  return check();
}

/** What one process printed. The default is a clean run; each case states only what it is about. */
function ran(overrides: Partial<WalledRun> = {}): WalledRun {
  return {
    exitCode: 0,
    reported: new Set(),
    failed: new Set(),
    interrupted: new Set(),
    incomplete: new Set(),
    inFlight: null,
    failures: 0,
    clockEnded: 0,
    errors: 0,
    peakLoad: 1,
    ...overrides,
  };
}

/** A file path as the suite resolves one: absolute, under the repository. */
const file = (name: string): string => join(REPO_ROOT, "test", name);

describe("the command a request becomes", () => {
  it("runs the whole tree in one process, ordered by the recorded timings, with two workers fewer than the free cores", () => {
    expect(testCommand([], undefined)).toEqual([
      Bun.argv[0]!,
      "test",
      `--parallel=${String(workerCount(undefined))}`,
      "--no-isolate",
      "--max-concurrency=4",
      "--timeout=60000",
      `--timings=${join(REPO_ROOT, "test/.test-timings.json")}`,
      "--update-timings",
      "test",
    ]);
  });

  it("keeps a focused request on the same flags, with the named files in place of the tree", () => {
    const focused = testCommand(["test/test-suite.test.ts"], undefined);
    expect(focused.slice(0, -1)).toEqual(testCommand([], undefined).slice(0, -1));
    expect(focused.at(-1)).toBe("test/test-suite.test.ts");
  });

  it("refuses a named file that does not exist rather than silently running its neighbours", () => {
    // Bun reads an unknown path as a name filter, so the run would pass having tested nothing.
    expect(() => testCommand(["test/no-such-file.test.ts"], undefined)).toThrow(
      "requested test file does not exist",
    );
  });

  it("subtracts half the load the host carries beyond its cores, and never goes below two", () => {
    // The two readings of 2026-09-17: a laptop that merely looks busy keeps its workers, and a
    // runner carrying four jobs of its own is not asked for three times itself.
    expect(workerCount(undefined, 0)).toBeGreaterThanOrEqual(2);
    expect(workerCount(undefined, 1000)).toBe(2);
    expect(workerCount("5", 1000)).toBe(5);
  });

  it("keeps the flat wall on a quiet host and widens it for load the suite did not create", () => {
    // A machine at or below its cores is busy rather than starved, and the suite's own workers
    // live there: two of them spinning on twelve cores is a load of two, so a real wedge still
    // ends on time. Above the cores the wall grows with the reading, and at twice them it is
    // twice the wall, which is where `attribute` already stops blaming the branch.
    expect(wallSeconds(180, 0, 12)).toBe(180);
    expect(wallSeconds(180, 2, 12)).toBe(180);
    expect(wallSeconds(180, 12, 12)).toBe(180);
    expect(wallSeconds(180, 24, 12)).toBe(360);
    // The push gate of 2026-09-20: two paid runs, 340 of 340 files unfinished at the flat wall.
    expect(wallSeconds(180, 30.9, 12)).toBe(463);
  });

  it("refuses a worker count that is not a positive integer", () => {
    expect(() => workerCount("0")).toThrow("ANA_TEST_WORKERS must be a positive integer");
    expect(() => workerCount("two")).toThrow("ANA_TEST_WORKERS must be a positive integer");
  });

  it("keeps the filters, flags and working directory a rerun needs, and drops only the files", () => {
    // `--cwd` given after a file still applies to it, and a flag's own operand is not a file.
    const request = ["-t", "a pattern", "test/one.test.ts", "--cwd", "packages/x", "test/two.test.ts"];
    expect(requestWithoutFiles(request)).toEqual(["-t", "a pattern", "--cwd", "packages/x"]);
  });

  it("treats a glob as a filter rather than a file, so it is neither checked nor dropped", () => {
    expect(requestWithoutFiles(["test/*.test.ts"])).toEqual(["test/*.test.ts"]);
  });
});

describe("whose verdict the suite reports", () => {
  it("takes a passing first process without a word", () => {
    expect(attribute(ran(), [])).toMatchObject({ rerun: null, exitCode: 0, because: "stands" });
  });

  it("takes a failure on a quiet host: the first process printed it and a rerun cannot revise it", () => {
    const first = ran({
      exitCode: 1,
      failures: 2,
      clockEnded: 1,
      failed: new Set([file(A_TEST_TS)]),
      reported: new Set([file(A_TEST_TS)]),
    });
    expect(attribute(first, [file(A_TEST_TS)], 8)).toMatchObject({
      rerun: null,
      exitCode: 1,
      because: "stands",
    });
  });

  it("runs the failed files again when a clock ended every one of them and no assertion did", () => {
    const failed = new Set([file(A_TEST_TS)]);
    const first = ran({ exitCode: 1, failures: 2, clockEnded: 2, failed, reported: failed });
    expect(attribute(first, [file(A_TEST_TS)], 8)).toMatchObject({
      rerun: [file(A_TEST_TS)],
      because: "clock-only",
    });
  });

  it("runs them again when the host passed twice its cores in load while they ran", () => {
    const failed = new Set([file(A_TEST_TS)]);
    const first = ran({ exitCode: 1, failures: 2, clockEnded: 1, failed, reported: failed, peakLoad: 28.9 });
    expect(attribute(first, [file(A_TEST_TS)], 8)).toMatchObject({
      rerun: [file(A_TEST_TS)],
      because: "crowded-host",
    });
    // The same run on a machine those 28.9 do not oversubscribe is an ordinary failure.
    expect(attribute(first, [file(A_TEST_TS)], 64)).toMatchObject({ rerun: null, because: "stands" });
  });

  it("keeps the first verdict when a file printed no result at all, whatever the host was doing", () => {
    // Its module would not load, or the process ended before it ran. Nothing in `failed` speaks
    // for it, so rerunning `failed` could clear a run that was never attempted.
    const failed = new Set([file(A_TEST_TS)]);
    const first = ran({ exitCode: 1, failures: 1, clockEnded: 1, failed, reported: failed });
    expect(attribute(first, [file(A_TEST_TS), file("silent.test.ts")], 8)).toMatchObject({
      rerun: null,
      exitCode: 1,
      because: "unreported",
      subject: [file("silent.test.ts")],
    });
  });

  it("keeps the first verdict when an error was printed outside any test", () => {
    // A module that would not load, a stray throw between tests: Bun counts it in its exit code and
    // prints no result line for it, so nothing in `failed` speaks for it and a rerun of `failed`
    // would return zero with the error unexplained and unrepeated.
    const failed = new Set([file("a.test.ts")]);
    const clockOnly = { exitCode: 1, failures: 2, clockEnded: 2, failed, reported: failed };
    expect(attribute(ran({ ...clockOnly, errors: 1 }), [file("a.test.ts")], 8)).toMatchObject({
      rerun: null,
      exitCode: 1,
      because: "unhandled-error",
    });
    // Without it the same run is the ordinary clock-only rerun, so the error is what decided.
    expect(attribute(ran(clockOnly), [file("a.test.ts")], 8)).toMatchObject({
      rerun: [file("a.test.ts")],
      because: "clock-only",
    });
  });

  it("keeps it after a wall as well: rerunning the unfinished files cannot unsay a printed error", () => {
    const first = ran({ exitCode: null, errors: 1, reported: new Set([file("a.test.ts")]) });
    expect(attribute(first, [file("a.test.ts"), file(B_TEST_TS)], 8)).toMatchObject({
      rerun: null,
      exitCode: 1,
      because: "unhandled-error",
    });
  });

  it("keeps the first verdict when more files failed than a busy host explains", () => {
    const names = Array.from({ length: 9 }, (_, index) => file(`f${String(index)}.test.ts`));
    const failed = new Set(names);
    const first = ran({ exitCode: 1, failures: 9, clockEnded: 9, failed, reported: failed });
    expect(attribute(first, names, 8)).toMatchObject({
      rerun: null,
      exitCode: 1,
      because: "too-many-failed",
    });
    // One fewer is a tail a busy host explains, and those files run again.
    const fewer = names.slice(1);
    expect(
      attribute(
        ran({ exitCode: 1, failures: 8, clockEnded: 8, failed: new Set(fewer), reported: new Set(fewer) }),
        fewer,
        8,
      ),
    ).toMatchObject({ rerun: fewer, because: "clock-only" });
  });

  it("runs the files a wall left unfinished again, including the one whose block it cut short", () => {
    const first = ran({
      exitCode: null,
      reported: new Set([file(A_TEST_TS), file(B_TEST_TS)]),
      inFlight: file(B_TEST_TS),
    });
    expect(attribute(first, [file(A_TEST_TS), file(B_TEST_TS), file("c.test.ts")], 8)).toMatchObject({
      rerun: [file(B_TEST_TS), file("c.test.ts")],
      because: "never-finished",
    });
  });

  it("keeps a failure printed before the wall: a passing rerun of the wedged file cannot clear it", () => {
    const first = ran({
      exitCode: null,
      failures: 2,
      clockEnded: 1,
      failed: new Set([file(A_TEST_TS)]),
      reported: new Set([file(A_TEST_TS)]),
    });
    expect(attribute(first, [file(A_TEST_TS), file(B_TEST_TS)], 8)).toMatchObject({
      rerun: null,
      exitCode: 1,
      because: "already-failed",
    });
  });

  it("runs a failure a clock ended before the wall again, beside the files the wall left", () => {
    // A timeout is the machine's verdict whether or not a wall follows it.
    const first = ran({
      exitCode: null,
      failures: 1,
      clockEnded: 1,
      failed: new Set([file(A_TEST_TS)]),
      reported: new Set([file(A_TEST_TS)]),
    });
    expect(attribute(first, [file(A_TEST_TS), file(B_TEST_TS)], 8)).toMatchObject({
      rerun: [file(A_TEST_TS), file(B_TEST_TS)],
      because: "never-finished",
    });
    // More timed-out files than a busy host explains stand, as they do without a wall.
    const many = Array.from({ length: 9 }, (_, index) => file(`t${String(index)}.test.ts`));
    const timedOut = ran({
      exitCode: null,
      failures: 9,
      clockEnded: 9,
      failed: new Set(many),
      reported: new Set(many),
    });
    expect(attribute(timedOut, many, 8)).toMatchObject({ rerun: null, because: "already-failed" });
  });

  it("runs every file a wall left unfinished again, however many, as Bun's own runner does", () => {
    // Two wedged workers strand the whole queue behind them, which says nothing about those files.
    const many = Array.from({ length: 12 }, (_, index) => file(`f${String(index)}.test.ts`));
    expect(attribute(ran({ exitCode: null }), many, 8)).toMatchObject({
      rerun: many,
      exitCode: 1,
      because: "never-finished",
    });
  });

  it("runs the files Bun's interrupt report named again, including any the request never listed", () => {
    // A request naming a directory lists no file, so only the report can say what went unrun.
    const first = ran({
      exitCode: null,
      interrupted: new Set([file("x.test.ts")]),
      incomplete: new Set([file("y.test.ts")]),
    });
    expect(attribute(first, [], 8)).toMatchObject({
      rerun: [file("x.test.ts"), file("y.test.ts")],
      because: "never-finished",
    });
    // A file both unreported and named in the report runs once.
    expect(attribute(first, [file("x.test.ts")], 8)).toMatchObject({
      rerun: [file("x.test.ts"), file("y.test.ts")],
    });
  });

  it("fails a wall that left nothing it can name unfinished", () => {
    const every = [file(A_TEST_TS), file(B_TEST_TS)];
    expect(attribute(ran({ exitCode: null, reported: new Set(every) }), every, 8)).toMatchObject({
      rerun: null,
      exitCode: 1,
      because: "none-left",
    });
  });
});

describe("whose verdict a rerun gives", () => {
  const given = [file("a.test.ts"), file(B_TEST_TS)];

  it("takes a rerun that reported every file it was given", () => {
    expect(rerunVerdict(ran({ reported: new Set(given) }), given)).toMatchObject({ exitCode: 0, silent: [] });
    expect(rerunVerdict(ran({ exitCode: 1, reported: new Set(given) }), given)).toMatchObject({
      exitCode: 1,
    });
  });

  it("refuses a zero from a rerun that printed no result for a file it was given", () => {
    // That file was silent in the first process -- which is why it is in the rerun -- and silent
    // again here, so no process tested it and its pass would be the wrapper's own invention.
    expect(rerunVerdict(ran({ reported: new Set([file("a.test.ts")]) }), given)).toMatchObject({
      exitCode: 1,
      silent: [file(B_TEST_TS)],
    });
  });

  it("fails a rerun the wall ended", () => {
    expect(rerunVerdict(ran({ exitCode: null, reported: new Set(given) }), given)).toMatchObject({
      exitCode: 1,
    });
  });
});

describe("the wall itself", () => {
  const SUITE = join(REPO_ROOT, "tools/runtime/test-suite.ts");

  /** A tree holding one test file that never returns, with `body` inside it. */
  function wedged(body: string) {
    const host = scratchDir("ana-suite-wall-");
    const fixture = join(host, "fixture", "silent.test.ts");
    mkdirSync(join(host, "fixture"));
    writeFileSync(
      fixture,
      `import { it } from "bun:test";\nit("stays silent", async () => {\n${body}\n  await Bun.sleep(600_000);\n}, 900_000);\n`,
    );
    return { host, fixture };
  }

  /** The suite over one fixture, with a three-second wall, one worker and a stated host load.
   *  The load is stated rather than read because the wall is proportional to it: on a machine
   *  carrying a paid run these cases would otherwise wait two and a half times as long for the
   *  same assertion, and the number in the sentence would be whatever the minute happened to be. */
  const suiteOver = (host: string, fixture: string, load = "0") =>
    Bun.spawn(["bun", SUITE, fixture], {
      cwd: REPO_ROOT,
      env: {
        ...Bun.env,
        TMPDIR: host,
        ANA_TEST_TMPDIR: host,
        ANA_TEST_WORKERS: "1",
        ANA_TEST_IDLE_SECONDS: "3",
        ANA_TEST_HOST_LOAD: load,
      },
      stdout: "ignore",
      stderr: "pipe",
    });

  it("ends a silent group whose members ignore SIGTERM, names them, and removes the temporary root", async () => {
    // Two grandchildren that refuse SIGTERM, one of them in its own session as a Bubblewrap
    // verifier is, so the group kill cannot reach it and it must be ended by pid. The test refuses
    // SIGTERM as well, so the wall's interrupt goes unanswered and the group kill follows only
    // after the whole grace -- once for the first process and once for the rerun, hence the time.
    const pidFile = join(tmpdir(), `ana-wall-pids-${String(runtimeProcess.pid)}`);
    const { host, fixture } = wedged(`  process.on("SIGTERM", () => {});
  const sleeper = ["bun", "-e", 'process.on("SIGTERM", () => {}); await Bun.sleep(600000);'];
  const grandchild = Bun.spawn(sleeper, { stdout: "inherit", stderr: "inherit" });
  const stray = Bun.spawn(sleeper, { stdout: "ignore", stderr: "ignore", detached: true });
  await Bun.write(${JSON.stringify(pidFile)}, [grandchild.pid, stray.pid].join(" "));`);
    const run = suiteOver(host, fixture);
    try {
      const rootOf = () => readdirSync(host).find((name) => name.startsWith("ana-test-suite-"));
      // Both pids, not merely the file: `Bun.write` is not atomic, and a zero-byte read parses as
      // the pid 0, which matched nothing in the report (gate 2026-09-19T04:02Z).
      const pidsOf = (): number[] =>
        (existsSync(pidFile) ? readFileSync(pidFile, "utf8") : "")
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter((pid) => pid > 0);
      expect(await until(() => rootOf() !== undefined && pidsOf().length === 2, 15_000)).toBe(true);
      const root = join(host, rootOf()!);
      const pids = pidsOf();
      const [code, err] = await Promise.all([run.exited, new Response(run.stderr).text()]);

      expect(code).toBe(1);
      expect(err).toContain("idle-wall: no output for 3 s at a load average of 0.0 on");
      // The report names the tree it ended, with each descendant's pid and command line.
      expect(err).toContain("idle-wall: descendants when the wall fired");
      expect(err).toMatch(new RegExp(`^\\s*${String(pids[0]!)}\\s+[\\d.]+\\s+\\S*bun -e`, "m"));
      expect(() => runtimeProcess.kill(pids[0]!, 0)).toThrow("ESRCH");
      // The one outside the group is ended by pid, and said to be.
      expect(err).toMatch(
        new RegExp(`idle-wall: ended 1 descendant\\(s\\) outside the group: ${String(pids[1]!)}$`, "m"),
      );
      expect(() => runtimeProcess.kill(pids[1]!, 0)).toThrow("ESRCH");
      expect(existsSync(root)).toBe(false);
    } finally {
      run.kill();
    }
  }, 90_000);

  it("waits proportionally longer for the same silence when the host is carrying twice its cores", async () => {
    // The gate of 2026-09-20: a flat wall ended a push after 180 s with no file reported, one
    // worker at 99% CPU and two paid runs holding the machine. Starved is not wedged, so the
    // same fixture that ends at three seconds on a quiet host gets six on a host at twice its
    // cores -- and the elapsed time proves the wall moved, not only the sentence.
    const { host, fixture } = wedged("");
    const run = suiteOver(host, fixture, String(availableParallelism() * 2));
    const started = performance.now();
    try {
      const err = await new Response(run.stderr).text();
      await run.exited;
      expect(err).toMatch(/idle-wall: no output for 6 s at a load average of [\d.]+ on \d+ cores/u);
      expect(performance.now() - started).toBeGreaterThan(5_000);
    } finally {
      run.kill();
    }
  }, 60_000);

  it("runs a wedged file again in a fresh process, keeping the request's filter, and takes that verdict", async () => {
    // The tail wedge: the group goes silent with one file unfinished. That file passes on its own,
    // so the rerun's verdict replaces what would otherwise have been the wall's failure. The rerun
    // keeps the `-t` filter: without it the second test runs and throws.
    const host = scratchDir("ana-suite-rerun-");
    const fixture = join(host, "fixture", "tail.test.ts"),
      marker = join(host, "first-run");
    mkdirSync(join(host, "fixture"));
    writeFileSync(
      fixture,
      `import { it } from "bun:test";
it("passes once the first process has wedged", async () => {
  if (await Bun.file(${JSON.stringify(marker)}).exists()) return;
  await Bun.write(${JSON.stringify(marker)}, "wedged");
  await Bun.sleep(600_000);
}, 900_000);
it("excluded by the filter", () => { throw new Error("the rerun dropped the request's filter"); });
`,
    );
    const run = Bun.spawn(["bun", SUITE, "-t", "passes once", fixture], {
      cwd: REPO_ROOT,
      env: {
        ...Bun.env,
        TMPDIR: host,
        ANA_TEST_TMPDIR: host,
        ANA_TEST_WORKERS: "1",
        ANA_TEST_IDLE_SECONDS: "3",
        ANA_TEST_HOST_LOAD: "0",
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const [code, err] = await Promise.all([run.exited, new Response(run.stderr).text()]);
      // One worker runs inside the coordinator, which prints no interrupt report, so the file counts
      // as unfinished rather than interrupted: it printed no result, and that alone brings it back.
      expect(err).toContain(
        "idle-wall: retrying 0 interrupted and 1 unfinished file(s) one at a time in one fresh process",
      );
      expect(err).toContain("1 pass");
      expect(err).not.toContain("dropped the request's filter");
      expect(code).toBe(0);
    } finally {
      run.kill("SIGKILL");
    }
  }, 60_000);

  it("interrupts a run whose every worker has wedged, and runs all it left unfinished again", async () => {
    // With two workers, two wedges leave nothing to drain the queue, and every file behind them is
    // stranded: more of them here than any cap on a tail would take. SIGTERM lets the coordinator
    // say which files it was running and which it had not started, and all of them pass alone.
    const host = scratchDir("ana-suite-workers-");
    const fixture = join(host, "fixture");
    mkdirSync(fixture);
    for (const name of ["a", "c"]) {
      const marker = join(host, `first-run-${name}`);
      writeFileSync(
        join(fixture, `${name}-wedge.test.ts`),
        `import { it } from "bun:test";
it("passes once its worker has wedged", async () => {
  if (await Bun.file(${JSON.stringify(marker)}).exists()) return;
  await Bun.write(${JSON.stringify(marker)}, "wedged");
  await Bun.sleep(600_000);
}, 900_000);
`,
      );
    }
    const quick = ["b", "d"].flatMap((group) =>
      Array.from({ length: 5 }, (_, index) => `${group}${String(index)}`),
    );
    for (const name of quick) {
      writeFileSync(
        join(fixture, `${name}.test.ts`),
        `import { it } from "bun:test";
it("passes", () => {});
`,
      );
    }
    // Named one by one, as the gate's own request resolves to files: a directory is a filter, and a
    // rerun keeping it would run the whole directory again.
    const files = ["a-wedge", "c-wedge", ...quick].map((name) => join(fixture, `${name}.test.ts`));
    const run = Bun.spawn(["bun", SUITE, ...files], {
      cwd: REPO_ROOT,
      env: {
        ...Bun.env,
        TMPDIR: host,
        ANA_TEST_TMPDIR: host,
        ANA_TEST_WORKERS: "2",
        ANA_TEST_IDLE_SECONDS: "3",
        ANA_TEST_HOST_LOAD: "0",
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const [code, err] = await Promise.all([run.exited, new Response(run.stderr).text()]);
      expect(err).toContain("cores; interrupting the test run.");
      expect(err).toContain("Interrupted while still running:");
      // Bun gives each worker six files in a row, a wedge first, so both wedges hold their workers
      // from the start and the ten quick files behind them never start: more than the eight a tail
      // was once capped at.
      const rerun = err.split("\n").find((line) => line.startsWith("idle-wall: retrying "));
      expect(rerun).toStartWith(
        "idle-wall: retrying 2 interrupted and 10 unfinished file(s) one at a time in one fresh process: ",
      );
      expect(rerun).toContain("a-wedge.test.ts");
      expect(rerun).toContain("c-wedge.test.ts");
      expect(code).toBe(0);
    } finally {
      run.kill("SIGKILL");
    }
  }, 60_000);

  it("runs a file a clock failed again when launched by an agent or CI, which change Bun's output", async () => {
    // Bun prints no `(pass)` line when `CLAUDECODE`, `AGENT` or `REPL_ID` is set, and under
    // `GITHUB_ACTIONS` it heads each file with `::group::` and reports a failure as an annotation.
    // The suite counts a file as reported only from its plain result lines, so inherited from an
    // agent's shell or a CI runner, every file read as unreported and the clock-only rerun never
    // ran. The baseline strips these variables from this process, so the case sets them again.
    const host = scratchDir("ana-suite-parallel-");
    const fixture = join(host, "fixture"),
      marker = join(host, "first-run");
    mkdirSync(fixture);
    writeFileSync(
      join(fixture, "clock.test.ts"),
      `import { it } from "bun:test";
it("times out once, then passes", async () => {
  if (await Bun.file(${JSON.stringify(marker)}).exists()) return;
  await Bun.write(${JSON.stringify(marker)}, "timed out");
  await Bun.sleep(5_000);
}, 300);
`,
    );
    writeFileSync(join(fixture, "fine.test.ts"), `import { it } from "bun:test";\nit("passes", () => {});\n`);
    const run = Bun.spawn(["bun", SUITE, join(fixture, "clock.test.ts"), join(fixture, "fine.test.ts")], {
      cwd: REPO_ROOT,
      env: {
        ...Bun.env,
        TMPDIR: host,
        ANA_TEST_TMPDIR: host,
        ANA_TEST_WORKERS: "2",
        ANA_TEST_HOST_LOAD: "0",
        CLAUDECODE: "1",
        AGENT: "1",
        REPL_ID: "1",
        GITHUB_ACTIONS: "true",
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const [code, err] = await Promise.all([run.exited, new Response(run.stderr).text()]);
      expect(err).toContain("failed on time alone, none on an assertion; running their 1 file(s) again");
      expect(err).not.toContain("printed no result at all");
      expect(code).toBe(0);
    } finally {
      run.kill("SIGKILL");
    }
  }, 60_000);

  it("fails a rerun that printed no result for a file it was given, rather than taking its zero", async () => {
    // The rerun is the one process whose verdict becomes the suite's, and it was taken unread. One
    // file wedges the first process and passes alone; the other prints nothing in either process,
    // so returning the rerun's zero would report a green suite over a file that never ran.
    const host = scratchDir("ana-suite-silent-");
    const fixture = join(host, "fixture"),
      marker = join(host, "first-run");
    mkdirSync(fixture);
    writeFileSync(
      join(fixture, "tail.test.ts"),
      `import { it } from "bun:test";
it("passes once the first process has wedged", async () => {
  if (await Bun.file(${JSON.stringify(marker)}).exists()) return;
  await Bun.write(${JSON.stringify(marker)}, "wedged");
  await Bun.sleep(600_000);
}, 900_000);
`,
    );
    // Bun loads this one and prints neither a header nor a result: it declares no test at all.
    writeFileSync(join(fixture, "quiet.test.ts"), "export {};\n");
    const run = Bun.spawn(["bun", SUITE, join(fixture, "tail.test.ts"), join(fixture, "quiet.test.ts")], {
      cwd: REPO_ROOT,
      env: {
        ...Bun.env,
        TMPDIR: host,
        ANA_TEST_TMPDIR: host,
        ANA_TEST_WORKERS: "1",
        ANA_TEST_IDLE_SECONDS: "3",
        ANA_TEST_HOST_LOAD: "0",
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const [code, err] = await Promise.all([run.exited, new Response(run.stderr).text()]);
      expect(err).toContain("the rerun printed no result for 1 of the 2 file(s) it was given");
      expect(err).toContain("quiet.test.ts");
      expect(code).toBe(1);
    } finally {
      run.kill("SIGKILL");
    }
  }, 60_000);
});
