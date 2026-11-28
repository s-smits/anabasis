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

const num = (value: unknown): number => (isNumber(value) ? value : 0);
const str = (value: unknown): string | null => (isString(value) ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);
const fmt = (value: number): string => String(Number(Math.abs(value).toPrecision(4)));
const clip = (value: unknown): string => boundText(str(value) ?? "", REASON_BYTES).shown;
const named = (row: JsonObject, keys: readonly string[], join: string): string[] =>
  keys.flatMap((key) => (isString(row[key]) ? [`${key}${join}${row[key]}`] : []));

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
      if (data.tool !== "record_vote" || data.isError === true) return [];
      const [reader, args] = [str(data.reader), asRecord(data.args)];
      if (reader === null || args === null) return [];
      const [better, reason] = [str(args.better), str(args.reason)];
      if (better !== null && reason !== null) {
        return [[reader, `better=${better}; ${clip(reason)}`] as const];
      }
      return Object.entries(args).flatMap(([item, raw]) => {
        const entry = asRecord(raw);
        const [itemBetter, itemReason] = [str(entry?.better), str(entry?.reason)];
        return itemBetter === null || itemReason === null
          ? []
          : [[`${reader}:${item}`, `better=${itemBetter}; ${clip(itemReason)}`] as const];
      });
    }),
  );
}

function probeOf(raw: unknown): { readonly id: unknown; readonly text: string } | null {
  const row = asRecord(raw);
  if (row === null) return null;
  const moved = strings(row.moved);
  const [before, after] = [str(asRecord(row.original)?.kind) ?? "?", str(asRecord(row.changed)?.kind) ?? "?"];
  const id = isNumber(row.id) ? String(row.id) : "?";
  return {
    id: row.id,
    text: `probe #${id}: ${before}->${after}${moved.length === 0 ? "" : ` moved=[${moved.join(", ")}]`}`,
  };
}

function extractNote(data: JsonObject): string {
  const ext = asRecord(data.extracts);
  if (ext === null) return "";
  const [files, empty, faults, truncated] = [ext.files, ext.empty, ext.faults, ext.truncated].map(num);
  return ` | extracts: ${String(files)} files (${String(empty)} empty, ${String(faults)} faults, ${String(truncated)} truncated)`;
}

function pairReview(data: JsonObject, kind: "mirror" | "cross", votes: ReadonlyMap<string, string>): Review {
  const [judge, holistic] = [data.judge, data.holistic];
  const complete = isNumber(judge) && isNumber(holistic);
  const criteria = asRecord(data.criteria) ?? {};
  const disagreed = new Set(strings(data.disagreed));
  const allReaders = strings(data.readers);
  const sharedReaders = allReaders.filter((id) => id.split(":").length < 3);
  const readers = Map.groupBy(
    allReaders.filter((id) => id.split(":").length >= 3),
    (id) => id.split(":").at(-2) ?? "",
  );
  const opposed: string[] = [];
  let missing = false;
  const lines = [...new Set([...Object.keys(criteria), ...readers.keys()])].flatMap((item) => {
    const score = criteria[item];
    const vs = item === HOLISTIC ? null : relation(score, holistic);
    if (vs === "opposed") opposed.push(item);
    const gap = score === 0 ? "tie" : isNumber(score) ? `gap=${fmt(score)}` : "incomplete";
    const swap = disagreed.has(item) ? "swap-disagreed" : "swap-consistent";
    const voteIds = readers.get(item) ?? sharedReaders.map((reader) => `${reader}:${item}`);
    const passes = voteIds.map((id, at) => {
      const vote = votes.get(id);
      missing ||= vote === undefined;
      const pass = `    pass ${String(at + 1)}`;
      return vote === undefined
        ? `${pass}: reason unavailable`
        : `${pass}${at === 0 ? "" : " (swapped)"}: ${vote}`;
    });
    return [`  - ${item}: ${gap}, ${swap}${vs === null ? "" : `, holistic=${vs}`}`, ...passes];
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
      `[pair] ${str(data.comparison) ?? "unknown"} | task=${str(data.task) ?? "unknown"} | ${kind} | ${status}${extractNote(data)}`,
      ...lines,
      ...(missing ? ["  note: some vote reasons are unavailable in this log"] : []),
    ].join("\n"),
  };
}

function findingReview(data: JsonObject, comparison: string, standing: string, reusedBy: number): Review {
  const ruling = str(data.ruling) ?? "unruled";
  const reused = isString(data.reusedFrom);
  const evidence = `${reused ? "reused" : "replayed"}${reusedBy > 0 ? ` (+${String(reusedBy)} reused)` : ""}`;
  const meta = [
    `ruling=${ruling}`,
    ...(standing === ruling ? [] : [`standing=${standing}`]),
    ...named(data, ["check", "rule", "field"], "="),
    `evidence=${evidence}`,
  ];
  const reason =
    reused || /^reused\b/u.test(str(data.reason) ?? "")
      ? `reused ${ruling}${isString(data.check) ? ` on ${data.check}` : ""} in ${comparison}`
      : clip(data.reason);
  const probes = (Array.isArray(data.probeRows) ? data.probeRows : []).flatMap((row) => {
    const probe = probeOf(row);
    return probe === null ? [] : [`  ${probe.text}`];
  });
  return {
    source: "finding",
    outcomes: [
      standing,
      ...(standing === ruling ? [] : [`originally-${ruling}`]),
      reused ? "reused" : "replayed",
    ],
    text: [
      `[finding] ${comparison} | task=${str(data.task) ?? "unknown"} | ${meta.join(" | ")}`,
      ...(reason === "" ? [] : [`  reason: ${reason}`]),
      ...probes,
    ].join("\n"),
  };
}

function draftReview(data: JsonObject): Review {
  const verdict = str(data.verdict) ?? "unknown";
  const rows = Array.isArray(data.probeRows) ? data.probeRows : [];
  const probes = new Map(
    rows.flatMap((row) => {
      const probe = probeOf(row);
      return probe === null || !isNumber(probe.id) ? [] : [[probe.id, probe.text] as const];
    }),
  );
  const findings = (Array.isArray(data.findings) ? data.findings : []).flatMap((value) => {
    const one = asRecord(value);
    if (one === null) return [];
    const probe = isNumber(one.probe) ? probes.get(one.probe) : undefined;
    const head = [str(one.kind) ?? "defect", ...named(one, ["task", "check", "item"], "=")].join(" ");
    return [`  - ${head}: ${clip(one.reason)}${probe === undefined ? "" : ` (${probe})`}`];
  });
  const summary = verdict === "skipped" ? "draft audit skipped" : clip(data.summary);
  const pass = isNumber(data.pass) ? ` pass=${String(data.pass)}` : "";
  const probed = rows.length > 0 ? ` | probes=${String(rows.length)}` : "";
  return {
    source: "draft",
    outcomes: [verdict],
    text: [
      `[draft] ${str(data.session) ?? "draft"}${pass} | verdict=${verdict}${probed}`,
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
  const findings = eventsOf(events, FINDING).flatMap(({ event: { data } }) => {
    const comparison = comparisonOf.get(str(data.solve) ?? "");
    return comparison === undefined || (comparison !== null && !reported.has(comparison)) ? [] : [data];
  });
  const reuses = Map.groupBy(
    findings.filter((data) => isString(data.reusedFrom)),
    (data) => str(data.reusedFrom),
  );
  const [primaries, shown] = [new Set<string>(), new Set<JsonObject>()];
  for (const data of findings) {
    const from = str(data.reusedFrom);
    if (from === null) primaries.add(str(data.solve) ?? "");
    if (from === null || !primaries.has(from)) shown.add(data);
  }
  return eventsOf(events, [PAIR, FINDING, DRAFT])
    .flatMap(({ event: { kind, data } }): Review[] => {
      if (kind === DRAFT) return [draftReview(data)];
      if (kind === PAIR) {
        return reported.has(str(data.comparison) ?? "")
          ? [pairReview(data, mirrored(harnessOf, data) ? "mirror" : "cross", votes)]
          : [];
      }
      if (!shown.has(data)) return [];
      const solve = str(data.solve) ?? "";
      const standing = stands.get(solve) ?? str(data.ruling) ?? "unruled";
      const comparison = comparisonOf.get(solve) ?? "practice";
      return [findingReview(data, comparison, standing, reuses.get(solve)?.length ?? 0)];
    })
    .toReversed();
}

const INVENTORY = [
  [
    "pair",
    "pair",
    [
      ["disagreed", "swap-disagreed"],
      ["holistic-oppose", "holistic-opposed"],
    ],
  ],
  [
    "finding",
    "finding",
    [
      ["check-defect", "check-defect"],
      ["solver-fail", "solver-fail"],
    ],
  ],
  ["draft", "draft audit", []],
] as const;

export function reviewInventoryLine(events: readonly LogEvent[]): string | null {
  const reviews = reviewsOf(events);
  const chunks = INVENTORY.flatMap(([source, noun, flags]) => {
    const mine = reviews.filter((one) => one.source === source);
    const detail = flags.flatMap(([outcome, label]) => {
      const n = mine.filter((one) => one.outcomes.includes(outcome)).length;
      return n === 0 ? [] : [`${String(n)} ${label}`];
    });
    if (mine.length === 0) return [];
    return [`${plural(mine.length, noun)}${detail.length === 0 ? "" : ` (${detail.join(", ")})`}`];
  });
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
    faults += num(extracts?.faults);
    truncated += num(extracts?.truncated);
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
  const filters = (["source", "outcome"] as const).flatMap((key) =>
    query[key] === undefined || query[key] === "" ? [] : [`${key}=${query[key]}`],
  );
  const matched = reviewsOf(read(log, (kind) => kind !== "referee.call" && TRACE_KINDS.has(kind))).filter(
    (one) =>
      (query.source === undefined || one.source === query.source) &&
      (query.outcome === undefined || query.outcome === "" || one.outcomes.includes(query.outcome)),
  );
  if (matched.length === 0) {
    return filters.length === 0
      ? "No reported review records exist yet."
      : `No review records match (${filters.join(", ")}).`;
  }
  const cap = Math.min(Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const page = matched.slice(0, cap).map(({ text }) => text);
  return [
    `Showing 1-${String(page.length)} of ${String(matched.length)} matching review records`,
    ...page,
  ].join("\n\n");
}
