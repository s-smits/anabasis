#!/usr/bin/env bun
/**
 * The launched tree's preflight, run by `launch.ts` from that tree's own copy of this file, so every
 * import below resolves in the revision being launched. It proves the source is clean, computes the
 * request and command digests the opening must record, starts the confined Built worker without a
 * model turn, and spends one minimal Builder turn to see the account's allowance.
 *
 * Its argument list is `probeArgs` and its printed JSON is what `launch.ts` reads. Both cross
 * revisions — a later launcher runs an earlier probe — so neither changes shape without the other.
 */
import { resolve } from "#src/meta/path.ts";
import { tmpdir } from "#src/meta/os.ts";
import { sha256 } from "#src/meta/digest.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonBytes } from "#src/meta/json-runtime.ts";
import { SOURCE_IDENTITY } from "#src/run/source-identity.ts";
import { commandDigest, parseFullRunArgs } from "#src/run/launch-arguments.ts";
import { builtSolveIsolation } from "#src/run/built-agent-runtime.ts";
import { loadRepoEnv } from "#src/backends/env.ts";
import { resolvedSlot } from "#src/backends/resolve.ts";
import { piBuiltReadAllowRoots, preflightPiBuilt, resolvePiBuiltRuntime } from "#src/backends/pi-built.ts";
import { resolvePiSlot } from "#src/backends/pi-providers.ts";
import { openHostSession } from "#src/backends/pi-session.ts";
import { type ExitWith, exitWith, parseOrDie } from "#skills/main/cli.ts";
import {
  CONDITIONS,
  type Condition,
  LAUNCH_ARGUMENTS,
  type LaunchOptions,
  fullrunArgs,
  launchOptions,
  planRuns,
  sourceIdentity,
} from "./options.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");

export async function probe(options: LaunchOptions) {
  const [plan, ...others] = planRuns(options, ROOT, "probe");
  if (plan === undefined || others.length > 0) throw new Error("probe requires exactly one run");
  const source = sourceIdentity(SOURCE_IDENTITY);
  if (source.dirty) throw new Error("target source is dirty");
  const parsed = parseFullRunArgs(fullrunArgs(plan, options, source));
  const requestDigest = hashJsonBytes({ prompt: parsed.prompt, contextDigest: sha256("[]") });
  const env = loadRepoEnv(ROOT).env;
  const slot = (side: "builder" | "built" | "review") =>
    resolvedSlot(CONDITIONS[plan.condition].kind, env, side, "operator");
  const slots = {
    slug: "launch-probe",
    operatorConfig: null,
    builder: slot("builder"),
    built: slot("built"),
    review: { ...slot("review"), source: "operator" as const, enabled: true as const },
  };
  const policy = builtSolveIsolation(ROOT, piBuiltReadAllowRoots(slots));
  const worker = await preflightPiBuilt(resolvePiBuiltRuntime(slots, ROOT, policy));
  const allowance = await checkAllowance(plan.condition, env);
  return { source, requestDigest, commandDigest: commandDigest(parsed, requestDigest), worker, allowance };
}

/** One minimal Builder-slot turn on the host session every slot shares: a session or usage limit on
 *  the account refuses here, before the gate and the worktree spend, with the provider's own reset
 *  clause. The allowance belongs to the account rather than the effort, so the turn asks for the
 *  least reasoning the model serves. */
async function checkAllowance(condition: Condition, env: Record<string, string | undefined>) {
  const { kind, model } = CONDITIONS[condition];
  const slot = resolvePiSlot(
    "builder",
    { kind, model, reasoningEffort: "low" },
    { webSearch: false },
    ROOT,
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
  const die: ExitWith = exitWith("launch-run probe");
  const options = launchOptions(parseOrDie(die, LAUNCH_ARGUMENTS), die);
  try {
    console.log(JSON.stringify(await probe(options)));
  } catch (error) {
    die(errorMessage(error), 1);
  }
}
