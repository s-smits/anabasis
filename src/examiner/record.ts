import { type Paired, scoresIn } from "../kernel/compare.ts";
import { familySizes, proposalsOf } from "../kernel/history.ts";
import { isReferenceChange, type LogEvent } from "../kernel/log.ts";
import {
  lastReports,
  type Outcome,
  pairsReported,
  poolOf,
  referenceOf,
  type Reported,
  type Standing,
} from "../kernel/reports.ts";
import { howOftenValid } from "../kernel/size.ts";
import { solvesIn, standsOf, verdictsOf } from "../kernel/solves.ts";
import { taskStates } from "../kernel/task.ts";
import { formatScores, OBJECTIVE, objectiveOf, scoresOf, type Task } from "../kernel/verify.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import { epochsOf, tasksByEpoch } from "../campaign/climb.ts";

interface Answered {
  readonly turns: readonly number[];
  readonly measures: readonly number[];
  readonly itemMeans: Readonly<Record<string, number>>;
}

const BLOCKS = {
  "reference-none": "The reference harness valid in no solve of the last comparison that scored the task",
  "reference-some": "Valid in some solves of it",
  "reference-every": "Valid in every solve of it",
  closed:
    "Closed: valid in every solve of its last two comparisons with no room left by the objective, so now scored only as a check against regressions",
  new: "Not yet compared",
  disputed: "Set aside until a person settles a rejection of an answer to it",
  faulted: "Disputed: a check was at fault on an answer to it",
  "earlier-reference": "Last compared between two other harnesses",
  practice: "In use as practice, and so never scored",
} as const;
const CARRIED = { validity: "on validity", objective: "on the objective" } as const;
const WON = { reference: "the reference harness", other: "the harness it was compared with" } as const;
const SCORE_FAULT = /^score ([a-z][a-z0-9-]*) /u;

export const measured = (measure: number): string => String(Number(measure.toPrecision(6)));

function blockOf(state: string | undefined, outcome: Outcome | "closed" | undefined): keyof typeof BLOCKS {
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
  const answered = block === "reference-every" || block === "reference-some" || block === "closed";
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

function faultedOf(events: readonly LogEvent[]): Map<string, Set<string>> {
  const stands = standsOf(events);
  const faulted = new Map<string, Set<string>>();
  const last = new Map<string, { readonly task: string; readonly check: string }>();
  const add = (task: string, label: string) =>
    faulted.set(task, new Set([...(faulted.get(task) ?? []), label]));
  for (const { kind, data } of events) {
    if (kind === "referee.finding" && isString(data.solve) && isString(data.task) && isString(data.check)) {
      last.set(data.solve, { task: data.task, check: data.check });
    } else if (kind === "verdict" && data.kind === "faulty" && isString(data.task) && isString(data.check)) {
      const hit =
        data.check === OBJECTIVE.id && isString(data.reason) ? SCORE_FAULT.exec(data.reason)?.[1] : undefined;
      add(data.task, hit === undefined ? data.check : `${data.check} (${hit})`);
    }
  }
  for (const [solve, { task, check }] of last) {
    if (stands.get(solve) === "check-defect") add(task, check);
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

function formatOutcomeLine(
  events: readonly LogEvent[],
  report: Reported,
  reference: string | null,
  named: string,
  pairs: readonly Paired[],
): string {
  const side = report.data.fresh === reference ? "fresh" : "old";
  const spreads = pairs.map((pair) => howOftenValid(pair[side]));
  const largest =
    familySizes(
      events,
      pairs.map(({ task }) => task),
    ).sizes[0] ?? 0;
  const count = (spread: string) => String(spreads.filter((each) => each === spread).length);
  const scores = scoresIn(report.data.scored).map((score) => (side === "fresh" ? score : -score));
  const won = (sign: number) => String(scores.filter((score) => Math.sign(score) === sign).length);
  const aside = Array.isArray(report.data.aside) ? report.data.aside.length : 0;
  const own = side === "old" ? scoresIn(report.data.noise) : [];
  return [
    `${named}, scored ${plural(spreads.length, "task")}: the reference harness won ${won(1)}, the harness it was compared with won ${won(-1)}, and ${won(0)} tied.`,
    `The largest family among them held ${String(largest)}.`,
    `The reference harness was valid in every solve on ${count("every")} of them, in some on ${count("some")} and in none on ${count("none")}; ${String(aside)} more ${aside === 1 ? "was" : "were"} set aside.`,
    ...(own.length === 0
      ? []
      : [
          `Its own solves, set against each other there, differed on ${String(own.filter((score) => score !== 0).length)} of the ${String(own.length)}.`,
        ]),
  ].join(" ");
}

function outcomeSummaryLines(
  events: readonly LogEvent[],
  reports: readonly Reported[],
  after: number | undefined,
  pairsOf: (report: Reported) => Paired[],
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
        reference,
        after === undefined
          ? `The last comparison the reference harness stood in, ${report.session}`
          : `Comparison ${report.session}, which the reference harness stood in`,
        pairsOf(report),
      ),
    )
    .join("\n\n");
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
  const faulted = faultedOf(events);
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
  for (const { taskId, family } of tasks) {
    const version = proposals.get(taskId)?.version ?? "";
    const state = states.get(version);
    if (state === "refused" || compared?.has(version) === false) continue;
    const block = blockOf(state, pool.exhausted.includes(version) ? "closed" : pool.outcomes.get(version));
    if (block !== "practice") listed.push(version);
    const plain = block === "practice" || block === "earlier-reference" || block === "faulted";
    const clauses = plain ? [] : clausesOf(block, pool, version, answered.get(version), budget);
    const checks = faulted.get(taskId);
    const fault =
      checks === undefined ? [] : [`ruled at fault on an answer to it: ${[...checks].join(", ")}`];
    const heading = BLOCKS[block];
    lines.set(heading, [
      ...(lines.get(heading) ?? []),
      [`${taskId} (${family})`, ...clauses, ...fault].join("; "),
    ]);
  }
  return {
    stood: outcomeSummaryLines(events, currentReports, after, pairsOf),
    groups: Object.values(BLOCKS).flatMap((heading): { heading: string; lines: string[] }[] => {
      const held = lines.get(heading) ?? [];
      return held.length === 0 ? [] : [{ heading, lines: held }];
    }),
    promoted: after === undefined || since > after ? promotedLine(events, since, listed) : null,
    refused: after === undefined ? refusedLines(events, since, allProposals) : [],
  };
}
