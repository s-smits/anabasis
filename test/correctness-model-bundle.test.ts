import { describe, expect, it } from "bun:test";
import { type GeneratedTask, commitPublicTask, projectPublic } from "../src/correctness-bundle/task-split.ts";

describe("public/hidden split", () => {
  it("projectPublic picks public fields — hidden never crosses, even fields added later", () => {
    const task: GeneratedTask<{ brief: string }, { expected: number[] }> & { extraHidden?: string } = {
      taskId: "t1",
      family: "archive-routing",
      publicInput: { brief: "assign the record" },
      hidden: { expected: [7, 9] },
      extraHidden: "leaked-if-spread",
    };
    const pub = projectPublic(task);
    expect(pub).toEqual({
      taskId: "t1",
      family: "archive-routing",
      publicInput: { brief: "assign the record" },
    });
    expect(Object.keys(pub)).not.toContain("hidden");
    expect(Object.keys(pub)).not.toContain("extraHidden");
  });

  it("commitPublicTask freezes the question: later mutation of the task or any view changes nothing (steering 2026-07-11 item 2)", () => {
    const task: GeneratedTask<{ brief: string; slots: string[] }, { expected: number[] }> = {
      taskId: "t1",
      family: "archive-routing",
      publicInput: { brief: "assign the record", slots: ["s1"] },
      hidden: { expected: [7, 9] },
    };
    const committed = commitPublicTask(task);
    const expectedDigest = new Bun.CryptoHasher("sha256").update(committed.publicTaskJson).digest("hex");
    expect(committed.publicTaskDigest).toBe(expectedDigest);
    // Mutate the original task after committing it to check for retained references.
    task.publicInput.slots.push("falsified-slot");
    task.publicInput.brief = "falsified brief";
    // Also mutate a nested value in the view passed to generated tools.
    const solveView = committed.view();
    solveView.publicInput.slots[0] = "hijacked";
    // The bytes, digest and each new view retain the original question.
    expect(committed.publicTaskJson).toBe(
      JSON.stringify({
        taskId: "t1",
        family: "archive-routing",
        publicInput: { brief: "assign the record", slots: ["s1"] },
      }),
    );
    expect(committed.publicTaskDigest).toBe(expectedDigest);
    const evaluateView = committed.view();
    expect(evaluateView.publicInput).toEqual({ brief: "assign the record", slots: ["s1"] });
    // Views share no mutable objects: changing the solve view leaves the evaluate view intact.
    expect(solveView.publicInput.slots[0]).toBe("hijacked");
    // The committed task contains only public fields, which are safe to include in public evidence.
    expect(committed.publicTaskJson).not.toContain("expected");
  });
});
