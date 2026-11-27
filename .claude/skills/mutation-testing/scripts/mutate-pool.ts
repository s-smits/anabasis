import { availableParallelism } from "#src/meta/os.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import type { Place } from "#tools/runs/host-config.ts";
import {
  type ActiveProc,
  type BatchPlan,
  type FastWorker,
  isAway,
  killsOf,
  runBatch,
  unfit,
  type VerdictMap,
} from "./mutate-exec.ts";

const TARGET_BATCH_MS = 60_000;
export const UNKNOWN_SUITE_MS = 15_000;

export interface PoolTask {
  readonly key: string;
  readonly plan: BatchPlan;
  readonly weightMs: number;
}

interface SuiteKillStat {
  runs: number;
  kills: number;
}

function orderActiveByEfficiency(
  plan: BatchPlan,
  killStats: ReadonlyMap<string, SuiteKillStat>,
  durations: ReadonlyMap<string, number>,
  covered: ReadonlyMap<string, ReadonlyMap<string, number>>,
  stopAtKill: boolean,
): BatchPlan {
  if (!stopAtKill || plan.active.length <= 1) return plan;
  const hasSignal = plan.active.some((suite) => durations.has(suite));
  const totalRuns = plan.active.reduce(
    (sum, suite) => sum + (killStats.get(`${plan.mutant.file}\0${suite}`)?.runs ?? 0),
    0,
  );
  if (!hasSignal && totalRuns < 4) return plan;
  const maxCov = Math.max(1, ...plan.active.map((suite) => covered.get(suite)?.get(plan.mutant.file) ?? 0));
  const score = (suite: string) => {
    const stat = killStats.get(`${plan.mutant.file}\0${suite}`);
    const cov = covered.get(suite)?.get(plan.mutant.file) ?? 0;
    const prior = cov > 0 ? 0.2 + 0.6 * (cov / maxCov) : 0.1;
    const ms = Math.max(50, durations.get(suite) ?? UNKNOWN_SUITE_MS);
    return ((stat?.kills ?? 0) + prior) / (((stat?.runs ?? 0) + 1) * ms);
  };
  return { mutant: plan.mutant, active: plan.active.toSorted((a, b) => score(b) - score(a)) };
}

function pullRemoteBatch(
  pending: PoolTask[],
  opts: {
    readonly cap: number;
    readonly doneQualify: ReadonlySet<string>;
    readonly killStats: ReadonlyMap<string, SuiteKillStat>;
    readonly durations: ReadonlyMap<string, number>;
    readonly covered: ReadonlyMap<string, ReadonlyMap<string, number>>;
    readonly stopAtKill: boolean;
    readonly hasLiveLocal: boolean;
  },
): PoolTask[] {
  const { cap, doneQualify, killStats, durations, covered, stopAtKill, hasLiveLocal } = opts;
  if (pending.length === 0) return [];
  const holdUnmeasuredLocal = durations.size > 0 && hasLiveLocal;
  const eligible = (task: PoolTask) =>
    !holdUnmeasuredLocal || task.plan.active.every((suite) => durations.has(suite));
  const lead = (task: PoolTask) =>
    orderActiveByEfficiency(task.plan, killStats, durations, covered, stopAtKill).active[0] ?? "";
  const groups = new Map<string, { weight: number; count: number; maxItem: number }>();
  for (const task of pending) {
    if (!eligible(task)) continue;
    const key = lead(task);
    const cur = groups.get(key) ?? { weight: 0, count: 0, maxItem: 0 };
    cur.weight += task.weightMs;
    cur.count += 1;
    cur.maxItem = Math.max(cur.maxItem, task.weightMs);
    groups.set(key, cur);
  }
  if (groups.size === 0) return [];
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
  const maxItems = Math.max(1, Math.min(cap, Math.max(8, Math.ceil((groups.get(chosen)?.count ?? 1) / 2))));
  const batch: PoolTask[] = [];
  let totalMs = 0;
  for (let i = 0; i < pending.length && batch.length < maxItems && totalMs < TARGET_BATCH_MS; ) {
    const candidate = pending[i];
    if (candidate !== undefined && eligible(candidate) && lead(candidate) === chosen) {
      batch.push({
        ...candidate,
        plan: orderActiveByEfficiency(candidate.plan, killStats, durations, covered, stopAtKill),
      });
      totalMs += candidate.weightMs;
      pending.splice(i, 1);
    } else {
      i += 1;
    }
  }
  return batch;
}

async function settleProcs(procs: ReadonlySet<ActiveProc>, graceMs: number): Promise<void> {
  if (procs.size === 0) return;
  for (const proc of procs) killProcessGroup(proc, "SIGTERM");
  const until = Date.now() + graceMs;
  while (procs.size > 0 && Date.now() < until) await Bun.sleep(20);
  for (const proc of procs) killProcessGroup(proc, "SIGKILL");
}

interface PoolContext {
  readonly pending: PoolTask[];
  readonly doneKeys: Set<string>;
  readonly inFlight: Map<string, PoolTask>;
  readonly hedged: Set<string>;
  readonly retired: Set<Place>;
  readonly refused: Map<Place, string>;
  readonly activeProcs: Set<ActiveProc>;
  readonly killStats: Map<string, SuiteKillStat>;
  readonly stats: Map<string, number>;
  readonly remoteQualified: Map<string, Set<string>>;
  readonly remoteSlotQualify: Map<Place, Promise<string | null>>;
  readonly suites: ReadonlyMap<string, readonly string[]>;
  readonly originals: ReadonlyMap<string, string>;
  readonly durations: ReadonlyMap<string, number>;
  readonly covered: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly batchCap: number;
  readonly stopAtKill: boolean;
  readonly seconds: number;
  readonly deadline: number;
  readonly localCount: number;
  readonly localPlaces: ReadonlySet<Place>;
  readonly cores: number;
  localInFlight: number;
  readonly ensureLocalQualified: (seat: FastWorker, names: readonly string[]) => Promise<string | null>;
  readonly finishTask: (task: PoolTask, killed: VerdictMap, host: string) => void;
  readonly doneAll: () => boolean;
}

async function runLocalSeat(seat: FastWorker, ctx: PoolContext): Promise<void> {
  const takeHedge = () => {
    for (const [key, task] of ctx.inFlight) {
      if (ctx.doneKeys.has(key) || ctx.hedged.has(key)) continue;
      ctx.hedged.add(key);
      return task;
    }
    return undefined;
  };
  while (!ctx.doneAll() && !ctx.retired.has(seat.place)) {
    const task = ctx.pending.shift() ?? takeHedge();
    if (task === undefined) {
      if (ctx.inFlight.size === 0) return;
      await Bun.sleep(25);
      continue;
    }
    if (ctx.doneKeys.has(task.key)) continue;
    ctx.localInFlight += 1;
    try {
      const ordered = orderActiveByEfficiency(
        task.plan,
        ctx.killStats,
        ctx.durations,
        ctx.covered,
        ctx.stopAtKill,
      );
      const demand = Math.min(ctx.localCount, Math.max(1, ctx.pending.length + ctx.localInFlight));
      const localConc = Math.min(4, Math.max(1, Math.floor(ctx.cores / demand)));
      const outcome = await killsOf(seat, ordered, {
        originals: ctx.originals,
        suites: ctx.suites,
        durations: ctx.durations,
        stopAtKill: ctx.stopAtKill,
        seconds: ctx.seconds,
        localConc,
        activeProcs: ctx.activeProcs,
        beforeSuite: (name) => ctx.ensureLocalQualified(seat, [name]),
        shouldStop: ctx.doneAll,
      });
      if (outcome.kind !== "ok") {
        ctx.retired.add(seat.place);
        if (outcome.kind === "refused") ctx.refused.set(seat.place, outcome.why);
        if (!ctx.doneKeys.has(task.key)) ctx.pending.unshift(task);
        return;
      }
      ctx.finishTask(task, outcome.killed, "here");
    } finally {
      ctx.localInFlight -= 1;
    }
  }
}

async function runRemoteBatchSeat(seat: FastWorker, ctx: PoolContext): Promise<void> {
  const hostKey = seat.place.remote ?? "remote";
  while (!ctx.doneAll() && !ctx.retired.has(seat.place)) {
    const doneQualify = ctx.remoteQualified.get(hostKey) ?? new Set<string>();
    const batch = pullRemoteBatch(ctx.pending, {
      cap: ctx.batchCap,
      doneQualify,
      killStats: ctx.killStats,
      durations: ctx.durations,
      covered: ctx.covered,
      stopAtKill: ctx.stopAtKill,
      hasLiveLocal: [...ctx.localPlaces].some((place) => !ctx.retired.has(place)),
    });
    if (batch.length === 0) {
      if (ctx.inFlight.size === 0 && ctx.localInFlight === 0) return;
      await Bun.sleep(40);
      continue;
    }
    const byId = new Map(batch.map((task) => [task.plan.mutant.id, task] as const));
    for (const task of batch) ctx.inFlight.set(task.key, task);
    const needQualify = [...new Set(batch.flatMap((task) => task.plan.active))].filter(
      (name) => !doneQualify.has(name),
    );
    const got = await runBatch(
      seat,
      batch.map((task) => task.plan),
      ctx.suites,
      {
        qualifySuites: needQualify,
        stopAtKill: ctx.stopAtKill,
        seconds: ctx.seconds,
        durations: ctx.durations,
        deadline: ctx.deadline,
        activeProcs: ctx.activeProcs,
        onRow: (row) => {
          const task = byId.get(row.id);
          if (task !== undefined) ctx.finishTask(task, row.killed, hostKey);
        },
      },
    );
    for (const row of got.rows) {
      const task = byId.get(row.id);
      if (task !== undefined) ctx.finishTask(task, row.killed, hostKey);
    }
    const missing = batch.filter((task) => !ctx.doneKeys.has(task.key));
    for (const task of missing) ctx.inFlight.delete(task.key);
    if (ctx.doneAll()) return;
    if (got.refused !== null) {
      ctx.retired.add(seat.place);
      ctx.refused.set(seat.place, got.refused);
      ctx.pending.unshift(...missing);
      return;
    }
    if (got.qualified) {
      for (const name of needQualify) doneQualify.add(name);
      ctx.remoteQualified.set(hostKey, doneQualify);
    }
    if (got.dropped || missing.length > 0) {
      ctx.retired.add(seat.place);
      console.error(`${hostKey} gave no verdict, so takes no more mutants`);
      ctx.pending.unshift(...missing);
      return;
    }
  }
}

async function runRemoteSlotSeat(
  seat: FastWorker,
  ctx: PoolContext,
  activeSuites: ReadonlyMap<string, readonly string[]>,
): Promise<void> {
  const hostKey = seat.place.remote ?? "here";
  let qual = ctx.remoteSlotQualify.get(seat.place);
  if (qual === undefined) {
    qual = unfit(seat, activeSuites, ctx.seconds, 4);
    ctx.remoteSlotQualify.set(seat.place, qual);
  }
  const why = await qual;
  if (why !== null) {
    ctx.retired.add(seat.place);
    ctx.refused.set(seat.place, why);
    return;
  }
  while (!ctx.doneAll() && !ctx.retired.has(seat.place)) {
    const task = ctx.pending.shift();
    if (task === undefined) return;
    if (ctx.doneKeys.has(task.key)) continue;
    ctx.inFlight.set(task.key, task);
    const outcome = await killsOf(seat, task.plan, {
      originals: ctx.originals,
      suites: ctx.suites,
      durations: ctx.durations,
      stopAtKill: ctx.stopAtKill,
      seconds: ctx.seconds,
      localConc: 4,
    });
    ctx.inFlight.delete(task.key);
    if (outcome.kind !== "ok") {
      ctx.retired.add(seat.place);
      if (outcome.kind === "elsewhere") {
        console.error(`${hostKey} gave no verdict, so takes no more mutants`);
      } else {
        ctx.refused.set(seat.place, outcome.why);
      }
      if (!ctx.doneKeys.has(task.key)) ctx.pending.unshift(task);
      return;
    }
    ctx.finishTask(task, outcome.killed, hostKey);
  }
}

export async function runFleetPool(opts: {
  readonly activeWorkers: readonly FastWorker[];
  readonly tasks: readonly PoolTask[];
  readonly suites: ReadonlyMap<string, readonly string[]>;
  readonly originals: ReadonlyMap<string, string>;
  readonly durations: ReadonlyMap<string, number>;
  readonly covered: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly localQualified: Set<string>;
  readonly batchCap: number;
  readonly stopAtKill: boolean;
  readonly seconds: number;
  readonly deadline: number;
  readonly onResult: (task: PoolTask, killed: VerdictMap) => void;
}): Promise<{ readonly refused: readonly string[]; readonly unrun: number }> {
  const pending = [...opts.tasks].toSorted((a, b) => b.weightMs - a.weightMs);
  const localSeats = opts.activeWorkers.filter((seat) => !isAway(seat));
  const remoteSeats = opts.activeWorkers.filter(isAway);
  const activeSuites = new Map(
    [...opts.suites.entries()].filter(([name]) => pending.some((task) => task.plan.active.includes(name))),
  );
  const localQualifyWait = new Map<string, Promise<string | null>>();
  const baseConc = Math.min(
    4,
    Math.max(1, Math.floor(availableParallelism() / Math.max(1, localSeats.length))),
  );
  const ensureLocalQualified = async (seat: FastWorker, names: readonly string[]): Promise<string | null> => {
    const missing = names.filter((name) => !opts.localQualified.has(name));
    if (missing.length === 0) return null;
    for (const name of missing) {
      let wait = localQualifyWait.get(name);
      if (wait === undefined) {
        const paths = opts.suites.get(name);
        const map = paths === undefined ? new Map<string, readonly string[]>() : new Map([[name, paths]]);
        wait = unfit(seat, map, opts.seconds, baseConc).then((why) => {
          if (why === null) opts.localQualified.add(name);
          return why;
        });
        localQualifyWait.set(name, wait);
      }
      const why = await wait;
      if (why !== null) return why;
    }
    return null;
  };
  let resolveDone: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const ctx: PoolContext = {
    pending,
    doneKeys: new Set(),
    inFlight: new Map(),
    hedged: new Set(),
    retired: new Set(),
    refused: new Map(),
    activeProcs: new Set(),
    killStats: new Map(),
    stats: new Map(),
    remoteQualified: new Map(),
    remoteSlotQualify: new Map(),
    suites: opts.suites,
    originals: opts.originals,
    durations: opts.durations,
    covered: opts.covered,
    batchCap: opts.batchCap,
    stopAtKill: opts.stopAtKill,
    seconds: opts.seconds,
    deadline: opts.deadline,
    localCount: localSeats.length,
    localPlaces: new Set(localSeats.map((seat) => seat.place)),
    cores: availableParallelism(),
    localInFlight: 0,
    ensureLocalQualified,
    doneAll: () => ctx.doneKeys.size >= opts.tasks.length || Date.now() >= opts.deadline,
    finishTask: (task, killed, host) => {
      if (ctx.doneKeys.has(task.key)) return;
      ctx.doneKeys.add(task.key);
      ctx.inFlight.delete(task.key);
      ctx.stats.set(host, (ctx.stats.get(host) ?? 0) + 1);
      for (const [suite, out] of Object.entries(killed)) {
        if (out !== true && out !== false) continue;
        const key = `${task.plan.mutant.file}\0${suite}`;
        const cur = ctx.killStats.get(key) ?? { runs: 0, kills: 0 };
        cur.runs += 1;
        if (out) cur.kills += 1;
        ctx.killStats.set(key, cur);
      }
      opts.onResult(task, killed);
      if (ctx.doneKeys.size >= opts.tasks.length) resolveDone?.();
    },
  };
  const firstLocal = localSeats[0];
  const leadSuites = [
    ...new Set(
      pending.map((task) => task.plan.active[0]).filter((name): name is string => name !== undefined),
    ),
  ];
  if (firstLocal !== undefined && Date.now() < opts.deadline) {
    const why = await ensureLocalQualified(
      firstLocal,
      opts.stopAtKill ? leadSuites : [...activeSuites.keys()],
    );
    if (why !== null) {
      ctx.retired.add(firstLocal.place);
      ctx.refused.set(firstLocal.place, why);
    }
  }
  const remoteRunners =
    opts.batchCap > 1
      ? [...new Map(remoteSeats.map((seat) => [seat.place.remote ?? "remote", seat] as const)).values()].map(
          (seat) => runRemoteBatchSeat(seat, ctx),
        )
      : remoteSeats.map((seat) => runRemoteSlotSeat(seat, ctx, activeSuites));
  const allWorkers = Promise.all([...localSeats.map((seat) => runLocalSeat(seat, ctx)), ...remoteRunners]);
  await Promise.race([allWorkers, finished]);
  await settleProcs(ctx.activeProcs, 200);
  await Promise.race([allWorkers, Bun.sleep(150)]);
  if (runtimeProcess.env.ANA_MUTATE_STATS === "1") {
    const line = [...ctx.stats.entries()].map(([host, n]) => `${host}=${String(n)}`).join(" ");
    console.error(`mutate stats: ${line}`);
  }
  return { refused: [...ctx.refused.values()], unrun: opts.tasks.length - ctx.doneKeys.size };
}
