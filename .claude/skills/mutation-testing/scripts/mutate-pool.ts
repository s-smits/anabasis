import { keysIf } from "#src/meta/optional-key.ts";
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

const TARGET_BATCH_MS = 240_000;
export const UNKNOWN_SUITE_MS = 4000;

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
    readonly doneKeys: ReadonlySet<string>;
    readonly doneQualify: ReadonlySet<string>;
    readonly badSuites: ReadonlySet<string>;
    readonly order: (plan: BatchPlan) => BatchPlan;
  },
): PoolTask[] {
  if (pending.length === 0) return [];
  const groups = new Map<string, { tasks: PoolTask[]; weight: number }>();
  let eligibleCount = 0;
  for (const task of pending) {
    if (opts.doneKeys.has(task.key)) continue;
    if (task.plan.active.some((suite) => opts.badSuites.has(suite))) continue;
    eligibleCount += 1;
    const ordered = opts.order(task.plan);
    const key = ordered.active[0] ?? "";
    const cur = groups.get(key) ?? { tasks: [], weight: 0 };
    cur.tasks.push({ ...task, plan: ordered });
    cur.weight += task.weightMs;
    groups.set(key, cur);
  }
  if (groups.size === 0) return [];
  const ranked = [...groups.entries()]
    .map(([key, group]) => ({ group, score: group.weight * (opts.doneQualify.has(key) ? 1.5 : 1) }))
    .toSorted((a, b) => b.score - a.score);
  const maxItems = Math.max(1, Math.min(opts.cap, Math.max(16, Math.ceil(eligibleCount / 2))));
  const minItems = Math.min(maxItems, Math.max(8, Math.min(24, Math.ceil(eligibleCount / 4))));
  const batch: PoolTask[] = [];
  const chosen = new Set<string>();
  let totalMs = 0;
  for (const { group } of ranked) {
    for (const task of group.tasks) {
      if (batch.length >= maxItems || (batch.length >= minItems && totalMs >= TARGET_BATCH_MS)) break;
      batch.push(task);
      chosen.add(task.key);
      totalMs += task.weightMs;
    }
    if (batch.length >= maxItems || (batch.length >= minItems && totalMs >= TARGET_BATCH_MS)) break;
  }
  if (chosen.size === 0) return [];
  const rest = pending.filter((task) => !chosen.has(task.key) && !opts.doneKeys.has(task.key));
  pending.length = 0;
  pending.push(...rest);
  return batch;
}

async function settleProcs(procs: ReadonlySet<ActiveProc>, graceMs: number): Promise<void> {
  if (procs.size === 0) return;
  for (const proc of procs) killProcessGroup(proc, "SIGTERM");
  const until = Date.now() + graceMs;
  while (procs.size > 0 && Date.now() < until) await Bun.sleep(20);
  for (const proc of procs) killProcessGroup(proc, "SIGKILL");
}

const refusedSuiteOf = (why: string): string | null => /^baseline suite "([^"]+)"/u.exec(why)?.[1] ?? null;

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
  const cores = availableParallelism();
  const baseConc = Math.min(4, Math.max(1, Math.floor(cores / Math.max(1, localSeats.length))));
  const activeSuites = new Map(
    [...opts.suites.entries()].filter(([name]) => pending.some((task) => task.plan.active.includes(name))),
  );
  const doneKeys = new Set<string>();
  const inFlight = new Map<string, PoolTask>();
  const hedged = new Set<string>();
  const retired = new Set<Place>();
  const refused = new Map<Place, string>();
  const activeProcs = new Set<ActiveProc>();
  const killStats = new Map<string, SuiteKillStat>();
  const stats = new Map<string, number>();
  const localBadSuites = new Set<string>();
  const skippedSuites = new Map<string, string>();
  const localQualifyWait = new Map<string, Promise<string | null>>();
  const remoteSlotQualify = new Map<Place, Promise<string | null>>();
  let localInFlight = 0;
  let resolveDone: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const recordSkip = (suite: string, why: string) => {
    if (!skippedSuites.has(suite)) skippedSuites.set(suite, why);
  };
  const doneAll = () => doneKeys.size >= opts.tasks.length || Date.now() >= opts.deadline;
  const orderPlan = (plan: BatchPlan) =>
    orderActiveByEfficiency(plan, killStats, opts.durations, opts.covered, opts.stopAtKill);
  const finishTask = (task: PoolTask, killed: VerdictMap, host: string) => {
    if (doneKeys.has(task.key)) return;
    doneKeys.add(task.key);
    inFlight.delete(task.key);
    stats.set(host, (stats.get(host) ?? 0) + 1);
    for (const [suite, out] of Object.entries(killed)) {
      if (out !== true && out !== false) continue;
      const key = `${task.plan.mutant.file}\0${suite}`;
      const cur = killStats.get(key) ?? { runs: 0, kills: 0 };
      cur.runs += 1;
      if (out) cur.kills += 1;
      killStats.set(key, cur);
    }
    opts.onResult(task, killed);
    if (doneKeys.size >= opts.tasks.length) resolveDone?.();
  };

  const ensureLocalQualified = async (seat: FastWorker, names: readonly string[]): Promise<string | null> => {
    for (const name of names) {
      if (opts.localQualified.has(name)) continue;
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

  const pullLocalTask = (): { readonly task: PoolTask; readonly wasHedged: boolean } | undefined => {
    const idx = pending.findIndex(
      (task) => !doneKeys.has(task.key) && !task.plan.active.some((suite) => localBadSuites.has(suite)),
    );
    if (idx !== -1) {
      const [task] = pending.splice(idx, 1);
      if (task !== undefined) return { task, wasHedged: false };
    }
    for (const [key, task] of inFlight) {
      if (doneKeys.has(key) || hedged.has(key)) continue;
      if (task.plan.active.some((suite) => localBadSuites.has(suite))) continue;
      hedged.add(key);
      return { task, wasHedged: true };
    }
    return undefined;
  };

  const runSingleSeat = async (seat: FastWorker, mode: "local" | "remote"): Promise<void> => {
    const hostKey = mode === "local" ? "here" : (seat.place.remote ?? "here");
    if (mode === "remote") {
      let qual = remoteSlotQualify.get(seat.place);
      if (qual === undefined) {
        qual = unfit(seat, activeSuites, opts.seconds, 4);
        remoteSlotQualify.set(seat.place, qual);
      }
      const why = await qual;
      if (why !== null) {
        retired.add(seat.place);
        refused.set(seat.place, why);
        return;
      }
    }
    while (!doneAll() && !retired.has(seat.place)) {
      const pulled =
        mode === "local"
          ? pullLocalTask()
          : (() => {
              const next = pending.shift();
              return next === undefined ? undefined : { task: next, wasHedged: false };
            })();
      if (pulled === undefined) {
        if (mode === "remote" || inFlight.size === 0) return;
        await Bun.sleep(25);
        continue;
      }
      const { task, wasHedged } = pulled;
      if (doneKeys.has(task.key)) continue;
      if (mode === "local") localInFlight += 1;
      else inFlight.set(task.key, task);
      try {
        const runnablePending =
          mode === "local"
            ? pending.filter(
                (item) =>
                  !doneKeys.has(item.key) && !item.plan.active.some((suite) => localBadSuites.has(suite)),
              ).length
            : pending.length;
        const demand = Math.min(localSeats.length, Math.max(1, runnablePending + localInFlight));
        const localConc = mode === "local" ? Math.min(4, Math.max(1, Math.floor(cores / demand))) : 4;
        const outcome = await killsOf(seat, mode === "local" ? orderPlan(task.plan) : task.plan, {
          originals: opts.originals,
          suites: opts.suites,
          durations: opts.durations,
          stopAtKill: opts.stopAtKill,
          seconds: opts.seconds,
          localConc,
          ...keysIf(mode === "local", () => ({
            activeProcs,
            beforeSuite: (name: string) => ensureLocalQualified(seat, [name]),
            shouldStop: doneAll,
          })),
        });
        if (outcome.kind !== "ok") {
          if (!wasHedged && !doneKeys.has(task.key)) pending.unshift(task);
          if (outcome.kind === "elsewhere") {
            retired.add(seat.place);
            console.error(`${hostKey} gave no verdict, so takes no more mutants`);
            return;
          }
          const bad =
            mode === "local" && outcome.suite !== undefined && task.plan.active.includes(outcome.suite)
              ? outcome.suite
              : null;
          if (bad !== null) {
            localBadSuites.add(bad);
            recordSkip(bad, outcome.why);
          }
          const hasMore =
            bad !== null &&
            opts.tasks.some(
              (item) => !doneKeys.has(item.key) && !item.plan.active.some((name) => localBadSuites.has(name)),
            );
          if (hasMore) {
            console.error(`${outcome.why}; here skips suite "${bad}"`);
            continue;
          }
          retired.add(seat.place);
          refused.set(seat.place, outcome.why);
          return;
        }
        finishTask(task, outcome.killed, hostKey);
      } finally {
        if (mode === "local") localInFlight -= 1;
        else inFlight.delete(task.key);
      }
    }
  };

  const runRemoteBatchSeat = async (seat: FastWorker): Promise<void> => {
    const hostKey = seat.place.remote ?? "remote";
    const doneQualify = new Set<string>();
    const badSuites = new Set<string>();
    let lastRefusal: string | null = null;
    while (!doneAll() && !retired.has(seat.place)) {
      const batch = pullRemoteBatch(pending, {
        cap: opts.batchCap,
        doneKeys,
        doneQualify,
        badSuites,
        order: orderPlan,
      });
      if (batch.length === 0) {
        if (inFlight.size > 0 || localInFlight > 0) {
          await Bun.sleep(40);
          continue;
        }
        if (lastRefusal !== null && (stats.get(hostKey) ?? 0) === 0) {
          retired.add(seat.place);
          refused.set(seat.place, lastRefusal);
        }
        return;
      }
      const byId = new Map(batch.map((task) => [task.plan.mutant.id, task] as const));
      for (const task of batch) {
        if (!doneKeys.has(task.key)) inFlight.set(task.key, task);
      }
      const needQualify = [...new Set(batch.flatMap((task) => task.plan.active))].filter(
        (name) => !doneQualify.has(name),
      );
      const got = await runBatch(
        seat,
        batch.map((task) => task.plan),
        opts.suites,
        {
          qualifySuites: needQualify,
          stopAtKill: opts.stopAtKill,
          seconds: opts.seconds,
          durations: opts.durations,
          deadline: opts.deadline,
          activeProcs,
          onRow: (row) => {
            const task = byId.get(row.id);
            if (task !== undefined) finishTask(task, row.killed, hostKey);
          },
        },
      );
      for (const row of got.rows) {
        const task = byId.get(row.id);
        if (task !== undefined) finishTask(task, row.killed, hostKey);
      }
      for (const task of batch) inFlight.delete(task.key);
      const missing = batch.filter((task) => !doneKeys.has(task.key));
      if (doneAll()) return;
      if (got.refused !== null) {
        lastRefusal = got.refused;
        pending.unshift(...missing);
        const badSuite = refusedSuiteOf(got.refused);
        if (badSuite !== null && !badSuites.has(badSuite)) {
          badSuites.add(badSuite);
          recordSkip(badSuite, got.refused);
          if (
            pending.some((task) => !doneKeys.has(task.key) && !task.plan.active.some((n) => badSuites.has(n)))
          ) {
            console.error(`${got.refused}; ${hostKey} skips suite "${badSuite}"`);
            continue;
          }
        }
        retired.add(seat.place);
        refused.set(seat.place, got.refused);
        return;
      }
      if (got.qualified) for (const name of needQualify) doneQualify.add(name);
      if (got.dropped || missing.length > 0) {
        retired.add(seat.place);
        const detail = got.stderr.split("\n").findLast((line) => line.trim() !== "");
        console.error(
          `${hostKey} gave no verdict${detail === undefined ? "" : ` (${detail})`}, so takes no more mutants`,
        );
        pending.unshift(...missing);
        return;
      }
    }
  };

  const startLocal = async (): Promise<void> => {
    const firstLocal = localSeats[0];
    if (firstLocal === undefined) return;
    const leadSuites = [
      ...new Set(
        pending.map((task) => task.plan.active[0]).filter((name): name is string => name !== undefined),
      ),
    ];
    const initial = (opts.stopAtKill ? leadSuites : [...activeSuites.keys()]).filter(
      (name) => !opts.localQualified.has(name),
    );
    const queue = [...initial];
    let firstRefusal: string | null = null;
    await Promise.all(
      localSeats.slice(0, Math.min(localSeats.length, queue.length)).map(async (seat) => {
        for (let name = queue.shift(); name !== undefined && !doneAll(); name = queue.shift()) {
          const why = await ensureLocalQualified(seat, [name]);
          if (why === null) continue;
          firstRefusal ??= why;
          localBadSuites.add(name);
          recordSkip(name, why);
          console.error(`${why}; here skips suite "${name}"`);
        }
      }),
    );
    const hasLocalWork = opts.tasks.some(
      (task) => !doneKeys.has(task.key) && !task.plan.active.some((name) => localBadSuites.has(name)),
    );
    if (firstRefusal !== null && !hasLocalWork) {
      retired.add(firstLocal.place);
      refused.set(firstLocal.place, firstRefusal);
      return;
    }
    await Promise.all(localSeats.map((seat) => runSingleSeat(seat, "local")));
  };

  const remoteRunners =
    opts.batchCap > 1
      ? [...new Map(remoteSeats.map((seat) => [seat.place.remote ?? "remote", seat] as const)).values()].map(
          runRemoteBatchSeat,
        )
      : remoteSeats.map((seat) => runSingleSeat(seat, "remote"));
  const allWorkers = Promise.all([startLocal(), ...remoteRunners]);
  await Promise.race([allWorkers, finished]);
  await settleProcs(activeProcs, 200);
  await Promise.race([allWorkers, Bun.sleep(150)]);
  if (runtimeProcess.env.ANA_MUTATE_STATS === "1") {
    const line = [...stats.entries()].map(([host, n]) => `${host}=${String(n)}`).join(" ");
    console.error(`mutate stats: ${line}`);
  }
  const unrunTasks = opts.tasks.filter((task) => !doneKeys.has(task.key));
  const reasons = new Set(refused.values());
  for (const name of unrunTasks.flatMap((task) => task.plan.active)) {
    const why = skippedSuites.get(name);
    if (why !== undefined) reasons.add(why);
  }
  return { refused: [...reasons], unrun: unrunTasks.length };
}
