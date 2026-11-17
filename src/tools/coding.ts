/**
 * Durable's coding tools, on the seat's ExecutionEnv (`walledEnv`). The environment owns every
 * file and command operation; registrations keep pi's descriptions and schemas except bash's
 * timeout, which states the host's default and maximum. pi's "Execute a bash command" holds as
 * written, since every seat command runs in the system's `/bin/bash` under the wall
 * (`src/tools/env.ts`). All calls are sequential because ending a command ends the work still
 * running in the seat's root. A command that names no timeout and is still running at the wall's
 * default seconds is handed back and runs on to the maximum; the seat's next call waits for it and
 * carries its ending, as a coding agent hands a long command to the background. A command that
 * names a timeout chose its wait, and runs to it in one call.
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
import { withAbortSignal, withoutAbortSignal } from "@earendil-works/chord/context";
import { Type } from "typebox";
import type { SeatTool } from "../agent/session.ts";
import { asError } from "../meta/runtime-values.ts";
import { type CommandWall, heldSeconds, runWalled } from "./command.ts";

/** A command handed back to its seat while it runs on: how it ended and its output's tail. */
const RUNNING = new WeakMap<CommandWall, Promise<string>>();
// The two limits and OutputBuffer (at the end) are pi-processes' (github.com/aliou/pi-processes, MIT),
// examples/bash-background.ts lines 22-23 and 47-69 at cce6ad98e, changed only for this repository's
// lint (a readonly `chunks`, the class after the declarations) and in the tail it keeps: pi's own bash
// output limit, read from the description pi writes from it, instead of 4,000 characters.
const MAX_CAPTURED_BYTES = 8 * 1024 * 1024;
const RESULT_TAIL_CHARS = 1024 * Number(/ (\d+)KB /u.exec(createBashTool().description)?.[1]);

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

/** A harness selects among pi's names. */
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

/** Submit still reads its bounded answer through one walled command, once a handed-back one ended. */
export function wallExec(wall: CommandWall): WallExec {
  return async (command, options = {}) => {
    await RUNNING.get(wall);
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
      execute: async (args, api, context) => {
        const ran = RUNNING.get(wall);
        RUNNING.delete(wall);
        if (ran !== undefined) api.diagnostic({ severity: "info", code: "ran_on", message: await ran });
        return await each.execute(args, api, context);
      },
    }));
}

/** What the command's own timeout allowed; the solve's earlier end has its own message. */
function timeoutClause(asked: number, seconds: number, { shellMaxSeconds }: CommandWall["limits"]): string {
  if (seconds < shellMaxSeconds) {
    return `\n\nThe host allows ${String(shellMaxSeconds)} s for one command, so there is more time to ask for.`;
  }
  if (asked > shellMaxSeconds) {
    return `\n\nYour ${String(asked)} s is above the ${String(shellMaxSeconds)} s the host allows one command, so it ran as ${String(seconds)} s, the most there is.`;
  }
  return `\n\nThat is the whole ${String(shellMaxSeconds)} s the host allows one command.`;
}

function bashTool(wall: CommandWall): SeatTool {
  const pi = createBashTool();
  const { shellDefaultSeconds: back, shellMaxSeconds } = wall.limits;
  return {
    ...pi,
    // The host's own schema: pi's command, and a timeout described by the limits the wall holds.
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({
          description: `Timeout in seconds: at most ${String(shellMaxSeconds)}, and that when omitted; without one, a command still running after ${String(back)} s is handed back to you and runs on`,
        }),
      ),
    }),
    execute: async (args: BashToolInput, api, context) => {
      const { asked, seconds, nearEnd } = heldSeconds(args.timeout ?? shellMaxSeconds, wall);
      // Durable refuses a settled call's api and cancels its context, so a handed-back command
      // runs on under its own signal and keeps what it prints from then on for the seat's next call;
      // what it printed before reached the seat with the hand-back.
      const tail = new OutputBuffer();
      let handedBack = false;
      const stop = new AbortController();
      context.abortSignal?.addEventListener("abort", () => handedBack || stop.abort());
      const own: typeof api = {
        ...api,
        output: (chunk, skipped) => {
          if (handedBack) tail.append(Buffer.from(chunk));
          else api.output(chunk, skipped);
        },
        retainedOutput: () => (handedBack ? { text: tail.tail(), truncated: false } : api.retainedOutput()),
        diagnostic: (note) => handedBack || api.diagnostic(note),
      };
      // runWalled applies the remaining solve time too; leave that reduction to its one owner.
      const run = pi
        .execute(
          { ...args, timeout: Math.min(Math.max(asked, back), shellMaxSeconds) },
          own,
          withAbortSignal(stop.signal, withoutAbortSignal(context)),
        )
        .catch((error: unknown) => {
          // Durable renders timeout errors from env.exec; command output cannot forge this exception.
          if (!asError(error).message.startsWith("Command timed out after ")) throw error;
          throw new Error(
            `Command timed out after ${String(seconds)} seconds${
              nearEnd ? NEAR_END : timeoutClause(asked, seconds, wall.limits)
            }`,
            { cause: error },
          );
        });
      const late = new Promise<undefined>((resolve) => {
        AbortSignal.timeout(back * 1000).addEventListener("abort", () => resolve(undefined));
      });
      const early =
        args.timeout === undefined && seconds > back ? await Promise.race([run, late]) : await run;
      if (early !== undefined) return early;
      handedBack = true;
      const ending = run.then(
        (done) => done.diagnostics?.map((note) => note.message).join("; ") ?? "exit code 0",
        (error: unknown) => asError(error).message,
      );
      RUNNING.set(
        wall,
        ending.then(
          (how) =>
            `The command handed back earlier has ended (${how}). What it printed since:\n${tail.tail()}`,
        ),
      );
      throw new Error(
        `Command still running after ${String(back)} seconds; it runs on for up to ${String(seconds)} seconds in all. Its later output and ending come with your next tool call, which waits for it to end.`,
      );
    },
  };
}

class OutputBuffer {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;

  append(data: Buffer): void {
    this.chunks.push(data);
    this.byteLength += data.length;
    while (this.byteLength > MAX_CAPTURED_BYTES && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      if (dropped) this.byteLength -= dropped.length;
    }
  }

  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }

  tail(): string {
    const text = this.bytes().toString("utf8").trim();
    if (text.length <= RESULT_TAIL_CHARS) return text;
    return `[...output truncated...]\n${text.slice(-RESULT_TAIL_CHARS)}`;
  }
}
