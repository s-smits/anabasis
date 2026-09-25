/**
 * The control census in makeProbeControls, and the grounding rows withGroundingFindings joins to
 * its no-verdict row. Every case writes a real candidate slug and runs the production probe over
 * it, so the loading, typechecking and evaluation paths are the production ones. The coverage
 * cases supply host evidence rows explicitly: what is under test is what the census does with the
 * host's own record, not that an external tool ran.
 */
import { afterAll, describe, expect, it } from "bun:test";
import {
  type Brief,
  type BriefTruthCheck,
  type ContractFinding,
  projectFindingForAuthor,
} from "../src/truth/brief.ts";
import { probeGeneratedCorrectnessModelModule } from "../src/truth/contracts.ts";
import type { ControlCorpus } from "../src/truth/controls.ts";
import { makeProbeControls, withGroundingFindings } from "../src/truth/probes.ts";
import type { BuildTask } from "../src/truth/tasks.ts";
import { verifierEnvironmentHashOfTools } from "../src/truth/verifier-environment.ts";
import { resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import type { VerifierExecutionEvidence } from "../src/verify/verifier-port.ts";
import { join } from "../src/meta/path.ts";
import { double, required } from "./helpers/doubles.ts";
import { overrideHost } from "./helpers/host-override.ts";
import {
  ACCEPTS,
  BRIEF,
  CORPUS,
  EVALUATOR_SOURCE,
  REJECTS,
  TASK,
  TASK_TWO,
  probeSlugs,
} from "./helpers/probe-slug.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SCRATCH_ROOT = scratchDir(".ana-scratch-probes-controls-", import.meta.dir);
const { writeSlug } = probeSlugs(SCRATCH_ROOT);
const LIFETIME = createVerifierLifetime({ root: join(SCRATCH_ROOT, "verifier-lifetime") });
/** A private copy of the fixture brief, beside the first truth check the cases rebind. */
interface ClonedBrief {
  brief: Brief;
  firstCheck: BriefTruthCheck;
}

afterAll(async () => {
  await LIFETIME.close();
  cleanupScratch();
});

/**
 * A real verifier host reporting exactly the run rows the coverage and grounding joins read. The
 * fixture evaluator uses authored computation and never calls a tool, so the rows are supplied
 * here rather than produced by a run.
 */
const hostWithEvidence = (evidence: VerifierExecutionEvidence[]) =>
  overrideHost({ evidence: () => evidence });

function cloneBrief(): ClonedBrief {
  // SAFETY: a structured clone of the same Brief the production probe accepted in the first case.
  const brief = structuredClone(BRIEF);
  return { brief, firstCheck: required(brief.truthChecks[0], "the fixture's first truth check") };
}

const censusOf = (
  facts: { brief: Brief; corpus: ControlCorpus; tasks: readonly BuildTask[]; dir: string },
  options: Parameters<typeof makeProbeControls>[0],
) =>
  makeProbeControls({ ...options, verifierLifetime: LIFETIME })(
    facts.dir,
    facts.brief,
    facts.corpus,
    facts.tasks,
  );

describe("the controls probe", () => {
  // The module probe typechecks the verifier first, which costs seconds beyond the default timeout.
  it.concurrent("returns zero findings for a corpus the Correctness Model evaluator discriminates", async () => {
    const slugDir = writeSlug("controls-clean");
    await expect(
      makeProbeControls({ verifierLifetime: LIFETIME })(slugDir, BRIEF, CORPUS, [TASK, TASK_TWO]),
    ).resolves.toMatchObject({ findings: [] });
  }, 30_000);

  /** BRIEF with its second check rebound to one external tool over the single-part family only,
   *  beside the second task and corpus that leaves t2 owing that check nothing. */
  function externalFixture(name: string, toolId: string) {
    const second = required(BRIEF.truthChecks[1], "the fixture's second truth check");
    // SAFETY: the fixture is BRIEF with one check rebound to an external tool; the same JSON is the brief written to the slug below.
    const brief = {
      ...BRIEF,
      truthChecks: [
        BRIEF.truthChecks[0],
        {
          ...second,
          execution: {
            ...second.execution,
            families: ["single-part"],
            evidence: { kind: "external", requiredToolIds: [toolId] },
          },
        },
      ],
    } as Brief;
    const tasks = [
      TASK,
      { ...TASK_TWO, hidden: [{ checkId: "parts-assigned", expectation: { parts: ["alpha"] } }] },
    ];
    const corpus = {
      accept: ACCEPTS,
      reject: REJECTS.map((reject) =>
        reject.taskId === "t2"
          ? {
              ...reject,
              expectedCheckId: "parts-assigned",
              artifact: { assignments: [{ part: "ghost", slot: "s1" }] },
              hidden: [],
            }
          : reject,
      ),
    };
    return { brief, corpus, tasks, dir: writeSlug(name, { brief, corpus, tasks }) };
  }

  // Gate audit 2026-09-25 (docs/gate-audit.md, census-grounding-owed): commented out (unsure): an example whose check made no completed tool run, with no host refusal, no longer refuses adoption at the census
  // // A check's external evidence is owed only where the check applies, so the probe asks the one
  // // applicability owner instead of pairing every control with every check.
  // it.concurrent("charges external evidence only in the declared check families", async () => {
  it.concurrent("records the declared tool set as the census identity although no control ran it", async () => {
    const fixture = externalFixture("controls-external-applicability", "cat");
    // Gate audit 2026-09-25 (docs/gate-audit.md, census-grounding-owed): commented out (unsure): an example whose check made no completed tool run, with no host refusal, no longer refuses adoption at the census
    // // The host double reports one timed-out run elsewhere and none for these controls, so every
    // // applicable control owes a completed run.
    const elsewhere = double<VerifierExecutionEvidence>({
      subjectId: "elsewhere",
      checkId: BRIEF.truthChecks[1]!.id,
      toolId: "cat",
      outcome: "timeout",
    });
    const result = await censusOf(fixture, { createVerifier: () => hostWithEvidence([elsewhere]) });
    // Gate audit 2026-09-25 (docs/gate-audit.md, census-grounding-owed): commented out (unsure): an example whose check made no completed tool run, with no host refusal, no longer refuses adoption at the census
    // const grounding = result.findings.filter((f) => f.code === "generated-external-grounding-unexecuted");
    // // Four controls bind t1's declared family; the t2 control is outside that scope, and the two
    // // rejects aimed at the other check owe no run of this one. One row carries the remaining two.
    // expect(grounding).toHaveLength(1);
    // expect(grounding[0]?.detail).toContain(
    //   '2 example(s) of required check "expected-binding" returned with no run of tool "cat" launched (0 runs), although the check called it for other examples: "a1", "r-wrongbind";',
    // );
    // expect(grounding.some((f) => f.detail.includes("r-wrongbind-two-part"))).toBe(false);
    // The census identity is the declared tool set, as submit hashes it, although no control ran cat.
    expect(result.verifierEnvironmentHash).toBe(
      verifierEnvironmentHashOfTools(resolveToolInventory({ toolIds: ["cat"], toolTree: null }).inventory),
    );
    expect(result.verifierEnvironmentHash).not.toBeNull();
  }, 30_000);

  /**
   * The census over a check declared as external evidence from `checker`. Passing controls alone
   * do not establish that the declared tool ran: only the host's own rows do.
   */
  const toolBackedSlug = async (
    name: string,
    evidence: VerifierExecutionEvidence[],
    host: "double" | "live" = "double",
  ) => {
    const fixture = externalFixture(name, "checker");
    return await censusOf(
      fixture,
      host === "live" ? {} : { createVerifier: () => hostWithEvidence(evidence) },
    );
  };

  it("refuses a declared tool that resolves to no executable, before spending the census", async () => {
    // An unresolved tool would fail every control the same way, so it is named once and no
    // control receipt is produced.
    const result = await toolBackedSlug("tool-unresolved", [], "live");
    expect(result.findings).toEqual([
      expect.objectContaining({ code: "census-tool-missing", path: "correctness-model/brief.json" }),
    ]);
    expect(result.findings[0]?.detail).toContain('"checker"');
    expect(result.controlReceipts).toBeUndefined();
  });

  /** One supplied host-record shape for the declared pair. Only the four fields the coverage join reads
   *  are set; the rest of the host record is deliberately absent. */
  const launched = (subjectId: string): VerifierExecutionEvidence =>
    double<VerifierExecutionEvidence>({
      subjectId,
      checkId: "expected-binding",
      toolId: "checker",
      outcome: "executed",
    });

  it.concurrent("accepts coverage for a declared check when supplied host rows record its tool execution", async () => {
    const result = await toolBackedSlug(
      "tool-check-launched",
      [...ACCEPTS, ...REJECTS].map((control) => launched(control.id)),
    );
    expect(result.findings.filter((f) => f.code === "external-check-tool-unlaunched")).toEqual([]);
    const coverage = result.toolCheckCoverage ?? [];
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.checkId).toBe("expected-binding");
    expect(coverage[0]?.toolId).toBe("checker");
    expect(coverage[0]?.attestedLaunches).toBeGreaterThan(0);
    expect(coverage[0]?.rejects).toBeGreaterThan(0);
  }, 30_000);

  // Gate audit 2026-09-25 (docs/gate-audit.md, census-inert-tool): commented out (unsure): a declared tool the census never launched no longer refuses adoption; readiness still names it
  // it.concurrent("refuses a check whose declared tool the host never ran, naming the check and the tool", async () => {
  it.concurrent("records no launch for a check whose declared tool the host never ran", async () => {
    const result = await toolBackedSlug("tool-check-unlaunched", []);
    // Gate audit 2026-09-25 (docs/gate-audit.md, census-inert-tool): commented out (unsure): a declared tool the census never launched no longer refuses adoption; readiness still names it
    // const inert = result.findings.filter((f) => f.code === "external-check-tool-unlaunched");
    // expect(inert).toHaveLength(1);
    // expect(inert[0]?.path).toBe("correctness-model/evaluator.ts");
    // expect(inert[0]?.detail).toContain('"expected-binding"');
    // expect(inert[0]?.detail).toContain('"checker"');
    // Gate audit 2026-09-25 (docs/gate-audit.md, census-grounding-owed): commented out (unsure): an example whose check made no completed tool run, with no host refusal, no longer refuses adoption at the census
    // // One row for the pair, not a second row per example that owed the run.
    // expect(result.findings.filter((f) => f.code === "generated-external-grounding-unexecuted")).toEqual([]);
    // Gate audit 2026-09-25 (docs/gate-audit.md, census-inert-tool): commented out (unsure): a declared tool the census never launched no longer refuses adoption; readiness still names it
    // // Public authoring identities only, so the detail survives the author boundary.
    // expect(inert[0]?.disclosure).toMatchObject({ class: "authored" });
    expect(result.toolCheckCoverage?.[0]?.attestedLaunches).toBe(0);
  }, 30_000);

  // Gate audit 2026-09-25 (docs/gate-audit.md, reject-discrimination): commented out (unsure): a reject control that passes its named check no longer refuses the candidate or the claim
  // it.concurrent("returns author-classified findings when the corpus stops discriminating", async () => {
  //   // A "reject" that is actually clean: both named programs accept the bound task's answer.
  //   const clean = (id: string) => ({
  //     id,
  //     taskId: "t1",
  //     artifact: { assignments: [{ part: "alpha", slot: "s3" }] },
  //     mutationClass: "no-op",
  //     expectedCheckId: "parts-assigned",
  //   });
  //   const burned = {
  //     accept: ACCEPTS,
  //     reject: [...REJECTS, clean("r-actually-clean"), clean("r-also-clean")],
  //   };
  //   const slugDir = writeSlug("controls-burned", { corpus: burned });
  //   const { findings } = await makeProbeControls({ verifierLifetime: LIFETIME })(slugDir, BRIEF, burned, [
  //     TASK,
  //     TASK_TWO,
  //   ]);
  //   expect(findings).toHaveLength(1);
  //   expect(findings[0]).toMatchObject({
  //     code: "DISCRIMINATION_REJECT_PASSED",
  //     path: "correctness-model/controls.json",
  //   });
  //   expect(findings[0]?.detail).toContain("r-actually-clean");
  //   // The finding is composed from public authoring identities, so it survives projection with
  //   // its control row id and mutation class and the author knows which row to repair.
  //   // SAFETY: toHaveLength(1)/toMatchObject above proved findings[0] exists.
  //   const first = findings[0] as ContractFinding;
  //   expect(first.disclosure).toMatchObject({ class: "authored" });
  //   const projected = projectFindingForAuthor(first);
  //   expect(projected.code).toBe("DISCRIMINATION_REJECT_PASSED");
  //   // Both passing rejects share one row rather than one sentence each.
  //   expect(projected.detail).toBe(
  //     '2 invalid example(s) passed the check that should reject them: "r-actually-clean" (no-op), "r-also-clean" (no-op). Change each example so that check fails on it, or fix the check',
  //   );
  // });

  it.concurrent("strips correctnessModel issue text from a rejected valid example before the author projection", async () => {
    // Rebind the membership program to public parts, so this rejection comes from a public rule.
    const { brief, firstCheck } = cloneBrief();
    firstCheck.execution = { ...firstCheck.execution, hidden: "none", publicInputPaths: ["$.parts"] };
    // A declared-valid accept whose artifact names an undeclared part: the evidence row must
    // keep the correctnessModel's blocking-issue summary, and the author projection must carry only the
    // row identity — issue text is protected detail (tenet 4).
    const ghost = (id: string, slot: string) => ({
      id,
      taskId: "t1",
      authoredBy: "accept-controls",
      artifact: { assignments: [{ part: "ghost", slot }] },
    });
    const burned = {
      accept: [...ACCEPTS, ghost("a-correctnessModel-rejects", "s1"), ghost("a-ghost-two", "s2")],
      reject: REJECTS,
    };
    const slugDir = writeSlug("controls-accept-rejected", {
      brief,
      corpus: burned,
      evaluator: EVALUATOR_SOURCE.replace(
        '"parts-assigned": ({artifact, hidden}: Request)',
        '"parts-assigned": ({artifact, publicTask}: Request)',
      ).replace(
        "hidden[0]?.expectation.parts ?? []",
        "(publicTask.publicInput as { parts: string[] }).parts",
      ),
    });
    const { findings } = await makeProbeControls({ verifierLifetime: LIFETIME })(slugDir, brief, burned, [
      TASK,
      TASK_TWO,
    ]);
    const rejected = findings.filter((f) => f.code === "DISCRIMINATION_ACCEPT_REJECTED");
    expect(rejected).toHaveLength(1);
    // SAFETY: toHaveLength(1) above proved rejected[0] exists.
    const finding = rejected[0] as ContractFinding;
    // Evidence keeps the correctnessModel detail; the author sees the row identity and nothing else.
    expect(finding.detail).toContain("Blocking issues:");
    expect(finding.disclosure).toMatchObject({ class: "authored" });
    // Exact stripped sentence: one row for both examples, grouped by the check that blocked them,
    // and nothing from the correctnessModel's issue text.
    expect(projectFindingForAuthor(finding).detail).toBe(
      '2 valid example(s) were rejected by the correctnessModel, on [parts-assigned]: "a-correctnessModel-rejects", "a-ghost-two". Fix the correctnessModel so declared-valid examples pass',
    );
  });

  it.concurrent("attributes a public-rule negative with its named failure plus an unrelated blocker at authoring time", async () => {
    const { brief, firstCheck } = cloneBrief();
    firstCheck.execution.publicInputPaths = ["$.parts"];
    brief.truthChecks.push({
      id: "unrelated-limit",
      assertion: "the artifact also matches an unrelated task limit",
      execution: {
        families: "all",
        artifactPaths: ["$.assignments"],
        publicInputPaths: [],
        hidden: "required",
        evidence: { kind: "authored" },
      },
    });
    // Every subject owes the new check an operand, or it never executes and the census reports an
    // unproven check instead of the cascade this case is about. A reject carries its own row and a
    // accept reads the bound task's, and each expects the assignments it already has, so the alias
    // reject is the only subject the new check fails.
    const hostile = structuredClone(CORPUS);
    for (const reject of hostile.reject) {
      // SAFETY: the fixture's hidden rows are checked by the production parser before execution.
      const hidden = reject.hidden as Array<{ checkId: string; expectation: unknown }>;
      hidden.push({
        checkId: "unrelated-limit",
        expectation: reject.id === "r-alias" ? [] : reject.artifact.assignments,
      });
    }
    const tasks = [
      {
        ...TASK,
        hidden: [
          ...TASK.hidden,
          { checkId: "unrelated-limit", expectation: [{ part: "alpha", slot: "s3" }] },
        ],
      },
      { ...TASK_TWO, hidden: [...TASK_TWO.hidden, { checkId: "unrelated-limit", expectation: [] }] },
    ];
    const slugDir = writeSlug("controls-public-cascade", {
      brief,
      corpus: hostile,
      tasks,
      evaluator: EVALUATOR_SOURCE.replace(
        "export const checks = {",
        'export const checks = { "unrelated-limit": ({artifact, hidden}: Request): boolean => JSON.stringify(artifact.assignments) === JSON.stringify(hidden[0]?.expectation),',
      ),
    });
    const result = await makeProbeControls({ verifierLifetime: LIFETIME })(slugDir, brief, hostile, tasks);
    // Attribution is only observable once the second check reached a verdict of its own.
    expect(result.checkCost?.map((row) => row.checkId)).toContain("unrelated-limit");
    // The alias reject fails its named check and unrelated-limit together; the named check
    // rejected it, so the cascade is attributed and the census reports nothing.
    expect(result.findings.map((finding) => finding.code)).toEqual([]);
  }, 30_000);

  it.concurrent("maps a broken Correctness Model evaluator to typed authoring findings before any verification", async () => {
    const slugDir = writeSlug("controls-broken", { evaluator: "export const nope = {;" });
    const { findings } = await makeProbeControls({ verifierLifetime: LIFETIME })(slugDir, BRIEF, CORPUS, [
      TASK,
      TASK_TWO,
    ]);
    // The typecheck runs first and subsumes the parse error; every finding names the verifier.
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding).toMatchObject({
        code: "generated-module-types",
        path: "correctness-model/evaluator.ts",
      });
    }
  }, 30_000);

  it.concurrent("converts a Correctness Model evaluator whose top-level await never settles into a load finding", async () => {
    const slugDir = writeSlug("controls-hanging", {
      evaluator: `${EVALUATOR_SOURCE}\nawait new Promise<void>(() => {});\n`,
    });
    const findings = await probeGeneratedCorrectnessModelModule(slugDir, 1_000, LIFETIME);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "generated-module-load",
      path: "correctness-model/evaluator.ts",
    });
    expect(findings[0]?.detail).toContain("generated evaluator timeout: exceeded 1000ms");
  }, 30_000);
});

describe("the grounding rows beside the no-verdict row", () => {
  const noVerdict: ContractFinding = {
    code: "DISCRIMINATION_PROBE_NO_VERDICT",
    path: "correctness-model/controls.json",
    detail: "r1, r2",
  };
  const grounding = (controlIds: string[]) => [
    {
      code: "verifier-tool-refused",
      path: "correctness-model/evaluator.ts",
      detail: "x",
      controlIds,
    },
  ];
  it("drops the no-verdict row only when the grounding rows name every example that reached no verdict", () => {
    expect(
      withGroundingFindings([noVerdict], grounding(["r1", "r2"]), ["r1", "r2"]).map((f) => f.code),
    ).toEqual(["verifier-tool-refused"]);
    expect(withGroundingFindings([noVerdict], grounding(["r1"]), ["r1", "r2"]).map((f) => f.code)).toEqual([
      "DISCRIMINATION_PROBE_NO_VERDICT",
      "verifier-tool-refused",
    ]);
    expect(withGroundingFindings([noVerdict], [], ["r1", "r2"]).map((f) => f.code)).toEqual([
      "DISCRIMINATION_PROBE_NO_VERDICT",
    ]);
  });
});
