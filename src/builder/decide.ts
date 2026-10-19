/**
 * Move 7 of a campaign: the one move that follows from its log.
 *
 * A campaign is a loop of moves over one log (`docs/plan.md`, "The process"): the exam is read,
 * tasks are written, a Builder builds, two harnesses are compared, and then something has to say
 * what comes next. This is the plan's decision table: it takes the log and the campaign's plan and
 * returns one move with its reason, or an ending. It decides which move, and nothing of a move's
 * content: what a harness holds, what a task asks and how it is solved stay a model's.
 *
 * The table is `ROWS`, asked in order of one reading of the log (`groundOf`, `ground.ts`): the
 * first row that names a move chose it, and a hold (`HOLDS`) may change the move a row named. A
 * decision carries the code of the row or the hold it came from. What the gate refuses a
 * comparison for is the gate's to say (`refusals`, `admission.ts`), and the rows read its codes.
 *
 * One count ends a campaign that cannot be given tasks or room (`roomless`), at its patience.
 *
 * A setting is recorded once (`campaign.setting`) and does not change, so every comparison of the
 * log is read, at the one budget it names (`docs/simplify.md`, package A).
 */
import { unadmitted } from "../kernel/acceptance.ts";
import {
  attemptsOf,
  readsStepEitherWay,
  readTwice,
  sweepOf,
  triggered,
  untiedOf,
} from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { billedParts, poolOf, roomOf } from "../kernel/reports.ts";
import { SIZE } from "../kernel/size.ts";
import { practiceRan } from "../kernel/solves.ts";
import { heldAtGate, taskSets } from "../kernel/task.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { draftOf } from "../examiner/draft.ts";
import { TRIED } from "../examiner/record.ts";
import { plural } from "../meta/text.ts";
import { crashedRun, cutShort, groundOf, heldOut, type Plan } from "./ground.ts";
import { openingOf } from "./opening.ts";
import { type Decided, type Ending, short } from "./move.ts";
import { pendingWords } from "./word.ts";

type Ground = ReturnType<typeof groundOf>;
/** A move as a row names it, before the code of the row that chose it is put to it. */
type Move<Each = Decided> = Each extends unknown ? Omit<Each, "code"> : never;
/** A comparison of the ground's that reported. */
type Reading = Ground["reports"][number];

/** The table. A row names its move where it holds, and null where the next row is asked. */
const ROWS: readonly { readonly code: string; readonly move: (ground: Ground) => Move | null }[] = [
  // A stop the operator left ends the campaign, whatever the log holds.
  { code: "stop", move: stop },
  // The exam does not stand: it is drafted, read, or the campaign ends on it. Before the bounds,
  // since reading it bills nothing.
  { code: "exam", move: exam },
  // A bound is spent: the total, the provider, the patience, the control, a comparison cut short.
  { code: "bound", move: bound },
  // The tasks are not set up: taken in, released, written on the operator's word, or written up
  // to a comparison's and its practice's before the first session is paid for.
  { code: "tasks", move: tasks },
  // A comparison that began goes on, and one draw that cleared the trigger is drawn again, on its
  // untied tasks and tasks it did not score.
  { code: "unfinished", move: unfinished },
  // A step and its repeat, read together, promote.
  { code: "twice", move: twice },
  // The reference's last reading left it nothing to gain: the tasks change.
  { code: "no-room", move: noRoom },
  // The gate would refuse the next comparison for want of tasks: they are written first, since a
  // changed harness can only tie again on tasks the reference closed.
  { code: "short", move: wanting },
  // Something no comparison has read is compared before a Builder session is paid for.
  { code: "unread", move: unread },
  // Nothing new to read, and room to gain: the Builder builds.
  { code: "build", move: (ground) => ({ move: "build", why: buildsOn(ground) }) },
];

/** The holds, asked of the move a row named: the first that holds names another in its place. */
const HOLDS: readonly {
  readonly code: string;
  readonly hold: (ground: Ground, named: Move) => Move | null;
}[] = [
  { code: "afford", hold: unafforded },
  { code: "practice", hold: toPractise },
  { code: "unshown", hold: unshown },
];

/** The drafts of an exam the plan gives before the campaign ends on it. */
const DRAFTS = 3;
/** Builder or Examiner sessions in a row the provider failed before the campaign ends on its
 *  environment: as many as drafts, so that a campaign is not built or examined against a dead
 *  provider without end, and no more, since each costs an id and the operator's wait. */
export const CRASHES = DRAFTS;
/** The gate's refusals that are a want of tasks (`refusals`, `admission.ts`). */
const SHORT = ["no-held", "held-short"] as const;

const end = (ending: Ending, why: string): Move => ({ move: "end", ending, why });
/** A comparison of the latest harness, or of the starter as a control, with the reference one. */
const compare = (why: string, fresh = "latest", repeats?: string): Move => ({
  move: "compare",
  fresh,
  reference: "promoted",
  why,
  ...keyIfDefined("repeats", repeats),
});

/** The move that follows from the log, with the code of the row or the hold that chose it. */
export function decide(events: readonly LogEvent[], plan: Plan): Decided {
  const ground = groundOf(events, plan);
  for (const row of ROWS) {
    const named = row.move(ground);
    if (named === null) continue;
    const held = HOLDS.map(({ code, hold }) => ({ code, move: hold(ground, named) })).find(
      (each) => each.move !== null,
    );
    return held?.move == null ? { ...named, code: row.code } : { ...held.move, code: held.code };
  }
  throw new Error("the decision table's last row names a move for every log");
}

/**
 * Why the plan would not promote `harness` on this log now, or null where it would: a step is
 * promoted once it and its repeat, read together, clear the level (`readTwice`). It is the rule
 * move 7 promotes by (`twice`), asked for a harness the operator names (`tools/d2/promote.ts`).
 */
export function unpromoted(events: readonly LogEvent[], plan: Plan, harness: string): string | null {
  return steppedTwice(groundOf(events, plan), harness)
    ? null
    : `harness ${short(harness)} has no comparison and repeat that, read together, clear the level against the reference harness`;
}

/** The tasks held out after the log's index `after`. */
export function heldAfter(events: readonly LogEvent[], after: number): number {
  return events.filter(
    ({ kind, data }, index) => index > after && kind === "task.gate" && heldAtGate(data.outcome),
  ).length;
}

/** Whether tasks were held out since `reading` reported that the gate would admit a comparison
 *  on: the answer to a want of tasks or of room is then that comparison, and no session more. */
function writtenSince({ events, refused }: Ground, reading: Reading): boolean {
  return heldAfter(events, reading.reported) > 0 && !SHORT.some((code) => refused.has(code));
}

/**
 * The trailing run of readings that left nothing to gain. A reading is a comparison that reported
 * against the reference and left it no room, or an Examiner session that ended whole and held out
 * no task. A comparison that left it room ends the run, and so does one made against another
 * harness, as every one from before a promotion: the step and its repeat a harness was promoted
 * on are no answer to a want of room, though the tasks change on what they read (`noRoom`). So
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

/**
 * The campaign's ending where its patience of readings in a row left nothing to gain (`roomless`),
 * and null while it has patience left: on its exam where the campaign wants for tasks, which could
 * not be written, and on its room where the tasks it has leave none. A comparison that opens the
 * run raised the want and is no answer to it, so it is not counted: a comparison on the pack's
 * tasks ends nothing before the Examiner was asked. `why` is the reason the next Examiner session
 * would have had.
 */
function spent(ground: Ground, wants: "tasks" | "room", why: string): Move | null {
  const run = roomless(ground);
  const raised = run[0]?.id == null ? 0 : 1;
  if (run.length - raised < ground.plan.patience) return null;
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

/** An Examiner session for the reason `why`, or the campaign's ending where its patience is spent. */
function examine(ground: Ground, wants: "tasks" | "room", why: string): Move {
  return spent(ground, wants, why) ?? { move: "examine", why };
}

function stop({ events }: Ground): Move | null {
  const words = pendingWords(events);
  const stopped = words.find(({ word }) => word === "stop");
  if (stopped === undefined) return null;
  return {
    move: "end",
    ending: "operator",
    why: `the operator's word${stopped.why === "" ? "" : `: ${stopped.why}`}`,
    // Every word left before the stop is answered by it: the campaign has stopped.
    answers: words.filter(({ at }) => at <= stopped.at).map(({ at }) => at),
  };
}

function exam({ events, plan, supply, refused }: Ground): Move | null {
  if (plan.prompted && draftOf(events) === null) return drafting(events);
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
 *  plan's three have not been put. A session that crashed before it put a draft is the crash
 *  rule's, as any session's is (`crashedRun`): a named reset is waited out, and `CRASHES` in a
 *  row end the campaign on its environment, with what the last crash said (10 October: three
 *  sessions crashed in one second, Claude Code refusing to run as root). Until 16 October the
 *  draft kept a count of its own, nothing waited, and three drafts that crashed on a session
 *  limit ended three fresh campaigns 33 minutes before it reset. The drafts put count
 *  over the whole log. */
function drafting(events: readonly LogEvent[]): Move {
  const crashes = crashedRun(events);
  if (crashes.count >= CRASHES) {
    return end(
      "environment",
      `no draft was put: the Examiner's session crashed ${String(crashes.count)} times (${crashes.crash ?? "the provider gave no reason"})`,
    );
  }
  const put = ({ tries }: LogEvent["data"]) => (isNumber(tries) ? tries : 0);
  const sessions = events.filter(
    ({ kind, data }) => kind === "draft.finished" && (data.ended !== "crashed" || put(data) > 0),
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
  const control = controlled(ground);
  if (control !== null) return end("control", control);
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

/**
 * Why the campaign ends on its control, or null. The control is the epoch's first A/A, the
 * reference read against itself beside the first comparison against it that carries one
 * (`comparison.ts`). Read two-sided at that comparison's level, since which half is which is
 * arbitrary, it reads a step at most as often as the level; a step there is false by
 * construction, so what it measures is the comparison and not either harness: the host, the
 * provider or the solver moved between halves of one harness's solves. It holds until the
 * operator leaves a cause after its report (`--cause`), never a wait. The A/As after it stand as
 * readings, and the climb reads them for its false promotion (`climb.ts`).
 */
function controlled({ events, reports, reference, starter }: Ground): string | null {
  const differencesOf = ({ report }: Reading) => asRecord(report.noise)?.differences;
  const control = reports.find(
    (each) => each.old === (reference ?? starter) && Array.isArray(differencesOf(each)),
  );
  if (control === undefined) return null;
  // A cause the operator left on record after the control (`--cause`) lets the campaign go on.
  const after = control.reported;
  if (
    events.some(({ kind, data }, index) => index > after && kind === "campaign.word" && data.word === "cause")
  ) {
    return null;
  }
  const apart = differencesOf(control);
  const level = isNumber(control.report.level) ? control.report.level : 0;
  // Two-sided at the level: either one-sided test at half of it.
  return readsStepEitherWay(Array.isArray(apart) ? apart.filter(isNumber) : [], level / 2)
    ? `comparison ${control.id} read the reference against itself as a step, so its two sides are not interchangeable and no comparison against it reads anything until the cause is on record: leave it with tools/d2/word.ts --cause "<the cause>", and the campaign goes on when run again`
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
  if (supply.released === 0 && supply.held >= 2) {
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
  // Before its first comparison a campaign holds the tasks it scores and the practice its release
  // still draws, written before the first session is paid for, so that the Examiner is not on the
  // critical path between the session and the comparison: campaigns that built first on three
  // practice tasks cleared them in three to five harness versions, and then waited on an Examiner
  // session. It is a wish and no refusal of the gate's, which admits a comparison by hand on fewer.
  // Until 13 October it held a repeat's tasks as well, twice the target, and the two host-run
  // campaigns of 12 October examined for 16 hours, held 41 and 31 of 48, and never compared. A
  // repeat's tasks are written where one is due (`unfinished`).
  const missing = all.length > 0 ? 0 : shortBy(ground);
  if (missing === 0) return null;
  const before =
    waiting === null
      ? "no comparison has run yet"
      : `harness ${short(waiting)} has not been compared under the campaign's setting`;
  return examine(
    ground,
    "tasks",
    `the campaign is ${plural(missing, "held-out task")} short of a comparison's target and the practice its release draws, and ${before}: the Examiner writes more first`,
  );
}

/**
 * How many held-out tasks the campaign is short of: a comparison's target and what the next
 * release still draws for practice, which leaves the held ones, less what it holds; for a repeat,
 * a sweep at the level (`sweepOf`) less the tasks it may score (`dueOf`), and nothing for practice,
 * since a repeat releases none. The table's examine before a comparison and the session's ask
 * (`examTasks`, `campaign-terms.ts`) are this count. Until 19 October a repeat waited for the
 * practice stock too: buffer-fresh-gpt-forkedPR223_v0_5_4-r2's g-2 held the six tasks its repeat
 * scores from x-3's end, and the table sent for five practice tasks in their place for six hours.
 */
export function shortOf(events: readonly LogEvent[], plan: Plan): number {
  return shortBy(groundOf(events, plan));
}

function shortBy(ground: Ground): number {
  const { plan, supply } = ground;
  const due = dueOf(ground);
  if (due !== null) return Math.max(0, sweepOf(plan.wanted.level) - due.again - due.fresh);
  const practice = Math.max(0, (plan.practice ?? 0) - supply.released);
  return Math.max(0, practice + plan.wanted.target - supply.held);
}

/** The comparison whose repeat is due, and the held tasks its first stage did not score, as a led
 *  Builder's campaign status says them; null where none is. */
export function repeatDue(events: readonly LogEvent[], plan: Plan): { id: string; fresh: number } | null {
  const due = dueOf(groundOf(events, plan));
  return due === null ? null : { id: due.first.id, fresh: due.fresh };
}

/** The repeat the last reading of a harness against the reference bought, where one is due, the
 *  held tasks its first stage did not score, and its untied ones it scores again; null where none
 *  is: a control is never repeated, since the starter winning on new tasks is room by another name.
 *  A reading that is no repeat itself buys one: a step and its repeat are one attempt
 *  (`attemptsOf`, `compare.ts`; `falsePromotion`, `climb.ts`). From 15 October a candidate bought
 *  one, and its later readings on other tasks could promote only with its repeat. The reading is the last of any harness: until 15 October a later checkpoint hid
 *  it, and recode-pr169-sonnet's g-1 step lost its repeat. */
function dueOf(ground: Ground) {
  const { events, plan, reports, reference, starter } = ground;
  const { trigger } = plan.wanted;
  const read = reports.findLast(({ fresh, old }) => old === reference && fresh !== starter);
  const pair = reports.filter(({ fresh, old }) => fresh === read?.fresh && old === read.old);
  const open = attemptsOf(pair, ({ report }) => triggered(report, trigger)).at(-1);
  if (
    read === undefined ||
    open?.length !== 1 ||
    !triggered(read.report, trigger) ||
    twice(ground) !== null
  ) {
    return null;
  }
  const scored = new Set(Array.isArray(read.report.versions) ? read.report.versions : []);
  const { frontier } = poolOf(events);
  const again = untiedOf(read.report).filter((task) => frontier.includes(task));
  return { first: read, again: again.length, fresh: frontier.filter((task) => !scored.has(task)).length };
}

function unfinished(ground: Ground): Move | null {
  const { all } = ground;
  const open = all.find(({ report }) => report === null);
  if (open !== undefined) {
    return {
      move: "compare",
      id: open.id,
      fresh: open.fresh,
      reference: open.old,
      why: `comparison ${open.id} began and has not reported: it goes on from its log`,
    };
  }
  // A reading that clears the trigger buys the repeat, read with it by the next row (`readTwice`).
  // The Examiner writes first only where the repeat could not read a step (`shortBy`): until
  // 16 October it wrote to a target of fresh tasks, about 300 gate solves after a promotion. A
  // session that holds out nothing counts towards the patience (`roomless`).
  const first = dueOf(ground)?.first;
  if (first === undefined) return null;
  const missing = shortBy(ground);
  if (missing > 0) {
    const asked = examine(
      ground,
      "tasks",
      `comparison ${first.id} cleared the trigger, and the campaign is ${plural(missing, "held-out task")} short of a repeat that could read a step: the Examiner writes more first`,
    );
    return asked.move === "examine" ? { ...asked, repeats: first.id } : asked;
  }
  return compare(
    `comparison ${first.id} cleared the trigger, which is one draw: the same two harnesses are compared again on fresh solves, and the two are read together`,
    first.fresh,
    first.id,
  );
}

/** Whether `harness` read a step and its repeat against the reference: the two read together
 *  clear the level (`readTwice`). */
function steppedTwice({ plan, reports, reference }: Ground, harness: string): boolean {
  const pair = reports.flatMap(({ fresh, old, report }) =>
    fresh === harness && old === reference ? [report] : [],
  );
  return harness !== reference && readTwice(pair, plan.wanted.level, plan.wanted.trigger);
}

/**
 * The promotion of the waiting harness, or of an earlier one the campaign owes: a harness that
 * read a step twice against the reference while later sessions left another. The table follows
 * the latest harness, and would pass such a step by: on 9 October one campaign read a step twice,
 * promoted nothing, and the table named a Builder session. The newest such harness is named, and
 * what later sessions left is read against it once it is the reference.
 */
function twice(ground: Ground): Move | null {
  const { reports, reference, waiting } = ground;
  const read = `read a step and its repeat`;
  if (waiting !== null && steppedTwice(ground, waiting)) {
    return { move: "promote", harness: waiting, why: `harness ${short(waiting)} ${read}` };
  }
  const earlier = reports.toReversed().flatMap(({ old, fresh }) => (old === reference ? [fresh] : []));
  const owed = earlier.find((harness) => harness !== waiting && steppedTwice(ground, harness));
  return owed === undefined
    ? null
    : {
        move: "promote",
        harness: owed,
        why: `harness ${short(owed)} ${read}, and was not promoted: what later sessions left is read against it once it is the reference`,
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
 * and submit it. Tasks written since that the gate admits are compared on first (`unread`).
 */
function noRoom(ground: Ground): Move | null {
  const { reports, reference } = ground;
  const last = reports.findLast(({ old, fresh }) => old === reference || fresh === reference);
  if (last === undefined) return null;
  const side = last.old === reference ? "old" : "fresh";
  const room = roomOf(last.report, side);
  if (room === "room" || writtenSince(ground, last)) return null;
  const why =
    room === "too-hard"
      ? `comparison ${last.id} read no step, and neither harness gave a valid answer: other tasks are written`
      : side === "old"
        ? `comparison ${last.id} read no step, and no task was informative for the reference harness: the tasks have to change`
        : `harness ${short(reference ?? "")} is the reference, and comparison ${last.id} found no task informative for it: the tasks have to change, to ones it fails on some solves`;
  return spent(ground, "room", why) ?? { move: "examine", why };
}

/**
 * Tasks, where the gate would refuse the next comparison for want of them, or the pair's last
 * comparison tallied none. On tasks the reference harness answered in every solve a changed harness
 * can only tie again, so the next comparison has to have tasks to untie before a session is worth
 * its cost: on 10 October a comparison read 3-0-2 on 5 tasks, the new harness valid on every
 * solve; two sessions then left it unchanged, and the stop rule ended the campaign where an
 * Examiner session was the move. After a control as much: a simulated climb built three times on a
 * set of which the reference had closed all but two or three, 2-0-6 each time.
 */
function wanting(ground: Ground): Move | null {
  const { refused, read } = ground;
  const lacks = SHORT.find((code) => refused.has(code));
  const written = (why: string) => examine(ground, "tasks", why);
  if (read?.report.reading === "not-scored") {
    const answered = lacks === undefined && writtenSince(ground, read);
    return answered ? null : written(`comparison ${read.id} tallied no task`);
  }
  if (lacks === undefined) return null;
  return written(
    "the campaign holds fewer tasks a step can be read on than a step takes: those the reference harness answered in every solve, and those held out before its promotion that it has stood in no comparison of, are read apart",
  );
}

function unread(ground: Ground): Move | null {
  return heldSince(ground) ?? leftBySessions(ground);
}

/**
 * A comparison on the tasks held out since the last reading, before anything is built: on
 * 10 October a campaign held out four on the supply row, then ran two sessions that left the
 * harness as it was, and stopped before any comparison on them. With a harness waiting it is
 * compared on them; with none but the reference, the starter is, as a control that says whether
 * they leave the reference room before a Builder session is paid for: on 10 October three
 * campaigns built three times on tasks every practice solve passed.
 */
function heldSince({ events, read, reports, waiting, reference, starter }: Ground): Move | null {
  if (waiting === null) {
    const since = heldAfter(events, reports.at(-1)?.reported ?? -1);
    return reference === null || starter === null || reference === starter || since === 0
      ? null
      : compare(
          `harness ${short(reference)} is the reference, and ${plural(since, "task")} ${since === 1 ? "was" : "were"} held out since the last comparison: the starter is compared with it on them, to read whether they leave it room before a Builder session is paid for`,
          "starter",
        );
  }
  if (read === null || heldAfter(events, read.reported) === 0) return null;
  const since = "and tasks were written since";
  if (read.report.reading === "not-scored") return compare(`comparison ${read.id} tallied no task, ${since}`);
  const left = {
    room: `read no step with room to gain, ${since}: harness ${short(waiting)} is compared on them`,
    none: `left no room, ${since}`,
    "too-hard": `left neither harness an answer, ${since}`,
  }[roomOf(read.report)];
  return compare(`comparison ${read.id} ${left}`);
}

/** The whole Builder sessions since the last comparison began, and how many a comparison follows:
 *  one until set-up stands (epoch 0, the first promotion over the starter), since a session's
 *  worth is enough to read against the empty Starter, and the plan's after. */
function sessionsRun({ events, plan, all, reference, starter }: Ground) {
  const after = all.at(-1)?.at ?? -1;
  const run = events.filter(
    (event, at) => event.kind === "build.finished" && at > after && !cutShort(event),
  ).length;
  return { run, needed: reference === starter ? 1 : plan.sessions };
}

/** A comparison of a harness no comparison has read with the reference, once its sessions have run. */
function leftBySessions(ground: Ground): Move | null {
  const { all, waiting, read } = ground;
  if (waiting === null || read !== null) return null;
  // Under a setting no comparison has run in yet, the harness is read there at once.
  if (all.length === 0) {
    return compare(`harness ${short(waiting)} has not been compared under the campaign's setting`);
  }
  const { run, needed } = sessionsRun(ground);
  return run < needed
    ? null
    : compare(`${plural(run, "Builder session")} since the last comparison left harness ${short(waiting)}`);
}

/** Why the Builder builds: what the pair's last reading left, or what is still to run. */
function buildsOn(ground: Ground): string {
  const { read, waiting, reference } = ground;
  if (read?.control === true) {
    return `comparison ${read.id} read the starter against harness ${short(reference ?? "")} on the tasks held out since, and they leave it room: the Builder builds`;
  }
  if (read !== null) {
    return `comparison ${read.id} read no step with room to gain: harness ${short(read.fresh)} did not help`;
  }
  if (waiting === null) return "no session has left a harness that is not the reference harness";
  const { run, needed } = sessionsRun(ground);
  return `${String(run)} of ${plural(needed, "Builder session")} before the next comparison have run`;
}

/**
 * The campaign's ending on its budget where what is left of its total would not hold the move a
 * row named. A comparison the cap cuts before its last solve tallies nothing, and what it billed
 * bought no reading: on 9 October a campaign with $1.45 left began a comparison after one that had
 * billed $1.00, and was cut after $1.06. What a comparison will bill is read from the last one that
 * reported. An Examiner session is a round with the comparison that reads its tasks, and a step
 * read on them is bought again by its repeat: where the last session and that comparison billed
 * more than half of what is left, another round could not be read. Where no comparison has
 * reported, the first is priced by the reference harness's solves of draft tasks (`firstPriced`),
 * and with none of those the move is made; one that began goes on under whatever is left.
 */
function unafforded(ground: Ground, named: Move): Move | null {
  const { events, plan, reports } = ground;
  const last = reports.findLast(({ report }) => report.capped !== true);
  if (plan.left === null) return null;
  const left = plan.left.dollars;
  if (named.move === "compare" && named.id === undefined) {
    const billed = last === undefined ? 0 : billedParts(events, last.id).comparison;
    const was =
      last === undefined
        ? firstPriced(ground)
        : { dollars: billed, said: `comparison ${last.id} billed $${billed.toFixed(2)}` };
    return was === null || left >= was.dollars
      ? null
      : end(
          "budget",
          `$${left.toFixed(2)} of the campaign's budget are left, and ${was.said}: the next would bill about as much, so it would be cut before it reports`,
        );
  }
  if (last === undefined) return null;
  const was = billedParts(events, last.id).comparison;
  const session = events.findLast(({ kind }, at) => kind === "exam.finished" && at < last.reported)?.data;
  if (named.move !== "examine" || session === undefined) return null;
  const round =
    was +
    (isNumber(session.billed) ? session.billed : 0) +
    billedParts(events, isString(session.session) ? session.session : "").comparison;
  return round > left / 2
    ? end(
        "budget",
        `the last Examiner session and comparison ${last.id}, which read its tasks, billed $${round.toFixed(2)}, more than half of the $${left.toFixed(2)} left: another round could not be read`,
      )
    : null;
}

/** What a first comparison would bill, priced by the reference harness's solves of draft tasks
 *  (`try_task`): two harnesses, the tasks it would score, the solves a side. Until 14 October a
 *  campaign with no report was held to nothing, and buffer-149's gate billed about $0.43 a solve.
 *  A gate's `billed` is its `TRIED` solves', the non-results among them included, while its
 *  `solves` counts the readings, so the price is a solve started and not a reading: over readings
 *  alone a gate with a non-result priced the comparison high. Null where no draft was solved. */
function firstPriced({ events, plan }: Ground): { dollars: number; said: string } | null {
  const tried = events.flatMap(({ kind, data }) => {
    const reference = asRecord(data.reference);
    return kind === "task.gate" &&
      isNumber(reference?.billed) &&
      isNumber(reference.solves) &&
      reference.solves > 0
      ? [{ billed: reference.billed }]
      : [];
  });
  const solves = tried.length * TRIED;
  if (solves === 0) return null;
  const each = tried.reduce((sum, { billed }) => sum + billed, 0) / solves;
  const scored = Math.min(plan.wanted.target, taskSets(events).held.length);
  const aside = Number(openingOf(events)?.terms.solves ?? SIZE.solves);
  const dollars = each * 2 * scored * aside;
  return {
    dollars,
    said: `the reference harness's solves of draft tasks billed $${each.toFixed(2)} a solve, so a first comparison of ${plural(scored, "task")} at ${String(aside)} solves a side would bill about $${dollars.toFixed(2)}`,
  };
}

/** Why the table's budget hold would refuse a comparison the Builder asked for where it named
 *  another move, or null (14 October: the holds were asked of the table's own move alone). */
export function unaffordedAsked(events: readonly LogEvent[], plan: Plan): string | null {
  const held = unafforded(groundOf(events, plan), compare("the Builder asked for a comparison"));
  return held?.move === "end" ? held.why : null;
}

/** The tasks released for practice since the reference harness was last promoted, and where: the
 *  practice named is an epoch's. Until 16 October it was the campaign's, and three campaigns
 *  released none after their promotion, where every practice solve passed. */
export function epochReleased(events: readonly LogEvent[]) {
  const promotedAt = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const epoch = events.filter(
    ({ kind, data }, at) => at > promotedAt && kind === "task.state" && data.state === "released",
  ).length;
  return { promotedAt, epoch };
}

/** How many more tasks a release may take for practice, each one fewer to compare: after a
 *  promotion, never leaving fewer frontier tasks than a sweep at `level` takes, since it takes
 *  failed ones first (`releaseOrder`). Until 16 October it was also at most one in four of the
 *  epoch's scorable and released tasks, which bound alone in none of 35 releases on record. */
export function practiceRoom(events: readonly LogEvent[], level: number): number {
  const promotedAt = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  return promotedAt === -1 ? Infinity : Math.max(0, poolOf(events).frontier.length - sweepOf(level));
}

/** A release for practice before a Builder session, where the epoch holds fewer than the campaign
 *  names, tasks were held out since the last release, and it has room (`practiceRoom`): on
 *  9 October two sessions practised on the same two tasks while sixteen more were held. */
function toPractise({ events, plan, supply, read }: Ground, named: Move): Move | null {
  const { practice } = plan;
  const released = events.findLastIndex(
    ({ kind, data }) => kind === "task.state" && data.state === "released",
  );
  // The tasks the setting names to score are no practice, and a release takes half of the rest.
  const scored = events.findLast(({ kind }) => kind === "campaign.setting")?.data.tasks;
  const pool = supply.held - (Array.isArray(scored) ? scored.length : 0);
  const { promotedAt, epoch } = epochReleased(events);
  const room = practiceRoom(events, plan.wanted.level);
  if (
    named.move !== "build" ||
    practice === null ||
    pool < 2 ||
    heldAfter(events, Math.max(released, promotedAt)) === 0
  ) {
    return null;
  }
  // After a control that read room, practice is brought up by as many again: the tasks that leave
  // the reference room are what the Builder has to work on, and the ones it has it passes.
  const again = Math.min(practice, room);
  if (read?.control === true && read.reported > released && roomOf(read.report) !== "none" && again > 0) {
    return {
      move: "prepare",
      practice: supply.released + again,
      why: `comparison ${read.id} read room in the tasks held out since the last release: the ones the reference harness failed are released first, up to ${plural(practice, "more practice task")}, before the Builder builds`,
    };
  }
  const since =
    promotedAt === -1
      ? ", and tasks were held out since the last release"
      : " since the reference harness was last promoted, and tasks were held out since";
  const owed = Math.min(practice - epoch, room);
  return owed <= 0
    ? null
    : {
        move: "prepare",
        ...keyIfDefined("practice", promotedAt === -1 ? undefined : supply.released + owed),
        why: `${String(epoch)} of the ${plural(practice, "practice task")} the campaign names are released${since}: the contract's draw releases more before the Builder builds`,
      };
}

/**
 * Tasks, where the last Builder session left its harness as it was and no practice solve of its
 * failed: it had nothing to work on, which is the supply's fault, so the table does not build
 * again on the same practice. Such a session counts nothing towards the stop (`stopRule`), and a
 * table that built again on it did so three times in every campaign on record. The Examiner is
 * asked for tasks that leave room.
 */
function unshown(ground: Ground, named: Move): Move | null {
  const { events } = ground;
  const at = events.findLastIndex(({ kind }) => kind === "build.finished");
  const finished = events[at];
  if (
    named.move !== "build" ||
    finished === undefined ||
    cutShort(finished) ||
    finished.data.changed !== false
  ) {
    return null;
  }
  const last = finished.data;
  const began = events.findLastIndex(
    (event, index) => index < at && event.kind === "build.started" && event.data.session === last.session,
  );
  const shown = practiceRan(events).some(
    ({ started, ending }) => started > began && started < at && ending?.outcome === "fail",
  );
  // Tasks held out since the session ended are what it lacked: the next rows read them, by a
  // release for practice or a comparison, and not another Examiner session. A simulated climb that
  // asked again here wrote four tasks the starter failed, then three sessions more, and ended
  // `no-room` with none of them read.
  return shown || heldAfter(events, at) > 0
    ? null
    : examine(
        ground,
        "room",
        `Builder session ${isString(last.session) ? last.session : "?"} left its harness as it was, and no practice solve of its failed: it had nothing to work on, so the tasks have to change before another session is paid for`,
      );
}
