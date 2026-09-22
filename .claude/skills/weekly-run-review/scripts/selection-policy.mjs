// Pure weekly selection policy. The wrapper owns evidence I/O; this file owns time boundaries,
// duration admission, transparent axis seats and Luna question construction.

export const AXES = [
  "candidate-promotion",
  "vertical-completion",
  "informative-difficulty",
  "operational-yield",
  "non-saturated-scale",
];

function localParts(instant, timeZone) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  );
}

function shiftDate({ year, month, day }, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function zonedMidnight(date, timeZone) {
  const nominal = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = nominal;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = localParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
    );
    candidate = nominal - (represented - candidate);
  }
  return new Date(candidate);
}

export function weekWindow({ now, timeZone = "Europe/Oslo", week = "previous" }) {
  const anchor = new Date(now);
  if (!Number.isFinite(anchor.getTime())) throw new Error(`invalid --now value ${now}`);
  const parts = localParts(anchor, timeZone);
  const weekday = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[parts.weekday];
  if (weekday === undefined) throw new Error(`cannot resolve weekday in ${timeZone}`);
  const local = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
  const currentMonday = shiftDate(local, -weekday);
  const startDate = week === "previous" ? shiftDate(currentMonday, -7) : currentMonday;
  return {
    timeZone,
    week,
    start: zonedMidnight(startDate, timeZone).toISOString(),
    end: zonedMidnight(shiftDate(startDate, 7), timeZone).toISOString(),
    membership: "terminal.writtenAt for completed runs; opening.writtenAt for unfinished appendix",
  };
}

function compareNumber(left, right, ascending = false) {
  const a = Number.isFinite(left) ? left : -Infinity;
  const b = Number.isFinite(right) ? right : -Infinity;
  return ascending ? a - b : b - a;
}

function axisSignal(run, axis) {
  const facts = run.deterministic;
  if (axis === "candidate-promotion") return facts.movement.candidatePromoted > 0;
  if (axis === "vertical-completion") {
    return (
      facts.movement.lastAuthoringOrdinal !== null &&
      facts.batteries.verified > 0 &&
      facts.movement.iterationsMoved !== null
    );
  }
  if (axis === "informative-difficulty") return facts.batteries.inBand > 0;
  if (axis === "operational-yield") {
    return facts.movement.submits.moved !== null || facts.movement.iterationsMoved !== null;
  }
  return facts.batteries.nonSaturatedVerified > 0;
}

function axisComparator(axis) {
  return (left, right) => {
    const a = left.deterministic;
    const b = right.deterministic;
    let order;
    if (axis === "candidate-promotion") {
      order = compareNumber(a.movement.candidatePromoted, b.movement.candidatePromoted);
    } else if (axis === "vertical-completion") {
      order =
        compareNumber(a.movement.lastAuthoringOrdinal, b.movement.lastAuthoringOrdinal) ||
        compareNumber(a.batteries.verified, b.batteries.verified);
    } else if (axis === "informative-difficulty") {
      order =
        compareNumber(a.batteries.inBand, b.batteries.inBand) ||
        compareNumber(a.batteries.nonSaturatedVerified, b.batteries.nonSaturatedVerified);
    } else if (axis === "operational-yield") {
      order =
        compareNumber(
          (a.movement.submits.moved ?? 0) + (a.movement.iterationsMoved ?? 0),
          (b.movement.submits.moved ?? 0) + (b.movement.iterationsMoved ?? 0),
        ) ||
        compareNumber(a.movement.submits.compared, b.movement.submits.compared) ||
        compareNumber(a.movement.submits.stalled, b.movement.submits.stalled, true) ||
        compareNumber(a.movement.submits.unchangedTree, b.movement.submits.unchangedTree, true);
    } else {
      order =
        compareNumber(a.batteries.nonSaturatedVerified, b.batteries.nonSaturatedVerified) ||
        compareNumber(a.batteries.nonSaturated, b.batteries.nonSaturated) ||
        compareNumber(a.batteries.nonSaturatedFamilies, b.batteries.nonSaturatedFamilies);
    }
    return order || left.key.localeCompare(right.key);
  };
}

export function rankFinalists(runs, top = 5) {
  const selected = [];
  const reasons = new Map();
  const ordered = Object.fromEntries(
    AXES.map((axis) => [axis, runs.filter((run) => axisSignal(run, axis)).sort(axisComparator(axis))]),
  );
  for (let depth = 0; selected.length < top && depth < runs.length; depth += 1) {
    for (const axis of AXES) {
      const run = ordered[axis][depth];
      if (run === undefined) continue;
      reasons.set(run.key, [...new Set([...(reasons.get(run.key) ?? []), axis])]);
      if (!selected.some((entry) => entry.key === run.key)) selected.push(run);
      if (selected.length === top) break;
    }
  }
  return {
    selected: selected.map((run, index) => ({
      ...run,
      seat: index + 1,
      selectedBecause: reasons.get(run.key) ?? [],
    })),
    overflow: runs
      .filter((run) => !selected.some((entry) => entry.key === run.key))
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

export function partitionByDuration(runs, minDurationMinutes = 30) {
  const completed = runs.filter((run) => run.lifecycle === "terminal" && !run.invalid);
  const durationInvalid = completed.filter(
    (run) => !Number.isFinite(run.durationMinutes) || run.durationMinutes < 0,
  );
  return {
    completed,
    durationInvalid,
    short: completed.filter(
      (run) =>
        Number.isFinite(run.durationMinutes) &&
        run.durationMinutes >= 0 &&
        run.durationMinutes < minDurationMinutes,
    ),
    admitted: completed.filter(
      (run) => Number.isFinite(run.durationMinutes) && run.durationMinutes >= minDurationMinutes,
    ),
    unfinished: runs.filter((run) => run.lifecycle === "unfinished"),
  };
}

export function safeName(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "run"
  );
}

export function buildLunaPlan(selected) {
  const tasks = [];
  for (const run of selected) {
    const prefix = `${safeName(run.campaignId)}_${safeName(run.runId)}`;
    tasks.push({
      name: `${prefix}_mechanism`,
      runKey: run.key,
      task: `Read ${run.archive.synthesisPath} and the deterministic row for ${run.campaignId}/${run.runId}. Identify what made this run unusually good, the evidence level of each mechanism, one rival explanation and one falsifier.`,
    });
    tasks.push({
      name: `${prefix}_counterfactual`,
      runKey: run.key,
      task: `Read ${run.archive.synthesisPath} and the deterministic row for ${run.campaignId}/${run.runId}. Identify what could have made it better without erasing what worked; give one bounded counterfactual condition and the evidence that would decide it.`,
    });
  }
  if (selected.length === 0) return tasks;
  const cross = [
    [
      "cross_comparability",
      "Compare the five finalists. State which are comparable and refuse any pooled ranking across different conditions.",
    ],
    [
      "cross_vertical",
      "Identify the deepest completed build-adopt-measure-claim-climb vertical. Separate completed stages from starts and prose.",
    ],
    [
      "cross_difficulty",
      "Identify which finalist found a useful difficulty boundary. Treat a perfect or all-fail battery as saturation, not breadth.",
    ],
    [
      "cross_improvement",
      "Identify the strongest attributable improvement and every claim, provenance or promotion limit that remains.",
    ],
    [
      "cross_efficiency",
      "Compare learning that changed a decision against wall duration and censored cases. Keep provider and environment non-results separate from product failures.",
    ],
    [
      "cross_best_action",
      "Blindly challenge the proposed best overall, then define what should happen next: mechanisms to preserve, one limitation to target, and one falsifiable next condition. Prefer no unique winner when the evidence is split.",
    ],
  ];
  for (const [name, task] of cross) tasks.push({ name, runKey: null, task });
  return tasks;
}

export function admittedLunaPlan(selected, top = 5) {
  return selected.length === top ? buildLunaPlan(selected) : [];
}
