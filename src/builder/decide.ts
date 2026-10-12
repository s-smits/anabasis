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
 * log is read. A campaign runs at one budget, the one its setting names; the ladder of shorter
 * budgets it walked until 11 October went with `docs/simplify.md`, package A.
 */
import { unadmitted } from "../kernel/acceptance.ts";
import { readsStepEitherWay, readTwice, triggered } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { billedParts, roomOf } from "../kernel/reports.ts";
import { practiceRan } from "../kernel/solves.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { draftOf } from "../examiner/draft.ts";
import { plural } from "../meta/text.ts";
import { epochsOf } from "./climb.ts";
import { crashedRun, groundOf, type Plan } from "./ground.ts";
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
  // to a comparison's and its repeat's before the first session is paid for.
  { code: "tasks", move: tasks },
  // A comparison that began goes on, and one draw that cleared the trigger is drawn again.
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
  { code: "risk", hold: risked },
  { code: "afford", hold: unafforded },
  { code: "practice", hold: toPractise },
  { code: "unshown", hold: unshown },
];

/** The drafts of an exam the plan gives before the campaign ends on it. */
const DRAFTS = 3;
/** Builder or Examiner sessions in a row the provider failed before the campaign ends on its
 *  environment: as many as drafts, so that a campaign is not built or examined against a dead
 *  provider without end, and no more, since each costs an id and the operator's wait. */
const CRASHES = DRAFTS;
/** The false-promotion chance this epoch past which an attempt waits for an A/A (`risked`). */
const RISK = 0.25;
/** The gate's refusals that are a want of tasks (`refusals`, `admission.ts`). */
const SHORT = ["no-held", "held-short", "untied-short"] as const;

const end = (ending: Ending, why: string): Move => ({ move: "end", ending, why });
/** A comparison of the latest harness, or of the starter as a control, with the reference one. */
const compare = (why: string, fresh: "latest" | "starter" = "latest"): Move => ({
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
    : `harness ${short(harness)} has not read a step and its repeat against the reference harness`;
}

/** The tasks held out after the log's index `after`. */
function heldAfter(events: readonly LogEvent[], after: number): number {
  return events.filter(
    ({ kind, data }, index) => index > after && kind === "task.gate" && data.outcome === "passed",
  ).length;
}

/** Whether the operator left a cause on record after the log's index `after` (`--cause`). */
function causeAfter(events: readonly LogEvent[], after: number): boolean {
  return events.some(
    ({ kind, data }, index) => index > after && kind === "campaign.word" && data.word === "cause",
  );
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
 * does a session whose tasks no comparison has read yet,
 * since it moved the campaign, however few it wrote: on 9 October a campaign ended on three
 * sessions that had written four tasks between them. A session whose tasks a comparison has read
 * is passed over, the comparison being the reading of them, and so is one the provider failed,
 * which was given no chance to write (`crashedRun`).
 *
 * It is the one count that ends a campaign for want of tasks or of room (`spent`). Until
 * 12 October three counted: idle Examiner sessions in a row, which every session that held out a
 * task reset, so esp32-141-m3b examined and read no room five times over and never ended;
 * comparisons of one harness without room; and two no-room readings of a session's tasks.
 */
function roomless({ events, reports, reference }: Ground) {
  const read = Math.max(-1, ...reports.map(({ reported }) => reported));
  const compared = reports.map(({ id, old, report, reported }) => ({
    at: reported,
    id,
    gain: old !== reference || roomOf(report) === "room",
  }));
  const examined = events.flatMap(({ kind, data }, at) => {
    if (kind !== "exam.finished") return [];
    const wrote = Array.isArray(data.held) && data.held.length > 0;
    const passed = wrote ? at < read : data.ended === "crashed";
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
 *  plan's three have not been put. A session that put none, as one its provider failed, counts
 *  as a session, so that a campaign does not draft against a dead provider without end. Where
 *  every session crashed and no draft was put, the ending is the environment's, with what the
 *  last crash said: on 10 October three sessions crashed in one second before any model call
 *  (Claude Code refused to run as root), and the campaign ended on an exam nobody had read. A
 *  session that crashed before it put a draft counts only since the campaign last ended, as the
 *  crashes of `crashedRun` do, so that a campaign run again once the provider is back can go on.
 *  The drafts put count over the whole log. */
function drafting(events: readonly LogEvent[]): Move {
  const since = events.findLastIndex(({ kind }) => kind === "campaign.ended");
  const put = ({ tries }: LogEvent["data"]) => (isNumber(tries) ? tries : 0);
  const sessions = events.filter(
    ({ kind, data }, at) =>
      kind === "draft.finished" && (at > since || data.ended !== "crashed" || put(data) > 0),
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
  const crash = sessions.at(-1)?.data.crash;
  return tries === 0 && sessions.every(({ data }) => data.ended === "crashed") && isString(crash)
    ? end(
        "environment",
        `no draft was put: the Examiner's session crashed ${String(sessions.length)} times (${crash})`,
      )
    : end(
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
  if (control === undefined || causeAfter(events, control.reported)) return null;
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
  // Before its first comparison a campaign holds a comparison's tasks and a repeat's, written
  // before the first session is paid for, so that the release before it has them to draw practice
  // from and the Examiner is not on the critical path between the session and the comparison:
  // campaigns that built first on three practice tasks cleared them in three to five harness
  // versions, and then waited on an Examiner session. The repeat takes the tasks its first stage
  // did not score first (`scoredSet`): a first comparison held to one target left none, and on
  // 12 October a repeat re-scored the versions its first stage had scored. A repeat's draw buys no
  // power (0.51 against 0.52 in the overhaul plan's simulation, section 4b): it is held against
  // reusing one test set across attempts. It is a wish and no refusal of the gate's, which admits
  // a comparison by hand on fewer.
  const target = 2 * plan.wanted.target;
  if (all.length > 0 || supply.held >= target) return null;
  const before =
    waiting === null
      ? "no comparison has run yet"
      : `harness ${short(waiting)} has not been compared under the campaign's setting`;
  return examine(
    ground,
    "tasks",
    `the campaign holds ${String(supply.held)} of the ${plural(target, "task")} a comparison and its repeat score, and ${before}: the Examiner writes more first`,
  );
}

function unfinished(ground: Ground): Move | null {
  const { all, read, plan } = ground;
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
  // A reading that clears the trigger buys the repeat and promotes nothing: the two are then read
  // together (`readTwice`), which the next row does. A control is never repeated: the starter
  // winning on new tasks is room by another name.
  const bought = read !== null && !read.control && triggered(read.report, plan.wanted.trigger);
  return bought && twice(ground) === null
    ? compare(
        `comparison ${read.id} cleared the trigger, which is one draw: the same two harnesses are compared again on fresh solves, and the two are read together`,
      )
    : null;
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
  return spent(ground, "room", why) ?? dear(ground, last) ?? { move: "examine", why };
}

/** The campaign's ending on its budget where the last Examiner session and `last`, the comparison
 *  that read its tasks and found no room, billed more than half of what is left: another round
 *  could not be read. Null otherwise. */
function dear({ events, plan, reports }: Ground, last: Reading): Move | null {
  if (plan.left === null) return null;
  const before = Math.max(
    -1,
    ...reports.flatMap(({ reported }) => (reported < last.reported ? [reported] : [])),
  );
  const session = events.findLast(
    ({ kind }, at) => kind === "exam.finished" && at > before && at < last.reported,
  )?.data;
  if (session === undefined) return null;
  const examined =
    (isNumber(session.billed) ? session.billed : 0) +
    billedParts(events, isString(session.session) ? session.session : "").comparison;
  const round = examined + billedParts(events, last.id).comparison;
  return round > plan.left.dollars / 2
    ? end(
        "budget",
        `the last Examiner session and comparison ${last.id}, which read its tasks and found no room, billed $${round.toFixed(2)}, more than half of the $${plan.left.dollars.toFixed(2)} left: another round could not be read`,
      )
    : null;
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
  const { refused, read, reference } = ground;
  const lacks = SHORT.find((code) => refused.has(code));
  const written = (why: string) => examine(ground, "tasks", why);
  if (read?.report.reading === "not-scored") {
    const answered = lacks === undefined && writtenSince(ground, read);
    return answered ? null : written(`comparison ${read.id} tallied no task`);
  }
  if (lacks === undefined) return null;
  if (lacks !== "untied-short") return written("the campaign holds fewer tasks to score than a step takes");
  if (read === null) return written("the last comparison left too few tasks for the next to untie");
  return written(
    read.control
      ? `comparison ${read.id} read the starter against harness ${short(reference ?? "")} with room, and left too few tasks for the next comparison to untie: harness ${short(reference ?? "")} answered the rest in every solve`
      : `comparison ${read.id} read no step with room to gain and left too few tasks for the next to untie: harness ${short(read.fresh)} can only tie again on the tasks the reference harness answered in every solve`,
  );
}

function unread(ground: Ground): Move | null {
  return owedReading(ground) ?? heldSince(ground) ?? leftBySessions(ground);
}

/**
 * A reading a promotion owes (the overhaul plan's P3, as ruled on 12 October). The first harness
 * promoted over the empty Starter is set-up, epoch 0, and the climb counts from it (`epochLine`).
 * A promoted harness that installed programs has them read alone against it (`programs-of`): what
 * its guide and tools add to them, and at epoch 0 what the first win was. After each later
 * promotion the Starter is read against the new reference once, the lower control and never the
 * reference (`starter_share`). A reading and never a gate. Null where none is owed.
 */
function owedReading({ events, all, reference, starter }: Ground): Move | null {
  const at = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  if (at === -1 || reference === null || reference === starter) return null;
  const since = all.filter((each) => each.at > at);
  if (events[at]?.data.programs === true && !since.some(({ fresh }) => fresh === reference)) {
    return {
      move: "compare",
      fresh: "promoted",
      reference: "programs-of:promoted",
      why: `harness ${short(reference)} was promoted with programs it installed: they are read alone against it, for what its guide and tools add to them`,
    };
  }
  const later = events.slice(0, at).some(({ kind }) => kind === "harness.promoted");
  return later && !since.some(({ fresh, old }) => fresh === starter && old === reference)
    ? compare(
        `harness ${short(reference)} is this epoch's reference: the starter is read against it once, as the lower control`,
        "starter",
      )
    : null;
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
 *  one until set-up stands (epoch 0, `owedReading`), since a session's worth is enough to read
 *  against the empty Starter, and the plan's after. */
function sessionsRun({ events, plan, all, reference, starter }: Ground) {
  const after = all.at(-1)?.at ?? -1;
  const run = events.filter(
    ({ kind, data }, at) =>
      kind === "build.finished" && at > after && data.ended !== "killed" && data.ended !== "crashed",
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
 * An attempt refused past a false-promotion chance of a quarter this epoch (the overhaul plan's
 * M2.5): P4's union bound over the attempts under the reference, indicative or not
 * (`falsePromotion`, `climb.ts`), until an A/A has run since the last report, which a comparison of
 * four solves a side carries, or the operator leaves a cause (`--cause`). It is no refusal of the
 * gate's, since its remedy is itself a comparison by hand (`tools/d2/checkpoint.ts --noise`).
 */
function risked({ events, reports }: Ground, named: Move): Move | null {
  if (named.move !== "compare" || named.id !== undefined || named.fresh !== "latest") return null;
  const risk = epochsOf(events).at(-1)?.falsePromotion;
  const last = reports.at(-1);
  if (risk === undefined || last === undefined || risk.union <= RISK) return null;
  return asRecord(last.report.noise) !== null || causeAfter(events, last.reported)
    ? null
    : end(
        "control",
        `a false promotion is at most ${String(Math.round(100 * risk.union))}% over ${plural(risk.attempts, "attempt")} under this reference, past a quarter, and comparison ${last.id} read no A/A: run one (tools/d2/checkpoint.ts --noise), or leave the cause with tools/d2/word.ts --cause, and the campaign goes on when run again`,
      );
}

/**
 * The campaign's ending on its budget where what is left of its total would not hold the
 * comparison a row named. A comparison the cap cuts before its last solve tallies nothing, and
 * what it billed bought no reading: on 9 October a campaign with $1.45 left began a comparison
 * after one that had billed $1.00, and was cut after $1.06. What a comparison will bill is read
 * from the last one that reported, by the sides each solves: two, and three where the operator
 * read the reference against itself (`--noise`, a checkpoint). Where no comparison has reported,
 * nothing says what one bills, and it starts; one that began goes on under whatever is left.
 */
function unafforded({ events, plan, reports }: Ground, named: Move): Move | null {
  const last = reports.findLast(({ report }) => report.capped !== true);
  if (named.move !== "compare" || named.id !== undefined || plan.left === null || last === undefined) {
    return null;
  }
  const sides = last.noise ? 3 : 2;
  const was = billedParts(events, last.id).comparison;
  const expected = (was * 2) / sides;
  return plan.left.dollars >= expected
    ? null
    : end(
        "budget",
        `$${plan.left.dollars.toFixed(2)} of the campaign's budget are left, and comparison ${last.id} billed $${was.toFixed(2)} for ${String(sides)} sides: the next solves 2 and would bill about $${expected.toFixed(2)}, so it would be cut before it reports`,
      );
}

/**
 * A release for practice before a Builder session, where the campaign holds fewer practice tasks
 * than it names and tasks were held out since the last release. One release takes at most half of
 * what is held (`tools/d2/prepare.ts`), so a campaign that opens on a few tasks releases fewer
 * than it names. On 9 October a campaign that named three practice tasks released two of its five
 * examples and held out sixteen more tasks: without a later release both its Builder sessions
 * practised on the same two, and the second spent two of its six practice solves. The draw is the
 * contract's, and no solve chooses a task.
 */
function toPractise({ events, plan, supply, read }: Ground, named: Move): Move | null {
  const { practice } = plan;
  const released = events.findLastIndex(
    ({ kind, data }) => kind === "task.state" && data.state === "released",
  );
  // The tasks the setting names to score are no practice, and a release takes half of the rest.
  const scored = events.findLast(({ kind }) => kind === "campaign.setting")?.data.tasks;
  const pool = supply.held - (Array.isArray(scored) ? scored.length : 0);
  if (named.move !== "build" || practice === null || pool < 2 || heldAfter(events, released) === 0) {
    return null;
  }
  // After a control that read room, practice is brought up by as many again: the tasks that leave
  // the reference room are what the Builder has to work on, and the ones it has it passes.
  if (read?.control === true && read.reported > released && roomOf(read.report) !== "none") {
    return {
      move: "prepare",
      practice: supply.released + practice,
      why: `comparison ${read.id} read room in the tasks held out since the last release: the ones the reference harness failed are released first, up to ${plural(practice, "more practice task")}, before the Builder builds`,
    };
  }
  return supply.released >= practice
    ? null
    : {
        move: "prepare",
        why: `${String(supply.released)} of the ${plural(practice, "practice task")} the campaign names are released, and tasks were held out since the last release: the contract's draw releases more before the Builder builds`,
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
  const last = events[at]?.data;
  const whole = last !== undefined && last.ended !== "killed" && last.ended !== "crashed";
  if (named.move !== "build" || !whole || last.changed !== false) return null;
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
