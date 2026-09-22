/** Model-turn adapters for the shared append-only observation stream. */
import { sha256 } from "../meta/digest.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import type { RunObserver } from "./run-observer.ts";
import type { Solver } from "../truth/solve.ts";
import { keyIfDefined } from "../meta/optional-key.ts";

/** Open the case span that owns one measured Built trajectory. */
export function observeSolveCase(
  observer: RunObserver | undefined,
  event: { taskId: string; phase?: "measure-on" },
): RunObserver | undefined {
  if (observer === undefined || event.phase === undefined) return observer;
  return observer.child(
    observer.phase({
      phase: event.phase,
      state: "started",
      summary: `Case ${event.taskId} started`,
      subjectId: event.taskId,
    }),
  );
}

/** Close the case span `observeSolveCase` opened, on the emitter that opened it, reading the
 *  outcome every ending already returns rather than settling the span in each of the solver's
 *  exits. Run c1d2a7 opened 28 of these and closed none, so its stream named every case that
 *  started and nothing about how any of them ended: a reader watching a live battery saw 28
 *  beginnings, no outcome and no duration. A typed non-result is the failure state, because the
 *  environment produced no result; every other ending completed, including a solve the whole-solve
 *  wall stopped after it had already submitted. */
export function settlingCaseSpan(
  solver: Solver,
  observer: RunObserver | undefined,
  phase: "measure-on" | undefined,
): Solver {
  if (observer === undefined || phase === undefined) return solver;
  return async (task, toolset, submitted) => {
    const outcome = await solver(task, toolset, submitted);
    const { nonResult } = outcome;
    const ended = submitted() ? "submitted" : "ended without an accepted submission";
    observer.phase({
      phase,
      state: nonResult === undefined ? "completed" : "failed",
      summary: `Case ${task.taskId} ${
        nonResult === undefined ? ended : `${nonResult.kind} non-result: ${nonResult.message}`
      }`,
      subjectId: task.taskId,
    });
    return outcome;
  };
}

/** Observe the Built solver prompt and its deterministic unaccepted-submit follow-up. */
export function observeSolverTurn(
  observer: RunObserver | undefined,
  event: {
    prompt: string;
    turn: number;
    taskId: string;
    phase: "measure-on" | "built-solve";
    nudge: string;
  },
): void {
  if (observer === undefined) return;
  const promptId = observer.prompt({
    contract: "built",
    role: "built-solver",
    prompt: event.prompt,
    phase: event.phase,
    turn: event.turn,
    subjectId: event.taskId,
    steeringTypes: event.turn === 1 ? ["start-prompt"] : ["runtime-nudge", "follow-up"],
  });
  if (event.turn === 1) return;
  const turn = observer.child(promptId);
  turn.steering({
    authority: "deterministic",
    owner: "built-solver",
    claim: event.nudge,
  });
  turn.hook({
    hookType: "follow-up",
    state: "activated",
    label: "unaccepted-submit follow-up",
    reason: "The previous turn ended without an accepted submission.",
    triggerDigest: hashJsonBytes({ taskId: event.taskId, previousTurn: event.turn - 1, accepted: false }),
    renderedDigest: sha256(event.nudge),
    evidence: [observer.path],
  });
}

/** Observe the fresh Builder prompt and its deterministic unsettled-turn follow-up. */
export function observeBuilderTurn(
  observer: RunObserver | undefined,
  event: { prompt: string; turn: number },
): void {
  if (observer === undefined) return;
  const promptId = observer.prompt({
    contract: "builder",
    role: "builder",
    prompt: event.prompt,
    phase: "build",
    turn: event.turn,
    steeringTypes: event.turn === 1 ? ["start-prompt"] : ["runtime-nudge", "follow-up"],
  });
  if (event.turn === 1) return;
  const turn = observer.child(promptId);
  turn.steering({
    authority: "deterministic",
    owner: "builder",
    claim: event.prompt,
  });
  turn.hook({
    hookType: "follow-up",
    state: "activated",
    label: "unsettled Builder follow-up",
    reason: "The previous turn ended without an accepted candidate.",
    triggerDigest: hashJsonBytes({ role: "builder", previousTurn: event.turn - 1, accepted: false }),
    renderedDigest: sha256(event.prompt),
    evidence: [observer.path],
  });
}

/** Observe one census Judge turn after the complete subject prompt is rendered. */
export function observeJudgeTurn(
  observer: RunObserver | undefined,
  prompt: string,
  context: { subjectId: string; subjectKind: string } | undefined,
): void {
  observer?.prompt({
    contract: "judge-census",
    role: context?.subjectKind ?? "unknown-subject",
    prompt,
    phase: "judge",
    turn: 1,
    ...keyIfDefined("subjectId", context?.subjectId),
    steeringTypes: ["start-prompt"],
  });
}
