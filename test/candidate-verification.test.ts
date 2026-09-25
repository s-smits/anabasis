/**
 * The two publication predicates in candidate-verification.ts. A round's admission packet
 * describes the tree its findings were measured on, so it becomes `latest-admission.json` only
 * when that tree is the adopted one — or under the two fixed-harness exceptions, where the
 * packet describes an adopted harness the candidate left unchanged.
 *
 * Both predicates are pure. Each case pairs an input that updates the latest-admission pointer
 * with a nearby input whose findings remain recorded only under the round's analysis directory.
 * The last block covers the measured bundle identity promotion compares the candidate against.
 */
import { describe, expect, it } from "bun:test";
import type { CampaignFeedback } from "../src/author/campaign-types.ts";
import {
  blocksReplacement,
  publishesAdmissionPointer,
  shippingBundleFor,
} from "../src/run/candidate-verification.ts";
import type { WrittenRunClaim } from "../src/run/claim-write.ts";
import type { ExperimentFreeze } from "../src/run/experiment-freeze.ts";
import { double } from "./helpers/doubles.ts";

const HELD: ExperimentFreeze = { state: "held", clauses: [] };
const UNPROVEN: ExperimentFreeze = {
  state: "unproven",
  clauses: ["evaluation-harness-unverifiable: agent: slug has no agent/ bundle"],
};

type PointerInput = Parameters<typeof publishesAdmissionPointer>[0];
const heldAs = (experiment: "build" | "climb" | "evaluation" | null) =>
  ({ build: "candidate", decision: "held", experiment }) as const;

describe("publishesAdmissionPointer", () => {
  // Each published row is paired with the nearest input whose findings stay recorded only under
  // the round's analysis directory.
  it.each<[string, PointerInput, boolean]>([
    ["a measured adopted tree", { build: "adopted", decision: null, experiment: null }, true],
    ["a promoted candidate", { build: "candidate", decision: "promoted", experiment: "build" }, true],
    ["a held build candidate, whose tree was never adopted", heldAs("build"), false],
    ["a held candidate naming no experiment", heldAs(null), false],
    // A climb froze the harness, so its packet describes the adopted agent and evaluator.
    ["a held climb carrying a blocking row", { ...heldAs("climb"), blockingFeedback: true }, true],
    ["a held climb with no blocking row", { ...heldAs("climb"), blockingFeedback: false }, false],
    ["a held climb whose admission is unstated", heldAs("climb"), false],
    // The freeze is what says the packet describes the adopted agent and battery.
    ["a held evaluation on a proved freeze", { ...heldAs("evaluation"), freeze: HELD }, true],
    ["a held evaluation on an unproven freeze", { ...heldAs("evaluation"), freeze: UNPROVEN }, false],
    ["a held evaluation with a null freeze", { ...heldAs("evaluation"), freeze: null }, false],
    ["a held evaluation with no freeze", heldAs("evaluation"), false],
    // readAdmission reads a packet whose evaluation identity moved as lineage.
    [
      "a proved evaluation hold whose identity moved",
      { ...heldAs("evaluation"), freeze: HELD, observedOnAdopted: false },
      false,
    ],
    [
      "a blocking climb hold whose identity moved",
      { ...heldAs("climb"), blockingFeedback: true, observedOnAdopted: false },
      false,
    ],
    [
      "a proved evaluation hold observed on the adopted tree",
      { ...heldAs("evaluation"), freeze: HELD, observedOnAdopted: true },
      true,
    ],
    [
      "a promoted candidate whose identity moved",
      { ...heldAs("evaluation"), decision: "promoted", observedOnAdopted: false },
      true,
    ],
    // Each exception reads its own field and never the other's.
    [
      "an evaluation hold carrying only a blocking row",
      { ...heldAs("evaluation"), blockingFeedback: true },
      false,
    ],
    ["a climb hold carrying only a proved freeze", { ...heldAs("climb"), freeze: HELD }, false],
  ])("%s publishes: %p", (_label, input, publishes) => {
    expect(publishesAdmissionPointer(input)).toBe(publishes);
  });
});

const row = (over: Partial<CampaignFeedback>): CampaignFeedback => ({
  owner: "correctness-model/evaluator.ts",
  severity: "blocking",
  claim: "the census disagreed with the verifier on enough verified cases",
  evidence: "campaigns/bridge-truss/analysis/r1.json (analysis 0123456789ab)",
  findings: [],
  ...over,
});

describe("blocksReplacement", () => {
  it("blocks on any admitted blocking row, not only the Judge's dispute", () => {
    // The Judge's dispute is one such row.
    expect(blocksReplacement([row({})])).toBe(true);
    // A host harness-defect is another. Reading only the Judge left the unbound-external-result
    // finding recorded on disk and never read, and the next selector climbed again on a harness
    // whose checker admits ungrounded verdicts.
    expect(blocksReplacement([row({ claim: "run r1 recorded 3 unbound-external-result finding(s)" })])).toBe(
      true,
    );
    // It only takes one, among rows that hold nothing.
    expect(blocksReplacement([row({ severity: "advisory" }), row({})])).toBe(true);
  });

  it("does not block on advisory rows alone or on an empty packet", () => {
    // Routing already dropped every row with no writable owner, so severity is the whole test.
    expect(blocksReplacement([row({ severity: "advisory" })])).toBe(false);
    expect(blocksReplacement([])).toBe(false);
  });
});

describe("shippingBundleFor", () => {
  const measureDir = "/nonexistent-measure-dir";

  it("names no identity for a battery that recorded no claim", () => {
    expect(shippingBundleFor({ measureDir }, { runId: "r1", claim: null })).toEqual({
      expected: null,
      error: null,
    });
  });

  it("holds a claim whose battery no longer verifies instead of comparing the candidate with itself", () => {
    const claim = double<WrittenRunClaim>({ batteryRecorded: false });
    expect(shippingBundleFor({ measureDir }, { runId: "r1", claim })).toEqual({
      expected: null,
      error: "the battery's recorded evidence does not verify",
    });
  });

  it("holds a recorded battery whose bundle cannot be read", () => {
    const claim = double<WrittenRunClaim>({ batteryRecorded: true });
    expect(shippingBundleFor({ measureDir }, { runId: "r1", claim })).toEqual({
      expected: null,
      error: expect.stringContaining(measureDir),
    });
  });
});
