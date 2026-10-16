/**
 * Whether a paid comparison may start: what the campaign's log holds for it (`supplyOf`), set
 * against what it asks for.
 *
 * One function owns each refusal a supply earns, by a code (`refusals`), and every reader asks it:
 * a round or a checkpoint before its first event (`admitComparison`), whether the campaign command
 * made it (`tools/d2/harness-builder.ts`) or a hand started it, so that no comparison started by
 * hand pays for its solves on a checker nobody has read; and move 7, whose rows read the codes and
 * hold no such rule of their own (`decide.ts`), since their answer to one is a move and no flag.
 *
 * - `no-held`: a log with no held-out task to score;
 * - `held-short`: fewer to score than a first reading takes at the trigger asked for (`sweepOf`);
 *   The frontier already leaves out every task the reference closed in its last comparison, so
 *   the share of the last comparison's tasks left untied, read since 8 October and mended six
 *   times, read 1 at 69 of 72 recorded starts by 16 October and refused none (`untied-short`):
 *   it went, as `docs/simplify.md` C1 had planned;
 * - `unread`: a checker `tools/c/accept.ts` has never read;
 * - `stopped`: a campaign the plan's stop rule has stopped, as many moves in a row as its patience
 *   that could have shown a gain and showed none (`stopRule`, `docs/plan.md`, row F48). The
 *   operator may go on past it by saying why (`--past-stop`), and the reason is logged.
 *
 * Two more are the command's, and are asked beside them: a start with no dollar cap, and a first
 * record of the campaign's setting other than the one the log's solves ran under (`unrecorded`,
 * `firstRecord` in `tools/d2/setting.ts`).
 *
 * A rehearsal is exempt from all of it, by name and here: its seats are scripts, which are paid
 * nothing, and it has to be able to walk any path a seed can be cut to. The refusals a comparison
 * makes of its own terms still hold it (`src/builder/round.ts`): a task that is no held-out task,
 * a practice task among the scored, a task that waits for a label.
 *
 * A Builder session run with no comparison after it (`tools/d2/session.ts`) is asked the same way
 * (`admitSession`), and is refused less: it scores nothing, so no held-out task is counted for it.
 * It needs its cap, a checker that has been read where it has practice to judge, since its
 * practice solves are judged by the same checks, and a campaign the stop rule has not stopped.
 *
 * What goes on unasked is what the log holds a start of, of its own kind: a comparison that began,
 * and a session that began. A start of the other kind exempts nothing, so a round started under
 * the id of a session that ran by itself is asked the whole check (row F42). A comparison stopped
 * after its start goes on under its id, and is not asked again (row F45).
 *
 * What only a host or an id can refuse is the command's: a comparison that reported says what it
 * said and ends, a session whose id was cut is refused (`spent`), and the campaign command waits
 * for the host's load before a move that solves (`quiet`).
 */
import { frozenChecker } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { type Cap, poolOf, stopRule } from "../kernel/reports.ts";
import { sizeLines } from "../kernel/size.ts";
import { taskSets } from "../kernel/task.ts";

/** What a log holds for the next comparison. */
export interface Supply {
  /** The held-out tasks a step may be read on (`frontier`, `poolOf`), those that wait for a person's label and are left
   *  out, those the reference harness answered in every solve of their last comparison and are left
   *  out (`poolOf`), and the tasks released for practice. */
  readonly held: number;
  readonly awaiting: number;
  readonly exhausted: number;
  readonly released: number;
  /** The faults of the checker's last reading (`tools/c/accept.ts`), null where the log holds no
   *  reading, and whether the operator has frozen the checker. */
  readonly faults: number | null;
  readonly frozen: boolean;
  /** The plan's stop rule over the comparisons on record. */
  readonly stop: ReturnType<typeof stopRule>;
}

/** What a comparison asks for. */
export interface Wanted {
  /** The tasks to score: `--target`, or as many as `--tasks` names. */
  readonly target: number;
  readonly solves: number;
  /** The level the step and its repeat together clear, and the one a first reading clears to buy
   *  the repeat (`readTwice`, `triggered`, `src/kernel/compare.ts`). */
  readonly level: number;
  readonly trigger: number;
  /** The campaign's patience, which a comparison's risk is said over (`sizeLines`). */
  readonly patience: number;
  /** Whether a Builder session runs before the comparison. */
  readonly builds: boolean;
  readonly cap: Cap | null;
  /** The operator's reason to go on past the stop rule, where one is given. */
  readonly pastStop?: string | undefined;
  /** Why the setting asked for may not be recorded as the campaign's first, where the caller found
   *  that the log's solves ran under another (`firstRecord`, `tools/d2/setting.ts`). */
  readonly unrecorded?: string | undefined;
}

/** What the supply's own refusals are read at: a comparison's size, and a reason to go on. */
type Sized = Pick<Wanted, "target" | "level" | "trigger" | "patience" | "pastStop">;

/** What a Builder session with no comparison after it asks for: its cap, and the practice solves
 *  its limits allow. */
interface WantedSession extends Pick<Wanted, "cap" | "pastStop" | "unrecorded"> {
  readonly practiceSolves?: number | undefined;
}

/** Who sits in the seats: models that are paid, or a rehearsal's scripts. */
type Seats = "paid" | "scripted";

/** A comparison a command is about to start. */
interface Starting {
  /** Its id: a round's session, or a checkpoint's own. */
  readonly id: string;
  readonly wanted: Wanted;
  readonly seats: Seats;
  /** The refusals the comparison makes of its own terms (`refuseTerms`, `round.ts`), which throw.
   *  They are asked after the admission's and before anything is written, so that a command
   *  refused on either leaves the log as it was. */
  readonly own: () => void;
}

/** What a start is decided on: the refusals, every one thrown at once, and what its reader should
 *  know where there is none. */
interface Admission {
  readonly refusals: readonly string[];
  readonly notes: readonly string[];
}

/** The command an Examiner session runs as: where a refusal sends its reader for more held-out
 *  tasks, and what a stop knows a running one by (`tools/runs/registry.ts`, `tools/runs/stop.ts`). */
export const EXAMINE = "tools/d1b/examine.ts";
const STARTED = "comparison.started";
// On 9 October a round on a checker nobody had read rejected 22 of 32 solves, 14 on one check,
// with nothing to say whose fault.
const UNREAD =
  "the campaign's checker has never been read: run tools/c/accept.ts, which puts every control and the do-nothing answer to the checks and says what each check has been seen to do";
const UNRELEASED = "no task is released: the Builder has nothing to practise on";
/** The texts of the rows that hold, in their order. */
const said = (rows: readonly (readonly [boolean, string])[]) =>
  rows.flatMap(([holds, text]) => (holds ? [text] : []));

/** A log's supply for the next comparison. */
export function supplyOf(events: readonly LogEvent[]): Supply {
  // The tasks that may be scored, and those left out as `scoredSet` leaves them out: the ones
  // waiting for a person's label, and the ones the reference closed in their last comparison.
  const { frontier, awaiting, exhausted } = poolOf(events);
  const reading = events.findLast(({ kind }) => kind === "checker.read")?.data.faults;
  return {
    held: frontier.length,
    awaiting: awaiting.length,
    exhausted: exhausted.length,
    released: taskSets(events).released.length,
    faults: Array.isArray(reading) ? reading.length : null,
    frozen: frozenChecker(events) !== null,
    stop: stopRule(events),
  };
}

/** The numbers a comparison's size is read from on a supply: the tasks it would score, and the
 *  fewest a step takes at its trigger. */
function sized(supply: Supply, wanted: Pick<Wanted, "target" | "trigger">) {
  const scored = Math.min(wanted.target, supply.held);
  // What a comparison's test can say at this size is arithmetic, and is known before a round pays
  // for it. A first reading that clears the trigger buys the repeat, so the fewest it takes is the
  // trigger's sweep.
  const least = sweepOf(wanted.trigger);
  return { scored, least };
}

/** What the plan's stop rule says of a start: the refusal where the campaign is stopped and no
 *  reason to go on is given, and the note where one is. */
function stopped({ stop }: Supply, pastStop: string | undefined) {
  const after = `${String(stop.sinceStep)} moves that could have shown a gain`;
  return {
    refuses: stop.stop && pastStop === undefined,
    why: `the campaign has had ${after} since its last step, and none did: its patience is spent (docs/plan.md, row F48; --patience). To go on all the same, pass --past-stop "<why>", which is logged`,
    notes: said([
      [
        stop.stop && pastStop !== undefined,
        `going on past the plan's stop rule, ${after} after the last step: ${String(pastStop)}`,
      ],
    ]),
  };
}

/**
 * Why a comparison of the size `wanted` names should not start on this supply: each refusal the
 * supply earns, by its code. A want of tasks is two of them, and move 7 answers either with a move:
 * write tasks (`decide.ts`).
 */
export function refusals(supply: Supply, wanted: Sized) {
  const { scored, least } = sized(supply, wanted);
  const [size = ""] = sizeLines(scored, wanted);
  const more = `Run an Examiner session (${EXAMINE}) for more held-out tasks`;
  const stop = stopped(supply, wanted.pastStop);
  const rows = [
    [
      "no-held",
      supply.held === 0,
      "the log holds no held-out task to score: run tools/d2/prepare.ts, which takes the pack's tasks in",
    ],
    [
      "held-short",
      supply.held > 0 && scored < least,
      `${size}. ${more}${wanted.target < least ? `, and ask for a --target of ${String(least)} or more` : ""}`,
    ],
    [
      "unread",
      supply.faults === null,
      `${UNREAD}. A comparison on an unread checker pays for rejections nobody can attribute`,
    ],
    ["stopped", stop.refuses, stop.why],
  ] as const;
  return rows.flatMap(([code, holds, why]) => (holds ? [{ code, why }] : []));
}

/** What both kinds of start are told of the checker: its last reading's faults nobody froze. */
function faulty(supply: Supply): readonly [boolean, string] {
  return [
    (supply.faults ?? 0) > 0 && !supply.frozen,
    `the checker's last reading holds ${String(supply.faults)} fault(s) and the operator has not frozen it: a rejection here may be the check's own (tools/c/accept.ts)`,
  ];
}

/** Whether a comparison should start on this supply: the command's two refusals, then the
 *  supply's, and what its reader should know when it does. */
function admission(supply: Supply, wanted: Wanted): Admission {
  const { scored, least } = sized(supply, wanted);
  const { cap, pastStop, unrecorded } = wanted;
  // The comparison's test alone: both harnesses, on every scored task.
  const test = 2 * scored * wanted.solves;
  const afforded = cap === null ? test : Math.floor(cap.dollars / cap.reserve);
  return {
    refusals: [
      ...said([
        [
          cap === null,
          "no --cap is named: a comparison is launched under a dollar cap, and one the cap cuts short reads not-scored",
        ],
        [unrecorded !== undefined, unrecorded ?? ""],
      ]),
      ...refusals(supply, wanted).map(({ why }) => why),
    ],
    notes: [
      `${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(scored)} to score`,
      ...(scored < least ? [] : sizeLines(scored, wanted)),
      ...said([
        [
          supply.awaiting > 0,
          `${String(supply.awaiting)} held-out task(s) wait for a person's label and are not scored (tools/d2/prepare.ts)`,
        ],
        [
          supply.exhausted > 0,
          `${String(supply.exhausted)} held-out task(s) were answered by the reference harness in every solve of their last comparison, with no objective telling two valid answers apart, and are not scored: they can only tie again or be lost`,
        ],
        [wanted.builds && supply.released === 0, UNRELEASED],
        faulty(supply),
        [
          cap !== null && afforded < test,
          `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} solves, and the comparison's test alone makes ${String(test)}${wanted.builds ? ", after a session whose spend the same cap holds" : ""}: it is cut short and reads not-scored unless its solves bill well under their reserve`,
        ],
      ]),
      ...stopped(supply, pastStop).notes,
    ],
  };
}

/** The same for a Builder session with no comparison after it: with nothing to practise on, no
 *  check judges anything of the session, and an unread checker refuses nothing. */
function sessionAdmission(supply: Supply, wanted: WantedSession): Admission {
  const { cap, pastStop, unrecorded, practiceSolves } = wanted;
  const afforded = cap === null ? null : Math.floor(cap.dollars / cap.reserve);
  const stop = stopped(supply, pastStop);
  return {
    refusals: said([
      [
        cap === null,
        "no --cap is named: a session is launched under a dollar cap, and no practice solve starts that a reserve for it would take past the cap",
      ],
      [unrecorded !== undefined, unrecorded ?? ""],
      [
        supply.released > 0 && supply.faults === null,
        `${UNREAD}. A practice solve is judged by the same checks, and a Builder builds on what they reject`,
      ],
      [stop.refuses, stop.why],
    ]),
    notes: [
      `${String(supply.released)} released for practice · no comparison follows this session: tools/d2/checkpoint.ts compares what the campaign's sessions leave`,
      ...said([
        [supply.released === 0, UNRELEASED],
        faulty(supply),
        [
          afforded !== null && practiceSolves !== undefined && afforded < practiceSolves,
          `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} practice solves, and the session's limit is ${String(practiceSolves)}: the Builder is told the fewer, which falls by less than one a solve while solves bill under their reserve`,
        ],
      ]),
      ...stop.notes,
    ],
  };
}

/** Whether the log holds the start `kind` under `id`: what was admitted when it began. */
function begun(events: readonly LogEvent[], id: string, kind: typeof STARTED | "build.started"): boolean {
  return events.some((event) => event.kind === kind && event.data.session === id);
}

/**
 * What both admissions do with a decision: a start the log already holds, of its own kind, goes
 * on, since it was admitted when it began; every refusal is thrown at once; the start's own terms
 * are asked; and where it goes on past the stop rule, the operator's reason is logged under its
 * id, once.
 */
function entered(
  log: string,
  start: { readonly id: string; readonly kind: Parameters<typeof begun>[2]; readonly own?: () => void },
  pastStop: string | undefined,
  decide: (supply: Supply) => Admission & { readonly supply: Supply },
): string[] {
  const events = read(log);
  const { id, kind, own } = start;
  if (begun(events, id, kind)) return [];
  const { supply, refusals: refused, notes } = decide(supplyOf(events));
  if (refused.length > 0) throw new Refused(refused.join("\n"));
  own?.();
  const overridden = events.some((event) => event.kind === "stop.overridden" && event.data.session === id);
  if (supply.stop.stop && pastStop !== undefined && !overridden) {
    const { checkpoints, sinceStep } = supply.stop;
    append(log, "stop.overridden", { session: id, reason: pastStop, checkpoints, sinceStep });
  }
  return [...notes];
}

/** The admission's refusal: the campaign's own state in counts and commands, which names no task,
 *  so a led Builder may read it (14 October). Every other error a command throws stays the host's. */
export class Refused extends Error {}

/**
 * Admit the comparison a command is about to start on the campaign whose log is `log`, and return
 * what its reader should know; throws every refusal at once where it may not start. One the log
 * already holds the start of goes on: it was admitted when it began. The start of a session under
 * its id admits no comparison. A rehearsal is admitted unasked, and its own terms still hold it.
 */
export function admitComparison(log: string, starting: Starting): string[] {
  const { id, wanted, seats, own } = starting;
  if (seats === "scripted") {
    if (!begun(read(log), id, STARTED)) own();
    return [];
  }
  return entered(log, { id, kind: STARTED, own }, wanted.pastStop, (supply) => ({
    supply,
    ...admission(supply, wanted),
  }));
}

/** The same for a Builder session with no comparison after it (`tools/d2/session.ts`). */
export function admitSession(
  log: string,
  { id, wanted, seats }: { readonly id: string; readonly wanted: WantedSession; readonly seats: Seats },
): string[] {
  if (seats === "scripted") return [];
  return entered(log, { id, kind: "build.started" }, wanted.pastStop, (supply) => ({
    supply,
    ...sessionAdmission(supply, wanted),
  }));
}
