/**
 * The battery's Judge phase reviews only eligible artifacts: accepted submissions with a boolean
 * verifier verdict. The Judge advises and the host verifier decides: nothing in this phase changes
 * pass, acceptance or whether a claim can be created, and no disagreement buys further calls: no
 * control and no bait subject reaches the Judge at all (operator decision).
 */
import type { RunCondition } from "../claim/case-record.ts";
import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { readJsonFile } from "../meta/completed-json.ts";
import { hashJsonValue, requireJsonValue } from "../meta/stable-json.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { isBoolean } from "../meta/json-shape.ts";
import { TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { CASE_JUDGE_FILE, SUBMIT_MAX_ATTEMPTS } from "./battery-record.ts";
import { type Brief, throwIfInvalid } from "./brief.ts";
import type { JudgePublicDomain } from "./judge-contract.ts";
import { JudgeCensus, type JudgeCensusSubject } from "./judge-census.ts";
import type { JudgeObservation, JudgeSession } from "./judge.ts";
import { briefPublicResources, judgePublicDomainOf, judgePublicTaskOf } from "./public-resources.ts";
import { sanitizeForEvaluator } from "./sanitize.ts";
import { type ToolsSpec, expectedBuiltToolNames, validateToolsSpec } from "./tools-spec.ts";
import { JUDGE_PUBLIC_CONTEXT_FILE, JUDGE_PUBLIC_CONTEXT_SCHEMA } from "./declared-projection.ts";

/** The Judge's public context card for this run, and the one builder of the domain card every
 *  review model receives: the brief's public projection, the Builder-declared tools and the
 *  declared runtime facts. Two builders of this card drift apart silently: one path keeps sending
 *  populated prompts while the other sends a null publicRequest, toolContract and runtimeFacts to
 *  reviewers who then judge an artifact without knowing what was asked for. The card carries all
 *  declared public rules; each subject binds only the applicable task projection. Missing
 *  tools-spec bytes state a null contract; a spec that fails validation throws, because a card
 *  built from an invalid contract would misdescribe the condition to every reviewer. */
export function judgeDomainForRun(
  brief: Brief,
  bundleSnapshotDir: string,
  facts: { publicRequest: string | null; capabilities: string[]; condition: RunCondition },
): JudgePublicDomain {
  const toolsFile = join(bundleSnapshotDir, TOOLS_SPEC_FILE);
  let toolContract = null;
  if (existsSync(toolsFile)) {
    const raw: unknown = readJsonFile(toolsFile);
    throwIfInvalid(validateToolsSpec(raw), "bundle-snapshot tools spec failed validation");
    const source =
      /* SAFETY: throwIfInvalid above returns only when `validateToolsSpec` reported ok, the only proof of this shape. */ raw as ToolsSpec;
    toolContract = {
      presets: [...source.presets],
      tools: source.tools.map(({ name, kind, description }) => ({ name, kind, description })),
      availableToolNames: expectedBuiltToolNames(source, {
        publicResources: briefPublicResources(brief).length > 0,
      }),
    };
  }
  return judgePublicDomainOf(brief, {
    publicRequest: facts.publicRequest,
    toolContract,
    runtimeFacts: {
      capabilities: [...facts.capabilities],
      maxSubmitAttempts: SUBMIT_MAX_ATTEMPTS,
      condition: facts.condition,
    },
  });
}

/** Record the exact sanitized public context the Judge will see, with its digest, so a later
 *  dispute can cite the exact condition the Judge saw. */
export function writeJudgePublicContext(
  write: (path: string, value: JsonValue) => void,
  judgeDomain: JudgePublicDomain,
): void {
  const visibleDomain = sanitizeForEvaluator(judgeDomain);
  write(JUDGE_PUBLIC_CONTEXT_FILE, {
    schema: JUDGE_PUBLIC_CONTEXT_SCHEMA,
    publicDomain: requireJsonValue(visibleDomain.value),
    publicDomainDigest: hashJsonValue(visibleDomain.value),
    sanitizer: {
      version: visibleDomain.version,
      modified: visibleDomain.modified,
      actions: visibleDomain.actions,
    },
  });
}

/** Eligible subject = accepted artifact with a boolean truth verdict. An unaccepted submission,
 *  refusal, non-result or missing artifact has either no artifact to inspect or no verifier
 *  verdict to compare against, so it is never offered and never paid for. */
export function judgeBatterySubject(input: {
  taskId: string;
  judgeDomain: JudgePublicDomain;
  judgeTask: ReturnType<typeof judgePublicTaskOf>;
  submittedArtifact: JsonValue | null;
  truthOk: boolean | null;
}): JudgeCensusSubject | null {
  if (input.submittedArtifact === null || !isBoolean(input.truthOk)) return null;
  return {
    evidencePath: `cases/${input.taskId}/${CASE_JUDGE_FILE}`,
    request: {
      subjectId: input.taskId,
      publicContext: {
        domain: input.judgeDomain,
        // A fresh public projection only: no hidden task rows and no verifier result can
        // enter the judge request type.
        publicTask: input.judgeTask,
      },
      submittedArtifact: input.submittedArtifact,
    },
    subjectKind: "battery-case",
    observation: { verifierVerdict: input.truthOk },
  };
}

/** Every eligible subject uses the same strict validator and consecutive-failure bound. */
export async function runJudgePhase(input: {
  judge: JudgeSession;
  subjects: JudgeCensusSubject[];
  write: (path: string, value: JsonValue) => void;
}): Promise<JudgeObservation[]> {
  if (input.subjects.length === 0) return [];
  const reviewed = await new JudgeCensus(input.judge, input.write).run(input.subjects);
  return reviewed.observations;
}
