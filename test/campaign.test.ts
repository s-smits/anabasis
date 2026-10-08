// A campaign over a sweep laid out as v1's left one, as far as it goes without a model or a wall: it
// opens, names its sets from the log, finds a task a session wrote beside the pack's own, and
// `prepare.ts`, run as the operator runs it, draws the anchor and releases the practice tasks once.
import { afterAll, describe, expect, it } from "bun:test";
import { append, type LogEvent, read } from "../src/kernel/log.ts";
import { taskStates, taskVersion } from "../src/kernel/task.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { carriable, frontier, openCampaign, setsOf } from "../tools/d2/campaign.ts";

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
    // While no round has stepped the campaign stands on the stored cycle's harness.
    const stands = await frontier(campaign);
    expect(stands.dir).toBe(campaign.parent);
    // No solve has placed a task yet, so the draws are blind and the ladder says so.
    const summary = [
      "7 feasible: 3 anchor, 2 released for practice (2 the frontier is not known to clear), 2 in the pool",
      `against the frontier ${stands.digest.slice(0, 8)}: 0 stop it, 0 it clears, 0 ended at the wall, 2 no solve has placed; 0 wait for a witness`,
      "what binds: tasks. 2 of the pool can be scored and a step takes 4: no Examiner session has written against this harness",
    ].join("\n");
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

    // A round that read a step moves the frontier to the harness it kept, and one that did not
    // leaves it there.
    const kept = join(campaign.states, stands.digest);
    cpSync(campaign.parent, kept, { recursive: true });
    append(campaign.log, "comparison.reported", { session: "b-1", reading: "step", fresh: stands.digest });
    append(campaign.log, "comparison.reported", { session: "b-2", reading: "no-step", fresh: "other" });
    expect(await frontier(campaign)).toEqual({ dir: kept, digest: stands.digest });
  });

  it("says which harnesses a campaign keeps when --parent names none of them", async () => {
    layOut();
    const campaign = await openCampaign(ARGS);
    const digest = "ab".repeat(32);
    mkdirSync(join(campaign.states, digest), { recursive: true });
    // The round as the operator runs it. It is refused before a seat is taken or a session starts.
    const round = (parent: string) => {
      const flags = Object.entries({ ...ARGS, session: "b-9", builder: "faux/none", parent }).flatMap(
        ([flag, value]) => [`--${flag}`, value],
      );
      const ran = Bun.spawnSync({ cmd: [capturedExecPath, "tools/d2/round.ts", ...flags], cwd: REPO });
      return `${ran.stdout.toString()}${ran.stderr.toString()}`;
    };
    // A digest cut short, as every reader prints one: the whole one is named beside it.
    const short = round(digest.slice(0, 8));
    expect(short).toContain("--parent abababab is no harness this campaign keeps");
    expect(short).toContain(
      `whole: ${readdirSync(campaign.states).sort().join(", ")}. abababab begins ${digest}.`,
    );
    // Nor is another folder of the campaign a harness, wherever the name leads.
    expect(round("../checks")).toContain("--parent ../checks is no harness this campaign keeps");
    expect(read(campaign.log).filter(({ kind }) => kind === "build.started")).toEqual([]);
  });

  it("reads from a log what a campaign under a repaired checker can take with no solve", () => {
    const at = "2026-10-08T00:00:00.000Z";
    const event = (kind: LogEvent["kind"], data: LogEvent["data"]): LogEvent => ({ at, kind, data });
    /** A task a session wrote, as far as gate 2: its proposal, and its stronger solve's verdict. */
    const written = (id: string, version: string, solved: LogEvent["data"]): LogEvent[] => [
      event("task.proposed", {
        version,
        taskId: id,
        session: "x-1",
        task: { taskId: id, family: "fixture", publicInput: { base: 4 }, hidden: null },
      }),
      event("task.gate", { version, gate: 1, outcome: "passed" }),
      event("verdict", { solve: `s-${id}`, task: id, answer: { answer: id }, kind: "pass" }),
      event("task.gate", { version, gate: 2, solve: `s-${id}`, ...solved }),
    ];
    const set = [{ answer: { answer: "0" }, expectedCheckId: "check-product" }];
    const events = [
      // Feasible, its controls whole in the log.
      ...written("x-1-001", "v1", { outcome: "passed" }),
      event("task.gate", { version: "v1", gate: 4, outcome: "passed", controls: "d", set }),
      // Feasible in a log written before the controls were kept: only their digest is there.
      ...written("x-1-002", "v2", { outcome: "passed" }),
      event("task.gate", { version: "v2", gate: 4, outcome: "passed", controls: "d" }),
      // Closed as too hard on an answer a check refused, which a repair may accept; and at the
      // wall, which no repair changes.
      ...written("x-1-003", "v3", { outcome: "too-hard", kind: "rejected" }),
      ...written("x-1-004", "v4", { outcome: "too-hard", kind: "wall-ended" }),
      // A pack's task is no session's: its proposal holds no instance.
      event("task.proposed", { version: "v5" }),
      // Past gate 3 when its session ended, with no controls written: the next session's to take.
      ...written("x-1-006", "v6", { outcome: "passed" }),
      event("task.gate", { version: "v6", gate: 3, outcome: "passed" }),
      // Past gate 2 only: gate 3 has not said the checks repeat on its answer.
      ...written("x-1-007", "v7", { outcome: "passed" }),
    ];
    const { feasible, recovered, waiting, bare } = carriable(events);
    expect(waiting.map(({ task, accepted }) => [task.taskId, accepted])).toEqual([
      ["x-1-006", { answer: "x-1-006" }],
    ]);
    expect(feasible).toEqual([
      {
        task: { taskId: "x-1-001", family: "fixture", publicInput: { base: 4 }, hidden: null },
        solve: "s-x-1-001",
        accepted: { answer: "x-1-001" },
        controls: set,
      },
    ]);
    expect(recovered.map(({ task, solve }) => [task.taskId, solve])).toEqual([["x-1-003", "s-x-1-003"]]);
    expect(bare).toBe(1);
  });
});
