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
import { NO_PLAN, type RecordedPlan, type RoundPlan } from "../src/author/experiment-plan.ts";
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

/**
 * The round's own intent beside what it measured. The Builder may write `EXPERIMENT.json` before a
 * round is measured: the gap it saw, the change it made, the families it changed and the verified
 * passes it expects. The reviewer reads it with its two scores, the declared families against the
 * families whose public tasks changed and the pass range against the measured battery, so that a
 * battery which passed five of five is read beside what the round set out to change.
 */
describe("the round plan and the diagnosed issues reach the reviewer", () => {
  const plan: RecordedPlan = (() => {
    const body = {
      gap: "The last battery found no limit: every family cleared its published limit.",
      change: "Tighten the deflection limit and couple it to the published load case.",
      families: ["core"],
      expectedPasses: { atMost: 2 },
    };
    return { ...body, digest: hashJsonValue(body) };
  })();

  async function oriented(input: {
    measured: boolean;
    roundPlan: RoundPlan;
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
      roundPlan: input.roundPlan,
      publicRequest: "solves the domain",
      review,
      readerTurn: async (turn) => {
        prompt = turn.prompt;
        return { pin: null, text: "", error: null };
      },
    });
    return prompt;
  }

  it("sets a measured battery beside the plan it was authored under, with both scores", async () => {
    const prompt = await oriented({ measured: true, roundPlan: { plan, changedFamilies: ["core"] } });
    expect(prompt).toContain("Round plan (EXPERIMENT.json), the Builder's stated intent for this round:");
    expect(prompt).toContain(`Gap: ${plan.gap}`);
    expect(prompt).toContain(`Change: ${plan.change}`);
    expect(prompt).toContain(
      "Scored: the plan names core as changed and the public tasks changed from the adopted product in core: met; " +
        "the plan expects at most 2 verified passes and the battery holds 5: missed, above.",
    );
    // Each stated field is shown once, inside the score that reads it.
    expect(prompt).not.toMatch(/Families named as changed|Expected verified passes/);
  });

  it("lists the named families alone when there is no adopted product to score them against", async () => {
    const prompt = await oriented({ measured: true, roundPlan: { plan, changedFamilies: null } });
    expect(prompt).toContain("Families named as changed: core");
    expect(prompt).toContain(
      "Scored: the plan expects at most 2 verified passes and the battery holds 5: missed, above.",
    );
  });

  it("states a missing plan as missing rather than showing nothing", async () => {
    const prompt = await oriented({ measured: true, roundPlan: NO_PLAN });
    expect(prompt).toContain("Round plan: no EXPERIMENT.json was recorded with this battery");
    expect(prompt).not.toContain("Scored:");
  });

  it("shows a checkpoint the range it is authoring towards and the families its draft has changed", async () => {
    const prompt = await oriented({
      measured: false,
      roundPlan: { plan, changedFamilies: ["core", "joints"] },
    });
    expect(prompt).toContain("Expected verified passes: at most 2");
    expect(prompt).toContain(
      "Scored: the plan names core as changed and the public tasks changed from the adopted product in core, joints: " +
        "missed, joints changed but not named.",
    );
    const unwritten = await oriented({ measured: false, roundPlan: NO_PLAN });
    expect(unwritten).toContain("Round plan: the Builder has not yet written an EXPERIMENT.json");
  });

  it("carries each standing issue's diagnosis, cause included, and says when there is none", async () => {
    const diagnosed = issue({ diagnosis: READING });
    const bare = issue({ id: JOINTS, kind: "unaccepted", family: "joints" });
    const prompt = await oriented({
      measured: true,
      roundPlan: { plan, changedFamilies: ["core"] },
      issues: [diagnosed, bare],
    });
    expect(prompt).toContain(`${BEAMS.slice(0, 12)} (beams, verified-fail, 2/5)`);
    expect(prompt).toContain("agent/tools-spec.json. First failure boundary");
    expect(prompt).toContain(`Falsifier: ${READING.falsifier}`);
    expect(prompt).toContain(`Cause: ${READING.cause}`);
    expect(prompt).toContain(`${JOINTS.slice(0, 12)} (joints, unaccepted, 2/5): no diagnosis recorded`);
  });
});

/** An earlier review's task-set findings reach the next review while the task set is unchanged, and
 *  a battery above the aim owes its review one of two endings, which the host asks for once. */
describe("what an unchanged task set and an above-aim placement ask of the review", () => {
  type Turn = Parameters<NonNullable<Parameters<typeof runEpochReview>[0]["readerTurn"]>>[0];
  // The one clause of "solves the domain", disposed of, so that a test about another duty is not
  // also answering the request-clause duty.
  const DISPOSED = "\nClause 1: answer; decides: yes, every task.";

  async function reviewed(input: {
    counts: Counts;
    taskSetHash?: string;
    earlier?: { taskSetHash: string };
    turn?: (turn: Turn) => Promise<string>;
    publicRequest?: string;
    disposal?: string;
  }) {
    const root = tree();
    recordBattery(root, root, "r1", input.counts);
    if (input.earlier !== undefined) {
      const dir = join(campaignDir(root, SLUG), "analysis");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "r0-epoch-review.json"),
        JSON.stringify({
          schema: "epoch-review/v5",
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
      publicRequest: input.publicRequest ?? "solves the domain",
      review,
      readerTurn: async (turn) => {
        prompt = turn.prompt;
        const first = (await (input.turn?.(turn) ?? Promise.resolve(""))) + (input.disposal ?? DISPOSED);
        const next = turn.continuePrompt?.(first) ?? null;
        if (next === null) return { pin: null, text: first, error: null };
        continued.push(next);
        const last = `core demands the load coupling, and nothing is left undemanded.${input.disposal ?? DISPOSED}`;
        expect(turn.continuePrompt?.(last) ?? null).toBeNull();
        return { pin: null, text: last, error: null };
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

  it("asks an above-aim review once for its account and records the account the restatement drew", async () => {
    const { continued, record } = await reviewed({
      counts: { passed: 20, verified: 25 },
      turn: () => Promise.resolve("I found nothing demonstrated."),
    });
    expect(continued).toHaveLength(1);
    expect(continued[0]).toContain("for each family (core)");
    // The fake answered the restatement by naming the family, which is the account.
    expect(record.aboveAimDuty).toBe("accounted");
    expect(record.report).toContain("core demands the load coupling");
  });

  it("records an account given in the first closing message without asking again", async () => {
    const { continued, record } = await reviewed({
      counts: { passed: 20, verified: 25 },
      turn: () => Promise.resolve("Family core demands the published load coupling."),
    });
    expect(continued).toHaveLength(0);
    expect(record.aboveAimDuty).toBe("accounted");
  });

  it("records a task-set defect as the finding that discharges the duty", async () => {
    const { continued, record } = await reviewed({
      counts: { passed: 20, verified: 25 },
      turn: async (turn) => {
        const tool = turn.tools.find((row) => row.name === "record_finding");
        await tool?.execute(
          "c1",
          double({
            defect: true,
            owner: "correctness-model/tasks.json",
            severity: "advisory",
            claim: "the siblings differ only in their published values",
            publicInputPath: "$.loads",
          }),
        );
        return "Recorded one task-set defect.";
      },
    });
    expect(continued).toHaveLength(0);
    expect(record.aboveAimDuty).toBe("finding");
  });

  it("owes nothing on the aim, and records no duty there", async () => {
    const { continued, record } = await reviewed({ counts: { passed: 8, verified: 25 } });
    expect(continued).toHaveLength(0);
    expect(record.aboveAimDuty).toBeUndefined();
  });

  it("records the duty undischarged when the restatement is answered without an account", async () => {
    const root = tree();
    recordBattery(root, root, "r1", { passed: 20, verified: 25 });
    const record = await runEpochReview({
      repoRoot: root,
      slug: SLUG,
      runId: "r1",
      treeRoot: ".",
      analysis: analysisOf({ passed: 20, verified: 25 }),
      priorAdvice: null,
      publicRequest: "solves the domain",
      review,
      readerTurn: async (turn) => {
        expect(turn.continuePrompt?.("Nothing found.")).toContain("above the aim");
        expect(turn.continuePrompt?.("Still nothing.") ?? null).toBeNull();
        return { pin: null, text: "Still nothing.", error: null };
      },
    });
    expect(record.aboveAimDuty).toBe("undischarged");
  });
});

describe("what the request's clauses ask of every review", () => {
  const REQUEST = "designs roof trusses, checks geometric nonlinearity and reversing wind";

  async function closing(texts: readonly string[], finding?: Record<string, string | boolean>) {
    const root = tree();
    recordBattery(root, root, "r1", { passed: 8, verified: 25 });
    let prompt = "";
    const continued: string[] = [];
    const record = await runEpochReview({
      repoRoot: root,
      slug: SLUG,
      runId: "r1",
      treeRoot: ".",
      analysis: analysisOf({ passed: 8, verified: 25 }),
      priorAdvice: null,
      publicRequest: REQUEST,
      review,
      readerTurn: async (turn) => {
        prompt = turn.prompt;
        if (finding !== undefined) {
          await turn.tools.find((row) => row.name === "record_finding")?.execute("c1", double(finding));
        }
        let text = "";
        for (const next of texts) {
          text = next;
          const ask = turn.continuePrompt?.(text) ?? null;
          if (ask === null) break;
          continued.push(ask);
        }
        return { pin: null, text, error: null };
      },
    });
    return { prompt, continued, record };
  }

  const ALL_DISPOSED = [
    "Clause 1: answer; decides: yes, task t1.",
    "Clause 2: unchecked; decides: unknown.",
    "Clause 3: answer; decides: yes, task t2.",
  ].join("\n");

  it("lists every clause on the aim, and owes nothing once each is disposed of", async () => {
    const { prompt, continued, record } = await closing([ALL_DISPOSED]);
    expect(prompt).toContain("1. designs roof trusses");
    expect(prompt).toContain("2. checks geometric nonlinearity");
    expect(prompt).toContain("3. reversing wind");
    expect(continued).toHaveLength(0);
    expect(record.requestClauses?.map((row) => [row.check, row.decides])).toEqual([
      ["answer", "yes"],
      ["unchecked", "unknown"],
      ["answer", "yes"],
    ]);
  });

  it("asks once for a clause left undisposed or named against an undeclared check, and records it so", async () => {
    const partial = "Clause 1: answer; decides: yes.\nClause 3: nonlinear-service; decides: yes.";
    const { continued, record } = await closing([partial, partial, partial]);
    expect(continued).toHaveLength(1);
    expect(continued[0]).toContain("Request clauses 2, 3 are not yet disposed of");
    expect(record.requestClauses?.map((row) => row.check)).toEqual(["answer", null, null]);
  });

  it("asks again for a clause no task decides until a task-set defect carries it", async () => {
    const noTask = ALL_DISPOSED.replace(
      "Clause 2: unchecked; decides: unknown",
      "Clause 2: answer; decides: no",
    );
    const bare = await closing([noTask, noTask]);
    expect(bare.continued).toHaveLength(1);
    expect(bare.continued[0]).toContain("Request clause 2 is not yet disposed of");
    const carried = await closing([noTask], {
      defect: true,
      owner: "correctness-model/tasks.json",
      severity: "advisory",
      claim: "no task drives the check into the nonlinear regime",
      publicInputPath: "$.loads",
    });
    expect(carried.continued).toHaveLength(0);
    expect(carried.record.requestClauses?.[1]).toEqual({
      clause: "checks geometric nonlinearity",
      check: "answer",
      decides: "no",
    });
  });
});
