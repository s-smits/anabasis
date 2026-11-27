import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { availableParallelism, tmpdir } from "#src/meta/os.ts";
import { dirname, isAbsolute, join, relative } from "#src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import { NO_VERDICT, type Place, placeEnv } from "#tools/runs/host-config.ts";
import { PER_TEST_WALL_MS } from "#tools/runtime/test-suite.ts";

export type VerdictMap = Record<string, boolean | null>;

export function mergeWaveRow(
  names: readonly string[],
  raw: Readonly<VerdictMap>,
  mode: "stop-at-kill" | "all",
) {
  const out = new Map<string, boolean | null>();
  let killed = false;
  for (const name of names) {
    if (name in raw) {
      const value = raw[name] ?? null;
      out.set(name, value);
      if (value === true) killed = true;
    } else {
      out.set(name, mode === "stop-at-kill" && killed ? null : false);
    }
  }
  return Object.fromEntries(out);
}

export function buildPlans<T extends { readonly mutant: FastMutant }>(
  items: readonly T[],
  waveSuites: (item: T) => readonly string[],
  uncovered: ReadonlyMap<string, Map<string, Set<number>>> | null,
): { readonly plans: BatchPlan[]; readonly skipped: Map<string, VerdictMap> } {
  const plans: BatchPlan[] = [];
  const skipped = new Map<string, VerdictMap>();
  for (const item of items) {
    const names = waveSuites(item);
    const active =
      uncovered === null
        ? names
        : names.filter((name) => uncovered.get(name)?.get(item.mutant.file)?.has(item.mutant.line) !== true);
    if (active.length === 0) {
      skipped.set(item.mutant.id, Object.fromEntries(names.map((name) => [name, false] as const)));
    } else {
      plans.push({ mutant: item.mutant, active });
    }
  }
  return { plans, skipped };
}

export const BATCH_FILE = "test/.ana-mutate-batch.test.ts";
export const BATCH_MARKER = "__ANA_MUTANT_ROW__";
export const QUALIFY_OK_MARKER = "__ANA_QUALIFY_OK__";
export const QUALIFY_FAIL_MARKER = "__ANA_QUALIFY_FAIL__";
export const VERDICT_RE = /\n *\d+ (pass|fail)|\nBailed out after \d+ failures?/;

export interface FastMutant {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface BatchPlan {
  readonly mutant: FastMutant;
  readonly active: readonly string[];
}

export interface FastWorker {
  readonly place: Place;
  readonly clone: string;
  readonly local: boolean;
}

export interface CoverageResult {
  readonly uncovered: Map<string, Map<string, Set<number>>>;
  readonly passed: Set<string>;
  readonly durations: Map<string, number>;
}

export interface CoverageHandle {
  readonly readyNames: () => ReadonlySet<string>;
  readonly waitFor: (names: readonly string[], files: readonly string[]) => Promise<CoverageResult>;
  readonly cancelExcept: (keep: ReadonlySet<string>) => void;
  readonly cancelAll: () => Promise<void>;
}

export async function cloneTree(root: string, dest: string): Promise<void> {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(root).filter(
    (name) => name !== "node_modules" && !name.startsWith(".ana-wall-probe-"),
  );
  if (runtimeProcess.platform === "darwin" && entries.length > 0) {
    const cow = Bun.spawn(["cp", "-cRp", ...entries.map((name) => join(root, name)), dest], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await cow.exited) === 0) return;
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
  }
  for (const name of entries) {
    cpSync(join(root, name), join(dest, name), { recursive: true, force: true });
  }
}

const TARGET_BATCH_MS = 60_000;
const MAX_FAST_BATCH = 64;

export type ActiveProc = Parameters<typeof killProcessGroup>[0];

export function cancelProcs(procs: ReadonlySet<ActiveProc>, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
  for (const proc of procs) killProcessGroup(proc, signal);
}

async function settleProcs(procs: ReadonlySet<ActiveProc>, graceMs: number): Promise<void> {
  if (procs.size === 0) return;
  cancelProcs(procs, "SIGTERM");
  const until = Date.now() + graceMs;
  while (procs.size > 0 && Date.now() < until) await Bun.sleep(20);
  if (procs.size > 0) cancelProcs(procs, "SIGKILL");
}

export interface PoolTask {
  readonly key: string;
  readonly plan: BatchPlan;
  readonly weightMs: number;
  readonly priority: number;
}

function pullRemoteBatch(pending: PoolTask[], cap: number, doneQualify: ReadonlySet<string>): PoolTask[] {
  if (pending.length === 0) return [];
  const groups = new Map<string, { weight: number; count: number; maxItem: number }>();
  for (const task of pending) {
    const key = task.plan.active[0] ?? "";
    const cur = groups.get(key) ?? { weight: 0, count: 0, maxItem: 0 };
    cur.weight += task.weightMs;
    cur.count += 1;
    cur.maxItem = Math.max(cur.maxItem, task.weightMs);
    groups.set(key, cur);
  }
  let chosen = "";
  let bestScore = -1;
  for (const [key, info] of groups) {
    if (info.maxItem < 250 && bestScore > 0) continue;
    const score = info.weight * (doneQualify.has(key) ? 1.5 : 1);
    if (score > bestScore) {
      bestScore = score;
      chosen = key;
    }
  }
  const groupCount = groups.get(chosen)?.count ?? 1;
  const maxItems = Math.min(Math.max(cap, MAX_FAST_BATCH), Math.max(8, Math.ceil(groupCount / 2)));
  const batch: PoolTask[] = [];
  let totalMs = 0;
  for (let i = 0; i < pending.length && batch.length < maxItems && totalMs < TARGET_BATCH_MS; ) {
    const candidate = pending[i];
    if (candidate !== undefined && (candidate.plan.active[0] ?? "") === chosen) {
      batch.push(candidate);
      totalMs += candidate.weightMs;
      pending.splice(i, 1);
    } else {
      i += 1;
    }
  }
  return batch;
}

export async function runContinuousPool(opts: {
  readonly activeWorkers: readonly FastWorker[];
  readonly isAway: (seat: FastWorker) => boolean;
  readonly initial: readonly PoolTask[];
  readonly suites: ReadonlyMap<string, readonly string[]>;
  readonly batchCap: number;
  readonly stopAtKill: boolean;
  readonly seconds: number;
  readonly deadline: number;
  readonly qualifyLocal: (seat: FastWorker) => Promise<string | null>;
  readonly runLocal: (
    seat: FastWorker,
    plan: BatchPlan,
  ) => Promise<Record<string, boolean | null> | "elsewhere">;
  readonly remoteQualified: Map<string, Set<string>>;
  readonly isDone: () => boolean;
  readonly hasWaiting: () => boolean;
  readonly onResult: (task: PoolTask, killed: Record<string, boolean | null>) => void;
  readonly enqueueRef: { push: (task: PoolTask) => void };
}): Promise<{ readonly refused: readonly string[] }> {
  const { activeWorkers, suites, batchCap, stopAtKill, seconds, deadline } = opts;
  const pending: PoolTask[] = [...opts.initial].toSorted(
    (a, b) => b.priority - a.priority || b.weightMs - a.weightMs,
  );
  const doneKeys = new Set<string>();
  const inFlight = new Map<string, PoolTask>();
  const hedged = new Set<string>();
  const retired = new Set<Place>();
  const refused = new Map<Place, string>();
  const activeProcs = new Set<ActiveProc>();
  const insertTask = (task: PoolTask) => {
    const at = pending.findIndex(
      (one) =>
        one.priority < task.priority || (one.priority === task.priority && one.weightMs < task.weightMs),
    );
    pending.splice(at === -1 ? pending.length : at, 0, task);
  };
  opts.enqueueRef.push = insertTask;
  const firstLocal = activeWorkers.find((seat) => !opts.isAway(seat));
  if (firstLocal !== undefined) {
    const why = await opts.qualifyLocal(firstLocal);
    if (why !== null) {
      retired.add(firstLocal.place);
      refused.set(firstLocal.place, why);
    }
  }
  const doneAll = () => opts.isDone() || Date.now() >= deadline;
  const poolWorkers = [
    ...activeWorkers.filter((seat) => !opts.isAway(seat)),
    ...new Map(
      activeWorkers.filter(opts.isAway).map((seat) => [seat.place.remote ?? "remote", seat] as const),
    ).values(),
  ];
  let resolveDone: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const stats = new Map<string, number>();
  const bump = (host: string) => stats.set(host, (stats.get(host) ?? 0) + 1);
  const finishTask = (task: PoolTask, killed: Record<string, boolean | null>, host: string) => {
    if (doneKeys.has(task.key)) return;
    doneKeys.add(task.key);
    inFlight.delete(task.key);
    bump(host);
    opts.onResult(task, killed);
    if (opts.isDone()) resolveDone?.();
  };
  const takeHedge = (): PoolTask | undefined => {
    for (const [key, task] of inFlight) {
      if (doneKeys.has(key) || hedged.has(key)) continue;
      hedged.add(key);
      return task;
    }
    return undefined;
  };
  const runLocalSeat = async (seat: FastWorker): Promise<void> => {
    while (!doneAll() && !retired.has(seat.place)) {
      const task = pending.shift() ?? takeHedge();
      if (task === undefined) {
        if (inFlight.size === 0 && !opts.hasWaiting()) return;
        await Bun.sleep(25);
        continue;
      }
      if (doneKeys.has(task.key)) continue;
      const killed = await opts.runLocal(seat, task.plan);
      if (killed === "elsewhere") {
        retired.add(seat.place);
        if (!doneKeys.has(task.key)) pending.unshift(task);
        return;
      }
      finishTask(task, killed, "here");
    }
  };
  const runRemoteSeat = async (seat: FastWorker): Promise<void> => {
    while (!doneAll() && !retired.has(seat.place)) {
      const hostKey = seat.place.remote ?? "remote";
      const doneQualify = opts.remoteQualified.get(hostKey) ?? new Set<string>();
      const batch = pullRemoteBatch(pending, batchCap, doneQualify);
      if (batch.length === 0) {
        if (inFlight.size === 0 && !opts.hasWaiting()) return;
        await Bun.sleep(40);
        continue;
      }
      const byMutantId = new Map(batch.map((task) => [task.plan.mutant.id, task] as const));
      for (const task of batch) inFlight.set(task.key, task);
      const needQualify = [...new Set(batch.flatMap((task) => task.plan.active))].filter(
        (name) => !doneQualify.has(name),
      );
      const got = await runBatch(
        seat,
        "remote",
        batch.map((task) => task.plan),
        suites,
        {
          qualifySuites: needQualify,
          stopAtKill,
          seconds,
          deadline,
          activeProcs,
          onRow: (row) => {
            const task = byMutantId.get(row.id);
            if (task !== undefined) finishTask(task, row.killed, hostKey);
          },
        },
      );
      for (const row of got.rows) {
        const task = byMutantId.get(row.id);
        if (task !== undefined) finishTask(task, row.killed, hostKey);
      }
      const missing = batch.filter((task) => !doneKeys.has(task.key));
      for (const task of missing) inFlight.delete(task.key);
      if (doneAll()) return;
      if (got.refused !== null) {
        retired.add(seat.place);
        refused.set(seat.place, got.refused);
        pending.unshift(...missing);
        return;
      }
      if (got.qualified) {
        for (const name of needQualify) doneQualify.add(name);
        opts.remoteQualified.set(hostKey, doneQualify);
      }
      if (got.dropped || missing.length > 0) {
        retired.add(seat.place);
        console.error(`${hostKey} gave no verdict, so takes no more mutants`);
        pending.unshift(...missing);
        return;
      }
    }
  };
  const allWorkersDone = Promise.all(
    poolWorkers.map((seat) => (opts.isAway(seat) ? runRemoteSeat(seat) : runLocalSeat(seat))),
  );
  await Promise.race([allWorkersDone, finished]);
  await settleProcs(activeProcs, 200);
  await Promise.race([allWorkersDone, Bun.sleep(150)]);
  if (runtimeProcess.env.ANA_MUTATE_STATS === "1") {
    const line = [...stats.entries()].map(([host, n]) => `${host}=${String(n)}`).join(" ");
    console.error(`mutate stats: ${line}`);
  }
  return { refused: [...refused.values()] };
}

export function linkModules(root: string, clone: string, placement: "local" | "remote"): void {
  const rootModules = join(root, "node_modules");
  const cloneModules = join(clone, "node_modules");
  if (placement === "local" && existsSync(rootModules) && !existsSync(cloneModules)) {
    symlinkSync(rootModules, cloneModules);
  }
  if (placement === "remote" && existsSync(cloneModules)) {
    rmSync(cloneModules, { recursive: true, force: true });
  }
}

function parseUncovered(root: string, lcov: string, targets: ReadonlySet<string>): Map<string, Set<number>> {
  const zero = new Map<string, Set<number>>();
  let current: string | null = null;
  for (const row of lcov.split("\n")) {
    if (row.startsWith("SF:")) {
      const raw = row.slice(3).trim();
      const norm = isAbsolute(raw) ? relative(root, raw) : raw;
      current = targets.has(norm) ? norm : null;
    } else if (current !== null && row.startsWith("DA:")) {
      const [lineNo = "", hits = ""] = row.slice(3).split(",");
      if (hits === "0") {
        const set = zero.get(current) ?? new Set<number>();
        set.add(Number(lineNo));
        zero.set(current, set);
      }
    } else if (row === "end_of_record") {
      current = null;
    }
  }
  return zero;
}

interface SuiteCov {
  readonly passed: boolean;
  readonly lcov: string | null;
  readonly durationMs: number;
}

const cacheKey = (name: string) => name.replaceAll(/[^A-Za-z0-9._-]/gu, "_");

async function measureSuiteCoverage(opts: {
  readonly root: string;
  readonly name: string;
  readonly paths: readonly string[];
  readonly outDir: string;
  readonly maxConc: number;
  readonly seconds: number;
  readonly cache: string | null;
  readonly cancelled: ReadonlySet<string>;
  readonly running: Map<string, Parameters<typeof killProcessGroup>[0]>;
}): Promise<SuiteCov> {
  const { root, name, paths, outDir, maxConc, seconds, cache, cancelled, running } = opts;
  mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const run = Bun.spawn(
    [
      capturedExecPath,
      "test",
      "--bail",
      `--max-concurrency=${String(maxConc)}`,
      `--timeout=${String(PER_TEST_WALL_MS)}`,
      "--coverage",
      "--coverage-reporter=lcov",
      `--coverage-dir=${outDir}`,
      ...paths,
    ],
    {
      cwd: root,
      env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
      timeout: seconds * 1000,
    },
  );
  running.set(name, run);
  const [said, code] = await Promise.all([
    Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]).then((parts) =>
      parts.join(""),
    ),
    run.exited,
  ]);
  running.delete(name);
  const durationMs = Math.max(1, Date.now() - started);
  if (cancelled.has(name) || run.signalCode !== null || code !== 0 || !VERDICT_RE.test(said)) {
    return { passed: false, lcov: null, durationMs };
  }
  const lcovPath = join(outDir, "lcov.info");
  const lcov = existsSync(lcovPath) ? readFileSync(lcovPath, "utf8") : null;
  if (cache !== null) {
    const key = cacheKey(name);
    if (lcov !== null) writeFileSync(join(cache, `${key}.lcov`), lcov);
    writeFileSync(join(cache, `${key}.ok`), `${String(durationMs)}\n`);
  }
  return { passed: true, lcov, durationMs };
}

function readCachedCoverage(cache: string | null, name: string): SuiteCov | null {
  if (cache === null) return null;
  const key = cacheKey(name);
  const okPath = join(cache, `${key}.ok`);
  if (!existsSync(okPath)) return null;
  const lcovPath = join(cache, `${key}.lcov`);
  const ms = Number(readFileSync(okPath, "utf8").trim());
  return {
    passed: true,
    lcov: existsSync(lcovPath) ? readFileSync(lcovPath, "utf8") : null,
    durationMs: Number.isFinite(ms) && ms > 0 ? ms : 500,
  };
}

export function startCoverage(
  root: string,
  suites: ReadonlyMap<string, readonly string[]>,
  opts: {
    readonly seconds: number;
    readonly cacheDir: string | null;
    readonly maxParallel?: number;
    readonly concurrency?: number;
  },
): CoverageHandle {
  const dir = mkdtempSync(join(tmpdir(), "ana-cov-"));
  const cache = opts.cacheDir;
  if (cache !== null) mkdirSync(cache, { recursive: true });
  const results = new Map<string, SuiteCov>();
  const resolvers = new Map<string, (value: SuiteCov) => void>();
  const promises = new Map<string, Promise<SuiteCov>>();
  const queue: (readonly [string, readonly string[]])[] = [];
  const running = new Map<string, Parameters<typeof killProcessGroup>[0]>();
  const cancelled = new Set<string>();
  const settled = new Set<string>();

  for (const [name, paths] of suites) {
    const cached = readCachedCoverage(cache, name);
    if (cached !== null) {
      results.set(name, cached);
      settled.add(name);
      promises.set(name, Promise.resolve(cached));
      continue;
    }
    promises.set(
      name,
      new Promise<SuiteCov>((resolve) => {
        resolvers.set(name, resolve);
      }),
    );
    queue.push([name, paths]);
  }

  const finish = (name: string, entry: SuiteCov) => {
    if (settled.has(name)) return;
    settled.add(name);
    results.set(name, entry);
    resolvers.get(name)?.(entry);
  };

  let seq = 0;
  const maxConc = opts.concurrency ?? 8;
  const worker = async (): Promise<void> => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      const [name, paths] = next;
      if (cancelled.has(name)) {
        finish(name, { passed: false, lcov: null, durationMs: 1 });
        continue;
      }
      seq += 1;
      const entry = await measureSuiteCoverage({
        root,
        name,
        paths,
        outDir: join(dir, String(seq)),
        maxConc,
        seconds: opts.seconds,
        cache,
        cancelled,
        running,
      });
      finish(name, entry);
    }
  };

  const slots = Math.min(opts.maxParallel ?? availableParallelism(), queue.length);
  const done = Promise.all(Array.from({ length: slots }, worker)).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const cancel = (name: string) => {
    cancelled.add(name);
    const proc = running.get(name);
    if (proc !== undefined) killProcessGroup(proc, "SIGTERM");
    finish(name, { passed: false, lcov: null, durationMs: 1 });
  };

  return {
    readyNames: () => new Set(settled),
    waitFor: async (names, files) => {
      const targets = new Set(files);
      const uncovered = new Map<string, Map<string, Set<number>>>();
      const passed = new Set<string>();
      const durations = new Map<string, number>();
      await Promise.all(
        names.map(async (name) => {
          const entry = results.get(name) ?? (await promises.get(name));
          if (entry === undefined || !entry.passed) return;
          passed.add(name);
          durations.set(name, entry.durationMs);
          if (entry.lcov !== null) uncovered.set(name, parseUncovered(root, entry.lcov, targets));
        }),
      );
      return { uncovered, passed, durations };
    },
    cancelExcept: (keep) => {
      for (const name of suites.keys()) if (!keep.has(name) && !settled.has(name)) cancel(name);
    },
    cancelAll: async () => {
      for (const name of suites.keys()) if (!settled.has(name)) cancel(name);
      await settleProcs(new Set(running.values()), 150);
      await Promise.race([done, Bun.sleep(150)]);
    },
  };
}

const BATCH_DRIVER_BODY = `import { it } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd();
const originals = new Map();
for (const { mutant } of cfg.plans) {
  if (!originals.has(mutant.file)) originals.set(mutant.file, readFileSync(mutant.file, "utf8"));
}
async function runPaths(dir, paths, conc) {
  const run = Bun.spawn(
    [process.execPath, "test", "--bail", "--max-concurrency=" + String(conc), "--timeout=" + String(cfg.perTestWall), ...paths],
    {
      cwd: dir,
      env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: cfg.seconds * 1000,
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  const said = stdout + stderr;
  return run.signalCode !== null ? null : re.test(said) ? code !== 0 : null;
}
async function qualify() {
  if (cfg.qualifySuites.length === 0) return true;
  const all = [...new Set(cfg.qualifySuites.flatMap((name) => cfg.suites[name] ?? []))];
  if (all.length === 0) return true;
  if (cfg.qualifySuites.length > 1 && (await runPaths(root, all, 2)) === false) {
    console.log(QUALIFY_OK);
    return true;
  }
  for (const name of cfg.qualifySuites) {
    const said = await runPaths(root, cfg.suites[name] ?? [], 2);
    if (said === false) continue;
    const at = cfg.remoteLabel === "" ? "" : " on " + cfg.remoteLabel;
    console.log(QUALIFY_FAIL + 'baseline suite "' + name + '" did not pass unmutated (' + (said === true ? "failed" : "no verdict") + ')' + at);
    return false;
  }
  console.log(QUALIFY_OK);
  return true;
}
const copyRoots = new Set(["src", "tools", "test", ...cfg.plans.map((p) => p.mutant.file.split("/")[0])]);
async function cloneLane(dest) {
  const entries = readdirSync(root);
  const toCopy = [];
  for (const name of entries) {
    if (copyRoots.has(name)) {
      toCopy.push(name);
    } else {
      symlinkSync(join(root, name), join(dest, name));
    }
  }
  if (toCopy.length === 0) return;
  const flag = process.platform === "darwin" ? "-cRp" : "-al";
  const fast = Bun.spawn(["cp", flag, ...toCopy.map((name) => join(root, name)), dest], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await fast.exited) === 0) return;
  for (const name of toCopy) cpSync(join(root, name), join(dest, name), { recursive: true, force: true });
}
async function runIn(dir, plan) {
  const { mutant, active } = plan;
  const original = originals.get(mutant.file) ?? "";
  const target = join(dir, mutant.file);
  rmSync(target, { force: true });
  writeFileSync(target, original.slice(0, mutant.start) + mutant.text + original.slice(mutant.end));
  const killed = {};
  try {
    for (const name of active) {
      if (cfg.stopAtKill && Object.values(killed).some(Boolean)) {
        killed[name] = null;
        continue;
      }
      killed[name] = await runPaths(dir, cfg.suites[name] ?? [], 1);
    }
  } finally {
    rmSync(target, { force: true });
    writeFileSync(target, original);
  }
  const { id, file, line, label } = mutant;
  console.log(BATCH_ROW + JSON.stringify({ id, file, line, label, killed }));
}
it("mutate batch", async () => {
  const cap = Math.min(8, Math.max(2, availableParallelism()));
  const lanes = Math.min(cap, cfg.plans.length);
  const tempDirs = Array.from({ length: Math.max(0, lanes - 1) }, () => mkdtempSync(join(tmpdir(), "ana-m-")));
  const cloneAll = Promise.all(tempDirs.map((copy) => cloneLane(copy)));
  const dirs = [root, ...tempDirs];
  let next = 0;
  try {
    const [ok] = await Promise.all([qualify(), cloneAll]);
    if (!ok) return;
    await Promise.all(
      dirs.map(async (dir) => {
        for (;;) {
          if (cfg.deadline !== null && Date.now() >= cfg.deadline) return;
          const plan = cfg.plans[next];
          next += 1;
          if (plan === undefined) return;
          await runIn(dir, plan);
        }
      }),
    );
  } finally {
    await Promise.all(tempDirs.map((copy) => Bun.spawn(["rm", "-rf", copy], { stdout: "ignore", stderr: "ignore" }).exited));
  }
}, TOTAL_MS);
`;

function batchDriverSource(
  plans: readonly BatchPlan[],
  suites: ReadonlyMap<string, readonly string[]>,
  opts: {
    readonly qualifySuites: readonly string[];
    readonly remoteLabel: string;
    readonly stopAtKill: boolean;
    readonly seconds: number;
    readonly deadline: number;
  },
): string {
  const payload = JSON.stringify({
    plans,
    suites: Object.fromEntries(suites),
    qualifySuites: opts.qualifySuites,
    remoteLabel: opts.remoteLabel,
    stopAtKill: opts.stopAtKill,
    seconds: opts.seconds,
    deadline: Number.isFinite(opts.deadline) ? opts.deadline : null,
    perTestWall: PER_TEST_WALL_MS,
  });
  const totalMs = Math.min(3_600_000, (opts.seconds * Math.max(1, plans.length) + 60) * 1000);
  const header = [
    `const cfg = ${payload};`,
    `const re = ${VERDICT_RE.toString()};`,
    `const BATCH_ROW = ${JSON.stringify(BATCH_MARKER)};`,
    `const QUALIFY_OK = ${JSON.stringify(QUALIFY_OK_MARKER)};`,
    `const QUALIFY_FAIL = ${JSON.stringify(QUALIFY_FAIL_MARKER)};`,
    `const TOTAL_MS = ${String(totalMs)};`,
  ].join("\n");
  return `${header}\n${BATCH_DRIVER_BODY}`;
}

interface BatchRow {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly killed: Record<string, boolean | null>;
}

async function readBatchStream(
  stream: ReadableStream<Uint8Array>,
  onRow?: (row: BatchRow) => void,
): Promise<{ readonly rows: BatchRow[]; readonly qualified: boolean; readonly refused: string | null }> {
  const rows: BatchRow[] = [];
  let qualified = false;
  let refused: string | null = null;
  let buf = "";
  const decoder = new TextDecoder();
  const handleLine = (line: string) => {
    if (line.includes(QUALIFY_OK_MARKER)) qualified = true;
    const failAt = line.indexOf(QUALIFY_FAIL_MARKER);
    if (failAt !== -1) refused = line.slice(failAt + QUALIFY_FAIL_MARKER.length).trim();
    const rowAt = line.indexOf(BATCH_MARKER);
    if (rowAt !== -1) {
      // SAFETY: every marked line was emitted by `batchDriverSource` above.
      const row = JSON.parse(line.slice(rowAt + BATCH_MARKER.length)) as BatchRow;
      rows.push(row);
      onRow?.(row);
    }
  };
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
      handleLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) handleLine(buf);
  return { rows, qualified, refused };
}

export async function runBatch(
  worker: FastWorker,
  placement: "local" | "remote",
  plans: readonly BatchPlan[],
  suites: ReadonlyMap<string, readonly string[]>,
  opts: {
    readonly qualifySuites: readonly string[];
    readonly stopAtKill: boolean;
    readonly seconds: number;
    readonly deadline: number;
    readonly activeProcs?: Set<ActiveProc>;
    readonly onRow?: (row: BatchRow) => void;
  },
): Promise<{
  readonly rows: BatchRow[];
  readonly qualified: boolean;
  readonly refused: string | null;
  readonly dropped: boolean;
}> {
  const away = placement === "remote";
  const driverPath = join(worker.clone, BATCH_FILE);
  mkdirSync(dirname(driverPath), { recursive: true });
  writeFileSync(
    driverPath,
    batchDriverSource(plans, suites, { ...opts, remoteLabel: worker.place.remote ?? "" }),
  );
  const batchSeconds = Math.min(3600, opts.seconds * Math.max(1, plans.length) + 60);
  try {
    const run = Bun.spawn([away ? "bun" : capturedExecPath, "test", BATCH_FILE], {
      cwd: worker.clone,
      env: away
        ? { ...Bun.env, ...placeEnv(worker.place), ANA_RUNNER_WALL: String(batchSeconds) }
        : { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
      stdout: "pipe",
      stderr: "pipe",
      detached: away,
      ...keysIf(!away, () => ({ timeout: batchSeconds * 1000 })),
    });
    opts.activeProcs?.add(run);
    const [parsed, code] = await Promise.all([readBatchStream(run.stdout, opts.onRow), run.exited]);
    opts.activeProcs?.delete(run);
    return { ...parsed, dropped: away && NO_VERDICT.has(code) };
  } finally {
    rmSync(driverPath, { force: true });
  }
}
