// How fast a campaign's batteries are actually getting harder, read from the task bytes rather
// than from the score. The controller can only steer on a measured pass rate, so a battery the
// provider wrecked tells it nothing and it re-decides on the last battery that scored — on this
// campaign, seven consecutive "24/25, significantly too easy, climb" decisions all citing the same
// 2026-09-16 battery. This reads the other channel: whether the tasks moved, by how much, and in
// which of the two ways a battery can move.
//
//   bun climb-velocity.mjs <campaign-dir> [--json]
//
// Per battery: the tier histogram and the median structural row from query-complexity.mjs, plus
// the measured outcome when there is one. Per edge between consecutive batteries:
//
//   restated      the prose did not move and neither did the structure
//   adjusted      the same checks at the same tier, with the published numbers moved
//   narrowed      fewer checks, fewer coupled inputs or fewer scenarios, at the same tier
//   widened       more checks, more coupled inputs or more scenarios, at the same tier
//   eased         the checks moved down the tier order
//   escalated     the checks moved up the tier order
//
// Every verdict but `adjusted` names its direction. `adjusted` does not: `numericDriftOf` measures
// distance and not direction, because a boundary states which way is tighter and most declare none.
// Moving a limit is a real climb when it moves inward, and this reader cannot tell you that it did.
// A battery that dropped checks or fell down the tier order read as `adjusted` until 2026-09-18,
// which named a retreat with the one word that says nothing. Only `escalated` changes what the
// solver has to reason about, and it reads the highest tier a battery's checks reach, so adding two
// more checks at a tier it already occupies is `widened`. That top tier is the one reading immune to
// the count: a rank-weighted total rises whenever a battery simply holds more checks, and the mean
// that replaced it falls when a check is added below it and rises when one is removed, so a wider
// battery read `eased` and a shorter one `escalated`. The cost of reading the top alone is a battery
// that moved ten checks from easy to hard under an existing frontier check: that escalation is real
// and this reader calls it `widened`.
// An edge whose later battery verified no case is `unobservable` on the outcome side and still
// readable on both task-side rows, which is the point.
//
// Both task-side rows read `brief.json` and `tasks.json` alone, so a rule the Builder published in
// another correctness-model file moves neither. A third row names which of those files changed
// digest, without scoring them: a digest cannot tell a new requirement from a reformatted comment,
// and the verdict deliberately does not read it.
import { existsSync, readFileSync, readdirSync } from "#src/meta/filesystem.ts";
import { sha256OfFile } from "#src/meta/digest.ts";
import { classifyCaseOutcome } from "#src/claim/case-record.ts";
import { wilsonInterval } from "#src/claim/estimation.ts";
import {
  MODEL_IDENTITY,
  STRUCTURE_KEYS,
  TIER_ORDER,
  readVersionDir,
  renderBattery,
} from "../classifier/query-complexity.mjs";
import { isBoolean, isNumber } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

export const VELOCITY_SCHEMA = "climb-velocity/v1";
/** Cosine at or above this between a family's prose and its nearest predecessor reads as the same
 *  problem restated. bge-small puts genuinely reworded-but-equivalent prose well above this. */
export const RESTATED_COSINE = 0.98;

/** The two files the task-side rows already read, and so the two this digest row leaves alone. */
export const SCORED_BUNDLE_FILES = new Set(["brief.json", "tasks.json"]);

/** The controller's own interval over the verified cases, so this reader and the placement it sets
 *  out to explain cannot disagree. It carried its own copy at a rounded z of 1.96 until 2026-09-18,
 *  which is a second answer to the question this script exists to report on. Null is that owner's
 *  "not a sample": nothing verified, or counts that cannot be one. */
export function wilson(passes, n) {
  const interval = wilsonInterval(passes, n);
  return interval === null ? null : { rate: passes / n, lo: interval.lower, hi: interval.upper };
}

/** Passed, verified, unaccepted and non-result counts per runId, from the campaign's own case rows,
 *  classified by the controller's own reader. An unaccepted attempt is recorded with `pass: false`,
 *  so reading `pass` alone counts every case the solver never submitted as a verified failure and
 *  then places a battery that verified nothing. */
export function outcomesOf(campaign) {
  const path = `${campaign}/case-record.jsonl`;
  const byRun = new Map();
  if (!existsSync(path)) return byRun;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line).row ?? {};
    const counts = byRun.get(row.runId) ?? { passed: 0, verified: 0, unaccepted: 0, nonResult: 0 };
    const outcome = classifyCaseOutcome({
      // A row that predates the field carries a verdict; this script reads recorded history.
      // `=== true` instead counted every pre-field case as an attempt nobody submitted.
      acceptedSubmit: isBoolean(row.acceptedSubmit) ? row.acceptedSubmit : true,
      pass: row.pass ?? null,
      runtimeNonResult: row.runtimeNonResult ?? null,
    });
    if (outcome === "pass" || outcome === "fail") counts.verified += 1;
    if (outcome === "pass") counts.passed += 1;
    if (outcome === "unaccepted") counts.unaccepted += 1;
    if (outcome === "non-result") counts.nonResult += 1;
    byRun.set(row.runId, counts);
  }
  return byRun;
}

/** Batteries in the order they were measured. A claim's `createdAt` owns chronology; a version with
 *  no claim keeps its directory's recorded time and is marked, because an unclaimed battery is
 *  exactly the case this reader exists for. */
export function batteriesOf(campaign) {
  const versions = readdirSync(`${campaign}/versions`, { withFileTypes: true });
  const rows = [];
  for (const entry of versions) {
    if (!entry.isDirectory()) continue;
    const dir = `${campaign}/versions/${entry.name}`;
    if (!existsSync(`${dir}/correctness-model/tasks.json`)) continue;
    const claimPath = `${campaign}/claims/${entry.name}.json`;
    const claimed = existsSync(claimPath);
    const createdAt = claimed
      ? readJsonFile(claimPath).createdAt
      : existsSync(`${dir}/version.json`)
        ? readJsonFile(`${dir}/version.json`).createdAt
        : null;
    rows.push({ runId: entry.name, dir, createdAt, claimed });
  }
  rows.sort(
    (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.runId.localeCompare(b.runId),
  );
  return rows;
}

/** Every other correctness-model file, with its digest. `noveltyOf` scores the check assertions in
 *  `brief.json`; the structural deltas count what `tasks.json` declares. A requirement published
 *  anywhere else is invisible to both: on the de8b40 to -i02 edge the Builder added
 *  `minMemberJointClearanceM` with a `pointSegmentDistance` helper to `rules.ts` under an existing
 *  check, leaving `evaluator.ts` byte-identical, and the edge read `novelty 0.0000 ... rules +0` —
 *  which says the battery was renumbered. */
export function correctnessDigests(dir) {
  const digests = new Map();
  const walk = (at, prefix) => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(`${at}/${entry.name}`, name);
      else if (!SCORED_BUNDLE_FILES.has(name)) digests.set(name, sha256OfFile(`${at}/${entry.name}`));
    }
  };
  walk(`${dir}/correctness-model`, "");
  return digests;
}

/** Which of those files moved between two batteries. Names only; this row does not score what the
 *  change means, because a digest cannot separate a new requirement from a reformatted comment. */
export function sourceMovesOf(beforeDir, afterDir) {
  const earlier = correctnessDigests(beforeDir);
  const later = correctnessDigests(afterDir);
  if (earlier.size === 0 && later.size === 0) return null;
  const changed = [];
  const added = [];
  let unchanged = 0;
  for (const [name, digest] of [...later].sort(([a], [b]) => a.localeCompare(b))) {
    if (!earlier.has(name)) added.push(name);
    else if (earlier.get(name) === digest) {
      unchanged += 1;
    } else {
      changed.push(name);
    }
  }
  const removed = [...earlier.keys()].filter((name) => !later.has(name)).sort();
  return { changed, added, removed, unchanged, read: later.size };
}

/** Each check assertion in the later battery against its nearest predecessor: 1 means nothing like
 *  it came before, 0 means the same sentence. Reported as the mean over the later battery's units,
 *  so one new check among ten unchanged ones does not read as a whole new battery. It reads
 *  `brief.json` alone; `sourceMovesOf` owns the rest of the correctness model. */
function noveltyOf(before, after) {
  const earlier = Object.values(before.familyVectors).flat();
  const later = Object.values(after.familyVectors).flat();
  if (earlier.length === 0 || later.length === 0) return null;
  let total = 0;
  for (const vector of later) {
    total += Math.max(
      0,
      1 -
        Math.max(
          ...earlier.map((other) => vector.reduce((sum, value, index) => sum + value * other[index], 0)),
        ),
    );
  }
  return { mean: total / later.length, units: later.length };
}

/** How far the published numbers moved between two batteries, over the public inputs that the same
 *  task carries in both. Direction is deliberately absent: a boundary states which way is tighter
 *  and most do not declare one, so this answers "did the numbers move" and the check-tier histogram
 *  answers whether anything new has to be reasoned about. */
export function numericDriftOf(before, after) {
  const earlier = new Map(before.rows.map((row) => [row.taskId, row]));
  const changes = [];
  for (const row of after.rows) {
    const previous = earlier.get(row.taskId);
    if (previous === undefined) continue;
    for (const [path, value] of Object.entries(row.numerics)) {
      const was = previous.numerics[path];
      if (!isNumber(was) || was === 0 || value === was) continue;
      changes.push(Math.abs(value - was) / Math.abs(was));
    }
  }
  if (changes.length === 0) return { median: 0, moved: 0 };
  changes.sort((a, b) => a - b);
  return { median: changes[Math.floor(changes.length / 2)], moved: changes.length };
}

/** The rank of the highest tier a battery's checks reach. Adding or dropping checks at tiers it
 *  already occupies leaves it where it was, which is the whole point: the count is read by the
 *  structural deltas, and the tier order by this. Null when a battery declares no check. */
export function topTierOf(checkTiers) {
  let top = null;
  TIER_ORDER.forEach((name, rank) => {
    if (checkTiers[name] > 0) top = rank;
  });
  return top;
}

/** Which of the six ways the battery moved, named from the tier order first and the structural
 *  counts second. Exported so the directions can be read off literal readings. */
export function verdictOf(before, after, novelty, delta, drift) {
  const was = topTierOf(before.checkTiers);
  const now = topTierOf(after.checkTiers);
  if (was !== null && now !== null && now !== was) return now > was ? "escalated" : "eased";
  if (delta.checks > 0 || delta.coupled > 0 || delta.scenarios > 0) return "widened";
  if (delta.checks < 0 || delta.coupled < 0 || delta.scenarios < 0) return "narrowed";
  const restatedProse = novelty === null || novelty.mean <= 1 - RESTATED_COSINE;
  if (restatedProse && drift.moved === 0 && STRUCTURE_KEYS.every((key) => delta[key] === 0)) {
    return "restated";
  }
  return "adjusted";
}

export async function readCampaign(campaign, options = {}) {
  const outcomes = outcomesOf(campaign);
  const batteries = [];
  for (const battery of batteriesOf(campaign)) {
    const reading = await readVersionDir(battery.dir, options);
    const counts = outcomes.get(battery.runId) ?? { passed: 0, verified: 0, unaccepted: 0, nonResult: 0 };
    // Only verified cases enter a rate, so a battery whose solver submitted nothing has no
    // placement at all rather than a zero one.
    batteries.push({ ...battery, reading, counts, placement: wilson(counts.passed, counts.verified) });
  }
  const edges = [];
  for (let at = 1; at < batteries.length; at += 1) {
    const before = batteries[at - 1];
    const after = batteries[at];
    const delta = {};
    for (const key of STRUCTURE_KEYS) {
      delta[key] = after.reading.medians[key] - before.reading.medians[key];
    }
    const novelty = noveltyOf(before.reading, after.reading);
    const drift = numericDriftOf(before.reading, after.reading);
    edges.push({
      from: before.runId,
      to: after.runId,
      verdict: verdictOf(before.reading, after.reading, novelty, delta, drift),
      novelty,
      drift,
      delta,
      source: sourceMovesOf(before.dir, after.dir),
      outcome:
        after.counts.verified === 0
          ? "unobservable"
          : { passed: after.counts.passed, verified: after.counts.verified, placement: after.placement },
    });
  }
  return { schema: VELOCITY_SCHEMA, campaign, model: MODEL_IDENTITY, batteries, edges };
}

/** Batteries still needed to reach the aim, from the measured rate change per edge. Returns a
 *  reason instead of a number whenever two verified batteries do not exist to draw a rate from —
 *  which is the usual case, and saying so is the honest answer. */
export function velocityOf(report, band = [0.2, 0.5]) {
  const placed = [];
  for (const battery of report.batteries) if (battery.counts.verified > 0) placed.push(battery);
  if (placed.length === 0) return { reason: "no battery verified a case" };
  const latest = placed.at(-1);
  if (latest.placement.rate <= band[1]) {
    return { reason: "the latest verified battery is inside or below the band", rate: latest.placement.rate };
  }
  if (placed.length === 1) {
    return {
      reason: "one verified battery: a rate change needs two",
      rate: latest.placement.rate,
      toBand: latest.placement.rate - band[1],
    };
  }
  const first = placed[0];
  const perBattery = (latest.placement.rate - first.placement.rate) / (placed.length - 1);
  if (perBattery >= 0) {
    return {
      reason: "the measured rate has not fallen across the verified batteries",
      perBattery,
      rate: latest.placement.rate,
    };
  }
  return {
    perBattery,
    rate: latest.placement.rate,
    batteriesToBand: Math.ceil((latest.placement.rate - band[1]) / -perBattery),
  };
}

/** The newest edge as the sentence a reader opened this for. The rows above it are the evidence;
 *  this is the reading, and it is the one the velocity line cannot give, because a rate needs two
 *  measured batteries and this needs none.
 *
 *  Both task-side rows come from the authored bytes under `versions/`, so the newest edge is
 *  readable the moment a candidate is adopted and before its first solve is paid for. Campaign
 *  3fd52f9e-10 read `widened` and then `adjusted` on its second and third rounds, each of which
 *  then spent about four hours of solves to confirm a 6 of 6 that settled nothing; both verdicts
 *  existed in the adopted bytes hours earlier. */
function latestEdgeLine(report) {
  const edge = report.edges.at(-1);
  if (edge === undefined) return "  latest edge: none, because an edge needs two batteries";
  const reading =
    edge.verdict === "escalated"
      ? "the checks reached a higher tier, so this battery can find a limit the last one missed"
      : edge.verdict === "eased"
        ? "the checks fell down the tier order, so this battery asks for less than the last one"
        : "the checks held their tier, so this battery asks the solver for nothing the last one did not";
  return `  latest edge: ${edge.from} -> ${edge.to} ${edge.verdict} — ${reading}`;
}

export function render(report, band) {
  const lines = [`${report.batteries.length} batteries in ${report.campaign}`];
  for (const battery of report.batteries) {
    const outcome =
      battery.counts.verified === 0
        ? "no verified case"
        : `${battery.counts.passed}/${battery.counts.verified} passed`;
    lines.push(`  ${battery.createdAt ?? "undated"}  ${battery.runId}`);
    lines.push(
      `      ${outcome}, ${battery.counts.unaccepted} unaccepted, ${battery.counts.nonResult} non-result${battery.claimed ? "" : ", unclaimed"}`,
    );
    // The whole battery reading, rendered by the module that produced it: this block carried its own
    // copy of the check and median lines and dropped the family histogram, which was the only thing
    // a second lane over the same campaign still added.
    lines.push(
      ...renderBattery(battery.reading)
        .split("\n")
        .map((line) => `      ${line}`),
    );
  }
  for (const edge of report.edges) {
    lines.push(`  ${edge.from} -> ${edge.to}: ${edge.verdict}`);
    lines.push(
      `      novelty ${edge.novelty === null ? "n/a" : edge.novelty.mean.toFixed(4)}   numbers moved ${edge.drift.moved} by ${(edge.drift.median * 100).toFixed(2)}% median`,
    );
    lines.push(
      `      delta ${STRUCTURE_KEYS.map((key) => `${key} ${edge.delta[key] >= 0 ? "+" : ""}${edge.delta[key]}`).join("  ")}`,
    );
    if (edge.source !== null) {
      const moved = [
        ...edge.source.changed,
        ...edge.source.added.map((name) => `${name} (new)`),
        ...edge.source.removed.map((name) => `${name} (gone)`),
      ];
      lines.push(
        `      correctness-model source, digests only, unread by the two rows above: ${moved.length === 0 ? "no file moved" : `${moved.join(", ")} moved`}, ${edge.source.unchanged} of ${edge.source.read} unchanged`,
      );
    }
    lines.push(
      `      outcome ${edge.outcome === "unobservable" ? "unobservable" : `${edge.outcome.passed}/${edge.outcome.verified}`}`,
    );
  }
  const velocity = velocityOf(report, band);
  lines.push(
    velocity.batteriesToBand === undefined
      ? `  velocity: ${velocity.reason}`
      : `  velocity: ${(velocity.perBattery * 100).toFixed(1)} points per battery; ${velocity.batteriesToBand} more at this rate to reach the band`,
  );
  lines.push(latestEdgeLine(report));
  return lines.join("\n");
}

if (import.meta.main) {
  const rest = Bun.argv.slice(2);
  // The campaign is the first argument that is not a flag, so `--campaign <dir>` and `--json <dir>`
  // reach the same reader as the bare directory. Spelled positionally alone, `--campaign <dir>`
  // read the flag as the campaign and died inside `readdirSync` with `ENOENT: scandir
  // '--campaign/versions'`, which names neither the argument nor the usage.
  const campaign = rest.find((argument) => !argument.startsWith("-"));
  if (campaign === undefined) throw new Error("usage: bun climb-velocity.mjs <campaign-dir> [--json]");
  const report = await readCampaign(campaign);
  if (rest.includes("--json")) {
    const printable = {
      ...report,
      batteries: report.batteries.map((battery) => ({
        ...battery,
        reading: { ...battery.reading, familyVectors: undefined },
      })),
    };
    console.log(JSON.stringify({ ...printable, velocity: velocityOf(report) }, null, 1));
  } else console.log(render(report));
}
