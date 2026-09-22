/** Save one Builder session's execution record and separate prose file. */
import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { readJsonFile, writeCompleted } from "../meta/completed-json.ts";
import { type BuilderExecutionInvocation, postTerminalInvocation } from "../run/builder-execution-closure.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { BUILDER_EXECUTION_EVIDENCE_FILE, type BuilderExecutionEvidence } from "./builder-execution.ts";
import { proseSidecarExists, writeBuilderProse } from "./builder-prose.ts";

/** One file per authoring session: the first session owns the bare name, each later session takes
 *  the next free numbered name. The epoch-level single path could not hold a multi-session epoch —
 *  run 12x's repair session overwrote the opening build's record and left 3 of 4 sessions
 *  unobservable. */
function claimEvidencePath(epochDir: string): string {
  let path = join(epochDir, BUILDER_EXECUTION_EVIDENCE_FILE);
  for (let session = 2; existsSync(path) || proseSidecarExists(path); session += 1) {
    path = join(epochDir, `builder-execution-${String(session).padStart(2, "0")}.json`);
  }
  return path;
}

function jsonEvidence(evidence: BuilderExecutionEvidence): JsonValue {
  return capturedJsonParse(capturedJsonStringify(evidence));
}

/** Write the JSON record and prose from one evidence object. Store prose rows separately in
 *  `builder-prose(-NN).jsonl`, using the same session number as the execution record. */
function writeRecordAndProse(path: string, evidence: BuilderExecutionEvidence, captureId: string): void {
  const { prose, ...record } = evidence;
  if (prose === undefined) {
    writeCompleted(path, jsonEvidence(record));
    return;
  }
  const proseCapture = writeBuilderProse(
    path,
    { rows: prose, omitted: evidence.proseOmitted ?? 0 },
    captureId,
  );
  writeCompleted(path, jsonEvidence({ ...record, proseCapture }));
}

/** Keep this record's original run ID and closing time when later invocations start or end. */
function recordedInvocation(path: string): BuilderExecutionInvocation | null {
  try {
    const record = readJsonFile(path);
    const witness = isRecord(record) ? (record.closure ?? record.postTerminal) : null;
    if (
      !isRecord(witness) ||
      !isString(witness.runId) ||
      witness.runId.length === 0 ||
      !isString(witness.closedAt) ||
      !Number.isFinite(Date.parse(witness.closedAt))
    ) {
      return null;
    }
    return { runId: witness.runId, closedAt: witness.closedAt };
  } catch {
    return null;
  }
}

/** A late checkpoint cannot reopen a closed invocation. Keep its newest session evidence,
 *  retain its original run closure, and preserve final outcomes reported by the session. */
function withClosure(
  evidence: BuilderExecutionEvidence,
  epochDir: string,
  path: string,
): BuilderExecutionEvidence {
  const after = recordedInvocation(path) ?? postTerminalInvocation(epochDir);
  if (after === null) return evidence;
  return evidence.outcome === "in-flight"
    ? { ...evidence, outcome: "recorded-at-terminal", closure: after, postTerminal: after }
    : { ...evidence, postTerminal: after };
}

export function writeBuilderExecutionEvidence(epochDir: string, evidence: BuilderExecutionEvidence): void {
  const path = claimEvidencePath(epochDir);
  writeRecordAndProse(path, withClosure(evidence, epochDir, path), crypto.randomUUID());
}

/** Choose a numbered file on the first write and update it on each later write from this session.
 *  Checkpoints and the final result therefore share one record, rather than leaving separate
 *  partial records. Another session gets the next unused name from claimEvidencePath,
 *  preserving one execution file per session. */
export function builderExecutionEvidenceWriter(
  epochDir: string,
): (evidence: BuilderExecutionEvidence) => void {
  let claimed: string | undefined;
  const captureId = crypto.randomUUID();
  return (evidence) => {
    claimed ??= claimEvidencePath(epochDir);
    writeRecordAndProse(claimed, withClosure(evidence, epochDir, claimed), captureId);
  };
}
