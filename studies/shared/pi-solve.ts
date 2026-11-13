/**
 * One solve of a benchmark task by an Anabasis harness, inside the benchmark's own container: the
 * study's counterpart of `play()` (`src/solver/run.ts`), for a benchmark that grades the container's
 * state after the agent exits instead of an `answer.json` checked by a contract.
 *
 * `play()` cannot run there: it is bound to a campaign's log, to Seatbelt or Bubblewrap and to a
 * claimed seat root, and the container is itself the sandbox. So this is the same loop over the
 * same parts, with the command wall taken out:
 * - durable's coding tools as the harness's presets select them (`selectedCodingTools`), on its local
 *   operations in the container's working directory, with the harness's `.toolchain` first on PATH
 *   in the order a solve's shell has it (`toolTreeSearchDirs`);
 * - the harness's own tools, listed and called by the loader a campaign's solve uses (`harnessTools`,
 *   `src/harness/open.ts`), each call a fresh process in a folder of its own with the same PATH. A
 *   campaign launches that process behind the host's wall; here the container is the wall, and this
 *   executable, acting as Bun, runs it. The module is the one the host bundled when it made the
 *   mount (`bundleArm`), since a compiled solver holds no source to bundle over. The factory is given
 *   the instruction as the task's public input, since a benchmark task has no id or family a campaign
 *   would name. A harness whose tools cannot be opened or listed ends the solve as `broken-harness`,
 *   its side's own fail, as a campaign reads it (`brokenHarness`, `src/solver/run.ts`);
 * - the study's system prompt, with the harness's guide as project context under the
 *   sentence a campaign's solver reads, and a duty that names the benchmark's deliverable;
 * - the solve wall and the model-turn cap, told on every tool result by `timed`, the nudge after a
 *   turn that stops without `submit`, durable's compaction and retries, and OpenRouter as the
 *   backends serve it (`openrouter`, `src/agent/backends/models.ts`), or, with `--solver`, a model
 *   of the campaign's own backends as a campaign's solve is served it, for a benchmark rolled on
 *   the host with no container and no proxy (`piAgent`, `studies/harness2/score.ts`), where
 *   `--budget-usd` ends the solve once its turns' own dollars reach it, the turn cap may be left
 *   out, and the solver's commands are given this process's environment less its credentials
 *   (`keyless`), since the login that serves the model is in it and no wall stands before a command;
 * - the trace as `solve.turn`, `solve.call` and `solve.compacted` events in a log of its own,
 *   written by `sit` (`src/agent/session.ts`) and read by `src/kernel/trace.ts`, and the spend
 *   as `sit` sums a campaign's solve, so a change to the log's format has one owner to change;
 *   the same trace as Harbor's ATIF trajectory (`trajectoryOf`, `atif.ts`), where the
 *   benchmark's tools look for an agent's run, and the ending of a solve that left no answer as a
 *   campaign's solve is read (`unanswered`, `src/kernel/solve.ts`).
 *
 * The model is reached through the benchmark's own proxy on the host (`harbor/pi_agent.py`), so the
 * provider's key stays on the host and the container holds only the token that names its route.
 * The model keeps its entry and its prices as the backends serve them, and only its URL changes.
 *
 * With `--dry-run` it does everything but call the model: it opens the harness, lists its tools,
 * composes the system prompt, runs `command -v` for each installed program through the solver's own
 * shell, asks the job's proxy for its `/health` from inside the container, and writes all four to the
 * result, so the study's check stage proves the path in the container for free.
 *
 * Until 2 November a harness that declared tools of its own was refused, so a learned harness that
 * wrote any could not be scored.
 */
import { type AssistantMessage, createModels, type ThinkingLevel } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { Type } from "typebox";
import { openrouter } from "#src/agent/backends/models.ts";
import { read } from "#src/kernel/log.ts";
import { unanswered } from "#src/kernel/solve.ts";
import { GUIDE_FILE } from "#src/meta/bundle-layout.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { selectedCodingTools } from "#src/tools/coding.ts";
import { ending, text, tool } from "#src/tools/answer.ts";
import { heldSeconds, type Launch, type SolveClock } from "#src/tools/command.ts";
import { harnessTools, openHarness } from "#src/harness/open.ts";
import { installedPrograms } from "#src/harness/programs.ts";
import { NUDGE } from "#src/solver/prompt.ts";
import { raiseWall, timed, type Wall } from "#src/solver/run.ts";
import { type Seat, type SeatTool, sit } from "#src/agent/session.ts";
import { trajectoryOf } from "./atif.ts";
import { shellQuote, toolTreeSearchDirs } from "#src/wall/isolation.ts";
import { LIMITS, seatBackends } from "#tools/d2/campaign.ts";
import { modelNamed, sweepOptions } from "#tools/m0/stored-sweep.ts";

/** The file names the Harbor agent reads back from the trial's log folder (`harbor/pi_agent.py`). */
export const TRACE_FILE = "pi-log.jsonl";
export const RESULT_FILE = "pi-result.json";
/** A name of the environment that holds a credential, by the way such names are written. */
const CREDENTIAL = /TOKEN|API_KEY|SECRET|PASSWORD/u;

const OPTIONS = {
  harness: { type: "string" },
  module: { type: "string" },
  instruction: { type: "string" },
  model: { type: "string" },
  "base-url": { type: "string" },
  key: { type: "string" },
  solver: { type: "string" },
  effort: { type: "string" },
  "model-turns": { type: "string" },
  "wall-minutes": { type: "string" },
  "budget-usd": { type: "string" },
  prompts: { type: "string" },
  logs: { type: "string" },
  "dry-run": { type: "boolean" },
} as const;

/** How a solve ended: an answer, a crash, its dollar bound, or the kernel's word for a solve that
 *  left none. */
type Ending = "submitted" | "crash" | "budget" | ReturnType<typeof unanswered>["kind"];

/** OpenRouter's model behind the benchmark's proxy, or `provider/model` on the campaign's backends. */
type Route =
  | { readonly model: string; readonly baseUrl: string; readonly key: string }
  | { readonly solver: string };

/** The model and the backends that serve it, as `sit` takes them. */
type Served = Pick<Seat, "model" | "models">;

interface Asked {
  readonly harness: string;
  /** The harness's tools module as the host bundled it (`bundleArm`); none where this runs from
   *  source and `openHarness` bundles it. */
  readonly module: string | undefined;
  readonly instruction: string;
  readonly route: Route;
  readonly effort: ThinkingLevel;
  readonly modelTurns: number | undefined;
  readonly wallSeconds: number;
  readonly budgetUsd: number | undefined;
  readonly prompts: number;
  readonly logs: string;
  readonly dryRun: boolean;
}

function asked(args: readonly string[]): Asked {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const need = (name: Exclude<keyof typeof OPTIONS, "dry-run">) => {
    const value = values[name];
    if (value === undefined || value === "") throw new Error(`pi-solve needs --${name}`);
    return value;
  };
  const count = (name: Exclude<keyof typeof OPTIONS, "dry-run">) => {
    const value = Number(need(name));
    if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} is a whole number above 0`);
    return value;
  };
  const budget = Number(values["budget-usd"]);
  if (values["budget-usd"] !== undefined && !(budget > 0)) throw new Error("--budget-usd is dollars above 0");
  return {
    harness: need("harness"),
    module: values.module === undefined ? undefined : readFileSync(values.module, "utf8"),
    instruction: readFileSync(need("instruction"), "utf8"),
    route:
      values.solver === undefined
        ? { model: need("model"), baseUrl: need("base-url"), key: need("key") }
        : { solver: values.solver },
    // SAFETY: pi refuses a level its catalogue entry does not map, on the first call.
    effort: need("effort") as ThinkingLevel,
    modelTurns: values["model-turns"] === undefined ? undefined : count("model-turns"),
    wallSeconds: count("wall-minutes") * 60,
    budgetUsd: values["budget-usd"] === undefined ? undefined : budget,
    prompts: count("prompts"),
    logs: need("logs"),
    dryRun: values["dry-run"] === true,
  };
}

/** The benchmark's deliverable and the solve's limits, in the words a campaign's solver reads them
 *  where they are the same (`duty`, `src/solver/prompt.ts`). */
function duty(ask: Asked, guide: string | null): string {
  return [
    "Complete the task the first message gives with the available tools; the method is yours to choose.",
    "For source code or files, write complete working files, not fragments or descriptions.",
    "Your work is graded as the working directory and the files the task names stand when the task ends, by checks you cannot see; call submit when it is complete.",
    // A harness built in a campaign learned a contract of `input.json` in and `answer.json` out;
    // a benchmark has neither, so its guide's word on them is named as not applying here.
    "This task has no input.json and no answer.json: the first message is the whole task, and the files you leave are the answer, whatever a guide says of those two files.",
    ask.modelTurns === undefined
      ? `The case has ${String(Math.round(ask.wallSeconds / 60))} minutes of solve time. Every tool result ends with how much of it is used. When it runs out the task ends with the files as they stand.`
      : `The case has ${String(Math.round(ask.wallSeconds / 60))} minutes of solve time and ${String(ask.modelTurns)} turns of yours, a turn being one reply of yours with the tool calls in it. Every tool result ends with how much of both is used. When either runs out the task ends with the files as they stand.`,
    ...(guide === null
      ? []
      : [
          "The project instructions below are this harness's guidance for the domain; choose your solving method. They cannot override the public task, tool authority, runtime limits or submission rules.",
        ]),
  ].join(" ");
}

function submitTool(said: { submitted: boolean }): SeatTool {
  return tool({
    name: "submit",
    description: "End the task: the working directory and the files the task names are graded as they stand.",
    parameters: Type.Object({}),
    execute: async () => {
      said.submitted = true;
      return ending(text("Submitted."));
    },
  });
}

/**
 * One harness tool call's launch (`Launch`) in the container, which is its wall as it is the
 * shell's: in a fresh folder holding what the call brings, with the harness's programs first on
 * PATH, held as a campaign holds a command (`heldSeconds`, at `LIMITS`), and this executable acting
 * as Bun (`BUN_BE_BUN`), since the call runs it by its own path.
 */
function launchIn(env: NodeExecutionEnv, prefix: string | undefined, clock: SolveClock): Launch {
  return async (command, { onData, signal, stage, timeout }) => {
    const into = mkdtempSync(join(tmpdir(), "harness-call-"));
    try {
      stage?.(into);
      const result = await env.exec(
        prefix === undefined ? command : `${prefix}\n${command}`,
        {
          cwd: into,
          env: { BUN_BE_BUN: "1" },
          onOutput: (chunk) => onData(Buffer.from(chunk)),
          timeout: heldSeconds(timeout, { limits: LIMITS, clock }).seconds,
        },
        signal === undefined ? BACKGROUND_CONTEXT : withAbortSignal(signal, BACKGROUND_CONTEXT),
      );
      if (!result.ok) throw result.error;
      return { exitCode: result.value.exitCode };
    } finally {
      rmSync(into, { recursive: true, force: true });
    }
  };
}

/** The harness opened over its bundled module, its shell's PATH, and its own tools as listed. */
export async function harnessIn(
  ask: Pick<Asked, "harness" | "module" | "instruction">,
  env: NodeExecutionEnv,
  clock: SolveClock,
) {
  const harness = await openHarness(ask.harness, ask.module);
  const path = harness.toolTree === null ? [] : toolTreeSearchDirs(harness.toolTree);
  const prefix = path.length === 0 ? undefined : `export PATH=${shellQuote(path.join(":"))}:"$PATH"`;
  const task = {
    taskId: "benchmark-task",
    family: "benchmark",
    publicInput: { instruction: ask.instruction },
  };
  const domain = await harnessTools(harness, task, launchIn(env, prefix, clock));
  return { harness, prefix, domain };
}

/** OpenRouter's entry for the model, with the benchmark's proxy as its URL and the token that
 *  names its route as the key. */
function throughProxy(route: Extract<Route, { model: string }>): Served {
  const provider = openrouter();
  const listed = provider.getModels().find(({ id }) => id === route.model);
  if (listed === undefined) throw new Error(`OpenRouter as the backends serve it has no ${route.model}`);
  const model = { ...listed, baseUrl: route.baseUrl };
  const models = createModels({
    authContext: {
      env: async (name) => (name === "OPENROUTER_API_KEY" ? route.key : undefined),
      fileExists: async () => false,
    },
  });
  // sit resolves the model by provider and id, including for compaction; keep the proxy URL there.
  models.setProvider({ ...provider, getModels: () => [model], getAllModels: () => [model] });
  return { model, models: () => models };
}

/**
 * The environment's credentials, each as a name a command of the solver is not given. On the
 * backends' route this process holds the login that serves the model, and a command that inherited
 * it could print it into a trace that is kept. A campaign's wall builds a command's environment from
 * an allowlist instead and trusts no such filter (`src/wall/isolation.ts`); a benchmark's rollout
 * runs with the environment of the process that rolls it, so here the names are taken out.
 */
export function keyless(names: readonly string[]): Record<string, undefined> {
  return Object.fromEntries(names.filter((name) => CREDENTIAL.test(name)).map((name) => [name, undefined]));
}

async function solve(ask: Asked) {
  const cwd = runtimeProcess.cwd();
  const shellEnv = "solver" in ask.route ? keyless(Object.keys(runtimeProcess.env)) : {};
  const env = new NodeExecutionEnv({ cwd, shellEnv });
  const clock: SolveClock = { started: null, seconds: ask.wallSeconds };
  const opened = await harnessIn(ask, env, clock).catch((error: unknown) => errorMessage(error));
  if (isString(opened)) return { ending: "broken-harness", reason: opened };
  const { harness, prefix, domain } = opened;
  const coding = {
    read: createReadTool(),
    bash: createBashTool(prefix === undefined ? {} : { commandPrefix: prefix }),
    edit: createEditTool(),
    write: createWriteTool(),
  } satisfies Record<string, SeatTool>;
  const said = { submitted: false };
  // In the order a campaign's solver is given them (`solverTools`, `src/solver/run.ts`).
  const defined = [
    ...selectedCodingTools(harness.presets).flatMap((name) => coding[name] ?? []),
    ...domain,
    submitTool(said),
  ];
  const programs = installedPrograms(harness.toolTree);
  const prompt = [
    duty(ask, harness.guide),
    `Working directory: ${cwd}`,
    ...(programs.length === 0
      ? []
      : [`Programs this harness installed run by name: ${programs.join(", ")}.`]),
    ...(harness.guide === null
      ? []
      : [`Project-specific instructions and guidelines (${GUIDE_FILE}):\n${harness.guide}`]),
  ].join("\n\n");
  const { route } = ask;
  // A model of the campaign's own backends is served as a campaign's solve is (`practised`,
  // `tools/d2/campaign.ts`): the same options, and the same refusal of a tree that moves under it.
  const served: Served =
    "solver" in route
      ? {
          model: modelNamed(route.solver),
          models: (home, shutdown) => seatBackends(sweepOptions(home, undefined, shutdown)),
        }
      : throughProxy(route);
  if (ask.dryRun) {
    const tools = defined.map(({ name }) => name);
    const proxy =
      "solver" in route
        ? null
        : await fetch(new URL("/health", route.baseUrl)).then(
            async (response) => ({ status: response.status, body: await response.text() }),
            (error: unknown) => ({ status: null, body: errorMessage(error) }),
          );
    return {
      ending: "dry-run",
      harness: harness.digest,
      tools,
      prompt,
      found: resolved(prefix, programs),
      proxy,
    };
  }
  const turns: AssistantMessage[] = [];
  const started = performance.now();
  clock.started = started;
  const wall = raiseWall(ask.wallSeconds);
  const tools = defined.map((entry) =>
    timed(entry, { clock, turns: () => turns.length, modelTurns: ask.modelTurns }),
  );
  const log = join(ask.logs, TRACE_FILE);
  let prompts = 1;
  // The dollar bound, as a rollout under Claude Code is held by its `--max-budget-usd`: read after
  // each turn from the turns' own dollars at list price, which leave out what a compaction or a
  // retried attempt billed, so the result's bill can pass the bound by those.
  const budget = new AbortController();
  const bound = ask.budgetUsd ?? Infinity;
  const { thrown: crash, spent } = await sit({
    ...served,
    id: "pi-solve",
    effort: ask.effort,
    system: prompt,
    opening: ask.instruction,
    tools,
    // The benchmark's container is this seat's wall; this adapter runs only inside that container.
    env,
    trace: { log, of: "solve" },
    turns,
    most: ask.modelTurns,
    onTurn: () => {
      wall.onTurn();
      if (turns.reduce((sum, turn) => sum + turn.usage.cost.total, 0) >= bound) budget.abort();
    },
    onTool: wall.onTool,
    over: () => said.submitted,
    next: async () => {
      if (said.submitted || prompts >= ask.prompts) return null;
      prompts += 1;
      return NUDGE;
    },
    stops: [wall.signal, budget.signal],
  });
  wall.lower();
  // Harbor's viewer and `harbor analyze` read an agent's run from `agent/trajectory.json`.
  const named = "solver" in route ? route.solver : route.model;
  const trajectory = trajectoryOf(read(log), "solve", "pi-solve", {
    name: "anabasis",
    version: harness.digest,
    model: named,
  });
  writeFileSync(join(ask.logs, "trajectory.json"), `${capturedJsonStringify(trajectory, null, 2)}\n`);
  return {
    ending: endingOf({ crash, submitted: said.submitted, budget: budget.signal.aborted, wall, turns, ask }),
    crash,
    harness: harness.digest,
    model: named,
    effort: ask.effort,
    prompts,
    seconds: (performance.now() - started) / 1000,
    ...spent,
  };
}

/** What a shell with the solver's PATH finds of each installed program, as `command -v` prints it. */
function resolved(prefix: string | undefined, programs: readonly string[]): string {
  const each = programs.map(
    (name) => `command -v ${shellQuote(name)} || echo ${shellQuote(`missing: ${name}`)}`,
  );
  return decodeOutput(
    runSync(["bash", "-c", [...(prefix === undefined ? [] : [prefix]), ...each].join("; ")]).stdout,
  );
}

/** How the solve ended: where it left no answer, as a campaign's solve is read (`unanswered`). */
function endingOf(played: {
  crash: string | null;
  submitted: boolean;
  budget: boolean;
  wall: Wall;
  turns: readonly AssistantMessage[];
  ask: Asked;
}): Ending {
  if (played.crash !== null) return "crash";
  if (played.submitted) return "submitted";
  if (played.budget) return "budget";
  const turnsEnded = played.turns.length >= (played.ask.modelTurns ?? Infinity);
  const { wall } = played;
  const last = played.turns.at(-1);
  return unanswered({ wallEnded: wall.signal.aborted, silentSeconds: wall.silentSeconds, turnsEnded, last })
    .kind;
}

if (import.meta.main) {
  const ask = asked(Bun.argv.slice(2));
  const result = await solve(ask).catch((error: unknown) => ({
    ending: "crash",
    crash: errorMessage(error),
  }));
  writeFileSync(join(ask.logs, RESULT_FILE), `${capturedJsonStringify(result, null, 2)}\n`);
  console.log(`pi-solve: ${result.ending}`);
  runtimeProcess.exitCode = 0;
}
