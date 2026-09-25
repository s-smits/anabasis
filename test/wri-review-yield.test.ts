import { afterEach, describe, expect, it } from "bun:test";
import {
  buildReviewYield,
  epochReviewer,
  renderReviewYield,
  repairEngineer,
} from "../.claude/skills/whole-run-investigation/scripts/review-yield.mjs";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { REBUILD_ADVICE_SCHEMA } from "../src/author/rebuild-advice.ts";
import { DIAGNOSIS_READING_SCHEMA } from "../src/review/diagnosis-reader.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import { EPOCH_REVIEW_SCHEMA } from "../src/review/epoch-review-findings.ts";

const dirs: string[] = [];
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
    readerText?: string | null;
  }>;
  reasons: string[];
};

/** JSON values used to construct analysis fixtures. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [field: string]: JsonValue };
type RecordedEvidence = { [field: string]: JsonValue };

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** An empty campaign with analysis and promotion directories; each test adds its records. */
function campaign(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-review-yield-"));
  dirs.push(root);
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

/** A complete current diagnosis reading, with the fields a test varies. */
function reading(fields: RecordedEvidence): RecordedEvidence {
  return {
    schema: DIAGNOSIS_READING_SCHEMA,
    offered: [],
    diagnoses: [],
    abstentions: [],
    refused: 0,
    error: null,
    readerText: null,
    ...fields,
  };
}

function iterations(root: string): void {
  record(root, "run-a", "analysis", { schema: "iteration-analysis/v5" }, 1);
  record(root, "run-b", "analysis", { schema: "iteration-analysis/v5" }, 2);
}

describe("review-yield: current advice readers", () => {
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

  it("reads a null proposal's actual admission route and refuses an unrelated feedback join", () => {
    const root = campaign();
    iterations(root);
    const finding = {
      kind: "hardness" as const,
      proposedOwner: null,
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
      owner: "tests",
      findings: [{ code: "hardness", path: finding.evidence, detail: "public projection" }],
    };
    record(root, "run-a", "admission", { admitted: projected.findings, feedback: [feedback] }, 4);
    expect(epochReviewer(root).runs[0]?.consumer).toMatchObject({
      value: { admitted: 1, routedOwners: ["tests"] },
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

  it("joins the exact offered diagnosis into advice without claiming a later repair", () => {
    const root = campaign();
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v5" }, 1);
    record(
      root,
      "run-a",
      "diagnoses",
      reading({ offered: ["issue-a"], diagnoses: [{ issueIds: ["issue-a"], cited, diagnosis }] }),
      2,
    );
    record(
      root,
      "run-a",
      "rebuild-advice",
      { schema: REBUILD_ADVICE_SCHEMA, issues: [{ id: "issue-a", diagnosis }] },
      3,
    );
    const out: Yield = repairEngineer(root);
    expect(out.summary).toEqual({ iterations: 1, opportunities: 1, outputs: 1, consumed: 1, changed: null });
    expect(out.verdict).toBe("advisory-only");
    expect(out.reasons).toContain(
      "current issue readings 1/1 offered; advice retention is not repair benefit",
    );
    // An earlier advice schema is not read, so the same issue under it proves no consumption.
    record(
      root,
      "run-a",
      "rebuild-advice",
      { schema: "rebuild-advice/v1", issues: [{ id: "issue-a", diagnosis }] },
      4,
    );
    expect(repairEngineer(root).summary.consumed).toBeNull();
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
    expect(repairEngineer(root).summary.consumed).toBe(0);
    // Even identical bytes under an issue the reader was never offered are not consumed evidence.
    record(
      root,
      "run-a",
      "diagnoses",
      reading({ offered: ["other"], diagnoses: [{ issueIds: ["issue-a"], cited, diagnosis }] }),
      5,
    );
    record(
      root,
      "run-a",
      "rebuild-advice",
      { schema: REBUILD_ADVICE_SCHEMA, issues: [{ id: "issue-a", diagnosis }] },
      6,
    );
    expect(repairEngineer(root).summary.consumed).toBe(0);
  });

  it("keeps missing current evidence unknown instead of calling it no opportunity", () => {
    const root = campaign();
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v5" }, 1);
    const missing: Yield = repairEngineer(root);
    expect(missing.summary.opportunities).toBeNull();
    expect(missing.summary.consumed).toBeNull();
    expect(missing.verdict).toBe("unobservable");
    record(root, "run-a", "diagnoses", reading({}), 2);
    expect(repairEngineer(root).verdict).toBe("no-opportunity");
    expect(repairEngineer(root).runs[0]?.readerText).toBeNull();
    const empty = reading({ offered: ["issue-a"], readerText: "" });
    record(root, "run-a", "diagnoses", empty, 3);
    expect(repairEngineer(root).runs[0]?.readerText).toBe("");
    record(root, "run-a", "diagnoses", { ...empty, readerText: "Insufficient public evidence." }, 4);
    const abstained: Yield = repairEngineer(root);
    expect(abstained.runs[0]?.readerText).toBe("Insufficient public evidence.");
    expect(abstained.summary.outputs).toBe(0);
    expect(abstained.summary.consumed).toBe(0);
    record(
      root,
      "run-a",
      "diagnoses",
      { ...empty, readerText: "Partial reading", error: "stream closed" },
      5,
    );
    expect(repairEngineer(root).runs[0]?.readerText).toBeNull();
  });

  it("separates explicit abstention from an unresolved issue and refuses a reading without abstentions", () => {
    const root = campaign();
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v5" }, 1);
    const evidence = reading({
      offered: ["issue-a", "issue-b", "issue-c"],
      diagnoses: [{ issueIds: ["issue-a"], cited, diagnosis }],
    });
    const { abstentions: _dropped, ...older } = evidence;
    record(root, "run-a", "diagnoses", older, 2);
    expect(buildReviewYield(root).components[0]).toMatchObject({ status: "failed", verdict: "invalid" });
    expect(renderReviewYield(buildReviewYield(root))).toContain("| failed |");
    record(
      root,
      "run-a",
      "diagnoses",
      { ...evidence, abstentions: [{ issueIds: ["issue-b"], reason: "No observed boundary." }] },
      3,
    );
    expect(repairEngineer(root).runs[0]).toMatchObject({ diagnosed: 1, abstained: 1, unresolved: 1 });
    record(
      root,
      "run-a",
      "diagnoses",
      {
        ...evidence,
        abstentions: [
          null,
          { issueIds: ["issue-b"], reason: "No observed boundary." },
          { issueIds: ["issue-b"], reason: "Duplicate." },
          { issueIds: ["issue-a"], reason: "Also diagnosed." },
          { issueIds: ["unoffered"], reason: "Not offered." },
        ],
      },
      4,
    );
    expect(repairEngineer(root).runs[0]).toMatchObject({ abstained: 1, unresolved: 1 });
  });

  it("uses the real public epoch projection and keeps different measured conditions separate", () => {
    const root = campaign();
    iterations(root);
    const findings = [
      {
        kind: "harness-defect" as const,
        claim: "private assessment",
        evidence: "private",
        proposedOwner: "instructions" as const,
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
        kind: "harness-defect" as const,
        claim: "private assessment",
        evidence: "analysis/run-a-epoch-review.json",
        proposedOwner: "instructions" as const,
      },
      {
        kind: "harness-defect" as const,
        claim: "a second private assessment",
        evidence: "analysis/run-a-epoch-review.json",
        proposedOwner: "instructions" as const,
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
    // The recorded admission was written by another revision of publicEpochReview: same kind, owner
    // and evidence file, a claim sentence this tree cannot reproduce. Both rows are admitted.
    const projection = publicEpochReview({ status: "completed", findings, disputes: [] });
    const olderWording = projection.findings.map((finding, index) => ({
      ...finding,
      claim: `The epoch review reported ${finding.kind} in ${finding.proposedOwner}: check \`some-check-${index}\`; repair the enforcement in that owner's files.`,
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

describe("review-yield: composer", () => {
  it("reports every component as no-opportunity on an empty campaign and renders the table", () => {
    const root = campaign();
    const report: {
      complete: boolean;
      components: Array<{ component: string; verdict: string; status: string }>;
    } = buildReviewYield(root);
    expect(report.complete).toBe(true);
    expect(report.components.map((row) => [row.component, row.verdict, row.status])).toEqual([
      ["repair-engineer", "no-opportunity", "ok"],
      ["epoch-reviewer", "no-opportunity", "ok"],
    ]);
    const table: string = renderReviewYield(report);
    expect(table).toContain(
      "| component | read first by | iterations | opportunities | outputs | consumed | changed | verdict |",
    );
    expect(table).toContain("| epoch-reviewer | angle 26 | 0 | 0 | 0 | 0 | 0 | no-opportunity |");
  });
});
