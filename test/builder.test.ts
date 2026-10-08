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
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isFunction, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import type { RefereeFinding } from "../src/review/referee.ts";
import { publicResource, text, tool } from "../src/solve/answer.ts";
import { openHarness } from "../src/solve/harness.ts";

const BUILD_CALL = "build.call";
const BUILD_FINISHED = "build.finished";
const WRITE_FILE = "write_file";

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
const edit = call(WRITE_FILE, { path: "agent/BUILT_AGENTS.md", content: GUIDE });
const finish = call("finish", { note: "A shorter guide." });

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** A scratch with the fixture harness as the parent, and a log in which v1 and v2 are released, v0
 *  is the anchor's and v3 is admitted. `endings` are what the practice solves end in, in order.
 *  With `tree`, the parent has an installed program. */
async function setup(responses: FauxResponseStep[], endings: Ending[] = [], tree = false) {
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
    tasks: TASKS,
    contract: CONTRACT,
    resources: [publicResource("span table", { maxSpan: 12 })],
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    models: () => models,
    log: log,
    repoRoot: scratch,
    practise: async (task, dir, harness) => {
      ran.push({ dir, digest: harness });
      const ending = queue.shift() ?? { outcome: "pass" };
      return { solve: solved(task.version, harness, ending), ending };
    },
  };
  /** The walled write, stood in for: the same tool name, writing as the host. */
  const walled = (bench: Bench) => [
    tool({
      name: WRITE_FILE,
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
      "task t-3 is admitted, and a Builder practises on released tasks only",
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

  it("is told the objective, what a valid practice answer reports and the best known of its task", async () => {
    const objective = {
      quantity: "mass",
      direction: "minimise",
      path: "$.mass",
      verifiedBy: "check-mass",
      margin: { absolute: 0, relative: 0.01 },
    } as const;
    const s = await setup([call("practice", { tasks: ["t-1", "t-1", "t-2"] }), finish]);
    // Each practice solve passes, and its verdict holds the answer with the mass it reports; the
    // third reports none.
    const masses = [120, 95, null];
    await session(
      {
        ...s.request,
        contract: { ...CONTRACT, objective },
        practise: async (task, dir, harness, kill) => {
          const made = await s.request.practise(task, dir, harness, kill);
          const mass = masses.shift() ?? null;
          append(s.request.log, "verdict", {
            solve: made.solve,
            task: task.task.taskId,
            kind: "pass",
            answer: mass === null ? { answer: "42" } : { answer: "42", mass },
          });
          return made;
        },
      },
      s,
      s.walled,
    );
    expect(s.sent[0]).toContain(
      "Objective: minimise mass. Among answers that meet every rule, a lower mass is the better answer. An answer reports it at $.mass. The solver is told the same sentence with each task.",
    );
    const practised = s.sent[1] ?? "";
    expect(practised).toContain(String.raw`t-1: pass. Solve s-3.\nIts answer is valid and reports mass 120.`);
    expect(practised).toContain(String.raw`t-1: pass. Solve s-4.\nIts answer is valid and reports mass 95.`);
    // Both solves of the task are set against the best valid value any solve of it has reported.
    expect(
      practised.split("Best valid mass any solve of this task has reported: 95 (solve s-4)."),
    ).toHaveLength(3);
    expect(practised).toContain("Its answer is valid and reports no mass at $.mass.");
    // Under a contract that states no objective nothing of it is said.
    const plain = await setup([call("practice", { tasks: ["t-1"] }), finish]);
    await session(plain.request, plain, plain.walled);
    expect(plain.sent.join("\n")).not.toContain("Objective:");
    expect(plain.sent[1]).not.toContain("Its answer is valid");
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
      call(WRITE_FILE, { path: "agent/tools-spec.json", content: "{}" }),
      call("practice", { tasks: ["t-1"] }),
      // A preset no v2 solve serves: every solve would end on it before its first turn.
      call(WRITE_FILE, {
        path: "agent/tools-spec.json",
        content: spec.replace('"shell"', '"shell", "python"'),
      }),
      call("practice", { tasks: ["t-1"] }),
      call(WRITE_FILE, { path: "agent/tools-spec.json", content: spec }),
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
      "the harness does not open: a v2 solve serves the shell preset alone, not python",
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
      call(WRITE_FILE, { path: "agent/tools-spec.json", content: "{}" }),
      finish,
    ]);
    const built = await session(s.request, s, s.walled);
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
        fauxToolCall(WRITE_FILE, { path: "agent/BUILT_AGENTS.md", content: GUIDE }),
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
      call(WRITE_FILE, { path: "agent/tools.ts", content: 'import "./missing.ts";\n' }),
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

  it("is nudged when it stops without finishing, up to its turns, and freezes what it left", async () => {
    const stop = fauxAssistantMessage("I think that is enough.");
    const s = await setup([edit, ...Array.from({ length: 12 }, () => stop)]);
    const built = await session({ ...s.request, limits: { ...LIMITS, turns: 3 } }, s, s.walled);
    expect(built).toMatchObject({ changed: true, ended: "turns" });
    expect(s.sent[2]).toContain("You have not called finish.");
    expect(s.of("build.turn")).toHaveLength(3);
    expect(s.of("harness.version")[0]).toMatchObject({ note: null, parent: s.digest });
  });

  it("ends at its turns though it never stops calling tools", async () => {
    const s = await setup(Array.from({ length: 12 }, () => edit));
    const built = await session({ ...s.request, limits: { ...LIMITS, turns: 4 } }, s, s.walled);
    expect(built).toMatchObject({ changed: true, ended: "turns" });
    expect(s.of("build.turn")).toHaveLength(4);
    expect(s.sent.join("\n")).not.toContain("You have not called finish.");
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
    const s = await setup(
      [
        () => call("bash", { command: `cat '${canary}' 2>&1; echo "read:$?"` }),
        call(WRITE_FILE, { path: "../escape.txt", content: "x" }),
        call(WRITE_FILE, { path: "agent", content: "x" }),
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
        finish,
      ],
      [],
      true,
    );
    canary = join(s.scratch, "canary.txt");
    writeFileSync(canary, CHECK);
    const request = { ...s.request, id: `b-${String(runtimeProcess.pid)}-${s.scratch.slice(-6)}` };
    const responses = s.sent;
    const built = await build(request);
    const calls = s.of(BUILD_CALL).map(({ text: said }) => JSON.stringify(said));
    expect(calls[0]).toContain("Operation not permitted");
    expect(calls[0]).toContain("read:1");
    expect(calls[1]).toContain("path names a file under harness/");
    expect(calls[2]).toContain("harness/agent is a directory");
    expect(calls[4]).toContain("Multiply before you record.");
    expect(calls[4]).toContain("t-1.json");
    expect(calls[5]).toContain("hello-from-the-tool-tree");
    expect(calls[5]).toContain("installed-greeting");
    expect(calls[6]).toContain("harness/.toolchain/bin/named name your home");
    expect(calls[8]).toContain("The harness opens. Tools: ");
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
