/** One protected evaluation. Only the parent owns tool execution and its evidence. */
import { keyIfDefined } from "../meta/optional-key.ts";
import { attachJsonlLineReader } from "../../vendor/pi-built/jsonl.ts";
import { capturedJsonStringify, lockJsonGlobals, parseJsonAs } from "../meta/json-runtime.ts";
import { isBoolean, isFunction, isNumber, isRecord, isString } from "../meta/json-shape.ts";
import { runtimeProcess } from "../meta/process.ts";
import { denyProcessExecution } from "../solve/generated-tool-exec-wall.ts";
import type { CheckFn, CheckRuntime } from "./correctness-model-contract.ts";
import type { ToolRunResult } from "../verify/verifier-port.ts";
import {
  EVALUATOR_FRAME_MAX_BYTES,
  type EvaluatorChildMessage,
  type EvaluatorParentMessage,
  type EvaluatorStart,
} from "./evaluator-process-wire.ts";

const write = runtimeProcess.stdout.write.bind(runtimeProcess.stdout);
const exit = runtimeProcess.exit.bind(runtimeProcess);
const input = Bun.stdin.stream();
const { platform } = runtimeProcess;
const pending = new Map<number, { resolve(value: ToolRunResult): void; reject(error: Error): void }>();
let nextId = 0;
let started = false;
const release = Promise.withResolvers<void>();

type CheckModule = { checks?: unknown; evaluate?: unknown };

function send(value: EvaluatorChildMessage): void {
  write(`${capturedJsonStringify(value)}\n`);
}

function end(value: EvaluatorChildMessage): void {
  // Let the pipe flush before exiting; a large valid verdict must not become truncated JSON.
  write(`${capturedJsonStringify(value)}\n`, () => exit(0));
}

function fail(error?: unknown): void {
  // Protected diagnostic: only the controller's existing generated-execution projection can
  // make author feedback from this. It is never copied into a public tool response.
  // An engine error names the check's own expression, so its class travels with the text.
  const engine =
    error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError
      ? `${error.name}: `
      : "";
  end({
    type: "error",
    kind: "generated",
    detail: (error instanceof Error ? engine + error.message : "child refused").slice(0, 4096),
  });
}

/** Inspect descriptors rather than invoking generated getters during the export census. */
function checkExports(mod: CheckModule, expected?: readonly string[]): string[] {
  if (!isRecord(mod.checks) || mod.evaluate !== undefined) return ["checks (legacy evaluate is unsupported)"];
  const descriptors = Object.getOwnPropertyDescriptors(mod.checks);
  const names = Object.keys(descriptors);
  if (Object.getOwnPropertySymbols(mod.checks).length > 0) return ["checks must have string keys only"];
  const malformed = names.filter(
    (name) =>
      !isFunction(descriptors[name]?.value) ||
      descriptors[name]?.get !== undefined ||
      descriptors[name]?.set !== undefined,
  );
  if (malformed.length > 0) return malformed.map((name) => `checks.${name} must be an own function`);
  if (expected === undefined) return [];
  return [
    ...expected
      .values()
      .filter((name) => !names.includes(name))
      .map((name) => `checks.${name}`)
      .toArray(),
    ...names.filter((name) => !expected.includes(name)).map((name) => `undeclared checks.${name}`),
  ];
}

async function start(row: EvaluatorStart, load: () => Promise<CheckModule>): Promise<void> {
  const wall = await denyProcessExecution(platform);
  if (wall.status !== "installed") {
    end({ type: "error", kind: "sandbox" });
    return;
  }
  send({ type: "ready", pid: runtimeProcess.pid });
  // The parent witnesses this exact confined pid before any generated module can execute.
  await release.promise;
  const mod = await load();
  const missing = checkExports(mod, row.mode === "probe" ? row.checkIds : undefined);
  if (missing.length > 0) {
    end({ type: "exports", missing });
    return;
  }
  if (row.mode === "probe") {
    end({ type: "exports", missing: [] });
    return;
  }
  const runtime: CheckRuntime | undefined =
    row.runtime === true
      ? {
          tools: {
            run: (request) =>
              new Promise((resolve, reject) => {
                const id = ++nextId;
                pending.set(id, { resolve, reject });
                send({ type: "tool", id, request: { ...request, checkId: row.checkId } });
              }),
          },
        }
      : undefined;
  // SAFETY: checkExports validated the map descriptors; the parent chooses the named function.
  const checks = mod.checks as Record<string, CheckFn>;
  const check: unknown = Object.getOwnPropertyDescriptor(checks, row.checkId)?.value;
  if (!isFunction(check)) throw new Error("selected check export is missing");
  // A check may read the port off the request or take it as the second argument, and run 077e56
  // destructured `{ artifact, runtime }` from the request and threw on every accept. It rides in
  // both places, so either way of reading it reaches the host.
  const request: Parameters<CheckFn>[0] = { ...row.request, ...keyIfDefined("runtime", runtime) };
  // SAFETY: the selected own export is a function; the host supplies the CheckFn request and validates its result below.
  const result: unknown = await (check as CheckFn)(request, runtime);
  if (!isBoolean(result)) throw new Error("check result must be boolean");
  end({ type: "result", result });
}

export async function runEvaluatorProcess(load: () => Promise<CheckModule>): Promise<void> {
  lockJsonGlobals(true);
  await attachJsonlLineReader(
    input,
    (line) => {
      try {
        const row = parseJsonAs<EvaluatorParentMessage>(line);
        if (!started && row.type === "start" && (row.mode === "probe" || row.mode === "evaluate")) {
          started = true;
          void start(row, load).catch(fail);
        } else if (started && row.type === "begin") {
          release.resolve();
        } else if (row.type === "tool-result" && isNumber(row.id)) {
          const call = pending.get(row.id);
          if (call === undefined) return fail();
          pending.delete(row.id);
          if ("error" in row && isString(row.error)) call.reject(new Error(row.error));
          else {
            if (!("result" in row)) return fail();
            call.resolve(row.result);
          }
        } else fail();
      } catch {
        fail();
      }
    },
    EVALUATOR_FRAME_MAX_BYTES,
  );
}
