/**
 * Tests for reading the recorded Main Judge census. No model call happens on this path:
 * `runJudgeReviews` is synchronous and reads the JudgeEvidence the eval runner recorded at MEASURE
 * time. Census fixtures use the production summarizeJudge over hand-written observations, so every
 * aggregate a test relies on is derived by the production aggregator instead of hand-computed
 * into a record validateJudgeEvidence would refuse.
 *
 * Proven here: every complete disagreement is named without a materiality threshold; an
 * incomplete, absent or self-contradictory review makes the projection provisional; the Judge
 * exit is advisory at any disagreement count and never routes an owner, including over a
 * historical validated control census; and the projection writes no byte.
 */
import { keyIfDefined } from "../src/meta/optional-key.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import {
  type CaseEvidence,
  type IterationAnalysis,
  admitFindings,
} from "../src/analyse/iteration-analysis.ts";
import { authorSessionOwner } from "../src/analyse/finding-owner.ts";
import { runJudgeReviews } from "../src/analyse/judge-reviews.ts";
import { contestedCases, isDisputedFail, isVetoed } from "../src/analyse/judge-contested.ts";
import { required } from "./helpers/doubles.ts";
import { tracePointer } from "../src/claim/case-record.ts";
import type { JudgeEvidence } from "../src/claim/judge.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import {
  type JudgeSession,
  type JudgeObservation,
  type JudgeSubjectEvidence,
  summarizeJudge,
  JUDGE_VERDICT_SCHEMA,
} from "../src/truth/judge.ts";
import { SANITIZER_VERSION } from "../src/truth/sanitize.ts";
import { ACTIVE_JUDGE_PROMPTS } from "../src/truth/judge-prompt-policy.ts";
import { isBoolean, type JsonObject } from "../src/meta/json-shape.ts";

const scratch: string[] = [];
const SLUG = "bridge-truss";
const RUN = "base";
const JUDGE_PIN = "codex/gpt-5.1-codex-judge";
const BUILT_PIN = "codex/gpt-5.1-codex";
/** A judge verdict as the census recorded it: decided, deliberate abstention, or a failed call. */
type Verdict = boolean | null | "abstain";

interface CaseSpec {
  taskId: string;
  /** Verifier truth for this case; null models a runtime non-result (no comparable pair). */
  truthOk: boolean | null;
  /** The authored task family. Default "truss": the fixture uses one family unless specified. */
  family?: string;
  /** The judge's recorded verdict; omitted means it AGREED with the verifier. */
  judge?: Verdict;
}

interface BatterySpec {
  cases: CaseSpec[];
  /** How battery.json presents its review. Default: the current producer's record. `control-census`
   *  is a record from before 2026-09-14, when a control census stood behind the review. */
  census?: "none" | "off" | "tampered" | "control-census";
}

/** What one recorded fixture repo offers a projection test: its root and the packet derived over it. */
interface SealedFixture {
  root: string;
  analysis: IterationAnalysis;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
  if (spec.census === "tampered") return { ...evidence, disagreements: evidence.disagreements + 5 };
  if (spec.census !== "control-census") return evidence;
  // A pre-2026-09-14 record with three answered controls behind it.
  return {
    ...evidence,
    censusSize: { ...evidence.censusSize, controls: 3, total: evidence.censusSize.total + 3 },
    verdicts: { ...evidence.verdicts, controls: 3, total: evidence.verdicts.total + 3 },
  };
}

/** A repo holding exactly the recorded evidence the projection is allowed to read. */
function repoWith(
  spec: BatterySpec,
  opts?: { batteryRuntime?: JsonObject; judgeWithoutRules?: true },
): SealedFixture {
  const root = mkdtempSync(join(tmpdir(), "ana-judge-"));
  scratch.push(root);
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
      const judged = subjectEvidence(row.taskId, "battery-case", judgeVerdictOf(row));
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
        },
        backendPin: BUILT_PIN,
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
function exitBattery(count: number, contested: number, census?: BatterySpec["census"]): BatterySpec {
  const spec: BatterySpec = {
    cases: Array.from({ length: count }, (_, index) =>
      index < contested
        ? { taskId: `t${index}`, family: index === 0 ? "deck" : "truss", truthOk: false, judge: true }
        : { taskId: `t${index}`, truthOk: true },
    ),
    ...keyIfDefined("census", census),
  };
  return spec;
}

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(root, entry.name)) : [join(root, entry.name)],
  );
}

describe("the main-Judge census projection reads recorded evidence, never a model", () => {
  it("states the census absent when the battery recorded none", () => {
    const { root, analysis } = repoWith({ cases: [{ taskId: "t1", truthOk: true }], census: "none" });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.absent).toEqual([expect.stringMatching(/^main-judge census: no census to read/)]);
    expect(result.census).toBeNull();
    expect(result.provisional).toMatch(/^the battery has no census/);
    expect(result.contested).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ reviewable: 0, reviewed: 0 });
  });

  it('reads a judge:"off" battery as an honest disclosure, not a defect', () => {
    const { root, analysis } = repoWith({ cases: [{ taskId: "t1", truthOk: true }], census: "off" });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.absent[0]).toMatch(/evidence says judge:"off", so this battery had no judge/);
    expect(result.provisional).toMatch(/the battery has no census/);
    expect(result.exit.kind).toBe("none");
  });

  it("refuses a census whose stored aggregate contradicts its own fields", () => {
    const { root, analysis } = repoWith({ cases: [{ taskId: "t1", truthOk: true }], census: "tampered" });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    // Refused evidence carries its validation error: no census is returned, the violation is
    // quoted as the reason it holds, and nothing gets projected from the contradictory aggregate.
    expect(result.provisional).toMatch(/disagreements cannot exceed disagreementDenominator/);
    expect(result.census).toBeNull();
    expect(result.findings).toEqual([]);
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
    expect(result.schema).toBe("judge-reviews/v10");
    expect(result.judgePin).toBe(JUDGE_PIN);
  });
});

describe("a cited fail joins the check it contradicts", () => {
  const subject = (
    taskId: string,
    truthOk: boolean,
    verdict: boolean,
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
        subject("t1", true, false, ["every member stays under its capacity", "artifactSchema"], {
          confirmation: false,
        }),
        subject("t2", true, false, ["artifactSchema"], { confirmation: false }),
        subject("t3", true, false, []),
        subject("t4", false, true, []),
        subject("t5", true, false, ["every member stays under its capacity"], { confirmation: true }),
        subject("t6", true, false, ["every member stays under its capacity"]),
      ],
      new Map([["every member stays under its capacity", "member-capacity"]]),
    );
    expect(rows.every((row) => row.rationale === "scripted census fixture")).toBe(true);
    expect(rows.map((row) => [row.taskId, row.rules, row.checkIds, row.confirmed, isVetoed(row)])).toEqual([
      ["t1", ["every member stays under its capacity", "artifactSchema"], ["member-capacity"], true, true],
      ["t2", ["artifactSchema"], [], true, true],
      ["t3", [], [], false, false],
      ["t4", [], [], false, false],
      ["t5", ["every member stays under its capacity"], ["member-capacity"], false, false],
      ["t6", ["every member stays under its capacity"], ["member-capacity"], false, false],
    ]);
  });

  it("a Judge pass of a verifier fail names the failing checks and is disputed only when confirmed and named", () => {
    const rows = contestedCases(
      [
        subject("t1", false, true, [], { confirmation: true, failedCheckIds: ["member-capacity"] }),
        subject("t2", false, true, [], { confirmation: false, failedCheckIds: ["member-capacity"] }),
        subject("t3", false, true, [], { confirmation: true, failedCheckIds: [] }),
        subject("t4", false, true, [], { confirmation: undefined, failedCheckIds: ["member-capacity"] }),
      ],
      new Map(),
    );
    expect(
      rows.map((row) => [row.taskId, row.checkIds, row.confirmed, isDisputedFail(row), isVetoed(row)]),
    ).toEqual([
      ["t1", ["member-capacity"], true, true, false],
      ["t2", ["member-capacity"], false, false, false],
      ["t3", [], true, false, false],
      ["t4", ["member-capacity"], false, false, false],
    ]);
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
    expect(result.census?.evidence.decision).toBe("advisory-comparison");
    expect(result.census?.evidence.verifierFailJudgePass).toBe(1);
    expect(result.census?.evidence.verifierPassJudgeFail).toBe(1);
    expect(result.provisional).toBeNull();
    expect(result.contested.map(({ taskId, judge, verifier }) => ({ taskId, judge, verifier }))).toEqual([
      { taskId: "t1", judge: true, verifier: false },
      { taskId: "t2", judge: false, verifier: true },
    ]);
    // An advisory disclosure routes to no author session.
    expect(result.exit.kind).toBe("advisory");
    expect(result.findings.map((row) => [row.kind, row.severity])).toEqual([
      ["judge-disagreement", "advisory"],
    ]);
    // The advisory claim names where the disagreement sits, by family and never by task id.
    expect(result.findings[0]?.claim).toMatch(
      /on 2 of 2 verified cases .*; the contested cases lie in families: truss$/,
    );
    expect(result.findings[0]?.claim).not.toContain("t1");
    // The recorded verifier verdict is untouched.
    expect(analysis.cases.find((row) => row.taskId === "t1")?.pass).toBe(false);
    expect(admitFindings(root, analysis, result.findings).feedback).toEqual([]);
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
    expect(result.census?.evidence.disagreementRate).toBe(0.25);
    expect(result.coverage).toEqual({ reviewable: 4, reviewed: 4 });
    // The raw contradiction is named without filtering at 0.25.
    expect(result.contested).toEqual([
      {
        taskId: "t1",
        family: "truss",
        judge: false,
        verifier: true,
        rules: [],
        rationale: "scripted census fixture",
        confirmed: false,
        checkIds: [],
        evidence: `domains/${SLUG}/runs/${RUN}/cases/t1/judge.json`,
        // The recorded pointer to the artifact under dispute: t1 PASSED the verifier, so the row
        // proves the producer reads judged artifacts through the record, not only failed ones.
        artifact: `domains/${SLUG}/runs/${RUN}/cases/t1/artifact.json`,
      },
    ]);
    expect(result.exit).toMatchObject({
      kind: "advisory",
      verifierFailJudgePass: 0,
      verifierPassJudgeFail: 1,
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
    expect(result.census?.evidence.decision).toBe("advisory-comparison");
    expect(result.exit.kind).toBe("none");
    expect(result.findings).toEqual([]);
  });
});

describe("coverage and historical records", () => {
  it("goes provisional on an incomplete review and still names the complete disagreement", () => {
    const { root, analysis } = repoWith({
      cases: [
        { taskId: "t1", truthOk: true, judge: false },
        { taskId: "t2", truthOk: true, judge: null },
      ],
    });
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.census?.evidence.decision).toBe("incomplete-census");
    expect(result.provisional).toBe(
      "the judge review is incomplete (incomplete-census): 1/2 battery verdicts returned",
    );
    expect(result.coverage).toEqual({ reviewable: 2, reviewed: 1 });
    expect(result.contested.map((row) => row.taskId)).toEqual(["t1"]);
    expect(result.exit.kind).toBe("advisory");
    // c1d2a7 round two reported "0 citing shown rules" for a fail that cited one and was not
    // repeated on the re-sample. The clause counts vetoes, so it says veto and says what one is.
    expect(result.exit.reason).toContain(
      "0 were vetoes, a cited fail of a verifier pass that a second sample repeated",
    );
    expect(result.exit.reason).not.toContain("citing shown rules");
  });

  it("reads a judge record without its cited rules, as recorded before 2026-09-15, as no judge evidence", () => {
    const { root, analysis } = repoWith(
      { cases: [{ taskId: "t1", truthOk: true, judge: false }] },
      { judgeWithoutRules: true },
    );
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: null });
    expect(result.census?.evidence.verifierPassJudgeFail).toBe(1);
    expect(result.contested).toEqual([]);
  });

  it("refuses a review a control census stood behind, as recorded before 2026-09-14", () => {
    const { root, analysis } = repoWith(exitBattery(10, 3, "control-census"));
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: JUDGE_PIN });
    expect(result.provisional).toMatch(/censusSize.controls must be 0/);
    expect(result.census).toBeNull();
    expect(result.findings).toEqual([]);
  });
});

describe("the Judge exit is advice only", () => {
  it("does not block on 3 of 10 verifier-fail/Judge-pass cases, the old blocking floor", () => {
    const { root, analysis } = repoWith(exitBattery(10, 3));
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: JUDGE_PIN });
    expect(result.provisional).toBeNull();
    expect(result.exit).toMatchObject({
      kind: "advisory",
      verifierFailJudgePass: 3,
      verifierPassJudgeFail: 0,
      verified: 10,
    });
    expect(result.findings).toHaveLength(1);
    const finding = required(result.findings[0], "the advisory Judge finding");
    expect(finding).toMatchObject({ kind: "judge-disagreement", severity: "advisory", proposedOwner: null });
    expect(finding.evidence).toBe(`campaigns/${SLUG}/analysis/${RUN}-judges.json`);
    // Families are authoring identities; task ids are failure locations and never leave the record.
    expect(finding.claim).toContain("families: deck, truss");
    expect(finding.claim).not.toMatch(/t[0-9]/);
    expect(authorSessionOwner(finding)).toEqual({ owner: null, reason: "judge-advisory-only" });
    const admitted = admitFindings(root, analysis, result.findings);
    expect(admitted.refused).toEqual([]);
    expect(admitted.feedback).toEqual([]);
  });

  it("does not block when the Judge disputes every verified case", () => {
    const { root, analysis } = repoWith(exitBattery(10, 10));
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: JUDGE_PIN });
    expect(result.census?.evidence).toMatchObject({ judge: "unvalidated", decision: "advisory-comparison" });
    expect(result.exit).toMatchObject({ kind: "advisory", verifierFailJudgePass: 10 });
    expect(result.findings.map((row) => [row.kind, row.severity])).toEqual([
      ["judge-disagreement", "advisory"],
    ]);
    expect(admitFindings(root, analysis, result.findings).feedback).toEqual([]);
  });

  it("is `none`, with no finding at all, when the Judge and the verifier agreed everywhere", () => {
    const { root, analysis } = repoWith(exitBattery(10, 0));
    const result = runJudgeReviews(analysis, { repoRoot: root, judgePin: JUDGE_PIN });
    expect(result.exit).toMatchObject({ kind: "none", verifierFailJudgePass: 0, verified: 10 });
    expect(result.findings).toEqual([]);
  });
});

describe("Judge prompt policy", () => {
  it("checks every requirement internally while keeping the emitted rationale within its fixed contract", () => {
    const { census } = ACTIVE_JUDGE_PROMPTS;
    expect(census).toContain("Check every stated requirement before deciding.");
    expect(census).toContain("decisive unmet requirement");
    expect(census).toContain("Do not list every requirement in the rationale.");
    expect(census).not.toContain("List each stated requirement and check it separately.");
    expect(census).toContain("If a required part is missing, wrong, contradicted, or unsupported");
    // 2026-08-19: a failure may not rest on a convention the Judge was never shown (run 69).
    expect(census).toContain("a requirement you cannot see cannot ground a failure");
    // 2026-09-02: a recomputed magnitude is not a check of the shown definition. Both
    // truss-run6-opus-0902 disputes passed a negative peak against a "largest absolute" rule.
    expect(census).toContain("recompute it from the shown inputs");
    expect(census).toContain("matches in magnitude but differs in sign or definition does not meet it");
    // 2026-09-15: a recomputation failure shows its inputs, both values and the tolerance; a run the
    // Judge cannot perform (compile, execute, solve, simulate) is not decided by predicting it.
    expect(census).toContain(
      "states the shown inputs it used, the recomputed value, the declared value and the tolerance quoted from the shown material",
    );
    // 2026-09-19: the Judge supplies neither the tolerance nor the intermediates. Run de8b40's
    // bridge-01 failed a verifier-passed case twice on a 0.05 kg tolerance the bound task does not
    // publish (it publishes `reportToleranceRelative` 0.01, 2.88 kg here), over a gap produced by
    // member lengths it derived from joint coordinates and got wrong in the second decimal.
    expect(census).toContain(
      "your construction of that quantity is your own work and not evidence against the output",
    );
    expect(census).toContain(
      "states no tolerance for that comparison, a numeric disagreement is not a failure",
    );
    expect(census).toContain("is not decided by predicting that run from its text");
    expect(JUDGE_VERDICT_SCHEMA.properties.rationale).toMatchObject({ minLength: 1, maxLength: 400 });
  });
});
