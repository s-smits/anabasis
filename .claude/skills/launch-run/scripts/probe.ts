#!/usr/bin/env bun
/** Execute against the selected product tree, never the helper's own source revision. */
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { CONDITIONS, fullrunArgs, parseOptions, planRuns, sourceIdentity } from "./options.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";

const root = process.cwd();
// Module URLs select the measured revision; types describe the existing product interfaces.
async function target<T>(path: string): Promise<T> {
  // SAFETY: `T` is the caller's declaration of the interface it expects in the measured tree, whose
  // modules this helper never type-checks against. A tree that has moved a symbol elsewhere gives an
  // empty binding, which the call below fails on and the catch at the end of this file explains.
  return (await import(pathToFileURL(join(root, path)).href)) as T;
}

export async function probe(argv: string[]) {
  const options = parseOptions(argv);
  const plan = planRuns(options, dirname(root), "probe")[0];
  if (!plan || options.conditions.length !== 1 || options.names.length !== 1) {
    throw new Error("probe requires exactly one run");
  }
  const { SOURCE_IDENTITY } = await target<typeof import("#src/run/source-identity.ts")>(
    "src/run/source-identity.ts",
  );
  const source = sourceIdentity(SOURCE_IDENTITY);
  if (source.dirty) throw new Error("target source is dirty");
  const args = fullrunArgs(plan, options, source);
  const { parseFullRunArgs } = await target<typeof import("#src/run/launch-arguments.ts")>(
    "src/run/launch-arguments.ts",
  );
  const { hashJsonBytes } =
    await target<typeof import("#src/meta/json-runtime.ts")>("src/meta/json-runtime.ts");
  const { hashJsonValue } =
    await target<typeof import("#src/meta/stable-json.ts")>("src/meta/stable-json.ts");
  const parsed = parseFullRunArgs(args);
  const contextDigest = new Bun.CryptoHasher("sha256").update("[]").digest("hex");
  const requestDigest = hashJsonBytes({ prompt: parsed.prompt, contextDigest });
  const commandDigest = hashJsonValue({ ...parsed, prompt: null, contextPaths: null, requestDigest });
  const { loadRepoEnv } = await target<typeof import("#src/backends/env.ts")>("src/backends/env.ts");
  const { resolvedSlot } = await target<typeof import("#src/backends/resolve-side.ts")>(
    "src/backends/resolve-side.ts",
  );
  const { builtSolveIsolation } = await target<typeof import("#src/run/built-agent-runtime.ts")>(
    "src/run/built-agent-runtime.ts",
  );
  const { piBuiltReadAllowRoots, resolvePiBuiltRuntime, preflightPiBuilt } =
    await target<typeof import("#src/backends/pi-built.ts")>("src/backends/pi-built.ts");
  const env = loadRepoEnv(root).env;
  const slot = (side: "builder" | "built" | "review") =>
    resolvedSlot(CONDITIONS[plan.condition].kind, env, side, "operator");
  const slots = {
    slug: "launch-probe",
    operatorConfig: null,
    builder: slot("builder"),
    built: slot("built"),
    review: { ...slot("review"), source: "operator" as const, enabled: true as const },
  };
  const policy = builtSolveIsolation(root, piBuiltReadAllowRoots(slots));
  const worker = await preflightPiBuilt(resolvePiBuiltRuntime(slots, root, policy));
  const allowance = await checkAllowance(CONDITIONS[plan.condition], env);
  return { source, requestDigest, commandDigest, worker, allowance };
}

/** One minimal Builder-slot turn on the host session every slot shares: a session or usage limit on
 *  the account refuses here, before the gate and the worktree spend, with the provider's own reset
 *  clause. The allowance belongs to the account rather than the effort, so the turn asks for the
 *  least reasoning the model serves. */
async function checkAllowance(
  { kind, model }: (typeof CONDITIONS)[keyof typeof CONDITIONS],
  env: Record<string, string | undefined>,
) {
  const { resolvePiSlot } = await target<typeof import("#src/backends/pi-providers.ts")>(
    "src/backends/pi-providers.ts",
  );
  const { openHostSession } = await target<typeof import("#src/backends/pi-session.ts")>(
    "src/backends/pi-session.ts",
  );
  const slot = resolvePiSlot(
    "builder",
    { kind, model, reasoningEffort: "low" },
    { effort: "low", webSearch: false },
    root,
    env,
  );
  const session = await openHostSession({
    slot,
    tools: [],
    systemPrompt: "Reply with the single word OK.",
    cwd: tmpdir(),
  });
  try {
    const turn = await session.runTurn({ prompt: "OK?", turnTimeoutMs: 120_000 });
    const errors = turn.errorMessages ?? [];
    const message =
      errors.length > 0 ? errors.join("; ") : turn.status === "completed" ? null : `turn ${turn.status}`;
    return { checked: true, ok: message === null, message };
  } finally {
    await session.dispose();
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await probe(Bun.argv.slice(2))));
  } catch (error) {
    const message = errorMessage(error);
    // The product modules are imported from the launched tree by path, so a symbol that source has
    // since moved to another file arrives as an empty binding, and the launch fails with
    // `<name> is not a function` — which reads as a defect in the run's own bytes. On 2026-09-20 it
    // was `parseFullRunArgs`, split out of `full-run-launch.ts` by the launched source while the
    // launcher came from main. Nothing is spent when this happens, because the probe refuses before
    // the gate and before the allowance turn, so the hint only has to name the one remedy.
    console.error(
      message.includes(" is not a function")
        ? `${message} — if the launched source moved a module this launcher imports by path, run the launcher from a worktree at that source`
        : message,
    );
    process.exitCode = 1;
  }
}
