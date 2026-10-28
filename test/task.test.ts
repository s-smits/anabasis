// A task: the gate its package passes and the states a log folds it into.
import { afterAll, describe, expect, it } from "bun:test";
import { type Contract } from "../src/kernel/contract.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { packageGate, type TaskPackage, taskSets, taskStates } from "../src/kernel/task.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    properties: { depth: { type: "number" }, steel: { type: "string" } },
    required: ["depth"],
    additionalProperties: false,
  },
  conventions: "SI units",
  rules: [
    { id: "span-rule", statement: "The beam spans the gap." },
    { id: "load-rule", statement: "The beam carries the load." },
  ],
  scope: "Simply supported beams.",
};

const root = mkdtempSync(join(tmpdir(), "ana-task-"));
let programs = 0;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A check program whose one check covers `families` and cites `cited`. */
function program(
  families: string[] | "all",
  cited: string[] | undefined,
  evaluator = "export const checks = {};",
): string {
  const dir = join(root, `program-${++programs}`);
  mkdirSync(dir);
  const execution = { families, artifactPaths: ["$"], publicInputPaths: ["$"], hidden: "none" };
  const check = {
    id: "spans",
    citedDecisionIds: cited,
    execution: { ...execution, evidence: { kind: "authored" } },
  };
  writeFileSync(
    join(dir, "brief.json"),
    JSON.stringify({ correctnessContract: "check-program/v1", truthChecks: [check] }),
  );
  writeFileSync(join(dir, "evaluator.ts"), evaluator);
  return dir;
}

function pkg(changes: Partial<TaskPackage> = {}): TaskPackage {
  return {
    taskId: "beam-01",
    family: "beams",
    publicInput: { gapM: 4 },
    hidden: [],
    ruleIds: ["span-rule", "load-rule"],
    checks: program(["beams"], ["span-rule"]),
    ...changes,
  };
}

describe("the gate", () => {
  it("refuses a task that gives a check no hidden value of the check's own to run on", () => {
    // A check that declares its hidden operand required, as v1's reference-comparing checks do.
    const dir = program(["beams"], ["span-rule"]);
    const brief = JSON.parse(readFileSync(join(dir, "brief.json"), "utf8"));
    brief.truthChecks[0].execution.hidden = "required";
    writeFileSync(join(dir, "brief.json"), JSON.stringify(brief));
    expect(packageGate(CONTRACT, pkg({ checks: dir, hidden: [] }))).toEqual({
      outcome: "refused",
      reason: "the task gives check spans nothing to run on: check-hidden-operand-missing: spans",
    });
    expect(packageGate(CONTRACT, pkg({ checks: dir, hidden: { spans: 4 } })).outcome).toBe("refused");
    const served = [{ checkId: "spans", expectation: { depthM: 0.4 } }];
    expect(packageGate(CONTRACT, pkg({ checks: dir, hidden: served }))).toEqual({ outcome: "passed" });
  });

  it("refuses a missing part, a rule the contract lacks, and a check program that would pass anything", () => {
    const reason = (changes: Partial<TaskPackage>) => {
      const gate = packageGate(CONTRACT, pkg(changes));
      return gate.outcome === "refused" ? gate.reason : "passed";
    };
    expect(reason({ publicInput: null })).toBe("no inputs");
    expect(reason({ ruleIds: [] })).toBe("no rule ids");
    expect(reason({ checks: join(root, "nowhere") })).toBe("no brief.json");
    expect(reason({ ruleIds: ["span-rule", "wind-rule"] })).toBe("rule wind-rule is not in the contract");
    expect(reason({ checks: program(["columns"], ["span-rule"]) })).toBe("no check applies to family beams");
    expect(reason({ checks: program("all", []) })).toBe("check spans cites no rule by id");
    expect(reason({ checks: program("all", undefined) })).toBe("check spans cites no rule by id");
  });

  it("refuses a check that enforces a rule the task does not show the solver", () => {
    const gate = packageGate(CONTRACT, pkg({ ruleIds: ["load-rule"] }));
    expect(gate).toEqual({
      outcome: "refused",
      reason: "check spans enforces span-rule, which the task does not list",
    });
  });
});

describe("the task states", () => {
  const at = "2026-10-09T00:00:00.000Z";
  const proposedAs = (version: string): LogEvent => ({ at, kind: "task.proposed", data: { version } });
  const gateAs = (version: string, number: number, outcome = "passed"): LogEvent => ({
    at,
    kind: "task.gate",
    data: { version, gate: number, outcome },
  });
  const stateAs = (version: string, to: string): LogEvent => ({
    at,
    kind: "task.state",
    data: { version, state: to },
  });
  const proposed = proposedAs("v1");
  const gate = (number = 1, outcome = "passed") => gateAs("v1", number, outcome);
  const state = (to: string) => stateAs("v1", to);
  const held = [proposed, gate()];

  it("holds a task out once its package passes the gate, and no sooner", () => {
    expect(taskStates([proposed])).toEqual(new Map([["v1", "held"]]));
    expect(taskSets([proposed])).toMatchObject({ held: [], released: [] });
    expect(taskSets(held)).toMatchObject({ held: ["v1"], released: [] });
    // In the order they were proposed, whichever passed its gate first.
    const two = [proposedAs("v2"), proposed, gate(), gateAs("v2", 1)];
    expect(taskSets(two).held).toEqual(["v2", "v1"]);
    expect(taskStates([proposed, gate(1, "refused"), state("refused")]).get("v1")).toBe("refused");
    expect(taskSets([proposed, gate(1, "refused"), state("refused")]).held).toEqual([]);
  });

  it("refuses a history that could not have happened", () => {
    expect(() => taskStates([state("held")])).toThrow("task v1 is not proposed");
    expect(() => taskStates([proposed, proposed])).toThrow("task v1 is proposed twice");
    expect(() => taskStates([{ at, kind: "task.state", data: { state: "held" } }])).toThrow(
      "task.state names no task version",
    );
    expect(() => taskStates([...held, gate()])).toThrow("task v1 logs its gate twice");
    // A task whose package was never passed is no task a solver may be given.
    expect(() => taskStates([proposed, state("released")])).toThrow(
      "task v1 cannot go from held to released before its gate passed",
    );
    expect(() => taskStates([proposed, gate(1, "refused"), state("disputed")])).toThrow(
      "task v1 cannot go from held to disputed before its gate passed",
    );
    // Nothing follows a release but a dispute, and nothing follows a dispute or a refusal.
    expect(() => taskStates([...held, state("released"), state("held")])).toThrow(
      "task v1 cannot go from released to held",
    );
    expect(() => taskStates([...held, state("disputed"), state("released")])).toThrow(
      "task v1 cannot go from disputed to released",
    );
    expect(() => taskStates([...held, state("refused"), state("released")])).toThrow(
      "task v1 cannot go from refused to released",
    );
    expect(() => taskStates([...held, state("promoted")])).toThrow(
      "task v1 cannot go from held to no known state",
    );
  });
});
