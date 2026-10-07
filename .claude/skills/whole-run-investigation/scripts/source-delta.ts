#!/usr/bin/env bun
// Source-delta reach (lane 21, deterministic half). Diff the measured source of this run against
// the measured source of the previous run in the same lane, list the changed files, and join the
// safeguard ids whose `safeguardTriggered` call sits on a changed line to the run's SAFEGUARDS_LOG:
// fired, or changed without a matching recorded firing (labelled unreached). A call the change
// left alone is not the change's to reach, however much else its file moved, and an id is `new`
// only when the previous source declared it nowhere, so a call that moved between files or lines
// is changed, not new. A changed file inside the prompt surface the measured source's own
// `.prompt-surface.json` declares (the files the prompt-surface census reads, under the audience it
// names) is flagged for lane 21; a source without that file names no model-visible change.
//
// Reads Git objects and recorded campaign text only; never executes reviewed source and prints
// no source content. A commit the checkout cannot resolve is `source-unresolved`, never guessed.
//
//   bun wri.ts delta <target> [--repo <measured checkout>] [--previous <commit | abs campaign dir>]
//     [--json] [--out <abs file>]
//
// Without --previous the script picks the newest sibling campaign of the same lane (same
// directory name minus its numeric suffix) whose opening was written earlier on another source,
// preferring one whose Builder and Built models match this run's, since a baseline under other
// models moves the outcome by more than the source; it says which it took, and when no earlier
// campaign ran these models.

import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { gitMaybe, gitOutput, gitText } from "#skills/main/git.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { readSafeguardLog } from "#src/meta/safeguard.ts";
import { isControllerBatteryRunId } from "#src/run/controller-battery-record-policy.ts";
import { campaignRuns, latestRun } from "#tools/runs/discover.ts";
import { jsonText } from "./run-overview.ts";

interface FoundOpening {
  runId: string;
  opening: JsonValue | null;
}

/** An earlier campaign of the same lane, the source commit its opening recorded, and its models. */
export interface PreviousCampaign {
  dir: string;
  at: string;
  commit: JsonValue;
  models: string | null;
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

/** One `safeguardTriggered` call in a source text: its id and the lines from the call to the id. */
interface SafeguardCall {
  id: string;
  first: number;
  last: number;
}

/** The two sources a delta compares, and every safeguard id each declares in its run source. */
interface DeltaSides {
  previous: string;
  commit: string;
  before: ReadonlySet<string>;
  now: ReadonlySet<string>;
}

/** A safeguard whose call changed, and whether the run's log recorded it firing. */
export interface SafeguardReach {
  id: string;
  state: string;
  firings: number;
}

/** A changed file the measured source's prompt surface declares, and the audience it names. */
export interface VisibleChange {
  path: string;
  audience: string;
}

/** What `.prompt-surface.json` declares a model can read: source under `dirs`, documents under or
 *  named by `doc`, and an audience per path prefix. */
interface PromptSurface {
  dirs: string[];
  doc: string[];
  audiences: [string, string][];
}

/** The source delta of one run against the previous source. */
export interface SourceDelta {
  schema: string;
  campaign: string;
  runId: string;
  commit: string;
  previousCommit: JsonValue;
  previousProvenance: string;
  /** Whether the baseline's Builder and Built models match this run's; null when either side
   *  records none, as an operator-named revision does not. */
  previousSameModels: boolean | null;
  state: string;
  reason?: string;
  changed: ChangedPath[];
  safeguards: SafeguardReach[];
  firedElsewhere: { id: string; firings: number }[];
  /** Where the model-visible flag came from, once the delta resolves. */
  promptSurface?: string;
  modelVisibleChanged: VisibleChange[];
}

const GIT_SHA = /^[0-9a-f]{40}$/;
const SAFEGUARD_CALL = /safeguardTriggered\s*\(\s*["'`]([^"'`]+)["'`]/g;
/** A `git diff -U0` hunk header: the removed lines' start and count, then the added lines'. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** A file whose safeguard calls the run can reach. */
const SAFEGUARD_SOURCE = /\.(?:ts|mts|js|mjs)$/;
/** A test calls safeguardTriggered with fixture ids and template placeholders that no run fires,
 *  so its calls are not declarations; the path still counts as changed. */
const TEST_SOURCE = /^test\/|\.test\.[cm]?[jt]s$/;
/** The repo's declaration of what a model can read, which the prompt-surface census scans. A path
 *  inside it is a lead to verify delivery for, not proof that a model read the change. */
const PROMPT_SURFACE = ".prompt-surface.json";
/** The census's own reading rules: the source it parses, the tests and declarations it skips, the
 *  documents it reads whole from a `doc` directory, and the directories it never walks. */
const SURFACE_SOURCE = /\.[mc]?[jt]sx?$/;
const SURFACE_SKIPPED_SOURCE = /\.d\.ts$|\.(?:test|spec)\.[a-z]+$|(?:^|\/)(?:test|tests|__tests__)\//;
const SURFACE_DOCUMENT = /\.(?:md|markdown|txt|json|ya?ml|py|sh)$/;
const SURFACE_UNWALKED = /(?:^|\/)(?:node_modules|\.[^/]+)\//;

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

/** The models of the two slots that make the measured product, as one label; null when the
 *  opening records none. */
function modelsOf(opening: JsonValue | null | undefined): string | null {
  const slots = asRecord(asRecord(opening)?.modelSlots);
  const builder = asRecord(slots?.builder)?.model;
  const built = asRecord(slots?.built)?.model;
  return isString(builder) && isString(built) ? `builder ${builder}, built ${built}` : null;
}

/** The newest sibling campaign of the same lane opened before this run on another source commit,
 *  under this run's models when any such campaign ran them. Several campaigns of one lane often
 *  launch from one commit, and the nearest of them by launch time would read as an identical
 *  source, which says nothing about what changed since the lane last measured a different tree. */
export function previousCampaign(
  campaign: string,
  writtenAt: JsonValue | undefined,
  commit: string,
  models: string | null,
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
    if (earlier !== commit) candidates.push({ dir, at, commit: earlier, models: modelsOf(found?.opening) });
  }
  candidates.sort((left, right) => (left.at < right.at ? 1 : -1));
  return (
    candidates.find((candidate) => models !== null && candidate.models === models) ?? candidates[0] ?? null
  );
}

/** A file's exact bytes at a commit, untrimmed so line numbers hold; null when it is not there. */
function textAt(repo: string, commit: string, path: string): string | null {
  try {
    return gitOutput(repo, "show", `${commit}:${path}`);
  } catch {
    return null;
  }
}

function isRunSource(path: string): boolean {
  return SAFEGUARD_SOURCE.test(path) && !TEST_SOURCE.test(path);
}

/** Each safeguard call in a text, with the 1-based lines it spans from its name to its id. */
function callsIn(text: string | null): SafeguardCall[] {
  if (text === null) return [];
  return [...text.matchAll(SAFEGUARD_CALL)].map((match) => {
    const first = text.slice(0, match.index).split("\n").length;
    return { id: match[1] ?? "", first, last: first + match[0].split("\n").length - 1 };
  });
}

/** Every safeguard id the run source of `commit` declares, in any file. */
function declaredAt(repo: string, commit: string): Set<string> {
  const listed = gitMaybe(repo, "grep", "-l", "-F", "safeguardTriggered", commit, "--") ?? "";
  const paths = listed
    .split("\n")
    .map((row) => row.slice(commit.length + 1))
    .filter(isRunSource);
  return new Set(paths.flatMap((path) => callsIn(textAt(repo, commit, path)).map((call) => call.id)));
}

/** The lines `git diff -U0` removes from the previous file and adds to the current one. */
function changedLines(repo: string, sides: DeltaSides, oldPath: string, path: string) {
  const diff = gitText(
    repo,
    "diff",
    "--no-ext-diff",
    "--no-color",
    "-U0",
    `${sides.previous}:${oldPath}`,
    `${sides.commit}:${path}`,
  );
  const removed = new Set<number>();
  const added = new Set<number>();
  for (const hunk of diff.split("\n").map((row) => HUNK.exec(row))) {
    if (hunk === null) continue;
    addLines(removed, hunk[1], hunk[2]);
    addLines(added, hunk[3], hunk[4]);
  }
  return { removed, added };
}

/** A hunk side's lines, from its start for its count; git omits a count of one. */
function addLines(into: Set<number>, start = "0", count = "1"): void {
  for (let line = Number(start); line < Number(start) + Number(count); line += 1) into.add(line);
}

/** The ids of the calls that meet a changed line; every call when the whole side is new or gone. */
function touchedIds(calls: readonly SafeguardCall[], changed: ReadonlySet<number> | null): Set<string> {
  const touched = calls.filter((call) => {
    if (changed === null) return true;
    for (let line = call.first; line <= call.last; line += 1) if (changed.has(line)) return true;
    return false;
  });
  return new Set(touched.map((call) => call.id));
}

export function firedSafeguards(campaign: string, runId: string): Map<string, number> {
  const fired = new Map<string, number>();
  const root = join(campaign, "safeguards");
  if (!existsSync(root)) return fired;
  for (const name of readdirSync(root)) {
    if (!isControllerBatteryRunId(runId, name)) continue;
    for (const [id, count] of readSafeguardLog(campaign, name)?.counts ?? []) {
      fired.set(id, (fired.get(id) ?? 0) + count);
    }
  }
  return fired;
}

/** The commit this run is compared against, where it came from and whether it ran this run's
 *  models: the operator's campaign or revision when named, otherwise the lane's nearest earlier
 *  campaign on another source, under the same models when the lane has one. */
function previousSource(
  campaign: string,
  previous: string | null,
  opening: JsonObject | null,
  commit: string,
): Pick<SourceDelta, "previousCommit" | "previousProvenance" | "previousSameModels"> {
  const models = modelsOf(opening);
  const sameAs = (other: string | null): boolean | null =>
    models === null || other === null ? null : other === models;
  if (previous !== null && existsSync(join(previous, "controller"))) {
    const older = openingOf(resolve(previous), null);
    return {
      previousCommit: sourceCommitOf(older?.opening),
      previousProvenance: `campaign ${basename(resolve(previous))}`,
      previousSameModels: sameAs(modelsOf(older?.opening)),
    };
  }
  if (previous !== null) {
    return {
      previousCommit: previous,
      previousProvenance: "operator-named revision",
      previousSameModels: null,
    };
  }
  const lane = laneKey(campaign);
  const sibling = previousCampaign(campaign, opening?.writtenAt ?? null, commit, models);
  if (sibling === null) {
    return {
      previousCommit: null,
      previousProvenance: `no earlier campaign of lane ${lane} on another source beside ${campaign}`,
      previousSameModels: null,
    };
  }
  return {
    previousCommit: sibling.commit,
    previousProvenance: siblingProvenance(lane, models, sibling),
    previousSameModels: sameAs(sibling.models),
  };
}

/** Which sibling the lane's baseline is, and whether it ran this run's models. */
function siblingProvenance(lane: string, models: string | null, sibling: PreviousCampaign): string {
  const chosen = `${basename(sibling.dir)} (opened ${sibling.at})`;
  if (models === null) {
    return `newest earlier campaign of lane ${lane} on another source (this run records no models): ${chosen}`;
  }
  if (sibling.models === models) {
    return `newest earlier campaign of lane ${lane} on another source under the same models (${models}): ${chosen}`;
  }
  return `no earlier campaign of lane ${lane} on another source ran ${models}; newest on another source, under ${sibling.models ?? "unrecorded models"}: ${chosen}`;
}

/** One `--name-status` line as a changed path, with the safeguard ids whose calls a run-reachable
 *  source file changed: `new` when the previous source declared the id nowhere, `removed` when the
 *  current source declares it nowhere. A renamed file is read at its old path on the previous side. */
function changedPath(repo: string, sides: DeltaSides, line: string): ChangedPath {
  const [code = "", ...paths] = line.split("\t");
  const path = paths.at(-1);
  if (path === undefined) throw new Error(`name-status line ${JSON.stringify(line)} names no path`);
  const change = CHANGE_BY_STATUS.get(code.charAt(0)) ?? "modified";
  const entry: ChangedPath = { path, change, safeguardIds: [] };
  if (!isRunSource(path)) return entry;
  const oldPath = paths[0] ?? path;
  const before = change === "added" ? null : textAt(repo, sides.previous, oldPath);
  const now = change === "deleted" ? null : textAt(repo, sides.commit, path);
  const lines = before === null || now === null ? null : changedLines(repo, sides, oldPath, path);
  const added = touchedIds(callsIn(now), lines?.added ?? null);
  const removed = touchedIds(callsIn(before), lines?.removed ?? null);
  entry.safeguardIds = [...added].sort();
  entry.newSafeguardIds = [...added].filter((id) => !sides.before.has(id)).sort();
  entry.removedSafeguardIds = [...removed].filter((id) => !sides.now.has(id)).sort();
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

/** The prompt surface the source at `commit` declares, or null when it holds no readable one. */
function promptSurfaceAt(repo: string, commit: string): PromptSurface | null {
  const text = textAt(repo, commit, PROMPT_SURFACE);
  if (text === null) return null;
  let config: JsonObject | null;
  try {
    config = asRecord(JSON.parse(text));
  } catch {
    return null;
  }
  if (config === null) return null;
  const listed = (value: JsonValue | undefined): string[] =>
    Array.isArray(value) ? value.filter(isString) : [];
  return {
    // The census reads `src` when the config names no directory.
    dirs: config.dirs === undefined ? ["src"] : listed(config.dirs),
    doc: listed(config.doc),
    audiences: Object.entries(asRecord(config.audiences) ?? {}).flatMap(([prefix, name]) =>
      isString(name) ? [[prefix, name] satisfies [string, string]] : [],
    ),
  };
}

/** The audience a model reading `path` belongs to, by the census's rule that the longest prefix
 *  ending at a `/`, `-` or `.` wins; null when the census would not read the file at all. */
function surfaceAudience(surface: PromptSurface, path: string): string | null {
  if (SURFACE_UNWALKED.test(path)) return null;
  const inside = (entry: string): boolean => path.startsWith(`${entry}/`);
  const source = SURFACE_SOURCE.test(path) && !SURFACE_SKIPPED_SOURCE.test(path) && surface.dirs.some(inside);
  const document = surface.doc.some(
    (entry) => path === entry || (inside(entry) && SURFACE_DOCUMENT.test(path)),
  );
  if (!source && !document) return null;
  let best = { prefix: "", name: "unclassified" };
  for (const [prefix, name] of surface.audiences) {
    const boundary = path.startsWith(prefix) ? path[prefix.length] : null;
    const matches = path === prefix || boundary === "/" || boundary === "-" || boundary === ".";
    if (matches && prefix.length > best.prefix.length) best = { prefix, name };
  }
  return best.name;
}

/** Each safeguard whose call changed, fired or unreached in this run, and each one the run fired
 *  that no changed call names. */
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
  const baseline = previousSource(campaign, previous, asRecord(found.opening), commit);
  const { previousCommit, previousProvenance } = baseline;
  const result: SourceDelta = {
    schema: "wri-source-delta/v2",
    campaign,
    runId: found.runId,
    commit,
    ...baseline,
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
  const sides: DeltaSides = {
    previous: previousSha,
    commit,
    before: declaredAt(repo, previousSha),
    now: declaredAt(repo, commit),
  };
  const surface = promptSurfaceAt(repo, commit);
  result.promptSurface =
    surface === null
      ? `this source holds no readable ${PROMPT_SURFACE}, so no change is named model-visible`
      : `${PROMPT_SURFACE} at this source`;
  for (const line of status.split("\n").filter((row) => row.length > 0)) {
    const entry = changedPath(repo, sides, line);
    for (const id of entry.safeguardIds) declaredInChanged.add(id);
    const audience = surface === null ? null : surfaceAudience(surface, entry.path);
    if (audience !== null) result.modelVisibleChanged.push({ path: entry.path, audience });
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
  const audienceOf = new Map(delta.modelVisibleChanged.map((row) => [row.path, row.audience]));
  for (const entry of delta.changed) {
    const audience = audienceOf.get(entry.path);
    const visible = audience === undefined ? "" : ` · model-visible (${audience})`;
    const ids = entry.safeguardIds.length > 0 ? ` · safeguards {${entry.safeguardIds.join(",")}}` : "";
    const fresh =
      entry.newSafeguardIds !== undefined && entry.newSafeguardIds.length > 0
        ? ` · new {${entry.newSafeguardIds.join(",")}}`
        : "";
    const gone =
      entry.removedSafeguardIds !== undefined && entry.removedSafeguardIds.length > 0
        ? ` · removed {${entry.removedSafeguardIds.join(",")}}`
        : "";
    lines.push(`${entry.change.padEnd(9)}${entry.path}${visible}${ids}${fresh}${gone}`);
  }
  lines.push("", "## safeguard reach of changed calls");
  if (delta.safeguards.length === 0) lines.push("no safeguard call on a changed line");
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
      `fired outside changed calls: ${delta.firedElsewhere.map((row) => `${row.id} ×${row.firings}`).join(", ")}`,
    );
  }
  lines.push("", ...surfaceLines(delta));
  return `${lines.join("\n")}\n`;
}

/** Where the model-visible flag came from, and the changed files it names by audience. */
function surfaceLines(delta: SourceDelta): string[] {
  const lines = [`prompt surface: ${delta.promptSurface ?? "unread"}`];
  if (delta.modelVisibleChanged.length === 0) return lines;
  const byAudience = Map.groupBy(delta.modelVisibleChanged, (row) => row.audience);
  const counts = [...byAudience.entries()].map(([audience, rows]) => `${audience} ${rows.length}`);
  lines.push(
    `MODEL-VISIBLE SURFACE CHANGED (lane 21): ${delta.modelVisibleChanged.length} file(s) the prompt surface declares — ${counts.join(", ")}; each is marked model-visible above`,
  );
  return lines;
}
