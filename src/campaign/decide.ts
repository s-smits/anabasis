/**
 * Move 7 of a campaign: the one move that follows from its log.
 *
 * A campaign is a loop of moves over one log (`7f0add79:docs/plan.md`, "The process"): the exam is read,
 * tasks are written, a Builder builds, two harnesses are compared, and then something has to say
 * what comes next. This is the plan's decision table: it takes the log and the campaign's plan and
 * returns one move with its reason, or an ending. It decides which move, and nothing of a move's
 * content: what a harness holds, what a task asks and how it is solved stay a model's.
 *
 * The table is `ROWS`, asked in order of one reading of the log (`groundOf`, `ground.ts`): the
 * first row that names a move chooses it. Comparison admission owns its refusals (`refusals`,
 * `admission.ts`), and the rows read its codes. Since 26 October its floor leaves one set-aside
 * task and one tie above a sweep: g-1 of truss-fresh-opus-v071 lost its chance to promote when one
 * of six tasks was set aside; practice releases and Examiner counts keep the same floor.
 *
 * The table names the host's moves and the endings; a Builder that leads its campaign makes its
 * own moves and is never told the table's. So it names no advice for it: until 5 November the
 * build row also named a release of owed practice (`toPractise`, now the host's own as each
 * conversation opens and each comparison reports, `releaseOwed`), and a `short` row named an
 * Examiner session where admission would refuse for want of tasks, which the refusal itself tells
 * a Builder that compares; 13 of 16 jobstat comparisons were logged as the Builder going against
 * the table's advice, 9 of them where it named a build (overhaul report 11, 5 November). Until 2 November the
 * build row also asked for tasks after a session that left its harness as it was with no practice
 * failure shown (`unshown`); it named that move twice in 146 archived logs.
 *
 * One count ends a campaign that cannot be given tasks or room (`roomless`), at its supply patience.
 *
 * A setting is recorded once (`campaign.setting`) and does not change, so every comparison of the
 * log is read, at the one budget it names (`7f0add79:docs/simplify.md`, package A).
 */
import { unadmitted } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { poolOf, roomOf } from "../kernel/reports.ts";
import { heldAtGate, taskSets } from "../kernel/task.ts";
import { isNumber, isString } from "../meta/json-shape.ts";
import { draftOf } from "../examiner/draft.ts";
import { plural } from "../meta/text.ts";
import { comparisonFloor } from "./admission.ts";
import { epochsOf } from "./climb.ts";
import { crashedRun, cutShort, groundOf, heldOut, type Plan } from "./ground.ts";
import { type Decided, type Ending, short } from "./move.ts";
import { pendingWords } from "./word.ts";

const PROMOTED = "harness.promoted";

type Ground = ReturnType<typeof groundOf>;
/** A move as a row names it, before the code of the row that chose it is put to it. */
type Move<Each = Decided> = Each extends unknown ? Omit<Each, "code"> : never;
/** A comparison of the ground's that reported. */
type Reading = Ground["reports"][number];

/** The table. A row names its move where it holds, and null where the next row is asked. */
const ROWS: readonly {
  readonly code: string;
  readonly move: (ground: Ground) => (Move & { readonly code?: string }) | null;
}[] = [
  // A stop the operator left, or the operator's cap of promotions reached, ends the campaign,
  // whatever else the log holds.
  { code: "stop", move: stop },
  // The exam does not stand: it is drafted, read, or the campaign ends on it. Before the bounds,
  // since reading it bills nothing; a draft bills, so it asks the bounds first.
  { code: "exam", move: exam },
  // A bound is spent: the total, the provider, the improvement patience, a comparison cut short.
  { code: "bound", move: bound },
  // The tasks are not set up: taken in, released, written on the operator's word, or written up
  // to a comparison's and its practice's before the first session is paid for.
  { code: "tasks", move: tasks },
  // A comparison that began goes on.
  { code: "unfinished", move: unfinished },
  // A step against the reference promotes.
  { code: "step", move: stepped },
  // The reference's last reading left it nothing to gain: the tasks change.
  { code: "no-room", move: noRoom },
  // Tasks held out since the last reading are read before a Builder session is paid for, where
  // admission would take the comparison: the starter comparison a promotion owes, or a waiting
  // harness whose last reading left no room.
  { code: "unread", move: unread },
  // Nothing new to read, or too few tasks to read it on: the Builder builds, and asks the Examiner
  // itself. Short of tasks at the supply patience, the campaign ends on its exam.
  {
    code: "build",
    move: (ground) => {
      const { read } = ground;
      // Examiner sessions that held out nothing count as every reading that left nothing to gain.
      if (wantsTasks(ground)) {
        return spent(ground, "tasks", WANTS) ?? { move: "build", why: `${WANTS}: ${ASKS}` };
      }
      return read?.report.reading === "not-scored"
        ? { move: "build", why: `comparison ${read.id} tallied no task: ${ASKS}` }
        : { move: "build", why: buildsOn(ground) };
    },
  },
];

/** The drafts of an exam the plan gives before the campaign ends on it. */
const DRAFTS = 3;
/** Builder or Examiner sessions in a row the provider failed before the campaign ends on its
 *  environment: as many as drafts, so that a campaign is not built or examined against a dead
 *  provider without end, and no more, since each costs an id and the operator's wait. */
export const CRASHES = DRAFTS;
/** Admission refusal codes caused by insufficient held-out tasks (`refusals`, `admission.ts`). */
const SHORT = ["no-held", "held-short"] as const;
const WANTS = "comparison admission refuses the next comparison for want of tasks";
const ASKS = "the Builder builds, and asks for tasks";
/** Whether comparison admission would refuse the next comparison for want of tasks. */
const wantsTasks = ({ refused }: Ground): boolean => SHORT.some((code) => refused.has(code));

const end = (ending: Ending, why: string): Move => ({ move: "end", ending, why });
/** A comparison of the latest harness, or of the starter, with the reference one (a starter comparison). */
const compare = (why: string, fresh = "latest"): Move => ({
  move: "compare",
  fresh,
  reference: "promoted",
  why,
});

/** The move that follows from the log, with the code of the row or the hold that chose it. */
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
 * Why the plan would not promote `harness` on this log now, or null where it would: a harness is
 * promoted on a comparison that read a step against the reference (`steps`). It is the rule move 7
 * promotes by (`stepped`), asked for a harness the operator names (`tools/d2/promote.ts`).
 */
export function unpromoted(events: readonly LogEvent[], plan: Plan, harness: string): string | null {
  return steps(groundOf(events, plan), harness)
    ? null
    : `harness ${short(harness)} has no comparison that read a step against the reference harness`;
}

/** The tasks held out since the last release or promotion, which every release the host makes
 *  draws on (`releaseOwed`, `campaign-actions.ts`), as the table's did until 5 November
 *  (`toPractise`): one with nothing new held would take the next comparison's frontier. */
export const heldSinceRelease = (events: readonly LogEvent[]): number =>
  heldAfter(
    events,
    events.findLastIndex(
      ({ kind, data }) => kind === PROMOTED || (kind === "task.state" && data.state === "released"),
    ),
  );

/** The tasks held out after the log's index `after` that are held out still. Until 2 November a
 *  task released since counted, and a rehearsal named a starter comparison on six tasks that were
 *  all released after a promotion, whose draw then held none. */
export function heldAfter(events: readonly LogEvent[], after: number): number {
  const held = new Set(taskSets(events).held);
  return events.filter(
    ({ kind, data }, index) =>
      index > after &&
      kind === "task.gate" &&
      heldAtGate(data.outcome) &&
      isString(data.version) &&
      held.has(data.version),
  ).length;
}

/** Whether tasks were held out after `reading` and enough are now held to start a comparison.
 *  If so, compare them before asking for another Examiner session. Enough is as many new tasks as
 *  could clear the level alone (`sweepOf`): on 3 November esp32-fresh-opus-forkedPR579 g-2 paid 72
 *  solves on 4 new tasks beside 14 the reference had closed. */
function writtenSince(ground: Ground, reading: Reading): boolean {
  const { events, plan } = ground;
  // Tasks held after the reading began, which its draw did not take (`scoredSet`, `round.ts`): from
  // 5 November an Examiner session writes beside a comparison, and until then the count began at
  // the report. A session writing as a step reports aims at the reference before the promotion it
  // waits for (`promoteOwed`), so only tasks held after the promotion are written for the new one.
  const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
  const since = heldAfter(events, Math.max(reading.at, promotedAt));
  return since >= sweepOf(plan.wanted.level) && !wantsTasks(ground);
}

/**
 * The trailing run of readings that left nothing to gain. A reading is a comparison that reported
 * against the reference and left it no room, or an Examiner session that ended whole and held out
 * no task. A comparison that left it room ends the run, and so does one made against another
 * harness, as every one from before a promotion: the step a harness was promoted
 * on is no answer to a want of room, though the tasks change on what they read (`noRoom`). So
 * does a session whose tasks no comparison has read yet, however few it wrote: on 9 October a
 * campaign ended on three sessions that had written four tasks between them. A session whose
 * tasks a comparison has read is passed over, and so is one the provider failed or a stopped run
 * cut (`crashedRun`; `endCut`, `tools/d2/harness-builder.ts`).
 *
 * It is the one count that ends a campaign for want of tasks or of room (`spent`). Until
 * 12 October three counted, and esp32-141-m3b examined and read no room five times over.
 */
function roomless({ events, reports, reference }: Ground) {
  const read = Math.max(-1, ...reports.map(({ reported }) => reported));
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

/** Count supply attempts after excluding the comparison that first established the need. */
function counted(run: ReturnType<typeof roomless>): number {
  return run.length - (run[0]?.id == null ? 0 : 1);
}

/** Consecutive supply attempts, counted by the same rule as the stopping decision in spent. */
export function supplyRun(events: readonly LogEvent[], plan: Plan): number {
  return counted(roomless(groundOf(events, plan)));
}

/**
 * The campaign's ending where its supply patience of readings in a row left nothing to gain (`roomless`),
 * and null while it has supply patience left: on its exam where the campaign wants for tasks, which could
 * not be written, and on its room where the tasks it has leave none. A comparison that opens the
 * run raised the want and is no answer to it, so it is not counted: a comparison on the pack's
 * tasks ends nothing before the Examiner was asked. `why` is the reason the next Examiner session
 * would have had.
 */
function spent(ground: Ground, wants: "tasks" | "room", why: string): Move | null {
  const run = roomless(ground);
  if (counted(run) < ground.plan.patience) return null;
  const ids = run.flatMap(({ id }) => (id === null ? [] : [id]));
  const idle = plural(run.length - ids.length, "Examiner session");
  const told =
    ids.length === 0
      ? `${idle} in a row held out no task`
      : `${plural(run.length, "reading")} in a row left nothing to gain: ${ids.length === 1 ? "comparison" : "comparisons"} ${ids.join(", ")} left the reference no room${ids.length === run.length ? "" : ` and ${idle} held out no task`}`;
  return wants === "tasks"
    ? end("exam", `${told} (${why}): the tasks could not be written`)
    : end("no-room", `${told} (${why}): the tasks could not be made to leave room`);
}

/** An Examiner session for the reason `why`, or the campaign's ending where its supply patience is spent. */
function examine(ground: Ground, wants: "tasks" | "room", why: string): Move {
  return spent(ground, wants, why) ?? { move: "examine", why };
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
    // Every word left before the stop is answered by it: the campaign has stopped.
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
  // A check its author's own computation decides stands on the operator's word, given by name.
  // Where this command gives it for a check the last reading did not hold admitted, the exam is
  // read again with it.
  const kept = events.findLast(({ kind }) => kind === "checker.read")?.data.admitted;
  const more = plan.admits.filter((id) => !(Array.isArray(kept) && kept.includes(id)));
  if (more.length > 0) {
    return { move: "accept", why: `the operator admits ${more.join(", ")}: the exam is read again` };
  }
  // The checks no engine decides are named, so that a log whose campaign ran unattended says
  // what the operator's word is wanted for: a drafted exam's checks all, since none runs one.
  const waiting = unadmitted(events);
  return end(
    "exam",
    `the checker's last reading holds ${plural(faults, "fault")} and nobody froze it: the exam is not accepted until its author repairs it, or the operator admits each check by name and freezes (tools/c/accept.ts)${waiting.length === 0 ? "" : `. No engine the host installed decides ${waiting.join(", ")}, so each stands on the operator's word alone: --admit ${waiting.join(",")}`}`,
  );
}

/** The first move of a campaign that opened from a prompt and holds no exam: a draft, while the
 *  plan's three have not been put. The bounds are asked first (`bound`), as before any billed move:
 *  a session that crashed before it put a draft is the crash rule's (`crashedRun`), whose
 *  `CRASHES` in a row end the campaign on its environment (10 October: three sessions crashed in
 *  one second, Claude Code refusing to run as root), and a budget with less left than its reserve
 *  ends it on its budget. Until 29 October the budget was read only after the exam stood, so a
 *  campaign opened with $10 on a $10 reserve put three drafts the budget stopped at once, and
 *  ended `exam`, "0 drafts in 3 sessions did not stand". The drafts put count over the whole log. */
function drafting(events: readonly LogEvent[]): Move {
  const put = ({ tries }: LogEvent["data"]) => (isNumber(tries) ? tries : 0);
  const sessions = events.filter(
    ({ kind, data }) =>
      kind === "draft.finished" && ((data.ended !== "crashed" && data.ended !== "killed") || put(data) > 0),
  );
  const tries = sessions.reduce((sum, { data }) => sum + put(data), 0);
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
  const { events, plan, refused, supply, read } = ground;
  const { left } = plan;
  if (left !== null && left.dollars < left.reserve) {
    return end(
      "budget",
      `$${left.dollars.toFixed(2)} of the campaign's budget are left, and one solve is held at $${String(left.reserve)}`,
    );
  }
  // The provider's failure is the environment's ending and no reading of the exam or the room:
  // the campaign goes on from its log once its command is run again (`crashedRun`). It is read
  // after the budget, so that a campaign out of both is not told to run again.
  const crashes = crashedRun(events);
  if (crashes.count >= CRASHES) {
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
  return read?.report.reading === "not-scored" && read.report.capped === true
    ? end("budget", `comparison ${read.id} was cut by its dollar cap before it tallied a task`)
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
  // A campaign that names no practice is released none: until 20 October this named a release that
  // took nothing, and the campaign command threw on the move that changed nothing.
  if (supply.released === 0 && supply.held >= 2 && plan.practice !== 0) {
    return { move: "prepare", why: "no task is released for practice: the contract's draw releases some" };
  }
  // Other tasks on the operator's word, once the campaign has an exam to write them against.
  const asked = pendingWords(events).find(({ word }) => word === "tasks");
  if (asked !== undefined) {
    return {
      move: "examine",
      why: `the operator asked for other tasks${asked.why === "" ? "" : `: ${asked.why}`}`,
      answers: [asked.at],
    };
  }
  // Before its first comparison a campaign needs the admission floor plus any tasks still to be
  // released for practice. Until 28 October it held the target to keep the Examiner off the critical
  // path. A comparison waits for the open Examiner session, and two buffer campaigns of 27 October held 9
  // tasks at a floor of 8, examined 7 and 3 more hours towards 24, and stopped without comparing.
  // Until 13 October it held twice the target, and two campaigns examined 16 hours and never compared.
  const missing = all.length > 0 ? 0 : shortBy(ground);
  if (missing === 0) return null;
  const before =
    waiting === null
      ? "no comparison has run yet"
      : `harness ${short(waiting)} has not been compared under the campaign's setting`;
  return examine(
    ground,
    "tasks",
    `the campaign is ${plural(missing, "held-out task")} short of the tasks a first comparison needs and the practice its release draws, and ${before}: the Examiner writes more first`,
  );
}

/**
 * How many held-out tasks the campaign is short of: its admission floor, or after its first
 * comparison its target where that is larger, and what the next release still draws for practice,
 * less what it holds. The table's examine before a comparison reads this count (`shortBy`). The
 * session's ask (`examTasks`, `campaign-terms.ts`) is never less than a sweep (`sweepOf`), the
 * fewest new tasks a comparison waits for after a reading that left no room (`writtenSince`); 0
 * stays 0, leaving the command's default of 12. Until 4 November it was not raised, and
 * jobstat-fresh-opus-forkedPR595-stijn-linux's x-3 was asked for 4 where the table waited for 6.
 */
export function shortOf(events: readonly LogEvent[], plan: Plan): number {
  const count = shortBy(groundOf(events, plan));
  return count === 0 ? 0 : Math.max(count, sweepOf(plan.wanted.level));
}

function shortBy({ plan, supply, all }: Ground): number {
  const practice = Math.max(0, (plan.practice ?? 0) - supply.released);
  const target = all.length === 0 ? 0 : plan.wanted.target;
  return Math.max(0, practice + Math.max(target, comparisonFloor(plan.wanted.level)) - supply.held);
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

/** Whether `harness` read a step against the reference at the comparison's fixed level (`stepOf`,
 *  `compare.ts`). A starter comparison names no candidate: a starter win on new tasks shows room,
 *  rather than a candidate to promote. Until 19 October a step bought a repeat on fresh solves, and the
 *  two read together had to clear the level. */
function steps({ reports, reference, starter }: Ground, harness: string): boolean {
  return (
    harness !== reference &&
    harness !== starter &&
    reports.some(
      ({ fresh, old, report }) => fresh === harness && old === reference && report.reading === "step",
    )
  );
}

/**
 * The promotion of the waiting harness, or of an earlier one the campaign owes: a harness that
 * read a step against the reference while later sessions left another. The table follows the
 * latest harness, and would pass such a step by: on 9 October one campaign read a step twice,
 * promoted nothing, and the table named a Builder session. The newest such harness is named, and
 * what later sessions left is read against it once it is the reference.
 */
function stepped(ground: Ground): Move | null {
  const { reports, reference, waiting } = ground;
  if (waiting !== null && steps(ground, waiting)) {
    return { move: "promote", harness: waiting, why: `harness ${short(waiting)} read a step` };
  }
  const earlier = reports.toReversed().flatMap(({ old, fresh }) => (old === reference ? [fresh] : []));
  const owed = earlier.find((harness) => harness !== waiting && steps(ground, harness));
  return owed === undefined
    ? null
    : {
        move: "promote",
        harness: owed,
        why: `harness ${short(owed)} read a step, and was not promoted: what later sessions left is read against it once it is the reference`,
      };
}

/**
 * The tasks change where the last comparison the reference was in left it nothing to gain: no task
 * informative for it, or none either harness answered (`roomOf`). Its room is read whichever side
 * it took, so the reading is the same at every epoch and nothing here is a promotion's own: a
 * harness is promoted on a comparison it won, so the tasks it was promoted on mostly leave it
 * none, and one valid on half of them is built against on the same tasks. A campaign runs at one
 * budget, and a task nobody answers at it is one for the Examiner to replace: on 9 October five
 * Examiner sessions wrote tasks for a budget of one turn, in which no solver can write an answer
 * and submit it. Tasks admitted since are compared on first (`unread`).
 *
 * A promoted reference is also written for once, room or none, before anything else is: the tasks
 * it was promoted on are the ones its Builder beat the last reference on. On 19 October r3's
 * Examiner sessions after its first two promotions held out 24 tasks informative for the new
 * reference, against r1's 3 and r2's 4, and its next two promotions were read on them; r1's
 * Builder compared six minutes after its promotion on 1 informative task of 25. At the time,
 * before the `ROOM` objective gap floor, those promotion comparisons read 21, 24 and 6 informative
 * tasks for the new reference, against 0 before #242. The floor now applies; tasks are still
 * written once for each promoted reference whatever its last reading left.
 */
function noRoom(ground: Ground): Move | null {
  const { reports, reference, events } = ground;
  const last = reports.findLast(({ old, fresh }) => old === reference || fresh === reference);
  if (last === undefined || writtenSince(ground, last)) return null;
  const side = last.old === reference ? "old" : "fresh";
  const room = roomOf(last.report, side);
  if (room === "room") {
    const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
    // A session the provider crashed or a stop killed before it held out a task wrote nothing for
    // the new reference (`cutShort`): on 21 October r5's x-4 and r6's x-5 crashed so, and each
    // campaign compared its next harness on the tasks the old reference had closed.
    const since = events.slice(promotedAt);
    const cut = new Set(since.filter(cutShort).map(({ data }) => data.session));
    const written = since.some(
      (event) =>
        (event.kind === "exam.started" || event.kind === "exam.finished") && !cut.has(event.data.session),
    );
    return promotedAt === -1 || written
      ? null
      : {
          move: "examine",
          why: `harness ${short(reference ?? "")} was promoted, and no Examiner session has written tasks for it since: tasks are written for each new reference`,
        };
  }
  const why =
    room === "too-hard"
      ? `comparison ${last.id} read no step, and neither harness gave a valid answer: other tasks are written`
      : side === "old"
        ? `comparison ${last.id} read no step, and no task was informative for the reference harness: the tasks have to change`
        : `harness ${short(reference ?? "")} is the reference, and comparison ${last.id} found no task informative for it: the tasks have to change, to ones it fails on some solves`;
  return spent(ground, "room", why) ?? { move: "examine", why };
}

function unread(ground: Ground): Move | null {
  return wantsTasks(ground) ? null : heldSince(ground);
}

/**
 * A comparison that draws the tasks held out since the last reading first, before anything is built.
 * After a promotion a starter comparison is owed until one tallies a task in the epoch,
 * whatever harness waits, since that reading confirms the promotion (`confirmed`, `climb.ts`, its
 * one reader): a session that changed harness/ beside the Examiner took its move, 5 of 5
 * promotions in the rehearsal of 2 November (sim-postplan) and the base alike. Until 3 November
 * any report of the pair stopped the debt, so one that tallied nothing left the epoch unconfirmed.
 * Once one has tallied it is not owed again: until 4 November it was, with no harness waiting,
 * which a led Builder's harness/ never is (`latestBuilt`), so each task held since put the pair
 * first again, and buffer-fresh-opus-forkedPR588-stijn-pro spent 96% of its epoch's solver dollars
 * on it with its changed harness/ unread for 11.8 hours. A waiting harness whose last reading tested nothing, or left no room, is
 * read on them. One whose reading had room and read no step is not: that would be a second draw of
 * one pair (`AGENTS.md`, section 4). Until 2 November this row redrew it, 13 times in the archive,
 * and the one step (buffer-159-opus g-7) came the comparison after a 5-0 no-step of the same
 * harness. The Builder changes it, and the next comparison reads the change.
 */
function heldSince(ground: Ground): Move | null {
  const { events, read, reports, waiting, reference, starter } = ground;
  // Tasks held after the promotion and after the last starter comparison began, so the confirmation
  // reads tasks aimed at this reference: a Builder's own comparison beside its first session hides none.
  const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
  const lastStarter = reports.findLast(({ old, fresh }) => old === starter || fresh === starter);
  const since = heldAfter(events, Math.max(lastStarter?.at ?? -1, promotedAt));
  const owed = reference !== null && starter !== null && reference !== starter && since > 0;
  if (owed && epochsOf(events).at(-1)?.starter_tally === null) {
    return compare(
      `harness ${short(reference)} is the reference, and ${plural(since, "task")} ${since === 1 ? "was" : "were"} held out for it: the starter is compared with it, those tasks first, to read whether they leave it room and whether it stands above the starter`,
      "starter",
    );
  }
  if (waiting === null || read === null || !writtenSince(ground, read)) return null;
  const later = "and tasks were written since";
  if (read.report.reading === "not-scored") return compare(`comparison ${read.id} tallied no task, ${later}`);
  const left = { none: "left no room", "too-hard": "left neither harness an answer", room: null }[
    roomOf(read.report)
  ];
  return left === null ? null : compare(`comparison ${read.id} ${left}, ${later}`);
}

/** Why the Builder builds: what the pair's last reading left, or what waits for a comparison. Until
 *  5 November a harness no comparison had read was compared once the Builder sessions the opening
 *  named had run (`--sessions`, 2): every build of the 108 paid campaigns opened from 28 October
 *  was a Builder's own conversation, which asks for `compare` itself, and the count named the
 *  move 3 times in all of them. */
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
 * The released total a release brings practice to now, and the sentence that says why, or null
 * where practice is owed none. Two bounds decide it, and this is their one reader (rule 12): the
 * host's releases as a conversation opens, as the gate holds a task out and as a comparison reports
 * (`releaseOwed`, `campaign-actions.ts`). Until 5 November the table also named it before a Builder
 * session (`toPractise`), and the Builder had its own `release_practice`: 10 calls in seven jobstat
 * campaigns, 4 of which released nothing (overhaul report 11).
 *
 * The practice named is owed again after each reading, a comparison's report or a promotion.
 * Until 16 October it was the campaign's, and three campaigns released none after their
 * promotion, where every practice solve passed. Until 30 October it was the epoch's:
 * buffer-fresh-opus-v072 held out 69 tasks after its second promotion and released six, its
 * Builder passed all 103 practice solves on its 18 tasks, and three `release_practice` calls
 * released nothing while two more comparisons read the same candidate.
 *
 * Each release is one task fewer to compare, so once practice exists or a promotion is on record
 * it leaves the admission floor at `level` of frontier tasks held: top-ups before a promotion
 * consumed esp32-r2's frontier (20 October, whole-run investigations of six campaigns). The
 * frontier is read on the reference's own solves alone, since the comparison's can change with
 * which task the other harness won, and practice is visible to the Builder (rule 3).
 */
export function practiceDue(
  events: readonly LogEvent[],
  practice: number | null,
  level: number,
): { readonly to: number; readonly said: string } | null {
  if (practice === null) return null;
  const released = taskSets(events).released.length;
  // A settlement reports its comparison again (`settleReading`); only a session's first report is a reading.
  const since = events.findLastIndex(
    ({ kind, data }, at) =>
      kind === PROMOTED ||
      (kind === "comparison.reported" &&
        !events.slice(0, at).some((one) => one.kind === kind && one.data.session === data.session)),
  );
  const count = events.filter(
    ({ kind, data }, at) => at > since && kind === "task.state" && data.state === "released",
  ).length;
  const allowance =
    released === 0 && !events.some(({ kind }) => kind === PROMOTED)
      ? Infinity
      : Math.max(0, poolOf(events).practiceFrontier.length - comparisonFloor(level));
  const owed = Math.min(Math.max(0, practice - count), allowance);
  if (owed === 0) return null;
  return {
    to: released + owed,
    said: `${String(count)} of the ${plural(practice, "practice task")} the campaign names are released${since === -1 ? "" : " since the last reading"}`,
  };
}
