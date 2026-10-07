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
 * Deriving a packet end to end from recorded measurement evidence is a different question and lives
 * in test/harness-measure.test.ts and test/iteration-analysis.test.ts. Here the inputs are built
 * directly, so that each rule can be put under a case of its own.
 */
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { hashJsonBytes } from "../src/meta/json-runtime.ts";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { writeCompleted } from "../src/meta/completed-json.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import {
  admitFindings,
  hostFindings,
  type AdmittedEvidence,
  type AnalysisFinding,
  type IterationAnalysis,
} from "../src/analyse/iteration-analysis.ts";
import { JUDGE_REVIEWS_SCHEMA, type JudgeReviewsResult } from "../src/analyse/judge-reviews.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import type { BatteryCondition } from "../src/author/issue-condition.ts";
import { JOINTS, MEASURED_UNDER, READING, advicePacket, issue } from "./helpers/review-fixtures.ts";
import { type AdviceIssue, isStanding } from "../src/author/issue-register.ts";
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

const SLUG = "bridge-truss";
const RUN = "base";

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

/** One failure in two attempts; everything else about the issue is the shared fixture's. */
const priorIssue = (overrides?: Partial<AdviceIssue>): AdviceIssue =>
  issue({ count: 1, denominator: 2, ...overrides });

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

describe("the packet and what the author reads of it", () => {
  function repo(): string {
    const root = scratchDir("ana-advice-");
    mkdirSync(join(root, "campaigns", SLUG, "analysis"), { recursive: true });
    return root;
  }

  it("routes placed findings to their file, renders the unplaced ones, and invents no admission refusal", () => {
    const root = repo();
    const data = analysis([caseRow("absent", { acceptedSubmit: false, pass: false, truthOk: null })]);
    const evidence = `campaigns/${SLUG}/case-record.jsonl`;
    writeFileSync(join(root, evidence), "");
    const uncertain: AnalysisFinding = {
      defect: false,
      claim: "cause is unknown",
      evidence,
      owner: null,
    };
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
    expect(admitted.feedback.map((row) => [row.severity, row.claim])).toEqual([
      ["blocking", "demonstrated defect"],
      ["advisory", "advised defect"],
      ["advisory", "placed observation"],
    ]);
    const result = derive(data, judges(), admitted, null);
    expect(result.findings.map((row) => [row.owner, row.hostRule ?? row.claim])).toEqual([
      [null, "unaccepted-without-verdict"],
      [null, "cause is unknown"],
    ]);
    const rendered = renderRebuildAdvice(result);
    expect(rendered).toContain("1/1 attempts produced no accepted submission");
    expect(rendered).toContain("- unplaced: cause is unknown");
    expect(rendered).not.toContain("demonstrated defect");
    expect(rendered).not.toContain("submission admission");
    expect(rendered).not.toContain("final-submission.json");
  });

  it("reads the latest packet back, and reads a packet another schema wrote as no packet at all", () => {
    const root = repo();
    expect(readLatestRebuildAdvice(root, SLUG)).toBeNull();
    const recorded = packet([caseRow("t1", { truthOk: false, pass: false })]);
    writeFileSync(rebuildAdvicePath(root, SLUG, RUN), JSON.stringify(recorded));
    writeFileSync(latestRebuildAdvicePath(root, SLUG), JSON.stringify(recorded));
    expect(readLatestRebuildAdvice(root, SLUG)).toEqual(recorded);
    // A packet from an earlier schema belongs to the source revision that measured it. The v5
    // register recorded no condition an issue was observed under, so none of its issues could be
    // told apart from one whose family reran on other inputs, and this source reads it as no
    // register at all, which is what null already means everywhere it is read.
    // Throwing instead would end the first analyse step of every campaign recorded under an older
    // schema, so a supported `--project <existing>` continuation could not run at all.
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
    // Production puts a serializer and a parser between the two rounds, and the rule is the only
    // thing keying this finding's recurrence. Deriving twice in memory proves the count while
    // leaving the field free to be dropped in transit, with both sides of the join still green.
    writeCompleted(latestRebuildAdvicePath(root, SLUG), round("r1", null));
    const reread = readLatestRebuildAdvice(root, SLUG);
    expect(reread?.findings[0]).toMatchObject({ hostRule: "unaccepted-without-verdict" });
    expect(round("r2", reread).findings[0]).toMatchObject({ repeated: { count: 2, since: "r1" } });
  });

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
    // The rendered advice excludes task ids and raw failure text, regardless of the recorded rows.
    for (const forbidden of ["t1", "t2", "t3", "sandbox refused the solve"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("does not repeat a routed finding the author already reads through its owner group", () => {
    // A blocking finding with a Builder-owned owner reaches the rebuild session through
    // advisory(priorEvidence.feedback). Rendering it here too would repeat the claim in one prompt.
    // A blocking Judge exit can also repeat it in the census line. This section adds only
    // admitted findings that are not already routed to an owner.
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

  it("annotates an unplaced finding with its consecutive recurrence, keyed by what it named", () => {
    const uncertain = (checkId?: string, artifactSchemaPath?: string, hostRule?: string): AnalysisFinding => {
      const finding: AnalysisFinding = {
        defect: false,
        claim: "the reviewer could not attribute the equilibrium result",
        evidence: "campaigns/bridge-truss/analysis/review.json",
        owner: null,
        severity: "advisory",
        ...keyIfDefined("checkId", checkId),
        ...keyIfDefined("artifactSchemaPath", artifactSchemaPath),
        ...keyIfDefined("hostRule", hostRule),
      };
      return finding;
    };
    const round = (runId: string, findings: AnalysisFinding[], previous: RebuildAdvicePacket | null) =>
      derive(analysis([caseRow("t1")], runId), judges(), admission(findings), previous);
    // The same unplaced finding can render to rebuild after rebuild. The claim stays visible every
    // round; from the second round it carries the recurrence.
    const first = round("r1", [uncertain("equilibrium", "members")], null);
    const second = round("r2", [uncertain("equilibrium", "members")], first);
    const third = round("r3", [uncertain("equilibrium", "members")], second);
    expect(first.findings[0]).not.toHaveProperty("repeated");
    expect(renderRebuildAdvice(first)).not.toContain("recurring");
    expect(third.findings[0]).toMatchObject({ checkId: "equilibrium", repeated: { count: 3, since: "r1" } });
    expect(renderRebuildAdvice(third)).toContain(
      "the reviewer could not attribute the equilibrium result (recurring: 3 consecutive packets since r1)",
    );

    // A changed check id is new evidence and starts again.
    const changed = round("r4", [uncertain("deflection", "members")], third);
    expect(changed.findings[0]).toMatchObject({ checkId: "deflection" });
    expect(changed.findings[0]).not.toHaveProperty("repeated");

    // A host finding names no check, and the rule that produced it is what supports its
    // recurrence: the same rule fired twice, which the host observed. A round without it ends the
    // run of consecutive packets, so its return counts from one.
    const host = () => uncertain(undefined, undefined, "unaccepted-without-verdict");
    const hostFirst = round("h1", [host()], null);
    const hostSecond = round("h2", [host()], hostFirst);
    expect(hostSecond.findings[0]).toMatchObject({ repeated: { count: 2, since: "h1" } });
    const gap = round("h3", [], hostSecond);
    expect(gap.findings).toEqual([]);
    expect(round("h4", [host()], gap).findings[0]).not.toHaveProperty("repeated");
  });

  it("reads no recurrence from evidence that cannot establish one", () => {
    // Two reviewer observations that named nothing used to key on the kind itself, the one constant
    // every finding here shares, so any two of them in consecutive packets rendered as one
    // diagnosis recurring. The author was told "recurring: 3 consecutive packets" about three
    // unrelated observations. Naming nothing now keys nothing, and the sentence is absent rather
    // than wrong; the claims themselves still reach the author every round.
    const unattributed = (claim: string, artifactSchemaPath?: string): AnalysisFinding => ({
      defect: false,
      claim,
      evidence: "campaigns/bridge-truss/analysis/review.json",
      owner: null,
      severity: "advisory",
      ...keyIfDefined("artifactSchemaPath", artifactSchemaPath),
    });
    const round = (runId: string, findings: AnalysisFinding[], previous: RebuildAdvicePacket | null) =>
      derive(analysis([caseRow("t1")], runId), judges(), admission(findings), previous);

    const first = round("r1", [unattributed("the deflection result is unexplained")], null);
    const second = round("r2", [unattributed("the mass budget result is unexplained")], first);
    expect(second.findings[0]).not.toHaveProperty("repeated");
    expect(renderRebuildAdvice(second)).toContain("the mass budget result is unexplained");
    expect(renderRebuildAdvice(second)).not.toContain("recurring");

    // A bare declared root is the same case: one word for the whole artifact tells two defects
    // apart no better than naming nothing. A path below a root does name a place, and recurs.
    const bare = round("b2", [unattributed("a", "files")], round("b1", [unattributed("b", "files")], null));
    expect(bare.findings[0]).not.toHaveProperty("repeated");
    const below = round(
      "d2",
      [unattributed("a", "files.main")],
      round("d1", [unattributed("b", "files.main")], null),
    );
    expect(below.findings[0]).toMatchObject({ repeated: { count: 2, since: "d1" } });
  });

  it("keeps public aggregate claims while private diagnosis prose cannot change the author handover", () => {
    // Findings and Judge exits have public aggregate producers. Diagnosis prose can identify a
    // failed case without its task id, so only its typed owner and support counts cross.
    const claim = "PLANTED-CLAIM";
    const reason = "PLANTED-REASON";
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
        reason,
      },
    });
    const finding: AnalysisFinding = {
      defect: false,
      claim,
      evidence: "campaigns/bridge-truss/analysis/base-analysis.json",
      owner: null,
    };
    const text = renderRebuildAdvice(
      derive(analysis([caseRow("t1")]), contested, admission([finding]), null),
    );
    expect(text).toContain(claim);
    expect(text).toContain(reason);
    // The contested task id is not one of them: it reaches the packet only as its family.
    expect(text).not.toContain("t7");
    expect(text).toContain("families: joints");
    const advice = derive(analysis([caseRow("t1")]), contested, admission([finding]), null);
    const withReadings: RebuildAdvicePacket = {
      ...advice,
      issues: [
        priorIssue({
          diagnosis: { ...READING, cause: "PLANTED-CAUSE", runId: "r1" },
        }),
        priorIssue({ family: "joints", dispute: "PLANTED-DISPUTE" }),
      ],
    };
    const diagnosed = renderRebuildAdvice(withReadings);
    expect(diagnosed).toContain("diagnosis (r1: holds for 2 of 3 sampled");
    // The reader's prompt holds no protected detail, so its located boundary and its falsifier
    // reach the author; the cause is its free argument and stays recorded, as a dispute's prose does.
    expect(diagnosed).toContain(READING.falsifier);
    for (const planted of ["PLANTED-CAUSE", "PLANTED-DISPUTE"]) {
      expect(diagnosed).not.toContain(planted);
    }
    const changed: RebuildAdvicePacket = {
      ...withReadings,
      analysisDigest: "f".repeat(64),
      issues: withReadings.issues.map((row) => ({
        // A dispute's presence is public (the render names the family); only its prose is private.
        ...row,
        dispute: row.dispute === null ? null : "different private dispute",
        diagnosis: row.diagnosis === null ? null : { ...row.diagnosis, cause: "different private cause" },
      })),
    };
    expect(hashJsonBytes(changed)).not.toBe(hashJsonBytes(withReadings));
    expect(renderRebuildAdvice(changed)).toBe(diagnosed);
  });

  it("summarizes verified failures by declared check without task ids", () => {
    // A battery where most verified cases fail and every failure blocks on one check is a fact the
    // author needs; the packet carries it as a row rather than leaving it to a safeguard log.
    const rows = [
      caseRow("t1", { truthOk: false, pass: false }),
      caseRow("t2", { truthOk: false, pass: false }),
      caseRow("t3"),
    ];
    const counts = { "member-forces": 0, "response-report-accurate": 2, deflection: 1 };
    const advice = derive(analysis(rows, RUN, counts), judges(), admission(), null);
    expect(advice.blockingByCheck).toEqual(counts);
    const text = renderRebuildAdvice(advice);
    expect(text).toContain(
      "Verified failures by declared check (2 failed; a case may block on several): response-report-accurate 2, deflection 1.",
    );
    // The check that blocked nothing is the other half of the same record, not a row to discard.
    expect(text).toContain(
      "Declared checks that blocked no shipping artifact, with the verified cases each applied to (of 3): member-forces 3.",
    );
    expect(text).not.toContain("t1");
    // Two checks share the failures, so the one-check question is not asked.
    expect(text).not.toContain("One check carrying every failure");
    const alone = renderRebuildAdvice(
      derive(analysis(rows, RUN, { "member-forces": 0, deflection: 2 }), judges(), admission(), null),
    );
    expect(alone).toContain("deflection 2. One check carrying every failure asks whether its rule is stated");
    // A battery that declared no check records an empty map, and the packet says nothing.
    const empty = renderRebuildAdvice(derive(analysis(rows, RUN, {}), judges(), admission(), null));
    expect(empty).not.toContain("Verified failures by declared check");
    expect(empty).not.toContain("blocked no shipping artifact");
  });

  it("separates a check no verified case posed from one that refused nothing over the whole battery", () => {
    // Both read identically under one sentence, and their repairs are opposite: raise the rule, or
    // give the battery a task that reaches it. Across the recorded corpus 74 of 670 untripped rows
    // were not the shape that sentence implied — 54 applicable to some verified cases, 20 to none.
    const rows = [caseRow("t1"), caseRow("t2"), caseRow("t3", { truthOk: false, pass: false })];
    const text = renderRebuildAdvice(
      derive(
        analysis(
          rows,
          RUN,
          { lenient: 0, narrow: 0, unposed: 0, deflection: 1 },
          { lenient: 3, narrow: 1, unposed: 0, deflection: 3 },
        ),
        judges(),
        admission(),
        null,
      ),
    );
    expect(text).toContain(
      "Declared checks that blocked no shipping artifact, with the verified cases each applied to (of 3): lenient 3, narrow 1.",
    );
    expect(text).toContain(
      "Declared checks no verified case posed, so this battery measured nothing about them: unposed.",
    );
  });

  it("names every declared check when a saturated battery tripped none of them", () => {
    // A battery that passes every case has declared checks firing on its controls and on no
    // shipping artifact at all. Shown only the families that found no limit, the next battery moves
    // its published magnitudes; the roster is the fact that asks for a requirement instead.
    const rows = [caseRow("t1"), caseRow("t2")];
    const counts = { "geometry-and-clearance": 0, "mass-within-limit": 0, "strength-and-buckling": 0 };
    const text = renderRebuildAdvice(derive(analysis(rows, RUN, counts), judges(), admission(), null));
    expect(text).not.toContain("Verified failures by declared check");
    expect(text).toContain(
      "Declared checks that blocked no shipping artifact, with the verified cases each applied to (of 2): geometry-and-clearance 2, mass-within-limit 2, strength-and-buckling 2.",
    );
    // Zero verified cases leave the roster silent: nothing was graded, so no check went untripped.
    const ungraded = [caseRow("t1", { truthOk: null, pass: null, acceptedSubmit: false })];
    const blank = renderRebuildAdvice(derive(analysis(ungraded, RUN, counts), judges(), admission(), null));
    expect(blank).not.toContain("blocked no shipping artifact");
  });

  it("renders no roster, rather than an empty line, when every check lacks a recorded applicable count", () => {
    // Untripped with no applicable row lands in none of the three lists; the orientation and the
    // packet both drop a null line, and would have kept an empty one.
    expect(blockingLine({ legacy: 0 }, {}, 3, 3)).toBeNull();
    expect(blockingLine({ legacy: 0 }, { legacy: 3 }, 3, 3)).toContain("legacy 3");
  });

  it("keeps complete rechecks in the register and out of the render", () => {
    const first = packet([caseRow("t1", { family: "beams", truthOk: false, pass: false })]);
    const second = packet([caseRow("t1", { family: "beams" })], first);
    const third = packet([caseRow("t1", { family: "beams" })], second);
    expect(second.issues.map((row) => row.absentBatteries)).toEqual([1]);
    expect(third.issues.map((row) => row.absentBatteries)).toEqual([2]);
    // Neither count reaches the author: the render carries what is standing now, and a family
    // that already passes is something to escalate rather than something to repair.
    expect(renderRebuildAdvice(second)).toBe("");
    const text = renderRebuildAdvice(third);
    // Nothing stands, so the packet says nothing; the readout's family line says beams passed.
    expect(text).toBe("");
  });

  it("drops a retired issue from the render and keeps its status in the register", () => {
    const first = packet([caseRow("t1", { family: "beams", truthOk: false, pass: false })]);
    const rebuilt = packet([caseRow("t9", { family: "joints" })], first);
    expect(rebuilt.issues.map((row) => row.retired)).toEqual([true]);
    // The family left the task set, so naming it asks the author for nothing it can do.
    expect(renderRebuildAdvice(rebuilt)).toBe("");
  });

  it("renders unplaced findings in admitted order and says how many the cap left out", () => {
    const findings = Array.from(
      { length: 5 },
      (_, index): AnalysisFinding => ({
        defect: false,
        claim: `observation-${index}`,
        evidence: "campaigns/bridge-truss/analysis/review.json",
        owner: null,
      }),
    );
    const result = derive(
      analysis([caseRow("t0", { truthOk: false, pass: false })]),
      judges(),
      admission(findings),
      null,
    );
    expect(result.findings).toHaveLength(5);
    const text = renderRebuildAdvice(result);
    expect(text).toContain("- unplaced: observation-0");
    expect(text).toContain("1 further admitted finding omitted from this packet.");
    expect(text).not.toContain("observation-4");
    const positions = [0, 1, 2, 3].map((index) => text.indexOf(`observation-${index}`));
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
  });

  it("bounds the render when the battery fails everywhere and its findings are enormous", () => {
    // One unowned finding carrying a whole declared assertion can be most of a packet's characters
    // by itself, and an author reading it rewrites the evaluator around it. The register keeps
    // every row; the model-visible boundary is what is bounded.
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
    expect(result.findings).toHaveLength(6);
    const text = renderRebuildAdvice(result);
    expect(text.split("\n- family-")).toHaveLength(7);
    expect(text).toContain("(6 of 10 shown)");
    expect(text).toContain(" bytes omitted]");
    expect(text).toContain("2 further admitted findings omitted from this packet.");
    expect(text.length).toBeLessThan(6_000);

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

describe("what the author reads", () => {
  it("lists disputed issues separately from standing issues", () => {
    const rendered = renderRebuildAdvice(
      advicePacket([issue({ dispute: "the check cannot fail on a real task" })]),
    );
    expect(rendered).toContain("Disputed issues");
    expect(rendered).toContain("beams (verified-fail)");
    expect(rendered).not.toContain("the check cannot fail on a real task");
    expect(rendered).not.toContain("- beams:");
  });

  it("a diagnosis publishes its owner, boundary and falsifier, and keeps its cause", () => {
    const rendered = renderRebuildAdvice(advicePacket([issue({ diagnosis: READING })]));
    expect(rendered).toContain(
      "diagnosis (r2: holds for 2 of 3 sampled of 3 failing cases, 1 passing contrast): agent/tools-spec.json.",
    );
    expect(rendered).toContain(
      `First failure boundary at a call to write_layout: ${READING.boundary.reading}. Falsifier:`,
    );
    expect(rendered).toContain(`Falsifier: ${READING.falsifier}`);
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
      "First failure boundary at the solve's end: the turn cap ended the solve mid-draft",
    );
  });

  it("names the environment as the owner of an environment non-result, and only of one", () => {
    const rendered = renderRebuildAdvice(advicePacket([issue({ kind: "non-result", detail: "provider" })]));
    expect(rendered).toContain("environment non-results of kind provider, owned by the environment");
    // A `verifier` kind is not an environment failure and must not read as one.
    const verifier = renderRebuildAdvice(advicePacket([issue({ kind: "non-result", detail: "verifier" })]));
    expect(verifier).toContain(
      "runtime non-results of kind verifier, a kind that does not establish an environment failure",
    );
    expect(verifier).not.toContain("environment non-results of kind");
  });

  it("tells the author an unmeasured issue is unmeasured, not fixed and not standing", () => {
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
    expect(rendered).toContain("- joints: 2/5");
    expect(rendered).not.toContain("- beams:");
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
    // Split across two names, each is named, in order.
    const split = renderRebuildAdvice(
      renamed([
        { family: "girders", taskIds: ["t1"] },
        { family: "columns", taskIds: ["t2"] },
      ]),
    );
    expect(split).toContain("task inputs changed; its tasks now run under columns, girders).");
    // The tasks are never named, only the families that now hold them.
    for (const taskId of ["t1", "t2"]) expect(split).not.toContain(taskId);
  });

  it("names the issues rechecked under changed public rules, and only when every recheck followed a change", () => {
    const rendered = renderRebuildAdvice(
      advicePacket([
        issue({ absentBatteries: 1, rulesChangedRechecks: 1 }),
        issue({ id: JOINTS, family: "joints", absentBatteries: 2, rulesChangedRechecks: 1 }),
      ]),
    );
    expect(rendered).toContain(
      "Issues rechecked under unchanged checks, public rules changed — absent from every recheck, but the public rules, in words or numbers, differed from the battery that observed them, so the absence says whether the repair held under the new rules, not whether the issue persists: beams (verified-fail).",
    );
    expect(rendered).not.toContain("joints");
    expect(rendered).not.toContain("Unmeasured");
    expect(renderRebuildAdvice(advicePacket([issue({ absentBatteries: 1 })]))).not.toContain(
      "public rules changed",
    );
  });
});
