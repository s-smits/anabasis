/**
 * The deterministic read of one campaign's log for a whole-run investigation: six rows of
 * identities the primary reviewer settles, and the triggers that say which lanes of
 * `.claude/skills/whole-run-investigation/references/lanes.md` have something to read. The folds and
 * the exam side's triggers live in `folds.ts`, the promotion's in `promotion.ts`, the conduct's in
 * `run.ts` and the clock's in `time.ts`; this file keeps the review, harness, comparison and solve
 * triggers, the rows and the overview.
 */
import { resetOf } from "#src/agent/backends/claude.ts";
import { comparisonsOf } from "#src/campaign/state.ts";
import { short } from "#src/campaign/move.ts";
import { campaignOf as handoverOf, type Handover, nextBound, openSteps } from "#src/campaign/summary.ts";
import { differenceOf, isSignificant, scoresIn, testOf } from "#src/kernel/compare.ts";
import type { Condition } from "#src/kernel/condition.ts";
import { eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { billedAll, costLine, spendOf } from "#src/kernel/meter.ts";
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
  emitIf,
  type Index,
  indexOf,
  instrumentTriggers,
  items,
  measured,
  practiceOf,
  REPORTED,
  share,
  SMALL_DEADLINE_SHARE,
  type Solve,
  strings,
  tally,
  tallyOf,
  taskTriggers,
  TEST,
  text,
  type Trigger,
  unprobedEarned,
} from "./folds.ts";
import { safeguardTriggers } from "./climb.ts";
import { componentTriggers } from "./components.ts";
import { gamingTriggers } from "./gaming.ts";
import { promotionTriggers, testedOf } from "./promotion.ts";
import { runTriggers } from "./run.ts";
import { signalTriggers } from "./signals.ts";
import { degradationLines } from "../runs/degradations.ts";
import type { Receipt } from "../runs/receipt.ts";
import { costTriggers, hoursLine, deadlineTriggers } from "./time.ts";

interface Row {
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
}

export interface Overview {
  readonly rows: readonly Row[];
  readonly triggers: readonly Trigger[];
}

type PracticeCandidate = { readonly harness: string; readonly began: number } & (
  | { readonly origin: "frozen" }
  | { readonly origin: "comparison"; readonly id: string; readonly reported: boolean }
);

const FEW_CALLS = 3;
export const FILE_WRITERS: ReadonlySet<string> = new Set(["write", "edit", "write_file"]);

interface PractisedSession {
  readonly build: Build;
  readonly changed: boolean;
  readonly child: string;
  readonly read: readonly PracticeCandidate[];
  readonly round: {
    readonly practice: readonly Solve[];
    readonly scoring: readonly Solve[];
    readonly exposed: ReadonlySet<string>;
  };
}

function practiceTriggers(
  log: Index,
  { build, changed, read, round }: PractisedSession,
  wonTasks: ReadonlySet<string>,
): Trigger[] {
  const { session, finished } = build;
  const lastPractice = round.practice.at(-1);
  const unpractised = read.flatMap((candidate) => {
    const prior = round.practice.filter((solve) => solve.index < candidate.began);
    if (prior.some((solve) => solve.harness === candidate.harness)) return [];
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
  const ended = finished === null ? "not finished by the log's last event" : text(finished.ended);
  const fails = round.practice.filter((solve) => solve.outcome === "fail");
  const older = new Set(log.solves.flatMap((solve) => (solve.index < build.from ? [solve.harness] : [])));
  const failed = fails.filter((fail) => fail.harness !== build.parent && !older.has(fail.harness));
  const earned = failed.filter((fail) => log.stands.get(fail.id) === "earned").length;
  const laterPass = (fail: Solve, bytes: "same" | "other") =>
    round.practice.some(
      (later) =>
        later.version === fail.version &&
        later.index > fail.index &&
        later.outcome === "pass" &&
        (later.harness === fail.harness) === (bytes === "same"),
    );
  const answered = failed.filter((fail) => laterPass(fail, "other")).length;
  const flipped = failed.filter((fail) => laterPass(fail, "same")).length;
  const exposed = round.exposed.size;
  const quickWins = round.scoring.filter(
    (solve) =>
      solve.outcome === "pass" &&
      wonTasks.has(`${String(solve.comparison)} ${solve.version}`) &&
      solve.seconds < solve.wallSeconds * SMALL_DEADLINE_SHARE &&
      solve.calls.length <= FEW_CALLS,
  ).length;
  return [
    ...emitIf(
      changed && lastPractice === undefined,
      "NO PRACTICE",
      `${session}: the harness changed and no practice solve ran`,
    ),
    ...(changed && lastPractice !== undefined ? unpractised : []),
    ...emitIf(ended !== "finished", "SESSION ENDED", `${session}: ${ended}`),
    ...emitIf(
      fails.length > 0,
      "PRACTICE FAILS",
      `${session}: ${plural(failed.length, "fail")} under its own states, ${String(earned)} ruled earned; the same task passed later under changed bytes ${String(answered)}, under the same bytes ${String(flipped)}; ${plural(fails.length - failed.length, "fail")} under a harness older than the session`,
    ),
    ...emitIf(
      exposed > 0,
      "PRACTISED TASK MEASURED",
      `${session}: ${plural(exposed, "task")} both practised and measured`,
    ),
    ...emitIf(
      quickWins > 0,
      "WIN AT A SMALL WALL SHARE",
      `${session}: ${String(quickWins)} passed solves of tasks the new harness won, in few calls`,
    ),
  ];
}

export function wonOf(log: Index) {
  return log.compared.map(({ session, last, pairs: settled }) => {
    const pairs = settled();
    const tested = testedOf(last);
    const recorded = new Map(tested.of.map((task, index) => [task, tested.differences[index]] as const));
    return {
      session,
      pairs,
      won: pairs.filter((pair) => (recorded.get(pair.task) ?? differenceOf(pair)) > 0),
    };
  });
}

function winTriggers(wonList: ReturnType<typeof wonOf>): Trigger[] {
  return wonList.flatMap(({ session, pairs, won }) => {
    const solves = won.map(
      (pair) =>
        `${short(pair.task)} new ${pair.solves?.fresh.join(" ") ?? "-"}, reference ${pair.solves?.old.join(" ") ?? "-"}`,
    );
    return emitIf(
      won.length > 0,
      "WINS",
      `${session}: ${share(won.length, pairs.length)} tasks won: ${solves.join("; ")}`,
    );
  });
}

function programTriggers(log: Index): Trigger[] {
  const oneProgram = (solve: Solve) =>
    solve.outcome !== null &&
    log.verdicts.get(solve.id)?.answer !== undefined &&
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
  return emitIf(
    lines.length > 0,
    "ANSWER FROM A PROGRAM",
    `one shell call, then submit, in ${lines.join("; ")}`,
  );
}

function harnessTriggers(log: Index, wonList: ReturnType<typeof wonOf>): Trigger[] {
  const comparisons = comparisonsOf(log.events);
  const checkpoints = eventsOf(log.events, "build.checkpoint");
  const buildEnds = eventsOf(log.events, BUILD_END);
  const wonTasks = new Set(wonList.flatMap((each) => each.won.map((pair) => `${each.session} ${pair.task}`)));
  return log.builds.flatMap((build) => {
    const { session, finished, parent, calls } = build;
    const compared = log.compared.filter((each) => each.build === build);
    const practice = practiceOf(log, build);
    const round = {
      practice,
      scoring: compared.flatMap(({ own, scoring }) => scoring.filter((solve) => solve.harness === own.fresh)),
      exposed: new Set(
        compared.flatMap(({ scoredSet, began }) =>
          [...scoredSet].filter((version) =>
            practice.some((solve) => solve.version === version && solve.index < began),
          ),
        ),
      ),
    };
    const child = text(finished?.harness);
    const left =
      child ||
      text(checkpoints.findLast(({ event: { data } }) => data.session === session)?.event.data.harness);
    const files = [
      ...new Set(calls.flatMap(({ tool, args }) => (FILE_WRITERS.has(tool) ? [text(args?.path)] : []))),
    ];
    const written = [
      ...files,
      ...new Set(calls.flatMap(({ args }) => /\.toolchain/.exec(text(args?.command)) ?? [])),
    ];
    const edited =
      finished?.changed === undefined
        ? files.length > 0 || (left !== "" && left !== parent)
        : finished.changed === true;
    const toolFiles = edited ? written.filter((path) => /tools|\.toolchain/.test(path)) : [];
    const fresh = edited ? round.scoring : [];
    const erring = fresh.filter((solve) => solve.errors > 0).length;
    const read: PracticeCandidate[] = comparisons.flatMap(({ id, at, fresh: comparedFresh, report }) => {
      const snapshot = checkpoints.some(
        ({ index, event: { data } }) =>
          data.session === session && data.harness === comparedFresh && index < at,
      );
      return build.from < at && (comparedFresh === child || snapshot)
        ? [{ harness: comparedFresh, began: at, origin: "comparison", id, reported: report !== null }]
        : [];
    });
    if (child !== "" && !read.some(({ harness }) => harness === child)) {
      const end = buildEnds.find(({ event: { data } }) => data === finished)?.index ?? -1;
      read.push({ harness: child, began: end, origin: "frozen" });
    }
    return [
      ...emitIf(
        edited,
        "HARNESS CHANGED",
        `${session}: ${short(parent)} to ${left === "" ? "what a stop left unsaved" : short(left)}; written by its file tools and shell: ${written.join(", ") || "nothing"}`,
      ),
      ...emitIf(
        isString(finished?.broken),
        child === "" ? "BROKEN AT END" : "MEASURED AN EARLIER STATE",
        `${session}: what the session left does not open`,
      ),
      ...emitIf(
        edited && !calls.some(({ tool }) => tool === "check_harness"),
        "NEVER CHECKED",
        `${session}: no check_harness call`,
      ),
      ...emitIf(
        fresh.length > 0,
        "TOOLS CALLED",
        `${[...new Set(fresh.map((solve) => short(solve.harness)))].join(", ")}, left by ${session}, over ${plural(fresh.length, "test-side solve")}: ${tally(
          countBy(
            fresh.flatMap((solve) => solve.calls),
            (tool) => tool,
          ),
        )}; through bash: ${tally(
          countBy(
            fresh.flatMap((solve) => solve.programs),
            (program) => program,
          ),
        )}`,
      ),
      ...emitIf(
        erring * 4 > fresh.length,
        "TOOL CALLS ERRED",
        `${session}: in ${share(erring, fresh.length)} solves under the new harness, a call marked an error, as every non-zero exit is, which a test reporting what is unmet may give by design`,
      ),
      ...emitIf(toolFiles.length > 0, "TOOLS EDITED", `${session}: ${toolFiles.join(", ")}`),
      ...practiceTriggers(log, { build, changed: edited, child, read, round }, wonTasks),
    ];
  });
}

function testTriggers(session: string, last: JsonObject): Trigger[] {
  const scored = asRecord(last.scored);
  const tasks = count(scored?.wins) + count(scored?.losses) + count(scored?.ties);
  const asked = last.tasks;
  const lacking = items(last.short).length;
  return [
    ...emitIf(
      scored !== null && tasks === 0,
      "NOTHING SCORED",
      `${session}: no task was scored${isNumber(asked) ? `, of ${String(asked)} asked for` : ""}; the report reads ${text(last.reading)}`,
    ),
    ...emitIf(
      last.capped === true,
      "CUT BY ITS CAP",
      scored === null
        ? `${session}: the dollar cap ended it before it was read`
        : `${session}: the dollar cap ended the starter's solves; its test stands, unread against the starter`,
    ),
    ...emitIf(lacking > 0, "SET SHORT", `${session}: ${String(lacking)} short of solves`),
  ];
}

function comparisonTriggers(log: Index): Trigger[] {
  const hosts = new Set([...log.conditions.values()].map((condition) => condition.host)).size;
  const perComparison = log.compared.flatMap(({ session, own, began: start, last, scoring }) => {
    const aside = new Set(strings(own.aside));
    const open = scoring.filter(
      (solve) =>
        solve.kind === "rejected" && aside.has(solve.version) && log.stands.get(solve.id) !== "earned",
    );
    const underOld = open.filter((solve) => solve.harness === own.old).length;
    const level = count(last.level);
    const began = log.events[start]?.data;
    const fixed = strings(began?.tasks);
    const moved = fixed.filter((version) => !strings(last.versions).includes(version)).length;
    const seen = new Map<string, Set<string>>();
    for (const solve of scoring.filter(measured)) {
      const key = `${solve.version} ${solve.harness}`;
      seen.set(key, (seen.get(key) ?? new Set()).add(String(solve.outcome === "pass")));
    }
    const flips = [...seen]
      .filter(([, outcomes]) => outcomes.size > 1)
      .map(([key]) => key.endsWith(` ${text(own.old)}`));
    const noise = tallyOf(last.noise);
    return [
      ...emitIf(
        moved > 0,
        "SCORED SET MOVED",
        `${session}: ${share(moved, fixed.length)} tasks it began with are not in its tally`,
      ),
      ...emitIf(
        open.length > 0,
        "SET ASIDE BY SIDE",
        `${session}: ${plural(open.length, "rejection")} set ${plural(aside.size, "task")} aside, ${String(underOld)} under the reference harness and ${String(open.length - underOld)} under the others`,
      ),
      ...testTriggers(session, last),
      ...emitIf(
        flips.length > 0,
        "FLIPS",
        `${session}: ${share(flips.length, seen.size)} task and harness pairs both passed and failed, ${String(flips.filter(Boolean).length)} under the reference harness and ${String(flips.filter((old) => !old).length)} under the other`,
      ),
      ...(noise === null
        ? []
        : [
            fired(
              "REFERENCE AGAINST ITSELF",
              `${session}: ${String(noise.wins)} won, ${String(noise.losses)} lost and ${String(noise.ties)} tied between two samples of the reference harness${isSignificant(scoresIn(last.noise), level) ? ", which reads a step where none can be" : ""}`,
            ),
          ]),
    ];
  });
  const chain = log.compared.map(({ session, own, last, build }) => {
    const fresh = isString(last.fresh) ? short(last.fresh) : "none";
    // An older report names no reference harness: it compared with its parent.
    return `${session} ${short(text(own.old) || (build?.parent ?? ""))}>${fresh} ${text(last.reading)}`;
  });
  return [
    ...emitIf(hosts > 1, "HOST CODE MOVED", `${String(hosts)} versions of the host's code in one log`),
    ...perComparison,
    ...emitIf(chain.length > 0, "CHAIN", chain.join("; ")),
    ...emitIf(
      log.states.size > 0 && log.held.length === 0,
      "NO TASK HELD OUT",
      "no task is held out, so a comparison has nothing to score",
    ),
  ];
}

function unendedSolves(log: Index) {
  const unended = log.solves.filter((solve) => solve.outcome === null);
  const cut = unended.filter((solve) => nextBound(log.events, solve.index) !== -1).length;
  return { cut, open: unended.length - cut };
}

const apart = (cut: string, open: string) =>
  [cut, open === "" ? "" : `${open} open at the log's end`].filter((part) => part !== "").join("; ");

function solveTriggers(log: Index, steps: readonly Handover[]): Trigger[] {
  const done = log.solves.filter((solve) => solve.outcome !== null);
  const missed = done.filter((solve) => solve.outcome === "fail");
  const unended = steps.flatMap((step) => (step.step === "examiner" && step.ended === null ? [step] : []));
  const ids = (end: "cut" | "open") =>
    unended.flatMap((step) => (step.cut === (end === "cut") ? [step.id] : [])).join(", ");
  const { cut, open } = unendedSolves(log);
  const solves = (many: number) => (many > 0 ? plural(many, "solve") : "");
  const non = done.filter((solve) => solve.outcome === "non-result" && solve.cancelledBy !== "admission");
  const unjudged = countBy(
    missed.filter((solve) => solve.kind !== "rejected"),
    (solve) => solve.kind ?? "unkinded",
  );
  // A crash that names a provider's reset is a limit the host waits out, no alarm (rule 15).
  const crashed = [...log.of(BUILD_END), ...log.of(EXAM_END)]
    .filter((data) => isString(data.crash) || data.ended === "crashed")
    .flatMap((data) => (resetOf(text(data.crash), new Date(0)) === null ? [text(data.session)] : []));
  // A side whose bad solves are run again is favoured, so non-results are counted by harness.
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
    ...deadlineTriggers(log),
    ...emitIf(
      non.length > 0,
      "NON-RESULTS",
      [
        `${share(non.length, done.length)}; ${tally(countBy(non, (solve) => solve.kind ?? "unkinded"))}`,
        ...rerun,
      ].join("; "),
    ),
    ...emitIf(cut + open > 0, "SOLVE NEVER FINISHED", apart(solves(cut), solves(open))),
    ...emitIf(
      ids("cut") !== "" || (log.of("campaign.ended").length > 0 && ids("open") !== ""),
      "EXAMINER NEVER FINISHED",
      apart(ids("cut"), ids("open")),
    ),
    ...emitIf(Object.keys(unjudged).length > 0, "MISSES WITHOUT A VERDICT", tally(unjudged)),
    ...emitIf(crashed.length > 0, "SESSION CRASHED", crashed.join(", ")),
    ...costTriggers(log),
  ];
}

function reviewTriggers(log: Index): Trigger[] {
  const moved = [...log.rulings].filter(([solve, data]) => {
    const replay = asRecord(data.replay);
    return replay !== null && replay.kind !== log.verdicts.get(solve)?.kind;
  }).length;
  const disputed = new Set(
    [...log.states].flatMap(([version, state]) => (state === "disputed" ? [version] : [])),
  );
  const waiting = new Set(
    log.compared.flatMap(({ last }) => (asRecord(last.settled) === null ? strings(last.aside) : [])),
  );
  const standing = [...waiting].filter((version) => !disputed.has(version)).length;
  const ends = [...log.of(BUILD_END), ...log.of(EXAM_END), ...log.of(REPORTED)];
  const faults = ends.reduce((sum, data) => sum + items(data.reviewFaults).length, 0);
  const unprobed = [...log.rulings.values()].filter(unprobedEarned).length;
  return [
    ...emitIf(moved > 0, "REPLAY MOVED THE VERDICT", plural(moved, "ruling")),
    ...emitIf(
      standing > 0,
      "SET ASIDE AND UNSETTLED",
      `${plural(standing, "task")} left out of a comparison on a rejection no person has labelled`,
    ),
    ...log.compared.flatMap(({ session, own, last }) => {
      const level = count(own.level);
      const clears = (tested: { readonly p: number }) => tested.p <= level;
      const flipped = (tested: JsonValue | undefined) => {
        const scores = scoresIn(tested);
        return scores.length === 0 ? null : testOf(scores.map((one) => -one));
      };
      const sides = [
        [tallyOf(own.counted), tallyOf(own.scored), ""],
        ...(own.fresh === own.starter
          ? [[flipped(own.counted), flipped(own.scored), " for the reference"] as const]
          : []),
      ] as const;
      const settled = asRecord(last.settled);
      return [
        ...sides.flatMap(([counted, scored, side]) =>
          counted === null || scored === null || clears(counted) === clears(scored)
            ? []
            : [
                fired(
                  "READING MOVES WITH THE SET-ASIDE",
                  `${session}: ${String(scored.wins)}-${String(scored.losses)}${side} without the ${plural(items(own.aside).length, "task")} set aside, ${String(counted.wins)}-${String(counted.losses)} were their rejections to stand, and only one of the two clears its level`,
                ),
              ],
        ),
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
    ...emitIf(faults > 0, "REVIEW FAULTS", plural(faults, "reviewer failure")),
    ...emitIf(unprobed > 0, "EARNED WITHOUT A PROBE", share(unprobed, log.rulings.size)),
  ];
}

function campaignOf(log: Index): string[] {
  const endings = eventsOf(log.events, "campaign.ended").map(
    ({ index, event }) => `${text(event.data.ending)} at event ${String(index)}`,
  );
  const opened = asRecord(log.of("campaign.opened").at(-1)?.budget);
  if (endings.length === 0 && opened === null) return [];
  const moves = countBy(log.of("campaign.move"), (data) => text(data.move));
  const billed = billedAll(log.events);
  const budget = isNumber(opened?.dollars) ? ` of ${String(opened.dollars)}` : "";
  return [
    `campaign: moves ${tally(moves)}; ended ${endings.join(", then ") || "never"}; calculated spend ${billed.toFixed(2)}${budget} dollars; ${costLine(log.events)}`,
  ];
}

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
          spendOf(log.events)
            .map(([role, dollars]) => `${role} ${dollars.toFixed(2)}`)
            .join(", ") || "none"
        }${admittedCost(log, steps)
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
        `${share(done.filter((solve) => solve.served.length === 0).length, done.length)} finished solves name no response model`,
        // Every seat's turns, since a campaign whose readings score nothing would otherwise fire no
        // trigger.
        ...degradationLines(log.events).slice(0, 1),
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

export function overview(events: readonly LogEvent[], launches: readonly Receipt[] = []): Overview {
  const log = indexOf(events);
  const { steps } = handoverOf(events);
  const won = wonOf(log);
  return {
    rows: rowsOf(log, steps),
    triggers: [
      ...instrumentTriggers(log),
      ...taskTriggers(log),
      ...harnessTriggers(log, won),
      ...comparisonTriggers(log),
      ...solveTriggers(log, steps),
      ...winTriggers(won),
      ...programTriggers(log),
      ...reviewTriggers(log),
      ...promotionTriggers(log),
      ...safeguardTriggers(log),
      ...runTriggers(log, launches),
      ...signalTriggers(log),
      ...componentTriggers(log),
      ...gamingTriggers(log),
    ],
  };
}

export function rendered({ rows, triggers }: Overview): string {
  return [
    ...rows.flatMap((row) => [`${row.id}. ${row.title}`, ...row.lines.map((line) => `   ${line}`)]),
    "",
    ...triggers.map((trigger) => `${trigger.name} (lane ${String(trigger.lane)}): ${trigger.detail}`),
  ].join("\n");
}
