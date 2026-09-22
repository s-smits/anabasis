import { describe, expect, it } from "bun:test";
import type { ClimbThresholds } from "../src/run/climb-history.ts";
import type { CaseTelemetry, OutcomeMetrics, OutcomeReport } from "../tools/outcome/metrics.ts";
import { NO_TRACE_FACTS } from "../tools/outcome/trace-facts.ts";
import { scanOutcome } from "../tools/outcome/scan.ts";

/**
 * The deterministic anomaly scan over an outcome report.
 *
 * Its discipline is what most of these cases hold: it reports and never gates, it invents no
 * threshold — a frozen policy row or a strict comparison decides every rule — and absence stays
 * null instead of collapsing to a zero. A before/after reading is refused outright whenever the
 * two batteries did not measure one condition.
 *
 * The fixtures below build a fully recorded battery, because an incomplete one is itself a finding
 * and would attach to every case here. A case about an absence states it.
 */

const THRESHOLDS: ClimbThresholds = { band: [0.2, 0.75] };

interface BatteryOpts {
  runId: string;
  passed: number;
  n: number;
  variant?: string;
  cases?: CaseTelemetry[];
  meanToolCalls?: number;
  byName?: OutcomeMetrics["tools"]["byName"];
  undeclaredCalls?: OutcomeMetrics["tools"]["undeclaredCalls"];
  /** Null is a bundle the reader could not resolve, which is NOT the same as a clean toolset.
   *  The default fixture resolves one, because that is the configuration the findings describe. */
  declaredCalls?: OutcomeMetrics["tools"]["declaredCalls"];
  solvesUsing?: OutcomeMetrics["tools"]["solvesUsing"];
  tracedSolves?: number;
  backendPins?: string[];
  turnSpread?: OutcomeMetrics["telemetry"]["turnSpread"];
  /** The battery's recorded claim chronology key. Defaults to fixture call order, so a test that
   *  cares about order states it and the rest read as "built first, measured first". */
  createdAt?: string | null;
  taskSetHash?: string | null;
  agentHash?: string | null;
}

/** One frozen task set, so the default pair is two measurements of one condition. */
const FROZEN_TASK_SET = "374b83f105aa7cbb";
const FROZEN_AGENT = "9f2c40ab6e1d8c73";
const FROZEN_CORRECTNESS_MODEL = "51a0dd7e4b28f96c";

function telemetryCase(over: Partial<CaseTelemetry> & { taskId: string }): CaseTelemetry {
  return {
    ...NO_TRACE_FACTS,
    family: "f1",
    outcome: "pass",
    nonResultKind: null,
    telemetry: "recorded",
    ...over,
  };
}

let createdCount = 0;
const nextMintedAt = (): string => `2026-09-03T00:00:00.${String((createdCount += 1)).padStart(3, "0")}Z`;

function battery(opts: BatteryOpts): OutcomeMetrics {
  // A battery with no telemetry rows is genuinely incomplete and the scan says so, which would
  // add a finding to every case here. The default fixture is a fully recorded battery; a test
  // about missing telemetry passes its own cases.
  const cases =
    opts.cases ??
    Array.from({ length: opts.n }, (_, i) =>
      telemetryCase({ taskId: `t${i + 1}`, outcome: i < opts.passed ? "pass" : "fail" }),
    );
  return {
    runId: opts.runId,
    claim: {
      createdAt: opts.createdAt === undefined ? nextMintedAt() : opts.createdAt,
      taskSetHash: opts.taskSetHash === undefined ? FROZEN_TASK_SET : opts.taskSetHash,
      agentHash: opts.agentHash === undefined ? FROZEN_AGENT : opts.agentHash,
      correctnessModelHash: FROZEN_CORRECTNESS_MODEL,
    },
    identity: {
      backendPins: opts.backendPins ?? ["claude/claude-opus-5"],
      builderIds: ["builder-1"],
      buildInputsHashes: ["hash-1"],
      slugs: ["fixture"],
      variants: opts.variant === undefined ? [] : [opts.variant],
      isolationStrengths: { physical: opts.n },
      isolationUnproven: 0,
    },
    cases: {
      total: opts.n,
      verified: opts.n,
      passed: opts.passed,
      failed: opts.n - opts.passed,
      unaccepted: 0,
      nonResults: { total: 0, byKind: {}, environmentOwnedKinds: [] },
    },
    passRate: {
      successes: opts.passed,
      n: opts.n,
      rate: opts.n === 0 ? null : opts.passed / opts.n,
      wilson: null,
    },
    families: {},
    telemetry: {
      cases,
      recorded: cases.filter((c) => c.telemetry === "recorded").length,
      meanTurns: null,
      meanToolCalls: opts.meanToolCalls ?? null,
      toolCallSpread: null,
      turnSpread: opts.turnSpread ?? null,
      repeatedCalls: null,
      erroredCalls: null,
      toolMs: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      costPerPass: null,
    },
    tools: {
      declaredCalls: opts.declaredCalls === undefined ? {} : opts.declaredCalls,
      undeclaredCalls: opts.undeclaredCalls ?? {},
      neverCalled: [],
      byName: opts.byName ?? {},
      solvesUsing: opts.solvesUsing ?? {},
      tracedSolves: opts.tracedSolves ?? opts.n,
    },
  };
}

function report(...batteries: OutcomeMetrics[]): OutcomeReport {
  return {
    schema: "outcome-metrics/v4",
    selector: "run-99",
    controller: { state: "absent" },
    caseRecord: "present",
    batteries: Object.fromEntries(batteries.map((b) => [b.runId, b])),
    promotions: [],
    bundle: null,
  };
}

const rules = (r: ReturnType<typeof scanOutcome>): string[] => r.findings.map((f) => f.rule);

describe("the anomaly scan", () => {
  it("reads the frozen climb band instead of a threshold of its own", () => {
    const scan = scanOutcome(report(battery({ runId: "b", passed: 25, n: 25 })), THRESHOLDS);
    expect(rules(scan)).toContain("battery-saturated");
    expect(scan.thresholds.band).toEqual([0.2, 0.75]);
    // The statement carries the numbers a reader would otherwise have to look up.
    expect(scan.findings[0]?.statement).toMatch(/25\/25 = 1\.00 is a ceiling effect/);
  });

  it("a rate inside the band is not a finding", () => {
    expect(rules(scanOutcome(report(battery({ runId: "b", passed: 8, n: 25 })), THRESHOLDS))).toEqual([]);
  });

  it("a point rate above the band whose Wilson interval still overlaps it is not a finding", () => {
    // 20/25 = 0.80 sits above the 0.75 ceiling, but [0.61, 0.91] overlaps the band and the
    // difficulty selector holds. The scan reads the bounds the selector reads.
    expect(rules(scanOutcome(report(battery({ runId: "b", passed: 20, n: 25 })), THRESHOLDS))).toEqual([]);
  });

  it("a Wilson floor clearing the band ceiling is reported with its interval", () => {
    const scan = scanOutcome(report(battery({ runId: "b", passed: 24, n: 25 })), THRESHOLDS);
    expect(rules(scan)).toContain("pass-rate-outside-band");
    expect(scan.findings[0]?.statement).toMatch(
      /24\/25 = 0\.96, Wilson interval \[0\.80, 0\.99\], sits above the target pass-rate range \[0\.20, 0\.75\]/,
    );
  });

  it("a Wilson ceiling below the band floor is reported as below it", () => {
    const scan = scanOutcome(report(battery({ runId: "b", passed: 1, n: 25 })), THRESHOLDS);
    const finding = scan.findings.find((f) => f.rule === "pass-rate-outside-band");
    expect(finding?.statement).toMatch(/sits below the target pass-rate range \[0\.20, 0\.75\]/);
  });

  it("a battery too thin to separate reports nothing, because its interval spans the band", () => {
    // 1/5 = 0.20 sits on the band floor, and [0.04, 0.62] covers most of the band as well. No
    // second size threshold decides this: the interval widening with the sample is the whole rule.
    expect(rules(scanOutcome(report(battery({ runId: "b", passed: 1, n: 5 })), THRESHOLDS))).toEqual([]);
  });

  it("a constant telemetry dimension is named as carrying no signal", () => {
    const scan = scanOutcome(
      report(
        battery({
          runId: "b",
          passed: 8,
          n: 25,
          turnSpread: { min: 1, median: 1, max: 1, mean: 1, n: 25 },
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).toContain("telemetry-constant");
  });

  it("failures with no readable trace starve the diagnosis that reads failed traces only", () => {
    const cases = [
      telemetryCase({ taskId: "t1", outcome: "fail", telemetry: "trace-drifted" }),
      telemetryCase({ taskId: "t2", outcome: "fail", telemetry: "trace-missing" }),
    ];
    const scan = scanOutcome(report(battery({ runId: "b", passed: 3, n: 10, cases })), THRESHOLDS);
    expect(rules(scan)).toContain("diagnosis-starved");
  });

  // A parameterless tool digests `{}` on every call, so its repeats are its signature rather than
  // repeated work. Under the counting that preceded `trace-facts.ts`'s the battery below tripped
  // solve-thrash on a tool that behaved correctly; the trace-facts suite owns the counting.
  it("a tool whose repeats are its signature does not trip solve-thrash", () => {
    const byName = {
      materialize_files: { calls: 3, errors: 0, repeats: 0 },
      bash: { calls: 3, errors: 0, repeats: 1 },
    };
    expect(rules(scanOutcome(report(battery({ runId: "b", passed: 6, n: 6, byName }))))).not.toContain(
      "solve-thrash",
    );
  });

  it("reports a tool that returns errors on more than half its calls", () => {
    const scan = scanOutcome(
      report(
        battery({ runId: "b", passed: 3, n: 10, byName: { probe: { calls: 10, errors: 7, repeats: 6 } } }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).toContain("tool-refusal-concentration");
    expect(rules(scan)).toContain("solve-thrash");
  });

  it("says how long the turns behind open tool calls had been running", () => {
    // A solve the whole-solve wall stopped leaves its turn open, so the turn reports no duration
    // at all and the count alone cannot separate a minute of interrupted work from six hours of
    // it. One recorded truss turn ran 6 h 27 m.
    const cases = [
      telemetryCase({
        taskId: "t1",
        outcome: "fail",
        openCalls: 2,
        openMs: { value: 23_220_000, of: 1, from: 1 },
      }),
    ];
    const scan = scanOutcome(report(battery({ runId: "b", passed: 0, n: 1, cases })), THRESHOLDS);
    const finding = scan.findings.find((f) => f.rule === "open-tool-calls");
    expect(finding?.statement).toContain("2 tool calls started and never ended");
    expect(finding?.statement).toContain("running 387 minutes in total");
  });

  it("states the count alone when the traces record no elapsed time", () => {
    // Traces written before case-trace/v4 carry no observed time. The absent fact stays absent
    // rather than reading as zero minutes.
    const cases = [telemetryCase({ taskId: "t1", outcome: "fail", openCalls: 2, openMs: null })];
    const scan = scanOutcome(report(battery({ runId: "b", passed: 0, n: 1, cases })), THRESHOLDS);
    const finding = scan.findings.find((f) => f.rule === "open-tool-calls");
    expect(finding?.statement).toContain("2 tool calls started and never ended");
    expect(finding?.statement).not.toContain("minutes");
  });

  it("says which declared tools the solver reached in only a few of its solves", () => {
    // One esp32 battery called `screen_truss_geometry` 3 times against 179 shell calls. The
    // never-called rule fires only at zero, so nothing reported a tool the solver had all but
    // abandoned while it occupied prompt space in every case.
    const scan = scanOutcome(
      report(
        battery({
          runId: "b",
          passed: 5,
          n: 25,
          declaredCalls: { screen_truss_geometry: 3, bash: 179 },
          solvesUsing: { screen_truss_geometry: 3, bash: 25 },
          tracedSolves: 25,
        }),
      ),
      THRESHOLDS,
    );
    const finding = scan.findings.find((f) => f.rule === "tools-rarely-called");
    expect(finding?.statement).toContain("screen_truss_geometry was called in 3 of 25 traced solves");
    expect(finding?.statement).toContain("(3 calls)");
    // The shell carried the battery; it is not the tool that went unused.
    expect(scan.findings.filter((f) => f.rule === "tools-rarely-called")).toHaveLength(1);
  });

  it("leaves a family-bound tool and an undeclared name out of the rarely-called reading", () => {
    // A five-family battery of 25 gives a tool bound to one family five solves. That is the tool
    // working, so the bar sits below it. An undeclared name has no prompt space to occupy: the
    // undeclared-tool-calls row owns it.
    const scan = scanOutcome(
      report(
        battery({
          runId: "b",
          passed: 5,
          n: 25,
          declaredCalls: { one_family: 9 },
          solvesUsing: { one_family: 5, PushNotification: 1 },
          undeclaredCalls: { PushNotification: 1 },
          tracedSolves: 25,
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("tools-rarely-called");
  });

  it("a refused name the spec never declared stays with undeclared-tool-calls only", () => {
    // Run 68 captioned two hallucinated names ("PushNotification", "read") as harness defects;
    // the isolation refusing an undeclared name is the isolation working, not an authored-tool defect.
    const scan = scanOutcome(
      report(
        battery({
          runId: "b",
          passed: 3,
          n: 10,
          byName: { PushNotification: { calls: 1, errors: 1, repeats: 0 } },
          undeclaredCalls: { PushNotification: 1 },
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).toContain("undeclared-tool-calls");
    expect(rules(scan)).not.toContain("tool-refusal-concentration");
  });

  it("leaves tool ownership unknown when tools-spec cannot be read, as in run w7", () => {
    // With no bundle the census returns an EMPTY undeclaredCalls, so the run-68 guard above reads
    // "declared" for every hallucinated name. Run w7 scanned five batteries that way and captioned
    // `Monitor`, `write` and `bash` — none of them among the bundle's twelve declared tools — as
    // harness defects, six of its nineteen findings. Absence of a spec is not evidence of one.
    const scan = scanOutcome(
      report(
        battery({
          runId: "b",
          passed: 3,
          n: 10,
          declaredCalls: null,
          byName: { Monitor: { calls: 7, errors: 7, repeats: 0 } },
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("tool-refusal-concentration");
    // ...and it says so, rather than letting the silence read as a clean toolset.
    expect(rules(scan)).toContain("tool-declaration-unread");
  });

  it("an unresolved tools-spec with nothing refused reports nothing — the row follows the refusals", () => {
    const scan = scanOutcome(
      report(
        battery({
          runId: "b",
          passed: 3,
          n: 10,
          declaredCalls: null,
          byName: { probe: { calls: 10, errors: 0, repeats: 0 } },
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("tool-declaration-unread");
  });

  it("reports frequent refusals when the resolved spec declares the tool", () => {
    const scan = scanOutcome(
      report(
        battery({
          runId: "b",
          passed: 3,
          n: 10,
          declaredCalls: { probe: 10 },
          byName: { probe: { calls: 10, errors: 7, repeats: 0 } },
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).toContain("tool-refusal-concentration");
    expect(rules(scan)).not.toContain("tool-declaration-unread");
  });

  it("two variants agreeing on every case measured no difference", () => {
    const cases = [telemetryCase({ taskId: "t1" }), telemetryCase({ taskId: "t2" })];
    const scan = scanOutcome(
      report(
        battery({ runId: "b-off", passed: 2, n: 2, cases, variant: "repair-off" }),
        battery({ runId: "b-on", passed: 2, n: 2, cases, variant: "repair-on" }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).toContain("variants-indistinguishable");
  });

  it("more tool calls without a lower pass rate are reported", () => {
    const scan = scanOutcome(
      report(
        battery({ runId: "r-i01-on", passed: 8, n: 25, variant: "repair-on", meanToolCalls: 8.04 }),
        battery({ runId: "r-i02-on", passed: 9, n: 25, variant: "repair-on", meanToolCalls: 14.4 }),
      ),
      THRESHOLDS,
    );
    const finding = scan.findings.find((f) => f.rule === "effort-without-difficulty");
    expect(finding?.statement).toMatch(/8\.04 → 14\.40 .* while the pass rate stayed/);
    // The hostile case for the task-set gate: one frozen set across both claims still reports,
    // and says so instead of calling the second battery a later difficulty level.
    expect(finding?.statement).toMatch(
      /neither the task set nor the harness moved \(taskSetHash 374b83f105aa\)/,
    );
  });

  it("orders the pair by the claims' createdAt, not by run id", () => {
    // Lexical run-id order is i02 then i03; the recorded claims say i03 was measured first. Run 51
    // published the reverse and called the run's first battery its last.
    const scan = scanOutcome(
      report(
        battery({
          runId: "r-i02-on",
          passed: 9,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 14.4,
          createdAt: "2026-09-03T02:00:00.000Z",
        }),
        battery({
          runId: "r-i03-on",
          passed: 8,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 8.04,
          createdAt: "2026-09-03T01:00:00.000Z",
        }),
      ),
      THRESHOLDS,
    );
    const finding = scan.findings.find((f) => f.rule === "effort-without-difficulty");
    expect(finding?.statement).toMatch(/8\.04 → 14\.40 from r-i03-on to r-i02-on/);
  });

  it("refuses a difficulty reading when the task set moved between the two batteries", () => {
    const scan = scanOutcome(
      report(
        battery({
          runId: "r-i01-on",
          passed: 8,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 8.04,
          taskSetHash: "aaaaaaaaaaaa1111",
        }),
        battery({
          runId: "r-i02-on",
          passed: 9,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 14.4,
          taskSetHash: "bbbbbbbbbbbb2222",
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("effort-without-difficulty");
    const finding = scan.findings.find((f) => f.rule === "effort-level-unproven");
    expect(finding?.statement).toMatch(/task set moved \(taskSetHash aaaaaaaaaaaa → bbbbbbbbbbbb\)/);
  });

  it("refuses a difficulty reading when the task set held but the agent bundle moved", () => {
    const scan = scanOutcome(
      report(
        battery({
          runId: "r-i01-on",
          passed: 8,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 8.04,
          agentHash: "aaaaaaaaaaaa1111",
        }),
        battery({
          runId: "r-i02-on",
          passed: 9,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 14.4,
          agentHash: "bbbbbbbbbbbb2222",
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("effort-without-difficulty");
    const finding = scan.findings.find((f) => f.rule === "effort-level-unproven");
    expect(finding?.statement).toMatch(/harness moved \(agentHash aaaaaaaaaaaa → bbbbbbbbbbbb\)/);
  });

  it("refuses a difficulty reading when a battery states no claim agentHash", () => {
    const scan = scanOutcome(
      report(
        battery({ runId: "r-i01-on", passed: 8, n: 25, variant: "repair-on", meanToolCalls: 8.04 }),
        battery({
          runId: "r-i02-on",
          passed: 9,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 14.4,
          agentHash: null,
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("effort-without-difficulty");
    const finding = scan.findings.find((f) => f.rule === "effort-level-unproven");
    expect(finding?.statement).toMatch(/do not both state agentHash/);
  });

  it("refuses a difficulty reading when a battery states no claim taskSetHash", () => {
    const scan = scanOutcome(
      report(
        battery({ runId: "r-i01-on", passed: 8, n: 25, variant: "repair-on", meanToolCalls: 8.04 }),
        battery({
          runId: "r-i02-on",
          passed: 9,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 14.4,
          taskSetHash: null,
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("effort-without-difficulty");
    const finding = scan.findings.find((f) => f.rule === "effort-level-unproven");
    expect(finding?.statement).toMatch(/r-i02-on states no claim taskSetHash/);
  });

  it("states no before/after reading when a battery carries no claim chronology", () => {
    const scan = scanOutcome(
      report(
        battery({ runId: "r-i01-on", passed: 8, n: 25, variant: "repair-on", meanToolCalls: 8.04 }),
        battery({
          runId: "r-i02-on",
          passed: 9,
          n: 25,
          variant: "repair-on",
          meanToolCalls: 14.4,
          createdAt: null,
        }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("effort-without-difficulty");
    expect(rules(scan)).not.toContain("effort-level-unproven");
    const finding = scan.findings.find((f) => f.rule === "effort-order-unproven");
    expect(finding?.statement).toMatch(/r-i02-on state no claim createdAt/);
  });

  it("does not flag increased effort when the pass rate falls", () => {
    const scan = scanOutcome(
      report(
        battery({ runId: "r-i01-on", passed: 10, n: 25, variant: "repair-on", meanToolCalls: 8 }),
        battery({ runId: "r-i02-on", passed: 6, n: 25, variant: "repair-on", meanToolCalls: 14 }),
      ),
      THRESHOLDS,
    );
    expect(rules(scan)).not.toContain("effort-without-difficulty");
  });

  it("two backend pins inside one battery means the denominator pooled two conditions", () => {
    const scan = scanOutcome(
      report(battery({ runId: "b", passed: 3, n: 10, backendPins: ["claude/opus", "codex/sol"] })),
      THRESHOLDS,
    );
    expect(rules(scan)).toContain("identity-fan-out");
  });
});
