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
  cpSync,
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
import { gitMaybe } from "../src/meta/git.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, runtimeProcess } from "../src/meta/process.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const ROUTER = join(import.meta.dir, "..", "tools", "runtime", "router");
const realPs = Bun.which("ps") ?? "/bin/ps";
const MACHINE = execTextSync("uname", ["-n"]).trim().split(".")[0] ?? "";
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-router-")));
const cleanups: string[] = [root];

const SSH = `#!/bin/bash
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
if [[ -e "$home/load" && "\${args[*]:1}" == *proc/loadavg* ]]; then
  said sampled
  cat "$home/load"
  exit 0
fi
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

const RECORDING_BUN = `#!/bin/bash
case "$*" in *run.js*) exec ${capturedExecPath} "$@" ;; esac
if [[ "\${1-}" == --version ]]; then echo 1.4.2; exit 0; fi
if [[ "\${1-}" == install ]]; then exit 0; fi
printf 'bun=%s\\tactive=%s\\tstrict=%s\\tworkers=%s\\tbail=%s\\tclimb=%s\\tpaths=%s\\thostLoad=%s\\thosts=%s\\targs=%s\\n' "$0" "\${ANA_RUNNER_ACTIVE-}" \\
  "\${ANA_LINT_STRICT-}" "\${ANA_TEST_WORKERS-}" "\${ANA_TEST_BAIL-}" "\${ANA_CLIMB-}" "\${ANA_LINT_PATHS-}" "\${ANA_TEST_HOST_LOAD-}" "\${ANA_HOSTS-}" "$*" >>"$HOME/bun.log"
status=0
for arg in "$@"; do
  case "$arg" in
    hold:*) : >"\${arg#hold:}.ready"; until [[ -e "\${arg#hold:}.release" ]] || ((SECONDS > 120)); do sleep 0.05; done ;;
    exit:*) status="\${arg#exit:}" ;;
    */fails.test.ts) status=3 ;;
    nostart) : >"$HOME/nostart" ;;
  esac
done
times=""
case "$*" in *.test.ts*)
  for file in test/*.test.ts; do
    [[ -f "$file" ]] || continue
    times="$times\${times:+,}\\"$file\\":$(( $(wc -c <"$file") * 1000 * $(cat "$HOME/speed" 2>/dev/null || echo 1) ))"
  done ;;
esac
[[ -z "$times" || -e "$HOME/notimes" ]] ||
  printf '{"version":1,"run":"%s","files":{%s}}' "$RANDOM$$" "$times" >test/.test-timings.json
exit "$status"
`;

const QUIET_PS = `#!/bin/sh
case "$*" in
  *command=*) echo "    1     0 /sbin/launchd" ;;
  *) exec ${realPs} "$@" ;;
esac
`;

const HOST_TOOLS = {
  sysctl: "#!/bin/sh\nexit 1\n",
  df: `#!/bin/sh\nif [ -e "$HOME/garbled" ]; then echo nonsense; else exec /bin/df "$@"; fi\n`,
  chmod: `#!/bin/sh\nif [ -e "$HOME/nostart" ]; then printf '#!/bin/sh\\nexit 1\\n' >"$2"; fi\nexec /bin/chmod "$@"\n`,
  ps: QUIET_PS,
};

const PEER = { name: "peer", ssh: "fake-peer", tree: "~/anabasis", bun: "~/.bun/bin/bun" };
const HOSTS = JSON.stringify([
  { name: "m1", ssh: "fake-mac", tree: "~/anabasis", bun: "~/.bun/bin/bun", checks: 2 },
  { name: "zbook", ssh: "fake-linux", tree: "~/anabasis", bun: "~/.bun/bin/bun", checks: 1 },
]);

function folder(parent: string, name: string): string {
  const path = join(parent, name);
  mkdirSync(path, { recursive: true });
  return path;
}

const templateRoot = folder(root, "template");
const templateSource = folder(templateRoot, "source");
const plain = folder(root, "plain");
const templateHomes = folder(templateRoot, "homes");
const bins = folder(root, "bin");
const templateHome = folder(templateRoot, "home");

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
  "ANA_CHECK_HOST",
  "ANA_RUNNER_ACTIVE",
  "ANA_RUNNER_SPARE_HELD",
  "ANA_TEST_WORKERS",
  "ANA_TEST_HOST_LOAD",
  "ANA_LINT_STRICT",
  "ANA_LINT_PATHS",
  "ANA_TEST_BAIL",
  "ANA_CLIMB",
  "GIT_INDEX_FILE",
  "EVAL_RUNNER",
]) {
  delete quiet[name];
}

const baseEnv: Record<string, string | undefined> = {
  ...quiet,
  PATH: `${bins}:${Bun.env.PATH ?? ""}`,
  SHELL: "/bin/sh",
  FAKE_PATH: Bun.env.PATH ?? "",
  ANA_HOSTS: HOSTS,
  ANA_RUNNER_RETRY_DELAY: "0",
  ANA_RUNNER_MIN_FREE_GB: "1",
};

script(join(bins, "ssh"), SSH);
script(join(bins, "ps"), QUIET_PS);
for (const bun of [
  join(templateHome, ".bun", "releases", "1.4.2", "bin", "bun"),
  join(templateHome, ".bun", "bin", "bun"),
]) {
  script(bun, RECORDING_BUN);
}
for (const host of ["fake-mac", "fake-linux", "fake-peer"]) {
  script(join(templateHomes, host, ".bun/releases/1.4.2/bin/bun"), RECORDING_BUN);
  for (const [name, body] of Object.entries(HOST_TOOLS)) {
    script(join(templateHomes, host, ".local/bin", name), body);
  }
}
tree(templateSource, {
  "package.json": '{\n  "name": "t",\n  "packageManager": "bun@1.4.2"\n}\n',
  ".gitignore": "node_modules/\nignored/\nruns/\n!tools/runs/\n!tools/runs/**\n/test/.test-timings.json\n",
  "bun.lock": "first",
  edited: "old",
  deleted: "old",
  "tools/runs/discover.ts": "tracked",
  "tools/runtime/gate.ts": "the gate",
});
writeFileSync(join(templateSource, "edited"), "committed");
commit(templateSource, "second");
tree(plain, { "package.json": '{\n  "name": "anabasis"\n}\n', "tools/runtime/gate.ts": "the gate" });
execTextSync(capturedExecPath, [join(ROUTER, "install.ts")], {
  env: { ...baseEnv, HOME: templateHome, ANA_HOSTS: undefined },
});

afterAll(() => {
  for (const path of cleanups) rmSync(path, { recursive: true, force: true });
});

const MAX_INFLIGHT = 8;
let inflight = 0;
const waiting: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inflight < MAX_INFLIGHT) {
    inflight += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiting.push(resolve);
  });
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next === undefined) inflight -= 1;
  else next();
}

async function spawnAsync(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    timeoutMs?: number;
    direct?: boolean | undefined;
  },
): Promise<{ status: number; stdout: string; stderr: string }> {
  const gated = options.direct !== true;
  if (gated) await acquireSlot();
  try {
    const child = capturedSpawn([command, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, options.timeoutMs ?? 50_000);
    try {
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { status: timedOut ? 124 : status, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    if (gated) releaseSlot();
  }
}

const linesOf = (path: string): string[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line !== "")
    : [];

const calls = (at: string): Record<string, string>[] =>
  linesOf(join(at, "bun.log")).map((line) =>
    Object.fromEntries(
      line
        .split("\t")
        .map((field) => [field.slice(0, field.indexOf("=")), field.slice(field.indexOf("=") + 1)]),
    ),
  );
const lastCall = (at: string): Record<string, string> | undefined => calls(at).at(-1);

const heldIn = (queue: string): string[] =>
  existsSync(queue)
    ? readdirSync(queue, { withFileTypes: true }).flatMap((each) =>
        each.isDirectory() ? readdirSync(join(queue, each.name)) : [],
      )
    : [];

function makeCase(options: { readonly copySource?: boolean } = {}) {
  const dir = realpathSync(mkdtempSync(join(root, "c-")));
  const tmp = realpathSync(mkdtempSync(join("/tmp", "ana-r-")));
  cleanups.push(tmp);
  const home = folder(dir, "home");
  const homes = folder(dir, "homes");
  const source = options.copySource === true ? join(dir, "source") : templateSource;
  symlinkSync(join(templateHome, ".bun"), join(home, ".bun"));
  symlinkSync(join(templateHome, ".local"), join(home, ".local"));
  for (const host of ["fake-mac", "fake-linux", "fake-peer"]) {
    const hostDir = folder(homes, host);
    symlinkSync(join(templateHomes, host, ".bun"), join(hostDir, ".bun"));
    symlinkSync(join(templateHomes, host, ".local"), join(hostDir, ".local"));
  }
  if (options.copySource === true) cpSync(templateSource, source, { recursive: true });
  const shim = join(home, ".local", "bin", "bun");
  const pinned = join(home, ".bun", "releases", "1.4.2", "bin", "bun");
  const log = join(dir, "ssh.log");
  writeFileSync(log, "");
  const env: Record<string, string | undefined> = {
    ...baseEnv,
    HOME: home,
    TMPDIR: tmp,
    ANA_TEST_TMPDIR: tmp,
    FAKE_HOMES: homes,
    FAKE_LOG: log,
  };
  const run = (
    args: readonly string[],
    extra: Record<string, string | undefined> = {},
    cwd = source,
    runOptions: { readonly direct?: boolean } = {},
  ) => spawnAsync(shim, args, { cwd, env: { ...env, ...extra }, direct: runOptions.direct });
  const hostHome = (host: string): string => join(homes, host);
  const slot = (host: string, k: number): string =>
    join(homes, host, ".cache/ana-runner", `${MACHINE}-slot-${String(k)}`);
  const queueOf = (host: string): string => join(tmp, "ana-runner", host);
  const connections = (): { host: string; how: string; socket: string; options: string[] }[] =>
    linesOf(log).map((line) => {
      const [host = "", how = "", socket = "", ...flags] = line.split(" ");
      return { host, how, socket, options: flags };
    });
  const ran = (host: string): boolean =>
    calls(hostHome(host)).some((call) => call.args?.startsWith("run test") === true);
  const loaded = (host: string, cores: number, load: number): void => {
    const each = load.toFixed(2);
    writeFileSync(join(hostHome(host), "load"), `${String(cores)}\n${each} ${each} ${each}\n50\n---\n`);
  };
  const spreadLoads = (): void => {
    loaded("fake-mac", 2, 0);
    loaded("fake-linux", 4, 400);
    loaded("fake-peer", 1, 0);
  };
  const fresh = (): void => {
    writeFileSync(log, "");
    for (const host of ["fake-mac", "fake-linux", "fake-peer"]) {
      for (const state of ["down", "drops", "zero", "flaky", "garbled", "nostart", "load", "bun.log"]) {
        rmSync(join(hostHome(host), state), { force: true });
      }
    }
    rmSync(join(home, "bun.log"), { force: true });
  };
  return {
    dir,
    tmp,
    source,
    home,
    homes,
    shim,
    pinned,
    log,
    env,
    run,
    hostHome,
    slot,
    queueOf,
    connections,
    ran,
    loaded,
    spreadLoads,
    fresh,
  };
}

async function waitFor(check: () => boolean, seconds = 20): Promise<void> {
  const deadline = performance.now() + seconds * 1000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("condition did not settle");
    await Bun.sleep(50);
  }
}

async function routedCase(args: readonly string[], cwd = templateSource) {
  const sb = makeCase();
  const result = await sb.run(args, {}, cwd);
  expect(result.status, result.stderr).toBe(0);
  return { queued: existsSync(join(sb.tmp, "ana-runner", "local")), pinned: sb.pinned, ...lastCall(sb.home) };
}

describe.concurrent("the router on the command line", () => {
  it("sends the five check tasks to the runner and runs everything else on the pinned Bun", async () => {
    const cases: [readonly string[], boolean, string][] = [
      [["run", "typecheck"], true, "run typecheck"],
      [["test", "test/a.test.ts"], true, "run test test/a.test.ts"],
      [["test"], true, "run test"],
      [["run", "test", "--", "x.test.ts", "y.test.ts"], true, "run test x.test.ts y.test.ts"],
      [["run", "lint", "--", "--strict"], true, "run lint --strict"],
      [["run", "secrets"], true, "run secrets"],
      [["run", "gate"], true, "run gate"],
      [["fmt"], false, "fmt"],
      [["tools/runs/discover.ts", "test"], false, "tools/runs/discover.ts test"],
    ];
    await Promise.all(
      cases.map(async ([args, queued, said]) => {
        const seen = await routedCase(args);
        expect(seen, args.join(" ")).toMatchObject({
          queued,
          args: said,
          bun: seen.pinned,
          active: queued ? "1" : "",
        });
      }),
    );
  });

  it("runs a nested package's own scripts, and routes from a folder of the root's package", async () => {
    const sb = makeCase({ copySource: true });
    const nested = join(sb.source, "packages", "nested");
    mkdirSync(join(nested, "src"), { recursive: true });
    mkdirSync(join(sb.source, "tools", "runs"), { recursive: true });
    writeFileSync(join(nested, "package.json"), '{\n  "name": "nested"\n}\n');
    await Promise.all(
      (
        [
          [nested, false],
          [join(nested, "src"), false],
          [join(sb.source, "tools", "runs"), true],
        ] as const
      ).map(async ([cwd, queued]) => {
        expect(await routedCase(["run", "typecheck"], cwd), cwd).toMatchObject({
          queued,
          args: "run typecheck",
        });
      }),
    );
  });

  it("routes check tasks given through --cwd or a symlinked worktree path, and keeps non-check --cwd arguments intact", async () => {
    const sb = makeCase({ copySource: true });
    const nested = join(sb.source, "packages", "nested");
    const link = join(sb.dir, "source-link");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "package.json"), '{\n  "name": "nested"\n}\n');
    symlinkSync(sb.source, link);
    const cases: [readonly string[], string, boolean, string][] = [
      [["--cwd", sb.source, "run", "typecheck"], sb.dir, true, "run typecheck"],
      [[`--cwd=${sb.source}`, "test", "test/a.test.ts"], sb.dir, true, "run test test/a.test.ts"],
      [["--cwd", sb.source, "run", "test", "--", "x.test.ts"], sb.dir, true, "run test x.test.ts"],
      [["--cwd", nested, "run", "typecheck"], sb.dir, false, `--cwd ${nested} run typecheck`],
      [["--cwd", sb.source, "fmt"], sb.dir, false, `--cwd ${sb.source} fmt`],
      [["run", "typecheck"], link, true, "run typecheck"],
    ];
    await Promise.all(
      cases.map(async ([args, cwd, queued, said]) => {
        const seen = await routedCase(args, cwd);
        expect(seen, `${cwd}: ${args.join(" ")}`).toMatchObject({
          queued,
          args: said,
          bun: seen.pinned,
          active: queued ? "1" : "",
        });
      }),
    );
  });

  it("puts aside what it replaces, and changes nothing when installed again", async () => {
    const other = folder(root, `install-home-${String(Date.now())}`);
    const foreign = join(other, ".local", "bin", "bun");
    script(foreign, "foreign bun\n");
    const install = () =>
      spawnAsync(capturedExecPath, [join(ROUTER, "install.ts")], {
        cwd: templateSource,
        env: { ...baseEnv, HOME: other },
      });
    const files = () => readdirSync(join(other, ".local", "bin")).toSorted();
    expect((await install()).status).toBe(0);
    const installed = join(other, ".local", "share", "ana-runner");
    expect(readFileSync(join(installed, "task.sh"), "utf8")).toBe(
      readFileSync(join(ROUTER, "task.sh"), "utf8"),
    );
    expect(readdirSync(installed).toSorted()).toEqual(["INSTALLED", "run.js", "task.sh"]);
    expect(readFileSync(foreign, "utf8")).toBe(readFileSync(join(ROUTER, "bun"), "utf8"));
    const after = files();
    expect(after.filter((name) => name.startsWith("bun.before-router-"))).toHaveLength(1);
    expect((await install()).status).toBe(0);
    expect(files()).toEqual(after);
    const receipt = join(installed, "INSTALLED");
    writeFileSync(receipt, '{"commit":"oldcommit"}');
    expect((await install()).status).toBe(0);
    expect(files()).toEqual(after);
    const named = /"commit":\s*"([^"]*)"/u.exec(readFileSync(receipt, "utf8"))?.[1] ?? "";
    expect(named.startsWith(gitMaybe(ROUTER, "rev-parse", "HEAD") ?? "no head")).toBe(true);
  });
});

describe.concurrent("which host runs a task", () => {
  it("takes a host by its name or ssh destination, and refuses a place in the list or a host not listed, naming the hosts there are; a host that sets no checks takes them too", async () => {
    await Promise.all([
      ...["zbook", "fake-linux"].map(async (choice) => {
        const sb = makeCase();
        expect((await sb.run(["test"], { ANA_CHECK_HOST: choice })).status).toBe(0);
        expect(["fake-mac", "fake-linux"].filter(sb.ran), choice).toEqual(["fake-linux"]);
      }),
      ...["1", "any", "peer", "elsewhere"].map(async (choice) => {
        const sb = makeCase();
        const refused = await sb.run(["test"], { ANA_CHECK_HOST: choice });
        expect(refused.status, choice).toBe(2);
        expect(refused.stderr, choice).toContain(`ANA_CHECK_HOST=${choice} names no host`);
        expect(refused.stderr, choice).toContain("here, auto, all or one of: m1, zbook");
        expect(sb.connections()).toEqual([]);
        expect(calls(sb.home)).toEqual([]);
      }),
      (async () => {
        const sb = makeCase();
        expect(
          (await sb.run(["test"], { ANA_CHECK_HOST: "peer", ANA_HOSTS: JSON.stringify([PEER]) })).status,
        ).toBe(0);
        expect(sb.ran("fake-peer")).toBe(true);
      })(),
    ]);
  });

  it("leaves benchmark hosts out of auto unconditionally while still guarding explicit naming and landing overrides", async () => {
    const EVAL_RUNNER = JSON.stringify([
      { name: "bench", host: "zbook", store: "store", sitting: "sitting.sh", packs: ["pack"] },
    ]);
    const says = (sb: ReturnType<typeof makeCase>, first: string) =>
      script(
        join(sb.hostHome("fake-linux"), "sitting.sh"),
        `#!/bin/sh\necho '${first}'\necho 'the last rows'\n`,
      );

    await Promise.all([
      (async () => {
        const sb = makeCase();
        says(sb, "idle");
        sb.loaded("fake-linux", 4, 0);
        sb.loaded("fake-mac", 2, 400);
        const spread = await sb.run(["test"], { ANA_CHECK_HOST: "auto", EVAL_RUNNER });
        expect(spread.status, spread.stderr).toBe(0);
        expect(spread.stderr).not.toMatch(/1m load a core[^\n]*zbook/u);
        expect(sb.connections().filter((each) => each.host === "fake-linux")).toEqual([]);
        expect(calls(sb.hostHome("fake-linux"))).toEqual([]);
      })(),
      (async () => {
        const sb = makeCase();
        says(sb, "an arm holds the lock: pid 1");
        const named = await sb.run(["test"], { ANA_CHECK_HOST: "zbook", EVAL_RUNNER });
        expect(named.status, named.stderr).toBe(0);
        expect(named.stderr).toContain(
          "runner: a benchmark's arm holds zbook: running there because ANA_CHECK_HOST named it",
        );
        expect(sb.ran("fake-linux")).toBe(true);
      })(),
      (async () => {
        const sb = makeCase();
        const missingNamed = await sb.run(["test"], { ANA_CHECK_HOST: "zbook", EVAL_RUNNER });
        expect(missingNamed.status, missingNamed.stderr).toBe(0);
        expect(missingNamed.stderr).toContain("runner: a benchmark's arm holds zbook");
        expect(sb.ran("fake-linux")).toBe(true);
      })(),
      (async () => {
        const sb = makeCase();
        says(sb, "idle");
        const idle = await sb.run(["test"], { ANA_CHECK_HOST: "zbook", EVAL_RUNNER });
        expect(idle.status, idle.stderr).toBe(0);
        expect(idle.stderr).not.toContain("arm holds");
        expect(sb.ran("fake-linux")).toBe(true);
      })(),
      (async () => {
        const sb = makeCase();
        says(sb, "an arm holds the lock: pid 1");
        const spared = await sb.run(["test"], {
          ANA_CHECK_HOST: "zbook",
          ANA_RUNNER_SPARE_HELD: "1",
          EVAL_RUNNER,
        });
        expect(spared.status, spared.stderr).toBe(69);
        expect(spared.stderr).toContain("runner: a benchmark's arm holds zbook: no check goes there now");
        expect(calls(sb.hostHome("fake-linux"))).toEqual([]);
      })(),
      (async () => {
        const sb = makeCase();
        script(join(sb.hostHome("fake-linux"), "sitting.sh"), "#!/bin/sh\nsleep 30\necho idle\n");
        const started = performance.now();
        const hung = await sb.run(
          ["test"],
          {
            ANA_CHECK_HOST: "zbook",
            ANA_RUNNER_SPARE_HELD: "1",
            ANA_RUNNER_PICK_WAIT: "1",
            EVAL_RUNNER,
          },
          sb.source,
          { direct: true },
        );
        expect(hung.status, hung.stderr).toBe(69);
        expect(performance.now() - started).toBeLessThan(8000);
        expect(hung.stderr).toContain("runner: a benchmark's arm holds zbook");
        expect(calls(sb.hostHome("fake-linux"))).toEqual([]);
      })(),
      (async () => {
        const sb = makeCase();
        expect((await sb.run(["test"], { ANA_CHECK_HOST: "zbook", EVAL_RUNNER: "not a list" })).status).toBe(
          2,
        );
      })(),
    ]);
  });

  it("fails over under auto on pre-task refusal, a mid-task drop and a host that starts no new program, releasing the slot, and trims whitespace on ANA_CHECK_HOST", async () => {
    await Promise.all([
      (async () => {
        const sb = makeCase();
        sb.spreadLoads();
        writeFileSync(join(sb.hostHome("fake-mac"), "garbled"), "");
        const failedOver = await sb.run(["test"], { ANA_CHECK_HOST: "auto" });
        expect(failedOver.status, failedOver.stderr).toBe(0);
        expect(failedOver.stderr).toContain("trying another place");
        expect(calls(sb.hostHome("fake-mac"))).toEqual([]);
        expect(heldIn(sb.queueOf("fake-mac"))).toEqual([]);
        expect(sb.ran("fake-linux") || calls(sb.home).length > 0).toBe(true);
      })(),
      (async () => {
        const sb = makeCase();
        sb.spreadLoads();
        writeFileSync(join(sb.hostHome("fake-mac"), "drops"), "");
        const midDrop = await sb.run(["test"], { ANA_CHECK_HOST: "auto" });
        expect(midDrop.status, midDrop.stderr).toBe(0);
        expect(midDrop.stderr).toContain("no verdict from m1; trying another place");
        expect(heldIn(sb.queueOf("fake-mac"))).toEqual([]);
        expect(sb.ran("fake-linux") || calls(sb.home).length > 0).toBe(true);
      })(),
      (async () => {
        const sb = makeCase();
        sb.spreadLoads();
        writeFileSync(join(sb.hostHome("fake-mac"), "nostart"), "");
        const stalled = await sb.run(["test"], { ANA_CHECK_HOST: "auto" });
        expect(stalled.status, stalled.stderr).toBe(0);
        expect(stalled.stderr).toContain("no verdict from m1; trying another place");
        expect(calls(sb.hostHome("fake-mac"))).toEqual([]);
        expect(sb.ran("fake-linux") || calls(sb.home).length > 0).toBe(true);
      })(),
      (async () => {
        const sb = makeCase();
        sb.spreadLoads();
        writeFileSync(join(sb.hostHome("fake-mac"), "garbled"), "");
        writeFileSync(join(sb.hostHome("fake-linux"), "garbled"), "");
        const toLocal = await sb.run(["test"], { ANA_CHECK_HOST: "  auto  " });
        expect(toLocal.status, toLocal.stderr).toBe(0);
        expect(calls(sb.home).some((call) => call.args?.startsWith("run test") === true)).toBe(true);
      })(),
      (async () => {
        const sb = makeCase();
        expect((await sb.run(["test"], { ANA_CHECK_HOST: "  here  " })).status).toBe(0);
        expect(sb.connections()).toEqual([]);
      })(),
    ]);
  });

  it("splits the test task under all over the places under half load, each file once, runs one with a name pattern whole, takes a named folder as its test files and refuses one with none, puts the chunk of a place that drops or cannot start a new program elsewhere, and passes over a place whose slots others hold", async () => {
    const FILES = ["a", "b", "c", "d", "e"].map((name) => `test/${name}.test.ts`);
    const ranAt = (at: string): string[] =>
      calls(at).flatMap((call) =>
        call.args?.startsWith("run test") === true
          ? call.args.split(" ").filter((arg) => arg.endsWith(".test.ts"))
          : [],
      );
    const everywhere = (sb: ReturnType<typeof makeCase>): string[] =>
      [sb.home, sb.hostHome("fake-mac"), sb.hostHome("fake-linux")].flatMap(ranAt).toSorted();
    await Promise.all([
      (async () => {
        const sb = makeCase({ copySource: true });
        mkdirSync(join(sb.source, "test"), { recursive: true });
        for (const file of FILES) writeFileSync(join(sb.source, file), "");
        sb.loaded("fake-mac", 2, 0);
        sb.loaded("fake-linux", 4, 2.4);
        const result = await sb.run(["test"], { ANA_CHECK_HOST: "all" });
        expect(result.status, result.stderr).toBe(0);
        expect(everywhere(sb)).toEqual(FILES);
        expect(ranAt(sb.hostHome("fake-mac")).length).toBeGreaterThan(0);
        expect(ranAt(sb.hostHome("fake-linux"))).toEqual([]);
        const named = await sb.run(["test", "-t", "one"], { ANA_CHECK_HOST: "all" });
        expect(named.status, named.stderr).toBe(0);
        const homes = [sb.home, sb.hostHome("fake-mac"), sb.hostHome("fake-linux")];
        expect(
          homes.flatMap((home) => calls(home)).filter((call) => call.args === "run test -t one"),
        ).toHaveLength(1);
      })(),
      ...["drops", "nostart"].map(async (fault) => {
        const sb = makeCase({ copySource: true });
        mkdirSync(join(sb.source, "test"), { recursive: true });
        for (const file of FILES) writeFileSync(join(sb.source, file), "");
        sb.loaded("fake-mac", 2, 0);
        sb.loaded("fake-linux", 4, 0);
        writeFileSync(join(sb.source, "test/fails.test.ts"), "");
        writeFileSync(join(sb.hostHome("fake-mac"), fault), "");
        const named = [...FILES.slice(0, 3), "test/fails.test.ts"];
        const result = await sb.run(["test", ...named], { ANA_CHECK_HOST: "all" });
        expect(result.status, result.stderr).toBe(3);
        expect(result.stderr).toContain("all: no verdict from m1");
        expect(everywhere(sb)).toEqual(named.toSorted());
        expect(ranAt(sb.hostHome("fake-mac"))).toEqual([]);
        expect(heldIn(sb.queueOf("fake-mac"))).toEqual([]);
      }),
      (async () => {
        const sb = makeCase({ copySource: true });
        mkdirSync(join(sb.source, "test"), { recursive: true });
        for (const file of FILES) writeFileSync(join(sb.source, file), "");
        sb.loaded("fake-mac", 2, 0);
        sb.loaded("fake-linux", 4, 0);
        const queue = sb.queueOf("fake-mac");
        mkdirSync(queue, { recursive: true });
        for (const slot of ["slot-1", "slot-2"]) symlinkSync(String(runtimeProcess.pid), join(queue, slot));
        const result = await sb.run(["test"], { ANA_CHECK_HOST: "all", ANA_RUNNER_QUEUE_WAIT: "30" });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).not.toContain("no verdict");
        expect(everywhere(sb)).toEqual(FILES);
        expect(ranAt(sb.hostHome("fake-mac"))).toEqual([]);
      })(),
      (async () => {
        const sb = makeCase({ copySource: true });
        const ui = ["packages/ui/test/a.test.ts", "packages/ui/test/deep/b.test.ts"];
        for (const file of [...FILES, ...ui]) {
          mkdirSync(dirname(join(sb.source, file)), { recursive: true });
          writeFileSync(join(sb.source, file), "");
        }
        sb.loaded("fake-mac", 2, 0);
        sb.loaded("fake-linux", 4, 0);
        const result = await sb.run(["test", "packages/ui/test"], { ANA_CHECK_HOST: "all" });
        expect(result.status, result.stderr).toBe(0);
        expect(everywhere(sb)).toEqual(ui);
        mkdirSync(join(sb.source, "packages/empty"));
        const empty = await sb.run(["test", "packages/empty"], { ANA_CHECK_HOST: "all" });
        expect(empty.status).toBe(2);
        expect(empty.stderr).toContain("all: no test files in packages/empty");
      })(),
    ]);
  });

  it("learns each place's running mean of each test file's time from what its runs measured, cuts chunks by that time, weighs a new file at the median and forgets a removed one", async () => {
    const sizes = { a: 40, b: 30, c: 20, d: 10, e: 5 };
    type Name = keyof typeof sizes;
    const FIRST: readonly Name[] = ["a", "b", "c", "d"];
    const fileOf = (name: string): string => `test/${name}.test.ts`;
    const learned = (sb: ReturnType<typeof makeCase>) =>
      parseJsonAs<Record<string, Record<string, number>>>(
        readFileSync(join(sb.source, ".git", "ana-test-times.json"), "utf8"),
      );
    const write = (sb: ReturnType<typeof makeCase>, names: readonly Name[]): void => {
      mkdirSync(join(sb.source, "test"), { recursive: true });
      for (const name of names) writeFileSync(join(sb.source, fileOf(name)), "x".repeat(sizes[name]));
    };
    const meansOf = (entries: [string, number][]) =>
      Object.fromEntries(entries.map(([name, ms]) => [fileOf(name), ms]));
    await Promise.all([
      (async () => {
        const sb = makeCase({ copySource: true });
        write(sb, FIRST);
        const here = { ANA_CHECK_HOST: "all", ANA_HOSTS: "" };
        const first = await sb.run(["test"], here);
        expect(first.status, first.stderr).toBe(0);
        expect(first.stderr).toContain("4 test files in 2 chunks");
        expect(learned(sb)).toEqual({
          [MACHINE]: meansOf([
            ["a", 40_000],
            ["b", 30_000],
            ["c", 20_000],
            ["d", 10_000],
          ]),
        });
        writeFileSync(join(sb.home, "speed"), "2");
        const second = await sb.run(["test"], here);
        expect(second.status, second.stderr).toBe(0);
        expect(second.stderr).toContain("4 test files in 1 chunks");
        expect(learned(sb)).toEqual({
          [MACHINE]: meansOf([
            ["a", 52_000],
            ["b", 39_000],
            ["c", 26_000],
            ["d", 13_000],
          ]),
        });
        rmSync(join(sb.source, fileOf("d")));
        write(sb, ["e"]);
        const third = await sb.run(["test"], here);
        expect(third.status, third.stderr).toBe(0);
        expect(third.stderr).toContain("4 test files in 2 chunks");
        const kept = {
          [MACHINE]: meansOf([
            ["a", 60_400],
            ["b", 45_300],
            ["c", 30_200],
            ["d", 13_000],
            ["e", 10_000],
          ]),
        };
        expect(learned(sb)).toEqual(kept);
        writeFileSync(join(sb.home, "notimes"), "");
        const unwritten = await sb.run(["test"], here);
        expect(unwritten.status, unwritten.stderr).toBe(0);
        expect(learned(sb)).toEqual(kept);
      })(),
      (async () => {
        const sb = makeCase({ copySource: true });
        write(sb, FIRST);
        sb.loaded("fake-mac", 2, 0);
        sb.loaded("fake-linux", 4, 2.4);
        const homes = [sb.home, sb.hostHome("fake-mac")];
        const each = (file: string, text: string): void => {
          for (const home of homes) writeFileSync(join(home, file), text);
        };
        each("speed", "10");
        const result = await sb.run(["test"], { ANA_CHECK_HOST: "all" });
        expect(result.status, result.stderr).toBe(0);
        const first = learned(sb);
        expect(Object.keys(first).every((place) => ["m1", MACHINE].includes(place))).toBe(true);
        expect(first.m1 === undefined).toBe(!sb.ran("fake-mac"));
        expect(Object.assign({}, ...Object.values(first))).toEqual(
          meansOf(FIRST.map((name) => [name, sizes[name] * 10_000])),
        );
        each("speed", "20");
        const second = await sb.run(["test"], { ANA_CHECK_HOST: "all" });
        expect(second.status, second.stderr).toBe(0);
        const means = learned(sb);
        each("notimes", "");
        const unwritten = await sb.run(["test"], { ANA_CHECK_HOST: "all" });
        expect(unwritten.status, unwritten.stderr).toBe(0);
        expect(learned(sb)).toEqual(means);
      })(),
    ]);
  });

  it("forwards check environment overrides across ssh to the remote host", async () => {
    const sb = makeCase();
    const result = await sb.run(["test"], {
      ANA_CHECK_HOST: "m1",
      ANA_CLIMB: "1",
      ANA_LINT_PATHS: "src/a.ts",
      ANA_TEST_HOST_LOAD: "2",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(lastCall(sb.hostHome("fake-mac"))).toMatchObject({
      climb: "1",
      paths: "src/a.ts",
      hostLoad: "2",
    });
  });

  it("leads a gate under all here, outside any slot and unmarked, so its own steps are routed in turn", async () => {
    const sb = makeCase();
    const result = await sb.run(["run", "gate"], { ANA_CHECK_HOST: "all" });
    expect(result.status, result.stderr).toBe(0);
    expect(lastCall(sb.home)).toMatchObject({ active: "", args: "run gate" });
    expect(sb.connections()).toEqual([]);
    expect(heldIn(sb.queueOf("local"))).toEqual([]);
  });

  it("starts a task here without the host list the router read for it, and with one its caller set", async () => {
    await Promise.all(
      [true, false].map(async (read) => {
        const sb = makeCase();
        const file = join(sb.home, ".env.runs");
        writeFileSync(file, `ANA_HOSTS=${HOSTS}\nANA_LOGINS=1\n`);
        const result = await sb.run(["test"], {
          ANA_CHECK_HOST: "here",
          ANA_RUNNER_HOST_FILE: read ? file : undefined,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(lastCall(sb.home)?.hosts).toBe(read ? "" : HOSTS);
      }),
    );
  });

  it("refuses a setting that is no count, and a tree that pins no Bun, before any host is asked", async () => {
    await Promise.all([
      (async () => {
        const sb = makeCase();
        expect((await sb.run(["test"], { ANA_RUNNER_WALL: "soon" })).status).toBe(2);
        expect(sb.connections()).toEqual([]);
      })(),
      (async () => {
        const sb = makeCase();
        expect((await sb.run(["test"], { ANA_CHECK_HOST: "m1" }, plain)).status).toBe(2);
        expect(sb.connections()).toEqual([]);
      })(),
    ]);
  });
});

describe.concurrent("what reaches the host", () => {
  it("sends the working tree as it stands on HEAD's own parent, without env files or what git ignores, keeps the caches, and leaves the checkout's index alone", async () => {
    const sb = makeCase({ copySource: true });
    const target = sb.slot("fake-mac", 1);
    const head = git(sb.source, "rev-parse", "HEAD").trim();
    writeFileSync(join(sb.source, "edited"), "unstaged");
    unlinkSync(join(sb.source, "deleted"));
    writeFileSync(join(sb.source, "new file"), "new");
    writeFileSync(join(sb.source, "staged"), "staged");
    git(sb.source, "add", "staged");
    const hidden = [".env", ".env.local", "nested/.env", "ignored/private"];
    for (const name of [...hidden, "node_modules/local", "runs/state", "nested/tools/runs/state"]) {
      mkdirSync(join(sb.source, name, ".."), { recursive: true });
      writeFileSync(join(sb.source, name), "private");
    }
    const caches = ["node_modules/cache", "packages/ui/node_modules/cache", "test/.test-timings.json"];
    for (const name of ["stale", ".env", "ignored/old", ...caches]) {
      mkdirSync(join(target, name, ".."), { recursive: true });
      writeFileSync(join(target, name), "old");
    }
    mkdirSync(join(target, ".scratch/old/workspace"), { recursive: true });
    symlinkSync(join(target, "node_modules"), join(target, ".scratch/old/workspace/node_modules"));
    const status = git(sb.source, "status", "--porcelain");

    const sent = await sb.run(["test", "test/example.test.ts"], { ANA_CHECK_HOST: "m1" });
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
    expect(git(target, "rev-parse", "HEAD^").trim()).toBe(git(sb.source, "rev-parse", "HEAD^").trim());
    expect(git(sb.source, "rev-parse", "HEAD").trim()).toBe(head);
    expect(git(sb.source, "status", "--porcelain")).toBe(status);
    expect(lastCall(sb.hostHome("fake-mac"))).toMatchObject({
      args: "run test test/example.test.ts",
      active: "1",
    });

    unlinkSync(join(sb.source, "new file"));
    rmSync(join(target, ".git"), { recursive: true });
    writeFileSync(join(target, ".git"), "gitdir: /nowhere\n");
    expect((await sb.run(["test"], { ANA_CHECK_HOST: "m1" })).status).toBe(0);
    expect(existsSync(join(target, "new file"))).toBe(false);

    for (const name of [...hidden, "node_modules/local", "runs/state", "nested/tools/runs/state"]) {
      rmSync(join(sb.source, name), { force: true });
    }
    git(sb.source, "add", "-A");
    commit(sb.source, "third");
    expect((await sb.run(["test"], { ANA_CHECK_HOST: "m1" })).status).toBe(0);
    expect(git(target, "rev-parse", "HEAD")).toBe(git(sb.source, "rev-parse", "HEAD"));

    sb.fresh();
    const reused = await sb.run(
      ["test", join(sb.source, "test/example.test.ts"), `${sb.source}/`, "/tmp/outside.test.ts"],
      { ANA_CHECK_HOST: "m1" },
    );
    expect(reused.status, reused.stderr).toBe(0);
    expect(reused.stderr).toContain("runner: reused ");
    expect(sb.connections()).toHaveLength(3);
    expect(lastCall(sb.hostHome("fake-mac"))).toMatchObject({
      args: "run test test/example.test.ts . /tmp/outside.test.ts",
    });
    sb.fresh();
    writeFileSync(join(sb.source, "edited"), "changed-again");
    const resent = await sb.run(["test"], { ANA_CHECK_HOST: "m1" });
    expect(resent.status, resent.stderr).toBe(0);
    expect(resent.stderr).toContain("runner: sent ");
    expect(sb.connections()).toHaveLength(4);
    expect(readFileSync(join(target, "edited"), "utf8")).toBe("changed-again");
  });

  it("returns the task's exit status where the server reports 0 for every session, and no verdict where the session drops or the host starts no new program before the task or after it failed", async () => {
    const cases: [string | null, string[], number][] = [
      [null, ["exit:3"], 3],
      ["zero", ["exit:3"], 3],
      ["drops", ["exit:3"], 255],
      ["nostart", ["exit:0"], 69],
      [null, ["nostart", "exit:3"], 69],
      [null, ["nostart", "exit:0"], 0],
    ];
    await Promise.all(
      cases.map(async ([state, args, status]) => {
        const sb = makeCase();
        if (state !== null) writeFileSync(join(sb.hostHome("fake-mac"), state), "");
        const result = await sb.run(["test", ...args], { ANA_CHECK_HOST: "m1" });
        expect(result.status, `${state ?? "plain"} ${args.join(" ")}`).toBe(status);
        expect(calls(sb.hostHome("fake-mac")).length, `${state ?? "plain"} ${args.join(" ")}`).toBe(
          state === "nostart" || state === "drops" ? 0 : 1,
        );
      }),
    );
  });
});

describe.concurrent("the connections to a host", () => {
  it("carries the tree over the shared master where the temp root holds a space", async () => {
    const sb = makeCase({ copySource: true });
    const spaced = mkdtempSync("/tmp/ana r-");
    writeFileSync(join(sb.source, "spaced"), "carried");
    try {
      expect(
        (await sb.run(["test"], { ANA_CHECK_HOST: "m1", TMPDIR: spaced, ANA_TEST_TMPDIR: spaced })).status,
      ).toBe(0);
      expect(readFileSync(sb.log, "utf8")).toContain(`ControlPath=${spaced}/`);
      expect(readFileSync(join(sb.slot("fake-mac", 1), "spaced"), "utf8")).toBe("carried");
    } finally {
      rmSync(spaced, { recursive: true, force: true });
    }
  });

  it("retries a dropped connection before the task, and starts nothing on a host that does not answer, reads no free space, or lacks room", async () => {
    const refusals: [string | null, Record<string, string>, number][] = [
      ["down", {}, 3],
      ["garbled", {}, 1],
      [null, { ANA_RUNNER_MIN_FREE_GB: "1000000" }, 1],
    ];
    await Promise.all([
      (async () => {
        const sb = makeCase({ copySource: true });
        writeFileSync(join(sb.source, "retried"), "after a dropped push");
        writeFileSync(join(sb.hostHome("fake-mac"), "flaky"), "2\n");
        expect((await sb.run(["test"], { ANA_CHECK_HOST: "m1" })).status).toBe(0);
        expect(sb.connections().filter((each) => each.how === "dropped")).toHaveLength(1);
        expect(readFileSync(join(sb.slot("fake-mac", 1), "retried"), "utf8")).toBe("after a dropped push");
      })(),
      ...refusals.map(async ([state, extra, tries]) => {
        const sb = makeCase();
        const edited = join(sb.slot("fake-mac", 1), "edited");
        mkdirSync(join(edited, ".."), { recursive: true });
        writeFileSync(edited, "untouched");
        if (state !== null) writeFileSync(join(sb.hostHome("fake-mac"), state), "");
        const refused = await sb.run(["test"], { ANA_CHECK_HOST: "m1", ...extra });
        expect(refused.status, state ?? "room").toBe(69);
        expect(sb.connections(), state ?? "room").toHaveLength(tries);
        expect(readFileSync(edited, "utf8")).toBe("untouched");
        expect(calls(sb.hostHome("fake-mac"))).toEqual([]);
      }),
    ]);
  });
});

function slotHarness(sb: ReturnType<typeof makeCase>) {
  const jobs: [Bun.Subprocess, string][] = [];
  const spawned = (name: string, extra: Record<string, string>) => {
    const job = join(sb.dir, name);
    const child = capturedSpawn([sb.shim, "test", `hold:${job}`], {
      cwd: sb.source,
      env: { ...sb.env, ...extra },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    jobs.push([child, job]);
    return [child, job] as const;
  };
  const started = async (name: string, extra: Record<string, string>) => {
    const [child, job] = spawned(name, extra);
    await waitFor(() => existsSync(`${job}.ready`) || child.exitCode !== null);
    expect(child.exitCode).toBeNull();
    return [child, job] as const;
  };
  const finish = async ([child, job]: readonly [Bun.Subprocess, string]) => {
    writeFileSync(`${job}.release`, "");
    expect(await child.exited).toBe(0);
  };
  const released = async () => {
    for (const [child, job] of jobs) {
      writeFileSync(`${job}.release`, "");
      await child.exited;
    }
  };
  return { spawned, started, finish, released };
}

describe.concurrent("the slots", () => {
  it("spreads ANA_CHECK_HOST=auto bursts across idle hosts via active slot occupancy before filling second slots", async () => {
    const sb = makeCase();
    const queue = sb.queueOf("fake-mac");
    const slots = slotHarness(sb);
    sb.loaded("fake-mac", 2, 0);
    sb.loaded("fake-linux", 4, 0);
    try {
      await slots.started("auto-1", { ANA_CHECK_HOST: "auto" });
      await slots.started("auto-2", { ANA_CHECK_HOST: "auto" });
      expect(heldIn(queue).length).toBeLessThanOrEqual(1);
      await slots.started("auto-3", { ANA_CHECK_HOST: "auto" });
      expect(heldIn(sb.queueOf("fake-linux")).length).toBe(1);
      await slots.started("auto-4", { ANA_CHECK_HOST: "auto" });
      expect(heldIn(queue).length).toBe(2);
      expect(heldIn(sb.queueOf("local")).length).toBe(1);
      expect(heldIn(sb.queueOf("fake-linux")).length).toBe(1);
      expect((await sb.run(["test"], { ANA_CHECK_HOST: "auto", ANA_RUNNER_QUEUE_WAIT: "0" })).status).toBe(
        75,
      );
    } finally {
      await slots.released();
    }
  });

  it("gives each task of a host its own slot up to the host's count, another host unhindered, and a dead or older runner's slot to the next task", async () => {
    const sb = makeCase({ copySource: true });
    const queue = sb.queueOf("fake-mac");
    const slots = slotHarness(sb);
    try {
      const first = await slots.started("first", { ANA_CHECK_HOST: "m1" });
      writeFileSync(join(sb.source, "edited"), "second snapshot");
      const second = await slots.started("second", { ANA_CHECK_HOST: "m1" });
      expect(readFileSync(join(sb.slot("fake-mac", 1), "edited"), "utf8")).not.toBe("second snapshot");
      expect(readFileSync(join(sb.slot("fake-mac", 2), "edited"), "utf8")).toBe("second snapshot");
      const other = await slots.started("other", { ANA_CHECK_HOST: "zbook" });
      expect((await sb.run(["test"], { ANA_CHECK_HOST: "zbook", ANA_RUNNER_QUEUE_WAIT: "0" })).status).toBe(
        75,
      );
      expect((await sb.run(["test"], { ANA_CHECK_HOST: "m1", ANA_RUNNER_QUEUE_WAIT: "0" })).status).toBe(75);
      expect(calls(sb.home)).toEqual([]);
      await slots.finish(first);
      expect((await sb.run(["test"], { ANA_CHECK_HOST: "m1", ANA_RUNNER_QUEUE_WAIT: "5" })).status).toBe(0);
      await slots.finish(other);
      await slots.finish(second);
      expect(heldIn(queue)).toEqual([]);
      mkdirSync(join(queue, "slot-1", "99999999"), { recursive: true });
      rmSync(join(queue, "slot-2"), { recursive: true, force: true });
      symlinkSync("99999999", join(queue, "slot-2"));
      const third = await slots.started("third", { ANA_CHECK_HOST: "m1" });
      const fourth = await slots.started("fourth", { ANA_CHECK_HOST: "m1" });
      expect(heldIn(queue).length).toBe(2);
      await slots.finish(third);
      await slots.finish(fourth);
      rmSync(join(queue, "slot-1"), { recursive: true, force: true });
      symlinkSync(String(runtimeProcess.pid), join(queue, "slot-1"));
      rmSync(join(queue, "slot-2"), { recursive: true, force: true });
      symlinkSync(String(runtimeProcess.pid), join(queue, "slot-2"));
      expect((await sb.run(["test"], { ANA_CHECK_HOST: "m1", ANA_RUNNER_QUEUE_WAIT: "0" })).status).toBe(75);
      rmSync(join(queue, "slot-1"), { recursive: true, force: true });
      rmSync(join(queue, "slot-2"), { recursive: true, force: true });
      writeFileSync(join(queue, "slot-1"), "stray");
      writeFileSync(join(queue, "slot-2"), "stray");
      expect((await sb.run(["test"], { ANA_CHECK_HOST: "m1", ANA_RUNNER_QUEUE_WAIT: "0" })).status).toBe(0);
    } finally {
      await slots.released();
    }
  });

  it("gives a free slot to one of the tasks that reach it together, and the host no more tasks than its slots", async () => {
    const sb = makeCase();
    const queue = sb.queueOf("fake-mac");
    const slots = slotHarness(sb);
    const together = Array.from({ length: 6 }, (_, at) =>
      slots.spawned(`together-${String(at)}`, { ANA_CHECK_HOST: "m1", ANA_RUNNER_QUEUE_WAIT: "0" }),
    );
    try {
      await waitFor(() =>
        together.every(([child, job]) => child.exitCode !== null || existsSync(`${job}.ready`)),
      );
      expect(together.filter(([child]) => child.exitCode === null).length).toBe(2);
      expect(together.filter(([child]) => child.exitCode === 75).length).toBe(4);
      expect(heldIn(queue).length).toBe(2);
    } finally {
      await slots.released();
    }
  });
});

describe("this machine", () => {
  it("runs ANA_CHECK_HOST=here on the pinned Bun, reaps an orphaned test worker and spares an orphan that names the checkout", async () => {
    const sb = makeCase({ copySource: true });
    const token = sb.source;
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
    const worker = orphan(`stand-in-test-worker ${token}`);
    const filtered = join(sb.dir, "filtered-ps");
    script(
      join(filtered, "ps"),
      `#!/bin/sh
case "$*" in
  *command=*) ${realPs} "$@" | awk -v t='${token}' '{ sub(/stand-in-test-worker/, "bun test --test-worker") } index($0, t) || $1 == 1' ;;
  *) exec ${realPs} "$@" ;;
esac
`,
    );
    const parentOf = (pid: number): string =>
      spawnTextSync(realPs, ["-o", "ppid=", "-p", String(pid)]).stdout.trim();
    try {
      await waitFor(() => parentOf(worker) === "1", 5);
      expect(spawnTextSync(realPs, ["-o", "command=", "-p", String(worker)]).stdout).not.toContain(
        "bun test --test-worker",
      );
      const local = await sb.run(["test"], {
        ANA_CHECK_HOST: "here",
        PATH: `${filtered}:${sb.env.PATH ?? ""}`,
      });
      expect(lastCall(sb.home)).toMatchObject({ bun: sb.pinned, active: "1" });
      expect(sb.connections()).toEqual([]);
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

  it("ends a task at its deadline and returns at once from one that ends before it", async () => {
    const sb = makeCase();
    const hung = join(sb.dir, "hung");
    const started = performance.now();
    expect(
      (
        await sb.run(["test", `hold:${hung}`], { ANA_CHECK_HOST: "here", ANA_RUNNER_WALL: "1" }, sb.source, {
          direct: true,
        })
      ).status,
    ).not.toBe(0);
    expect(performance.now() - started).toBeLessThan(4000);
    const quick = performance.now();
    expect(
      (
        await sb.run(["test", "exit:4"], { ANA_CHECK_HOST: "here", ANA_RUNNER_WALL: "30" }, sb.source, {
          direct: true,
        })
      ).status,
    ).toBe(4);
    expect(performance.now() - quick).toBeLessThan(3000);
    expect(heldIn(sb.queueOf("local"))).toEqual([]);
  });
});
