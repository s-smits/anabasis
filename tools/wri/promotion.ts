/**
 * Lane 31's triggers: a campaign that promoted a harness, read for what the promotion rested on,
 * what it measured, what touched both sides of it, and what the campaign did after it.
 *
 * The first live promotion of the climb was abl175-new's on 10 October (c366a2d6, 23:22Z): two
 * comparisons against a starter that answered none of the solves on 9 of 12 tasks, both 10-0-2.
 * Until then no lane asked whether a promotion was the table's rule followed, what it showed beyond
 * "the starter carries no engine", or whether the room Examiner, the control and the next Builder
 * followed it, and a reader rebuilt each from thousands of events. The same night a reference-side
 * solve of that campaign's repeat found and ran a phreeqc another campaign's Builder had compiled
 * under the Mac's shared `/tmp` (plan defect H1), which no trigger read.
 *
 * Split from `read.ts`, which stands near the size policy's ceiling, as `time.ts` and `folds.ts`
 * were. Nothing here reads a file beside the log.
 */
import type { LogEvent } from "#src/kernel/log.ts";
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
  share,
  short,
  spendOf,
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
 *  seat could read on buffer. A solve's own temporary folder is under its root (`/var/folders/…` on
 *  the Mac), never here. */
const SHARED_TMP = /(^|[\s"'=:;(|&>])\/(private\/)?(var\/)?tmp(\/|[\s"';)|&]|$)/;
/** A path under those folders, to the first character a shell or JSON ends a word on. */
export const SHARED_PATH = /(?:^|[\s"'=:;(|&>])(\/(?:private\/)?(?:var\/)?tmp\/[^\s"'\\;)|&<>*]+)/g;
/** The paths a reader is shown, of those more than one solve or session named: a path one solve
 *  writes and another runs is the leak, and a solve's own scratch file is named by it alone. */
const MOST_PATHS = 6;

/** `w-l-t p` of a test record, or "" where there is none. */
export function testSaid(tested: JsonValue | undefined): string {
  const record = asRecord(tested);
  if (record === null) return "";
  const p = count(record.p);
  return `${String(count(record.wins))}-${String(count(record.losses))}-${String(count(record.ties))} p ${p < 0.001 ? p.toExponential(1) : p.toFixed(3)}`;
}

/** Of a report's `valid` side, tasks by how many of their solves were valid: the tasks with none,
 *  the tasks, and the share of solves valid. */
export function validOf(side: JsonValue | undefined) {
  const columns = items(side).map((value) => count(value));
  const tasks = columns.reduce((sum, value) => sum + value, 0);
  const solves = columns.length - 1;
  const valid = columns.reduce((sum, value, index) => sum + value * index, 0);
  return { none: columns[0] ?? 0, tasks, share: tasks === 0 || solves < 1 ? 0 : valid / (tasks * solves) };
}

export function epochsOf(events: readonly LogEvent[]): Epoch[] {
  const at = events.flatMap(({ kind }, index) => (kind === "harness.promoted" ? [index] : []));
  return at.map((index, position) => ({
    at: index,
    until: at[position + 1] ?? events.length,
    data: events[index]?.data ?? {},
  }));
}

/** The opening's step rule: pinned in its terms, or left to the tree's default. */
function ruleOf(log: Index): string {
  const terms = asRecord(log.of("campaign.opened").at(-1)?.terms);
  const pinned = ["level", "trigger"].flatMap((key) =>
    isString(terms?.[key]) ? [`${key} ${text(terms[key])}`] : [],
  );
  return pinned.length > 0
    ? `opened with ${pinned.join(", ")}`
    : "opened with no level in its terms (the tree's default)";
}

/** Of a tally, the tasks that did not tie, of all it tallied: `10 of 12`. */
function untied(tested: JsonValue | undefined): string {
  const record = asRecord(tested);
  const [wins, losses, ties] = ["wins", "losses", "ties"].map((key) => count(record?.[key]));
  return share((wins ?? 0) + (losses ?? 0), (wins ?? 0) + (losses ?? 0) + (ties ?? 0));
}

/** One rest comparison as lane 31 reads it: the tally against its own A/A noise, the tally at each
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
  // Over the solves it measured, as lane 26 reads them: buffer's g-1 read 15.3 over its 70 starts on 12
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
  // The whole log's index with its events cut to a prefix: an index of the slice alone would fold
  // a release of a task proposed before it, and refuse it as never proposed. What was billed by
  // `to` less what was by `from` (`billedBetween`): a sum over the slice billed a session open
  // across its start at its whole sum where it ended.
  const by = (upTo: number) =>
    spendOf({ ...log, events: events.slice(0, upTo) }).reduce((sum, [, each]) => sum + each, 0);
  const dollars = by(to) - by(from);
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
  const bare = rests.flatMap(({ session, last }) => {
    const old = validOf(asRecord(last.valid)?.old);
    const fresh = validOf(asRecord(last.valid)?.fresh);
    return old.tasks > 0 && old.none / old.tasks > BARE
      ? [
          `${session}: the reference answered none of its solves on ${share(old.none, old.tasks)} tasks (${(old.share * 100).toFixed(0)}% of solves valid), the new harness ${(fresh.share * 100).toFixed(0)}%`,
        ]
      : [];
  });
  return [
    fired(
      "PROMOTED",
      `${short(harness)} from ${short(text(data.from))} at event ${String(at)}, ${spentTo(log, 0, at)} after the opening, ${byTable ? "by the table" : "by the operator"}${despite > 0 ? ` despite ${plural(despite, "fault")}` : ""}; ${ruleOf(log)}; rests on ${said.join("; ") || "no comparison on record"}`,
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
      ? `control ${session}: the promoted harness valid on ${(old.share * 100).toFixed(0)}% of its solves of ${plural(old.tasks, "task")}, ${testSaid(last.scored)}`
      : `${session} ${short(text(last.fresh))} against ${last.old === promoted ? "the promoted harness" : short(text(last.old))} ${testSaid(last.scored)}, ${text(last.reading)}, valid ${(validOf(asRecord(last.valid)?.fresh).share * 100).toFixed(0)}% against ${(old.share * 100).toFixed(0)}%`;
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
      const fresh = [...build.practice].filter((version) => proposed.has(version)).length;
      return `${build.session} from ${build.parent === promoted ? "the promoted harness" : short(build.parent)}, practising ${String(build.practice.size)} (${String(fresh)} written since the promotion)`;
    });
  // After a promotion the table reads the budget rule again on the promoted harness's own solves
  // (`noRoom`, `src/builder/decide.ts`): a setting here is that rule's move.
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

/** `SHARED TEMPORARY FOLDER`: calls that name a path under the host's `/tmp`, by role, solves by
 *  side and practice apart, with the paths more than one of them named. */
function sharedTmpTrigger(log: Index): Trigger[] {
  const named = (kind: string) =>
    log.events.filter(
      ({ kind: each, data }) => each === kind && SHARED_TMP.test(JSON.stringify(data.args ?? "")),
    );
  const solves = new Map(log.solves.map((solve) => [solve.id, solve]));
  // Read from each start, so a comparison still running has its sides too.
  const reference = new Map(
    log.of("comparison.started").map((start) => [text(start.session), text(start.old)]),
  );
  const touched = [...new Set(named("solve.call").map(({ data }) => text(data.solve)))];
  const bySide = countBy(touched, (id) => {
    const solve = solves.get(id);
    if (solve === undefined) return "unknown";
    if (solve.comparison === null) return "practice";
    const side = solve.harness === reference.get(solve.comparison) ? "reference" : "new";
    return `${solve.comparison} ${side} ${short(solve.harness)}`;
  });
  const calls = ["solve.call", "build.call", "exam.call"].flatMap(named);
  const namers = new Map<string, Set<string>>();
  for (const { data } of calls) {
    const namer = text(data.solve) || text(data.session);
    for (const [, path = ""] of JSON.stringify(data.args ?? "").matchAll(SHARED_PATH)) {
      namers.set(path, (namers.get(path) ?? new Set()).add(namer));
    }
  }
  const crossing = [...namers]
    .filter(([, by]) => by.size > 1)
    .sort(([, left], [, right]) => right.size - left.size)
    .slice(0, MOST_PATHS)
    .map(([path, by]) => `${path} by ${String(by.size)}`);
  const programs = [...namers].flatMap(([path, by]) =>
    path.includes("/bin/") ? [`${path} by ${[...by].sort().join(" ")}`] : [],
  );
  const sessions = (kind: string) =>
    tally(countBy(named(kind), ({ data }) => text(data.session) || "unknown"));
  const lines = [
    ...(touched.length > 0 ? [`${plural(touched.length, "solve")} by side: ${tally(bySide)}`] : []),
    ...(named("build.call").length > 0 ? [`Builder calls: ${sessions("build.call")}`] : []),
    ...(named("exam.call").length > 0 ? [`Examiner calls: ${sessions("exam.call")}`] : []),
    ...(programs.length > 0 ? [`programs under it: ${programs.join(", ")}`] : []),
    ...(crossing.length > 0 ? [`named by more than one solve or session: ${crossing.join(", ")}`] : []),
  ];
  return lines.length > 0 ? [fired("SHARED TEMPORARY FOLDER", lines.join("; "))] : [];
}

/** Lane 31: every promotion the log holds, and the host's temporary folder wherever it is named. */
export function promotionTriggers(log: Index): Trigger[] {
  const starter = log.compared.map(({ last }) => last.starter).find(isString) ?? "";
  const epochs = epochsOf(log.events);
  return [
    ...epochs.flatMap((epoch) => [...restTriggers(log, epoch), afterTrigger(log, epoch, starter)]),
    ...sharedTmpTrigger(log),
  ];
}
