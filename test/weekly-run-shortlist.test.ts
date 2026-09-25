/**
 * The weekly shortlist selector, read against the records its producers actually write.
 *
 * A hand-written fixture is a second, unchecked implementation of the producer. It drifts the
 * moment the producer changes, and what it hides is exactly the guard that refuses real input:
 * a fixture richer than its producer satisfies conditions no recorded run can. So every record
 * here is built by the code that writes it — the controller terminal by `writeControllerTerminal`,
 * the case denominator by `CaseRecord` rows read back through `controllerDenominator`, and the
 * scorecard by `scorecardFromReports`. Where a record is typed by the compiler, the declared
 * interface is the check; where a record is written by hand, the subject of that test is malformed
 * or absent input, or the producer needs a whole tree to write one field, and in the second case a
 * test holds the fixture against the producer's own source.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { writeCompleted } from "../src/meta/completed-json.ts";
import { runSync, runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import { BUILDER_EXECUTION_SCHEMA } from "../src/author/builder-execution.ts";
import { loadBudget } from "../src/run/controller-ledger.ts";
import { hostRuntimeIdentity } from "../src/run/host-runtime-policy.ts";
import { SOURCE_IDENTITY } from "../src/run/source-identity.ts";
import { controllerIterationRunId } from "../src/run/controller-battery-record-policy.ts";
import {
  CAMPAIGN_OPENING_SCHEMA,
  type ControllerEvidence,
  prepareControllerTerminal,
  readControllerEvidence,
  writeControllerTerminal,
} from "../src/run/controller-evidence.ts";
import { CASE_RECORD_FILE, CaseRecord, type CaseRecordRow } from "../src/claim/case-record.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { type Denominator, controllerDenominator } from "../src/run/controller-denominator.ts";
import { scorecardFromReports } from "../tools/outcome/scorecard.ts";
import type { BuilderToolsReport } from "../tools/outcome/builder-tools.ts";
import type { OutcomeMetrics, OutcomeReport } from "../tools/outcome/metrics.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { weekWindow, withinWeek } from "../.claude/skills/main/week.ts";
import { ARCHIVE_SCHEMA } from "../.claude/skills/whole-run-investigation/scripts/archive-shape.mjs";
import {
  bindSynthesis,
  buildLunaPlan,
  buildReport,
  publishedArchives,
  rankFinalists,
  type RunFacts,
  seatFacts,
  WEEKLY_SELECTION_SCHEMA,
} from "../.claude/skills/weekly-run-review/scripts/select-best-runs.ts";

type CaseVerdict = "pass" | "fail" | "unaccepted" | "non-result";

const OSLO = "Europe/Oslo";
const SELECTOR = join(
  import.meta.dir,
  "..",
  ".claude",
  "skills",
  "weekly-run-review",
  "scripts",
  "select-best-runs.ts",
);
const scratch = scratchDir("weekly-run-shortlist-");
const source = SOURCE_IDENTITY;
let fixtureCount = 0;
const uniqueDir = (label: string): string => {
  const dir = join(scratch, `${label}-${(fixtureCount += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

afterAll(cleanupScratch);
if (source === null) throw new Error("this test builds controller evidence and needs a source identity");

/** A real git checkout: `buildReport` resolves the repository head and its campaign tree. */
function gitRepo(): string {
  const repo = uniqueDir("repo");
  const git = (...args: string[]): void => {
    runTextSyncOrThrow([
      "git",
      "-C",
      repo,
      "-c",
      "user.name=weekly fixture",
      "-c",
      "user.email=fixture@example.invalid",
      ...args,
    ]);
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "weekly selector fixture\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "fixture");
  return repo;
}

/** The verdict fields of one case, in the three combinations `caseVerdictDefect` admits. */
function verdictOf(verdict: CaseVerdict): Partial<CaseRecordRow> {
  if (verdict === "non-result") {
    return {
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResult: "provider refused the turn",
      runtimeNonResultKind: "runtime",
    };
  }
  if (verdict === "unaccepted") return { acceptedSubmit: false, truthOk: null, pass: false };
  return { acceptedSubmit: true, truthOk: verdict === "pass", pass: verdict === "pass" };
}

/** Case rows written by the record's sole writer, then counted by the controller's own reader.
 *  The denominator the selector reads is therefore the one the rows produce, not one typed here. */
async function recordedDenominator(
  campaign: string,
  runId: string,
  cases: CaseVerdict[],
): Promise<Denominator> {
  mkdirSync(campaign, { recursive: true });
  const record = CaseRecord.open(join(campaign, CASE_RECORD_FILE));
  try {
    for (const [index, verdict] of cases.entries()) {
      await record.append(caseRecordRow(`task-${index + 1}`, "family-a", { runId, ...verdictOf(verdict) }));
    }
  } finally {
    await record.close();
  }
  return controllerDenominator(campaign, [runId]);
}

/**
 * One campaign whose controller opening and terminal were produced the way a run produces them.
 * The terminal comes from its only writer. The opening's writer is private, so the assembly is
 * repeated here from the same producers it uses — the schema tag, the source identity, the host
 * runtime, the epoch selection and the budget — and never from values typed out beside them. A run
 * still in flight has an opening and no terminal. A measured run records one battery, skipped before
 * any case, which the controller counts as a recorded zero denominator.
 */
function recordedRun(input: {
  repo: string;
  projectId: string;
  runId: string;
  openedAt: string;
  ownedAtRecord?: boolean;
  finished?: boolean;
  measured?: boolean;
}) {
  const campaign = campaignDir(input.repo, input.projectId);
  const epoch = selectCampaignEpoch(campaign, { kickoff: `one line for ${input.projectId}` });
  const controllerDir = join(campaign, "controller", input.runId);
  mkdirSync(controllerDir, { recursive: true });
  const opening = {
    schema: CAMPAIGN_OPENING_SCHEMA,
    writtenAt: input.openedAt,
    runtime: hostRuntimeIdentity(),
    source,
    project: { id: input.projectId, requestDigest: "0".repeat(64) },
    runId: input.runId,
    continuation: null,
    abandonedRuns: [],
    epoch: { key: epoch.key, supersedes: epoch.supersedes },
    modelSlots: { builder: "fixture", built: "fixture", review: "fixture" },
    budget: loadBudget(campaign),
    providerResourceBudget: null,
    command: { name: "fullrun", digest: hashJsonValue({ prompt: null }) },
  };
  writeCompleted(join(controllerDir, "opening.json"), opening);
  if (input.finished === false) return { campaign, controllerDir };
  const iteration = controllerIterationRunId(input.runId, 1);
  const batteries = input.measured === false ? [] : [iteration];
  for (const recorded of batteries) {
    const log = new EvidenceLog(join(campaign, "candidates", iteration, "runs", recorded));
    log.write("battery.json", { disposition: "skipped-precase", cases: [] });
    log.record();
  }
  const prepared = prepareControllerTerminal({
    repoRoot: input.repo,
    projectId: input.projectId,
    opening: { digest: hashJsonValue(opening), epoch, runId: input.runId },
    iterations: [
      {
        runId: iteration,
        terminal: "completed",
        buildClause: null,
        buildDetail: null,
        measured: batteries.length > 0,
      },
    ],
    absentSteps: [],
    failure: null,
  });
  writeControllerTerminal(prepared, {
    token: `lock-${input.runId}`,
    ownedAtRecord: input.ownedAtRecord ?? true,
  });
  return { campaign, controllerDir };
}

/** One battery projection. `OutcomeMetrics` is the declared interface, so the compiler is the
 *  check that this record still describes what `outcomeReport` builds. */
function battery(runId: string, passed: number, failed: number, families = 2): OutcomeMetrics {
  const verified = passed + failed;
  return {
    runId,
    limitMargin: null,
    claim: {
      createdAt: "2026-09-14T09:00:00.000Z",
      taskSetHash: "t",
      agentHash: "a",
      correctnessModelHash: "c",
    },
    identity: {
      backendPins: ["claude/claude-opus-5"],
      builderIds: ["builder-1"],
      buildInputsHashes: ["hash-1"],
      slugs: ["fixture"],
      variants: [],
      isolationStrengths: { physical: verified },
      isolationUnproven: 0,
    },
    cases: {
      total: verified,
      verified,
      passed,
      failed,
      unaccepted: 0,
      nonResults: { total: 0, byKind: {}, environmentOwnedKinds: [] },
    },
    passRate: {
      successes: passed,
      n: verified,
      rate: verified === 0 ? null : passed / verified,
      wilson: null,
    },
    families: Object.fromEntries(
      Array.from({ length: families }, (_, index) => [
        `family-${index + 1}`,
        { total: 1, verified: 1, passed: index === 0 ? passed : 0, failed: 0, unaccepted: 0, nonResults: 0 },
      ]),
    ),
    telemetry: {
      cases: [],
      recorded: 0,
      meanTurns: null,
      meanToolCalls: null,
      toolCallSpread: null,
      turnSpread: null,
      repeatedCalls: null,
      erroredCalls: null,
      toolMs: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      costPerPass: null,
    },
    tools: {
      declaredCalls: {},
      undeclaredCalls: {},
      neverCalled: [],
      byName: {},
      solvesUsing: {},
      tracedSolves: verified,
    },
  };
}

/** A Builder census carrying one comparable submit pair and two comparable authoring iterations,
 *  which is the smallest census `learningYieldAxis` reports a yield for. */
function builderCensus(): BuilderToolsReport {
  const submits = ["commit-a", "commit-b"].map((commit, index) => ({
    kind: "candidate" as const,
    ordinal: index + 1,
    turn: index + 1,
    atMs: (index + 1) * 1_000,
    outcome: "refused" as const,
    stage: "bundle" as const,
    commit,
    findingsDigest: `findings-${index}`,
    findingCodes: ["tasks-verdict"],
    repeatedFindings: index === 0 ? null : false,
    findingsDelta: index === 0 ? null : { carried: 1, resolved: 0, introduced: 0 },
    workspaceChanged: index === 0 ? null : true,
    treeFirstSubmittedAsAttempt: null,
    terminal: false,
  }));
  return {
    schema: "builder-tools/v7",
    campaign: "/campaign",
    customToolCalls: null,
    epochs: [
      {
        epoch: "epoch-000000000001",
        composed: null,
        record: null,
        workshop: null,
        neverUsed: [],
        undeclared: [],
        unobserved: [],
        execution: [
          {
            schema: BUILDER_EXECUTION_SCHEMA,
            backend: "claude",
            runtimeIdentity: null,
            turns: 2,
            durationMs: 2_000,
            toolCalls: { total: 4, failed: 0, byName: { submit: 2 }, custom: 2, native: 2 },
            usage: {
              inputTokens: null,
              outputTokens: null,
              costUsd: null,
              reportedTurns: 0,
              estimatedTurns: 0,
            },
            firstToolMs: 500,
            submits,
            partialTurn: null,
            turnRetries: [],
            authoringReviews: [],
            failedByName: {},
            failedCalls: [],
            failedCallsOmitted: 0,
            customCalls: [],
            customCallsOmitted: 0,
            outcome: "recorded",
            writtenAt: new Date().toISOString(),
          },
        ],
        executionSessions: [],
        executionUnavailable: [],
        failures: { sessions: [], failed: 0, rows: 0, omitted: 0, withPartialTurn: 0 },
        authoring: {
          iterations: [
            {
              ordinal: 1,
              dir: "01-domain",
              outcome: "build-failed",
              focusOwner: "correctness-model",
              findingsHash: "first",
              semanticFindingsHash: null,
              workspaceCommit: "a".repeat(40),
              attempts: { brief: 1 },
            },
            {
              ordinal: 2,
              dir: "02-domain",
              outcome: "completed",
              focusOwner: null,
              findingsHash: "second",
              semanticFindingsHash: null,
              workspaceCommit: "b".repeat(40),
              attempts: { brief: 1 },
            },
          ],
          nonResults: [],
        },
      },
    ],
  };
}

/** Everything `seatFacts` reads, wired from the producers, for one recorded run. */
async function recordedFacts(input: {
  projectId: string;
  runId: string;
  cases: CaseVerdict[];
  batteries: OutcomeMetrics[];
  promotions?: OutcomeReport["promotions"];
}) {
  const campaign = join(uniqueDir("campaign"), input.projectId);
  const denominator = await recordedDenominator(campaign, input.runId, input.cases);
  const controller: ControllerEvidence = {
    state: "recorded",
    outcome: "completed",
    terminalReason: "completed",
    runEnd: { climb: null, provenance: [] },
    abortClause: null,
    abandonedRuns: [],
    iterations: [input.runId],
    writtenAt: "2026-09-18T12:00:00.000Z",
    lastIteration: input.runId,
    batteryRunIds: [input.runId],
    absentSteps: [],
    denominator,
    budget: loadBudget(campaign),
    providerResourceBudget: null,
    evidence: {
      opening: join("controller", input.runId, "opening.json"),
      terminal: join("controller", input.runId, "terminal.json"),
    },
  };
  const outcome: OutcomeReport = {
    schema: "outcome-metrics/v4",
    selector: input.runId,
    controller,
    caseRecord: "present",
    batteries: Object.fromEntries(input.batteries.map((row) => [row.runId, row])),
    promotions: input.promotions ?? [],
    bundle: null,
  };
  const scorecard = scorecardFromReports(builderCensus(), outcome, input.runId);
  return { outcome, scorecard };
}

/** The facts that make one run rankable, for the seat-allocation tests. */
function rankable(key: string, overrides: Partial<RunFacts> = {}) {
  return {
    key,
    facts: {
      denominator: { total: 10, verified: 10, passed: 4, unaccepted: 0, nonResults: 0 },
      batteries: {
        total: 1,
        verified: 1,
        inBand: 0,
        saturated: 0,
        nonSaturated: 0,
        nonSaturatedVerified: 0,
        nonSaturatedFamilies: 0,
      },
      movement: { candidatePromoted: 0, climbPromoted: 0, lastAuthoringOrdinal: null, learning: null },
      ...overrides,
    },
  };
}
const promotedRun = (key: string, count: number) =>
  rankable(key, {
    movement: { candidatePromoted: count, climbPromoted: 0, lastAuthoringOrdinal: null, learning: null },
  });

const reportOf = (
  repo: string,
  overrides: { now?: string; top?: number; week?: "current" | "previous" } = {},
) =>
  buildReport({
    repo,
    now: overrides.now ?? new Date(Date.now() + 1_000).toISOString(),
    week: overrides.week ?? "current",
    timeZone: OSLO,
    top: overrides.top ?? 5,
    minDurationMinutes: 30,
  });

describe("the records the selector reads", () => {
  it("takes its denominator from the case rows the run recorded", async () => {
    const { outcome, scorecard } = await recordedFacts({
      projectId: "denominator",
      runId: "denominator-run",
      cases: ["pass", "pass", "fail", "unaccepted", "non-result"],
      batteries: [battery("denominator-run", 2, 1)],
    });
    expect(seatFacts(outcome, scorecard).denominator).toEqual({
      total: 5,
      verified: 3,
      passed: 2,
      unaccepted: 1,
      nonResults: 1,
    });
  });

  it("refuses a denominator whose state no producer writes", async () => {
    const { outcome, scorecard } = await recordedFacts({
      projectId: "sealed",
      runId: "sealed-run",
      cases: ["pass", "fail"],
      batteries: [battery("sealed-run", 1, 1)],
    });
    // Producer bytes with exactly one fact changed: `Denominator` is `absent | recorded | invalid`
    // and nothing in the tree emits anything else, so an unknown state is refused rather than read.
    const drifted = structuredClone(outcome);
    if (drifted.controller.state !== "recorded") throw new Error("the fixture must record a controller");
    Object.assign(drifted.controller.denominator, { state: "sealed" });
    expect(() => seatFacts(drifted, scorecard)).toThrow("denominator-unrecorded");
  });

  it("counts a climb promotion apart from a candidate promotion", async () => {
    const { outcome, scorecard } = await recordedFacts({
      projectId: "promotions",
      runId: "promotions-run",
      cases: ["pass", "fail"],
      batteries: [battery("promotions-run", 1, 1)],
      promotions: [
        { runId: "promotions-run", decision: "promoted", experiment: "build", clauses: [] },
        { runId: "promotions-run", decision: "promoted", experiment: "climb", clauses: [] },
        {
          runId: "promotions-run",
          decision: "held",
          experiment: "build",
          clauses: ["candidate-zero-verified"],
        },
      ],
    });
    expect(seatFacts(outcome, scorecard).movement).toMatchObject({ candidatePromoted: 1, climbPromoted: 1 });
  });

  it("carries the scorecard's learning yield whole, and none when the scorecard wrote none", async () => {
    const { outcome, scorecard } = await recordedFacts({
      projectId: "yield",
      runId: "yield-run",
      cases: ["pass", "fail"],
      batteries: [battery("yield-run", 1, 1)],
    });
    expect(seatFacts(outcome, scorecard).movement.learning).toMatchObject({
      submitsCompared: 1,
      submitsMoved: 1,
    });
    const { learningYield: _written, ...withoutYield } = scorecard;
    expect(seatFacts(outcome, withoutYield).movement.learning).toBeNull();
  });

  it("separates a saturated battery from one inside the band", async () => {
    const { outcome, scorecard } = await recordedFacts({
      projectId: "saturation",
      runId: "saturation-run",
      cases: Array.from({ length: 33 }, (_, index) => (index < 13 ? "pass" : "fail")),
      batteries: [battery("saturation-run", 8, 0), battery("saturation-run-i02", 5, 20)],
    });
    expect(seatFacts(outcome, scorecard).batteries).toEqual({
      total: 2,
      verified: 2,
      inBand: 1,
      saturated: 1,
      nonSaturated: 1,
      nonSaturatedVerified: 25,
      nonSaturatedFamilies: 2,
    });
  });

  it("counts a battery above the aim but not significantly too easy as in band", async () => {
    // 13 of 25 sits one pass over the 5-to-12 aim, and its interval still reaches into the band, so
    // the owner reads it "in range, above the aim". Counting on-aim alone read it as out of band.
    const { outcome, scorecard } = await recordedFacts({
      projectId: "over-aim",
      runId: "over-aim-run",
      cases: Array.from({ length: 25 }, (_, index) => (index < 13 ? "pass" : "fail")),
      batteries: [battery("over-aim-run", 13, 12)],
    });
    expect(seatFacts(outcome, scorecard).batteries).toMatchObject({ total: 1, inBand: 1, saturated: 0 });
  });
});

describe("the controller evidence a run leaves behind", () => {
  it("ranks a run whose terminal the controller recorded, and seats it on no axis it lacks", () => {
    const repo = gitRepo();
    recordedRun({ repo, projectId: "admitted", runId: "admitted-run", openedAt: hoursAgo(3) });
    const report = reportOf(repo);
    expect(report.schema).toBe(WEEKLY_SELECTION_SCHEMA);
    expect(report.blockers).toEqual([]);
    expect(report.counts).toMatchObject({ completed: 1, durationEligible: 1, rankable: 1, selected: 0 });
    expect(report.overflow.map((row) => row.key)).toEqual(["admitted/admitted-run"]);
  });

  it("names a run that measured no battery as unrankable rather than ranking it at zero", () => {
    const repo = gitRepo();
    recordedRun({
      repo,
      projectId: "unmeasured",
      runId: "unmeasured-run",
      openedAt: hoursAgo(3),
      measured: false,
    });
    const report = reportOf(repo);
    expect(report.counts).toMatchObject({ completed: 1, durationEligible: 1, checkFailed: 1, rankable: 0 });
    expect(report.blockers).toEqual([{ key: "unmeasured/unmeasured-run", reason: "denominator-unrecorded" }]);
  });

  it("keeps a run shorter than the minimum in the census and out of the ranking", () => {
    const repo = gitRepo();
    recordedRun({ repo, projectId: "brief", runId: "brief-run", openedAt: hoursAgo(0.25) });
    recordedRun({ repo, projectId: "open", runId: "open-run", openedAt: hoursAgo(1), finished: false });
    const report = reportOf(repo);
    expect(report.counts).toMatchObject({ completed: 1, durationEligible: 0, short: 1, unfinished: 1 });
    expect(report.short.map((row) => row.key)).toEqual(["brief/brief-run"]);
    expect(report.unfinished).toEqual(["open/open-run"]);
  });

  it("names a terminal that did not own the controller lock with the controller's refusal", () => {
    const repo = gitRepo();
    const { campaign } = recordedRun({
      repo,
      projectId: "unlocked",
      runId: "unlocked-run",
      openedAt: hoursAgo(3),
      ownedAtRecord: false,
    });
    expect(() => readControllerEvidence(campaign, "unlocked-run")).toThrow(/terminal identity disagrees/);
    const report = reportOf(repo);
    expect(report.counts).toMatchObject({ completed: 0, refused: 1, rankable: 0 });
    expect(report.blockers).toEqual([
      { key: "unlocked/unlocked-run", reason: expect.stringMatching(/terminal identity disagrees/) },
    ]);
  });

  it("refuses a terminal claiming a lock field no producer writes", async () => {
    const repo = gitRepo();
    const { controllerDir } = recordedRun({
      repo,
      projectId: "sealed-lock",
      runId: "sealed-lock-run",
      openedAt: hoursAgo(3),
    });
    // Producer bytes with exactly one fact renamed. `writeControllerTerminal` writes
    // `{token, ownedAtRecord}`; a lock claiming anything else is a record this tree cannot have
    // written. The rename is done on the recorded text so nothing here re-serialises a record.
    const path = join(controllerDir, "terminal.json");
    const recorded = await Bun.file(path).text();
    const renamed = recorded.replace('"ownedAtRecord"', '"ownedAtSeal"');
    expect(renamed).not.toBe(recorded);
    writeFileSync(path, renamed);
    const report = reportOf(repo);
    expect(report.counts).toMatchObject({ completed: 0, refused: 1, rankable: 0 });
    expect(report.blockers.map((row) => row.key)).toEqual(["sealed-lock/sealed-lock-run"]);
  });

  it("refuses a terminal whose lock carries no token, as the controller's own reader does", async () => {
    const repo = gitRepo();
    const { controllerDir } = recordedRun({
      repo,
      projectId: "tokenless",
      runId: "tokenless-run",
      openedAt: hoursAgo(3),
    });
    // A copy of the terminal check that read the lock flag alone admitted this as a completed run.
    const path = join(controllerDir, "terminal.json");
    const recorded = await Bun.file(path).text();
    const emptied = recorded.replace(/"token": ?"lock-tokenless-run"/, '"token": ""');
    expect(emptied).not.toBe(recorded);
    writeFileSync(path, emptied);
    const report = reportOf(repo);
    expect(report.blockers).toEqual([
      { key: "tokenless/tokenless-run", reason: expect.stringMatching(/terminal identity disagrees/) },
    ]);
  });

  it("refuses a terminal recorded after the instant the census captured", () => {
    const repo = gitRepo();
    recordedRun({ repo, projectId: "future", runId: "future-run", openedAt: hoursAgo(3) });
    const report = reportOf(repo, { now: new Date(Date.now() - 60_000).toISOString() });
    expect(report.counts).toMatchObject({ completed: 0, refused: 1 });
    expect(report.blockers).toEqual([{ key: "future/future-run", reason: "terminal-in-future" }]);
  });
});

describe("binding a published WRI synthesis", () => {
  const commit = "a".repeat(40);
  const run = { runId: "run-1", source: { commit, dirty: false, sourceDigest: "d".repeat(64) } };
  const census = [{ ...run, campaign: "/campaigns/c" }];

  /** A published review carrying only the three fields the selector reads, under the schema the
   *  validator owns; the scaffold's own output is held to that schema where the scaffold is tested. */
  const publishArchive = (repo: string, folder: string, identity: { runId: string; commit: string }) => {
    const dir = join(repo, "notes", "runs", folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "main_synthesis.md"), `synthesis for ${identity.runId} in ${folder}\n`);
    writeFileSync(
      join(dir, "review.json"),
      `${JSON.stringify({
        schema: ARCHIVE_SCHEMA,
        identity: { runId: identity.runId, sourceRevision: identity.commit },
      })}\n`,
    );
    return dir;
  };

  it("binds a descriptive archive folder by run id and full source revision, digesting its synthesis", () => {
    const repo = gitRepo();
    publishArchive(repo, "2026-09-14-truss-adjudicated", { runId: "run-1", commit });
    expect(bindSynthesis(run, publishedArchives(repo), census)).toEqual({
      path: join(repo, "notes", "runs", "2026-09-14-truss-adjudicated", "main_synthesis.md"),
      digest: sha256("synthesis for run-1 in 2026-09-14-truss-adjudicated\n"),
    });
  });

  it("indexes no review written under another schema", () => {
    const repo = gitRepo();
    const dir = publishArchive(repo, "2026-09-14-truss", { runId: "run-1", commit });
    writeFileSync(join(dir, "review.json"), `${JSON.stringify({ schema: "wri-archive/v0" })}\n`);
    expect(publishedArchives(repo).size).toBe(0);
    expect(bindSynthesis(run, publishedArchives(repo), census)).toBe("synthesis-missing");
  });

  it("refuses an archive published against another source revision", () => {
    const repo = gitRepo();
    publishArchive(repo, "other", { runId: "run-1", commit: "b".repeat(40) });
    expect(bindSynthesis(run, publishedArchives(repo), census)).toBe("synthesis-source-mismatch");
  });

  it("refuses two archives claiming the same run and revision", () => {
    const repo = gitRepo();
    publishArchive(repo, "one", { runId: "run-1", commit });
    publishArchive(repo, "two", { runId: "run-1", commit });
    expect(bindSynthesis(run, publishedArchives(repo), census)).toBe("synthesis-conflict");
  });

  it("refuses an archive whose run and revision two campaigns both claim", () => {
    const repo = gitRepo();
    publishArchive(repo, "2026-09-14-truss", { runId: "run-1", commit });
    const twins = [...census, { ...run, campaign: "/campaigns/second" }];
    expect(bindSynthesis(run, publishedArchives(repo), twins)).toBe("synthesis-campaign-ambiguous");
  });
});

describe("what earns a run a seat", () => {
  it("gives each axis its own seat before giving any axis a second", () => {
    const promoted = promotedRun("promoted", 2);
    const inBand = rankable("in-band", {
      batteries: {
        total: 1,
        verified: 1,
        inBand: 1,
        saturated: 0,
        nonSaturated: 1,
        nonSaturatedVerified: 25,
        nonSaturatedFamilies: 3,
      },
    });
    const ranked = rankFinalists([promoted, inBand], 2);
    expect(ranked.selected.map((run) => run.key)).toEqual(["promoted", "in-band"]);
    expect(ranked.selected[0]?.selectedBecause).toEqual(["candidate-promotion"]);
    // The walk stops the instant the shortlist is full, so the run that took the last seat carries
    // only the axis that seated it, even though a later axis in the same pass also signals for it.
    expect(ranked.selected[1]?.selectedBecause).toEqual(["informative-difficulty"]);
    const roomy = rankFinalists([promoted, inBand], 5);
    expect(roomy.selected[1]?.selectedBecause).toEqual(["informative-difficulty", "non-saturated-scale"]);
  });

  it("does not read a saturated battery as informative difficulty", () => {
    // Every case verified and every one of them passing is the shape that finds no limit, so it
    // never signals the band. The axis reads `inBand`, which saturation leaves at zero.
    const saturated = rankable("saturated", {
      denominator: { total: 175, verified: 175, passed: 175, unaccepted: 0, nonResults: 0 },
      batteries: {
        total: 7,
        verified: 7,
        inBand: 0,
        saturated: 7,
        nonSaturated: 0,
        nonSaturatedVerified: 0,
        nonSaturatedFamilies: 0,
      },
    });
    const informative = rankable("in-band", {
      batteries: {
        total: 1,
        verified: 1,
        inBand: 1,
        saturated: 0,
        nonSaturated: 1,
        nonSaturatedVerified: 3,
        nonSaturatedFamilies: 2,
      },
    });
    const ranked = rankFinalists([saturated, informative], 2);
    const seated = (key: string): string[] =>
      ranked.selected.find((row) => row.key === key)?.selectedBecause ?? [];
    expect(seated("in-band")).toContain("informative-difficulty");
    expect(seated("saturated")).not.toContain("informative-difficulty");
  });

  it("seats no run on an axis whose signal it does not carry", () => {
    const ranked = rankFinalists([rankable("flat")], 5);
    expect(ranked.selected).toEqual([]);
    expect(ranked.overflow.map((run) => run.key)).toEqual(["flat"]);
  });

  it("leaves every run beyond the seat count in the overflow", () => {
    const ranked = rankFinalists([promotedRun("low", 1), promotedRun("high", 3)], 1);
    expect(ranked.selected.map((run) => run.key)).toEqual(["high"]);
    expect(ranked.overflow.map((run) => run.key)).toEqual(["low"]);
  });
});

describe("the report the selector writes", () => {
  it("puts the week boundary at Oslo midnight on both sides of the summer-time switch", () => {
    // The window is local midnight, so the UTC instant it resolves to moves by an hour when Oslo
    // leaves summer time. A window fixed in UTC would silently take an hour from one week.
    expect(weekWindow("2026-08-27T12:00:00Z", OSLO, "previous")).toMatchObject({
      start: "2026-08-16T22:00:00.000Z",
      end: "2026-08-23T22:00:00.000Z",
    });
    const autumn = weekWindow("2026-11-05T12:00:00Z", OSLO, "previous");
    expect(autumn).toMatchObject({ start: "2026-10-25T23:00:00.000Z", end: "2026-11-01T23:00:00.000Z" });
    // Half-open: the start instant is inside, the end instant belongs to the next week.
    expect(withinWeek(autumn.start, autumn)).toBe(true);
    expect(withinWeek(autumn.end, autumn)).toBe(false);
    expect(withinWeek("not an instant", autumn)).toBe(false);
  });

  it("asks two questions of each finalist and six of the field", () => {
    const finalists = ["a/r1", "z/r2"].map((key, index) => ({
      key,
      synthesis: { path: `/notes/runs/${index}/main_synthesis.md`, digest: "s".repeat(64) },
    }));
    const plan = buildLunaPlan(finalists);
    expect(plan).toHaveLength(2 * finalists.length + 6);
    expect(new Set(plan.map((task) => task.name)).size).toBe(plan.length);
    expect(plan.filter((task) => task.runKey === null)).toHaveLength(6);
    expect(buildLunaPlan([])).toEqual([]);
  });

  it("publishes its window, its axes and an empty census when the week held no run", () => {
    const report = reportOf(gitRepo(), { now: "2026-09-16T12:00:00.000Z", week: "previous" });
    expect(report.schema).toBe(WEEKLY_SELECTION_SCHEMA);
    expect(report.authority).toBe("diagnostic-shortlist-only");
    expect(report.period).toMatchObject({
      timeZone: OSLO,
      week: "previous",
      start: "2026-09-06T22:00:00.000Z",
      end: "2026-09-13T22:00:00.000Z",
    });
    expect(report.counts.completed).toBe(0);
    expect(report.luna).toMatchObject({ launchAllowed: false, tasks: [], plannedTaskCount: 16 });
  });

  it("plans no Luna review until every seat is filled and bound to a synthesis", () => {
    // A plan over fewer finalists than the shortlist asked for compares a different field, so the
    // gate is the seat count rather than the number of runs that happened to bind.
    const report = reportOf(gitRepo(), { now: "2026-09-16T12:00:00.000Z", week: "previous", top: 1 });
    expect(report.luna).toMatchObject({ plannedTaskCount: 8, launchAllowed: false, tasks: [] });
  });

  it("writes a blocked Luna manifest with no sessions, and refuses a flag it does not declare", () => {
    const repo = gitRepo();
    const out = uniqueDir("manifest");
    const manifest = join(out, "luna-sessions.json");
    const run = (...args: string[]) =>
      runSync([runtimeProcess.execPath, "--no-env-file", SELECTOR, "--repo", repo, ...args], { cwd: repo });
    expect(run("--week", "previous", "--luna-manifest", manifest, "--json").exitCode).toBe(0);
    expect(JSON.parse(readFileSync(manifest, "utf8"))).toEqual({
      workdir: repo,
      instructionsFile: join(out, "luna-sessions.instructions.md"),
      sessions: [],
    });
    expect(readFileSync(join(out, "luna-sessions.instructions.md"), "utf8")).toContain("Luna xhigh");
    expect(run("--snapshot-root", out).exitCode).toBe(2);
  });
});
