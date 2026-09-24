#!/usr/bin/env bun
// One editable run overview for every review lane. `buildOverview` derives it from recorded bytes
// (snapshot status and the terminal trace-review read through the controller's strict reader, harness evolution, digest trigger rows, scan findings and
// the category/hook census) so the lanes get the same orientation even when the default outcome
// view refused the run. It is the byte source for `shared-instructions.json` (see
// shared-instructions.mjs), which is the file the primary edits before launch; `wri.mjs collect`
// writes both.

import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { asRecord } from "#src/meta/json-shape.ts";
import { isAbsolute, join, resolve } from "#src/meta/path.ts";
import { absoluteOption, exitWith, parseOrDie, requiredOption } from "#skills/main/cli.ts";
import { readJsonFileOrNull, writeJsonFile } from "#src/meta/completed-json.ts";

export const OVERVIEW_SCHEMA = "wri-run-overview/v1";
const TRIGGER_ROW = /^[A-Z][A-Z0-9 /()-]{5,}[A-Z)]:?\s/;

/** Digest trigger rows are capitalised lines. Group them by trigger name (the text before the
 *  first colon) with the row count and the first two distinct examples, in first-seen order. */
export function digestTriggers(digest) {
  const groups = new Map();
  for (const line of digest.split("\n")) {
    const text = line.trim().replace(/\s+/g, " ");
    if (!TRIGGER_ROW.test(text)) continue;
    const name = text.split(":")[0];
    const group = groups.get(name) ?? { name, rows: 0, examples: [] };
    group.rows += 1;
    if (group.examples.length < 2 && !group.examples.includes(text)) group.examples.push(text);
    groups.set(name, group);
  }
  return [...groups.values()];
}

function evolutionFacts(evolution) {
  if (!evolution) return { state: "unavailable" };
  const summary = asRecord(evolution.summary) ?? {};
  const quick = asRecord(evolution.quickRead) ?? {};
  const latest = asRecord(quick.latestCheckpoint) ?? {};
  const taskSet = asRecord(latest.taskSet) ?? {};
  const product = asRecord(latest.product) ?? {};
  return {
    state: "recorded",
    savedVersions: summary.savedVersions ?? null,
    measuredBatteries: summary.measuredBatteries ?? null,
    epochs: summary.epochs ?? null,
    currentBundle: asRecord(evolution.current)?.bundleSnapshotId ?? null,
    latestCheckpoint: {
      ordinal: latest.ordinal ?? null,
      outcome: latest.outcome ?? null,
      commit: latest.commit ?? null,
    },
    taskSet: { tasks: taskSet.tasks ?? null, families: taskSet.families ?? null },
    product: {
      files: product.files ?? null,
      nonBlankLines: product.nonBlankLines ?? null,
      byRoot: product.byRoot ?? null,
    },
  };
}

function viewStates(status) {
  const views = Array.isArray(status?.views) ? status.views : [];
  /** @type {{ ok: string[], failed: string[], unsupported: string[] }} */
  const byState = { ok: [], failed: [], unsupported: [] };
  for (const view of views) {
    const bucket = view.status === "ok" ? "ok" : view.status === "unsupported" ? "unsupported" : "failed";
    byState[bucket].push(view.label);
  }
  return byState;
}

/** Derive the overview from a snapshot directory. Every absent source stays an explicit gap. */
export function buildOverview(snapshotDir) {
  const dir = resolve(snapshotDir);
  const status = readJsonFileOrNull(join(dir, "snapshot-status.json"));
  if (status === null) throw new Error(`no readable snapshot-status.json under ${dir}`);
  const scan = readJsonFileOrNull(join(dir, `${status.runIds?.[0]}-scan.txt`));
  const timeline = readJsonFileOrNull(join(dir, "timeline.json"));
  const facts = asRecord(status.facts) ?? {};
  const digestPath = join(dir, "digest.md");
  return {
    schema: OVERVIEW_SCHEMA,
    generatedAt: new Date().toISOString(),
    snapshotDir: dir,
    runId: status.runIds?.[0] ?? null,
    campaign: status.campaign ?? null,
    source: asRecord(status.source)
      ? {
          commit: status.source.commit ?? null,
          sourceDigest: status.source.sourceDigest ?? null,
          dirty: status.source.dirty ?? null,
        }
      : null,
    snapshot: {
      capturedAt: status.capturedAt ?? null,
      complete: status.complete === true,
      views: viewStates(status),
    },
    terminal: facts.terminal ?? { state: "unavailable", reason: "the snapshot recorded no terminal facts" },
    terminalAccounting: facts.terminalAccounting ?? null,
    evolution: evolutionFacts(readJsonFileOrNull(join(dir, "harness-evolution.json"))),
    digestTriggers: digestTriggers(existsSync(digestPath) ? readFileSync(digestPath, "utf8") : ""),
    scanFindings: Array.isArray(scan?.findings)
      ? scan.findings.map((finding) => ({
          rule: finding.rule ?? null,
          battery: finding.battery ?? null,
          statement: finding.statement ?? null,
        }))
      : null,
    timelineStalls: Array.isArray(asRecord(timeline)?.stalls) ? timeline.stalls.slice(0, 2) : null,
    orientation: "",
    movedVariable: "",
  };
}

export function readOverview(path) {
  if (!isAbsolute(path)) throw new Error("--overview must be an absolute path");
  const overview = readJsonFileOrNull(path);
  if (!asRecord(overview) || overview.schema !== OVERVIEW_SCHEMA) {
    throw new Error(`${path} is not a ${OVERVIEW_SCHEMA} file`);
  }
  return overview;
}

/**
 * A one-input script's command line: the absolute path after `--<input>`, then the JSON `build`
 * makes of it, written to the absolute `--out` path and announced as `<label> written to <path>`,
 * or printed when `--out` is absent.
 */
export function runJsonScript(script, input, build, label) {
  const die = exitWith(script);
  const { single } = parseOrDie(die, { values: [input, "out"] });
  const absolute = absoluteOption(die);
  const result = build(absolute(input, requiredOption(die, single)(input)));
  const out = single.get("out");
  if (out === undefined) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  writeJsonFile(absolute("out", out), result);
  console.log(`${label} written to ${out}`);
}
