import type { Api, Model } from "@earendil-works/pi-ai";
import { servedByClaude } from "#src/agent/backends/claude.ts";
import { CLAUDE_SESSIONS_DIR, type ClaudeFork } from "#src/agent/backends/claude-transcript.ts";
import type { Continuation } from "#src/agent/session.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { type Call, traceOf, type Turn } from "#src/kernel/trace.ts";
import { boundText } from "#src/meta/bounded-text.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { SEED_FILE } from "../runs/registry.ts";

export const FORK_OPTIONS = {
  "fork-from": { type: "string" },
  "at-turn": { type: "string" },
  "wrap-turns": { type: "string" },
  nudge: { type: "string" },
} as const;

interface ForkFlags {
  readonly "fork-from"?: string | undefined;
  readonly "at-turn"?: string | undefined;
  readonly "wrap-turns"?: string | undefined;
  readonly nudge?: string | undefined;
}

interface SeatForkPlan {
  readonly fork?: ClaudeFork | undefined;
  readonly continuation?: Continuation | undefined;
}

type SeatKind = "exam" | "draft" | "build";

const WRAP_CALL_ARGS_BYTES = 800;
const WRAP_CALL_TEXT_BYTES = 2400;
const WRAP_TURN_TEXT_BYTES = 6000;
const WRAP_TOTAL_BYTES = 160_000;

function seedSource(log: string, flag: string): string {
  const folder = dirname(log);
  const seedFile = join(folder, SEED_FILE);
  if (!basename(folder).startsWith("sim-") || !existsSync(seedFile)) {
    throw new Error(`${flag} is only allowed on a simulation seed (sim-<what> with ${SEED_FILE})`);
  }
  const parsed = parseJsonAs<{ from?: string }>(readFileSync(seedFile, "utf8"));
  return isString(parsed.from) ? parsed.from : folder;
}

function parsePositiveInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} ${raw}: expected a positive integer`);
  }
  return value;
}

function sourceLogs(log: string, fromDir: string): readonly string[] {
  const sourceLog = join(fromDir, LOG_FILE);
  return sourceLog === log || !existsSync(sourceLog) ? [log] : [log, sourceLog];
}

function defaultTurnCap(
  events: readonly LogEvent[],
  seat: SeatKind,
  session: string,
  root: string,
): number | undefined {
  const shared = events.some(
    ({ kind, data }) => kind === `${seat}.started` && data.session !== session && data.conversation === root,
  );
  if (!shared && root === session) return undefined;
  const lastTurn = traceOf(events, seat, session).turns.at(-1)?.turn ?? null;
  return lastTurn !== null && lastTurn >= 1 ? lastTurn : undefined;
}

function resolveSessionTurn(
  events: readonly LogEvent[],
  seat: SeatKind,
  session: string,
  root: string,
  requested: number | undefined,
): number | undefined {
  const sessionTurns = traceOf(events, seat, session).turns;
  if (requested !== undefined) {
    if (sessionTurns.length === 0) return requested;
    if (requested > sessionTurns.length) {
      throw new Error(
        `--at-turn ${String(requested)}: session ${session} recorded ${String(sessionTurns.length)} ${seat} turns`,
      );
    }
    return sessionTurns[requested - 1]?.turn ?? requested;
  }
  return defaultTurnCap(events, seat, session, root);
}

function resolveTranscript(
  log: string,
  fromDir: string,
  seat: SeatKind,
  target: string,
  requestedTurn: number | undefined,
): { readonly transcript: string; readonly upToTurn?: number | undefined } {
  if ((target.includes("/") || target.endsWith(".jsonl")) && existsSync(target)) {
    return { transcript: target, ...keyIfDefined("upToTurn", requestedTurn) };
  }
  if (!isSafePathSegment(target)) {
    throw new Error(`--fork-from ${target}: name a session id or an existing .jsonl transcript path`);
  }
  const roots = [dirname(log), ...(fromDir === dirname(log) ? [] : [fromDir])];
  const findFile = (name: string) =>
    roots
      .map((dir) => join(dir, CLAUDE_SESSIONS_DIR, `${name}.jsonl`))
      .find((candidate) => existsSync(candidate));
  const logs = sourceLogs(log, fromDir).toReversed();
  for (const candidateLog of logs) {
    const events = read(candidateLog);
    const started = events.find(({ kind, data }) => kind === `${seat}.started` && data.session === target);
    if (started === undefined) continue;
    const root = isString(started.data.conversation) ? started.data.conversation : target;
    const found = findFile(target) ?? (root === target ? undefined : findFile(root));
    if (found !== undefined) {
      return {
        transcript: found,
        ...keyIfDefined("upToTurn", resolveSessionTurn(events, seat, target, root, requestedTurn)),
      };
    }
  }
  const direct = findFile(target);
  if (direct !== undefined) return { transcript: direct, ...keyIfDefined("upToTurn", requestedTurn) };
  throw new Error(
    `no persisted Claude transcript for ${target} under ${CLAUDE_SESSIONS_DIR}/ (the run predates SDK transcript persistence; for a lossy seed-only screen from log.jsonl, pass --wrap-turns ${target}:<turn> explicitly)`,
  );
}

function formatCall(call: Call): string {
  const args = boundText(capturedJsonStringify(call.args), WRAP_CALL_ARGS_BYTES).text;
  const result = boundText(call.text || "(empty)", WRAP_CALL_TEXT_BYTES).text;
  const status = call.isError ? "error" : "ok";
  return `[call ${call.tool} (${status})] args: ${args}\nresult: ${result}`;
}

function formatWrapped(
  session: string,
  count: number,
  turns: readonly Turn[],
  calls: readonly Call[],
  nudge: string | undefined,
): string {
  const callsByTurn = new Map<number, Call[]>();
  for (const call of calls) {
    if (call.turn === null) continue;
    const list = callsByTurn.get(call.turn);
    if (list === undefined) callsByTurn.set(call.turn, [call]);
    else list.push(call);
  }
  const sections = turns.map((turn, index) => {
    const body = boundText(turn.text || "(no text)", WRAP_TURN_TEXT_BYTES).text;
    const turnCalls = turn.turn === null ? [] : (callsByTurn.get(turn.turn) ?? []);
    return [`--- Turn ${String(index + 1)} ---`, body, ...turnCalls.map(formatCall)].join("\n");
  });
  const header = `[SIMULATION WRAPPED PRIOR CONTEXT — reconstructed from recorded log turns 1..${String(count)} of ${session}; truncated to log trace bounds, not a native SDK transcript fork]`;
  const footer = `--- End of wrapped turns 1..${String(count)} of ${session} ---`;
  const closing = nudge ?? "Continue from this point in the session.";
  const body = boundText(sections.join("\n\n"), WRAP_TOTAL_BYTES).text;
  return [header, body, footer, closing].join("\n\n");
}

function buildWrappedContinuation(
  log: string,
  fromDir: string,
  seat: SeatKind,
  spec: string,
  nudge: string | undefined,
): Continuation {
  const colon = spec.lastIndexOf(":");
  if (colon <= 0 || colon === spec.length - 1) {
    throw new Error(`--wrap-turns ${spec}: expected <session>:<turn>, as --wrap-turns x-2:20`);
  }
  const session = spec.slice(0, colon);
  if (!isSafePathSegment(session)) {
    throw new Error(`--wrap-turns ${spec}: invalid session id ${session}`);
  }
  const count = parsePositiveInt(spec.slice(colon + 1), "--wrap-turns");
  for (const candidateLog of sourceLogs(log, fromDir)) {
    const { turns, calls } = traceOf(read(candidateLog), seat, session);
    if (turns.length === 0) continue;
    if (turns.length < count) {
      throw new Error(
        `--wrap-turns ${spec}: session ${session} recorded ${String(turns.length)} ${seat} turns, fewer than ${String(count)}`,
      );
    }
    return {
      mode: "wrap",
      text: formatWrapped(session, count, turns.slice(0, count), calls, nudge),
    };
  }
  throw new Error(`--wrap-turns ${spec}: no ${seat} turns recorded for session ${session}`);
}

export function seatForkPlan(log: string, seat: SeatKind, model: Model<Api>, flags: ForkFlags): SeatForkPlan {
  const { "fork-from": forkFrom, "at-turn": atTurn, "wrap-turns": wrapTurns, nudge: rawNudge } = flags;
  if (forkFrom === undefined && atTurn === undefined && wrapTurns === undefined && rawNudge === undefined) {
    return {};
  }
  if (forkFrom !== undefined && wrapTurns !== undefined) {
    throw new Error("name --fork-from or --wrap-turns, not both");
  }
  if (atTurn !== undefined && forkFrom === undefined) {
    throw new Error("--at-turn requires --fork-from");
  }
  const nudge = rawNudge === undefined ? undefined : rawNudge.trim();
  if (rawNudge !== undefined && nudge === "") {
    throw new Error("--nudge requires non-empty text");
  }
  const fallbackFlag = wrapTurns === undefined ? "--nudge" : "--wrap-turns";
  const activeFlag = forkFrom === undefined ? fallbackFlag : "--fork-from";
  const fromDir = seedSource(log, activeFlag);
  if (forkFrom !== undefined) {
    if (!servedByClaude(model.provider)) {
      throw new Error(`--fork-from requires a Claude backend seat, not ${model.provider}/${model.id}`);
    }
    const requested = atTurn === undefined ? undefined : parsePositiveInt(atTurn, "--at-turn");
    const resolved = resolveTranscript(log, fromDir, seat, forkFrom, requested);
    return {
      fork: { transcript: resolved.transcript, ...keyIfDefined("upToTurn", resolved.upToTurn) },
      continuation: { mode: "fork", text: nudge ?? "Continue from where you left off." },
    };
  }
  if (wrapTurns !== undefined) {
    return { continuation: buildWrappedContinuation(log, fromDir, seat, wrapTurns, nudge) };
  }
  return nudge === undefined ? {} : { continuation: { mode: "nudge", text: nudge } };
}
