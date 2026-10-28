// One Builder session on the faux provider. Without a wall: what it is given, what a practice
// returns and never returns, the reviewers' part, the budget, the freeze and the record it leaves.
// The three walled tools are stood in for by a host write here; the session under the real command
// wall is the last block, which runs on Darwin alone.
// Restores distinguish counted practice, including failure, from snapshots and non-results.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { crashedRun } from "../src/campaign/ground.ts";
import { type BuildRequest, build, type PracticeTask, session } from "../src/builder/session.ts";
import { type Bench, HOME_TOOL_TREE, practiceLeft, record, snapshot } from "../src/builder/tools.ts";
import { type Condition, recordCondition } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { latestBuilt } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isFunction, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { keysIf } from "../src/meta/optional-key.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import type { RefereeFinding } from "../src/referee/referee.ts";
import { publicResource, text, tool } from "../src/tools/answer.ts";
import { openHarness } from "../src/harness/open.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { CLOSED } from "./helpers/wall.ts";
import { BUILT_COMMAND_SCRATCH_ROOT } from "../src/wall/policy.ts";
import { keptAs } from "../tools/d2/campaign.ts";
import { endCut } from "../tools/d2/harness-builder.ts";

const BUILD_CALL = "build.call";
const BUILD_FINISHED = "build.finished";
const WRITE_FILE = "write";
const GUIDE_PATH = "harness/agent/BUILT_AGENTS.md";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
/** A check's id and a Referee's reason: verifier-side text no Builder may be shown. */
const CHECK = "check-canary-51c2";
const REASON = "reason-canary-9d07";
const CONTRACT: Contract = {
  answerFormat: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  conventions: "SI units.",
  rules: [{ id: "R1", statement: "The answer is the base times six." }],
  scope: "Fixture.",
};
const LIMITS = {
  wallSeconds: 600,
  turns: 12,
  shellDefaultSeconds: 30,
  shellMaxSeconds: 60,
  concurrency: 2,
  practiceSolves: 3,
};
const TASKS: PracticeTask[] = [
  { version: "v1", task: { taskId: "t-1", family: "fixture", publicInput: { base: 7 } } },
  { version: "v2", task: { taskId: "t-2", family: "fixture", publicInput: { base: 9 } } },
];
const GUIDE = "Multiply before you record.\n";
const scratches: string[] = [];
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const edit = call(WRITE_FILE, { path: GUIDE_PATH, content: GUIDE });
const finish = call("finish", { note: "A shorter guide." });

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** A scratch with the fixture harness as the parent, and a log in which v1 and v2 are released and
 *  v0 and v3 are held out. `endings` are what the practice solves end in, in order.
 *  With `tree`, the parent has an installed program. */
async function setup(responses: FauxResponseStep[], endings: Ending[] = [], tree = false, check = CHECK) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-builder-")));
  scratches.push(scratch);
  const parent = join(scratch, "parent");
  const home = join(scratch, "home");
  const host = join(scratch, "host");
  const log = join(scratch, "log.jsonl");
  cpSync(FIXTURE, parent, { recursive: true });
  if (tree) {
    mkdirSync(join(parent, ".toolchain", "bin"), { recursive: true });
    writeFileSync(join(parent, ".toolchain", "bin", "hello"), "#!/bin/sh\necho hello-from-the-tool-tree\n");
    chmodSync(join(parent, ".toolchain", "bin", "hello"), 0o755);
  }
  mkdirSync(home);
  mkdirSync(host);
  const record_ = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  for (const version of ["v0", "v1", "v2", "v3"]) {
    record_("task.proposed", { version });
    record_("task.gate", { version, gate: 1, outcome: "passed" });
  }
  record_("task.state", { version: "v1", state: "released" });
  record_("task.state", { version: "v2", state: "released" });
  const digest = (await openHarness(parent)).digest;
  const condition = (task: string, harness: string): Condition => ({
    contract: "c1",
    harness,
    task,
    model: "faux/faux-solver",
    effort: "medium",
    prices: { "faux/faux-solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    runtime: {},
    compaction: "off",
    solverTools: harness,
    verifierTools: "t1",
    sandbox: "p1",
    limits: LIMITS,
    host: "h1",
    side: "test",
  });
  let solves = 0;
  /** A solve as the runner logs one: its condition, a call, a verdict naming the check where the
   *  verifier read an answer, its ending. */
  const solved = (version: string, harness: string, ending: Ending) => {
    solves += 1;
    const solve = `s-${String(solves)}`;
    record_("solve.started", {
      solve,
      condition: recordCondition(log, condition(version, harness)),
      task: "t",
    });
    record_("solve.call", {
      solve,
      turn: 1,
      tool: "bash",
      args: { command: "run" },
      isError: false,
      text: `margin of ${solve}`,
    });
    record_("solve.turn", { solve, turn: 1, stopReason: "stop", text: "Submitted." });
    if (ending.outcome === "non-result" || (ending.outcome === "fail" && ending.kind === "rejected")) {
      record_("verdict", { solve, answer: { answer: "41" }, kind: "fail", blocking: [check] });
    }
    record_("solve.finished", { solve, ending });
    return solve;
  };
  // Solves on record before the session: v1 failed once, and v3 is a held-out task's.
  solved("v1", digest, { outcome: "fail", kind: "rejected" });
  record_("referee.finding", { solve: "s-1", ruling: "earned" });
  const exam = solved("v3", digest, { outcome: "fail", kind: "rejected" });
  const sent: string[] = [];
  const faux = fauxProvider({
    models: [
      {
        id: "faux-builder",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  faux.setResponses(
    responses.map(
      (step): FauxResponseStep =>
        isFunction(step)
          ? step
          : (context) => {
              sent.push(JSON.stringify(context));
              return step;
            },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const queue = [...endings];
  /** Where and under which digest each practice solve was asked to run. */
  const ran: { dir: string; digest: string }[] = [];
  const request: BuildRequest = {
    id: "b-1",
    parent: parent,
    // The reference harness is the parent here, as it is for a first session from the starter.
    reference: parent,
    states: join(scratch, "states"),
    memory: join(scratch, "memory"),
    tasks: TASKS,
    contract: CONTRACT,
    resources: [publicResource("span table", { maxSpan: 12 })],
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    solver: { model: "faux/faux-solver", effort: "medium" },
    solve: { ...LIMITS, wallSeconds: 480 },
    models: () => models,
    log: log,
    repoRoot: scratch,
    practise: async (task, dir, harness) => {
      ran.push({ dir, digest: harness });
      const ending = queue.shift() ?? { outcome: "pass" };
      return { solve: solved(task.version, harness, ending), ending };
    },
  };
  /** pi's walled write, stood in for: the same tool name and paths, writing as the host. */
  const walled = (bench: Bench) => [
    tool({
      name: WRITE_FILE,
      description: "Writes a file in the home.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (args) => {
        const file = join(bench.home, args.path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, args.content);
        return text("Wrote it.");
      },
    }),
  ];
  const events = () => read(log);
  const of = (kind: EventKind) =>
    events()
      .filter((event) => event.kind === kind)
      .map(({ data }) => data);
  return {
    scratch,
    parent,
    home: home,
    host: host,
    request,
    walled,
    sent,
    events,
    of,
    digest,
    exam,
    ran,
    condition,
  };
}

describe("the Builder running its campaign", () => {
  it("holds practice to the current campaign total alone, including other seats and budget changes", async () => {
    const s = await setup([finish]);
    const left: number[] = [];
    await session(
      {
        ...s.request,
        cap: { dollars: 1, reserve: 1 },
        campaign: (bench) => {
          append(s.request.log, "exam.finished", { session: "x-1", billed: 10 });
          append(s.request.log, "campaign.opened", { budget: { dollars: 12, reserve: 1 } });
          left.push(practiceLeft(bench, read(s.request.log)));
          append(s.request.log, "campaign.opened", { budget: { dollars: 0, reserve: 1 } });
          left.push(practiceLeft(bench, read(s.request.log)));
          append(s.request.log, "campaign.opened", { budget: { dollars: 30, reserve: 1 } });
          left.push(practiceLeft(bench, read(s.request.log)));
          return { tools: [], hook: () => "Campaign spending is refreshed." };
        },
      },
      s,
      s.walled,
    );
    // Read after the session returns, so a session that never asks its campaign fails here. The
    // session's own count is 3 and its own cap $1: neither bounds a Builder that leads its campaign.
    expect(left).toEqual([2, 0, 20]);
  });

  it("keeps its conversation and edits across a nested Examiner call, and refreshes practice", async () => {
    const late: PracticeTask = {
      version: "late",
      task: { taskId: "late-practice", family: "fixture", publicInput: { base: 11 } },
    };
    const s = await setup([
      edit,
      call("examine", {}),
      call("read_opening", {}),
      call("practice", { tasks: [late.task.taskId] }),
      finish,
    ]);
    let opened = 0;
    let guidance = "Advice: examine";
    const built = await session(
      {
        ...s.request,
        models: (home, shutdown) => {
          opened += 1;
          return s.request.models(home, shutdown);
        },
        campaign: (bench) => ({
          hook: () => guidance,
          tools: [
            tool({
              name: "examine",
              description: "Run another seat and return its counts.",
              parameters: Type.Object({}),
              execute: async () => {
                expect(readFileSync(join(bench.home, GUIDE_PATH), "utf8")).toBe(GUIDE);
                expect(s.of("build.turn")).toHaveLength(2);
                append(s.request.log, "task.proposed", { version: late.version, hidden: CHECK });
                append(s.request.log, "task.gate", { version: late.version, gate: 1, outcome: "passed" });
                append(s.request.log, "task.state", { version: late.version, state: "released" });
                bench.tasks = [...bench.tasks, late];
                guidance = "Advice: compare";
                return text("Examiner returned; practice was refreshed.");
              },
            }),
          ],
        }),
      },
      s,
      s.walled,
    );
    expect(opened).toBe(1);
    expect(built.ended).toBe("finished");
    expect(s.ran).toHaveLength(1);
    expect(s.sent[2]).toContain("Examiner returned; practice was refreshed.");
    expect(s.sent[2]).toContain(GUIDE.trim());
    // The advice ends a campaign tool's result only where that tool appends it (`campaignTools`).
    expect(s.sent[2]).not.toContain("Advice: compare");
    expect(s.sent[3]).toContain(late.task.taskId);
    expect(s.sent.join("\n")).not.toContain(CHECK);
    expect(s.sent.join("\n")).not.toContain(REASON);
    expect(s.of("build.turn")).toHaveLength(5);
  });
});

describe("a Builder session", () => {
  it("refuses a held task handed to a session before showing it to the Builder", async () => {
    const s = await setup([]);
    const held = { version: "v3", task: { taskId: "t-3", family: "fixture", publicInput: {} } };
    await expect(session({ ...s.request, tasks: [...TASKS, held] }, s, s.walled)).rejects.toThrow();
    expect(s.of("build.started")).toEqual([]);
    expect(s.sent).toEqual([]);
    expect(existsSync(join(s.home, "practice", "t-3.json"))).toBe(false);
  });

  it("is given the parent's record, practises, reads a trace, and leaves a frozen version", async () => {
    const earned: RefereeFinding = {
      ruling: "earned",
      check: null,
      rule: "R1",
      field: "answer",
      reason: REASON,
      probes: [],
    };
    const s = await setup(
      [
        edit,
        call("practice", { tasks: ["t-1", "t-2"] }),
        call("read_trace", { solve: "s-3" }),
        call("read_trace", { solve: "s-3", call: 1 }),
        finish,
      ],
      [{ outcome: "fail", kind: "rejected" }, { outcome: "pass" }],
    );
    const built = await session(
      {
        ...s.request,
        referee: async (solve) => {
          append(s.request.log, "referee.finding", { solve, ...earned });
          return earned;
        },
      },
      s,
      s.walled,
    );
    expect(built).toMatchObject({ changed: true, ended: "finished" });
    expect(built.harness).not.toBe(s.digest);
    // The opening message: the public contract and the parent's record, from the log.
    expect(s.sent[0]).toContain("R1: The answer is the base times six.");
    expect(s.sent[0]).toContain("passed 0 of 1 under the harness you start from. Solves: s-1.");
    expect(s.sent[0]).toContain("t-2 (family fixture): not yet solved");
    expect(s.sent[0]).toContain("3 practice solves, 10 minutes and 12 turns");
    // Who solves, and what each solve is held to, which the session's own limits are not.
    for (const fact of ["faux/faux-solver at medium effort", "has 8 minutes and its model turns unlimited"]) {
      expect(s.sent[0]).toContain(fact);
    }
    // What the log holds of the campaign so far: the fail on record, and no notes yet.
    expect(s.sent[0]).toContain(`\\n- s-1, t-1, harness ${s.digest.slice(0, 8)}: fail (rejected); open.`);
    // No session before this one left notes, so the message opens on the rules and holds no notes
    // block: v1's starters are in the home, and an untouched starter renders nothing.
    expect(s.sent[0]).toContain(String.raw`{"role":"user","content":"Public rules of the domain:`);
    expect(s.sent[0]).not.toContain("Historical notes");
    expect(readFileSync(join(s.home, "MEMORY.md"), "utf8")).toStartWith("# Builder memory\n");
    expect(readFileSync(join(s.home, "SCRATCHPAD.md"), "utf8")).toStartWith("# Scratchpad\n");
    expect(s.sent[0]).toContain("(files up to 256 KB each, 4096 KB in all;");
    expect(s.sent[0]).not.toContain("Comparisons so far");
    expect(readFileSync(join(s.home, "practice", "t-1.json"), "utf8")).toContain('"base": 7');
    // The solver's public resources, in the home as one file, which the opening message names.
    expect(readFileSync(join(s.home, "resources.json"), "utf8")).toContain('"maxSpan": 12');
    expect(s.sent[0]).toContain("resources.json");
    // The practice result: endings, records under both harnesses, the budget. Until 2026-10-11 a
    // Diagnoser's reading of the fail came too (`7f0add79:docs/simplify.md`, E1).
    const practised = s.sent[2] ?? "";
    expect(practised).toContain("t-1: fail (rejected). Solve s-3.");
    expect(practised).toContain("passed 0 of 1. Under the harness you started from: 0 of 1.");
    expect(practised).not.toContain("Diagnosis");
    expect(practised).toContain("t-2: pass. Solve s-4.");
    expect(practised).toContain("1 practice solve left.");
    // The trace, listed and then one call whole.
    expect(s.sent[3]).toContain(String.raw`ending: fail (rejected)\nsubmitted answer: {\"answer\":\"41\"}`);
    // Each call listed with its size and the command it ran, which a Builder chose its reads by.
    expect(s.sent[3]).toContain(String.raw`\n1 bash (13 characters): run`);
    expect(s.sent[4]).toContain("result: margin of s-3");
    // Nothing of the verifier's side reached the Builder: not the check, not the Referee's reason.
    expect(s.sent.join("\n")).not.toContain(CHECK);
    expect(s.sent.join("\n")).not.toContain(REASON);
    // What the session leaves: the frozen state, its version with its parent, and its own record.
    expect(readFileSync(join(built.dir ?? "", "agent", "BUILT_AGENTS.md"), "utf8")).toBe(GUIDE);
    expect(s.of("harness.version")).toEqual([
      { version: built.harness, parent: s.digest, session: "b-1", note: "A shorter guide." },
    ]);
    expect(s.of("build.started")[0]).toMatchObject({ session: "b-1", parent: s.digest, tasks: ["v1", "v2"] });
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({
      ended: "finished",
      harness: built.harness,
      changed: true,
      practiceSolves: 2,
      disputed: [],
      turns: 5,
    });
    expect(s.of(BUILD_CALL).map(({ tool: name }) => name)).toEqual([
      WRITE_FILE,
      "practice",
      "read_trace",
      "read_trace",
      "finish",
    ]);
    expect(record(s.events(), "v1", built.harness ?? "")).toEqual({ solves: ["s-3"], passed: 0 });
  });

  it("opens on the notes its last session left and each comparison's tally, and leaves notes of its own", async () => {
    const long = "a lesson written by hand\n".repeat(400);
    const s = await setup([
      call(WRITE_FILE, {
        path: "MEMORY.md",
        content: "# Builder memory\n\nA table of factors did not help.\n",
      }),
      call(WRITE_FILE, { path: "scratch/gen.py", content: "print(6)\n" }),
      // A notes file over its limit: finish is refused with the notice, as v1's submit was.
      call(WRITE_FILE, { path: "SCRATCHPAD.md", content: long }),
      finish,
      call(WRITE_FILE, { path: "SCRATCHPAD.md", content: "# Scratchpad\n\n- try the base as a string\n" }),
      finish,
    ]);
    // What an earlier session, b-0, left: kept under the campaign as v1's carry writes it.
    const kept = join(s.request.memory, "b-0");
    mkdirSync(kept, { recursive: true });
    writeFileSync(
      join(kept, "MEMORY.md"),
      "<!-- carried forward from b-0, an earlier session of this campaign. Correct what no longer holds. -->\n\n# Builder memory\n\nThe base is always odd.\n",
    );
    append(s.request.log, "build.started", { session: "b-0", parent: s.digest, tasks: [] });
    append(s.request.log, "build.finished", {
      session: "b-0",
      ended: "finished",
      harness: null,
      changed: false,
    });
    append(s.request.log, "comparison.reported", {
      session: "b-0",
      old: s.digest,
      fresh: "f".repeat(64),
      reading: "no-step",
      scored: { wins: 1, losses: 0, ties: 6, p: 0.5 },
      versions: ["v0", "v3"],
    });
    await session(s.request, s, s.walled);
    // The notes block comes first in the opening message, ahead of the rules, under v1's header.
    expect(s.sent[0]).toContain(
      String.raw`{"role":"user","content":"Historical notes, model-authored and possibly stale. You wrote these files in earlier sessions,`,
    );
    expect(s.sent[0]).toContain(String.raw`--- MEMORY.md ---\n<!-- carried forward from b-0,`);
    expect(s.sent[0]).toContain("The base is always odd.");
    const opening = s.sent[0] ?? "";
    expect(opening.indexOf("The base is always odd.")).toBeLessThan(
      opening.indexOf("Public rules of the domain:"),
    );
    // The line names both harnesses: the one that was measured, and the one it was measured against.
    expect(s.sent[0]).toContain(
      `Harness ffffffff against harness ${s.digest.slice(0, 8)}, one comparison over 7 tasks: 1 won, 0 lost, 6 tied`,
    );
    // The held-out task's own fail is on record, and no line of the message is of it.
    expect(s.sent[0]).not.toContain(s.exam);
    expect(s.sent[4]).toContain("SCRATCHPAD.md is 10000 bytes, over its 2000-byte limit");
    expect(s.of(BUILD_FINISHED).at(-1)).toMatchObject({ session: "b-1", ended: "finished" });
    // Its own notes and its helper are kept for the next session, each note under v1's marker.
    const own = join(s.request.memory, "b-1");
    expect(readFileSync(join(own, "MEMORY.md"), "utf8")).toBe(
      "<!-- carried forward from b-1, an earlier session of this campaign. Correct what no longer holds. -->\n<!-- scratch/ holds b-1's 1 helper file: gen.py. -->\n\n# Builder memory\n\nA table of factors did not help.\n",
    );
    expect(readFileSync(join(own, "SCRATCHPAD.md"), "utf8")).toContain("- try the base as a string");
    expect(readFileSync(join(own, "scratch", "gen.py"), "utf8")).toBe("print(6)\n");
  });

  it("sets aside unestablished practice rejections in results, traces and later records, and takes a check defect's task out of practice", async () => {
    for (const ruling of ["unclear", "check-defect", null, "absent", "crashed"] as const) {
      const s = await setup(
        [
          call("practice", { tasks: ["t-2"] }),
          call("read_trace", { solve: "s-3" }),
          call("read_opening", {}),
          call("practice", { tasks: ["t-2"] }),
          finish,
        ],
        [{ outcome: "fail", kind: "rejected" }],
      );
      const referee = async (solve: string): Promise<RefereeFinding> => {
        if (ruling === "crashed") throw new Error(REASON);
        const finding: RefereeFinding = {
          ruling: ruling === "absent" ? null : ruling,
          check: CHECK,
          rule: null,
          field: null,
          reason: REASON,
          probes: [],
        };
        append(s.request.log, "referee.finding", { solve, ...finding });
        return finding;
      };
      const built = await session(ruling === "absent" ? s.request : { ...s.request, referee }, s, s.walled);
      const calls = s.of(BUILD_CALL);
      expect(calls[0]?.text).toContain("t-2: rejection set aside. Solve s-3.");
      expect(calls[1]?.text).toContain("ending: rejection set aside");
      expect(calls[2]?.text).not.toContain("- s-3,");
      // Only a ruled check defect closes the task: the next practice of it is refused, and any
      // other ruling's next pass, s-4, is the record's one solve.
      const defect = ruling === "check-defect";
      expect(record(s.events(), "v2", s.digest)).toEqual(
        defect ? { solves: [], passed: 0 } : { solves: ["s-4"], passed: 1 },
      );
      expect(s.sent.join("\n")).not.toContain(CHECK);
      expect(s.sent.join("\n")).not.toContain(REASON);
      expect(JSON.stringify(calls[3]?.text ?? null).includes("t-2 is no longer a practice task")).toBe(
        defect,
      );
      expect(s.of(BUILD_FINISHED)[0]).toMatchObject({
        practiceSolves: defect ? 1 : 2,
        disputed: defect ? ["v2"] : [],
        changed: false,
      });
      expect(built).toMatchObject({ changed: false, dir: null, harness: s.digest });
      expect(s.of("harness.version")).toEqual([]);
    }
  });

  // One practice solve, and the session's own turns billed $30 beside it, past a cap of $25. A led
  // session's dollars are the campaign's bounds, which the operator can raise: it goes on.
  it.each([
    { led: false, requests: 1, ended: "stopped", changed: false },
    { led: true, requests: 3, ended: "finished", changed: true },
  ])("stops at its own cap only where it does not lead its campaign: led $led", async (row) => {
    const s = await setup([call("practice", { tasks: ["t-1"] }), edit, finish]);
    const built = await session(
      {
        ...s.request,
        cap: { dollars: 25, reserve: 10 },
        ...keysIf(row.led, () => ({ campaign: () => ({ tools: [], hook: () => "" }) })),
        practise: async (task, dir, harness, kill) => {
          append(s.request.log, "build.turn", { session: "b-1", turn: 1, usage: { cost: { total: 30 } } });
          return await s.request.practise(task, dir, harness, kill);
        },
      },
      s,
      s.walled,
    );
    expect(s.sent).toHaveLength(row.requests);
    expect(built).toMatchObject({ changed: row.changed, ended: row.ended });
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ ended: row.ended, crash: null, practiceSolves: 1 });
  });

  it("refuses a trace of any solve but its practice tasks', and a practice past its budget", async () => {
    const s = await setup([
      call("read_trace", { solve: "s-2" }),
      call("practice", { tasks: ["t-1", "t-1", "t-2", "t-2"] }),
      call("practice", { tasks: ["t-9"] }),
      finish,
    ]);
    await session(s.request, s, s.walled);
    expect(s.exam).toBe("s-2");
    expect(s.sent[1]).toContain("s-2 is not a solve of one of this session's practice tasks");
    expect(s.sent[2]).toContain("only 3 practice solves left, and this asks for 4");
    expect(s.sent[3]).toContain("t-9 is not one of this session's practice tasks: t-1, t-2");
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ practiceSolves: 0 });
  });

  it("is shown no solve that a comparison made of a task released afterwards", async () => {
    const s = await setup([call("read_trace", { solve: "g-1-v0" }), finish]);
    const { log } = s.request;
    // v0 was held out, a comparison solved it under the harness this session starts from, and it
    // was released for practice afterwards. That solve is the comparison's, and which task it
    // failed is the exam's to keep, whatever became of the task.
    append(log, "solve.started", {
      solve: "g-1-v0",
      comparison: "g-1",
      condition: recordCondition(log, s.condition("v0", s.digest)),
      task: "t",
    });
    append(log, "solve.finished", { solve: "g-1-v0", ending: { outcome: "fail", kind: "rejected" } });
    append(log, "task.state", { version: "v0", state: "released" });
    const late = { version: "v0", task: { taskId: "t-0", family: "fixture", publicInput: { base: 5 } } };
    await session({ ...s.request, tasks: [...TASKS, late] }, s, s.walled);
    expect(s.sent[0]).toContain("- t-0 (family fixture): not yet solved under the harness you start from.");
    expect(s.sent[1]).toContain("g-1-v0 is not a solve of one of this session's practice tasks");
    expect(s.sent.join("\n").split("g-1-v0")).toHaveLength(3);
  });

  it.each(["pass", "fail", "non-result", "unpractised"] as const)(
    "reads counted practice after restoring an earlier exact state: %s",
    async (outcome) => {
      const other = call(WRITE_FILE, { path: GUIDE_PATH, content: `${GUIDE}Other method.\n` });
      const restored =
        outcome === "unpractised"
          ? call(WRITE_FILE, { path: GUIDE_PATH, content: `${GUIDE}Untried method.\n` })
          : edit;
      const ending: Ending =
        outcome === "fail"
          ? { outcome, kind: "no-answer" }
          : outcome === "non-result"
            ? { outcome, kind: "killed", reason: "Interrupted" }
            : { outcome: "pass" };
      const s = await setup(
        [
          edit,
          call("practice", { tasks: ["t-1"] }),
          other,
          call("practice", { tasks: ["t-1"] }),
          restored,
          fauxAssistantMessage("Reviewing the restored state."),
          finish,
          finish,
        ],
        [ending],
      );
      const counted = outcome === "pass" || outcome === "fail";
      const notice = "Next campaign move is available.";
      const built = await session(
        {
          ...s.request,
          campaign: () => ({
            tools: [],
            hook: () => "",
            unmeasured: async () => notice,
          }),
        },
        s,
        s.walled,
      );
      expect(built).toMatchObject({ ended: "finished" });
      expect(s.ran).toHaveLength(2);
      const finishes = s.of(BUILD_CALL).filter(({ tool: name }) => name === "finish");
      expect(finishes[0]?.text).toContain(notice);
      const firstNotice = finishes[0]?.text;
      expect(isString(firstNotice) && firstNotice.includes("no solve has run it as it stands")).toBe(
        !counted,
      );
      const continued = s.sent[6] ?? "";
      expect(
        continued.includes("no counted practice result as it stands") ||
          continued.includes("no solve has run it as it stands"),
      ).toBe(!counted);
      if (counted) expect(continued).toContain("counted practice");
      expect(finishes[1]?.isError).toBe(false);
    },
  );

  it("does not take a comparison snapshot as practice", async () => {
    const s = await setup([edit, call("freeze_for_comparison", {}), finish, finish]);
    await session(s.request, s, (bench) => [
      ...s.walled(bench),
      tool({
        name: "freeze_for_comparison",
        description: "Freezes the working harness.",
        parameters: Type.Object({}),
        execute: async () => {
          await snapshot(bench);
          return text("Frozen.");
        },
      }),
    ]);
    const finishes = s.of(BUILD_CALL).filter(({ tool: name }) => name === "finish");
    expect(finishes[0]?.text).toContain("no solve has run it as it stands");
    expect(finishes[1]?.isError).toBe(false);
    expect(s.ran).toHaveLength(0);
  });

  it("practises under the reference harness where asked, and is told the record of the harness that ran", async () => {
    // What the reference does on a released task is the Builder's to find out, and the host hands
    // it no table of it (the plan's climb section, C5). Until 27 October the record named harness/
    // and the parent whatever ran, so a solve under the reference came back without its record.
    const s = await setup([
      edit,
      call("practice", { tasks: ["t-1"] }),
      call("practice", { tasks: ["t-1"], under: "reference" }),
      finish,
    ]);
    await session(s.request, s, s.walled);
    expect(s.ran[1]).toEqual({ dir: s.request.reference, digest: s.digest });
    expect(s.ran[0]?.digest).not.toBe(s.digest);
    expect(s.sent[3]).toContain("t-1 under the reference harness: pass. Solve s-4.");
    // The reference is the parent here, so its digest is named once with both roles.
    expect(s.sent[3]).toContain("which is also the harness you started from: passed 1 of 2.");
    expect(s.sent[3]).toContain("Under harness/ as last practised: 1 of 1.");
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ practiceSolves: 2 });
  });

  it("is not given the correctness model a v1 state carries, whose battery holds hidden values", async () => {
    const s = await setup([finish]);
    // A v1 state keeps it at its root and again under each bundle snapshot.
    const kept = ["correctness-model", ".bundle-snapshots/4cc4dd31/correctness-model"];
    for (const dir of kept) {
      mkdirSync(join(s.parent, dir), { recursive: true });
      writeFileSync(join(s.parent, dir, "tasks.json"), '[{"hidden":{}}]');
    }
    let given: boolean[] = [];
    await session(s.request, s, (bench) => {
      given = ["agent", ...kept].map((name) => existsSync(join(bench.home, "harness", name)));
      return s.walled(bench);
    });
    expect(given).toEqual([true, false, false]);
  });

  it("installs into its own copy of the parent's programs, and freezes no script or link naming its home", async () => {
    const bin = (s: { home: string }) => join(s.home, "harness", ".toolchain", "bin");
    const s = await setup(
      [
        call("practice", { tasks: ["t-1"] }),
        () => {
          // An install as one writes itself by default: a launcher and a link by the home's path.
          writeFileSync(join(bin(s), "greet"), `#!/bin/sh\nexec ${bin(s)}/hello\n`);
          chmodSync(join(bin(s), "greet"), 0o755);
          symlinkSync(join(bin(s), "hello"), join(bin(s), "linked"));
          return call("practice", { tasks: ["t-1"] });
        },
        () => {
          writeFileSync(join(bin(s), "greet"), '#!/bin/sh\nexec "$(dirname "$0")/hello"\n');
          rmSync(join(bin(s), "linked"));
          symlinkSync("hello", join(bin(s), "linked"));
          return call("practice", { tasks: ["t-1"] });
        },
        finish,
      ],
      [],
      true,
    );
    const built = await session(s.request, s, s.walled);
    // An untouched copy is the parent, by digest.
    expect(s.ran[0]?.digest).toBe(s.digest);
    expect(JSON.stringify(s.of(BUILD_CALL)[1])).toContain(
      "harness/.toolchain/bin/greet, harness/.toolchain/bin/linked name your home",
    );
    // Written to run from where it is, what it installed runs from the state the solve was given.
    expect(s.ran).toHaveLength(2);
    expect(s.ran[1]?.digest).not.toBe(s.digest);
    const greet = Bun.spawnSync([join(s.ran[1]?.dir ?? "", ".toolchain", "bin", "greet")]);
    expect(greet.stdout.toString()).toBe("hello-from-the-tool-tree\n");
    expect(built).toMatchObject({ harness: s.ran[1]?.digest, changed: true });
    expect(existsSync(join(s.parent, ".toolchain", "bin", "greet"))).toBe(false);
    // Four freezes kept two copies of the tree: the refused one is gone, and an unchanged tree is
    // not copied again.
    const trees = readdirSync(s.request.states).filter((name) => name.startsWith("tree-"));
    expect(trees).toHaveLength(2);
    // A state goes where its campaign's folder goes, its tree beside it. Linked by the tree's whole
    // path, one moved with its campaign opened with no tree and under another digest, and a
    // comparison paid for two solves of that harness before it stopped (2026-10-09).
    const moved = `${s.request.states}-moved`;
    renameSync(s.request.states, moved);
    const reopened = await openHarness(join(moved, s.ran[1]?.digest ?? ""));
    expect(reopened.digest).toBe(s.ran[1]?.digest ?? "");
  });

  it("freezes no tool tree that is a link out of its home, and copies nothing it names", async () => {
    // Until 11 October the freeze copied what the link named into the tree every later solve reads.
    const tree = (s: { home: string }) => join(s.home, HOME_TOOL_TREE);
    const s = await setup(
      [
        () => {
          const outside = join(dirname(s.home), "outside");
          mkdirSync(outside);
          writeFileSync(join(outside, "secret.txt"), "OUTSIDE-CANARY\n");
          rmSync(tree(s), { recursive: true });
          symlinkSync(outside, tree(s));
          return call("practice", { tasks: ["t-1"] });
        },
        finish,
      ],
      [],
      true,
    );
    await session(s.request, s, s.walled);
    expect(JSON.stringify(s.of(BUILD_CALL)[0])).toContain(
      "the harness does not open: harness/.toolchain is a link, or lies outside your home",
    );
    expect(s.ran).toHaveLength(0);
    const copies = readdirSync(s.request.states).filter((name) => name.startsWith("tree-"));
    expect(copies.filter((name) => existsSync(join(s.request.states, name, "secret.txt")))).toEqual([]);
  });

  it("ends when a practice solve could not be run, and does not show the Builder why", async () => {
    const s = await setup([call("practice", { tasks: ["t-1", "t-2"] }), finish]);
    const stop = `the verifier could not decide t-1, so the run stops: ${CHECK}: threw`;
    // Two solves side by side: one throws, and the other ends only when the halt reaches it. Were
    // it not told, this test would wait on it for ever.
    let reached = false;
    await expect(
      session(
        {
          ...s.request,
          practise: async (task, _dir, _digest, kill) => {
            if (task.version === "v1") throw new Error(stop);
            await new Promise((resolve) => kill.addEventListener("abort", resolve, { once: true }));
            reached = true;
            return { solve: "s-killed", ending: { outcome: "non-result", kind: "killed", reason: "killed" } };
          },
        },
        s,
        s.walled,
      ),
    ).rejects.toThrow(stop);
    expect(reached).toBe(true);
    // The session's record is written before it throws, and names the cause for the host alone.
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "crashed", crash: stop, changed: false });
    expect(JSON.stringify(s.of(BUILD_CALL)[0])).toContain("A practice solve could not be run");
    expect(JSON.stringify(s.of(BUILD_CALL))).not.toContain(CHECK);
    expect(s.sent.join("\n")).not.toContain(CHECK);
    expect(s.of(BUILD_CALL).map(({ tool: name }) => name)).toEqual(["practice"]);
  });

  // Found in buffer-149, 13 October: b-1 crashed on a provider error with a harness it had
  // practised three of three on, and b-2 started from the starter.
  it("keeps the harness a crashed session last practised as a checkpoint, and no edit after it", async () => {
    const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" });
    const tried = await setup([edit, call("practice", { tasks: ["t-1"] }), failed]);
    const kept = await session(tried.request, tried, tried.walled);
    expect(kept).toMatchObject({ changed: true, ended: "crashed" });
    expect(tried.of("build.checkpoint")).toEqual([{ session: "b-1", harness: kept.harness }]);
    // The checkpointed crash moved the campaign, so the provider's crash rule does not count it.
    expect(crashedRun(read(tried.request.log)).count).toBe(0);
    // A crash after an edit no solve ran keeps the state the practice solve ran, not the edit,
    // which may be half done.
    const later = call(WRITE_FILE, { path: GUIDE_PATH, content: `${GUIDE}More.\n` });
    const edited = await setup([edit, call("practice", { tasks: ["t-1"] }), later, failed]);
    const ran = await session(edited.request, edited, edited.walled);
    expect(ran).toMatchObject({ changed: true, ended: "crashed" });
    expect(ran.harness).not.toBe(kept.harness);
    expect(edited.of("build.checkpoint")).toEqual([{ session: "b-1", harness: kept.harness }]);
    expect(crashedRun(read(edited.request.log)).count).toBe(0);
    // A crash in a session that never practised leaves nothing: no state of it was run.
    const unpractised = await setup([edit, failed]);
    expect(await session(unpractised.request, unpractised, unpractised.walled)).toMatchObject({
      changed: true,
      ended: "crashed",
    });
    expect(unpractised.of("build.checkpoint")).toEqual([]);
    expect(crashedRun(read(unpractised.request.log)).count).toBe(1);
  });

  it.each(["practised", "controlled", "unpractised", "missing", "mismatched", "checkpointed"])(
    "recovers a cut session from its last practised state only where it opens: %s",
    async (state) => {
      const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" });
      const later = call(WRITE_FILE, { path: GUIDE_PATH, content: `${GUIDE}More.\n` });
      // A control under the reference, here the parent, after the practice is not the state the
      // session left.
      const control =
        state === "controlled" ? [call("practice", { tasks: ["t-1"], under: "reference" })] : [];
      const practice = state === "unpractised" ? [] : [call("practice", { tasks: ["t-1"] }), ...control];
      const s = await setup([edit, ...practice, later, failed]);
      await session(s.request, s, s.walled);
      // A stopped process never reached the finaliser. Reproduce that prefix as a fixture log.
      const cut = join(s.scratch, "cut.jsonl");
      for (const event of read(s.request.log)) {
        if (event.kind === "harness.version") break;
        append(cut, event.kind, event.data);
      }
      const digest = s.ran.findLast((ran) => ran.digest !== s.digest)?.digest ?? null;
      if (digest !== null) {
        const saved = join(s.request.states, digest);
        if (state === "missing") renameSync(saved, `${saved}-missing`);
        if (state === "mismatched") writeFileSync(join(saved, "agent/BUILT_AGENTS.md"), "Other bytes.\n");
        if (state === "checkpointed") append(cut, "build.checkpoint", { session: "b-1", harness: digest });
      }
      await endCut(cut);
      const checkpoints = () => read(cut).filter(({ kind }) => kind === "build.checkpoint");
      const recoverable = ["practised", "controlled", "checkpointed"].includes(state);
      expect(checkpoints().map(({ data }) => data)).toEqual(
        recoverable ? [{ session: "b-1", harness: digest }] : [],
      );
      expect(read(cut).at(-1)).toMatchObject({
        kind: BUILD_FINISHED,
        data: { session: "b-1", ended: "killed" },
      });
      const ended = read(cut).length;
      await endCut(cut);
      expect(read(cut)).toHaveLength(ended);
      if (!recoverable) return;
      expect(latestBuilt(read(cut))).toBe(digest);
      const parent = await keptAs({ log: cut, states: s.request.states }, "--parent", "latest");
      const resumed = await setup([finish]);
      await session(
        { ...resumed.request, id: "b-2", log: cut, parent: parent.dir, states: s.request.states },
        resumed,
        resumed.walled,
      );
      expect(read(cut).findLast(({ kind }) => kind === "build.started")?.data.parent).toBe(digest);
      expect(readFileSync(join(resumed.home, GUIDE_PATH), "utf8")).toBe(GUIDE);
      expect(checkpoints()).toHaveLength(1);
    },
  );

  it.each(["practised", "unpractised"])(
    "keeps only practised bytes when a live session is killed: %s",
    async (state) => {
      const practice = state === "practised";
      const kill = new AbortController();
      const later = call(WRITE_FILE, { path: GUIDE_PATH, content: `${GUIDE}More.\n` });
      const s = await setup([
        edit,
        ...(practice ? [call("practice", { tasks: ["t-1"] })] : []),
        later,
        () => {
          kill.abort();
          return fauxAssistantMessage("");
        },
      ]);
      expect(await session({ ...s.request, kill: kill.signal }, s, s.walled)).toMatchObject({
        ended: "killed",
      });
      expect(s.of("build.checkpoint")).toEqual(
        practice ? [{ session: "b-1", harness: s.ran.at(-1)?.digest ?? null }] : [],
      );
    },
  );

  it("freezes no harness whose tools do not list, and shows the Builder no path of the host's", async () => {
    const s = await setup([
      call("practice", { tasks: ["t-1"] }),
      call(WRITE_FILE, { path: "harness/agent/tools.ts", content: 'import "./missing.ts";\n' }),
      call("practice", { tasks: ["t-1"] }),
      finish,
    ]);
    // A wall's listing, stood in for: this harness's tools never list.
    const walled = (bench: Bench) => {
      bench.lists = async () => {
        throw new Error("domain tool mismatch: generated [a], recorded [b]");
      };
      return s.walled(bench);
    };
    const built = await session(s.request, s, walled);
    expect(JSON.stringify(s.of(BUILD_CALL)[0])).toContain("the harness does not open: domain tool mismatch");
    expect(built).toMatchObject({ harness: null, changed: false });
    expect(s.ran).toEqual([]);
    // A bundle that fails names the file by where the harness keeps it, never by where the host froze it.
    const unresolved = JSON.stringify(s.of(BUILD_CALL)[2]);
    expect(unresolved).toContain("the harness does not open");
    expect(JSON.stringify(s.of(BUILD_CALL))).not.toContain(s.request.states);
    expect(JSON.stringify(s.of(BUILD_CALL))).not.toContain(s.scratch);
  });

  it("ends at its wall, and blames no host, when the wall reaches a practice solve queued at the host", async () => {
    const s = await setup([call("practice", { tasks: ["t-1", "t-2"] }), finish]);
    const built = await session(
      {
        ...s.request,
        limits: { ...LIMITS, wallSeconds: 1 },
        // t-1 is in flight and ends killed; t-2 waits at the host's gate, which leaves on the kill
        // with its reason before any solve starts (`gated`, `tools/d2/host.ts`).
        practise: async (task, _dir, _digest, kill) => {
          if (!kill.aborted) {
            await new Promise((resolve) => kill.addEventListener("abort", resolve, { once: true }));
          }
          if (task.version === "v2") kill.throwIfAborted();
          return { solve: "s-killed", ending: { outcome: "non-result", kind: "killed", reason: "killed" } };
        },
      },
      s,
      s.walled,
    );
    expect(built).toMatchObject({ ended: "wall", changed: false });
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "wall", crash: null, practiceSolves: 1 });
    expect(JSON.stringify(s.of(BUILD_CALL))).not.toContain("the host's fault");
  });

  it("takes a task out of practice when its own check could not run", async () => {
    const s = await setup(
      [call("practice", { tasks: ["t-2"] }), call("practice", { tasks: ["t-2"] }), finish],
      [{ outcome: "non-result", kind: "check", reason: `${CHECK}: threw` }],
    );
    await session(s.request, s, s.walled);
    expect(s.sent[1]).toContain("t-2: no result (check). Solve s-3.");
    expect(s.sent[1]).toContain("The task's own check could not run on this answer");
    expect(s.sent[2]).toContain("t-2 is no longer a practice task");
    expect(s.sent.join("\n")).not.toContain(CHECK);
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({
      practiceSolves: 1,
      faultyChecks: ["v2"],
      disputed: [],
    });
  });
});

// Fix row F19, and rule 3 of AGENTS.md: nothing crosses from the exam side to the build side but
// a closed list. Until 2026-10-09 the tests held three canaries (a check's name, the Referee's
// reason, a held-out solve's id) and no proof of the rest. Here two campaigns are alike in
// everything a Builder may know and differ in everything it may not, and a session over each has
// to read the same bytes.
describe("what crosses to the Builder", () => {
  /** What a campaign keeps from its Builder: the check that refused an answer, the Referee's
   *  reason, the hidden value of a held-out task and of a practice task, which held-out task the
   *  comparison's new harness won. */
  interface Kept {
    readonly check: string;
    readonly reason: string;
    readonly hidden: string;
    readonly won: "h1" | "h2";
  }
  const ONE: Kept = {
    check: "check-one-7a1",
    reason: "reason-one-7a1",
    hidden: "hidden-one-7a1",
    won: "h1",
  };
  const OTHER: Kept = {
    check: "check-two-c4e",
    reason: "reason-two-c4e",
    hidden: "hidden-two-c4e",
    won: "h2",
  };
  const FRESH = "f".repeat(64);

  /**
   * Everything a Builder reads in one session over a campaign that keeps `kept` from it: every
   * context its model was sent, which holds its system prompt, its tools' descriptions, the
   * opening, every tool result and every continuation, and every file of its home. The host's
   * clock and the scratch's own path are taken out, since two runs differ in them and neither is
   * the exam's. `leak` puts the check that refused into a practice solve's trace, which a Builder
   * pages: a held-out detail in a Builder's message.
   */
  async function read_(kept: Kept, leak: "sealed" | "leaking" = "sealed"): Promise<string> {
    const stop = fauxAssistantMessage("I think that is enough.");
    const s = await setup(
      [
        edit,
        call("practice", { tasks: ["t-1", "t-2"] }),
        // Under the reference harness too: what that reads is the wall's to keep (11 October).
        call("practice", { tasks: ["t-1"], under: "reference" }),
        call("read_trace", { solve: "s-3" }),
        // The leaking case pages the call the leak put the check into.
        call("read_trace", { solve: "s-3", call: leak === "leaking" ? 2 : 1 }),
        call("read_opening", {}),
        stop,
        finish,
      ],
      [{ outcome: "fail", kind: "rejected" }, { outcome: "pass" }, { outcome: "pass" }],
      false,
      kept.check,
    );
    const { log } = s.request;
    // The exam side of the campaign: two held-out tasks with hidden values, and one comparison in
    // which the new harness won one of them and tied the other. Both campaigns hold the same
    // events in the same order, so every id a Builder may see is the same.
    for (const version of ["h1", "h2"]) {
      const task = {
        taskId: `x-${version}`,
        family: "fixture",
        publicInput: { base: 3 },
        hidden: kept.hidden,
      };
      append(log, "task.proposed", { version, taskId: task.taskId, session: "x-1", task });
      append(log, "task.gate", { version, gate: 1, outcome: "passed" });
      append(log, "task.feasible", { version, session: "x-1", answer: kept.hidden });
    }
    for (const version of ["h1", "h2"]) {
      for (const side of [s.digest, FRESH]) {
        const solve = `g-1-${version}-${side.slice(0, 4)}`;
        const lost = version === kept.won && side === s.digest;
        // Under a recorded condition, as a comparison's solves are, so that what keeps them from
        // the Builder is the wall's filter and not a malformed event; and with a trace that names
        // the hidden value, which no Builder may page.
        append(log, "solve.started", {
          solve,
          comparison: "g-1",
          condition: recordCondition(log, s.condition(version, side)),
          task: `x-${version}`,
        });
        append(log, "solve.call", {
          solve,
          turn: 1,
          tool: "bash",
          args: { command: "run" },
          isError: false,
          text: `answer ${kept.hidden}`,
        });
        if (lost) {
          append(log, "verdict", {
            solve,
            answer: { answer: kept.hidden },
            kind: "fail",
            blocking: [kept.check],
          });
          append(log, "referee.refused", {
            solve,
            task: `x-${version}`,
            asked: { ruling: "check-defect", check: kept.check, reason: kept.reason, probes: [] },
            why: `a check-defect names one of the refusing checks: ${kept.check}`,
          });
          append(log, "referee.finding", { solve, ruling: "earned", check: kept.check, reason: kept.reason });
        }
        append(log, "solve.finished", {
          solve,
          ending: lost ? { outcome: "fail", kind: "rejected" } : { outcome: "pass" },
        });
      }
    }
    append(log, "comparison.reported", {
      session: "g-1",
      old: s.digest,
      fresh: FRESH,
      reading: "no-step",
      scored: { wins: 1, losses: 0, ties: 1, p: 0.5, unsolved: 0 },
      versions: kept.won === "h1" ? ["h1", "h2"] : ["h2", "h1"],
      aside: [],
    });
    // The practice tasks carry hidden values too, which differ between the two campaigns: what a
    // Builder is shown of a released task is its public part alone.
    const tasks = TASKS.map(({ version, task }) => ({ version, task: { ...task, hidden: kept.hidden } }));
    await session(
      {
        ...s.request,
        tasks,
        referee: async () => ({
          ruling: "earned",
          check: kept.check,
          rule: "R1",
          field: "answer",
          reason: kept.reason,
          probes: [],
        }),
        practise: async (task, dir, harness, kill) => {
          const made = await s.request.practise(task, dir, harness, kill);
          if (leak === "leaking") {
            append(log, "solve.call", {
              solve: made.solve,
              turn: 2,
              tool: "bash",
              args: { command: "cat verdict" },
              isError: false,
              text: `refused by ${kept.check}`,
            });
          }
          return made;
        },
      },
      s,
      s.walled,
    );
    const files = readdirSync(s.home, { recursive: true, withFileTypes: true }).flatMap((entry) =>
      entry.isFile()
        ? [
            `${join(entry.parentPath, entry.name)}\n${readFileSync(join(entry.parentPath, entry.name), "utf8")}`,
          ]
        : [],
    );
    return (
      [...s.sent, ...files.toSorted()]
        .join("\n")
        .replaceAll(s.scratch, "<scratch>")
        .replaceAll(/"(timestamp|durationMs)":\d+/g, '"$1":0')
        // The scripted provider names itself and each of its calls anew in every set-up.
        .replaceAll(/(faux|tool):\d+:\w+/g, "$1")
        .replaceAll(/\d+:\d\d of 10:00 used/g, "0:00 of 10:00 used")
    );
  }

  it("is byte-identical whatever a hidden value, a check, a ruling, or the task that was won is", async () => {
    const [one, other] = [await read_(ONE), await read_(OTHER)];
    // The session read what a Builder may: its tasks, the fail, the trace, the opening again, the
    // continuation, and the comparison as a tally.
    expect(one).toContain("Solve s-3.");
    expect(one).toContain("- s-1, t-1, harness");
    expect(one).toContain("result: margin of s-3");
    expect(one).toContain("1 won, 0 lost, 1 tied, which reads no step.");
    expect(one).toContain("You have not called finish");
    expect(one).toContain("practice/t-1.json");
    for (const kept of [ONE, OTHER]) {
      for (const canary of [kept.check, kept.reason, kept.hidden, "x-h1", "x-h2", "g-1-h"]) {
        expect(one).not.toContain(canary);
      }
    }
    expect(one === other).toBe(true);
  }, 60_000);

  // The nearest hostile case: a solve's trace that names the check that refused. The solver is
  // shown no check, so this cannot happen by its seat; it stands in for any path that would put a
  // held-out detail into a message, and the comparison above then fails.
  it("is not, once a held-out detail reaches one message", async () => {
    const [one, other] = [await read_(ONE, "leaking"), await read_(OTHER, "leaking")];
    expect(one === other).toBe(false);
    expect(one).toContain(ONE.check);
  }, 60_000);
});

describe("what a practice solve used", () => {
  it("is its time of its limit, the model's turns and the tokens it read and wrote, and nothing where the log holds no limits", async () => {
    const s = await setup([call("practice", { tasks: ["t-1", "t-2", "t-1"] }), finish]);
    const limits = { ...LIMITS, wallSeconds: 480 };
    // As a live runner logs them: the limits on the start, the usage on the end. A live solve's end
    // carries its tokens, the one measure of what a tool or a program costs a solve that a Builder
    // can act on. The third start holds no limits.
    const used = [
      {
        started: { limits: { ...limits, modelTurns: 10 } },
        finished: {
          turns: 2,
          seconds: 4.7,
          tokens: { input: 4, cacheRead: 4105, cacheWrite: 4285, cacheWrite1h: 0, output: 131 },
        },
      },
      { started: { limits }, finished: { turns: 14, seconds: 222.4 } },
      { started: {}, finished: { turns: 3, seconds: 60 } },
    ];
    let n = 0;
    await session(
      {
        ...s.request,
        practise: async (task, _dir, harness) => {
          const { started, finished } = used[n] ?? { started: {}, finished: {} };
          n += 1;
          const solve = `s-used-${String(n)}`;
          const condition = recordCondition(s.request.log, s.condition(task.version, harness));
          append(s.request.log, "solve.started", { solve, condition, task: "t", ...started });
          append(s.request.log, "solve.finished", { solve, ending: { outcome: "pass" }, ...finished });
          return { solve, ending: { outcome: "pass" } };
        },
      },
      s,
      s.walled,
    );
    // What the provider is sent is the context as JSON, where a line's end is escaped.
    const line = (said: string) => JSON.stringify(`${said}\n`).slice(1, -1);
    expect(s.sent[1]).toContain(
      line(
        "t-1: pass. Solve s-used-1. It took 0:04 of 8:00 and 2 model turns of 10, and read 8394 tokens and wrote 131.",
      ),
    );
    expect(s.sent[1]).toContain(line("t-2: pass. Solve s-used-2. It took 3:42 of 8:00 and 14 model turns."));
    expect(s.sent[1]).toContain(line("t-1: pass. Solve s-used-3."));
  });
});

describe.skipIf(!osIsolationSupport().ok)("a Builder session under the command wall", () => {
  it("writes its harness through the wall, checks it, and cannot read the repository", async () => {
    // The scratch stands for the repository: the wall closes it, and the log and a canary sit in it.
    let canary = "";
    const s = await setup(
      [
        () => call("bash", { command: `cat '${canary}' 2>&1; echo "read:$?"` }),
        // pi's write, behind the wall: outside the seat's root nothing is kept, and a folder is no file.
        call(WRITE_FILE, { path: "../../escape.txt", content: "x" }),
        call(WRITE_FILE, { path: "harness/agent", content: "x" }),
        edit,
        call("bash", { command: 'cat "$HOME/harness/agent/BUILT_AGENTS.md"; ls "$HOME/practice"' }),
        // The parent's installed program runs by name, and so does one the Builder installs beside it.
        call("bash", {
          command: [
            'cd "$HOME/harness/.toolchain/bin"',
            String.raw`printf '#!/bin/sh\necho installed-greeting\n' > real`,
            String.raw`printf '#!/bin/sh\nexec "$(dirname "$0")/real"\n' > greet`,
            String.raw`printf "#!/bin/sh\nexec $PWD/real\n" > named`,
            "chmod +x real greet named && cd && hello && greet",
          ].join(" && "),
        }),
        call("check_harness", {}),
        call("bash", { command: 'rm "$HOME/harness/.toolchain/bin/named"' }),
        call("check_harness", {}),
        // A command starts in the home, where the account of a harness's files is.
        call("bash", { command: "pwd -P; head -1 HARNESS.md" }),
        // pi's read and edit on the harness's files, by the path the shell would use.
        call("edit", {
          path: GUIDE_PATH,
          edits: [{ oldText: "Multiply", newText: "Always multiply" }],
        }),
        call("read", { path: GUIDE_PATH }),
        call("preview_harness", {}),
        call("bash", { command: "cat harness/agent/BUILT_AGENTS.md; ls harness/.toolchain/bin" }),
        edit,
        finish,
      ],
      [],
      true,
    );
    canary = join(s.scratch, "canary.txt");
    writeFileSync(canary, CHECK);
    const request = {
      ...s.request,
      limits: { ...LIMITS, turns: 20 },
      id: `b-${String(runtimeProcess.pid)}-${s.scratch.slice(-6)}`,
    };
    const responses = s.sent;
    const built = await build(request);
    const calls = s.of(BUILD_CALL).map(({ text: said }) => JSON.stringify(said));
    expect(calls[0]).toContain(CLOSED);
    expect(calls[0]).toContain("read:1");
    // Outside the seat's root nothing is kept: Seatbelt refuses the write, and Bubblewrap lets it
    // land in the command's own /tmp, which goes with the command.
    expect(existsSync(join(BUILT_COMMAND_SCRATCH_ROOT, "escape.txt"))).toBe(false);
    expect(calls[2]).toContain("irectory");
    expect(calls[4]).toContain("Multiply before you record.");
    expect(calls[4]).toContain("t-1.json");
    expect(calls[5]).toContain("hello-from-the-tool-tree");
    expect(calls[5]).toContain("installed-greeting");
    expect(calls[6]).toContain("harness/.toolchain/bin/named name your home");
    // A line for each part of the harness, and no note on tools beside the shell: the choice is the
    // Builder's, and the account states what each costs.
    expect(calls[8]).toContain(
      String.raw`The harness opens.\npi's tools: bash.\nPrograms: greet, hello, real.\nGuide: 28 characters.\nTools of its own: scale_base, read_path.`,
    );
    expect(calls[8]).not.toContain("same thing twice");
    expect(calls[9]).toContain(String.raw`/home\n# The Built Harness`);
    expect(calls[10]).toContain("Successfully replaced 1 block(s)");
    expect(calls[11]).toContain("Always multiply before you record.");
    // The preview is the solver's prompt: pi's own, the guide as its project's instructions, the
    // installed programs by name, and the solve's limits and not the session's.
    expect(calls[12]).toContain("You are an expert coding assistant operating inside pi");
    expect(calls[12]).toContain(
      String.raw`<project_instructions path=\"BUILT_AGENTS.md\">\nAlways multiply before you record.`,
    );
    expect(calls[12]).toContain("The case has 8 minutes of solve time");
    expect(calls[12]).toContain("Programs this harness installed run by name: ");
    expect(calls[12]).toContain("- submit: Send answer.json from your working directory as your answer.");
    expect(calls[13]).toContain("greet");
    expect(responses.join("\n")).not.toContain(CHECK);
    expect(built).toMatchObject({ changed: true, ended: "finished" });
    expect(readFileSync(join(built.dir ?? "", "agent", "BUILT_AGENTS.md"), "utf8")).toBe(GUIDE);
    const greet = Bun.spawnSync([join(built.dir ?? "", ".toolchain", "bin", "greet")]);
    expect(greet.stdout.toString()).toBe("installed-greeting\n");
    expect(existsSync(join(s.parent, ".toolchain", "bin", "greet"))).toBe(false);
    // A check keeps no state: the one kept is the session's last, beside the one copy of its tree.
    const kept = readdirSync(request.states);
    const states = kept.filter((name) => !name.startsWith("tree-"));
    expect(states).toEqual([built.harness ?? ""]);
    expect(kept).toHaveLength(2);
    // And no copy of the tree is left that no state links. A check keeps nothing and copies the
    // tree all the same, and buffer's first session left a 6.4 MB copy linked by none of its four
    // states (2026-10-10); a truss tree is 316 MB.
    const linked = states.map((state) => readlinkSync(join(request.states, state, ".toolchain")));
    for (const name of kept.filter((each) => each.startsWith("tree-"))) {
      expect(linked).toContain(join("..", name));
    }
  }, 120_000);
});
