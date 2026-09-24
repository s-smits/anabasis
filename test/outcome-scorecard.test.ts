import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import {
  DIFFICULTY_DECISION_SCHEMA,
  type DifficultyDecisionEvidence,
} from "../src/run/difficulty-decision.ts";
import { type RunEnd, climbRunEnd, provenanceRunEnd, runEndAtClose } from "../src/run/run-end.ts";
import type { ClimbReadout } from "../src/run/climb-readout.ts";
import type { ControllerEvidence } from "../src/run/controller-evidence.ts";
import { sharedPackRunEnd } from "../tools/outcome/shared-pack.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { double, required } from "./helpers/doubles.ts";
import type { BuilderToolsReport } from "../tools/outcome/builder-tools.ts";
import type { OutcomeMetrics, OutcomeReport } from "../tools/outcome/metrics.ts";
import { scorecardFromReports } from "../tools/outcome/scorecard.ts";
function builderReport(): BuilderToolsReport {
  return {
    schema: "builder-tools/v7",
    campaign: "/campaign",
    customToolCalls: null,
    epochs: [
      {
        epoch: "epoch-one",
        composed: null,
        record: null,
        workshop: null,
        neverUsed: [],
        undeclared: [],
        unobserved: [],
        execution: [],
        failures: { sessions: [], failed: 0, rows: 0, omitted: 0, withPartialTurn: 0 },
        authoring: {
          iterations: [
            {
              ordinal: 1,
              dir: "01-domain",
              outcome: "build-failed",
              focusOwner: "correctness-model",
              repairOwner: null,
              findingsHash: "same",
              semanticFindingsHash: null,
              workspaceCommit: "a".repeat(40),
              sessions: [{ stage: "brief", state: "accepted", attempts: 1 }],
            },
            {
              ordinal: 2,
              dir: "02-domain",
              outcome: "build-failed",
              focusOwner: null,
              repairOwner: "correctness-model",
              findingsHash: "same",
              semanticFindingsHash: null,
              workspaceCommit: "b".repeat(40),
              sessions: [{ stage: "brief", state: "accepted", attempts: 2 }],
            },
          ],
          nonResults: [],
        },
      },
    ],
  };
}

function submit(
  ordinal: number,
  digest: string,
  commit: string,
  previous?: { digest: string; commit: string },
) {
  return {
    kind: "candidate" as const,
    ordinal,
    turn: ordinal,
    atMs: ordinal * 1_000,
    outcome: "refused" as const,
    stage: "bundle" as const,
    commit,
    findingsDigest: digest,
    findingCodes: ["tasks-shape"],
    repeatedFindings: previous === undefined ? null : previous.digest === digest,
    findingsDelta: previous === undefined ? null : { carried: 1, resolved: 0, introduced: 0 },
    workspaceChanged: previous === undefined ? null : previous.commit !== commit,
    treeFirstSubmittedAsAttempt: null,
    terminal: false,
  };
}

function executionEvidence(): BuilderToolsReport["epochs"][number]["execution"][number] {
  const commits = ["c1", "c1", "c2", "c2"];
  const submits = commits.map((commit, index) =>
    submit(
      index + 1,
      "same-findings",
      commit,
      index === 0
        ? undefined
        : { digest: "same-findings", commit: required(commits[index - 1], "the previous commit") },
    ),
  );
  return {
    schema: "builder-execution/v6",
    backend: "claude",
    runtimeIdentity: null,
    turns: 4,
    durationMs: 4_000,
    toolCalls: { total: 8, failed: 0, byName: { submit: 4 }, custom: 4, native: 4 },
    usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedTurns: 0, estimatedTurns: 0 },
    firstToolMs: 500,
    submits,
    partialTurn: null,
    turnRetries: [],
    authoringReviews: [],
    failedCalls: [],
    failedCallsOmitted: 0,
    failedByName: {},
    customCalls: [],
    customCallsOmitted: 0,
    outcome: "turn-bound",
    writtenAt: "2026-08-01T00:00:00.000Z",
  };
}

/** Two epochs whose records were written out of file order, as run 25's campaign was. */
function outOfOrderEpochs(): BuilderToolsReport {
  const report = builderReport();
  const first = required(report.epochs[0], "the fixture epoch");
  const early = {
    ...executionEvidence(),
    writtenAt: "2026-08-01T00:00:00.000Z",
    submits: [submit(1, "d1", "early-commit")],
  };
  const late = {
    ...executionEvidence(),
    writtenAt: "2026-08-01T09:00:00.000Z",
    submits: [
      { ...submit(1, "d2", "accepted-commit"), outcome: "accepted" as const, stage: null },
      submit(2, "d3", "last-commit"),
    ],
  };
  // File order puts the late record first; only `writtenAt` says which session ran last.
  return { ...report, epochs: [{ ...first, execution: [late, early] }] };
}

describe("parent identities from the execution records", () => {
  it("names the last candidate and the accepted one, ordered by recorded time", () => {
    const scorecard = scorecardFromReports(outOfOrderEpochs(), null, "run-1");
    expect(scorecard.reach?.parents).toEqual({
      lastCandidate: {
        commit: "last-commit",
        epoch: "epoch-one",
        ordinal: 2,
        writtenAt: "2026-08-01T09:00:00.000Z",
      },
      accepted: {
        commit: "accepted-commit",
        epoch: "epoch-one",
        ordinal: 1,
        writtenAt: "2026-08-01T09:00:00.000Z",
      },
    });
  });

  it("never hands the lastCandidate slot to a record flushed after another invocation recorded", () => {
    // Run 25 flushed two records 18 and 28 minutes after their terminals; their late writtenAt
    // sorted them last and a stray took the lineage. A postTerminal record is kept and named in
    // the execution census, but it cannot move the parents.
    const report = builderReport();
    const first = required(report.epochs[0], "the fixture epoch");
    const live = {
      ...executionEvidence(),
      writtenAt: "2026-08-01T01:00:00.000Z",
      submits: [submit(1, "d1", "live-commit")],
    };
    const stray = {
      ...executionEvidence(),
      writtenAt: "2026-08-01T09:00:00.000Z",
      postTerminal: { runId: "run-0", closedAt: "2026-08-01T02:00:00.000Z" },
      submits: [submit(1, "d2", "stray-commit")],
    };
    const scorecard = scorecardFromReports(
      { ...report, epochs: [{ ...first, execution: [live, stray] }] },
      null,
      "run-1",
    );
    expect(scorecard.reach?.parents?.lastCandidate?.commit).toBe("live-commit");
  });

  it("leaves accepted null when every submission was refused", () => {
    const report = builderReport();
    const first = required(report.epochs[0], "the fixture epoch");
    const scorecard = scorecardFromReports(
      { ...report, epochs: [{ ...first, execution: [executionEvidence()] }] },
      null,
      "run-1",
    );
    expect(scorecard.reach?.parents?.accepted).toBeNull();
    expect(scorecard.reach?.parents?.lastCandidate?.commit).toBe("c2");
  });

  it("omits parent identities when no candidate was submitted", () => {
    // Absence stays absence: omit the parent fields when no candidate record exists.
    expect(scorecardFromReports(builderReport(), null, "run-1").reach).not.toHaveProperty("parents");
  });
});

describe("the evidence-bound campaign scorecard", () => {
  it("keeps controller closure absent when no controller evidence exists", () => {
    const scorecard = scorecardFromReports(builderReport(), null, "run-1");
    expect(scorecard.authority).toBe("diagnostic-only");
    expect(scorecard.reach?.lastAuthoring).toMatchObject({
      epoch: "epoch-one",
      ordinal: 2,
      outcome: "build-failed",
      workspaceCommit: "b".repeat(40),
    });
    // No controller evidence means no controller row: the scorecard reports what the evidence states,
    // never a state inferred from repeated findings hashes.
    expect(scorecard.reach).not.toHaveProperty("controller");
    expect(scorecard.authoringEfficiency).toEqual({
      iterations: 2,
      callsBySession: { brief: 3 },
      repeatedFindingHashes: ["same"],
      reauthoredAcceptedSessions: { brief: 1 },
    });
    expect(scorecard).not.toHaveProperty("runtimeEfficiency");
    expect(scorecard.evidence).not.toHaveProperty("cases");
  });

  // Two iterations, the same findings hash, no execution evidence: one comparable pair that did not
  // move. The submit denominator stays 0 because this epoch predates builder-execution.json, which
  // is why the metric reports its two denominators separately rather than as one rate.
  it("reports iteration movement even when no execution evidence exists", () => {
    const scorecard = scorecardFromReports(builderReport(), null, "run-1");
    expect(scorecard.learningYield).toEqual({
      submits: { compared: 0, moved: 0, stalled: 0, unchangedTree: 0 },
      iterations: { compared: 1, moved: 0 },
    });
    expect(scorecard.unavailable).toEqual(["climb", "intervention"]);
  });

  it("keeps submission yield unavailable when selected execution evidence is invalid", () => {
    const builder = builderReport();
    const epoch = builder.epochs[0];
    if (epoch === undefined) throw new Error("fixture epoch missing");
    epoch.executionUnavailable = ["epoch-one/builder-execution.json: invalid v4 shape"];
    const scorecard = scorecardFromReports(builder, null, "run-1");
    expect(scorecard).not.toHaveProperty("learningYield");
    expect(scorecard.unavailable).toContain("learningYield");
  });

  it("does not count submits from an in-flight or evidence-unavailable execution", () => {
    const builder = builderReport();
    const epoch = builder.epochs[0];
    if (epoch === undefined) throw new Error("fixture epoch missing");
    const execution = executionEvidence();
    epoch.execution = [{ ...execution, outcome: "in-flight" }];
    expect(scorecardFromReports(builder, null, "run-1")).not.toHaveProperty("learningYield");

    epoch.execution = [{ ...execution, outcome: "evidence-unavailable" }];
    expect(scorecardFromReports(builder, null, "run-1")).not.toHaveProperty("learningYield");

    // Closing a checkpoint at the terminal states when the run ended; it does not turn the
    // checkpoint's aggregates into a settled comparison, so the metric stays unavailable.
    epoch.execution = [{ ...execution, outcome: "recorded-at-terminal" }];
    expect(scorecardFromReports(builder, null, "run-1")).not.toHaveProperty("learningYield");
  });

  // Run 35 in miniature: four submissions, three with a predecessor, all three refused with the
  // findings before them, two of those against a tree that had not moved at all.
  it("partitions repeat submissions into moved, stalled and unchanged tree", () => {
    const builder = builderReport();
    const epoch = builder.epochs[0];
    if (epoch === undefined) throw new Error("fixture epoch missing");
    epoch.execution = [executionEvidence()];
    const learning = scorecardFromReports(builder, null, "run-1").learningYield;
    expect(learning?.submits).toEqual({ compared: 3, moved: 0, stalled: 1, unchangedTree: 2 });
    // moved + stalled + unchangedTree covers the whole comparison denominator. Unchanged
    // trees get their own category, even if a later execution returns different findings.
    expect<unknown>(
      (learning?.submits.moved ?? 0) +
        (learning?.submits.stalled ?? 0) +
        (learning?.submits.unchangedTree ?? 0),
    ).toBe(learning?.submits.compared);
  });

  // The gates stage runs probes in workers, so identical bytes can settle differently — a timeout
  // once, clean the next time. Deriving stalled as `repeated - unchangedTree` made that case
  // negative and the three rows stopped partitioning. Classifying per submit holds either way.
  it("partitions when an unchanged tree returns findings that differ", () => {
    const builder = builderReport();
    const epoch = builder.epochs[0];
    if (epoch === undefined) throw new Error("fixture epoch missing");
    const execution = executionEvidence();
    const fourth = execution.submits[3];
    if (fourth === undefined) throw new Error("fixture submit missing");
    // Same commit as its predecessor, different findings: the gates stage completed differently.
    execution.submits[3] = { ...fourth, findingsDigest: "gates-timeout", repeatedFindings: false };
    epoch.execution = [execution];
    const submits = scorecardFromReports(builder, null, "run-1").learningYield?.submits;
    expect(submits).toEqual({ compared: 3, moved: 0, stalled: 1, unchangedTree: 2 });
    expect<unknown>((submits?.moved ?? 0) + (submits?.stalled ?? 0) + (submits?.unchangedTree ?? 0)).toBe(
      submits?.compared,
    );
  });

  // The controller's own budget row states its kind, and the reader keeps it out of the
  // candidate denominator without rewriting the recorded bytes.
  it("keeps a terminal controller refusal out of the denominator", () => {
    const builder = builderReport();
    const epoch = builder.epochs[0];
    if (epoch === undefined) throw new Error("fixture epoch missing");
    const execution = executionEvidence();
    const last = execution.submits[3];
    if (last === undefined) throw new Error("fixture submit missing");
    execution.submits[3] = {
      ...last,
      kind: "controller-terminal",
      commit: "budget-limited",
      repeatedFindings: false,
      terminal: true,
    };
    epoch.execution = [execution];
    const submits = scorecardFromReports(builder, null, "run-1").learningYield?.submits;
    expect(submits).toEqual({ compared: 2, moved: 0, stalled: 1, unchangedTree: 1 });
  });

  it("keeps a real terminal candidate in the diagnostic denominator", () => {
    const builder = builderReport();
    const epoch = builder.epochs[0];
    if (epoch === undefined) throw new Error("fixture epoch missing");
    const execution = executionEvidence();
    const last = execution.submits[3];
    if (last === undefined) throw new Error("fixture submit missing");
    epoch.execution = [
      {
        ...execution,
        submits: [
          ...execution.submits.slice(0, 3),
          { ...last, kind: "candidate", terminal: true, workspaceChanged: true, repeatedFindings: false },
        ],
      },
    ];
    const submits = scorecardFromReports(builder, null, "run-1").learningYield?.submits;
    expect(submits).toEqual({ compared: 3, moved: 1, stalled: 1, unchangedTree: 1 });
  });

  it("names learningYield unavailable when nothing has a predecessor to differ from", () => {
    const builder = builderReport();
    const epoch = builder.epochs[0];
    if (epoch === undefined) throw new Error("fixture epoch missing");
    const iteration = epoch.authoring.iterations[0];
    if (iteration === undefined) throw new Error("fixture iteration missing");
    epoch.authoring.iterations = [iteration];
    const scorecard = scorecardFromReports(builder, null, "run-1");
    expect(scorecard).not.toHaveProperty("learningYield");
    expect(scorecard.unavailable).toEqual(["learningYield", "climb", "intervention"]);
  });

  it("preserves an unfinished opening even after repeated build failures", () => {
    const outcome = {
      schema: "outcome-metrics/v4",
      selector: "run-1",
      controller: {
        state: "unfinished",
        lockHeld: false,
        holder: "absent",
        evidence: { opening: "controller/run-1/opening.json" },
      },
      caseRecord: "absent",
      batteries: {},
      promotions: [],
      bundle: null,
    } satisfies OutcomeReport;
    const scorecard = scorecardFromReports(builderReport(), outcome, "run-1");
    expect(scorecard.reach?.controller).toEqual(outcome.controller);
  });

  it("keeps each battery denominator separate and leaves unreported cost absent", () => {
    // The scorecard reads the denominators and telemetry; identity, passRate, families and tools
    // belong to the same battery but never reach this projection.
    const battery: Partial<OutcomeMetrics> = {
      runId: "run-1-on",
      cases: {
        total: 5,
        verified: 3,
        passed: 2,
        failed: 1,
        unaccepted: 1,
        nonResults: { total: 1, byKind: {}, environmentOwnedKinds: [] },
      },
      telemetry: {
        cases: [],
        recorded: 2,
        meanTurns: 4,
        meanToolCalls: null,
        toolCallSpread: null,
        turnSpread: null,
        repeatedCalls: null,
        erroredCalls: null,
        toolMs: null,
        inputTokens: { value: 120, of: 2, from: 2 },
        outputTokens: null,
        costUsd: null,
        costPerPass: null,
      },
    };
    const outcome = {
      schema: "outcome-metrics/v4",
      selector: "run-1",
      controller: { state: "absent" },
      caseRecord: "present",
      bundle: null,
      promotions: [],
      batteries: { "run-1-on": double<OutcomeMetrics>(battery) },
    } satisfies OutcomeReport;
    const scorecard = scorecardFromReports(builderReport(), outcome, "run-1");
    expect(scorecard.reach?.batteries).toEqual([
      {
        runId: "run-1-on",
        total: 5,
        verified: 3,
        passed: 2,
        failed: 1,
        unaccepted: 1,
        nonResults: 1,
      },
    ]);
    expect(scorecard.runtimeEfficiency?.batteries[0]).toMatchObject({
      runId: "run-1-on",
      recordedCases: 2,
      meanTurns: 4,
      inputTokens: { value: 120, from: 2 },
    });
    expect(scorecard.runtimeEfficiency?.batteries[0]).not.toHaveProperty("meanToolCalls");
    expect(scorecard.runtimeEfficiency?.batteries[0]).not.toHaveProperty("costUsd");
  });

  // Run 12x in miniature: a re-run re-selected an earlier-created epoch (`selectCampaignEpoch`
  // re-points `current` without moving that epoch's position in the append-order record), so its
  // repair iteration was written chronologically last while still flattening before the
  // later-appended epoch's older iteration. lastAuthoring must report the repair, not the append
  // order's tail.
  it("reports the chronologically newest authoring row even when a later-created epoch is older", () => {
    const builder = builderReport();
    // epoch-one (appended first) carries the chronologically LATER iteration.
    const epochOne = builder.epochs[0];
    if (epochOne === undefined) throw new Error("fixture epoch missing");
    const iterationTwo = epochOne.authoring.iterations[1];
    if (iterationTwo === undefined) throw new Error("fixture iteration missing");
    epochOne.authoring.iterations = [
      { ...iterationTwo, mtimeMs: 2_000, ordinal: 6, dir: "06-repair", outcome: "fingerprinted" },
    ];
    // epoch-two (appended second, so it flattens last) carries the chronologically EARLIER
    // iteration — the state the buggy `.at(-1)` read as "last".
    builder.epochs.push({
      epoch: "epoch-two",
      composed: null,
      record: null,
      workshop: null,
      neverUsed: [],
      undeclared: [],
      unobserved: [],
      execution: [],
      failures: { sessions: [], failed: 0, rows: 0, omitted: 0, withPartialTurn: 0 },
      authoring: {
        iterations: [{ ...iterationTwo, mtimeMs: 1_000, ordinal: 2, dir: "02-domain" }],
        nonResults: [],
      },
    });
    const scorecard = scorecardFromReports(builder, null, "run-1");
    expect(scorecard.reach?.lastAuthoring).toMatchObject({
      epoch: "epoch-one",
      ordinal: 6,
      outcome: "fingerprinted",
    });
  });

  it("falls back to run order when rows carry no timestamp, matching the old fixture behaviour", () => {
    // builderReport()'s rows have no mtimeMs (an in-memory fixture, not a disk read); the newest
    // row is still the last one in run order, same as before this fix.
    const scorecard = scorecardFromReports(builderReport(), null, "run-1");
    expect(scorecard.reach?.lastAuthoring).toMatchObject({ epoch: "epoch-one", ordinal: 2 });
  });
});

describe("the run-end numbers", () => {
  afterAll(cleanupScratch);

  type Target = NonNullable<DifficultyDecisionEvidence["difficulty"]["rows"][number]["target"]>;
  const row = (
    runId: string,
    createdAt: string,
    zone: string | null,
    target: Target | null = null,
    planDigest: string | null = null,
  ) => ({
    runId,
    createdAt,
    zone,
    passed: zone === null ? null : 4,
    verified: 20,
    target,
    calibration: null,
    experiment: planDigest === null ? null : { proposal: { digest: planDigest, predictions: [] } },
  });
  const decision = (schema: string, rows: Array<ReturnType<typeof row>>) =>
    JSON.stringify({
      schema,
      runId: "r",
      slug: "s",
      digest: "d",
      frame: "f",
      difficulty: { band: [0.2, 0.5], rows },
    });

  it("reads the newest current decision, oldest battery first, and leaves an older schema unread", () => {
    const dir = scratchDir("run-end-");
    mkdirSync(join(dir, "difficulty-decisions"), { recursive: true });
    const target: Target = { comparator: "at-most", verifiedPasses: 3, result: "missed", missedBy: 1 };
    writeFileSync(
      join(dir, "difficulty-decisions", "a.json"),
      decision(DIFFICULTY_DECISION_SCHEMA, [
        row("b2", "2026-09-02", "on-aim", target),
        row("b1", "2026-09-01", "too-easy"),
      ]),
    );
    writeFileSync(
      join(dir, "difficulty-decisions", "b.json"),
      decision(DIFFICULTY_DECISION_SCHEMA, [row("b1", "2026-09-01", "too-easy")]),
    );
    writeFileSync(
      join(dir, "difficulty-decisions", "c.json"),
      decision("difficulty-decision/v5", [row("b9", "2026-09-09", "on-aim")]),
    );
    const climb = climbRunEnd(dir);
    expect(climb?.readFrom).toBe(join("difficulty-decisions", "a.json"));
    expect(climb?.batteries.map((battery) => battery.runId)).toEqual(["b1", "b2"]);
    expect([climb?.onAim, climb?.placed]).toEqual([1, 2]);
    expect(climb?.batteries[1]?.target).toEqual(target);
    expect(climb?.batteries[0]).not.toHaveProperty("target");
  });

  it("counts a check as beside packages only when a tool it names ran with packages", () => {
    const dir = scratchDir("run-end-");
    mkdirSync(join(dir, "claims"), { recursive: true });
    const statement = {
      groundings: [
        { checkId: "a", kind: "external-verifier", adapterId: "frame" },
        { checkId: "b", kind: "authored", adapterId: null, requiredToolIds: ["frame"] },
        { checkId: "c", kind: "authored", adapterId: null, requiredToolIds: ["bare"] },
        { checkId: "d", kind: "intrinsic", adapterId: null },
      ],
      verifierTools: [
        { toolId: "frame", packages: ["openseespy==3.5.1"] },
        { toolId: "bare", packages: [] },
      ],
    };
    writeFileSync(join(dir, "claims", "b1.json"), JSON.stringify({ claim: { ok: true, statement } }));
    expect(provenanceRunEnd(dir, "b1")?.byKind).toEqual({
      "external-verifier": { checks: 1, withPackages: 1 },
      authored: { checks: 2, withPackages: 1 },
      intrinsic: { checks: 1, withPackages: 0 },
    });
    expect(provenanceRunEnd(dir, "absent")).toBeNull();
  });

  const evidence = (
    planDigest: string,
    verdicts: Array<[string, "pass" | "fail" | "not-run"]>,
    schema = "experiment-evidence/v1",
  ) =>
    JSON.stringify({
      schema,
      planDigest,
      rehearsals: verdicts.map(([taskId, verdict]) => ({ taskId, family: null, verdict, wallMinutes: 1 })),
      predictionScore: { scored: 2, brier: 0.125, expected: 1.5, observed: 1 },
    });

  it("joins each battery's trials by the measured plan's digest, and says so when none or several match", () => {
    const dir = scratchDir("run-end-");
    mkdirSync(join(dir, "difficulty-decisions"), { recursive: true });
    for (const epoch of ["epoch-a", "epoch-b"]) {
      mkdirSync(join(dir, epoch, "rehearsals"), { recursive: true });
    }
    writeFileSync(
      join(dir, "difficulty-decisions", "a.json"),
      decision(DIFFICULTY_DECISION_SCHEMA, [
        row("b4", "2026-09-04", "on-aim"),
        row("b3", "2026-09-03", "on-aim", null, "p3"),
        row("b2", "2026-09-02", "on-aim", null, "p2"),
        row("b1", "2026-09-01", "too-easy", null, "p1"),
      ]),
    );
    const put = (path: string, text: string) => writeFileSync(join(dir, path), text);
    put(
      "epoch-a/rehearsals/experiment-evidence.json",
      evidence("p1", [
        ["t1", "pass"],
        ["t1", "pass"],
        ["t2", "fail"],
        ["t3", "not-run"],
      ]),
    );
    put("epoch-a/rehearsals/experiment-evidence-2.json", evidence("p3", [["t1", "pass"]]));
    put("epoch-b/rehearsals/experiment-evidence.json", evidence("p3", [["t2", "pass"]]));
    // The hostile neighbour: the right digest under a schema the writer never produced is not read.
    put(
      "epoch-b/rehearsals/experiment-evidence-2.json",
      evidence("p2", [["t1", "pass"]], "experiment-evidence/v0"),
    );
    const batteries = climbRunEnd(dir)?.batteries ?? [];
    expect(batteries.map((battery) => battery.trials)).toEqual([
      {
        state: "recorded",
        evidence: join("epoch-a", "rehearsals", "experiment-evidence.json"),
        rehearsals: 4,
        passedTasks: 1,
        predictionScore: { scored: 2, brier: 0.125, expected: 1.5, observed: 1 },
      },
      { state: "none" },
      {
        state: "ambiguous",
        evidence: [
          join("epoch-a", "rehearsals", "experiment-evidence-2.json"),
          join("epoch-b", "rehearsals", "experiment-evidence.json"),
        ],
      },
      undefined,
    ]);
  });

  it("reads a fresh readout at the terminal and counts provenance for this run's batteries alone", () => {
    const dir = scratchDir("run-end-");
    mkdirSync(join(dir, "claims"), { recursive: true });
    const statement = {
      groundings: [{ checkId: "a", kind: "authored", adapterId: null, requiredToolIds: ["frame"] }],
      verifierTools: [{ toolId: "frame", packages: ["openseespy==3.5.1"] }],
    };
    for (const runId of ["mine-i01", "sibling-i01"]) {
      writeFileSync(join(dir, "claims", `${runId}.json`), JSON.stringify({ claim: { ok: true, statement } }));
    }
    const readout = double<ClimbReadout>({
      band: [0.2, 0.5],
      rows: [row("mine-i01", "2026-09-01", "on-aim")],
    });
    const recorded = runEndAtClose(dir, () => readout, ["mine-i01"]);
    expect(recorded).toMatchObject({ climb: { readFrom: "terminal", onAim: 1, placed: 1 } });
    expect("provenance" in recorded ? recorded.provenance.map((battery) => battery.runId) : null).toEqual([
      "mine-i01",
    ]);
    // A readout that cannot be read still leaves a terminal to write, naming why it has no numbers.
    expect(
      runEndAtClose(dir, () => {
        throw new Error("no adopted product");
      }, []),
    ).toEqual({ unreadable: "no adopted product" });
    expect(runEndAtClose(dir, undefined, [])).toEqual({ climb: null, provenance: [] });
  });

  it("reports the numbers the terminal recorded over a live reading, with the limit margin per family", () => {
    const recorded: RunEnd = {
      climb: { readFrom: "terminal", band: [0.2, 0.5], onAim: 1, placed: 1, batteries: [] },
      provenance: [],
    };
    const live: RunEnd = { climb: null, provenance: [] };
    const margin = double<NonNullable<OutcomeMetrics["limitMargin"]>>({
      pairing: "nearest",
      families: [{ family: "roofs", paired: 4, within5pct: 3 }],
    });
    const outcome = {
      schema: "outcome-metrics/v4",
      selector: "run-1",
      controller: double<ControllerEvidence>({ state: "recorded", runEnd: recorded }),
      caseRecord: "absent",
      bundle: null,
      promotions: [],
      batteries: {
        "run-1-i01": double<OutcomeMetrics>({
          runId: "run-1-i01",
          limitMargin: margin,
          cases: {
            total: 4,
            verified: 4,
            passed: 3,
            failed: 1,
            unaccepted: 0,
            nonResults: { total: 0, byKind: {}, environmentOwnedKinds: [] },
          },
          telemetry: double<OutcomeMetrics["telemetry"]>({
            recorded: 0,
            meanTurns: null,
            meanToolCalls: null,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
          }),
        }),
      },
    } satisfies OutcomeReport;
    const scorecard = scorecardFromReports(builderReport(), outcome, "run-1", {
      live: () => live,
      sharedPack: { state: "no-shared-pack" },
    });
    expect(scorecard.runEnd).toMatchObject({ readFrom: "terminal", climb: recorded.climb });
    expect(scorecard.runEnd?.limitMargin).toEqual([{ runId: "run-1-i01", ...margin }]);
    expect(scorecard.runEnd?.sharedPack).toEqual({ state: "no-shared-pack" });
    // An unfinished run has no terminal yet, so the live reading stands in for it.
    const unfinished = { ...outcome, controller: double<ControllerEvidence>({ state: "unfinished" }) };
    expect(
      scorecardFromReports(builderReport(), unfinished, "run-1", {
        live: () => live,
        sharedPack: { state: "no-shared-pack" },
      }).runEnd?.readFrom,
    ).toBe("live");
  });

  it("reads the off-loop shared-pack grades for this run, and says there is none without a series", () => {
    const campaign = join(scratchDir("run-end-"), "truss-campaign");
    const series = scratchDir("run-end-series-");
    mkdirSync(join(series, "grades", "veryhard"), { recursive: true });
    writeFileSync(
      join(series, "INDEX.json"),
      JSON.stringify({
        schema: "anabasis-harness-cycles/v1",
        campaign: "truss-campaign",
        run: "run-1",
        cycles: {
          "7": { commit: "c".repeat(40), version: "run-1-i03" },
          "0": { commit: "d".repeat(40), version: null },
        },
      }),
    );
    writeFileSync(
      join(series, "grades", "veryhard", "summary.json"),
      JSON.stringify({
        schema: "cycle-grades/v1",
        sweep: "veryhard",
        queries: "round4-veryhard",
        verifierSource: "e".repeat(40),
        byCycle: { "7": { verified: 25, passed: 11, unaccepted: 0, wallTimeOut: 0, nonResults: 0 } },
      }),
    );
    expect(sharedPackRunEnd(null, campaign, "run-1")).toEqual({ state: "no-shared-pack" });
    expect(sharedPackRunEnd(series, campaign, "run-1")).toEqual({
      state: "recorded",
      series,
      sweeps: [
        {
          sweep: "veryhard",
          queries: "round4-veryhard",
          verifierSource: "e".repeat(40),
          cycles: [
            {
              cycle: 7,
              commit: "c".repeat(40),
              version: "run-1-i03",
              verified: 25,
              passed: 11,
              unaccepted: 0,
              wallTimeOut: 0,
              nonResults: 0,
            },
          ],
        },
      ],
    });
    // A series that measured another run's harness is not this run's score.
    expect(() => sharedPackRunEnd(series, campaign, "run-2")).toThrow(/run-1/);
  });
});
