/**
 * Per-campaign summary fold shared across archive readers (`table.ts`, `trend.ts`, `outside.ts`,
 * `tools/campaign/close.ts`, `tools/wri/backtrack.ts`): the release before the first launch; elapsed,
 * active (less recorded waits) and unloaded hours (less estimated overload, `overloadOf`); a cut at
 * `until` or `age` so snapshots and equal-age cohorts compare on identical terms; room on validity,
 * steps won by validity (`validityOf`) and confirmed promotions; and dollars as billed at the run's
 * commit beside every turn repriced through today's `seatMeter`.
 */
import { backends } from "#src/agent/backends/models.ts";
import { epochsOf, ORIGINS, starterIn, starterReads } from "#src/campaign/climb.ts";
import { comparisonsOf } from "#src/campaign/state.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { hasJudge } from "#src/kernel/contract.ts";
import type { Tally } from "#src/kernel/compare.ts";
import { CALL_KINDS, type EventKind, eventsOf, type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { billedBetween, seatMeter } from "#src/kernel/meter.ts";
import { endingOf, lastReports } from "#src/kernel/reports.ts";
import { askedOf, type Seat, traced } from "#src/kernel/trace.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfNotNull } from "#src/meta/optional-key.ts";
import { relative, sep } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { median } from "#src/meta/tally.ts";
import { validityOf } from "#tools/campaign/close.ts";
import { recordedSetting } from "#tools/campaign/setting.ts";
import { modelNamed, sweepOptions } from "#tools/m0/stored-sweep.ts";
import { ranWith, receipts } from "#tools/runs/receipt.ts";
import { packOf } from "#tools/runs/registry.ts";
import { firstComparisonDelay } from "#tools/runs/view.ts";
import { summed } from "#tools/wri/folds.ts";
import { overloadOf, waitedMs, waitsOf } from "#tools/wri/time.ts";
import { campaignLogs, type Found, rehearsed } from "./logs.ts";
import { MISSING } from "./print.ts";

/** `draft.call` is kept for what a drafting session cut short had metered (`unfinished`,
 *  `src/kernel/trace.ts`). */
const CALLS: ReadonlySet<EventKind> = new Set([...CALL_KINDS].filter((kind) => kind !== "draft.call"));
const TURN_KINDS: readonly EventKind[] = [...TRACE_KINDS].filter((kind) => !CALL_KINDS.has(kind));
/** A run sitting out a provider's reset longer than this reads as finished with no ending. */
const LIVE_MS = 2 * HOUR_MS;
const OPENED = {
  build: "builder",
  exam: "examiner",
  draft: "examiner",
  referee: "reviewer",
  solve: "solver",
} as const satisfies Record<Seat, string>;

type Meter = ReturnType<typeof seatMeter>;

export interface Promotion {
  readonly nth: number;
  readonly harness: string;
  /** Whether the starter comparison owed after it confirmed it; null until one tallies a task. */
  readonly confirmed: boolean | null;
  readonly elapsed: number;
  readonly active: number;
  /** The epoch's own hours and dollars, from the opening or the promotion before to this one. */
  readonly epochElapsed: number;
  readonly epochActive: number;
  readonly epochUnloaded: number;
  readonly dollars: number;
  /** A Builder's sessions are left out: a conversation that leads its campaign spans epochs and
   *  ends in the last. */
  readonly comparisons: number;
  readonly tally: string;
}

export interface Run {
  readonly name: string;
  readonly host: string;
  readonly release: string;
  readonly pack: string;
  readonly setting: string;
  readonly cores: number | null;
  readonly load: number | null;
  readonly solveSeconds: number | null;
  /** The time of its first launch, else its first event, and of its log's last event, or of the cut
   *  where the log goes on past it. */
  readonly launched: number;
  readonly last: number;
  readonly elapsed: number;
  readonly active: number;
  readonly unloaded: number;
  readonly live: boolean;
  readonly firstCompared: number | null;
  readonly firstReported: number | null;
  /** Hours until comparison admission first opened (`firstComparisonDelay`), or null if it never
   *  did; isolates task-supply time from Builder delay. */
  readonly firstAdmissible: number | null;
  /** Neither the starter's side of a starter comparison nor a harness against itself. */
  readonly compared: number;
  readonly promotions: readonly Promotion[];
  readonly dollars: number;
  /** Every recorded turn at today's list prices through today's seat meter, the one measure every
   *  run shares, or null with what stopped a turn being priced (`unpriced`). It leaves out a
   *  backend's excess over its turns (compactions, retries), which `dollars` holds in newer logs. */
  readonly repriced: number | null;
  readonly unpriced: string | null;
  /** The room a harness can win on validity alone: scored tasks the reference did not answer
   *  validly in every solve. */
  readonly scored: number;
  readonly room: number;
  readonly stepped: number;
  readonly onValidity: number;
  /** The reference's tally is on the tasks written after its promotion (`starterReads`). */
  readonly reads: number;
  readonly confirmed: number;
  readonly after: Tally;
  /** The A/A comparisons able to read a step, and those that read one one-sided as a promotion
   *  would (`falsePromotion`), pooled and split by whether the reference's own validity flipped or only the objective varied. */
  readonly controls: number;
  readonly aaSteps: number;
  readonly aaValidityControls: number;
  readonly aaValiditySteps: number;
  readonly aaObjectiveControls: number;
  readonly aaObjectiveSteps: number;
  readonly aaLevels: readonly number[];
  readonly ending: string;
}

export interface Asked {
  /** An archive, one host's folder of it or a folder of worktrees, or null for every campaign the
   *  registry reaches across the hosts. */
  readonly home: string | null;
  readonly since: string;
  readonly names?: readonly string[];
  readonly has?: readonly string[];
  readonly holds?: readonly string[];
  readonly repo: string;
  /** Where every log is read to, so that a reading repeats; now by default. */
  readonly until?: number;
}

interface Cut {
  readonly until?: number | undefined;
  readonly age?: number;
}

const hours = (ms: number) => ms / HOUR_MS;
const numeral = (value: JsonValue | undefined) => (isNumber(value) ? String(value) : "?");
export const rungsOf = (run: Run) => run.promotions.slice(1);

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

function judgedLabel(events: readonly LogEvent[], opening: ReturnType<typeof openingOf>): string {
  if (!hasJudge(draftOf(events)?.objective)) return "";
  const reviewer = opening?.seats.reviewer ?? null;
  return reviewer === null ? " judged" : ` judged(${reviewer.model.replace(/^claude\//u, "")})`;
}

/** Runs are read together only under one such line (`AGENTS.md`, section 9). */
function settingOf(events: readonly LogEvent[]): string {
  const judged = judgedLabel(events, openingOf(events));
  const kept = recordedSetting(events);
  if (kept === null) return `no setting${judged}`;
  const { solver, minutes, modelTurns, target, solves } = kept;
  const window = solver?.window === undefined ? "" : `@${String(solver.window)}`;
  const by =
    solver === null
      ? "the cycle's solver"
      : `${solver.model.replace(/^claude\//u, "")}/${solver.effort}${window}`;
  return `${by} ${String(minutes)}m ${modelTurns === null ? "unlimited" : String(modelTurns)}t ${String(target)}x${String(solves)}${judged}`;
}

function machineOf(events: readonly LogEvent[]) {
  const seconds = eventsOf(events, "solve.finished").flatMap(({ event: { data } }) =>
    isNumber(data.seconds) ? [data.seconds] : [],
  );
  const loads = eventsOf(events, "solve.started").flatMap(({ event: { data } }) => {
    const first = Array.isArray(data.load) ? data.load[0] : undefined;
    return isNumber(first) && isNumber(data.cores) && data.cores > 0 ? [first / data.cores] : [];
  });
  return { solveSeconds: median(seconds), load: median(loads) };
}

/** The last reading of the promoted harness against the reference it replaced that read `step`,
 *  else its last reading of any kind. */
function tallyOf(
  events: readonly LogEvent[],
  comparisons: ReturnType<typeof comparisonsOf>,
  index: number,
): string {
  const { harness, from } = events[index]?.data ?? {};
  const reports = eventsOf(events, "comparison.reported");
  const readings = comparisons.flatMap(({ id, at, fresh, old }) => {
    if (at >= index || fresh !== harness || (from !== undefined && old !== from)) return [];
    const last = reports.findLast(
      ({ index: atReport, event }) => atReport < index && event.data.session === id,
    );
    return last === undefined ? [] : [last.event.data];
  });
  const scored = asRecord(
    (readings.findLast(({ reading }) => reading === "step") ?? readings.at(-1))?.scored,
  );
  if (scored === null) return MISSING;
  const p = isNumber(scored.p) ? ` p ${scored.p.toFixed(4)}` : "";
  return `${numeral(scored.wins)}-${numeral(scored.losses)}-${numeral(scored.ties)}${p}`;
}

/** The starter reads of a campaign, and the comparisons a promotion could come from, which leave
 *  out those whose new side is the starter, read or not. */
function heldOf(events: readonly LogEvent[], comparisons: ReturnType<typeof comparisonsOf>) {
  const reads = starterReads(events);
  const starter = starterIn(events);
  return {
    after: summed(reads.map(({ origins }) => origins[ORIGINS[2]].whole)),
    compared: comparisons.filter(
      ({ report, old, fresh }) => report !== null && fresh !== old && fresh !== starter,
    ).length,
  };
}

function validitySteps(events: readonly LogEvent[], comparisons: ReturnType<typeof comparisonsOf>) {
  const freshBy = new Map(comparisons.map(({ id, fresh }) => [id, fresh]));
  return lastReports(events).map(({ session, data }) => {
    const valid = asRecord(data.valid);
    const points = asRecord(data.points);
    const fresh = freshBy.get(session) ?? (isString(data.fresh) ? data.fresh : "");
    return {
      fresh,
      reading: isString(data.reading) ? data.reading : null,
      valid: Array.isArray(valid?.old) ? { old: valid.old.map((each) => (isNumber(each) ? each : 0)) } : null,
      points: isNumber(points?.validity) ? { validity: points.validity } : null,
    };
  });
}

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
  for (const { index, event } of eventsOf(events, TURN_KINDS)) {
    const turn = traced(event, index);
    if (turn?.part !== "turn" || turn.usage === null) continue;
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

/** The events of a log read to `until` and to `age` hours after its first, the moment they are read
 *  at, and the run's last moment. */
function cutOf(logged: readonly LogEvent[], { until, age = Infinity }: Cut) {
  const now = until ?? Date.now();
  const seen = until === undefined ? logged : logged.filter(({ at }) => Date.parse(at) <= until);
  const aged = Date.parse(seen[0]?.at ?? "") + age * HOUR_MS;
  const events = age === Infinity ? seen : seen.filter(({ at }) => Date.parse(at) <= aged);
  const end = events.at(-1)?.at;
  const last = events.length < seen.length ? aged : end === undefined ? 0 : Date.parse(end);
  return { events, last, moment: Math.min(now, aged) };
}

/** One campaign as a row, or null for a rehearsal. */
function runOf(
  found: Found,
  logged: readonly LogEvent[],
  tags: readonly { name: string; at: number }[],
  meterOf: ((name: string) => Meter) | null,
  cut: Cut = {},
): Run | null {
  if (rehearsed(logged)) return null;
  const { events, last, moment } = cutOf(logged, cut);
  const stamp = (at: number) => {
    const raw = events[at]?.at;
    return raw === undefined ? undefined : Date.parse(raw);
  };
  const first = stamp(0) ?? 0;
  const launch = receipts(found.path)[0];
  const launched = launch === undefined ? first : Date.parse(launch.at);
  const tag = tags.findLast(({ at }) => at <= launched);
  const waits = waitsOf(events);
  const overload = overloadOf(events);
  // Hours between two moments less the waits inside them, and less what an overloaded host cost.
  const activeAt = (to: number, from = first) => hours(to - from - waitedMs(waits, from, to));
  const unloadedAt = (to: number, from = first) => activeAt(to, from) - hours(overload(from, to));
  const comparisons = comparisonsOf(events);
  const indexes = eventsOf(events, "harness.promoted").map(({ index }) => index);
  const epochs = epochsOf(events);
  const promotions = indexes.map((at, nth): Promotion => {
    const built = epochs.find((epoch) => epoch.to === at);
    const opened = epochs.find((epoch) => epoch.from === at);
    const start = built?.from ?? indexes[nth - 1] ?? 0;
    const [before = first, now = first] = [stamp(start), stamp(at)];
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
      comparisons: built?.comparisons.length ?? 0,
      tally: tallyOf(events, comparisons, at),
    };
  });
  const firstOf = (kind: EventKind) => {
    const at = stamp(eventsOf(events, kind)[0]?.index ?? -1);
    return at === undefined ? null : hours(at - first);
  };
  const admissible = stamp(firstComparisonDelay(events)?.index ?? -1);
  const ended = endingOf(events);
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
    live: ended === null && moment - last < LIVE_MS,
    firstCompared: firstOf("comparison.started"),
    firstReported: firstOf("comparison.reported"),
    firstAdmissible: admissible === undefined ? null : hours(admissible - first),
    promotions,
    dollars: billedBetween(events, 0),
    ...(meterOf === null ? { repriced: null, unpriced: null } : repricedOf(events, meterOf)),
    ...validityOf(validitySteps(events, comparisons), events),
    ...heldOf(events, comparisons),
    reads: epochs.filter(
      ({ nth, reverted, starter_tally }) => nth > 1 && reverted !== true && starter_tally !== null,
    ).length,
    confirmed: epochs.filter(
      ({ nth, reverted, confirmed }) => nth > 1 && reverted !== true && confirmed === true,
    ).length,
    controls: noise?.controls ?? 0,
    aaSteps: noise?.errors ?? 0,
    aaValidityControls: noise?.byMeasure.validity.controls ?? 0,
    aaValiditySteps: noise?.byMeasure.validity.errors ?? 0,
    aaObjectiveControls: noise?.byMeasure.objective.controls ?? 0,
    aaObjectiveSteps: noise?.byMeasure.objective.errors ?? 0,
    aaLevels: noise?.levels ?? [],
    ending: ended ?? "no ending",
  };
}

export async function loadRuns(asked: Asked, mode: "full" | "unpriced" = "full") {
  const { home, names = [], has = [], holds = [], repo, until } = asked;
  const tags = releasesOf(repo);
  const meterOf = mode === "full" ? meters() : null;
  const skipped: string[] = [];
  const runs: Run[] = [];
  const logOf = new Map<Run, Found>();
  const cutCache = new Map<string, Run>();
  const at = (run: Run, age: number): Run => {
    const found = logOf.get(run);
    if (found === undefined || run.elapsed <= age) return run;
    const key = `${found.path}\0${String(age)}`;
    const cached = cutCache.get(key);
    if (cached !== undefined) return cached;
    const cut = runOf(found, read(found.path, CALLS), tags, meterOf, { until, age }) ?? run;
    cutCache.set(key, cut);
    return cut;
  };
  const match = names.length > 0 ? (name: string) => names.some((part) => name.includes(part)) : null;
  for (const each of await campaignLogs(home, names, asked.since, match)) {
    // Under an explicit home, a campaign's host is its folder (`data/runs/<host>/<name>/log.jsonl`),
    // and this machine otherwise.
    const parts = home === null ? [] : relative(home, each.path).split(sep);
    const found = parts.length === 3 ? { ...each, archived: parts[0] ?? "here" } : each;
    if (has.length + holds.length > 0 && !ranWith(found.path, repo, { has, holds })) continue;
    try {
      const run = runOf(found, read(found.path, CALLS), tags, meterOf, { until });
      if (run === null) continue;
      runs.push(run);
      logOf.set(run, found);
    } catch (error) {
      skipped.push(`${found.name}: ${errorMessage(error)}`);
    }
  }
  return { runs: runs.toSorted((a, b) => a.launched - b.launched), skipped, at };
}
