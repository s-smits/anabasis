// A campaign's setting is the campaign's: who solves, what a solve is held to and which tasks are
// scored. It is recorded once in the log, a command that names nothing runs under the record, and
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
  restarts,
  SETTING_DEFAULTS,
  SETTING_OPTIONS,
  settingAsked,
  settingNamed,
  targetNamed,
} from "../tools/d2/setting.ts";

/** The setting of a campaign no command has named anything for. */
const UNNAMED: Recorded = {
  solver: null,
  minutes: 120,
  modelTurns: null,
  tasks: null,
  target: 12,
};
/** One an operator recorded: another solver, an eight-minute wall, forty model turns, three tasks. */
const SHORT: Recorded = {
  solver: { model: "anthropic/claude-sonnet-5-5", effort: "low" },
  minutes: 8,
  modelTurns: 40,
  tasks: ["t-1", "t-2", "t-3"],
  target: 12,
};

describe("what the flags of a setting name", () => {
  it("is the stored sweep's limits and the cycle's own solver where no flag is given", () => {
    expect(settingNamed({})).toEqual({ solver: undefined, limits: LIMITS });
    // The defaults are the sweep's limits spelled out, so that a command's help and its source say them.
    expect(settingNamed(SETTING_DEFAULTS)).toEqual({ solver: undefined, limits: LIMITS });
    // With no --solver the effort flag names nothing: the stored cycle's model solves at its effort.
    expect(settingNamed({ "solver-effort": "low" }).solver).toBeUndefined();
  });

  it("is another wall, a number of the model's own turns, or another solver", () => {
    const longer = settingNamed({ "solve-minutes": "240" }).limits;
    // The prompts a solve is given are every solve's (`LIMITS.turns`): until 2026-10-11
    // `--solve-turns` named them, and no command takes the flag since.
    expect(longer).toEqual({ ...LIMITS, wallSeconds: 14_400 });
    expect(SETTING_OPTIONS).not.toHaveProperty("solve-turns");
    // The model's own turns are limited only where a command names a number: without the flag the
    // limits hold no such key, and the setting is the one it was before the flag existed.
    expect(longer).not.toHaveProperty("modelTurns");
    expect(settingNamed({ "solve-model-turns": "40" }).limits).toEqual({ ...LIMITS, modelTurns: 40 });
    expect(settingNamed({ solver: "anthropic/claude-sonnet-5-5", "solver-effort": "low" }).solver).toEqual({
      model: "anthropic/claude-sonnet-5-5",
      effort: "low",
    });
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

  it("is read by every command through the one owner's options", () => {
    for (const flag of [
      "solver",
      "solver-effort",
      "solve-minutes",
      "solve-model-turns",
      "new-setting",
    ] as const) {
      expect(ROUND_OPTIONS[flag]).toBe(SETTING_OPTIONS[flag]);
    }
  });
});

describe("a campaign's setting, recorded once", () => {
  it("is what the first command names, or the defaults, and that command records it", () => {
    expect(settingAsked({}, null)).toEqual({
      named: { solver: undefined, limits: LIMITS },
      tasks: undefined,
      target: 12,
      record: UNNAMED,
      first: true,
    });
    const first = settingAsked(
      {
        solver: "anthropic/claude-sonnet-5-5",
        "solver-effort": "low",
        "solve-minutes": "8",
        "solve-model-turns": "40",
        tasks: "t-1,t-2,t-3",
      },
      null,
    );
    expect(first.record).toEqual(SHORT);
    expect(first.named.limits).toMatchObject({ wallSeconds: 480, modelTurns: 40, shellDefaultSeconds: 120 });
    expect(first.tasks).toBe("t-1,t-2,t-3");
  });

  it("is what a command that names nothing runs under, with nothing more to record", () => {
    const asked = settingAsked({}, SHORT);
    expect(asked.record).toBeNull();
    expect(asked.named).toEqual(
      settingNamed({
        solver: "anthropic/claude-sonnet-5-5",
        "solver-effort": "low",
        "solve-minutes": "8",
        "solve-model-turns": "40",
      }),
    );
    expect(asked).toMatchObject({ tasks: "t-1,t-2,t-3", target: 12 });
    // Named again as it stands, it is the same setting: a flag that agrees is no other.
    const again = settingAsked(
      { "solve-minutes": "8", "solve-model-turns": "40", tasks: "t-3,t-1,t-2" },
      SHORT,
    );
    expect(again.record).toBeNull();
    expect(again.named).toEqual(asked.named);
    expect(settingAsked({ target: "12" }, UNNAMED)).toMatchObject({
      record: null,
      tasks: undefined,
      target: 12,
    });
  });

  // Until 2026-10-09 the same flags were typed on every command, and one that differed was a note.
  it("refuses a flag that names another, and says each with what the campaign's is", () => {
    expect(() => settingAsked({ "solve-minutes": "5" }, SHORT)).toThrow(
      "--solve-minutes 5 names another setting than the campaign's, which was recorded as --solve-minutes 8. A campaign's setting is recorded once and every command runs under it: drop the flag, or pass --new-setting to record what this command names as the campaign's from here on, which opens a new condition that no tally on record speaks for",
    );
    expect(() => settingAsked({ "solve-model-turns": "20" }, SHORT)).toThrow(
      "--solve-model-turns 20 names another setting than the campaign's, which was recorded as --solve-model-turns 40.",
    );
    expect(() => settingAsked({ solver: "claude/claude-opus-5-5" }, SHORT)).toThrow(
      // The effort it names none of is the campaign's, as every flag it leaves out is.
      "--solver claude/claude-opus-5-5 --solver-effort low names another setting than the campaign's, which was recorded as --solver anthropic/claude-sonnet-5-5 --solver-effort low",
    );
    // The scored set is the campaign's as the solver is: other tasks, or a draw where tasks were named.
    expect(() => settingAsked({ tasks: "t-1,t-2" }, SHORT)).toThrow(
      "--tasks t-1,t-2 names another setting than the campaign's, which was recorded as --tasks t-1,t-2,t-3",
    );
    expect(() => settingAsked({ target: "8" }, UNNAMED)).toThrow(
      "--target 8 names another setting than the campaign's, which was recorded as --target 12",
    );
    expect(() => settingAsked({ "solve-model-turns": "40" }, UNNAMED)).toThrow(
      "--solve-model-turns 40 names another setting than the campaign's, which was recorded with no --solve-model-turns",
    );
  });

  it("takes another only on the operator's word, and then only what the command names", () => {
    const anew = settingAsked(
      { "new-setting": true, "solve-minutes": "5", "solve-model-turns": "20" },
      SHORT,
    );
    // Nothing is carried over from the record: the solver and the scored set are the defaults again.
    expect(anew.record).toEqual({ ...UNNAMED, minutes: 5, modelTurns: 20 });
    expect(anew.named.limits).toMatchObject({ wallSeconds: 300, modelTurns: 20 });
    expect(anew.tasks).toBeUndefined();
    // The word given over the setting as it stands records nothing.
    expect(settingAsked({ "new-setting": true }, UNNAMED).record).toBeNull();
  });

  it("is kept in the log as the command begins, and read back as the last one kept", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-setting-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const log = join(root, "log.jsonl");
    expect(recordedSetting(read(log))).toBeNull();
    keepSetting(log, settingAsked({}, null));
    expect(recordedSetting(read(log))).toEqual(UNNAMED);
    // A command that runs under the record keeps nothing more.
    keepSetting(log, settingAsked({}, recordedSetting(read(log))));
    expect(read(log)).toHaveLength(1);
    keepSetting(log, settingAsked({ "new-setting": true, "solve-minutes": "8" }, UNNAMED));
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
  });
});

describe("a setting that is not the one the log's last solves ran under", () => {
  const ran = { model: "p/m", effort: "high", limits: LIMITS };
  const under = (limits: typeof LIMITS) => ({ solver: undefined, limits });
  const told = "are another setting's";

  it("says nothing before any solve, or under the same limits and solver", () => {
    expect(restarts(under(LIMITS), null)).toEqual([]);
    expect(restarts(under(LIMITS), ran)).toEqual([]);
    expect(restarts({ solver: { model: "p/m", effort: "high" }, limits: LIMITS }, ran)).toEqual([]);
  });

  it("says that what the log measured so far was another setting's", () => {
    expect(restarts(under({ ...LIMITS, wallSeconds: 4 * 3600 }), ran)).toEqual([
      "a solve here is held to 240 minutes, and the log's last test-side solves ran under 120 minutes: the tallies, the tie share and the cost of a solve on record are another setting's, and say little of this comparison (tools/d2/setting.ts)",
    ]);
    expect(restarts(under({ ...LIMITS, modelTurns: 40 }), ran).join("\n")).toContain("with 40 model turns");
    const other = restarts({ solver: { model: "p/other", effort: "high" }, limits: LIMITS }, ran);
    expect(other).toHaveLength(1);
    expect(other[0]).toContain(
      "solves here are p/other at high, and the log's last test-side solves were p/m at high: the tallies",
    );
    expect(other[0]).toContain(told);
  });
});

// A campaign whose solves were made before a setting was recorded has one all the same: the one
// its last test-side solves ran under. Recode ran on 9 October with its solver held to 15 of its
// own turns, under a 30-minute wall, and its log holds no record.
describe("the first record of a campaign that already holds solves", () => {
  const ran = {
    model: "anthropic/claude-sonnet-5-5",
    effort: "high",
    limits: { ...LIMITS, wallSeconds: 1800, modelTurns: 15 },
  };
  const same = { "solve-minutes": "30", "solve-model-turns": "15" };
  const solver = { model: ran.model, effort: ran.effort };

  it("is the setting those solves ran under, named as flags where a command names another", () => {
    const forgot = settingAsked({}, null);
    expect(forgot.first).toBe(true);
    expect(firstRecord(forgot, { ...forgot.named, solver }, ran)).toBe(
      "the campaign's log records no setting yet, and this command names another than its last test-side solves ran under, which was --solver anthropic/claude-sonnet-5-5 --solver-effort high --solve-minutes 30 --solve-model-turns 15. Name that setting, which is then recorded as the campaign's, or pass --new-setting to record what this command names, which opens a new condition that no tally on record speaks for (tools/d2/setting.ts)",
    );
    // Another solver under the same limits is another setting as much.
    const named = settingAsked(same, null);
    expect(
      firstRecord(named, { ...named.named, solver: { model: "p/other", effort: "high" } }, ran),
    ).toContain("names another than its last test-side solves ran under");
    // A wall with no model turns on record is named without the flag.
    const unlimited = { ...ran, limits: { ...LIMITS, wallSeconds: 480 } };
    expect(firstRecord(forgot, forgot.named, unlimited)).toContain("--solve-minutes 8. Name that setting");
  });

  it("is free where the command names that setting, where nothing was solved, and on the operator's word", () => {
    const named = settingAsked(same, null);
    expect(firstRecord(named, { ...named.named, solver }, ran)).toBeUndefined();
    // A launch knows the solver only where a flag names it, and holds the limits alone otherwise.
    expect(firstRecord(named, named.named, ran)).toBeUndefined();
    const forgot = settingAsked({}, null);
    expect(firstRecord(forgot, forgot.named, null)).toBeUndefined();
    const anew = settingAsked({ "new-setting": true }, null);
    expect(anew.first).toBe(false);
    expect(firstRecord(anew, { ...anew.named, solver }, ran)).toBeUndefined();
    // Once a record stands it is the record that holds a command, and this question is not asked.
    const recorded = settingAsked({}, SHORT);
    expect(recorded.first).toBe(false);
    expect(firstRecord(recorded, recorded.named, ran)).toBeUndefined();
  });
});
