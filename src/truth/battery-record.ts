/**
 * Records for one battery run: the contents of `battery.json` and each `case-result.json`.
 * The runner writes these types; the claim gate and analysis readers consume them. Keeping the
 * definitions together gives writers and readers one vocabulary for the recorded evidence.
 */
import { NEVER_ATTEMPTED_PREFIX } from "./battery-provider-stop.ts";
import { recordedEvidence } from "../claim/evidence-log.ts";
import { isString } from "../meta/json-shape.ts";
import { dirname, join } from "../meta/path.ts";
import { parseJsonAs, capturedJsonStringify, capturedJsonParse } from "../meta/json-runtime.ts";
import type { ExperimentAuthoring } from "../run/experiment-freeze.ts";
import type { MeasuredDifficulty } from "../claim/battery-difficulty.ts";
import type { EstimationEvidence } from "../claim/battery-facts.ts";
import type { CaseVerdict, RunCondition } from "../claim/case-record.ts";
import type { TruthCheckFiringEvidence } from "../claim/claim-evidence.ts";
import type { RuntimeModelIdentity } from "../claim/runtime-model-identity.ts";
import type { DiscriminationClaimabilityFinding } from "../claim/discrimination-claimability.ts";
import type { JudgeEvidence } from "../claim/judge.ts";
import { type NonResultKind, PROVIDER_STOPPED_REASON_PREFIX } from "../claim/record-events.ts";
import type { BundleSnapshot } from "../claim/bundle-snapshot.ts";
import type { VerifierExecutionEvidence as HostVerifierExecutionEvidence } from "../verify/verifier-port.ts";
import type { VerifierExecutionEvidence } from "./grounding.ts";
import type { SolverNonResult } from "./solve.ts";

export type CaseRecord = CaseVerdict & {
  taskId: string;
  family: string;
  /** Solver telemetry, kept so that a failure can be explained afterwards. Scoring does not read
   *  it, which is exactly why it has to be recorded here: the solver's errors are otherwise handed
   *  to the classifier and then discarded, leaving the spawned-CLI transcripts as the only durable
   *  trace of why a battery scored what it did. */
  solver: {
    turns: number;
    /** Provider results completed; the runtime-identity census denominator. */
    completedTurns: number;
    toolCalls: number | null;
    /** Tool starts count as attempts even without completion. */
    startedToolCalls: number | null;
    errors: string[];
    nonResult: SolverNonResult | null;
    /** Per-completed-turn provider identities; empty when the backend exposes none. */
    runtimeIdentities: RuntimeModelIdentity[];
    /** Controller timestamps around the solver call. */
    startedAt: string;
    endedAt: string;
  };
};

export type ControlReceiptOutcome = "pass" | "fail" | "non-result";

/** One result from a hidden with/without pair. It does not copy the hidden expectation or private
 * correctness-model detail. */
export type ControlReceiptSide = {
  attempt: number;
  outcome: ControlReceiptOutcome;
  blockingCheckIds: string[];
  nonResultKind: NonResultKind | null;
};

/** The controller's saved result for one accept or reject control. A receipt is present even when
 * the control could not be checked, so every declared control remains in the count. */
export type ControlReceipt = {
  schema: "control-receipt/v2";
  controlId: string;
  taskId: string;
  kind: "accept" | "reject";
  expectedOutcome: "pass" | "fail";
  expectedCheckId: string | null;
  observedOutcome: ControlReceiptOutcome;
  observedBlockingCheckIds: string[];
  nonResultKind: NonResultKind | null;
};

/** The battery evidence file and the two per-case files a reader opens beside it, named once for
 *  the writers, the joiner and every reader. */
export const BATTERY_FILE = "battery.json";
export const CASE_ARTIFACT_FILE = "artifact.json";
export const CASE_JUDGE_FILE = "judge.json";

export type DiscriminationExecution = {
  accepts: number;
  rejects: number;
  acceptsPassed: number;
  rejectsFailed: number;
  /** Rejects that failed their declared `expectedCheckId`, so the intended check caused the
   *  failure rather than an unrelated schema or empty-input check. */
  rejectsAttributed: number;
  /** The same counts by checkId, used by the claim gate to establish reject coverage for each
   *  declared check. A nonzero total can hide a check with no attributed rejects. These counts
   *  establish control outcomes; they do not prove that an external tool executed. */
  attributedCheckIds: Record<string, number>;
  /** One saved receipt for every declared accept and reject, in corpus order. `runControls`
   * calculates the older summary fields above from this list. */
  controlReceipts: ControlReceipt[];
  claimable: boolean;
  findings: DiscriminationClaimabilityFinding[];
};

export type BatteryDisposition = (typeof BATTERY_DISPOSITIONS)[number];

/** The case fields the terminal sentence reads; an unknown tool-call count reads as no call. */
type TerminalReasonCase = {
  runtimeNonResult: string | null;
  solver: { startedToolCalls: number | null };
};

/** The battery evidence `runFalsifier` reads back from disk — rows for the holdout, measured difficulty. */
export type BatteryRecord = {
  runId: string;
  slug: string;
  backendPin: string;
  thresholdManifestDigest: string;
  buildInputsHash: string;
  /** Terminal state projected into Claim.create. Recorded here so the write does not restate it. */
  terminalReason: string;
  /** What actually happened to this battery, as a closed value rather than free text or something
   *  a reader infers from the row count. Free text lets a battery the provider-stop rule cut short
   *  after a handful of cases record as "complete" and then be paired against one that ran its
   *  whole task set; a closed disposition makes that comparison impossible. */
  disposition: BatteryDisposition;
  /** Built-agent capability disclosure used by the claim. */
  capabilities: string[];
  /** The run condition recorded with the battery; the claim restates it and every case row
   *  repeats it. */
  condition: RunCondition;
  cases: CaseRecord[];
  measured: MeasuredDifficulty;
  experimentAuthoring?: ExperimentAuthoring;
  discrimination: DiscriminationExecution;
  /** The immutable snapshot from which this battery imported its bundles. Its id is a
   *  content address checked against the fingerprint when loaded. The record allows readers to
   *  verify which bytes executed without inferring their identity from directory names. */
  bundleSnapshot: BundleSnapshotFact;
  /** Host-created verifier execution evidence for this run. The recorded
   *  (phase, subjectId, attempt, checkId, adapterId) rows establish external tool coverage for each
   *  verified case and supply externalCheckCoverage. The environment hash enters both the claim
   *  and campaign ComparisonIdentity, so a tool change prevents a like-for-like comparison. */
  execution: VerifierExecutionEvidence;
  /** Every invocation evidence (verdicts and non-results) — request/result digests, outcome,
   *  host-derived command digest. The durable form of "the tool ran, on these bytes". */
  executionEvidence: HostVerifierExecutionEvidence[];
  /** Execution counts for each declared authored check over verifier-verified cases. The claim
   *  gate reads these counts to detect a check that never ran at all, which no per-case verdict
   *  discloses. Recording them with the battery rather than deriving them at claim time preserves
   *  the evidence in the evidence log, so a later reader inspects the same counts the gate read. */
  truthCheckFiring: TruthCheckFiringEvidence;
  /** The battery's estimation evidence: scored counts, raw rate, Wilson interval at the registered
   *  confidence, and excluded outcomes by kind. Saved with the battery so a later reader can inspect
   *  the estimate together with the denominator it was computed over, instead of recomputing one
   *  from rows and hoping it matches. */
  estimation: EstimationEvidence;
  /** Full-census independent judge aggregate, or the explicit off disclosure. */
  judge: JudgeEvidence;
  /** The maximum number of concurrent solves in this battery. Concurrency affects contention and
   *  non-result rates, so three simultaneous solves and one-at-a-time solves are different measured
   *  conditions; the case rows alone never disclose which limit was configured. */
  solveExecution: { maxConcurrency: number; scheduling: "bounded-worker-pool" };
};

/** Saved snapshot identity, without the absolute directory that only applies on this machine. */
export type BundleSnapshotFact = {
  id: string;
  agentHash: string;
  correctnessModelHash: string;
  scoringHash: string;
  taskSetHash: string | null;
};

/** The slice of one recorded battery.json the controller's battery join reads: its closed
 *  disposition and its case count. */
type BatteryJoinSlice = { disposition: BatteryDisposition; caseCount: number };

/** The controller-owned submit attempt budget (Gate 0.1/0.4): the evaluator constructs one
 *  authority per case with this hard budget; generated code receives only the port. */
export const SUBMIT_MAX_ATTEMPTS = 3;
/**
 * Thrown when every battery case is an environment-owned non-result: zero cases were verified and
 * every kind belongs to ENVIRONMENT_OWNED_NONRESULT_KINDS. The battery produced operational
 * evidence but no capability measurement. This class represents the whole battery, unlike
 * VerifierExecutionNonResult, which represents one execution. It contains all the case kinds and
 * is raised after their evidence has been recorded, beyond the census gate's responsibility. It
 * exists because this state previously reached Claim.create and became a product non-claim with an
 * empty denominator even when the provider was the thing that was unavailable, which read as a
 * harness that could not solve anything. The battery and case records are already on disk when this
 * throws, ready for review before a later rerun. A battery with any verified case, or a kind
 * outside the environment-owned list such as verifier-throw, follows the ordinary claim path and
 * retains that path's findings.
 */
export class BatteryVerificationNonResult extends Error {
  constructor(
    readonly runId: string,
    readonly kinds: readonly NonResultKind[],
  ) {
    super(
      `battery "${runId}" verified zero cases: all ${kinds.length} attempted case(s) were environment-owned non-results (${[...new Set(kinds)].sort().join(", ")}) — a runtime/environment non-result, not a product non-claim`,
    );
    this.name = "BatteryVerificationNonResult";
  }
}

/**
 * How a battery ended. Three values, because three are producible: a battery refused before any
 * case was scheduled, one the provider-stop rule cut short, and one that ran its whole task set.
 * A battery the controller aborts never reaches a final record, so no "aborted" value is created here —
 * the controller terminal owns that, and a value nothing can produce would only read as absent.
 */
export const BATTERY_DISPOSITIONS = ["skipped-precase", "provider-stopped", "completed"] as const;
/**
 * Derived at the one record assembler. `plan` is declared by the caller because "no rows" cannot
 * distinguish a refused battery from an empty one. The unattempted count is read from the rows,
 * which carry the fact themselves.
 */
export function batteryDisposition(
  plan: "scheduled" | "skipped",
  cases: readonly { runtimeNonResult: string | null }[],
): BatteryDisposition {
  if (plan === "skipped") return "skipped-precase";
  const neverAttempted = cases.filter(
    (row) => row.runtimeNonResult?.startsWith(NEVER_ATTEMPTED_PREFIX) === true,
  );
  return neverAttempted.length > 0 ? "provider-stopped" : "completed";
}

/**
 * The human sentence recorded beside the disposition. "complete" is truthful only where the battery
 * ran its whole task set, so a provider-stopped one says how much of it did not run, and a
 * completed one names the three degenerate shapes that would otherwise record as plain success:
 * every case a typed non-result; no case row at all, which leaves every later reader answering from
 * an empty set; and no case that started a single tool call, where the Built solver most likely
 * never launched. Before this, those three appeared only in diagnostic safeguard lines that no
 * evidence reader opens.
 */
export function batteryTerminalReason(
  disposition: BatteryDisposition,
  cases: readonly TerminalReasonCase[],
): string {
  if (disposition === "skipped-precase") return "battery skipped: discrimination not claimable";
  if (disposition === "completed") {
    if (cases.length === 0) return "no-cases: the battery recorded no case row";
    if (cases.every((row) => row.runtimeNonResult !== null)) {
      return `all-non-results: none of the ${String(cases.length)} cases produced a result`;
    }
    if (cases.every((row) => (row.solver.startedToolCalls ?? 0) === 0)) {
      return `no-tool-calls: none of the ${String(cases.length)} cases started a tool call`;
    }
    return "complete";
  }
  const never = cases.filter(
    (row) => row.runtimeNonResult?.startsWith(NEVER_ATTEMPTED_PREFIX) === true,
  ).length;
  return `${PROVIDER_STOPPED_REASON_PREFIX} ${String(never)} of ${String(cases.length)} cases were never attempted`;
}

export function bundleSnapshotFact(bundleSnapshot: BundleSnapshot): BundleSnapshotFact {
  return {
    id: bundleSnapshot.id,
    agentHash: bundleSnapshot.agentHash,
    correctnessModelHash: bundleSnapshot.correctnessModelHash,
    scoringHash: bundleSnapshot.scoringHash,
    taskSetHash: bundleSnapshot.taskSetHash,
  };
}

export function batteryPath(slugDir: string, runId: string): string {
  return join(slugDir, "runs", runId, BATTERY_FILE);
}

/** Parse a battery only from the bytes attested by its run manifest. The run-id check prevents a
 *  valid recorded directory from being relabelled as another measurement. Callers validate any
 *  narrower field set they consume. */
export function readRecordedBatteryRecord(runDir: string, runId: string): BatteryRecord {
  const recorded = recordedEvidence(runDir, BATTERY_FILE);
  if (!recorded.ok) throw new Error(`${runDir}: ${recorded.refusal}`);
  const parsed = parseJsonAs<Partial<BatteryRecord>>(recorded.bytes);
  const path = join(runDir, BATTERY_FILE);
  if (parsed.runId !== runId || !Array.isArray(parsed.cases)) {
    throw new Error(
      `${path}: battery evidence does not bind runId ${capturedJsonStringify(runId)} and case rows`,
    );
  }
  return /* SAFETY: the check above returned unless the parsed battery binds the expected run and carries case rows. Narrow consumers validate the fields they need. */ parsed as BatteryRecord;
}

export function readBatteryJoinSlice(path: string): BatteryJoinSlice {
  // The recorded bytes are the only bytes: a battery.json the run manifest does not name, or whose
  // bytes moved after recording, is damaged evidence and never falls back to the mutable file.
  const recorded = recordedEvidence(dirname(path), BATTERY_FILE);
  if (!recorded.ok) throw new Error(`${path}: ${recorded.refusal}`);
  const parsed: unknown = capturedJsonParse(recorded.bytes);
  const record =
    /* SAFETY: every field of the declared partial is optional, and the checks below throw unless the two this reader uses have the right kind. */ parsed as Partial<{
      disposition: unknown;
      cases: unknown;
    }>;
  if (!Array.isArray(record?.cases)) throw new Error(`${path}: battery record is missing its case list`);
  const value = record.disposition;
  const disposition = isString(value) ? BATTERY_DISPOSITIONS.find((known) => known === value) : undefined;
  if (disposition === undefined) throw new Error(`${path}: battery disposition is not a known value`);
  return { disposition, caseCount: record.cases.length };
}
