/**
 * What a verified case trace actually says, beyond counting its rows.
 *
 * A case trace records per call a `(toolName, argsDigest)` pair, an `isError`, and a
 * `timingMs`, and per turn the provider's own token and cost report. The earlier reader used
 * only two numbers — turns and calls — and dropped the rest. These fields help investigate
 * what those totals cannot explain: six calls with the same arguments may be repeated work,
 * and a tool refusing half its calls may explain poor results. Neither count establishes
 * the cause on its own; the calls and their context still need inspection.
 * The underlying facts are already recorded on disk.
 *
 * Two rules hold throughout, inherited from the owners this reads through:
 *  - absence renders as null, never as zero — a transport that reported no cost did not spend 0;
 *  - a sum states how many records carried the field (`Reported.of` over `from`), because a sum
 *    over 3 of 25 turns is a different fact from a sum over 25 and only the count says which.
 *
 * Per-field narrowing lives here by design: `ReadCaseTrace` types only the structure the reader
 * checks, and the producer records null for any duration, token count or cost it did not observe.
 */
import type { ReadCaseTrace } from "../../src/claim/trace-read.ts";
import { isNumber, isString, type JsonValue } from "../../src/meta/json-shape.ts";

/** A sum plus its denominator. `of` records carried the field, out of `from` examined. */
export interface Reported {
  value: number;
  of: number;
  from: number;
}

/** Per tool, across whatever scope the caller folded — one case or a whole battery. */
export interface ToolStat {
  calls: number;
  /** Calls the tool itself refused (`isError === true`). */
  errors: number;
  /** Calls repeating a `(toolName, argsDigest)` pair already seen in the same solve, counted only
   *  for a tool the solve called with two or more distinct digests. A parameterless tool digests
   *  every call to the digest of `{}`, so without that condition every call after the first read as
   *  repeated work: `materialize_files`, `preview_artifact` and `submit` each did, and
   *  `solve-thrash` fired on two batteries that passed 6 of 6. The cost is a tool called
   *  repeatedly with one genuine argument set, whose repeats this now reports as 0. */
  repeats: number;
}

export interface CaseTraceFacts {
  turns: number | null;
  toolCalls: number | null;
  /** Ordered call names, for the declared-vs-called census fold. */
  toolNames: string[];
  distinctTools: number | null;
  truncated: boolean | null;
  /** Repeats over the calls whose args were digestible; a null digest is not an equality. */
  repeatedCalls: Reported | null;
  /** Errors over the calls that completed; a call still open reported no outcome either way. */
  erroredCalls: Reported | null;
  /** Started and never ended. Interrupted work, visible as unknown instead of as success. */
  openCalls: number | null;
  /** How long the turns that never ended had been running when the trace was taken (v4 traces).
   *  A floor on interrupted work, and the only elapsed time a wall-stopped solve records: its
   *  `turnMs` is null by construction, because the turn reached no terminal event. */
  openMs: Reported | null;
  toolMs: Reported | null;
  turnMs: Reported | null;
  inputTokens: Reported | null;
  outputTokens: Reported | null;
  costUsd: Reported | null;
  byTool: Record<string, ToolStat>;
}

/** No readable trace: scalar facts are null, and the tool-name list and count map are empty. */
export const NO_TRACE_FACTS: CaseTraceFacts = {
  turns: null,
  toolCalls: null,
  toolNames: [],
  distinctTools: null,
  truncated: null,
  repeatedCalls: null,
  erroredCalls: null,
  openCalls: null,
  openMs: null,
  toolMs: null,
  turnMs: null,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  byTool: {},
};

/** Min, median, max and mean over the recorded values. An average of 8 calls across 25 cases
 *  may hide 20 quick solves and 5 long ones, or describe 25 similar solves. The spread helps
 *  distinguish them. Null when nothing was recorded. */
interface Spread {
  min: number;
  median: number;
  max: number;
  mean: number;
  n: number;
}

/**
 * What a set of cases spent, as two spreads and six running totals.
 *
 * `CaseTraceFacts` above is one case. This is what a caller gets after folding several, and it was
 * written out twice: once in `metrics.ts` for the outcome reader and once in the
 * `whole-run-investigation` telemetry script, which then restated the shape a third time in a
 * hand-written declaration file beside it. All three folded the same six fields with `addReported`
 * and took the same two spreads, and the two type declarations had already drifted into different
 * field orders.
 *
 * The six are `Reported` rather than numbers because each carries its own denominator: a cost
 * summed over 12 cases that recorded one is not a cost over 25.
 */
export interface FoldedTraceFacts {
  turnSpread: Spread | null;
  toolCallSpread: Spread | null;
  repeatedCalls: Reported | null;
  erroredCalls: Reported | null;
  toolMs: Reported | null;
  inputTokens: Reported | null;
  outputTokens: Reported | null;
  costUsd: Reported | null;
}

/** The per-case fields the fold reads. `CaseTraceFacts` satisfies it, and so does the outcome
 *  reader's own flattened case row, which is why the parameter is this shape and not that one. */
type FoldableCase = {
  turns: number | null;
  toolCalls: number | null;
  repeatedCalls: Reported | null;
  erroredCalls: Reported | null;
  toolMs: Reported | null;
  inputTokens: Reported | null;
  outputTokens: Reported | null;
  costUsd: Reported | null;
};

/** Merge per-tool stats across a battery: which tool refuses, which tool gets repeated. */
/** Tool usage keyed by tool name. The names come from the generated harness, so the key set cannot
 *  be written down; naming the block still tells a caller what each value is. */
interface ToolStats {
  [tool: string]: ToolStat;
}

function reported(records: ReadonlyArray<Record<string, JsonValue>>, field: string): Reported | null {
  let value = 0;
  let of = 0;
  for (const record of records) {
    const n = record[field];
    if (!isNumber(n) || !Number.isFinite(n)) continue;
    value += n;
    of += 1;
  }
  return of === 0 ? null : { value, of, from: records.length };
}

/** Fold the call list once: names, per-tool stats, repeats, errors, and open calls. */
function foldCalls(calls: ReadonlyArray<Record<string, JsonValue>>) {
  const toolNames: string[] = [];
  const byTool: Record<string, ToolStat> = {};
  const seen = new Set<string>();
  const digestsByTool = new Map<string, Set<string>>();
  let repeats = 0;
  let digestible = 0;
  let errors = 0;
  let completed = 0;
  let open = 0;
  for (const call of calls) {
    const name = isString(call.toolName) ? call.toolName : "<unnamed>";
    toolNames.push(name);
    const stat = (byTool[name] ??= { calls: 0, errors: 0, repeats: 0 });
    stat.calls += 1;
    const digest = isString(call.argsDigest) ? call.argsDigest : null;
    if (digest !== null) {
      digestible += 1;
      let digests = digestsByTool.get(name);
      if (digests === undefined) digestsByTool.set(name, (digests = new Set<string>()));
      digests.add(digest);
      // NUL joins the pair because no tool name contains it: a printable separator would
      // let tool `read x` with digest `y` collide with tool `read` with digest `x y`.
      const key = `${name}\u0000${digest}`;
      if (seen.has(key)) {
        repeats += 1;
        stat.repeats += 1;
      }
      seen.add(key);
    }
    if (call.isError === true) {
      errors += 1;
      completed += 1;
      stat.errors += 1;
    } else if (call.isError === false) completed += 1;
    else open += 1;
  }
  // A tool the solve only ever called one way had no argument to vary, so its equal digests are
  // its signature rather than repeated work. Drop those repeats from the tool and from the total.
  for (const [name, stat] of Object.entries(byTool)) {
    if ((digestsByTool.get(name)?.size ?? 0) >= 2) continue;
    repeats -= stat.repeats;
    stat.repeats = 0;
  }
  return {
    toolNames,
    byTool,
    repeats: { value: repeats, of: digestible, from: calls.length },
    errors: { value: errors, of: completed, from: calls.length },
    open,
  };
}

/** Project one verified trace. The caller owns the decision to read it; this owns the reading. */
export function caseTraceFacts(trace: ReadCaseTrace): CaseTraceFacts {
  const fold = foldCalls(trace.toolCalls);
  return {
    turns: trace.turns.length,
    toolCalls: trace.toolCalls.length,
    toolNames: fold.toolNames,
    distinctTools: Object.keys(fold.byTool).length,
    truncated: trace.truncated,
    repeatedCalls: fold.repeats.of === 0 ? null : fold.repeats,
    erroredCalls: fold.errors.of === 0 ? null : fold.errors,
    openCalls: fold.open,
    openMs: reported(trace.turns, "observedMs"),
    toolMs: reported(trace.toolCalls, "timingMs"),
    turnMs: reported(trace.turns, "timingMs"),
    inputTokens: reported(trace.turns, "inputTokens"),
    outputTokens: reported(trace.turns, "outputTokens"),
    costUsd: reported(trace.turns, "costUsd"),
    byTool: fold.byTool,
  };
}

/** Sum two `Reported`s, or state the absence when neither side carried the field. */
function addReported(a: Reported | null, b: Reported | null): Reported | null {
  if (a === null) return b;
  if (b === null) return a;
  return { value: a.value + b.value, of: a.of + b.of, from: a.from + b.from };
}

export function spread(values: ReadonlyArray<number | null>): Spread | null {
  const present = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  const mid = Math.floor(present.length / 2);
  const lower = present[mid - 1];
  const upper = present[mid];
  if (upper === undefined) return null;
  const median = present.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
  return {
    min: present[0] ?? upper,
    median,
    max: present.at(-1) ?? upper,
    mean: present.reduce((a, b) => a + b, 0) / present.length,
    n: present.length,
  };
}

/** Fold cases that recorded a trace. Filtering is the caller's, because the outcome reader counts
 *  the unrecorded ones and the telemetry script reports them as `seen` against `recorded`. */
export function foldTraceFacts(cases: readonly FoldableCase[]): FoldedTraceFacts {
  const total = (pick: (one: FoldableCase) => Reported | null): Reported | null =>
    cases.reduce<Reported | null>((acc, one) => addReported(acc, pick(one)), null);
  return {
    turnSpread: spread(cases.map((one) => one.turns)),
    toolCallSpread: spread(cases.map((one) => one.toolCalls)),
    repeatedCalls: total((one) => one.repeatedCalls),
    erroredCalls: total((one) => one.erroredCalls),
    toolMs: total((one) => one.toolMs),
    inputTokens: total((one) => one.inputTokens),
    outputTokens: total((one) => one.outputTokens),
    costUsd: total((one) => one.costUsd),
  };
}

export function mergeToolStats(cases: ReadonlyArray<ToolStats>): ToolStats {
  const merged: Record<string, ToolStat> = {};
  for (const one of cases) {
    for (const [name, stat] of Object.entries(one)) {
      const into = (merged[name] ??= { calls: 0, errors: 0, repeats: 0 });
      into.calls += stat.calls;
      into.errors += stat.errors;
      into.repeats += stat.repeats;
    }
  }
  return merged;
}
