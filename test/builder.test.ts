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
import { type Bench, endingText, record } from "../src/builder/tools.ts";
import { type Condition, recordCondition } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import type { RefereeFinding } from "../src/review/referee.ts";
import { text, tool } from "../src/solve/answer.ts";
import { openHarness } from "../src/solve/harness.ts";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
/** A check's id and a Referee's reason: verifier-side text no Builder may be shown. */
const CHECK = "check-canary-51c2";
const REASON = "reason-canary-9d07";
const CONTRACT: Contract = {
  answerFormat: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  tools: [],
  install: "",
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
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
const GUIDE = "Multiply before you record.\n";
const edit = call("write_file", { path: "agent/BUILT_AGENTS.md", content: GUIDE });
const finish = call("finish", { note: "A shorter guide." });

const scratches: string[] = [];
afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** A scratch with the fixture harness as the parent, and a log in which v1 and v2 are released, v0
 *  is the anchor's and v3 is admitted. `endings` are what the practice solves end in, in order. */
async function setup(responses: FauxResponseStep[], endings: Ending[] = []) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-builder-")));
  scratches.push(scratch);
  const parent = join(scratch, "parent");
  const home = join(scratch, "home");
  const host = join(scratch, "host");
  const log = join(scratch, "log.jsonl");
  cpSync(FIXTURE, parent, { recursive: true });
  mkdirSync(home);
  mkdirSync(host);
  const record_ = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  for (const version of ["v0", "v1", "v2", "v3"]) {
    record_("task.proposed", { version });
    for (const gate of [1, 2, 3, 4]) {
      record_("task.gate", { version, gate, outcome: "passed", controls: "d" });
    }
  }
  record_("anchor.drawn", { tasks: ["v0"] });
  record_("task.state", { version: "v1", state: "released" });
  record_("task.state", { version: "v2", state: "released" });
  record_("task.state", { version: "v3", state: "admitted" });
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
      record_("verdict", { solve, answer: { answer: "41" }, kind: "fail", blocking: [CHECK] });
    }
    record_("solve.finished", { solve, ending });
    return solve;
  };
  // The parent's screening solves: v1 failed once, v3 is the admitted task's.
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
    responses.map((step) =>
      typeof step === "function"
        ? step
        : (context: unknown) => {
            sent.push(JSON.stringify(context));
            return step;
          },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const queue = [...endings];
  const request: BuildRequest = {
    id: "b-1",
    parent: parent,
    states: join(scratch, "states"),
    tasks: TASKS,
    contract: CONTRACT,
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    models: () => models,
    log: log,
    repoRoot: scratch,
    practise: async (task, _dir, harness) => {
      const ending = queue.shift() ?? { outcome: "pass" };
      return { solve: solved(task.version, harness, ending), ending };
    },
  };
  /** The walled write, stood in for: the same tool name, writing as the host. */
  const walled = (bench: Bench) => [
    tool({
      name: "write_file",
      label: "write",
      description: "Writes a file under harness/.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, args) => {
        const file = join(bench.home, "harness", args.path);
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
    home: home,
    host: host,
    request,
    walled,
    sent,
    events,
    of,
    digest,
    exam,
  };
}

describe("a Builder session", () => {
  it("practises on released tasks only, whatever it is handed", async () => {
    const s = await setup([]);
    const exam = { version: "v3", task: { taskId: "t-3", family: "fixture", publicInput: {} } };
    await expect(session({ ...s.request, tasks: [...TASKS, exam] }, s, s.walled)).rejects.toThrow(
      "task t-3 is admitted, and a Builder practises on released tasks only",
    );
    const anchor = { version: "v0", task: { taskId: "t-0", family: "fixture", publicInput: {} } };
    await expect(session({ ...s.request, tasks: [anchor] }, s, s.walled)).rejects.toThrow("task t-0 is held");
    expect(s.of("build.started")).toEqual([]);
  });

  it("is given the parent's record, practises, reads a trace, and leaves a frozen version", async () => {
    const earned: RefereeFinding = { ruling: "earned", check: null, reason: REASON, probes: [] };
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
    expect(readFileSync(join(s.home, "practice", "t-1.json"), "utf8")).toContain('"base": 7');
    // The practice result: endings, records under both harnesses, the diagnosis, the budget.
    const practised = s.sent[2] ?? "";
    expect(practised).toContain("t-1: fail (rejected). Solve s-3.");
    expect(practised).toContain("passed 0 of 1. Under the harness you started from: 0 of 1.");
    expect(practised).toContain(
      "Diagnosis (owner harness, confidence low): The guide never says to multiply.",
    );
    expect(practised).toContain("t-2: pass. Solve s-4.");
    expect(practised).toContain("1 practice solve(s) left.");
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
    expect(s.of("build.finished")[0]).toMatchObject({
      ended: "finished",
      harness: built.harness,
      changed: true,
      practiceSolves: 2,
      disputed: [],
      turns: 5,
    });
    expect(s.of("build.call").map(({ tool: name }) => name)).toEqual([
      "write_file",
      "practice",
      "read_trace",
      "read_trace",
      "finish",
    ]);
    expect(record(s.events(), "v1", built.harness ?? "")).toEqual({ solves: ["s-3"], passed: 0 });
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
        referee: async () => ({ ruling: "check-defect", check: CHECK, reason: REASON, probes: [1] }),
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
    expect(s.of("build.finished")[0]).toMatchObject({ practiceSolves: 1, disputed: ["v2"], changed: false });
    expect(built).toMatchObject({ changed: false, dir: null, harness: s.digest });
    expect(s.of("harness.version")).toEqual([]);
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
    expect(s.sent[2]).toContain("3 practice solve(s) are left, and this asks for 4");
    expect(s.sent[3]).toContain("t-9 is not one of this session's practice tasks: t-1, t-2");
    expect(s.of("build.finished")[0]).toMatchObject({ practiceSolves: 0 });
  });

  it("spends no solve on a harness that does not open, or whose agent files link out of it", async () => {
    const s = await setup([
      call("write_file", { path: "agent/tools-spec.json", content: "{}" }),
      call("practice", { tasks: ["t-1"] }),
      call("write_file", {
        path: "agent/tools-spec.json",
        content: readFileSync(join(FIXTURE, "agent", "tools-spec.json"), "utf8"),
      }),
      (context: unknown) => {
        // Between two turns the Builder plants a link from its agent files to a host file.
        void context;
        symlinkSync(join(s.scratch, "log.jsonl"), join(s.home, "harness", "agent", "leak.ts"));
        return call("practice", { tasks: ["t-1"] });
      },
      finish,
    ]);
    const built = await session(s.request, s, s.walled);
    expect(s.sent[2]).toContain(
      "the harness does not open: agent/tools-spec.json needs presets and tools lists",
    );
    const last = JSON.stringify(s.of("build.call").at(-2));
    expect(last).toContain("agent/leak.ts links outside the harness");
    expect(built).toMatchObject({ harness: null, dir: null, changed: false });
    expect(s.of("build.finished")[0]).toMatchObject({ practiceSolves: 0, harness: null });
    expect(JSON.stringify(s.of("build.finished")[0]?.broken)).toContain("links outside the harness");
  });

  it("is nudged when it stops without finishing, up to its turns, and freezes what it left", async () => {
    const stop = fauxAssistantMessage("I think that is enough.");
    const s = await setup([edit, ...Array.from({ length: 12 }, () => stop)]);
    const built = await session({ ...s.request, limits: { ...LIMITS, turns: 3 } }, s, s.walled);
    expect(built).toMatchObject({ changed: true, ended: "turns" });
    expect(s.sent[2]).toContain("You have not called finish.");
    expect(s.of("build.turn")).toHaveLength(4);
    expect(s.of("harness.version")[0]).toMatchObject({ note: null, parent: s.digest });
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

describe.skipIf(runtimeProcess.platform !== "darwin")("a Builder session under the command wall", () => {
  it("writes its harness through the wall, checks it, and cannot read the repository", async () => {
    // The scratch stands for the repository: the wall closes it, and the log and a canary sit in it.
    let canary = "";
    const s = await setup([
      () => call("bash", { command: `cat '${canary}' 2>&1; echo "read:$?"` }),
      call("write_file", { path: "../escape.txt", content: "x" }),
      edit,
      call("bash", { command: 'cat "$HOME/harness/agent/BUILT_AGENTS.md"; ls "$HOME/practice"' }),
      call("check_harness", {}),
      finish,
    ]);
    canary = join(s.scratch, "canary.txt");
    writeFileSync(canary, CHECK);
    const request = { ...s.request, id: `b-${String(runtimeProcess.pid)}-${s.scratch.slice(-6)}` };
    const responses = s.sent;
    const built = await build(request);
    const calls = s.of("build.call").map(({ text: said }) => JSON.stringify(said));
    expect(calls[0]).toContain("read:1");
    expect(calls[1]).toContain("path is relative to harness/ and has no .. step");
    expect(calls[3]).toContain("Multiply before you record.");
    expect(calls[3]).toContain("t-1.json");
    expect(calls[4]).toContain("The harness opens. Tools: ");
    expect(responses.join("\n")).not.toContain(CHECK);
    expect(built).toMatchObject({ changed: true, ended: "finished" });
    expect(readFileSync(join(built.dir ?? "", "agent", "BUILT_AGENTS.md"), "utf8")).toBe(GUIDE);
  }, 120_000);
});
