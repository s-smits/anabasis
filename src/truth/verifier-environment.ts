import { keyIfDefined } from "../meta/optional-key.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { TOOL_ID_RE } from "../verify/tool-inventory.ts";

type ToolIdentity = { digest: string; source: string; interpreterDigest?: string };

const DIGEST_RE = /^[0-9a-f]{64}$/;

/** The exact persisted environment identity of a recorded tool map, shared by F2 and measured
 *  evaluation evidence: bytes, where they were found, and for a script the bytes of the
 *  interpreter that ran it. Descriptive provenance (kind, interpreter name) stays out of the hash.
 *  A binary tool, or a script whose interpreter was not found, has no interpreter digest and hashes
 *  without the key, so a claim's own `tools` map recomputes its `verifierEnvironmentHash`. An empty
 *  map has no identity: a run that launched no tool is not one that launched the same tools as
 *  another. */
export function verifierEnvironmentHashOfTools(
  tools: Readonly<Record<string, Readonly<ToolIdentity>>>,
): string | null {
  const identity = Object.entries(tools)
    .map(([id, tool]): [string, ToolIdentity] => {
      const entry: ToolIdentity = {
        digest: tool.digest,
        source: tool.source,
        ...keyIfDefined("interpreterDigest", tool.interpreterDigest),
      };
      return [id, entry];
    })
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return identity.length === 0 ? null : hashJsonBytes(identity);
}

/** Verify a persisted summary before comparing conditions; missing evidence is not a no-tool run. */
export function recordedVerifierHash(execution: JsonValue | undefined): string | null | undefined {
  if (!isRecord(execution) || !isRecord(execution.tools)) return undefined;
  const tools: Record<string, ToolIdentity> = {};
  for (const [id, tool] of Object.entries(execution.tools)) {
    if (
      !TOOL_ID_RE.test(id) ||
      !isRecord(tool) ||
      !isString(tool.digest) ||
      !DIGEST_RE.test(tool.digest) ||
      (tool.source !== "host" && tool.source !== "workspace-toolchain")
    ) {
      return undefined;
    }
    const interpreter = tool.interpreterDigest;
    if (interpreter !== undefined && (!isString(interpreter) || !DIGEST_RE.test(interpreter))) {
      return undefined;
    }
    const entry: ToolIdentity = {
      digest: tool.digest,
      source: tool.source,
      ...keyIfDefined("interpreterDigest", interpreter),
    };
    tools[id] = entry;
  }
  const hash = verifierEnvironmentHashOfTools(tools);
  return hash === execution.verifierEnvironmentHash ? hash : undefined;
}
