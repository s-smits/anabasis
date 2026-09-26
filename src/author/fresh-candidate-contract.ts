/** The controller contracts that apply to a fresh build alone, kept together so a continuation
 *  round cannot be measured against a rule written for a first one. */
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { Brief, ContractFinding } from "../correctness-bundle/brief.ts";
import type { ControlCorpus } from "../correctness-bundle/controls.ts";
import type { TaskValidationContext } from "../correctness-bundle/tasks.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export function freshTaskValidationContext(exactTasks?: number): TaskValidationContext {
  return { exactTasks: exactTasks ?? null };
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
 * Every finding this file produces survives the candidate check's author projection, because the
 * candidate check wraps the whole result in `controllerValidatedFindings`. That is sound only
 * because each producer here compares the brief and the controls against each other and reads no
 * verifier result, counterexample or control artifact -- the calibration shortfalls count the
 * Builder's own control rows.
 *
 * A new producer inherits that marking rather than opting into it, so before adding one, read every
 * finding it can emit and keep its detail to public authoring identities.
 */
export function freshCandidateFindings(loaded: {
  brief: Brief | null;
  corpus: ControlCorpus | null;
}): ContractFinding[] {
  const findings: ContractFinding[] = [];
  if (loaded.brief !== null && loaded.corpus !== null) {
    findings.push(...representationFindings(loaded.brief, loaded.corpus));
  }
  return findings;
}
