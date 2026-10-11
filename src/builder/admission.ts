/**
 * Whether a paid comparison may start: what the campaign's log holds for it, set against what it
 * asks for.
 *
 * One function decides it, and every way of starting a comparison asks that function: a round or
 * a checkpoint asks before its first event (`admitComparison`), whether the campaign command made
 * it (`tools/d2/harness-builder.ts`) or a hand started it. Until 2026-10-09 the launcher
 * (`bun run runs launch`) alone held these refusals, and a round started directly on a checker
 * nobody had read went on to pay for its solves; the launcher went on 2026-10-11, once the
 * campaign command was the one way a move is started (`docs/simplify.md`, D2).
 *
 * What is refused:
 *
 * - a log with no held-out task, or with fewer to score than a step takes at the level asked for;
 * - a comparison that would leave fewer untied tasks than a step takes. The untied tasks are
 *   the ones the harness this comparison is made against did not answer in every solve of the
 *   campaign's last comparison: after buffer's first step that harness was valid in every solve
 *   on 8 of 11 tasks. A task held out since counts whole;
 * - a comparison with no dollar cap;
 * - a checker `tools/c/accept.ts` has never read;
 * - a campaign the plan's stop rule has stopped: three moves in a row that could have shown a
 *   gain and showed none (`stopRule`, `docs/plan.md`, row F48). The operator may go on past it by saying why
 *   (`--past-stop`), and the reason is logged. Until 2026-10-09 four commands printed the rule's
 *   reading and none acted on it;
 * - a first record of the campaign's setting that is another than the log's solves ran under,
 *   unless the operator says it is new (`unrecorded`).
 *
 * A rehearsal is exempt from all of it, by name and here: its seats are scripts, which are paid
 * nothing, and it has to be able to walk any path a seed can be cut to. The refusals a comparison
 * makes of its own terms still hold it (`src/builder/round.ts`): a task that is no held-out task,
 * a practice task among the scored, a task that waits for a label.
 *
 * A Builder session run with no comparison after it (`tools/d2/session.ts`) is asked the same way
 * (`admitSession`), and is refused less: it scores nothing, so no held-out task is counted for it.
 * It needs its cap, a checker that has been read, since its practice solves are judged by the same
 * checks, and a campaign the stop rule has not stopped.
 *
 * What goes on unasked is what the log holds a start of, of its own kind (`begun`): a comparison
 * that began, and a session that began. Until 2026-10-09 either start exempted both, so a round
 * started by hand under the id of a session that had run by itself compared with no check at all,
 * on an unread checker and past the stop rule (the third review, row F42). A comparison stopped
 * after its start goes on under its id, where the launcher had once asked it the whole check a
 * second time (row F45).
 *
 * What only a host or an id can refuse is the command's: a comparison that reported says what it
 * said and ends, a session whose id was cut is refused (`spent`), and the campaign command waits
 * for the host's load before a move that solves (`quiet`).
 */
import { frozenChecker } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import {
  awaitingLabel,
  type Cap,
  exhausted,
  lastReports,
  latestBuilt,
  promoted,
  stopRule,
} from "../kernel/reports.ts";
import { sizeLines } from "../kernel/size.ts";
import { taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";

/** What a log holds for the next comparison. */
export interface Supply {
  /** The held-out tasks that may be scored, those that wait for a person's label and are left
   *  out, those the reference harness answered in every solve of two comparisons and are left
   *  out (`exhausted`), and the tasks released for practice. */
  readonly held: number;
  readonly awaiting: number;
  readonly exhausted: number;
  readonly released: number;
  /** The share of its tallied tasks the last comparison left for the next to untie, against the
   *  harness the next is made with; null before any such comparison. */
  readonly untied: number | null;
  /** The tasks held out since that comparison tallied. */
  readonly since: number;
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
   *  the repeat (`src/builder/move.ts`, `readTwice`, `triggered`). */
  readonly level: number;
  readonly trigger: number;
  /** Whether a Builder session runs before the comparison. */
  readonly builds: boolean;
  readonly cap: Cap | null;
  /** The operator's reason to go on past the stop rule, where one is given. */
  readonly pastStop?: string | undefined;
  /** Why the setting asked for may not be recorded as the campaign's first, where the caller found
   *  that the log's solves ran under another (`firstRecord`, `tools/d2/setting.ts`). */
  readonly unrecorded?: string | undefined;
}

/** What a Builder session with no comparison after it asks for. */
type WantedSession = Pick<Wanted, "cap" | "pastStop" | "unrecorded">;

/** A comparison a command is about to start. */
interface Starting {
  /** Its id: a round's session, or a checkpoint's own. */
  readonly id: string;
  /** The harness it is made against, as `--reference` names it. */
  readonly reference: string;
  /** The harness it reads, by digest, where the command knows it (`--new`): the untied share is
   *  then taken from the last comparison of these two and from no other pair's. */
  readonly fresh?: string | undefined;
  readonly wanted: Wanted;
  /** Who sits in the seats: models that are paid, or a rehearsal's scripts. */
  readonly seats: "paid" | "scripted";
  /** The refusals the comparison makes of its own terms (`refuseTerms`, `round.ts`), which throw.
   *  They are asked after the admission's and before anything is written, so that a command
   *  refused on either leaves the log as it was (the third review, row F44). */
  readonly own: () => void;
}

/** What a session's start is asked beside it: the practice solves its limits allow. */
interface WantedPractice extends WantedSession {
  readonly practiceSolves?: number | undefined;
}

/** A session a command is about to start with no comparison after it. */
interface StartingSession {
  readonly id: string;
  readonly wanted: WantedPractice;
  readonly seats: "paid" | "scripted";
}

/** The command an Examiner session runs as: where a refusal sends its reader for more held-out
 *  tasks, and what a stop knows a running one by (`tools/runs/pulse.ts`, `tools/runs/stop.ts`). */
export const EXAMINE = "tools/d1b/examine.ts";
const STARTED = "comparison.started";
// The reading was a step done late and by hand in the first live rounds (2026-10-09), and on
// truss 22 of 32 solves were then rejected, 14 on one check, with nothing to say whose fault.
const UNREAD =
  "the campaign's checker has never been read: run tools/c/accept.ts, which puts every control and the do-nothing answer to the checks and says what each check has been seen to do";
const said = (rows: readonly (readonly [boolean, string])[]) =>
  rows.flatMap(([holds, text]) => (holds ? [text] : []));

/** A log's supply for a comparison made against the harness `reference` names: `starter`,
 *  `promoted` for the campaign's reference harness, `latest`, or a digest. The untied share is
 *  the last tallied comparison's; until 2026-10-11 it was the last one's under the setting id of
 *  the log's last test-side solves, which names the host's code too, and a tree moved to a new
 *  commit read no share (`docs/simplify.md`, A4). `fresh`, a digest, is the harness the
 *  comparison reads where the command knows it: the share is then the last comparison's of these
 *  two, since a tie share is of a pair. On t-4 (10 October) a control of the promoted harness's
 *  programs against the starter tied 7 of 8 tasks, 6 of them answered by neither, and the next
 *  command, the whole harness against those programs, was refused on that share, which said
 *  nothing of a harness that answers every task. */
export function supplyOf(events: readonly LogEvent[], reference = "promoted", fresh?: string): Supply {
  const sets = taskSets(events);
  // Left out of the scored set as `scoredSet` leaves them out: the tasks waiting for a person's
  // label, and the ones both harnesses answered in every solve of two comparisons.
  const labelled = awaitingLabel(events).filter((version) => sets.held.includes(version));
  const spent = exhausted(events).filter(
    (version) => sets.held.includes(version) && !labelled.includes(version),
  );
  const waiting = [...labelled, ...spent];
  const reports = lastReports(events);
  const starter = reports.findLast(({ data }) => isString(data.starter))?.data.starter;
  // A task the harness to be compared with was valid on in every solve there can only tie again.
  const kept = reference === "promoted" ? (promoted(events) ?? "starter") : reference;
  const named = kept === "latest" ? latestBuilt(events) : kept === "starter" ? starter : kept;
  const ofPair = (data: JsonObject) =>
    fresh === undefined ||
    (data.old === named && data.fresh === fresh) ||
    (data.old === fresh && data.fresh === named);
  const last = reports.findLast(
    ({ data }) =>
      Array.isArray(data.versions) &&
      data.versions.length > 0 &&
      asRecord(data.scored) !== null &&
      ofPair(data),
  )?.data;
  const tally = asRecord(last?.scored);
  const versions = Array.isArray(last?.versions) ? last.versions : [];
  const side = last?.old === named ? "old" : "fresh";
  const full = last?.[side] === named ? asRecord(last?.valid)?.[side] : null;
  const closed = Array.isArray(full) && isNumber(full.at(-1)) ? Number(full.at(-1)) : 0;
  const reading = events.findLast(({ kind }) => kind === "checker.read")?.data.faults;
  return {
    held: sets.held.length - waiting.length,
    awaiting: labelled.length,
    exhausted: spent.length,
    released: sets.released.length,
    // The tasks the reference harness did not answer in every solve: those a changed harness can
    // still win. Until 10 October no more were counted than the last comparison untied, and a
    // simulated climb then wrote tasks the reference failed, read 0 untied where nobody answered
    // them yet, and asked for tasks again in place of a Builder session.
    untied: tally !== null && versions.length > 0 ? (versions.length - closed) / versions.length : null,
    since: sets.held.filter((version) => ![...versions, ...waiting].includes(version)).length,
    faults: Array.isArray(reading) ? reading.length : null,
    frozen: frozenChecker(events) !== null,
    stop: stopRule(events),
  };
}

/** What the plan's stop rule says of a start: the refusal where the campaign is stopped and no
 *  reason to go on is given, and the note where one is. */
function stopped({ stop }: Supply, pastStop: string | undefined) {
  const after = `${String(stop.sinceStep)} moves that could have shown a gain`;
  return {
    refusals: said([
      [
        stop.stop && pastStop === undefined,
        `the campaign has had ${after} since its last step, and none did: its patience is spent (docs/plan.md, row F48; --patience). To go on all the same, pass --past-stop "<why>", which is logged`,
      ],
    ]),
    notes: said([
      [
        stop.stop && pastStop !== undefined,
        `going on past the plan's stop rule, ${after} after the last step: ${String(pastStop)}`,
      ],
    ]),
  };
}

/** The numbers a comparison's size is read from on a supply: the tasks it would score, the fewest
 *  a step takes at its level, the share its last comparison left untied, and the untied tasks that
 *  share leaves it. */
function sized(supply: Supply, wanted: Pick<Wanted, "target" | "trigger">) {
  const scored = Math.min(wanted.target, supply.held);
  // What a comparison's test can say at this size is arithmetic, and rehearsals found it before a
  // round paid to (2026-10-08): exam-1 held one task to score. A first reading that clears the
  // trigger buys the repeat, so the fewest it takes is the trigger's sweep (10 October).
  const least = sweepOf(wanted.trigger);
  const share = supply.untied ?? 1;
  // A task held out since that comparison has no share on record, and is counted whole.
  const untied = scored * (share + ((1 - share) * supply.since) / Math.max(1, supply.held));
  return { scored, least, share, untied };
}

/**
 * What a comparison on this supply is short of, where its tasks are what it is short of: held-out
 * tasks to read a step on, or tasks its last comparison left to untie; null where it is short of
 * neither. Both are refusals of `admission`, and this is how move 7 tells them from the others,
 * since their answer is a move and no flag: write tasks, or set the budget again (`decide.ts`).
 */
export function shortOf(
  supply: Supply,
  wanted: Pick<Wanted, "target" | "trigger">,
): "held" | "untied" | null {
  const { scored, least, untied } = sized(supply, wanted);
  if (scored < least) return "held";
  return untied < least ? "untied" : null;
}

/** Why a comparison should not start on this supply, and what its reader should know when it does. */
export function admission(supply: Supply, wanted: Wanted) {
  const { scored, least, share, untied } = sized(supply, wanted);
  const [size = "", ...power] = sizeLines(scored, wanted);
  // The comparison's test alone: both harnesses, on every scored task.
  const test = 2 * scored * wanted.solves;
  const { cap, pastStop } = wanted;
  const afforded = cap === null ? test : Math.floor(cap.dollars / cap.reserve);
  const more = `Run an Examiner session (${EXAMINE}) for more held-out tasks`;
  const asked = said([
    [
      supply.held === 0,
      "the log holds no held-out task to score: run tools/d2/prepare.ts, which takes the pack's tasks in",
    ],
    [
      supply.held > 0 && scored < least,
      `${size}. ${more}${wanted.target < least ? `, and ask for a --target of ${String(least)} or more` : ""}`,
    ],
    [
      scored >= least && untied < least,
      `the campaign's last comparison left ${String(Math.round(100 * share))}% of its tasks for this one to untie: the rest tied there, or this one's reference harness was valid on them in every solve. At that share ${String(scored)} scored tasks${supply.since > 0 ? `, the ${String(supply.since)} held out since counted whole,` : ""} leave about ${untied.toFixed(1)} untied, where at --trigger ${String(wanted.trigger)} a first reading takes ${String(least)}, all won: this comparison could hardly buy a repeat. ${more}, or change the budget so that fewer tasks tie`,
    ],
    [
      cap === null,
      "no --cap is named: a comparison is launched under a dollar cap, and one the cap cuts short reads not-scored",
    ],
    [
      supply.held > 0 && supply.faults === null,
      `${UNREAD}. A comparison on an unread checker pays for rejections nobody can attribute`,
    ],
    [wanted.unrecorded !== undefined, wanted.unrecorded ?? ""],
  ]);
  const refusals = [...asked, ...stopped(supply, pastStop).refusals];
  const notes = [
    `${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(scored)} to score`,
    ...(scored < least ? [] : [size, ...power]),
    ...said([
      [
        supply.awaiting > 0,
        `${String(supply.awaiting)} held-out task(s) wait for a person's label and are not scored (tools/d2/prepare.ts)`,
      ],
      [
        supply.exhausted > 0,
        `${String(supply.exhausted)} held-out task(s) were answered by the reference harness in every solve of two comparisons, with no objective telling two valid answers apart, and are not scored: they can only tie again or be lost`,
      ],
      [wanted.builds && supply.released === 0, "no task is released: the Builder has nothing to practise on"],
      [
        (supply.faults ?? 0) > 0 && !supply.frozen,
        `the checker's last reading holds ${String(supply.faults)} fault(s) and the operator has not frozen it: a rejection here may be the check's own (tools/c/accept.ts)`,
      ],
      [
        cap !== null && afforded < test,
        `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} solves, and the comparison's test alone makes ${String(test)}${wanted.builds ? ", after a session whose spend the same cap holds" : ""}: it is cut short and reads not-scored unless its solves bill well under their reserve`,
      ],
    ]),
    ...stopped(supply, pastStop).notes,
  ];
  return { refusals, notes };
}

/** Why a Builder session with no comparison after it should not start on this supply, and what its
 *  reader should know when it does. */
export function sessionAdmission(supply: Supply, wanted: WantedPractice) {
  const { cap, pastStop, practiceSolves } = wanted;
  const afforded = cap === null ? null : Math.floor(cap.dollars / cap.reserve);
  const asked = said([
    [
      cap === null,
      "no --cap is named: a session is launched under a dollar cap, and no practice solve starts that a reserve for it would take past the cap",
    ],
    [
      supply.released > 0 && supply.faults === null,
      `${UNREAD}. A practice solve is judged by the same checks, and a Builder builds on what they reject`,
    ],
    [wanted.unrecorded !== undefined, wanted.unrecorded ?? ""],
  ]);
  const refusals = [...asked, ...stopped(supply, pastStop).refusals];
  const notes = [
    `${String(supply.released)} released for practice · no comparison follows this session: tools/d2/checkpoint.ts compares what the campaign's sessions leave`,
    ...said([
      [supply.released === 0, "no task is released: the Builder has nothing to practise on"],
      [
        (supply.faults ?? 0) > 0 && !supply.frozen,
        `the checker's last reading holds ${String(supply.faults)} fault(s) and the operator has not frozen it: a rejection here may be the check's own (tools/c/accept.ts)`,
      ],
      [
        afforded !== null && practiceSolves !== undefined && afforded < practiceSolves,
        `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} practice solves, and the session's limit is ${String(practiceSolves)}: the Builder is told the fewer, which falls by less than one a solve while solves bill under their reserve`,
      ],
    ]),
    ...stopped(supply, pastStop).notes,
  ];
  return { refusals, notes };
}

/** Whether the log holds the start of the comparison, or of the Builder session, that `id` names:
 *  what was admitted when it began, and goes on unasked. */
export function begun(
  events: readonly LogEvent[],
  id: string,
  start: "comparison.started" | "build.started",
): boolean {
  return events.some(({ kind, data }) => kind === start && data.session === id);
}

/**
 * What both admissions do with a decision: one the log already holds a start of, of its own kind,
 * goes on, since it was admitted when it began; every refusal is thrown at once; and where the
 * start goes on past the stop rule, the operator's reason is logged under its id, once.
 */
function entered(
  log: string,
  {
    id,
    pastStop,
    start,
    own,
  }: {
    readonly id: string;
    readonly pastStop: string | undefined;
    readonly start: Parameters<typeof begun>[2];
    readonly own?: (() => void) | undefined;
  },
  decide: (events: readonly LogEvent[]) => {
    readonly supply: Supply;
    readonly refusals: readonly string[];
    readonly notes: string[];
  },
): string[] {
  const events = read(log);
  if (begun(events, id, start)) return [];
  const { supply, refusals, notes } = decide(events);
  if (refusals.length > 0) throw new Error(refusals.join("\n"));
  own?.();
  const overridden = events.some(({ kind, data }) => kind === "stop.overridden" && data.session === id);
  if (supply.stop.stop && pastStop !== undefined && !overridden) {
    const { checkpoints, sinceStep } = supply.stop;
    append(log, "stop.overridden", { session: id, reason: pastStop, checkpoints, sinceStep });
  }
  return notes;
}

/**
 * Admit the comparison a command is about to start on the campaign whose log is `log`, and return
 * what its reader should know; throws every refusal at once where it may not start. One the log
 * already holds the start of goes on: it was admitted when it began. The start of a session under
 * its id admits no comparison. A rehearsal is admitted unasked. Where the comparison goes on past the stop rule, the operator's
 * reason is logged under its id, once.
 */
export function admitComparison(
  log: string,
  { id, reference, fresh, wanted, seats, own }: Starting,
): string[] {
  if (seats === "scripted") {
    if (!begun(read(log), id, STARTED)) own();
    return [];
  }
  return entered(log, { id, pastStop: wanted.pastStop, start: STARTED, own }, (events) => {
    const supply = supplyOf(events, reference, fresh);
    return { supply, ...admission(supply, wanted) };
  });
}

/** The same for a Builder session with no comparison after it (`tools/d2/session.ts`). */
export function admitSession(log: string, { id, wanted, seats }: StartingSession): string[] {
  if (seats === "scripted") return [];
  return entered(log, { id, pastStop: wanted.pastStop, start: "build.started" }, (events) => {
    const supply = supplyOf(events);
    return { supply, ...sessionAdmission(supply, wanted) };
  });
}
