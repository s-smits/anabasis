// A campaign over a sweep laid out as v1's left one, as far as it goes without a model or a wall: it
// opens, names its sets from the log, finds a task a session wrote beside the pack's own, and
// `prepare.ts`, run as the operator runs it, draws the anchor and releases the practice tasks once.
import { afterAll, describe, expect, it } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { taskStates, taskVersion } from "../src/kernel/task.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { openCampaign, setsOf } from "../tools/d2/campaign.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const NAME = `test-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-campaign-")));
const bundle = join(root, "bundle");
const ARGS = { root, sweep: "s", cycle: "c01", bundle, name: NAME };
const TASKS = Array.from({ length: 7 }, (_, index) => ({
  taskId: `t-${String(index + 1)}`,
  family: "fixture",
  publicInput: { base: index + 2 },
  hidden: null,
}));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(REPO, ".ana", "d2", NAME), { recursive: true, force: true });
});

/** The sweep, its one graded solve, the cycle's harness state and the pack, as v1 lays them out. */
function layOut(): void {
  mkdirSync(join(root, "grades", "s"), { recursive: true });
  writeFileSync(join(root, "grades", "s", "grades.tsv"), "cycle\ttaskId\tkind\n1\tt-1\tverified-pass\n");
  const solve = join(root, "runs", "s", "c01", "t-1");
  const caseDir = join(solve, "harness", "cases", "t-1");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    join(solve, "result.json"),
    JSON.stringify({
      provider: "claude",
      model: "claude-opus-5-5",
      timedOut: false,
      answerPresent: true,
      answerParses: true,
    }),
  );
  const ended = { status: "ended", inputTokens: 1, outputTokens: 1, costUsd: 0.01 };
  writeFileSync(join(caseDir, "trace.json"), JSON.stringify({ turns: [ended] }));
  const format = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  writeFileSync(
    join(caseDir, "built-runtime.json"),
    JSON.stringify({
      modelWorker: { modelSelection: { effort: "medium" } },
      contractCondition: { tools: [{ description: "Role: artifact-writer. Records.", parameters: format }] },
    }),
  );
  cpSync(FIXTURE, join(root, "hb-bundles", "s-c01"), { recursive: true });
  mkdirSync(join(bundle, "correctness-model"), { recursive: true });
  mkdirSync(join(bundle, ".toolchain", "bin"), { recursive: true });
  const execution = {
    families: "all",
    artifactPaths: ["$.answer"],
    publicInputPaths: ["$.base"],
    hidden: "none",
    evidence: { kind: "authored" },
  };
  writeFileSync(
    join(bundle, "correctness-model", "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      domain: "Fixture",
      ruleDecisions: [{ id: "R1", statement: "The answer is the base times six.", visibility: "public" }],
      truthChecks: [{ id: "check-product", assertion: "Six times.", citedDecisionIds: ["R1"], execution }],
      artifactSchema: [],
      designRuleConstants: [],
    }),
  );
  writeFileSync(join(bundle, "correctness-model", "evaluator.ts"), "export const checks = {};\n");
  writeFileSync(join(bundle, "correctness-model", "tasks.json"), JSON.stringify(TASKS));
}

describe("a campaign", () => {
  it("opens over a stored sweep, names its sets from the log, and prepares them once", async () => {
    layOut();
    const campaign = await openCampaign(ARGS);
    expect(campaign.contract.rules).toMatchObject([
      { id: "R1", statement: "The answer is the base times six." },
    ]);
    expect(campaign.test).toMatchObject({ effort: "medium", side: "test" });
    expect(campaign.test.model.id).toBe("claude-opus-5-5");
    expect(campaign.parent).toBe(join(root, "hb-bundles", "s-c01"));
    // The log, the staged check program and the states are inside the repository, which every wall denies.
    expect(campaign.log.startsWith(join(REPO, ".ana", "d2", NAME))).toBe(true);
    expect(read(campaign.log)).toEqual([]);

    // The pack's tasks as `admit-sweep.ts --feasible` leaves them: proposed, four gates passed, held.
    const versions = TASKS.map((task) => taskVersion(campaign.pack(task)));
    for (const version of versions) {
      append(campaign.log, "task.proposed", { version });
      for (const gate of [1, 2, 3, 4]) {
        append(campaign.log, "task.gate", { version, gate, outcome: "passed", controls: "d" });
      }
    }
    // One more, as an Examiner session leaves it: its instance whole in its proposal, gate 4 not yet passed.
    const written = { taskId: "x-1-001", family: "fixture", publicInput: { base: 40 }, hidden: { seed: 1 } };
    const extra = taskVersion(campaign.pack(written));
    append(campaign.log, "task.proposed", {
      version: extra,
      taskId: written.taskId,
      session: "x-1",
      task: written,
    });
    expect(setsOf(read(campaign.log))).toMatchObject({ anchor: [], released: [], admitted: [] });
    expect(setsOf(read(campaign.log)).candidates.sort()).toEqual([...versions].sort());
    const packages = campaign.packages();
    expect(packages.get(extra)).toMatchObject({ taskId: "x-1-001", hidden: { seed: 1 }, ruleIds: ["R1"] });
    expect(versions.every((version) => packages.has(version))).toBe(true);

    const prepare = () => {
      const flags = Object.entries({ ...ARGS, anchor: "3", practice: "2" }).flatMap(([flag, value]) => [
        `--${flag}`,
        value,
      ]);
      const ran = Bun.spawnSync({ cmd: [capturedExecPath, "tools/d2/prepare.ts", ...flags], cwd: REPO });
      return `${ran.stdout.toString()}${ran.stderr.toString()}`.trim();
    };
    const summary = "7 feasible: 3 anchor, 2 released for practice, 2 held for screening, 0 admitted";
    expect(prepare()).toBe(summary);
    const sets = setsOf(read(campaign.log));
    expect([sets.anchor.length, sets.released.length, sets.candidates.length]).toEqual([3, 2, 2]);
    expect(new Set([...sets.anchor, ...sets.released, ...sets.candidates]).size).toBe(7);
    const states = taskStates(read(campaign.log));
    expect(sets.released.every((version) => states.get(version) === "released")).toBe(true);
    // The draw names its seed and its pool, and a second run draws and releases nothing.
    const drawn = read(campaign.log).filter((event) => event.kind === "anchor.drawn");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.data).toMatchObject({ from: 7 });
    expect(prepare()).toBe(summary);
    expect(read(campaign.log).filter((event) => event.kind === "anchor.drawn")).toHaveLength(1);
    expect(setsOf(read(campaign.log)).released).toEqual(sets.released);
  });
});
