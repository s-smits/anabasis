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
import { endHolders, hostFolder } from "../sandbox/sandbox-root.ts";
import {
  commandIsolationPolicy,
  shellQuote,
  stageCommandIsolation,
  toolTreeEnv,
} from "../sandbox/isolation.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { BUILT_COMMAND_SCRATCH_ROOT } from "../sandbox/policy.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../sandbox/base.ts";

export interface SolveDirs {
  readonly root: string;
  readonly home: string;
  readonly temp: string;
  readonly kept: string;
  readonly host: string;
}

type ShellLimits = Pick<Limits, "shellDefaultSeconds" | "shellMaxSeconds">;

export interface CommandSandbox {
  readonly base: SolveIsolationPolicy;
  readonly dirs: SolveDirs;
  readonly toolTree: string | null;
  readonly limits: ShellLimits;
  readonly clock?: SolveClock | undefined;
}

export interface Walled {
  readonly repoRoot: string;
  readonly otherTrees?: readonly string[] | undefined;
  readonly packRoots?: readonly string[] | undefined;
  readonly readAllowRoots?: readonly string[] | undefined;
}

const WALL_TESTS = new Map<string, Promise<string | null>>();
const WALL_TEST_MARK = "ANA-WALL-PROBE";
const WALL_TEST_LIMITS = { shellDefaultSeconds: 20, shellMaxSeconds: 20 };

export type NetworkReach = "uv" | "pip" | "unreached";
export const INSTALLER_TOLD: Readonly<Record<Exclude<NetworkReach, "unreached">, string>> = {
  uv: " uv is installed, so use it for Python packages (`uv init`, `uv add`, `uv remove`, `uv run`, `uv tree`) rather than pip.",
  pip: " uv is not installed, so use pip for Python packages.",
};
export const UNREACHED_MS = 10 * 60_000;
const REACH = new Map<string, { readonly at: number; readonly probe: Promise<NetworkReach> }>();
const COMPARISON_REACH = new Map<string, Promise<NetworkReach>>();
const REACH_MARK = "ANA-NETWORK-REACHED";
const UV_MARK = "ANA-UV-FOUND";
const REACH_COMMAND = `(curl -fsS -m 10 -o /dev/null https://pypi.org/simple/pip/ 2>/dev/null || python3 -c 'import urllib.request; urllib.request.urlopen("https://pypi.org/simple/pip/", timeout=10)' 2>/dev/null) && echo ${REACH_MARK} && command -v uv >/dev/null 2>&1 && echo ${UV_MARK}`;

export interface SolveClock {
  started: number | null;
  readonly seconds: number;
}

interface WalledOptions {
  readonly onData: (data: Buffer) => void;
  readonly signal?: AbortSignal | undefined;
  readonly timeout?: number | undefined;
  readonly bound?: number | undefined;
  readonly stage?: ((into: string) => void) | undefined;
}

const SHELL = new NodeExecutionEnv({ cwd: "/", shellPath: "/bin/sh", shellEnv: {} });

export function reserveSeconds(wallSeconds: number): number {
  return Math.min(60, Math.floor(wallSeconds / 8));
}

export function usedSeconds(clock: SolveClock | undefined, now = performance.now()): number | null {
  const started = clock?.started ?? null;
  return started === null ? null : (now - started) / 1000;
}

export function heldSeconds(
  timeout: number | undefined,
  { limits, clock }: Pick<CommandSandbox, "limits" | "clock">,
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

export function solveDirs(id: string): SolveDirs {
  const root = join(BUILT_COMMAND_SCRATCH_ROOT, `solve-${id}`);
  return {
    root,
    home: join(root, "home"),
    temp: join(root, "tmp"),
    kept: join(root, "kept"),
    host: hostFolder(root),
  };
}

export function makeSeatDirs(dirs: SolveDirs): void {
  for (const dir of [dirs.home, dirs.temp, dirs.kept, dirs.host]) mkdirSync(dir, { recursive: true });
}

export async function sandboxBase(dirs: SolveDirs, wall: Walled, who: string): Promise<SolveIsolationPolicy> {
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
    probeSandbox({ base, dirs, toolTree: null, limits: WALL_TEST_LIMITS }, wall.repoRoot, otherTrees[0]);
  WALL_TESTS.set(base.policyHash, tested);
  const said = await tested;
  if (said !== null) {
    if (WALL_TESTS.get(base.policyHash) === tested) WALL_TESTS.delete(base.policyHash);
    throw new Error(`the wall does not hold on this host, so ${who} is not started:\n${said}`);
  }
  return base;
}

export async function probeSandbox(
  wall: CommandSandbox,
  repoRoot: string,
  sibling?: string,
): Promise<string | null> {
  let folder: string | null = null;
  try {
    folder = mkdtempSync(join(resolve(repoRoot), ".ana-wall-probe-"));
    const canary = join(folder, "canary.txt");
    writeFileSync(canary, `${WALL_TEST_MARK}\n`, { mode: 0o600 });
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
      `if true 2>/dev/null > ${shellQuote(written)}; then echo 'host folder: written'; else echo 'host folder: refused'; fi`,
      "cat brought > own && cat own || echo 'own folder: not written and read back'",
    ].join("\n");
    let out = "";
    const { exitCode } = await runSandboxed(wall, command, {
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

async function probeReach(wall: CommandSandbox): Promise<NetworkReach> {
  let out = "";
  await runSandboxed({ ...wall, toolTree: null }, REACH_COMMAND, {
    onData: (data) => {
      out += data.toString();
    },
    timeout: 30,
  }).catch(() => undefined);
  if (!out.includes(REACH_MARK)) return "unreached";
  return out.includes(UV_MARK) ? "uv" : "pip";
}

export async function networkReach(
  wall: CommandSandbox,
  {
    now = Date.now(),
    probe = probeReach,
    comparison,
  }: { now?: number; probe?: typeof probeReach; comparison?: string } = {},
): Promise<NetworkReach> {
  const key = wall.base.policyHash;
  if (comparison !== undefined) {
    const pinnedKey = `${comparison}\0${key}`;
    const pinned = COMPARISON_REACH.get(pinnedKey);
    if (pinned !== undefined) return pinned;
    const reading = networkReach(wall, { now, probe });
    COMPARISON_REACH.set(pinnedKey, reading);
    return reading;
  }
  const known = REACH.get(key);
  if (known !== undefined && (now - known.at < UNREACHED_MS || (await known.probe) !== "unreached")) {
    return known.probe;
  }
  const latest = REACH.get(key);
  if (latest !== undefined && latest !== known) return latest.probe;
  const fresh = { at: now, probe: probe(wall) };
  REACH.set(key, fresh);
  return fresh.probe;
}

export async function runSandboxed(
  wall: CommandSandbox,
  command: string,
  options: WalledOptions,
): Promise<{ exitCode: number | null }> {
  const { dirs } = wall;
  for (const dir of [dirs.home, dirs.temp]) mkdirSync(dir, { recursive: true });
  let into: string | null = null;
  const leader = join(dirs.host, "leader");
  rmSync(leader, { force: true });
  try {
    if (options.stage !== undefined) {
      into = mkdtempSync(join(dirs.kept, "in-"));
      options.stage(into);
    }
    const walled = commandIsolationPolicy(wall.base, { ...dirs, toolTree: wall.toolTree });
    const envScript = keyIfDefined("BASH_ENV", toolTreeEnv(wall.toolTree));
    const policy = { ...walled, environment: { ...walled.environment, ...envScript } };
    const line =
      into === null
        ? command
        : `w=$(mktemp -d "$TMPDIR/in.XXXXXX") || exit\ncp -R ${shellQuote(into)}/. "$w" && cd "$w" && {\n${command}\n}\ns=$?\ncd / && rm -rf "$w"\nexit $s`;
    const staged = stageCommandIsolation(policy, join(dirs.host, "command.sb"), line);
    const seconds = options.bound ?? heldSeconds(options.timeout, wall).seconds;
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
    endHolders(dirs.root, existsSync(leader) ? Number.parseInt(readFileSync(leader, "utf8"), 10) : undefined);
    if (into !== null) rmSync(into, { recursive: true, force: true });
  }
}
