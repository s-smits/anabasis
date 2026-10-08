// The stored-sweep reader on a sweep laid out as v1's left one: every graded solve comes back typed,
// the ones v1's verifier did not decide included, and a bundle's check program leaves its battery.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { checkProgram, sweepRows } from "../tools/m0/stored-sweep.ts";

type Turn =
  | { status: "open" }
  | { status: "ended"; inputTokens: number; outputTokens: number; costUsd: number };

const root = mkdtempSync(join(tmpdir(), "ana-sweep-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function solve(taskId: string, result: Record<string, boolean>, turns: Turn[]): void {
  const dir = join(root, "runs", "s", "c01", taskId);
  mkdirSync(join(dir, "harness", "cases", taskId), { recursive: true });
  const stored = { provider: "claude", model: "m", timedOut: false, answerPresent: true, answerParses: true };
  writeFileSync(join(dir, "result.json"), JSON.stringify({ ...stored, ...result }));
  writeFileSync(join(dir, "harness", "cases", taskId, "trace.json"), JSON.stringify({ turns }));
}

describe("a stored sweep", () => {
  it("types every graded solve, those v1's verifier did not decide among them", () => {
    const ended: Turn = { status: "ended", inputTokens: 1, outputTokens: 1, costUsd: 0.01 };
    const grades = [
      ["cycle", "taskId", "kind", "blockingChecks"],
      ["1", "passed", "verified-pass", ""],
      ["1", "rejected", "verified-fail", "mass,deflection"],
      ["1", "unparsed", "unaccepted", ""],
      ["1", "refused", "unaccepted", ""],
      ["1", "walled", "wall-timeout", ""],
      ["1", "stalled", "non-result:provider-stall", ""],
    ];
    mkdirSync(join(root, "grades", "s"), { recursive: true });
    writeFileSync(
      join(root, "grades", "s", "grades.tsv"),
      `${grades.map((row) => row.join("\t")).join("\n")}\n`,
    );
    for (const taskId of ["passed", "rejected", "refused", "stalled"]) solve(taskId, {}, [ended]);
    solve("unparsed", { answerParses: false }, [ended]);
    solve("walled", { timedOut: true }, [ended, { status: "open" }]);

    const typed = sweepRows(root, "s").map(({ taskId, expected, ending }) => [taskId, expected, ending]);
    expect(typed).toEqual([
      ["passed", { kind: "pass" }, { outcome: "pass" }],
      ["rejected", { kind: "fail", blocking: ["mass", "deflection"] }, { outcome: "fail", kind: "rejected" }],
      ["unparsed", null, { outcome: "fail", kind: "no-answer" }],
      ["refused", null, { outcome: "fail", kind: "rejected" }],
      ["walled", null, { outcome: "fail", kind: "wall-ended" }],
      ["stalled", null, { outcome: "non-result", kind: "refusal", reason: "non-result:provider-stall" }],
    ]);

    writeFileSync(
      join(root, "grades", "s", "grades.tsv"),
      "cycle\ttaskId\tkind\n1\tpassed\tnon-result:moon\n",
    );
    expect(() => sweepRows(root, "s")).toThrow("v1 graded a solve non-result:moon");
  });

  it("copies a bundle's check program without its battery", () => {
    const bundle = join(root, "bundle");
    mkdirSync(join(bundle, "correctness-model", "reference"), { recursive: true });
    for (const file of ["evaluator.ts", "brief.json", "tasks.json", "controls.json", "reference/model.ts"]) {
      writeFileSync(join(bundle, "correctness-model", file), "{}");
    }
    const checks = checkProgram(bundle, join(root, "checks"));
    expect(
      ["evaluator.ts", "brief.json", "reference/model.ts"].map((file) => existsSync(join(checks, file))),
    ).toEqual([true, true, true]);
    expect(["tasks.json", "controls.json"].some((file) => existsSync(join(checks, file)))).toBe(false);
  });
});
