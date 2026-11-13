/**
 * How long each promotion took and what it billed, from the log's own clock (`at`) and its `billed`
 * fields: an epoch runs from the opening, or the promotion before, to the promotion that ends it.
 * Its hours are split, by the spans `spansOf` (`tools/wri/time.ts`) reads, into the Examiner's
 * sessions, the comparisons and the Builder's own time, its sessions less the other two, since a campaign its Builder leads runs both inside
 * the Builder's span; the rest is the host's, waiting or between moves. The dollars are the tree's
 * own sum over the epoch (`billedBetween`), split by who billed each event: a solve by the session
 * or comparison its start names. A session open across a promotion bills each epoch what its turns
 * metered there.
 *
 * Written on 19 October, when a promotion in buffer-fresh-opus-forkedPR223_v0_5_4-r2 and -r3 was
 * seen to take six to seven hours and no reader said where they went.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dollars } from "#tools/runs/said.ts";
import { spansOf, unionMs } from "#tools/wri/time.ts";
import type { Tree } from "./tree.ts";

const hours = (ms: number) => (ms / HOUR_MS).toFixed(1);

/**
 * The dollars each part billed between two events, and the tree's own sum over them. Each part is
 * billed through the tree's own fold over its events alone, so an open session or solve counts
 * what its turns metered (`unfinished`), as the total does. Until 1 November the parts summed the
 * ending records alone, and an Examiner session open at the log's end read $0.00 where the view
 * read $4.53 (buffer-fresh-opus-gate-supply-r2, x-2).
 */
function billedOf(tree: Tree, events: readonly LogEvent[], from: number, to: number) {
  const owners = new Map<string, string>();
  const ids = new Map(spansOf(events).map(({ id, part }) => [id, part]));
  for (const { kind, data } of events) {
    if (kind === "solve.started" && isString(data.solve) && isString(data.comparison)) {
      owners.set(data.solve, data.comparison);
    }
  }
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
  const cut = (part: string) =>
    all.flatMap(({ part: own, id, from: a, until: b }) =>
      own === part && Math.min(b, end) > Math.max(a, start)
        ? [{ id, from: Math.max(a, start), until: Math.min(b, end) }]
        : [],
    );
  const [examiner, comparisons, builder] = [cut("examiner"), cut("comparisons"), cut("builder")];
  const { parts, total } = billedOf(tree, events, from, to + 1);
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
