/**
 * What a campaign's command and a live Builder's campaign tools share (`harness-builder.ts`,
 * `campaign-actions.ts`): the command's flags, what a campaign runs by and keeps in its opening,
 * and the flags of each move's command. Nothing here knows who makes a move.
 */
import { shortOf } from "#src/builder/decide.ts";
import { type Plan } from "#src/builder/ground.ts";
import type { Decided } from "#src/builder/move.ts";
import { type Opening, openingOf, planOf, SEATS, SESSIONS, type Seat, TERMS } from "#src/builder/opening.ts";
import { type Word } from "#src/builder/word.ts";
import { draftOf } from "#src/examiner/draft.ts";
import type { Session } from "#src/examiner/session.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { PATIENCE } from "#src/kernel/reports.ts";
import { taskStates, taskVersion } from "#src/kernel/task.ts";
import { mkdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { sameJsonValue } from "#src/meta/stable-json.ts";
import { projectOf } from "./campaign.ts";
import { HOST, type Host } from "./host.ts";
import { PRACTICE } from "./prepare.ts";
import { type Campaign, COMPARISON_OPTIONS, capRead, SESSION_OPTIONS, type Seated } from "./round.ts";
import { recordedSetting, SETTING_OPTIONS } from "./setting.ts";

/** Who sits in a campaign's model seats: a session's and a comparison's, and an Examiner's. */
export interface Seats {
  readonly seated: Seated;
  /** An Examiner session: `examine`, unless a rehearsal's script stands in for it. */
  readonly examine?: Session<"write"> | undefined;
  /** The session that drafts the exam of a campaign opened from a prompt: `examine`, or a script. */
  readonly draft?: Session<"draft"> | undefined;
  /** The host a solve starts into (`host.ts`): the host's own unless a test stands in for it. */
  readonly host?: Host | undefined;
}

/** What every move of one turn of the loop is made with. */
export interface Turn {
  readonly events: readonly LogEvent[];
  readonly plan: Plan;
  readonly opening: Opening;
  readonly values: Values;
  readonly seats: Seats;
  /** Who solves, each solve held at the host's gate unless `--loaded` (`gated`). */
  readonly held: Seated;
}

export type Values = ReturnType<typeof flagsOf>;

const OPTIONS = {
  root: SESSION_OPTIONS.root,
  sweep: SESSION_OPTIONS.sweep,
  cycle: SESSION_OPTIONS.cycle,
  bundle: SESSION_OPTIONS.bundle,
  name: SESSION_OPTIONS.name,
  project: { type: "string" },
  prompt: { type: "string" },
  "prompt-file": { type: "string" },
  budget: { type: "string" },
  reserve: { type: "string" },
  sessions: { type: "string" },
  patience: { type: "string" },
  builder: SESSION_OPTIONS.builder,
  "builder-effort": { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string" },
  reviewer: COMPARISON_OPTIONS.reviewer,
  "reviewer-effort": { type: "string" },
  solver: SETTING_OPTIONS.solver,
  "solver-effort": SETTING_OPTIONS["solver-effort"],
  "solver-window": SETTING_OPTIONS["solver-window"],
  "solve-minutes": SETTING_OPTIONS["solve-minutes"],
  "solve-model-turns": SETTING_OPTIONS["solve-model-turns"],
  // With no default of their own: one no command has named is the comparison's to default, and
  // one a command named is the opening's to keep (`TERMS`).
  target: COMPARISON_OPTIONS.target,
  solves: { type: "string" },
  level: { type: "string" },
  trigger: { type: "string" },
  margin: { type: "string" },
  defects: { type: "string" },
  minutes: { type: "string" },
  turns: { type: "string" },
  "practice-solves": { type: "string" },
  practice: { type: "string" },
  admit: { type: "string" },
  "exam-tasks": { type: "string" },
  "exam-proposals": { type: "string" },
  "exam-minutes": { type: "string" },
  "exam-turns": { type: "string" },
  cost: { type: "string" },
  moves: { type: "string" },
  handover: { type: "string" },
  loaded: { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  attended: { type: "boolean" },
  "builder-led": { type: "boolean" },
  "past-stop": COMPARISON_OPTIONS["past-stop"],
} as const;
/** What a campaign runs by where neither a flag nor its record says: the reserve of one solve in
 *  dollars, the Builder sessions before a comparison, and a seat's effort. */
export const DEFAULTS = { reserve: "10", sessions: SESSIONS, effort: "high" } as const;
const OPENED = "campaign.opened";
export const MOVED = "campaign.move";
/** The Builder conversations in a row that make no campaign move before a campaign ends. A Codex
 *  goal stays active across turns until its model calls it met, or blocked once the same blocker
 *  has held for three; a climb is never met, so three conversations without a move are its block. */
export const IDLE = 3;
const STARTED = "comparison.started";
/** A model a backend serves, named where a rehearsal's script sits in the Examiner's seat: the
 *  command wants a name, and the script is what is asked. */
export const SCRIPTED = "claude/claude-opus-5-5";

export const flag = (name: string, value: string | undefined): string[] =>
  value === undefined ? [] : [`--${name}`, value];

export function flagsOf(args: readonly string[]) {
  return parseArgs({ args: [...args], options: OPTIONS, allowNegative: true }).values;
}

/** Whether a command names a stored pack, by any of the four flags that name one together. */
export const packed = ({ root, sweep, cycle, bundle }: Values): boolean =>
  [root, sweep, cycle, bundle].some((each) => each !== undefined);

/** The operator's prompt: what this command gives, in a flag or a file, or the record's. */
function promptOf(values: Values, was: Opening | null): string | null {
  const file = values["prompt-file"];
  const given = (values.prompt ?? (file === undefined ? undefined : readFileSync(file, "utf8")))?.trim();
  if (given === "") throw new Error("the prompt is empty");
  return given ?? was?.prompt ?? null;
}

/** Refuses a count the opening keeps that is no whole number of at least one, as `what` it is. */
function counted(count: number, what: string): void {
  if (!Number.isInteger(count) || count < 1) throw new Error(`${what} are a whole number of at least one`);
}

/**
 * What the campaign runs by: its record, or what this command names where that is another. A paid
 * campaign needs its total, and a rehearsal's is none.
 */
export function opened(
  log: string,
  values: Values,
  seats: "paid" | "scripted",
  heard: readonly Word[] = [],
): Opening {
  const events = read(log);
  const was = openingOf(events);
  if (seats === "paid" && values.budget === undefined && was?.budget == null) {
    throw new Error(
      "name --budget, the dollars this campaign may bill in all: each move is held to what is left of it, and the campaign ends where less is left than one solve is held at",
    );
  }
  const turns = values["solve-model-turns"];
  const limit =
    turns === undefined ? (was?.limit ?? recordedSetting(events)?.modelTurns ?? null) : Number(turns);
  /** A seat as this command names it, and as the record holds it where it names none. */
  const seat = (name: (typeof SEATS)[number]): Seat | null => {
    const [model, effort] = [values[name], values[`${name}-effort`]];
    const kept = was?.seats[name] ?? null;
    if (model === undefined) return kept === null || effort === undefined ? kept : { ...kept, effort };
    return { model, effort: effort ?? kept?.effort ?? DEFAULTS.effort };
  };
  const prompt = promptOf(values, was);
  if (prompt === null && !packed(values)) {
    throw new Error(
      `name the campaign's pack with --root, --sweep, --cycle and --bundle, or give the prompt it opens from with --prompt: ${log} holds neither`,
    );
  }
  const solver =
    values.solver === undefined
      ? (was?.solver ?? null)
      : { model: values.solver, effort: values["solver-effort"] ?? was?.solver?.effort ?? DEFAULTS.effort };
  if (prompt !== null && solver === null) {
    throw new Error(
      "name --solver: a campaign that opens from a prompt has no stored cycle to take its solver from",
    );
  }
  if (prompt !== null && was !== null && was.prompt !== prompt && draftOf(events) !== null) {
    throw new Error(
      "the campaign's exam was drafted from another prompt than this command gives: a prompt names one campaign, and another takes a name of its own",
    );
  }
  const reserve = values.reserve ?? String(was?.budget?.reserve ?? DEFAULTS.reserve);
  // A total the operator left as a word while the command ran stands over the flag it was
  // started with, which is older (`word.ts`), and the newest of several words stands over the rest.
  const newest = heard.at(-1);
  const told = newest?.dollars == null ? values.budget : String(newest.dollars);
  const dollars = told ?? (was?.budget == null ? undefined : String(was.budget.dollars));
  const named: Omit<Opening, "project"> = {
    budget: dollars === undefined ? null : capRead(dollars, reserve),
    limit,
    sessions: values.sessions === undefined ? (was?.sessions ?? DEFAULTS.sessions) : Number(values.sessions),
    patience: values.patience === undefined ? (was?.patience ?? PATIENCE) : Number(values.patience),
    seats: { builder: seat("builder"), examiner: seat("examiner"), reviewer: seat("reviewer") },
    attended: values.attended ?? was?.attended ?? false,
    // A campaign that opens now is led by its Builder; one on record runs as its record says, and
    // a record from before the term says the host makes every move.
    led: values["builder-led"] ?? was?.led ?? was === null,
    prompt,
    solver: prompt === null ? null : solver,
    // Each term as this command names it, and as the record holds it where it names none. The
    // level is pinned whether or not a command named it: until 10 October a campaign that named
    // none read each comparison at the tree's default, so that a tree whose default moved from
    // 0.10 to 0.20 (#175) changed the test of a campaign run on from it, and the stop rule then
    // counted no-steps of two levels in one row. A campaign whose comparisons already ran at a
    // level is held to that one, as the setting is held to its first solves (`firstRecord`).
    terms: {
      level: values.level ?? pinned(events, was, "level"),
      trigger: values.trigger ?? pinned(events, was, "trigger"),
      ...was?.terms,
      ...Object.fromEntries(
        TERMS.flatMap((term) => (values[term] === undefined ? [] : [[term, values[term]]])),
      ),
    },
  };
  counted(named.sessions, `--sessions ${String(values.sessions)}: the Builder sessions before a comparison`);
  counted(
    named.patience,
    `--patience ${String(values.patience)}: the moves without a gain the campaign bears in a row`,
  );
  const project = projectOf(log, values.project, was);
  const record: JsonObject = {
    project,
    budget: named.budget === null ? null : { ...named.budget },
    limit: named.limit,
    sessions: named.sessions,
    patience: named.patience,
    seats: Object.fromEntries(
      SEATS.map((each) => [each, named.seats[each] === null ? null : { ...named.seats[each] }]),
    ),
    ...keyIfDefined("attended", named.attended || undefined),
    ...keyIfDefined("led", named.led || undefined),
    // A campaign over a stored pack records neither, as before a campaign could open from a prompt.
    ...keyIfDefined("prompt", named.prompt ?? undefined),
    ...keyIfDefined("solver", named.solver === null ? undefined : { ...named.solver }),
    // A campaign whose commands named no term records none, as before the opening kept them.
    ...keyIfDefined("terms", Object.keys(named.terms).length === 0 ? undefined : { ...named.terms }),
  };
  // The record as it was written, less the words it answered: a record is written again where
  // what the campaign runs by is another, and where a word asked for it.
  const { answers: _answered, ...kept } = events.findLast(({ kind }) => kind === OPENED)?.data ?? {};
  if (!values["dry-run"] && (heard.length > 0 || !sameJsonValue(kept, record))) {
    // A campaign that opens from a prompt has no folder until now: one over a stored pack got
    // its own when the pack was opened. The first live campaign from a prompt stopped here
    // (2026-10-09), since the test that covered it had made the folder for another reason.
    mkdirSync(dirname(log), { recursive: true });
    append(log, OPENED, {
      ...record,
      ...keyIfDefined("answers", heard.length === 0 ? undefined : heard.map(({ at }) => at)),
    });
  }
  return { ...named, project };
}

/**
 * The held-out tasks an Examiner session is asked for where no flag names them: what the campaign
 * is short of (`shortOf`, `decide.ts`); undefined where it is short of nothing. Until 11 October it
 * was the command's default, 12 (buffer was short 9), and from 12 to 13 October twice the target
 * before the first comparison, which two campaigns examined towards for 16 hours.
 */
export function examTasks({ events, plan }: Turn): string | undefined {
  const wanting = shortOf(events, plan);
  return wanting > 0 ? String(wanting) : undefined;
}

/**
 * The Builder conversations in a row, the latest included, that have made no campaign move since
 * the campaign last ended: the trailing run of its moves that are conversations (`build`, `led`).
 * Any other move, the host's own among them, is progress. A run of the command after an ending
 * starts the count afresh, as Codex audits a resumed goal afresh. A conversation the provider
 * crashed or a stop killed chose nothing and is left out, as the table leaves it out of the
 * sessions run (`sessionsRun`): until 15 October finished, crashed, finished counted three.
 */
export function idleOf(events: readonly LogEvent[]): number {
  const since = events.slice(events.findLastIndex(({ kind }) => kind === "campaign.ended") + 1);
  const cut = new Set(
    since.flatMap(({ kind, data }) =>
      kind === "build.finished" && (data.ended === "crashed" || data.ended === "killed")
        ? [data.session]
        : [],
    ),
  );
  const moves = since.flatMap(({ kind, data }) => (kind === MOVED && !cut.has(data.session) ? [data] : []));
  return moves.length - 1 - moves.findLastIndex(({ move, code }) => move !== "build" || code !== "led");
}

/** The next free id under `prefix`, as `b-3` after `b-1` and `b-2`. */
export function nextId(events: readonly LogEvent[], prefix: string): string {
  const taken = events.flatMap(({ data }) => {
    const id = isString(data.session) && data.session.startsWith(`${prefix}-`) ? data.session : "";
    const nth = Number(id.slice(prefix.length + 1));
    return id !== "" && Number.isInteger(nth) ? [nth] : [];
  });
  return `${prefix}-${String(Math.max(0, ...taken) + 1)}`;
}

/**
 * The level, or the trigger, a campaign reads its comparisons by where no command names one: the
 * record's, else the one its comparisons on record began under (the level only), else this tree's
 * default, as a string, since a term is a flag's value. A campaign whose comparisons began before
 * the two-stage rule, with no trigger on record, is refused the default: until 10 October each
 * reading cleared the level by itself, and read on under this tree's rule its pinned level would
 * be the summed one (0.20 summed is a false promotion of equal harnesses 6.4% an attempt, where
 * 0.10 is 3.4%). The operator names both terms once, and the campaign keeps them.
 */
function pinned(events: readonly LogEvent[], was: Opening | null, term: "level" | "trigger"): string {
  const recorded = was?.terms[term];
  if (isString(recorded)) return recorded;
  const began = events.findLast(({ kind, data }) => kind === STARTED && isNumber(data.level))?.data.level;
  // Either term pinned from a start under the one-reading rule, with no trigger on record, would
  // read the campaign on under this tree's rule at the old level (found by review, 11 October:
  // `--trigger` named alone pinned the level to the start's 0.20).
  if (isNumber(began) && !isString(was?.terms.trigger)) {
    throw new Error(
      `the campaign's comparisons began at --level ${String(began)} under the rule of one reading at a time, and the step and its repeat are read together since 10 October: name --level and --trigger once for it (the plan's are --level ${COMPARISON_OPTIONS.level.default} --trigger ${COMPARISON_OPTIONS.trigger.default}), and the opening keeps them`,
    );
  }
  return isNumber(began) ? String(began) : COMPARISON_OPTIONS[term].default;
}

/** The flags of a comparison that began, as its start holds them: it goes on under its own terms.
 *  The objective's margin is one of them: until 11 October it was left off, so a comparison begun
 *  at another margin than 0.01 went on at that default and was refused as begun on other terms. */
function termsOf(events: readonly LogEvent[], id: string): string[] {
  const start = events.find(({ kind, data }) => kind === STARTED && data.session === id)?.data ?? {};
  const [cap, objective] = [asRecord(start.cap), asRecord(start.objective)];
  return [
    ...flag("solves", isNumber(start.solves) ? String(start.solves) : undefined),
    ...flag("level", isNumber(start.level) ? String(start.level) : undefined),
    ...flag("cap", isNumber(cap?.dollars) ? String(cap.dollars) : undefined),
    ...flag("reserve", isNumber(cap?.reserve) ? String(cap.reserve) : undefined),
    // A margin the A/A set, or the default before one, is read again from the log as it stood at
    // the start (`marginRead`): only a margin a command named is named again.
    ...flag(
      "margin",
      isNumber(objective?.margin) && !("from" in objective) ? String(objective.margin) : undefined,
    ),
    ...flag("predict", isString(start.prediction) ? start.prediction : undefined),
  ];
}

/** The flags that name a campaign's pack and itself, as every command takes them. */
export function packOf({ root, sweep, cycle, bundle, name }: Values): string[] {
  return [
    ...flag("root", root),
    ...flag("sweep", sweep),
    ...flag("cycle", cycle),
    ...flag("bundle", bundle),
    ...flag("name", name),
  ];
}

/** The flags a move that solves shares with every other: the setting, where the log records none
 *  yet, since the first command that begins names it and it is the log's from then on; the cap,
 *  which is what is left of the campaign's total; the reviewers; and the word past the stop rule. */
export function sharedOf({ events, plan, opening, values }: Turn) {
  const { reviewer } = opening.seats;
  return {
    // What no flag names, the opening names where it holds it: the solver of a campaign from a
    // prompt and the full limit, so that a command run again with its name alone records the
    // setting the campaign was opened with.
    setting:
      recordedSetting(events) === null
        ? [
            ...flag("solver", values.solver ?? opening.solver?.model),
            ...flag("solver-effort", values["solver-effort"] ?? opening.solver?.effort),
            ...flag("solver-window", values["solver-window"]),
            ...flag("solve-minutes", values["solve-minutes"]),
            ...flag(
              "solve-model-turns",
              values["solve-model-turns"] ?? (opening.limit === null ? undefined : String(opening.limit)),
            ),
            // The scored tasks are the setting's too, and a Builder session records it as readily
            // as a comparison: t-2 (10 October) opened with --target 6, its first session recorded
            // the default, and its comparisons then scored by the record.
            ...flag("target", values.target),
          ]
        : [],
    cap:
      plan.left == null
        ? []
        : ["--cap", plan.left.dollars.toFixed(2), "--reserve", String(plan.left.reserve)],
    reviewer: reviewer === null ? [] : ["--reviewer", reviewer.model, "--reviewer-effort", reviewer.effort],
    pastStop: flag("past-stop", values["past-stop"]),
  };
}

/** The flags of the comparison a move names: a new one under the next free id, or one that began,
 *  under its id and its own terms. */
export function comparisonOf(decided: Extract<Decided, { move: "compare" }>, turn: Turn) {
  const { events, values } = turn;
  const { setting, cap, reviewer, pastStop } = sharedOf(turn);
  const session = decided.id ?? nextId(events, "g");
  const terms =
    decided.id === undefined
      ? [
          ...flag("solves", values.solves),
          ...flag("level", values.level),
          // The trigger is the table's and no term of the start: it goes on the command, new or
          // continued, so the admission reads what `decide` read (left off until 11 October).
          ...flag("trigger", values.trigger),
          ...flag("margin", values.margin),
          ...cap,
        ]
      : [...termsOf(events, decided.id), ...flag("trigger", values.trigger)];
  return {
    session,
    args: [
      ...packOf(values),
      ...setting,
      "--id",
      session,
      "--new",
      decided.fresh,
      "--reference",
      decided.reference,
      ...(decided.ladder === true ? ["--ladder", ...flag("frozen", decided.frozen)] : []),
      ...terms,
      ...flag("defects", values.defects),
      ...reviewer,
      ...pastStop,
    ],
  };
}

/** The checks `--admit` names, which is the operator's word for each. */
export function admitsOf(values: Values): string[] {
  return (values.admit ?? "").split(",").flatMap((id) => (id.trim() === "" ? [] : [id.trim()]));
}

/**
 * What a move records of its start: when it began, and for a move that solves the host's load
 * then; each solve waits at the host's gate itself (`gated`, `host.ts`). The event is written as
 * the move begins: until 12 October it was written at its end with the reason from when it was
 * decided, which a reader took for the end's; and a solve's times are the host's as much as the
 * solver's, since a wall counts the clock (eight campaigns on one host of 12 cores held its load
 * between 14 and 26 that night).
 */
export function startOf(move: Decided["move"], seats: Seats): JsonObject {
  const began = new Date().toISOString();
  const host = seats.host ?? HOST;
  return move === "build" || move === "compare" ? { began, load: host.load(), cores: host.cores } : { began };
}

/** One turn of a campaign as its log stands now: the plan the table is asked with, from the
 *  campaign's terms and what is left of its total. */
export function turnOf(source: {
  readonly log: string;
  readonly values: Values;
  readonly opening: Opening;
  readonly seats: Seats;
  readonly held: Seated;
  readonly campaign: Campaign | null;
}): Turn {
  const { log, values, opening, seats, held, campaign } = source;
  const events = read(log);
  const states = taskStates(events);
  return {
    events,
    opening,
    values,
    seats,
    held,
    plan: planOf(
      events,
      {
        unprepared: campaign?.tasks.some((task) => !states.has(taskVersion(campaign.pack(task)))) ?? false,
        level: Number(values.level ?? COMPARISON_OPTIONS.level.default),
        trigger: Number(values.trigger ?? COMPARISON_OPTIONS.trigger.default),
        target: values.target === undefined ? undefined : Number(values.target),
        pastStop: values["past-stop"],
        admits: admitsOf(values),
        practice: values.practice === undefined ? PRACTICE : Number(values.practice),
      },
      opening,
    ),
  };
}
