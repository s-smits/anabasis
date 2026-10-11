/**
 * A campaign's setting: who solves, what a solve is held to, and which tasks a comparison scores.
 * It is recorded once in the campaign's log, and every command that solves runs under the record.
 *
 *   --solver claude/claude-sonnet-5-5   the model that solves in the stored cycle's place
 *   --solver-effort high                its effort, read beside --solver and not without it
 *   --solve-minutes 120                 the wall of one solve
 *   --solve-model-turns 40              the model's own turns a solve is given, told to the solver; no default
 *   --tasks a,b,c                       the scored tasks, by id, where the operator chooses them
 *   --target 12                         otherwise: so many of the held-out tasks, by the contract's draw
 *
 * The first command of a campaign that compares records what its flags name, with the defaults for
 * what they leave out: the stored cycle's own solver, the stored sweep's limits (`campaign.ts`,
 * `LIMITS`) and twelve tasks by the draw. From then on a command that names nothing runs under the
 * record, one that names the same is the same, and one that names another is refused. Until
 * 2026-10-09 the same flags were typed again on every command of a campaign, and a command that
 * differed was told so in a note and went on: a forgotten flag changed the comparison without a
 * word.
 *
 * A campaign's setting does not change. Until 2026-10-11 `--new-setting` changed it, as when the
 * budget was set anew, and every fold then read the log by setting: the stop rule, the tasks
 * both harnesses exhausted, the outcome an Examiner hears, the size of the next comparison. The
 * ladder went (`docs/simplify.md`, A1), and the flag and the filters with it (A4): another solver,
 * another wall or another number of turns is another campaign.
 *
 * A record is written as a command begins its comparison and not before, so a command that is
 * refused records nothing (`keepSetting`).
 *
 * A campaign whose solves were made before a setting was recorded, as every campaign's were until
 * 2026-10-09, has a setting all the same: the one its last test-side solves ran under. The first
 * command to record one names that setting (`firstRecord`), and is refused otherwise. Recode ran on 9 October with its solver
 * held to 15 of its own turns; a first command there that left the flag out would have recorded a
 * campaign with no such limit, and solved under it, without a word.
 *
 * The prompts a solver is given before a solve stops without an answer are v1's cap on nudges,
 * `LIMITS.turns`, the same for every solve: every finished solve of the first rounds was given
 * one, so the cap bound no solve, and until 2026-10-11 `--solve-turns` named it and the record
 * held it (`docs/simplify.md`, A3). A record that holds another count is refused. The model's own
 * turns are the budget told to the solver and enforced, which seconds cannot be on a loaded host.
 *
 * What does not follow the setting is the campaign's own: a task's state and the harnesses it
 * keeps. The concurrency and the disk cap stay the sweep's: neither is what a harder task runs out
 * of first, and each is one more thing two comparisons could differ in. A rehearsal seats a script
 * where the solver sits and refuses `--solver`; its limits and its scored set are these.
 *
 * The shell's two timeouts are the sweep's as far as the wall leaves room for them
 * (`commandSeconds`). They ignored the wall until 2026-10-09: under the five-minute wall of the one
 * comparison that read a step, a command was allowed 300 s by default and 900 s at most, so none a
 * solver started could be cut and handed back to it before the solve itself ended.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { Limits } from "#src/kernel/condition.ts";
import { append, type LogEvent } from "#src/kernel/log.ts";
import type { solverLast } from "#src/kernel/solves.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { sameJsonValue } from "#src/meta/stable-json.ts";
import { LIMITS } from "./campaign.ts";

/** What the flags name of the solver and its limits, as `openCampaign` takes it: the solver in the
 *  stored cycle's place, or none, and the limits of every solve. */
interface NamedSetting {
  readonly solver: { readonly model: string; readonly effort: ThinkingLevel } | undefined;
  readonly limits: Limits;
}

/** A campaign's setting as its log records it. */
export interface Recorded {
  /** Who solves in the stored cycle's place; null for the cycle's own model at its effort. */
  readonly solver: { readonly model: string; readonly effort: string } | null;
  readonly minutes: number;
  /** The model's own turns a solve is given; null where they are not limited. */
  readonly modelTurns: number | null;
  /** The scored tasks by id, where the operator named them; null for `target` of the held-out
   *  tasks by the contract's draw. */
  readonly tasks: readonly string[] | null;
  readonly target: number;
}

/** The flags of a setting, as a command's parsed arguments hold them. */
interface SettingFlags {
  readonly solver?: string | undefined;
  readonly "solver-effort"?: string | undefined;
  readonly "solve-minutes"?: string | undefined;
  readonly "solve-model-turns"?: string | undefined;
  readonly tasks?: string | undefined;
  readonly target?: string | undefined;
}

/** What a command runs under: the solver and the limits, the scored set as its two flags name it,
 *  and the record to keep where the campaign has none yet or takes another; null where it stands. */
export interface AskedSetting {
  readonly named: NamedSetting;
  readonly tasks: string | undefined;
  readonly target: number;
  readonly record: Recorded | null;
  /** Whether the record would be the campaign's first, with no word from the operator that the
   *  setting is new: it is then held to what the log's solves ran under (`firstRecord`). */
  readonly first: boolean;
}

/** Who a command solves as, where its caller knows, and what it holds a solve to. */
interface Solving {
  readonly solver?: { readonly model: string; readonly effort: string } | undefined;
  readonly limits: Limits;
}

/** Where the refusal sends its reader. */
const DOCUMENTED = "tools/d2/setting.ts";
const KIND = "campaign.setting";

/** The flags of a setting, as every command of a campaign takes them. None has a default here: a
 *  flag that is not given is the campaign's record, and the defaults stand behind that
 *  (`SETTING_DEFAULTS`). `--tasks` and `--target` are a comparison's own options (`round.ts`). */
export const SETTING_OPTIONS = {
  solver: { type: "string" },
  "solver-effort": { type: "string" },
  "solve-minutes": { type: "string" },
  "solve-model-turns": { type: "string" },
} as const;

/** The setting of a campaign nothing has named: the stored sweep's limits, spelled out so that the
 *  source says them, and a test holds them to `LIMITS`. The solver is the stored cycle's own, the
 *  model's turns are not limited, and the scored set is `TARGET` tasks by the draw. */
export const SETTING_DEFAULTS = {
  "solver-effort": "high",
  "solve-minutes": "120",
} as const;
const TARGET = 12;

/** The parts of a record, each with how a refusal says it as flags, or null where the record holds
 *  none of it, and the flag it is then missing. */
const PARTS: readonly {
  readonly of: keyof Recorded;
  readonly flag: string;
  readonly said: (record: Recorded) => string | null;
}[] = [
  {
    of: "solver",
    flag: "--solver",
    said: ({ solver }) =>
      solver === null ? null : `--solver ${solver.model} --solver-effort ${solver.effort}`,
  },
  { of: "minutes", flag: "--solve-minutes", said: ({ minutes }) => `--solve-minutes ${String(minutes)}` },
  {
    of: "modelTurns",
    flag: "--solve-model-turns",
    said: ({ modelTurns }) => (modelTurns === null ? null : `--solve-model-turns ${String(modelTurns)}`),
  },
  {
    of: "tasks",
    flag: "--tasks",
    said: ({ tasks }) => (tasks === null ? null : `--tasks ${tasks.join(",")}`),
  },
  { of: "target", flag: "--target", said: ({ target }) => `--target ${String(target)}` },
];

/** The scored tasks `--target` asks for: a whole number of at least one. Anything else would draw
 *  a set nobody asked for: no number draws none, and a negative one all but the last. */
export function targetNamed(flag: string): number {
  const target = Number(flag);
  if (!Number.isInteger(target) || target < 1) {
    throw new Error(`--target ${flag}: the tasks to score are a whole number of at least one`);
  }
  return target;
}

/**
 * What the flags name of the solver and its limits, with the defaults for those not given.
 * `--solver-effort` without `--solver` names nothing, as it never did: the cycle's model solves at
 * the cycle's effort. A wall or a turn cap that is no whole number of at least one is refused: a
 * fraction of a minute would hash to a setting nobody could name again.
 */
export function settingNamed(values: SettingFlags): NamedSetting {
  const given = { ...SETTING_DEFAULTS, ...defined(values) };
  const minutes = Number(given["solve-minutes"]);
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error(
      `--solve-minutes ${given["solve-minutes"]}: a solve's wall is a whole number of minutes, at least one`,
    );
  }
  const named = given["solve-model-turns"];
  const modelTurns = named === undefined ? undefined : Number(named);
  if (modelTurns !== undefined && (!Number.isInteger(modelTurns) || modelTurns < 1)) {
    throw new Error(
      `--solve-model-turns ${String(named)}: a solve's model turns are a whole number of at least one`,
    );
  }
  // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
  const effort = given["solver-effort"] as ThinkingLevel;
  const wallSeconds = minutes * 60;
  return {
    solver: given.solver === undefined ? undefined : { model: given.solver, effort },
    limits: {
      ...LIMITS,
      wallSeconds,
      ...commandSeconds(wallSeconds),
      ...keyIfDefined("modelTurns", modelTurns),
    },
  };
}

/** The flags that are given, without the ones that are not: a key that holds nothing would stand
 *  over the record or the default it is spread onto. */
function defined(values: SettingFlags): SettingFlags {
  return {
    ...keyIfDefined("solver", values.solver),
    ...keyIfDefined("solver-effort", values["solver-effort"]),
    ...keyIfDefined("solve-minutes", values["solve-minutes"]),
    ...keyIfDefined("solve-model-turns", values["solve-model-turns"]),
    ...keyIfDefined("tasks", values.tasks),
    ...keyIfDefined("target", values.target),
  };
}

/** A record as the flags that name it. */
function flagsOf({ solver, minutes, modelTurns, tasks, target }: Recorded): SettingFlags {
  return {
    ...keyIfDefined("solver", solver?.model),
    ...keyIfDefined("solver-effort", solver?.effort),
    "solve-minutes": String(minutes),
    ...keyIfDefined("solve-model-turns", modelTurns === null ? undefined : String(modelTurns)),
    ...keyIfDefined("tasks", tasks?.join(",")),
    target: String(target),
  };
}

/** The flags as the record they name, with the defaults for those not given. */
function recordOf(values: SettingFlags): Recorded {
  const { solver, limits } = settingNamed(values);
  return {
    solver: solver === undefined ? null : { model: solver.model, effort: solver.effort },
    minutes: limits.wallSeconds / 60,
    modelTurns: limits.modelTurns ?? null,
    tasks: values.tasks === undefined ? null : values.tasks.split(","),
    target: targetNamed(values.target ?? String(TARGET)),
  };
}

/** The setting a log records for its campaign: the last one kept, or null where none reads whole. */
export function recordedSetting(events: readonly LogEvent[]): Recorded | null {
  const { solver, minutes, turns, modelTurns, tasks, target } =
    events.findLast(({ kind }) => kind === KIND)?.data ?? {};
  const by = asRecord(solver);
  // A record written before 2026-10-11 holds the prompts a solve was given, which every solve is
  // given alike since (`LIMITS.turns`); one that held another count ran under another setting.
  if (isNumber(turns) && turns !== LIMITS.turns) {
    throw new Error(
      `the campaign's setting was recorded with ${String(turns)} prompts a solve, and this source gives every solve ${String(LIMITS.turns)}: no tally on record speaks for it. Run it from the commit it was recorded at`,
    );
  }
  const whole =
    isNumber(minutes) &&
    isNumber(target) &&
    (modelTurns === null || isNumber(modelTurns)) &&
    (tasks === null || (Array.isArray(tasks) && tasks.every(isString))) &&
    (solver === null || (isString(by?.model) && isString(by.effort)));
  if (!whole) return null;
  return {
    solver: isString(by?.model) && isString(by.effort) ? { model: by.model, effort: by.effort } : null,
    minutes,
    modelTurns,
    tasks: Array.isArray(tasks) ? tasks.filter(isString) : null,
    target,
  };
}

/**
 * What a command runs under, from its flags and the campaign's record. With no record it is what
 * the flags name and the defaults for the rest, and is to be recorded. Otherwise it is the
 * record, and a flag that names another part than the record holds is refused with both.
 */
export function settingAsked(values: SettingFlags, recorded: Recorded | null): AskedSetting {
  const flags = recorded === null ? defined(values) : { ...flagsOf(recorded), ...defined(values) };
  const asked = recordOf(flags);
  // The scored tasks are a set: the order they are named in names nothing.
  const set = (record: Recorded) => ({ ...record, tasks: record.tasks?.toSorted() ?? null });
  const moved =
    recorded === null ? [] : PARTS.filter(({ of }) => !sameJsonValue(set(asked)[of], set(recorded)[of]));
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
    named: settingNamed(flags),
    tasks: flags.tasks,
    target: asked.target,
    record: recorded === null ? asked : null,
    first: recorded === null,
  };
}

/** Keep the setting a command runs under as the campaign's, where it is one to record. A command
 *  calls this as it begins, past every refusal, so that a refused command leaves the record alone. */
export function keepSetting(log: string, { record }: Pick<AskedSetting, "record">): void {
  if (record === null) return;
  const { solver, tasks, ...rest } = record;
  append(log, KIND, {
    ...rest,
    solver: solver === null ? null : { ...solver },
    tasks: tasks === null ? null : [...tasks],
  });
}

/**
 * How long one command may run under a wall: the sweep's two limits, 300 s where a command names
 * no timeout and 900 s at most, each held to a share of the wall, a quarter and a half. So a
 * command that names nothing can be cut and returned four times in a solve, and the longest one a
 * solver may ask for leaves it half its time. From a wall of half an hour up both are the sweep's
 * own. Each is at least a second.
 */
export function commandSeconds(wallSeconds: number): Pick<Limits, "shellDefaultSeconds" | "shellMaxSeconds"> {
  const held = (most: number, share: number) => Math.max(1, Math.min(most, Math.floor(wallSeconds / share)));
  return {
    shellDefaultSeconds: held(LIMITS.shellDefaultSeconds, 4),
    shellMaxSeconds: held(LIMITS.shellMaxSeconds, 2),
  };
}

/**
 * Why a command may not record its setting as the campaign's first, or undefined where it may. A
 * log that holds test-side solves and no record has a setting already, the one those solves ran
 * under (`solverLast`), and the first record is that one. The refusal names it as flags, so that
 * it can be typed once and is then the campaign's. `solver` is who the command solves as, where
 * the caller knows: a command that names no `--solver` solves as the stored cycle's, and the
 * solver is not compared then. Another host's code, pins or prices are another setting too, and
 * are not read here: a log's conditions hold them, and no flag names them.
 */
export function firstRecord(
  asked: Pick<AskedSetting, "first">,
  named: Solving,
  ran: ReturnType<typeof solverLast>,
): string | undefined {
  if (!asked.first || ran === null) return undefined;
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
