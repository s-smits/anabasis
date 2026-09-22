/**
 * A scripted Builder runtime for the build-stage interface (`HarnessBuildOptions.builderRuntime`).
 *
 * The session it opens is the one stub: every turn hands the script the real roster the campaign
 * composed (submit, correctness_check, harness_inspect, harness_trial and the mounted file tools
 * when a mount is supplied), so a script edits the workspace and calls `submit` exactly the way a
 * model would, and everything after that call is production: candidate validation, the census,
 * solvability, adoption and the retained product version. Both the whole-loop warranty and the
 * simulation runner bind it; neither reaches a provider.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { WORKSPACE_DIR } from "../../src/author/builder-memory.ts";
import type { AgentTurnEvent, AgentTurnResult } from "../../src/backends/backend-types.ts";
import type { HostSession, PiTool } from "../../src/backends/pi-session.ts";
import type { JsonValue } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";
import type { BuilderRuntimeFactory } from "../../src/run/builder-runtime.ts";
import { double, scriptedSession } from "./doubles.ts";

export interface ScriptedTurnContext {
  repoRoot: string;
  campaignDir: string;
  workspace: string;
  /** One-based turn ordinal within the round, which a kept session starts again at one. */
  turn: number;
  prompt: string;
  systemPrompt: string;
  /** Names of every tool the campaign composed for this session. */
  toolNames: string[];
  /** Execute one roster tool by name with the arguments a model would send. */
  call(name: string, params: Record<string, JsonValue>): ReturnType<AgentTool["execute"]>;
}

/** Returns the assistant text for the turn; a void return reads as an empty message. */
export type ScriptedTurn = (context: ScriptedTurnContext) => Promise<string | void> | string | void;

export interface ScriptedRuntimeOptions {
  /** Mounted tools to compose beside the controller tools; default none. */
  tools?: PiTool[];
  webSearch?: boolean;
}

function rosterOf(tools: readonly PiTool[]): Map<string, AgentTool> {
  const roster = new Map<string, AgentTool>();
  for (const tool of tools) {
    const agentTool = double<AgentTool>(tool);
    roster.set(agentTool.name, agentTool);
  }
  return roster;
}

/** Bind a script as the Builder runtime: `buildHarness(manifest, { builderRuntime })`. */
export function scriptedBuilderRuntime(
  script: ScriptedTurn,
  options: ScriptedRuntimeOptions = {},
): BuilderRuntimeFactory {
  // The factory runs once per round. The run's Builder conversation may keep one session across
  // rounds, so a turn reads the round open now: its campaign directory and its own turn count.
  let round = { repoRoot: "", campaignDir: "", turn: 0 };
  return async (_manifest, _options, repoRoot, campaignDir) => {
    round = { repoRoot, campaignDir, turn: 0 };
    return {
      tools: options.tools ?? [],
      webSearch: options.webSearch ?? false,
      open: async (tools, systemPrompt): Promise<HostSession> => {
        // A continued conversation configures the next round's roster and framing on this session.
        let roster = rosterOf(tools);
        let framing = systemPrompt;
        return scriptedSession(
          async ({ prompt, onEvent }): Promise<AgentTurnResult> => {
            round.turn += 1;
            const { turn } = round;
            const byName: Record<string, number> = {};
            const failedByName: Record<string, number> = {};
            const emit = (event: AgentTurnEvent) => onEvent?.(event);
            emit({ type: "turn_started" });
            const call = async (name: string, params: Record<string, JsonValue>) => {
              const tool = roster.get(name);
              if (tool === undefined) {
                throw new Error(`scripted turn called "${name}", which the campaign roster does not carry`);
              }
              byName[name] = (byName[name] ?? 0) + 1;
              emit({ type: "tool_started", toolName: name, args: params });
              try {
                // The roster's own parameter schema is not read here; the script states the arguments.
                const result = await tool.execute(`scripted-${turn}-${name}`, double(params));
                emit({ type: "tool_ended", toolName: name, isError: false, args: params });
                return result;
              } catch (cause) {
                failedByName[name] = (failedByName[name] ?? 0) + 1;
                emit({ type: "tool_ended", toolName: name, isError: true, args: params });
                throw cause;
              }
            };
            const text =
              (await script({
                repoRoot: round.repoRoot,
                campaignDir: round.campaignDir,
                workspace: join(round.campaignDir, WORKSPACE_DIR),
                turn,
                prompt,
                systemPrompt: framing,
                toolNames: [...roster.keys()],
                call,
              })) ?? "";
            emit({ type: "message_text", text });
            emit({ type: "turn_ended", stopReason: "end_turn" });
            const total = Object.values(byName).reduce((sum, count) => sum + count, 0);
            const failed = Object.values(failedByName).reduce((sum, count) => sum + count, 0);
            return {
              status: "completed",
              assistantText: text,
              stopReason: "end_turn",
              toolCalls: { byName, failedByName, failed, total },
            };
          },
          undefined,
          (next, nextFraming) => {
            roster = rosterOf(next);
            framing = nextFraming;
          },
        );
      },
    };
  };
}
