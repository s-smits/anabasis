/**
 * Admission rules for paid comparisons and standalone Builder sessions, comparing the campaign
 * log's current supply (`supplyOf`) against the requirements of the requested move.
 *
 * A single function (`refusals`) owns every supply-based refusal under a structured code, and all
 * callers consult it: a round or standalone comparison calls `admitComparison` before writing its
 * first event (whether launched by the campaign loop or manually by the operator, preventing paid
 * solves on an unread checker), and the decision table (`decide.ts`) reads the refusal codes
 * without duplicating admission logic, responding with an appropriate move rather than a flag.
 *
 * Supply refusal codes:
 * - `no-held`: the log contains no held-out task available for scoring;
 * - `held-short`: fewer frontier tasks are available than a minimum sweep at the target
 *   significance level plus `MARGIN` (`comparisonFloor`), which reserves room for one set-aside
 *   task and one tie. Without this margin, setting aside a single task makes the significance level
 *   unreachable and wastes the comparison's solves;
 * - `unread`: the checker has never been evaluated by `tools/c/accept.ts`;
 * - `cap-short`: the remaining budget cap is below the expected cost of the comparison's test
 *   solves alone, priced at the mean billed cost of finished solves in the log. A comparison
 *   truncated by its cap reports `not-scored` and ends the campaign on budget, yielding no reading.
 *   When the log contains no finished solves, this check does not refuse, because the per-solve
 *   reserve is the only available rate and actual solves typically bill well below it;
 * - `stopped`: the improvement patience is exhausted because the maximum permitted number of
 *   consecutive eligible moves produced no step (`stopRule`). The operator may override this by
 *   supplying a logged reason (`--past-stop`).
 *
 * The command enforces one additional check: a launch must specify a dollar cap. A setting that
 * conflicts with the campaign's existing solves is refused when the command opens the campaign
 * (`campaignFor`, `tools/d2/round.ts`).
 *
 * Rehearsals are exempt from supply admission because their seats are unpaid scripts that must be
 * able to exercise any seeded path. Term-level refusals (`src/campaign/round.ts`) still apply to
 * rehearsals: a scored task must be held out, practice tasks cannot be scored, and tasks awaiting
 * human labels are excluded.
 *
 * A standalone Builder session (`tools/d2/session.ts`) uses the same admission mechanism
 * (`admitSession`) with narrower requirements: because it scores no held-out tasks, it checks only
 * the budget cap, a read checker when practice tasks are present (since the same checks evaluate
 * practice solves), and the stop rule.
 *
 * A start already recorded in the log of the same kind (a comparison or a session) proceeds without
 * re-checking admission. A round started under the identifier of a prior standalone session is
 * checked in full, whereas an interrupted comparison resumes under its own identifier without
 * re-checking.
 *
 * Host-level and identifier-specific refusals remain with the command: a comparison that has
 * already reported prints its reading and exits, and an interrupted session identifier is refused.
 * Each solve then waits in the solve queue for host load, budget reserve, and a shared concurrency
 * slot (`queued`, `tools/d2/host.ts`).
 */
import { frozenChecker } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { type Cap, INTERRUPTED, lastReports, patienceOf, poolOf, roomOf } from "../kernel/reports.ts";
import { ended, practiceRan, rejectionAside, solvesIn } from "../kernel/solves.ts";
import { sizeLines } from "../kernel/size.ts";
import { taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";

/** Current campaign supply available for the next comparison. */
export interface Supply {
  /** Counts of held-out tasks available for scoring (`frontier`, `poolOf`), tasks excluded while
   *  awaiting a human label, exhausted tasks answered validly by the reference in every solve of
   *  their last two comparisons (scored only as retained), and tasks released for practice. */
  readonly held: number;
  readonly awaiting: number;
  readonly exhausted: number;
  readonly released: number;
  /** Fault count from the most recent checker reading (`tools/c/accept.ts`), null if the checker
   *  has never been read, together with whether the operator has frozen the checker. */
  readonly faults: number | null;
  readonly frozen: boolean;
  /** Mean billed cost in dollars across finished solves in the log, or null if none carries a
   *  bill; used to price the comparison's test solves for `cap-short`. */
  readonly billed: number | null;
  /** Improvement patience state computed over the recorded comparisons (`stopRule`). */
  readonly stop: ReturnType<typeof stopRule>;
}

/** Parameters requested for a comparison. */
export interface Wanted {
  /** Target number of tasks to draw (`--target`). */
  readonly target: number;
  readonly solves: number;
  /** Significance level required for a step (`stepOf`, `src/kernel/compare.ts`). */
  readonly level: number;
  /** Whether a Builder session precedes the comparison. */
  readonly builds: boolean;
  readonly cap: Cap | null;
  /** Operator-supplied reason for overriding the stop rule, when provided. */
  readonly pastStop?: string | undefined;
}

/** Subset of comparison parameters inspected by supply refusals: size, budget cap, and any
 *  stop-rule override. */
type SizedWant = Pick<Wanted, "target" | "level" | "solves" | "cap" | "pastStop">;

/** Parameters requested for a standalone Builder session: its budget cap, any stop-rule override,
 *  and the maximum number of practice solves permitted by its limits. */
interface WantedSession extends Pick<Wanted, "cap" | "pastStop"> {
  readonly practiceSolves?: number | undefined;
}

/** Execution mode for seats: paid language models or scripted rehearsal stubs. */
type Seats = "paid" | "scripted";

/** Specification of a comparison about to be started by a command. */
interface Starting {
  /** Comparison identifier: either the enclosing round's session id or a standalone comparison id. */
  readonly id: string;
  readonly wanted: Wanted;
  readonly seats: Seats;
  /** Term-level validation (`refuseTerms`, `round.ts`), which throws on invalid terms. Runs after
   *  supply admission and before any log event is appended so a refused launch leaves the log
   *  unchanged. */
  readonly own: () => void;
}

/** Result of an admission check: all refusals (thrown together when non-empty) and informational
 *  notes surfaced to the caller when the start is admitted. */
interface Admission {
  readonly refusals: readonly string[];
  readonly notes: readonly string[];
}

/** Command path for an Examiner session, referenced in refusal messages for held-out task
 *  shortfalls and used to recognise running sessions (`tools/runs/registry.ts`, `tools/runs/stop.ts`). */
export const EXAMINE = "tools/d1b/examine.ts";
/** Extra frontier tasks required above the minimum sweep to absorb one set-aside task and one tie. */
const MARGIN = 2;
const STARTED = "comparison.started";
// Running a comparison against an unread checker risks unattributable rejections across solves.
const UNREAD =
  "the campaign's checker has never been read: run tools/c/accept.ts, which puts every control and the do-nothing answer to the checks and says what each check has been seen to do";
const UNRELEASED = "no task is released: the Builder has nothing to practise on";
/** Return the messages from rows whose predicate holds, preserving order. */
const holding = (rows: readonly (readonly [boolean, string])[]) =>
  rows.flatMap(([holds, text]) => (holds ? [text] : []));

/** Mean billed cost in dollars across finished solves, or null when no solve carries a bill; used
 *  by admission to estimate the cost of a comparison's test solves. */
export function billedRate(solves: ReturnType<typeof ended>): number | null {
  const bills = solves.flatMap(({ end }) => (isNumber(end.billed) ? [end.billed] : []));
  return bills.length === 0 ? null : bills.reduce((sum, bill) => sum + bill, 0) / bills.length;
}

/** Fold a campaign log into the current supply for the next comparison. */
export function supplyOf(events: readonly LogEvent[]): Supply {
  // Partition held-out tasks into the scorable frontier, tasks awaiting a human label (excluded by
  // `scoredSet`), and exhausted tasks scored only as retained.
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
 * Evaluate the improvement stop rule over a campaign log: count how many eligible moves could have
 * demonstrated a gain, how many have occurred since the last step in the current epoch, and whether
 * that count reaches the campaign's improvement patience (`patienceOf`).
 *
 * Two kinds of move count towards patience:
 * 1. A candidate harness modified by a Builder session and compared against a reference, where the
 *    comparison tallied at least one task and either left room (`roomOf`) or read a step. Each
 *    `(candidate, reference)` pair counts once (at its first report) and counts as a gain if any
 *    of its comparisons read a step; repeated readings of the same harness do not count multiple
 *    times. The count resets on each promotion, so patience applies per epoch.
 * 2. A completed Builder session that left its harness unchanged despite observing at least one
 *    failed practice solve: the Builder saw a failure and declined to modify the harness. A session
 *    whose practice solves all passed, or that ran none, had no failure signal to act on and is
 *    excluded as a supply limitation rather than domain evidence.
 *
 * Excluded moves: comparisons between harnesses not produced by a Builder session (starter
 * comparisons and A/A controls); comparisons halted by check defects, truncated by budget, or with
 * all tasks set aside (which tested nothing); and comparisons that left no room (which require new
 * tasks rather than a new harness). Comparisons are counted regardless of their setting identifier,
 * since moving a worktree to a new commit changes the setting id.
 *
 * Practice failures left unresolved by the Referee are set aside, matching comparison semantics,
 * rather than counted as failures the Builder ignored.
 */
export function stopRule(events: readonly LogEvent[]) {
  const failed = practiceRan(events).filter(
    (solve) => solve.ending?.outcome === "fail" && !rejectionAside(events, solve),
  );
  const wholeSession = ({ kind, data }: LogEvent, harness: "changed" | "unchanged") =>
    kind === "build.finished" && data.changed === (harness === "changed") && !INTERRUPTED.has(data.ended);
  // Harnesses modified by a completed session or frozen as a checkpoint during a live session.
  const builtHarnesses = new Set(
    events.flatMap((event) =>
      event.kind === "build.checkpoint" || wholeSession(event, "changed") ? [event.data.harness] : [],
    ),
  );
  // Completed sessions that left the harness unchanged after observing a practice failure.
  const declined = events.flatMap((each, index) => {
    if (!wholeSession(each, "unchanged")) return [];
    const from = events.findLastIndex(
      (began, at) => at < index && began.kind === "build.started" && began.data.session === each.data.session,
    );
    // Failures before the current epoch belong to the superseded reference harness.
    const epoch = events.findLastIndex((one, at) => at < index && one.kind === "harness.promoted");
    return failed.some(({ started }) => started > Math.max(from, epoch) && started < index)
      ? [{ index, step: false }]
      : [];
  });
  // Track each (candidate, reference) pair: its first report index, whether any reading produced a
  // step, and whether it counts towards patience (a step, or room at any of its readings).
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
  // Each promotion opens a new epoch with a fresh patience counter.
  const epochAt = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const epoch = moves.filter(({ index }) => index > epochAt);
  const sinceStep = epoch.length - 1 - epoch.findLastIndex(({ step }) => step);
  return { checkpoints: moves.length, sinceStep, stop: sinceStep >= patienceOf(events) };
}

/** Minimum frontier size required to launch a paid comparison and preserved by practice releases. */
export function comparisonFloor(level: number): number {
  return sweepOf(level) + MARGIN;
}

/** Effective comparison size on the current supply: tasks to score, admission floor at the target
 *  significance level, and total test solves across both harnesses. */
function sizeOf(supply: Supply, wanted: Pick<Wanted, "target" | "level" | "solves">) {
  const scored = Math.min(wanted.target, supply.held);
  // Require the margin before paying for solves that may tie or be set aside.
  const floor = comparisonFloor(wanted.level);
  // Count test solves across both sides for every scored task.
  return { scored, floor, test: 2 * scored * wanted.solves };
}

/** Evaluate the stop rule for a launch: refuse when patience is exhausted without an override, or
 *  return an informational note when `--past-stop` is supplied. */
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
 * Compute all supply-based refusals for a comparison of size `wanted`, each paired with its code.
 * Task-shortfall codes (`no-held`, `held-short`) are read by the decision table (`decide.ts`) to
 * trigger task generation.
 */
export function refusals(supply: Supply, wanted: SizedWant) {
  const { scored, floor, test } = sizeOf(supply, wanted);
  const { cap } = wanted;
  const [size = ""] = sizeLines(scored, wanted.level);
  // Estimate the test cost from the mean billed cost of finished solves. Retries and retained tasks
  // only increase spend, so a cap below this estimate will truncate the comparison.
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

/** Shared checker warning surfaced when the latest reading reported unfrozen faults. */
function faultNote(supply: Supply): readonly [boolean, string] {
  return [
    (supply.faults ?? 0) > 0 && !supply.frozen,
    `the checker's last reading holds ${String(supply.faults)} fault(s) and the operator has not frozen it: a rejection here may be the check's own (tools/c/accept.ts)`,
  ];
}

/** Compute admission refusals and informational notes for a comparison against the current supply. */
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

/** Compute admission refusals and notes for a standalone Builder session. When no practice tasks
 *  are released, no check evaluates the session's work, so an unread checker does not refuse. */
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

/** Return whether the log already records a start of `kind` under `id`, which was admitted when it began. */
function alreadyStarted(
  events: readonly LogEvent[],
  id: string,
  kind: typeof STARTED | "build.started",
): boolean {
  return events.some((event) => event.kind === kind && event.data.session === id);
}

/**
 * Shared admission runner for comparisons and standalone sessions. A start of the same kind already
 * present in the log proceeds immediately; otherwise all refusals are thrown together, term-level
 * validation runs, and any stop-rule override is logged once under `id`.
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

/** Structured admission refusal. Its message reports only campaign-level counts and commands without
 *  naming any task, so it is safe to surface to a Builder; all other errors remain internal to the
 *  host. */
export class Refused extends Error {}

/**
 * Admit a comparison about to start on `log` and return any informational notes, or throw all
 * refusals together via `Refused`. A comparison already started in the log proceeds without
 * re-checking; a prior session start under the same id does not admit a comparison. Scripted
 * rehearsals bypass supply admission while still enforcing term-level validation.
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

/** Admit a standalone Builder session (`tools/d2/session.ts`), bypassing checks for scripted rehearsals. */
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
