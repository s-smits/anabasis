/**
 * The check runner: `run.js <tree> <bun pin> <test|typecheck|lint|secrets|gate> [arguments...]`,
 * which the bun router (`bun` in this folder) calls for a tree's check tasks. `RUN_REMOTE` says
 * where the task runs: unset, empty, `here` or the older `0` on this machine, without reading the
 * host list; a host's name or ssh destination on that one of the hosts `ANA_HOSTS` lists with
 * `checks`. Any other value is refused with the names to write. Wherever it runs, the task is
 * `task.sh` over the working tree as it stands, uncommitted bytes included, and its exit status is
 * this command's.
 *
 * **What reaches a host.** Git carries the tree: the working tree becomes one commit in place of
 * `HEAD` (`snapshot`), pushed to the slot's own repository on the host, which borrows the objects
 * of the host's configured tree, so a push sends what that host has not already fetched from
 * GitHub, usually the uncommitted change alone. Git decides what a tree is, so nothing it ignores
 * travels, the dependencies among them: the slot installs those from the lockfiles it was sent,
 * once per lockfile (`task.sh`). The snapshot keeps `HEAD`'s parents, so a static gate there chooses
 * the tests it would choose here. Until 12 November rsync carried the tree under a filter list of
 * its own, into a repository of one parentless commit, where a static pass read every file as changed.
 *
 * **Slots.** A host takes as many tasks at once from this machine as its `checks` says, and this
 * machine one. A slot is a link in the temp folder whose target is its holder's PID, made in one
 * step, so a holder that died holds nothing; a task that finds none free looks again each second.
 *
 * Settings, each optional, in seconds unless said: `ANA_RUNNER_WALL` (a task's deadline, 3600),
 * `ANA_RUNNER_QUEUE_WAIT` (the wait for a slot, 2400; exit 75 past it), `ANA_RUNNER_MIN_FREE_GB`
 * (free space a host must have, 3; exit 69 below it or where it does not answer),
 * `ANA_RUNNER_RETRY_DELAY` (5). A host needs only ssh, bash, git, curl and unzip, and gets the
 * tree's pinned Bun on its first task. `install.ts` bundles this file as the installed `run.js`.
 */
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe, gitText } from "#src/meta/git.ts";
import { hostTool } from "#src/meta/host-tool.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { capturedSpawn, processAnswers, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { sshOptions } from "#src/meta/ssh.ts";
import { killProcessGroup, runCaptured, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { quoted, shellPath, sshCommand } from "../../runs/host-command.ts";
import { hostsOf, ownName, type Host } from "../../runs/host-config.ts";

const TASKS = ["test", "typecheck", "lint", "secrets", "gate"];
/** What a check reads from its caller, sent by name since ssh carries no environment. */
const FORWARDED = ["ANA_LINT_STRICT", "ANA_TEST_BAIL", "ANA_TEST_WORKERS"];
/** Exits that say nothing about the tree (`NO_VERDICT`, `tools/runtime/gate.ts`), and the others. */
const EXIT = { usage: 2, unavailable: 69, noSlot: 75, interrupted: 130, noVerdict: 255 } as const;
const TASK_SCRIPT = join(import.meta.dir, "task.sh");
const EPOCH = "2000-01-01T00:00:00Z";
const IDENTITY = ["-c", "user.name=Runner Snapshot", "-c", "user.email=runner@snapshot.invalid"];

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

class Refusal extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

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

/** `ANA_HOSTS`, refused in the runner's own words where it cannot be read. */
function listedHosts(): readonly Host[] {
  try {
    return hostsOf();
  } catch (error) {
    throw new Refusal(`${errorMessage(error)}; RUN_REMOTE=here runs the task here`, EXIT.usage);
  }
}

/** The host `RUN_REMOTE` names, or undefined for this machine. */
function chosenHost(): Host | undefined {
  const choice = runtimeProcess.env.RUN_REMOTE ?? "";
  if (["", "here", "0"].includes(choice)) return undefined;
  const taking = listedHosts().filter((each) => each.checks !== undefined);
  const host = taking.find((each) => each.name === choice || each.ssh === choice);
  if (host !== undefined) return host;
  const names = taking.map((each) => each.name).join(", ");
  throw new Refusal(
    `RUN_REMOTE=${choice} names no host that takes checks; write here or one of: ${
      names === "" ? "none, since ANA_HOSTS sets checks for no host" : names
    }`,
    EXIT.usage,
  );
}

/**
 * A free slot of `count` in `folder`, taken; null where a live task holds each. A slot is a folder
 * holding one entry named by its task's process. A task takes one by renaming such a folder of its
 * own onto it, which the system refuses while the slot holds an entry, so of two tasks at one free
 * slot one takes it; what a dead task left is removed by its own name, which no live task's is.
 * A slot was a link naming its task before, removed and then made: two tasks that both read a slot
 * free each removed the other's link and held it together.
 */
function takeSlot(folder: string, count: number): Slot | null {
  const mine = String(runtimeProcess.pid);
  const claim = join(folder, `claim-${mine}`);
  const live = (holder: string): boolean =>
    holder !== mine && /^[1-9]\d*$/u.test(holder) && processAnswers(Number(holder));
  for (let number = 1; number <= count; number++) {
    const path = join(folder, `slot-${String(number)}`);
    let held: string[] = [];
    try {
      // A runner from before the slots were folders left a link, which its live task still holds.
      if (live(readlinkSync(path))) continue;
      rmSync(path, { force: true });
    } catch {
      try {
        held = readdirSync(path);
      } catch {
        // Nothing there yet.
      }
    }
    if (held.some(live)) continue;
    for (const dead of held) rmSync(join(path, dead), { recursive: true, force: true });
    mkdirSync(join(claim, mine), { recursive: true });
    try {
      renameSync(claim, path);
      return { path: join(path, mine), number };
    } catch {
      // Another task took it between the two steps.
    }
  }
  rmSync(claim, { recursive: true, force: true });
  return null;
}

/** Waits for a slot at `place`, saying so every fifteen seconds, at most the configured wait. */
async function slotAt(place: string, count: number): Promise<Slot> {
  const folder = join(tmpdir(), "ana-runner", place);
  mkdirSync(folder, { recursive: true });
  const limit = setting("ANA_RUNNER_QUEUE_WAIT", 2400);
  for (let waited = 0; ; waited++) {
    const slot = takeSlot(folder, count);
    if (slot !== null) return slot;
    if (waited >= limit) {
      throw new Refusal(`waited ${String(limit)}s for a slot on ${place}; no task started`, EXIT.noSlot);
    }
    if (waited % 15 === 14) say(`waiting for a slot on ${place} (${String(waited + 1)}s)`);
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

/** The task's own run, its streams this command's, as its exit status. A signal to this command
 *  goes on to it, and a hang-up reaches a host through its terminal. */
async function attached(cmd: string[], release: () => void): Promise<number> {
  // A group of its own, so the signal reaches the task whole and this command once. No check reads
  // its input, and a group without the terminal could not.
  const child = capturedSpawn(cmd, { detached: true, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
    runtimeProcess.on(signal, () => {
      killProcessGroup(child, signal);
      release();
      runtimeProcess.exit(EXIT.interrupted);
    });
  }
  return await child.exited;
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
df -Pk "$HOME" | awk 'NR == 2 { print $4 }'`;

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
async function onHost(host: Host, slot: number, job: Job, release: () => void): Promise<number> {
  const { root, pin } = job;
  if (pin === "") throw new Refusal(`${root} pins no Bun in package.json's packageManager`, EXIT.usage);
  const dir = `.cache/ana-runner/${ownName()}-slot-${String(slot)}`;
  const ssh = (...words: string[]): string[] => ["ssh", ...sshOptions(host.ssh), ...words];
  const free = await retried("the slot's set-up", () => answer(ssh(host.ssh, setUp(host, dir))));
  if (free === null) throw new Refusal(`${host.ssh} does not answer; no task started`, EXIT.unavailable);
  const least = setting("ANA_RUNNER_MIN_FREE_GB", 3);
  if (!/^\d+$/u.test(free) || Number(free) < least * 1024 * 1024) {
    throw new Refusal(
      `${host.ssh} reads '${free}' KiB free, and a task needs ${String(least)} GiB; no task started`,
      EXIT.unavailable,
    );
  }
  const commit = snapshot(root);
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
  const words = [
    ...carried(root),
    // --norc: a bash started straight under sshd reads ~/.bashrc, and one Mac's does not parse.
    "/bin/bash --norc",
    ...[`${dir}.task.sh`, "host", dir, pin, String(job.wall), ...job.task].map(quoted),
    // Where this end is no terminal the task writes into a pipe, so its tools draw no progress bars
    // into a log or an agent's output.
    ...(runtimeProcess.stdout.isTTY ? [] : ["2>&1 | cat"]),
  ];
  // The forced terminal is what delivers a hang-up to the host when ssh drops. ssh reports its own
  // failures as 255. Otherwise the verdict is the status task.sh left beside the slot, since
  // Tailscale SSH reports 0 whatever the task did; none left is no verdict either.
  let status = await attached(ssh("-tt", host.ssh, words.join(" ")), release);
  if (status !== EXIT.noVerdict) {
    const left = await retried("reading the status", () =>
      answer(ssh(host.ssh, `cat ${quoted(`${dir}.status`)}`)),
    );
    status = left !== null && /^\d+$/u.test(left) ? Number(left) : EXIT.noVerdict;
  }
  if (status === EXIT.noVerdict) {
    say(`the connection to ${host.ssh} dropped, or its task left no exit status, so this is no verdict`);
  }
  return status;
}

async function main(argv: readonly string[]): Promise<number> {
  const [root = "", pin = "", ...task] = argv;
  if (!TASKS.includes(task[0] ?? "")) {
    throw new Refusal(`usage: run.js <tree> <bun pin> {${TASKS.join("|")}} [arguments...]`, EXIT.usage);
  }
  const job: Job = { root, pin, task, wall: setting("ANA_RUNNER_WALL", 3600) || 3600 };
  const host = chosenHost();
  const slot = await slotAt(host?.ssh ?? "local", host?.checks ?? 1);
  const release = (): void => rmSync(slot.path, { recursive: true, force: true });
  try {
    if (host !== undefined) return await onHost(host, slot.number, job, release);
    const here = ["/bin/bash", "--norc", TASK_SCRIPT, "here", root, pin, String(job.wall), ...task];
    return await attached(here, release);
  } finally {
    release();
  }
}

try {
  runtimeProcess.exitCode = await main(runtimeProcess.argv.slice(2));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  say(error.message);
  runtimeProcess.exitCode = error.code;
}
