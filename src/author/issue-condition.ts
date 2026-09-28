/**
 * The condition a battery measured one family under, which is what decides whether an issue's
 * absence from a later battery says anything about the issue.
 *
 * Absence is evidence of a fix only when the family was asked the same question again. Four things
 * have to hold for that. The family ran on the same public inputs, because a task probe that swaps
 * them removes the failing tasks rather than repairing anything. The scoring program is the same,
 * because identical inputs graded by a weaker evaluator also make a failure disappear. The tools
 * the checks ran are the same, because the scoring hash stops at evaluator.ts and its imports while
 * a check can hand the verdict to an installed analyser, and an analyser replaced underneath an
 * unchanged evaluator is a weaker evaluator all the same. And the Built model, its effort and the
 * host-imposed condition are the same, because a different model, effort or isolation answers a
 * different question about the same harness. When any of the four moved, the issue is unmeasured: the
 * register keeps it, the author is told it was not measured, and nothing ages it towards fixed.
 *
 * The check tools are compared by what the battery's verifier launched: each tool's own bytes, where
 * it was found, its interpreter's bytes and, for a workspace tool, the portable digest of the
 * `.toolchain` tree it was installed in. A workspace tool's own bytes are its portable digest too,
 * the file with the tree's own path taken out, because a reseed copies the tree into a new workspace
 * and rewrites every wrapper that names it without changing what the wrapper runs; the same tree in
 * another place therefore compares equal. The tree has to be in, because a wrapper commonly execs a
 * script beside it, and a script rewritten behind an unchanged wrapper is a changed checker that the
 * wrapper's own bytes cannot show. The record names no finer dependency than the whole tree, so the
 * price is paid the other way: a round that installed or repaired only a solver tool in that tree
 * leaves the issue unmeasured, which loses a measurement but never counts a changed checker's
 * silence towards a fix.
 *
 * Every value here is read from what the battery already recorded: the scoring hash from the
 * bundle snapshot the analysis names, each family's inputs from the battery's own digest-bound
 * `cases/<taskId>/public-task.json` projections, the check tools from its digest-bound
 * `battery.json`, and the measured condition from the analysis's identities.
 */
import { join } from "../meta/path.ts";
import { compareCodeUnits, hashJsonValue } from "../meta/stable-json.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { asRecord } from "../meta/json-shape.ts";
import type { IterationAnalysis } from "../analyse/iteration-analysis.ts";
import { type EvidenceLogViolation, recordedEvidence, verifyRunDir } from "../claim/evidence-log.ts";
import { BATTERY_FILE } from "../correctness-bundle/battery-record.ts";
import { recordedVerifierHash } from "../correctness-bundle/verifier-environment.ts";
import { publicBatteryFingerprint, recordedPublicTasks } from "../run/climb-history.ts";

/** Which part of the condition moved between the battery that observed an issue and a later one
 *  in which it was absent. */
const CONDITION_GAPS = ["public-inputs", "scoring", "check-tools", "built-condition"] as const;
export type ConditionGap = (typeof CONDITION_GAPS)[number];

/** The condition one battery measured one family under. */
export type IssueCondition = {
  /** sha256 over the family's sorted canonical public inputs in that battery; null when any of
   *  the family's recorded task projections could not be vouched for, which compares with
   *  nothing. */
  publicInputs: string | null;
  scoringHash: string;
  /** sha256 over the tools the battery's checks launched, each by its own digest, source,
   *  interpreter digest and tree digest; null when the battery record could not be vouched for,
   *  which compares with nothing. */
  checkTools: string | null;
  /** `measuredConditionDigest` of the battery. */
  measuredCondition: string;
};

/** One battery's condition, for every family it ran. */
export type BatteryCondition = {
  scoringHash: string;
  checkTools: string | null;
  measuredCondition: string;
  familyInputs: ReadonlyMap<string, string | null>;
};

/** The host-imposed condition a battery solved under, as one digest. The Built pin names the backend
 *  kind and the model, and on OpenRouter the providers, but no effort, so the reasoning effort the
 *  battery's case rows recorded goes in beside it; an effort they never recorded is unknown and is
 *  keyed to the battery itself, which matches no other. Isolation and the run condition name the
 *  walls and the tools removed. Every byte of the harness is left out, because that is what a fix is
 *  allowed to change, and that includes the solver walls agent/config.yaml declares: more turns for
 *  a family that kept timing out is a fix, not a different question. */
export function measuredConditionDigest(facts: {
  runId: string;
  builtPin: string;
  builtEffort: string | null;
  isolationStrength: string;
  runCondition: IterationAnalysis["battery"]["condition"];
}): string {
  return hashJsonValue({
    builtPin: facts.builtPin,
    builtEffort: facts.builtEffort ?? { unrecorded: facts.runId },
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
    "check-tools": was.checkTools === null || was.checkTools !== now.checkTools,
    "built-condition": was.measuredCondition !== now.measuredCondition,
  };
  return CONDITION_GAPS.filter((gap) => moved[gap]);
}

/** Each family's public-input digest, from the tasks of its case rows. A family any of whose
 *  projections is missing — a case the provider stopped before it started, or bytes that moved
 *  after recording — gets null rather than a digest over the tasks that happened to survive. */
function familyInputDigests(
  runDir: string,
  cases: IterationAnalysis["cases"],
  violations: EvidenceLogViolation[],
): Map<string, string | null> {
  const byFamily = new Map<string, string[]>();
  for (const row of cases) byFamily.set(row.family, [...(byFamily.get(row.family) ?? []), row.taskId]);
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

/** The tools the battery's verifier launched, from the `execution` summary its record carries. The
 *  summary is trusted only when the run's manifest vouches for the bytes, the record names this run
 *  and its tool map recomputes the environment hash beside it, which also means a workspace tool
 *  carries its tree and portable digests and a host tool carries neither. Each tool then counts by
 *  that portable digest or else its plain one, its source, its interpreter digest and its tree
 *  digest (see the module comment). A battery that launched no tool gets the digest of an empty list,
 *  which matches another such battery and nothing else. */
function checkToolsDigest(runDir: string, runId: string, violations: EvidenceLogViolation[]): string | null {
  const recorded = recordedEvidence(runDir, BATTERY_FILE, violations);
  if (!recorded.ok) return null;
  const record = asRecord(capturedJsonParse(recorded.bytes));
  const execution = record?.execution;
  const tools = asRecord(asRecord(execution)?.tools);
  if (record?.runId !== runId || tools === null || recordedVerifierHash(execution) === undefined) return null;
  return hashJsonValue(
    Object.entries(tools)
      .toSorted(([left], [right]) => compareCodeUnits(left, right))
      .map(([id, tool]) => {
        const entry = asRecord(tool);
        return [
          id,
          entry?.portableDigest ?? entry?.digest ?? null,
          entry?.source ?? null,
          entry?.interpreterDigest ?? null,
          entry?.treeDigest ?? null,
        ];
      }),
  );
}

/** The condition the analysed battery measured under, read from its recorded evidence and the
 *  measured tree it ran. */
export function batteryCondition(analysis: IterationAnalysis, measuredDir: string): BatteryCondition {
  const { identities, battery, runId } = analysis;
  const runDir = join(measuredDir, "runs", runId);
  const violations = verifyRunDir(runDir);
  return {
    scoringHash: identities.bundleSnapshot.scoringHash,
    checkTools: checkToolsDigest(runDir, runId, violations),
    measuredCondition: measuredConditionDigest({
      runId,
      builtPin: identities.backendPin,
      builtEffort: identities.builtEffort,
      isolationStrength: identities.isolationStrength,
      runCondition: battery.condition,
    }),
    familyInputs: familyInputDigests(runDir, analysis.cases, violations),
  };
}
