import { afterAll, expect, it } from "bun:test";
import { rmSync } from "../src/meta/filesystem.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const fixtures: string[] = [];
const LOGIN = String(100);
const OTHER = String(101);

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const made = fakeHosts();
  fixtures.push(made.root);
  return made;
}

it("chooses no Claude login after fresh's preset seats are all overridden to GPT", () => {
  const made = fixture();
  const result = made.run(`import { fresh, seats } from "REPOSITORY/tools/runs/fresh.ts";
await fresh(["sample", "--host", "runner", "--model", "opus", "--", ...seats("openai-codex/gpt-6.1-sol", "hhhh")], async () => { throw new Error("login usage must not be read"); });`);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).toContain("nothing is launched without --yes");
});

it("refuses a fleet-full login before any source preparation, even with an explicit host", () => {
  const made = fixture();
  const result = made.run(
    'import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "--host", "runner", "--login", process.env.FAKE_LOGIN!, "--yes"]);',
    {
      FAKE_LOGIN: LOGIN,
      ANA_LOGIN_RUNS: "1",
      FAKE_ACTIVE: JSON.stringify([{ name: "occupied", login: LOGIN, host: made.host.name }]),
    },
  );
  expect(result.code).toBe(1);
  expect(result.err).toContain("live-run cap across the fleet");
  expect(made.recorded().some((call) => call.args.includes("fetch"))).toBe(false);
  expect(made.recorded().some((call) => call.args.at(-1)?.includes("ana-code") === true)).toBe(false);
});

it("uses the existing room rule to choose the earliest resetting allowed week below its cap", () => {
  const made = fixture();
  const code = `import { freshLogin } from "REPOSITORY/tools/runs/placement.ts";
const logins = process.env.ANA_LOGINS!.split(",");
const readings = logins.map((login, index) => ({login, plain:false, via:"oauth-usage" as const, notes:[], fiveHour:{pct:0,resetsAt:null}, sevenDay:{pct:0,resetsAt:new Date(2000 - index * 1000).toISOString()}}));
const read = async () => readings;
console.log(await freshLogin(undefined, [], read));
console.log(await freshLogin(undefined, [{name:"busy",login:logins[1]!,host:"elsewhere"}], read));
try { await freshLogin(undefined, [], async () => readings.map((reading) => ({...reading,sevenDay:{pct:100,resetsAt:null}}))); } catch (error) { console.log(String(error)); }
`;
  const result = made.run(code, { ANA_LOGINS: `${LOGIN},${OTHER}`, ANA_LOGIN_RUNS: "1" });
  expect(result.code).toBe(0);
  expect(result.out.split("\n").slice(0, 2)).toEqual([OTHER, LOGIN]);
  expect(result.out).toContain("no allowed login has room");
});

it("asks only for a remote login's presence and refuses a missing key before launch preparation", () => {
  const made = fixture();
  const code =
    'import { fresh } from "REPOSITORY/tools/runs/fresh.ts"; await fresh(["sample", "--host", "runner", "--login", process.env.FAKE_LOGIN!, "--yes"]);';
  const result = made.run(code, { FAKE_LOGIN: LOGIN, FAKE_LOGIN_PRESENT: "false" });
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

it("keeps a pack on a familiar host with room and falls back when it is full", () => {
  const made = fixture();
  const code =
    'import { placeFresh } from "REPOSITORY/tools/runs/placement.ts"; console.log((await placeFresh("sample"))?.name ?? "here");';
  const catalogue = JSON.stringify([
    { name: "prior", path: `${made.root}/prior/log.jsonl`, project: "sample-fresh" },
  ]);
  expect(made.run(code, { FAKE_CATALOGUE: catalogue }).out.trim()).toBe("runner");
  const occupied = ["one", "two"].map((name) => ({ name, login: null, host: made.host.name }));
  expect(
    made.run(code, { FAKE_CATALOGUE: catalogue, FAKE_ACTIVE: JSON.stringify(occupied) }).out.trim(),
  ).toBe("here");
});
