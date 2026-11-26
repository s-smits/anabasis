/**
 * One solve of a benchmark task by an Anabasis harness inside the benchmark's own container, which
 * grades the container's state after the agent exits: the study's counterpart of `play()`
 * (`src/solver/run.ts`), which is bound to a campaign's log, to Seatbelt or Bubblewrap and to a
 * claimed seat root, where here the container is the sandbox. It is the same loop over the same
 * parts with the command wall taken out: the harness's coding tools (`selectedCodingTools`) with
 * its `.toolchain` first on PATH; `broken-harness` for a harness that does not open; the study's
 * system prompt with the guide as project context; the solve wall, turn cap, nudge, compaction and
 * retries; the trace as `solve.*` events written by `runAgent` and read by `src/kernel/trace.ts`, plus
 * Harbor's ATIF trajectory (`trajectoryOf`). The model is reached through the benchmark's proxy on
 * the host (`harbor/pi_agent.py`), so the provider's key stays there, or with `--solver` through a
 * model of the campaign's own backends. `--dry-run` does everything but call the model and writes
 * the tools, system prompt, `command -v` of each program and the proxy's `/health` to the result,
 * so the check stage proves the path for free. A harness that declares tools of its own is not
 * refused, so a learned harness that writes any can be scored.
 */
import { type AssistantMessage, createModels, type ThinkingLevel } from "@earendil-works/pi-ai";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { Type } from "typebox";
import { openrouter } from "#src/agent/backends/models.ts";
import { read } from "#src/kernel/log.ts";
import { unanswered } from "#src/kernel/solve.ts";
import { readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { basename, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { directCodingTools, selectedCodingTools } from "#src/tools/coding.ts";
import { ending, text, tool } from "#src/tools/answer.ts";
import type { SolveClock } from "#src/tools/command.ts";
import { readHarnessFiles } from "#src/harness/files.ts";
import { openHarness } from "#src/harness/open.ts";
import { installedPrograms } from "#src/harness/programs.ts";
import { portableGuide } from "#src/harness/starter.ts";
import { listedPrograms, NUDGE, promptEnvelope } from "#src/solver/prompt.ts";
import { raiseWall, timed, type Wall } from "#src/solver/run.ts";
import { type AgentSpec, type AgentTool, runAgent } from "#src/agent/session.ts";
import { trajectoryOf } from "./atif.ts";
import { shellQuote, toolTreeEnv, toolTreeSearchDirs } from "#src/sandbox/isolation.ts";
import { seatBackends } from "#tools/campaign/campaign.ts";
import { modelNamed, sweepOptions } from "#tools/m0/stored-sweep.ts";

export const TRACE_FILE = "pi-log.jsonl";
export const RESULT_FILE = "pi-result.json";
const CREDENTIAL = /TOKEN|API_KEY|SECRET|PASSWORD/u;
const CAMPAIGN_REF_RE = /\b(?:input|answer)\.json\b|public\/(?:task\.json|files\/|resources\/)/u;

const OPTIONS = {
  harness: { type: "string" },
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

type Ending = "submitted" | "crash" | "budget" | ReturnType<typeof unanswered>["kind"];

type Route = Readonly<{ model: string; baseUrl: string; key: string }> | Readonly<{ solver: string }>;

type Served = Pick<AgentSpec, "model" | "models">;

interface Asked {
  readonly harness: string;
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

/** The solver's duty, in the words a campaign's solver reads where they are the same (`duty`,
 *  `src/solver/prompt.ts`). */
function duty(ask: Asked, guide: string | null): string {
  return [
    "Complete the task the first message gives with the available tools; the method is yours to choose.",
    "For source code or files, write complete working files, not fragments or descriptions.",
    "Your work is graded as the working directory and the files the task names stand when the task ends, by checks you cannot see; call submit when it is complete.",
    ...(guide !== null && CAMPAIGN_REF_RE.test(guide)
      ? [
          "This task has no input.json, public/ folder, or answer.json: the first message is the whole task, and the files you leave are the answer, whatever a guide says of them.",
        ]
      : []),
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

function submitTool(said: { submitted: boolean }): AgentTool {
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
  // The registry resolves the model by provider and id, compaction included, so keep the proxy URL there.
  models.setProvider({ ...provider, getModels: () => [model], getAllModels: () => [model] });
  return { model, models: () => models };
}

export function keyless(names: readonly string[]): Record<string, undefined> {
  return Object.fromEntries(names.filter((name) => CREDENTIAL.test(name)).map((name) => [name, undefined]));
}

async function solve(ask: Asked) {
  const cwd = runtimeProcess.cwd();
  const baseEnv = "solver" in ask.route ? keyless(Object.keys(runtimeProcess.env)) : {};
  const clock: SolveClock = { started: null, seconds: ask.wallSeconds };
  const harness = await openHarness(ask.harness).catch((error: unknown) => errorMessage(error));
  if (isString(harness)) return { ending: "broken-harness", reason: harness };
  // The harness's programs first on PATH, in the order a solve's shell has them.
  const path = harness.toolTree === null ? [] : toolTreeSearchDirs(harness.toolTree);
  const envScript = toolTreeEnv(harness.toolTree);
  const env = new NodeExecutionEnv({
    cwd,
    shellPath: "/bin/bash",
    shellEnv: { ...baseEnv, ...keyIfDefined("BASH_ENV", envScript) },
  });
  const prefix = path.length === 0 ? undefined : `export PATH=${shellQuote(path.join(":"))}:"$PATH"`;
  const said = { submitted: false };
  // In the order a campaign's solver is given them (`solverTools`, `src/solver/run.ts`).
  const defined = [...directCodingTools(selectedCodingTools(harness.presets), prefix), submitTool(said)];
  const programs = installedPrograms(harness.toolTree);
  const campaignBins = new Set(
    readHarnessFiles(ask.harness, [], []).campaignRefFiles.map((file) => basename(file)),
  );
  const visiblePrograms = programs.filter((name) => !campaignBins.has(name));
  const stripped = harness.guide === null ? "" : portableGuide(harness.guide);
  const guide = stripped.trim() === "" ? null : stripped;
  const programLine =
    visiblePrograms.length === 0
      ? ""
      : `\n- Programs this harness installed run by name: ${listedPrograms(visiblePrograms)}.`;
  const prompt = promptEnvelope({
    tools: defined,
    home: cwd,
    guide,
    addendum: duty(ask, guide),
    environment: `- Commands run in the task workspace with your working directory as cwd.${programLine}`,
  });
  const { route } = ask;
  const served: Served =
    "solver" in route
      ? {
          model: modelNamed(route.solver),
          models: (home, shutdown, seatCwd) => seatBackends(sweepOptions(home, undefined, shutdown, seatCwd)),
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
  // The dollar bound, as Claude Code's `--max-budget-usd`, on the turns' own dollars at list price.
  const budget = new AbortController();
  const bound = ask.budgetUsd ?? Infinity;
  const { thrown: crash, spent } = await runAgent({
    ...served,
    cwd,
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

function resolved(prefix: string | undefined, programs: readonly string[]): string {
  const each = programs.map(
    (name) => `command -v ${shellQuote(name)} || echo ${shellQuote(`missing: ${name}`)}`,
  );
  return decodeOutput(
    runSync(["bash", "-c", [...(prefix === undefined ? [] : [prefix]), ...each].join("; ")]).stdout,
  );
}

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
  const detail =
    "crash" in result && isString(result.crash)
      ? result.crash
      : "reason" in result && isString(result.reason)
        ? result.reason
        : null;
  if (detail !== null) console.error(`pi-solve: ${result.ending}: ${detail}`);
  console.log(`pi-solve: ${result.ending}`);
  runtimeProcess.exitCode = 0;
}
