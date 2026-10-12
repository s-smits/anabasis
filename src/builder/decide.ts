/**
 * Move 7 of a campaign: the one move that follows from its log.
 *
 * A campaign is a loop of moves over one log (`docs/plan.md`, "The process"): the exam is read,
 * tasks are written, a Builder builds, two harnesses are compared, and then something has to say
 * what comes next. This is the plan's decision table as one function: it takes the log and the
 * campaign's plan and returns one move with its reason, or an ending. It decides which move, and
 * nothing of a move's content: what a harness holds, what a task asks and how it is solved stay a
 * model's. Its rows are asked of one reading of the log, made once (`groundOf`, `ground.ts`).
 *
 * The order it asks in:
 *
 * 0. The operator's word: a stop ends the campaign, and a word for other tasks has them written.
 * 1. The exam: drafted where the campaign opened from a prompt (three drafts at most), read where
 *    nobody has read it, and the campaign ends where a reading holds a fault nobody froze. It is
 *    read again where the operator's command admits a check the last reading did not.
 * 2. The tasks: a pack's taken in, practice released, and some written where there are none.
 * 3. The budget, where less is left than one solve is held at, or than the next comparison would
 *    bill; then the provider, where `CRASHES` sessions in a row crashed (an environment ending, to
 *    go on from when run again); and the stop rule, unless the operator said to go on.
 * 4. A comparison that began goes on. Then the control: where the epoch's first A/A read the
 *    reference against itself as a step either way, the campaign ends on its control until the
 *    operator leaves the cause on record (`--cause`, `tools/d2/word.ts`), never a wait.
 * 5. A reading a promotion owes (`owedReading`): a promoted harness's programs alone against it,
 *    and the Starter once against each epoch's reference after set-up (epoch 0, 12 October).
 * 6. The reference's room on the tasks, read from the last comparison it was in: where no task was
 *    informative for it, the tasks change, and a comparison against it says whether they do.
 * 7. A step. A reading under the trigger is one draw, and the same two harnesses are compared
 *    again; the two read together clear the level (`readTwice`), and the harness is promoted.
 * 8. No step. Where the reference had no room, or neither harness answered, the tasks change: an
 *    Examiner session, until the campaign's patience of them held out nothing, two comparisons in
 *    a row read the tasks sessions held out and left none, or the last such round billed more than
 *    half of what is left (`roomEnd`). With room, the harness did not help, and the Builder builds.
 * 9. Nothing new to compare: the Builder builds, once the campaign holds as many scorable tasks as
 *    a comparison scores (before its first a repeat's as well). Something new is compared once the
 *    sessions before a comparison have run (one before set-up stands, the plan's after), or tasks
 *    are written where it would be short of them.
 * 10. Before a Builder session, practice is brought towards the campaign's count where tasks were
 *    held out since the last release, and again after a control that read room.
 * 11. No harness but the reference, and tasks held out since the last comparison: a control, the
 *    starter compared with the reference on them, before a Builder session is paid for. On 10
 *    October three campaigns built three times on tasks every practice solve passed.
 * 12. An attempt past a false-promotion chance of a quarter this epoch waits for an A/A
 *    (`riskRefused`), and a comparison the budget would cut is not begun (`afforded`).
 *
 * A setting is recorded once (`campaign.setting`) and does not change, so every comparison of the
 * log is read. A campaign runs at one budget, the one its setting names; the ladder of shorter
 * budgets it walked until 11 October went with `docs/simplify.md`, package A.
 */
import { unadmitted } from "../kernel/acceptance.ts";
import { flipP, readTwice, triggered } from "../kernel/compare.ts";
import type { LogEvent } from "../kernel/log.ts";
import { billedParts, roomOf } from "../kernel/reports.ts";
import { practiceRan } from "../kernel/solves.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { draftOf } from "../examiner/draft.ts";
import { plural } from "../meta/text.ts";
import { supplyOf } from "./admission.ts";
import { epochsOf } from "./climb.ts";
import { type Compared, crashedRun, type Ground, groundOf, idleDrafts, pairOf, type Plan } from "./ground.ts";
import { build, compare, type Decided, end, type Fresh, rowAt, rowed, short, STEP } from "./move.ts";
import { pendingWords } from "./word.ts";

/** The drafts of an exam the plan gives before the campaign ends on it. The other two bounds,
 *  Examiner sessions in a row that held out no task and comparisons of one harness that left no
 *  room, are the campaign's patience (`plan.patience`, `PATIENCE`), as the stop rule's is. */
const DRAFTS = 3;
/** Builder or Examiner sessions in a row the provider failed before the campaign ends on its
 *  environment: as many as drafts, so that a campaign is not built or examined against a dead
 *  provider without end, and no more, since each costs an id and the operator's wait. */
const CRASHES = DRAFTS;
const SETTING = "campaign.setting";
/** No-room readings in a row that end the campaign `no-room` (the overhaul plan's section 4a,
 *  research 04): each is an Examiner session's tasks read by a comparison that left the reference
 *  none, so a second says the Examiner cannot make room for this reference. */
const ROOMLESS = 2;
const ROOM = "room";
const PROMOTED = "promoted";
/** The false-promotion chance this epoch past which an attempt waits for an A/A (`riskRefused`). */
const RISK = 0.25;
/** What an Examiner session's reason adds where the tasks written since the comparison are too
 *  few yet: without it two sessions in a row give one reason, as the first campaign's did. */
const fewYet = (since: number): string =>
  since === 0
    ? ""
    : `. The ${plural(since, "task")} written since ${since === 1 ? "is" : "are"} too few yet for a comparison to read a step on`;

/** Tasks, for the reason `why`, where a comparison is short of them: for room where the reference
 *  harness passes nearly all, as the table has it. */
function supplied(ground: Ground, last: JsonObject | undefined, why: string): Decided {
  const none = last !== undefined && roomOf(last) === "none";
  if (none) {
    const over = roomEnd(ground);
    if (over !== null) return over;
  }
  return written(ground.drafts, none ? "room" : "tasks", { move: "examine", why }, ground.plan.patience);
}

/**
 * The comparisons in a row, up to the last that reported, that read tasks an Examiner session held
 * out since the reading before and left the reference none (`roomOf` on its side): each an answer to
 * "the tasks have to change" read and found wanting. A comparison against another reference, one on
 * no new task, or one with room ends the run. Until 12 October the bound was Examiner sessions in a
 * row that held out nothing (`idleDrafts`), which every session that held out a task reset, so
 * esp32-141-m3b examined and read no room five times over and never ended.
 */
function roomless({ events, all, reference, starter }: Ground): Compared[] {
  const against = reference ?? starter;
  const read = all.filter(({ report, reported }) => report !== null && reported !== null);
  const found = read.map(({ old, fresh, report, reported }, at) => {
    const side = old === against ? "old" : fresh === against ? "fresh" : null;
    const before = read[at - 1]?.reported ?? -1;
    const wrote = events.some(
      ({ kind, data }, index) =>
        index > before &&
        index < (reported ?? 0) &&
        kind === "exam.finished" &&
        Array.isArray(data.held) &&
        data.held.length > 0,
    );
    return side !== null && wrote && report !== null && roomOf(report, side) === "none";
  });
  return read.slice(found.lastIndexOf(false) + 1);
}

/**
 * The campaign's ending where the tasks cannot be made to leave room: `no-room` at `ROOMLESS` such
 * readings in a row, and `budget` where the last Examiner session and the comparison that read its
 * tasks billed more than half of what is left, so another round could not be read. Null otherwise.
 */
function roomEnd(ground: Ground): Decided | null {
  const { events, plan } = ground;
  const run = roomless(ground);
  const last = run.at(-1);
  if (last === undefined) return null;
  if (run.length >= ROOMLESS) {
    return end(
      "no-room",
      `${plural(run.length, "comparison")} in a row (${run.map(({ id }) => id).join(", ")}) read the tasks an Examiner session held out and left the reference none: the tasks could not be made to leave room`,
    );
  }
  if (plan.left == null) return null;
  const exam = events.findLast(
    ({ kind }, index) => kind === "exam.finished" && index < (last.reported ?? 0),
  )?.data;
  const session = isString(exam?.session) ? exam.session : "";
  const examined = (isNumber(exam?.billed) ? exam.billed : 0) + billedParts(events, session).comparison;
  const round = examined + billedParts(events, last.id).comparison;
  if (round <= plan.left.dollars / 2) return null;
  return end(
    "budget",
    `the last Examiner session and comparison ${last.id}, which read its tasks and found no room, billed $${round.toFixed(2)}, more than half of the $${plan.left.dollars.toFixed(2)} left: another round could not be read`,
  );
}

/** An Examiner session, unless as many in a row as the campaign's patience have already held out
 *  no task. Then the campaign ends: on its exam where it wants for tasks, which could not be
 *  written, and on its room where the tasks it has leave none. */
function written(drafts: number, wants: "tasks" | "room", examine: Decided, patience: number): Decided {
  if (drafts < patience) return examine;
  const sessions = `${plural(drafts, "Examiner session")} in a row held out no task (${examine.why})`;
  return wants === "tasks"
    ? end("exam", `${sessions}: the tasks could not be written`)
    : end("no-room", `${sessions}: the tasks could not be made to leave room`);
}

/** The move that follows from the log, with the row that chose it (`rowed`, `move.ts`). */
export function decide(events: readonly LogEvent[], plan: Plan): Decided {
  return rowed(table(events, plan));
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
function drafting(events: readonly LogEvent[]): Decided {
  const since = events.findLastIndex(({ kind }) => kind === "campaign.ended");
  const sessions = events.filter(
    ({ kind, data }, at) =>
      kind === "draft.finished" &&
      (at > since || data.ended !== "crashed" || (isNumber(data.tries) && data.tries > 0)),
  );
  const tries = sessions.reduce((sum, { data }) => sum + (isNumber(data.tries) ? data.tries : 0), 0);
  if (tries >= DRAFTS || sessions.length >= DRAFTS) {
    const crash = sessions.at(-1)?.data.crash;
    if (tries === 0 && sessions.every(({ data }) => data.ended === "crashed") && isString(crash)) {
      return end(
        "environment",
        `no draft was put: the Examiner's session crashed ${String(sessions.length)} times (${crash})`,
      );
    }
    return end(
      "exam",
      `the exam was not accepted: ${plural(tries, "draft")} in ${plural(sessions.length, "session")} did not stand at the host's reading`,
    );
  }
  return {
    move: "draft",
    why:
      tries === 0
        ? "the campaign opened from a prompt and holds no exam: the Examiner drafts its rules, its checks and its first tasks"
        : `${plural(tries, "draft")} did not stand at the host's reading, and ${String(DRAFTS - tries)} more may be put`,
  };
}

/** The plan's decision table over a campaign's log: the next move, or the campaign's ending. */
function table(events: readonly LogEvent[], plan: Plan): Decided {
  const words = pendingWords(events);
  const stop = words.find(({ word }) => word === "stop");
  if (stop !== undefined) {
    return {
      move: "end",
      ending: "operator",
      why: `the operator's word${stop.why === "" ? "" : `: ${stop.why}`}`,
      // Every word left before the stop is answered by it: the campaign has stopped.
      answers: words.filter(({ at }) => at <= stop.at).map(({ at }) => at),
    };
  }
  if (plan.prompted === true && draftOf(events) === null) return drafting(events);
  const supply = supplyOf(events);
  if (supply.faults === null) {
    return {
      move: "accept",
      why: "nobody has read the campaign's checker: every control and the do-nothing answer are put to the checks before a solve is paid for",
    };
  }
  if (supply.faults > 0 && !supply.frozen) {
    // A check its author's own computation decides stands on the operator's word, given by name.
    // Where this command gives it for a check the last reading did not hold admitted, the exam is
    // read again with it.
    const kept = events.findLast(({ kind }) => kind === "checker.read")?.data.admitted;
    const admitted = Array.isArray(kept) ? kept : [];
    const more = (plan.admits ?? []).filter((id) => !admitted.includes(id));
    if (more.length > 0) {
      return { move: "accept", why: `the operator admits ${more.join(", ")}: the exam is read again` };
    }
    // The checks no engine decides are named, so that a log whose campaign ran unattended says
    // what the operator's word is wanted for: a drafted exam's checks all, since none runs one.
    const waiting = unadmitted(events);
    return end(
      "exam",
      `the checker's last reading holds ${plural(supply.faults, "fault")} and nobody froze it: the exam is not accepted until its author repairs it, or the operator admits each check by name and freezes (tools/c/accept.ts)${waiting.length === 0 ? "" : `. No engine the host installed decides ${waiting.join(", ")}, so each stands on the operator's word alone: --admit ${waiting.join(",")}`}`,
    );
  }
  if (plan.unprepared) {
    return {
      move: "prepare",
      why: "the pack holds tasks the log does not: each is put to its gate and held out",
    };
  }
  const { left } = plan;
  if (left != null && left.dollars < left.reserve) {
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
  if (supply.held + supply.awaiting + supply.exhausted + supply.released === 0) {
    return written(
      idleDrafts(events),
      "tasks",
      { move: "examine", why: "the campaign holds no task" },
      plan.patience,
    );
  }
  if (supply.released === 0 && supply.held >= 2) {
    return { move: "prepare", why: "no task is released for practice: the contract's draw releases some" };
  }
  // Other tasks on the operator's word, once the campaign has an exam to write them against.
  const asked = words.find(({ word }) => word === "tasks");
  if (asked !== undefined) {
    return {
      move: "examine",
      why: `the operator asked for other tasks${asked.why === "" ? "" : `: ${asked.why}`}`,
      answers: [asked.at],
    };
  }
  if (supply.stop.stop && plan.pastStop === undefined) {
    return end(
      "stop",
      `${plural(supply.stop.sinceStep, "move")} in a row could have shown a gain and showed none: the campaign's patience is ${String(plan.patience)}`,
    );
  }
  const ground = groundOf(events, plan);
  const open = ground.all.find(({ report }) => report === null);
  if (open !== undefined) {
    return {
      move: "compare",
      id: open.id,
      fresh: open.fresh,
      reference: open.old,
      why: `comparison ${open.id} began and has not reported: it goes on from its log`,
    };
  }
  const control = controlled(ground);
  if (control !== null) return end("control", control);
  const next =
    rowAt(5, owedReading(ground)) ??
    rowAt(6, afterPromotion(ground)) ??
    rowAt(7, onStep(ground) ?? owed(ground)) ??
    rowAt(8, onLatest(ground));
  if (next.move === "compare") {
    const paid = afforded(ground, next);
    return rowAt(12, riskRefused(ground, next)) ?? (paid === next ? next : rowAt(12, paid));
  }
  if (next.move !== "build") return next;
  return rowAt(10, toPractise(ground, supply)) ?? rowAt(9, unshown(ground)) ?? next;
}

/**
 * An attempt refused past a false-promotion chance of a quarter this epoch (the overhaul plan's
 * M2.5): P4's union bound over the attempts under the reference, indicative or not
 * (`falsePromotion`, `climb.ts`), until an A/A has run since the last report, which a comparison of
 * four solves a side carries, or the operator leaves a cause (`--cause`). Null where it goes on.
 */
function riskRefused(ground: Ground, next: Extract<Decided, { move: "compare" }>): Decided | null {
  const { events, all } = ground;
  const risk = epochsOf(events).at(-1)?.falsePromotion;
  const last = all.findLast(({ reported }) => reported !== null);
  const at = last?.reported ?? Number.POSITIVE_INFINITY;
  const heard = events.some(
    ({ kind, data }, index) => index > at && kind === "campaign.word" && data.word === "cause",
  );
  const unsafe = risk !== undefined && risk.union > RISK && last !== undefined;
  if (next.fresh !== "latest" || !unsafe || heard || asRecord(last.report?.noise) !== null) return null;
  return end(
    "control",
    `a false promotion is at most ${String(Math.round(100 * risk.union))}% over ${plural(risk.attempts, "attempt")} under this reference, past a quarter, and comparison ${last.id} read no A/A: run one (tools/d2/checkpoint.ts --noise), or leave the cause with tools/d2/word.ts --cause, and the campaign goes on when run again`,
  );
}

/**
 * Why the campaign ends on its control, or null. The control is the epoch's first A/A, the
 * reference read against itself beside the first comparison against it that carries one
 * (`comparison.ts`). Read two-sided at that comparison's level, since which half is which is
 * arbitrary, it reads a step at most as often as the level; a step there is false by
 * construction, so what it measures is the comparison and not either harness: the host, the
 * provider or the solver moved between halves of one harness's solves. It holds until the
 * operator leaves a cause after its report (`--cause`). The A/As after it stand as readings, and
 * the climb reads them for its false promotion (`climb.ts`).
 */
function controlled({ events, all, reference, starter }: Ground): string | null {
  const control = all.find(
    ({ old, report }) =>
      old === (reference ?? starter) && Array.isArray(asRecord(report?.noise)?.differences),
  );
  if (control?.report == null || control.reported === null) return null;
  const apart = asRecord(control.report.noise)?.differences;
  const differences = Array.isArray(apart) ? apart.filter(isNumber) : [];
  const level = isNumber(control.report.level) ? control.report.level : 0;
  const stepped = 2 * Math.min(flipP(differences), flipP(differences.map((one) => -one))) <= level;
  const after = control.reported;
  const heard = events.some(
    ({ kind, data }, at) => at > after && kind === "campaign.word" && data.word === "cause",
  );
  return stepped && !heard
    ? `comparison ${control.id} read the reference against itself as a step, so its two sides are not interchangeable and no comparison against it reads anything until the cause is on record: leave it with tools/d2/word.ts --cause "<the cause>", and the campaign goes on when run again`
    : null;
}

/**
 * Tasks, where the last Builder session left its harness as it was and no practice solve of its
 * failed: it had nothing to work on, which is the supply's fault, so the table does not build
 * again on the same practice. Such a session counts nothing towards the stop (`stopRule`), and a
 * table that built again on it did so three times in every campaign on record. The Examiner is
 * asked for tasks that leave room, bounded by the campaign's patience as every Examiner session is
 * (`written`).
 */
function unshown(ground: Ground): Decided | null {
  const { events, plan } = ground;
  const at = events.findLastIndex(({ kind }) => kind === "build.finished");
  const last = events[at]?.data;
  if (last === undefined || last.changed !== false || last.ended === "killed" || last.ended === "crashed") {
    return null;
  }
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
  if (shown || heldSince(events, at) > 0) return null;
  return written(
    ground.drafts,
    "room",
    {
      move: "examine",
      why: `Builder session ${isString(last.session) ? last.session : "?"} left its harness as it was, and no practice solve of its failed: it had nothing to work on, so the tasks have to change before another session is paid for`,
    },
    plan.patience,
  );
}

/**
 * A release for practice before a Builder session, where the campaign holds fewer practice tasks
 * than it names and tasks were held out since the last release. One release takes at most half of
 * what is held (`tools/d2/prepare.ts`), so a campaign that opens on a few tasks releases fewer
 * than it names. On 9 October a campaign that named three practice tasks released two of its five
 * examples and held out sixteen more tasks: without a later release both its Builder sessions
 * practised on the same two, and the second spent two of its six practice solves. The draw is the
 * contract's, and no solve chooses a task. Null where nothing is to release.
 */
function toPractise(ground: Ground, supply: ReturnType<typeof supplyOf>): Decided | null {
  const { events, plan, all, starter, reference } = ground;
  const { practice } = plan;
  const last = events.findLastIndex(({ kind, data }) => kind === "task.state" && data.state === "released");
  const since = heldSince(events, last) > 0;
  // The tasks the setting names to score are no practice, and a release takes half of the rest.
  const named = events.findLast(({ kind }) => kind === SETTING)?.data.tasks;
  const pool = supply.held - (Array.isArray(named) ? named.length : 0);
  if (practice === undefined || !since || pool < 2) return null;
  // After a control that read room, practice is brought up by as many again: the tasks that leave
  // the reference room are what the Builder has to work on, and the ones it has it passes.
  const read = all.findLast(({ report }) => report !== null);
  const refreshed =
    read !== undefined &&
    read.report !== null &&
    read.fresh === starter &&
    read.old === reference &&
    read.reported !== null &&
    read.reported > last &&
    roomOf(read.report) !== "none";
  if (supply.released >= practice && !refreshed) return null;
  if (refreshed) {
    return {
      move: "prepare",
      practice: supply.released + practice,
      why: `comparison ${read.id} read room in the tasks held out since the last release: the ones the reference harness failed are released first, up to ${plural(practice, "more practice task")}, before the Builder builds`,
    };
  }
  return {
    move: "prepare",
    why: `${String(supply.released)} of the ${plural(practice, "practice task")} the campaign names are released, and tasks were held out since the last release: the contract's draw releases more before the Builder builds`,
  };
}

/**
 * A comparison, where what is left of the campaign's total holds one, and else the campaign's
 * ending on its budget. A comparison the cap cuts before its last solve tallies nothing, and what
 * it billed bought no reading: on 9 October a campaign with $1.45 left began a comparison after one
 * that had billed $1.00, and was cut after $1.06. What a comparison will bill is read from the last one that reported, by the
 * sides each solves: two, and three where the operator read the reference against itself. Where
 * no comparison has reported, nothing says what one bills, and it starts.
 */
function afforded(ground: Ground, next: Extract<Decided, { move: "compare" }>): Decided {
  const { events, plan, all } = ground;
  const last = all.findLast(({ report }) => report !== null && report.capped !== true);
  if (plan.left == null || last === undefined) return next;
  // A comparison the operator asked for with the reference against itself (`--noise`, a
  // checkpoint) solved three sides, and the table's next solves two.
  const sides = (noise: boolean): number => (noise ? 3 : 2);
  const was = billedParts(events, last.id).comparison;
  const expected = (was * 2) / sides(last.noise);
  if (plan.left.dollars >= expected) return next;
  return end(
    "budget",
    `$${plan.left.dollars.toFixed(2)} of the campaign's budget are left, and comparison ${last.id} billed $${was.toFixed(2)} for ${String(sides(last.noise))} sides: the next solves 2 and would bill about $${expected.toFixed(2)}, so it would be cut before it reports`,
  );
}

/**
 * A promotion the campaign owes: a harness that read a step twice against the reference harness,
 * and is to be promoted by the rule, while later sessions left another. The table follows the
 * latest harness, and would pass such a step by: on 9 October one campaign read a step twice,
 * promoted nothing, and the table named a Builder session. The newest such harness is named, and
 * what later sessions left is read against it once it is the reference.
 */
function owed(ground: Ground): Decided | null {
  const { all, reference, latest } = ground;
  const earlier = new Set(
    all.toReversed().flatMap(({ old, fresh }) => (old === reference && fresh !== latest ? [fresh] : [])),
  );
  for (const harness of earlier) {
    const step = onStep({ ...ground, latest: harness });
    if (step?.move === "promote") {
      return {
        ...step,
        why: `${step.why}, and was not promoted: what later sessions left is read against it once it is the reference`,
      };
    }
  }
  return null;
}

/**
 * Why the plan would not promote `harness` on this log now, or null where it would: a step is
 * promoted once it and its repeat, read together, clear the level (`readTwice`). It is the rule
 * move 7 promotes by (`onStep`), asked for a harness the operator names (`tools/d2/promote.ts`).
 */
export function unpromoted(events: readonly LogEvent[], plan: Plan, harness: string): string | null {
  const step = onStep({ ...groundOf(events, plan), latest: harness });
  if (step?.move === "promote") return null;
  return step === null
    ? `harness ${short(harness)} has not read a step and its repeat against the reference harness`
    : step.why;
}

/**
 * A reading a promotion owes (the overhaul plan's P3, as ruled on 12 October). The first harness
 * promoted over the empty Starter is set-up, epoch 0, and the climb counts from it (`epochLine`).
 * A promoted harness that installed programs has them read alone against it (`programs-of`): what
 * its guide and tools add to them, and at epoch 0 what the first win was. After each later
 * promotion the Starter is read against the new reference once, the lower control and never the
 * reference (`starter_share`). A reading and never a gate. Null where none is owed.
 */
function owedReading(ground: Ground): Decided | null {
  const { events, all, reference, starter } = ground;
  const at = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  if (at === -1 || reference === null || reference === starter) return null;
  const since = all.filter((each) => each.at > at);
  if (events[at]?.data.programs === true && !since.some(({ fresh }) => fresh === reference)) {
    const why = `harness ${short(reference)} was promoted with programs it installed: they are read alone against it, for what its guide and tools add to them`;
    return (
      toTarget(ground, why) ?? { move: "compare", fresh: PROMOTED, reference: `programs-of:${PROMOTED}`, why }
    );
  }
  const later = events.slice(0, at).some(({ kind }) => kind === "harness.promoted");
  if (!later || since.some(({ fresh, old }) => fresh === starter && old === reference)) return null;
  const why = `harness ${short(reference)} is this epoch's reference: the starter is read against it once, as the lower control`;
  return toTarget(ground, why) ?? compare(why, "starter");
}

/**
 * The tasks change where the harness now the reference answered nearly all of them: its room is
 * read from the last comparison it was in, whichever side it took (`roomOf`), until a comparison
 * against it as the reference reads the tasks again or tasks are held out since. A harness is
 * promoted on a comparison it won, so the tasks it was promoted on mostly leave it none; one
 * valid on half of them is built against on the same tasks. The reading is the same at every
 * epoch, and nothing here is a promotion's own. Null where the reference has no such reading or
 * the tasks leave it room.
 */
function afterPromotion(ground: Ground): Decided | null {
  const { events, all, reference, plan } = ground;
  if (reference === null) return null;
  const against = all.some(({ old, report }) => old === reference && report !== null);
  const last = all.findLast(({ fresh, report }) => fresh === reference && report !== null);
  if (against || last?.report == null || heldSince(events, last.reported ?? -1) > 0) return null;
  if (roomOf(last.report, "fresh") !== "none") return null;
  return written(
    ground.drafts,
    "room",
    {
      move: "examine",
      why: `harness ${short(reference)} is the reference, and comparison ${last.id} found no task informative for it: the tasks have to change, to ones it fails on some solves`,
    },
    plan.patience,
  );
}

/**
 * The row of a step that was read again: the step and its repeat read together clear the level,
 * and the harness is promoted. Null where the latest harness has read no step twice.
 */
function onStep(ground: Ground): Decided | null {
  const { plan, all, reference, latest } = ground;
  if (latest === null || latest === reference) return null;
  const { level, trigger } = plan.wanted;
  if (!readTwice(pairOf(all, latest, reference), level, trigger)) return null;
  return {
    move: "promote",
    harness: latest,
    why: `harness ${short(latest)} read a step and its repeat`,
  };
}

/**
 * An Examiner session, where the campaign holds fewer scorable tasks than a comparison scores,
 * before its first comparison than a comparison and its repeat score, and null where it holds
 * enough. As many sessions in a row as the campaign's patience that hold out none end the campaign
 * on its exam (`written`). The repeat takes the tasks its first stage did not score first
 * (`scoredSet`), where there are any: a first comparison held to one target left none, and on
 * 12 October a repeat re-scored the versions its first stage had scored. Holding a repeat's draw
 * buys no power, since a repeat on fresh tasks finds a true step about as often as one on the same
 * tasks (0.51 against 0.52 in the overhaul plan's simulation, section 4b): it is held against
 * reusing one test set across attempts, as `scoredSet` says.
 */
function toTarget(ground: Ground, before: string): Decided | null {
  const { plan, scorable, drafts, all } = ground;
  const target = (all.length === 0 ? 2 : 1) * plan.wanted.target;
  if (scorable >= target) return null;
  const scores = all.length === 0 ? "a comparison and its repeat score" : "a comparison scores";
  return written(
    drafts,
    "tasks",
    {
      move: "examine",
      why: `the campaign holds ${String(scorable)} of the ${plural(target, "task")} ${scores}, and ${before}: the Examiner writes more first`,
    },
    plan.patience,
  );
}

/** The tasks held out after the log's index `after`. */
function heldSince(events: readonly LogEvent[], after: number): number {
  return events.filter(
    ({ kind, data }, index) => index > after && kind === "task.gate" && data.outcome === "passed",
  ).length;
}

/**
 * The rows where no session has left a harness that is not the reference: before any session,
 * or after a promotion. Tasks held out since the last comparison are read by a control first,
 * the starter compared with the reference on them, which says whether they leave the reference
 * room before a Builder session is paid for; the control's reading then goes through the rows of
 * any comparison (`afterComparison`): room, and the Builder builds on practice brought up from
 * those tasks; none, and the tasks change. A control that reads a step is the
 * starter winning on the new tasks, which is room by another name, and is not repeated.
 */
function onReference(ground: Ground): Decided {
  const { events, all, reference, starter, tasksShort } = ground;
  const idle = build("no session has left a harness that is not the reference harness");
  // Before any comparison the supply row comes first: the tasks a comparison is short of are
  // written before the first session is paid for, so that the release before it has them to
  // draw practice from, and the Examiner is not on the critical path between the session and
  // the comparison. Campaigns that built first on three practice tasks cleared them
  // in three to five harness versions, and then waited on an Examiner session.
  if (all.length === 0) return toTarget(ground, "no comparison has run yet") ?? idle;
  if (reference === null || starter === null || reference === starter) return idle;
  const last = all.findLast(({ report }) => report !== null);
  const since = heldSince(events, last?.reported ?? -1);
  if (since > 0 && tasksShort !== "held") {
    return (
      toTarget(ground, `the tasks held out since the last comparison are read by a control`) ??
      compare(
        `harness ${short(reference)} is the reference, and ${plural(since, "task")} ${since === 1 ? "was" : "were"} held out since the last comparison: the starter is compared with it on them, to read whether they leave it room before a Builder session is paid for`,
        "starter",
      )
    );
  }
  const control = pairOf(all, starter, reference).at(-1);
  if (control === undefined || control !== last?.report) return idle;
  return afterComparison(ground, control, starter, "starter");
}

/** The rows that follow from the latest harness and its last comparison with the reference one. */
function onLatest(ground: Ground): Decided {
  const { events, plan, all, reference, latest, tasksShort } = ground;
  if (latest === null || latest === reference) return onReference(ground);
  const last = pairOf(all, latest, reference).at(-1);
  if (last !== undefined) return afterComparison(ground, last, latest, "latest");
  const lastAt = all.at(-1)?.at ?? -1;
  const sessions = events.filter(
    ({ kind, data }, index) =>
      kind === "build.finished" && index > lastAt && data.ended !== "killed" && data.ended !== "crashed",
  ).length;
  // One session a comparison until set-up stands (epoch 0, `owedReading`), and the plan's after.
  const needed = reference === ground.starter ? 1 : plan.sessions;
  // Under a setting no comparison has run in yet, the harness is read there at once.
  if (all.length > 0 && sessions < needed) {
    return build(
      `${String(sessions)} of ${plural(needed, "Builder session")} before the next comparison have run`,
    );
  }
  if (tasksShort !== null) {
    return supplied(
      ground,
      all.findLast(({ report }) => report !== null)?.report ?? undefined,
      tasksShort === "held"
        ? "the campaign holds fewer tasks to score than a step takes"
        : "the last comparison left too few tasks for the next to untie",
    );
  }
  const why =
    all.length === 0
      ? `harness ${short(latest)} has not been compared under the campaign's setting`
      : `${plural(sessions, "Builder session")} since the last comparison left harness ${short(latest)}`;
  return toTarget(ground, why) ?? compare(why);
}

/** The table's rows for the last comparison of the latest harness with the reference one. */
function afterComparison(ground: Ground, last: JsonObject, latest: string, fresh: Fresh): Decided {
  const { events, all, tasksShort, reference } = ground;
  const id = isString(last.session) ? last.session : "";
  const { reading } = last;
  const control = fresh === "starter";
  if (reading === "check-defects") {
    return end(
      "exam",
      `comparison ${id} stopped on its check defects: the check program needs its author before more is spent`,
    );
  }
  // A reading that clears the trigger buys the repeat and promotes nothing: the two are then read
  // together (`readTwice`).
  if (!control && triggered(last, ground.plan.wanted.trigger)) {
    return compare(
      `comparison ${id} cleared the trigger, which is one draw: the same two harnesses are compared again on fresh solves, and the two are read together`,
    );
  }
  // A comparison of the same two on tasks written since is the answer to a want of tasks or of
  // room, once: more comparisons of one harness that leave none than the campaign's patience end
  // the campaign.
  const reportedAt = all.find(({ report }) => report === last)?.reported ?? Number.POSITIVE_INFINITY;
  const since = heldSince(events, reportedAt);
  const again = tasksShort === null && since > 0;
  if (reading === "not-scored") {
    if (last.capped === true) {
      return end("budget", `comparison ${id} was cut by its dollar cap before it tallied a task`);
    }
    return again
      ? compare(`comparison ${id} tallied no task, and tasks were written since`, fresh)
      : supplied(ground, last, `comparison ${id} tallied no task`);
  }
  const room = roomOf(last);
  if (room === ROOM || (room !== "none" && control && reading === STEP)) {
    if (control) {
      // The supply row holds here too: a control that read room on tasks of which the reference
      // closed all but two or three leaves the next comparison nothing to read a step on: a
      // simulated climb built three times on such a set, 2-0-6 each time.
      if (tasksShort === "untied") {
        return supplied(
          ground,
          last,
          `comparison ${id} read the starter against harness ${short(reference ?? "")} with room, and left too few tasks for the next comparison to untie: harness ${short(reference ?? "")} answered the rest in every solve`,
        );
      }
      return build(
        `comparison ${id} read the starter against harness ${short(reference ?? "")} on the tasks held out since, and they leave it room: the Builder builds`,
      );
    }
    // Tasks written since are compared on before anything is built: on 10 October a campaign held
    // out four on the supply row, then ran two sessions that left the harness as it was, and
    // stopped before any comparison on them.
    if (again) {
      return compare(
        `comparison ${id} read no step with room to gain, and tasks were written since: harness ${short(latest)} is compared on them`,
        fresh,
      );
    }
    // The plan's supply row before its build row: on tasks the reference harness answered in every
    // solve a changed harness can only tie again, so the next comparison has to have tasks to
    // untie before a session is worth its cost. On 10 October a comparison read 3-0-2 on 5 tasks,
    // the new harness valid on every solve; two sessions then left it unchanged, and the stop rule
    // ended the campaign where an Examiner session was the move. A harness valid on
    // every solve that read no step is always here: its wins are the untied tasks, and fewer
    // than a step takes.
    if (tasksShort === "untied") {
      return supplied(
        ground,
        last,
        `comparison ${id} read no step with room to gain and left too few tasks for the next to untie: harness ${short(latest)} can only tie again on the tasks the reference harness answered in every solve`,
      );
    }
    return build(`comparison ${id} read no step with room to gain: harness ${short(latest)} did not help`);
  }
  const unroomed = pairOf(all, latest, reference).filter(
    (report) => report.reading !== STEP && roomOf(report) !== ROOM,
  ).length;
  if (unroomed > ground.plan.patience) {
    return end(
      "no-room",
      `${plural(unroomed, "comparison")} of harness ${short(latest)} left no room, with tasks written between them: the tasks could not be made to leave room`,
    );
  }
  return room === "none" ? noRoom(ground, last, since, fresh) : tooHard(ground, id, since, fresh);
}
/** After a comparison that found no task informative for the reference harness: other tasks,
 *  until as many Examiner sessions in a row as the campaign's patience held out none. */
function noRoom(ground: Ground, last: JsonObject, since: number, fresh: Fresh): Decided {
  const { tasksShort } = ground;
  const id = isString(last.session) ? last.session : "";
  const nearlyAll = "no task was informative for the reference harness";
  if (tasksShort === null && since > 0) {
    return compare(`comparison ${id} left no room, and tasks were written since`, fresh);
  }
  const over = roomEnd(ground);
  if (over !== null) return over;
  return written(
    ground.drafts,
    "room",
    {
      move: "examine",
      why: `comparison ${id} read no step, and ${nearlyAll}: the tasks have to change${fewYet(since)}`,
    },
    ground.plan.patience,
  );
}
/**
 * After a comparison in which neither harness answered: other tasks. A campaign runs at one
 * budget, and a task nobody answers at it is one for the Examiner to replace. The budget is the
 * operator's to set, once, at the opening: on 9 October five Examiner sessions wrote tasks for a
 * budget of one turn, in which no solver can write an answer and submit it.
 */
function tooHard(ground: Ground, id: string, since: number, fresh: Fresh): Decided {
  const { tasksShort } = ground;
  const said = `comparison ${id} read no step, and neither harness gave a valid answer`;
  if (tasksShort === null && since > 0) {
    return compare(`comparison ${id} left neither harness an answer, and tasks were written since`, fresh);
  }
  return written(
    ground.drafts,
    "room",
    { move: "examine", why: `${said}: other tasks are written${fewYet(since)}` },
    ground.plan.patience,
  );
}
