/** What the controller does with a result frame a confined worker sent back.
 *
 *  The transport has already proved the frame: canonical bytes, a matching signature, the next
 *  counter. What is left is whether it answers the request it names, and whether the checkpoint it
 *  carries may replace the one the controller holds. Deciding that here, over three values, leaves
 *  the caller its pending map, its per-request timers and its failure latch, and names each outcome
 *  instead of spelling it as which of two callbacks a branch happened to reach. */

import { sameJsonValue } from "../meta/stable-json.ts";
import type { BuiltStarterCheckpoint } from "./built-starter.ts";
import type { GeneratedToolChildMessage } from "./generated-tool-worker-protocol.ts";
import type { GeneratedTaskAccess } from "./task-access-trace.ts";

/** A reply that answers a request the controller sent. */
export type AcceptedResult = Extract<
  GeneratedToolChildMessage,
  { type: "tool_result" | "materialization_result" | "files_result" | "apply_files_result" }
>;

type ResultFrame = AcceptedResult | Extract<GeneratedToolChildMessage, { type: "request_error" }>;

/** What the controller keeps from a frame it did not refuse. The checkpoint is the worker's state
 *  rather than the call's — the checks below have already proved it against the held one, and a
 *  failed call still leaves the draft the next call continues from. `taskAccess` is what the frame
 *  reported, or nothing when its kind carries no such field; the caller keeps what it holds then,
 *  since an absent field says nothing about what the worker touched. */
interface RetainedWorkerState {
  checkpoint: BuiltStarterCheckpoint;
  taskAccess: GeneratedTaskAccess | undefined;
}

/** The three things that can happen to a reply. `fail-call` is the only failure the session
 *  survives: the tool the solver asked for said no, which is that call's business rather than the
 *  worker's.
 *
 *  Both surviving verdicts carry the retained state, so the caller has no branch that can drop it.
 *  Until 2026-09-20 the failing branch returned before that assignment, and a turn whose tool call
 *  failed lost the checkpoint the worker had just recorded — the liveness evidence a long turn is
 *  read through (AGENTS.md working rule 6). */
type ResultVerdict =
  | { act: "accept"; result: AcceptedResult; retained: RetainedWorkerState }
  | { act: "fail-call"; error: string; retained: RetainedWorkerState }
  | { act: "refuse"; error: string };

const refuse = (error: string): ResultVerdict => ({ act: "refuse", error });

function retainedFrom(message: ResultFrame): RetainedWorkerState {
  return {
    checkpoint: message.checkpoint,
    taskAccess: "taskAccess" in message ? message.taskAccess : undefined,
  };
}

export function admitResult(
  message: ResultFrame,
  expected: AcceptedResult["type"] | null,
  accepted: BuiltStarterCheckpoint | null,
): ResultVerdict {
  if (expected === null) return refuse("returned an unknown request id");
  if (accepted === null) return refuse("returned a result before the ready handshake");
  // The roster is compared in the order it was declared: two writers that swap places are a
  // different tool contract, and a set comparison would let that through.
  if (!sameJsonValue(message.checkpoint.artifactWriterNames, accepted.artifactWriterNames)) {
    return refuse("checkpoint artifact-writer identity drifted");
  }
  if (message.checkpoint.draftSeq < accepted.draftSeq) return refuse("checkpoint regressed");
  if (message.type === "request_error") {
    // `materialization` is the controller's own request. A worker that fails it has broken the
    // contract, so there is no call to hand the error back to.
    return expected === "materialization_result"
      ? refuse("trusted answer preparation returned a request error")
      : { act: "fail-call", error: message.error, retained: retainedFrom(message) };
  }
  if (message.type !== expected) return refuse("crossed result types");
  return { act: "accept", result: message, retained: retainedFrom(message) };
}
