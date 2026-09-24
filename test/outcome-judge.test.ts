/**
 * Valid Judge evidence is returned unchanged. Contradictory evidence is refused. A missing or
 * unknown judge file is unavailable rather than zero, and only the file named by the exact run id
 * is read. None of these reports can change case truth.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import type { ContestedCase } from "../src/analyse/judge-contested.ts";
import type { JudgeReviewsResult } from "../src/analyse/judge-reviews.ts";
import type { JudgeEvidence } from "../src/claim/judge.ts";
import { main } from "../tools/outcome/cli.ts";
import { OUTCOME_JUDGE_SCHEMA, judgeReport } from "../tools/outcome/judge.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";

const scratch: string[] = [];
const RUN = "53";
const CASE_DIR = `domains/fixture/runs/${RUN}/cases`;

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function campaignDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "outcome-judge-"));
  scratch.push(dir);
  mkdirSync(join(dir, "analysis"), { recursive: true });
  return dir;
}

/** The review the current producer records: no control census behind it. */
function validEvidence(): Exclude<JudgeEvidence, { judge: "off" }> {
  return {
    judge: "unvalidated",
    judgePin: "claude/claude-opus-5",
    promptPolicyDigest: "a".repeat(64),
    evaluatedPin: "codex/gpt-5.5",
    correctnessModelId: "correctness-model@g1",
    offered: 1,
    verdicts: 1,
    abstentions: 0,
    disagreements: 0,
    disagreementDenominator: 1,
    verifierPassJudgeFail: 0,
    vetoed: 0,
  };
}

/** Evidence whose battery verdicts exceed its battery census: re-validation must refuse it. */
function contradictoryEvidence(): Exclude<JudgeEvidence, { judge: "off" }> {
  return { ...validEvidence(), verdicts: 2 };
}

function contestedRow(taskId: string, judge: boolean, verifier: boolean): ContestedCase {
  return {
    taskId,
    family: "truss",
    judge,
    verifier,
    rules: [],
    rationale: null,
    confirmed: false,
    checkIds: [],
    evidence: `${CASE_DIR}/${taskId}/judge.json`,
    artifact: `${CASE_DIR}/${taskId}/artifact.json`,
  };
}

function review(
  evidence: Exclude<JudgeEvidence, { judge: "off" }>,
  contested: ContestedCase[] = [],
  exit: JudgeReviewsResult["exit"] = {
    kind: "none",
    verifierFailJudgePass: 0,
    verifierPassJudgeFail: 0,

    verified: 1,
    reason: "the Judge and the verifier agreed on every reviewed verified case",
  },
): JudgeReviewsResult {
  return {
    schema: "judge-reviews/v11",
    slug: "fixture",
    runId: RUN,
    judgePin: "claude/claude-opus-5",
    promptPolicyDigests: { census: "b".repeat(64) },
    analysisDigest: "d".repeat(64),
    census: { runId: RUN, evidence },
    contested,
    coverage: { reviewable: 2, reviewed: 2 },
    provisional: null,
    exit,
    findings: [],
    absent: [],
  };
}

function writeReview(dir: string, result: JsonValue): void {
  writeFileSync(join(dir, "analysis", `${RUN}-judges.json`), JSON.stringify(result, null, 2));
}

/** A report that must be available, narrowed for the assertions below. */
function availableReport(dir: string, selector: string) {
  const report = judgeReport(dir, selector);
  if (!report.available) throw new Error(`expected an available report, got: ${report.reason}`);
  return report;
}

describe("the evidence-bound judge projection", () => {
  it("re-validates and returns recorded evidence unchanged, with the Judge exit", () => {
    const dir = campaignDir();
    const evidence = validEvidence();
    const exit: JudgeReviewsResult["exit"] = {
      kind: "advisory",
      verifierFailJudgePass: 0,
      verifierPassJudgeFail: 1,
      verified: 1,
      reason: "the Judge failed 1 of 1 verified cases the verifier passed",
    };
    writeReview(dir, review(evidence, [], exit));
    const report = availableReport(dir, RUN);
    expect(report.schema).toBe(OUTCOME_JUDGE_SCHEMA);
    expect(report.census).toEqual({ runId: RUN, evidence });
    expect(report.coverage).toEqual({ reviewable: 2, reviewed: 2 });
    expect(report.exit).toEqual(exit);
    expect(report.contested).toEqual([]);
    expect(report.contestedUnavailable).toEqual([]);
    expect(report.absent).toEqual([]);
  });

  it("projects a complete dispute in each direction with the validated census identities", () => {
    const dir = campaignDir();
    const evidence = validEvidence();
    writeReview(dir, review(evidence, [contestedRow("t1", false, true), contestedRow("t2", true, false)]));
    const report = availableReport(dir, RUN);
    expect(report.contested).toEqual([
      {
        runId: RUN,
        taskId: "t1",
        family: "truss",
        judge: false,
        verifier: true,
        direction: "verifier-pass-judge-fail",
        judgeEvidence: `${CASE_DIR}/t1/judge.json`,
        artifact: `${CASE_DIR}/t1/artifact.json`,
        correctnessModelId: "correctness-model@g1",
      },
      {
        runId: RUN,
        taskId: "t2",
        family: "truss",
        judge: true,
        verifier: false,
        direction: "verifier-fail-judge-pass",
        judgeEvidence: `${CASE_DIR}/t2/judge.json`,
        artifact: `${CASE_DIR}/t2/artifact.json`,
        correctnessModelId: "correctness-model@g1",
      },
    ]);
    expect(report.contestedUnavailable).toEqual([]);
  });

  it("refuses a disagreement under a failed census re-validation: disclosed, never a dispute row", () => {
    const dir = campaignDir();
    // Battery verdicts above the battery census fail re-validation, so the census
    // identity is a refusal — the disagreement is stated as unavailable, not presented as a
    // complete dispute the operator could act on.
    writeReview(dir, review(contradictoryEvidence(), [contestedRow("t1", false, true)]));
    const report = availableReport(dir, RUN);
    expect(report.contested).toEqual([]);
    expect(report.contestedUnavailable).toEqual([
      expect.stringContaining("t1: the measured review was refused or absent"),
    ]);
  });

  it("follows a contested path that promotion moved from candidates/ to domains/, and keeps one found nowhere", () => {
    // Run c66e0d: judges.json recorded candidates/<run>/… paths and promotion moved the tree to
    // domains/<slug>/ 112 seconds later, so the reader printed four paths that no longer existed.
    const root = mkdtempSync(join(tmpdir(), "outcome-judge-root-"));
    scratch.push(root);
    const dir = join(root, "campaigns", "fixture");
    mkdirSync(join(dir, "analysis"), { recursive: true });
    const moved = `campaigns/fixture/candidates/${RUN}/runs/${RUN}/cases/t1`;
    const row = {
      ...contestedRow("t1", true, false),
      evidence: `${moved}/judge.json`,
      artifact: `${moved}/artifact.json`,
    };
    mkdirSync(join(root, CASE_DIR, "t1"), { recursive: true });
    writeFileSync(join(root, CASE_DIR, "t1", "judge.json"), "{}");
    writeReview(dir, review(validEvidence(), [row]));
    const report = availableReport(dir, RUN);
    expect(report.contested[0]?.judgeEvidence).toBe(`${CASE_DIR}/t1/judge.json`);
    expect(report.contested[0]?.artifact).toBe(`${moved}/artifact.json`);
  });

  it("refuses a row with no record-backed artifact pointer", () => {
    const dir = campaignDir();
    const unbound = review(validEvidence(), [
      { ...contestedRow("t1", false, true), artifact: null },
      { ...contestedRow("t2", true, false), artifact: null },
    ]);
    writeReview(dir, unbound);
    const report = availableReport(dir, RUN);
    expect(report.contested).toEqual([]);
    expect(report.contestedUnavailable).toEqual([
      expect.stringContaining("t1: no saved answer path"),
      expect.stringContaining("t2: no saved answer path"),
    ]);
  });

  it("turns internally contradictory evidence into a typed refusal, never plausible counts", () => {
    const dir = campaignDir();
    // Battery verdicts above the battery census: the exact class of hand-built or stale
    // aggregate validateJudgeEvidence exists to refuse.
    writeReview(dir, review(contradictoryEvidence()));
    const report = availableReport(dir, RUN);
    expect(report.census).toMatchObject({
      runId: RUN,
      refusal: expect.stringContaining("evidence fails re-validation"),
    });
    expect(report.census).not.toHaveProperty("evidence");
  });

  it("reports an absent review as unavailable at the exact path, never another battery's", () => {
    const dir = campaignDir();
    // The first round's review exists; the second round's does not, and must not borrow it.
    writeReview(dir, review(validEvidence()));
    const report = judgeReport(dir, `${RUN}-i02`);
    expect(report).toMatchObject({ available: false });
    if (report.available) throw new Error("unreachable");
    expect(report.reason).toBe(
      `no judge review evidence at ${join(dir, "analysis", `${RUN}-i02-judges.json`)}`,
    );
  });

  it("refuses a foreign review schema instead of projecting unknown bytes", () => {
    const dir = campaignDir();
    writeReview(dir, { ...review(validEvidence()), schema: "judge-reviews/v10" });
    const report = judgeReport(dir, RUN);
    expect(report).toMatchObject({ available: false });
    if (report.available) throw new Error("unreachable");
    expect(report.reason).toContain("judge-reviews/v10 is not judge-reviews/v11");
  });

  it("is reachable from the CLI as --judge", () => {
    const dir = campaignDir();
    writeReview(dir, review(validEvidence()));
    const report = parseJsonAs<{ schema: string; available: boolean }>(main([dir, RUN, "--judge"]));
    expect(report.schema).toBe(OUTCOME_JUDGE_SCHEMA);
    expect(report.available).toBe(true);
  });
});

describe("a review that recorded no census", () => {
  it("reads as a censusless review whose disagreements cannot be shown as disputes", () => {
    const dir = campaignDir();
    writeReview(dir, { ...review(validEvidence(), [contestedRow("t1", true, false)]), census: null });
    const report = availableReport(dir, RUN);
    expect(report.census).toBeNull();
    // Without a checked census identity the disagreement cannot be shown as a dispute.
    expect(report.contested).toEqual([]);
    expect(report.contestedUnavailable).toEqual([
      expect.stringContaining("t1: the measured review was refused or absent"),
    ]);
  });
});
