import { carriedBy, gainOver, type Paired, pointsOf, scoresIn } from "../kernel/compare.ts";
import { familySizes, proposalsOf } from "../kernel/history.ts";
import { eventsOf, isReferenceChange, type LogEvent } from "../kernel/log.ts";
import {
  lastReports,
  objectiveCeiling,
  type Outcome,
  pairsReported,
  poolOf,
  referenceOf,
  type Reported,
  type Standing,
} from "../kernel/reports.ts";
import { howOftenValid } from "../kernel/size.ts";
import { ranUnder, solvesIn, standsOf, verdictsOf } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import { formatScores, OBJECTIVE, objectiveOf, scoresOf, type Task } from "../kernel/verify.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import { epochsOf, starterIn, tasksByEpoch } from "../campaign/climb.ts";
import { reviewInventoryLine, reviewSummariesByTask } from "./reviews.ts";

interface Answered {
  readonly turns: readonly number[];
  readonly measures: readonly number[];
  readonly itemMeans: Readonly<Record<string, number>>;
}

const BLOCKS = {
  "reference-none": "Failed every attempt (reference)",
  "reference-some": "Passed some attempts (reference)",
  "reference-every": "Passed every attempt (reference)",
  new: "Not yet compared",
  disputed: "Awaiting human review on a rejection",
  faulted: "Quarantined (check bug on an answer)",
  "earlier-reference": "Last compared between two earlier harnesses",
  practice: "Released for practice (unscored)",
} as const;
const CARRIED = { validity: "on validity", objective: "on the objective" } as const;
const WON = { reference: "the reference harness", other: "the harness it was compared with" } as const;
const SCORE_FAULT = /^score ([a-z][a-z0-9-]*) /u;

export const measured = (measure: number): string => String(Number(measure.toPrecision(6)));

function blockOf(state: string | undefined, outcome: Outcome | undefined): keyof typeof BLOCKS {
  if (state === "released") return "practice";
  if (state === "disputed") return "faulted";
  return outcome ?? "new";
}

function clausesOf(
  block: keyof typeof BLOCKS,
  pool: ReturnType<typeof poolOf>,
  version: string,
  { turns, measures, itemMeans }: Answered = { turns: [], measures: [], itemMeans: {} },
  budget?: number,
): string[] {
  const answered = block === "reference-every" || block === "reference-some";
  const best = pool.bests.get(version);
  const authorItems = pool.bestScores.get(version);
  const sorted = (values: readonly number[]) => values.toSorted((a, b) => a - b);
  const rubricText = formatScores(itemMeans, (id, value) => {
    const authorVal = authorItems?.[id];
    return authorVal === undefined
      ? `${id}=${measured(value)}`
      : `${id}=${measured(value)} (author ${measured(authorVal)})`;
  });
  const standing: Standing | undefined = pool.standings.get(version);
  return [
    ...(answered && turns.length > 0
      ? [`in ${sorted(turns).join(", ")}${budget === undefined ? "" : ` of ${String(budget)}`} turns`]
      : []),
    ...(answered && measures.length > 0 ? [`measured ${sorted(measures).map(measured).join(", ")}`] : []),
    ...(answered && rubricText !== "" ? [`rubric ${rubricText}`] : []),
    ...(answered && measures.length > 0 && best !== undefined
      ? [`the author's answer measured ${measured(best)}`]
      : []),
    ...(answered
      ? []
      : [pool.feasible.has(version) ? "a valid answer on record" : "no valid answer on record"]),
    ...(standing === undefined
      ? []
      : [
          standing.won === null
            ? "tied there"
            : `won there by ${WON[standing.won]}${standing.by === null ? "" : ` ${CARRIED[standing.by]}`}`,
        ]),
  ];
}

function refereeFaultedOf(events: readonly LogEvent[]): Map<string, Set<string>> {
  const stands = standsOf(events);
  const faulted = new Map<string, Set<string>>();
  const last = new Map<string, { readonly task: string; readonly check: string }>();
  for (const { kind, data } of events) {
    if (kind === "referee.finding" && isString(data.solve) && isString(data.task) && isString(data.check)) {
      last.set(data.solve, { task: data.task, check: data.check });
    }
  }
  for (const [solve, { task, check }] of last) {
    if (stands.get(solve) === "check-defect") {
      faulted.set(task, new Set([...(faulted.get(task) ?? []), check]));
    }
  }
  return faulted;
}

function faultedOf(events: readonly LogEvent[]): Map<string, Set<string>> {
  const faulted = refereeFaultedOf(events);
  const add = (task: string, label: string) =>
    faulted.set(task, new Set([...(faulted.get(task) ?? []), label]));
  for (const { kind, data } of events) {
    if (kind === "verdict" && data.kind === "faulty" && isString(data.task) && isString(data.check)) {
      const hit =
        data.check === OBJECTIVE.id && isString(data.reason) ? SCORE_FAULT.exec(data.reason)?.[1] : undefined;
      add(data.task, hit === undefined ? data.check : `${data.check} (${hit})`);
    }
  }
  return faulted;
}

function referenceAnswers(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  pairsOf: (report: Reported) => Paired[],
): Map<string, Answered> {
  const reference = referenceOf(events);
  const took = new Map(
    solvesIn(events).flatMap(({ id, end }) => (isNumber(end?.turns) ? [[id, end.turns] as const] : [])),
  );
  const verdicts = verdictsOf(events);
  const answered = new Map<string, Answered>();
  for (const report of reports) {
    const side = report.data.fresh === reference ? "fresh" : report.data.old === reference ? "old" : null;
    for (const pair of pairsOf(report)) {
      const solves = side === null ? [] : (pair.solves?.[side] ?? []);
      const valid = solves.filter((_, nth) => side !== null && pair[side][nth] === true);
      const sums = new Map<string, { total: number; count: number }>();
      for (const [id, value] of valid.flatMap((solve) =>
        Object.entries(scoresOf(verdicts.get(solve)?.checker) ?? {}),
      )) {
        const prior = sums.get(id) ?? { total: 0, count: 0 };
        sums.set(id, { total: prior.total + value, count: prior.count + 1 });
      }
      answered.set(pair.task, {
        turns: valid.flatMap((solve) => took.get(solve) ?? []),
        measures: valid.flatMap((solve) => objectiveOf(verdicts.get(solve)?.checker) ?? []),
        itemMeans: Object.fromEntries([...sums].map(([id, { total, count }]) => [id, total / count])),
      });
    }
  }
  return answered;
}

interface OutcomeContext {
  readonly reference: string | null;
  readonly bests: ReadonlyMap<string, number>;
  readonly answered: ReadonlyMap<string, Answered>;
  readonly budget?: number | undefined;
}

function medianOf(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function pacingSummary(
  pairs: readonly Paired[],
  answered: ReadonlyMap<string, Answered>,
  budget: number | undefined,
): string | null {
  const turns = pairs.flatMap((pair) => answered.get(pair.task)?.turns ?? []);
  if (turns.length === 0) return null;
  const med = medianOf(turns);
  if (budget === undefined || budget <= 0) {
    return `Reference valid solves used median ${measured(med)} turns.`;
  }
  const unused = Math.max(0, Math.round((1 - med / budget) * 100));
  return `Reference valid solves used median ${measured(med)}/${String(budget)} turns (${String(unused)}% of turn budget unused).`;
}

function objectiveSummary(
  pairs: readonly Paired[],
  side: "old" | "fresh",
  bests: ReadonlyMap<string, number>,
  answered: ReadonlyMap<string, Answered>,
): string | null {
  const means: number[] = [];
  const rooms: number[] = [];
  for (const pair of pairs) {
    const obj = pair.objective;
    const vals = obj?.[side].filter(isNumber) ?? [];
    if (obj === undefined || vals.length === 0) continue;
    const mean = vals.reduce((sum, val) => sum + val, 0) / vals.length;
    means.push(mean);
    const ceiling = objectiveCeiling(obj, bests.get(pair.task));
    if (ceiling !== null) rooms.push(Math.max(0, gainOver(obj, ceiling, mean)));
  }
  const items = new Map<string, { total: number; count: number }>();
  for (const [id, value] of pairs.flatMap((pair) =>
    Object.entries(answered.get(pair.task)?.itemMeans ?? {}),
  )) {
    const prior = items.get(id) ?? { total: 0, count: 0 };
    items.set(id, { total: prior.total + value, count: prior.count + 1 });
  }
  if (means.length === 0 && items.size === 0) return null;
  const parts: string[] = [];
  if (means.length > 0) {
    const avg = means.reduce((sum, val) => sum + val, 0) / means.length;
    const roomPart =
      rooms.length === 0
        ? ""
        : ` (mean room ${measured(rooms.reduce((sum, val) => sum + val, 0) / rooms.length)})`;
    parts.push(`Reference objective mean ${measured(avg)}${roomPart}`);
  }
  if (items.size > 0) {
    const itemText = formatScores(
      Object.fromEntries([...items].map(([id, { total, count }]) => [id, total / count])),
      (id, val) => `${id}=${measured(val)}`,
    );
    if (itemText !== "") {
      parts.push(parts.length === 0 ? `Reference item means: ${itemText}` : `item means: ${itemText}`);
    }
  }
  return parts.length === 0 ? null : `${parts.join("; ")}.`;
}

function formatOutcomeLine(
  events: readonly LogEvent[],
  report: Reported,
  named: string,
  pairs: readonly Paired[],
  ctx: OutcomeContext,
): string {
  const side = report.data.fresh === ctx.reference ? "fresh" : "old";
  const spreads = pairs.map((pair) => howOftenValid(pair[side]));
  const largest =
    familySizes(
      events,
      pairs.map(({ task }) => task),
    ).sizes[0] ?? 0;
  const count = (spread: string) => String(spreads.filter((each) => each === spread).length);
  const scores = scoresIn(report.data.scored).map((score) => (side === "fresh" ? score : -score));
  const won = (sign: number) => String(scores.filter((score) => Math.sign(score) === sign).length);
  const byValidity = pairs.filter((pair) => carriedBy(pointsOf(pair)) === "validity").length;
  const byObjective = pairs.filter((pair) => carriedBy(pointsOf(pair)) === "objective").length;
  const decided = byValidity + byObjective;
  const carrier =
    decided === 0 ? "" : ` (${String(byValidity)} decided by validity, ${String(byObjective)} by objective)`;
  const aside = Array.isArray(report.data.aside) ? report.data.aside.length : 0;
  const own = side === "old" ? scoresIn(report.data.noise) : [];
  const objLine = objectiveSummary(pairs, side, ctx.bests, ctx.answered);
  const paceLine = pacingSummary(pairs, ctx.answered, ctx.budget);
  return [
    `${named}, scored ${plural(spreads.length, "task")}: reference won ${won(1)}, candidate won ${won(-1)}, ${won(0)} tied${carrier}.`,
    `Largest family: ${String(largest)} tasks.`,
    `Reference passed every attempt on ${count("every")}, some on ${count("some")}, none on ${count("none")}; ${String(aside)} excluded pending review.`,
    ...(spreads.length >= 10 && byObjective === 0 && spreads.every((spread) => spread === "every")
      ? [
          "All scored tasks passed validity on every attempt and the objective decided none of them; retire easy tasks with retire_tasks before writing harder replacements.",
        ]
      : []),
    ...(paceLine === null ? [] : [paceLine]),
    ...(objLine === null ? [] : [objLine]),
    ...(report.data.reading === "check-defects" ? ["Comparison stopped on check defects."] : []),
    ...(own.length === 0
      ? []
      : [
          `Reference A/A control differed on ${String(own.filter((score) => score !== 0).length)} of ${String(own.length)} tasks; ${String(scores.filter((score) => Math.abs(score) > Math.max(0, ...own.map(Math.abs))).length)} of ${String(scores.length)} comparison margins were larger than any A/A margin, and the rest are within same-harness variation.`,
        ]),
  ].join(" ");
}

function outcomeSummaryLines(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  after: number | undefined,
  pairsOf: (report: Reported) => Paired[],
  ctx: Omit<OutcomeContext, "reference">,
): string | null {
  const reference = referenceOf(events);
  const matching = reports.filter(({ data }) => data.old === reference || data.fresh === reference);
  const selected = after === undefined ? matching.slice(-1) : matching.filter(({ index }) => index >= after);
  if (selected.length === 0) return null;
  return selected
    .map((report) =>
      formatOutcomeLine(
        events,
        report,
        after === undefined
          ? `The last comparison the reference harness stood in, ${report.session}`
          : `Comparison ${report.session}, which the reference harness stood in`,
        pairsOf(report),
        { reference, ...ctx },
      ),
    )
    .join("\n\n");
}

function revisionCueOf(events: readonly LogEvent[]): string | null {
  const refereeFaulted = refereeFaultedOf(events);
  if (refereeFaulted.size < 2) return null;
  const checks = [...new Set([...refereeFaulted.values()].flatMap((set) => [...set]))].toSorted();
  return `${plural(refereeFaulted.size, "task")} hold Referee-ruled check defects (${checks.join(", ")}). Inspect the active check program with read_exam and repair faulty checks via revise_exam (kind "repair").`;
}

function starterTracesOf(events: readonly LogEvent[]): Map<string, JsonObject> {
  const starter = starterIn(events);
  if (starter === null) return new Map();
  const verdicts = verdictsOf(events);
  const passed = (id: string): boolean => verdicts.get(id)?.checker?.kind === "pass";
  const latest = new Map<string, ReturnType<typeof ranUnder>[number]>();
  for (const solve of ranUnder(events, solvesIn(events))) {
    const held = latest.get(solve.under.task);
    if (solve.under.harness !== starter || solve.under.side !== "test" || solve.end === null) continue;
    if (held === undefined || passed(solve.id) || !passed(held.id)) latest.set(solve.under.task, solve);
  }
  if (latest.size === 0) return new Map();
  const wanted = new Set([...latest.values()].map(({ id }) => id));
  const tools = new Map<string, Record<string, number>>();
  const cmds = new Map<string, string[]>();
  for (const {
    event: { data },
  } of eventsOf(events, "solve.call")) {
    const id = isString(data.solve) ? data.solve : null;
    if (id === null || !wanted.has(id)) continue;
    const name = isString(data.tool) ? data.tool : "unknown";
    const counts = tools.get(id) ?? {};
    counts[name] = (counts[name] ?? 0) + 1;
    tools.set(id, counts);
    if (name === "bash") {
      const cmd = asRecord(data.args)?.command;
      const list = cmds.get(id) ?? [];
      if (isString(cmd) && list.length < 4) list.push(cmd.replaceAll(/\s+/gu, " ").trim().slice(0, 120));
      cmds.set(id, list);
    }
  }
  return new Map(
    [...latest].map(([task, solve]) => [
      task,
      {
        valid: passed(solve.id),
        turns: isNumber(solve.end?.turns) ? solve.end.turns : null,
        tools: tools.get(solve.id) ?? {},
        firstCommands: cmds.get(solve.id) ?? [],
      },
    ]),
  );
}

function promotedLine(events: readonly LogEvent[], since: number, listed: readonly string[]): string | null {
  const promotion = events[since];
  if (promotion === undefined) return null;
  const under = new Set(tasksByEpoch(events.slice(since)).flat());
  const before = listed.filter((version) => !under.has(version)).length;
  const rests = promotion.data.rests;
  const on = Array.isArray(rests) ? asRecord(rests[0])?.comparison : undefined;
  const lead =
    promotion.kind === "harness.reverted"
      ? "The reference harness was reverted to an earlier harness."
      : `The reference harness was promoted${isString(on) ? ` on the step of comparison ${on}` : ""}.`;
  const lastEpoch = epochsOf(events).at(-1);
  const owed =
    promotion.kind === "harness.promoted" &&
    lastEpoch?.starter_tally === null &&
    lastEpoch.reference !== "starter"
      ? " Its confirmation comparison against the starter has not run yet and needs fresh unseen tasks written after the promotion."
      : "";
  return `${lead} ${String(before)} of the ${String(listed.length)} tasks listed were held out before then, under the harness it replaced.${owed} Files in your home from sessions before then were written while the harness it replaced was the reference.`;
}

function refusedLines(
  events: readonly LogEvent[],
  since: number,
  allProposals: ReturnType<typeof proposalsOf>,
): string[] {
  const drafts = new Map(allProposals.map(({ version, task }) => [version, task]));
  const why = new Map<string, string[]>();
  for (const { kind, data } of events.slice(since + 1)) {
    const task = isString(data.version) ? drafts.get(data.version) : undefined;
    if (kind !== "task.gate" || data.outcome !== "refused" || !isString(data.reason)) continue;
    if (task === undefined || task === null) continue;
    why.set(data.reason, [...(why.get(data.reason) ?? []), `${task.taskId} (${task.family})`]);
  }
  return [...why].map(([reason, named]) => `${reason}: ${named.join(", ")}`);
}

export function taskHistory(
  events: readonly LogEvent[],
  tasks: readonly Pick<Task, "taskId" | "family">[],
  after?: number,
) {
  const states = taskStates(events);
  const pool = poolOf(events);
  const allProposals = proposalsOf(events);
  const proposals = new Map(
    allProposals.flatMap((proposal) => {
      const id = proposal.task?.taskId ?? proposal.taskId;
      return id === null ? [] : [[id, proposal] as const];
    }),
  );
  const pairsCache = new Map<string, Paired[]>();
  const pairsOf = (report: Reported): Paired[] => {
    const cached = pairsCache.get(report.session);
    if (cached !== undefined) return cached;
    const computed = pairsReported(events, report);
    pairsCache.set(report.session, computed);
    return computed;
  };
  const allReports = lastReports(events, "all");
  const currentReports = lastReports(events);
  const answered = referenceAnswers(events, allReports, pairsOf);
  const starterTraces = starterTracesOf(events);
  const faulted = faultedOf(events);
  const reviewed = reviewSummariesByTask(events);
  const setting = events.findLast(({ kind }) => kind === "campaign.setting")?.data.modelTurns;
  const budget = isNumber(setting) ? setting : undefined;
  const since = events.findLastIndex(({ kind }) => isReferenceChange(kind));
  const compared =
    after === undefined
      ? null
      : new Set(
          currentReports
            .filter(({ index }) => index >= after)
            .flatMap(({ data }) => (Array.isArray(data.versions) ? data.versions.filter(isString) : [])),
        );
  const lines = new Map<string, string[]>();
  const listed: string[] = [];
  const metricRows: JsonObject[] = [];
  for (const { taskId, family } of tasks) {
    const version = proposals.get(taskId)?.version ?? "";
    const state = states.get(version);
    if (state === "refused" || compared?.has(version) === false) continue;
    const block = blockOf(state, pool.outcomes.get(version));
    if (block !== "practice") listed.push(version);
    const plain = block === "practice" || block === "earlier-reference" || block === "faulted";
    const ans = answered.get(version);
    const clauses = plain ? [] : clausesOf(block, pool, version, ans, budget);
    const reviewNote = block === "practice" ? [] : [reviewed.get(taskId)].filter(isString);
    const checks = faulted.get(taskId);
    const fault =
      checks === undefined ? [] : [`ruled at fault on an answer to it: ${[...checks].join(", ")}`];
    const heading = BLOCKS[block];
    lines.set(heading, [
      ...(lines.get(heading) ?? []),
      [`${taskId} (${family})`, ...clauses, ...reviewNote, ...fault].join("; "),
    ]);
    metricRows.push({
      taskId,
      family,
      state: state ?? "unknown",
      outcome: heading,
      turns: ans?.turns ?? [],
      measures: ans?.measures ?? [],
      bestAuthor: pool.bests.get(version) ?? null,
      itemMeans: ans?.itemMeans ?? {},
      starterTrace: starterTraces.get(version) ?? null,
    });
  }
  const stood = outcomeSummaryLines(events, currentReports, after, pairsOf, {
    bests: pool.bests,
    answered,
    budget,
  });
  return {
    stood,
    revisionCue: after === undefined || stood !== null ? revisionCueOf(events) : null,
    reviews: after === undefined || stood !== null ? reviewInventoryLine(events) : null,
    metrics: {
      activeFrontier: pool.frontier.length,
      turnBudget: budget ?? null,
      summary: stood,
      tasks: metricRows,
    },
    groups: Object.values(BLOCKS).flatMap((heading): { heading: string; lines: string[] }[] => {
      const held = lines.get(heading) ?? [];
      return held.length === 0 ? [] : [{ heading, lines: held }];
    }),
    promoted: after === undefined || since > after ? promotedLine(events, since, listed) : null,
    refused: after === undefined ? refusedLines(events, since, allProposals) : [],
  };
}
