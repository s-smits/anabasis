import { afterAll, describe, expect, it } from "bun:test";
import {
  buildReviewYield,
  diagnosisReader,
  epochReviewer,
  harnessTrial,
  renderReviewYield,
} from "../.claude/skills/whole-run-investigation/scripts/review-yield.mjs";
import { mkdirSync, utimesSync, writeFileSync } from "../src/meta/filesystem.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { join } from "../src/meta/path.ts";
import { REBUILD_ADVICE_SCHEMA } from "../src/author/rebuild-advice.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import { EPOCH_REVIEW_SCHEMA } from "../src/review/epoch-review-findings.ts";
import { DIAGNOSIS_READING_SCHEMA } from "../src/review/diagnosis-reader.ts";
import type { BuilderCustomToolCall } from "../src/author/builder-execution.ts";
import { executionRecord, submitCall, trialCall } from "./helpers/builder-execution-record.ts";

type Yield = {
  verdict: string;
  summary: {
    iterations: number;
    opportunities: number | null;
    outputs: number | null;
    consumed: number | null;
    changed: number | null;
  };
  runs: Array<{
    runId: string;
    changed: boolean | null;
    consumer: unknown;
    note: string;
    unknown?: boolean;
  }>;
  reasons: string[];
};

/** JSON values used to construct analysis fixtures. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [field: string]: JsonValue };
type RecordedEvidence = { [field: string]: JsonValue };

afterAll(cleanupScratch);

/** An empty campaign with analysis and promotion directories; each test adds its records. */
function campaign(): string {
  const root = scratchDir("ana-review-yield-");
  mkdirSync(join(root, "analysis"), { recursive: true });
  mkdirSync(join(root, "promotions"), { recursive: true });
  return root;
}

function record(root: string, runId: string, kind: string, body: RecordedEvidence, order: number): void {
  const path = join(root, "analysis", `${runId}-${kind}.json`);
  writeFileSync(path, JSON.stringify(body));
  const at = new Date(2026, 8, 1, 12, order);
  utimesSync(path, at, at);
}

function iterations(root: string): void {
  record(root, "run-a", "analysis", { schema: "iteration-analysis/v5" }, 1);
  record(root, "run-b", "analysis", { schema: "iteration-analysis/v5" }, 2);
}

describe("review-yield: current advice readers", () => {
  it("reads an observation's admission route and refuses an unrelated feedback join", () => {
    const root = campaign();
    iterations(root);
    const finding = {
      defect: false,
      owner: "correctness-model/tasks.json" as const,
      claim: "private assessment",
      evidence: "analysis/run-a-epoch-review.json",
    };
    const projected = publicEpochReview({ status: "completed", findings: [finding], disputes: [] });
    record(
      root,
      "run-a",
      "epoch-review",
      {
        schema: EPOCH_REVIEW_SCHEMA,
        status: "completed",
        condition: { digest: "a" },
        findings: [finding],
        disputes: [],
      },
      3,
    );
    const feedback = {
      owner: "correctness-model/tasks.json",
      findings: [{ code: "observation", path: finding.evidence, detail: "public projection" }],
    };
    record(root, "run-a", "admission", { admitted: projected.findings, feedback: [feedback] }, 4);
    expect(epochReviewer(root).runs[0]?.consumer).toMatchObject({
      value: { admitted: 1, routedOwners: ["correctness-model/tasks.json"] },
    });
    expect(JSON.stringify(epochReviewer(root))).not.toContain("private assessment");
    record(
      root,
      "run-a",
      "admission",
      {
        admitted: projected.findings,
        feedback: [{ ...feedback, findings: [{ ...feedback.findings[0], path: "another-producer.json" }] }],
      },
      5,
    );
    expect(epochReviewer(root).runs[0]?.consumer).toMatchObject({ value: { routedOwners: [] } });
    record(root, "run-a", "admission", { admitted: projected.findings }, 6);
    expect(epochReviewer(root).runs[0]?.consumer).toMatchObject({ value: { routedOwners: null } });
  });

  it("uses the real public epoch projection and keeps different measured conditions separate", () => {
    const root = campaign();
    iterations(root);
    const findings = [
      {
        defect: true,
        claim: "private assessment",
        evidence: "private",
        owner: "agent/BUILT_AGENTS.md" as const,
      },
    ];
    const disputes = [{ issueId: "issue-a", reason: "private reason" }];
    const projected = publicEpochReview({ status: "completed", findings, disputes });
    const review = {
      schema: EPOCH_REVIEW_SCHEMA,
      status: "completed",
      findings,
      disputes,
      condition: { digest: "condition-a", taskSetHash: "same" },
      coverage: { opened: 2 },
    };
    record(root, "run-a", "epoch-review", review, 3);
    record(root, "run-a", "admission", { admitted: projected.findings }, 4);
    record(
      root,
      "run-a",
      "rebuild-advice",
      {
        schema: REBUILD_ADVICE_SCHEMA,
        issues: [{ id: "issue-a", status: "disputed", dispute: projected.disputes[0]?.reason ?? "" }],
      },
      5,
    );
    record(
      root,
      "run-b",
      "epoch-review",
      { ...review, findings: [], disputes: [], condition: { digest: "condition-b", taskSetHash: "same" } },
      6,
    );
    const out: Yield = epochReviewer(root);
    expect(out.summary.consumed).toBe(1);
    expect(out.summary.changed).toBeNull();
    expect(out.verdict).toBe("advisory-only");
    expect(out.reasons.some((reason) => reason.startsWith("review conditions repeated"))).toBe(false);
    expect(JSON.stringify(out)).not.toContain("private assessment");
    expect(JSON.stringify(out)).not.toContain("private reason");
    record(
      root,
      "run-a",
      "admission",
      { admitted: [{ ...projected.findings[0], evidence: "analysis/run-a-judges.json" }] },
      7,
    );
    record(
      root,
      "run-a",
      "rebuild-advice",
      { schema: REBUILD_ADVICE_SCHEMA, issues: [{ id: "issue-a", status: "active", dispute: null }] },
      8,
    );
    expect(epochReviewer(root).summary.consumed).toBe(0);
  });

  it("counts an admitted epoch finding whose public claim another revision worded differently", () => {
    const root = campaign();
    iterations(root);
    const findings = [
      {
        defect: true,
        claim: "private assessment",
        evidence: "analysis/run-a-epoch-review.json",
        owner: "agent/BUILT_AGENTS.md" as const,
      },
      {
        defect: true,
        claim: "a second private assessment",
        evidence: "analysis/run-a-epoch-review.json",
        owner: "agent/BUILT_AGENTS.md" as const,
      },
    ];
    const review = {
      schema: EPOCH_REVIEW_SCHEMA,
      status: "completed",
      findings,
      disputes: [],
      condition: { digest: "condition-a", taskSetHash: "same" },
      coverage: { opened: 2 },
    };
    record(root, "run-a", "epoch-review", review, 3);
    // The recorded admission was written by another revision of publicEpochReview: same placement
    // and evidence file, a claim sentence this tree cannot reproduce. Both rows are admitted.
    const projection = publicEpochReview({ status: "completed", findings, disputes: [] });
    const olderWording = projection.findings.map((finding, index) => ({
      ...finding,
      claim: `The epoch review reported ${finding.defect ? "defect" : "observation"} in ${finding.owner}: check \`some-check-${index}\`; repair the enforcement in that owner's files.`,
    }));
    record(root, "run-a", "admission", { admitted: olderWording }, 4);
    record(
      root,
      "run-b",
      "epoch-review",
      { ...review, findings: [], condition: { digest: "condition-b", taskSetHash: "same" } },
      5,
    );
    const out: Yield = epochReviewer(root);
    expect(out.summary.consumed).toBe(1);
    expect(out.runs[0]?.note).toBe(
      "2 public finding(s) admitted; unknown issue dispute(s) retained; repair benefit unmeasured",
    );
    expect(JSON.stringify(out)).not.toContain("private assessment");
    // Hostile: the same kind and owner citing another producer's evidence file is not epoch
    // consumption, and one admitted row cannot be counted for two findings.
    record(root, "run-a", "epoch-review", { ...review, status: "incomplete" }, 6);
    expect(epochReviewer(root).runs[0]?.note).toBe(
      "2 public finding(s) admitted; unknown issue dispute(s) retained; repair benefit unmeasured",
    );
    const [firstWording, secondWording] = olderWording;
    if (firstWording === undefined || secondWording === undefined) {
      throw new Error("the projection lost a finding");
    }
    record(
      root,
      "run-a",
      "admission",
      { admitted: [{ ...firstWording, evidence: "analysis/run-a-judges.json" }, secondWording] },
      6,
    );
    expect(epochReviewer(root).runs[0]?.note).toBe(
      "1 public finding(s) admitted; unknown issue dispute(s) retained; repair benefit unmeasured",
    );
  });
});

describe("review-yield: harness-trial reader", () => {
  const candidate = "c".repeat(64);
  /** One epoch whose workspace declares two tasks and whose record holds `calls`. */
  function epoch(root: string, calls: BuilderCustomToolCall[]): string {
    const dir = join(root, "epoch-aa");
    mkdirSync(join(dir, "workspace", "correctness-model"), { recursive: true });
    writeFileSync(
      join(dir, "workspace", "correctness-model", "tasks.json"),
      JSON.stringify([{ taskId: "t1" }, { taskId: "t2" }]),
    );
    writeFileSync(join(dir, "builder-execution.json"), executionRecord([{}], 0, { customCalls: calls }));
    return dir;
  }

  it("consumes the rehearsal when the accepted submit froze rehearsed bytes", () => {
    const root = campaign();
    epoch(root, [
      trialCall(1, "t1", candidate, "fail"),
      trialCall(2, "t1", candidate, "pass"),
      submitCall(3, candidate),
    ]);
    const out: Yield = harnessTrial(root);
    expect(out.summary).toEqual({ iterations: 1, opportunities: 1, outputs: 1, consumed: 1, changed: 1 });
    expect(out.verdict).toBe("decision-bearing");
    expect(out.runs[0]).toMatchObject({
      runId: "epoch-aa",
      consumer: { field: "customCalls[].semantic.candidateId", value: candidate },
      note: "2 rehearsal(s); accepted submit was rehearsed",
    });
    expect(out.reasons).toEqual([
      "rehearsals 2 across 1 epoch(s), not-run 0; epochs whose accepted submit was never rehearsed: 0",
    ]);
  });

  it("does not consume a rehearsal of other bytes, and reads an absent record as unobservable", () => {
    const root = campaign();
    epoch(root, [trialCall(1, "t1", candidate, "not-run"), submitCall(2, "d".repeat(64))]);
    const out: Yield = harnessTrial(root);
    expect(out.summary).toMatchObject({ iterations: 1, opportunities: 1, outputs: 1, consumed: 0 });
    expect(out.runs[0]?.note).toBe("1 rehearsal(s); accepted submit was not rehearsed");
    expect(out.reasons[0]).toContain("not-run 1; epochs whose accepted submit was never rehearsed: 1");
    // An epoch without an execution record leaves the reading unknown rather than empty.
    mkdirSync(join(root, "epoch-bb"));
    const missing: Yield = harnessTrial(root);
    expect(missing.runs[1]).toMatchObject({ runId: "epoch-bb", unknown: true });
    expect(missing.summary.consumed).toBeNull();
    expect(missing.verdict).toBe("unobservable");
  });

  it("fails the component on an execution record of another schema rather than half-reading it", () => {
    const root = campaign();
    const dir = epoch(root, []);
    writeFileSync(
      join(dir, "builder-execution.json"),
      JSON.stringify({ schema: "builder-execution/v5", submits: [] }),
    );
    expect(() => harnessTrial(root)).toThrow("epoch-aa:");
    expect(buildReviewYield(root).components.find((row) => row.component === "harness-trial")).toMatchObject({
      status: "failed",
      verdict: "invalid",
    });
  });
});

describe("review-yield: diagnosis reader", () => {
  const diagnosis = {
    runId: "run-a",
    layer: "tool-contract",
    intervention: "correct",
    boundary: { tool: "write_layout", reading: "failed tool call" },
    cause: "public interface mismatch",
    falsifier: "the interface agrees",
    support: { cases: 2, shown: 3, matching: 3, contrasts: 0 },
    confidence: "medium",
  };
  const cited = { boundary: "c01.s2", supporting: ["c01", "c02"], contrast: [] };
  /** A complete current diagnosis reading, with the fields a test varies. */
  const reading = (fields: RecordedEvidence): RecordedEvidence => ({
    schema: DIAGNOSIS_READING_SCHEMA,
    offered: [],
    diagnoses: [],
    abstentions: [],
    refused: 0,
    error: null,
    readerText: null,
    ...fields,
  });

  it("joins the exact offered diagnosis into advice without claiming a later repair", () => {
    const root = campaign();
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v5" }, 1);
    record(
      root,
      "run-a",
      "diagnoses",
      reading({
        offered: ["issue-a", "issue-b", "issue-c"],
        diagnoses: [{ issueIds: ["issue-a"], cited, diagnosis }],
        abstentions: [{ issueIds: ["issue-b"], reason: "No observed boundary." }],
      }),
      2,
    );
    record(
      root,
      "run-a",
      "rebuild-advice",
      { schema: REBUILD_ADVICE_SCHEMA, issues: [{ id: "issue-a", diagnosis }] },
      3,
    );
    const out: Yield = diagnosisReader(root);
    expect(out.summary).toEqual({ iterations: 1, opportunities: 1, outputs: 1, consumed: 1, changed: null });
    expect(out.verdict).toBe("advisory-only");
    expect(out.runs[0]).toMatchObject({ diagnosed: 1, abstained: 1, unresolved: 1 });
    expect(out.reasons).toEqual([
      "current issue readings 1/3 offered; advice retention is not repair benefit",
    ]);
    // A reworded diagnosis under the same issue is another reading, so this one was not consumed.
    record(
      root,
      "run-a",
      "rebuild-advice",
      {
        schema: REBUILD_ADVICE_SCHEMA,
        issues: [{ id: "issue-a", diagnosis: { ...diagnosis, cause: "another cause" } }],
      },
      4,
    );
    expect(diagnosisReader(root).summary.consumed).toBe(0);
    // Advice of another schema is not read, so consumption is unknown rather than zero.
    record(
      root,
      "run-a",
      "rebuild-advice",
      { schema: "rebuild-advice/v1", issues: [{ id: "issue-a", diagnosis }] },
      5,
    );
    expect(diagnosisReader(root).summary.consumed).toBeNull();
  });

  it("refuses a reading of another schema by name and keeps a missing reading unknown", () => {
    const root = campaign();
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v5" }, 1);
    const missing: Yield = diagnosisReader(root);
    expect(missing.summary.opportunities).toBeNull();
    expect(missing.verdict).toBe("unobservable");
    record(root, "run-a", "diagnoses", { ...reading({}), schema: "diagnosis-reading/v1" }, 2);
    expect(() => diagnosisReader(root)).toThrow(
      `run-a: diagnosis evidence is not ${DIAGNOSIS_READING_SCHEMA}`,
    );
    const report = buildReviewYield(root);
    expect(report.complete).toBe(false);
    expect(report.components.find((row) => row.component === "diagnosis-reader")).toMatchObject({
      status: "failed",
      verdict: "invalid",
    });
    expect(renderReviewYield(report)).toContain(
      "| diagnosis-reader | lane 25 | ? | ? | ? | ? | ? | failed |",
    );
  });
});

describe("review-yield: composer", () => {
  it("reports every component as no-opportunity on an empty campaign and renders the table", () => {
    const root = campaign();
    const report: {
      complete: boolean;
      components: Array<{ component: string; verdict: string; status: string }>;
    } = buildReviewYield(root);
    expect(report.complete).toBe(true);
    expect(report.components.map((row) => [row.component, row.verdict, row.status])).toEqual([
      ["epoch-reviewer", "no-opportunity", "ok"],
      ["diagnosis-reader", "no-opportunity", "ok"],
      ["harness-trial", "no-opportunity", "ok"],
    ]);
    const table: string = renderReviewYield(report);
    expect(table).toContain(
      "| component | read first by | iterations | opportunities | outputs | consumed | changed | verdict |",
    );
    expect(table).toContain("| epoch-reviewer | lanes 12 and 14 | 0 | 0 | 0 | 0 | 0 | no-opportunity |");
  });
});
