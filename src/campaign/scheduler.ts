import { unadmitted } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import { isReferenceChange, type LogEvent } from "../kernel/log.ts";
import { INTERRUPTED, poolOf, headroomOf } from "../kernel/reports.ts";
import { nonRetryableProvider } from "../kernel/solve.ts";
import { taskSets } from "../kernel/task.ts";
import { isNumber, isString } from "../meta/json-shape.ts";
import { draftOf } from "../examiner/draft.ts";
import { plural } from "../meta/text.ts";
import { comparisonFloor } from "./admission.ts";
import { epochsOf, tasksByEpoch } from "./climb.ts";
import { crashedRun, cutShort, campaignState, heldOut, type Plan, sessionEnded } from "./state.ts";
import { type ScheduledAction, type Ending, short } from "./move.ts";
import { pendingSignals } from "./signal.ts";

const PROMOTED = "harness.promoted";

type Ground = ReturnType<typeof campaignState>;
type Move<Each = ScheduledAction> = Each extends unknown ? Omit<Each, "code"> : never;
type Reading = Ground["reports"][number];

const ROWS: readonly {
  readonly code: string;
  readonly move: (ground: Ground) => (Move & { readonly code?: string }) | null;
}[] = [
  { code: "stop", move: stop },
  { code: "exam", move: exam },
  {
    code: "bound",
    move: (ground) => {
      const ended = bound(ground);
      if (ended?.move === "end" && ended.ending === "budget") {
        const pending = pendingPromotion(ground);
        if (pending !== null) return { ...pending, code: "step" };
        const reverted = unconfirmedRevert(ground);
        if (reverted !== null) return { ...reverted, code: "revert" };
      }
      return ended;
    },
  },
  { code: "tasks", move: tasks },
  { code: "unfinished", move: unfinished },
  { code: "step", move: pendingPromotion },
  { code: "revert", move: unconfirmedRevert },
  { code: "no-room", move: noRoom },
  { code: "unread", move: (ground) => (wantsTasks(ground) ? null : uncomparedTasks(ground)) },
  {
    code: "build",
    move: (ground) => {
      const { read } = ground;
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

const DRAFTS = 3;
export const CRASHES_IN_A_ROW = DRAFTS;
const SHORT_OF_TASKS = ["no-held", "held-short"] as const;
const WANTS_TASKS = "comparison admission requires more held-out tasks";
const BUILDS_AND_ASKS = "Builder continues building and requests tasks";
const MOST_ASKED_AFTER_PROMOTION = 16;
const wantsTasks = ({ refused }: Ground): boolean => SHORT_OF_TASKS.some((code) => refused.has(code));

const end = (ending: Ending, why: string) => ({ move: "end" as const, ending, why });
const compare = (why: string, fresh = "latest"): Move => ({
  move: "compare",
  fresh,
  reference: "promoted",
  why,
});

export function nextAction(events: readonly LogEvent[], plan: Plan): ScheduledAction {
  const ground = campaignState(events, plan);
  for (const row of ROWS) {
    const named = row.move(ground);
    if (named === null) continue;
    return { ...named, code: named.code ?? row.code };
  }
  throw new Error("the decision table's last row names a move for every log");
}

export function unpromoted(events: readonly LogEvent[], plan: Plan, harness: string): string | null {
  return readStep(campaignState(events, plan), harness)
    ? null
    : `harness ${short(harness)} has no comparison that read a step against the reference harness`;
}

function heldOutAfter(events: readonly LogEvent[], after: number): number {
  const held = new Set(taskSets(events).held);
  return tasksByEpoch(events.slice(after + 1))
    .flat()
    .filter((version) => held.has(version)).length;
}

function enoughWrittenSince(ground: Ground, reading: Reading): boolean {
  const { events, plan } = ground;
  const promotedAt = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  const since = heldOutAfter(events, Math.max(reading.at, promotedAt));
  return since >= sweepOf(plan.wanted.level) && !wantsTasks(ground);
}

function fruitlessRun({ events, reports, reference }: Ground) {
  const read = Math.max(-1, ...reports.map(({ at }) => at));
  const compared = reports.map(({ id, old, report, reported }) => ({
    at: reported,
    id,
    gain: report.reading !== "not-scored" && (old !== reference || headroomOf(report) === "room"),
  }));
  const gatedAt = new Map(
    events.flatMap(({ kind, data }, at) =>
      kind === "task.gate" && isString(data.version) ? [[data.version, at]] : [],
    ),
  );
  const examined = events.flatMap((event, at) => {
    if (event.kind !== "exam.finished") return [];
    const wrote = heldOut(event.data);
    const held: readonly unknown[] = Array.isArray(event.data.held) ? event.data.held : [];
    const lastGate = Math.max(
      -1,
      ...held.map((version) => (isString(version) ? (gatedAt.get(version) ?? at) : at)),
    );
    const passed = wrote ? lastGate < read : cutShort(event);
    return passed ? [] : [{ at, id: null, gain: wrote }];
  });
  const readings = [...compared, ...examined].toSorted((one, other) => one.at - other.at);
  return readings.slice(readings.findLastIndex(({ gain }) => gain) + 1);
}

function attemptsIn(run: ReturnType<typeof fruitlessRun>): number {
  return run.length - (run[0]?.id == null ? 0 : 1);
}

export function supplyRun(events: readonly LogEvent[], plan: Plan): number {
  return attemptsIn(fruitlessRun(campaignState(events, plan)));
}

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

function examine(ground: Ground, wants: "tasks" | "room", why: string): Move {
  return outOfPatience(ground, wants, why) ?? { move: "examine", why };
}

function stop({ events, plan }: Ground): Move | null {
  const words = pendingSignals(events);
  const stopped = words.find(({ word }) => word === "stop");
  if (stopped === undefined) {
    const promoted = events.filter(({ kind }) => kind === PROMOTED).length;
    return plan.promotions === null || promoted < plan.promotions
      ? null
      : end("operator", `the operator's cap of ${plural(plan.promotions, "promotion")}`);
  }
  return {
    ...end("operator", `the operator's word${stopped.why === "" ? "" : `: ${stopped.why}`}`),
    answers: words.filter(({ at }) => at <= stopped.at).map(({ at }) => at),
  };
}

function exam(ground: Ground): Move | null {
  const { events, plan, supply, refused } = ground;
  if (plan.prompted && draftOf(events) === null) return bound(ground) ?? drafting(events);
  if (refused.has("unread")) {
    const error = unaudited(events);
    if (error !== null) {
      return nonRetryableProvider(error)
        ? end(
            "exam",
            `the reviewer refused the drafted exam's audit in a way no retry clears (${error}): the exam is not frozen unaudited and no solve is paid for. Open the campaign again with a reviewer whose login answers`,
          )
        : drafting(events);
    }
    return {
      move: "accept",
      why: "nobody has read the campaign's checker: every control and the do-nothing answer are put to the checks before a solve is paid for",
    };
  }
  const faults = supply.faults ?? 0;
  if (faults === 0 || supply.frozen) return null;
  const admittedBefore = events.findLast(({ kind }) => kind === "checker.read")?.data.admitted;
  const newlyAdmitted = plan.admits.filter(
    (id) => !(Array.isArray(admittedBefore) && admittedBefore.includes(id)),
  );
  if (newlyAdmitted.length > 0) {
    return { move: "accept", why: `the operator admits ${newlyAdmitted.join(", ")}: the exam is read again` };
  }
  const undecided = unadmitted(events);
  return end(
    "exam",
    `the checker's last reading holds ${plural(faults, "fault")} and nobody froze it: the exam is not accepted until its author repairs it, or the operator admits each check by name and freezes (tools/c/accept.ts)${undecided.length === 0 ? "" : `. No engine the host installed decides ${undecided.join(", ")}, so each stands on the operator's word alone: --admit ${undecided.join(",")}`}`,
  );
}

export function unaudited(events: readonly LogEvent[]): string | null {
  const session = events.findLast(({ kind }) => kind === "exam.drafted")?.data.session;
  const error = events.findLast(({ kind, data }) => kind === "referee.draft" && data.session === session)
    ?.data.error;
  return isString(error) ? error : null;
}

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
  if (taskSets(events).held.length + supply.released === 0) {
    return examine(ground, "tasks", "the campaign holds no task");
  }
  if (supply.released === 0 && supply.held >= 2 && plan.practice !== 0) {
    return { move: "prepare", why: "no task is released for practice: the contract's draw releases some" };
  }
  const asked = pendingSignals(events).find(({ word }) => word === "tasks");
  if (asked !== undefined && pendingPromotion(ground) === null) {
    return {
      move: "examine",
      why: `the operator asked for other tasks${asked.why === "" ? "" : `: ${asked.why}`}`,
      answers: [asked.at],
    };
  }
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

export function tasksToAskFor(events: readonly LogEvent[], plan: Plan): number {
  const count = shortBy(campaignState(events, plan));
  return count === 0 ? 0 : Math.max(count, sweepOf(plan.wanted.level) + (plan.practice ?? 0));
}

function shortBy({ plan, supply, all, events }: Ground): number {
  const promoted = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  const released = releasedSince(events, promoted).length;
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

function readStep({ events, reports, reference, starter }: Ground, harness: string): boolean {
  const promotedAt = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  return (
    harness !== reference &&
    harness !== starter &&
    reports.some(
      ({ at, fresh, old, report }) =>
        at > promotedAt && fresh === harness && old === reference && report.reading === "step",
    )
  );
}

function unconfirmedRevert({ events, reference, starter }: Ground): Move | null {
  if (reference === null || starter === null || reference === starter) return null;
  const epochs = epochsOf(events);
  const current = epochs.at(-1);
  if (current?.starter_tally == null || current.confirmed !== false) return null;
  if (current.starter_able === false && current.starter_tally.wins > current.starter_tally.losses) {
    return null;
  }
  const target =
    epochs.findLast((epoch) => epoch.confirmed === true && epoch.reference !== reference)?.reference ??
    starter;
  return {
    move: "revert",
    harness: target,
    why: `harness ${short(reference)} did not confirm against the starter in ${current.starter_read ?? "its starter comparison"}: reverting reference to ${target === starter ? "the starter" : short(target)}`,
  };
}

function pendingPromotion(ground: Ground): Move | null {
  const { reports, reference, waiting } = ground;
  if (waiting !== null && readStep(ground, waiting)) {
    return {
      move: "promote",
      harness: waiting,
      why: `harness ${short(waiting)} cleared the promotion threshold`,
    };
  }
  const earlier = reports.toReversed().flatMap(({ old, fresh }) => (old === reference ? [fresh] : []));
  const pending = earlier.find((harness) => harness !== waiting && readStep(ground, harness));
  return pending === undefined
    ? null
    : {
        move: "promote",
        harness: pending,
        why: `harness ${short(pending)} cleared the promotion threshold and has not been promoted yet; later candidate harnesses will be evaluated against it once promoted`,
      };
}

function noRoom(ground: Ground): Move | null {
  const { reports, reference, events } = ground;
  const last = reports.findLast(({ old, fresh }) => old === reference || fresh === reference);
  if (last === undefined || enoughWrittenSince(ground, last)) return null;
  const side = last.old === reference ? "old" : "fresh";
  const room = headroomOf(last.report, side);
  if (room === "room") {
    const promotedAt = events.findLastIndex(({ kind }) => isReferenceChange(kind));
    if (promotedAt === -1 || events[promotedAt]?.kind === "harness.reverted") return null;
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
    return writtenForIt
      ? null
      : {
          move: "examine",
          why: `harness ${short(reference ?? "")} was promoted, and no Examiner session has finished writing tasks for it since: tasks are written for each new reference`,
        };
  }
  const why =
    room === "too-hard"
      ? `comparison ${last.id} showed no improvement and neither harness produced a valid answer: generating replacement tasks`
      : side === "old"
        ? `comparison ${last.id} showed no improvement and no task was informative for the reference harness: generating new tasks`
        : `harness ${short(reference ?? "")} is the current reference and comparison ${last.id} found no informative tasks for it: generating harder tasks with evaluation headroom`;
  return examine(ground, "room", why);
}

function uncomparedTasks(ground: Ground): Move | null {
  const { events, read, reports, waiting, reference, starter } = ground;
  const promotedAt = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  const lastStarter = reports.findLast(
    ({ old, fresh, report }) => (old === starter || fresh === starter) && report.reading !== "not-scored",
  );
  const since = heldOutAfter(events, Math.max(lastStarter?.at ?? -1, promotedAt));
  const pending = reference !== null && starter !== null && reference !== starter && since > 0;
  const currentEpoch = epochsOf(events).at(-1);
  if (pending && currentEpoch?.starter_tally === null && currentEpoch.confirmed !== true) {
    return compare(
      `harness ${short(reference)} is the current reference with ${plural(since, "new held-out task")}: running a starter confirmation comparison (prioritizing new tasks) to check evaluation headroom and confirm the gain over starter`,
      "starter",
    );
  }
  if (waiting === null || read === null || !enoughWrittenSince(ground, read)) return null;
  const later = "and new tasks have been added since";
  if (read.report.reading === "not-scored") {
    return compare(`comparison ${read.id} tallied no tasks, ${later}`);
  }
  const whatItLeft = {
    none: "left no evaluation headroom",
    "too-hard": "produced no valid answers on either arm",
    room: null,
  }[headroomOf(read.report)];
  return whatItLeft === null ? null : compare(`comparison ${read.id} ${whatItLeft}, ${later}`);
}

function buildsOn(ground: Ground): string {
  const { read, waiting, reference } = ground;
  if (read?.starterComparison === true) {
    return `starter confirmation ${read.id} against harness ${short(reference ?? "")} showed evaluation headroom on new held-out tasks: Builder continues building`;
  }
  if (read !== null) {
    return `comparison ${read.id} showed no significant step despite available headroom: harness ${short(read.fresh)} did not improve over reference`;
  }
  if (waiting === null) return "no candidate harness differs from the current reference";
  return `harness ${short(waiting)} has not been evaluated yet: Builder will trigger comparison when ready`;
}

function releasedSince(
  events: readonly LogEvent[],
  from: number,
  states = taskSets(events).states,
): string[] {
  return events.flatMap(({ kind, data }, at) =>
    at > from &&
    kind === "task.state" &&
    data.state === "released" &&
    isString(data.version) &&
    states.get(data.version) === "released"
      ? [data.version]
      : [],
  );
}

export function practiceDue(
  events: readonly LogEvent[],
  practice: number | null,
  level: number,
): { readonly to: number; readonly said: string } | null {
  if (practice === null) return null;
  const sets = taskSets(events);
  const released = sets.released.length;
  const seen = new Set<unknown>();
  let since = -1;
  for (const [at, { kind, data }] of events.entries()) {
    if (isReferenceChange(kind)) since = at;
    else if (kind === "comparison.reported" && !seen.has(data.session)) {
      seen.add(data.session);
      since = at;
    }
  }
  const releases = releasedSince(events, since, sets.states);
  const count = releases.length;
  const promotedAt = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  let nonFrontier = 0;
  if (count > 0 && since !== -1) {
    const beforeSince = events.slice(0, since + 1);
    const heldAtSince = new Set(taskSets(beforeSince).held);
    const frontierAtSince = new Set(poolOf(beforeSince).practiceFrontier);
    nonFrontier = releases.filter(
      (version) => heldAtSince.has(version) && !frontierAtSince.has(version),
    ).length;
  }
  const allowance =
    released === 0 && promotedAt === -1
      ? Infinity
      : Math.max(0, poolOf(events).practiceFrontier.length - comparisonFloor(level) - nonFrontier);
  const last = events.findLastIndex(
    ({ kind, data }, at) =>
      at <= since && (isReferenceChange(kind) || (kind === "task.state" && data.state === "released")),
  );
  const written = tasksByEpoch(events.slice(last + 1))
    .flat()
    .filter(
      (version) => sets.states.get(version) === "held" || sets.states.get(version) === "released",
    ).length;
  const lastEvent = events[last];
  const baseline = lastEvent !== undefined && isReferenceChange(lastEvent.kind) ? 0 : 1;
  const newTasksLimit = Math.max(0, Math.max(baseline, Math.floor(written / 2)) - count);
  const owed = Math.min(Math.max(0, practice - count), allowance, newTasksLimit);
  if (owed === 0) return null;
  return {
    to: released + owed,
    said: `${String(count)} of the ${plural(practice, "practice task")} the campaign names are released${since === -1 ? "" : " since the last reading"}`,
  };
}
