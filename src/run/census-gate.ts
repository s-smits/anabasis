/**
 * The census gate over a fingerprinted candidate: task count, control coverage and discrimination,
 * and the F2 reference solve. Results are recorded beside the candidate and returned as authoring
 * feedback.
 */
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { existsSync, readFileSync, readdirSync } from "../meta/filesystem.ts";
import { join, relative, sep } from "../meta/path.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { BuiltHarness, CampaignFeedback, FeedbackOwner } from "../author/campaign-types.ts";
import { TOOL_NON_RESULT_FILE, toolNonResultCode } from "../author/tool-non-result.ts";
import { type TracePointer, tracePointer } from "../claim/case-record.ts";
import { writeCompleted } from "../meta/completed-json.ts";
import { type ContractFinding, controllerValidatedFindings } from "../truth/brief.ts";
import { TOOL_REFUSED_CODE } from "../truth/grounding-coverage.ts";
import type { ProbeControls, ProbeControlsResult } from "../truth/probes.ts";
import type { PublicControlReceipt } from "../truth/battery-record.ts";
import { REFERENCE_SOLVE_ENTRY } from "../truth/evaluator-process-bundle.ts";
import type { CheckCost, ToolCheckCoverage } from "../truth/grounding-coverage.ts";
import {
  VerifierExecutionNonResult,
  environmentOwnedToolNonResult,
  toolRetryDelay,
} from "../truth/verifier-nonresult.ts";
import type { VerifierExecutionEvidence } from "../verify/verifier-port.ts";
import type { SolvabilityCensusGate } from "./solvability-gate.ts";
import { harnessSettings } from "../truth/harness-config.ts";
import type { SolvabilityStageCache } from "../truth/solvability-stages.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";
import { CONFORMANCE_FILE } from "../claim/conformance-evidence.ts";

/** The control-census record written beside an iteration's candidate. */
export const CENSUS_FILE = "census.json";

interface CensusGateOptions {
  verifierLifetime?: VerifierLifetime;
  probeControls: ProbeControls;
  /** Required battery size; the census must cover the complete task set. */
  expectedTasks: number;
  /** F2 reference solve of every task, run beside the control census. It also runs the
   *  representation census, which needs F2's witnesses. */
  solvability?: SolvabilityCensusGate;
  /** Wait before the one retry an environment-owned refusal earns; tests pass 0. */
  toolRetryWaitMs?: number;
  /** Census wall in milliseconds; unset reads ANA_CENSUS_WALL_MS, then agent/config.yaml. */
  censusWallMs?: number;
}

type CensusEvidence = {
  executionEvidence?: VerifierExecutionEvidence[];
  acceptControls: number;
  rejectControls: number;
  tasks: number;
  expectedTasks: number;
  findings: ContractFinding[];
  /** Advisory rows returned beside the verdict; the only durable trace that a screen fired.
   *  Absent when the gate exited before the screens ran. */
  advisory?: CampaignFeedback[];
  /** Public results of the live control check. A missing list is not zero controls. */
  controlReceipts?: PublicControlReceipt[];
  /** Per tool-backed check: how often the host ran its tool and how many rejects it blocked. */
  toolCheckCoverage?: ToolCheckCoverage[];
  /** Each check's cost in dispatches, wall time and tool runs, read back by `correctness_check`. */
  checkCost?: CheckCost[];
  /** Every blocking row behind a `fail`, by owner and finding codes; `findings` holds only the
   *  control census. */
  blocking: Array<{ owner: FeedbackOwner; claim: string; codes: string[] }>;
  verdict: "pass" | "fail" | { kind: "non-result"; evidence: TracePointer };
  /** The protected non-result file, bound by digest, when an authored tool run failed and the
   *  verdict is an ordinary `fail`. */
  verifierNonResultEvidence?: TracePointer;
};

type EnvironmentEvidence =
  | VerifierExecutionEvidence
  | { kind: "vendor-resolution-broken"; package: string; detail: string }
  | { kind: typeof TOOL_REFUSED_CODE; detail: string };

/** One gate call: its subject and the options the gate was made with. */
type CensusContext = {
  options: CensusGateOptions;
  harness: BuiltHarness;
  iterationDir: string;
  slugDir: string;
  stages: SolvabilityStageCache | undefined;
  scope: GateScope;
};

/** What one gate call covers. The control census never runs generated tools; F2 does. */
export interface GateScope {
  referenceSolve: boolean;
}

type CensusStage = "controls" | "reference solve";

/** The longest a cut census waits for its started controls or reference tasks to finish. */
const CENSUS_SETTLE_GRACE_MS = 60_000;

/** What one census attempt finished before a stage failed; recorded beside the failure. */
interface Completed {
  probe?: ProbeControlsResult;
  rows: CampaignFeedback[];
}

const NOTHING_COMPLETED: Completed = { rows: [] };

interface CensusFailure {
  failure: unknown;
  completed: Completed;
}

/** The operator's wall override, resolved when the gate is made so a malformed value refuses before
 *  any spend; null leaves the wall to the candidate's `gate.census_minutes`. */
function censusWallOverrideMs(explicit: number | undefined): number | null {
  const raw = Bun.env.ANA_CENSUS_WALL_MS;
  if (explicit === undefined && raw === undefined) return null;
  const ms = explicit ?? Number(raw);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(
      `ANA_CENSUS_WALL_MS must be a positive integer of milliseconds, got "${explicit ?? raw}"`,
    );
  }
  return ms;
}

class CensusWallExceeded extends Error {
  constructor(
    readonly wallMs: number,
    readonly stage: CensusStage,
  ) {
    super(`the census did not finish within its ${wallMs}ms wall`);
  }
}

/** One wall per census attempt, raced against each stage that runs tools. It names the controls
 *  while they run and the reference solve otherwise. Past the wall no stage starts new work;
 *  `settle` waits a bounded grace for started work so the next attempt does not overlap it. */
function censusWall(wallMs: number) {
  const running = new Set<CensusStage>();
  let stopped = false;
  const work: Promise<unknown>[] = [];
  const expired = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    stopped = true;
    expired.reject(
      new CensusWallExceeded(
        wallMs,
        running.has("controls") || running.size === 0 ? "controls" : "reference solve",
      ),
    );
  }, wallMs);
  timer.unref();
  // Rejecting between stages must not surface as an unhandled rejection; the next race observes it.
  expired.promise.catch(() => undefined);
  return {
    under: <T>(stage: CensusStage, next: Promise<T>): Promise<T> => {
      running.add(stage);
      const settled = next.finally(() => running.delete(stage));
      work.push(settled.catch(() => undefined));
      return Promise.race([settled, expired.promise]);
    },
    stopped: () => stopped,
    settle: async () => {
      const grace = Promise.withResolvers<void>();
      const graceTimer = setTimeout(grace.resolve, Math.min(wallMs, CENSUS_SETTLE_GRACE_MS));
      await Promise.race([Promise.all(work), grace.promise]);
      clearTimeout(graceTimer);
    },
    clear: () => clearTimeout(timer),
  };
}

/** Every census record, pass or fail: corpus counts, completed control results and the rows behind
 *  the verdict. Conformance evidence is written beside it whatever the census verdict. */
function persistCensus(
  { options, harness, iterationDir }: CensusContext,
  feedback: readonly CampaignFeedback[],
  probe: ProbeControlsResult | undefined,
  verdict: CensusEvidence["verdict"],
  extra: Partial<Pick<CensusEvidence, "findings" | "advisory" | "verifierNonResultEvidence">> = {},
): void {
  writeCompleted(join(iterationDir, CENSUS_FILE), {
    acceptControls: harness.corpus.accept.length,
    rejectControls: harness.corpus.reject.length,
    tasks: harness.battery.tasks.length,
    expectedTasks: options.expectedTasks,
    findings: [],
    ...keyIfDefined("controlReceipts", probe?.controlReceipts),
    ...keyIfDefined("toolCheckCoverage", probe?.toolCheckCoverage),
    ...keyIfDefined("checkCost", probe?.checkCost),
    ...keyIfDefined("executionEvidence", probe?.executionEvidence),
    blocking: feedback
      .values()
      .filter((row) => row.severity === "blocking")
      .map((row) => ({
        owner: row.owner,
        claim: row.claim,
        codes: (row.findings ?? []).map((finding) => finding.code),
      }))
      .toArray(),
    verdict,
    ...extra,
  });
  if (harness.conformance != null) {
    writeCompleted(join(iterationDir, CONFORMANCE_FILE), harness.conformance);
  }
}

/** A failure row first, then every completed row. */
function persistFailure(
  context: CensusContext,
  failure: CampaignFeedback[],
  { probe, rows }: Completed,
  verdict: CensusEvidence["verdict"],
  extra: Pick<CensusEvidence, "verifierNonResultEvidence"> = {},
): CampaignFeedback[] {
  const feedback = [...failure, ...rows];
  persistCensus(context, feedback, probe, verdict, extra);
  return feedback;
}

/**
 * Settles a census the host environment refused with one environment-owned row. No solvability.json
 * is written, which keeps adoption closed.
 */
function settleEnvironment(
  context: CensusContext,
  payload: EnvironmentEvidence,
  claim: string,
  evidence: string,
  completed: Completed = NOTHING_COMPLETED,
): CampaignFeedback[] {
  const file = "environment-non-result.json";
  writeCompleted(join(context.iterationDir, file), payload);
  return persistFailure(
    context,
    [{ owner: "environment", severity: "blocking", claim, evidence }],
    completed,
    { kind: "non-result", evidence: tracePointer(context.iterationDir, file) },
  );
}

/** The @ana package specifiers a generated directory's own sources quote, node_modules excluded. */
function importedAnaPackages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const names = new Set<string>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    if (file.includes(`${sep}node_modules${sep}`)) continue;
    for (const match of readFileSync(file, "utf8").matchAll(/["'](@ana\/[a-z0-9-]+)/g)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** A workspace file shadows a vendored package: a blocking finding the Builder can undo. */
function settleShadow(context: CensusContext, dir: string, name: string, shadow: string): CampaignFeedback[] {
  return persistFailure(
    context,
    [
      {
        owner: dir === "agent" ? "tools-spec" : "correctness-model",
        severity: "blocking",
        claim: `${dir}: ${name} resolves to the workspace file ${shadow} instead of the vendored package`,
        evidence: "census gate: vendor resolution evidence (census.json)",
        findings: controllerValidatedFindings([
          {
            code: "vendor-shadowed",
            path: dir,
            detail: `${name} must resolve to node_modules/${name}; remove ${shadow} and any tsconfig "paths" or package entry that points ${name} at the workspace`,
          },
        ]),
      },
    ],
    NOTHING_COMPLETED,
    "fail",
  );
}

/**
 * Generated modules must load the controller's own vendor bytes. Each @ana package the generated
 * sources import is resolved from the importing directory and its entry bytes compared with the
 * host's. A resolution into the workspace is the Builder's shadow; anywhere else, or a resolution
 * that throws, belongs to the environment.
 */
function settleModuleResolution(context: CensusContext): CampaignFeedback[] | null {
  const { slugDir } = context;
  // Only packages the controller declares are checked here; a misspelt @ana specifier is an
  // authoring defect that the module-load probe reports.
  const host =
    /* SAFETY: the controller's own package.json; only optional `dependencies` is read and its keys are filtered by prefix. */ capturedJsonParse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
  const hostDeclared = new Set(
    Object.keys(host.dependencies ?? {}).filter((name) => name.startsWith("@ana/")),
  );
  for (const dir of ["agent", "correctness-model"]) {
    const anchor = join(slugDir, dir);
    for (const name of importedAnaPackages(join(slugDir, dir)).filter((pkg) => hostDeclared.has(pkg))) {
      let fault: string | null = null;
      try {
        const bundleEntry = Bun.resolveSync(name, anchor);
        if (
          readFileSync(bundleEntry, "utf8") !== readFileSync(Bun.resolveSync(name, import.meta.dir), "utf8")
        ) {
          const inside = relative(slugDir, bundleEntry);
          if (!inside.startsWith("..")) {
            return settleShadow(context, dir, name, inside.split(sep).join("/"));
          }
          fault = `resolves to ${bundleEntry}, which differs from the controller's vendor bytes`;
        }
      } catch (error) {
        fault = errorMessage(error);
      }
      if (fault === null) continue;
      return settleEnvironment(
        context,
        { kind: "vendor-resolution-broken", package: name, detail: fault },
        `control census cannot run: ${name} does not resolve from the bundle snapshot to the controller's vendor bytes`,
        "census gate: vendor resolution evidence (census.json)",
      );
    }
  }
  return null;
}

/**
 * What the author may read about a failed tool run: identities it wrote itself and host-measured
 * process facts (how it ended, duration, output sizes, a `sandbox` reason) plus the cell facts it
 * cannot observe from its own session. Tool stdout and stderr stay protected.
 */
export function toolRunFailureDetail(evidence: VerifierExecutionEvidence): string {
  const subject = evidence.phase === "discrimination" ? ` on control "${evidence.subjectId}"` : "";
  const reason =
    evidence.outcome === "sandbox" && evidence.nonResultReason !== undefined
      ? `: ${evidence.nonResultReason}`
      : "";
  const started = evidence.timedOut || evidence.exitCode !== null || evidence.signal !== null;
  const halted = evidence.signal === null ? "never started" : `signal ${evidence.signal}`;
  const ended = evidence.timedOut
    ? "timed out"
    : evidence.exitCode === null
      ? halted
      : `exit ${evidence.exitCode}`;
  const advice = started
    ? ` Cell facts: cwd, TMPDIR and HOME are one private scratch directory holding only the files this evaluate wrote from artifact or public-task bytes, no network, sandbox "${evidence.sandbox}", environment variables received: PATH, TMPDIR, HOME. A tool that works in the authoring session and not here is missing one of those facts or an input file. Give the run every file it reads, a timeoutMs it can finish in, and read its exit code and stderr in the evaluator instead of letting it fail the case.`
    : " The host refused the request before starting a process; change the request the evaluator makes.";
  return `Tool "${evidence.toolId}" (${evidence.toolSource}, run as \`${[evidence.command, ...evidence.args].join(" ")}\`) reached no completed run for check "${evidence.checkId}"${subject} (attempt ${evidence.attempt}): outcome "${evidence.outcome}"${reason}. Process facts: ${ended}, ${evidence.durationMs} ms, ${evidence.stdoutBytes} stdout bytes, ${evidence.stderrBytes} stderr bytes.${advice}`;
}

/** Which census met the failure; the kind, tool and subject stay in the evidence. */
const censusName = (error: VerifierExecutionNonResult): string =>
  error.evidence.phase === "solvability" ? "solvability census" : "control census";

/**
 * A tool run that started and failed (`timeout`, `crash`) is the Builder's to repair; the host,
 * not the generated tool, classifies the outcome.
 */
function settleNonResult(
  context: CensusContext,
  error: VerifierExecutionNonResult,
  completed: Completed,
): CampaignFeedback[] {
  writeCompleted(join(context.iterationDir, TOOL_NON_RESULT_FILE), error.evidence);
  const feedback: CampaignFeedback[] = [
    {
      owner: "correctness-model",
      severity: "blocking",
      // The claim is part of the stall identity: it names the tool but not the outcome kind, so a
      // tool alternating between crash and timeout still counts as one repeated diagnosis.
      claim: `${censusName(error)}: runs of tool "${error.evidence.toolId}" reached no completed run`,
      evidence: "census gate: protected verifier non-result evidence (census.json)",
      findings: controllerValidatedFindings([
        {
          code: toolNonResultCode(error.evidence),
          path: EVALUATOR_FILE,
          detail: toolRunFailureDetail(error.evidence),
        },
      ]),
    },
  ];
  return persistFailure(context, feedback, completed, "fail", {
    verifierNonResultEvidence: tracePointer(context.iterationDir, TOOL_NON_RESULT_FILE),
  });
}

function settleToolUnavailable(
  context: CensusContext,
  error: VerifierExecutionNonResult,
  completed: Completed,
): CampaignFeedback[] {
  return settleEnvironment(
    context,
    error.evidence,
    `${censusName(error)} cannot run: the host could not run tool "${error.evidence.toolId}" (${error.evidence.outcome}), twice`,
    "census gate: protected verifier non-result evidence (census.json)",
    completed,
  );
}

/** A census the wall cut is the Builder's to repair, like a tool run that timed out: the checks
 *  and reference solve are the candidate's own bytes. */
function settleCensusWall(
  context: CensusContext,
  error: CensusWallExceeded,
  completed: Completed,
): CampaignFeedback[] {
  const { harness } = context;
  const minutes = error.wallMs / 60_000;
  const size = `${harness.corpus.accept.length} accept and ${harness.corpus.reject.length} reject examples over ${harness.battery.tasks.length} tasks`;
  const feedback: CampaignFeedback[] = [
    {
      owner: "correctness-model",
      severity: "blocking",
      claim: `census wall: the ${error.stage} stage was still running when the census stopped`,
      evidence: "census gate: census wall",
      findings: controllerValidatedFindings([
        {
          code: "census-wall-exceeded",
          path: error.stage === "controls" ? EVALUATOR_FILE : REFERENCE_SOLVE_ENTRY,
          detail: `The census stopped at its ${minutes}-minute wall during the ${error.stage} stage (${size}). Time one example's checks and one reference task, then cut the repeated tool work until the whole run fits with room to spare on a busy host.`,
        },
      ]),
    },
  ];
  return persistFailure(context, feedback, completed, "fail");
}

/**
 * Runs the census on a fingerprinted candidate: module resolution, then the controls and, beside
 * them, the F2 reference solve, so one call reports every blocking row. Writes census.json and
 * returns the findings. Started work drains within the wall's grace before a retry or settlement.
 */
export function makeCensusGate(
  options: CensusGateOptions,
): (
  harness: BuiltHarness,
  iterationDir: string,
  slugDir: string,
  stages?: SolvabilityStageCache,
  scope?: GateScope,
) => Promise<CampaignFeedback[]> {
  const override = censusWallOverrideMs(options.censusWallMs);
  return async (harness, iterationDir, slugDir, stages, scope = { referenceSolve: true }) => {
    const wallMs = override ?? harnessSettings(slugDir).censusWallMs;
    const context: CensusContext = { options, harness, iterationDir, slugDir, stages, scope };
    for (let attempt = 0; ; attempt += 1) {
      const wall = censusWall(wallMs);
      const outcome = await runCensus(context, wall).catch(
        (cause: unknown): CensusFailure => ({ failure: cause, completed: NOTHING_COMPLETED }),
      );
      wall.clear();
      if (!("failure" in outcome)) return outcome.feedback;
      await wall.settle();
      const settled = settleFailure(context, outcome, attempt === 0 ? "first" : "retried");
      if (settled !== "retry") return settled;
      // One fresh execution may recover a transient host refusal.
      await toolRetryDelay(options.toolRetryWaitMs);
    }
  };
}

function settleFailure(
  context: CensusContext,
  { failure, completed }: CensusFailure,
  attempt: "first" | "retried",
): CampaignFeedback[] | "retry" {
  if (failure instanceof VerifierOperationalStop) throw failure;
  if (failure instanceof CensusWallExceeded) return settleCensusWall(context, failure, completed);
  context.options.verifierLifetime?.assertUsable();
  if (!(failure instanceof VerifierExecutionNonResult)) throw failure;
  if (!environmentOwnedToolNonResult(failure.evidence.outcome)) {
    return settleNonResult(context, failure, completed);
  }
  return attempt === "first" ? "retry" : settleToolUnavailable(context, failure, completed);
}

/** The control census's one row: every finding it returned refuses the candidate. */
function controlsRows(findings: ContractFinding[]): CampaignFeedback[] {
  if (findings.length === 0) return [];
  return [
    {
      owner: "correctness-model",
      severity: "blocking",
      claim: `control census against the installed tools returned ${findings.length} finding(s)`,
      evidence: "census gate: executed discrimination evidence (census.json)",
      findings: controllerValidatedFindings(findings),
    },
  ];
}

/** The control findings, with the drift the census observed against the identity captured at submit. */
function controlFindings(harness: BuiltHarness, probe: ProbeControlsResult): ContractFinding[] {
  const captured = harness.conformance?.verifierEnvironmentHash;
  // A census stopped before its controls reports no identity.
  if (
    captured === undefined ||
    probe.verifierEnvironmentHash === undefined ||
    probe.verifierEnvironmentHash === captured
  ) {
    return probe.findings;
  }
  return [
    ...probe.findings,
    ...controllerValidatedFindings([
      {
        code: "verifier-condition-drift",
        path: ".toolchain",
        detail:
          "The control census did not establish the installed verifier identity captured at submit; submit again under the current tool condition.",
      },
    ]),
  ];
}

async function runCensus(
  context: CensusContext,
  wall: ReturnType<typeof censusWall>,
): Promise<{ feedback: CampaignFeedback[] } | CensusFailure> {
  const { options, harness, iterationDir, slugDir, stages, scope } = context;
  const unresolvable = settleModuleResolution(context);
  if (unresolvable !== null) return { feedback: unresolvable };
  const solvability = scope.referenceSolve ? options.solvability : undefined;
  if (solvability !== undefined) options.verifierLifetime?.assertUsable();
  const [controls, reference] = await Promise.allSettled([
    wall.under(
      "controls",
      options.probeControls(slugDir, harness.brief, harness.corpus, harness.battery.tasks, wall.stopped),
    ),
    solvability === undefined
      ? Promise.resolve([])
      : wall.under("reference solve", solvability(harness, iterationDir, slugDir, wall.stopped, stages)),
  ]);
  const probe = controls.status === "fulfilled" ? controls.value : undefined;
  const findings = probe === undefined ? [] : controlFindings(harness, probe);
  // A tool refused twice by the sandbox or as unreadable is the environment's non-result.
  const refusal = findings.find((finding) => finding.code === TOOL_REFUSED_CODE);
  const referenceRows = reference.status === "fulfilled" ? reference.value : [];
  const completed: Completed = {
    ...keyIfDefined("probe", probe),
    rows: [...controlsRows(findings.filter((finding) => finding !== refusal)), ...referenceRows],
  };
  // Report the controls' failure first; the other stage's rows ride beside it.
  if (controls.status === "rejected") return { failure: controls.reason, completed };
  if (reference.status === "rejected") return { failure: reference.reason, completed };
  if (refusal !== undefined) {
    return {
      feedback: settleEnvironment(
        context,
        { kind: TOOL_REFUSED_CODE, detail: refusal.detail },
        `control census cannot run: ${refusal.detail}`,
        "census gate: protected verifier non-result evidence (census.json)",
        completed,
      ),
    };
  }
  const feedback = completed.rows;
  // Only blocking rows fail the census; advisory rows stay in the record.
  const verdict = feedback.some((row) => row.severity === "blocking") ? "fail" : "pass";
  persistCensus(context, feedback, probe, verdict, {
    findings,
    advisory: feedback.filter((row) => row.severity === "advisory"),
  });
  options.verifierLifetime?.assertUsable();
  return { feedback };
}
