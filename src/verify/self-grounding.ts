/**
 * Refuse a required external executable whose bytes are also candidate-authored source. What this
 * detects is one concrete self-grounding shape, and not algorithm provenance: a public package and
 * an authored replacement can both live under `.toolchain` or on PATH, so neither the location, nor
 * script versus binary, nor absence from this result establishes any independence. Host receipts
 * attest the invocation and its inputs, and control challenges and semantic review keep their own
 * separate roles in deciding whether an instrument is independent.
 */
import { compareCodeUnits } from "../meta/stable-json.ts";

type ToolProvenance = { source: "workspace-toolchain" | "host"; kind: "binary" | "script"; digest: string };

type SelfGroundedCheck = { checkId: string; adapterId: string };

/** Treat an argument above this size, or one containing a line break, as possible program text:
 *  81% of the 13,090 recorded python3 rows of 2026-09-08 carried the whole checker as
 *  `-c "<source>"`. The rule is bounded — it restricts external checks and does not attempt to
 *  classify every program. */
export const PROGRAM_ARGUMENT_MAX_BYTES = 256;

type ProgramArgumentCheck = { checkId: string; toolId: string; bytes: number };

/** Refuse only a check whose every named tool has known candidate-authored bytes. A check mixing a
 *  helper with a domain engine keeps its receipts, because this test can refuse a shape but cannot
 *  establish independence for what it leaves. */
export function selfGroundedChecks(
  groundings: ReadonlyArray<{ checkId: string; adapterId: string | null }>,
  tools: Readonly<Record<string, ToolProvenance>>,
  authoredDigests: ReadonlySet<string> = new Set(),
): SelfGroundedCheck[] {
  const authored = (adapterId: string | null): adapterId is string => {
    const tool = adapterId === null ? undefined : tools[adapterId];
    return tool !== undefined && authoredDigests.has(tool.digest);
  };
  const mixed = new Set(
    groundings.flatMap(({ checkId, adapterId }) => (authored(adapterId) ? [] : [checkId])),
  );
  return groundings
    .flatMap(({ checkId, adapterId }) =>
      authored(adapterId) && !mixed.has(checkId) ? [{ checkId, adapterId }] : [],
    )
    .sort((a, b) => compareCodeUnits(a.checkId, b.checkId));
}

/** The one public remedy, composed from Builder-authored identities only. */
export function selfGroundedRemedy(checks: readonly SelfGroundedCheck[]): string {
  const named = checks.map((row) => `${row.checkId} (${row.adapterId})`).join(", ");
  return `check(s) ${named} rely entirely on executables whose bytes equal candidate-authored files; this is authored computation. Declare authored evidence with execution.requiredToolIds for the needed tools, or use an external domain tool. Moving the same bytes to another directory does not change this finding`;
}

function programArgument(arg: string): boolean {
  return /[\r\n]/.test(arg) || new TextEncoder().encode(arg).byteLength > PROGRAM_ARGUMENT_MAX_BYTES;
}

/** The second self-grounding shape, read from the host's own evidence rows: an external-evidence
 *  check whose tool run carried its program as an argument. The attested bytes are then the
 *  interpreter's while the deciding bytes are the candidate's, so the tool digest proves nothing
 *  about independence. Files and stdin already have to match declared input leaves; args had no
 *  equivalent restriction on added source until this. Authored checks may pass program text freely,
 *  because they claim no independence in the first place. */
export function programArgumentChecks(
  rows: ReadonlyArray<{ checkId: string; toolId: string; args: readonly string[] }>,
  externalCheckIds: ReadonlySet<string>,
): ProgramArgumentCheck[] {
  const seen = new Map<string, ProgramArgumentCheck>();
  for (const row of rows) {
    if (!externalCheckIds.has(row.checkId)) continue;
    const bytes = Math.max(
      0,
      ...row.args.filter(programArgument).map((arg) => new TextEncoder().encode(arg).byteLength),
    );
    if (bytes === 0) continue;
    const key = `${row.checkId}|${row.toolId}`;
    const prior = seen.get(key);
    if (prior === undefined || prior.bytes < bytes) {
      seen.set(key, { checkId: row.checkId, toolId: row.toolId, bytes });
    }
  }
  return [...seen.values()].sort(
    (a, b) => compareCodeUnits(a.checkId, b.checkId) || compareCodeUnits(a.toolId, b.toolId),
  );
}

export function programArgumentRemedy(checks: readonly ProgramArgumentCheck[]): string {
  const named = checks.map((row) => `${row.checkId} (${row.toolId}, ${row.bytes}-byte argument)`).join(", ");
  return `check(s) ${named} declare external evidence but pass program text to the tool as an argument (a multi-line argument or one over ${PROGRAM_ARGUMENT_MAX_BYTES} bytes); the attested tool is then only the interpreter and the deciding bytes are yours. Pass flags and names as args and leaf-bound files or stdin as operands, run an installed domain tool over the artifact, or declare the check's evidence "authored" with execution.requiredToolIds naming the interpreter`;
}
