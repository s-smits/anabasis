/**
 * How long each promotion took and what it billed, from the log's own clock and `billed` fields: an
 * epoch runs from the opening, or the promotion before, to the promotion that ends it. Hours are
 * split by `spansOf` (`tools/wri/time.ts`) into the Examiner's sessions, the comparisons and the
 * Builder's own time (its sessions less the other two), the rest being the host's. Dollars are the
 * tree's sum over the epoch (`billedBetween`), split by who billed each event: a solve by the
 * session or comparison its start names.
 */
import { eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dollars } from "#tools/runs/summary.ts";
import { spansOf, unionMs } from "#tools/wri/time.ts";
import type { Tree } from "./tree.ts";

type Span = ReturnType<typeof spansOf>[number];

interface EpochContext {
  readonly tree: Tree;
  readonly events: readonly LogEvent[];
  readonly all: readonly Span[];
  readonly ids: ReadonlyMap<string, Span["part"]>;
  readonly owners: ReadonlyMap<string, string>;
}

const hours = (ms: number) => (ms / HOUR_MS).toFixed(1);

function contextOf(tree: Tree, events: readonly LogEvent[]): EpochContext {
  const all = spansOf(events);
  const ids = new Map(all.map(({ id, part }) => [id, part]));
  const owners = new Map<string, string>();
  for (const { event } of eventsOf(events, "solve.started")) {
    const { solve, comparison } = event.data;
    if (isString(solve) && isString(comparison)) owners.set(solve, comparison);
  }
  return { tree, events, all, ids, owners };
}

/**
 * Each part is billed through the tree's own fold over its events alone, so an open session or
 * solve counts what its turns metered (`unfinished`), as the total does; the ending records alone
 * would read an Examiner session open at the log's end as $0.00.
 */
function billedOf({ tree, events, ids, owners }: EpochContext, from: number, to: number) {
  const partOf = ({ data }: LogEvent) => {
    const owner = isString(data.solve)
      ? owners.get(data.solve)
      : isString(data.session)
        ? data.session
        : undefined;
    return (owner === undefined ? undefined : ids.get(owner)) ?? "builder";
  };
  const upto = events.slice(0, to);
  const billed = (part: string) => {
    const own = upto.filter((event) => partOf(event) === part);
    return tree.billedBetween(
      own,
      upto.slice(0, from).filter((event) => partOf(event) === part).length,
      own.length,
    );
  };
  const parts = {
    examiner: billed("examiner"),
    comparisons: billed("comparisons"),
    builder: billed("builder"),
  };
  return { parts, total: tree.billedBetween(events, from, to) };
}

function epochBlock(ctx: EpochContext, bounds: readonly [number, number], title: string) {
  const { events, all } = ctx;
  const [from, to] = bounds;
  const [start, end] = [Date.parse(events[from]?.at ?? ""), Date.parse(events[to]?.at ?? "")];
  const cut = (part: string) =>
    all.flatMap(({ part: own, id, from: a, until: b }) =>
      own === part && Math.min(b, end) > Math.max(a, start)
        ? [{ id, from: Math.max(a, start), until: Math.min(b, end) }]
        : [],
    );
  const [examiner, comparisons, builder] = [cut("examiner"), cut("comparisons"), cut("builder")];
  const { parts, total } = billedOf(ctx, from, to + 1);
  const each = (spans: typeof examiner) =>
    spans.length === 0
      ? ""
      : ` (${spans.map(({ id, from: a, until: b }) => `${id} ${hours(b - a)}`).join(", ")})`;
  const others = unionMs([...examiner, ...comparisons]);
  const every = unionMs([...examiner, ...comparisons, ...builder]);
  const lines = [
    `  ${title}: ${hours(end - start)} h, ${dollars(total)} billed`,
    `    Examiner ${String(examiner.length)} sessions, ${hours(unionMs(examiner))} h${each(examiner)}, ${dollars(parts.examiner)}`,
    `    comparisons ${String(comparisons.length)}, ${hours(unionMs(comparisons))} h${each(comparisons)}, ${dollars(parts.comparisons)}`,
    `    Builder alone ${hours(every - others)} h, ${dollars(parts.builder)}; neither ${hours(end - start - every)} h`,
  ];
  return { lines, hours: (end - start) / HOUR_MS, dollars: total };
}

export function epochLines(tree: Tree, events: readonly LogEvent[], promotions: readonly number[]) {
  const ctx = contextOf(tree, events);
  const starts = [0, ...promotions];
  const promoted = promotions.map((to, nth) =>
    epochBlock(ctx, [starts[nth] ?? 0, to], `epoch ${String(nth + 1)} to its promotion`),
  );
  const last = starts.at(-1) ?? 0;
  const open =
    last < events.length - 1
      ? [
          epochBlock(
            ctx,
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
