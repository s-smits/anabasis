/**
 * A finding is worth admitting only when something owns it, so ownership is the subject here.
 * A harness defect routes to the named Builder-owned part, a task difficulty finding routes to
 * tests, and a blocking Judge exit routes to the evaluator, while every other finding kind stays
 * recorded without reaching authoring at all. Alongside the routing, this file checks the host
 * findings and whether the evidence a finding cites actually exists before the feedback is
 * admitted. The integration cases in test/harness-measure.test.ts derive the same analysis from
 * recorded measurement evidence instead.
 */
import { hashJsonBytes } from "../src/meta/json-runtime.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import {
  type AnalysisFinding,
  type IterationAnalysis,
  FEEDBACK_POLICY,
  admitFindings,
  checkCounts,
  hostFindings,
} from "../src/analyse/iteration-analysis.ts";
import { authorSessionOwner } from "../src/analyse/finding-owner.ts";
import type { NonResultKind } from "../src/claim/record-events.ts";
import { BUILDER_OWNED } from "../src/author/feedback-routing.ts";
import { double, required } from "./helpers/doubles.ts";
import { recordFindingTool, type ReviewState } from "../src/review/epoch-review-findings.ts";
import { publicEpochReview } from "../src/review/epoch-review-public.ts";
import { emptyProbeState } from "../src/review/review-probe.ts";
import { fileMapBrief } from "./helpers/starter-contracts.ts";

const scratch: string[] = [];
const SLUG = "bridge-truss";
const RUN = "base";
const RECORD = `campaigns/${SLUG}/case-record.jsonl`;
const JUDGES = `campaigns/${SLUG}/analysis/${RUN}-judges.json`;

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An absent measured tree for cases that derive host findings from the packet alone.
 *  Tests for a recorded unbound external result provide a separate battery file below. */
const NO_MEASURED_TREE = join(tmpdir(), "ana-absent-tree");

function summary(overrides: Partial<IterationAnalysis["battery"]["summary"]>) {
  return {
    runId: RUN,
    total: 2,
    verified: 2,
    unaccepted: 0,
    nonResults: 0,
    passed: 1,
    passRate: 0.5,
    discrimination: "informative" as const,
    ...overrides,
  };
}

function packet(overrides?: {
  summary?: Partial<IterationAnalysis["battery"]["summary"]>;
  cases?: IterationAnalysis["cases"];
}): IterationAnalysis {
  return {
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
        taskSetHash: "c".repeat(64),
      },
      backendPin: "codex:test",
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
      summary: summary(overrides?.summary ?? {}),
    },
    cases: overrides?.cases ?? [],
    absent: [],
  };
}

/** One case row; `acceptedSubmit: false` with `pass: false` is an admission refusal. */
function caseRow(
  taskId: string,
  overrides?: Partial<IterationAnalysis["cases"][number]>,
): IterationAnalysis["cases"][number] {
  return {
    taskId,
    family: "fam",
    acceptedSubmit: true,
    truthOk: false,
    pass: false,
    runtimeNonResult: null,
    runtimeNonResultKind: null,
    traces: [],
    ...overrides,
  };
}

/** `count` typed non-results of one kind, which is what the environment finding counts. */
function stopped(count: number, kind: NonResultKind): IterationAnalysis["cases"] {
  return Array.from({ length: count }, (_, i) =>
    caseRow(`n${i}`, {
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResult: kind,
      runtimeNonResultKind: kind,
    }),
  );
}

function finding(overrides: Partial<AnalysisFinding>): AnalysisFinding {
  return { kind: "harness-defect", claim: "a finding", evidence: RECORD, proposedOwner: null, ...overrides };
}

/** A repo carrying the two evidence files findings may cite. */
function repo(withJudges = true): string {
  const root = mkdtempSync(join(tmpdir(), "ana-evidence-"));
  scratch.push(root);
  mkdirSync(join(root, "campaigns", SLUG, "analysis"), { recursive: true });
  writeFileSync(join(root, RECORD), "");
  if (withJudges) writeFileSync(join(root, JUDGES), "{}");
  return root;
}

/** A declared external checker can miss its own wall on some cases while the rest score. Reading
 *  those as an environment failure with no owner leaves the repairable check reaching no author
 *  session, so the round can only rerun unchanged. Since the host resolves every tool itself, an
 *  unbound row has no environment reading left: it says the check returned a verdict no completed
 *  tool run supports. */
describe("a checker outage recorded in the measured battery", () => {
  function batteryTree(rows: Array<{ code: string; message: string }>): string {
    const root = mkdtempSync(join(tmpdir(), "ana-unbound-"));
    scratch.push(root);
    const runDir = join(root, `domains/${SLUG}/runs/${RUN}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "battery.json"), JSON.stringify({ discrimination: { findings: rows } }));
    return root;
  }
  const unboundRow = { code: "EXTERNAL_RESULT_UNBOUND", message: "recorded detail stays here" };

  it("routes an unbound external result to the correctness-model owner", () => {
    const root = batteryTree([unboundRow]);
    const found = hostFindings(root, packet({ summary: { nonResults: 3 }, cases: stopped(3, "timeout") }));
    expect(found.map((f) => f.kind)).toEqual(["environment-non-result", "harness-defect"]);
    const outage = found.find((f) => f.kind === "harness-defect");
    expect(outage?.proposedOwner).toBe("correctness-model");
    expect(outage === undefined ? null : authorSessionOwner(outage).owner).toBe("correctness-model");
    // Public identities only: the routed claim quotes neither the recorded message nor task ids.
    expect(outage?.claim).not.toContain("recorded detail");
    expect(outage?.evidence).toBe(`domains/${SLUG}/runs/${RUN}/battery.json`);
  });

  it("leaves a battery with no unbound row as the plain environment finding", () => {
    const root = batteryTree([{ code: "EVALUATE_THREW", message: "unrelated" }]);
    const found = hostFindings(root, packet({ summary: { nonResults: 3 }, cases: stopped(3, "timeout") }));
    expect(found.map((f) => f.kind)).toEqual(["environment-non-result"]);
    expect(found[0]?.proposedOwner).toBeNull();
  });
});

describe("the routing decision", () => {
  it("keeps every non-authoring kind a disclosure, never an author session", () => {
    for (const kind of [
      "environment-non-result",
      "controller-defect",
      "diagnosis-uncertain",
      "judge-disagreement",
    ] as const) {
      expect(authorSessionOwner(finding({ kind }))).toMatchObject({ owner: null });
    }
  });

  it("derives the tests owner for both kinds that say the tasks are the subject", () => {
    // The producers do not stamp this. Left to them, two producers record different owners for
    // the same statement and one of the two reaches nobody — a sole diagnosis recorded as a
    // `hardness` row with a null owner routes no feedback at all.
    for (const kind of ["hardness", "curriculum-defect"] as const) {
      expect(authorSessionOwner(finding({ kind, proposedOwner: null }))).toEqual({ owner: "tests" });
    }
  });

  it("routes a Judge disagreement nowhere, whatever its producer proposed", () => {
    // The Judge advises; the verifier decides. A disagreement names no owner even when its
    // producer proposed the evaluator.
    expect(
      authorSessionOwner(finding({ kind: "judge-disagreement", proposedOwner: "correctness-model" })),
    ).toEqual({
      owner: null,
      reason: "judge-advisory-only",
    });
  });

  it("routes harness-defect findings only to Builder-owned parts", () => {
    const owners = [...BUILDER_OWNED];
    for (const owner of owners) {
      expect(authorSessionOwner(finding({ kind: "harness-defect", proposedOwner: owner }))).toEqual({
        owner,
      });
    }
    // `environment` is not a Builder-owned surface; a defect proposal naming it -- or naming
    // nothing -- is non-actionable here, whatever produced it.
    for (const owner of ["environment", null] as const) {
      expect(authorSessionOwner(finding({ kind: "harness-defect", proposedOwner: owner }))).toEqual({
        owner: null,
        reason: "not-builder-owned-surface",
      });
    }
  });

  it("names the severity-and-route rule its packets are readable under", () => {
    // A packet recorded under an older rule states nothing to a reader on this one: the routes and
    // severities the two would assign differ, and re-labelling old bytes is the misroute this
    // identity exists to end.
    expect(FEEDBACK_POLICY).toBe("severity-route/9-complete-repair-agenda");
  });
});

describe("host findings — evidence restatements only", () => {
  it("reports non-results as an environment finding without choosing an authoring owner", () => {
    const analysis = packet({ summary: { nonResults: 1 }, cases: stopped(1, "provider") });
    const found = hostFindings(NO_MEASURED_TREE, analysis);
    expect(found.map((f) => f.kind)).toEqual(["environment-non-result"]);
    expect(found[0]?.proposedOwner).toBeNull();
    expect(found[0]?.evidence).toBe(RECORD);
  });

  // External checks that ran no tool: the packet must not simply tell the Builder to rerun.
  it("leaves a non-result whose kind names no environment to its diagnosis, not a rerun", () => {
    const analysis = packet({ summary: { nonResults: 6 }, cases: stopped(6, "verifier") });
    expect(hostFindings(NO_MEASURED_TREE, analysis)).toEqual([]);
  });

  it("adds no finding for an all-pass battery — the measurement note owns finding no limit", () => {
    // No advisory harness-defect row owned by "tests" is added for it. The measurement note already
    // states the same battery with its distance from the aim, its streak and the scope the next one
    // needs, so such a row only repeats it under a defect kind the harness has not earned.
    const analysis = packet({ summary: { passed: 2, passRate: 1, discrimination: "all-pass" } });
    expect(hostFindings(NO_MEASURED_TREE, analysis)).toEqual([]);
  });

  it("adds no defect finding for an all-fail battery without a diagnosis", () => {
    const analysis = packet({
      summary: { passed: 0, passRate: 0, discrimination: "all-fail" },
      // Verified fails (accepted, truth said no): deterministically indistinguishable from genuine
      // hardness, so the host stays silent and the rebuild advice packet carries the counts.
      cases: [caseRow("t1"), caseRow("t2")],
    });
    expect(hostFindings(NO_MEASURED_TREE, analysis)).toEqual([]);
  });

  it("states the unaccepted count without assigning a submission-admission cause", () => {
    const analysis = packet({
      cases: [
        caseRow("t1", { acceptedSubmit: false }),
        caseRow("t2", { acceptedSubmit: false }),
        caseRow("t3"),
        // A runtime non-result is NOT an admission refusal even with acceptedSubmit false — the
        // outcome owner classifies it as non-result and the environment finding owns it.
        caseRow("t4", {
          acceptedSubmit: false,
          pass: null,
          runtimeNonResult: "provider-timeout",
          runtimeNonResultKind: "provider",
        }),
      ],
      summary: { nonResults: 1 },
    });
    const found = hostFindings(NO_MEASURED_TREE, analysis);
    expect(found.map((f) => f.kind)).toEqual(["diagnosis-uncertain", "environment-non-result"]);
    const census = found[0];
    expect(census?.claim).toContain("2 of 4 attempt(s) produced no accepted submission");
    expect(census?.claim).not.toContain("submission admission");
    expect(census?.severity).toBe("advisory");
    // It names the rule that produced it, which is what lets the packet count the same finding
    // across rounds: a host finding names no check and no artifact path, so without the rule two
    // consecutive packets cannot see that one finding recurred.
    expect(census?.hostRule).toBe("unaccepted-without-verdict");
    // A disclosure, never a routed repair: which owner broke stays the model's question.
    expect(census?.proposedOwner).toBeNull();
    expect(authorSessionOwner(required(census, "the census finding"))).toEqual({
      owner: null,
      reason: "diagnosis-uncertain",
    });
    // Safe totals only — no task identity leaves the recorded evidence through this claim.
    expect(census?.claim).not.toMatch(/t[0-9]/);
  });
});

describe("controller admission", () => {
  it("admits only findings whose cited evidence exists, and discloses refusals", () => {
    const root = repo();
    const cited = finding({ proposedOwner: "tests" });
    const uncited = finding({
      evidence: `campaigns/${SLUG}/does-not-exist.json`,
      proposedOwner: "correctness-model",
    });
    const evidence = admitFindings(root, packet(), [cited, uncited]);
    expect(evidence.admitted).toEqual([cited]);
    expect(evidence.refused).toEqual([{ finding: uncited, reason: expect.stringMatching(/does not exist/) }]);
    expect(evidence.feedback.map((f) => f.owner)).toEqual(["tests"]);
    expect(evidence.findingRoutes).toEqual([
      { findingDigest: expect.any(String), kind: "harness-defect", owner: "tests" },
    ]);
  });

  it("maps finding severity into feedback — an advisory disclosure never blocks a rebuild", () => {
    const root = repo();
    const advisory = finding({ proposedOwner: "tests", severity: "advisory" });
    const evidence = admitFindings(root, packet(), [advisory]);
    expect(evidence.feedback.map((f) => [f.owner, f.severity])).toEqual([["tests", "advisory"]]);
  });

  it("carries a controller-marked findings packet the author prompt can render", () => {
    const root = repo();
    const evidence = admitFindings(root, packet(), [
      finding({ claim: "the battery did not discriminate", proposedOwner: "tests" }),
    ]);
    // The author input reads ONLY f.findings, so an admission without it renders nothing, and an
    // unmarked packet is refused at the author isolation.
    expect(evidence.feedback[0]?.findings).toEqual([
      {
        code: "harness-defect",
        path: RECORD,
        detail: "the battery did not discriminate",
        disclosure: { class: "authored" },
      },
    ]);
  });

  it("routes an unmet product obligation from review to its owner without exporting private demonstrations", async () => {
    const root = repo();
    const evidence = `campaigns/${SLUG}/analysis/${RUN}-epoch-review.json`;
    const state: ReviewState = {
      reads: ["evaluator.ts"],
      readChars: 12,
      refused: 0,
      probes: emptyProbeState(),
      delivered: [
        { path: "evaluator.ts", digest: "", length: 0, pages: [{ start: 0, text: "return true;" }] },
      ],
      findings: [],
      disputes: [],
      admission: { continuations: 0, citationRefusals: 0, severityAdjusted: [] },
    };
    const tool = recordFindingTool([], [], evidence, state, {
      identities: {
        schemaRoots: ["files"],
        checkIds: ["compile"],
      },
    });
    await tool.execute(
      "scope",
      double<never>({
        kind: "harness-defect",
        owner: "brief",
        severity: "blocking",
        artifactSchemaPath: "files",
        checkId: "compile",
        claim:
          "the original request requires product execution but the public contract promises only compilation",
        citations: [{ path: "evaluator.ts", quote: "return true;" }],
        demonstration:
          "PRIVATE_EXAMPLE: the submitted entrypoint has a reachable abort while unrelated support code compiles; compilation cannot observe the requested execution",
      }),
    );
    writeFileSync(join(root, evidence), JSON.stringify(state));
    const brief = fileMapBrief();
    brief.truthChecks[0]!.id = "compile";
    const request = "writes complete executable products";
    const contract = { brief };
    const projected = publicEpochReview({ status: "completed", ...state }, contract);
    expect(
      publicEpochReview(
        {
          status: "completed",
          ...state,
          findings: state.findings.map((row) => ({ ...row, claim: "DIFFERENT_PRIVATE_EXAMPLE" })),
        },
        {
          ...contract,
          brief: {
            ...brief,
            ruleDecisions: [
              ...(brief.ruleDecisions ?? []),
              { id: "private-choice", visibility: "private", statement: "PRIVATE_STRATEGY" },
            ],
          },
        },
      ),
    ).toEqual(projected);
    const admission = admitFindings(
      root,
      packet({ summary: { passed: 2, passRate: 1 } }),
      projected.findings,
    );
    expect(admission.feedback.map((row) => [row.owner, row.severity])).toEqual([["brief", "blocking"]]);
    expect(JSON.stringify(admission.feedback)).toContain("files");
    // The request has one owner: every prompt rendering these rows states it once under its own
    // heading, and a copy per finding would repeat it once per finding in one authoring prompt.
    expect(JSON.stringify(admission.feedback)).not.toContain(request);
    expect(JSON.stringify(admission.feedback)).toContain(brief.truthChecks[0]!.assertion);
    expect(JSON.stringify(admission.feedback)).toContain(brief.ruleDecisions![0]!.statement);
    expect(JSON.stringify(admission.feedback)).toContain("plausible counterexample");
    expect(JSON.stringify(admission.feedback)).not.toContain("PRIVATE_EXAMPLE");
    expect(state.findings[0]?.claim).toContain("PRIVATE_EXAMPLE");
    const advisory: ReviewState = {
      reads: ["evaluator.ts"],
      readChars: 12,
      refused: 0,
      probes: emptyProbeState(),
      delivered: [
        { path: "evaluator.ts", digest: "", length: 0, pages: [{ start: 0, text: "return true;" }] },
      ],
      findings: [],
      disputes: [],
      admission: { continuations: 0, citationRefusals: 0, severityAdjusted: [] },
    };
    await recordFindingTool([], [], evidence, advisory, {
      identities: {
        schemaRoots: ["files"],
        checkIds: ["compile"],
      },
    }).execute(
      "uncertain",
      double<never>({
        kind: "diagnosis-uncertain",
        severity: "advisory",
        checkId: "compile",
        claim: "whether the external package observes this property is unproved",
      }),
    );
    // The same check, observed rather than demonstrated: it asks for no repair, so it carries no
    // obligation to bind one to. Left unbounded, one such assertion repeats verbatim on every
    // round and crowds out everything else the rebuild author reads.
    const observed =
      publicEpochReview({ status: "completed", ...advisory }, contract).findings[0]?.claim ?? "";
    expect(observed).toContain("check `compile`");
    expect(observed).toContain("asks for no repair");
    expect(observed).not.toContain(brief.truthChecks[0]!.assertion);
    expect(observed).not.toContain("plausible counterexample");
    expect(
      admitFindings(root, packet(), publicEpochReview({ status: "completed", ...advisory }).findings)
        .feedback,
    ).toEqual([]);
  });

  it("turns only author-session routes into campaign feedback — other routes have other consumers", () => {
    const root = repo();
    const evidence = admitFindings(root, packet(), [
      finding({ kind: "environment-non-result" }),
      finding({ kind: "controller-defect" }),
      finding({ kind: "hardness" }),
      finding({ kind: "harness-defect", proposedOwner: "controls" }),
    ]);
    expect(evidence.admitted).toHaveLength(4);
    // hardness reaches the task author whether or not its producer recorded an owner; a blocking
    // severity stays reserved for the defect kinds, so it cannot force a rebuild on its own.
    expect(evidence.feedback.map((f) => [f.owner, f.severity])).toEqual([
      ["tests", "advisory"],
      ["controls", "blocking"],
    ]);
    expect(evidence.findingRoutes.map((row) => row.owner ?? row.reason)).toEqual([
      "environment-non-result",
      "not-builder-owned-surface",
      "tests",
      "controls",
    ]);
  });

  it("records a typed no-route reason for an admitted Judge disclosure", () => {
    const root = repo();
    const disclosure = finding({ kind: "judge-disagreement", proposedOwner: null });
    const evidence = admitFindings(root, packet(), [disclosure]);
    expect(evidence.feedback).toEqual([]);
    expect(evidence.findingRoutes).toEqual([
      {
        findingDigest: expect.any(String),
        kind: "judge-disagreement",
        owner: null,
        reason: "judge-advisory-only",
      },
    ]);
  });

  it("refuses a Judge disagreement when its judges evidence is not on disk", () => {
    // Admission is citation reachability: a finding whose evidence a reviewer cannot open is
    // refused, whatever produced it.
    const root = repo(false);
    const evidence = admitFindings(root, packet(), [
      finding({ kind: "judge-disagreement", evidence: JUDGES, proposedOwner: null }),
    ]);
    expect(evidence.admitted).toEqual([]);
    expect(evidence.refused).toHaveLength(1);
    expect(evidence.feedback).toEqual([]);
  });

  it("routes a controller-recorded hardness finding to the tests author as advisory difficulty advice", () => {
    const root = repo();
    const hardness = finding({
      kind: "hardness",
      severity: "advisory",
      proposedOwner: "tests",
      claim: "the battery saturated. Suggested check: cut mass-budget headroom",
    });
    const evidence = admitFindings(root, packet(), [hardness]);
    expect(evidence.feedback.map((f) => [f.owner, f.severity])).toEqual([["tests", "advisory"]]);
    expect(evidence.feedback[0]?.claim).toContain("cut mass-budget headroom");
    expect(evidence.feedback[0]?.findings?.[0]?.code).toBe("hardness");
  });

  it("binds feedback to the packet's content digest — altered evidence is a different digest", () => {
    expect(hashJsonBytes(packet())).not.toBe(hashJsonBytes(packet({ summary: { passed: 2, passRate: 1 } })));
  });
});

describe("the per-case feedback restriction", () => {
  function analysisWithTasks(...taskIds: string[]): IterationAnalysis {
    const analysis = packet();
    analysis.cases = double<IterationAnalysis["cases"]>(taskIds.map((taskId) => ({ taskId })));
    return analysis;
  }

  it("withholds a per-case diagnosis from authoring entirely", () => {
    const root = repo();
    const perCase = finding({
      proposedOwner: "tools-spec",
      subject: { taskId: "task-901", family: "beams" },
    });
    const evidence = admitFindings(root, analysisWithTasks("task-901"), [perCase]);
    // The finding is still admitted, so the recorded packet discloses it to the controller.
    expect(evidence.admitted).toEqual([perCase]);
    // It reaches no author session: its text names a failure location, and no count-only channel
    // speaks for it.
    expect(evidence.feedback).toEqual([]);
    expect(evidence.findingRoutes).toEqual([
      { findingDigest: expect.any(String), kind: "harness-defect", owner: null, reason: "per-case-detail" },
    ]);
    expect(JSON.stringify(evidence.feedback)).not.toContain("task-901");
  });

  it("drops a per-case diagnosis ahead of the owner check, whatever owner it proposes", () => {
    const root = repo();
    // The filter is fail-closed: the subject decides, not the owner. A per-case row that names a
    // routable owner is dropped by the same branch as one that names none.
    for (const proposedOwner of ["tools-spec", null] as const) {
      const perCase = finding({ proposedOwner, subject: { taskId: "task-901", family: "beams" } });
      const evidence = admitFindings(root, analysisWithTasks("task-901"), [perCase]);
      expect(evidence.feedback).toEqual([]);
    }
  });

  it("routes the subject-free findings beside a per-case one", () => {
    const root = repo();
    const evidence = admitFindings(root, analysisWithTasks("task-901"), [
      finding({ kind: "curriculum-defect", subject: { taskId: "task-901", family: "beams" } }),
      finding({ kind: "hardness", claim: "the next battery should be harder" }),
    ]);
    expect(evidence.feedback.map((row) => [row.owner, row.severity])).toEqual([["tests", "advisory"]]);
    expect(JSON.stringify(evidence.feedback)).not.toContain("task-901");
  });
});

describe("checkCounts — a recorded firing ledger as a count map", () => {
  it("keeps a check id spelled __proto__ as a counted key instead of losing it to the inherited setter", () => {
    const counts = checkCounts(JSON.parse('{"__proto__": 3, "tc-a": 1}'));
    expect(counts).not.toBeNull();
    expect(Object.entries(counts ?? {})).toEqual([
      ["__proto__", 3],
      ["tc-a", 1],
    ]);
  });

  it("returns null for a non-record or a non-count value, as before", () => {
    expect(checkCounts(null)).toBeNull();
    expect(checkCounts({ "tc-a": -1 })).toBeNull();
    expect(checkCounts({ "tc-a": 1.5 })).toBeNull();
  });
});
