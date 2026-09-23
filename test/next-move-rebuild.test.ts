/**
 * The host decides that authoring reopens; the Builder decides what to change. These cases hold
 * that line at three boundaries. The off-aim allowance stops a campaign once it is spent, in the
 * sentence the frame owns, and one round below the allowance it leaves the round to the Builder,
 * counting a claim-refused round inside the run but never a refusal on its own. Blocking feedback
 * reopens the route, and only blocking environment feedback stops instead. The saturation move
 * opens model-owned authoring while the allowance runs, and ends the campaign once the whole
 * allowance has read one side.
 *
 * The on-disk cases are here because a reopen has to survive the tree moving underneath it: the
 * pass is kept across a checkout relocation, retained product versions stay distinguishable, and
 * the author is handed the original request with no curriculum pinned to it.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import type { CampaignFeedback, FeedbackOwner } from "../src/author/campaign-types.ts";
import { loadRepoEnv } from "../src/backends/env.ts";
import { backendPinOf, resolveSlots } from "../src/backends/resolve.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { claimsDirFor } from "../src/run/claim-write.ts";
import { BATTERY_SIZE } from "../src/run/battery-sizing.ts";
import { decideNextMove, selectNextMoveFromDisk } from "../src/run/next-move.ts";
import type { ClimbReadout, OffAimAllowance } from "../src/run/climb-readout.ts";
import { POLICY } from "../src/critic/policy.ts";
import { ControllerLedger } from "../src/run/controller-ledger.ts";
import { FEEDBACK_POLICY } from "../src/analyse/iteration-analysis.ts";
import { SHIPPING_VARIANT } from "../src/run/run-driver.ts";
import { fixtureThresholdDigest, writeFixtureThresholds } from "./helpers/thresholds.ts";

const SLUG = "bridge-truss-design";

/** The keys the admission writer adds to every packet, with an evaluation identity neither half
 *  of which was recorded, so it proves no mismatch with the adopted tree. */
const WRITER_KEYS = {
  schema: "repair-agenda/v1",
  attempts: [],
  observedEvaluation: { scoringHash: null, taskSetHash: null },
};

const scratch: string[] = [];
const rows = (severity: CampaignFeedback["severity"], ...owners: FeedbackOwner[]): CampaignFeedback[] =>
  owners.map((owner) => ({
    owner,
    severity,
    claim: `${owner} states a defect`,
    evidence: `campaigns/${SLUG}/analysis/r1.json`,
  }));

/** A readout whose allowance ran `placed` rounds above the aim and `refused` claim-refused rounds
 *  inside that run. The walk that produces it from recorded batteries has its own tests in
 *  climb-history.test.ts; the next move reads only its result. */
function offAim(placed: number, refused = 0, excluded = refused): ClimbReadout {
  const allowance: OffAimAllowance | null =
    placed === 0
      ? null
      : { rounds: placed + refused, placed, refused, side: "above", products: 1, sameSchema: 0 };
  return {
    band: [0.2, 0.5],
    decision: { action: "no-difficulty-evidence", rationale: "fixture", evidence: [] },
    admitted: placed,
    excluded: Array.from({ length: excluded }, (_, i) => ({
      runId: `r${String(i)}`,
      reason: "claim refused",
      claimRefused: true,
    })),
    rows: [],
    allowance,
  };
}

describe("the off-aim allowance", () => {
  it("stops a campaign whose allowance is spent, in the sentence the frame owns", () => {
    const move = decideNextMove("adopted", [], offAim(POLICY.climb.offAimStreakRounds));
    expect(move.move).toBe("stop");
    expect(move.reason).toContain(
      `Stopped at the configured off-aim allowance: ${String(POLICY.climb.offAimStreakRounds)} consecutive rounds ended above the aim`,
    );
    // Honest about its scope: the allocation ended, not the question.
    expect(move.reason).toContain("it does not establish that another product would add no evidence");
  });

  it("leaves the round to the Builder one round below the allowance", () => {
    // The off-by-one this ceiling is most likely to be written with.
    expect(decideNextMove("adopted", [], offAim(POLICY.climb.offAimStreakRounds - 1)).move).toBe("rebuild");
  });

  it("counts claim-refused rounds inside the run, and never refusals alone", () => {
    const refused = decideNextMove("adopted", [], offAim(1, 2));
    expect(refused.move).toBe("stop");
    expect(refused.reason).toContain("(1 placed above the aim, 2 claim-refused)");
    // A campaign whose claims keep being refused with no placement is a different failure with a
    // different owner: no allowance runs, and the refused rounds still count as observed.
    expect(decideNextMove("adopted", [], offAim(0, 0, 5)).move).toBe("rebuild");
  });

  it("leaves the environment stop and the absent-evidence default alone", () => {
    // Both stop branches are observable in the terminal string, so their order is a fact.
    const blocked = decideNextMove("adopted", rows("blocking", "environment"), offAim(5));
    expect(blocked.reason).toContain("environment outside the product");
    expect(decideNextMove("adopted", rows("blocking", "tests")).move).toBe("rebuild");
  });
});

describe("the blocking reopen route", () => {
  it.each(["tests", "controls", "correctness-model", "brief", "tools-spec", "unknown"] as const)(
    "leaves %s repair scope to the Builder",
    (owner) => {
      const move = decideNextMove("adopted", rows("blocking", owner));
      expect(move).toMatchObject({ move: "rebuild", seed: "adopted" });
      expect(move).not.toHaveProperty("experiment");
      expect(move.reason).toContain(owner);
    },
  );
  it("stops only blocking environment feedback", () => {
    expect(decideNextMove("adopted", rows("blocking", "environment", "correctness-model")).move).toBe("stop");
    expect(decideNextMove("adopted", rows("advisory", "environment")).move).toBe("rebuild");
    expect(decideNextMove("none", rows("blocking", "environment")).move).toBe("build");
  });
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-next-move-"));
  scratch.push(root);
  writeFixtureThresholds(root);
  mkdirSync(join(root, "domains", SLUG), { recursive: true });
  return root;
}

/** One recorded saturated battery plus its created claim, under the pin the selector resolves. */
function sealSaturatedBattery(
  root: string,
  runId: string,
  createdAt: string,
  level: number | null = null,
): void {
  const pin = backendPinOf(resolveSlots(root, SLUG, loadRepoEnv(root, Bun.env)));
  const evidence = new EvidenceLog(join(root, "domains", SLUG, "runs", runId));
  evidence.write("battery.json", {
    runId,
    backendPin: pin,
    thresholdManifestDigest: fixtureThresholdDigest(root),
    condition: { variant: SHIPPING_VARIANT },
    bundleSnapshot: { agentHash: "agent-a", correctnessModelHash: "correctnessModel-a" },
    execution: { tools: {}, verifierEnvironmentHash: null },
    cases: Array.from({ length: BATTERY_SIZE.default }, (_, index) => ({
      taskId: `t${index}`,
      pass: true,
      acceptedSubmit: true,
    })),
    measured: {
      items: [],
      levels:
        level === null
          ? []
          : [
              {
                level,
                attempts: BATTERY_SIZE.default,
                passes: BATTERY_SIZE.default,
                rate: 1,
                lo: 0.96,
                hi: 1,
                difficulty: level,
              },
            ],
      findings: [],
    },
  });
  evidence.record();
  mkdirSync(claimsDirFor(root, SLUG), { recursive: true });
  writeFileSync(
    join(claimsDirFor(root, SLUG), `${runId}.json`),
    JSON.stringify({ schema: "run-claim/v1", runId, createdAt, claim: { ok: true } }),
  );
}

const selectAs = (root: string, runId: string, domainDir = join(root, "domains", SLUG)) =>
  selectNextMoveFromDisk({
    repoRoot: root,
    manifest: { slug: SLUG, domain: SLUG, expectedTasks: BATTERY_SIZE.default },
    baseKickoff: "design a steel truss bridge",
    runPin: backendPinOf(resolveSlots(root, SLUG, loadRepoEnv(root, Bun.env))),
    runId,
    domainDir,
    builder: { kind: "claude", model: "test-model", reasoningEffort: "medium" },
  });

function writeAdmission(root: string, payload: string): void {
  using ledger = ControllerLedger.open(join(root, "campaigns", SLUG));
  ledger.writeAdmission(payload);
}

describe("the blocking battery re-authoring on disk", () => {
  it("keeps the pass across checkout relocation and distinguishes retained product versions", () => {
    const root = scratchRepo();
    writeAdmission(
      root,
      JSON.stringify({
        runId: "base",
        ...WRITER_KEYS,
        policy: FEEDBACK_POLICY,
        digest: "d".repeat(64),
        admitted: [],
        refused: [],
        feedback: rows("blocking", "tests"),
      }),
    );
    const first = selectAs(root, "round-1");
    const relocated = scratchRepo();
    cpSync(root, relocated, { recursive: true });
    expect(selectAs(relocated, "round-2").decision.reopenKey).toBe(first.decision.reopenKey);
    const version = join(relocated, "campaigns", SLUG, "products", "new-version");
    cpSync(join(relocated, "domains", SLUG), version, { recursive: true });
    expect(selectAs(relocated, "round-3", version).decision.reopenKey).not.toBe(first.decision.reopenKey);
  });

  it("hands the author the original request without a pinned curriculum", () => {
    const root = scratchRepo();
    sealSaturatedBattery(root, "base-1", "2026-09-06T18:00:00Z");
    const analysis = join(root, "campaigns", SLUG, "analysis");
    mkdirSync(analysis, { recursive: true });
    writeAdmission(
      root,
      JSON.stringify({
        runId: "base-1",
        ...WRITER_KEYS,
        policy: FEEDBACK_POLICY,
        digest: "d".repeat(64),
        admitted: [],
        refused: [],
        feedback: [
          { owner: "tests", severity: "blocking", claim: "two task copies disagree", evidence: "analysis" },
        ],
      }),
    );
    const selected = selectAs(root, "round-2");
    expect(selected.decision.move).toBe("rebuild");
    expect(selected.decision).not.toHaveProperty("level");
    expect(selected.decision.seed).toBe("adopted");
    expect(selected.decision.reopenKey).toMatch(/^experiment:[a-f0-9]{64}$/);
    // The kickoff stays the operator's one line: no difficulty contract rides on it.
    expect(selected.kickoff).toBe("design a steel truss bridge");
  });

  it("reopens from the a65dc8 i02 packet with advisory and blocking task findings", () => {
    // The packet this fixture builds is the one admitted after a battery that passed every case: an
    // advisory `tests` row from the case record, a blocking `tests` row from the epoch review
    // naming one check and one public input path, and an unowned advisory diagnosis row. Read as an
    // instruction to start over, those rows reset the workspace and rebuild a harness that had just
    // passed. They now reopen the adopted product and leave the experiment scope to the Builder,
    // without prescribing a difficulty level.
    const root = scratchRepo();
    sealSaturatedBattery(root, "base-1", "2026-09-06T18:00:00Z");
    const analysis = join(root, "campaigns", SLUG, "analysis");
    mkdirSync(analysis, { recursive: true });
    const caseRecord = `campaigns/${SLUG}/case-record.jsonl`;
    const epochReview = `campaigns/${SLUG}/analysis/base-1-epoch-review.json`;
    writeAdmission(
      root,
      JSON.stringify({
        runId: "base-1",
        ...WRITER_KEYS,
        policy: FEEDBACK_POLICY,
        digest: "d".repeat(64),
        admitted: [
          { kind: "harness-defect", evidence: caseRecord, proposedOwner: "tests", severity: "advisory" },
          {
            kind: "harness-defect",
            evidence: epochReview,
            proposedOwner: "tests",
            checkId: "layout-geometry",
            publicInputPath: "$.specJson",
          },
          {
            kind: "diagnosis-uncertain",
            evidence: epochReview,
            proposedOwner: null,
            severity: "advisory",
            checkId: "audit-peak-tension",
          },
        ],
        refused: [],
        feedback: [
          {
            owner: "tests",
            severity: "advisory",
            claim: "one case row disagrees with its task copy",
            evidence: caseRecord,
            findings: [{ code: "harness-defect", path: caseRecord, disclosure: { class: "authored" } }],
          },
          {
            owner: "tests",
            severity: "blocking",
            claim: "a serialised public input disagrees with its structured source on four tasks",
            evidence: epochReview,
            findings: [{ code: "harness-defect", path: epochReview, disclosure: { class: "authored" } }],
          },
        ],
      }),
    );
    const selected = selectAs(root, "round-2");
    expect(selected.decision.move).toBe("rebuild");
    expect(selected.decision).not.toHaveProperty("level");
    expect(selected.decision.seed).toBe("adopted");
  });
});

describe("the saturation move", () => {
  it("opens model-owned authoring while the off-aim allowance runs", () => {
    const root = scratchRepo();
    sealSaturatedBattery(root, "saturated-1", "2026-08-10T08:00:00Z", 0);
    sealSaturatedBattery(root, "saturated-2", "2026-08-10T09:00:00Z", 1);

    const first = selectAs(root, "round-1");
    expect(first.decision.move).toBe("rebuild");
    expect(first.decision).not.toHaveProperty("cause");
    expect(first.decision.seed).toBe("adopted");
    expect(first.decision.reopenKey).toMatch(/^experiment:[a-f0-9]{64}$/);
    expect(first.decision.reason).toContain("Builder");
    expect(first.kickoff).toBe("design a steel truss bridge");
    // Perfect batteries at one level also leave the next experiment to the Builder.
    const flat = scratchRepo();
    sealSaturatedBattery(flat, "flat-1", "2026-08-10T08:00:00Z", 2);
    sealSaturatedBattery(flat, "flat-2", "2026-08-10T09:00:00Z", 2);
    expect(selectAs(flat, "round-1").decision).not.toHaveProperty("cause");
  });

  it("ends the campaign once the whole allowance read the same side", () => {
    // The move this replaced reopened authoring after any number of saturated batteries. Opening
    // it a fourth time reads the same side again, which is where an operator stops the campaign by
    // hand rather than pay for that round.
    const root = scratchRepo();
    sealSaturatedBattery(root, "saturated-1", "2026-08-10T08:00:00Z", 0);
    sealSaturatedBattery(root, "saturated-2", "2026-08-10T09:00:00Z", 1);
    sealSaturatedBattery(root, "saturated-3", "2026-08-10T10:00:00Z", 2);
    const stopped = selectAs(root, "round-1").decision;
    expect(stopped.move).toBe("stop");
    expect(stopped.reason).toContain("3 consecutive rounds ended above the aim");
    expect(stopped).not.toHaveProperty("seed");
  });
});
