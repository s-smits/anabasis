/**
 * One campaign folded into the row every reader of the record across runs shares: when it reached
 * its first comparison and each promotion, what each took in hours and dollars, and what its climb
 * rests on. promotion-tuner's `table.ts` prints the rows and `trend.ts` sets one window of them
 * against another. Every number is a production fold over the log and its launch receipts
 * (AGENTS.md section 5): `comparisonsOf`, `epochsOf`, `starterReads`, `billedBetween` and `waitsOf`.
 *
 * A run's **release** is the release tag before its first launch (`after v0.7.4` is the cycle that
 * built the next release; a campaign with no receipt is placed by its first event), its **pack**
 * is `packOf` of its name, and its **setting** the solver, its effort and the solve limits.
 *
 * All times are on the log's own clock. **Elapsed** hours run from the first event. **Active**
 * hours subtract the union of every recorded wait (a provider's reset, the network, the solve
 * queue), so a run that sat out a limit is not slower for it. **Unloaded** hours also take out what
 * an overloaded host cost (`overloadOf`): each stretch after a recorded load counts the share of
 * the demand its cores could not serve, `1 - cores / load`. That treats the run as CPU-bound while
 * much of a solve waits on the provider, so it is an upper bound on the load's cost and an
 * estimate. No hour is scaled by the chip or the operating system.
 *
 * Hours say how fast a run climbed, not what it climbed on, so three readings stand beside them.
 * **Room on validity** is the scored tasks, summed over the reported comparisons, that the
 * reference did not answer validly in every solve; near zero, a step can be won only on the
 * objective. **Steps won by validity** counts them as the closing report does. A promotion is
 * **confirmed** by `confirmed` (`src/campaign/climb.ts`); `reads` counts the promotions a starter
 * comparison has read at all, the denominator, and `after` is the reference's tally in them on the
 * tasks written after its promotion, which it was not chosen on.
 *
 * **Dollars** are what the log billed under its own commit's meter, and the meter moved: on
 * 25 October it began pricing each turn at the model that served it, and on 1 November (#563) it
 * began billing a session on its backend's ledger. **Repriced** dollars price every recorded turn
 * with the seat meter a live seat runs today (`seatMeter` on its provider's catalogue), the one
 * measure every run shares (operator, 2 November: "use current metrics mechanisms to backtrack
 * earlier runs and equally compare that way"); no old log holds a backend's excess over its turns.
 *
 * The first promotion over the Starter is set-up (epoch 0), as the closing report counts it
 * (`epochLine`); `promotions` holds it, and the climb is one fewer.
 */
import { backends } from "#src/agent/backends/models.ts";
import { epochsOf, ORIGINS, starterReads } from "#src/campaign/climb.ts";
import { comparisonsOf } from "#src/campaign/ground.ts";
import { campaignOf } from "#src/campaign/handover.ts";
import { openingOf } from "#src/campaign/opening.ts";
import type { Tally } from "#src/kernel/compare.ts";
import { type EventKind, type LogEvent, read } from "#src/kernel/log.ts";
import { billedBetween, seatMeter } from "#src/kernel/meter.ts";
import { askedOf, type Seat, tracesIn } from "#src/kernel/trace.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfNotNull } from "#src/meta/optional-key.ts";
import { relative, sep } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { median } from "#src/meta/tally.ts";
import { validityOf } from "#tools/d2/close.ts";
import { modelNamed, sweepOptions } from "#tools/m0/stored-sweep.ts";
import { ranWith, receipts } from "#tools/runs/receipt.ts";
import { packOf } from "#tools/runs/registry.ts";
import { summed } from "#tools/wri/folds.ts";
import { overloadOf, waitedMs, waitsOf } from "#tools/wri/time.ts";
import { campaignLogs, type Found, rehearsed } from "./logs.ts";
import { MISSING } from "./print.ts";

/** The tool calls of solves and sessions, which no fold here reads; `draft.call` is read for what a
 *  drafting session cut short had metered (`unfinished`, `src/kernel/trace.ts`). */
const CALLS: ReadonlySet<EventKind> = new Set(["solve.call", "exam.call", "build.call", "referee.call"]);
/** A run whose log has been quiet for longer than this, or whose last event is an ending, is not
 *  live. A run sitting out a provider's reset longer than this reads as finished with no ending. */
export const LIVE_MS = 2 * HOUR_MS;
/** The opening's seat a trace's turns ran on, where no start of their own names a model. */
const OPENED = {
  build: "builder",
  exam: "examiner",
  draft: "examiner",
  referee: "reviewer",
  solve: "solver",
} as const satisfies Record<Seat, string>;

type Meter = ReturnType<typeof seatMeter>;

/** One promotion of a run, with the epoch it ended. */
export interface Promotion {
  readonly nth: number;
  /** The promoted harness, by digest. */
  readonly harness: string;
  /** Whether the starter comparison owed after it confirmed it; null until one tallies a task. */
  readonly confirmed: boolean | null;
  /** Elapsed and active hours from the log's first event to the promotion. */
  readonly elapsed: number;
  readonly active: number;
  /** The epoch's own elapsed and active hours and dollars: from the opening or the promotion
   *  before, to this one. */
  readonly epochElapsed: number;
  readonly epochActive: number;
  /** The epoch's active hours less what an overloaded host cost (`overloadOf`), an estimate. */
  readonly epochUnloaded: number;
  readonly dollars: number;
  /** The comparisons reported in the epoch. A Builder's sessions are left out: a conversation that
   *  leads its campaign spans epochs and ends in the last. */
  readonly comparisons: number;
  /** The promoting comparison's tally of tasks won, lost and tied, and its p. */
  readonly tally: string;
}

/** One campaign, folded from its log and receipts. */
export interface Run {
  readonly name: string;
  readonly host: string;
  readonly release: string;
  readonly pack: string;
  readonly setting: string;
  readonly cores: number | null;
  /** The median one-minute load per core at a solve's start, and the median solve in seconds. */
  readonly load: number | null;
  readonly solveSeconds: number | null;
  /** The time of its first launch, else its first event, and of its log's last event. */
  readonly launched: number;
  readonly last: number;
  readonly elapsed: number;
  readonly active: number;
  readonly unloaded: number;
  /** Whether the log is still being written: its last event is no ending and is recent. */
  readonly live: boolean;
  /** Hours from the first event to the first comparison started and reported. */
  readonly firstCompared: number | null;
  readonly firstReported: number | null;
  /** The reported comparisons a promotion could come from: neither the starter's side of a starter
   *  comparison nor a harness against itself. */
  readonly compared: number;
  readonly promotions: readonly Promotion[];
  /** What the log billed under its own commit's meter (`billedAll`). */
  readonly dollars: number;
  /** Every recorded turn at today's list prices through today's seat meter, the one measure every
   *  run shares, or null with what stopped a turn being priced (`unpriced`). It leaves out a
   *  backend's excess over its turns (compactions, retries), which `dollars` holds from #563 on. */
  readonly repriced: number | null;
  readonly unpriced: string | null;
  /** Scored tasks, summed over the reported comparisons, and those of them the reference did not
   *  answer validly in every solve: the room a harness can win on validity alone. */
  readonly scored: number;
  readonly room: number;
  /** The comparisons that read a step, and those whose step won points by validity (`validityOf`). */
  readonly stepped: number;
  readonly onValidity: number;
  /** The promotions a starter comparison has read, those it confirmed, and the reference's tally
   *  in those comparisons on the tasks written after its promotion (`starterReads`). */
  readonly reads: number;
  readonly confirmed: number;
  readonly after: Tally;
  /** The A/A comparisons able to read a step, and those that did (`falsePromotion`). */
  readonly controls: number;
  readonly aaSteps: number;
  readonly ending: string;
}

/** Which campaigns a reader across runs takes. */
export interface Asked {
  /** The folder whose campaigns are read (an archive, one host's folder of it, or a folder of
   *  worktrees), or null for every campaign the registry reaches across the hosts. */
  readonly home: string | null;
  /** Campaigns whose last event is at or after this date. */
  readonly since: string;
  /** Parts of a campaign's name, any of which keeps it; none keeps all. */
  readonly names?: readonly string[];
  /** Text and commits every launch of a kept run ran with (`ranWith`). */
  readonly has?: readonly string[];
  readonly holds?: readonly string[];
  /** The checkout whose release tags place a run and whose history `ranWith` reads. */
  readonly repo: string;
}

const hours = (ms: number) => ms / HOUR_MS;
const numeral = (value: JsonValue | undefined) => (isNumber(value) ? String(value) : "?");
/** The promotions after set-up, the rungs of the climb. */
export const rungsOf = (run: Run) => run.promotions.slice(1);

/** The release tags with their dates, oldest first. */
function releasesOf(repo: string): { name: string; at: number }[] {
  const lines = gitMaybe(
    repo,
    "for-each-ref",
    "--sort=creatordate",
    "--format=%(creatordate:iso-strict) %(refname:short)",
    "refs/tags/v*",
  );
  return (lines ?? "").split("\n").flatMap((line) => {
    const [date = "", name = ""] = line.split(" ");
    return /^v\d/u.test(name) ? [{ name, at: Date.parse(date) }] : [];
  });
}

/** What a run's solver was set to: its model, effort, solve minutes and model turns. */
function settingOf(events: readonly LogEvent[]): string {
  const data = events.find(({ kind }) => kind === "campaign.setting")?.data;
  const solver = asRecord(data?.solver);
  if (data === undefined || solver === null) return "no setting";
  const model = isString(solver.model) ? solver.model.replace(/^claude\//u, "") : "?";
  return `${model}/${isString(solver.effort) ? solver.effort : "?"} ${numeral(data.minutes)}m ${numeral(data.modelTurns)}t`;
}

/** The time of a campaign's solves: the median in seconds, and the median one-minute load per core
 *  at their start. */
function machineOf(events: readonly LogEvent[]) {
  const seconds = events.flatMap(({ kind, data }) =>
    kind === "solve.finished" && isNumber(data.seconds) ? [data.seconds] : [],
  );
  const loads = events.flatMap(({ kind, data }) => {
    const first = Array.isArray(data.load) ? data.load[0] : undefined;
    return kind === "solve.started" && isNumber(first) && isNumber(data.cores) && data.cores > 0
      ? [first / data.cores]
      : [];
  });
  return { solveSeconds: median(seconds), load: median(loads) };
}

/** The tally and p of the comparison a promotion rests on: the last reading of the promoted harness
 *  against the reference it replaced that read `step`, else its last reading of any kind. */
function tallyOf(events: readonly LogEvent[], index: number): string {
  const { harness, from } = events[index]?.data ?? {};
  const readings = comparisonsOf(events.slice(0, index)).filter(
    ({ fresh, old, report }) => report !== null && fresh === harness && (from === undefined || old === from),
  );
  const scored = asRecord(
    (readings.findLast(({ report }) => report?.reading === "step") ?? readings.at(-1))?.report?.scored,
  );
  if (scored === null) return MISSING;
  const p = isNumber(scored.p) ? ` p ${scored.p.toFixed(4)}` : "";
  return `${numeral(scored.wins)}-${numeral(scored.losses)}-${numeral(scored.ties)}${p}`;
}

/** What the starter comparisons of a campaign read: how many promotions one has read, and the
 *  reference's tally in them on the tasks written after its promotion; and the comparisons a
 *  promotion could come from, which leaves out those whose new side is the starter. */
function heldOf(events: readonly LogEvent[]): Pick<Run, "reads" | "after" | "compared"> {
  const reads = starterReads(events);
  const starter = reads[0]?.starter;
  return {
    reads: reads.length,
    after: summed(reads.map(({ origins }) => origins[ORIGINS[2]].whole)),
    compared: comparisonsOf(events).filter(
      ({ report, old, fresh }) => report !== null && fresh !== old && fresh !== starter,
    ).length,
  };
}

/** One meter a model, priced on today's catalogue as a live seat's is; the catalogue is built at the
 *  first turn priced. */
function meters(): (name: string) => Meter {
  const held = new Map<string, Meter>();
  let models: ReturnType<typeof backends> | undefined;
  return (name) => {
    const found = held.get(name);
    if (found !== undefined) return found;
    models ??= backends(sweepOptions());
    const meter = seatMeter(modelNamed(name));
    meter.catalogue(models);
    held.set(name, meter);
    return meter;
  };
}

/** Every recorded turn of a log at today's prices, each at the model its start asked for (else its
 *  seat's at the opening) and served at the one that answered, or what stopped one being priced. */
function repricedOf(events: readonly LogEvent[], meterOf: (name: string) => Meter) {
  const asked = askedOf(events);
  const opening = openingOf(events);
  const seats = { ...opening?.seats, solver: opening?.solver ?? null };
  let total = 0;
  for (const turn of tracesIn(events)) {
    if (turn.part !== "turn" || turn.usage === null) continue;
    const model = asked.get(turn.id) ?? seats[OPENED[turn.seat]]?.model;
    if (model === undefined) return { repriced: null, unpriced: `no model for ${turn.seat}.turn` };
    const [provider = "", ...id] = model.split("/");
    try {
      total += meterOf(model).turn({
        provider,
        model: id.join("/"),
        ...keyIfNotNull("responseModel", turn.model),
        // SAFETY: a `*.turn` event's `usage` is the pi usage its seat recorded whole (`src/agent/session.ts`).
        usage: turn.usage as never,
      });
    } catch (error) {
      return { repriced: null, unpriced: errorMessage(error) };
    }
  }
  return { repriced: total, unpriced: null };
}

/** One campaign as a row, or null for a rehearsal; `meterOf` reprices its turns. */
export function runOf(
  found: Found,
  events: readonly LogEvent[],
  tags: readonly { name: string; at: number }[],
  meterOf = meters(),
): Run | null {
  if (rehearsed(events)) return null;
  const stamps = events.map(({ at }) => Date.parse(at));
  const [first = 0, last = 0] = [stamps[0], stamps.at(-1)];
  const launch = receipts(found.path)[0];
  const launched = launch === undefined ? first : Date.parse(launch.at);
  const tag = tags.findLast(({ at }) => at <= launched);
  const waits = waitsOf(events);
  const overload = overloadOf(events);
  // Hours between two moments less the waits inside them, and less what an overloaded host cost.
  const activeAt = (to: number, from = first) => hours(to - from - waitedMs(waits, from, to));
  const unloadedAt = (to: number, from = first) => activeAt(to, from) - hours(overload(from, to));
  const indexes = events.flatMap(({ kind }, at) => (kind === "harness.promoted" ? [at] : []));
  const epochs = epochsOf(events);
  const promotions = indexes.map((at, nth): Promotion => {
    const start = indexes[nth - 1] ?? 0;
    const [before = first, now = first] = [stamps[start], stamps[at]];
    // The epoch a promotion opens is the one its starter comparison is read in.
    const opened = epochs[nth + 1];
    const { harness } = events[at]?.data ?? {};
    return {
      nth: nth + 1,
      harness: isString(harness) ? harness : "",
      confirmed: (opened?.starter_tally ?? null) === null ? null : opened?.confirmed === true,
      elapsed: hours(now - first),
      active: activeAt(now),
      epochElapsed: hours(now - before),
      epochActive: activeAt(now, before),
      epochUnloaded: unloadedAt(now, before),
      dollars: billedBetween(events, start, at + 1),
      comparisons: epochs[nth]?.comparisons.length ?? 0,
      tally: tallyOf(events, at),
    };
  });
  const firstOf = (kind: string) => {
    const at = stamps[events.findIndex((event) => event.kind === kind)];
    return at === undefined ? null : hours(at - first);
  };
  const ended = events.findLast(({ kind }) => kind === "campaign.ended")?.data.ending;
  // `falsePromotion` reads the A/A comparisons of the whole campaign on every epoch.
  const noise = epochs[0]?.falsePromotion;
  return {
    name: found.name,
    host: found.archived ?? "here",
    release: tag === undefined ? `before ${tags[0]?.name ?? "the first release"}` : `after ${tag.name}`,
    pack: packOf(found.name),
    setting: settingOf(events),
    cores: launch?.cores ?? null,
    ...machineOf(events),
    launched,
    last,
    elapsed: hours(last - first),
    active: activeAt(last),
    unloaded: unloadedAt(last),
    live: events.at(-1)?.kind !== "campaign.ended" && Date.now() - last < LIVE_MS,
    firstCompared: firstOf("comparison.started"),
    firstReported: firstOf("comparison.reported"),
    promotions,
    dollars: billedBetween(events, 0),
    ...repricedOf(events, meterOf),
    ...validityOf(campaignOf(events).steps),
    ...heldOf(events),
    confirmed: epochs.filter((epoch) => epoch.confirmed === true).length,
    controls: noise?.controls ?? 0,
    aaSteps: noise?.errors ?? 0,
    ending: isString(ended) ? ended : "no ending",
  };
}

/** The share of a list of runs promoted by `mark` elapsed hours, as the promoted and the runs that
 *  either were or lasted that long, so a run still young counts for neither side. */
export function promotedBy(runs: readonly Run[], mark: number): { promoted: number; known: number } {
  const by = (run: Run) => (run.promotions[0]?.elapsed ?? Infinity) <= mark;
  const known = runs.filter((run) => run.elapsed >= mark || by(run));
  return { promoted: known.filter(by).length, known: known.length };
}

/** Every campaign asked for as a row, oldest launch first, and the logs that could not be read. */
export async function loadRuns(asked: Asked): Promise<{ runs: Run[]; skipped: string[] }> {
  const { home, names = [], has = [], holds = [], repo } = asked;
  const tags = releasesOf(repo);
  const meterOf = meters();
  const skipped: string[] = [];
  const runs: Run[] = [];
  for (const each of await campaignLogs(home, [], asked.since)) {
    // Under an explicit home, a campaign's host is the folder it lies in where that lies in the
    // given one (`data/runs/<host>/<name>/log.jsonl`), and this machine otherwise.
    const parts = home === null ? [] : relative(home, each.path).split(sep);
    const found = parts.length === 3 ? { ...each, archived: parts[0] ?? "here" } : each;
    if (names.length > 0 && !names.some((part) => found.name.includes(part))) continue;
    if (has.length + holds.length > 0 && !ranWith(found.path, repo, { has, holds })) continue;
    try {
      const run = runOf(found, read(found.path, CALLS), tags, meterOf);
      if (run !== null) runs.push(run);
    } catch (error) {
      skipped.push(`${found.name}: ${errorMessage(error)}`);
    }
  }
  return { runs: runs.toSorted((a, b) => a.launched - b.launched), skipped };
}
