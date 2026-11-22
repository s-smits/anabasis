import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "../src/meta/filesystem.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const fixtures: string[] = [];
const LOGIN = String(100);
const OTHER = String(101);
const FRESH =
  'import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "--host", "runner", "--login", process.env.FAKE_LOGIN!, "--yes"]);';

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const made = fakeHosts();
  fixtures.push(made.root);
  return made;
}

describe("placing a fresh campaign", () => {
  it("refuses a fleet-full login before any source preparation, even with an explicit host", () => {
    const made = fixture();
    const result = made.run(FRESH, {
      FAKE_LOGIN: LOGIN,
      ANA_LOGIN_RUNS: "1",
      FAKE_ACTIVE: JSON.stringify([{ name: "occupied", login: LOGIN, host: made.host.name }]),
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain("live-run cap across the fleet");
    expect(made.recorded().some((call) => call.args.includes("fetch"))).toBe(false);
    expect(made.recorded().some((call) => call.args.at(-1)?.includes("ana-code") === true)).toBe(false);
    expect(
      made.recorded().some((call) => call.tool === "ssh" && call.args.at(-1)?.includes("fresh") === true),
    ).toBe(false);
  });

  it("asks only for a remote login's presence and refuses a missing key before launch preparation", () => {
    const made = fixture();
    const result = made.run(FRESH, { FAKE_LOGIN: LOGIN, FAKE_LOGIN_PRESENT: "false" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("must be carried to runner first");
    expect(result.err.trim().split("\n")).toHaveLength(1);
    const commands = made
      .recorded()
      .filter((call) => call.tool === "ssh")
      .map((call) => call.args.at(-1) ?? "");
    expect(commands.at(-1)).toContain("--login");
    expect(commands.at(-1)).toContain("--here");
    expect(commands.some((command) => command.includes("if true; then"))).toBe(false);
    expect(result.out).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    const local = made.runScript("tools/runs/cli.ts", ["active", "--here", "--login", LOGIN], {
      [`CLAUDE_CODE_OAUTH_TOKEN${LOGIN}`]: "fixture-sentinel-never-print",
    });
    expect(local.out.trim()).toBe("true");
    expect(local.err).not.toContain("fixture-sentinel-never-print");
    expect(made.runScript("tools/runs/cli.ts", ["active", "--here", "--login", OTHER]).out.trim()).toBe(
      "false",
    );
  });

  it("refuses a named login the provider refuses, and starts one whose reading failed otherwise", () => {
    const made = fixture();
    const code = `import { freshLogin } from "REPOSITORY/tools/runs/placement.ts";
const said = (error: string) => async (logins: readonly string[]) => logins.map((login) => ({login, plain:false, error}));
try { await freshLogin(process.env.FAKE_LOGIN, [], said("OAuth error: HTTP 403; messages HTTP 403, no rate-limit headers")); } catch (error) { console.log(String(error)); }
console.log(await freshLogin(process.env.FAKE_LOGIN, [], said("fetch failed")));`;
    const result = made.run(code, { FAKE_LOGIN: LOGIN, [`CLAUDE_CODE_OAUTH_TOKEN${LOGIN}`]: "held" });
    expect(result.code).toBe(0);
    expect(result.out).toContain(`login ${LOGIN} is refused by the provider`);
    expect(result.out.trim().split("\n").at(-1)).toBe(LOGIN);
  });

  it("puts a GPT run on no machine that carries one, chosen or named, unless codex:N allows more", () => {
    const made = fixture();
    const place = `import { placeFresh } from "REPOSITORY/tools/runs/placement.ts"; console.log((await placeFresh("sample", undefined, undefined, "codex"))?.name ?? "here", (await placeFresh("sample", undefined, undefined, "${
      LOGIN
    }"))?.name ?? "here");`;
    const gpt =
      'import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "--host", "runner", "--model", "gpt"]);';
    const there = { FAKE_ACTIVE: JSON.stringify([{ name: "gpt-there", login: "codex", host: "x" }]) };
    const reserved = { ANA_HOSTS: JSON.stringify([{ ...made.host, packs: ["sample"] }]) };
    expect(made.run(place, reserved).out.trim()).toBe("runner runner");
    expect(made.run(place, { ...reserved, ...there }).err).toContain("no host has room");
    const named = made.run(gpt, there);
    expect(named.code).toBe(1);
    expect(named.err).toContain("runner carries 1 live codex run(s), at most 1 a machine");
    expect(made.run(gpt).out).toContain("nothing is launched without --yes");
    // A Claude Builder over a GPT solver on the plain login is counted as a Codex run once live
    // (`payerOf`, `liveHere`), so placement holds it to the same cap before it starts.
    const mixed =
      'import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "--host", "runner", "--", "--solver", "openai-codex/gpt-6.1-sol"]);';
    const plain = { ...there, CLAUDE_CODE_OAUTH_TOKEN: "fixture" };
    expect(made.run(mixed, plain).err).toContain("runner carries 1 live codex run(s)");
    expect(made.run(mixed, { CLAUDE_CODE_OAUTH_TOKEN: "fixture" }).out).toContain(
      "nothing is launched without --yes",
    );
    expect(made.run(gpt, { ...there, ANA_LOGIN_RUNS: "codex:2" }).out).toContain(
      "nothing is launched without --yes",
    );
  });

  it("keeps a reserved pack on its host, and every other pack off it, chosen or named", () => {
    const made = fixture();
    const hosts = JSON.stringify([{ ...made.host, packs: ["truss"] }]);
    const code =
      'import { placeFresh, takes } from "REPOSITORY/tools/runs/placement.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; const [runner] = hostsOf(); console.log((await placeFresh("truss"))?.name ?? "here", (await placeFresh("sample"))?.name ?? "here", takes(undefined, "truss"), takes(runner, "sample"), takes(undefined, "sample"));';
    expect(made.run(code, { ANA_HOSTS: hosts }).out.trim()).toBe("runner here false false true");
    const full = JSON.stringify(["one", "two"].map((name) => ({ name, login: null, host: made.host.name })));
    expect(made.run(code, { ANA_HOSTS: hosts, FAKE_ACTIVE: full }).err).toContain("no host has room");
    expect(made.run(code, { ANA_HOSTS: JSON.stringify([{ ...made.host, packs: ["../x"] }]) }).err).toContain(
      "packs takes a list of pack names",
    );
  });
});
