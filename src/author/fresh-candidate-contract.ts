/** Controller contracts that apply only to a fresh build. */
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { Brief, ContractFinding } from "../truth/brief.ts";
import type { ControlCorpus } from "../truth/controls.ts";
import type { TaskValidationContext } from "../truth/tasks.ts";
import { publishedRuleFindings } from "../truth/published-rules.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export function freshTaskValidationContext(exactTasks?: number): TaskValidationContext {
  return { exactTasks: exactTasks ?? null, authoring: true };
}

function briefContractFindings(brief: Brief): ContractFinding[] {
  return [
    // The family census needs at least one marked root; which roots to mark is the Builder's choice.
    ...(brief.artifactSchema.some((field) => field.taskConditioned === true)
      ? []
      : [
          {
            code: "brief-material-root-missing",
            path: "artifactSchema",
            detail:
              'no artifact schema field declares "taskConditioned": true — the root(s) holding what a solver must produce anew for each task, as against the report and other supporting fields. Mark them, so the family census can tell a family that needs one deliverable per task from one answered by a single deliverable',
          },
        ]),
    // A check may not enforce a rule the public projection does not carry.
    ...publishedRuleFindings(brief),
  ];
}

function representationFindings(brief: Brief, corpus: ControlCorpus): ContractFinding[] {
  const findings: ContractFinding[] = [];
  try {
    compilePublicArtifactSchema(
      brief.artifactSchema,
      corpus.accept.map((accept) => accept.artifact),
    );
  } catch (error) {
    findings.push({
      code: "controls-accept-public-schema-inconsistent",
      path: "accept",
      detail: errorMessage(error),
    });
  }
  return findings;
}

/**
 * The fresh-build findings for the candidate check. The candidate check marks every one as
 * author-visible, which is sound because each producer compares only the brief and controls and
 * reads no verifier output. A new producer inherits that marking, so its detail must stay to
 * public authoring identities.
 */
export function freshCandidateFindings(loaded: {
  brief: Brief | null;
  corpus: ControlCorpus | null;
}): ContractFinding[] {
  const findings: ContractFinding[] = [];
  if (loaded.brief !== null) {
    findings.push(...briefContractFindings(loaded.brief));
  }
  if (loaded.brief !== null && loaded.corpus !== null) {
    findings.push(...representationFindings(loaded.brief, loaded.corpus));
  }
  return findings;
}
