import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import {
  type BashToolInput,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
} from "@earendil-works/pi-durable/tools";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { Type } from "typebox";
import type { AgentTool } from "../agent/session.ts";
import { asError } from "../meta/runtime-values.ts";
import { type CommandSandbox, heldSeconds, runSandboxed } from "./command.ts";

export const CODING_TOOLS = ["read", "bash", "edit", "write"] as const;
type CodingTool = (typeof CODING_TOOLS)[number];

export type WallExec = (
  command: string,
  options?: { readonly stage?: (into: string) => void; readonly signal?: AbortSignal | undefined },
) => Promise<{ exitCode: number | null; output: Buffer }>;

let photon: Promise<ImageProcessor> | undefined;
const images: ImageProcessor = {
  prepare: async (bytes, mimeType, limits) =>
    (await (photon ??= createNodePhotonImages())).prepare(bytes, mimeType, limits),
};

export async function prepareImage(
  bytes: Uint8Array,
  path: string,
  model: Pick<Model<Api>, "input" | "inputLimits">,
): Promise<ImageContent | null> {
  const [mimeType = ""] = Bun.file(path).type.split(";");
  if (!model.input.includes("image") || !mimeType.startsWith("image/")) return null;
  const resize = model.inputLimits?.images?.resize;
  const prepared = await images.prepare(bytes, mimeType, {
    maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
    maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
    maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
  });
  return prepared === undefined ? null : { type: "image", data: prepared.data, mimeType: prepared.mimeType };
}

const NEAR_END =
  "\n\nThe command was cut because the solve's time is nearly up, so that its result reaches you while you can still act on it.";

export function selectedCodingTools(presets: readonly string[]): CodingTool[] {
  const served: readonly string[] = CODING_TOOLS;
  const other = presets.filter((name) => !served.includes(name));
  if (other.length > 0) {
    throw new Error(
      `a solve serves pi's coding tools as presets (${CODING_TOOLS.join(", ")}), not ${other.join(", ")}`,
    );
  }
  return CODING_TOOLS.filter((name) => presets.includes(name));
}

export function wallExec(wall: CommandSandbox): WallExec {
  return async (command, options = {}) => {
    const chunks: Buffer[] = [];
    const { exitCode } = await runSandboxed(wall, command, {
      ...options,
      onData: (data) => chunks.push(data),
    });
    return { exitCode, output: Buffer.concat(chunks) };
  };
}

function assembleCodingTools(bash: AgentTool, selected: readonly CodingTool[]): AgentTool[] {
  const wanted = new Set<string>(selected);
  const tools: AgentTool[] = [createReadTool({ images }), bash, createEditTool(), createWriteTool()];
  return tools
    .filter((each) => wanted.has(each.name))
    .map((each) => ({ ...each, executionMode: "sequential" }));
}

export function codingTools(wall: CommandSandbox, selected: readonly CodingTool[]): AgentTool[] {
  return assembleCodingTools(bashTool(wall), selected);
}

export function directCodingTools(selected: readonly CodingTool[], commandPrefix?: string): AgentTool[] {
  return assembleCodingTools(createBashTool(commandPrefix === undefined ? {} : { commandPrefix }), selected);
}

function timeoutClause(
  asked: number,
  seconds: number,
  { shellDefaultSeconds, shellMaxSeconds }: CommandSandbox["limits"],
): string {
  if (seconds < shellMaxSeconds) {
    return `\n\nThe host allows ${String(shellMaxSeconds)} s for one command, and ${String(shellDefaultSeconds)} s when you pass none, so there is more time to ask for.`;
  }
  if (asked > shellMaxSeconds) {
    return `\n\nYour ${String(asked)} s is above the ${String(shellMaxSeconds)} s the host allows one command, so it ran as ${String(seconds)} s, the most there is.`;
  }
  return `\n\nThat is the whole ${String(shellMaxSeconds)} s the host allows one command.`;
}

function bashTool(wall: CommandSandbox): AgentTool {
  const pi = createBashTool();
  return {
    ...pi,
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({
          description: `Timeout in seconds: ${String(wall.limits.shellDefaultSeconds)} when omitted, at most ${String(wall.limits.shellMaxSeconds)}; a value outside that range runs at the nearest end of it`,
        }),
      ),
    }),
    execute: async (args: BashToolInput, api, context) => {
      const { asked, seconds, nearEnd } = heldSeconds(args.timeout, wall);
      try {
        return await pi.execute(
          {
            ...args,
            timeout: Math.min(Math.max(asked, wall.limits.shellDefaultSeconds), wall.limits.shellMaxSeconds),
          },
          api,
          context,
        );
      } catch (error) {
        const cause = asError(error);
        if (!cause.message.startsWith("Command timed out after ")) throw error;
        throw new Error(
          `Command timed out after ${String(seconds)} seconds${
            nearEnd ? NEAR_END : timeoutClause(asked, seconds, wall.limits)
          }`,
          { cause: error },
        );
      }
    },
  };
}
