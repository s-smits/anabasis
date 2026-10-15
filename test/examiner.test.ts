// The Examiner's one session, `examine`, in its two modes on the faux provider: what both modes
// share (an id, a wall, a shell, an ending, a bill), what a drafting session that puts one whole
// draft is told, what a writing session's gate and tools hold, and what a task's author hears of it.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  createAssistantMessageEventStream,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { draftOf } from "../src/examiner/draft.ts";
import { heard } from "../src/examiner/record.ts";
import { examine } from "../src/examiner/session.ts";
import { examinerDirs } from "../src/examiner/shell.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { writtenTasks } from "../src/kernel/history.ts";
import { append, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { billedAll, billedParts, poolOf } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { ranUnder, solvesIn } from "../src/kernel/solves.ts";
import { type TaskPackage, taskSets, taskStates, taskVersion } from "../src/kernel/task.ts";
import type { Verdict, Verifier } from "../src/kernel/verify.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { dirname, join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import {
  bash,
  call,
  condition,
  EXAMPLE,
  failed,
  finish,
  instance,
  KIND,
  MODES,
  NOTE,
  PUT,
  propose,
  REPO,
  SOUND,
  seat,
  sweep,
  USED,
  WALL,
} from "./helpers/examiner-seat.ts";

/** The event a tool call of the Examiner writes, with the text it was told. */
const CALLED = "exam.call";
/** A solver-side secret no Examiner may be shown: the text of a measured solve's answer. */
const SOLVER = "solver-canary-7f3a";
const PASS: Ending = { outcome: "pass" };
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
const WALLED: Ending = { outcome: "fail", kind: "wall-ended" };
const GOOD = { answer: "42", unit: "N" };
/** What enters the exam, and by which tool, as each mode's shell is told it. */
const ENTERS = {
  draft: "a draft enters it through draft_exam alone",
  write: "a task enters it through propose_tasks alone",
} as const;
const TOOL_USE = { stopReason: "toolUse" } as const;
/** A verifier that passes every answer whose `answer` is "42" and refuses any other. */
const verify: Verifier = async (_task, answer) =>
  asRecord(answer)?.answer === "42" ? { kind: "pass" } : { kind: "fail", blocking: ["check-product"] };
const tried = (base: number | null, answer: JsonValue = GOOD, hidden: JsonValue = { seed: 1 }) =>
  call("try_answer", { ...instance(base), hidden, answer });
const triedExample = call("try_answer", {
  family: EXAMPLE.family,
  public_input: EXAMPLE.publicInput,
  hidden: EXAMPLE.hidden ?? null,
  answer: { answer: "12", unit: "N" },
});

setDefaultTimeout(120_000);
afterAll(sweep);

describe("a session of any mode", () => {
  it("ends at finish with nothing put, and its result and its last event say the same", async () => {
    for (const mode of MODES) {
      const s = seat(mode, [finish, finish]);
      const before = billedAll(read(s.log));
      expect(await examine(s.request)).toEqual({
        ended: "finished",
        puts: 0,
        held: [],
        refused: [],
      });
      expect(s.of(`${KIND[mode]}.started`)).toMatchObject([
        { session: s.request.id, effort: "medium", limits: { wallSeconds: 600, turns: 12 } },
      ]);
      expect(s.of(`${KIND[mode]}.finished`)).toMatchObject([
        { session: s.request.id, ended: "finished", note: NOTE, crash: null },
      ]);
      // What it billed is in its last event, and so in the campaign's total.
      expect(billedAll(read(s.log))).toBeGreaterThan(before);
      // Without a wall it is given no shell, and no tool's description speaks of a home.
      expect(s.sent[0]).not.toContain('{"name":"bash"');
      expect(s.sent[0]).not.toContain("Nothing in your home enters the exam");
    }
  });

  it("stops before another turn where its campaign's budget holds no reserve for one", async () => {
    for (const mode of MODES) {
      const s = seat(mode, [fauxAssistantMessage("One turn."), fauxAssistantMessage("Never asked for.")]);
      const models = s.request.models();
      // The faux provider bills a turn nothing, so each turn is given a cost as it ends.
      // SAFETY: the inherited instance supplies every method; streamSimple alone is replaced.
      const metered = Object.create(models) as typeof models;
      metered.streamSimple = (...asked: Parameters<typeof models.streamSimple>) => {
        const streamed = createAssistantMessageEventStream();
        void (async () => {
          for await (const event of models.streamSimple(...asked)) {
            if (event.type === "done") {
              const cost = { input: 0, output: 0.15, cacheRead: 0, cacheWrite: 0, total: 0.15 };
              streamed.push({
                ...event,
                message: { ...event.message, usage: { ...event.message.usage, cost } },
              });
            } else streamed.push(event);
          }
        })().catch(() => undefined);
        return streamed;
      };
      // A budget with nothing over its reserve: what the first turn bills takes it under.
      append(s.log, "campaign.opened", { budget: { dollars: 0.1, reserve: 0.1 } });
      expect(await examine({ ...s.request, models: () => metered })).toMatchObject({
        ended: "stopped",
        puts: 0,
      });
      expect(s.sent).toHaveLength(1);
      expect(s.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "stopped", crash: null, turns: 1 }]);
    }
  });

  it("takes one session to an id", async () => {
    for (const mode of MODES) {
      const s = seat(mode, [finish, finish, finish]);
      await examine(s.request);
      await expect(examine(s.request)).rejects.toThrow(
        `session ${s.request.id} is in the log already; a session's id names one session`,
      );
      expect(s.of(`${KIND[mode]}.started`)).toHaveLength(1);
    }
  });

  it("mounts and starts nothing for a run that was stopped before it began", async () => {
    for (const mode of MODES) {
      const s = seat(mode, [PUT[mode], finish]);
      const stopped = examine({ ...s.request, kill: AbortSignal.abort() }, WALL);
      await expect(stopped).rejects.toThrow(`session ${s.request.id} was stopped before it began`);
      expect(existsSync(s.log)).toBe(false);
      expect(existsSync(examinerDirs(s.log, s.request.id).root)).toBe(false);
      expect(s.sent).toEqual([]);
    }
  });

  it("is a crashed session when the provider fails its turn, with what the provider said", async () => {
    const limit = "You've hit your session limit";
    for (const mode of MODES) {
      const s = seat(mode, [failed(limit)]);
      expect(await examine(s.request)).toMatchObject({ ended: "crashed", puts: 0 });
      expect(s.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "crashed", crash: limit, note: null }]);
    }
  });

  it("ends at its turns, at its wall, and when the run is killed", async () => {
    for (const mode of MODES) {
      // A put that does not end the session: a draft with a fault, one task of many.
      const faulted = <T extends object>(request: T) => ({ ...request, reading: async () => ["a fault"] });
      const turned = seat(mode, [PUT[mode], finish]);
      const { limits } = turned.request;
      expect(await examine({ ...faulted(turned.request), limits: { ...limits, turns: 1 } })).toMatchObject({
        ended: "turns",
        puts: 1,
      });
      expect(turned.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "turns", turns: 1, crash: null }]);

      // A provider that answers after the wall: the session ends there, and is no crash. The faux
      // provider cannot be cut short, so the session ends when its late reply comes.
      const slow: FauxResponseStep = () => new Promise((settle) => setTimeout(() => settle(finish), 600));
      const walled = seat(mode, [slow, finish]);
      expect(await examine({ ...walled.request, limits: { ...limits, wallSeconds: 0.2 } })).toMatchObject({
        ended: "wall",
      });
      expect(walled.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "wall" }]);

      const kill = new AbortController();
      const killing: FauxResponseStep = () => {
        kill.abort();
        return fauxAssistantMessage("Thinking.");
      };
      const killed = seat(mode, [killing, finish]);
      expect(await examine({ ...killed.request, kill: kill.signal })).toMatchObject({ ended: "killed" });
      expect(killed.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "killed" }]);
    }
  });

  it("has a shell in a walled home of its own, closed to the repository, and is told how the exam is entered", async () => {
    const outside = join(REPO, "examined-outside.txt");
    for (const mode of MODES) {
      const s = seat(mode, [
        bash("echo noted > note.txt"),
        call("read", { path: "note.txt" }),
        // The hostile cases: the repository's own file, and a write beside it.
        bash(`cat ${join(REPO, "package.json")} >/dev/null 2>&1 && echo read || echo refused`),
        bash(`(echo x > ${outside}) 2>/dev/null && echo written || echo refused`),
        PUT[mode],
        finish,
        finish,
      ]);
      const examined = await examine(s.request, WALL);
      expect(examined.ended).toBe(mode === "write" ? "finished" : "stands");
      // The session's calls are in the log as the session's own, in order.
      const calls = s.of(`${KIND[mode]}.call`);
      expect(calls.slice(0, 4).map(({ tool, isError }) => [tool, isError])).toEqual(
        ["bash", "read", "bash", "bash"].map((tool) => [tool, false]),
      );
      expect(calls.slice(1, 4).map(({ text }) => text)).toEqual(["noted", "refused", "refused"]);
      expect(existsSync(outside)).toBe(false);
      // The host's folder of the capped root goes with the session.
      expect(existsSync(examinerDirs(s.log, s.request.id).host)).toBe(false);
      // It is told what the shell is, what its home holds, what the probe found of the network
      // and how the exam is entered; and nothing about what to do with it.
      const told = s.sent[0] ?? "";
      expect(told).toContain("but no repository or private data");
      expect(told).toMatch(/It has (no )?network access: a package index (was|could not be) reached/);
      expect(told).toContain(`Nothing in your home enters the exam: ${ENTERS[mode]}.`);
      expect(told).toContain("empty at its start");
      if (mode === "draft") expect(told).not.toMatch(/research/i);
    }
  });
});

describe("a session that drafts an exam", () => {
  it("is told the faults of what it put, mends it, and ends at the first that stands", async () => {
    const s = seat("draft", [PUT.draft, PUT.draft, finish]);
    let readings = 0;
    const reading = async () => {
      readings += 1;
      return readings === 1 ? ["the accept control of t-1 did not pass: fail check-product"] : [];
    };
    const examined = await examine({ ...s.request, reading });
    expect(examined).toEqual({ ended: "stands", puts: 2, held: [], refused: [] });
    expect(s.of("draft.call").map(({ text }) => text)).toEqual([
      "The draft does not stand. 1 fault:\n- the accept control of t-1 did not pass: fail check-product\nMend them and put the whole draft again. This session can put 3 more drafts.",
      "The draft stands: it is the campaign's exam. The session ends here.",
    ]);
    expect(s.of("draft.finished")).toMatchObject([{ ended: "stands", stands: true, tries: 2 }]);
    // Its start holds the mode's own facts beside its limits, under the log's own words.
    expect(s.of("draft.started")).toMatchObject([
      { limits: { wallSeconds: 600, turns: 12, tries: 4 }, prompt: "A fixture." },
    ]);
    // The draft that stands is in the log whole, and a campaign reads its exam from there.
    expect(draftOf(read(s.log))).toEqual(SOUND);
    expect(s.sent[0]).toContain("This session has 10 minutes, 12 turns and 4 drafts.");
  });

  it("puts no more than it has, and ends at finish with nothing standing", async () => {
    const s = seat("draft", [PUT.draft, PUT.draft, PUT.draft, finish]);
    const examined = await examine({
      ...s.request,
      limits: { ...s.request.limits, puts: 2 },
      reading: async () => ["a fault"],
    });
    expect(examined).toMatchObject({ ended: "finished", puts: 2 });
    const last = ({ text }: JsonObject) => (isString(text) ? text.split("\n").at(-1) : null);
    expect(s.of("draft.call").map((result) => [last(result), result.isError])).toEqual([
      ["Mend them and put the whole draft again. This session can put 1 more draft.", false],
      ["This session can put no further draft. Call finish.", false],
      ["This session can put no further draft. Call finish.", true],
      ["Finished.", false],
    ]);
    expect(s.of("draft.finished")).toMatchObject([{ stands: false, tries: 2, note: NOTE }]);
    expect(draftOf(read(s.log))).toBeNull();
    // A turn with no call is answered with what the session can still do.
    const idle = seat("draft", [fauxAssistantMessage("Thinking."), finish]);
    await examine(idle.request);
    expect(idle.sent[1]).toContain(
      "You have not called finish. Put a draft with draft_exam, or call finish.",
    );
  });
});

describe("a session that writes tasks", () => {
  it("is given the contract, the checks and the campaign's tasks, and nothing of a solver", async () => {
    const s = seat("write", [
      call("read_example", { task: "e-1" }),
      fauxAssistantMessage("Hm."),
      finish,
      finish,
    ]);
    await examine(s.request);
    const opening = s.sent[0] ?? "";
    for (const said of [
      "R1: The answer is the base times six.",
      "check-product (every family): The answer is six times the base.",
      // The pack's task is listed with its outcome, as every task of the campaign is.
      "- e-1 (family fixture): not yet compared",
      "This session has 10 minutes and 12 turns.",
      // Every session is asked for the same thing, with the need and no count, share or zone.
      "What the exam needs from every session is the same",
      "Harder is yours to judge from the domain",
      "the harness that gives more valid answers wins",
      "A task with no valid answer measures nothing",
      // The lever, plant-and-grow, where the planted answer goes, and that size alone is no growth.
      "several of the domain's requirements sharing one limit",
      "grow a planted task",
      "The planted answer is for try_answer alone",
      "Growing a task by size alone grows nothing",
      // It is told of its tools whether or not this session has them.
      "try_answer runs the checks on an instance with an answer of yours",
      "bash, read and write are yours in a home of your own",
      "propose_tasks takes instances",
    ]) {
      expect(opening).toContain(said);
    }
    for (const unsaid of [
      // The budget is told only where the campaign lends it; the contract declares no objective.
      "Every solve of a task is held to",
      "Objective:",
      "leave no room",
      "write_controls",
      "stronger solver",
      "said at its finish",
      "Counted from the same comparisons",
      // Without a verifier or a solver to try a task, it has neither tool.
      '{"name":"try_answer"',
      '{"name":"try_task"',
    ]) {
      expect(opening).not.toContain(unsaid);
    }
    // How many tasks are wanted is not the Examiner's to know: no prompt and no tool text says 24.
    expect(opening.replace(/"timestamp":\d+/g, "")).not.toContain("24");
    // A task is read whole, hidden values too, and a turn with no call is nudged.
    expect(s.sent[1]).toContain(String.raw`\"seed\": 5`);
    expect(s.sent[2]).toContain("You have not called finish. Propose further tasks, or call finish.");
    expect(s.of("exam.started")).toMatchObject([
      {
        session: "x-1",
        limits: { wallSeconds: 600, turns: 12, proposals: 4, tasks: 24 },
        checks: ["check-product", "check-unit"],
        examples: ["e-1"],
        engines: [],
      },
    ]);
    expect(s.of("exam.started")[0]?.tried).toBeUndefined();
    expect(s.of("exam.finished")).toMatchObject([{ proposed: 0, held: [], refused: [] }]);

    // The budget every solve is held to, as a fact and no target; and the next session opens with
    // what the last one said at its finish, in its own words.
    const next = seat("write", [finish, finish]);
    await examine({ ...next.request, id: "x-2", log: s.log, budget: { modelTurns: 3, minutes: 8 } });
    expect(next.sent[0]).toContain(
      "Every solve of a task is held to 3 turns of the solver's own, a turn being one reply with the tool calls in it, and 8 minutes. This is the budget",
    );
    expect(next.sent[0]).toContain("it is no target of yours");
    expect(next.sent[0]).toContain(String.raw`said at its finish, in its own words:\n${NOTE}`);
  });

  it("holds an instance out on the shape of its package, says why another is refused, and logs each whole", async () => {
    const s = seat("write", [propose(7, null, 7), finish, finish]);
    const examined = await examine(s.request);
    const told = s.sent[1] ?? "";
    expect(told).toContain("x-1-001: held out.");
    expect(told).toContain("x-1-002: refused: no inputs");
    expect(told).toContain("An instance proposed before was not taken again.");
    const held = s.versionOf("x-1-001", 7);
    const refused = taskVersion(
      s.request.pack({ taskId: "x-1-002", family: "fixture", publicInput: null, hidden: { seed: 1 } }),
    );
    expect(examined).toEqual({ ended: "finished", puts: 2, held: [held], refused: [refused] });
    // One gate, and the task is a held-out task from then on: no solve, no control, no word.
    expect(s.of("task.gate")).toEqual([
      { version: held, gate: 1, outcome: "passed", proved: false },
      { version: refused, gate: 1, outcome: "refused", reason: "no inputs", proved: false },
    ]);
    expect(taskSets(read(s.log))).toMatchObject({ held: [held], released: [] });
    expect(taskStates(read(s.log)).get(refused)).toBe("refused");
    expect(s.of("solve.started")).toEqual([]);
    // The instance is in the log whole, so a later solve of it needs nothing else.
    expect(s.of("task.proposed")[0]).toMatchObject({
      version: held,
      taskId: "x-1-001",
      session: "x-1",
      task: { family: "fixture", publicInput: { base: 7 }, hidden: { seed: 1 } },
    });
    expect(writtenTasks(read(s.log)).map(({ taskId }) => taskId)).toEqual(["x-1-001", "x-1-002"]);
    expect(s.of("exam.finished")).toMatchObject([{ proposed: 2, held: [held], refused: [refused] }]);
  });

  it("takes no instance past its puts, nor one an earlier session wrote, and keeps what it held when its turn fails", async () => {
    const spent = seat("write", [propose(1, 2, 3), propose(4, 5), propose(6), finish, finish]);
    await examine(spent.request);
    expect(spent.sent[2]).toContain("An instance was not taken: this session can propose no further task.");
    expect(spent.sent[3]).toContain("This session can propose no further task. Call finish.");
    expect(spent.of("task.proposed")).toHaveLength(4);
    // A second session is a new process, and the same instance under a new id is the same task.
    const again = seat("write", [propose(7), failed("overloaded"), propose(7, 8), finish, finish]);
    expect(await examine(again.request)).toMatchObject({
      ended: "crashed",
      held: [again.versionOf("x-1-001", 7)],
    });
    const second = await examine({ ...again.request, id: "x-2" });
    expect(again.sent[3]).toContain("An instance an earlier session wrote was not taken again.");
    expect(second.held).toEqual([again.versionOf("x-2-001", 8)]);
  });

  it("takes again an instance a cut session proposed and never gated", async () => {
    const cut = seat("write", [propose(7), finish, finish]);
    // A session cut while its task was measured: the proposal is on record, and no gate is.
    append(cut.log, "task.proposed", {
      version: cut.versionOf("x-1-001", 7),
      taskId: "x-1-001",
      session: "x-1",
      task: { taskId: "x-1-001", family: "fixture", publicInput: { base: 7 }, hidden: { seed: 1 } },
    });
    // Until 13 October the next session was told an earlier one wrote it, and it was never gated.
    const next = await examine({ ...cut.request, id: "x-2" });
    expect(next.held).toEqual([cut.versionOf("x-2-001", 7)]);
    expect(cut.sent.join("\n")).not.toContain("An instance an earlier session wrote");
  });

  it("takes again an instance whose gate measured fewer than three solves, and not one its gate read whole", async () => {
    const cut = seat("write", [propose(7, 8), finish, finish]);
    const gate = (taskId: string, base: number, solves: number) => {
      const version = cut.versionOf(taskId, base);
      append(cut.log, "task.proposed", {
        version,
        taskId,
        session: "x-1",
        task: { taskId, family: "fixture", publicInput: { base }, hidden: { seed: 1 } },
      });
      append(cut.log, "task.gate", {
        version,
        gate: 1,
        outcome: "refused",
        reason: "not measured",
        reference: { valid: 0, solves, billed: 0.5 },
        proved: false,
      });
    };
    // One a wall cut after one of its three solves, and one all three solves read and refused.
    gate("x-1-001", 7, 1);
    gate("x-1-002", 8, 3);
    const next = await examine({ ...cut.request, id: "x-2" });
    expect(next.held).toEqual([cut.versionOf("x-2-001", 7)]);
    expect(cut.of(CALLED)[0]?.text).toContain("An instance an earlier session wrote was not taken again.");
  });

  // On the six logs read on 14 October two of eleven Examiner sessions were cut at their wall while
  // still proposing, one in a command; the session's limits were told at its opening alone.
  it("ends each turn's last tool result with the turn it is in and the minutes it has used", async () => {
    const example = () => fauxToolCall("read_example", { task: "e-1" });
    const s = seat("write", [
      fauxAssistantMessage([example(), example()], TOOL_USE),
      call("read_example", { task: "e-1" }),
      finish,
      finish,
    ]);
    await examine(s.request);
    const texts = read(s.log)
      .filter(({ kind }) => kind === CALLED)
      .map(({ data }) => (isString(data.text) ? data.text : ""));
    expect(texts.map((text) => text.match(USED)?.[0] ?? null)).toEqual([
      null,
      "\nTurn 1 of 12; 0 of 10 minutes used.",
      "\nTurn 2 of 12; 0 of 10 minutes used.",
      null,
      null,
    ]);
  });

  it("ends when the host has its tasks, and declines a first finish once while it has not", async () => {
    const both = fauxAssistantMessage(
      [
        fauxToolCall("propose_tasks", { tasks: [instance(2), instance(3)] }),
        fauxToolCall("propose_tasks", { tasks: [instance(11)] }),
      ],
      TOOL_USE,
    );
    const s = seat("write", [both, propose(13), finish]);
    const examined = await examine({ ...s.request, wanted: 2 });
    expect(examined).toMatchObject({ ended: "supplied", puts: 2 });
    expect(examined.held).toHaveLength(2);
    // The second call of the turn was told that the host has what it needs, and no turn followed.
    expect(JSON.stringify(s.of(CALLED).at(-1))).toContain("The host has the tasks it needs");
    expect(s.of("exam.turn")).toHaveLength(1);

    // Every live session of 9 and 10 October proposed one batch of one to three tasks in three
    // turns and finished, of twelve tasks and two hundred turns it had.
    const short = seat("write", [propose(1), finish, propose(2), finish]);
    expect(await examine(short.request)).toMatchObject({ ended: "finished", puts: 2 });
    expect(short.of(CALLED)[1]?.text).toBe(
      "Noted, and the session goes on: the host does not yet have the tasks it needs from it. Propose further tasks, varying what they ask, and call finish again when you have none left worth proposing.",
    );
    expect(short.of("exam.turn")).toHaveLength(4);
  });

  it("runs the checks on an instance with an answer of its own, and keeps of a pass only that the instance has a valid answer", async () => {
    // A hidden value sent as JSON text is read as the JSON it encodes, in a try and in a proposal:
    // on 12 October tries sent "null" where their proposals sent null, and no mark was kept.
    const s = seat("write", [
      tried(7),
      tried(8, { answer: "1", unit: "N" }),
      tried(9, GOOD, '{"seed": 1}'),
      tried(10),
      call("propose_tasks", {
        tasks: [...[7, 8, 9].map(instance), { ...instance(10), hidden: '{"seed": 1}' }],
      }),
      finish,
      finish,
    ]);
    const asked: unknown[] = [];
    await examine({
      ...s.request,
      verify: (task, answer) => {
        asked.push([task.taskId, task.hidden]);
        return verify(task, answer);
      },
    });
    expect(s.sent[0]).toContain('{"name":"try_answer"');
    // Four tries under the id `try`, and each of the three that passed again under its task's id.
    expect(asked).toEqual(
      ["try", "try", "try", "try", "x-1-001", "x-1-003", "x-1-004"].map((id) => [id, { seed: 1 }]),
    );
    expect(
      s
        .of(CALLED)
        .slice(0, 2)
        .map(({ text }) => text),
    ).toEqual([
      "Every applicable check passed this answer: the instance has a valid answer.",
      "Refused by check-product.",
    ]);
    const proved = [s.versionOf("x-1-001", 7), s.versionOf("x-1-003", 9), s.versionOf("x-1-004", 10)];
    expect(s.of("task.feasible")).toEqual(proved.map((version) => ({ version, session: "x-1" })));
    // No answer enters the log but in the session's own trace.
    expect(JSON.stringify(s.of("task.feasible"))).not.toContain('"answer":"42"');
    expect(heard(read(s.log), writtenTasks(read(s.log))).lines[0]).toBe(
      "x-1-001 (family fixture): not yet compared; a valid answer to it is on record",
    );
  });

  /** One order of tries and proposals, the verifier's answers by the id it is asked under, and
   *  what the log then holds as proved. `e-1` names the pack's task, held out before the session
   *  where `state` is given; `x-1-001` the session's first. */
  const ORDERS: readonly {
    readonly name: string;
    readonly steps: readonly FauxResponseStep[];
    readonly under?: (taskId: string) => Verdict | Error;
    readonly state?: "held" | "released" | "disputed" | "refused";
    readonly checked: readonly string[];
    readonly proved: readonly ("e-1" | "x-1-001")[];
    readonly said?: string;
  }[] = [
    {
      name: "a try, then its task: the answer is checked again under the task's id, and a refusal there keeps no proof",
      steps: [tried(7), propose(7)],
      under: (taskId) =>
        taskId === "try" ? { kind: "pass" } : { kind: "fail", blocking: ["check-product"] },
      checked: ["try", "x-1-001"],
      proved: [],
      said: "x-1-001: held out. Author proof was not retained under this task id: Refused by check-product.",
    },
    {
      name: "a check that could not decide under the task's id is said, and is no failure of the session",
      steps: [tried(7), propose(7)],
      under: (taskId) =>
        taskId === "try"
          ? { kind: "pass" }
          : { kind: "faulty", check: "check-product", reason: "engine unavailable" },
      checked: ["try", "x-1-001"],
      proved: [],
      said: "x-1-001: held out. Author proof was not retained under this task id: Check check-product could not decide: engine unavailable",
    },
    {
      name: "a recheck that throws leaves the proposal and its gate in the log",
      steps: [tried(7), propose(7)],
      under: (taskId) => (taskId === "try" ? { kind: "pass" } : new Error("engine interrupted")),
      checked: ["try", "x-1-001"],
      proved: [],
      said: "x-1-001: held out. Author proof was not retained under this task id: The checks could not run: engine interrupted",
    },
    {
      name: "a task, then a try of it twice: proved once",
      steps: [propose(7), tried(7), tried(7)],
      checked: ["x-1-001", "x-1-001"],
      proved: ["x-1-001"],
    },
    {
      name: "a task the gate refuses is not checked again, and not proved",
      steps: [tried(null), propose(null)],
      checked: ["try"],
      proved: [],
    },
    {
      name: "an answer the format refuses is held to it before any check, and proves nothing",
      steps: [tried(7, { answer: 42 }), propose(7)],
      checked: [],
      proved: [],
    },
    {
      name: "a pack's task not yet prepared: a try proves nothing",
      steps: [triedExample],
      checked: ["e-1"],
      proved: [],
    },
    ...(["held", "released", "disputed"] as const).map((state) => ({
      name: `a pack's task, ${state}: a try is checked under the task's own id and proves it`,
      steps: [triedExample, propose(7), tried(7, { answer: "1", unit: "N" }), tried(7, GOOD, { seed: 2 })],
      state,
      checked: ["e-1", "x-1-001", "try"],
      proved: ["e-1"] as const,
    })),
    {
      name: "a pack's task the operator refused: no proof",
      steps: [triedExample],
      state: "refused",
      checked: ["e-1"],
      proved: [],
    },
    {
      name: "a pack's task refused under its own id: no proof",
      steps: [triedExample],
      under: (taskId) =>
        taskId === "try" ? { kind: "pass" } : { kind: "fail", blocking: ["check-product"] },
      state: "held",
      checked: ["e-1"],
      proved: [],
    },
  ];

  for (const order of ORDERS) {
    it(`proves a task by its author's answer in any order: ${order.name}`, async () => {
      const s = seat("write", [...order.steps, finish, finish]);
      const packed = taskVersion(s.request.pack(EXAMPLE));
      if (order.state !== undefined) {
        // The pack's own task is in the log as `prepare.ts` leaves it: by its id, and held out.
        append(s.log, "task.proposed", { version: packed, taskId: EXAMPLE.taskId });
        append(s.log, "task.gate", { version: packed, gate: 1, outcome: "passed" });
        if (order.state !== "held") append(s.log, "task.state", { version: packed, state: order.state });
      }
      const checked: string[] = [];
      const examined = await examine({
        ...s.request,
        verify: async (task, answer) => {
          // The format's refusal comes first, so a check is asked only of an answer it allows.
          checked.push(task.taskId);
          if (asRecord(answer)?.answer === "1") return { kind: "fail", blocking: ["check-product"] };
          const verdict = order.under?.(task.taskId) ?? { kind: "pass" };
          if (!(verdict instanceof Error)) return verdict;
          // The task was held out before its author's answer was put to the checks again.
          expect(taskSets(read(s.log)).held).toContain(s.versionOf(task.taskId, 7));
          throw verdict;
        },
      });
      expect(examined.ended).toBe("finished");
      expect(checked).toEqual([...order.checked]);
      const versions = { "e-1": packed, "x-1-001": s.versionOf("x-1-001", 7) };
      const proved = order.proved.map((id) => ({ version: versions[id], session: "x-1" }));
      expect(s.of("task.feasible")).toEqual(proved);
      expect(poolOf(read(s.log)).feasible).toEqual(new Set(proved.map(({ version }) => version)));
      const texts = s.of(CALLED).map(({ text }) => text);
      if (order.said !== undefined) expect(texts.filter(isString).join("\n")).toContain(order.said);
      if (order.checked.length === 0) {
        expect(texts[0]).toStartWith(
          "This answer does not follow the answer format, so a solver's answer like it is refused before any check reads it, and no check was run: ",
        );
      }
    });
  }

  it("refuses a task that carries a planted answer whole, in its public input or its hidden values", async () => {
    // A second answer that passes on the same instance leaves the first planted: every answer
    // that passed is one, not the last an instance.
    const planted = { answer: "42", unit: "N" };
    const s = seat("write", [
      tried(2),
      tried(2, { answer: "42.0", unit: "N" }),
      call("propose_tasks", {
        tasks: [
          { family: "fixture", public_input: { base: 2 }, hidden: { seed: 1, witness: planted } },
          { family: "fixture", public_input: { base: 3, given: [planted] }, hidden: { seed: 1 } },
          instance(2),
        ],
      }),
      finish,
      finish,
    ]);
    // The share the Examiner is told is the campaign's: an earlier session's drafts, one with its
    // author's proof and held out and one without and refused, and a gate that names no proof, as
    // a pack's task's does, which is no draft's.
    for (const [version, gate] of [
      ["v-earlier-1", { outcome: "passed", proved: true }],
      ["v-earlier-2", { outcome: "refused", reason: "no inputs", proved: false }],
      ["v-pack", { outcome: "passed" }],
    ] as const) {
      append(s.log, "task.proposed", { version, taskId: version });
      append(s.log, "task.gate", { version, gate: 1, ...gate });
    }
    const examined = await examine({ ...s.request, verify });
    const refused =
      "refused: it carries, whole, an answer that passed try_answer in this session: a planted answer is for try_answer alone, and no task holds one, in its public input or its hidden values";
    expect(s.of(CALLED)[2]?.text).toBe(
      [
        `x-1-001: ${refused}`,
        `x-1-002: ${refused}`,
        "x-1-003: held out.",
        "So far in this campaign, drafts with a proof were held 2 of 2, and drafts without one 0 of 3.",
      ].join("\n"),
    );
    expect(examined.held).toEqual([s.versionOf("x-1-003", 2)]);
  });

  it("holds out a task the reference harness answered in none of its solves where its author's answer passes on it, the first of every three for the ladder", async () => {
    // Bases 4, 8, 9, 7 and 10 are answered in none of three solves; 7 alone has no author's answer,
    // and 5, answered in every solve, has one. Until 15 October every proved one went to the ladder.
    const s = seat("write", [
      tried(4),
      tried(8),
      tried(9),
      tried(5),
      tried(10),
      call("try_task", { tasks: [4, 8, 9, 7, 5, 10].map(instance) }),
      finish,
      finish,
    ]);
    const probe = async (task: TaskPackage) =>
      Number(asRecord(task.publicInput)?.base) === 5 ? PASS : REJECTED;
    const examined = await examine({ ...s.request, verify, limits: { ...s.request.limits, puts: 6 }, probe });
    const versionAt = (nth: number, base: number) => s.versionOf(`x-1-00${String(nth)}`, base);
    const [first, second, third, unwitnessed, solved, fourth] = [
      versionAt(1, 4),
      versionAt(2, 8),
      versionAt(3, 9),
      versionAt(4, 7),
      versionAt(5, 5),
      versionAt(6, 10),
    ];
    // The first proved draft the reference never answered is the ladder's, the next two are held
    // out, and the fourth is the ladder's again: a count over the log's gates, so the ladder has a
    // task once any such draft does. One without a proof, and one answered every time, are refused.
    expect(examined).toMatchObject({ held: [second, third], refused: [unwitnessed, solved] });
    const sets = taskSets(read(s.log));
    expect(sets.ladder).toEqual([first, fourth]);
    expect(sets.held).toEqual([second, third]);
    const gates = s.of("task.gate");
    expect(gates.map(({ outcome }) => outcome)).toEqual([
      "ladder",
      "passed",
      "passed",
      "refused",
      "refused",
      "ladder",
    ]);
    expect(gates.map(({ reference }) => asRecord(reference)?.valid)).toEqual([0, 0, 0, 0, 3, 0]);
    // Each proved one is on record as feasible, by the author's answer checked under its own id.
    expect(s.of("task.feasible")).toEqual(
      [first, second, third, fourth].map((version) => ({ version, session: "x-1" })),
    );
    expect(poolOf(read(s.log)).scorable).toEqual([second, third]);
    // The Examiner hears the count of a held task's valid solves, as of any other, and of the
    // ladder's only that it was held; the refusals say the rule.
    expect(s.of(CALLED)[5]?.text).toBe(
      [
        "x-1-001: held for the ladder. This task will never be scored for promotion or released for practice.",
        "x-1-002: held out; the reference harness answered it validly in 0 of 3 solves.",
        "x-1-003: held out; the reference harness answered it validly in 0 of 3 solves.",
        "x-1-004: refused: the reference harness answered it validly in 0 of 3 solves, and a task is held out only where it answers some and not all, or none where an answer of its author's passes on it",
        "x-1-005: refused: the reference harness answered it validly in 3 of 3 solves, and a task is held out only where it answers some and not all, or none where an answer of its author's passes on it",
        "x-1-006: held for the ladder. This task will never be scored for promotion or released for practice.",
        "So far in this campaign, drafts with a proof were held 2 of 5, and drafts without one 0 of 1.",
      ].join("\n"),
    );
  });

  it("starts no solve of a draft where the campaign's budget holds no reserve for all three", async () => {
    const s = seat("write", [call("try_task", { tasks: [instance(2)] }), finish, finish]);
    // Two reserves of $0.5 are left: until 14 October the three solves started all the same.
    append(s.log, "campaign.opened", { budget: { dollars: 1, reserve: 0.5 } });
    let asked = 0;
    const probe = async () => {
      asked += 1;
      return PASS;
    };
    const examined = await examine({ ...s.request, limits: { ...s.request.limits, puts: 1 }, probe });
    expect(asked).toBe(0);
    expect(examined.refused).toEqual([s.versionOf("x-1-001", 2)]);
    expect(s.of(CALLED)[0]?.text).toStartWith(
      "x-1-001: refused: the campaign's budget holds no reserve for the reference harness's three solves of it",
    );
  });

  it("holds a task out by try_task at some valid solves of the reference harness and not all, and tells the counts alone", async () => {
    // Each base's three solves by the reference harness, seeded: valid in one, two, none and all of
    // them; one whose third ends in no reading while the two read already hold a pass and a fail, and
    // one whose two read are both valid, which the third could not leave room or not. A solver's flag
    // that the task is malformed is a solve that answered nothing validly, as in every tally.
    const seeded = new Map<number, readonly Ending[]>([
      [2, [PASS, REJECTED, REJECTED]],
      [3, [PASS, PASS, REJECTED]],
      [4, [REJECTED, REJECTED, REJECTED]],
      [5, [PASS, PASS, PASS]],
      [
        6,
        [
          PASS,
          { outcome: "flagged", reason: "the base is given twice" },
          { outcome: "non-result", kind: "provider", reason: "overloaded" },
        ],
      ],
      [7, [PASS, PASS, { outcome: "non-result", kind: "provider", reason: "overloaded" }]],
    ]);
    const s = seat("write", [call("try_task", { tasks: [2, 3, 4, 5, 6, 7].map(instance) }), finish, finish]);
    const asked: string[] = [];
    // The launcher's record of each solve, as a comparison's solve writes it, with the answer the
    // Examiner must never be shown, and its price.
    const probe = async (task: TaskPackage, session: string) => {
      const base = Number(asRecord(task.publicInput)?.base);
      const ending = seeded.get(base)?.[asked.filter((each) => each === `${session} ${String(base)}`).length];
      asked.push(`${session} ${String(base)}`);
      if (ending === undefined) throw new Error(`no fourth solve of base ${String(base)} is seeded`);
      const solve = `s-${String(asked.length)}`;
      const ran = condition(taskVersion(task), "h-reference");
      append(s.log, "condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
      append(s.log, "solve.started", { solve, condition: conditionId(ran), comparison: session });
      append(s.log, "verdict", { solve, answer: { answer: SOLVER, unit: "N" } });
      append(s.log, "solve.finished", { solve, ending, billed: 0.5 });
      return ending;
    };
    const examined = await examine({ ...s.request, limits: { ...s.request.limits, puts: 6 }, probe });
    const versions = [2, 3, 4, 5, 6, 7].map((base, nth) => s.versionOf(`x-1-00${String(nth + 1)}`, base));
    const held = versions.filter((_version, nth) => [0, 1, 4].includes(nth));
    expect(examined).toMatchObject({
      ended: "finished",
      held,
      refused: versions.filter((_version, nth) => ![0, 1, 4].includes(nth)),
    });
    expect(taskSets(read(s.log)).held).toEqual(held);
    const counted = (valid: number) =>
      `the reference harness answered it validly in ${String(valid)} of 3 solves`;
    expect(s.of(CALLED)[0]?.text).toBe(
      [
        `x-1-001: held out; ${counted(1)}.`,
        `x-1-002: held out; ${counted(2)}.`,
        `x-1-003: refused: ${counted(0)}, and a task is held out only where it answers some and not all, or none where an answer of its author's passes on it`,
        `x-1-004: refused: ${counted(3)}, and a task is held out only where it answers some and not all, or none where an answer of its author's passes on it`,
        `x-1-005: held out; ${counted(1)}, 1 of them ending in no reading or in a rejection the Referee did not rule earned.`,
        `x-1-006: refused: ${counted(2)}, 1 of them ending in no reading or in a rejection the Referee did not rule earned, so it is not measured`,
        "So far in this campaign, drafts with a proof were held 0 of 0, and drafts without one 3 of 6.",
      ].join("\n"),
    );
    // Its cost a task, on the gate's event; the solves are the session's, named by it, and no
    // comparison's: a comparison counts the solves whose start names it (`pairsOf`).
    expect(s.of("task.gate").map(({ reference }) => reference)).toEqual(
      [1, 2, 0, 3, 1, 2].map((valid, nth) => ({ valid, solves: nth >= 4 ? 2 : 3, billed: 1.5 })),
    );
    expect(solvesIn(read(s.log)).map(({ start }) => start.comparison)).toEqual(Array(18).fill("x-1"));
    expect(billedParts(read(s.log), "x-1")).toEqual({ session: 0, comparison: 9 });
    // None is part of a task's answers or a tally; a valid one is a witness, so its task is
    // feasible and nothing more.
    expect(ranUnder(read(s.log))).toEqual([]);
    expect(poolOf(read(s.log)).feasible).toEqual(new Set(versions.filter((_version, nth) => nth !== 2)));
    expect(s.of("exam.started")).toMatchObject([{ tried: 3 }]);
    expect(s.sent[0]).toContain("try_task takes instances");
    expect(s.sent[0]).not.toContain("propose_tasks");
    // Plan item 5.1: the gate is explained once, in the system prompt's section the tool points to,
    // and the ladder there as the tool's result says it; the objective's rule is said once.
    const once = (part: string) => (s.sent[0] ?? "").split(part).length - 1;
    expect(once("## The gate")).toBe(1);
    expect(
      once(
        "held out where some of those solves gave a valid answer and not all, or where none did and an answer of yours passed try_answer on the same instance",
      ),
    ).toBe(1);
    expect(once("the first of every three in the campaign is held for the ladder instead")).toBe(1);
    expect(once("as the system prompt's section on the gate says")).toBe(1);
    expect(
      once("held for the ladder instead: a fixed set apart from the exam, never scored for a promotion"),
    ).toBe(1);
    expect(once("declares an objective")).toBe(1);
    expect(once("Without an objective")).toBe(0);
    expect(s.sent.join("\n")).not.toContain(SOLVER);
  });

  it("ends at its wall with no solve of the reference harness left running, and starts none after it", async () => {
    const s = seat("write", [call("try_task", { tasks: [instance(2), instance(3)] }), finish, finish]);
    const running = new Set<string>();
    // Each solve would pass long after the wall, unless the kill a comparison's solves take
    // stops it first; the launcher records its end either way.
    const probe = (task: TaskPackage, session: string, kill: AbortSignal) =>
      new Promise<Ending>((settle) => {
        const solve = `w-${String(s.of("solve.started").length + 1)}`;
        running.add(solve);
        append(s.log, "solve.started", { solve, task: task.taskId, comparison: session });
        const end = (ending: Ending) => {
          if (!running.delete(solve)) return;
          clearTimeout(late);
          append(s.log, "solve.finished", { solve, ending });
          settle(ending);
        };
        const late = setTimeout(() => end(PASS), 5_000);
        kill.addEventListener("abort", () => end({ outcome: "non-result", kind: "killed", reason: "wall" }));
      });
    const started = performance.now();
    const examined = await examine({
      ...s.request,
      limits: { ...s.request.limits, wallSeconds: 0.5 },
      probe,
    });
    expect(examined.ended).toBe("wall");
    expect(performance.now() - started).toBeLessThan(4_000);
    expect(running.size).toBe(0);
    expect(s.of("solve.finished").map(({ ending }) => asRecord(ending)?.kind)).toEqual([
      "killed",
      "killed",
      "killed",
    ]);
    expect(s.of("task.gate")).toMatchObject([{ outcome: "refused", reference: { valid: 0, solves: 0 } }]);
    // The batch's second instance came after the wall: never proposed, so a later session takes it.
    expect(s.of("task.proposed")).toHaveLength(1);
  });

  it("runs in its shell the engine a check names, from where it lies, and no other program of its tree", async () => {
    let pack = "";
    const s = seat("write", [
      bash("fixeng"),
      bash("command -v solver-x || echo absent"),
      // The tree the engine runs from is open again for reading, and the pack around it is not.
      () => bash(`cat ${join(pack, "hidden.json")} 2>/dev/null || echo refused`),
      bash(`(echo x > "$(command -v fixeng)") 2>/dev/null && echo written || echo refused`),
      finish,
      finish,
    ]);
    // A stored pack the wall closes: a check program that names one engine, a tool tree that holds
    // it, its data beside it and a solver a v1 Builder left there, and the pack's hidden values.
    pack = join(dirname(s.log), "pack");
    const tools = join(pack, ".toolchain");
    mkdirSync(join(pack, "checks"), { recursive: true });
    const brief = JSON.parse(readFileSync(join(s.program, "brief.json"), "utf8"));
    brief.truthChecks[0].execution.requiredToolIds = ["fixeng"];
    writeFileSync(join(pack, "checks", "brief.json"), JSON.stringify(brief));
    mkdirSync(join(tools, "bin"), { recursive: true });
    mkdirSync(join(tools, "share"), { recursive: true });
    writeFileSync(join(tools, "share", "fixeng.dat"), "engine data\n");
    // The engine finds its data beside where it was started from, as buffer's `phreeqc` does.
    writeFileSync(join(tools, "bin", "fixeng"), '#!/bin/sh\ncat "$(dirname "$0")/../share/fixeng.dat"\n', {
      mode: 0o755,
    });
    writeFileSync(join(tools, "bin", "solver-x"), "#!/bin/sh\necho solved\n", { mode: 0o755 });
    writeFileSync(join(pack, "hidden.json"), `{"secret": "${SOLVER}"}\n`);
    await examine(s.request, {
      ...WALL,
      packRoots: [pack],
      engines: { checks: join(pack, "checks"), tools },
    });
    // The engine ran by name and read its own data; the solver beside it is on no path; the
    // pack's other files stay closed; and the program that starts the engine is the host's.
    expect(
      s
        .of(CALLED)
        .slice(0, 4)
        .map(({ text }) => text),
    ).toEqual(["engine data", "absent", "refused", "refused"]);
    // The session's start names the engine by its digest, as the host pinned it.
    expect(s.of("exam.started")).toMatchObject([
      { engines: [{ name: "fixeng", sha256: sha256OfFile(join(tools, "bin", "fixeng")) }] },
    ]);
    expect(s.sent[0]).toContain(
      "The engines the exam's checks run are installed, and run by name: fixeng. They compute; try_answer alone runs the checks on an answer.",
    );
    expect(s.sent[0]).not.toContain("solver-x");
  });

  it("carries the home of a session that ended into the next, whole, and of one whose model request the provider failed, named", async () => {
    const s = seat("write", [
      bash("echo half > half.txt"),
      failed("overloaded"),
      bash("ls; rm stale.txt; echo whole > whole.txt"),
      finish,
      finish,
    ]);
    const keep = join(dirname(s.log), "examiner-home");
    mkdirSync(keep);
    writeFileSync(join(keep, "kept.txt"), "kept\n");
    writeFileSync(join(keep, "stale.txt"), "old\n");
    const wall = { ...WALL, keep };
    expect((await examine(s.request, wall)).ended).toBe("crashed");
    // No command ran as the provider failed the turn: the home is as its last command left it.
    expect(s.of("exam.finished")).toMatchObject([{ ended: "crashed", running: 0 }]);
    expect(readdirSync(keep).sort()).toEqual(["half.txt", "kept.txt", "stale.txt"]);
    expect((await examine({ ...s.request, id: "x-2" }, wall)).ended).toBe("finished");
    // The next session found what was kept, and was told whose it is; its home replaced the kept
    // copy, and what it deleted stays deleted.
    expect(s.of(CALLED)[1]?.text).toBe("half.txt\nkept.txt\nstale.txt");
    expect(readdirSync(keep).sort()).toEqual(["half.txt", "kept.txt", "whole.txt"]);
    expect(s.sent[0]).toContain(
      "holds what the last Examiner session of this campaign left in it, or nothing at the campaign's first",
    );
    // The first session's two requests, then the second session's first.
    expect(s.sent[2]).toContain(
      `holds what Examiner session ${s.request.id} of this campaign left in it when the provider failed one of its turns, before it finished`,
    );
  });
});

describe("what an Examiner hears of the tasks its campaign holds", () => {
  /** A log built by hand: tasks held out by id, solves of them under a harness, and reports. */
  function logged() {
    const events: LogEvent[] = [];
    const add = (kind: EventKind, data: JsonObject) =>
      events.push({ at: "2026-10-11T00:00:00.000Z", kind, data });
    let solves = 0;
    return {
      events,
      add,
      hold: (...ids: string[]) => {
        for (const taskId of ids) {
          add("task.proposed", { version: `v-${taskId}`, taskId });
          add("task.gate", { version: `v-${taskId}`, gate: 1, outcome: "passed" });
        }
      },
      /** A solve each of `valid` under `harness`, null for one its wall cut; each took the turns
       *  given, and 11 where none is. */
      solved: (
        comparison: string,
        taskId: string,
        harness: string,
        valid: readonly (boolean | null)[],
        turns: readonly number[] = [],
      ) => {
        const ran = condition(`v-${taskId}`, harness);
        add("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
        for (const [nth, pass] of valid.entries()) {
          solves += 1;
          const solve = `t-${String(solves)}`;
          add("solve.started", { solve, condition: conditionId(ran), comparison });
          if (pass !== null) {
            add("verdict", { solve, kind: pass ? "pass" : "fail", answer: { answer: SOLVER } });
          }
          add("solve.finished", {
            solve,
            ending: pass === null ? WALLED : pass ? PASS : REJECTED,
            turns: turns[nth] ?? 11,
          });
        }
      },
      reported: (
        session: string,
        [old, fresh]: readonly [string, string],
        side: number,
        ids: readonly string[],
        aside: readonly string[] = [],
      ) =>
        add("comparison.reported", {
          session,
          reading: "no-step",
          old,
          fresh,
          starter: "h1",
          solves: side,
          setting: settingId(condition("any", "any")),
          versions: ids.map((id) => `v-${id}`),
          aside: aside.map((id) => `v-${id}`),
        }),
    };
  }
  const fixture = (taskId: string) => ({ taskId, family: "fixture" });
  const line = (taskId: string, said: string) => `${taskId} (family fixture): ${said}`;
  const VALID = "a valid answer to it is on record";
  const NONE = "no valid answer to it is on record";

  it("is one outcome a task on the reference's side, with whether a valid answer is on record, and the counts beside them", async () => {
    const log = logged();
    const tasks = ["some", "none", "every", "unsolved", "practice", "aside", "new", "faulted", "refused"].map(
      fixture,
    );
    log.hold(...tasks.map(({ taskId }) => taskId));
    log.solved("b-1", "some", "h1", [true, false]);
    log.solved("b-1", "some", "h2", [true, true]);
    log.solved("b-1", "none", "h1", [false, false]);
    log.solved("b-1", "none", "h2", [true, true]);
    for (const harness of ["h1", "h2"]) {
      log.solved("b-1", "every", harness, [true, true]);
      log.solved("b-1", "unsolved", harness, [false, false]);
    }
    log.reported("b-1", ["h1", "h2"], 2, ["some", "none", "every", "unsolved"], ["aside"]);
    log.add("task.state", { version: "v-practice", state: "released" });
    log.add("task.state", { version: "v-faulted", state: "disputed" });
    log.add("task.state", { version: "v-refused", state: "refused" });
    const { lines, counts } = heard(log.events, tasks);
    // The reference harness is h1, the comparison's old side: the author hears how it did on each
    // task and nothing of h2. A refused task is no task of the exam, and has no line.
    expect(lines).toEqual([
      line(
        "some",
        `the reference harness answered it validly in some solves of the last comparison and not in others; ${VALID}`,
      ),
      line("none", `the reference harness answered it validly in no solve of the last comparison; ${VALID}`),
      line(
        "every",
        `the reference harness answered it validly in every solve of the last comparison; ${VALID}`,
      ),
      line(
        "unsolved",
        `the reference harness answered it validly in no solve of the last comparison; ${NONE}`,
      ),
      line("practice", "in use as practice, and so never scored"),
      line("aside", `disputed: a rejection of an answer to it is not settled; ${NONE}`),
      line("new", `not yet compared; ${NONE}`),
      line("faulted", "disputed: a check was at fault on an answer to it"),
    ]);
    // From the same pass: the five lines read on the reference's side, counted. The tie both
    // harnesses answered in every solve and the one neither answered in any are counted apart;
    // which side won is told in the count alone, and the practice task is in none.
    expect(counts).toBe(
      [
        "Counted from the same comparisons as the lines above, by family where every family counted holds two tasks or more and otherwise in a total alone: each task whose last comparison had the reference harness on one side, or that a later report set aside, and no other. The other harness is whichever the reference harness was compared with there. These are measurements and no target.",
        "- family fixture, 5 tasks: 2 told apart, won by the other harness 2 and by the reference harness 0; 1 tied with both harnesses valid in every solve; 1 tied with neither valid in any solve, of which 0 with a valid answer on record; 0 tied otherwise; 1 set aside on a rejection not settled.",
        "Each count rests on 2 solves a side of the task's last comparison. The same harness fails a task once and passes it the next time, so a count over a few tasks, and more so one family's share of them, is weak evidence.",
      ].join("\n"),
    );
    // A session's opening carries the lines and then the counts, and names no harness, no solver's
    // answer and no verdict of the author's work.
    const s = seat("write", [finish, finish]);
    for (const event of log.events) append(s.log, event.kind, event.data);
    await examine({ ...s.request, tasks: tasks.map((task) => ({ ...task, publicInput: {}, hidden: null })) });
    const opening = s.sent[0] ?? "";
    expect(opening).toContain(
      "The tasks of the exam so far, what the last comparison that scored each one found, and whether a valid answer to it is on record",
    );
    expect(opening).toContain(
      String.raw`- faulted (family fixture): disputed: a check was at fault on an answer to it\n\nCounted from the same comparisons as the lines above`,
    );
    expect(opening).toContain("- family fixture, 5 tasks: 2 told apart, won by the other harness 2");
    expect(opening).not.toContain("h2");
    expect(opening).not.toContain(SOLVER);
    expect(opening).not.toContain("too easy");
  });

  it("says how many of its gate's three solves a held task passed on, and each draft the gate refused having read it", () => {
    const log = logged();
    const gated = (taskId: string, gate: JsonObject) => {
      log.add("task.proposed", {
        version: `v-${taskId}`,
        taskId,
        task: { ...fixture(taskId), publicInput: {}, hidden: null },
      });
      log.add("task.gate", { version: `v-${taskId}`, gate: 1, ...gate });
      if (gate.outcome === "refused") log.add("task.state", { version: `v-${taskId}`, state: "refused" });
    };
    gated("once", { outcome: "passed", reference: { valid: 1, solves: 3, billed: 0 } });
    gated("twice", { outcome: "passed", reference: { valid: 2, solves: 3, billed: 0 } });
    gated("every", {
      outcome: "refused",
      reason: "answered in 3 of 3",
      reference: { valid: 3, solves: 3, billed: 0 },
    });
    // A gate refused on two readings may be proposed again, and is no refusal to be told of; one
    // that held its draft on two readings is told with the solve that gave none.
    gated("cut", {
      outcome: "refused",
      reason: "not measured",
      reference: { valid: 2, solves: 2, billed: 0 },
    });
    gated("short", { outcome: "passed", reference: { valid: 1, solves: 2, billed: 0 } });
    const told = heard(log.events, ["once", "twice", "short"].map(fixture));
    // Until 14 October a later session was told neither.
    expect(told.lines).toEqual([
      line(
        "once",
        `not yet compared; ${VALID}; held out at its gate on 1 of the reference harness's 3 solves valid`,
      ),
      line(
        "twice",
        `not yet compared; ${VALID}; held out at its gate on 2 of the reference harness's 3 solves valid`,
      ),
      line(
        "short",
        `not yet compared; ${VALID}; held out at its gate on 1 of the reference harness's 3 solves valid, 1 of them giving no reading`,
      ),
    ]);
    expect(told.refused).toEqual([line("every", "refused: answered in 3 of 3")]);
  });

  it("says nothing it cannot count: a task the log does not hold, one task alone, no task at all", () => {
    const uncounted = { counts: null, turns: null, refused: [] };
    // A task the log does not hold yet, as a pack's is before `prepare.ts`, is not yet compared.
    expect(heard([], [fixture("e-1")])).toEqual({
      lines: [line("e-1", `not yet compared; ${NONE}`)],
      ...uncounted,
    });
    expect(heard([], [])).toEqual({ lines: [], ...uncounted });
    // One task counted alone is no count at all: it would be that task's result.
    const log = logged();
    log.hold("one");
    log.solved("b-1", "one", "h1", [true, true]);
    log.solved("b-1", "one", "h2", [false, false]);
    log.reported("b-1", ["h1", "h2"], 2, ["one"]);
    expect(heard(log.events, [fixture("one")]).counts).toBeNull();
    // A task the reference answered in every solve of two comparisons is no longer scored, but for
    // the third of such tasks the draw keeps; the line speaks of the reference's solves alone.
    const closed = ["p", "q", "r"];
    log.hold(...closed);
    for (const comparison of ["b-2", "b-3"]) {
      for (const taskId of closed) {
        log.solved(comparison, taskId, "h1", [true, true]);
        log.solved(comparison, taskId, "h2", [true, true]);
      }
      log.reported(comparison, ["h1", "h2"], 2, closed);
    }
    const spent = heard(log.events, closed.map(fixture)).lines.filter((each) =>
      each.includes(
        ": the reference harness answered it validly in every solve of two comparisons: no longer scored; ",
      ),
    );
    expect(spent).toHaveLength(2);
    expect(spent.join("\n")).not.toContain("both harnesses");
  });

  it("tells a task's last three comparisons with the reference, newest first, and how many of the newest closed it in a row", () => {
    const log = logged();
    const tasks = ["run", "once", "mixed"].map(fixture);
    log.hold(...tasks.map(({ taskId }) => taskId));
    // `run`: the reference h1 answered it in every solve of four comparisons running; `mixed`: in
    // every solve of b-1, in no solve of b-2 with one cut at its wall, and in every solve of b-3,
    // so it is exhausted on two closed comparisons that are not in a row; `once`: one comparison,
    // which is its outcome and no history. `run` is among the third the draw keeps.
    for (const comparison of ["b-1", "b-2", "b-3", "b-4"]) {
      log.solved(comparison, "run", "h1", [true, true]);
      log.solved(comparison, "run", "h2", [false, true]);
    }
    log.solved("b-1", "mixed", "h1", [true, true]);
    log.solved("b-1", "mixed", "h2", [true, true]);
    log.solved("b-2", "mixed", "h1", [false, null]);
    log.solved("b-2", "mixed", "h2", [true, true]);
    log.solved("b-3", "mixed", "h1", [true, true]);
    log.solved("b-3", "mixed", "h2", [false, false]);
    log.solved("b-1", "once", "h1", [true, false]);
    log.solved("b-1", "once", "h2", [true, true]);
    log.reported("b-1", ["h1", "h2"], 2, ["run", "mixed", "once"]);
    log.reported("b-2", ["h1", "h2"], 2, ["run", "mixed"]);
    log.reported("b-3", ["h1", "h2"], 2, ["run", "mixed"]);
    log.reported("b-4", ["h1", "h2"], 2, ["run"]);
    const { lines } = heard(log.events, tasks);
    expect(lines).toEqual([
      line(
        "run",
        `the reference harness answered it validly in every solve of the last comparison; ${VALID}; of its last 3 comparisons with the current reference harness, newest first, the reference answered it validly in every, every, every of its solves, the last 4 in a row closing it`,
      ),
      line(
        "once",
        `the reference harness answered it validly in some solves of the last comparison and not in others; ${VALID}`,
      ),
      line(
        "mixed",
        `the reference harness answered it validly in every solve of two comparisons: no longer scored; ${VALID}; of its last 3 comparisons with the current reference harness, newest first, the reference answered it validly in every, none (a solve cut at a limit), every of its solves, the last closing it`,
      ),
    ]);
    // The history is of the reference's side alone: the same lines whatever h2 answered, and
    // wherever a limit cut h2's own solves.
    const quiet = logged();
    quiet.hold(...tasks.map(({ taskId }) => taskId));
    for (const comparison of ["b-1", "b-2", "b-3", "b-4"]) {
      quiet.solved(comparison, "run", "h1", [true, true]);
      quiet.solved(comparison, "run", "h2", [true, true]);
    }
    for (const [comparison, valid] of [
      ["b-1", [true, true]],
      ["b-2", [false, null]],
      ["b-3", [true, true]],
    ] as const) {
      quiet.solved(comparison, "mixed", "h1", valid);
      quiet.solved(comparison, "mixed", "h2", comparison === "b-1" ? [null, false] : [false, false]);
    }
    quiet.solved("b-1", "once", "h1", [true, false]);
    quiet.solved("b-1", "once", "h2", [false, false]);
    for (const [session, pair, ids] of [
      ["b-1", ["h1", "h2"], ["run", "mixed", "once"]],
      ["b-2", ["h1", "h2"], ["run", "mixed"]],
      ["b-3", ["h1", "h2"], ["run", "mixed"]],
      ["b-4", ["h1", "h2"], ["run"]],
    ] as const) {
      quiet.reported(session, pair, 2, ids);
    }
    expect(heard(quiet.events, tasks).lines).toEqual(lines);
  });

  it("counts in a total where a family holds one task, reads no comparison between two other harnesses, and tells the reference's turns", () => {
    const log = logged();
    const tasks = [
      { taskId: "a-1", family: "beam" },
      { taskId: "a-2", family: "beam" },
      { taskId: "b-1", family: "slab" },
      { taskId: "b-2", family: "slab" },
      { taskId: "b-3", family: "slab" },
      { taskId: "b-4", family: "slab" },
    ];
    log.hold(...tasks.map(({ taskId }) => taskId));
    const first = log.events.length;
    // c-1, against the reference h1 at two solves a side.
    log.solved("c-1", "a-1", "h1", [false, false]);
    log.solved("c-1", "a-1", "h2", [true, false]);
    log.solved("c-1", "a-2", "h1", [true, true], [2, 2]);
    log.solved("c-1", "a-2", "h2", [true, true]);
    log.solved("c-1", "b-1", "h1", [false, false]);
    log.solved("c-1", "b-1", "h2", [false, false]);
    log.solved("c-1", "b-2", "h1", [true, false], [7, 1]);
    log.solved("c-1", "b-2", "h2", [false, true]);
    log.solved("c-1", "b-3", "h1", [true, true], [3, 3]);
    log.solved("c-1", "b-3", "h2", [true, true]);
    log.solved("c-1", "b-4", "h1", [false, false]);
    log.solved("c-1", "b-4", "h2", [false, false]);
    log.reported("c-1", ["h1", "h2"], 2, ["a-1", "a-2", "b-1", "b-2", "b-3", "b-4"]);
    // c-2 between two other harnesses, and c-3 against the reference at three solves a side.
    log.solved("c-2", "a-2", "h3", [true, true]);
    log.solved("c-2", "a-2", "h4", [false, false]);
    log.reported("c-2", ["h3", "h4"], 2, ["a-2"]);
    log.solved("c-3", "b-1", "h1", [true, true, true], [4, 6, 5]);
    log.solved("c-3", "b-1", "h5", [false, false, false]);
    log.reported("c-3", ["h1", "h5"], 3, ["b-1"]);
    log.add("task.state", { version: "v-b-3", state: "released" });
    log.add("task.state", { version: "v-b-4", state: "refused" });
    const said = (taskId: string, family: string, outcome: string) =>
      `${taskId} (family ${family}): ${outcome}; ${VALID}`;
    const { lines, counts, turns } = heard(log.events, tasks);
    expect(lines).toEqual([
      said("a-1", "beam", "the reference harness answered it validly in no solve of the last comparison"),
      said(
        "a-2",
        "beam",
        "the last comparison that scored it was between two other harnesses, so the reference harness's own record on it is older or none",
      ),
      // b-1 stood in c-1 and c-3 against the reference, so its line carries both, newest first.
      `${said("b-1", "slab", "the reference harness answered it validly in every solve of the last comparison")}; of its last 2 comparisons with the current reference harness, newest first, the reference answered it validly in every, none of its solves, the last closing it`,
      said(
        "b-2",
        "slab",
        "the reference harness answered it validly in some solves of the last comparison and not in others",
      ),
      "b-3 (family slab): in use as practice, and so never scored",
    ]);
    // a-2, b-3 and b-4 were each scored by c-1 and are in no count. Family beam counts one task,
    // a-1, so its row would be a-1's result: the rows by family fold into the total. Until
    // 12 October beam's row said which side won a-1, and esp32's 40 families each held one task.
    expect(counts?.split("\n").slice(1)).toEqual([
      "- every family, 3 tasks: 2 told apart, won by the other harness 1 and by the reference harness 1; 0 tied with both harnesses valid in every solve; 0 tied with neither valid in any solve, of which 0 with a valid answer on record; 1 tied otherwise; 0 set aside on a rejection not settled.",
      "Each count rests on 2 to 3 solves a side of the task's last comparison. The same harness fails a task once and passes it the next time, so a count over a few tasks, and more so one family's share of them, is weak evidence.",
    ]);
    // The turns of the reference's valid answers, from the comparison each line reads: a-2's
    // answers in c-1 are not its last comparison's, b-3 is practice, and no turn of another
    // harness (11) is among them.
    expect(turns?.split("\n")).toEqual([
      "The solver's own turns each valid answer of the reference harness took, in the same comparisons as the lines above, by family and fewest first. These are measurements and no target.",
      "- family slab: 4, 5, 6, 7",
    ]);
    // A control between two other harnesses that reported first is not the reference: the turns
    // stay the starter's, as the lines and the counts do. Read from the first report's old side,
    // they were none of the reference's and the control's own (9) where it stood last.
    const from = log.events.length;
    log.solved("c-0", "b-2", "h3", [true, true], [9, 9]);
    log.solved("c-0", "b-2", "h4", [false, false]);
    log.reported("c-0", ["h3", "h4"], 2, ["b-2"]);
    const control = log.events.splice(from);
    expect(heard(log.events.toSpliced(first, 0, ...control), tasks)).toEqual({
      lines,
      refused: [],
      counts,
      turns,
    });
    // Neither the lines nor the counts name a harness.
    expect([...lines, counts, turns].join("\n")).not.toMatch(/\bh[1-5]\b/);
  });
});
