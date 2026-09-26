import type { EvaluationRequest } from "./correctness-model-contract.ts";
import type { ToolRunRequest, ToolRunResult } from "../verify/verifier-port.ts";

/** One wire bound in both directions; the host's tool-output caps fit inside it. */
export const EVALUATOR_FRAME_MAX_BYTES = 8 * 1024 * 1024;
/** UTF-8 bytes of a child's error detail the parent records. The parent cuts whatever arrives to
 *  this, because generated code shares the child's stdout and its text may say anything; the child
 *  cuts its own message `EVALUATOR_DETAIL_MARKER_BYTES` shorter, so that its omission marker still
 *  fits and an honest detail reaches the record uncut a second time. */
export const EVALUATOR_DETAIL_MAX_BYTES = 4096;
export const EVALUATOR_DETAIL_MARKER_BYTES = 64;

export type EvaluatorStart =
  | { type: "start"; mode: "probe"; checkIds: readonly string[] }
  | { type: "start"; mode: "evaluate"; checkId: string; request: EvaluationRequest; runtime: boolean };
export type EvaluatorParentMessage =
  | EvaluatorStart
  | { type: "begin" }
  | { type: "tool-result"; id: number; result: ToolRunResult }
  | { type: "tool-result"; id: number; error: string };
export type EvaluatorChildMessage =
  | { type: "ready"; pid: number }
  | { type: "error"; kind: "generated" | "sandbox"; detail?: string }
  | { type: "exports"; missing: string[] }
  | { type: "tool"; id: number; request: ToolRunRequest }
  | { type: "result"; result: boolean };
