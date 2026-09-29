/**
 * The next move after a measured round. The host admits the round and the Builder chooses what
 * changes in it, so the host has two answers only: a blocking environment row stops, and everything
 * else reopens the adopted product, however many rounds have been measured.
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
import { type ClimbReadout, renderReadout } from "../src/run/climb-readout.ts";
import { ControllerLedger } from "../src/run/controller-ledger.ts";
import { FEEDBACK_POLICY } from "../src/analyse/iteration-analysis.ts";
import { SHIPPING_VARIANT } from "../src/run/run-driver.ts";
import { fixtureThresholdDigest, writeFixtureThresholds } from "./helpers/thresholds.ts";

const SLUG = "bridge-truss-design";
const scratch: string[] = [];

const rows = (severity: CampaignFeedback["severity"], ...owners: FeedbackOwner[]): CampaignFeedback[] =>
  owners.map((owner) => ({
    owner,
    severity,
    claim: `${owner} states a defect`,
    evidence: `campaigns/${SLUG}/analysis/r1.json`,
  }));

/** A readout of `admitted` placed rounds and `excluded` claim-refused ones. */
function measured(admitted: number, excluded = 0): ClimbReadout {
  return {
    band: [0.2, 0.5],
    decision: { placement: null, rationale: "fixture", evidence: [] },
    admitted,
    excluded: Array.from({ length: excluded }, (_, i) => ({
      runId: `r${String(i)}`,
      reason: "claim refused",
      claimRefused: true,
    })),
    rows: [],
  };
}

describe("a measured round", () => {
  it("leaves the round to the Builder however many rounds have been measured", () => {
    expect(decideNextMove("adopted", [], measured(3))).toMatchObject({ move: "rebuild", seed: "adopted" });
    expect(decideNextMove("adopted", [], measured(1, 2)).move).toBe("rebuild");
    // Refusals with no placement still count as an observed round: a rebuild, not a first measurement.
    expect(decideNextMove("adopted", [], measured(0, 5)).move).toBe("rebuild");
  });

  it("stops on a blocking environment row", () => {
    const blocked = decideNextMove("adopted", rows("blocking", "environment"), measured(3));
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

describe("a battery the environment cut short", () => {
  const remeasure = { of: "r1", taskIds: ["t4", "t5"] };

  it("is measured again in place of a rebuild, carrying the cases it solves again", () => {
    const move = decideNextMove("adopted", rows("advisory", "environment"), measured(1), false, remeasure);
    expect(move).toMatchObject({ move: "measure", remeasure });
    expect(move.reason).toContain("rerun them without changing the harness");
  });

  it("still reopens the product when a blocking row or an unfinished proposal owns the round", () => {
    const blocked = decideNextMove(
      "adopted",
      rows("blocking", "correctness-model/tasks.json"),
      measured(1),
      false,
      remeasure,
    );
    expect(blocked.move).toBe("rebuild");
    expect(decideNextMove("adopted", [], measured(1), true, remeasure).move).toBe("rebuild");
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

const selectAs = (
  root: string,
  runId: string,
  domainDir = join(root, "domains", SLUG),
  kickoff = "design a steel truss bridge",
) =>
  selectNextMoveFromDisk({
    repoRoot: root,
    manifest: { slug: SLUG, domain: SLUG, expectedTasks: BATTERY_SIZE.default },
    baseKickoff: kickoff,
    runPin: pinOf(root),
    runId,
    domainDir,
    builder: { kind: "claude", model: "test-model", reasoningEffort: "medium" },
    built: { reasoningEffort: "medium" },
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

  it("leaves saturated batteries to the Builder however many have landed", () => {
    const root = scratchRepo();
    for (let i = 1; i <= 3; i += 1) {
      sealSaturatedBattery(root, `saturated-${String(i)}`, `2026-08-10T0${String(i)}:00:00Z`);
    }
    const open = selectAs(root, "round-1").decision;
    expect(open).toMatchObject({ move: "rebuild", seed: "adopted" });
    expect(open.reason).toContain("Builder");
  });

  /** The pass is measurement identity: the adopted product, the admission and the readout's
   *  recorded facts. A readout sentence reworded, or a kickoff changed, must not reach it; the
   *  kickoff opens its own epoch through the binding's `kickoffHash` instead (campaign-epoch). */
  it("keys the pass on recorded facts, never on the readout's sentences or the kickoff", () => {
    const root = scratchRepo();
    writeBlockingTests(root, "base");
    sealSaturatedBattery(root, "saturated-1", "2026-08-10T01:00:00Z");
    const selected = selectAs(root, "round-1");
    const recorded = JSON.stringify(selected.readout);
    const sentences = renderReadout(selected.readout, "reason")
      .split("\n\n")
      .slice(1)
      .filter((part) => !part.startsWith("|"));
    expect(sentences.length).toBeGreaterThan(2);
    for (const sentence of sentences) expect(recorded).not.toContain(sentence);
    const other = selectAs(root, "round-2", join(root, "domains", SLUG), "design a timber roof truss");
    expect(other.decision.reopenKey).toBe(selected.decision.reopenKey);
  });
});
