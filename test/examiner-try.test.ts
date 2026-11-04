// `try_reference`: a writing session's billed solves of an instance by the reference harness. What
// the author is told of each solve, what it is never told (an answer, a trace, a check), when the
// host refuses the call, and that the solves stay out of every comparison and practice fold while
// the campaign's budget pays for them.
import { afterAll, describe, expect, it } from "bun:test";
import { triedAs } from "../src/examiner/record.ts";
import { writing } from "../src/examiner/write.ts";
import { budgetLeft } from "../src/campaign/opening.ts";
import { contentOf } from "../src/kernel/history.ts";
import { append, read } from "../src/kernel/log.ts";
import { poolOf } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { countedSolves, practiceRan, solvesIn } from "../src/kernel/solves.ts";
import type { Task } from "../src/kernel/verify.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { instance, invoke, seat, sweep, toolOf } from "./helpers/examiner-seat.ts";
import { present } from "./helpers/matchers.ts";

/** A solver-side secret no Examiner may be shown: the probe solver's answer and trace hold it. */
const CANARY = "probe-canary-5d2e";
const TRY = "try_reference";
const PASS: Ending = { outcome: "pass" };
const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
const BILL = 1;

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
  return { ...s, ...made, mode: writing({ ...s.request, probe: made.probe }, undefined, "unseen") };
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
    const unheld = triedAs(contentOf(present(made.handed[2], "the third solve's task")));
    expect(unheld).toStartWith("try-");
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

  it("is given, described in the system prompt and counted in the limits only where the host gives a probe", () => {
    const made = seated(100, 4, []);
    expect(made.mode.tools.map(({ name }) => name)).toContain(TRY);
    expect(made.mode.system).toContain("## Trying the reference");
    expect(made.mode.opening).toContain("4 solves of the reference harness");
    expect(made.mode.started).toMatchObject({ limits: { tries: 4 } });
    const bare = writing({ ...made.request, id: "x-2" }, undefined, "unseen");
    expect(bare.tools.map(({ name }) => name)).not.toContain(TRY);
    expect(bare.system).not.toContain(TRY);
    expect(bare.opening).not.toContain("of the reference harness to ask for");
    expect(bare.started).toMatchObject({ limits: { tries: 0 } });
  });
});
