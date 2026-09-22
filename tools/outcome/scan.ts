/**
 * Deterministic anomaly scan over one run's OutcomeReport — the unexpected choices an operator
 * would otherwise have to notice by reading JSON.
 *
 * It reports findings without blocking a run. Nothing here changes pass, acceptance or
 * claimability (tenet 9): the scan puts a fact in front of the operator, who must assess its
 * cause and importance before acting on it.
 *
 * Every rule reads a recorded field or a frozen policy row read again at run time.
 * The scan introduces no threshold chosen after seeing the outcome (tenet 12).
 * Where no frozen number applies, the rule uses a direct comparison instead: "more
 * errors than successes", "cost rose while the pass rate held". A rule that needed a constant to
 * be interesting was left out.
 *
 * Worked example: run 15 passed 25/25 with advisers. Run 16 passed 25/25 both with and
 * without advisers. `POLICY.climb.band` was [0.20, 0.50] at the time — the pass-rate window
 * a difficulty level is supposed to land in (the ceiling moved to 0.75 on 2026-08-10) — so all
 * three batteries sat far above the band's upper bound and no report said so. The comparison
 * number had been fixed before the runs; the review had not used it.
 *
 * What it cannot see: whether a finding matters. `tools-never-called` on a fresh domain is
 * expected; on a mature one it may reveal unused functionality. The scan cannot tell. Findings
 * come out in rule-declaration order, which is not an importance ranking.
 */
import { placeOnBand } from "../../src/claim/battery-difficulty.ts";
import { type ClimbThresholds, climbThresholds } from "../../src/run/climb-history.ts";
import type { CaseTelemetry, ClaimFacts, OutcomeMetrics, OutcomeReport } from "./metrics.ts";

const OUTCOME_SCAN_SCHEMA = "outcome-scan/v1";

interface ScanFinding {
  rule: string;
  /** The battery this is about; null when the finding is a comparison between batteries. */
  battery: string | null;
  /** One sentence with the numbers in it. The numbers are the point. */
  statement: string;
}

interface ScanReport {
  schema: typeof OUTCOME_SCAN_SCHEMA;
  selector: string;
  /** The frozen numbers this scan read, echoed so a finding can be checked against them. */
  thresholds: ClimbThresholds;
  batteries: string[];
  findings: ScanFinding[];
}

const f2 = (n: number): string => n.toFixed(2);

/** Pass rate against the frozen climb band, read the way the difficulty selector reads it: through
 *  `placeOnBand`, not the point rate. Run 51 showed why the two disagree — 18/25 = 0.72 sits above
 *  a [0.20, 0.60] band while its interval [0.524, 0.857] overlaps it, so the scan called "too easy"
 *  a battery the selector held at the limit. The confidence interval changes with battery size; the
 *  point rate alone misses that, and a battery too thin to separate reports nothing here because
 *  its interval already spans the band. */
function rateFindings(m: OutcomeMetrics, t: ClimbThresholds): ScanFinding[] {
  const { rate, n, successes } = m.passRate;
  const out: ScanFinding[] = [];
  if (rate === null) return out;
  const [low, high] = t.band;
  if (rate === 1 || rate === 0) {
    const kind = rate === 1 ? "ceiling" : "floor";
    out.push({
      rule: "battery-saturated",
      battery: m.runId,
      statement: `${successes}/${n} = ${f2(rate)} is a ${kind} effect. Every case had the same result, so this task level found no useful difficulty boundary and an adviser comparison has nothing to measure.`,
    });
    return out;
  }
  const placement = placeOnBand(successes, n, t.band);
  if (placement !== null && (placement.zone === "too-easy" || placement.zone === "too-hard")) {
    const { lo, hi, zone } = placement;
    out.push({
      rule: "pass-rate-outside-band",
      battery: m.runId,
      statement: `${successes}/${n} = ${f2(rate)}, Wilson interval [${f2(lo)}, ${f2(hi)}], sits ${zone === "too-easy" ? "above" : "below"} the target pass-rate range [${f2(low)}, ${f2(high)}] — the bounds the difficulty selector reads; direction evidence, not a difficulty verdict; a correctnessModel defect produces the same number.`,
    });
  }
  return out;
}

/** One battery is one condition. More than one value in any identity list means it was not. */
function identityFindings(m: OutcomeMetrics): ScanFinding[] {
  const lists: Array<[string, string[]]> = [
    ["backendPins", m.identity.backendPins],
    ["builderIds", m.identity.builderIds],
    ["buildInputsHashes", m.identity.buildInputsHashes],
    ["slugs", m.identity.slugs],
  ];
  const out: ScanFinding[] = lists
    .values()
    .filter(([, values]) => values.length > 1)
    .map(([field, values]) => ({
      rule: "identity-fan-out",
      battery: m.runId,
      statement: `${values.length} different ${field} values appear in one battery (${values.join(", ")}). The cases were measured under different conditions, so the combined result is not attributable.`,
    }))
    .toArray();
  if (m.identity.isolationUnproven > 0) {
    out.push({
      rule: "isolation-unproven",
      battery: m.runId,
      statement: `${m.identity.isolationUnproven} of ${m.cases.total} cases have no sandbox evidence. These cases are non-results and must stay out of the score.`,
    });
  }
  return out;
}

function censusFindings(m: OutcomeMetrics): ScanFinding[] {
  const out: ScanFinding[] = [];
  const { nonResults } = m.cases;
  if (nonResults.total > 0) {
    out.push({
      rule: "non-results-present",
      battery: m.runId,
      statement: `${nonResults.total} of ${m.cases.total} cases were excluded as non-results (${Object.entries(
        nonResults.byKind,
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(
          ", ",
        )}). They are correctly outside the pass-rate denominator; each one points to a component that needs attention.`,
    });
  }
  if (m.cases.unaccepted > 0) {
    out.push({
      rule: "unaccepted-submits",
      battery: m.runId,
      statement: `${m.cases.unaccepted} cases never reached an accepted submission and have no truth verdict. The counts alone do not establish why submission was absent. They stay outside the capability rate; they count as difficulty failures only when the battery has a verified case.`,
    });
  }
  return out;
}

/** Was anything recorded, and do the recorded values differ between cases? */
function telemetryFindings(m: OutcomeMetrics): ScanFinding[] {
  const out: ScanFinding[] = [];
  const tel = m.telemetry;
  if (tel.recorded < m.cases.total) {
    out.push({
      rule: "telemetry-incomplete",
      battery: m.runId,
      statement: `${tel.recorded} of ${m.cases.total} cases have a verified trace. The others explicitly report no trace, so every telemetry number below covers only those ${tel.recorded} cases.`,
    });
  }
  for (const [field, s] of [
    ["turns", tel.turnSpread],
    ["toolCalls", tel.toolCallSpread],
  ] as const) {
    if (s === null || s.n < 2 || s.min !== s.max) continue;
    out.push({
      rule: "telemetry-constant",
      battery: m.runId,
      statement: `${field} is ${s.min} in all ${s.n} recorded cases. This value cannot explain any difference between the cases.`,
    });
  }
  const failed = tel.cases.filter((c: CaseTelemetry) => c.outcome === "fail");
  const diagnosable = failed.filter((c) => c.telemetry === "recorded");
  if (failed.length > 0 && diagnosable.length === 0) {
    out.push({
      rule: "diagnosis-starved",
      battery: m.runId,
      statement: `${failed.length} cases failed, and none has a readable trace. A failed case with no trace can be read by nobody, so no diagnosis is possible here.`,
    });
  }
  if (tel.costUsd !== null && m.cases.passed === 0) {
    out.push({
      rule: "spend-without-pass",
      battery: m.runId,
      statement: `$${f2(tel.costUsd.value)} reported across ${tel.costUsd.of} of ${tel.costUsd.from} turns and zero verified passes`,
    });
  }
  return out;
}

/** Which tool refused, which tool got asked the same thing twice, which was never asked at all. */
function toolFindings(m: OutcomeMetrics): ScanFinding[] {
  const out: ScanFinding[] = [];
  // Whether a refused name can be charged to the authored toolset at all. `declaredCalls` is null
  // when no bundle was resolved, and `toolCensus` then returns an EMPTY undeclaredCalls — so the
  // run-68 guard below reads "declared" for every hallucinated name and captions the isolation
  // working as a harness defect. Run w7 produced exactly that: six of nineteen scan findings were
  // refusals of `Monitor`, `write` and `bash`, none of them among the bundle's twelve declared
  // tools, and re-running the same scan with --bundle replaced all six with undeclared-tool-calls.
  const declarationReadable = m.tools.declaredCalls !== null;
  for (const [name, stat] of Object.entries(m.tools.byName).sort(([a], [b]) => a.localeCompare(b))) {
    // Strict: more calls refused than accepted. A tool the solver cannot use is the authored
    // toolset's defect, and it reads as task difficulty in the pass rate. A name the spec never
    // declared is not that defect: run 68 captioned two hallucinated names ("PushNotification",
    // "read") as harness defects when the isolation refusing them was the isolation working. The
    // undeclared-tool-calls row below already owns those names.
    if (stat.errors * 2 > stat.calls && declarationReadable && !(name in m.tools.undeclaredCalls)) {
      out.push({
        rule: "tool-refusal-concentration",
        battery: m.runId,
        statement: `${name} refused ${stat.errors} of ${stat.calls} calls. Inspect the tool and its inputs: frequent refusals may explain a lower pass rate, but the count alone cannot establish a harness defect.`,
      });
    }
    if (stat.repeats * 2 > stat.calls) {
      out.push({
        rule: "solve-thrash",
        battery: m.runId,
        statement: `${stat.repeats} of ${stat.calls} calls to ${name} repeated arguments already tried in the same solve. The solver is repeating work instead of progressing.`,
      });
    }
  }
  const refused = Object.entries(m.tools.byName).filter(([, s]) => s.errors * 2 > s.calls);
  if (!declarationReadable && refused.length > 0) {
    // Say the census is unavailable rather than letting silence read as a clean toolset.
    out.push({
      rule: "tool-declaration-unread",
      battery: m.runId,
      statement: `${refused.length} tool name(s) refused most of their calls, and no tools-spec was resolved to say whether the solver invented them. Re-run with --bundle <domain>/agent to charge them to the toolset or to the isolation.`,
    });
  }
  const undeclared = Object.entries(m.tools.undeclaredCalls);
  if (undeclared.length > 0) {
    out.push({
      rule: "undeclared-tool-calls",
      battery: m.runId,
      statement: `calls to names the tools-spec never declared: ${undeclared.map(([k, v]) => `${k}=${v}`).join(", ")}`,
    });
  }
  if (m.tools.neverCalled.length > 0) {
    out.push({
      rule: "tools-never-called",
      battery: m.runId,
      statement: `${m.tools.neverCalled.length} declared tools were never called (${m.tools.neverCalled.join(", ")}). They occupied prompt space without helping a solve.`,
    });
  }
  // Between never called and carrying the solve there is a tool the solver reached in a handful of
  // cases and left alone in the rest, while the shell did the work: one battery called
  // `screen_truss_geometry` 3 times against 179 shell calls, and nothing said so, because the
  // never-called rule fires only at zero. The bar is a fifth of the traced solves, so a tool bound
  // to one family of a five-family battery sits on the boundary rather than over it. The three
  // readings are named because the scan cannot tell them apart.
  for (const [name, solves] of Object.entries(m.tools.solvesUsing).sort(([a], [b]) => a.localeCompare(b))) {
    const declared = m.tools.declaredCalls?.[name];
    if (declared === undefined || solves === 0 || solves * 5 >= m.tools.tracedSolves) continue;
    out.push({
      rule: "tools-rarely-called",
      battery: m.runId,
      statement: `${name} was called in ${solves} of ${m.tools.tracedSolves} traced solves (${declared} calls), and occupied prompt space in all of them. Read whether its family ran, whether the operating guide names it, or whether the shell did the same work.`,
    });
  }
  const open = m.telemetry.cases.reduce((n, c) => n + (c.openCalls ?? 0), 0);
  if (open > 0) {
    // How long the interrupted turns had been running, where the trace recorded it: a solve the
    // wall stopped reports no turn duration at all, so without this the reader cannot tell a
    // minute's work from six hours of it.
    const openMs = m.telemetry.cases.reduce((n, c) => n + (c.openMs?.value ?? 0), 0);
    const ran =
      openMs === 0 ? "" : ` Their turns had been running ${Math.round(openMs / 60_000)} minutes in total.`;
    out.push({
      rule: "open-tool-calls",
      battery: m.runId,
      statement: `${open} tool calls started and never ended. This interrupted work is recorded as unknown rather than successful.${ran}`,
    });
  }
  return out;
}

/** The per-case outcome map, for deciding whether two variants measured anything different. */
function outcomeMap(m: OutcomeMetrics): string {
  return m.telemetry.cases
    .map((c) => `${c.taskId}:${c.outcome}`)
    .sort()
    .join("|");
}

const shortHash = (hash: string): string => hash.slice(0, 12);

/** The rest of the condition, once the task set is proved unchanged. A repair keeps the task
 *  condition fixed and repairs one harness component, so two same-variant batteries routinely
 *  share a `taskSetHash` while measuring two harnesses — and then the second battery's extra tool
 *  calls belong to the repaired harness, not to a condition measured twice. Returns what moved, or
 *  what the claims do not state, and null only when both hashes are stated and equal. */
function harnessMove(before: ClaimFacts, after: ClaimFacts): string | null {
  const moved: string[] = [];
  for (const field of ["agentHash", "correctnessModelHash"] as const) {
    const b = before[field];
    const a = after[field];
    if (b === null || a === null) return `the claims do not both state ${field}`;
    if (b !== a) moved.push(`${field} ${shortHash(b)} → ${shortHash(a)}`);
  }
  return moved.length === 0 ? null : `the harness moved (${moved.join(", ")})`;
}

/** One adjacent pair, once chronology is proved. More tool calls do not prove greater difficulty.
 *  Changed task or product bytes prevent a same-condition comparison; the report names that
 *  limitation rather than skipping it, because a silent skip reads as "nothing to
 *  report". Run 51 compared two batteries carrying one `taskSetHash` over 25 byte-identical
 *  public tasks and captioned it a difficulty level. */
function effortPairFinding(
  variant: string,
  before: OutcomeMetrics,
  after: OutcomeMetrics,
): ScanFinding | null {
  const b = before.telemetry.meanToolCalls;
  const a = after.telemetry.meanToolCalls;
  if (b === null || a === null || a <= b) return null;
  const rb = before.passRate.rate;
  const ra = after.passRate.rate;
  if (rb === null || ra === null || ra < rb) return null;
  const head = `variant ${variant}: mean tool calls rose ${f2(b)} → ${f2(a)} from ${before.runId} to ${after.runId}, while the pass rate stayed at ${f2(rb)} → ${f2(ra)}`;
  const hashBefore = before.claim.taskSetHash;
  const hashAfter = after.claim.taskSetHash;
  if (hashBefore === null || hashAfter === null) {
    return {
      rule: "effort-level-unproven",
      battery: null,
      statement: `${head}; no difficulty reading is stated: ${hashBefore === null ? before.runId : after.runId} states no claim taskSetHash, so the scan cannot say whether the task set moved`,
    };
  }
  if (hashBefore !== hashAfter) {
    return {
      rule: "effort-level-unproven",
      battery: null,
      statement: `${head}; no difficulty reading is stated: the task set moved (taskSetHash ${shortHash(hashBefore)} → ${shortHash(hashAfter)}), so more than the level may differ and the two batteries are not one measured step`,
    };
  }
  const move = harnessMove(before.claim, after.claim);
  if (move !== null) {
    return {
      rule: "effort-level-unproven",
      battery: null,
      statement: `${head}; no difficulty reading is stated: the task set held (taskSetHash ${shortHash(hashBefore)}) but ${move}, so the two batteries are not one condition measured twice`,
    };
  }
  return {
    rule: "effort-without-difficulty",
    battery: null,
    statement: `${head}; neither the task set nor the harness moved (taskSetHash ${shortHash(hashBefore)}), so the same condition was measured twice and cost more the second time`,
  };
}

/** Compare the same variant's consecutive batteries within one campaign. Cross-run differences stay
 * excluded because their conditions differ. */
function effortFindings(batteries: OutcomeMetrics[]): ScanFinding[] {
  const byVariant = new Map<string, OutcomeMetrics[]>();
  for (const m of batteries) {
    const variant = m.identity.variants.length === 1 ? m.identity.variants[0] : undefined;
    if (variant === undefined) continue;
    byVariant.set(variant, [...(byVariant.get(variant) ?? []), m]);
  }
  const out: ScanFinding[] = [];
  for (const [variant, unordered] of [...byVariant.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (unordered.length < 2) continue;
    const undated = unordered.filter((m) => m.claim.createdAt === null).map((m) => m.runId);
    if (undated.length > 0) {
      out.push({
        rule: "effort-order-unproven",
        battery: null,
        statement: `variant ${variant}: ${undated.join(", ")} state no claim createdAt, so the batteries carry no evidence-borne order; no before/after effort reading is stated for this variant`,
      });
      continue;
    }
    // The same variant's batteries in the order they were measured: the recorded claim
    // `createdAt`, tiebroken by run id — the key `readClimbBatteries` sorts on, and never the
    // run id alone. Insertion order used to decide this, and `metrics.ts` inserts batteries
    // sorted by run id, so run 51 published "from …-i03-repair-on to …-repair-on" with the
    // run's FIRST battery named as its last: the direction word "rose" was reversed.
    const group = [...unordered].sort(
      (a, b) =>
        (a.claim.createdAt ?? "").localeCompare(b.claim.createdAt ?? "") || a.runId.localeCompare(b.runId),
    );
    for (let i = 1; i < group.length; i += 1) {
      const before = group[i - 1];
      const after = group[i];
      if (before === undefined || after === undefined) continue;
      const finding = effortPairFinding(variant, before, after);
      if (finding !== null) out.push(finding);
    }
  }
  return out;
}

function pairFindings(batteries: OutcomeMetrics[]): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (let i = 0; i < batteries.length; i += 1) {
    for (let j = i + 1; j < batteries.length; j += 1) {
      const a = batteries[i];
      const b = batteries[j];
      if (a === undefined || b === undefined || a.cases.total === 0) continue;
      if (outcomeMap(a) !== outcomeMap(b)) continue;
      out.push({
        rule: "variants-indistinguishable",
        battery: null,
        statement: `${a.runId} and ${b.runId} have the same outcome on all ${a.cases.total} cases; this comparison shows no effect`,
      });
    }
  }
  return [...out, ...effortFindings(batteries)];
}

/** Scan one report. `thresholds` is injectable so a test states the frozen numbers it assumes
 *  instead of depending on whatever thresholds.frozen.yaml happens to hold. */
export function scanOutcome(
  report: OutcomeReport,
  thresholds: ClimbThresholds = climbThresholds(),
): ScanReport {
  const batteries = Object.values(report.batteries);
  const findings = batteries.flatMap((m) => [
    ...rateFindings(m, thresholds),
    ...identityFindings(m),
    ...censusFindings(m),
    ...telemetryFindings(m),
    ...toolFindings(m),
  ]);
  return {
    schema: OUTCOME_SCAN_SCHEMA,
    selector: report.selector,
    thresholds,
    batteries: batteries.map((m) => m.runId),
    findings: [...findings, ...pairFindings(batteries)],
  };
}
