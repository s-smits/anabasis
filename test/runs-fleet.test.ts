// The fleet boundary through executable command fakes, with a hostile case beside each behaviour.
import { afterAll, describe, expect, it } from "bun:test";
import { append } from "../src/kernel/log.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { quoted, treeBun } from "../tools/runs/host-command.ts";
import { leastOccupied } from "../tools/runs/placement.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const fixtures: string[] = [];
const prepare =
  'import { preparedHost } from "REPOSITORY/tools/runs/code.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; console.log(preparedHost(hostsOf()[0]!, process.env.FAKE_COMMIT!));';
const sync =
  'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; console.log(await syncRuns(["distant"], {match:"exact"}));';

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});
const fixture = () => {
  const made = fakeHosts();
  fixtures.push(made.root);
  return made;
};
/** A remote campaign fixture, its events written by the log's owner. */
function campaign(made: ReturnType<typeof fakeHosts>) {
  const folder = join(made.root, "remote", "distant");
  mkdirSync(folder, { recursive: true });
  const log = join(folder, "log.jsonl");
  append(log, "campaign.ended", { ending: "finished", why: "fixture" });
  writeFileSync(
    join(folder, "launch-run-1.json"),
    JSON.stringify({
      at: new Date().toISOString(),
      pid: 42,
      flags: [],
      envFile: null,
      commit: made.commit,
      dirty: false,
      load: 0,
      cores: 2,
    }),
  );
  return { log, env: { FAKE_CATALOGUE: JSON.stringify([{ name: "distant", path: log }]) } };
}

describe("host execution", () => {
  it("keeps paths and arguments literal and clears the peer list for any repository script", () => {
    const made = fixture();
    const result = made.run(
      'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; process.exit(await scriptOn(hostsOf()[0]!, ".claude/skills/example/scripts/cycle.ts", ["--here", "a; $(touch forbidden)", "quote\u0027s"]));',
      { FAKE_EXECUTE: "1" },
    );
    expect(result.code).toBe(0);
    const command =
      made
        .recorded()
        .findLast((call) => call.tool === "ssh")
        ?.args.at(-1) ?? "";
    expect(command).toContain("ANA_HOSTS");
    expect(command).toContain("example/scripts/cycle.ts");
    expect(command).toContain("touch forbidden");
    expect(existsSync(join(made.main, "forbidden"))).toBe(false);
    expect(
      made
        .recorded()
        .findLast((call) => call.tool === "host-bun")
        ?.args.slice(-3),
    ).toEqual(["--here", "a; $(touch forbidden)", "quote's"]);
    expect(
      made.run(
        'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/example.ts", []);',
        { FAKE_EXECUTE: "1" },
      ).code,
    ).toBe(0);
    expect(made.recorded().filter((call) => call.tool === "git" && call.args.includes("fetch"))).toHaveLength(
      1,
    );
    const refused = made.run(
      'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/../escape.ts", []);',
    );
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("repository-relative");
    const tree = join(made.root, "tree $(touch forbidden) '");
    mkdirSync(tree);
    const envFile = join(tree, "credentials file");
    const paths = made.run(
      'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/example.ts", []);',
      {
        FAKE_EXECUTE: "1",
        ANA_HOSTS: JSON.stringify([{ ...made.host, tree, envFiles: [envFile] }]),
      },
    );
    expect(paths.code).toBe(0);
    expect(made.recorded().findLast((call) => call.tool === "host-bun")?.args).toContain(
      `--env-file=${envFile}`,
    );
    expect(existsSync(join(made.main, "forbidden"))).toBe(false);
  });

  it("runs a host's tree under the Bun it pins where that host holds the release", () => {
    const made = fixture();
    const tree = join(made.root, "pinned tree");
    mkdirSync(tree);
    writeFileSync(join(tree, "package.json"), '{ "packageManager": "bun@9.9.9" }');
    const home = join(made.root, "home");
    const chosen = () =>
      decodeOutput(
        runSync(["sh", "-c", `cd ${quoted(tree)} && echo ${treeBun("/configured bun")}`], {
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        }).stdout,
      ).trim();
    expect(chosen()).toBe("/configured bun");
    const release = join(home, ".bun", "releases", "9.9.9", "bin");
    mkdirSync(release, { recursive: true });
    symlinkSync(join(made.root, "bin", "host-bun"), join(release, "bun"));
    expect(chosen()).toBe(join(release, "bun"));
  });

  it("lets a skill ask every host through the bounded shared transport", () => {
    const made = fixture();
    const code =
      'import { askedScript } from "REPOSITORY/tools/runs/hosts.ts"; console.log(await askedScript(".claude/skills/example/scripts/cycle.ts", ["--here"]));';
    const hosts = JSON.stringify([made.host, { ...made.host, name: "other", ssh: "fake-other" }]);
    const result = made.run(code, { ANA_HOSTS: hosts });
    expect(result.code).toBe(0);
    expect(made.recorded().filter((call) => call.tool === "ssh")).toHaveLength(4);
    expect(result.out).toContain("other");
    const failed = made.run(code, { FAKE_OFFLINE: "1" });
    expect(failed.out).toContain("null");
    expect(failed.err).toContain("controller preparation failed");
  });

  it("refuses a mutating route when a host is unavailable or also claims the local name", () => {
    const made = fixture();
    const folder = join(made.main, ".ana", "d2", "distant");
    mkdirSync(folder, { recursive: true });
    append(join(folder, "log.jsonl"), "campaign.ended", { ending: "finished" });
    const code =
      'import { routed } from "REPOSITORY/tools/runs/hosts.ts"; await routed("stop", ["distant", "--yes"]);';
    expect(made.run(code, { FAKE_OFFLINE: "1" }).code).toBe(1);
    expect(made.run(code, { FAKE_HOLDS: "distant" }).code).toBe(1);
  });

  it("refuses an unsafe or repeated host identity before invoking ssh", () => {
    for (const entries of [
      [{ name: "../outside" }],
      [{ name: "here" }],
      [{ name: "runner", ssh: "-oProxyCommand=x", tree: "/fake", bun: "bun" }],
    ]) {
      const made = fixture();
      expect(
        made.run('import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; hostsOf();', {
          ANA_HOSTS: JSON.stringify(entries),
        }).code,
      ).toBe(1);
      expect(made.recorded()).toHaveLength(0);
    }
    const made = fixture();
    expect(
      made.run('import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; hostsOf();', {
        ANA_HOSTS: JSON.stringify([made.host, made.host]),
      }).code,
    ).toBe(1);
  });
});

describe("code preparation", () => {
  it("fetches and installs a detached controller while leaving the configured tree in place", () => {
    const made = fixture();
    const result = made.run(prepare, { FAKE_EXECUTE: "1" });
    expect(result.code).toBe(0);
    const calls = made
      .recorded()
      .filter((call) => call.tool === "git")
      .map((call) => call.args);
    expect(calls.some((args) => args.includes("fetch"))).toBe(true);
    expect(calls.some((args) => args.includes("add") && args.includes("--detach"))).toBe(true);
    expect(calls.some((args) => args.includes("checkout"))).toBe(false);
    expect(
      made.recorded().some((call) => call.tool === "host-bun" && call.args.includes("--frozen-lockfile")),
    ).toBe(true);
    expect(result.out).toContain("ana-code");
    expect(existsSync(join(made.main, ".env"))).toBe(false);
    expect(made.run(prepare, { FAKE_EXECUTE: "1" }).code).toBe(0);
    expect(
      made.recorded().filter((call) => call.tool === "host-bun" && call.args.includes("install")),
    ).toHaveLength(1);
  });

  it("refuses a failed fetch, an unpublished commit, a dirty controller or failed install", () => {
    for (const extra of [
      { FAKE_FETCH_FAIL: "1" },
      { FAKE_UNPUBLISHED: "1" },
      { FAKE_DIRTY: " M tracked" },
      { FAKE_INSTALL_FAIL: "1" },
    ]) {
      const made = fixture();
      expect(made.run(prepare, { FAKE_EXECUTE: "1", ...extra }).code).toBe(1);
      expect(made.recorded().some((call) => call.args.includes("tools/runs/cli.ts"))).toBe(false);
    }
    const made = fixture();
    const folder = join(made.main, ".ana", "d2", "distant");
    mkdirSync(folder, { recursive: true });
    append(join(folder, "log.jsonl"), "campaign.ended", { ending: "finished" });
    const result = made.run(
      'import { move } from "REPOSITORY/tools/runs/move.ts"; await move(["distant", "--to", "runner", "--yes"]);',
      { FAKE_EXECUTE: "1", FAKE_FETCH_FAIL: "1" },
    );
    expect(result.code).toBe(1);
    expect(
      made
        .recorded()
        .filter((call) => call.tool === "ssh")
        .some((call) => call.args.at(-1)?.includes("pause") === true),
    ).toBe(false);
    expect(existsSync(join(made.main, ".ana", "moved"))).toBe(false);
  });

  it("prepares remote fresh only with authority, pins the host, and preserves campaign flags after --", () => {
    const made = fixture();
    const dry = made.run(
      'import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "--model", "gpt", "--host", "runner"]);',
    );
    expect(dry.code).toBe(0);
    expect(made.recorded().some((call) => call.tool === "git" && call.args.includes("fetch"))).toBe(true);
    const real = made.run(
      'import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "--model", "gpt", "--host", "runner", "--yes", "--", "--at", "campaign-value"]);',
    );
    expect(real.code).toBe(0);
    const command =
      made
        .recorded()
        .findLast((call) => call.tool === "ssh")
        ?.args.at(-1) ?? "";
    expect(command).toContain("campaign-value");
    expect(command).toContain("prepared");
    expect(command).toMatch(/--host\W+here\W+--yes/);
    expect(command).toContain("ANA_RUN_CAP");
  });

  it("resolves a remote continuation's revision here and ignores a campaign's --at and --yes", () => {
    const made = fixture();
    const before =
      'import { continueOn } from "REPOSITORY/tools/runs/continuation.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts";';
    expect(
      made.run(`${before} await continueOn(hostsOf()[0]!, ["continue", "distant", "--at=HEAD", "--yes"]);`)
        .code,
    ).toBe(0);
    const calls = made.recorded().filter((call) => call.tool === "ssh");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.at(-1)).toContain(made.commit);
    const other = fixture();
    expect(
      other.run(
        `${before} await continueOn(hostsOf()[0]!, ["continue", "distant", "--", "--at", "unrelated", "--yes"]);`,
      ).code,
    ).toBe(0);
    expect(other.recorded().filter((call) => call.tool === "ssh")).toHaveLength(2);
  });
});

describe("automatic placement", () => {
  it("takes the fewest live seats below each machine's own cap and refuses a full fleet", () => {
    const made = fixture();
    expect(
      leastOccupied([
        { host: undefined, live: 2, capacity: 3 },
        { host: made.host, live: 1, capacity: 2 },
      ]),
    ).toBe(made.host);
    expect(() => leastOccupied([{ host: made.host, live: 2, capacity: 2 }])).toThrow("no host has room");
    const result = made.run(
      'import { placeFresh } from "REPOSITORY/tools/runs/placement.ts"; console.log(await placeFresh("sample"));',
      { FAKE_OFFLINE: "1" },
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain("live count");
    const malformed = made.run(
      'import { placeFresh } from "REPOSITORY/tools/runs/placement.ts"; await placeFresh("sample");',
      { FAKE_ACTIVE: "[{}]" },
    );
    expect(malformed.code).toBe(1);
  });
});

describe("campaign snapshots", () => {
  it("refreshes a remote campaign and publishes whole lines in the existing archive", () => {
    const made = fixture();
    const remote = campaign(made);
    const whole = readFileSync(remote.log, "utf8");
    writeFileSync(remote.log, `${whole}{"inFlight":`);
    const result = made.run(sync, remote.env);
    expect(result.code).toBe(0);
    const copied = join(made.main, "data", "runs", "runner", "distant", "log.jsonl");
    expect(readFileSync(copied, "utf8")).toBe(whole);
    const transfer = made.recorded().find((call) => call.tool === "rsync");
    expect(transfer?.args).toContain("--exclude=.env");
    expect(transfer?.args).toContain("--exclude=.env.*");
    expect(existsSync(join(made.main, ".ana", "d2", "distant"))).toBe(false);
    expect(made.run(sync, { ...remote.env, FAKE_TRANSFER_FAIL: "1" }).code).toBe(1);
    expect(readFileSync(copied, "utf8")).toBe(whole);
  });

  it("refuses ambiguity, an unavailable catalogue and unsafe catalogue paths without transferring", () => {
    const made = fixture();
    const remote = campaign(made);
    const duplicate = {
      FAKE_CATALOGUE: JSON.stringify([
        { name: "distant", path: remote.log },
        { name: "distant", path: remote.log },
      ]),
    };
    for (const extra of [
      duplicate,
      { FAKE_OFFLINE: "1" },
      { FAKE_CATALOGUE: JSON.stringify([{ name: "../escape", path: remote.log }]) },
    ]) {
      expect(made.run(sync, extra).code).toBe(1);
    }
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(0);
  });

  it("lets view, source, replay, zip, WRI and harness audit read a campaign by name", () => {
    const made = fixture();
    const remote = campaign(made);
    const commands = [
      'import { view } from "REPOSITORY/tools/runs/view.ts"; await view(["distant"]);',
      'import { source } from "REPOSITORY/tools/runs/receipt.ts"; await source(["distant"]);',
      'import { replay } from "REPOSITORY/tools/runs/replay.ts"; await replay(["distant"]);',
      `import { zipRuns } from "REPOSITORY/tools/runs/zip.ts"; await zipRuns(["distant", "--light", "--out", ${JSON.stringify(join(made.root, "out.zip"))}]);`,
      'process.argv = [process.argv[0]!, "REPOSITORY/tools/wri/wri.ts", "read", "--log", "distant"]; await import("REPOSITORY/tools/wri/wri.ts");',
    ];
    for (const command of commands) {
      const result = made.run(command, remote.env);
      expect({ code: result.code, err: result.err }).toEqual({ code: 0, err: "" });
    }
    const audit = made.runScript(
      ".claude/skills/harness-audit/scripts/harness-versions.ts",
      ["--name", "distant"],
      remote.env,
    );
    expect({ code: audit.code, err: audit.err }).toEqual({ code: 0, err: "" });
    const tuning = made.run(
      'import { campaignLogs } from "REPOSITORY/.claude/skills/promotion-tuner/scripts/tree.ts"; console.log(await campaignLogs(null, ["distant"], "2000"));',
      remote.env,
    );
    expect(tuning.code).toBe(0);
    expect(tuning.out).toContain("distant");
    const stale = made.run(
      'import { readAcross } from "REPOSITORY/tools/runs/snapshots.ts"; await readAcross("distant");',
      { FAKE_CATALOGUE: "[]" },
    );
    expect(stale.code).toBe(1);
    expect(stale.err).toContain("old copy");
  });
});

describe("snapshot depth", () => {
  it("retains artefacts on a record refresh and fetches them afresh for a named log", () => {
    const made = fixture();
    const remote = campaign(made);
    const memory = join(made.root, "remote", "distant", "memory");
    mkdirSync(memory);
    writeFileSync(join(memory, "note.txt"), "before");
    expect(made.run(sync, remote.env).code).toBe(0);
    writeFileSync(join(memory, "note.txt"), "after");
    expect(
      made.run(
        'import { readAcross } from "REPOSITORY/tools/runs/snapshots.ts"; await readAcross("distant");',
        remote.env,
      ).code,
    ).toBe(0);
    const copied = join(made.main, "data", "runs", "runner", "distant", "memory", "note.txt");
    expect(readFileSync(copied, "utf8")).toBe("before");
    expect(made.recorded().findLast((call) => call.tool === "rsync")?.args).toContain("--exclude=/*");
    expect(
      made.run(
        'import { logAcross } from "REPOSITORY/tools/runs/snapshots.ts"; await logAcross("distant");',
        remote.env,
      ).code,
    ).toBe(0);
    expect(readFileSync(copied, "utf8")).toBe("after");
    rmSync(remote.log);
    symlinkSync(join(memory, "note.txt"), remote.log);
    expect(made.run(sync, remote.env).code).toBe(1);
    expect(readFileSync(join(made.main, "data", "runs", "runner", "distant", "log.jsonl"), "utf8")).toContain(
      "campaign.ended",
    );
  });
});

describe("the fleet pulse", () => {
  it("polls each host once and keeps a local state path out of remote commands", () => {
    const made = fixture();
    const state = join(made.root, "state.json");
    const command = `import { watch } from "REPOSITORY/tools/runs/pulse.ts"; await watch(["--once", "--state", ${JSON.stringify(state)}]);`;
    const result = made.run(command);
    expect(result.code).toBe(0);
    expect(result.out).toContain("reported step");
    const remote =
      made
        .recorded()
        .findLast((call) => call.tool === "ssh")
        ?.args.at(-1) ?? "";
    expect(remote).not.toContain(state);
    expect(remote).toContain("--here");
    const failed = made.run(command, { FAKE_OFFLINE: "1" });
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("pulse unavailable");
    const local = fixture();
    expect(
      local.run(
        `import { watch } from "REPOSITORY/tools/runs/pulse.ts"; await watch(["--once", "--here", "--state", ${JSON.stringify(join(local.root, "local.json"))}]);`,
      ).code,
    ).toBe(0);
    expect(local.recorded().filter((call) => call.tool === "ssh")).toHaveLength(0);
  });
});
