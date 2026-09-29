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
/** A file whose safeguard calls the run can reach. */
const SAFEGUARD_SOURCE = /\.(?:ts|mts|js|mjs)$/;
/** A test calls safeguardTriggered with fixture ids and template placeholders that no run fires,
 *  so its calls are not declarations; the path still counts as changed. */
const TEST_SOURCE = /^test\/|\.test\.[cm]?[jt]s$/;
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

/** The newest sibling campaign of the same lane opened before this run on another source commit.
 *  Several campaigns of one lane often launch from one commit, and the nearest of them by launch
 *  time would read as an identical source, which says nothing about what changed since the lane
 *  last measured a different tree. */
export function previousCampaign(
  campaign: string,
  writtenAt: JsonValue | undefined,
  commit: string,
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
    const earlier = sourceCommitOf(found?.opening);
    if (earlier !== commit) candidates.push({ dir, at, commit: earlier });
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

/** The commit this run is compared against and where it came from: the operator's campaign or
 *  revision when named, otherwise the lane's nearest earlier campaign on another source. */
function previousSource(
  campaign: string,
  previous: string | null,
  writtenAt: JsonValue,
  commit: string,
): Pick<SourceDelta, "previousCommit" | "previousProvenance"> {
  if (previous !== null && existsSync(join(previous, "controller"))) {
    const older = openingOf(resolve(previous), null);
    return {
      previousCommit: sourceCommitOf(older?.opening),
      previousProvenance: `campaign ${basename(resolve(previous))}`,
    };
  }
  if (previous !== null) return { previousCommit: previous, previousProvenance: "operator-named revision" };
  const sibling = previousCampaign(campaign, writtenAt, commit);
  if (sibling === null) {
    return {
      previousCommit: null,
      previousProvenance: `no earlier campaign of lane ${laneKey(campaign)} on another source beside ${campaign}`,
    };
  }
  return {
    previousCommit: sibling.commit,
    previousProvenance: `newest earlier campaign of lane ${laneKey(campaign)} on another source: ${basename(sibling.dir)} (opened ${sibling.at})`,
  };
}

/** One `--name-status` line as a changed path, with the safeguard ids a run-reachable source
 *  file declares at each side. */
function changedPath(repo: string, previousCommit: string, commit: string, line: string): ChangedPath {
  const [code = "", ...paths] = line.split("\t");
  const path = paths.at(-1);
  if (path === undefined) throw new Error(`name-status line ${JSON.stringify(line)} names no path`);
  const change = CHANGE_BY_STATUS.get(code.charAt(0)) ?? "modified";
  const entry: ChangedPath = { path, change, safeguardIds: [] };
  if (!SAFEGUARD_SOURCE.test(path) || TEST_SOURCE.test(path) || change === "deleted") return entry;
  const now = safeguardIds(repo, commit, path);
  const before = change === "added" ? new Set<string>() : safeguardIds(repo, previousCommit, path);
  entry.safeguardIds = [...now].sort();
  entry.newSafeguardIds = [...now].filter((id) => !before.has(id)).sort();
  entry.removedSafeguardIds = [...before].filter((id) => !now.has(id)).sort();
  return entry;
}

/** Why the delta cannot be read, when a commit is missing or both sides are one commit. */
function unresolved(
  repo: string,
  commit: string,
  previousCommit: string | null,
  previousProvenance: string,
): Pick<SourceDelta, "state" | "reason"> | null {
  if (!commitExists(repo, commit)) {
    return { state: "source-unresolved", reason: `${repo} has no commit ${commit}` };
  }
  if (previousCommit === null) return { state: "previous-unresolved", reason: previousProvenance };
  if (!commitExists(repo, previousCommit)) {
    return { state: "previous-unresolved", reason: `${repo} has no commit ${previousCommit}` };
  }
  return previousCommit === commit ? { state: "identical-source" } : null;
}

/** Each safeguard a changed file declares, fired or unreached in this run, and each one the run
 *  fired that no changed file declares. */
function addReach(
  result: SourceDelta,
  declared: ReadonlySet<string>,
  fired: ReadonlyMap<string, number>,
): void {
  for (const id of [...declared].sort()) {
    const count = fired.get(id) ?? 0;
    result.safeguards.push({ id, state: count > 0 ? "fired" : "unreached", firings: count });
  }
  for (const [id, count] of [...fired.entries()].sort(byDefaultOrder)) {
    if (!declared.has(id)) result.firedElsewhere.push({ id, firings: count });
  }
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
  const { previousCommit, previousProvenance } = previousSource(
    campaign,
    previous,
    opening?.writtenAt ?? null,
    commit,
  );
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
  const previousSha = isString(previousCommit) && GIT_SHA.test(previousCommit) ? previousCommit : null;
  const settled = unresolved(repo, commit, previousSha, previousProvenance);
  if (settled !== null || previousSha === null) return { ...result, ...settled };
  const status = gitText(repo, "diff", "--name-status", `${previousSha}..${commit}`);
  const declaredInChanged = new Set<string>();
  for (const line of status.split("\n").filter((row) => row.length > 0)) {
    const entry = changedPath(repo, previousSha, commit, line);
    for (const id of entry.safeguardIds) declaredInChanged.add(id);
    const { path } = entry;
    if (MODEL_VISIBLE.some((pattern) => pattern.test(path))) result.modelVisibleChanged.push(path);
    result.changed.push(entry);
  }
  addReach(result, declaredInChanged, firedSafeguards(campaign, found.runId));
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
