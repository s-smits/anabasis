/**
 * The model-facing verdict drivers, split from judge.ts at its size ceiling. This file owns the
 * one verdict vocabulary and schema, the parse of a raw model verdict, and the per-subject schema
 * tool every review transport records its verdict through: one budgeted turn and one re-ask,
 * typed error classification, one dispose, and the terminal-capture rule. No transport takes its own native
 * structured-output route, so one output method cannot drift from another. judge.ts keeps the
 * census side: sanitizer gate, conformance probe, subject evidence and aggregation.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "../backends/backend-types.ts";
import { DEFAULT_DIAGNOSTIC_MAX_BYTES } from "../backends/diagnostic-redaction.ts";
import { observeJudgeTurn } from "../observe/model-turn-observer.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import type { Judge, JudgeAttempt, JudgeInput } from "./judge-contract.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { NonResultKind } from "../claim/record-events.ts";
import { judgeTurnPrompt } from "./judge-framing.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import {
  type ProviderResourceBudget,
  isProviderResourceBudgetInterruption,
  runBudgetedAgentTurn,
} from "../run/provider-resource-budget.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { boundText } from "../meta/bounded-text.ts";
import { type ReviewResetWait, retryAfterNamedReset } from "../correctness-bundle/provider-reset.ts";

export const RATIONALE_MAX = 400;
const RULE_MAX = 600;

/** The two citations a fail may make beside a verbatim public validity assertion. */
const SCHEMA_RULE = "artifactSchema";
const INPUT_RULE = "publicInput";

const VERDICT_WORDS = ["pass", "fail"] as const;
type VerdictWord = (typeof VERDICT_WORDS)[number];

/** Read as a set of plain strings so a word arriving from the model can be tested before it is
 *  named, while the tuple above stays the one declaration the tool schema also enumerates. */
const VERDICT_WORD_SET: ReadonlySet<string> = new Set<string>(VERDICT_WORDS);

/** The one verdict representation, the schema tool's parameters. A pass leaves to the verifier what
 *  it could not read, so it names that in its rationale and cites nothing. */
const JUDGE_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: [...VERDICT_WORDS] },
    rationale: { type: "string", minLength: 1, maxLength: RATIONALE_MAX },
    rules: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1, maxLength: RULE_MAX },
      description: `Required for fail: every shown rule the output breaks, each quoted verbatim from publicValidityRules or a public-rule-decisions statement, or "${SCHEMA_RULE}" when the output violates or cannot be read against the shown artifact schema, or "${INPUT_RULE}" when it contradicts the shown public task input. Omit for pass.`,
    },
  },
  required: ["verdict", "rationale"],
  additionalProperties: false,
};

const VERDICT_SCHEMA_HINT =
  'judge verdict must match {verdict:"pass"|"fail",rationale:string(1..400),rules?:string[]}; a fail must cite only shown rules, verbatim, at least one';

/** The follow-up a subject gets when its first turn ended without a recorded verdict. */
const VERDICT_REASK =
  "Your turn ended without a recorded verdict. Call record_judge_verdict exactly once now.";

type Captured = { verdict: VerdictWord; rationale: string; rules: string[] };

/** What one subject's session captures: the single verdict the tool recorded, and how many times
 *  it was called. Named so the binding below keeps inference instead of an open annotation. */
type VerdictCapture = { captured: Captured | null; calls: number };

function isVerdictWord(value: string): value is VerdictWord {
  return VERDICT_WORD_SET.has(value);
}

/** The rules a fail may cite for this subject: each shown validity assertion, each shown public
 *  rule-decision statement, and the two fixed citations. One that names anything else,
 *  or nothing, is a protocol non-result rather than a verdict. The set is checked here rather than
 *  asked for in the prompt, which does not stop a Judge holding an artifact against agent tool text
 *  that no rule states.
 *
 *  The rule decisions belong in this set because the solver reads them from the same domain card,
 *  so a fail resting on one is citing a rule the artifact's author was also given. */
function citableRules(input: JudgeInput): ReadonlySet<string> {
  const shown = input.publicContext.publicTask?.publicValidityRules?.map((rule) => rule.assertion) ?? [];
  const decisions = input.publicContext.domain.publicResources.find(
    (resource) => resource.name === "public-rule-decisions",
  )?.content;
  const statements = (Array.isArray(decisions) ? decisions : []).flatMap((row) =>
    isRecord(row) && isString(row.statement) ? [row.statement] : [],
  );
  return new Set([...shown, ...statements, SCHEMA_RULE, INPUT_RULE]);
}

export function errorText(cause: unknown): string {
  return boundText(errorMessage(cause), DEFAULT_DIAGNOSTIC_MAX_BYTES).shown;
}

function parseVerdict(raw: JsonValue, citable: ReadonlySet<string>): Captured | null {
  const value = isRecord(raw) ? raw : null;
  const rationale = isString(value?.rationale) ? value.rationale.trim() : "";
  const verdict = value?.verdict;
  if (
    !isString(verdict) ||
    !isVerdictWord(verdict) ||
    rationale.length === 0 ||
    rationale.length > RATIONALE_MAX
  ) {
    return null;
  }
  if (verdict === "pass") return { verdict, rationale, rules: [] };
  const rules = Array.isArray(value?.rules)
    ? value.rules.map((rule) => (isString(rule) ? rule.trim() : ""))
    : [];
  if (rules.length === 0 || !rules.every((rule) => citable.has(rule))) return null;
  return { verdict, rationale, rules };
}

/** One subject's turns: one budgeted turn, typed error classification, one dispose, and the
 *  terminal-capture rule. The verdict tool writes `output` during the turn; a turn that ends
 *  without one gets one follow-up in the same session. */
async function runVerdictTurn(config: {
  open(): Promise<AgentSession>;
  input: JudgeInput;
  context: Parameters<Judge>[1];
  output: VerdictCapture;
  turnTimeoutMs?: number;
  observer?: RunObserver;
  providerBudget?: ProviderResourceBudget;
}): Promise<JudgeAttempt> {
  let session: AgentSession | null = null;
  let turns = 0;
  let error: string | null = null;
  let errorKind: NonResultKind | null = null;
  try {
    const opened = await config.open();
    session = opened;
    const turn = (prompt: string) => {
      turns += 1;
      observeJudgeTurn(config.observer, prompt, config.context, turns);
      return runBudgetedAgentTurn(
        opened,
        { prompt, ...keyIfDefined("turnTimeoutMs", config.turnTimeoutMs) },
        config.providerBudget,
        "review",
      );
    };
    let result = await turn(judgeTurnPrompt(config.input, "Call record_judge_verdict exactly once."));
    // A turn can end in prose with no verdict recorded: 40 of 2,446 recorded subjects did, each
    // after one turn, and three of truss-30's five. The same session is asked once more before
    // the subject becomes a protocol non-result.
    if (result.status === "completed" && config.output.captured === null) {
      result = await turn(VERDICT_REASK);
    }
    if (result.status !== "completed") {
      error = `judge turn ${result.status}: ${result.errorMessages?.join("; ") ?? "no error recorded"}`;
      errorKind = "provider";
    } else if (config.output.captured === null) {
      error = "judge completed without schema output";
      errorKind = "protocol";
    }
  } catch (caught) {
    if (isProviderResourceBudgetInterruption(caught)) throw caught;
    error = errorText(caught);
    errorKind = "transport";
  } finally {
    try {
      await session?.dispose();
    } catch (caught) {
      if (error === null) {
        error = `judge dispose failed: ${errorText(caught)}`;
        errorKind = "transport";
      }
    }
  }
  // A captured verdict is terminal evidence: a later turn failure, session failure or dispose
  // failure does not erase the result already captured. Only a
  // subject with zero valid captures becomes a typed operational non-result.
  const { captured } = config.output;
  if (captured !== null) {
    const { rationale, rules } = captured;
    return {
      verdict: captured.verdict === "pass",
      abstained: false,
      rationale,
      rules,
      error: null,
      errorKind: null,
      turns,
    };
  }
  return noVerdictAttempt(error ?? "judge produced no verdict", errorKind ?? "protocol", turns);
}

/**
 * The attempt a subject gets when no verdict was captured.
 *
 * Verdict null, nothing abstained, no rationale and no cited rules — a judge that did not answer
 * cites nothing, and rule 9 reads `errorKind` to decide whether the subject is a typed non-result.
 * Two callers build it, this one and the session wrapper in `judge.ts`, and they have to agree on
 * every field: a stray `abstained: true` here would read as a judge that chose not to answer.
 */
export function noVerdictAttempt(error: string, errorKind: NonResultKind, turns: number): JudgeAttempt {
  return { verdict: null, abstained: false, rationale: null, rules: [], error, errorKind, turns };
}

/** One fresh schema-tool session per subject; any non-schema outcome produces verdict:null. A
 *  session limit naming its reset opens one more fresh session after that reset, so a battery
 *  reviewed while the review account was spent keeps its verdicts. */
export function sessionJudge(options: {
  openSession(tool: AgentTool<never>): Promise<AgentSession>;
  turnTimeoutMs?: number;
  observer?: RunObserver;
  providerBudget?: ProviderResourceBudget;
  /** Test interface for the reset wait's clock and timer. */
  resetWait?: Omit<ReviewResetWait, "providerBudget">;
}): Judge {
  return async (input, context) => {
    const output: VerdictCapture = { captured: null, calls: 0 };
    // SAFETY: `AgentTool<never>` makes parameters opaque; execute validates every raw field with
    // `parseVerdict`, which alone decides whether the call counted.
    const tool = {
      name: "record_judge_verdict",
      label: "Record judge verdict",
      description:
        "Record fail or pass with a short reason. Fail only on a requirement the shown material shows broken; otherwise pass, and name what you left to the verifier.",
      parameters: JUDGE_VERDICT_SCHEMA,
      async execute(_id: string, raw: JsonValue) {
        output.calls += 1;
        // The first valid verdict wins; duplicates cannot erase it. A malformed first call returns
        // the schema hint so the model may retry within the turn.
        if (output.captured !== null) {
          return {
            content: [{ type: "text" as const, text: "verdict already recorded" }],
            details: null,
            terminate: true,
          };
        }
        const captured = parseVerdict(raw, citableRules(input));
        if (captured === null) throw new Error(VERDICT_SCHEMA_HINT);
        output.captured = captured;
        return {
          content: [{ type: "text" as const, text: "verdict recorded" }],
          details: null,
          terminate: true,
        };
      },
    } as AgentTool<never>;
    return retryAfterNamedReset(
      "judge",
      () => runVerdictTurn({ ...options, open: () => options.openSession(tool), input, context, output }),
      (attempt) => (attempt.verdict === null ? attempt.error : null),
      { ...options.resetWait, ...keyIfDefined("providerBudget", options.providerBudget) },
    );
  };
}
