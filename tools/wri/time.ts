/**
 * The lanes of a whole-run investigation that read the clock: the solver's walls, limits and load
 * (lane 26), and where the campaign's hours, dollars and silences went (lane 28).
 * Role hours are elapsed open spans and can overlap. Every recorded wait, a provider's reset
 * (its grace minute included), a network wait and a load-gate wait, joins one union, and the hours
 * a promotion stand with and without it. Until 25 October only provider waits were read, then load
 * waits alone were subtracted: on recode forkedPR345 that left 17.4 h a promotion where every
 * recorded wait leaves 10.8, provider waits being the larger part on most runs.
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
 *
 * The six-campaign whole-run investigations on 20 October 2026 found unfinished comparisons'
 * solves labelled outside a comparison. Membership comes from `solve.started`, even before a
 * report can supply a scoring set.
 */
import { AT_A_LIMIT } from "#src/kernel/reports.ts";
import { type Turn, tracesIn } from "#src/kernel/trace.ts";
import { isNumber, type JsonValue } from "#src/meta/json-shape.ts";
import { countBy, median } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import {
  type Compared,
  fired,
  type Index,
  measured,
  percent,
  roleOf,
  type Solve,
  share,
  spendOf,
  strings,
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
/** A task's two mirrored orders of slots, `o` for the reference harness and `f` for the new one,
 *  repeated: the round puts the reference first in one slot and the new harness in the next, and
 *  starts every other task the other way (`unsolvedJobs`, `src/campaign/round.ts`). */
const MIRRORS = ["offo", "foof"] as const;
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
/** Where each part of the campaign's hours starts and ends. A part a stop cut ends at the
 *  campaign's ending, or at the log's last event. */
const SPANS = [
  ["builder", "build.started", "build.finished"],
  ["examiner", "exam.started", "exam.finished"],
  ["examiner", "draft.started", "draft.finished"],
  ["comparisons", "comparison.started", "comparison.reported"],
] as const;
const BETWEEN_MOVES = "between moves";
/** The recorded waits by what they waited for, in the order the hours line names them. */
const WAIT_KINDS = ["provider", "network", "load"] as const;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

interface Span {
  readonly part: string;
  readonly from: number;
  readonly until: number;
}

/** Whether a miss ended at a limit of its own: the kernel's kinds, every turn its bound allowed used
 *  (`limit`), as 5 of buffer's 17 on 12 October, or past the share of its wall read as bound by it. */
const atALimit = (solve: Solve) =>
  AT_A_LIMIT.has(solve.kind) ||
  solve.limit !== null ||
  (solve.wallSeconds > 0 && solve.seconds > solve.wallSeconds * WALL_BOUND_SHARE);
const limitOf = (solve: Solve) => (AT_A_LIMIT.has(solve.kind) ? solve.kind : solve.limit) ?? "wall share";

/** A comparison's solves of the tasks it tallied. A task set aside, short or withdrawn stands in no
 *  pair, and read with them main0_5_1's g-1 had 5 of 20 misses at a limit and a 52.3% wall share,
 *  where its tallied solves held 4 of 16 and 54.2% (lane 26, 15 October). */
const tallied = ({ own, scoring }: Compared) => {
  const versions = new Set(strings(own.versions));
  return scoring.filter((solve) => versions.has(solve.version));
};

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
  const compared = log.compared.flatMap((each) => {
    const { session, own } = each;
    const missed = misses(tallied(each));
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
  // An Examiner's admission solve names its session where a comparison's names the comparison.
  const started = new Set(log.of("comparison.started").map((start) => text(start.session)));
  const outside = misses(log.solves.filter((solve) => !started.has(solve.comparison ?? "")));
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
  const results = log.compared.map((each) => ({ ...each, scoring: tallied(each).filter(measured) }));
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
  // The tasks whose counted solves started out of their mirrored order. Since 24 October a worker
  // runs a task's slots one after another and retries a non-result at its own slot, so a task's
  // counted starts are a prefix of one mirror (`MIRRORS`). On host code from then a task off it is a
  // defect of the round; before it, the queue ordered starts without holding them, and a wait for
  // the load or a provider's reset on one side moved them.
  const outOfTurn = results.flatMap(({ session, own, scoring }) => {
    const tasks = Map.groupBy(
      scoring.toSorted((one, other) => one.index - other.index),
      (solve) => solve.version,
    );
    const late = [...tasks.values()].filter((solves) => {
      const order = solves.map((solve) => (solve.harness === own.old ? "o" : "f")).join("");
      return !MIRRORS.some((mirror) => mirror.repeat(order.length).startsWith(order));
    }).length;
    return late > 0 && own.old !== own.fresh
      ? [
          fired(
            "STARTS OUT OF TURN",
            `${session}: ${share(late, tasks.size)} tasks started their harnesses' solves out of turn`,
          ),
        ]
      : [];
  });
  // The solves a model other than their condition's served, a dated name read as its model's: on
  // 23 October recode's comparisons ran on claude-opus-5 against a setting of claude-opus-5-5 (F19).
  // An exact match stands first, so a setting that asks for a dated snapshot is not read as another.
  const asked = (solve: Solve) => solve.model.slice(solve.model.indexOf("/") + 1);
  const otherModel = results.flatMap(({ session, own, scoring }) => {
    const other = scoring.filter((solve) =>
      solve.served.some((model) => model !== asked(solve) && model.replace(/-\d{8}$/u, "") !== asked(solve)),
    );
    const under = other.filter((solve) => solve.harness === own.old).length;
    return other.length === 0
      ? []
      : [
          fired(
            "SERVED ANOTHER MODEL",
            `${session}: ${share(other.length, scoring.length)} solves, ${String(under)} of them under the reference harness; ${tally(
              countBy(
                other.flatMap((solve) => solve.served),
                (model) => model,
              ),
            )}`,
          ),
        ];
  });
  const middles = loads.flatMap(({ halves }) => halves);
  const [calmest, busiest] = [Math.min(...middles), Math.max(...middles)];
  const moved = busiest >= LOAD_WORTH_A_LINE && busiest >= calmest * LOAD_MOVED;
  return [
    ...limitTriggers(log),
    ...wallShares,
    ...loaded,
    ...outOfTurn,
    ...otherModel,
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

/** The union of intervals, so concurrent sessions or provider waits count their overlap once. */
function unionMs(windows: readonly { readonly from: number; readonly until: number }[]): number {
  let [held, reached] = [0, -Infinity];
  for (const { from, until } of windows.toSorted((a, b) => a.from - b.from)) {
    held += Math.max(0, until - Math.max(from, reached));
    reached = Math.max(reached, until);
  }
  return held;
}

/** Row A's overlapping elapsed spans beside its billed dollars, and the union of every recorded wait
 *  with the hours a promotion with and without it. A provider's reset and a network wait are
 *  recorded before their sleep and stop at the first subsequent ending, even after a resume; a
 *  load wait is recorded when the host admits the solve, so it ends at its event. The load half is
 *  an indicator: other solves run while one waits for the load. */
export function hoursLine(log: Index): string {
  const spans = spansOf(log);
  const [first, last] = [Date.parse(log.events[0]?.at ?? ""), Date.parse(log.events.at(-1)?.at ?? "")];
  const whole = Number.isNaN(first) ? 0 : last - first;
  const parts = new Map<string, number>();
  for (const { part, from, until } of spans) parts.set(part, (parts.get(part) ?? 0) + until - from);
  const waits: { from: number; until: number; kind: string }[] = [];
  let boundary = last;
  let promotions = 0;
  for (const { at, kind, data } of log.events.toReversed()) {
    const from = Date.parse(at);
    if (kind === "campaign.ended") boundary = from;
    if (kind === "harness.promoted") promotions += 1;
    if (kind !== "campaign.waited" || !isNumber(data.ms)) continue;
    // The load gate writes no `for`, older logs' included, and records its wait once it is over.
    if (data.for === undefined) waits.push({ from: from - data.ms, until: from, kind: "load" });
    else if (data.for === "provider" || data.for === "network") {
      waits.push({ from, until: Math.min(from + data.ms, boundary), kind: data.for });
    }
  }
  const hours = (ms: number) => (ms / HOUR_MS).toFixed(1);
  const named = [...parts]
    .toSorted(([, a], [, b]) => b - a)
    .concat([[BETWEEN_MOVES, whole - unionMs(spans)]])
    .map(([part, ms]) => `${part} ${hours(ms)} (${whole > 0 ? ((ms / whole) * 100).toFixed(0) : "0"}%)`);
  const waited = unionMs(waits);
  const kinds = WAIT_KINDS.filter((kind) => waits.some((wait) => wait.kind === kind)).map(
    (kind) => `${kind} ${hours(unionMs(waits.filter((wait) => wait.kind === kind)))}`,
  );
  const perPromotion =
    promotions > 0
      ? `; ${hours(whole / promotions)} h a promotion, ${hours((whole - waited) / promotions)} h outside recorded waits`
      : "";
  return `hours: elapsed open spans (overlapping), ${named.join(", ")}, of ${hours(whole)}; recorded waits ${hours(waited)} h${kinds.length > 0 ? ` (${kinds.join(", ")})` : ""}${perPromotion}`;
}

/** What ran through the gap that ends at event `index`: the command whose time covers most of it,
 *  else the turn it ended, else nothing where no session or comparison was open. */
function causeOf(log: Index, spans: readonly Span[], index: number, gap: number): string {
  const end = Date.parse(log.events[index]?.at ?? "");
  const burst = log.events.slice(index).filter(({ at }) => Date.parse(at) - end <= BURST_MS);
  const traces = tracesIn(burst);
  const command = traces.find((each) => each.part === "call" && each.ms !== null && each.ms * 2 >= gap);
  if (command !== undefined) return `${roleOf(command.seat) ?? command.seat} command`;
  const turn = traces.find((each): each is Turn => each.part === "turn");
  if (turn !== undefined) {
    const output = turn.usage?.output;
    return `${roleOf(turn.seat) ?? turn.seat} turn${isNumber(output) ? ` (${output.toLocaleString("en-US")} output tokens)` : ""}`;
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
