/**
 * Whether a paid comparison may start: what the campaign's log holds for it (`supplyOf`), set
 * against what it asks for.
 *
 * One function owns every refusal the supply can earn, each under a code (`refusals`), and every
 * reader asks it: a round or a standalone comparison before its first event (`admitComparison`),
 * whether the campaign command started it or a person did by hand, so that no comparison pays for
 * solves on a checker nobody has read; and the decision table, whose rows read the codes and keep
 * no rule of their own (`decide.ts`), since its answer to a refusal is a move rather than a flag.
 *
 * - `no-held`: the log holds no held-out task to score;
 * - `held-short`: fewer tasks to score than a sweep at the level plus `MARGIN`, which leaves room
 *   for one task set aside and one tie (`comparisonFloor`). Without the margin, a comparison that
 *   sets one task aside can no longer reach the level, and its solves buy no reading;
 * - `unread`: a checker `tools/c/accept.ts` has never read;
 * - `cap-short`: a cap below what the comparison's test alone costs at the mean bill of the log's
 *   finished solves. A comparison its cap cuts short reads `not-scored` and ends the campaign on
 *   its budget, so its solves buy nothing. A log with no finished solve refuses nothing here: the
 *   reserve is then the only rate, and solves bill well under it;
 * - `stopped`: the improvement patience has run out, since as many moves in a row as it allows
 *   could have shown a gain and none did (`stopRule`). The operator may go on by giving a reason
 *   (`--past-stop`), which is logged.
 *
 * The command asks one more beside them: a start with no dollar cap. A setting other than the one
 * the log's solves ran under is refused as the command opens the campaign (`campaignFor`,
 * `tools/d2/round.ts`).
 *
 * A rehearsal is exempt from all of this, here and by name: its seats are unpaid scripts, and it
 * has to be able to walk any path a seed can be cut to. The refusals a comparison makes of its own
 * terms still hold it (`src/campaign/round.ts`): a scored task that is not held out, a practice
 * task among the scored, a task still waiting for a label.
 *
 * A Builder session with no comparison after it (`tools/d2/session.ts`) is asked the same way
 * (`admitSession`), with fewer refusals: it scores nothing, so no held-out task is counted for it.
 * It needs its cap, a read checker where it has practice to judge (the same checks judge practice
 * solves), and a campaign the stop rule has not stopped.
 *
 * A start the log already holds goes on unasked, but only one of the same kind: a comparison that
 * began, or a session that began. A round started under the id of a session that ran alone is
 * asked everything, and a comparison interrupted after its start resumes under its id without
 * being asked again.
 *
 * What only the host or an id can refuse belongs to the command: a comparison that has reported
 * prints its reading and ends, and a session whose id was interrupted is refused. Each solve then
 * waits in the solve queue for the host's load, the budget's reserve and a shared slot (`queued`,
 * `tools/d2/host.ts`).
 */
import { frozenChecker } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { type Cap, INTERRUPTED, lastReports, patienceOf, poolOf, roomOf } from "../kernel/reports.ts";
import { ended, practiceRan, rejectionAside, solvesIn } from "../kernel/solves.ts";
import { sizeLines } from "../kernel/size.ts";
import { taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";

/** What a log holds for the next comparison. */
export interface Supply {
  /** The held-out tasks a step may be read on (`frontier`, `poolOf`); those waiting for a person's
   *  label, which are left out; those the reference answered in every solve of their last two
   *  comparisons, which are scored only as retained; and the tasks released for practice. */
  readonly held: number;
  readonly awaiting: number;
  readonly exhausted: number;
  readonly released: number;
  /** The fault count of the checker's last reading (`tools/c/accept.ts`), null where the log holds
   *  no reading, and whether the operator has frozen the checker. */
  readonly faults: number | null;
  readonly frozen: boolean;
  /** The mean dollars the log's finished solves billed, null where none carries a bill: the rate
   *  a comparison's test is priced at (`cap-short`). */
  readonly billed: number | null;
  /** The improvement patience over the comparisons on record (`stopRule`). */
  readonly stop: ReturnType<typeof stopRule>;
}

/** What a comparison asks for. */
export interface Wanted {
  /** The tasks to draw: `--target`. */
  readonly target: number;
  readonly solves: number;
  /** The level a step must clear (`stepOf`, `src/kernel/compare.ts`). */
  readonly level: number;
  /** Whether a Builder session runs before the comparison. */
  readonly builds: boolean;
  readonly cap: Cap | null;
  /** The operator's reason to go on past the stop rule, where one is given. */
  readonly pastStop?: string | undefined;
}

/** The part of a want the supply's refusals read: the comparison's size, its cap and any reason
 *  to go on past the stop rule. */
type SizedWant = Pick<Wanted, "target" | "level" | "solves" | "cap" | "pastStop">;

/** What a Builder session with no comparison after it asks for: its cap, and the practice solves
 *  its limits allow. */
interface WantedSession extends Pick<Wanted, "cap" | "pastStop"> {
  readonly practiceSolves?: number | undefined;
}

/** Who sits in the seats: paid models, or a rehearsal's scripts. */
type Seats = "paid" | "scripted";

/** A comparison a command is about to start. */
interface Starting {
  /** Its id: a round's session, or a standalone comparison's own. */
  readonly id: string;
  readonly wanted: Wanted;
  readonly seats: Seats;
  /** The refusals the comparison makes of its own terms (`refuseTerms`, `round.ts`), which throw.
   *  They run after admission's and before anything is written, so a command refused by either
   *  leaves the log as it was. */
  readonly own: () => void;
}

/** What a start is decided on: every refusal, all thrown together, and the notes its reader gets
 *  where there is none. */
interface Admission {
  readonly refusals: readonly string[];
  readonly notes: readonly string[];
}

/** The command an Examiner session runs as: where a refusal sends its reader for more held-out
 *  tasks, and how a stop recognises a running session (`tools/runs/registry.ts`, `tools/runs/stop.ts`). */
export const EXAMINE = "tools/d1b/examine.ts";
/** Room for one task set aside and one tie, kept before paying for a comparison. */
const MARGIN = 2;
const STARTED = "comparison.started";
// A round on a checker nobody had read once rejected 22 of 32 solves, 14 on one check, with no way
// to say whose fault each rejection was.
const UNREAD =
  "the campaign's checker has never been read: run tools/c/accept.ts, which puts every control and the do-nothing answer to the checks and says what each check has been seen to do";
const UNRELEASED = "no task is released: the Builder has nothing to practise on";
/** The texts of the rows whose condition holds, in order. */
const holding = (rows: readonly (readonly [boolean, string])[]) =>
  rows.flatMap(([holds, text]) => (holds ? [text] : []));

/** The mean dollars the finished solves `solves` billed, null where none carries a bill: the rate
 *  admission prices a comparison's test at. */
export function billedRate(solves: ReturnType<typeof ended>): number | null {
  const bills = solves.flatMap(({ end }) => (isNumber(end.billed) ? [end.billed] : []));
  return bills.length === 0 ? null : bills.reduce((sum, bill) => sum + bill, 0) / bills.length;
}

/** A log's supply for the next comparison. */
export function supplyOf(events: readonly LogEvent[]): Supply {
  // The frontier a step is read on, the tasks waiting for a person's label (which `scoredSet`
  // leaves out), and those the reference closed, which are scored only as retained.
  const { frontier, awaiting, exhausted } = poolOf(events);
  const reading = events.findLast(({ kind }) => kind === "checker.read")?.data.faults;
  return {
    held: frontier.length,
    awaiting: awaiting.length,
    exhausted: exhausted.length,
    released: taskSets(events).released.length,
    faults: Array.isArray(reading) ? reading.length : null,
    frozen: frozenChecker(events) !== null,
    billed: billedRate(ended(solvesIn(events))),
    stop: stopRule(events),
  };
}

/**
 * The stop rule over a log: how many moves could have shown a gain, how many of those have passed
 * since the last step, and whether that reaches the campaign's improvement patience (`patienceOf`).
 *
 * Two kinds of move count. The first is a harness a Builder session changed, compared with one
 * reference, where the comparison tallied a task and either left room (`roomOf`) or read a step.
 * Each such pair counts once, where it first reported, and shows a gain if any of its comparisons
 * read a step (which promotes it): three readings of one harness are still one harness. The count
 * covers the epoch, the moves since the last promotion, so a step restarts it.
 *
 * The second is a whole session that left its harness unchanged although one of its practice solves
 * failed: it was shown a failure and declined to act on it. A session whose practice solves all
 * passed, or that ran none, had nothing to work on; that is a fault of the supply, not evidence
 * about the domain, so it does not count.
 *
 * What does not count: a comparison between two harnesses no session made (a starter comparison
 * or an A/A control); one stopped on its check defects, cut by its cap, or with every task set
 * aside, which tested nothing; and one that left no room, whose answer is other tasks, not another
 * harness. Every comparison on record is read whatever setting id it carries, since the id names
 * the host's code and moving a tree to a new commit changes it.
 *
 * A practice failure the Referee left unresolved is set aside, as a comparison would set it aside,
 * rather than read as a failure the Builder declined.
 */
export function stopRule(events: readonly LogEvent[]) {
  const failed = practiceRan(events).filter(
    (solve) => solve.ending?.outcome === "fail" && !rejectionAside(events, solve),
  );
  const wholeSession = ({ kind, data }: LogEvent, harness: "changed" | "unchanged") =>
    kind === "build.finished" && data.changed === (harness === "changed") && !INTERRUPTED.has(data.ended);
  // The harnesses a whole session changed, or a live one froze as a checkpoint.
  const builtHarnesses = new Set(
    events.flatMap((event) =>
      event.kind === "build.checkpoint" || wholeSession(event, "changed") ? [event.data.harness] : [],
    ),
  );
  // The whole sessions that left their harness unchanged after one of their practice solves failed.
  const declined = events.flatMap((each, index) => {
    if (!wholeSession(each, "unchanged")) return [];
    const from = events.findLastIndex(
      (began, at) => at < index && began.kind === "build.started" && began.data.session === each.data.session,
    );
    // A failure before the epoch the session finished in belongs to the reference it replaced.
    const epoch = events.findLastIndex((one, at) => at < index && one.kind === "harness.promoted");
    return failed.some(({ started }) => started > Math.max(from, epoch) && started < index)
      ? [{ index, step: false }]
      : [];
  });
  // Each pair of a harness and a reference: where it first reported, whether any of its
  // comparisons read a step, and whether it counts (a step, or room at any of its readings).
  const pairs = new Map<string, { index: number; step: boolean; counts: boolean }>();
  for (const { index, data } of lastReports(events)) {
    const { old, fresh, versions } = data;
    const tallied = asRecord(data.scored) !== null && Array.isArray(versions) && versions.length > 0;
    if (!tallied || !isString(fresh) || !builtHarnesses.has(fresh)) continue;
    const pair = `${fresh} ${isString(old) ? old : ""}`;
    const earlier = pairs.get(pair);
    const step = earlier?.step === true || data.reading === "step";
    const counts = earlier?.counts === true || step || roomOf(data) === "room";
    pairs.set(pair, { index: earlier?.index ?? index, step, counts });
  }
  const moves = [...pairs.values().filter(({ counts }) => counts), ...declined].toSorted(
    (one, other) => one.index - other.index,
  );
  // A promotion starts an epoch, which has its own improvement patience.
  const epochAt = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const epoch = moves.filter(({ index }) => index > epochAt);
  const sinceStep = epoch.length - 1 - epoch.findLastIndex(({ step }) => step);
  return { checkpoints: moves.length, sinceStep, stop: sinceStep >= patienceOf(events) };
}

/** The smallest frontier a paid comparison may start on, which practice releases also leave held. */
export function comparisonFloor(level: number): number {
  return sweepOf(level) + MARGIN;
}

/** A comparison's size on a supply: the tasks it would score, the admission floor at its level,
 *  and the solves of its test. */
function sizeOf(supply: Supply, wanted: Pick<Wanted, "target" | "level" | "solves">) {
  const scored = Math.min(wanted.target, supply.held);
  // Keep the margin before a round pays for solves that may tie or be set aside.
  const floor = comparisonFloor(wanted.level);
  // The comparison's test alone: both harnesses, on every scored task.
  return { scored, floor, test: 2 * scored * wanted.solves };
}

/** What the stop rule says of a start: a refusal where the campaign is stopped and no reason to go
 *  on is given, and a note where one is. */
function stopVerdict({ stop }: Supply, pastStop: string | undefined) {
  const after = `${String(stop.sinceStep)} moves that could have shown a gain`;
  return {
    refuses: stop.stop && pastStop === undefined,
    why: `the campaign has had ${after} since its last step, and none did: its patience is spent (--patience). To go on all the same, pass --past-stop "<why>", which is logged`,
    notes: holding([
      [
        stop.stop && pastStop !== undefined,
        `going on past the plan's stop rule, ${after} after the last step: ${String(pastStop)}`,
      ],
    ]),
  };
}

/**
 * Why a comparison of the size `wanted` names should not start on this supply: each refusal the
 * supply earns, with its code. Two of them are a want of tasks, which the decision table answers
 * with a move: write tasks (`decide.ts`).
 */
export function refusals(supply: Supply, wanted: SizedWant) {
  const { scored, floor, test } = sizeOf(supply, wanted);
  const { cap } = wanted;
  const [size = ""] = sizeLines(scored, wanted.level);
  // What the test costs if its solves bill as the log's have. Retries and retained tasks only add
  // to it, so a cap below it is cut short whatever the comparison meets.
  const price = supply.billed === null ? null : test * supply.billed;
  const askForMore = `An Examiner session writes more held-out tasks (examine, or ${EXAMINE} by hand)`;
  const stop = stopVerdict(supply, wanted.pastStop);
  const rows = [
    [
      "no-held",
      supply.held === 0,
      "the log holds no held-out task to score: an Examiner session writes them (examine), or tools/d2/prepare.ts takes a pack's tasks in",
    ],
    [
      "held-short",
      supply.held > 0 && scored < floor,
      `${size}. A paid comparison needs at least ${String(floor)} frontier tasks, leaving room for one set-aside task and one tie. ${askForMore}${wanted.target < floor ? `. The --target of ${String(wanted.target)} is below ${String(floor)}` : ""}`,
    ],
    [
      "unread",
      supply.faults === null,
      `${UNREAD}. A comparison on an unread checker pays for rejections nobody can attribute`,
    ],
    [
      "cap-short",
      cap !== null && price !== null && cap.dollars < price,
      `the cap of $${String(cap?.dollars.toFixed(2))} is below the $${String(price?.toFixed(2))} the comparison's test alone costs, ${String(test)} solves at what this campaign's finished solves billed each: it would be cut short and read not-scored`,
    ],
    ["stopped", stop.refuses, stop.why],
  ] as const;
  return rows.flatMap(([code, holds, why]) => (holds ? [{ code, why }] : []));
}

/** The checker note both kinds of start get: faults in its last reading that nobody froze. */
function faultNote(supply: Supply): readonly [boolean, string] {
  return [
    (supply.faults ?? 0) > 0 && !supply.frozen,
    `the checker's last reading holds ${String(supply.faults)} fault(s) and the operator has not frozen it: a rejection here may be the check's own (tools/c/accept.ts)`,
  ];
}

/** Whether a comparison should start on this supply: the command's refusal, then the supply's,
 *  and the notes its reader gets when it does. */
function comparisonAdmission(supply: Supply, wanted: Wanted): Admission {
  const { scored, floor, test } = sizeOf(supply, wanted);
  const { cap, pastStop } = wanted;
  const afforded = cap === null ? test : Math.floor(cap.dollars / cap.reserve);
  return {
    refusals: [
      ...holding([
        [
          cap === null,
          "no --cap is named: a comparison is launched under a dollar cap, and one the cap cuts short reads not-scored",
        ],
      ]),
      ...refusals(supply, wanted).map(({ why }) => why),
    ],
    notes: [
      `${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(scored)} to score`,
      ...(scored < floor ? [] : sizeLines(scored, wanted.level)),
      ...holding([
        [
          supply.awaiting > 0,
          `${String(supply.awaiting)} held-out task(s) wait for a person's label and are not scored (tools/d2/prepare.ts)`,
        ],
        [
          supply.exhausted > 0,
          `${String(supply.exhausted)} held-out task(s) were answered by the reference harness in every solve of their last two comparisons, with no objective telling two valid answers apart, and are scored only as retained tasks: they can only tie again or be lost`,
        ],
        [wanted.builds && supply.released === 0, UNRELEASED],
        faultNote(supply),
        [
          cap !== null && afforded < test,
          `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} solves, and the comparison's test alone makes ${String(test)}${wanted.builds ? ", after a session whose spend the same cap holds" : ""}: it is cut short and reads not-scored unless its solves bill well under their reserve`,
        ],
      ]),
      ...stopVerdict(supply, pastStop).notes,
    ],
  };
}

/** The same for a Builder session with no comparison after it. With nothing to practise on, no
 *  check judges anything the session does, so an unread checker refuses nothing. */
function sessionAdmission(supply: Supply, wanted: WantedSession): Admission {
  const { cap, pastStop, practiceSolves } = wanted;
  const afforded = cap === null ? null : Math.floor(cap.dollars / cap.reserve);
  const stop = stopVerdict(supply, pastStop);
  return {
    refusals: holding([
      [
        cap === null,
        "no --cap is named: a session is launched under a dollar cap, and no practice solve starts that a reserve for it would take past the cap",
      ],
      [
        supply.released > 0 && supply.faults === null,
        `${UNREAD}. A practice solve is judged by the same checks, and a Builder builds on what they reject`,
      ],
      [stop.refuses, stop.why],
    ]),
    notes: [
      `${String(supply.released)} released for practice · no comparison follows this session: tools/d2/checkpoint.ts compares what the campaign's sessions leave`,
      ...holding([
        [supply.released === 0, UNRELEASED],
        faultNote(supply),
        [
          afforded !== null && practiceSolves !== undefined && afforded < practiceSolves,
          `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} practice solves, and the session's limit is ${String(practiceSolves)}: the Builder is told the fewer, which falls by less than one a solve while solves bill under their reserve`,
        ],
      ]),
      ...stop.notes,
    ],
  };
}

/** Whether the log already holds a start of `kind` under `id`, which was admitted when it began. */
function alreadyStarted(
  events: readonly LogEvent[],
  id: string,
  kind: typeof STARTED | "build.started",
): boolean {
  return events.some((event) => event.kind === kind && event.data.session === id);
}

/**
 * What both admissions do with a decision. A start the log already holds, of the same kind, goes
 * on, since it was admitted when it began; otherwise every refusal is thrown together, the start's
 * own terms are asked, and where it goes on past the stop rule the operator's reason is logged
 * under its id, once.
 */
function admitStart(
  log: string,
  start: {
    readonly id: string;
    readonly kind: Parameters<typeof alreadyStarted>[2];
    readonly own?: () => void;
  },
  pastStop: string | undefined,
  decide: (supply: Supply) => Admission & { readonly supply: Supply },
): string[] {
  const events = read(log);
  const { id, kind, own } = start;
  if (alreadyStarted(events, id, kind)) return [];
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

/** Admission's refusal. It states the campaign's own state in counts and commands and names no
 *  task, so a led Builder may read it; every other error a command throws stays the host's. */
export class Refused extends Error {}

/**
 * Admit the comparison a command is about to start on the campaign whose log is `log`, and return
 * the notes its reader should get; throw every refusal together where it may not start. A
 * comparison whose start the log already holds goes on, since it was admitted then; a session's
 * start under the same id admits no comparison. A rehearsal is admitted unasked, though its own
 * terms still hold it.
 */
export function admitComparison(log: string, starting: Starting): string[] {
  const { id, wanted, seats, own } = starting;
  if (seats === "scripted") {
    if (!alreadyStarted(read(log), id, STARTED)) own();
    return [];
  }
  return admitStart(log, { id, kind: STARTED, own }, wanted.pastStop, (supply) => ({
    supply,
    ...comparisonAdmission(supply, wanted),
  }));
}

/** The same for a Builder session with no comparison after it (`tools/d2/session.ts`). */
export function admitSession(
  log: string,
  { id, wanted, seats }: { readonly id: string; readonly wanted: WantedSession; readonly seats: Seats },
): string[] {
  if (seats === "scripted") return [];
  return admitStart(log, { id, kind: "build.started" }, wanted.pastStop, (supply) => ({
    supply,
    ...sessionAdmission(supply, wanted),
  }));
}
