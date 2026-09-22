/** What a confined generated-tool worker does with the next line on its stdin.
 *
 *  The worker's own module cannot be imported anywhere but the worker: its top level freezes
 *  Number, locks the JSON globals and opens stdin. The decision therefore lives here, over a
 *  line and the phase the session has reached, so it can be read and tested without starting
 *  a process — and so a fault reaches the controller under the name of the rule it broke.
 */

import {
  type GeneratedToolParentMessage,
  type GeneratedToolStart,
  parseGeneratedToolParentFrame,
} from "./generated-tool-worker-protocol.ts";
import { errorMessage } from "../meta/runtime-values.ts";

/** `new` before a start frame; `starting` while the execution wall, the boundary probes and the
 *  candidate factory are still going up; `ready` once the tool map exists. The phase is the
 *  session's own record of what it has finished, never a field that happens to be set. */
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
    // The parser names the rule the line broke — its byte ceiling, its JSON, its canonical
    // spelling or its shape. Keeping that name is the whole point: one message for all four
    // sends the controller after the wrong owner.
    return refuse(errorMessage(cause));
  }
  if (message.type === "start") {
    return phase === "new" ? { act: "start", message } : refuse("generated-tool worker initialized twice");
  }
  return phase === "ready"
    ? { act: "handle", message }
    : refuse("generated-tool worker received a request before start");
}
