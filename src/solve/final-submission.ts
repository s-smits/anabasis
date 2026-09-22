/** Controller-owned terminal authority. Generated code receives only SubmissionPort. */
import { sha256 } from "../meta/digest.ts";
import { capturedStructuredClone, hashJsonBytes, capturedJsonParse } from "../meta/json-runtime.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import {
  type PublicArtifactSchema,
  publicArtifactSchemaFindings,
  validatePublicArtifactSchema,
} from "./public-artifact-schema.ts";
import { keyIfNotNull } from "../meta/optional-key.ts";
import { isString } from "../meta/json-shape.ts";

interface FinalSubmissionRejection {
  code: string;
  safeRemedy: string;
}

type TerminalKind = "artifact" | "clarification" | "refusal";

export interface FinalSubmission {
  accepted: boolean;
  kind: TerminalKind | null;
  artifactJson: string | null;
  artifactDigest: string | null;
  clarification: { question: string } | null;
  refusal: { reason: string } | null;
  attempts: number;
  submittedAt: string | null;
  authorityCheckpointDigest: string;
  publicArtifactSchemaHash: string;
  rejection?: FinalSubmissionRejection;
}

interface SubmissionAuthorityConfig {
  maxAttempts: number;
  publicArtifactSchema: PublicArtifactSchema;
}

interface SubmissionCheckpoint {
  schema: typeof SUBMISSION_AUTHORITY_SCHEMA;
  config: SubmissionAuthorityConfig;
  state: {
    attempts: number;
    accepted: boolean;
    kind: TerminalKind | null;
    artifactJson: string | null;
    artifactDigest: string | null;
    clarification: { question: string } | null;
    refusal: { reason: string } | null;
    submittedAt: string | null;
    rejection: FinalSubmissionRejection | null;
  };
}

const SUBMISSION_AUTHORITY_SCHEMA = "submit-authority/v3";

interface SubmissionAuthority {
  attempts(): number;
  readonly maxAttempts: number;
  acceptArtifact(bytes: string): FinalSubmission;
  rejectAttempt(rejection: FinalSubmissionRejection): FinalSubmission;
  finalSubmission(): FinalSubmission | null;
  checkpoint(): SubmissionCheckpoint;
}

/** The starter's narrow view of the authority. `maxAttempts` is stated on the submit tool. */
export interface SubmissionPort {
  readonly maxAttempts: number;
  acceptArtifact(bytes: string): FinalSubmission;
  reject(rejection: FinalSubmissionRejection): FinalSubmission;
}

export function submissionPortOf(authority: SubmissionAuthority): SubmissionPort {
  return {
    maxAttempts: authority.maxAttempts,
    acceptArtifact: (bytes) => authority.acceptArtifact(bytes),
    reject: (rejection) => authority.rejectAttempt(rejection),
  };
}

function validateConfig(config: SubmissionAuthorityConfig): SubmissionAuthorityConfig {
  const max = config.maxAttempts;
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(
      `submission-authority config invalid: maxAttempts must be a positive finite integer, got ${String(max)}`,
    );
  }
  return {
    maxAttempts: max,
    publicArtifactSchema: validatePublicArtifactSchema(config.publicArtifactSchema),
  };
}

/** An accepted checkpoint must carry exactly its terminal: bytes whose digest matches, a payload
 *  that fits the kind, and an artifact that satisfies the public schema. */
function assertAcceptedRestore(
  restored: SubmissionCheckpoint["state"],
  cfg: ReturnType<typeof validateConfig>,
): void {
  if (
    restored.attempts < 1 ||
    !isString(restored.artifactJson) ||
    !isString(restored.submittedAt) ||
    restored.rejection !== null ||
    !["artifact", "clarification", "refusal"].some((known) => known === restored.kind)
  ) {
    throw new Error(
      "submission-authority restore refused: an accepted checkpoint must carry a terminal kind, captured bytes, a submittedAt, at least one attempt, and no rejection (terminal-kind invariant)",
    );
  }
  if (restored.artifactDigest !== sha256(restored.artifactJson)) {
    throw new Error(
      "submission-authority restore refused: checkpoint digest mismatch — artifactDigest is not sha256(artifactJson); the captured bytes or checkpoint were falsified",
    );
  }
  let restoredPayload: unknown;
  try {
    restoredPayload = capturedJsonParse(restored.artifactJson);
  } catch {
    throw new Error(
      "submission-authority restore refused: the checkpoint's captured bytes are not valid JSON — the authority only captures JSON bytes; the checkpoint was falsified",
    );
  }
  const wantClar = restored.kind === "clarification";
  const wantRef = restored.kind === "refusal";
  if (
    (restored.clarification !== null) !== wantClar ||
    (restored.refusal !== null) !== wantRef ||
    (wantClar && !isString(restored.clarification?.question)) ||
    (wantRef && !isString(restored.refusal?.reason))
  ) {
    throw new Error(
      "submission-authority restore refused: the terminal payload does not match the recorded kind (artifact carries neither, clarification carries { question }, refusal carries { reason })",
    );
  }
  if (
    restored.kind === "artifact" &&
    publicArtifactSchemaFindings(cfg.publicArtifactSchema, restoredPayload).length > 0
  ) {
    throw new Error(
      "submission-authority restore refused: the accepted artifact violates the checkpoint's public artifact schema; the checkpoint was falsified",
    );
  }
}

/** Validate a checkpoint against the freshly constructed authority before adopting its state. */
function assertRestorable(restore: SubmissionCheckpoint, cfg: ReturnType<typeof validateConfig>): void {
  // Widened to string: a falsified checkpoint may not match the literal its type promises.
  const schema: string = restore.schema;
  if (schema !== SUBMISSION_AUTHORITY_SCHEMA) {
    throw new Error(
      `submission-authority restore refused: checkpoint schema "${schema}" != "${SUBMISSION_AUTHORITY_SCHEMA}"`,
    );
  }
  if (!sameJsonValue(restore.config, cfg)) {
    throw new Error(
      "submission-authority restore refused: the checkpoint's attempt budget or public artifact schema differs from the freshly constructed one — a restart must preserve the authority's config identity",
    );
  }
  const restored = restore.state;
  if (!Number.isInteger(restored.attempts) || restored.attempts < 0) {
    throw new Error(
      "submission-authority restore refused: attempts out of bounds (must be a non-negative integer)",
    );
  }
  if (restored.attempts > cfg.maxAttempts) {
    throw new Error(
      `submission-authority restore refused: attempts (${restored.attempts}) exceed the budget (${cfg.maxAttempts}) — the authority refuses attempts past exhaustion, so this checkpoint was falsified`,
    );
  }
  if (restored.accepted) {
    assertAcceptedRestore(restored, cfg);
  } else if (
    restored.kind !== null ||
    restored.artifactJson !== null ||
    restored.artifactDigest !== null ||
    restored.clarification !== null ||
    restored.refusal !== null ||
    restored.submittedAt !== null ||
    (restored.rejection !== null && restored.attempts < 1)
  ) {
    throw new Error(
      "submission-authority restore refused: an unaccepted checkpoint must carry no kind/bytes/digest/payload/submittedAt, and a rejection implies at least one attempt (terminal-kind invariant)",
    );
  }
}

export function createSubmissionAuthority(
  config: SubmissionAuthorityConfig,
  restore?: SubmissionCheckpoint,
): SubmissionAuthority {
  const cfg = validateConfig(config);
  const state: SubmissionCheckpoint["state"] = {
    attempts: 0,
    accepted: false,
    kind: null,
    artifactJson: null,
    artifactDigest: null,
    clarification: null,
    refusal: null,
    submittedAt: null,
    rejection: null,
  };
  if (restore) {
    assertRestorable(restore, cfg);
    const restored = restore.state;
    state.attempts = restored.attempts;
    state.accepted = restored.accepted;
    state.kind = restored.kind;
    state.artifactJson = restored.artifactJson;
    state.artifactDigest = restored.artifactDigest;
    state.clarification = restored.clarification ? { ...restored.clarification } : null;
    state.refusal = restored.refusal ? { ...restored.refusal } : null;
    state.submittedAt = restored.submittedAt;
    state.rejection = restored.rejection ? { ...restored.rejection } : null;
  }

  const checkpoint = (): SubmissionCheckpoint => ({
    schema: SUBMISSION_AUTHORITY_SCHEMA,
    config: { ...cfg, publicArtifactSchema: capturedStructuredClone(cfg.publicArtifactSchema) },
    state: {
      ...state,
      clarification: state.clarification ? { ...state.clarification } : null,
      refusal: state.refusal ? { ...state.refusal } : null,
      rejection: state.rejection ? { ...state.rejection } : null,
    },
  });

  const fact = (): FinalSubmission | null => {
    if (state.attempts === 0 && !state.accepted) return null;
    return {
      accepted: state.accepted,
      kind: state.kind,
      artifactJson: state.artifactJson,
      artifactDigest: state.artifactDigest,
      clarification: state.clarification ? { ...state.clarification } : null,
      refusal: state.refusal ? { ...state.refusal } : null,
      attempts: state.attempts,
      submittedAt: state.submittedAt,
      authorityCheckpointDigest: hashJsonBytes(checkpoint()),
      publicArtifactSchemaHash: cfg.publicArtifactSchema.sha256,
      ...keyIfNotNull("rejection", state.rejection === null ? null : { ...state.rejection }),
    };
  };

  const factRequired = (): FinalSubmission =>
    /* SAFETY: `fact()` returns null only while no attempt has been counted and none was accepted; every caller below has already counted an attempt or is on the accepted terminal. */ fact() as FinalSubmission;

  const exhausted = (): FinalSubmission | null => {
    if (state.accepted || state.attempts < cfg.maxAttempts) return null;
    // Name the last substantive rejection once inside the exhaustion remedy, so it stays visible.
    if (state.rejection?.code !== "attempts-exhausted") {
      const prior = state.rejection;
      state.rejection = {
        code: "attempts-exhausted",
        safeRemedy:
          `the submit attempt budget (${cfg.maxAttempts}) is exhausted — no further attempts are accepted` +
          (prior === null ? "" : ` (the last attempt was rejected as ${prior.code})`),
      };
    }
    return factRequired();
  };

  const acceptTerminal = (
    kind: TerminalKind,
    bytes: string,
    payload: { clarification?: { question: string }; refusal?: { reason: string } },
  ): FinalSubmission => {
    state.accepted = true;
    state.kind = kind;
    state.artifactJson = bytes;
    state.artifactDigest = sha256(bytes);
    state.clarification = payload.clarification ?? null;
    state.refusal = payload.refusal ?? null;
    state.submittedAt = new Date().toISOString();
    state.rejection = null;
    return factRequired();
  };

  return {
    attempts: () => state.attempts,
    maxAttempts: cfg.maxAttempts,
    acceptArtifact: (bytes) => {
      if (state.accepted) return factRequired(); // accepted already: keep the answer and attempt count
      const refused = exhausted();
      if (refused) return refused;
      state.attempts += 1;
      let parsed: unknown;
      let parses = false;
      if (isString(bytes)) {
        try {
          parsed = capturedJsonParse(bytes);
          parses = true;
        } catch {
          parses = false;
        }
      }
      if (!parses) {
        state.rejection = {
          code: "artifact-unserialisable",
          safeRemedy:
            "the artifact is not one valid JSON value; replace an undefined or function root with JSON data and submit again",
        };
        return factRequired();
      }
      const schemaFindings = publicArtifactSchemaFindings(cfg.publicArtifactSchema, parsed);
      if (schemaFindings.length > 0) {
        const summary = schemaFindings
          .slice(0, 3)
          .map((finding) => `${finding.path}: expected ${finding.expected}, got ${finding.actual}`)
          .join("; ");
        state.rejection = {
          code: "artifact-public-schema",
          safeRemedy: `the artifact has the wrong public shape (${summary}); fix these fields and submit again`,
        };
        return factRequired();
      }
      return acceptTerminal("artifact", bytes, {});
    },
    rejectAttempt: (rejection) => {
      if (state.accepted) return factRequired(); // terminal — a late reject alters nothing
      const refused = exhausted();
      if (refused) return refused;
      state.attempts += 1;
      state.rejection = { code: rejection.code, safeRemedy: rejection.safeRemedy };
      return factRequired();
    },
    finalSubmission: fact,
    checkpoint,
  };
}
