// `try_reference`: a writing session's billed solves of an instance by the reference harness. What
// the author is told of each solve, what it is never told (an answer, a trace, a check), when the
// host refuses the call, and that the solves stay out of every comparison and practice fold while
// the campaign's budget pays for them. Then the cap on an ask's solves, the line on room above the
// author's checked answer, and a value given by `from_file` from the session's home.
import { afterAll, describe, expect, it } from "bun:test";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import { TRIES, writing } from "../src/examiner/write.ts";
import { budgetLeft } from "../src/campaign/opening.ts";
import { contentOf } from "../src/kernel/history.ts";
import { append, read } from "../src/kernel/log.ts";
import { poolOf } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { countedSolves, practiceRan, solvesIn } from "../src/kernel/solves.ts";
import type { Task } from "../src/kernel/verify.ts";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { instance, invoke, seat, sweep, toolOf } from "./helpers/examiner-seat.ts";
import { present } from "./helpers/matchers.ts";

/** A solver-side secret no Examiner may be shown: the probe solver's answer and trace hold it. */
const CANARY = "probe-canary-5d2e";
const TRY = "try_reference";
const PASS: Ending = { outcome: "pass" };
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
const BILL = 1;
// An answer in the fixture's format.
const ANSWER = { answer: "49", unit: "N" };

afterAll(sweep);

/** A probe that solves as the launcher logs a solve, under the Examiner session x-1: each call takes
 *  the next of `endings`, a pass measuring 2.5 in 4 turns, its answer and trace holding the canary,
 *  each solve billed `BILL`, and the tasks it was handed kept in `handed`. */
function probe(log: string, tries: number, endings: readonly Ending[]) {
  const handed: Task[] = [];
  const solve = async (task: Task) => {
    const ending = endings[handed.length] ?? PASS;
    handed.push(task);
    const id = `x-1-probe-${String(handed.length)}`;
    append(log, "solve.started", { solve: id, task: task.taskId, comparison: "x-1" });
    append(log, "solve.call", { solve: id, turn: 1, tool: "bash", isError: false, text: CANARY });
    if (ending.outcome === "pass") {
      append(log, "verdict", { solve: id, task: task.taskId, kind: "pass", objective: 2.5, answer: CANARY });
    } else if (ending.outcome === "fail" && ending.kind === "rejected") {
      append(log, "verdict", {
        solve: id,
        task: task.taskId,
        kind: "fail",
        blocking: ["check-product"],
        answer: CANARY,
      });
    }
    append(log, "solve.finished", { solve: id, ending, turns: 4, billed: BILL });
    return { solve: id, ending };
  };
  return { handed, probe: { tries, solve } };
}

/** A writing session x-1 over a campaign whose budget is `dollars`, at a reserve of a dollar. */
function seated(dollars: number, tries: number, endings: readonly Ending[]) {
  const s = seat("write", []);
  append(s.log, "campaign.opened", { budget: { dollars, reserve: 1 } });
  append(s.log, "exam.started", { session: "x-1" });
  const made = probe(s.log, tries, endings);
  return { ...s, ...made, mode: writing({ ...s.request, probe: made.probe }, undefined) };
}

const said = async (made: ReturnType<typeof seated>, args: JsonObject) => {
  const result = await invoke(toolOf(made.mode, TRY), "try", { solves: 2, ...args });
  const [part] = result.output ?? [];
  return part?.type === "text" ? part.text : "";
};
const spelled = (base: number) => {
  const { family, public_input, hidden } = instance(base);
  return { family, public_input, hidden };
};

describe("trying the reference at writing", () => {
  it("tells of each solve its validity, turns and measure or what ended it, counts no solve that could not run, and stops at the tries", async () => {
    const made = seated(100, 4, [
      PASS,
      REJECTED,
      { outcome: "non-result", kind: "provider", reason: "overloaded" },
      { outcome: "fail", kind: "turns-ended" },
      { outcome: "fail", kind: "wall-ended" },
    ]);
    await invoke(toolOf(made.mode), "put", { tasks: [instance(7)] });
    const before = poolOf(read(made.log));
    const first = await said(made, { task: spelled(7) });
    expect(first).toStartWith(
      "Solve 1: valid in 4 turns, measuring 2.5.\nSolve 2: not valid: the checks refused its answer.\n",
    );
    expect(first.split("\n")).toHaveLength(3);
    expect(first).toContain("2 of 4");
    const second = await said(made, { task: spelled(8) });
    expect(second).toContain("Solve 1: could not run: provider.");
    expect(second).toContain("Solve 2: not valid: ended at its turns limit.");
    expect(second).toContain("3 of 4");
    // One try is left, so a call for two runs one.
    const third = await said(made, { task: spelled(8) });
    expect(third).toStartWith("Solve 1: not valid: ended at its deadline.\n");
    expect(third.split("\n")).toHaveLength(2);
    expect(third).toContain("4 of 4");
    await expect(said(made, { task: spelled(8) })).rejects.toThrow("no try");
    for (const text of [first, second, third]) {
      expect(text).not.toContain(CANARY);
      expect(text).not.toContain("check-product");
    }
    // A held task's instance runs under that task's id, and one no task holds under the id its
    // content names.
    const unheld = `try-${contentOf(present(made.handed[2], "the third solve's task")).slice(0, 12)}`;
    expect(made.handed.map(({ taskId }) => taskId)).toEqual(["x-1-001", "x-1-001", unheld, unheld, unheld]);
    // The solves are the session's: no comparison or practice fold counts them, no task's draw
    // moves, and the budget pays for each.
    const events = read(made.log);
    expect(solvesIn(events).map(({ start }) => start.comparison)).toEqual(
      Array.from({ length: 5 }, () => "x-1"),
    );
    expect(countedSolves(events)).toEqual([]);
    expect(practiceRan(events)).toEqual([]);
    expect(poolOf(events)).toEqual(before);
    expect(budgetLeft(events)?.dollars).toBe(100 - 5 * BILL);
  });

  it("refuses a call the campaign's reserve does not cover or whose reference it never checked, and solves nothing for it", async () => {
    const made = seated(1.5, 4, []);
    await expect(said(made, { task: spelled(7) })).rejects.toThrow("no reserve");
    await expect(said(made, { task: { reference: "missing" } })).rejects.toThrow(
      "Unknown instance reference",
    );
    expect(made.handed).toEqual([]);
    expect(await said(made, { task: spelled(7), solves: 1 })).toContain("Solve 1: valid in 4 turns");
  });

  it("runs the reference's solves while the session's clock stands still, and a proposal outside it", async () => {
    const made = seated(100, 2, []);
    let paused = false;
    let stood = 0;
    const seen: boolean[] = [];
    const within = async <T>(action: () => Promise<T>): Promise<T> => {
      paused = true;
      stood += 1;
      try {
        return await action();
      } finally {
        paused = false;
      }
    };
    const solve = async (task: Task) => {
      seen.push(paused);
      return await made.probe.solve(task);
    };
    const mode = writing({ ...made.request, probe: { tries: 2, solve } }, undefined, { within });
    await invoke(toolOf(mode, TRY), "try", { solves: 2, task: spelled(7) });
    const tried = stood;
    await invoke(toolOf(mode), "put", { tasks: [instance(7)] });
    expect(seen).toEqual([true, true]);
    expect(tried).toBeGreaterThan(0);
    expect(stood).toBe(tried);
    expect(paused).toBe(false);
  });

  it("is given, described in the system prompt and counted in the limits only where the host gives a probe", () => {
    const made = seated(100, 4, []);
    expect(made.mode.tools.map(({ name }) => name)).toContain(TRY);
    expect(made.mode.system).toContain("## Trying the reference");
    expect(made.mode.opening).toContain("4 solves of the reference harness");
    expect(made.mode.started).toMatchObject({ limits: { tries: 4 } });
    const bare = writing({ ...made.request, id: "x-2" }, undefined);
    expect(bare.tools.map(({ name }) => name)).not.toContain(TRY);
    expect(bare.system).not.toContain(TRY);
    expect(bare.opening).not.toContain("of the reference harness to ask for");
    expect(bare.started).toMatchObject({ limits: { tries: 0 } });
  });

  it("gives an ask at most fourteen solves of the reference, whatever the probe allows", async () => {
    const made = seated(100, 36, []);
    expect(made.mode.opening).toContain(`${String(TRIES)} solves of the reference harness`);
    expect(made.mode.started).toMatchObject({ limits: { tries: TRIES } });
    for (let call = 1; call <= TRIES / 2; call += 1) {
      expect(await said(made, { task: spelled(7) })).toContain(`${String(2 * call)} of ${String(TRIES)}`);
    }
    await expect(said(made, { task: spelled(7) })).rejects.toThrow("no try");
    expect(made.handed).toHaveLength(TRIES);
  });

  it("says whether the reference's best valid solve leaves the author's checked answer room on the objective", async () => {
    // The probe's valid solves measure 2.5, and lower is better.
    const told = async (author: number) => {
      const s = seat("write", []);
      append(s.log, "campaign.opened", { budget: { dollars: 100, reserve: 1 } });
      append(s.log, "exam.started", { session: "x-1" });
      const made = probe(s.log, 4, [PASS, REJECTED]);
      const mode = writing(
        {
          ...s.request,
          contract: { ...s.request.contract, objective: { quantity: "cost", direction: "lower" } },
          verify: async () => ({ kind: "pass", objective: author }),
          probe: made.probe,
        },
        undefined,
      );
      const before = await invoke(toolOf(mode, TRY), "try", { solves: 1, task: spelled(5) });
      await invoke(toolOf(mode, "try_answer"), "answer", { ...spelled(7), answer: ANSWER });
      const after = await invoke(toolOf(mode, TRY), "try", { solves: 2, task: spelled(7) });
      return [before, after].map(({ output: [part] = [] }) => (part?.type === "text" ? part.text : ""));
    };
    const [unchecked = "", roomy = ""] = await told(2);
    expect(unchecked).not.toContain("try_answer");
    expect(roomy).toContain("measures 2, and the best valid solve here 2.5: yours is better by at least");
    expect(roomy).toContain("leaves the reference room");
    const [, tied = ""] = await told(2.5);
    expect(tied).toContain("yours is not better by the comparison's floor (1%)");
    expect(tied).not.toContain(CANARY);
  });
});

describe("a value given from a file in the Examiner's home", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ana-from-file-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "ana-from-file-out-")));
  afterAll(() => {
    for (const dir of [home, outside]) rmSync(dir, { recursive: true, force: true });
  });
  // An instance of about 50 KB, the size a jobstat Examiner wrote with a program of its own.
  const large = {
    ...spelled(7),
    public_input: { base: 7, rows: Array.from({ length: 10_000 }, (_, n) => n * 1.5) },
  };
  writeFileSync(join(home, "task.json"), JSON.stringify(large));
  writeFileSync(join(home, "input.json"), JSON.stringify(large.public_input));
  writeFileSync(join(home, "answer.json"), JSON.stringify(ANSWER));
  writeFileSync(join(outside, "task.json"), JSON.stringify(large));
  symlinkSync(join(outside, "task.json"), join(home, "linked.json"));

  /** The Examiner's `try_answer` in a session with home `at`. */
  const trying = (at: string | null = home) => {
    const s = seat("write", []);
    const request = { ...s.request, verify: async () => ({ kind: "pass" as const }) };
    return toolOf(writing(request, undefined, { home: at ?? undefined }), "try_answer");
  };
  /** The arguments that tool runs with, as given `args`. */
  const prepared = (args: JsonObject, at: string | null = home) => trying(at).prepareArguments?.(args);

  it("reads a value of 50 KB as the same JSON written inline", () => {
    expect(JSON.stringify(large).length).toBeGreaterThan(50_000);
    const filed = prepared({ ...large, public_input: { from_file: "input.json" }, answer: ANSWER });
    expect(filed).toEqual({ ...large, answer: ANSWER });
  });

  it("reads a whole list from a file before the schema is checked, and refuses one of the wrong shape without echoing it", () => {
    const files = [{ path: "out/report.md", text: "x".repeat(60_000) }];
    writeFileSync(join(home, "files.json"), JSON.stringify(files));
    writeFileSync(
      join(home, "misshapen.json"),
      JSON.stringify([{ name: "out/report.md", body: "y".repeat(60_000) }]),
    );
    // pi checks a call's arguments against the tool's schema once they are prepared: until 20
    // November the file was read after that check, which refused it in place of the list.
    const byFile = { ...large, answer: ANSWER, files: { from_file: "files.json" } };
    const tool = trying();
    const check = (args: JsonObject) => {
      validateToolArguments(tool, { type: "toolCall", id: "", name: tool.name, arguments: args });
    };
    expect(() => check(byFile)).toThrow("files");
    const filled = prepared(byFile);
    expect(filled).toMatchObject({ files });
    // SAFETY: the prepared arguments of a call whose arguments are a JSON object.
    expect(() => check(filled as JsonObject)).not.toThrow();
    let refusal = "";
    try {
      prepared({ ...large, answer: ANSWER, files: { from_file: "misshapen.json" } });
    } catch (error) {
      refusal = String(error);
    }
    expect(refusal).toContain("files.0.path");
    expect(refusal).not.toContain("yyyy");
    expect(refusal.length).toBeLessThan(2000);
  });

  it("admits an instance given by file as it admits the same instance given inline", async () => {
    const outputs = async (byFile: boolean) => {
      const s = seat("write", []);
      const mode = writing({ ...s.request, verify: async () => ({ kind: "pass" }) }, undefined, { home });
      const task = byFile ? { from_file: "task.json" } : large;
      const answer = byFile ? { from_file: "answer.json" } : ANSWER;
      const input = byFile ? { from_file: "input.json" } : large.public_input;
      const tried = await invoke(toolOf(mode, "try_answer"), "answer", {
        ...large,
        public_input: input,
        answer,
      });
      const put = await invoke(toolOf(mode), "put", { tasks: [task] });
      const logged = read(s.log).filter(({ kind }) => kind.startsWith("task."));
      return {
        tried: tried.output,
        put: put.output,
        logged: logged.map(({ kind, data }) => ({ kind, data })),
      };
    };
    const inline = await outputs(false);
    const filed = await outputs(true);
    expect(filed).toEqual(inline);
    expect(inline.logged.map(({ kind }) => kind)).toContain("task.proposed");
  });

  it("refuses a path outside the home, a link out of it, a missing file, a folder, a file too large and text that is not JSON", () => {
    writeFileSync(join(home, "broken.json"), "{ not json");
    mkdirSync(join(home, "folder.json"));
    writeFileSync(join(home, "large.json"), `"${"x".repeat(4_000_000)}"`);
    // A dataset of 2 MB, as drafts of 20 November named, is read.
    writeFileSync(join(home, "dataset.json"), `"${"x".repeat(2_000_000)}"`);
    expect(() => prepared({ ...large, answer: { from_file: "dataset.json" } })).not.toThrow();
    for (const [path, refusal] of [
      ["../outside.json", "outside your home"],
      [join(outside, "task.json"), "outside your home"],
      ["linked.json", "links outside your home"],
      ["absent.json", "no such file"],
      ["folder.json", "not a regular file"],
      ["large.json", "over the 4000000-byte limit"],
      ["broken.json", "not valid JSON"],
    ] as const) {
      expect(() => prepared({ ...large, answer: { from_file: path } })).toThrow(refusal);
    }
    expect(() => prepared({ ...large, answer: { from_file: "task.json" } }, null)).toThrow("no home");
  });
});
