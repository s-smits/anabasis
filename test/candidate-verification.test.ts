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

describe("publishesAdmissionPointer", () => {
  it("publishes whenever the packet already describes the adopted tree", () => {
    // A measured adopted tree (no candidate at all) and a promoted candidate are the same case: the
    // findings were measured on what is now installed.
    expect(publishesAdmissionPointer({ build: "adopted", decision: null, experiment: null })).toBe(true);
    expect(publishesAdmissionPointer({ build: "candidate", decision: "promoted", experiment: "build" })).toBe(
      true,
    );
  });

  it("records a held build candidate: its findings describe a tree that was never adopted", () => {
    expect(publishesAdmissionPointer({ build: "candidate", decision: "held", experiment: "build" })).toBe(
      false,
    );
    // No experiment named at all falls through the two exceptions to the same record.
    expect(publishesAdmissionPointer({ build: "candidate", decision: "held", experiment: null })).toBe(false);
  });

  it("publishes a held climb only when an admitted row blocks the fixed harness", () => {
    // A climb froze the harness, so its packet describes the adopted agent and evaluator. It is
    // worth publishing exactly when it carries a blocking row the next decision reads as the
    // evaluation correction.
    const climb = { build: "candidate", decision: "held", experiment: "climb" } as const;
    expect(publishesAdmissionPointer({ ...climb, blockingFeedback: true })).toBe(true);
    expect(publishesAdmissionPointer({ ...climb, blockingFeedback: false })).toBe(false);
    // Absent is not true: an unstated admission publishes nothing.
    expect(publishesAdmissionPointer(climb)).toBe(false);
  });

  it("publishes a held evaluation candidate only on a proved freeze", () => {
    // The freeze is what says the packet describes the adopted agent and battery. Unproved, the
    // candidate may have moved either, so the packet stays recorded under analysis/.
    const evaluation = { build: "candidate", decision: "held", experiment: "evaluation" } as const;
    expect(publishesAdmissionPointer({ ...evaluation, freeze: HELD })).toBe(true);
    expect(publishesAdmissionPointer({ ...evaluation, freeze: UNPROVEN })).toBe(false);
    expect(publishesAdmissionPointer({ ...evaluation, freeze: null })).toBe(false);
    expect(publishesAdmissionPointer(evaluation)).toBe(false);
  });

  it("keeps the adopted admission when a held packet's evaluation identity moved", () => {
    // readAdmission reads such a packet as lineage; publishing it would leave no admission at all.
    const held = { build: "candidate", decision: "held", observedOnAdopted: false } as const;
    expect(publishesAdmissionPointer({ ...held, experiment: "evaluation", freeze: HELD })).toBe(false);
    expect(publishesAdmissionPointer({ ...held, experiment: "climb", blockingFeedback: true })).toBe(false);
    expect(
      publishesAdmissionPointer({ ...held, experiment: "evaluation", freeze: HELD, observedOnAdopted: true }),
    ).toBe(true);
    // A promoted candidate becomes the adopted tree, so its packet still publishes.
    expect(publishesAdmissionPointer({ ...held, decision: "promoted", experiment: "evaluation" })).toBe(true);
  });

  it("does not cross the two exceptions: a climb's blocking row cannot publish an evaluation hold", () => {
    // Each exception reads its own field. A held evaluation candidate with a blocking row and
    // no proved freeze still records, and a held climb with a proved freeze still records.
    expect(
      publishesAdmissionPointer({
        build: "candidate",
        decision: "held",
        experiment: "evaluation",
        blockingFeedback: true,
      }),
    ).toBe(false);
    expect(
      publishesAdmissionPointer({ build: "candidate", decision: "held", experiment: "climb", freeze: HELD }),
    ).toBe(false);
  });
});

const row = (over: Partial<CampaignFeedback>): CampaignFeedback => ({
  owner: "correctness-model",
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
    const shipping = shippingBundleFor({ measureDir }, { runId: "r1", claim });
    expect(shipping.expected).toBeNull();
    expect(shipping.error).not.toBeNull();
  });
});
