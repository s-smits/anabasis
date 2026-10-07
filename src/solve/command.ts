/**
 * The one place a solve launches a command: the solver's bash calls and the harness's own tool calls
 * both come through `runWalled`, under the command wall v1's Built shell ran under
 * (`stageCommandIsolation`), on pi's local shell backend, which kills the command's process tree on
 * a timeout or an abort.
 *
 * A solve owns two directories under the shared scratch parent, which the command wall closes to
 * every command but its own trees:
 * - `root`, the capped volume (`mountDiskCap`), holds `home`, which survives between commands and is
 *   never read back, and `runs`, where each command gets a fresh `run-*` with `work`, its working
 *   directory, and `tmp`, its `TMPDIR`, both removed when it ends. That is v1's shape
 *   (built-bash.ts:293-298), with the runs moved onto the cap.
 * - `host`, beside it and outside the cap, which no command can read: the staged profiles, and the
 *   model backend's own state, such as Claude Code's configuration and transcripts.
 */
import {
  createLocalBashOperations,
  type BashOperations,
} from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import { mkdirSync, mkdtempSync, rmSync } from "../meta/filesystem.ts";
import { basename, join } from "../meta/path.ts";
import {
  BUILT_COMMAND_SCRATCH_ROOT,
  commandIsolationPolicy,
  stageCommandIsolation,
} from "../verify/solve-command-isolation.ts";
import type { SolveIsolationPolicy } from "../verify/solve-sandbox.ts";

export interface SolveDirs {
  /** The capped volume's mount point. */
  readonly root: string;
  readonly home: string;
  readonly runs: string;
  /** Host-only: outside the cap, closed to every command. */
  readonly host: string;
}

/** What every command of one solve runs under. */
export interface CommandWall {
  readonly base: SolveIsolationPolicy;
  readonly dirs: SolveDirs;
  /** The harness's `.toolchain`, read-only and first on PATH; null when it has none. */
  readonly toolTree: string | null;
}

/** A command's own two directories, for a caller that stages input files before it runs. */
export interface RunDirs {
  readonly work: string;
  readonly temp: string;
}

export interface WalledOptions {
  readonly onData: (data: Buffer) => void;
  readonly signal?: AbortSignal | undefined;
  /** Seconds; pi's backend throws `timeout:<seconds>` when the command runs past it. */
  readonly timeout?: number | undefined;
  /** Writes what the command reads into its fresh directories before it starts. */
  readonly stage?: (run: RunDirs) => void;
}

const SHELL = createLocalBashOperations({ shellPath: "/bin/sh" });

/** The directories of solve `id`, named, not yet made: the runner mounts the cap at `root`. */
export function solveDirs(id: string): SolveDirs {
  const root = join(BUILT_COMMAND_SCRATCH_ROOT, `solve-${id}`);
  return { root, home: join(root, "home"), runs: join(root, "runs"), host: `${root}.host` };
}

export async function runWalled(
  wall: CommandWall,
  command: string,
  options: WalledOptions,
): Promise<{ exitCode: number | null }> {
  const run = mkdtempSync(join(wall.dirs.runs, "run-"));
  const work = join(run, "work");
  const temp = join(run, "tmp");
  mkdirSync(work);
  mkdirSync(temp);
  const profile = join(wall.dirs.host, `${basename(run)}.sb`);
  try {
    options.stage?.({ work, temp });
    const policy = commandIsolationPolicy(wall.base, {
      work,
      home: wall.dirs.home,
      temp,
      toolTree: wall.toolTree,
    });
    return await SHELL.exec(stageCommandIsolation(policy, profile, command), work, {
      onData: options.onData,
      signal: options.signal,
      timeout: options.timeout,
      env: policy.environment,
    });
  } finally {
    rmSync(run, { recursive: true, force: true });
    rmSync(profile, { force: true });
  }
}

/** pi's bash tool on the wall. The tool's own working directory and environment are the host's, so
 *  both are dropped: the command runs in its fresh `work` with the wall's environment alone. */
export function wallOperations(wall: CommandWall): BashOperations {
  return {
    exec: (command, _cwd, { onData, signal, timeout }) =>
      runWalled(wall, command, { onData, signal, timeout }),
  };
}
