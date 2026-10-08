/**
 * What adopting a changed pack into a campaign would do, read whole before anything is written:
 * the reading of the pack, what counts against it, and the events that make it the campaign's next
 * checker epoch (`src/kernel/epoch.ts`). `accept.ts` prints the reading and, on the operator's
 * word, appends the events. No model is asked, and a pack is all it is given of the change: who
 * wrote the pack, a person or a session, is not its to know.
 *
 * The pack is read the two ways a checker has been read here before. Its controls are put to it
 * twice and every check is held to having refused an answer and passed one (`acceptance`). And
 * every answer the log holds a verdict for is graded again under it (`regraded`), with the moved
 * verdicts set against what was ruled of the old ones (`repairReading`).
 *
 * What counts against it is a ratchet: adding is by judgement, loosening by evidence.
 *
 * - A refusal may be withdrawn only from an answer ruled a check defect: by a person's labels, or
 *   by the Referee's rulings once the operator says they have cleared their bar
 *   (`refereeDecides`, the word a round takes for the same thing). One withdrawn from an answer
 *   ruled earned, or from one nobody read, counts against, whatever else changed.
 * - An accepted answer newly refused counts against a repair, where the solver was asked the same
 *   thing and nobody asked for a stricter evaluator. Where a public rule was added or changed it
 *   is what a requirement does, and is reported and not counted.
 * - A fault of the pack counts where the checker the campaign stands on does not share it: a
 *   control without its label's verdict, a check never seen to refuse or to pass, a check that
 *   could not run on a stored answer. One both share was there when the operator froze the old
 *   checker, and is listed apart. On 2026-10-08 all 35 of the truss pack's accept controls were
 *   stale, and counted they would have refused every repair of it.
 * - A witness the pack's checks accept once and not again counts, and so does a reject control on
 *   record that they accept: a refusal withdrawn from an answer written to be refused.
 * - A session that started and never ended counts, where no process writes the log. A comparison
 *   is paired within one checker, so an adoption waits for work in flight, and the log cannot tell
 *   a session that was stopped from one still running. The host can, as far as its own processes
 *   go, and the operator says the rest: that the session is over.
 *
 * What counts is the operator's to overrule with a reason, which the freeze keeps, and without one
 * the adoption's events are not to be had (`entries`). Some things are not the operator's: a
 * process writing the log, or a round that ended its session and has not reported or been
 * settled, since a comparison is paired within one checker; a live task the pack's checks cannot
 * be put to at all, since an adoption drops no task and has no state for one it cannot gate; and
 * a check program the log froze before, since a task's version names its check program and the
 * versions of that epoch are spent.
 */
import {
  acceptance,
  type Checker,
  type CheckReading,
  type Control,
  frozenChecker,
  type Regrade,
  regraded,
  runControls,
} from "#src/kernel/acceptance.ts";
import type { Contract } from "#src/kernel/contract.ts";
import {
  type Carried,
  carried,
  epochsOf,
  liveTasks,
  openWork,
  regradings,
  type Witness,
} from "#src/kernel/epoch.ts";
import type { Entry, LogEvent } from "#src/kernel/log.ts";
import { packageGate, type TaskPackage, taskVersion } from "#src/kernel/task.ts";
import { readBrief, type Task, type Verifier } from "#src/kernel/verify.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { pooled } from "#src/meta/pool.ts";
import { requireJsonValue, sameJsonValue, stableJson } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import type { Ruling } from "#src/review/referee.ts";
import { type RepairReading, repairReading } from "#src/review/rejections.ts";
import { writtenTasks } from "../d2/campaign.ts";
import { packSet } from "../m0/stored-sweep.ts";

/** A checker as an adoption reads it: its contract, its staged check program and a verifier over
 *  it, a task as a package under it, and what a solver is shown beside a task as one hash. */
export interface Side {
  readonly checker: Checker;
  readonly contract: Contract;
  readonly checks: string;
  readonly verify: Verifier;
  readonly pack: (task: Task) => TaskPackage;
  readonly shown: string;
}

export interface AdoptionRequest {
  /** The campaign's log before the adoption. */
  readonly events: readonly LogEvent[];
  /** The changed pack: its checker, its own tasks and controls, and whether its tool tree holds a
   *  tool. */
  readonly candidate: Side & {
    readonly tasks: readonly Task[];
    readonly controls: readonly Control[];
    readonly found: (toolId: string) => boolean;
  };
  /** The checker the campaign stands on; null when its staged program is gone from disk, and then
   *  every fault counts and no standing carries. */
  readonly current: Side | null;
  /** Answers a stored sweep holds that may witness a pack's task, by task id. */
  readonly witnesses: ReadonlyMap<string, readonly Witness[]>;
  /** A person's labels of refused answers, which stand over the Referee's rulings. */
  readonly labels: ReadonlyMap<string, Ruling>;
  /** Whether the Referee's rulings in the log count as readings of the old refusals. */
  readonly refereeDecides: boolean;
  /** The processes writing the campaign's log now. */
  readonly running: readonly number[];
  readonly jobs: number;
}

export interface Adoption {
  /** The number the adopted checker would have among the log's. */
  readonly epoch: number;
  readonly asked: "same" | "changed";
  readonly checks: readonly CheckReading[];
  readonly controls: number;
  /** Every answer the log holds a verdict for, under the pack's checks. */
  readonly rows: readonly Regrade[];
  readonly repair: RepairReading;
  /** The pack's faults the standing checker does not share, and the ones it does. */
  readonly faults: readonly string[];
  readonly shared: readonly string[];
  readonly tasks: readonly Carried[];
  /** The solves on record that would stand for a carried version. */
  readonly stood: number;
  /** Sessions the log shows open that no process is running: each counts against, until the
   *  operator says it is over. */
  readonly over: readonly string[];
  /** What the operator may overrule with a reason, and what nobody may. */
  readonly against: readonly string[];
  readonly refused: readonly string[];
  /** The events of the adoption, in the order they are appended. It throws where the adoption is
   *  refused, and where something counts against it and `despite` gives no reason: no caller
   *  appends an adoption the ratchet holds back. */
  readonly entries: (despite: string) => Entry[];
}

const FROZEN = "contract.frozen";

/** Why no adoption starts on this log now, a sentence each. */
function inFlight(events: readonly LogEvent[], running: readonly number[]): string[] {
  const open = openWork(events);
  return [
    ...(running.length > 0
      ? [
          `the campaign's log is being written by pid ${running.join(", ")}: a comparison is paired within one checker, so an adoption waits for the round or the session to end`,
        ]
      : []),
    ...open.unreported.map(
      (session) =>
        `round ${session} ended its session and wrote no report: run it again to its report first, it goes on from its log`,
    ),
    ...open.unsettled.map(
      (session) =>
        `round ${session} reads flags-decide and is not settled: settle it first (tools/d2/settle.ts), since its tasks go stale with the adoption and a label could no longer dispute one`,
    ),
  ];
}

/**
 * The adoption of `candidate` into the campaign whose log is `events`, read and not written.
 *
 * A live task goes on under its own id: as the pack holds it where the pack names that id, and
 * otherwise as the log's last proposal of it holds it. Its solves on record stand for the carried
 * version only where the two checkers show a solver the same contract and public resources, the
 * task reads the same and cites the same rules, and the old version is the one the standing
 * checker gives that content: a pack's task the log never held whole is known to be unchanged
 * only by its version.
 */
export async function adoption(request: AdoptionRequest): Promise<Adoption> {
  const { events, candidate, current, jobs } = request;
  const epochs = epochsOf(events);
  const frozen = frozenChecker(events);
  if (frozen === null) throw new Error("the log froze no checker: a first one is frozen, and not adopted");
  const own = new Map(candidate.tasks.map((task) => [task.taskId, task]));
  const planned = liveTasks(events).map((live) => {
    const task = own.get(live.taskId ?? "") ?? live.task;
    return { live, task: task === null ? null : candidate.pack(task) };
  });
  const unfit = planned.flatMap(({ live, task }) => {
    const named = live.taskId ?? `version ${live.version}`;
    if (task === null) return [`task ${named} is live and neither the pack nor the log holds it whole`];
    const packaged = packageGate(candidate.contract, task);
    return packaged.outcome === "refused"
      ? [`task ${named} cannot be put to the pack's checks: ${packaged.reason}`]
      : [];
  });
  const versions = planned.flatMap(({ task }) => (task === null ? [] : [taskVersion(task)]));
  const twice = versions.find((version, index) => versions.indexOf(version) !== index);
  const refused = [
    ...inFlight(events, request.running),
    ...(epochs.slice(0, -1).some(({ checker }) => checker.checks === candidate.checker.checks) ||
    frozen.checks === candidate.checker.checks
      ? [
          "the log froze this check program before: a task's version names its check program, so the versions of that epoch are spent and it is not adopted again",
        ]
      : []),
    ...unfit.map((line) => `${line}; an adoption drops no task, so the pack has to hold it`),
    ...(twice === undefined
      ? []
      : [`two live versions of one task would be version ${twice} under the pack`]),
  ];

  // The log's answers under the pack's checks. The pack's own task stands where both name one.
  const rows = await regraded(events, [...writtenTasks(events), ...candidate.tasks], candidate.verify, jobs);
  const ruled = request.refereeDecides ? events : events.filter(({ kind }) => kind !== "referee.finding");
  const repair = repairReading(rows, ruled, request.labels);
  const asked = current !== null && current.shown === candidate.shown ? "same" : "changed";
  const loosened =
    asked === "same"
      ? repair.against
      : repairReading(
          rows.filter(({ solve }) => !repair.tightened.includes(solve)),
          ruled,
          request.labels,
        ).against;

  const byId = new Map([...writtenTasks(events), ...candidate.tasks].map((task) => [task.taskId, task]));
  const stored = (verdictOf: (row: Regrade) => Regrade["verdict"]) =>
    rows.flatMap((row) => {
      const [task, verdict] = [byId.get(row.task), verdictOf(row)];
      return task === undefined || verdict === null ? [] : [{ task, verdict }];
    });
  const brief = readBrief(candidate.checks);
  const runs = await runControls(candidate.verify, candidate.tasks, candidate.controls, jobs);
  const read = acceptance(
    brief,
    candidate.tasks,
    runs,
    stored((row) => row.verdict),
    candidate.found,
  );
  // The same controls under the standing checker, less those that name a check it does not have:
  // a new check's own control has nothing to be compared with, and its fault is the pack's.
  const old = current === null ? null : readBrief(current.checks);
  const known = new Set(old?.truthChecks.map((check) => check.id));
  const before =
    current === null || old === null
      ? new Set<string>()
      : new Set(
          acceptance(
            old,
            candidate.tasks,
            await runControls(
              current.verify,
              candidate.tasks,
              candidate.controls.filter(({ refusedBy }) => refusedBy === null || known.has(refusedBy)),
              jobs,
            ),
            stored((row) => row.before),
            candidate.found,
          ).faults,
        );
  const faults = read.faults.filter((fault) => !before.has(fault));

  // Each live task under the pack's checks, with no solve.
  const fit = unfit.length > 0 || twice !== undefined ? [] : planned;
  const tasks = await pooled(fit, jobs, async ({ live, task }) => {
    if (task === null) throw new Error(`task ${live.version} has no package`);
    return await carried(candidate.contract, candidate.verify, {
      live,
      task,
      witnesses: [
        ...(live.witness === null ? [] : [live.witness]),
        ...(request.witnesses.get(task.taskId) ?? []),
      ],
      controls:
        live.controls === null
          ? packSet(candidate.controls, task.taskId)
          : { accepted: null, set: live.controls },
    });
  });
  const stands = fit.flatMap(({ live, task }) => {
    if (asked !== "same" || current === null || task === null) return [];
    const was = current.pack(live.task ?? task);
    const same =
      taskVersion(was) === live.version &&
      sameJsonValue(
        [was.family, was.publicInput, was.ruleIds],
        [task.family, task.publicInput, task.ruleIds],
      );
    return same ? [{ taskId: task.taskId, from: live.version, to: taskVersion(task) }] : [];
  });
  const regrades = regradings(events, stands, rows, candidate.checker.checks);
  const stood = regrades.filter(({ data }) => data.version !== undefined).length;
  const over = request.running.length > 0 ? [] : openWork(events).dangling;
  const against = [
    ...faults,
    ...loosened,
    ...tasks.flatMap((task) => task.faults),
    ...over.map(
      (session) =>
        `session ${session} started and never ended, and no process writes the log now: an adoption waits for a session in flight, so say that this one is over`,
    ),
  ];
  const words = countBy(tasks, ({ word }) => word);
  const ids = (among: (task: Carried) => boolean) =>
    tasks.flatMap((task) => (among(task) ? [task.taskId] : []));
  const epoch = epochs.length + 1;
  const moved = rows.filter(({ was, now }) => was !== now).length;
  const withdrawn = {
    "check-defect": repair.withdrawn["check-defect"].length,
    earned: repair.withdrawn.earned.length,
    unread: repair.withdrawn.unread.length,
  };
  return {
    epoch,
    asked,
    checks: read.checks,
    controls: runs.length,
    rows,
    repair,
    faults,
    shared: read.faults.filter((fault) => before.has(fault)),
    tasks,
    stood,
    over,
    against,
    refused,
    entries: (despite) => {
      if (refused.length > 0) {
        throw new Error(`not adopted: ${refused.join("; ")}. None of it is the operator's to overrule`);
      }
      if (against.length > 0 && despite.trim() === "") {
        throw new Error(
          `not adopted: ${plural(against.length, "finding")} against the pack, and no reason given for adopting it all the same`,
        );
      }
      return [
        {
          kind: "checker.read",
          data: {
            ...candidate.checker,
            controls: runs.length,
            stored: rows.length,
            rows: read.checks.map((row) => ({ ...row, missing: [...row.missing] })),
            faults: [...read.faults],
            moved,
            repair: requireJsonValue(repair),
          },
        },
        {
          kind: FROZEN,
          data: {
            ...candidate.checker,
            epoch,
            continues: { ...frozen },
            asked,
            ...keysIf(against.length > 0, () => ({ despite, faults: against.length })),
          },
        },
        ...tasks.flatMap((task) => task.entries),
        ...regrades,
        {
          kind: "checker.adopted",
          data: {
            ...candidate.checker,
            epoch,
            asked,
            tasks: { feasible: words.feasible ?? 0, waiting: words.waiting ?? 0, reach: words.reach ?? 0 },
            waiting: ids(({ word }) => word === "waiting"),
            reach: ids(({ word }) => word === "reach"),
            // The tasks that had a witness and have none under these checks, and the ones that
            // waited for one and were given it by an answer on record.
            lost: ids(({ word, was }) => word === "reach" && was !== "too-hard"),
            recovered: ids(({ word, was }) => word !== "reach" && was === "too-hard"),
            stood,
            moved,
            withdrawn,
            tightened: repair.tightened.length,
            against: against.length,
            over: [...over],
          },
        },
      ];
    },
  };
}

/**
 * What is left to append of an adoption a crash cut short: `batch` is the adoption read again
 * from the log as it was before it, and `written` what the log holds after its freeze. The log
 * must hold the batch's own events so far and nothing else, since anything else is a history this
 * reading did not plan.
 */
export function remaining(written: readonly LogEvent[], batch: readonly Entry[]): Entry[] {
  const planned = batch.slice(batch.findIndex(({ kind }) => kind === FROZEN) + 1);
  const apart = written.findIndex(({ kind, data }, index) => {
    const entry = planned[index];
    return entry === undefined || entry.kind !== kind || stableJson(entry.data) !== stableJson(data);
  });
  if (apart !== -1) {
    throw new Error(
      `the log holds ${plural(written.length, "event")} after the adoption's freeze, and event ${String(apart + 1)} of them is not the one this pack and this log give: restore the pack as it was adopted and run it again`,
    );
  }
  return planned.slice(written.length);
}
