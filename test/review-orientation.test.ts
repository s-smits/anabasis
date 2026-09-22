/**
 * What the epoch reviewer is shown before it reads anything. The counts were always there; where
 * they land against the band the campaign climbs towards was not, so a battery eight passes above
 * the aim reached the one component that reads the measured tree against the original request as
 * a bare "20 of 25 verified cases passed". The placement arrived first, then the question it opens,
 * which is not the same question on the two sides of the aim and is no question at all on it.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { IterationAnalysis } from "../src/analyse/iteration-analysis.ts";
import type { RebuildAdvicePacket } from "../src/author/rebuild-advice.ts";
import { runEpochReview } from "../src/review/epoch-reviewer.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";
import { double } from "./helpers/doubles.ts";

const trees: string[] = [];
afterAll(() => {
  for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});

const review = {
  enabled: true,
  kind: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "low",
  source: "operator",
} as const;

function tree(): string {
  const dir = mkdtempSync(join(import.meta.dir, ".ana-scratch-review-orientation-"));
  trees.push(dir);
  uppercaseFixture(dir);
  return dir;
}

/** Run a review that reads nothing and returns the orientation it was handed. */
async function shown(
  analysis: IterationAnalysis | null,
  priorAdvice: RebuildAdvicePacket | null,
  priorAdviceOnSeededTree: boolean | null = null,
): Promise<string> {
  let prompt = "";
  await runEpochReview({
    repoRoot: tree(),
    slug: "orient",
    runId: "r1",
    treeRoot: ".",
    analysis,
    priorAdvice,
    priorAdviceOnSeededTree,
    publicRequest: "solves the domain",
    review,
    readerTurn: async (input) => {
      prompt = input.prompt;
      return { pin: null, text: "", error: null };
    },
  });
  return prompt;
}

/** A battery of `verified` scored cases, `passed` of them passing, in one family. */
function battery(passed: number, verified: number): IterationAnalysis {
  return double<IterationAnalysis>({
    identities: { bundleSnapshot: {}, backendPin: null },
    battery: { summary: { passed, verified, unaccepted: 0, nonResults: 0 } },
    cases: Array.from({ length: verified }, (_, index) => ({
      taskId: `t${String(index)}`,
      family: "core",
      truthOk: index < passed,
      pass: index < passed,
      submitted: true,
    })),
  });
}

function advice(passed: number, verified: number): RebuildAdvicePacket {
  return double<RebuildAdvicePacket>({
    runId: "prior-1",
    issues: [],
    families: [{ family: "core", verified, passed, unaccepted: 0, nonResults: 0 }],
  });
}

describe("the epoch reviewer's orientation", () => {
  it("places the measured battery against the aim it was climbing towards", async () => {
    // 20 of 25 is neither perfect nor near-perfect, which is all the prompt used to ask about, and
    // it is eight passes above the top of the aim: the zone whose own name says no limit was found.
    const prompt = await shown(battery(20, 25), null);
    expect(prompt).toContain("Battery: 20 of 25 verified cases passed");
    expect(prompt).toContain("Aim: 20 of 25 passed, 8 above the aim (the aim is 5 to 12 of 25)");
    expect(prompt).toContain("measured no limit of the product");
    expect(prompt).toContain("significantly too easy");
    // The placement opens the question; it is not the finding.
    expect(prompt).toContain("A placement above the aim is a lead, not a finding on its own");
    expect(prompt).not.toContain("hardness is the last of its readings");
  });

  it("says a battery on the aim measured the limit, and does not call it too easy", async () => {
    const prompt = await shown(battery(8, 25), null);
    expect(prompt).toContain("Aim: 8 of 25 passed, on the aim (the aim is 5 to 12 of 25)");
    expect(prompt).toContain("measured the product's limit on its current requirements");
    expect(prompt).not.toContain("too easy");
  });

  it("places a battery below the aim without calling it too hard", async () => {
    const prompt = await shown(battery(2, 25), null);
    expect(prompt).toContain("Aim: 2 of 25 passed, 3 short of the aim (the aim is 5 to 12 of 25)");
    expect(prompt).toContain("not significantly too hard");
  });

  /** The lead is the question the placement opens, and the two sides do not open the same one.
   *  Both sides used to receive the question written for the side above the aim: a review of a
   *  battery the solver could not reach was asked which obligation of the request its tasks do not
   *  demand. The two readings that produce a below-aim count without hard tasks are separable here
   *  and nowhere else, since the Builder never sees a verifier verdict. */
  for (const [zone, passed] of [
    ["under-aim", 2],
    ["too-hard", 0],
  ] as const) {
    it(`asks a ${zone} battery what else fails every task before it calls the tasks hard`, async () => {
      const prompt = await shown(battery(passed, 25), null);
      expect(prompt).toContain("A placement below the aim is a lead, not a finding on its own");
      expect(prompt).toContain("hardness is the last of its readings rather than the first");
      // Each reading names the routable owner that repairs it, and the instrument for the first.
      expect(prompt).toContain("rule the checks apply that the brief does not publish fails every task");
      expect(prompt).toContain("probe an accept control at a field the public contract leaves free");
      expect(prompt).toContain("owned by `brief`");
      expect(prompt).toContain("owned by `tools-spec`");
      // The question for the other side is the wrong one here.
      expect(prompt).not.toContain("the obligation of the request those tasks do not demand");
    });
  }

  it("opens no question for a battery on the aim, which measured what it was climbing towards", async () => {
    const prompt = await shown(battery(8, 25), null);
    expect(prompt).not.toContain("is a lead, not a finding on its own");
  });

  /** The reviewer reads one measured tree and knows nothing of the batteries before it, so it
   *  cannot say a battery that overshot is the first one to do so. It said "as a first battery
   *  should" of every battery in the zone; the author's note owns that reading, where the count of
   *  admitted batteries is. */
  it("calls an overshooting battery overshooting, without claiming it is the first", async () => {
    const prompt = await shown(battery(0, 25), null);
    expect(prompt).toContain("Aim: 0 of 25 passed, 5 short of the aim (the aim is 5 to 12 of 25)");
    expect(prompt).toContain("the battery overshot the solver");
    expect(prompt).toContain("has not eased to the aim");
    expect(prompt).not.toContain("as a first battery should");
  });

  it("refuses to place a battery too small to hold a whole count inside the band", async () => {
    // aimCounts(1, [0.2, 0.5]) is [1, 0]: every count of a one-case battery is off the aim in both
    // directions and none can be on it, so there is nothing to read and the review is told so.
    const prompt = await shown(battery(1, 1), null);
    expect(prompt).toContain("Aim: too few scored cases (1) to place this battery against the band");
    expect(prompt).not.toContain("above the aim");
  });

  it("places the previous battery for an authoring checkpoint, which has none of its own", async () => {
    const prompt = await shown(null, advice(6, 6), true);
    expect(prompt).toContain("Authoring checkpoint before measurement");
    expect(prompt).toContain("The previous battery of this product (prior-1)");
    expect(prompt).toContain("Aim: 6 of 6 passed, 3 above the aim (the aim is 2 to 3 of 6)");
    expect(prompt).toContain("measured no limit of the product");
  });

  /** de8b40's shape: i02 measured 22 of 25 across five families, its claim was refused for an
   *  identity the transport did not attest, so it was held and the next pass was seeded from i01 —
   *  six tasks in three families. The counts are still the campaign's evidence; the tree is not
   *  theirs. Told otherwise, the reviewer spent a finding on the contradiction. */
  it("says whose battery the counts are when the seeded tree is not the one they measured", async () => {
    const prompt = await shown(null, advice(6, 6), false);
    expect(prompt).toContain("A previous battery of this campaign (prior-1)");
    expect(prompt).toContain("Its candidate was not adopted");
    expect(prompt).toContain("the tree you are reading is not the one those counts measured");
    expect(prompt).toContain("expect no family they name to be present here");
    expect(prompt).not.toContain("battery of this product");
    // The counts and their placement still reach the review: a held candidate's battery is
    // evidence about the campaign, which is why the advice ledger advanced to it at all.
    expect(prompt).toContain("6 of 6 verified cases passed");
    expect(prompt).toContain("Aim: 6 of 6 passed, 3 above the aim (the aim is 2 to 3 of 6)");
  });

  /** A historical layout has no ledger and a campaign before its first selection has no row, so
   *  the ledger answers null. An unmade comparison must not read as a difference — nor as the
   *  sameness on the other side of it, which is the claim the null was there to withhold. */
  it("makes no claim either way when the ledger cannot say which version the counts measured", async () => {
    const prompt = await shown(null, advice(6, 6), null);
    expect(prompt).toContain("A previous battery of this campaign (prior-1)");
    expect(prompt).toContain("Which product version it measured is not recorded");
    expect(prompt).not.toContain("Its candidate was not adopted");
    expect(prompt).not.toContain("battery of this product");
    // The counts still reach the review; only the claim about whose tree they describe is held.
    expect(prompt).toContain("6 of 6 verified cases passed");
  });
});
