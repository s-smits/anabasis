import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { afterAll, describe, expect, it } from "bun:test";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import { STUB_RUN, stubSource, type StubOptions } from "./helpers/measured-source.ts";
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
} from "../.claude/skills/whole-run-investigation/scripts/brief.ts";
import { LANES, lanesForScope } from "../.claude/skills/whole-run-investigation/scripts/wri.ts";
import { HARDWARE_TRIGGER } from "../.claude/skills/whole-run-investigation/scripts/hardware-target.ts";

const RUN = "custom-test-20260919T000000000Z-abcdef";
const WRI = resolve(import.meta.dirname, "../.claude/skills/whole-run-investigation/scripts/wri.ts");
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

/** One `wri.ts` command over a stub source's run, into `reviewDir`, through that source's readers. */
function readThrough(source: { repo: string; campaign: string }, reviewDir: string, ...args: string[]) {
  const [command = "read", ...rest] = args;
  const run = Bun.spawnSync({
    cmd: [
      runtimeProcess.execPath,
      WRI,
      command,
      source.campaign,
      "--repo",
      source.repo,
      "--out",
      reviewDir,
      ...rest,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** The steps a review recorded. */
function recordedSteps(reviewDir: string) {
  return parseJsonAs<{ steps: { label: string; ok: boolean | null; skipped?: string }[] }>(
    readFileSync(join(reviewDir, "wri-review.json"), "utf8"),
  ).steps;
}

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
        schema: "campaign-terminal/v5",
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
  ] as const)("reads a scored run of %o as %s", (size, tier) => {
    expect(tierOf({ epochs: 1, batteries: 1, scored: true, ...size }).tier).toBe(tier);
  });

  it("asks for more semantic lanes as the tier rises, and never the same number twice", () => {
    const counts = [
      tierOf({ hours: 1, epochs: 1, batteries: 1, scored: true }),
      tierOf({ hours: 6, epochs: 1, batteries: 1, scored: true }),
      tierOf({ hours: 20, epochs: 4, batteries: 5, scored: true }),
    ].map((row) => row.semanticLanes);
    expect(counts).toEqual([6, 12, 19]);
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
  /** A review as `read` records it, sized by the run's own scope, with these steps and captures. */
  function reviewWith(steps: JsonValue[], captures: Record<string, string>): string {
    const campaign = campaignWith([verified(RUN)], { terminal: true });
    const reviewDir = scratchDir("ana-brief-review-");
    // The scope as `read` records it: through JSON, as the file carries it.
    const scope = parseJsonAs<JsonValue>(JSON.stringify(runScope(campaign, RUN)));
    writeFileSync(
      join(reviewDir, "wri-review.json"),
      json({
        schema: "wri-review/v2",
        reviewDir,
        campaign,
        runId: RUN,
        repo: "/src",
        chosen: "--repo",
        passed: [],
        scope,
        steps,
      }),
    );
    for (const [name, text] of Object.entries(captures)) writeFileSync(join(reviewDir, `${name}.txt`), text);
    return reviewDir;
  }

  /** The lanes a review records, after one `wri.ts read` per lane list into the same `--out`, each
   *  read through the stub source's own readers. */
  function readInto(source: { repo: string; campaign: string }, reviewDir: string, ...reads: string[]) {
    for (const lanes of reads) {
      const { code, stderr } = readThrough(source, reviewDir, "read", "--lanes", lanes);
      expect(stderr).toBe("");
      expect(code).toBe(0);
    }
    return recordedSteps(reviewDir).map((row) => row.label);
  }

  it("adds a narrower later read's lanes to the review rather than replacing the earlier read", () => {
    const source = stubSource();
    const reviewDir = scratchDir("ana-brief-reread-");
    expect(readInto(source, reviewDir, "climb,walls", "handoff")).toEqual(["climb", "walls", "handoff"]);
    const brief = renderBrief(reviewDir);
    for (const lane of ["climb", "walls", "handoff"]) expect(brief).toContain(`== ${lane}`);
    // A lane read again replaces its own row and no other.
    expect(readInto(source, reviewDir, "walls")).toEqual(["climb", "handoff", "walls"]);
  });

  it("starts a review of another run empty rather than carrying that run's lanes", () => {
    const reviewDir = scratchDir("ana-brief-reread-");
    readInto(stubSource(), reviewDir, "climb");
    expect(readInto(stubSource(), reviewDir, "walls")).toEqual(["walls"]);
  });

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

  it("carries the run's own size and terminal above the lanes, and the checkout that read it", () => {
    const reviewDir = reviewWith([], {});
    const brief = renderBrief(reviewDir);
    expect(brief).toContain(`${RUN}  [standard]`);
    expect(brief).toContain("1 verified, 0 unaccepted, 0 non-result");
    expect(brief).toContain("terminal: completed — completed");
    expect(brief).toContain("about 12 semantic lanes");
    expect(brief).toContain("  readers /src (--repo)");
    // A review recorded before the read resolved its checkout carries no scope and is sized here.
    const state = parseJsonAs<Record<string, JsonValue>>(
      readFileSync(join(reviewDir, "wri-review.json"), "utf8"),
    );
    writeFileSync(
      join(reviewDir, "wri-review.json"),
      json({ ...state, schema: "wri-review/v1", scope: null, repo: null }),
    );
    expect(renderBrief(reviewDir)).toContain(`${RUN}  [standard]`);
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
    // An all-pass family row names no lane in the catalogue, so the standard tier's default set is
    // named, with the standing lanes every standard read opens.
    expect(brief).toContain(
      "no trigger starts a lane; the standard default set with its standing lanes is 1,5,8,9,12,14,24,25,31,33,34,37",
    );
    expect(brief).toContain("launch --sessions 1,5,8,9,12,14,24,25,31,33,34,37");
  });

  it("carries an in-process lane's triggers into the brief and the lanes they start", () => {
    const reviewDir = reviewWith([{ label: "gates", ok: true, exitCode: 0 }], {
      gates: "1 Builder session(s)\n",
    });
    writeFileSync(
      join(reviewDir, "gates.json"),
      json({
        triggers: [
          { name: "GATE STALL (lane 27)", rows: 1, examples: ["tool-timeout at epoch-a session 1"] },
          {
            name: "EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)",
            rows: 1,
            examples: ["run-b after run-a"],
          },
        ],
      }),
    );
    const brief = renderBrief(reviewDir);
    expect(brief).toContain("digest GATE STALL (lane 27) x1: tool-timeout at epoch-a session 1");
    expect(brief).toContain("lane 28: EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)");
    expect(brief).toContain("launch --sessions 27,28,31,33,34,37");
    // A report beside a lane the read did not run contributes nothing.
    const unrun = reviewWith([], {});
    writeFileSync(
      join(unrun, "gates.json"),
      json({ triggers: [{ name: "GATE STALL (lane 27)", rows: 1, examples: [] }] }),
    );
    expect(renderBrief(unrun)).not.toContain("GATE STALL");
    // Nor does one left beside a lane that failed this read.
    const failed = reviewWith([{ label: "gates", ok: false, exitCode: 1 }], { gates: "gates failed: x\n" });
    writeFileSync(
      join(failed, "gates.json"),
      json({ triggers: [{ name: "GATE STALL (lane 27)", rows: 1, examples: [] }] }),
    );
    expect(renderBrief(failed)).not.toContain("GATE STALL");
  });

  it("maps each digest trigger to the lanes the catalogue starts from it, and names the launch spec", () => {
    // A suffixed trigger starts its own lane first, then the lane the catalogue added beside it.
    expect(lanesForTrigger("OFF-AIM STREAK (lane 10)")).toEqual([10, 36]);
    expect(lanesForTrigger("CENSUS WITH DISAGREEMENT (lane 16)")).toEqual([16, 32]);
    // The plan declares no target, so no target trigger maps anywhere.
    expect(lanesForTrigger("TARGET MISSED (lane 10)")).toEqual([]);
    expect(lanesForTrigger("REPEATED CONDITION (lane 20)")).toEqual([20]);
    expect(lanesForTrigger("MEMORY OVER READ CAP (lane 26)")).toEqual([26]);
    // The one unsuffixed trigger argues for two lanes, and a qualifier after its text still matches.
    expect(lanesForTrigger("UNTRIPPED IN SHIPPING (3 rules)")).toEqual([5, 6]);
    // The hardware trigger starts the coverage lane and the isolated ground-truth lane together.
    expect(lanesForTrigger(HARDWARE_TRIGGER)).toEqual([29, 30]);
    expect(lanesForTrigger("FAMILY UNMOVED all-pass")).toEqual([]);
    expect(lanesForTrigger("FAMILY UNMOVED all-fail")).toEqual([38]);
    // A trigger that merely begins with a known name is not that trigger.
    expect(lanesForTrigger("UNTRIPPED IN SHIPPINGS")).toEqual([]);
    // Every suffixed key starts the lane its own suffix says first.
    for (const [trigger, lanes] of LANE_FOR_TRIGGER) {
      const suffix = /\(lane (\d+)\)$/.exec(trigger);
      if (suffix !== null) expect(lanes[0]).toBe(Number(suffix[1]));
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
        { lane: 31, triggers: ["standing (probe)"] },
        { lane: 34, triggers: ["standing (probe)"] },
        { lane: 36, triggers: ["OFF-AIM STREAK (lane 10)"] },
      ],
      defaulted: false,
      sessions: "5,6,10,24,31,34,36",
    });
    // With no trigger picking, each tier's default set is named beside its standing lanes, and each
    // tier keeps the one below.
    expect(laneSuggestions([], "probe")).toEqual({
      lanes: [
        { lane: 31, triggers: ["standing (probe)"] },
        { lane: 34, triggers: ["standing (probe)"] },
      ],
      defaulted: true,
      sessions: "5,8,12,25,31,34",
    });
    expect(laneSuggestions([], "deep").sessions).toBe("1,2,5,6,8,9,10,11,12,13,14,22,24,25,31,32,33,34,37");
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
      [
        "== lanes the triggers start",
        "  lane 10: OFF-AIM STREAK (lane 10)",
        "  lane 24: EXPLICIT ALLOWANCE WAIT (lane 24)",
        "  lane 31: standing (standard)",
        "  lane 33: standing (standard)",
        "  lane 34: standing (standard)",
        "  lane 36: OFF-AIM STREAK (lane 10)",
        "  lane 37: standing (standard)",
        "  launch --sessions 10,24,31,33,34,36,37",
      ].join("\n"),
    );
  });
});

describe("a read past a failed snapshot view", () => {
  const FAILED: StubOptions = {
    snapshotExit: 1,
    snapshotStatus: {
      schema: "outcome-snapshot-status/v2",
      complete: false,
      views: [
        { label: "digest", status: "failed", required: true },
        { label: "review-yield", status: "failed", required: true },
        { label: `${STUB_RUN}-scan`, status: "ok", required: true },
        { label: "timeline", status: "unsupported", required: false },
      ],
    },
  };

  it("reads every other lane, names the failed views at the top of the brief, then exits non-zero", () => {
    const reviewDir = scratchDir("ana-brief-incomplete-");
    const { code, stdout, stderr } = readThrough(stubSource(FAILED), reviewDir, "read", "--all");
    // Every lane ran, in catalogue order, before the read said anything failed.
    expect(recordedSteps(reviewDir).map((row) => row.label)).toEqual(LANES.map((lane) => lane.name));
    for (const lane of [
      "challenge",
      "delta",
      "climb",
      "yield",
      "posture",
      "timeline",
      "walls",
      "handoff",
      "gates",
      "target",
    ]) {
      expect(readFileSync(join(reviewDir, `${lane}.txt`), "utf8")).toContain("read by the stub source");
    }
    expect(existsSync(join(reviewDir, "overview.json"))).toBe(true);
    expect(stdout).toContain(
      ["== SNAPSHOT INCOMPLETE", "  digest: failed", "  review-yield: failed"].join("\n"),
    );
    // A view the snapshot does not require is the overview's to list, not a failure of the read.
    expect(stdout.split("== SNAPSHOT INCOMPLETE")[1]?.split("\n\n")[0]).not.toContain("timeline");
    // The brief says the digest's leads are missing, rather than that the digest raised none.
    expect(stdout).toContain("  digest: skipped: snapshot view digest failed");
    expect(stdout).not.toContain("no digest trigger or scan finding");
    expect(stderr).toContain("wri: snapshot incomplete: digest: failed, review-yield: failed");
    expect(code).toBe(1);
  }, 60_000);

  it("skips the overview of a snapshot that recorded no status, reads the rest and exits non-zero", () => {
    const reviewDir = scratchDir("ana-brief-no-status-");
    const { code, stdout } = readThrough(
      stubSource({ snapshotStatus: null, snapshotExit: 2 }),
      reviewDir,
      "read",
      "--lanes",
      "snapshot,overview,walls",
    );
    const [snapshot, overview, walls] = recordedSteps(reviewDir);
    expect(snapshot).toMatchObject({ label: "snapshot", ok: false });
    expect(overview?.skipped).toContain("no snapshot-status.json");
    expect(walls).toMatchObject({ label: "walls", ok: true });
    expect(stdout).toContain("== SNAPSHOT INCOMPLETE\n  snapshot-status.json: absent");
    expect(stdout).toContain("  digest: skipped: snapshot view snapshot-status.json absent");
    expect(code).toBe(1);
  }, 60_000);

  it("records an overview that could not read the snapshot as failed and reads on", () => {
    const reviewDir = scratchDir("ana-brief-torn-status-");
    const torn = { snapshotStatus: null, snapshotFiles: { "snapshot-status.json": "{" } };
    const { code } = readThrough(stubSource(torn), reviewDir, "read", "--lanes", "snapshot,overview,walls");
    expect(recordedSteps(reviewDir).map((row) => [row.label, row.ok])).toEqual([
      ["snapshot", true],
      ["overview", false],
      ["walls", true],
    ]);
    expect(readFileSync(join(reviewDir, "overview.txt"), "utf8")).toContain("snapshot-status.json");
    expect(code).toBe(1);
  }, 60_000);

  it("keeps a snapshot whose unrequired views failed a complete read", () => {
    const reviewDir = scratchDir("ana-brief-optional-");
    const optional = {
      snapshotStatus: {
        schema: "outcome-snapshot-status/v2",
        complete: true,
        views: [{ label: "timeline", status: "unsupported", required: false }],
      },
    };
    const { code, stdout } = readThrough(
      stubSource(optional),
      reviewDir,
      "read",
      "--lanes",
      "snapshot,walls",
    );
    expect(stdout).not.toContain("SNAPSHOT INCOMPLETE");
    expect(code).toBe(0);
  }, 60_000);

  it("reads every lane of a review but launches no paid lane over an incomplete snapshot", () => {
    const reviewDir = scratchDir("ana-brief-review-");
    const { code, stderr } = readThrough(stubSource(FAILED), reviewDir, "review");
    expect(existsSync(join(reviewDir, "walls.txt"))).toBe(true);
    expect(existsSync(join(reviewDir, "lanes"))).toBe(false);
    expect(stderr).toContain("snapshot incomplete");
    expect(code).toBe(1);
  }, 60_000);
});
