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
import { BEAMS, JOINTS, READING, issue } from "./helpers/review-fixtures.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { campaignDir, defaultProductDir } from "../src/meta/campaign-root.ts";
import { runEpochReview } from "../src/review/epoch-reviewer.ts";
import { EPOCH_REVIEW_SCHEMA } from "../src/review/epoch-review-findings.ts";
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
    // Requirements asked for one at a time are an undemanded obligation too, so that gap is reachable
    // from the lead rather than only the capability no task exercises.
    expect(prompt).toContain("do not demand, or demand only one at a time");
    // ADDED(easy-result): easy tasks are not offered as a result that closes the lead.
    expect(prompt).not.toMatch(/a result to report|easy while leaving none undemanded/);
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

  it("says a battery on the aim reached the calibration target, and still asks what failed it", async () => {
    const prompt = await shown(battery(8, 25));
    expect(prompt).toContain("passed 8 of 25 (Wilson interval");
    expect(prompt).toContain("aim 5 to 12 of 25): on the calibration target.");
    expect(prompt).not.toContain("too easy");
    // Its fails locate a limit only where the checks that failed it are right, so it opens the
    // question a battery below the aim opens.
    expect(prompt).toContain("A placement on or below the aim is a lead, not a finding on its own");
    expect(prompt).toContain("start from the first one listed");
  });

  /** The placement sentence is the author's own `readingSentence`, filled from the readout row, so the
   *  reviewer and the author cannot be told two different things about one battery. The lead is the
   *  question the placement opens, and the two sides do not open the same one.
   *  Both sides used to receive the question written for the side above the aim: a review of a
   *  battery the solver could not reach was asked which obligation of the request its tasks do not
   *  demand. The two readings that produce a below-aim count without hard tasks are separable here
   *  and nowhere else, since the Builder never sees a verifier verdict. */
  for (const [zone, passed, placement] of [
    ["under-aim", 2, "aim 5 to 12 of 25): in range, below the aim."],
    ["too-hard", 0, "band [0.2, 0.5], aim 5 to 12 of 25): significantly too hard."],
  ] as const) {
    it(`places a ${zone} battery and asks what else fails every task before it calls the tasks hard`, async () => {
      const prompt = await shown(battery(passed, 25));
      expect(prompt).toContain(`passed ${String(passed)} of 25 (Wilson interval`);
      expect(prompt).toContain(placement);
      expect(prompt).not.toContain("as a first battery should");
      expect(prompt).toContain("A placement on or below the aim is a lead, not a finding on its own");
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
      expect(prompt).not.toContain("which obligation of the request those tasks do not demand");
    });
  }

  it("refuses to place a battery too small to hold a whole count inside the band", async () => {
    // aimCounts(1, [0.2, 0.5]) is [1, 0]: every count of a one-case battery is off the aim in both
    // directions and none can be on it, so there is nothing to read and the review is told so.
    const prompt = await shown(battery(1, 1));
    expect(prompt).toContain("Reading: 1/1 against band [0.2, 0.5]: cannot be placed.");
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

describe("the diagnosed issues reach the reviewer", () => {
  async function oriented(input: { measured: boolean; issues?: AdviceIssue[] }): Promise<string> {
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
      publicRequest: "solves the domain",
      review,
      readerTurn: async (turn) => {
        prompt = turn.prompt;
        return { pin: null, text: "", error: null };
      },
    });
    return prompt;
  }

  it("carries each standing issue's diagnosis, cause included, and says when there is none", async () => {
    const diagnosed = issue({ diagnosis: READING });
    const bare = issue({ id: JOINTS, kind: "unaccepted", family: "joints" });
    const prompt = await oriented({ measured: true, issues: [diagnosed, bare] });
    expect(prompt).toContain(`${BEAMS.slice(0, 12)} (beams, verified-fail, 2/5)`);
    expect(prompt).toContain("agent/tools-spec.json. First failure boundary");
    expect(prompt).toContain(`Falsifier: ${READING.falsifier}`);
    expect(prompt).toContain(`Cause: ${READING.cause}`);
    expect(prompt).toContain(`${JOINTS.slice(0, 12)} (joints, unaccepted, 2/5): no diagnosis recorded`);
  });
});

/** An earlier review's task-set findings reach the next review while the task set is unchanged, and
 *  a battery above the aim owes its review nothing beyond the placement the orientation states. */
describe("what an unchanged task set and an above-aim placement ask of the review", () => {
  type Turn = Parameters<NonNullable<Parameters<typeof runEpochReview>[0]["readerTurn"]>>[0];
  const REQUEST = "designs roof trusses, checks geometric nonlinearity and reversing wind";

  async function reviewed(input: {
    counts: Counts;
    taskSetHash?: string;
    earlier?: { taskSetHash: string };
    turn?: (turn: Turn) => Promise<string>;
  }) {
    const root = tree();
    recordBattery(root, root, "r1", input.counts);
    if (input.earlier !== undefined) {
      const dir = join(campaignDir(root, SLUG), "analysis");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "r0-epoch-review.json"),
        JSON.stringify({
          schema: EPOCH_REVIEW_SCHEMA,
          runId: "r0",
          status: "completed",
          condition: { taskSetHash: input.earlier.taskSetHash },
          coverage: { complete: true },
          findings: [
            {
              defect: true,
              owner: "correctness-model/tasks.json",
              severity: "advisory",
              claim: "private reviewer prose about the siblings",
              evidence: "e",
              publicInputPath: "$.loads",
            },
          ],
          disputes: [],
          report: null,
        }),
      );
    }
    const analysis = analysisOf(input.counts);
    const snapshot = { ...keyIfDefined("taskSetHash", input.taskSetHash) };
    let prompt = "";
    const continued: string[] = [];
    const record = await runEpochReview({
      repoRoot: root,
      slug: SLUG,
      runId: "r1",
      treeRoot: ".",
      analysis: { ...analysis, identities: { ...analysis.identities, bundleSnapshot: double(snapshot) } },
      priorAdvice: null,
      publicRequest: REQUEST,
      review,
      readerTurn: async (turn) => {
        prompt = turn.prompt;
        const text = await (input.turn?.(turn) ?? Promise.resolve(""));
        const next = turn.continuePrompt?.() ?? null;
        if (next !== null) continued.push(next);
        return { pin: null, text, error: null };
      },
    });
    return { prompt, continued, record };
  }

  it("shows the earlier task-set finding in its public form when the task set is unchanged", async () => {
    const { prompt } = await reviewed({
      counts: { passed: 8, verified: 25 },
      taskSetHash: "tasks-a",
      earlier: { taskSetHash: "tasks-a" },
    });
    expect(prompt).toContain("Earlier reviews of this same task set");
    expect(prompt).toContain("- r0: Epoch review (correctness-model/tasks.json): public input `$.loads`");
    expect(prompt).not.toContain("private reviewer prose");
  });

  it("shows no earlier task-set finding once the task set has changed", async () => {
    const { prompt } = await reviewed({
      counts: { passed: 8, verified: 25 },
      taskSetHash: "tasks-b",
      earlier: { taskSetHash: "tasks-a" },
    });
    expect(prompt).not.toContain("Earlier reviews of this same task set");
    expect(prompt).not.toContain("$.loads");
  });

  /** A finding required by a high score, or an account the host checks by whether each family's name
   *  appears, rewards naming the right things rather than examining them. So a review that found
   *  nothing is recorded as it ended, and the request reaches it verbatim, never split at its commas
   *  and "and" into clauses owed back in a grammar. */
  it("lets an above-aim review end with nothing demonstrated, and asks it nothing more", async () => {
    const closing = "I found nothing demonstrated; the tasks were easy.";
    const { prompt, continued, record } = await reviewed({
      counts: { passed: 20, verified: 25 },
      turn: () => Promise.resolve(closing),
    });
    expect(continued).toEqual([]);
    expect(record.report).toBe(closing);
    expect(prompt).toContain(`Original request (verbatim): ${REQUEST}`);
    expect(prompt).not.toMatch(/clause/i);
  });
});
