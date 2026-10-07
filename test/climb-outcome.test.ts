import { describe, expect, it } from "bun:test";
import type { CaseOutcome } from "../src/claim/case-record.ts";
import {
  type ArmInput,
  type Battery,
  type CellInput,
  caseKey,
  compareClimb,
  decide,
  type FailLabel,
  healthGuard,
  lineageKey,
  marginFor,
  parseLabels,
} from "../.claude/skills/run-improvement-campaign/scripts/climb-outcome.ts";
import { seedRecord } from "../.claude/skills/run-improvement-campaign/scripts/climb-outcome-cli.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

/** One case row: the task, its byte identity, its outcome, and the minute its solve ended. */
type Row = [taskId: string, bytes: string | null, outcome: CaseOutcome, ended?: number];
/** One label as M2 keys it: the battery, the task, the label and the campaign (`CAMPAIGN` unless named). */
type LabelRow = [runId: string, taskId: string, label: FailLabel, campaign?: string];

const CAMPAIGN = "/repo/campaigns/demo";
const at = (minute: number) => `2026-10-07T10:${String(minute).padStart(2, "0")}:00.000Z`;

/** A battery of `rows`, filed under the product tree `tree` (its own run id unless named). */
function battery(runId: string, rows: Row[], tree = runId, campaign = CAMPAIGN): Battery {
  return {
    runId,
    tree: `${campaign}/versions/${tree}`,
    wallShare: null,
    cases: rows.map(([taskId, bytes, outcome, ended]) => ({
      campaign,
      battery: runId,
      taskId,
      bytes,
      outcome,
      endedAt: ended === undefined ? null : at(ended),
    })),
  };
}

/** An arm of `batteries`, the rounds it opened, and the task ids its seed failed in `CAMPAIGN`. */
const arm = (batteries: Battery[], roundStarts: string[] = [], seedFailed: string[] = []): ArmInput => ({
  batteries,
  roundStarts,
  seedFailed: new Set(seedFailed.map((taskId) => lineageKey(CAMPAIGN, taskId))),
});

const cell = (control: ArmInput, treatment: ArmInput, seed: string[] = [], key = "cell"): CellInput => ({
  key,
  seed: new Set(seed),
  control,
  treatment,
});

/** Labels keyed as M2 writes them: by campaign, battery and task. */
const labels = (rows: LabelRow[]) =>
  new Map(
    rows.map(([runId, taskId, label, campaign = CAMPAIGN]) => [caseKey(campaign, runId, taskId), label]),
  );

/** `count` single-task batteries, each its own task set, every task failing or every one passing. */
const rounds = (prefix: string, count: number, outcome: CaseOutcome) =>
  Array.from({ length: count }, (_, index) =>
    battery(`${prefix}-${index}`, [[`${prefix}-task-${index}`, `b${index}`, outcome]]),
  );

describe("caseKey", () => {
  // Fixed vectors M2 checks its own implementation against: the first 16 hex characters of the
  // sha256 of `<real campaign dir>\0<battery runId>\0<taskId>`, the task id encoded as UTF-8.
  it("matches the two fixed vectors", () => {
    expect(
      caseKey(
        "/Users/air/Developer/anabasis/campaigns/buffer-b2-a",
        "standard-opus-20261001T113913755Z-pr118-2590f77",
        "task-01",
      ),
    ).toBe("4f26bcfbf801d8f0");
    expect(caseKey("/srv/campaigns/esp32-arm", "cap-arm-20261001-i03", "tâche-02")).toBe("499f248cba9d5eab");
  });

  it("is stable, and moves with each of its three parts", () => {
    const key = caseKey(CAMPAIGN, "run-i02", "t1");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(caseKey(CAMPAIGN, "run-i02", "t1")).toBe(key);
    const moved = [
      caseKey(`${CAMPAIGN}-2`, "run-i02", "t1"),
      caseKey(CAMPAIGN, "run-i03", "t1"),
      caseKey(CAMPAIGN, "run-i02", "t2"),
    ];
    expect(new Set([key, ...moved]).size).toBe(4);
  });
});

describe("the frozen rule", () => {
  it("censors below 12 pooled rounds and widens the margin at 17 and at 24", () => {
    expect([0, 11, 12, 16, 17, 23, 24, 60].map(marginFor)).toEqual([null, null, 5, 5, 6, 6, 7, 7]);
  });

  it("decides each band at its edges, a tie inconclusive", () => {
    expect(decide(11, 20, "holds")).toBe("censored");
    for (const [pooled, margin] of [
      [12, 5],
      [16, 5],
      [17, 6],
      [23, 6],
      [24, 7],
    ] as const) {
      expect(decide(pooled, margin, "holds")).toBe("supported");
      expect(decide(pooled, margin - 1, "holds")).toBe("inconclusive");
      expect(decide(pooled, -margin, "holds")).toBe("against");
      expect(decide(pooled, 1 - margin, "holds")).toBe("inconclusive");
      expect(decide(pooled, 0, "holds")).toBe("inconclusive");
    }
  });

  it("refutes on a failed guard once uncensored, and a censored guard does not fail", () => {
    expect(decide(12, 9, "fails")).toBe("refuted");
    expect(decide(12, -9, "fails")).toBe("refuted");
    expect(decide(11, 9, "fails")).toBe("censored");
    expect(decide(12, 5, "censored")).toBe("supported");
  });
});

describe("the health guard", () => {
  // Each entry is the label of one fresh failure, null when M2 gave none.
  it("is censored below four classified failures, whatever they are", () => {
    expect(healthGuard(["check-defect", "under-specified", "check-defect"])).toEqual({
      classified: 3,
      defects: 3,
      state: "censored",
    });
  });

  it("fails only when more than half of the classified failures are defects", () => {
    expect(healthGuard(["check-defect", "under-specified", "limit", "wall-ended"]).state).toBe("holds");
    expect(healthGuard(["check-defect", "under-specified", "check-defect", "limit"]).state).toBe("fails");
  });

  it("leaves an unclassified or unlabelled failure out of the count", () => {
    expect(healthGuard(["check-defect", null, "unclassified", "check-defect", null])).toEqual({
      classified: 2,
      defects: 2,
      state: "censored",
    });
  });
});

describe("compareClimb", () => {
  it("counts a fail as fresh only when its bytes never failed and its task did not fail just before", () => {
    // `kept` fails, fails again unchanged, passes and fails again on the same bytes: one fresh fail.
    // `edited` fails and fails again edited: one. `eased` fails, passes edited, then fails edited
    // again: two, since the second follows a pass on bytes that never failed.
    const head = arm([
      battery("h1", [
        ["kept", "K", "fail"],
        ["edited", "E1", "fail"],
        ["eased", "A1", "fail"],
      ]),
      battery("h2", [
        ["kept", "K", "fail"],
        ["edited", "E2", "fail"],
        ["eased", "A2", "pass"],
      ]),
      battery("h3", [
        ["kept", "K", "pass"],
        ["eased", "A3", "fail"],
      ]),
      battery("h4", [["kept", "K", "fail"]]),
    ]);
    const main = arm(rounds("m", 4, "pass"));
    const every = ["h1", "h2", "h3", "h4"].flatMap((runId) =>
      ["kept", "edited", "eased"].map((taskId): LabelRow => [runId, taskId, "limit"]),
    );
    const { treatment, control, rule } = compareClimb([cell(main, head)], labels(every));
    expect(treatment.fresh).toEqual({ failing: 4, valid: 4 });
    expect(treatment.lineages).toEqual({ measured: 3, failing: 3, failedAfterEdit: 2 });
    expect(treatment.bytes).toEqual({ measured: 6, failing: 5, unread: 0 });
    expect(treatment.validSets).toBe(2);
    expect(control.lineages.measured).toBe(4);
    expect(rule).toMatchObject({ rounds: 4, difference: 4, verdict: "censored" });
  });

  it("counts the seed's own batteries, carried or continued, in neither arm, wherever they stand", () => {
    const source = "/repo/campaigns/source";
    const head = "/repo/campaigns/head";
    // The control continues the campaign the seed round ran in; the treatment is its republish,
    // whose first battery of its own is kept although it comes first.
    const control = arm([
      battery("src", [["a", "A", "fail"]], "src", source),
      battery("src-i02", [["a", "A", "fail"]], "src-i02", source),
      battery("ctl-i03", [["a", "A", "pass"]], "ctl-i03", source),
    ]);
    const treatment = arm([
      battery("arm", [["a", "A", "fail"]], "arm", head),
      battery("src-i02", [["a", "A", "fail"]], "seed-src-i02", head),
      battery("arm-i02", [["a", "A", "pass"]], "arm-i02", head),
    ]);
    const marks = labels([
      ["src", "a", "limit", source],
      ["src-i02", "a", "limit", source],
      ["src-i02", "a", "limit", head],
      ["arm", "a", "limit", head],
    ]);
    const outcome = compareClimb([cell(control, treatment, ["src", "src-i02"])], marks);
    expect(outcome.cells).toEqual([
      {
        key: "cell",
        reached: { control: 1, treatment: 2 },
        paired: 1,
        seedExcluded: { control: 2, treatment: 1 },
      },
    ]);
    expect(outcome.control.fresh).toEqual({ failing: 0, valid: 0 });
    expect(outcome.treatment.fresh).toEqual({ failing: 1, valid: 1 });
  });

  it("pairs each cell on the rounds both arms reached, then pools the cells", () => {
    const other = "/repo/campaigns/other";
    const a = cell(
      arm(
        [
          battery("ca-1", [["x", "X", "pass", 5]]),
          battery("ca-2", [["y", "Y", "fail", 15]]),
          battery("ca-3", [["z", "Z", "fail", 25]]),
        ],
        [at(1), at(10), at(20)],
      ),
      arm([battery("ta-1", [["x", "X", "fail", 6]])], [at(2), at(30)]),
      [],
      "A",
    );
    // No solve end is recorded for the control's paired set here, so every round it opened counts.
    const b = cell(
      arm([battery("cb-1", [["x", "X", "fail"]], "cb-1", other)], [at(1)]),
      arm(
        [
          battery("tb-1", [["x", "X", "pass", 1]], "tb-1", other),
          battery("tb-2", [["y", "Y", "fail"]], "tb-2", other),
        ],
        [at(1), at(2)],
      ),
      [],
      "B",
    );
    const every = ["ca-2", "ca-3", "ta-1", "cb-1", "tb-2"].flatMap((runId) =>
      ["x", "y", "z"].flatMap((taskId) =>
        [CAMPAIGN, other].map((campaign): LabelRow => [runId, taskId, "limit", campaign]),
      ),
    );
    const outcome = compareClimb([a, b], labels(every));
    expect(outcome.cells.map(({ key, paired, reached }) => ({ key, paired, reached }))).toEqual([
      { key: "A", paired: 1, reached: { control: 3, treatment: 1 } },
      { key: "B", paired: 1, reached: { control: 1, treatment: 2 } },
    ]);
    expect(outcome.rule.rounds).toBe(2);
    // Cell A's later control fails and cell B's later treatment fail lie past the pairing.
    expect(outcome.control.lineages).toMatchObject({ measured: 2, failing: 1 });
    expect(outcome.treatment.lineages).toMatchObject({ measured: 2, failing: 1 });
    expect(outcome.control.fresh).toEqual({ failing: 1, valid: 1 });
    expect(outcome.treatment.fresh).toEqual({ failing: 1, valid: 1 });
    // Started rounds are those opened by the end of each cell's last paired task set.
    expect(outcome.control.rounds).toEqual({ started: 2, total: 4 });
    expect(outcome.treatment.rounds).toEqual({ started: 2, total: 4 });
  });

  it("counts a fresh failure valid only when M2 labels it a limit", () => {
    const head = arm([
      battery("h1", [
        ["unlabelled", "U", "fail"],
        ["limit", "L", "fail"],
        ["defect", "D", "fail"],
        ["wall", "W", "fail"],
      ]),
    ]);
    const marks = labels([
      ["h1", "limit", "limit"],
      ["h1", "defect", "check-defect"],
      ["h1", "wall", "wall-ended"],
    ]);
    const { treatment, rule } = compareClimb([cell(arm(rounds("m", 1, "pass")), head)], marks);
    expect(treatment.fresh).toEqual({ failing: 4, valid: 1 });
    expect(treatment.labels).toEqual({
      limit: 1,
      "check-defect": 1,
      "under-specified": 0,
      "wall-ended": 1,
      unclassified: 0,
      unlabelled: 1,
    });
    expect(rule.guard).toEqual({ classified: 3, defects: 1, state: "censored" });
  });

  it("counts a defect lineage re-measured in three rounds once in the guard", () => {
    // By measurement this head would fail the guard, 4 defective of 6; by fresh failure it holds,
    // 2 of 4, since the kept task's repeats follow its own fail.
    const head = arm([
      battery("h1", [
        ["kept-defect", "K", "fail"],
        ["other-defect", "O", "fail"],
        ["a", "A", "fail"],
        ["b", "B", "fail"],
      ]),
      battery("h2", [["kept-defect", "K", "fail"]]),
      battery("h3", [["kept-defect", "K", "fail"]]),
    ]);
    const marks = labels([
      ["h1", "kept-defect", "check-defect"],
      ["h2", "kept-defect", "check-defect"],
      ["h3", "kept-defect", "check-defect"],
      ["h1", "other-defect", "under-specified"],
      ["h1", "a", "limit"],
      ["h1", "b", "limit"],
    ]);
    const { rule } = compareClimb([cell(arm(rounds("m", 3, "pass")), head)], marks);
    expect(rule.guard).toEqual({ classified: 4, defects: 2, state: "holds" });
  });

  it("starts a task the seed failed as failed, so only its fail after a pass counts", () => {
    // `seeded` failed in the seed: kept and edited it fails again uncounted, then passes, then fails.
    const head = arm(
      [
        battery("h1", [
          ["seeded", "S", "fail"],
          ["new", "N", "fail"],
        ]),
        battery("h2", [["seeded", "S2", "fail"]]),
        battery("h3", [["seeded", "S3", "pass"]]),
        battery("h4", [["seeded", "S4", "fail"]]),
      ],
      [],
      ["seeded"],
    );
    const every = ["h1", "h2", "h3", "h4"].flatMap((runId) =>
      ["seeded", "new"].map((taskId): LabelRow => [runId, taskId, "limit"]),
    );
    const { treatment, rule } = compareClimb([cell(arm(rounds("m", 4, "pass")), head)], labels(every));
    expect(treatment.fresh).toEqual({ failing: 2, valid: 2 });
    expect(treatment.taskSets).toBe(4);
    expect(rule.difference).toBe(2);
  });

  it("supports a head that holds more valid failures past the margin, and refutes a defective one", () => {
    const main = arm(rounds("m", 12, "pass"));
    const head = arm(rounds("h", 12, "fail"));
    const marked = (label: FailLabel) =>
      labels(Array.from({ length: 12 }, (_, index) => [`h-${index}`, `h-task-${index}`, label]));
    expect(compareClimb([cell(main, head)], marked("limit")).rule).toEqual({
      rounds: 12,
      margin: 5,
      difference: 12,
      guard: { classified: 12, defects: 0, state: "holds" },
      verdict: "supported",
    });
    expect(compareClimb([cell(main, head)], marked("check-defect")).rule.verdict).toBe("refuted");
    expect(compareClimb([cell(head, main)], marked("limit")).rule).toMatchObject({
      difference: -12,
      verdict: "against",
    });
  });
});

describe("parseLabels", () => {
  it("reads one label per case key and skips blank lines", () => {
    const text = `{"caseKey":"4f26bcfbf801d8f0","label":"limit"}\n\n{"caseKey":"499f248cba9d5eab","label":"wall-ended"}\n`;
    expect([...parseLabels(text)]).toEqual([
      ["4f26bcfbf801d8f0", "limit"],
      ["499f248cba9d5eab", "wall-ended"],
    ]);
  });

  it("refuses an unknown label and two labels for one case, naming the line", () => {
    expect(() => parseLabels(`{"caseKey":"4f26bcfbf801d8f0","label":"easy"}`)).toThrow("line 1");
    const twice = `{"caseKey":"4f26bcfbf801d8f0","label":"limit"}\n{"caseKey":"4f26bcfbf801d8f0","label":"check-defect"}`;
    expect(() => parseLabels(twice)).toThrow("line 2");
  });
});

describe("seedRecord", () => {
  it("reads a republished campaign's carried batteries and their tasks, leaving its own runs", () => {
    const campaign = join(mkdtempSync(join(tmpdir(), "climb-outcome-")), "campaigns", "head");
    const runs = join(campaign, "versions", "seed-src-i02", "runs");
    // Two batteries carried from the seed, and the arm's own remeasure of the seed product.
    const measured = { src: ["a", "b"], "src-i02": ["b", "c"], "own-i02": ["d"] };
    for (const [runId, tasks] of Object.entries(measured)) {
      mkdirSync(join(runs, runId), { recursive: true });
      // `a` failed in the seed, and `d` in the arm's own remeasure, which is not the seed's.
      const cases = tasks.map((taskId) => ({ taskId, pass: taskId !== "a" && taskId !== "d" }));
      writeFileSync(join(runs, runId, "battery.json"), JSON.stringify({ cases }));
    }
    mkdirSync(join(campaign, "controller", "own"), { recursive: true });
    writeFileSync(join(campaign, "controller", "own", "opening.json"), "{}");
    const record = {
      schema: "simulation-seed/v1",
      mode: "republish",
      slug: "source",
      selectedProductId: "seed-src-i02",
    };
    writeFileSync(join(campaign, "seed.json"), JSON.stringify({ ...record, carried: { historyRuns: 2 } }));
    expect(seedRecord(campaign)).toEqual({
      source: "source",
      batteries: ["src", "src-i02"],
      carried: 2,
      tasks: ["a", "b", "c"],
      failed: ["a"],
    });
    expect(seedRecord(join(campaign, "..", "unseeded"))).toBeNull();
  });
});
