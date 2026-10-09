/**
 * Whether a paid comparison may start: what the campaign's log holds for it, set against what it
 * asks for.
 *
 * One function decides it, and every way of starting a comparison asks that function. The launcher
 * asks before it spawns anything (`tools/runs/launch.ts`), and a round or a checkpoint asks again
 * before its first event (`admitComparison`), so a command started by hand is refused where a
 * launch of it would be. Until 2026-10-09 the launcher alone held these refusals, and a round
 * started directly on a checker nobody had read went on to pay for its solves.
 *
 * What is refused:
 *
 * - a log with no held-out task, or with fewer to score than a step takes at the level asked for;
 * - a comparison that would leave fewer untied tasks than a step takes. The untied tasks are
 *   counted from the share the campaign's last comparison left untied under the setting of the
 *   log's last test-side solves, and no more are counted than the harness this one is made
 *   against left to win there: after buffer's first step that harness was valid in every solve on
 *   8 of 11 tasks. A task held out since counts whole, and so does every task where the caller
 *   found the comparison asked for under another setting (`restarted`);
 * - a comparison with no dollar cap;
 * - a checker `tools/c/accept.ts` has never read;
 * - a campaign the plan's stop rule has stopped: three checkpoints without a step
 *   (`stopRule`, `docs/plan.md`, Phase 5). The operator may go on past it by saying why
 *   (`--past-stop`), and the reason is logged. Until 2026-10-09 four commands printed the rule's
 *   reading and none acted on it.
 *
 * A rehearsal is exempt from all of it, by name and here: its seats are scripts, which are paid
 * nothing, and it has to be able to walk any path a seed can be cut to. The refusals a comparison
 * makes of its own terms still hold it (`src/builder/round.ts`): a task that is no held-out task,
 * a practice task among the scored, a task that waits for a label.
 *
 * What only a host or an id can refuse stays with the launcher: a second writer of the log, a
 * loaded host, a missing env file, an id whose comparison has reported or whose session was cut.
 * A command answers the last two itself, by saying what it said or by refusing the session.
 */
import { frozenChecker } from "../kernel/acceptance.ts";
import { sweepOf } from "../kernel/compare.ts";
import { settingId } from "../kernel/condition.ts";
import { append, type LogEvent, read } from "../kernel/log.ts";
import { awaitingLabel, lastReports, latestBuilt, promoted, stopRule } from "../kernel/reports.ts";
import { sizeLines } from "../kernel/size.ts";
import { ranUnder } from "../kernel/solves.ts";
import { taskSets } from "../kernel/task.ts";
import { asRecord, isNumber } from "../meta/json-shape.ts";
import type { Cap } from "./round.ts";

/** What a log holds for the next comparison. */
export interface Supply {
  /** The held-out tasks that may be scored, those that wait for a person's label and are left
   *  out, and the tasks released for practice. */
  readonly held: number;
  readonly awaiting: number;
  readonly released: number;
  /** The share of its tallied tasks the last comparison left for the next to untie, under the
   *  setting of the log's last test-side solve and against the harness the next is made with;
   *  null before any such comparison. */
  readonly untied: number | null;
  /** The tasks held out since that comparison tallied. */
  readonly since: number;
  /** The faults of the checker's last reading (`tools/c/accept.ts`), null where the log holds no
   *  reading, and whether the operator has frozen the checker. */
  readonly faults: number | null;
  readonly frozen: boolean;
  /** The plan's stop rule over the comparisons on record. */
  readonly stop: ReturnType<typeof stopRule>;
}

/** What a comparison asks for. */
export interface Wanted {
  /** The tasks to score: `--target`, or as many as `--tasks` names. */
  readonly target: number;
  readonly solves: number;
  readonly level: number;
  /** Whether a Builder session runs before the comparison. */
  readonly builds: boolean;
  readonly cap: Cap | null;
  /** What the caller found where the comparison is asked for under another setting than the log's
   *  last test-side solves ran under, a note each (`tools/d2/setting.ts`); none where it is the same. */
  readonly restarted: readonly string[];
  /** The operator's reason to go on past the stop rule, where one is given. */
  readonly pastStop?: string | undefined;
}

/** A comparison a command is about to start. */
export interface Starting {
  /** Its id: a round's session, or a checkpoint's own. */
  readonly id: string;
  /** The harness it is made against, as `--reference` names it. */
  readonly reference: string;
  readonly wanted: Wanted;
  /** Who sits in the seats: models that are paid, or a rehearsal's scripts. */
  readonly seats: "paid" | "scripted";
}

/** Where a refusal sends its reader for more held-out tasks. */
const EXAMINE = "tools/d1b/examine.ts";
const said = (rows: readonly (readonly [boolean, string])[]) =>
  rows.flatMap(([holds, text]) => (holds ? [text] : []));

/** A log's supply for a comparison made against the harness `reference` names: `starter`,
 *  `promoted` for the campaign's reference harness, `latest`, or a digest. */
export function supplyOf(events: readonly LogEvent[], reference = "promoted"): Supply {
  const sets = taskSets(events);
  const waiting = awaitingLabel(events).filter((version) => sets.held.includes(version));
  const solved = ranUnder(events).findLast(({ under }) => under.side === "test")?.under;
  const setting = solved === undefined ? null : settingId(solved);
  const last = lastReports(events).findLast(
    ({ data }) =>
      Array.isArray(data.versions) &&
      data.versions.length > 0 &&
      asRecord(data.scored) !== null &&
      data.setting === setting,
  )?.data;
  const tally = asRecord(last?.scored);
  const versions = Array.isArray(last?.versions) ? last.versions : [];
  // A task the harness to be compared with was valid on in every solve there can only tie again.
  const kept = reference === "promoted" ? (promoted(events) ?? "starter") : reference;
  const named = kept === "latest" ? latestBuilt(events) : kept === "starter" ? last?.starter : kept;
  const side = last?.old === named ? "old" : "fresh";
  const full = last?.[side] === named ? asRecord(last?.valid)?.[side] : null;
  const closed = Array.isArray(full) && isNumber(full.at(-1)) ? Number(full.at(-1)) : 0;
  const reading = events.findLast(({ kind }) => kind === "checker.read")?.data.faults;
  return {
    held: sets.held.length - waiting.length,
    awaiting: waiting.length,
    released: sets.released.length,
    untied:
      tally !== null && isNumber(tally.wins) && isNumber(tally.losses) && versions.length > 0
        ? Math.min(tally.wins + tally.losses, versions.length - closed) / versions.length
        : null,
    since: sets.held.filter((version) => ![...versions, ...waiting].includes(version)).length,
    faults: Array.isArray(reading) ? reading.length : null,
    frozen: frozenChecker(events) !== null,
    stop: stopRule(events),
  };
}

/** Why a comparison should not start on this supply, and what its reader should know when it does. */
export function admission(supply: Supply, wanted: Wanted) {
  const scored = Math.min(wanted.target, supply.held);
  const [size = "", ...power] = sizeLines(scored, wanted);
  // What a comparison's test can say at this size is arithmetic, and rehearsals found it before a
  // round paid to (2026-10-08): exam-1 held one task to score.
  const least = sweepOf(wanted.level);
  // A share measured of another solver, or under other limits, says little of this comparison.
  const share = wanted.restarted.length === 0 ? (supply.untied ?? 1) : 1;
  // A task held out since that comparison has no share on record, and is counted whole.
  const untied = scored * (share + ((1 - share) * supply.since) / Math.max(1, supply.held));
  // The comparison's test alone: both harnesses, on every scored task.
  const test = 2 * scored * wanted.solves;
  const { cap, pastStop } = wanted;
  const afforded = cap === null ? test : Math.floor(cap.dollars / cap.reserve);
  const more = `Run an Examiner session (${EXAMINE}) for more held-out tasks`;
  const after = `${String(supply.stop.sinceStep)} checkpoints`;
  const refusals = said([
    [
      supply.held === 0,
      "the log holds no held-out task to score: run tools/d2/prepare.ts, which takes the pack's tasks in",
    ],
    [
      supply.held > 0 && scored < least,
      `${size}. ${more}${wanted.target < least ? `, and ask for a --target of ${String(least)} or more` : ""}`,
    ],
    [
      scored >= least && untied < least,
      `the campaign's last comparison left ${String(Math.round(100 * share))}% of its tasks for this one to untie: the rest tied there, or this one's reference harness was valid on them in every solve. At that share ${String(scored)} scored tasks${supply.since > 0 ? `, the ${String(supply.since)} held out since counted whole,` : ""} leave about ${untied.toFixed(1)} untied, where at --level ${String(wanted.level)} a step takes ${String(least)}, all won: this comparison could hardly read a step. ${more}, or change the budget so that fewer tasks tie`,
    ],
    [
      cap === null,
      "no --cap is named: a comparison is launched under a dollar cap, and one the cap cuts short reads not-scored",
    ],
    // The reading was a step done late and by hand in the first live rounds (2026-10-09), and on
    // truss 22 of 32 solves were then rejected, 14 on one check, with nothing to say whose fault.
    [
      supply.held > 0 && supply.faults === null,
      "the campaign's checker has never been read: run tools/c/accept.ts, which puts every control and the do-nothing answer to the checks and says what each check has been seen to do. A comparison on an unread checker pays for rejections nobody can attribute",
    ],
    [
      supply.stop.stop && pastStop === undefined,
      `the campaign has had ${after} since its last step, and the plan stops it at three without one (docs/plan.md, Phase 5). To go on all the same, pass --past-stop "<why>", which is logged`,
    ],
  ]);
  const notes = [
    `${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(scored)} to score`,
    ...(scored < least ? [] : [size, ...power]),
    ...said([
      [
        supply.awaiting > 0,
        `${String(supply.awaiting)} held-out task(s) wait for a person's label and are not scored (tools/d2/prepare.ts)`,
      ],
      [wanted.builds && supply.released === 0, "no task is released: the Builder has nothing to practise on"],
      [
        (supply.faults ?? 0) > 0 && !supply.frozen,
        `the checker's last reading holds ${String(supply.faults)} fault(s) and the operator has not frozen it: a rejection here may be the check's own (tools/c/accept.ts)`,
      ],
      [
        cap !== null && afforded < test,
        `the cap of $${String(cap?.dollars)} holds a reserve of $${String(cap?.reserve)} for ${String(afforded)} solves, and the comparison's test alone makes ${String(test)}${wanted.builds ? ", after a session whose spend the same cap holds" : ""}: it is cut short and reads not-scored unless its solves bill well under their reserve`,
      ],
    ]),
    ...wanted.restarted,
    ...said([
      [
        supply.stop.stop && pastStop !== undefined,
        `going on past the plan's stop rule, ${after} after the last step: ${String(pastStop)}`,
      ],
    ]),
  ];
  return { refusals, notes };
}

/**
 * Admit the comparison a command is about to start on the campaign whose log is `log`, and return
 * what its reader should know; throws every refusal at once where it may not start. One the log
 * already holds a start of, its own or its session's, goes on: it was admitted when it began. A
 * rehearsal is admitted unasked. Where the comparison goes on past the stop rule, the operator's
 * reason is logged under its id, once.
 */
export function admitComparison(log: string, { id, reference, wanted, seats }: Starting): string[] {
  const events = read(log);
  const begun = events.some(
    ({ kind, data }) => (kind === "comparison.started" || kind === "build.started") && data.session === id,
  );
  if (seats === "scripted" || begun) return [];
  const supply = supplyOf(events, reference);
  const { refusals, notes } = admission(supply, wanted);
  if (refusals.length > 0) throw new Error(refusals.join("\n"));
  const overridden = events.some(({ kind, data }) => kind === "stop.overridden" && data.session === id);
  if (supply.stop.stop && wanted.pastStop !== undefined && !overridden) {
    const { checkpoints, sinceStep } = supply.stop;
    append(log, "stop.overridden", { session: id, reason: wanted.pastStop, checkpoints, sinceStep });
  }
  return notes;
}
