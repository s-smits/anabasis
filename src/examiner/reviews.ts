import { eventsOf, type LogEvent, read, TRACE_KINDS } from "../kernel/log.ts";
import { lastReports } from "../kernel/reports.ts";
import { ranUnder, solvesIn, standsOf } from "../kernel/solves.ts";
import { boundText } from "../meta/bounded-text.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";

type Source = "pair" | "finding" | "draft";

interface ReviewQuery {
  readonly source?: Source | undefined;
  readonly outcome?: string | undefined;
  readonly limit?: number | undefined;
}

interface Review {
  readonly source: Source;
  readonly outcomes: readonly string[];
  readonly text: string;
}

const [PAIR, FINDING, DRAFT] = ["referee.pair", "referee.finding", "referee.draft"] as const;

const [DEFAULT_LIMIT, MAX_LIMIT, REASON_BYTES] = [10, 20, 600];
const HOLISTIC = "holistic";

const str = (value: unknown): string | null => (isString(value) ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);
const fmt = (value: number): string => String(Number(Math.abs(value).toPrecision(4)));
const clip = (value: unknown): string => boundText(str(value) ?? "", REASON_BYTES).shown;

function relation(score: unknown, holistic: unknown): "aligned" | "opposed" | "tie" | null {
  if (!isNumber(score) || !isNumber(holistic)) return null;
  if (score === 0 || holistic === 0) return "tie";
  return Math.sign(score) === Math.sign(holistic) ? "aligned" : "opposed";
}

function mirrored(harnessOf: ReadonlyMap<string, string>, data: JsonObject): boolean {
  const [solve, old] = [str(data.solve), str(data.old)];
  if (solve === null || old === null) return false;
  const left = harnessOf.get(solve);
  return solve === old || (left !== undefined && left === harnessOf.get(old));
}

function votesOf(events: readonly LogEvent[]): Map<string, string> {
  return new Map(
    eventsOf(events, "referee.call").flatMap(({ event: { data } }) => {
      const args = asRecord(data.args);
      const [reader, better, reason] = [str(data.reader), str(args?.better), str(args?.reason)];
      return data.tool !== "record_vote" || data.isError === true || reader === null || better === null
        ? []
        : [[reader, `better=${better}; ${clip(reason)}`] as const];
    }),
  );
}

function pairReview(data: JsonObject, kind: "mirror" | "cross", votes: ReadonlyMap<string, string>): Review {
  const [judge, holistic] = [data.judge, data.holistic];
  const complete = isNumber(judge) && isNumber(holistic);
  const criteria = asRecord(data.criteria) ?? {};
  const disagreed = new Set(strings(data.disagreed));
  const readers = Map.groupBy(strings(data.readers), (id) => id.split(":").at(-2) ?? "");
  const opposed: string[] = [];
  const lines = [...new Set([...Object.keys(criteria), ...readers.keys()])].flatMap((item) => {
    if (item === "") return [];
    const score = criteria[item];
    const vs = item === HOLISTIC ? null : relation(score, holistic);
    if (vs === "opposed") opposed.push(item);
    const gap = score === 0 ? "tie" : isNumber(score) ? `gap=${fmt(score)}` : "incomplete";
    const swap = disagreed.has(item) ? "swap-disagreed" : "swap-consistent";
    return [
      `  - ${item}: ${gap}, ${swap}${vs === null ? "" : `, holistic=${vs}`}`,
      ...(readers.get(item) ?? []).map(
        (id, at) =>
          `    pass ${String(at + 1)}${at === 0 ? "" : " (swapped)"}: ${votes.get(id) ?? "reason unavailable"}`,
      ),
    ];
  });
  const status = complete
    ? `judge-gap=${fmt(judge)} holistic-gap=${fmt(holistic)} (${relation(judge, holistic) ?? "tie"})`
    : "incomplete";
  return {
    source: "pair",
    outcomes: [
      complete ? "complete" : "incomplete",
      kind,
      ...(disagreed.size > 0 ? ["disagreed"] : []),
      ...(opposed.length > 0 ? ["holistic-oppose"] : []),
    ],
    text: [
      `[pair] ${str(data.comparison) ?? "unknown"} | task=${str(data.task) ?? "unknown"} | ${kind} | ${status}`,
      ...lines,
    ].join("\n"),
  };
}

function findingReview(data: JsonObject, comparison: string, standing: string): Review {
  const ruling = str(data.ruling) ?? "unruled";
  const meta = [
    `ruling=${ruling}`,
    ...(standing === ruling ? [] : [`standing=${standing}`]),
    ...(["check", "rule", "field"] as const).flatMap((key) =>
      isString(data[key]) ? [`${key}=${data[key]}`] : [],
    ),
  ];
  const reason = clip(data.reason);
  return {
    source: "finding",
    outcomes: [standing],
    text: [
      `[finding] ${comparison} | task=${str(data.task) ?? "unknown"} | ${meta.join(" | ")}`,
      ...(reason === "" ? [] : [`  reason: ${reason}`]),
    ].join("\n"),
  };
}

function draftReview(data: JsonObject): Review {
  const verdict = str(data.verdict) ?? "unknown";
  const findings = (Array.isArray(data.findings) ? data.findings : []).flatMap((value) => {
    const one = asRecord(value);
    if (one === null) return [];
    const named = (["task", "check", "item"] as const).flatMap((key) =>
      isString(one[key]) ? [`${key}=${one[key]}`] : [],
    );
    return [`  - ${[str(one.kind) ?? "defect", ...named].join(" ")}: ${clip(one.reason)}`];
  });
  const summary = verdict === "skipped" ? "draft audit skipped" : clip(data.summary);
  const pass = isNumber(data.pass) ? ` pass=${String(data.pass)}` : "";
  return {
    source: "draft",
    outcomes: [verdict],
    text: [
      `[draft] ${str(data.session) ?? "draft"}${pass} | verdict=${verdict}`,
      ...(summary === "" ? [] : [`  summary: ${summary}`]),
      ...findings,
    ].join("\n"),
  };
}

function reviewsOf(events: readonly LogEvent[]): Review[] {
  const reported = new Set(lastReports(events, "all").map(({ session }) => session));
  const harnessOf = new Map(ranUnder(events).map(({ id, under }) => [id, under.harness]));
  const votes = votesOf(events);
  const comparisonOf = new Map(solvesIn(events).map(({ id, start }) => [id, str(start.comparison)]));
  const stands = standsOf(events);
  return eventsOf(events, [PAIR, FINDING, DRAFT])
    .flatMap(({ event: { kind, data } }): Review[] => {
      if (kind === DRAFT) return [draftReview(data)];
      if (kind === PAIR) {
        return reported.has(str(data.comparison) ?? "")
          ? [pairReview(data, mirrored(harnessOf, data) ? "mirror" : "cross", votes)]
          : [];
      }
      const solve = str(data.solve) ?? "";
      const comparison = comparisonOf.get(solve);
      if (comparison === undefined || isString(data.reusedFrom)) return [];
      if (comparison !== null && !reported.has(comparison)) return [];
      return [
        findingReview(data, comparison ?? "practice", stands.get(solve) ?? str(data.ruling) ?? "unruled"),
      ];
    })
    .toReversed();
}

export function reviewInventoryLine(events: readonly LogEvent[]): string | null {
  const reviews = reviewsOf(events);
  const count = (source: Source, outcome?: string) =>
    reviews.filter(
      (one) => one.source === source && (outcome === undefined || one.outcomes.includes(outcome)),
    ).length;
  const defects = count("finding", "check-defect");
  const chunks = (
    [
      [count("pair"), "pair", ""],
      [count("finding"), "finding", defects === 0 ? "" : ` (${String(defects)} check-defect)`],
      [count("draft"), "draft audit", ""],
    ] as const
  ).flatMap(([n, noun, tail]) => (n === 0 ? [] : [`${plural(n, noun)}${tail}`]));
  return chunks.length === 0
    ? null
    : `Reported reviews in read_reviews (newest first): ${chunks.join(", ")}.`;
}

export function reviewSummariesByTask(events: readonly LogEvent[]): Map<string, string> {
  const order = new Map(lastReports(events, "all").map(({ session }, at) => [session, at]));
  const harnessOf = new Map(ranUnder(events).map(({ id, under }) => [id, under.harness]));
  const latest = new Map<string, { readonly rank: number; readonly pairs: Map<string, JsonObject> }>();
  for (const {
    event: { data },
  } of eventsOf(events, PAIR)) {
    const [task, rank] = [str(data.task), order.get(str(data.comparison) ?? "")];
    if (task === null || rank === undefined || mirrored(harnessOf, data)) continue;
    const held = latest.get(task);
    if (held !== undefined && held.rank > rank) continue;
    const pairs = held?.rank === rank ? held.pairs : new Map<string, JsonObject>();
    const key = `${str(data.solve) ?? ""}\u0000${str(data.old) ?? ""}`;
    if (!pairs.has(key) || (isNumber(data.judge) && isNumber(data.holistic))) pairs.set(key, data);
    latest.set(task, { rank, pairs });
  }
  return new Map([...latest].map(([task, { pairs }]) => [task, pairClause([...pairs.values()])]));
}

function pairClause(pairs: readonly JsonObject[]): string {
  let [done, splits, votes, disagreed, faults, truncated] = [0, 0, 0, 0, 0, 0];
  const opposed = new Set<string>();
  for (const row of pairs) {
    const extracts = asRecord(row.extracts);
    faults += isNumber(extracts?.faults) ? extracts.faults : 0;
    truncated += isNumber(extracts?.truncated) ? extracts.truncated : 0;
    if (!isNumber(row.judge) || !isNumber(row.holistic)) continue;
    done += 1;
    if (row.judge !== 0 || row.holistic !== 0) splits += 1;
    const criteria = Object.entries(asRecord(row.criteria) ?? {});
    votes += criteria.length;
    disagreed += strings(row.disagreed).length;
    for (const [id, score] of criteria) {
      if (id !== HOLISTIC && relation(score, row.holistic) === "opposed") opposed.add(id);
    }
  }
  return [
    `reviews ${String(done)}/${String(pairs.length)} pairs${done > 0 && splits === 0 ? " (all tied)" : ""}`,
    ...(votes > 0 ? [`swap-disagreed ${String(disagreed)}/${String(votes)}`] : []),
    ...(opposed.size > 0 ? [`holistic opposed ${[...opposed].join(", ")}`] : []),
    ...(faults > 0 || truncated > 0 ? [`extracts ${String(faults)}f/${String(truncated)}t`] : []),
  ].join(", ");
}

export function readReviews(log: string, query: ReviewQuery = {}): string {
  const matched = reviewsOf(read(log, (kind) => kind !== "referee.call" && TRACE_KINDS.has(kind))).filter(
    (one) =>
      (query.source === undefined || one.source === query.source) &&
      (query.outcome === undefined || one.outcomes.includes(query.outcome)),
  );
  if (matched.length === 0) return "No reported review records match.";
  const cap = Math.min(Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const page = matched.slice(0, cap).map(({ text }) => text);
  return [
    `Showing the newest ${String(page.length)} of ${String(matched.length)} matching review records.`,
    ...page,
  ].join("\n\n");
}
