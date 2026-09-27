import { keyIfDefined } from "../meta/optional-key.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { TOOL_ID_RE } from "../verify/tool-inventory.ts";

type ToolIdentity = {
  digest: string;
  source: string;
  interpreterDigest?: string;
  treeDigest?: string;
  portableDigest?: string;
};

const DIGEST_RE = /^[0-9a-f]{64}$/;

/** The exact persisted environment identity of a recorded tool map, shared by F2 and measured
 *  evaluation evidence: bytes, where they were found, and for a script the bytes of the
 *  interpreter that ran it, and for a workspace tool the content of the tree it was installed in.
 *  A workspace tool's bytes are its `portableDigest`, with the tree's own path taken out, so the
 *  same tree copied into another workspace is the same environment; a host tool's are its `digest`.
 *  Descriptive provenance (kind, interpreter name) stays out of the hash.
 *  A binary tool, or a script whose interpreter was not found, has no interpreter digest and hashes
 *  without the key, so a claim's own `tools` map recomputes its `verifierEnvironmentHash`. An empty
 *  map has no identity: a run that launched no tool is not one that launched the same tools as
 *  another. */
export function verifierEnvironmentHashOfTools(
  tools: Readonly<Record<string, Readonly<ToolIdentity>>>,
): string | null {
  const identity = Object.entries(tools)
    .map(([id, tool]): [string, Omit<ToolIdentity, "digest">] => {
      const entry = {
        ...(tool.portableDigest === undefined
          ? { digest: tool.digest }
          : { portableDigest: tool.portableDigest }),
        source: tool.source,
        ...keyIfDefined("interpreterDigest", tool.interpreterDigest),
        ...keyIfDefined("treeDigest", tool.treeDigest),
      };
      return [id, entry];
    })
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return identity.length === 0 ? null : hashJsonBytes(identity);
}

function wellFormed(digest: JsonValue | undefined): string | undefined {
  return isString(digest) && DIGEST_RE.test(digest) ? digest : undefined;
}

/** Verify a persisted summary before comparing conditions; missing evidence is not a no-tool run,
 *  and a workspace tool recorded without its tree or portable digest is an older record this reader
 *  refuses. */
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
    const interpreter = wellFormed(tool.interpreterDigest);
    const tree = wellFormed(tool.treeDigest);
    const portable = wellFormed(tool.portableDigest);
    // A malformed digest reads as absent, which differs from what was recorded. A host tool has
    // neither a tree nor a portable digest; a workspace tool always has both.
    if (
      interpreter !== tool.interpreterDigest ||
      tree !== tool.treeDigest ||
      portable !== tool.portableDigest ||
      (tool.source === "host") !== (tree === undefined) ||
      (tree === undefined) !== (portable === undefined)
    ) {
      return undefined;
    }
    const entry: ToolIdentity = {
      digest: tool.digest,
      source: tool.source,
      ...keyIfDefined("interpreterDigest", interpreter),
      ...keyIfDefined("treeDigest", tree),
      ...keyIfDefined("portableDigest", portable),
    };
    tools[id] = entry;
  }
  const hash = verifierEnvironmentHashOfTools(tools);
  return hash === execution.verifierEnvironmentHash ? hash : undefined;
}
