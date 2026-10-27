/**
 * Lane 27's triggers: a campaign that promoted a harness, read for what the promotion rested on,
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
import { short } from "#src/campaign/move.ts";
import { flipP } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { billedBetween, type Call, type Seat } from "#src/kernel/trace.ts";
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
  tally,
  text,
  type Trigger,
} from "./folds.ts";

/** A promotion and the stretch of the log it governs: up to the next promotion or the log's end. */
interface Epoch {
  readonly at: number;
  readonly until: number;
  readonly data: JsonObject;
}

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
  if (record === null) return "not scored";
  return `${String(count(record.wins))}-${String(count(record.losses))}-${String(count(record.ties))} p ${pSaid(count(record.p))}`;
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

/** Of a tally, the tasks that did not tie, of all it tallied: `10 of 12`, or "-" where none was
 *  made, which until 25 October lane 27 read as "0 of 0". */
export function untied(tested: JsonValue | undefined): string {
  const record = asRecord(tested);
  if (record === null) return "-";
  const [wins, losses, ties] = ["wins", "losses", "ties"].map((key) => count(record[key]));
  return share((wins ?? 0) + (losses ?? 0), (wins ?? 0) + (losses ?? 0) + (ties ?? 0));
}

/** One rest comparison as lane 27 reads it: the tally against its own A/A noise, the tally at each
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
  // Over the solves it measured, as lane 29 reads them: buffer's g-1 read 15.3 over its 70 starts on 12
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
 *  harness and the Builder sessions from it, in the epoch the promotion opened. */
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
  const read = ({ session, last }: Compared) => {
    const old = validOf(asRecord(last.valid)?.old);
    const control = last.fresh === starter && last.old === promoted;
    return control
      ? `control ${session}: the promoted harness valid on ${validSaid(old.share)} of its solves of ${plural(old.tasks, "task")}, ${testSaid(last.scored)}`
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
    .filter((build) => within(build.from))
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
    const side = solve.harness === reference.get(solve.comparison) ? "reference" : "new";
    return `${solve.comparison} ${side} ${short(solve.harness)}`;
  });
  const namers = new Map<string, Set<string>>();
  for (const call of calls) {
    for (const path of sharedPaths(call)) namers.set(path, (namers.get(path) ?? new Set()).add(call.id));
  }
  const crossing = [...namers]
    .filter(([, by]) => by.size > 1)
    .sort(([, left], [, right]) => right.size - left.size)
    .slice(0, MOST_PATHS)
    .map(([path, by]) => `${path} by ${String(by.size)}`);
  const programs = [...namers].flatMap(([path, by]) =>
    path.includes("/bin/") ? [`${path} by ${[...by].sort().join(" ")}`] : [],
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

/** Lane 27: every promotion the log holds, and the host's temporary folder wherever it is named. */
export function promotionTriggers(log: Index): Trigger[] {
  const starter = log.compared.map(({ last }) => last.starter).find(isString) ?? "";
  const epochs = epochsOf(log.events);
  return [
    ...epochs.flatMap((epoch) => [...restTriggers(log, epoch), afterTrigger(log, epoch, starter)]),
    ...sharedTmpTrigger(log),
  ];
}
