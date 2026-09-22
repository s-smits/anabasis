import { afterEach, describe, expect, it } from "bun:test";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { buildReviewYield, renderReviewYield } from "../.claude/skills/whole-run-investigation/scripts/review-yield/index.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { collect as repairEngineer } from "../.claude/skills/whole-run-investigation/scripts/review-yield/repair-engineer.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { collect as progressGuard } from "../.claude/skills/whole-run-investigation/scripts/review-yield/progress-guard.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { collect as judgePromptMaintainer } from "../.claude/skills/whole-run-investigation/scripts/review-yield/judge-prompt-maintainer.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { collect as epochReviewer } from "../.claude/skills/whole-run-investigation/scripts/review-yield/epoch-reviewer.mjs";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { REBUILD_ADVICE_SCHEMA } from "../src/author/rebuild-advice.ts";
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

/** JSON values used to construct current and historical analysis fixtures. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [field: string]: JsonValue };
type RecordedEvidence = { [field: string]: JsonValue };

const ownedFinding = {
  kind: "harness-defect",
  claim: "tool schema omits the pin field",
  evidence: "e",
  proposedOwner: "instructions",
};
const advisoryFinding = { kind: "hardness", claim: "family x is hard", evidence: "e", proposedOwner: null };

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

function iterations(root: string): void {
  record(root, "run-a", "analysis", { schema: "iteration-analysis/v3" }, 1);
  record(root, "run-b", "analysis", { schema: "iteration-analysis/v3" }, 2);
}

describe("review-yield: historical repair engineer", () => {
  it("is decision-bearing when an admitted owned finding names the owner the next iteration repaired", () => {
    const root = campaign();
    iterations(root);
    record(
      root,
      "run-a",
      "judges",
      { coverage: { diagnosable: 3, diagnosed: 3 }, findings: [ownedFinding, advisoryFinding], held: [] },
      3,
    );
    record(
      root,
      "run-a",
      "admission",
      { admitted: [ownedFinding, advisoryFinding], refused: [], feedback: [{ owner: "instructions" }] },
      4,
    );
    record(root, "run-b", "contest", { repair: { selectedOwner: "instructions", experiment: "repair" } }, 5);
    const out: Yield = repairEngineer(root);
    expect(out.summary).toEqual({ iterations: 2, opportunities: 1, outputs: 1, consumed: 1, changed: 1 });
    expect(out.verdict).toBe("decision-bearing");
    expect(out.runs[0]?.note).toBe("next iteration repaired instructions");
  });

  it("is not consumed when admission names another producer, and no-opportunity without failed traces", () => {
    const root = campaign();
    iterations(root);
    record(
      root,
      "run-a",
      "judges",
      { coverage: { diagnosable: 2, diagnosed: 2 }, findings: [ownedFinding], held: [] },
      3,
    );
    // Admission routed the same owner from another producer: a different claim text, same owner.
    record(
      root,
      "run-a",
      "admission",
      {
        admitted: [{ ...ownedFinding, claim: "host validator finding" }],
        refused: [],
        feedback: [{ owner: "instructions" }],
      },
      4,
    );
    record(root, "run-b", "contest", { repair: { selectedOwner: "instructions", experiment: "repair" } }, 5);
    const inert: Yield = repairEngineer(root);
    expect(inert.verdict).toBe("not-consumed");
    expect(inert.runs[0]?.consumer).toBeNull();
    const quiet = campaign();
    iterations(quiet);
    record(
      quiet,
      "run-a",
      "judges",
      { coverage: { diagnosable: 0, diagnosed: 0 }, findings: [], held: [] },
      3,
    );
    const none: Yield = repairEngineer(quiet);
    expect(none.verdict).toBe("no-opportunity");
  });
});

describe("review-yield: historical progress guard chain", () => {
  const guard = {
    schema: "ana-progress-guard/v1",
    verdict: "hold",
    checks: [{ id: "review-coverage", state: "fail" }],
    findings: [],
  };

  it("is decision-bearing only when the guard clause alone held the candidate", () => {
    const root = campaign();
    iterations(root);
    record(root, "run-a", "progress-guard", guard, 3);
    writeFileSync(
      join(root, "promotions", "run-a.json"),
      JSON.stringify({
        decision: "held",
        experiment: "repair",
        clauses: ["progress-guard-hold: replacement waits for review-coverage"],
        comparison: null,
        progressGuard: guard,
        repairDisposition: "integrity-held",
      }),
    );
    const out: Yield = progressGuard(root);
    expect(out.summary.changed).toBe(1);
    expect(out.verdict).toBe("decision-bearing");
    expect(out.reasons.some((line) => line.startsWith("held on the guard alone: run-a"))).toBe(true);
  });

  it("does not credit the guard for a climb adoption or a hold that had other clauses", () => {
    const root = campaign();
    iterations(root);
    record(root, "run-a", "progress-guard", { ...guard, verdict: "continue", checks: [] }, 3);
    record(root, "run-b", "progress-guard", guard, 4);
    writeFileSync(
      join(root, "promotions", "run-a.json"),
      JSON.stringify({
        decision: "promoted",
        experiment: "climb",
        clauses: [],
        comparison: null,
        progressGuard: { ...guard, verdict: "continue" },
      }),
    );
    writeFileSync(
      join(root, "promotions", "run-b.json"),
      JSON.stringify({
        decision: "held",
        experiment: "build",
        clauses: [
          "candidate-unmeasured: claim stage reads build-admissible",
          "progress-guard-hold: review-coverage",
        ],
        comparison: null,
        progressGuard: guard,
      }),
    );
    const out: Yield = progressGuard(root);
    expect(out.summary).toEqual({ iterations: 2, opportunities: 2, outputs: 2, consumed: 2, changed: 0 });
    expect(out.verdict).toBe("advisory-only");
    expect(out.runs[0]?.note).toBe("climb candidate installed (no paired comparison)");
    expect(out.reasons).toContain("paired comparisons 0; repair promotions 0");
  });
});

describe("review-yield: historical judge prompt maintainer", () => {
  const candidate = {
    status: "candidate",
    target: "census",
    activation: "controller-required",
    evidenceDigest: "e".repeat(64),
    candidate: { base: { digest: "b".repeat(64) }, replacement: { digest: "r".repeat(64) } },
  };

  it("is decision-bearing when a later census carries the candidate's replacement digest", () => {
    const root = campaign();
    iterations(root);
    record(root, "run-a", "judge-prompt-maintenance", candidate, 3);
    record(root, "run-a", "judges", { promptPolicyDigests: { census: "b".repeat(64) } }, 4);
    record(root, "run-b", "judges", { promptPolicyDigests: { census: "r".repeat(64) } }, 5);
    const out: Yield = judgePromptMaintainer(root);
    expect(out.summary).toEqual({ iterations: 2, opportunities: 1, outputs: 1, consumed: 1, changed: 1 });
    expect(out.verdict).toBe("decision-bearing");
  });

  it("is not consumed when every later census keeps the prompt digest the candidate was drafted against", () => {
    const root = campaign();
    iterations(root);
    record(root, "run-a", "judge-prompt-maintenance", candidate, 3);
    record(root, "run-a", "judges", { promptPolicyDigests: { census: "b".repeat(64) } }, 4);
    record(
      root,
      "run-b",
      "judge-prompt-maintenance",
      { status: "not-required", activation: "controller-required" },
      5,
    );
    record(root, "run-b", "judges", { promptPolicyDigests: { census: "b".repeat(64) } }, 6);
    const out: Yield = judgePromptMaintainer(root);
    expect(out.verdict).toBe("not-consumed");
    expect(out.runs[0]?.note).toBe("candidate drafted; 1 later census run(s) kept the same prompt digest");
    expect(out.reasons).toContain("candidates 1; adopted by a later census 0");
  });
});

describe("review-yield: epoch reviewer", () => {
  const owned = {
    kind: "harness-defect",
    claim: "controls never reach the timed path",
    evidence: "e",
    proposedOwner: "controls",
    severity: "advisory",
  };
  const review = (findings: JsonValue[]) => ({
    status: "completed",
    condition: { taskSetHash: "t".repeat(64) },
    findings,
    coverage: { allListedFilesRead: true },
    toolCalls: { read: 4, refused: 0 },
  });

  it("is decision-bearing when an admitted epoch finding's owner was repaired next, and marks shared routing", () => {
    const root = campaign();
    iterations(root);
    record(root, "run-a", "epoch-review", review([owned]), 3);
    record(
      root,
      "run-a",
      "admission",
      {
        admitted: [owned, { ...owned, claim: "host validator finding" }],
        refused: [],
        feedback: [{ owner: "controls" }],
      },
      4,
    );
    record(root, "run-b", "contest", { repair: { selectedOwner: "controls", experiment: "evaluation" } }, 5);
    const out: Yield = epochReviewer(root);
    expect(out.summary.changed).toBe(1);
    expect(out.verdict).toBe("decision-bearing");
    expect(out.runs[0]?.note).toBe(
      "next iteration repaired controls from an epoch finding (owner also routed by another producer)",
    );
  });

  it("is advisory-only when the findings carry no owner, and counts repeated task-set reviews", () => {
    const root = campaign();
    iterations(root);
    record(root, "run-a", "epoch-review", review([advisoryFinding]), 3);
    record(root, "run-a", "admission", { admitted: [advisoryFinding], refused: [], feedback: [] }, 4);
    record(root, "run-b", "epoch-review", review([advisoryFinding]), 5);
    record(root, "run-b", "admission", { admitted: [advisoryFinding], refused: [], feedback: [] }, 6);
    const out: Yield = epochReviewer(root);
    expect(out.summary).toEqual({ iterations: 2, opportunities: 2, outputs: 2, consumed: 2, changed: 0 });
    expect(out.verdict).toBe("advisory-only");
    expect(out.reasons).toContain(
      "measured-iteration findings 2, of which without a proposed owner 2; actual routes belong to admission feedback, and authoring reviews to digest block 4d",
    );
    expect(out.reasons).toContain("review conditions repeated: 1 (legacy rows use task-set identity)");
  });
});

describe("review-yield: current advice readers", () => {
  const diagnosis = {
    runId: "run-a",
    cause: "public interface mismatch",
    falsifier: "the interface agrees",
    firstDivergence: "failed tool call",
    interventionClass: "instructions",
    contrastSuccess: null,
    confidence: "medium",
  };

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
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v4" }, 1);
    record(
      root,
      "run-a",
      "diagnoses",
      {
        schema: "diagnosis-reading/v1",
        offered: ["issue-a"],
        diagnoses: [{ issueId: "issue-a", ...diagnosis }],
        refused: 0,
      },
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
      {
        schema: "diagnosis-reading/v1",
        offered: ["other"],
        diagnoses: [{ issueId: "issue-a", ...diagnosis }],
      },
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
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v4" }, 1);
    const missing: Yield = repairEngineer(root);
    expect(missing.summary.opportunities).toBeNull();
    expect(missing.summary.consumed).toBeNull();
    expect(missing.verdict).toBe("unobservable");
    record(
      root,
      "run-a",
      "diagnoses",
      { schema: "diagnosis-reading/v1", offered: [], diagnoses: [], refused: 0 },
      2,
    );
    expect(repairEngineer(root).verdict).toBe("no-opportunity");
    expect(repairEngineer(root).runs[0]?.readerText).toBeNull();
    const empty = {
      schema: "diagnosis-reading/v1",
      offered: ["issue-a"],
      diagnoses: [],
      refused: 0,
      error: null,
      readerText: "",
    };
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

  it("separates explicit abstention from an unresolved issue and legacy silence", () => {
    const root = campaign();
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v4" }, 1);
    const evidence = {
      schema: "diagnosis-reading/v1",
      offered: ["issue-a", "issue-b", "issue-c"],
      diagnoses: [{ issueId: "issue-a", ...diagnosis }],
      error: null,
    };
    record(root, "run-a", "diagnoses", evidence, 2);
    expect(repairEngineer(root).runs[0]).toMatchObject({ abstained: null, unresolved: null });
    record(
      root,
      "run-a",
      "diagnoses",
      { ...evidence, abstentions: [{ issueId: "issue-b", reason: "No observed boundary." }] },
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
          { issueId: "issue-b", reason: "No observed boundary." },
          { issueId: "issue-b", reason: "Duplicate." },
          { issueId: "issue-a", reason: "Also diagnosed." },
          { issueId: "unoffered", reason: "Not offered." },
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

  it("does not count ordinary promotions as opportunities for the retired guard", () => {
    const root = campaign();
    iterations(root);
    writeFileSync(
      join(root, "promotions", "run-a.json"),
      JSON.stringify({ decision: "promoted", experiment: "climb", clauses: [] }),
    );
    expect(progressGuard(root).verdict).toBe("no-opportunity");
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
      ["progress-guard", "no-opportunity", "ok"],
      ["judge-prompt-maintainer", "no-opportunity", "ok"],
      ["epoch-reviewer", "no-opportunity", "ok"],
    ]);
    const table: string = renderReviewYield(report);
    expect(table).toContain(
      "| component | read first by | iterations | opportunities | outputs | consumed | changed | verdict |",
    );
    expect(table).toContain("| epoch-reviewer | angle 26 | 0 | 0 | 0 | 0 | 0 | no-opportunity |");
  });
});

describe("review-yield: components the current loop no longer contains", () => {
  function currentLoop(root: string): void {
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v4" }, 1);
    record(root, "run-b", "analysis", { schema: "iteration-analysis/v4" }, 2);
  }

  it("states absence rather than a zero that reads like a live but unproductive component", () => {
    const root = campaign();
    currentLoop(root);
    const guard: Yield = progressGuard(root);
    expect(guard.verdict).toBe("component-absent");
    expect(guard.reasons).toEqual([
      "the progress guard chain is not part of the loop that recorded 2 of 2 iteration(s)",
    ]);
    expect(guard.summary.iterations).toBe(2);
    expect(guard.summary.opportunities).toBe(0);
    const maintainer: Yield = judgePromptMaintainer(root);
    expect(maintainer.verdict).toBe("component-absent");
    expect(maintainer.reasons).toEqual([
      "the judge prompt maintainer is not part of the loop that recorded 2 of 2 iteration(s)",
    ]);
    const report: {
      complete: boolean;
      components: Array<{ component: string; verdict: string; status: string }>;
    } = buildReviewYield(root);
    expect(report.complete).toBe(true);
    expect(
      report.components.filter((row) => row.verdict === "component-absent").map((row) => row.component),
    ).toEqual(["progress-guard", "judge-prompt-maintainer"]);
    expect(renderReviewYield(report)).toContain(
      "| progress-guard | row B | 2 | 0 | 0 | 0 | 0 | component-absent |",
    );
  });

  it("does not call a component absent when only its evidence is missing", () => {
    const root = campaign();
    iterations(root);
    const guard: Yield = progressGuard(root);
    const maintainer: Yield = judgePromptMaintainer(root);
    expect(guard.verdict).toBe("no-opportunity");
    expect(maintainer.verdict).toBe("no-opportunity");
  });

  it("keeps a campaign that ran the component under an earlier loop out of the absent verdict", () => {
    const root = campaign();
    record(root, "run-a", "analysis", { schema: "iteration-analysis/v3" }, 1);
    record(root, "run-b", "analysis", { schema: "iteration-analysis/v4" }, 2);
    record(
      root,
      "run-a",
      "progress-guard",
      { schema: "ana-progress-guard/v1", verdict: "hold", checks: [], findings: [] },
      3,
    );
    const out: Yield = progressGuard(root);
    expect(out.verdict).toBe("not-consumed");
    expect(out.summary.opportunities).toBe(1);
    expect(out.runs[1]?.note).toBe(
      "the progress guard chain is not part of the loop that recorded this iteration",
    );
  });
});
