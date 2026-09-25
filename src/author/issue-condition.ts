/**
 * The condition a battery measured one family under, which is what decides whether an issue's
 * absence from a later battery says anything about the issue.
 *
 * Absence is evidence of a fix only when the family was asked the same question again. Three things
 * have to hold for that. The family ran on the same public inputs, because a task probe that swaps
 * them removes the failing tasks rather than repairing anything. The scoring program is the same,
 * because identical inputs graded by a weaker evaluator also make a failure disappear. And the
 * Built model and the host-imposed condition are the same, because a different model or different
 * isolation answers a different question about the same harness. When any of the three moved, the issue is
 * unmeasured: the register keeps it, the author is told it was not measured, and nothing ages it
 * towards fixed.
 *
 * Every value here is read from what the battery already recorded: the scoring hash from the
 * bundle snapshot the analysis names, each family's inputs from the battery's own digest-bound
 * `cases/<taskId>/public-task.json` projections, and the measured condition from the analysis's
 * identities.
 */
import { join } from "../meta/path.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import type { IterationAnalysis } from "../analyse/iteration-analysis.ts";
import { verifyRunDir } from "../claim/evidence-log.ts";
import { publicBatteryFingerprint, recordedPublicTasks } from "../run/climb-history.ts";

/** Which part of the condition moved between the battery that observed an issue and a later one
 *  in which it was absent. */
const CONDITION_GAPS = ["public-inputs", "scoring", "built-condition"] as const;
export type ConditionGap = (typeof CONDITION_GAPS)[number];

/** The condition one battery measured one family under. */
export type IssueCondition = {
  /** sha256 over the family's sorted canonical public inputs in that battery; null when any of
   *  the family's recorded task projections could not be vouched for, which compares with
   *  nothing. */
  publicInputs: string | null;
  scoringHash: string;
  /** `measuredConditionDigest` of the battery. */
  measuredCondition: string;
};

/** One battery's condition, for every family it ran. */
export type BatteryCondition = {
  scoringHash: string;
  measuredCondition: string;
  familyInputs: ReadonlyMap<string, string | null>;
};

/** The host-imposed condition a battery solved under, as one digest. The Built pin names the
 *  model, its provider and its effort; isolation and the run condition name the walls and the tools
 *  removed. Every byte of the harness is left out, because that is what a fix is allowed to change,
 *  and that includes the solver walls agent/config.yaml declares: more turns for a family that kept
 *  timing out is a fix, not a different question. */
export function measuredConditionDigest(facts: {
  builtPin: string;
  isolationStrength: string;
  runCondition: IterationAnalysis["battery"]["condition"];
}): string {
  return hashJsonValue({
    builtPin: facts.builtPin,
    isolationStrength: facts.isolationStrength,
    runCondition: {
      variant: facts.runCondition.variant,
      advisorsRemoved: facts.runCondition.advisorsRemoved,
    },
  });
}

/** What moved between two conditions, in `CONDITION_GAPS` order; empty when they are comparable. */
export function conditionGaps(was: IssueCondition, now: IssueCondition): ConditionGap[] {
  const moved: Record<ConditionGap, boolean> = {
    "public-inputs": was.publicInputs === null || was.publicInputs !== now.publicInputs,
    scoring: was.scoringHash !== now.scoringHash,
    "built-condition": was.measuredCondition !== now.measuredCondition,
  };
  return CONDITION_GAPS.filter((gap) => moved[gap]);
}

/** Each family's public-input digest, from the tasks of its case rows. A family any of whose
 *  projections is missing — a case the provider stopped before it started, or bytes that moved
 *  after recording — gets null rather than a digest over the tasks that happened to survive. */
function familyInputDigests(runDir: string, cases: IterationAnalysis["cases"]): Map<string, string | null> {
  const byFamily = new Map<string, string[]>();
  for (const row of cases) byFamily.set(row.family, [...(byFamily.get(row.family) ?? []), row.taskId]);
  const violations = verifyRunDir(runDir);
  const digests = new Map<string, string | null>();
  for (const [family, ids] of byFamily) {
    const projection = recordedPublicTasks(runDir, ids, violations);
    const tasks =
      "tasks" in projection
        ? projection.tasks.filter(
            (task): task is { publicInput: unknown } => task instanceof Object && "publicInput" in task,
          )
        : [];
    digests.set(family, tasks.length === ids.length ? publicBatteryFingerprint(tasks) : null);
  }
  return digests;
}

/** The condition the analysed battery measured under, read from its recorded evidence and the
 *  measured tree it ran. */
export function batteryCondition(analysis: IterationAnalysis, measuredDir: string): BatteryCondition {
  const { identities, battery } = analysis;
  return {
    scoringHash: identities.bundleSnapshot.scoringHash,
    measuredCondition: measuredConditionDigest({
      builtPin: identities.backendPin,
      isolationStrength: identities.isolationStrength,
      runCondition: battery.condition,
    }),
    familyInputs: familyInputDigests(join(measuredDir, "runs", analysis.runId), analysis.cases),
  };
}
