import { evaluateCheckProgram } from "../../vendor/correctness-model-bundle/evaluate.ts";
import { sha256 } from "../meta/digest.ts";
import { isRecord, type JsonValue } from "../meta/json-shape.ts";
import { compareCodeUnits, hashJsonValue } from "../meta/stable-json.ts";
import type { ToolInventory } from "../verify/verifier-port.ts";
import {
  type Brief,
  type ContractFinding,
  type GeneratedExecutionClassification,
  applicableTruthChecks,
  taskConditionedRoots,
} from "./brief.ts";
import type { CheckRunner } from "./correctness-model-contract.ts";
import { CENSUS_LANES, inLanes } from "./run-controls.ts";
import {
  type SolvabilityStageMemory,
  type SolvabilityStageReceipt,
  throughStage,
} from "./solvability-stages.ts";
import { type WitnessCensus, evaluateWitness } from "./solvability-witness.ts";
import { blockingFailedCheckIds, blockingTruthFailure } from "./verdict-binding.ts";
import { trustedJsonStringify, trustedStructuredClone } from "./trusted-runtime.ts";
import { EVALUATOR_FILE, TASKS_FILE } from "../meta/bundle-layout.ts";

/** One accepted reference artifact, kept for the family census below. */
export interface FamilyWitness {
  taskId: string;
  family: string;
  artifact: JsonValue;
}

interface HybridEvaluation {
  settled: boolean;
  passed: boolean;
  /** Blocking check ids from a settled evaluate; empty while unsettled. */
  failedCheckIds: string[];
  /** Why an evaluate returned no verdict, as the host classified the authored failure. */
  unsettledBy?: GeneratedExecutionClassification | null;
}

/** One donor's search through its family's other members, stopping at the first sibling that refuses it. */
interface DonorSearch {
  family: string;
  donor: FamilyWitness;
  members: readonly FamilyWitness[];
}

type DonorOutcome =
  | { kind: "separated" | "unseparated" | "skipped" }
  | { kind: "stop"; finding: ContractFinding };

type HybridEvaluator = (
  target: FamilyWitness,
  artifact: JsonValue,
  donor: FamilyWitness,
) => Promise<HybridEvaluation>;

/** Bump when the census's reading of a hybrid changes, so no earlier result answers the new rule. */
const FAMILY_BINDING_STAGE = "family-binding-stage/v1";

interface FamilyBindingStageInput {
  /** The candidate brief; the stage reads only its material checks and task-conditioned roots. */
  brief: Brief;
  /** Every task's accepted reference artifact, one per task. */
  witnesses: readonly FamilyWitness[];
  /** Canonical full-task bytes by task id: each hybrid is judged against its target's hidden expectations. */
  taskJson: ReadonlyMap<string, string>;
  /** The census condition; its brief and evaluate are narrowed to the material checks here. */
  census: WitnessCensus;
  evaluator: CheckRunner;
  /** Portable digest of the evaluator bundle `evaluator` runs. */
  evaluatorDigest: string;
  /** The resolved installed tools every hybrid evaluation may run. */
  inventory: ToolInventory;
  producedUnder: string;
  memory: SolvabilityStageMemory<ContractFinding[]> | undefined;
  stopped: () => boolean;
}

function rootValue(artifact: JsonValue, root: string): JsonValue {
  return isRecord(artifact) && Object.hasOwn(artifact, root) ? (artifact[root] ?? null) : null;
}

/** "$" reads every root; "$.root" reads it exactly when the next character ends the segment. */
function pathReadsRoot(path: string, root: string): boolean {
  if (path === "$") return true;
  const prefix = `$.${root}`;
  if (!path.startsWith(prefix)) return false;
  const next = path.charAt(prefix.length);
  return next === "" || next === "." || next === "[";
}

/** The checks whose declared artifact paths read a task-conditioned root. Only these can tell a
 *  transplanted deliverable apart: every other check receives the same projected bytes the target's
 *  accepted artifact gave it, so the census evaluates hybrids against these checks alone. */
function familyMaterialCheckIds(brief: Brief): Set<string> {
  const roots = taskConditionedRoots(brief);
  return new Set(
    brief.truthChecks
      .filter((check) =>
        check.execution.artifactPaths.some((path) => roots.some((root) => pathReadsRoot(path, root))),
      )
      .map((check) => check.id),
  );
}

async function searchDonor(
  { family, donor, members }: DonorSearch,
  roots: readonly string[],
  materialChecks: ReadonlySet<string>,
  evaluateHybrid: HybridEvaluator,
): Promise<DonorOutcome> {
  const named = roots.map((root) => `"${root}"`).join(", ");
  for (const target of members) {
    if (target.taskId === donor.taskId) continue;
    const verified = await evaluateHybrid(
      target,
      hybridArtifact(target.artifact, donor.artifact, roots),
      donor,
    );
    // Host outages throw before this point, so an unsettled evaluate is the correctness model's own
    // failure, and is reported as the author's rather than routed to the environment. Truss run
    // dffb11 read "did not settle … unknown" routed to the environment, with no hint that its
    // evaluator had thrown on a sibling's well-formed design.
    if (!verified.settled) {
      return {
        kind: "stop",
        finding: {
          code: "TASK_FAMILY_BINDING_UNPROVEN",
          path: EVALUATOR_FILE,
          detail: `family "${family}": the correctness model returned no verdict (${verified.unsettledBy ?? "generated-evaluate-result"}) for a sibling's accepted deliverable with its task-conditioned root(s) ${named} moved into another task of this family. Every check must return false rather than throw or leave a tool run pending when a well-formed artifact does not fit its task`,
          owner: "bh-correctness-model",
        },
      };
    }
    if (verified.passed) continue;
    if (verified.failedCheckIds.some((id) => materialChecks.has(id))) return { kind: "separated" };
    const blockers =
      verified.failedCheckIds.length === 0
        ? "the evaluate named no failing check"
        : `only ${verified.failedCheckIds.map((id) => `"${id}"`).join(", ")} failed, and none of those checks reads the marked root(s)`;
    return {
      kind: "stop",
      finding: {
        code: "TASK_FAMILY_BINDING_UNPROVEN",
        path: EVALUATOR_FILE,
        detail: `family "${family}": a sibling's deliverable was rejected, but ${blockers} — the task-conditioned root(s) ${named} were never refused by a check that reads them, so the rejection is no evidence that the deliverable itself separates the family`,
        owner: "bh-correctness-model",
      },
    };
  }
  return { kind: "unseparated" };
}

function universalWitness(family: string, members: number, roots: readonly string[]): ContractFinding {
  const named = roots.map((root) => `"${root}"`).join(", ");
  return {
    code: "TASK_FAMILY_UNIVERSAL_WITNESS",
    path: TASKS_FILE,
    detail: `family "${family}" has ${members} tasks, and one accepted deliverable satisfies every one of them: moving only the task-conditioned root(s) ${named} between siblings, with each target keeping its own report and supporting fields, leaves every sibling passing. Author tasks whose material deliverable must genuinely differ, or represent this family as one task with several scenarios`,
    owner: "task-curriculum",
  };
}

/** Each family with two or more tasks, sorted, and the donors that differ in their marked bytes.
 *  Sibling deliverables that serialise identically are already the same bytes, so the answer is
 *  known without verification: each target's accepted artifact is unchanged by the substitution. */
function familyDonors(witnesses: readonly FamilyWitness[], roots: readonly string[]) {
  const families = new Map<string, FamilyWitness[]>();
  for (const witness of witnesses) {
    families.set(witness.family, [...(families.get(witness.family) ?? []), witness]);
  }
  return [...families]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .flatMap(([family, members]) => {
      if (members.length < 2) return [];
      const slices = new Map<string, FamilyWitness>();
      for (const member of members) {
        const key = trustedJsonStringify(roots.map((root) => rootValue(member.artifact, root)));
        if (!slices.has(key)) slices.set(key, member);
      }
      return [{ family, members, donors: [...slices.values()] }];
    });
}

/**
 * Does one accepted deliverable answer a whole task family?
 *
 * W20 produced a family of nine tasks whose reports differed but whose module did not. B2 counts
 * tasks per family, B3 checks that a declared axis varies, and the control corpus checks that a
 * mutated artifact is rejected — none of them asks whether task 3's accepted deliverable also
 * satisfies task 7. F2 already holds the missing material: one accepted reference artifact per
 * task, and the ordinary verification path.
 *
 * The artifact schema's `taskConditioned` roots select the deliverable. A target keeps its
 * report and every other unmarked root byte-identical while the donor's marked roots replace its
 * own, so the hybrid differs from an artifact that has just passed in exactly those bytes and a
 * rejection can be attributed to those changed bytes. Check ids come from declarations that
 * include a marked root in their inputs. A rejection by one of these checks distinguishes the
 * tested artifacts; it does not prove semantic dependence on every declared field.
 *
 * Two shortcuts avoid evaluations that cannot add evidence. Sibling deliverables that
 * serialise identically need no evaluation: substituting equal bytes leaves an already passing
 * artifact unchanged — and the family stops at its first donor that no sibling rejects. The W20
 * family therefore needs zero extra evaluations rather than seventy-two.
 *
 * Donor searches are independent, so they run in the census lanes and settle in family and donor
 * order, which is what makes four lanes and one lane return the same findings. A clear 25-task
 * truss census ran its transplants one after another once the reference solves had used four
 * lanes.
 *
 * Two limits, stated rather than implied. This disproves uniformity for the witnesses it has; it
 * does not prove that no universal artifact exists anywhere in the solution space. And a rejection
 * shows that the target's own deliverable is not interchangeable, which a rule tying the report to
 * the deliverable would also produce: such a family clears here while its tasks may still be one
 * task written several ways.
 */
export async function familyBindingFindings(
  brief: Brief,
  witnesses: readonly FamilyWitness[],
  evaluateHybrid: HybridEvaluator,
  { lanes = CENSUS_LANES, stopped = () => false }: { lanes?: number; stopped?: () => boolean } = {},
): Promise<ContractFinding[]> {
  const roots = taskConditionedRoots(brief);
  if (roots.length === 0) return [];
  // A rejection separates the family only when a check that reads a transplanted root refused it.
  // The host records the check id. Declared path coverage narrows the applicable claim; it does
  // not prove that arbitrary code semantically used every declared field.
  const materialChecks = familyMaterialCheckIds(brief);
  const families = familyDonors(witnesses, roots);
  const searches = families.flatMap(({ family, members, donors }) =>
    donors.length < 2 ? [] : donors.map((donor) => ({ family, donor, members })),
  );
  // A stop ends the census and a universal donor ends its family; later searches need not start.
  let halted = false;
  const universal = new Set<string>();
  const outcomes = await inLanes(
    searches,
    lanes,
    async (search): Promise<DonorOutcome> => {
      if (universal.has(search.family)) return { kind: "skipped" };
      const outcome = await searchDonor(search, roots, materialChecks, evaluateHybrid);
      if (outcome.kind === "stop") halted = true;
      if (outcome.kind === "unseparated") universal.add(search.family);
      return outcome;
    },
    () => halted || stopped(),
  );
  const findings: ContractFinding[] = [];
  let next = 0;
  for (const { family, members, donors } of families) {
    if (donors.length < 2) {
      findings.push(universalWitness(family, members.length, roots));
      continue;
    }
    const settled = outcomes.slice(next, (next += donors.length));
    for (const outcome of settled) {
      if (outcome === undefined) return findings;
      if (outcome.kind === "stop") return [...findings, outcome.finding];
      if (outcome.kind !== "unseparated") continue;
      findings.push(universalWitness(family, members.length, roots));
      break;
    }
  }
  return findings;
}

/** The target's artifact with the donor's marked roots in place of its own. `defineProperty` on
 *  purpose: a Builder-authored root name such as `__proto__` must become an own property of the
 *  artifact instead of reaching a prototype. */
function hybridArtifact(target: JsonValue, donor: JsonValue, roots: readonly string[]): JsonValue {
  const hybrid = trustedStructuredClone(target);
  if (!isRecord(hybrid)) return hybrid;
  for (const root of roots) {
    Object.defineProperty(hybrid, root, {
      value: rootValue(donor, root),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return hybrid;
}

/** The brief a hybrid is evaluated under: a hybrid runs only the checks that read a moved root,
 *  because the others receive the projected bytes the target's accepted witness gave them and have
 *  already passed on exactly those. Truss census 0aad0d ran them all. */
function materialBrief(brief: Brief): Brief {
  const materialIds = familyMaterialCheckIds(brief);
  return { ...brief, truthChecks: brief.truthChecks.filter((check) => materialIds.has(check.id)) };
}

/** The transplant census key: the evaluator bundle, the material brief, every witness artifact with
 *  its target's full task bytes, and the installed tools by id, path, source and byte digest. */
function familyBindingStageKey(
  input: Pick<FamilyBindingStageInput, "brief" | "witnesses" | "taskJson" | "evaluatorDigest" | "inventory">,
): string {
  return hashJsonValue({
    stage: FAMILY_BINDING_STAGE,
    evaluator: input.evaluatorDigest,
    brief: materialBrief(input.brief),
    witnesses: [...input.witnesses]
      .sort((a, b) => compareCodeUnits(a.taskId, b.taskId))
      .map((witness) => ({
        taskId: witness.taskId,
        family: witness.family,
        task: sha256(input.taskJson.get(witness.taskId) ?? ""),
        artifact: hashJsonValue(witness.artifact),
      })),
    tools: Object.values(input.inventory)
      .sort((a, b) => compareCodeUnits(a.id, b.id))
      .map((tool) => ({
        id: tool.id,
        path: tool.path,
        source: tool.source,
        digest: tool.digest,
        kind: tool.kind,
        interpreter: tool.interpreter,
        interpreterDigest: tool.interpreterDigest ?? null,
      })),
  });
}

/** Run the transplant census, or reuse the findings recorded under the same key. A census the wall
 *  cut is not settled; a host non-result or cleanup stop throws, and neither is remembered. */
export async function familyBindingStage(
  input: FamilyBindingStageInput,
): Promise<{ findings: ContractFinding[]; receipt: SolvabilityStageReceipt }> {
  const brief = materialBrief(input.brief);
  const census: WitnessCensus = {
    ...input.census,
    brief,
    evaluate: evaluateCheckProgram(brief, input.evaluator),
  };
  const { value, receipt } = await throughStage(
    input.memory,
    familyBindingStageKey(input),
    input.producedUnder,
    async () => {
      const findings = await familyBindingFindings(
        input.brief,
        input.witnesses,
        async (target, artifact, donor) => {
          if (applicableTruthChecks(brief, target).length === 0) {
            return { settled: true, passed: true, failedCheckIds: [] };
          }
          const targetJson = input.taskJson.get(target.taskId);
          // Witnesses and canonical bytes are written in the same loop, so a target with no bytes is a
          // controller defect. Refuse rather than verify a hybrid without its task.
          if (targetJson === undefined) throw new Error(`no canonical task bytes for ${target.taskId}`);
          // One subject per donor and target: the grounding lookup keys on the subject, so two donors
          // transplanted into one target under a shared id let the first donor's tool run cover a
          // second evaluate that ran no tool.
          const verified = await evaluateWitness(
            census,
            targetJson,
            trustedJsonStringify(artifact),
            `family:${donor.taskId}>${target.taskId}`,
          );
          const { result } = verified;
          const settled = result !== null && verified.error === null;
          return {
            settled,
            passed: settled && result.ok === true && !blockingTruthFailure(result),
            failedCheckIds: settled ? [...blockingFailedCheckIds(result)].sort() : [],
            unsettledBy: settled ? null : verified.authorClassification,
          };
        },
        { stopped: input.stopped },
      );
      return { value: findings, settled: !input.stopped() };
    },
  );
  return { findings: value, receipt };
}
