// `bun run runs sync` against a fake ssh that runs each script in a temporary peer, with a stand-in
// `uv` and Python. What it must never do is the point of most cases: try ssh with no host, carry a
// credential, overwrite a file it did not write, or move a Python under a live campaign.
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { pinnedPythonDir, toolchainPathDirs } from "../src/wall/policy.ts";
import { configuredRuntime, type Host } from "../tools/runs/host-config.ts";
import { GENERATED, hostPython, settingsIn } from "../tools/runs/host-facts.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

/** Built to look like a credential to the scan and no real one. */
const SECRET = `sk-ant-oat01-${"Zx9".repeat(30)}`;

const UV = `#!/bin/sh
echo "$*" >> "$FAKE_UV_CALLS"
case "$*" in
  --version) echo "uv 9.9.9 (stand-in)" ;;
  *"python list"*) [ "$FAKE_UV_OFFERS" = no ] || echo "cpython-stand-in  <download available>" ;;
  *"python install"*)
    for last; do :; done
    dir="$UV_PYTHON_INSTALL_DIR/cpython-$last-stand-in/bin"
    mkdir -p "$dir"
    printf '%s\\n' "pip==1.0" > "$dir/../packages"
    printf '%s' "$last" > "$dir/../version"
    cp "$FAKE_PYTHON" "$dir/python3"
    chmod +x "$dir/python3"
    ;;
  *"python find"*)
    for last; do :; done
    echo "$UV_PYTHON_INSTALL_DIR/cpython-$last-stand-in/bin/python3"
    ;;
  *"pip install"*)
    py=""
    want=0
    for word; do
      if [ "$want" = 1 ]; then py="$word"; want=0; fi
      [ "$word" = --python ] && want=1
    done
    for last; do :; done
    printf '%s\\n' "$last" >> "$(dirname "$py")/../packages"
    ;;
esac
`;
const PYTHON = `#!/bin/sh
here="$(cd "$(dirname "$0")" && pwd)"
case "$3" in
  *os.replace*) rm -f "$5"; mv "$4" "$5" ;;
  *) printf '["%s", [' "$(cat "$here/../version")"
     sep=""
     while read -r line; do printf '%s"%s"' "$sep" "$line"; sep=", "; done < "$here/../packages"
     printf ']]\\n' ;;
esac
`;

const fixtures: { root: string }[] = [];
afterAll(() => {
  for (const { root } of fixtures) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const fake = fakeHosts();
  fixtures.push(fake);
  const peerHome = join(fake.root, "peer-home");
  const hereHome = join(fake.root, "here-home");
  const tree = join(fake.root, "peer-tree");
  for (const dir of [peerHome, hereHome, tree]) mkdirSync(dir, { recursive: true });
  const uv = join(fake.root, "bin", "fake-uv");
  writeFileSync(uv, UV);
  chmodSync(uv, 0o755);
  const python = join(fake.root, "stand-in-python");
  writeFileSync(python, PYTHON);
  chmodSync(python, 0o755);
  const entry = { name: "runner", ssh: "fake-runner", tree, bun: fake.host.bun, uv };
  const run = (
    args: readonly string[],
    {
      host = {},
      env = {},
      fleet = {},
    }: {
      host?: Partial<Host>;
      env?: Record<string, string>;
      fleet?: Record<string, string | boolean | undefined>;
    } = {},
  ) =>
    fake.runScript("tools/runs/cli.ts", ["sync", ...args], {
      HOME: hereHome,
      ANA_UV: uv,
      FAKE_UV_CALLS: join(fake.root, "uv-calls"),
      FAKE_PYTHON: python,
      ANA_HOSTS: capturedJsonStringify([{ ...entry, ...host }]) ?? "",
      FAKE_FLEET:
        capturedJsonStringify({
          "fake-runner": { execute: true, env: { HOME: peerHome }, active: "[]", ...fleet },
        }) ?? "",
      ...env,
    });
  const uvCalls = () =>
    existsSync(join(fake.root, "uv-calls")) ? readFileSync(join(fake.root, "uv-calls"), "utf8") : "";
  const sshCalls = () => fake.recorded().filter((call) => call.tool === "ssh");
  return { ...fake, peerHome, hereHome, tree, run, uvCalls, sshCalls, file: join(tree, ".env.runs") };
}

describe("one host", () => {
  test("no hosts: nothing to do, exit 0, no ssh, on every flag", () => {
    const made = fixture();
    for (const flags of [[], ["--check"], ["--yes"], ["--yes", "--force"]]) {
      for (const hosts of ["", "[]"]) {
        const result = made.run(flags, { env: { ANA_HOSTS: hosts } });
        expect([flags, hosts, result.code, result.err]).toEqual([flags, hosts, 0, ""]);
        expect(result.out).toContain("nothing to do");
      }
    }
    expect(made.sshCalls()).toEqual([]);
    expect(made.uvCalls()).toBe("");
    expect(existsSync(join(made.main, ".env.runs"))).toBe(false);
  });

  test("a verb another host sent here reaches no further and pins nothing", () => {
    const made = fixture();
    const result = made.run(["--yes"], { env: { ANA_HOP: "1", ANA_PYTHON: "3.14.0" } });
    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing to do");
    expect(made.sshCalls()).toEqual([]);
    expect(made.uvCalls()).toBe("");
  });

  test("hosts in a main worktree's file this process did not load are refused, not read as none", () => {
    const made = fixture();
    writeFileSync(join(made.root, ".env.runs"), "ANA_HOSTS='[]'\n");
    const { exitCode, stdout, stderr } = runSync(
      [capturedExecPath, join(import.meta.dir, "../tools/runs/cli.ts"), "sync", "--check"],
      {
        cwd: made.main,
        env: {
          PATH: made.env.PATH,
          FAKE_GIT: join(made.root, "git"),
          FAKE_CALLS: made.env.FAKE_CALLS,
          FAKE_MAIN: made.main,
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(decodeOutput(stderr)).toContain("names ANA_HOSTS");
    expect(decodeOutput(stdout)).not.toContain("nothing to do");
    expect(made.sshCalls()).toEqual([]);
  });
});

describe("settings", () => {
  test("a dry run says what differs and writes nothing; --check exits 1; --yes writes; then it is in step", () => {
    const made = fixture();
    const env = { ANA_LOGINS: "2,3", ANA_KEEP: "off" };
    const dry = made.run([], { env, host: { capacity: 3 } });
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would create");
    expect(dry.out).toContain("ANA_LOGINS: (unset) -> 2,3");
    expect(dry.out).toContain("ANA_RUN_CAP: (unset) -> 3");
    expect(dry.out).toContain("nothing changed");
    expect(existsSync(made.file)).toBe(false);
    expect(made.run(["--check"], { env, host: { capacity: 3 } }).code).toBe(1);
    expect(existsSync(made.file)).toBe(false);

    const applied = made.run(["--yes"], { env, host: { capacity: 3 } });
    expect(applied.code).toBe(0);
    expect(applied.out).toContain("every machine is in step");
    const text = readFileSync(made.file, "utf8");
    expect(text.startsWith(GENERATED)).toBe(true);
    expect(text).toContain("ANA_HOSTS entry");
    expect(settingsIn(text).values).toEqual({ ANA_KEEP: "off", ANA_LOGINS: "2,3", ANA_RUN_CAP: "3" });
    const again = made.run(["--check"], { env, host: { capacity: 3 } });
    expect([again.code, again.out.includes("in step")]).toEqual([0, true]);
  });

  test("a host's own value overrides a shared one, and an empty one writes none", () => {
    const made = fixture();
    const env = { ANA_LOGINS: "2,3", ANA_LOGIN_RUNS: "2" };
    const host = { settings: { ANA_LOGINS: "4", ANA_LOGIN_RUNS: "" } };
    expect(made.run(["--yes"], { env, host }).code).toBe(0);
    expect(settingsIn(readFileSync(made.file, "utf8")).values).toEqual({ ANA_LOGINS: "4" });
  });

  test("a value with a dollar or a hash reads back whole under Bun's own --env-file", () => {
    const made = fixture();
    const value = '["~/notes $HOME #kept"]';
    expect(made.run(["--yes"], { env: { ANA_SEARCH_ROOTS: value } }).code).toBe(0);
    expect(made.run(["--check"], { env: { ANA_SEARCH_ROOTS: value } }).code).toBe(0);
    const { stdout } = runSync(
      [capturedExecPath, `--env-file=${made.file}`, "-e", "console.log(process.env.ANA_SEARCH_ROOTS)"],
      { env: { PATH: made.env.PATH } },
    );
    expect(decodeOutput(stdout).trim()).toBe(value);
  });

  test("a failed write leaves the old file whole and no temporary one", () => {
    const made = fixture();
    expect(made.run(["--yes"], { env: { ANA_LOGINS: "2" } }).code).toBe(0);
    const before = readFileSync(made.file, "utf8");
    const mv = join(made.root, "bin", "mv");
    writeFileSync(mv, "#!/bin/sh\nexit 1\n");
    chmodSync(mv, 0o755);
    const failed = made.run(["--yes"], { env: { ANA_LOGINS: "3" } });
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("settings on runner failed");
    expect(readFileSync(made.file, "utf8")).toBe(before);
    expect(readdirSync(made.tree)).toEqual([".env.runs"]);
  });

  test("a file sync did not generate is refused by name, its values unread and unchanged", () => {
    const made = fixture();
    const hand = `CLAUDE_CODE_OAUTH_TOKEN2=${SECRET}\nANA_LOGINS=9\n`;
    writeFileSync(made.file, hand);
    const env = { ANA_LOGINS: "2" };
    for (const flags of [[], ["--check"], ["--yes"], ["--yes", "--force"]]) {
      const result = made.run(flags, { env });
      expect(result.out).toContain("was not generated by sync");
      expect(result.out).toContain("CLAUDE_CODE_OAUTH_TOKEN2");
      expect(`${result.out}${result.err}`).not.toContain(SECRET);
      expect(result.out).not.toContain("ANA_LOGINS: 9");
      expect(result.code).toBe(flags.length === 0 ? 0 : 1);
    }
    expect(readFileSync(made.file, "utf8")).toBe(hand);
  });

  test("a generated file that gained a key loses it, named and with its value unprinted", () => {
    const made = fixture();
    expect(made.run(["--yes"], { env: { ANA_LOGINS: "2" } }).code).toBe(0);
    writeFileSync(made.file, `${readFileSync(made.file, "utf8")}OPENAI_API_KEY=${SECRET}\n`);
    const dry = made.run([], { env: { ANA_LOGINS: "2" } });
    expect(dry.out).toContain("OPENAI_API_KEY: not one sync carries");
    expect(`${dry.out}${dry.err}`).not.toContain(SECRET);
    expect(made.run(["--yes"], { env: { ANA_LOGINS: "2" } }).code).toBe(0);
    expect(readFileSync(made.file, "utf8")).not.toContain(SECRET);
  });

  test("the entries a verb on a peer loads name the tree's settings file last, whatever they list", () => {
    const host: Host = { name: "p", ssh: "p", tree: "/t", bun: "bun", envFiles: ["/c/.env"] };
    expect(configuredRuntime(host).envFiles).toEqual(["/t/.env", "/c/.env", "/t/.env.runs"]);
    const { envFiles: _listed, ...bare } = host;
    expect(configuredRuntime(bare).envFiles).toEqual(["/t/.env", "/t/.env.runs"]);
  });
});

describe("credentials", () => {
  test.each([
    ["a key that looks like one", { CLAUDE_CODE_OAUTH_TOKEN2: SECRET }, "looks like a credential"],
    ["another", { MY_API_KEY: SECRET }, "looks like a credential"],
    ["a key sync does not carry", { SOME_SETTING: SECRET }, "sync carries"],
    [
      "an allowed key with a credential's value",
      { ANA_KEEP: SECRET },
      "the value of ANA_KEEP looks like a credential",
    ],
    ["a quote that would break the file", { ANA_KEEP: "it's" }, "holds a quote"],
    ["a backslash the file would not keep", { ANA_KEEP: "a\\$b" }, "holds a quote"],
  ])(
    "%s in a host's settings is refused on every flag, with no ssh write and its value unprinted",
    (_, settings, says) => {
      const made = fixture();
      for (const flags of [[], ["--check"], ["--yes"], ["--yes", "--force"]]) {
        const result = made.run(flags, { host: { settings } });
        expect(result.code).toBe(1);
        expect(result.err).toContain(says);
        expect(`${result.out}${result.err}`).not.toContain(SECRET);
      }
      expect(existsSync(made.file)).toBe(false);
    },
  );

  test("a shared value shaped like a credential is refused", () => {
    const made = fixture();
    const result = made.run(["--yes"], { env: { ANA_LOGINS: SECRET } });
    expect(result.code).toBe(1);
    expect(result.err).toContain("the value of ANA_LOGINS looks like a credential");
    expect(`${result.out}${result.err}`).not.toContain(SECRET);
    expect(existsSync(made.file)).toBe(false);
  });

  test("credentials in this process's environment never reach a generated file or a line", () => {
    const made = fixture();
    const env = { ANA_LOGINS: "2", CLAUDE_CODE_OAUTH_TOKEN: SECRET, CLAUDE_CODE_OAUTH_TOKEN2: SECRET };
    const result = made.run(["--yes"], { env });
    expect(result.code).toBe(0);
    expect(`${result.out}${result.err}`).not.toContain(SECRET);
    const text = readFileSync(made.file, "utf8");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("OAUTH");
    expect(
      made
        .sshCalls()
        .flatMap((call) => call.args)
        .join("\n"),
    ).not.toContain(SECRET);
  });
});

describe("python", () => {
  const pin = { ANA_PYTHON: "3.14.9", ANA_PYTHON_PACKAGES: "uv==0.1" };

  test("a dry run names the move and installs nothing; --yes pins it and hostPython reads the pin", () => {
    const made = fixture();
    const dry = made.run([], { env: pin });
    expect(dry.out).toContain("wants 3.14.9 with pip, uv==0.1");
    expect(made.uvCalls()).not.toContain("python install");
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);

    const applied = made.run(["--yes"], { env: pin });
    expect(applied.out).toContain("every machine is in step");
    expect(applied.code).toBe(0);
    expect(lstatSync(pinnedPythonDir(made.peerHome)).isSymbolicLink()).toBe(true);
    expect(hostPython([pinnedPythonDir(made.peerHome)])).toEqual({
      version: "3.14.9",
      packages: ["pip==1.0", "uv==0.1"],
    });
    expect(made.run(["--check"], { env: pin }).code).toBe(0);
    const calls = made.uvCalls();
    expect(calls).not.toMatch(/uninstall|\bremove\b/u);
    for (const line of calls
      .split("\n")
      .filter((one) => /python install|python find|pip install/u.test(one))) {
      expect(line.startsWith("--no-config ")).toBe(true);
    }
  });

  test("no packages named means none enforced, and a package nobody named stays and is reported", () => {
    const made = fixture();
    const version = { ANA_PYTHON: "3.14.9" };
    expect(made.run(["--yes"], { env: version }).out).toContain("every machine is in step");
    const pinned = join(made.peerHome, ".local/share/ana-python/versions/cpython-3.14.9-stand-in");
    writeFileSync(join(pinned, "packages"), "pip==1.0\nextra==2\n");
    const result = made.run(["--check"], { env: version });
    expect(result.code).toBe(0);
    expect(result.out).toContain("extra==2");
    expect(readFileSync(join(pinned, "packages"), "utf8")).toContain("extra==2");
  });

  test("a move under a live campaign is refused and names it, and --force passes and says so", () => {
    const made = fixture();
    const fleet = { active: capturedJsonStringify([{ name: "live-one", login: "2" }]) };
    for (const flags of [[], ["--yes"]]) {
      const result = made.run(flags, { env: pin, fleet });
      expect(result.out).toContain("refused: 1 live: live-one");
      expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);
    }
    expect(made.run(["--yes"], { env: pin, fleet }).code).toBe(1);
    const forced = made.run(["--yes", "--force"], { env: pin, fleet });
    expect(forced.out).toContain("--force, under 1 live: live-one");
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(true);
  });

  test("a live count it cannot read refuses as a live campaign does", () => {
    const made = fixture();
    const result = made.run(["--yes"], { env: pin, fleet: { active: "no json" } });
    expect(result.code).toBe(1);
    expect(result.out).toContain("could not be counted");
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);
  });

  test("settings still reach a host whose Python is refused, and a settings write asks no live count", () => {
    const made = fixture();
    const fleet = { active: capturedJsonStringify([{ name: "live-one", login: "2" }]) };
    made.run(["--yes"], { env: { ...pin, ANA_LOGINS: "2" }, fleet });
    expect(settingsIn(readFileSync(made.file, "utf8")).values).toEqual({ ANA_LOGINS: "2" });
    const quiet = fixture();
    expect(quiet.run(["--yes"], { env: { ANA_LOGINS: "2" }, fleet }).code).toBe(0);
    expect(quiet.sshCalls().some((call) => call.args.at(-1)?.includes("active") === true)).toBe(false);
  });

  test("a version uv does not offer, and a host with no uv, are refused and force does not pass them", () => {
    const made = fixture();
    const offers = made.run(["--yes", "--force"], { env: { ...pin, FAKE_UV_OFFERS: "no" } });
    expect(offers.code).toBe(1);
    expect(offers.out).toContain("uv 9.9.9 offers no Python 3.14.9");
    expect(made.uvCalls()).not.toContain("python install");
    const absent = fixture();
    const none = absent.run(["--yes", "--force"], { env: pin, host: { uv: "/no/such/uv" } });
    expect(none.code).toBe(1);
    expect(none.out).toContain("set `uv` in its ANA_HOSTS entry");
  });

  test("a pin alone, with no hosts, applies here and asks nothing of ssh", () => {
    const made = fixture();
    const result = made.run(["--yes"], { env: { ...pin, ANA_HOSTS: "" } });
    expect(result.code).toBe(0);
    expect(existsSync(pinnedPythonDir(made.hereHome))).toBe(true);
    expect(made.sshCalls()).toEqual([]);
  });

  test("a version that is no version and packages with no version are refused before anything runs", () => {
    const made = fixture();
    expect(made.run([], { env: { ANA_PYTHON: "latest" } }).err).toContain("full version");
    expect(made.run([], { env: { ANA_PYTHON_PACKAGES: "uv" } }).err).toContain("needs ANA_PYTHON");
    expect(made.run([], { env: { ANA_PYTHON: "3.14.9", ANA_PYTHON_PACKAGES: "uv;rm" } }).err).toContain(
      "uv;rm",
    );
    expect(made.sshCalls()).toEqual([]);
  });

  test("the wall's path has the pinned folder first where it exists, and is as it was where it does not", () => {
    const made = fixture();
    const without = toolchainPathDirs(made.peerHome);
    expect(without).not.toContain(pinnedPythonDir(made.peerHome));
    mkdirSync(join(made.peerHome, ".local/share/ana-python/versions/x/bin"), { recursive: true });
    symlinkSync("versions/x/bin", pinnedPythonDir(made.peerHome));
    const withPin = toolchainPathDirs(made.peerHome);
    expect(withPin[0]).toBe(pinnedPythonDir(made.peerHome));
    expect(withPin.slice(1)).toEqual(without);
  });
});

describe("runner", () => {
  /** A runner installed by an older commit, in `home`. */
  function stale(home: string): void {
    const dir = join(home, ".local/share/ana-runner");
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(home, ".local/bin"), { recursive: true });
    for (const name of ["lib.sh", "run.sh", "host.sh", "hosts.js"]) writeFileSync(join(dir, name), "old\n");
    writeFileSync(join(home, ".local/bin/bun"), "old\n");
    writeFileSync(join(dir, "INSTALLED"), '{"commit":"oldcommit","backups":[]}');
  }

  test("a stale runner here is refused while no host sets checks, since the install would keep every check here", () => {
    const made = fixture();
    stale(made.hereHome);
    const before = readFileSync(join(made.hereHome, ".local/share/ana-runner/run.sh"), "utf8");
    const result = made.run(["--yes"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("installed from oldcommit");
    expect(result.out).toContain("no host in ANA_HOSTS sets `checks`");
    expect(readFileSync(join(made.hereHome, ".local/share/ana-runner/run.sh"), "utf8")).toBe(before);
  });

  test("with checks set it reinstalls here and a peer with no runner is left with none", () => {
    const made = fixture();
    stale(made.hereHome);
    const result = made.run(["--yes"], { host: { checks: 2 } });
    expect([result.code, result.out.includes("every machine is in step")]).toEqual([0, true]);
    expect(readFileSync(join(made.hereHome, ".local/share/ana-runner/run.sh"), "utf8")).not.toBe("old\n");
    expect(existsSync(join(made.peerHome, ".local/share/ana-runner"))).toBe(false);
  });

  test("a build elsewhere of the same source reads as the same runner", () => {
    const script = `import { payload } from "${join(import.meta.dir, "../tools/runtime/router/payload.ts")}";
import { runnerDigest } from "${join(import.meta.dir, "../tools/runs/host-facts.ts")}";
const files = await payload();
console.log(runnerDigest("hosts.js", files.get("hosts.js")));`;
    const digests = ["/", join(import.meta.dir, "..")].map((cwd) =>
      decodeOutput(
        runSync([capturedExecPath, "-e", script], { cwd, env: { PATH: runtimeProcess.env.PATH } }).stdout,
      ).trim(),
    );
    expect(digests[0]).toHaveLength(64);
    expect(digests[0]).toBe(digests[1] ?? "");
  });
});

describe("a host that does not answer", () => {
  test("is named, counts for --check, and writes nothing", () => {
    const made = fixture();
    const fleet = { offline: true };
    expect(made.run([], { fleet }).out).toContain("no answer");
    expect(made.run([], { fleet }).code).toBe(0);
    expect(made.run(["--check"], { fleet }).code).toBe(1);
    expect(made.run(["--yes"], { fleet }).code).toBe(1);
    expect(existsSync(made.file)).toBe(false);
  });

  test("--host narrows it, here among them, and refuses a name no entry has", () => {
    const made = fixture();
    const here = made.run(["--host", "here"], { fleet: { offline: true } });
    expect(here.code).toBe(0);
    expect(made.sshCalls()).toEqual([]);
    expect(made.run(["--host", "nowhere"]).err).toContain("no host nowhere");
    expect(made.run(["--yes", "--check"]).err).toContain("--check changes nothing");
  });
});
