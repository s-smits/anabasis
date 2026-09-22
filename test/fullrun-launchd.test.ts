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
const LAUNCHD = ".launchd";
const RUN_LOG = "run.log";
const BUN_VERSION = ".bun-version";
const EXIT_2 = "exit 2";
const BIN_SH = "#!/bin/sh";
const LAUNCHCTL_STATE = "launchctl.state";

// The launcher checks the selected runtime and writes the launchd configuration. These cases
// exercise refusals before launch and use a fake launchctl for publication, startup and cleanup
// checks. The fake records calls in temporary files without registering a real service.

const script = join(import.meta.dirname, "..", "tools", "fullrun-launchd.zsh");
const dirs: string[] = [];
/** launchd labels a rehearsal registered; each is booted out after the test. */
const labels: string[] = [];
const macIt = it.if(runtimeProcess.platform === "darwin");
const uid = process.getuid?.() ?? 501;

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-launchd-"));
  dirs.push(dir);
  return dir;
}

function run(args: string[], environment: Record<string, string> = {}) {
  const path = [environment.PATH, dirname(Bun.argv[0]!), Bun.env.PATH].filter(Boolean).join(":");
  const result = spawnSync(script, args, { env: { ...Bun.env, ...environment, PATH: path } });
  return { status: result.status, stderr: `${result.stderr}${result.stdout}` };
}

function spawnRun(args: string[], environment: Record<string, string> = {}) {
  const path = [environment.PATH, dirname(Bun.argv[0]!), Bun.env.PATH].filter(Boolean).join(":");
  return Bun.spawn({
    cmd: [script, ...args],
    env: { ...Bun.env, ...environment, PATH: path },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function waitForFile(path: string, exited: Promise<number>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    const status = await Promise.race([exited, Bun.sleep(10).then(() => null)]);
    if (status !== null) throw new Error(`launcher exited with ${status} before ${path} appeared`);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function finish(child: ReturnType<typeof spawnRun>) {
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, output: `${stderr}${stdout}` };
}

function frozenEnvironment(home = temp()) {
  const path = [dirname(Bun.argv[0]!), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  const tmp = temp();
  const codexHome = temp();
  return {
    args: [
      "--env",
      `HOME=${home}`,
      "--env",
      `CODEX_HOME=${codexHome}`,
      "--env",
      `TMPDIR=${tmp}`,
      "--env",
      `PATH=${path}`,
    ],
    home,
    codexHome,
    tmp,
    path,
  };
}

afterEach(() => {
  for (const label of labels.splice(0)) {
    spawnSync("/bin/launchctl", ["bootout", `gui/${uid}/${label}`]);
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fullrun launchd launcher", () => {
  it("runs with NO_RCS so login files cannot reselect the Bun executable the worktree pinned", () => {
    // Run 45's first launch aborted here: without -f, ~/.zshenv reordered PATH onto a same-version
    // but different runtime executable, which fails the run's host check.
    expect(readFileSync(script, "utf8").split("\n")[0]).toBe("#!/bin/zsh -f");
  });

  macIt("refuses an incomplete invocation instead of launching a partly configured job", () => {
    const missing = run(["--worktree", temp(), "--log", "/tmp/x.log"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("usage: fullrun-launchd.zsh");

    const noCommand = run(["--worktree", temp(), "--log", "/tmp/x.log", "--label", "ana.test", "--"]);
    expect(noCommand.status).toBe(2);

    const unknown = run(["--nope", "value"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("unknown argument: --nope");

    const missingValue = run(["--worktree"]);
    expect(missingValue.status).toBe(2);
    expect(missingValue.stderr).toContain("--worktree: missing value");

    const duplicate = run([
      "--worktree",
      temp(),
      "--worktree",
      temp(),
      "--log",
      "/tmp/x.log",
      "--label",
      "ana.test",
      "--",
      "bun",
    ]);
    expect(duplicate.status).toBe(2);
    expect(duplicate.stderr).toContain("--worktree: may be specified only once");
  });

  macIt("refuses a worktree that does not pin a Bun version", () => {
    const worktree = temp();
    const result = run([
      "--worktree",
      worktree,
      "--log",
      join(worktree, RUN_LOG),
      "--label",
      "ana.test",
      "--",
      "true",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("has no .bun-version");
  });

  macIt("refuses a launch map that omits or relativises the private Codex roots", () => {
    const worktree = temp();
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const path = [dirname(Bun.argv[0]!), "/usr/bin", "/bin"].join(":");
    const omitted = run([
      "--worktree",
      worktree,
      "--log",
      join(worktree, RUN_LOG),
      "--label",
      "ana.test.incomplete-map",
      "--env",
      `HOME=${temp()}`,
      "--env",
      `PATH=${path}`,
      "--",
      "bun",
      "--version",
    ]);
    expect(omitted.status).toBe(2);
    expect(omitted.stderr).toContain("HOME, CODEX_HOME, TMPDIR, and PATH");

    const relativeTmp = run([
      "--worktree",
      worktree,
      "--log",
      join(worktree, RUN_LOG),
      "--label",
      "ana.test.relative-tmp",
      "--env",
      `HOME=${temp()}`,
      "--env",
      `CODEX_HOME=${temp()}`,
      "--env",
      "TMPDIR=relative-tmp",
      "--env",
      `PATH=${path}`,
      "--",
      "bun",
      "--version",
    ]);
    expect(relativeTmp.status).toBe(2);
    expect(relativeTmp.stderr).toContain("frozen TMPDIR must be absolute");
  });

  macIt("refuses when the running Bun is not the version the worktree pins", () => {
    const worktree = temp();
    writeFileSync(join(worktree, BUN_VERSION), "99.99.99\n");
    const environment = frozenEnvironment();
    const result = run([
      "--worktree",
      worktree,
      "--log",
      join(worktree, RUN_LOG),
      "--label",
      "ana.test",
      ...environment.args,
      "--",
      "bun",
      "--version",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("the worktree pins 99.99.99");
  });

  macIt("refuses a worktree whose node_modules is a symlink, because a run owns its dependencies", () => {
    const worktree = temp();
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    symlinkSync(temp(), join(worktree, "node_modules"));
    const environment = frozenEnvironment();
    const result = run([
      "--worktree",
      worktree,
      "--log",
      join(worktree, RUN_LOG),
      "--label",
      "ana.test",
      ...environment.args,
      "--",
      "bun",
      "--version",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("run must own its dependencies");
    expect(result.stderr).toContain("scripts/worktree.sh setup");
    // The refusal happens before any plist is written.
    expect(existsSync(join(worktree, LAUNCHD))).toBe(false);
  });

  macIt("refuses a symlinked launchd directory before publishing into the foreign tree", () => {
    const worktree = temp();
    const foreign = temp();
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    symlinkSync(foreign, join(worktree, LAUNCHD));
    const frozen = frozenEnvironment();
    const result = run([
      "--worktree",
      worktree,
      "--log",
      join(worktree, RUN_LOG),
      "--label",
      "ana.test.parent-symlink",
      ...frozen.args,
      "--",
      "bun",
      "--version",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("launchd directory must not be a symlink");
    expect(readdirSync(foreign)).toEqual([]);
  });

  macIt("writes the frozen environment exactly once and resolves Bun through its PATH", () => {
    const worktree = temp();
    const fakeBin = temp();
    const state = join(fakeBin, LAUNCHCTL_STATE);
    const ambientHome = temp();
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      [
        BIN_SH,
        String.raw`if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then printf "state = running\npid = 4242\n"; exit 0; fi; exit 1; fi`,
        'if [ "$1" = "bootstrap" ]; then : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
        EXIT_2,
        "",
      ].join("\n"),
    );
    chmodSync(fakeLaunchctl, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.exact-environment";
    const result = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--env",
        "ANA_VISIBLE=value",
        "--",
        "bun",
        "--version",
      ],
      { PATH: fakeBin, HOME: ambientHome, ANA_FAKE_LAUNCHCTL_STATE: state },
    );
    expect(result.status).toBe(0);
    const plist = readFileSync(join(worktree, LAUNCHD, `${label}.plist`), "utf8");
    expect(plist).toContain("<string>/usr/bin/env</string>\n    <string>-i</string>");
    expect(plist.match(/<string>HOME=/g)).toHaveLength(1);
    expect(plist.match(/<string>CODEX_HOME=/g)).toHaveLength(1);
    expect(plist.match(/<string>TMPDIR=/g)).toHaveLength(1);
    expect(plist.match(/<string>PATH=/g)).toHaveLength(1);
    expect(plist).toContain(`<string>HOME=${frozen.home}</string>`);
    expect(plist).toContain(`<string>CODEX_HOME=${frozen.codexHome}</string>`);
    expect(plist).toContain(`<string>TMPDIR=${frozen.tmp}</string>`);
    expect(plist).toContain(`<string>PATH=${frozen.path}</string>`);
    expect(plist).toContain("<string>ANA_VISIBLE=value</string>");
    expect(plist).not.toContain("<key>EnvironmentVariables</key>");
    expect(plist).not.toContain(ambientHome);
    const receiptPath = join(worktree, LAUNCHD, `${label}.plist.receipt.json`);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    const digest = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(worktree, LAUNCHD, `${label}.plist`)))
      .digest("hex");
    expect(receipt).toEqual({
      schema: "superloop-launchd-plist-receipt/v1",
      plist: realpathSync(join(worktree, LAUNCHD, `${label}.plist`)),
      sha256: digest,
    });
    expect(result.stderr).toContain(`published plist SHA-256: ${digest}`);
  });

  macIt(
    "refuses a same-UID replacement after publication and leaves the digest receipt for diagnosis",
    () => {
      const worktree = temp();
      const fakeBin = temp();
      const state = join(fakeBin, LAUNCHCTL_STATE);
      const realBun = realpathSync(Bun.argv[0]!);
      const publishHelper = join(import.meta.dirname, "..", "tools", "fullrun-launchd-publish.ts");
      writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
      const fakeBun = join(fakeBin, "bun");
      writeFileSync(
        fakeBun,
        [
          BIN_SH,
          'if [ "$2" = "$ANA_PUBLISH_HELPER" ] && [ "$3" != "--verify" ]; then',
          '  "$ANA_REAL_BUN" "$@"',
          "  status=$?",
          String.raw`  if [ "$status" -eq 0 ]; then printf "hostile replacement\n" > "$3"; fi`,
          '  exit "$status"',
          "fi",
          'exec "$ANA_REAL_BUN" "$@"',
          "",
        ].join("\n"),
      );
      chmodSync(fakeBun, 0o755);
      const fakeLaunchctl = join(fakeBin, "launchctl");
      writeFileSync(
        fakeLaunchctl,
        [
          BIN_SH,
          String.raw`if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then printf "state = running\npid = 4242\n"; exit 0; fi; exit 1; fi`,
          'if [ "$1" = "bootstrap" ]; then : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
          EXIT_2,
          "",
        ].join("\n"),
      );
      chmodSync(fakeLaunchctl, 0o755);
      const frozen = frozenEnvironment();
      const pathIndex = frozen.args.indexOf(`PATH=${frozen.path}`);
      if (pathIndex < 0) throw new Error("frozen PATH argument is absent");
      frozen.args[pathIndex] = `PATH=${fakeBin}:${frozen.path}`;
      const label = "ana.test.post-publication-replacement";
      const result = run(
        [
          "--worktree",
          worktree,
          "--log",
          join(worktree, RUN_LOG),
          "--label",
          label,
          ...frozen.args,
          "--",
          "bun",
          "--version",
        ],
        {
          PATH: fakeBin,
          ANA_FAKE_LAUNCHCTL_STATE: state,
          ANA_REAL_BUN: realBun,
          ANA_PUBLISH_HELPER: publishHelper,
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("published plist changed before launchctl bootstrap");
      expect(existsSync(state)).toBe(false);
      expect(readFileSync(join(worktree, LAUNCHD, `${label}.plist`), "utf8")).toBe("hostile replacement\n");
      expect(existsSync(join(worktree, LAUNCHD, `${label}.plist.receipt.json`))).toBe(true);
    },
  );

  macIt("boots out a service when its plist changes after successful bootstrap", () => {
    const worktree = temp();
    const fakeBin = temp();
    const state = join(fakeBin, LAUNCHCTL_STATE);
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      [
        BIN_SH,
        String.raw`if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then printf "state = running\npid = 4242\n"; exit 0; fi; exit 1; fi`,
        String.raw`if [ "$1" = "bootstrap" ]; then printf "hostile after bootstrap\n" > "$3"; : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi`,
        'if [ "$1" = "bootout" ]; then /bin/rm -f "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
        EXIT_2,
        "",
      ].join("\n"),
    );
    chmodSync(fakeLaunchctl, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.post-bootstrap-replacement";
    const result = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "--version",
      ],
      { PATH: fakeBin, ANA_FAKE_LAUNCHCTL_STATE: state },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("published plist changed after bootstrap");
    expect(existsSync(state)).toBe(false);
    expect(readFileSync(join(worktree, LAUNCHD, `${label}.plist`), "utf8")).toBe("hostile after bootstrap\n");
    expect(existsSync(join(worktree, LAUNCHD, `${label}.plist.receipt.json`))).toBe(true);
  });

  macIt("refuses duplicate environment keys before writing a plist", () => {
    const worktree = temp();
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const frozen = frozenEnvironment();
    const result = run([
      "--worktree",
      worktree,
      "--log",
      join(worktree, RUN_LOG),
      "--label",
      "ana.test.duplicate-environment",
      ...frozen.args,
      "--env",
      `HOME=${temp()}`,
      "--",
      "bun",
      "--version",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("duplicate environment key: HOME");
    expect(existsSync(join(worktree, LAUNCHD))).toBe(false);
  });

  macIt("publishes only a complete linted plist and never overwrites a stale target", () => {
    const worktree = temp();
    const fakeBin = temp();
    const state = join(fakeBin, LAUNCHCTL_STATE);
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      [
        BIN_SH,
        'if [ "$1" = "print" ]; then exit 1; fi',
        'if [ "$1" = "bootstrap" ]; then : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
        EXIT_2,
        "",
      ].join("\n"),
    );
    chmodSync(fakeLaunchctl, 0o755);
    const fakePlutil = join(fakeBin, "plutil");
    writeFileSync(fakePlutil, "#!/bin/sh\nexit 1\n");
    chmodSync(fakePlutil, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.atomic-plist";
    const plist = join(worktree, LAUNCHD, `${label}.plist`);
    const failed = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "--version",
      ],
      { PATH: fakeBin, ANA_FAKE_LAUNCHCTL_STATE: state },
    );
    expect(failed.status).not.toBe(0);
    expect(existsSync(plist)).toBe(false);
    expect(readdirSync(join(worktree, LAUNCHD))).toEqual([]);
    expect(existsSync(state)).toBe(false);

    writeFileSync(plist, "preserve-me\n");
    const stale = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "--version",
      ],
      { PATH: fakeBin, ANA_FAKE_LAUNCHCTL_STATE: state },
    );
    expect(stale.status).toBe(2);
    expect(stale.stderr).toContain("plist already exists");
    expect(readFileSync(plist, "utf8")).toBe("preserve-me\n");
    expect(existsSync(state)).toBe(false);
  });

  macIt("refuses a bootstrap whose print output does not prove a running service", () => {
    for (const mode of ["waiting", "missing-pid"]) {
      const worktree = temp();
      const fakeBin = temp();
      const state = join(fakeBin, LAUNCHCTL_STATE);
      writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
      const fakeLaunchctl = join(fakeBin, "launchctl");
      writeFileSync(
        fakeLaunchctl,
        [
          BIN_SH,
          String.raw`if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then if [ "$ANA_LIVE_MODE" = "waiting" ]; then printf "state = waiting\npid = 4242\n"; else printf "state = running\n"; fi; exit 0; fi; exit 1; fi`,
          'if [ "$1" = "bootstrap" ]; then : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
          'if [ "$1" = "bootout" ]; then /bin/rm -f "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
          EXIT_2,
          "",
        ].join("\n"),
      );
      chmodSync(fakeLaunchctl, 0o755);
      const frozen = frozenEnvironment();
      const result = run(
        [
          "--worktree",
          worktree,
          "--log",
          join(worktree, RUN_LOG),
          "--label",
          `ana.test.not-live-${mode}`,
          ...frozen.args,
          "--",
          "bun",
          "--version",
        ],
        {
          PATH: fakeBin,
          ANA_FAKE_LAUNCHCTL_STATE: state,
          ANA_LIVE_MODE: mode,
          ANA_LAUNCHD_LIVE_WAIT_ATTEMPTS: "20",
        },
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("controller service is not live after bootstrap");
      expect(existsSync(state)).toBe(false);
    }
  });

  macIt("removes its final plist when bootstrap fails without establishing the service", () => {
    const worktree = temp();
    const fakeBin = temp();
    const state = join(fakeBin, LAUNCHCTL_STATE);
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      [
        BIN_SH,
        String.raw`if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then printf "state = running\npid = 4242\n"; exit 0; fi; exit 1; fi`,
        'if [ "$1" = "bootstrap" ]; then exit 73; fi',
        EXIT_2,
        "",
      ].join("\n"),
    );
    chmodSync(fakeLaunchctl, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.bootstrap-failure";
    const result = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "--version",
      ],
      { PATH: fakeBin, ANA_FAKE_LAUNCHCTL_STATE: state },
    );
    expect(result.status).toBe(73);
    expect(existsSync(join(worktree, LAUNCHD, `${label}.plist`))).toBe(false);
    expect(existsSync(join(worktree, LAUNCHD, `${label}.plist.receipt.json`))).toBe(false);
    expect(readdirSync(join(worktree, LAUNCHD))).toEqual([]);
    expect(existsSync(state)).toBe(false);
  });

  macIt("does not claim a foreign service that appears after its bootstrap fails", () => {
    const worktree = temp();
    const fakeBin = temp();
    const state = join(fakeBin, "foreign-service.state");
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      [
        BIN_SH,
        String.raw`if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then printf "state = running\npid = 4242\n"; exit 0; fi; exit 1; fi`,
        'if [ "$1" = "bootstrap" ]; then : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 73; fi',
        EXIT_2,
        "",
      ].join("\n"),
    );
    chmodSync(fakeLaunchctl, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.bootstrap-foreign";
    const result = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "--version",
      ],
      { PATH: fakeBin, ANA_FAKE_LAUNCHCTL_STATE: state },
    );
    expect(result.status).toBe(73);
    expect(existsSync(join(worktree, LAUNCHD, `${label}.plist`))).toBe(false);
    expect(existsSync(join(worktree, LAUNCHD, `${label}.plist.receipt.json`))).toBe(false);
    expect(existsSync(state)).toBe(true);
  });

  macIt("preserves the final plist after bootstrap owns the service even if print then fails", () => {
    const worktree = temp();
    const fakeBin = temp();
    const state = join(fakeBin, LAUNCHCTL_STATE);
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      [
        BIN_SH,
        'if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then exit 74; fi; exit 1; fi',
        'if [ "$1" = "bootstrap" ]; then : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
        EXIT_2,
        "",
      ].join("\n"),
    );
    chmodSync(fakeLaunchctl, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.bootstrap-owned";
    const result = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "--version",
      ],
      { PATH: fakeBin, ANA_FAKE_LAUNCHCTL_STATE: state },
    );
    expect(result.status).toBe(74);
    expect(existsSync(join(worktree, LAUNCHD, `${label}.plist`))).toBe(true);
    expect(existsSync(join(worktree, LAUNCHD, `${label}.plist.receipt.json`))).toBe(true);
    expect(existsSync(state)).toBe(true);
  });

  macIt("refuses a symlink or directory created at the destination while lint is running", async () => {
    for (const targetKind of ["symlink", "directory"] as const) {
      const worktree = temp();
      const fakeBin = temp();
      const entered = join(fakeBin, "plutil.entered");
      const release = join(fakeBin, "plutil.release");
      const state = join(fakeBin, LAUNCHCTL_STATE);
      writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
      const fakeLaunchctl = join(fakeBin, "launchctl");
      writeFileSync(
        fakeLaunchctl,
        [
          BIN_SH,
          'if [ "$1" = "print" ]; then exit 1; fi',
          'if [ "$1" = "bootstrap" ]; then : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
          EXIT_2,
          "",
        ].join("\n"),
      );
      chmodSync(fakeLaunchctl, 0o755);
      const fakePlutil = join(fakeBin, "plutil");
      writeFileSync(
        fakePlutil,
        [
          BIN_SH,
          ': > "$ANA_PLUTIL_ENTERED"',
          'while [ ! -f "$ANA_PLUTIL_RELEASE" ]; do /bin/sleep 0.01; done',
          "exit 0",
          "",
        ].join("\n"),
      );
      chmodSync(fakePlutil, 0o755);
      const frozen = frozenEnvironment();
      const label = `ana.test.concurrent-${targetKind}`;
      const plist = join(worktree, LAUNCHD, `${label}.plist`);
      const child = spawnRun(
        [
          "--worktree",
          worktree,
          "--log",
          join(worktree, RUN_LOG),
          "--label",
          label,
          ...frozen.args,
          "--",
          "bun",
          "--version",
        ],
        {
          PATH: fakeBin,
          ANA_FAKE_LAUNCHCTL_STATE: state,
          ANA_PLUTIL_ENTERED: entered,
          ANA_PLUTIL_RELEASE: release,
        },
      );
      await waitForFile(entered, child.exited);
      const redirect = temp();
      if (targetKind === "symlink") symlinkSync(redirect, plist);
      else mkdirSync(plist);
      writeFileSync(release, "release\n");
      const result = await finish(child);
      expect(result.status).not.toBe(0);
      expect(existsSync(state)).toBe(false);
      expect(readdirSync(redirect)).toEqual([]);
      if (targetKind === "directory") expect(readdirSync(plist)).toEqual([]);
    }
  });

  macIt("publishes the descriptor bytes even when the linter tries to swap its input path", () => {
    const worktree = temp();
    const fakeBin = temp();
    const state = join(fakeBin, LAUNCHCTL_STATE);
    const linted = join(fakeBin, "linted.plist");
    const launched = join(fakeBin, "launched.plist");
    const malicious = join(fakeBin, "malicious.plist");
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    writeFileSync(malicious, "malicious replacement\n");
    const fakePlutil = join(fakeBin, "plutil");
    writeFileSync(
      fakePlutil,
      [
        BIN_SH,
        '/bin/cp "$3" "$ANA_LINTED_PLIST"',
        '/bin/mv "$ANA_MALICIOUS_PLIST" "$3" 2>/dev/null || true',
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(fakePlutil, 0o755);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      [
        BIN_SH,
        String.raw`if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then printf "state = running\npid = 4242\n"; exit 0; fi; exit 1; fi`,
        'if [ "$1" = "bootstrap" ]; then /bin/cp "$3" "$ANA_LAUNCHED_PLIST"; : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
        EXIT_2,
        "",
      ].join("\n"),
    );
    chmodSync(fakeLaunchctl, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.staging-swap";
    const result = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "--version",
      ],
      {
        PATH: fakeBin,
        ANA_FAKE_LAUNCHCTL_STATE: state,
        ANA_LAUNCHED_PLIST: launched,
        ANA_LINTED_PLIST: linted,
        ANA_MALICIOUS_PLIST: malicious,
      },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(launched, "utf8")).toBe(readFileSync(linted, "utf8"));
    expect(readFileSync(launched, "utf8")).toContain(`<string>${label}</string>`);
    expect(existsSync(malicious)).toBe(true);
  });

  macIt("terminates a delayed linter promptly on SIGTERM and leaves a foreign target alone", async () => {
    const worktree = temp();
    const fakeBin = temp();
    const entered = join(fakeBin, "plutil.entered");
    const lintPid = join(fakeBin, "plutil.pid");
    const terminated = join(fakeBin, "plutil.terminated");
    const state = join(fakeBin, LAUNCHCTL_STATE);
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      '#!/bin/sh\nif [ "$1" = print ]; then exit 1; fi\n: > "$ANA_FAKE_LAUNCHCTL_STATE"\n',
    );
    chmodSync(fakeLaunchctl, 0o755);
    const fakePlutil = join(fakeBin, "plutil");
    writeFileSync(
      fakePlutil,
      [
        "#!/usr/bin/env bun",
        'import { writeFileSync } from "node:fs";',
        "writeFileSync(Bun.env.ANA_PLUTIL_PID!, `${process.pid}\\n`);",
        String.raw`writeFileSync(Bun.env.ANA_PLUTIL_ENTERED!, "entered\n");`,
        'process.on("SIGTERM", () => {',
        String.raw`  writeFileSync(Bun.env.ANA_PLUTIL_TERMINATED!, "terminated\n");`,
        "  process.exit(143);",
        "});",
        "await new Promise(() => setInterval(() => {}, 60_000));",
        "",
      ].join("\n"),
    );
    chmodSync(fakePlutil, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.lint-sigterm";
    const plist = join(worktree, LAUNCHD, `${label}.plist`);
    const child = spawnRun(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "--version",
      ],
      {
        PATH: fakeBin,
        ANA_FAKE_LAUNCHCTL_STATE: state,
        ANA_PLUTIL_ENTERED: entered,
        ANA_PLUTIL_PID: lintPid,
        ANA_PLUTIL_TERMINATED: terminated,
      },
    );
    await waitForFile(entered, child.exited);
    writeFileSync(plist, "foreign target\n");
    child.kill("SIGTERM");
    const status = await Promise.race([child.exited, Bun.sleep(2_000).then(() => null)]);
    if (status === null) {
      child.kill("SIGKILL");
      try {
        runtimeProcess.kill(Number(readFileSync(lintPid, "utf8").trim()), "SIGKILL");
      } catch {
        // The linter may have exited between the timeout and cleanup.
      }
      throw new Error("launcher did not terminate within two seconds of SIGTERM");
    }
    await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(status).not.toBe(0);
    expect(existsSync(terminated)).toBe(true);
    expect(readFileSync(plist, "utf8")).toBe("foreign target\n");
    expect(readdirSync(join(worktree, LAUNCHD))).toEqual([`${label}.plist`]);
    expect(existsSync(state)).toBe(false);
  });

  macIt("preserves trailing newlines and carriage returns in ProgramArguments", () => {
    const worktree = temp();
    const fakeBin = temp();
    const state = join(fakeBin, LAUNCHCTL_STATE);
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const fakeLaunchctl = join(fakeBin, "launchctl");
    writeFileSync(
      fakeLaunchctl,
      [
        BIN_SH,
        String.raw`if [ "$1" = "print" ]; then if [ -f "$ANA_FAKE_LAUNCHCTL_STATE" ]; then printf "state = running\npid = 4242\n"; exit 0; fi; exit 1; fi`,
        'if [ "$1" = "bootstrap" ]; then : > "$ANA_FAKE_LAUNCHCTL_STATE"; exit 0; fi',
        EXIT_2,
        "",
      ].join("\n"),
    );
    chmodSync(fakeLaunchctl, 0o755);
    const frozen = frozenEnvironment();
    const label = "ana.test.argument-bytes";
    const result = run(
      [
        "--worktree",
        worktree,
        "--log",
        join(worktree, RUN_LOG),
        "--label",
        label,
        ...frozen.args,
        "--",
        "bun",
        "line\n",
        "carriage\rreturn",
      ],
      { PATH: fakeBin, ANA_FAKE_LAUNCHCTL_STATE: state },
    );
    expect(result.status).toBe(0);
    const plist = readFileSync(join(worktree, LAUNCHD, `${label}.plist`), "utf8");
    expect(plist).toContain("<string>line\n</string>");
    expect(plist).toContain("<string>carriage&#13;return</string>");
  });

  macIt("refuses a label that could escape the launchd directory", () => {
    const worktree = temp();
    writeFileSync(join(worktree, BUN_VERSION), `${Bun.version}\n`);
    const frozen = frozenEnvironment();
    const result = run([
      "--worktree",
      worktree,
      "--log",
      join(worktree, RUN_LOG),
      "--label",
      "../outside",
      ...frozen.args,
      "--",
      "bun",
      "--version",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid launchd label");
    expect(existsSync(join(worktree, LAUNCHD))).toBe(false);
  });
});
