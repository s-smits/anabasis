/**
 * The bun router (`tools/runtime/router/`) as a machine meets it: installed by its own `install.ts`
 * into a scratch home, then run as `bun` over a real Git tree. The stand-in ssh models the transport
 * and the hosts, never the runner's commands: a host is a folder whose state is a file in it, a
 * master is its socket file, and every command runs in the host's home under bash with HOME and PATH
 * alone, since ssh carries no environment, so a push goes through it to a real `git-receive-pack`.
 * Each host's pinned Bun records how task.sh called it, so the settings, the status and the deadline
 * are read where the task ran, and each install it was asked for. A task holds or exits through its
 * own arguments (`hold:<path>`, `exit:<n>`). A stand-in `ps` lists no other process to the reaper, so
 * no case can reap an orphan of the machine running the suite; the reaper's own case names what it
 * lists.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "../src/meta/process.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const ROUTER = join(import.meta.dir, "..", "tools", "runtime", "router");
const realPs = Bun.which("ps") ?? "/bin/ps";
const MACHINE = execTextSync("uname", ["-n"]).trim().split(".")[0] ?? "";
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-router-")));

const SSH = `#!/bin/bash
# The ssh client and every host it reaches. Host state, a file in its home: down refuses every
# connection, drops drops a session with a terminal before it runs, zero reports 0 for every session
# as Tailscale SSH does, flaky holds which connection from now drops once. A master is its socket.
args=("$@") options=() tty=0
while [[ "\${args[0]}" == -* ]]; do
  case "\${args[0]}" in
    -o) options+=("\${args[1]}") args=("\${args[@]:2}") ;;
    -tt) tty=1 args=("\${args[@]:1}") ;;
    *) args=("\${args[@]:1}") ;;
  esac
done
control="" auto=""
for option in "\${options[@]}"; do
  case "$option" in
    ControlPath=*) [[ -n "$control" ]] || control="\${option#ControlPath=}" ;;
    ControlMaster=*) [[ -n "$auto" ]] || auto="\${option#ControlMaster=}" ;;
  esac
done
[[ "$control" != none ]] || control=""
if [[ -n "$control" ]] && ((\${#control} + 17 >= 104)); then said too-long; exit 255; fi
host="\${args[0]}" home="$FAKE_HOMES/\${args[0]}"
said() { printf '%s %s %s %s\\n' "$host" "$1" "\${control:-none}" "\${options[*]}" >>"$FAKE_LOG"; }
if [[ -e "$home/down" ]]; then said refused; exit 255; fi
if [[ -e "$home/flaky" ]]; then
  left="$(cat "$home/flaky")"
  if ((left <= 1)); then rm -f "$home/flaky"; said dropped; exit 255; fi
  printf '%s\\n' "$((left - 1))" >"$home/flaky"
fi
if [[ -n "$control" && -e "$control" ]]; then said use
elif [[ -n "$control" && "$auto" == auto ]]; then : >"$control"; said open
else said direct; fi
if ((tty == 1)) && [[ -e "$home/drops" ]]; then exit 255; fi
status=0
(cd "$home" && exec env -i HOME="$home" PATH="$home/.local/bin:$FAKE_PATH" /bin/bash -c "\${args[*]:1}") || status=$?
[[ ! -e "$home/zero" ]] || status=0
exit "$status"
`;

/** A Bun that records how it was called in its HOME's bun.log and each install in install.log, and
 *  hands the runner itself to Bun. A held call gives up after two minutes: a suite killed before its
 *  `finally` released them left three fakes waiting on the Linux runner from 28 to 30 October. */
const RECORDING_BUN = `#!/bin/bash
case "$*" in *run.js*) exec ${capturedExecPath} "$@" ;; esac
if [[ "\${1-}" == --version ]]; then echo 1.4.2; exit 0; fi
if [[ "\${1-}" == install ]]; then echo "$*" >>"$HOME/install.log"; exit 0; fi
printf 'bun=%s\\tactive=%s\\tstrict=%s\\tworkers=%s\\tbail=%s\\targs=%s\\n' "$0" "\${ANA_RUNNER_ACTIVE-}" \\
  "\${ANA_LINT_STRICT-}" "\${ANA_TEST_WORKERS-}" "\${ANA_TEST_BAIL-}" "$*" >>"$HOME/bun.log"
status=0
for arg in "$@"; do
  case "$arg" in
    hold:*) : >"\${arg#hold:}.ready"; until [[ -e "\${arg#hold:}.release" ]] || ((SECONDS > 120)); do sleep 0.05; done ;;
    exit:*) status="\${arg#exit:}" ;;
  esac
done
exit "$status"
`;

const QUIET_PS = `#!/bin/sh
case "$*" in
  *command=*) echo "    1     0 /sbin/launchd" ;;
  *) exec ${realPs} "$@" ;;
esac
`;

/** A host's own tools: its performance cores from \`perf\`, and a free-space reading that \`garbled\`
 *  spoils. */
const HOST_TOOLS = {
  sysctl: `#!/bin/sh
case "$*" in
  "-n hw.perflevel0.logicalcpu") cat "$HOME/perf" 2>/dev/null ;;
  *) exit 1 ;;
esac
`,
  df: `#!/bin/sh\nif [ -e "$HOME/garbled" ]; then echo nonsense; else exec /bin/df "$@"; fi\n`,
  ps: QUIET_PS,
};

const PEER = { name: "peer", ssh: "fake-peer", tree: "~/anabasis", bun: "~/.bun/bin/bun" };
const HOSTS = JSON.stringify([
  PEER,
  { name: "m1", ssh: "fake-mac", tree: "~/anabasis", bun: "~/.bun/bin/bun", checks: 2 },
  { name: "zbook", ssh: "fake-linux", tree: "~/anabasis", bun: "~/.bun/bin/bun", checks: 1 },
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
// A control socket's path must stay under 104 bytes, which the suite's own temp root may not leave room for.
const tmp = realpathSync(mkdtempSync(join("/tmp", "ana-router-")));
const home = folder("home");
const shim = join(home, ".local", "bin", "bun");
const log = join(root, "ssh.log");
const pinned = join(home, ".bun", "releases", "1.4.2", "bin", "bun");

function script(path: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

const git = (cwd: string, ...args: string[]): string => execTextSync("git", args, { cwd });
const commit = (cwd: string, message: string): string =>
  git(cwd, "-c", "core.hooksPath=/dev/null", "commit", "-qam", message);

function tree(path: string, files: Readonly<Record<string, string>>): void {
  git(path, "init", "-q");
  git(path, "config", "user.name", "Router Test");
  git(path, "config", "user.email", "router@localhost");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(path, name, ".."), { recursive: true });
    writeFileSync(join(path, name), content);
  }
  git(path, "add", ".");
  commit(path, "base");
}

const quiet = { ...Bun.env };
for (const name of [
  "RUN_REMOTE",
  "ANA_RUNNER_ACTIVE",
  "ANA_TEST_WORKERS",
  "ANA_LINT_STRICT",
  "ANA_TEST_BAIL",
  "GIT_INDEX_FILE",
]) {
  delete quiet[name];
}
const env: Record<string, string | undefined> = {
  ...quiet,
  PATH: `${bins}:${Bun.env.PATH ?? ""}`,
  HOME: home,
  SHELL: "/bin/sh",
  TMPDIR: tmp,
  ANA_TEST_TMPDIR: tmp,
  FAKE_HOMES: homes,
  FAKE_LOG: log,
  FAKE_PATH: Bun.env.PATH ?? "",
  ANA_HOSTS: HOSTS,
  ANA_RUNNER_RETRY_DELAY: "0",
  ANA_RUNNER_MIN_FREE_GB: "1",
};

script(join(bins, "ssh"), SSH);
script(join(bins, "ps"), QUIET_PS);
for (const bun of [pinned, join(home, ".bun", "bin", "bun")]) script(bun, RECORDING_BUN);
for (const host of ["fake-mac", "fake-linux", "fake-peer"]) {
  script(join(homes, host, ".bun/releases/1.4.2/bin/bun"), RECORDING_BUN);
  for (const [name, body] of Object.entries(HOST_TOOLS)) script(join(homes, host, ".local/bin", name), body);
}
tree(source, {
  "package.json": '{\n  "name": "t",\n  "packageManager": "bun@1.4.2"\n}\n',
  ".gitignore": "node_modules/\nignored/\nruns/\n!tools/runs/\n!tools/runs/**\n/test/.test-timings.json\n",
  "bun.lock": "first",
  edited: "old",
  deleted: "old",
  "tools/runs/discover.ts": "tracked",
  "tools/runtime/gate.ts": "the gate",
});
// A second commit, so HEAD has a parent for a snapshot to keep.
writeFileSync(join(source, "edited"), "committed");
commit(source, "second");
tree(plain, { "package.json": '{\n  "name": "anabasis"\n}\n', "tools/runtime/gate.ts": "the gate" });
execTextSync(capturedExecPath, [join(ROUTER, "install.ts")], { env: { ...env, ANA_HOSTS: undefined } });

afterAll(() => {
  for (const path of [root, tmp]) rmSync(path, { recursive: true, force: true });
});

/** `bun <args>` through the installed router, in `cwd`. */
function run(args: readonly string[], extra: Record<string, string | undefined> = {}, cwd = source) {
  return spawnTextSync(shim, args, { cwd, env: { ...env, ...extra }, timeout: 50_000 });
}

const slot = (host: string, k: number): string =>
  join(homes, host, ".cache/ana-runner", `${MACHINE}-slot-${String(k)}`);
const queueOf = (host: string): string => join(tmp, "ana-runner", host);
/** The process each held slot of a queue names: a slot is a folder, and its one entry its holder. */
const heldIn = (queue: string): string[] =>
  readdirSync(queue).flatMap((each) => {
    try {
      return readdirSync(join(queue, each));
    } catch {
      return [];
    }
  });

/** Each connection the stand-in ssh saw: its host, how it was carried, its socket and options. */
function connections(): { host: string; how: string; socket: string; options: string[] }[] {
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [host = "", how = "", socket = "", ...options] = line.split(" ");
      return { host, how, socket, options };
    });
}

const linesOf = (path: string): string[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];

/** The calls the recording Bun in `at` (a host's home, or this machine's) took, by field. */
const calls = (at: string): Record<string, string>[] =>
  linesOf(join(at, "bun.log")).map((line) =>
    Object.fromEntries(
      line
        .split("\t")
        .map((field) => [field.slice(0, field.indexOf("=")), field.slice(field.indexOf("=") + 1)]),
    ),
  );
const lastCall = (at: string): Record<string, string> | undefined => calls(at).at(-1);
const hostHome = (host: string): string => join(homes, host);
const ran = (host: string): boolean =>
  calls(hostHome(host)).some((call) => call.args?.startsWith("run test") === true);

/** Clears every record and host state a case may have left. */
function fresh(): void {
  writeFileSync(log, "");
  for (const host of ["fake-mac", "fake-linux", "fake-peer"]) {
    for (const state of ["down", "drops", "zero", "flaky", "garbled", "perf", "bun.log", "install.log"]) {
      rmSync(join(hostHome(host), state), { force: true });
    }
  }
  rmSync(join(home, "bun.log"), { force: true });
}

/** The options src/meta/ssh.ts gives the runs verbs for `destination`, in this fixture's temp root. */
function verbOptions(destination: string): string[] {
  const code = `import { sshOptions } from ${JSON.stringify(join(import.meta.dir, "..", "src", "meta", "ssh.ts"))};
console.log(JSON.stringify(sshOptions(${JSON.stringify(destination)})));`;
  const printed = execTextSync(capturedExecPath, ["-e", code], { env: { ...env, ANA_HOSTS: undefined } });
  // SAFETY: the child prints sshOptions' own string[] through JSON.stringify.
  return (JSON.parse(printed) as string[]).filter((_, index) => index % 2 === 1);
}

async function waitFor(check: () => boolean, seconds = 20): Promise<void> {
  const deadline = performance.now() + seconds * 1000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("condition did not settle");
    await Bun.sleep(50);
  }
}

describe("the router on the command line", () => {
  /** What `bun <args>` ran: whether the runner took a slot here, and the Bun that was called with what. */
  function routed(args: readonly string[]) {
    const scratch = mkdtempSync(join(root, "route-"));
    rmSync(join(home, "bun.log"), { force: true });
    const result = run(args, { TMPDIR: scratch, ANA_TEST_TMPDIR: scratch });
    expect(result.status, result.stderr).toBe(0);
    return { queued: existsSync(join(scratch, "ana-runner", "local")), ...lastCall(home) };
  }

  it("sends the five check tasks to the runner and runs everything else on the pinned Bun", () => {
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

  it("puts aside what it replaces, and changes nothing when installed again", () => {
    const other = folder("install-home");
    const foreign = join(other, ".local", "bin", "bun");
    script(foreign, "foreign bun\n");
    const install = () =>
      spawnTextSync(capturedExecPath, [join(ROUTER, "install.ts")], { env: { ...env, HOME: other } });
    const files = () => readdirSync(join(other, ".local", "bin")).toSorted();
    expect(install().status).toBe(0);
    const installed = join(other, ".local", "share", "ana-runner");
    expect(readFileSync(join(installed, "task.sh"), "utf8")).toBe(
      readFileSync(join(ROUTER, "task.sh"), "utf8"),
    );
    expect(readdirSync(installed).toSorted()).toEqual(["INSTALLED", "run.js", "task.sh"]);
    expect(readFileSync(foreign, "utf8")).toBe(readFileSync(join(ROUTER, "bun"), "utf8"));
    const after = files();
    expect(after.filter((name) => name.startsWith("bun.before-router-"))).toHaveLength(1);
    expect(install().status).toBe(0);
    expect(files()).toEqual(after);
  });
});

describe("which host runs a task", () => {
  it("takes a host by its name or ssh destination, and refuses a place in the list, a host without checks or one not listed, naming the hosts that take checks", () => {
    for (const choice of ["zbook", "fake-linux"]) {
      fresh();
      expect(run(["test"], { RUN_REMOTE: choice }).status).toBe(0);
      expect(["fake-mac", "fake-linux"].filter(ran), choice).toEqual(["fake-linux"]);
    }
    for (const choice of ["1", "any", "peer", "elsewhere"]) {
      fresh();
      const refused = run(["test"], { RUN_REMOTE: choice });
      expect(refused.status, choice).toBe(2);
      expect(refused.stderr, choice).toContain(`RUN_REMOTE=${choice} names no host`);
      expect(refused.stderr, choice).toContain("here or one of: m1, zbook");
      expect(connections()).toEqual([]);
      expect(calls(home)).toEqual([]);
    }
  });

  it("runs a task here when RUN_REMOTE is unset, empty, here or 0, asking no host and reading no host list", () => {
    for (const choice of [undefined, "", "here", "0"]) {
      fresh();
      // A list that cannot be read refuses a task that reads it, as the last lines show.
      const local = run(["test"], { RUN_REMOTE: choice, ANA_HOSTS: "not a list" });
      expect(local.status, `${String(choice)}: ${local.stderr}`).toBe(0);
      expect(lastCall(home), String(choice)).toMatchObject({ args: "run test", bun: pinned, active: "1" });
      expect(connections()).toEqual([]);
    }
    fresh();
    expect(run(["test"], { RUN_REMOTE: "m1", ANA_HOSTS: "not a list" }).status).toBe(2);
    const none = run(["test"], { RUN_REMOTE: "m1", ANA_HOSTS: JSON.stringify([PEER]) });
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("ANA_HOSTS sets checks for no host");
    expect(calls(home)).toEqual([]);
  });

  it("reads the hosts from the main worktree's .env.runs where the caller sets none", () => {
    fresh();
    writeFileSync(join(source, ".env.runs"), `ANA_HOSTS='${HOSTS}'\n`);
    try {
      const sent = run(["test"], { RUN_REMOTE: "zbook", ANA_HOSTS: undefined });
      expect(sent.status, sent.stderr).toBe(0);
      expect(ran("fake-linux")).toBe(true);
      expect(existsSync(join(slot("fake-linux", 1), ".env.runs"))).toBe(false);
    } finally {
      unlinkSync(join(source, ".env.runs"));
    }
  });

  it("refuses a setting that is no count, and a tree that pins no Bun, before any host is asked", () => {
    fresh();
    expect(run(["test"], { ANA_RUNNER_WALL: "soon" }).status).toBe(2);
    expect(run(["test"], { RUN_REMOTE: "m1" }, plain).status).toBe(2);
    expect(connections()).toEqual([]);
  });
});

describe("what reaches the host", () => {
  const target = slot("fake-mac", 1);

  it("sends the working tree as it stands on HEAD's own parent, without env files or what git ignores, keeps the caches, and leaves the checkout's index alone", () => {
    fresh();
    const head = git(source, "rev-parse", "HEAD").trim();
    writeFileSync(join(source, "edited"), "unstaged");
    unlinkSync(join(source, "deleted"));
    writeFileSync(join(source, "new file"), "new");
    writeFileSync(join(source, "staged"), "staged");
    git(source, "add", "staged");
    const hidden = [".env", ".env.local", "nested/.env", "ignored/private"];
    for (const name of [...hidden, "node_modules/local", "runs/state", "nested/tools/runs/state"]) {
      mkdirSync(join(source, name, ".."), { recursive: true });
      writeFileSync(join(source, name), "private");
    }
    const caches = ["node_modules/cache", "packages/ui/node_modules/cache", "test/.test-timings.json"];
    for (const name of ["stale", ".env", "ignored/old", ...caches]) {
      mkdirSync(join(target, name, ".."), { recursive: true });
      writeFileSync(join(target, name), "old");
    }
    // A test's scratch tree links the dependency cache; clearing the slot must not follow the link.
    mkdirSync(join(target, ".scratch/old/workspace"), { recursive: true });
    symlinkSync(join(target, "node_modules"), join(target, ".scratch/old/workspace/node_modules"));
    const status = git(source, "status", "--porcelain");

    const sent = run(["test", "test/example.test.ts"], { RUN_REMOTE: "m1" });
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
    for (const name of ["deleted", "stale", ".env", ".env.local", "nested", "ignored", "runs", ".scratch"]) {
      expect(existsSync(join(target, name)), name).toBe(false);
    }
    expect(existsSync(join(target, "node_modules/local"))).toBe(false);
    for (const name of caches) expect(readFileSync(join(target, name), "utf8")).toBe("old");
    expect(git(target, "status", "--porcelain")).toBe("");
    // The snapshot stands in HEAD's place, so a static gate reads the same change there as here.
    expect(git(target, "rev-parse", "HEAD^").trim()).toBe(git(source, "rev-parse", "HEAD^").trim());
    expect(git(source, "rev-parse", "HEAD").trim()).toBe(head);
    expect(git(source, "status", "--porcelain")).toBe(status);
    expect(lastCall(hostHome("fake-mac"))).toMatchObject({
      args: "run test test/example.test.ts",
      active: "1",
    });

    // A slot whose repository broke is made again, and a file gone here goes there.
    unlinkSync(join(source, "new file"));
    rmSync(join(target, ".git"), { recursive: true });
    writeFileSync(join(target, ".git"), "gitdir: /nowhere\n");
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    expect(existsSync(join(target, "new file"))).toBe(false);

    // A clean tree is HEAD itself.
    for (const name of [...hidden, "node_modules/local", "runs/state", "nested/tools/runs/state"]) {
      rmSync(join(source, name), { force: true });
    }
    git(source, "add", "-A");
    commit(source, "third");
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    expect(git(target, "rev-parse", "HEAD")).toBe(git(source, "rev-parse", "HEAD"));
  });

  it("installs a slot's dependencies once per lockfile and pinned Bun, never with what the tree holds", () => {
    const installs = (): string[] => linesOf(join(hostHome("fake-linux"), "install.log"));
    rmSync(slot("fake-linux", 1), { recursive: true, force: true });
    fresh();
    for (const expected of [1, 1]) {
      expect(run(["test"], { RUN_REMOTE: "zbook" }).status).toBe(0);
      expect(installs()).toHaveLength(expected);
    }
    writeFileSync(join(source, "bun.lock"), "second");
    try {
      const moved = run(["test"], { RUN_REMOTE: "zbook" });
      expect(installs()).toHaveLength(2);
      // Where this end is no terminal, the host says everything on one stream.
      expect(moved.stdout).toContain("installed the dependencies");
      expect(run(["test"], { RUN_REMOTE: "zbook" }).stdout).not.toContain("installed the dependencies");
      expect(installs()).toHaveLength(2);
    } finally {
      writeFileSync(join(source, "bun.lock"), "first");
    }
    // The install is the slot's own again once its dependencies are gone.
    rmSync(join(slot("fake-linux", 1), "node_modules"), { recursive: true });
    expect(run(["test"], { RUN_REMOTE: "zbook" }).status).toBe(0);
    expect(installs()).toHaveLength(3);
  });

  it("borrows the objects of the host's own tree, so a push sends only what that tree lacks", () => {
    const lent = slot("fake-linux", 1);
    const held = join(hostHome("fake-linux"), "anabasis");
    rmSync(lent, { recursive: true, force: true });
    git(root, "clone", "-q", source, held);
    fresh();
    writeFileSync(join(source, "edited"), "only this is new");
    try {
      const sent = run(["test"], { RUN_REMOTE: "zbook" });
      expect(sent.status, sent.stderr).toBe(0);
      expect(readFileSync(join(lent, "edited"), "utf8")).toBe("only this is new");
      // The snapshot's commit, its tree and the one changed file; HEAD's own objects stay borrowed.
      const own = git(lent, "count-objects", "-v");
      expect(own).toContain("count: 3\n");
      expect(own).toContain("in-pack: 0\n");
    } finally {
      git(source, "checkout", "-q", "--", "edited");
      rmSync(held, { recursive: true, force: true });
      rmSync(lent, { recursive: true, force: true });
    }
  });

  it("runs the task on the host's pinned Bun with the settings it is sent and the host's performance cores", () => {
    fresh();
    writeFileSync(join(hostHome("fake-mac"), "perf"), "4\n");
    const cases: [Record<string, string>, Record<string, string>][] = [
      [{}, { strict: "", workers: "4", bail: "" }],
      [
        { ANA_TEST_BAIL: "1", ANA_TEST_WORKERS: "3", ANA_LINT_STRICT: "1" },
        { strict: "1", workers: "3", bail: "1" },
      ],
    ];
    for (const [sent, received] of cases) {
      expect(run(["test"], { RUN_REMOTE: "m1", ...sent }).status).toBe(0);
      expect(lastCall(hostHome("fake-mac"))).toMatchObject({
        bun: join(hostHome("fake-mac"), ".bun/releases/1.4.2/bin/bun"),
        ...received,
      });
    }
    git(source, "config", "ana.lintStrict", "true");
    try {
      expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
      expect(lastCall(hostHome("fake-mac"))).toMatchObject({ strict: "1" });
    } finally {
      git(source, "config", "--unset", "ana.lintStrict");
    }
  });

  it("returns the task's exit status where the server reports 0 for every session, and no verdict where the session drops", () => {
    const cases: [string | null, number][] = [
      [null, 3],
      ["zero", 3],
      ["drops", 255],
    ];
    for (const [state, status] of cases) {
      fresh();
      if (state !== null) writeFileSync(join(hostHome("fake-mac"), state), "");
      expect(run(["test", "exit:3"], { RUN_REMOTE: "m1" }).status, state ?? "plain").toBe(status);
    }
  });
});

describe("the connections to a host", () => {
  it("reaches a host with the runs verbs' own options and its shared master, which the next task reuses", () => {
    const expected = verbOptions("fake-mac");
    const socket =
      expected.find((option) => option.startsWith("ControlPath="))?.slice("ControlPath=".length) ?? "";
    rmSync(socket, { force: true });
    fresh();
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    const first = connections();
    // One exchange sets the slot up and reads the free space, then the push, the task and its status.
    expect(first).toHaveLength(4);
    expect(first.map((each) => [each.host, each.how, each.socket])).toEqual([
      ["fake-mac", "open", socket],
      ...first.slice(1).map(() => ["fake-mac", "use", socket]),
    ]);
    for (const each of first) expect(expected.filter((option) => !each.options.includes(option))).toEqual([]);
    fresh();
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    expect(new Set(connections().map((each) => `${each.how} ${each.socket}`))).toEqual(
      new Set([`use ${socket}`]),
    );
  });

  it("connects each exchange alone, and still runs the task, where the temp root is too deep for a socket", () => {
    const deep = join(root, "a-temp-root-deep-enough-that-no-control-socket-fits-under-it");
    mkdirSync(deep);
    fresh();
    expect(run(["test"], { RUN_REMOTE: "m1", TMPDIR: deep, ANA_TEST_TMPDIR: deep }).status).toBe(0);
    expect(new Set(connections().map((each) => `${each.how} ${each.socket}`))).toEqual(
      new Set(["direct none"]),
    );
  });

  it("carries the tree over the shared master where the temp root holds a space", () => {
    // Short enough that its socket fits, so the space reaches git's ssh command.
    const spaced = mkdtempSync("/tmp/ana r-");
    fresh();
    writeFileSync(join(source, "spaced"), "carried");
    try {
      expect(run(["test"], { RUN_REMOTE: "m1", TMPDIR: spaced, ANA_TEST_TMPDIR: spaced }).status).toBe(0);
      expect(readFileSync(log, "utf8")).toContain(`ControlPath=${spaced}/`);
      expect(readFileSync(join(slot("fake-mac", 1), "spaced"), "utf8")).toBe("carried");
    } finally {
      unlinkSync(join(source, "spaced"));
      rmSync(spaced, { recursive: true, force: true });
    }
  });

  it("retries a dropped connection before the task, and starts nothing on a host that does not answer, reads no free space, or lacks room", () => {
    fresh();
    writeFileSync(join(source, "retried"), "after a dropped push");
    writeFileSync(join(hostHome("fake-mac"), "flaky"), "2\n");
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    expect(connections().filter((each) => each.how === "dropped")).toHaveLength(1);
    expect(readFileSync(join(slot("fake-mac", 1), "retried"), "utf8")).toBe("after a dropped push");
    unlinkSync(join(source, "retried"));
    writeFileSync(join(slot("fake-mac", 1), "edited"), "untouched");
    const refusals: [string | null, Record<string, string>, number][] = [
      ["down", {}, 3],
      ["garbled", {}, 1],
      [null, { ANA_RUNNER_MIN_FREE_GB: "1000000" }, 1],
    ];
    for (const [state, extra, tries] of refusals) {
      fresh();
      if (state !== null) writeFileSync(join(hostHome("fake-mac"), state), "");
      const refused = run(["test"], { RUN_REMOTE: "m1", ...extra });
      expect(refused.status, state ?? "room").toBe(69);
      expect(connections(), state ?? "room").toHaveLength(tries);
      expect(readFileSync(join(slot("fake-mac", 1), "edited"), "utf8")).toBe("untouched");
      expect(calls(hostHome("fake-mac"))).toEqual([]);
    }
  });
});

describe("the slots", () => {
  const queue = queueOf("fake-mac");
  const jobs: [Bun.Subprocess, string][] = [];
  async function started(name: string, extra: Record<string, string>) {
    const job = join(root, name);
    const child = capturedSpawn([shim, "test", `hold:${job}`], {
      cwd: source,
      env: { ...env, ...extra },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    jobs.push([child, job]);
    await waitFor(() => existsSync(`${job}.ready`) || child.exitCode !== null);
    expect(child.exitCode).toBeNull();
    return [child, job] as const;
  }
  async function finish([child, job]: readonly [Bun.Subprocess, string]) {
    writeFileSync(`${job}.release`, "");
    expect(await child.exited).toBe(0);
  }
  /** Lets every task started so far end, and clears the queue for the next case. */
  async function released(): Promise<void> {
    for (const [child, job] of jobs) {
      writeFileSync(`${job}.release`, "");
      await child.exited;
    }
    rmSync(queue, { recursive: true, force: true });
  }
  const holders = (): string[] => heldIn(queue);

  it("gives each task of a host its own slot up to the host's count, another host unhindered, and a dead or older runner's slot to the next task", async () => {
    fresh();
    try {
      const first = await started("first", { RUN_REMOTE: "m1" });
      writeFileSync(join(source, "edited"), "second snapshot");
      const second = await started("second", { RUN_REMOTE: "m1" });
      expect(readFileSync(join(slot("fake-mac", 1), "edited"), "utf8")).not.toBe("second snapshot");
      expect(readFileSync(join(slot("fake-mac", 2), "edited"), "utf8")).toBe("second snapshot");
      const other = await started("other", { RUN_REMOTE: "zbook" });
      expect(run(["test"], { RUN_REMOTE: "zbook", ANA_RUNNER_QUEUE_WAIT: "0" }).status).toBe(75);
      expect(run(["test"], { RUN_REMOTE: "m1", ANA_RUNNER_QUEUE_WAIT: "0" }).status).toBe(75);
      expect(calls(home)).toEqual([]);
      await finish(first);
      // A waiter takes the slot within its next looks.
      expect(run(["test"], { RUN_REMOTE: "m1", ANA_RUNNER_QUEUE_WAIT: "5" }).status).toBe(0);
      await finish(other);
      await finish(second);
      expect(holders()).toEqual([]);
      // A holder that died holds nothing, whether it left a slot's entry or the link of the runner
      // before, so each of the host's two slots goes to a next task.
      mkdirSync(join(queue, "slot-1", "99999999"), { recursive: true });
      rmSync(join(queue, "slot-2"), { recursive: true, force: true });
      symlinkSync("99999999", join(queue, "slot-2"));
      const third = await started("third", { RUN_REMOTE: "m1" });
      const fourth = await started("fourth", { RUN_REMOTE: "m1" });
      expect(holders().length).toBe(2);
      // A live task of the runner before still holds its link.
      await finish(third);
      await finish(fourth);
      rmSync(join(queue, "slot-1"), { recursive: true, force: true });
      symlinkSync(String(runtimeProcess.pid), join(queue, "slot-1"));
      rmSync(join(queue, "slot-2"), { recursive: true, force: true });
      symlinkSync(String(runtimeProcess.pid), join(queue, "slot-2"));
      expect(run(["test"], { RUN_REMOTE: "m1", ANA_RUNNER_QUEUE_WAIT: "0" }).status).toBe(75);
    } finally {
      git(source, "checkout", "-q", "--", "edited");
      await released();
    }
  });

  it("gives a free slot to one of the tasks that reach it together, and the host no more tasks than its slots", async () => {
    fresh();
    rmSync(queue, { recursive: true, force: true });
    const together = Array.from({ length: 6 }, (_, at) => {
      const job = join(root, `together-${String(at)}`);
      const child = capturedSpawn([shim, "test", `hold:${job}`], {
        cwd: source,
        env: { ...env, RUN_REMOTE: "m1", ANA_RUNNER_QUEUE_WAIT: "0" },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      jobs.push([child, job]);
      return [child, job] as const;
    });
    try {
      await waitFor(() =>
        together.every(([child, job]) => child.exitCode !== null || existsSync(`${job}.ready`)),
      );
      // The host has two slots: two tasks run, each in a slot of its own, and four found none.
      expect(together.filter(([child]) => child.exitCode === null).length).toBe(2);
      expect(together.filter(([child]) => child.exitCode === 75).length).toBe(4);
      expect(holders().length).toBe(2);
    } finally {
      await released();
    }
  });
});

describe("this machine", () => {
  it("names a missing Bun instead of blaming ANA_HOSTS", () => {
    const empty = folder("no-bun");
    const { status, stderr } = spawnTextSync(join(ROUTER, "bun"), ["test"], {
      cwd: source,
      env: { ...env, HOME: empty },
    });
    expect(status).toBe(2);
    expect(stderr).toContain(`no Bun at ${join(empty, ".bun/bin/bun")}`);
    expect(stderr).not.toContain("ANA_HOSTS");
  });

  it("runs RUN_REMOTE=here on the pinned Bun, reaps an orphaned test worker and spares an orphan that names the checkout", async () => {
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
      fresh();
      const local = run(["test"], { RUN_REMOTE: "here", PATH: `${filtered}:${env.PATH ?? ""}` });
      expect(lastCall(home)).toMatchObject({ bun: pinned, active: "1" });
      expect(connections()).toEqual([]);
      expect(local.stderr).toContain(String(worker));
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

  it("ends a task at its deadline and returns at once from one that ends before it", () => {
    const hung = join(root, "hung");
    const started = performance.now();
    expect(run(["test", `hold:${hung}`], { RUN_REMOTE: "here", ANA_RUNNER_WALL: "1" }).status).not.toBe(0);
    expect(performance.now() - started).toBeLessThan(4000);
    const quick = performance.now();
    expect(run(["test", "exit:4"], { RUN_REMOTE: "here", ANA_RUNNER_WALL: "30" }).status).toBe(4);
    expect(performance.now() - quick).toBeLessThan(3000);
    expect(heldIn(queueOf("local"))).toEqual([]);
  });
});
