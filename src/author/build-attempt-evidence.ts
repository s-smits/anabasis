/**
 * Fallback evidence for a Builder authoring turn that settles without a candidate, at a point where
 * the normal iteration evidence cannot exist yet. It is deliberately kept out of iteration.json,
 * because campaign memory treats that filename as the mark of completed build state — a directory
 * without it holds unfinished work — so writing a failed turn there would make the round look
 * finished to every later reader. Only operator projections read these rows.
 */
import { existsSync, mkdirSync, readdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { plainRecord } from "../meta/json-evidence.ts";
import type { SourceIdentity } from "../run/source-identity.ts";
import type { BuildAgentTurnNonResult } from "./build-agent.ts";
import type { SessionBuildStage } from "./campaign-types.ts";
import { writeCompleted } from "./campaign-epoch.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { runtimeProcess } from "../meta/process.ts";
import { readJsonFile } from "../meta/completed-json.ts";

const AUTHORING_ATTEMPT_EVIDENCE_DIR = "evidence-builder-authoring";

export type AuthoringSessionQuality = {
  stage: SessionBuildStage;
  state: "accepted" | "rejected" | "non-result";
  attempts: number;
};

export type AuthoringAttemptEvidence = {
  schema: "builder-authoring-attempts/v1";
  evidenceOwner: "controller-evidence";
  ordinal: number;
  dir: string;
  outcome: "non-result";
  terminal: {
    role: string;
    status: "failed" | "aborted" | "max_tokens";
    attribution: null;
  };
  authorCalls: Record<string, number>;
  sessions: AuthoringSessionQuality[];
  source: SourceIdentity | null;
  writtenAt: string;
};

export function writeAuthoringAttemptEvidence(input: {
  epochDir: string;
  ordinal: number;
  dir: string;
  error: BuildAgentTurnNonResult;
  authorCalls: Record<string, number>;
  sessions: AuthoringSessionQuality[];
  source: SourceIdentity | null;
}): AuthoringAttemptEvidence {
  const evidence: AuthoringAttemptEvidence = {
    schema: "builder-authoring-attempts/v1",
    evidenceOwner: "controller-evidence",
    ordinal: input.ordinal,
    dir: input.dir,
    outcome: "non-result",
    terminal: {
      role: input.error.role,
      status: input.error.status,
      attribution: null,
    },
    authorCalls: { ...input.authorCalls },
    sessions: input.sessions,
    source: input.source,
    writtenAt: new Date().toISOString(),
  };
  const evidenceDir = join(input.epochDir, AUTHORING_ATTEMPT_EVIDENCE_DIR);
  mkdirSync(evidenceDir, { recursive: true });
  const file = join(
    evidenceDir,
    `${String(input.ordinal).padStart(2, "0")}-${Date.now()}-${runtimeProcess.pid}.json`,
  );
  writeCompleted(file, evidence);
  return evidence;
}

function isAuthoringAttemptEvidence(value: JsonValue): value is AuthoringAttemptEvidence & JsonValue {
  const row = plainRecord(value);
  const terminal = plainRecord(row?.terminal);
  return (
    row?.schema === "builder-authoring-attempts/v1" &&
    row.evidenceOwner === "controller-evidence" &&
    row.outcome === "non-result" &&
    Number.isInteger(row.ordinal) &&
    isString(row.dir) &&
    Array.isArray(row.sessions) &&
    terminal !== null &&
    isString(terminal.role) &&
    isString(terminal.status) &&
    ["failed", "aborted", "max_tokens"].includes(terminal.status)
  );
}

export function readAuthoringAttemptEvidence(epochDir: string): AuthoringAttemptEvidence[] {
  const dir = join(epochDir, AUTHORING_ATTEMPT_EVIDENCE_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const path = join(dir, file);
      let parsed: JsonValue;
      try {
        parsed = readJsonFile(path);
      } catch (error) {
        throw new Error(`${path}: unreadable (${errorMessage(error)})`, { cause: error });
      }
      if (!isAuthoringAttemptEvidence(parsed)) {
        throw new Error(`${path}: not a builder-authoring-attempts/v1 evidence`);
      }
      return parsed;
    });
}
