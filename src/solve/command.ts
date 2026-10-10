/**
 * The one place a solve launches a command: the solver's bash calls and the harness's own tool calls
 * both come through `runWalled`, under the command wall v1's Built shell ran under
 * (`stageCommandIsolation`), on pi's local shell backend, which kills the command's process group on
 * a timeout or an abort. Whatever else the command left working on the solve's volume is ended here.
 *
 * A solve owns two directories under the shared scratch parent, which the command wall closes to
 * every command but its own trees:
 * - `root`, the capped volume (`mountDiskCap`), holds `home`, which survives between commands and is
 *   never read back, and `runs`, where each command gets a fresh `run-*` with `work`, where its
 *   caller stages what it reads, and `tmp`, its `TMPDIR`, both removed when it ends. That is v1's
 *   shape (built-bash.ts:293-298), with the runs moved onto the cap.
 * - `host`, beside it and outside the cap, which no command can read: the staged profiles, the
 *   commands' CPU records, and the model backend's own state, such as Claude Code's configuration
 *   and transcripts.
 *
 * A command starts in `work` unless its caller asks for the home (`inHome`). A harness's tool call
 * and a file tool's command read files staged for that one command, and start beside them. The
 * solver's own commands start in the home, which is the one working directory pi's coding tools
 * share: until 2026-10-09 they started in `work` too, and nine in ten of them began with `cd ~`
 * (the Starter solves of six campaigns, `docs/transfer.md`).
 *
 * Each command's CPU time is its waited-for descendants' user and system time, as the host's shell
 * around the wall reads it with `times` once the walled launch exits. A command killed at its
 * timeout or by an abort takes that shell with it, so it is counted as unmeasured rather than as
 * zero, and a process that outlived its command is in neither. v1 read CPU per run, not per solve,
 * from `rusage.py`. That is Darwin's reading, where the launch replaces itself with the command. On
 * Linux the launch is bubblewrap, whose child's usage did not reach this shell: a loop that read
 * 0.46 s without it read 0 under it (bubblewrap 0.11.0, 2026-10-09). Campaigns run on Darwin, and a
 * CPU figure from a Linux host is not one.
 */
import { createLocalBashOperations } from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import type { Limits } from "../kernel/condition.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "../meta/filesystem.ts";
import { basename, join } from "../meta/path.ts";
import { errorCode } from "../meta/runtime-values.ts";
import { endHolders } from "../verify/disk-cap.ts";
import {
  BUILT_COMMAND_SCRATCH_ROOT,
  commandIsolationPolicy,
  shellQuote,
  stageCommandIsolation,
} from "../verify/solve-command-isolation.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../verify/solve-sandbox.ts";

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
  /** The solve's own time, which its commands are held to near its end (`heldSeconds`). A Builder's
   *  wall has none: its session ends when its model's turn does. */
  readonly clock?: SolveClock | undefined;
}

/** A solve's time: when its first turn started, null until it has, and how long the solve may be. */
export interface SolveClock {
  started: number | null;
  readonly seconds: number;
}

/** A command's own two directories, for a caller that stages input files before it runs. */
export interface RunDirs {
  readonly work: string;
  readonly temp: string;
}

interface WalledOptions {
  readonly onData: (data: Buffer) => void;
  readonly signal?: AbortSignal | undefined;
  /** Seconds asked for, held to the limits by `shellSeconds`; pi's backend throws
   *  `timeout:<seconds>` when the command runs past what it was given. */
  readonly timeout?: number | undefined;
  /** Writes what the command reads into its fresh directories before it starts. */
  readonly stage?: ((run: RunDirs) => void) | undefined;
  /** Start the command in the solve's home, not in its own `work`. */
  readonly inHome?: boolean | undefined;
}

const SHELL = createLocalBashOperations({ shellPath: "/bin/sh" });

/** The wall one command runs under: `asked` is what was named, floored and at least 1 s, and a
 *  named value only raises the default, up to the maximum, as v1's Built shell held it
 *  (harness-builder-v4 7af7315, src/solve/built-bash.ts:316-321). */
export function shellSeconds(timeout: number | undefined, limits: ShellLimits) {
  const asked = Math.max(1, Math.floor(timeout ?? limits.shellDefaultSeconds));
  return { asked, seconds: Math.min(Math.max(asked, limits.shellDefaultSeconds), limits.shellMaxSeconds) };
}

/** How long before a solve's end its commands are cut, so that a result still reaches the solver:
 *  a minute, and an eighth of a solve shorter than eight. */
export function reserveSeconds(wallSeconds: number): number {
  return Math.min(60, Math.floor(wallSeconds / 8));
}

/** The seconds of its time a solve has used, or null where it has no clock or has not started. */
export function usedSeconds(clock: SolveClock | undefined, now = performance.now()): number | null {
  const started = clock?.started ?? null;
  return started === null ? null : (now - started) / 1000;
}

/**
 * How long a command that starts now may run: the condition's limits (`shellSeconds`), and no
 * longer than the solve has left before its reserve. `nearEnd` says the solve's end set it.
 *
 * Until 2026-10-09 a command was held to its own limits alone, and one the solve's wall fell in
 * took the solve with it: at a five-minute wall 12 of 46 Starter solves ended at it, 11 of them
 * inside a command, with nothing sent. A command now returns while there is time to act on it. One started inside
 * the reserve, or with under five seconds before it, is left to its own limits: the solver is told
 * the time used with every result, and what it starts then is its own to judge.
 */
export function heldSeconds(
  timeout: number | undefined,
  { limits, clock }: Pick<CommandWall, "limits" | "clock">,
  now = performance.now(),
): { asked: number; seconds: number; nearEnd: boolean } {
  const held = shellSeconds(timeout, limits);
  const used = usedSeconds(clock, now);
  if (clock === undefined || used === null) return { ...held, nearEnd: false };
  const left = Math.floor(clock.seconds - used - reserveSeconds(clock.seconds));
  return left >= 5 && left < held.seconds
    ? { asked: held.asked, seconds: left, nearEnd: true }
    : { ...held, nearEnd: false };
}

/** The directories of solve `id`, named, not yet made: the runner mounts the cap at `root`. */
export function solveDirs(id: string): SolveDirs {
  const root = join(BUILT_COMMAND_SCRATCH_ROOT, `solve-${id}`);
  return { root, home: join(root, "home"), runs: join(root, "runs"), host: `${root}.host` };
}

/**
 * The base of a wall over `dirs`, with the three folders made: the solver's, the Builder's and the
 * Examiner's are built the same way, and until 10 October each spelled it. `who` names the actor
 * in the refusal of a host that cannot wall one.
 */
export function walledBase(
  dirs: SolveDirs,
  wall: { readonly repoRoot: string; readonly diskBytes: number },
  who: string,
): SolveIsolationPolicy {
  for (const dir of [dirs.home, dirs.runs, dirs.host]) mkdirSync(dir, { recursive: true });
  const base = solveIsolationPolicy({
    repoRoot: wall.repoRoot,
    cap: { root: dirs.root, bytes: wall.diskBytes },
  });
  if ("unsupported" in base) throw new Error(`this host cannot wall ${who}: ${base.unsupported}`);
  return base;
}

/**
 * A command's own folders, made fresh under `runs`: `run` is what is removed when it ends.
 *
 * On a full volume there is no room to make them, and the command that would make room is the one
 * being started. One solve filled its 2 GiB on 2026-10-09 and was then refused `rm -rf ~/w`
 * fourteen times running, each before it started (`ENOSPC` here). So a command that brings nothing
 * starts all the same, with the home as its `work` and its `TMPDIR`: a delete needs neither. One
 * that brings files to stage has nowhere to put them, and fails as the full volume it is.
 */
export function commandDirs(
  dirs: SolveDirs,
  brings: "files" | "nothing",
  make: (prefix: string) => string = mkdtempSync,
): RunDirs & { readonly run: string | null } {
  let run: string | null = null;
  try {
    run = make(join(dirs.runs, "run-"));
    const [work, temp] = [join(run, "work"), join(run, "tmp")];
    mkdirSync(work);
    mkdirSync(temp);
    return { run, work, temp };
  } catch (error) {
    if (run !== null) rmSync(run, { recursive: true, force: true });
    if (brings === "files" || errorCode(error) !== "ENOSPC") throw error;
    return { run: null, work: dirs.home, temp: dirs.home };
  }
}

export async function runWalled(
  wall: CommandWall,
  command: string,
  options: WalledOptions,
): Promise<{ exitCode: number | null }> {
  const { run, work, temp } = commandDirs(wall.dirs, options.stage === undefined ? "nothing" : "files");
  const name = run === null ? "run-on-a-full-volume" : basename(run);
  const profile = join(wall.dirs.host, `${name}.sb`);
  const times = join(wall.dirs.host, `${name}.times`);
  try {
    options.stage?.({ work, temp });
    // A solver may remove its own home, and the next command still starts in one.
    if (options.inHome === true) mkdirSync(wall.dirs.home, { recursive: true });
    const policy = commandIsolationPolicy(wall.base, {
      work,
      home: wall.dirs.home,
      temp,
      toolTree: wall.toolTree,
    });
    // The shell pi starts leads the group and waits here for `times`, so the launch is its child.
    const staged = stageCommandIsolation(policy, profile, command, "$PPID");
    const cwd = options.inHome === true ? wall.dirs.home : work;
    return await SHELL.exec(`(\n${staged}\n)\ns=$?\ntimes > ${shellQuote(times)}\nexit $s`, cwd, {
      onData: options.onData,
      signal: options.signal,
      timeout: heldSeconds(options.timeout, wall).seconds,
      env: policy.environment,
    });
  } finally {
    // What left the command's group is out of its exit trap's reach, and a command the host killed
    // never ran that trap. Both still work on the solve's volume, where one command runs at a time.
    await endHolders(wall.dirs.root);
    const seconds = childSeconds(times);
    if (seconds === null) wall.cpu.unmeasured++;
    else wall.cpu.seconds += seconds;
    if (run !== null) rmSync(run, { recursive: true, force: true });
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
