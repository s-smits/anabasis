// A campaign's setting is the campaign's: who solves, what a solve is held to and how many tasks are
// drawn. It is recorded once in the log, a command that names nothing runs under the record, and
// a command that names another is refused until the operator says the campaign's setting changes.
import { afterAll, describe, expect, it } from "bun:test";
import { type LogEvent, read } from "../src/kernel/log.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { LIMITS } from "../tools/d2/campaign.ts";
import {
  firstRecord,
  keepSetting,
  type Recorded,
  recordedSetting,
  SETTING_OPTIONS,
  settingAsked,
  settingNamed,
} from "../tools/d2/setting.ts";

/** The setting of a campaign no command has named anything for: the one budget every solver is
 *  held to since 19 October (`LIMITS`), and 24 tasks to score since 12 October (`SIZE`), 12 before. */
const UNNAMED: Recorded = {
  solver: null,
  minutes: 30,
  modelTurns: 20,
  target: 24,
  solves: 2,
};
/** The same, as a campaign recorded it before 19 October: 120 minutes, the model's turns unlimited. */
const UNLIMITED: Recorded = { ...UNNAMED, minutes: 120, modelTurns: null };
/** One an operator recorded: another solver, an eight-minute wall, forty model turns, three tasks. */
const SHORT: Recorded = {
  solver: { model: "claude/claude-sonnet-5-5", effort: "low" },
  minutes: 8,
  modelTurns: 40,
  target: 3,
  solves: 4,
};

describe("what the flags of a setting name", () => {
  it("is another wall, a number of the model's own turns, or another solver", () => {
    const longer = settingNamed({ "solve-minutes": "240" }).limits;
    // The prompts a solve is given are every solve's (`LIMITS.turns`): until 2026-10-11
    // `--solve-turns` named them, and no command takes the flag since.
    expect(longer).toEqual({ ...LIMITS, wallSeconds: 14_400 });
    expect(SETTING_OPTIONS).not.toHaveProperty("solve-turns");
    // The model's own turns are the one budget's where no command names a number, whoever solves.
    expect(longer.modelTurns).toBe(LIMITS.modelTurns);
    expect(settingNamed({ "solve-model-turns": "40" }).limits).toEqual({ ...LIMITS, modelTurns: 40 });
    expect(settingNamed({ solver: "claude/claude-sonnet-5-5", "solver-effort": "low" }).solver).toEqual({
      model: "claude/claude-sonnet-5-5",
      effort: "low",
    });
  });

  it("records the effort pi sends: a level the model does not serve as the next one it does", () => {
    for (const [solver, effort, expected] of [
      ["openrouter/deepseek/deepseek-v4.1-flash-1017", "medium", "high"],
      ["openrouter/deepseek/deepseek-v4.1-flash-1017", "low", "low"],
      ["claude/claude-opus-5-5", "medium", "medium"],
    ] as const) {
      expect(settingNamed({ solver, "solver-effort": effort }).solver?.effort).toBe(expected);
    }
    expect(() => settingNamed({ solver: "openrouter/no-such/model", "solver-effort": "high" })).toThrow(
      /no backend/u,
    );
    expect(() => settingNamed({ solver: "claude/claude-opus-5-5", "solver-effort": "hgih" })).toThrow(
      /--solver-effort hgih/u,
    );
  });
});

describe("a campaign's setting, recorded once", () => {
  // Until 2026-10-09 the same flags were typed on every command, and one that differed was a note.
  it("refuses a flag that names another, and says each with what the campaign's is", () => {
    for (const [flags, recorded, fact] of [
      [{ "solve-minutes": "5" }, SHORT, /--solve-minutes 5.*--solve-minutes 8/u],
      [{ "solve-model-turns": "20" }, SHORT, /--solve-model-turns 20.*--solve-model-turns 40/u],
      [
        { solver: "claude/claude-opus-5-5" },
        SHORT,
        /--solver claude\/claude-opus-5-5 --solver-effort low.*--solver claude\/claude-sonnet-5-5 --solver-effort low/u,
      ],
      [{ target: "8" }, UNLIMITED, /--target 8.*--target 24/u],
      [{ solves: "2" }, SHORT, /--solves 2.*--solves 4/u],
      [{ "solve-model-turns": "40" }, UNLIMITED, /--solve-model-turns 40.*no --solve-model-turns/u],
    ] as const) {
      expect(() => settingAsked(flags, recorded)).toThrow(fact);
    }
  });

  it("is kept in the log as the command begins, and read back as the last one kept", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-setting-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const log = join(root, "log.jsonl");
    expect(recordedSetting(read(log))).toBeNull();
    keepSetting(log, settingAsked({}, null));
    expect(recordedSetting(read(log))).toEqual(UNNAMED);
    expect(read(log)[0]?.data).not.toHaveProperty("tasks");
    // A command that runs under the record keeps nothing more.
    keepSetting(log, settingAsked({}, recordedSetting(read(log))));
    expect(read(log)).toHaveLength(1);
    // A second record on a log, as a command of before 2026-10-11 wrote on `--new-setting`, is the
    // one read back: the last stands, and no command writes one since.
    keepSetting(log, settingAsked({ "solve-minutes": "8" }, null));
    expect(recordedSetting(read(log))).toEqual({ ...UNNAMED, minutes: 8 });
    expect(read(log).map(({ kind }) => kind)).toEqual(["campaign.setting", "campaign.setting"]);
    // A record that does not read whole is none: a command then says what it runs under afresh.
    const torn: LogEvent = {
      at: "2026-10-09T00:00:00.000Z",
      kind: "campaign.setting",
      data: { minutes: "8" },
    };
    expect(recordedSetting([torn])).toBeNull();
    // A record of 10 October holds the prompts a solve was given; one that held another count than
    // every solve is given now ran under another setting, and is refused rather than read as this one.
    const counted = (turns: number): LogEvent => ({ ...torn, data: { ...UNNAMED, turns } });
    expect(recordedSetting([counted(24)])).toEqual(UNNAMED);
    expect(() => recordedSetting([counted(60)])).toThrow(/60 prompts.*24/u);
    // Old settings still read, and their named tasks have no say in the draw or the next command.
    for (const tasks of [null, ["t-1", "t-2", "t-3"]]) {
      const old = recordedSetting([{ ...torn, data: { ...UNNAMED, tasks } }]);
      expect(old).toEqual(UNNAMED);
      expect(settingAsked({}, old)).toMatchObject({ target: 24, record: null });
    }
  });

  it("names the solves a side once, and every command then compares at that count", () => {
    expect(settingAsked({ solves: "4" }, null)).toMatchObject({ solves: 4, record: { solves: 4 } });
    expect(settingAsked({}, SHORT)).toMatchObject({ solves: 4, record: null });
    expect(settingAsked({ solves: "4" }, SHORT)).toMatchObject({ solves: 4, record: null });
    for (const flag of ["0", "1.5", "two"]) {
      expect(() => settingAsked({ solves: flag }, null)).toThrow(/--solves .*whole number/u);
    }
    // A record from before the count was a setting reads at the count its comparisons began at, so
    // a campaign continued under this source keeps it; with no comparison, at the default, two.
    const { solves: _, ...before } = SHORT;
    const setting: LogEvent = { at: "2026-10-28T00:00:00.000Z", kind: "campaign.setting", data: before };
    expect(recordedSetting([setting])?.solves).toBe(2);
    const began: LogEvent = {
      at: "2026-10-28T01:00:00.000Z",
      kind: "comparison.started",
      data: { solves: 4 },
    };
    const old = recordedSetting([setting, began]);
    expect(old?.solves).toBe(4);
    expect(() => settingAsked({ solves: "2" }, old)).toThrow(/--solves 2.*--solves 4/u);
  });
});

// A campaign whose solves were made before a setting was recorded has one all the same: the one
// its last test-side solves ran under. Recode ran on 9 October with its solver held to 15 of its
// own turns, under a 30-minute wall, and its log holds no record.
describe("the first record of a campaign that already holds solves", () => {
  const ran = {
    model: "claude/claude-sonnet-5-5",
    effort: "high",
    limits: { ...LIMITS, wallSeconds: 1800, modelTurns: 15 },
  };
  const same = { "solve-minutes": "30", "solve-model-turns": "15" };
  const solver = { model: ran.model, effort: ran.effort };

  it("is the setting those solves ran under, named as flags where a command names another", () => {
    const forgot = settingAsked({}, null);
    expect(forgot.first).toBe(true);
    const mismatch = firstRecord(forgot, { ...forgot.named, solver }, ran);
    for (const fact of [
      "--solver claude/claude-sonnet-5-5",
      "--solver-effort high",
      "--solve-minutes 30",
      "--solve-model-turns 15",
    ]) {
      expect(mismatch).toContain(fact);
    }
    // Another solver under the same limits is another setting as much.
    const named = settingAsked(same, null);
    expect(firstRecord(named, { ...named.named, solver }, ran)).toBeUndefined();
    expect(
      firstRecord(named, { ...named.named, solver: { model: "p/other", effort: "high" } }, ran),
    ).toContain("another");
    // A wall with no model turns on record is named without the flag.
    const { modelTurns: _, ...unturned } = LIMITS;
    const unlimited = { ...ran, limits: { ...unturned, wallSeconds: 480 } };
    const prior = firstRecord(forgot, forgot.named, unlimited);
    expect(prior).toContain("--solve-minutes 8");
    expect(prior).not.toContain("--solve-model-turns");
    // The model's turns alone make another setting.
    const turned = settingAsked({ "solve-minutes": "30", "solve-model-turns": "20" }, null);
    expect(firstRecord(turned, turned.named, ran)).toContain("another");
  });
});
