import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import {
  admittedLunaPlan,
  buildLunaPlan,
  bindSynthesis,
  bindPublishedSyntheses,
  deduplicateRuns,
  deterministicFacts,
  partitionByDuration,
  rankFinalists,
  weekWindow,
} from "../.claude/skills/weekly-run-review/scripts/select-best-runs.mjs";

const archiveRoots: string[] = [];
interface TestDeterministicFacts {
  denominator: {
    total: number;
    verified: number;
    passed: number;
    failed: number;
    unaccepted: number;
    nonResults: number;
  };
  batteries: {
    total: number;
    verified: number;
    inBand: number;
    saturated: number;
    nonSaturated: number;
    nonSaturatedVerified: number;
    nonSaturatedFamilies: number;
  };
  movement: {
    candidatePromoted: number;
    climbPromoted: number;
    lastAuthoringOrdinal: number;
    submits: { compared: number; moved: number; stalled: number; unchangedTree: number };
    iterationsMoved: number;
  };
  difficultyThresholds: { band: number[]; minLevelN: number };
  scanRuleIds: string[];
}

interface TestRunOverrides {
  durationMinutes?: number | null;
  lifecycle?: string;
  deterministic?: TestDeterministicFacts;
}

afterEach(() => {
  for (const root of archiveRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(key: string, overrides: TestRunOverrides = {}) {
  const base = {
    key,
    projectId: key.split("/")[0],
    runId: key.split("/")[1],
    openingPath: `/tmp/${key}/opening.json`,
    openingDigest: `${key}-opening`,
    terminalDigest: `${key}-terminal`,
    campaignId: key.split("/")[0],
    lifecycle: "terminal",
    invalid: false,
    durationMinutes: 60,
    source: { commit: "a".repeat(40) },
    archive: { synthesisPath: `/notes/${key}/main_synthesis.md` },
    deterministic: {
      denominator: { total: 25, verified: 25, passed: 20, failed: 5, unaccepted: 0, nonResults: 0 },
      batteries: {
        total: 1,
        verified: 1,
        inBand: 0,
        saturated: 0,
        nonSaturated: 1,
        nonSaturatedVerified: 25,
        nonSaturatedFamilies: 4,
      },
      movement: {
        candidatePromoted: 0,
        climbPromoted: 0,
        lastAuthoringOrdinal: 1,
        submits: { compared: 1, moved: 1, stalled: 0, unchangedTree: 0 },
        iterationsMoved: 1,
      },
      difficultyThresholds: { band: [0.2, 0.6], minLevelN: 8 },
      scanRuleIds: [],
    },
  };
  return { ...base, ...overrides };
}

describe("weekly run shortlist", () => {
  it("uses Europe/Oslo Monday boundaries across daylight saving time", () => {
    expect(weekWindow({ now: "2026-08-27T12:00:00Z", timeZone: "Europe/Oslo", week: "previous" })).toEqual({
      timeZone: "Europe/Oslo",
      week: "previous",
      start: "2026-08-16T22:00:00.000Z",
      end: "2026-08-23T22:00:00.000Z",
      membership: "terminal.writtenAt for completed runs; opening.writtenAt for unfinished appendix",
    });
    expect(weekWindow({ now: "2026-11-05T12:00:00Z", timeZone: "Europe/Oslo", week: "previous" })).toEqual({
      timeZone: "Europe/Oslo",
      week: "previous",
      start: "2026-10-25T23:00:00.000Z",
      end: "2026-11-01T23:00:00.000Z",
      membership: "terminal.writtenAt for completed runs; opening.writtenAt for unfinished appendix",
    });
  });

  it("deduplicates byte-identical copies and excludes conflicting terminals", () => {
    const first = run("a/r1");
    const duplicate = { ...first, openingPath: "/copy/a/r1/opening.json" };
    const conflict = { ...first, openingPath: "/other/a/r1/opening.json", terminalDigest: "different" };
    const deduped = deduplicateRuns([duplicate, first]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.conflict).toBe(false);
    expect(deduped[0]!.copies).toEqual(["/copy/a/r1/opening.json", "/tmp/a/r1/opening.json"]);
    expect(deduplicateRuns([first, conflict])[0]!).toMatchObject({ conflict: true, invalid: true });
  });

  it("selects finalists across several criteria without a weighted score", () => {
    const base = run("x/x").deterministic;
    const paired = run("paired/r1", {
      deterministic: { ...base, movement: { ...base.movement, candidatePromoted: 1 } },
    });
    const vertical = run("vertical/r2", {
      deterministic: {
        ...base,
        batteries: { ...base.batteries, total: 6, verified: 6 },
        movement: { ...base.movement, climbPromoted: 5, lastAuthoringOrdinal: 6, iterationsMoved: 6 },
      },
    });
    const difficulty = run("difficulty/r3", {
      deterministic: { ...base, batteries: { ...base.batteries, inBand: 1 } },
    });
    const clean = run("clean/r4", {
      deterministic: {
        ...base,
        denominator: { total: 40, verified: 40, passed: 32, failed: 8, unaccepted: 0, nonResults: 0 },
        movement: { ...base.movement, submits: { compared: 4, moved: 4, stalled: 0, unchangedTree: 0 } },
      },
    });
    const scale = run("scale/r5", {
      deterministic: {
        ...base,
        denominator: { total: 275, verified: 271, passed: 260, failed: 11, unaccepted: 3, nonResults: 1 },
        batteries: { ...base.batteries, nonSaturatedVerified: 271, nonSaturatedFamilies: 12 },
      },
    });
    const result = rankFinalists([scale, clean, difficulty, vertical, paired], 5);
    expect(result.selected.map((row) => row.key).sort()).toEqual([
      "clean/r4",
      "difficulty/r3",
      "paired/r1",
      "scale/r5",
      "vertical/r2",
    ]);
  });

  it("filters short runs before deterministic work and admits the exact threshold", () => {
    const partition = partitionByDuration(
      [
        run("short/r1", { durationMinutes: 29.99 }),
        run("boundary/r2", { durationMinutes: 30 }),
        run("unfinished/r3", { lifecycle: "unfinished", durationMinutes: null }),
        run("invalid/r4", { durationMinutes: -1 }),
      ],
      30,
    );
    expect(partition.short.map((row) => row.key)).toEqual(["short/r1"]);
    expect(partition.admitted.map((row) => row.key)).toEqual(["boundary/r2"]);
    expect(partition.unfinished.map((row) => row.key)).toEqual(["unfinished/r3"]);
    expect(partition.durationInvalid.map((row) => row.key)).toEqual(["invalid/r4"]);
  });

  it("does not treat saturated scale as informative difficulty", () => {
    const base = run("x/x").deterministic;
    const saturated = run("perfect/r1", {
      deterministic: {
        ...base,
        denominator: { total: 175, verified: 175, passed: 175, failed: 0, unaccepted: 0, nonResults: 0 },
        batteries: {
          total: 7,
          verified: 7,
          inBand: 0,
          saturated: 7,
          nonSaturated: 0,
          nonSaturatedVerified: 0,
          nonSaturatedFamilies: 0,
        },
      },
    });
    const informative = run("band/r2", {
      deterministic: { ...base, batteries: { ...base.batteries, inBand: 1 } },
    });
    const result = rankFinalists([saturated, informative], 2);
    expect(result.selected.find((row) => row.key === "band/r2")?.selectedBecause).toContain(
      "informative-difficulty",
    );
  });

  it("is deterministic and emits two finalist questions plus six cross-run challenges", () => {
    const rows = [run("z/r2"), run("a/r1")];
    const forward = rankFinalists(rows, 2);
    const reverse = rankFinalists(rows.toReversed(), 2);
    expect(forward.selected.map((row) => row.key)).toEqual(reverse.selected.map((row) => row.key));
    const plan = buildLunaPlan(forward.selected);
    expect(plan).toHaveLength(10);
    expect(new Set(plan.map((task) => task.name)).size).toBe(10);
    expect(admittedLunaPlan(forward.selected, 5)).toEqual([]);
    expect(admittedLunaPlan(forward.selected, 2)).toHaveLength(10);
  });

  it("binds a main synthesis only by the run's exact source revision", () => {
    const candidate = run("truss/r1");
    expect(bindSynthesis(candidate, [])).toEqual({ ok: false, reason: "synthesis-missing" });
    expect(bindSynthesis(candidate, [{ identity: { sourceCommit: "b".repeat(40) } }])).toEqual({
      ok: false,
      reason: "synthesis-source-mismatch",
    });
    expect(
      bindSynthesis(candidate, [
        {
          identity: { sourceCommit: candidate.source.commit },
          synthesisPath: "/main_synthesis.md",
          synthesisDigest: "digest",
        },
      ]),
    ).toMatchObject({ ok: true, archive: { synthesisDigest: "digest" } });
  });

  it("requires all nine outcome views, the WRI digest and a recorded denominator", () => {
    const candidate = run("truss/r1");
    const labels = [
      "digest",
      "builder",
      "default",
      "scan",
      "scorecard",
      "observations-warning",
      "cases-fail",
      "cases-unaccepted",
      "cases-non-result",
      "cases-pass",
    ];
    const snapshotStatus = {
      complete: true,
      views: labels.map((label) => ({
        label: new Set(["digest", "builder"]).has(label) ? label : `r1-${label}`,
        status: "ok",
      })),
    };
    const metrics = {
      schema: "outcome-metrics/v4",
      controller: {
        denominator: { state: "recorded", total: 25, verified: 25, unaccepted: 0, nonResults: 0 },
      },
      batteries: {
        battery: {
          passRate: { n: 25, successes: 15, rate: 0.6 },
          cases: { verified: 25, passed: 15, failed: 10, unaccepted: 0, nonResults: { total: 0 } },
          families: { a: {}, b: {} },
        },
      },
      promotions: [],
    };
    const scan = { schema: "outcome-scan/v1", thresholds: { band: [0.2, 0.6], minLevelN: 8 }, findings: [] };
    const scorecard = {
      schema: "campaign-scorecard/v3",
      reach: { lastAuthoring: { ordinal: 1 } },
      learningYield: {
        submits: { compared: 1, moved: 1, stalled: 0, unchangedTree: 0 },
        iterations: { moved: 1 },
      },
    };
    const result = deterministicFacts({ run: candidate, snapshotStatus, metrics, scan, scorecard });
    expect(result).toMatchObject({
      ok: true,
      facts: { denominator: { verified: 25 }, batteries: { inBand: 1 } },
    });
    snapshotStatus.views.pop();
    expect(deterministicFacts({ run: candidate, snapshotStatus, metrics, scan, scorecard })).toMatchObject({
      ok: false,
      reason: "deterministic-check-incomplete",
    });
  });

  it("binds descriptive archive folders by run and full source, refusing another schema or a conflicting source", () => {
    const repo = mkdtempSync(join(tmpdir(), "weekly-archive-"));
    archiveRoots.push(repo);
    const dir = join(repo, "notes", "runs", "truss-readable-name");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "main_synthesis.md"), "A completed review.\n");
    const candidate = run("generated-campaign/r1");
    const identity = { runId: "r1", sourceRevision: candidate.source.commit };
    const writeReview = (value: typeof identity, schema = "wri-archive/v1") =>
      writeFileSync(join(dir, "review.json"), JSON.stringify({ schema, identity: value }));
    writeReview(identity);
    expect(bindPublishedSyntheses(repo, [candidate])[0]).toMatchObject({
      archive: { synthesisPath: join(dir, "main_synthesis.md") },
    });
    const otherCampaign = run("other-campaign/r1");
    expect(bindPublishedSyntheses(repo, [candidate], [candidate, otherCampaign])[0]).toMatchObject({
      synthesisFailure: "synthesis-campaign-ambiguous",
    });
    writeReview({ ...identity, sourceRevision: "b".repeat(40) });
    expect(bindPublishedSyntheses(repo, [candidate])[0]).toMatchObject({
      synthesisFailure: "synthesis-source-mismatch",
    });
    writeReview(identity, "wri-archive/v0");
    expect(bindPublishedSyntheses(repo, [candidate])[0]).toMatchObject({
      synthesisFailure: "synthesis-missing",
    });
    writeReview({ ...identity, sourceRevision: candidate.source.commit.slice(0, 9) });
    expect(bindPublishedSyntheses(repo, [candidate])[0]).toMatchObject({
      synthesisFailure: "synthesis-missing",
    });
  });
});
