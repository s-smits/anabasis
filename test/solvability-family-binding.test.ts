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

  // Each row is one family shape and the census verdict it owns. `calls` counts host subjects: the
  // three reference evaluations, plus one per sibling exchange the census had to run.
  const UNIVERSAL = {
    code: "TASK_FAMILY_UNIVERSAL_WITNESS",
    owner: "task-curriculum",
    path: "correctness-model/tasks.json",
  };
  const UNPROVEN = {
    code: "TASK_FAMILY_BINDING_UNPROVEN",
    owner: "bh-correctness-model",
    path: "correctness-model/evaluator.ts",
  };
  it.each<[string, Parameters<typeof familyFixture>[0], Array<typeof UNIVERSAL>, number, string | null]>([
    // Identical marked roots cannot change either passing artifact, so no exchange runs.
    [
      "a deliverable that answers every task in its family",
      { answers: ["A", "A"] },
      [UNIVERSAL],
      3,
      'family "one" has 2 tasks',
    ],
    // The brief validator reads `$['answer']` as the root `answer`, so the census must too;
    // missing it, a family whose tasks each take only their own answer reads as universal.
    [
      "a bracketed spelling of the marked root",
      { answers: ["A", "B"], answerPath: "$['answer']" },
      [],
      5,
      null,
    ],
    [
      "a brief that marks no artifact root, where no census runs",
      { answers: ["A", "A"], material: false },
      [],
      3,
      null,
    ],
    // An exchange whose check threw cannot establish the answer was wrong; the throw is the
    // correctness model's own, so the finding names its class and not its text.
    [
      "an exchanged answer that returns no verdict",
      { answers: ["A", "B"], nonResultOnMismatch: true },
      [UNPROVEN],
      5,
      "(generated-evaluate-throw)",
    ],
  ])("%s", async (_, spec, found, calls, detail) => {
    const log = evaluateLog();
    const result = await witness(familyFixture(spec), { createVerifier: () => countingHost(log) });

    expect(statuses(result)).toEqual(["passed", "passed", "passed"]);
    expect(familyFindings(result)).toMatchObject(found);
    expect(familyFindings(result)).toHaveLength(found.length);
    expect(log.calls).toBe(calls);
    if (detail !== null) {
      expect(familyFindings(result)[0]?.detail).toContain(detail);
    }
    expect(
      familyFindings(result)
        .map((f) => f.detail)
        .join("\n"),
    ).not.toContain("check did not settle");
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
    expect(result.findings).toMatchObject([
      {
        code: "solvability-bundleSnapshot-contract-invalid",
        detail: 'applicable check "answer" requires one hidden operand; absence cannot skip the check',
      },
    ]);
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

  // Each task publishes a mass cap and its reference design weighs `mass`; a design passes a task
  // whose cap it meets. The tightest design then meets every looser cap, so each row holds a
  // deliverable that answers the whole family, and only a pair accepting both ways refuses it.
  it.each<[string, Array<[string, number, number]>, string[]]>([
    [
      "a ladder of tightening caps, whose tightest design meets every looser one",
      [
        ["t100", 100, 100],
        ["t150", 150, 150],
        ["t200", 200, 200],
      ],
      [],
    ],
    [
      "a ladder with a repeated rung, whose two designs meet each other's cap",
      [
        ["t100", 100, 100],
        ["t150a", 150, 140],
        ["t150b", 150, 150],
      ],
      ["TASK_FAMILY_UNIVERSAL_WITNESS"],
    ],
    [
      "one cap written three ways, where every design meets every task",
      [
        ["ta", 150, 100],
        ["tb", 150, 110],
        ["tc", 150, 120],
      ],
      ["TASK_FAMILY_UNIVERSAL_WITNESS"],
    ],
  ])("%s", async (_, rungs, codes) => {
    const cap = new Map(rungs.map(([taskId, limit]) => [taskId, limit]));
    const massOf = new Map(rungs.map(([taskId, , mass]) => [taskId, mass]));
    const witnesses = rungs.map(([taskId, , mass]) => ({
      taskId,
      family: "roof",
      artifact: { answer: String(mass), report: taskId },
    }));
    const pairs: string[] = [];
    const findings = await familyBindingFindings(answerBrief, witnesses, async (target, _artifact, donor) => {
      pairs.push(`${donor.taskId}>${target.taskId}`);
      const passed = (massOf.get(donor.taskId) ?? Infinity) <= (cap.get(target.taskId) ?? 0);
      return { settled: true, passed, failedCheckIds: passed ? [] : ["answer"] };
    });

    expect(findings.map((finding) => finding.code)).toEqual(codes);
    // The pair search reruns no exchange a donor search already ran.
    expect(new Set(pairs).size).toBe(pairs.length);
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
