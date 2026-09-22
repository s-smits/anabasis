import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { OVERVIEW_SCHEMA, buildOverview, digestTriggers, readOverview } from "../.claude/skills/whole-run-investigation/scripts/run-overview.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { buildSharedInstructions, renderSharedInstructions } from "../.claude/skills/whole-run-investigation/scripts/shared-instructions.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { scaffoldArchive } from "../.claude/skills/whole-run-investigation/scripts/archive-scaffold.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { LANES, renderLanes, selectLanes } from "../.claude/skills/whole-run-investigation/scripts/wri.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const RUN = "custom-test-20260912T000000000Z-abcdef";
const COMMIT = "22d2814c5a4c9e4cd9ef35517831895c61d9b137";
const dirs: string[] = [];

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

/** A snapshot whose default view failed, with a readable controller terminal beside it. */
function snapshotFixture() {
  const campaign = temp("ana-wri-campaign-");
  const controller = join(campaign, "controller", RUN);
  mkdirSync(controller, { recursive: true });
  writeFileSync(join(controller, "opening.json"), json({ source: { commit: COMMIT } }));
  writeFileSync(
    join(controller, "terminal.json"),
    json({
      outcome: "aborted",
      abortClause: "budget-limited",
      terminalReason: "aborted: budget-limited",
      epoch: "epoch-000000000000",
      lastIteration: `${RUN}-i03`,
      iterations: [1, 2, 3],
      denominator: { state: "recorded", total: 75, verified: 70, unaccepted: 2, nonResults: 3 },
      providerResourceBudget: { cap: 100, used: 100, byRole: { builder: 3, built: 60, review: 37 } },
    }),
  );
  const snapshot = temp("ana-wri-snapshot-");
  writeFileSync(
    join(snapshot, "snapshot-status.json"),
    json({
      schema: "outcome-snapshot-status/v2",
      capturedAt: "2026-09-12T20:40:46.028Z",
      campaign,
      runIds: [RUN],
      complete: false,
      source: { commit: COMMIT, dirty: false, sourceDigest: "b".repeat(64) },
      opening: { path: join(controller, "opening.json"), sha256: "a".repeat(64) },
      facts: {
        terminalAccounting: {
          outerCap: null,
          completedRounds: 3,
          authorCalls: { budget: "uncapped", opening: 0, terminal: 3, delta: 3 },
          counts: { raw: 75, real: 75, controller: 3 },
          parents: { lastCandidate: null, adopted: null, accepted: null },
        },
      },
      views: [
        { label: `${RUN}-default`, status: "failed" },
        { label: "digest", status: "ok" },
        { label: "builder", status: "ok" },
      ],
    }),
  );
  writeFileSync(
    join(snapshot, "digest.md"),
    [
      "# deterministic digest — test",
      "",
      "FAMILY UNMOVED all-pass: alpha 5/5 → 5/5 (i01 → i02)",
      "FAMILY UNMOVED all-pass: beta 5/5 → 5/5 (i01 → i02)",
      "FAMILY UNMOVED all-pass: alpha 5/5 → 5/5 (i02 → i03)",
      "REVIEW TURNS EXCEED SOLVER TURNS (angle 28 trigger): review 37 > built 60",
      "ordinary prose line",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(snapshot, "harness-evolution.json"),
    json({
      current: { bundleSnapshotId: "bundle-1" },
      summary: { savedVersions: 3, measuredBatteries: 3, epochs: 1 },
      quickRead: {
        latestCheckpoint: {
          ordinal: 1,
          outcome: "fingerprinted",
          commit: COMMIT,
          taskSet: { tasks: 25, families: { alpha: 5, beta: 5 } },
          product: { files: 12, nonBlankLines: 100 },
        },
      },
      versions: [{ epoch: "epoch-000000000000" }],
    }),
  );
  return { snapshot, campaign };
}

describe("run overview", () => {
  it("groups digest trigger rows by trigger name with counts and two examples", () => {
    const groups = digestTriggers(
      "FOO BAR (x): one\nFOO BAR (x): two\nFOO BAR (x): three\nlower case: skipped\nZED ROW: a\n",
    );
    expect(
      groups.map((group: { name: string; rows: number; examples: string[] }) => [
        group.name,
        group.rows,
        group.examples.length,
      ]),
    ).toEqual([
      ["FOO BAR (x)", 3, 2],
      ["ZED ROW", 1, 1],
    ]);
  });

  it("derives terminal, budget and version facts from bytes even when the default view failed, and renders them", () => {
    const { snapshot } = snapshotFixture();
    const overview = buildOverview(snapshot);
    expect(overview.schema).toBe(OVERVIEW_SCHEMA);
    expect(overview.terminal.denominator).toEqual({
      state: "recorded",
      total: 75,
      verified: 70,
      unaccepted: 2,
      nonResults: 3,
    });
    expect(overview.snapshot.views.failed).toEqual([`${RUN}-default`]);
    expect(overview.orientation).toBe("");
    const rendered = renderSharedInstructions(buildSharedInstructions(overview));
    expect(rendered).toContain("Snapshot INCOMPLETE");
    expect(rendered).toContain("75 total = 70 verified + 2 unaccepted + 3 non-results");
    expect(rendered).toContain("100 of 100 turns used (builder 3, built 60, review 37)");
    expect(rendered).toContain("FAMILY UNMOVED all-pass [3 rows]: alpha 5/5");
    expect(rendered).toContain("families alpha 5, beta 5");
    expect(rendered).not.toContain("census");
  });

  it("renders the primary's edits to values and template, and refuses a token without a value", () => {
    const { snapshot } = snapshotFixture();
    const shared = buildSharedInstructions(buildOverview(snapshot));
    shared.values.terminal = "- Terminal: edited by the primary.";
    shared.values.hint = "- Read i03 first.";
    shared.template = ["{terminal}", "{hint}", "{orientation}"];
    expect(renderSharedInstructions(shared)).toBe("- Terminal: edited by the primary.\n- Read i03 first.");
    shared.template.push("{missing}");
    expect(() => renderSharedInstructions(shared)).toThrow("{missing}");
  });

  it("refuses an overview file of another schema", () => {
    const path = join(temp("ana-wri-overview-"), "overview.json");
    writeFileSync(path, json({ schema: "something-else/v1" }));
    expect(() => readOverview(path)).toThrow("wri-run-overview/v1");
  });
});

/** One finished lane plus a measured repo carrying one safeguard caller. */
function reviewFixture(): string {
  const { snapshot, campaign } = snapshotFixture();
  const repo = temp("ana-wri-repo-");
  mkdirSync(join(repo, "src", "meta"), { recursive: true });
  writeFileSync(
    join(repo, "src", "meta", "safeguard.ts"),
    "export function safeguardTriggered(id: string) { return id; }\n",
  );
  writeFileSync(join(repo, "src", "meta", "caller.ts"), 'safeguardTriggered("99-test-sensor");\n');
  const safeguards = join(campaign, "safeguards", RUN);
  mkdirSync(safeguards, { recursive: true });
  writeFileSync(
    join(safeguards, "SAFEGUARDS_LOG.txt"),
    "2026-09-12T10:00:00.000Z | 99-test-sensor | detail\n2026-09-12T10:01:00.000Z | 99-test-sensor | detail\n",
  );
  const review = temp("ana-wri-review-");
  writeFileSync(
    join(review, "wri-review.json"),
    json({
      schema: "wri-review/v1",
      reviewDir: review,
      campaign,
      runId: RUN,
      repo,
      reviewCheckout: repoRoot,
      steps: [],
    }),
  );
  const output = join(review, "lanes", "luna-output");
  mkdirSync(output, { recursive: true });
  for (const name of ["snapshot-status.json", "digest.md", "harness-evolution.json"]) {
    mkdirSync(join(review, "snapshot"), { recursive: true });
    writeFileSync(join(review, "snapshot", name), readFileSync(join(snapshot, name)));
  }
  writeFileSync(
    join(review, "lanes", "tasks.json"),
    json([
      {
        name: "angle_05",
        task: "assignedAngles: 05\nexpectedHeading: ## angle_05\n",
        admission: { schema: "wri-progressive-admission/v1", mode: "targeted" },
      },
    ]),
  );
  writeFileSync(
    join(output, "launch.json"),
    json({
      type: "luna_sessions.launch",
      model: "gpt-5.6-luna",
      reasoningEffort: "max",
      sessions: [{ name: "angle_05", promptSha256: "c".repeat(64) }],
    }),
  );
  writeFileSync(
    join(output, "summary.json"),
    json({
      type: "luna_sessions.completed",
      sessions: [
        { name: "angle_05", status: "completed", failureKind: null, threadId: "thread-1", durationMs: 4000 },
      ],
    }),
  );
  writeFileSync(
    join(output, "angle_05.md"),
    "## angle_05\n\n### Findings\n\nOracle hardness holds.  \nSecond line.\n",
  );
  return review;
}

describe("archive scaffold", () => {
  it("writes the verdicts template first, then a review.json derived from bytes and the template", () => {
    const review = reviewFixture();
    const first = scaffoldArchive(review);
    expect(first.fresh).toBe(true);
    expect(first.lanes).toBe(1);
    const verdicts = parseJsonAs<{
      angles: Record<string, { state: string }>;
      primaryReview: { protectedEvidenceChecked: boolean };
    }>(readFileSync(first.verdictsPath, "utf8"));
    expect(verdicts.angles["5"]?.state).toBe("inconclusive");
    expect(verdicts.primaryReview.protectedEvidenceChecked).toBe(false);
    const luna = readFileSync(join(first.archiveDir, "luna_syntheses.md"), "utf8");
    expect(luna).toContain("## Collection");
    expect(luna).toContain("| angle_05 | 05 | completed | thread-1 | 4 |");
    expect(luna).toContain("## angle_05\n\n### Findings");
    expect(luna.endsWith("\n\n")).toBe(false);
    expect(luna).toContain("Oracle hardness holds.\nSecond line.");
    expect(/[ \t]\n/.test(luna)).toBe(false);
    expect(existsSync(join(first.archiveDir, "main_synthesis.md"))).toBe(true);
    // The primary decides two predictions and the completed-round count before the second pass.
    const decided = {
      ...parseJsonAs<Record<string, JsonValue>>(readFileSync(first.verdictsPath, "utf8")),
      terminalAccounting: {
        completedRounds: 13,
        candidateSubmits: 13,
        controllerTerminalRows: 0,
        recordedSubmitRows: 13,
      },
      predictions: [
        { id: "p-untriggered", claim: "c", status: "untriggered" },
        { id: "p-open", claim: "c" },
        {
          id: "p-refuted",
          claim: "c",
          status: "refuted",
          dependencyWalk: {
            walked: true,
            closed: true,
            casualties: ["p-refuted"],
            survivors: ["p-open"],
            dependents: [],
          },
        },
      ],
    };
    writeFileSync(first.verdictsPath, json(decided));
    const second = scaffoldArchive(review);
    expect(second.fresh).toBe(false);
    type Review = {
      identity: { runId: string; sourceRevision: string; bundle: string };
      lifecycle: { stage: string };
      terminalAccounting: {
        denominator: { total: number; nonResult: number };
        completedRounds: number;
        counts: { controller: number };
      };
      predictions: {
        id: string;
        status: string;
        triggerEvidence: { state: string };
        effectEvidence: { state: string };
        dependencyWalk: {
          walked: boolean;
          closed: boolean;
          survivors: string[];
          evidencePointers: unknown[];
        };
      }[];
      angleStates: { angle: number; state: string; session: string }[];
      sessionStates: { id: string; reportSha256?: string }[];
      safeguards: { id: string; kind: string; status: string; count?: number }[];
      safeguardCensus: { ids: string[] };
    };
    const built = parseJsonAs<Review>(readFileSync(join(first.archiveDir, "review.json"), "utf8"));
    expect(built.identity).toMatchObject({ runId: RUN, sourceRevision: COMMIT, bundle: "bundle-1" });
    expect(built.terminalAccounting.denominator).toMatchObject({ total: 75, nonResult: 3 });
    // The states are the ones validate-archive.mjs accepts: not-triggered/unknown, and never the status names.
    expect(
      built.predictions.map((row) => [
        row.id,
        row.status,
        row.triggerEvidence.state,
        row.effectEvidence.state,
      ]),
    ).toEqual([
      ["p-untriggered", "untriggered", "not-triggered", "unknown"],
      ["p-open", "inconclusive", "triggered", "unknown"],
      ["p-refuted", "refuted", "triggered", "not-observed"],
    ]);
    // The primary's walk survives the scaffold; without it a refutation can never validate (eaf98f P17).
    expect(built.predictions[2]?.dependencyWalk).toMatchObject({
      walked: true,
      closed: true,
      survivors: ["p-open"],
    });
    expect(built.predictions[2]?.dependencyWalk.evidencePointers).toHaveLength(1);
    expect(built.predictions[0]?.dependencyWalk).toMatchObject({ walked: false, closed: false });
    expect(built.angleStates).toHaveLength(36);
    expect(built.angleStates[4]).toMatchObject({ angle: 5, state: "inconclusive", session: "angle_05" });
    expect(built.angleStates[5]).toMatchObject({ angle: 6, state: "unobservable", session: "not-launched" });
    expect(built.sessionStates.map((row) => row.id)).toEqual(["session_30", "angle_05"]);
    expect(built.safeguards.map((row) => row.id)).toEqual(["99-test-sensor"]);
    expect(built.safeguards.find((row) => row.id === "99-test-sensor")).toMatchObject({
      status: "fired",
      count: 2,
    });
    expect(built.safeguardCensus.ids).toEqual(["99-test-sensor"]);
    expect(built.lifecycle.stage).toBe("terminal");
    expect(built.terminalAccounting).toMatchObject({ completedRounds: 3, counts: { controller: 3 } });
  });

  it("marks a review without a controller terminal live and takes the completed-round count the primary recorded", () => {
    const review = reviewFixture();
    const { campaign } = parseJsonAs<{ campaign: string }>(
      readFileSync(join(review, "wri-review.json"), "utf8"),
    );
    rmSync(join(campaign, "controller", RUN, "terminal.json"));
    const statusPath = join(review, "snapshot", "snapshot-status.json");
    const status = parseJsonAs<{ facts: { terminalAccounting: JsonValue } }>(
      readFileSync(statusPath, "utf8"),
    );
    status.facts.terminalAccounting = {
      outerCap: null,
      parents: { lastCandidate: null, adopted: null, accepted: null },
    };
    writeFileSync(statusPath, json(status));
    const first = scaffoldArchive(review);
    const template = parseJsonAs<Record<string, JsonValue>>(readFileSync(first.verdictsPath, "utf8"));
    writeFileSync(
      first.verdictsPath,
      json({
        ...template,
        terminalAccounting: {
          completedRounds: 13,
          candidateSubmits: 13,
          controllerTerminalRows: 0,
          recordedSubmitRows: 13,
        },
      }),
    );
    scaffoldArchive(review);
    type Review = {
      lifecycle: { stage: string };
      terminal: { outcome: string };
      terminalAccounting: {
        state: string;
        completedRounds: number;
        counts: { controller: number };
        realAuthoringIterations: number;
      };
    };
    const built = parseJsonAs<Review>(readFileSync(join(first.archiveDir, "review.json"), "utf8"));
    expect(built.lifecycle.stage).toBe("live");
    expect(built.terminal.outcome).toBe("incomplete");
    expect(built.terminalAccounting).toMatchObject({
      state: "incomplete",
      completedRounds: 13,
      counts: { controller: 13 },
      realAuthoringIterations: 13,
    });
  });
});

describe("deterministic lane catalogue", () => {
  interface Lane {
    name: string;
    label: string;
    collect?: boolean;
  }
  const lanes: Lane[] = LANES;
  const args = (values: Record<string, string>, flags: string[] = []) => ({
    flag: (name: string) => flags.includes(name),
    value: (name: string, fallback: string | null = null) => values[name] ?? fallback,
  });
  const select = (values: Record<string, string>, flags: string[] = []): Lane[] | null =>
    selectLanes(args(values, flags));

  it("gives every lane a unique name and a label of at most three words", () => {
    const names = lanes.map((lane) => lane.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(11);
    for (const lane of lanes) expect(lane.label.split(" ").length).toBeLessThanOrEqual(3);
    expect(lanes.flatMap((lane) => (lane.collect === true ? [lane.name] : []))).toEqual([
      "snapshot",
      "challenge",
      "delta",
      "overview",
    ]);
  });

  it("selects by rank, by name and by --all, and refuses a token the catalogue does not carry", () => {
    expect(select({ lanes: "5,yield" })?.map((lane) => lane.name)).toEqual(["climb", "yield"]);
    expect(select({}, ["all"])).toHaveLength(11);
    expect(select({})).toBeNull();
    expect(() => select({ lanes: "12" })).toThrow("no lane 12");
    expect(() => select({ lanes: "velocity" })).toThrow("no lane velocity");
    expect(() => select({ lanes: "" })).toThrow("no lane");
  });

  it("prints one numbered row per lane and marks the four collect runs", () => {
    const rows: string[] = renderLanes().split("\n");
    expect(rows).toHaveLength(12);
    expect(rows[1]).toContain(" 1  snapshot");
    expect(rows[8]).toContain(" 8  timeline");
    expect(rows[9]).toContain(" 9  walls");
    expect(rows[11]).toContain("11  archive");
    expect(rows.filter((row) => row.includes("also run by collect"))).toHaveLength(4);
  });
});
