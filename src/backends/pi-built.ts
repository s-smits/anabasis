/** One Built runtime: controller tools over strict JSONL, real Pi Agent in one confined child.
 *
 *  This file owns what a solve is opened with and what it leaves behind: the worker bundle
 *  directory, the condition the child starts under, and the three shapes a case can end in --
 *  completed, exhausted at the whole-solve wall, or a typed non-result. The child protocol itself
 *  lives in `pi-built-process.ts` and its wire types in `pi-built-child.ts`, so a change to how the
 *  worker talks does not reach the evidence built here. */
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
  /** Read at each worker start rather than once for the run, so a battery that runs for hours hands
   *  every solve a login that is current then, refreshed first when due, instead of the one resolved
   *  before the first case. A login refused mid-battery is therefore that case's provider
   *  non-result and not the whole battery's. */
  auth: () => Promise<PiCredential>;
  policy: SolveIsolationPolicy;
  fakeResponses?: PiWire.PiBuiltStart["fakeResponses"];
  /** Test option alongside `fakeResponses`: the per-turn silence wall in milliseconds. Production
   *  derives it from the harness instead, as `builtTurnWallMs(settings.shellMaxSeconds)`, because a
   *  Built turn is one model call plus one command at its ceiling: a wall shorter than the harness's
   *  own `shell_timeout_max_seconds` would cut a solve that is waiting for a command it is allowed
   *  to run. */
  turnWallMs?: number;
  /** Test option: the ready-handshake wall in milliseconds; production keeps the process module's own. */
  readyWallMs?: number;
  /** Test option: the whole-solve wall in milliseconds; production reads the bundle's agent/config.yaml. */
  solveWallMs?: number;
}

type PiBuiltStart = Omit<PiWire.PiBuiltStart, "workerInstanceId">;

/** The two per-turn accumulators the worker's events fill and every outcome reports. They travel
 *  together because a checkpoint without the turn identity beside it is not readable evidence: the
 *  identities say which model answered each turn, and `completedTurns` is their count. */
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

/** Per-case turn cap of the Built solver when the harness's agent/config.yaml sets none. Four turns
 *  fit one write, one preview and one submit and nothing else; twelve leave room to build or run the
 *  draft, read the result and repair it; twenty-four leave room for a search or optimisation loop
 *  over several candidates (operator decision). The harness's own `solver.max_turns` sets the cap
 *  and this is only the default behind it, which is why `thresholds.frozen.yaml` holds no Built turn
 *  limit to disagree with. */
export const BUILT_DEFAULT_MAX_TURNS = DEFAULT_HARNESS_SETTINGS.maxTurns;

/** What a Built solver is opened with beyond its runtime: the turn cap a test or the export path
 *  overrides, the observer and phase its cases are recorded under, the provider budget each turn is
 *  reserved against, and the safeguard context its shell reports to. */
type BuiltSolverOptions = {
  readonly maxTurns?: number | undefined;
  readonly observer?: RunObserver | undefined;
  readonly observationPhase?: "measure-on" | undefined;
  readonly providerBudget?: ProviderResourceBudget | undefined;
  readonly safeguardContext?: SafeguardContext | undefined;
};

/** The capability row a score claim must state, which the Main Judge also reads as a declared
 *  runtime fact. It is taken from the profile the worker actually runs under rather than from the
 *  run configuration, so the disclosure cannot drift from the served condition; a null profile is an
 *  injected solver with no worker at all, and it discloses web search as off. */
export function builtCapabilities(profile: PiProfile | null): string[] {
  return [`web-search:${profile?.webSearch === true ? profile.transport : "off"}`];
}

let workerDir: string | null = null;
/** The one worker-bundle directory of this process. The solve wall denies reads under the repository
 *  and the operator home, so a TMPDIR inside either hides the bundle from the confined worker it was
 *  written for, and the child dies within a second of opening on "Module not found .../worker.mjs".
 *  The directory is chosen outside both, and the read allow-roots then reopen exactly it. */
function workerBundleDir(): string {
  workerDir ??= mkdtempSync(
    join(workerBundleParent(tmpdir(), [homedir(), dirname(dirname(import.meta.dir))]), "ana-pi-built-"),
  );
  return workerDir;
}

/** TMPDIR, unless some canonical form of it lies under a canonical form of a denied root; then the
 *  shared system temp, checked the same way. The wall also denies the Claude bridge's config write
 *  under a denied root, so the same choice serves both. Canonical forms rather than the written
 *  paths, because a lexical check lets a TMPDIR symlink into the checkout through. */
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
  // The effort an unpinned Built slot serves. A run that pins nothing must still be one condition:
  // the Builder slot opens at "medium" and the review slot at "high", so a Built slot silently
  // opening at "off" measured the solve path with thinking disabled and recorded it as the same
  // claude or codex condition the other two slots named. OpenRouter keeps "off" because its
  // descriptor declares no effort default and its own preflight opens there, and a level that
  // transport never requests would clear a model the run cannot reach.
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

/** The wall ends the solver's time, not its answer. Whatever it has prepared goes through the same
 *  submit gate the solver itself calls -- the same tool, the same checks -- and it has to happen
 *  here, before the generated-tool worker holding that draft closes, because nothing can be
 *  submitted once the worker is gone. */
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

/** The whole-solve wall stopped a solver that was still answering inside its silence wall. Running
 *  out of time is the attempt's own result rather than an environment failure: an accepted submit is
 *  graded, and anything else is an unaccepted case that stays in the difficulty denominator, with
 *  the tool calls its trace saw. Recording it as a runtime non-result instead would remove a real
 *  attempt from the denominator. The wall usually lands mid-call, so the generated worker's pending
 *  requests at close are its consequence and are suppressed here; every other close failure keeps
 *  its non-result. */
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
          /* SAFETY: the guard on this row is `(closeFailure ?? providerFailure) !== null`, so the
           *  fallback branch is reached only when `providerFailure` carries the message. */
          providerFailure as string,
      },
    })),
    runtimeBoundary: runtimeBoundary(result.modelWorker, generatedWorker, contractCondition),
  };
}

/** The exact condition the worker opens with, plus its field-by-field disclosure. Every identity in
 *  the disclosure already feeds the worker's condition digest, which is one opaque hash: disclosing
 *  the fields separately in the boundary evidence is what lets two runs be diffed field by field
 *  once the digests turn out to differ. */
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
  // The starter's shell derives its command profile from the session isolation this run already
  // carries, so the starter is bound to that policy here rather than given a second source for it.
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
    // Preflight never forwards fakeResponses, so the child always takes the live path: the claude
    // transport therefore always needs the CLI binary here, and a preflight that found it missing is
    // reporting a real gap rather than a test shortcut.
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
    // Before the ready handshake nothing product-owned has run, which is why the bundle the wall
    // cannot read and the worker the host ended are both raised as an `EnvironmentRefusal`: they
    // belong to the environment owner, and `controller-unclassified` would name nobody.
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
