/**
 * Reading the recorded Main Judge census, which is a pure read and nothing more. `runJudgeReviews`
 * is synchronous and consumes the `JudgeEvidence` the eval runner wrote at MEASURE time, so no
 * model is called anywhere below and nothing this file exercises could change a score even if it
 * wanted to.
 *
 * The fixtures deserve a word, because they are where this kind of test usually goes wrong. Every
 * aggregate a case reads is produced by running the production `summarizeJudge` over hand-written
 * observations, rather than by writing the totals into the record directly. Hand-computed totals
 * would be a second implementation of the aggregator sitting inside its own test, agreeing with it
 * by construction and drifting from it silently — and `validateJudgeEvidence` would refuse such a
 * record anyway, so the fixture would be proving something the production path never sees.
 *
 * What the cases establish is mostly restraint. Every complete disagreement is named, in both
 * directions, with no materiality threshold deciding which are worth mentioning, because the Judge
 * is advice and a filtered disagreement is advice that quietly edited itself. A review that is
 * incomplete, absent or self-contradictory is an absent outcome, with its reason, instead of being
 * dropped or trusted, and a battery whose Judge was switched off is a skip rather than missing work. The Judge exit stays advisory at any disagreement count and routes no owner —
 * including over a historical validated control census, which is the case that would most plausibly
 * have been treated as authority. And the projection writes no byte: no case row, no evidence file,
 * no claim, no analysis. That last one is the safety property the rest depends on, since a reader
 * that can write is a reader that can decide.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import type { CaseEvidence, IterationAnalysis } from "../src/analyse/iteration-analysis.ts";
import { runJudgeReviews } from "../src/analyse/judge-reviews.ts";
import { absentLines } from "../src/review/review-reader.ts";
import { contestedCases, mustSettle, reviewerContested } from "../src/analyse/judge-contested.ts";
import { tracePointer } from "../src/claim/case-record.ts";
import { type JudgeEvidence, judgeDecision } from "../src/claim/judge.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import {
  type JudgeSession,
  type JudgeObservation,
  type JudgeSubjectEvidence,
  summarizeJudge,
} from "../src/review/judge.ts";
import { SANITIZER_VERSION } from "../src/correctness-bundle/sanitize.ts";
import { ACTIVE_JUDGE_PROMPTS } from "../src/review/judge-prompt-policy.ts";
import { isBoolean, type JsonObject } from "../src/meta/json-shape.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SLUG = "bridge-truss";
const RUN = "base";
const JUDGE_PIN = "codex/gpt-5.1-codex-judge";
const BUILT_PIN = "codex/gpt-5.1-codex";
/** A judge verdict as the census recorded it: decided, or a failed call; an abstention is only in
 *  records written before 2026-09-30. */
type Verdict = boolean | null | "abstain";
const MEMBER_CAPACITY_RULE = "every member stays under its capacity";

interface CaseSpec {
  taskId: string;
  /** Verifier truth for this case; null models a runtime non-result (no comparable pair). */
  truthOk: boolean | null;
  /** The authored task family. Default "truss": the fixture uses one family unless specified. */
  family?: string;
  /** The judge's recorded verdict; omitted means it AGREED with the verifier. */
  judge?: Verdict;
  /** A Judge fail of a verifier pass's resample; omitted means it agreed with the verifier. The
   *  producer resamples no other verdict. */
  resample?: Verdict;
}

interface BatterySpec {
  cases: CaseSpec[];
  /** How battery.json presents its review. Default: the current producer's record. */
  census?: "none" | "off" | "tampered";
}

/** What one recorded fixture repo offers a projection test: its root and the packet derived over it. */
interface SealedFixture {
  root: string;
  analysis: IterationAnalysis;
}

afterEach(cleanupScratch);

/** Only the pin is read here: these tests summarise evidence the judge already produced. */
const SESSION: JudgeSession = {
  pin: JUDGE_PIN,
  invoke: () => {
    throw new Error("the census projection never calls a judge session");
  },
};

function subjectEvidence(
  subjectId: string,
  subjectKind: JudgeSubjectEvidence["subjectKind"],
  verdict: Verdict,
): JudgeSubjectEvidence {
  return {
    schema: "judge-subject/v3",
    publicContextDigest: "0".repeat(64),
    judgeInputDigest: "0".repeat(64),
    subjectId,
    subjectKind,
    judgePin: JUDGE_PIN,
    verifierBlind: true,
    sanitizer: { version: SANITIZER_VERSION, modified: false, actions: [] },
    verdict: isBoolean(verdict) ? verdict : null,
    abstained: verdict === "abstain",
    rationale: verdict === null ? null : "scripted census fixture",
    rules: [],
    error: verdict === null ? "judge produced no verdict" : null,
    errorKind: verdict === null ? ("protocol" as const) : null,
    turns: 1,
  };
}

/** The default is agreement. A case the verifier never scored (a non-result) still gets judged: the
 *  judge sees a null artifact and says fail, which is a completed verdict with no comparable pair. */
function judgeVerdictOf(spec: CaseSpec): Verdict {
  return spec.judge === undefined ? (spec.truthOk ?? false) : spec.judge;
}

/** The battery's recorded JudgeEvidence, aggregated by the production summarizer over the same specs
 *  the per-case judge.json files carry — the fixture cannot drift from its own evidence. */
function judgeEvidenceFor(spec: BatterySpec): JudgeEvidence {
  if (spec.census === "off") return { judge: "off" };
  const battery: JudgeObservation[] = spec.cases.map((row) => ({
    evidence: subjectEvidence(row.taskId, "battery-case", judgeVerdictOf(row)),
    verifierVerdict: row.truthOk,
  }));
  const evidence = summarizeJudge(SESSION, "correctness-model@fixture", BUILT_PIN, battery);
  if (evidence.judge === "off") return evidence;
  // Evidence whose stored aggregate contradicts its own fields: the projection must refuse it
  // rather than read it, so this tampering is the thing under test, not the count.
  if (spec.census === "tampered") return { ...evidence, vetoed: evidence.verdicts + 5 };
  return evidence;
}

/** The decision a projected review's recorded counts imply, or null when there was no census. */
function judgeOf(result: ReturnType<typeof runJudgeReviews>) {
  return result.census === null ? null : judgeDecision(result.census.evidence);
}

/** A repo holding exactly the recorded evidence the projection is allowed to read. */
function repoWith(
  spec: BatterySpec,
  opts?: { batteryRuntime?: JsonObject; judgeWithoutRules?: true },
): SealedFixture {
  const root = scratchDir("ana-judge-");
  mkdirSync(join(root, "campaigns", SLUG), { recursive: true });
  writeFileSync(join(root, "campaigns", SLUG, "case-record.jsonl"), "");
  // The judges evidence the Judge exit's finding cites; analyse-step records it before admission.
  mkdirSync(join(root, "campaigns", SLUG, "analysis"), { recursive: true });
  writeFileSync(join(root, "campaigns", SLUG, "analysis", `${RUN}-judges.json`), "{}");
  const treeBase = join(root, "domains", SLUG);
  // Pointers are created from the written bytes; a deliberately absent file (census "none") gets a
  // pointer whose digest can never verify, which is exactly the drift the reader must state.
  const pointerOf = (rel: string) =>
    existsSync(join(treeBase, rel)) ? tracePointer(treeBase, rel) : { path: rel, sha256: "0".repeat(64) };
  const runDir = join(treeBase, "runs", RUN);
  mkdirSync(runDir, { recursive: true });
  // Every file in the run directory must appear in the evidence log. `recordedEvidence` therefore
  // refuses `battery.json` when an unrecorded file is present.
  const log = new EvidenceLog(runDir);
  if (spec.census !== "none") {
    log.write("battery.json", { runId: RUN, judge: judgeEvidenceFor(spec), ...opts?.batteryRuntime });
  }
  for (const row of spec.cases) {
    const caseRel = `cases/${row.taskId}`;
    log.write(`${caseRel}/public-task.json`, { taskId: row.taskId, span: 12 });
    log.write(`${caseRel}/artifact.json`, { members: [{ id: row.taskId }] });
    if (spec.census !== "none" && spec.census !== "off") {
      const verdict = judgeVerdictOf(row);
      const judged = subjectEvidence(row.taskId, "battery-case", verdict);
      if (verdict === false && row.truthOk === true) {
        const resample = row.resample === undefined ? row.truthOk : row.resample;
        Object.assign(judged, { confirmation: subjectEvidence(row.taskId, "battery-case", resample) });
      }
      log.write(
        `${caseRel}/judge.json`,
        opts?.judgeWithoutRules === true
          ? Object.fromEntries(Object.entries(judged).filter(([key]) => key !== "rules"))
          : judged,
      );
    }
  }
  log.record();
  const cases: CaseEvidence[] = spec.cases.map((row) => ({
    taskId: row.taskId,
    family: row.family ?? "truss",
    acceptedSubmit: row.truthOk !== null,
    truthOk: row.truthOk,
    pass: row.truthOk,
    runtimeNonResult: row.truthOk === null ? "provider unavailable" : null,
    runtimeNonResultKind: row.truthOk === null ? "provider" : null,
    traces: [pointerOf(`runs/${RUN}/battery.json`)],
  }));
  const verified = cases.filter((row) => row.truthOk !== null).length;
  return {
    root,
    analysis: {
      schema: "iteration-analysis/v5",
      slug: SLUG,
      runId: RUN,
      treeRoot: `domains/${SLUG}`,
      identities: {
        bundleSnapshot: {
          id: "cap-1",
          agentHash: "a".repeat(64),
          correctnessModelHash: "b".repeat(64),
          scoringHash: "b".repeat(64),
          taskSetHash: null,
          toolTreeDigest: null,
        },
        backendPin: BUILT_PIN,
        builtEffort: "high",
        buildInputsHash: "d".repeat(64),
        isolationStrength: "physical",
      },
      battery: {
        runId: RUN,
        condition: { variant: "shipping", advisorsRemoved: [] },
        claimCreated: true,
        claimClauses: [],
        readinessClauses: [],
        blockingByCheck: {},
        applicableByCheck: {},
        summary: {
          runId: RUN,
          total: cases.length,
          verified,
          unaccepted: 0,
          nonResults: cases.length - verified,
          passed: cases.filter((row) => row.truthOk === true).length,
          passRate: verified === 0 ? null : cases.filter((row) => row.truthOk === true).length / verified,
          discrimination: "informative",
        },
      },
      cases,
      absent: [],
    },
  };
}

/** `count` verified cases, the first `contested` of which the verifier failed and the Judge passed. */
function exitBattery(count: number, contested: number): BatterySpec {
  return {
    cases: Array.from({ length: count }, (_, index) =>
      index < contested
        ? { taskId: `t${index}`, family: index === 0 ? "deck" : "truss", truthOk: false, judge: true }
        : { taskId: `t${index}`, truthOk: true },
    ),
  };
}

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(root, entry.name)) : [join(root, entry.name)],
  );
}

describe("the main-Judge census projection reads recorded evidence, never a model", () => {
  it("reads a battery that recorded no census as absent, and the terminal lists it", () => {
    const { root, analysis } = repoWith({ cases: [{ taskId: "t1", truthOk: true }], census: "none" });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.outcome).toEqual({ kind: "absent", why: expect.stringMatching(/^no census to read \(/) });
    expect(absentLines({ "main-judge census": result.outcome })).toEqual([
      expect.stringMatching(/^main-judge census: no census to read \(domains\/bridge-truss\/runs\/base/),
    ]);
    expect(result.census).toBeNull();
    expect(result.contested).toEqual([]);
    expect(result.coverage).toEqual({ reviewable: 0, reviewed: 0 });
  });

  // The review slot was off, so no Judge ran: an operator condition, like an epoch review whose slot
  // is off, and not missing work. The exit still says why the Judge reviewed nothing.
  it('reads a judge:"off" battery as a skip, never as an absent review', () => {
    const { root, analysis } = repoWith({ cases: [{ taskId: "t1", truthOk: true }], census: "off" });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.outcome).toEqual({ kind: "skipped", reason: "review-slot-off" });
    expect(absentLines({ "main-judge census": result.outcome })).toEqual([]);
    expect(result.exit.kind).toBe("none");
  });

  it("refuses a census whose stored aggregate contradicts its own fields, as an absent reading", () => {
    const { root, analysis } = repoWith({ cases: [{ taskId: "t1", truthOk: true }], census: "tampered" });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    // Refused evidence carries its validation error: no census is returned, the violation is
    // quoted as the reason, and nothing gets projected from the contradictory aggregate.
    expect(result.outcome).toEqual({
      kind: "absent",
      why: expect.stringMatching(/vetoed must be a non-negative integer within verdicts/),
    });
    expect(result.census).toBeNull();
  });

  it("writes nothing: no case row, evidence, claim, or analysis file is touched", () => {
    const { root, analysis } = repoWith({
      cases: [
        { taskId: "t1", truthOk: true },
        { taskId: "t2", truthOk: false },
      ],
    });
    const before = walk(root).map((path) => `${path}:${String(statSync(path).size)}`);
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: JUDGE_PIN });
    expect(walk(root).map((path) => `${path}:${String(statSync(path).size)}`)).toEqual(before);
    expect(result.analysisDigest).toHaveLength(64);
    expect(result.schema).toBe("judge-reviews/v15");
    expect(result.judgePin).toBe(JUDGE_PIN);
  });
});

describe("a cited fail joins the check it contradicts", () => {
  const subject = (
    taskId: string,
    truthOk: boolean,
    verdict: Verdict,
    rules: string[],
    settled: { confirmation?: boolean | undefined; failedCheckIds?: string[] | undefined } = {},
  ) => {
    const { confirmation } = settled;
    const failedCheckIds = settled.failedCheckIds ?? [];
    const judgeEvidence = { ...subjectEvidence(taskId, "battery-case", verdict), rules };
    if (confirmation !== undefined) {
      Object.assign(judgeEvidence, {
        confirmation: {
          ...subjectEvidence(taskId, "battery-case", confirmation),
          rules: confirmation ? [] : rules,
        },
      });
    }
    return {
      taskId,
      family: "truss",
      truthOk,
      judgePath: `cases/${taskId}/judge.json`,
      judgeEvidence,
      artifactPath: null,
      failedCheckIds,
    };
  };
  it("names the declared check whose assertion the fail quotes, and vetoes only a confirmed cited fail of a verifier pass", () => {
    const rows = contestedCases(
      [
        subject("t1", true, false, [MEMBER_CAPACITY_RULE, "artifactSchema"], {
          confirmation: false,
        }),
        subject("t2", true, false, ["artifactSchema"], { confirmation: false }),
        subject("t3", true, false, []),
        subject("t4", false, true, []),
        subject("t5", true, false, [MEMBER_CAPACITY_RULE], { confirmation: true }),
        subject("t6", true, false, [MEMBER_CAPACITY_RULE]),
      ],
      new Map([[MEMBER_CAPACITY_RULE, "member-capacity"]]),
    );
    expect(rows.every((row) => row.rationale === "scripted census fixture")).toBe(true);
    expect(rows.map((row) => [row.taskId, row.rules, row.checkIds, row.kind, mustSettle(row)])).toEqual([
      ["t1", [MEMBER_CAPACITY_RULE, "artifactSchema"], ["member-capacity"], "veto", true],
      ["t2", ["artifactSchema"], [], "veto", true],
      ["t3", [], [], "unconfirmed-fail", false],
      ["t4", [], [], "disputed-pass", false],
      ["t5", [MEMBER_CAPACITY_RULE], ["member-capacity"], "unconfirmed-fail", false],
      ["t6", [MEMBER_CAPACITY_RULE], ["member-capacity"], "unconfirmed-fail", false],
    ]);
  });

  it("a verifier fail the Judge passed names the failing checks and is disputed on its one sample", () => {
    const rows = contestedCases(
      [
        subject("pass", false, true, [], { failedCheckIds: ["member-capacity"] }),
        subject("unnamed", false, true, [], { failedCheckIds: [] }),
        // An undecided recorded before 2026-09-30 claimed nothing, and an unanswered subject is no
        // verdict.
        subject("undecided", false, "abstain", [MEMBER_CAPACITY_RULE], {
          failedCheckIds: ["member-capacity"],
        }),
        subject("errored", false, null, [], { failedCheckIds: ["member-capacity"] }),
      ],
      new Map([[MEMBER_CAPACITY_RULE, "member-capacity"]]),
    );
    expect(rows.map((row) => [row.taskId, row.kind, row.rules, row.checkIds, mustSettle(row)])).toEqual([
      ["pass", "disputed-pass", [], ["member-capacity"], true],
      ["unnamed", "disputed-pass", [], [], false],
    ]);
  });

  it("hands the Epoch Reviewer every contradiction, the vetoes and disputed fails to settle and the rest to read", () => {
    const rows = contestedCases(
      [
        subject("veto", true, false, [MEMBER_CAPACITY_RULE], { confirmation: false }),
        subject("disputed", false, true, [], { failedCheckIds: ["member-capacity"] }),
        // The nearest miss of a disputed fail: no failing check is on record to settle it against.
        subject("unnamed", false, true, [], { failedCheckIds: [] }),
        // A cited fail a second sample withdrew is read, never settled.
        subject("withdrawn", true, false, [MEMBER_CAPACITY_RULE], { confirmation: true }),
      ],
      new Map([[MEMBER_CAPACITY_RULE, "member-capacity"]]),
    );
    const split = reviewerContested(rows);
    expect(Object.values(split).map((list) => list.map((row) => row.taskId))).toEqual([
      ["veto", "disputed"],
      ["unnamed", "withdrawn"],
    ]);
    expect(Object.keys(split)).toEqual(["settle", "otherContested"]);
  });
});

describe("real-case disagreements stay threshold-free", () => {
  it("records every disagreement in both directions and routes none of them", () => {
    const { root, analysis } = repoWith({
      cases: [
        { taskId: "t1", truthOk: false, judge: true },
        { taskId: "t2", truthOk: true, judge: false },
      ],
    });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.census?.evidence.judge).toBe("unvalidated");
    expect(judgeOf(result)).toBe("advisory-comparison");
    expect(result.outcome).toEqual({ kind: "read" });
    expect(result.contested.map(({ taskId, kind }) => [taskId, kind])).toEqual([
      ["t1", "disputed-pass"],
      ["t2", "unconfirmed-fail"],
    ]);
    // An advisory disclosure is the exit alone; it records no finding for any author session.
    expect(result.exit.kind).toBe("advisory");
    expect(result.exit.reason).toMatch(/on 2 of 2 verified cases /);
    expect(result.exit.reason).not.toContain("t1");
    expect(result).not.toHaveProperty("findings");
    // The recorded verifier verdict is untouched.
    expect(analysis.cases.find((row) => row.taskId === "t1")?.pass).toBe(false);
  });

  it("names one disagreement in four with its recorded evidence and artifact pointers", () => {
    const { root, analysis } = repoWith({
      cases: [
        { taskId: "t1", truthOk: true, judge: false },
        { taskId: "t2", truthOk: true },
        { taskId: "t3", truthOk: true },
        { taskId: "t4", truthOk: false },
      ],
    });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.census?.evidence).toMatchObject({ verdicts: 4 });
    expect(result.coverage).toEqual({ reviewable: 4, reviewed: 4 });
    // The raw contradiction is named without filtering at 0.25.
    expect(result.contested).toEqual([
      {
        taskId: "t1",
        family: "truss",
        kind: "unconfirmed-fail",
        rules: [],
        rationale: "scripted census fixture",
        checkIds: [],
        evidence: `domains/${SLUG}/runs/${RUN}/cases/t1/judge.json`,
        // The recorded pointer to the artifact under dispute: t1 PASSED the verifier, so the row
        // proves the producer reads judged artifacts through the record, not only failed ones.
        artifact: `domains/${SLUG}/runs/${RUN}/cases/t1/artifact.json`,
      },
    ]);
    expect(result.exit).toMatchObject({
      kind: "advisory",
      cases: { veto: 0, "unconfirmed-fail": 1, "disputed-pass": 0 },
    });
  });

  it("never counts pass rate as disagreement: an all-fail battery may have no objection", () => {
    const { root, analysis } = repoWith({
      cases: [
        { taskId: "t1", truthOk: false },
        { taskId: "t2", truthOk: false },
      ],
    });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(judgeOf(result)).toBe("advisory-comparison");
    expect(result.exit.kind).toBe("none");
  });
});

describe("coverage and historical records", () => {
  // An incomplete census used to set a provisional note and nothing else, so the design-11 and
  // design-3 runs recorded 7/10, 8/15 and 0/4 verdicts returned with no absent step on the terminal.
  it("reads an incomplete census as absent, names the complete disagreement, and reaches the terminal", () => {
    const { root, analysis } = repoWith({
      cases: [
        { taskId: "t1", truthOk: true, judge: false },
        { taskId: "t2", truthOk: true, judge: null },
      ],
    });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(judgeOf(result)).toBe("incomplete-census");
    const why = "the judge review is incomplete (incomplete-census): 1/2 battery verdicts returned";
    expect(result.outcome).toEqual({ kind: "absent", why });
    expect(absentLines({ "main-judge census": result.outcome })).toEqual([`main-judge census: ${why}`]);
    expect(result.coverage).toEqual({ reviewable: 2, reviewed: 1 });
    expect(result.contested.map((row) => row.taskId)).toEqual(["t1"]);
    expect(result.exit.kind).toBe("advisory");
    // Phrased as "0 citing shown rules", the clause reads as a count of fails that cited nothing,
    // and a fail that did cite a rule and was not repeated on the re-sample lands in it. The clause
    // counts vetoes, so it says veto and says what one is.
    expect(result.exit.reason).toContain(
      "0 were vetoes, a cited fail of a verifier pass that a second sample repeated",
    );
    expect(result.exit.reason).not.toContain("citing shown rules");
  });

  it("reads a Judge fail of a verifier pass with no resample verdict as absent", () => {
    const { root, analysis } = repoWith({
      cases: [
        { taskId: "t1", truthOk: true, judge: false, resample: null },
        { taskId: "t2", truthOk: true },
        // A Judge pass of a verifier fail draws no resample, so its absence holds nothing.
        { taskId: "t3", truthOk: false, judge: true },
      ],
    });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(judgeOf(result)).not.toBe("incomplete-census");
    expect(result.outcome).toEqual({
      kind: "absent",
      why: "the judge review is incomplete: 1 Judge fails of a verifier pass returned no resample verdict",
    });
    expect(result.contested.map((row) => [row.taskId, row.kind])).toEqual([
      ["t1", "unconfirmed-fail"],
      ["t3", "disputed-pass"],
    ]);
  });

  it("reads an undecided recorded before 2026-09-30 as an answer that contests nothing", () => {
    const { root, analysis } = repoWith({
      cases: [
        { taskId: "t1", truthOk: true, judge: "abstain" },
        { taskId: "t2", truthOk: false, judge: "abstain" },
        { taskId: "t3", truthOk: true },
      ],
    });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.outcome).toEqual({ kind: "read" });
    expect(result.coverage).toEqual({ reviewable: 3, reviewed: 3 });
    expect(result.contested).toEqual([]);
  });

  it("contests no case whose Judge fail cites no rule", () => {
    const { root, analysis } = repoWith(
      { cases: [{ taskId: "t1", truthOk: true, judge: false }] },
      { judgeWithoutRules: true },
    );
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.census?.evidence.verdicts).toBe(1);
    expect(result.contested).toEqual([]);
  });
});

describe("the Judge exit is advice only", () => {
  it("advises on verifier-fail/Judge-pass cases and records no finding for an owner", () => {
    const { root, analysis } = repoWith(exitBattery(10, 3));
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: JUDGE_PIN });
    expect(result.outcome).toEqual({ kind: "read" });
    expect(result.exit).toMatchObject({
      kind: "advisory",
      cases: { veto: 0, "unconfirmed-fail": 0, "disputed-pass": 3 },
      verified: 10,
    });
    // Families are authoring identities; task ids are failure locations and never leave the record.
    expect(result.exit.reason).not.toMatch(/t[0-9]/);
    expect(result).not.toHaveProperty("findings");
  });

  it("does not block when the Judge disputes every verified case", () => {
    const { root, analysis } = repoWith(exitBattery(10, 10));
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: JUDGE_PIN });
    expect(result.census?.evidence.judge).toBe("unvalidated");
    expect(judgeOf(result)).toBe("advisory-comparison");
    expect(result.exit).toMatchObject({ kind: "advisory", cases: { "disputed-pass": 10 } });
  });

  it("is `none`, with no finding at all, when the Judge and the verifier agreed everywhere", () => {
    const { root, analysis } = repoWith(exitBattery(10, 0));
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: JUDGE_PIN });
    expect(result.exit).toMatchObject({ kind: "none", cases: { "disputed-pass": 0 }, verified: 10 });
    expect(result.exit.reason).toBe("the Judge contradicted the verifier on no reviewed verified case");
  });

  // Agreement is claimed over the cases the Judge returned a verdict on. A census where every
  // subject came back empty, as a spent review account leaves it, agreed on nothing.
  it("says the Judge reviewed nothing, and why, when no case returned a verdict", () => {
    const cases = ["t1", "t2", "t3", "t4"].map((taskId) => ({ taskId, truthOk: true, judge: null }));
    const unanswered = repoWith({ cases });
    const empty = runJudgeReviews(unanswered.analysis, { repoRoot: unanswered.root, judgePin: JUDGE_PIN });
    expect(empty.coverage).toEqual({ reviewable: 4, reviewed: 0 });
    expect(empty.exit).toMatchObject({
      kind: "none",
      reason: "the Judge reviewed no verified case: none of the 4 cases offered to it returned a verdict",
    });
    const off = repoWith({ cases: [{ taskId: "t1", truthOk: true }], census: "off" });
    expect(runJudgeReviews(off.analysis, { repoRoot: off.root, judgePin: null }).exit.reason).toBe(
      'the Judge reviewed no verified case: the evidence says judge:"off", so this battery had no judge',
    );
  });
});

describe("Judge prompt policy", () => {
  it("states each duty once, spells no number that could go stale and keeps the per-requirement listing out", () => {
    const { census } = ACTIVE_JUDGE_PROMPTS;
    for (const duty of [
      "Your verdict is fail or pass.",
      "only when the shown material itself shows the breach",
      "its unit, sign and boundaries included",
      "is left to the verifier",
      "Do not predict it in either direction and never fail on it",
      "claims nothing about what you left to the verifier",
      "being well-formed, confident or plausible is not a reason to pass",
      "grounds none",
    ]) {
      expect(census.split(duty).length - 1).toBe(1);
    }
    expect(census).not.toMatch(/\d/);
    // The retired clause that invited hand sums and the retired undecided verdict stay out.
    expect(census).not.toContain("carrying full precision through sums");
    expect(census).not.toMatch(/\babstain\b|undecided/);
  });
});
