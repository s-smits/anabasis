/**
 * The rebuild advice packet is the one channel by which what a battery recorded reaches the Builder
 * that writes the next one, and it has two jobs that pull against each other. It has to carry
 * enough for the Builder to act — which families failed, which checks, how often, and whether an
 * issue it has seen before came back — while carrying nothing that would hand it the answers. So
 * the cases here fall into two groups, and both matter equally.
 *
 * The first group is what the packet knows. One battery's observations are counted against the
 * right denominators, with a verified failure, an unaccepted attempt and a non-result kept apart,
 * each family's tasks and the condition it ran under are recorded beside them, and the register
 * (test/issue-register.test.ts) is advanced from the packet before. A family that leaves the task
 * set makes its issue retired rather than absent, and one that is only renamed, with its tasks still
 * running, leaves its issue unmeasured.
 *
 * The second group is what the packet must not say. A finding bound to a single case is dropped
 * rather than aggregated, the render carries families, kinds and counts but never a task id or
 * verifier text, and a diagnosis publishes its review metadata while its prose stays private.
 * Those are the leakage assertions, and a loosened one fails in the worst way available: the packet
 * still renders, the Builder still reads it, and the battery it authors next is measuring a
 * question it was quietly handed the answer to. The ids the packet records for a family's tasks are
 * the controller's, and the render names the families the tasks went to and never the tasks.
 *
 * Between them sits what the packet says a failure is, which decides what the Builder does next.
 * A list headed "Standing issues" read every verified fail as a defect to repair, and given six
 * chances to follow an earned fail the Builder changed `agent/` once and dropped or eased the failed
 * task three times. So a fail reads as an observation that may locate a limit, a diagnosis naming a
 * file reads as a hypothesis, and a Judge disagreement reads as pending review until a review
 * settles it. What evidence has shown keeps its place: a demonstrated defect reaches its bundle file
 * through the feedback route, and environment failures, disputes, settled disagreements and each
 * issue's history stay in the packet.
 *
 * Deriving a packet end to end from recorded measurement evidence is a different question and lives
 * in test/harness-measure.test.ts and test/iteration-analysis.test.ts. Here the inputs are built
 * directly, so that each rule can be put under a case of its own.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { hashJsonBytes } from "../src/meta/json-runtime.ts";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { writeCompleted } from "../src/meta/completed-json.ts";
import { join } from "../src/meta/path.ts";
import {
  admitFindings,
  hostFindings,
  type AdmittedEvidence,
  type AnalysisFinding,
  type IterationAnalysis,
} from "../src/analyse/iteration-analysis.ts";
import { JUDGE_REVIEWS_SCHEMA, type JudgeReviewsResult } from "../src/analyse/judge-reviews.ts";
import type { BatteryCondition } from "../src/author/issue-condition.ts";
import { adviceIssueId, isStanding } from "../src/author/issue-register.ts";
import {
  type RebuildAdvicePacket,
  REBUILD_ADVICE_SCHEMA,
  adviceTotals,
  blockingLine,
  deriveRebuildAdvice,
  latestRebuildAdvicePath,
  readLatestRebuildAdvice,
  rebuildAdvicePath,
  renderRebuildAdvice,
} from "../src/author/rebuild-advice.ts";
import { expectNoRestatedDuty } from "./helpers/duty-overlap.ts";
import { JOINTS, MEASURED_UNDER, READING, advicePacket, issue } from "./helpers/review-fixtures.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SLUG = "bridge-truss";
const RUN = "base";

/** The three leads the packet sorts its standing issues under, and the one-check sentence. Each is a
 *  model-visible literal, so each is spelled out once here and asserted whole. */
const FAILS =
  "Fails, each an observation that may locate a limit and a defect only where evidence shows one, largest first:";
const PENDING =
  "Judge disagreements pending review, not issues to repair until a review settles them, largest first:";
const STANDING = "Standing issues, largest first:";
const ONE_CHECK =
  "One check carrying every failure reads three ways: the answers are wrong, which may be a limit; the check refuses right answers; or the tasks leave the answer open.";

afterEach(cleanupScratch);

const other = (digit: string) => digit.repeat(64);

function caseRow(
  taskId: string,
  overrides?: Partial<IterationAnalysis["cases"][number]>,
): IterationAnalysis["cases"][number] {
  return {
    taskId,
    family: "beams",
    acceptedSubmit: true,
    truthOk: true,
    pass: true,
    runtimeNonResult: null,
    runtimeNonResultKind: null,
    traces: [],
    ...overrides,
  };
}

function analysis(
  cases: IterationAnalysis["cases"],
  runId = RUN,
  blockingByCheck: Record<string, number> = {},
  applicableByCheck?: Record<string, number>,
): IterationAnalysis {
  const verified = cases.filter((row) => row.truthOk !== null).length;
  const passed = cases.filter((row) => row.truthOk === true).length;
  return {
    schema: "iteration-analysis/v5",
    slug: SLUG,
    runId,
    treeRoot: `domains/${SLUG}`,
    identities: {
      bundleSnapshot: {
        id: "cap-1",
        agentHash: "a".repeat(64),
        correctnessModelHash: "b".repeat(64),
        scoringHash: "b".repeat(64),
        taskSetHash: "c".repeat(64),
        toolTreeDigest: null,
      },
      backendPin: "codex:test",
      builtEffort: "high",
      buildInputsHash: "d".repeat(64),
      isolationStrength: "physical",
    },
    battery: {
      runId,
      condition: { variant: "shipping", advisorsRemoved: [] },
      claimCreated: true,
      claimClauses: [],
      readinessClauses: [],
      blockingByCheck,
      // The quiet default is the shape the old single sentence assumed of every untripped check:
      // applicable to the whole verified battery. A test that means otherwise says so.
      applicableByCheck:
        applicableByCheck ?? Object.fromEntries(Object.keys(blockingByCheck).map((id) => [id, verified])),
      summary: {
        runId,
        total: cases.length,
        verified,
        unaccepted: cases.filter((row) => !row.acceptedSubmit && row.runtimeNonResult === null).length,
        nonResults: cases.filter((row) => row.runtimeNonResult !== null).length,
        passed,
        passRate: verified === 0 ? 0 : passed / verified,
        discrimination: "informative",
      },
    },
    cases,
    absent: [],
  };
}

/** A census is read when the fixture supplies one, and absent otherwise, as `runJudgeReviews` reads it. */
function judges(overrides: Partial<JudgeReviewsResult> = {}): JudgeReviewsResult {
  return {
    outcome:
      (overrides.census ?? null) === null ? { kind: "absent", why: "no census to read" } : { kind: "read" },
    schema: JUDGE_REVIEWS_SCHEMA,
    slug: SLUG,
    runId: RUN,
    judgePin: null,
    promptPolicyDigests: { census: "d".repeat(64) },
    analysisDigest: "e".repeat(64),
    census: null,
    contested: [],
    coverage: { reviewable: 0, reviewed: 0 },
    exit: {
      kind: "none",
      cases: { veto: 0, "unconfirmed-fail": 0, "disputed-pass": 0 },
      verified: 0,
      reason: "no disagreement",
    },
    ...overrides,
  };
}

/** A recorded review fixture: the packet checks only its presence. */
function reviewCensus(): JudgeReviewsResult["census"] {
  return {
    runId: RUN,
    /* SAFETY: the packet reads only the census's presence; every field it never opens is a
     * name-only double declared right here. */
    evidence: { judge: "unvalidated" } as NonNullable<JudgeReviewsResult["census"]>["evidence"],
  };
}

function admission(admitted: AnalysisFinding[] = []): AdmittedEvidence {
  return { digest: "f".repeat(64), admitted, refused: [], feedback: [], findingRoutes: [] };
}

/** The condition a fixture battery measured under: every family it ran on its own cases' tasks and
 *  the fixture's public inputs, under the fixture's scoring program and Built condition. */
function conditionOf(data: IterationAnalysis, overrides?: Partial<BatteryCondition>): BatteryCondition {
  const families = [...new Set(data.cases.map((row) => row.family))];
  return {
    scoringHash: MEASURED_UNDER.scoringHash,
    verdictClosureHash: MEASURED_UNDER.verdictClosureHash,
    publicationHash: MEASURED_UNDER.publicationHash,
    checkTools: MEASURED_UNDER.checkTools,
    measuredCondition: MEASURED_UNDER.measuredCondition,
    familyTasks: new Map(
      families.map((family) => {
        const taskIds = data.cases.filter((row) => row.family === family).map((row) => row.taskId);
        return [family, { taskIds: taskIds.toSorted(), taskInputs: MEASURED_UNDER.taskInputs }] as const;
      }),
    ),
    ...overrides,
  };
}

function derive(
  data: IterationAnalysis,
  review: JudgeReviewsResult,
  admitted: AdmittedEvidence,
  previous: RebuildAdvicePacket | null,
  condition = conditionOf(data),
): RebuildAdvicePacket {
  return deriveRebuildAdvice(data, review, admitted, previous, condition);
}

function packet(analysisCases: IterationAnalysis["cases"], previous: RebuildAdvicePacket | null = null) {
  return derive(analysis(analysisCases), judges(), admission(), previous);
}

/** A scratch repository holding the campaign's analysis directory, for the cases that write. */
function repo(): string {
  const root = scratchDir("ana-advice-");
  mkdirSync(join(root, "campaigns", SLUG, "analysis"), { recursive: true });
  return root;
}

describe("what one battery observes", () => {
  it("counts a verified failure, an unaccepted attempt and a non-result with their respective denominators", () => {
    const result = packet([
      caseRow("t1"),
      caseRow("t2", { truthOk: false, pass: false }),
      caseRow("t3", { acceptedSubmit: false, truthOk: null, pass: null }),
      caseRow("t4", {
        truthOk: null,
        pass: null,
        runtimeNonResult: "the provider returned no result",
        runtimeNonResultKind: "provider",
      }),
    ]);
    expect(result.schema).toBe(REBUILD_ADVICE_SCHEMA);
    expect(adviceTotals(result.families)).toEqual({ verified: 2, passed: 1, unaccepted: 1, nonResults: 1 });
    expect(result.issues.map((row) => [row.kind, row.count, row.denominator])).toEqual([
      ["non-result", 1, 4],
      ["unaccepted", 1, 4],
      ["verified-fail", 1, 2],
    ]);
    // Verified failures use verified cases; an unaccepted attempt has no truth verdict.
    expect(result.issues.find((row) => row.kind === "non-result")?.detail).toBe("provider");
    expect(result.issues.every(isStanding)).toBe(true);
  });

  it("reads Judge disagreements in both directions as advisory rows, dropping an unrepeated fail", () => {
    const contested = [
      {
        taskId: "t2",
        family: "beams",
        // A pass of a verifier fail draws one sample and counts on it.
        kind: "disputed-pass" as const,
        evidence: "e.json",
        rules: [],
        rationale: null,
        checkIds: [],
        artifact: "a.json",
      },
      {
        taskId: "t1",
        family: "joints",
        kind: "veto" as const,
        evidence: "e.json",
        rules: [],
        rationale: null,
        checkIds: [],
        artifact: "a.json",
      },
      {
        taskId: "t3",
        family: "trusses",
        kind: "unconfirmed-fail" as const,
        evidence: "e.json",
        rules: ["mass within the cap"],
        rationale: null,
        checkIds: [],
        artifact: "a.json",
      },
    ];
    const reason =
      "the Judge disagreed with the verifier on 2 of 2 verified cases; advice only, the verifier decides";
    const reviewed = derive(
      analysis([caseRow("t1", { family: "joints" }), caseRow("t2", { truthOk: false, pass: false })]),
      judges({
        census: reviewCensus(),
        contested,
        exit: {
          kind: "advisory",
          cases: { veto: 1, "unconfirmed-fail": 1, "disputed-pass": 1 },
          verified: 2,
          reason,
        },
      }),
      admission(),
      null,
    );
    expect(reviewed.issues.map((row) => [row.kind, row.family])).toEqual(
      expect.arrayContaining([
        ["judge-passed-verifier-failed", "beams"],
        ["judge-failed-verifier-passed", "joints"],
      ]),
    );
    // An unrepeated fail stays in the Judge census line but raises no issue.
    expect(reviewed.issues.some((row) => row.family === "trusses")).toBe(false);
    expect(reviewed.judge).toEqual({
      exit: "advisory",
      reason,
      contestedFamilies: ["beams", "joints", "trusses"],
    });
    // A battery with no Judge review contributes no Judge row.
    const unreviewed = derive(
      analysis([caseRow("t1"), caseRow("t2", { truthOk: false, pass: false })]),
      judges({ contested }),
      admission(),
      null,
    );
    expect(unreviewed.issues.some((row) => row.kind.startsWith("judge-"))).toBe(false);
    expect(unreviewed.judge).toBeNull();
  });

  it("carries aggregate findings and drops any finding bound to one case", () => {
    // An unplaced row routes nowhere, so this test measures the subject filter alone; the routing
    // filter has its own test below.
    const aggregate: AnalysisFinding = {
      defect: false,
      claim: "the battery passed all 2 verified cases",
      evidence: "campaigns/x/case-record.jsonl",
      owner: null,
      severity: "advisory",
    };
    const perCase: AnalysisFinding = {
      defect: true,
      claim: "task t2 failed its declared check",
      evidence: "campaigns/x/case-record.jsonl",
      owner: "correctness-model/tasks.json",
      subject: { taskId: "t2", family: "beams" },
    };
    const result = derive(analysis([caseRow("t1")]), judges(), admission([aggregate, perCase]), null);
    expect(result.findings).toEqual([{ owner: null, claim: aggregate.claim }]);
  });

  it("records each family's tasks and the condition the battery ran under, on the packet and on every issue it observed", () => {
    const data = analysis([caseRow("t2", { truthOk: false, pass: false }), caseRow("t1")]);
    const result = derive(data, judges(), admission(), null, {
      ...conditionOf(data),
      familyTasks: new Map([["beams", { taskIds: ["t1", "t2"], taskInputs: other("5") }]]),
    });
    expect(result.condition).toEqual({
      scoringHash: MEASURED_UNDER.scoringHash,
      verdictClosureHash: MEASURED_UNDER.verdictClosureHash,
      publicationHash: MEASURED_UNDER.publicationHash,
      checkTools: MEASURED_UNDER.checkTools,
      measuredCondition: MEASURED_UNDER.measuredCondition,
    });
    expect(result.families.map((row) => [row.taskIds, row.taskInputs])).toEqual([[["t1", "t2"], other("5")]]);
    expect(result.issues[0]?.observedUnder).toEqual({
      ...MEASURED_UNDER,
      taskIds: ["t1", "t2"],
      taskInputs: other("5"),
    });
    // A family the condition read no tasks for has none to name, and nothing vouches for its inputs.
    const unread = derive(data, judges(), admission(), null, {
      ...conditionOf(data),
      familyTasks: new Map(),
    });
    expect(unread.families.map((row) => [row.taskIds, row.taskInputs])).toEqual([[[], null]]);
  });

  it("holds an issue as unmeasured when its family is renamed between batteries, and retires it once its tasks are gone too", () => {
    // The author relabelled two tasks as "girders". Read by the name, that is a family that left the
    // task set, and the failure it carried would vanish from the next round's advice unfixed.
    const first = derive(
      analysis([caseRow("t1", { truthOk: false, pass: false }), caseRow("t2")], "r1"),
      judges(),
      admission(),
      null,
    );
    const data = analysis([caseRow("t1", { family: "girders" }), caseRow("t2", { family: "girders" })], "r2");
    const renamed = {
      ...conditionOf(data),
      familyTasks: new Map([["girders", { taskIds: ["t1", "t2"], taskInputs: other("9") }]]),
    };
    const second = derive(data, judges(), admission(), first, renamed);
    expect(second.issues).toEqual([
      expect.objectContaining({
        family: "beams",
        retired: false,
        absentBatteries: 0,
        unmeasured: ["task-inputs"],
        lastSeenRunId: "r1",
      }),
    ]);
    const text = renderRebuildAdvice(second);
    expect(text).toContain(
      "Unmeasured issues — absent from this battery, but their family did not rerun under the condition that observed them, so the absence is not a fix: beams (verified-fail: task inputs changed; its tasks now run under girders).",
    );
    expect(text).not.toContain("- beams:");
    for (const taskId of ["t1", "t2"]) expect(text).not.toContain(taskId);
    // The tasks themselves are gone from the next battery, so the issue has nothing left to be about.
    const third = derive(
      analysis([caseRow("t9", { family: "girders" })], "r3"),
      judges(),
      admission(),
      second,
    );
    expect(third.issues).toEqual([expect.objectContaining({ family: "beams", retired: true })]);
    expect(renderRebuildAdvice(third)).toBe("");
  });
});

/** The issue lines, with any diagnosis under them, that follow `lead` in `text`; [] when the lead is
 *  absent. A finding line also opens with "- ", so an issue line is told by its count. */
function under(text: string, lead: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(lead);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !/^- [^:]+: \d+\/\d+ /.test(line) && !line.startsWith("  "));
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the packet on disk", () => {
  it("reads the latest packet back, and reads a packet another schema wrote as no packet at all", () => {
    const root = repo();
    expect(readLatestRebuildAdvice(root, SLUG)).toBeNull();
    const recorded = packet([caseRow("t1", { truthOk: false, pass: false })]);
    writeFileSync(rebuildAdvicePath(root, SLUG, RUN), JSON.stringify(recorded));
    writeFileSync(latestRebuildAdvicePath(root, SLUG), JSON.stringify(recorded));
    expect(readLatestRebuildAdvice(root, SLUG)).toEqual(recorded);
    // A packet from an earlier schema belongs to the source revision that measured it, and this
    // source reads it as no register at all, which is what null already means everywhere it is
    // read. Throwing instead would end the first analyse step of every campaign recorded under an
    // older schema, so a supported `--project <existing>` continuation could not run at all.
    writeFileSync(
      latestRebuildAdvicePath(root, SLUG),
      JSON.stringify({ ...recorded, schema: "rebuild-advice/v5" }),
    );
    expect(readLatestRebuildAdvice(root, SLUG)).toBeNull();
    // Bytes that are not a packet at all are a different failure and still refuse.
    writeFileSync(latestRebuildAdvicePath(root, SLUG), "{ not json");
    expect(() => readLatestRebuildAdvice(root, SLUG)).toThrow(SyntaxError);
  });

  it("keeps a host finding's rule across the write and read that separate two rounds", () => {
    // Production puts a serializer and a parser between the two rounds, and the rule is the only
    // thing keying this finding's recurrence. Deriving twice in memory would prove the count while
    // leaving the field free to be dropped in transit.
    const root = repo();
    const evidence = `campaigns/${SLUG}/case-record.jsonl`;
    writeFileSync(join(root, evidence), "");
    const host: AnalysisFinding = {
      defect: false,
      claim: "the agent submitted nothing the verifier could read",
      evidence,
      owner: null,
      severity: "advisory",
      hostRule: "unaccepted-without-verdict",
    };
    const round = (runId: string, previous: RebuildAdvicePacket | null) => {
      const data = analysis([caseRow("t1")], runId);
      return derive(data, judges(), admitFindings(root, data, [host]), previous);
    };
    writeCompleted(latestRebuildAdvicePath(root, SLUG), round("r1", null));
    const reread = readLatestRebuildAdvice(root, SLUG);
    expect(reread?.findings[0]).toMatchObject({ hostRule: "unaccepted-without-verdict" });
    expect(round("r2", reread).findings[0]).toMatchObject({ repeated: { count: 2, since: "r1" } });
  });
});

describe("what a failure reads as", () => {
  it("presents a fail as an observation that may locate a limit, with its history, and never as a standing issue", () => {
    const text = renderRebuildAdvice(
      packet([
        caseRow("t1"),
        caseRow("t2", { family: "joints", truthOk: false, pass: false }),
        caseRow("t3", { family: "joints", acceptedSubmit: false, truthOk: null, pass: null }),
      ]),
    );
    // An unaccepted attempt is a fail as well: hard tasks may fail that way.
    expect(under(text, FAILS)).toEqual([
      "- joints: 1/2 attempts produced no accepted submission (first seen base, last seen base)",
      "- joints: 1/1 verified cases failed (first seen base, last seen base)",
    ]);
    expect(text).not.toContain("Standing issues");
    // The register's history crosses with the fail: one seen again after a complete recheck says so.
    const returned = renderRebuildAdvice(advicePacket([issue({ returned: true, lastSeenRunId: "r2" })]));
    expect(under(returned, FAILS)).toEqual([
      "- beams: 2/5 verified cases failed (first seen r1, last seen r2, seen again after an absence)",
    ]);
  });

  it("keeps a diagnosis a hypothesis: its owner, boundary and falsifier cross, its cause does not", () => {
    const rendered = renderRebuildAdvice(advicePacket([issue({ diagnosis: READING })]));
    expect(under(rendered, FAILS)[1]).toBe(
      `  diagnosis, a hypothesis until evidence shows the defect (r2: holds for 2 of 3 sampled of 3 failing cases, 1 passing contrast): agent/tools-spec.json. First failure boundary at a call to write_layout: ${READING.boundary.reading}. Falsifier: ${READING.falsifier}`,
    );
    expect(rendered).not.toContain(READING.cause);
    const atEnd = renderRebuildAdvice(
      advicePacket([
        issue({
          diagnosis: {
            ...READING,
            boundary: { tool: null, reading: "the turn cap ended the solve mid-draft" },
            support: { ...READING.support, contrasts: 0 },
          },
        }),
      ]),
    );
    expect(atEnd).toContain("no passing contrast");
    expect(atEnd).toContain(
      "First failure boundary at the solve's end: the turn cap ended the solve mid-draft.",
    );
  });

  it("routes a demonstrated defect to its bundle file, and carries only the findings no file holds", () => {
    const root = repo();
    const data = analysis([caseRow("absent", { acceptedSubmit: false, pass: false, truthOk: null })]);
    const evidence = `campaigns/${SLUG}/case-record.jsonl`;
    writeFileSync(join(root, evidence), "");
    const uncertain: AnalysisFinding = { defect: false, claim: "cause is unknown", evidence, owner: null };
    const defect: AnalysisFinding = {
      ...uncertain,
      defect: true,
      owner: "correctness-model/brief.json",
      claim: "demonstrated defect",
    };
    const admitted = admitFindings(root, data, [
      ...hostFindings(root, data),
      uncertain,
      defect,
      { ...defect, claim: "advised defect", severity: "advisory" },
      { ...uncertain, owner: "correctness-model/brief.json", claim: "placed observation" },
    ]);
    // The defect reaches the file at fault, blocking, through the feedback route the rebuild reads.
    expect(admitted.feedback.map((row) => [row.owner, row.severity, row.claim])).toEqual([
      ["correctness-model/brief.json", "blocking", "demonstrated defect"],
      ["correctness-model/brief.json", "advisory", "advised defect"],
      ["correctness-model/brief.json", "advisory", "placed observation"],
    ]);
    const result = derive(data, judges(), admitted, null);
    expect(result.findings.map((row) => [row.owner, row.hostRule ?? row.claim])).toEqual([
      [null, "unaccepted-without-verdict"],
      [null, "cause is unknown"],
    ]);
    const rendered = renderRebuildAdvice(result);
    expect(under(rendered, FAILS)).toEqual([
      "- beams: 1/1 attempts produced no accepted submission (first seen base, last seen base)",
    ]);
    expect(rendered).toContain("- unplaced: cause is unknown");
    expect(rendered).not.toContain("demonstrated defect");
    expect(rendered).not.toContain("submission admission");
    expect(rendered).not.toContain("final-submission.json");
  });

  it("presents a Judge disagreement as pending review until a review settles it", () => {
    const passedFailed = issue({
      id: adviceIssueId("judge-passed-verifier-failed", "beams", null),
      kind: "judge-passed-verifier-failed",
      count: 1,
    });
    const failedPassed = issue({
      id: adviceIssueId("judge-failed-verifier-passed", "roof", null),
      kind: "judge-failed-verifier-passed",
      family: "roof",
      count: 1,
    });
    const pending = renderRebuildAdvice(advicePacket([passedFailed, failedPassed]));
    expect(under(pending, PENDING)).toEqual([
      "- beams: 1/5 verified cases the Judge passed and the verifier failed (first seen r1, last seen r1)",
      "- roof: 1/5 verified cases the Judge failed and the verifier passed (first seen r1, last seen r1)",
    ]);
    expect(pending).not.toContain(FAILS);
    expect(pending).not.toContain("Standing issues");
    // Settled in the check's favour, it leaves the pending lead for the settled line.
    const settled = renderRebuildAdvice(advicePacket([{ ...failedPassed, judgeSettled: true }]));
    expect(settled).not.toContain(PENDING);
    expect(settled).toContain(
      "Settled Judge disagreements — an epoch review showed by execution that the check stands: roof (judge-failed-verifier-passed).",
    );
  });

  it("keeps a disputed issue apart, without its prose", () => {
    const rendered = renderRebuildAdvice(
      advicePacket([issue({ dispute: "the check cannot fail on a real task" })]),
    );
    expect(rendered).toBe(
      "Disputed issues — an epoch review argued these come from the evaluation rather than the harness: beams (verified-fail).",
    );
  });

  it("keeps a non-result a standing issue, and names the environment as the owner of an environment failure only", () => {
    const rendered = renderRebuildAdvice(
      advicePacket([
        issue({ kind: "non-result", detail: "provider" }),
        issue({ id: JOINTS, kind: "non-result", detail: "verifier", family: "joints", count: 1 }),
      ]),
    );
    expect(under(rendered, STANDING)).toEqual([
      "- beams: 2/5 environment non-results of kind provider, owned by the environment (first seen r1, last seen r1)",
      // A `verifier` kind is not an environment failure and must not read as one.
      "- joints: 1/5 runtime non-results of kind verifier, a kind that does not establish an environment failure (first seen r1, last seen r1)",
    ]);
    expect(rendered).not.toContain(FAILS);
  });

  it("reads a failure one check carries three ways, and asks nothing of failures two checks share", () => {
    const rows = [
      caseRow("t1", { truthOk: false, pass: false }),
      caseRow("t2", { truthOk: false, pass: false }),
      caseRow("t3"),
    ];
    const counts = { "member-forces": 0, "response-report-accurate": 2, deflection: 1 };
    const advice = derive(analysis(rows, RUN, counts), judges(), admission(), null);
    expect(advice.blockingByCheck).toEqual(counts);
    const shared = renderRebuildAdvice(advice);
    expect(shared).toContain(
      "Verified failures by declared check (2 failed; a case may block on several): response-report-accurate 2, deflection 1.\n",
    );
    // The check that blocked nothing is the other half of the same record, not a row to discard.
    expect(shared).toContain(
      "Declared checks that blocked no shipping artifact, with the verified cases each applied to (of 3): member-forces 3.",
    );
    expect(shared).not.toContain("One check carrying every failure");
    // One check carrying every failure: a wrong answer, which may be a limit, a check refusing a
    // right one, or a task that leaves the answer open, and no reading named first.
    const alone = blockingLine({ "member-forces": 0, deflection: 2 }, { "member-forces": 3 }, 3, 1);
    expect(alone).toContain(`deflection 2. ${ONE_CHECK}`);
    expect(alone).not.toContain("public contract");
    // A battery that declared no check records an empty map, and the packet says nothing.
    const empty = renderRebuildAdvice(derive(analysis(rows, RUN, {}), judges(), admission(), null));
    expect(empty).not.toContain("Verified failures by declared check");
    expect(empty).not.toContain("blocked no shipping artifact");
  });

  it("restates no duty the system prompt carries, in any sentence it renders", () => {
    const text = renderRebuildAdvice({
      ...advicePacket([
        issue({ diagnosis: READING }),
        issue({ id: JOINTS, family: "joints", kind: "unaccepted" }),
        issue({ id: "a".repeat(64), kind: "judge-passed-verifier-failed", family: "roof" }),
        issue({ id: "b".repeat(64), kind: "non-result", detail: "provider", family: "slabs" }),
        issue({ id: "c".repeat(64), family: "piers", dispute: "private" }),
        issue({ id: "d".repeat(64), family: "decks", unmeasured: ["scoring"] }),
        issue({ id: "e".repeat(64), family: "arches", absentBatteries: 1, rulesChangedRechecks: 1 }),
      ]),
      blockingByCheck: { deflection: 2 },
      applicableByCheck: { deflection: 5 },
    });
    for (const lead of [FAILS, PENDING, STANDING, ONE_CHECK]) expect(text).toContain(lead);
    expectNoRestatedDuty(text);
  });
});

describe("what the packet must not say", () => {
  it("renders families, kinds and counts, and never a task id or verifier text", () => {
    const result = derive(
      analysis([
        caseRow("t1", { family: "beams" }),
        caseRow("t2", { family: "joints", truthOk: false, pass: false }),
        caseRow("t3", {
          family: "joints",
          truthOk: null,
          pass: null,
          runtimeNonResult: "sandbox refused the solve",
          runtimeNonResultKind: "sandbox",
        }),
      ]),
      judges(),
      admission(),
      null,
    );
    const text = renderRebuildAdvice(result);
    expect(text).toContain("- joints: 1/1 verified cases failed (first seen base, last seen base)");
    expect(text).toContain("1/2 environment non-results of kind sandbox");
    // The battery's counts and its families' passes are the climb readout's, which renders above
    // this packet; a second copy here was a second owner of one count.
    expect(text).not.toContain("verified cases passed,");
    expect(text).not.toContain("Families that");
    for (const forbidden of ["t1", "t2", "t3", "sandbox refused the solve"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("renders the same text whatever protected detail the packet holds", () => {
    // Rule 4's mechanical test over the one renderer: the packet records protected detail (a
    // diagnosis's cause, a dispute's argument, the contested and failing task ids) beside the public
    // rows, and changing only that detail must leave every rendered byte where it was.
    const contested = judges({
      census: reviewCensus(),
      contested: [
        {
          taskId: "t7",
          family: "joints",
          kind: "disputed-pass",
          rules: [],
          rationale: null,
          checkIds: [],
          evidence: "campaigns/bridge-truss/analysis/base-judge/t7.json",
          artifact: null,
        },
      ],
      exit: {
        kind: "advisory",
        cases: { veto: 0, "unconfirmed-fail": 0, "disputed-pass": 3 },
        verified: 10,
        reason: "PUBLIC-REASON",
      },
    });
    const finding: AnalysisFinding = {
      defect: false,
      claim: "PUBLIC-CLAIM",
      evidence: "campaigns/bridge-truss/analysis/base-analysis.json",
      owner: null,
    };
    const advice = derive(
      analysis([caseRow("t1"), caseRow("t2", { truthOk: false, pass: false })], RUN, { deflection: 1 }),
      contested,
      admission([finding]),
      null,
    );
    const withReadings = (secret: string): RebuildAdvicePacket => ({
      ...advice,
      families: advice.families.map((row) => ({ ...row, taskIds: [`${secret}-1`, `${secret}-2`] })),
      issues: [
        ...advice.issues.map((row) => ({
          ...row,
          observedUnder: { ...row.observedUnder, taskIds: [`${secret}-1`] },
          diagnosis: { ...READING, cause: `${secret} cause`, runId: "r1" },
        })),
        issue({ id: JOINTS, family: "joints", dispute: `${secret} dispute` }),
      ],
    });
    const a = withReadings("PRIVATE-A");
    const b = withReadings("PRIVATE-B");
    expect(hashJsonBytes(a)).not.toBe(hashJsonBytes(b));
    const text = renderRebuildAdvice(a);
    expect(renderRebuildAdvice(b)).toBe(text);
    for (const hidden of ["PRIVATE-A", "t7", "t1", "t2"]) expect(text).not.toContain(hidden);
    // What is public crosses: the finding's claim, the Judge's reason, the contested family, the
    // diagnosis's located boundary and falsifier.
    for (const shown of ["PUBLIC-CLAIM", "PUBLIC-REASON", "families: joints", READING.falsifier]) {
      expect(text).toContain(shown);
    }
  });

  it("does not repeat a routed finding the author already reads through its owner group", () => {
    // A blocking finding with a Builder-owned owner reaches the rebuild session through
    // advisory(priorEvidence.feedback). Rendering it here too would repeat the claim in one prompt.
    const routed: AnalysisFinding = {
      defect: true,
      claim: "the checker admitted 3 ungrounded verdicts",
      evidence: "campaigns/bridge-truss/analysis/base-analysis.json",
      owner: "correctness-model/evaluator.ts",
    };
    const unrouted: AnalysisFinding = { ...routed, defect: false, owner: null };
    const admitted = admission([routed, unrouted]);
    const withRouting = {
      ...admitted,
      feedback: [
        {
          owner: "correctness-model/evaluator.ts" as const,
          severity: "blocking" as const,
          claim: routed.claim,
          evidence: `${routed.evidence} (analysis ffffffffffff)`,
          findings: [],
        },
      ],
    };
    const text = renderRebuildAdvice(derive(analysis([caseRow("t1")]), judges(), withRouting, null));
    expect(text).toContain("- unplaced: the checker admitted 3 ungrounded verdicts");
    expect(text.split("the checker admitted 3 ungrounded verdicts")).toHaveLength(2);
  });
});

describe("what the packet leaves out, and how much it shows", () => {
  it("keeps complete rechecks and retired issues in the register and out of the render", () => {
    const first = packet([caseRow("t1", { family: "beams", truthOk: false, pass: false })]);
    const second = packet([caseRow("t1", { family: "beams" })], first);
    const third = packet([caseRow("t1", { family: "beams" })], second);
    expect(third.issues.map((row) => row.absentBatteries)).toEqual([2]);
    // A family that already passes is the readout's family line, and something to raise rather than
    // repair, so neither recheck count reaches the author.
    expect(renderRebuildAdvice(second)).toBe("");
    expect(renderRebuildAdvice(third)).toBe("");
    // The family left the task set, so naming it asks the author for nothing it can do.
    const rebuilt = packet([caseRow("t9", { family: "joints" })], first);
    expect(rebuilt.issues.map((row) => row.retired)).toEqual([true]);
    expect(renderRebuildAdvice(rebuilt)).toBe("");
  });

  it("tells the author an unmeasured issue is unmeasured, not fixed and not observed", () => {
    const rendered = renderRebuildAdvice(
      advicePacket([
        issue({ unmeasured: ["task-inputs", "scoring"] }),
        issue({ id: JOINTS, family: "joints" }),
        issue({ id: "c".repeat(64), kind: "unaccepted", unmeasured: ["check-tools"] }),
      ]),
    );
    expect(rendered).toContain(
      "Unmeasured issues — absent from this battery, but their family did not rerun under the condition that observed them, so the absence is not a fix: beams (verified-fail: task inputs, scoring program changed); beams (unaccepted: check tools changed).",
    );
    expect(under(rendered, FAILS)).toEqual([
      "- joints: 2/5 verified cases failed (first seen r1, last seen r1)",
    ]);
    expect(rendered).not.toContain("fixed");
    // A family that kept its name has no tasks to say went elsewhere.
    expect(rendered).not.toContain("now run under");
  });

  it("says where an unmeasured issue's tasks went when its family's name left the battery", () => {
    const renamed = (families: Array<{ family: string; taskIds: string[] }>) => ({
      ...advicePacket([issue({ unmeasured: ["task-inputs"] })]),
      families: families.map((row) => ({ ...advicePacket([]).families[0]!, ...row })),
    });
    expect(renderRebuildAdvice(renamed([{ family: "girders", taskIds: ["t1", "t2"] }]))).toContain(
      "beams (verified-fail: task inputs changed; its tasks now run under girders).",
    );
    // Split across two names, each is named, in order, and the tasks never are.
    const split = renderRebuildAdvice(
      renamed([
        { family: "girders", taskIds: ["t1"] },
        { family: "columns", taskIds: ["t2"] },
      ]),
    );
    expect(split).toContain("task inputs changed; its tasks now run under columns, girders).");
    for (const taskId of ["t1", "t2"]) expect(split).not.toContain(taskId);
  });

  it("names the issues rechecked under changed public rules, and only when every recheck followed a change", () => {
    const rendered = renderRebuildAdvice(
      advicePacket([
        issue({ absentBatteries: 1, rulesChangedRechecks: 1 }),
        issue({ id: JOINTS, family: "joints", absentBatteries: 2, rulesChangedRechecks: 1 }),
      ]),
    );
    expect(rendered).toBe(
      "Issues rechecked under unchanged checks, public rules changed — absent from every recheck, but the public rules, in words or numbers, differed from the battery that observed them, so the absence says whether the repair held under the new rules, not whether the issue persists: beams (verified-fail).",
    );
    expect(renderRebuildAdvice(advicePacket([issue({ absentBatteries: 1 })]))).toBe("");
  });

  it("separates a check no verified case posed from one that refused nothing over the whole battery", () => {
    // Their repairs are opposite: raise the rule, or give the battery a task that reaches it.
    expect(
      blockingLine(
        { lenient: 0, narrow: 0, unposed: 0, deflection: 1 },
        { lenient: 3, narrow: 1, unposed: 0, deflection: 3 },
        3,
        2,
      ),
    ).toBe(
      [
        "Verified failures by declared check (1 failed; a case may block on several): deflection 1. " +
          ONE_CHECK,
        "Declared checks that blocked no shipping artifact, with the verified cases each applied to (of 3): lenient 3, narrow 1.",
        "Declared checks no verified case posed, so this battery measured nothing about them: unposed.",
      ].join("\n"),
    );
    // A saturated battery names every declared check, since none tripped; zero verified cases leave
    // the roster silent, and a check with no applicable count recorded lands in no list at all.
    const counts = { "geometry-and-clearance": 0, "mass-within-limit": 0 };
    expect(blockingLine(counts, { "geometry-and-clearance": 2, "mass-within-limit": 2 }, 2, 2)).toBe(
      "Declared checks that blocked no shipping artifact, with the verified cases each applied to (of 2): geometry-and-clearance 2, mass-within-limit 2.",
    );
    expect(blockingLine(counts, { "geometry-and-clearance": 0, "mass-within-limit": 0 }, 0, 0)).toBeNull();
    expect(blockingLine({ legacy: 0 }, {}, 3, 3)).toBeNull();
  });

  it("renders unplaced findings in admitted order, says how many the cap left out, and annotates a recurrence", () => {
    const findings = Array.from(
      { length: 5 },
      (_, index): AnalysisFinding => ({
        defect: false,
        claim: `observation-${index}`,
        evidence: "campaigns/bridge-truss/analysis/review.json",
        owner: null,
      }),
    );
    const text = renderRebuildAdvice(derive(analysis([caseRow("t0")]), judges(), admission(findings), null));
    expect(text).toContain("1 further admitted finding omitted from this packet.");
    expect(text).not.toContain("observation-4");
    const positions = [0, 1, 2, 3].map((index) => text.indexOf(`- unplaced: observation-${index}`));
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    expect(positions.every((position) => position >= 0)).toBe(true);

    const uncertain = (
      checkId?: string,
      artifactSchemaPath?: string,
      hostRule?: string,
    ): AnalysisFinding => ({
      defect: false,
      claim: "the reviewer could not attribute the equilibrium result",
      evidence: "campaigns/bridge-truss/analysis/review.json",
      owner: null,
      severity: "advisory",
      ...keyIfDefined("checkId", checkId),
      ...keyIfDefined("artifactSchemaPath", artifactSchemaPath),
      ...keyIfDefined("hostRule", hostRule),
    });
    const round = (runId: string, found: AnalysisFinding[], previous: RebuildAdvicePacket | null) =>
      derive(analysis([caseRow("t1")], runId), judges(), admission(found), previous);
    const first = round("r1", [uncertain("equilibrium", "members")], null);
    const third = round(
      "r3",
      [uncertain("equilibrium", "members")],
      round("r2", [uncertain("equilibrium", "members")], first),
    );
    expect(renderRebuildAdvice(first)).not.toContain("recurring");
    expect(renderRebuildAdvice(third)).toContain(
      "the reviewer could not attribute the equilibrium result (recurring: 3 consecutive packets since r1)",
    );
    // A changed check id is new evidence and starts again.
    expect(round("r4", [uncertain("deflection", "members")], third).findings[0]).not.toHaveProperty(
      "repeated",
    );
    // A host finding names no check, and the rule that produced it supports its recurrence; a round
    // without it ends the run of consecutive packets, so its return counts from one.
    const host = () => uncertain(undefined, undefined, "unaccepted-without-verdict");
    const hostSecond = round("h2", [host()], round("h1", [host()], null));
    expect(hostSecond.findings[0]).toMatchObject({ repeated: { count: 2, since: "h1" } });
    expect(round("h4", [host()], round("h3", [], hostSecond)).findings[0]).not.toHaveProperty("repeated");
  });

  it("reads no recurrence from evidence that cannot establish one", () => {
    // Two observations that named nothing, or only a bare root, are not one observation recurring
    // merely because both could not be placed. A path below a root does name a place, and recurs.
    const unattributed = (claim: string, artifactSchemaPath?: string): AnalysisFinding => ({
      defect: false,
      claim,
      evidence: "campaigns/bridge-truss/analysis/review.json",
      owner: null,
      severity: "advisory",
      ...keyIfDefined("artifactSchemaPath", artifactSchemaPath),
    });
    const round = (runId: string, found: AnalysisFinding[], previous: RebuildAdvicePacket | null) =>
      derive(analysis([caseRow("t1")], runId), judges(), admission(found), previous);
    const named = round(
      "r2",
      [unattributed("the mass budget result is unexplained")],
      round("r1", [unattributed("the deflection result is unexplained")], null),
    );
    expect(named.findings[0]).not.toHaveProperty("repeated");
    expect(renderRebuildAdvice(named)).toContain("the mass budget result is unexplained");
    expect(renderRebuildAdvice(named)).not.toContain("recurring");
    const bare = round("b2", [unattributed("a", "files")], round("b1", [unattributed("b", "files")], null));
    expect(bare.findings[0]).not.toHaveProperty("repeated");
    const below = round(
      "d2",
      [unattributed("a", "files.main")],
      round("d1", [unattributed("b", "files.main")], null),
    );
    expect(below.findings[0]).toMatchObject({ repeated: { count: 2, since: "d1" } });
  });

  it("bounds the render when the battery fails everywhere and its findings are enormous", () => {
    // The register keeps every row; the model-visible boundary is what is bounded, six issues in all.
    const rows = Array.from({ length: 10 }, (_, index) =>
      caseRow(`t${index}`, { family: `family-${index}`, truthOk: false, pass: false }),
    );
    const findings = Array.from(
      { length: 6 },
      (_, index): AnalysisFinding => ({
        defect: false,
        claim: `${index} `.padEnd(20_000, "declared assertion text "),
        evidence: "campaigns/bridge-truss/analysis/review.json",
        owner: null,
        severity: "advisory",
      }),
    );
    const result = derive(analysis(rows), judges(), admission(findings), null);
    expect(result.issues).toHaveLength(10);
    const text = renderRebuildAdvice(result);
    expect(text).toContain(FAILS.replace(", largest first:", ", largest first (6 of 10 shown):"));
    expect(text.split("\n- family-")).toHaveLength(7);
    expect(text).toContain(" bytes omitted]");
    expect(text).toContain("2 further admitted findings omitted from this packet.");
    expect(text.length).toBeLessThan(6_000);
    // The six are shared in lead order, so the fails show whole and the non-results take what is left.
    const mixed = renderRebuildAdvice(
      derive(
        analysis([
          ...rows.slice(0, 4),
          ...Array.from({ length: 4 }, (_, index) =>
            caseRow(`n${index}`, {
              family: `stalled-${index}`,
              truthOk: null,
              pass: null,
              runtimeNonResult: "sandbox refused the solve",
              runtimeNonResultKind: "sandbox",
            }),
          ),
        ]),
        judges(),
        admission(),
        null,
      ),
    );
    expect(mixed).toContain(FAILS);
    expect(mixed).toContain("Standing issues, largest first (2 of 4 shown):");
    expect(mixed.split("\n- ").filter((line) => /^(family|stalled)-/.test(line))).toHaveLength(6);
    // One byte past the per-claim cap is still cut and marked.
    const tight = renderRebuildAdvice(
      derive(
        analysis(rows),
        judges(),
        admission([
          {
            defect: false,
            claim: "c".repeat(601),
            severity: "advisory",
            evidence: "campaigns/bridge-truss/analysis/review.json",
            owner: null,
          },
        ]),
        null,
      ),
    );
    expect(tight).toContain(`: ${"c".repeat(600)} […1 byte omitted]`);
  });
});
