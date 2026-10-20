/**
 * How long each promotion took and what it billed, from the log's own clock (`at`) and its `billed`
 * fields: an epoch runs from the opening, or the promotion before, to the promotion that ends it.
 * Its hours are split into the Examiner's sessions (`exam.started` or `draft.started` to their
 * end), the comparisons (`comparison.started` to the first `comparison.reported`) and the Builder's
 * own time, its sessions less the other two, since a campaign its Builder leads runs both inside
 * the Builder's span; the rest is the host's, waiting or between moves. The dollars are the tree's
 * own sum over the epoch (`billedBetween`), split by who billed each event: a solve by the session
 * or comparison its start names. A Builder session open across a promotion bills where it ends.
 *
 * Written on 19 October, when a promotion in buffer-fresh-opus-forkedPR223_v0_5_4-r2 and -r3 was
 * seen to take six to seven hours and no reader said where they went.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import type { Tree } from "./tree.ts";

interface Span {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

type Part = "examiner" | "comparison" | "builder";

const HOUR_MS = 3_600_000;
const STARTS = new Map<string, Part>([
  ["exam.started", "examiner"],
  ["draft.started", "examiner"],
  ["comparison.started", "comparison"],
  ["build.started", "builder"],
]);
const ENDS = new Map<string, Part>([
  ["exam.finished", "examiner"],
  ["draft.finished", "examiner"],
  ["comparison.reported", "comparison"],
  ["build.finished", "builder"],
]);

const hours = (ms: number) => (ms / HOUR_MS).toFixed(1);
const dollars = (value: number) => `$${value.toFixed(2)}`;

/** Each part's spans over the whole log, a session's first start to its first end; one with no
 *  end runs to the log's last event. */
function spansOf(events: readonly LogEvent[]): Record<Part, Span[]> {
  const open = new Map<string, number>();
  const spans: Record<Part, Span[]> = { examiner: [], comparison: [], builder: [] };
  const close = (part: Part, id: string, to: number) => {
    const from = open.get(`${part}:${id}`);
    if (from === undefined) return;
    open.delete(`${part}:${id}`);
    spans[part].push({ id, from, to });
  };
  for (const { at, kind, data } of events) {
    const started = STARTS.get(kind);
    const ended = ENDS.get(kind);
    if (!isString(data.session)) continue;
    const key = `${started ?? ended ?? ""}:${data.session}`;
    if (started !== undefined && !spans[started].some(({ id }) => id === data.session) && !open.has(key)) {
      open.set(key, Date.parse(at));
    }
    if (ended !== undefined) close(ended, data.session, Date.parse(at));
  }
  const end = Date.parse(events.at(-1)?.at ?? "");
  for (const key of open.keys()) {
    const [part, id = ""] = key.split(":");
    if (part === "examiner" || part === "comparison" || part === "builder") close(part, id, end);
  }
  return spans;
}

/** Spans cut to `[from, to]`, the empty ones dropped. */
function clipped(spans: readonly Span[], from: number, to: number): Span[] {
  return spans.flatMap((span) => {
    const [start, end] = [Math.max(span.from, from), Math.min(span.to, to)];
    return end > start ? [{ id: span.id, from: start, to: end }] : [];
  });
}

/** The time the union of `spans` covers. */
function covered(spans: readonly Span[]): number {
  let [total, reach] = [0, Number.NEGATIVE_INFINITY];
  for (const { from, to } of spans.toSorted((a, b) => a.from - b.from)) {
    const start = Math.max(from, reach);
    if (to > start) total += to - start;
    reach = Math.max(reach, to);
  }
  return total;
}

/** The dollars each part billed between two events, and the tree's own sum over them. */
function billedOf(tree: Tree, events: readonly LogEvent[], from: number, to: number) {
  const owners = new Map<string, string>();
  const ids = new Map<string, Part>();
  for (const { kind, data } of events) {
    const part = STARTS.get(kind);
    if (part !== undefined && isString(data.session)) ids.set(data.session, part);
    if (kind === "solve.started" && isString(data.solve) && isString(data.comparison)) {
      owners.set(data.solve, data.comparison);
    }
  }
  const parts: Record<Part, number> = { examiner: 0, comparison: 0, builder: 0 };
  for (const { kind, data } of events.slice(from, to)) {
    if (!tree.billed.has(kind) || !isNumber(data.billed)) continue;
    const owner = isString(data.solve) ? owners.get(data.solve) : undefined;
    const ended = ENDS.get(kind);
    const part = ended ?? (owner === undefined ? "builder" : (ids.get(owner) ?? "builder"));
    parts[part] += data.billed;
  }
  return { parts, total: tree.billedBetween(events, from, to) };
}

/** One epoch's lines: hours and dollars, each part with its sessions. */
function epochBlock(
  tree: Tree,
  events: readonly LogEvent[],
  bounds: readonly [number, number],
  title: string,
) {
  const [from, to] = bounds;
  const [start, end] = [Date.parse(events[from]?.at ?? ""), Date.parse(events[to]?.at ?? "")];
  const all = spansOf(events);
  const cut = (part: Part) => clipped(all[part], start, end);
  const [examiner, comparison, builder] = [cut("examiner"), cut("comparison"), cut("builder")];
  const { parts, total } = billedOf(tree, events, from, to + 1);
  const each = (spans: readonly Span[]) =>
    spans.length === 0
      ? ""
      : ` (${spans.map(({ id, from: a, to: b }) => `${id} ${hours(b - a)}`).join(", ")})`;
  const others = covered([...examiner, ...comparison]);
  const lines = [
    `  ${title}: ${hours(end - start)} h, ${dollars(total)} billed`,
    `    Examiner ${String(examiner.length)} sessions, ${hours(covered(examiner))} h${each(examiner)}, ${dollars(parts.examiner)}`,
    `    comparisons ${String(comparison.length)}, ${hours(covered(comparison))} h${each(comparison)}, ${dollars(parts.comparison)}`,
    `    Builder alone ${hours(covered([...examiner, ...comparison, ...builder]) - others)} h, ${dollars(parts.builder)}; neither ${hours(end - start - covered([...examiner, ...comparison, ...builder]))} h; the tree's sum less the parts ${dollars(total - parts.examiner - parts.comparison - parts.builder)}`,
  ];
  return { lines, hours: (end - start) / HOUR_MS, dollars: total };
}

/** Each epoch that ended in a promotion, and the one open since the last. */
export function epochLines(tree: Tree, events: readonly LogEvent[], promotions: readonly number[]) {
  const starts = [0, ...promotions];
  const promoted = promotions.map((to, nth) =>
    epochBlock(tree, events, [starts[nth] ?? 0, to], `epoch ${String(nth + 1)} to its promotion`),
  );
  const last = starts.at(-1) ?? 0;
  const open =
    last < events.length - 1
      ? [
          epochBlock(
            tree,
            events,
            [last, events.length - 1],
            promotions.length === 0 ? "since the opening" : "since the last promotion",
          ),
        ]
      : [];
  return {
    lines: [...promoted, ...open].flatMap(({ lines }) => lines),
    promoted: promoted.map(({ hours: h, dollars: d }) => ({ hours: h, dollars: d })),
  };
}
