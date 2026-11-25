/**
 * The promotion lane's triggers (lane 6): what each promotion rested on, what it measured, what
 * touched both its sides, and what the campaign did after it. A validity percentage needs a task and
 * solve denominator; a missing measurement reads unmeasured.
 */
import { epochsOf as epochsRead, ORIGINS, type Origin, starterReads } from "#src/campaign/climb.ts";
import { short } from "#src/campaign/move.ts";
import { differenceOf, flipP, gainOver, GAP_FLOOR, pointsOf, scoresIn, testOf } from "#src/kernel/compare.ts";
import { eventsOf, type LogEvent } from "#src/kernel/log.ts";
import type { Call, Seat } from "#src/kernel/trace.ts";
import { billedBetween } from "#src/kernel/meter.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import {
  type Compared,
  count,
  EXAM_END,
  fired,
  emitIf,
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
  formatTally,
} from "./folds.ts";
import { spareOf } from "./clearance.ts";

interface Epoch {
  readonly at: number;
  readonly until: number;
  readonly data: JsonObject;
}

const [CHOSEN, BEFORE, AFTER] = ORIGINS;
const UNITS = ["turns", "prompts", "cpu", "seconds"] as const;
const WALL_DENIED_RE = /\b(?:Operation not permitted|EPERM|Read-only file system)\b/u;
const BARE = 0.5;
const SHARED_PATH =
  /(?:^|[\s"'=:;(|&>])(\/(?:private\/)?(?:var\/)?tmp\/(?!ana-built-bash\/)[^\s"'\\;)|&<>*]+)/g;
const MOST_PATHS = 6;

export function sharedPaths({ args }: Call): string[] {
  const raw = JSON.stringify(args);
  return raw.includes("tmp/") ? [...raw.matchAll(SHARED_PATH)].map(([, path = ""]) => path) : [];
}

/** `w-l-t p` of a test record, or "not scored" where there is none, as a stopped comparison's. */
export function formatTestSummary(tested: JsonValue | undefined): string {
  const record = asRecord(tested);
  const step = tallyOf(tested);
  if (record === null || step === null) return "not scored";
  const format = (read: typeof step) => `${formatTally(read)} p ${formatPValue(read.p)}`;
  const billed = format({
    wins: count(record.wins),
    losses: count(record.losses),
    ties: count(record.ties),
    p: count(record.p),
  });
  return format(step) === billed ? billed : `${billed}, without the bill ${format(step)}`;
}

export const formatPValue = (p: number) => (p < 0.001 ? p.toExponential(1) : p.toFixed(3));

/** The differences a report's step was read on, each with its task where named. */
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

/** The differences a promotion's readings tested (`testedOf`) joined, summing tasks scored twice. */
export function joinedTest(reports: readonly JsonObject[]): number[] {
  const sums = new Map<string, number>();
  const unnamed: number[] = [];
  for (const report of reports) {
    const { differences, of } = testedOf(report);
    for (const [at, difference] of differences.entries()) {
      const task = of[at];
      if (task === undefined) unnamed.push(difference);
      else sums.set(task, (sums.get(task) ?? 0) + difference);
    }
  }
  return [...sums.values(), ...unnamed];
}

/** Of a report's `valid` side: tasks with none valid, total tasks, and share of solves valid. */
export function validOf(side: JsonValue | undefined) {
  const columns = items(side).map(count);
  const tasks = columns.reduce((sum, value) => sum + value, 0);
  const solves = columns.length - 1;
  const valid = columns.reduce((sum, value, index) => sum + value * index, 0);
  return { none: columns[0] ?? 0, tasks, share: tasks === 0 || solves < 1 ? null : valid / (tasks * solves) };
}

export const formatValidityRate = (value: number | null): string =>
  value === null ? "unmeasured" : `${(value * 100).toFixed(0)}%`;

export function epochsOf(events: readonly LogEvent[]): Epoch[] {
  const promoted = eventsOf(events, "harness.promoted");
  return promoted.map(({ index, event }, position) => ({
    at: index,
    until: promoted[position + 1]?.index ?? events.length,
    data: event.data,
  }));
}

/** The step rule an opening pins in its terms; none leaves it to the tree's default. */
export function pinnedRule(log: Index): string[] {
  const terms = asRecord(log.of("campaign.opened").at(-1)?.terms);
  return ["level", "trigger"].flatMap((key) =>
    isString(terms?.[key]) ? [`${key} ${text(terms[key])}`] : [],
  );
}

/** Of a tally, the tasks that did not tie without the bill (`tallyOf`), of all it tallied. */
export function untied(tested: JsonValue | undefined): string {
  const step = tallyOf(tested);
  return step === null ? "-" : share(step.wins + step.losses, step.wins + step.losses + step.ties);
}

/** One supporting comparison as the promotion lane reads it: the tally against its own A/A noise,
 *  the tally at each budget, and the host's load while its solves started. */
function formatSupportingComparison(log: Index, { session, last }: Compared): string {
  const noise =
    asRecord(last.noise) === null
      ? ""
      : `, against the reference's own ${untied(last.noise)} (${formatTestSummary(last.noise)})`;
  const budgets = items(last.budgets).flatMap((budget) => {
    const record = asRecord(budget);
    const unit = UNITS.find((each) => isNumber(record?.[each]));
    return record === null || unit === undefined
      ? []
      : [`${unit} ${String(count(record[unit]))} ${formatTestSummary(record)}`];
  });
  const solves = log.solves.filter((solve) => solve.comparison === session && measured(solve));
  const loads = solves.flatMap(({ load }) => (load === null ? [] : [load]));
  const cores = solves.find((solve) => solve.cores !== null)?.cores ?? null;
  const load =
    loads.length === 0
      ? ""
      : `; load median ${(median(loads) ?? 0).toFixed(1)}${cores === null ? "" : ` on ${String(cores)} cores`}`;
  return `${session} ${formatTestSummary(last.scored)} at level ${String(count(last.level))}, untied ${untied(last.scored)}${noise}${budgets.length > 0 ? `; by budget ${budgets.join(", ")}` : ""}${load}`;
}

export function spentTo(log: Index, from: number, to: number): string {
  const { events } = log;
  const [start, end] = [
    Date.parse(events[from]?.at ?? ""),
    Date.parse(events[Math.max(from, to - 1)]?.at ?? ""),
  ];
  const hours = Number.isNaN(start) || Number.isNaN(end) ? 0 : (end - start) / 3_600_000;
  return `${hours.toFixed(1)} h and $${billedBetween(events, from, to).toFixed(0)}`;
}

function restTriggers(log: Index, { at, until, data }: Epoch, since: number, rule: string): Trigger[] {
  const harness = text(data.harness);
  const byTable = eventsOf(log.events, "campaign.move").some(
    ({ index, event: { data: move } }) =>
      index > since && index < until && move.move === "promote" && move.harness === harness,
  );
  const despite = items(asRecord(data.despite)?.faults ?? data.despite).length;
  const rests = items(data.rests).flatMap((rest) => {
    const session = text(asRecord(rest)?.comparison);
    const compared = log.compared.find((each) => each.session === session);
    return compared === undefined ? [] : [compared];
  });
  const summaries = rests.map((compared) => formatSupportingComparison(log, compared));
  // The rule tests the two frontiers joined, summing a task both scored (`joinedTest`), which can read
  // otherwise than either alone.
  const joined = joinedTest(rests.map(({ last }) => last));
  const [wins, losses] = [joined.filter((one) => one > 0).length, joined.filter((one) => one < 0).length];
  const together =
    rests.length < 2 || joined.length === 0
      ? ""
      : `; joined ${String(wins)}-${String(losses)}-${String(joined.length - wins - losses)} p ${formatPValue(flipP(joined))}`;
  const bare = rests.flatMap(({ session, last }) => {
    const old = validOf(asRecord(last.valid)?.old);
    const fresh = validOf(asRecord(last.valid)?.fresh);
    return old.tasks > 0 && old.none / old.tasks > BARE
      ? [
          `${session}: the reference answered none of its solves on ${share(old.none, old.tasks)} tasks (${formatValidityRate(old.share)} of solves valid), the new harness ${formatValidityRate(fresh.share)}`,
        ]
      : [];
  });
  return [
    fired(
      "PROMOTED",
      `${short(harness)} from ${short(text(data.from))} at event ${String(at)}, ${spentTo(log, 0, at)} after the opening, ${byTable ? "by the table" : "by the operator"}${despite > 0 ? ` despite ${plural(despite, "fault")}` : ""}; ${rule}; rests on ${summaries.join("; ") || "no comparison on record"}${together}`,
    ),
    ...emitIf(bare.length > 0, "STARTER BARE", bare.join("; ")),
  ];
}

/** `AFTER THE PROMOTION`: Examiner, controls, comparisons, and Builder sessions in the epoch. */
function afterTrigger(
  log: Index,
  { at, until, data }: Epoch,
  starter: string,
  drawn: ReadonlyMap<string, number>,
): Trigger {
  const promoted = text(data.harness);
  const within = (index: number) => index > at && index < until;
  const ended = new Set(log.of(EXAM_END).map((exam) => text(exam.session)));
  const exams = eventsOf(log.events, ["exam.started", EXAM_END]).flatMap(
    ({ index, event: { kind, data: exam } }) => {
      if (!within(index)) return [];
      if (kind === EXAM_END) return [`${text(exam.session)} held ${String(items(exam.held).length)}`];
      return ended.has(text(exam.session)) ? [] : [`${text(exam.session)} started, not finished`];
    },
  );
  const proposed = new Set(
    eventsOf(log.events, "task.proposed").flatMap(({ index, event }) =>
      within(index) ? [text(event.data.version)] : [],
    ),
  );
  const byAge = (last: JsonObject) => {
    const ages = ["frontier", "retained"].flatMap((part) => {
      const record = asRecord(last[part]);
      const tasks = items(record?.of);
      const scores = scoresIn(record);
      return tasks.length === scores.length
        ? tasks.map((task, i) => ({ newer: (drawn.get(text(task)) ?? 0) > at, score: -(scores[i] ?? 0) }))
        : [];
    });
    const formatAge = (when: "after" | "before") => {
      const scores = ages.filter((one) => one.newer === (when === "after")).map(({ score }) => score);
      const step = tallyOf({ unbilled: scores });
      return step === null || scores.length === 0 ? "none" : `${formatTally(step)} p ${formatPValue(step.p)}`;
    };
    return `; for the reference on tasks first drawn after the promotion ${formatAge("after")}, before it ${formatAge("before")}`;
  };
  const read = ({ session, last }: Compared) => {
    const old = validOf(asRecord(last.valid)?.old);
    return last.fresh === starter && last.old === promoted
      ? `control ${session}: the promoted harness valid on ${formatValidityRate(old.share)} of its solves of ${plural(old.tasks, "task")}, ${formatTestSummary(last.scored)}${byAge(last)}`
      : `${session} ${short(text(last.fresh))} against ${last.old === promoted ? "the promoted harness" : short(text(last.old))} ${formatTestSummary(last.scored)}, ${text(last.reading)}, valid ${formatValidityRate(validOf(asRecord(last.valid)?.fresh).share)} against ${formatValidityRate(old.share)}`;
  };
  const reported = new Set(log.of("comparison.reported").map((report) => text(report.session)));
  const running = eventsOf(log.events, "comparison.started").flatMap(({ index, event: { data: start } }) =>
    within(index) && !reported.has(text(start.session))
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
  const settings = eventsOf(log.events, "campaign.setting").flatMap(({ index, event: { data: setting } }) =>
    within(index) ? [`model turns ${String(count(setting.modelTurns))}`] : [],
  );
  const parts = [
    ...(settings.length > 0 ? [`settings: ${settings.join(", ")}`] : []),
    `Examiner sessions: ${exams.join(", ") || "none"}`,
    ...log.compared.filter((each) => within(each.at)).map(read),
    ...running,
    `Builder sessions: ${builds.join("; ") || "none"}`,
  ];
  return fired(
    "AFTER THE PROMOTION",
    `${short(promoted)}, ${spentTo(log, at, until)} since: ${parts.join("; ")}`,
  );
}

/** `SHARED TEMPORARY FOLDER`: successful calls naming a path outside the seats' roots under `/tmp`. */
function sharedTmpTrigger(log: Index): Trigger[] {
  const hits: { call: Call; paths: string[] }[] = [];
  for (const each of log.traces) {
    if (each.part !== "call" || each.isError || WALL_DENIED_RE.test(each.text)) continue;
    const paths = sharedPaths(each);
    if (paths.length > 0) hits.push({ call: each, paths });
  }
  if (hits.length === 0) return [];
  const of = (seat: Seat) => hits.filter(({ call }) => call.seat === seat).map(({ call }) => call);
  const solves = new Map(log.solves.map((solve) => [solve.id, solve]));
  const reference = new Map(
    log.of("comparison.started").map((start) => [text(start.session), text(start.old)]),
  );
  const touched = [...new Set(of("solve").map(({ id }) => id))];
  const bySide = countBy(touched, (id) => {
    const solve = solves.get(id);
    if (solve === undefined) return "unknown";
    if (solve.comparison === null) return "practice";
    const old = reference.get(solve.comparison);
    if (old === undefined) return `${solve.comparison} try ${short(solve.harness)}`;
    return `${solve.comparison} ${solve.harness === old ? "reference" : "new"} ${short(solve.harness)}`;
  });
  const namers = new Map<string, Set<string>>();
  for (const { call, paths } of hits) {
    for (const path of paths) namers.set(path, (namers.get(path) ?? new Set()).add(call.id));
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
  return emitIf(lines.length > 0, "SHARED TEMPORARY FOLDER", lines.join("; "));
}

/** The promotion triggers: promotions, shared `/tmp` calls, confirmation, carriers, chain and noise
 *  margins. */
export function promotionTriggers(log: Index): Trigger[] {
  const starter = log.compared.map(({ last }) => last.starter).find(isString) ?? "";
  const epochs = epochsOf(log.events);
  const pinned = pinnedRule(log);
  const rule =
    pinned.length > 0
      ? `opened with ${pinned.join(", ")}`
      : "opened with no level in its terms (the tree's default)";
  const drawn = new Map<string, number>();
  const startTasks =
    epochs.length === 0
      ? []
      : eventsOf(log.events, "comparison.started").flatMap(({ index, event }) =>
          items(event.data.tasks)
            .filter(isString)
            .map((task) => [task, index] as const),
        );
  for (const [task, index] of startTasks) if (!drawn.has(task)) drawn.set(task, index);
  return [
    ...epochs.flatMap((epoch, position) => [
      ...restTriggers(log, epoch, epochs[position - 1]?.at ?? -1, rule),
      afterTrigger(log, epoch, starter, drawn),
    ]),
    ...unconfirmedTrigger(log),
    ...chainTrigger(log),
    ...carrierTrigger(log),
    ...marginTrigger(log),
    ...sharedTmpTrigger(log),
  ];
}

function carrierTrigger(log: Index): Trigger[] {
  const lines = log.compared.flatMap(({ session, last }) => {
    const unbilled = scoresIn(last.scored);
    if (text(last.reading) !== "step" || unbilled.length === 0) return [];
    const spare = spareOf(unbilled, count(last.level));
    const retained = testOf(scoresIn(last.retained));
    const lost = retained.losses > retained.wins ? `, its retained tasks ${formatTally(retained)}` : "";
    const won = Object.values(asRecord(last.families) ?? {})
      .map((family) => asRecord(asRecord(family)?.frontier))
      .filter((held) => count(held?.wins) + count(held?.losses) + count(held?.ties) > 0)
      .map((held) => count(held?.wins));
    const narrow = won.length > 1 && won.filter((wins) => wins > 0).length === 1;
    return [
      `${session} won ${share(unbilled.filter((one) => one > 0).length, unbilled.filter((one) => one !== 0).length)} untied, ${spare === 0 ? "none" : String(spare)} to spare${lost}${narrow ? `, every win in one of its ${String(won.length)} families` : ""}`,
    ];
  });
  return emitIf(lines.length > 0, "STEP CARRIERS", lines.join("; "));
}

function unconfirmedTrigger(log: Index): Trigger[] {
  const epochs = epochsRead(log.events);
  const lines = epochs.flatMap(({ nth, reference, to, starter_tally: against, confirmed }) => {
    if (confirmed !== false) return [];
    const read =
      against === null
        ? "no starter comparison reported"
        : `against the starter ${formatTally(against)} without the bill, no step`;
    return [`${short(reference)} in epoch ${String(nth)}, ${to === null ? "open" : "closed"}: ${read}`];
  });
  return emitIf(
    lines.length > 0,
    "PROMOTION UNCONFIRMED",
    `${share(lines.length, epochs.length - 1)} promotions: ${lines.join("; ")}`,
  );
}

function chainTrigger(log: Index): Trigger[] {
  const reads = starterReads(log.events);
  if (reads.length < 2) return [];
  const of = (origin: Origin) => summed(reads.map(({ origins }) => origins[origin].whole));
  const after = of(AFTER);
  if (after.losses <= after.wins) return [];
  const each = reads.map(({ session, origins }) => `${session} ${formatTally(origins[AFTER].whole)}`);
  const alone = (reading: string) => reads.filter(({ after: read }) => read === reading).length;
  return [
    fired(
      "CHAIN AGAINST THE STARTER",
      `the reference's wins, losses and ties against the starter on tasks written after its promotion, oldest read first: ${each.join(", ")}; summed ${formatTally(after)}, on tasks written before and not chosen on ${formatTally(of(BEFORE))}, on the tasks that chose the harness ${formatTally(of(CHOSEN))}; on the tasks written after alone, ${share(alone("a step"), reads.length)} reads a step and ${String(alone("a step for the starter"))} a step for the starter`,
    ),
  ];
}

function marginTrigger(log: Index): Trigger[] {
  const lines = log.compared.flatMap((report) => {
    if (report.last.reading !== "step") return [];
    const unequal = report.pairs().filter((pair) => differenceOf(pair) !== 0);
    if (unequal.length === 0 || unequal.some((pair) => pointsOf(pair).validity !== 0)) return [];
    const own = (side: "old" | "fresh") =>
      new Map(
        report
          .pairs(side)
          .filter((pair) => pointsOf(pair).validity === 0)
          .map((pair) => [pair.task, Math.abs(differenceOf(pair))]),
      );
    const [reference, candidate] = [own("old"), own("fresh")];
    if (reference.size === 0) return [];
    const wins = unequal.filter((pair) => differenceOf(pair) > 0);
    const inside = wins.filter(
      (pair) =>
        differenceOf(pair) <= Math.max(reference.get(pair.task) ?? -1, candidate.get(pair.task) ?? -1),
    );
    if (inside.length * 2 < wins.length) return [];
    const steady = inside.filter(
      ({ task, objective: rule }) =>
        candidate.get(task) === 0 &&
        rule?.fresh.every((one) => rule.old.every((other) => gainOver(rule, one, other) > -GAP_FLOOR)) ===
          true,
    ).length;
    const apart =
      steady === 0
        ? ""
        : `, ${String(steady)} of them where the new side repeated itself and lost no pairing`;
    return [
      `${report.session} won ${share(inside.length, wins.length)} by no more than the wider of the two sides' own differences on the same task where validity tied${apart}`,
    ];
  });
  return emitIf(lines.length > 0, "MARGINS INSIDE THE NOISE", lines.join("; "));
}
