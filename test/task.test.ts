// A task: the shape check its package passes and the states a log folds it into.
import { afterAll, describe, expect, it } from "bun:test";
import type { Contract } from "../src/kernel/contract.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { packageGate, type TaskPackage, taskSets, taskStates, taskVersion } from "../src/kernel/task.ts";
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
function program(families: string[] | "all", cited: string[] | undefined): string {
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
  writeFileSync(join(dir, "evaluator.ts"), "export const checks = {};");
  return dir;
}

const checks = program(["beams"], ["span-rule"]);

function pkg(changes: Partial<TaskPackage> = {}): TaskPackage {
  return {
    taskId: "beam-01",
    family: "beams",
    publicInput: { gapM: 4 },
    hidden: [],
    ruleIds: ["span-rule", "load-rule"],
    checks,
    ...changes,
  };
}

describe("the shape check", () => {
  it("changes task identity when a nested checker file changes, wherever the checker is kept", () => {
    const versions = ["one", "one", "two"].map((content) => {
      const dir = program(["beams"], ["span-rule"]);
      mkdirSync(join(dir, "reference"));
      writeFileSync(join(dir, "reference", "model.ts"), content);
      return taskVersion(pkg({ checks: dir }));
    });
    expect(versions[0]).toBe(versions[1]);
    expect(versions[2]).not.toBe(versions[0]);
  });

  it("refuses a task that gives a check no hidden value of the check's own to run on", () => {
    // A check that declares its hidden operand required, as v1's reference-comparing checks do.
    const dir = program(["beams"], ["span-rule"]);
    const brief = JSON.parse(readFileSync(join(dir, "brief.json"), "utf8"));
    brief.truthChecks[0].execution.hidden = "required";
    writeFileSync(join(dir, "brief.json"), JSON.stringify(brief));
    expect(packageGate(CONTRACT, pkg({ checks: dir, hidden: [] }))).toMatchObject({
      outcome: "refused",
      reason: expect.stringContaining("check-hidden-operand-missing: spans"),
    });
    expect(packageGate(CONTRACT, pkg({ checks: dir, hidden: { spans: 4 } })).outcome).toBe("refused");
    const served = [{ checkId: "spans", expectation: { depthM: 0.4 } }];
    expect(packageGate(CONTRACT, pkg({ checks: dir, hidden: served }))).toEqual({ outcome: "passed" });
  });

  it("refuses missing inputs, unknown or undisclosed rules, and checks that cover nothing", () => {
    for (const [changes, fact] of [
      [{ publicInput: null }, /inputs/u],
      [{ ruleIds: [] }, /rule ids/u],
      [{ checks: join(root, "nowhere") }, /brief.json/u],
      [{ ruleIds: ["span-rule", "wind-rule"] }, /wind-rule/u],
      [{ checks: program(["columns"], ["span-rule"]) }, /family beams/u],
      [{ checks: program("all", []) }, /spans.*rule/u],
      [{ checks: program("all", undefined) }, /spans.*rule/u],
      [{ ruleIds: ["load-rule"] }, /spans.*span-rule/u],
    ] satisfies [Partial<TaskPackage>, RegExp][]) {
      expect(packageGate(CONTRACT, pkg(changes))).toMatchObject({
        outcome: "refused",
        reason: expect.stringMatching(fact),
      });
    }
  });
});

describe("the task states", () => {
  const at = "2026-10-09T00:00:00.000Z";
  const proposedAs = (version: string): LogEvent => ({ at, kind: "task.proposed", data: { version } });
  const admissionAs = (version: string, number: number, outcome = "passed"): LogEvent => ({
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
  const admission = (number = 1, outcome = "passed") => admissionAs("v1", number, outcome);
  const state = (to: string) => stateAs("v1", to);
  const held = [proposed, admission()];

  it("holds a task out once it passes task admission, and no sooner", () => {
    expect(taskStates([proposed])).toEqual(new Map([["v1", "held"]]));
    expect(taskSets([proposed])).toMatchObject({ held: [], released: [] });
    expect(taskSets(held)).toMatchObject({ held: ["v1"], released: [] });
    // In the order they were proposed, whichever passed task admission first.
    const two = [proposedAs("v2"), proposed, admission(), admissionAs("v2", 1)];
    expect(taskSets(two).held).toEqual(["v2", "v1"]);
    expect(taskStates([proposed, admission(1, "refused"), state("refused")]).get("v1")).toBe("refused");
    expect(taskSets([proposed, admission(1, "refused"), state("refused")]).held).toEqual([]);
  });

  it("refuses a history that could not have happened", () => {
    for (const [events, fact] of [
      [[state("held")], /v1.*not proposed/u],
      [[proposed, proposed], /v1.*twice/u],
      [[{ at, kind: "task.state", data: { state: "held" } }], /task.state.*version/u],
      [[...held, admission()], /v1.*gate twice/u],
      [[proposed, state("released")], /held.*released.*gate/u],
      [[proposed, admission(1, "refused"), state("disputed")], /held.*disputed.*gate/u],
      [[...held, state("released"), state("held")], /released.*held/u],
      [[...held, state("disputed"), state("released")], /disputed.*released/u],
      [[...held, state("refused"), state("released")], /refused.*released/u],
      [[...held, state("promoted")], /held.*no known state/u],
    ] satisfies [LogEvent[], RegExp][]) {
      expect(() => taskStates(events)).toThrow(fact);
    }
  });
});
