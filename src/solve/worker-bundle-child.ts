/** One worker bundle built in a process of its own, so the bundler's memory leaves with it
 *  (`worker-bundle.ts`). Argument: the request as one JSON document; stdout: the answer. */
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { evaluatorRuntimeSource } from "../correctness-bundle/evaluator-process-bundle.ts";
import { generatedBuiltinRefusal } from "./generated-tool-source-policy.ts";
import {
  WORKER_BUILD_OPTIONS,
  type WorkerBundleAnswer,
  type WorkerBundlePlugin,
  type WorkerBundleRequest,
} from "./worker-bundle.ts";

function made(plugin: WorkerBundlePlugin): Bun.BunPlugin {
  switch (plugin.name) {
    case "generated-builtin-refusal":
      return generatedBuiltinRefusal(plugin.dir);
    case "evaluator-runtime-source":
      return evaluatorRuntimeSource(plugin.root, plugin.role);
  }
}

const request = parseJsonAs<WorkerBundleRequest>(runtimeProcess.argv[2] ?? "");
let answer: WorkerBundleAnswer;
try {
  await Bun.build({
    entrypoints: [request.entrypoint],
    outdir: request.outdir,
    ...WORKER_BUILD_OPTIONS,
    plugins: request.plugins.map(made),
  });
  answer = { outcome: "built" };
} catch (error) {
  answer = {
    outcome: "threw",
    message: errorMessage(error),
    errors: error instanceof AggregateError ? error.errors.map(errorMessage) : null,
  };
}
await Bun.write(Bun.stdout, capturedJsonStringify(answer));
