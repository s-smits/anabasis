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
 * - `host`, beside it and outside the cap, which no command can read: the staged profiles, the
 *   commands' CPU records, and the model backend's own state, such as Claude Code's configuration
 *   and transcripts.
 *
 * Each command's CPU time is its waited-for descendants' user and system time, as the host's shell
 * around the wall reads it with `times` once the walled launch exits. A command killed at its
 * timeout or by an abort takes that shell with it, so it is counted as unmeasured rather than as
 * zero, and a process that outlived its command is in neither. v1 read CPU per run, not per solve,
 * from `rusage.py`.
 */
import {
  createLocalBashOperations,
  type BashOperations,
} from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import type { Limits } from "../kernel/condition.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "../meta/filesystem.ts";
import { basename, join } from "../meta/path.ts";
import {
  BUILT_COMMAND_SCRATCH_ROOT,
  commandIsolationPolicy,
  shellQuote,
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

type ShellLimits = Pick<Limits, "shellDefaultSeconds" | "shellMaxSeconds">;

/** What every command of one solve runs under. */
export interface CommandWall {
  readonly base: SolveIsolationPolicy;
  readonly dirs: SolveDirs;
  /** The harness's `.toolchain`, read-only and first on PATH; null when it has none. */
  readonly toolTree: string | null;
  /** The condition's; every command is held to them here, whoever launches it. */
  readonly limits: ShellLimits;
  /** The CPU seconds of the solve's commands so far, and how many ended unmeasured. */
  readonly cpu: { seconds: number; unmeasured: number };
}

/** A command's own two directories, for a caller that stages input files before it runs. */
export interface RunDirs {
  readonly work: string;
  readonly temp: string;
}

export interface WalledOptions {
  readonly onData: (data: Buffer) => void;
  readonly signal?: AbortSignal | undefined;
  /** Seconds asked for, held to the limits by `shellSeconds`; pi's backend throws
   *  `timeout:<seconds>` when the command runs past what it was given. */
  readonly timeout?: number | undefined;
  /** Writes what the command reads into its fresh directories before it starts. */
  readonly stage?: (run: RunDirs) => void;
}

const SHELL = createLocalBashOperations({ shellPath: "/bin/sh" });

/** The wall one command runs under: `asked` is what was named, floored and at least 1 s, and a
 *  named value only raises the default, up to the maximum, as v1's Built shell held it
 *  (harness-builder-v4 7af7315, src/solve/built-bash.ts:316-321). */
export function shellSeconds(timeout: number | undefined, limits: ShellLimits) {
  const asked = Math.max(1, Math.floor(timeout ?? limits.shellDefaultSeconds));
  return { asked, seconds: Math.min(Math.max(asked, limits.shellDefaultSeconds), limits.shellMaxSeconds) };
}

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
  const times = join(wall.dirs.host, `${basename(run)}.times`);
  try {
    options.stage?.({ work, temp });
    const policy = commandIsolationPolicy(wall.base, {
      work,
      home: wall.dirs.home,
      temp,
      toolTree: wall.toolTree,
    });
    // The shell pi starts leads the group and waits here for `times`, so the launch is its child.
    const staged = stageCommandIsolation(policy, profile, command, "$PPID");
    return await SHELL.exec(`(\n${staged}\n)\ns=$?\ntimes > ${shellQuote(times)}\nexit $s`, work, {
      onData: options.onData,
      signal: options.signal,
      timeout: shellSeconds(options.timeout, wall.limits).seconds,
      env: policy.environment,
    });
  } finally {
    const seconds = childSeconds(times);
    if (seconds === null) wall.cpu.unmeasured++;
    else wall.cpu.seconds += seconds;
    rmSync(run, { recursive: true, force: true });
    rmSync(profile, { force: true });
    rmSync(times, { force: true });
  }
}

/** The children's user and system seconds from a `times` record, its second line; null when the
 *  shell that writes it did not live to. */
function childSeconds(path: string): number | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const spans = [...text.matchAll(/(\d+)m([\d.]+)s/g)].map(([, m, s]) => Number(m) * 60 + Number(s));
  return spans.length === 4 ? (spans[2] ?? 0) + (spans[3] ?? 0) : null;
}

/** pi's bash tool on the wall. The tool's own working directory and environment are the host's, so
 *  both are dropped: the command runs in its fresh `work` with the wall's environment alone. */
export function wallOperations(wall: CommandWall): BashOperations {
  return {
    exec: (command, _cwd, { onData, signal, timeout }) =>
      runWalled(wall, command, { onData, signal, timeout }),
  };
}
