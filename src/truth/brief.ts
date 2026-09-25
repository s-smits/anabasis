export {
  CHECK_PROGRAM_CONTRACT,
  applicableTruthChecks,
  requiredToolsOf,
} from "../../vendor/correctness-model-bundle/evaluation-public-task.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { requiredToolsOf } from "../../vendor/correctness-model-bundle/evaluation-public-task.ts";
import {
  VERIFIER_CONTRACT_HINTS,
  type VerifierContractCode,
} from "../../vendor/correctness-model-bundle/contract-error.ts";
/**
 * The brief contract, authored by the Builder and checked by `validateBrief` during candidate
 * validation. The same requirements apply to every backend.
 *
 * Each requirement carries the failure that motivates it:
 *  - decisions and gates non-empty, because a brief that decides nothing builds nothing;
 *  - truth checks typed with decidable text, because otherwise the verifier returns verdicts under
 *    checkIds the brief never declared;
 *  - joins carrying decoy obligations, because covering the check labels does not prove the join is
 *    correct. Each declared join must name the decoy classes that would fool a presence-only check,
 *    and the control corpus must cover them (see controls.ts);
 *  - design-rule constants citing an external authority, because a join can be sound while the rule
 *    it enforces is wrong and every reader inside the build agrees with it. A constant needs a
 *    source outside the build so that a reviewer can check the value against something the build
 *    did not produce.
 */
import type { TruthCheck } from "../../vendor/correctness-model-bundle/truth-checks.ts";
import { isRecord, isString, typeName, type JsonValue } from "../meta/json-shape.ts";
import { jsonPathTokens } from "../meta/json-evidence.ts";
import type { NumericBoundaryDeclaration } from "./numeric-boundary.ts";
import type { BriefRuleDecision } from "./rule-decisions.ts";

export type CheckExecution = {
  families: "all" | string[];
  artifactPaths: string[];
  publicInputPaths: string[];
  hidden: "none" | "required";
  /** The tools an authored check runs. An external check names its tools inside `evidence`
   * instead, and the validator refuses this list beside it. Neither list proves provenance. */
  requiredToolIds?: [string, ...string[]];
  evidence: { kind: "authored" } | { kind: "external"; requiredToolIds: [string, ...string[]] };
};

export type BriefTruthCheck = TruthCheck & {
  execution: CheckExecution;
  joinIds?: string[];
  /** Ids of `brief.ruleDecisions` whose statements state this check's rule. Every cited decision
   * must be public, so the condition this check enforces is one the solver can read. */
  citedDecisionIds?: string[];
  /** Exact numeric equality points that distinguish inclusive from strict rules. The value comes
   * from one cited design-rule constant; tasks and controls must witness this point directly. */
  numericBoundaries?: NumericBoundaryDeclaration[];
};

type BriefJoin = {
  id: string;
  /** What is joined against what, by which exact key. */
  description: string;
  /** Decoy classes a presence-only or lookalike check would miss; every one needs a reject control. */
  decoyClasses: string[];
};

/**
 * One top-level field of the canonical submitted artifact. The brief owns the artifact shape, and
 * the controls, the correctness model and the generated tools all read that one declared
 * representation. With no single owner the accept-control author and the verifier drift onto
 * different field names, and then every known-good control is rejected — each binding referencing a
 * shift missing from a plan that side of the bundle never emitted — while the agent's own
 * self-consistent artifacts pass.
 */
export type ArtifactField = {
  name: string;
  /** Description used while authoring, e.g. "array of {shiftId, crewId} bindings".
   *  Quoted because this is a Builder-authored JSON wire key that recorded briefs carry, not a
   *  symbol we may rename. */
  "shape": string;
  /** Scalar values accepted for this field, e.g. ["pass", "fail"]. Submission reports any other
   * value before verification. Omit this property when the field accepts open values. */
  allowedValues?: Array<string | number | boolean>;
  /** Open file map: safe relative POSIX paths to text contents; control filenames stay examples. */
  fileMap?: true;
  /** Dotted paths under this field whose objects are keyed by data, not by a fixed field list —
   * e.g. ["busAddresses"] for a {partId: busAddress} record under this root, or ["$"] for the
   * root itself. A declared path compiles open over keys and closed over its value shape; control
   * keys stay examples. Undeclared records keep their exact key sets. */
  openMapPaths?: string[];
};

export type DesignRuleConstant = {
  name: string;
  value: number | string;
  unit?: string;
  /** Who outside this build asserts the value (standard, datasheet, vendor doc). */
  authority: string;
  /** Where exactly — a citation a reviewer can follow. */
  citation: string;
};

/** A declared set of permitted values with an external citation, alongside DesignRuleConstant.
 *  Without it a kickoff naming a closed value set has nowhere to declare it, and no check can
 *  express which values are legal for each mode. */
export type DesignRuleSet = {
  name: string;
  values: Array<string | number>;
  unit?: string;
  authority: string;
  citation: string;
};

export type Brief = {
  correctnessContract: "check-program/v1";
  slug: string;
  domain: string;
  /** The coverage map: which task families the harness covers and deliberately leaves out.
   *  The solver and Judge cards do not receive it, so it cannot be the sole declaration of a
   *  correctness rule. Put rules in truthChecks, designRuleConstants, designRuleSets or a
   *  public ruleDecisions row where their consumers can read them. */
  decisions: string[];
  gates: string[];
  truthChecks: BriefTruthCheck[];
  /** Optional id-carrying decisions a truth check may cite (rule-decisions.ts). Public rows are
   *  projected to the solver and the Judge; private rows reach no surface and may not be cited. */
  ruleDecisions?: BriefRuleDecision[];
  joins: BriefJoin[];
  /** The one canonical top-level shape of the submitted artifact (see ArtifactField). */
  artifactSchema: ArtifactField[];
  designRuleConstants: DesignRuleConstant[];
  /** Optional declared sets of permitted values, published alongside design-rule constants. */
  designRuleSets?: DesignRuleSet[];
};

/** What a generated solve did instead of returning a result. The reference solve narrows to
 *  exactly these five plus a host kind of its own, so a member added here has to reach that
 *  narrowing rather than sit unread in the wider classification below. */
export type GeneratedSolveFailureKind =
  | "generated-solve-result"
  | "generated-solve-throw"
  | "generated-solve-crash"
  | "generated-solve-protocol"
  | "generated-solve-timeout";

/** The host's payload-free name for a withheld fact: what failed, never what it read. */
export type GeneratedExecutionClassification =
  | VerifierContractCode
  | "generated-bundleSnapshot-drift"
  | "generated-evaluate-result"
  | "generated-evaluate-throw"
  | "generated-correctness-model-load"
  | GeneratedSolveFailureKind
  | "generated-toolset-load"
  | "generated-toolset-contract"
  | "generated-correctness-model-pending"
  | "generated-correctness-model-relay"
  | "reference-solve-host"
  | "submission-path-host";

/**
 * Whose bytes produced a finding's text, which decides what an author prompt may carry (AGENTS.md
 * rules 4 and 7). The producer states it once; `projectFindingForAuthor` applies it.
 *
 * - `authored`: composed from Builder-authored bytes or the public authoring interface — compiler,
 *   typecheck and bundler diagnostics, host classifications, check ids, family names, control ids,
 *   mutation classes, counts and walls hit. Code, path and detail cross in full. `detail` is the
 *   public sentence when the evidence copy also carries protected text.
 * - `withheld`: derived from hidden expectations, verifier output, thrown evaluate messages,
 *   reference artifacts or per-task failure locations. The author reads the classification and,
 *   when the producer composed one from public identities, its `note`; path and detail stay on
 *   evidence.
 *
 * A finding with no disclosure fails closed to fixed labels.
 */
export type FindingDisclosure =
  | { class: "authored"; detail?: string }
  | { class: "withheld"; classification: GeneratedExecutionClassification; note?: string };

export type ContractFinding = {
  /** Stable code a repair prompt can key on. */
  code: string;
  path: string;
  /** Evidence text, recorded verbatim; an author prompt reads it only through the disclosure. */
  detail: string;
  disclosure?: FindingDisclosure;
  /** The public control or task id this row repeats for, quoted in `detail`. Author feedback folds
   *  rows that read the same apart from it into one repair; the producer states it, no reader guesses. */
  subject?: string;
};

type UndisclosedFinding = Omit<ContractFinding, "disclosure">;

const UNCLASSIFIED: ContractFinding = {
  code: "generated-execution-unclassified",
  path: "generated-execution",
  detail:
    "a check failed while executing your generated code and carries no public detail; use harness_inspect for static diagnostics, harness_trial for the generated solve path, or verifier_workshop for the correctnessModel path",
  disclosure: { class: "authored" },
};

/** The one author projection, applied at every model-visible boundary. Its result is itself an
 *  authored finding, so projecting twice changes nothing. */
/** The public sentence a classification carries when its label alone leaves the author guessing.
 *  A wall the candidate sets in its own `agent/config.yaml` is Builder-authored, so naming it
 *  crosses (AGENTS.md rule 7). STARTER.md's SOLVABILITY_CENSUS_BLOCKED clause owns the remedy,
 *  which this repeats because the label alone reached the author without it. */
const CLASSIFICATION_HINTS: Partial<Record<GeneratedExecutionClassification, string>> = {
  ...VERIFIER_CONTRACT_HINTS,
  "generated-solve-timeout":
    "The reference solve hit the gate.reference_solve_seconds wall this candidate's agent/config.yaml sets. Record the search's best artifact per task under reference/ so solve replays it inside the wall, or raise that wall and gate.census_minutes with it.",
};

export interface ValidationResult {
  ok: boolean;
  findings: ContractFinding[];
  /** Recorded beside an accepted result; never a reason to refuse. */
  advisories?: ContractFinding[];
}

/** Refuses a contract file its validator did not pass, naming every finding after `label`. */
export function throwIfInvalid(validation: ValidationResult, label: string): void {
  if (validation.ok) return;
  throw new Error(`${label}: ${validation.findings.map((row) => `${row.path}: ${row.detail}`).join("; ")}`);
}

/** Every required (check, tool) invocation, including tools executing authored semantics. `kind`
 * keeps the two apart: an interpreter running the candidate's own algorithm is authored evidence
 * however often the host attests it, and a reader of the coverage rows must be able to see which. */
export function externalChecksOf(
  brief: Brief,
): Array<{ checkId: string; adapterId: string; kind: "authored" | "external" }> {
  return brief.truthChecks.flatMap((check) =>
    requiredToolsOf(check.execution).map((adapterId) => ({
      checkId: check.id,
      adapterId,
      kind: check.execution.evidence.kind,
    })),
  );
}

/** A withheld fact: the author reads its classification alone. */
export function generatedExecutionFinding(
  undisclosed: UndisclosedFinding,
  classification: GeneratedExecutionClassification,
): ContractFinding {
  return { ...undisclosed, disclosure: { class: "withheld", classification } };
}

/** An authored fact: it crosses in full, or as `publicDetail` when the evidence detail says more. */
export function controllerValidatedFinding(
  undisclosed: UndisclosedFinding,
  publicDetail?: string,
): ContractFinding {
  const disclosure: FindingDisclosure = { class: "authored", ...keyIfDefined("detail", publicDetail) };
  return { ...undisclosed, disclosure };
}

/** Marks every finding a validator composed as authored, keeping a disclosure already stated. */
export function controllerValidatedFindings(findings: ContractFinding[]): ContractFinding[] {
  return findings.map((row) => (row.disclosure === undefined ? controllerValidatedFinding(row) : row));
}

export function projectFindingForAuthor(original: ContractFinding): ContractFinding {
  const { disclosure } = original;
  if (disclosure === undefined) return { ...UNCLASSIFIED };
  if (disclosure.class === "authored") {
    return {
      code: original.code,
      path: original.path,
      detail: disclosure.detail ?? original.detail,
      disclosure: { class: "authored" },
      ...keyIfDefined("subject", original.subject),
    };
  }
  const { classification, note } = disclosure;
  return {
    code: original.code,
    path: "generated-execution",
    detail:
      note === undefined
        ? (CLASSIFICATION_HINTS[classification] ?? classification)
        : `${classification}; ${note}`,
    disclosure: { class: "authored" },
  };
}

export function finding(code: string, path: string, detail: string): ContractFinding {
  return { code, path, detail };
}

/** A declared input, artifact or boundary path must be a rooted JSON path. */
export function jsonPathFinding(
  path: JsonValue | undefined,
  findingPath: string,
  owner: string,
): ContractFinding[] {
  return isString(path) && jsonPathTokens(path) !== null
    ? []
    : [
        finding(
          "brief-check-path-invalid",
          findingPath,
          `${owner} must be a rooted JSON path such as "$" or "$.field"`,
        ),
      ];
}

/** The record view of an unknown value. The caller's own binding stays unnarrowed, so a value whose
 *  fields were checked through the view can be typed in one assertion instead of an `unknown` chain. */
export function recordView(value: unknown): Record<string, JsonValue> | null {
  return isRecord(value) ? value : null;
}

// Gate audit 2026-09-25 (docs/gate-audit.md, bundle-shape): kept: a bundle file that does not parse into its
// declared shape cannot be read by anything downstream, so the refusal names the field instead of crashing a
// reader.
/** A shape finding that names what is wrong before what was expected, because the author reads a
 *  bounded detail and the tail is what gets cut. Leading with the expected shape spends that budget
 *  on a long schema and leaves "got object" as all that survives, which names neither the missing
 *  key nor the nesting level it went missing from. */
export function fieldFinding(
  path: string,
  expected: string,
  value: unknown,
  allowedKeys?: readonly string[],
): ContractFinding {
  const got = typeName(value);
  if (!isRecord(value)) return { code: "shape-mismatch", path, detail: `expected ${expected}, got ${got}` };
  const missing = [...expected.matchAll(/"([A-Za-z_]\w*)"\s*:/g)].flatMap(([, key]) =>
    key === undefined || key in value ? [] : [key],
  );
  const unexpected =
    allowedKeys === undefined ? [] : Object.keys(value).filter((key) => !allowedKeys.includes(key));
  const named = [
    ["unexpected", unexpected],
    ["missing", missing],
  ] as const;
  const problems = named
    .flatMap(([label, keys]) => (keys.length > 0 ? [`${label} ${keys.join(", ")}; `] : []))
    .join("");
  const keys = Object.keys(value).slice(0, 12).join(", ");
  return {
    code: "shape-mismatch",
    path,
    detail: `${problems}expected ${expected}, got an object with keys [${keys}]`,
  };
}
