/**
 * What a campaign's command and a live Builder's campaign tools share (`harness-builder.ts`,
 * `campaign-actions.ts`): the command's flags, what a campaign runs by and keeps in its opening,
 * and the flags of each move's command. Nothing here knows who makes a move.
 * A paid campaign needs a Referee before it opens (20 October), so that no rejection it counts goes
 * unruled: until then source triage found a campaign could omit its reviewer, and 81 rejections at
 * the gate's room solves of that time went unruled.
 */
import { STARTED, startOf } from "#src/campaign/comparison.ts";
import { shortOf } from "#src/campaign/decide.ts";
import { cutShort, type Plan } from "#src/campaign/ground.ts";
import type { Decided } from "#src/campaign/move.ts";
import { type Opening, openingOf, planOf, SEATS, type Seat, TERMS } from "#src/campaign/opening.ts";
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
import { PACK_OPTIONS, projectOf } from "./campaign.ts";
import type { Host } from "./host.ts";
import { PRACTICE, type prepareCommand } from "./prepare.ts";
import { type Campaign, COMPARISON_OPTIONS, capRead, SESSION_OPTIONS, type Seated, solved } from "./round.ts";
import { SETTING_OPTIONS } from "./setting.ts";

/** Who sits in a campaign's model seats: a session's and a comparison's, and an Examiner's. */
export interface Seats {
  readonly seated: Seated;
  /** An Examiner session: `examine`, unless a rehearsal's script stands in for it. */
  readonly examine?: Session<"write"> | undefined;
  /** The session that drafts the exam of a campaign opened from a prompt: `examine`, or a script. */
  readonly draft?: Session<"draft"> | undefined;
  /** The host a solve starts into (`host.ts`): the host's own unless a test stands in for it. */
  readonly host?: Host | undefined;
  /** What takes a pack's tasks in and releases practice: `prepareCommand`, unless a test stands in
   *  one that writes nothing. */
  readonly prepare?: typeof prepareCommand | undefined;
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
  ...PACK_OPTIONS,
  project: { type: "string" },
  prompt: { type: "string" },
  "prompt-file": { type: "string" },
  budget: { type: "string" },
  reserve: { type: "string" },
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
  target: COMPARISON_OPTIONS.target,
  solves: SETTING_OPTIONS.solves,
  // With no default of their own: one no command has named is its move's to default, and one a
  // command named is the opening's to keep (`TERMS`).
  level: { type: "string" },
  minutes: { type: "string" },
  turns: { type: "string" },
  practice: { type: "string" },
  admit: { type: "string" },
  promotions: { type: "string" },
  moves: { type: "string" },
  handover: { type: "string" },
  loaded: { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  hitl: { type: "boolean" },
  "past-stop": COMPARISON_OPTIONS["past-stop"],
} as const;
/** What a campaign runs by where neither a flag nor its record says: the reserve of one solve in
 *  dollars and a seat's effort. The reserve was 10 until
 *  3 November, when 44,573 Opus solves under the 20-turn, 30-minute limits had billed at most $2.83
 *  (p99 $0.64), and an $800 campaign's every comparison told its Builder that the cap would cut its
 *  96 solves short at 80. */
const DEFAULTS = { reserve: COMPARISON_OPTIONS.reserve.default, effort: "high" } as const;
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
  solves: "solves a side of each scored task (setting; 2)",
  level: "the step test's level: one reading at or under it promotes (0.02)",
  minutes: "a Builder conversation's deadline in minutes of its own time (1440)",
  turns: "a Builder conversation's session turn limit (300)",
  practice: "practice tasks released after each reading or promotion, at most half of what is held",
  admit: "checks admitted by name, under --hitl",
  promotions: "the promotions after which the campaign ends on the operator's word; none to lift it (none)",
  moves: "the most campaign moves this run makes",
  handover: "a directory, outside the repository, to write what the campaign hands over at its end",
  loaded: "start solves without waiting for the host's load",
  "dry-run": "print the table's advice and make no move",
  hitl: "the operator in the loop: freezing, admitting and promoting wait for the operator's word; kept until --no-hitl",
  "past-stop": "the operator's reason to go on past the stop rule, logged",
};

const OPENED = "campaign.opened";
export const MOVED = "campaign.move";
/** The Builder conversations in a row that make no campaign move before a campaign ends. A Codex
 *  goal stays active across turns until its model calls it met, or blocked once the same blocker
 *  has held for three; a climb is never met, so three conversations without a move are its block. */
export const IDLE = 3;
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
 * What the campaign runs by: its record, or what this command names where that is another, written
 * again where they differ or a word asked for it. A paid campaign needs its total and a Referee, and
 * a rehearsal's needs neither. A total the operator left as a word stands over the flag the command
 * was started with, which is older (`word.ts`), and the newest of several words over the rest.
 */
export function opened(
  log: string,
  values: Values,
  seats: "paid" | "scripted",
  heard: readonly Word[] = [],
): Opening {
  const events = read(log);
  const was = openingOf(events);
  const dollars = heard.at(-1)?.dollars ?? values.budget ?? was?.budget?.dollars;
  if (seats === "paid" && values.budget === undefined && was?.budget == null) {
    throw new Error(
      "name --budget, the dollars this campaign may bill in all: each move is held to what is left of it, and the campaign ends where less is left than one solve is held at",
    );
  }
  /** A seat as this command names it, and as the record holds it where the command names none. */
  const seat = (model: string | undefined, effort: string | undefined, kept: Seat | null | undefined) => {
    const named = model ?? kept?.model;
    return named === undefined ? null : { model: named, effort: effort ?? kept?.effort ?? DEFAULTS.effort };
  };
  const prompt = promptOf(values, was);
  if (prompt === null && !packed(values)) {
    throw new Error(
      `name the campaign's pack with --root, --sweep, --cycle and --bundle, or give the prompt it opens from with --prompt: ${log} holds neither`,
    );
  }
  // The recorded solver takes no effort from a command that does not name its model.
  const solver = seat(
    values.solver,
    values.solver === undefined ? undefined : values["solver-effort"],
    was?.solver,
  );
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
  // The level is pinned whether or not a command named it, to the one the campaign's comparisons
  // began under, as the setting is held to its first solves (`firstRecord`): a tree whose default
  // moved would otherwise change the test of a campaign run on from it. A command that names another
  // is refused before anything is written (rule 4), since it would move every later comparison's test.
  const began = events.findLast(({ kind, data }) => kind === STARTED && isNumber(data.level))?.data.level;
  if (isNumber(began) && values.level !== undefined && Number(values.level) !== began) {
    throw new Error(
      `--level ${values.level}: the campaign's comparisons began at level ${String(began)}, and a term is never moved after a result. Drop the flag; another level is another campaign`,
    );
  }
  const named: Omit<Opening, "project"> = {
    budget: dollars === undefined ? null : capRead(String(dollars), reserve),
    patience: values.patience === undefined ? (was?.patience ?? PATIENCE) : Number(values.patience),
    seats: {
      builder: seat(values.builder, values["builder-effort"], was?.seats.builder),
      examiner: seat(values.examiner, values["examiner-effort"], was?.seats.examiner),
      reviewer: seat(values.reviewer, values["reviewer-effort"], was?.seats.reviewer),
    },
    attended: values.hitl ?? was?.attended ?? false,
    prompt,
    solver: prompt === null ? null : solver,
    terms: {
      level: COMPARISON_OPTIONS.level.default,
      ...was?.terms,
      ...Object.fromEntries(
        TERMS.flatMap((term) => (values[term] === undefined ? [] : [[term, values[term]]])),
      ),
      ...keyIfDefined("level", isNumber(began) ? String(began) : undefined),
    },
  };
  if (seats === "paid" && named.seats.reviewer === null) {
    throw new Error("name --reviewer: a paid campaign needs a Referee to rule its rejections");
  }
  counted(
    named.patience,
    `--patience ${String(values.patience)}: the moves without a gain the campaign bears in a row`,
  );
  const cap = named.terms.promotions;
  if (cap !== undefined && cap !== "none") {
    counted(Number(cap), `--promotions ${cap}: the promotions before the campaign ends`);
  }
  const project = projectOf(log, values.project, was);
  // Absent keys stay absent, so that a record from before each of them reads as written.
  const record: JsonObject = {
    project,
    budget: named.budget === null ? null : { ...named.budget },
    patience: named.patience,
    seats: Object.fromEntries(
      SEATS.map((each) => [each, named.seats[each] === null ? null : { ...named.seats[each] }]),
    ),
    ...keyIfDefined("attended", named.attended || undefined),
    ...keyIfDefined("prompt", named.prompt ?? undefined),
    ...keyIfDefined("solver", named.solver === null ? undefined : { ...named.solver }),
    terms: { ...named.terms },
  };
  // The record as it was written, less the words it answered and who led it (until 3 November).
  const { answers: _heard, led: _led, ...kept } = events.findLast(({ kind }) => kind === OPENED)?.data ?? {};
  if (!values["dry-run"] && (heard.length > 0 || !sameJsonValue(kept, record))) {
    // A campaign that opens from a prompt has no folder until now.
    mkdirSync(dirname(log), { recursive: true });
    append(log, OPENED, {
      ...record,
      ...keyIfDefined("answers", heard.length === 0 ? undefined : heard.map(({ at }) => at)),
    });
  }
  return { ...named, project };
}

/**
 * The Builder sessions in a row, the latest included, that have made no campaign move since the
 * campaign last ended: the trailing run of its moves that are Builder conversations (`build`), and
 * on a log from before 3 November sessions its host made. Any other move, the host's own among them, is
 * progress. A run of the command after an ending
 * starts the count afresh, as Codex audits a resumed goal afresh. A conversation the provider
 * crashed or a stop killed chose nothing and is left out: until 15 October finished, crashed,
 * finished counted three. So is
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
  return moves.length - 1 - moves.findLastIndex(({ move }) => move !== "build");
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

/** The flags of a comparison that began, as its start holds them: it goes on under its own terms. */
function termsOf(events: readonly LogEvent[], id: string): string[] {
  const start = startOf(events, id) ?? {};
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

/** The flags a move that solves shares with every other: the cap, which is what is left of the
 *  campaign's total; the reviewers; and the word past the stop rule. The setting is the log's
 *  record from the campaign's start (`startSetting`), so no move is given it as flags: until
 *  5 November each was, where none was recorded yet. */
export function sharedOf({ plan, opening, values, seats }: Turn) {
  const reviewer = seats.unreviewed === true ? null : opening.seats.reviewer;
  return {
    cap:
      plan.left == null
        ? []
        : ["--cap", plan.left.dollars.toFixed(2), "--reserve", String(plan.left.reserve)],
    reviewer: reviewer === null ? [] : ["--reviewer", reviewer.model, "--reviewer-effort", reviewer.effort],
    pastStop: flag("past-stop", values["past-stop"]),
  };
}

/** How the campaign runs Examiner session `session`: its flags, for `draft.ts` where it drafts the
 *  exam and `examine.ts` where it writes tasks, and the count of tasks a writing session is asked
 *  for. Each session reads the campaign's setting from the log, where the campaign command
 *  records it as it starts (`startSetting`, `harness-builder.ts`), and runs by its own defaults.
 *
 *  The count is what the campaign is short of, at least a sweep (`shortOf`, `decide.ts`), and none
 *  where it is short of nothing. No flag names another count: an ask above the shortfall had
 *  campaigns examine towards a target for hours before their first comparison. */
export function examinerRun(turn: Turn, session: string, kind: "draft" | "write") {
  const { opening, values, seats } = turn;
  const { examiner } = opening.seats;
  if (seats.seated === solved && examiner === null) {
    throw new Error("name --examiner: the campaign needs an Examiner session");
  }
  const seat = [
    "--session",
    session,
    "--examiner",
    examiner?.model ?? SCRIPTED,
    "--examiner-effort",
    examiner?.effort ?? DEFAULTS.effort,
  ];
  const wanting = shortOf(turn.events, turn.plan);
  const tasks = wanting > 0 ? String(wanting) : undefined;
  return {
    args:
      kind === "draft"
        ? [...flag("name", values.name), ...seat]
        : [...packOf(values), ...seat, ...flag("tasks", tasks)],
    tasks,
  };
}

/** The flags of the comparison a move names: a new one under the next free id, or one that began,
 *  under its id and its own terms. */
export function comparisonOf(decided: Extract<Decided, { move: "compare" }>, turn: Turn) {
  const { events, values } = turn;
  const { cap, reviewer, pastStop } = sharedOf(turn);
  const session = decided.id ?? nextId(events, "g");
  const terms =
    decided.id === undefined ? [...flag("level", values.level), ...cap] : termsOf(events, decided.id);
  return {
    session,
    args: [
      ...packOf(values),
      "--id",
      session,
      "--new",
      decided.fresh,
      "--reference",
      decided.reference,
      ...terms,
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
