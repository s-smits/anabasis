import { type EventKind, eventsOf, type LogEvent } from "../kernel/log.ts";
import { lastReports } from "../kernel/reports.ts";
import { ranUnder, solvesIn, standsOf } from "../kernel/solves.ts";
import { boundText } from "../meta/bounded-text.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";

interface ReviewQuery {
  readonly query?: string | undefined;
  readonly task?: string | undefined;
  readonly source?: "pair" | "finding" | "draft" | undefined;
  readonly item?: string | undefined;
  readonly check?: string | undefined;
  readonly comparison?: string | undefined;
  readonly outcome?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

interface ProjectedReview {
  readonly source: "pair" | "finding" | "draft";
  readonly task: string;
  readonly comparison: string;
  readonly items: readonly string[];
  readonly checks: readonly string[];
  readonly outcomes: readonly string[];
  readonly text: string;
}

interface VoteCall {
  readonly better: string;
  readonly reason: string;
}

const [PAIR, FINDING, DRAFT] = ["referee.pair", "referee.finding", "referee.draft"] as const;

export const REVIEW_EVENT_KINDS: ReadonlySet<EventKind> = new Set([
  "comparison.reported",
  "condition.recorded",
  "draft.started",
  "exam.started",
  "referee.call",
  DRAFT,
  FINDING,
  PAIR,
  "solve.finished",
  "solve.started",
]);

const [DEFAULT_LIMIT, MAX_LIMIT, MAX_PAGE_BYTES, REASON_BYTES] = [10, 20, 8 * 1024, 600];
const HOLISTIC = "holistic";
const REUSE_PREFIX = /^reused\b/u;

const num = (value: unknown): number => (isNumber(value) ? value : 0);
const str = (value: unknown): string | null => (isString(value) ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);
const fmt = (value: number): string => String(Number(value.toPrecision(4)));
const clip = (value: unknown): string => boundText(str(value) ?? "", REASON_BYTES).shown;
const harnessMap = (events: readonly LogEvent[]) =>
  new Map(ranUnder(events).map(({ id, under }) => [id, under.harness]));

function reportedOrder(events: readonly LogEvent[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const { session } of lastReports(events, "all")) {
    order.set(session, order.size);
  }
  return order;
}

function pairKind(harnessOf: ReadonlyMap<string, string>, data: JsonObject): "cross" | "mirror" {
  const [solve, old] = [str(data.solve), str(data.old)];
  if (solve === null || old === null) return "cross";
  if (solve === old) return "mirror";
  const [left, right] = [harnessOf.get(solve), harnessOf.get(old)];
  return left !== undefined && left === right ? "mirror" : "cross";
}

function voteCallsOf(events: readonly LogEvent[]): Map<string, VoteCall> {
  const calls = new Map<string, VoteCall>();
  for (const {
    event: { data },
  } of eventsOf(events, "referee.call")) {
    if (data.tool !== "record_vote" || data.isError === true) continue;
    const [reader, args] = [str(data.reader), asRecord(data.args)];
    const [better, reason] = [str(args?.better), str(args?.reason)];
    if (reader !== null && better !== null && reason !== null) {
      calls.set(reader, { better, reason: boundText(reason, REASON_BYTES).shown });
    }
  }
  return calls;
}

function relation(score: number | null, holistic: number | null): "aligned" | "opposed" | "tie" | null {
  if (score === null || holistic === null) return null;
  if (score === 0 || holistic === 0) return "tie";
  return Math.sign(score) === Math.sign(holistic) ? "aligned" : "opposed";
}

function probeLine(raw: unknown): { readonly id: number | null; readonly text: string } | null {
  const row = asRecord(raw);
  if (row === null) return null;
  const [before, after, moved, id] = [
    str(asRecord(row.original)?.kind) ?? "?",
    str(asRecord(row.changed)?.kind) ?? "?",
    strings(row.moved),
    isNumber(row.id) ? row.id : null,
  ];
  return {
    id,
    text: `probe #${id === null ? "?" : String(id)}: ${before}->${after}${moved.length === 0 ? "" : ` moved=[${moved.join(", ")}]`}`,
  };
}

function extractSummary(raw: unknown): string {
  const ext = asRecord(raw);
  return ext === null
    ? ""
    : ` | extracts: ${String(num(ext.files))} files (${String(num(ext.empty))} empty, ${String(num(ext.faults))} faults, ${String(num(ext.truncated))} truncated)`;
}

function formatCriterion(given: {
  readonly item: string;
  readonly score: number | null;
  readonly swap: "swap-consistent" | "swap-disagreed";
  readonly vsHolistic: "aligned" | "opposed" | "tie" | null;
  readonly voteIds: readonly string[];
  readonly calls: ReadonlyMap<string, VoteCall>;
}): { readonly lines: string[]; readonly missing: boolean } {
  const { item, score, swap, vsHolistic, voteIds, calls } = given;
  let missing = false;
  const votes = voteIds.map((voteId, at) => {
    const vote = calls.get(voteId);
    if (vote === undefined) {
      missing = true;
      return `    pass ${String(at + 1)}: reason unavailable`;
    }
    return `    pass ${String(at + 1)}${at === 0 ? "" : " (swapped)"}: better=${vote.better}; ${vote.reason}`;
  });
  const gap = score === null ? "incomplete" : score === 0 ? "tie" : `gap=${fmt(Math.abs(score))}`;
  return {
    lines: [`  - ${item}: ${gap}, ${swap}${vsHolistic === null ? "" : `, holistic=${vsHolistic}`}`, ...votes],
    missing,
  };
}

function projectPair(
  data: JsonObject,
  comparison: string,
  kind: "cross" | "mirror",
  calls: ReadonlyMap<string, VoteCall>,
): ProjectedReview {
  const [task, judge, holistic] = [
    str(data.task) ?? "unknown",
    isNumber(data.judge) ? data.judge : null,
    isNumber(data.holistic) ? data.holistic : null,
  ];
  const complete = judge !== null && holistic !== null;
  const criteria = asRecord(data.criteria) ?? {};
  const disagreed = new Set(strings(data.disagreed));
  const byCriterion = new Map<string, string[]>();
  for (const voteId of strings(data.readers)) {
    const parts = voteId.split(":");
    const item = parts.length >= 3 ? parts.at(-2) : undefined;
    if (item !== undefined) byCriterion.set(item, [...(byCriterion.get(item) ?? []), voteId]);
  }
  const items = [...new Set([...Object.keys(criteria), ...byCriterion.keys()])];
  const [opposed, itemLines]: [string[], string[]] = [[], []];
  let missingReasons = false;
  for (const item of items) {
    const score = isNumber(criteria[item]) ? criteria[item] : null;
    const vsHolistic = item === HOLISTIC ? null : relation(score, holistic);
    if (vsHolistic === "opposed") opposed.push(item);
    const formatted = formatCriterion({
      item,
      score,
      swap: disagreed.has(item) ? "swap-disagreed" : "swap-consistent",
      vsHolistic,
      voteIds: byCriterion.get(item) ?? [],
      calls,
    });
    missingReasons ||= formatted.missing;
    itemLines.push(...formatted.lines);
  }
  const pairRel = relation(judge, holistic);
  const status = complete
    ? `judge-gap=${fmt(Math.abs(judge))} holistic-gap=${fmt(Math.abs(holistic))}${pairRel === null ? "" : ` (${pairRel})`}`
    : "incomplete";
  return {
    source: "pair",
    task,
    comparison,
    items,
    checks: [],
    outcomes: [
      complete ? "complete" : "incomplete",
      kind,
      ...(disagreed.size > 0 ? ["disagreed"] : []),
      ...(opposed.length > 0 ? ["holistic-oppose"] : []),
    ],
    text: [
      `[pair] ${comparison} | task=${task} | ${kind} | ${status}${extractSummary(data.extracts)}`,
      ...itemLines,
      ...(missingReasons ? ["  note: some vote reasons are unavailable in this log"] : []),
    ].join("\n"),
  };
}

function projectFinding(
  data: JsonObject,
  comparison: string,
  stands: ReadonlyMap<string, string | null>,
  reusedTimes: number,
): ProjectedReview {
  const [task, solve, check, rule, field] = [
    str(data.task) ?? "unknown",
    str(data.solve),
    str(data.check),
    str(data.rule),
    str(data.field),
  ];
  const ruling = str(data.ruling) ?? "unruled";
  const standing = (solve === null ? undefined : stands.get(solve)) ?? ruling;
  const reused = isString(data.reusedFrom);
  const rawReason = str(data.reason) ?? "";
  const reason =
    reused || REUSE_PREFIX.test(rawReason)
      ? `reused ${ruling}${check === null ? "" : ` on ${check}`} in ${comparison}`
      : boundText(rawReason, REASON_BYTES).shown;
  const probes = (Array.isArray(data.probeRows) ? data.probeRows : []).flatMap((row) => {
    const line = probeLine(row);
    return line === null ? [] : [`  ${line.text}`];
  });
  const meta = [
    `ruling=${ruling}`,
    ...(standing === ruling ? [] : [`standing=${standing}`]),
    ...[
      ["check", check],
      ["rule", rule],
      ["field", field],
    ].flatMap(([label, val]) => (val === null ? [] : [`${label}=${val}`])),
    `evidence=${reused ? "reused" : "replayed"}${reusedTimes > 0 ? ` (+${String(reusedTimes)} reused)` : ""}`,
  ].join(" | ");
  return {
    source: "finding",
    task,
    comparison,
    items: [],
    checks: check === null ? [] : [check],
    outcomes: [
      standing,
      ...(standing === ruling ? [] : [`originally-${ruling}`]),
      reused ? "reused" : "replayed",
    ],
    text: [
      `[finding] ${comparison} | task=${task} | ${meta}`,
      ...(reason === "" ? [] : [`  reason: ${reason}`]),
      ...probes,
    ].join("\n"),
  };
}

function projectDraft(data: JsonObject): ProjectedReview {
  const [session, verdict] = [str(data.session) ?? "draft", str(data.verdict) ?? "unknown"];
  const rawProbes = Array.isArray(data.probeRows) ? data.probeRows : [];
  const probeById = new Map(
    rawProbes.flatMap((raw) => {
      const parsed = probeLine(raw);
      return parsed !== null && parsed.id !== null ? [[parsed.id, parsed.text] as const] : [];
    }),
  );
  const [tasks, checks, items] = [new Set<string>(), new Set<string>(), new Set<string>()];
  const findings = (Array.isArray(data.findings) ? data.findings : []).flatMap((raw) => {
    const one = asRecord(raw);
    if (one === null) return [];
    const parts = [str(one.kind) ?? "defect"];
    for (const [label, value, bucket] of [
      ["task", str(one.task), tasks],
      ["check", str(one.check), checks],
      ["item", str(one.item), items],
    ] as const) {
      if (value === null) continue;
      bucket.add(value);
      parts.push(`${label}=${value}`);
    }
    const probe = isNumber(one.probe) ? probeById.get(one.probe) : undefined;
    return [`  - ${parts.join(" ")}: ${clip(one.reason)}${probe === undefined ? "" : ` (${probe})`}`];
  });
  const summary = verdict === "skipped" ? "draft audit skipped" : clip(data.summary);
  const head = `[draft] ${session}${isNumber(data.pass) ? ` pass=${String(data.pass)}` : ""} | verdict=${verdict}${rawProbes.length > 0 ? ` | probes=${String(rawProbes.length)}` : ""}`;
  return {
    source: "draft",
    task: [...tasks].join(","),
    comparison: session,
    items: [...items],
    checks: [...checks],
    outcomes: [verdict],
    text: [head, ...(summary === "" ? [] : [`  summary: ${summary}`]), ...findings].join("\n"),
  };
}

function findingContext(events: readonly LogEvent[], reported: ReadonlyMap<string, number>) {
  const solveComp = new Map<string, string | null>(
    solvesIn(events).map(({ id, start }) => [id, isString(start.comparison) ? start.comparison : null]),
  );
  const reuseCounts = new Map<string, number>();
  for (const {
    event: { data },
  } of eventsOf(events, FINDING)) {
    const [solve, from] = [str(data.solve), str(data.reusedFrom)];
    if (solve === null || from === null) continue;
    const comp = solveComp.get(solve);
    if (comp === undefined) continue;
    if (comp === null || reported.has(comp)) {
      reuseCounts.set(from, (reuseCounts.get(from) ?? 0) + 1);
    }
  }
  return { solveComp, stands: standsOf(events), reuseCounts, seenPrimary: new Set<string>() };
}

function projectReviews(events: readonly LogEvent[], source: ReviewQuery["source"]): ProjectedReview[] {
  const reported = reportedOrder(events);
  const pairs =
    source === undefined || source === "pair"
      ? { harnessOf: harnessMap(events), calls: voteCallsOf(events) }
      : null;
  const findings = source === undefined || source === "finding" ? findingContext(events, reported) : null;
  const kinds: EventKind[] = [
    ...(pairs === null ? [] : [PAIR]),
    ...(findings === null ? [] : [FINDING]),
    ...(source === undefined || source === "draft" ? [DRAFT] : []),
  ];
  return eventsOf(events, kinds)
    .flatMap(({ event: { kind, data } }): ProjectedReview[] => {
      if (kind === DRAFT) return [projectDraft(data)];
      if (kind === PAIR && pairs !== null) {
        const comparison = str(data.comparison);
        return comparison !== null && reported.has(comparison)
          ? [projectPair(data, comparison, pairKind(pairs.harnessOf, data), pairs.calls)]
          : [];
      }
      if (findings === null) return [];
      const [solve, from] = [str(data.solve), str(data.reusedFrom)];
      if (solve === null) return [];
      const comp = findings.solveComp.get(solve);
      if (comp === undefined) return [];
      if (comp !== null && !reported.has(comp)) return [];
      if (from !== null && findings.seenPrimary.has(from)) return [];
      if (from === null) findings.seenPrimary.add(solve);
      return [
        projectFinding(data, comp ?? "practice", findings.stands, findings.reuseCounts.get(solve) ?? 0),
      ];
    })
    .toReversed();
}

export function reviewInventoryLine(events: readonly LogEvent[]): string | null {
  const entries = projectReviews(events, undefined);
  if (entries.length === 0) return null;
  let [pairs, disagreed, opposed, findings, defects, earned, drafts] = [0, 0, 0, 0, 0, 0, 0];
  for (const entry of entries) {
    if (entry.source === "pair") {
      pairs += 1;
      if (entry.outcomes.includes("disagreed")) disagreed += 1;
      if (entry.outcomes.includes("holistic-oppose")) opposed += 1;
    } else if (entry.source === "finding") {
      findings += 1;
      if (entry.outcomes.includes("check-defect")) defects += 1;
      if (entry.outcomes.includes("earned")) earned += 1;
    } else {
      drafts += 1;
    }
  }
  const detail = (parts: readonly string[]) => (parts.length === 0 ? "" : ` (${parts.join(", ")})`);
  const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
  const chunks = [
    ...(pairs === 0
      ? []
      : [
          `${count(pairs, "pair", "pairs")}${detail([
            ...(disagreed === 0 ? [] : [`${String(disagreed)} swap-disagreed`]),
            ...(opposed === 0 ? [] : [`${String(opposed)} holistic-opposed`]),
          ])}`,
        ]),
    ...(findings === 0
      ? []
      : [
          `${count(findings, "finding", "findings")}${detail([
            ...(defects === 0 ? [] : [`${String(defects)} check-defect`]),
            ...(earned === 0 ? [] : [`${String(earned)} earned`]),
          ])}`,
        ]),
    ...(drafts === 0 ? [] : [count(drafts, "draft audit", "draft audits")]),
  ];
  return `Reported reviews in read_reviews (newest first): ${chunks.join(", ")}.`;
}

function matchesQuery(entry: ProjectedReview, filter: ReviewQuery, needle: string | null): boolean {
  if (filter.task !== undefined && !entry.task.split(",").includes(filter.task)) return false;
  if (filter.comparison !== undefined && entry.comparison !== filter.comparison) return false;
  if (filter.item !== undefined && !entry.items.includes(filter.item)) return false;
  if (filter.check !== undefined && !entry.checks.includes(filter.check)) return false;
  if (filter.outcome !== undefined && !entry.outcomes.includes(filter.outcome)) return false;
  return needle === null || entry.text.toLowerCase().includes(needle);
}

function summariseTaskPairs(rows: readonly JsonObject[]): string {
  const byPair = new Map<string, JsonObject>();
  for (const [at, row] of rows.entries()) {
    const key = isString(row.solve) && isString(row.old) ? `${row.solve}\u0000${row.old}` : String(at);
    const prev = byPair.get(key);
    if (prev === undefined || (isNumber(row.judge) && isNumber(row.holistic))) byPair.set(key, row);
  }
  const unique = [...byPair.values()];
  let [done, splits, votes, disagreed, faults, truncated] = [0, 0, 0, 0, 0, 0];
  const opposed = new Set<string>();
  for (const row of unique) {
    const ext = asRecord(row.extracts);
    if (ext !== null) {
      faults += num(ext.faults);
      truncated += num(ext.truncated);
    }
    const holistic = isNumber(row.holistic) ? row.holistic : null;
    if (!isNumber(row.judge) || holistic === null) continue;
    done += 1;
    if (row.judge !== 0 || holistic !== 0) splits += 1;
    const criteria = asRecord(row.criteria) ?? {};
    votes += Object.keys(criteria).length;
    disagreed += strings(row.disagreed).length;
    for (const [id, score] of Object.entries(criteria)) {
      if (id !== HOLISTIC && isNumber(score) && relation(score, holistic) === "opposed") opposed.add(id);
    }
  }
  return [
    `reviews ${String(done)}/${String(unique.length)} pairs${done > 0 && splits === 0 ? " (all tied)" : ""}`,
    ...(votes > 0 ? [`swap-disagreed ${String(disagreed)}/${String(votes)}`] : []),
    ...(opposed.size > 0 ? [`holistic opposed ${[...opposed].join(", ")}`] : []),
    ...(faults > 0 || truncated > 0 ? [`extracts ${String(faults)}f/${String(truncated)}t`] : []),
  ].join(", ");
}

export function reviewSummariesByTask(events: readonly LogEvent[]): Map<string, string> {
  const reported = reportedOrder(events);
  const harnessOf = harnessMap(events);
  const latestComp = new Map<string, { readonly comparison: string; readonly rank: number }>();
  const rowsByKey = new Map<string, JsonObject[]>();
  for (const {
    event: { data },
  } of eventsOf(events, PAIR)) {
    const [comparison, task] = [str(data.comparison), str(data.task)];
    const rank = comparison === null ? undefined : reported.get(comparison);
    if (comparison === null || task === null || rank === undefined) continue;
    if (pairKind(harnessOf, data) !== "cross") continue;
    const prior = latestComp.get(task);
    if (prior === undefined || rank > prior.rank) latestComp.set(task, { comparison, rank });
    const key = `${comparison}\u0000${task}`;
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), data]);
  }
  return new Map(
    [...latestComp].map(([task, { comparison }]) => [
      task,
      summariseTaskPairs(rowsByKey.get(`${comparison}\u0000${task}`) ?? []),
    ]),
  );
}

export function readReviews(events: readonly LogEvent[], query: ReviewQuery = {}): string {
  const needle = query.query === undefined || query.query.trim() === "" ? null : query.query.toLowerCase();
  const filterKey = hashJsonValue({
    query: needle,
    task: query.task ?? null,
    source: query.source ?? null,
    item: query.item ?? null,
    check: query.check ?? null,
    comparison: query.comparison ?? null,
    outcome: query.outcome ?? null,
  }).slice(0, 8);
  let offset = 0;
  if (query.cursor !== undefined && query.cursor.trim() !== "") {
    const [rawOffset, key, extra] = query.cursor.split(":");
    const parsed = Number(rawOffset);
    if (extra !== undefined || !Number.isInteger(parsed) || parsed < 0 || key !== filterKey) {
      return "Cursor does not match the active filters; call read_reviews without cursor to start from the first matching record.";
    }
    offset = parsed;
  }
  const matched = projectReviews(events, query.source).filter((entry) => matchesQuery(entry, query, needle));
  if (matched.length === 0) {
    const active = Object.entries(query)
      .filter(([key, value]) => key !== "cursor" && key !== "limit" && value !== undefined && value !== "")
      .map(([key, value]) => `${key}=${String(value)}`);
    return active.length === 0
      ? "No reported review records exist yet."
      : `No review records match (${active.join(", ")}).`;
  }
  const cap = Math.max(
    1,
    Math.min(isNumber(query.limit) ? Math.floor(query.limit) : DEFAULT_LIMIT, MAX_LIMIT),
  );
  const page: ProjectedReview[] = [];
  let bytes = 0;
  for (const entry of matched.slice(offset, offset + cap)) {
    const size = Buffer.byteLength(entry.text) + 2;
    if (page.length > 0 && bytes + size > MAX_PAGE_BYTES) break;
    page.push(entry);
    bytes += size;
  }
  const next = offset + page.length;
  const cursorNote = next < matched.length ? ` | next cursor: ${String(next)}:${filterKey}` : "";
  const header =
    page.length === 0
      ? `No further matching review records after offset ${String(offset)} of ${String(matched.length)}.`
      : `Showing ${String(offset + 1)}-${String(next)} of ${String(matched.length)} matching review records${cursorNote}`;
  return [header, ...page.map((entry) => entry.text)].join("\n\n");
}
