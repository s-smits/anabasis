import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import { readEpochRecord, selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import {
  CAMPAIGN_LANES,
  LANE_LINES,
  renderBrief,
  runScope,
  tierOf,
} from "../.claude/skills/whole-run-investigation/scripts/brief.mjs";
import { lanesForScope } from "../.claude/skills/whole-run-investigation/scripts/wri.mjs";

const RUN = "custom-test-20260919T000000000Z-abcdef";
const START = "2026-09-19T00:00:00.000Z";
const BUDGET = { turnBudget: null, turnsUsed: 0, status: "active" };
const dirs: string[] = [];

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

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const json = (value: JsonValue) => `${JSON.stringify(value, null, 2)}\n`;

/** A campaign holding one run's opening, its epochs and its own case rows. */
function campaignWith(rows: CaseRecordRow[], { epochs = 1, terminal = false } = {}): string {
  const campaign = temp("ana-brief-campaign-");
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

  it("separates a short run, an ordinary one and one long or deep enough to earn every lane", () => {
    const scored = { epochs: 1, batteries: 1, scored: true };
    expect(tierOf({ ...scored, hours: 1 }).tier).toBe("probe");
    expect(tierOf({ ...scored, hours: 6 }).tier).toBe("standard");
    expect(tierOf({ ...scored, hours: 13 }).tier).toBe("deep");
    expect(tierOf({ ...scored, hours: 6, epochs: 3 }).tier).toBe("deep");
    expect(tierOf({ ...scored, hours: 6, batteries: 3 }).tier).toBe("deep");
  });

  it("asks for more semantic lanes as the tier rises, and never the same number twice", () => {
    const counts = [
      tierOf({ hours: 1, epochs: 1, batteries: 1, scored: true }),
      tierOf({ hours: 6, epochs: 1, batteries: 1, scored: true }),
      tierOf({ hours: 20, epochs: 4, batteries: 5, scored: true }),
    ].map((row) => row.semanticLanes);
    expect(counts).toEqual([2, 4, 8]);
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
    expect(lanesForScope({ lanes: null })).toHaveLength(11);
    expect(lanesForScope({ lanes: CAMPAIGN_LANES }).map((lane: { name: string }) => lane.name)).toEqual(
      CAMPAIGN_LANES,
    );
  });
});

describe("what the read said", () => {
  function reviewWith(steps: JsonValue[], captures: Record<string, string>): string {
    const campaign = campaignWith([verified(RUN)], { terminal: true });
    const reviewDir = temp("ana-brief-review-");
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
    expect(brief).toContain("about 4 semantic lanes");
  });

  it("says outright when the snapshot lane flagged nothing, rather than leaving the section empty", () => {
    const reviewDir = reviewWith([], {});
    writeFileSync(
      join(reviewDir, "overview.json"),
      json({ schema: "wri-run-overview/v1", digestTriggers: [], scanFindings: [] }),
    );
    expect(renderBrief(reviewDir)).toContain("no digest trigger or scan finding");
  });

  it("groups the digest triggers and scan findings the snapshot lane recorded", () => {
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
  });
});
