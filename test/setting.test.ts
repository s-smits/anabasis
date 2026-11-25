// A campaign's setting (who solves, what a solve is held to, how many tasks are drawn) is recorded once
// in the log; a command naming nothing runs under the record, and one naming another is refused until
// the operator changes it.
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

/** The setting of a campaign no command has named anything for: the one budget every solver is held
 *  to (`LIMITS`), and 24 tasks to score (`SIZE`). */
const UNNAMED: Recorded = {
  solver: null,
  minutes: 30,
  modelTurns: 20,
  target: 24,
  solves: 2,
};
/** The same, as an older campaign recorded it: 120 minutes, the model's turns unlimited. */
const UNLIMITED: Recorded = { ...UNNAMED, minutes: 120, modelTurns: null };
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
    // The prompts a solve is given are every solve's (`LIMITS.turns`), and no command takes
    // `--solve-turns`.
    expect(longer).toEqual({ ...LIMITS, wallSeconds: 14_400 });
    expect(SETTING_OPTIONS).not.toHaveProperty("solve-turns");
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
  // The setting is recorded once, so a flag that differs on a later command is refused, not noted.
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
    keepSetting(log, settingAsked({}, recordedSetting(read(log))));
    expect(read(log)).toHaveLength(1);
    // A second record, as an older command wrote on `--new-setting`, is the one read back.
    keepSetting(log, settingAsked({ "solve-minutes": "8" }, null));
    expect(recordedSetting(read(log))).toEqual({ ...UNNAMED, minutes: 8 });
    expect(read(log).map(({ kind }) => kind)).toEqual(["campaign.setting", "campaign.setting"]);
    const torn: LogEvent = {
      at: "2026-10-09T00:00:00.000Z",
      kind: "campaign.setting",
      data: { minutes: "8" },
    };
    expect(recordedSetting([torn])).toBeNull();
    // An older record holding another count of prompts than every solve is given now ran under another
    // setting, and is refused rather than read as this one.
    const counted = (turns: number): LogEvent => ({ ...torn, data: { ...UNNAMED, turns } });
    expect(recordedSetting([counted(24)])).toEqual(UNNAMED);
    expect(() => recordedSetting([counted(60)])).toThrow(/60 prompts.*24/u);
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

// A campaign whose solves predate any recorded setting has the one its last test-side solves ran under.
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
    expect(forgot.record).not.toBeNull();
    const mismatch = firstRecord(forgot, { ...forgot.named, solver }, ran);
    for (const fact of [
      "--solver claude/claude-sonnet-5-5",
      "--solver-effort high",
      "--solve-minutes 30",
      "--solve-model-turns 15",
    ]) {
      expect(mismatch).toContain(fact);
    }
    const named = settingAsked(same, null);
    expect(firstRecord(named, { ...named.named, solver }, ran)).toBeUndefined();
    expect(
      firstRecord(named, { ...named.named, solver: { model: "p/other", effort: "high" } }, ran),
    ).toContain("another");
    const { modelTurns: _, ...unturned } = LIMITS;
    const unlimited = { ...ran, limits: { ...unturned, wallSeconds: 480 } };
    const prior = firstRecord(forgot, forgot.named, unlimited);
    expect(prior).toContain("--solve-minutes 8");
    expect(prior).not.toContain("--solve-model-turns");
    const turned = settingAsked({ "solve-minutes": "30", "solve-model-turns": "20" }, null);
    expect(firstRecord(turned, turned.named, ran)).toContain("another");
  });
});
