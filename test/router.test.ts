/**
 * The bun router (`tools/runtime/router/`) as a machine meets it: installed by its own `install.ts`
 * into a scratch home, then run as `bun` and as `run.sh` over a real Git tree, with ssh and rsync
 * replaced by stand-ins that map each host to a home of its own, so the transfer, the locks and the
 * queue are real. The cases were ported on 25 October from the runner's `test.py`, which stijn-pro
 * kept beside the runner and nothing ran in CI; they keep its order and its hostile halves, and add
 * the router's choice for each command line, the pin it resolves, the hosts read from `ANA_HOSTS`,
 * and the installer. A stand-in `ps` lists no other process to the reaper, so no case can reap an
 * orphan of the machine running the suite; the reaper's own cases name what they list.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "../src/meta/process.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const ROUTER = join(import.meta.dir, "..", "tools", "runtime", "router");
const realRsync = Bun.which("rsync");
const realPs = Bun.which("ps") ?? "/bin/ps";
const MACHINE = execTextSync("uname", ["-n"]).trim().split(".")[0] ?? "";
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-router-")));
const SSH = `#!/bin/bash
args=("$@")
while [[ "\${args[0]}" == -* ]]; do
  if [[ "\${args[0]}" == -o ]]; then args=("\${args[@]:2}"); else args=("\${args[@]:1}"); fi
done
host="\${args[0]}" command="\${args[\${#args[@]}-1]}"
home="$FAKE_HOMES/$host"
mkdir -p "$home"
printf '%s %s\\n' "$host" "\${command%% *}" >>"$FAKE_LOG"
case "$command" in
  'n="$(getconf'*)
    load="FAKE_LOAD_\${host//-/_}"
    printf '%s\\n' "\${!load:-0.00 4}"
    exit 0
    ;;
  "df "*)
    [[ -z "\${FAKE_DOWN:-}" ]] || exit 255
    cd "$home" && HOME="$home" exec /bin/sh -c "$command"
    ;;
  "cat > "*)
    body="$(cat; printf x)"
    body="\${body%x}"
    [[ -n "\${FAKE_FULL:-}" ]] || body="\${body%%bun install --frozen-lockfile >*}"
    cd "$home" && printf '%s' "$body" | HOME="$home" /bin/sh -c "$command"
    exit $?
    ;;
esac
status=0
cd "$home" && HOME="$home" /bin/sh -c "$command" || status=$?
# Tailscale SSH reports 0 as every session's exit status.
[[ -z "\${FAKE_TAILSCALE:-}" ]] || status=0
if ((status == 0)) && [[ -n "\${FAKE_JOB:-}" && "$command" != "mkdir "* ]]; then
  touch "$FAKE_JOB.ready"
  while [[ ! -e "$FAKE_JOB.release" ]]; do sleep 0.05; done
fi
exit "$status"
`;

const RSYNC = `#!/bin/bash
# Local rsync starts its own server side through PATH, which is this stand-in again.
remote=0
for arg in "$@"; do [[ "$arg" != -e ]] || remote=1; done
((remote == 1)) || exec ${realRsync ?? "rsync"} "$@"
if [[ -n "\${FAKE_RSYNC_FAIL_ONCE:-}" && ! -e "$FAKE_RSYNC_FAIL_ONCE" ]]; then
  : >"$FAKE_RSYNC_FAIL_ONCE"
  exit 1
fi
kept=() skip=0
for arg in "$@"; do
  if ((skip == 1)); then skip=0; continue; fi
  if [[ "$arg" == -e ]]; then skip=1; continue; fi
  kept+=("$arg")
done
last="\${kept[\${#kept[@]}-1]}"
kept[\${#kept[@]}-1]="$FAKE_HOMES/\${last%%:*}/\${last#*:}"
exec ${realRsync ?? "rsync"} "\${kept[@]}"
`;

/** A Bun that records how it was called, and hands the router's host lister to the real one. */
const RECORDING_BUN = `#!/bin/bash
case "$*" in *hosts.js*) exec ${capturedExecPath} "$@" ;; esac
if [[ "\${1-}" == --version ]]; then echo 1.4.2; exit 0; fi
[[ "\${1-}" != install ]] || exit 0
{
  printf 'args=%s\\n' "$*"
  printf 'workers=%s\\n' "\${ANA_TEST_WORKERS-}"
  printf 'bun=%s\\n' "$0"
  printf 'strict=%s\\n' "\${ANA_LINT_STRICT-}"
  printf 'active=%s\\n' "\${ANA_RUNNER_ACTIVE-}"
} >"\${FAKE_CALL:-/dev/null}"
exit "\${FAKE_EXIT:-0}"
`;

const QUIET_PS = `#!/bin/sh
case "$*" in
  *command=*) echo "    1     0 /sbin/launchd" ;;
  *) exec ${realPs} "$@" ;;
esac
`;

const HOSTS = JSON.stringify([
  { name: "m1", ssh: "fake-mac", tree: "~/anabasis", bun: "~/.bun/bin/bun" },
  { name: "zbook", ssh: "fake-linux", tree: "~/anabasis", bun: "~/.bun/bin/bun" },
]);

function folder(name: string): string {
  const path = join(root, name);
  mkdirSync(path);
  return path;
}
const source = folder("source");
const plain = folder("plain");
const homes = folder("homes");
const bins = folder("bin");
const tmp = folder("tmp");
const home = folder("home");
const runner = join(home, ".local", "share", "ana-runner", "run.sh");
const shim = join(home, ".local", "bin", "bun");
const log = join(root, "ssh.log");

function script(path: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

const git = (cwd: string, ...args: string[]): string => execTextSync("git", args, { cwd });

function tree(path: string, files: Readonly<Record<string, string>>): void {
  git(path, "init", "-q");
  git(path, "config", "user.name", "Router Test");
  git(path, "config", "user.email", "router@localhost");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(path, name, ".."), { recursive: true });
    writeFileSync(join(path, name), content);
  }
  git(path, "add", ".");
  git(path, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "base");
}

const quiet = { ...Bun.env };
for (const name of [
  "RUN_REMOTE",
  "ANA_RUNNER_ACTIVE",
  "ANA_TEST_WORKERS",
  "ANA_LINT_STRICT",
  "ANA_TEST_BAIL",
]) {
  delete quiet[name];
}
const env: Record<string, string | undefined> = {
  ...quiet,
  PATH: `${bins}:${Bun.env.PATH ?? ""}`,
  HOME: home,
  SHELL: "/bin/sh",
  TMPDIR: tmp,
  FAKE_HOMES: homes,
  FAKE_LOG: log,
  ANA_HOSTS: HOSTS,
  ANA_RUNNER_RETRY_DELAY: "0",
  ANA_RUNNER_MIN_FREE_GB: "1",
};

script(join(bins, "ssh"), SSH);
script(join(bins, "rsync"), RSYNC);
script(join(bins, "ps"), QUIET_PS);
for (const bun of [join(home, ".bun", "releases", "1.4.2", "bin", "bun"), join(home, ".bun", "bin", "bun")]) {
  script(bun, RECORDING_BUN);
}
for (const host of ["fake-mac", "fake-linux"]) {
  script(
    join(homes, host, ".bun/releases/1.4.2/bin/bun"),
    '#!/bin/sh\n[ "$1" = --version ] || exit 90\necho 1.4.2\n',
  );
}
tree(source, {
  "package.json": '{\n  "name": "t",\n  "packageManager": "bun@1.4.2"\n}\n',
  ".gitignore": "node_modules/\nignored/\nruns/\n!tools/runs/\n!tools/runs/**\n!.harness/backends/\n",
  edited: "old",
  deleted: "old",
  "tools/runs/discover.ts": "tracked",
  "tools/runtime/gate.ts": "the gate",
});
tree(plain, { "package.json": '{\n  "name": "anabasis"\n}\n' });
execTextSync(capturedExecPath, [join(ROUTER, "install.ts")], { env: { ...env, ANA_HOSTS: undefined } });

afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(args: readonly string[], extra: Record<string, string | undefined> = {}) {
  return spawnTextSync("bash", [runner, ...args], {
    cwd: source,
    env: { ...env, ...extra },
    timeout: 50_000,
  });
}

const slot = (host: string, k: number): string =>
  join(homes, host, ".cache/ana-runner", `${MACHINE}-slot-${String(k)}`);
const logged = (): string[] =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "");

/** The fields a recording Bun left, by name. */
function callAt(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

async function waitFor(check: () => boolean, seconds = 20): Promise<void> {
  const deadline = performance.now() + seconds * 1000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("condition did not settle");
    await Bun.sleep(50);
  }
}

describe("the router on the command line", () => {
  /** What `bun <args>` ran: whether run.sh queued it here, and the Bun that was called with what. */
  function routed(args: readonly string[], cwd = source, extra: Record<string, string> = {}) {
    const scratch = mkdtempSync(join(root, "route-"));
    const call = join(scratch, "call");
    const result = spawnTextSync(shim, args, {
      cwd,
      env: { ...env, TMPDIR: scratch, FAKE_CALL: call, RUN_REMOTE: "0", ...extra },
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    return { queued: existsSync(join(scratch, "ana-runner", "local")), ...callAt(call) };
  }
  const pinned = join(home, ".bun", "releases", "1.4.2", "bin", "bun");

  it("sends the five check tasks to run.sh and runs everything else on the pinned Bun", () => {
    const cases: [readonly string[], boolean, string][] = [
      [["run", "typecheck"], true, "run typecheck"],
      [["test", "test/a.test.ts"], true, "run test test/a.test.ts"],
      [["test"], true, "run test"],
      [["run", "test", "--", "x.test.ts", "y.test.ts"], true, "run test x.test.ts y.test.ts"],
      [["run", "lint", "--", "--strict"], true, "run lint --strict"],
      [["run", "secrets"], true, "run secrets"],
      [["run", "gate"], true, "run gate"],
      [["run", "format"], false, "run format"],
      [["tools/runs/discover.ts", "test"], false, "tools/runs/discover.ts test"],
    ];
    for (const [args, queued, said] of cases) {
      expect(routed(args), args.join(" ")).toMatchObject({
        queued,
        args: said,
        bun: pinned,
        active: queued ? "1" : "",
      });
    }
  });
});

describe.skipIf(realRsync === null)("run.sh", () => {
  const target = slot("fake-mac", 1);
  const queue = join(tmp, "ana-runner", "fake-mac");

  it("sends the working tree as it stands, without credentials, run state or ignored files, and keeps the caches", () => {
    const head = git(source, "rev-parse", "HEAD").trim();
    writeFileSync(join(source, "edited"), "unstaged");
    unlinkSync(join(source, "deleted"));
    writeFileSync(join(source, "new file"), "new");
    writeFileSync(join(source, "staged"), "staged");
    git(source, "add", "staged");
    const hidden = [
      ".env",
      ".env.local",
      ".harness/backends/private.json",
      "campaigns/private",
      "ignored/private",
    ];
    for (const name of [...hidden, "node_modules/local", "runs/state", "nested/tools/runs/state"]) {
      mkdirSync(join(source, name, ".."), { recursive: true });
      writeFileSync(join(source, name), "private");
    }
    const caches = ["node_modules/cache", "packages/ui/node_modules/cache", "test/.test-timings.json"];
    for (const name of ["stale", ".env", "ignored/old", ...caches]) {
      mkdirSync(join(target, name, ".."), { recursive: true });
      writeFileSync(join(target, name), "old");
    }
    // A test's scratch tree links the dependency cache; deletion must not stall on the link.
    mkdirSync(join(target, ".scratch/old/workspace"), { recursive: true });
    symlinkSync(join(target, "node_modules"), join(target, ".scratch/old/workspace/node_modules"));
    writeFileSync(log, "");

    const sent = run(["test", "test/example.test.ts"]);
    expect(sent.status, sent.stderr).toBe(0);
    const arrived = {
      edited: "unstaged",
      "new file": "new",
      staged: "staged",
      "tools/runs/discover.ts": "tracked",
    };
    for (const [name, content] of Object.entries(arrived)) {
      expect(readFileSync(join(target, name), "utf8")).toBe(content);
      expect(git(target, "show", `HEAD:${name}`)).toBe(content);
    }
    for (const name of [
      "deleted",
      "stale",
      ".env",
      ".env.local",
      ".harness",
      "campaigns",
      "ignored",
      "runs",
      ".scratch",
    ]) {
      expect(existsSync(join(target, name)), name).toBe(false);
    }
    expect(existsSync(join(target, "node_modules/local"))).toBe(false);
    expect(existsSync(join(target, "nested/tools/runs"))).toBe(false);
    for (const name of caches) expect(readFileSync(join(target, name), "utf8")).toBe("old");
    expect(git(source, "rev-parse", "HEAD").trim()).toBe(head);
    expect(git(target, "ls-files")).not.toContain("node_modules");

    unlinkSync(join(source, "new file"));
    expect(run(["test"]).status).toBe(0);
    expect(existsSync(join(target, "new file"))).toBe(false);
    expect(git(target, "ls-files")).not.toContain("new file");
  });

  it("gives an unnamed task to the first host that is not busy by load or by this machine's slots", () => {
    const held = [1, 2].map((k) => join(queue, `slot-${String(k)}`));
    const cases: [Record<string, string>, boolean, string, string | null][] = [
      [{ FAKE_LOAD_fake_mac: "9.50 8" }, false, "fake-linux", "fake-mac is busy (load 9.50 of 8 cores"],
      [{}, true, "fake-linux", "fake-mac is busy (load 0.00 of 4 cores, 2 of 2 slots held from here)"],
      [{ FAKE_LOAD_fake_mac: "garbled" }, false, "fake-linux", "fake-mac gave no load reading"],
      [{ FAKE_LOAD_fake_mac: "7.90 8" }, false, "fake-mac", null],
      [
        { FAKE_LOAD_fake_mac: "9.50 8", FAKE_LOAD_fake_linux: "6.00 4" },
        false,
        "fake-mac",
        "every host is busy",
      ],
    ];
    for (const [loads, holds, expected, said] of cases) {
      writeFileSync(log, "");
      if (holds) {
        for (const path of held) {
          mkdirSync(path, { recursive: true });
          writeFileSync(join(path, "pid"), `${String(runtimeProcess.pid)}\n`);
        }
      }
      const picked = run(["test"], loads);
      if (holds) for (const path of held) rmSync(path, { recursive: true });
      const sent = new Set(
        logged()
          .filter((line) => !line.includes("getconf"))
          .map((line) => line.split(" ")[0]),
      );
      expect(sent, picked.stderr).toEqual(new Set([expected]));
      if (said === null) expect(picked.stderr).not.toContain("so the task goes to");
      else expect(picked.stderr).toContain(said);
    }
  });

  it("retries a dropped transfer, and starts nothing on a host that does not answer or lacks room", () => {
    writeFileSync(join(source, "retried"), "after a dropped transfer");
    const retried = run(["test"], { RUN_REMOTE: "1", FAKE_RSYNC_FAIL_ONCE: join(root, "failed-once") });
    expect(retried.stderr).toContain("push_tree failed (exit 1); retry 1 of 2");
    expect(readFileSync(join(target, "retried"), "utf8")).toBe("after a dropped transfer");
    unlinkSync(join(source, "retried"));
    writeFileSync(join(target, "edited"), "untouched");
    const refusals: [Record<string, string>, string, number][] = [
      [{ FAKE_DOWN: "1" }, "does not answer; no sync or task started", 2],
      [{ ANA_RUNNER_MIN_FREE_GB: "1000000" }, "below the 1000000 GiB a task needs", 0],
    ];
    for (const [extra, message, retries] of refusals) {
      const refused = run(["test"], { RUN_REMOTE: "1", ...extra });
      expect(refused.status).toBe(69);
      expect(refused.stderr).toContain(message);
      expect(refused.stderr.split("on_host failed").length - 1).toBe(retries);
      expect(readFileSync(join(target, "edited"), "utf8")).toBe("untouched");
    }
  });

  it("runs each host's slots apart, queues the next in order with its own host unhindered, and frees a dead holder's slot", async () => {
    const jobs: [Bun.Subprocess, string][] = [];
    async function start(name: string, extra: Record<string, string>, wait = true) {
      const job = join(root, name);
      const stderr = openSync(`${job}.log`, "w");
      const child = capturedSpawn(["bash", runner, "test"], {
        cwd: source,
        env: { ...env, FAKE_JOB: job, ...extra },
        stdin: "ignore",
        stdout: "ignore",
        stderr,
      });
      closeSync(stderr);
      jobs.push([child, job]);
      if (wait) {
        await waitFor(() => existsSync(`${job}.ready`) || child.exitCode !== null);
        expect(child.exitCode, readFileSync(`${job}.log`, "utf8")).toBeNull();
      }
      return [child, job] as const;
    }
    async function finish([child, job]: readonly [Bun.Subprocess, string]) {
      writeFileSync(`${job}.release`, "");
      expect(await child.exited).toBe(0);
    }
    const ready = (job: string): boolean => existsSync(`${job}.ready`);
    try {
      const first = await start("first", { RUN_REMOTE: "1" });
      writeFileSync(join(source, "edited"), "second snapshot");
      const second = await start("second", {});
      expect(readFileSync(join(target, "edited"), "utf8")).toBe("unstaged");
      expect(readFileSync(join(slot("fake-mac", 2), "edited"), "utf8")).toBe("second snapshot");
      const other = await start("other", { RUN_REMOTE: "zbook" });
      const refused = run(["test"], { RUN_REMOTE: "1", ANA_RUNNER_QUEUE_WAIT: "0" });
      expect(refused.status).toBe(75);
      expect(refused.stderr).toContain("for a slot on fake-mac; no task started");
      const stale = join(queue, "wait.stale");
      writeFileSync(stale, "99999999\n");
      utimesSync(stale, 1, 1);
      const waitingFirst = await start(
        "waiting-first",
        { RUN_REMOTE: "1", ANA_RUNNER_QUEUE_WAIT: "60" },
        false,
      );
      await waitFor(
        () =>
          readdirSync(queue).filter((name) => name.startsWith("wait.")).length ===
          1 + Number(existsSync(stale)),
      );
      const waitingSecond = await start(
        "waiting-second",
        { RUN_REMOTE: "1", ANA_RUNNER_QUEUE_WAIT: "60" },
        false,
      );
      await waitFor(
        () => readFileSync(join(root, "waiting-second.log"), "utf8").includes("1 tasks ahead ("),
        25,
      );
      expect(readFileSync(join(root, "waiting-first.log"), "utf8")).toContain("0 tasks ahead (");
      expect(existsSync(stale)).toBe(false);
      const released = performance.now();
      await finish(first);
      await waitFor(() => ready(waitingFirst[1]), 4);
      expect(performance.now() - released).toBeLessThan(4000);
      expect(ready(waitingSecond[1])).toBe(false);
      await finish(other);
      await finish(second);
      await waitFor(() => ready(waitingSecond[1]), 4);
      await finish(waitingFirst);
      mkdirSync(join(queue, "slot-1"));
      writeFileSync(join(queue, "slot-1", "pid"), "99999999\n");
      await finish(await start("third", { RUN_REMOTE: "1" }));
      await finish(waitingSecond);
      expect(readdirSync(queue)).toEqual([]);
    } finally {
      for (const [child, job] of jobs) {
        writeFileSync(`${job}.release`, "");
        await child.exited;
      }
    }
  });

  it("runs RUN_REMOTE=0 here on the pinned Bun, reaps an orphaned test worker and spares an orphan that names the checkout", async () => {
    const token = source;
    const orphan = (argv0: string): number =>
      Number(
        execTextSync("bash", [
          "-c",
          'exec -a "$1" sleep 300 >/dev/null 2>&1 & echo $!',
          "orphan",
          argv0,
        ]).trim(),
      );
    const simulator = orphan(`${token}/campaigns/c/workspace/.toolchain/qemu/qemu-system-xtensa`);
    const worker = orphan(`bun test --test-worker ${token}`);
    const filtered = join(root, "filtered-ps");
    script(
      join(filtered, "ps"),
      `#!/bin/sh
case "$*" in
  *command=*) ${realPs} "$@" | awk -v t='${token}' 'index($0, t) || $1 == 1' ;;
  *) exec ${realPs} "$@" ;;
esac
`,
    );
    const parentOf = (pid: number): string =>
      spawnTextSync(realPs, ["-o", "ppid=", "-p", String(pid)]).stdout.trim();
    try {
      await waitFor(() => parentOf(worker) === "1", 5);
      const call = join(root, "local-call");
      writeFileSync(log, "");
      const local = run(["test"], {
        RUN_REMOTE: "0",
        FAKE_CALL: call,
        PATH: `${filtered}:${env.PATH ?? ""}`,
      });
      expect(callAt(call)).toMatchObject({
        bun: join(home, ".bun", "releases", "1.4.2", "bin", "bun"),
        active: "1",
      });
      expect(logged()).toEqual([]);
      expect(local.stderr).toContain(`reaped process ${String(worker)} from a dead test run`);
      expect(local.stderr).not.toContain(String(simulator));
      expect(parentOf(simulator)).toBe("1");
      await waitFor(() => parentOf(worker) === "", 5);
    } finally {
      for (const pid of [simulator, worker]) {
        try {
          runtimeProcess.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  });
});
