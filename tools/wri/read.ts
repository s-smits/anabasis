/**
 * The deterministic read of one campaign's log for a whole-run investigation: six rows of
 * identities the primary reviewer settles, and the triggers that say which of the thirty-one lanes of
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
 * Lane 22 reads the recorded tally and power at its margins. Reversing one win establishes
 * neither a small sample nor dependence on winning every task, so it starts no trigger.
 *
 * The folds of the log, the catalogue of triggers and the lanes of the exam side (1 to 12) are
 * `folds.ts` since 10 October, when this file was over the size policy's ceiling. This file keeps
 * the lanes of the harness, the comparison, the solve and the review (13 to 30), the rows and the
 * overview. The climb's lane (31) is `promotion.ts`. The lanes that read the clock (26 and 28) and
 * row A's hours are `time.ts`, split from here on the same day for the same ceiling.
 * Practice gaps retain whether a state was frozen at session end or entered a comparison, with
 * that comparison's start boundary and report status. Score readers still use reports alone.
 */
import { comparisonsOf } from "#src/campaign/ground.ts";
import { short } from "#src/campaign/move.ts";
import { campaignOf as handoverOf, type Handover, nextBound, openSteps } from "#src/campaign/handover.ts";
import { differenceOf, readsStepEitherWay } from "#src/kernel/compare.ts";
import type { Condition } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { pairsReported } from "#src/kernel/reports.ts";
import { billedAll } from "#src/kernel/trace.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import {
  admittedCost,
  type Build,
  BUILD_END,
  count,
  EXAM_END,
  EXAM_START,
  fired,
  type Index,
  indexOf,
  instrumentTriggers,
  items,
  measured,
  practiceOf,
  REPORTED,
  share,
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
import { safeguardTriggers } from "./climb.ts";
import { promotionTriggers, testedOf } from "./promotion.ts";
import { costTriggers, hoursLine, wallTriggers } from "./time.ts";

export interface Row {
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
}

export interface Overview {
  readonly rows: readonly Row[];
  readonly triggers: readonly Trigger[];
}

/** Whether two harnesses, by digest, are one harness for the lanes that read practice. */
type Same = (a: string, b: string) => boolean;

type PracticeCandidate = { readonly harness: string; readonly began: number } & (
  | { readonly origin: "frozen" }
  | { readonly origin: "comparison"; readonly id: string; readonly reported: boolean }
);

const FEW_CALLS = 3;
/** The Builder tools that write one named file: pi's two, and the one tool sessions had before them. */
const FILE_WRITERS: ReadonlySet<string> = new Set(["write", "edit", "write_file"]);

/** A Builder session as the lanes of its practice read it: the log's record of it, whether it changed
 *  the harness and to what, the harness its comparison was made against, and the solves of its round. */
interface PractisedSession {
  readonly build: Build;
  readonly changed: boolean;
  /** The digest of the harness the session left, or "" where it finished with none. */
  readonly child: string;
  /** Frozen and compared states, with the boundary before which practice must have run. */
  readonly read: readonly PracticeCandidate[];
  /** The reference harness of the comparison, which need not be the one the session started from.
   *  A report written before 2026-10-09 names none: it compared with its parent. */
  readonly reference: string;
  readonly round: {
    readonly practice: readonly Solve[];
    readonly scoring: readonly Solve[];
    /** The scored tasks a practice solve of the session ran before the comparison that scored
     *  them began: a task released after a comparison scored it was not exposed to it. */
    readonly exposed: ReadonlySet<string>;
  };
}

/** Lanes 16 to 19: one session's practice, and what its comparison then showed of it. */
function practiceTriggers(
  log: Index,
  { build, changed, child, read, reference, round }: PractisedSession,
  alike: Same,
): Trigger[] {
  const { session, finished, calls } = build;
  // A practice solve's condition names the state it ran under, so the log says by digest whether
  // the harness that was measured is one the Builder tried: an edit made with the shell leaves no
  // call to count, and a digest misses none. Practice after its comparison began counts for none.
  // Two digests whose states differ only in bytecode a practice run left are one harness (`alike`).
  const lastPractice = round.practice.at(-1);
  const unpractised = read.flatMap((candidate) => {
    const prior = round.practice.filter((solve) => solve.index < candidate.began);
    if (prior.some((solve) => alike(solve.harness, candidate.harness))) return [];
    const last = prior.at(-1);
    const origin =
      candidate.origin === "frozen"
        ? "frozen at session end; no comparison uses it"
        : candidate.reported
          ? `reported comparison ${candidate.id}`
          : `comparison ${candidate.id} begun without a report`;
    return [
      fired(
        "FINAL BYTES NEVER PRACTISED",
        `${session}: no practice solve ran under ${short(candidate.harness)}, ${origin}; ${last === undefined ? "no earlier practice solve" : `the last ran under ${short(last.harness)}`}`,
      ),
    ];
  });
  // A session with no end record may still be running when the log is read: it is not finished by
  // the log's last event, which is not the same as a session cut short.
  const ended = finished === null ? "not finished by the log's last event" : text(finished.ended);
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
  const exposed = round.exposed.size;
  const shell = calls.filter(({ tool }) => tool === "bash").length;
  // A task lost in one comparison is no loss of another's: recode's b-1 was measured twice.
  const lost = (solve: Solve) => `${String(solve.comparison)} ${solve.version}`;
  const lostBefore = new Set(
    round.scoring.filter((solve) => solve.harness === reference && solve.outcome === "fail").map(lost),
  );
  const quickWins = round.scoring.filter(
    (solve) =>
      solve.harness === child &&
      solve.outcome === "pass" &&
      lostBefore.has(lost(solve)) &&
      solve.seconds < solve.wallSeconds * SMALL_WALL_SHARE &&
      solve.calls.length <= FEW_CALLS,
  ).length;
  return [
    ...(changed && lastPractice === undefined
      ? [fired("NO PRACTICE", `${session}: the harness changed and no practice solve ran`)]
      : []),
    ...(changed && lastPractice !== undefined ? unpractised : []),
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

/**
 * Lane 19's wins, by solve: each comparison's tasks the new harness won, read as the comparison
 * paired them, with the solves under the new harness that passed them and under the reference that
 * failed them. The lane opens those solves' turns and calls, and until this it rebuilt the pairing
 * by hand from a log of thousands of events: the #107 buffer campaign won 11 tasks over 3
 * comparisons in 5,531 (2026-10-10). A task the report's test names is read by the difference it
 * recorded (`testedOf`), and only another by this tree's score: on 22 October the score of weighted
 * measures listed as won a task the Linux fork of #306 tied and one it lost, both scored before it.
 */
function winTriggers(log: Index): Trigger[] {
  return log.compared.flatMap(({ session, at, last }) => {
    const pairs = pairsReported(log.events, { session, index: at, data: last });
    const tested = testedOf(last);
    const recorded = new Map(tested.of.map((task, index) => [task, tested.differences[index]] as const));
    const won = pairs.filter((pair) => (recorded.get(pair.task) ?? differenceOf(pair)) > 0);
    const named = (side: "old" | "fresh", valid: boolean) =>
      won.flatMap((pair) => pair.solves?.[side].filter((_, index) => pair[side][index] === valid) ?? []);
    return won.length === 0
      ? []
      : [
          fired(
            "WINS",
            `${session}: ${share(won.length, pairs.length)} tasks won; passed under the new harness: ${named("fresh", true).join(" ")}; failed under the reference: ${named("old", false).join(" ")}`,
          ),
        ];
  });
}

/**
 * Lane 19's reading of whether a harness answered for its solver, which `src/builder/prompt.ts`
 * forbids a part to do: a solve whose one shell call was followed by its submit, with no write of
 * its own, submitted what one program made. Read per Builder session's practice and per comparison,
 * with the comparison's reference side beside its new one as the control, because a solver can do
 * the whole task in one command of its own.
 *
 * The shape is that strict because these solvers do everything through the shell, the answer file
 * included: across the #107 buffer campaign's solves, 1,920 `bash` calls to 7 `write` and no `read`.
 * A looser shape, a shell call last before `submit`, read 57 of the 68 solves under the reference
 * Starter there, which carries no engine to answer with. This one read none of the 132 reference
 * solves of the #107 buffer and recode campaigns, and 24 of recode's 40 measured solves under its
 * built harnesses and 21 of its 22 practice solves, every one a pass.
 */
function programTriggers(log: Index): Trigger[] {
  const oneProgram = (solve: Solve) =>
    solve.outcome !== null &&
    solve.calls.at(-1) === "submit" &&
    solve.calls.at(-2) === "bash" &&
    solve.calls.filter((tool) => tool === "bash").length === 1 &&
    !solve.calls.some((tool) => FILE_WRITERS.has(tool));
  const read = (solves: readonly Solve[]) =>
    share(solves.filter(oneProgram).length, solves.filter((solve) => solve.outcome !== null).length);
  const practised = log.builds.flatMap((build) => {
    const practice = practiceOf(log, build);
    return practice.some(oneProgram) ? [`${build.session}: ${read(practice)} practice solves`] : [];
  });
  const compared = log.compared.flatMap(({ session, own, scoring }) => {
    const under = (harness: JsonValue | undefined) => scoring.filter((solve) => solve.harness === harness);
    return under(own.fresh).some(oneProgram)
      ? [
          `${session}: ${read(under(own.fresh))} under the new harness, ${read(under(own.old))} under the reference`,
        ]
      : [];
  });
  const lines = [...practised, ...compared];
  return lines.length > 0
    ? [fired("ANSWER FROM A PROGRAM", `one shell call, then submit, in ${lines.join("; ")}`)]
    : [];
}

/** Lanes 13 to 19: the harness, which is the Builder's. */
function harnessTriggers(log: Index, alike: Same): Trigger[] {
  const comparisons = comparisonsOf(log.events);
  return log.builds.flatMap((build) => {
    const { session, finished, parent, calls } = build;
    // Every comparison of the harness this session left: recode measured b-1's twice (2026-10-10).
    const compared = log.compared.filter((each) => each.build === build);
    const practice = practiceOf(log, build);
    const round = {
      practice,
      scoring: compared.flatMap((each) => each.scoring),
      exposed: new Set(
        compared.flatMap(({ scoredSet, began }) =>
          [...scoredSet].filter((version) =>
            practice.some((solve) => solve.version === version && solve.index < began),
          ),
        ),
      ),
    };
    const child = text(finished?.harness);
    // pi's `write` and `edit` since 2026-10-09, `write_file` in the sessions before it, and the tool tree
    // where a shell command named it: esp32's b-1 kept 9 tool files on 12 October, its file tools none.
    const written = [
      ...new Set(calls.flatMap(({ tool, args }) => (FILE_WRITERS.has(tool) ? [text(args?.path)] : []))),
      ...new Set(calls.flatMap(({ args }) => text(args?.command).match(/\.toolchain/) ?? [])),
    ];
    const toolFiles = written.filter((path) => /tools|\.toolchain/.test(path));
    // A stop writes no end record, so a session it cut says nothing of what it changed: recode's
    // b-1 wrote its harness for forty minutes and this read none of it (2026-10-10). Its file-tool
    // calls are what the end record would have said, so they stand in for `changed` wherever a
    // trigger asks whether this session touched its harness at all.
    const edited = finished === null ? written.length > 0 : finished.changed === true;
    const fresh = log.solves.filter((solve) => edited && solve.harness === child && solve.side === TEST);
    const erring = fresh.filter((solve) => solve.errors > 0).length;
    return [
      ...(edited
        ? [
            fired(
              "HARNESS CHANGED",
              `${session}: ${short(parent)} to ${finished === null ? "what a stop left unsaved" : short(child)}; written by its file tools and shell: ${written.join(", ") || "nothing"}`,
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
      ...(edited && !calls.some(({ tool }) => tool === "check_harness")
        ? [fired("NEVER CHECKED", `${session}: no check_harness call`)]
        : []),
      ...(fresh.length > 0
        ? [
            fired(
              "TOOLS CALLED",
              `${short(child)}, left by ${session}, over ${plural(fresh.length, "test-side solve")}: ${tally(
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
              `${session}: in ${share(erring, fresh.length)} solves under the new harness, a call marked an error, as every non-zero exit is, which a test reporting what is unmet may give by design`,
            ),
          ]
        : []),
      ...(toolFiles.length > 0 ? [fired("TOOLS EDITED", `${session}: ${toolFiles.join(", ")}`)] : []),
      ...practiceTriggers(
        log,
        {
          build,
          changed: edited,
          child,
          read: practiceCandidates(log, build, comparisons),
          reference: text(compared[0]?.own.old) || parent,
          round,
        },
        alike,
      ),
    ];
  });
}

/** Starts establish comparison use even without a report; a frozen child alone establishes none. */
function practiceCandidates(
  log: Index,
  build: Build,
  comparisons: ReturnType<typeof comparisonsOf>,
): PracticeCandidate[] {
  const child = text(build.finished?.harness);
  const read: PracticeCandidate[] = comparisons.flatMap(({ id, at, fresh, report }) => {
    const checkpoint = log.events.some(
      ({ kind, data }, index) =>
        kind === "build.checkpoint" && data.session === build.session && data.harness === fresh && index < at,
    );
    return build.from < at && (fresh === child || checkpoint)
      ? [{ harness: fresh, began: at, origin: "comparison", id, reported: report !== null }]
      : [];
  });
  if (child !== "" && !read.some(({ harness }) => harness === child)) {
    const end = log.events.findIndex(({ kind, data }) => kind === BUILD_END && data === build.finished);
    read.push({ harness: child, began: end, origin: "frozen" });
  }
  return read;
}

/** Lane 22, from a comparison's last report alone: whether it scored a task, what its cap
 *  cut, and what it is short of. */
function testTriggers(session: string, last: JsonObject): Trigger[] {
  const scored = asRecord(last.scored);
  const tasks = count(scored?.wins) + count(scored?.losses) + count(scored?.ties);
  const asked = last.tasks;
  const lacking = items(last.short).length;
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
    ...(lacking > 0 ? [fired("SET SHORT", `${session}: ${String(lacking)} short of solves`)] : []),
  ];
}

/** Lanes 20 to 25: the comparison, which is the host's. */
function comparisonTriggers(log: Index): Trigger[] {
  const hosts = new Set([...log.conditions.values()].map((condition) => condition.host)).size;
  const perComparison = log.compared.flatMap(({ session, own, began: start, last, scoring }) => {
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
    const began = log.events[start]?.data;
    const fixed = strings(began?.tasks);
    const moved = fixed.filter((version) => !strings(last.versions).includes(version)).length;
    const seen = new Map<string, Set<string>>();
    for (const solve of scoring.filter(measured)) {
      const key = `${solve.version} ${solve.harness}`;
      seen.set(key, (seen.get(key) ?? new Set()).add(String(solve.outcome === "pass")));
    }
    const flips = [...seen.values()].filter((outcomes) => outcomes.size > 1).length;
    const noise = asRecord(last.noise);
    const apart = items(noise?.differences).filter(isNumber);
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
              `${session}: ${String(count(noise.wins))} won, ${String(count(noise.losses))} lost and ${String(count(noise.ties))} tied between two samples of the reference harness${readsStepEitherWay(apart, level) ? ", which reads a step where none can be" : ""}`,
            ),
          ]),
    ];
  });
  const chain = log.compared.map(({ session, own, last, build }) => {
    const fresh = isString(last.fresh) ? short(last.fresh) : "none";
    // A report written before 2026-10-09 names no reference harness: it compared with its parent.
    return `${session} ${short(text(own.old) || (build?.parent ?? ""))}>${fresh} ${text(last.reading)}`;
  });
  return [
    ...(hosts > 1
      ? [fired("HOST CODE MOVED", `${String(hosts)} versions of the host's code in one log`)]
      : []),
    ...perComparison,
    ...(chain.length > 0 ? [fired("CHAIN", chain.join("; "))] : []),
    ...(log.states.size > 0 && log.held.length === 0
      ? [fired("NO TASK HELD OUT", "no task is held out, so a comparison has nothing to score")]
      : []),
  ];
}

/** The solves with no end: those the campaign went past (`nextBound`), and those open at the log's
 *  end. */
function unendedSolves(log: Index) {
  const unended = log.solves.filter((solve) => solve.outcome === null);
  const cut = unended.filter((solve) => nextBound(log.events, solve.index) !== -1).length;
  return { cut, open: unended.length - cut };
}

/** A lane 27 trigger's detail: what the campaign went past, then what is open at the log's end. */
const apart = (cut: string, open: string) =>
  [cut, open === "" ? "" : `${open} open at the log's end`].filter((part) => part !== "").join("; ");

/** Lanes 26 to 28: the solve, its failure and the cost, of which `time.ts` reads lanes 26 and 28. */
function solveTriggers(log: Index, steps: readonly Handover[]): Trigger[] {
  const done = log.solves.filter((solve) => solve.outcome !== null);
  const missed = done.filter((solve) => solve.outcome === "fail");
  // A session or a solve with no end that the campaign went past was cut. One open at the log's end
  // is running, or was stopped by `bun run runs stop`, which writes no ending, and the trigger says
  // it apart: until 11 October it read buffer-225's running x-1, and the four solves buffer-main's
  // g-1 had in flight, as killed.
  const unended = steps.flatMap((step) => (step.step === "examiner" && step.ended === null ? [step] : []));
  const ids = (cut: boolean) => unended.flatMap((step) => (step.cut === cut ? [step.id] : [])).join(", ");
  const { cut, open } = unendedSolves(log);
  const solves = (many: number) => (many > 0 ? plural(many, "solve") : "");
  const non = done.filter((solve) => solve.outcome === "non-result");
  const unjudged = countBy(
    missed.filter((solve) => solve.kind !== "rejected"),
    (solve) => solve.kind ?? "unkinded",
  );
  const ends = [...log.of(BUILD_END), ...log.of(EXAM_END)];
  const crashed = ends.filter((data) => isString(data.crash) || data.ended === "crashed");
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
  return [
    ...wallTriggers(log),
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
    ...(cut + open > 0 ? [fired("SOLVE NEVER FINISHED", apart(solves(cut), solves(open)))] : []),
    ...(unended.length > 0 ? [fired("EXAMINER NEVER FINISHED", apart(ids(true), ids(false)))] : []),
    ...(Object.keys(unjudged).length > 0 ? [fired("MISSES WITHOUT A VERDICT", tally(unjudged))] : []),
    ...(crashed.length > 0
      ? [fired("SESSION CRASHED", crashed.map((data) => text(data.session)).join(", "))]
      : []),
    ...costTriggers(log),
  ];
}

/** Lanes 29 and 30: the review loop. */
function reviewTriggers(log: Index): Trigger[] {
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

/**
 * The campaign command's own record, for lane 25's "what runs next": its moves, how it ended, and
 * its billed dollars against the budget it opened with. Lane 25 read the stop rule from the
 * command's output, which the log outlives. An ending before the last event is one the campaign went
 * on from: both #107 campaigns ended `exam` at their fourth event and ran on under the same opening.
 * None for a log no campaign command wrote.
 */
function campaignOf(log: Index): string[] {
  const endings = log.events.flatMap(({ kind, data }, index) =>
    kind === "campaign.ended" ? [`${text(data.ending)} at event ${String(index)}`] : [],
  );
  const opened = asRecord(log.of("campaign.opened").at(-1)?.budget);
  if (endings.length === 0 && opened === null) return [];
  const moves = countBy(log.of("campaign.move"), (data) => text(data.move));
  const billed = billedAll(log.events);
  const budget = isNumber(opened?.dollars) ? ` of ${String(opened.dollars)}` : "";
  return [
    `campaign: moves ${tally(moves)}; ended ${endings.join(", then ") || "never"}; billed ${billed.toFixed(2)}${budget} dollars`,
  ];
}

/** The steps open at the log's end, each with what it has done so far. A move the campaign command
 *  is making writes its `campaign.move` as it begins, so the moves above count it. */
function openLine(steps: readonly Handover[]): string[] {
  const open = new Set(openSteps(steps));
  const said = steps.flatMap((step) => {
    if (!open.has(step.id)) return [];
    if (step.step === "comparison") {
      return [
        `${step.id}, a comparison: ${plural(step.solved, "solve")} ended and ${String(step.begun - step.solved)} open`,
      ];
    }
    const done =
      step.step === "examiner"
        ? `${plural(step.held, "task")} held out`
        : plural(step.practiceSolves, "practice solve");
    return [
      `${step.id}, ${step.step === "examiner" ? "an Examiner" : "a Builder"} session: ${plural(step.turns, "turn")} and ${done} so far, last at ${step.last}`,
    ];
  });
  return said.length === 0 ? [] : [`open at the log's end: ${said.join("; ")}`];
}

/** Rows A to F: the identities every finding binds to. */
function rowsOf(log: Index, steps: readonly Handover[]): Row[] {
  const { cut, open } = unendedSolves(log);
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
    const past = steps.some((step) => step.step === "builder" && step.id === build.session && step.cut);
    const ended =
      text(build.finished?.ended) ||
      (past ? "never: a later step began without it" : "not yet: open at the log's end");
    const readings = log.compared
      .filter((each) => each.build === build)
      .map((each) => `${each.session} ${text(each.last.reading)}`);
    // The end record counts a session's practice. One still running has none, and neither has one
    // killed (main0_5_1's b-3 on 15 October, whose practice passed): their solves are read from the log.
    const recorded = build.finished?.practiceSolves;
    const practised = isNumber(recorded) ? recorded : practiceOf(log, build).length;
    return `${build.session}: ${short(build.parent)} > ${child}, ended ${ended}, ${plural(practised, "practice solve")}, reading ${readings.join(", ") || "none"}`;
  });
  return [
    {
      id: "A",
      title: "campaign and log",
      lines: [
        `${plural(log.events.length, "event")}, ${log.events[0]?.at ?? ""} to ${log.events.at(-1)?.at ?? ""}`,
        `${plural(log.builds.length, "Builder session")}, ${plural(log.of(EXAM_START).length, "Examiner session")}, ${plural(log.of(REPORTED).length, "report")}`,
        `billed dollars: ${
          spendOf(log)
            .map(([role, dollars]) => `${role} ${dollars.toFixed(2)}`)
            .join(", ") || "none"
        }${admittedCost(log)
          .map((cost) => `; ${cost}`)
          .join("")}`,
        hoursLine(log),
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
        `${plural(cut, "solve")} never finished${open > 0 ? `, ${String(open)} open at the log's end` : ""}`,
      ],
    },
    {
      id: "F",
      title: "sessions and the harness chain",
      lines: [...campaignOf(log), ...openLine(steps), ...sessions],
    },
  ];
}

/** The rows and the triggers of one log. Two harnesses are the same by digest, unless the caller
 *  can read their kept states (`alike`). */
export function overview(events: readonly LogEvent[], alike: Same = (a, b) => a === b): Overview {
  const log = indexOf(events);
  const { steps } = handoverOf(events);
  return {
    rows: rowsOf(log, steps),
    triggers: [
      ...instrumentTriggers(log),
      ...taskTriggers(log),
      ...harnessTriggers(log, alike),
      ...comparisonTriggers(log),
      ...solveTriggers(log, steps),
      ...winTriggers(log),
      ...programTriggers(log),
      ...reviewTriggers(log),
      ...promotionTriggers(log),
      ...safeguardTriggers(log),
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
