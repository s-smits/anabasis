/**
 * The lanes of a whole-run investigation that read the clock: the solver's walls, limits and load
 * (lane 26), and where the campaign's hours, dollars and silences went (lane 28).
 *
 * Split from `read.ts` on 10 October, when that file stood at 794 nonblank lines against the size
 * policy's ceiling of 800 (`tools/loc/source-policy.ts`) and these lanes had three readings to add.
 * Each of the three answers what the first real campaigns of that day, buffer and recode, showed
 * missing:
 *
 * - a miss is read at every limit the kernel calls one (`AT_A_LIMIT`), by comparison and by side,
 *   where it was read at the wall alone; recode's 41 of 58 scored misses that ended on turns read
 *   none;
 * - a silence is read against the campaign's own median solve and labelled by what ran through
 *   it, where it was read at twenty minutes and only the first was given, by its time; buffer's
 *   longest gap was 19.5 minutes and read nothing;
 * - the hours are read by role beside the billed dollars, where only the dollars were.
 */
import { AT_A_LIMIT } from "#src/kernel/reports.ts";
import { asRecord, isNumber, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import {
  fired,
  type Index,
  measured,
  percent,
  type Solve,
  share,
  spendOf,
  tally,
  text,
  type Trigger,
} from "./folds.ts";

/** The share of a wall past which a miss is read as bound by it, as v1's climb read it. */
const WALL_BOUND_SHARE = 0.95;
/** The factor between the loads two comparisons ran under from which they are read as made on
 *  different hosts, and the load under which no factor is worth a line: a load of four moves no
 *  wall on a host of four cores or more. On 2026-10-09 one harness answered the same tasks in a
 *  median of 105 s under a load of 31 and of 40 s under a load of 6. */
const LOAD_MOVED = 2;
const LOAD_WORTH_A_LINE = 4;
/** A silence is a gap between two events longer than this many of the campaign's median finished
 *  solve, and never shorter than the floor. A gap that long is no solve's ordinary pace. The floor
 *  holds a pack of quick solves to gaps a person would ask about: on 10 October buffer had 34 gaps
 *  over a minute and 10 over five, recode 173 and 30, nearly all a Builder's or a solver's command
 *  (recode ran 50 over five minutes), and 6 and 12 over ten. */
const SILENCE_SOLVES = 5;
const SILENCE_FLOOR_SECONDS = 600;
const SILENCES_NAMED = 5;
/** Events written within this many milliseconds of a gap's end are the one move that ended it: an
 *  Examiner's turn is logged a few milliseconds after the task it proposed. */
const BURST_MS = 1_000;
/** The role whose turns and calls an event kind's prefix holds. A draft is an Examiner's. */
const ROLE_OF = new Map([
  ["solve", "solver"],
  ["build", "builder"],
  ["exam", "examiner"],
  ["draft", "examiner"],
]);
/** Where each part of the campaign's hours starts and ends. A part a stop cut ends at the
 *  campaign's ending, or at the log's last event. */
const SPANS = [
  ["builder", "build.started", "build.finished"],
  ["examiner", "exam.started", "exam.finished"],
  ["examiner", "draft.started", "draft.finished"],
  ["comparisons", "comparison.started", "comparison.reported"],
] as const;
const BETWEEN_MOVES = "between moves";
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

interface Span {
  readonly part: string;
  readonly from: number;
  readonly until: number;
}

/** Whether a miss ended at a limit of its own: the kernel's kinds, a call in the last turn its bound
 *  allowed, as 5 of buffer's 17 on 12 October, or past the share of its wall read as bound by it. */
const atALimit = (solve: Solve) =>
  AT_A_LIMIT.has(solve.kind) ||
  solve.limit !== null ||
  (solve.wallSeconds > 0 && solve.seconds > solve.wallSeconds * WALL_BOUND_SHARE);
const limitOf = (solve: Solve) => (AT_A_LIMIT.has(solve.kind) ? solve.kind : solve.limit) ?? "wall share";

/** The misses at a limit by comparison and side: recode on 10 October ended 41 of its 58 scored
 *  misses on turns, and a read of the wall alone saw none. A miss at a limit says the budget was
 *  short and nothing of the task, so a side whose misses are all there was cut and not beaten. */
function limitTriggers(log: Index): Trigger[] {
  const misses = (solves: readonly Solve[]) => solves.filter((solve) => solve.outcome === "fail");
  const detail = (missed: readonly Solve[]) => {
    const at = missed.filter(atALimit);
    const told = [...new Set(at.flatMap((solve) => (solve.modelTurns === null ? [] : [solve.modelTurns])))];
    const bound = told.length === 0 ? "" : `; turns ${told.toSorted((a, b) => a - b).join(", ")}`;
    return { at: at.length, of: `(${tally(countBy(at, limitOf))}${bound})` };
  };
  const compared = log.compared.flatMap(({ session, own, scoring }) => {
    const missed = misses(scoring);
    const side = (harness: JsonValue | undefined) => {
      const mine = missed.filter((solve) => solve.harness === harness);
      return share(mine.filter(atALimit).length, mine.length);
    };
    const { at, of } = detail(missed);
    return at === 0
      ? []
      : [
          fired(
            "MISSES AT A LIMIT",
            `${session}: ${side(own.old)} reference misses and ${side(own.fresh)} new at a limit ${of}`,
          ),
        ];
  });
  const scored = new Set(log.compared.flatMap(({ scoring }) => scoring.map((solve) => solve.id)));
  const outside = misses(log.solves.filter((solve) => !scored.has(solve.id)));
  const { at, of } = detail(outside);
  return [
    ...compared,
    ...(at > 0
      ? [
          fired(
            "MISSES AT A LIMIT",
            `outside a comparison: ${share(at, outside.length)} misses at a limit ${of}`,
          ),
        ]
      : []),
  ];
}

/** Lane 26: the misses at a limit, and over the solves each comparison measured, not the non-results
 *  it reran, the share of the wall each harness used and the host's load when they started. */
export function wallTriggers(log: Index): Trigger[] {
  const results = log.compared.map((each) => ({ ...each, scoring: each.scoring.filter(measured) }));
  const wallShares = results.flatMap(({ session, own, scoring }) => {
    // The median share of its wall a harness's solves used, or null for none under a wall. v1 read
    // this share as the measure that moves on every battery and leads a fail (lane 26).
    const under = (harness: JsonValue | undefined) =>
      median(
        scoring.flatMap((solve) =>
          solve.harness === harness && solve.wallSeconds > 0 ? [solve.seconds / solve.wallSeconds] : [],
        ),
      );
    const [before, after] = [under(own.old), under(own.fresh)];
    return before === null || after === null || own.old === own.fresh
      ? []
      : [
          fired(
            "WALL SHARE",
            `${session}: median ${percent(before)} under the reference harness, ${percent(after)} under the new`,
          ),
        ];
  });
  // The one-minute load each comparison's solves started under. A wall counts the clock, so the
  // same wall holds less work on a loaded host: a comparison made there reaches walls an idle host
  // would not, and solves under different loads were not made under one budget, whatever their
  // settings say. Each comparison's halves, by start, are read apart: esp32's one comparison started
  // its solves at loads from 5.8 to 56.0 on 12 October, where a reading across comparisons was silent.
  const loads = results.flatMap(({ session, scoring }) => {
    const at = scoring.flatMap((solve) => (solve.load === null ? [] : [solve.load]));
    const middle = median(at);
    const halves = [at.slice(0, at.length / 2), at.slice(at.length / 2)].flatMap(
      (half) => median(half) ?? [],
    );
    const cores = scoring.findLast((solve) => solve.cores !== null)?.cores ?? null;
    return middle === null ? [] : [{ session, middle, most: Math.max(...at), cores, halves }];
  });
  const loaded = loads.flatMap(({ session, middle, most, cores }) =>
    cores !== null && middle > cores
      ? [
          fired(
            "HOST LOADED",
            `${session}: load ${middle.toFixed(1)} at the median and ${most.toFixed(1)} at most when its solves started, on ${plural(cores, "core")}`,
          ),
        ]
      : [],
  );
  const middles = loads.flatMap(({ halves }) => halves);
  const [calmest, busiest] = [Math.min(...middles), Math.max(...middles)];
  const moved = busiest >= LOAD_WORTH_A_LINE && busiest >= calmest * LOAD_MOVED;
  return [
    ...limitTriggers(log),
    ...wallShares,
    ...loaded,
    ...(moved
      ? [
          fired(
            "LOAD MOVED",
            `median load when each comparison's solves started, its first half then its second: ${loads.map(({ session, halves }) => `${session} ${halves.map((half) => half.toFixed(1)).join(" then ")}`).join("; ")}`,
          ),
        ]
      : []),
  ];
}

/** The parts of the campaign's clock: each Builder and Examiner session and each comparison, from
 *  its start to its end. One a stop cut ends at the campaign's ending, which a stop writes. A
 *  comparison so cut goes on under its id with no second start, so it opens again where the campaign
 *  resumes: buffer's g-1 ran 13.3 minutes so on 12 October that had read as between moves. */
function spansOf(log: Index): Span[] {
  const spans: Span[] = [];
  const open = new Map<string, { part: string; from: number }>();
  const close = (key: string, until: number) => {
    const started = open.get(key);
    if (started !== undefined) spans.push({ ...started, until });
    open.delete(key);
  };
  let cut: [string, { part: string; from: number }][] = [];
  for (const { at, kind, data } of log.events) {
    const time = Date.parse(at);
    for (const [key, { part }] of cut.splice(0)) open.set(key, { part, from: time });
    for (const [part, start, end] of SPANS) {
      const key = `${start}:${text(data.session)}`;
      if (kind === start && !open.has(key)) open.set(key, { part, from: time });
      if (kind === end) close(key, time);
    }
    if (kind === "campaign.ended") cut = [...open].filter(([, span]) => span.part === "comparisons");
    if (kind === "campaign.ended") for (const key of open.keys()) close(key, time);
  }
  const last = Date.parse(log.events.at(-1)?.at ?? "");
  for (const key of open.keys()) close(key, last);
  return spans;
}

/** Row A's hours by role, beside its billed dollars: v2 counted the dollars by role and no time.
 *  What no session or comparison holds is between moves: the campaign's own decisions, and a stop
 *  before a resume. */
export function hoursLine(log: Index): string {
  const spans = spansOf(log);
  const [first, last] = [Date.parse(log.events[0]?.at ?? ""), Date.parse(log.events.at(-1)?.at ?? "")];
  const whole = Number.isNaN(first) ? 0 : last - first;
  const parts = new Map<string, number>();
  for (const { part, from, until } of spans) parts.set(part, (parts.get(part) ?? 0) + until - from);
  // The union of the spans, so that a session running beside a comparison is not counted twice.
  let [held, reached] = [0, first];
  for (const { from, until } of spans.toSorted((a, b) => a.from - b.from)) {
    held += Math.max(0, until - Math.max(from, reached));
    reached = Math.max(reached, until);
  }
  const hours = (ms: number) => (ms / HOUR_MS).toFixed(1);
  const named = [...parts]
    .toSorted(([, a], [, b]) => b - a)
    .concat([[BETWEEN_MOVES, whole - held]])
    .map(([part, ms]) => `${part} ${hours(ms)} (${whole > 0 ? ((ms / whole) * 100).toFixed(0) : "0"}%)`);
  return `hours: ${named.join(", ")}, of ${hours(whole)}`;
}

/** What ran through the gap that ends at event `index`: the command whose time covers most of it,
 *  else the turn it ended, else nothing where no session or comparison was open. */
function causeOf(log: Index, spans: readonly Span[], index: number, gap: number): string {
  const end = Date.parse(log.events[index]?.at ?? "");
  const burst = log.events.slice(index).filter(({ at }) => Date.parse(at) - end <= BURST_MS);
  const role = (kind: string) => ROLE_OF.get(kind.slice(0, kind.indexOf("."))) ?? kind;
  const command = burst.find(
    ({ kind, data }) => kind.endsWith(".call") && isNumber(data.ms) && data.ms * 2 >= gap,
  );
  if (command !== undefined) return `${role(command.kind)} command`;
  const turn = burst.find(({ kind }) => kind.endsWith(".turn"));
  if (turn !== undefined) {
    const output = asRecord(turn.data.usage)?.output;
    return `${role(turn.kind)} turn${isNumber(output) ? ` (${output.toLocaleString("en-US")} output tokens)` : ""}`;
  }
  const open = spans.some(({ from, until }) => from <= end - gap && end - gap < until);
  return open ? `before ${log.events[index]?.kind ?? ""}` : BETWEEN_MOVES;
}

/** Lane 28: the longest silences, each by what ran through it, and a role that took most of the
 *  dollars. A silence is read against the campaign's own median solve: at a fixed twenty minutes it
 *  read nothing on buffer on 10 October, whose longest gap was 19.5 minutes, and gave recode's two
 *  longer ones as a count and the time of the first, with nothing of what ran. */
export function costTriggers(log: Index): Trigger[] {
  // A solve that measured: truss's 30 provider and killed attempts of under 10 s on 12 October put the
  // median at 6.2 minutes against 24.6 over its passes and rejections.
  const done = log.solves.filter(measured).map((solve) => solve.seconds);
  const scaled = (median(done) ?? 0) * SILENCE_SOLVES;
  const threshold = Math.max(scaled, SILENCE_FLOOR_SECONDS) * 1_000;
  const why =
    scaled > SILENCE_FLOOR_SECONDS
      ? `${String(SILENCE_SOLVES)} times the median measured solve`
      : "the floor";
  const times = log.events.map(({ at }) => Date.parse(at));
  const gaps = times
    .flatMap((at, index) => (index > 0 && at - (times[index - 1] ?? at) > threshold ? [index] : []))
    .map((index) => ({ index, gap: (times[index] ?? 0) - (times[index - 1] ?? 0) }))
    .toSorted((a, b) => b.gap - a.gap);
  const spans = spansOf(log);
  const named = gaps
    .slice(0, SILENCES_NAMED)
    .map(({ index, gap }) => `${(gap / MINUTE_MS).toFixed(1)} min ${causeOf(log, spans, index, gap)}`);
  const spend = spendOf(log);
  const total = spend.reduce((sum, [, dollars]) => sum + dollars, 0);
  const [[leader, most] = ["", 0]] = spend;
  return [
    ...(gaps.length > 0
      ? [
          fired(
            "LONG SILENCES",
            `${plural(gaps.length, "gap")} over ${(threshold / MINUTE_MS).toFixed(1)} min, ${why}: ${named.join("; ")}`,
          ),
        ]
      : []),
    ...(total > 0 && leader !== "solver" && most > total / 2
      ? [fired("SPEND LED BY A ROLE", `${leader}: ${percent(most / total)} of billed dollars`)]
      : []),
  ];
}
