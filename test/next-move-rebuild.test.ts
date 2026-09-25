/**
 * The next move after a measured round. The host admits the round and the Builder chooses what
 * changes in it, so the host has two answers only: a blocking environment row stops, and everything
 * else reopens the adopted product, however long an off-aim streak has run.
 *
 * The on-disk cases hold the reopen key: steady when the checkout moves, different when the
 * adopted product is another retained version.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import type { CampaignFeedback, FeedbackOwner } from "../src/author/campaign-types.ts";
import { BUNDLE_FILES } from "../src/author/feedback-routing.ts";
import { loadRepoEnv } from "../src/backends/env.ts";
import { backendPinOf, resolveSlots } from "../src/backends/resolve.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { claimsDirFor } from "../src/run/claim-write.ts";
import { BATTERY_SIZE } from "../src/run/battery-sizing.ts";
import { decideNextMove, selectNextMoveFromDisk } from "../src/run/next-move.ts";
import type { ClimbReadout, OffAimAllowance } from "../src/run/climb-readout.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
// import { POLICY } from "../src/critic/policy.ts";
import { ControllerLedger } from "../src/run/controller-ledger.ts";
import { FEEDBACK_POLICY } from "../src/analyse/iteration-analysis.ts";
import { SHIPPING_VARIANT } from "../src/run/run-driver.ts";
import { fixtureThresholdDigest, writeFixtureThresholds } from "./helpers/thresholds.ts";

const SLUG = "bridge-truss-design";
// Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
// const LIMIT = POLICY.climb.offAimStreakRounds;
const scratch: string[] = [];

const rows = (severity: CampaignFeedback["severity"], ...owners: FeedbackOwner[]): CampaignFeedback[] =>
  owners.map((owner) => ({
    owner,
    severity,
    claim: `${owner} states a defect`,
    evidence: `campaigns/${SLUG}/analysis/r1.json`,
  }));

/** A readout whose streak ran `placed` rounds on `side` of the aim with `refused` claim-refused
 *  rounds inside it. The walk that builds a streak from recorded batteries is climb-history's. */
function streak(
  placed: number,
  side: OffAimAllowance["side"] = "above",
  refused = 0,
  excluded = refused,
): ClimbReadout {
  return {
    band: [0.2, 0.5],
    decision: { placement: null, rationale: "fixture", evidence: [] },
    admitted: placed,
    excluded: Array.from({ length: excluded }, (_, i) => ({
      runId: `r${String(i)}`,
      reason: "claim refused",
      claimRefused: true,
    })),
    rows: [],
    allowance:
      placed === 0 ? null : { rounds: placed + refused, placed, refused, side, products: 1, sameSchema: 0 },
  };
}

// Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
// describe("the off-aim stop", () => {
//   it("stops at the allowance and leaves the round to the Builder one round before it", () => {
//     const stop = decideNextMove("adopted", [], streak(LIMIT));
//     expect(stop.move).toBe("stop");
//     expect(stop.reason).toContain(`${String(LIMIT)} consecutive rounds ended above the aim`);
//     expect(stop).not.toHaveProperty("seed");
//     expect(decideNextMove("adopted", [], streak(LIMIT - 1)).move).toBe("rebuild");
//   });
//
//   it("counts claim-refused rounds inside the streak, and never refusals alone", () => {
//     const refused = decideNextMove("adopted", [], streak(1, "above", LIMIT - 1));
//     expect(refused.move).toBe("stop");
//     expect(refused.reason).toContain(`(1 placed above the aim, ${String(LIMIT - 1)} claim-refused)`);
//     // Refusals with no placement are a different failure with its own owner; they still count as
//     // an observed round, so the move is a rebuild and not a first measurement.
//     expect(decideNextMove("adopted", [], streak(0, "above", 0, 5)).move).toBe("rebuild");
//   });
//
//   it("says a streak above the aim found no limit, and never that none is reachable", () => {
//     const { reason } = decideNextMove("adopted", [], streak(LIMIT));
//     expect(reason).toContain("This run did not find a limit");
//     expect(reason).toContain("it does not establish that another product would add no evidence");
//     expect(reason).not.toMatch(/no limit (is|was) reachable|cannot be (reached|found)/i);
//   });
//
//   it("claims nothing about a limit when the streak ran below the aim", () => {
//     const { move, reason } = decideNextMove("adopted", [], streak(LIMIT, "below"));
//     expect(move).toBe("stop");
//     expect(reason).toContain(`${String(LIMIT)} consecutive rounds ended below the aim`);
//     expect(reason).not.toContain("did not find a limit");
//   });
//
//   it("stops on a blocking environment row before it reads the streak", () => {
//     const blocked = decideNextMove("adopted", rows("blocking", "environment"), streak(LIMIT));
//     expect(blocked.reason).toContain("environment outside the product");
//     expect(blocked.reason).not.toContain("off-aim");
//   });
// });

describe("an off-aim streak", () => {
  it("leaves the round to the Builder however long the streak has run, on either side", () => {
    expect(decideNextMove("adopted", [], streak(3))).toMatchObject({ move: "rebuild", seed: "adopted" });
    expect(decideNextMove("adopted", [], streak(3, "below")).move).toBe("rebuild");
    expect(decideNextMove("adopted", [], streak(1, "above", 2)).move).toBe("rebuild");
    // Refusals with no placement still count as an observed round: a rebuild, not a first measurement.
    expect(decideNextMove("adopted", [], streak(0, "above", 0, 5)).move).toBe("rebuild");
  });

  it("stops on a blocking environment row whatever the streak", () => {
    const blocked = decideNextMove("adopted", rows("blocking", "environment"), streak(3));
    expect(blocked.move).toBe("stop");
    expect(blocked.reason).toContain("environment outside the product");
  });
});

describe("the reopen route", () => {
  it.each([...BUNDLE_FILES])(
    "reopens the adopted product on blocking %s feedback and names the owner",
    (owner) => {
      const move = decideNextMove("adopted", rows("blocking", owner));
      expect(move).toMatchObject({ move: "rebuild", seed: "adopted" });
      expect(move.reason).toContain(owner);
    },
  );

  it("stops only on blocking environment feedback, and builds when nothing is adopted", () => {
    expect(
      decideNextMove("adopted", rows("blocking", "environment", "correctness-model/tasks.json")).move,
    ).toBe("stop");
    expect(decideNextMove("adopted", rows("advisory", "environment")).move).toBe("rebuild");
    expect(decideNextMove("none", rows("blocking", "environment")).move).toBe("build");
    expect(decideNextMove("adopted", null).move).toBe("measure");
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

const pinOf = (root: string) => backendPinOf(resolveSlots(root, SLUG, loadRepoEnv(root, Bun.env)));

/** One recorded battery that passed every case, plus its created claim, under the resolved pin. */
function sealSaturatedBattery(root: string, runId: string, createdAt: string): void {
  const evidence = new EvidenceLog(join(root, "domains", SLUG, "runs", runId));
  evidence.write("battery.json", {
    runId,
    backendPin: pinOf(root),
    thresholdManifestDigest: fixtureThresholdDigest(root),
    condition: { variant: SHIPPING_VARIANT },
    bundleSnapshot: { agentHash: "agent-a", correctnessModelHash: "correctnessModel-a" },
    execution: { tools: {}, verifierEnvironmentHash: null },
    cases: Array.from({ length: BATTERY_SIZE.default }, (_, index) => ({
      taskId: `t${index}`,
      pass: true,
      acceptedSubmit: true,
    })),
    measured: { items: [], levels: [], findings: [] },
  });
  evidence.record();
  mkdirSync(claimsDirFor(root, SLUG), { recursive: true });
  writeFileSync(
    join(claimsDirFor(root, SLUG), `${runId}.json`),
    JSON.stringify({ schema: "run-claim/v1", runId, createdAt, claim: { ok: true } }),
  );
}

function writeBlockingTests(root: string, runId: string): void {
  using ledger = ControllerLedger.open(join(root, "campaigns", SLUG));
  ledger.writeAdmission(
    JSON.stringify({
      runId,
      schema: "repair-agenda/v1",
      attempts: [],
      observedEvaluation: { scoringHash: null, taskSetHash: null },
      policy: FEEDBACK_POLICY,
      digest: "d".repeat(64),
      admitted: [],
      refused: [],
      feedback: rows("blocking", "correctness-model/tasks.json"),
    }),
  );
}

const selectAs = (root: string, runId: string, domainDir = join(root, "domains", SLUG)) =>
  selectNextMoveFromDisk({
    repoRoot: root,
    manifest: { slug: SLUG, domain: SLUG, expectedTasks: BATTERY_SIZE.default },
    baseKickoff: "design a steel truss bridge",
    runPin: pinOf(root),
    runId,
    domainDir,
    builder: { kind: "claude", model: "test-model", reasoningEffort: "medium" },
  });

describe("the next move on disk", () => {
  it("keeps the reopen key across a moved checkout and changes it for another retained version", () => {
    const root = scratchRepo();
    writeBlockingTests(root, "base");
    const first = selectAs(root, "round-1");
    expect(first.decision).toMatchObject({ move: "rebuild", seed: "adopted" });
    expect(first.decision.reopenKey).toMatch(/^experiment:[a-f0-9]{64}$/);
    // The kickoff stays the operator's one line: no curriculum rides on it.
    expect(first.kickoff).toBe("design a steel truss bridge");
    const moved = scratchRepo();
    cpSync(root, moved, { recursive: true });
    expect(selectAs(moved, "round-2").decision.reopenKey).toBe(first.decision.reopenKey);
    const version = join(moved, "campaigns", SLUG, "products", "new-version");
    cpSync(join(moved, "domains", SLUG), version, { recursive: true });
    expect(selectAs(moved, "round-3", version).decision.reopenKey).not.toBe(first.decision.reopenKey);
  });

  // Gate audit 2026-09-25 (docs/gate-audit.md, off-aim-allowance-stop): commented out (unsure): the Builder owns the route after an off-aim streak, which stays a readout fact
  // it("leaves saturated batteries to the Builder until the allowance is spent, then stops honestly", () => {
  //   const root = scratchRepo();
  //   for (let i = 1; i < LIMIT; i += 1) {
  //     sealSaturatedBattery(root, `saturated-${String(i)}`, `2026-08-10T0${String(i)}:00:00Z`);
  //   }
  //   const open = selectAs(root, "round-1").decision;
  //   expect(open).toMatchObject({ move: "rebuild", seed: "adopted" });
  //   expect(open.reason).toContain("Builder");
  //   sealSaturatedBattery(root, `saturated-${String(LIMIT)}`, `2026-08-10T0${String(LIMIT)}:00:00Z`);
  //   const stopped = selectAs(root, "round-2").decision;
  //   expect(stopped.move).toBe("stop");
  //   expect(stopped.reason).toContain("This run did not find a limit");
  //   expect(stopped).not.toHaveProperty("reopenKey");
  // });

  it("leaves saturated batteries to the Builder however many have landed", () => {
    const root = scratchRepo();
    for (let i = 1; i <= 3; i += 1) {
      sealSaturatedBattery(root, `saturated-${String(i)}`, `2026-08-10T0${String(i)}:00:00Z`);
    }
    const open = selectAs(root, "round-1").decision;
    expect(open).toMatchObject({ move: "rebuild", seed: "adopted" });
    expect(open.reason).toContain("Builder");
  });
});
