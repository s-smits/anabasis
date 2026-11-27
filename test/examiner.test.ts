// The Examiner's one session, `examine`, in its two modes on the faux provider: what both modes
// share (an id, a wall, a shell, an ending, a bill), what a drafting session that puts one whole
// draft is told, what a writing session's gate and tools hold, and what a task's author hears of it,
// carried to a later session from the log alone.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  createAssistantMessageEventStream,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { CLAUDE_COMPACTED } from "../src/agent/backends/claude.ts";
import { draftOf } from "../src/examiner/draft.ts";
import { taskHistory } from "../src/examiner/record.ts";
import { type Ask, examine } from "../src/examiner/session.ts";
import { EXAMINER_HOMES, hasHomeSnapshot } from "../src/examiner/home-store.ts";
import { examinerDirs, inExaminerSandbox } from "../src/examiner/shell.ts";
import { writing } from "../src/examiner/write.ts";
import { writtenTasks } from "../src/kernel/history.ts";
import { append, read } from "../src/kernel/log.ts";
import { billedAll } from "../src/kernel/meter.ts";
import { solvesIn } from "../src/kernel/solves.ts";
import type { Verifier } from "../src/kernel/verify.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { dirname, join } from "../src/meta/path.ts";
import {
  bash,
  call,
  failed,
  finish,
  instance,
  invoke,
  toolOf,
  KIND,
  MODES,
  NOTE,
  PUT,
  propose,
  REPO,
  SOUND,
  seat,
  sweep,
  WALL,
} from "./helpers/examiner-seat.ts";
import { containing, present } from "./helpers/matchers.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";

const CALLED = "exam.call";
const TASK_ADMISSION = "task.gate";
const PROPOSED = "task.proposed";
const TASK_STATE = "task.state";
const EXAM_FINISHED = "exam.finished";
const PROPOSE = "propose_tasks";
const SOLVER = "solver-canary-7f3a";
const GOOD = { answer: "42", unit: "N" };
const ENTERS = {
  draft:
    "A draft enters the exam through draft_exam, and .toolchain/ in your home is frozen beside it for declared verifier tools; nothing else in your home enters the exam",
  write: "Nothing in your home enters the exam: a task enters it through propose_tasks alone",
} as const;
const TOOL_USE = { stopReason: "toolUse" } as const;
const verify: Verifier = async (_task, answer) =>
  asRecord(answer)?.answer === "42" ? { kind: "pass" } : { kind: "fail", blocking: ["check-product"] };
const tried = (base: number, answer: JsonValue = GOOD, hidden: JsonValue = { seed: 1 }) =>
  call("try_answer", { family: "fixture", public_input: { base }, hidden, answer });

setDefaultTimeout(120_000);
afterAll(sweep);

function billing(models: ReturnType<ReturnType<typeof seat>["request"]["models"]>, cost: number) {
  // SAFETY: the inherited instance supplies every method; streamSimple alone is replaced.
  const metered = Object.create(models) as typeof models;
  metered.streamSimple = (...asked: Parameters<typeof models.streamSimple>) => {
    const streamed = createAssistantMessageEventStream();
    (async () => {
      for await (const event of models.streamSimple(...asked)) {
        if (event.type !== "done") {
          streamed.push(event);
          continue;
        }
        const output = Math.ceil((cost * 1_000_000) / asked[0].cost.output);
        const usage = event.message.usage;
        streamed.push({
          ...event,
          message: {
            ...event.message,
            usage: {
              ...usage,
              output,
              totalTokens: usage.totalTokens - usage.output + output,
            },
          },
        });
      }
    })().catch(() => undefined);
    return streamed;
  };
  return metered;
}

describe("a session of any mode", () => {
  it("records and bills its first turn before its draft reader or its checks of an answer run", async () => {
    for (const mode of MODES) {
      const put = mode === "draft" ? PUT.draft : tried(7);
      const s = seat(mode, [put, finish, finish]);
      const observed: JsonObject[] = [];
      const record = () => {
        if (observed.length > 0) return;
        observed.push({
          turn: s.of(`${KIND[mode]}.turn`).at(-1)?.turn ?? null,
          billed: billedAll(read(s.log)),
        });
      };
      const request =
        s.request.mode === "draft"
          ? {
              ...s.request,
              reading: async () => {
                record();
                return [];
              },
            }
          : {
              ...s.request,
              verify: async (...asked: Parameters<Verifier>) => {
                record();
                return await verify(...asked);
              },
            };
      await examine(request);
      expect(observed).toHaveLength(1);
      expect(observed[0]?.turn).toBe(1);
      expect(observed[0]?.billed).toBeGreaterThan(0);
    }
  });

  it("ends at finish, or at its turns, its deadline, a kill, a failed turn or a spent budget, and its result and last event say which", async () => {
    for (const mode of MODES) {
      const finished = seat(mode, [finish, finish]);
      const before = billedAll(read(finished.log));
      expect(await examine(finished.request)).toEqual({ ended: "finished", puts: 0, held: [], refused: [] });
      expect(finished.of(`${KIND[mode]}.started`)).toMatchObject([
        { session: finished.request.id, effort: "medium", limits: { wallSeconds: 600, turns: 12 } },
      ]);
      expect(finished.of(`${KIND[mode]}.finished`)).toMatchObject([
        { session: finished.request.id, ended: "finished", note: NOTE, crash: null },
      ]);
      expect(billedAll(read(finished.log))).toBeGreaterThan(before);
      expect(finished.sent[0]).not.toContain('{"name":"bash"');
      expect(finished.sent[0]).not.toContain("Nothing in your home enters the exam");

      const turned = seat(mode, [PUT[mode], finish]);
      const { limits } = turned.request;
      const faulted = {
        ...turned.request,
        reading: async () => ["a fault"],
        limits: { ...limits, turns: 1 },
      };
      expect(await examine(faulted)).toMatchObject({ ended: "turns", puts: 1 });
      expect(turned.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "turns", turns: 1, crash: null }]);

      const slow: FauxResponseStep = () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(finish), 600);
        });
      const walled = seat(mode, [slow, finish]);
      expect(await examine({ ...walled.request, limits: { ...limits, wallSeconds: 0.2 } })).toMatchObject({
        ended: "wall",
      });
      expect(walled.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "wall", crash: null }]);

      const kill = new AbortController();
      const killed = seat(mode, [
        () => {
          kill.abort();
          return fauxAssistantMessage("Thinking.");
        },
        finish,
      ]);
      expect(await examine({ ...killed.request, kill: kill.signal })).toMatchObject({ ended: "killed" });

      const limit = "You've hit your session limit";
      const crashed = seat(mode, [failed(limit)]);
      expect(await examine(crashed.request)).toMatchObject({ ended: "crashed", puts: 0 });
      expect(crashed.of(`${KIND[mode]}.finished`)).toMatchObject([
        { ended: "crashed", crash: limit, note: null },
      ]);

      const spent = seat(mode, [fauxAssistantMessage("One turn."), fauxAssistantMessage("Never asked for.")]);
      append(spent.log, "campaign.opened", { budget: { dollars: 0.1, reserve: 0.1 } });
      const metered = billing(spent.request.models(), 0.15);
      expect(await examine({ ...spent.request, models: () => metered })).toMatchObject({ ended: "stopped" });
      expect(spent.sent).toHaveLength(1);
      expect(spent.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "stopped", crash: null, turns: 1 }]);
    }
  });

  it("starts nothing for a run stopped before it began, nor for an id the log already holds", async () => {
    for (const mode of MODES) {
      const stopped = seat(mode, [PUT[mode], finish]);
      await expect(examine({ ...stopped.request, kill: AbortSignal.abort() }, WALL)).rejects.toThrow(
        `session ${stopped.request.id} was stopped before it began`,
      );
      expect(existsSync(stopped.log)).toBe(false);
      expect(existsSync(examinerDirs(stopped.log, stopped.request.id).root)).toBe(false);
      expect(stopped.sent).toEqual([]);

      const s = seat(mode, [finish, finish, finish]);
      await examine(s.request);
      await expect(examine(s.request, WALL)).rejects.toThrow(
        `session ${s.request.id} is in the log already; a session's id names one session`,
      );
      expect(s.of(`${KIND[mode]}.started`)).toHaveLength(1);
      expect(existsSync(examinerDirs(s.log, s.request.id).root)).toBe(false);
    }
  });

  it("has a shell in a walled home of its own, closed to the repository, and is told how the exam is entered", async () => {
    const outside = join(REPO, "examined-outside.txt");
    for (const mode of MODES) {
      const s = seat(mode, [
        bash("echo noted > note.txt"),
        call("read", { path: "note.txt" }),
        bash(`cat ${join(REPO, "package.json")} >/dev/null 2>&1 && echo read || echo refused`),
        bash(`(echo x > ${outside}) 2>/dev/null && echo written || echo refused`),
        call("read", { path: join(REPO, "package.json") }),
        call("write", { path: outside, content: "x" }),
        PUT[mode],
        finish,
        finish,
      ]);
      expect((await examine(s.request, WALL)).ended).toBe(mode === "write" ? "finished" : "stands");
      const calls = s.of(`${KIND[mode]}.call`);
      expect(calls.slice(0, 4).map(({ tool, isError }) => [tool, isError])).toEqual(
        ["bash", "read", "bash", "bash"].map((tool) => [tool, false]),
      );
      expect(calls.slice(1, 4).map(({ text }) => text)).toEqual(["noted", "refused", "refused"]);
      expect(calls.slice(4, 6).map(({ tool, isError }) => [tool, isError])).toEqual([
        ["read", true],
        ["write", true],
      ]);
      expect(existsSync(outside)).toBe(false);
      expect(existsSync(examinerDirs(s.log, s.request.id).host)).toBe(false);
      const told = s.sent[0] ?? "";
      expect(told).toContain("but no repository or private data");
      expect(told).toMatch(/It has (no )?network access: a package index (was|could not be) reached/);
      expect(told).toContain(`${ENTERS[mode]}.`);
    }
  });
});

describe("the home a wall keeps for a campaign's writing sessions", () => {
  it("keeps nothing of a writing session's home where it crashed with a command running", async () => {
    const s = seat("write", []);
    const keep = join(dirname(s.log), "examiner-home");
    mkdirSync(keep);
    writeFileSync(join(keep, "kept.txt"), "kept\n");
    const opened = await inExaminerSandbox(s.request, { ...WALL, keep }, async ({ shell }) => {
      writeFileSync(join(shell.dirs.home, "wrote.txt"), "wrote\n");
      append(s.log, EXAM_FINISHED, { session: s.request.id, ended: "crashed", running: 1 });
      return readdirSync(shell.dirs.home).toSorted();
    });
    expect(opened).toEqual(["kept.txt", "wrote.txt"]);
    expect(readdirSync(keep)).toEqual(["kept.txt"]);
    expect(hasHomeSnapshot(join(dirname(s.log), EXAMINER_HOMES), s.request.id)).toBe(false);
  });

  it("carries a relative link as it stands, into the home and out of it", async () => {
    // A venv's `python` names `python3.14` beside it, read through the session's root, which goes when
    // the session ends.
    const s = seat("write", []);
    const keep = join(dirname(s.log), "examiner-home");
    mkdirSync(keep);
    writeFileSync(join(keep, "python3.14"), "python\n");
    symlinkSync("python3.14", join(keep, "python"));
    const seen = await inExaminerSandbox(s.request, { ...WALL, keep }, async ({ shell }) => {
      symlinkSync("python3.14", join(shell.dirs.home, "python3"));
      append(s.log, EXAM_FINISHED, { session: s.request.id, ended: "finished", running: 0 });
      return readlinkSync(join(shell.dirs.home, "python"));
    });
    expect([seen, readlinkSync(join(keep, "python")), readlinkSync(join(keep, "python3"))]).toEqual([
      "python3.14",
      "python3.14",
      "python3.14",
    ]);
  });

  it("carries a session's home into the next, whole, a drafting session's too", async () => {
    const s = seat("write", [
      bash("rm kept.txt; echo half > half.txt"),
      finish,
      finish,
      bash("ls"),
      finish,
      finish,
    ]);
    const keep = join(dirname(s.log), "examiner-home");
    mkdirSync(keep);
    writeFileSync(join(keep, "kept.txt"), "kept\n");
    await examine(s.request, { ...WALL, keep });
    await examine({ ...s.request, id: "x-2" }, { ...WALL, keep });
    expect(s.of(CALLED).filter(({ tool }) => tool === "bash")[1]?.text).toBe("half.txt");
    expect(readdirSync(keep)).toEqual(["half.txt"]);

    const drafted = seat("draft", [bash("ls; echo gen > generate.py"), PUT.draft, finish]);
    await examine(drafted.request, { ...WALL, keep });
    expect(drafted.of("draft.call")[0]?.text).toBe("half.txt");
    expect(readdirSync(keep).toSorted()).toEqual(["generate.py", "half.txt"]);
  });

  it("keeps an ask's home at its rest, before the conversation it rests in ends", async () => {
    const s = seat("write", [bash("echo first > first.txt"), propose(2), finish]);
    const keep = join(dirname(s.log), "examiner-home");
    mkdirSync(keep);
    const atRest: string[][] = [];
    await examine(
      {
        ...s.request,
        wanted: 1,
        rest: async () => {
          atRest.push(readdirSync(keep));
          return null;
        },
      },
      { ...WALL, keep },
    );
    expect(atRest).toEqual([["first.txt"]]);
    expect(hasHomeSnapshot(join(dirname(s.log), EXAMINER_HOMES), s.request.id)).toBe(true);
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
    expect(s.of("draft.started")).toMatchObject([
      { limits: { wallSeconds: 600, turns: 12, tries: 4 }, prompt: "A fixture." },
    ]);
    expect(draftOf(read(s.log))).toEqual(SOUND);
    expect(s.sent[0]).toContain("This session has 10 minutes, 12 turns and 4 drafts.");
  });

  it("keeps its turns after a reading that outlasts its wall, since the host's reading is not its time", async () => {
    const s = seat("draft", [PUT.draft, finish]);
    const reading = async () => {
      await Bun.sleep(400);
      return ["a fault"];
    };
    const { limits } = s.request;
    const examined = await examine({ ...s.request, reading, limits: { ...limits, wallSeconds: 0.3 } });
    expect(examined).toMatchObject({ ended: "finished", puts: 1 });
    expect(s.of("draft.finished")).toMatchObject([{ ended: "finished", stands: false, tries: 1 }]);
  });
});

function admissionSaid(text: JsonValue | undefined): (string | number | null)[][] {
  return (isString(text) ? text : "").split("\n").flatMap((line) => {
    const said = /^(\S+): (held out|refused)(?:.*? validly in (\d+) of)?/.exec(line);
    if (said === null) return line.endsWith("put to the gate in this session.") ? [] : [["", "", null]];
    const [, id = "", outcome = "", valid] = said;
    return [[id, outcome, valid === undefined ? null : Number(valid)]];
  });
}

describe("a session that writes tasks", () => {
  it("holds the same task version by checked reference as by content", async () => {
    const results: JsonObject[][] = [];
    for (const byReference of [false, true]) {
      const s = seat("write", []);
      const mode = writing({ ...s.request, verify }, undefined);
      const checked = await invoke(toolOf(mode, "try_answer"), "check", {
        ...instance(7),
        hidden: JSON.stringify({ seed: 1 }),
        answer: GOOD,
      });
      const said = checked.output?.[0];
      const reference =
        said?.type === "text" ? /Instance reference: (\w+)\./u.exec(said.text)?.[1] : undefined;
      expect(reference).toBeDefined();
      const put = toolOf(mode, PROPOSE);
      const unknown = await invoke(put, "unknown", { tasks: [{ reference: "missing" }] });
      expect(unknown.output).toEqual([
        {
          type: "text",
          text: containing(`Known references: ${String(reference)}`),
        },
      ]);
      expect(mode.result().puts).toBe(0);
      expect(s.of(PROPOSED)).toHaveLength(0);
      await invoke(put, "propose", {
        tasks: [byReference ? { reference: String(reference) } : instance(7)],
      });
      expect(mode.result().held).toHaveLength(1);
      expect(s.of("task.feasible")).toMatchObject([{ answer: GOOD }]);
      results.push(s.of(PROPOSED));
      await invoke(put, "duplicate", { tasks: [instance(7), { reference: String(reference) }] });
      expect(mode.result().puts).toBe(1);
      const next = writing({ ...s.request, id: "x-2", verify }, undefined);
      const expired = await invoke(toolOf(next), "expired", {
        tasks: [{ reference: String(reference) }],
      });
      expect(expired.output).toEqual([{ type: "text", text: containing("Known references: none") }]);
    }
    expect(results[0]).toEqual(results[1]);
  });

  it("proves a task whose check reads files through a try that carries them, and rechecks it with them", async () => {
    const reads: Verifier = async (_task, answer, _signal, files) =>
      asRecord(answer)?.answer === "42" && files?.[0]?.text === "ok"
        ? { kind: "pass" }
        : { kind: "fail", blocking: ["check-product"] };
    const s = seat("write", []);
    const mode = writing({ ...s.request, verify: reads }, undefined);
    const tool = toolOf(mode, "try_answer");
    const bare = await invoke(tool, "bare", { ...instance(7), answer: GOOD });
    expect(JSON.stringify(bare.output)).toContain("check-product");
    await invoke(tool, "files", { ...instance(7), answer: GOOD, files: [{ path: "report.md", text: "ok" }] });
    await invoke(toolOf(mode, PROPOSE), "propose", { tasks: [instance(7)] });
    expect(mode.result().held).toHaveLength(1);
    expect(s.of("task.feasible")).toMatchObject([{ answer: GOOD }]);
  });

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
      "- e-1 (fixture); no valid answer on record",
      "This session has 10 minutes, 12 turns and 4 drafts to put to the gate.",
    ]) {
      expect(opening).toContain(said);
    }
    for (const unsaid of [
      "Every solve of a task is held to",
      "Objective:",
      "leave no room",
      "write_controls",
      "stronger solver",
      "said at its finish",
      "Counted from the same comparisons",
      '{"name":"try_answer"',
    ]) {
      expect(opening).not.toContain(unsaid);
    }
    // How many tasks are wanted is not the Examiner's to know: no prompt and no tool text says 24.
    expect(opening.replaceAll(/"timestamp":\d+/g, "")).not.toContain("24");
    expect(s.sent[1]).toContain(String.raw`\"seed\":5`);
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
    expect(s.of(EXAM_FINISHED)).toMatchObject([{ proposed: 0, held: [], refused: [] }]);

    // The budget every solve is held to, as a fact and no target; the next session sees each earlier
    // draft, with no account by its author.
    const writer = seat("write", [propose(7), finish, finish]);
    await examine(writer.request);
    const next = seat("write", [finish, finish]);
    await examine({
      ...next.request,
      id: "x-2",
      log: writer.log,
      tasks: [...next.request.tasks, ...writtenTasks(read(writer.log))],
      budget: { modelTurns: 3, minutes: 8, solves: 2 },
    });
    expect(next.sent[0]).toMatch(
      /held to 3 turns of the solver's own[^.]*, and 8 minutes, and a comparison solves each task 2 times under each harness\./u,
    );
    expect(next.sent[0]).toContain("it is no target of yours");
    expect(next.sent[0]).toContain("x-1-001 (fixture)");
    for (const unsaid of ["said at its finish", NOTE, "graded", "by its author"]) {
      expect(next.sent[0]).not.toContain(unsaid);
    }
  });

  // An Examiner session can be cut at its wall while still proposing, even in a command, when its
  // limits are told at its opening alone.
  it("ends when the host has its tasks, and declines each finish that follows a proposal while it has not", async () => {
    const both = fauxAssistantMessage(
      [
        fauxToolCall(PROPOSE, { tasks: [instance(2), instance(3)] }),
        fauxToolCall(PROPOSE, { tasks: [instance(11)] }),
      ],
      TOOL_USE,
    );
    const s = seat("write", [both, propose(13), finish]);
    const examined = await examine({ ...s.request, wanted: 2 });
    expect(examined).toMatchObject({ ended: "supplied", puts: 2 });
    expect(examined.held).toHaveLength(2);
    expect(JSON.stringify(s.of(CALLED).at(-1))).toContain("The host has the tasks it needs");
    expect(s.of("exam.turn")).toHaveLength(1);

    // A live session may propose one batch and finish with most of its tasks and turns left; asked
    // again, it may propose more and end at its second finish.
    const short = seat("write", [propose(1), finish, propose(2), finish, finish]);
    expect(await examine(short.request)).toMatchObject({ ended: "finished", puts: 2 });
    for (const at of [1, 3]) expect(short.of(CALLED)[at]?.text).not.toMatch(/\d/);
    expect(short.of("exam.turn")).toHaveLength(5);

    // A session with no proposal left is not asked for more, since a continuation after the
    // allowance is spent could propose nothing.
    const spent = seat("write", [propose(1), finish]);
    const limits = { ...spent.request.limits, puts: 1 };
    expect(await examine({ ...spent.request, limits })).toMatchObject({ ended: "finished", puts: 1 });
    expect(spent.of(CALLED)[1]?.text).not.toContain("Propose further tasks");
    expect(spent.of("exam.turn")).toHaveLength(2);
  });

  it("runs the checks on an instance with an answer of its own, and keeps of a pass only that the instance has a valid answer", async () => {
    // A hidden value sent as JSON text is read as the JSON it encodes: a try may send "null" where its
    // proposal sends null.
    const s = seat("write", [
      tried(7),
      tried(8, { answer: "1", unit: "N" }),
      tried(9, GOOD, '{"seed": 1}'),
      tried(10),
      call(PROPOSE, {
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
    expect(asked).toEqual(
      ["try", "try", "try", "try", "x-1-001", "x-1-003", "x-1-004"].map((id) => [id, { seed: 1 }]),
    );
    expect(
      s
        .of(CALLED)
        .slice(0, 2)
        .map(({ text }) => text),
    ).toEqual([containing("Every applicable check passed"), containing("Refused by check-product")]);
    const proved = [s.versionOf("x-1-001", 7), s.versionOf("x-1-003", 9), s.versionOf("x-1-004", 10)];
    expect(s.of("task.feasible")).toEqual(
      proved.map((version) => ({ version, session: "x-1", answer: GOOD })),
    );
    const [unread] = taskHistory(read(s.log), writtenTasks(read(s.log))).groups;
    expect(unread?.heading).toContain("Not yet compared");
    expect(unread?.lines[0]).toBe("x-1-001 (fixture); a valid answer on record");
  });

  it("keeps the objective's measure of its author's valid answer where the contract declares one, and none where it declares none", async () => {
    const steps = [tried(7), propose(7), tried(7), tried(7, { answer: "1", unit: "N" }), finish, finish];
    const measures = [3.5, 3.25, 2.25];
    const run = async (declared: boolean) => {
      const s = seat("write", steps);
      const taken = [...measures];
      await examine({
        ...s.request,
        contract: declared
          ? { ...s.request.contract, objective: { quantity: "mass", direction: "lower" } }
          : s.request.contract,
        verify: async (task, answer) => {
          const verdict = await verify(task, answer);
          return verdict.kind === "pass" ? { kind: "pass", objective: taken.shift() ?? 0 } : verdict;
        },
      });
      return s;
    };
    const declared = await run(true);
    const version = declared.versionOf("x-1-001", 7);
    const kept = (measure: number) => ({
      version,
      session: "x-1",
      answer: GOOD,
      objective: { quantity: "mass", direction: "lower", measure },
    });
    expect(declared.of("task.feasible")).toEqual([kept(3.25), kept(2.25)]);
    const undeclared = await run(false);
    expect(undeclared.of("task.feasible")).toEqual([{ version, session: "x-1", answer: GOOD }]);
    const told = (s: typeof declared) => s.of(CALLED).flatMap(({ text }) => (isString(text) ? [text] : []));
    expect(told(declared).filter((line) => line.includes("By the objective it measures"))).toHaveLength(2);
    expect(told(undeclared).join("\n")).not.toContain("By the objective");
  });

  it("refuses a task that carries a planted answer whole, in its public input or its hidden values", async () => {
    const planted = { answer: "42", unit: "N" };
    const s = seat("write", [
      tried(2),
      tried(2, { answer: "42.0", unit: "N" }),
      call(PROPOSE, {
        tasks: [
          { family: "fixture", public_input: { base: 2 }, hidden: { seed: 1, witness: planted } },
          { family: "fixture", public_input: { base: 3, given: [planted] }, hidden: { seed: 1 } },
          instance(2),
        ],
      }),
      finish,
      finish,
    ]);
    for (const [version, admission] of [
      ["v-earlier-1", { outcome: "passed", proved: true }],
      ["v-earlier-2", { outcome: "refused", reason: "no inputs", proved: false }],
      ["v-pack", { outcome: "passed" }],
    ] as const) {
      append(s.log, PROPOSED, { version, taskId: version });
      append(s.log, TASK_ADMISSION, { version, gate: 1, ...admission });
    }
    const examined = await examine({ ...s.request, verify });
    expect(admissionSaid(s.of(CALLED)[2]?.text)).toEqual([
      ["x-1-001", "refused", null],
      ["x-1-002", "refused", null],
      ["x-1-003", "held out", null],
    ]);
    expect(examined.held).toEqual([s.versionOf("x-1-003", 2)]);
  });

  it("serves a draft of this session by its id once the gate has read it", async () => {
    const s = seat("write", []);
    append(s.log, "exam.started", { session: s.request.id });
    const mode = writing(s.request, undefined);
    await invoke(toolOf(mode), "put", { tasks: [instance(2)] });
    const [draft] = writtenTasks(read(s.log));
    if (draft === undefined) throw new Error("the draft was not written");
    expect(mode.result().held).toEqual([s.versionOf(draft.taskId, 2)]);
    const example = await invoke(toolOf(mode, "read_example"), "own", {
      task: draft.taskId,
    });
    expect(example.output).toEqual([{ type: "text", text: JSON.stringify(draft) }]);
  });

  it("holds a task out on its package's shape alone, starts no solve of it, and is told of no room solve", async () => {
    const s = seat("write", [propose(2, null), finish, finish]);
    const examined = await examine({ ...s.request, verify });
    expect(admissionSaid(s.of(CALLED)[0]?.text)).toEqual([
      ["x-1-001", "held out", null],
      ["x-1-002", "refused", null],
    ]);
    expect(examined.held).toEqual([s.versionOf("x-1-001", 2)]);
    expect(s.of(TASK_ADMISSION)).toMatchObject([{ outcome: "passed" }, { outcome: "refused" }]);
    expect(s.of(TASK_ADMISSION).filter((gate) => "reference" in gate || "proved" in gate)).toEqual([]);
    expect(solvesIn(read(s.log))).toEqual([]);
    expect(s.of(EXAM_FINISHED)[0]).not.toHaveProperty("hostSeconds");
    const mode = writing({ ...s.request, id: "x-2", verify }, undefined);
    expect(mode.tools.map(({ name }) => name)).toEqual([
      PROPOSE,
      "read_example",
      "read_reviews",
      "try_answer",
    ]);
    expect(mode.tools[0]?.description).toContain("No solver is put to it there.");
    for (const unsaid of [
      "try_task",
      "solved by the reference harness",
      "wait returns",
      "the gate measures",
    ]) {
      expect(mode.system).not.toContain(unsaid);
    }
    expect(mode.started).not.toHaveProperty("tried");
  });

  it("takes again no content an earlier log's gate read, a gate that refused it unmeasured among them", async () => {
    // No gate refuses a draft before its room solves decide anything, so no draft is handed to
    // the next author to propose again.
    const s = seat("write", []);
    const task = { taskId: "x-1-001", family: "fixture", publicInput: { base: 7 }, hidden: { seed: 1 } };
    const version = s.versionOf(task.taskId, 7);
    append(s.log, PROPOSED, { version, taskId: task.taskId, session: "x-1", task });
    append(s.log, TASK_ADMISSION, {
      version,
      gate: 1,
      outcome: "refused",
      reason: "the reference harness answered it in 2 of 3 solves, so it is not measured",
      reference: { valid: 2, solves: 2, ran: 3, billed: 0 },
    });
    append(s.log, TASK_STATE, { version, state: "refused", session: "x-1" });
    const next = writing({ ...s.request, id: "x-2", tasks: [] }, undefined);
    await invoke(toolOf(next), "again", { tasks: [instance(7)] });
    expect(next.result().puts).toBe(0);
    expect(next.opening).not.toContain("gate not measured");
  });

  it("is told where no objective leaves room, asked for no account of a draft, quotes no archive count, and finishes with a sentence for the log", () => {
    const mode = writing(seat("write", []).request, undefined);
    for (const said of [
      "Without an objective, valid answers always tie",
      "reports how often its own solves differed",
    ]) {
      expect(mode.system).toContain(said);
    }
    for (const unsaid of ["314", "1,373", "you hear nothing more of it", "## What you put"]) {
      expect(mode.system).not.toContain(unsaid);
    }
    expect(mode.finish).toContain("for the log");
  });

  it("runs in its shell the engine a check names, from where it lies, and no other program of its tree", async () => {
    let pack = "";
    const s = seat("write", [
      bash("fixeng"),
      bash("command -v solver-x || echo absent"),
      () => bash(`cat ${join(pack, "hidden.json")} 2>/dev/null || echo refused`),
      bash(`(echo x > "$(command -v fixeng)") 2>/dev/null && echo written || echo refused`),
      finish,
      finish,
    ]);
    pack = join(dirname(s.log), "pack");
    const tools = join(pack, ".toolchain");
    mkdirSync(join(pack, "checks"), { recursive: true });
    const brief = parseJsonAs<{ truthChecks: { execution: { requiredToolIds?: string[] } }[] }>(
      readFileSync(join(s.program, "brief.json"), "utf8"),
    );
    present(brief.truthChecks[0]).execution.requiredToolIds = ["fixeng"];
    writeFileSync(join(pack, "checks", "brief.json"), JSON.stringify(brief));
    mkdirSync(join(tools, "bin"), { recursive: true });
    mkdirSync(join(tools, "share"), { recursive: true });
    writeFileSync(join(tools, "share", "fixeng.dat"), "engine data\n");
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
    expect(
      s
        .of(CALLED)
        .slice(0, 4)
        .map(({ text }) => text),
    ).toEqual(["engine data", "absent", "refused", "refused"]);
    expect(s.of("exam.started")).toMatchObject([
      { engines: [{ name: "fixeng", sha256: sha256OfFile(join(tools, "bin", "fixeng")) }] },
    ]);
    expect(s.sent[0]).toContain("run by name: fixeng.");
    expect(s.sent[0]).not.toContain("solver-x");
  });
});

describe("one Examiner conversation across the host's asks", () => {
  it("wakes the same conversation at the next ask, told only the readings since, and ends at the host's close", async () => {
    const s = seat("write", [propose(2), propose(3), finish, finish]);
    const asks: Ask[] = [{ ...s.request, id: "x-2", wanted: 17 }];
    const rested: string[] = [];
    const examined = await examine({
      ...s.request,
      wanted: 1,
      rest: async (ask) => {
        rested.push(ask.ended);
        // A promotion while the conversation rests is an opening's to tell: the host ends a resting
        // conversation at the next ask (`examineAction`), so a wake says nothing of it.
        append(s.log, "harness.promoted", { harness: "h2", from: "h1", rests: [{ comparison: "c-1" }] });
        return asks.shift() ?? null;
      },
    });
    expect(rested).toEqual(["supplied", "finished"]);
    expect(examined).toMatchObject({ ended: "finished", puts: 1 });
    expect(s.of("exam.started").map(({ session, conversation }) => [session, conversation ?? null])).toEqual([
      ["x-1", null],
      ["x-2", "x-1"],
    ]);
    expect(s.of("exam.started")[1]).toMatchObject({ limits: { tasks: 17 } });
    expect(s.of("exam.finished").map(({ session, ended, turns }) => [session, ended, turns])).toEqual([
      ["x-1", "supplied", 1],
      ["x-2", "finished", 3],
    ]);
    // An ask closed at a rest still writes `reportedCost`, null where the backend reports none, so the
    // cost check does not read past it.
    expect(s.of("exam.finished").map((ended) => "reportedCost" in ended)).toEqual([true, true]);
    expect(s.of("exam.turn").map(({ session }) => session)).toEqual(["x-1", "x-2", "x-2", "x-2"]);
    expect(s.of(CALLED).map(({ session }) => session)).toEqual(["x-1", "x-2", "x-2", "x-2"]);
    expect(s.of(CALLED).map(({ ms }) => ms === null)).toEqual([true, false, false, false]);
    expect(s.of("task.proposed").map(({ taskId }) => taskId)).toEqual(["x-1-001", "x-2-001"]);
    const [opening = "", woken = ""] = s.sent;
    const called = s.of(CALLED)[0]?.text;
    const told = isString(called) ? called : "";
    expect(told).toContain("The host asks for more tasks");
    expect(woken).toContain(JSON.stringify(told.split("\n\n").at(-1)).slice(1, -1));
    expect(opening).toContain("Public rules of the domain");
    expect(woken).toContain("Public rules of the domain");
    expect(told).toContain("The reference harness was promoted on the step of comparison c-1");
    expect(told).toContain("No comparison has reported since the host last told you.");
    for (const unsaid of ["17", "harder", "wanted"]) expect(told).not.toContain(unsaid);
  });

  it("closes a conversation whose ask finished holding nothing, so the next ask opens afresh", async () => {
    const s = seat("write", [finish, finish, propose(2), finish]);
    const rested: string[] = [];
    const examined = await examine({
      ...s.request,
      wanted: 1,
      rest: async (ask) => {
        rested.push(ask.ended);
        return { ...s.request, id: "x-2", wanted: 1 };
      },
    });
    expect(rested).toEqual([]);
    expect(examined).toMatchObject({ ended: "finished", held: [] });
    expect(s.of("exam.started").map(({ session }) => session)).toEqual(["x-1"]);
  });

  it("serves at `read_opening` what the current ask was told: its record and its limits, whose wake a compaction would drop", async () => {
    const reread = call("read_opening", {});
    const s = seat("write", [reread, propose(2), reread, finish, finish]);
    const asks: Ask[] = [{ ...s.request, id: "x-2", wanted: 1, limits: { ...s.request.limits, turns: 7 } }];
    await examine({
      ...s.request,
      wanted: 1,
      rest: async () => {
        append(s.log, "harness.promoted", { harness: "h2", from: "h1", rests: [{ comparison: "c-1" }] });
        return asks.shift() ?? null;
      },
    });
    const served = s.of(CALLED).flatMap(({ tool, text }) => (tool === "read_opening" ? [text] : []));
    expect(served).toHaveLength(2);
    const [first, second] = served.map((text) => (isString(text) ? text : ""));
    const promotion = "The reference harness was promoted on the step of comparison c-1";
    expect(first).toContain("12 turns");
    expect(first).not.toContain(promotion);
    expect(second).toContain("Public rules of the domain");
    expect(second).toContain("7 turns");
    expect(second).not.toContain("12 turns");
    expect(second).toContain(promotion);
  });

  it("tells a conversation opening afresh the drafts the gate refused, where a wake tells none", async () => {
    const s = seat("write", [propose(null), propose(2), finish, finish]);
    const asks: Ask[] = [{ ...s.request, id: "x-2", wanted: 1 }];
    await examine({
      ...s.request,
      wanted: 1,
      rest: async () => asks.shift() ?? null,
    });
    const refusal = "The drafts the gate refused";
    expect(s.of(TASK_ADMISSION).map(({ outcome }) => outcome)).toContain("refused");
    expect(s.sent[0]).not.toContain(refusal);
    const wake = s.of(CALLED).find(({ text }) => isString(text) && text.includes("The host asks for more"));
    expect(wake).toBeDefined();
    expect(JSON.stringify(wake)).not.toContain(refusal);
    const next = seat("write", [finish, finish]);
    await examine({ ...next.request, log: s.log, id: "x-3" });
    expect(next.sent[0]).toContain(refusal);
    expect(next.sent[0]).toContain("x-1-001 (fixture)");
  });

  it("ends where it crashed, and the next session opens afresh from the log", async () => {
    const s = seat("write", [propose(2), failed("You've hit your session limit")]);
    const examined = await examine({
      ...s.request,
      wanted: 1,
      rest: async () => ({ ...s.request, id: "x-2", wanted: 1 }),
    });
    expect(examined).toMatchObject({ ended: "crashed" });
    expect(s.of("exam.finished").map(({ session, ended }) => [session, ended])).toEqual([
      ["x-1", "supplied"],
      ["x-2", "crashed"],
    ]);
    const next = seat("write", [finish, finish]);
    const tasks = [...writtenTasks(read(s.log)), ...s.request.tasks];
    await examine({ ...next.request, log: s.log, id: "x-3", tasks });
    expect(next.sent[0]).toContain("x-1-001 (fixture)");
  });

  it("honours a later ask's own kill signal when waking a resting conversation", async () => {
    const firstKill = new AbortController();
    const secondKill = new AbortController();
    const s = seat("write", [propose(2), propose(3), finish]);
    const examined = await examine({
      ...s.request,
      kill: firstKill.signal,
      wanted: 1,
      rest: async () => {
        secondKill.abort();
        return { ...s.request, id: "x-2", wanted: 1, kill: secondKill.signal };
      },
    });
    expect(examined.ended).toBe("killed");
    expect(s.of("exam.finished").map(({ session, ended }) => [session, ended])).toEqual([
      ["x-1", "supplied"],
      ["x-2", "killed"],
    ]);
  });

  it("persists the read_opening cue after compaction until read_opening runs and skips trailing calls on a new ask", async () => {
    const multiSupplyThenTrailing = fauxAssistantMessage(
      [fauxToolCall(PROPOSE, { tasks: [instance(3)] }), fauxToolCall(PROPOSE, { tasks: [instance(4)] })],
      { stopReason: "toolUse" },
    );
    const reread = call("read_opening", {});
    const s = seat("write", [propose(2), propose(5), reread, multiSupplyThenTrailing, finish, finish]);
    const baseModels = s.request.models();
    // SAFETY: the inherited instance supplies every method; streamSimple alone attaches compaction diagnostics on turn 1.
    const compactedModels = Object.create(baseModels) as typeof baseModels;
    let firstTurn = true;
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
    const asks: Ask[] = [{ ...s.request, id: "x-2", wanted: 2, models: () => compactedModels }];
    await examine({
      ...s.request,
      models: () => compactedModels,
      wanted: 3,
      rest: async () => asks.shift() ?? null,
    });
    const texts = s.of(CALLED).map(({ text }) => (isString(text) ? text : ""));
    const cue = "Context compacted; read_opening holds the ask's opening record and limits.";
    expect(texts[0]).toContain(cue);
    // Cue persists on the second turn because read_opening has not run yet.
    expect(texts[1]).toContain(cue);
    expect(texts[2]).not.toContain(cue);
    expect(texts[3]).not.toContain(cue);
    expect(texts[4]).toContain("The previous ask ended and the host moved to a new ask");
  });

  it("skips trailing calls in a multi-tool turn when rest closes the conversation", async () => {
    const multiSupplyThenTrailing = fauxAssistantMessage(
      [fauxToolCall(PROPOSE, { tasks: [instance(2)] }), fauxToolCall(PROPOSE, { tasks: [instance(3)] })],
      { stopReason: "toolUse" },
    );
    const s = seat("write", [multiSupplyThenTrailing]);
    const examined = await examine({
      ...s.request,
      wanted: 1,
      rest: async () => null,
    });
    expect(examined.ended).toBe("supplied");
    expect(examined.held).toHaveLength(1);
    const texts = s.of(CALLED).map(({ text }) => (isString(text) ? text : ""));
    expect(texts[1]).toContain("The previous ask ended and the session is closing.");
  });
});
