/**
 * What the epoch reviewer is shown before it reads anything. The counts were always there; where
 * they land against the band the campaign climbs towards was not, so a battery eight passes above
 * the aim reached the one component that reads the measured tree against the original request as
 * a bare "20 of 25 verified cases passed". The placement arrived first, then the question it opens,
 * which is not the same question on the two sides of the aim and is no question at all on it.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { IterationAnalysis } from "../src/analyse/iteration-analysis.ts";
import type { AdviceIssue, RebuildAdvicePacket } from "../src/author/rebuild-advice.ts";
import type { ExperimentSubmission } from "../src/author/experiment-plan.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { BEAMS, JOINTS, READING, issue } from "./helpers/review-fixtures.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { campaignDir, defaultProductDir } from "../src/meta/campaign-root.ts";
import { runEpochReview } from "../src/review/epoch-reviewer.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";
import { double } from "./helpers/doubles.ts";
import { fixtureThresholdDigest, writeFixtureThresholds } from "./helpers/thresholds.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SLUG = "orient";
const PIN = "test/pin";

/** What one battery recorded: `passed` of `verified` accepted cases, `unaccepted` refused ones, and
 *  the changed subset the runner declared, when it declared one. */
type Counts = {
  passed: number;
  verified: number;
  unaccepted?: number;
  changed?: { passes: number; attempts: number };
};

/** The reviewer's subject: this battery's own analysis, or the prior packet at a checkpoint. */
type Subject = { kind: "measured"; counts: Counts } | { kind: "checkpoint"; counts: Counts };

afterAll(cleanupScratch);

const review = {
  enabled: true,
  kind: "codex",
  model: "gpt-6-astra",
  reasoningEffort: "low",
  source: "operator",
} as const;

function tree(): string {
  const dir = scratchDir(".ana-scratch-review-orientation-", import.meta.dir);
  uppercaseFixture(dir);
  return dir;
}

const battery = (
  passed: number,
  verified: number,
  extra: Omit<Counts, "passed" | "verified"> = {},
): Subject => ({
  kind: "measured",
  counts: { passed, verified, ...extra },
});
const advice = (passed: number, verified: number): Subject => ({
  kind: "checkpoint",
  counts: { passed, verified },
});

/** Record one battery the way the runner does, with the accepted claim that admits it, so the
 *  climb readout the author reads can place it. */
function recordBattery(root: string, productDir: string, runId: string, counts: Counts): void {
  writeFixtureThresholds(root);
  const { passed, verified, unaccepted = 0, changed } = counts;
  const evidence = new EvidenceLog(join(productDir, "runs", runId));
  evidence.write("battery.json", {
    runId,
    backendPin: PIN,
    thresholdManifestDigest: fixtureThresholdDigest(root),
    condition: { variant: "shipping" },
    bundleSnapshot: { agentHash: "agent-a", correctnessModelHash: "correctnessModel-a" },
    execution: { tools: {}, verifierEnvironmentHash: null },
    cases: [
      ...Array.from({ length: verified }, (_, i) => ({
        taskId: `t${String(i)}`,
        pass: i < passed,
        acceptedSubmit: true,
      })),
      ...Array.from({ length: unaccepted }, (_, i) => ({
        taskId: `u${String(i)}`,
        pass: false,
        acceptedSubmit: false,
      })),
    ],
    measured: { items: [], ...keyIfDefined("changedSubset", changed) },
  });
  evidence.record();
  const claims = join(campaignDir(root, SLUG), "claims");
  mkdirSync(claims, { recursive: true });
  writeFileSync(
    join(claims, `${runId}.json`),
    JSON.stringify({
      schema: "run-claim/v1",
      runId,
      createdAt: "2026-01-01T00:00:00.000Z",
      claim: { ok: true },
    }),
  );
}

function analysisOf({ passed, verified, unaccepted = 0 }: Counts): IterationAnalysis {
  const row = (taskId: string, pass: boolean, acceptedSubmit: boolean) => ({
    taskId,
    family: "core",
    truthOk: acceptedSubmit ? pass : null,
    pass,
    acceptedSubmit,
    runtimeNonResult: null,
  });
  return double<IterationAnalysis>({
    identities: { bundleSnapshot: {}, backendPin: PIN },
    battery: {
      summary: { passed, verified, unaccepted, nonResults: 0 },
      blockingByCheck: { "span-limit": verified - passed, "weld-rule": 0 },
      applicableByCheck: { "span-limit": verified, "weld-rule": verified },
    },
    cases: [
      ...Array.from({ length: verified }, (_, i) => row(`t${String(i)}`, i < passed, true)),
      ...Array.from({ length: unaccepted }, (_, i) => row(`u${String(i)}`, false, false)),
    ],
  });
}

function adviceOf({ passed, verified }: Counts): RebuildAdvicePacket {
  return double<RebuildAdvicePacket>({
    runId: "prior-1",
    backendPin: PIN,
    issues: [],
    families: [{ family: "core", verified, passed, unaccepted: 0, nonResults: 0 }],
  });
}

/** Run a review that reads nothing and returns the orientation it was handed. A measured battery
 *  is recorded under the tree it measured; a checkpoint's prior battery under the selected product,
 *  which with no controller ledger is the default product tree. `recorded: false` leaves the
 *  readout with nothing to read. */
async function shown(
  subject: Subject,
  priorAdviceOnSeededTree: boolean | null = null,
  recorded = true,
): Promise<string> {
  const root = tree();
  const measured = subject.kind === "measured";
  if (recorded) {
    recordBattery(
      root,
      measured ? root : defaultProductDir(root, SLUG),
      measured ? "r1" : "prior-1",
      subject.counts,
    );
  }
  let prompt = "";
  await runEpochReview({
    repoRoot: root,
    slug: SLUG,
    runId: "r1",
    treeRoot: ".",
    analysis: measured ? analysisOf(subject.counts) : null,
    priorAdvice: measured ? null : adviceOf(subject.counts),
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

describe("the epoch reviewer's orientation", () => {
  it("places the measured battery against the aim it was climbing towards", async () => {
    // 20 of 25 is neither perfect nor near-perfect, which is all the prompt used to ask about, and
    // it is eight passes above the top of the aim: the zone whose own name says no limit was found.
    const prompt = await shown(battery(20, 25));
    expect(prompt).toContain("Battery: 20 of 25 verified cases passed");
    expect(prompt).toContain("Reading: the deciding sample (whole-battery) passed 20 of 25 (Wilson interval");
    expect(prompt).toContain("aim 5 to 12 of 25): significantly too easy.");
    // The placement opens the question; it is not the finding.
    expect(prompt).toContain("A placement above the aim is a lead, not a finding on its own");
    expect(prompt).not.toContain("hardness is the last of its readings");
    // The first-probe pointer belongs to the side below the aim, and the static prompt no longer
    // carries it to every review.
    expect(prompt).not.toContain("start from the first one listed");
    expect(prompt).not.toContain("blocked the most verified cases");
    // The same per-check counts the author's advice packet carries, so a probe can start at the
    // check that refused the most.
    expect(prompt).toContain(
      "Verified failures by declared check (5 failed; a case may block on several): span-limit 5.",
    );
    expect(prompt).toContain(
      "blocked no shipping artifact, with the verified cases each applied to (of 25): weld-rule 25.",
    );
  });

  it("says a battery on the aim reached the calibration target, and does not call it too easy", async () => {
    const prompt = await shown(battery(8, 25));
    expect(prompt).toContain("passed 8 of 25 (Wilson interval");
    expect(prompt).toContain("aim 5 to 12 of 25): on the calibration target.");
    expect(prompt).not.toContain("too easy");
    // On the aim the battery reached what it was climbing towards, so no question opens.
    expect(prompt).not.toContain("is a lead, not a finding on its own");
    expect(prompt).not.toContain("start from the first one listed");
  });

  /** The placement sentence is the author's own `FRAME` line, filled from the readout row, so the
   *  reviewer and the author cannot be told two different things about one battery. The lead is the
   *  question the placement opens, and the two sides do not open the same one.
   *  Both sides used to receive the question written for the side above the aim: a review of a
   *  battery the solver could not reach was asked which obligation of the request its tasks do not
   *  demand. The two readings that produce a below-aim count without hard tasks are separable here
   *  and nowhere else, since the Builder never sees a verifier verdict. */
  for (const [zone, passed, placement] of [
    ["under-aim", 2, "aim 5 to 12 of 25): in range, below the aim."],
    ["too-hard", 0, "target range [0.2, 0.5], aim 5 to 12 of 25): significantly too hard."],
  ] as const) {
    it(`places a ${zone} battery and asks what else fails every task before it calls the tasks hard`, async () => {
      const prompt = await shown(battery(passed, 25));
      expect(prompt).toContain(`passed ${String(passed)} of 25 (Wilson interval`);
      expect(prompt).toContain(placement);
      expect(prompt).not.toContain("as a first battery should");
      expect(prompt).toContain("A placement below the aim is a lead, not a finding on its own");
      expect(prompt).toContain("hardness is the last of its readings rather than the first");
      // Each reading names the routable owner that repairs it, and the instrument for the first.
      expect(prompt).toContain("rule the checks apply that the brief does not publish fails every task");
      expect(prompt).toContain("probe an accept control at a field the public contract leaves free");
      expect(prompt).toContain("owned by `correctness-model/brief.json`");
      expect(prompt).toContain("owned by `agent/tools-spec.json`");
      // The first probe goes to the check listed first, and that list is in the same orientation.
      expect(prompt).toContain(
        "Where the verified failures are listed by declared check, start from the first one listed",
      );
      expect(prompt).toContain("Verified failures by declared check (");
      // The question for the other side is the wrong one here.
      expect(prompt).not.toContain("the obligation of the request those tasks do not demand");
    });
  }

  it("refuses to place a battery too small to hold a whole count inside the band", async () => {
    // aimCounts(1, [0.2, 0.5]) is [1, 0]: every count of a one-case battery is off the aim in both
    // directions and none can be on it, so there is nothing to read and the review is told so.
    const prompt = await shown(battery(1, 1));
    expect(prompt).toContain("Reading: the deciding sample of 1/1 cannot be placed");
    expect(prompt).not.toContain("above the aim");
  });

  /** The placement is the climb readout's, not a second one computed here. Refused attempts stay
   *  in the difficulty denominator once any case is verified, so six passes among six verified and
   *  nineteen refused is six of twenty-five — on the aim for the author. Placed over the verified
   *  cases alone it read as six of six, significantly too easy, in the one prompt that decides
   *  whether the evaluation is too lenient. */
  it("keeps refused attempts in the denominator, as the readout the author reads does", async () => {
    const prompt = await shown(battery(6, 6, { unaccepted: 19 }));
    expect(prompt).toContain("Battery: 6 of 6 verified cases passed; 19 unaccepted at submission");
    expect(prompt).toContain("passed 6 of 25 (Wilson interval");
    expect(prompt).toContain("aim 5 to 12 of 25): on the calibration target.");
    expect(prompt).not.toContain("above the aim");
    expect(prompt).not.toContain("too easy");
  });

  it("reads a recorded changed subset where the readout does, not the whole battery", async () => {
    const prompt = await shown(battery(20, 25, { changed: { passes: 1, attempts: 5 } }));
    expect(prompt).toContain("the deciding sample (changed-subset) passed 1 of 5 (Wilson interval");
    expect(prompt).toContain("): on the calibration target.");
    expect(prompt).not.toContain("significantly too easy");
  });

  it("places nothing when the readout holds no row for the battery", async () => {
    const prompt = await shown(battery(20, 25), null, false);
    expect(prompt).toContain("Aim: the climb readout holds no row for this battery");
    expect(prompt).not.toContain("above the aim");
  });

  it("places the previous battery for an authoring checkpoint, which has none of its own", async () => {
    const prompt = await shown(advice(6, 6), true);
    expect(prompt).toContain("Authoring checkpoint before measurement");
    expect(prompt).toContain("The previous battery of this product (prior-1)");
    expect(prompt).toContain("passed 6 of 6 (Wilson interval [0.610, 1.000]");
    expect(prompt).toContain("aim 2 to 3 of 6): significantly too easy.");
  });

  /** de8b40's shape: i02 measured 22 of 25 across five families, its claim was refused for an
   *  identity the transport did not attest, so it was held and the next pass was seeded from i01 —
   *  six tasks in three families. The counts are still the campaign's evidence; the tree is not
   *  theirs. Told otherwise, the reviewer spent a finding on the contradiction. */
  it("says whose battery the counts are when the seeded tree is not the one they measured", async () => {
    const prompt = await shown(advice(6, 6), false);
    expect(prompt).toContain("A previous battery of this campaign (prior-1)");
    expect(prompt).toContain("Its candidate was not adopted");
    expect(prompt).toContain("the tree you are reading is not the one those counts measured");
    expect(prompt).toContain("expect no family they name to be present here");
    expect(prompt).not.toContain("battery of this product");
    // The counts and their placement still reach the review: a held candidate's battery is
    // evidence about the campaign, which is why the advice ledger advanced to it at all.
    expect(prompt).toContain("6 of 6 verified cases passed");
    expect(prompt).toContain("aim 2 to 3 of 6): significantly too easy.");
  });

  /** A historical layout has no ledger and a campaign before its first selection has no row, so
   *  the ledger answers null. An unmade comparison must not read as a difference — nor as the
   *  sameness on the other side of it, which is the claim the null was there to withhold. */
  it("makes no claim either way when the ledger cannot say which version the counts measured", async () => {
    const prompt = await shown(advice(6, 6), null);
    expect(prompt).toContain("A previous battery of this campaign (prior-1)");
    expect(prompt).toContain("Which product version it measured is not recorded");
    expect(prompt).not.toContain("Its candidate was not adopted");
    expect(prompt).not.toContain("battery of this product");
    // The counts still reach the review; only the claim about whose tree they describe is held.
    expect(prompt).toContain("6 of 6 verified cases passed");
  });
});

/**
 * The round's own intent beside what it measured. The Builder writes `EXPERIMENT.json` before a
 * round is measured — the gap it saw, the change it made, the result it expected, a pass-count
 * target and a pass probability per task — and until now nothing that reads the measured tree was
 * shown it. A reviewer of a battery that passed five of five could not tell that the round had
 * predicted one or two, which is the contradiction that makes the battery worth reading.
 */
describe("the round plan and the diagnosed issues reach the reviewer", () => {
  const plan: ExperimentSubmission = (() => {
    const body = {
      schema: "experiment-plan/v2" as const,
      scope: "tasks" as const,
      gap: "The last battery found no limit: every family cleared its published limit.",
      change: "Tighten the deflection limit and couple it to the published load case.",
      expectedResult: "One or two of five verified cases pass.",
      target: { comparator: "at-most" as const, verifiedPasses: 2 },
      families: [{ family: "core", level: "hard" as const, move: "Couple deflection to the load case." }],
      predictions: Array.from({ length: 5 }, (_, i) => ({ taskId: `t${String(i)}`, pass: 0.3 })),
    };
    return { ...body, digest: hashJsonValue(body) };
  })();

  async function oriented(input: {
    measured: boolean;
    experiment: ExperimentSubmission | null;
    issues?: AdviceIssue[];
  }): Promise<string> {
    const root = tree();
    const counts = { passed: 5, verified: 5 };
    recordBattery(
      root,
      input.measured ? root : defaultProductDir(root, SLUG),
      input.measured ? "r1" : "prior-1",
      counts,
    );
    // A checkpoint reads the prior battery's packet; a measured battery with no issues reads none.
    const packet = input.measured ? null : adviceOf(counts);
    let prompt = "";
    await runEpochReview({
      repoRoot: root,
      slug: SLUG,
      runId: "r1",
      treeRoot: ".",
      analysis: input.measured ? analysisOf(counts) : null,
      priorAdvice: input.issues === undefined ? packet : { ...adviceOf(counts), issues: input.issues },
      experiment: input.experiment,
      publicRequest: "solves the domain",
      review,
      readerTurn: async (turn) => {
        prompt = turn.prompt;
        return { pin: null, text: "", error: null };
      },
    });
    return prompt;
  }

  it("sets a measured battery beside the plan that predicted it", async () => {
    const prompt = await oriented({ measured: true, experiment: plan });
    expect(prompt).toContain("Round plan (EXPERIMENT.json, tasks scope)");
    expect(prompt).toContain(`Gap: ${plan.gap}`);
    expect(prompt).toContain(`Change: ${plan.change}`);
    expect(prompt).toContain(`Expected result: ${plan.expectedResult}`);
    expect(prompt).toContain(
      "Target: at most 2 verified passes; this battery passed 5, so the target was missed.",
    );
    expect(prompt).toContain("Families: core at hard — Couple deflection to the load case.");
    expect(prompt).toContain("Predictions: 5 tasks summing to 1.5 expected passes");
    expect(prompt).toContain("scored against the 5 predicted tasks that reached a verdict");
    expect(prompt).toContain("5 passed where 1.5 were expected (Brier 0.49");
  });

  it("names one predicted task in the singular", async () => {
    const one = { ...plan, predictions: [{ taskId: "t0", pass: 0.3 }] };
    const prompt = await oriented({ measured: true, experiment: one });
    expect(prompt).toContain("Predictions: 1 task summing to 0.3 expected passes");
    expect(prompt).toContain("scored against the 1 predicted task that reached a verdict");
  });

  it("states a missing plan as missing rather than showing nothing", async () => {
    const prompt = await oriented({ measured: true, experiment: null });
    expect(prompt).toContain("Round plan: no EXPERIMENT.json was recorded with this battery");
    expect(prompt).not.toContain("Target:");
  });

  it("shows a checkpoint the plan it is authoring towards, with nothing measured against it", async () => {
    const prompt = await oriented({ measured: false, experiment: plan });
    expect(prompt).toContain("Round plan (EXPERIMENT.json, tasks scope)");
    expect(prompt).toContain("Target: at most 2 verified passes.");
    expect(prompt).not.toContain("so the target was");
    expect(prompt).not.toContain("were expected (Brier");
    const unwritten = await oriented({ measured: false, experiment: null });
    expect(unwritten).toContain("Round plan: the Builder has not yet written an EXPERIMENT.json");
  });

  it("carries each standing issue's diagnosis, cause included, and says when there is none", async () => {
    const diagnosed = issue({ diagnosis: READING });
    const bare = issue({ id: JOINTS, kind: "unaccepted", family: "joints" });
    const prompt = await oriented({ measured: true, experiment: plan, issues: [diagnosed, bare] });
    expect(prompt).toContain(`${BEAMS.slice(0, 12)} (beams, verified-fail, 2/5)`);
    expect(prompt).toContain("agent/tools-spec.json. First failure boundary");
    expect(prompt).toContain(`Falsifier: ${READING.falsifier}`);
    expect(prompt).toContain(`Cause: ${READING.cause}`);
    expect(prompt).toContain(`${JOINTS.slice(0, 12)} (joints, unaccepted, 2/5): no diagnosis recorded`);
  });
});
