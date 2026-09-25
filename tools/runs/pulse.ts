/**
 * `bun run runs pulse` — what changed in the open runs since the last look.
 *
 * `list` and `show` answer where a run stands; a run that is being watched raises a different
 * question every few minutes, which is what moved. Answering it by hand meant re-reading the
 * observability journal, the Builder's execution checkpoint, the rehearsal evidence, the plan and
 * the case record for every run and remembering what each said last time. This keeps one reading
 * per run between looks and prints the difference as events: `◆` a stage worth reading (a round
 * opened, a battery recorded, the run ended), `⚠` something that may be wrong (an error row, a
 * quiet Builder, a non-result, a not-run rehearsal), `·` a smaller fact. The first look prints
 * status lines only, because a difference needs a previous reading.
 *
 * Read-only, like the rest of `runs`: every value comes from a recorded file through its owner's
 * reader, and a file that cannot be read leaves its part of the reading empty rather than guessed.
 */
import { readExecutionEvidence } from "../outcome/builder-execution-facts.ts";
import { readEpochRecord } from "../../src/author/campaign-epoch.ts";
import { EXPERIMENT_FILE } from "../../src/author/builder-memory.ts";
import { currentPlan, EVIDENCE_SCHEMA, EVIDENCE_STEM } from "../../src/author/experiment-plan.ts";
import { placeOnBand, type BandZone } from "../../src/claim/battery-difficulty.ts";
import { CASE_RECORD_FILE } from "../../src/claim/case-record.ts";
import { POLICY } from "../../src/critic/policy.ts";
import { FROZEN_MANIFEST_PATH } from "../../src/critic/manifest.ts";
import { existsSync, readFileSync, readdirSync, statfsSync } from "../../src/meta/filesystem.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonValue } from "../../src/meta/json-shape.ts";
import { loadavg } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { parseSafeguardLog, safeguardLogFile } from "../../src/meta/safeguard.ts";
import { climbThresholds } from "../../src/run/climb-history.ts";
import { DEFAULT_DISK_MIN_GIB } from "../../.claude/skills/launch-run/scripts/options.ts";
import { readDifficultyDecisions, readObservations, readRunEvidence, type Observation } from "./evidence.ts";
import { duration, shortPath } from "./format.ts";
import { collectRows, type RunRow } from "./rows.ts";

/** A Builder checkpoint older than this, in a build, is worth a look. */
const QUIET_MS = 20 * 60_000;
/** Failed Builder calls between two looks that make a burst rather than ordinary friction. */
const FAILED_BURST = 3;
/** How far a verdict may land from the probability predicted for it before it is a surprise. */
const SURPRISE = 0.7;
const MEASURING = new Set(["adopt", "controls", "solve", "measure-on", "grade"]);
const REVIEWING = new Set(["judge", "claim", "analyse", "admission", "next"]);
/** Top-level transitions that are the loop's ordinary machinery and would bury the rest. */
const ROUTINE = new Set([
  "input:completed",
  "build:completed",
  "controls:started",
  "controls:completed",
  "solve:completed",
  "measure-on:started",
  "measure-on:completed",
  "grade:started",
  "grade:completed",
  "grade:deferred",
  "judge:started",
  "judge:completed",
  "analyse:started",
]);
const PHASE_TRANSITION = "phase-transition";
/** Transitions worth a `◆`, with the words to use; null keeps the row's own summary. */
const LOUD = new Map<string, string | null>([
  ["adopt:completed", "product adopted; its battery is next"],
  ["solve:started", "battery started"],
  ["analyse:completed", null],
  ["admission:completed", null],
]);

type RunState = RunRow["liveness"]["state"];

interface PulseRehearsal {
  taskId: string;
  verdict: string;
  predicted: number | null;
}

interface PulsePlan {
  comparator: "at-least" | "at-most";
  verifiedPasses: number;
  /** The pass count the plan's own predictions add up to. */
  expected: number;
  predictions: number;
}

/** The authoring round in progress, or the last one when the run has moved on to measure it. */
export interface PulseRound {
  /** The round's ordinal among the run's `build:started` rows; 0 before the first. */
  number: number;
  epoch: string | null;
  checkpointAt: string | null;
  toolCalls: number | null;
  failedCalls: number | null;
  previews: number;
  clearPreviews: number;
  /** Milliseconds from the session's start to its first clear preview. */
  firstClearMs: number | null;
  accepted: number;
  refused: number;
  refusalCodes: string[];
  rehearsals: PulseRehearsal[];
  plan: PulsePlan | null;
  /** The last heading of the Builder's latest message or reasoning row: a hint of what it is doing,
   *  never evidence of what it did. */
  headline: string | null;
  /** Files the round wrote that this tree's readers refuse, such as an older evidence schema from a
   *  run launched on an older source. Said rather than read as empty. */
  unread: string[];
}

export interface PulseBattery {
  passed: number;
  verified: number;
  unaccepted: number;
  nonResults: number;
  zone: BandZone | null;
  /** The zone came from a recorded difficulty decision; otherwise it is placed here, provisionally. */
  recorded: boolean;
}

export interface PulseReading {
  runId: string;
  label: string;
  state: RunState;
  now: number;
  startedAt: string | null;
  observations: Observation[];
  round: PulseRound;
  batteries: PulseBattery[];
  /** Safeguard names in firing order. A firing is a lead, and never changes a kind or a route. */
  safeguards: string[];
  /** The terminal's outcome and reason, once recorded. */
  terminal: string | null;
}

interface PulseEvent {
  mark: "◆" | "⚠" | "·";
  label: string;
  text: string;
  /** Campaign-relative files to read next. */
  look: string[];
}

type Stage = "opening" | "build" | "measuring" | "reviewing" | "ended";

/** The run id without its launch instant, which every run id carries and none is told apart by. */
export function pulseLabel(runId: string): string {
  return runId.replace(/-\d{8}T\d{6,9}Z(?=-)/, "");
}

function topLevel(observations: readonly Observation[]): Observation[] {
  return observations.filter((row) => row.parentId === null && row.type === PHASE_TRANSITION);
}

function roundsOpened(observations: readonly Observation[]): number {
  return topLevel(observations).filter((row) => row.phase === "build" && row.state === "started").length;
}

function stageOf(reading: PulseReading): Stage {
  if (reading.terminal !== null) return "ended";
  const last = topLevel(reading.observations).at(-1)?.phase ?? null;
  if (last === null) return "opening";
  if (MEASURING.has(last)) return "measuring";
  return REVIEWING.has(last) ? "reviewing" : "build";
}

function sideOf(zone: BandZone | null): "above" | "below" | "on" | null {
  if (zone === null) return null;
  if (zone === "on-aim") return "on";
  return zone === "too-easy" || zone === "over-aim" ? "above" : "below";
}

/** Consecutive batteries on one side of the aim, counted back from the latest placed one. */
export function offAimStreak(
  batteries: readonly PulseBattery[],
): { side: "above" | "below"; rounds: number } | null {
  const sides = batteries.flatMap((battery) => sideOf(battery.zone) ?? []);
  const last = sides.at(-1);
  if (last === undefined || last === "on") return null;
  let rounds = 0;
  for (let index = sides.length - 1; index >= 0 && sides[index] === last; index -= 1) rounds += 1;
  return { side: last, rounds };
}

function streakText(batteries: readonly PulseBattery[]): string {
  const streak = offAimStreak(batteries);
  if (streak === null) return "";
  const limit = POLICY.climb.offAimStreakRounds;
  const next = streak.rounds === limit - 1 ? `; one more ${streak.side} the aim stops the campaign` : "";
  return `, ${streak.side} the aim ${String(streak.rounds)} of ${String(limit)} in a row${next}`;
}

function batteryText(battery: PulseBattery): string {
  const extra = [
    battery.unaccepted > 0 ? `${String(battery.unaccepted)} unaccepted` : null,
    battery.nonResults > 0 ? `${String(battery.nonResults)} non-result` : null,
  ].filter((part) => part !== null);
  const tail = extra.length === 0 ? "" : ` (${extra.join(", ")})`;
  return `${String(battery.passed)}/${String(battery.verified)}${tail}`;
}

function planText(plan: PulsePlan): string {
  const bound = plan.comparator === "at-most" ? "≤" : "≥";
  return `plan ${bound}${String(plan.verifiedPasses)}, predictions expect ${String(plan.expected)} of ${String(plan.predictions)}`;
}

/** The row's evidence as paths inside its campaign, with the run id, which every one repeats, as `<run>`. */
function evidenceLook(row: Observation, reading: PulseReading, slug: string): string[] {
  const prefix = `campaigns/${slug}/`;
  return row.evidence.map((path) => {
    const inside = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    return inside.replaceAll(reading.runId, "<run>");
  });
}

/** A round nothing has been recorded for yet. */
function emptyRound(number: number, epoch: string | null): PulseRound {
  return {
    number,
    epoch,
    checkpointAt: null,
    toolCalls: null,
    failedCalls: null,
    previews: 0,
    clearPreviews: 0,
    firstClearMs: null,
    accepted: 0,
    refused: 0,
    refusalCodes: [],
    rehearsals: [],
    plan: null,
    headline: null,
    unread: [],
  };
}

/** The latest battery with its placement and the streak it extends, or null before the first. */
function latestBattery(reading: PulseReading): string | null {
  const battery = reading.batteries.at(-1);
  if (battery === undefined) return null;
  const zone =
    battery.zone === null ? "no placement" : `${battery.zone}${battery.recorded ? "" : " (provisional)"}`;
  return `${batteryText(battery)} pass of verified, ${zone}${streakText(reading.batteries)}`;
}

function rowEvent(row: Observation, after: PulseReading, slug: string): PulseEvent | null {
  const event = (mark: PulseEvent["mark"], text: string): PulseEvent => ({
    mark,
    label: after.label,
    text,
    look: evidenceLook(row, after, slug),
  });
  const summary = (row.summary ?? "").slice(0, 200);
  const key = `${row.phase ?? row.type ?? "row"}:${row.state ?? ""}`;
  if (row.level === "error") return event("⚠", `${key} ${summary}`);
  if (row.type !== PHASE_TRANSITION || ROUTINE.has(key)) return null;
  if (row.parentId !== null) {
    return key === "analyse:completed" ? event("·", `review during the build: ${summary}`) : null;
  }
  if (key === "claim:completed") return event("◆", `battery recorded: ${latestBattery(after) ?? summary}`);
  return event(LOUD.has(key) ? "◆" : "·", LOUD.get(key) ?? (summary === "" ? key : summary));
}

function roundOpened(row: Observation, number: number, after: PulseReading): PulseEvent {
  const kind = /\((\w+)\)/.exec(row.summary ?? "")?.[1] ?? "build";
  const last = latestBattery(after);
  const history = last === null ? "" : `; last battery ${last}`;
  return {
    mark: "◆",
    label: after.label,
    text: `round ${String(number)} opened, a ${kind}${history}`,
    look: [],
  };
}

function observationEvents(before: PulseReading, after: PulseReading, slug: string): PulseEvent[] {
  const events: PulseEvent[] = [];
  const fresh = after.observations.slice(before.observations.length);
  let opened = roundsOpened(before.observations);
  for (const row of fresh) {
    if (
      row.parentId === null &&
      row.type === PHASE_TRANSITION &&
      row.phase === "build" &&
      row.state === "started"
    ) {
      opened += 1;
      events.push(roundOpened(row, opened, after));
      continue;
    }
    const event = rowEvent(row, after, slug);
    if (event !== null) events.push(event);
  }
  return events;
}

function rehearsalEvent(label: string, round: number, index: number, rehearsal: PulseRehearsal): PulseEvent {
  const { verdict, predicted } = rehearsal;
  const surprise = predicted !== null && Math.abs((verdict === "pass" ? 1 : 0) - predicted) >= SURPRISE;
  const mark = verdict === "not-run" ? "⚠" : surprise ? "◆" : "·";
  const prediction = predicted === null ? ", no prediction" : `, predicted ${String(predicted)}`;
  const against = surprise ? ", against its prediction" : "";
  return {
    mark,
    label,
    text: `r${String(round)} rehearsal ${String(index + 1)} ${rehearsal.taskId}: ${verdict}${prediction}${against}`,
    look: [],
  };
}

function planEvent(label: string, round: number, plan: PulsePlan): PulseEvent {
  // How far the plan's own predictions sit on the wrong side of its target: above an at-most
  // target, or below an at-least one.
  const gap =
    plan.comparator === "at-most" ? plan.expected - plan.verifiedPasses : plan.verifiedPasses - plan.expected;
  const contradiction = Math.round(gap * 10) / 10;
  const flag =
    contradiction >= 1
      ? `; its predictions sit ${String(contradiction)} on the wrong side of its own target`
      : "";
  return {
    mark: contradiction >= 1 ? "⚠" : "·",
    label,
    text: `r${String(round)} ${planText(plan)}${flag}`,
    look: [],
  };
}

/** What moved inside the authoring round. A round that changed is compared from an empty one, except
 *  for its failed calls, which a new session starts counting again. */
function roundEvents(before: PulseReading, after: PulseReading): PulseEvent[] {
  const now = after.round;
  const same = before.round.number === now.number && before.round.epoch === now.epoch;
  const was = same ? before.round : { ...emptyRound(now.number, now.epoch), failedCalls: now.failedCalls };
  const label = after.label;
  const events: PulseEvent[] = [];
  const say = (mark: PulseEvent["mark"], text: string, look: string[] = []) =>
    events.push({ mark, label, text: `r${String(now.number)} ${text}`, look });
  if (now.clearPreviews > 0 && was.clearPreviews === 0) {
    const at = now.firstClearMs === null ? "" : ` ${duration(now.firstClearMs)} into the session`;
    say("◆", `first clear preview${at}; previews so far: ${String(now.previews)}`);
  }
  if (now.accepted > was.accepted) say("◆", "submit accepted");
  if (now.refused > was.refused) {
    const codes = now.refusalCodes.filter((code) => !was.refusalCodes.includes(code));
    say("·", `submit refused${codes.length === 0 ? "" : `: ${codes.join(", ")}`}`);
  }
  const heard = was.rehearsals.length;
  events.push(
    ...now.rehearsals.slice(heard).map((row, index) => rehearsalEvent(label, now.number, heard + index, row)),
  );
  if (now.plan !== null && JSON.stringify(was.plan) !== JSON.stringify(now.plan)) {
    events.push(planEvent(label, now.number, now.plan));
  }
  const burst = (now.failedCalls ?? 0) - (was.failedCalls ?? 0);
  if (burst >= FAILED_BURST) {
    say("⚠", `${String(burst)} failed Builder calls since the last look`, [
      `${now.epoch ?? "?"}/builder-execution.json`,
    ]);
  }
  return events;
}

function quiet(reading: PulseReading): number | null {
  const at = reading.round.checkpointAt;
  if (stageOf(reading) !== "build" || at === null) return null;
  const quietMs = reading.now - Date.parse(at);
  return quietMs >= QUIET_MS ? quietMs : null;
}

/** Alerts that hold a state: each is said once when it starts and once when it clears. */
function heldEvents(before: PulseReading, after: PulseReading): PulseEvent[] {
  const events: PulseEvent[] = [];
  const label = after.label;
  const wasQuiet = quiet(before) !== null;
  const quietMs = quiet(after);
  if (quietMs !== null && !wasQuiet) {
    events.push({
      mark: "⚠",
      label,
      text: `no Builder checkpoint for ${duration(quietMs)} in round ${String(after.round.number)}`,
      look: [`${after.round.epoch ?? "?"}/builder-prose.jsonl`],
    });
  }
  if (quietMs === null && wasQuiet && after.terminal === null) {
    events.push({ mark: "·", label, text: "Builder checkpoints again", look: [] });
  }
  const nonResults = (reading: PulseReading) =>
    reading.batteries.reduce((sum, battery) => sum + battery.nonResults, 0);
  const newNonResults = nonResults(after) - nonResults(before);
  if (newNonResults > 0) {
    events.push({
      mark: "⚠",
      label,
      text: `new non-result cases since the last look: ${String(newNonResults)}`,
      look: [CASE_RECORD_FILE],
    });
  }
  const gone = after.state === "orphaned" || after.state === "service-stopped";
  if (gone && before.state !== after.state && after.terminal === null) {
    events.push({
      mark: "⚠",
      label,
      text: `${after.state}: the process is gone and no terminal is recorded`,
      look: [],
    });
  }
  return events;
}

/** Safeguards that fired since the last look, one line per name. */
function safeguardEvents(before: PulseReading, after: PulseReading): PulseEvent[] {
  const fired = new Map<string, number>();
  for (const name of after.safeguards.slice(before.safeguards.length)) {
    fired.set(name, (fired.get(name) ?? 0) + 1);
  }
  return [...fired].map(([name, times]) => ({
    mark: "·",
    label: after.label,
    text: `safeguard ${name}${times === 1 ? "" : ` ×${String(times)}`}`,
    look: ["safeguards/<run>/SAFEGUARDS_LOG.txt"],
  }));
}

/**
 * The events between two readings of one run, in the order a reader would want them. Silent on the
 * first reading, because there is nothing yet to differ from.
 */
export function pulseEvents(
  before: PulseReading | undefined,
  after: PulseReading,
  slug: string,
): PulseEvent[] {
  if (before === undefined) return [];
  const events = [
    ...observationEvents(before, after, slug),
    ...roundEvents(before, after),
    ...heldEvents(before, after),
    ...safeguardEvents(before, after),
  ];
  if (after.terminal !== null && before.terminal === null) {
    events.push({ mark: "◆", label: after.label, text: `ended: ${after.terminal}`, look: [] });
  }
  return events;
}

function buildStatus(reading: PulseReading): string {
  const round = reading.round;
  const opened = topLevel(reading.observations).findLast(
    (row) => row.phase === "build" && row.state === "started",
  );
  const passes = round.rehearsals.filter((row) => row.verdict === "pass").length;
  const notRun = round.rehearsals.filter((row) => row.verdict === "not-run").length;
  const checkpoint = round.checkpointAt === null ? null : reading.now - Date.parse(round.checkpointAt);
  return [
    `r${String(round.number)} build ${opened === undefined ? "?" : duration(reading.now - Date.parse(opened.at))}`,
    `previews ${String(round.previews)}${round.clearPreviews > 0 ? ` (${String(round.clearPreviews)} clear)` : ""}`,
    round.rehearsals.length === 0
      ? null
      : `rehearsals ${String(passes)}/${String(round.rehearsals.length)} pass${notRun > 0 ? `, ${String(notRun)} not-run` : ""}`,
    round.accepted + round.refused === 0
      ? null
      : `submits ${String(round.accepted)} accepted, ${String(round.refused)} refused`,
    round.plan === null ? null : planText(round.plan),
    round.toolCalls === null
      ? null
      : `${String(round.toolCalls)} tool calls (${String(round.failedCalls ?? 0)} failed)`,
    checkpoint === null ? null : `checkpoint ${duration(checkpoint)} ago`,
    round.headline === null || round.headline === "" ? null : `"${round.headline}"`,
    round.unread.length === 0 ? null : `not read by this tree: ${round.unread.join(", ")}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

function measureStatus(reading: PulseReading): string {
  const rows = topLevel(reading.observations);
  const since = rows.findLastIndex((row) => row.phase === "solve" && row.state === "started");
  const pool = since < 0 ? [] : rows.slice(since);
  const count = (state: string) =>
    pool.filter((row) => row.phase === "measure-on" && row.state === state).length;
  const submitted = count("completed");
  const began = pool[0]?.at;
  const clock = began === undefined ? "" : `, ${duration(reading.now - Date.parse(began))}`;
  return `measuring: ${String(submitted)} submitted, ${String(count("started") - submitted)} solving${clock}`;
}

/** One line saying where a run stands, in the terms of the stage it is in. No ids and no digests. */
export function statusLine(reading: PulseReading, width: number): string {
  const stage = stageOf(reading);
  const elapsed = reading.startedAt === null ? "?" : duration(reading.now - Date.parse(reading.startedAt));
  const last = topLevel(reading.observations).at(-1);
  const body = {
    opening: () => "opening",
    build: () => buildStatus(reading),
    measuring: () => measureStatus(reading),
    reviewing: () =>
      `reviewing: ${last?.summary ?? "?"}${last === undefined ? "" : ` ${duration(reading.now - Date.parse(last.at))}`}`,
    ended: () => `ended: ${reading.terminal ?? "?"}`,
  }[stage]();
  const batteries = reading.batteries.map(batteryText).join(" ");
  const history = batteries === "" ? "" : ` | batteries ${batteries}${streakText(reading.batteries)}`;
  return `${reading.label.padEnd(width)} ${elapsed.padStart(7)}  ${body}${history}`;
}

// ---------------------------------------------------------------------------------------------
// Reading one run from its recorded files.

function readJson(path: string): JsonValue | null {
  try {
    return existsSync(path) ? parseJsonAs<JsonValue>(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

/** The round's rehearsals, from every evidence file the controller wrote for this epoch. */
function readRehearsals(epochDir: string) {
  const dir = join(epochDir, "rehearsals");
  const rows: PulseRehearsal[] = [];
  const unread: string[] = [];
  if (!existsSync(dir)) return { rows, unread };
  const ordinal = (name: string) => Number(/-(\d+)\.json$/.exec(name)?.[1] ?? 1);
  const files = readdirSync(dir)
    .filter((name) => name.startsWith(EVIDENCE_STEM) && name.endsWith(".json"))
    .sort((left, right) => ordinal(left) - ordinal(right));
  for (const name of files) {
    const parsed = readJson(join(dir, name));
    if (!isRecord(parsed) || parsed.schema !== EVIDENCE_SCHEMA || !Array.isArray(parsed.rehearsals)) {
      const schema = isRecord(parsed) && isString(parsed.schema) ? parsed.schema : "unparsed";
      unread.push(`${name} (${schema})`);
      continue;
    }
    for (const row of parsed.rehearsals) {
      if (!isRecord(row) || !isString(row.taskId) || !isString(row.verdict)) continue;
      rows.push({
        taskId: row.taskId,
        verdict: row.verdict,
        predicted: isNumber(row.predicted) ? row.predicted : null,
      });
    }
  }
  return { rows, unread };
}

function readPlan(workspace: string): PulsePlan | null {
  const plan = currentPlan(workspace);
  if (plan === null) return null;
  const expected = plan.predictions.reduce((sum, prediction) => sum + prediction.pass, 0);
  return {
    comparator: plan.target.comparator,
    verifiedPasses: plan.target.verifiedPasses,
    expected: Math.round(expected * 10) / 10,
    predictions: plan.predictions.length,
  };
}

function readHeadline(path: string): string | null {
  let lines: string[];
  try {
    lines = readFileSync(path, "utf8").trimEnd().split("\n");
  } catch {
    return null;
  }
  for (const line of lines.toReversed()) {
    const row = parseJsonAs<JsonValue>(line);
    if (!isRecord(row) || !isString(row.text) || (row.kind !== "reasoning" && row.kind !== "message")) {
      continue;
    }
    const heading = [...row.text.matchAll(/\*\*([^*\n]+)\*\*/g)].at(-1)?.[1] ?? row.text.split("\n")[0] ?? "";
    return heading.trim().slice(0, 60);
  }
  return null;
}

function currentEpoch(campaignDir: string): string | null {
  try {
    return readEpochRecord(campaignDir)?.current ?? null;
  } catch {
    return null;
  }
}

function readRound(campaignDir: string, number: number): PulseRound {
  const epoch = currentEpoch(campaignDir);
  const empty = emptyRound(number, epoch);
  if (epoch === null) return empty;
  const epochDir = join(campaignDir, epoch);
  let records: ReturnType<typeof readExecutionEvidence>;
  try {
    records = readExecutionEvidence(epochDir);
  } catch {
    records = [];
  }
  const record = records.reduce<(typeof records)[number] | null>(
    (latest, next) => (latest === null || next.writtenAt > latest.writtenAt ? next : latest),
    null,
  );
  const rehearsals = readRehearsals(epochDir);
  const workspace = join(epochDir, "workspace");
  const plan = readPlan(workspace);
  const planUnread = plan === null && existsSync(join(workspace, EXPERIMENT_FILE)) ? [EXPERIMENT_FILE] : [];
  const round = {
    ...empty,
    rehearsals: rehearsals.rows,
    plan,
    unread: [...rehearsals.unread, ...planUnread],
  };
  if (record === null) return round;
  const previews = record.customCalls.filter((call) => call.tool === "correctness_check");
  const clear = previews.filter((call) => call.semantic?.outcome === "clear");
  const candidates = record.submits.filter((submit) => submit.kind === "candidate");
  const refused = candidates.filter((submit) => submit.outcome === "refused");
  return {
    ...round,
    checkpointAt: record.writtenAt,
    headline:
      record.proseCapture === undefined ? null : readHeadline(join(epochDir, record.proseCapture.file)),
    toolCalls: record.toolCalls.total,
    failedCalls: record.toolCalls.failed,
    previews: previews.length,
    clearPreviews: clear.length,
    firstClearMs: clear[0]?.startedAtMs ?? null,
    accepted: candidates.length - refused.length,
    refused: refused.length,
    refusalCodes: [...new Set(refused.flatMap((submit) => submit.findingCodes))],
  };
}

/** Each battery with the zone its recorded decision placed it in, or a provisional one. */
function readBatteries(row: RunRow, band: readonly [number, number]): PulseBattery[] {
  const decisions = readDifficultyDecisions(row.location).rows;
  return row.cases.batteries.map(({ runId, tally }) => {
    const decided = decisions.find((decision) => decision.evidenceRunIds.at(-1) === runId)?.placement ?? null;
    // The difficulty denominator keeps unaccepted attempts as fails once any case is verified.
    const scored = tally.verified === 0 ? 0 : tally.verified + tally.unaccepted;
    const placed = decided?.zone ?? placeOnBand(tally.passed, scored, band)?.zone ?? null;
    return {
      passed: tally.passed,
      verified: tally.verified,
      unaccepted: tally.unaccepted,
      nonResults: tally.nonResults,
      zone: placed,
      recorded: decided !== null,
    };
  });
}

function readPulse(row: RunRow, now: number, band: readonly [number, number]) {
  const { campaignDir } = row.location;
  const observations = readObservations(campaignDir, row.runId);
  const terminal = row.liveness.state === "closed" ? readRunEvidence(row.location).terminal : null;
  const safeguardLog = safeguardLogFile(campaignDir, row.runId);
  let safeguards: string[] = [];
  try {
    safeguards = parseSafeguardLog(readFileSync(safeguardLog, "utf8")).firings.map((firing) => firing.name);
  } catch {
    // No safeguard fired, or the log cannot be read; either way there is no lead to report.
  }
  return {
    runId: row.runId,
    label: pulseLabel(row.runId),
    state: row.liveness.state,
    now,
    startedAt: row.startedAt,
    observations,
    round: readRound(campaignDir, roundsOpened(observations)),
    batteries: readBatteries(row, band),
    safeguards,
    terminal:
      terminal === null
        ? null
        : [terminal.outcome ?? "no outcome", terminal.terminalReason?.slice(0, 160)]
            .filter(Boolean)
            .join(": "),
  } satisfies PulseReading;
}

// ---------------------------------------------------------------------------------------------
// The loop.

function selected(row: RunRow, selectors: readonly string[], watched: ReadonlySet<string>): boolean {
  if (watched.has(row.runId)) return true;
  if (selectors.length === 0) return row.liveness.state !== "closed";
  const label = pulseLabel(row.runId);
  return selectors.some(
    (selector) => row.runId.startsWith(selector) || label.includes(selector) || row.slug === selector,
  );
}

function hostLine(repoRoot: string): string {
  const disk = statfsSync(join(repoRoot, "campaigns"));
  const freeGiB = Math.floor((disk.bavail * disk.bsize) / 1024 ** 3);
  const floor =
    freeGiB < DEFAULT_DISK_MIN_GIB ? `, under the launcher's ${String(DEFAULT_DISK_MIN_GIB)} GiB floor` : "";
  return `load ${loadavg()[0]?.toFixed(1) ?? "?"} · ${String(freeGiB)} GiB free${floor}`;
}

/** One look at the selected runs: a status line each, then what moved since the previous look. */
function pulseTick(
  repoRoot: string,
  selectors: readonly string[],
  previous: Map<string, PulseReading>,
): string[] {
  const now = Date.now();
  const band = climbThresholds(join(repoRoot, FROZEN_MANIFEST_PATH)).band;
  const watched = new Set(previous.keys());
  const rows = collectRows(repoRoot, { closedLimit: Number.MAX_SAFE_INTEGER, now }).filter((row) =>
    selected(row, selectors, watched),
  );
  const stamp = `${new Date(now).toISOString().slice(11, 16)}Z`;
  const readings = rows.map((row) => ({ row, reading: readPulse(row, now, band) }));
  const width = Math.max(0, ...readings.map(({ reading }) => reading.label.length));
  const lines = [
    `${stamp} ${String(rows.length)} run${rows.length === 1 ? "" : "s"} · ${hostLine(repoRoot)}`,
  ];
  const events: string[] = [];
  for (const { row, reading } of readings) {
    lines.push(`  ${statusLine(reading, width)}`);
    // The first look says where each run's files are, so the event pointers can stay short.
    if (!previous.has(row.runId)) lines.push(`  ${" ".repeat(width)} ${shortPath(row.location.campaignDir)}`);
    for (const event of pulseEvents(previous.get(row.runId), reading, row.slug)) {
      const look = event.look.length === 0 ? "" : ` → ${event.look.join(", ")}`;
      events.push(`${stamp} ${event.mark} ${event.label} ${event.text}${look}`);
    }
    // A run that ended is said once and then no longer watched.
    if (reading.terminal === null) previous.set(row.runId, reading);
    else previous.delete(row.runId);
  }
  return [...lines, ...events];
}

/** Look every `everyMs` until interrupted, or once. */
export async function runPulse(
  repoRoot: string,
  selectors: readonly string[],
  everyMs: number | null,
): Promise<number> {
  const previous = new Map<string, PulseReading>();
  for (;;) {
    process.stdout.write(`${pulseTick(repoRoot, selectors, previous).join("\n")}\n`);
    if (everyMs === null) return 0;
    await Bun.sleep(everyMs);
  }
}
