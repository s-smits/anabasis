/**
 * What a campaign's command and a live Builder's campaign tools share (`harness-builder.ts`,
 * `campaign-actions.ts`): the command's flags, what a campaign runs by and keeps in its opening,
 * and the flags of each move's command. Nothing here knows who makes a move.
 * A paid campaign needs a Referee before it opens (20 October). The 81 unruled admission
 * rejections in the recent logs predate task admission review, but source triage found a campaign could
 * still omit its reviewer and silently leave every admission rejection unmeasured.
 */
import { shortOf } from "#src/campaign/decide.ts";
import { cutShort, type Plan } from "#src/campaign/ground.ts";
import type { Decided } from "#src/campaign/move.ts";
import { type Opening, openingOf, planOf, SEATS, SESSIONS, type Seat, TERMS } from "#src/campaign/opening.ts";
import type { Word } from "#src/campaign/word.ts";
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
import type { Host } from "./host.ts";
import { PRACTICE } from "./prepare.ts";
import { type Campaign, COMPARISON_OPTIONS, capRead, SESSION_OPTIONS, type Seated, solved } from "./round.ts";
import { recordedSetting, SETTING_OPTIONS } from "./setting.ts";

/** Who sits in a campaign's model seats: a session's and a comparison's, and an Examiner's. */
export interface Seats {
  readonly seated: Seated;
  /** An explicitly seated solver for room solves beside a scripted Examiner. */
  readonly probe?: Seated;
  /** An Examiner session: `examine`, unless a rehearsal's script stands in for it. */
  readonly examine?: Session<"write"> | undefined;
  /** The session that drafts the exam of a campaign opened from a prompt: `examine`, or a script. */
  readonly draft?: Session<"draft"> | undefined;
  /** The host a solve starts into (`host.ts`): the host's own unless a test stands in for it. */
  readonly host?: Host | undefined;
  /** No reviewer, whatever the opening names: a rehearsal's, whose scripted rejections no model is
   *  paid to rule. Until 16 October a rehearsal over a seed seated its source's Referee. */
  readonly unreviewed?: boolean | undefined;
}

/** What every move of one turn of the loop is made with. */
export interface Turn {
  readonly events: readonly LogEvent[];
  readonly plan: Plan;
  readonly opening: Opening;
  readonly values: Values;
  readonly seats: Seats;
  /** Who solves, each solve held in the solve queue unless `--loaded` (`queued`). */
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
  level: { type: "string" },
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
  hitl: { type: "boolean" },
  "builder-led": { type: "boolean" },
  "past-stop": COMPARISON_OPTIONS["past-stop"],
} as const;
/** What a campaign runs by where neither a flag nor its record says: the reserve of one solve in
 *  dollars, the Builder sessions before a comparison, and a seat's effort. */
const DEFAULTS = { reserve: "10", sessions: SESSIONS, effort: "high" } as const;
/**
 * Every flag of the campaign command with what it does: the one list of them, printed by
 * `--help` (`flagsHelp`). Typed by `OPTIONS`, so no flag is added without its line. A term the
 * opening keeps (`TERMS`, `src/campaign/opening.ts`) holds for the campaign once named, and a later
 * run that names nothing runs by the record.
 */
const EXPLAINED: Readonly<Record<keyof typeof OPTIONS, string>> = {
  root: "a stored pack's root; with --sweep, --cycle and --bundle names the pack the campaign opens over",
  sweep: "a stored pack's sweep (see --root)",
  cycle: "a stored pack's cycle (see --root)",
  bundle: "a stored pack's directory (see --root)",
  name: "the campaign, and its folder .ana/d2/<name>; required",
  project: "the project the campaign is filed under; required at its opening, kept after",
  prompt: "the operator's prompt, for a campaign whose Examiner drafts its exam",
  "prompt-file": "the operator's prompt, read from a file (see --prompt)",
  budget: "the campaign's total in dollars; each move's cap is what is left of it",
  reserve: `what one solve is held at, in dollars; the campaign ends when less is left (${DEFAULTS.reserve})`,
  sessions: `Builder sessions the table counts before it advises a comparison (${String(SESSIONS)})`,
  patience: `improvement patience (moves without a gain) and supply patience (readings without room) (${String(PATIENCE)})`,
  builder: "the Builder's model",
  "builder-effort": "the Builder's effort",
  examiner: "the Examiner's model",
  "examiner-effort": "the Examiner's effort",
  reviewer: "the Referee's model; a paid campaign needs one",
  "reviewer-effort": "the Referee's effort",
  solver: "the solver's model: part of the setting, fixed once recorded",
  "solver-effort": "the solver's effort (setting)",
  "solver-window": "the context at which the solver compacts, in tokens (setting)",
  "solve-minutes": "a solve's deadline in minutes (setting)",
  "solve-model-turns": "a solve's model turn limit (setting)",
  target: "frontier tasks a comparison scores (setting; 24)",
  level: "the step test's level: one reading at or under it promotes (0.02)",
  defects: "tasks with a check defect before a comparison stops (3)",
  minutes: "a Builder conversation's deadline in minutes of its own time (1440)",
  turns: "a Builder conversation's session turn limit (300)",
  "practice-solves": "practice solves a Builder session may make (24)",
  practice: "practice tasks released an epoch, at most half of what is held",
  admit: "checks admitted by name, under --hitl",
  "exam-tasks": "tasks an Examiner session is asked for; unnamed, what the campaign is short of",
  "exam-proposals": "instances an Examiner session may put to task admission (36)",
  "exam-minutes": "an Examiner session's deadline in minutes (240)",
  "exam-turns": "an Examiner session's turn limit (200)",
  cost: "reported target for promotion attempts per epoch after set-up; limits nothing (3)",
  moves: "the most campaign moves this run makes",
  handover: "a directory, outside the repository, to write what the campaign hands over at its end",
  loaded: "start solves without waiting for the host's load",
  "dry-run": "print the table's advice and make no move",
  hitl: "the operator in the loop: freezing, admitting and promoting wait for the operator's word; kept until --no-hitl",
  "builder-led":
    "one Builder conversation leads the campaign through its tools (on for a campaign that opens now)",
  "past-stop": "the operator's reason to go on past the stop rule, logged",
};

const OPENED = "campaign.opened";
export const MOVED = "campaign.move";
/** The Builder conversations in a row that make no campaign move before a campaign ends. A Codex
 *  goal stays active across turns until its model calls it met, or blocked once the same blocker
 *  has held for three; a climb is never met, so three conversations without a move are its block. */
export const IDLE = 3;
const STARTED = "comparison.started";
/** A model a backend serves, named where a rehearsal's script sits in the Examiner's seat: the
 *  command wants a name, and the script is what is asked. */
const SCRIPTED = "claude/claude-opus-5-5";

export const flag = (name: string, value: string | undefined): string[] =>
  value === undefined ? [] : [`--${name}`, value];

export function flagsOf(args: readonly string[]) {
  return parseArgs({ args: [...args], options: OPTIONS, allowNegative: true }).values;
}

/** The campaign's flags among `args`, read past any flag the campaign command does not take: what
 *  `fresh` passes after `--` and a launch's receipt carry the `runs` verbs' flags too (`billsLogin`). */
export function looseFlagsOf(args: readonly string[]) {
  return parseArgs({ args: [...args], options: OPTIONS, allowNegative: true, strict: false }).values;
}

/** The flags of the campaign command, a line each, as `--help` prints them. */
export function flagsHelp(): string {
  const wide = Math.max(...Object.keys(EXPLAINED).map((named) => named.length));
  return Object.entries(EXPLAINED)
    .map(([named, said]) => `  --${named.padEnd(wide)}  ${said}`)
    .join("\n");
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
  // An opening's null is a limit nobody named, and it stands. Read past it to the setting, a
  // campaign run on by its name would write another opening once its first session recorded the
  // default limit (19 October).
  const unnamed = was === null ? (recordedSetting(events)?.modelTurns ?? null) : was.limit;
  const limit = turns === undefined ? unnamed : Number(turns);
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
    attended: values.hitl ?? was?.attended ?? false,
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
      level: values.level ?? pinned(events, was),
      ...was?.terms,
      ...Object.fromEntries(
        TERMS.flatMap((term) => (values[term] === undefined ? [] : [[term, values[term]]])),
      ),
    },
  };
  if (seats === "paid" && named.seats.reviewer === null) {
    throw new Error("name --reviewer: a paid campaign needs a Referee to rule its rejections");
  }
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
 * sessions run (`sessionsRun`): until 15 October finished, crashed, finished counted three. So is
 * a session of any seat that moved nothing (`cutShort`), and one the host refused before it began.
 * Since 16 October an Examiner session opens beside each conversation the table names one for, and
 * one that crashed, or was refused, every time kept two rehearsed campaigns going past 40 moves.
 */
export function idleOf(events: readonly LogEvent[]): number {
  const since = events.slice(events.findLastIndex(({ kind }) => kind === "campaign.ended") + 1);
  const named = since.flatMap(({ data }) => (isString(data.session) ? [data.session] : []));
  const cut = new Set([
    ...since.flatMap((event) => (cutShort(event) ? [event.data.session] : [])),
    // A move whose session nothing else names never started: the host's refusal (`actionTool`).
    ...named.filter((session) => named.indexOf(session) === named.lastIndexOf(session)),
  ]);
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
 * The level a campaign reads its comparisons by where no command names one: the record's, else
 * the one its comparisons on record began under, else this tree's default, as a string, since a
 * term is a flag's value. Until 19 October a trigger was pinned beside it, and a campaign whose
 * comparisons began before 10 October's two-stage rule was refused the default.
 */
function pinned(events: readonly LogEvent[], was: Opening | null): string {
  const recorded = was?.terms.level;
  if (isString(recorded)) return recorded;
  const began = events.findLast(({ kind, data }) => kind === STARTED && isNumber(data.level))?.data.level;
  return isNumber(began) ? String(began) : COMPARISON_OPTIONS.level.default;
}

/** The flags of a comparison that began, as its start holds them: it goes on under its own terms. */
function termsOf(events: readonly LogEvent[], id: string): string[] {
  const start = events.find(({ kind, data }) => kind === STARTED && data.session === id)?.data ?? {};
  const cap = asRecord(start.cap);
  return [
    ...flag("level", isNumber(start.level) ? String(start.level) : undefined),
    ...flag("cap", isNumber(cap?.dollars) ? String(cap.dollars) : undefined),
    ...flag("reserve", isNumber(cap?.reserve) ? String(cap.reserve) : undefined),
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
export function sharedOf({ events, plan, opening, values, seats }: Turn) {
  const reviewer = seats.unreviewed === true ? null : opening.seats.reviewer;
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

/** How the campaign runs Examiner session `session`, with `stand` in the seat (`examine`, or a
 *  rehearsal's script): its flags, for `draft.ts` where it drafts the exam and `examine.ts` where it
 *  writes tasks; the count of tasks a writing session is asked for; and the seat that solves its
 *  drafts, which is the campaign's own, so the tries wait on the load and share the reserve
 *  (14 October), and none beside a script unless a test seats one. */
export function examinerRun(turn: Turn, session: string, stand: unknown, kind: "draft" | "write") {
  const { opening, values, seats } = turn;
  const { examiner } = opening.seats;
  if (seats.seated === solved && examiner === null) {
    throw new Error("name --examiner: the campaign needs an Examiner session");
  }
  const { setting, reviewer } = sharedOf(turn);
  const seat = [
    "--session",
    session,
    "--examiner",
    examiner?.model ?? SCRIPTED,
    "--examiner-effort",
    examiner?.effort ?? DEFAULTS.effort,
    // The campaign's setting before one is recorded: the Examiner's budget, and its solves'.
    ...setting,
    ...reviewer,
  ];
  const tasks = values["exam-tasks"] ?? examTasks(turn);
  return {
    args:
      kind === "draft"
        ? [...flag("name", values.name), ...seat]
        : [
            ...packOf(values),
            ...seat,
            ...flag("tasks", tasks),
            ...flag("proposals", values["exam-proposals"]),
            ...flag("minutes", values["exam-minutes"]),
            ...flag("turns", values["exam-turns"]),
          ],
    tasks,
    roomSolves: seats.probe ?? (stand === undefined ? turn.held : null),
  };
}

/** The flags of the comparison a move names: a new one under the next free id, or one that began,
 *  under its id and its own terms. */
export function comparisonOf(decided: Extract<Decided, { move: "compare" }>, turn: Turn) {
  const { events, values } = turn;
  const { setting, cap, reviewer, pastStop } = sharedOf(turn);
  const session = decided.id ?? nextId(events, "g");
  const terms =
    decided.id === undefined ? [...flag("level", values.level), ...cap] : termsOf(events, decided.id);
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
      ...terms,
      ...flag("defects", values.defects),
      ...reviewer,
      ...pastStop,
    ],
  };
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
        target: values.target === undefined ? undefined : Number(values.target),
        pastStop: values["past-stop"],
        // The checks `--admit` names, which is the operator's word for each.
        admits: (values.admit ?? "").split(",").flatMap((id) => (id.trim() === "" ? [] : [id.trim()])),
        practice: values.practice === undefined ? PRACTICE : Number(values.practice),
      },
      opening,
    ),
  };
}
