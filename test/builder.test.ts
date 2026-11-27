// One Builder session on the faux provider: what it is given, what a practice returns and never
// returns, the budget, the freeze and the record it leaves. A host write stands in for the walled
// tools; one block runs under the real command wall where the OS supports it.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createAssistantMessageEventStream,
  createModels,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { CLAUDE_COMPACTED } from "../src/agent/backends/claude.ts";
import { crashedRun } from "../src/campaign/state.ts";
import { type BuildRequest, build, layPractice, type PracticeTask, session } from "../src/builder/session.ts";
import { HOME_TOOL_TREE, snapshot } from "../src/builder/store.ts";
import { type Bench, PRACTICE_WAIT_SECONDS, practiceLeft, recordsOf } from "../src/builder/tools.ts";
import { formatKeys, namedTasks, readHarnessFiles } from "../src/harness/files.ts";
import { type Condition, recordCondition, settingId } from "../src/kernel/condition.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { DELIVERABLES, keepAnswerFiles, textFiles } from "../src/kernel/answer-files.ts";
import { latestBuilt } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { TOOL_TREE_DIR } from "../src/meta/bundle-layout.ts";
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
import { storedZip } from "../src/meta/zip.ts";
import type { AuditFinding } from "../src/audit/auditor.ts";
import { publicResource, text, tool } from "../src/tools/answer.ts";
import { openHarness } from "../src/harness/open.ts";
import { writeStarter } from "../src/harness/starter.ts";
import { osIsolationSupport } from "../src/sandbox/os-isolation.ts";
import { CLOSED } from "./helpers/wall.ts";
import { BUILT_COMMAND_SCRATCH_ROOT } from "../src/sandbox/policy.ts";
import { resolveCheckpoint } from "../tools/campaign/campaign.ts";
import { endCut } from "../tools/campaign/harness-builder.ts";

const BUILD_CALL = "build.call";
const BUILD_FINISHED = "build.finished";
const SOLVE_STARTED = "solve.started";
const SOLVE_FINISHED = "solve.finished";
const READ_TRACE = "read_trace";
const READ_OPENING = "read_opening";
const WRITE_FILE = "write";
const GUIDE_PATH = "harness/agent/BUILT_AGENTS.md";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const CHECK = "check-canary-51c2";
const REASON = "reason-canary-9d07";
const SETUP_CLAIM = "claim-setup-3e8";
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
const QUEUED_WALL_SECONDS = 10;
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

const clockless = (context: string) => context.replaceAll(/\d+:\d\d of 10:00 used/g, "0:00 of 10:00 used");

/** A scratch with the fixture harness as the parent, and a log in which v1 and v2 are released and
 *  v0 and v3 are held out. `endings` are what the practice solves end in, in order.
 *  With `tree`, the parent has an installed program. */
async function setup(
  responses: FauxResponseStep[],
  endings: Ending[] = [],
  tree = false,
  check = CHECK,
  contract = CONTRACT,
) {
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
  const add = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  for (const version of ["v0", "v1", "v2", "v3"]) {
    add("task.proposed", { version, claim: { grade: 3, stops: SETUP_CLAIM } });
    add("task.gate", { version, gate: 1, outcome: "passed" });
  }
  add("task.state", { version: "v1", state: "released" });
  add("task.state", { version: "v2", state: "released" });
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
  const solved = (version: string, harness: string, ending: Ending) => {
    solves += 1;
    const solve = `s-${String(solves)}`;
    add(SOLVE_STARTED, {
      solve,
      condition: recordCondition(log, condition(version, harness)),
      task: "t",
    });
    add("solve.call", {
      solve,
      turn: 1,
      tool: "bash",
      args: { command: "run" },
      isError: false,
      text: `margin of ${solve}`,
    });
    add("solve.turn", { solve, turn: 1, stopReason: "stop", text: "Submitted." });
    if (ending.outcome === "non-result" || (ending.outcome === "fail" && ending.kind === "rejected")) {
      const memo = textFiles([{ path: "memo.md", text: `${"margin ".repeat(2400)}MEMO_END` }]);
      add("verdict", {
        solve,
        answer: { answer: "41" },
        files: keepAnswerFiles(log, memo).map((file) => ({ ...file })),
        kind: "fail",
        blocking: [check],
      });
    }
    if (ending.outcome === "pass" && contract.objective !== undefined) {
      add("verdict", { solve, answer: { answer: "42" }, kind: "pass", objective: solves * 10 });
    }
    add(SOLVE_FINISHED, { solve, ending });
    return solve;
  };
  solved("v1", digest, { outcome: "fail", kind: "rejected" });
  add("referee.finding", { solve: "s-1", ruling: "earned" });
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
  const ran: { dir: string; digest: string }[] = [];
  const request: BuildRequest = {
    id: "b-1",
    parent,
    reference: parent,
    states: join(scratch, "states"),
    memory: join(scratch, "memory"),
    tasks: TASKS,
    contract,
    resources: [publicResource("span table", { maxSpan: 12 })],
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    solver: { model: "faux/faux-solver", effort: "medium" },
    solve: { ...LIMITS, wallSeconds: 480 },
    models: () => models,
    log,
    repoRoot: scratch,
    practise: async (task, dir, harness) => {
      ran.push({ dir, digest: harness });
      const ending = queue.shift() ?? { outcome: "pass" };
      return { solve: solved(task.version, harness, ending), ending };
    },
  };
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
    home,
    host,
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

describe.concurrent("the Builder running its campaign", () => {
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
    expect(left).toEqual([2, 0, 20]);
    expect(s.of("build.started")[0]?.limits).toMatchObject({ practiceSolves: 3 });

    const budgeted = await setup([finish]);
    append(budgeted.request.log, "campaign.opened", { budget: { dollars: 30, reserve: 1 } });
    await session(
      {
        ...budgeted.request,
        id: "b-budget",
        campaign: () => ({ tools: [], hook: () => "" }),
      },
      budgeted,
      budgeted.walled,
    );
    expect(budgeted.of("build.started")[0]?.limits).not.toHaveProperty("practiceSolves");

    const standalone = await setup([finish]);
    append(standalone.request.log, "campaign.opened", { budget: { dollars: 30, reserve: 1 } });
    await session({ ...standalone.request, id: "b-standalone" }, standalone, standalone.walled);
    expect(standalone.of("build.started")[0]?.limits).toMatchObject({ practiceSolves: 3 });
  });

  it("keeps its conversation and edits across a nested Examiner call, and refreshes practice", async () => {
    const late: PracticeTask = {
      version: "late",
      task: { taskId: "late-practice", family: "fixture", publicInput: { base: 11 } },
    };
    const s = await setup([
      edit,
      call("examine", {}),
      call(READ_OPENING, {}),
      call("practice", { tasks: [late.task.taskId] }),
      finish,
    ]);
    let opened = 0;
    let guidance = "Advice: examine";
    const built = await session(
      {
        ...s.request,
        models: (...given) => {
          opened += 1;
          return s.request.models(...given);
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
    expect(s.sent[0]).toContain("Advice: examine");
    expect(s.sent[2]).toContain("Examiner returned; practice was refreshed.");
    expect(s.sent[2]).toContain(GUIDE.trim());
    expect(s.sent[2]).not.toContain("Advice: compare");
    expect(s.sent[3]).toContain(late.task.taskId);
    expect(s.sent.join("\n")).not.toContain(CHECK);
    expect(s.sent.join("\n")).not.toContain(REASON);
    expect(s.of("build.turn")).toHaveLength(5);
  });
});

describe.concurrent("a Builder session", () => {
  it("lays practice in place of what the Builder left there, following none of its links", () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-practice-")));
    scratches.push(scratch);
    const [home, outside] = [join(scratch, "home"), join(scratch, "outside")];
    mkdirSync(home);
    mkdirSync(outside);
    writeFileSync(join(outside, "kept.json"), "OUTSIDE");
    symlinkSync(outside, join(home, "practice"));
    mkdirSync(join(home, ".practice-next"));
    writeFileSync(join(home, ".practice-next", "stale.json"), "STALE");
    layPractice(home, TASKS);
    expect(readdirSync(join(home, "practice")).toSorted()).toEqual(["t-1.json", "t-2.json"]);
    expect(readdirSync(outside)).toEqual(["kept.json"]);
    expect(readdirSync(home)).toEqual(["practice"]);
    writeFileSync(join(home, "practice", "notes.json"), "MINE");
    layPractice(home, TASKS.slice(0, 1));
    expect(readdirSync(join(home, "practice"))).toEqual(["t-1.json"]);
    rmSync(join(home, "practice"), { recursive: true });
    symlinkSync(join(scratch, "nowhere"), join(home, "practice"));
    layPractice(home, TASKS);
    expect(readdirSync(join(home, "practice")).toSorted()).toEqual(["t-1.json", "t-2.json"]);
    const payload = Buffer.from("PK\u0003\u0004binary-sheet-content");
    const encoded = payload.toString("base64");
    const withBin: PracticeTask = {
      version: "v-bin",
      task: {
        taskId: "t-bin",
        family: "fixture",
        publicInput: { files: [{ path: "sub/data.xlsx", base64: encoded }] },
      },
    };
    layPractice(home, [withBin]);
    expect(readFileSync(join(home, "practice", "t-bin", "files", "sub", "data.xlsx")).equals(payload)).toBe(
      true,
    );
    const openedJson = readFileSync(join(home, "practice", "t-bin.json"), "utf8");
    expect(openedJson).toContain("practice/t-bin/files/sub/data.xlsx");
    expect(openedJson).not.toContain(encoded);
    expect(namedTasks([{ path: "guide", text: encoded, executable: false }], [withBin.task])).toEqual([]);
    layPractice(home, TASKS);
    expect(readdirSync(join(home, "practice")).toSorted()).toEqual(["t-1.json", "t-2.json"]);
  });

  it("refuses a held task handed to a session before showing it to the Builder", async () => {
    const s = await setup([]);
    const held = { version: "v3", task: { taskId: "t-3", family: "fixture", publicInput: {} } };
    await expect(session({ ...s.request, tasks: [...TASKS, held] }, s, s.walled)).rejects.toThrow();
    expect(s.of("build.started")).toEqual([]);
    expect(s.sent).toEqual([]);
    expect(existsSync(join(s.home, "practice", "t-3.json"))).toBe(false);
  });

  it("is given the parent's record, practises, reads a trace, and leaves a frozen version", async () => {
    const earned: AuditFinding = {
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
        call(READ_TRACE, { solve: "s-3" }),
        call(READ_TRACE, { solve: "s-3", call: 1 }),
        call(READ_TRACE, { solve: "s-3", file: "memo.md", from: 16_384 }),
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
    expect(s.sent[0]).toContain("R1: The answer is the base times six.");
    expect(s.sent[0]).toContain("passed 0 of 1 under the harness you start from. Solves: s-1.");
    expect(s.sent[0]).toContain("t-2 (family fixture): not yet solved");
    expect(s.sent[0]).toContain("3 practice solves, 10 minutes and 12 turns");
    for (const fact of ["faux/faux-solver at medium effort", "has 8 minutes and its model turns unlimited"]) {
      expect(s.sent[0]).toContain(fact);
    }
    expect(s.sent[0]).toContain(`\\n- s-1, t-1, harness ${s.digest.slice(0, 8)}: fail (rejected); open.`);
    expect(s.sent[0]).toContain(String.raw`{"role":"user","content":"Public rules of the domain:`);
    expect(s.sent[0]).not.toContain("Historical notes");
    expect(existsSync(join(s.home, "MEMORY.md"))).toBe(false);
    expect(s.sent[0]).toContain("up to 10000 characters");
    expect(s.sent[0]).not.toContain("Comparisons so far");
    expect(readFileSync(join(s.home, "practice", "t-1.json"), "utf8")).toContain('"base": 7');
    expect(readFileSync(join(s.home, "resources.json"), "utf8")).toContain('"maxSpan": 12');
    expect(s.sent[0]).toContain("resources.json");
    const practised = s.sent[2] ?? "";
    expect(practised).toContain("t-1: fail (rejected). Solve s-3.");
    expect(practised).toContain(
      "passed 0 of 1. Under the reference harness, which is also the harness you started from: 0 of 1.",
    );
    expect(practised).not.toContain("Diagnosis");
    expect(practised).toContain("t-2: pass. Solve s-4.");
    expect(practised).toContain("1 practice solve left.");
    expect(s.sent[3]).toContain(String.raw`ending: fail (rejected)\nsubmitted answer: {\"answer\":\"41\"}`);
    expect(s.sent[3]).toContain(String.raw`\n1 bash (13 characters): run`);
    expect(s.sent[4]).toContain("result: margin of s-3");
    expect(s.sent[3]).toContain("delivered files: memo.md (16808 B)");
    expect(s.sent[5]).toContain("bytes 16384 to 16808 of 16808");
    expect(s.sent[5]).toContain("MEMO_END");
    expect(s.sent.join("\n")).not.toContain(CHECK);
    expect(s.sent.join("\n")).not.toContain(REASON);
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
      turns: 6,
    });
    expect(s.of(BUILD_CALL).map(({ tool: name }) => name)).toEqual([
      WRITE_FILE,
      "practice",
      READ_TRACE,
      READ_TRACE,
      READ_TRACE,
      "finish",
    ]);
    expect(
      recordsOf(s.events())
        .get("v1")
        ?.get(built.harness ?? ""),
    ).toEqual({ solves: ["s-3"], passed: 0 });
  });

  it("opens on the notes its last session left and each comparison's tally, and leaves notes of its own", async () => {
    const s = await setup([
      call(WRITE_FILE, {
        path: "MEMORY.md",
        content: "# Builder memory\n\nA table of factors did not help.\n",
      }),
      call(WRITE_FILE, { path: "scratch/gen.py", content: "print(6)\n" }),
      finish,
    ]);
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
    expect(s.sent[0]).toContain(
      String.raw`{"role":"user","content":"Historical notes, model-authored and possibly stale: what earlier sessions of this campaign left in MEMORY.md,`,
    );
    expect(s.sent[0]).toContain(String.raw`--- b-0 ---\n<!-- carried forward from b-0,`);
    expect(s.sent[0]).toContain("The base is always odd.");
    const opening = s.sent[0] ?? "";
    expect(opening.indexOf("The base is always odd.")).toBeLessThan(
      opening.indexOf("Public rules of the domain:"),
    );
    expect(s.sent[0]).toContain(
      `Harness ffffffff against harness ${s.digest.slice(0, 8)}, one comparison over 7 tasks: 1 won, 0 lost, 6 tied`,
    );
    expect(s.sent[0]).not.toContain(s.exam);
    expect(s.of(BUILD_FINISHED).at(-1)).toMatchObject({ session: "b-1", ended: "finished" });
    const own = join(s.request.memory, "b-1");
    expect(readdirSync(own)).toEqual(["MEMORY.md"]);
    expect(readFileSync(join(own, "MEMORY.md"), "utf8")).toBe(
      "# Builder memory\n\nA table of factors did not help.\n",
    );
  });

  it("re-serves a first session's opening without the notes it has written since", async () => {
    const note = "A table of factors did not help.";
    const s = await setup([
      call(WRITE_FILE, { path: "MEMORY.md", content: `# Builder memory\n\n${note}\n` }),
      call(READ_OPENING, {}),
      finish,
    ]);
    await session({ ...s.request, campaign: () => ({ hook: () => "", tools: [] }) }, s, s.walled);
    const opening = s.of(BUILD_CALL).find(({ tool: name }) => name === READ_OPENING)?.text;
    expect(opening).toContain("Public rules of the domain:");
    expect(opening).not.toContain(note);
  });

  it("shows objective measures, author best and current reference practice records in openings and after a promotion", async () => {
    const promoted = "f".repeat(64);
    const s = await setup([call(READ_OPENING, {}), call("promote", {}), call(READ_OPENING, {}), finish]);
    const contract = {
      ...s.request.contract,
      objective: { quantity: "interval width", direction: "lower" as const },
    };
    const { log } = s.request;
    append(log, "verdict", { solve: "s-1", kind: "pass", answer: { answer: 6 }, objective: 2.5 });
    append(log, "task.feasible", {
      version: "v1",
      session: "x-1",
      answer: { answer: 6 },
      objective: { quantity: "interval width", direction: "lower", measure: 1.25 },
    });
    const refCond = recordCondition(log, s.condition("v1", promoted));
    append(log, SOLVE_STARTED, { solve: "s-ref", condition: refCond, task: "t-1" });
    append(log, "verdict", { solve: "s-ref", kind: "pass", answer: { answer: 6 }, objective: 1.5 });
    append(log, SOLVE_FINISHED, { solve: "s-ref", ending: { outcome: "pass" } });
    const promote = (bench: Bench) =>
      tool({
        name: "promote",
        description: "Promote another harness.",
        parameters: Type.Object({}),
        execute: async () => {
          append(log, "harness.promoted", { harness: promoted });
          const { dir, harness } = bench.reference;
          bench.reference = { dir, harness: { ...harness, digest: promoted } };
          return text("Promoted.");
        },
      });
    await session(
      { ...s.request, contract, campaign: (bench) => ({ hook: () => "", tools: [promote(bench)] }) },
      s,
      s.walled,
    );
    const [before, after] = s
      .of(BUILD_CALL)
      .flatMap(({ tool: name, text: told }) => (name === READ_OPENING && isString(told) ? [told] : []));
    const moved = "The reference harness has changed since this conversation began.";
    expect(before).not.toContain(moved);
    expect(before).not.toContain("Under the reference harness (ffffffff)");
    // 2.5 against the author's 1.25 is a gain of -0.5, and 1.5 one of -1/6 (`gainOver`).
    expect(before).toContain("interval width against the author's answer: 50 to 90% worse. Solves: s-1.");
    expect(before).not.toContain("1.25");
    expect(after).toContain("The reference harness is harness ffffffff.");
    expect(after).toContain(moved);
    expect(after).toContain(
      "Under the reference harness (ffffffff): passed 1 of 1, the objective against the author's answer: 10 to 50% worse. Solves: s-ref.",
    );
  });

  it("re-arms finish notices when harness/ changes to a new digest and opens read_trace on a disputed practice task removed from bench.tasks", async () => {
    const editTwo = call(WRITE_FILE, { path: GUIDE_PATH, content: `${GUIDE}Second variant.\n` });
    const s = await setup([
      call("practice", { tasks: ["t-1"] }),
      edit,
      finish,
      editTwo,
      finish,
      call("drop_v2", {}),
      call(READ_TRACE, { solve: "s-disputed" }),
      finish,
    ]);
    const { log } = s.request;
    const cond = recordCondition(log, s.condition("v2", s.digest));
    append(log, SOLVE_STARTED, { solve: "s-disputed", condition: cond, task: "t-2" });
    append(log, SOLVE_FINISHED, { solve: "s-disputed", ending: { outcome: "fail", kind: "rejected" } });
    const built = await session(
      {
        ...s.request,
        campaign: (bench) => ({
          hook: () => "",
          tools: [
            tool({
              name: "drop_v2",
              description: "Simulate refreshPractice dropping a disputed task from bench.tasks.",
              parameters: Type.Object({}),
              execute: async () => {
                append(log, "task.state", {
                  version: "v2",
                  state: "disputed",
                  session: "b-1",
                  solve: "s-disputed",
                });
                bench.tasks = bench.tasks.filter(({ version }) => version !== "v2");
                return text("Dropped.");
              },
            }),
          ],
        }),
      },
      s,
      s.walled,
    );
    const finishes = s.of(BUILD_CALL).filter(({ tool: name }) => name === "finish");
    // Both distinct untried digests receive the notice; the third finish on the same digest ends the session.
    expect(finishes).toHaveLength(3);
    expect(finishes[0]?.text).toContain("harness/ has changed since your last practice solve");
    expect(finishes[1]?.text).toContain("harness/ has changed since your last practice solve");
    expect(finishes[2]?.text).toContain("Finished.");
    const traced = s.of(BUILD_CALL).find(({ tool: name }) => name === READ_TRACE);
    expect(traced?.isError).toBe(false);
    expect(traced?.text).toContain("ending: rejection set aside");
    expect(built.ended).toBe("finished");
  });

  it("sets aside unestablished practice rejections in results, traces and later records, and takes a check defect's task out of practice", async () => {
    for (const ruling of ["unclear", "check-defect", null, "absent", "crashed"] as const) {
      const s = await setup(
        [
          call("practice", { tasks: ["t-2"] }),
          call(READ_TRACE, { solve: "s-3" }),
          call(READ_OPENING, {}),
          call("practice", { tasks: ["t-2"] }),
          finish,
        ],
        [{ outcome: "fail", kind: "rejected" }],
      );
      const referee = async (solve: string): Promise<AuditFinding> => {
        if (ruling === "crashed") throw new Error(REASON);
        const finding: AuditFinding = {
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
      const defect = ruling === "check-defect";
      expect(recordsOf(s.events()).get("v2")?.get(s.digest) ?? { solves: [], passed: 0 }).toEqual(
        defect ? { solves: [], passed: 0 } : { solves: ["s-4"], passed: 1 },
      );
      expect(s.sent.join("\n")).not.toContain(CHECK);
      expect(s.sent.join("\n")).not.toContain(REASON);
      expect(JSON.stringify(calls[3]?.text ?? null).includes("t-2 is no longer a practice task")).toBe(
        defect,
      );
      expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ practiceSolves: defect ? 1 : 2, changed: false });
      expect(s.of("task.state").filter(({ state }) => state === "disputed")).toEqual(
        defect ? [{ version: "v2", state: "disputed", session: "b-1", solve: "s-3" }] : [],
      );
      expect(built).toMatchObject({ changed: false, dir: null, harness: s.digest });
      expect(s.of("harness.version")).toEqual([]);
    }
  });

  it("starts no session on a task an earlier session's practice ruled a check defect", async () => {
    for (const left of [true, false]) {
      const s = await setup([call("practice", { tasks: ["t-2"] }), finish], [{ outcome: "pass" }]);
      const disputed = { version: "v2", state: "disputed", session: "b-0", solve: "s-0" };
      if (left) append(s.request.log, "task.state", disputed);
      const started = session(s.request, s, s.walled);
      if (left) {
        await expect(started).rejects.toThrow(
          "t-2 is disputed, and a Builder practises on released tasks only",
        );
        expect(s.of("build.started")).toEqual([]);
      } else {
        await started;
        expect(s.of(BUILD_FINISHED).at(-1)).toMatchObject({ practiceSolves: 1 });
      }
    }
  });

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
      call(READ_TRACE, { solve: "s-2" }),
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
    const s = await setup([call(READ_TRACE, { solve: "g-1-v0" }), finish]);
    const { log } = s.request;
    append(log, SOLVE_STARTED, {
      solve: "g-1-v0",
      comparison: "g-1",
      condition: recordCondition(log, s.condition("v0", s.digest)),
      task: "t",
    });
    append(log, SOLVE_FINISHED, { solve: "g-1-v0", ending: { outcome: "fail", kind: "rejected" } });
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
    // The host hands the Builder no table of the reference; a solve under it comes back with its
    // record.
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
    expect(s.sent[3]).toContain("which is also the harness you started from: passed 1 of 2.");
    expect(s.sent[3]).toContain("Under harness/ as last practised: 1 of 1.");
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ practiceSolves: 2 });
  });

  it("is told the practice record under the reference a promotion made, and nothing of a comparison's solve under it", async () => {
    // A promotion inside a conversation makes the harness it froze the reference, whose record is the
    // Builder's own solves before it.
    const s = await setup([
      edit,
      call("practice", { tasks: ["t-1"] }),
      call("promote", {}),
      call("practice", { tasks: ["t-1"] }),
      call(WRITE_FILE, { path: GUIDE_PATH, content: `${GUIDE}Another method.\n` }),
      call("practice", { tasks: ["t-1"] }),
      finish,
    ]);
    const { log } = s.request;
    const campaign = (bench: Bench) => ({
      hook: () => "",
      tools: [
        tool({
          name: "promote",
          description: "Promote harness/ as a comparison that read a step does.",
          parameters: Type.Object({}),
          execute: async () => {
            const { dir, harness } = await snapshot(bench);
            append(log, SOLVE_STARTED, {
              solve: "g-1-v1",
              comparison: "g-1",
              condition: recordCondition(log, s.condition("v1", harness.digest)),
              task: "t",
            });
            append(log, SOLVE_FINISHED, {
              solve: "g-1-v1",
              ending: { outcome: "fail", kind: "no-answer" },
            });
            append(log, "harness.promoted", { harness: harness.digest });
            bench.reference = { dir, harness };
            return text("Promoted.");
          },
        }),
      ],
    });
    await session({ ...s.request, campaign }, s, s.walled);
    const results = s
      .of(BUILD_CALL)
      .flatMap(({ tool: name, text: told }) => (name === "practice" && isString(told) ? [told] : []));
    const started = "the harness you started from: 0 of 1.";
    expect(results[0]).toContain(
      "Record under this harness: passed 1 of 1. Under the reference harness, which is also the harness you started from: 0 of 1.",
    );
    expect(results[1]).toContain(
      `Record under this harness, which is also the reference harness: passed 2 of 2. Under ${started}`,
    );
    expect(results[2]).toContain(
      `Record under this harness: passed 1 of 1. Under the reference harness: 2 of 2. Under ${started}`,
    );
    expect(s.ran).toHaveLength(3);
  });

  it("is told each valid practice answer's band in the task's record under an objective, and none without one", async () => {
    const steps = [edit, call("practice", { tasks: ["t-1", "t-1"] }), finish];
    const measured = await setup(steps, [], false, CHECK, {
      ...CONTRACT,
      objective: { quantity: "cost", direction: "lower" },
    });
    append(measured.request.log, "task.feasible", {
      version: "v1",
      session: "x-1",
      answer: { answer: "1" },
      objective: { quantity: "cost", direction: "lower", measure: 30 },
    });
    await session(measured.request, measured, measured.walled);
    expect(measured.sent[2]).toContain(
      "passed 2 of 2, the objective against the author's answer: level, 10 to 50% worse.",
    );
    const plain = await setup(steps);
    await session(plain.request, plain, plain.walled);
    expect(plain.sent[2]).toContain("passed 2 of 2.");
    const told = plain
      .of(BUILD_CALL)
      .flatMap(({ tool: name, text: result }) => (name === "practice" && isString(result) ? [result] : []));
    expect(told.map((result) => result.split("Record under").length - 1)).toEqual([1]);
  });

  it("is told a band and never a measure, in a result and a record, and none where no author's answer is on record", async () => {
    // A measure may depend on a practice task's hidden values, and a few of them to four digits let
    // a Builder solve for those values, so no digit of a measure or of the author's reaches it.
    // 0.1234567901234568 and 1234.567901234568 on v1, then a whole number of three digits and one of six on v2.
    const measures = [1 / 8.1, 10_000 / 8.1, 100, 123_456];
    const s = await setup(
      [
        edit,
        call("practice", { tasks: ["t-1", "t-1"] }),
        call("practice", { tasks: ["t-2", "t-2"] }),
        finish,
      ],
      [],
      false,
      CHECK,
      { ...CONTRACT, objective: { quantity: "cost", direction: "lower" } },
    );
    const { log } = s.request;
    append(log, "task.feasible", {
      version: "v1",
      session: "x-1",
      answer: { answer: "1" },
      objective: { quantity: "cost", direction: "lower", measure: 0.8 / 8.1 },
    });
    const queue = [...measures];
    await session(
      {
        ...s.request,
        limits: { ...LIMITS, concurrency: 1, practiceSolves: 4 },
        practise: async (task, _dir, harness) => {
          const solve = `s-measured-${String(queue.length)}`;
          const condition = recordCondition(log, s.condition(task.version, harness));
          if (queue.length === measures.length) {
            // A comparison's own solve of this task under this harness, valid and measured: it is
            // the exam's, and the record below counts two solves and names two measures without it.
            append(log, SOLVE_STARTED, { solve: "g-1-v1", comparison: "g-1", condition, task: "t" });
            append(log, "verdict", {
              solve: "g-1-v1",
              answer: { answer: "42" },
              kind: "pass",
              objective: 8888.5,
            });
            append(log, SOLVE_FINISHED, { solve: "g-1-v1", ending: { outcome: "pass" } });
          }
          append(log, SOLVE_STARTED, { solve, condition, task: "t" });
          const objective = queue.shift() ?? 0;
          append(log, "verdict", { solve, answer: { answer: "42" }, kind: "pass", objective });
          append(log, SOLVE_FINISHED, { solve, ending: { outcome: "pass" } });
          return { solve, ending: { outcome: "pass" } };
        },
      },
      s,
      s.walled,
    );
    const [first, second] = s
      .of(BUILD_CALL)
      .flatMap(({ tool: name, text: told }) => (name === "practice" && isString(told) ? [told] : []));
    // Against the author's 0.8/8.1 the gains are -0.2 and about -0.9999 (`gainOver`).
    expect(first).toContain(
      "Measured the objective (cost) against the author's answer on record: 10 to 50% worse.",
    );
    expect(first).toContain(
      "Measured the objective against the author's answer on record: 90% or more worse.",
    );
    expect(first).toContain(
      "passed 2 of 2, the objective against the author's answer: 10 to 50% worse, 90% or more worse.",
    );
    expect(second).toContain("passed 2 of 2.");
    expect(second).not.toContain("against the author's answer");
    for (const digits of [
      "0.1234",
      "0.1235",
      "1234.5",
      "1235.",
      "0.09876",
      "0.09877",
      "100.0",
      "1.235e+5",
      "123456",
      "8888.5",
    ]) {
      expect(s.sent.join("\n")).not.toContain(digits);
    }
    const passes = s.of("verdict").filter(({ kind }) => kind === "pass");
    expect(passes.map(({ objective }) => objective)).toEqual([8888.5, ...measures]);
  });

  it("states the objective's quantity once a practice result, however many solves and harnesses it names", async () => {
    const quantity = "the summed cost of every listed item";
    const steps = [
      edit,
      call("practice", { tasks: ["t-1"], under: "reference" }),
      call("practice", { tasks: ["t-1", "t-1"] }),
      finish,
    ];
    const s = await setup(steps, [], false, CHECK, {
      ...CONTRACT,
      objective: { quantity, direction: "lower" },
    });
    append(s.request.log, "task.feasible", {
      version: "v1",
      session: "x-1",
      answer: { answer: "1" },
      objective: { quantity, direction: "lower", measure: 30 },
    });
    await session(s.request, s, s.walled);
    const results = [...(s.sent[3] ?? "").matchAll(/"toolName":"practice","content":(.*?),"details"/g)];
    const last = results.at(-1)?.[1] ?? "";
    expect(last).toContain(
      "Under the reference harness, which is also the harness you started from: 1 of 2, the objective against the author's answer: level.",
    );
    expect(last).toContain("Measured the objective against the author's answer on record:");
    expect(last.split(quantity)).toHaveLength(2);
  });

  it("qualifies practice bands as code-scored when the contract mixes judged items, without leaking criteria", async () => {
    const criterion = "SECRET-CRITERION-NEVER-SHOWN-TO-BUILDER";
    const contract: Contract = {
      ...CONTRACT,
      objective: {
        quantity: "quality",
        direction: "higher",
        scale: "unit",
        items: [
          { id: "accuracy", weight: 1 },
          { id: "clarity", weight: 1, kind: "judge", criterion },
        ],
      },
    };
    const steps = [call("practice", { tasks: ["t-1", "t-1"] }), call(READ_OPENING, {}), finish];
    const s = await setup(steps, [], false, CHECK, contract);
    append(s.request.log, "task.feasible", {
      version: "v1",
      session: "x-1",
      answer: { answer: "1" },
      objective: { quantity: "quality", direction: "higher", scale: "unit", measure: 30 },
    });
    await session({ ...s.request, campaign: () => ({ hook: () => "", tools: [] }) }, s, s.walled);
    const [practised] = s
      .of(BUILD_CALL)
      .flatMap(({ tool: toolName, text: told }) => (toolName === "practice" && isString(told) ? [told] : []));
    expect(practised).toContain(
      "Measured the code-scored part of the objective (quality) against the author's answer on record:",
    );
    expect(practised).toContain(
      "Measured the code-scored part of the objective against the author's answer on record:",
    );
    expect(practised).toContain(
      "passed 2 of 3, the code-scored part of the objective against the author's answer:",
    );
    expect(s.sent.join("\n")).not.toContain(criterion);
    const [opening] = s
      .of(BUILD_CALL)
      .flatMap(({ tool: toolName, text: told }) =>
        toolName === READ_OPENING && isString(told) ? [told] : [],
      );
    expect(opening).toContain("the code-scored part of the objective (quality) against the author's answer:");
  });

  it("names each valid answer's band by the gain a comparison reads, at every band and either way", async () => {
    // The band is `gainOver` against the author's answer, a share of the larger measure: level under
    // the 1% floor (`GAP_FLOOR`), then edged at 10%, 50% and 90%, better or worse.
    const gains = [-0.95, -0.7, -0.3, -0.05, -0.005, 0.005, 0.05, 0.3, 0.7, 0.95];
    const bands = ["90% or more worse", "50 to 90% worse", "10 to 50% worse", "1 to 10% worse", "level"];
    const expected = [...bands, ...bands.toReversed().map((band) => band.replace("worse", "better"))];
    const author = 0.8 / 8.1;
    // The measure `gain` better than the author's, as a share of the larger of the two: the measure is
    // the larger where it is worse and lower is better, or better and higher is.
    const measureAt = (direction: "lower" | "higher", gain: number) =>
      (direction === "lower") === gain < 0 ? author / (1 - Math.abs(gain)) : author * (1 - Math.abs(gain));
    for (const direction of ["lower", "higher"] as const) {
      const s = await setup([finish], [], false, CHECK, {
        ...CONTRACT,
        objective: { quantity: "cost", direction },
      });
      const { log } = s.request;
      append(log, "task.feasible", {
        version: "v1",
        session: "x-1",
        answer: { answer: "1" },
        objective: { quantity: "cost", direction, measure: author },
      });
      const measures = gains.map((gain) => measureAt(direction, gain));
      for (const [at, objective] of measures.entries()) {
        const solve = `s-band-${String(at)}`;
        append(log, SOLVE_STARTED, {
          solve,
          condition: recordCondition(log, s.condition("v1", s.digest)),
          task: "t",
        });
        append(log, "verdict", { solve, answer: { answer: "42" }, kind: "pass", objective });
        append(log, SOLVE_FINISHED, { solve, ending: { outcome: "pass" } });
      }
      await session(s.request, s, s.walled);
      const opening = s.sent[0] ?? "";
      expect(opening).toContain(`cost against the author's answer: ${expected.join(", ")}. Solves:`);
      for (const measure of [author, ...measures]) expect(opening).not.toContain(measure.toPrecision(4));
    }
  });

  it("states the objective's quantity once in the opening, however long and whatever word it begins with", async () => {
    const long = `the mean ${"weighted lateness of every job past its due time, ".repeat(6)}over all machines`;
    expect(long.length).toBeGreaterThan(300);
    for (const quantity of [long, "lower bound on the summed cost"]) {
      const s = await setup([finish], [], false, CHECK, {
        ...CONTRACT,
        objective: { quantity, direction: "lower" },
      });
      await session(s.request, s, s.walled);
      expect(s.sent[0]?.split(quantity)).toHaveLength(2);
    }
  });

  it("is told where its answers stand against a released task's author's answer, and nothing of a held-out one's", async () => {
    // A harness that answers alike in every solve still leaves room where its author's answer is
    // better, so the Builder is told each of its answers against the author's.
    const objective = { ...CONTRACT, objective: { quantity: "cost", direction: "lower" as const } };
    const steps = [edit, call("practice", { tasks: ["t-1"] }), finish];
    const told = async (authored: readonly (readonly [string, number])[]) => {
      const s = await setup(steps, [], false, CHECK, objective);
      for (const [version, measure] of authored) {
        append(s.request.log, "task.feasible", {
          version,
          session: "x-1",
          answer: { answer: "1" },
          objective: { quantity: "cost", direction: "lower", measure },
        });
      }
      await session(s.request, s, s.walled);
      return clockless(/"toolName":"practice","content":(.*?),"details"/.exec(s.sent[2] ?? "")?.[1] ?? "");
    };
    expect(await told([["v1", 12]])).toContain(
      "Measured the objective (cost) against the author's answer on record: 50 to 90% worse.",
    );
    const none = await told([]);
    expect(none).not.toContain("against the author's answer");
    expect(await told([["v3", 5]])).toBe(none);
    expect(await told([["v3", 7]])).toBe(none);
  });

  it("is not given the correctness model a v1 state carries, whose exam holds hidden values", async () => {
    const s = await setup([finish]);
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
    expect(s.ran[0]?.digest).toBe(s.digest);
    expect(JSON.stringify(s.of(BUILD_CALL)[1])).toContain(
      "harness/.toolchain/bin/greet, harness/.toolchain/bin/linked name your home",
    );
    expect(s.ran).toHaveLength(2);
    expect(s.ran[1]?.digest).not.toBe(s.digest);
    const greet = Bun.spawnSync([join(s.ran[1]?.dir ?? "", ".toolchain", "bin", "greet")]);
    expect(greet.stdout.toString()).toBe("hello-from-the-tool-tree\n");
    expect(built).toMatchObject({ harness: s.ran[1]?.digest, changed: true });
    expect(existsSync(join(s.parent, ".toolchain", "bin", "greet"))).toBe(false);
    const trees = readdirSync(s.request.states).filter((name) => name.startsWith("tree-"));
    expect(trees).toHaveLength(2);
    // A state goes where its campaign's folder goes, its tree beside it; linked by the tree's whole
    // path, one moved with its campaign would open with no tree and under another digest.
    const moved = `${s.request.states}-moved`;
    renameSync(s.request.states, moved);
    const reopened = await openHarness(join(moved, s.ran[1]?.digest ?? ""));
    expect(reopened.digest).toBe(s.ran[1]?.digest ?? "");
  });

  it("freezes no tool tree that is a link out of its home, and copies nothing it names", async () => {
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
    let reached = false;
    await expect(
      session(
        {
          ...s.request,
          practise: async (task, _dir, _digest, kill) => {
            if (task.version === "v1") throw new Error(stop);
            await new Promise((resolve) => {
              kill.addEventListener("abort", resolve, { once: true });
            });
            reached = true;
            return { solve: "s-killed", ending: { outcome: "non-result", kind: "killed", reason: "killed" } };
          },
        },
        s,
        s.walled,
      ),
    ).rejects.toThrow(stop);
    expect(reached).toBe(true);
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "crashed", crash: stop, changed: false });
    expect(JSON.stringify(s.of(BUILD_CALL)[0])).toContain("A practice solve could not be run");
    expect(JSON.stringify(s.of(BUILD_CALL))).not.toContain(CHECK);
    expect(s.sent.join("\n")).not.toContain(CHECK);
    expect(s.of(BUILD_CALL).map(({ tool: name }) => name)).toEqual(["practice"]);
  });

  it("keeps the harness a crashed session last practised as a harness snapshot, and no edit after it", async () => {
    const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" });
    const tried = await setup([edit, call("practice", { tasks: ["t-1"] }), failed]);
    const kept = await session(tried.request, tried, tried.walled);
    expect(kept).toMatchObject({ changed: true, ended: "crashed" });
    expect(tried.of("build.checkpoint")).toEqual([{ session: "b-1", harness: kept.harness }]);
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
    const unpractised = await setup([edit, failed]);
    expect(await session(unpractised.request, unpractised, unpractised.walled)).toMatchObject({
      changed: true,
      ended: "crashed",
    });
    expect(unpractised.of("build.checkpoint")).toEqual([]);
    expect(crashedRun(read(unpractised.request.log)).count).toBe(1);
  });

  it.each(["practised", "reference-practice", "unpractised", "missing", "mismatched", "snapshotted"])(
    "recovers a cut session from its last practised state only where it opens: %s",
    async (state) => {
      const failed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" });
      const later = call(WRITE_FILE, { path: GUIDE_PATH, content: `${GUIDE}More.\n` });
      const referencePractice =
        state === "reference-practice" ? [call("practice", { tasks: ["t-1"], under: "reference" })] : [];
      const practice =
        state === "unpractised" ? [] : [call("practice", { tasks: ["t-1"] }), ...referencePractice];
      const s = await setup([edit, ...practice, later, failed]);
      await session(s.request, s, s.walled);
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
        if (state === "snapshotted") append(cut, "build.checkpoint", { session: "b-1", harness: digest });
      }
      await endCut(cut);
      const harnessSnapshots = () => read(cut).filter(({ kind }) => kind === "build.checkpoint");
      const recoverable = ["practised", "reference-practice", "snapshotted"].includes(state);
      expect(harnessSnapshots().map(({ data }) => data)).toEqual(
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
      const parent = await resolveCheckpoint({ log: cut, states: s.request.states }, "--parent", "latest");
      const resumed = await setup([finish]);
      await session(
        { ...resumed.request, id: "b-2", log: cut, parent: parent.dir, states: s.request.states },
        resumed,
        resumed.walled,
      );
      expect(read(cut).findLast(({ kind }) => kind === "build.started")?.data.parent).toBe(digest);
      expect(readFileSync(join(resumed.home, GUIDE_PATH), "utf8")).toBe(GUIDE);
      expect(harnessSnapshots()).toHaveLength(1);
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

  it("freezes no harness that declares a tool of its own, and shows the Builder no path of the host's", async () => {
    const declaring = '{ "presets": ["bash"], "tools": [{ "name": "scale_base", "kind": "reader" }] }\n';
    const s = await setup([
      call(WRITE_FILE, { path: "harness/agent/tools-spec.json", content: declaring }),
      call("practice", { tasks: ["t-1"] }),
      finish,
    ]);
    const built = await session(s.request, s, s.walled);
    expect(JSON.stringify(s.of(BUILD_CALL)[1])).toContain(
      "the harness does not open: agent/tools-spec.json declares 1 tool (scale_base)",
    );
    expect(built).toMatchObject({ harness: null, changed: false });
    expect(s.ran).toEqual([]);
    expect(JSON.stringify(s.of(BUILD_CALL))).not.toContain(s.request.states);
    expect(JSON.stringify(s.of(BUILD_CALL))).not.toContain(s.scratch);
  });

  it(
    "ends at its deadline, and blames no host, when the deadline reaches a practice solve queued at the host",
    async () => {
      const s = await setup([call("practice", { tasks: ["t-1", "t-2"] }), finish]);
      const built = await session(
        {
          ...s.request,
          limits: { ...LIMITS, wallSeconds: QUEUED_WALL_SECONDS },
          practise: async (task, _dir, _digest, kill) => {
            if (!kill.aborted) {
              await new Promise((resolve) => {
                kill.addEventListener("abort", resolve, { once: true });
              });
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
    },
    3000 * QUEUED_WALL_SECONDS,
  );

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
    });
  });
});

// Rule 3: two campaigns alike in everything a Builder may know and different in everything it may not,
// so a session over each must read the same bytes; canaries alone would prove only themselves.
describe.concurrent("what crosses to the Builder", () => {
  /** What a campaign keeps from its Builder: the check that refused an answer, the Referee's
   *  reason, the hidden value of a held-out task and of a practice task (a practice solve's measure,
   *  which may depend on it, crosses; the value does not), which held-out task the
   *  comparison's new harness won, what the Examiner said of each task when it put it, and how the
   *  reference did on a held-out task under a session-tagged solve (pre-v0.14 logs), and what the
   *  verifier measured of a held-out answer under the objective (a practice answer's measure crosses). */
  interface Kept {
    readonly check: string;
    readonly reason: string;
    readonly hidden: string;
    readonly won: "h1" | "h2";
    readonly claim: string;
    readonly tried: "pass" | "fail";
    readonly family: string;
    readonly base: number;
    readonly measure: number;
  }
  const ONE: Kept = {
    check: "check-one-7a1",
    reason: "reason-one-7a1",
    hidden: "hidden-one-7a1",
    won: "h1",
    claim: "claim-one-7a1",
    tried: "pass",
    family: "family-one",
    base: 3,
    measure: 731.0625,
  };
  const OTHER: Kept = {
    check: "check-other-c4e9",
    reason: "reason-other-longer-c4e9",
    hidden: "hidden-other-c4e9-value",
    won: "h2",
    claim: "claim-other-c4e9-stops-here",
    tried: "fail",
    family: "family-other-held",
    base: 4096,
    measure: 98_765.4321,
  };
  const TRIED = "x-1-tried";
  const FRESH = "f".repeat(64);
  const OBJECTIVE = { quantity: "cost", direction: "lower" } as const;

  /**
   * Everything a Builder reads in one session over a campaign that keeps `kept` from it: every
   * context its model was sent and every file of its home, less the host's clock and the scratch's
   * path, in which two runs differ. `leak` puts the check that refused into a practice solve's
   * trace, which a Builder pages.
   */
  async function everythingRead(kept: Kept, leak: "sealed" | "leaking" = "sealed"): Promise<string> {
    const stop = fauxAssistantMessage("I think that is enough.");
    const s = await setup(
      [
        edit,
        call("practice", { tasks: ["t-1", "t-2"] }),
        call("practice", { tasks: ["t-1"], under: "reference" }),
        call(READ_TRACE, { solve: "s-3" }),
        call(READ_TRACE, { solve: "s-3", call: leak === "leaking" ? 2 : 1 }),
        call(READ_OPENING, {}),
        stop,
        finish,
      ],
      [{ outcome: "fail", kind: "rejected" }, { outcome: "pass" }, { outcome: "pass" }],
      false,
      kept.check,
      { ...CONTRACT, objective: OBJECTIVE },
    );
    const { log } = s.request;
    for (const version of ["h1", "h2"]) {
      const task = {
        taskId: `x-${version}`,
        family: kept.family,
        publicInput: { base: kept.base },
        hidden: kept.hidden,
      };
      append(log, "task.proposed", {
        version,
        taskId: task.taskId,
        session: "x-1",
        task,
        claim: { grade: 3, stops: kept.claim },
      });
      append(log, "task.gate", { version, gate: 1, outcome: "passed" });
      append(log, "task.feasible", {
        version,
        session: "x-1",
        answer: kept.hidden,
        objective: { ...OBJECTIVE, measure: kept.measure },
      });
    }
    append(log, "task.feasible", {
      version: "v1",
      session: "x-1",
      answer: { answer: "1" },
      objective: { ...OBJECTIVE, measure: 25 },
    });
    for (const version of ["h1", "h2"]) {
      for (const side of [s.digest, FRESH]) {
        const solve = `g-1-${version}-${side.slice(0, 4)}`;
        const lost = version === kept.won && side === s.digest;
        append(log, SOLVE_STARTED, {
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
        } else {
          append(log, "verdict", {
            solve,
            answer: { answer: kept.hidden },
            kind: "pass",
            objective: kept.measure,
          });
        }
        append(log, SOLVE_FINISHED, {
          solve,
          ending: lost ? { outcome: "fail", kind: "rejected" } : { outcome: "pass" },
        });
      }
    }
    append(log, "exam.started", { session: "x-1" });
    append(log, SOLVE_STARTED, {
      solve: TRIED,
      comparison: "x-1",
      condition: recordCondition(log, s.condition("h1", s.digest)),
      task: "x-h1",
    });
    append(log, "solve.call", {
      solve: TRIED,
      turn: 1,
      tool: "bash",
      args: { command: "run" },
      isError: false,
      text: `tried ${kept.hidden}`,
    });
    append(
      log,
      "verdict",
      kept.tried === "pass"
        ? { solve: TRIED, answer: { answer: kept.hidden }, kind: "pass", objective: kept.measure }
        : { solve: TRIED, answer: { answer: kept.hidden }, kind: "fail", blocking: [kept.check] },
    );
    append(log, SOLVE_FINISHED, {
      solve: TRIED,
      ending: kept.tried === "pass" ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
      turns: kept.tried === "pass" ? 4 : 9,
      billed: 0.5,
    });
    append(log, "exam.finished", { session: "x-1", ended: "finished", note: null });
    append(log, "referee.call", {
      reader: `judge-${kept.check}:clarity:ab`,
      tool: "record_vote",
      isError: false,
      args: { better: "A", reason: kept.reason },
    });
    append(log, "referee.pair", {
      comparison: "g-1",
      task: "x-h1",
      solve: "g-1-h1-fresh",
      old: "g-1-h1-old",
      reader: `judge-${kept.check}`,
      readers: [`judge-${kept.check}:clarity:ab`],
      judge: 1,
      holistic: 1,
      criteria: { clarity: 1, holistic: 1 },
      disagreed: [],
    });
    append(log, "referee.draft", {
      session: "d-1",
      pass: 1,
      verdict: "defects",
      summary: kept.reason,
      findings: [{ kind: "vacuous-pass", task: "x-h1", check: kept.check, probe: 1, reason: kept.reason }],
      probeRows: [
        {
          id: 1,
          original: { kind: "pass" },
          changed: { kind: "pass" },
          changes: [{ path: "$.answer", value: kept.hidden }],
        },
      ],
    });
    append(log, "comparison.reported", {
      session: "g-1",
      old: s.digest,
      fresh: FRESH,
      reading: "no-step",
      scored: { wins: 1, losses: 0, ties: 1, p: 0.5, unsolved: 0 },
      versions: kept.won === "h1" ? ["h1", "h2"] : ["h2", "h1"],
      aside: [],
      setting: settingId(s.condition("h1", s.digest)),
      solves: 1,
    });
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
    return clockless(
      [...s.sent, ...files.toSorted()]
        .join("\n")
        .replaceAll(s.scratch, "<scratch>")
        .replaceAll(/"(timestamp|durationMs)":\d+/g, '"$1":0')
        .replaceAll(/(faux|tool):\d+:\w+/g, "$1"),
    );
  }

  it("is byte-identical whatever a hidden value, a check, a ruling, the task that was won or the Examiner's try of the reference is", async () => {
    const [one, other] = [await everythingRead(ONE), await everythingRead(OTHER)];
    expect(one).toContain("Solve s-3.");
    expect(one).toContain("- s-1, t-1, harness");
    expect(one).toContain("result: margin of s-3");
    expect(one).toContain(
      "1 won, 0 lost, 1 tied, which reads no step. Validity differed on 1 of the 2 tasks.",
    );
    expect(one).toContain("You have not called finish");
    expect(one).toContain("practice/t-1.json");
    expect(one).toContain(", the objective against the author's answer: ");
    for (const kept of [ONE, OTHER]) {
      for (const canary of [
        kept.check,
        kept.reason,
        kept.hidden,
        kept.claim,
        kept.family,
        String(kept.measure),
        SETUP_CLAIM,
        "x-h1",
        "x-h2",
        "g-1-h",
        TRIED,
      ]) {
        expect(one).not.toContain(canary);
      }
    }
    expect(one === other).toBe(true);
  }, 60_000);

  // The nearest hostile case: a solve's trace that names the check that refused. No solver seat can do
  // this; it stands in for any path that would put a held-out detail into a message.
  it("is not, once a held-out detail reaches one message", async () => {
    const [one, other] = [await everythingRead(ONE, "leaking"), await everythingRead(OTHER, "leaking")];
    expect(one === other).toBe(false);
    expect(one).toContain(ONE.check);
  }, 60_000);
});

describe.concurrent("what a practice solve used", () => {
  it("is its time of its limit, the model's turns, the tokens it read and wrote, its failed calls and the calls that ran each program, and nothing the log does not hold", async () => {
    const s = await setup([call("practice", { tasks: ["t-1", "t-2", "t-1"] }), finish], [], true);
    const limits = { ...LIMITS, wallSeconds: 480 };
    // Each solve's own calls, as `read_trace` numbers them. The harness installs `hello`: a call
    // runs it by name or by path, and a word that only holds the name runs nothing. The third
    // solve has no call on record.
    const traced: readonly (readonly (readonly [string, string, boolean])[])[] = [
      [
        ["bash", "hello --fit data.csv", false],
        ["bash", "cd work && ./.toolchain/bin/hello", true],
        ["bash", "python3 fit.py", true],
        ["bash", "echo helloworld say-hello", false],
        ["read", "", false],
      ],
      [["bash", "ls", false]],
      [],
    ];
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
          const calls = traced[n] ?? [];
          n += 1;
          const solve = `s-used-${String(n)}`;
          const condition = recordCondition(s.request.log, s.condition(task.version, harness));
          append(s.request.log, SOLVE_STARTED, { solve, condition, task: "t", ...started });
          for (const [turn, [name, command, isError]] of calls.entries()) {
            const args = name === "bash" ? { command } : { path: "task.json" };
            append(s.request.log, "solve.call", { solve, turn, tool: name, args, isError, text: "" });
          }
          append(s.request.log, SOLVE_FINISHED, { solve, ending: { outcome: "pass" }, ...finished });
          return { solve, ending: { outcome: "pass" } };
        },
      },
      s,
      s.walled,
    );
    const line = (said: string) => JSON.stringify(`${said}\n`).slice(1, -1);
    expect(s.sent[1]).toContain(
      line(
        "t-1: pass. Solve s-used-1. It took 0:04 of 8:00 and 2 model turns of 10, and read 8394 tokens and wrote 131. It made 5 tool calls; failed: 2, 3. Harness programs run: hello 2 (1 failed).",
      ),
    );
    expect(s.sent[1]).toContain(
      line(
        "t-2: pass. Solve s-used-2. It took 3:42 of 8:00 and 14 model turns. It made 1 tool call; failed: none. Harness programs run: none of 1.",
      ),
    );
    expect(s.sent[1]).toContain(line("t-1: pass. Solve s-used-3."));
    expect(s.sent[1]).not.toContain("unused)");
  });

  it("omits per-solve unused noise on multi-bin harnesses", async () => {
    const s = await setup([call("practice", { tasks: ["t-1", "t-2"] }), finish], [], true);
    const binDir = join(s.home, HOME_TOOL_TREE, "bin");
    mkdirSync(binDir, { recursive: true });
    for (const bin of ["alpha", "beta", "gamma"]) {
      const path = join(binDir, bin);
      writeFileSync(path, "#!/bin/sh\necho ok\n");
      chmodSync(path, 0o755);
    }
    const calls = [[["bash", "alpha data.csv", false] as const], [["bash", "beta data.csv", false] as const]];
    let n = 0;
    await session(
      {
        ...s.request,
        practise: async (task, _dir, harness) => {
          const solve = `s-multi-${String(n + 1)}`;
          const runCalls = calls[n] ?? [];
          n += 1;
          const condition = recordCondition(s.request.log, s.condition(task.version, harness));
          append(s.request.log, SOLVE_STARTED, {
            solve,
            condition,
            task: task.task.taskId,
            side: "practice",
          });
          for (const [turn, [toolName, command, isError]] of runCalls.entries()) {
            append(s.request.log, "solve.call", {
              solve,
              turn,
              tool: toolName,
              args: { command },
              isError,
              text: "",
            });
          }
          append(s.request.log, SOLVE_FINISHED, { solve, ending: { outcome: "pass" }, turns: 2, seconds: 5 });
          return { solve, ending: { outcome: "pass" } };
        },
      },
      s,
      s.walled,
    );
    const result = s.of(BUILD_CALL).find(({ tool: name }) => name === "practice")?.text ?? "";
    expect(result).toContain("Harness programs run: alpha 1.");
    expect(result).toContain("Harness programs run: beta 1.");
    expect(result).not.toContain("unused)");
  });

  it("persists the read_opening cue after Builder compaction until read_opening runs and preserves reusability facts in systemPrompt", async () => {
    const s = await setup(
      [
        call("practice", { tasks: ["t-1"] }),
        call("practice", { tasks: ["t-2"] }),
        call(READ_OPENING, {}),
        call("practice", { tasks: ["t-1"] }),
        finish,
      ],
      [],
      true,
    );
    let firstTurn = true;
    await session(
      {
        ...s.request,
        models: (...given) => {
          const baseModels = s.request.models(...given);
          // SAFETY: inherited instance supplies every method; streamSimple attaches compaction diagnostics on turn 1.
          const compactedModels = Object.create(baseModels) as typeof baseModels;
          compactedModels.streamSimple = (...asked: Parameters<typeof baseModels.streamSimple>) => {
            const streamed = createAssistantMessageEventStream();
            (async () => {
              for await (const event of baseModels.streamSimple(...asked)) {
                if (event.type === "done" && firstTurn) {
                  firstTurn = false;
                  streamed.push({
                    ...event,
                    message: {
                      ...event.message,
                      diagnostics: [
                        {
                          type: CLAUDE_COMPACTED,
                          timestamp: Date.now(),
                          details: { tokensBefore: 1000, seconds: 1 },
                        },
                      ],
                    },
                  });
                } else {
                  streamed.push(event);
                }
              }
            })().catch(() => undefined);
            return streamed;
          };
          return compactedModels;
        },
      },
      s,
      s.walled,
    );
    const texts = s.of(BUILD_CALL).map(({ text: body }) => (isString(body) ? body : ""));
    const cue = "Context compacted; read_opening holds the opening record and limits.";
    expect(texts[0]).toContain(cue);
    expect(texts[1]).toContain(cue);
    expect(texts[2]).not.toContain(cue);
    expect(texts[3]).not.toContain(cue);
    expect(s.sent[0]).toContain("General, composable programs under .toolchain/");
    expect(s.sent[0]).toContain("## Validity and score");
  });
});

describe.skipIf(!osIsolationSupport().ok)("a Builder session under the command wall", () => {
  it("writes its harness through the wall, checks it, and cannot read the repository", async () => {
    let canary = "";
    const s = await setup(
      [
        () => call("bash", { command: `cat '${canary}' 2>&1; echo "read:$?"` }),
        call(WRITE_FILE, { path: "../../escape.txt", content: "x" }),
        call(WRITE_FILE, { path: "harness/agent", content: "x" }),
        edit,
        call("bash", { command: 'cat "$HOME/harness/agent/BUILT_AGENTS.md"; ls "$HOME/practice"' }),
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
        call("bash", {
          command: [
            'rm "$HOME/harness/.toolchain/bin/named"',
            'echo "Record the answer." >> "$HOME/harness/agent/BUILT_AGENTS.md"',
            'mkdir "$HOME/harness/.toolchain/lib"',
            String.raw`printf 'VALUE = 42\n' > "$HOME/harness/.toolchain/lib/helper.py"`,
            'printf \'export PYTHONPATH="${BASH_SOURCE%%/*}/lib:${PYTHONPATH:-}"\\n\' > "$HOME/harness/.toolchain/env.sh"',
            String.raw`printf 'open("public/task.json")\n' > "$HOME/harness/.toolchain/lib/inspect.py"`,
          ].join(" && "),
        }),
        call("check_harness", {}),
        call("bash", {
          command: "python3 -c 'import helper; print(helper.VALUE)'; pwd -P; head -1 HARNESS.md",
        }),
        call("edit", {
          path: GUIDE_PATH,
          edits: [{ oldText: "Multiply", newText: "Always multiply" }],
        }),
        call("read", { path: GUIDE_PATH }),
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
    expect(calls[8]).toContain(
      String.raw`The harness opens.\npi's tools: bash.\nPrograms: greet, hello, real.\nGuide: 2 lines (47 characters; no \"## Validity and score\" heading).\nYour files under .toolchain/: 6 files, 9 lines.\nFiles in harness/ carry 1 reference to campaign files (lib/inspect.py).\nThe guide names 1 answer field (answer), with no`,
    );
    expect(calls[8]).not.toContain("Matches a practice task:");
    expect(calls[9]).toContain(String.raw`42\n`);
    expect(calls[9]).toContain(String.raw`/home\n# The Built Harness`);
    expect(calls[10]).toContain("Successfully replaced 1 block(s)");
    expect(calls[11]).toContain("Always multiply before you record.");
    expect(calls[12]).toContain("greet");
    expect(responses.join("\n")).not.toContain(CHECK);
    expect(built).toMatchObject({ changed: true, ended: "finished" });
    expect(readFileSync(join(built.dir ?? "", "agent", "BUILT_AGENTS.md"), "utf8")).toBe(GUIDE);
    const greet = Bun.spawnSync([join(built.dir ?? "", ".toolchain", "bin", "greet")]);
    expect(greet.stdout.toString()).toBe("installed-greeting\n");
    expect(existsSync(join(s.parent, ".toolchain", "bin", "greet"))).toBe(false);
    const kept = readdirSync(request.states).filter((name) => name !== DELIVERABLES.folder);
    const states = kept.filter((name) => !name.startsWith("tree-"));
    expect(states).toEqual([built.harness ?? ""]);
    expect(kept).toHaveLength(2);
    // And no copy of the tree is left that no state links: a check copies the tree all the same, and an
    // unlinked copy wastes megabytes each time.
    const linked = states.map((state) => readlinkSync(join(request.states, state, ".toolchain")));
    for (const name of kept.filter((each) => each.startsWith("tree-"))) {
      expect(linked).toContain(join("..", name));
    }
  }, 120_000);
});

describe("harness file checks and practice task mentions", () => {
  it("reports host paths, heading leaks, and named or quoted practice tasks while staying silent on clean harnesses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-harness-files-"));
    try {
      const clean = join(dir, "clean");
      mkdirSync(join(clean, "agent"), { recursive: true });
      mkdirSync(join(clean, TOOL_TREE_DIR, "bin"), { recursive: true });
      writeFileSync(
        join(clean, "agent", "BUILT_AGENTS.md"),
        "# Guide\nUse tool.\n\n## Validity and score\nWrite answer.json.\n",
      );
      writeFileSync(join(clean, TOOL_TREE_DIR, "bin", "run-tool"), "#!/usr/bin/env sh\necho ok\n");
      chmodSync(join(clean, TOOL_TREE_DIR, "bin", "run-tool"), 0o755);

      const answerKeys = formatKeys({ properties: { estimateValue: { type: "number" } } });
      const shared = "logistic model with exposure and age as linear terms";
      const tasks = [
        {
          taskId: "task-alpha-1",
          publicInput: {
            prompt: `follow up from the later of entry for subject S01-007 (Kaplan-Meier, 365.25, 2024-3-5, age_group) and compute the quarterly regional payroll total accurately every month using ${shared}`,
          },
        },
        {
          taskId: "task-beta-2",
          publicInput: { prompt: `estimate annual warehouse throughput under peak load using ${shared}` },
        },
        {
          taskId: "task-gamma-3",
          publicInput: { prompt: `reconcile laboratory assay batches across clinics using ${shared}` },
        },
      ];
      const cleanInfo = readHarnessFiles(clean, answerKeys, ["R-1"]);
      expect(cleanInfo).toMatchObject({
        hasSplit: true,
        keptLines: 2,
        keptHostRefs: 0,
        keptFormatKeys: 0,
        keptRuleIds: 0,
        hostPaths: 0,
        hostShebangs: 0,
        plainBins: 0,
        brokenLinks: 0,
        campaignRefs: 0,
      });
      expect(namedTasks(cleanInfo.written, tasks)).toEqual([]);

      // Six-word generic prose, ordinary domain tokens/dates, and boilerplate shared across >2 tasks
      // stay silent; rare task codes and rare 8-word quotes carry exact line numbers and text.
      const proseOnly = [
        {
          path: "guide",
          text: `Follow-up from the later of entry; Kaplan-Meier over 365.25 days, 2024-3-5, age_group; fit ${shared}.\n`,
          executable: false,
        },
      ];
      expect(namedTasks(proseOnly, tasks)).toEqual([]);

      const dirty = join(dir, "dirty");
      mkdirSync(join(dirty, "agent"), { recursive: true });
      mkdirSync(join(dirty, TOOL_TREE_DIR, "bin"), { recursive: true });
      writeFileSync(
        join(dirty, "agent", "BUILT_AGENTS.md"),
        "# Guide\nRead public/task.json for estimateValue under R-1 on task-alpha-1 (drop S01-007): compute the quarterly regional payroll total accurately every month.\n",
      );
      writeFileSync(
        join(dirty, TOOL_TREE_DIR, "bin", "bad-bin"),
        "#!/Users/dev/python3\nprint('/opt/homebrew/bin')\n",
      );
      chmodSync(join(dirty, TOOL_TREE_DIR, "bin", "bad-bin"), 0o644);
      symlinkSync("/no/such/target", join(dirty, TOOL_TREE_DIR, "bin", "broken"));
      writeFileSync(
        join(dirty, TOOL_TREE_DIR, "bin", "inspect"),
        "#!/usr/bin/env sh\ncat public/task.json\n",
      );
      chmodSync(join(dirty, TOOL_TREE_DIR, "bin", "inspect"), 0o755);

      const dirtyInfo = readHarnessFiles(dirty, answerKeys, ["R-1"]);
      expect(dirtyInfo).toMatchObject({
        hasSplit: false,
        keptHostRefs: 1,
        keptHostRefNames: ["public/task.json"],
        keptFormatKeys: 1,
        keptFormatKeyNames: ["estimateValue"],
        keptRuleIds: 1,
        keptRuleIdNames: ["R-1"],
        hostPaths: 2,
        hostShebangs: 1,
        plainBins: 1,
        brokenLinks: 1,
        campaignRefs: 1,
        campaignRefFiles: ["bin/inspect"],
      });
      expect(namedTasks(dirtyInfo.written, tasks)).toEqual([
        "guide names task-alpha-1",
        'guide:2 uses code "S01-007" from task-alpha-1',
        'guide:2 quotes task-alpha-1 ("compute the quarterly regional payroll total accurately every month")',
      ]);

      const envHome = join(dir, "env-home");
      const envStates = join(dir, "env-states");
      const envDir = join(envHome, HOME_TOOL_TREE);
      writeStarter(join(envHome, "harness"));
      mkdirSync(envDir, { recursive: true });
      const snapEnv = () =>
        snapshot({ request: { states: envStates }, home: envHome, tree: null, opened: null });
      writeFileSync(join(envDir, "env.sh"), `export PYTHONPATH="${envHome}/lib"\n`);
      await expect(snapEnv()).rejects.toThrow(/name your home/u);
      writeFileSync(join(envDir, "env.sh"), 'export X="unterminated\n');
      await expect(snapEnv()).rejects.toThrow(
        /^the harness does not open: harness\/\.toolchain\/env\.sh: a bash syntax error: harness\/tree-/u,
      );
      writeFileSync(join(envDir, "env.sh"), 'export PYTHONPATH="${BASH_SOURCE%/*}/lib"\n');
      expect((await snapEnv()).harness.digest).toHaveLength(64);
      rmSync(join(envDir, "env.sh"));
      writeFileSync(join(envDir, "real-env.sh"), "export X=1\n");
      symlinkSync("real-env.sh", join(envDir, "env.sh"));
      await expect(snapEnv()).rejects.toThrow(/must be a regular file/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads delivered images and embedded visuals via read_trace with vision gating, byte paging, and refusal on missing refs", async () => {
    const png1x1 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const docx = storedZip([
      {
        path: "word/document.xml",
        text: "<w:document><w:body><w:p><w:r><w:t>Summary</w:t></w:r></w:p></w:body></w:document>",
      },
      { path: "word/media/chart.png", text: Buffer.from(png1x1, "base64") },
    ]).toString("base64");
    const s = await setup([]);
    const files = keepAnswerFiles(s.request.log, [
      { path: "plot.png", base64: png1x1 },
      { path: "report.docx", base64: docx },
    ]);
    const cond = recordCondition(s.request.log, {
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
      limits: LIMITS,
      host: "h1",
      side: "test",
    });
    append(s.request.log, SOLVE_STARTED, { solve: "s-vis", condition: cond, task: "t-1" });
    append(s.request.log, "verdict", {
      solve: "s-vis",
      answer: { answer: "42" },
      files: files.map((file) => ({ ...file })),
      kind: "pass",
    });
    append(s.request.log, SOLVE_FINISHED, { solve: "s-vis", ending: { outcome: "pass" } });

    const seen: string[] = [];
    const fauxVision = fauxProvider({
      models: [
        {
          id: "faux-vision-builder",
          input: ["text", "image"],
          contextWindow: 200_000,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        },
      ],
    });
    const steps = [
      call(READ_TRACE, { solve: "s-vis", file: "plot.png" }),
      call(READ_TRACE, { solve: "s-vis", file: "plot.png", from: 1 }),
      call(READ_TRACE, { solve: "s-vis", file: "report.docx" }),
      call(READ_TRACE, { solve: "s-vis", file: "report.docx#word/media/chart.png" }),
      call(READ_TRACE, { solve: "s-vis", file: "absent.png" }),
      call(READ_TRACE, { solve: "s-vis", file: "report.docx#no-such.png" }),
      finish,
    ];
    fauxVision.setResponses(
      steps.map(
        (step): FauxResponseStep =>
          (context) => {
            seen.push(JSON.stringify(context));
            return step;
          },
      ),
    );
    const models = createModels();
    models.setProvider(fauxVision.provider);
    await session({ ...s.request, model: fauxVision.getModel(), models: () => models }, s, s.walled);
    expect(seen[1]).toContain('"type":"image"');
    expect(seen[1]).toContain("plot.png");
    expect(seen[2]).toContain("bytes 0 to 0 of 0");
    expect(seen[3]).toContain("embedded images: report.docx#word/media/chart.png");
    expect(seen[4]).toContain("report.docx#word/media/chart.png");
    const calls = s.of(BUILD_CALL).filter(({ tool: name }) => name === READ_TRACE);
    expect(calls[0]?.text).toStartWith("plot.png (binary,");
    expect(calls[3]?.text).toStartWith("report.docx#word/media/chart.png\n");
    expect(calls[4]?.isError).toBe(true);
    expect(calls[4]?.text).toContain("delivered no file absent.png");
    expect(calls[5]?.isError).toBe(true);
    expect(calls[5]?.text).toContain("has no viewable image report.docx#no-such.png");
  });

  it("backgrounds slow practice past the cutoff, steers results past large tool outputs, waits on yield, and settles before finish", async () => {
    expect(PRACTICE_WAIT_SECONDS).toBe(290);
    const gates = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
    const [first, second, third, fourth] = gates;
    let settledBeforeFinish = false;
    const s = await setup([
      call("practice", { tasks: ["t-1"] }),
      call("practice", { tasks: ["t-1"] }),
      call("practice", { tasks: ["t-2"] }),
      () => {
        first?.resolve();
        second?.resolve();
        return call("big", {});
      },
      call("practice", { tasks: ["t-1"] }),
      () => {
        setTimeout(() => third?.resolve(), 30);
        return fauxAssistantMessage("Waiting for practice.");
      },
      call("practice", { tasks: ["t-1"] }),
      () => {
        setTimeout(() => {
          settledBeforeFinish = true;
          fourth?.resolve();
        }, 60);
        return finish;
      },
    ]);
    let calls = 0;
    const built = await session(
      {
        ...s.request,
        limits: { ...LIMITS, practiceSolves: 5 },
        practiceWaitSeconds: 0.02,
        practise: async (task, dir, digest, kill) => {
          calls += 1;
          if (calls > 1) await gates.shift()?.promise;
          return await s.request.practise(task, dir, digest, kill);
        },
      },
      s,
      (bench) => [
        ...s.walled(bench),
        tool({
          name: "big",
          description: "Returns a full-size result after background practice settles.",
          parameters: Type.Object({}),
          execute: async () => {
            await bench.practising;
            return text("x".repeat(50_000));
          },
        }),
      ],
    );
    const said = s
      .of(BUILD_CALL)
      .map(({ tool: name, text: shown }) => [name, isString(shown) ? shown : ""] as const);
    expect(
      said.map(([name, shown]) => [name, shown.startsWith("Practice is still running after 0.02 s.")]),
    ).toEqual([
      ["practice", false],
      ["practice", true],
      ["practice", true],
      ["big", false],
      ["practice", true],
      ["practice", true],
      ["finish", false],
    ]);
    expect(said[0]?.[1]).toContain("t-1: pass.");
    expect(s.sent[3]).toMatch(
      /Practice begun earlier has finished:\\nt-1: pass\.[^]*Practice begun earlier has finished:\\nt-2: pass\./u,
    );
    expect(s.sent[4]?.split("Practice begun earlier has finished").length).toBe(4);
    expect(built).toMatchObject({ ended: "finished" });
    expect(settledBeforeFinish).toBe(true);
    const events = read(s.request.log);
    expect(events.findLastIndex(({ kind }) => kind === SOLVE_FINISHED)).toBeLessThan(
      events.findLastIndex(({ kind }) => kind === BUILD_FINISHED),
    );
    expect(s.of(BUILD_FINISHED)[0]).toMatchObject({ practiceSolves: 5, crash: null });
  });

  it("stops background practice on kill, refunds unstarted solves, and steers late non-fatal errors", async () => {
    const kill = new AbortController();
    const killed = await setup([
      call("practice", { tasks: ["t-1", "t-2"] }),
      () => {
        kill.abort(new Error("stopped"));
        return fauxAssistantMessage("Waiting for practice.");
      },
    ]);
    let started = 0;
    const built = await session(
      {
        ...killed.request,
        limits: { ...LIMITS, concurrency: 1 },
        kill: kill.signal,
        practiceWaitSeconds: 0.02,
        practise: async (_task, _dir, _digest, signal) => {
          if (signal.aborted) throw signal.reason;
          started += 1;
          await new Promise((resolve) => {
            signal.addEventListener("abort", resolve);
          });
          return { solve: "s-killed", ending: { outcome: "non-result", kind: "killed", reason: "killed" } };
        },
      },
      killed,
      killed.walled,
    );
    expect(started).toBe(1);
    expect(built).toMatchObject({ ended: "killed", changed: false });
    expect(killed.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "killed", crash: null, practiceSolves: 1 });

    const gate = Promise.withResolvers<void>();
    const lateErr = await setup(
      [
        call("practice", { tasks: ["t-1"] }),
        call("practice", { tasks: ["missing-task"] }),
        call("practice", { tasks: ["t-1"] }),
        () => {
          gate.resolve();
          return fauxAssistantMessage("Waiting for error.");
        },
        finish,
      ],
      [{ outcome: "non-result", kind: "check", reason: "boom" }],
    );
    await session(
      {
        ...lateErr.request,
        practiceWaitSeconds: 0.02,
        practise: async (task, dir, digest, signal) => {
          await gate.promise;
          return await lateErr.request.practise(task, dir, digest, signal);
        },
      },
      lateErr,
      lateErr.walled,
    );
    expect(lateErr.of(BUILD_CALL)[1]).toMatchObject({
      tool: "practice",
      isError: true,
    });
    expect(lateErr.sent.at(-1)).toContain("Practice begun earlier failed: t-1 is no longer a practice task");

    const queuedGate = Promise.withResolvers<void>();
    let queuedSolves = 0;
    const skippedAfterFinish = await setup([
      call("practice", { tasks: ["t-1"] }),
      call("practice", { tasks: ["t-2"] }),
      () => {
        setTimeout(() => queuedGate.resolve(), 30);
        return finish;
      },
    ]);
    await session(
      {
        ...skippedAfterFinish.request,
        practiceWaitSeconds: 0.02,
        practise: async (task, dir, digest, signal) => {
          queuedSolves += 1;
          await queuedGate.promise;
          return await skippedAfterFinish.request.practise(task, dir, digest, signal);
        },
      },
      skippedAfterFinish,
      skippedAfterFinish.walled,
    );
    expect(queuedSolves).toBe(1);
    expect(skippedAfterFinish.of(BUILD_FINISHED)[0]).toMatchObject({ ended: "finished", practiceSolves: 1 });
  });
});
