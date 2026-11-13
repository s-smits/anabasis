// `table.ts --runs <dir>` reads the campaigns under one folder with no hosts' registry and no env
// file, and names each campaign's host by the folder it is kept under, as `data/runs/<host>/<name>`.
import { afterAll, expect, it } from "bun:test";
import { runOf } from "#skills/main/runs.ts";
import { backends } from "#src/agent/backends/models.ts";
import { read } from "#src/kernel/log.ts";
import { sweepOptions } from "#tools/m0/stored-sweep.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";

const ROOT = resolve(import.meta.dir, "..");
const home = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-table-runs-")));
afterAll(() => rmSync(home, { recursive: true, force: true }));

function campaignAt(folder: string): void {
  mkdirSync(folder, { recursive: true });
  const events = [
    {
      at: "2026-11-01T00:00:00.000Z",
      kind: "campaign.opened",
      data: { project: "p", budget: { dollars: 10, reserve: 1 } },
    },
    { at: "2026-11-01T01:00:00.000Z", kind: "campaign.ended", data: { ending: "budget", why: "w" } },
  ];
  writeFileSync(join(folder, "log.jsonl"), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

it("reads only the campaigns under the folder, each under the host its folder names", () => {
  campaignAt(join(home, "hostx", "kept-on-hostx"));
  campaignAt(join(home, "kept-here"));
  const out = execTextSync(
    "bun",
    [
      ".claude/skills/promotion-tuner/scripts/table.ts",
      "--runs",
      home,
      "--rows",
      "runs",
      "--format",
      "tsv",
      "--since",
      "2020-01-01",
    ],
    { cwd: ROOT, env: { ...Bun.env, ANA_HOSTS: undefined } },
  );
  const rows = out
    .trim()
    .split("\n")
    .slice(1)
    .map((row) => row.split("\t"));
  const named = (name: string) => rows.find((row) => row.includes(name));
  expect(rows).toHaveLength(2);
  expect(named("kept-on-hostx")).toContain("hostx");
  expect(named("kept-here")).toContain("here");
  expect(named("kept-here")).not.toContain("hostx");
});

// `--rows cost` reprices every recorded turn on today's meter, each at the model its start asked for.
it("reprices a run's turns on two models to the catalogue's sum, and names a model it cannot price", () => {
  const priced = backends(sweepOptions())
    .getModels("claude")
    .filter(({ cost }) => cost.input > 0 && cost.output > 0);
  const [one, other] = [priced[0], priced.at(-1)];
  if (one === undefined || other === undefined) throw new Error("the catalogue prices no model");
  const usage = (input: number, output: number) => ({
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });
  const folder = join(home, "repriced");
  const runWith = (solver: string) => {
    mkdirSync(folder, { recursive: true });
    const events = [
      { kind: "build.started", data: { session: "b1", model: `claude/${one.id}` } },
      { kind: "build.turn", data: { session: "b1", turn: 1, usage: usage(1_000_000, 0) } },
      { kind: "solve.started", data: { solve: "s1", model: solver } },
      { kind: "solve.turn", data: { solve: "s1", turn: 1, usage: usage(0, 1_000_000) } },
    ].map((event) => `${JSON.stringify({ at: "2026-11-01T00:00:00.000Z", ...event })}\n`);
    writeFileSync(join(folder, "log.jsonl"), events.join(""));
    const found = { name: "repriced", path: join(folder, "log.jsonl") };
    return runOf(found, read(found.path), []);
  };
  const run = runWith(`claude/${other.id}`);
  expect(run?.unpriced).toBeNull();
  expect(run?.repriced).toBeCloseTo(one.cost.input + other.cost.output, 9);
  const unknown = runWith("claude/no-such-model");
  expect(unknown?.repriced).toBeNull();
  expect(unknown?.unpriced).toContain("no-such-model");
});

it("leaves a starter comparison out of those a promotion could come from, though it read nothing", () => {
  const folder = join(home, "starter-unread");
  mkdirSync(folder, { recursive: true });
  const compared = (session: string, old: string, fresh: string, reading: string) => [
    { kind: "comparison.started", data: { session, old, fresh, starter: "s" } },
    { kind: "comparison.reported", data: { session, old, fresh, starter: "s", reading } },
  ];
  // One promotion, then its starter comparison, which tallied no task.
  const events = [
    ...compared("c1", "s", "h1", "step"),
    { kind: "harness.promoted", data: { harness: "h1", from: "s" } },
    ...compared("c2", "h1", "s", "not-scored"),
  ].map((event) => `${JSON.stringify({ at: "2026-11-01T00:00:00.000Z", ...event })}\n`);
  writeFileSync(join(folder, "log.jsonl"), events.join(""));
  const found = { name: "starter-unread", path: join(folder, "log.jsonl") };
  const run = runOf(found, read(found.path), []);
  expect(run?.reads).toBe(0);
  expect(run?.compared).toBe(1);
});

// Runs are read together only under one setting, so two that differ in the solves a side alone must
// not read as one; and a campaign that went on after an ending has none, as production reads it.
it("reads a run's setting whole from its record, and no ending once the campaign went on", () => {
  const runWith = (name: string, solves: number, wentOn: boolean) => {
    const folder = join(home, name);
    mkdirSync(folder, { recursive: true });
    const solver = { model: "claude/m", effort: "high" };
    const events = [
      { kind: "campaign.setting", data: { solver, minutes: 30, modelTurns: 20, target: 24, solves } },
      { kind: "campaign.ended", data: { ending: "budget", why: "w" } },
      ...(wentOn ? [{ kind: "build.started", data: { session: "b1", model: "claude/m" } }] : []),
    ].map((event) => `${JSON.stringify({ at: "2026-11-01T00:00:00.000Z", ...event })}\n`);
    writeFileSync(join(folder, "log.jsonl"), events.join(""));
    const found = { name, path: join(folder, "log.jsonl") };
    return runOf(found, read(found.path), []);
  };
  const two = runWith("two-solves", 2, false);
  const three = runWith("three-solves", 3, true);
  expect(two?.setting).toBe("m/high 30m 20t 24x2");
  expect(three?.setting).toBe("m/high 30m 20t 24x3");
  expect(two?.ending).toBe("budget");
  expect(three?.ending).toBe("no ending");
});
