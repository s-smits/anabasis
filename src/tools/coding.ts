/**
 * Durable's coding tools, on the seat's ExecutionEnv (`walledEnv`). The environment owns every
 * file and command operation; registrations keep pi's descriptions and schemas except bash's
 * shell contract, which states /bin/sh and POSIX syntax, and its timeout, which states the host's
 * default and maximum. All calls are sequential because ending a command ends the work still
 * running in the seat's root.
 *
 * The wall keeps two departures from pi's local environment: ~ names the seat's home, and a
 * whole-file read is capped at 16 MiB. Durable asks the environment to spill long shell output;
 * walledEnv keeps it in the seat's TMPDIR, through the wall, including on timeout or abort.
 * A timeout gains the host's limits, or the solve-end reserve that cut it, as before migration.
 *
 * `read` prepares images with Photon, as pi's coding agent did before the migration: without it,
 * durable refuses a BMP and an image above its size limits instead of converting or resizing it
 * (22 October). One Photon worker is started on the first image and shared by every seat.
 */
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import type { BashToolInput, ImageProcessor } from "@earendil-works/pi-durable/tools";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { Type } from "typebox";
import type { SeatTool } from "../agent/session.ts";
import { asError } from "../meta/runtime-values.ts";
import { type CommandWall, heldSeconds, runWalled } from "./command.ts";

/** The order pi lists its coding tools. */
export const CODING_TOOLS = ["read", "bash", "edit", "write"] as const;
type CodingTool = (typeof CODING_TOOLS)[number];

/** The bounded command output submit reads, without a host-side filesystem read. */
export type WallExec = (
  command: string,
  options?: { readonly stage?: (into: string) => void; readonly signal?: AbortSignal | undefined },
) => Promise<{ exitCode: number | null; output: Buffer }>;

let photon: Promise<ImageProcessor> | undefined;
const images: ImageProcessor = {
  prepare: async (bytes, mimeType, limits) =>
    (await (photon ??= createNodePhotonImages())).prepare(bytes, mimeType, limits),
};

const NEAR_END =
  "\n\nThe command was cut because the solve's time is nearly up, so that its result reaches you while you can still act on it.";

/** A harness selects among pi's names; an older kept harness's shell preset means bash. */
export function selectedCodingTools(presets: readonly string[]): CodingTool[] {
  const named = presets.map((preset) => (preset === "shell" ? "bash" : preset));
  const served: readonly string[] = CODING_TOOLS;
  const other = named.filter((name) => !served.includes(name));
  if (other.length > 0) {
    throw new Error(
      `a solve serves pi's coding tools as presets (${CODING_TOOLS.join(", ")}), not ${other.join(", ")}`,
    );
  }
  return CODING_TOOLS.filter((name) => named.includes(name));
}

/** Submit still reads its bounded answer through one walled command. */
export function wallExec(wall: CommandWall): WallExec {
  return async (command, options = {}) => {
    const chunks: Buffer[] = [];
    const { exitCode } = await runWalled(wall, command, { ...options, onData: (data) => chunks.push(data) });
    return { exitCode, output: Buffer.concat(chunks) };
  };
}

/** Selected registrations, in pi's order; the seat supplies their walled api.env. */
export function codingTools(wall: CommandWall, selected: readonly CodingTool[]): SeatTool[] {
  const wanted = new Set<string>(selected);
  const tools: SeatTool[] = [createReadTool({ images }), bashTool(wall), createEditTool(), createWriteTool()];
  return tools
    .filter((each) => wanted.has(each.name))
    .map((each) => ({
      ...each,
      executionMode: "sequential",
    }));
}

/** What the command's own timeout allowed; the solve's earlier end has its own message. */
function timeoutClause(
  asked: number,
  seconds: number,
  { shellDefaultSeconds, shellMaxSeconds }: CommandWall["limits"],
): string {
  if (seconds < shellMaxSeconds) {
    return `\n\nThe host allows ${String(shellMaxSeconds)} s for one command, and ${String(shellDefaultSeconds)} s when you pass none, so there is more time to ask for.`;
  }
  if (asked > shellMaxSeconds) {
    return `\n\nYour ${String(asked)} s is above the ${String(shellMaxSeconds)} s the host allows one command, so it ran as ${String(seconds)} s, the most there is.`;
  }
  return `\n\nThat is the whole ${String(shellMaxSeconds)} s the host allows one command.`;
}

function bashTool(wall: CommandWall): SeatTool {
  const pi = createBashTool();
  return {
    ...pi,
    // pi's own sentence names bash; the worker runs /bin/sh, so the language clause is replaced and
    // pi's output and truncation facts are kept as pi computes them.
    description: pi.description.replace(
      "Execute a bash command in the current working directory.",
      "Execute a command using /bin/sh in the current working directory. Use POSIX shell syntax; Bash extensions are not guaranteed.",
    ),
    parameters: Type.Object({
      command: Type.String({ description: "Command to execute with /bin/sh (POSIX shell syntax)" }),
      timeout: Type.Optional(
        Type.Number({
          description: `Timeout in seconds: ${String(wall.limits.shellDefaultSeconds)} when omitted, at most ${String(wall.limits.shellMaxSeconds)}; a value outside that range runs at the nearest end of it`,
        }),
      ),
    }),
    executionMode: "sequential",
    execute: async (args: BashToolInput, api, context) => {
      const { asked, seconds, nearEnd } = heldSeconds(args.timeout, wall);
      // runWalled applies the remaining solve time too; leave that reduction to its one owner.
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
        // Durable renders timeout errors from env.exec; command output cannot forge this exception.
        if (!cause.message.startsWith("Command timed out after ")) throw error;
        throw new Error(
          `Command timed out after ${String(seconds)} seconds` +
            (nearEnd ? NEAR_END : timeoutClause(asked, seconds, wall.limits)),
          { cause: error },
        );
      }
    },
  };
}
