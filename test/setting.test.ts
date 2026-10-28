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
};
/** The same, as a campaign recorded it before 19 October: 120 minutes, the model's turns unlimited. */
const UNLIMITED: Recorded = { ...UNNAMED, minutes: 120, modelTurns: null };
/** One an operator recorded: another solver, an eight-minute wall, forty model turns, three tasks. */
const SHORT: Recorded = {
  solver: { model: "claude/claude-sonnet-5-5", effort: "low" },
  minutes: 8,
  modelTurns: 40,
  target: 3,
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
    const at = (solver: string, effort: string) =>
      settingNamed({ solver, "solver-effort": effort }).solver?.effort;
    // DeepSeek V4.1 Flash serves low, high and max, and pi sends `medium` as `high` (21 October).
    expect(at("openrouter/deepseek/deepseek-v4.1-flash-1017", "medium")).toBe("high");
    expect(at("openrouter/deepseek/deepseek-v4.1-flash-1017", "low")).toBe("low");
    expect(at("claude/claude-opus-5-5", "medium")).toBe("medium");
    expect(() => at("openrouter/no-such/model", "high")).toThrow("no backend serves");
    // pi would send a name it does not know as the model's lowest level.
    expect(() => at("claude/claude-opus-5-5", "hgih")).toThrow("--solver-effort hgih");
  });
});

describe("a campaign's setting, recorded once", () => {
  // Until 2026-10-09 the same flags were typed on every command, and one that differed was a note.
  it("refuses a flag that names another, and says each with what the campaign's is", () => {
    expect(() => settingAsked({ "solve-minutes": "5" }, SHORT)).toThrow(
      "--solve-minutes 5 names another setting than the campaign's, which was recorded as --solve-minutes 8. A campaign's setting is recorded once and every command runs under it: drop the flag. Another setting is another campaign",
    );
    expect(() => settingAsked({ "solve-model-turns": "20" }, SHORT)).toThrow(
      "--solve-model-turns 20 names another setting than the campaign's, which was recorded as --solve-model-turns 40.",
    );
    expect(() => settingAsked({ solver: "claude/claude-opus-5-5" }, SHORT)).toThrow(
      // The effort it names none of is the campaign's, as every flag it leaves out is.
      "--solver claude/claude-opus-5-5 --solver-effort low names another setting than the campaign's, which was recorded as --solver claude/claude-sonnet-5-5 --solver-effort low",
    );
    expect(() => settingAsked({ target: "8" }, UNLIMITED)).toThrow(
      "--target 8 names another setting than the campaign's, which was recorded as --target 24",
    );
    expect(() => settingAsked({ "solve-model-turns": "40" }, UNLIMITED)).toThrow(
      "--solve-model-turns 40 names another setting than the campaign's, which was recorded with no --solve-model-turns",
    );
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
    expect(() => recordedSetting([counted(60)])).toThrow(
      "the campaign's setting was recorded with 60 prompts a solve, and this source gives every solve 24: no tally on record speaks for it",
    );
    // Old settings still read, and their named tasks have no say in the draw or the next command.
    for (const tasks of [null, ["t-1", "t-2", "t-3"]]) {
      const old = recordedSetting([{ ...torn, data: { ...UNNAMED, tasks } }]);
      expect(old).toEqual(UNNAMED);
      expect(settingAsked({}, old)).toMatchObject({ target: 24, record: null });
    }
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
    expect(firstRecord(forgot, { ...forgot.named, solver }, ran)).toBe(
      "the campaign's log records no setting yet, and this command names another than its last test-side solves ran under, which was --solver claude/claude-sonnet-5-5 --solver-effort high --solve-minutes 30 --solve-model-turns 15. Name that setting, which is then recorded as the campaign's; another setting is another campaign (tools/d2/setting.ts)",
    );
    // Another solver under the same limits is another setting as much.
    const named = settingAsked(same, null);
    expect(
      firstRecord(named, { ...named.named, solver: { model: "p/other", effort: "high" } }, ran),
    ).toContain("names another than its last test-side solves ran under");
    // A wall with no model turns on record is named without the flag.
    const { modelTurns: _, ...unturned } = LIMITS;
    const unlimited = { ...ran, limits: { ...unturned, wallSeconds: 480 } };
    expect(firstRecord(forgot, forgot.named, unlimited)).toContain("--solve-minutes 8. Name that setting");
    // The model's turns alone make another setting.
    const turned = settingAsked({ "solve-minutes": "30", "solve-model-turns": "20" }, null);
    expect(firstRecord(turned, turned.named, ran)).toContain(
      "names another than its last test-side solves ran under",
    );
  });
});
