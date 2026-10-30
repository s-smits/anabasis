/**
 * The bun router (`tools/runtime/router/`) as a machine meets it: installed by its own `install.ts`
 * into a scratch home, then run as `bun` and as `run.sh` over a real Git tree. The stand-in ssh models
 * the transport and the hosts, never the runner's commands: a host is a folder whose state is a file
 * in it, a master is its socket file, every command runs in the host's home under bash with HOME and
 * PATH alone, since ssh carries no environment, and rsync goes through it to a real rsync server.
 * Each host's pinned Bun records how host.sh called it, so the settings, the status and the deadline
 * are read where the task ran. A task holds or exits through its own arguments (`hold:<path>`,
 * `exit:<n>`). A stand-in `ps` lists no other process to the reaper, so no case can reap an orphan of
 * the machine running the suite; the reaper's own case names what it lists.
 *
 * Rewritten on 29 October: the earlier stand-in knew each exchange by its text, cut host.sh before
 * the task ran, and passed the caller's whole environment to the host, so a forwarded setting could
 * not fail to arrive.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
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

/** A Bun that records how it was called in its HOME's bun.log, and hands the host lister to Bun. A
 *  held call gives up after two minutes: a suite killed before its `finally` released them left three
 *  fakes waiting on the Linux runner from 28 to 30 October. */
const RECORDING_BUN = `#!/bin/bash
case "$*" in *hosts.js*) exec ${capturedExecPath} "$@" ;; esac
if [[ "\${1-}" == --version ]]; then echo 1.4.2; exit 0; fi
[[ "\${1-}" != install ]] || exit 0
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

/** A host's own tools: its load and cores from \`load\`, its performance cores from \`perf\`, and a
 *  free-space reading that \`garbled\` spoils. */
const HOST_TOOLS = {
  sysctl: `#!/bin/sh
case "$*" in
  "-n vm.loadavg") awk '{ print "{ " $1 " 0.00 0.00 }" }' "$HOME/load" ;;
  "-n hw.perflevel0.logicalcpu") cat "$HOME/perf" 2>/dev/null ;;
  *) exit 1 ;;
esac
`,
  getconf: `#!/bin/sh\nawk '{ print $2 }' "$HOME/load"\n`,
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
const runnerDir = join(home, ".local", "share", "ana-runner");
const runner = join(runnerDir, "run.sh");
const shim = join(home, ".local", "bin", "bun");
const log = join(root, "ssh.log");
const pinned = join(home, ".bun", "releases", "1.4.2", "bin", "bun");

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
  writeFileSync(join(homes, host, "load"), "0.00 4\n");
}
tree(source, {
  "package.json": '{\n  "name": "t",\n  "packageManager": "bun@1.4.2"\n}\n',
  ".gitignore": "node_modules/\nignored/\nruns/\n!tools/runs/\n!tools/runs/**\n!.harness/backends/\n",
  edited: "old",
  deleted: "old",
  "tools/runs/discover.ts": "tracked",
  "tools/runtime/gate.ts": "the gate",
});
tree(plain, { "package.json": '{\n  "name": "anabasis"\n}\n', "tools/runtime/gate.ts": "the gate" });
execTextSync(capturedExecPath, [join(ROUTER, "install.ts")], { env: { ...env, ANA_HOSTS: undefined } });

afterAll(() => {
  for (const path of [root, tmp]) rmSync(path, { recursive: true, force: true });
});

function run(args: readonly string[], extra: Record<string, string | undefined> = {}, cwd = source) {
  return spawnTextSync("bash", [runner, ...args], { cwd, env: { ...env, ...extra }, timeout: 50_000 });
}

const slot = (host: string, k: number): string =>
  join(homes, host, ".cache/ana-runner", `${MACHINE}-slot-${String(k)}`);
const queueOf = (host: string): string => join(tmp, "ana-runner", host);

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

/** The calls the recording Bun in `at` (a host's home, or this machine's) took, by field. */
function calls(at: string): Record<string, string>[] {
  const path = join(at, "bun.log");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) =>
      Object.fromEntries(
        line
          .split("\t")
          .map((field) => [field.slice(0, field.indexOf("=")), field.slice(field.indexOf("=") + 1)]),
      ),
    );
}
const lastCall = (at: string): Record<string, string> | undefined => calls(at).at(-1);
const hostHome = (host: string): string => join(homes, host);

/** Clears every record and host state a case may have left. */
function fresh(): void {
  writeFileSync(log, "");
  for (const host of ["fake-mac", "fake-linux", "fake-peer"]) {
    for (const state of ["down", "drops", "zero", "flaky", "garbled", "perf", "bun.log"]) {
      rmSync(join(hostHome(host), state), { force: true });
    }
    writeFileSync(join(hostHome(host), "load"), "0.00 4\n");
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
  /** What `bun <args>` ran: whether run.sh queued it here, and the Bun that was called with what. */
  function routed(args: readonly string[], cwd = source) {
    const scratch = mkdtempSync(join(root, "route-"));
    rmSync(join(home, "bun.log"), { force: true });
    const result = spawnTextSync(shim, args, {
      cwd,
      env: { ...env, TMPDIR: scratch, RUN_REMOTE: "0" },
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    return { queued: existsSync(join(scratch, "ana-runner", "local")), ...lastCall(home) };
  }

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

  it("puts aside what it replaces, changes nothing when installed again, and puts it back on uninstall", () => {
    const other = folder("install-home");
    const foreign = join(other, ".local", "bin", "bun");
    script(foreign, "foreign bun\n");
    const install = (...args: string[]) =>
      spawnTextSync(capturedExecPath, [join(ROUTER, "install.ts"), ...args], {
        env: { ...env, HOME: other },
      });
    const files = () => readdirSync(join(other, ".local", "bin")).toSorted();
    expect(install().status).toBe(0);
    const installed = join(other, ".local", "share", "ana-runner");
    for (const name of ["lib.sh", "run.sh", "host.sh"]) {
      expect(readFileSync(join(installed, name), "utf8")).toBe(readFileSync(join(ROUTER, name), "utf8"));
    }
    expect(readFileSync(foreign, "utf8")).toBe(readFileSync(join(ROUTER, "bun"), "utf8"));
    const after = files();
    expect(after.filter((name) => name.startsWith("bun.before-router-"))).toHaveLength(1);
    expect(install().status).toBe(0);
    expect(files()).toEqual(after);
    expect(install("--uninstall").status).toBe(0);
    expect(readFileSync(foreign, "utf8")).toBe("foreign bun\n");
    expect(files()).toEqual(["bun"]);
    expect(existsSync(join(installed, "run.sh"))).toBe(false);
  });
});

describe.skipIf(realRsync === null)("which host runs a task", () => {
  const ran = (host: string): boolean =>
    calls(hostHome(host)).some((call) => call.args?.startsWith("run test") === true);

  it("gives an unnamed task to the first host that is not busy by load or by this machine's slots, and never asks a host without checks", () => {
    const held = [1, 2].map((k) => join(queueOf("fake-mac"), `slot-${String(k)}`));
    const cases: [Record<string, string>, boolean, string, string[]][] = [
      [{ "fake-mac": "9.50 8" }, false, "fake-linux", ["fake-mac", "9.50", "8"]],
      [{}, true, "fake-linux", ["fake-mac", "0.00", "4", "2 of 2"]],
      [{ "fake-mac": "garbled" }, false, "fake-linux", ["fake-mac"]],
      [{ "fake-mac": "7.90 8" }, false, "fake-mac", []],
      [{ "fake-mac": "9.50 8", "fake-linux": "6.00 4" }, false, "fake-mac", []],
    ];
    for (const [loads, holds, expected, facts] of cases) {
      fresh();
      for (const [host, load] of Object.entries(loads)) {
        writeFileSync(join(hostHome(host), "load"), `${load}\n`);
      }
      for (const path of holds ? held : []) {
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, "pid"), `${String(runtimeProcess.pid)}\n`);
      }
      const picked = run(["test"]);
      for (const path of holds ? held : []) rmSync(path, { recursive: true });
      expect(picked.status, picked.stderr).toBe(0);
      expect(["fake-mac", "fake-linux"].filter(ran), picked.stderr).toEqual([expected]);
      expect(connections().filter((each) => each.host === "fake-peer")).toEqual([]);
      for (const fact of facts) expect(picked.stderr).toContain(fact);
    }
  });

  it("takes a host by its place, name or ssh destination, and refuses one without checks or not listed", () => {
    for (const choice of ["2", "zbook", "fake-linux"]) {
      fresh();
      expect(run(["test"], { RUN_REMOTE: choice }).status).toBe(0);
      expect(["fake-mac", "fake-linux"].filter(ran), choice).toEqual(["fake-linux"]);
    }
    for (const choice of ["peer", "9"]) {
      fresh();
      expect(run(["test"], { RUN_REMOTE: choice }).status, choice).toBe(2);
      expect(connections()).toEqual([]);
    }
  });

  it("runs here where no host sets checks, and refuses a list it cannot read or one from an older hosts.js", () => {
    fresh();
    expect(run(["test"], { ANA_HOSTS: JSON.stringify([PEER]) }).status).toBe(0);
    expect(connections()).toEqual([]);
    expect(lastCall(home)).toMatchObject({ args: "run test", active: "1" });
    expect(run(["test"], { ANA_HOSTS: "not a list" }).status).toBe(2);
    const lister = join(runnerDir, "hosts.js");
    const current = readFileSync(lister, "utf8");
    writeFileSync(lister, 'console.log("m1 fake-mac 2");\n');
    try {
      const stale = run(["test"], { RUN_REMOTE: "m1", ANA_RUNNER_QUEUE_WAIT: "5" });
      expect(stale.status).toBe(2);
      expect(stale.stderr).toContain("install.ts");
    } finally {
      writeFileSync(lister, current);
    }
  });

  it("refuses an unknown task, a setting that is no count, and a tree that pins no Bun, before any host is asked", () => {
    fresh();
    expect(run(["bogus"]).status).toBe(2);
    expect(run(["test"], { ANA_RUNNER_WALL: "soon" }).status).toBe(2);
    expect(run(["test"], { RUN_REMOTE: "m1" }, plain).status).toBe(2);
    expect(connections()).toEqual([]);
  });
});

describe.skipIf(realRsync === null)("what reaches the host", () => {
  const target = slot("fake-mac", 1);

  it("sends the working tree as it stands, without credentials, run state or ignored files, and keeps the caches", () => {
    fresh();
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
    expect(lastCall(hostHome("fake-mac"))).toMatchObject({
      args: "run test test/example.test.ts",
      active: "1",
    });

    unlinkSync(join(source, "new file"));
    rmSync(join(target, ".git"), { recursive: true });
    writeFileSync(join(target, ".git"), "gitdir: /nowhere\n");
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    expect(existsSync(join(target, "new file"))).toBe(false);
    expect(git(target, "ls-files")).not.toContain("new file");
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

describe.skipIf(realRsync === null)("the connections to a host", () => {
  it("reaches a host with the runs verbs' own options and its shared master, which the next task reuses", () => {
    const expected = verbOptions("fake-mac");
    const socket =
      expected.find((option) => option.startsWith("ControlPath="))?.slice("ControlPath=".length) ?? "";
    rmSync(socket, { force: true });
    fresh();
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    const first = connections();
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
    rmSync(socket, { force: true });
    fresh();
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    expect(connections().filter((each) => each.how === "open")).toHaveLength(1);
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
    // Short enough that its socket fits, so the space reaches rsync's ssh command.
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
    writeFileSync(join(source, "retried"), "after a dropped transfer");
    writeFileSync(join(hostHome("fake-mac"), "flaky"), "3\n");
    expect(run(["test"], { RUN_REMOTE: "m1" }).status).toBe(0);
    expect(connections().filter((each) => each.how === "dropped")).toHaveLength(1);
    expect(readFileSync(join(slot("fake-mac", 1), "retried"), "utf8")).toBe("after a dropped transfer");
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

describe.skipIf(realRsync === null)("the queue", () => {
  const queue = queueOf("fake-mac");
  const jobs: [Bun.Subprocess, string][] = [];
  function start(name: string, extra: Record<string, string>): readonly [Bun.Subprocess, string] {
    const job = join(root, name);
    const stderr = openSync(`${job}.log`, "w");
    const child = capturedSpawn(["bash", runner, "test", `hold:${job}`], {
      cwd: source,
      env: { ...env, ...extra },
      stdin: "ignore",
      stdout: "ignore",
      stderr,
    });
    closeSync(stderr);
    jobs.push([child, job]);
    return [child, job] as const;
  }
  async function started(name: string, extra: Record<string, string>) {
    const [child, job] = start(name, extra);
    await waitFor(() => existsSync(`${job}.ready`) || child.exitCode !== null);
    expect(child.exitCode, readFileSync(`${job}.log`, "utf8")).toBeNull();
    return [child, job] as const;
  }
  async function finish([child, job]: readonly [Bun.Subprocess, string]) {
    writeFileSync(`${job}.release`, "");
    expect(await child.exited).toBe(0);
  }
  const tickets = (): string[] => readdirSync(queue).filter((name) => name.startsWith("wait."));

  it("runs each host's slots apart, serves waiters in order with another host unhindered, and frees a dead holder's slot", async () => {
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
      const stale = join(queue, "wait.stale");
      writeFileSync(stale, "99999999\n");
      utimesSync(stale, 1, 1);
      const waitingFirst = start("waiting-first", { RUN_REMOTE: "m1", ANA_RUNNER_QUEUE_WAIT: "60" });
      await waitFor(() => !existsSync(stale) && tickets().length === 1);
      const waitingSecond = start("waiting-second", { RUN_REMOTE: "m1", ANA_RUNNER_QUEUE_WAIT: "60" });
      await waitFor(() => tickets().length === 2);
      const released = performance.now();
      await finish(first);
      await waitFor(() => existsSync(`${waitingFirst[1]}.ready`), 4);
      expect(performance.now() - released).toBeLessThan(4000);
      expect(existsSync(`${waitingSecond[1]}.ready`)).toBe(false);
      await finish(other);
      await finish(second);
      await waitFor(() => existsSync(`${waitingSecond[1]}.ready`), 4);
      await finish(waitingFirst);
      mkdirSync(join(queue, "slot-1"));
      writeFileSync(join(queue, "slot-1", "pid"), "99999999\n");
      await finish(await started("third", { RUN_REMOTE: "m1" }));
      await finish(waitingSecond);
      expect(readdirSync(queue)).toEqual([]);
    } finally {
      for (const [child, job] of jobs) {
        writeFileSync(`${job}.release`, "");
        await child.exited;
      }
    }
  });
});

describe("this machine", () => {
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
      fresh();
      const local = run(["test"], { RUN_REMOTE: "0", PATH: `${filtered}:${env.PATH ?? ""}` });
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
    expect(run(["test", `hold:${hung}`], { RUN_REMOTE: "0", ANA_RUNNER_WALL: "1" }).status).not.toBe(0);
    expect(performance.now() - started).toBeLessThan(4000);
    const quick = performance.now();
    expect(run(["test", "exit:4"], { RUN_REMOTE: "0", ANA_RUNNER_WALL: "30" }).status).toBe(4);
    expect(performance.now() - quick).toBeLessThan(3000);
    expect(readdirSync(queueOf("local"))).toEqual([]);
  });
});
