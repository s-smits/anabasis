// The Examiner's one session, `examine`, in its two modes on the faux provider: what both modes
// share (an id, a wall, a shell, an ending, a bill), what a drafting session that puts one whole
// draft is told, what a writing session's gate and tools hold, and what a task's author hears of it,
// including incomplete gates carried to a later session from the log alone.
// Admission queued at the host leaves at the session's wall and durably refuses each draft
// unmeasured, preserving earlier usable readings without starting another solve.
// Gate settlement pauses author time; background probes, cancellation and resumed work retain their limits.
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  createAssistantMessageEventStream,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { draftOf } from "../src/examiner/draft.ts";
import { flying } from "../src/campaign/opening.ts";
import { heard, measuredGate } from "../src/examiner/record.ts";
import { examine } from "../src/examiner/session.ts";
import { examinerDirs, inExaminerWall } from "../src/examiner/shell.ts";
import { measured as measureGate, writing } from "../src/examiner/write.ts";
import { conditionId } from "../src/kernel/condition.ts";
import { writtenTasks } from "../src/kernel/history.ts";
import { append, read } from "../src/kernel/log.ts";
import { poolOf } from "../src/kernel/reports.ts";
import { billedAll, billedParts } from "../src/kernel/trace.ts";
import { Cancellation, type Ending } from "../src/kernel/solve.ts";
import { ranUnder, solvesIn } from "../src/kernel/solves.ts";
import { type TaskPackage, taskSets, taskStates, taskVersion } from "../src/kernel/task.ts";
import type { Verdict, Verifier } from "../src/kernel/verify.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { dirname, join } from "../src/meta/path.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { asError } from "../src/meta/runtime-values.ts";
import { referee } from "../src/referee/referee.ts";
import { probing } from "../tools/d1b/examine.ts";
import { gated as hostGated, type Host } from "../tools/d2/host.ts";
import type { Campaign, Seated } from "../tools/d2/round.ts";
import { settingAsked } from "../tools/d2/setting.ts";
import {
  bash,
  call,
  condition,
  EXAMPLE,
  failed,
  finish,
  instance,
  invoke,
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
const TRY = "try_task";
const GATE = "task.gate";
const PROPOSED = "task.proposed";
const TASK_STATE = "task.state";
const EXAM_FINISHED = "exam.finished";
const STARTED = "solve.started";
const FINISHED = "solve.finished";
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

/** A collection whose output tokens alone bill `cost` dollars at the model's frozen price. */
function billing(models: ReturnType<ReturnType<typeof seat>["request"]["models"]>, cost: number) {
  // SAFETY: the inherited instance supplies every method; streamSimple alone is replaced.
  const metered = Object.create(models) as typeof models;
  metered.streamSimple = (...asked: Parameters<typeof models.streamSimple>) => {
    const streamed = createAssistantMessageEventStream();
    void (async () => {
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
  it("records and bills its first turn before its draft reader or admission probe runs", async () => {
    for (const mode of MODES) {
      const put = mode === "draft" ? PUT.draft : call(TRY, { tasks: [instance(7)] });
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
              probe: async () => {
                record();
                return PASS;
              },
            };
      await examine(request);
      expect(observed).toHaveLength(1);
      expect(observed[0]?.turn).toBe(1);
      expect(observed[0]?.billed).toBeGreaterThan(0);
    }
  });

  it("ends at finish, or at its turns, its wall, a kill, a failed turn or a spent budget, and its result and last event say which", async () => {
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
      // What it billed is in its last event, and so in the campaign's total.
      expect(billedAll(read(finished.log))).toBeGreaterThan(before);
      // Without a wall it is given no shell.
      expect(finished.sent[0]).not.toContain('{"name":"bash"');
      expect(finished.sent[0]).not.toContain("Nothing in your home enters the exam");

      // A put that does not end the session: a draft with a fault, one task of many.
      const turned = seat(mode, [PUT[mode], finish]);
      const { limits } = turned.request;
      const faulted = {
        ...turned.request,
        reading: async () => ["a fault"],
        limits: { ...limits, turns: 1 },
      };
      expect(await examine(faulted)).toMatchObject({ ended: "turns", puts: 1 });
      expect(turned.of(`${KIND[mode]}.finished`)).toMatchObject([{ ended: "turns", turns: 1, crash: null }]);

      // The faux provider cannot be cut short, so a late reply ends the session at its wall, and no crash.
      const slow: FauxResponseStep = () => new Promise((settle) => setTimeout(() => settle(finish), 600));
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

      // A budget with nothing over its reserve: the first turn's bill takes it under, and no second
      // turn is asked for.
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
        // The hostile cases: the repository's own file, and a write beside it.
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
      // It is told what the shell is and how the exam is entered, and nothing about what to do with it.
      const told = s.sent[0] ?? "";
      expect(told).toContain("but no repository or private data");
      expect(told).toMatch(/It has (no )?network access: a package index (was|could not be) reached/);
      expect(told).toContain(`Nothing in your home enters the exam: ${ENTERS[mode]}.`);
    }
  });

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
});

describe("the home a wall keeps for a campaign's writing sessions", () => {
  /** A wall's home: run once with `seeded` files kept and the reference harness laid, under a
   *  session that writes `wrote` there and ends as `ended` with `running` commands. */
  async function sat(ended: string, running: number) {
    const s = seat("write", []);
    const keep = join(dirname(s.log), "examiner-home");
    const reference = join(dirname(s.log), "kept-reference");
    mkdirSync(join(reference, "agent"), { recursive: true });
    writeFileSync(join(reference, "agent", "BUILT_AGENTS.md"), "# Guide\n");
    mkdirSync(keep);
    writeFileSync(join(keep, "kept.txt"), "kept\n");
    const found = await inExaminerWall(s.request, { ...WALL, keep, reference }, async ({ shell }) => {
      const { home } = shell.dirs;
      const seen = readdirSync(home).sort();
      writeFileSync(join(home, "wrote.txt"), "wrote\n");
      append(s.log, EXAM_FINISHED, { session: s.request.id, ended, running });
      return seen;
    });
    return { found, kept: readdirSync(keep).sort() };
  }

  it("seeds the home with what it kept and the reference harness, and keeps the home after, without the harness", async () => {
    expect(await sat("finished", 0)).toEqual({
      found: ["kept.txt", "reference-harness"],
      kept: ["kept.txt", "wrote.txt"],
    });
    // A failed model request leaves the home as its last command left it, and it is kept.
    expect((await sat("crashed", 0)).kept).toEqual(["kept.txt", "wrote.txt"]);
  });

  it("lays the reference's programs as files and leaves every other link in it a link", async () => {
    const s = seat("write", []);
    const states = join(dirname(s.log), "states");
    const reference = join(states, "kept-reference");
    mkdirSync(join(reference, "agent"), { recursive: true });
    mkdirSync(join(states, "tree-1", "bin"), { recursive: true });
    writeFileSync(join(states, "tree-1", "bin", "engine"), "#!/bin/sh\necho engine\n");
    symlinkSync(join("..", "tree-1"), join(reference, ".toolchain"));
    // A link a Builder left in its harness, to a file the host reads and no seat may: followed by
    // the host's copy, its bytes would be laid in the Examiner's home.
    const outside = join(dirname(s.log), "host-only.txt");
    writeFileSync(outside, "host-only\n");
    symlinkSync(outside, join(reference, "agent", "notes"));
    const laid = await inExaminerWall(s.request, { ...WALL, reference }, async ({ shell }) => {
      const copy = join(shell.dirs.home, "reference-harness");
      append(s.log, EXAM_FINISHED, { session: s.request.id, ended: "finished", running: 0 });
      return {
        engine: readFileSync(join(copy, ".toolchain", "bin", "engine"), "utf8"),
        tree: lstatSync(join(copy, ".toolchain")).isSymbolicLink(),
        notes: lstatSync(join(copy, "agent", "notes")).isSymbolicLink(),
      };
    });
    expect(laid).toEqual({ engine: "#!/bin/sh\necho engine\n", tree: false, notes: true });
  });

  it("keeps nothing of a home whose session crashed with a command running", async () => {
    expect((await sat("crashed", 1)).kept).toEqual(["kept.txt"]);
  });

  it("carries a writing session's home into the next, whole, and lays no harness in a drafting session's", async () => {
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
    const reference = join(dirname(s.log), "kept-reference");
    mkdirSync(join(reference, "agent"), { recursive: true });
    await examine(s.request, { ...WALL, keep, reference });
    expect(s.of("exam.started")).toMatchObject([{ referenceHome: true }]);
    expect(s.sent[0]).toContain("A copy of the reference harness is in your home under reference-harness/");
    // Off, the next session opens on what the last one wrote and on no reference.
    await examine({ ...s.request, id: "x-2" }, { ...WALL, keep });
    expect(s.sent.at(-1)).toContain(
      "You never see the solver: not its tools, its guide, its answers or its mistakes.",
    );
    expect(s.of(CALLED).filter(({ tool }) => tool === "bash")[1]?.text).toBe("half.txt");
    expect(readdirSync(keep)).toEqual(["half.txt"]);

    const drafted = seat("draft", [bash("ls"), PUT.draft, finish]);
    await examine(drafted.request, { ...WALL, keep, reference: keep });
    expect(drafted.of("draft.call")[0]?.text).toBe("");
    expect(readdirSync(keep)).toEqual(["half.txt"]);
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

/** A reference solve launcher for `try_task` whose every solve passes, measuring what `measure`
 *  says of the task and the solve's place among the task's own. */
function measuredProbe(
  log: string,
  measure: (task: TaskPackage, nth: number) => number | undefined,
  turns?: number,
  seconds?: number,
) {
  const solved: string[] = [];
  return async (task: TaskPackage, session: string) => {
    const objective = measure(task, solved.filter((each) => each === taskVersion(task)).length);
    solved.push(taskVersion(task));
    const solve = `s-${String(solved.length)}`;
    const ran = condition(taskVersion(task), "h-reference");
    append(log, "condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    append(log, STARTED, { solve, condition: conditionId(ran), comparison: session });
    append(log, "verdict", { solve, answer: GOOD, kind: "pass", objective: objective ?? null });
    append(log, FINISHED, {
      solve,
      ending: PASS,
      billed: 0,
      ...keyIfDefined("turns", turns),
      ...keyIfDefined("seconds", seconds),
    });
    return PASS;
  };
}

/** The admission boundary with a scratch kept starter and a scripted solving seat. Only the
 *  log, kept states and solver identity are read from the campaign when no reviewer is named. */
async function admission(s: ReturnType<typeof seat<"write">>, seated: Seated) {
  // SAFETY: probing reads only these campaign fields with a supplied seat and no reviewer.
  const campaign = {
    log: s.log,
    limits: settingAsked({}, null).named.limits,
    states: join(dirname(s.log), "states"),
    test: { model: s.request.model, effort: s.request.effort },
  } as Campaign;
  return await probing(campaign, seated, settingAsked({}, null), { "reviewer-effort": "high" });
}

/** What a gate told of each draft: its id, held out or refused, and how many of the reference
 *  harness's solves were valid where it read any. The facts, without the sentence around them. */
function gateSaid(text: JsonValue | undefined): (string | number | null)[][] {
  return (isString(text) ? text : "").split("\n").flatMap((line) => {
    const said = /^(\S+): (held out|refused)(?:.*? validly in (\d+) of)?/.exec(line);
    if (said === null) return line.endsWith("put to the gate in this session.") ? [] : [["", "", null]];
    const [, id = "", outcome = "", valid] = said;
    return [[id, outcome, valid === undefined ? null : Number(valid)]];
  });
}

/** What the gate said of each draft over every tool result of the session, by task id: a
 *  `try_task` call returns before its gate does (`putAside`, `write.ts`), so its lines come with
 *  later results, in the order the gate finished them. */
function gateHeard(called: readonly Record<string, JsonValue>[]): (string | number | null)[][] {
  return called
    .flatMap(({ text: said }) => gateSaid(said))
    .filter(([id]) => id !== "")
    .toSorted(([one], [other]) => String(one).localeCompare(String(other)));
}

/** Each of `versions` as `of` holds it: a call's drafts are gated together, and each is logged as
 *  its solves end, so a session's records of them are in no fixed order. */
function inOrder<T extends JsonValue>(
  of: readonly T[],
  versions: readonly string[],
  key = (each: T) => asRecord(each)?.version,
): T[] {
  return versions.flatMap((version) => of.filter((each) => key(each) === version));
}

describe("a session that writes tasks", () => {
  for (const gate of [TRY, "propose_tasks"]) {
    it(`holds the same task version by checked reference as by content through ${gate}`, async () => {
      const results: JsonObject[][] = [];
      for (const byReference of [false, true]) {
        const s = seat("write", []);
        const mode = writing(
          {
            ...s.request,
            verify,
            probe: gate === TRY ? async () => REJECTED : null,
          },
          undefined,
          "unseen",
        );
        const checked = await invoke(mode.tools.find(({ name }) => name === "try_answer")!, "check", {
          ...instance(7),
          hidden: JSON.stringify({ seed: 1 }),
          answer: GOOD,
        });
        const said = checked.output?.[0];
        const reference =
          said?.type === "text" ? /Instance reference: (\w+)\./u.exec(said.text)?.[1] : undefined;
        expect(reference).toBeDefined();
        const put = mode.tools.find(({ name }) => name === gate)!;
        const unknown = await invoke(put, "unknown", { tasks: [{ reference: "missing" }] });
        expect(unknown.output).toEqual([
          {
            type: "text",
            text: expect.stringContaining(`Known references: ${String(reference)}`),
          },
        ]);
        expect(mode.result().puts).toBe(0);
        expect(s.of(PROPOSED)).toHaveLength(0);
        await invoke(put, "propose", {
          tasks: [byReference ? { reference: String(reference) } : instance(7)],
        });
        await mode.settle(true);
        expect(mode.result().held).toHaveLength(1);
        expect(s.of("task.feasible")).toMatchObject([{ answer: GOOD }]);
        results.push(s.of(PROPOSED));
        // A reference and its full content are one duplicate while held, as while pending.
        await invoke(put, "duplicate", { tasks: [instance(7), { reference: String(reference) }] });
        expect(mode.result().puts).toBe(1);
        const next = writing({ ...s.request, id: "x-2", verify }, undefined, "unseen");
        const expired = await invoke(next.tools[0]!, "expired", {
          tasks: [{ reference: String(reference) }],
        });
        expect(expired.output).toEqual([
          { type: "text", text: expect.stringContaining("Known references: none") },
        ]);
      }
      expect(results[0]).toEqual(results[1]);
    });
  }

  it("serves its opening again on read_opening, for a context that was compacted", async () => {
    const s = seat("write", [call("read_opening", {}), finish, finish]);
    await examine(s.request);
    const served = s.of(CALLED).find(({ tool }) => tool === "read_opening");
    // The text served is the opening the session's first turn read, whole.
    expect(isString(served?.text) && served.text.length > 0).toBe(true);
    expect(s.sent[0]).toContain(JSON.stringify(served?.text).slice(1, -1));
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
      // The pack's task is listed with its outcome, as every task of the campaign is.
      "- e-1 (fixture): not yet compared; no answer on record",
      "This session has 10 minutes, 12 turns and 4 drafts to put to the gate.",
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
    expect(s.of(EXAM_FINISHED)).toMatchObject([{ proposed: 0, held: [], refused: [] }]);

    // The budget every solve is held to, as a fact and no target; and the next session opens with
    // what the last one said at its finish, in its own words.
    const next = seat("write", [finish, finish]);
    await examine({ ...next.request, id: "x-2", log: s.log, budget: { modelTurns: 3, minutes: 8 } });
    expect(next.sent[0]).toContain(
      "Every solve of a task is held to 3 turns of the solver's own, a turn being one reply with the tool calls in it, and 8 minutes. This is the budget",
    );
    expect(next.sent[0]).toContain("it is no target of yours");
    expect(next.sent[0]).toContain(String.raw`said at its finish, in its own words:\n${NOTE}`);
    // A note written under a reference since replaced is not handed on: it is about the tasks
    // that reference failed (16 October).
    append(s.log, "harness.promoted", { harness: "h1" });
    const after = seat("write", [finish, finish]);
    await examine({ ...after.request, id: "x-3", log: s.log });
    expect(after.sent[0]).not.toContain("said at its finish");
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
    expect(s.of(GATE)).toEqual([
      { version: held, gate: 1, outcome: "passed", proved: false },
      { version: refused, gate: 1, outcome: "refused", reason: "no inputs", proved: false },
    ]);
    expect(taskSets(read(s.log))).toMatchObject({ held: [held], released: [] });
    expect(taskStates(read(s.log)).get(refused)).toBe("refused");
    expect(s.of(STARTED)).toEqual([]);
    // The instance is in the log whole, so a later solve of it needs nothing else.
    expect(s.of(PROPOSED)[0]).toMatchObject({
      version: held,
      taskId: "x-1-001",
      session: "x-1",
      task: { family: "fixture", publicInput: { base: 7 }, hidden: { seed: 1 } },
    });
    expect(writtenTasks(read(s.log)).map(({ taskId }) => taskId)).toEqual(["x-1-001", "x-1-002"]);
    expect(s.of(EXAM_FINISHED)).toMatchObject([{ proposed: 2, held: [held], refused: [refused] }]);
  });

  it("takes no instance past its puts, nor one an earlier session wrote, and keeps what it held when its turn fails", async () => {
    const spent = seat("write", [propose(1, 2, 3), propose(4, 5), propose(6), finish, finish]);
    await examine(spent.request);
    expect(spent.sent[2]).toContain("An instance was not taken: this session can propose no further task.");
    expect(spent.sent[3]).toContain("This session can propose no further task. Call finish.");
    expect(spent.of(PROPOSED)).toHaveLength(4);
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
    append(cut.log, PROPOSED, {
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
      append(cut.log, PROPOSED, {
        version,
        taskId,
        session: "x-1",
        task: { taskId, family: "fixture", publicInput: { base }, hidden: { seed: 1 } },
      });
      append(cut.log, GATE, {
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
    // The first finish is declined with the need and without a count, which an author writes towards.
    expect(short.of(CALLED)[1]?.text).not.toMatch(/\d/);
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
      expect.stringContaining("Every applicable check passed"),
      expect.stringContaining("Refused by check-product"),
    ]);
    const proved = [s.versionOf("x-1-001", 7), s.versionOf("x-1-003", 9), s.versionOf("x-1-004", 10)];
    expect(s.of("task.feasible")).toEqual(
      proved.map((version) => ({ version, session: "x-1", answer: GOOD })),
    );
    expect(heard(read(s.log), writtenTasks(read(s.log))).lines[0]).toBe(
      "x-1-001 (fixture): not yet compared; an answer on record",
    );
  });

  it("keeps the objective's measure of its author's valid answer where the contract declares one, and none where it declares none", async () => {
    // A try, its task, then two tries of the held task: the measure each pass took is kept.
    const steps = [tried(7), propose(7), tried(7), tried(7, { answer: "1", unit: "N" }), finish, finish];
    // The provisional try, the recheck under the task's final id, the later try.
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
    // The verifier measured, but the contract declares no objective: the record is the version.
    const undeclared = await run(false);
    expect(undeclared.of("task.feasible")).toEqual([{ version, session: "x-1", answer: GOOD }]);
    // The Examiner is told each measure the record keeps, and none where none is kept (19 October).
    const told = (s: typeof declared) => s.of(CALLED).flatMap(({ text }) => (isString(text) ? [text] : []));
    expect(told(declared).filter((line) => line.includes("By the objective it measures"))).toHaveLength(2);
    expect(told(undeclared).join("\n")).not.toContain("By the objective");
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
        append(s.log, PROPOSED, { version: packed, taskId: EXAMPLE.taskId });
        append(s.log, GATE, { version: packed, gate: 1, outcome: "passed" });
        if (order.state !== "held") append(s.log, TASK_STATE, { version: packed, state: order.state });
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
      const proved = order.proved.map((id) => ({
        version: versions[id],
        session: "x-1",
        answer: id === "e-1" ? { answer: "12", unit: "N" } : GOOD,
      }));
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
      append(s.log, PROPOSED, { version, taskId: version });
      append(s.log, GATE, { version, gate: 1, ...gate });
    }
    const examined = await examine({ ...s.request, verify });
    expect(gateSaid(s.of(CALLED)[2]?.text)).toEqual([
      ["x-1-001", "refused", null],
      ["x-1-002", "refused", null],
      ["x-1-003", "held out", null],
    ]);
    expect(examined.held).toEqual([s.versionOf("x-1-003", 2)]);
  });

  it("holds out a task the reference harness answered in none of its solves where its author's answer passes on it, every one of them", async () => {
    // Bases 4, 8, 9, 7 and 10 are answered in none of three solves; 7 alone has no author's answer,
    // and 5, answered in every solve, has one. Until 16 October the first of every three proved
    // ones went to the ladder.
    const s = seat("write", [
      tried(4),
      tried(8),
      tried(9),
      tried(5),
      tried(10),
      call(TRY, { tasks: [4, 8, 9, 7, 5, 10].map(instance) }),
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
    // Every proved draft the reference never answered is held out. One without a proof, and one
    // answered every time, are refused.
    const proposed = [first, second, third, unwitnessed, solved, fourth];
    expect(inOrder(examined.held, proposed, String)).toEqual([first, second, third, fourth]);
    expect(inOrder(examined.refused, proposed, String)).toEqual([unwitnessed, solved]);
    expect(inOrder(taskSets(read(s.log)).held, proposed, String)).toEqual([first, second, third, fourth]);
    const gates = inOrder(s.of(GATE), proposed);
    expect(gates.map(({ outcome }) => outcome)).toEqual([
      "passed",
      "passed",
      "passed",
      "refused",
      "refused",
      "passed",
    ]);
    expect(gates.map(({ reference }) => asRecord(reference)?.valid)).toEqual([0, 0, 0, 0, 3, 0]);
    // Each proved one is on record as feasible, by the author's answer checked under its own id.
    expect(inOrder(s.of("task.feasible"), proposed)).toEqual(
      [first, second, third, fourth].map((version) => ({ version, session: "x-1", answer: GOOD })),
    );
    expect(inOrder(poolOf(read(s.log)).scorable, proposed, String)).toEqual([first, second, third, fourth]);
    // The Examiner hears the count of a held task's valid solves; the rule is the system prompt's.
    expect(gateHeard(s.of(CALLED))).toEqual([
      ["x-1-001", "held out", 0],
      ["x-1-002", "held out", 0],
      ["x-1-003", "held out", 0],
      ["x-1-004", "refused", 0],
      ["x-1-005", "refused", 3],
      ["x-1-006", "held out", 0],
    ]);
  });

  it("solves a draft once alone, and starts no other solve where that first leaves the reference room", async () => {
    // Base 4 fails beside its author's passing answer: room at the first solve, so no second
    // starts. Base 5 passes every time and has no objective: its second and third run together,
    // and it is refused on three.
    const seeded = new Map<number, readonly Ending[]>([
      [4, [REJECTED, REJECTED, REJECTED]],
      [5, [PASS, PASS, PASS]],
    ]);
    const s = seat("write", [tried(4), call(TRY, { tasks: [4, 5].map(instance) }), finish, finish]);
    const asked: number[] = [];
    const running = new Map<number, number>();
    const together = new Map<number, number>();
    const probe = async (task: TaskPackage) => {
      const base = Number(asRecord(task.publicInput)?.base);
      const ending = seeded.get(base)?.[asked.filter((each) => each === base).length] ?? PASS;
      asked.push(base);
      running.set(base, (running.get(base) ?? 0) + 1);
      together.set(base, Math.max(together.get(base) ?? 0, running.get(base) ?? 0));
      await Promise.resolve();
      running.set(base, (running.get(base) ?? 0) - 1);
      return ending;
    };
    const examined = await examine({ ...s.request, verify, limits: { ...s.request.limits, puts: 2 }, probe });
    const versions = [4, 5].map((base, nth) => s.versionOf(`x-1-00${String(nth + 1)}`, base));
    expect(examined.held).toEqual(versions.slice(0, 1));
    expect([4, 5].map((base) => asked.filter((each) => each === base).length)).toEqual([1, 3]);
    expect([4, 5].map((base) => together.get(base))).toEqual([1, 2]);
    expect(inOrder(s.of(GATE), versions).map(({ reference }) => reference)).toMatchObject([
      { valid: 0, solves: 1, ran: 1 },
      { valid: 3, solves: 3, ran: 3 },
    ]);
    // Each is told of the solves that ran, and no more.
    expect(
      s
        .of(CALLED)
        .flatMap(({ text: said }) => (isString(said) ? said.split("\n") : []))
        .filter((line) => / validly in /.test(line))
        .map((line) => / validly in (\d+ of \d+) solves/.exec(line)?.[1]),
    ).toEqual(expect.arrayContaining(["0 of 1", "3 of 3"]));
  });

  it("runs a draft's other two solves together where its first leaves no room, holds it at the first of them that does, and cancels the other", async () => {
    // Base 2 fails first with no answer of its author's: no room. Its second and third start
    // together; one passes, which leaves room, and the other, still running, is cancelled as the
    // launcher cancels a solve, ending killed by its caller and counted nowhere.
    const s = seat("write", [call(TRY, { tasks: [instance(2)] }), finish, finish]);
    const both = Promise.withResolvers<void>();
    const reasons: unknown[] = [];
    let asked = 0;
    const probe = async (_task: TaskPackage, _session: string, kill: AbortSignal): Promise<Ending> => {
      asked += 1;
      const nth = asked;
      if (nth === 1) return REJECTED;
      if (nth === 3) both.resolve();
      await both.promise;
      if (nth === 2) return PASS;
      if (!kill.aborted) {
        await new Promise((settle) => kill.addEventListener("abort", settle, { once: true }));
      }
      const reason: unknown = kill.reason;
      reasons.push(reason);
      return {
        outcome: "non-result",
        kind: "killed",
        reason: "the solve was cancelled",
        cancelledBy: reason instanceof Cancellation ? reason.cancelledBy : "caller",
      };
    };
    const examined = await examine({ ...s.request, verify, limits: { ...s.request.limits, puts: 1 }, probe });
    expect(examined.held).toEqual([s.versionOf("x-1-001", 2)]);
    expect(asked).toBe(3);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBeInstanceOf(Cancellation);
    expect(reasons[0]).toMatchObject({ cancelledBy: "caller" });
    expect(s.of(GATE)).toMatchObject([{ outcome: "passed", reference: { valid: 1, solves: 2, ran: 2 } }]);
    expect(gateHeard(s.of(CALLED))).toEqual([["x-1-001", "held out", 1]]);
    expect(
      s
        .of(CALLED)
        .flatMap(({ text: said }) => (isString(said) ? said.split("\n") : []))
        .flatMap((line) => / validly in (\d+ of \d+) solves/.exec(line)?.[1] ?? []),
    ).toEqual(["1 of 2"]);
  });

  it("aborts and settles a throwing gate solve's sibling before returning its error", async () => {
    const s = seat("write", []);
    const both = Promise.withResolvers<void>();
    const drain = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const sibling = Promise.withResolvers<void>();
    const error = new Error("gate launcher failed");
    let asked = 0;
    let aborted = false;
    let settled = false;
    let returned = false;
    const probe = async (_task: TaskPackage, _session: string, kill: AbortSignal): Promise<Ending> => {
      asked += 1;
      const nth = asked;
      if (nth === 1) return PASS;
      if (nth === 3) both.resolve();
      await both.promise;
      if (nth === 2) throw error;
      try {
        await new Promise<void>((resolve) => {
          kill.addEventListener(
            "abort",
            () => {
              aborted = true;
              cancelled.resolve();
              resolve();
            },
            { once: true },
          );
          drain.promise.then(resolve).catch(resolve);
        });
        await drain.promise;
        settled = true;
        return PASS;
      } finally {
        sibling.resolve();
      }
    };
    const task = s.request.pack({ ...EXAMPLE, taskId: "throwing-pair" });
    const result = measureGate(
      { ...s.request, probe, planted: new Set() },
      task,
      new AbortController().signal,
      async () => null,
    ).catch((caught: unknown) => {
      returned = true;
      return asError(caught);
    });
    try {
      await Promise.race([cancelled.promise, result]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(asked).toBe(3);
      expect(aborted).toBe(true);
      expect(returned).toBe(false);
      expect(settled).toBe(false);
      drain.resolve();
      expect(await result).toBe(error);
      expect(settled).toBe(true);
    } finally {
      drain.resolve();
      await sibling.promise;
      await result;
    }
  });

  it("tries the third solve once a single reserve is free again", async () => {
    const s = seat("write", []);
    append(s.log, "campaign.opened", { budget: { dollars: 1.5, reserve: 1 } });
    let asked = 0;
    const probe = () =>
      flying(s.log, async () => {
        asked += 1;
        append(s.log, FINISHED, { solve: `reserve-${String(asked)}`, billed: 0.1 });
        return asked === 3 ? REJECTED : PASS;
      });
    const mode = writing({ ...s.request, probe }, undefined, "unseen");
    await invoke(mode.tools[0]!, "put", { tasks: [instance(2)] });
    await mode.settle(true);
    expect(asked).toBe(3);
    expect(mode.result().held).toEqual([s.versionOf("x-1-001", 2)]);
    expect(s.of(GATE)).toMatchObject([{ outcome: "passed", reference: { valid: 2, solves: 3, ran: 3 } }]);
    expect(billedAll(read(s.log))).toBeCloseTo(0.3);
  });

  for (const cancelledBy of ["gate", "session"] as const) {
    it(`keeps a cancelled Referee's bill and excludes its no reading only when cancelled by the ${cancelledBy}`, async () => {
      const s = seat("write", []);
      const review = seat("write", [call("probe_check", { changes: [{ path: "$.answer", value: '"43"' }] })]);
      const reviewing = Promise.withResolvers<void>();
      const stop = new AbortController();
      let checked = 0;
      // SAFETY: probing uses these campaign fields with scripted solving and reviewing seats.
      const campaign = {
        log: s.log,
        states: join(dirname(s.log), "states"),
        test: { model: s.request.model, effort: s.request.effort },
      } as Campaign;
      campaign.reader = () => ({
        model: review.request.model,
        effort: "medium",
        models: review.request.models,
      });
      campaign.reviewers = (reader) => ({
        referee: (solve, task, kill) =>
          referee(
            { ...reader, kill },
            {
              solve,
              task,
              contract: s.request.contract,
              checks: s.program,
              log: s.log,
              verify: async (_task, _answer, signal) => {
                checked += 1;
                if (checked === 1) return { kind: "fail", blocking: ["check-product"] };
                if (signal === undefined) throw new Error("the Referee probe has no signal");
                reviewing.resolve();
                await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
                return { kind: "non-result", reason: "the Referee probe was cancelled" };
              },
            },
          ),
      });
      let asked = 0;
      const endings: Ending[] = [];
      const probe = await probing(
        campaign,
        () => ({
          builder: null,
          setting: "s",
          solve: async (task, _harness, _kill, session) => {
            asked += 1;
            const nth = asked;
            const solve = `review-${String(nth)}`;
            const ran = condition(taskVersion(task), "h-reference");
            append(s.log, "condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
            append(s.log, STARTED, { solve, condition: conditionId(ran), comparison: session ?? "x-1" });
            if (nth === 2) {
              await reviewing.promise;
              if (cancelledBy === "session") stop.abort(new Cancellation("caller"));
            }
            const ending = nth === 3 ? REJECTED : nth === 2 && cancelledBy === "gate" ? WALLED : PASS;
            if (ending.outcome === "pass" || ending.kind === "rejected") {
              append(s.log, "verdict", {
                solve,
                answer: GOOD,
                kind: nth === 3 ? "fail" : "pass",
                blocking: ["check-product"],
              });
            }
            append(s.log, FINISHED, { solve, ending, billed: 0.1 });
            return { solve, ending };
          },
        }),
        settingAsked({}, null),
        { reviewer: "claude/claude-opus-5-5", "reviewer-effort": "high" },
      );
      const mode = writing(
        {
          ...s.request,
          probe: async (...args) => {
            const ending = await probe(...args);
            endings.push(ending);
            return ending;
          },
        },
        undefined,
        "unseen",
        stop.signal,
      );
      await invoke(mode.tools[0]!, "put", { tasks: [instance(2)] });
      await mode.settle(true);
      expect(asked).toBe(3);
      expect(endings).toContainEqual(expect.objectContaining({ outcome: "non-result", kind: "check" }));
      expect(s.of("referee.finding")).toMatchObject([{ ruling: "unclear", walled: false }]);
      const reviewBill = Number(s.of("referee.finding")[0]?.billed);
      expect(reviewBill).toBeGreaterThan(0);
      expect(s.of(GATE)).toMatchObject([
        {
          outcome: cancelledBy === "gate" ? "passed" : "refused",
          reference: {
            valid: cancelledBy === "gate" ? 1 : 2,
            solves: 2,
            ran: cancelledBy === "gate" ? 2 : 3,
          },
        },
      ]);
      expect(asRecord(s.of(GATE)[0]?.reference)?.billed).toBeCloseTo(0.3 + reviewBill);
      expect(mode.heard(true).includes("no reading")).toBe(cancelledBy === "session");
    });
  }

  it("reserves only the next solve of each draft, and stops when that reserve is spent", async () => {
    const s = seat("write", [call(TRY, { tasks: [instance(2)] }), finish, finish]);
    append(s.log, "campaign.opened", { budget: { dollars: 0.5, reserve: 0.5 } });
    let asked = 0;
    const probe = async () => {
      asked += 1;
      append(s.log, FINISHED, { solve: `reserve-${String(asked)}`, billed: 0.5 });
      return PASS;
    };
    // Call the writing owner directly so the model's own budget cannot end the session first.
    const mode = writing({ ...s.request, probe }, undefined, "unseen");
    await invoke(mode.tools[0]!, "put", { tasks: [instance(2)] });
    await mode.settle(true);
    expect(asked).toBe(1);
    expect(mode.result().refused).toEqual([s.versionOf("x-1-001", 2)]);
    expect(s.of(GATE)).toMatchObject([{ outcome: "refused", reference: { solves: 1, ran: 1 } }]);
    expect(s.of(GATE).filter(measuredGate)).toEqual([]);
    // Below one reserve the next draft starts nothing.
    await invoke(mode.tools[0]!, "put-again", { tasks: [instance(3)] });
    await mode.settle(true);
    expect(asked).toBe(1);
    // Two drafts need two reserves. The first solve in flight must not be counted again as ahead.
    const pair = seat("write", []);
    append(pair.log, "campaign.opened", { budget: { dollars: 1, reserve: 0.5 } });
    const release = Promise.withResolvers<void>();
    let together = 0;
    const batch = writing(
      {
        ...pair.request,
        probe: () =>
          flying(pair.log, async () => {
            together += 1;
            await release.promise;
            return PASS;
          }),
      },
      undefined,
      "unseen",
    );
    await invoke(batch.tools[0]!, "batch", { tasks: [instance(2), instance(3)] });
    try {
      expect(together).toBe(2);
    } finally {
      release.resolve();
      await batch.settle(true);
    }
  });

  it("serves a draft of this session by its id once the gate has read it", async () => {
    const s = seat("write", []);
    append(s.log, "exam.started", { session: s.request.id });
    const mode = writing({ ...s.request, probe: async () => PASS }, undefined, "unseen");
    await invoke(mode.tools[0]!, "put", { tasks: [instance(2)] });
    await mode.settle(true);
    const [draft] = writtenTasks(read(s.log));
    if (draft === undefined) throw new Error("the draft was not written");
    expect(mode.result().refused).toEqual([s.versionOf(draft.taskId, 2)]);
    const example = await invoke(mode.tools.find(({ name }) => name === "read_example")!, "own", {
      task: draft.taskId,
    });
    expect(example.output).toEqual([{ type: "text", text: JSON.stringify(draft, null, 2) }]);
  });

  it("keeps a long finish note to its first 700 bytes instead of refusing it", async () => {
    const long = `${"a".repeat(600)}\n${"b".repeat(300)}`;
    const s = seat("write", [call("finish", { note: long }), call("finish", { note: long })]);
    await examine(s.request);
    expect(
      s
        .of(CALLED)
        .filter(({ tool }) => tool === "finish")
        .map(({ isError }) => isError),
    ).toEqual([false, false]);
    const [ended] = s.of(EXAM_FINISHED);
    expect(ended).toMatchObject({
      ended: "finished",
      note: expect.stringMatching(/^a{600}\s*\[…301 bytes omitted\]$/u),
    });
  });

  it("reads a proof that passes after a draft's first reading while it is still at the gate", async () => {
    for (const alreadyProved of [false, true]) {
      const s = seat("write", []);
      append(s.log, "exam.started", { session: s.request.id });
      const first = Promise.withResolvers<void>();
      const later = Promise.withResolvers<void>();
      let asked = 0;
      const measured = measuredProbe(s.log, () => 10);
      const mode = writing(
        {
          ...s.request,
          contract: { ...s.request.contract, objective: { quantity: "mass", direction: "lower" } },
          verify: async (_task, answer) => ({ kind: "pass", objective: Number(asRecord(answer)?.answer) }),
          probe: async (task, session) => {
            asked += 1;
            if (asked === 2) {
              first.resolve();
              await later.promise;
            }
            return alreadyProved ? await measured(task, session) : REJECTED;
          },
        },
        undefined,
        "unseen",
      );
      const put = mode.tools.find(({ name }) => name === TRY)!;
      const answer = mode.tools.find(({ name }) => name === "try_answer")!;
      if (alreadyProved) {
        await invoke(answer, "earlier", { ...instance(7), answer: { ...GOOD, answer: "9.95" } });
      }
      await invoke(put, "put", { tasks: [instance(7)] });
      await first.promise;
      const better = { ...GOOD, answer: "9" };
      await invoke(answer, "proof", { ...instance(7), answer: better });
      later.resolve();
      await mode.settle(true);
      expect(s.of(GATE)).toMatchObject([{ outcome: "passed" }]);
      expect(mode.result().held).toEqual([s.versionOf("x-1-001", 7)]);
      // The third solve ran beside the second and ended first, leaving no room alone.
      expect(asked).toBe(3);
      expect(s.of("task.feasible")).toMatchObject([{ answer: better }]);
    }
  });

  it("takes an unmeasured draft again in the same session and keeps every measured or pending duplicate refused", async () => {
    const s = seat("write", []);
    const release = Promise.withResolvers<void>();
    let asked = 0;
    const mode = writing(
      {
        ...s.request,
        limits: { ...s.request.limits, puts: 8 },
        probe: async () => {
          asked += 1;
          if (asked <= 3) return { outcome: "non-result", kind: "provider", reason: "offline" };
          await release.promise;
          return PASS;
        },
      },
      undefined,
      "unseen",
    );
    const put = mode.tools[0]!;
    await invoke(put, "first", { tasks: [instance(7)] });
    await mode.settle(true);
    await invoke(put, "retry", { tasks: [instance(7), instance(7)] });
    expect(mode.result().puts).toBe(2);
    release.resolve();
    await mode.settle(true);
    await invoke(put, "measured", { tasks: [instance(7)] });
    expect(mode.result().puts).toBe(2);
    expect(s.of(GATE).map(measuredGate)).toEqual([false, true]);
    // A held draft also stays a duplicate.
    const proved = writing(
      { ...s.request, id: "x-2", verify, probe: async () => REJECTED },
      undefined,
      "unseen",
    );
    await invoke(proved.tools.find(({ name }) => name === "try_answer")!, "proof", {
      ...instance(8),
      answer: GOOD,
    });
    await invoke(proved.tools[0]!, "held", { tasks: [instance(8)] });
    await proved.settle(true);
    await invoke(proved.tools[0]!, "duplicate", { tasks: [instance(8)] });
    expect(proved.result().held).toHaveLength(1);
    expect(proved.result().puts).toBe(1);
  });

  for (const interruptedReview of [false, true]) {
    for (const promoted of [false, true]) {
      it(`hands an interrupted ${interruptedReview ? "review" : "provider solve"} to the next author ${promoted ? "across a promotion" : "under the same reference"}`, async () => {
        const s = seat("write", [call("read_opening", {}), finish, finish]);
        const stop = new AbortController();
        const waiting = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let asked = 0;
        const probe = async (task: TaskPackage, session: string): Promise<Ending> => {
          asked += 1;
          const nth = asked;
          const solve = `handoff-${String(nth)}`;
          const ran = condition(taskVersion(task), "h-reference");
          append(s.log, "condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
          append(s.log, STARTED, { solve, condition: conditionId(ran), comparison: session });
          if (nth === 2) {
            waiting.resolve();
            await release.promise;
          }
          const ending: Ending =
            nth === 2 ? { outcome: "non-result", kind: "provider", reason: "provider-private-canary" } : PASS;
          if (nth !== 2 || interruptedReview) {
            append(s.log, "verdict", {
              solve,
              answer: { answer: SOLVER },
              kind: nth === 2 ? "fail" : "pass",
            });
          }
          if (nth === 2 && interruptedReview) {
            append(s.log, "referee.finding", {
              solve,
              ruling: null,
              reason: "review-private-canary",
              probeRows: [{ answer: SOLVER }],
            });
          }
          append(s.log, FINISHED, { solve, ending, billed: 0 });
          return ending;
        };
        append(s.log, "exam.started", { session: "x-1" });
        const first = writing({ ...s.request, probe }, undefined, "unseen", stop.signal);
        await invoke(first.tools[0]!, "first", { tasks: [instance(7)] });
        await waiting.promise;
        stop.abort();
        release.resolve();
        await first.settle(true);
        append(s.log, EXAM_FINISHED, { session: "x-1", ended: "wall" });
        expect(s.of(CALLED)).toEqual([]);
        // The third, beside the interrupted second, passed before the stop.
        expect(s.of(GATE)).toMatchObject([
          { outcome: "refused", reference: { valid: 2, solves: 2, ran: 3 } },
        ]);
        if (promoted) {
          append(s.log, "harness.promoted", { harness: "h-next", from: "h-reference", rests: [] });
        }
        const events = read(s.log);
        const tasks = writtenTasks(events).filter(
          (task) => taskStates(events).get(taskVersion(s.request.pack(task))) !== "refused",
        );
        expect(tasks).toEqual([]);
        const request = { ...s.request, id: "x-2", tasks, probe };
        const next = writing(request, undefined, "unseen");
        const record = heard(events, tasks);
        expect(record.interrupted).toHaveLength(1);
        expect(record.interrupted[0]).toContain("x-1-001 (fixture)");
        expect(record.interrupted[0]).toContain("not measured");
        expect(record.refused).toEqual([]);
        if (promoted) {
          expect(record.interrupted[0]).toContain("replaced reference");
          expect(record.interrupted[0]).not.toMatch(/1 of|2 attempted|turn|gap|%/u);
        } else {
          expect(record.interrupted[0]).toContain("2 of 2 measured solves valid; 3 attempted");
          const reason = s.of(GATE)[0]?.reason;
          if (!isString(reason)) throw new Error("gate reason missing");
          expect(record.interrupted[0]).toContain(reason);
        }
        expect(next.opening).toContain(record.interrupted[0]!);
        for (const secret of [SOLVER, "review-private-canary", "provider-private-canary"]) {
          expect(next.opening).not.toContain(secret);
        }
        const original = writtenTasks(events)[0]!;
        const recovered = await invoke(next.tools.find(({ name }) => name === "read_example")!, "recover", {
          task: original.taskId,
        });
        expect(recovered.output).toEqual([{ type: "text", text: JSON.stringify(original, null, 2) }]);
        expect(writing(request, undefined, "unseen").opening).toBe(next.opening);
        await examine(request);
        expect(s.of(CALLED).find(({ tool }) => tool === "read_opening")?.text).toBe(next.opening);
        await invoke(next.tools[0]!, "retry", { tasks: [instance(7)] });
        await next.settle(true);
        expect(asked).toBe(6);
        expect(s.of(GATE)).toMatchObject([
          { outcome: "refused", reference: { valid: 2, solves: 2, ran: 3 } },
          { outcome: "refused", reference: { valid: 3, solves: 3, ran: 3 } },
        ]);
        expect(next.result().held).toEqual([]);
        expect(s.of("referee.finding").map(({ ruling }) => ruling)).toEqual(interruptedReview ? [null] : []);
        const again = writing({ ...request, id: "x-3" }, undefined, "unseen");
        await invoke(again.tools[0]!, "duplicate", { tasks: [instance(7)] });
        expect(again.result().puts).toBe(0);
        expect(asked).toBe(6);
      });
    }
  }

  it("caps a long example without an environment and tells its full size", async () => {
    const s = seat("write", [call("read_example", { task: "x-1/long" }), finish, finish]);
    const long = {
      ...EXAMPLE,
      taskId: "x-1/long",
      publicInput: { values: Array.from({ length: 9_000 }, (_, at) => at) },
    };
    await examine({ ...s.request, tasks: [EXAMPLE, long] });
    const shown = s.of(CALLED).find(({ tool }) => tool === "read_example")?.text;
    expect(isString(shown)).toBe(true);
    if (!isString(shown)) throw new Error("no example text");
    expect(shown).toContain(`of ${String(Buffer.byteLength(JSON.stringify(long, null, 2)))} bytes.`);
    expect(shown).not.toContain("The full file is at");
    expect(Buffer.byteLength(shown)).toBeLessThanOrEqual(50 * 1024);
    expect(shown.split("\n").length).toBeLessThanOrEqual(2_000);
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
    const s = seat("write", [call(TRY, { tasks: [2, 3, 4, 5, 6, 7].map(instance) }), finish, finish]);
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
      append(s.log, STARTED, { solve, condition: conditionId(ran), comparison: session });
      append(s.log, "verdict", { solve, answer: { answer: SOLVER, unit: "N" } });
      append(s.log, FINISHED, { solve, ending, billed: 0.5 });
      return ending;
    };
    const examined = await examine({ ...s.request, limits: { ...s.request.limits, puts: 6 }, probe });
    const versions = [2, 3, 4, 5, 6, 7].map((base, nth) => s.versionOf(`x-1-00${String(nth + 1)}`, base));
    const held = versions.filter((_version, nth) => [0, 1, 4].includes(nth));
    expect(examined.ended).toBe("finished");
    expect(inOrder(examined.held, versions, String)).toEqual(held);
    expect(inOrder(examined.refused, versions, String)).toEqual(
      versions.filter((_version, nth) => ![0, 1, 4].includes(nth)),
    );
    expect(inOrder(taskSets(read(s.log)).held, versions, String)).toEqual(held);
    expect(gateHeard(s.of(CALLED))).toEqual([
      ["x-1-001", "held out", 1],
      ["x-1-002", "held out", 2],
      ["x-1-003", "refused", 0],
      ["x-1-004", "refused", 3],
      ["x-1-005", "held out", 1],
      ["x-1-006", "refused", 2],
    ]);
    // Its cost a task, on the gate's event; the solves are the session's, named by it, and no
    // comparison's: a comparison counts the solves whose start names it (`pairsOf`).
    // A first solve that leaves no room starts the other two together, and these end at once, so
    // both are read even where the second alone would have left room.
    expect(inOrder(s.of(GATE), versions).map(({ reference }) => reference)).toEqual([
      { valid: 1, solves: 3, ran: 3, billed: 1.5 },
      { valid: 2, solves: 3, ran: 3, billed: 1.5 },
      { valid: 0, solves: 3, ran: 3, billed: 1.5 },
      { valid: 3, solves: 3, ran: 3, billed: 1.5 },
      { valid: 1, solves: 2, ran: 3, billed: 1.5 },
      { valid: 2, solves: 2, ran: 3, billed: 1.5 },
    ]);
    expect(solvesIn(read(s.log)).map(({ start }) => start.comparison)).toEqual(Array(18).fill("x-1"));
    expect(billedParts(read(s.log), "x-1")).toEqual({ session: 0, comparison: 9 });
    // None is part of a task's answers or a tally; a valid one is a witness, so its task is
    // feasible and nothing more.
    expect(ranUnder(read(s.log))).toEqual([]);
    expect(poolOf(read(s.log)).feasible).toEqual(new Set(versions.filter((_version, nth) => nth !== 2)));
    // Each held draft is told where its room came from, read from the same counts: all three here
    // on validity, since none was held on every solve valid or on none.
    const said = s.of(CALLED).flatMap(({ text: each }) => (isString(each) ? each.split("\n") : []));
    expect(
      said.filter((line) => line.includes("held out")).map((line) => line.split(", so it leaves room ")[1]),
    ).toEqual(Array(3).fill("on validity, its solves valid in some and not all."));
    expect(said.filter((line) => line.includes("refused")).join("\n")).not.toContain("leaves room on");
    // A later session counts them by the same kinds, with those refused after reading all three
    // solves: x-1-006 read two, which no reading counts as measured (`measuredGate`).
    // Held 3, all on validity, none on an answer of the author's or on the objective; 2 refused.
    expect(heard(read(s.log), []).measured?.match(/\d+/gu)).toEqual(["3", "3", "0", "0", "2"]);
    expect(s.of("exam.started")).toMatchObject([{ tried: 3 }]);
    expect(s.sent[0]).toContain("try_task takes instances");
    expect(s.sent[0]).not.toContain("propose_tasks");
    expect(s.sent.join("\n")).not.toContain("ladder");
    expect(s.sent.join("\n")).not.toContain(SOLVER);
  });

  it("holds out a task the reference harness answers every time where two of its answers are apart by the objective, and not one where they are alike", async () => {
    // Base 2's answers measure 10, 10 and 12, apart; base 3's 10, 10 and 10 and a billionth,
    // one measure. Until 16 October the gate read no objective and refused both, while a comparison
    // reads the first as room (`informative`, `src/kernel/compare.ts`).
    const measures = new Map([
      [2, [10, 10, 12]],
      [3, [10, 10, 10 + 1e-9]],
    ]);
    const s = seat("write", [call(TRY, { tasks: [instance(2), instance(3)] }), finish, finish]);
    const probe = measuredProbe(
      s.log,
      (task, nth) => measures.get(Number(asRecord(task.publicInput)?.base))?.[nth],
    );
    const contract = {
      ...s.request.contract,
      objective: { quantity: "the mass", direction: "lower" },
    } as const;
    const examined = await examine({
      ...s.request,
      contract,
      limits: { ...s.request.limits, puts: 2 },
      probe,
    });
    const [apart, alike] = [s.versionOf("x-1-001", 2), s.versionOf("x-1-002", 3)];
    expect(examined).toMatchObject({ held: [apart], refused: [alike] });
    expect(s.of(GATE).map(({ outcome }) => outcome)).toEqual(["passed", "refused"]);
    expect(gateHeard(s.of(CALLED))).toEqual([
      ["x-1-001", "held out", 3],
      ["x-1-002", "refused", 3],
    ]);
  });

  it("holds out a task the reference harness answers alike every time where its author's answer is better by the objective by the room floor, and not one closer or without one", async () => {
    // The reference's answers measure 10 on every draft, the third within a billionth of it.
    // Base 2's author answer measures 9, better than each by 10%; base 3's is better by 0.5%, under
    // the floor (`ROOM`); base 4 has none. Until 20 October base 3 was held, as r6's gate held
    // drafts whose author answers were a hundredth of a percent better.
    const authored = new Map([
      [2, 9],
      [3, 9.95],
    ]);
    const steps = [tried(2), tried(3), call(TRY, { tasks: [instance(2), instance(3), instance(4)] })];
    const s = seat("write", [...steps, finish, finish]);
    const probe = measuredProbe(s.log, (_task, nth) => [10, 10, 10 + 1e-9][nth]);
    const examined = await examine({
      ...s.request,
      contract: { ...s.request.contract, objective: { quantity: "the mass", direction: "lower" } },
      limits: { ...s.request.limits, puts: 3 },
      probe,
      verify: async (task, answer) => {
        const verdict = await verify(task, answer);
        const measure = authored.get(Number(asRecord(task.publicInput)?.base));
        return verdict.kind === "pass" && measure !== undefined
          ? { kind: "pass", objective: measure }
          : verdict;
      },
    });
    const [better, within, unproved] = [
      s.versionOf("x-1-001", 2),
      s.versionOf("x-1-002", 3),
      s.versionOf("x-1-003", 4),
    ];
    expect(examined).toMatchObject({ held: [better] });
    expect(new Set(examined.refused)).toEqual(new Set([within, unproved]));
    // The author's measure is on record for the held task alone, where a comparison reads it.
    expect(poolOf(read(s.log)).bests).toEqual(new Map([[better, 9]]));
    // Each draft's line tells the reference's measures and, where it tried one, its own: the
    // better one at the first solve, after which the gate stops.
    const lines = s.of(CALLED).flatMap(({ text: said }) => (isString(said) ? said.split("\n") : []));
    expect(lines.find((line) => line.startsWith("x-1-001: "))).toContain(
      "1 of 1 solves, its valid answers measuring 10, and your answer that passed try_answer on it 9, 10% better than its best, so it leaves room on the objective alone, every one of its solves valid.",
    );
    expect(lines.find((line) => line.startsWith("x-1-002: "))).toContain(
      "measuring 10, 10, 10, and your answer that passed try_answer on it 9.95, 0.5% better than its best, which leaves no room",
    );
    // A later session is told the gap beside the refused draft.
    expect(heard(read(s.log), []).refused).toEqual([
      expect.stringContaining("x-1-002 (fixture, yours 0.5% better than its best)"),
    ]);
    // and beside the held one, on its line.
    const later = heard(read(s.log), [{ taskId: "x-1-001", family: "fixture" }]);
    expect(later.lines[0]).toContain("gate 1 of 1 valid, yours 10% better than its best");
    expect(lines.find((line) => line.startsWith("x-1-003: "))).not.toContain("try_answer on it");
  });

  it("tells the turns and minutes of the reference's valid answers at the gate against the budget, and the drafts used", async () => {
    const s = seat("write", [call(TRY, { tasks: [instance(2)] }), finish, finish]);
    await examine({
      ...s.request,
      budget: { modelTurns: 20, minutes: 30 },
      probe: measuredProbe(s.log, () => undefined, 4, 61),
    });
    const said = s
      .of(CALLED)
      .flatMap(({ text: line }) => (isString(line) ? [line] : []))
      .join("\n");
    expect(said).toContain(
      "validly in 3 of 3 solves, taking 4, 4, 4 of its 20 turns and at most 2 minutes of its 30, which leaves no room",
    );
    expect(said).toContain("1 of 4 drafts put to the gate in this session.");
  });

  it("tells its author's gap on a draft the reference answers in some of its solves", async () => {
    // Base 2's first reference solve measures 10 and its second ends without an answer: the
    // readings disagree, which holds the draft. Its author's answer measures 9.95, 0.5% better.
    // Until 21 October the proof was read only where every reading agreed, so this gap was lost.
    const s = seat("write", [tried(2), call(TRY, { tasks: [instance(2)] }), finish, finish]);
    const measured = measuredProbe(s.log, () => 10);
    let solves = 0;
    const probe = async (task: TaskPackage, session: string): Promise<Ending> => {
      solves += 1;
      return solves === 1 ? await measured(task, session) : { outcome: "fail", kind: "turns-ended" };
    };
    const examined = await examine({
      ...s.request,
      contract: { ...s.request.contract, objective: { quantity: "the mass", direction: "lower" } },
      limits: { ...s.request.limits, puts: 1 },
      probe,
      verify: async (task, answer) => {
        const verdict = await verify(task, answer);
        return verdict.kind === "pass" ? { kind: "pass", objective: 9.95 } : verdict;
      },
    });
    expect(examined).toMatchObject({ held: [s.versionOf("x-1-001", 2)] });
    const [gate] = s.of(GATE);
    expect(asRecord(gate?.reference)).toMatchObject({ valid: 1, solves: 3 });
    expect(asRecord(gate?.reference)?.gap).toBeCloseTo(0.005, 9);
  });

  it("charges only author work across explicit wait, continuation, finish and crash settlement", async () => {
    for (const path of ["wait", "continuation", "finish", "final finish", "crash"] as const) {
      const release = Promise.withResolvers<void>();
      const waiting = Promise.withResolvers<void>();
      const s = seat("write", [
        ...(path === "final finish" ? [finish] : []),
        call(TRY, { tasks: [instance(2)] }),
        () => {
          waiting.resolve();
          if (path === "crash") throw new Error("provider stopped");
          if (path === "continuation") return fauxAssistantMessage("Awaiting admission.");
          return path === "wait" ? call("wait", {}) : finish;
        },
        finish,
        finish,
      ]);
      let ran = 0;
      const running = examine({
        ...s.request,
        limits: { ...s.request.limits, wallSeconds: 0.1 },
        probe: async (_task, _session, signal) => {
          ran += 1;
          signal.addEventListener("abort", () => release.resolve(), { once: true });
          await release.promise;
          return signal.aborted ? { outcome: "non-result", kind: "killed", reason: "cut" } : REJECTED;
        },
      });
      await waiting.promise;
      const until = performance.now() + 200;
      while (performance.now() < until) await Bun.sleep(1);
      release.resolve();
      const examined = await running;
      expect(examined.ended).toBe(path === "crash" ? "crashed" : "finished");
      expect(ran).toBe(3);
      const event = s.of(EXAM_FINISHED)[0];
      expect(event?.hostSeconds).toBeGreaterThanOrEqual(0.19);
      expect(Number(event?.seconds) - Number(event?.hostSeconds)).toBeLessThan(0.1);
      expect(Number(event?.hostSeconds)).toBeLessThanOrEqual(Number(event?.seconds));
    }
  });

  it("keeps operator kill and campaign budget live during an explicit gate wait", async () => {
    for (const stop of ["kill", "budget"] as const) {
      const waiting = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const kill = new AbortController();
      const s = seat("write", [
        call(TRY, { tasks: [instance(2)] }),
        () => {
          waiting.resolve();
          return call("wait", {});
        },
        finish,
      ]);
      let ran = 0;
      const running = examine({
        ...s.request,
        kill: kill.signal,
        limits: { ...s.request.limits, wallSeconds: 0.1 },
        probe: async (_task, _session, signal) => {
          ran += 1;
          await release.promise;
          return signal.aborted ? { outcome: "non-result", kind: "killed", reason: "cut" } : PASS;
        },
      });
      await waiting.promise;
      const until = performance.now() + 200;
      while (performance.now() < until) await Bun.sleep(1);
      if (stop === "kill") {
        kill.abort();
        // Leave the gate pending while shutdown also settles the interrupted wait.
        const settledAt = performance.now() + 100;
        while (performance.now() < settledAt) await Bun.sleep(1);
        release.resolve();
      } else {
        append(s.log, "campaign.opened", { budget: { dollars: 0, reserve: 1 } });
        release.resolve();
      }
      expect((await running).ended).toBe(stop === "kill" ? "killed" : "stopped");
      expect(ran).toBe(1);
      expect(s.of("exam.turn")).toHaveLength(2);
      const event = s.of(EXAM_FINISHED)[0];
      expect(event?.hostSeconds).toBeGreaterThanOrEqual(0.19);
      expect(Number(event?.hostSeconds)).toBeLessThanOrEqual(Number(event?.seconds));
    }
  });

  it("ends a gate wait once a peer spends the campaign's budget, without the gate's solves ending first", async () => {
    const waiting = Promise.withResolvers<void>();
    const s = seat("write", [
      call(TRY, { tasks: [instance(2)] }),
      () => {
        waiting.resolve();
        return call("wait", {});
      },
      finish,
    ]);
    const kill = new AbortController();
    const running = examine({
      ...s.request,
      kill: kill.signal,
      budgetLookMs: 20,
      // A gate solve that ends only when its signal falls, as one under its own long wall would.
      probe: async (_task, _session, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return { outcome: "non-result", kind: "killed", reason: "cut" };
      },
    });
    await waiting.promise;
    append(s.log, "campaign.opened", { budget: { dollars: 0, reserve: 1 } });
    const ended = await Promise.race([running.then(({ ended: how }) => how), Bun.sleep(2_000)]);
    kill.abort();
    await running;
    expect(ended).toBe("stopped");
  });

  it("resumes its author allowance after waiting and cancels a later background probe at the wall", async () => {
    const release = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    const s = seat("write", [
      call(TRY, { tasks: [instance(2)] }),
      () => {
        waiting.resolve();
        return call("wait", {});
      },
      call(TRY, { tasks: [instance(3)] }),
      async () => {
        const until = performance.now() + 200;
        while (performance.now() < until) await Bun.sleep(1);
        return finish;
      },
    ]);
    let cancelled = 0;
    const running = examine({
      ...s.request,
      limits: { ...s.request.limits, wallSeconds: 0.1 },
      probe: async (task, _session, signal) => {
        if (asRecord(task.publicInput)?.base === 2) {
          await release.promise;
          return REJECTED;
        }
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        cancelled += 1;
        return { outcome: "non-result", kind: "killed", reason: "cut" };
      },
    });
    await waiting.promise;
    const until = performance.now() + 200;
    while (performance.now() < until) await Bun.sleep(1);
    release.resolve();
    expect((await running).ended).toBe("wall");
    expect(cancelled).toBe(1);
    const event = s.of(EXAM_FINISHED)[0];
    expect(event?.hostSeconds).toBeGreaterThanOrEqual(0.19);
    expect(Number(event?.seconds) - Number(event?.hostSeconds)).toBeGreaterThanOrEqual(0.1);
  });

  it("settles a gate after a thrown model crash under the wall, kill and budget, then closes the model", async () => {
    for (const [stop, ended] of [
      ["none", "crashed"],
      ["kill", "killed"],
      ["spent", "stopped"],
    ] as const) {
      const s = seat("write", [call(TRY, { tasks: [instance(2)] })]);
      const release = Promise.withResolvers<void>();
      const kill = new AbortController();
      const models = s.request.models();
      // SAFETY: the inherited collection is complete; only the streaming seam changes.
      const crashing = Object.create(models) as typeof models;
      let requests = 0;
      let modelSignal: AbortSignal | undefined;
      crashing.streamSimple = (...asked: Parameters<typeof models.streamSimple>) => {
        modelSignal = asked[2]?.signal;
        requests += 1;
        if (requests === 2) {
          if (stop === "none") setTimeout(() => release.resolve(), 0);
          if (stop === "kill") setTimeout(() => kill.abort(), 0);
          throw new Error("provider limit reached");
        }
        return models.streamSimple(...asked);
      };
      let ran = 0;
      const examined = await examine({
        ...s.request,
        models: () => crashing,
        kill: kill.signal,
        limits: { ...s.request.limits, wallSeconds: 600 },
        probe: async (_task, _session, signal) => {
          ran += 1;
          signal.addEventListener("abort", () => release.resolve(), { once: true });
          if (stop === "spent") append(s.log, "campaign.opened", { budget: { dollars: 0, reserve: 1 } });
          await release.promise;
          if (signal.aborted) return { outcome: "non-result", kind: "killed", reason: "stopped" };
          return ran === 1 ? PASS : REJECTED;
        },
      });
      expect(modelSignal?.aborted).toBe(true);
      expect(examined.ended).toBe(ended);
      expect(s.of(GATE)).toMatchObject([{ outcome: stop === "none" ? "passed" : "refused" }]);
      expect(ran).toBe(stop === "none" ? 3 : 1);
      const kinds = read(s.log).map(({ kind }) => kind);
      expect(kinds.indexOf(GATE)).toBeLessThan(kinds.indexOf(EXAM_FINISHED));
    }
  });

  it("ends at its wall with no solve of the reference harness left running, and starts none after it", async () => {
    // Both instances of the call are gated together, a solve at a time, so the wall finds two running.
    const s = seat("write", [
      call(TRY, { tasks: [instance(2), instance(3)] }),
      async () => {
        const until = performance.now() + 1_000;
        while (performance.now() < until) await Bun.sleep(1);
        return finish;
      },
    ]);
    const running = new Set<string>();
    // Each solve would pass long after the wall, unless the kill a comparison's solves take
    // stops it first; the launcher records its end either way.
    const probe = (task: TaskPackage, session: string, kill: AbortSignal) =>
      new Promise<Ending>((settle) => {
        const solve = `w-${String(s.of(STARTED).length + 1)}`;
        running.add(solve);
        append(s.log, STARTED, { solve, task: task.taskId, comparison: session });
        const end = (ending: Ending) => {
          if (!running.delete(solve)) return;
          clearTimeout(late);
          append(s.log, FINISHED, { solve, ending });
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
    expect(s.of(FINISHED).map(({ ending }) => asRecord(ending)?.kind)).toEqual(Array(2).fill("killed"));
    expect(s.of(GATE)).toMatchObject(
      Array(2).fill({ outcome: "refused", reference: { valid: 0, solves: 0 } }),
    );
    // Refused unmeasured, so a later session may take either again (`measuredGate`).
    expect(s.of(PROPOSED)).toHaveLength(2);
    expect(s.of(GATE).filter(measuredGate)).toEqual([]);
  });

  it("cancels two admission probes queued at the host at its wall and retains each earlier reading", async () => {
    const queued = Promise.withResolvers<void>();
    const sleeping = Promise.withResolvers<void>();
    const s = seat("write", [
      call(TRY, { tasks: [instance(2), instance(3)] }),
      async () => {
        await queued.promise;
        // The wall counts author time only, so the session spends its allowance here.
        const until = performance.now() + 300;
        while (performance.now() < until) await Bun.sleep(1);
        return fauxAssistantMessage("Waiting for the queued admissions.");
      },
      finish,
    ]);
    const measured = measuredProbe(s.log, () => undefined);
    const seen = new Set<string>();
    let waitsAtHost = 0;
    const host: Host = {
      load: () => (seen.size < 2 ? 0 : 99),
      cores: 4,
      waitMs: 30_000,
      sleep: () => {
        waitsAtHost += 1;
        if (waitsAtHost === 2) queued.resolve();
        return sleeping.promise;
      },
    };
    const probe = await admission(
      s,
      hostGated(
        {
          host,
          loaded: false,
          seated: () => ({
            builder: null,
            setting: "s",
            solve: async (task, _harness, _kill, session) => {
              seen.add(task.taskId);
              const ending = await measured(task, session ?? "x-1");
              return { solve: `s-${String(s.of(STARTED).length)}`, ending };
            },
          }),
        },
        s.log,
      ),
    );
    const examined = await examine({
      ...s.request,
      limits: { ...s.request.limits, wallSeconds: 0.2 },
      probe,
    });
    expect(examined.ended).toBe("wall");
    // Each draft's second and third wait at the host together.
    expect(waitsAtHost).toBe(4);
    expect(s.of(STARTED)).toHaveLength(2);
    expect(s.of(FINISHED)).toHaveLength(2);
    expect(s.of(GATE)).toMatchObject(
      Array(2).fill({
        outcome: "refused",
        reference: { valid: 1, solves: 1, ran: 3 },
      }),
    );
    expect(s.of(GATE).filter(measuredGate)).toEqual([]);
    expect(s.of(TASK_STATE)).toMatchObject(Array(2).fill({ state: "refused", session: "x-1" }));
    expect(examined.refused).toHaveLength(2);
    const kinds = read(s.log).map(({ kind }) => kind);
    expect(kinds.lastIndexOf(GATE)).toBeLessThan(kinds.indexOf(EXAM_FINISHED));
    expect(s.of("campaign.waited")).toHaveLength(4);
  }, 2000);

  it("turns only the launcher's cancellation reason into a killed admission ending", async () => {
    const s = seat("write", []);
    const kill = new AbortController();
    const reason = new Error("the Examiner ended");
    const unrelated = new Error("the launcher failed");
    let thrown = reason;
    const probe = await admission(s, () => ({
      builder: null,
      setting: "s",
      solve: async () => {
        throw thrown;
      },
    }));
    const task = s.request.pack(EXAMPLE);
    // The same error before cancellation is still a launcher failure.
    await expect(probe(task, "x-1", kill.signal)).rejects.toBe(reason);
    kill.abort(reason);
    expect(await probe(task, "x-1", kill.signal)).toMatchObject({ outcome: "non-result", kind: "killed" });
    thrown = unrelated;
    await expect(probe(task, "x-1", kill.signal)).rejects.toBe(unrelated);
    expect(s.of(STARTED)).toEqual([]);
    expect(s.of("referee.finding")).toEqual([]);
  });

  it("returns a try_task call before its gate does, and tells what the gate said with a later tool result", async () => {
    // The reference's solves end only once the session has made its next call: a call that waited
    // on its gate, as every one did until 19 October, would wait for ever.
    let release = () => {};
    const after = new Promise<void>((settle) => {
      release = settle;
    });
    const s = seat("write", [
      call(TRY, { tasks: [instance(2)] }),
      () => {
        release();
        return tried(3);
      },
      finish,
      finish,
    ]);
    const measured = measuredProbe(s.log, () => undefined);
    const probe = async (task: TaskPackage, session: string) => {
      await after;
      return await measured(task, session);
    };
    const examined = await examine({ ...s.request, limits: { ...s.request.limits, puts: 1 }, probe });
    const [put, ...later] = s.of(CALLED);
    expect(gateSaid(put?.text).filter(([id]) => id !== "")).toEqual([]);
    expect(gateHeard(later)).toEqual([["x-1-001", "refused", 3]]);
    expect(examined.refused).toEqual([s.versionOf("x-1-001", 2)]);
    // The gate's event is on record before the session's end.
    const kinds = read(s.log).map(({ kind }) => kind);
    expect(kinds.indexOf(GATE)).toBeLessThan(kinds.indexOf(EXAM_FINISHED));
  });

  it("waits for the gate's next word at a turn that ends with no call, and not with nothing at the gate", async () => {
    const s = seat("write", [
      fauxAssistantMessage("Nothing to put yet."),
      call(TRY, { tasks: [instance(2)] }),
      fauxAssistantMessage("Waiting for the gate."),
      finish,
      finish,
    ]);
    const measured = measuredProbe(s.log, () => undefined);
    const probe = async (task: TaskPackage, session: string) => {
      await Bun.sleep(50);
      return await measured(task, session);
    };
    await examine({ ...s.request, limits: { ...s.request.limits, puts: 1 }, probe });
    // The request after `try_task` returns has no word yet; the one after the turn with no call does.
    expect(s.sent[2]).not.toContain("x-1-001: refused");
    expect(s.sent[3]).toContain("x-1-001: refused");
  });

  it("returns from wait with the gate's next word, and at once with nothing at the gate", async () => {
    const s = seat("write", [
      call(TRY, { tasks: [instance(2)] }),
      call("wait", {}),
      call("wait", {}),
      finish,
      finish,
    ]);
    const measured = measuredProbe(s.log, () => undefined);
    const probe = async (task: TaskPackage, session: string) => {
      await Bun.sleep(50);
      return await measured(task, session);
    };
    await examine({ ...s.request, limits: { ...s.request.limits, puts: 1 }, probe });
    const [, waited, idle] = s.of(CALLED);
    expect(waited?.text).toContain("x-1-001: refused");
    expect(idle?.text).toContain("Nothing is at the gate.");
    // A session whose gate solves nothing has no word to wait for, and has no wait tool: a call
    // to one is answered as a tool the session does not have.
    const unprobed = seat("write", [call("wait", {}), finish, finish]);
    await examine(unprobed.request);
    // Durable refuses unavailable calls before its execution hooks; the model still reads the error.
    expect(unprobed.sent[1]).toContain('"toolName":"wait"');
    expect(unprobed.sent[1]).toContain('"isError":true');
    expect(waited).toMatchObject({ tool: "wait", isError: false });
  });

  it("solves the instances of one call together, and bills each draft its own solves", async () => {
    const s = seat("write", [call(TRY, { tasks: [instance(2), instance(3)] }), finish, finish]);
    // No solve ends until both instances' first have started: gated one instance at a time, the
    // call would wait on the first instance's solve for ever.
    let release = () => {};
    const together = new Promise<void>((settle) => {
      release = settle;
    });
    const ended: number[] = [];
    const probe = async (task: TaskPackage, session: string) => {
      const base = Number(asRecord(task.publicInput)?.base);
      const solve = `t-${String(s.of(STARTED).length + 1)}`;
      const ran = condition(taskVersion(task), "h-reference");
      append(s.log, "condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
      append(s.log, STARTED, { solve, condition: conditionId(ran), comparison: session });
      if (s.of(STARTED).length === 2) release();
      await together;
      const ending = base === 2 && ended.includes(base) ? WALLED : PASS;
      ended.push(base);
      append(s.log, "verdict", { solve, answer: { answer: SOLVER, unit: "N" } });
      append(s.log, FINISHED, { solve, ending, billed: base === 2 ? 0.5 : 1 });
      return ending;
    };
    await examine({ ...s.request, limits: { ...s.request.limits, puts: 2 }, probe });
    expect(s.of(GATE).map(({ outcome, reference }) => [outcome, reference])).toEqual([
      ["passed", { valid: 1, solves: 3, ran: 3, billed: 1.5 }],
      ["refused", { valid: 3, solves: 3, ran: 3, billed: 3 }],
    ]);
    expect(s.sent[0]).toContain("returns at once");
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
});
