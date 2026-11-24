/**
 * Deterministic regression-evals analyzer (`bun run wri regressions --log <log>`):
 * joins paired external benchmark records (`data/bench/<bench>/judged/<arm>/` vs `starter-<arm>/`,
 * optional rubric eval JSONs, and external solve trajectories) back to the campaign log
 * (`epochsOf`, `starterReads`, `ranUnder`, kept `.toolchain/bin` files) AND backtracks the arm
 * across all prior paired arms in the same benchmark store (stratified by runtime, computing
 * fair-uncut deltas, actual Starter spread, best-on-record, cohort median, and regression flags).
 * Strictly read-only and wall-safe: prints counts, rubric indices/weights, cut flags, tool names,
 * and 8-char digests — never quotes external task text, rubric prose, or hidden exam values.
 */
import { epochsOf, ORIGINS, starterReads } from "#src/campaign/climb.ts";
import { rawFlipP } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { ranUnder } from "#src/kernel/solves.ts";
import { callsOf, tracesIn } from "#src/kernel/trace.ts";
import { AGENT_DIR, GUIDE_FILE, TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { median } from "#src/meta/tally.ts";
import {
  type BenchRecord,
  hasOneBefore,
  isCut,
  type PairedBenchArm,
  pairedArmsOf,
  readJudgedStore,
  type SolverTier,
} from "../runs/bench-store.ts";
import type { DomainReadiness } from "./domains.ts";
import { formatTally } from "./folds.ts";

interface RubricMiss {
  readonly index: number;
  readonly weight: number;
  readonly passed: number;
  readonly total: number;
}

interface TaskDelta {
  readonly task: string;
  readonly builtPoints: number;
  readonly starterPoints: number;
  readonly total: number;
  readonly delta: number;
  readonly builtCuts: number;
  readonly starterCuts: number;
  readonly builtRubricMisses: readonly RubricMiss[];
  readonly starterRubricMisses: readonly RubricMiss[];
}

interface ToolTransferRow {
  readonly tool: string;
  readonly campaignSolves: number;
  readonly externalTasks: number;
}

interface CohortArmRow {
  readonly arm: string;
  readonly runtime: string;
  readonly harness: string;
  readonly campaign: string;
  readonly tasks: number;
  readonly partial: boolean;
  readonly peeked: boolean;
  readonly builtTotal: number;
  readonly starterTotal: number;
  readonly maxTotal: number;
  readonly delta: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly uncutBuilt: number;
  readonly uncutStarter: number;
  readonly uncutMax: number;
  readonly uncutDelta: number;
  readonly builtCuts: number;
  readonly starterCuts: number;
}

interface RuntimeCohort {
  readonly runtime: string;
  readonly baselineLabel: string;
  readonly fullTaskCount: number;
  readonly uncutTaskCount: number;
  readonly rows: readonly CohortArmRow[];
  readonly starterAllRange: readonly [number, number] | null;
  readonly starterUncutRange: readonly [number, number] | null;
  readonly medianAllDelta: number | null;
  readonly medianUncutDelta: number | null;
  readonly uncutNegativeP: number | null;
  readonly bestByDelta: CohortArmRow | null;
  readonly bestByRaw: CohortArmRow | null;
  readonly targetVerdict: string | null;
}

interface RegressionReport {
  readonly readiness: DomainReadiness;
  readonly status: "below-min-promo" | "ablation-needed" | "no-bench" | "scored";
  readonly builtTotal: number;
  readonly starterTotal: number;
  readonly maxTotal: number;
  readonly delta: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly builtSolveUsd: number;
  readonly builtJudgeUsd: number;
  readonly starterSolveUsd: number;
  readonly starterJudgeUsd: number;
  readonly guideBytes: number | null;
  readonly internalStarterSummary: string;
  readonly tasks: readonly TaskDelta[];
  readonly tools: readonly ToolTransferRow[];
  readonly campaignSolveCount: number;
  readonly externalTrajCount: number;
  readonly cohorts: readonly RuntimeCohort[];
}

const sumPoints = (records: readonly BenchRecord[]) => records.reduce((sum, rec) => sum + rec.points, 0);
const sumTotal = (records: readonly BenchRecord[]) => records.reduce((sum, rec) => sum + rec.total, 0);
const signed = (value: number) => (value > 0 ? `+${String(value)}` : String(value));

/** Reads missed rubric indices, weights, and criteria counts from `dataset/<task>/eval_result/`. */
function rubricMissesFor(store: string, arm: string, task: string): RubricMiss[] {
  const parts = task.split("/");
  if (parts.length !== 2) return [];
  const [group = "", name = ""] = parts;
  const evalDir = join(store, "dataset", group, name, "eval_result", `eval_${arm}__${group}__${name}`);
  if (!existsSync(evalDir)) return [];
  const judgeFile = readdirSync(evalDir).find((entry) => entry.endsWith("_judge.json"));
  if (judgeFile === undefined) return [];
  const raw = asRecord(capturedJsonParse(readFileSync(join(evalDir, judgeFile), "utf8")));
  const rubrics = raw !== null && Array.isArray(raw.rubrics) ? raw.rubrics : [];
  const misses: RubricMiss[] = [];
  for (const [position, entry] of rubrics.entries()) {
    const item = asRecord(entry);
    const result = asRecord(item?.result);
    if (item === null || result === null || result.passed === true) continue;
    misses.push({
      index: (isNumber(item.index) ? item.index : position) + 1,
      weight: isNumber(item.weight) ? item.weight : 0,
      passed: isNumber(result.criteria_passed) ? result.criteria_passed : 0,
      total: isNumber(result.criteria_count) ? result.criteria_count : 0,
    });
  }
  return misses;
}

/** Extracts bash command text from either `pi-durable` (`solve.call`) or Claude Code trajectory lines. */
function commandsInTrajLine(line: string): string[] {
  if (line.trim() === "") return [];
  const obj = asRecord(capturedJsonParse(line));
  if (obj === null) return [];
  if (obj.kind === "solve.call") {
    const data = asRecord(obj.data);
    const args = asRecord(data?.args ?? data?.input);
    return isString(args?.command) ? [args.command] : [];
  }
  if (obj.type === "assistant") {
    const message = asRecord(obj.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    return content.flatMap((block) => {
      const rec = asRecord(block);
      const input = asRecord(rec?.input ?? rec?.arguments);
      return isString(input?.command) ? [input.command] : [];
    });
  }
  return [];
}

/** Counts external tasks whose trajectory invoked each tool in `toolNames`. */
function externalToolCounts(
  store: string,
  arm: string,
  tasks: readonly string[],
  toolNames: readonly string[],
): { readonly counts: Map<string, number>; readonly trajCount: number } {
  const counts = new Map<string, number>(toolNames.map((name) => [name, 0]));
  let trajCount = 0;
  for (const task of tasks) {
    const [group = "", name = ""] = task.split("/");
    const trajDir = join(store, "dataset", group, name, "model_traj", `${arm}__${group}__${name}`);
    if (!existsSync(trajDir)) continue;
    const latest = readdirSync(trajDir)
      .filter((entry) => entry.endsWith(".jsonl"))
      .toSorted()
      .at(-1);
    if (latest === undefined) continue;
    trajCount += 1;
    if (toolNames.length === 0) continue;
    const cmds = readFileSync(join(trajDir, latest), "utf8").split("\n").flatMap(commandsInTrajLine);
    const hit = toolNames.filter((tool) => cmds.some((cmd) => cmd.includes(tool)));
    for (const tool of hit) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  }
  return { counts, trajCount };
}

/** Counts inside-campaign solves running `harness` that invoked each `.toolchain/bin` tool. */
function campaignToolCounts(
  events: readonly LogEvent[],
  harness: string,
  toolNames: readonly string[],
): { readonly counts: Map<string, number>; readonly solveCount: number } {
  const counts = new Map<string, number>(toolNames.map((name) => [name, 0]));
  const solveIds = new Set(
    ranUnder(events)
      .filter(({ under }) => under.harness === harness)
      .map(({ id }) => id),
  );
  if (toolNames.length === 0 || solveIds.size === 0) return { counts, solveCount: solveIds.size };
  const perSolve = new Map<string, Set<string>>();
  for (const call of callsOf(tracesIn(events), "solve")) {
    if (!solveIds.has(call.id)) continue;
    const args = asRecord(call.args);
    const cmd = isString(args?.command) ? args.command : "";
    if (cmd === "") continue;
    const hits = perSolve.get(call.id) ?? new Set<string>();
    for (const tool of toolNames) {
      if (cmd.includes(tool)) hits.add(tool);
    }
    perSolve.set(call.id, hits);
  }
  for (const hits of perSolve.values()) {
    for (const tool of hits) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  }
  return { counts, solveCount: solveIds.size };
}

/** Lists `.toolchain/bin` executables (campaign state or synced bench tree fallback) and guide size. */
function harnessArtifacts(
  campaignDir: string,
  store: string,
  arm: string,
  harness: string,
): { readonly tools: readonly string[]; readonly guideBytes: number | null } {
  const stateDir = join(campaignDir, "states", harness);
  const binDirs = [
    join(stateDir, TOOL_TREE_DIR, "bin"),
    join(store, "trees", arm, "scripts", "toolchain", "bin"),
    join(store, "trees", arm, "harness", TOOL_TREE_DIR, "bin"),
  ];
  const binDir = binDirs.find((dir) => existsSync(dir));
  const tools =
    binDir === undefined
      ? []
      : readdirSync(binDir)
          .filter((name) => !name.startsWith("."))
          .toSorted();
  const guide = join(stateDir, AGENT_DIR, GUIDE_FILE);
  const guideBytes = existsSync(guide) ? statSync(guide).size : null;
  return { tools, guideBytes };
}

/** Summarises the internal starter read for `harness` from production `starterReads`. */
function internalStarterLine(events: readonly LogEvent[], harness: string): string {
  const read = starterReads(events).find((each) => each.reference === harness);
  if (read === undefined) {
    const epochCount = epochsOf(events).filter((epoch) => epoch.promoted === harness).length;
    return epochCount > 0 ? "none recorded yet" : "not promoted in this log";
  }
  const overall = formatTally(read.stored);
  const after = formatTally(read.origins[ORIGINS[2]].whole);
  return `${read.session}: ${read.confirmed ? "confirmed" : "unconfirmed"} (overall ${overall}, written-after ${after}, ${read.after})`;
}

/** Computes an anti-noise cohort verdict for `target` against same-runtime baseline spread and best arm. */
function cohortVerdict(
  target: CohortArmRow | undefined,
  cleanCount: number,
  starterUncutRange: readonly [number, number] | null,
  bestByDelta: CohortArmRow | null,
  baselineLabel: string,
): string | null {
  if (target === undefined) return null;
  if (cleanCount < 2 || starterUncutRange === null) {
    return `insufficient-baseline (k=1 same-runtime ${baselineLabel}; direction only)`;
  }
  const [sMin, sMax] = starterUncutRange;
  const halfSpan = (sMax - sMin) / 2;
  if (target.uncutBuilt > sMax) {
    return `above ${baselineLabel} band (+${String(target.uncutBuilt - sMax)} uncut)`;
  }
  if (target.uncutBuilt < sMin) {
    return `below ${baselineLabel} band (-${String(sMin - target.uncutBuilt)} uncut)`;
  }
  if (bestByDelta !== null && bestByDelta.uncutDelta - target.uncutDelta > halfSpan) {
    return `regressed vs best (${bestByDelta.arm}, gap ${String(target.uncutDelta - bestByDelta.uncutDelta)} > half-span ${halfSpan.toFixed(0)})`;
  }
  return `within ${baselineLabel} spread (fair-uncut band ${String(sMin)}–${String(sMax)}, ±${halfSpan.toFixed(0)})`;
}

/** Summarises one runtime's paired arms into cohort rows, Starter spread, best-on-record, and verdict. */
function buildRuntimeCohort(
  runtime: string,
  pairs: readonly PairedBenchArm[],
  targetArm: string | null,
  targetCampaign: string,
): RuntimeCohort {
  const fullTaskCount = Math.max(0, ...pairs.map((pair) => pair.sharedTasks.length));
  const fullPairs = pairs.filter((pair) => pair.sharedTasks.length === fullTaskCount);
  const commonTasks = fullPairs.reduce<string[]>(
    (acc, pair, idx) =>
      idx === 0 ? [...pair.sharedTasks] : acc.filter((task) => pair.sharedTasks.includes(task)),
    [],
  );
  // Fair-uncut over the paired cohort itself (never poisoned by unpaired legacy Starters).
  const fairUncut = commonTasks.filter(
    (task) =>
      hasOneBefore(task) &&
      fullPairs.every(
        (pair) =>
          !pair.built.some((rec) => rec.task === task && isCut(rec)) &&
          !pair.starter.some((rec) => rec.task === task && isCut(rec)),
      ),
  );
  const fairSet = new Set(fairUncut);

  const rows: CohortArmRow[] = pairs.map((pair) => {
    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const [idx, bRec] of pair.built.entries()) {
      const sRec = pair.starter[idx];
      if (sRec === undefined) continue;
      if (bRec.points > sRec.points) wins += 1;
      else if (bRec.points < sRec.points) losses += 1;
      else ties += 1;
    }
    const builtTotal = sumPoints(pair.built);
    const starterTotal = sumPoints(pair.starter);
    const maxTotal = sumTotal(pair.built);
    const uncutBuiltRecs = pair.built.filter((rec) => fairSet.has(rec.task));
    const uncutStarterRecs = pair.starter.filter((rec) => fairSet.has(rec.task));
    const uncutBuilt = sumPoints(uncutBuiltRecs);
    const uncutStarter = sumPoints(uncutStarterRecs);
    const uncutMax = sumTotal(uncutBuiltRecs);
    const campaign = pair.built[0]?.campaign ?? (pair.arm === targetArm ? targetCampaign : "unknown");
    return {
      arm: pair.arm,
      runtime,
      harness: pair.harness,
      campaign,
      tasks: pair.sharedTasks.length,
      partial: pair.sharedTasks.length < fullTaskCount,
      peeked: pair.built.some((rec) => rec.peekedCount > 0),
      builtTotal,
      starterTotal,
      maxTotal,
      delta: builtTotal - starterTotal,
      wins,
      losses,
      ties,
      uncutBuilt,
      uncutStarter,
      uncutMax,
      uncutDelta: uncutBuilt - uncutStarter,
      builtCuts: pair.built.filter(isCut).length,
      starterCuts: pair.starter.filter(isCut).length,
    };
  });

  const clean = rows.filter((row) => !row.partial && !row.peeked);
  const starterAll = clean.map((row) => row.starterTotal);
  const starterUncut = clean.map((row) => row.uncutStarter);
  const starterAllRange: readonly [number, number] | null =
    starterAll.length > 0 ? [Math.min(...starterAll), Math.max(...starterAll)] : null;
  const starterUncutRange: readonly [number, number] | null =
    starterUncut.length > 0 ? [Math.min(...starterUncut), Math.max(...starterUncut)] : null;
  const medianAllDelta = clean.length > 0 ? median(clean.map((row) => row.delta)) : null;
  const medianUncutDelta = clean.length > 0 ? median(clean.map((row) => row.uncutDelta)) : null;
  const uncutNegDeltas = clean.map((row) => -row.uncutDelta);
  const uncutNegativeP =
    clean.length >= 2 && uncutNegDeltas.some((d) => d !== 0) ? rawFlipP(uncutNegDeltas) : null;
  const bestByDelta = clean.toSorted((a, b) => b.uncutDelta - a.uncutDelta || b.delta - a.delta)[0] ?? null;
  const bestByRaw = clean.toSorted((a, b) => b.builtTotal - a.builtTotal)[0] ?? null;

  const baselineTiers: readonly SolverTier[] = [
    ...new Set(pairs.map((pair) => pair.baselineTier)),
  ].toSorted();
  const baselineLabel = baselineTiers.length > 0 ? baselineTiers.join("/") : "baseStarter";
  const target = targetArm === null ? undefined : clean.find((row) => row.arm === targetArm);
  const targetVerdict = cohortVerdict(target, clean.length, starterUncutRange, bestByDelta, baselineLabel);

  return {
    runtime,
    baselineLabel,
    fullTaskCount,
    uncutTaskCount: fairUncut.length,
    rows,
    starterAllRange,
    starterUncutRange,
    medianAllDelta,
    medianUncutDelta,
    uncutNegativeP,
    bestByDelta,
    bestByRaw,
    targetVerdict,
  };
}

/** Builds stratified runtime cohorts across all paired arms in `store/judged/`. */
function analyzeCohorts(
  records: readonly BenchRecord[],
  targetArm: string | null,
  targetRuntime: string | null,
  targetCampaign: string,
): RuntimeCohort[] {
  const pairs = pairedArmsOf(records).filter((pair) => pair.runtime === pair.starterRuntime);
  const byRuntime = Map.groupBy(pairs, ({ runtime }) => runtime);
  const runtimes = [...byRuntime.keys()].toSorted((a, b) => {
    if (a === targetRuntime) return -1;
    if (b === targetRuntime) return 1;
    return a.localeCompare(b);
  });
  return runtimes.map((rt) =>
    buildRuntimeCohort(rt, byRuntime.get(rt) ?? [], rt === targetRuntime ? targetArm : null, targetCampaign),
  );
}

/** Builds an unscored/gated `RegressionReport` carrying resolved cohort context. */
function emptyReport(
  readiness: DomainReadiness,
  cohorts: readonly RuntimeCohort[],
  status: RegressionReport["status"],
): RegressionReport {
  return {
    readiness,
    status,
    builtTotal: 0,
    starterTotal: 0,
    maxTotal: 0,
    delta: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    builtSolveUsd: 0,
    builtJudgeUsd: 0,
    starterSolveUsd: 0,
    starterJudgeUsd: 0,
    guideBytes: null,
    internalStarterSummary: "n/a",
    tasks: [],
    tools: [],
    campaignSolveCount: 0,
    externalTrajCount: 0,
    cohorts,
  };
}

/** Runs the full deterministic external-regression join + cross-version cohort backtrack. */
export function analyzeRegressions(
  readiness: DomainReadiness,
  events: readonly LogEvent[],
  campaignDir = dirname(readiness.log),
): RegressionReport {
  const allRecords = readiness.store === null ? [] : readJudgedStore(readiness.store);
  const cohorts =
    allRecords.length > 0
      ? analyzeCohorts(
          allRecords,
          readiness.pairedArm?.arm ?? null,
          readiness.pairedArm?.runtime ?? null,
          readiness.campaign,
        )
      : [];

  if (!readiness.meetsMinPromo && readiness.regressionLane === null) {
    return emptyReport(readiness, cohorts, "below-min-promo");
  }
  if (readiness.pairedArm === null || readiness.store === null) {
    return emptyReport(readiness, cohorts, readiness.ablationNeeded ? "ablation-needed" : "no-bench");
  }

  const { arm, starterArm, harness } = readiness.pairedArm;
  const pair = pairedArmsOf(allRecords).find((each) => each.arm === arm && each.starterArm === starterArm);
  if (pair === undefined) return emptyReport(readiness, cohorts, "no-bench");

  let builtTotal = 0;
  let starterTotal = 0;
  let maxTotal = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let builtSolveUsd = 0;
  let builtJudgeUsd = 0;
  let starterSolveUsd = 0;
  let starterJudgeUsd = 0;

  const taskRows: TaskDelta[] = [];
  for (const [idx, built] of pair.built.entries()) {
    const starter = pair.starter[idx];
    if (starter === undefined) continue;
    builtTotal += built.points;
    starterTotal += starter.points;
    maxTotal += built.total;
    builtSolveUsd += built.solveUsd;
    builtJudgeUsd += built.judgeUsd;
    starterSolveUsd += starter.solveUsd;
    starterJudgeUsd += starter.judgeUsd;
    const diff = built.points - starter.points;
    if (diff > 0) wins += 1;
    else if (diff < 0) losses += 1;
    else ties += 1;
    taskRows.push({
      task: built.task,
      builtPoints: built.points,
      starterPoints: starter.points,
      total: built.total,
      delta: diff,
      builtCuts: built.cutCount,
      starterCuts: starter.cutCount,
      builtRubricMisses: rubricMissesFor(readiness.store, arm, built.task),
      starterRubricMisses: rubricMissesFor(readiness.store, starterArm, built.task),
    });
  }
  taskRows.sort((one, other) => one.delta - other.delta || one.task.localeCompare(other.task));

  const { tools: toolNames, guideBytes } = harnessArtifacts(campaignDir, readiness.store, arm, harness);
  const inside = campaignToolCounts(events, harness, toolNames);
  const outside = externalToolCounts(readiness.store, arm, pair.sharedTasks, toolNames);
  const tools: ToolTransferRow[] = toolNames.map((tool) => ({
    tool,
    campaignSolves: inside.counts.get(tool) ?? 0,
    externalTasks: outside.counts.get(tool) ?? 0,
  }));

  return {
    readiness,
    status: "scored",
    builtTotal,
    starterTotal,
    maxTotal,
    delta: builtTotal - starterTotal,
    wins,
    losses,
    ties,
    builtSolveUsd,
    builtJudgeUsd,
    starterSolveUsd,
    starterJudgeUsd,
    guideBytes,
    internalStarterSummary: internalStarterLine(events, harness),
    tasks: taskRows,
    tools,
    campaignSolveCount: inside.solveCount,
    externalTrajCount: outside.trajCount,
    cohorts,
  };
}

/** Formats missed rubric indices and weights compactly (`R1(w8,2/3)`). */
function formatMisses(misses: readonly RubricMiss[]): string {
  if (misses.length === 0) return "none";
  return misses
    .map(
      (item) =>
        `R${String(item.index)}(w${String(item.weight)},${String(item.passed)}/${String(item.total)})`,
    )
    .join(" ");
}

/** Formats the cross-version cohort comparison block across all paired arms in the benchmark store. */
function formatCohortLines(cohorts: readonly RuntimeCohort[], targetArm: string | null): string[] {
  if (cohorts.length === 0) return [];
  const lines: string[] = [
    "",
    "## Cross-version cohort backtrack (paired arms in store, stratified by runtime)",
  ];
  for (const cohort of cohorts) {
    const label =
      targetArm !== null && cohort.rows.some((row) => row.arm === targetArm)
        ? `runtime: ${cohort.runtime}`
        : `runtime: ${cohort.runtime} (other runtime — non-comparable reference)`;
    lines.push(
      "",
      `### ${label} (${String(cohort.rows.length)} paired arms vs ${cohort.baselineLabel}, full=${String(cohort.fullTaskCount)} tasks, fair-uncut=${String(cohort.uncutTaskCount)} tasks)`,
    );
    if (cohort.starterAllRange !== null && cohort.starterUncutRange !== null) {
      const [aMin, aMax] = cohort.starterAllRange;
      const [uMin, uMax] = cohort.starterUncutRange;
      const medAll = cohort.medianAllDelta === null ? "n/a" : signed(Math.round(cohort.medianAllDelta));
      const medUncut = cohort.medianUncutDelta === null ? "n/a" : signed(Math.round(cohort.medianUncutDelta));
      const pText =
        cohort.uncutNegativeP === null
          ? ""
          : ` | one-sided builtSolver<${cohort.baselineLabel} p=${cohort.uncutNegativeP.toFixed(4)}`;
      lines.push(
        `  ${cohort.baselineLabel} spread: all ${String(aMin)}–${String(aMax)} (span ${String(aMax - aMin)}) | fair-uncut ${String(uMin)}–${String(uMax)} (span ${String(uMax - uMin)})`,
        `  cohort median delta (builtSolver - ${cohort.baselineLabel}): all ${medAll} | fair-uncut ${medUncut}${pText}`,
      );
    }
    if (cohort.bestByDelta !== null) {
      const rawNote =
        cohort.bestByRaw !== null && cohort.bestByRaw.arm !== cohort.bestByDelta.arm
          ? ` (highest raw: ${cohort.bestByRaw.arm} ${String(cohort.bestByRaw.builtTotal)}/${String(cohort.bestByRaw.maxTotal)}, Δ ${signed(cohort.bestByRaw.delta)})`
          : "";
      lines.push(
        `  best paired delta: ${cohort.bestByDelta.arm} (fair-uncut ${signed(cohort.bestByDelta.uncutDelta)}, all ${signed(cohort.bestByDelta.delta)})${rawNote}`,
      );
    }
    if (cohort.targetVerdict !== null) {
      lines.push(`  target verdict: ${cohort.targetVerdict}`);
    }
    for (const row of cohort.rows) {
      const mark = row.arm === targetArm ? "*" : " ";
      const flags = [
        ...(row.partial ? [`partial ${String(row.tasks)}/${String(cohort.fullTaskCount)}`] : []),
        ...(row.peeked ? ["PEEKED"] : []),
      ];
      const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      lines.push(
        `  ${mark} ${row.arm} (${row.harness.slice(0, 8)}): all ${String(row.builtTotal)}/${String(row.maxTotal)} vs ${String(row.starterTotal)} (${signed(row.delta)}, ${String(row.wins)}-${String(row.losses)}-${String(row.ties)}) | fair-uncut ${String(row.uncutBuilt)}/${String(row.uncutMax)} vs ${String(row.uncutStarter)} (${signed(row.uncutDelta)}) | cuts ${String(row.builtCuts)}/${String(row.starterCuts)}${suffix}`,
      );
    }
  }
  return lines;
}

/** Renders a `RegressionReport` as concise plain text for `bun run wri regressions` and Lane 90. */
export function formatRegressionReport(report: RegressionReport): string {
  const { readiness } = report;
  const header = [
    `# External benchmark regression analysis: ${readiness.campaign}`,
    `domain: ${readiness.domain} (pack: ${readiness.pack}) | promotions: ${String(readiness.promotions)} (minPromo: ${String(readiness.minPromo)})`,
  ];
  const cohortLines = formatCohortLines(report.cohorts, readiness.pairedArm?.arm ?? null);
  if (report.status === "below-min-promo") {
    return [
      ...header,
      `status: skipped — promotions (${String(readiness.promotions)}) below minPromo (${String(readiness.minPromo)}). Pass --min-promo 0 to override.`,
      ...cohortLines,
    ].join("\n");
  }
  if (report.status === "ablation-needed") {
    return [
      ...header,
      `status: ablation required — benchmark ${readiness.bench?.name ?? "unknown"} has no paired external arm for promoted harness ${readiness.promotedDigests.at(-1)?.slice(0, 8) ?? "none"}.`,
      `run first: ${readiness.ablationCommand ?? ""}`,
      ...cohortLines,
    ].join("\n");
  }
  if (report.status === "no-bench") {
    return [
      ...header,
      "status: no external benchmark configured or paired arm found for this domain.",
      ...cohortLines,
    ].join("\n");
  }

  const pair = readiness.pairedArm;
  const builtPct = report.maxTotal > 0 ? ((100 * report.builtTotal) / report.maxTotal).toFixed(1) : "0.0";
  const starterPct = report.maxTotal > 0 ? ((100 * report.starterTotal) / report.maxTotal).toFixed(1) : "0.0";
  const lines = [
    ...header,
    `benchmark: ${readiness.bench?.name ?? "local"} | pair: ${pair?.builtTier ?? "builtSolver"} ${pair?.arm ?? ""} vs ${pair?.baselineTier ?? "baseStarter"} ${pair?.starterArm ?? ""} (${pair?.runtime ?? ""}, harness ${pair?.harness.slice(0, 8) ?? ""})`,
    `internal starter read (vs baseStarter): ${report.internalStarterSummary}`,
    `score: ${String(report.builtTotal)}/${String(report.maxTotal)} (${builtPct}%) vs ${String(report.starterTotal)}/${String(report.maxTotal)} (${starterPct}%) | delta ${signed(report.delta)} | W-L-T ${String(report.wins)}-${String(report.losses)}-${String(report.ties)}`,
    `spend: built $${(report.builtSolveUsd + report.builtJudgeUsd).toFixed(2)} (solve $${report.builtSolveUsd.toFixed(2)}, judge $${report.builtJudgeUsd.toFixed(2)}) | starter $${(report.starterSolveUsd + report.starterJudgeUsd).toFixed(2)} (solve $${report.starterSolveUsd.toFixed(2)}, judge $${report.starterJudgeUsd.toFixed(2)})`,
    `harness guide: ${report.guideBytes === null ? "unavailable locally" : `${String(report.guideBytes)} B`}`,
    "",
    "## Per-task deltas (worst regressions first)",
    ...report.tasks.map((row) => {
      const cuts =
        row.builtCuts > 0 || row.starterCuts > 0
          ? ` | cuts built=${String(row.builtCuts)} starter=${String(row.starterCuts)}`
          : "";
      const misses = row.delta < 0 ? ` | built misses: ${formatMisses(row.builtRubricMisses)}` : "";
      return `  ${row.task}: ${String(row.builtPoints)}/${String(row.total)} vs ${String(row.starterPoints)}/${String(row.total)} (${signed(row.delta)})${cuts}${misses}`;
    }),
    "",
    `## Toolchain transfer (.toolchain/bin: campaign solves=${String(report.campaignSolveCount)}, external trajs=${String(report.externalTrajCount)})`,
    ...(report.tools.length === 0
      ? ["  no .toolchain/bin executables found in local campaign state"]
      : report.tools.map(
          (row) =>
            `  ${row.tool}: campaign ${String(row.campaignSolves)}/${String(report.campaignSolveCount)} solves | external ${String(row.externalTasks)}/${String(report.externalTrajCount)} tasks`,
        )),
    ...cohortLines,
  ];
  return lines.join("\n");
}
