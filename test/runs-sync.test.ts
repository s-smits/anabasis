// `bun run runs sync` and the settings every remote verb carries, against a fake ssh that runs each
// script in a temporary peer, with a stand-in `uv` and Python. What it must never do is the point of
// most cases: try ssh with no host, carry a credential, or move a Python under a live campaign.
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { gitText } from "../src/meta/git.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { pinnedPythonDir, toolchainPathDirs } from "../src/wall/policy.ts";
import type { Host } from "../tools/runs/host-config.ts";
import { hostPython } from "../tools/runs/receipt.ts";
import { runnerLags, WALL_PATH } from "../tools/runs/sync.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

/** What a fake peer answers (`test/helpers/fake-hosts.ts`). */
interface Fleet {
  readonly active?: string | undefined;
  readonly offline?: boolean;
  readonly execute?: boolean;
  readonly env?: Readonly<Record<string, string>>;
}
/** An entry as a person may write it, a wrong type included. */
type HostEntry = Omit<Partial<Host>, "exclude" | "settings"> & {
  readonly exclude?: readonly string[] | string;
  readonly settings?: Readonly<Record<string, string>> | string;
};

/** Built to look like a credential to the scan and no real one. */
const SECRET = `sk-ant-oat01-${"Zx9".repeat(30)}`;
/** A version no machine this suite runs on holds. */
const VERSION = "3.99.1";

const UV = `#!/bin/sh
[ "$FAKE_UV_ABSENT" = 1 ] && exit 127
echo "$*" >> "$FAKE_UV_CALLS"
case "$*" in
  --version) echo "uv 9.9.9 (stand-in)" ;;
  *"python install"*)
    for last; do :; done
    if [ "$FAKE_UV_OFFERS" = no ]; then echo "error: No download found for $last" >&2; exit 2; fi
    dir="$UV_PYTHON_INSTALL_DIR/cpython-$last-stand-in/bin"
    mkdir -p "$dir"
    printf '%s\\n' "\${FAKE_UV_SHIPS-pip==1.0}" > "$dir/../packages"
    printf '%s' "$last" > "$dir/../version"
    cp "$FAKE_PYTHON" "$dir/python3"
    chmod +x "$dir/python3"
    ;;
  *"python find"*)
    for last; do :; done
    echo "$UV_PYTHON_INSTALL_DIR/cpython-$last-stand-in/bin/python3"
    ;;
  *"pip install"*)
    [ "$FAKE_UV_PIP" = skip ] && exit 0
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

function script(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

function fixture() {
  const fake = fakeHosts();
  fixtures.push(fake);
  // This verb asks the real git of the tree it runs from, and no fake one.
  rmSync(join(fake.root, "bin", "git"));
  gitText(fake.main, "init", "-q");
  const peerHome = join(fake.root, "peer-home");
  const hereHome = join(fake.root, "here-home");
  const tree = join(fake.root, "peer-tree");
  for (const dir of [join(peerHome, ".local/bin"), join(hereHome, ".local/bin"), tree]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const home of [peerHome, hereHome]) script(join(home, ".local/bin/uv"), UV);
  const python = join(fake.root, "stand-in-python");
  script(python, PYTHON);
  const entry = { name: "runner", ssh: "fake-runner", tree, bun: fake.host.bun };
  const environment = (host: HostEntry = {}, env: Record<string, string> = {}, fleet: Fleet = {}) => ({
    HOME: hereHome,
    FAKE_UV_CALLS: join(fake.root, "uv-calls"),
    FAKE_PYTHON: python,
    ANA_HOSTS: capturedJsonStringify([{ ...entry, ...host }]) ?? "",
    FAKE_FLEET:
      capturedJsonStringify({
        "fake-runner": { execute: true, env: { HOME: peerHome }, active: "[]", ...fleet },
      }) ?? "",
    ...env,
  });
  const run = (
    args: readonly string[],
    { host, env, fleet }: { host?: HostEntry; env?: Record<string, string>; fleet?: Fleet } = {},
  ) => fake.runScript("tools/runs/cli.ts", ["sync", ...args], environment(host, env, fleet));
  const uvCalls = () =>
    existsSync(join(fake.root, "uv-calls")) ? readFileSync(join(fake.root, "uv-calls"), "utf8") : "";
  const sshCalls = () => fake.recorded().filter((call) => call.tool === "ssh");
  return { ...fake, drive: fake.run, peerHome, hereHome, tree, environment, run, uvCalls, sshCalls };
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
    const result = made.run(["--yes"], { env: { ANA_HOP: "1", ANA_PYTHON: VERSION } });
    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing to do");
    expect(made.sshCalls()).toEqual([]);
    expect(made.uvCalls()).toBe("");
  });
});

describe("settings", () => {
  /** What a verb on the peer finds in its environment, where the peer's own value of each is
   *  `its own`: a stand-in Bun prints it, run through the path every remote verb takes. */
  function sent(host: Partial<Host>, env: Record<string, string>) {
    const made = fixture();
    const bun = join(made.root, "print-env");
    script(bun, `#!/bin/sh\nenv | grep '^ANA_'\n`);
    const keys = ["ANA_KEEP", "ANA_LOGINS", "ANA_LOGIN_RUNS", "ANA_LOGIN_SUBS", "ANA_RUN_CAP", "ANA_HOSTS"];
    const own = Object.fromEntries(keys.map((key) => [key, "its own"]));
    const { code, out, err } = made.drive(
      `import { asked } from "REPOSITORY/tools/runs/hosts.ts";
import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts";
const [answer] = await asked(["status"], hostsOf(), "configured");
console.log(JSON.stringify(answer?.lines));
process.exit();`,
      made.environment({ bun, ...host }, env, { env: { HOME: made.peerHome, ...own } }),
    );
    expect([code, err]).toEqual([0, ""]);
    const lines = parseJsonAs<string[]>(out);
    return Object.fromEntries(
      lines.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
  }

  test("every remote verb carries the shared values, the host's capacity and never the host list", () => {
    const seen = sent({ capacity: 3 }, { ANA_LOGINS: "2,3", ANA_KEEP: "off" });
    expect(seen).toMatchObject({ ANA_LOGINS: "2,3", ANA_KEEP: "off", ANA_RUN_CAP: "3", ANA_HOP: "1" });
    expect(seen.ANA_HOSTS).toBe("its own");
    expect(seen.ANA_LOGIN_RUNS).toBe("its own");
  });

  test("a host's own value overrides a shared one, and an empty one sends none", () => {
    const settings = { ANA_LOGINS: "4", ANA_LOGIN_RUNS: "" };
    const seen = sent({ settings }, { ANA_LOGINS: "2,3", ANA_LOGIN_RUNS: "2" });
    expect(seen.ANA_LOGINS).toBe("4");
    expect(seen.ANA_LOGIN_RUNS).toBe("its own");
  });

  test("a value with a dollar, a hash or a quote reads back whole", () => {
    const value = String.raw`a $HOME #kept 'quoted' \ b`;
    expect(sent({}, { ANA_LOGINS: value }).ANA_LOGINS).toBe(value);
  });

  test("a dry run says what travels, and there is nothing to apply for it", () => {
    const made = fixture();
    const env = { ANA_LOGINS: "2,3", ANA_KEEP: "off" };
    const host = { capacity: 3, checks: 2, settings: { ANA_LOGIN_SUBS: "2:max" } };
    const dry = made.run([], { env, host });
    expect(dry.code).toBe(0);
    for (const word of ["ANA_LOGINS=2,3", "ANA_KEEP=off", "ANA_LOGIN_SUBS=2:max", "ANA_RUN_CAP=3"]) {
      expect(dry.out).toContain(word);
    }
    expect(made.run(["--check"], { env, host }).code).toBe(0);
    expect(made.run(["--yes"], { env, host }).code).toBe(0);
    expect(existsSync(join(made.tree, ".env.runs"))).toBe(false);
    const asked = made.sshCalls().some((call) => call.args.at(-1)?.includes("active") === true);
    expect(asked).toBe(false);
  });
});

describe("credentials", () => {
  test.each([
    ["a key that looks like one", { CLAUDE_CODE_OAUTH_TOKEN2: SECRET }, "CLAUDE_CODE_OAUTH_TOKEN2"],
    ["another", { MY_API_KEY: SECRET }, "MY_API_KEY"],
    ["a key sync does not carry", { SOME_SETTING: SECRET }, "SOME_SETTING"],
    ["an allowed key with a credential's value", { ANA_KEEP: SECRET }, "the value of ANA_KEEP"],
  ])(
    "%s in a host's settings is refused on every flag, with no ssh and its value unprinted",
    (_, settings, says) => {
      const made = fixture();
      for (const flags of [[], ["--check"], ["--yes"], ["--yes", "--force"]]) {
        const result = made.run(flags, { host: { settings } });
        expect(result.code).toBe(1);
        expect(result.err).toContain(says);
        expect(`${result.out}${result.err}`).not.toContain(SECRET);
      }
      expect(made.sshCalls()).toEqual([]);
    },
  );

  test("a shared value shaped like a credential is refused, by sync and by any remote verb", () => {
    const made = fixture();
    const env = { ANA_LOGINS: SECRET };
    const result = made.run(["--yes"], { env });
    expect(result.code).toBe(1);
    expect(result.err).toContain("the value of ANA_LOGINS");
    expect(`${result.out}${result.err}`).not.toContain(SECRET);
    const asked = made.drive(
      `import { asked } from "REPOSITORY/tools/runs/hosts.ts";
import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts";
await asked(["status"], hostsOf(), "configured");`,
      made.environment({}, env),
    );
    expect(asked.code).not.toBe(0);
    expect(`${asked.out}${asked.err}`).not.toContain(SECRET);
    expect(made.sshCalls()).toEqual([]);
  });

  test("credentials in this process's environment reach no line and no ssh argument", () => {
    const made = fixture();
    const env = {
      ANA_LOGINS: "2",
      ANA_PYTHON: VERSION,
      CLAUDE_CODE_OAUTH_TOKEN: SECRET,
      CLAUDE_CODE_OAUTH_TOKEN2: SECRET,
    };
    const result = made.run(["--yes"], { env, host: { checks: 1 } });
    expect(`${result.out}${result.err}`).not.toContain(SECRET);
    const words = made.sshCalls().flatMap((call) => call.args);
    expect(words.length).toBeGreaterThan(0);
    expect(words.join("\n")).not.toContain(SECRET);
    expect(words.join("\n")).not.toContain("OAUTH");
  });
});

describe("python", () => {
  const pin = { ANA_PYTHON: VERSION, ANA_PYTHON_PACKAGES: "uv==0.1" };

  test("a dry run names the move and installs nothing; --yes pins it and hostPython reads the pin", () => {
    const made = fixture();
    const dry = made.run([], { env: pin });
    expect(dry.out).toContain(`wants ${VERSION} with pip, uv==0.1`);
    expect(dry.out).toContain("uv 9.9.9");
    expect(made.uvCalls()).not.toContain("python install");
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);

    const applied = made.run(["--yes"], { env: pin });
    expect(applied.out).toContain("every machine is in step");
    expect(applied.code).toBe(0);
    expect(lstatSync(pinnedPythonDir(made.peerHome)).isSymbolicLink()).toBe(true);
    expect(hostPython([pinnedPythonDir(made.peerHome)])).toEqual({
      version: VERSION,
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

  test("no packages named means none but pip enforced, and a package nobody named stays and is reported", () => {
    const made = fixture();
    const version = { ANA_PYTHON: VERSION };
    expect(made.run(["--yes"], { env: version }).out).toContain("every machine is in step");
    const pinned = join(made.peerHome, `.local/share/ana-python/versions/cpython-${VERSION}-stand-in`);
    writeFileSync(join(pinned, "packages"), "pip==1.0\nextra==2\n");
    const result = made.run(["--check"], { env: version });
    expect(result.code).toBe(0);
    expect(result.out).toContain("extra==2");
    expect(readFileSync(join(pinned, "packages"), "utf8")).toContain("extra==2");
  });

  test("a pin that lacks pip lacks something, and a package's name compares as Python's packaging does", () => {
    const made = fixture();
    const named = { ...pin, ANA_PYTHON_PACKAGES: "typing_extensions" };
    expect(made.run(["--yes"], { env: named }).code).toBe(0);
    const pinned = join(made.peerHome, `.local/share/ana-python/versions/cpython-${VERSION}-stand-in`);
    writeFileSync(join(pinned, "packages"), "pip==1.0\ntyping-extensions==4.1\n");
    expect(made.run(["--check"], { env: named }).code).toBe(0);
    writeFileSync(join(pinned, "packages"), "typing-extensions==4.1\n");
    const lacking = made.run(["--check"], { env: named });
    expect(lacking.code).toBe(1);
    expect(lacking.out).toContain("lacks pip");
    writeFileSync(join(pinned, "packages"), "pip==1.0\nuv==0.2\n");
    const stale = made.run(["--check"], { env: pin });
    expect(stale.code).toBe(1);
    expect(stale.out).toContain("lacks uv==0.1");
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

  test("a host with no uv is refused, and force does not pass it", () => {
    const made = fixture();
    const fleet = { env: { HOME: made.peerHome, FAKE_UV_ABSENT: "1" } };
    const none = made.run(["--yes", "--force"], { env: pin, fleet });
    expect(none.code).toBe(1);
    expect(none.out).toContain("no uv");
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);
  });

  test("a version uv does not offer fails in uv's words and the link stays, and the second read says so", () => {
    const made = fixture();
    const dry = made.run([], { env: { ...pin, FAKE_UV_OFFERS: "no" } });
    expect(dry.code).toBe(0);
    const failed = made.run(["--yes", "--force"], { env: { ...pin, FAKE_UV_OFFERS: "no" } });
    expect(failed.code).toBe(1);
    expect(`${failed.out}${failed.err}`).toContain(`No download found for ${VERSION}`);
    expect(failed.out).toContain("failed");
    expect(failed.out).toContain("left after applying");
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);
  });

  test("what an apply that exits 0 did not do is read again and exits 1", () => {
    const made = fixture();
    const failed = made.run(["--yes"], { env: { ...pin, FAKE_UV_PIP: "skip" } });
    expect(failed.code).toBe(1);
    expect(failed.out).toContain("left after applying");
    expect(failed.out).toContain("lacks uv==0.1");
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
    expect(made.run([], { env: { ANA_PYTHON: VERSION, ANA_PYTHON_PACKAGES: "uv;rm" } }).err).toContain(
      "uv;rm",
    );
    expect(made.sshCalls()).toEqual([]);
  });
});

describe("runner", () => {
  /** A runner installed by an older commit, in `home`. */
  function stale(home: string): void {
    const dir = join(home, ".local/share/ana-runner");
    mkdirSync(dir, { recursive: true });
    for (const name of ["task.sh", "run.js"]) writeFileSync(join(dir, name), "old\n");
    writeFileSync(join(home, ".local/bin/bun"), "old\n");
    writeFileSync(join(dir, "INSTALLED"), '{"commit":"oldcommit"}');
  }

  test("a stale runner here is reinstalled whether or not a host sets checks, and a peer with no runner is left with none", () => {
    const made = fixture();
    stale(made.hereHome);
    const found = made.run([]);
    expect(found.out).toContain("installed from oldcommit");
    expect(readFileSync(join(made.hereHome, ".local/share/ana-runner/task.sh"), "utf8")).toBe("old\n");
    made.run(["--yes"]);
    expect(readFileSync(join(made.hereHome, ".local/share/ana-runner/task.sh"), "utf8")).not.toBe("old\n");
    expect(existsSync(join(made.peerHome, ".local/share/ana-runner"))).toBe(false);
  });

  test("a peer's stale runner is named, and no receipt means no runner to keep", () => {
    const made = fixture();
    stale(made.peerHome);
    const dry = made.run([], { host: { checks: 2 } });
    expect(dry.out).toContain("installed from oldcommit");
    expect(made.run(["--check"], { host: { checks: 2 } }).code).toBe(1);
    const quiet = fixture();
    expect(quiet.run(["--check"], { host: { checks: 2 } }).code).toBe(0);
  });

  test("a commit whose runner source is the same reads as the same runner, and any other as lagging", () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "ana-sync-runner-")));
    fixtures.push({ root: repo });
    const commit = (path: string, text: string) => {
      mkdirSync(join(repo, path, ".."), { recursive: true });
      writeFileSync(join(repo, path), text);
      gitText(repo, "add", "-A");
      gitText(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", path);
      return gitText(repo, "rev-parse", "HEAD");
    };
    gitText(repo, "init", "-q");
    const first = commit("tools/runtime/router/run.ts", "one\n");
    const moved = commit("tools/runtime/router/run.ts", "two\n");
    commit("README.md", "elsewhere\n");
    expect(runnerLags(repo, moved)).toBe(false);
    expect(runnerLags(repo, first)).toBe(true);
    expect(runnerLags(repo, `${moved}, dirty`)).toBe(true);
    expect(runnerLags(repo, "an unknown commit")).toBe(true);
  });
});

describe("the table of tools", () => {
  const INSTALL = `printf '#!/bin/sh\\necho mytool 2.0.0\\n' > "$HOME/.local/bin/mytool"; chmod +x "$HOME/.local/bin/mytool"`;
  interface Row {
    readonly read?: string;
    readonly run?: string;
    readonly install?: string | undefined;
    readonly seats?: boolean;
  }
  const table = (row: Row = {}) => ({
    ANA_TOOLS: capturedJsonStringify({ mytool: { version: "2.0.0", install: INSTALL, ...row } }) ?? "",
  });
  /** The stand-in `mytool` in `home`, at `version`. */
  const held = (home: string, version: string) =>
    script(join(home, ".local/bin/mytool"), `#!/bin/sh\necho "mytool ${version} (stand-in)"\n`);
  const version = (home: string) => readFileSync(join(home, ".local/bin/mytool"), "utf8");
  const live = { active: capturedJsonStringify([{ name: "live-one", login: "2" }]) };
  const asked = (made: ReturnType<typeof fixture>) =>
    made.sshCalls().some((call) => call.args.at(-1)?.includes("active") === true);

  test("a dry run names a host's drift and changes nothing; --check exits 1; --yes brings it to the table", () => {
    const made = fixture();
    held(made.hereHome, "2.0.0");
    held(made.peerHome, "1.0.0");
    const env = table();
    const dry = made.run([], { env });
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("mytool 1.0.0");
    expect(dry.out).toContain("2.0.0");
    expect(version(made.peerHome)).toContain("1.0.0");
    expect(made.run(["--check"], { env }).code).toBe(1);
    const applied = made.run(["--yes"], { env });
    expect(applied.out).toContain("every machine is in step");
    expect(applied.code).toBe(0);
    expect(version(made.peerHome)).toContain("2.0.0");
    expect(made.run(["--check"], { env }).code).toBe(0);
  });

  test("a tool a host does not hold is named as absent, and --yes installs it", () => {
    const made = fixture();
    held(made.hereHome, "2.0.0");
    const env = table();
    expect(made.run([], { env }).out).toContain("mytool absent");
    expect(made.run(["--yes"], { env }).code).toBe(0);
    expect(version(made.peerHome)).toContain("2.0.0");
  });

  test("a version compares whole: 2.0.0 is neither 12.0.0 nor 2.0.01", () => {
    const made = fixture();
    held(made.hereHome, "2.0.0");
    for (const near of ["12.0.0", "2.0.01"]) {
      held(made.peerHome, near);
      expect(made.run(["--check"], { env: table({ install: undefined }) }).code).toBe(1);
    }
  });

  // Added while production was being written, on the 5 November reading that one host's wall found
  // node 26.10.0 and its login shell 24.22.1.
  test("the probe's path is the wall's own on this machine, with no empty folder", () => {
    const said = decodeOutput(runSync(["/bin/sh", "-c", `printf %s ${WALL_PATH}`]).stdout).split(":");
    expect(said).not.toContain("");
    expect([...new Set(said)].filter((dir) => existsSync(dir))).toEqual(toolchainPathDirs());
  });

  test("a seat's row reads what the wall finds, and a login shell's other copy is none of it", () => {
    const made = fixture();
    const login = join(made.root, "bin", "mytool");
    held(made.hereHome, "2.0.0");
    held(made.peerHome, "2.0.0");
    script(login, `#!/bin/sh\necho "mytool 9.9.9 (login shell)"\n`);
    expect(made.run(["--check"], { env: table() }).code).toBe(0);
    for (const home of [made.hereHome, made.peerHome]) rmSync(join(home, ".local/bin/mytool"));
    script(login, `#!/bin/sh\necho "mytool 2.0.0 (login shell)"\n`);
    const seat = made.run(["--check"], { env: table() });
    expect(seat.code).toBe(1);
    expect(seat.out).toContain("mytool absent");
    expect(made.run(["--check"], { env: table({ seats: false }) }).code).toBe(0);
  });

  // Added while production was being written, on the 5 November reading that a guard copied to another
  // host named the first host's home and exited 2 on every command, with its version reading right.
  test("a tool that fails its run is drift at the right version, and --yes brings it back", () => {
    const made = fixture();
    const broken = `#!/bin/sh\n[ "$1" = check ] && exit 2\necho "mytool 2.0.0 (stand-in)"\n`;
    for (const home of [made.hereHome, made.peerHome]) script(join(home, ".local/bin/mytool"), broken);
    const env = table({ run: "mytool check" });
    expect(made.run(["--check"], { env: table() }).code).toBe(0);
    const dry = made.run([], { env });
    expect(dry.out).toContain("mytool does-not-run, wants 2.0.0");
    expect(made.run(["--check"], { env }).code).toBe(1);
    expect(made.run(["--yes"], { env }).code).toBe(0);
    expect(made.run(["--check"], { env }).code).toBe(0);
  });

  test("a row's own read says where its version is", () => {
    const made = fixture();
    for (const home of [made.hereHome, made.peerHome]) {
      script(join(home, ".local/bin/mytool"), `#!/bin/sh\n[ "$1" = version ] && echo 2.0.0\n`);
    }
    const env = table({ read: "mytool version" });
    expect(made.run(["--check"], { env }).code).toBe(0);
  });

  test("a change a seat would find is refused on a host with a live campaign, and names the run", () => {
    const made = fixture();
    held(made.hereHome, "2.0.0");
    held(made.peerHome, "1.0.0");
    const env = table();
    for (const flags of [[], ["--yes"]]) {
      const result = made.run(flags, { env, fleet: { active: live.active } });
      expect(result.out).toContain("refused: 1 live: live-one");
      expect(version(made.peerHome)).toContain("1.0.0");
    }
    expect(made.run(["--yes"], { env, fleet: { active: live.active } }).code).toBe(1);
    const unread = made.run(["--yes"], { env, fleet: { active: "no json" } });
    expect(unread.code).toBe(1);
    expect(unread.out).toContain("could not be counted");
    expect(version(made.peerHome)).toContain("1.0.0");
    const forced = made.run(["--yes", "--force"], { env, fleet: { active: live.active } });
    expect(forced.out).toContain("--force, under 1 live: live-one");
    expect(version(made.peerHome)).toContain("2.0.0");
  });

  test("a live campaign on one host holds back no other host", () => {
    const made = fixture();
    held(made.hereHome, "1.0.0");
    held(made.peerHome, "2.0.0");
    const env = table();
    const result = made.run(["--yes"], { env, fleet: { active: live.active } });
    expect(result.code).toBe(0);
    expect(version(made.hereHome)).toContain("2.0.0");
  });

  test("a row no seat finds applies under a live campaign and asks no live count", () => {
    const made = fixture();
    held(made.hereHome, "2.0.0");
    held(made.peerHome, "1.0.0");
    const result = made.run(["--yes"], { env: table({ seats: false }), fleet: { active: live.active } });
    expect(result.code).toBe(0);
    expect(version(made.peerHome)).toContain("2.0.0");
    expect(asked(made)).toBe(false);
  });

  test("a tool a host excludes is reported as excluded, is no drift, and is never changed", () => {
    const made = fixture();
    held(made.hereHome, "2.0.0");
    held(made.peerHome, "1.0.0");
    const env = table();
    const host = { exclude: ["mytool"] };
    const dry = made.run([], { env, host });
    expect(dry.out).toContain("excluded");
    expect(dry.out).toContain("mytool 1.0.0");
    expect(made.run(["--check"], { env, host }).code).toBe(0);
    expect(made.run(["--yes", "--force"], { env, host }).code).toBe(0);
    expect(version(made.peerHome)).toContain("1.0.0");
  });

  test("a row with no install is drift to report, and --yes runs nothing and exits 1", () => {
    const made = fixture();
    held(made.hereHome, "2.0.0");
    held(made.peerHome, "1.0.0");
    const env = table({ install: undefined });
    const result = made.run(["--yes", "--force"], { env });
    expect(result.code).toBe(1);
    expect(result.out).toContain("no install");
    expect(version(made.peerHome)).toContain("1.0.0");
  });

  test("an install that fails says so, and the second read reports what is left", () => {
    const made = fixture();
    held(made.hereHome, "2.0.0");
    held(made.peerHome, "1.0.0");
    const result = made.run(["--yes"], { env: table({ install: "exit 7" }) });
    expect(result.code).toBe(1);
    expect(result.out).toContain("exit 7");
    expect(result.out).toContain("left after applying");
  });

  test("a table alone, with no hosts, applies here and asks nothing of ssh, and a verb sent here does neither", () => {
    const made = fixture();
    held(made.hereHome, "1.0.0");
    const sent = made.run(["--yes"], { env: { ...table(), ANA_HOSTS: "", ANA_HOP: "1" } });
    expect(sent.out).toContain("nothing to do");
    expect(version(made.hereHome)).toContain("1.0.0");
    const alone = made.run(["--yes"], { env: { ...table(), ANA_HOSTS: "" } });
    expect(alone.code).toBe(0);
    expect(version(made.hereHome)).toContain("2.0.0");
    expect(made.sshCalls()).toEqual([]);
  });

  test("a table that cannot be read is refused before anything runs, and a credential in it stays unprinted", () => {
    const made = fixture();
    for (const [text, says] of [
      ["no json", "ANA_TOOLS is not JSON"],
      ["[]", "ANA_TOOLS takes"],
      ['{"mytool":{}}', "mytool"],
      ['{"a;rm":{"version":"1.0.0"}}', "a;rm"],
      ['{"mytool":{"version":1}}', "mytool"],
      ['{"mytool":{"version":"1.0.0","seats":"no"}}', "mytool"],
      [
        capturedJsonStringify({ mytool: { version: "1.0.0", install: `curl -H ${SECRET}` } }) ?? "",
        "credential",
      ],
    ] as const) {
      const result = made.run(["--yes", "--force"], { env: { ANA_TOOLS: text } });
      expect([text, result.code]).toEqual([text, 1]);
      expect(result.err).toContain(says);
      expect(`${result.out}${result.err}`).not.toContain(SECRET);
    }
    expect(made.sshCalls()).toEqual([]);
  });

  test("an entry's exclude takes a list of names", () => {
    const made = fixture();
    const result = made.run([], { host: { exclude: "mytool" } });
    expect(result.code).toBe(1);
    expect(result.err).toContain("exclude");
  });
});

describe("a host that does not answer", () => {
  test("is named, counts for --check and --yes, and is not written to", () => {
    const made = fixture();
    const fleet = { offline: true };
    expect(made.run([], { fleet }).out).toContain("no answer");
    expect(made.run([], { fleet }).code).toBe(0);
    expect(made.run(["--check"], { fleet }).code).toBe(1);
    expect(made.run(["--yes"], { fleet }).code).toBe(1);
  });

  test("stdout that is no answer is none", () => {
    const made = fixture();
    const fleet = { execute: false };
    const result = made.run(["--check"], { fleet });
    expect(result.code).toBe(1);
    expect(result.out).toContain("no answer");
  });

  test("--yes with --check is refused before anything is asked", () => {
    const made = fixture();
    expect(made.run(["--yes", "--check"]).err).toContain("--check changes nothing");
    expect(made.sshCalls()).toEqual([]);
  });
});
