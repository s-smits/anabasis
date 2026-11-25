/**
 * The check runner: `run.js <tree> <bun pin> <test|typecheck|lint|secrets|gate> [arguments...]`,
 * which the bun router (`bun` in this folder) calls for a tree's check tasks. `ANA_CHECK_HOST` says
 * where the task runs: `auto` on the first with a free slot of this machine and every unbenched host
 * `ANA_HOSTS` lists (excluding benchmark hosts named by `EVAL_RUNNER`), least loaded first by
 * one-minute load a core plus active local slot occupancy (`placesFor`); unset or empty as `auto`
 * where the list names a host, and otherwise here without a sample, as where the host list cannot be
 * read; `here` on this machine, without reading the host list; a host's name or ssh destination on
 * that host; `all` as `auto` over the places under half their cores' one-minute load (the least
 * loaded where none is), where a test task that names only test files and folders (or nothing, for
 * all of `test/`) has their files cut into chunks of like time by the running means each place's
 * runs measured (`learn`, from the timings a run rewrote, kept in the repository's common git
 * folder for every worktree; a file no place measured weighs the median), a chunk to a minute of
 * them or more and at most two a slot, each in the first free slot among the places that still
 * give verdicts, with the files that gate on Linux or on the OS wall run again as one chunk on a
 * free Linux host (`placesFor`), and exits as the first failing chunk, or as no verdict where a
 * chunk found no place (`sharded`); a test task with any other argument, such as a name pattern, runs whole, since
 * a chunk the pattern misses fails; and where the gate leads on this machine, outside any slot, so
 * that its own test, typecheck and lint steps are routed in turn. Any other value is refused with
 * the names to write. Wherever it runs, the task is `task.sh` over the working tree as it stands,
 * uncommitted bytes included, and its exit status is this command's. A task here starts without what the bun router read from the host list for this
 * command alone (`CALLER_ENV`), as one sent to a host does, so no test reaches the fleet it names.
 *
 * **What reaches a host.** Git carries the tree: the working tree becomes one commit in place of
 * `HEAD` (`snapshot`), pushed to the slot's own repository on the host, which borrows the objects
 * of the host's configured tree, so a push sends what that host has not already fetched from
 * GitHub, usually the uncommitted change alone. Git decides what a tree is, so nothing it ignores
 * travels, the dependencies among them: the slot installs those from the lockfiles it was sent,
 * once per lockfile (`task.sh`). The snapshot keeps `HEAD`'s parents, so a static gate there chooses
 * the tests it would choose here, where a parentless snapshot would read every file as changed.
 *
 * Settings, each optional, in seconds unless said: `ANA_RUNNER_WALL` (a task's deadline, 3600),
 * `ANA_RUNNER_QUEUE_WAIT` (the wait for a slot, 2400; exit 75 past it), `ANA_RUNNER_MIN_FREE_GB`
 * (free space a host must have, 3; exit 69 below it or where it does not answer),
 * `ANA_RUNNER_RETRY_DELAY` (5), `ANA_RUNNER_PICK_WAIT` (how long `auto` waits for each machine's
 * load, 5). A host needs only ssh, bash, git, curl and unzip, and gets the
 * tree's pinned Bun on its first task. `install.ts` bundles this file as the installed `run.js`.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { hostTool } from "#src/meta/host-tool.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, type JsonValue } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { capturedSpawn, processAnswers, runtimeProcess } from "#src/meta/process.ts";
import { errorCode, errorMessage } from "#src/meta/runtime-values.ts";
import { sshOptions } from "#src/meta/ssh.ts";
import { killProcessGroup, runCaptured, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { quoted, shellPath, sshCommand } from "../../runs/host-command.ts";
import {
  type Bench,
  benchesOf,
  checkHost,
  checkSlots,
  hostsOf,
  ownName,
  RUNNER_SLOTS,
  type Host,
  NO_VERDICT,
  spread,
} from "../../runs/host-config.ts";
import { minuteLoads } from "../../runs/load.ts";

const TASKS = ["test", "typecheck", "lint", "secrets", "gate"];
/** What a check reads from its caller, sent by name since ssh carries no environment. */
const FORWARDED = [
  "ANA_LINT_STRICT",
  "ANA_LINT_PATHS",
  "ANA_TEST_BAIL",
  "ANA_TEST_WORKERS",
  "ANA_TEST_HOST_LOAD",
  "ANA_CLIMB",
];
/** Exits that say nothing about the tree (`NO_VERDICT`, tools/runs/host-config.ts), and the others. */
const EXIT = { usage: 2, unavailable: 69, noSlot: 75, interrupted: 130, noVerdict: 255 } as const;
const TASK_SCRIPT = join(import.meta.dir, "task.sh");
const EPOCH = "2000-01-01T00:00:00Z";
const IDENTITY = ["-c", "user.name=Runner Snapshot", "-c", "user.email=runner@snapshot.invalid"];

interface Ran {
  readonly status: number;
  readonly times: string;
}

/** One task: the tree it checks, the Bun that tree pins, the task with its arguments, its deadline. */
interface Job {
  readonly root: string;
  readonly pin: string;
  readonly task: readonly string[];
  readonly wall: number;
}

interface Slot {
  readonly path: string;
  readonly number: number;
}

/** A place a task may run: a host, or undefined for this machine. */
type Place = Host | undefined;

class Refusal extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

const heldByThisRunner = new Set<string>();

const say = (line: string): void => console.error(`runner: ${line}`);

/** A setting as a count, or `fallback` where it is unset. */
function setting(name: string, fallback: number): number {
  const text = runtimeProcess.env[name] ?? "";
  if (text === "") return fallback;
  if (!/^\d+$/u.test(text)) {
    throw new Refusal(`${name} must be a non-negative integer, got '${text}'`, EXIT.usage);
  }
  return Number(text);
}

/** `ANA_HOSTS`, and the benchmarks `EVAL_RUNNER` rolls on them, for the `ANA_CHECK_HOST` value `choice`,
 *  refused in the runner's own words where either cannot be read and the value asked for a host. */
function listed(choice: string): { hosts: readonly Host[]; benches: readonly Bench[] } {
  try {
    return { hosts: hostsOf(), benches: benchesOf() };
  } catch (error) {
    // Unset asked for no host, so a list it cannot read leaves the task here instead of refusing it.
    if (choice === "") {
      say(`${errorMessage(error)}; runs here`);
      return { hosts: [], benches: [] };
    }
    throw new Refusal(`${errorMessage(error)}; ANA_CHECK_HOST=here runs the task here`, EXIT.usage);
  }
}

/**
 * Whether a benchmark's arm holds `host`: an arm's rollouts are read against each other at equal
 * load, so a check beside them moves what they score, and a gate sent there during a sitting can
 * load the machine until it stops answering and the arm has to be rolled again. A
 * sitting whose `status` does not answer `idle` on its first line (`bench.ts`) holds it, a silent
 * one too. A held host is said with `then`, what the runner does about it.
 */
async function armHolds(
  { name, ssh }: Host,
  benches: readonly Bench[],
  then: string,
  timeoutMs: number,
): Promise<boolean> {
  const asked = benches
    .filter((bench) => bench.host?.name === name)
    .map(async ({ sitting }) => {
      const child = capturedSpawn(["ssh", ...sshOptions(ssh), ssh, `${shellPath(sitting)} status`], {
        detached: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child, "SIGKILL");
      }, timeoutMs);
      timer.unref();
      try {
        const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        return timedOut || exitCode !== 0 || stdout.split("\n")[0]?.trim() !== "idle";
      } finally {
        clearTimeout(timer);
      }
    });
  const holds = (await Promise.all(asked)).some(Boolean);
  if (holds) say(`a benchmark's arm holds ${name}: ${then}`);
  return holds;
}

function slotFolder(place: Place): string {
  return join(tmpdir(), "ana-runner", place?.ssh ?? "local");
}

function slotCapacity(place: Place): number {
  return place === undefined ? 1 : checkSlots(place);
}

/** Whether `path` holds a live runner slot; `"clean"` also clears stale symlinks, stray files, and dead entries. */
function slotOccupied(path: string, mode: "read" | "clean"): boolean {
  const live = (holder: string): boolean =>
    holder === String(runtimeProcess.pid)
      ? heldByThisRunner.has(path)
      : /^[1-9]\d*$/u.test(holder) && processAnswers(Number(holder));
  let linkTarget: string | null = null;
  try {
    linkTarget = readlinkSync(path);
  } catch {
    // Not a symlink (absent, a slot folder, or a stray file).
  }
  if (linkTarget !== null) {
    if (live(linkTarget)) return true;
    if (mode === "clean") rmSync(path, { force: true });
    return false;
  }
  let held: string[] = [];
  try {
    held = readdirSync(path);
  } catch (error) {
    // A stray regular file at the slot path would otherwise reject renameSync with ENOTDIR forever.
    if (mode === "clean" && errorCode(error) === "ENOTDIR") rmSync(path, { force: true });
  }
  if (held.some(live)) return true;
  if (mode === "clean") {
    for (const dead of held) rmSync(join(path, dead), { recursive: true, force: true });
  }
  return false;
}

/**
 * Where `ANA_CHECK_HOST` lets the task run, in the order its slots are tried, and whether loads chose
 * it: this machine alone, the one host it names, or for `auto` this machine and every unbenched host
 * listed, ranked by one-minute load a core plus the fraction of local runner slots already held
 * (`slotOccupied`), so burst launches fan across free machines before 1m load reacts. Hosts named by
 * `EVAL_RUNNER` are never picked, and `auto` never reads them; `all` reads them too, so that a Linux
 * host under half load that no arm holds, benched or not, is `linux`, where the test files that gate
 * on Linux or on the OS wall run once more; naming one explicitly
 * checks `armHolds` (warning on override, or refusing with `EXIT.unavailable` under
 * `ANA_RUNNER_SPARE_HELD`). A machine that does not answer within `ANA_RUNNER_PICK_WAIT` is omitted,
 * and where none answers the task runs here.
 */
async function placesFor(
  shards: boolean,
): Promise<{ places: readonly Place[]; picked: boolean; linux: Host | null }> {
  const choice = checkHost()?.trim() ?? "";
  const here = { places: [undefined], picked: false, linux: null };
  if (choice === "here") return here;
  const { hosts, benches } = listed(choice);
  if (choice === "" && hosts.length === 0) return here;
  const waitMs = setting("ANA_RUNNER_PICK_WAIT", 5) * 1000;
  if (choice === "" || choice === "auto" || choice === "all") {
    const started = performance.now();
    const benched = new Set(benches.flatMap((bench) => (bench.host === undefined ? [] : [bench.host.name])));
    const { order: read, silent } = await minuteLoads(
      [undefined, ...hosts.filter((host) => shards || !benched.has(host.name))],
      waitMs,
    );
    const linux = shards
      ? read.find(({ host, share, system }) => host !== undefined && system === "Linux" && share < 0.5)?.host
      : undefined;
    const sampled = read.filter(({ host }) => host === undefined || !benched.has(host.name));
    const ranked = sampled
      .map(({ label, host, share }) => {
        const slots = slotCapacity(host);
        const busy = Array.from({ length: slots }, (_, index) => index + 1).filter((number) =>
          slotOccupied(join(slotFolder(host), `slot-${String(number)}`), "read"),
        ).length;
        return { label, host, share, busy, slots, score: share + busy / slots };
      })
      .toSorted((a, b) => a.score - b.score);
    const loads = ranked.map(
      ({ label, share, busy, slots }) =>
        `${label} ${share.toFixed(2)}${busy > 0 ? ` [${String(busy)}/${String(slots)}]` : ""}`,
    );
    const took = ((performance.now() - started) / 1000).toFixed(1);
    say(
      `auto: 1m load a core ${loads.join(", ") || "from none"}${
        silent.length === 0 ? "" : `; no answer from ${silent.join(", ")}`
      } (read in ${took}s)`,
    );
    const cool = choice === "all" ? ranked.filter(({ share }) => share < 0.5) : ranked;
    const kept = cool.length === 0 ? ranked.slice(0, 1) : cool;
    const spare =
      linux === undefined ||
      !benched.has(linux.name) ||
      !(await armHolds(linux, benches, "its Linux test files run on no Linux host", waitMs));
    return {
      places: kept.length === 0 ? [undefined] : kept.map(({ host }) => host),
      picked: true,
      linux: linux !== undefined && spare ? linux : null,
    };
  }
  const host = hosts.find((each) => each.name === choice || each.ssh === choice);
  if (host !== undefined) {
    const spare = runtimeProcess.env.ANA_RUNNER_SPARE_HELD === "1";
    const held = await armHolds(
      host,
      benches,
      spare ? "no check goes there now" : "running there because ANA_CHECK_HOST named it",
      waitMs,
    );
    if (held && spare) {
      throw new Refusal(`no task started on ${host.name}; an arm holds it`, EXIT.unavailable);
    }
    return { places: [host], picked: false, linux: null };
  }
  const names = hosts.map((each) => each.name).join(", ");
  throw new Refusal(
    `ANA_CHECK_HOST=${choice} names no host; write here, auto, all or one of: ${
      names === "" ? "none, since ANA_HOSTS lists no host" : names
    }`,
    EXIT.usage,
  );
}

/**
 * A free slot of `count` in `folder`, taken; null where a live task holds each. A slot is a folder
 * holding one entry named by its task's process, taken by renaming a folder of the task's own onto it,
 * which the system refuses while the slot holds an entry: of two tasks at one free slot, one takes it.
 */
function takeSlot(folder: string, count: number): Slot | null {
  const mine = String(runtimeProcess.pid);
  const claim = join(folder, `claim-${mine}`);
  for (let number = 1; number <= count; number++) {
    const path = join(folder, `slot-${String(number)}`);
    if (slotOccupied(path, "clean")) continue;
    mkdirSync(join(claim, mine), { recursive: true });
    try {
      renameSync(claim, path);
      heldByThisRunner.add(path);
      return { path: join(path, mine), number };
    } catch {
      // Another task took it between the two steps.
    }
  }
  rmSync(claim, { recursive: true, force: true });
  return null;
}

/** Waits for the first free slot among `places`, in their order, so tasks that read the same order
 *  at once spread over the places instead of queueing at the first; says so every fifteen seconds,
 *  at most the configured wait. */
async function slotAmong(places: readonly Place[]): Promise<{ place: Place; slot: Slot }> {
  const queues = places.map((place) => {
    const folder = slotFolder(place);
    mkdirSync(folder, { recursive: true });
    return { place, folder, count: slotCapacity(place) };
  });
  const named = queues.map(({ place }) => place?.ssh ?? "local").join(" or ");
  const limit = setting("ANA_RUNNER_QUEUE_WAIT", 2400);
  for (let waited = 0; ; waited++) {
    for (const { place, folder, count } of queues) {
      const slot = takeSlot(folder, count);
      if (slot !== null) return { place, slot };
    }
    if (waited >= limit) {
      throw new Refusal(`waited ${String(limit)}s for a slot on ${named}; no task started`, EXIT.noSlot);
    }
    if (waited % 15 === 14) say(`waiting for a slot on ${named} (${String(waited + 1)}s)`);
    await Bun.sleep(1000);
  }
}

/**
 * The working tree of `root` as a commit: `HEAD` itself where nothing differs from it, else the tree
 * as git would add it whole (tracked changes, deletions and new files it does not ignore) on
 * `HEAD`'s own parents, written through a scratch index so the checkout's index and branch stay as
 * they are. An untracked env file never joins it, whatever the ignore rules say.
 */
function snapshot(root: string): string {
  const index = join(tmpdir(), `ana-runner-index-${String(runtimeProcess.pid)}`);
  const git = (...args: string[]): string =>
    runTextSyncOrThrow([hostTool("git"), "-C", root, ...args], {
      // One date, so the same bytes are the same commit and a second push of them sends nothing.
      env: {
        ...runtimeProcess.env,
        GIT_INDEX_FILE: index,
        GIT_AUTHOR_DATE: EPOCH,
        GIT_COMMITTER_DATE: EPOCH,
      },
    }).trim();
  const head = gitMaybe(root, "rev-parse", "-q", "--verify", "HEAD^{commit}");
  try {
    // The checkout's own index carries what is staged and what git already knows unchanged.
    const own = gitText(root, "rev-parse", "--path-format=absolute", "--git-path", "index");
    try {
      copyFileSync(own, index);
    } catch {
      // A repository that has added nothing yet has no index, and git starts an empty one.
    }
    const kept = [".", ":(exclude,glob)**/.env", ":(exclude,glob)**/.env.*"];
    git("-c", "advice.addEmbeddedRepo=false", "add", "-A", "--", ...kept);
    const tree = git("write-tree");
    if (head === null) return git(...IDENTITY, "commit-tree", tree, "-m", "runner snapshot");
    if (tree === gitText(root, "rev-parse", `${head}^{tree}`)) return head;
    const parents = gitText(root, "rev-parse", `${head}^@`)
      .split("\n")
      .flatMap((parent) => (parent === "" ? [] : ["-p", parent]));
    return git(...IDENTITY, "commit-tree", tree, ...parents, "-m", "runner snapshot");
  } finally {
    rmSync(index, { force: true });
  }
}

/** One step before the task, each safe to repeat, tried three times: a dropped connection looks
 *  like any other failure. The task itself is never retried. */
async function retried(what: string, step: () => Promise<string | null>): Promise<string | null> {
  const pause = setting("ANA_RUNNER_RETRY_DELAY", 5);
  for (let attempt = 1; ; attempt++) {
    const result = await step();
    if (result !== null || attempt === 3) return result;
    say(`${what} failed; retry ${String(attempt)} of 2 in ${String(attempt * pause)}s`);
    await Bun.sleep(attempt * pause * 1000);
  }
}

/** A command's trimmed stdout, or null with its stderr said where it did not exit 0. */
async function answer(cmd: string[], env?: Record<string, string | undefined>): Promise<string | null> {
  const result = await runCaptured(cmd, env === undefined ? {} : { env });
  if (result.exitCode === 0) return result.stdout.trim();
  if (result.stderr.trim() !== "") console.error(result.stderr.trimEnd());
  return null;
}

const CALLER_ENV = (() => {
  const file = runtimeProcess.env.ANA_RUNNER_HOST_FILE;
  const read = file !== undefined && existsSync(file) ? readFileSync(file, "utf8") : "";
  const added = new Set([
    "ANA_RUNNER_HOST_FILE",
    ...[...read.matchAll(/^([A-Z_][A-Z0-9_]*)=/gmu)].map(([, name]) => name),
  ]);
  return Object.fromEntries(Object.entries(runtimeProcess.env).filter(([name]) => !added.has(name)));
})();

/** The task's own run, its streams this command's, as its exit status. A signal to this command
 *  goes on to it, and a hang-up reaches a host through its terminal. */
async function attached(cmd: string[], release: () => void): Promise<number> {
  // A group of its own, so the signal reaches the task whole and this command once. No check reads
  // its input, and a group without the terminal could not.
  const child = capturedSpawn(cmd, {
    detached: true,
    env: CALLER_ENV,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const handlers = (["SIGHUP", "SIGINT", "SIGTERM"] as const).map((signal) => {
    const onSignal = (): void => {
      killProcessGroup(child, signal);
      release();
      queueMicrotask(() => runtimeProcess.exit(EXIT.interrupted));
    };
    runtimeProcess.on(signal, onSignal);
    return [signal, onSignal] as const;
  });
  try {
    return await child.exited;
  } finally {
    for (const [signal, onSignal] of handlers) runtimeProcess.off(signal, onSignal);
  }
}

/**
 * The shell text that makes a slot ready on `host` and prints the host's free KiB, in one exchange:
 * a repository of its own that borrows the objects of the host's tree, the task's script beside it,
 * and no status of an earlier task. A slot whose own .git is missing or broken would otherwise find
 * a repository above it.
 */
const setUp = (host: Host, dir: string): string => `set -eu
d=${quoted(dir)}
mkdir -p "$d"
if [ "$(git -C "$d" rev-parse --git-dir 2>/dev/null || true)" != .git ]; then rm -rf "$d/.git"; git init -q "$d"; fi
objects="$(git -C ${shellPath(host.tree)} rev-parse --path-format=absolute --git-path objects 2>/dev/null || true)"
if [ -n "$objects" ]; then printf '%s\\n' "$objects" >"$d/.git/objects/info/alternates"; fi
rm -f "$d.status"
printf '%s' ${quoted(readFileSync(TASK_SCRIPT, "utf8"))} >"$d.task.sh"
df -Pk "$HOME" | awk 'NR == 2 { print $4 }'
git -C "$d" rev-parse -q --verify 'refs/runner/snapshot^{commit}' 2>/dev/null || true`;

/** What a check reads from its caller, as shell assignments. The clone's `ana.lintStrict` never
 *  reaches a slot, so it goes as the variable lint.ts reads. */
function carried(root: string): string[] {
  const strict = gitMaybe(root, "config", "--type=bool", "--get", "ana.lintStrict") === "true" ? "1" : "";
  return FORWARDED.map((name) => [name, runtimeProcess.env[name] ?? ""] as const)
    .map(([name, value]) => [name, name === "ANA_LINT_STRICT" && value === "" ? strict : value] as const)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}=${quoted(value)}`);
}

/** The task on `host`, in a slot folder that names this machine too, so two machines that share a
 *  host never share a slot. */
async function onHost(
  host: Host,
  slot: number,
  job: Job,
  release: () => void,
  commitOf: () => string,
): Promise<Ran> {
  const { root, pin } = job;
  if (pin === "") throw new Refusal(`${root} pins no Bun in package.json's packageManager`, EXIT.usage);
  const dir = `${RUNNER_SLOTS}/${ownName()}-slot-${String(slot)}`;
  const ssh = (...words: string[]): string[] => ["ssh", ...sshOptions(host.ssh), ...words];
  const setup = await retried("the slot's set-up", () => answer(ssh(host.ssh, setUp(host, dir))));
  if (setup === null) throw new Refusal(`${host.ssh} does not answer; no task started`, EXIT.unavailable);
  const [free = "", have = ""] = setup.split("\n");
  const least = setting("ANA_RUNNER_MIN_FREE_GB", 3);
  if (!/^\d+$/u.test(free) || Number(free) < least * 1024 * 1024) {
    throw new Refusal(
      `${host.ssh} reads '${free}' KiB free, and a task needs ${String(least)} GiB; no task started`,
      EXIT.unavailable,
    );
  }
  const commit = commitOf();
  if (have === commit) {
    say(`reused ${root} on ${host.ssh}, slot ${String(slot)}, as ${commit.slice(0, 9)}`);
  } else {
    // The slot is no remote of the tree, so the tree's hooks, the pre-push gate among them, have no say.
    const push = ["push", "--quiet", "--no-verify", "--force", `${host.ssh}:${dir}`];
    const sent = await retried("the push", () =>
      answer([hostTool("git"), "-C", root, ...push, `${commit}:refs/runner/snapshot`], {
        ...runtimeProcess.env,
        GIT_SSH_COMMAND: sshCommand(host.ssh),
      }),
    );
    if (sent === null) {
      throw new Refusal(`${host.ssh} did not take the tree; no task started`, EXIT.unavailable);
    }
    say(`sent ${root} to ${host.ssh}, slot ${String(slot)}, as ${commit.slice(0, 9)}`);
  }
  const prefix = `${root}/`;
  const remoteTask = job.task.map((arg) =>
    arg === root ? "." : arg.startsWith(prefix) ? arg.slice(prefix.length) || "." : arg,
  );
  const words = [
    ...carried(root),
    // --norc: a bash started straight under sshd reads ~/.bashrc, and one Mac's does not parse.
    "/bin/bash --norc",
    ...[`${dir}.task.sh`, "host", dir, pin, String(job.wall), ...remoteTask].map(quoted),
    // Where this end is no terminal the task writes into a pipe, so its tools draw no progress bars
    // into a log or an agent's output.
    ...(runtimeProcess.stdout.isTTY ? [] : ["2>&1 | cat"]),
  ];
  // The forced terminal is what delivers a hang-up to the host when ssh drops. ssh reports its own
  // failures as 255. Otherwise the verdict is the status task.sh left beside the slot, since
  // Tailscale SSH reports 0 whatever the task did; none left is no verdict either.
  let status = await attached(ssh("-tt", host.ssh, words.join(" ")), release);
  let times = "";
  if (status !== EXIT.noVerdict) {
    const bunTimes = quoted(`${dir}/${BUN_TIMES}`);
    const rewritten = `! cmp -s ${bunTimes} ${quoted(`${dir}.times`)} && cat ${bunTimes}`;
    const left = await retried("reading the status", () =>
      answer(ssh(host.ssh, `cat ${quoted(`${dir}.status`)} && { ${rewritten} || true; }`)),
    );
    const [first = "", ...rest] = (left ?? "").split("\n");
    status = /^\d+$/u.test(first) ? Number(first) : EXIT.noVerdict;
    times = rest.join("\n");
  }
  if (status === EXIT.noVerdict) {
    say(`the connection to ${host.ssh} dropped, or its task left no exit status, so this is no verdict`);
  }
  return { status, times };
}

async function inSlot(host: Place, slot: Slot, job: Job, commitOf: () => string): Promise<Ran> {
  const release = (): void => {
    rmSync(slot.path, { recursive: true, force: true });
    heldByThisRunner.delete(dirname(slot.path));
  };
  try {
    if (host === undefined) {
      const { root, pin, wall, task } = job;
      const times = join(root, BUN_TIMES);
      const written = (): string => (existsSync(times) ? readFileSync(times, "utf8") : "");
      const before = written();
      const status = await attached(
        ["/bin/bash", "--norc", TASK_SCRIPT, "here", root, pin, String(wall), ...task],
        release,
      );
      const after = written();
      return { status, times: after === before ? "" : after };
    }
    return await onHost(host, slot.number, job, release, commitOf);
  } finally {
    release();
  }
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const LINUX_TESTS = /platform\s*[!=]==\s*"linux"|osIsolationSupport\(/u;
const BUN_TIMES = "test/.test-timings.json";
const NEWEST_SHARE = 0.3;
const LEAST_CHUNK_MS = 60_000;

function numbersOf(value: JsonValue | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(asRecord(value) ?? {}).flatMap(([name, ms]) => (isNumber(ms) ? [[name, ms]] : [])),
  );
}

function parsed(text: string): JsonValue {
  try {
    return capturedJsonParse(text);
  } catch {
    return null;
  }
}

function timesOf(store: string): Record<string, Record<string, number>> {
  const all = asRecord(existsSync(store) ? parsed(readFileSync(store, "utf8")) : null) ?? {};
  return Object.fromEntries(Object.entries(all).map(([place, files]) => [place, numbersOf(files)]));
}

function learn(store: string, place: string, files: readonly string[], text: string): void {
  const ran = numbersOf(asRecord(parsed(text))?.files);
  const times = timesOf(store);
  const mine = { ...times[place] };
  for (const file of files) {
    const ms = ran[file];
    const mean = mine[file];
    if (ms !== undefined) {
      mine[file] = Math.round(mean === undefined ? ms : mean + NEWEST_SHARE * (ms - mean));
    }
  }
  times[place] = mine;
  const next = `${store}.${String(runtimeProcess.pid)}`;
  writeFileSync(next, `${JSON.stringify(times)}\n`);
  renameSync(next, store);
}

async function sharded(
  job: Job,
  places: readonly Place[],
  linux: Host | null,
  commitOf: () => string,
): Promise<number> {
  const [name = "test", ...named] = job.task;
  const files = (named.length > 0 ? named : ["test"]).flatMap((path) =>
    TEST_FILE.test(path)
      ? [path]
      : readdirSync(join(job.root, path), { recursive: true })
          .map(String)
          .filter((file) => TEST_FILE.test(file) && !file.split("/").includes("node_modules"))
          .map((file) => join(path, file)),
  );
  if (files.length === 0) throw new Refusal(`all: no test files in ${named.join(" ")}`, EXIT.usage);
  const store = join(
    gitText(job.root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    "ana-test-times.json",
  );
  const running = new Set(places.map((host) => host?.name ?? ownName()));
  const means = Object.entries(timesOf(store)).flatMap(([place, each]) => (running.has(place) ? [each] : []));
  const meanOf = (file: string): number | null => {
    const seen = means.flatMap((each) => each[file] ?? []);
    return seen.length === 0 ? null : seen.reduce((sum, ms) => sum + ms, 0) / seen.length;
  };
  const known = files.flatMap((file) => meanOf(file) ?? []);
  const median = known.toSorted((a, b) => a - b)[Math.floor(known.length / 2)] ?? 1;
  const weight = (file: string): number => meanOf(file) ?? median;
  const total = files.reduce((sum, file) => sum + weight(file), 0);
  const slots = places.reduce((sum, host) => sum + slotCapacity(host), 0);
  const byTime = known.length === 0 ? files.length : Math.max(1, Math.floor(total / LEAST_CHUNK_MS));
  const count = Math.min(files.length, 2 * slots, byTime);
  const chunks: { files: string[]; weight: number }[] = Array.from({ length: count }, () => ({
    files: [],
    weight: 0,
  }));
  for (const file of files.toSorted((a, b) => weight(b) - weight(a))) {
    const lightest = chunks.reduce((least, chunk) => (chunk.weight < least.weight ? chunk : least));
    lightest.files.push(file);
    lightest.weight += weight(file);
  }
  const onLinux =
    linux === null
      ? []
      : files.filter((file) => {
          const path = resolve(job.root, file);
          return existsSync(path) && LINUX_TESTS.test(readFileSync(path, "utf8"));
        });
  const where = places.map((host) => `${host?.name ?? ownName()} (${String(slotCapacity(host))})`).join(", ");
  say(
    `all: ${String(files.length)} test files in ${String(count)} chunks over ${where}${
      linux === null || onLinux.length === 0 ? "" : `, and ${String(onLinux.length)} again on ${linux.name}`
    }`,
  );
  const exits: number[] = [];
  const once = async (
    { place: host, slot }: { place: Place; slot: Slot },
    chunk: string[],
  ): Promise<number> => {
    const at = host?.name ?? ownName();
    let status: number;
    try {
      const ran = await inSlot(host, slot, { ...job, task: [name, ...chunk] }, commitOf);
      status = ran.status;
      if (!NO_VERDICT.has(status)) {
        try {
          learn(store, at, chunk, ran.times);
        } catch (error) {
          say(`all: the test times of ${at} went unrecorded: ${String(error)}`);
        }
      }
    } catch (error) {
      if (!(error instanceof Refusal) || !NO_VERDICT.has(error.code)) throw error;
      say(error.message);
      status = error.code;
    }
    if (NO_VERDICT.has(status)) {
      say(`all: no verdict from ${at} on ${String(chunk.length)} files`);
    } else {
      say(`all: ${String(chunk.length)} files on ${at} exited ${String(status)}`);
      exits.push(status);
    }
    return status;
  };
  let live = [...places];
  const [{ unrun }] = await Promise.all([
    spread([{ slots }], chunks, {
      run: async (chunk) => {
        while (live.length > 0) {
          const seat = await slotAmong(live);
          if (!NO_VERDICT.has(await once(seat, chunk.files))) return "done";
          live = live.filter((each) => each !== seat.place);
        }
        return "elsewhere";
      },
    }),
    linux === null || onLinux.length === 0
      ? null
      : slotAmong([linux]).then(
          (seat) => once(seat, onLinux),
          (error: unknown) => {
            if (!(error instanceof Refusal)) throw error;
            say(`${error.message}; the other chunks' verdicts stand`);
          },
        ),
  ]);
  if (unrun.length > 0) {
    say(`all: ${String(unrun.length)} chunks found no place that gave a verdict`);
    return EXIT.noVerdict;
  }
  return exits.find((status) => status !== 0) ?? 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [root = "", pin = "", ...task] = argv;
  if (!TASKS.includes(task[0] ?? "")) {
    throw new Refusal(`usage: run.js <tree> <bun pin> {${TASKS.join("|")}} [arguments...]`, EXIT.usage);
  }
  const job: Job = { root, pin, task, wall: setting("ANA_RUNNER_WALL", 3600) || 3600 };
  const all = checkHost()?.trim() === "all";
  if (all && task[0] === "gate") {
    say("all: the gate leads here, and its test, typecheck and lint steps go out");
    return await attached(
      ["/bin/bash", "--norc", TASK_SCRIPT, "lead", root, pin, String(job.wall), ...task],
      () => {},
    );
  }
  const isPath = (arg: string): boolean =>
    TEST_FILE.test(arg) || statSync(join(root, arg), { throwIfNoEntry: false })?.isDirectory() === true;
  const shards = all && task[0] === "test" && task.slice(1).every(isPath);
  const { places, picked, linux } = await placesFor(shards);
  let commit: string | null = null;
  const commitOf = (): string => (commit ??= snapshot(root));
  if (shards) return await sharded(job, places, linux, commitOf);
  let remaining = [...places];
  for (;;) {
    const { place: host, slot } = await slotAmong(remaining);
    if (picked) {
      say(`auto: runs on ${host?.name ?? `${ownName()}, this machine`}`);
    }
    try {
      const { status } = await inSlot(host, slot, job, commitOf);
      if (!NO_VERDICT.has(status) || !picked || host === undefined) return status;
      remaining = remaining.filter((each) => each !== host);
      if (remaining.length === 0) return status;
      say(`no verdict from ${host.name}; trying another place`);
    } catch (error) {
      if (!picked || !(error instanceof Refusal) || error.code !== EXIT.unavailable || host === undefined) {
        throw error;
      }
      remaining = remaining.filter((each) => each !== host);
      if (remaining.length === 0) throw error;
      say(`${error.message}; trying another place`);
    }
  }
}

try {
  runtimeProcess.exitCode = await main(runtimeProcess.argv.slice(2));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  say(error.message);
  runtimeProcess.exitCode = error.code;
}
