/** What a confined generated-tool worker does with the next line on its stdin.
 *
 *  The worker module's top level freezes globals and opens stdin, so the decision lives here, where
 *  it can be tested without starting a process.
 */

import {
  type GeneratedToolParentMessage,
  type GeneratedToolStart,
  parseGeneratedToolParentFrame,
} from "./generated-tool-worker-protocol.ts";
import { errorMessage } from "../meta/runtime-values.ts";

/** `new` before a start frame; `starting` while the execution wall, the boundary probes and the
 *  candidate factory are going up; `ready` once the tool map exists. */
export type SessionPhase = "new" | "starting" | "ready";

type FrameDecision =
  | { act: "start"; message: GeneratedToolStart }
  | { act: "handle"; message: GeneratedToolParentMessage }
  | { act: "refuse"; kind: "protocol"; error: string };

function refuse(error: string): FrameDecision {
  return { act: "refuse", kind: "protocol", error };
}

export function decideParentFrame(line: string, phase: SessionPhase): FrameDecision {
  let message: GeneratedToolParentMessage;
  try {
    message = parseGeneratedToolParentFrame(line);
  } catch (cause) {
    // The parser's message names the rule the line broke, which routes the fault to its owner.
    return refuse(errorMessage(cause));
  }
  if (message.type === "start") {
    return phase === "new" ? { act: "start", message } : refuse("generated-tool worker initialized twice");
  }
  return phase === "ready"
    ? { act: "handle", message }
    : refuse("generated-tool worker received a request before start");
}
