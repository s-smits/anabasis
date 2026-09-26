import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { deriveIterationAnalysis } from "../src/analyse/iteration-analysis.ts";
import { runJudgeReviews } from "../src/analyse/judge-reviews.ts";
import { type JudgeEvidence, judgeDecision, validateJudgeEvidence } from "../src/claim/judge.ts";
import type { JudgeAttempt, JudgeSession } from "../src/review/judge.ts";
import { briefPublicResources } from "../src/correctness-bundle/public-resources.ts";
import { MATCHING_BRIEF, scriptedMatchingSolver } from "./helpers/matching-fixture.ts";
import { double } from "./helpers/doubles.ts";
import { builtSession, fullFakeHost, probeEvidence } from "./helpers/measure-doubles.ts";
import { measure, measureScratch, scaffoldRepo } from "./helpers/measure-repo.ts";
import { cleanupScratch } from "./helpers/scratch.ts";

/**
 * The census Judge riding a measured round, with a scripted session and no model call. The Judge
 * advises: it reads only accepted artifacts that already carry a verifier verdict, its
 * disagreement is disclosed on the claim rather than scored, and it supplies no blocking feedback
 * to the Builder. `harness-measure.test.ts` owns the round itself.
 */

afterAll(cleanupScratch);

const SCRATCH_ROOT = measureScratch();

describe("the census Judge on a measured round", () => {
  /**
   * Exercise the census Judge's production caller with a scripted session and no model call.
   * The Judge marks the reversed, verifier-equivalent t2 artifact as a failure, producing one
   * contested row. The claim keeps the verifier's four passes and discloses the disagreement.
   * The Judge exit is advice only, so the review supplies no blocking feedback to the Builder.
   */
  it.concurrent("judges every case through the resolved session without changing claimability", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "e2e-census"), { toolsSpec: true, conformance: true });
    const verdict = (pass: boolean): JudgeAttempt => ({
      verdict: pass,
      abstained: false,
      rationale: pass ? "consistent with the public task" : "binding does not satisfy the public task",
      rules: pass ? [] : ["publicInput"],
      error: null,
      errorKind: null,
      turns: 1,
    });
    const judgeInputs: string[] = [];
    const judge: JudgeSession = {
      pin: "codex/scripted-judge",
      promptPolicyDigest: "a".repeat(64),
      invoke: async (input) => {
        judgeInputs.push(JSON.stringify(input));
        // Decide from model-visible bytes alone. The scripted Judge treats the declared binding
        // order as significant, while the verifier correctly treats assignments as a set. The
        // battery reverses t2, producing one deliberate disagreement whose public bytes differ
        // from every known-good accept; ordinary accepts match their bound task exactly.
        // SAFETY: every subject binds a matching-fixture task, whose publicInput
        // always carries a bindings array.
        const publicInput = input.publicContext.publicTask?.publicInput as {
          bindings: Array<{ part: string; slot: string }>;
        };
        // SAFETY: accepted submissions in this suite are reference-shaped artifacts with an
        // assignments array; the optional chain below tolerates a missing one.
        const artifact = input.submittedArtifact as { assignments: Array<{ part: string; slot: string }> };
        return verdict(
          JSON.stringify(artifact.assignments.map((b) => [b.part, b.slot])) ===
            JSON.stringify(publicInput.bindings.map((b) => [b.part, b.slot])),
        );
      },
    };
    const result = await measure({
      runId: "m6-census",
      repoRoot: repo,
      publicRequest: "Design and check matching assignments",
      // The scripted solver carries a Codex-native identity, so the evaluated Built slot is
      // pinned to the same provider. Defaults are covered by the resolution suites.
      processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
      solver: scriptedMatchingSolver(new Set(), undefined, new Set(["t2"])),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
      judge,
    });
    // Truth is untouched: the judge changed no case row and no denominator. The claim follows
    // the verifier-owned case truth; the disagreement remains in the recorded judge evidence for
    // the audit review, without becoming a second claim authority.
    if (result.claim === null) throw new Error("expected the census battery to write a claim");
    expect(result.claim).toMatchObject({
      created: true,
      // t2 was vetoed: the verifier's pass stands, the claim says so beside its rate.
      statement: { passRate: 1, vetoed: 1, judgeDecision: "advisory-comparison" },
    });
    // The claim NAMES its contested rows (run51-sol-0902 created three clean-reading claims over
    // 23 disputed rows) while ok and the passed count stay exactly what the verifier decided.
    const claimFile = parseJsonAs<{
      claim: { ok: boolean; statement?: { n: number; passed: number } };
      disputedCaseIds: string[];
    }>(readFileSync(result.claim.evidencePath, "utf8"));
    expect(claimFile).toMatchObject({
      claim: { ok: true, statement: { n: 4, passed: 4 } },
      disputedCaseIds: ["t2"],
    });
    expect(result.verdicts.measured).toBe(true);
    expect(result.verdicts.claimCreated).toBe(true);
    // The recorded aggregate, re-derived from its own fields rather than trusted as stored.
    const runDir = join(repo, "domains", "bridge-truss", "runs", "m6-census");
    const battery = parseJsonAs<{ judge: JudgeEvidence }>(readFileSync(join(runDir, "battery.json"), "utf8"));
    validateJudgeEvidence(battery.judge);
    expect(battery.judge.judge).toBe("unvalidated");
    if (battery.judge.judge === "off") throw new Error("the census ran; the evidence must not read off");
    expect(judgeDecision(battery.judge)).toBe("advisory-comparison");
    expect(battery.judge).toMatchObject({ offered: 4, verdicts: 4 });
    // Domain resources reach every Judge call. Public-validity rules are task-relative and reach
    // only real battery/control subjects, not the null-task driver probe. The fixture's hidden
    // "pairs" field and truth checks stay out throughout.
    const publicResourcesJson = JSON.stringify(
      briefPublicResources(double(MATCHING_BRIEF)).filter(
        ({ name }) => name !== "public-validity-rules" && name !== "artifact-schema",
      ),
    );
    expect(judgeInputs.length).toBeGreaterThan(0);
    for (const serialized of judgeInputs) {
      expect(serialized).toContain(publicResourcesJson.slice(1, -1));
      expect(serialized).toContain('"publicRequest":"Design and check matching assignments"');
      expect(serialized).toContain('"maxSubmitAttempts":3');
      expect(serialized).toContain('"availableToolNames"');
      expect(serialized).toContain('"submit"');
      expect(serialized).not.toContain('"pairs"');
      expect(serialized).not.toContain("truthChecks");
      expect(serialized).not.toContain("Complete the task with the available tools");
    }
    const taskJudgeInputs = judgeInputs.filter((serialized) => !serialized.includes('"publicTask":null'));
    expect(taskJudgeInputs.length).toBeGreaterThan(0);
    for (const serialized of taskJudgeInputs) {
      expect(serialized).toContain('"publicValidityRules":[');
      // Both named checks explicitly apply to every family; hidden rows do not select rules.
      expect<unknown>(serialized).toContain(MATCHING_BRIEF.truthChecks[1]?.assertion);
      expect<unknown>(serialized).toContain(MATCHING_BRIEF.truthChecks[0]?.assertion);
      expect(serialized).toContain('"publicInputPaths":["$.parts","$.bindings"]');
    }
    const publicContext = parseJsonAs<{
      schema: string;
      publicDomainDigest: string;
      publicDomain: { publicRequest: string };
    }>(readFileSync(join(runDir, "judge/public-context.json"), "utf8"));
    expect(publicContext).toMatchObject({
      schema: "judge-public-context/v1",
      publicDomain: { publicRequest: "Design and check matching assignments" },
    });
    expect(publicContext.publicDomainDigest).toMatch(/^[0-9a-f]{64}$/);
    const firstCaseJudge = parseJsonAs<{
      schema: string;
      publicContextDigest: string;
      judgeInputDigest: string;
    }>(readFileSync(join(runDir, "cases/t1/judge.json"), "utf8"));
    expect(firstCaseJudge).toMatchObject({ schema: "judge-subject/v3" });
    expect(firstCaseJudge.publicContextDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(firstCaseJudge.judgeInputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(battery.judge).toMatchObject({ disagreements: 1, verifierPassJudgeFail: 1 });
    // Analysis projects this recorded main-Judge census with no extra model call.
    const analysis = deriveIterationAnalysis(repo, "bridge-truss", "m6-census");
    expect(analysis.battery.claimCreated).toBe(true);
    const reviews = runJudgeReviews(analysis, { repoRoot: repo, judgePin: null });
    expect(reviews.schema).toBe("judge-reviews/v12");
    expect(reviews.provisional).toBeNull();
    expect(reviews.census?.runId).toBe("m6-census");
    expect(reviews.coverage).toMatchObject({ reviewable: 4, reviewed: 4 });
    expect(reviews.contested.map((entry) => entry.taskId)).toEqual(["t2"]);
    // One contested row is disclosed as an advisory disagreement; the Judge exit never blocks.
    expect(reviews.exit).toMatchObject({
      kind: "advisory",
      verifierFailJudgePass: 0,
      verifierPassJudgeFail: 1,
      verified: 4,
    });
    expect(reviews.absent).toEqual([]);
  }, 240_000);

  it.concurrent("sends no control subject to the Judge after four disagreements, and blocks nothing", async () => {
    const repo = scaffoldRepo(join(SCRATCH_ROOT, "e2e-census-skip"), { toolsSpec: true, conformance: true });
    const reviewedCases: string[] = [];
    const otherSubjects: string[] = [];
    const verdict = (pass: boolean): JudgeAttempt => ({
      verdict: pass,
      abstained: false,
      rationale: pass ? "reads as consistent" : "reads as inconsistent",
      rules: pass ? [] : ["publicInput"],
      error: null,
      errorKind: null,
      turns: 1,
    });
    const judge: JudgeSession = {
      pin: "codex/scripted-judge",
      invoke: async (input, context) => {
        // The transport probe (null artifact) must succeed so the review starts at all.
        if (input.submittedArtifact === null) return verdict(true);
        if (context?.subjectKind === "battery-case") reviewedCases.push(context.subjectId);
        else otherSubjects.push(`${String(context?.subjectKind)}:${String(context?.subjectId)}`);
        return verdict(false);
      },
    };
    const result = await measure({
      runId: "m6-census-skip",
      repoRoot: repo,
      processEnv: { HARNESS_BUILT_BACKEND: "codex", CODEX_BUILT_MODEL: "gpt-5.5" },
      solver: scriptedMatchingSolver(),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
      judge,
    });
    // Measurement and the claim continue exactly as without a judge: truth is verifier-owned.
    expect(result.claim?.created).toBe(true);
    expect(result.claim?.statement?.passRate).toBe(1);
    const runDir = join(repo, "domains", "bridge-truss", "runs", "m6-census-skip");
    const battery = parseJsonAs<{
      judge: JudgeEvidence;
      cases: Array<{ taskId: string }>;
    }>(readFileSync(join(runDir, "battery.json"), "utf8"));
    validateJudgeEvidence(battery.judge);
    if (battery.judge.judge === "off") throw new Error("the review ran; the evidence must not read off");
    expect(judgeDecision(battery.judge)).toBe("advisory-comparison");
    expect(battery.judge).toMatchObject({
      judge: "unvalidated",
      offered: battery.cases.length,
      verifierPassJudgeFail: battery.cases.length,
    });
    // Every cited fail of a verifier pass bought exactly one confirming sample and no census file.
    expect(reviewedCases.toSorted()).toEqual(
      battery.cases.flatMap((row) => [row.taskId, row.taskId]).toSorted(),
    );
    expect(battery.judge.vetoed).toBe(battery.cases.length);
    expect(otherSubjects).toEqual([]);
    for (const retired of [
      "control-census-sample.json",
      "bait-corpus.json",
      "review-standing.json",
      "controls",
    ]) {
      expect(existsSync(join(runDir, "judge", retired))).toBe(false);
    }
    // All four verifier-pass/Judge-fail rows are complete advice; the exit cannot block.
    const analysis = deriveIterationAnalysis(repo, "bridge-truss", "m6-census-skip");
    const reviews = runJudgeReviews(analysis, { repoRoot: repo, judgePin: null });
    expect(reviews.provisional).toBeNull();
    expect(reviews.contested).toHaveLength(4);
    expect(reviews.exit).toMatchObject({
      kind: "advisory",
      verifierFailJudgePass: 0,
      verifierPassJudgeFail: 4,
    });
  }, 240_000);
});
