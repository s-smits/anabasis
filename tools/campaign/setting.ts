/**
 * A campaign's setting: who solves, what a solve is held to, and how many tasks a comparison draws,
 * recorded once in the log so every command that solves runs under the record. A command naming
 * another setting than the record is refused, so a forgotten flag cannot change the comparison;
 * another solver, deadline or turn limit is another campaign.
 *
 *   [--solver <provider/model> [--solver-effort high] [--solver-window <tokens>]] [--solve-minutes N]
 *   [--solve-model-turns N | unlimited] [--solves N]
 *
 * The first record takes the defaults (`SETTING_DEFAULTS`, `LIMITS`) for what its flags leave out.
 * The window defaults to 300,000 tokens (`SWEEP_COMPACT_WINDOW`), which a model served a 200K context
 * cannot hold. A campaign with solves and no record has the setting its last test-side solves ran
 * under, and its first record must name that (`firstRecord`).
 */
import { clampThinkingLevel, type ThinkingLevel } from "@earendil-works/pi-ai";
import { THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";
import type { Limits } from "#src/kernel/condition.ts";
import { STARTED } from "#src/campaign/comparison.ts";
import { append, eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { SIZE } from "#src/kernel/size.ts";
import type { solverLast } from "#src/kernel/solves.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { sameJsonValue } from "#src/meta/stable-json.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { LIMITS } from "./campaign.ts";

interface NamedSetting {
  readonly solver: NamedSolver | undefined;
  readonly limits: Limits;
}

export interface NamedSolver {
  readonly model: string;
  readonly effort: ThinkingLevel;
  readonly window?: number;
}

export interface Recorded {
  readonly solver: { readonly model: string; readonly effort: string; readonly window?: number } | null;
  readonly minutes: number;
  readonly modelTurns: number | null;
  readonly target: number;
  readonly solves: number;
}

type SettingFlags = Readonly<Partial<Record<keyof typeof SETTING_OPTIONS | "target", string | undefined>>>;

export interface AskedSetting {
  readonly named: NamedSetting;
  readonly target: number;
  readonly solves: number;
  readonly record: Recorded | null;
}

interface Solving {
  readonly solver?: { readonly model: string; readonly effort: string } | undefined;
  readonly limits: Limits;
}

const DOCUMENTED = "tools/campaign/setting.ts";
const KIND = "campaign.setting";

export const SETTING_OPTIONS = {
  solver: { type: "string" },
  "solver-effort": { type: "string" },
  "solver-window": { type: "string" },
  "solve-minutes": { type: "string" },
  "solve-model-turns": { type: "string" },
  solves: { type: "string" },
} as const;

const { modelTurns: budgeted, ...UNTURNED } = LIMITS;
const SETTING_DEFAULTS = {
  "solver-effort": "high",
  "solve-minutes": String(LIMITS.wallSeconds / 60),
  "solve-model-turns": String(budgeted),
} as const;
const UNLIMITED = "unlimited";

const PARTS: readonly {
  readonly of: keyof Recorded;
  readonly flag: string;
  readonly said: (record: Recorded) => string | null;
}[] = [
  {
    of: "solver",
    flag: "--solver",
    said: ({ solver }) =>
      solver === null
        ? null
        : `--solver ${solver.model} --solver-effort ${solver.effort}${solver.window === undefined ? "" : ` --solver-window ${String(solver.window)}`}`,
  },
  { of: "minutes", flag: "--solve-minutes", said: ({ minutes }) => `--solve-minutes ${String(minutes)}` },
  {
    of: "modelTurns",
    flag: "--solve-model-turns",
    said: ({ modelTurns }) => (modelTurns === null ? null : `--solve-model-turns ${String(modelTurns)}`),
  },
  { of: "target", flag: "--target", said: ({ target }) => `--target ${String(target)}` },
  { of: "solves", flag: "--solves", said: ({ solves }) => `--solves ${String(solves)}` },
];

export function targetNamed(flag: string): number {
  return wholeNamed("target", flag, "the tasks to score are a whole number of at least one");
}

function wholeNamed(name: string, flag: string | undefined, why: string): number {
  const count = Number(flag);
  if (!Number.isInteger(count) || count < 1) throw new Error(`--${name} ${String(flag)}: ${why}`);
  return count;
}

/** `--solver-effort` without `--solver` names nothing: the cycle's model solves at the cycle's effort. */
export function settingNamed(values: SettingFlags): NamedSetting {
  const given = { ...SETTING_DEFAULTS, ...defined(values) };
  const minutes = wholeNamed(
    "solve-minutes",
    given["solve-minutes"],
    "a solve's wall is a whole number of minutes, at least one",
  );
  const named = given["solve-model-turns"];
  const modelTurns =
    named === UNLIMITED
      ? undefined
      : wholeNamed(
          "solve-model-turns",
          named,
          `a solve's model turns are a whole number of at least one, or ${UNLIMITED}`,
        );
  const window =
    given["solver-window"] === undefined
      ? undefined
      : wholeNamed(
          "solver-window",
          given["solver-window"],
          "a solver's compaction window is a whole number of tokens",
        );
  // pi sends an effort it does not know as the model's lowest level, so that one is refused. It sends a
  // level the model does not serve as the next it does (`clampThinkingLevel`), and the setting records
  // that one (DeepSeek's `medium` as `high`).
  const asked = THINKING_LEVELS.find((level) => level === given["solver-effort"]);
  if (asked === undefined) {
    throw new Error(`--solver-effort ${given["solver-effort"]}: one of ${THINKING_LEVELS.join(", ")}`);
  }
  const effort = (solver: string) => {
    const sent = clampThinkingLevel(modelNamed(solver), asked);
    return sent === "off" ? asked : sent;
  };
  const wallSeconds = minutes * 60;
  return {
    solver:
      given.solver === undefined
        ? undefined
        : { model: given.solver, effort: effort(given.solver), ...keyIfDefined("window", window) },
    limits: {
      ...UNTURNED,
      wallSeconds,
      ...commandSeconds(wallSeconds),
      ...keyIfDefined("modelTurns", modelTurns),
    },
  };
}

/** A key that holds nothing would stand over the record or the default it is spread onto. */
function defined(values: SettingFlags): SettingFlags {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function flagsOf({ solver, minutes, modelTurns, target, solves }: Recorded): SettingFlags {
  return {
    ...keyIfDefined("solver", solver?.model),
    ...keyIfDefined("solver-effort", solver?.effort),
    ...keyIfDefined("solver-window", solver?.window === undefined ? undefined : String(solver.window)),
    "solve-minutes": String(minutes),
    "solve-model-turns": modelTurns === null ? UNLIMITED : String(modelTurns),
    target: String(target),
    solves: String(solves),
  };
}

function recordOf(values: SettingFlags, named: NamedSetting): Recorded {
  const { solver, limits } = named;
  return {
    solver: solver === undefined ? null : { ...solver },
    minutes: limits.wallSeconds / 60,
    modelTurns: limits.modelTurns ?? null,
    target: targetNamed(values.target ?? String(SIZE.tasks)),
    solves: wholeNamed(
      "solves",
      values.solves ?? String(SIZE.solves),
      "the solves a side are a whole number of at least one",
    ),
  };
}

export function recordedSetting(events: readonly LogEvent[]): Recorded | null {
  const { solver, minutes, turns, modelTurns, target, solves } =
    eventsOf(events, KIND).at(-1)?.event.data ?? {};
  const by = asRecord(solver);
  if (isNumber(turns) && turns !== LIMITS.turns) {
    throw new Error(
      `the campaign's setting was recorded with ${String(turns)} prompts a solve, and this source gives every solve ${String(LIMITS.turns)}: no tally on record speaks for it. Run it from the commit it was recorded at`,
    );
  }
  const whole =
    isNumber(minutes) &&
    isNumber(target) &&
    (modelTurns === null || isNumber(modelTurns)) &&
    (solver === null ||
      (isString(by?.model) && isString(by.effort) && (by.window === undefined || isNumber(by.window))));
  if (!whole) return null;
  return {
    solver:
      isString(by?.model) && isString(by.effort)
        ? {
            model: by.model,
            effort: by.effort,
            ...keyIfDefined("window", isNumber(by.window) ? by.window : undefined),
          }
        : null,
    minutes,
    modelTurns,
    target,
    solves: isNumber(solves) ? solves : ranAt(events),
  };
}

/** An older record named no solves a side: read the count its last comparison began at, since
 *  another count is another campaign, and the default where none began. */
function ranAt(events: readonly LogEvent[]): number {
  const solves = eventsOf(events, STARTED).at(-1)?.event.data.solves;
  return isNumber(solves) ? solves : SIZE.solves;
}

export function settingAsked(values: SettingFlags, recorded: Recorded | null): AskedSetting {
  const flags = recorded === null ? defined(values) : { ...flagsOf(recorded), ...defined(values) };
  const named = settingNamed(flags);
  const asked = recordOf(flags, named);
  const moved = recorded === null ? [] : PARTS.filter(({ of }) => !sameJsonValue(asked[of], recorded[of]));
  if (recorded !== null && moved.length > 0) {
    const was = moved.flatMap(({ said }) => said(recorded) ?? []);
    const without = moved.flatMap(({ flag, said }) => (said(recorded) === null ? [flag] : []));
    const recordedAs = [
      ...(was.length === 0 ? [] : [`as ${was.join(", ")}`]),
      ...(without.length === 0 ? [] : [`with no ${without.join(", ")}`]),
    ].join(" and ");
    throw new Error(
      `${moved.flatMap(({ said }) => said(asked) ?? []).join(", ")} names another setting than the campaign's, which was recorded ${recordedAs}. A campaign's setting is recorded once and every command runs under it: drop the flag. Another setting is another campaign`,
    );
  }
  return {
    named,
    target: asked.target,
    solves: asked.solves,
    record: recorded === null ? asked : null,
  };
}

/** A command calls this as it begins, past every refusal, so a refused command leaves the record alone. */
export function keepSetting(log: string, { record }: Pick<AskedSetting, "record">): void {
  if (record === null) return;
  const { solver, ...rest } = record;
  append(log, KIND, {
    ...rest,
    solver: solver === null ? null : { ...solver },
  });
}

export function commandSeconds(wallSeconds: number): Pick<Limits, "shellDefaultSeconds" | "shellMaxSeconds"> {
  const held = (most: number, share: number) => Math.max(1, Math.min(most, Math.floor(wallSeconds / share)));
  return {
    shellDefaultSeconds: held(LIMITS.shellDefaultSeconds, 4),
    shellMaxSeconds: held(LIMITS.shellMaxSeconds, 2),
  };
}

export function firstRecord(
  asked: Pick<AskedSetting, "record">,
  named: Solving,
  ran: ReturnType<typeof solverLast>,
): string | undefined {
  if (asked.record === null || ran === null) return undefined;
  const { solver, limits } = named;
  const same =
    (solver === undefined || (solver.model === ran.model && solver.effort === ran.effort)) &&
    limits.wallSeconds === ran.limits.wallSeconds &&
    limits.modelTurns === ran.limits.modelTurns;
  if (same) return undefined;
  const was = [
    `--solver ${ran.model} --solver-effort ${ran.effort}`,
    `--solve-minutes ${String(ran.limits.wallSeconds / 60)}`,
    ...(ran.limits.modelTurns === undefined ? [] : [`--solve-model-turns ${String(ran.limits.modelTurns)}`]),
  ].join(" ");
  return `the campaign's log records no setting yet, and this command names another than its last test-side solves ran under, which was ${was}. Name that setting, which is then recorded as the campaign's; another setting is another campaign (${DOCUMENTED})`;
}
