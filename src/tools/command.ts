/**
 * The one place a solve launches a command: the solver's bash calls and the harness's own tool calls
 * both come through `runWalled`, under the command wall v1's Built shell ran under
 * (`stageCommandIsolation`), on durable's local shell backend, which kills the command's process group on
 * a timeout or an abort. Whatever else the command left in its group, below it or working in the
 * seat's root is ended here.
 *
 * A seat (a solve, a Builder's session, an Examiner's) owns two directories under the shared
 * scratch parent, which the command wall closes to every seat but its own:
 * - `root`, claimed for the seat (`claimRoot`), which its commands write whole: `home`, kept between
 *   commands and never read back, and `tmp`, their `TMPDIR` for the seat's whole life. The one part
 *   they may not write is `kept`, where the host stages what a command brings before it starts,
 *   without following a link a command made. Long shell output is written under the wall in home.
 * - `host`, beside it, which no command can read: the staged profile and the
 *   model backend's own state, such as Claude Code's configuration and transcripts.
 *
 * A command starts in the home, the one working directory pi's coding tools share: when each
 * started in a folder of its own, nine in ten of the solver's began with `cd ~` (the Starter
 * solves of six campaigns, `docs/transfer.md`). A command that brings files, a harness's tool call
 * or a file tool's write, starts in a folder of its own beside a copy of them (`runWalled`).
 */
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { Limits } from "../kernel/condition.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { join, resolve } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { endHolders } from "../wall/seat-root.ts";
import { commandIsolationPolicy, shellQuote, stageCommandIsolation } from "../wall/isolation.ts";
import { BUILT_COMMAND_SCRATCH_ROOT } from "../wall/policy.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../wall/base.ts";

export interface SolveDirs {
  /** The seat's own folder, which its commands write but for `kept`. */
  readonly root: string;
  readonly home: string;
  /** `TMPDIR`, for the seat's whole life. */
  readonly temp: string;
  /** In the root, and written by the host alone; a command reads it. */
  readonly kept: string;
  /** Host-only: beside the root, closed to every command. */
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

/** What a wall denies: the repository the command runs in, its other worktrees and the stored
 *  pack a campaign opened over. */
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
}

/** Each policy's wall test, by its hash: once per process, with the promise shared by seats
 *  starting together (`probeWall`). A failed test is dropped, so the next seat tests again. */
const WALL_TESTS = new Map<string, Promise<string | null>>();
/** The wall test must also write and read back its own file, so refusing every operation fails. */
const WALL_TEST_MARK = "ANA-WALL-PROBE";
/** The wall test command keeps v1's twenty-second deadline. */
const WALL_TEST_LIMITS = { shellDefaultSeconds: 20, shellMaxSeconds: 20 };

/**
 * Whether a package index is reached from inside the wall: `reached` where a command run as a
 * solver's fetched one when this process first asked, `unreached` where it did not. A prompt that
 * said "commands have network access" whatever the host did was false on the Linux host of
 * 10 October, where the wall's commands had an empty environment and no resolver: 0 of 143 solves
 * of one campaign installed anything, and 26 of the 34 that ran out of turns had spent one on a pip
 * install. A sentence a host makes false is the host's to make true, so the prompt says what the
 * probe found.
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
  /** Seconds asked for, held to the limits by `heldSeconds`; pi's backend throws
   *  `timeout:<seconds>` when the command runs past what it was given. */
  readonly timeout?: number | undefined;
  /** Writes what the command brings into `into`, a fresh folder under the seat's `kept`, before it
   *  starts. */
  readonly stage?: ((into: string) => void) | undefined;
}

/** The host's launcher, outside the wall: it writes the leader's pid and `exec`s the wall, and a
 *  seat's command reaches it only quoted, to run in `/bin/bash` inside (`stageCommandIsolation`). */
const SHELL = new NodeExecutionEnv({ cwd: "/", shellPath: "/bin/sh", shellEnv: {} });

/** The solve's reserve for command results: a minute, and an eighth of a solve shorter than eight. */
export function reserveSeconds(wallSeconds: number): number {
  return Math.min(60, Math.floor(wallSeconds / 8));
}

/** The seconds of its time a solve has used, or null where it has no clock or has not started. */
export function usedSeconds(clock: SolveClock | undefined, now = performance.now()): number | null {
  const started = clock?.started ?? null;
  return started === null ? null : (now - started) / 1000;
}

/**
 * How long a command that starts now may run: the condition's limits, shortened to the whole seconds
 * left before its reserve only when positive. `nearEnd` says that shortened it. `asked` is
 * what was named, floored and at least 1 s, and a named value only raises the default, up to the
 * maximum, as v1's Built shell held it.
 *
 * A command held to its own limits alone took the solve with it when the solve's deadline expired inside
 * it: at a five-minute deadline 12 of 46 Starter solves ended at it, 11 of them inside a command, with
 * nothing sent. So a command returns while there is time to act on it. One started inside
 * the reserve is left to its own limits: the solver is told the time used with every result, and
 * what it starts then is its own to judge. Until 15 October one started under five seconds before
 * the reserve kept its own limits too, while the solver is told such a command is cut (lane 14 of
 * main0_5_1's investigation).
 */
export function heldSeconds(
  timeout: number | undefined,
  { limits, clock }: Pick<CommandWall, "limits" | "clock">,
  now = performance.now(),
) {
  const asked = Math.max(1, Math.floor(timeout ?? limits.shellDefaultSeconds));
  const seconds = Math.min(Math.max(asked, limits.shellDefaultSeconds), limits.shellMaxSeconds);
  const used = usedSeconds(clock, now);
  if (clock === undefined || used === null) return { asked, seconds, nearEnd: false };
  const left = Math.floor(clock.seconds - used - reserveSeconds(clock.seconds));
  return left > 0 && left < seconds
    ? { asked, seconds: left, nearEnd: true }
    : { asked, seconds, nearEnd: false };
}

/** The directories of solve `id`, named, not yet made: the runner claims `root` (`claimRoot`). */
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

/** Makes the folders of `dirs` below its root, which its claim made. */
export function makeSeatDirs(dirs: SolveDirs): void {
  for (const dir of [dirs.home, dirs.temp, dirs.kept, dirs.host]) mkdirSync(dir, { recursive: true });
}

/**
 * The base of a wall over `dirs`, with its folders made: the solver's, the Builder's and the
 * Examiner's are built the same way, here. `who` names the actor in the refusal of a host that
 * cannot wall one.
 *
 * The wall is a test and no convention (`AGENTS.md`, rule 3): before its first use in a process
 * each policy runs its wall test (`probeWall`), and a failed test refuses the start with its own
 * lines. While the wall test ran in the test suite alone, a sibling worktree's log was readable in
 * every live run (10 October).
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
  const tested =
    WALL_TESTS.get(base.policyHash) ??
    probeWall({ base, dirs, toolTree: null, limits: WALL_TEST_LIMITS }, wall.repoRoot, otherTrees[0]);
  WALL_TESTS.set(base.policyHash, tested);
  const said = await tested;
  if (said !== null) {
    if (WALL_TESTS.get(base.policyHash) === tested) WALL_TESTS.delete(base.policyHash);
    throw new Error(`the wall does not hold on this host, so ${who} is not started:\n${said}`);
  }
  return base;
}

/**
 * The wall test uses one command launched as every command of a seat is (`runWalled`): a
 * canary the host writes in the repository is refused to it, as is `sibling`'s `package.json`,
 * which every worktree of this repository holds, and a write in the host's folder in the seat; and
 * a file the host staged for it reaches its own folder, is written there and reads back. Null where
 * all four held, and otherwise the command's output, a line a step. The last step tests its own
 * write and read: a launch that refuses everything fails it, as one that refuses nothing fails the first.
 *
 * Nothing is written in the sibling, which another user may own: a rehearsal as the campaign user refused
 * every solve on EACCES in the root-owned main tree when the wall test wrote a canary there (10 October).
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
    writeFileSync(canary, `${WALL_TEST_MARK}\n`, { mode: 0o600 });
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
      // `true`, not `:`: a POSIX shell such as dash ends the script where a special builtin's
      // redirection fails, so the wall test stays whole whichever shell runs it.
      `if true 2>/dev/null > ${shellQuote(written)}; then echo 'host folder: written'; else echo 'host folder: refused'; fi`,
      "cat brought > own && cat own || echo 'own folder: not written and read back'",
    ].join("\n");
    let out = "";
    const { exitCode } = await runWalled(wall, command, {
      onData: (data) => {
        out += data.toString();
      },
      stage: (into) => writeFileSync(join(into, "brought"), `${WALL_TEST_MARK}\n`),
    });
    const lines = out.trim().split("\n");
    const refused = [...reads.map(({ name }) => name), "host folder"].every((name) =>
      lines.includes(`${name}: refused`),
    );
    return refused && lines.includes(WALL_TEST_MARK) ? null : `${out.trim()}\nexit ${String(exitCode)}`;
  } catch (error) {
    return `the wall test did not run: ${errorMessage(error)}`;
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
 * A command that brings nothing makes nothing to start. One solve filled its 2 GiB disk cap on
 * 9 October and was then refused `rm -rf ~/w` fourteen times running, each before it started, when
 * every command made a folder of its own first. One that brings files has nowhere to stage them on
 * a full disk, and fails as the full disk it is.
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
  // pi's shell leads the command's group, and writes its pid here, where no command can write,
  // before it becomes the command.
  const leader = join(dirs.host, "leader");
  rmSync(leader, { force: true });
  try {
    if (options.stage !== undefined) {
      into = mkdtempSync(join(dirs.kept, "in-"));
      options.stage(into);
    }
    const policy = commandIsolationPolicy(wall.base, { ...dirs, toolTree: wall.toolTree });
    // A command that brings files starts in a folder it makes for itself under its `TMPDIR`, fills
    // with a copy of them, and removes when it ends. The folder has to be one it can write, as a
    // harness's tool may write where it starts and a program it runs may too. And the host writes
    // nothing a command can write: one that outran its end (`endHolders` ends only what works in the
    // root) could swap a folder the host was about to write for a link. So the host stages where
    // no command can write, and the copy is the command's own, under the wall.
    const line =
      into === null
        ? command
        : `w=$(mktemp -d "$TMPDIR/in.XXXXXX") || exit\ncp -R ${shellQuote(into)}/. "$w" && cd "$w" && {\n${command}\n}\ns=$?\ncd / && rm -rf "$w"\nexit $s`;
    // One seat's commands run one at a time, so they share one profile file and one leader file.
    const staged = stageCommandIsolation(policy, join(dirs.host, "command.sb"), line);
    const seconds = heldSeconds(options.timeout, wall).seconds;
    const result = await SHELL.exec(
      `echo $$ > ${shellQuote(leader)}\n${staged}`,
      {
        cwd: dirs.home,
        onOutput: (text) => options.onData(Buffer.from(text)),
        timeout: seconds,
        env: policy.environment,
        inheritEnv: false,
      },
      options.signal === undefined ? BACKGROUND_CONTEXT : withAbortSignal(options.signal, BACKGROUND_CONTEXT),
    );
    if (!result.ok) {
      if (result.error.code === "timeout") {
        throw new Error(`timeout:${String(seconds)}`, { cause: result.error });
      }
      throw result.error;
    }
    return { exitCode: result.value.exitCode };
  } finally {
    // The group outlives its leader while a member lives, and a command pi killed on a timeout or an
    // abort is ended the same way. One whose shell never started names no group, and a pid cut
    // short reads as NaN, which names none either.
    endHolders(dirs.root, existsSync(leader) ? Number.parseInt(readFileSync(leader, "utf8"), 10) : undefined);
    if (into !== null) rmSync(into, { recursive: true, force: true });
  }
}
