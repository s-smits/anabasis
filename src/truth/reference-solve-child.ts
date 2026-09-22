/**
 * Confined reference-solve wire. The bundled loader contains only the public reference package;
 * the parent witnesses the confined pid before sending one committed public task.
 * Generated diagnostics go to stderr for bounded operator evidence and never enter the response.
 */

import { lockJsonGlobals, parseJsonAs } from "../meta/json-runtime.ts";
import { trustedJsonParse, trustedJsonStringify } from "./trusted-runtime.ts";
import {
  REFERENCE_SOLVE_PROTOCOL as PROTOCOL,
  REFERENCE_SOLVE_READY as READY,
} from "./reference-solve-wire.ts";
import type { PublicTask } from "./task-split.ts";
import { type JsonValue, type OpenRecord, isFunction, isString } from "../meta/json-shape.ts";
import { runtimeProcess } from "../meta/process.ts";
import { denyProcessExecution } from "../solve/generated-tool-exec-wall.ts";

const nativeWrite = Bun.write;
const nativeStdout = Bun.stdout;
const nativeStderr = Bun.stderr;
const nativeStdinText = Bun.stdin.text.bind(Bun.stdin);

interface Request {
  protocol: typeof PROTOCOL;
  task: PublicTask<JsonValue>;
}

type Response =
  | { protocol: typeof PROTOCOL; outcome: "artifact"; artifact: unknown }
  | {
      protocol: typeof PROTOCOL;
      outcome: "non-result";
      classification: "generated-solve-result" | "generated-solve-throw";
    };

async function write(response: Response): Promise<void> {
  await nativeWrite(nativeStdout, trustedJsonStringify(response));
}

async function diagnostic(cause: unknown): Promise<void> {
  await nativeWrite(nativeStderr, cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
}

export async function runReferenceSolveProcess(load: () => Promise<OpenRecord>): Promise<void> {
  lockJsonGlobals(true);
  try {
    const wall = await denyProcessExecution(runtimeProcess.platform);
    if (wall.status !== "installed") throw new Error("reference solve process-execution wall unavailable");
    await nativeWrite(nativeStdout, `${READY}${runtimeProcess.pid}\n`);
    // No task or generated module enters this process until the parent witnesses this pid.
    const request = parseJsonAs<Request>(await nativeStdinText());
    if (request.protocol !== PROTOCOL) throw new Error("reference-solve request protocol mismatch");
    const module = await load();
    if (!isFunction(module.solve)) {
      throw new Error("correctness-model/reference/index.ts does not export solve(task)");
    }
    let produced: unknown;
    try {
      produced = await /* SAFETY: the check above returned when `!isFunction(module.solve)`. */ (
        module.solve as (task: PublicTask<JsonValue>) => JsonValue | Promise<JsonValue>
      )(request.task);
    } catch (error) {
      await diagnostic(error);
      await write({ protocol: PROTOCOL, outcome: "non-result", classification: "generated-solve-throw" });
      return;
    }
    try {
      const serialised = trustedJsonStringify(produced);
      if (!isString(serialised)) throw new Error("solve(task) returned an unserialisable value");
      const artifact = trustedJsonParse(serialised);
      await write({ protocol: PROTOCOL, outcome: "artifact", artifact });
    } catch (error) {
      await diagnostic(error);
      await write({ protocol: PROTOCOL, outcome: "non-result", classification: "generated-solve-result" });
    }
  } catch (error) {
    await diagnostic(error);
    await write({ protocol: PROTOCOL, outcome: "non-result", classification: "generated-solve-throw" });
  }
}
