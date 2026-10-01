/**
 * Reading one run for `bun run runs pulse` from its recorded files. Every value comes through its
 * owner's reader, and a file that cannot be read leaves its part of the reading empty rather than guessed.
 */
import { readExecutionEvidence } from "../outcome/builder-execution-facts.ts";
import { readEpochRecord } from "../../src/author/campaign-epoch.ts";
import type { BuilderCustomToolCall } from "../../src/author/builder-custom-tool-call.ts";
import { CASE_TRACE_FILE, PUBLIC_TASK_FILE } from "../../src/correctness-bundle/recorded-solve.ts";
import { CENSUS_FILE } from "../../src/run/census-gate.ts";
import type { BandZone, MeasuredDifficulty } from "../../src/claim/battery-difficulty.ts";
import type { ClimbBattery } from "../../src/run/climb-history.ts";
import { decideDifficulty } from "../../src/run/climb-readout.ts";
import { existsSync, lstatSync, readFileSync, readdirSync } from "../../src/meta/filesystem.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { isRecord, isString, type JsonValue } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";
import { readSafeguardLog } from "../../src/meta/safeguard.ts";
import { readDifficultyDecisions, readObservations, readRunEvidence, type Observation } from "./evidence.ts";
import type { Busy } from "./pulse-host.ts";
import type { RunRow } from "./rows.ts";

export const PHASE_TRANSITION = "phase-transition";

export type RunState = RunRow["liveness"]["state"];

export interface PulseRehearsal {
  taskId: string;
  verdict: string;
  /** False for a solve that accepted no submission, which a measured battery counts as a fail. */
  submitted: boolean | null;
}

/** A `harness_trial` the Builder is inside now: one tool call that can hold the session for the
 *  whole solve wall while no checkpoint lands. */
interface PulseInFlight {
  /** The rehearsed task; null for a candidate check, which runs every task. */
  taskId: string | null;
  /** `solving` until the Built solver's trace is written, then `grading` until its checks are;
   *  `checking` while a candidate check has not written its census. */
  stage: "solving" | "grading" | "checking";
  startedAt: string;
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
  inFlight: PulseInFlight | null;
  /** The last heading of the Builder's latest message or reasoning row: a hint of what it is doing,
   *  never evidence of what it did. */
  headline: string | null;
}

/** The Epoch Review of one battery, as its record says it ended. */
interface PulseReview {
  status: string;
  findings: number;
  blocking: number;
  /** The record, inside the campaign. */
  file: string;
}

export interface PulseBattery {
  passed: number;
  verified: number;
  unaccepted: number;
  nonResults: number;
  zone: BandZone | null;
  /** The counts that zone was placed on: the recorded decision's, which leave out a case its review
   *  settled against the check, or this battery's own tally. */
  placedOn: { passes: number; n: number } | null;
  /** The zone came from a recorded difficulty decision; otherwise it is placed here, provisionally. */
  recorded: boolean;
  /** Its Epoch Review once recorded; undefined in a reading kept before pulse read reviews. */
  review?: PulseReview | null;
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
  /** What the controller is waiting on at the look, from the process table: a live fact, never
   *  evidence, and the one that tells a quiet Builder's long command from a stalled session. */
  busy: Busy | null;
}

/** The run id without its launch instant, which every run id carries and none is told apart by. */
export function pulseLabel(runId: string): string {
  return runId.replace(/-\d{8}T\d{6,9}Z(?=-)/, "");
}

export function topLevel(observations: readonly Observation[]): Observation[] {
  return observations.filter((row) => row.parentId === null && row.type === PHASE_TRANSITION);
}

export function roundsOpened(observations: readonly Observation[]): number {
  return topLevel(observations).filter((row) => row.phase === "build" && row.state === "started").length;
}

/** A round nothing has been recorded for yet. */
export function emptyRound(number: number, epoch: string | null): PulseRound {
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
    inFlight: null,
    headline: null,
  };
}

function readJson(path: string): JsonValue | null {
  try {
    return existsSync(path) ? parseJsonAs<JsonValue>(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

/** The round's rehearsals, from the `harness_trial` calls its execution record holds. */
function readRehearsals(calls: readonly BuilderCustomToolCall[]): PulseRehearsal[] {
  return calls.flatMap((call) => {
    const verdict = call.semantic?.truthVerdict;
    if (call.tool !== "harness_trial" || call.target.taskId === undefined || verdict === undefined) return [];
    return [{ taskId: call.target.taskId, verdict, submitted: call.semantic?.submitted ?? null }];
  });
}

/** The rehearsal running now, from what `harness-trial.ts` has written of it: the task's case files
 *  at its start, the trace when the solve ends and `checks.json` once it is graded. An interrupted
 *  rehearsal never writes its checks, so only the newest directory counts, and only when it started
 *  after the round's last checkpoint, which every live tool call does. */
export function readInFlight(epochDir: string, checkpointAt: string | null): PulseInFlight | null {
  return readRehearsal(epochDir, checkpointAt) ?? readCheck(epochDir, checkpointAt);
}

/** A `correctness_check` (or a submit's gate) runs in `trials/<condition>/<label>-<n>`, which it
 *  opens as it starts and seals with its census last; a Builder call is only recorded once it
 *  returns, so custom-sol-3e4693's 23-minute check read as a long model turn. The condition
 *  directory changes only as a run opens inside it, so its time is the newest run's start. */
function readCheck(epochDir: string, checkpointAt: string | null): PulseInFlight | null {
  const dir = join(epochDir, "trials");
  try {
    const newest = readdirSync(dir)
      .map((name) => ({ name, at: lstatSync(join(dir, name)).mtimeMs }))
      .toSorted((left, right) => left.at - right.at)
      .at(-1);
    if (newest === undefined) return null;
    const startedAt = new Date(newest.at).toISOString();
    if (checkpointAt !== null && startedAt < checkpointAt) return null;
    const runs = readdirSync(join(dir, newest.name));
    if (runs.every((run) => existsSync(join(dir, newest.name, run, CENSUS_FILE)))) return null;
    return { taskId: null, stage: "checking", startedAt };
  } catch {
    return null;
  }
}

function readRehearsal(epochDir: string, checkpointAt: string | null): PulseInFlight | null {
  const dir = join(epochDir, "rehearsals");
  const ordinal = (name: string) => Number(name.slice("rehearsal-".length));
  try {
    const newest = readdirSync(dir)
      .filter((name) => /^rehearsal-\d+$/.test(name))
      .sort((left, right) => ordinal(left) - ordinal(right))
      .at(-1);
    if (newest === undefined || existsSync(join(dir, newest, "checks.json"))) return null;
    const cases = join(dir, newest, "cases");
    const taskId = readdirSync(cases)[0];
    if (taskId === undefined) return null;
    // The public task is written once, as the solve starts.
    const startedAt = new Date(lstatSync(join(cases, taskId, PUBLIC_TASK_FILE)).mtimeMs).toISOString();
    if (checkpointAt !== null && startedAt < checkpointAt) return null;
    const stage = existsSync(join(cases, taskId, CASE_TRACE_FILE)) ? "grading" : "solving";
    return { taskId, stage, startedAt };
  } catch {
    return null;
  }
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
  const round = {
    ...empty,
    rehearsals: readRehearsals(record?.customCalls ?? []),
    inFlight: readInFlight(epochDir, null),
  };
  if (record === null) return round;
  const previews = record.customCalls.filter((call) => call.tool === "correctness_check");
  const clear = previews.filter((call) => call.semantic?.outcome === "clear");
  const candidates = record.submits.filter((submit) => submit.kind === "candidate");
  const refused = candidates.filter((submit) => submit.outcome === "refused");
  return {
    ...round,
    inFlight: readInFlight(epochDir, record.writtenAt),
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

function readReview(campaignDir: string, runId: string): PulseReview | null {
  const file = `analysis/${runId}-epoch-review.json`;
  const record = readJson(join(campaignDir, file));
  if (!isRecord(record) || !Array.isArray(record.findings)) return null;
  return {
    status: isString(record.status) ? record.status : "?",
    findings: record.findings.length,
    blocking: record.findings.filter((finding) => isRecord(finding) && finding.severity === "blocking")
      .length,
    file,
  };
}

/** Each battery with the zone its recorded decision placed it in, or a provisional one. */
function readBatteries(row: RunRow, band: readonly [number, number]): PulseBattery[] {
  const decisions = readDifficultyDecisions(row.location).rows;
  return row.cases.batteries.map(({ runId, tally }) => {
    const decided = decisions.find((decision) => decision.evidenceRunIds.at(-1) === runId)?.placement ?? null;
    // Until the decision is recorded, placed as it will place the whole battery.
    const { passed, verified, unaccepted } = tally;
    const measured: MeasuredDifficulty = { items: [] };
    // SAFETY: `decideDifficulty` reads runId and batterySha256 only into the evidence it returns.
    const whole = { passed, unaccepted, measured, n: verified + unaccepted } as ClimbBattery;
    const placed = decided ?? decideDifficulty([whole], [...band]).placement;
    return {
      passed,
      verified,
      unaccepted,
      nonResults: tally.nonResults,
      zone: placed?.zone ?? null,
      placedOn: placed === null ? null : { passes: placed.passes, n: placed.n },
      recorded: decided !== null,
      review: readReview(row.location.campaignDir, runId),
    };
  });
}

export function readPulse(row: RunRow, now: number, band: readonly [number, number], busy: Busy | null) {
  const { campaignDir } = row.location;
  const observations = readObservations(campaignDir, row.runId);
  const terminal = row.liveness.state === "closed" ? readRunEvidence(row.location).terminal : null;
  let safeguards: string[] = [];
  try {
    safeguards = readSafeguardLog(campaignDir, row.runId)?.firings.map((firing) => firing.name) ?? [];
  } catch {
    // The log cannot be read, which leaves no lead to report, as an absent log does.
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
    busy,
  } satisfies PulseReading;
}
