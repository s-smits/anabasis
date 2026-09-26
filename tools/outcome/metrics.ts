/** Read-only run projection: strict case denominators, verified traces and controller evidence. */
import { existsSync, readFileSync, readdirSync, statSync } from "../../src/meta/filesystem.ts";
import { dirname, join, relative } from "../../src/meta/path.ts";
import { passedCount, scoredCases } from "../../src/claim/battery-facts.ts";
import {
  CASE_RECORD_FILE,
  type CaseOutcome,
  type CaseRecordRow,
  classifyCaseOutcome,
  familyTally,
  outcomeTally,
  readCaseRecord,
} from "../../src/claim/case-record.ts";
import { wilsonInterval } from "../../src/claim/estimation.ts";
import { ENVIRONMENT_OWNED_NONRESULT_KINDS, isNonResultKind } from "../../src/claim/record-events.ts";
import {
  type TraceReadState,
  campaignTraceRoots,
  readVerifiedTraceUnder,
} from "../../src/claim/trace-read.ts";
import { type ControllerEvidence, readControllerEvidence } from "../../src/run/controller-evidence.ts";
import { isControllerBatteryRunId } from "../../src/run/controller-battery-record-policy.ts";
import { ControllerLedger, controllerLedgerExists } from "../../src/run/controller-ledger.ts";
import { BUILT_STANDARD_TOOL_NAMES } from "../../src/solve/built-starter.ts";
import { isBuiltPresetId, presetToolNames } from "../../src/correctness-bundle/built-presets.ts";
import { PUBLIC_RESOURCES_TOOL, readPublicResources } from "../../src/correctness-bundle/public-resources.ts";
import { scanTokens } from "../loc/token-facts.ts";
import { countNonBlank, excludedAs } from "../loc/nonblank-loc.ts";
import {
  type CaseTraceFacts,
  type FoldedTraceFacts,
  NO_TRACE_FACTS,
  type ToolStat,
  caseTraceFacts,
  foldTraceFacts,
  mergeToolStats,
} from "./trace-facts.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { type LimitMarginFamily, limitMarginFile, readLimitMargin } from "../../src/run/limit-margin.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";

const OUTCOME_METRICS_SCHEMA = "outcome-metrics/v4";

export interface CaseTelemetry extends CaseTraceFacts {
  taskId: string;
  family: string;
  outcome: CaseOutcome;
  nonResultKind: string | null;
  telemetry: TraceReadState;
}

interface BundleRecord {
  files: number;
  nonBlankLines: number;
  functions: number;
  worstFunction: { lines: number; name: string; file: string };
  byTopDir: Record<string, number>;
  excluded: Record<string, number>;
}

/** What this battery's recorded run claim states about when it was created, which task set it
 *  measured and which harness measured it. Chronology is the claim's `createdAt`, never filesystem
 *  mtime or run-id order, the same key `readClimbBatteries` sorts on. The two bundle hashes are the
 *  rest of the condition: a repair holds the task set fixed and moves the agent bundle, so
 *  `taskSetHash` alone cannot say two batteries measured one condition. Every field is null when no
 *  claim was written or the claim is unreadable: a reader then has no chronology and no identity,
 *  and must refuse the comparisons that need them rather than infer them from the run id. */
export interface ClaimFacts {
  createdAt: string | null;
  taskSetHash: string | null;
  agentHash: string | null;
  correctnessModelHash: string | null;
}

/** One battery's metrics. Case rows are keyed by BATTERY run id (`<run>-<variant>`); variants are never
 *  pooled — each battery is its own condition and gets its own denominator. */
/** One family's row of the limit-margin table, with the within-5% share stated beside its count. */
interface LimitMarginRow extends LimitMarginFamily {
  shareWithin5pct: number | null;
  reading: string;
}

export interface OutcomeMetrics {
  runId: string;
  claim: ClaimFacts;
  /** Host-only margin of hidden and published numeric limits against the claim-time reference
   *  solve, by family; null when no claim-time witness recorded one. Hidden pairing is heuristic and
   *  says so. */
  limitMargin: { pairing: string; families: LimitMarginRow[] } | null;
  identity: {
    backendPins: string[];
    builderIds: string[];
    buildInputsHashes: string[];
    slugs: string[];
    variants: string[];
    isolationStrengths: Record<string, number>;
    isolationUnproven: number;
  };
  cases: {
    total: number;
    verified: number;
    passed: number;
    failed: number;
    unaccepted: number;
    nonResults: { total: number; byKind: Record<string, number>; environmentOwnedKinds: string[] };
  };
  passRate: {
    successes: number;
    n: number;
    rate: number | null;
    wilson: { lower: number; upper: number } | null;
  };
  families: Record<
    string,
    { total: number; verified: number; passed: number; unaccepted: number; nonResults: number }
  >;
  telemetry: FoldedTraceFacts & {
    cases: CaseTelemetry[];
    recorded: number;
    meanTurns: number | null;
    meanToolCalls: number | null;
    costPerPass: number | null;
  };
  tools: {
    declaredCalls: Record<string, number> | null;
    undeclaredCalls: Record<string, number>;
    neverCalled: string[];
    byName: Record<string, ToolStat>;
    /** How many traced solves called each name at least once, against how many solves recorded any
     *  tool call at all. A call count alone cannot separate one solve that leaned on a tool from
     *  twenty that never reached it: a domain tool called three times across a battery of shell
     *  calls reports as "3" either way. */
    solvesUsing: Record<string, number>;
    tracedSolves: number;
  };
}

export interface OutcomeReport {
  schema: typeof OUTCOME_METRICS_SCHEMA;
  selector: string;
  controller: ControllerEvidence;
  caseRecord: "absent" | "present";
  batteries: Record<string, OutcomeMetrics>;
  /** The promotion decisions this run's rounds committed to the controller ledger. Without them a
   *  `candidate-held` terminal reads as a loss when the hold may be an integrity clause. The JSON
   *  exports under promotions/ are copies and are not read. */
  promotions: PromotionOutcomeRow[];
  bundle: BundleRecord | null;
}

interface PromotionOutcomeRow {
  runId: string;
  decision: "promoted" | "held";
  experiment: string | null;
  clauses: string[];
}

interface ReadCaseTraceResult {
  facts: CaseTraceFacts;
  state: TraceReadState;
}

interface RowFold {
  byKind: Record<string, number>;
  isolationStrengths: Record<string, number>;
  isolationUnproven: number;
  families: OutcomeMetrics["families"];
  telemetryCases: CaseTelemetry[];
  observedCalls: Record<string, number>;
}

const NO_CLAIM: ClaimFacts = {
  createdAt: null,
  taskSetHash: null,
  agentHash: null,
  correctnessModelHash: null,
};

/** One committed decision, read under the schema its writer records and refused otherwise. */
function promotionRow(id: string, evidence: string): PromotionOutcomeRow {
  const row = parseJsonAs<{
    schema?: unknown;
    runId?: unknown;
    decision?: unknown;
    experiment?: unknown;
    clauses?: unknown;
  }>(evidence);
  const { decision, clauses } = row;
  if (
    row.schema !== "product-promotion/v1" ||
    row.runId !== id ||
    (decision !== "promoted" && decision !== "held") ||
    !Array.isArray(clauses) ||
    !clauses.every(isString)
  ) {
    throw new Error(`promotion decision ${id} is not a product-promotion/v1 row`);
  }
  return {
    runId: id,
    decision,
    experiment: isString(row.experiment) ? row.experiment : null,
    clauses: [...clauses],
  };
}

function promotionRows(campaignDir: string, selector: string): PromotionOutcomeRow[] {
  if (!controllerLedgerExists(campaignDir)) return [];
  using ledger = ControllerLedger.open(campaignDir);
  return ledger
    .productDecisions()
    .filter((row) => isControllerBatteryRunId(selector, row.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((row) => promotionRow(row.id, row.evidence));
}

function count(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function readCaseTrace(
  row: CaseRecordRow,
  campaignDir: string,
  roots: readonly string[],
): ReadCaseTraceResult {
  const read = readVerifiedTraceUnder(row, campaignDir, roots);
  if (read.trace === null) return { facts: NO_TRACE_FACTS, state: read.state };
  return { facts: caseTraceFacts(read.trace), state: "recorded" };
}

function declaredToolNames(bundleDir: string | null): string[] | null {
  if (bundleDir === null) return null;
  const specPath = join(bundleDir, "tools-spec.json");
  if (!existsSync(specPath)) return null;
  const spec = parseJsonAs<{
    presets?: unknown[];
    tools?: Array<{ name?: unknown }>;
  }>(readFileSync(specPath, "utf8"));
  if (!Array.isArray(spec.presets) || !Array.isArray(spec.tools)) return null;
  const presets = spec.presets.filter((value): value is string => isString(value));
  if (presets.length !== spec.presets.length || !presets.every(isBuiltPresetId)) return null;
  return [
    ...spec.tools.map((tool) => (isString(tool.name) ? tool.name : "<unnamed>")),
    ...presetToolNames(presets),
    ...BUILT_STANDARD_TOOL_NAMES,
    // The controller registers this reserved reader only when the brief carries public resources,
    // so it is never in tools-spec.json and the declared roster would miss it. This row asks the
    // same question the runtime keys registration on -- does the bundle's sibling
    // correctness-model/ publish any public resources -- which is why a domain that publishes none
    // counts a hallucinated call to the reader as undeclared rather than as a declared tool.
    ...(readPublicResources(dirname(bundleDir)).length > 0 ? [PUBLIC_RESOURCES_TOOL] : []),
  ];
}

function walkFiles(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walkFiles(abs, root, out);
    else out.push(relative(root, abs));
  }
}

function bundleRecord(bundleDir: string | null): BundleRecord | null {
  if (bundleDir === null || !existsSync(bundleDir)) return null;
  const paths: string[] = [];
  walkFiles(bundleDir, bundleDir, paths);
  const excluded: Record<string, number> = {};
  let files = 0;
  let nonBlankLines = 0;
  let functions = 0;
  let worst = { lines: 0, name: "", file: "" };
  const byTopDir: Record<string, number> = {};
  for (const rel of paths.sort()) {
    const kind = excludedAs(rel);
    if (kind !== null) {
      count(excluded, kind);
      continue;
    }
    const text = readFileSync(join(bundleDir, rel), "utf8");
    const lines = countNonBlank(text);
    files += 1;
    nonBlankLines += lines;
    const top = rel.includes("/") ? (rel.split("/")[0] ?? ".") : ".";
    byTopDir[top] = (byTopDir[top] ?? 0) + lines;
    if (rel.endsWith(".ts") || rel.endsWith(".mts") || rel.endsWith(".js") || rel.endsWith(".mjs")) {
      const facts = scanTokens(text);
      functions += facts.functionCount;
      if (facts.worstFunction.lines > worst.lines) worst = { ...facts.worstFunction, file: rel };
    }
  }
  return { files, nonBlankLines, functions, worstFunction: worst, byTopDir, excluded };
}

function foldRows(rows: readonly CaseRecordRow[], campaignDir: string, roots: readonly string[]): RowFold {
  const fold: RowFold = {
    byKind: {},
    isolationStrengths: {},
    isolationUnproven: 0,
    families: {},
    telemetryCases: [],
    observedCalls: {},
  };
  for (const row of rows) {
    if (row.runtimeNonResultKind !== null) count(fold.byKind, row.runtimeNonResultKind);
    if (row.isolation === null) fold.isolationUnproven += 1;
    else count(fold.isolationStrengths, row.isolation.strength);
    const outcome = classifyCaseOutcome(row);
    const trace = readCaseTrace(row, campaignDir, roots);
    for (const name of trace.facts.toolNames) count(fold.observedCalls, name);
    fold.telemetryCases.push({
      ...trace.facts,
      taskId: row.taskId,
      family: row.family,
      outcome,
      nonResultKind: row.runtimeNonResultKind,
      telemetry: trace.state,
    });
  }
  for (const [family, { total, verified, passed, unaccepted, nonResults }] of familyTally(rows)) {
    fold.families[family] = { total, verified, passed, unaccepted, nonResults };
  }
  return fold;
}

/** The solves that called each name at least once, and the solves that called anything. A case
 *  whose trace recorded no tool call is neither a solve that declined the tool nor one that used
 *  it, so it stays out of both sides. */
function solveCoverage(cases: ReadonlyArray<Record<string, ToolStat>>) {
  const solvesUsing: Record<string, number> = {};
  let tracedSolves = 0;
  for (const byTool of cases) {
    // One solve counts once for a name however often it called it, and the transport prefix is the
    // same tool: a solve reaching `query` and `mcp__harness__query` reached `query` once.
    const used = new Set(
      Object.entries(byTool)
        .filter(([, stat]) => stat.calls > 0)
        .map(([name]) => name.replace(/^mcp__.+?__/, "")),
    );
    if (used.size === 0) continue;
    tracedSolves += 1;
    for (const name of used) solvesUsing[name] = (solvesUsing[name] ?? 0) + 1;
  }
  return { solvesUsing, tracedSolves };
}

function toolCensus(
  declared: readonly string[] | null,
  observedCalls: Record<string, number>,
): Omit<OutcomeMetrics["tools"], "byName" | "solvesUsing" | "tracedSolves"> {
  if (declared === null) return { declaredCalls: null, undeclaredCalls: {}, neverCalled: [] };
  const declaredCalls: Record<string, number> = {};
  for (const name of declared) declaredCalls[name] = 0;
  const undeclaredCalls: Record<string, number> = {};
  for (const [name, n] of Object.entries(observedCalls)) {
    // Strip only the MCP transport prefix; unmatched raw names remain violations.
    const bare = name.replace(/^mcp__.+?__/, "");
    if (declared.includes(bare)) declaredCalls[bare] = (declaredCalls[bare] ?? 0) + n;
    else undeclaredCalls[name] = n;
  }
  // Reserved controller tools are registered outside the Builder's spec, so an uncalled one is
  // not authored prompt space and must not feed the tools-never-called finding.
  const neverCalled = declared
    .filter((name) => declaredCalls[name] === 0 && name !== PUBLIC_RESOURCES_TOOL)
    .sort();
  return { declaredCalls, undeclaredCalls, neverCalled };
}

function telemetryBlock(cases: readonly CaseTelemetry[], passes: number): OutcomeMetrics["telemetry"] {
  const recorded = cases.filter((c) => c.telemetry === "recorded");
  const folded = foldTraceFacts(recorded);
  const { costUsd } = folded;
  return {
    ...folded,
    cases: [...cases],
    recorded: recorded.length,
    meanTurns: folded.turnSpread?.mean ?? null,
    meanToolCalls: folded.toolCallSpread?.mean ?? null,
    costPerPass: costUsd === null || passes === 0 ? null : costUsd.value / passes,
  };
}

/** Read `<campaign>/claims/<runId>.json`, which the claim write keys by battery run id. Absent,
 *  unparseable or refused claim bytes give null fields; nothing here decides whether a claim was
 *  created, only what it states. */
function claimFacts(campaignDir: string, runId: string): ClaimFacts {
  const path = join(campaignDir, "claims", `${runId}.json`);
  if (!existsSync(path)) return NO_CLAIM;
  let evidence: { createdAt?: unknown; claim?: unknown };
  try {
    evidence = parseJsonAs<{ createdAt?: unknown; claim?: unknown }>(readFileSync(path, "utf8"));
  } catch {
    return NO_CLAIM;
  }
  const claim = isRecord(evidence.claim) ? evidence.claim : null;
  const statement = claim !== null && isRecord(claim["statement"]) ? claim["statement"] : null;
  const stated = (field: string): string | null => {
    const value = statement === null ? undefined : statement[field];
    return isString(value) ? value : null;
  };
  return {
    createdAt: isString(evidence.createdAt) ? evidence.createdAt : null,
    taskSetHash: stated("taskSetHash"),
    agentHash: stated("agentHash"),
    correctnessModelHash: stated("correctnessModelHash"),
  };
}

/** The recorded limit margin as a per-family table. Each row states its within-5% count as a share
 *  of the paired limits in words, so a reader of the JSON sees the proportion without dividing. */
function limitMarginTable(campaignDir: string, runId: string): OutcomeMetrics["limitMargin"] {
  const recorded = readLimitMargin(limitMarginFile(campaignDir, runId));
  if (recorded === null) return null;
  return {
    pairing: recorded.pairing,
    families: recorded.families.map((row) => {
      const share = row.paired === 0 ? null : row.within5pct / row.paired;
      const percent = share === null ? "no paired limits" : `${Math.round(share * 100)}%`;
      return {
        ...row,
        shareWithin5pct: share,
        reading: `${row.family}: ${row.within5pct} of ${row.paired} paired ${row.limits} limits within 5% of the reference (${percent}), ${row.within1pct} within 1%, ${row.unpaired} unpaired, over ${row.tasks} task(s); ${row.limits === "hidden" ? "heuristic" : "declared"} pairing`,
      };
    }),
  };
}

function batteryMetrics(
  rows: readonly CaseRecordRow[],
  runId: string,
  campaignDir: string,
  roots: readonly string[],
  declaredTools: readonly string[] | null,
): OutcomeMetrics {
  const scored = scoredCases(rows);
  const successes = passedCount(rows);
  const { byKind, isolationStrengths, isolationUnproven, families, telemetryCases, observedCalls } = foldRows(
    rows,
    campaignDir,
    roots,
  );
  const tally = outcomeTally(telemetryCases.map((row) => row.outcome));
  return {
    runId,
    claim: claimFacts(campaignDir, runId),
    limitMargin: limitMarginTable(campaignDir, runId),
    identity: {
      backendPins: sorted(rows.map((r) => r.backendPin)),
      builderIds: sorted(rows.map((r) => r.builderId)),
      buildInputsHashes: sorted(rows.map((r) => r.buildInputsHash)),
      slugs: sorted(rows.map((r) => r.slug)),
      variants: sorted(rows.flatMap((r) => (r.condition === null ? [] : [r.condition.variant]))),
      isolationStrengths,
      isolationUnproven,
    },
    cases: {
      total: rows.length,
      verified: tally.verified,
      passed: successes,
      failed: tally.failed,
      unaccepted: tally.unaccepted,
      nonResults: {
        total: tally.nonResults,
        byKind,
        environmentOwnedKinds: Object.keys(byKind)
          .filter((k) => isNonResultKind(k) && ENVIRONMENT_OWNED_NONRESULT_KINDS.has(k))
          .sort(),
      },
    },
    passRate: {
      successes,
      n: scored.length,
      rate: scored.length === 0 ? null : successes / scored.length,
      wilson: wilsonInterval(successes, scored.length),
    },
    families,
    telemetry: telemetryBlock(telemetryCases, successes),
    tools: {
      ...toolCensus(declaredTools, observedCalls),
      byName: mergeToolStats(telemetryCases.map((c) => c.byTool)),
      ...solveCoverage(telemetryCases.map((c) => c.byTool)),
    },
  };
}

/** A terminal supplies the exact admitted battery set. Before it exists, select recorded rows
 *  with canonical controller iteration/legacy ids, keeping each battery's denominator separate. */
export function outcomeReport(
  campaignDir: string,
  selector: string,
  bundleDir: string | null,
): OutcomeReport {
  const recordPath = join(campaignDir, CASE_RECORD_FILE);
  const controller = readControllerEvidence(campaignDir, selector);
  let rows: CaseRecordRow[];
  try {
    rows = readCaseRecord(recordPath).map((stored) => stored.row);
  } catch (error) {
    if (controller.state !== "recorded" || controller.denominator.state !== "invalid") throw error;
    rows = [];
  }
  const roots = campaignTraceRoots(campaignDir);
  const declaredTools = declaredToolNames(bundleDir);
  const selectedRunIds = new Set(
    controller.state === "recorded"
      ? controller.batteryRunIds
      : rows.map((row) => row.runId).filter((runId) => isControllerBatteryRunId(selector, runId)),
  );
  const byBattery = new Map<string, CaseRecordRow[]>();
  // Case rows are not the admission record. A battery that was recorded as
  // `skipped-precase` deliberately contributes no row, but its controller
  // iteration still admits a zero-case condition. Seed those ids from the
  // already validated terminal evidence; an absent/unfinished controller
  // contributes no battery, and no disposition is inferred for legacy or
  // drive-died zero-row evidence.
  if (controller.state === "recorded" && controller.denominator.state === "recorded") {
    for (const runId of controller.batteryRunIds) byBattery.set(runId, []);
  }
  for (const row of rows) {
    if (!selectedRunIds.has(row.runId)) continue;
    const battery = byBattery.get(row.runId) ?? [];
    battery.push(row);
    byBattery.set(row.runId, battery);
  }
  // Batteries print in the order their claims were created. A run id orders nothing: a variant
  // suffixed `-repair-on` sorts before `-repair-off` whichever of the two actually ran first. A
  // battery with no claim has no chronology and stays visible first.
  const measured = [...byBattery.entries()].map(
    ([runId, batteryRows]) =>
      [runId, batteryMetrics(batteryRows, runId, campaignDir, roots, declaredTools)] as const,
  );
  measured.sort(
    ([a, ma], [b, mb]) =>
      (ma.claim.createdAt ?? "").localeCompare(mb.claim.createdAt ?? "") || a.localeCompare(b),
  );
  const batteries: Record<string, OutcomeMetrics> = Object.fromEntries(measured);
  const report: OutcomeReport = {
    schema: OUTCOME_METRICS_SCHEMA,
    selector,
    controller,
    caseRecord: existsSync(recordPath) ? "present" : "absent",
    batteries,
    promotions: promotionRows(campaignDir, selector),
    bundle: bundleRecord(bundleDir),
  };
  return report;
}
