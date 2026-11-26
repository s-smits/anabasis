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
  formatCriteria,
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
  readonly baselinePoints: number;
  readonly total: number;
  readonly delta: number;
  readonly builtCuts: number;
  readonly baselineCuts: number;
  readonly builtRubricMisses: readonly RubricMiss[];
}

interface ToolTransferRow {
  readonly tool: string;
  readonly campaignSolves: number;
  readonly externalTasks: number;
}

interface CohortArmRow {
  readonly arm: string;
  readonly harness: string;
  readonly tasks: number;
  readonly flags: readonly string[];
  readonly builtTotal: number;
  readonly baselineTotal: number;
  readonly maxTotal: number;
  readonly delta: number;
  readonly builtCriteria: string;
  readonly baselineCriteria: string;
  readonly builtSolveUsd: number;
  readonly baselineSolveUsd: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly uncutBuilt: number;
  readonly uncutBaseline: number;
  readonly uncutMax: number;
  readonly uncutDelta: number;
  readonly builtCuts: number;
  readonly baselineCuts: number;
}

interface RuntimeCohort {
  readonly runtime: string;
  readonly baselineTier: SolverTier;
  readonly fullTaskCount: number;
  readonly uncutTaskCount: number;
  readonly rows: readonly CohortArmRow[];
  readonly baselineAllRange: readonly [number, number] | null;
  readonly baselineUncutRange: readonly [number, number] | null;
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
  readonly baselineTotal: number;
  readonly maxTotal: number;
  readonly delta: number;
  readonly builtCriteria: string;
  readonly baselineCriteria: string;
  readonly droppedBaselineTasks: readonly string[];
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly builtSolveUsd: number;
  readonly builtJudgeUsd: number;
  readonly baselineSolveUsd: number;
  readonly baselineJudgeUsd: number;
  readonly guideBytes: number | null;
  readonly internalStarterSummary: string;
  readonly tasks: readonly TaskDelta[];
  readonly tools: readonly ToolTransferRow[];
  readonly campaignSolveCount: number;
  readonly externalTrajCount: number;
  readonly cohorts: readonly RuntimeCohort[];
}

const UNKNOWN_CRITERIA = "?/?";

const sumBy = (records: readonly BenchRecord[], pick: (rec: BenchRecord) => number) =>
  records.reduce((sum, rec) => sum + pick(rec), 0);
const signed = (value: number) => (value > 0 ? `+${String(value)}` : String(value));
const rangeOf = (values: readonly number[]): readonly [number, number] | null =>
  values.length > 0 ? [Math.min(...values), Math.max(...values)] : null;

function tallyPaired(built: readonly BenchRecord[], baseline: readonly BenchRecord[]) {
  let [wins, losses, ties] = [0, 0, 0];
  for (const [idx, bRec] of built.entries()) {
    const baseRec = baseline[idx];
    if (baseRec === undefined) continue;
    if (bRec.points > baseRec.points) wins += 1;
    else if (bRec.points < baseRec.points) losses += 1;
    else ties += 1;
  }
  return { wins, losses, ties };
}

function parseJsonSafe(rawText: string) {
  try {
    return asRecord(capturedJsonParse(rawText));
  } catch {
    return null;
  }
}

function rubricMissesFor(store: string, arm: string, task: string): RubricMiss[] {
  const parts = task.split("/");
  if (parts.length !== 2) return [];
  const [group = "", name = ""] = parts;
  const evalDir = join(store, "dataset", group, name, "eval_result", `eval_${arm}__${group}__${name}`);
  if (!existsSync(evalDir)) return [];
  const judgeFile = readdirSync(evalDir).find((entry) => entry.endsWith("_judge.json"));
  if (judgeFile === undefined) return [];
  const raw = parseJsonSafe(readFileSync(join(evalDir, judgeFile), "utf8"));
  const rubrics = raw !== null && Array.isArray(raw.rubrics) ? raw.rubrics : [];
  return rubrics.flatMap((entry, position) => {
    const item = asRecord(entry);
    const result = asRecord(item?.result);
    if (item === null || result === null || result.passed === true) return [];
    return [
      {
        index: (isNumber(item.index) ? item.index : position) + 1,
        weight: isNumber(item.weight) ? item.weight : 0,
        passed: isNumber(result.criteria_passed) ? result.criteria_passed : 0,
        total: isNumber(result.criteria_count) ? result.criteria_count : 0,
      },
    ];
  });
}

function commandsInTrajLine(line: string): string[] {
  if (line.trim() === "") return [];
  const obj = parseJsonSafe(line);
  if (obj === null) return [];
  if (obj.kind === "solve.call") {
    const args = asRecord(asRecord(obj.data)?.args ?? asRecord(obj.data)?.input);
    return isString(args?.command) ? [args.command] : [];
  }
  if (obj.type === "assistant") {
    const content = asRecord(obj.message)?.content;
    return (Array.isArray(content) ? content : []).flatMap((block) => {
      const rec = asRecord(block);
      const input = asRecord(rec?.input ?? rec?.arguments);
      return isString(input?.command) ? [input.command] : [];
    });
  }
  return [];
}

const HEREDOC_RE = /(<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?[^\n]*)\n[\s\S]*?\n[ \t]*\2(?=\n|$)/gu;
const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
  "!",
  "{",
  "}",
]);
const SHELL_WRAPPERS = new Set(["env", "exec", "time", "nice", "nohup", "command", "xargs", "timeout"]);
const ARG_FLAGS = new Set(["-k", "-s", "-n", "-u", "-L", "-P", "-I", "-C"]);
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const DURATION_RE = /^\d+(?:\.\d+)?[smhd]?$/u;

function stripQuotes(word: string): string {
  return word.replaceAll(/^['"]|['"]$/gu, "");
}

function splitShellSegments(script: string): string[] {
  const cleaned = script.replace(HEREDOC_RE, "$1");
  const segments: string[] = [];
  let [current, quote, escaped] = ["", "", false];
  for (const ch of cleaned) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote !== "") {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      current += ch;
      quote = ch;
    } else if (";&|()`\n".includes(ch)) {
      if (current.trim() !== "") segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") segments.push(current);
  return segments;
}

function shellWords(segment: string): string[] {
  const words: string[] = [];
  let [current, quote, escaped] = ["", "", false];
  for (const ch of segment) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== "") {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/u.test(ch)) {
      if (current !== "") words.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current !== "") words.push(current);
  return words;
}

function commandIndex(words: readonly string[]): number {
  let at = 0;
  let inTimeout = false;
  while (at < words.length) {
    const word = words[at] ?? "";
    if (SHELL_KEYWORDS.has(word) || ENV_ASSIGN_RE.test(word)) {
      at += 1;
      continue;
    }
    if (SHELL_WRAPPERS.has(word)) {
      inTimeout = word === "timeout";
      at += 1;
      continue;
    }
    if (word.startsWith("-") && at > 0) {
      at += ARG_FLAGS.has(word) ? 2 : 1;
      continue;
    }
    if (inTimeout && DURATION_RE.test(word)) {
      inTimeout = false;
      at += 1;
      continue;
    }
    break;
  }
  return at;
}

function collectInvoked(command: string, out: Set<string>, depth = 0): void {
  if (depth > 2) return;
  for (const segment of splitShellSegments(command)) {
    const words = shellWords(segment);
    const at = commandIndex(words);
    const head = words[at];
    if (head === undefined) continue;
    const base = stripQuotes(head).split("/").at(-1) ?? "";
    if (base !== "") out.add(base);
    if ((base === "bash" || base === "sh") && words[at + 1] === "-c" && words[at + 2] !== undefined) {
      collectInvoked(words[at + 2] ?? "", out, depth + 1);
    }
  }
}

function invokedCommands(command: string): Set<string> {
  const out = new Set<string>();
  collectInvoked(command, out);
  return out;
}

function externalToolCounts(
  store: string,
  arm: string,
  tasks: readonly string[],
  toolNames: readonly string[],
) {
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
    const invoked = new Set<string>();
    for (const cmd of readFileSync(join(trajDir, latest), "utf8").split("\n").flatMap(commandsInTrajLine)) {
      for (const bin of invokedCommands(cmd)) invoked.add(bin);
    }
    for (const tool of toolNames) {
      if (invoked.has(tool)) counts.set(tool, (counts.get(tool) ?? 0) + 1);
    }
  }
  return { counts, trajCount };
}

function campaignToolCounts(events: readonly LogEvent[], harness: string, toolNames: readonly string[]) {
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
    const cmd = asRecord(call.args)?.command;
    if (!isString(cmd) || cmd === "") continue;
    const hits = perSolve.get(call.id) ?? new Set<string>();
    const invoked = invokedCommands(cmd);
    for (const tool of toolNames) {
      if (invoked.has(tool)) hits.add(tool);
    }
    perSolve.set(call.id, hits);
  }
  for (const hits of perSolve.values()) {
    for (const tool of hits) counts.set(tool, (counts.get(tool) ?? 0) + 1);
  }
  return { counts, solveCount: solveIds.size };
}

function harnessArtifacts(campaignDir: string, store: string, arm: string, harness: string) {
  const stateDir = join(campaignDir, "states", harness);
  const binDir = [
    join(stateDir, TOOL_TREE_DIR, "bin"),
    join(store, "trees", arm, "scripts", "toolchain", "bin"),
    join(store, "trees", arm, "harness", TOOL_TREE_DIR, "bin"),
  ].find((dir) => existsSync(dir));
  const tools =
    binDir === undefined
      ? []
      : readdirSync(binDir)
          .filter((name) => !name.startsWith("."))
          .toSorted();
  const guide = join(stateDir, AGENT_DIR, GUIDE_FILE);
  return { tools, guideBytes: existsSync(guide) ? statSync(guide).size : null };
}

function internalStarterLine(events: readonly LogEvent[], harness: string): string {
  const read = starterReads(events).find((each) => each.reference === harness);
  if (read === undefined) {
    return epochsOf(events).some((epoch) => epoch.promoted === harness)
      ? "none recorded yet"
      : "not promoted in this log";
  }
  return `${read.session}: ${read.confirmed ? "confirmed" : "unconfirmed"} (overall ${formatTally(read.stored)}, written-after ${formatTally(read.origins[ORIGINS[2]].whole)}, ${read.after})`;
}

function cohortVerdict(
  target: CohortArmRow | undefined,
  cleanCount: number,
  baselineTier: SolverTier,
  baselineUncutRange: readonly [number, number] | null,
  bestByDelta: CohortArmRow | null,
): string | null {
  if (target === undefined) return null;
  if (cleanCount < 2 || baselineUncutRange === null) {
    return `insufficient-baseline (k=1 same-runtime ${baselineTier}; direction only)`;
  }
  const [bMin, bMax] = baselineUncutRange;
  const halfSpan = (bMax - bMin) / 2;
  if (target.uncutBuilt > bMax) {
    return `above ${baselineTier} band (+${String(target.uncutBuilt - bMax)} uncut)`;
  }
  if (target.uncutBuilt < bMin) {
    return `below ${baselineTier} band (-${String(bMin - target.uncutBuilt)} uncut)`;
  }
  if (bestByDelta !== null && bestByDelta.uncutDelta - target.uncutDelta > halfSpan) {
    return `regressed vs best (${bestByDelta.arm}, gap ${String(target.uncutDelta - bestByDelta.uncutDelta)} > half-span ${halfSpan.toFixed(0)})`;
  }
  return `within ${baselineTier} spread (fair-uncut band ${String(bMin)}–${String(bMax)}, ±${halfSpan.toFixed(0)})`;
}

function buildRuntimeCohort(
  runtime: string,
  baselineTier: SolverTier,
  pairs: readonly PairedBenchArm[],
  targetArm: string | null,
): RuntimeCohort {
  const fullTaskCount = Math.max(0, ...pairs.map((pair) => pair.sharedTasks.length));
  const fullPairs = pairs.filter((pair) => pair.sharedTasks.length === fullTaskCount);
  const commonTasks = fullPairs.reduce<string[]>(
    (acc, pair, idx) =>
      idx === 0 ? [...pair.sharedTasks] : acc.filter((task) => pair.sharedTasks.includes(task)),
    [],
  );
  const fairSet = new Set(
    commonTasks.filter(
      (task) =>
        hasOneBefore(task) &&
        fullPairs.every(
          (pair) =>
            !pair.built.some((rec) => rec.task === task && isCut(rec)) &&
            !pair.baseline.some((rec) => rec.task === task && isCut(rec)),
        ),
    ),
  );
  const rows: CohortArmRow[] = pairs.map((pair) => {
    const builtTotal = sumBy(pair.built, (rec) => rec.points);
    const baselineTotal = sumBy(pair.baseline, (rec) => rec.points);
    const uncutBuiltRecs = pair.built.filter((rec) => fairSet.has(rec.task));
    const uncutBaseRecs = pair.baseline.filter((rec) => fairSet.has(rec.task));
    const uncutBuilt = sumBy(uncutBuiltRecs, (rec) => rec.points);
    const uncutBaseline = sumBy(uncutBaseRecs, (rec) => rec.points);
    const flags = [
      ...(pair.sharedTasks.length < fullTaskCount
        ? [`partial ${String(pair.sharedTasks.length)}/${String(fullTaskCount)}`]
        : []),
      ...(pair.built.some((rec) => rec.peekedCount > 0) ? ["PEEKED"] : []),
      ...(pair.droppedBaselineTasks.length > 0
        ? [`${String(pair.droppedBaselineTasks.length)} undelivered-baseline dropped`]
        : []),
    ];
    return {
      arm: pair.arm,
      harness: pair.harness,
      tasks: pair.sharedTasks.length,
      flags,
      builtTotal,
      baselineTotal,
      maxTotal: sumBy(pair.built, (rec) => rec.total),
      delta: builtTotal - baselineTotal,
      builtCriteria: formatCriteria(pair.built),
      baselineCriteria: formatCriteria(pair.baseline),
      builtSolveUsd: sumBy(pair.built, (rec) => rec.solveUsd),
      baselineSolveUsd: sumBy(pair.baseline, (rec) => rec.solveUsd),
      ...tallyPaired(pair.built, pair.baseline),
      uncutBuilt,
      uncutBaseline,
      uncutMax: sumBy(uncutBuiltRecs, (rec) => rec.total),
      uncutDelta: uncutBuilt - uncutBaseline,
      builtCuts: pair.built.filter(isCut).length,
      baselineCuts: pair.baseline.filter(isCut).length,
    };
  });
  const clean = rows.filter((row) => row.flags.length === 0);
  const baselineUncutRange = rangeOf(clean.map((row) => row.uncutBaseline));
  const uncutNegDeltas = clean.map((row) => -row.uncutDelta);
  const bestByDelta = clean.toSorted((a, b) => b.uncutDelta - a.uncutDelta || b.delta - a.delta)[0] ?? null;
  const target = targetArm === null ? undefined : clean.find((row) => row.arm === targetArm);
  return {
    runtime,
    baselineTier,
    fullTaskCount,
    uncutTaskCount: fairSet.size,
    rows,
    baselineAllRange: rangeOf(clean.map((row) => row.baselineTotal)),
    baselineUncutRange,
    medianAllDelta: clean.length > 0 ? median(clean.map((row) => row.delta)) : null,
    medianUncutDelta: clean.length > 0 ? median(clean.map((row) => row.uncutDelta)) : null,
    uncutNegativeP:
      clean.length >= 2 && uncutNegDeltas.some((d) => d !== 0) ? rawFlipP(uncutNegDeltas) : null,
    bestByDelta,
    bestByRaw: clean.toSorted((a, b) => b.builtTotal - a.builtTotal)[0] ?? null,
    targetVerdict: cohortVerdict(target, clean.length, baselineTier, baselineUncutRange, bestByDelta),
  };
}

function analyzeCohorts(
  records: readonly BenchRecord[],
  target: { readonly arm: string; readonly runtime: string; readonly baselineTier: SolverTier } | null,
): RuntimeCohort[] {
  const pairs = pairedArmsOf(records).filter((pair) => pair.runtime === pair.baselineRuntime);
  const grouped = Map.groupBy(pairs, ({ runtime, baselineTier }) => `${runtime}\0${baselineTier}`);
  const targetKey = target === null ? null : `${target.runtime}\0${target.baselineTier}`;
  return [...grouped.keys()]
    .toSorted((a, b) => (a === targetKey ? -1 : b === targetKey ? 1 : a.localeCompare(b)))
    .map((key) => {
      const group = grouped.get(key) ?? [];
      const lead = group[0];
      return buildRuntimeCohort(
        lead?.runtime ?? "",
        lead?.baselineTier ?? "baseStarter",
        group,
        key === targetKey ? (target?.arm ?? null) : null,
      );
    });
}

function emptyReport(
  readiness: DomainReadiness,
  cohorts: readonly RuntimeCohort[],
  status: RegressionReport["status"],
): RegressionReport {
  return {
    readiness,
    status,
    builtTotal: 0,
    baselineTotal: 0,
    maxTotal: 0,
    delta: 0,
    builtCriteria: UNKNOWN_CRITERIA,
    baselineCriteria: UNKNOWN_CRITERIA,
    droppedBaselineTasks: [],
    wins: 0,
    losses: 0,
    ties: 0,
    builtSolveUsd: 0,
    builtJudgeUsd: 0,
    baselineSolveUsd: 0,
    baselineJudgeUsd: 0,
    guideBytes: null,
    internalStarterSummary: "n/a",
    tasks: [],
    tools: [],
    campaignSolveCount: 0,
    externalTrajCount: 0,
    cohorts,
  };
}

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
          readiness.pairedArm === null
            ? null
            : {
                arm: readiness.pairedArm.arm,
                runtime: readiness.pairedArm.runtime,
                baselineTier: readiness.pairedArm.baselineTier,
              },
        )
      : [];
  if (!readiness.evalsActive) return emptyReport(readiness, cohorts, "below-min-promo");
  if (readiness.pairedArm === null || readiness.store === null) {
    return emptyReport(readiness, cohorts, readiness.ablationNeeded ? "ablation-needed" : "no-bench");
  }
  const { arm, baselineArm, harness } = readiness.pairedArm;
  const pair = pairedArmsOf(allRecords).find((each) => each.arm === arm && each.baselineArm === baselineArm);
  if (pair === undefined) return emptyReport(readiness, cohorts, "no-bench");

  const { store } = readiness;
  const tasks: TaskDelta[] = pair.built
    .flatMap((built, idx) => {
      const base = pair.baseline[idx];
      if (base === undefined) return [];
      const delta = built.points - base.points;
      return [
        {
          task: built.task,
          builtPoints: built.points,
          baselinePoints: base.points,
          total: built.total,
          delta,
          builtCuts: built.cutCount,
          baselineCuts: base.cutCount,
          builtRubricMisses: delta < 0 ? rubricMissesFor(store, arm, built.task) : [],
        },
      ];
    })
    .toSorted((one, other) => one.delta - other.delta || one.task.localeCompare(other.task));

  const builtTotal = sumBy(pair.built, (rec) => rec.points);
  const baselineTotal = sumBy(pair.baseline, (rec) => rec.points);
  const { tools: toolNames, guideBytes } = harnessArtifacts(campaignDir, store, arm, harness);
  const inside = campaignToolCounts(events, harness, toolNames);
  const outside = externalToolCounts(store, arm, pair.sharedTasks, toolNames);
  return {
    readiness,
    status: "scored",
    builtTotal,
    baselineTotal,
    maxTotal: sumBy(pair.built, (rec) => rec.total),
    delta: builtTotal - baselineTotal,
    builtCriteria: formatCriteria(pair.built),
    baselineCriteria: formatCriteria(pair.baseline),
    droppedBaselineTasks: pair.droppedBaselineTasks,
    ...tallyPaired(pair.built, pair.baseline),
    builtSolveUsd: sumBy(pair.built, (rec) => rec.solveUsd),
    builtJudgeUsd: sumBy(pair.built, (rec) => rec.judgeUsd),
    baselineSolveUsd: sumBy(pair.baseline, (rec) => rec.solveUsd),
    baselineJudgeUsd: sumBy(pair.baseline, (rec) => rec.judgeUsd),
    guideBytes,
    internalStarterSummary: internalStarterLine(events, harness),
    tasks,
    tools: toolNames.map((tool) => ({
      tool,
      campaignSolves: inside.counts.get(tool) ?? 0,
      externalTasks: outside.counts.get(tool) ?? 0,
    })),
    campaignSolveCount: inside.solveCount,
    externalTrajCount: outside.trajCount,
    cohorts,
  };
}

function formatMisses(misses: readonly RubricMiss[]): string {
  if (misses.length === 0) return "none";
  return misses
    .map(
      (item) =>
        `R${String(item.index)}(w${String(item.weight)},${String(item.passed)}/${String(item.total)})`,
    )
    .join(" ");
}

function formatCohortLines(cohorts: readonly RuntimeCohort[], targetArm: string | null): string[] {
  if (cohorts.length === 0) return [];
  const lines: string[] = [
    "",
    "## Cross-version cohort backtrack (paired arms in store, stratified by runtime and baseline tier)",
  ];
  for (const cohort of cohorts) {
    const same = targetArm !== null && cohort.rows.some((row) => row.arm === targetArm);
    const heading = `${cohort.runtime} vs ${cohort.baselineTier}${same ? "" : " (other stratum — non-comparable reference)"}`;
    lines.push(
      "",
      `### ${heading} (${String(cohort.rows.length)} paired arms, full=${String(cohort.fullTaskCount)} tasks, fair-uncut=${String(cohort.uncutTaskCount)} tasks)`,
    );
    if (cohort.baselineAllRange !== null && cohort.baselineUncutRange !== null) {
      const [aMin, aMax] = cohort.baselineAllRange;
      const [uMin, uMax] = cohort.baselineUncutRange;
      const medAll = cohort.medianAllDelta === null ? "n/a" : signed(Math.round(cohort.medianAllDelta));
      const medUncut = cohort.medianUncutDelta === null ? "n/a" : signed(Math.round(cohort.medianUncutDelta));
      const pText =
        cohort.uncutNegativeP === null
          ? ""
          : ` | one-sided built<baseline p=${cohort.uncutNegativeP.toFixed(4)}`;
      lines.push(
        `  ${cohort.baselineTier} spread: all ${String(aMin)}–${String(aMax)} (span ${String(aMax - aMin)}) | fair-uncut ${String(uMin)}–${String(uMax)} (span ${String(uMax - uMin)})`,
        `  cohort median delta: all ${medAll} | fair-uncut ${medUncut}${pText}`,
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
    if (cohort.targetVerdict !== null) lines.push(`  target verdict: ${cohort.targetVerdict}`);
    for (const row of cohort.rows) {
      const mark = row.arm === targetArm ? "*" : " ";
      const suffix = row.flags.length > 0 ? ` [${row.flags.join(", ")}]` : "";
      const crit =
        row.builtCriteria !== UNKNOWN_CRITERIA || row.baselineCriteria !== UNKNOWN_CRITERIA
          ? ` | crit ${row.builtCriteria} vs ${row.baselineCriteria}`
          : "";
      lines.push(
        `  ${mark} ${row.arm} (${row.harness.slice(0, 8)}): all ${String(row.builtTotal)}/${String(row.maxTotal)} vs ${String(row.baselineTotal)} (${signed(row.delta)}, ${String(row.wins)}-${String(row.losses)}-${String(row.ties)})${crit} | fair-uncut ${String(row.uncutBuilt)}/${String(row.uncutMax)} vs ${String(row.uncutBaseline)} (${signed(row.uncutDelta)}) | solve $${row.builtSolveUsd.toFixed(2)}/$${row.baselineSolveUsd.toFixed(2)} | cuts ${String(row.builtCuts)}/${String(row.baselineCuts)}${suffix}`,
      );
    }
  }
  return lines;
}

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
      `status: skipped — promotions (${String(readiness.promotions)}) below minPromo (${String(readiness.minPromo)}). Pass --min-promo 0 or --with-evals to override.`,
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
  const pct = (points: number) =>
    report.maxTotal > 0 ? ((100 * points) / report.maxTotal).toFixed(1) : "0.0";
  const baseLabel = pair?.baselineTier ?? "baseline";
  const criteriaSuffix =
    report.builtCriteria !== UNKNOWN_CRITERIA || report.baselineCriteria !== UNKNOWN_CRITERIA
      ? ` | criteria ${report.builtCriteria} vs ${report.baselineCriteria}`
      : "";
  const droppedSuffix =
    report.droppedBaselineTasks.length > 0
      ? ` | dropped ${String(report.droppedBaselineTasks.length)} undelivered baseline task(s)`
      : "";
  return [
    ...header,
    `benchmark: ${readiness.bench?.name ?? "local"} | pair: ${pair?.arm ?? ""} (${pair?.builtTier ?? "builtSolver"}) vs ${pair?.baselineArm ?? ""} (${baseLabel}, ${pair?.runtime ?? ""}, harness ${pair?.harness.slice(0, 8) ?? ""})`,
    `internal starter read: ${report.internalStarterSummary}`,
    `score: ${String(report.builtTotal)}/${String(report.maxTotal)} (${pct(report.builtTotal)}%) vs ${String(report.baselineTotal)}/${String(report.maxTotal)} (${pct(report.baselineTotal)}%) | delta ${signed(report.delta)} | W-L-T ${String(report.wins)}-${String(report.losses)}-${String(report.ties)}${criteriaSuffix}${droppedSuffix}`,
    `spend: built $${(report.builtSolveUsd + report.builtJudgeUsd).toFixed(2)} (solve $${report.builtSolveUsd.toFixed(2)}, judge $${report.builtJudgeUsd.toFixed(2)}) | ${baseLabel} $${(report.baselineSolveUsd + report.baselineJudgeUsd).toFixed(2)} (solve $${report.baselineSolveUsd.toFixed(2)}, judge $${report.baselineJudgeUsd.toFixed(2)})`,
    `harness guide: ${report.guideBytes === null ? "unavailable locally" : `${String(report.guideBytes)} B`}`,
    "",
    "## Per-task deltas (worst regressions first)",
    ...report.tasks.map((row) => {
      const cuts =
        row.builtCuts > 0 || row.baselineCuts > 0
          ? ` | cuts built=${String(row.builtCuts)} ${baseLabel}=${String(row.baselineCuts)}`
          : "";
      const misses = row.delta < 0 ? ` | built misses: ${formatMisses(row.builtRubricMisses)}` : "";
      return `  ${row.task}: ${String(row.builtPoints)}/${String(row.total)} vs ${String(row.baselinePoints)}/${String(row.total)} (${signed(row.delta)})${cuts}${misses}`;
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
  ].join("\n");
}
