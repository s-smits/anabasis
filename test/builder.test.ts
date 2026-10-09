// One Builder session on the faux provider. Without a wall: what it is given, what a practice
// returns and never returns, the reviewers' part, the budget, the freeze and the record it leaves.
// The three walled tools are stood in for by a host write here; the session under the real command
// wall is the last block, which runs on Darwin alone.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type BuildRequest, build, type PracticeTask, session } from "../src/builder/session.ts";
import { type Bench, endingText, record, usedText } from "../src/builder/tools.ts";
import { type Condition, recordCondition } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { isFunction, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import type { RefereeFinding } from "../src/review/referee.ts";
import { publicResource, text, tool } from "../src/solve/answer.ts";
import { openHarness } from "../src/solve/harness.ts";

const BUILD_CALL = "build.call";
const BUILD_FINISHED = "build.finished";
const WRITE_FILE = "write";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
/** A check's id and a Referee's reason: verifier-side text no Builder may be shown. */
/** How the message sent after a turn with no tool call begins. */
const GOES_ON = "You have not called finish";
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
  diskBytes: 64 * 1024 * 1024,
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
const edit = call(WRITE_FILE, { path: "harness/agent/BUILT_AGENTS.md", content: GUIDE });
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
  /** A solve as the runner logs one: its condition, a call, a verdict naming the check, its ending. */
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
    if (ending.outcome !== "pass") {
      record_("verdict", { solve, answer: { answer: "41" }, kind: "fail", blocking: [check] });
    }
    record_("solve.finished", { solve, ending });
    return solve;
  };
  // Solves on record before the session: v1 failed once, and v3 is a held-out task's.
  solved("v1", digest, { outcome: "fail", kind: "rejected" });
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
    states: join(scratch, "states"),
    memory: join(scratch, "memory"),
    tasks: TASKS,
    contract: CONTRACT,
    resources: [publicResource("span table", { maxSpan: 12 })],
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
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
      label: "write",
      description: "Writes a file in the home.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, args) => {
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
  };
}

describe("a Builder session", () => {
  it("practises on released tasks only, whatever it is handed", async () => {
    const s = await setup([]);
    const exam = { version: "v3", task: { taskId: "t-3", family: "fixture", publicInput: {} } };
    await expect(session({ ...s.request, tasks: [...TASKS, exam] }, s, s.walled)).rejects.toThrow(
      "task t-3 is held, and a Builder practises on released tasks only",
    );
    const anchor = { version: "v0", task: { taskId: "t-0", family: "fixture", publicInput: {} } };
    await expect(session({ ...s.request, tasks: [anchor] }, s, s.walled)).rejects.toThrow("task t-0 is held");
    expect(s.of("build.started")).toEqual([]);
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
        referee: async () => earned,
        diagnose: async () => ({
          owner: "harness",
          cause: "The guide never says to multiply.",
          falsifier: "A later solve that multiplies and still answers 41.",
          firstDivergence: "margin of s-3",
          contrastSuccess: null,
          confidence: "low",
        }),
      },
      s,
      s.walled,
    );
    expect(built).toMatchObject({ changed: true, ended: "finished" });
    expect(built.harness).not.toBe(s.digest);
    // The opening message: the public contract and the parent's record, from the log.
    expect(s.sent[0]).toContain("R1: The answer is the base times six.");
    expect(s.sent[0]).toContain(
      "t-1 (family fixture): passed 0 of 1 under the harness you start from. Solves: s-1.",
    );
    expect(s.sent[0]).toContain("t-2 (family fixture): not yet solved under the harness you start from.");
    expect(s.sent[0]).toContain("3 practice solves, 10 minutes and 12 turns");
    // What the log holds of the campaign so far: the fail on record, and no notes yet.
    expect(s.sent[0]).toContain(
      `You start from harness ${s.digest.slice(0, 8)}. Every failed practice solve of these tasks in this campaign so far, oldest first, with where it stands now; read_trace opens each:\\n- s-1, t-1, harness ${s.digest.slice(0, 8)}: fail (rejected); open.`,
    );
    // No session before this one left notes, so the message opens on the rules and holds no notes
    // block: v1's starters are in the home, and an untouched starter renders nothing.
    expect(s.sent[0]).toContain(String.raw`{"role":"user","content":"Public rules of the domain:`);
    expect(s.sent[0]).not.toContain("Historical notes");
    expect(readFileSync(join(s.home, "MEMORY.md"), "utf8")).toStartWith("# Builder memory\n");
    expect(readFileSync(join(s.home, "SCRATCHPAD.md"), "utf8")).toStartWith("# Scratchpad\n");
    expect(s.sent[0]).toContain(
      "The next session opens in a new home, and what you learned reaches it only through MEMORY.md, SCRATCHPAD.md and scratch/ in your home directory (files up to 256 KB each, 4096 KB in all;",
    );
    expect(s.sent[0]).not.toContain("Comparisons so far");
    // The one limit on a harness, as the operator settled it on 9 October: a program may test a
    // candidate against a public rule, and nothing returns a finished answer.
    expect(s.sent[0]).toContain("No program, tool or guide line returns a finished answer for a task");
    // Each part of a harness has one purpose: a computation is a program, and no tool beside it.
    expect(s.sent[0]).toContain("every computation you add is a program there");
    expect(s.sent[0]).toContain("Leave its list empty while the solver has the shell");
    expect(s.sent[0]).toContain("test the candidate against a public rule and say what it does not meet");
    expect(s.sent[0]).not.toContain("says whether a candidate meets a rule");
    // What the rounds of 9 October showed of a guide and of the practice solves: four of the six
    // harnesses that went to a comparison told the solver that time was short, and both truss
    // sessions spent their last solve before their last change.
    expect(s.sent[0]).toContain("so the guide says nothing of time or turns");
    expect(s.sent[0]).toContain("keep a solve for the harness you mean to finish with");
    expect(readFileSync(join(s.home, "practice", "t-1.json"), "utf8")).toContain('"base": 7');
    // The solver's public resources, in the home as one file, which the opening message names.
    expect(readFileSync(join(s.home, "resources.json"), "utf8")).toContain('"maxSpan": 12');
    expect(s.sent[0]).toContain("are in resources.json");
    // The practice result: endings, records under both harnesses, the diagnosis, the budget.
    const practised = s.sent[2] ?? "";
    expect(practised).toContain("t-1: fail (rejected). Solve s-3.");
    expect(practised).toContain("passed 0 of 1. Under the harness you started from: 0 of 1.");
    expect(practised).toContain(
      "Diagnosis (owner harness, confidence low): The guide never says to multiply.",
    );
    expect(practised).toContain("t-2: pass. Solve s-4.");
    expect(practised).toContain("1 practice solve left.");
    // The trace, listed and then one call whole.
    expect(s.sent[3]).toContain(String.raw`ending: fail (rejected)\nsubmitted answer: {\"answer\":\"41\"}`);
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
    expect(s.sent[0]).toContain(
      String.raw`Comparisons so far, on tasks you are not shown:\n- Harness ffffffff against the reference harness, one comparison over 7 tasks: 1 won, 0 lost, 6 tied, which reads no step.`,
    );
    // The held-out task's own fail is on record, and no line of the message is of it.
    expect(s.sent[0]).not.toContain(s.exam);
    expect(s.sent[4]).toContain(
      "Not finished. SCRATCHPAD.md is 10000 bytes, over its 2000-byte limit: the next session reads its head and tail and drops the middle, so shorten it now. Then call finish again.",
    );
    expect(s.of(BUILD_FINISHED).at(-1)).toMatchObject({ session: "b-1", ended: "finished" });
    // Its own notes and its helper are kept for the next session, each note under v1's marker.
    const own = join(s.request.memory, "b-1");
    expect(readFileSync(join(own, "MEMORY.md"), "utf8")).toBe(
      "<!-- carried forward from b-1, an earlier session of this campaign. Correct what no longer holds. -->\n<!-- scratch/ holds b-1's 1 helper file: gen.py. -->\n\n# Builder memory\n\nA table of factors did not help.\n",
    );
    expect(readFileSync(join(own, "SCRATCHPAD.md"), "utf8")).toContain("- try the base as a string");
    expect(readFileSync(join(own, "scratch", "gen.py"), "utf8")).toBe("print(6)\n");
  });

  it("takes a task out of practice when the Referee rules its fail a check defect", async () => {
    const s = await setup(
      [call("practice", { tasks: ["t-2"] }), call("practice", { tasks: ["t-2"] }), finish],
      [{ outcome: "fail", kind: "rejected" }],
    );
    let diagnosed = 0;
    const built = await session(
      {
        ...s.request,
        referee: async () => ({
          ruling: "check-defect",
          check: CHECK,
          rule: null,
          field: null,
          reason: REASON,
          probes: [1],
        }),
        diagnose: async () => {
          diagnosed += 1;
          return { abstain: "never asked" };
        },
      },
      s,
      s.walled,
    );
    expect(s.sent[1]).toContain("The Referee ruled this fail a check defect: it does not count");
    expect(s.sent[2]).toContain("t-2 is no longer a practice task");
    expect(diagnosed).toBe(0);
    expect(s.sent.join("\n")).not.toContain(CHECK);
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ practiceSolves: 1, disputed: ["v2"], changed: false });
    expect(built).toMatchObject({ changed: false, dir: null, harness: s.digest });
    expect(s.of("harness.version")).toEqual([]);
  });

  it("opens with the practice solves its dollar cap holds a reserve for, where those are fewer", async () => {
    // A cap of $25 with a reserve of $10 holds two solves, and the session's own limit is three.
    const s = await setup([call("practice", { tasks: ["t-1", "t-1", "t-2"] }), finish]);
    await session({ ...s.request, cap: { dollars: 25, reserve: 10 } }, s, s.walled);
    expect(s.sent[0]).toContain("This session has 2 practice solves, 10 minutes and 12 turns.");
    expect(s.sent[1]).toContain("only 2 practice solves left, and this asks for 3");
    // A cap that holds more than the limit changes nothing the Builder reads.
    const roomy = await setup([finish]);
    await session({ ...roomy.request, cap: { dollars: 600, reserve: 10 } }, roomy, roomy.walled);
    expect(roomy.sent[0]).toContain("This session has 3 practice solves, 10 minutes and 12 turns.");
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

  it("spends no solve on a harness a solve could not open", async () => {
    const spec = readFileSync(join(FIXTURE, "agent", "tools-spec.json"), "utf8");
    const s = await setup([
      call(WRITE_FILE, { path: "harness/agent/tools-spec.json", content: "{}" }),
      call("practice", { tasks: ["t-1"] }),
      // A preset no solve serves: every solve would end on it before its first turn.
      call(WRITE_FILE, {
        path: "harness/agent/tools-spec.json",
        content: spec.replace('"shell"', '"shell", "python"'),
      }),
      call("practice", { tasks: ["t-1"] }),
      call(WRITE_FILE, { path: "harness/agent/tools-spec.json", content: spec }),
      () => {
        // Between two turns the Builder puts a link to a host file where its guide was.
        const guide = join(s.home, "harness", "agent", "BUILT_AGENTS.md");
        rmSync(guide);
        symlinkSync(join(s.scratch, "log.jsonl"), guide);
        return call("practice", { tasks: ["t-1"] });
      },
      finish,
    ]);
    const built = await session(s.request, s, s.walled);
    expect(spec).toContain('"shell"');
    expect(s.sent[2]).toContain(
      "the harness does not open: agent/tools-spec.json needs presets and tools lists",
    );
    expect(s.sent[4]).toContain(
      "the harness does not open: a solve serves pi's coding tools as presets (read, bash, edit, write), not python",
    );
    const last = JSON.stringify(s.of(BUILD_CALL).at(-2));
    expect(last).toContain("agent/BUILT_AGENTS.md links outside the harness");
    expect(built).toMatchObject({ harness: null, dir: null, changed: false });
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ practiceSolves: 0, harness: null });
    expect(JSON.stringify(s.of(BUILD_FINISHED)[0]?.broken)).toContain("links outside the harness");
    // Nothing a refused freeze copied is left beside the kept states.
    expect(readdirSync(s.request.states)).toEqual([]);
  });

  it("is measured by the last state it practised with when what it leaves does not open", async () => {
    const s = await setup([
      edit,
      call("practice", { tasks: ["t-1"] }),
      call(WRITE_FILE, { path: "harness/agent/tools-spec.json", content: "{}" }),
      finish,
      finish,
    ]);
    const built = await session(s.request, s, s.walled);
    // The first finish says so, once, and what is measured in its place; the second ends the session.
    expect(s.sent[4]).toContain("Not finished. the harness does not open: ");
    expect(s.sent[4]).toContain(
      "Left so, the harness your last practice solve ran is measured in its place. Mend it and call finish again, or call finish again to end the session as it is.",
    );
    // The edited guide is the state the practice ran with, and the spec written after it opens for
    // no solve: the first is kept and compared, and the record says why the last was not.
    expect(built).toMatchObject({ changed: true, ended: "finished" });
    expect(built.harness).not.toBe(s.digest);
    expect(built.dir).toBe(join(s.request.states, built.harness ?? ""));
    expect(s.of("harness.version")).toMatchObject([{ version: built.harness, parent: s.digest }]);
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({
      practiceSolves: 1,
      changed: true,
      harness: built.harness,
    });
    expect(JSON.stringify(s.of(BUILD_FINISHED)[0]?.broken)).toContain("needs presets and tools lists");
  });

  it("is told once, at finish, of a harness changed since its last practice solve", async () => {
    const later = call(WRITE_FILE, {
      path: "harness/agent/BUILT_AGENTS.md",
      content: `${GUIDE}Check the product.\n`,
    });
    const s = await setup([edit, call("practice", { tasks: ["t-1"] }), later, finish, finish]);
    const built = await session(s.request, s, s.walled);
    expect(s.sent[4]).toContain(
      "Not finished. harness/ has changed since your last practice solve, so no solve has run it as it stands. 2 practice solves are left. Practise it, or call finish again to end the session as it is and have it measured untried.",
    );
    // The second finish is taken at its word, and the changed harness is the one frozen.
    expect(built).toMatchObject({ changed: true, ended: "finished" });
    expect(readFileSync(join(built.dir ?? "", "agent", "BUILT_AGENTS.md"), "utf8")).toContain(
      "Check the product.",
    );
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ turns: 5, practiceSolves: 1 });
  });

  it("is told nothing at finish of the harness its last practice solve ran, or with no solve left", async () => {
    const tried = await setup([edit, call("practice", { tasks: ["t-1"] }), finish]);
    await session(tried.request, tried, tried.walled);
    expect(tried.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "finished", turns: 3 });
    // With its last solve spent the Builder is told so there, where it can still plan around it.
    const later = call(WRITE_FILE, { path: "harness/agent/BUILT_AGENTS.md", content: `${GUIDE}More.\n` });
    const spent = await setup([edit, call("practice", { tasks: ["t-1", "t-2", "t-1"] }), later, finish]);
    await session(spent.request, spent, spent.walled);
    expect(spent.sent[2]).toContain(
      "No practice solve is left: what you change from here on is measured without a solve having run it.",
    );
    expect(spent.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "finished", turns: 4, practiceSolves: 3 });
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

  it("is a crashed session when the provider fails a turn, and one session to an id", async () => {
    const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" });
    const s = await setup([edit, failed, finish]);
    const built = await session(s.request, s, s.walled);
    // What it wrote before the failure is frozen and logged, and named for what it is: half a session.
    expect(built).toMatchObject({ changed: true, ended: "crashed" });
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "crashed", crash: "overloaded" });
    await expect(session(s.request, s, s.walled)).rejects.toThrow("session b-1 is in the log already");
    expect(s.of("build.started")).toHaveLength(1);
  });

  it("ends at finish though another call shares its turn", async () => {
    const both = fauxAssistantMessage(
      [
        fauxToolCall("finish", { note: "Done." }),
        fauxToolCall(WRITE_FILE, { path: "harness/agent/BUILT_AGENTS.md", content: GUIDE }),
      ],
      toolUse,
    );
    const s = await setup([both, edit, edit]);
    const built = await session(s.request, s, s.walled);
    expect(built).toMatchObject({ ended: "finished", changed: true });
    expect(s.of("build.turn")).toHaveLength(1);
  });

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

  it("takes its wall to a practice solve in flight", async () => {
    const s = await setup([call("practice", { tasks: ["t-1"] }), finish]);
    let flown = 0;
    const built = await session(
      {
        ...s.request,
        limits: { ...LIMITS, wallSeconds: 1 },
        // A solve that ends only when it is killed, as a solve under its own longer wall would.
        practise: async (_task, _dir, _digest, kill) => {
          flown += 1;
          if (!kill.aborted) {
            await new Promise((resolve) => kill.addEventListener("abort", resolve, { once: true }));
          }
          return { solve: "s-killed", ending: { outcome: "non-result", kind: "killed", reason: "killed" } };
        },
      },
      s,
      s.walled,
    );
    expect(flown).toBe(1);
    expect(built).toMatchObject({ ended: "wall", changed: false });
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "wall", practiceSolves: 1 });
    expect(Number(s.of(BUILD_FINISHED)[0]?.seconds)).toBeLessThan(4);
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

  it("is told to go on when it stops without finishing, up to its turns, and freezes what it left", async () => {
    const stop = fauxAssistantMessage("I think that is enough.");
    const s = await setup([edit, ...Array.from({ length: 12 }, () => stop)]);
    const built = await session({ ...s.request, limits: { ...LIMITS, turns: 3 } }, s, s.walled);
    expect(built).toMatchObject({ changed: true, ended: "turns" });
    expect(s.sent[2]).toContain(GOES_ON);
    expect(s.of("build.turn")).toHaveLength(3);
    expect(s.of("harness.version")[0]).toMatchObject({ note: null, parent: s.digest });
  });

  // Fix row F17. Until 2026-10-09 a Builder was told its limits once, at its opening, and between
  // turns only that it had not finished. In the seven sessions on record that message was never
  // sent: every one of their 365 turns ended in a tool call. So the facts ride on tool results.
  it("reads what it has used of its limits at the end of every tool result, and its goal again when a turn ends without a call", async () => {
    const stop = fauxAssistantMessage("I think that is enough.");
    const s = await setup([edit, call("practice", { tasks: ["t-1"] }), stop, finish]);
    await session(s.request, s, s.walled);
    const lines = s.of(BUILD_CALL).map(({ text: told }) => (isString(told) ? told.split("\n").at(-1) : ""));
    // Every result ends with the line: the turn counts up and the practice solves down.
    expect(lines).toEqual([
      expect.stringMatching(/^\[Session: turn 1 of 12, 0:0\d of 10:00 used, 3 practice solves left\]$/),
      expect.stringMatching(/^\[Session: turn 2 of 12, 0:0\d of 10:00 used, 2 practice solves left\]$/),
      expect.stringMatching(/^\[Session: turn 4 of 12, 0:0\d of 10:00 used, 2 practice solves left\]$/),
    ]);
    // An error carries it as a result does.
    const refused = await setup([call("practice", { tasks: ["t-9"] }), finish]);
    await session(refused.request, refused, refused.walled);
    expect(refused.of(BUILD_CALL)[0]).toMatchObject({
      isError: true,
      text: expect.stringMatching(
        /not one of this session's practice tasks: t-1, t-2\n\n\[Session: turn 1 of 12, /,
      ),
    });
    // The turn that ended with no call is answered with the goal and the facts, and with no course.
    const continued = parseJsonAs<{ messages: { role: string; content: string }[] }>(s.sent[3] ?? "{}");
    expect(continued.messages.at(-1)).toMatchObject({
      role: "user",
      content: [
        `${GOES_ON}, and the session goes on: ending a turn does not end it. It ends when you call finish or at its limits, and what harness/ holds then is frozen and measured.`,
        "The goal, unchanged: Your harness is measured against a reference harness, by that solver and under the same limits, on tasks you are never shown.",
        "This session so far: 3 of 12 turns and 0 of 10 minutes used, 2 practice solves left. harness/ is as your last practice solve ran it.",
        "read_opening returns the opening message again: the public rules, the practice tasks, the failed practice solves and the comparisons so far.",
      ].join("\n\n"),
    });
    // Where harness/ stands is said as it is: unpractised, and changed since the last solve.
    const idle = await setup([stop, finish]);
    await session(idle.request, idle, idle.walled);
    expect(idle.sent[1]).toContain("3 practice solves left. No practice solve has run in this session.");
    const moved = await setup([call("practice", { tasks: ["t-1"] }), edit, stop, finish, finish]);
    await session(moved.request, moved, moved.walled);
    expect(moved.sent[3]).toContain(
      "harness/ has changed since your last practice solve, so no solve has run it as it stands.",
    );
  });

  // Fix row F18: a session whose opening was compacted away had its facts in no other place.
  it("serves its opening message again, as it was sent", async () => {
    const s = await setup([edit, call("read_opening", {}), finish]);
    await session(s.request, s, s.walled);
    const first = parseJsonAs<{ messages: { role: string; content: string }[] }>(s.sent[0] ?? "{}");
    const opening = first.messages.find(({ role }) => role === "user")?.content ?? "";
    expect(opening).toContain("Public rules of the domain:");
    const served = s.of(BUILD_CALL)[1]?.text;
    // The tool's answer is the opening message, and after it the line every result ends with.
    expect(isString(served) ? served.split("\n[Session: ")[0] : "").toBe(opening);
    expect(s.of(BUILD_CALL)[1]).toMatchObject({ tool: "read_opening", isError: false });
  });

  it("ends at its turns though it never stops calling tools", async () => {
    const s = await setup(Array.from({ length: 12 }, () => edit));
    const built = await session({ ...s.request, limits: { ...LIMITS, turns: 4 } }, s, s.walled);
    expect(built).toMatchObject({ changed: true, ended: "turns" });
    expect(s.of("build.turn")).toHaveLength(4);
    expect(s.sent.join("\n")).not.toContain(GOES_ON);
  });
});

describe("what a Builder is shown of a solve", () => {
  it("is an ending's outcome and kind, and a reason only where the harness itself broke", () => {
    expect(endingText({ outcome: "pass" })).toBe("pass");
    expect(endingText({ outcome: "fail", kind: "wall-ended" })).toBe("fail (wall-ended)");
    expect(endingText({ outcome: "fail", kind: "broken-harness", reason: "no tools" })).toBe(
      "fail (broken harness: no tools)",
    );
    expect(endingText({ outcome: "non-result", kind: "check", reason: `${CHECK}: threw` })).toBe(
      "no result (check)",
    );
  });
});

// Fix row F19, and rule 3 of AGENTS.md: nothing crosses from the exam side to the build side but
// a closed list. Until 2026-10-09 the tests held three canaries (a check's name, the Referee's
// reason, a held-out solve's id) and no proof of the rest. Here two campaigns are alike in
// everything a Builder may know and differ in everything it may not, and a session over each has
// to read the same bytes.
describe("what crosses to the Builder", () => {
  /** What a campaign keeps from its Builder: the check that refused an answer, the Referee's
   *  reason, a task's hidden value, and which held-out task the comparison's new harness won. */
  interface Kept {
    readonly check: string;
    readonly reason: string;
    readonly hidden: string;
    readonly won: "h1" | "h2";
  }
  const ONE: Kept = { check: "check-one-7a1", reason: "reason-one-7a1", hidden: "hidden-one-7a1", won: "h1" };
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
   * the exam's. `leak` has the Diagnoser name the check that refused, which is a held-out detail in
   * a Builder's message.
   */
  async function read_(kept: Kept, leak: "sealed" | "leaking" = "sealed"): Promise<string> {
    const stop = fauxAssistantMessage("I think that is enough.");
    const s = await setup(
      [
        edit,
        call("practice", { tasks: ["t-1", "t-2"] }),
        call("read_trace", { solve: "s-3" }),
        call("read_trace", { solve: "s-3", call: 1 }),
        call("read_opening", {}),
        stop,
        finish,
      ],
      [{ outcome: "fail", kind: "rejected" }, { outcome: "pass" }],
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
    }
    for (const version of ["h1", "h2"]) {
      for (const side of [s.digest, FRESH]) {
        const solve = `g-1-${version}-${side.slice(0, 4)}`;
        const lost = version === kept.won && side === s.digest;
        append(log, "solve.started", { solve, comparison: "g-1", task: `x-${version}` });
        if (lost) {
          append(log, "verdict", {
            solve,
            answer: { answer: kept.hidden },
            kind: "fail",
            blocking: [kept.check],
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
      won: [kept.won],
      aside: [],
    });
    await session(
      {
        ...s.request,
        referee: async () => ({
          ruling: "earned",
          check: kept.check,
          rule: "R1",
          field: "answer",
          reason: kept.reason,
          probes: [],
        }),
        diagnose: async () => ({
          owner: "solver",
          cause: leak === "leaking" ? `Its answer failed ${kept.check}.` : "It never multiplied.",
          falsifier: "A later solve that multiplies and still answers 41.",
          firstDivergence: "margin of s-3",
          contrastSuccess: null,
          confidence: "low",
        }),
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

  it("is byte-identical whatever a hidden value, a check, a ruling or the task that was won is", async () => {
    const [one, other] = [await read_(ONE), await read_(OTHER)];
    // The session read what a Builder may: its tasks, the fail and its diagnosis, the trace, the
    // opening again, the continuation, and the comparison as a tally.
    expect(one).toContain("Solve s-3.");
    expect(one).toContain("- s-1, t-1, harness");
    expect(one).toContain("It never multiplied.");
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

  // The nearest hostile case: a reviewer whose words name the check that refused. The Diagnoser is
  // shown no check, so this cannot happen by its seat; it stands in for any path that would put a
  // held-out detail into a message, and the comparison above then fails.
  it("is not, once a held-out detail reaches one message", async () => {
    const [one, other] = [await read_(ONE, "leaking"), await read_(OTHER, "leaking")];
    expect(one === other).toBe(false);
    expect(one).toContain(ONE.check);
  }, 60_000);
});

describe("what a practice solve used", () => {
  it("is its time of its limit and the model's turns, and nothing for a solve the log has no end of", async () => {
    const s = await setup([finish]);
    const condition: Condition = {
      contract: "c1",
      harness: s.digest,
      task: "v1",
      model: "faux/faux-solver",
      effort: "medium",
      prices: { "faux/faux-solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      runtime: {},
      compaction: "off",
      solverTools: s.digest,
      verifierTools: "t1",
      sandbox: "p1",
      limits: { ...LIMITS, wallSeconds: 480 },
      host: "h1",
      side: "test",
    };
    append(s.request.log, "solve.started", {
      solve: "s-used",
      condition: recordCondition(s.request.log, condition),
      limits: condition.limits,
    });
    expect(usedText(read(s.request.log), "s-used")).toBe("");
    append(s.request.log, "solve.finished", {
      solve: "s-used",
      ending: { outcome: "pass" },
      turns: 14,
      seconds: 222.4,
    });
    expect(usedText(read(s.request.log), "s-used")).toBe(" It took 3:42 of 8:00 and 14 model turns.");
    expect(usedText(read(s.request.log), "s-none")).toBe("");
  });
});

describe.skipIf(runtimeProcess.platform !== "darwin")("a Builder session under the command wall", () => {
  it("writes its harness through the wall, checks it, and cannot read the repository", async () => {
    // The scratch stands for the repository: the wall closes it, and the log and a canary sit in it.
    let canary = "";
    const s = await setup(
      [
        () => call("bash", { command: `cat '${canary}' 2>&1; echo "read:$?"` }),
        // pi's write, behind the wall: outside the home it is refused, and a folder is no file.
        call(WRITE_FILE, { path: "../escape.txt", content: "x" }),
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
          path: "harness/agent/BUILT_AGENTS.md",
          edits: [{ oldText: "Multiply", newText: "Always multiply" }],
        }),
        call("read", { path: "harness/agent/BUILT_AGENTS.md" }),
        call("preview_harness", {}),
        // The session's own tools file and guide go back; what it installed stays.
        call("reset_harness", {}),
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
    expect(calls[0]).toContain("Operation not permitted");
    expect(calls[0]).toContain("read:1");
    expect(calls[1]).not.toContain("Successfully wrote");
    expect(calls[2]).toContain("irectory");
    expect(calls[4]).toContain("Multiply before you record.");
    expect(calls[4]).toContain("t-1.json");
    expect(calls[5]).toContain("hello-from-the-tool-tree");
    expect(calls[5]).toContain("installed-greeting");
    expect(calls[6]).toContain("harness/.toolchain/bin/named name your home");
    // A line for each part of the harness, and a note where two parts do one part's work.
    expect(calls[8]).toContain(
      String.raw`The harness opens.\npi's tools: bash.\nPrograms: greet, hello, real.\nGuide: 28 characters.\nTools of its own: scale_base, read_path.\nThe solver has the shell and tools of the harness's own.`,
    );
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
    expect(calls[13]).toContain("harness/agent is as this session found it.");
    expect(calls[14]).toContain("greet");
    expect(calls[14]).not.toContain("Always multiply");
    expect(responses.join("\n")).not.toContain(CHECK);
    expect(built).toMatchObject({ changed: true, ended: "finished" });
    expect(readFileSync(join(built.dir ?? "", "agent", "BUILT_AGENTS.md"), "utf8")).toBe(GUIDE);
    const greet = Bun.spawnSync([join(built.dir ?? "", ".toolchain", "bin", "greet")]);
    expect(greet.stdout.toString()).toBe("installed-greeting\n");
    expect(existsSync(join(s.parent, ".toolchain", "bin", "greet"))).toBe(false);
    // A check keeps no state: the one kept is the session's last, beside the one copy of its tree.
    const kept = readdirSync(request.states);
    expect(kept.filter((name) => !name.startsWith("tree-"))).toEqual([built.harness ?? ""]);
    expect(kept).toHaveLength(2);
  }, 120_000);
});
