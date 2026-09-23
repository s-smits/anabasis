/** The Builder's bounded experiment intent: EXPERIMENT.json, captured once before preview or submit
 *  and bound to the accepted bytes by digest. Intent never changes a score or a gate. */
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { Type, type Static } from "typebox";
import { Check as validateSchema } from "typebox/value";
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { isRecord } from "../meta/json-shape.ts";
import { type ContractFinding, controllerValidatedFinding } from "../truth/brief.ts";
import { EXPERIMENT_FILE } from "./builder-memory.ts";

/** Author claims about the next experiment, never host-certified difficulty and never a verdict.
 *  The target is deliberately thin — a comparator and a verified-pass count — because it is bound
 *  before any outcome is known, and a richer declaration would only be a richer thing to write
 *  after the fact. What the bytes actually moved is derived by the host from the captured
 *  measurement, not read from these fields. */
const ExperimentProposalSchema = Type.Object(
  {
    scope: Type.Union([Type.Literal("tasks"), Type.Literal("product")]),
    gap: Type.String(),
    change: Type.String(),
    expectedResult: Type.String(),
    target: Type.Object(
      {
        comparator: Type.Union([Type.Literal("at-least"), Type.Literal("at-most")]),
        verifiedPasses: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ExperimentProposal = Static<typeof ExperimentProposalSchema>;

export const ExperimentSubmissionSchema = Type.Object(
  {
    ...ExperimentProposalSchema.properties,
    digest: Type.String(),
  },
  { additionalProperties: false },
);
export type ExperimentSubmission = Static<typeof ExperimentSubmissionSchema>;

type Parsed = { ok: true; proposal: ExperimentProposal } | { ok: false; findings: ContractFinding[] };

const refusal = (code: string, detail: string) => ({
  ok: false as const,
  findings: [controllerValidatedFinding({ code, path: EXPERIMENT_FILE, detail })],
});

function parseExperimentProposal(value: unknown): Parsed {
  if (!validateSchema(ExperimentProposalSchema, value)) {
    return refusal(
      "experiment-proposal-shape",
      `Write exactly scope ("tasks" or "product"), gap, change, expectedResult and target {"comparator":"at-least"|"at-most","verifiedPasses":integer} in EXPERIMENT.json; the three text fields must be strings.`,
    );
  }
  const { scope, gap, change, expectedResult, target } = value;
  if (
    [gap, change, expectedResult].some(
      (field) => field.trim() === "" || new TextEncoder().encode(field).byteLength > 2_000,
    )
  ) {
    return refusal(
      "experiment-proposal-shape",
      "Each proposal text field must contain 1–2,000 UTF-8 bytes; keep the hypothesis and its supporting or contradicting result concise.",
    );
  }
  const proposal: ExperimentProposal = {
    scope,
    gap: gap.trim(),
    change: change.trim(),
    expectedResult: expectedResult.trim(),
    target: { comparator: target.comparator, verifiedPasses: target.verifiedPasses },
  };
  return { ok: true, proposal };
}

/** Historical intent stays author text, so only a captured, digest-bound declaration crosses:
 *  a submission whose digest does not match the proposal it carries is read as no declaration at
 *  all rather than as a corrected one. */
export function parseExperimentSubmission(value: unknown): ExperimentSubmission | null {
  if (!isRecord(value)) return null;
  const { digest, ...proposal } = value;
  const parsed = parseExperimentProposal(proposal);
  return parsed.ok && digest === hashJsonValue(parsed.proposal) ? { ...parsed.proposal, digest } : null;
}

/** Capture intent once, independently of candidate identity, so the declaration is fixed before
 *  the round that tests it and cannot be tuned to the result. Rewording this file produces a new
 *  digest and nothing else: it establishes membership in a new experiment, not a harder one. */
export function captureExperimentSubmission(
  workspace: string,
): { ok: true; experiment: ExperimentSubmission } | { ok: false; findings: ContractFinding[] } {
  let parsed: Parsed;
  try {
    parsed = parseExperimentProposal(capturedJsonParse(capturedProposal(workspace)));
  } catch {
    return refusal(
      "experiment-proposal-read",
      "Write EXPERIMENT.json as a regular JSON file before preview or submit; links and metadata over 16,384 bytes are refused.",
    );
  }
  if (!parsed.ok) return parsed;
  return { ok: true, experiment: { ...parsed.proposal, digest: hashJsonValue(parsed.proposal) } };
}

/** Refuse indirect paths before reading; hold a regular-file descriptor for the captured bytes. */
function capturedProposal(workspace: string): string {
  const root = realpathSync(workspace);
  const absolute = join(root, EXPERIMENT_FILE);
  if (realpathSync(absolute) !== absolute || !containsPath(absolute, root)) {
    throw new Error("indirect proposal path");
  }
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16_384) throw new Error("the proposal must be a bounded regular file");
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}
