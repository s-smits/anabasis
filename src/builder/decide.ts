/**
 * Move 7 of a campaign: the one move that follows from its log.
 *
 * A campaign is a loop of moves over one log (`docs/plan.md`, "The process"): the exam is read,
 * tasks are written, a Builder builds, two harnesses are compared, and then something has to say
 * what comes next. Until 2026-10-09 a session said it, by a skill's walk of eight links and with
 * the operator, and the source only named the moves that may start (`nextMoves`, `handover.ts`).
 * This is the plan's decision table as one function: it takes the log and the campaign's plan and
 * returns one move with its reason, or an ending.
 *
 * It decides which move, and nothing of a move's content: what a harness holds, what a task asks
 * and how it is solved stay a model's. Its rows are asked of one reading of the log, made once
 * (`groundOf`, `ground.ts`), which adds no fold beside the owners it reads: the supply and what a
 * comparison is short of (`admission.ts`), the stop rule and the room a report shows
 * (`reports.ts`), the reference harness and the last one a session left.
 *
 * The order it asks in:
 *
 * 0. The operator's word, where one was left and nothing has acted on it: a stop ends the
 *    campaign there, and a word for other tasks has them written once the exam stands.
 * 1. The exam. A campaign that opened from a prompt has it drafted, three drafts at most. A
 *    checker nobody has read is read, and one whose reading holds a fault that nobody froze ends
 *    the campaign: the exam was not accepted. It is read again where the operator's command
 *    admits a check the last reading did not hold admitted.
 * 2. The tasks. A pack's tasks are taken in, practice is released, and a campaign with no task
 *    has some written.
 * 3. The budget, which ends the campaign where less is left than one solve is held at, or than
 *    the next comparison would bill by what the last one did, and the stop rule, which ends it
 *    unless the operator said to go on.
 * 4. A comparison that began and has not reported goes on.
 * 5. After a promotion the tasks change, once: the next epoch's are the ones the harness now the
 *    reference fails, and a comparison against it says whether they do.
 * 6. A step. Read once, it is one draw, and the same two harnesses are compared again with the
 *    reference read against itself. Read again, it is read once at the full limit, where it must
 *    not lose, and then the harness is promoted. A reading at the full limit the two already have
 *    stands for that where it scored every task the step did (`vouches`).
 * 7. No step. Where the reference harness left no room, the tasks have to change, and the budget
 *    is set again by the rule only once as many Examiner sessions in a row as the campaign's
 *    patience held out nothing (`harder`). Where neither harness answered, the campaign goes to
 *    the next longer budget: to try it, or, where it is known to leave no room, to stand there
 *    while the tasks change, since at the shorter one nothing is answered whatever is written.
 *    With room, the harness did not help, and the Builder builds again.
 * 8. Nothing new to compare: the Builder builds. Something new: it is compared once the sessions
 *    before a comparison have run, or tasks are written where the comparison would be short of
 *    them.
 * 9. Before a Builder session, practice is brought towards the count the campaign names, where
 *    tasks were held out since the last release, and brought up again after a control that read
 *    room: the tasks that leave the reference room are what the Builder has to work on.
 * 10. Before a comparison the campaign holds as many scorable tasks as a comparison scores, or
 *    the Examiner writes more first, up to three sessions in a row that add none. On 9 and 10
 *    October the two campaigns on the operator's host compared on 6 tasks where the setting
 *    asked for 12, and a harness came one win short of a step three times.
 * 11. No harness but the reference, and tasks held out since the last comparison: a control, the
 *    starter compared with the reference on them, before a Builder session is paid for. It reads
 *    whether the tasks leave the reference room (`roomOf`, on the reference's side), and goes
 *    through the rows of any comparison from there. On 10 October t-4, t-9 and t-10 each promoted
 *    a harness, had the Examiner write tasks for room, released one, ran three Builder sessions
 *    that changed nothing, since every practice solve passed, and stopped: whether the tasks left
 *    room was never measured.
 *
 * A setting is recorded once and again at each change (`campaign.setting`), and no reading is
 * carried across two. A campaign returns to a budget, so the comparisons under its setting are
 * those of every stretch of the log that stood under it (`under`, `ground.ts`): what was read there the first
 * time still stands, and no comparison is made twice for one answer.
 *
 * The budget rule is the plan's: the longest budget, of the one a comparison ran under and the
 * shorter ones it was read at, at which the reference harness was valid on at most half its
 * solves. Since 10 October it is the fallback behind the tasks: the climb the system is for is
 * on tasks the reference harness fails, and t-10, with the budget first, climbed in turns. The
 * three shares it and `roomOf` read by are the plan's proposal and the operator's to set. A reading at a shorter budget is of a solver that was told the longer one, and understates
 * a solver told the shorter: on 9 October the starter answered 0 of 10 solves read at two turns,
 * and 10 of 10 once it was told two. So the rule's budget is a place to look, the comparison
 * under it is what counts, and the ladder is walked by what those comparisons show.
 */
import type { LogEvent } from "../kernel/log.ts";
import { billedParts, roomOf } from "../kernel/reports.ts";
import { practiceRan } from "../kernel/solves.ts";
import { isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { draftOf } from "../examiner/draft.ts";
import { plural } from "../meta/text.ts";
import { supplyOf } from "./admission.ts";
import { type Ground, groundOf, idleDrafts, pairOf, type Plan, under } from "./ground.ts";
import {
  budgetBy,
  budgetSaid,
  build,
  compare,
  type Decided,
  end,
  type Fresh,
  held,
  readTwice,
  triggered,
  short,
  STEP,
  toBudget,
  vouches,
} from "./move.ts";
import { pendingWords } from "./word.ts";

/** The drafts of an exam the plan gives before the campaign ends on it. The other two bounds,
 *  Examiner sessions in a row that held out no task and comparisons of one harness that left no
 *  room, are the campaign's patience (`plan.patience`, `PATIENCE`), as the stop rule's is. */
const DRAFTS = 3;
const SETTING = "campaign.setting";
const ROOM = "room";
/** What an Examiner session's reason adds where the tasks written since the comparison are too
 *  few yet: without it two sessions in a row give one reason, as the first campaign's did. */
const fewYet = (since: number): string =>
  since === 0
    ? ""
    : `. The ${plural(since, "task")} written since ${since === 1 ? "is" : "are"} too few yet for a comparison to read a step on`;

/** Tasks, for the reason `why`, where a comparison is short of them: the budget first where the
 *  reference harness passes nearly all, as the table has it. */
function supplied(ground: Ground, last: JsonObject | undefined, why: string): Decided {
  const none = last !== undefined && roomOf(last) === "none";
  return harder(ground, last, { move: "examine", room: none, why }, none ? "room" : "tasks");
}

/**
 * Harder tasks before a shorter budget. An Examiner session, for `wants`, while the campaign's
 * patience for sessions that hold out nothing is not spent; then the budget the rule takes from
 * `last` where one is untried, as the fallback; then the ending. Until 10 October the budget
 * came first, and what a campaign climbed was the turn count: t-10's step was a harness that
 * answered in 2 turns where the starter took 3, on tasks both answered at the full limit. The
 * climb the system is for is on tasks the reference harness fails, which its Examiner writes
 * (`docs/plan.md`, "The compute budget").
 */
function harder(
  ground: Ground,
  last: JsonObject | undefined,
  examine: Decided,
  wants: "tasks" | "room",
): Decided {
  const { turns, drafts, plan } = ground;
  if (drafts < plan.patience) return examine;
  const rung = last !== undefined && wants === "room" ? budgetBy(last, "old", turns) : undefined;
  if (rung !== undefined && rung !== turns && !tried(ground, rung)) {
    return toBudget(
      rung,
      `${plural(drafts, "Examiner session")} in a row held out no task (${examine.why}), and at ${budgetSaid(rung)} the reference harness was valid on at most half its solves: the budget is set there`,
    );
  }
  return written(drafts, wants, examine, plan.patience);
}

/** An Examiner session, unless three in a row have already held out no task.
 *  Then the campaign ends: on its exam where it wants for tasks, which could not be written, and
 *  on its room where the tasks it has leave none. */
function written(drafts: number, wants: "tasks" | "room", examine: Decided, patience: number): Decided {
  if (drafts < patience) return examine;
  const sessions = `${plural(drafts, "Examiner session")} in a row held out no task (${examine.why})`;
  return wants === "tasks"
    ? end("exam", `${sessions}: the tasks could not be written`)
    : end("no-room", `${sessions}: the tasks could not be made to leave room`);
}

/** Whether the latest harness was already compared with the reference one under a setting that
 *  held a solve to `turns`: a budget the pair has been read at is not gone back to. */
function tried(ground: Ground, turns: number | null): boolean {
  const { latest, reference } = ground;
  return latest !== null && pairOf(under(ground, turns), latest, reference).length > 0;
}

/** The plan's decision table over a campaign's log: the next move, or the campaign's ending. */
/** The first move of a campaign that opened from a prompt and holds no exam: a draft, while the
 *  plan's three have not been put. A session that put none, as one its provider failed, counts
 *  as a session, so that a campaign does not draft against a dead provider without end. Where
 *  every session crashed and no draft was put, the ending is the environment's, with what the
 *  last crash said: on 10 October three sessions crashed in one second before any model call
 *  (Claude Code refused to run as root), and the campaign ended on an exam nobody had read. */
function drafting(events: readonly LogEvent[]): Decided {
  const sessions = events.filter(({ kind }) => kind === "draft.finished");
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

export function decide(events: readonly LogEvent[], plan: Plan): Decided {
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
    return end(
      "exam",
      `the checker's last reading holds ${plural(supply.faults, "fault")} and nobody froze it: the exam is not accepted until its author repairs it, or the operator admits each check by name and freezes (tools/c/accept.ts)`,
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
  if (supply.held + supply.awaiting + supply.exhausted + supply.released === 0) {
    return written(
      idleDrafts(events),
      "tasks",
      { move: "examine", room: false, why: "the campaign holds no task" },
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
      room: true,
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
  const open = ground.here.find(({ report }) => report === null);
  if (open !== undefined) {
    return {
      move: "compare",
      id: open.id,
      fresh: open.fresh,
      reference: open.old,
      noise: open.noise,
      why: `comparison ${open.id} began and has not reported: it goes on from its log`,
    };
  }
  const next = afterPromotion(ground) ?? onStep(ground) ?? owed(ground) ?? onLatest(ground);
  if (next.move === "compare") return afforded(ground, next);
  if (next.move !== "build") return next;
  return toPractise(ground, supply) ?? unshown(ground) ?? next;
}

/**
 * Tasks, where the last Builder session left its harness as it was and no practice solve of its
 * failed: it had nothing to work on, which is the supply's fault, so the table does not build
 * again on the same practice. Such a session counts nothing towards the stop (`stopRule`), and
 * until 10 October the table built again on it, three times, in every campaign on record. The
 * Examiner is asked for tasks that leave room, bounded by the campaign's patience as every
 * Examiner session is (`written`).
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
  // release for practice or a comparison, and not another Examiner session. Until 10 October this
  // row asked again for as long as its patience lasted, and a simulated climb wrote four tasks the
  // starter failed, then three sessions more, and ended `no-room` with none of them read.
  if (shown || heldSince(events, at) > 0) return null;
  return written(
    ground.drafts,
    "room",
    {
      move: "examine",
      room: true,
      why: `Builder session ${isString(last.session) ? last.session : "?"} left its harness as it was, and no practice solve of its failed: it had nothing to work on, so the tasks have to change before another session is paid for`,
    },
    plan.patience,
  );
}

/**
 * A release for practice before a Builder session, where the campaign holds fewer practice tasks
 * than it names and tasks were held out since the last release. One release takes at most half of
 * what is held (`tools/d2/prepare.ts`), so a campaign that opens on a few tasks releases fewer
 * than it names, and until 2026-10-09 it stayed there whatever was written later. The second
 * campaign from a prompt named three practice tasks, released two of its five examples, and held
 * out sixteen more tasks, written to leave a harness room: both its Builder sessions practised on
 * the same two examples, and the second spent two of its six practice solves. The campaigns on
 * the operator's host practised on two, two, three and six tasks. The draw is the contract's, and
 * no solve chooses a task. Null where nothing is to release.
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
 * it billed bought no reading: on 9 October the second campaign from a prompt had $1.45 left,
 * began the repeat of a step whose first reading had billed $1.00 for two sides, and was cut
 * after $1.06 of the three sides the repeat has. What a comparison will bill is read from the
 * last one that reported under the campaign's setting, by the sides each solves: two, and three
 * where the reference is read against itself. Under a setting no comparison has reported in,
 * nothing says what one bills, and it starts.
 */
function afforded(ground: Ground, next: Extract<Decided, { move: "compare" }>): Decided {
  const { events, plan, here } = ground;
  const last = here.findLast(({ report }) => report !== null && report.capped !== true);
  if (plan.left == null || last === undefined) return next;
  const sides = (noise: boolean): number => (noise ? 3 : 2);
  const was = billedParts(events, last.id).comparison;
  const expected = (was * sides(next.noise)) / sides(last.noise);
  if (plan.left.dollars >= expected) return next;
  return end(
    "budget",
    `$${plan.left.dollars.toFixed(2)} of the campaign's budget are left, and comparison ${last.id} billed $${was.toFixed(2)} for ${String(sides(last.noise))} sides under this setting: the next solves ${String(sides(next.noise))} and would bill about $${expected.toFixed(2)}, so it would be cut before it reports`,
  );
}

/**
 * A promotion the campaign owes: a harness that read a step twice against the reference harness,
 * and is to be promoted by the rule, while later sessions left another. The table follows the
 * latest harness, so it passed such a step by. On 9 October one campaign read a step twice
 * against the starter, promoted nothing, and went on by hand for three rounds against that
 * harness named as the reference: the table then read none of those rounds, since they were made
 * against no reference of the campaign's, and named a Builder session. The newest such harness is
 * named, and what later sessions left is read against it once it is the reference.
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
 * promoted once it was read again and did not lose at the full limit. It is the rule move 7
 * promotes by (`onStep`), asked for a harness the operator names (`tools/d2/promote.ts`).
 */
export function unpromoted(events: readonly LogEvent[], plan: Plan, harness: string): string | null {
  const step = onStep({ ...groundOf(events, plan), latest: harness });
  if (step?.move === "promote") return null;
  return step === null
    ? `harness ${short(harness)} has not read a step and its repeat against the reference harness under the campaign's setting`
    : step.why;
}

/** After a promotion the budget rule is applied again, to the promoted harness's own solves: the
 *  budget follows the reference. Null where no promotion waits for it. */
function afterPromotion({ events, all, reference }: Ground): Decided | null {
  const promotedAt = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  if (reference === null || promotedAt <= events.findLastIndex(({ kind }) => kind === SETTING)) return null;
  // Promoted on a comparison it was read in, and never yet the reference side of one: the tasks
  // change, once, since the ones the campaign holds were answered by the harness now the
  // reference, and the next epoch's are the ones it fails. A comparison made against it, after
  // the promotion or by name before it, has read the tasks already, and its rows say what follows. Until 10 October the budget
  // rule came first here, and the reference's own solves took the campaign down the ladder.
  const read = all.some(
    ({ fresh, old, report }) => (fresh === reference || old === reference) && report !== null,
  );
  const against = all.some(({ old, report }) => old === reference && report !== null);
  if (!read || against) return null;
  return events.some(({ kind }, index) => kind === "exam.finished" && index > promotedAt)
    ? null
    : {
        move: "examine",
        room: true,
        why: `harness ${short(reference)} was promoted: the tasks have to change, to ones it fails`,
      };
}

/**
 * The rows of a step that was read again: the reading at the full limit, where the harness must
 * not lose, and the promotion. Null where the latest harness has read no step twice.
 */
function onStep(ground: Ground): Decided | null {
  const { plan, settings, rest, here, turns, reference, latest } = ground;
  if (latest === null || latest === reference) return null;
  const pair = pairOf(here, latest, reference);
  const promote = (why: string): Decided => ({
    move: "promote",
    harness: latest,
    why: `harness ${short(latest)} ${why}`,
  });
  const { level } = plan.wanted;
  if (turns === plan.limit) {
    if (readTwice(pair, level)) return promote("read a step and its repeat at the full limit");
    // The reading at the full limit of a step that was read twice under a shorter budget.
    const below = settings.findLast(
      (each) =>
        each.rest === rest &&
        each.turns !== plan.limit &&
        readTwice(pairOf(under(ground, each.turns), latest, reference), level),
    );
    if (below === undefined) return null;
    const steps = pairOf(under(ground, below.turns), latest, reference).slice(-2);
    const last = pair.findLast((report) => vouches(ground.all, report, steps));
    if (last === undefined) {
      return compare("a step read again is read once at the full limit, where it must not lose", "alone");
    }
    return held(last)
      ? promote(
          `read a step and its repeat at ${budgetSaid(below.turns)}, and did not lose at the full limit`,
        )
      : {
          move: "budget",
          modelTurns: below.turns,
          why: `harness ${short(latest)} read a step and its repeat at a shorter budget and lost at the full limit: it is not promoted, and the campaign returns to that budget`,
        };
  }
  if (!readTwice(pair, level)) return null;
  // A reading of the two at the full limit stands whenever it was made, before the budget was
  // shortened as much as after the step, so long as it vouches for the step's tasks (`vouches`).
  const full = pairOf(under(ground, plan.limit), latest, reference).findLast((report) =>
    vouches(ground.all, report, pair.slice(-2)),
  );
  if (full === undefined) {
    return {
      move: "budget",
      modelTurns: plan.limit,
      why: `harness ${short(latest)} read a step and its repeat: before a promotion it is read once at the full limit`,
    };
  }
  return held(full)
    ? promote(
        `read a step and its repeat at ${budgetSaid(turns)}, and did not lose at the full limit (comparison ${isString(full.session) ? full.session : "?"})`,
      )
    : build(`harness ${short(latest)} lost at the full limit and is not the reference`);
}

/**
 * An Examiner session, where the campaign holds fewer scorable tasks than a comparison scores,
 * and null where it holds enough. Three sessions in a row that hold out none end the campaign on
 * its exam (`written`).
 */
function toTarget(ground: Ground, before: string): Decided | null {
  const { plan, scorable, drafts } = ground;
  const { target } = plan.wanted;
  if (scorable >= target) return null;
  return written(
    drafts,
    "tasks",
    {
      move: "examine",
      room: false,
      why: `the campaign holds ${String(scorable)} of the ${plural(target, "task")} a comparison scores, and ${before}: the Examiner writes more first`,
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
 * those tasks; none, and the budget or the tasks change. A control that reads a step is the
 * starter winning on the new tasks, which is room by another name, and is not repeated.
 */
function onReference(ground: Ground): Decided {
  const { events, all, here, reference, starter, tasksShort } = ground;
  const idle = build("no session has left a harness that is not the reference harness");
  if (reference === null || starter === null || reference === starter) return idle;
  const last = all.findLast(({ report }) => report !== null);
  const since = heldSince(events, last?.reported ?? -1);
  if (since > 0 && tasksShort !== "held") {
    return (
      toTarget(ground, `the tasks held out since the last comparison are read by a control`) ??
      compare(
        `harness ${short(reference)} is the reference, and ${plural(since, "task")} ${since === 1 ? "was" : "were"} held out since the last comparison: the starter is compared with it on them, to read whether they leave it room before a Builder session is paid for`,
        noiseRead(ground) === null ? "noise" : "alone",
        "starter",
      )
    );
  }
  const control = pairOf(here, starter, reference).at(-1);
  if (control === undefined || control !== last?.report) return idle;
  return afterComparison(ground, control, starter, "starter");
}

/** The rows that follow from the latest harness and its last comparison with the reference one. */
function onLatest(ground: Ground): Decided {
  const { events, plan, all, here, reference, latest, tasksShort } = ground;
  if (latest === null || latest === reference) return onReference(ground);
  const last = pairOf(here, latest, reference).at(-1);
  if (last !== undefined) return afterComparison(ground, last, latest, "latest");
  const lastAt = all.at(-1)?.at ?? -1;
  const sessions = events.filter(
    ({ kind, data }, index) =>
      kind === "build.finished" && index > lastAt && data.ended !== "killed" && data.ended !== "crashed",
  ).length;
  const needed = all.length === 0 ? 1 : plan.sessions;
  // Under a setting no comparison has run in yet, the harness is read there at once.
  if (here.length > 0 && sessions < needed) {
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
    here.length === 0
      ? `harness ${short(latest)} has not been compared under the campaign's setting`
      : `${plural(sessions, "Builder session")} since the last comparison left harness ${short(latest)}`;
  return toTarget(ground, why) ?? compare(why, noiseRead(ground) === null ? "noise" : "alone");
}

/**
 * The comparison in which the reference harness was read against itself under the campaign's
 * setting, on the tasks the campaign still holds, or null. That reading is the noise every
 * comparison there has to exceed, and one stands for the setting: a second is a third of a
 * comparison's solves for a second draw of the same share. It is read again once the reference
 * is another harness or tasks were held out since, since either changes what it is a share of.
 * Until 2026-10-09 any earlier one under the setting stood, whatever harness it was of, and a
 * step's repeat read it again whatever stood: on that day the second campaign from a prompt had
 * the budget for a repeat of two sides and not of three, four comparisons after the reference
 * had been read against itself on the same tasks.
 */
function noiseRead({ events, here, reference }: Ground): string | null {
  const read = here.findLast(
    ({ noise, old, report }) => noise && old === reference && report !== null && report.capped !== true,
  );
  const since = events.some(
    ({ kind, data }, index) =>
      read !== undefined && index > read.at && kind === "task.gate" && data.outcome === "passed",
  );
  return read === undefined || since ? null : read.id;
}

/** The table's rows for the last comparison of the latest harness with the reference one. */
function afterComparison(ground: Ground, last: JsonObject, latest: string, fresh: Fresh): Decided {
  const { events, all, here, tasksShort, reference } = ground;
  const id = isString(last.session) ? last.session : "";
  const { reading } = last;
  const control = fresh === "starter";
  if (reading === "check-defects") {
    return end(
      "exam",
      `comparison ${id} stopped on its check defects: the check program needs its author before more is spent`,
    );
  }
  if (reading === "starter-unread") {
    return {
      move: "compare",
      fresh: "latest",
      reference: "starter",
      noise: false,
      why: `comparison ${id} cleared its level and the starter was not solved on its tasks: the new harness is compared with the starter`,
    };
  }
  // A reading that clears the trigger buys the repeat and promotes nothing: the two are then read
  // together (`readTwice`). Until 10 October only a step bought one.
  if (!control && triggered(last, ground.plan.wanted.trigger)) {
    const noise = noiseRead(ground);
    const again = `comparison ${id} cleared the trigger, which is one draw: the same two harnesses are compared again on fresh solves, and the two are read together`;
    return noise === null
      ? compare(`${again}, with the reference read against itself`, "noise")
      : compare(
          `${again}. The reference was read against itself under this setting in comparison ${noise}, on the tasks the campaign holds`,
          "alone",
        );
  }
  // A comparison of the same two on tasks written since is the answer to a want of tasks or of
  // room, once: three in a row that still leave none end the campaign.
  const reportedAt = all.find(({ report }) => report === last)?.reported ?? Number.POSITIVE_INFINITY;
  const since = heldSince(events, reportedAt);
  const again = tasksShort === null && since > 0;
  if (reading === "not-scored") {
    if (last.capped === true) {
      return end("budget", `comparison ${id} was cut by its dollar cap before it tallied a task`);
    }
    return again
      ? compare(`comparison ${id} tallied no task, and tasks were written since`, "alone", fresh)
      : supplied(ground, last, `comparison ${id} tallied no task`);
  }
  const room = roomOf(last);
  if (room === ROOM || (room !== "none" && control && reading === STEP)) {
    if (control) {
      // The supply row holds here too: a control that read room on tasks of which the reference
      // closed all but two or three leaves the next comparison nothing to read a step on. The
      // simulated climb of 10 October built three times on such a set, 2-0-6 each time.
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
    // Tasks written since are compared on before anything is built: t-3 (10 October) had four
    // held out on the supply row and then two sessions that left the harness as it was, and the
    // stop rule, before any comparison on them.
    if (again) {
      return compare(
        `comparison ${id} read no step with room to gain, and tasks were written since: harness ${short(latest)} is compared on them`,
        "alone",
        fresh,
      );
    }
    // The plan's supply row before its build row: on tasks the reference harness answered in every
    // solve a changed harness can only tie again, so the next comparison has to have tasks to
    // untie before a session is worth its cost. t-2 (10 October) read 3-0-2 on 5 tasks at 3
    // turns, the new harness valid on every solve; two sessions then left it unchanged, and the
    // stop rule ended the campaign where an Examiner session was the move. A harness valid on
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
  const unroomed = pairOf(here, latest, reference).filter(
    (report) => report.reading !== STEP && roomOf(report) !== ROOM,
  ).length;
  if (unroomed > ground.plan.patience) {
    return end(
      "no-room",
      `${plural(unroomed, "comparison")} of harness ${short(latest)} left no room, with tasks written between them: the tasks could not be made to leave room`,
    );
  }
  return room === "none" ? noRoom(ground, last, since, fresh) : tooHard(ground, id, latest, since, fresh);
}
/** After a comparison in which the reference harness answered nearly everything: the budget by the
 *  rule, where the campaign has not stood at it, and else other tasks. */
function noRoom(ground: Ground, last: JsonObject, since: number, fresh: Fresh): Decided {
  const { tasksShort } = ground;
  const id = isString(last.session) ? last.session : "";
  const nearlyAll = "the reference harness was valid on more than three solves in four";
  if (tasksShort === null && since > 0) {
    return compare(`comparison ${id} left no room, and tasks were written since`, "alone", fresh);
  }
  return harder(
    ground,
    last,
    {
      move: "examine",
      room: true,
      why: `comparison ${id} read no step, and ${nearlyAll}: the tasks have to change${fewYet(since)}`,
    },
    "room",
  );
}
/**
 * After a comparison in which neither harness answered: the next longer budget, and other tasks
 * where none is left. A longer budget only leaves the reference more answers, so where the next
 * one is known to leave no room, by a comparison made under it or by an earlier one read at it,
 * no budget of the ladder leaves room. The campaign then stands at that longer budget and has the
 * tasks changed there: at the shorter one nothing is answered, whatever is written. The first
 * campaign run by one command had five Examiner sessions write tasks for a budget of one turn, in
 * which no solver can write an answer and submit it (2026-10-09).
 */
function tooHard(ground: Ground, id: string, latest: string, since: number, fresh: Fresh): Decided {
  const { plan, all, turns, reference, tasksShort } = ground;
  const said = `comparison ${id} read no step, and neither harness was valid on one solve in four`;
  const longer = [...plan.ladder, ...(plan.limit === null ? [] : [plan.limit])]
    .toSorted((one, other) => one - other)
    .find((rung) => turns !== null && rung > turns);
  if (longer !== undefined) {
    const there = pairOf(under(ground, longer), latest, reference).at(-1);
    const full =
      there === undefined
        ? pairOf(all, latest, reference).some((report) => roomOf(report, longer) === "none")
        : roomOf(there) === "none";
    if (full) {
      return toBudget(
        longer,
        `${said}. At ${budgetSaid(longer)} the reference harness left no room, so no budget of the ladder leaves room: the campaign stands at ${budgetSaid(longer)}, and the tasks have to change`,
      );
    }
    if (there === undefined || roomOf(there) === ROOM) {
      return toBudget(longer, `${said}: the budget is lengthened`);
    }
  }
  if (turns !== null && longer === undefined && plan.limit === null && !tried(ground, null)) {
    return toBudget(null, `${said}: the budget is lengthened`);
  }
  if (tasksShort === null && since > 0) {
    return compare(
      `comparison ${id} left neither harness an answer, and tasks were written since`,
      "alone",
      fresh,
    );
  }
  return written(
    ground.drafts,
    "room",
    {
      move: "examine",
      room: false,
      why: `${said}, with no longer budget left to try: other tasks are written${fewYet(since)}`,
    },
    ground.plan.patience,
  );
}
