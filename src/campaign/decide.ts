/**
 * The campaign's decision table: given the log and the campaign's plan, the one move that comes
 * next, with its reason, or an ending.
 *
 * A campaign is a loop of moves over one log: the exam is read, tasks are written, a Builder
 * builds, two harnesses are compared, and then something has to say what comes next. This table
 * chooses which move; what a harness holds, what a task asks and how it is solved stay a model's.
 *
 * `ROWS` is asked in order over one reading of the log (`groundOf`, `ground.ts`), and the first row
 * that names a move chooses it. Comparison admission owns its refusals (`refusals`,
 * `admission.ts`); the rows only read their codes.
 *
 * A Builder that leads its campaign makes its own moves and is never told the table's, so the table
 * gives it no advice: practice is released by the host as each conversation opens and each
 * comparison reports (`releaseOwed`), and a Builder that compares too early hears admission's
 * refusal itself. A Builder that was given the table's advice went against it in most comparisons.
 *
 * One count ends a campaign that cannot be given tasks or room (`fruitlessRun`), at its supply
 * patience. A setting is recorded once (`campaign.setting`) and never changes, so every comparison
 * in the log is read at the one budget it names.
 */
import { unadmitted } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { INTERRUPTED, poolOf, roomOf } from "../kernel/reports.ts";
import { taskSets } from "../kernel/task.ts";
import { isNumber, isString } from "../meta/json-shape.ts";
import { draftOf } from "../examiner/draft.ts";
import { plural } from "../meta/text.ts";
import { comparisonFloor } from "./admission.ts";
import { epochsOf, tasksByEpoch } from "./climb.ts";
import { crashedRun, cutShort, groundOf, heldOut, type Plan, sessionEnded } from "./ground.ts";
import { type Decided, type Ending, short } from "./move.ts";
import { pendingWords } from "./word.ts";

const PROMOTED = "harness.promoted";

type Ground = ReturnType<typeof groundOf>;
/** A move as a row names it, before the row's code is attached. */
type Move<Each = Decided> = Each extends unknown ? Omit<Each, "code"> : never;
/** A comparison of the ground's that reported. */
type Reading = Ground["reports"][number];

/** The table. A row returns its move where it applies, and null to pass to the next row. */
const ROWS: readonly {
  readonly code: string;
  readonly move: (ground: Ground) => (Move & { readonly code?: string }) | null;
}[] = [
  // The operator's stop, or the operator's cap of promotions reached, ends the campaign whatever
  // else the log holds.
  { code: "stop", move: stop },
  // The exam is not settled: it is drafted, read, or the campaign ends on it. This comes before the
  // bounds because reading the exam bills nothing; a draft does bill, so it checks the bounds first.
  { code: "exam", move: exam },
  // A bound is spent: the budget, the provider, the improvement patience, or a comparison cut short.
  // Under a spent budget a step already read is promoted first, since a promotion bills nothing and
  // the comparison that earned it, or a session writing beside it, may be what spent the budget.
  {
    code: "bound",
    move: (ground) => {
      const ended = bound(ground);
      const owed = ended?.move === "end" && ended.ending === "budget" ? owedPromotion(ground) : null;
      return owed === null ? ended : { ...owed, code: "step" };
    },
  },
  // The tasks are not ready: taken in, released, written on the operator's word, or written up to
  // what a first comparison and its practice need, before the first session is paid for.
  { code: "tasks", move: tasks },
  // A comparison that began carries on.
  { code: "unfinished", move: unfinished },
  // A step against the reference promotes.
  { code: "step", move: owedPromotion },
  // The reference's last reading left it nothing to gain: the tasks change.
  { code: "no-room", move: noRoom },
  // Tasks held out since the last reading are compared before a Builder session is paid for, where
  // admission would take the comparison: the starter comparison a promotion owes, or a waiting
  // harness whose last reading left no room.
  { code: "unread", move: unread },
  // Nothing new to read, or too few tasks to read it on: the Builder builds and asks the Examiner
  // itself. Short of tasks at the supply patience, the campaign ends on its exam.
  {
    code: "build",
    move: (ground) => {
      const { read } = ground;
      // Examiner sessions that held out nothing count like readings that left nothing to gain.
      if (wantsTasks(ground)) {
        return (
          outOfPatience(ground, "tasks", WANTS_TASKS) ?? {
            move: "build",
            why: `${WANTS_TASKS}: ${BUILDS_AND_ASKS}`,
          }
        );
      }
      return read?.report.reading === "not-scored"
        ? { move: "build", why: `comparison ${read.id} tallied no task: ${BUILDS_AND_ASKS}` }
        : { move: "build", why: buildsOn(ground) };
    },
  },
];

/** How many drafts of an exam are allowed before the campaign ends on it. */
const DRAFTS = 3;
/** How many Builder or Examiner sessions in a row the provider may fail before the campaign ends on
 *  its environment: enough not to give up on a passing fault, few enough not to keep paying a dead
 *  provider for session after session. */
export const CRASHES_IN_A_ROW = DRAFTS;
/** The admission refusals that mean too few held-out tasks (`refusals`, `admission.ts`). */
const SHORT_OF_TASKS = ["no-held", "held-short"] as const;
const WANTS_TASKS = "comparison admission refuses the next comparison for want of tasks";
const BUILDS_AND_ASKS = "the Builder builds, and asks for tasks";
/** The most tasks one Examiner ask after a promotion may be short of (`shortBy`); the next ask
 *  takes the rest. Asks of 30 drew proposals of 12 or 13. */
const MOST_ASKED_AFTER_PROMOTION = 16;
/** Whether comparison admission would refuse the next comparison for want of tasks. */
const wantsTasks = ({ refused }: Ground): boolean => SHORT_OF_TASKS.some((code) => refused.has(code));

const end = (ending: Ending, why: string): Move => ({ move: "end", ending, why });
/** A comparison of the latest harness, or of the starter (a starter comparison), with the reference. */
const compare = (why: string, fresh = "latest"): Move => ({
  move: "compare",
  fresh,
  reference: "promoted",
  why,
});

/** The move that follows from the log, with the code of the row that chose it. */
export function decide(events: readonly LogEvent[], plan: Plan): Decided {
  const ground = groundOf(events, plan);
  for (const row of ROWS) {
    const named = row.move(ground);
    if (named === null) continue;
    return { ...named, code: named.code ?? row.code };
  }
  throw new Error("the decision table's last row names a move for every log");
}

/**
 * Why the table would not promote `harness` now, or null where it would: a harness is promoted on
 * a comparison that read a step against the reference (`readStep`). The operator's promotion
 * command asks this for the harness it names (`tools/d2/promote.ts`).
 */
export function unpromoted(events: readonly LogEvent[], plan: Plan, harness: string): string | null {
  return readStep(groundOf(events, plan), harness)
    ? null
    : `harness ${short(harness)} has no comparison that read a step against the reference harness`;
}

/** How many tasks held out after log index `after` are still held out; a task released since
 *  does not count, since a draw can no longer take it. */
function heldOutAfter(events: readonly LogEvent[], after: number): number {
  const held = new Set(taskSets(events).held);
  return tasksByEpoch(events.slice(after + 1))
    .flat()
    .filter((version) => held.has(version)).length;
}

/**
 * Whether enough tasks have been held out since `reading` to compare them before asking for
 * another Examiner session. Enough means as many new tasks as could clear the level on their own
 * (`sweepOf`); fewer would pay for a whole comparison mostly on tasks the reference has closed.
 */
function enoughWrittenSince(ground: Ground, reading: Reading): boolean {
  const { events, plan } = ground;
  // Count from when the reading began, since an Examiner session writes beside a comparison and its
  // draw did not take those tasks (`scoredSet`, `round.ts`). A session writing while a step waits
  // for promotion aims at the old reference, so only tasks held after the promotion count.
  const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
  const since = heldOutAfter(events, Math.max(reading.at, promotedAt));
  return since >= sweepOf(plan.wanted.level) && !wantsTasks(ground);
}

/**
 * The trailing run of readings that left nothing to gain. A reading here is either a comparison
 * against the reference that left it no room, or an Examiner session that ended whole and held out
 * no task. The run is broken by a comparison that left room, by one made against another harness
 * (so by every comparison before a promotion), and by a session whose tasks no comparison has read
 * yet, however few it wrote. A session that ended before the latest reported comparison started,
 * so that comparison could draw its tasks, is passed over, as is one the provider failed or a stop
 * cut (`crashedRun`, `cutShort`).
 *
 * This is the one count that ends a campaign for want of tasks or of room (`outOfPatience`).
 */
function fruitlessRun({ events, reports, reference }: Ground) {
  const read = Math.max(-1, ...reports.map(({ at }) => at));
  const compared = reports.map(({ id, old, report, reported }) => ({
    at: reported,
    id,
    gain: old !== reference || roomOf(report) === "room",
  }));
  const examined = events.flatMap((event, at) => {
    if (event.kind !== "exam.finished") return [];
    const wrote = heldOut(event.data);
    const passed = wrote ? at < read : cutShort(event);
    return passed ? [] : [{ at, id: null, gain: wrote }];
  });
  const readings = [...compared, ...examined].toSorted((one, other) => one.at - other.at);
  return readings.slice(readings.findLastIndex(({ gain }) => gain) + 1);
}

/** The supply attempts in a run, leaving out a comparison that opens it: that comparison raised
 *  the want and is no attempt to answer it. */
function attemptsIn(run: ReturnType<typeof fruitlessRun>): number {
  return run.length - (run[0]?.id == null ? 0 : 1);
}

/** Consecutive supply attempts, counted as `outOfPatience` counts them. */
export function supplyRun(events: readonly LogEvent[], plan: Plan): number {
  return attemptsIn(fruitlessRun(groundOf(events, plan)));
}

/**
 * The campaign's ending once its supply patience of fruitless readings is used up, or null while
 * patience is left: `exam` where it wants tasks that could not be written, `no-room` where the
 * tasks it has leave the reference nothing to gain. A comparison on the pack's own tasks therefore
 * ends nothing before the Examiner has been asked. `why` is the reason the next Examiner session
 * would have been given.
 */
function outOfPatience(ground: Ground, wants: "tasks" | "room", why: string): Move | null {
  const run = fruitlessRun(ground);
  if (attemptsIn(run) < ground.plan.patience) return null;
  const ids = run.flatMap(({ id }) => (id === null ? [] : [id]));
  const idle = plural(run.length - ids.length, "Examiner session");
  const summary =
    ids.length === 0
      ? `${idle} in a row held out no task`
      : `${plural(run.length, "reading")} in a row left nothing to gain: ${ids.length === 1 ? "comparison" : "comparisons"} ${ids.join(", ")} left the reference no room${ids.length === run.length ? "" : ` and ${idle} held out no task`}`;
  return wants === "tasks"
    ? end("exam", `${summary} (${why}): the tasks could not be written`)
    : end("no-room", `${summary} (${why}): the tasks could not be made to leave room`);
}

/** An Examiner session for `why`, or the campaign's ending where its supply patience is used up. */
function examine(ground: Ground, wants: "tasks" | "room", why: string): Move {
  return outOfPatience(ground, wants, why) ?? { move: "examine", why };
}

function stop({ events, plan }: Ground): Move | null {
  const words = pendingWords(events);
  const stopped = words.find(({ word }) => word === "stop");
  if (stopped === undefined) {
    const promoted = events.filter(({ kind }) => kind === PROMOTED).length;
    return plan.promotions === null || promoted < plan.promotions
      ? null
      : {
          move: "end",
          ending: "operator",
          why: `the operator's cap of ${plural(plan.promotions, "promotion")}`,
        };
  }
  return {
    move: "end",
    ending: "operator",
    why: `the operator's word${stopped.why === "" ? "" : `: ${stopped.why}`}`,
    // The stop answers every word left before it, since the campaign has stopped.
    answers: words.filter(({ at }) => at <= stopped.at).map(({ at }) => at),
  };
}

function exam(ground: Ground): Move | null {
  const { events, plan, supply, refused } = ground;
  if (plan.prompted && draftOf(events) === null) return bound(ground) ?? drafting(events);
  if (refused.has("unread")) {
    return {
      move: "accept",
      why: "nobody has read the campaign's checker: every control and the do-nothing answer are put to the checks before a solve is paid for",
    };
  }
  const faults = supply.faults ?? 0;
  if (faults === 0 || supply.frozen) return null;
  // A check decided by its author's own computation stands only on the operator's word, by name.
  // Where this command admits a check the last reading did not, the exam is read again with it.
  const admittedBefore = events.findLast(({ kind }) => kind === "checker.read")?.data.admitted;
  const newlyAdmitted = plan.admits.filter(
    (id) => !(Array.isArray(admittedBefore) && admittedBefore.includes(id)),
  );
  if (newlyAdmitted.length > 0) {
    return { move: "accept", why: `the operator admits ${newlyAdmitted.join(", ")}: the exam is read again` };
  }
  // Name the checks no installed engine decides, so that a log of an unattended campaign says what
  // the operator's word is needed for (in a drafted exam, every check).
  const undecided = unadmitted(events);
  return end(
    "exam",
    `the checker's last reading holds ${plural(faults, "fault")} and nobody froze it: the exam is not accepted until its author repairs it, or the operator admits each check by name and freezes (tools/c/accept.ts)${undecided.length === 0 ? "" : `. No engine the host installed decides ${undecided.join(", ")}, so each stands on the operator's word alone: --admit ${undecided.join(",")}`}`,
  );
}

/** The first move of a campaign opened from a prompt with no exam yet: a draft, while fewer than
 *  `DRAFTS` have been put. The bounds are checked first (`bound`), as before any billed move, so a
 *  run of crashed sessions ends the campaign on its environment and a budget below one solve's
 *  reserve ends it on its budget, instead of drafts that cannot run ending it on its exam. Drafts
 *  are counted over the whole log. */
function drafting(events: readonly LogEvent[]): Move {
  const draftsPut = ({ tries }: LogEvent["data"]) => (isNumber(tries) ? tries : 0);
  const sessions = events.filter(
    ({ kind, data }) => kind === "draft.finished" && (!INTERRUPTED.has(data.ended) || draftsPut(data) > 0),
  );
  const tries = sessions.reduce((sum, { data }) => sum + draftsPut(data), 0);
  if (tries < DRAFTS && sessions.length < DRAFTS) {
    return {
      move: "draft",
      why:
        tries === 0
          ? "the campaign opened from a prompt and holds no exam: the Examiner drafts its rules, its checks and its first tasks"
          : `${plural(tries, "draft")} did not stand at the host's reading, and ${String(DRAFTS - tries)} more may be put`,
    };
  }
  return end(
    "exam",
    `the exam was not accepted: ${plural(tries, "draft")} in ${plural(sessions.length, "session")} did not stand at the host's reading`,
  );
}

function bound(ground: Ground): Move | null {
  const { events, plan, refused, supply, read, all } = ground;
  const { left } = plan;
  if (left !== null && left.dollars < left.reserve) {
    return end(
      "budget",
      `$${left.dollars.toFixed(2)} of the campaign's budget are left, and one solve is held at $${String(left.reserve)}`,
    );
  }
  // A failing provider ends the campaign on its environment, which says nothing about the exam or
  // the room: the campaign carries on from its log once its command is run again. It is checked
  // after the budget, so a campaign out of both is not told to run again.
  const crashes = crashedRun(events);
  if (crashes.count >= CRASHES_IN_A_ROW) {
    return end(
      "environment",
      `${plural(crashes.count, "session")} in a row crashed (${crashes.crash ?? "the provider gave no reason"}): none held out a task or changed a harness. Run the command again by the campaign's name once the provider is back`,
    );
  }
  if (refused.has("stopped")) {
    return end(
      "stop",
      `${plural(supply.stop.sinceStep, "move")} in a row could have shown a gain and showed none: the campaign's patience is ${String(plan.patience)}`,
    );
  }
  if (read?.report.reading === "check-defects") {
    return end(
      "exam",
      `comparison ${read.id} stopped on its check defects: the check program needs its author before more is spent`,
    );
  }
  if (read?.report.reading === "not-scored" && read.report.capped === true) {
    return end("budget", `comparison ${read.id} was cut by its dollar cap before it tallied a task`);
  }
  // A comparison that began carries on under the cap it was admitted at; the next one is not paid
  // for where what is left cannot cover its test, since it would be cut the same way.
  return refused.has("cap-short") && all.every(({ report }) => report !== null)
    ? end(
        "budget",
        `$${left?.dollars.toFixed(2) ?? ""} of the campaign's budget are left, below what the next comparison's test costs at what its finished solves billed each`,
      )
    : null;
}

function tasks(ground: Ground): Move | null {
  const { events, plan, supply, all, waiting } = ground;
  if (plan.unprepared) {
    return {
      move: "prepare",
      why: "the pack holds tasks the log does not: each is put to its gate and held out",
    };
  }
  if (supply.held + supply.awaiting + supply.exhausted + supply.released === 0) {
    return examine(ground, "tasks", "the campaign holds no task");
  }
  // A campaign that names no practice is released none.
  if (supply.released === 0 && supply.held >= 2 && plan.practice !== 0) {
    return { move: "prepare", why: "no task is released for practice: the contract's draw releases some" };
  }
  // Other tasks on the operator's word, once there is an exam to write them against. A waiting step
  // is promoted first, so the Examiner writes for the new reference rather than the old.
  const asked = pendingWords(events).find(({ word }) => word === "tasks");
  if (asked !== undefined && owedPromotion(ground) === null) {
    return {
      move: "examine",
      why: `the operator asked for other tasks${asked.why === "" ? "" : `: ${asked.why}`}`,
      answers: [asked.at],
    };
  }
  // Before its first comparison a campaign needs the admission floor plus the practice still to be
  // released, and no more: holding out for the full target kept campaigns examining for hours
  // without ever comparing.
  const missing = all.length > 0 ? 0 : shortBy(ground);
  if (missing === 0) return null;
  const notYetCompared =
    waiting === null
      ? "no comparison has run yet"
      : `harness ${short(waiting)} has not been compared under the campaign's setting`;
  return examine(
    ground,
    "tasks",
    `the campaign is ${plural(missing, "held-out task")} short of the tasks a first comparison needs and the practice its release draws, and ${notYetCompared}: the Examiner writes more first`,
  );
}

/**
 * How many tasks the next Examiner session is asked for, or 0 where the campaign is short of none
 * (the command then asks for its default of 12). The shortfall (`shortBy`) is raised to at least a
 * sweep (`sweepOf`, the fewest new tasks a comparison waits for after a reading with no room,
 * `enoughWrittenSince`) plus the practice a reading releases, since otherwise the release takes
 * most of the new tasks and the next comparison is left with almost none of them.
 */
export function tasksToAskFor(events: readonly LogEvent[], plan: Plan): number {
  const count = shortBy(groundOf(events, plan));
  return count === 0 ? 0 : Math.max(count, sweepOf(plan.wanted.level) + (plan.practice ?? 0));
}

/** How many held-out tasks the campaign is short of: the admission floor (or, after its first
 *  comparison, its target where that is larger) plus the practice still to be released, less what
 *  it holds. */
function shortBy({ plan, supply, all, events }: Ground): number {
  // Each reference is owed practice of its own (`practiceDue`), on top of its frontier, since every
  // task held before its promotion is retained. Counting the whole campaign's releases let a new
  // reference's practice eat its comparison floor.
  const promoted = events.findLastIndex(({ kind }) => kind === PROMOTED);
  const released = events.filter(
    ({ kind, data }, at) => at > promoted && kind === "task.state" && data.state === "released",
  ).length;
  const practice = Math.max(0, (plan.practice ?? 0) - (promoted === -1 ? supply.released : released));
  const target = all.length === 0 ? 0 : plan.wanted.target;
  const owed = Math.max(0, practice + Math.max(target, comparisonFloor(plan.wanted.level)) - supply.held);
  return promoted === -1 ? owed : Math.min(owed, MOST_ASKED_AFTER_PROMOTION);
}

function unfinished({ all }: Ground): Move | null {
  const open = all.find(({ report }) => report === null);
  return open === undefined
    ? null
    : {
        move: "compare",
        id: open.id,
        fresh: open.fresh,
        reference: open.old,
        why: `comparison ${open.id} began and has not reported: it goes on from its log`,
      };
}

/** Whether `harness` read a step against the reference (`stepOf`, `compare.ts`). A starter
 *  comparison names no candidate: a starter win on new tasks shows room, not something to
 *  promote. */
function readStep({ reports, reference, starter }: Ground, harness: string): boolean {
  return (
    harness !== reference &&
    harness !== starter &&
    reports.some(
      ({ fresh, old, report }) => fresh === harness && old === reference && report.reading === "step",
    )
  );
}

/**
 * The promotion of the waiting harness, or of an earlier one that read a step while later sessions
 * left another harness. Since the table follows the latest harness, it would otherwise pass such a
 * step by and promote nothing. The newest such harness is promoted, and what later sessions left
 * is read against it once it is the reference.
 */
function owedPromotion(ground: Ground): Move | null {
  const { reports, reference, waiting } = ground;
  if (waiting !== null && readStep(ground, waiting)) {
    return { move: "promote", harness: waiting, why: `harness ${short(waiting)} read a step` };
  }
  const earlier = reports.toReversed().flatMap(({ old, fresh }) => (old === reference ? [fresh] : []));
  const owed = earlier.find((harness) => harness !== waiting && readStep(ground, harness));
  return owed === undefined
    ? null
    : {
        move: "promote",
        harness: owed,
        why: `harness ${short(owed)} read a step, and was not promoted: what later sessions left is read against it once it is the reference`,
      };
}

/**
 * New tasks where the last comparison the reference was in left it nothing to gain: no task
 * informative for it, or none that either harness answered (`roomOf`). Room is read on whichever
 * side the reference took, so the rule is the same in every epoch. A task nobody answers at the
 * campaign's one budget is one for the Examiner to replace. Tasks admitted since are compared
 * first (`unread`).
 *
 * A newly promoted reference also gets one Examiner session written for it, room or none, before
 * anything else: the tasks it was promoted on are the ones it already beat the last reference on,
 * so they say little about where it can still improve.
 */
function noRoom(ground: Ground): Move | null {
  const { reports, reference, events } = ground;
  const last = reports.findLast(({ old, fresh }) => old === reference || fresh === reference);
  if (last === undefined || enoughWrittenSince(ground, last)) return null;
  const side = last.old === reference ? "old" : "fresh";
  const room = roomOf(last.report, side);
  if (room === "room") {
    const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
    // A session the provider crashed or a stop killed did not finish writing for the new
    // reference, whatever it had held out by then, so it is owed again.
    const since = events.slice(promotedAt);
    const interrupted = new Set(
      since
        .filter((event) => sessionEnded(event) && INTERRUPTED.has(event.data.ended))
        .map(({ data }) => data.session),
    );
    const writtenForIt = since.some(
      (event) =>
        (event.kind === "exam.started" || event.kind === "exam.finished") &&
        !interrupted.has(event.data.session),
    );
    return promotedAt === -1 || writtenForIt
      ? null
      : {
          move: "examine",
          why: `harness ${short(reference ?? "")} was promoted, and no Examiner session has finished writing tasks for it since: tasks are written for each new reference`,
        };
  }
  const why =
    room === "too-hard"
      ? `comparison ${last.id} read no step, and neither harness gave a valid answer: other tasks are written`
      : side === "old"
        ? `comparison ${last.id} read no step, and no task was informative for the reference harness: the tasks have to change`
        : `harness ${short(reference ?? "")} is the reference, and comparison ${last.id} found no task informative for it: the tasks have to change, to ones it fails on some solves`;
  return outOfPatience(ground, "room", why) ?? { move: "examine", why };
}

function unread(ground: Ground): Move | null {
  return wantsTasks(ground) ? null : heldSince(ground);
}

/**
 * A comparison of the tasks held out since the last reading, before anything more is built.
 *
 * After a promotion, a starter comparison is owed until one tallies a task in the epoch, whatever
 * harness waits, since that reading is what confirms the promotion (`confirmed`, `climb.ts`). Once
 * one has tallied it is not owed again; owing it on every new task would put it first for the rest
 * of the epoch and leave the Builder's changes unread.
 *
 * A waiting harness whose last reading tested nothing, or left no room, is read on the new tasks.
 * One whose reading had room and read no step is not: that would be a second draw of the same pair
 * (`AGENTS.md`, section 4). The Builder changes it, and the next comparison reads the change.
 */
function heldSince(ground: Ground): Move | null {
  const { events, read, reports, waiting, reference, starter } = ground;
  // Count tasks held after both the promotion and the last starter comparison's start, so the
  // confirmation reads tasks aimed at this reference.
  const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
  const lastStarter = reports.findLast(({ old, fresh }) => old === starter || fresh === starter);
  const since = heldOutAfter(events, Math.max(lastStarter?.at ?? -1, promotedAt));
  const owed = reference !== null && starter !== null && reference !== starter && since > 0;
  if (owed && epochsOf(events).at(-1)?.starter_tally === null) {
    return compare(
      `harness ${short(reference)} is the reference, and ${plural(since, "task")} ${since === 1 ? "was" : "were"} held out for it: the starter is compared with it, those tasks first, to read whether they leave it room and whether it stands above the starter`,
      "starter",
    );
  }
  if (waiting === null || read === null || !enoughWrittenSince(ground, read)) return null;
  const later = "and tasks were written since";
  if (read.report.reading === "not-scored") return compare(`comparison ${read.id} tallied no task, ${later}`);
  const whatItLeft = { none: "left no room", "too-hard": "left neither harness an answer", room: null }[
    roomOf(read.report)
  ];
  return whatItLeft === null ? null : compare(`comparison ${read.id} ${whatItLeft}, ${later}`);
}

/** Why the Builder builds: what the last reading left, or which harness waits for a comparison
 *  (the Builder asks for that comparison itself, when it chooses). */
function buildsOn(ground: Ground): string {
  const { read, waiting, reference } = ground;
  if (read?.starterComparison === true) {
    return `comparison ${read.id} read the starter against harness ${short(reference ?? "")}, the tasks held out since first, and they leave it room: the Builder builds`;
  }
  if (read !== null) {
    return `comparison ${read.id} read no step with room to gain: harness ${short(read.fresh)} did not help`;
  }
  if (waiting === null) return "no session has left a harness that is not the reference harness";
  return `no comparison has read harness ${short(waiting)}: the Builder compares it when it chooses`;
}

/**
 * The released total a practice release should bring the campaign to now, with the sentence that
 * says why, or null where no practice is owed. This is the one reader of practice's bounds
 * (rule 12); the host releases on it as a conversation opens, as a task is held out and as a
 * comparison reports (`releaseOwed`, `campaign-actions.ts`).
 *
 * Practice is owed again after each reading (a comparison's first report, or a promotion), so a
 * new reference gets tasks to practise on rather than only the ones its predecessor passed.
 *
 * Each release is one task fewer to compare, so two limits apply. A reading with nothing held out
 * since the last release is owed only one task, and after a promotion none: the new reference's
 * practice is held out for it. And once practice exists or a promotion is on record, a release
 * must leave the admission floor of frontier tasks held. That frontier is read from the reference's
 * own solves alone, since practice is visible to the Builder and must not move with which task the
 * other harness won (rule 3).
 */
export function practiceDue(
  events: readonly LogEvent[],
  practice: number | null,
  level: number,
): { readonly to: number; readonly said: string } | null {
  if (practice === null) return null;
  const sets = taskSets(events);
  const released = sets.released.length;
  // A settling reports its comparison again (`settleReading`); only a comparison's first report is
  // a reading.
  const since = events.findLastIndex(
    ({ kind, data }, at) =>
      kind === PROMOTED ||
      (kind === "comparison.reported" &&
        !events.slice(0, at).some((one) => one.kind === kind && one.data.session === data.session)),
  );
  // A release that a check defect has since closed is no longer practice, so another is owed in
  // its place.
  const count = events.filter(
    ({ kind, data }, at) =>
      at > since &&
      kind === "task.state" &&
      data.state === "released" &&
      isString(data.version) &&
      sets.states.get(data.version) === "released",
  ).length;
  const allowance =
    released === 0 && !events.some(({ kind }) => kind === PROMOTED)
      ? Infinity
      : Math.max(0, poolOf(events).practiceFrontier.length - comparisonFloor(level));
  // The last release (or promotion) before the reading, so the reading's own releases do not count.
  const last = events.findLastIndex(
    ({ kind, data }, at) =>
      at <= since && (kind === PROMOTED || (kind === "task.state" && data.state === "released")),
  );
  const newTasksLimit =
    heldOutAfter(events, last) > 0 ? Infinity : events[last]?.kind === PROMOTED ? 0 : Math.max(0, 1 - count);
  const owed = Math.min(Math.max(0, practice - count), allowance, newTasksLimit);
  if (owed === 0) return null;
  return {
    to: released + owed,
    said: `${String(count)} of the ${plural(practice, "practice task")} the campaign names are released${since === -1 ? "" : " since the last reading"}`,
  };
}
