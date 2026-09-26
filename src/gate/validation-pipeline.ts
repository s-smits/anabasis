/**
 * The one validation sequence `correctness_check` previews and `submit` settles, on one captured
 * candidate snapshot, which is design prior 8: validation, conformance, the census and F2 all read
 * the same frozen bytes.
 *
 *   bundle      the file contract and installed-tool resolution (checkCandidate)
 *   validation  experiment admission against the adopted product (experiment-admission.ts)
 *   conformance generated-tool load and the conformance probe on every task
 *   gates       the control census and, beside it, the F2 reference solve (census-gate.ts)
 *
 * Every stage that can run on the snapshot runs, and each reports all of its findings. Only a stage
 * that yields nothing for the next to read stops the sequence: a bundle refusal leaves no validated
 * contracts, a thrown stage or a runtime non-result says nothing about the bytes, and a candidate
 * whose generated tools failed still gets its control census but no F2, which needs those tools.
 * Ending the call at the first refusing stage instead means a Builder repairs one stage per check
 * and pays for the whole sequence again to reach the next one, spending a check per stage on a
 * single tree.
 *
 * Memory, per session. A gate run is shared by preview and submit for the same candidate, tool
 * condition and scope, in either call order; a host refusal is forgotten, so a recovered host may
 * judge the same bytes rather than inheriting its predecessor's verdict. A preview remembers its
 * executed stages per condition, a call in flight included, so unchanged bytes never buy a verdict
 * twice; a run that ended blocked or in a runtime non-result is forgotten and runs again. Admission is
 * recomputed on every call because it reads EXPERIMENT.json, which the condition key leaves out on
 * purpose: a revised proposal is a new question about bytes that did not change. Submit keeps its
 * own snapshot load and reuses only the shared gate run, so a preview starting while submit runs
 * joins submit's stages instead of loading the generated tools a second time. Every executed gate
 * run writes into its own new directory, so a run another call reuses still holds exactly the
 * evidence it produced.
 */
import { type AgentToolsProbes, attestToolConformance } from "../author/agent-tools-session.ts";
import type { BuiltHarness, CampaignFeedback } from "../author/campaign-types.ts";
import {
  type CandidateCheckContext,
  type CandidateSnapshot,
  checkCandidate,
  conditionKey,
} from "../author/candidate-check.ts";
import { type AuthorCheckStage, gateFeedbackFindings } from "../builder/author-feedback.ts";
import { toolsSpecHashOf } from "../claim/conformance-evidence.ts";
import { existsSync, mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { GateScope } from "../run/census-gate.ts";
import type { ExperimentOperation } from "../run/experiment-freeze.ts";
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { ContractFinding } from "../correctness-bundle/brief.ts";
import {
  type SolvabilityStageCache,
  createSolvabilityStageCache,
} from "../correctness-bundle/solvability-stages.ts";
import { type AdmissionInput, admissionFindings, experimentOperation } from "./experiment-admission.ts";

/** The codes of a run that did not finish in time: a check's tool run, or the whole census wall. */
const TIMEOUT_CODES = new Set(["tool-timeout", "census-wall-exceeded"]);

/** `stages` is the session's F2 stage memory: settled stage results keyed by the bytes each read. */
export type Gate = (
  harness: BuiltHarness,
  iterationDir: string,
  workspace: string,
  stages?: SolvabilityStageCache,
  scope?: GateScope,
) => Promise<CampaignFeedback[]>;

export interface PipelineInput extends AdmissionInput {
  /** The probe pack the harness loads with: generated-module typecheck and conformance. */
  toolsProbes(candidateDir: string): AgentToolsProbes;
}

interface StageReceipt {
  stage: AuthorCheckStage;
  status: "passed" | "refused" | "blocked" | "not-run";
  /** `reused` names a gate run another call on the same condition already paid for. */
  source: "executed" | "reused";
  ms: number;
}

export interface GateRun {
  trialDir: string;
  feedback: CampaignFeedback[];
  /** The executable verifier condition these rows were measured under; null when the candidate
   *  declares no installed verifier tool to identify beside the snapshot. */
  conditionDigest: string | null;
  scope: GateScope;
}

/** What the executed stages found on one condition: the part a preview may remember. */
interface ExecutedStages {
  conformance: ContractFinding[];
  /** The harness the gates read, loaded from the snapshot even when conformance refused it. */
  harness: BuiltHarness | null;
  gated: GateRun | null;
  blocked: { stage: AuthorCheckStage; cause: unknown } | null;
  /** A generated-runtime worker that did not settle: an environment fact, not a verdict on bytes. */
  runtimeNonResult: boolean;
  receipts: StageReceipt[];
}

export interface GateReport extends ExecutedStages {
  snapshotId: string | null;
  /** `conditionKey` of the candidate: its bytes and its installed tool tree together. Receipts carry
   *  it because the same snapshot over a repaired tool tree is a different condition. */
  conditionId?: string;
  /** Author-projected blocking findings of every stage that refused, in stage order. */
  refusals: Array<{ stage: AuthorCheckStage; findings: ContractFinding[] }>;
  experiment?: ExperimentOperation;
  /** The executed stages are a remembered result for unchanged bytes; nothing ran again. */
  repeated?: true;
}

interface ValidationMemory {
  /** Gate runs by condition and scope, shared by preview and submit. */
  gates: Map<string, Promise<GateRun>>;
  /** Executed stages a preview remembers per condition, in flight included, so a second call on
   *  the same bytes joins the first instead of spending nothing on a refusal. */
  previews: Map<string, Promise<ExecutedStages>>;
  /** Gate runs a preview returned as a complete clear report, by condition. */
  clear: Map<string, GateRun>;
  stages: SolvabilityStageCache;
}

/** What a shared gate run reuses across candidates: the gate implementations themselves and the
 *  memory that decides whether this scope has already been settled for these bytes. */
type SharedGateDeps = {
  readonly gates: Gate;
  readonly memory: ValidationMemory;
};

interface ExecuteDeps {
  gates: Gate;
  memory: ValidationMemory;
  /** A new directory for one executed gate run's host evidence, given whether conformance and
   *  admission passed and the run's scope label. */
  runDir(clean: boolean, label: string): string;
}

interface PreviewDeps {
  input: PipelineInput;
  gates: Gate;
  /** `<dir>/<conditionKey>/` records the host evidence of each trial beside the iterations. */
  trialsDir: string;
  memory: ValidationMemory;
}

export function createValidationMemory(): ValidationMemory {
  return {
    gates: new Map(),
    previews: new Map(),
    clear: new Map(),
    stages: createSolvabilityStageCache(),
  };
}

const blockingOf = (feedback: readonly CampaignFeedback[]) =>
  feedback.filter((row) => row.severity === "blocking");

/** A blocking row the environment owns says the host refused, not that these bytes are wrong. */
function hostRefused(feedback: readonly CampaignFeedback[]): boolean {
  return feedback.some((row) => row.owner === "environment" && row.severity === "blocking");
}

/** A refusal whose every blocking finding is a timeout. The author still owns it — the checks and
 *  their walls are the candidate's — but a timeout on a loaded host often completes on the next run
 *  of the same request, so the refusal is not remembered as the verdict on these bytes: the same
 *  bytes run again rather than being answered from memory. */
function timedOutOnly(feedback: readonly CampaignFeedback[]): boolean {
  const blocking = blockingOf(feedback);
  return (
    blocking.length > 0 &&
    blocking.every(
      (row) =>
        row.findings !== undefined &&
        row.findings.length > 0 &&
        row.findings.every((found) => TIMEOUT_CODES.has(found.code)),
    )
  );
}

/** A gate run that is no verdict on the bytes: the host refused it, or it only timed out. */
const notAVerdict = (feedback: readonly CampaignFeedback[]) =>
  hostRefused(feedback) || timedOutOnly(feedback);

async function timed<T>(
  run: () => Promise<T> | T,
): Promise<{ value: T; ms: number } | { cause: unknown; ms: number }> {
  const started = performance.now();
  try {
    const value = await run();
    return { value, ms: Math.round(performance.now() - started) };
  } catch (cause) {
    return { cause, ms: Math.round(performance.now() - started) };
  }
}

/** Generated-tool load and conformance over contracts the bundle stage already validated. The
 *  harness is built either way, so the census can still run on a candidate whose tools failed. */
async function loadHarness(
  candidate: CandidateSnapshot,
  probes: AgentToolsProbes,
): Promise<{ harness: BuiltHarness; findings: ContractFinding[] }> {
  const { brief, battery, corpus, toolsSpec } = candidate.bundle;
  const { taskSetHash } = candidate.fingerprint;
  if (taskSetHash === null) {
    throw new Error(`${candidate.snapshotDir}: a validated snapshot is missing its task-set hash`);
  }
  const publicArtifactSchema = compilePublicArtifactSchema(
    brief.artifactSchema,
    corpus.accept.map(({ artifact }) => artifact),
  );
  const harness: BuiltHarness = {
    brief,
    battery,
    toolsSpec,
    corpus,
    publicArtifactSchema,
    fingerprint: candidate.fingerprint,
    conformance: null,
  };
  const loadFindings = (await probes.load?.()) ?? [];
  if (loadFindings.length > 0) return { harness, findings: loadFindings };
  const conformance = await attestToolConformance(probes, {
    toolsSpec,
    toolsSpecHash: toolsSpecHashOf(candidate.snapshotDir),
    probeTasks: battery.tasks,
    taskSetHash,
    publicArtifactSchema,
    verifierEnvironmentHash: candidate.verifierEnvironmentHash,
  });
  if (conformance.findings.length > 0) return { harness, findings: conformance.findings };
  harness.conformance = conformance.evidence;
  return { harness, findings: [] };
}

/** `<root>/<label>-<n>` for the first n no earlier run used. */
export function freshRunDir(root: string, label: string): string {
  for (let n = 1; ; n += 1) {
    const dir = join(root, `${label}-${n}`);
    if (!existsSync(dir)) return dir;
  }
}

/** One gate run per condition and scope, shared across calls; a thrown, host-refused or timed-out
 *  run is forgotten. `runDir` names a new evidence directory and is asked only when the gate executes. */
async function sharedGate(
  candidate: CandidateSnapshot,
  harness: BuiltHarness,
  runDir: (label: string) => string,
  deps: SharedGateDeps,
  scope: GateScope,
): Promise<{ run: GateRun; reused: boolean }> {
  const { gates, memory } = deps;
  const label = scope.referenceSolve ? "full" : "census";
  const key = `${conditionKey(candidate)}:${label}`;
  const prior = memory.gates.get(key);
  if (prior !== undefined) {
    const run = await prior.catch(() => undefined);
    if (run !== undefined && !notAVerdict(run.feedback)) return { run, reused: true };
  }
  const dir = runDir(label);
  mkdirSync(dir, { recursive: true });
  const pending = gates(harness, dir, candidate.snapshotDir, memory.stages, scope).then(
    (feedback): GateRun => ({ trialDir: dir, feedback, conditionDigest: candidate.engineCondition, scope }),
  );
  memory.gates.set(key, pending);
  try {
    const run = await pending;
    if (notAVerdict(run.feedback) && memory.gates.get(key) === pending) memory.gates.delete(key);
    return { run, reused: false };
  } catch (cause) {
    if (memory.gates.get(key) === pending) memory.gates.delete(key);
    throw cause;
  }
}

/** Conformance, then the gates at the widest scope the loaded harness allows. */
async function executeStages(
  candidate: CandidateSnapshot,
  input: PipelineInput,
  admitted: "clean" | "refused",
  deps: ExecuteDeps,
): Promise<ExecutedStages> {
  const load = await timed(() => loadHarness(candidate, input.toolsProbes(candidate.snapshotDir)));
  const notRun = { stage: "gates", status: "not-run", source: "executed", ms: 0 } as const;
  if ("cause" in load) {
    return {
      conformance: [],
      harness: null,
      gated: null,
      runtimeNonResult: false,
      blocked: { stage: "conformance", cause: load.cause },
      receipts: [{ stage: "conformance", status: "blocked", source: "executed", ms: load.ms }, notRun],
    };
  }
  const { harness, findings } = load.value;
  const conformanceReceipt: StageReceipt = {
    stage: "conformance",
    status: findings.length > 0 ? "refused" : "passed",
    source: "executed",
    ms: load.ms,
  };
  if (findings.some((finding) => finding.code === "generated-toolset-termination")) {
    return {
      conformance: findings,
      harness,
      gated: null,
      blocked: null,
      runtimeNonResult: true,
      receipts: [conformanceReceipt, notRun],
    };
  }
  const scope = { referenceSolve: findings.length === 0 };
  const runDir = (label: string) => deps.runDir(admitted === "clean" && findings.length === 0, label);
  const gate = await timed(() => sharedGate(candidate, harness, runDir, deps, scope));
  if ("cause" in gate) {
    return {
      conformance: findings,
      harness,
      gated: null,
      runtimeNonResult: false,
      blocked: { stage: "gates", cause: gate.cause },
      receipts: [conformanceReceipt, { stage: "gates", status: "blocked", source: "executed", ms: gate.ms }],
    };
  }
  const { run, reused } = gate.value;
  const status = blockingOf(run.feedback).length > 0 ? "refused" : "passed";
  return {
    conformance: findings,
    harness,
    gated: run,
    blocked: null,
    runtimeNonResult: false,
    receipts: [
      conformanceReceipt,
      { stage: "gates", status, source: reused ? "reused" : "executed", ms: reused ? 0 : gate.ms },
    ],
  };
}

/** The stages that reached a verdict on this report, and each blocking code under the stage that
 *  emitted it. The gates stage is named `census` when the reference solve did not run, because a
 *  run that skipped it could not have repeated a reference-solve refusal, and a reader of the
 *  receipt must not take that code's absence for an answer to it. */
export function stagesOf(gateReport: Pick<GateReport, "gated" | "receipts" | "refusals">) {
  const gatesAs = gateReport.gated?.scope.referenceSolve === false ? "census" : "gates";
  const name = (stage: AuthorCheckStage): string => (stage === "gates" ? gatesAs : stage);
  const staged = gateReport.refusals.flatMap((refusal) =>
    refusal.findings.map((finding) => `${name(refusal.stage)}:${finding.code}`),
  );
  return {
    stagesRun: gateReport.receipts
      .filter((receipt) => receipt.status === "passed" || receipt.status === "refused")
      .map((receipt) => name(receipt.stage)),
    stagedCodes: [...new Set(staged)].sort(),
  };
}

function report(
  candidate: CandidateSnapshot,
  admission: ContractFinding[],
  admissionMs: number,
  executed: ExecutedStages,
  bundleMs: number,
): GateReport {
  const gateRows = executed.gated === null ? [] : gateFeedbackFindings(blockingOf(executed.gated.feedback));
  const refusals = [
    { stage: "validation" as const, findings: admission },
    { stage: "conformance" as const, findings: executed.conformance },
    { stage: "gates" as const, findings: gateRows },
  ].filter((row) => row.findings.length > 0);
  return {
    ...executed,
    snapshotId: candidate.snapshotId,
    conditionId: conditionKey(candidate),
    refusals,
    receipts: [
      { stage: "bundle", status: "passed", source: "executed", ms: bundleMs },
      {
        stage: "validation",
        status: admission.length > 0 ? "refused" : "passed",
        source: "executed",
        ms: admissionMs,
      },
      ...executed.receipts,
    ],
  };
}

function admit(candidate: CandidateSnapshot) {
  const started = performance.now();
  const findings = admissionFindings(candidate);
  return { findings, ms: Math.round(performance.now() - started) };
}

/** Submit's sequence on its captured candidate: its own snapshot load, the shared gate run. A
 *  preview of the same condition started meanwhile joins it rather than loading the tools again;
 *  submit never replaces what a preview already holds. */
export async function submitStages(
  candidate: CandidateSnapshot,
  input: PipelineInput,
  deps: ExecuteDeps,
): Promise<GateReport> {
  const key = conditionKey(candidate);
  const admission = admit(candidate);
  const pending = executeStages(
    candidate,
    input,
    admission.findings.length === 0 ? "clean" : "refused",
    deps,
  );
  const executed = await (deps.memory.previews.has(key) ? pending : track(deps.memory, key, pending));
  return report(candidate, admission.findings, admission.ms, executed, 0);
}

/** A result that judges the bytes: not blocked, no runtime non-result, no host refusal and not only a timeout. */
export const memorable = (executed: ExecutedStages) =>
  executed.blocked === null &&
  !executed.runtimeNonResult &&
  !(executed.gated !== null && notAVerdict(executed.gated.feedback));

/** A result the environment may own: a block, a runtime non-result or a host refusal. A refusal
 *  that only timed out is not among them: it is not remembered, but an unchanged resubmit of it
 *  still strikes, so a candidate whose checks time out on every run stays bounded by the no-op
 *  strike ceiling. */
export const strikeExempt = (executed: ExecutedStages) =>
  executed.blocked !== null ||
  executed.runtimeNonResult ||
  (executed.gated !== null && hostRefused(executed.gated.feedback));

/** Hold a run as this condition's preview result while it runs, and keep it only if memorable. */
function track(
  memory: ValidationMemory,
  key: string,
  pending: Promise<ExecutedStages>,
): Promise<ExecutedStages> {
  memory.previews.set(key, pending);
  const forget = () => {
    if (memory.previews.get(key) === pending) memory.previews.delete(key);
  };
  return pending.then(
    (executed) => {
      if (!memorable(executed)) forget();
      return executed;
    },
    (cause: unknown) => {
      forget();
      throw cause;
    },
  );
}

/**
 * Submit without adoption: the same capture and stages, written into `trials/<conditionKey>`.
 * It counts no submit strike and accepts nothing.
 */
export async function previewCandidate(
  workspace: string,
  context: CandidateCheckContext,
  deps: PreviewDeps,
): Promise<GateReport> {
  const started = performance.now();
  const candidate = checkCandidate(
    workspace,
    context,
    `correctness_check: trial of the candidate (${context.slug})`,
  );
  const bundleMs = Math.round(performance.now() - started);
  if (!candidate.ok) {
    const proposal = candidate.proposalFindings ?? [];
    return {
      snapshotId: null,
      conformance: [],
      harness: null,
      gated: null,
      blocked: null,
      runtimeNonResult: false,
      refusals: [
        { stage: "bundle" as const, findings: candidate.findings },
        { stage: "validation" as const, findings: proposal },
      ].filter((row) => row.findings.length > 0),
      receipts: [
        { stage: "bundle", status: "refused", source: "executed", ms: bundleMs },
        {
          stage: "validation",
          status: proposal.length > 0 ? "refused" : "not-run",
          source: "executed",
          ms: 0,
        },
        { stage: "conformance", status: "not-run", source: "executed", ms: 0 },
        { stage: "gates", status: "not-run", source: "executed", ms: 0 },
      ],
    };
  }
  const key = conditionKey(candidate);
  const admission = admit(candidate);
  const measured =
    candidate.experimentProposal === undefined
      ? {}
      : { experiment: experimentOperation(candidate, deps.input.adoptedDir) };
  const reported = (executed: ExecutedStages): GateReport => {
    const result = {
      ...report(candidate, admission.findings, admission.ms, executed, bundleMs),
      ...measured,
    };
    // A clear report: no refusal, which a blocking gate row carries, no
    // block or non-result, and a gate run to remember.
    if (result.refusals.length === 0 && memorable(result) && result.gated !== null) {
      deps.memory.clear.set(key, result.gated);
    }
    return result;
  };
  const prior = deps.memory.previews.get(key);
  if (prior !== undefined) {
    const executed = await prior;
    // A remembered result names every executed stage as reused, at no cost; a joined call that
    // ended unmemorable reports that same end, since it did not run twice either.
    const reused: ExecutedStages = {
      ...executed,
      receipts: executed.receipts.map((receipt) => ({ ...receipt, source: "reused", ms: 0 })),
    };
    return memorable(executed) ? { ...reported(reused), repeated: true } : reported(executed);
  }
  const runDir = (_clean: boolean, label: string) => freshRunDir(join(deps.trialsDir, key), label);
  const executed = await track(
    deps.memory,
    key,
    executeStages(candidate, deps.input, admission.findings.length === 0 ? "clean" : "refused", {
      ...deps,
      runDir,
    }),
  );
  return reported(executed);
}

/** The gate run an actual preview of this condition returned as a complete clear report. */
export function clearPreview(memory: ValidationMemory, key: string): GateRun | undefined {
  return memory.clear.get(key);
}
