/**
 * The case-trace recorder's contract, read out of `src/backends/trace-capture.ts` and tested as the
 * two halves the file itself states: every field the record declares has an event path that fills
 * it, and nothing of a withheld class reaches the serialised trace.
 *
 * The second half is the one that is easy to write wrongly. A hand-enumerated list of marker
 * strings asserted absent is free to add to and nobody is ever prompted to argue an entry out, so
 * it cannot fail in the direction that matters: an entry whose only qualification is that its name
 * looks alarming reads exactly like one that guards a real secret, and the assertion is green
 * either way. So nothing here is withheld by name. Each class plants a nonce in the position of the
 * event stream that carries the class, and asserts the nonce reaches no string of the trace, while
 * the identical nonce planted in the declared channel beside it must arrive. Identical bytes in two
 * channels is what makes the pair falsifiable: a recorder that captured nothing at all fails the
 * positive half, and a recorder that captured everything fails the negative half. A field whose
 * name merely sounds private is asserted about not at all, and a new field of a withheld class
 * fails without anyone remembering to list it, because the walk is over every string of the output.
 *
 * The event shapes are the ones `pi-session.ts` emits and `pi-built.ts` forwards, and the tool
 * names, the composite `call_…|fc_…` call ids, the `{}` arguments and the `completed` stop reason
 * are taken from recorded case traces under the campaign trees rather than invented, because a
 * fixture richer than its producer proves a capability the producer does not have.
 */
import { describe, expect, it } from "bun:test";
import type { AgentTurnEvent } from "../src/backends/backend-types.ts";
import { redactProviderDiagnostic } from "../src/backends/diagnostic-redaction.ts";
import { CASE_TRACE_SCHEMA, type CaseTrace, createTraceRecorder } from "../src/backends/trace-capture.ts";
import { isObject, isString, type JsonValue } from "../src/meta/json-shape.ts";

/** A path shape the redaction owner provably rewrites, so that a leak of it is a statement about
 *  the recorder rather than about how far `redactProviderDiagnostic` reaches. The core is what must
 *  disappear; the test proves the owner removes it before relying on that. */
const SECRET_CORE = "trace-probe-account";
const SECRET_PROBE = `/Users/${SECRET_CORE}/api-key.txt`;
/** Longer than anything the recorder is declared to retain, so that a field with no bound of its
 *  own shows up as one. */
const OVERSIZE = "z".repeat(50_000);
/** Enough to ask the redaction owner for the whole string back, so that a comparison is about what
 *  it removed and never about where it cut. */
const NO_CAP = 1_000_000;
const OK_TOOL = "read_public_resources";
const FAIL_TOOL = "bash";
/** The composite id codex sends through pi, as the recorded traces spell it. */
const CALL_ID = "call_5eFYv2i7MOTZIFLblUb0l9cc|fc_0f54a8de13195ce2016ab2edec4a5887d2805165166c0b5a05";
const RESULT_PREVIEW = '{ "resources": [ { "name": "public-validity-rules" } ] }';
/** What `pi-built.ts` puts in `stopReason` for a turn that settled. */
const STOP_COMPLETED = "completed";

/** Whatever the recorder hands back: the trace or one of its rows. The reachability check reads
 *  the keys off the value instead of listing them, so the owner it accepts is the whole family and
 *  nothing narrower — a row type that grew a field yesterday is still one of these. */
type TraceRecord = CaseTrace | CaseTrace["turns"][number] | CaseTrace["toolCalls"][number];

/** A structure no JSON serialiser can take. The event union states what a backend is contracted to
 *  send, and pi hands the recorder live in-process objects rather than parsed wire bytes, so a
 *  cycle is reachable and the digest has to survive one. */
type Looping = { name: string; self: JsonValue };

/** One class the recorder withholds, named by why it is withheld rather than by the field it would
 *  land in. `withheld` plants the nonce where that class enters the recorder; `declared` plants the
 *  same bytes in a channel the recorder says it keeps. */
interface WithheldClass {
  why: string;
  withheld: (nonce: string) => AgentTurnEvent[];
  declared: (nonce: string) => AgentTurnEvent[];
}

const started = (toolName: string, toolCallId: string, args: Record<string, JsonValue>): AgentTurnEvent => ({
  type: "tool_started",
  toolName,
  toolCallId,
  args,
});

const ended = (
  toolName: string,
  toolCallId: string,
  isError: boolean,
  resultPreview: string,
): AgentTurnEvent => ({
  type: "tool_ended",
  toolName,
  toolCallId,
  isError,
  resultPreview,
});

const WITHHELD_CLASSES: WithheldClass[] = [
  {
    why: "a raw provider payload the shared event contract does not model, at any depth inside it",
    withheld: (nonce) => [{ type: "raw", backend: "codex", native: { outer: { inner: [nonce] } } }],
    declared: (nonce) => [started(OK_TOOL, CALL_ID, {}), ended(OK_TOOL, CALL_ID, false, nonce)],
  },
  {
    why: "the arguments of a tool call that did not fail, which the digest and the length stand for",
    withheld: (nonce) => [
      started(OK_TOOL, CALL_ID, { payload: nonce }),
      ended(OK_TOOL, CALL_ID, false, RESULT_PREVIEW),
    ],
    declared: (nonce) => [
      started(FAIL_TOOL, CALL_ID, { payload: nonce }),
      ended(FAIL_TOOL, CALL_ID, true, RESULT_PREVIEW),
    ],
  },
  {
    why: "the model's own draft thinking, which it did not choose to say",
    withheld: (nonce) => [{ type: "reasoning_text", text: nonce }],
    declared: (nonce) => [{ type: "message_text", text: nonce }],
  },
];

/** Every string anywhere in the trace, however deeply nested, so that a field added tomorrow is
 *  walked without being named today. */
function stringLeaves(value: unknown): string[] {
  if (isString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (isObject(value)) return Object.values(value).flatMap(stringLeaves);
  return [];
}

/** A field carries a value when it is neither absent nor the empty or falsy shape a record starts
 *  life holding. `false` and `0` count as unpopulated on purpose: a bound that never trips and a
 *  counter that never rises are the two ways a declared field can look present and mean nothing. */
function carriesValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "" || value === false || value === 0) return false;
  return !(Array.isArray(value) && value.length === 0);
}

function keysCarrying(row: TraceRecord, into: Set<string>): void {
  for (const [key, value] of Object.entries(row)) if (carriesValue(value)) into.add(key);
}

function keysDeclared(row: TraceRecord, into: Set<string>): void {
  for (const key of Object.keys(row)) into.add(key);
}

/** The keys a record declares that no scenario ever filled. Both sets are read off the objects the
 *  recorder produced, so a newly declared field that nothing populates arrives here by itself. */
function unreachable(rows: readonly TraceRecord[]): string[] {
  const declared = new Set<string>();
  const carrying = new Set<string>();
  for (const row of rows) {
    keysDeclared(row, declared);
    keysCarrying(row, carrying);
  }
  return [...declared].filter((key) => !carrying.has(key)).sort();
}

/** A codex-shaped turn, one failing call and one succeeding one, then the whole-message prose that
 *  transport sends in place of deltas; a claude-shaped streaming turn left open over an open call;
 *  and a failed turn. Between them every path the record declares is exercised once. */
function exercised(clock: { ms: number }) {
  const recorder = createTraceRecorder({ backend: "codex", now: () => clock.ms });
  recorder.beginTurn(1);
  recorder.onEvent({ type: "turn_started" });
  recorder.onEvent({ type: "message_text", text: "I sized the members and submitted the design." });
  recorder.onEvent(started(FAIL_TOOL, CALL_ID, { command: "truss-python -" }));
  clock.ms += 25;
  recorder.onEvent(ended(FAIL_TOOL, CALL_ID, true, "Traceback (most recent call last)"));
  recorder.onEvent(started(OK_TOOL, "call_B", {}));
  clock.ms += 5;
  recorder.onEvent(ended(OK_TOOL, "call_B", false, RESULT_PREVIEW));
  recorder.onEvent({ type: "raw", backend: "codex", native: { items: 3 } });
  clock.ms += 100;
  recorder.onEvent({
    type: "turn_ended",
    stopReason: STOP_COMPLETED,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.5 },
    compactions: [{ tokensBefore: 240_000, compacted: true }],
  });
  recorder.beginTurn(2);
  recorder.onEvent({ type: "assistant_text", delta: "still " });
  recorder.onEvent({ type: "assistant_text", delta: "working" });
  recorder.onEvent(started("record_design", "call_C", { members: 9 }));
  clock.ms += 40;
  recorder.beginTurn(3);
  recorder.onEvent({ type: "turn_failed", errorMessage: "the prompt ended without an assistant message" });
  return recorder;
}

/** The longest string the recorder itself is willing to retain, measured rather than copied from
 *  its constants: a failed call's result excerpt is the record's largest declared field, so feeding
 *  it an oversize result asks the recorder what its own ceiling is. */
function declaredRetention(): number {
  const recorder = createTraceRecorder({ now: () => 0 });
  recorder.beginTurn(1);
  recorder.onEvent(started(FAIL_TOOL, CALL_ID, {}));
  recorder.onEvent(ended(FAIL_TOOL, CALL_ID, true, OVERSIZE));
  const excerpt = recorder.trace().toolCalls[0]?.resultExcerpt ?? "";
  return excerpt.length;
}

describe("case trace: what the recorder declares it captures", () => {
  it("fills every field the record declares", () => {
    const clock = { ms: 1_000 };
    const trace = exercised(clock).trace();
    const bounded = createTraceRecorder({ now: () => 0 });
    for (let turn = 1; turn <= 200; turn += 1) {
      bounded.beginTurn(turn);
      bounded.onEvent({ type: "message_text", text: "prose" });
    }
    const truncatedTrace = bounded.trace();

    expect(trace.schema).toBe(CASE_TRACE_SCHEMA);
    expect(unreachable([trace, truncatedTrace])).toEqual([]);
    expect(unreachable(trace.turns)).toEqual([]);
    expect(unreachable(trace.toolCalls)).toEqual([]);
  });

  it("orders tool calls across the whole solve and binds each to a recorded turn", () => {
    const trace = exercised({ ms: 1_000 }).trace();
    expect(trace.toolCalls.map((call) => call.seq)).toEqual([1, 2, 3]);
    const recordedTurns = new Set(trace.turns.map((turn) => turn.turn));
    // A call whose turn has no row is a dangling reference, and the only thing that may produce one
    // is the turn bound, which announces itself as `truncated`.
    expect(trace.truncated).toBe(false);
    expect(trace.toolCalls.filter((call) => !recordedTurns.has(call.turn))).toEqual([]);
  });
});

describe("case trace: what the recorder withholds", () => {
  for (const withheldClass of WITHHELD_CLASSES) {
    it(`withholds ${withheldClass.why}`, () => {
      const nonce = `nonce-${crypto.randomUUID()}`;
      const hidden = createTraceRecorder({ now: () => 0 });
      hidden.beginTurn(1);
      for (const event of withheldClass.withheld(nonce)) hidden.onEvent(event);
      const shown = createTraceRecorder({ now: () => 0 });
      shown.beginTurn(1);
      for (const event of withheldClass.declared(nonce)) shown.onEvent(event);

      // The hostile half. Without it a recorder that dropped every event would pass the negative
      // assertion, and the class would be proved by the recorder doing nothing at all.
      expect(stringLeaves(shown.trace()).some((leaf) => leaf.includes(nonce))).toBe(true);
      expect(stringLeaves(hidden.trace()).filter((leaf) => leaf.includes(nonce))).toEqual([]);
    });
  }

  it("counts the raw provider payloads it dropped, and counts none when none arrived", () => {
    const quiet = createTraceRecorder({ now: () => 0 });
    quiet.beginTurn(1);
    quiet.onEvent({ type: "message_text", text: "no native events here" });
    expect(quiet.trace().droppedRawEvents).toBe(0);

    const noisy = createTraceRecorder({ now: () => 0 });
    noisy.beginTurn(1);
    for (let i = 0; i < 3; i += 1) noisy.onEvent({ type: "raw", backend: "claude", native: { i } });
    expect(noisy.trace().droppedRawEvents).toBe(3);
  });

  it("passes provider text through the redaction owner wherever it reaches the trace", () => {
    // Proved first, so that a failure below is about the recorder and not about the owner's reach.
    expect(redactProviderDiagnostic(SECRET_PROBE, NO_CAP)).not.toContain(SECRET_CORE);

    const recorder = createTraceRecorder({ backend: "claude", now: () => 0 });
    recorder.beginTurn(1);
    recorder.onEvent({ type: "assistant_text", delta: SECRET_PROBE });
    recorder.onEvent({ type: "reasoning_text", text: SECRET_PROBE });
    recorder.onEvent(started(SECRET_PROBE, SECRET_PROBE, { path: SECRET_PROBE }));
    recorder.onEvent(ended(SECRET_PROBE, SECRET_PROBE, true, SECRET_PROBE));
    recorder.onEvent({ type: "turn_ended", stopReason: SECRET_PROBE, errorMessage: SECRET_PROBE });
    recorder.beginTurn(2);
    recorder.onEvent({ type: "message_text", text: SECRET_PROBE });
    recorder.onEvent({ type: "turn_failed", errorMessage: SECRET_PROBE });
    const trace = recorder.trace();

    // The hostile half: the failing call's excerpts are declared to survive, so this case only
    // means something if the row is still here while the secret inside it is not.
    expect(trace.toolCalls[0]?.resultExcerpt).not.toBeNull();
    expect(trace.toolCalls[0]?.argsExcerpt).not.toBeNull();
    expect(stringLeaves(trace).filter((leaf) => leaf.includes(SECRET_CORE))).toEqual([]);
  });

  it("keeps no string longer than the longest it declares it retains", () => {
    const ceiling = declaredRetention();
    expect(ceiling).toBeGreaterThan(0);

    const recorder = createTraceRecorder({ backend: "codex", now: () => 0 });
    recorder.beginTurn(1);
    recorder.onEvent({ type: "message_text", text: OVERSIZE });
    recorder.onEvent(started(OVERSIZE, OVERSIZE, { blob: OVERSIZE }));
    recorder.onEvent(ended(OVERSIZE, OVERSIZE, false, OVERSIZE));
    recorder.onEvent({ type: "turn_ended", stopReason: OVERSIZE, errorMessage: OVERSIZE });
    const overlong = stringLeaves(recorder.trace())
      .filter((leaf) => leaf.length > ceiling)
      .map((leaf) => leaf.length);
    expect(overlong).toEqual([]);
  });
});

describe("case trace: honest accounting", () => {
  it("marks the trace truncated exactly when a bound refused a row, and never before", () => {
    const recorder = createTraceRecorder({ now: () => 0 });
    recorder.beginTurn(1);
    let pushed = 0;
    while (!recorder.trace().truncated && pushed < 2_000) {
      pushed += 1;
      recorder.onEvent(started(OK_TOOL, `call_${pushed}`, {}));
    }
    const trace = recorder.trace();
    expect(trace.truncated).toBe(true);
    // Every call up to the refused one is here, and exactly one was refused: a bound that dropped
    // rows silently, or announced itself early, would move one of these two numbers.
    expect(trace.toolCalls.length).toBe(pushed - 1);
    expect(trace.toolCalls.at(-1)?.seq).toBe(pushed - 1);
  });

  it("leaves telemetry the transport did not report as unknown rather than as a plausible zero", () => {
    const recorder = createTraceRecorder({ now: () => 0 });
    recorder.beginTurn(1);
    recorder.onEvent({ type: "turn_ended", stopReason: STOP_COMPLETED });
    const turn = recorder.trace().turns[0];
    expect([turn?.inputTokens, turn?.outputTokens, turn?.tokensUsed, turn?.costUsd]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    // A turn that compacted nothing says so with an empty list, which is a different statement
    // from a turn whose spend nobody reported.
    expect(turn?.compactions).toEqual([]);
  });

  it("closes the call whose id the completion carries and gives every other completion its own row", () => {
    const recorder = createTraceRecorder({ now: () => 0 });
    recorder.beginTurn(1);
    recorder.onEvent(started(FAIL_TOOL, "call_open", {}));
    // The same turn and the same tool name, a different id. The open call is not this completion's,
    // so a recorder falling back to the name would close it here with another call's result.
    recorder.onEvent(ended(FAIL_TOOL, "call_other", false, RESULT_PREVIEW));
    recorder.beginTurn(2);
    recorder.onEvent({
      type: "tool_ended",
      toolName: FAIL_TOOL,
      isError: false,
      resultPreview: RESULT_PREVIEW,
    });
    const trace = recorder.trace();
    // The started call stays open and unknown, and the two completions that matched nothing are
    // each recorded where they arrived rather than dropped.
    expect(trace.toolCalls.map((call) => [call.turn, call.toolCallId, call.isError])).toEqual([
      [1, "call_open", null],
      [1, "call_other", false],
      [2, null, false],
    ]);
    // A row the recorder first saw at its completion has no start to measure from, so it reports
    // neither a duration nor an elapsed reading, and the arguments went past before it was
    // watching, so it claims no digest of them either.
    expect(trace.toolCalls[2]?.timingMs).toBeNull();
    expect(trace.toolCalls[2]?.observedMs).toBeNull();
    expect(trace.toolCalls[2]?.argsDigest).toBeNull();
    expect(trace.toolCalls[2]?.argsChars).toBeNull();
  });

  it("counts the prose that arrived however the transport sent it, and counts it once", () => {
    const prose = "I sized the members and submitted the design.";
    // Codex sends the completed message and no deltas, which is the shape that records nothing at
    // all when the recorder prefers deltas and has no fallback.
    const whole = createTraceRecorder({ backend: "codex", now: () => 0 });
    whole.beginTurn(1);
    whole.onEvent({ type: "message_text", text: prose });
    const wholeTurn = whole.trace().turns[0];
    expect(wholeTurn?.assistantChars).toBe(prose.length);
    expect(wholeTurn?.assistantPreview).toBe(prose);

    // Claude streams the same words as deltas and then sends the completed message too, so taking
    // both would count every streaming turn's prose twice.
    const streamed = createTraceRecorder({ backend: "claude", now: () => 0 });
    streamed.beginTurn(1);
    streamed.onEvent({ type: "assistant_text", delta: prose.slice(0, 10) });
    streamed.onEvent({ type: "assistant_text", delta: prose.slice(10) });
    streamed.onEvent({ type: "message_text", text: prose });
    const streamedTurn = streamed.trace().turns[0];
    expect(streamedTurn?.assistantChars).toBe(prose.length);
    expect(streamedTurn?.assistantPreview).toBe(prose);

    // The choice is the turn's own. A transport that streamed one turn and sent the next whole
    // would otherwise go silent from the first delta onwards.
    streamed.beginTurn(2);
    streamed.onEvent({ type: "message_text", text: prose });
    expect(streamed.trace().turns[1]?.assistantChars).toBe(prose.length);
  });

  it("reports whole milliseconds, and an unclosed span as elapsed rather than as a duration", () => {
    // A fractional clock, because production reads `performance.now()`, whose readings carry a
    // fraction, and a subtraction left unrounded publishes nanoseconds the recorder cannot know.
    const clock = { ms: 1_000.4444 };
    const recorder = createTraceRecorder({ now: () => clock.ms });
    recorder.beginTurn(1);
    recorder.onEvent(started(OK_TOOL, CALL_ID, {}));
    clock.ms += 25.5555;
    recorder.onEvent(ended(OK_TOOL, CALL_ID, false, RESULT_PREVIEW));
    recorder.onEvent({ type: "turn_ended", stopReason: STOP_COMPLETED });
    recorder.beginTurn(2);
    recorder.onEvent(started(FAIL_TOOL, "call_open", {}));
    clock.ms += 40.7777;
    const trace = recorder.trace();

    const durations = [
      ...trace.turns.flatMap((turn) => [turn.timingMs, turn.observedMs]),
      ...trace.toolCalls.flatMap((call) => [call.timingMs, call.observedMs]),
    ].filter((value): value is number => value !== null);
    expect(durations.filter((value) => !Number.isInteger(value) || value < 0)).toEqual([]);

    // A span that closed has a duration and no elapsed reading; a span that never closed has the
    // elapsed reading and refuses to call it a duration.
    const [closed, open] = trace.turns;
    expect(closed?.timingMs).not.toBeNull();
    expect(closed?.observedMs).toBeNull();
    expect(open?.timingMs).toBeNull();
    expect(open?.observedMs).not.toBeNull();
  });

  it("classifies equal arguments inside one solve without publishing a hash to guess against", () => {
    const args = { command: "truss-python -" };
    const first = createTraceRecorder({ now: () => 0 });
    first.beginTurn(1);
    first.onEvent(started(FAIL_TOOL, "call_1", args));
    first.onEvent(started(FAIL_TOOL, "call_2", args));
    first.onEvent(started(FAIL_TOOL, "call_3", { command: "ls" }));
    const [one, two, three] = first.trace().toolCalls;
    expect(one?.argsDigest).toBe(two?.argsDigest ?? "");
    expect(one?.argsDigest).not.toBe(three?.argsDigest ?? "");
    expect(one?.argsChars).toBe(JSON.stringify(args).length);

    // The hostile half: a plain digest of the arguments would be the same string in every trace on
    // disk, and a reader holding one could confirm a guessed value against it.
    const second = createTraceRecorder({ now: () => 0 });
    second.beginTurn(1);
    second.onEvent(started(FAIL_TOOL, "call_1", args));
    expect(second.trace().toolCalls[0]?.argsDigest).not.toBe(one?.argsDigest ?? "");
  });

  it("records a null digest for arguments that do not serialise rather than losing the call", () => {
    const circular: Looping = { name: "loop", self: null };
    circular.self = circular;
    const recorder = createTraceRecorder({ now: () => 0 });
    recorder.beginTurn(1);
    recorder.onEvent(started(FAIL_TOOL, "call_1", circular));
    const [call] = recorder.trace().toolCalls;
    expect(call?.toolName).toBe(FAIL_TOOL);
    expect(call?.argsDigest).toBeNull();
    expect(call?.argsChars).toBeNull();
  });
});
