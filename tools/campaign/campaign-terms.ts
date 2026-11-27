/**
 * What a campaign's command and a live Builder's campaign tools share (`harness-builder.ts`,
 * `campaign-actions.ts`): the command's flags, what a campaign runs by and keeps in its opening,
 * and the flags of each move's command. Nothing here knows who makes a move. A paid campaign needs
 * a Referee before it opens, so no rejection it counts goes unruled.
 */
import { STARTED, startOf } from "#src/campaign/comparison.ts";
import { frontierOverlap, OVERLAP_LIMIT } from "#src/campaign/round.ts";
import { supplyRun, tasksToAskFor } from "#src/campaign/scheduler.ts";
import { comparisonsOf, cutShort, type Plan } from "#src/campaign/state.ts";
import { type ScheduledAction, short } from "#src/campaign/move.ts";
import { type Opening, openingOf, planOf, SEATS, type Seat, TERMS } from "#src/campaign/opening.ts";
import { ANSWERED, type ControlSignal } from "#src/campaign/signal.ts";
import { draftOf } from "#src/examiner/draft.ts";
import type { Session } from "#src/examiner/session.ts";
import { frozenChecker } from "#src/kernel/acceptance.ts";
import { hasJudge } from "#src/kernel/contract.ts";
import {
  append,
  CALL_KINDS,
  eachEvent,
  eventsOf,
  type LogEvent,
  read,
  TRACE_KINDS,
} from "#src/kernel/log.ts";
import { latestBuilt, PATIENCE, referenceOf } from "#src/kernel/reports.ts";
import { mkdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { sameJsonValue } from "#src/meta/stable-json.ts";
import { PACK_OPTIONS, projectOf } from "./campaign.ts";
import type { Host } from "./host.ts";
import { PRACTICE, prepareCommand, ungated } from "./prepare.ts";
import { promoteCommand } from "./promote.ts";
import type { RevisionAuditor } from "./revise.ts";
import {
  type Campaign,
  COMPARISON_OPTIONS,
  assertCrossFamily,
  capRead,
  crossFamilyVendors,
  SESSION_OPTIONS,
  type Seated,
  solved,
} from "./round.ts";
import { SETTING_OPTIONS } from "./setting.ts";

export interface Seats {
  readonly seated: Seated;
  readonly examine?: Session<"write"> | undefined;
  readonly draft?: Session<"draft"> | undefined;
  readonly audit?: RevisionAuditor | null | undefined;
  readonly host?: Host | undefined;
  readonly prepare?: typeof prepareCommand | undefined;
  readonly unreviewed?: boolean | undefined;
}

export interface Turn {
  readonly events: readonly LogEvent[];
  readonly plan: Plan;
  readonly opening: Opening;
  readonly values: Values;
  readonly seats: Seats;
  readonly held: Seated;
}

export type Values = ReturnType<typeof flagsOf>;

type TurnSource = Pick<Turn, "values" | "opening" | "seats" | "held"> & {
  readonly log: string;
  readonly campaign: Campaign | null;
};

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
  revise: { type: "boolean" },
  "past-stop": COMPARISON_OPTIONS["past-stop"],
} as const;
const DEFAULTS = { reserve: COMPARISON_OPTIONS.reserve.default, effort: "high" } as const;
/**
 * The one list of the command's flags, printed by `--help` (`flagsHelp`) and typed by `OPTIONS`, so
 * no flag is added without its line. A term the opening keeps (`TERMS`, `src/campaign/opening.ts`)
 * holds once named, and a later run that names nothing runs by the record.
 */
const EXPLAINED: Readonly<Record<keyof typeof OPTIONS, string>> = {
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
  solves: "rollouts per arm on each scored task (setting; 2)",
  level: "the step test's level: one reading at or under it promotes (0.02)",
  minutes: "a Builder conversation's deadline in minutes of its own time (1440)",
  turns: "a Builder conversation's session turn limit (300)",
  practice: "practice tasks released after each reading or promotion, at most half of what is held",
  admit:
    "author-computed checks admitted by name under --hitl (judged items use tools/eval/accept.ts --admit-judge)",
  promotions: "the promotions after which the campaign ends on the operator's word; none to lift it (none)",
  moves: "the most campaign moves this run makes",
  handover: "a directory, outside the repository, to write what the campaign hands over at its end",
  loaded: "start solves without waiting for the host's load",
  "dry-run": "print the table's advice and make no move",
  hitl: "the operator in the loop: freezing, admitting and promoting wait for the operator's word; kept until --no-hitl",
  revise: "allow mid-campaign exam revisions via revise_exam (default on; --no-revise disables)",
  "past-stop": "the operator's reason to go on past the stop rule, logged",
};

const OPENED = "campaign.opened";
export const MOVED = "campaign.move";
/** The Builder conversations in a row that make no campaign move before a campaign ends: a climb is
 *  never met, so three conversations without a move are its block, as a Codex goal is blocked once
 *  the same blocker has held for three turns. */
export const IDLE = 3;
const SCRIPTED = "claude/claude-opus-5-5";

export const flag = (name: string, value: string | undefined): string[] =>
  value === undefined ? [] : [`--${name}`, value];

export const moved = (
  log: string,
  { move, code, why }: Pick<ScheduledAction, "move" | "code" | "why">,
  named: JsonObject = {},
) => append(log, MOVED, { move, code, why, ...named });

export const prepared = (
  { seats, values }: Pick<Turn, "seats" | "values">,
  practice: string | undefined,
  heldBack?: Parameters<typeof prepareCommand>[1],
): Promise<number> =>
  (seats.prepare ?? prepareCommand)(
    [...packOf(values), ...flag("practice", practice), ...flag("level", values.level)],
    heldBack,
  );

export const awaitsOperator = (name: string, harness: string): string =>
  `under --hitl a promotion is the operator's word: bun tools/campaign/promote.ts --name ${name} --harness ${harness} --yes, or run this command with --no-hitl`;

export async function promoteMade(
  log: string,
  name: string | undefined,
  owed: Extract<ScheduledAction, { move: "promote" }>,
): Promise<void> {
  moved(log, owed, { harness: owed.harness });
  await promoteCommand([...flag("name", name), "--harness", owed.harness, "--yes"]);
}

export function revertMade(log: string, owed: Extract<ScheduledAction, { move: "revert" }>): void {
  const from = referenceOf(read(log, TRACE_KINDS)) ?? "starter";
  moved(log, owed, { harness: owed.harness });
  append(log, "harness.reverted", {
    harness: owed.harness,
    from,
    reason: owed.why,
  });
}

export const flagsOf = (args: readonly string[]) =>
  parseArgs({ args: [...args], options: OPTIONS, allowNegative: true }).values;

export function flagsHelp(): string {
  const wide = Math.max(...Object.keys(EXPLAINED).map((named) => named.length));
  return Object.entries(EXPLAINED)
    .map(([named, said]) => `  --${named.padEnd(wide)}  ${said}`)
    .join("\n");
}

function promptOf(values: Values, was: Opening | null): string | null {
  const file = values["prompt-file"];
  const given = (values.prompt ?? (file === undefined ? undefined : readFileSync(file, "utf8")))?.trim();
  if (given === "") throw new Error("the prompt is empty");
  return given ?? was?.prompt ?? null;
}

const counted = (count: number, what: string): void => {
  if (!Number.isInteger(count) || count < 1) throw new Error(`${what} are a whole number of at least one`);
};

const seatOf = (
  model: string | undefined,
  effort: string | undefined,
  kept: Seat | null | undefined,
): Seat | null => {
  const named = model ?? kept?.model;
  return named === undefined ? null : { model: named, effort: effort ?? kept?.effort ?? DEFAULTS.effort };
};

/** Merges move terms from flags and the prior opening, refusing any `--level` change after a
 *  comparison starts. */
function resolveTerms(events: readonly LogEvent[], was: Opening | null, values: Values): Opening["terms"] {
  const began = events.findLast(({ kind }) => kind === STARTED)?.data.level;
  if (isNumber(began) && values.level !== undefined && Number(values.level) !== began) {
    throw new Error(
      `--level ${values.level}: the campaign's comparisons began at level ${String(began)}, and a term is never moved after a result. Drop the flag; another level is another campaign`,
    );
  }
  return {
    level: COMPARISON_OPTIONS.level.default,
    ...was?.terms,
    ...Object.fromEntries(
      TERMS.flatMap((term) => (values[term] === undefined ? [] : [[term, values[term]]])),
    ),
    ...keyIfDefined("level", isNumber(began) ? String(began) : undefined),
  };
}

function validateOpening(
  opening: Opening,
  values: Values,
  seats: "paid" | "scripted",
  events: readonly LogEvent[],
): void {
  if (seats === "paid") {
    const reviewer = opening.seats.reviewer;
    if (reviewer === null) {
      throw new Error("name --reviewer: a paid campaign needs a Referee to rule its rejections");
    }
    if (frozenChecker(events) !== null && hasJudge(draftOf(events)?.objective) && opening.solver !== null) {
      assertCrossFamily(reviewer.model, opening.solver.model);
    }
  }
  counted(
    opening.patience,
    `--patience ${String(values.patience)}: the moves without a gain the campaign bears in a row`,
  );
  const cap = opening.terms.promotions;
  if (cap !== undefined && cap !== "none") {
    counted(Number(cap), `--promotions ${cap}: the promotions before the campaign ends`);
  }
}

function resolveBudget(
  values: Values,
  was: Opening | null,
  seats: "paid" | "scripted",
  heard: readonly ControlSignal[],
): Opening["budget"] {
  const dollars = heard.at(-1)?.dollars ?? values.budget ?? was?.budget?.dollars;
  if (seats === "paid" && values.budget === undefined && was?.budget == null) {
    throw new Error(
      "name --budget, the dollars this campaign may bill in all: each move is held to what is left of it, and the campaign ends where less is left than one solve is held at",
    );
  }
  const reserve = values.reserve ?? String(was?.budget?.reserve ?? DEFAULTS.reserve);
  return dollars === undefined ? null : capRead(String(dollars), reserve);
}

function persistOpening(
  log: string,
  events: readonly LogEvent[],
  opening: Opening,
  mode: "write" | "dry-run",
  heard: readonly ControlSignal[],
): void {
  const record: JsonObject = {
    project: opening.project,
    budget: opening.budget === null ? null : { ...opening.budget },
    patience: opening.patience,
    seats: Object.fromEntries(
      SEATS.map((each) => [each, opening.seats[each] === null ? null : { ...opening.seats[each] }]),
    ),
    ...keyIfDefined("attended", opening.attended || undefined),
    ...keyIfDefined("judged", opening.judged || undefined),
    ...keyIfDefined("revise", opening.revise ? undefined : false),
    ...keyIfDefined(
      "parent",
      opening.parent === null
        ? undefined
        : {
            ...opening.parent,
            carried: { ...opening.parent.carried },
            lineageTasks: [...opening.parent.lineageTasks],
          },
    ),
    ...keyIfDefined("prompt", opening.prompt ?? undefined),
    ...keyIfDefined("solver", opening.solver === null ? undefined : { ...opening.solver }),
    terms: { ...opening.terms },
  };
  const { answers: _heard, led: _led, ...kept } = events.findLast(({ kind }) => kind === OPENED)?.data ?? {};
  if (mode === "dry-run" || (heard.length === 0 && sameJsonValue(kept, record))) return;
  mkdirSync(dirname(log), { recursive: true });
  append(log, OPENED, {
    ...record,
    ...keyIfDefined("answers", heard.length === 0 ? undefined : heard.map(({ at }) => at)),
  });
}

export function opened(
  log: string,
  values: Values,
  seats: "paid" | "scripted",
  heard: readonly ControlSignal[] = [],
): Opening {
  const events = read(log, CALL_KINDS);
  const was = openingOf(events);
  const budget = resolveBudget(values, was, seats, heard);
  const prompt = promptOf(values, was);
  if (prompt === null) {
    throw new Error(`give the prompt the campaign opens from with --prompt: ${log} holds none`);
  }
  const solver = seatOf(
    values.solver,
    values.solver === undefined ? undefined : values["solver-effort"],
    was?.solver,
  );
  if (solver === null) {
    throw new Error(
      "name --solver: a campaign that opens from a prompt has no record to take its solver from",
    );
  }
  if (was !== null && was.prompt !== prompt && draftOf(events) !== null) {
    throw new Error(
      "the campaign's exam was drafted from another prompt than this command gives: a prompt names one campaign, and another takes a name of its own",
    );
  }
  const resolvedSeats: Opening["seats"] = {
    builder: seatOf(values.builder, values["builder-effort"], was?.seats.builder),
    examiner: seatOf(values.examiner, values["examiner-effort"], was?.seats.examiner),
    reviewer: seatOf(values.reviewer, values["reviewer-effort"], was?.seats.reviewer),
  };
  const attended = values.hitl ?? was?.attended ?? false;
  const revise = values.revise ?? was?.revise ?? true;
  const crossFamily =
    resolvedSeats.reviewer !== null && crossFamilyVendors(resolvedSeats.reviewer.model, solver.model);
  const judged = !attended && crossFamily;
  const opening: Opening = {
    project: projectOf(log, values.project, was),
    budget,
    patience: values.patience === undefined ? (was?.patience ?? PATIENCE) : Number(values.patience),
    seats: resolvedSeats,
    attended,
    judged,
    revise,
    parent: was?.parent ?? null,
    prompt,
    solver,
    terms: resolveTerms(events, was, values),
  };
  validateOpening(opening, values, seats, events);
  persistOpening(log, events, opening, values["dry-run"] ? "dry-run" : "write", heard);
  return opening;
}

export function idleOf(events: readonly LogEvent[]): number {
  const since = events.slice((eventsOf(events, "campaign.ended").at(-1)?.index ?? -1) + 1);
  const counts = new Map<string, number>();
  for (const { data } of since) {
    if (isString(data.session)) counts.set(data.session, (counts.get(data.session) ?? 0) + 1);
  }
  const cut = new Set([
    ...since.filter(cutShort).map(({ data }) => data.session),
    ...[...counts].flatMap(([session, seen]) => (seen === 1 ? [session] : [])),
  ]);
  const moves = since.flatMap(({ kind, data }) => (kind === MOVED && !cut.has(data.session) ? [data] : []));
  return moves.length - 1 - moves.findLastIndex(({ move }) => move !== "build");
}

export function nextId(events: readonly LogEvent[], prefix: string): string {
  const taken = events.flatMap(({ data }) => {
    const id = isString(data.session) && data.session.startsWith(`${prefix}-`) ? data.session : "";
    const nth = Number(id.slice(prefix.length + 1));
    return id !== "" && Number.isInteger(nth) ? [nth] : [];
  });
  return `${prefix}-${String(Math.max(0, ...taken) + 1)}`;
}

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

export const packOf = ({ name }: Values): string[] => flag("name", name);

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
  const wanting = tasksToAskFor(turn.events, turn.plan);
  const tasks = wanting > 0 ? String(wanting) : undefined;
  const reviewer = kind === "write" ? sharedOf(turn).reviewer : [];
  const reviseFlag = kind === "write" && !opening.revise ? ["--no-revise"] : [];
  return {
    args: [
      ...packOf(values),
      ...seat,
      ...reviewer,
      ...reviseFlag,
      ...(kind === "draft" ? [] : flag("tasks", tasks)),
    ],
    tasks,
  };
}

export const LED = "led";
export const CHOSE = "the Builder's own move in its campaign conversation";

type CompareMove = Extract<ScheduledAction, { move: "compare" }>;

interface ComparisonChoice {
  readonly events: readonly LogEvent[];
  readonly plan: Plan;
  readonly decided: ScheduledAction;
  readonly working: string;
  readonly reference: string;
  readonly contractHash: () => string;
  readonly hasExaminer: boolean;
  readonly examiningSession: string | null;
}

export const readAgainst = (events: readonly LogEvent[], fresh: string, reference: string): boolean =>
  comparisonsOf(events).some((each) => each.fresh === fresh && each.old === reference);

export function selectComparison(
  input: ComparisonChoice,
):
  | { readonly move: CompareMove; readonly froze?: string; readonly note: string }
  | { readonly refused: string } {
  const { events, plan, decided, working, reference, hasExaminer, examiningSession } = input;
  const latest = latestBuilt(events);
  if (working === reference) {
    return decided.move === "compare"
      ? {
          move: decided,
          note: `harness/ is the reference harness, so the ${decided.fresh} harness was read against it.`,
        }
      : { refused: "harness/ is the reference harness: there is nothing to compare until it changes." };
  }
  if (decided.move === "compare" && decided.fresh === "starter") {
    return {
      move: decided,
      note: "The table's comparison of the starter ran first: compare reads harness/ next.",
    };
  }
  if (decided.move === "compare" && decided.fresh === "latest" && working === latest) {
    return { move: decided, note: "" };
  }
  if (readAgainst(events, working, reference)) {
    return {
      refused: `harness/ is harness ${short(working)}, which a comparison has read against the reference, and nothing in it has changed since: there is nothing new to compare. Between equal harnesses one comparison reads a step as often as its level, and a harness changed in little draws that chance again.`,
    };
  }
  const canExamine = hasExaminer && supplyRun(events, plan) < plan.patience;
  if (canExamine) {
    const repeat = frontierOverlap(events, plan.wanted.target, input.contractHash(), reference);
    if (repeat !== null && repeat.ratio >= OVERLAP_LIMIT) {
      const nextStep =
        examiningSession === null
          ? "Call examine to hold out fresh tasks before comparing another candidate."
          : `Examiner session ${examiningSession} is already writing tasks; call wait before comparing another candidate.`;
      return {
        refused: `This comparison would draw ${String(repeat.overlap)} of ${String(repeat.total)} frontier tasks (${String(Math.round(repeat.ratio * 100))}%) already scored in comparison ${repeat.priorSession}. ${nextStep}`,
      };
    }
  }
  return {
    move: { move: "compare", code: LED, fresh: working, reference: "promoted", why: CHOSE },
    note: "",
    ...keyIfDefined("froze", working === latest ? undefined : working),
  };
}

export function comparisonOf(decided: CompareMove, turn: Turn) {
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

function readForTurn(log: string): LogEvent[] {
  const events: LogEvent[] = [];
  const heard = new Set<number>();
  const words: number[] = [];
  eachEvent(
    log,
    (event, index) => {
      events.push(event);
      if (Array.isArray(event.data.answers)) {
        for (const at of event.data.answers) {
          if (isNumber(at)) heard.add(at);
        }
      }
      if (event.kind === "campaign.word" && ANSWERED.some((word) => word === event.data.word)) {
        words.push(index);
      }
    },
    CALL_KINDS,
  );
  return words.some((at) => !heard.has(at)) ? read(log) : events;
}

export function turnOf(source: TurnSource): Turn {
  const { log, values, opening, seats, held, campaign } = source;
  const events = readForTurn(log);
  return {
    events,
    opening,
    values,
    seats,
    held,
    plan: planOf(
      events,
      {
        unprepared: campaign !== null && ungated(campaign, events).length > 0,
        level: Number(values.level ?? COMPARISON_OPTIONS.level.default),
        target: values.target === undefined ? undefined : Number(values.target),
        pastStop: values["past-stop"],
        // The checks `--admit` names, each the operator's word.
        admits: (values.admit ?? "").split(",").flatMap((id) => (id.trim() === "" ? [] : [id.trim()])),
        practice: values.practice === undefined ? PRACTICE : Number(values.practice),
      },
      opening,
    ),
  };
}
