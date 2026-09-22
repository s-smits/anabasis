/** Fresh-only controller contracts formerly embedded in the replaced seven-session author workflow. */
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import { type Brief, type ContractFinding, controllerValidatedFindings } from "../truth/brief.ts";
import type { ControlCorpus } from "../truth/controls.ts";
import type { TaskValidationContext } from "../truth/tasks.ts";
import { publishedRuleFindings } from "../truth/published-rules.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export function freshTaskValidationContext(exactTasks?: number): TaskValidationContext {
  return { exactTasks: exactTasks ?? null, authoring: true };
}

function briefContractFindings(brief: Brief): ContractFinding[] {
  return [
    // Without a marked root the family census has nothing to move between siblings, so silence
    // would be the way past it. Which roots carry the deliverable stays the Builder's decision.
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
    // Withholding is a property of everything the agent can read: a check may not enforce a rule the
    // public projection does not carry (published-rules.ts).
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
 * Compose the unique fresh-build rules at the shared from-disk candidate check boundary.
 *
 * Every finding this file produces survives the candidate check's author projection: the candidate check wraps
 * the whole result in controllerValidatedFindings (candidate-check.ts). That is sound because each
 * producer here compares the brief and the controls against each other
 * and reads no verifier result, counterexample or control artifact — the calibration shortfalls
 * count the Builder's own control rows.
 *
 * A new producer inherits that marking rather than opting into it, so before adding one, read every
 * finding it can emit and keep its detail to public authoring identities.
 */
export function freshCandidateFindings(loaded: {
  brief: Brief | null;
  corpus: ControlCorpus | null;
}): ContractFinding[] {
  const findings: ContractFinding[] = [];
  if (loaded.brief !== null) {
    findings.push(...briefContractFindings(loaded.brief));
  }
  if (loaded.corpus !== null) {
    findings.push(...controllerValidatedFindings([]));
    if (loaded.brief !== null) {
      findings.push(...representationFindings(loaded.brief, loaded.corpus));
    }
  }
  return findings;
}
