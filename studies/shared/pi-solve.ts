/**
 * One solve of a benchmark task by an Anabasis harness, inside the benchmark's own container: the
 * study's counterpart of `play()` (`src/solve/run.ts`), for a benchmark that grades the container's
 * state after the agent exits instead of an `answer.json` checked by a contract.
 *
 * `play()` cannot run there: it is bound to a campaign's log, to Seatbelt or Bubblewrap and to a
 * claimed seat root, and the container is itself the sandbox. So this is the same loop over the
 * same parts, with the command wall taken out:
 * - pi's coding tools as the harness's presets select them (`selectedCodingTools`), on pi's local
 *   operations in the container's working directory, with the harness's `.toolchain` first on PATH
 *   in the order a solve's shell has it (`toolTreeSearchDirs`);
 * - pi's system prompt from pi's builder, with the harness's guide as project context under the
 *   sentence a campaign's solver reads, and a duty that names the benchmark's deliverable;
 * - the solve wall and the model-turn cap, told on every tool result by `timed`, the nudge after a
 *   turn that stops without `submit`, pi's compaction, and the retried OpenRouter provider;
 * - the trace as `solve.turn`, `solve.call` and `solve.compacted` events in a log of its own,
 *   written by `traceSink` and `loopCompaction` and read by `src/kernel/trace.ts`, and the spend
 *   as `spentBy` sums a campaign's solve, so a change to the log's format has one owner to change;
 *   the same trace as Harbor's ATIF trajectory (`trajectoryOf`, `src/kernel/atif.ts`), where the
 *   benchmark's tools look for an agent's run, and the ending of a solve that left no answer as a
 *   campaign's solve is read (`unanswered`, `src/kernel/solve.ts`).
 *
 * The model is reached through the benchmark's own proxy on the host (`harbor/pi_agent.py`), so the
 * provider's key stays on the host and the container holds only the token that names its route.
 * The model keeps pi's catalogue entry and its prices, and only its URL changes.
 *
 * With `--dry-run` it does everything but call the model: it opens the harness, composes the
 * system prompt, runs `command -v` for each installed program through the solver's own shell and
 * writes both to the result, so the study's check stage proves the path in the container for free.
 *
 * A harness that declares its own tools (`agent/tools.ts`) is refused: no harness kept on record
 * declared one on 21 October 2026 (0 of 193), and serving them would need the harness shim.
 */
import { type AgentMessage, runAgentLoop, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  createInitialSystemMessage,
  type ThinkingLevel,
  toToolDeclaration,
  type Usage,
} from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { Type } from "typebox";
import type { ToolDefinition } from "../../vendor/pi-coding-agent/core/extensions/types.ts";
import { buildSystemPrompt } from "../../vendor/pi-coding-agent/core/system-prompt.ts";
import { createBashToolDefinition } from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import { createEditToolDefinition } from "../../vendor/pi-coding-agent/core/tools/edit.ts";
import { createReadToolDefinition } from "../../vendor/pi-coding-agent/core/tools/read.ts";
import { wrapToolDefinitions } from "../../vendor/pi-coding-agent/core/tools/tool-definition-wrapper.ts";
import { createWriteToolDefinition } from "../../vendor/pi-coding-agent/core/tools/write.ts";
import { retried } from "#src/backends/models.ts";
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
import { selectedCodingTools } from "#src/solve/coding-tools.ts";
import type { SolveClock } from "#src/solve/command.ts";
import { openHarness } from "#src/solve/harness.ts";
import { installedPrograms } from "#src/solve/programs.ts";
import { NUDGE } from "#src/solve/prompt.ts";
import { timed } from "#src/solve/run.ts";
import { loopCompaction, spentBy, traceSink } from "#src/solve/seat.ts";
import { shellQuote, toolTreeSearchDirs } from "#src/verify/solve-command-isolation.ts";

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
 *  where they are the same (`duty`, `src/solve/prompt.ts`). */
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

function submitTool(said: { submitted: boolean }): ToolDefinition {
  return {
    name: "submit",
    label: "Submit",
    description: "End the task: the working directory and the files the task names are graded as they stand.",
    promptSnippet: "End the task once the work is complete",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async () => {
      said.submitted = true;
      return { content: [{ type: "text", text: "Submitted." }], details: null, terminate: true };
    },
  };
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
    read: createReadToolDefinition(cwd),
    bash: createBashToolDefinition(cwd, prefix === undefined ? {} : { commandPrefix: prefix }),
    edit: createEditToolDefinition(cwd),
    write: createWriteToolDefinition(cwd),
  } satisfies Record<string, ToolDefinition>;
  const said = { submitted: false };
  const defined = [
    ...selectedCodingTools(harness.presets).flatMap((name) => coding[name] ?? []),
    submitTool(said),
  ];
  const programs = installedPrograms(harness.toolTree);
  const prompt = buildSystemPrompt({
    cwd,
    selectedTools: defined.map(({ name }) => name),
    toolSnippets: Object.fromEntries(defined.map(({ name, promptSnippet }) => [name, promptSnippet ?? ""])),
    toolGuidelines: Object.fromEntries(
      defined.map(({ name, promptGuidelines }) => [name, [...(promptGuidelines ?? [])]]),
    ),
    appendSystemPrompt: duty(ask, harness.guide),
    contextFiles: harness.guide === null ? [] : [{ path: GUIDE_FILE, content: harness.guide }],
    sections:
      programs.length === 0
        ? {}
        : { environment: `- Programs this harness installed run by name: ${programs.join(", ")}.` },
  });
  const provider = retried(openrouterProvider());
  const listed = provider.getModels().find(({ id }) => id === ask.model);
  if (listed === undefined) throw new Error(`pi's OpenRouter catalogue has no ${ask.model}`);
  if (ask.dryRun) {
    return { ending: "dry-run", harness: harness.digest, prompt, found: resolved(prefix, programs) };
  }
  const model = { ...listed, baseUrl: ask.baseUrl };
  // The loop and its compaction ask for the one model they were given, so the stream sends that.
  const stream: StreamFn = (_asking, context, options) =>
    provider.streamSimple(model, context, { ...options, apiKey: ask.key });
  const turns: AssistantMessage[] = [];
  const summaries: Usage[] = [];
  const started = performance.now();
  const clock: SolveClock = { started, seconds: ask.wallSeconds };
  const tools = wrapToolDefinitions(
    defined.map((tool) => timed(tool, { clock, turns: () => turns.length, modelTurns: ask.modelTurns })),
  );
  const system = createInitialSystemMessage(prompt, tools.map(toToolDeclaration));
  const log = join(ask.logs, TRACE_FILE);
  const wall = new AbortController();
  const timer = setTimeout(() => wall.abort(), ask.wallSeconds * 1000);
  const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
  let prompts = 1;
  let crash: string | null = null;
  try {
    await runAgentLoop(
      [user(ask.instruction)],
      { messages: system === undefined ? [] : [system], tools },
      {
        model,
        reasoning: ask.effort,
        sessionId: "pi-solve",
        convertToLlm: (messages) => messages,
        toolExecution: "sequential",
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          return turns.length >= ask.modelTurns || said.submitted ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => {
          if (said.submitted || prompts >= ask.prompts) return [];
          prompts += 1;
          return [user(NUDGE)];
        },
        prepareRequest: loopCompaction(log, "solve", "pi-solve", stream, summaries),
      },
      traceSink(log, "solve", "pi-solve", () => turns.length),
      wall.signal,
      stream,
    );
  } catch (error) {
    crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
  }
  // Harbor's viewer and `harbor analyze` read an agent's run from `agent/trajectory.json`.
  const trajectory = trajectoryOf(read(log), "solve", "pi-solve", {
    name: "anabasis",
    version: harness.digest,
    model: ask.model,
  });
  writeFileSync(join(ask.logs, "trajectory.json"), `${capturedJsonStringify(trajectory, null, 2)}\n`);
  return {
    ending: endingOf({ crash, submitted: said.submitted, wallEnded: wall.signal.aborted, turns, ask }),
    crash,
    harness: harness.digest,
    model: ask.model,
    effort: ask.effort,
    prompts,
    seconds: (performance.now() - started) / 1000,
    ...(await spentBy(model, "pi-solve", turns, summaries)),
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
  wallEnded: boolean;
  turns: readonly AssistantMessage[];
  ask: Asked;
}): Ending {
  if (played.crash !== null) return "crash";
  if (played.submitted) return "submitted";
  const turnsEnded = played.turns.length >= played.ask.modelTurns;
  return unanswered({ wallEnded: played.wallEnded, turnsEnded, last: played.turns.at(-1) }).kind;
}

if (import.meta.main) {
  const ask = asked(Bun.argv.slice(2));
  const result = await solve(ask).catch((error: unknown) => ({
    ending: "crash",
    crash: errorMessage(error),
  }));
  writeFileSync(join(ask.logs, RESULT_FILE), `${capturedJsonStringify(result, null, 2)}\n`);
  console.log(`pi-solve: ${String(result.ending)}`);
  runtimeProcess.exitCode = 0;
}
