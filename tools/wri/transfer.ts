/**
 * Practice discipline, the coarse-band channel and the starter-read family transfer matrix (lane 12):
 *
 *   bun tools/wri/wri.ts reader transfer --log <log>
 *
 * Splits each starter read's tasks by origin (`chosen`, `before`, `after`) and by whether their family
 * was practised, from `starterReads` and `familiesOf`, and audits each Builder's practice. It prints
 * tallies, percentages, session ids and counts, never family names, task text or raw objective values.
 */
import { ORIGINS, type Origin, type StarterRead, starterReads } from "#src/campaign/climb.ts";
import { testOf, type Tally } from "#src/kernel/compare.ts";
import { familiesOf } from "#src/kernel/history.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { taskSets } from "#src/kernel/task.ts";
import { callsOf, tracesIn } from "#src/kernel/trace.ts";
import { isString } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { indexOf, practiceOf, summed, text, formatTally } from "./folds.ts";

const SHORT_ORIGIN: Readonly<Record<Origin, string>> = {
  [ORIGINS[0]]: "chosen",
  [ORIGINS[1]]: "before",
  [ORIGINS[2]]: "after",
};
/** Detects a raw numeric objective value leaked in a `practice` tool result instead of a coarse band. */
const RAW_MEASURE_LEAK_RE = /\bobjective\s*(?:=|:)\s*-?\d+(?:\.\d+)?\b/iu;

interface SplitCell {
  readonly practised: Tally;
  readonly unpractised: Tally;
}

const EMPTY_CELL: SplitCell = {
  practised: { wins: 0, losses: 0, ties: 0 },
  unpractised: { wins: 0, losses: 0, ties: 0 },
};

const winShare = ({ wins, losses }: Tally): string => {
  const untied = wins + losses;
  return untied === 0 ? "n/a" : `${String(Math.round((100 * wins) / untied))}%`;
};

/** Families that had at least one task released for practice before event index `before`. */
function practisedFamiliesBefore(
  events: readonly LogEvent[],
  families: ReadonlyMap<string, string | null>,
  before: number,
): Set<string> {
  const released = taskSets(events.slice(0, before)).released;
  const set = new Set<string>();
  for (const version of released) {
    const family = families.get(version);
    if (isString(family)) set.add(family);
  }
  return set;
}

/** Task versions proposed before the latest promotion and released for practice after it. */
export function inheritedPracticeReleases(events: readonly LogEvent[]): string[] {
  const proposedAt = new Map<string, number>();
  let lastPromo = -1;
  const inherited: string[] = [];
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === "task.proposed" && isString(data.version) && !proposedAt.has(data.version)) {
      proposedAt.set(data.version, index);
    } else if (kind === "harness.promoted") {
      lastPromo = index;
    } else if (kind === "task.state" && data.state === "released" && lastPromo >= 0) {
      const version = text(data.version);
      const proposed = proposedAt.get(version);
      if (proposed !== undefined && proposed < lastPromo) inherited.push(version);
    }
  }
  return inherited;
}

/** Split one starter read's rows by `(origin, practised-family before promotion)`. */
function splitStarterRead(
  events: readonly LogEvent[],
  read: StarterRead,
  families: ReadonlyMap<string, string | null>,
): {
  readonly byOrigin: ReadonlyMap<Origin, SplitCell>;
  readonly afterBatches: number;
  readonly afterFamilies: number;
} {
  const promoIndex = events.findIndex(
    ({ kind, data }) => kind === "harness.promoted" && data.harness === read.reference,
  );
  const reportIndex = events.findLastIndex(
    ({ kind, data }) => kind === "comparison.reported" && data.session === read.session,
  );
  const fallbackCutoff = reportIndex === -1 ? events.length : reportIndex;
  const cutoff = promoIndex === -1 ? fallbackCutoff : promoIndex;
  const practised = practisedFamiliesBefore(events, families, cutoff);
  const byOrigin = new Map<Origin, SplitCell>();
  for (const origin of ORIGINS) {
    const rows = read.rows.filter((row) => row.origin === origin);
    const kin = rows
      .filter((row) => {
        const fam = families.get(row.task);
        return isString(fam) && practised.has(fam);
      })
      .map(({ margin }) => margin);
    const novel = rows
      .filter((row) => {
        const fam = families.get(row.task);
        return !isString(fam) || !practised.has(fam);
      })
      .map(({ margin }) => margin);
    const [kTally, nTally] = [testOf(kin), testOf(novel)];
    byOrigin.set(origin, {
      practised: { wins: kTally.wins, losses: kTally.losses, ties: kTally.ties },
      unpractised: { wins: nTally.wins, losses: nTally.losses, ties: nTally.ties },
    });
  }
  const afterRows = read.rows.filter(({ origin }) => origin === ORIGINS[2]);
  const afterBatches = new Set(afterRows.map(({ writer }) => writer)).size;
  const afterFamilies = new Set(
    afterRows.flatMap(({ task }) => {
      const fam = families.get(task);
      return isString(fam) ? [fam] : [];
    }),
  ).size;
  return { byOrigin, afterBatches, afterFamilies };
}

/** 2x2 starter-read transfer section (pulse-friendly: each starter read opens with `<session>`). */
function starterTransferSection(events: readonly LogEvent[]): string[] {
  const reads = starterReads(events);
  if (reads.length === 0) return ["starter transfer: no starter read on record"];
  const families = familiesOf(events);
  const splits = reads.map((read) => ({ read, ...splitStarterRead(events, read, families) }));
  const lines = splits.map(({ read, byOrigin, afterBatches, afterFamilies }) => {
    const after = byOrigin.get(ORIGINS[2]) ?? EMPTY_CELL;
    const chosen = byOrigin.get(ORIGINS[0]) ?? EMPTY_CELL;
    const parts = ORIGINS.map((origin) => {
      const cell = byOrigin.get(origin) ?? EMPTY_CELL;
      return `${SHORT_ORIGIN[origin]} prac ${formatTally(cell.practised)} (${winShare(cell.practised)}) / unprac ${formatTally(cell.unpractised)} (${winShare(cell.unpractised)})`;
    });
    return `${read.session} transfer (${read.confirmed ? "confirmed" : "unconfirmed"}, ${String(afterBatches)} post-promo batches, ${String(afterFamilies)} unseen families): after prac ${formatTally(after.practised)} (${winShare(after.practised)}) vs unprac ${formatTally(after.unpractised)} (${winShare(after.unpractised)}) | chosen prac ${formatTally(chosen.practised)} vs unprac ${formatTally(chosen.unpractised)} | all: ${parts.join("; ")}`;
  });
  const totalParts = ORIGINS.map((origin) => {
    const prac = summed(splits.map(({ byOrigin }) => (byOrigin.get(origin) ?? EMPTY_CELL).practised));
    const unprac = summed(splits.map(({ byOrigin }) => (byOrigin.get(origin) ?? EMPTY_CELL).unpractised));
    return `${SHORT_ORIGIN[origin]}: prac ${formatTally(prac)} (${winShare(prac)}) vs unprac ${formatTally(unprac)} (${winShare(unprac)})`;
  });
  return [...lines, `transfer totals (${plural(reads.length, "starter read")}): ${totalParts.join(" | ")}`];
}

/** Builder practice discipline, probing concentration, and band-channel audit. */
function practiceDisciplineSection(events: readonly LogEvent[]): string[] {
  const log = indexOf(events);
  if (log.builds.length === 0) return ["practice discipline: no Builder session on record"];
  const buildCalls = callsOf(tracesIn(events), "build");
  const lines = log.builds.map((build) => {
    const solves = practiceOf(log, build);
    const byTask = Object.values(countBy(solves, (solve) => solve.version));
    const maxOnOne = byTask.length === 0 ? 0 : Math.max(...byTask);
    let moved = 0;
    let prev = build.parent;
    for (const solve of solves) {
      if (solve.harness !== "" && solve.harness !== prev) moved += 1;
      if (solve.harness !== "") prev = solve.harness;
    }
    const ownCalls = buildCalls.filter(({ id }) => id === build.session);
    const countTool = (name: string) => ownCalls.filter(({ tool }) => tool === name).length;
    const rawLeaks = ownCalls.filter(
      ({ tool, text: out }) => tool === "practice" && RAW_MEASURE_LEAK_RE.test(out),
    ).length;
    const leakNote = rawLeaks === 0 ? "" : `, ${String(rawLeaks)} raw-measure leaks`;
    return `${build.session} practice: ${String(solves.length)} solves across ${String(byTask.length)} tasks (max ${String(maxOnOne)}/task, ${String(moved)} state moves); read_trace ${String(countTool("read_trace"))}, check_harness ${String(countTool("check_harness"))}, preview_harness ${String(countTool("preview_harness"))}${leakNote}`;
  });
  const inheritedReleased = inheritedPracticeReleases(events).length;
  return [
    ...lines,
    `epoch practice scoping: ${plural(inheritedReleased, "pre-promotion task")} released after a promotion`,
  ];
}

/** 2x2 starter-read family transfer matrix and Builder practice-discipline audit. */
export function transferRows(events: readonly LogEvent[]): string[] {
  return [
    "transfer: 2x2 starter-read matrix (task origin x whether family was practised before promotion) and Builder practice discipline; wall-safe counts only",
    ...starterTransferSection(events),
    ...practiceDisciplineSection(events),
  ];
}
