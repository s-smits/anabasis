/**
 * Shell environment for a Builder authoring session. HOME points into the workspace's `.toolchain`
 * directory under every network policy, so HOME-based installers and tools write inside the
 * workspace, where admission can reuse them, instead of into the denied host home. Two
 * conventional user bin directories join PATH so Python, Rust and similar installs run without
 * extra flags.
 */
import { mkdirSync } from "../meta/filesystem.ts";
import { HARNESS_CONFIG_FILE, type HarnessSettings, harnessSettings } from "../truth/harness-config.ts";
import { availableParallelism, loadavg } from "../meta/os.ts";
import { dirname, join } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { type OptionalEnvValues, scrubSecretEnv } from "../backends/scrub-env.ts";
import { ISOLATED_TIMEOUT_MS } from "./candidate-isolation-runtime.ts";
import type { CandidateAccessPolicy } from "./candidate-isolation.ts";

/** The longest one bash call may run: long enough for a toolchain build, which a background job
 *  cannot outlive. The description reserves it for builds. */
export const BASH_TIMEOUT_MAX_MS = 120 * 60_000;

/** The workspace-local environment for the host-dispatched Builder shell tool. */
function builderHomeEnvironment(workDir: string, inheritedPath = Bun.env.PATH) {
  const home = join(workDir, ".toolchain", "home");
  const localBin = join(home, ".local", "bin");
  const cargoBin = join(home, ".cargo", "bin");
  mkdirSync(localBin, { recursive: true });
  mkdirSync(cargoBin, { recursive: true });
  return {
    HOME: home,
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    // Workspace packages link into the repository's node_modules, which the wall does not list;
    // resolving from the link's path finds hoisted dependencies in the workspace's node_modules.
    NODE_PRESERVE_SYMLINKS: "1",
    // Use this run's admitted Bun before ambient wrappers (the operator's ~/.local/bin/bun
    // may sit outside the authoring wall). Workspace tool installs retain their usual precedence.
    PATH: [localBin, cargoBin, dirname(runtimeProcess.execPath), inheritedPath].filter(Boolean).join(":"),
  };
}

/** The model's `timeout` is in seconds; absent, zero or invalid keeps the default, larger is capped. */
export function bashTimeoutMs(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return ISOLATED_TIMEOUT_MS;
  return Math.min(BASH_TIMEOUT_MAX_MS, Math.round(seconds * 1000));
}

/** What a killed command tells the model, including the host load, which the Builder cannot
 *  otherwise tell apart from a slow command. */
export function bashKilledNotice(timeoutMs: number): string {
  const load = (loadavg()[0] ?? 0).toFixed(1);
  return `Command killed after ${String(timeoutMs / 1000)} s while the host load average was ${load} on ${String(availableParallelism())} cores; a CPU-bound command gets less than a core when load exceeds cores. Pass timeout (seconds, up to ${String(BASH_TIMEOUT_MAX_MS / 1000)}) for a longer build, or split it; give a search fewer iterations`;
}

/**
 * What one long authoring call cost against the budget this harness gives its own solver, or null
 * when the call would have fitted inside it.
 *
 * The budgets are the solver's per-command, per-check and whole-solve walls from the workspace's
 * own `agent/config.yaml`. This is a nudge, not a wall: the call already ran. Silent at or below
 * the smallest budget, since the solver could have made that call itself.
 */
export function solverBudgetNotice(elapsedMs: number, settings: HarnessSettings): string | null {
  const commandMs = settings.shellMaxSeconds * 1000;
  if (elapsedMs <= Math.min(commandMs, settings.checkWallMs, settings.solveMs)) return null;
  const s = (ms: number) => String(Math.round(ms / 1000));
  const against = (budgetMs: number) => `${s(budgetMs)} s (${(elapsedMs / budgetMs).toFixed(1)}x)`;
  return `This call ran ${s(elapsedMs)} s. ${HARNESS_CONFIG_FILE} gives one solver command ${against(commandMs)}, one correctness check ${against(settings.checkWallMs)} and a whole solve ${against(settings.solveMs)}. Work you calibrate with a call this long may be work your own solver cannot repeat inside those numbers. Both sides of that are yours to move: edit those settings, or tune what you installed under .toolchain, where a tolerance, iteration or resolution setting usually trades a little accuracy for a lot of time.`;
}

/** The same notice for a workspace, silent while its config is unreadable: the submit gate reports
 *  a defective config, and a nudge never fails a shell call. */
export function workspaceSolverBudgetNotice(workDir: string, elapsedMs: number): string | null {
  try {
    return solverBudgetNotice(elapsedMs, harnessSettings(workDir));
  } catch {
    return null;
  }
}

/** The bash tool description, stating what the wall actually closes; `pathCard` is the shared path
 *  sentence. */
export function bashDescription(policy: CandidateAccessPolicy, pathCard: string): string {
  const closed =
    "The wall closes the verified repository, this campaign's run evidence and the host's credential and key files; keep your own work inside the workspace.";
  const deadline = `One call runs for up to ${String(ISOLATED_TIMEOUT_MS / 1000)} s; set timeout (seconds, at most ${String(BASH_TIMEOUT_MAX_MS / 1000)}) for a long build such as a toolchain or a batch of compiles. The session waits on every call, and a job it starts in the background ends with the call, so keep a long search in the foreground of one call and raise its timeout. This host has ${String(availableParallelism())} cores and nothing bounds a command to one of them, so a search that would run for the better part of an hour serially is worth splitting across them: authoring rounds have spent 47 to 53 minutes inside a single serial search call.`;
  return policy.network === "allow"
    ? `Run a shell command. Work in the workspace: HOME is .toolchain/home inside it and its .local/bin and .cargo/bin directories are on PATH, so pip, uv, cargo, bun install and similar installers work without extra flags, and installs land where both the candidate's checks and the solver's shell find them: each searches .toolchain/bin first, then every bin, shims or sbin directory below .toolchain. The candidate runs under Bun, the measured interpreter; write checkers and tests for bun. Network access is available. ${deadline} ${closed}${pathCard}`
    : `Run a shell command. Work in the workspace: HOME is .toolchain/home inside it, so a tool that keeps a cache, data or config directory writes there instead of being refused. Network access is unavailable, so dependency installs cannot work; the repository's node_modules toolchain is already readable, and this cell is for building and testing what it was handed. ${deadline} ${closed}${pathCard}`;
}

/** The child environment for one bash call: the scrubbed base plus the workspace HOME redirect.
 *  Creates both conventional user bin directories. */
export function bashEnv(workDir: string): OptionalEnvValues {
  const scrubbed =
    /* SAFETY: `scrubSecretEnv` returns the same environment record with the secret-bearing keys removed. */ scrubSecretEnv(
      Bun.env,
    );
  return {
    ...scrubbed,
    ...builderHomeEnvironment(workDir, scrubbed.PATH),
  };
}
