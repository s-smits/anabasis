/** What the controller does with a result frame a confined worker sent back.
 *
 *  The transport has already proved the frame's bytes, signature and counter. This decides whether
 *  it answers the request it names and whether its checkpoint may replace the held one; the caller
 *  keeps its pending map, timers and failure latch. */

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

/** What the controller keeps from a frame it did not refuse. The checkpoint is the worker's state,
 *  not the call's, so a failed call still carries it. `taskAccess` is undefined when the frame's
 *  kind has no such field, and the caller then keeps what it holds. */
interface RetainedWorkerState {
  checkpoint: BuiltStarterCheckpoint;
  taskAccess: GeneratedTaskAccess | undefined;
}

/** The three outcomes of a reply. The session survives `accept` and `fail-call`, where the
 *  requested tool refused its call; both carry the retained state, so no branch can drop the
 *  checkpoint a long turn's liveness is read through. */
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
