// A campaign's setting is the campaign's: who solves, what a solve is held to and how many tasks are
// drawn. It is recorded once in the log, a command that names nothing runs under the record, and
// a command that names another is refused until the operator says the campaign's setting changes.
import { afterAll, describe, expect, it } from "bun:test";
import { type LogEvent, read } from "../src/kernel/log.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { LIMITS } from "../tools/d2/campaign.ts";
import { ROUND_OPTIONS } from "../tools/d2/round.ts";
import {
  firstRecord,
  keepSetting,
  type Recorded,
  recordedSetting,
  SETTING_OPTIONS,
  settingAsked,
  settingNamed,
  targetNamed,
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
  it("is the stored sweep's limits and the cycle's own solver where no flag is given", () => {
    expect(settingNamed({})).toEqual({ solver: undefined, limits: LIMITS });
    // With no --solver the effort flag names nothing: the stored cycle's model solves at its effort.
    expect(settingNamed({ "solver-effort": "low" }).solver).toBeUndefined();
  });

  it("is read by every command through the one owner's options", () => {
    for (const flag of ["solver", "solver-effort", "solve-minutes", "solve-model-turns"] as const) {
      expect(ROUND_OPTIONS[flag]).toBe(SETTING_OPTIONS[flag]);
    }
  });

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

  it("holds one command to a share of the wall: a quarter by default and half at most", () => {
    const walled = (minutes: string) => {
      const { shellDefaultSeconds, shellMaxSeconds } = settingNamed({ "solve-minutes": minutes }).limits;
      return [shellDefaultSeconds, shellMaxSeconds];
    };
    expect(walled("120")).toEqual([300, 900]);
    expect(walled("30")).toEqual([300, 900]);
    expect(walled("20")).toEqual([300, 600]);
    // Under five minutes a command the sweep allowed 300 s would never return.
    expect(walled("5")).toEqual([75, 150]);
    expect(walled("1")).toEqual([15, 30]);
  });

  it("refuses a wall, a number of model turns or a target that is no whole number of at least one", () => {
    for (const minutes of ["0", "1.5", "two hours"]) {
      expect(() => settingNamed({ "solve-minutes": minutes })).toThrow(
        `--solve-minutes ${minutes}: a solve's wall is a whole number of minutes, at least one`,
      );
    }
    for (const turns of ["0", "2.5", "many"]) {
      expect(() => settingNamed({ "solve-model-turns": turns })).toThrow(
        "a solve's model turns are a whole number of at least one",
      );
    }
    // No number would draw no task, and a negative one all but the last.
    for (const target of ["twelve", "-1", "0", "2.5"]) {
      expect(() => targetNamed(target)).toThrow(
        `--target ${target}: the tasks to score are a whole number of at least one`,
      );
    }
  });
});

describe("a campaign's setting, recorded once", () => {
  it("is what the first command names, or the defaults, and that command records it", () => {
    expect(settingAsked({}, null)).toEqual({
      named: { solver: undefined, limits: LIMITS },
      target: 24,
      record: UNNAMED,
      first: true,
    });
    const first = settingAsked(
      {
        solver: "claude/claude-sonnet-5-5",
        "solver-effort": "low",
        "solve-minutes": "8",
        "solve-model-turns": "40",
        target: "3",
      },
      null,
    );
    expect(first.record).toEqual(SHORT);
    expect(first.named.limits).toMatchObject({ wallSeconds: 480, modelTurns: 40, shellDefaultSeconds: 120 });
    expect(first.target).toBe(3);
  });

  it("is what a command that names nothing runs under, with nothing more to record", () => {
    const asked = settingAsked({}, SHORT);
    expect(asked.record).toBeNull();
    expect(asked.named).toEqual(
      settingNamed({
        solver: "claude/claude-sonnet-5-5",
        "solver-effort": "low",
        "solve-minutes": "8",
        "solve-model-turns": "40",
      }),
    );
    expect(asked).toMatchObject({ target: 3 });
    // Named again as it stands, it is the same setting: a flag that agrees is no other.
    const again = settingAsked({ "solve-minutes": "8", "solve-model-turns": "40", target: "3" }, SHORT);
    expect(again.record).toBeNull();
    expect(again.named).toEqual(asked.named);
    expect(settingAsked({ target: "24" }, UNNAMED)).toMatchObject({
      record: null,
      target: 24,
    });
    // A record from before the one budget runs on under its own limits, the turns unlimited: the
    // default of 20 is a first record's alone, and would otherwise refuse every such campaign.
    const old = settingAsked({}, UNLIMITED);
    expect(old.record).toBeNull();
    expect(old.named.limits.wallSeconds).toBe(7200);
    expect(old.named.limits).not.toHaveProperty("modelTurns");
  });

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

  // 13 October: Claude Code serves claude-haiku-5-5 a 200K context, under the sweep's 300K window.
  it("keeps the window a solver compacts at beside the solver, and names it in a refusal", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-setting-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const log = join(root, "log.jsonl");
    const haiku = { solver: "claude/claude-haiku-5-5", "solver-effort": "high", "solver-window": "200000" };
    keepSetting(log, settingAsked(haiku, null));
    const kept = recordedSetting(read(log));
    expect(kept?.solver).toEqual({ model: "claude/claude-haiku-5-5", effort: "high", window: 200_000 });
    expect(settingAsked({}, kept).named.solver).toEqual({
      model: "claude/claude-haiku-5-5",
      effort: "high",
      window: 200_000,
    });
    expect(() => settingAsked({ "solver-window": "150000" }, kept)).toThrow(
      "--solver claude/claude-haiku-5-5 --solver-effort high --solver-window 150000 names another setting than the campaign's, which was recorded as --solver claude/claude-haiku-5-5 --solver-effort high --solver-window 200000",
    );
    // A record without a window is the sweep's window, as every record before it was.
    expect(settingAsked({}, SHORT).named.solver).toEqual({
      model: "claude/claude-sonnet-5-5",
      effort: "low",
    });
    expect(() => settingNamed({ ...haiku, "solver-window": "2e5.5" })).toThrow(
      "--solver-window 2e5.5: a solver's compaction window is a whole number of tokens",
    );
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

  it("is free where the command names that setting, and where nothing was solved", () => {
    const named = settingAsked(same, null);
    expect(firstRecord(named, { ...named.named, solver }, ran)).toBeUndefined();
    // A launch knows the solver only where a flag names it, and holds the limits alone otherwise.
    expect(firstRecord(named, named.named, ran)).toBeUndefined();
    const forgot = settingAsked({}, null);
    expect(firstRecord(forgot, forgot.named, null)).toBeUndefined();
    // Once a record stands it is the record that holds a command, and this question is not asked.
    const recorded = settingAsked({}, SHORT);
    expect(recorded.first).toBe(false);
    expect(firstRecord(recorded, recorded.named, ran)).toBeUndefined();
  });
});
