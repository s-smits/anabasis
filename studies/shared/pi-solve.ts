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
 * - the study's system prompt, with the harness's guide as project context under the
 *   sentence a campaign's solver reads, and a duty that names the benchmark's deliverable;
 * - the solve wall and the model-turn cap, told on every tool result by `timed`, the nudge after a
 *   turn that stops without `submit`, durable's compaction and retries, and OpenRouter as the
 *   backends serve it (`openrouter`, `src/agent/backends/models.ts`);
 * - the trace as `solve.turn`, `solve.call` and `solve.compacted` events in a log of its own,
 *   written by `sit` (`src/agent/session.ts`) and read by `src/kernel/trace.ts`, and the spend
 *   as `sit` sums a campaign's solve, so a change to the log's format has one owner to change;
 *   the same trace as Harbor's ATIF trajectory (`trajectoryOf`, `src/kernel/atif.ts`), where the
 *   benchmark's tools look for an agent's run, and the ending of a solve that left no answer as a
 *   campaign's solve is read (`unanswered`, `src/kernel/solve.ts`).
 *
 * The model is reached through the benchmark's own proxy on the host (`harbor/pi_agent.py`), so the
 * provider's key stays on the host and the container holds only the token that names its route.
 * The model keeps its entry and its prices as the backends serve them, and only its URL changes.
 *
 * With `--dry-run` it does everything but call the model: it opens the harness, composes the
 * system prompt, runs `command -v` for each installed program through the solver's own shell and
 * writes both to the result, so the study's check stage proves the path in the container for free.
 *
 * A harness that declares its own tools (`agent/tools.ts`) is refused: no harness kept on record
 * declared one on 21 October 2026 (0 of 193), and serving them would need the harness shim.
 */
import { type AssistantMessage, createModels, type ThinkingLevel } from "@earendil-works/pi-ai";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { Type } from "typebox";
import { openrouter } from "#src/agent/backends/models.ts";
import { trajectoryOf } from "#src/kernel/atif.ts";
import { read } from "#src/kernel/log.ts";
import { unanswered } from "#src/kernel/solve.ts";
import { GUIDE_FILE } from "#src/meta/bundle-layout.ts";
import { readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { selectedCodingTools } from "#src/tools/coding.ts";
import { ending, text, tool } from "#src/tools/answer.ts";
import type { SolveClock } from "#src/tools/command.ts";
import { openHarness } from "#src/harness/open.ts";
import { installedPrograms } from "#src/harness/programs.ts";
import { NUDGE } from "#src/solver/prompt.ts";
import { raiseWall, timed, type Wall } from "#src/solver/run.ts";
import { type SeatTool, sit } from "#src/agent/session.ts";
import { shellQuote, toolTreeSearchDirs } from "#src/wall/isolation.ts";

/** The file names the Harbor agent reads back from the trial's log folder (`harbor/pi_agent.py`). */
export const TRACE_FILE = "pi-log.jsonl";
export const RESULT_FILE = "pi-result.json";

const OPTIONS = {
  harness: { type: "string" },
  instruction: { type: "string" },
  model: { type: "string" },
  "base-url": { type: "string" },
  key: { type: "string" },
  effort: { type: "string" },
  "model-turns": { type: "string" },
  "wall-minutes": { type: "string" },
  prompts: { type: "string" },
  logs: { type: "string" },
  "dry-run": { type: "boolean" },
} as const;

/** How a solve ended: an answer, a crash, or the kernel's word for a solve that left none. */
type Ending = "submitted" | "crash" | ReturnType<typeof unanswered>["kind"];

interface Asked {
  readonly harness: string;
  readonly instruction: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly key: string;
  readonly effort: ThinkingLevel;
  readonly modelTurns: number;
  readonly wallSeconds: number;
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
  return {
    harness: need("harness"),
    instruction: readFileSync(need("instruction"), "utf8"),
    model: need("model"),
    baseUrl: need("base-url"),
    key: need("key"),
    // SAFETY: pi refuses a level its catalogue entry does not map, on the first call.
    effort: need("effort") as ThinkingLevel,
    modelTurns: count("model-turns"),
    wallSeconds: count("wall-minutes") * 60,
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
    `The case has ${String(Math.round(ask.wallSeconds / 60))} minutes of solve time and ${String(ask.modelTurns)} turns of yours, a turn being one reply of yours with the tool calls in it. Every tool result ends with how much of both is used. When either runs out the task ends with the files as they stand.`,
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

async function solve(ask: Asked) {
  const cwd = runtimeProcess.cwd();
  const harness = await openHarness(ask.harness);
  if (harness.kinds.size > 0) {
    throw new Error(
      `the harness declares tools of its own (${[...harness.kinds.keys()].join(", ")}), which this solver does not serve`,
    );
  }
  const path = harness.toolTree === null ? [] : toolTreeSearchDirs(harness.toolTree);
  const prefix = path.length === 0 ? undefined : `export PATH=${shellQuote(path.join(":"))}:"$PATH"`;
  const coding = {
    read: createReadTool(),
    bash: createBashTool(prefix === undefined ? {} : { commandPrefix: prefix }),
    edit: createEditTool(),
    write: createWriteTool(),
  } satisfies Record<string, SeatTool>;
  const said = { submitted: false };
  const defined = [
    ...selectedCodingTools(harness.presets).flatMap((name) => coding[name] ?? []),
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
  const provider = openrouter();
  const listed = provider.getModels().find(({ id }) => id === ask.model);
  if (listed === undefined) throw new Error(`OpenRouter as the backends serve it has no ${ask.model}`);
  if (ask.dryRun) {
    return { ending: "dry-run", harness: harness.digest, prompt, found: resolved(prefix, programs) };
  }
  const model = { ...listed, baseUrl: ask.baseUrl };
  const models = createModels({
    authContext: {
      env: async (name) => (name === "OPENROUTER_API_KEY" ? ask.key : undefined),
      fileExists: async () => false,
    },
  });
  // sit resolves the model by provider and id, including for compaction; keep the proxy URL there.
  models.setProvider({ ...provider, getModels: () => [model], getAllModels: () => [model] });
  const turns: AssistantMessage[] = [];
  const started = performance.now();
  const clock: SolveClock = { started, seconds: ask.wallSeconds };
  const wall = raiseWall(ask.wallSeconds);
  const tools = defined.map((entry) =>
    timed(entry, { clock, turns: () => turns.length, modelTurns: ask.modelTurns }),
  );
  const log = join(ask.logs, TRACE_FILE);
  let prompts = 1;
  const { thrown: crash, spent } = await sit({
    models: () => models,
    id: "pi-solve",
    model,
    effort: ask.effort,
    system: prompt,
    opening: ask.instruction,
    tools,
    // The benchmark's container is this seat's wall; this adapter runs only inside that container.
    env: new NodeExecutionEnv({ cwd }),
    trace: { log, of: "solve" },
    turns,
    most: ask.modelTurns,
    onTurn: wall.onTurn,
    onTool: wall.onTool,
    over: () => said.submitted,
    next: async () => {
      if (said.submitted || prompts >= ask.prompts) return null;
      prompts += 1;
      return NUDGE;
    },
    stops: [wall.signal],
  });
  wall.lower();
  // Harbor's viewer and `harbor analyze` read an agent's run from `agent/trajectory.json`.
  const trajectory = trajectoryOf(read(log), "solve", "pi-solve", {
    name: "anabasis",
    version: harness.digest,
    model: ask.model,
  });
  writeFileSync(join(ask.logs, "trajectory.json"), `${capturedJsonStringify(trajectory, null, 2)}\n`);
  return {
    ending: endingOf({ crash, submitted: said.submitted, wall, turns, ask }),
    crash,
    harness: harness.digest,
    model: ask.model,
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
  wall: Wall;
  turns: readonly AssistantMessage[];
  ask: Asked;
}): Ending {
  if (played.crash !== null) return "crash";
  if (played.submitted) return "submitted";
  const turnsEnded = played.turns.length >= played.ask.modelTurns;
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
