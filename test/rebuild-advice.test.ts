/**
 * The rebuild advice packet is the one channel by which what a battery recorded reaches the Builder
 * that writes the next one, and it has two jobs that pull against each other. It has to carry
 * enough for the Builder to act — which families failed, which checks, how often, and whether an
 * issue it has seen before came back — while carrying nothing that would hand it the answers. So
 * the cases here fall into two groups, and both matter equally.
 *
 * The first group is what the packet knows. One battery's observations are counted against the
 * right denominators, with a verified failure, an unaccepted attempt and a non-result kept apart;
 * an issue then ages across later batteries through active, tentatively-fixed, confirmed-fixed,
 * regressed, retired and disputed. The retired case is the one to read closely, because a family
 * that left the task set makes its issue retired rather than fixed, and absence counts towards a
 * fix only when the family actually ran.
 *
 * The second group is what the packet must not say. A finding bound to a single case is dropped
 * rather than aggregated, the render carries families, kinds and counts but never a task id or
 * verifier text, and a diagnosis publishes its review metadata while its prose stays private.
 * Those are the leakage assertions, and a loosened one fails in the worst way available: the packet
 * still renders, the Builder still reads it, and the battery it authors next is measuring a
 * question it was quietly handed the answer to.
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
import type { JudgeReviewsResult } from "../src/analyse/judge-reviews.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { double } from "./helpers/doubles.ts";
import {
  type BatteryCondition,
  batteryCondition,
  measuredConditionDigest,
} from "../src/author/issue-condition.ts";
import { BEAMS, JOINTS, MEASURED_UNDER, READING, advicePacket, issue } from "./helpers/review-fixtures.ts";
import {
  type AdviceIssue,
  type RebuildAdvicePacket,
  REBUILD_ADVICE_SCHEMA,
  adviceIssueId,
  adviceTotals,
  advanceIssues,
  attachIssueReadings,
  deriveRebuildAdvice,
  isStanding,
  issueStatusWord,
  latestRebuildAdvicePath,
  readLatestRebuildAdvice,
  rebuildAdvicePath,
  renderRebuildAdvice,
} from "../src/author/rebuild-advice.ts";

const SLUG = "bridge-truss";
const RUN = "base";

afterEach(cleanupScratch);

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
      },
      backendPin: "codex:test",
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

function judges(overrides?: Partial<JudgeReviewsResult>): JudgeReviewsResult {
  return {
    schema: "judge-reviews/v11",
    slug: SLUG,
    runId: RUN,
    judgePin: null,
    promptPolicyDigests: { census: "d".repeat(64) },
    analysisDigest: "e".repeat(64),
    census: null,
    contested: [],
    coverage: { reviewable: 0, reviewed: 0 },
    provisional: null,
    exit: {
      kind: "none",
      verifierFailJudgePass: 0,
      verifierPassJudgeFail: 0,
      verified: 0,
      reason: "no disagreement",
    },
    findings: [],
    absent: [],
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

/** The condition a fixture battery measured under: every family it ran on the fixture's public
 *  inputs, under the fixture's scoring program and Built condition. */
function conditionOf(data: IterationAnalysis, overrides?: Partial<BatteryCondition>): BatteryCondition {
  return {
    scoringHash: MEASURED_UNDER.scoringHash,
    measuredCondition: MEASURED_UNDER.measuredCondition,
    familyInputs: new Map(data.cases.map((row) => [row.family, MEASURED_UNDER.publicInputs] as const)),
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

/** The ageing rule under the fixture's scoring program and Built condition. */
function advance(
  previous: readonly AdviceIssue[],
  observed: Parameters<typeof advanceIssues>[1],
  runId: string,
  families: Parameters<typeof advanceIssues>[3]["families"],
  judgeReview: "complete" | "incomplete",
): AdviceIssue[] {
  return advanceIssues(previous, observed, runId, { ...MEASURED_UNDER, families }, judgeReview);
}

function packet(analysisCases: IterationAnalysis["cases"], previous: RebuildAdvicePacket | null = null) {
  return derive(analysis(analysisCases), judges(), admission(), previous);
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
    expect(result.issues.every((row) => issueStatusWord(row) === "active")).toBe(true);
  });

  it("reads confirmed Judge disagreements in both directions as advisory rows, and drops unconfirmed ones", () => {
    const contested = [
      {
        taskId: "t2",
        family: "beams",
        judge: true,
        verifier: false,
        evidence: "e.json",
        rules: [],
        rationale: null,
        confirmed: true,
        checkIds: [],
        artifact: "a.json",
      },
      {
        taskId: "t1",
        family: "joints",
        judge: false,
        verifier: true,
        evidence: "e.json",
        rules: [],
        rationale: null,
        confirmed: true,
        checkIds: [],
        artifact: "a.json",
      },
      {
        taskId: "t3",
        family: "trusses",
        judge: false,
        verifier: true,
        evidence: "e.json",
        rules: ["mass within the cap"],
        rationale: null,
        confirmed: false,
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
        exit: { kind: "advisory", verifierFailJudgePass: 1, verifierPassJudgeFail: 1, verified: 2, reason },
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
    // An unconfirmed disagreement stays in the Judge census line but raises no issue.
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
    // proposedOwner null so the row routes nowhere and this test measures the subject filter
    // alone; the routing filter has its own test below.
    const aggregate: AnalysisFinding = {
      kind: "harness-defect",
      claim: "the battery passed all 2 verified cases",
      evidence: "campaigns/x/case-record.jsonl",
      proposedOwner: null,
      severity: "advisory",
    };
    const perCase: AnalysisFinding = {
      kind: "harness-defect",
      claim: "task t2 failed its declared check",
      evidence: "campaigns/x/case-record.jsonl",
      proposedOwner: "tests",
      subject: { taskId: "t2", family: "beams" },
    };
    const result = derive(analysis([caseRow("t1")]), judges(), admission([aggregate, perCase]), null);
    expect(result.findings).toEqual([
      { kind: "harness-defect", claim: aggregate.claim, severity: "advisory" },
    ]);
  });
});

/** The ageing tests below count one failure in two attempts; everything else about the issue is
 *  the shared fixture's. */
const priorIssue = (overrides?: Partial<AdviceIssue>): AdviceIssue =>
  issue({ count: 1, denominator: 2, ...overrides });

describe("how an issue ages across batteries", () => {
  const beamsFail = {
    kind: "verified-fail" as const,
    family: "beams",
    detail: null,
    count: 1,
    denominator: 2,
  };
  const words = (issues: readonly AdviceIssue[]) => issues.map(issueStatusWord);
  /** The battery's family rows. A family is only evidence about an issue once it produced a
   *  truth-verified case; `verified: 0` is a family the provider never let run. */
  const ran = (...names: string[]) =>
    names.map((family) => ({
      family,
      verified: 1,
      passed: 1,
      unaccepted: 0,
      nonResults: 0,
      publicInputs: MEASURED_UNDER.publicInputs,
    }));
  const unverified = (family: string) => [
    {
      family,
      verified: 0,
      passed: 0,
      unaccepted: 0,
      nonResults: 5,
      publicInputs: MEASURED_UNDER.publicInputs,
    },
  ];

  it("ages an absent issue to tentatively fixed, then confirmed fixed after the second battery", () => {
    const once = advance([priorIssue()], [], "r2", ran("beams"), "complete");
    expect(once).toEqual([
      expect.objectContaining({ absentBatteries: 1, firstSeenRunId: "r1", observedUnder: MEASURED_UNDER }),
    ]);
    expect(words(once)).toEqual(["tentatively-fixed"]);
    const twice = advance(once, [], "r3", ran("beams"), "complete");
    expect(twice).toEqual([expect.objectContaining({ absentBatteries: 2 })]);
    expect(words(twice)).toEqual(["confirmed-fixed"]);
  });

  it("retires an issue whose family left the task set, and reactivates it without a regression if the family returns", () => {
    // Without this, an issue stays active through every later battery of a rebuilt task set that
    // no longer holds its family. Absence of the family is not evidence of a fix either.
    const gone = advance([priorIssue()], [], "r2", ran("joints"), "complete");
    expect(gone).toEqual([
      expect.objectContaining({ retired: true, absentBatteries: 0, lastSeenRunId: "r1" }),
    ]);
    expect(words(gone)).toEqual(["retired"]);
    expect(advance(gone, [], "r3", ran("joints"), "complete")).toEqual(gone);
    const returned = advance(gone, [beamsFail], "r4", ran("beams"), "complete");
    expect(returned).toEqual([expect.objectContaining({ firstSeenRunId: "r1", lastSeenRunId: "r4" })]);
    expect(words(returned)).toEqual(["active"]);
  });

  it("carries an issue unchanged when its family ran but the provider measured none of it", () => {
    // A battery whose cases were nearly all provider non-results still lists every family in its
    // rows, so reading appearance as "ran" ages each of their issues one battery closer to
    // confirmed-fixed on a battery that verified nothing. A family that produced no truth-verified
    // case is evidence in neither direction: it did not leave the task set, so it is not retired,
    // and nothing observed the issue, so it does not age.
    const held = advance([priorIssue()], [], "r2", unverified("beams"), "complete");
    expect(held).toEqual([
      expect.objectContaining({ absentBatteries: 0, retired: false, lastSeenRunId: "r1" }),
    ]);
    expect(words(held)).toEqual(["active"]);
    // Two such batteries still say nothing; the first measured one ages it.
    expect(advance(held, [], "r3", unverified("beams"), "complete")).toEqual(held);
    expect(words(advance(held, [], "r4", ran("beams"), "complete"))).toEqual(["tentatively-fixed"]);
  });

  it("keeps a Judge issue active while the battery's census is unvalidated", () => {
    // A Judge that disagrees on the same case again under an unvalidated census has observed
    // nothing admissible, so ageing the issue there would move it to tentatively-fixed.
    const judgeIssue = priorIssue({ kind: "judge-passed-verifier-failed" });
    const unvalidated = advance([judgeIssue], [], "r2", ran("beams"), "incomplete");
    expect(unvalidated).toEqual([expect.objectContaining({ absentBatteries: 0, lastSeenRunId: "r1" })]);
    expect(words(unvalidated)).toEqual(["active"]);
    expect(words(advance(unvalidated, [], "r3", ran("beams"), "complete"))).toEqual(["tentatively-fixed"]);
    expect(words(advance([judgeIssue], [], "r2", ran("joints"), "incomplete"))).toEqual(["retired"]);
  });

  it("keeps a dispute only while the issue is disputed", () => {
    // Left in place, a dispute string rides a confirmed-fixed issue through every later battery.
    const disputed = priorIssue({ dispute: "the evaluator pins a stale header" });
    const seenAgain = advance([disputed], [beamsFail], "r2", ran("beams"), "complete");
    expect(seenAgain).toEqual([expect.objectContaining({ dispute: "the evaluator pins a stale header" })]);
    expect(words(seenAgain)).toEqual(["disputed"]);
    const absent = advance([disputed], [], "r2", ran("beams"), "complete");
    expect(absent).toEqual([expect.objectContaining({ dispute: null })]);
    expect(words(absent)).toEqual(["tentatively-fixed"]);
    expect(advance([disputed], [], "r2", ran("joints"), "complete")).toEqual([
      expect.objectContaining({ retired: true, dispute: null }),
    ]);
    const back = advance(absent, [beamsFail], "r3", ran("beams"), "complete");
    expect(back).toEqual([expect.objectContaining({ returned: true, dispute: null })]);
    expect(words(back)).toEqual(["regressed"]);
  });

  it("marks a fixed issue that reappears as regressed and keeps its first-seen battery", () => {
    const fixed = advance([priorIssue()], [], "r2", ran("beams"), "complete");
    const back = advance(fixed, [beamsFail], "r3", ran("beams"), "complete");
    expect(back).toEqual([
      expect.objectContaining({
        returned: true,
        firstSeenRunId: "r1",
        lastSeenRunId: "r3",
        absentBatteries: 0,
      }),
    ]);
    expect(words(back)).toEqual(["regressed"]);
    // An issue seen again while still active stays active rather than reading as a regression.
    const again = advance([priorIssue()], [beamsFail], "r2", ran("beams"), "complete");
    expect(again).toEqual([expect.objectContaining({ returned: false, lastSeenRunId: "r2" })]);
    expect(words(again)).toEqual(["active"]);
  });

  it("keeps a diagnosis on an issue the next battery observes again", () => {
    const next = advance([priorIssue({ diagnosis: READING })], [beamsFail], "r2", ran("beams"), "complete");
    expect(next).toEqual([expect.objectContaining({ diagnosis: READING, lastSeenRunId: "r2" })]);
  });

  it("gives different kinds and different non-result details different identities", () => {
    expect(adviceIssueId("verified-fail", "beams", null)).not.toBe(
      adviceIssueId("unaccepted", "beams", null),
    );
    expect(adviceIssueId("non-result", "beams", "provider")).not.toBe(
      adviceIssueId("non-result", "beams", "sandbox"),
    );
  });
});

describe("the issue register and its projection", () => {
  function repo(): string {
    const root = scratchDir("ana-advice-");
    mkdirSync(join(root, "campaigns", SLUG, "analysis"), { recursive: true });
    return root;
  }

  it("carries admitted severity and unaccepted counts without inventing a blocking diagnosis or admission refusal", () => {
    const root = repo();
    const data = analysis([caseRow("absent", { acceptedSubmit: false, pass: false, truthOk: null })]);
    const evidence = `campaigns/${SLUG}/case-record.jsonl`;
    writeFileSync(join(root, evidence), "");
    const uncertain: AnalysisFinding = {
      kind: "diagnosis-uncertain",
      claim: "cause is unknown",
      evidence,
      proposedOwner: null,
    };
    const blocking: AnalysisFinding = { ...uncertain, kind: "harness-defect", claim: "demonstrated defect" };
    const admitted = admitFindings(root, data, [
      ...hostFindings(root, data),
      uncertain,
      blocking,
      { ...blocking, claim: "advisory observation", severity: "advisory" },
      { ...blocking, proposedOwner: "brief" },
    ]);
    expect(admitted.feedback.map((row) => [row.owner, row.severity])).toEqual([["brief", "blocking"]]);
    const result = derive(data, judges(), admitted, null);
    expect(result.findings.map((row) => row.severity)).toEqual([
      "advisory",
      "advisory",
      "blocking",
      "advisory",
    ]);
    const rendered = renderRebuildAdvice(result);
    expect(rendered).toContain("1/1 attempts produced no accepted submission");
    expect(rendered).toContain("[advisory] diagnosis-uncertain: cause is unknown");
    expect(rendered).toContain("[blocking] harness-defect: demonstrated defect");
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
      kind: "diagnosis-uncertain",
      claim: "the agent submitted nothing the verifier could read",
      evidence,
      proposedOwner: null,
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
    expect(text).toContain("[active] joints: 1/1 verified cases failed");
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
      kind: "harness-defect",
      claim: "the checker admitted 3 ungrounded verdicts",
      evidence: "campaigns/bridge-truss/analysis/base-analysis.json",
      proposedOwner: "correctness-model",
    };
    const unrouted: AnalysisFinding = { ...routed, kind: "diagnosis-uncertain", proposedOwner: null };
    const admitted = admission([routed, unrouted]);
    const withRouting = {
      ...admitted,
      feedback: [
        {
          owner: "correctness-model" as const,
          severity: "blocking" as const,
          claim: routed.claim,
          evidence: `${routed.evidence} (analysis ffffffffffff)`,
          findings: [],
        },
      ],
    };
    const text = renderRebuildAdvice(derive(analysis([caseRow("t1")]), judges(), withRouting, null));
    expect(text).toContain("diagnosis-uncertain");
    expect(text.split("the checker admitted 3 ungrounded verdicts")).toHaveLength(2);
  });

  it("prints the Judge exit once, through the judge line rather than an advisory finding", () => {
    // `judge.reason` and the judge-disagreement finding are the same sentence from `judgeExit`, so
    // rendering both carries it twice and the copy spends a rendered finding slot.
    const disagreement: AnalysisFinding = {
      kind: "judge-disagreement",
      claim:
        "the Judge disagreed with the verifier on 1 of 6 verified cases; the verifier decides every pass",
      evidence: "campaigns/bridge-truss/analysis/base-judges.json",
      proposedOwner: null,
    };
    const advice = derive(analysis([caseRow("t1")]), judges(), admission([disagreement]), null);
    expect(advice.findings).toEqual([]);
    const text = renderRebuildAdvice(advice);
    expect(text).not.toContain("judge-disagreement");
  });

  it("keeps a controller defect out of the author's packet", () => {
    // Rendered, this sends the author to inspect the public contract for a mismatch the controller
    // owns, which no authoring change can repair.
    const defect: AnalysisFinding = {
      kind: "controller-defect",
      claim:
        "The epoch review reported controller-defect in the public contract; inspect that contract for a mismatch.",
      evidence: "campaigns/bridge-truss/analysis/review.json",
      proposedOwner: null,
      severity: "advisory",
    };
    const advice = derive(analysis([caseRow("t1")]), judges(), admission([defect]), null);
    expect(advice.findings).toEqual([]);
  });

  it("annotates an unowned diagnosis with its consecutive recurrence, keyed by what it named", () => {
    const uncertain = (checkId?: string, artifactSchemaPath?: string, hostRule?: string): AnalysisFinding => {
      const finding: AnalysisFinding = {
        kind: "diagnosis-uncertain",
        claim: "the reviewer could not attribute the equilibrium result",
        evidence: "campaigns/bridge-truss/analysis/review.json",
        proposedOwner: null,
        severity: "advisory",
        ...keyIfDefined("checkId", checkId),
        ...keyIfDefined("artifactSchemaPath", artifactSchemaPath),
        ...keyIfDefined("hostRule", hostRule),
      };
      return finding;
    };
    const round = (runId: string, findings: AnalysisFinding[], previous: RebuildAdvicePacket | null) =>
      derive(analysis([caseRow("t1")], runId), judges(), admission(findings), previous);
    // The same unowned diagnosis can render to rebuild after rebuild. The claim stays visible every
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
      kind: "diagnosis-uncertain",
      claim,
      evidence: "campaigns/bridge-truss/analysis/review.json",
      proposedOwner: null,
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
    // failed case without its task id, so only its typed owner/confidence metadata crosses.
    const claim = "PLANTED-CLAIM";
    const reason = "PLANTED-REASON";
    const contested = judges({
      census: reviewCensus(),
      contested: [
        {
          taskId: "t7",
          family: "joints",
          judge: true,
          verifier: false,
          rules: [],
          rationale: null,
          confirmed: false,
          checkIds: [],
          evidence: "campaigns/bridge-truss/analysis/base-judge/t7.json",
          artifact: null,
        },
      ],
      exit: { kind: "advisory", verifierFailJudgePass: 3, verifierPassJudgeFail: 0, verified: 10, reason },
    });
    const finding: AnalysisFinding = {
      kind: "harness-defect",
      claim,
      evidence: "campaigns/bridge-truss/analysis/base-analysis.json",
      proposedOwner: null,
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
          diagnosis: { ...READING, cause: "PLANTED-CAUSE", runId: "r1", confidence: "low" },
        }),
        priorIssue({ family: "joints", dispute: "PLANTED-DISPUTE" }),
      ],
    };
    const diagnosed = renderRebuildAdvice(withReadings);
    expect(diagnosed).toContain("diagnosis (r1, low confidence");
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

  it("keeps both fix statuses in the register and out of the render", () => {
    const first = packet([caseRow("t1", { family: "beams", truthOk: false, pass: false })]);
    const second = packet([caseRow("t1", { family: "beams" })], first);
    const third = packet([caseRow("t1", { family: "beams" })], second);
    expect(second.issues.map(issueStatusWord)).toEqual(["tentatively-fixed"]);
    expect(third.issues.map(issueStatusWord)).toEqual(["confirmed-fixed"]);
    // Neither status reaches the author: the render carries what is standing now, and a family
    // that already passes is something to escalate rather than something to repair.
    expect(renderRebuildAdvice(second)).not.toContain("[tentatively-fixed]");
    const text = renderRebuildAdvice(third);
    // Nothing stands, so the packet says nothing; the readout's family line says beams passed.
    expect(text).toBe("");
  });

  it("drops a retired issue from the render and keeps its status in the register", () => {
    const first = packet([caseRow("t1", { family: "beams", truthOk: false, pass: false })]);
    const rebuilt = packet([caseRow("t9", { family: "joints" })], first);
    expect(rebuilt.issues.map(issueStatusWord)).toEqual(["retired"]);
    // The family left the task set, so naming it asks the author for nothing it can do.
    expect(renderRebuildAdvice(rebuilt)).toBe("");
  });

  /** The cap cuts the tail, so what the tail holds decides what the author never sees. The standing
   *  issues above this block are ordered by how many cases they hold before they are cut; cutting
   *  this block in admission order instead puts a blocking finding — an admitted, cited
   *  demonstration of a violated requirement — behind any three advisory leads that arrived first,
   *  and leaves the packet saying "1 further admitted finding(s) omitted", a line that does not say
   *  the omitted row was the blocking one. */
  it("renders the blocking findings before the advisory ones it may have to omit", () => {
    // A harness-defect naming no routable owner is the one kind that is both unowned, so it
    // reaches this block at all, and blocking by default. That is the shape a review records: a
    // handful of advisory findings and one blocking harness-defect that named no owner.
    const defect = (claim: string): AnalysisFinding => ({
      kind: "harness-defect",
      claim,
      evidence: "campaigns/bridge-truss/analysis/review.json",
      proposedOwner: null,
    });
    const advisory = (index: number): AnalysisFinding => ({
      ...defect(`advisory-${index}`),
      severity: "advisory",
    });
    // Four advisory leads admitted first, then the one demonstration, which is the row that decides.
    const findings = [...Array.from({ length: 4 }, (_, index) => advisory(index)), defect("blocking-9")];
    const result = derive(
      analysis([caseRow("t0", { truthOk: false, pass: false })]),
      judges(),
      admission(findings),
      null,
    );
    expect(result.findings).toHaveLength(5);

    const text = renderRebuildAdvice(result);
    expect(text).toContain("[blocking] harness-defect: blocking-9");
    expect(text).toContain("1 further admitted finding omitted from this packet.");
    // It leads, and the advisory lead that lost its slot is the last one admitted, not the finding.
    expect(text.indexOf("blocking-9")).toBeLessThan(text.indexOf("advisory-0"));
    expect(text).not.toContain("advisory-3");
    // Within one severity the admitted order stands, so nothing else moves.
    const positions = ["advisory-0", "advisory-1", "advisory-2"].map((claim) => text.indexOf(claim));
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
        kind: "diagnosis-uncertain",
        claim: `${index} `.padEnd(20_000, "declared assertion text "),
        evidence: "campaigns/bridge-truss/analysis/review.json",
        proposedOwner: null,
        severity: "advisory",
      }),
    );
    const result = derive(analysis(rows), judges(), admission(findings), null);
    expect(result.issues).toHaveLength(10);
    expect(result.findings).toHaveLength(6);
    const text = renderRebuildAdvice(result);
    expect(text.split("\n- [active]")).toHaveLength(7);
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
            kind: "diagnosis-uncertain",
            claim: "c".repeat(601),
            severity: "advisory",
            evidence: "campaigns/bridge-truss/analysis/review.json",
            proposedOwner: null,
          },
        ]),
        null,
      ),
    );
    expect(tight).toContain(`: ${"c".repeat(600)} […1 byte omitted]`);
  });
});

describe("a reading attaches to an issue without changing what the battery counted", () => {
  it("attaches a diagnosis to the named issue without changing counts or status", () => {
    const before = advicePacket([issue(), issue({ id: JOINTS, kind: "unaccepted", family: "joints" })]);
    const after = attachIssueReadings(before, { diagnoses: [{ issueIds: [BEAMS], diagnosis: READING }] });
    expect(after.issues[0]?.diagnosis?.cause).toBe(READING.cause);
    expect(after.issues[0]?.count).toBe(2);
    expect(issueStatusWord(after.issues[0] ?? issue())).toBe("active");
    expect(after.issues[1]?.diagnosis).toBeNull();
  });

  it("marks an active issue as disputed and records the reason", () => {
    const after = attachIssueReadings(advicePacket([issue()]), {
      disputes: [{ issueId: BEAMS, reason: "the check cannot fail on a real task" }],
    });
    expect(issueStatusWord(after.issues[0] ?? issue())).toBe("disputed");
    expect(after.issues[0]?.dispute).toBe("the check cannot fail on a real task");
  });

  it("a dispute leaves fixed and retired issues unchanged", () => {
    for (const fixedOrGone of [{ absentBatteries: 2 }, { retired: true }]) {
      const before = advicePacket([issue(fixedOrGone)]);
      const after = attachIssueReadings(before, {
        disputes: [{ issueId: BEAMS, reason: "evaluation artefact" }],
      });
      expect(after).toEqual(before);
    }
  });

  it("no reading returns the same packet", () => {
    const before = advicePacket([issue()]);
    expect(attachIssueReadings(before, {})).toBe(before);
  });
});

describe("what the author reads", () => {
  it("lists disputed issues separately from active issues", () => {
    const rendered = renderRebuildAdvice(
      advicePacket([issue({ dispute: "the check cannot fail on a real task" })]),
    );
    expect(rendered).toContain("Disputed issues");
    expect(rendered).toContain("beams (verified-fail)");
    expect(rendered).not.toContain("the check cannot fail on a real task");
    expect(rendered).not.toContain("- [disputed]");
  });

  it("a diagnosis publishes its layer, boundary, intervention and falsifier, and keeps its cause", () => {
    const rendered = renderRebuildAdvice(advicePacket([issue({ diagnosis: READING })]));
    expect(rendered).toContain(
      "diagnosis (r2, medium confidence: holds for 2 of 3 sampled of 3 failing cases, 1 passing contrast): tool-contract layer, intervention correct.",
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

  it("environment non-results do not instruct a rebuild to change the harness", () => {
    const rendered = renderRebuildAdvice(advicePacket([issue({ kind: "non-result", detail: "provider" })]));
    expect(rendered).toContain("environment non-result alone calls for an unchanged rerun");
    expect(rendered).toContain("environment non-results of kind provider");
    expect(rendered).not.toContain("an active or regressed issue is what the rebuild must move");
    // A `verifier` kind is not an environment failure and must not read as one.
    const verifier = renderRebuildAdvice(advicePacket([issue({ kind: "non-result", detail: "verifier" })]));
    expect(verifier).toContain(
      "runtime non-results of kind verifier, a kind that does not establish an environment failure",
    );
    expect(verifier).not.toContain("environment non-results of kind");
  });
});

describe("whether an absence is comparable evidence", () => {
  const ran = (publicInputs: string | null = MEASURED_UNDER.publicInputs) => [
    { family: "beams", verified: 2, passed: 2, unaccepted: 0, nonResults: 0, publicInputs },
  ];
  const beamsFail = {
    kind: "verified-fail" as const,
    family: "beams",
    detail: null,
    count: 1,
    denominator: 2,
  };
  const other = (digit: string) => digit.repeat(64);

  it("reads an absence on other public inputs as unmeasured, never as a fix", () => {
    // The family ran and every verified case passed, but on tasks it never failed: nothing about
    // the issue was asked again, so the absence proves nothing about whether it was repaired.
    const moved = advance([issue()], [], "r2", ran(other("9")), "complete");
    expect(moved).toEqual([
      expect.objectContaining({ absentBatteries: 0, unmeasured: ["public-inputs"], lastSeenRunId: "r1" }),
    ]);
    expect(moved.map(issueStatusWord)).toEqual(["unmeasured"]);
    expect(moved.filter(isStanding)).toEqual([]);
    // A family whose public tasks could not be vouched for compares with nothing.
    expect(advance([issue()], [], "r2", ran(null), "complete")[0]?.unmeasured).toEqual(["public-inputs"]);
  });

  it("reads an absence under a changed scoring program as unmeasured, even on identical inputs", () => {
    // The shape the plan names: inputs byte-identical, evaluator weakened, issue gone. Identical
    // inputs are necessary and not enough.
    const weaker = advanceIssues(
      [issue()],
      [],
      "r2",
      { ...MEASURED_UNDER, families: ran(), scoringHash: other("8") },
      "complete",
    );
    expect(weaker[0]?.unmeasured).toEqual(["scoring"]);
    expect(weaker.map(issueStatusWord)).toEqual(["unmeasured"]);
  });

  it("reads an absence under another Built model or resource condition as unmeasured", () => {
    const otherModel = advanceIssues(
      [issue()],
      [],
      "r2",
      { ...MEASURED_UNDER, families: ran(other("9")), measuredCondition: other("7") },
      "complete",
    );
    expect(otherModel[0]?.unmeasured).toEqual(["public-inputs", "built-condition"]);
  });

  it("an unmeasured issue ages again once a comparable battery runs, and comes back as active rather than regressed", () => {
    const moved = advance([issue()], [], "r2", ran(other("9")), "complete");
    const comparable = advance(moved, [], "r3", ran(), "complete");
    expect(comparable).toEqual([expect.objectContaining({ absentBatteries: 1, unmeasured: [] })]);
    expect(comparable.map(issueStatusWord)).toEqual(["tentatively-fixed"]);
    // Seen again after an absence no battery could compare, the issue never read as fixed, so its
    // return is not a regression.
    const seen = advance(moved, [beamsFail], "r3", ran(other("9")), "complete");
    expect(seen).toEqual([
      expect.objectContaining({
        returned: false,
        unmeasured: [],
        observedUnder: { ...MEASURED_UNDER, publicInputs: other("9") },
      }),
    ]);
    expect(seen.map(issueStatusWord)).toEqual(["active"]);
  });

  it("records the condition each family ran under on the packet and on every issue it observed", () => {
    const data = analysis([caseRow("t1", { truthOk: false, pass: false })]);
    const result = derive(data, judges(), admission(), null, {
      ...conditionOf(data),
      familyInputs: new Map([["beams", other("5")]]),
    });
    expect(result.scoringHash).toBe(MEASURED_UNDER.scoringHash);
    expect(result.measuredCondition).toBe(MEASURED_UNDER.measuredCondition);
    expect(result.families.map((row) => row.publicInputs)).toEqual([other("5")]);
    expect(result.issues[0]?.observedUnder).toEqual({ ...MEASURED_UNDER, publicInputs: other("5") });
  });

  it("tells the author an unmeasured issue is unmeasured, not fixed and not standing", () => {
    const rendered = renderRebuildAdvice(
      advicePacket([
        issue({ unmeasured: ["public-inputs", "scoring"] }),
        issue({ id: JOINTS, family: "joints" }),
      ]),
    );
    expect(rendered).toContain(
      "Unmeasured issues — absent from this battery, but their family did not rerun under the condition that observed them, so the absence is not a fix: beams (verified-fail: public inputs, scoring program changed).",
    );
    expect(rendered).toContain("[active] joints");
    expect(rendered).not.toContain("[unmeasured]");
    expect(rendered).not.toContain("fixed");
  });
});

describe("measuredConditionDigest", () => {
  const facts = {
    builtPin: "codex:built-model:high",
    isolationStrength: "physical",
    runCondition: { variant: "shipping", advisorsRemoved: [] },
  };

  it("moves with the Built model, the isolation and the run condition", () => {
    const base = measuredConditionDigest(facts);
    for (const moved of [
      { ...facts, builtPin: "codex:built-model:low" },
      { ...facts, isolationStrength: "UNPROVEN" },
      { ...facts, runCondition: { variant: "shipping", advisorsRemoved: ["hint"] } },
    ]) {
      expect(measuredConditionDigest(moved)).not.toBe(base);
    }
  });

  // agent/config.yaml is harness bytes the Builder owns: raising solve_minutes for a family that kept
  // timing out is a fix, and a digest that moved with it would call that fix unmeasured forever.
  it("leaves out the walls agent/config.yaml declares, which a fix may change", () => {
    const tree = scratchDir("ana-condition-");
    mkdirSync(join(tree, "agent"), { recursive: true });
    writeFileSync(join(tree, "agent", "config.yaml"), "solver:\n  max_turns: 48\n  solve_minutes: 240\n");
    const recorded = double<Parameters<typeof batteryCondition>[0]>({
      runId: "run-walls",
      cases: [],
      identities: {
        backendPin: facts.builtPin,
        isolationStrength: facts.isolationStrength,
        bundleSnapshot: { scoringHash: "s" },
      },
      battery: { condition: facts.runCondition },
    });
    const before = batteryCondition(recorded, tree).measuredCondition;
    writeFileSync(join(tree, "agent", "config.yaml"), "solver:\n  max_turns: 24\n  solve_minutes: 120\n");
    expect(batteryCondition(recorded, tree).measuredCondition).toBe(before);
  });
});
