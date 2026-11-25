// The operator's fleet workflows through public verbs. Every transport is a temporary executable.
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
import { writeReceipt } from "../tools/runs/receipt.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const fixtures: string[] = [];
const CLI = "tools/runs/cli.ts";
const LOGIN = String(100);
const LOGINS = [LOGIN, String(101), String(102)];
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
  append(log, "campaign.waited", { for: "provider", until: "2099-01-01T00:00:00.000Z", ms: 60_000 });
  return { folder, log, tree };
}

function catalogue(made: ReturnType<typeof fixture>, packs: readonly string[]) {
  return packs.map((pack, index) => ({
    name: `prior-${String(index)}`,
    path: `${made.root}/prior-${String(index)}/log.jsonl`,
    project: `${pack}-fresh`,
  }));
}

describe.concurrent("fleet workflows", () => {
  it("a local fresh refused after its worktree is made removes that worktree, so the next fresh takes the plain name", async () => {
    // The install fails, the tree holding no package.json, before any campaign folder is made.
    const made = fixture();
    mkdirSync(join(made.root, "anabasis-prompts"));
    writeFileSync(join(made.root, "anabasis-prompts", "sample-prompt.txt"), "fixture prompt\n");
    const fresh = (yes: boolean) =>
      made.runScriptAsync(CLI, [
        "fresh",
        "sample",
        "--model",
        "gpt",
        "--host",
        "here",
        ...(yes ? ["--yes"] : []),
      ]);
    const planned = (out: string) => /would make (\S+) at/.exec(out)?.[1];
    const tree = planned((await fresh(false)).out);
    expect(tree).toBeDefined();
    const refused = await fresh(true);
    expect(refused.code).toBe(1);
    expect(existsSync(tree ?? "")).toBe(false);
    expect(planned((await fresh(false)).out)).toBe(tree);
  });

  it("a batch sends its whole remote plan sequentially and stops on any failed launch exit", async () => {
    const made = fixture();
    const packs = ["sample", "domain"];
    const command = `import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(${JSON.stringify([...packs, "--logins", LOGINS.join(","), "--yes"])}, ${READ});`;
    const env = {
      ANA_LOGINS: LOGINS.join(","),
      ANA_LOGIN_RUNS: "1",
      FAKE_CATALOGUE: JSON.stringify(catalogue(made, packs)),
    };
    const result = await made.runAsync(command, env);
    expect(result.code).toBe(0);
    expect(result.out.indexOf("fresh batch plan")).toBeLessThan(
      result.out.indexOf("prepare a detached controller"),
    );
    expect(
      made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true),
    ).toHaveLength(2);
    const failed = await made.runAsync(command, {
      ...env,
      FAKE_FLEET: JSON.stringify({ [made.host.ssh]: { freshExit: 7 } }),
    });
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("remaining packs were not started");
    expect(
      made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true),
    ).toHaveLength(3);
  });

  it("a missing login anywhere in a batch prevents every launch after printing the whole plan", async () => {
    const made = fixture();
    const fleet = {
      [made.host.ssh]: { catalogue: catalogue(made, ["sample"]), loginPresent: "true" },
      [made.other.ssh]: { catalogue: catalogue(made, ["domain"]), loginPresent: "false" },
    };
    const command = `import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "domain", "--yes"], ${READ});`;
    const result = await made.runAsync(command, {
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

  it("continue refuses --after next with another commit before it pauses anything", async () => {
    // `next` may stop a run inside a comparison, which the start at another commit then refuses,
    // leaving the run stopped.
    const made = fixture();
    const source = campaign(made, "local", made.main);
    const before = readFileSync(source.log, "utf8");
    const refused = await made.runScriptAsync(
      CLI,
      ["continue", "local", "--at", "b".repeat(40), "--after", "next", "--yes"],
      { FAKE_AT: "b".repeat(40) },
    );
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("--after next can stop the run inside a comparison");
    expect(readFileSync(source.log, "utf8")).toBe(before);
  });

  it("connection sharing refuses a substituted control directory before contacting a host", async () => {
    const made = fixture();
    const target = join(made.root, "substitute");
    mkdirSync(target);
    symlinkSync(target, join(made.root, `ana-ssh-${String(process.getuid?.() ?? process.pid)}`));
    const result = await made.runScriptAsync(CLI, ["hosts", "--health"], { ANA_TEST_TMPDIR: made.root });
    expect(result.code).toBe(1);
    expect(result.err).toContain("control directory must be private");
    expect(made.recorded().some((call) => call.tool === "ssh")).toBe(false);
  });

  it("S12: one stop locates names on both peers and refuses ambiguous originals before acting", async () => {
    const made = fixture();
    const hosts = JSON.stringify([made.host, made.other]);
    const fleet = { [made.host.ssh]: { holds: ["first"] }, [made.other.ssh]: { holds: ["second"] } };
    const result = await made.runScriptAsync(CLI, ["stop", "first", "second", "--yes"], {
      ANA_HOSTS: hosts,
      FAKE_FLEET: JSON.stringify(fleet),
    });
    expect(result.code).toBe(0);
    expect(
      made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("stop") === true),
    ).toHaveLength(2);
    const duplicate = await made.runScriptAsync(CLI, ["stop", "first", "--yes"], {
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

  it("a stop ends a run's keeper before its writer, so the keeper cannot start it again between the two", async () => {
    const made = fixture();
    campaign(made, "local", made.main);
    const order = join(made.root, "order");
    // Each stands in for its process and says when it is ended.
    const role = (name: string) =>
      Bun.spawn(
        ["sh", "-c", `trap 'echo ${name} >> "$0"; exit 0' TERM; while :; do sleep 0.05; done`, order],
        { cwd: made.main, detached: true, stderr: "ignore" },
      );
    const writer = role("writer");
    const keeper = role("keeper");
    await Bun.sleep(200);
    const table = {
      "-axo pid=,args=": `${String(writer.pid)} bun tools/d2/harness-builder.ts --name local\n${String(keeper.pid)} bun ${made.main}/tools/runs/cli.ts keep local --here`,
      "-axo pid=,ppid=": `${String(writer.pid)} 1\n${String(keeper.pid)} 1`,
    };
    const result = await made.runScriptAsync(CLI, ["stop", "local", "--yes"], {
      FAKE_PS_TABLE: JSON.stringify(table),
      FAKE_CWDS: `p${String(writer.pid)}\nn${made.main}\np${String(keeper.pid)}\nn${made.main}`,
    });
    writer.kill("SIGKILL");
    keeper.kill("SIGKILL");
    expect({ code: result.code, err: result.err }).toEqual({ code: 0, err: "" });
    expect(readFileSync(order, "utf8").split("\n").filter(Boolean)).toEqual(["keeper", "writer"]);
  });
});
