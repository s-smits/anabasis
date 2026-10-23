/**
 * A seat's trace as an ATIF trajectory: Harbor's Agent Trajectory Interchange Format, v1.8, as its
 * pydantic models define it (harbor-framework/harbor, `src/harbor/models/trajectories/`, at
 * 6c9d3d66). Benchmarks that run on Harbor read an agent's run in this shape, Harbor's viewer
 * shows it, and Harness²'s agents write it, so a trace in it can be read beside theirs by their
 * tools instead of by a reader of this log.
 *
 * It is a view of `src/kernel/trace.ts` and reads nothing else. One step is one model turn: the
 * text it said, the calls it made, each call's result as an observation linked by the call's id,
 * and its tokens as Harbor's pi agent counts them (prompt is every input token, cache reads and
 * writes among them; cached is the reads). A call names the turn it belongs to, which a log of
 * before 22 October writes after the call and a durable seat's before it, so a call joins the turn
 * logged last where their numbers match and the turn logged next otherwise; a call that names no
 * turn joins the next, as the older order had it. A compaction is a system
 * step, its summaries' dollars in `extra`, since ATIF gives metrics to agent steps alone. Calls
 * that no turn ended, where a solve was cut mid-turn, close the trajectory as an agent step
 * without metrics.
 *
 * What the log never held stays out rather than being made up: the prompts the seat was given,
 * reasoning and non-text content. A call logged before 21 October has no provider id, and is
 * given one from its place in the log. What ATIF has no field for, a turn's stop reason and error,
 * a call's duration and whether it failed, goes in `extra` under Harbor's own snake case.
 */
import { asRecord, isNumber, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import type { LogEvent } from "./log.ts";
import { type Call, type Seat, type Turn, tracesIn } from "./trace.ts";

const ATIF_VERSION = "ATIF-v1.8";

/** What ATIF names the agent by, which the log does not hold: the caller says. */
interface Agent {
  readonly name: string;
  readonly version: string;
  readonly model: string | null;
}

/** The fields of `object` whose value is not null. */
const kept = (object: Record<string, JsonValue>): JsonObject =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null));

/** An `extra` of the fields that hold something, or null where none does. */
function extraOf(object: Record<string, JsonValue>): JsonObject | null {
  const own = kept(object);
  return Object.keys(own).length === 0 ? null : own;
}

const count = (usage: JsonObject, key: string) => (isNumber(usage[key]) ? usage[key] : 0);

/** A turn's usage as ATIF's metrics. */
function metricsOf(turn: Turn): JsonObject | null {
  const { usage } = turn;
  if (usage === null) return null;
  const cacheRead = count(usage, "cacheRead");
  const cacheWrite = count(usage, "cacheWrite");
  return kept({
    prompt_tokens: count(usage, "input") + cacheRead + cacheWrite,
    completion_tokens: count(usage, "output"),
    cached_tokens: cacheRead,
    cost_usd: turn.billed,
    extra: { cache_write_tokens: cacheWrite },
  });
}

function stepOf(calls: readonly Call[], turn: Turn | null, stepId: number): JsonObject {
  const ids = calls.map((call) => call.callId ?? `call-${String(call.index)}`);
  const at = turn?.at ?? calls.at(-1)?.at ?? null;
  return kept({
    step_id: stepId,
    timestamp: at,
    source: "agent",
    model_name: turn?.model ?? null,
    message: turn?.text ?? "",
    tool_calls:
      calls.length === 0
        ? null
        : calls.map((call, n) => {
            const args = asRecord(call.args);
            return kept({
              tool_call_id: ids[n] ?? "",
              function_name: call.tool,
              arguments: args ?? {},
              extra: extraOf({ duration_ms: call.ms, arguments: args === null ? call.args : null }),
            });
          }),
    observation:
      calls.length === 0
        ? null
        : {
            results: calls.map((call, n) => ({
              source_call_id: ids[n] ?? "",
              content: call.text,
              extra: { is_error: call.isError },
            })),
          },
    metrics: turn === null ? null : metricsOf(turn),
    extra: extraOf({
      stop_reason: turn?.stopReason ?? null,
      error: turn?.error ?? null,
      unfinished: turn === null ? true : null,
    }),
  });
}

/** Seat `seat`'s solve or session `id` in `events`, as one ATIF trajectory. */
export function trajectoryOf(events: readonly LogEvent[], seat: Seat, id: string, agent: Agent): JsonObject {
  const steps: JsonObject[] = [];
  let pending: Call[] = [];
  let last: { readonly turn: Turn; readonly calls: Call[] } | null = null;
  let compacted = 0;
  const next = () => steps.length + 1;
  const flush = () => {
    if (last !== null) steps.push(stepOf(last.calls, last.turn, next()));
    last = null;
  };
  for (const part of tracesIn(events)) {
    if (part.seat !== seat || part.id !== id) continue;
    if (part.part === "call") {
      if (last !== null && part.turn !== null && part.turn === last.turn.turn) last.calls.push(part);
      else pending.push(part);
      continue;
    }
    flush();
    if (part.part === "turn") {
      last = { turn: part, calls: pending };
      pending = [];
      continue;
    }
    if (pending.length > 0) steps.push(stepOf(pending, null, next()));
    pending = [];
    compacted += part.billed;
    steps.push({
      step_id: next(),
      timestamp: part.at,
      source: "system",
      message: "The conversation was compacted.",
      extra: { compaction_cost_usd: part.billed },
    });
  }
  flush();
  if (pending.length > 0) steps.push(stepOf(pending, null, next()));
  const metrics = steps.flatMap((step) => {
    const own = asRecord(step.metrics);
    return own === null ? [] : [own];
  });
  const total = (key: string) => metrics.reduce((sum, own) => sum + count(own, key), 0);
  return {
    schema_version: ATIF_VERSION,
    session_id: id,
    agent: kept({ name: agent.name, version: agent.version, model_name: agent.model }),
    steps,
    final_metrics: {
      total_prompt_tokens: total("prompt_tokens"),
      total_completion_tokens: total("completion_tokens"),
      total_cached_tokens: total("cached_tokens"),
      total_cost_usd: total("cost_usd") + compacted,
      total_steps: steps.length,
    },
    extra: { seat },
  };
}

/** Every seat's solve or session that `events` holds a trace of, in the order each first appears. */
export function tracedRuns(events: readonly LogEvent[]): { readonly seat: Seat; readonly id: string }[] {
  // A key set again keeps the place it was first set at.
  const seen = new Map(tracesIn(events).map(({ seat, id }) => [`${seat}\u0000${id}`, { seat, id }]));
  return [...seen.values()];
}
