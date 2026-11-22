// `bun run runs sync` and the settings every remote verb carries, against a fake ssh that runs each
// script in a temporary peer, with a stand-in `uv` and Python. What it must never do is the point of
// most cases: try ssh with no host, carry a credential, or move a Python under a live campaign.
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { gitText } from "../src/meta/git.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import { join } from "../src/meta/path.ts";
import { pinnedPythonDir } from "../src/wall/policy.ts";
import type { Host } from "../tools/runs/host-config.ts";
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
    dir="$UV_PYTHON_INSTALL_DIR/cpython-$last-stand-in/bin"
    # As uv does, a version already installed is left as it is.
    [ -x "$dir/python3" ] && exit 0
    mkdir -p "$dir"
    echo pip==1.0 > "$dir/../packages"
    printf '%s' "$last" > "$dir/../version"
    cp "$FAKE_PYTHON" "$dir/python3"
    chmod +x "$dir/python3"
    ;;
  *"python find"*)
    for last; do :; done
    echo "$UV_PYTHON_INSTALL_DIR/cpython-$last-stand-in/bin/python3"
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

  test("a value with a dollar, a hash or a quote reads back whole", () => {
    const value = String.raw`a $HOME #kept 'quoted' \ b`;
    expect(sent({}, { ANA_LOGINS: value }).ANA_LOGINS).toBe(value);
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
  const pin = { ANA_PYTHON: VERSION };

  test("a move under a live campaign is refused and names it, and --force passes and says so", () => {
    const made = fixture();
    const fleet = { active: capturedJsonStringify([{ name: "live-one", login: "2" }]) };
    for (const flags of [[], ["--yes"]]) {
      const result = made.run(flags, { env: pin, fleet });
      expect(result.out).toContain("refused: 1 live: live-one");
      expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);
    }
    expect(made.run(["--yes"], { env: pin, fleet }).code).toBe(1);
    // A live count it cannot read refuses as a live campaign does.
    const unread = made.run(["--yes"], { env: pin, fleet: { active: "no json" } });
    expect([unread.code, unread.out.includes("could not be counted")]).toEqual([1, true]);
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);
    const forced = made.run(["--yes", "--force"], { env: pin, fleet });
    expect(forced.out).toContain("--force, under 1 live: live-one");
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(true);
  });

  test("a host with no uv is refused, and force does not pass it", () => {
    const made = fixture();
    const fleet = { env: { HOME: made.peerHome, FAKE_UV_ABSENT: "1" } };
    const none = made.run(["--yes", "--force"], { env: pin, fleet });
    expect(none.code).toBe(1);
    expect(none.out).toContain("no uv");
    expect(existsSync(pinnedPythonDir(made.peerHome))).toBe(false);
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
});

describe("a host that does not answer", () => {
  test("--yes with --check is refused before anything is asked", () => {
    const made = fixture();
    expect(made.run(["--yes", "--check"]).err).toContain("--check changes nothing");
    expect(made.sshCalls()).toEqual([]);
  });
});
