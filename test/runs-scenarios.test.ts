// The operator's fleet workflows through public verbs. Every transport is a temporary executable.
import { afterAll, expect, it } from "bun:test";
import { append } from "../src/kernel/log.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { writeReceipt } from "../tools/runs/receipt.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const fixtures: string[] = [];
const CLI = "tools/runs/cli.ts";
const LOGIN = String(100);
const LOGINS = [LOGIN, String(101), String(102)];
const HEALTH = {
  load: 12,
  cores: 8,
  performanceCores: 4,
  charger: "AC Power connected",
  freeGiB: 1,
  freePct: 1,
  sizes: { ".ana": 1024, archive: 2048, controllers: 4096, "other worktrees": 8192 },
  bun: "fixture",
  commit: "a".repeat(40),
  ready: true,
  live: [{ name: "distant", login: null, host: "here" }],
  busiest: [{ pid: 42, cpu: 90, command: "bun", run: "distant" }],
};
const READ = `async (wanted) => wanted.map((login) => ({login,plain:false,via:"oauth-usage",notes:[],fiveHour:{pct:0,resetsAt:null},sevenDay:{pct:0,resetsAt:new Date(Date.now()+Number(login)*86400000).toISOString()}}))`;

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const made = fakeHosts();
  fixtures.push(made.root);
  const other = { ...made.host, name: "peer", ssh: "fake-peer", capacity: 1 };
  return { ...made, other };
}

function campaign(made: ReturnType<typeof fixture>, name: string, tree = join(made.root, "remote")) {
  const folder = join(tree, ".ana", "d2", name);
  mkdirSync(folder, { recursive: true });
  const log = join(folder, "log.jsonl");
  append(log, "campaign.waited", { for: "provider", until: "2099-01-01T00:00:00.000Z", ms: 60_000 });
  writeReceipt(log, "run-1", {
    at: new Date().toISOString(),
    pid: 42,
    flags: [],
    envFile: null,
    commit: made.commit,
    dirty: false,
    load: 0,
    cores: 2,
  });
  return { folder, log, tree };
}

function catalogue(made: ReturnType<typeof fixture>, packs: readonly string[]) {
  return packs.map((pack, index) => ({
    name: `prior-${String(index)}`,
    path: `${made.root}/prior-${String(index)}/log.jsonl`,
    project: `${pack}-fresh`,
  }));
}

it("S1: one health command exposes a full disk and overloaded host without hiding a silent peer", () => {
  const made = fixture();
  const fleet = { [made.host.ssh]: { health: HEALTH }, [made.other.ssh]: { offline: true } };
  const result = made.runScript(CLI, ["hosts", "--health"], {
    ANA_HOSTS: JSON.stringify([made.host, made.other]),
    FAKE_FLEET: JSON.stringify(fleet),
  });
  expect(result.code).toBe(1);
  expect(result.out).toContain("⚠ load 12.0/8 cores; performance cores 4");
  expect(result.out).toContain("⚠ disk 1.0 GiB free (1.0%)");
  for (const field of [
    "charger: AC Power",
    "controllers",
    "other worktrees",
    "Bun fixture",
    "aaaaaaaaa ready",
    "distant",
  ]) {
    expect(result.out).toContain(field);
  }
  expect(result.err).toContain("peer: health unavailable");
  const boundary = made.runScript(CLI, ["hosts", "--health"], {
    ANA_HOSTS: JSON.stringify([made.host, made.other]),
    FAKE_FLEET: JSON.stringify({
      [made.host.ssh]: { health: HEALTH },
      [made.other.ssh]: {
        health: { ...HEALTH, load: 8, freePct: 10, performanceCores: null, ready: false },
      },
    }),
  });
  expect(boundary.code).toBe(0);
  const peer = boundary.out.split("── peer")[1] ?? "";
  expect(peer).not.toContain("⚠");
  expect(peer).toContain("performance cores not reported");
  expect(peer).toContain("not ready");
});

it("S2: health identifies live campaigns, seats and the hot descendant that belongs to a run", () => {
  const made = fixture();
  campaign(made, "local", made.main);
  const table = {
    "-axo pid=,args=": "42 bun tools/d2/harness-builder.ts --name local",
    "-axo args=": "bun .claude/skills/system-path-simulation/scripts/live-seat.ts start --name simulated",
    "-axww -o pid=,ppid=,pcpu=,args=":
      "43 42 90 engine-worker\n42 1 5 bun\n44 1 40 browser\n45 1 7 bun .claude/skills/system-path-simulation/scripts/live-seat.ts start --name simulated",
  };
  const result = made.runScript(CLI, ["hosts", "--health"], {
    FAKE_HEALTH: JSON.stringify(HEALTH),
    FAKE_PS_TABLE: JSON.stringify(table),
    FAKE_CWDS: `p42\nn${made.main}`,
  });
  expect(result.code).toBe(0);
  expect(result.out).toContain("engine-worker; run local");
  expect(result.out).toContain("browser; run unassigned");
  expect(result.out).toContain("bun; run simulated");
  expect(result.out).toContain("simulated");
  expect(result.out).toContain("live campaigns and seats: local, simulated");
  expect(made.recorded().some((call) => call.tool === "pkill")).toBe(false);
});

it("S3: view and fleet pulse explain a dead remote run using its newest bounded stderr and reset", () => {
  const made = fixture();
  const remote = campaign(made, "distant");
  writeFileSync(join(remote.folder, "launch-old.err"), "old failure");
  utimesSync(join(remote.folder, "launch-old.err"), 1, 1);
  writeFileSync(
    join(remote.folder, "launch-new.err"),
    `${"discarded prefix\n".repeat(1000)}newest startup failure\n`,
  );
  writeFileSync(join(made.root, "sentinel"), "do not follow this link");
  symlinkSync(join(made.root, "sentinel"), join(remote.folder, "launch-linked.err"));
  const env = {
    FAKE_FLEET: JSON.stringify({
      [made.host.ssh]: { execute: true, env: { FAKE_MAIN: remote.tree, FAKE_RUN_CLI: "1" } },
    }),
  };
  const view = made.runScript(CLI, ["view", "distant"], env);
  expect(view.code).toBe(0);
  for (const text of [
    "process gone without a campaign ending",
    "newest startup failure",
    "waiting for provider until 2099",
  ]) {
    expect(view.out).toContain(text);
  }
  expect(view.out).not.toContain("old failure");
  expect(view.out).not.toContain("do not follow this link");
  const observation = readFileSync(
    join(made.main, "data", "runs", made.host.name, "distant", "observation.json"),
    "utf8",
  );
  expect(observation.length).toBeLessThan(3000);
  const pulse = made.runScript(CLI, ["pulse", "--once"], env);
  expect(pulse.code).toBe(0);
  expect(pulse.out).toContain("newest startup failure");
  expect(pulse.out).toContain("waiting for provider until 2099");
  // The same observer's next look has nothing new to say of a run that was already stopped.
  const again = made.runScript(CLI, ["pulse", "--once"], env);
  expect(again.code).toBe(0);
  expect(again.out).not.toContain("distant");
});

it("S4: fresh prepares the selected host at the requested published commit without a host argument", () => {
  const made = fixture();
  const result = made.runScript(CLI, ["fresh", "sample", "--model", "gpt", "--at", made.commit, "--yes"], {
    FAKE_CATALOGUE: JSON.stringify(catalogue(made, ["sample"])),
    FAKE_PREPARE_EXECUTE: "1",
  });
  expect(result.code).toBe(0);
  const calls = made.recorded();
  const install = calls.findIndex((call) => call.tool === "host-bun" && call.args.includes("install"));
  const launch = calls.findIndex(
    (call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true,
  );
  expect(install).toBeGreaterThan(-1);
  expect(launch).toBeGreaterThan(install);
  expect(calls[launch]?.args.at(-1)).toContain(made.commit);
  expect(calls.some((call) => call.args.includes("checkout"))).toBe(false);
});

it("a quiet live run explains its load wait while an ended run ignores stale stderr", () => {
  const made = fixture();
  const remote = campaign(made, "distant");
  const waited = append(remote.log, "campaign.waited", { load: 9, cores: 4, ms: 60_000 });
  writeFileSync(remote.log, `${JSON.stringify({ ...waited, at: new Date(0).toISOString() })}\n`);
  const env = {
    FAKE_CATALOGUE: JSON.stringify([
      { name: "distant", path: remote.log, open: true, stderr: "quiet stderr" },
    ]),
  };
  const quiet = made.runScript(CLI, ["view", "distant"], env);
  expect(quiet.code).toBe(0);
  expect(quiet.out).toContain("waiting for load 9 on 4 cores");
  expect(quiet.out).toContain("quiet stderr");
  expect(quiet.out).not.toContain("process gone");
  append(remote.log, "campaign.ended", { ending: "finished", why: "fixture" });
  const ended = made.runScript(CLI, ["view", "distant"], env);
  expect(ended.code).toBe(0);
  expect(ended.out).not.toContain("newest stderr");
});

it("an empty remote log still explains a process that died before its first event", () => {
  const made = fixture();
  const remote = campaign(made, "distant");
  writeFileSync(remote.log, "");
  const result = made.runScript(CLI, ["view", "distant"], {
    FAKE_CATALOGUE: JSON.stringify([
      { name: "distant", path: remote.log, open: false, stderr: "startup failed before opening" },
    ]),
  });
  expect(result.code).toBe(0);
  expect(result.out).toContain("process gone without a campaign ending");
  expect(result.out).toContain("startup failed before opening");
});

it("S5: a missing remote login is refused in one line before a launch is sent", () => {
  const made = fixture();
  const result = made.runScript(CLI, ["fresh", "sample", "--login", LOGIN, "--yes"], {
    FAKE_CATALOGUE: JSON.stringify(catalogue(made, ["sample"])),
    FAKE_LOGIN_PRESENT: "false",
  });
  expect(result.code).toBe(1);
  expect(result.err.trim().split("\n")).toHaveLength(1);
  expect(result.err).toContain("must be carried to runner first");
  expect(
    made.recorded().some((call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true),
  ).toBe(false);
});

it("S6: one fresh batch plans repeated packs across host and login caps, each login on two hosts, before launching anything", () => {
  const made = fixture();
  const packs = ["sample", "sample", "domain", "work", "code", "truss"];
  const args = [...packs, "--logins", LOGINS.join(",")];
  const env = {
    ANA_HOSTS: JSON.stringify([made.host, made.other]),
    ANA_RUN_CAP: "3",
    ANA_LOGINS: LOGINS.join(","),
    ANA_LOGIN_RUNS: "2",
  };
  const result = made.run(
    `import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(${JSON.stringify(args)}, ${READ});`,
    env,
  );
  expect(result.code).toBe(0);
  const rows = result.out.split("\n").filter((line) => /^\d+[.] /.test(line));
  expect(rows).toHaveLength(6);
  for (const [host, cap] of [
    ["here", 3],
    [made.host.name, 2],
    [made.other.name, 2],
  ] as const) {
    expect(rows.filter((row) => row.includes(`-> ${host};`)).length).toBeLessThanOrEqual(cap);
  }
  for (const login of LOGINS) {
    const own = rows.filter((row) => row.endsWith(`login ${login}`));
    expect(own).toHaveLength(2);
    expect(new Set(own.map((row) => row.split("-> ")[1]?.split(";")[0])).size).toBe(2);
  }
  expect(rows[0]).toContain("-> here");
  expect(
    made.recorded().some((call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true),
  ).toBe(false);
  const refused = made.run(
    `import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(${JSON.stringify([...packs, "overflow", "--yes"])}, ${READ});`,
    env,
  );
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("no allowed login has room");
});

it("S7: one zip collects campaigns from several hosts into a handover here", () => {
  const made = fixture();
  const first = campaign(made, "distant");
  const second = campaign(made, "another", join(made.root, "other-remote"));
  const fleet = {
    [made.host.ssh]: { catalogue: [{ name: "distant", path: first.log }] },
    [made.other.ssh]: { catalogue: [{ name: "another", path: second.log }] },
  };
  const out = join(made.root, "handover.zip");
  const result = made.runScript(CLI, ["zip", "distant", "another", "--light", "--out", out], {
    ANA_HOSTS: JSON.stringify([made.host, made.other]),
    FAKE_FLEET: JSON.stringify(fleet),
  });
  expect(result.code).toBe(0);
  expect(result.out).toContain("2 runs");
  expect(existsSync(out)).toBe(true);
  expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(2);
});

it("fetch with no name gathers the records of every campaign the other hosts hold, and copies only a grown log again", () => {
  const made = fixture();
  const first = campaign(made, "distant");
  const second = campaign(made, "another", join(made.root, "other-remote"));
  const gather = () => {
    const bytes = (log: string) => readFileSync(log).length;
    const fleet = {
      [made.host.ssh]: { catalogue: [{ name: "distant", path: first.log, bytes: bytes(first.log) }] },
      [made.other.ssh]: { catalogue: [{ name: "another", path: second.log, bytes: bytes(second.log) }] },
    };
    const result = made.runScript(CLI, ["fetch"], {
      ANA_HOSTS: JSON.stringify([made.host, made.other]),
      FAKE_FLEET: JSON.stringify(fleet),
    });
    expect(result.code).toBe(0);
    expect(result.out.split("\n").filter((line) => line.endsWith("log.jsonl"))).toHaveLength(2);
    return made.recorded().filter((call) => call.tool === "rsync").length;
  };
  expect(gather()).toBe(2);
  append(second.log, "campaign.ended", { ending: "finished", why: "grown" });
  // The grown log takes its earlier copy and the host's; the unchanged one takes nothing.
  expect(gather()).toBe(4);
});

it("a batch sends its whole remote plan sequentially and stops on any failed launch exit", () => {
  const made = fixture();
  const packs = ["sample", "domain"];
  const command = `import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(${JSON.stringify([...packs, "--logins", LOGINS.join(","), "--yes"])}, ${READ});`;
  const env = {
    ANA_LOGINS: LOGINS.join(","),
    ANA_LOGIN_RUNS: "1",
    FAKE_CATALOGUE: JSON.stringify(catalogue(made, packs)),
  };
  const result = made.run(command, env);
  expect(result.code).toBe(0);
  expect(result.out.indexOf("fresh batch plan")).toBeLessThan(
    result.out.indexOf("prepare a detached controller"),
  );
  expect(
    made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true),
  ).toHaveLength(2);
  const failed = made.run(command, {
    ...env,
    FAKE_FLEET: JSON.stringify({ [made.host.ssh]: { freshExit: 7 } }),
  });
  expect(failed.code).toBe(1);
  expect(failed.err).toContain("remaining packs were not started");
  expect(
    made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true),
  ).toHaveLength(3);
});

it("S8: source and view discover a remote campaign without runs on", () => {
  const made = fixture();
  const remote = campaign(made, "distant");
  const env = {
    FAKE_CATALOGUE: JSON.stringify([{ name: "distant", path: remote.log, open: true, stderr: null }]),
  };
  expect(made.runScript(CLI, ["source", "distant"], env).out).toContain(made.commit.slice(0, 9));
  const result = made.runScript(CLI, ["view", "distant"], env);
  expect(result.code).toBe(0);
  expect(result.out).toContain("waiting for provider until 2099");
  expect(result.out).not.toContain("process gone");
});

it("a missing login anywhere in a batch prevents every launch after printing the whole plan", () => {
  const made = fixture();
  const fleet = {
    [made.host.ssh]: { catalogue: catalogue(made, ["sample"]), loginPresent: "true" },
    [made.other.ssh]: { catalogue: catalogue(made, ["domain"]), loginPresent: "false" },
  };
  const command = `import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "domain", "--yes"], ${READ});`;
  const result = made.run(command, {
    ANA_HOSTS: JSON.stringify([made.host, made.other]),
    ANA_LOGINS: LOGINS.join(","),
    ANA_LOGIN_RUNS: "2",
    FAKE_FLEET: JSON.stringify(fleet),
  });
  expect(result.code).toBe(1);
  expect(result.out).toContain("1. sample -> runner");
  expect(result.out).toContain("2. domain -> peer");
  expect(result.err).toContain("must be carried to peer first");
  expect(
    made.recorded().some((call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true),
  ).toBe(false);
});

it("S9: a laptop with no open run still pulses the campaign that lives on a peer", () => {
  const made = fixture();
  const remote = campaign(made, "distant");
  const env = {
    FAKE_FLEET: JSON.stringify({
      [made.host.ssh]: {
        execute: true,
        env: {
          FAKE_MAIN: remote.tree,
          FAKE_RUN_CLI: "1",
          FAKE_PS: "42 bun tools/d2/harness-builder.ts --name distant",
          FAKE_CWDS: `p42\nn${remote.tree}`,
        },
      },
    }),
  };
  const result = made.runScript(CLI, ["pulse", "--once"], env);
  expect(result.code).toBe(0);
  expect(result.out).toContain("── here");
  expect(result.out).toContain("0 open");
  expect(result.out).toContain("── runner");
  expect(result.out).toContain("1 open");
  expect(result.out).toContain("distant");
});

it("S10: a WAN timeout reports its duration and preserves the other host's answer and capacity", () => {
  const made = fixture();
  const hosts = JSON.stringify([made.host, made.other]);
  const fleet = { [made.host.ssh]: { health: HEALTH }, [made.other.ssh]: { timeout: true } };
  const started = performance.now();
  // A control socket's path must stay under 104 bytes, which the suite's own temp root may not leave room for.
  const controlRoot = mkdtempSync(join("/tmp", "ana-s10-"));
  fixtures.push(controlRoot);
  const result = made.runScript(CLI, ["hosts", "--health"], {
    ANA_HOSTS: hosts,
    FAKE_FLEET: JSON.stringify(fleet),
    ANA_TEST_TMPDIR: controlRoot,
  });
  expect(performance.now() - started).toBeLessThan(35_000);
  expect(result.code).toBe(1);
  expect(result.out).toContain("Bun fixture");
  expect(result.err).toContain("timed out");
  expect(result.out).toMatch(/peer \(30[.]\d s\)/);
  const calls = made.recorded().filter((call) => call.tool === "ssh");
  for (const option of [
    "ControlMaster=auto",
    "ControlPersist=300",
    "ServerAliveInterval=15",
    "ConnectTimeout=20",
  ]) {
    expect(calls.every((call) => call.args.includes(option))).toBe(true);
  }
  const sockets = calls
    .filter((call) => call.args.at(-2) === made.host.ssh)
    .map((call) => call.args.find((arg) => arg.startsWith("ControlPath=")));
  expect(new Set(sockets).size).toBe(1);
  const refused = made.runScript(CLI, ["fresh", "sample", "--model", "gpt", "--yes"], {
    ANA_HOSTS: hosts,
    FAKE_FLEET: JSON.stringify({ [made.other.ssh]: { offline: true } }),
  });
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("cannot place a campaign without its live count");
});

it("S11: move prepares a destination before a clean-point transfer and can hold before continuing", () => {
  const made = fixture();
  const source = campaign(made, "local", made.main);
  const result = made.runScript(
    CLI,
    ["move", "local", "--to", made.host.name, "--login", LOGIN, "--after", "promoted", "--hold", "--yes"],
    { FAKE_EXECUTE: "1" },
  );
  expect(result.code).toBe(0);
  expect(result.out).toContain("after its next promoted");
  expect(result.out).toContain("held: go on with");
  expect(existsSync(source.folder)).toBe(false);
  expect(existsSync(join(made.root, "anabasis-local", ".ana", "d2", "local", "log.jsonl"))).toBe(true);
});

it("connection sharing refuses a substituted control directory before contacting a host", () => {
  const made = fixture();
  const target = join(made.root, "substitute");
  mkdirSync(target);
  symlinkSync(target, join(made.root, `ana-ssh-${String(process.getuid?.() ?? process.pid)}`));
  const result = made.runScript(CLI, ["hosts", "--health"], { ANA_TEST_TMPDIR: made.root });
  expect(result.code).toBe(1);
  expect(result.err).toContain("control directory must be private");
  expect(made.recorded().some((call) => call.tool === "ssh")).toBe(false);
});

it("S12: one stop locates names on both peers and refuses ambiguous originals before acting", () => {
  const made = fixture();
  const hosts = JSON.stringify([made.host, made.other]);
  const fleet = { [made.host.ssh]: { holds: ["first"] }, [made.other.ssh]: { holds: ["second"] } };
  const result = made.runScript(CLI, ["stop", "first", "second", "--yes"], {
    ANA_HOSTS: hosts,
    FAKE_FLEET: JSON.stringify(fleet),
  });
  expect(result.code).toBe(0);
  expect(
    made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("stop") === true),
  ).toHaveLength(2);
  const duplicate = made.runScript(CLI, ["stop", "first", "--yes"], {
    ANA_HOSTS: hosts,
    FAKE_FLEET: JSON.stringify({
      [made.host.ssh]: { holds: ["first"] },
      [made.other.ssh]: { holds: ["first"] },
    }),
  });
  expect(duplicate.code).toBe(1);
  expect(duplicate.err).toContain("names a campaign on");
  expect(
    made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("stop") === true),
  ).toHaveLength(2);
});
