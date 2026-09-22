/**
 * The within-family binding census: for each family, the census hands every sibling task the
 * accepted deliverable of another and requires the checks to reject it. A family whose tasks all
 * accept one another's answer is not bound to its tasks, whatever its reference solve produced.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch } from "./helpers/scratch.ts";
import { SOLVABILITY_READINESS_POLICY } from "../src/truth/solvability.ts";
import { familyBindingFindings } from "../src/truth/family-binding.ts";
import type { Brief } from "../src/truth/brief.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { double } from "./helpers/doubles.ts";
import {
  type Witnessed,
  countingHost,
  evaluateLog,
  failure,
  statuses,
  testLifetime,
  witness,
} from "./helpers/solvability-specimen.ts";
import {
  externalFamilyFixture,
  familyFixture,
  misattributingToolInventory,
} from "./helpers/solvability-families.ts";

afterAll(cleanupScratch);

describe("the within-family binding census", () => {
  const familyFindings = (result: Witnessed) =>
    result.findings.filter((found) => found.code.startsWith("TASK_FAMILY_"));
  const answerBrief = double<Brief>({
    artifactSchema: [{ name: "answer", "shape": "string", taskConditioned: true }],
    truthChecks: [{ id: "answer", execution: { artifactPaths: ["$.answer"] } }],
  });

  it.concurrent("names a family whose accepted deliverable answers every one of its tasks", async () => {
    // W20: both siblings accept the same marked answer, and all three reference solves pass.
    const log = evaluateLog();
    const result = await witness(familyFixture({ answers: ["A", "A"] }), {
      createVerifier: () => countingHost(log),
    });

    expect(statuses(result)).toEqual(["passed", "passed", "passed"]);
    expect(familyFindings(result)).toMatchObject([
      {
        code: "TASK_FAMILY_UNIVERSAL_WITNESS",
        owner: "task-curriculum",
        path: "correctness-model/tasks.json",
      },
    ]);
    expect(familyFindings(result)[0]?.detail).toContain('family "one" has 2 tasks');
    // Identical marked roots cannot change either passing artifact: only the three original
    // evaluations are needed.
    expect(log.calls).toBe(3);
  });

  it.concurrent("clears the same family once each task takes only its own deliverable", async () => {
    const log = evaluateLog();
    const fixture = familyFixture({ answers: ["A", "B"] });
    const result = await witness(fixture, { createVerifier: () => countingHost(log) });

    expect(statuses(result)).toEqual(["passed", "passed", "passed"]);
    expect(familyFindings(result)).toEqual([]);
    // Three original tasks and the two exchanges inside the first family.
    expect(log.calls).toBe(5);
    // Each exchange opens its own subject, so a tool run recorded for one donor cannot ground the
    // external checks of another donor moved into the same target.
    expect(log.subjects.filter((id) => id.startsWith("family:")).toSorted()).toEqual([
      "family:ta>tb",
      "family:tb>ta",
    ]);
    // A hybrid differs from its target only under the marked root, so only the check reading that
    // root runs; the report check already passed on the same projected bytes.
    expect(
      Object.entries(log.checks)
        .filter(([id]) => id.startsWith("family:"))
        .map(([, ran]) => ran),
    ).toEqual([["answer"], ["answer"]]);
    expect(log.checks["self:ta"]).toEqual(["answer", "report-present"]);

    // Readiness re-verifies the public solves and runs no transplant.
    const readinessLog = evaluateLog();
    const readiness = await witness(
      fixture,
      { createVerifier: () => countingHost(readinessLog) },
      "readiness",
    );
    expect(readiness.evidence?.cases).toEqual(result.evidence?.cases);
    expect(readiness.evidence?.policy).toBe(SOLVABILITY_READINESS_POLICY);
    expect(readinessLog.calls).toBe(3);
  });

  it.concurrent("leaves family binding unproved when an exchanged-answer evaluation returns no verdict", async () => {
    // An evaluation without a verdict cannot establish that the exchanged answer was wrong. This is
    // the check's own throw, so the finding routes to the correctness model and names its class.
    const fixture = familyFixture({ answers: ["A", "B"], nonResultOnMismatch: true });
    const result = await witness(fixture, { createVerifier: () => countingHost(evaluateLog()) });

    expect(statuses(result)).toEqual(["passed", "passed", "passed"]);
    expect(familyFindings(result)).toMatchObject([
      {
        code: "TASK_FAMILY_BINDING_UNPROVEN",
        owner: "bh-correctness-model",
        path: "correctness-model/evaluator.ts",
      },
    ]);
    expect(familyFindings(result)[0]?.detail).toContain("(generated-evaluate-throw)");
    expect(familyFindings(result)[0]?.detail).not.toContain("check did not settle");
    expect(familyFindings(await witness(fixture, {}, "readiness"))).toEqual([]);
  });

  it.concurrent("withholds unrelated operands before a check can misattribute family separation", async () => {
    const result = await witness(externalFamilyFixture(), {
      createVerifier: () =>
        createVerifierHost({
          inventory: misattributingToolInventory(),
          requireOsSandbox: false,
          lifetime: testLifetime(),
        }),
    });

    expect(statuses(result)).toEqual(["failed", "failed", "failed"]);
    expect(failure(result)).toContain("unrelated answer operand withheld");
    expect(result.findings.filter((found) => found.code.startsWith("TASK_FAMILY_"))).toEqual([]);
  });

  it.concurrent("refuses a missing required hidden operand instead of silently changing applicability", async () => {
    const result = await witness(familyFixture({ answers: ["A", "B"], dropSiblingHidden: true }));

    expect(result.evidence).toBeNull();
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it.concurrent("runs no census for a brief that marks no artifact root", async () => {
    const log = evaluateLog();
    const result = await witness(familyFixture({ answers: ["A", "A"], material: false }), {
      createVerifier: () => countingHost(log),
    });

    expect(statuses(result)).toEqual(["passed", "passed", "passed"]);
    expect(familyFindings(result)).toEqual([]);
    expect(log.calls).toBe(3);
  });

  it("hands every evaluation its donor, so two donors into one target stay two subjects", async () => {
    const witnesses = ["ta", "tb", "tc"].map((taskId, index) => ({
      taskId,
      family: "one",
      artifact: { answer: `A${String(index)}`, report: taskId },
    }));
    const pairs: string[] = [];
    await familyBindingFindings(answerBrief, witnesses, async (target, _artifact, donor) => {
      pairs.push(`${donor.taskId}>${target.taskId}`);
      // Only tb and tc refuse a foreign answer, so ta takes a transplant from both other donors.
      const passed = target.taskId === "ta";
      return { settled: true, passed, failedCheckIds: passed ? [] : ["answer"] };
    });

    expect(pairs.toSorted()).toEqual(["ta>tb", "tb>ta", "tb>tc", "tc>ta", "tc>tb"]);
    // Donors search side by side; each donor still walks its targets in task order.
    expect(pairs.filter((pair) => pair.startsWith("tb>"))).toEqual(["tb>ta", "tb>tc"]);
  });

  it("runs donor searches in bounded lanes and settles their findings in family and donor order", async () => {
    // Four lanes must write what one lane writes, and never run more than four hybrids at once: a
    // slow early donor that separates, a fast later donor that does not settle, a universal family.
    const witnesses = [
      ...["a1", "a2", "a3", "a4", "a5", "a6"].map((taskId, index) => ({
        taskId,
        family: "alpha",
        artifact: { answer: `A${String(index)}` },
      })),
      ...["b1", "b2", "b3"].map((taskId, index) => ({
        taskId,
        family: "beta",
        artifact: { answer: `B${String(index)}` },
      })),
    ];
    const census = async (lanes: number) => {
      let running = 0;
      let peak = 0;
      const findings = await familyBindingFindings(
        answerBrief,
        witnesses,
        async (target, _artifact, donor) => {
          running += 1;
          peak = Math.max(peak, running);
          await Bun.sleep(donor.taskId === "a1" ? 30 : 1);
          running -= 1;
          // alpha: every donor separates except a4, which never settles; beta: every sibling passes.
          if (donor.taskId === "a4") return { settled: false, passed: false, failedCheckIds: [] };
          const passed = target.family === "beta";
          return { settled: true, passed, failedCheckIds: passed ? [] : ["answer"] };
        },
        { lanes },
      );
      return { findings, peak };
    };
    const serial = await census(1);
    const laned = await census(4);

    expect(serial.peak).toBe(1);
    expect(laned.peak).toBeGreaterThan(1);
    expect(laned.peak).toBeLessThanOrEqual(4);
    expect(laned.findings).toEqual(serial.findings);
    expect(serial.findings.map((finding) => [finding.code, finding.owner])).toEqual([
      ["TASK_FAMILY_BINDING_UNPROVEN", "bh-correctness-model"],
    ]);
    expect(serial.findings[0]?.detail).toContain('family "alpha"');
  });
});
