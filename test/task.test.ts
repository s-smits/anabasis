// A task: the contract it is written against, the one gate its package passes, and the states a
// log folds it into. A stronger solve, a repeat of the checks, per-task controls and screening are
// gone with the plan after the v1 review (`docs/plan.md`), and what a log written before it holds
// of them is read here as history.
import { afterAll, describe, expect, it } from "bun:test";
import { answerFormatFault, type Contract, contractHash } from "../src/kernel/contract.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { packageGate, type TaskPackage, taskSets, taskStates, taskVersion } from "../src/kernel/task.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
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

describe("the contract", () => {
  it("hashes the same contract alike whatever its key order, and refuses a rule id named twice", () => {
    const { scope, ...rest } = CONTRACT;
    const reordered: Contract = { scope, ...rest };
    expect(contractHash(reordered)).toBe(contractHash(CONTRACT));
    expect(contractHash({ ...CONTRACT, scope: "Cantilevers." })).not.toBe(contractHash(CONTRACT));
    const twice = { ...CONTRACT, rules: [...CONTRACT.rules, { id: "span-rule", statement: "Again." }] };
    expect(() => contractHash(twice)).toThrow("names rule span-rule twice");
    // v1's prose artifact rows, which the validator would read as no constraint at all.
    const prose = { ...CONTRACT, answerFormat: [{ name: "design", shape: "object {joints}" }] };
    expect(() => contractHash(prose)).toThrow("not a JSON Schema");
    expect(() => answerFormatFault(prose, { junk: 1 })).toThrow("not a JSON Schema");
  });

  it("says why an answer is outside its format, and refuses one that fits only once coerced", () => {
    expect(answerFormatFault(CONTRACT, { depth: 1, steel: "S355" })).toBeNull();
    expect(answerFormatFault(CONTRACT, { steel: "S355" })).toContain("must have required properties depth");
    expect(answerFormatFault(CONTRACT, [1])).toContain("root: must be object");
    // pi-ai's validator would read "1" as 1 and drop the null; the caller's value stays as it was.
    const coercible = { depth: "1", steel: null };
    expect(answerFormatFault(CONTRACT, coercible)).toBe("the answer follows the format only once coerced");
    expect(coercible).toEqual({ depth: "1", steel: null });
  });
});

describe("the gate", () => {
  it("versions a package by everything the solver reads and the check runs, wherever it is kept", () => {
    const task = pkg();
    const version = (changes: Partial<TaskPackage>) => taskVersion({ ...task, ...changes });
    expect(packageGate(CONTRACT, task)).toEqual({ outcome: "passed" });
    expect(version({ checks: program(["beams"], ["span-rule"]) })).toBe(version({}));
    expect(version({ ruleIds: ["span-rule"] })).not.toBe(version({}));
    const changed = program(["beams"], ["span-rule"], "export const checks = { spans: () => true };");
    expect(version({ checks: changed })).not.toBe(version({}));
    expect(version({ checks: join(root, "nowhere") })).not.toBe(version({}));
  });

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

  it("versions every file of the check program, in nested directories too", () => {
    const version = (checks: string) => taskVersion(pkg({ checks }));
    const nested = (model: string) => {
      const checks = program(["beams"], ["span-rule"]);
      mkdirSync(join(checks, "reference"));
      writeFileSync(join(checks, "reference", "model.ts"), model);
      return checks;
    };
    expect(version(nested("export const k = 1;"))).toBe(version(nested("export const k = 1;")));
    expect(version(nested("export const k = 2;"))).not.toBe(version(nested("export const k = 1;")));
  });

  it("refuses a check program with a symlink in it, and still versions it", () => {
    const linked = program(["beams"], ["span-rule"]);
    symlinkSync("/etc/hosts", join(linked, "model.ts"));
    expect(packageGate(CONTRACT, pkg({ checks: linked }))).toEqual({
      outcome: "refused",
      reason: "the check program's model.ts is neither a file nor a directory",
    });
    expect(taskVersion(pkg({ checks: linked }))).toMatch(/^[0-9a-f]{64}$/);
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

  it("releases a held-out task for practice, and disputes one from either set", () => {
    expect(taskSets([...held, state("released")])).toMatchObject({ held: [], released: ["v1"] });
    expect(taskStates([...held, state("disputed")]).get("v1")).toBe("disputed");
    const disputed = [...held, state("released"), state("disputed")];
    expect(taskStates(disputed).get("v1")).toBe("disputed");
    expect(taskSets(disputed)).toMatchObject({ held: [], released: [] });
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

  it("reads a log written before the plan: what a stronger solve and a screening said moves no task", () => {
    const old = (version: string) => [proposedAs(version), ...[1, 2, 3, 4].map((n) => gateAs(version, n))];
    // The anchor's draw, an admission, a second admission and a retirement all leave a task held out.
    const screened = [
      ...old("v0"),
      { at, kind: "anchor.drawn", data: { tasks: ["v0"] } } as const,
      ...old("v1"),
      state("admitted"),
      state("admitted"),
      state("too-easy"),
    ];
    expect(taskSets(screened)).toMatchObject({ held: ["v0", "v1"] });
    expect(taskStates(screened).get("v1")).toBe("held");
    // A task no stronger solve passed is a held-out task with no valid answer yet.
    const reach = [proposed, gate(), gate(2, "too-hard"), state("too-hard"), gate(2, "too-hard")];
    expect(taskSets(reach).held).toEqual(["v1"]);
    // One set aside at the wall and returned under a longer one was held throughout.
    const walled = [
      ...old("v1"),
      state("wall-bound"),
      { ...state("held"), data: { version: "v1", state: "held", limits: {} } },
    ];
    expect(taskStates(walled).get("v1")).toBe("held");
    // A later gate that refused a task was followed by its refusal, which stands.
    const refused = [proposed, gate(), gate(2), gate(3, "refused"), state("refused")];
    expect(taskStates(refused).get("v1")).toBe("refused");
    // A task admitted and then released is a practice task, as it was.
    expect(taskSets([...old("v1"), state("admitted"), state("released")])).toMatchObject({
      held: [],
      released: ["v1"],
    });
    // Those states are read from held alone: none of them follows a release or a dispute.
    expect(() => taskStates([...held, state("released"), state("admitted")])).toThrow(
      "task v1 cannot go from released to admitted",
    );
  });
});
