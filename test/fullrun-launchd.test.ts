import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
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
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { runtimeProcess } from "../src/meta/process.ts";

interface LauncherOptions {
  /** The worktree's `.bun-version`; `null` writes none. */
  pin?: string | null | undefined;
  /** Shell actions for each fake launchctl verb; an unlisted verb exits 2. */
  launchctl?: Record<string, string>;
  plutil?: string[];
  bun?: string[];
}

// The launcher checks the selected runtime and writes the launchd configuration. These cases
// exercise refusals before launch and use a fake launchctl for publication, startup and cleanup
// checks. The fake records calls in temporary files without registering a real service.

const script = join(import.meta.dirname, "..", "tools", "fullrun-launchd.zsh");
const dirs: string[] = [];
const macIt = it.if(runtimeProcess.platform === "darwin");
const BIN_SH = "#!/bin/sh";
const STATE = '"$ANA_FAKE_LAUNCHCTL_STATE"';
/** `print` answers running while the fake service exists. */
const PRINT_LIVE = String.raw`if [ -f ${STATE} ]; then printf "state = running\npid = 4242\n"; exit 0; fi; exit 1`;
const START = `: > ${STATE}; exit 0`;
const STOP = `/bin/rm -f ${STATE}; exit 0`;

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-launchd-"));
  dirs.push(dir);
  return dir;
}

function executable(path: string, lines: string[]): void {
  writeFileSync(path, [...lines, ""].join("\n"));
  chmodSync(path, 0o755);
}

function launcherEnv(environment: Record<string, string>) {
  const path = [environment.PATH, dirname(Bun.argv[0]!), Bun.env.PATH].filter(Boolean).join(":");
  return { ...Bun.env, ...environment, PATH: path };
}

function run(args: string[], environment: Record<string, string> = {}) {
  const result = spawnSync(script, args, { env: launcherEnv(environment) });
  return { status: result.status, output: `${result.stderr}${result.stdout}` };
}

function frozenEnvironment() {
  const path = [dirname(Bun.argv[0]!), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  const [home, codexHome, tmp] = [temp(), temp(), temp()];
  const map = [`HOME=${home}`, `CODEX_HOME=${codexHome}`, `TMPDIR=${tmp}`, `PATH=${path}`];
  return { args: map.flatMap((entry) => ["--env", entry]), home, codexHome, tmp, path };
}

/** A worktree pinned to the running Bun, a frozen map, and fake launchd tools first on PATH. */
function launcher(options: LauncherOptions = {}) {
  const worktree = temp();
  const fakeBin = temp();
  const state = join(fakeBin, "launchctl.state");
  const pin = options.pin === undefined ? Bun.version : options.pin;
  if (pin !== null) writeFileSync(join(worktree, ".bun-version"), `${pin}\n`);
  const verbs = options.launchctl ?? { print: PRINT_LIVE, bootstrap: START };
  const body = Object.entries(verbs).map(([verb, action]) => `if [ "$1" = "${verb}" ]; then ${action}; fi`);
  executable(join(fakeBin, "launchctl"), [BIN_SH, ...body, "exit 2"]);
  if (options.plutil) executable(join(fakeBin, "plutil"), options.plutil);
  if (options.bun) executable(join(fakeBin, "bun"), options.bun);
  const frozen = frozenEnvironment();
  const launchd = join(worktree, ".launchd");
  const argv = (label: string, extra: readonly string[] = [], command = ["bun", "--version"]) => [
    "--worktree",
    worktree,
    "--log",
    join(worktree, "run.log"),
    "--label",
    label,
    ...frozen.args,
    ...extra,
    "--",
    ...command,
  ];
  const env = (environment: Record<string, string>) => ({
    PATH: fakeBin,
    ANA_FAKE_LAUNCHCTL_STATE: state,
    ...environment,
  });
  return {
    worktree,
    fakeBin,
    state,
    frozen,
    launchd,
    plist: (label: string) => join(launchd, `${label}.plist`),
    receipt: (label: string) => join(launchd, `${label}.plist.receipt.json`),
    run: (
      label: string,
      extra: readonly string[] = [],
      environment: Record<string, string> = {},
      command?: string[],
    ) => run(argv(label, extra, command), env(environment)),
    spawn: (label: string, environment: Record<string, string>) =>
      Bun.spawn({
        cmd: [script, ...argv(label)],
        env: launcherEnv(env(environment)),
        stdout: "pipe",
        stderr: "pipe",
      }),
  };
}

async function waitForFile(path: string, exited: Promise<number>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    const status = await Promise.race([exited, Bun.sleep(10).then(() => null)]);
    if (status !== null) throw new Error(`launcher exited with ${status} before ${path} appeared`);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function finish(child: ReturnType<ReturnType<typeof launcher>["spawn"]>) {
  const [status] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return status;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fullrun launchd launcher", () => {
  it("runs with NO_RCS so login files cannot reselect the Bun executable the worktree pinned", () => {
    // Without -f, ~/.zshenv can reorder PATH onto a same-version but different runtime
    // executable, which fails the run's host check.
    expect(readFileSync(script, "utf8").split("\n")[0]).toBe("#!/bin/zsh -f");
  });

  macIt.each([
    [["--worktree", "/tmp/w", "--log", "/tmp/x.log"], "usage: fullrun-launchd.zsh"],
    [
      ["--worktree", "/tmp/w", "--log", "/tmp/x.log", "--label", "ana.test", "--"],
      "usage: fullrun-launchd.zsh",
    ],
    [["--nope", "value"], "unknown argument: --nope"],
    [["--worktree"], "--worktree: missing value"],
    [
      ["--worktree", "/a", "--worktree", "/b", "--log", "/x", "--label", "l", "--", "bun"],
      "--worktree: may be specified only once",
    ],
  ])("refuses the incomplete invocation %j with %s", (args, message) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.output).toContain(message);
  });

  const path = [dirname(Bun.argv[0]!), "/usr/bin", "/bin"].join(":");
  macIt.each([
    { refuses: "a worktree that does not pin a Bun version", pin: null, message: "has no .bun-version" },
    {
      refuses: "a running Bun other than the pinned one",
      pin: "99.99.99",
      message: "the worktree pins 99.99.99",
    },
    {
      refuses: "a launch map that omits the private Codex roots",
      map: () => ["--env", `HOME=${temp()}`, "--env", `PATH=${path}`],
      message: "HOME, CODEX_HOME, TMPDIR, and PATH",
    },
    {
      refuses: "a launch map with a relative TMPDIR",
      map: () =>
        [`HOME=${temp()}`, `CODEX_HOME=${temp()}`, "TMPDIR=relative-tmp", `PATH=${path}`].flatMap((e) => [
          "--env",
          e,
        ]),
      message: "frozen TMPDIR must be absolute",
    },
    {
      refuses: "a duplicate environment key",
      extra: ["--env", "HOME=/twice"],
      message: "duplicate environment key: HOME",
    },
    {
      refuses: "a label that could escape the launchd directory",
      label: "../outside",
      message: "invalid launchd label",
    },
    {
      refuses: "a worktree whose node_modules is a symlink, because a run owns its dependencies",
      prepare: (worktree: string) => symlinkSync(temp(), join(worktree, "node_modules")),
      message: "run must own its dependencies; run scripts/worktree.sh setup",
    },
  ])(
    "refuses $refuses before writing any plist",
    ({ pin, map, extra = [], label = "ana.test", prepare, message }) => {
      const fixture = launcher({ pin });
      prepare?.(fixture.worktree);
      const args = map
        ? [
            "--worktree",
            fixture.worktree,
            "--log",
            join(fixture.worktree, "run.log"),
            "--label",
            label,
            ...map(),
            "--",
            "bun",
            "--version",
          ]
        : undefined;
      const result = args ? run(args) : fixture.run(label, extra);
      expect(result.status).toBe(2);
      expect(result.output).toContain(message);
      expect(existsSync(fixture.launchd)).toBe(false);
    },
  );

  macIt("refuses a symlinked launchd directory before publishing into the foreign tree", () => {
    const fixture = launcher();
    const foreign = temp();
    symlinkSync(foreign, fixture.launchd);
    const result = fixture.run("ana.test.parent-symlink");
    expect(result.status).toBe(2);
    expect(result.output).toContain("launchd directory must not be a symlink");
    expect(readdirSync(foreign)).toEqual([]);
  });

  macIt("writes the frozen environment exactly once and resolves Bun through its PATH", () => {
    const fixture = launcher();
    const ambientHome = temp();
    const label = "ana.test.exact-environment";
    const result = fixture.run(label, ["--env", "ANA_VISIBLE=value"], { HOME: ambientHome });
    expect(result.status).toBe(0);
    const plist = readFileSync(fixture.plist(label), "utf8");
    expect(plist).toContain("<string>/usr/bin/env</string>\n    <string>-i</string>");
    const { home, codexHome, tmp, path: frozenPath } = fixture.frozen;
    for (const entry of [`HOME=${home}`, `CODEX_HOME=${codexHome}`, `TMPDIR=${tmp}`, `PATH=${frozenPath}`]) {
      expect(plist.match(new RegExp(`<string>${entry.split("=")[0]}=`, "g"))).toHaveLength(1);
      expect(plist).toContain(`<string>${entry}</string>`);
    }
    expect(plist).toContain("<string>ANA_VISIBLE=value</string>");
    expect(plist).not.toContain("<key>EnvironmentVariables</key>");
    expect(plist).not.toContain(ambientHome);
    const digest = new Bun.CryptoHasher("sha256").update(readFileSync(fixture.plist(label))).digest("hex");
    expect(JSON.parse(readFileSync(fixture.receipt(label), "utf8"))).toEqual({
      schema: "superloop-launchd-plist-receipt/v1",
      plist: realpathSync(fixture.plist(label)),
      sha256: digest,
    });
    expect(result.output).toContain(`published plist SHA-256: ${digest}`);
  });

  macIt(
    "refuses a same-UID replacement after publication and leaves the digest receipt for diagnosis",
    () => {
      const fixture = launcher({
        bun: [
          BIN_SH,
          'if [ "$2" = "$ANA_PUBLISH_HELPER" ] && [ "$3" != "--verify" ]; then',
          '  "$ANA_REAL_BUN" "$@"',
          "  status=$?",
          String.raw`  if [ "$status" -eq 0 ]; then printf "hostile replacement\n" > "$3"; fi`,
          '  exit "$status"',
          "fi",
          'exec "$ANA_REAL_BUN" "$@"',
        ],
      });
      // The fake bun must win inside the frozen map too, where the launcher resolves the helper's runtime.
      const pathIndex = fixture.frozen.args.indexOf(`PATH=${fixture.frozen.path}`);
      fixture.frozen.args[pathIndex] = `PATH=${fixture.fakeBin}:${fixture.frozen.path}`;
      const label = "ana.test.post-publication-replacement";
      const result = fixture.run(label, [], {
        ANA_REAL_BUN: realpathSync(Bun.argv[0]!),
        ANA_PUBLISH_HELPER: join(import.meta.dirname, "..", "tools", "fullrun-launchd-publish.ts"),
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("published plist changed before launchctl bootstrap");
      expect(existsSync(fixture.state)).toBe(false);
      expect(readFileSync(fixture.plist(label), "utf8")).toBe("hostile replacement\n");
      expect(existsSync(fixture.receipt(label))).toBe(true);
    },
  );

  macIt("boots out a service when its plist changes after successful bootstrap", () => {
    const fixture = launcher({
      launchctl: {
        print: PRINT_LIVE,
        bootstrap: String.raw`printf "hostile after bootstrap\n" > "$3"; ${START}`,
        bootout: STOP,
      },
    });
    const label = "ana.test.post-bootstrap-replacement";
    const result = fixture.run(label);
    expect(result.status).toBe(2);
    expect(result.output).toContain("published plist changed after bootstrap");
    expect(existsSync(fixture.state)).toBe(false);
    expect(readFileSync(fixture.plist(label), "utf8")).toBe("hostile after bootstrap\n");
    expect(existsSync(fixture.receipt(label))).toBe(true);
  });

  macIt("publishes only a complete linted plist and never overwrites a stale target", () => {
    const fixture = launcher({ plutil: [BIN_SH, "exit 1"] });
    const label = "ana.test.atomic-plist";
    const failed = fixture.run(label);
    expect(failed.status).not.toBe(0);
    expect(readdirSync(fixture.launchd)).toEqual([]);
    expect(existsSync(fixture.state)).toBe(false);

    writeFileSync(fixture.plist(label), "preserve-me\n");
    const stale = fixture.run(label);
    expect(stale.status).toBe(2);
    expect(stale.output).toContain("plist already exists");
    expect(readFileSync(fixture.plist(label), "utf8")).toBe("preserve-me\n");
    expect(existsSync(fixture.state)).toBe(false);
  });

  macIt.each([
    ["waiting", String.raw`printf "state = waiting\npid = 4242\n"`],
    ["missing-pid", String.raw`printf "state = running\n"`],
  ])("refuses a bootstrap whose print output (%s) does not prove a running service", (mode, answer) => {
    const fixture = launcher({
      launchctl: {
        print: `if [ -f ${STATE} ]; then ${answer}; exit 0; fi; exit 1`,
        bootstrap: START,
        bootout: STOP,
      },
    });
    const result = fixture.run(`ana.test.not-live-${mode}`, [], { ANA_LAUNCHD_LIVE_WAIT_ATTEMPTS: "20" });
    expect(result.status).toBe(2);
    expect(result.output).toContain("controller service is not live after bootstrap");
    expect(existsSync(fixture.state)).toBe(false);
  });

  macIt.each([
    {
      outcome: "removes its plist when bootstrap fails without a service",
      bootstrap: "exit 73",
      print: PRINT_LIVE,
      status: 73,
      kept: false,
      service: false,
    },
    {
      outcome: "does not claim a foreign service that appears after bootstrap fails",
      bootstrap: `: > ${STATE}; exit 73`,
      print: PRINT_LIVE,
      status: 73,
      kept: false,
      service: true,
    },
    {
      outcome: "keeps its plist once bootstrap owns the service even if print fails",
      bootstrap: START,
      print: `if [ -f ${STATE} ]; then exit 74; fi; exit 1`,
      status: 74,
      kept: true,
      service: true,
    },
  ])("$outcome", (row) => {
    const fixture = launcher({ launchctl: { print: row.print, bootstrap: row.bootstrap } });
    const label = "ana.test.bootstrap-outcome";
    const result = fixture.run(label);
    expect(result.status).toBe(row.status);
    expect(existsSync(fixture.plist(label))).toBe(row.kept);
    expect(existsSync(fixture.receipt(label))).toBe(row.kept);
    expect(existsSync(fixture.state)).toBe(row.service);
    if (!row.kept) expect(readdirSync(fixture.launchd)).toEqual([]);
  });

  macIt.each(["symlink", "directory"] as const)(
    "refuses a %s created at the destination while lint is running",
    async (targetKind) => {
      const fixture = launcher({
        plutil: [
          BIN_SH,
          ': > "$ANA_PLUTIL_ENTERED"',
          'while [ ! -f "$ANA_PLUTIL_RELEASE" ]; do /bin/sleep 0.01; done',
          "exit 0",
        ],
      });
      const entered = join(fixture.fakeBin, "plutil.entered");
      const release = join(fixture.fakeBin, "plutil.release");
      const label = `ana.test.concurrent-${targetKind}`;
      const child = fixture.spawn(label, { ANA_PLUTIL_ENTERED: entered, ANA_PLUTIL_RELEASE: release });
      await waitForFile(entered, child.exited);
      const redirect = temp();
      if (targetKind === "symlink") symlinkSync(redirect, fixture.plist(label));
      else mkdirSync(fixture.plist(label));
      writeFileSync(release, "release\n");
      expect(await finish(child)).not.toBe(0);
      expect(existsSync(fixture.state)).toBe(false);
      expect(readdirSync(redirect)).toEqual([]);
      if (targetKind === "directory") expect(readdirSync(fixture.plist(label))).toEqual([]);
    },
  );

  macIt("publishes the descriptor bytes even when the linter tries to swap its input path", () => {
    const fixture = launcher({
      plutil: [
        BIN_SH,
        '/bin/cp "$3" "$ANA_LINTED_PLIST"',
        '/bin/mv "$ANA_MALICIOUS_PLIST" "$3" 2>/dev/null || true',
        "exit 0",
      ],
      launchctl: { print: PRINT_LIVE, bootstrap: `/bin/cp "$3" "$ANA_LAUNCHED_PLIST"; ${START}` },
    });
    const [linted, launched, malicious] = ["linted", "launched", "malicious"].map((name) =>
      join(fixture.fakeBin, `${name}.plist`),
    );
    writeFileSync(malicious!, "malicious replacement\n");
    const label = "ana.test.staging-swap";
    const result = fixture.run(label, [], {
      ANA_LAUNCHED_PLIST: launched!,
      ANA_LINTED_PLIST: linted!,
      ANA_MALICIOUS_PLIST: malicious!,
    });
    expect(result.status).toBe(0);
    expect(readFileSync(launched!, "utf8")).toBe(readFileSync(linted!, "utf8"));
    expect(readFileSync(launched!, "utf8")).toContain(`<string>${label}</string>`);
    expect(existsSync(malicious!)).toBe(true);
  });

  macIt("terminates a delayed linter promptly on SIGTERM and leaves a foreign target alone", async () => {
    const fixture = launcher({
      plutil: [
        "#!/usr/bin/env bun",
        'import { writeFileSync } from "node:fs";',
        "writeFileSync(Bun.env.ANA_PLUTIL_PID!, `${process.pid}\\n`);",
        String.raw`writeFileSync(Bun.env.ANA_PLUTIL_ENTERED!, "entered\n");`,
        'process.on("SIGTERM", () => {',
        String.raw`  writeFileSync(Bun.env.ANA_PLUTIL_TERMINATED!, "terminated\n");`,
        "  process.exit(143);",
        "});",
        "await new Promise(() => setInterval(() => {}, 60_000));",
      ],
    });
    const [entered, lintPid, terminated] = ["entered", "pid", "terminated"].map((name) =>
      join(fixture.fakeBin, `plutil.${name}`),
    );
    const label = "ana.test.lint-sigterm";
    const child = fixture.spawn(label, {
      ANA_PLUTIL_ENTERED: entered!,
      ANA_PLUTIL_PID: lintPid!,
      ANA_PLUTIL_TERMINATED: terminated!,
    });
    await waitForFile(entered!, child.exited);
    writeFileSync(fixture.plist(label), "foreign target\n");
    child.kill("SIGTERM");
    const status = await Promise.race([child.exited, Bun.sleep(2_000).then(() => null)]);
    if (status === null) {
      child.kill("SIGKILL");
      try {
        runtimeProcess.kill(Number(readFileSync(lintPid!, "utf8").trim()), "SIGKILL");
      } catch {
        // The linter may have exited between the timeout and cleanup.
      }
      throw new Error("launcher did not terminate within two seconds of SIGTERM");
    }
    await finish(child);
    expect(status).not.toBe(0);
    expect(existsSync(terminated!)).toBe(true);
    expect(readFileSync(fixture.plist(label), "utf8")).toBe("foreign target\n");
    expect(readdirSync(fixture.launchd)).toEqual([`${label}.plist`]);
    expect(existsSync(fixture.state)).toBe(false);
  });

  macIt("preserves trailing newlines and carriage returns in ProgramArguments", () => {
    const fixture = launcher();
    const label = "ana.test.argument-bytes";
    const result = fixture.run(label, [], {}, ["bun", "line\n", "carriage\rreturn"]);
    expect(result.status).toBe(0);
    const plist = readFileSync(fixture.plist(label), "utf8");
    expect(plist).toContain("<string>line\n</string>");
    expect(plist).toContain("<string>carriage&#13;return</string>");
  });
});
