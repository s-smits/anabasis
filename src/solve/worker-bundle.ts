/** Bundle one entry point into the worker file a confined child runs, in a process of its own. */
import { capturedJsonStringify, parseJsonAs } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { capturedExecPath } from "../meta/process.ts";
import { CAPTURE_MAX_BYTES } from "../meta/subprocess.ts";

/** A plugin a worker bundle is built with, by the name the bundling process makes it under and
 *  what it is made from. The bundler runs in a process of its own, and a plugin is functions,
 *  which cannot be sent there. */
export type WorkerBundlePlugin =
  | { name: "generated-builtin-refusal"; dir: string }
  | { name: "evaluator-runtime-source"; root: string; role: "evaluate" | "reference" };

/** What `buildWorkerBundle` asks `worker-bundle-child.ts` to build. */
export interface WorkerBundleRequest {
  entrypoint: string;
  outdir: string;
  plugins: WorkerBundlePlugin[];
}

/** How that build ended: built or thrown. `Bun.build` rejects on every failure rather than returning
 *  `success: false`, and its AggregateError keeps its items' messages, which is where a plugin's
 *  refusal is. */
export type WorkerBundleAnswer =
  | { outcome: "built" }
  | { outcome: "threw"; message: string; errors: string[] | null };

/**
 * The options every worker bundle is built with. They are held here rather than passed in because a
 * worker that drifts on `format`, `target` or `splitting` still builds cleanly and then fails inside
 * the confined child, where the failure reaches the controller as a protocol non-result instead of
 * as a build error someone can read. `naming` decides the path `buildWorkerBundle` returns.
 */
export const WORKER_BUILD_OPTIONS = {
  naming: "worker.mjs",
  target: "bun",
  format: "esm",
  splitting: false,
  sourcemap: "none",
} as const;

const CHILD_ENTRY = Bun.fileURLToPath(new URL("./worker-bundle-child.ts", import.meta.url));
/** A wedged bundler is the one thing this bounds; a build takes well under a second. */
const CHILD_TIMEOUT_MS = 10 * 60_000;

/**
 * Bundle one entry point into the worker file a confined child runs, and return that file's path.
 * Three call sites build a worker this way: the generated-tool worker process, the Built backend
 * and the evaluator bundle. The path is returned rather than recomposed by the caller, since
 * `naming` is what decides it.
 *
 * The bundler runs in a process of its own (`worker-bundle-child.ts`), because in the controller it
 * kept what it allocated for the rest of the run, and any run that grades a battery bundles its
 * evaluator. The child costs a process start per build. A refusal comes back as the error the
 * bundler threw, with the same message and the same messages inside it.
 */
export async function buildWorkerBundle(
  failure: string,
  entrypoint: string,
  outdir: string,
  plugins: readonly WorkerBundlePlugin[] = [],
): Promise<string> {
  const request: WorkerBundleRequest = { entrypoint, outdir, plugins: [...plugins] };
  const child = Bun.spawn({
    cmd: [capturedExecPath, "--no-env-file", CHILD_ENTRY, capturedJsonStringify(request)],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // Bun's default kill at either bound is SIGTERM, which it never escalates, and a wedged child
    // need not heed it.
    timeout: CHILD_TIMEOUT_MS,
    maxBuffer: CAPTURE_MAX_BYTES,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    const ending = child.signalCode === null ? `exited ${code}` : `died on ${child.signalCode}`;
    throw new Error(`${failure}: the bundling process ${ending}: ${stderr.trim()}`);
  }
  const answer = parseJsonAs<WorkerBundleAnswer>(stdout);
  if (answer.outcome === "built") return join(outdir, WORKER_BUILD_OPTIONS.naming);
  throw answer.errors === null
    ? new Error(answer.message)
    : new AggregateError(
        answer.errors.map((message) => new Error(message)),
        answer.message,
      );
}
