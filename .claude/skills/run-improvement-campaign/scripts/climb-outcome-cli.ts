#!/usr/bin/env bun

/**
 * The climb comparison's outcome, read from recorded campaigns and decided by the frozen rule in
 * `climb-outcome.ts`. It finds runs as the scoreboard does (`recordedRuns`, `readRunEvidence`): a
 * run whose opening names the control or the treatment source is in that arm, in the cell its
 * opening names (request digest, Builder model and effort), at its campaign's real path. Per
 * battery it reads the case rows through the strict reader and the case classifier, the task bytes
 * (`bytesOf`), the solve-wall share through `wri.ts walls` (`buildWalls`) and the follow-up through
 * `wri.ts climb` (`followUpOf`); per run, the rounds it opened (`roundStarts`); per campaign, the
 * seed its republish recorded (`seedBatteries`). It loads no model and writes nothing.
 */
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { CASE_RECORD_FILE, classifyCaseOutcome, readCaseRecord } from "#src/claim/case-record.ts";
import type { CaseRecordRow } from "#src/claim/case-record.ts";
import { campaignTraceRoots } from "#src/claim/trace-read.ts";
import { BATTERY_FILE } from "#src/correctness-bundle/battery-record.ts";
import { PUBLIC_TASK_FILE } from "#src/correctness-bundle/recorded-solve.ts";
import { existsSync, readdirSync, readFileSync, realpathSync } from "#src/meta/filesystem.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { join } from "#src/meta/path.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import {
  controllerRunOfBattery,
  isControllerBatteryRunId,
} from "#src/run/controller-battery-record-policy.ts";
import {
  type Bundle,
  appliesTo,
  loadBundle,
} from "../../whole-run-investigation/classifier/query-complexity.ts";
import {
  batteriesOf,
  followUpCounts,
  followUpOf,
} from "../../whole-run-investigation/scripts/climb-velocity.ts";
import { readJsonAsOrNull } from "../../whole-run-investigation/scripts/run-overview.ts";
import { buildWalls } from "../../whole-run-investigation/scripts/walls.ts";
import { SEED_MANIFEST } from "../../system-path-simulation/scripts/tool-tree.mts";
import { campaignRuns, mainCheckout, recordedRuns } from "#tools/runs/discover.ts";
import { readObservations, readRunEvidence } from "#tools/runs/evidence.ts";
import { roundStarts } from "#tools/runs/pulse-read.ts";
import {
  type ArmInput,
  type ArmReading,
  type Battery,
  type CellInput,
  type ClimbOutcome,
  type FailLabel,
  compareClimb,
  lineageKey,
  parseLabels,
} from "./climb-outcome.ts";

const USAGE = `usage: climb-outcome-cli.ts --control <sha> --treatment <sha> [--labels <path>] [--repo <abs checkout>] [--json]

The climb comparison of main (--control) against the pull request's head (--treatment), each the
source commit recorded runs opened on, or a prefix of it of at least 7 hex characters. --labels is
M2's file, one {"caseKey", "label"} per line; without it every verified fail is unlabelled and none
is valid. Prints the frozen rule's verdict with its pooled rounds, margin, difference and health
guard, each cell's pairing and seed, and per arm the counts that stand beside the rule.`;

type Side = "control" | "treatment";

/** One recorded run in one arm. */
interface ArmRun {
  runId: string;
  campaign: string;
  side: Side;
  cell: string;
  openedAt: string;
}

type CampaignReading = ReturnType<typeof readCampaign>;

/** What a republished campaign's seed (`seed-campaign.mts`, `SeedManifest`) left in it: the seed
 *  campaign's slug, the batteries `carryHistory` copied, which are the runs under the product its
 *  `seed.json` names that none of the campaign's own runs wrote, the count the record states, every
 *  task id those batteries measured and those they failed (`pass: false`, an unaccepted attempt
 *  included), which start the arm as failed. The tasks are read from the copies, so a seed campaign
 *  that has since moved or measured more changes nothing. The copies leave no case-record row, so
 *  the battery rule only matters where an arm continues the seed campaign itself. Null for a
 *  campaign with no republish record, which excludes nothing. */
export function seedRecord(campaign: string) {
  const record = readJsonAsOrNull<{
    mode?: unknown;
    slug?: unknown;
    selectedProductId?: unknown;
    carried?: { historyRuns?: unknown };
  }>(join(campaign, SEED_MANIFEST));
  if (record?.mode !== "republish" || !isString(record.selectedProductId)) return null;
  const runs = join(campaign, "versions", record.selectedProductId, "runs");
  const own = campaignRuns(campaign).map((run) => run.runId);
  const batteries = (existsSync(runs) ? readdirSync(runs) : [])
    .filter((runId) => !own.some((run) => isControllerBatteryRunId(run, runId)))
    .sort();
  const cases = batteries.flatMap(
    (runId) =>
      readJsonAsOrNull<{ cases?: { taskId?: unknown; pass?: unknown }[] }>(join(runs, runId, BATTERY_FILE))
        ?.cases ?? [],
  );
  const idsOf = (rows: typeof cases) =>
    [...new Set(rows.flatMap(({ taskId }) => (isString(taskId) ? [taskId] : [])))].sort();
  const carried = record.carried?.historyRuns;
  return {
    source: isString(record.slug) ? record.slug : null,
    batteries,
    carried: isNumber(carried) ? carried : null,
    tasks: idsOf(cases),
    failed: idsOf(cases.filter((row) => row.pass === false)),
  };
}

/** Every recorded run opened on either source, with its arm and cell. */
function armRuns(repo: string, control: string, treatment: string): ArmRun[] {
  return recordedRuns(repo).flatMap((location) => {
    const opening = readRunEvidence(location).opening;
    const commit = opening?.commit ?? "";
    const side = commit.startsWith(control) ? "control" : commit.startsWith(treatment) ? "treatment" : null;
    if (opening === null || side === null) return [];
    const builder = opening.slots.find((slot) => slot.role === "builder");
    const cell = `${opening.requestDigest ?? "?"} ${builder?.model ?? "?"}@${builder?.effort ?? "?"}`;
    const campaign = realpathSync(location.campaignDir);
    return [{ runId: location.runId, campaign, side, cell, openedAt: opening.writtenAt ?? "" }];
  });
}

/** The task's bytes: its recorded public task (id, family and public input) and, from the product
 *  tree that measured it, its own row, hidden expectations included, and every brief check that
 *  applies to its family. Null when either cannot be read. Hashed here and never printed. */
function bytesOf(bundle: Bundle | null, runDir: string, row: CaseRecordRow): string | null {
  const recorded = readJsonAsOrNull<{ publicTaskDigest?: unknown }>(
    join(runDir, "cases", row.taskId, PUBLIC_TASK_FILE),
  );
  if (bundle === null || !isString(recorded?.publicTaskDigest)) return null;
  return hashJsonValue({
    publicTask: recorded.publicTaskDigest,
    task: bundle.tasks.find((task) => task.taskId === row.taskId) ?? null,
    checks: (bundle.brief.truthChecks ?? []).filter((check) => appliesTo(check, row.family)),
  });
}

function loadedBundle(tree: string): Bundle | null {
  try {
    return loadBundle(tree);
  } catch {
    return null;
  }
}

/** What one campaign holds for the arms, read once however many of its runs they count. */
function readCampaign(campaign: string) {
  const rows = new Map<string, { first: number; rows: CaseRecordRow[] }>();
  for (const { seq, row } of readCaseRecord(join(campaign, CASE_RECORD_FILE))) {
    const battery = rows.get(row.runId) ?? { first: seq, rows: [] };
    battery.rows.push(row);
    rows.set(row.runId, battery);
  }
  // Read in `campaignTraceRoots` order, so a retained version, read last, names a battery's tree.
  const trees = new Map<string, string>();
  for (const root of campaignTraceRoots(campaign)) {
    const runs = join(root, "runs");
    for (const runId of existsSync(runs) ? readdirSync(runs) : []) trees.set(runId, root);
  }
  const walls = new Map(buildWalls({ campaign }).batteries.map((row) => [row.runId, row.time.median]));
  const versions = existsSync(join(campaign, "versions")) ? batteriesOf(campaign) : [];
  const followUps = new Map(
    versions.map((battery, at) => [
      battery.runId,
      followUpCounts([followUpOf(campaign, battery, versions[at + 1])]),
    ]),
  );
  const bundles = new Map<string, Bundle | null>();
  const bundleOf = (tree: string) => {
    if (!bundles.has(tree)) bundles.set(tree, loadedBundle(tree));
    return bundles.get(tree) ?? null;
  };
  /** One battery as the outcome reads it; a battery whose run directory no tree holds is its own
   *  task set, with its bytes unread. */
  const battery = (runId: string): Battery => {
    const tree = trees.get(runId);
    return {
      runId,
      tree: tree ?? join(campaign, "runs", runId),
      wallShare: walls.get(runId) ?? null,
      ...keyIfDefined("followUp", followUps.get(runId)),
      cases: (rows.get(runId)?.rows ?? []).map((row) => ({
        campaign,
        battery: runId,
        taskId: row.taskId,
        bytes: tree === undefined ? null : bytesOf(bundleOf(tree), join(tree, "runs", runId), row),
        outcome: classifyCaseOutcome(row),
        endedAt: row.solverEndedAt ?? null,
      })),
    };
  };
  return { rows, battery, seed: seedRecord(campaign) };
}

/** One arm's batteries in one cell, in measurement order: by run opening, then by case record. */
function armInput(runs: readonly ArmRun[], readingOf: (campaign: string) => CampaignReading): ArmInput {
  const batteries: Battery[] = [];
  const starts: string[] = [];
  const seedFailed = new Set<string>();
  for (const run of runs.toSorted((a, b) => a.openedAt.localeCompare(b.openedAt))) {
    const reading = readingOf(run.campaign);
    const owned = [...reading.rows].filter(([runId]) => controllerRunOfBattery(runId) === run.runId);
    for (const [runId] of owned.sort(([, a], [, b]) => a.first - b.first)) {
      batteries.push(reading.battery(runId));
    }
    starts.push(...roundStarts(readObservations(run.campaign, run.runId)));
    for (const taskId of reading.seed?.failed ?? []) seedFailed.add(lineageKey(run.campaign, taskId));
  }
  return { batteries, roundStarts: starts, seedFailed };
}

/** Each cell's two arms and the seed batteries its republished campaigns record, in either arm. */
function cellsOf(runs: readonly ArmRun[]) {
  const readings = new Map<string, CampaignReading>();
  const readingOf = (campaign: string) => {
    const known = readings.get(campaign) ?? readCampaign(campaign);
    readings.set(campaign, known);
    return known;
  };
  const cells: CellInput[] = [];
  const seeds = [];
  for (const [key, members] of Map.groupBy(runs, (run) => run.cell)) {
    const records = [...new Set(members.map((run) => run.campaign))].flatMap((campaign) => {
      const seed = readingOf(campaign).seed;
      return seed === null ? [] : [seed];
    });
    const seed = new Set(records.flatMap((record) => record.batteries));
    const side = (wanted: Side) =>
      armInput(
        members.filter((run) => run.side === wanted),
        readingOf,
      );
    cells.push({ key, seed, control: side("control"), treatment: side("treatment") });
    seeds.push({
      key,
      records: records.length,
      sources: [...new Set(records.flatMap((record) => record.source ?? []))],
      batteries: seed.size,
      tasks: new Set(records.flatMap((record) => record.tasks)).size,
      failed: new Set(records.flatMap((record) => record.failed)).size,
      mismatched: records.filter((record) => record.carried !== record.batteries.length).length,
    });
  }
  return { cells, seeds };
}

function armLines(name: string, arm: ArmReading): string[] {
  const { fresh, lineages, bytes, labels, rounds } = arm;
  const labelText = Object.entries(labels)
    .map(([label, count]) => `${label} ${count}`)
    .join(", ");
  const followUp =
    arm.followUp === null
      ? "none read"
      : Object.entries(arm.followUp)
          .map(([field, count]) => `${field} ${count}`)
          .join(", ");
  const wall = arm.wallShare === null ? "-" : `${(arm.wallShare * 100).toFixed(1)}%`;
  return [
    `  ${name}: ${arm.taskSets} task sets, ${rounds.started} rounds started by the last of them (${rounds.total} in all)`,
    `    fresh failures: ${fresh.failing}, ${fresh.valid} valid (${rounds.started === 0 ? "-" : (fresh.valid / rounds.started).toFixed(2)} per round started)`,
    `    lineages: ${lineages.measured} measured, ${lineages.failing} failing, ${lineages.failedAfterEdit} failed again after an edit`,
    `    by bytes: ${bytes.measured} measured, ${bytes.failing} failing; ${bytes.unread} cases' bytes unread`,
    `    failing lineages carrying each label: ${labelText}`,
    `    task sets holding a valid failure: ${arm.validSets}; median solve-wall share ${wall}; follow-up: ${followUp}`,
  ];
}

function render(
  outcome: ClimbOutcome,
  shas: { control: string; treatment: string },
  seeds: ReturnType<typeof cellsOf>["seeds"],
  labelled: string,
): string {
  const { rule } = outcome;
  const margin = rule.margin === null ? "censored below 12" : `margin ${rule.margin}`;
  const { guard } = rule;
  const lines = [
    `main ${shas.control} against head ${shas.treatment}: ${rule.verdict}`,
    `  pooled rounds ${rule.rounds} (${margin}); D = head valid fresh failures ${outcome.treatment.fresh.valid} - main's ${outcome.control.fresh.valid} = ${rule.difference}`,
    `  health guard (head): ${guard.state}, ${guard.defects} of ${guard.classified} classified fresh failures are check-defect or under-specified`,
    `  labels: ${labelled}`,
    "cells",
  ];
  for (const [at, cell] of outcome.cells.entries()) {
    const seed = seeds[at];
    const seedText =
      seed === undefined || seed.records === 0
        ? "no seed record, so nothing is left out as the seed"
        : `seed ${seed.sources.join(", ")}: ${seed.batteries} batteries, ${seed.tasks} task ids, ${seed.failed} failed, from ${seed.records} record(s); batteries left out of main ${cell.seedExcluded.control}, head ${cell.seedExcluded.treatment}${seed.mismatched === 0 ? "" : `; ${seed.mismatched} record(s) state another carried count`}`;
    lines.push(
      `  ${cell.key}: main reached ${cell.reached.control}, head ${cell.reached.treatment}, paired ${cell.paired}; ${seedText}`,
    );
  }
  lines.push("per arm, over the paired rounds");
  lines.push(...armLines("main", outcome.control), ...armLines("head", outcome.treatment));
  return lines.join("\n");
}

function climbOutcome(args: CommandArgs): void {
  const shas = { control: args.required("control"), treatment: args.required("treatment") };
  for (const sha of Object.values(shas)) {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) args.die(`${sha} is not a commit hex of at least 7 characters`);
  }
  if (shas.control.startsWith(shas.treatment) || shas.treatment.startsWith(shas.control)) {
    args.die("the control and treatment prefixes name the same commit");
  }
  const path = args.value("labels");
  const labels: ReadonlyMap<string, FailLabel> =
    path === null ? new Map() : parseLabels(readFileSync(path, "utf8"));
  const runs = armRuns(args.value("repo") ?? mainCheckout(import.meta.dir), shas.control, shas.treatment);
  const { cells, seeds } = cellsOf(runs);
  const outcome = compareClimb(cells, labels);
  if (args.flag("json")) {
    console.log(JSON.stringify({ shas, labels: path, seeds, ...outcome }, null, 2));
    return;
  }
  const labelled =
    path === null
      ? "none given, so every verified fail is unlabelled and none is valid"
      : `${labels.size} labelled cases from ${path}`;
  console.log(render(outcome, shas, seeds, labelled));
}

if (import.meta.main) {
  await runCommand(
    {
      name: "climb-outcome",
      usage: USAGE,
      options: { control: "text", treatment: "text", labels: "abs", repo: "abs", json: "flag", help: "flag" },
    },
    climbOutcome,
  );
}
