// The fleet boundary through executable command fakes, with a hostile case beside each behaviour.
import { afterAll, describe, expect, it } from "bun:test";
import { append } from "../src/kernel/log.ts";
import {
  closeSync,
  existsSync,
  fstatSync,
  lockExclusiveSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { quoted, treeBun } from "../tools/runs/host-command.ts";

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
function campaign() {
  const made = fixture();
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
  return { made, log, env: { FAKE_CATALOGUE: JSON.stringify([{ name: "distant", path: log }]) } };
}

describe("host execution", () => {
  it("keeps a verb that names this machine here while a peer is down, and asks the peers otherwise", () => {
    const made = fixture();
    const routing = (args: string) =>
      made.run(
        `import { routed } from "REPOSITORY/tools/runs/hosts.ts"; const r = await routed("keep", ${args}); console.log(JSON.stringify([r.here, r.away.length]));`,
        { FAKE_OFFLINE: "1" },
      );
    const kept = routing('["far", "--here"]');
    expect(kept.code).toBe(0);
    expect(JSON.parse(kept.out)).toEqual([["far", "--here"], 0]);
    expect(made.recorded().filter((call) => call.tool === "ssh")).toEqual([]);
    expect(routing('["far"]').code).toBe(1);
    expect(made.recorded().filter((call) => call.tool === "ssh").length).toBeGreaterThan(0);
  });

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
    expect(command).toContain("ANA_HOP=1");
    expect(command).not.toContain("ANA_HOSTS");
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

  it("refuses an unsafe or repeated host identity before invoking ssh", () => {
    const made = fixture();
    for (const entries of [
      [made.host, made.host],
      [{ name: "../outside" }],
      [{ name: "here" }],
      [{ name: "runner", ssh: "-oProxyCommand=x", tree: "/fake", bun: "bun" }],
    ]) {
      expect(
        made.run('import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; hostsOf();', {
          ANA_HOSTS: JSON.stringify(entries),
        }).code,
      ).toBe(1);
      expect(made.recorded()).toHaveLength(0);
    }
  });

  it("lists no host to a verb another host sent, and every host otherwise", () => {
    const made = fixture();
    const code =
      'import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; console.log(hostsOf().length);';
    expect(made.run(code).out.trim()).toBe("1");
    expect(made.run(code, { ANA_HOP: "1" }).out.trim()).toBe("0");
    // A worktree without `.env.runs` reads an empty list, and the refusal said "names" and nothing.
    const named = 'import { hostNamed } from "REPOSITORY/tools/runs/host-config.ts"; hostNamed("runner");';
    expect(made.run(named, { ANA_HOSTS: "[]" }).err).toContain("ANA_HOSTS names none here");
  });

  it("names the central host only where ANA_HOSTS lists it", () => {
    const made = fixture();
    const code =
      'import { centralOf } from "REPOSITORY/tools/runs/host-config.ts"; console.log(centralOf());';
    expect(made.run(code, { ANA_CENTRAL: "" }).out).toContain("null");
    expect(made.run(code, { ANA_CENTRAL: "here" }).out).toContain("here");
    expect(made.run(code, { ANA_CENTRAL: made.host.name }).out).toContain(made.host.name);
    expect(made.run(code, { ANA_CENTRAL: "elsewhere" }).code).toBe(1);
  });
});

describe("code preparation", () => {
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
      'import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "--model", "gpt", "--as", "terra", "--host", "runner", "--yes", "--", "--at", "campaign-value"]);',
    );
    expect(real.code).toBe(0);
    const command =
      made
        .recorded()
        .findLast((call) => call.tool === "ssh")
        ?.args.at(-1) ?? "";
    expect(command).toContain("campaign-value");
    expect(command).toContain("prepared");
    expect(command).toMatch(/--placed\W+--yes/);
    // On 27 October `--as terra` sent to two hosts opened one name on each, since each peer's
    // `freeName` reads its own names alone: the host goes into the suffix.
    expect(command).toMatch(/--as\W+terra-runner\W/);
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

describe("campaign snapshots", () => {
  it("refreshes a remote campaign and publishes whole lines in the existing archive", () => {
    const remote = campaign();
    const { made } = remote;
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

  it("waits for a live descriptor holder despite a stale PID, then takes over the lock a dead fetch left", async () => {
    const remote = campaign();
    const { made } = remote;
    const lock = join(made.main, "data", "runs", "runner", ".fetch-distant.lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), String(Bun.spawnSync(["true"]).pid));
    const ready = join(made.root, "reader-ready");
    const script = join(made.root, "reader.ts");
    const copied = join(made.main, "data", "runs", "runner", "distant", "log.jsonl");
    writeFileSync(
      script,
      `await Bun.write(${JSON.stringify(ready)}, "ready");\n${sync.replaceAll("REPOSITORY/", `${join(import.meta.dir, "..")}/`)}`,
    );
    const fd = openSync(lock, "r");
    lockExclusiveSync(fd);
    const reader = Bun.spawn([process.execPath, script], {
      cwd: made.main,
      env: { ...made.env, ...remote.env },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const started = performance.now() + 5000;
      while (!existsSync(ready) && performance.now() < started) await Bun.sleep(5);
      expect(existsSync(ready)).toBe(true);
      const deadline = performance.now() + 1500;
      while (!existsSync(copied) && performance.now() < deadline) await Bun.sleep(5);
      expect(existsSync(copied)).toBe(false);
      expect(existsSync(lock) && statSync(lock).ino === fstatSync(fd).ino).toBe(true);
    } finally {
      closeSync(fd);
      const code = await reader.exited;
      expect({ code, err: await new Response(reader.stderr).text() }).toEqual({ code: 0, err: "" });
    }
    expect(readFileSync(copied, "utf8")).toBe(readFileSync(remote.log, "utf8"));
    expect(existsSync(lock)).toBe(true);
  });

  it("serialises refreshes in one process and releases a failed refresh", () => {
    const remote = campaign();
    const { made } = remote;
    const result = made.run(
      'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; process.env.FAKE_TRANSFER_FAIL = "1"; await syncRuns(["distant"]).catch(() => undefined); delete process.env.FAKE_TRANSFER_FAIL; await Promise.all(Array.from({length: 3}, () => syncRuns(["distant"])));',
      remote.env,
    );
    expect({ code: result.code, err: result.err }).toEqual({ code: 0, err: "" });
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(4);
  });

  it("refuses ambiguity in an exact read, an unavailable catalogue and unsafe paths, and reads one copy in a collection", () => {
    const remote = campaign();
    const { made } = remote;
    const duplicate = {
      FAKE_CATALOGUE: JSON.stringify([
        { name: "distant", path: remote.log },
        { name: "distant", path: remote.log },
      ]),
    };
    for (const extra of [
      duplicate,
      { FAKE_CATALOGUE: JSON.stringify([{ name: "../escape", path: remote.log }]) },
    ]) {
      expect(made.run(sync, extra).code).toBe(1);
    }
    const silent = made.run(sync, { FAKE_OFFLINE: "1" });
    expect(silent.code).toBe(0);
    expect(silent.err).toContain("runner: no campaign catalogue");
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(0);
    const collection = made.run(sync.replace('{match:"exact"}', "{}"), duplicate);
    expect(collection.code).toBe(0);
    expect(collection.err).toContain("distant");
    expect(collection.err).toContain("runner");
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(1);
  });

  it("lets a silent host spoil only its own copies, and a verb on a run held here go on without it", () => {
    const remote = campaign();
    const { made } = remote;
    const other = { ...made.host, name: "other", ssh: "fake-other" };
    const two = { ANA_HOSTS: JSON.stringify([made.host, other]) };
    const quiet = (ssh: string, catalogue: unknown[]) =>
      JSON.stringify({
        [ssh]: { offline: true },
        [ssh === "fake-other" ? "fake-runner" : "fake-other"]: { catalogue },
      });
    const collection = made.run(sync.replace('{match:"exact"}', "{}"), {
      ...two,
      FAKE_FLEET: quiet("fake-other", [{ name: "distant", path: remote.log }]),
    });
    expect(collection.code).toBe(0);
    expect(collection.err).toContain("other: no campaign catalogue");
    const copied = join(made.main, "data", "runs", "runner", "distant", "log.jsonl");
    expect(readFileSync(copied, "utf8")).toBe(readFileSync(remote.log, "utf8"));
    const kept = made.run(
      'import { readAcross } from "REPOSITORY/tools/runs/snapshots.ts"; console.log((await readAcross("distant")).path);',
      { ...two, FAKE_FLEET: quiet("fake-runner", []) },
    );
    expect({ code: kept.code, out: kept.out.trim() }).toEqual({ code: 0, out: copied });
    const near = join(made.main, ".ana", "d2", "near");
    mkdirSync(near, { recursive: true });
    append(join(near, "log.jsonl"), "campaign.ended", { ending: "finished" });
    const routing = (name: string) =>
      made.run(
        `import { routed } from "REPOSITORY/tools/runs/hosts.ts"; console.log(JSON.stringify((await routed("stop", ["${name}"])).here));`,
        { ...two, FAKE_FLEET: quiet("fake-other", []) },
      );
    expect(JSON.parse(routing("near").out)).toEqual(["near"]);
    expect(routing("far").code).toBe(1);
  });
});

describe("named snapshot readers", () => {
  it("lets view, source, replay, zip, WRI and harness audit read a campaign by name", () => {
    const remote = campaign();
    const { made } = remote;
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
      ["distant"],
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
  it("retains artefacts on a record refresh, brings a seed's mark, and fetches them afresh for a named log", () => {
    const remote = campaign();
    const { made } = remote;
    const memory = join(made.root, "remote", "distant", "memory");
    mkdirSync(memory);
    writeFileSync(join(memory, "note.txt"), "before");
    expect(made.run(sync, remote.env).code).toBe(0);
    writeFileSync(join(memory, "note.txt"), "after");
    // A record refresh runs only where the log grew.
    append(remote.log, "campaign.word", { stop: "fixture" });
    writeFileSync(join(made.root, "remote", "distant", "seed.json"), "{}");
    const transfers = () => made.recorded().filter((call) => call.tool === "rsync").length;
    const before = transfers();
    expect(
      made.run(
        'import { readAcross } from "REPOSITORY/tools/runs/snapshots.ts"; await readAcross("distant");',
        remote.env,
      ).code,
    ).toBe(0);
    // One transfer of the record, and no copy of the folder to keep what it holds besides.
    expect(transfers() - before).toBe(1);
    const copied = join(made.main, "data", "runs", "runner", "distant", "memory", "note.txt");
    expect(readFileSync(copied, "utf8")).toBe("before");
    // A copy of a seed reads as one, so no reader counts it as a paid campaign.
    expect(existsSync(join(made.main, "data", "runs", "runner", "distant", "seed.json"))).toBe(true);
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
