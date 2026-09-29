#!/usr/bin/env bun
// One editable run overview for every review lane. `buildOverview` derives it from recorded bytes
// (snapshot status and the terminal trace-review read through the controller's strict reader, harness evolution, digest trigger rows, scan findings and
// the timeline stalls) so the lanes get the same orientation even when the default outcome
// view refused the run. It is the byte source for `shared-instructions.json` (see
// shared-instructions.ts), which is the file the primary edits before launch; `wri.ts collect`
// writes both.

import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isRecord, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isAbsolute, join, resolve } from "#src/meta/path.ts";
import { absoluteOption, exitWith, parseOrDie, requiredOption } from "#skills/main/cli.ts";
import { readJsonFileOrNull, writeJsonFile } from "#src/meta/completed-json.ts";

export const OVERVIEW_SCHEMA = "wri-run-overview/v1";
const TRIGGER_ROW = /^[A-Z][A-Z0-9 /()-]{5,}[A-Z)]:?\s/;

/** One digest trigger name, how many rows carried it, and its first two distinct rows. */
export interface DigestTrigger {
  name: string;
  rows: number;
  examples: string[];
}

/** One snapshot view as the status file lists it. */
interface StatusView {
  label?: string;
  status?: string;
}

/** `snapshot-status.json` as trace-review.ts writes it, every field optional to this reader. */
interface RecordedStatus {
  runIds?: readonly string[];
  campaign?: string;
  source?: { commit?: string; sourceDigest?: string; dirty?: boolean };
  capturedAt?: string;
  complete?: boolean;
  views?: readonly StatusView[];
  facts?: { terminal?: TerminalReading; terminalAccounting?: JsonValue };
}

/** The terminal facts trace-review.ts records, read with every field optional. */
export interface TerminalReading {
  state: string;
  reason?: string | null;
  outcome?: string;
  abortClause?: string | null;
  lastIteration?: string | null;
  iterations?: number;
  epoch?: JsonValue;
  denominator?: {
    state?: string;
    error?: string;
    total?: number;
    verified?: number;
    unaccepted?: number;
    nonResults?: number;
  } | null;
  providerBudget?: { cap: number; used: number; byRole: Readonly<Record<string, number>> } | null;
}

/** One scan finding carried into the overview. */
export interface ScanFinding {
  rule?: JsonValue;
  battery?: JsonValue;
  statement?: JsonValue;
}

/** One timeline stall row, as timeline.ts records it. */
export interface TimelineStall {
  minutes?: number;
  phase?: string | null;
  after?: string | null;
}

export type EvolutionFacts = ReturnType<typeof evolutionFacts>;
export type RunOverview = ReturnType<typeof buildOverview>;

/** Snapshot view labels grouped by captured status. */
export interface ViewStates {
  ok: (string | undefined)[];
  failed: (string | undefined)[];
  unsupported: (string | undefined)[];
}

/**
 * The text `String(value)` gives a recorded JSON value, spelled so the type checker can see it: an
 * array joins its elements with commas (a null element reads as empty) and an object reads as
 * `[object Object]`. The review scripts print recorded facts this way, and a nested value where a
 * scalar was expected must read as it always has rather than change the packet's text.
 */
export function jsonText(value: JsonValue): string {
  if (Array.isArray(value)) return value.map((item) => (item === null ? "" : jsonText(item))).join(",");
  if (isRecord(value)) return "[object Object]";
  return String(value);
}

/** Whether a recorded JSON value is truthy, the test an untyped `value ? … : …` applied to it. */
export function jsonTruthy(value: JsonValue | undefined): value is Exclude<JsonValue, null | false> {
  return value !== undefined && value !== null && value !== false && value !== 0 && value !== "";
}

/**
 * `readJsonFile` under the declared contract of whoever wrote the bytes. The review scripts read
 * evidence another script or the controller wrote, and every field they read is optional in the
 * declared type, so an absent one still reads as a gap rather than as a crash. A parse failure names
 * the path, as `readJsonFile` does.
 */
export function readJsonAs<T>(path: string): T {
  const text = readFileSync(path, "utf8");
  try {
    return parseJsonAs<T>(text);
  } catch (error) {
    throw new Error(`${path}: ${errorMessage(error)}`, { cause: error });
  }
}

/** `readJsonFileOrNull` under a declared contract: null when the file is missing, unreadable or not JSON. */
export function readJsonAsOrNull<T>(path: string): T | null {
  try {
    return readJsonAs<T>(path);
  } catch {
    return null;
  }
}

/** Digest trigger rows are capitalised lines. Group them by trigger name (the text before the
 *  first colon) with the row count and the first two distinct examples, in first-seen order. */
export function digestTriggers(digest: string): DigestTrigger[] {
  const groups = new Map<string, DigestTrigger>();
  for (const line of digest.split("\n")) {
    const text = line.trim().replace(/\s+/g, " ");
    if (!TRIGGER_ROW.test(text)) continue;
    const [name = ""] = text.split(":");
    const group = groups.get(name) ?? { name, rows: 0, examples: [] };
    group.rows += 1;
    if (group.examples.length < 2 && !group.examples.includes(text)) group.examples.push(text);
    groups.set(name, group);
  }
  return [...groups.values()];
}

function evolutionFacts(recorded: JsonValue | null) {
  // Any falsy JSON document reads as absent, as the untyped reader's `!recorded` did.
  if (recorded === null || recorded === false || recorded === 0 || recorded === "") {
    return { state: "unavailable" as const };
  }
  const evolution: JsonObject = asRecord(recorded) ?? {};
  const summary = asRecord(evolution.summary) ?? {};
  const quick = asRecord(evolution.quickRead) ?? {};
  const latest = asRecord(quick.latestCheckpoint) ?? {};
  const taskSet = asRecord(latest.taskSet) ?? {};
  const product = asRecord(latest.product) ?? {};
  return {
    state: "recorded" as const,
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

function viewStates(status: RecordedStatus): ViewStates {
  const views = Array.isArray(status.views) ? status.views : [];
  const byState: ViewStates = { ok: [], failed: [], unsupported: [] };
  for (const view of views) {
    const bucket = view.status === "ok" ? "ok" : view.status === "unsupported" ? "unsupported" : "failed";
    byState[bucket].push(view.label);
  }
  return byState;
}

/** Derive the overview from a snapshot directory. Every absent source stays an explicit gap. */
export function buildOverview(snapshotDir: string) {
  const dir = resolve(snapshotDir);
  const status = readJsonAsOrNull<RecordedStatus>(join(dir, "snapshot-status.json"));
  if (status === null) throw new Error(`no readable snapshot-status.json under ${dir}`);
  const scan = readJsonAsOrNull<{ findings?: readonly ScanFinding[] }>(
    join(dir, `${String(status.runIds?.[0])}-scan.txt`),
  );
  const timeline = readJsonAsOrNull<{ stalls?: readonly TimelineStall[] }>(join(dir, "timeline.json"));
  const facts = status.facts ?? {};
  const digestPath = join(dir, "digest.md");
  return {
    schema: OVERVIEW_SCHEMA,
    generatedAt: new Date().toISOString(),
    snapshotDir: dir,
    runId: status.runIds?.[0] ?? null,
    campaign: status.campaign ?? null,
    source: status.source
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
    terminal: facts.terminal ?? {
      state: "unavailable",
      reason: "the snapshot recorded no terminal facts",
    },
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
    timelineStalls: Array.isArray(timeline?.stalls) ? timeline.stalls.slice(0, 2) : null,
    orientation: "",
    movedVariable: "",
  };
}

export function readOverview(path: string): RunOverview {
  if (!isAbsolute(path)) throw new Error("--overview must be an absolute path");
  const overview = readJsonAsOrNull<RunOverview>(path);
  if (!asRecord(overview) || overview?.schema !== OVERVIEW_SCHEMA) {
    throw new Error(`${path} is not a ${OVERVIEW_SCHEMA} file`);
  }
  return overview;
}

/**
 * A one-input script's command line: the absolute path after `--<input>`, then the JSON `build`
 * makes of it, written to the absolute `--out` path and announced as `<label> written to <path>`,
 * or printed when `--out` is absent.
 */
export function runJsonScript<T>(
  script: string,
  input: string,
  build: (path: string) => T,
  label: string,
): void {
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
