import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { readEpochRecord, selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import {
  CAMPAIGN_LANES,
  LANE_LINES,
  DEFAULT_LANES,
  LANE_FOR_TRIGGER,
  lanesForTrigger,
  laneSuggestions,
  renderBrief,
  runScope,
  tierOf,
} from "../.claude/skills/whole-run-investigation/scripts/brief.mjs";
import { LANES, lanesForScope } from "../.claude/skills/whole-run-investigation/scripts/wri.mjs";

const RUN = "custom-test-20260919T000000000Z-abcdef";
const START = "2026-09-19T00:00:00.000Z";
const BUDGET = { turnBudget: null, turnsUsed: 0, status: "active" };

const unaccepted = (runId: string): CaseRecordRow =>
  caseRecordRow("t-unaccepted", "f", { runId, acceptedSubmit: false, truthOk: null, pass: false });
const nonResult = (runId: string): CaseRecordRow =>
  caseRecordRow("t-non-result", "f", {
    runId,
    acceptedSubmit: false,
    truthOk: null,
    pass: null,
    runtimeNonResult: "provider: stream closed",
    runtimeNonResultKind: "runtime",
  });

afterAll(cleanupScratch);

const json = (value: JsonValue) => `${JSON.stringify(value, null, 2)}\n`;

/** A campaign holding one run's opening, its epochs and its own case rows. */
function campaignWith(rows: CaseRecordRow[], { epochs = 1, terminal = false } = {}): string {
  const campaign = scratchDir("ana-brief-campaign-");
  const controller = join(campaign, "controller", RUN);
  mkdirSync(controller, { recursive: true });
  // Each new kickoff opens an epoch through the controller's own writer, so the count is the record's.
  for (let at = 0; at < epochs; at += 1) selectCampaignEpoch(campaign, { kickoff: `one line ${at}` });
  const epoch = readEpochRecord(campaign)?.current ?? null;
  const opening = {
    schema: "campaign-opening/v2",
    writtenAt: START,
    runId: RUN,
    epoch: { key: epoch },
    source: { commit: "c".repeat(40), dirty: false, sourceDigest: "d".repeat(64) },
    continuation: null,
    abandonedRuns: [],
    budget: BUDGET,
  };
  writeFileSync(join(controller, "opening.json"), json(opening));
  if (terminal) {
    // A terminal that admitted no battery, so its denominator is an absence and no battery seal
    // is owed; the scope counts cases from the case record, which the terminal does not gate.
    writeFileSync(
      join(controller, "terminal.json"),
      json({
        schema: "campaign-terminal/v4",
        writtenAt: "2026-09-19T03:00:00.000Z",
        source: opening.source,
        budget: BUDGET,
        epoch,
        openingDigest: hashJsonValue(opening),
        iterations: [],
        absentSteps: [],
        outcome: "completed",
        abortClause: null,
        terminalReason: "completed",
        lock: { token: "recorded-lock", ownedAtRecord: true },
        runEnd: { climb: null, provenance: [] },
      }),
    );
  }
  writeFileSync(
    join(campaign, "case-record.jsonl"),
    rows.map((row, at) => `${JSON.stringify({ seq: at + 1, row })}\n`).join(""),
  );
  return campaign;
}

const verified = (runId: string): CaseRecordRow => caseRecordRow("t-verified", "f", { runId });

describe("how big is this run", () => {
  it("reads a probe tier while no case has scored, however long the run has been going", () => {
    const scope = tierOf({ hours: 40, epochs: 4, batteries: 2, scored: false });
    expect(scope.tier).toBe("probe");
    expect(scope.lanes).toEqual(CAMPAIGN_LANES);
    expect(scope.why).toContain("no scored case");
  });

  it.each([
    [{ hours: 1 }, "probe"],
    [{ hours: 6 }, "standard"],
    [{ hours: 13 }, "deep"],
    [{ hours: 6, epochs: 3 }, "deep"],
    [{ hours: 6, batteries: 3 }, "deep"],
  ])("reads a scored run of %o as %s", (size, tier) => {
    expect(tierOf({ epochs: 1, batteries: 1, scored: true, ...size }).tier).toBe(tier);
  });

  it("asks for more semantic lanes as the tier rises, and never the same number twice", () => {
    const counts = [
      tierOf({ hours: 1, epochs: 1, batteries: 1, scored: true }),
      tierOf({ hours: 6, epochs: 1, batteries: 1, scored: true }),
      tierOf({ hours: 20, epochs: 4, batteries: 5, scored: true }),
    ].map((row) => row.semanticLanes);
    expect(counts).toEqual([4, 8, 14]);
  });

  it("counts a live run's elapsed hours to now and its batteries by their own run ids", () => {
    const campaign = campaignWith(
      [
        verified(RUN),
        verified(RUN),
        unaccepted(`${RUN}-i02`),
        nonResult(`${RUN}-i02`),
        verified("other-run"),
      ],
      { epochs: 2 },
    );
    const scope = runScope(campaign, RUN, { now: Date.parse("2026-09-19T15:00:00.000Z") });
    expect(scope.live).toBe(true);
    expect(scope.hours).toBeCloseTo(15, 5);
    expect(scope.cases).toEqual({ verified: 2, unaccepted: 1, nonResult: 1 });
    expect(scope.batteries.map((row: { battery: string }) => row.battery)).toEqual([RUN, `${RUN}-i02`]);
    expect(scope.tier).toBe("deep");
  });

  it("stops the clock at the terminal and carries its outcome", () => {
    const scope = runScope(campaignWith([verified(RUN)], { terminal: true }), RUN, {
      now: Date.parse("2026-09-19T15:00:00.000Z"),
    });
    expect(scope.controllerError).toBeNull();
    expect(scope.live).toBe(false);
    expect(scope.hours).toBeCloseTo(3, 5);
    expect(scope.terminal).toEqual({ outcome: "completed", reason: "completed" });
    expect(scope.tier).toBe("standard");
  });

  it("selects the named lanes for a tier that names some, and every lane for one that does not", () => {
    expect(lanesForScope({ lanes: null })).toEqual(LANES);
    expect(lanesForScope({ lanes: CAMPAIGN_LANES }).map((lane: { name: string }) => lane.name)).toEqual(
      CAMPAIGN_LANES,
    );
  });
});

describe("what the read said", () => {
  function reviewWith(steps: JsonValue[], captures: Record<string, string>): string {
    const campaign = campaignWith([verified(RUN)], { terminal: true });
    const reviewDir = scratchDir("ana-brief-review-");
    writeFileSync(
      join(reviewDir, "wri-review.json"),
      json({ schema: "wri-review/v1", reviewDir, campaign, runId: RUN, steps }),
    );
    for (const [name, text] of Object.entries(captures)) writeFileSync(join(reviewDir, `${name}.txt`), text);
    return reviewDir;
  }

  it("quotes a short lane whole and points at a long one", () => {
    const long = Array.from({ length: LANE_LINES + 12 }, (_, at) => `row ${at}`).join("\n");
    const brief = renderBrief(
      reviewWith(
        [
          { label: "walls", ok: true, exitCode: 0 },
          { label: "snapshot", ok: true, exitCode: 0 },
        ],
        { walls: "2 batteries\n  every wall is the seeded default\n", snapshot: long },
      ),
    );
    expect(brief).toContain("== walls  (2 lines)");
    expect(brief).toContain("every wall is the seeded default");
    expect(brief).toContain(`== snapshot  (${LANE_LINES + 12} lines)`);
    expect(brief).toContain("… 12 more lines in ");
    expect(brief).not.toContain(`row ${LANE_LINES + 1}`);
  });

  it("keeps a skip and a failure apart, and says which the lane was", () => {
    const brief = renderBrief(
      reviewWith(
        [
          { label: "archive", ok: null, skipped: "no archive for this run under notes/runs" },
          { label: "climb", ok: false, exitCode: 1 },
        ],
        { climb: "1 batteries\nboom\n" },
      ),
    );
    expect(brief).toContain("== archive\n  skipped: no archive for this run under notes/runs");
    expect(brief).toContain("(exit 1; read below as far as it got)");
    expect(brief).toContain("boom");
  });

  it("carries the run's own size and terminal above the lanes", () => {
    const brief = renderBrief(reviewWith([], {}));
    expect(brief).toContain(`${RUN}  [standard]`);
    expect(brief).toContain("1 verified, 0 unaccepted, 0 non-result");
    expect(brief).toContain("terminal: completed — completed");
    expect(brief).toContain("about 8 semantic lanes");
  });

  it("says outright when the deterministic lanes flagged nothing, rather than leaving the section empty", () => {
    const reviewDir = reviewWith([], {});
    writeFileSync(
      join(reviewDir, "overview.json"),
      json({ schema: "wri-run-overview/v1", digestTriggers: [], scanFindings: [] }),
    );
    expect(renderBrief(reviewDir)).toContain("no digest trigger or scan finding");
  });

  it("groups the digest triggers and scan findings the deterministic lanes recorded", () => {
    const reviewDir = reviewWith([], {});
    writeFileSync(
      join(reviewDir, "overview.json"),
      json({
        schema: "wri-run-overview/v1",
        digestTriggers: [
          { name: "FAMILY UNMOVED all-pass", rows: 3, examples: ["FAMILY UNMOVED all-pass: alpha 5/5"] },
        ],
        scanFindings: [
          { rule: "repeated-condition", battery: "i02", statement: "x" },
          { rule: "repeated-condition", battery: "i03", statement: "y" },
        ],
      }),
    );
    const brief = renderBrief(reviewDir);
    expect(brief).toContain("digest FAMILY UNMOVED all-pass x3: FAMILY UNMOVED all-pass: alpha 5/5");
    expect(brief).toContain("scan repeated-condition x2");
    // A family row names no lane in the catalogue, so the standard tier's default set is named.
    expect(brief).toContain("no trigger starts a lane; the standard default set is 1,5,8,9,12,14,24,25");
    expect(brief).toContain("launch --sessions 1,5,8,9,12,14,24,25");
  });

  it("carries an in-process lane's triggers into the brief and the lanes they start", () => {
    const reviewDir = reviewWith([{ label: "gates", ok: true, exitCode: 0 }], {
      gates: "1 Builder session(s)\n",
    });
    writeFileSync(
      join(reviewDir, "gates.triggers.json"),
      json([
        { name: "GATE STALL (lane 27)", rows: 1, examples: ["tool-timeout at epoch-a session 1"] },
        {
          name: "EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)",
          rows: 1,
          examples: ["run-b after run-a"],
        },
      ]),
    );
    const brief = renderBrief(reviewDir);
    expect(brief).toContain("digest GATE STALL (lane 27) x1: tool-timeout at epoch-a session 1");
    expect(brief).toContain("lane 28: EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)");
    expect(brief).toContain("launch --sessions 27,28");
    // A triggers file beside a lane the read did not run contributes nothing.
    const unrun = reviewWith([], {});
    writeFileSync(
      join(unrun, "gates.triggers.json"),
      json([{ name: "GATE STALL (lane 27)", rows: 1, examples: [] }]),
    );
    expect(renderBrief(unrun)).not.toContain("GATE STALL");
    // Nor does one left beside a lane that failed this read.
    const failed = reviewWith([{ label: "gates", ok: false, exitCode: 1 }], { gates: "gates failed: x\n" });
    writeFileSync(
      join(failed, "gates.triggers.json"),
      json([{ name: "GATE STALL (lane 27)", rows: 1, examples: [] }]),
    );
    expect(renderBrief(failed)).not.toContain("GATE STALL");
  });

  it("maps each digest trigger to the lanes the catalogue starts from it, and names the launch spec", () => {
    expect(lanesForTrigger("OFF-AIM STREAK (lane 10)")).toEqual([10]);
    expect(lanesForTrigger("TARGET MISSED (lane 10)")).toEqual([10]);
    expect(lanesForTrigger("REPEATED CONDITION (lane 20)")).toEqual([20]);
    expect(lanesForTrigger("MEMORY OVER READ CAP (lane 26)")).toEqual([26]);
    // The one unsuffixed trigger argues for two lanes, and a qualifier after its text still matches.
    expect(lanesForTrigger("UNTRIPPED IN SHIPPING (3 rules)")).toEqual([5, 6]);
    expect(lanesForTrigger("FAMILY UNMOVED all-pass")).toEqual([]);
    // A trigger that merely begins with a known name is not that trigger.
    expect(lanesForTrigger("UNTRIPPED IN SHIPPINGS")).toEqual([]);
    // Every suffixed key names the lane its own suffix says.
    for (const [trigger, lanes] of LANE_FOR_TRIGGER) {
      const suffix = /\(lane (\d+)\)$/.exec(trigger);
      if (suffix !== null) expect(lanes).toEqual([Number(suffix[1])]);
    }
    const suggested = laneSuggestions(
      [
        { name: "EXPLICIT ALLOWANCE WAIT (lane 24)", rows: 1, examples: [] },
        { name: "OFF-AIM STREAK (lane 10)", rows: 2, examples: [] },
        { name: "UNTRIPPED IN SHIPPING", rows: 1, examples: [] },
        { name: "AGGREGATE HIDES FAMILY", rows: 1, examples: [] },
      ],
      "probe",
    );
    expect(suggested).toEqual({
      lanes: [
        { lane: 5, triggers: ["UNTRIPPED IN SHIPPING"] },
        { lane: 6, triggers: ["UNTRIPPED IN SHIPPING"] },
        { lane: 10, triggers: ["OFF-AIM STREAK (lane 10)"] },
        { lane: 24, triggers: ["EXPLICIT ALLOWANCE WAIT (lane 24)"] },
      ],
      defaulted: false,
      sessions: "5,6,10,24",
    });
    // With no trigger picking, each tier's default set is named, and each tier keeps the one below.
    expect(laneSuggestions([], "probe")).toEqual({ lanes: [], defaulted: true, sessions: "5,8,12,25" });
    expect(laneSuggestions([], "deep").sessions).toBe("1,2,5,6,8,9,10,11,12,13,14,22,24,25");
    expect(DEFAULT_LANES.standard).toEqual(expect.arrayContaining(DEFAULT_LANES.probe));
    expect(DEFAULT_LANES.deep).toEqual(expect.arrayContaining(DEFAULT_LANES.standard));
    expect(DEFAULT_LANES.deep).toHaveLength(14);
  });

  it("prints the lanes the triggers start under their own heading in the brief", () => {
    const reviewDir = reviewWith([], {});
    writeFileSync(
      join(reviewDir, "overview.json"),
      json({
        schema: "wri-run-overview/v1",
        digestTriggers: [
          { name: "OFF-AIM STREAK (lane 10)", rows: 3, examples: ["OFF-AIM STREAK (lane 10): 3 under aim"] },
          { name: "EXPLICIT ALLOWANCE WAIT (lane 24)", rows: 1, examples: [] },
        ],
        scanFindings: [],
      }),
    );
    const brief = renderBrief(reviewDir);
    expect(brief).toContain(
      "== lanes the triggers start\n  lane 10: OFF-AIM STREAK (lane 10)\n  lane 24: EXPLICIT ALLOWANCE WAIT (lane 24)\n  launch --sessions 10,24",
    );
  });
});
