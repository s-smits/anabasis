/**
 * Lane 22's triggers: a campaign that promoted a harness, read for what the promotion rested on,
 * what it measured, what touched both sides of it, and what the campaign did after it.
 * Validity percentages require a profile with a task and solve denominator; missing measurements
 * read unmeasured, while a nonempty profile of failed solves reads zero.
 *
 * The first live promotion of the climb was abl175-new's on 10 October (c366a2d6, 23:22Z): two
 * comparisons against a starter that answered none of the solves on 9 of 12 tasks, both 10-0-2.
 * Until then no lane asked whether a promotion was the table's rule followed, what it showed beyond
 * "the starter carries no engine", or whether the room Examiner, the control and the next Builder
 * followed it, and a reader rebuilt each from thousands of events. The same night a reference-side
 * solve of that campaign's repeat found and ran a phreeqc another campaign's Builder had compiled
 * under the Mac's shared `/tmp` (plan defect H1), which no trigger read.
 *
 * The six-campaign whole-run investigations on 20 October 2026 found private seat paths and
 * denied calls counted as possible shared use. Only successful calls outside the seats' parent
 * (`BUILT_COMMAND_SCRATCH_ROOT`, `src/wall/policy.ts`) count here.
 *
 * Split from `read.ts`, which stands near the size policy's ceiling, as `time.ts` and `folds.ts`
 * were. Nothing here reads a file beside the log.
 */
import { epochsOf as epochsRead, ORIGINS, type Origin, starterReads } from "#src/campaign/climb.ts";
import { short } from "#src/campaign/move.ts";
import { differenceOf, flipP, pointsOf, scoresIn, testOf } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import type { Call, Seat } from "#src/kernel/trace.ts";
import { billedBetween } from "#src/kernel/meter.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import {
  type Compared,
  count,
  EXAM_END,
  fired,
  type Index,
  items,
  measured,
  practiceOf,
  share,
  summed,
  tally,
  tallyOf,
  text,
  type Trigger,
  wlt,
} from "./folds.ts";
import { spareOf } from "./clearance.ts";

/** A promotion and the stretch of the log it governs: up to the next promotion or the log's end. */
interface Epoch {
  readonly at: number;
  readonly until: number;
  readonly data: JsonObject;
}

const [CHOSEN, BEFORE, AFTER] = ORIGINS;
/** The units a budget on record may name (`folds.ts`). */
const UNITS = ["turns", "prompts", "cpu", "seconds"] as const;
/** The share of tasks a reference answers on none of its solves above which a step is read as an
 *  engine against none: abl175-new's starter answered none on 9 of 12 and 7 of 12 (10 October). */
const BARE = 0.5;
/** A path under one of the host's temporary folders, `/tmp` or `/var/tmp`, in either spelling, as a
 *  shell command or a tool's argument names it: the two the wall closes (`darwinCommandProfile`).
 *  Until 12 October `/var/tmp` was not read here, where it held a v1 solve of a held task that every
 *  seat could read on buffer. The seats' `ana-built-bash` parent is private even under `/tmp`.
 *  A path ends at the first character a shell or JSON ends a word on. */
const SHARED_PATH =
  /(?:^|[\s"'=:;(|&>])(\/(?:private\/)?(?:var\/)?tmp\/(?!ana-built-bash\/)[^\s"'\\;)|&<>*]+)/g;
/** The paths a reader is shown, of those more than one solve or session named: a path one solve
 *  writes and another runs is the leak, and a solve's own scratch file is named by it alone. */
const MOST_PATHS = 6;

/** The shared temporary paths call `call` names in its arguments. */
export const sharedPaths = ({ args }: Call) =>
  [...JSON.stringify(args).matchAll(SHARED_PATH)].map(([, path = ""]) => path);

/** `w-l-t p` of a test record, or "not scored" where there is none, as a stopped comparison's. */
export function testSaid(tested: JsonValue | undefined): string {
  const record = asRecord(tested);
  const step = tallyOf(tested);
  if (record === null || step === null) return "not scored";
  const said = (read: typeof step) => `${wlt(read)} p ${pSaid(read.p)}`;
  const billed = said({
    wins: count(record.wins),
    losses: count(record.losses),
    ties: count(record.ties),
    p: count(record.p),
  });
  return said(step) === billed ? billed : `${billed}, without the bill ${said(step)}`;
}

/** A test's p as a reading prints it. */
export const pSaid = (p: number) => (p < 0.001 ? p.toExponential(1) : p.toFixed(3));

/** The differences a report's step was read on, each with its task where named: the frontier's and
 *  the retained tasks' since 20 October, when `scored` holds the test's `falseRate`, else the
 *  frontier's alone. */
export function testedOf(report: JsonObject): { differences: number[]; of: (string | undefined)[] } {
  const pooled = asRecord(report.scored)?.falseRate !== undefined;
  const tested: { differences: number[]; of: (string | undefined)[] } = { differences: [], of: [] };
  for (const set of (pooled ? [report.frontier, report.retained] : [report.frontier]).map(asRecord)) {
    const differences = Array.isArray(set?.differences) ? set.differences.filter(isNumber) : [];
    const of = set?.of;
    const named = Array.isArray(of) && of.every(isString) && of.length === differences.length ? of : [];
    tested.differences.push(...differences);
    tested.of.push(...differences.map((_, at) => named[at]));
  }
  return tested;
}

/** The differences a promotion's readings tested (`testedOf`) joined, a task more than one scored
 *  counted once with its differences summed, less the tasks in `without`. Until 19 October a
 *  promotion read a step and its repeat so (`readTwice`), and a campaign of then is read by that
 *  rule. */
export function joinedTest(
  reports: readonly JsonObject[],
  without: ReadonlySet<string> = new Set(),
): number[] {
  const sums = new Map<string, number>();
  const unnamed: number[] = [];
  for (const report of reports) {
    const { differences, of } = testedOf(report);
    for (const [at, difference] of differences.entries()) {
      const task = of[at];
      if (task === undefined) unnamed.push(difference);
      else if (!without.has(task)) sums.set(task, (sums.get(task) ?? 0) + difference);
    }
  }
  return [...sums.values(), ...unnamed];
}

/** Of a report's `valid` side, tasks by how many of their solves were valid: the tasks with none,
 *  the tasks, and the share of solves valid. */
export function validOf(side: JsonValue | undefined) {
  const columns = items(side).map((value) => count(value));
  const tasks = columns.reduce((sum, value) => sum + value, 0);
  const solves = columns.length - 1;
  const valid = columns.reduce((sum, value, index) => sum + value * index, 0);
  return { none: columns[0] ?? 0, tasks, share: tasks === 0 || solves < 1 ? null : valid / (tasks * solves) };
}

/** A measured validity share as a percentage, retaining the absence of a measurement. */
export function validSaid(value: number | null): string {
  return value === null ? "unmeasured" : `${(value * 100).toFixed(0)}%`;
}

export function epochsOf(events: readonly LogEvent[]): Epoch[] {
  const at = events.flatMap(({ kind }, index) => (kind === "harness.promoted" ? [index] : []));
  return at.map((index, position) => ({
    at: index,
    until: at[position + 1] ?? events.length,
    data: events[index]?.data ?? {},
  }));
}

/** The step rule an opening pins in its terms; none leaves it to the tree's default. */
export function pinnedRule(log: Index): string[] {
  const terms = asRecord(log.of("campaign.opened").at(-1)?.terms);
  return ["level", "trigger"].flatMap((key) =>
    isString(terms?.[key]) ? [`${key} ${text(terms[key])}`] : [],
  );
}

/** The opening's step rule: pinned in its terms, or left to the tree's default. */
function ruleOf(log: Index): string {
  const pinned = pinnedRule(log);
  return pinned.length > 0
    ? `opened with ${pinned.join(", ")}`
    : "opened with no level in its terms (the tree's default)";
}

/** Of a tally, the tasks that did not tie without the bill (`tallyOf`), of all it tallied: `10 of
 *  12`, or "-" where none was made, which until 25 October lane 27 read as "0 of 0". */
export function untied(tested: JsonValue | undefined): string {
  const step = tallyOf(tested);
  return step === null ? "-" : share(step.wins + step.losses, step.wins + step.losses + step.ties);
}

/** One rest comparison as lane 22 reads it: the tally against its own A/A noise, the tally at each
 *  budget, and the host's load while its solves started. */
function restSaid(log: Index, { session, last }: Compared): string {
  const noise =
    asRecord(last.noise) === null
      ? ""
      : `, against the reference's own ${untied(last.noise)} (${testSaid(last.noise)})`;
  const budgets = items(last.budgets).flatMap((budget) => {
    const record = asRecord(budget);
    const unit = UNITS.find((each) => isNumber(record?.[each]));
    return record === null || unit === undefined
      ? []
      : [`${unit} ${String(count(record[unit]))} ${testSaid(record)}`];
  });
  // Over the solves it measured, as lane 24 reads them: buffer's g-1 read 15.3 over its 70 starts on 12
  // October and 37.9 over the 48 that were not non-results.
  const solves = log.solves.filter((solve) => solve.comparison === session && measured(solve));
  const loads = solves.flatMap(({ load }) => (load === null ? [] : [load]));
  const cores = solves.find((solve) => solve.cores !== null)?.cores ?? null;
  const load =
    loads.length === 0
      ? ""
      : `; load median ${(median(loads) ?? 0).toFixed(1)}${cores === null ? "" : ` on ${String(cores)} cores`}`;
  return `${session} ${testSaid(last.scored)} at level ${String(count(last.level))}, untied ${untied(last.scored)}${noise}${budgets.length > 0 ? `; by budget ${budgets.join(", ")}` : ""}${load}`;
}

/** The hours and dollars from event `from` to event `to`: what the campaign paid for a stretch. */
export function spentTo(log: Index, from: number, to: number): string {
  const { events } = log;
  const [start, end] = [
    Date.parse(events[from]?.at ?? ""),
    Date.parse(events[Math.max(from, to - 1)]?.at ?? ""),
  ];
  const hours = Number.isNaN(start) || Number.isNaN(end) ? 0 : (end - start) / 3_600_000;
  const dollars = billedBetween(events, from, to);
  return `${hours.toFixed(1)} h and $${dollars.toFixed(0)}`;
}

/** `PROMOTED` and `STARTER BARE`: the comparisons a promotion rests on, and what each measured. */
function restTriggers(log: Index, { at, until, data }: Epoch): Trigger[] {
  const harness = text(data.harness);
  const since = log.events.findLastIndex(({ kind }, index) => index < at && kind === "harness.promoted");
  // The host's own move is written as it begins, before the promotion it makes (12 October); the
  // Builder's `promote` writes its move once the promotion is on record, after it, and buffer-149's
  // read "by the operator" (14 October). So a move naming the harness anywhere in the stretch
  // between the promotions on either side of it is the table's.
  const byTable = log.events.some(
    ({ kind, data: move }, index) =>
      index > since &&
      index < until &&
      kind === "campaign.move" &&
      move.move === "promote" &&
      move.harness === harness,
  );
  const despite = items(asRecord(data.despite)?.faults ?? data.despite).length;
  const rests = items(data.rests).flatMap((rest) => {
    const session = text(asRecord(rest)?.comparison);
    const compared = log.compared.find((each) => each.session === session);
    return compared === undefined ? [] : [compared];
  });
  const said = rests.map((compared) => restSaid(log, compared));
  // The rule tests the two frontiers joined, a task both scored once (`readTwice`): r3's third
  // promotion read 5-1 p 0.047 and 9-1 p 0.004 alone, and 8-0 p 0.004 joined (19 October).
  const joined = joinedTest(rests.map(({ last }) => last));
  const [wins, losses] = [joined.filter((one) => one > 0).length, joined.filter((one) => one < 0).length];
  const together =
    rests.length < 2 || joined.length === 0
      ? ""
      : `; joined ${String(wins)}-${String(losses)}-${String(joined.length - wins - losses)} p ${pSaid(flipP(joined))}`;
  const bare = rests.flatMap(({ session, last }) => {
    const old = validOf(asRecord(last.valid)?.old);
    const fresh = validOf(asRecord(last.valid)?.fresh);
    return old.tasks > 0 && old.none / old.tasks > BARE
      ? [
          `${session}: the reference answered none of its solves on ${share(old.none, old.tasks)} tasks (${validSaid(old.share)} of solves valid), the new harness ${validSaid(fresh.share)}`,
        ]
      : [];
  });
  return [
    fired(
      "PROMOTED",
      `${short(harness)} from ${short(text(data.from))} at event ${String(at)}, ${spentTo(log, 0, at)} after the opening, ${byTable ? "by the table" : "by the operator"}${despite > 0 ? ` despite ${plural(despite, "fault")}` : ""}; ${ruleOf(log)}; rests on ${said.join("; ") || "no comparison on record"}${together}`,
    ),
    ...(bare.length > 0 ? [fired("STARTER BARE", bare.join("; "))] : []),
  ];
}

/** `AFTER THE PROMOTION`: the room Examiner, the controls, the comparisons against the promoted
 *  harness and the Builder sessions that worked in the epoch the promotion opened: a led Builder's
 *  conversation opened before the promotion goes on across it. */
function afterTrigger(log: Index, { at, until, data }: Epoch, starter: string): Trigger {
  const promoted = text(data.harness);
  const within = (index: number) => index > at && index < until;
  const ended = new Set(log.of(EXAM_END).map((exam) => text(exam.session)));
  const exams = log.events.flatMap(({ kind, data: exam }, index) => {
    if (!within(index)) return [];
    if (kind === EXAM_END) return [`${text(exam.session)} held ${String(items(exam.held).length)}`];
    return kind === "exam.started" && !ended.has(text(exam.session))
      ? [`${text(exam.session)} started, not finished`]
      : [];
  });
  const proposed = new Set(
    log.events.flatMap(({ kind, data: task }, index) =>
      within(index) && kind === "task.proposed" ? [text(task.version)] : [],
    ),
  );
  const compared = log.compared.filter((each) => within(each.at));
  // A control's tasks drawn before the promotion are mostly those the promoted harness was promoted
  // on, so its confirmation is read from the reference's side on each age apart: on 3 November
  // fullrun g-4 read 10-0-0 on the older and 2-6-3 on the newer, last g-2 8-0-6 and 4-1-1.
  const drawn = new Map<string, number>();
  for (const [index, { kind, data: start }] of log.events.entries()) {
    if (kind !== "comparison.started") continue;
    for (const task of items(start.tasks).filter(isString)) if (!drawn.has(task)) drawn.set(task, index);
  }
  const byAge = (last: JsonObject) => {
    const ages = ["frontier", "retained"].flatMap((part) => {
      // `of` names the task of each score; `tasks` also holds the short and disputed ones.
      const record = asRecord(last[part]);
      const tasks = items(record?.of);
      const scores = scoresIn(record);
      return tasks.length === scores.length
        ? tasks.map((task, i) => ({ newer: (drawn.get(text(task)) ?? 0) > at, score: -(scores[i] ?? 0) }))
        : [];
    });
    const said = (when: "after" | "before") => {
      const scores = ages.filter((one) => one.newer === (when === "after")).map(({ score }) => score);
      const step = tallyOf({ unbilled: scores });
      return step === null || scores.length === 0 ? "none" : `${wlt(step)} p ${pSaid(step.p)}`;
    };
    return `; for the reference on tasks first drawn after the promotion ${said("after")}, before it ${said("before")}`;
  };
  const read = ({ session, last }: Compared) => {
    const old = validOf(asRecord(last.valid)?.old);
    const control = last.fresh === starter && last.old === promoted;
    return control
      ? `control ${session}: the promoted harness valid on ${validSaid(old.share)} of its solves of ${plural(old.tasks, "task")}, ${testSaid(last.scored)}${byAge(last)}`
      : `${session} ${short(text(last.fresh))} against ${last.old === promoted ? "the promoted harness" : short(text(last.old))} ${testSaid(last.scored)}, ${text(last.reading)}, valid ${validSaid(validOf(asRecord(last.valid)?.fresh).share)} against ${validSaid(old.share)}`;
  };
  // Every report, a ladder reading of 14 to 16 October among them, which `compared` leaves out.
  const reported = new Set(log.of("comparison.reported").map((report) => text(report.session)));
  const running = log.events.flatMap(({ kind, data: start }, index) =>
    within(index) && kind === "comparison.started" && !reported.has(text(start.session))
      ? [`${text(start.session)} started, not reported`]
      : [],
  );
  const builds = log.builds
    .filter((build) => within(build.from) || build.calls.some((call) => within(call.index)))
    .map((build) => {
      const practised = new Set(practiceOf(log, build).map((solve) => solve.version));
      const fresh = [...practised].filter((version) => proposed.has(version)).length;
      return `${build.session} from ${build.parent === promoted ? "the promoted harness" : short(build.parent)}, practising ${String(practised.size)} (${String(fresh)} written since the promotion)`;
    });
  // After a promotion the table reads the budget rule again on the promoted harness's own solves
  // (`noRoom`, `src/campaign/decide.ts`): a setting here is that rule's move.
  const settings = log.events.flatMap(({ kind, data: setting }, index) =>
    within(index) && kind === "campaign.setting" ? [`model turns ${String(count(setting.modelTurns))}`] : [],
  );
  const parts = [
    ...(settings.length > 0 ? [`settings: ${settings.join(", ")}`] : []),
    `Examiner sessions: ${exams.join(", ") || "none"}`,
    ...compared.map(read),
    ...running,
    `Builder sessions: ${builds.join("; ") || "none"}`,
  ];
  return fired(
    "AFTER THE PROMOTION",
    `${short(promoted)}, ${spentTo(log, at, until)} since: ${parts.join("; ")}`,
  );
}

/** `SHARED TEMPORARY FOLDER`: successful calls naming a path outside the seats' roots under the
 *  host's temporary folders, by role, solves by side and practice apart, with paths named by more
 *  than one seat. */
function sharedTmpTrigger(log: Index): Trigger[] {
  const calls = log.traces.filter(
    (each): each is Call => each.part === "call" && !each.isError && sharedPaths(each).length > 0,
  );
  const of = (seat: Seat) => calls.filter((call) => call.seat === seat);
  const solves = new Map(log.solves.map((solve) => [solve.id, solve]));
  // Read from each start, so a comparison still running has its sides too.
  const reference = new Map(
    log.of("comparison.started").map((start) => [text(start.session), text(start.old)]),
  );
  const touched = [...new Set(of("solve").map(({ id }) => id))];
  const bySide = countBy(touched, (id) => {
    const solve = solves.get(id);
    if (solve === undefined) return "unknown";
    if (solve.comparison === null) return "practice";
    // An Examiner's try names its own session there and no comparison starts under it: until
    // 11 November esp32's 19 tries read as a comparison's new side.
    const old = reference.get(solve.comparison);
    if (old === undefined) return `${solve.comparison} try ${short(solve.harness)}`;
    const side = solve.harness === old ? "reference" : "new";
    return `${solve.comparison} ${side} ${short(solve.harness)}`;
  });
  const namers = new Map<string, Set<string>>();
  for (const call of calls) {
    for (const path of sharedPaths(call)) namers.set(path, (namers.get(path) ?? new Set()).add(call.id));
  }
  const crossing = [...namers]
    .filter(([, by]) => by.size > 1)
    .toSorted(([, left], [, right]) => right.size - left.size)
    .slice(0, MOST_PATHS)
    .map(([path, by]) => `${path} by ${String(by.size)}`);
  const programs = [...namers].flatMap(([path, by]) =>
    path.includes("/bin/") ? [`${path} by ${[...by].toSorted().join(" ")}`] : [],
  );
  const sessions = (seat: Seat) => tally(countBy(of(seat), ({ id }) => id || "unknown"));
  const lines = [
    ...(touched.length > 0 ? [`${plural(touched.length, "solve")} by side: ${tally(bySide)}`] : []),
    ...(of("build").length > 0 ? [`Builder calls: ${sessions("build")}`] : []),
    ...(of("exam").length > 0 ? [`Examiner calls: ${sessions("exam")}`] : []),
    ...(programs.length > 0 ? [`programs under it: ${programs.join(", ")}`] : []),
    ...(crossing.length > 0 ? [`named by more than one solve or session: ${crossing.join(", ")}`] : []),
  ];
  return lines.length > 0 ? [fired("SHARED TEMPORARY FOLDER", lines.join("; "))] : [];
}

/** Lane 22: every promotion the log holds, and the host's temporary folder wherever it is named;
 *  beside them lane 19's confirmation, lane 17's carriers and lanes 28 and 29 (`chainTrigger`, `marginTrigger`). */
export function promotionTriggers(log: Index): Trigger[] {
  const starter = log.compared.map(({ last }) => last.starter).find(isString) ?? "";
  const epochs = epochsOf(log.events);
  return [
    ...epochs.flatMap((epoch) => [...restTriggers(log, epoch), afterTrigger(log, epoch, starter)]),
    ...unconfirmedTrigger(log),
    ...chainTrigger(log),
    ...carrierTrigger(log),
    ...marginTrigger(log),
    ...sharedTmpTrigger(log),
  ];
}

/** `STEP CARRIERS` (lane 17): each step's untied tasks on the scores it is read on (`scoresIn`), and how many of its largest
 *  wins it could lose to a tie and still clear its level (`spareOf`, `clearance.ts`), with its retained tasks' tally where
 *  it lost more of them than it won. Until 12 November it also said where a step won tasks in one family only (0 of the
 *  6 starter reads after such a step confirmed its promotion), which a draw of one task a family rules out. On 1 November the gate ablation's g-3 cleared at
 *  6-0 with none to spare, and supply's g-2 lost its step without the 5 tasks priced in yen; lanes
 *  15, 23, 25 and 34 each found a part of that. */
function carrierTrigger(log: Index): Trigger[] {
  const lines = log.compared.flatMap(({ session, last }) => {
    const unbilled = scoresIn(last.scored);
    if (text(last.reading) !== "step" || unbilled.length === 0) return [];
    const spare = spareOf(unbilled, count(last.level));
    const retained = testOf(scoresIn(last.retained));
    const lost = retained.losses > retained.wins ? `, its retained tasks ${wlt(retained)}` : "";
    return [
      `${session} won ${share(unbilled.filter((one) => one > 0).length, unbilled.filter((one) => one !== 0).length)} untied, ${spare === 0 ? "none" : String(spare)} to spare${lost}`,
    ];
  });
  return lines.length > 0 ? [fired("STEP CARRIERS", lines.join("; "))] : [];
}

/** `PROMOTION UNCONFIRMED` (lane 19): each promotion whose epoch has no starter comparison, or whose
 *  first one that tallied a task does not read the reference above the starter (`confirmed`,
 *  `src/campaign/climb.ts`; the last one until 2 November).
 *  On 1 November none of the gate ablation's five promotions and the validity arm's one was
 *  confirmed, and lanes 24 and 28 found it by reading the moves. */
function unconfirmedTrigger(log: Index): Trigger[] {
  const epochs = epochsRead(log.events);
  const lines = epochs.flatMap(({ nth, reference, to, starter_tally: against, confirmed }) => {
    if (confirmed !== false) return [];
    const read =
      against === null
        ? "no starter comparison reported"
        : `against the starter ${wlt(against)} without the bill, no step`;
    return [`${short(reference)} in epoch ${String(nth)}, ${to === null ? "open" : "closed"}: ${read}`];
  });
  return lines.length > 0
    ? [
        fired(
          "PROMOTION UNCONFIRMED",
          `${share(lines.length, epochs.length - 1)} promotions: ${lines.join("; ")}`,
        ),
      ]
    : [];
}

/** `CHAIN AGAINST THE STARTER` (lane 28): two or more starter reads whose tasks written after their
 *  promotions the reference lost more often than it won, summed over the reads. Each promotion is
 *  read against its parent, so a chain of them can each win and still fail to beat the starter on
 *  tasks that chose none of them. A starter read mixes three kinds of task (`starterReads`), and only
 *  those written after the promotion are new to the promoted harness; they are also written by an
 *  Examiner that reads the reference's outcomes (`src/examiner/record.ts`), so they may lean against
 *  the reference and not the starter. A reference that loses more than it wins there is margin noise
 *  selected for, the Examiner's aim, or a worse harness, which this separates and does not decide. */
function chainTrigger(log: Index): Trigger[] {
  const reads = starterReads(log.events);
  if (reads.length < 2) return [];
  const of = (origin: Origin) => summed(reads.map(({ origins }) => origins[origin].whole));
  const after = of(AFTER);
  if (after.losses <= after.wins) return [];
  const each = reads.map(({ session, origins }) => `${session} ${wlt(origins[AFTER].whole)}`);
  const alone = (reading: string) => reads.filter(({ after: read }) => read === reading).length;
  return [
    fired(
      "CHAIN AGAINST THE STARTER",
      `the reference's wins, losses and ties against the starter on tasks written after its promotion, oldest read first: ${each.join(", ")}; summed ${wlt(after)}, on tasks written before and not chosen on ${wlt(of(BEFORE))}, on the tasks that chose the harness ${wlt(of(CHOSEN))}; on the tasks written after alone, ${share(alone("a step"), reads.length)} reads a step and ${String(alone("a step for the starter"))} a step for the starter`,
    ),
  ];
}

/** `MARGINS INSIDE THE NOISE` (lane 29): a step whose untied tasks all tie on validity is carried by the
 *  objective alone, each win a margin between two valid answers. Each side read against itself under
 *  the same setting, rebuilt from its solves (`pairsReported`), gives on a task whose halves tied on
 *  validity the margin two solves of one harness reach by chance; a task a side's halves split on
 *  validity scores up to 600 points, which no win between valid answers reaches (`WEIGHTS`), so it
 *  sets no ceiling. Scores are read under this tree's rule (`differenceOf`). It fires on each step whose untied tasks all tie on validity and more
 *  than half of whose wins are no larger than the wider of the two sides' own differences on the
 *  same task, each side read against itself where its halves tied on validity. A win on a task both
 *  sides repeated exactly is the difference of two repeated answers, where no split of either side
 *  shows noise (`repeatLine`, `src/campaign/climb.ts`), and is not counted inside: until
 *  11 November a win where the A/A alone tied was told as clear of a zero difference only, and 62 of
 *  the 121 objective-only steps on record fired on that count, in 61 of them on tasks the new side
 *  repeated exactly too. The new side's own difference bounds a win as the reference's does, which
 *  the reference's alone left out. */
function marginTrigger(log: Index): Trigger[] {
  const lines = lastReports(log.events).flatMap((report) => {
    if (report.data.reading !== "step") return [];
    const unequal = pairsReported(log.events, report).filter((pair) => differenceOf(pair) !== 0);
    if (unequal.length === 0 || unequal.some((pair) => pointsOf(pair).validity !== 0)) return [];
    const own = (side: "old" | "fresh") =>
      new Map(
        pairsReported(log.events, report, side)
          .filter((pair) => pointsOf(pair).validity === 0)
          .map((pair) => [pair.task, Math.abs(differenceOf(pair))]),
      );
    const [reference, candidate] = [own("old"), own("fresh")];
    if (reference.size === 0) return [];
    const wins = unequal.filter((pair) => differenceOf(pair) > 0);
    const inside = wins.filter(
      (pair) =>
        differenceOf(pair) <= Math.max(reference.get(pair.task) ?? -1, candidate.get(pair.task) ?? -1),
    ).length;
    return inside * 2 > wins.length
      ? [
          `${report.session} won ${share(inside, wins.length)} by no more than the wider of the two sides' own differences on the same task where validity tied`,
        ]
      : [];
  });
  return lines.length > 0 ? [fired("MARGINS INSIDE THE NOISE", lines.join("; "))] : [];
}
