/**
 * What a host tool is, and the one ceiling every host tool result shares. `toolDefinition` builds
 * the pi-agent-core tool from a spec and refuses a name, label or description past its public
 * limit; `defineTool` shortens an over-long body through `boundEvidenceText` and says so in the
 * body, because a model that asked a legitimate question needs a usable answer more than it needs
 * the whole one. The generated draft tools in draft-tool.ts share the spec and the limits but keep
 * the refusal.
 */
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import { keyIfDefined, keyIfTruthy } from "../meta/optional-key.ts";

export const TOOL_TEXT_LIMITS = { name: 128, label: 256, description: 4_000, evidence: 64 * 1024 } as const;

export type Evidence<D = unknown> = { text: string; details?: D; terminate?: boolean };

export interface DefineToolSpec<P extends TSchema, D> {
  name: string;
  label: string;
  description: string;
  parameters: P;
  prepareArguments?: (raw: Parameters<NonNullable<AgentTool<P>["prepareArguments"]>>[0]) => Static<P>;
  executionMode?: "sequential" | "parallel";
  run: (params: Static<P>, signal?: AbortSignal) => Evidence<D> | Promise<Evidence<D>>;
}

export function toolDefinition<P extends TSchema, E>(
  spec: Pick<
    DefineToolSpec<P, unknown>,
    "name" | "label" | "description" | "parameters" | "prepareArguments" | "executionMode"
  >,
  execute: E,
) {
  for (const field of ["name", "label", "description"] as const) {
    if (spec[field].length > TOOL_TEXT_LIMITS[field]) {
      throw new Error(`tool ${field} exceeds its public limit`);
    }
  }
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    ...keyIfTruthy("prepareArguments", spec.prepareArguments),
    ...keyIfTruthy("executionMode", spec.executionMode),
    execute,
  };
}

/**
 * Bound host-side tool output, applied by `defineTool` only: keep as much text as fits and tell the
 * model to ask for a narrower range. A tool that can exceed the ceiling should still window itself,
 * since only it knows what a narrower range means. `defineDraftTool` keeps the refusal, because
 * over-long generated-tool text is an authoring defect for conformance to report.
 */
function boundEvidenceText(text: string): string {
  if (new TextEncoder().encode(text).byteLength <= TOOL_TEXT_LIMITS.evidence) return text;
  const note = `\n\n[This result was shortened at ${TOOL_TEXT_LIMITS.evidence} bytes. Ask for a narrower range.]`;
  // Margin for the replacement character a mid-character cut can add, so the whole result stays
  // under the ceiling the worker protocol also bounds.
  const room = TOOL_TEXT_LIMITS.evidence - new TextEncoder().encode(note).byteLength - 8;
  return `${new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, room))}${note}`;
}

export function evidenceResult<D>(evidence: Evidence<D>): AgentToolResult<D> {
  if (evidence.text.length > TOOL_TEXT_LIMITS.evidence) {
    throw new Error("tool evidence text exceeds its public limit");
  }
  return {
    content: [{ type: "text", text: evidence.text }],
    details:
      /* SAFETY: a tool that declares no details type carries null, which is the value this branch produces. */ (evidence.details ??
        null) as D,
    ...keyIfDefined("terminate", evidence.terminate),
  };
}

export function defineTool<P extends TSchema, D = unknown>(
  spec: DefineToolSpec<P, NoInfer<D>>,
): AgentTool<P, D> {
  return toolDefinition(spec, async (_toolCallId, params, signal) => {
    const evidence = await spec.run(params, signal);
    return evidenceResult({ ...evidence, text: boundEvidenceText(evidence.text) });
  });
}
