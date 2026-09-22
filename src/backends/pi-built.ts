/** One Built runtime: controller tools over strict JSONL, real Pi Agent in one confined child. */
import { mkdtempSync, rmSync } from "../meta/filesystem.ts";
import { homedir, tmpdir } from "../meta/os.ts";
import { dirname, join } from "../meta/path.ts";
import type { OptionalEnvValues } from "./scrub-env.ts";
import { EnvironmentRefusal } from "./environment-refusal.ts";
import { sha256 } from "../meta/digest.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import { observeSolveCase, observeSolverTurn, settlingCaseSpan } from "../observe/model-turn-observer.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import {
  BUILT_FIRST_TURN_TEMPLATE,
  BUILT_NUDGE,
  type BuiltStarter,
  type GeneratedToolWorkerEvidence,
  builtAgentInterface,
  builtFirstTurnPrompt,
  starterRegistration,
} from "../solve/built-starter.ts";
import { GeneratedToolWorkerNonResult, createGeneratedToolStarter } from "../solve/generated-tool-worker.ts";
import { withTimeLeftAtSubmit } from "../solve/submit-time-left.ts";
import { PENDING_REQUESTS_AT_CLOSE } from "../solve/generated-tool-worker-termination.ts";
import { loadBuiltControllerInterface } from "../truth/contracts.ts";
import { runtimeNonResultReason } from "../truth/runtime-blocker.ts";
import {
  type BuiltRuntimeBoundaryEvidence,
  type SolveOutcome,
  type SolveInterfaceCondition,
  type Solver,
  type SolverNonResult,
  nonResultOutcome,
  withSolverBuiltStarterFactory,
} from "../truth/solve.ts";
import type { SolveIsolationPolicy } from "../verify/solve-sandbox.ts";
import { type PiCredential, type PiProfile, claudeCliExecutable, resolvePiSlot } from "./pi-providers.ts";
import { PI_AGENT_RUNTIME } from "./model-selection.ts";
import { piSessionPolicy } from "./pi-session.ts";
import type * as PiWire from "./pi-built-child.ts";
import {
  builtTurnWallMs,
  type PiBuiltWorkerBundle,
  PiBuiltWorkerNonResult,
  startPiBuiltWorker,
} from "./pi-built-process.ts";
import { DEFAULT_HARNESS_SETTINGS, type HarnessSettings } from "../truth/harness-config.ts";
import type { ResolvedSlots } from "./resolve.ts";
import { createTraceRecorder } from "./trace-capture.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import { runtimeProcess } from "../meta/process.ts";
import { containsPath } from "../meta/path-containment.ts";
import { buildWorkerBundle } from "../meta/subprocess.ts";
import { canonicalForms } from "../verify/seatbelt-path-guard.ts";
import type { ProviderResourceBudget } from "../run/provider-resource-budget.ts";

export interface PiBuiltRuntime {
  profile: PiProfile;
  /** Read at each worker start, so every solve of a long battery gets a current, refreshed login. */
  auth: () => Promise<PiCredential>;
  policy: SolveIsolationPolicy;
  fakeResponses?: PiWire.PiBuiltStart["fakeResponses"];
  /** Test option: the per-turn silence wall in milliseconds; production derives it from the harness. */
  turnWallMs?: number;
  /** Test option: the ready-handshake wall in milliseconds; production keeps the process module's own. */
  readyWallMs?: number;
  /** Test option: the whole-solve wall in milliseconds; production reads the bundle's agent/config.yaml. */
  solveWallMs?: number;
}

type PiBuiltStart = Omit<PiWire.PiBuiltStart, "workerInstanceId">;

/** Per-turn accumulators the worker's events fill; a checkpoint is read with its turn identity. */
type BuiltTurnRecord = {
  readonly checkpoints: ReturnType<BuiltStarter["checkpoint"]>[];
  readonly identities: NonNullable<Extract<PiWire.PiBuiltChildMessage, { type: "turn_end" }>["identity"]>[];
};

/** What the run recorded by the time an outcome is built, whichever way the solve ended. */
type BuiltCaseEvidence = BuiltTurnRecord & {
  readonly trace: ReturnType<ReturnType<typeof createTraceRecorder>["trace"]>;
  readonly submitted: boolean;
  readonly contractCondition: SolveInterfaceCondition;
};

/** Per-case turn cap of the Built solver when the harness's `solver.max_turns` sets none. */
export const BUILT_DEFAULT_MAX_TURNS = DEFAULT_HARNESS_SETTINGS.maxTurns;

/** What a Built solver is opened with beyond its runtime. */
type BuiltSolverOptions = {
  readonly maxTurns?: number | undefined;
  readonly observer?: RunObserver | undefined;
  readonly observationPhase?: "measure-on" | undefined;
  readonly providerBudget?: ProviderResourceBudget | undefined;
  readonly safeguardContext?: SafeguardContext | undefined;
};

/** The capability row a score claim states, derived from the served profile; null means an
 *  injected solver with no worker. */
export function builtCapabilities(profile: PiProfile | null): string[] {
  return [`web-search:${profile?.webSearch === true ? profile.transport : "off"}`];
}

let workerDir: string | null = null;
/** The one worker-bundle directory of this process, kept outside the repository and home that the
 *  solve wall denies; the read allow-roots reopen exactly this directory. */
function workerBundleDir(): string {
  workerDir ??= mkdtempSync(
    join(workerBundleParent(tmpdir(), [homedir(), dirname(dirname(import.meta.dir))]), "ana-pi-built-"),
  );
  return workerDir;
}

/** TMPDIR, unless some canonical form of it lies under a denied root; then the shared system temp,
 *  checked the same way. Canonical forms catch a TMPDIR symlink into the checkout. */
function workerBundleParent(tmp: string, deniedRoots: readonly string[]): string {
  const denied = deniedRoots.flatMap(canonicalForms);
  const inside = (path: string) =>
    canonicalForms(path).some((form) => denied.some((root) => containsPath(form, root)));
  if (!inside(tmp)) return tmp;
  const shared = runtimeProcess.platform === "darwin" ? "/private/var/tmp" : "/var/tmp";
  if (inside(shared)) {
    throw new Error(`worker bundle: TMPDIR ${tmp} and ${shared} both lie under a root the solve wall denies`);
  }
  return shared;
}

/** Host files a transport executes from inside an otherwise closed repository or home. */
export function piBuiltReadAllowRoots(slots: ResolvedSlots): string[] {
  return [workerBundleDir(), ...(slots.built.kind === "claude" ? [claudeCliExecutable()] : [])];
}

export function resolvePiBuiltRuntime(
  slots: ResolvedSlots,
  repoRoot: string,
  policy: SolveIsolationPolicy,
  env: OptionalEnvValues = Bun.env,
): PiBuiltRuntime {
  // The effort an unpinned Built slot serves, so the solve path never runs with thinking off by
  // accident. OpenRouter declares no effort default and preflights at "off", so it stays there.
  const effort = slots.built.kind === "openrouter" ? "off" : "medium";
  const { profile, auth } = resolvePiSlot("built", slots.built, { effort, webSearch: true }, repoRoot, env);
  return { profile, auth, policy };
}

let workerBundle: Promise<PiBuiltWorkerBundle> | null = null;
function bundleWorker(): Promise<PiBuiltWorkerBundle> {
  if (workerBundle) return workerBundle;
  const dir = workerBundleDir();
  workerBundle = (async () => {
    const file = await buildWorkerBundle(
      "Pi Built worker bundle failed",
      Bun.fileURLToPath(new URL("./pi-built-child.ts", import.meta.url)),
      dir,
    );
    runtimeProcess.once("exit", () => rmSync(dir, { recursive: true, force: true }));
    return { file, dir, digest: sha256(await Bun.file(file).bytes()) };
  })();
  return workerBundle;
}

function conditionDigest(start: PiBuiltStart): string {
  return hashJsonBytes({
    profile: start.profile,
    contract: start.contract,
    promptDigest: sha256(start.prompt),
    nudgeDigest: sha256(start.nudge),
    maxTurns: start.maxTurns,
    // The retry and compaction policy the worker's session runs under is part of what was measured.
    session: piSessionPolicy(start.profile),
    fakeResponsesDigest: start.fakeResponses === undefined ? null : hashJsonBytes(start.fakeResponses),
  });
}

function workerEvents(
  task: Parameters<Solver>[0],
  starter: BuiltStarter,
  recorder: ReturnType<typeof createTraceRecorder>,
  turns: BuiltTurnRecord,
  observation: { readonly observer: RunObserver | undefined; readonly phase: "measure-on" | undefined },
) {
  const { observer, phase } = observation;
  const { checkpoints, identities } = turns;
  const caseObserver = observeSolveCase(observer, {
    taskId: task.taskId,
    ...keyIfDefined("phase", phase),
  });
  return (
    message: Exclude<PiWire.PiBuiltChildMessage, { type: "ready" | "tool_call" | "done" | "closing" }>,
  ) => {
    if (message.type === "turn_start") {
      recorder.beginTurn(message.turn);
      observeSolverTurn(caseObserver, {
        prompt: message.prompt,
        turn: message.turn,
        taskId: task.taskId,
        phase: phase ?? "built-solve",
        nudge: BUILT_NUDGE,
      });
    } else if (message.type === "event") {
      recorder.onEvent(message.event);
    } else if (message.type === "turn_end") {
      recorder.onEvent(
        message.status === "failed"
          ? { type: "turn_failed", errorMessage: message.errorMessage ?? `Pi turn ${message.turn} failed` }
          : {
              type: "turn_ended",
              stopReason: message.status,
              ...keyIfDefined("usage", message.usage),
              ...keyIfDefined("compactions", message.compactions),
            },
      );
      if (message.status === "completed") {
        checkpoints.push(starter.checkpoint(message.turn));
        if (message.identity !== undefined) identities.push(message.identity);
      }
    }
  };
}

function runtimeBoundary(
  modelWorker: BuiltRuntimeBoundaryEvidence["modelWorker"],
  generatedWorker: GeneratedToolWorkerEvidence,
  contractCondition: SolveInterfaceCondition,
): BuiltRuntimeBoundaryEvidence {
  return {
    schema: "built-runtime-boundary/v1",
    modelWorker,
    contractCondition,
    generatedTools: generatedWorker,
  };
}

/** Only the host-marked close handshake timeout preserves accepted work. A sandbox,
 *  protocol or crash failure still invalidates the runtime boundary after submission. */
function generatedCloseFailure(
  generatedWorker: GeneratedToolWorkerEvidence,
  submitted: boolean,
): SolverNonResult | null {
  const { termination } = generatedWorker;
  const benignCloseTimeout =
    submitted &&
    termination.status === "non-result" &&
    termination.kind === "runtime" &&
    termination.deadline === true &&
    termination.closeHandshakeTimeout === true;
  return termination.status === "non-result" && !benignCloseTimeout
    ? { kind: termination.kind, message: termination.message }
    : null;
}

/** The wall ends the solver's time, not its answer: the last prepared answer goes through the same
 *  submit gate the solver calls, before the generated-tool worker that holds it closes. */
async function submitAtWall(
  tools: ReadonlyMap<string, BuiltStarter["tools"][number]>,
  taskId: string,
): Promise<void> {
  await tools
    .get("submit")
    ?.execute(
      `solve-wall-${taskId}`,
      /* SAFETY: `submit` takes no arguments; `never` is the roster's parameter type, not a claim about this value. */ {} as never,
    )
    .catch(() => undefined);
}

/** The whole-solve wall stopped a solver still answering inside its silence wall. That is the
 *  attempt's own result: an accepted submit is graded, anything else is an unaccepted case with its
 *  traced tool calls. Pending generated-tool requests at close are the wall's consequence; every
 *  other close failure keeps its non-result. */
function exhaustedOutcome(
  error: PiBuiltWorkerNonResult,
  generatedWorker: GeneratedToolWorkerEvidence,
  evidence: BuiltCaseEvidence,
): SolveOutcome {
  const { checkpoints, identities, trace, submitted, contractCondition } = evidence;
  const failure = generatedCloseFailure(generatedWorker, submitted);
  const closeFailure =
    failure?.kind === "protocol" && failure.message.endsWith(PENDING_REQUESTS_AT_CLOSE) ? null : failure;
  return {
    turns: trace.turns.length,
    completedTurns: identities.length,
    runtimeIdentities: identities,
    errors: [error.message],
    toolCalls: trace.toolCalls.length,
    startedToolCalls: trace.toolCalls.length,
    checkpoints,
    trace,
    ...keyIfDefined("nonResult", closeFailure ?? undefined),
    runtimeBoundary: runtimeBoundary(error.modelWorker, generatedWorker, contractCondition),
  };
}

function completedOutcome(
  result: Awaited<ReturnType<typeof startPiBuiltWorker>>,
  generatedWorker: GeneratedToolWorkerEvidence,
  evidence: BuiltCaseEvidence,
): SolveOutcome {
  const { checkpoints, identities, trace, submitted, contractCondition } = evidence;
  const closeFailure = generatedCloseFailure(generatedWorker, submitted);
  const providerFailure = submitted ? null : runtimeNonResultReason(result.done.errors);
  return {
    turns: result.done.turns,
    completedTurns: identities.length,
    errors: result.done.errors,
    toolCalls: result.done.toolCalls.total,
    startedToolCalls: result.done.toolCalls.total,
    runtimeIdentities: identities,
    checkpoints,
    trace,
    ...keysIf((closeFailure ?? providerFailure) !== null, () => ({
      nonResult: closeFailure ?? {
        kind: "provider" as const,
        message:
          /* SAFETY: the guard above ensures `providerFailure` is non-null when `closeFailure` is null. */ providerFailure as string,
      },
    })),
    runtimeBoundary: runtimeBoundary(result.modelWorker, generatedWorker, contractCondition),
  };
}

/** The exact condition the worker opens with, plus a field-by-field disclosure so two runs can be
 *  diffed; every disclosed identity also feeds the condition digest. */
async function openedCondition(
  runtime: PiBuiltRuntime,
  task: Parameters<Solver>[0],
  starter: BuiltStarter,
  maxTurns: number,
) {
  const contract = builtAgentInterface(
    starter.tools,
    starter.registration,
    starter.operatingGuide ?? null,
    settingsOf(starter).solveMs,
  );
  const start: PiBuiltStart = {
    type: "start",
    profile: runtime.profile,
    credential: await runtime.auth(),
    contract,
    prompt: builtFirstTurnPrompt(task),
    nudge: BUILT_NUDGE,
    maxTurns,
    ...keyIfDefined("fakeResponses", runtime.fakeResponses),
    ...keysIf(runtime.profile.transport === "claude" && runtime.fakeResponses === undefined, () => ({
      claudeCliPath: claudeCliExecutable(),
    })),
  };
  const contractCondition: SolveInterfaceCondition = {
    systemPromptDigest: contract.promptDigest,
    systemPrompt: contract.systemPrompt,
    firstTurnTemplateDigest: sha256(BUILT_FIRST_TURN_TEMPLATE),
    nudgeDigest: sha256(BUILT_NUDGE),
    toolSchemaDigest: contract.toolSchemaDigest,
    tools: contract.tools,
    operatingGuide: contract.operatingGuide,
    backendProfileDigest: hashJsonBytes(start.profile),
    maxTurns,
  };
  return { start, contractCondition };
}

const settingsOf = (starter: BuiltStarter): HarnessSettings => starter.settings ?? DEFAULT_HARNESS_SETTINGS;

/** The runtime under the harness's own walls, except where a test set one. */
const harnessRuntime = (
  runtime: PiBuiltRuntime,
  settings: HarnessSettings,
  maxTurns: number,
): PiBuiltRuntime => ({
  ...runtime,
  turnWallMs: runtime.turnWallMs ?? builtTurnWallMs(settings.shellMaxSeconds),
  ...keyIfDefined("solveWallMs", runtime.solveWallMs ?? (maxTurns === 0 ? undefined : settings.solveMs)),
});

/** `maxTurns` overrides the harness's own `solver.max_turns` (tests and the export path). */
export function piBuiltSolver(runtime: PiBuiltRuntime, options: BuiltSolverOptions = {}): Solver {
  const { maxTurns, observer, observationPhase, providerBudget, safeguardContext } = options;
  const solver: Solver = async (task, toolset, submitted) => {
    const starter: BuiltStarter = toolset;
    if (starter.preparationNonResult) return nonResultOutcome(starter.preparationNonResult);
    if (starter.generatedWorker === undefined || starter.close === undefined) {
      return nonResultOutcome({
        kind: "protocol",
        message: "Pi Built solver requires the confined generated-tool starter",
      });
    }
    const recorder = createTraceRecorder({ backend: runtime.profile.transport });
    const turns: BuiltTurnRecord = { checkpoints: [], identities: [] };
    // The login is read at each solve, so one refused mid-battery is this case's provider non-result.
    const opened = await openedCondition(
      runtime,
      task,
      starter,
      maxTurns ?? settingsOf(starter).maxTurns,
    ).catch(async (cause: unknown) => {
      await starter.close?.();
      if (cause instanceof EnvironmentRefusal) {
        return nonResultOutcome({ kind: "provider", message: cause.message });
      }
      throw cause;
    });
    if (!("contractCondition" in opened)) return opened;
    const { start, contractCondition } = opened;
    let generatedWorker: GeneratedToolWorkerEvidence | null = null;
    const tools = withTimeLeftAtSubmit(
      new Map(starter.tools.map((tool) => [tool.name, tool])),
      runtime.solveWallMs ?? settingsOf(starter).solveMs,
      Date.now,
      () => turns.identities.length + 1 >= start.maxTurns,
    );
    try {
      const events = workerEvents(task, starter, recorder, turns, {
        observer,
        phase: observationPhase,
      });
      const result = await startPiBuiltWorker({
        runtime: harnessRuntime(runtime, settingsOf(starter), start.maxTurns),
        bundle: await bundleWorker(),
        start,
        conditionDigest: conditionDigest(start),
        tools,
        onMessage: events,
        reserveTurn: providerBudget === undefined ? undefined : () => providerBudget.reserve("built"),
        signal: providerBudget?.cancellationSignal,
      });
      generatedWorker = await starter.close();
      return completedOutcome(result, generatedWorker, {
        ...turns,
        trace: recorder.trace(),
        submitted: submitted(),
        contractCondition,
      });
    } catch (error) {
      if (error instanceof PiBuiltWorkerNonResult && error.solveTimeExhausted && !submitted()) {
        await submitAtWall(tools, task.taskId);
      }
      generatedWorker ??= await starter.close();
      if (error instanceof PiBuiltWorkerNonResult && error.solveTimeExhausted) {
        return exhaustedOutcome(error, generatedWorker, {
          ...turns,
          trace: recorder.trace(),
          submitted: submitted(),
          contractCondition,
        });
      }
      if (error instanceof PiBuiltWorkerNonResult || error instanceof GeneratedToolWorkerNonResult) {
        const boundary =
          error instanceof PiBuiltWorkerNonResult
            ? { runtimeBoundary: runtimeBoundary(error.modelWorker, generatedWorker, contractCondition) }
            : {};
        return nonResultOutcome(
          { kind: error.kind, message: error.message },
          { checkpoints: turns.checkpoints, trace: recorder.trace(), ...boundary },
        );
      }
      throw error;
    }
  };
  // The starter's shell derives its command profile from this run's session isolation.
  const observed = settlingCaseSpan(solver, observer, observationPhase);
  return withSolverBuiltStarterFactory(observed, async (slugDir, task, submission, publicArtifactSchema) => {
    const contract = await loadBuiltControllerInterface(slugDir);
    return await createGeneratedToolStarter({
      slugDir,
      task,
      submission,
      contract,
      publicArtifactSchema,
      sessionIsolation: runtime.policy,
      ...keyIfDefined("safeguardContext", safeguardContext),
    });
  });
}

/** No provider turn: the exact worker initializes under the exact solve policy and reports its pid. */
export async function preflightPiBuilt(runtime: PiBuiltRuntime) {
  const start: PiBuiltStart = {
    type: "start",
    profile: runtime.profile,
    credential: await runtime.auth(),
    contract: builtAgentInterface([], starterRegistration([]), null, DEFAULT_HARNESS_SETTINGS.solveMs),
    prompt: "",
    nudge: "",
    maxTurns: 0,
    // Preflight never forwards fakeResponses, so the claude transport always needs the CLI here.
    ...keysIf(runtime.profile.transport === "claude", () => ({ claudeCliPath: claudeCliExecutable() })),
  };
  const result = await startPiBuiltWorker({
    runtime,
    bundle: await bundleWorker(),
    start,
    conditionDigest: conditionDigest(start),
    tools: new Map(),
    onMessage: () => {},
  }).catch((cause: unknown) => {
    // Before the ready handshake nothing product-owned has run, so the failure is the environment's.
    if (cause instanceof PiBuiltWorkerNonResult && cause.modelWorker.modelSelection === null) {
      throw new EnvironmentRefusal(
        `Pi Built preflight worker never reached its ready handshake: ${cause.message}`,
      );
    }
    throw cause;
  });
  if (result.modelWorker.confinedPid === null || result.modelWorker.modelSelection === null) {
    throw new Error("Pi Built preflight completed without complete worker evidence");
  }
  return {
    role: "built",
    model: runtime.profile.model,
    reasoningEffort: runtime.profile.thinkingLevel,
    providerVersion: `${PI_AGENT_RUNTIME.id}/${PI_AGENT_RUNTIME.version}`,
    activePermissionProfile: runtime.policy.profileId,
    policyHash: runtime.policy.policyHash,
    confinedPid: result.modelWorker.confinedPid,
    controllerPid: runtimeProcess.pid,
    modelSelection: result.modelWorker.modelSelection,
  };
}
