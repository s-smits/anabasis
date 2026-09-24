/**
 * One recorded solve compiled into numbered steps a diagnosis can point at.
 *
 * A trace as recorded is a list of turns and a list of tool calls, and a reader handed a sample of
 * them can say that something went wrong but not where, because nothing in the excerpt has an
 * address. So each tool call here becomes a step with a reference, `c04.s7` for the seventh call of
 * the fourth case, and the solve's end becomes `c04.end`. The diagnosis reader must name the first
 * failure boundary as one of these references, and the controller refuses a reference the reader
 * was not shown, which is what turns "the first observed failure boundary" from a sentence into a
 * checked location.
 *
 * The compilation is deterministic and bounded. Identical consecutive calls (same tool, same
 * outcome, same argument digest) collapse into one step range, because a solver retrying one call
 * twelve times is one fact. A long solve keeps its opening, its first failures and its closing
 * steps, and says how many it left out between them; the steps it leaves out cannot be cited.
 *
 * Everything here is what the solver itself saw or did: tool names, its own arguments on a failed
 * call, the result previews it read, its stop reason, and how many turns and minutes it used
 * against the walls its harness declares. None of it is verifier output.
 */
import type { CaseOutcome } from "../claim/case-record.ts";
import type { ReadCaseTrace } from "../claim/trace-read.ts";
import { isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { boundText } from "../meta/bounded-text.ts";

/** UTF-8 bytes shown of a result preview, a call's arguments, a turn error and the final text. */
const RESULT_BYTES = 240;
const ARGS_BYTES = 240;
const TURN_ERROR_BYTES = 400;
const FINAL_TEXT_BYTES = 240;
/** A solve of at most this many steps is shown whole. */
const WHOLE_STEPS = 16;
const HEAD_STEPS = 4;
const FAILED_STEPS = 4;
const TAIL_STEPS = 6;

/** Whether the solve ended with a submission the harness accepted. */
export type Submission = "accepted" | "none";

/** The walls the measured harness declared, in the units its config names. */
export type SolveWalls = { maxTurns: number; solveMinutes: number };

export type CompiledSolve = {
  label: string;
  outcome: CaseOutcome;
  text: string;
  /** Every reference a diagnosis may cite in this solve, with the tool called at that step; the
   *  solve's end maps to null. Empty when no trace was readable. */
  refs: ReadonlyMap<string, string | null>;
  /** Every recorded call, for the battery census. */
  calls: ReadonlyArray<{ tool: string; failed: boolean }>;
  walls: { turns: boolean; minutes: boolean };
};

type Step = {
  tool: string;
  status: "ok" | "ERR" | "OPEN";
  digest: string | null;
  line: string;
};

type Group = { first: number; last: number; step: Step };

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function stepOf(call: Record<string, JsonValue>): Step {
  const tool = isString(call.toolName) ? call.toolName : "?";
  const status = call.isError === true ? "ERR" : call.isError === false ? "ok" : "OPEN";
  const said = isString(call.resultExcerpt)
    ? call.resultExcerpt
    : isString(call.resultPreview)
      ? call.resultPreview
      : "";
  const turn = isNumber(call.turn) ? ` turn ${call.turn}` : "";
  const time = isNumber(call.timingMs) ? ` ${(call.timingMs / 1000).toFixed(1)}s` : "";
  const args = isString(call.argsExcerpt)
    ? ` | args: ${boundText(oneLine(call.argsExcerpt), ARGS_BYTES).shown}`
    : "";
  const result = boundText(oneLine(said), RESULT_BYTES).shown || "(no result recorded)";
  return {
    tool,
    status,
    digest: isString(call.argsDigest) ? call.argsDigest : null,
    line: `${tool} ${status}${turn}${time} → ${result}${args}`,
  };
}

/** Consecutive steps that are the same call with the same outcome, as one range. A call whose
 *  argument digest is unknown never merges, since two unknowns are not known to be equal. */
function groups(steps: readonly Step[]): Group[] {
  const out: Group[] = [];
  steps.forEach((step, index) => {
    const prior = out.at(-1);
    if (
      prior !== undefined &&
      step.digest !== null &&
      prior.step.digest === step.digest &&
      prior.step.tool === step.tool &&
      prior.step.status === step.status
    ) {
      prior.last = index;
    } else out.push({ first: index, last: index, step });
  });
  return out;
}

/** The groups a long solve shows: its opening, its first failures and its close. */
function shownGroups(all: readonly Group[]): Group[] {
  if (all.length <= WHOLE_STEPS) return [...all];
  const keep = new Set<Group>([...all.slice(0, HEAD_STEPS), ...all.slice(-TAIL_STEPS)]);
  for (const group of all.filter((g) => g.step.status !== "ok").slice(0, FAILED_STEPS)) keep.add(group);
  return all.filter((group) => keep.has(group));
}

function turnFacts(trace: ReadCaseTrace) {
  const last = trace.turns.at(-1);
  let elapsedMs = 0;
  for (const turn of trace.turns) {
    elapsedMs += isNumber(turn.timingMs) ? turn.timingMs : isNumber(turn.observedMs) ? turn.observedMs : 0;
  }
  const failed = trace.turns.find((turn) => isString(turn.errorMessage) && turn.errorMessage !== "");
  return {
    turns: trace.turns.length,
    minutes: elapsedMs / 60_000,
    stop: last !== undefined && isString(last.stopReason) ? last.stopReason : "unrecorded",
    finalText: last !== undefined && isString(last.assistantPreview) ? oneLine(last.assistantPreview) : "",
    turnError:
      failed === undefined || !isString(failed.errorMessage)
        ? null
        : `turn ${isNumber(failed.turn) ? failed.turn : "?"}: ${boundText(oneLine(failed.errorMessage), TURN_ERROR_BYTES).shown}`,
  };
}

function endLine(trace: ReadCaseTrace, walls: SolveWalls, submission: Submission) {
  const facts = turnFacts(trace);
  const hit = {
    turns: facts.turns >= walls.maxTurns,
    // A solve stopped by its wall records a little under the wall, because the clock here starts at
    // each turn rather than at the solve; 98 per cent is inside that slack.
    minutes: facts.minutes >= walls.solveMinutes * 0.98,
  };
  const reached = [
    ...(hit.turns ? ["turn cap reached"] : []),
    ...(hit.minutes ? ["solve wall reached"] : []),
  ];
  const parts = [
    `stop ${facts.stop}`,
    `${facts.turns} of ${walls.maxTurns} turns`,
    `${facts.minutes.toFixed(1)} of ${walls.solveMinutes} minutes`,
    ...reached,
    `accepted submission: ${submission === "accepted" ? "yes" : "no"}`,
    ...(facts.turnError === null ? [] : [`turn error ${facts.turnError}`]),
    `final text: ${boundText(facts.finalText, FINAL_TEXT_BYTES).shown || "(none recorded)"}`,
  ];
  return { line: parts.join("; "), hit };
}

/** One case's solve as addressable steps. `label` is the case's anonymous name in this packet. */
export function compileSolve(
  label: string,
  outcome: CaseOutcome,
  trace: ReadCaseTrace | null,
  walls: SolveWalls,
  submission: Submission,
): CompiledSolve {
  const head = `${label} (${outcome})`;
  if (trace === null) {
    return {
      label,
      outcome,
      text: `${head}: no readable trace, so nothing in it can be cited`,
      refs: new Map(),
      calls: [],
      walls: { turns: false, minutes: false },
    };
  }
  const steps = trace.toolCalls.map(stepOf);
  const all = groups(steps);
  const shown = shownGroups(all);
  const refs = new Map<string, string | null>();
  const lines: string[] = [head];
  if (trace.truncated) {
    lines.push("  (the recorded trace is a prefix: its capture hit a bound, so later steps are unrecorded)");
  }
  let next = 0;
  for (const group of shown) {
    if (group.first > next) lines.push(`  … ${group.first - next} step(s) omitted, not citable`);
    for (let index = group.first; index <= group.last; index += 1) {
      refs.set(`${label}.s${index + 1}`, group.step.tool);
    }
    const span =
      group.first === group.last
        ? `s${group.first + 1}`
        : `s${group.first + 1}–s${group.last + 1} ×${group.last - group.first + 1}`;
    lines.push(`  ${span} ${group.step.line}`);
    next = group.last + 1;
  }
  if (steps.length > next) lines.push(`  … ${steps.length - next} step(s) omitted, not citable`);
  if (steps.length === 0) lines.push("  (no tool call recorded)");
  const end = endLine(trace, walls, submission);
  refs.set(`${label}.end`, null);
  lines.push(`  end ${end.line}`);
  return {
    label,
    outcome,
    text: lines.join("\n"),
    refs,
    calls: steps.map((step) => ({ tool: step.tool, failed: step.status !== "ok" })),
    walls: end.hit,
  };
}

/** What every solve in the battery did with each tool, and how many ran into a wall: the
 *  population a sampled trace is one member of, so a reader can tell a pattern from an outlier. */
export function batteryCensus(solves: readonly CompiledSolve[]): string {
  const byTool = new Map<string, { calls: number; failed: number; cases: Set<string> }>();
  for (const solve of solves) {
    for (const call of solve.calls) {
      const row = byTool.get(call.tool) ?? { calls: 0, failed: 0, cases: new Set<string>() };
      row.calls += 1;
      row.failed += call.failed ? 1 : 0;
      row.cases.add(solve.label);
      byTool.set(call.tool, row);
    }
  }
  const traced = solves.filter((solve) => solve.refs.size > 0).length;
  const tools = [...byTool.entries()]
    .sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]))
    .map(([tool, row]) => `${tool} ${row.calls} calls in ${row.cases.size} cases, ${row.failed} failed`);
  return [
    `Battery census over ${traced} readable traces of ${solves.length} cases: ${solves.filter((s) => s.walls.turns).length} reached the turn cap, ${solves.filter((s) => s.walls.minutes).length} reached the solve wall.`,
    `Tool use: ${tools.join("; ") || "no tool call recorded"}.`,
  ].join("\n");
}
