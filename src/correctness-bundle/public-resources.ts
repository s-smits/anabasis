/**
 * A brief may contain public design constants and allowed values. The Judge needs those rules as
 * well as the domain name and the artifact schema: without them it can only abstain on any control
 * that depends on a design rule, which is an abstention about the card rather than about the
 * artifact.
 *
 * `briefPublicResources` returns public rule assertions and paths beside `designRuleConstants`
 * and `designRuleSets` to the solver, together with public rule decisions and the artifact schema.
 * The Judge receives the schema in its own field and applicable assertions with each task;
 * check ids, private implementations, hidden operands and verifier code stay excluded.
 */
import {
  capturedJsonParse as nativeParse,
  capturedJsonStringify as nativeStringify,
  capturedStructuredClone,
} from "../meta/json-runtime.ts";
import { readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { validateBrief } from "./brief-validator.ts";
import { type ArtifactField, type Brief, applicableTruthChecks } from "./brief.ts";
import { type BriefRuleDecision, isPublicRule } from "./rule-decisions.ts";
import { publishedMargins } from "./numeric-boundary.ts";
import { scoringClosureHash } from "../claim/scoring-closure.ts";
import type { JudgePublicDomain, JudgePublicTask } from "../review/judge.ts";
import type { GeneratedTask } from "./task-split.ts";
import { BRIEF_FILE } from "../meta/bundle-layout.ts";

// Keep these built-ins before generated code can run.
const nativeFreeze = Object.freeze.bind(Object);

export const PUBLIC_RESOURCES_TOOL = "read_public_resources";

type PublicResourceContent =
  | Array<{ assertion: string; publicInputPaths: string[] }>
  | BriefRuleDecision[]
  | Brief["artifactSchema"]
  | Brief["designRuleConstants"]
  | NonNullable<Brief["designRuleSets"]>;

export type PublicBriefResource = {
  name: string;
  content: unknown;
  /** SHA-256 of the resource schema, name, and content in canonical JSON. */
  digest: string;
};

function makePublicResource(name: string, content: PublicResourceContent): PublicBriefResource {
  return { name, content, digest: sha256(canonicalJson({ schema: "public-resource/v1", name, content })) };
}

/**
 * Every published row is rebuilt from its declared fields alone, in their declared order with each
 * array copied, never handed on as the object the Builder authored. A brief is Builder-authored
 * JSON: a row may carry keys no type names, and returning the authored object puts those bytes on
 * the solver tool and on every review card, so a rule-decision row carrying reference-artifact or
 * verifier bytes passes validation and reaches those model inputs. Validation answers whether a row
 * is well formed; this projection answers what leaves the brief, so an undeclared key reaches no
 * reader even where the validator does not yet refuse it.
 */
function declaredRow<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const fields = keys.flatMap((key) => {
    const value = row[key];
    return value === undefined ? [] : [[key, Array.isArray(value) ? [...value] : value] as const];
  });
  return /* SAFETY: every key is one of `keys` holding its own value; only an absent optional one is left out. */ Object.fromEntries(
    fields,
  ) as Pick<T, K>;
}

const RULE_DECISION_KEYS = ["id", "visibility", "statement", "families", "publicInputPaths"] as const;
const ARTIFACT_FIELD_KEYS = ["name", "shape", "allowedValues", "fileMap", "openMapPaths"] as const;
const CONSTANT_KEYS = ["name", "value", "unit", "authority", "citation"] as const;
const VALUE_SET_KEYS = ["name", "values", "unit", "authority", "citation"] as const;

/** The one owner of "which artifact-schema rows leave the brief", read by the solver resource and
 *  by the Judge card's own schema field so neither can publish bytes the other withholds. */
function publicArtifactSchemaRows(brief: Brief): ArtifactField[] {
  return brief.artifactSchema.map((field) => declaredRow(field, ARTIFACT_FIELD_KEYS));
}

/** The public rows, as `isPublicRule` (rule-decisions.ts) selects them for the citation rule too. */
export function publicRuleDecisions(brief: Brief): BriefRuleDecision[] {
  return (brief.ruleDecisions ?? [])
    .filter(isPublicRule)
    .map((decision) => declaredRow(decision, RULE_DECISION_KEYS));
}

export function briefPublicResources(brief: Brief): PublicBriefResource[] {
  const resources: PublicBriefResource[] = [];
  const publicRules = brief.truthChecks.map((check) => ({
    assertion: check.assertion,
    publicInputPaths: [...check.execution.publicInputPaths],
  }));
  if (publicRules.length > 0) resources.push(makePublicResource("public-validity-rules", publicRules));
  // The statement half of a rule whose paths the row above carries. A check's assertion is one
  // sentence, and a frame format, an ordering rule or a membership join needs more than a
  // sentence. Before this resource existed the only place with room for it was `decisions`, which
  // no model-visible projection carries.
  const ruleDecisions = publicRuleDecisions(brief);
  if (ruleDecisions.length > 0) resources.push(makePublicResource("public-rule-decisions", ruleDecisions));
  // The Judge card has always carried the artifact schema; the solver's did not, which left a
  // validity convention written in an artifact-schema field note readable by the Judge and not by
  // the solver, and failed cases on a rule the solver was never shown. The same public interface
  // now reaches both.
  if (brief.artifactSchema.length > 0) {
    resources.push(makePublicResource("artifact-schema", publicArtifactSchemaRows(brief)));
  }
  const constants = brief.designRuleConstants.map((constant) => declaredRow(constant, CONSTANT_KEYS));
  if (constants.length > 0) resources.push(makePublicResource("design-rule-constants", constants));
  const sets = (brief.designRuleSets ?? []).map((set) => declaredRow(set, VALUE_SET_KEYS));
  if (sets.length > 0) resources.push(makePublicResource("design-rule-sets", sets));
  return resources;
}

/** What the brief told the solver, as one digest over the public resources it reads and the margin
 *  table it is shown. A reworded or renumbered public rule, rule decision, artifact field, constant,
 *  value set or published margin moves it, and a private row, a decision, a gate and a join, which no
 *  solver reads, do not. */
export function briefPublicationHash(brief: Brief): string {
  const resources = briefPublicResources(brief).map(({ digest }) => digest);
  return sha256(canonicalJson({ resources, margins: publishedMargins(brief) }));
}

/** The brief a battery was scored under: the tree's valid brief while it still scores to the
 *  scoring hash the battery recorded, and null otherwise, so no reading speaks about other rules. */
export function scoredBrief(slugDir: string, scoringHash: string | null): Brief | null {
  const vouched =
    scoringHash !== null && scoringClosureHash(join(slugDir, "correctness-model")) === scoringHash;
  return vouched ? readValidatedBrief(slugDir) : null;
}

/** The one public card every review model receives, so that a review reads the domain rules from
 *  one card rather than inferring them from whatever trace it happens to have been shown. */
export function judgePublicDomainOf(
  brief: Brief,
  context: Pick<JudgePublicDomain, "publicRequest" | "toolContract" | "runtimeFacts">,
): JudgePublicDomain {
  return {
    slug: brief.slug,
    domain: brief.domain,
    publicRequest: context.publicRequest,
    artifactSchema: capturedStructuredClone(publicArtifactSchemaRows(brief)),
    publicResources: briefPublicResources(brief).filter(
      // The card already carries the schema as its own field, and public rules enter per task.
      ({ name }) => name !== "public-validity-rules" && name !== "artifact-schema",
    ),
    // Both cards exclude `brief.decisions`. It maps which task families the harness covers and
    // which it leaves out, which is not the declaration of a public correctness rule. A Judge-only
    // resource carrying it here looks like a way to give the reviewer the rules a check missed,
    // and it is the wrong one: a rule the solver never receives is not a public validity
    // condition, so free text the Judge alone holds lets it apply conditions the solver could not
    // have met. Both cards use truthChecks, designRuleConstants, designRuleSets and the public
    // ruleDecisions rows, which reach this card through `briefPublicResources` precisely because
    // the solver receives them too.
    toolContract: capturedStructuredClone(context.toolContract),
    runtimeFacts: capturedStructuredClone(context.runtimeFacts),
  };
}

/** The existing truth-check rows remain the sole rule owner. This Judge-only projection adds the
 * applicable public assertions to one task without exposing check ids, predicates or markers. */
export function judgePublicTaskOf(
  brief: Brief,
  task: GeneratedTask<unknown, Array<{ checkId: string }>>,
): JudgePublicTask {
  const publicValidityRules = applicableTruthChecks(brief, task).flatMap((check) => [
    { assertion: check.assertion, publicInputPaths: [...check.execution.publicInputPaths] },
  ]);
  const publicTask: JudgePublicTask = {
    taskId: task.taskId,
    family: task.family,
    publicInput: task.publicInput,
  };
  if (publicValidityRules.length > 0) publicTask.publicValidityRules = publicValidityRules;
  return capturedStructuredClone(publicTask);
}

/** Read the public rules from a saved, valid brief. Missing and unfinished briefs return null.
 *  Candidate acceptance and the bundle loader remain responsible for brief validity. */
export function readValidatedBrief(slugDir: string): Brief | null {
  const file = join(slugDir, BRIEF_FILE);
  let parsed: unknown;
  try {
    parsed = nativeParse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!validateBrief(parsed).ok) return null;
  return /* SAFETY: the check above returned when `!validateBrief(parsed).ok`. */ parsed as Brief;
}

export function readPublicResources(slugDir: string): PublicBriefResource[] {
  const brief = readValidatedBrief(slugDir);
  return brief === null ? [] : briefPublicResources(brief);
}

/** Give the solver the same public rules passed to the Judge. contracts.ts adds this tool. */
export function publicResourcesTool(resources: readonly PublicBriefResource[]): AgentTool<never> | null {
  if (resources.length === 0) return null;
  const tool: AgentTool = {
    name: PUBLIC_RESOURCES_TOOL,
    label: "Read public rules",
    description:
      "Read this domain's public validity rules with their task paths, rule decisions, answer schema, fixed constants and allowed values.",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: nativeStringify({ resources }, null, 2) }],
      details: { resources },
    }),
  };
  nativeFreeze(tool);
  return /* SAFETY: `AgentTool<never>` is the roster's common type; the tool keeps the parameter schema declared above and is frozen on the previous line. */ tool as AgentTool<never>;
}
