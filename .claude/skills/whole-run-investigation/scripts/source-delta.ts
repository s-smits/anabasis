#!/usr/bin/env bun
// Source-delta reach (lane 21, deterministic half). Diff the measured source of this run against
// the measured source of the previous run in the same lane, list the changed files, and join the
// safeguard ids declared in changed source files to the run's SAFEGUARDS_LOG: fired, or declared
// in a changed file without a matching recorded firing (labelled unreached). A changed model-visible text (author prompts,
// starters, judge framing) is flagged for lane 21.
//
// Reads Git objects and recorded campaign text only; never executes reviewed source and prints
// no source content. A commit the checkout cannot resolve is `source-unresolved`, never guessed.
//
//   bun wri.ts delta <target> [--repo <measured checkout>] [--previous <commit | abs campaign dir>]
//     [--json] [--out <abs file>]
//
// Without --previous the script picks the newest sibling campaign of the same lane (same
// directory name minus its numeric suffix) whose opening was written earlier, and says so.

import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { gitMaybe, gitText } from "#skills/main/git.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { parseSafeguardLog, safeguardLogFile } from "#src/meta/safeguard.ts";
import { isControllerBatteryRunId } from "#src/run/controller-battery-record-policy.ts";
import { campaignRuns, latestRun } from "#tools/runs/discover.ts";
import { jsonText } from "./run-overview.ts";

interface FoundOpening {
  runId: string;
  opening: JsonValue | null;
}

/** An earlier campaign of the same lane and the source commit its opening recorded. */
export interface PreviousCampaign {
  dir: string;
  at: string;
  commit: JsonValue;
}

/** What `buildSourceDelta` reads: `previous` is an earlier campaign directory or a revision; absent,
 *  the newest earlier campaign of the same lane supplies it. */
export interface SourceDeltaInput {
  campaign: string;
  runId?: string | null;
  repo: string | null;
  previous?: string | null;
}

/** One changed path, with the safeguard ids its source declares now and how they moved. */
export interface ChangedPath {
  path: string;
  change: string;
  safeguardIds: string[];
  newSafeguardIds?: string[];
  removedSafeguardIds?: string[];
}

/** A safeguard declared in a changed file, and whether the run's log recorded it firing. */
export interface SafeguardReach {
  id: string;
  state: string;
  firings: number;
}

/** The source delta of one run against the previous source. */
export interface SourceDelta {
  schema: string;
  campaign: string;
  runId: string;
  commit: string;
  previousCommit: JsonValue;
  previousProvenance: string;
  state: string;
  reason?: string;
  changed: ChangedPath[];
  safeguards: SafeguardReach[];
  firedElsewhere: { id: string; firings: number }[];
  modelVisibleChanged: string[];
}

const GIT_SHA = /^[0-9a-f]{40}$/;
const SAFEGUARD_CALL = /safeguardTriggered\s*\(\s*["'`]([^"'`]+)["'`]/g;
/** Broad path heuristic for possible model-visible changes; verify delivery before making a claim.
 *  The Judge's files moved from src/truth to src/review, and a recorded run may sit on either side. */
const MODEL_VISIBLE = [
  /^src\/author\//,
  /^src\/builder\//,
  /^starters\//,
  /prompt/i,
  /^src\/(truth|review)\/judge/,
];

/** Git's name-status letter for the change a path underwent; anything else is a modification. */
const CHANGE_BY_STATUS = new Map([
  ["A", "added"],
  ["D", "deleted"],
  ["R", "renamed"],
]);

/** `Array.prototype.sort`'s own default order, spelled out: both entries compared as strings. */
function byDefaultOrder(left: readonly [string, number], right: readonly [string, number]): number {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function commitExists(repo: string, commit: string): boolean {
  return gitMaybe(repo, "cat-file", "-e", `${commit}^{commit}`) !== null;
}

/** The named run's opening, or the campaign's latest by opening instant when none is named. */
function openingOf(campaign: string, runId: string | null): FoundOpening | null {
  const chosen =
    runId === null ? latestRun(campaign) : campaignRuns(campaign).find((run) => run.runId === runId);
  return chosen === undefined || chosen === null
    ? null
    : { runId: chosen.runId, opening: readJsonFileOrNull(chosen.openingPath) };
}

/** The recorded `source.commit` of an opening, null when any step is missing. */
function sourceCommitOf(opening: JsonValue | null | undefined): JsonValue {
  return asRecord(asRecord(opening)?.source)?.commit ?? null;
}

function laneKey(campaign: string): string {
  return basename(campaign).replace(/-\d+$/, "");
}

/** The newest sibling campaign of the same lane opened before this run. */
export function previousCampaign(
  campaign: string,
  writtenAt: JsonValue | undefined,
): PreviousCampaign | null {
  const parent = dirname(campaign);
  const lane = laneKey(campaign);
  const candidates: PreviousCampaign[] = [];
  for (const name of existsSync(parent) ? readdirSync(parent) : []) {
    const dir = join(parent, name);
    if (dir === campaign || laneKey(dir) !== lane) continue;
    const found = openingOf(dir, null);
    const at = asRecord(found?.opening)?.writtenAt;
    if (!isString(at) || (isString(writtenAt) && at >= writtenAt)) continue;
    candidates.push({ dir, at, commit: sourceCommitOf(found?.opening) });
  }
  candidates.sort((left, right) => (left.at < right.at ? 1 : -1));
  return candidates[0] ?? null;
}

function safeguardIds(repo: string, commit: string, path: string): Set<string> {
  const text = gitMaybe(repo, "show", `${commit}:${path}`);
  if (text === null) return new Set();
  return new Set([...text.matchAll(SAFEGUARD_CALL)].map((match) => match[1] ?? ""));
}

export function firedSafeguards(campaign: string, runId: string): Map<string, number> {
  const fired = new Map<string, number>();
  const root = join(campaign, "safeguards");
  if (!existsSync(root)) return fired;
  for (const name of readdirSync(root)) {
    if (!isControllerBatteryRunId(runId, name)) continue;
    const log = safeguardLogFile(campaign, name);
    if (!existsSync(log)) continue;
    for (const [id, count] of parseSafeguardLog(readFileSync(log, "utf8")).counts) {
      fired.set(id, (fired.get(id) ?? 0) + count);
    }
  }
  return fired;
}

export function buildSourceDelta(named: SourceDeltaInput): SourceDelta {
  const { runId, previous = null } = named;
  const campaign = resolve(named.campaign);
  if (named.repo === null) throw new Error("repo is null; the source delta needs the measured checkout");
  const repo = resolve(named.repo);
  const found = openingOf(campaign, runId ?? null);
  if (found === null) throw new Error(`no controller opening for ${runId ?? "any run"} under ${campaign}`);
  const commit = sourceCommitOf(found.opening);
  if (!isString(commit) || !GIT_SHA.test(commit)) {
    throw new Error(`opening for ${found.runId} records no full source commit`);
  }
  const opening: JsonObject | null = asRecord(found.opening);
  let previousCommit: JsonValue = null;
  let previousProvenance: string;
  if (previous === null) {
    const sibling = previousCampaign(campaign, opening?.writtenAt ?? null);
    if (sibling === null) {
      previousProvenance = `no earlier campaign of lane ${laneKey(campaign)} beside ${campaign}`;
    } else {
      previousCommit = sibling.commit;
      previousProvenance = `newest earlier campaign of lane ${laneKey(campaign)}: ${basename(sibling.dir)} (opened ${sibling.at})`;
    }
  } else if (existsSync(join(previous, "controller"))) {
    const older = openingOf(resolve(previous), null);
    previousCommit = sourceCommitOf(older?.opening);
    previousProvenance = `campaign ${basename(resolve(previous))}`;
  } else {
    previousCommit = previous;
    previousProvenance = "operator-named revision";
  }
  const result: SourceDelta = {
    schema: "wri-source-delta/v1",
    campaign,
    runId: found.runId,
    commit,
    previousCommit,
    previousProvenance,
    state: "resolved",
    changed: [],
    safeguards: [],
    firedElsewhere: [],
    modelVisibleChanged: [],
  };
  if (!commitExists(repo, commit)) {
    result.state = "source-unresolved";
    result.reason = `${repo} has no commit ${commit}`;
    return result;
  }
  if (!isString(previousCommit) || !GIT_SHA.test(previousCommit)) {
    result.state = "previous-unresolved";
    result.reason = previousProvenance;
    return result;
  }
  if (!commitExists(repo, previousCommit)) {
    result.state = "previous-unresolved";
    result.reason = `${repo} has no commit ${previousCommit}`;
    return result;
  }
  if (previousCommit === commit) {
    result.state = "identical-source";
    return result;
  }
  const status = gitText(repo, "diff", "--name-status", `${previousCommit}..${commit}`);
  const fired = firedSafeguards(campaign, found.runId);
  const declaredInChanged = new Set<string>();
  for (const line of status.split("\n").filter((row) => row.length > 0)) {
    const [code = "", ...paths] = line.split("\t");
    const path = paths.at(-1);
    if (path === undefined) throw new Error(`name-status line ${JSON.stringify(line)} names no path`);
    const change = CHANGE_BY_STATUS.get(code.charAt(0)) ?? "modified";
    const entry: ChangedPath = { path, change, safeguardIds: [] };
    if (/\.(?:ts|mts|js|mjs)$/.test(path) && change !== "deleted") {
      const now = safeguardIds(repo, commit, path);
      const before = change === "added" ? new Set<string>() : safeguardIds(repo, previousCommit, path);
      entry.safeguardIds = [...now].sort();
      entry.newSafeguardIds = [...now].filter((id) => !before.has(id)).sort();
      entry.removedSafeguardIds = [...before].filter((id) => !now.has(id)).sort();
      for (const id of now) declaredInChanged.add(id);
    }
    if (MODEL_VISIBLE.some((pattern) => pattern.test(path))) result.modelVisibleChanged.push(path);
    result.changed.push(entry);
  }
  for (const id of [...declaredInChanged].sort()) {
    const count = fired.get(id) ?? 0;
    result.safeguards.push({ id, state: count > 0 ? "fired" : "unreached", firings: count });
  }
  for (const [id, count] of [...fired.entries()].sort(byDefaultOrder)) {
    if (!declaredInChanged.has(id)) result.firedElsewhere.push({ id, firings: count });
  }
  return result;
}

export function renderSourceDelta(delta: SourceDelta): string {
  const lines = [`# source delta — ${basename(delta.campaign)} / ${delta.runId}`, ""];
  lines.push(`this source: ${delta.commit}`);
  lines.push(
    `previous source: ${jsonText(delta.previousCommit ?? "unresolved")} (${delta.previousProvenance})`,
  );
  lines.push(
    `state: ${delta.state}${delta.reason !== undefined && delta.reason !== "" ? ` — ${delta.reason}` : ""}`,
  );
  if (delta.state !== "resolved") return `${lines.join("\n")}\n`;
  const byTop = new Map<string, number>();
  for (const entry of delta.changed) {
    const top = entry.path.split("/")[0] ?? "";
    byTop.set(top, (byTop.get(top) ?? 0) + 1);
  }
  lines.push(
    "",
    `## changed files: ${delta.changed.length} (${[...byTop.entries()].map(([top, count]) => `${top} ${count}`).join(", ") || "none"})`,
  );
  for (const entry of delta.changed) {
    const ids = entry.safeguardIds.length > 0 ? ` · safeguards {${entry.safeguardIds.join(",")}}` : "";
    const fresh =
      entry.newSafeguardIds !== undefined && entry.newSafeguardIds.length > 0
        ? ` · new {${entry.newSafeguardIds.join(",")}}`
        : "";
    const gone =
      entry.removedSafeguardIds !== undefined && entry.removedSafeguardIds.length > 0
        ? ` · removed {${entry.removedSafeguardIds.join(",")}}`
        : "";
    lines.push(`${entry.change.padEnd(9)}${entry.path}${ids}${fresh}${gone}`);
  }
  lines.push("", "## safeguard reach in changed files");
  if (delta.safeguards.length === 0) lines.push("no safeguard declared in a changed file");
  for (const row of delta.safeguards) {
    lines.push(`${row.id}: ${row.state}${row.firings > 0 ? ` ×${row.firings}` : ""}`);
  }
  const unreached = delta.safeguards.filter((row) => row.state === "unreached");
  if (unreached.length > 0) {
    lines.push(
      `UNREACHED CHANGED SAFEGUARDS (lane 21): ${unreached.map((row) => row.id).join(", ")} — the change was present; no matching firing was found in the selected run logs`,
    );
  }
  if (delta.firedElsewhere.length > 0) {
    lines.push(
      `fired outside changed files: ${delta.firedElsewhere.map((row) => `${row.id} ×${row.firings}`).join(", ")}`,
    );
  }
  if (delta.modelVisibleChanged.length > 0) {
    lines.push("", `MODEL-VISIBLE SURFACE CHANGED (lane 21): ${delta.modelVisibleChanged.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}
