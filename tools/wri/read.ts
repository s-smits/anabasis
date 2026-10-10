/**
 * The deterministic read of one campaign's log for a whole-run investigation: six rows of
 * identities the primary reviewer settles, and the triggers that say which of the thirty lanes of
 * `.claude/skills/whole-run-investigation/references/lanes.md` have something to read.
 *
 * v1's readers walked a campaign folder of some forty record kinds: claims, promotions, epochs,
 * batteries, case records, Builder executions, reviews. v2 keeps one append-only log, and everything
 * a lane starts from is a fold of it, so this file replaces v1's thirteen readers and reads nothing
 * else: no harness state, no pack, no file beside the log.
 *
 * A trigger is a capitalised name, the lane it starts and one line of counts. It says a lane has
 * something to read and never what the answer is: a lane that contradicts its trigger from the
 * bytes has done its job. A trigger that did not fire says this arithmetic found nothing, and not
 * that the property is absent. No trigger carries an answer, a task's text or a hidden value.
 *
 * The folds of the log, the catalogue of triggers and the lanes of the exam side (1 to 12) are
 * `folds.ts` since 10 October, when this file was over the size policy's ceiling. This file keeps
 * the lanes of the harness, the comparison, the solve and the review (13 to 30), the rows and the
 * overview.
 */
import { signP } from "#src/kernel/compare.ts";
import type { Condition } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import {
  type Build,
  BUILD_END,
  type Compared,
  count,
  EXAM_END,
  fired,
  type Index,
  indexOf,
  instrumentTriggers,
  items,
  percent,
  practiceOf,
  REPORTED,
  share,
  short,
  SMALL_WALL_SHARE,
  type Solve,
  spendOf,
  strings,
  tally,
  taskTriggers,
  TEST,
  text,
  type Trigger,
} from "./folds.ts";

export interface Row {
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
}

export interface Overview {
  readonly rows: readonly Row[];
  readonly triggers: readonly Trigger[];
}

/** The share of a wall past which a miss is read as bound by it, as v1's climb read it. */
const WALL_BOUND_SHARE = 0.95;
const FEW_CALLS = 3;
/** The factor between the loads two comparisons ran under from which they are read as made on
 *  different hosts, and the load under which no factor is worth a line: a load of four moves no
 *  wall on a host of four cores or more. On 2026-10-09 one harness answered the same tasks in a
 *  median of 105 s under a load of 31 and of 40 s under a load of 6. */
const LOAD_MOVED = 2;
const LOAD_WORTH_A_LINE = 4;
/** Minutes of silence in the log worth a line. */
const SILENCE_MINUTES = 20;
const EXAM_START = "exam.started";
/** The Builder tools that write one named file: pi's two, and the one tool sessions had before them. */
const FILE_WRITERS: ReadonlySet<string> = new Set(["write", "edit", "write_file"]);

/** A Builder session as the lanes of its practice read it: the log's record of it, whether it changed
 *  the harness and to what, the harness its comparison was made against, and the solves of its round. */
interface PractisedSession {
  readonly build: Build;
  readonly changed: boolean;
  /** The digest of the harness the session left, or "" where it finished with none. */
  readonly child: string;
  /** The reference harness of the comparison, which need not be the one the session started from.
   *  A report written before 2026-10-09 names none: it compared with its parent. */
  readonly reference: string;
  readonly round: {
    readonly practice: readonly Solve[];
    readonly scoring: readonly Solve[];
    readonly scoredSet: ReadonlySet<string>;
  };
}

/** Lanes 16 to 19: one session's practice, and what its comparison then showed of it. */
function practiceTriggers(
  log: Index,
  { build, changed, child, reference, round }: PractisedSession,
): Trigger[] {
  const { session, finished, calls } = build;
  // A practice solve's condition names the state it ran under, so the log says by digest whether
  // the harness that was measured is one the Builder tried: an edit made with the shell leaves no
  // call to count, and a digest misses none.
  const practisedUnder = new Set(round.practice.map((solve) => solve.harness));
  const lastPractice = round.practice.at(-1);
  const ended = finished === null ? "never finished" : text(finished.ended);
  const failed = round.practice.filter((solve) => solve.outcome === "fail");
  const earned = failed.filter((fail) => log.rulings.get(fail.id)?.ruling === "earned").length;
  // A fail followed by a pass of the same task: under other bytes it may be the change answering
  // the fail, and under the same bytes it is the solver's variance and answers nothing.
  const laterPass = (fail: Solve, same: boolean) =>
    round.practice.some(
      (later) =>
        later.version === fail.version &&
        later.index > fail.index &&
        later.outcome === "pass" &&
        (later.harness === fail.harness) === same,
    );
  const answered = failed.filter((fail) => laterPass(fail, false)).length;
  const flipped = failed.filter((fail) => laterPass(fail, true)).length;
  const exposed = [...round.scoredSet].filter((version) => build.practice.has(version)).length;
  const shell = calls.filter(({ tool }) => tool === "bash").length;
  const lostBefore = new Set(
    round.scoring
      .filter((solve) => solve.harness === reference && solve.outcome === "fail")
      .map((solve) => solve.version),
  );
  const quickWins = round.scoring.filter(
    (solve) =>
      solve.harness === child &&
      solve.outcome === "pass" &&
      lostBefore.has(solve.version) &&
      solve.seconds < solve.wallSeconds * SMALL_WALL_SHARE &&
      solve.calls.length <= FEW_CALLS,
  ).length;
  return [
    ...(changed && lastPractice === undefined
      ? [fired("NO PRACTICE", `${session}: the harness changed and no practice solve ran`)]
      : []),
    ...(changed && child !== "" && lastPractice !== undefined && !practisedUnder.has(child)
      ? [
          fired(
            "FINAL BYTES NEVER PRACTISED",
            `${session}: no practice solve ran under ${short(child)}, the harness measured; the last ran under ${short(lastPractice.harness)}`,
          ),
        ]
      : []),
    ...(ended === "finished" ? [] : [fired("SESSION ENDED", `${session}: ${ended}`)]),
    ...(failed.length > 0
      ? [
          fired(
            "PRACTICE FAILS",
            `${session}: ${plural(failed.length, "fail")}, ${String(earned)} ruled earned; the same task passed later under changed bytes ${String(answered)}, under the same bytes ${String(flipped)}`,
          ),
        ]
      : []),
    ...(exposed > 0
      ? [
          fired(
            "PRACTISED TASK MEASURED",
            `${session}: ${plural(exposed, "task")} both practised and measured`,
          ),
        ]
      : []),
    ...(shell > 0 ? [fired("SHELL COMMANDS", `${session}: ${plural(shell, "command")} to read`)] : []),
    ...(quickWins > 0
      ? [
          fired(
            "WIN AT A SMALL WALL SHARE",
            `${session}: ${String(quickWins)} passed solves of tasks the reference harness failed, in few calls`,
          ),
        ]
      : []),
  ];
}

/** Lanes 13 to 19: the harness, which is the Builder's. */
function harnessTriggers(log: Index): Trigger[] {
  return log.builds.flatMap((build) => {
    const { session, finished, parent, calls } = build;
    const compared = log.compared.find((each) => each.build === build);
    const round = {
      practice: practiceOf(log, build),
      scoring: compared?.scoring ?? [],
      scoredSet: compared?.scoredSet ?? new Set<string>(),
    };
    const changed = finished?.changed === true;
    const child = text(finished?.harness);
    // pi's `write` and `edit` since 2026-10-09, and `write_file` in the sessions before it.
    const written = [
      ...new Set(calls.flatMap(({ tool, args }) => (FILE_WRITERS.has(tool) ? [text(args?.path)] : []))),
    ];
    const toolFiles = written.filter((path) => path.includes("tools"));
    // A stop writes no end record, so a session it cut says nothing of what it changed: recode's
    // b-1 wrote its harness for forty minutes and this read none of it (2026-10-10).
    const cut = finished === null && written.length > 0;
    const fresh = log.solves.filter((solve) => changed && solve.harness === child && solve.side === TEST);
    const erring = fresh.filter((solve) => solve.errors > 0).length;
    return [
      ...(changed || cut
        ? [
            fired(
              "HARNESS CHANGED",
              `${session}: ${short(parent)} to ${cut ? "what a stop left unsaved" : short(child)}; written by its file tools: ${written.join(", ") || "nothing"}`,
            ),
          ]
        : []),
      ...(isString(finished?.broken)
        ? [
            fired(
              child === "" ? "BROKEN AT END" : "MEASURED AN EARLIER STATE",
              `${session}: what the session left does not open`,
            ),
          ]
        : []),
      ...(changed && !calls.some(({ tool }) => tool === "check_harness")
        ? [fired("NEVER CHECKED", `${session}: no check_harness call`)]
        : []),
      ...(fresh.length > 0
        ? [
            fired(
              "TOOLS CALLED",
              `${session}: ${tally(
                countBy(
                  fresh.flatMap((solve) => solve.calls),
                  (tool) => tool,
                ),
              )}`,
            ),
          ]
        : []),
      ...(erring * 4 > fresh.length
        ? [
            fired(
              "TOOL CALLS ERRED",
              `${session}: in ${share(erring, fresh.length)} solves under the new harness`,
            ),
          ]
        : []),
      ...(toolFiles.length > 0 ? [fired("TOOLS EDITED", `${session}: ${toolFiles.join(", ")}`)] : []),
      ...practiceTriggers(log, {
        build,
        changed,
        child,
        reference: text(compared?.own.old) || parent,
        round,
      }),
    ];
  });
}

/** Lanes 22 and 23, from a comparison's last report alone: whether it scored a task, what its cap
 *  cut, how many of its pairs tell the harnesses apart, what it is short of, and how its new harness
 *  stands against the starter. */
function testTriggers(session: string, last: JsonObject): Trigger[] {
  const scored = asRecord(last.scored);
  const informative = count(scored?.wins) + count(scored?.losses);
  const tasks = informative + count(scored?.ties);
  const level = count(last.level);
  // The least clean sweep that clears the report's level, by the report's own test.
  const sweep = Array.from({ length: 64 }, (_, index) => index + 1).find((wins) => signP(wins, 0) <= level);
  // No result with a loss clears on this many informative pairs: the reading rests on a sweep.
  const fragile = signP(Math.max(0, informative - 1), 1) > level;
  const asked = last.tasks;
  const lacking = items(last.short).length;
  const against = asRecord(last.against);
  return [
    ...(scored !== null && tasks === 0
      ? [
          fired(
            "NOTHING SCORED",
            `${session}: no task was scored${isNumber(asked) ? `, of ${String(asked)} asked for` : ""}; the report reads ${text(last.reading)}`,
          ),
        ]
      : []),
    ...(last.capped === true
      ? [
          fired(
            "CUT BY ITS CAP",
            scored === null
              ? `${session}: the dollar cap ended it before it was read`
              : `${session}: the dollar cap ended the starter's solves; its test stands, unread against the starter`,
          ),
        ]
      : []),
    ...(scored !== null && tasks > 0 && level > 0 && fragile
      ? [
          fired(
            "FEW INFORMATIVE PAIRS",
            `${session}: ${share(informative, tasks)} tasks tell the harnesses apart; at level ${String(level)} the least sweep that clears is ${String(sweep ?? 0)}-0, and no result with a loss clears on ${plural(informative, "pair")}`,
          ),
        ]
      : []),
    ...(lacking > 0 ? [fired("SET SHORT", `${session}: ${String(lacking)} short of solves`)] : []),
    ...(against !== null && count(against.wins) < count(against.losses)
      ? [
          fired(
            "BELOW THE STARTER",
            `${session}: ${String(count(against.wins))} won and ${String(count(against.losses))} lost against the starter; the report reads ${text(last.reading)}`,
          ),
        ]
      : []),
    ...(last.reading === "starter-unread"
      ? [
          fired(
            "STARTER UNREAD",
            `${session}: its test clears its level and the starter has not its solves on every tallied task`,
          ),
        ]
      : []),
  ];
}

/** Lanes 20 to 25: the comparison, which is the host's. */
function comparisonTriggers(log: Index): Trigger[] {
  const hosts = new Set([...log.conditions.values()].map((condition) => condition.host)).size;
  const perComparison = log.compared.flatMap(({ session, own, last, scoring }) => {
    // The rejections that set a task aside: not ruled a true fail, on a task the report names.
    const aside = new Set(strings(own.aside));
    const open = scoring.filter(
      (solve) =>
        solve.kind === "rejected" &&
        aside.has(solve.version) &&
        log.rulings.get(solve.id)?.ruling !== "earned",
    );
    const underOld = open.filter((solve) => solve.harness === own.old).length;
    const level = count(last.level);
    // The tasks a comparison scores are fixed at its start, before any solve. One that reported
    // other tasks than it began with lost them on the way: to a dispute, or short of their solves.
    const began = log.events.find(
      ({ kind, data }) => kind === "comparison.started" && data.session === session,
    )?.data;
    const fixed = strings(began?.tasks);
    const moved = fixed.filter((version) => !strings(last.versions).includes(version)).length;
    const seen = new Map<string, Set<string>>();
    for (const solve of scoring.filter((each) => each.outcome === "pass" || each.outcome === "fail")) {
      const key = `${solve.version} ${solve.harness}`;
      seen.set(key, (seen.get(key) ?? new Set()).add(text(solve.outcome)));
    }
    const flips = [...seen.values()].filter((outcomes) => outcomes.size > 1).length;
    const noise = asRecord(last.noise);
    return [
      ...(moved > 0
        ? [
            fired(
              "SCORED SET MOVED",
              `${session}: ${share(moved, fixed.length)} tasks it began with are not in its tally`,
            ),
          ]
        : []),
      ...(open.length > 0
        ? [
            fired(
              "SET ASIDE BY SIDE",
              `${session}: ${plural(open.length, "rejection")} set ${plural(aside.size, "task")} aside, ${String(underOld)} under the reference harness and ${String(open.length - underOld)} under the others`,
            ),
          ]
        : []),
      ...testTriggers(session, last),
      ...(flips > 0
        ? [
            fired(
              "FLIPS",
              `${session}: ${share(flips, seen.size)} task and harness pairs both passed and failed`,
            ),
          ]
        : []),
      ...(noise === null
        ? []
        : [
            fired(
              "REFERENCE AGAINST ITSELF",
              `${session}: ${String(count(noise.wins))} won, ${String(count(noise.losses))} lost and ${String(count(noise.ties))} tied between two samples of the reference harness${Math.min(signP(count(noise.wins), count(noise.losses)), signP(count(noise.losses), count(noise.wins))) <= level ? ", which reads a step where none can be" : ""}`,
            ),
          ]),
    ];
  });
  const chain = log.compared.map(({ session, own, last, build }) => {
    const fresh = isString(last.fresh) ? short(last.fresh) : "none";
    // A report written before 2026-10-09 names no reference harness: it compared with its parent.
    return `${session} ${short(text(own.old) || (build?.parent ?? ""))}>${fresh} ${text(last.reading)}`;
  });
  // A step is repeated once on fresh solves before anything is promoted: a second comparison of
  // the same two harnesses.
  const sidesOf = ({ own, last }: Compared) => `${text(own.old)} ${text(last.fresh)}`;
  const steps = log.compared.filter(({ last }) => last.reading === "step");
  const unrepeated = steps.filter(
    (step) => !log.compared.some((other) => other !== step && sidesOf(other) === sidesOf(step)),
  ).length;
  return [
    ...(hosts > 1
      ? [fired("HOST CODE MOVED", `${String(hosts)} versions of the host's code in one log`)]
      : []),
    ...perComparison,
    ...(chain.length > 0 ? [fired("CHAIN", chain.join("; "))] : []),
    ...(unrepeated > 0
      ? [
          fired(
            "STEP NOT REPEATED",
            `${plural(unrepeated, "step")} no second comparison of the same two harnesses has repeated`,
          ),
        ]
      : []),
    ...(log.states.size > 0 && log.held.length === 0
      ? [fired("NO TASK HELD OUT", "no task is held out, so a comparison has nothing to score")]
      : []),
  ];
}

/** Lane 26's wall and load: the misses bound by the wall, the share of it each harness used, and
 *  the host's load when each comparison's solves started. */
function wallTriggers(log: Index): Trigger[] {
  const missed = log.solves.filter((solve) => solve.outcome === "fail");
  const walled = missed.filter(
    (solve) => solve.kind === "wall-ended" || solve.seconds > solve.wallSeconds * WALL_BOUND_SHARE,
  ).length;
  const wallShares = log.compared.flatMap(({ session, own, scoring }) => {
    // The median share of its wall a harness's solves used, or null for none under a wall. v1 read
    // this share as the measure that moves on every battery and leads a fail (lane 26).
    const under = (harness: JsonValue | undefined) =>
      median(
        scoring.flatMap((solve) =>
          solve.harness === harness && solve.wallSeconds > 0 ? [solve.seconds / solve.wallSeconds] : [],
        ),
      );
    const [before, after] = [under(own.old), under(own.fresh)];
    return before === null || after === null || own.old === own.fresh
      ? []
      : [
          fired(
            "WALL SHARE",
            `${session}: median ${percent(before)} under the reference harness, ${percent(after)} under the new`,
          ),
        ];
  });
  // The one-minute load each comparison's solves started under. A wall counts the clock, so the
  // same wall holds less work on a loaded host: a comparison made there reaches walls an idle host
  // would not, and two comparisons under different loads were not made under one budget, whatever
  // their settings say.
  const loads = log.compared.flatMap(({ session, scoring }) => {
    const at = scoring.flatMap((solve) => (solve.load === null ? [] : [solve.load]));
    const middle = median(at);
    const cores = scoring.findLast((solve) => solve.cores !== null)?.cores ?? null;
    return middle === null ? [] : [{ session, middle, most: Math.max(...at), cores }];
  });
  const loaded = loads.flatMap(({ session, middle, most, cores }) =>
    cores !== null && middle > cores
      ? [
          fired(
            "HOST LOADED",
            `${session}: load ${middle.toFixed(1)} at the median and ${most.toFixed(1)} at most when its solves started, on ${plural(cores, "core")}`,
          ),
        ]
      : [],
  );
  const middles = loads.map(({ middle }) => middle);
  const [calmest, busiest] = [Math.min(...middles), Math.max(...middles)];
  const moved = loads.length > 1 && busiest >= LOAD_WORTH_A_LINE && busiest >= calmest * LOAD_MOVED;
  return [
    ...(walled > 0 ? [fired("WALL-BOUND MISSES", share(walled, missed.length))] : []),
    ...wallShares,
    ...loaded,
    ...(moved
      ? [
          fired(
            "LOAD MOVED",
            `median load when each comparison's solves started: ${loads.map(({ session, middle }) => `${session} ${middle.toFixed(1)}`).join("; ")}`,
          ),
        ]
      : []),
  ];
}

/** Lanes 26 to 28: the solve, its failure and the cost. */
function solveTriggers(log: Index): Trigger[] {
  const done = log.solves.filter((solve) => solve.outcome !== null);
  const missed = done.filter((solve) => solve.outcome === "fail");
  const starved = done.filter(
    (solve) => solve.cpu !== null && solve.seconds > 60 && solve.cpu < solve.seconds * 0.02,
  );
  // A solve with a command cut before its CPU time was read has a floor for its CPU and no
  // reading. A comparison's report sums what was measured, so a budget or a spread in `cpu` is
  // read low on these solves.
  const cut = done.filter((solve) => solve.unmeasured > 0);
  const cutBy = log.compared.flatMap(({ session, scoring }) => {
    const mine = scoring.filter((solve) => solve.unmeasured > 0).length;
    return mine === 0 ? [] : [`${session}: ${share(mine, scoring.length)} of its solves`];
  });
  // An Examiner session writes its ending as a Builder's does; one with a start and no ending
  // was cut, or is still running.
  const examined = new Set(log.of(EXAM_END).map((data) => text(data.session)));
  const unended = log.of(EXAM_START).flatMap((data) => {
    const session = text(data.session);
    return examined.has(session) ? [] : [session];
  });
  const non = done.filter((solve) => solve.outcome === "non-result");
  const unjudged = countBy(
    missed.filter((solve) => solve.kind !== "rejected"),
    (solve) => solve.kind ?? "unkinded",
  );
  const ends = [...log.of(BUILD_END), ...log.of(EXAM_END)];
  const crashed = ends.filter((data) => isString(data.crash) || data.ended === "crashed");
  const times = log.events.map((event) => Date.parse(event.at));
  const gaps = times.flatMap((at, index) =>
    at - (times[index - 1] ?? at) > SILENCE_MINUTES * 60_000 ? [index] : [],
  );
  const spend = spendOf(log);
  // Non-results by harness in each comparison: a side whose bad solves are run again is favoured.
  const rerun = log.compared.flatMap(({ session, own, scoring }) => {
    const mine = scoring.filter((solve) => solve.outcome === "non-result");
    const under = mine.filter((solve) => solve.harness === own.old).length;
    return mine.length === 0
      ? []
      : [
          `${session}: ${String(under)} under the reference harness, ${String(mine.length - under)} under the others`,
        ];
  });
  const total = spend.reduce((sum, [, dollars]) => sum + dollars, 0);
  const [[leader, most] = ["", 0]] = spend;
  return [
    ...wallTriggers(log),
    ...(starved.length > 0 ? [fired("LONG SOLVE, LITTLE CPU", plural(starved.length, "solve"))] : []),
    ...(cut.length > 0
      ? [
          fired(
            "CPU UNMEASURED",
            [
              `${share(cut.length, done.length)} finished solves cut a command before its CPU time was read`,
              ...cutBy,
            ].join("; "),
          ),
        ]
      : []),
    ...(non.length > 0
      ? [
          fired(
            "NON-RESULTS",
            [
              `${share(non.length, done.length)}; ${tally(countBy(non, (solve) => solve.kind ?? "unkinded"))}`,
              ...rerun,
            ].join("; "),
          ),
        ]
      : []),
    ...(log.solves.length > done.length
      ? [fired("SOLVE NEVER FINISHED", plural(log.solves.length - done.length, "solve"))]
      : []),
    ...(unended.length > 0 ? [fired("EXAMINER NEVER FINISHED", unended.join(", "))] : []),
    ...(Object.keys(unjudged).length > 0 ? [fired("MISSES WITHOUT A VERDICT", tally(unjudged))] : []),
    ...(crashed.length > 0
      ? [fired("SESSION CRASHED", crashed.map((data) => text(data.session)).join(", "))]
      : []),
    ...(gaps.length > 0
      ? [
          fired(
            "SILENCE",
            `${plural(gaps.length, "gap")} over ${String(SILENCE_MINUTES)} minutes, the first before ${log.events[gaps[0] ?? 0]?.at ?? ""}`,
          ),
        ]
      : []),
    ...(total > 0 && leader !== "solver" && most > total / 2
      ? [fired("SPEND LED BY A ROLE", `${leader}: ${percent(most / total)} of billed dollars`)]
      : []),
  ];
}

/** Lanes 29 and 30: the review loop. */
function reviewTriggers(log: Index): Trigger[] {
  const diagnoses = [...log.diagnoses.values()];
  const abstained = diagnoses.filter((data) => isString(data.abstain)).length;
  const owners = countBy(
    diagnoses.filter((data) => isString(data.owner)),
    (data) => text(data.owner),
  );
  const moved = [...log.rulings].filter(([solve, data]) => {
    const replay = asRecord(data.replay);
    return replay !== null && replay.kind !== log.verdicts.get(solve)?.kind;
  }).length;
  const disputed = new Set(
    [...log.states].flatMap(([version, state]) => (state === "disputed" ? [version] : [])),
  );
  // The tasks a comparison set aside that no settling has decided since.
  const waiting = new Set(
    log.compared.flatMap(({ last }) => (asRecord(last.settled) === null ? strings(last.aside) : [])),
  );
  const standing = [...waiting].filter((version) => !disputed.has(version)).length;
  const ends = [...log.of(BUILD_END), ...log.of(EXAM_END), ...log.of(REPORTED)];
  const faults = ends.reduce((sum, data) => sum + items(data.reviewFaults).length, 0);
  const unprobed = [...log.rulings.values()].filter(
    (data) => data.ruling === "earned" && items(data.probes).length === 0 && count(data.turns) > 0,
  ).length;
  return [
    ...(diagnoses.length > 0
      ? [
          fired(
            "DIAGNOSES",
            `${String(diagnoses.length)}, ${String(abstained)} abstained; owners: ${tally(owners)}`,
          ),
        ]
      : []),
    ...(moved > 0 ? [fired("REPLAY MOVED THE VERDICT", plural(moved, "ruling"))] : []),
    ...(standing > 0
      ? [
          fired(
            "SET ASIDE AND UNSETTLED",
            `${plural(standing, "task")} left out of a comparison on a rejection no person has labelled`,
          ),
        ]
      : []),
    ...log.compared.flatMap(({ session, own, last }) => {
      // The tally were every rejection that set a task aside to stand, beside the one without them.
      const [counted, scored] = [asRecord(own.counted), asRecord(own.scored)];
      const level = count(own.level);
      const clears = (tested: JsonObject) => count(tested.p) <= level;
      const settled = asRecord(last.settled);
      return [
        ...(counted === null || scored === null || clears(counted) === clears(scored)
          ? []
          : [
              fired(
                "READING MOVES WITH THE SET-ASIDE",
                `${session}: ${String(count(scored.wins))}-${String(count(scored.losses))} without the ${plural(items(own.aside).length, "task")} set aside, ${String(count(counted.wins))}-${String(count(counted.losses))} were their rejections to stand, and only one of the two clears its level`,
              ),
            ]),
        ...(settled === null
          ? []
          : [
              fired(
                "SETTLED BY HAND",
                `${session}: ${plural(count(settled.labelled), "rejection")} labelled, ${String(count(settled.defects))} a check defect, ${plural(items(settled.disputed).length, "task")} disputed and ${String(items(settled.restored).length)} restored; the comparison's own report read ${text(own.reading)}, the settled one reads ${text(last.reading)}`,
              ),
            ]),
      ];
    }),
    ...(faults > 0 ? [fired("REVIEW FAULTS", plural(faults, "reviewer failure"))] : []),
    ...(unprobed > 0 ? [fired("EARNED WITHOUT A PROBE", share(unprobed, log.rulings.size))] : []),
  ];
}

/** Rows A to F: the identities every finding binds to. */
function rowsOf(log: Index): Row[] {
  const conditions = [...log.conditions.values()];
  const distinct = (pick: (condition: Condition) => string) => String(new Set(conditions.map(pick)).size);
  const frozen = log.of("contract.frozen").at(-1);
  const proposals = log.of("task.proposed");
  const having = (field: string) => String(proposals.filter((data) => isString(data[field])).length);
  const done = log.solves.filter((solve) => solve.outcome !== null);
  const partition = (side: string) =>
    tally(
      countBy(
        done.filter((solve) => solve.side === side),
        (solve) => `${solve.outcome ?? ""} ${solve.kind ?? ""}`.trim(),
      ),
    );
  const sessions = log.builds.map((build) => {
    const child = isString(build.finished?.harness) ? short(build.finished.harness) : "none";
    const ended = text(build.finished?.ended) || "never";
    return `${build.session}: ${short(build.parent)} > ${child}, ended ${ended}, ${String(count(build.finished?.practiceSolves))} practice solves, reading ${text(build.report?.reading) || "none"}`;
  });
  return [
    {
      id: "A",
      title: "campaign and log",
      lines: [
        `${plural(log.events.length, "event")}, ${log.events[0]?.at ?? ""} to ${log.events.at(-1)?.at ?? ""}`,
        `${plural(log.builds.length, "Builder session")}, ${plural(log.of(EXAM_START).length, "Examiner session")}, ${plural(log.of(REPORTED).length, "report")}`,
        `billed dollars: ${spendOf(log)
          .map(([role, dollars]) => `${role} ${dollars.toFixed(2)}`)
          .join(", ")}`,
      ],
    },
    {
      id: "B",
      title: "checker identity",
      lines: [
        frozen === undefined
          ? "not frozen"
          : `frozen: contract ${short(text(frozen.contract))}, check program ${short(text(frozen.checks))}`,
        `${plural(log.of("checker.read").length, "reading")}; contracts among conditions: ${distinct((condition) => condition.contract)}`,
      ],
    },
    {
      id: "C",
      title: "conditions",
      lines: [
        `${plural(conditions.length, "condition")}: ${tally(countBy(conditions, (condition) => `${condition.side} ${condition.model}`))}`,
        `host code ${distinct((condition) => condition.host)}, sandbox ${distinct((condition) => condition.sandbox)}, verifier tools ${distinct((condition) => condition.verifierTools)}, harnesses ${distinct((condition) => condition.harness)}`,
        `${share(done.filter((solve) => !solve.attested).length, done.length)} finished solves name no response model`,
      ],
    },
    {
      id: "D",
      title: "task sets",
      lines: [
        `${plural(proposals.length, "task")}: ${having("session")} written by a session, ${having("carried")} carried, the rest the pack's`,
        `states: ${tally(countBy([...log.states.values()], (state) => state))}`,
        `${plural(log.held.length, "task")} held out, for a comparison to score; ${String(log.released.length)} released for practice`,
      ],
    },
    {
      id: "E",
      title: "case partition",
      lines: [
        `test side: ${partition(TEST)}`,
        // A log written before 2026-10-09 holds solves of a stronger condition, which no comparison counts.
        ...(done.some((solve) => solve.side === "strong") ? [`strong side: ${partition("strong")}`] : []),
        `${plural(log.solves.length - done.length, "solve")} never finished`,
      ],
    },
    { id: "F", title: "sessions and the harness chain", lines: sessions },
  ];
}

/** The rows and the triggers of one log. */
export function overview(events: readonly LogEvent[]): Overview {
  const log = indexOf(events);
  return {
    rows: rowsOf(log),
    triggers: [
      ...instrumentTriggers(log),
      ...taskTriggers(log),
      ...harnessTriggers(log),
      ...comparisonTriggers(log),
      ...solveTriggers(log),
      ...reviewTriggers(log),
    ],
  };
}

/** The overview as the brief prints it: each row, then each trigger on a line of its own. */
export function rendered({ rows, triggers }: Overview): string {
  return [
    ...rows.flatMap((row) => [`${row.id}. ${row.title}`, ...row.lines.map((line) => `   ${line}`)]),
    "",
    ...triggers.map((trigger) => `${trigger.name} (lane ${String(trigger.lane)}): ${trigger.detail}`),
  ].join("\n");
}
