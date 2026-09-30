/**
 * `bun run runs pulse` — what changed in the open runs since the last look.
 *
 * `list` and `show` answer where a run stands; a run that is being watched raises a different
 * question every few minutes, which is what moved. Answering it by hand meant re-reading the
 * observability journal, the Builder's execution checkpoint with its rehearsals and the case
 * record for every run and remembering what each said last time. This keeps one reading
 * per run between looks and prints the difference as events: `◆` a stage worth reading (a round
 * opened, a battery recorded, the run ended), `⚠` something that may be wrong (an error row, a
 * quiet Builder, a non-result, a not-run rehearsal), `·` a smaller fact. The readings are kept in
 * a state file between looks, so `--once` prints the difference too; a first look, with no
 * readings kept, prints status lines only.
 *
 * Read-only, like the rest of `runs`: every value comes from a recorded file through its owner's
 * reader, and a file that cannot be read leaves its part of the reading empty rather than guessed.
 */
import type { BandZone } from "../../src/claim/battery-difficulty.ts";
import { CASE_RECORD_FILE } from "../../src/claim/case-record.ts";
import { FROZEN_MANIFEST_PATH } from "../../src/critic/manifest.ts";
import { statfsSync } from "../../src/meta/filesystem.ts";
import { isNumber, isRecord, isString } from "../../src/meta/json-shape.ts";
import { availableParallelism, loadavg } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { climbThresholds } from "../../src/run/climb-history.ts";
import { DEFAULT_DISK_MIN_GIB } from "../../.claude/skills/launch-run/scripts/options.ts";
import type { Observation } from "./evidence.ts";
import { duration, shortPath } from "./format.ts";
import {
  busyUnder,
  loadMemory,
  readProcessTable,
  saveMemory,
  type Busy,
  type PulseMemory,
} from "./pulse-host.ts";
import {
  emptyRound,
  PHASE_TRANSITION,
  pulseLabel,
  readPulse,
  roundsOpened,
  topLevel,
  type PulseBattery,
  type PulseReading,
  type PulseRehearsal,
} from "./pulse-read.ts";
import { collectRows, type RunRow } from "./rows.ts";

/** A Builder checkpoint older than this, in a build, is worth a look. */
const QUIET_MS = 20 * 60_000;
/** Failed Builder calls between two looks that make a burst rather than ordinary friction. */
const FAILED_BURST = 3;
/** The flat line of AGENTS.md "Goals and the climb": this many batteries in a row on one side of the
 *  aim that came no closer to it than the closest before them, counted by side rather than zone
 *  (`offAimStreak`). The climb reader's `flat` (`climb-velocity.ts`) reads the same rule. The
 *  controller never stops on it (`LoopState`), so the stall is the operator's call. */
export const STALL_BATTERIES = 3;
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
/** Transitions worth a `◆`, with the words to use; null keeps the row's own summary. */
const LOUD = new Map<string, string | null>([
  ["adopt:completed", "product adopted; its battery is next"],
  ["solve:started", "battery started"],
  ["analyse:completed", null],
  ["admission:completed", null],
]);

interface PulseEvent {
  mark: "◆" | "⚠" | "·";
  label: string;
  text: string;
  /** Campaign-relative files to read next. */
  look: string[];
}

type Stage = "opening" | "build" | "measuring" | "reviewing" | "ended";

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

/** Consecutive batteries on one side of the aim, counted back from the latest placed one, and how
 *  many of them came after the one closest to the aim, which a tie does not replace. Above the aim a
 *  lower pass rate is closer, below it a higher one. */
export function offAimStreak(batteries: readonly Pick<PulseBattery, "zone" | "placedOn">[]): {
  side: "above" | "below";
  rounds: number;
  flat: number;
  closest: { passes: number; n: number };
} | null {
  const placed = batteries.flatMap(({ zone, placedOn }) =>
    zone === null || placedOn === null ? [] : [{ side: sideOf(zone), ...placedOn }],
  );
  const side = placed.at(-1)?.side;
  if (side !== "above" && side !== "below") return null;
  const streak = placed.slice(placed.findLastIndex((battery) => battery.side !== side) + 1);
  const closeness = ({ passes, n }: { passes: number; n: number }) =>
    (side === "above" ? -1 : 1) * (passes / n);
  const closest = streak.reduce((best, battery) => (closeness(battery) > closeness(best) ? battery : best));
  return { side, rounds: streak.length, flat: streak.length - 1 - streak.lastIndexOf(closest), closest };
}

function streakText(batteries: readonly PulseBattery[]): string {
  const streak = offAimStreak(batteries);
  if (streak === null) return "";
  const text = `, ${streak.side} the aim ${String(streak.rounds)} in a row`;
  if (streak.flat < STALL_BATTERIES) return text;
  const { passes, n } = streak.closest;
  return `${text}; the ${String(streak.flat)} since ${String(passes)}/${String(n)} came no closer, a stall`;
}

function batteryText(battery: PulseBattery): string {
  const extra = [
    battery.unaccepted > 0 ? `${String(battery.unaccepted)} unaccepted` : null,
    battery.nonResults > 0 ? `${String(battery.nonResults)} non-result` : null,
  ].filter((part) => part !== null);
  const tail = extra.length === 0 ? "" : ` (${extra.join(", ")})`;
  return `${String(battery.passed)}/${String(battery.verified)}${tail}`;
}

/** The row's evidence as paths inside its campaign, with the run id, which every one repeats, as `<run>`. */
function evidenceLook(row: Observation, reading: PulseReading, slug: string): string[] {
  const prefix = `campaigns/${slug}/`;
  return row.evidence.map((path) => {
    const inside = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    return inside.replaceAll(reading.runId, "<run>");
  });
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
  const { verdict } = rehearsal;
  return {
    mark: verdict === "not-run" ? "⚠" : "·",
    label,
    text: `r${String(round)} rehearsal ${String(index + 1)} ${rehearsal.taskId}: ${verdict}${rehearsal.submitted === false ? " (nothing submitted)" : ""}`,
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
      text: `no Builder checkpoint for ${duration(quietMs)} in round ${String(after.round.number)}; ${inFlightText(after) ?? busyText(after.busy) ?? "no command running, so the model turn itself is long"}`,
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

/** Each Epoch Review recorded since the last look. */
function reviewEvents(before: PulseReading, after: PulseReading): PulseEvent[] {
  return after.batteries.flatMap((battery, index) => {
    const review = battery.review;
    const was = before.batteries[index];
    if (review === undefined || review === null || (was !== undefined && was.review !== null)) return [];
    const blocking = review.blocking === 0 ? "" : `, ${String(review.blocking)} blocking`;
    return [
      {
        mark: "◆",
        label: after.label,
        text: `review of battery ${String(index + 1)} ${review.status}: ${String(review.findings)} finding(s)${blocking}`,
        look: [review.file.replaceAll(after.runId, "<run>")],
      },
    ];
  });
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
    ...reviewEvents(before, after),
    ...safeguardEvents(before, after),
  ];
  if (after.terminal !== null && before.terminal === null) {
    events.push({ mark: "◆", label: after.label, text: `ended: ${after.terminal}`, look: [] });
  }
  return events;
}

/** A rehearsal holds one Builder tool call for up to the solve wall, which reads as a quiet
 *  checkpoint unless it is named. */
function inFlightText(reading: PulseReading): string | null {
  const running = reading.round.inFlight;
  if (running === null) return null;
  const what =
    running.taskId === null
      ? "checking a candidate"
      : `${running.stage === "solving" ? "rehearsing" : "grading"} ${running.taskId}`;
  return `${what} for ${duration(reading.now - Date.parse(running.startedAt))}`;
}

function busyText(busy: Busy | null): string | null {
  return busy === null ? null : `running ${duration(busy.forMs)}: ${busy.command.slice(0, 60)}`;
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
    round.toolCalls === null
      ? null
      : `${String(round.toolCalls)} tool calls (${String(round.failedCalls ?? 0)} failed)`,
    checkpoint === null ? null : `checkpoint ${duration(checkpoint)} ago`,
    inFlightText(reading),
    busyText(reading.busy),
    round.headline === null || round.headline === "" ? null : `"${round.headline}"`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

function measureStatus(reading: PulseReading): string {
  const rows = topLevel(reading.observations);
  const since = rows.findLastIndex((row) => row.phase === "solve" && row.state === "started");
  // Between a round's build row and its solve the gate runs, and any earlier solve belongs to the
  // battery before. A `measure` round's only build row is `completed`, so any state opens a round.
  const last = rows.at(-1);
  if (since <= rows.findLastIndex((row) => row.phase === "build") && last !== undefined) {
    return `gating: ${last.phase} ${duration(reading.now - Date.parse(last.at))}`;
  }
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
// The loop.

/**
 * Whether a kept reading holds every field `pulseEvents` reads from the earlier side. The fields the
 * status line alone reads come from the fresh reading, so they are not asked of a kept one.
 */
export function isPulseReading(value: unknown): value is PulseReading {
  return (
    isRecord(value) &&
    isString(value.state) &&
    isNumber(value.now) &&
    (value.terminal === null || isString(value.terminal)) &&
    Array.isArray(value.observations) &&
    value.observations.every(isRecord) &&
    Array.isArray(value.safeguards) &&
    Array.isArray(value.batteries) &&
    value.batteries.every((battery) => isRecord(battery) && isNumber(battery.nonResults)) &&
    isKeptRound(value.round)
  );
}

function isKeptRound(round: unknown): boolean {
  return (
    isRecord(round) &&
    isNumber(round.number) &&
    (round.epoch === null || isString(round.epoch)) &&
    (round.checkpointAt === null || isString(round.checkpointAt)) &&
    (round.failedCalls === null || isNumber(round.failedCalls)) &&
    isNumber(round.clearPreviews) &&
    isNumber(round.accepted) &&
    isNumber(round.refused) &&
    Array.isArray(round.refusalCodes) &&
    Array.isArray(round.rehearsals)
  );
}

/**
 * Whether one look reads this run. Selectors named on the command line are the whole answer, since
 * the kept readings are shared by every look and a run read once is not a run asked for again. With
 * none, every open run is read, and so is a kept run that has closed since, so its ending is said.
 */
export function selected(
  row: Pick<RunRow, "runId" | "slug"> & { liveness: Pick<RunRow["liveness"], "state"> },
  selectors: readonly string[],
  watched: ReadonlySet<string>,
): boolean {
  if (selectors.length === 0) return row.liveness.state !== "closed" || watched.has(row.runId);
  const label = pulseLabel(row.runId);
  return selectors.some(
    (selector) => row.runId.startsWith(selector) || label.includes(selector) || row.slug === selector,
  );
}

function hostLine(repoRoot: string, memory: PulseMemory<PulseReading>): string {
  const disk = statfsSync(join(repoRoot, "campaigns"));
  const freeGiB = Math.floor((disk.bavail * disk.bsize) / 1024 ** 3);
  const floor =
    freeGiB < DEFAULT_DISK_MIN_GIB ? `, under the launcher's ${String(DEFAULT_DISK_MIN_GIB)} GiB floor` : "";
  // Free space swings by tens of GiB as Builders compile and trim, so the move says more than the level.
  const moved = memory.freeGiB === null ? 0 : freeGiB - memory.freeGiB;
  const delta = moved === 0 ? "" : ` (${moved > 0 ? "+" : ""}${String(moved)} since the last look)`;
  memory.freeGiB = freeGiB;
  return `load ${loadavg()[0]?.toFixed(1) ?? "?"} of ${String(availableParallelism())} cores · ${String(freeGiB)} GiB free${delta}${floor}`;
}

/** One look at the selected runs: a status line each, then what moved since the previous look. */
function pulseTick(
  repoRoot: string,
  selectors: readonly string[],
  memory: PulseMemory<PulseReading>,
  table: Parameters<typeof busyUnder>[0],
): string[] {
  const now = Date.now();
  const band = climbThresholds(join(repoRoot, FROZEN_MANIFEST_PATH)).band;
  const previous = memory.readings;
  const watched = new Set(Object.keys(previous));
  const rows = collectRows(repoRoot, { closedLimit: Number.MAX_SAFE_INTEGER, now }).filter((row) =>
    selected(row, selectors, watched),
  );
  const stamp = `${new Date(now).toISOString().slice(11, 16)}Z`;
  const readings = rows.map((row) => ({
    row,
    reading: readPulse(row, now, band, busyUnder(table, row.liveness.pid)),
  }));
  const width = Math.max(0, ...readings.map(({ reading }) => reading.label.length));
  const lines = [
    `${stamp} ${String(rows.length)} run${rows.length === 1 ? "" : "s"} · ${hostLine(repoRoot, memory)}`,
  ];
  const events: string[] = [];
  for (const { row, reading } of readings) {
    lines.push(`  ${statusLine(reading, width)}`);
    // The first look says where each run's files are, so the event pointers can stay short.
    if (!(row.runId in previous)) lines.push(`  ${" ".repeat(width)} ${shortPath(row.location.campaignDir)}`);
    for (const event of pulseEvents(previous[row.runId], reading, row.slug)) {
      const look = event.look.length === 0 ? "" : ` → ${event.look.join(", ")}`;
      events.push(`${stamp} ${event.mark} ${event.label} ${event.text}${look}`);
    }
    // A run that ended is said once and then no longer watched.
    if (reading.terminal === null) previous[row.runId] = reading;
    else delete previous[row.runId];
  }
  return [...lines, ...events];
}

/**
 * Look every `everyMs` until interrupted, or once. The readings persist in `statePath` after each
 * look, so a watcher calling `--once` every few minutes is told what moved, as the loop would be.
 */
export async function runPulse(
  repoRoot: string,
  selectors: readonly string[],
  everyMs: number | null,
  statePath: string,
): Promise<number> {
  const memory = loadMemory(statePath, isPulseReading);
  for (;;) {
    process.stdout.write(`${pulseTick(repoRoot, selectors, memory, await readProcessTable()).join("\n")}\n`);
    const unsaved = saveMemory(statePath, memory);
    if (unsaved !== null) process.stderr.write(`${unsaved}\n`);
    if (everyMs === null) return 0;
    await Bun.sleep(everyMs);
  }
}
