#!/usr/bin/env bun
// Source-delta reach (angle 31, deterministic half). Diff the measured source of this run against
// the measured source of the previous run in the same lane, list the changed files, and join the
// safeguard ids declared in changed source files to the run's SAFEGUARDS_LOG: fired, or declared
// in a changed file without a matching recorded firing (labelled unreached). A changed model-visible text (author prompts,
// starters, judge framing) is flagged as an angle 12 trigger.
//
// Reads Git objects and recorded campaign text only; never executes reviewed source and prints
// no source content. A commit the checkout cannot resolve is `source-unresolved`, never guessed.
//
//   bun source-delta.mjs --campaign <abs dir> --run <runId> --repo <measured checkout> \
//     [--previous <commit | abs campaign dir>] [--json] [--out <abs file>]
//
// Without --previous the script picks the newest sibling campaign of the same lane (same
// directory name minus its numeric suffix) whose opening was written earlier, and says so.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { basename, dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

const GIT_SHA = /^[0-9a-f]{40}$/;
const SAFEGUARD_CALL = /safeguardTriggered\s*\(\s*["'`]([^"'`]+)["'`]/g;
/** Broad path heuristic for possible model-visible changes; verify delivery before making a claim. */
const MODEL_VISIBLE = [/^src\/author\//, /^src\/builder\//, /^starters\//, /prompt/i, /^src\/truth\/judge/];

/** Git's name-status letter for the change a path underwent; anything else is a modification. */
const CHANGE_BY_STATUS = { A: "added", D: "deleted", R: "renamed" };

function git(repo, args) {
  return runTextSyncOrThrow(["git", "-C", repo, ...args]).trim();
}

function commitExists(repo, commit) {
  return runSync(["git", "-C", repo, "cat-file", "-e", `${commit}^{commit}`]).exitCode === 0;
}

function openingOf(campaign, runId) {
  const dir = join(campaign, "controller");
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((name) => existsSync(join(dir, name, "opening.json")));
  const chosen = runId === null ? names.sort().at(-1) : names.find((name) => name === runId);
  return chosen === undefined
    ? null
    : { runId: chosen, opening: readJsonFileOrNull(join(dir, chosen, "opening.json")) };
}

function laneKey(campaign) {
  return basename(campaign).replace(/-\d+$/, "");
}

/** The newest sibling campaign of the same lane opened before this run. */
export function previousCampaign(campaign, writtenAt) {
  const parent = dirname(campaign);
  const lane = laneKey(campaign);
  const candidates = [];
  for (const name of existsSync(parent) ? readdirSync(parent) : []) {
    const dir = join(parent, name);
    if (dir === campaign || laneKey(dir) !== lane) continue;
    const found = openingOf(dir, null);
    const at = found?.opening?.writtenAt;
    if (!isString(at) || (isString(writtenAt) && at >= writtenAt)) continue;
    candidates.push({ dir, at, commit: found.opening?.source?.commit ?? null });
  }
  candidates.sort((left, right) => (left.at < right.at ? 1 : -1));
  return candidates[0] ?? null;
}

function safeguardIds(repo, commit, path) {
  const shown = runSync(["git", "-C", repo, "show", `${commit}:${path}`]);
  if (shown.exitCode !== 0) return new Set();
  const text = new TextDecoder().decode(shown.stdout);
  return new Set([...text.matchAll(SAFEGUARD_CALL)].map((match) => match[1]));
}

export function firedSafeguards(campaign, runId) {
  const fired = new Map();
  const root = join(campaign, "safeguards");
  if (!existsSync(root)) return fired;
  for (const name of readdirSync(root)) {
    if (name !== runId && !name.startsWith(`${runId}-i`)) continue;
    const log = join(root, name, "SAFEGUARDS_LOG.txt");
    if (!existsSync(log)) continue;
    for (const line of readFileSync(log, "utf8").split("\n")) {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length < 2 || parts[1].length === 0) continue;
      fired.set(parts[1], (fired.get(parts[1]) ?? 0) + 1);
    }
  }
  return fired;
}

/** @param {{ campaign: string, runId?: string | null, repo: string, previous?: string | null }} named
 *  `previous` is an earlier campaign directory or a revision; absent, the newest earlier campaign
 *  of the same lane supplies it. */
export function buildSourceDelta(named) {
  const { runId, previous = null } = named;
  const campaign = resolve(named.campaign);
  const repo = resolve(named.repo);
  const found = openingOf(campaign, runId ?? null);
  if (found === null) throw new Error(`no controller opening for ${runId ?? "any run"} under ${campaign}`);
  const commit = found.opening?.source?.commit ?? null;
  if (!isString(commit) || !GIT_SHA.test(commit)) {
    throw new Error(`opening for ${found.runId} records no full source commit`);
  }
  let previousCommit = null;
  let previousProvenance;
  if (previous === null) {
    const sibling = previousCampaign(campaign, found.opening?.writtenAt ?? null);
    if (sibling === null) {
      previousProvenance = `no earlier campaign of lane ${laneKey(campaign)} beside ${campaign}`;
    } else {
      previousCommit = sibling.commit;
      previousProvenance = `newest earlier campaign of lane ${laneKey(campaign)}: ${basename(sibling.dir)} (opened ${sibling.at})`;
    }
  } else if (existsSync(join(previous, "controller"))) {
    const older = openingOf(resolve(previous), null);
    previousCommit = older?.opening?.source?.commit ?? null;
    previousProvenance = `campaign ${basename(resolve(previous))}`;
  } else {
    previousCommit = previous;
    previousProvenance = "operator-named revision";
  }
  const result = {
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
  const status = git(repo, ["diff", "--name-status", `${previousCommit}..${commit}`]);
  const fired = firedSafeguards(campaign, found.runId);
  const declaredInChanged = new Set();
  for (const line of status.split("\n").filter((row) => row.length > 0)) {
    const [code, ...paths] = line.split("\t");
    const path = paths.at(-1);
    const change = CHANGE_BY_STATUS[code[0]] ?? "modified";
    const entry = { path, change, safeguardIds: [] };
    if (/\.(?:ts|mts|js|mjs)$/.test(path) && change !== "deleted") {
      const now = safeguardIds(repo, commit, path);
      const before = change === "added" ? new Set() : safeguardIds(repo, previousCommit, path);
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
  for (const [id, count] of [...fired.entries()].sort()) {
    if (!declaredInChanged.has(id)) result.firedElsewhere.push({ id, firings: count });
  }
  return result;
}

export function renderSourceDelta(delta) {
  const lines = [`# source delta — ${basename(delta.campaign)} / ${delta.runId}`, ""];
  lines.push(`this source: ${delta.commit}`);
  lines.push(`previous source: ${delta.previousCommit ?? "unresolved"} (${delta.previousProvenance})`);
  lines.push(`state: ${delta.state}${delta.reason ? ` — ${delta.reason}` : ""}`);
  if (delta.state !== "resolved") return `${lines.join("\n")}\n`;
  const byTop = new Map();
  for (const entry of delta.changed) {
    const top = entry.path.split("/")[0];
    byTop.set(top, (byTop.get(top) ?? 0) + 1);
  }
  lines.push(
    "",
    `## changed files: ${delta.changed.length} (${[...byTop.entries()].map(([top, count]) => `${top} ${count}`).join(", ") || "none"})`,
  );
  for (const entry of delta.changed) {
    const ids = entry.safeguardIds?.length ? ` · safeguards {${entry.safeguardIds.join(",")}}` : "";
    const fresh = entry.newSafeguardIds?.length ? ` · new {${entry.newSafeguardIds.join(",")}}` : "";
    const gone = entry.removedSafeguardIds?.length
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
      `UNREACHED CHANGED SAFEGUARDS (angle 31 trigger): ${unreached.map((row) => row.id).join(", ")} — the change was present; no matching firing was found in the selected run logs`,
    );
  }
  if (delta.firedElsewhere.length > 0) {
    lines.push(
      `fired outside changed files: ${delta.firedElsewhere.map((row) => `${row.id} ×${row.firings}`).join(", ")}`,
    );
  }
  if (delta.modelVisibleChanged.length > 0) {
    lines.push(
      "",
      `MODEL-VISIBLE SURFACE CHANGED (angle 12 trigger): ${delta.modelVisibleChanged.join(", ")}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") args.json = true;
    else if (["--campaign", "--run", "--repo", "--previous", "--out"].includes(flag)) {
      args[flag.slice(2)] = argv[index + 1];
      index += 1;
    } else throw new Error(`unknown argument ${flag}`);
  }
  for (const name of ["campaign", "repo"]) {
    if (!isString(args[name]) || !isAbsolute(args[name])) {
      throw new Error(`--${name} must be an absolute path`);
    }
  }
  return args;
}

if (import.meta.main) {
  try {
    const args = parseArgs(runtimeProcess.argv.slice(2));
    const delta = buildSourceDelta({
      campaign: args.campaign,
      runId: args.run ?? null,
      repo: args.repo,
      previous: args.previous ?? null,
    });
    const text = args.json ? `${JSON.stringify(delta, null, 2)}\n` : renderSourceDelta(delta);
    if (isString(args.out)) {
      writeFileSync(args.out, text);
      runtimeProcess.stdout.write(`${args.out}\n`);
    } else runtimeProcess.stdout.write(text);
  } catch (error) {
    runtimeProcess.stderr.write(`source-delta: ${errorMessage(error)}\n`);
    runtimeProcess.exit(2);
  }
}
