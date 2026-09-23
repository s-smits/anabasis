/**
 * A brief may contain public design constants and allowed values. Run 50 showed that the Judge needs
 * these rules as well as the domain name and the artifact schema: without them it could only abstain
 * on any control that depended on a design rule, which is an abstention about the card rather than
 * about the artifact.
 *
 * `briefPublicResources` returns public rule assertions and paths beside `designRuleConstants`
 * and `designRuleSets` to the solver, together with public rule decisions and the artifact schema.
 * The Judge receives the schema in its own field and applicable assertions with each task;
 * check ids, private implementations, hidden operands and verifier code stay excluded.
 */
import { readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { validateBrief } from "./brief-validator.ts";
import {
  type ArtifactField,
  type Brief,
  type DesignRuleConstant,
  type DesignRuleSet,
  applicableTruthChecks,
} from "./brief.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { BriefRuleDecision } from "./rule-decisions.ts";
import type { JudgePublicDomain, JudgePublicTask } from "./judge.ts";
import type { GeneratedTask } from "./task-split.ts";
import {
  trustedJsonParse as nativeParse,
  trustedJsonStringify as nativeStringify,
  trustedStructuredClone,
} from "./trusted-runtime.ts";
import { BRIEF_FILE } from "../meta/bundle-layout.ts";

// Keep these built-ins before generated code can run. contracts.ts imports trusted-runtime first.
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
 * Every published row is rebuilt from its declared fields alone, never handed on as the object the
 * Builder authored. A brief is Builder-authored JSON: a row may carry keys no type names, and
 * returning the authored object put those bytes on the solver tool, the Judge card and the former Repair
 * Engineer's domain card — a rule-decision row carrying reference-artifact or verifier bytes
 * passed validation and reached those model inputs. Validation answers whether a row is
 * well formed; these projections answer what leaves the brief, so an undeclared key reaches no
 * reader even where the validator does not yet refuse it.
 */
function publicRuleDecisionRow(decision: BriefRuleDecision): BriefRuleDecision {
  return {
    id: decision.id,
    visibility: decision.visibility,
    statement: decision.statement,
    ...keyIfDefined("families", decision.families === undefined ? undefined : [...decision.families]),
    ...keyIfDefined(
      "publicInputPaths",
      decision.publicInputPaths === undefined ? undefined : [...decision.publicInputPaths],
    ),
  };
}

function publicArtifactField(field: ArtifactField): ArtifactField {
  return {
    name: field.name,
    "shape": field["shape"],
    ...keyIfDefined(
      "allowedValues",
      field.allowedValues === undefined ? undefined : [...field.allowedValues],
    ),
    ...keyIfDefined("fileMap", field.fileMap),
    ...keyIfDefined("taskConditioned", field.taskConditioned),
    ...keyIfDefined("openMapPaths", field.openMapPaths === undefined ? undefined : [...field.openMapPaths]),
  };
}

function publicDesignRuleConstant(constant: DesignRuleConstant): DesignRuleConstant {
  return {
    name: constant.name,
    value: constant.value,
    ...keyIfDefined("unit", constant.unit),
    authority: constant.authority,
    citation: constant.citation,
  };
}

function publicDesignRuleSet(set: DesignRuleSet): DesignRuleSet {
  return {
    name: set.name,
    values: [...set.values],
    ...keyIfDefined("unit", set.unit),
    authority: set.authority,
    citation: set.citation,
  };
}

/** The one owner of "which artifact-schema rows leave the brief", read by the solver resource and
 *  by the Judge card's own schema field so neither can publish bytes the other withholds. */
function publicArtifactSchemaRows(brief: Brief): ArtifactField[] {
  return brief.artifactSchema.map(publicArtifactField);
}

/** The one owner of "which rule decisions leave the brief". Both the projection below and the
 *  publish-or-refuse rule in published-rules.ts read this, so a candidate cannot be refused for
 *  withholding a statement the solver would in fact have received, or accepted for publishing one
 *  it would not. */
export function publicRuleDecisions(brief: Brief): BriefRuleDecision[] {
  return (brief.ruleDecisions ?? [])
    .filter((decision) => decision.visibility === "public")
    .map(publicRuleDecisionRow);
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
  // The Judge card has always carried the artifact schema; the solver's did not. Run w12 lost all
  // 14 of its verified failures to validity conventions written only in artifact-schema field notes
  // that the Judge could read and the solver could not, so the same public interface now reaches
  // both.
  if (brief.artifactSchema.length > 0) {
    resources.push(makePublicResource("artifact-schema", publicArtifactSchemaRows(brief)));
  }
  if (brief.designRuleConstants.length > 0) {
    resources.push(
      makePublicResource("design-rule-constants", brief.designRuleConstants.map(publicDesignRuleConstant)),
    );
  }
  const sets = brief.designRuleSets ?? [];
  if (sets.length > 0) resources.push(makePublicResource("design-rule-sets", sets.map(publicDesignRuleSet)));
  return resources;
}

/** The one public card every review model receives. Run 50 added it for the Main Judge's census, so
 *  that a review reads the domain rules from one card rather than inferring them from the trace it
 *  happens to have been shown. */
export function judgePublicDomainOf(
  brief: Brief,
  context: Pick<JudgePublicDomain, "publicRequest" | "toolContract" | "runtimeFacts">,
): JudgePublicDomain {
  return {
    slug: brief.slug,
    domain: brief.domain,
    publicRequest: context.publicRequest,
    artifactSchema: trustedStructuredClone(publicArtifactSchemaRows(brief)),
    publicResources: briefPublicResources(brief).filter(
      // The card already carries the schema as its own field, and public rules enter per task.
      ({ name }) => name !== "public-validity-rules" && name !== "artifact-schema",
    ),
    // Both cards exclude `brief.decisions`. It maps which task families the harness covers and
    // which it leaves out, which is not the declaration of a public correctness rule. A Judge-only
    // `design-decisions` resource once carried it here, added after run 69's missed derived-field
    // rules, and that was the mistake: a rule the solver never receives is not a public validity
    // condition, so giving the free text to the Judge alone let it apply conditions the solver
    // could not have met. Both cards now use truthChecks, designRuleConstants, designRuleSets and
    // the public ruleDecisions rows, which reach this card through `briefPublicResources` precisely
    // because the solver receives them too.
    toolContract: trustedStructuredClone(context.toolContract),
    runtimeFacts: trustedStructuredClone(context.runtimeFacts),
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
  return trustedStructuredClone(publicTask);
}

/** Read the public rules from a saved, valid brief. Missing and unfinished briefs return an
 *  null. Candidate acceptance and the bundle loader remain responsible for brief validity. */
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
