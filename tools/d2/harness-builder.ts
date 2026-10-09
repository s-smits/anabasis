/**
 * The Harness Builder's controller: one campaign run by its log, move after move.
 *
 *   bun tools/d2/harness-builder.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss \
 *     --budget 400 --builder claude/claude-opus-5-5 --examiner claude/claude-opus-5-5 \
 *     --reviewer claude/claude-opus-5-5 --solve-model-turns 40 [--moves 1] [--dry-run] [--unattended]
 *
 * A campaign is a loop of moves over one log (`docs/plan.md`, "The process"). Until 2026-10-09 a
 * session carried each one by hand: it read the view, chose a move by a skill's walk, and typed
 * the command with its flags. This command does that. It reads the log, asks move 7 for the one
 * move that follows (`decide`, `src/builder/decide.ts`), prints it with its reason, makes it by
 * the command an operator would run, and reads the log again, until the campaign ends or `--moves`
 * are made. It chooses nothing of its own: the table chooses, and every refusal is the command's.
 *
 * What it runs each move as:
 *
 *   read the exam       tools/c/accept.ts, with the checks `--admit` names, which is the operator's
 *                       word for each, and with `--freeze` under `--unattended`
 *   set the tasks apart tools/d2/prepare.ts
 *   an Examiner session tools/d1b/examine.ts, under the next free id `x-N`
 *   a Builder session   tools/d2/session.ts, under `b-N`
 *   a comparison        tools/d2/checkpoint.ts, under `g-N`, read also at each shorter budget of
 *                       the ladder; one that began goes on under its id and its own terms
 *   the budget          a new record of the setting (`rebudget`, `setting.ts`)
 *   a promotion         tools/d2/promote.ts `--yes`
 *
 * **What it runs by** is recorded once, as `campaign.opened`: the total budget in dollars and the
 * reserve one solve is held at (`--budget`, `--reserve`), the full limit of a solve in the model's
 * turns (`--solve-model-turns`), the ladder of shorter budgets (`--ladder`, by default a half, a
 * quarter and an eighth of the limit), the Builder sessions before a comparison (`--sessions`),
 * and who sits in each seat. A later run that names nothing runs by the record, and one that
 * names another records it again: these are the operator's conditions, and none of them moves a
 * comparison's reading. The setting is the log's own record (`campaign.setting`), named by the
 * first command that begins and by no flag after.
 *
 * **The budget is one total** (`docs/plan.md`, row F49). Each move's cap is what is left of it:
 * the total less every billed dollar the log holds. Where less is left than one solve is held at,
 * the campaign ends on its budget. A cap was typed for each move until now, and nothing summed
 * them.
 *
 * **Three moves were the operator's each time**, and still are unless `--unattended` gives the
 * word once for the campaign (row F29): the freeze of an exam whose reading holds no fault, the
 * promotion of a step read twice and not lost at the full limit, which otherwise stops the
 * command with the promotion to make, and going on past the stop rule, which takes
 * `--past-stop "<why>"` either way.
 *
 * **Endings.** A campaign ends on its budget, on the stop rule, on an exam that was not accepted,
 * on tasks that could not be made to leave room, or on its environment, and the last event of its
 * log says which (`campaign.ended`). A move that threw after it had begun is the environment's
 * ending, and run again the command goes on from the log. A move refused before it wrote
 * anything is no ending: the refusal is printed and nothing is recorded.
 *
 * A move is recorded once it is made (`campaign.move`), with the reason the table gave, so the
 * log holds what was decided beside what was done.
 *
 * `--dry-run` prints the next move and makes none. Under a rehearsal's seats (`tools/runs/`) the
 * same loop runs with a script in each model seat, no budget and no model.
 *
 * Not run here: see `campaign.ts`.
 */
import type { examine } from "#src/examiner/session.ts";
import {
  type Decided,
  decide,
  decidedLine,
  type Opening,
  openingOf,
  type Plan,
  planOf,
  SEATS,
  type Seat,
  SESSIONS,
} from "#src/builder/decide.ts";
import { append, type LogEvent, read } from "#src/kernel/log.ts";
import { latestBuilt, promoted } from "#src/kernel/reports.ts";
import { taskStates, taskVersion } from "#src/kernel/task.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { parseArgs } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { sameJsonValue } from "#src/meta/stable-json.ts";
import { acceptCommand } from "../c/accept.ts";
import { examineCommand } from "../d1b/examine.ts";
import { campaignLog, openCampaign } from "./campaign.ts";
import { checkpointCommand } from "./checkpoint.ts";
import { prepareCommand } from "./prepare.ts";
import { promoteCommand } from "./promote.ts";
import { COMPARISON_OPTIONS, capRead, type Seated, SESSION_OPTIONS, solved } from "./round.ts";
import { sessionCommand } from "./session.ts";
import { rebudget, recordedSetting, SETTING_OPTIONS } from "./setting.ts";

/** Who sits in a campaign's model seats: a session's and a comparison's, and an Examiner's. */
export interface Seats {
  readonly seated: Seated;
  /** An Examiner session: `examine`, unless a rehearsal's script stands in for it. */
  readonly examine?: typeof examine | undefined;
}

/** What every move of one turn of the loop is made with. */
interface Turn {
  readonly events: readonly LogEvent[];
  readonly plan: Plan;
  readonly opening: Opening;
  readonly values: Values;
  readonly seats: Seats;
}

type Values = ReturnType<typeof flagsOf>;

const OPTIONS = {
  root: SESSION_OPTIONS.root,
  sweep: SESSION_OPTIONS.sweep,
  cycle: SESSION_OPTIONS.cycle,
  bundle: SESSION_OPTIONS.bundle,
  name: SESSION_OPTIONS.name,
  budget: { type: "string" },
  reserve: { type: "string" },
  ladder: { type: "string" },
  sessions: { type: "string" },
  builder: SESSION_OPTIONS.builder,
  "builder-effort": { type: "string" },
  examiner: { type: "string" },
  "examiner-effort": { type: "string" },
  reviewer: COMPARISON_OPTIONS.reviewer,
  "reviewer-effort": { type: "string" },
  solver: SETTING_OPTIONS.solver,
  "solver-effort": SETTING_OPTIONS["solver-effort"],
  "solve-minutes": SETTING_OPTIONS["solve-minutes"],
  "solve-turns": SETTING_OPTIONS["solve-turns"],
  "solve-model-turns": SETTING_OPTIONS["solve-model-turns"],
  target: COMPARISON_OPTIONS.target,
  solves: COMPARISON_OPTIONS.solves,
  level: COMPARISON_OPTIONS.level,
  defects: COMPARISON_OPTIONS.defects,
  minutes: { type: "string" },
  turns: { type: "string" },
  "practice-solves": { type: "string" },
  practice: { type: "string" },
  admit: { type: "string" },
  "exam-tasks": { type: "string" },
  "exam-proposals": { type: "string" },
  "exam-minutes": { type: "string" },
  "exam-turns": { type: "string" },
  moves: { type: "string" },
  "dry-run": { type: "boolean", default: false },
  unattended: { type: "boolean", default: false },
  "past-stop": COMPARISON_OPTIONS["past-stop"],
} as const;
/** What a campaign runs by where neither a flag nor its record says: the reserve of one solve in
 *  dollars, the Builder sessions before a comparison, and a seat's effort. */
const DEFAULTS = { reserve: "10", sessions: SESSIONS, effort: "high" } as const;
const OPENED = "campaign.opened";
const ENDED = "campaign.ended";
/** A model a backend serves, named where a rehearsal's script sits in the Examiner's seat: the
 *  command wants a name, and the script is what is asked. */
const SCRIPTED = "claude/claude-opus-5-5";

const flag = (name: string, value: string | undefined): string[] =>
  value === undefined ? [] : [`--${name}`, value];

function flagsOf(args: readonly string[]) {
  return parseArgs({ args: [...args], options: OPTIONS }).values;
}

/** The shorter budgets a campaign's comparisons are read at: the ones `--ladder` names, or a half,
 *  a quarter and an eighth of the full limit where that is at least two of the model's turns. */
function ladderOf(named: string | undefined, limit: number | null): number[] {
  const rungs =
    named === undefined
      ? [2, 4, 8].flatMap((part) => (limit !== null && limit / part >= 2 ? [Math.floor(limit / part)] : []))
      : named.split(",").map(Number);
  if (rungs.some((rung) => !Number.isInteger(rung) || rung < 1)) {
    throw new Error(
      `--ladder ${String(named)}: the shorter budgets are whole numbers of the model's turns, as 20,10,5`,
    );
  }
  return [...new Set(rungs)].filter((rung) => limit === null || rung < limit).toSorted((a, b) => b - a);
}

/**
 * What the campaign runs by: its record, or what this command names where that is another. A paid
 * campaign needs its total, and a rehearsal's is none.
 */
function opened(log: string, values: Values, seats: "paid" | "scripted"): Opening {
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
  const reserve = values.reserve ?? String(was?.budget?.reserve ?? DEFAULTS.reserve);
  const dollars = values.budget ?? (was?.budget == null ? undefined : String(was.budget.dollars));
  const named: Opening = {
    budget: dollars === undefined ? null : capRead(dollars, reserve),
    limit,
    ladder:
      values.ladder === undefined && was !== null && was.limit === limit
        ? was.ladder
        : ladderOf(values.ladder, limit),
    sessions: values.sessions === undefined ? (was?.sessions ?? DEFAULTS.sessions) : Number(values.sessions),
    seats: { builder: seat("builder"), examiner: seat("examiner"), reviewer: seat("reviewer") },
  };
  if (!Number.isInteger(named.sessions) || named.sessions < 1) {
    throw new Error(
      `--sessions ${String(values.sessions)}: the Builder sessions before a comparison are a whole number of at least one`,
    );
  }
  const record: JsonObject = {
    budget: named.budget === null ? null : { ...named.budget },
    limit: named.limit,
    ladder: [...named.ladder],
    sessions: named.sessions,
    seats: Object.fromEntries(
      SEATS.map((each) => [each, named.seats[each] === null ? null : { ...named.seats[each] }]),
    ),
  };
  const kept = events.findLast(({ kind }) => kind === OPENED)?.data;
  if (!values["dry-run"] && (kept === undefined || !sameJsonValue(kept, record))) {
    append(log, OPENED, record);
  }
  return named;
}

/** The next free id under `prefix`, as `b-3` after `b-1` and `b-2`. */
function nextId(events: readonly LogEvent[], prefix: string): string {
  const taken = events.flatMap(({ data }) => {
    const id = isString(data.session) && data.session.startsWith(`${prefix}-`) ? data.session : "";
    const nth = Number(id.slice(prefix.length + 1));
    return id !== "" && Number.isInteger(nth) ? [nth] : [];
  });
  return `${prefix}-${String(Math.max(0, ...taken) + 1)}`;
}

/** The flags of a comparison that began, as its start holds them: it goes on under its own terms. */
function termsOf(events: readonly LogEvent[], id: string): string[] {
  const start =
    events.find(({ kind, data }) => kind === "comparison.started" && data.session === id)?.data ?? {};
  const cap = asRecord(start.cap);
  const budgets = (Array.isArray(start.budgets) ? start.budgets : []).flatMap((budget) => {
    const units = Object.entries(asRecord(budget) ?? {}).flatMap(([unit, most]) =>
      isNumber(most) ? [`${unit}=${String(most)}`] : [],
    );
    return units.length === 0 ? [] : ["--budget", units.join(",")];
  });
  return [
    ...flag("solves", isNumber(start.solves) ? String(start.solves) : undefined),
    ...flag("level", isNumber(start.level) ? String(start.level) : undefined),
    ...(start.noise === true ? ["--noise"] : []),
    ...budgets,
    ...flag("cap", isNumber(cap?.dollars) ? String(cap.dollars) : undefined),
    ...flag("reserve", isNumber(cap?.reserve) ? String(cap.reserve) : undefined),
    ...flag("predict", isString(start.prediction) ? start.prediction : undefined),
  ];
}

/** The flags that name a campaign's pack and itself, as every command takes them. */
function packOf({ root, sweep, cycle, bundle, name }: Values): string[] {
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
function sharedOf({ events, plan, opening, values }: Turn) {
  const { reviewer } = opening.seats;
  return {
    setting:
      recordedSetting(events) === null
        ? (["solver", "solver-effort", "solve-minutes", "solve-turns", "solve-model-turns"] as const).flatMap(
            (each) => flag(each, values[each]),
          )
        : [],
    cap:
      plan.left == null
        ? []
        : ["--cap", plan.left.dollars.toFixed(2), "--reserve", String(plan.left.reserve)],
    reviewer: reviewer === null ? [] : ["--reviewer", reviewer.model, "--reviewer-effort", reviewer.effort],
    pastStop: flag("past-stop", values["past-stop"]),
  };
}

/** The flags of the comparison a move names: a new one under the next free id, read also at each
 *  shorter budget of the ladder, or one that began, under its id and its own terms. */
function comparisonOf(decided: Extract<Decided, { move: "compare" }>, turn: Turn) {
  const { events, plan, values } = turn;
  const { setting, cap, reviewer, pastStop } = sharedOf(turn);
  const recorded = recordedSetting(events);
  const turns = recorded === null ? plan.limit : recorded.modelTurns;
  const session = decided.id ?? nextId(events, "g");
  const terms =
    decided.id === undefined
      ? [
          ...(decided.noise ? ["--noise"] : []),
          "--solves",
          values.solves,
          "--level",
          values.level,
          ...plan.ladder.flatMap((rung) =>
            turns === null || rung < turns ? ["--budget", `turns=${String(rung)}`] : [],
          ),
          ...cap,
        ]
      : termsOf(events, decided.id);
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
      "--defects",
      values.defects,
      ...flag("target", recorded === null ? values.target : undefined),
      ...reviewer,
      ...pastStop,
    ],
  };
}

/** Make one decided move by the command an operator would run, and return what names it in the
 *  log: a session's or a comparison's id, a budget, a harness, or nothing. */
async function make(decided: Exclude<Decided, { move: "end" }>, turn: Turn): Promise<JsonObject> {
  const { events, opening, values, seats } = turn;
  const pack = packOf(values);
  const { builder, examiner } = opening.seats;
  if (decided.move === "accept") {
    await acceptCommand([
      ...pack,
      ...flag("admit", values.admit),
      ...(values.unattended ? ["--freeze"] : []),
    ]);
    return {};
  }
  if (decided.move === "prepare") {
    await prepareCommand([...pack, ...flag("practice", values.practice)]);
    return {};
  }
  if (decided.move === "budget") {
    rebudget(campaignLog(values.name ?? ""), decided.modelTurns);
    return { modelTurns: decided.modelTurns };
  }
  if (decided.move === "promote") {
    await promoteCommand([...flag("name", values.name), "--harness", decided.harness, "--yes"]);
    return { harness: decided.harness };
  }
  if (decided.move === "compare") {
    const { session, args } = comparisonOf(decided, turn);
    await checkpointCommand(args, seats.seated);
    return { session };
  }
  if (decided.move === "examine") {
    if (seats.seated === solved && examiner === null) {
      throw new Error(`name --examiner: ${decided.why}, and an Examiner session writes tasks`);
    }
    if (seats.seated !== solved && seats.examine === undefined) {
      throw new Error(`a rehearsal seats no Examiner, and the campaign needs one: ${decided.why}`);
    }
    const session = nextId(events, "x");
    await examineCommand(
      [
        ...pack,
        "--session",
        session,
        "--examiner",
        examiner?.model ?? SCRIPTED,
        "--examiner-effort",
        examiner?.effort ?? DEFAULTS.effort,
        ...flag("tasks", values["exam-tasks"]),
        ...flag("proposals", values["exam-proposals"]),
        ...flag("minutes", values["exam-minutes"]),
        ...flag("turns", values["exam-turns"]),
      ],
      seats.examine,
    );
    return { session };
  }
  const { setting, cap, reviewer, pastStop } = sharedOf(turn);
  const session = nextId(events, "b");
  await sessionCommand(
    [
      ...pack,
      ...setting,
      "--session",
      session,
      ...(builder === null ? [] : ["--builder", builder.model, "--builder-effort", builder.effort]),
      ...flag("minutes", values.minutes),
      ...flag("turns", values.turns),
      ...flag("practice-solves", values["practice-solves"]),
      ...cap,
      ...reviewer,
      ...pastStop,
    ],
    seats.seated,
  );
  return { session };
}

/** Record how the campaign ended, as its last event, unless that is what its last event says. */
function ended(log: string, events: readonly LogEvent[], decided: Extract<Decided, { move: "end" }>): void {
  const last = events.at(-1);
  if (last?.kind === ENDED && last.data.ending === decided.ending) return;
  append(log, ENDED, {
    ending: decided.ending,
    why: decided.why,
    reference: promoted(events) ?? "starter",
    latest: latestBuilt(events),
  });
}

/**
 * `bun tools/d2/harness-builder.ts`, and under a rehearsal's seats the same loop with a script in
 * each model seat. It returns the last thing move 7 said: the campaign's ending, or the move that
 * would be made next.
 */
export async function harnessBuilder(
  args: readonly string[],
  seats: Seats = { seated: solved },
): Promise<Decided> {
  const values = flagsOf(args);
  const { root, sweep, cycle, bundle, name } = values;
  if (
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined
  ) {
    throw new Error("name --root, --sweep, --cycle, --bundle and --name");
  }
  const most = values.moves === undefined ? Number.POSITIVE_INFINITY : Number(values.moves);
  if (Number.isNaN(most) || most < 0) {
    throw new Error(`--moves ${String(values.moves)}: the moves to make are a number`);
  }
  const log = campaignLog(name);
  // Opening the campaign stages its check program, and refuses one the log froze otherwise.
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name });
  const opening = opened(log, values, seats.seated === solved ? "paid" : "scripted");
  for (let made = 0; ; made += 1) {
    const events = existsSync(log) ? read(log) : [];
    const states = taskStates(events);
    const plan = planOf(
      events,
      {
        unprepared: campaign.tasks.some((task) => !states.has(taskVersion(campaign.pack(task)))),
        level: Number(values.level),
        target: values.target === undefined ? undefined : Number(values.target),
        pastStop: values["past-stop"],
      },
      opening,
    );
    const decided = decide(events, plan);
    console.log(
      `\n${made < most && !values["dry-run"] ? `move ${String(made + 1)}` : "next"} · ${decidedLine(decided)}`,
    );
    if (decided.move === "end") {
      if (!values["dry-run"]) ended(log, events, decided);
      return decided;
    }
    if (values["dry-run"] || made >= most) return decided;
    if (decided.move === "promote" && !values.unattended) {
      console.log(
        `a promotion is the operator's word: bun tools/d2/promote.ts --name ${name} --harness ${decided.harness} --yes, or run this command with --unattended`,
      );
      return decided;
    }
    let left: JsonObject;
    try {
      left = await make(decided, { events, plan, opening, values, seats });
    } catch (error) {
      // A move that began and threw is the environment's ending, and the campaign goes on from
      // its log when it is run again. One refused before it wrote anything leaves the log alone.
      if (read(log).length > events.length) {
        append(log, ENDED, { ending: "environment", why: errorMessage(error), move: decided.move });
      }
      throw error;
    }
    if (read(log).length === events.length) {
      throw new Error(`the move changed nothing in ${log}: made again it would change nothing again`);
    }
    append(log, "campaign.move", { move: decided.move, why: decided.why, ...left });
  }
}

if (import.meta.main) await harnessBuilder(Bun.argv.slice(2));
