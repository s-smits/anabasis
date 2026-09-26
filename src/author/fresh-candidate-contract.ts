/** The controller contracts that apply to a fresh build alone, kept together so a continuation
 *  round cannot be measured against a rule written for a first one. */
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { Brief, ContractFinding } from "../truth/brief.ts";
import type { ControlCorpus } from "../truth/controls.ts";
import type { TaskValidationContext } from "../truth/tasks.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, published-rules): commented out (unsure): the archived
// producer sits commented at the end of rule-decisions.ts.
// import { publishedRuleFindings } from "../truth/rule-decisions.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export function freshTaskValidationContext(exactTasks?: number): TaskValidationContext {
  return { exactTasks: exactTasks ?? null };
}

// Gate audit 2026-09-25 (docs/gate-audit.md, accept-schema): kept: an accept control that the public artifact
// schema cannot compile is a contradiction in the Builder's own bytes, and the solver is told that schema.
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
  // Gate audit 2026-09-25 (docs/gate-audit.md, published-rules): commented out (unsure): every truth check
  // must cite a published rule decision; unsure the citation earns a refusal, since it cannot show the cited
  // prose states what the check enforces.
  // if (loaded.brief !== null) {
  //   // Withholding is a property of everything the agent can read, so a check may not enforce a
  //   // rule the public projection does not carry (published-rules.ts).
  //   findings.push(...publishedRuleFindings(loaded.brief));
  // }
  if (loaded.brief !== null && loaded.corpus !== null) {
    findings.push(...representationFindings(loaded.brief, loaded.corpus));
  }
  return findings;
}
