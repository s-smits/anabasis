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
 *   turn that stops without `submit`, and the backend a campaign's solve runs on, its compaction and
 *   retries with it: OpenRouter as the backends serve it (`openrouter`, `src/agent/backends/models.ts`),
 *   or, with `--provider claude` (a Claude Code login) or `claude-api` (an API key), Claude Code
 *   through the production Claude backend (`claudeProvider`, `src/agent/backends/claude.ts`);
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
 * On Claude Code, Claude Code is the transport and nothing more: this loop, its prompt and its tools
 * stay pi's, one pi turn is one API message, and pi's tools reach the model through the backend's
 * MCP server. The CLI's own tools are off (`webSearch: false`, so its `tools` option is empty), so a
 * Claude arm gains no Bash, Read, Edit, WebSearch or any other tool of Claude Code's that the
 * benchmark's other arms lack. The CLI is the one `--claude` names, built for the container's
 * platform, and the route's token stands where Claude Code reads its credential: the login's
 * `Authorization: Bearer` or the API key's `x-api-key`, both of which the proxy reads as the route
 * and replaces with the provider's credential on the host.
 *
 * With `--dry-run` it does everything but call the model: it opens the harness, composes the
 * system prompt, runs `command -v` for each installed program through the solver's own shell, asks
 * the arm's Claude Code its version where the solve runs on it, and writes all of it to the result,
 * so the study's check stage proves the path in the container for free.
 *
 * A harness that declares its own tools (`agent/tools.ts`) is refused: no harness kept on record
 * declared one on 21 October 2026 (0 of 193), and serving them would need the harness shim.
 */
import {
  type AssistantMessage,
  createModels,
  type Provider,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { Type } from "typebox";
import { claudeProvider, servedByClaude, SWEEP_COMPACT_WINDOW } from "#src/agent/backends/claude.ts";
import { openrouter } from "#src/agent/backends/models.ts";
import { trajectoryOf } from "#src/kernel/atif.ts";
import { read } from "#src/kernel/log.ts";
import { unanswered } from "#src/kernel/solve.ts";
import { GUIDE_FILE } from "#src/meta/bundle-layout.ts";
import { readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
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
/** The provider a solve runs on where `--provider` names none. */
const OPENROUTER = "openrouter";

const OPTIONS = {
  harness: { type: "string" },
  instruction: { type: "string" },
  model: { type: "string" },
  provider: { type: "string", default: OPENROUTER },
  claude: { type: "string" },
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
  /** OpenRouter, or Claude Code's account: a login or an API key, either of which is here the
   *  route's token. */
  readonly provider: string;
  /** The Claude Code binary a solve on Claude Code runs; null on OpenRouter. */
  readonly claude: string | null;
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
  const need = (name: Exclude<keyof typeof OPTIONS, "dry-run" | "provider">) => {
    const value = values[name];
    if (value === undefined || value === "") throw new Error(`pi-solve needs --${name}`);
    return value;
  };
  const count = (name: Exclude<keyof typeof OPTIONS, "dry-run" | "provider">) => {
    const value = Number(need(name));
    if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} is a whole number above 0`);
    return value;
  };
  const { provider } = values;
  if (provider !== OPENROUTER && !servedByClaude(provider)) {
    throw new Error(`--provider is ${OPENROUTER} or a Claude Code account, not ${provider}`);
  }
  return {
    harness: need("harness"),
    instruction: readFileSync(need("instruction"), "utf8"),
    model: need("model"),
    provider,
    claude: provider === OPENROUTER ? null : need("claude"),
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
  // Only the catalogue is read here; Claude Code's home is the seat's own (`sit`).
  const listed = served(ask, { home: cwd })
    .getModels()
    .find(({ id }) => id === ask.model);
  if (listed === undefined) throw new Error(`${ask.provider} as the backends serve it has no ${ask.model}`);
  if (ask.dryRun) {
    // Proof, calling no model, that the arm's Claude Code runs in the container: its version.
    const version = ask.claude === null ? null : runSync([ask.claude, "--version"]);
    return {
      ending: "dry-run",
      harness: harness.digest,
      prompt,
      found: resolved(prefix, programs),
      ...keyIfDefined(
        "claude",
        version === null
          ? undefined
          : decodeOutput(version.exitCode === 0 ? version.stdout : version.stderr).trim(),
      ),
    };
  }
  const model = { ...listed, baseUrl: ask.baseUrl };
  // The solve holds one key, the route's token, under whichever variable its provider reads.
  const models = createModels({ authContext: { env: async () => ask.key, fileExists: async () => false } });
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
    // sit resolves the model by provider and id, including for compaction; keep the proxy URL there.
    models: (home, shutdown) => {
      const provider = served(ask, { home, shutdown });
      models.setProvider({ ...provider, getModels: () => [model], getAllModels: () => [model] });
      return models;
    },
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
    provider: ask.provider,
    model: ask.model,
    effort: ask.effort,
    prompts,
    seconds: (performance.now() - started) / 1000,
    ...spent,
  };
}

/**
 * The provider of the solve's model: OpenRouter as the backends serve it, or Claude Code on the
 * account `--provider` names as a campaign's solve runs it (its compaction window, its own HOME), with the
 * CLI's own tools off and its requests sent to the proxy at `--base-url`.
 */
function served(ask: Asked, seat: { readonly home: string; readonly shutdown?: AbortSignal }): Provider {
  if (ask.claude === null) return openrouter();
  return claudeProvider(
    {
      executable: ask.claude,
      compaction: { window: SWEEP_COMPACT_WINDOW },
      home: seat.home,
      webSearch: false,
      baseUrl: ask.baseUrl,
      shutdown: seat.shutdown,
    },
    ask.provider,
  );
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
