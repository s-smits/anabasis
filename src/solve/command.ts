/**
 * The one place a solve launches a command: the solver's bash calls and the harness's own tool calls
 * both come through `runWalled`, under the command wall v1's Built shell ran under
 * (`stageCommandIsolation`), on pi's local shell backend, which kills the command's process group on
 * a timeout or an abort. Whatever else the command left working on the solve's volume is ended here.
 *
 * A seat (a solve, a Builder's session, an Examiner's) owns two directories under the shared
 * scratch parent, which the command wall closes to every seat but its own:
 * - `root`, the capped volume (`mountDiskCap`), which its commands write whole: `home`, kept between
 *   commands and never read back, and `tmp`, their `TMPDIR` for the seat's whole life. The one part
 *   they may not write is `kept`, where the host writes what must not follow a link a command made:
 *   pi's long output, written while the command runs, and what a command brings, staged before it
 *   starts.
 * - `host`, beside it and outside the cap, which no command can read: the staged profile and the
 *   model backend's own state, such as Claude Code's configuration and transcripts.
 *
 * A command starts in the home, the one working directory pi's coding tools share: until
 * 2026-10-09 the solver's started in a folder of their own, and nine in ten of them began with
 * `cd ~` (the Starter solves of six campaigns, `docs/transfer.md`). A command that brings files, a
 * harness's tool call or a file tool's write, starts in a folder of its own beside a copy of them
 * (`runWalled`).
 *
 * Until 2026-10-11 each command had a fresh folder and `TMPDIR` of its own, under a policy and a
 * profile file of its own that named them (`docs/simplify.md`, W3).
 *
 * Until 2026-10-11 a shell around the wall read each command's CPU time with `times`, and a solve
 * reported the sum. It counted only the children a command waited for, read zero under
 * Bubblewrap, and a command cut at its limit took the record with it, so the figure was a floor
 * on the host that runs campaigns and nothing on the other; no budget was given in it since
 * 9 October, and it went with the readings at shorter budgets (`docs/simplify.md`, A3).
 */
import { createLocalBashOperations } from "../../vendor/pi-coding-agent/core/tools/bash.ts";
import type { Limits } from "../kernel/condition.ts";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { join, resolve } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { endHolders } from "../verify/disk-cap.ts";
import {
  commandIsolationPolicy,
  shellQuote,
  stageCommandIsolation,
} from "../verify/solve-command-isolation.ts";
import { BUILT_COMMAND_SCRATCH_ROOT } from "../verify/wall-policy.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../verify/solve-sandbox.ts";

export interface SolveDirs {
  /** The capped volume's mount point, which the seat's commands write but for `kept`. */
  readonly root: string;
  readonly home: string;
  /** `TMPDIR`, for the seat's whole life. */
  readonly temp: string;
  /** On the volume, and written by the host alone; a command reads it. */
  readonly kept: string;
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
  /** The solve's own time, which its commands are held to near its end (`heldSeconds`). A Builder's
   *  wall has none: its session ends when its model's turn does. */
  readonly clock?: SolveClock | undefined;
}

/** What a wall denies and caps: the repository the command runs in, its other worktrees, the
 *  stored pack a campaign opened over, and the disk a solve, a session or an Examiner may fill. */
export interface Walled {
  readonly repoRoot: string;
  /** The repository's other worktrees (`worktreesOf`, `tools/d2/campaign.ts`); none where the
   *  caller knows of none, as a test does. */
  readonly otherTrees?: readonly string[] | undefined;
  /** The stored pack's root and bundle, which hold the exam's hidden values; none where the
   *  campaign opened from a prompt, whose exam lies in the repository. */
  readonly packRoots?: readonly string[] | undefined;
  /** What the wall opens again for reading inside what it closes: the verifier's tool tree an
   *  Examiner's engines run from (`src/examiner/shell.ts`); none for any other seat. */
  readonly readAllowRoots?: readonly string[] | undefined;
  readonly diskBytes: number;
}

/** The probe of each policy this process has started, by its hash: once a process, and the promise
 *  so that seats that start together wait on one probe (`probeWall`). One that did not hold is
 *  dropped, so the next seat probes again. */
const PROBED = new Map<string, Promise<string | null>>();
/** What the host stages for the probe's command, which writes it in its own folder and reads it
 *  back: the probe's control. */
const PROBE_MARK = "ANA-WALL-PROBE";
/** The probe's command is held to what v1's probe was: twenty seconds. */
const PROBE_LIMITS = { shellDefaultSeconds: 20, shellMaxSeconds: 20 };

/**
 * Whether a package index is reached from inside the wall: `reached` where a command run as a
 * solver's fetched one when this process first asked, `unreached` where it did not. The solver's
 * prompt said "commands have network access" whatever the host did: on the Linux host of
 * 10 October the wall's commands get an empty environment and no resolver, 0 of 143 solves of t-10
 * installed anything, and 26 of the 34 that ran out of turns had spent one on a pip install
 * (its whole-run investigation, lanes 14 and 27). A sentence a host makes false is the host's to
 * make true, so the prompt now says what the probe found.
 */
export type NetworkReach = "reached" | "unreached";
/** The reach of each policy this process has probed, by its hash: once a process, and the promise
 *  so that solves that start together wait on one probe. */
const REACH = new Map<string, Promise<NetworkReach>>();
const REACH_MARK = "ANA-NETWORK-REACHED";
/** The index pip reads; curl first, and the resolver pip itself uses where curl is not on the host. */
const REACH_COMMAND = `(curl -fsS -m 10 -o /dev/null https://pypi.org/simple/pip/ 2>/dev/null || python3 -c 'import urllib.request; urllib.request.urlopen("https://pypi.org/simple/pip/", timeout=10)' 2>/dev/null) && echo ${REACH_MARK}`;

/** A solve's time: when its first turn started, null until it has, and how long the solve may be. */
export interface SolveClock {
  started: number | null;
  readonly seconds: number;
}

interface WalledOptions {
  readonly onData: (data: Buffer) => void;
  readonly signal?: AbortSignal | undefined;
  /** Seconds asked for, held to the limits by `shellSeconds`; pi's backend throws
   *  `timeout:<seconds>` when the command runs past what it was given. */
  readonly timeout?: number | undefined;
  /** Writes what the command brings into `into`, a fresh folder under the seat's `kept`, before it
   *  starts. */
  readonly stage?: ((into: string) => void) | undefined;
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
  return {
    root,
    home: join(root, "home"),
    temp: join(root, "tmp"),
    kept: join(root, "kept"),
    host: `${root}.host`,
  };
}

/** Makes the folders of `dirs` below its root, which the cap's mount made. */
export function makeSeatDirs(dirs: SolveDirs): void {
  for (const dir of [dirs.home, dirs.temp, dirs.kept, dirs.host]) mkdirSync(dir, { recursive: true });
}

/**
 * The base of a wall over `dirs`, with its folders made: the solver's, the Builder's and the
 * Examiner's are built the same way, and until 10 October each spelled it. `who` names the actor
 * in the refusal of a host that cannot wall one.
 *
 * The wall is a test and no convention (`AGENTS.md`, rule 3): before its first use in a process
 * each policy is probed (`probeWall`), and a probe that does not hold refuses the wall with its own
 * lines. Until 10 October the probe ran in the test suite alone, and a sibling worktree's log was
 * readable in every live run.
 */
export async function walledBase(dirs: SolveDirs, wall: Walled, who: string): Promise<SolveIsolationPolicy> {
  makeSeatDirs(dirs);
  const otherTrees = wall.otherTrees ?? [];
  const base = solveIsolationPolicy({
    repoRoot: wall.repoRoot,
    otherTrees,
    packRoots: wall.packRoots ?? [],
    readAllowRoots: wall.readAllowRoots ?? [],
  });
  if ("unsupported" in base) throw new Error(`this host cannot wall ${who}: ${base.unsupported}`);
  const probe =
    PROBED.get(base.policyHash) ??
    probeWall({ base, dirs, toolTree: null, limits: PROBE_LIMITS }, wall.repoRoot, otherTrees[0]);
  PROBED.set(base.policyHash, probe);
  const said = await probe;
  if (said !== null) {
    if (PROBED.get(base.policyHash) === probe) PROBED.delete(base.policyHash);
    throw new Error(`the wall does not hold on this host, so ${who} is not started:\n${said}`);
  }
  return base;
}

/**
 * Whether `wall` holds, by one command launched as every command of a seat is (`runWalled`): a
 * canary the host writes in the repository is refused to it, as is `sibling`'s `package.json`,
 * which every worktree of this repository holds, and a write in the host's folder in the seat; and
 * a file the host staged for it reaches its own folder, is written there and reads back. Null where
 * all four held, and otherwise the command's output, a line a step. The last step is the probe's
 * control: a launch that refuses everything fails it, as one that refuses nothing fails the first.
 *
 * Until 11 October the probe ran v1's launch of its sandboxed model process, which no seat of v2
 * runs, under a policy of its own that only the probe used (`docs/simplify.md`, F5). Nothing is
 * written in the sibling, which another user may own: a rehearsal as the campaign user refused
 * every solve on EACCES in the root-owned main tree when the probe wrote a canary there (10 October).
 */
export async function probeWall(
  wall: CommandWall,
  repoRoot: string,
  sibling?: string,
): Promise<string | null> {
  let folder: string | null = null;
  try {
    folder = mkdtempSync(join(resolve(repoRoot), ".ana-wall-probe-"));
    const canary = join(folder, "canary.txt");
    writeFileSync(canary, `${PROBE_MARK}\n`, { mode: 0o600 });
    // A sibling without the file proves nothing by refusing it, so it is not tried.
    const theirs = sibling === undefined ? null : join(resolve(sibling), "package.json");
    const reads = [{ name: "repository canary", path: canary }];
    if (theirs !== null && existsSync(theirs)) {
      reads.push({ name: "other worktree's package.json", path: theirs });
    }
    const written = join(wall.dirs.kept, "probe");
    const command = [
      ...reads.map(
        ({ name, path }) =>
          `if cat ${shellQuote(path)} >/dev/null 2>&1; then echo ${shellQuote(`${name}: read`)}; else echo ${shellQuote(`${name}: refused`)}; fi`,
      ),
      // `true`, not `:`: dash, Linux's `sh`, ends the script where a special builtin's redirection fails.
      `if true 2>/dev/null > ${shellQuote(written)}; then echo 'host folder: written'; else echo 'host folder: refused'; fi`,
      "cat brought > own && cat own || echo 'own folder: not written and read back'",
    ].join("\n");
    let out = "";
    const { exitCode } = await runWalled(wall, command, {
      onData: (data) => {
        out += data.toString();
      },
      stage: (into) => writeFileSync(join(into, "brought"), `${PROBE_MARK}\n`),
    });
    const lines = out.trim().split("\n");
    const refused = [...reads.map(({ name }) => name), "host folder"].every((name) =>
      lines.includes(`${name}: refused`),
    );
    return refused && lines.includes(PROBE_MARK) ? null : `${out.trim()}\nexit ${String(exitCode)}`;
  } catch (error) {
    return `the probe did not run: ${errorMessage(error)}`;
  } finally {
    if (folder !== null) rmSync(folder, { recursive: true, force: true });
    rmSync(join(wall.dirs.kept, "probe"), { force: true });
  }
}

/** The reach of the wall `wall` stands for, probed once a process (`NetworkReach`). A probe that
 *  fails to run reads as unreached. */
export function networkReach(wall: CommandWall): Promise<NetworkReach> {
  const key = wall.base.policyHash;
  const known = REACH.get(key);
  if (known !== undefined) return known;
  const probe = (async (): Promise<NetworkReach> => {
    let out = "";
    await runWalled(wall, REACH_COMMAND, {
      onData: (data) => {
        out += data.toString();
      },
      timeout: 30,
    });
    return out.includes(REACH_MARK) ? "reached" : "unreached";
  })().catch((): NetworkReach => "unreached");
  REACH.set(key, probe);
  return probe;
}

/**
 * Runs `command` on `wall`, in the seat's home, or beside a copy of what it brings (`stage`).
 *
 * A command that brings nothing makes nothing to start. One solve filled its 2 GiB on 2026-10-09
 * and was then refused `rm -rf ~/w` fourteen times running, each before it started, when every
 * command made a folder of its own first. One that brings files has nowhere to stage them on a
 * full volume, and fails as the full volume it is.
 */
export async function runWalled(
  wall: CommandWall,
  command: string,
  options: WalledOptions,
): Promise<{ exitCode: number | null }> {
  const { dirs } = wall;
  // A solver may remove its own home or its `TMPDIR`, and the next command still has both.
  for (const dir of [dirs.home, dirs.temp]) mkdirSync(dir, { recursive: true });
  let into: string | null = null;
  try {
    if (options.stage !== undefined) {
      into = mkdtempSync(join(dirs.kept, "in-"));
      options.stage(into);
    }
    const policy = commandIsolationPolicy(wall.base, { ...dirs, toolTree: wall.toolTree });
    // A command that brings files starts in a folder it makes for itself under its `TMPDIR`, fills
    // with a copy of them, and removes when it ends. The folder has to be one it can write, as a
    // harness's tool may write where it starts and a program it runs may too. And the host writes
    // nothing a command can write: one that outran its end (`endHolders` ends only what holds the
    // volume) could swap a folder the host was about to write for a link. So the host stages where
    // no command can write, and the copy is the command's own, under the wall.
    const line =
      into === null
        ? command
        : `w=$(mktemp -d "$TMPDIR/in.XXXXXX") || exit\ncp -R ${shellQuote(into)}/. "$w" && cd "$w" && {\n${command}\n}\ns=$?\ncd / && rm -rf "$w"\nexit $s`;
    // The shell pi starts leads the group and waits here on a subshell, so the launch is its child
    // and the leader is its parent; the exit code is the subshell's. One seat's commands run one at
    // a time, so they share one profile file.
    const staged = stageCommandIsolation(policy, join(dirs.host, "command.sb"), line, "$PPID");
    return await SHELL.exec(`(\n${staged}\n)`, dirs.home, {
      onData: options.onData,
      signal: options.signal,
      timeout: heldSeconds(options.timeout, wall).seconds,
      env: policy.environment,
    });
  } finally {
    // What left the command's group is out of its exit trap's reach, and a command the host killed
    // never ran that trap. Both still work on the seat's volume, where one command runs at a time.
    await endHolders(dirs.root);
    if (into !== null) rmSync(into, { recursive: true, force: true });
  }
}
