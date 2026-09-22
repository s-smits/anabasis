/**
 * Shell environment for a Builder authoring session. HOME points into the workspace's `.toolchain`
 * directory, which tool admission makes available later. HOME-based installers and
 * tools (Arduino's `~/Library/Arduino15`, Cargo, Go, PlatformIO, pip) therefore write within
 * the workspace and leave files admission can reuse. Two conventional user bin directories join PATH so Python,
 * Rust and similar installs run without extra flags.
 *
 * The redirect used to depend on the network policy, on the reasoning that only an installer writes
 * to HOME. An offline session writes there too: on run opus-n2b2 the Builder's first
 * `arduino-cli version` answered `open ~/Library/Arduino15/inventory.yaml: operation not
 * permitted`, because the wall denies the host home that HOME still pointed at. The tool then reads
 * as broken rather than as denied access, which is the failure hostToolchainEnv already names.
 */
import { mkdirSync } from "../meta/filesystem.ts";
import { HARNESS_CONFIG_FILE, type HarnessSettings, harnessSettings } from "../truth/harness-config.ts";
import { availableParallelism, loadavg } from "../meta/os.ts";
import { dirname, join } from "../meta/path.ts";
import { runtimeProcess } from "../meta/process.ts";
import { type OptionalEnvValues, scrubSecretEnv } from "../backends/scrub-env.ts";
import { ISOLATED_TIMEOUT_MS } from "./candidate-isolation-runtime.ts";
import type { CandidateAccessPolicy } from "./candidate-isolation.ts";

/**
 * The bash tool description for the composed policy; `pathCard` is the shared path sentence.
 *
 * It used to say "it can write only there" and "host secrets are not [available]". Neither was
 * true after the cells were opened so a domain could install what it needs: the Seatbelt profile
 * bases on `(allow default)` and subtracts named roots, and the in-process guard checks only the
 * command's `cwd`, not the paths inside the command. A tool description is a runtime fact the
 * model cannot observe (tenet 5), so it states what the wall actually closes and leaves the
 * workspace as the instruction it is, rather than describing a confinement that is not there.
 */
/** The longest one bash call may run. Control generation with an FEA or a toolchain compile ran
 *  past the 10-minute default in 18 campaigns; the alternative the Builder found was a
 *  background job polled with `sleep`, which the same deadline killed. Two hours since
 *  2026-09-14 for a firmware toolchain build; truss Builders then waited 47 to 52 minutes on one
 *  search call (2026-09-15), so the description reserves it for builds. */
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

/** What a killed command tells the model: a bare exit 137 read as memory, and the retry was killed too.
 *  The host load is a runtime fact the Builder cannot otherwise tell from a slow command: truss run
 *  5211e7's reference search was killed at 3,000 s with the host at load 40 on 12 cores, and its rerun had
 *  about a tenth of one core (2026-09-14). */
export function bashKilledNotice(timeoutMs: number): string {
  const load = (loadavg()[0] ?? 0).toFixed(1);
  return `Command killed after ${String(timeoutMs / 1000)} s while the host load average was ${load} on ${String(availableParallelism())} cores; a CPU-bound command gets less than a core when load exceeds cores. Pass timeout (seconds, up to ${String(BASH_TIMEOUT_MAX_MS / 1000)}) for a longer build, or split it; give a search fewer iterations`;
}

/**
 * What one long authoring call cost against the budget this harness gives its own solver, or null
 * when the call would have fitted inside it.
 *
 * The Builder's shell runs for up to two hours and nothing shortens it, because searching a domain
 * is not solving one of its tasks. The solver it is writing those limits for gets
 * `solver.shell_timeout_max_seconds` per command, `gate.check_seconds` per correctness check and
 * `solver.solve_minutes` for a whole solve — all three from the `agent/config.yaml` in this same
 * workspace, which the Builder wrote and can read. Nothing in the loop ever stated the exchange
 * rate: truss run c1d2a7 spent 61.0, 36.1 and 23.0 minutes in three serial calls of one authoring
 * round settling its mass limits, for a solver holding 15 minutes per command, and the round
 * carried that mismatch into the battery unexamined (operator raised it 2026-09-18).
 *
 * This is a nudge, not a wall: the call already ran, and every number in it is the Builder's own.
 * Both levers are the Builder's too — the settings, and the installed tools whose accuracy-for-time
 * settings decide what those seconds buy. Silent at or below the smallest budget, because a call
 * the solver could itself have made needs no note.
 */
export function solverBudgetNotice(elapsedMs: number, settings: HarnessSettings): string | null {
  const commandMs = settings.shellMaxSeconds * 1000;
  if (elapsedMs <= Math.min(commandMs, settings.checkWallMs, settings.solveMs)) return null;
  const s = (ms: number) => String(Math.round(ms / 1000));
  const against = (budgetMs: number) => `${s(budgetMs)} s (${(elapsedMs / budgetMs).toFixed(1)}x)`;
  return `This call ran ${s(elapsedMs)} s. ${HARNESS_CONFIG_FILE} gives one solver command ${against(commandMs)}, one correctness check ${against(settings.checkWallMs)} and a whole solve ${against(settings.solveMs)}. Work you calibrate with a call this long may be work your own solver cannot repeat inside those numbers. Both sides of that are yours to move: edit those settings, or tune what you installed under .toolchain, where a tolerance, iteration or resolution setting usually trades a little accuracy for a lot of time.`;
}

/** The same notice for a workspace, silent while its config is unreadable — the submit gate owns
 *  reporting a defective one, and a nudge must never be the thing that fails a shell call. */
export function workspaceSolverBudgetNotice(workDir: string, elapsedMs: number): string | null {
  try {
    return solverBudgetNotice(elapsedMs, harnessSettings(workDir));
  } catch {
    return null;
  }
}

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
