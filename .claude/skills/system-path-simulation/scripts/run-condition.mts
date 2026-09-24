/**
 * Run one simulation condition through the REAL controller: `runFullRun` from this tree, over a
 * campaign the operator seeded beforehand, with each model slot either live or scripted.
 *
 * Every condition staged by hand between 8 and 10 September 2026 rewrote the same pieces: slot
 * and limit literals, a `deps.build` interception, a SIGTERM wall, `FullRunClosure`, a `ps`
 * descendant census, a preregistration freeze and a first-prompt digest check. Each one is an
 * option or a written report field here, and the controller path is production's own — the
 * selector, `runBuildStep`, submit, census, solvability, adoption, measurement, analysis and the
 * terminal record all run unchanged. The only redirections are the two interfaces production
 * already declares: `HarnessBuildOptions.builderRuntime` and `HarnessMeasureOptions.solver`.
 *
 *   bun .claude/skills/system-path-simulation/scripts/run-condition.mts \
 *     --project <slug> --prompt-file /abs/one-liner.txt --run <runId> \
 *     --expected-tasks 25 --provider-turn-budget 15 --out /abs/report-dir \
 *     --builder live|capture|/abs/turn.mts --built live|/abs/solver.mts --review live|off \
 *     [--root /abs/tree] [--max-iterations N] [--max-builder-turns N] [--wall-ms N] \
 *     [--predictions /abs/note.md] [--dcg true|false] [--census-ms N] [--allow-dirty] \
 *     [--real-isolation] [--json]
 *
 * `--builder capture` opens the production session composition, records the system prompt
 * digest, the roster names and the exact first prompt to `<out>/capture.json`, then stops before
 * any provider work: the operator preregisters the prompt this seeded slug and epoch will see,
 * with no path rewriting. The controller records that stop as the run's terminal, so the live
 * condition that follows uses another `--run` id.
 *
 * The runner never seeds and never launches anything detached. A scripted condition proves the
 * mechanism around the interface; only a live slot measures a model.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { sha256 } from "#src/meta/digest.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import type { RunObserver } from "#src/observe/run-observer.ts";
import type { HostSession } from "#src/backends/pi-session.ts";
import type { SessionProfileEvidence } from "#src/backends/session-isolation.ts";
import type { Solver } from "#src/truth/solve.ts";
import {
  HOST_SOLVE_ISOLATION_FIXTURE,
  HOST_SOLVE_ISOLATION_PROFILE_ID,
  type HostSolveIsolationEvidence,
} from "#src/verify/solve-sandbox.ts";
import { type BuilderRuntimeFactory, composeBuilderRuntime } from "#src/run/builder-runtime.ts";
import type { FullRunDeps, FullRunOutcome } from "#src/run/full-run.ts";
import {
  type ScriptedTurn,
  scriptedBuilderRuntime,
} from "../../../../test/helpers/scripted-builder-runtime.ts";
import { absoluteOption, exitWith, type ExitWith, parseOrDie, requiredOption } from "#skills/main/cli.ts";
import { type ProcessCensusSnapshot, startProcessCensus } from "./process-census.mts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isFunction } from "#src/meta/json-shape.ts";
import type { Callable, OpenRecord } from "#src/meta/json-shape.ts";
import { keyIfDefined, keyIfNotNull, keysIf } from "#src/meta/optional-key.ts";
import { writeJsonFile } from "#src/meta/completed-json.ts";

const die: ExitWith = exitWith("run-condition");

const SCRIPT_ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "../../../..");
const REPORT_SCHEMA = "simulation-condition-report/v1";
const REPORT_FILE = "report.json";
const CAPTURE_STOP = "simulation-capture-before-provider";

type BuilderMode =
  | { kind: "live" }
  | { kind: "capture" }
  | { kind: "scripted"; path: string; turn: ScriptedTurn };
type BuiltMode = { kind: "live" } | { kind: "scripted"; path: string; solver: Solver };

interface FirstPrompt {
  turn: number | undefined;
  role: string;
  sha256: string;
  chars: number;
}

interface Capture {
  backend: string;
  webSearch: boolean;
  systemPromptSha256: string;
  toolNames: string[];
  firstPrompt?: string;
  firstPromptSha256?: string;
}

/** What the two interceptions recorded: the first Builder prompt, and the capture condition when
 *  `--builder capture` stopped the run before any provider work. */
interface Seen {
  firstPrompt: FirstPrompt | null;
  capture: Capture | null;
}
const seen: Seen = { firstPrompt: null, capture: null };
class CaptureStop extends Error {
  constructor() {
    super(CAPTURE_STOP);
    this.name = "CaptureStop";
  }
}

const absolutePath = absoluteOption(die);

function positiveInteger(option: string, value: string): string {
  if (!/^[1-9]\d*$/.test(value)) die(`--${option} must be a positive integer, got ${JSON.stringify(value)}`);
  return value;
}

async function loadExport<T>(
  option: string,
  path: string,
  name: string,
  accepts: (value: unknown) => value is T,
): Promise<T> {
  const module: OpenRecord = await import(path).catch((cause: unknown) => {
    die(`could not load --${option} ${path}: ${errorMessage(cause)}`);
  });
  const exported = module[name];
  if (!accepts(exported)) die(`--${option} module must export "${name}": ${path}`);
  return exported;
}

/** A module export is callable or it is not; no runtime check can prove a function's parameter
 *  types, so the scripted module owns its signature and a wrong one fails where it is called. */
const isCallable = <T extends Callable>(value: unknown): value is T => isFunction(value);

async function builderMode(value: string): Promise<BuilderMode> {
  if (value === "live") return { kind: "live" };
  if (value === "capture") return { kind: "capture" };
  const path = absolutePath("builder", value);
  if (!existsSync(path)) die(`--builder module does not exist: ${path}`);
  return {
    kind: "scripted",
    path,
    turn: await loadExport("builder", path, "turn", isCallable<ScriptedTurn>),
  };
}

async function builtMode(value: string): Promise<BuiltMode> {
  if (value === "live") return { kind: "live" };
  const path = absolutePath("built", value);
  if (!existsSync(path)) die(`--built module does not exist: ${path}`);
  return { kind: "scripted", path, solver: await loadExport("built", path, "solver", isCallable<Solver>) };
}

/** The isolation evidence a scripted Built slot records: the same doubles the measurement
 *  warranty uses, so the case rows read `physical` without opening a confined worker. */
function scriptedIsolation() {
  const probe: HostSolveIsolationEvidence = {
    fixture: HOST_SOLVE_ISOLATION_FIXTURE,
    isolated: true,
    available: true,
    deniedReadRefused: true,
    controlReadSucceeded: true,
    discriminationReadSucceeded: true,
    moveGuardRefused: true,
    profileDigest: "0".repeat(64),
    probedAt: new Date().toISOString(),
    evidence: [],
  };
  const session: SessionProfileEvidence = {
    role: "built",
    model: "scripted-solver",
    reasoningEffort: "none",
    providerVersion: "scripted",
    activePermissionProfile: HOST_SOLVE_ISOLATION_PROFILE_ID,
    policyHash: "0".repeat(64),
    confinedPid: runtimeProcess.pid + 1,
    controllerPid: runtimeProcess.pid,
  };
  return { isolationProbe: () => probe, sessionProbe: async () => session };
}

/** Wrap the controller's build-phase observer so the first Builder prompt is recorded by digest,
 *  in live and scripted conditions alike. */
function promptRecorder(record: (prompt: FirstPrompt) => void): (observer: RunObserver) => RunObserver {
  let recorded = false;
  const wrap = (observer: RunObserver): RunObserver => ({
    ...observer,
    child: (id) => wrap(observer.child(id)),
    prompt: (event) => {
      if (!recorded && event.contract === "builder") {
        recorded = true;
        record({
          turn: event.turn,
          role: event.role,
          sha256: sha256(event.prompt),
          chars: event.prompt.length,
        });
      }
      return observer.prompt(event);
    },
  });
  return wrap;
}

/** The production composition — mount, roster, search capability and session evidence — with only
 *  the provider session replaced, so the capture records the condition the live run will open. */
function captureRuntime(out: string, onCapture: (capture: Capture) => void): BuilderRuntimeFactory {
  return async (manifest, options, repoRoot, campaignPath, condition) => {
    const runtime = composeBuilderRuntime(manifest, options, repoRoot, campaignPath, condition);
    return {
      tools: runtime.tools,
      webSearch: runtime.webSearch,
      trialIsolation: runtime.trialIsolation,
      recordSession: runtime.recordSession,
      open: async (tools, systemPrompt): Promise<HostSession> => {
        const toolNames = tools.map((tool) => tool.name);
        const capture: Capture = {
          backend: runtime.backend,
          webSearch: runtime.webSearch,
          systemPromptSha256: sha256(systemPrompt),
          toolNames,
        };
        return {
          backend: runtime.backend,
          sessionId: "pi-condition-capture",
          async runTurn({ prompt }) {
            capture.firstPrompt = prompt;
            capture.firstPromptSha256 = sha256(prompt);
            writeJsonFile(join(out, "capture.json"), capture);
            writeFileSync(join(out, "captured-first-prompt.txt"), prompt);
            onCapture(capture);
            throw new CaptureStop();
          },
          configure() {},
          async dispose() {},
        };
      },
    };
  };
}

const parsed = parseOrDie(die, {
  values: [
    "root",
    "project",
    "prompt-file",
    "run",
    "expected-tasks",
    "provider-turn-budget",
    "max-iterations",
    "max-builder-turns",
    "wall-ms",
    "predictions",
    "out",
    "builder",
    "built",
    "review",
    "dcg",
    "census-ms",
  ],
  flags: ["json", "allow-dirty", "real-isolation"],
});
const single = parsed.single;
const asJson = parsed.flags.has("json");

const required = requiredOption(die, single);

const root = single.has("root") ? absolutePath("root", required("root")) : SCRIPT_ROOT;
const project = required("project");
if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) die("--project must be a lowercase slug");
const runId = required("run");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) die("--run must be one safe path segment");
const promptPath = absolutePath("prompt-file", required("prompt-file"));
if (!existsSync(promptPath)) die(`--prompt-file does not exist: ${promptPath}`);
const prompt = readFileSync(promptPath, "utf8");
if (prompt.trim() === "") die("the prompt file is empty or whitespace-only");
const expectedTasks = positiveInteger("expected-tasks", required("expected-tasks"));
const providerTurnBudget = positiveInteger("provider-turn-budget", required("provider-turn-budget"));
const out = absolutePath("out", required("out"));
if (existsSync(join(out, REPORT_FILE))) {
  die(`${join(out, REPORT_FILE)} already exists — one report directory per condition`);
}
const reviewValue = required("review");
if (reviewValue !== "live" && reviewValue !== "off") {
  die(`--review must be live or off, got ${JSON.stringify(reviewValue)}`);
}
const wallMs = single.has("wall-ms") ? Number(positiveInteger("wall-ms", required("wall-ms"))) : null;
const censusMs = single.has("census-ms")
  ? Number(positiveInteger("census-ms", required("census-ms")))
  : 2_000;
const dcgValue = single.get("dcg");
if (dcgValue !== undefined && dcgValue !== "true" && dcgValue !== "false") die("--dcg must be true or false");
const campaign = campaignDir(root, project);
if (!existsSync(campaign)) {
  die(`${campaign} does not exist — seed the campaign first (seed-campaign.mts); this runner never seeds`);
}
const builder = await builderMode(required("builder"));
const built = await builtMode(required("built"));
if (builder.kind === "live" && wallMs === null) {
  die("--builder live needs --wall-ms: a live actor runs under an explicit wall");
}
if (builder.kind === "capture" && built.kind === "live") {
  die("--builder capture stops before any battery; pair it with a scripted --built");
}

const predictionsPath = single.get("predictions");
const predictions =
  predictionsPath === undefined
    ? null
    : (() => {
        const path = absolutePath("predictions", predictionsPath);
        if (!existsSync(path)) die(`--predictions does not exist: ${path}`);
        const text = readFileSync(path, "utf8");
        return { path, sha256: sha256(text), text };
      })();

/** Source identity comes from the production capture; a dirty tree measures unrecorded bytes. */
const { captureSourceIdentity } = await import("#src/run/source-identity.ts");
const source = captureSourceIdentity();
if (source === null) die("source identity is unattributed (no git); record the tree before measuring it");
if (source.dirty && !parsed.flags.has("allow-dirty")) {
  die(
    `the tree at ${root === SCRIPT_ROOT ? root : SCRIPT_ROOT} is dirty; commit or pass --allow-dirty to record an unattributed condition`,
  );
}

const fullRunArgv = [
  "--prompt",
  prompt,
  "--project",
  project,
  "--run",
  runId,
  "--expected-tasks",
  expectedTasks,
  "--provider-turn-budget",
  providerTurnBudget,
  ...(single.has("max-iterations")
    ? ["--max-iterations", positiveInteger("max-iterations", required("max-iterations"))]
    : []),
  ...(single.has("max-builder-turns")
    ? ["--max-builder-turns", positiveInteger("max-builder-turns", required("max-builder-turns"))]
    : []),
  ...(reviewValue === "off" ? ["--review-backend", "disabled"] : []),
  // A scripted or captured Builder opens no command shell, so the host guard has nothing to guard.
  "--dcg",
  dcgValue ?? (builder.kind === "live" ? "true" : "false"),
];

/** Keep the production controller graph behind every provider-free refusal above. */
const [fullRun, harnessBuild, harnessMeasure, analyse, evidence, loopTerminal] = await Promise.all([
  import("#src/run/full-run.ts"),
  import("#src/run/harness-build.ts"),
  import("#src/run/harness-measure.ts"),
  import("#src/run/analyse-step.ts"),
  import("#src/run/controller-evidence.ts"),
  import("#src/run/loop-terminal.ts"),
]);
const args = fullRun.parseFullRunArgs(fullRunArgv);
mkdirSync(out, { recursive: true });

const recordPrompt = promptRecorder((record) => {
  seen.firstPrompt = record;
});
const builderRuntime: BuilderRuntimeFactory | null =
  builder.kind === "scripted"
    ? scriptedBuilderRuntime(builder.turn)
    : builder.kind === "capture"
      ? captureRuntime(out, (record) => {
          seen.capture = record;
        })
      : null;
/** A scripted Built slot replaces the solver, and unless `--real-isolation` the host isolation
 *  with it. A live slot replaces neither, so the measure step runs production's own. */
const scriptedSolve =
  built.kind === "scripted"
    ? { solver: built.solver, ...keysIf(!parsed.flags.has("real-isolation"), scriptedIsolation) }
    : {};
const deps: FullRunDeps = {
  build: (manifest, options) => {
    const observer = options?.observer;
    return harnessBuild.buildHarness(manifest, {
      ...options,
      ...keyIfDefined("observer", observer === undefined ? undefined : recordPrompt(observer)),
      ...keyIfNotNull("builderRuntime", builderRuntime),
    });
  },
  drive: (manifest, options) => harnessMeasure.measureHarness(manifest, { ...options, ...scriptedSolve }),
  analyse: analyse.analyseStep,
};

function note(line: string): void {
  if (!asJson) console.error(line);
}
note(`tree        ${SCRIPT_ROOT}`);
note(`root        ${root}`);
note(`campaign    ${campaign}`);
note(`source      ${source.commit.slice(0, 9)}${source.dirty ? " (dirty)" : ""}`);
note(`builder     ${builder.kind}${builder.kind === "scripted" ? ` ${builder.path}` : ""}`);
note(`built       ${built.kind}${built.kind === "scripted" ? ` ${built.path}` : ""}`);
note(`review      ${reviewValue}`);
note(`wall        ${wallMs === null ? "none" : `${wallMs} ms`}`);
if (predictions !== null) note(`predictions ${predictions.path} sha256 ${predictions.sha256.slice(0, 16)}…`);

const startedAt = Date.now();
const census = startProcessCensus(censusMs);
let wallReached = false;
const wall =
  wallMs === null
    ? null
    : setTimeout(() => {
        wallReached = true;
        note(`wall        reached after ${wallMs} ms; SIGTERM to the controller`);
        runtimeProcess.kill(runtimeProcess.pid, "SIGTERM");
      }, wallMs);
let outcome: FullRunOutcome | null = null;
let failure: { name: string; message: string } | null = null;
try {
  outcome = await fullRun.runFullRun(args, root, deps);
} catch (cause) {
  failure =
    cause instanceof Error
      ? { name: cause.name, message: cause.message }
      : { name: "unknown", message: String(cause) };
} finally {
  if (wall !== null) clearTimeout(wall);
}
const captured = seen.capture !== null && failure?.message === CAPTURE_STOP;
const descendants: ProcessCensusSnapshot = census.stop();
const controller = (() => {
  try {
    return evidence.readControllerEvidence(campaign, runId);
  } catch (cause) {
    return { state: "unreadable" as const, error: errorMessage(cause) };
  }
})();

// The captured first prompt is written to its own file and reaches the report as a digest, so the
// report does not carry a second copy of it.
const capture = seen.capture === null ? null : { ...seen.capture, firstPrompt: undefined };
const report = {
  schema: REPORT_SCHEMA,
  tree: SCRIPT_ROOT,
  root,
  source,
  args,
  slots: {
    builder:
      builder.kind === "scripted" ? { mode: "scripted", module: builder.path } : { mode: builder.kind },
    built:
      built.kind === "scripted"
        ? {
            mode: "scripted",
            module: built.path,
            isolation: parsed.flags.has("real-isolation") ? "real" : "scripted",
          }
        : { mode: "live" },
    review: reviewValue,
  },
  result: captured ? "captured" : failure === null ? "completed" : "failed",
  ...keyIfNotNull("failure", captured ? null : failure),
  ...keyIfNotNull("capture", capture),
  firstBuilderPrompt: seen.firstPrompt,
  outcome:
    outcome === null
      ? null
      : {
          rounds: outcome.rounds,
          terminal: outcome.terminal,
          build: outcome.build,
          buildClauses: outcome.buildClauses,
          decision: outcome.decision,
          absentSteps: outcome.absentSteps,
        },
  controller,
  wall: { ms: wallMs, reached: wallReached },
  sampledDescendants: descendants,
  ...keyIfNotNull("predictions", predictions),
  elapsedMs: Date.now() - startedAt,
};
writeJsonFile(join(out, REPORT_FILE), report);

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  note("");
  note(`result      ${report.result}${failure !== null && !captured ? ` — ${failure.message}` : ""}`);
  if (outcome !== null) {
    for (const round of outcome.rounds) {
      note(
        `round       ${round.runId} ${round.move} build=${round.build} measured=${round.measured} terminal=${round.terminal ?? "none"}`,
      );
    }
  }
  if (seen.firstPrompt !== null) note(`prompt      first builder prompt sha256 ${seen.firstPrompt.sha256}`);
  note(`descendants ${descendants.present.length} of ${descendants.observed.length} sampled still present`);
  note(`report      ${join(out, REPORT_FILE)}`);
  if (predictions !== null) {
    const ids = [...predictions.text.matchAll(/^(P\d+)\b/gm)].map((m) => m[1]);
    note(`UNRESOLVED  ${ids.length === 0 ? "(no P-numbered lines found)" : ids.join(", ")}`);
  }
}
runtimeProcess.exitCode = captured
  ? 0
  : outcome === null
    ? 1
    : loopTerminal.fullRunExitStatus(outcome.terminal);
