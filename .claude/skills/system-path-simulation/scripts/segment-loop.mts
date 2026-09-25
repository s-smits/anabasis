import type { AgentTurnResult } from "#src/backends/backend-types.ts";
import type { ModelAttemptGate } from "#src/run/campaign-budget.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { asRecord, isBoolean, isString } from "#src/meta/json-shape.ts";

export interface SegmentCall {
  role: string;
  prompt: string;
  steeringTypes?: string[];
}

export interface SegmentStep {
  call: SegmentCall;
  turns: number;
}

export interface TrailRow {
  step: string;
  turn: number;
  status: AgentTurnResult["status"];
  ms: number;
  toolCalls: Record<string, number>;
  failedToolCalls: Record<string, number>;
  usage?: { inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null };
}

export interface HandoverContext {
  index: number;
  role: string;
  text: string;
  turnsSpent: number;
  workspace: string;
  campaignDir: string;
  trail: readonly TrailRow[];
}

export interface HandoverVerdict {
  ok: boolean;
  reason: string;
  nextPrompt?: string;
}

export interface SegmentResult {
  role: string;
  ms: number;
  turnsSpent: number;
  outcome: string;
  text?: string;
  detail?: string;
}

export interface HandoverResult {
  afterStep: number;
  ok: boolean;
  reason: string;
  wroteNextPrompt: boolean;
}

export interface SegmentLoopResult {
  results: SegmentResult[];
  handovers: HandoverResult[];
  spent: number;
  stopped: string | null;
}

interface SegmentActor {
  agent(call: SegmentCall): Promise<string>;
}

export interface SegmentLoopInput {
  steps: SegmentStep[];
  maxTurns: number;
  continuation: string;
  primary: (attemptGate: ModelAttemptGate) => SegmentActor;
  trail: TrailRow[];
  workspace: string;
  campaignDir: string;
  handover: ((ctx: HandoverContext) => Promise<HandoverVerdict> | HandoverVerdict) | null;
  classifyError: (cause: unknown) => "non-result" | "script-or-setup-fault";
  beforeTurn?: (step: string) => void;
  note?: (line: string) => void;
  now?: () => number;
}

function idleContinuation(row: TrailRow | undefined): boolean {
  return (
    row?.status === "completed" &&
    Object.keys(row.toolCalls).length === 0 &&
    Object.keys(row.failedToolCalls).length === 0
  );
}

export function completedSegment(steps: readonly SegmentStep[], output: SegmentLoopResult): boolean {
  return (
    output.stopped === null &&
    output.results.length === steps.length &&
    output.results.every(
      (result, index) =>
        result.role === steps[index]?.call.role &&
        (result.outcome === "completed" || result.outcome === "step-settled"),
    )
  );
}

function validHandover(value: unknown): value is HandoverVerdict {
  const row = asRecord(value);
  if (row === null) return false;
  if (Object.keys(row).some((key) => key !== "ok" && key !== "reason" && key !== "nextPrompt")) return false;
  return (
    isBoolean(row.ok) &&
    isString(row.reason) &&
    row.reason.trim() !== "" &&
    (row.nextPrompt === undefined || (isString(row.nextPrompt) && row.nextPrompt.trim() !== ""))
  );
}

export async function runSegmentLoop(input: SegmentLoopInput): Promise<SegmentLoopResult> {
  const results: SegmentResult[] = [];
  const handovers: HandoverResult[] = [];
  const now = input.now ?? (() => Date.now());
  const note = input.note ?? (() => undefined);
  let spent = 0;
  let stopped: string | null = null;
  let turnsSpent = 0;
  let turnLimit = 0;
  const budgetReached = new Error("segment backend-attempt budget reached");
  const assertAttemptAvailable = () => {
    if (spent < input.maxTurns && turnsSpent < turnLimit) return;
    stopped = spent >= input.maxTurns ? "turn-budget-reached" : "step-budget-reached";
    throw budgetReached;
  };
  const primary = input.primary({
    campaignRoot: input.campaignDir,
    assertAttemptAvailable,
    startAttempt: () => {
      assertAttemptAvailable();
      spent += 1;
      turnsSpent += 1;
      return { beginProviderTurn() {}, complete() {} };
    },
  });

  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index];
    if (step === undefined) break;
    const startedAt = now();
    let text = "";
    turnsSpent = 0;
    turnLimit = step.turns;
    let failed = false;
    let settled = false;
    for (let turn = 0; turnsSpent < step.turns; turn += 1) {
      if (spent >= input.maxTurns) {
        stopped = "turn-budget-reached";
        break;
      }
      const call: SegmentCall =
        turn === 0
          ? step.call
          : { role: step.call.role, prompt: input.continuation, steeringTypes: ["continuation"] };
      try {
        input.beforeTurn?.(step.call.role);
        const priorTrailLength = input.trail.length;
        text = await primary.agent(call);
        const currentTrail = input.trail.length > priorTrailLength ? input.trail.at(-1) : undefined;
        if (turn > 0 && idleContinuation(currentTrail)) {
          settled = true;
          note(`[${step.call.role}] settled on turn ${turn + 1} — the continuation produced no tool call`);
          break;
        }
      } catch (error) {
        const detail = errorMessage(error);
        const outcome =
          error === budgetReached ? (stopped ?? "turn-budget-reached") : input.classifyError(error);
        results.push({ role: step.call.role, ms: now() - startedAt, turnsSpent, outcome, detail });
        note(`[${step.call.role}] ${outcome} — ${detail}`);
        failed = true;
        break;
      }
    }
    if (failed) break;
    if (turnsSpent === 0) {
      note(`[${step.call.role}] not opened — ${input.maxTurns}-turn budget was already spent`);
      break;
    }
    results.push({
      role: step.call.role,
      ms: now() - startedAt,
      turnsSpent,
      outcome: settled ? "step-settled" : "completed",
      text,
    });
    note(
      `[${step.call.role}] ${settled ? "settled" : "completed"} in ${Math.round((now() - startedAt) / 1000)}s over ${turnsSpent} of ${step.turns} allowed turn(s) — ${text.length} chars (${spent}/${input.maxTurns} spent)`,
    );
    if (stopped !== null) break;

    const nextStep = input.steps[index + 1];
    if (input.handover !== null && nextStep !== undefined) {
      let verdict: HandoverVerdict;
      try {
        const proposed = await input.handover({
          index,
          role: step.call.role,
          text,
          turnsSpent,
          workspace: input.workspace,
          campaignDir: input.campaignDir,
          trail: input.trail,
        });
        if (!validHandover(proposed)) throw new Error(`handover ${index} returned an invalid verdict`);
        verdict = proposed;
      } catch (error) {
        const detail = errorMessage(error);
        const reason = `script-or-setup-fault — ${detail}`;
        handovers.push({ afterStep: index, ok: false, reason, wroteNextPrompt: false });
        note(`[handover ${index}→${index + 1}] ${reason}`);
        stopped = "handover-fault";
        break;
      }
      handovers.push({
        afterStep: index,
        ok: verdict.ok,
        reason: verdict.reason,
        wroteNextPrompt: verdict.nextPrompt !== undefined,
      });
      note(`[handover ${index}→${index + 1}] ${verdict.ok ? "through" : "refused"} — ${verdict.reason}`);
      if (!verdict.ok) {
        stopped = "handover-refused";
        break;
      }
      if (verdict.nextPrompt !== undefined) nextStep.call = { ...nextStep.call, prompt: verdict.nextPrompt };
    }
  }

  return { results, handovers, spent, stopped };
}
