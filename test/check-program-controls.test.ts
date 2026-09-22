import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { evaluateCheckProgram } from "../vendor/correctness-model-bundle/evaluate.ts";
import type { CheckFn } from "../src/truth/correctness-model-contract.ts";
import { runControls } from "../src/truth/run-controls.ts";
import { applicableTruthChecks } from "../src/truth/brief.ts";
import { validateControlReceipts } from "../src/truth/control-receipts.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import {
  MATCHING_BRIEF,
  MATCHING_TASKS,
  MATCHING_ACCEPTS,
  MATCHING_REJECTS,
  writeMatchingSlug,
} from "./helpers/matching-fixture.ts";
import { double } from "./helpers/doubles.ts";

test("the matching programs accept real solutions and isolate every declared hostile control", async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".ana-scratch-check-controls-"));
  try {
    writeMatchingSlug(dir);
    // SAFETY: writeMatchingSlug wrote this exact fixture source with a CheckFn map; production loads it in a confined child.
    const { checks } = (await import(join(dir, "correctness-model/evaluator.ts"))) as {
      checks: Record<string, CheckFn>;
    };
    const runs: string[] = [];
    const evaluate = evaluateCheckProgram(MATCHING_BRIEF, (id, input) => {
      runs.push(id);
      return checks[id]!(input);
    });
    const corpus = { accept: MATCHING_ACCEPTS, reject: MATCHING_REJECTS };
    const result = await runControls(evaluate, corpus, MATCHING_TASKS, { brief: MATCHING_BRIEF });
    expect(result.findings).toEqual([]);
    expect(result).toMatchObject({
      claimable: true,
      acceptsPassed: 2,
      rejectsFailed: 7,
      rejectsAttributed: 7,
    });
    // Accepts run every applicable check; each reject runs only the check it declares.
    const acceptRuns = MATCHING_ACCEPTS.flatMap((control) =>
      applicableTruthChecks(MATCHING_BRIEF, MATCHING_TASKS.find((task) => task.taskId === control.taskId)!),
    );
    expect(runs.length).toBe(acceptRuns.length + MATCHING_REJECTS.length);
    expect(result.controlReceipts.every((row) => row.schema === "control-receipt/v2")).toBe(true);
    expect(validateControlReceipts(corpus, result.controlReceipts)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanup pending keeps the completed control and stops without executing later controls", async () => {
  let calls = 0;
  let stopped = false;
  const lifetime = double<VerifierLifetime>({
    assertUsable: () => {
      if (stopped) throw new VerifierOperationalStop("unsettled-children", ["receipt"]);
    },
  });
  const corpus = { accept: [...MATCHING_ACCEPTS, { ...MATCHING_ACCEPTS[0]!, id: "unrun" }], reject: [] };
  const result = await runControls(
    async () => {
      calls++;
      if (calls === 2) {
        stopped = true;
        throw new VerifierOperationalStop("unsettled-children", ["receipt"]);
      }
      return { ok: true, issues: [], checkReceipts: [] };
    },
    corpus,
    MATCHING_TASKS,
    { brief: MATCHING_BRIEF, verifierLifetime: lifetime, lanes: 1 },
  );
  expect(calls).toBe(2);
  expect(result.claimable).toBe(false);
  expect(result.acceptsPassed).toBe(1);
  expect(result.controlReceipts.map((row) => [row.observedOutcome, row.nonResultKind])).toEqual([
    ["pass", null],
    ["non-result", "sandbox"],
    ["non-result", "verifier"],
  ]);
  expect(result.findings.some((row) => row.message.includes("cleanup is pending"))).toBe(true);
});

test("a live cascading rejection that includes the declared check is attributed; one that misses it is not", async () => {
  const cascade = await runControls(
    () => ({
      ok: false,
      checkReceipts: [],
      issues: [
        { checkId: "parts-assigned", message: "first" },
        { checkId: "expected-binding", message: "second" },
      ],
    }),
    { accept: [], reject: [MATCHING_REJECTS[0]!] },
    MATCHING_TASKS,
    { brief: MATCHING_BRIEF },
  );
  expect(cascade.rejectsFailed).toBe(1);
  expect(cascade.rejectsAttributed).toBe(1);
  // The cascade attributes, and the corpus's one reject never fails "parts-assigned" alone, so the
  // isolation gap is reported without refusing the candidate.
  expect(cascade.findings.map((row) => row.code)).toEqual(["DISCRIMINATION_CHECK_NOT_ISOLATED"]);
  expect(cascade.claimable).toBe(true);
  const alone = await runControls(
    () => ({
      ok: false,
      checkReceipts: [],
      issues: [{ checkId: "parts-assigned", message: "first" }],
    }),
    { accept: [], reject: [MATCHING_REJECTS[0]!] },
    MATCHING_TASKS,
    { brief: MATCHING_BRIEF },
  );
  expect(alone.rejectsAttributed).toBe(1);
  expect(alone.findings).toEqual([]);
  const elsewhere = await runControls(
    () => ({
      ok: false,
      checkReceipts: [],
      issues: [{ checkId: "expected-binding", message: "second" }],
    }),
    { accept: [], reject: [MATCHING_REJECTS[0]!] },
    MATCHING_TASKS,
    { brief: MATCHING_BRIEF },
  );
  expect(elsewhere.rejectsFailed).toBe(1);
  expect(elsewhere.rejectsAttributed).toBe(0);
  expect(elsewhere.findings.some((row) => row.code === "DISCRIMINATION_REJECT_PASSED")).toBe(true);
});

test("controls run in lanes and still settle in corpus order", async () => {
  const corpus = {
    accept: Array.from({ length: 6 }, (_, i) => ({ ...MATCHING_ACCEPTS[0]!, id: `lane-${i}` })),
    reject: [],
  };
  const evaluator = () => {
    let inFlight = 0;
    const peak = { value: 0 };
    const evaluate = async () => {
      inFlight++;
      peak.value = Math.max(peak.value, inFlight);
      await Bun.sleep(20);
      inFlight--;
      return { ok: true, issues: [], checkReceipts: [] };
    };
    return { evaluate, peak };
  };
  const laned = evaluator();
  const result = await runControls(laned.evaluate, corpus, MATCHING_TASKS, { brief: MATCHING_BRIEF });
  expect(laned.peak.value).toBeGreaterThan(1);
  expect(laned.peak.value).toBeLessThanOrEqual(4);
  const serial = evaluator();
  const one = await runControls(serial.evaluate, corpus, MATCHING_TASKS, { brief: MATCHING_BRIEF, lanes: 1 });
  expect(serial.peak.value).toBe(1);
  expect(result.controlReceipts.map((row) => row.controlId)).toEqual(
    corpus.accept.map((control) => control.id),
  );
  expect(one).toEqual(result);
});
