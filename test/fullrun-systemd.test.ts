import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { runtimeProcess } from "../src/meta/process.ts";

// The Linux twin of the launchd launcher: the same arguments, frozen map and refusals, detached
// through `systemd-run --user`. A fake systemd-run records the argv it receives and a fake
// systemctl answers the state query from a marker file, so no real unit is started.

const script = join(import.meta.dirname, "..", "tools", "fullrun-systemd.sh");
const dirs: string[] = [];
const linuxIt = it.if(runtimeProcess.platform === "linux");

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-systemd-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A worktree with the pinned Bun, a fake manager on PATH, and the files the fakes write. */
function fixture() {
  const worktree = temp();
  const fakeBin = temp();
  writeFileSync(join(worktree, ".bun-version"), `${Bun.version}\n`);
  const state = join(fakeBin, "unit.state");
  const args = join(fakeBin, "systemd-run.args");
  writeFileSync(
    join(fakeBin, "systemd-run"),
    [
      "#!/bin/sh",
      String.raw`printf "%s\n" "$@" > "$ANA_FAKE_ARGS"`,
      '[ -n "$ANA_FAKE_NO_START" ] || : > "$ANA_FAKE_STATE"',
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(fakeBin, "systemctl"),
    [
      "#!/bin/sh",
      String.raw`if [ -f "$ANA_FAKE_STATE" ]; then printf "LoadState=loaded\nActiveState=active\nMainPID=4242\n"; else printf "LoadState=not-found\nActiveState=inactive\nMainPID=0\n"; fi`,
      "",
    ].join("\n"),
  );
  chmodSync(join(fakeBin, "systemd-run"), 0o755);
  chmodSync(join(fakeBin, "systemctl"), 0o755);
  const home = temp();
  const frozenPath = [dirname(Bun.argv[0]!), "/usr/bin", "/bin"].join(":");
  const frozen = [
    "--env",
    `HOME=${home}`,
    "--env",
    `CODEX_HOME=${temp()}`,
    "--env",
    `TMPDIR=${join(temp(), "run-tmp")}`,
    "--env",
    `PATH=${frozenPath}`,
  ];
  const run = (extra: string[], environment: Record<string, string> = {}) => {
    const result = spawnSync(script, ["--worktree", worktree, "--log", join(worktree, "run.log"), ...extra], {
      env: {
        ...Bun.env,
        PATH: `${fakeBin}:${Bun.env.PATH ?? ""}`,
        HOME: temp(),
        ANA_FAKE_STATE: state,
        ANA_FAKE_ARGS: args,
        ...environment,
      },
    });
    return { status: result.status, output: `${result.stderr}${result.stdout}` };
  };
  return { worktree, home, frozen, frozenPath, state, args, run };
}

describe("fullrun systemd launcher", () => {
  linuxIt("refuses an incomplete or wrong invocation before starting any unit", () => {
    const { worktree, frozen, run, args } = fixture();
    expect(run([]).status).toBe(2);
    expect(run([]).output).toContain("usage: fullrun-systemd.sh");
    expect(run(["--nope"]).output).toContain("unknown argument: --nope");
    expect(run(["--label", "ana.test", "--label", "ana.test", "--", "bun"]).output).toContain(
      "--label: may be specified only once",
    );
    expect(run(["--label", "../escape", ...frozen, "--", "bun"]).output).toContain("invalid unit label");
    expect(run(["--label", "ana.test", "--", "bun", "--version"]).output).toContain(
      "must freeze exactly one HOME, CODEX_HOME, TMPDIR, and PATH",
    );
    expect(run(["--label", "ana.test", ...frozen, "--env", "HOME=/twice", "--", "bun"]).output).toContain(
      "duplicate environment key: HOME",
    );
    expect(
      run(["--label", "ana.test", ...frozen, "--env", "PATH=/usr/bin:/usr/bin", "--", "bun"]).output,
    ).toContain("duplicate environment key: PATH");
    expect(run(["--label", "ana.test", ...frozen, "--", "no-such-command"]).output).toContain(
      "command not found in frozen PATH",
    );
    writeFileSync(join(worktree, ".bun-version"), "0.0.1\n");
    expect(run(["--label", "ana.test", ...frozen, "--", "bun", "--version"]).output).toContain(
      "the worktree pins 0.0.1",
    );
    writeFileSync(join(worktree, ".bun-version"), `${Bun.version}\n`);
    symlinkSync(temp(), join(worktree, "node_modules"));
    expect(run(["--label", "ana.test", ...frozen, "--", "bun", "--version"]).output).toContain(
      "node_modules is a symlink",
    );
    expect(existsSync(args)).toBe(false);
  });

  linuxIt("starts the unit with the frozen map only, once, and reports it live", () => {
    const { worktree, home, frozen, frozenPath, args, run } = fixture();
    // Literal `${HOME}` and `$$` in an assignment and an argument: the manager would expand both
    // unless expansion is off, so the launcher must ask for the bytes as given.
    const literal = "keep ${HOME} and $$ literal";
    const result = run([
      "--label",
      "ana.test.exact",
      ...frozen,
      "--env",
      `ANA_VISIBLE=${literal}`,
      "--",
      "bun",
      "--version",
      literal,
    ]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("launched ana.test.exact.service");
    const argv = readFileSync(args, "utf8").trimEnd().split("\n");
    const dash = argv.indexOf("--");
    expect(argv.slice(0, dash)).toEqual([
      "--user",
      "--collect",
      "--quiet",
      "--expand-environment=no",
      "--unit",
      "ana.test.exact",
      `--property=WorkingDirectory=${worktree}`,
      `--property=StandardOutput=append:${join(worktree, "run.log")}`,
      `--property=StandardError=append:${join(worktree, "run.log")}`,
      "--property=TimeoutStopSec=5",
    ]);
    const program = argv.slice(dash + 1);
    expect(program.slice(0, 2)).toEqual(["/usr/bin/env", "-i"]);
    expect(program.filter((entry) => entry.startsWith("HOME="))).toEqual([`HOME=${home}`]);
    expect(program.filter((entry) => entry.startsWith("PATH="))).toEqual([`PATH=${frozenPath}`]);
    expect(program).toContain(`ANA_VISIBLE=${literal}`);
    expect(program.at(-3)).toBe(realpathSync(Bun.argv[0]!));
    expect(program.slice(-2)).toEqual(["--version", literal]);
    // The frozen TMPDIR is created by the launcher, since the run's first mkdtemp lands there.
    expect(existsSync(frozen[5]!.slice("TMPDIR=".length))).toBe(true);
  });

  linuxIt("refuses a loaded unit name and a unit that is not live after the start", () => {
    const { frozen, state, args, run } = fixture();
    writeFileSync(state, "");
    const loaded = run(["--label", "ana.test.loaded", ...frozen, "--", "bun", "--version"]);
    expect(loaded.status).toBe(2);
    expect(loaded.output).toContain("already loaded");
    expect(existsSync(args)).toBe(false);
    rmSync(state);
    const dead = run(["--label", "ana.test.dead", ...frozen, "--", "bun", "--version"], {
      ANA_FAKE_NO_START: "1",
      ANA_SYSTEMD_LIVE_WAIT_ATTEMPTS: "3",
    });
    expect(dead.status).toBe(2);
    expect(dead.output).toContain("not live after systemd-run");
  });
});
