import { afterAll, describe, expect, it } from "bun:test";
import { type Contract, contractHash } from "../src/kernel/contract.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import type { Counted } from "../src/kernel/solve.ts";
import {
  controlsGate,
  determinismGate,
  packageGate,
  screen,
  type TaskPackage,
  taskStates,
  taskVersion,
} from "../src/kernel/task.ts";
import type { Task, Verdict, Verifier } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const CONTRACT: Contract = {
  answerFormat: { type: "object" },
  tools: [{ name: "solver", version: "1.0" }],
  install: "true",
  conventions: "SI units",
  rules: [
    { id: "span-rule", statement: "The beam spans the gap." },
    { id: "load-rule", statement: "The beam carries the load." },
  ],
  scope: "Simply supported beams.",
};

const PASS: Verdict = { kind: "pass" };
const FAIL: Verdict = { kind: "fail", blocking: ["spans"] };
const LOST: Verdict = { kind: "non-result", reason: "the wall broke" };

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
    statement: "Size a beam across the gap.",
    ruleIds: ["span-rule", "load-rule"],
    checks: program(["beams"], ["span-rule"]),
    ...changes,
  };
}

/** A verifier that answers from a script, one verdict per call, and records what it was asked. */
function scripted(...verdicts: Verdict[]): Verifier & { asked: (JsonValue | undefined)[] } {
  const asked: (JsonValue | undefined)[] = [];
  const verify = async (_task: Task, answer: JsonValue | undefined) => {
    asked.push(answer);
    const verdict = verdicts.shift();
    if (verdict === undefined) throw new Error("the script ran out");
    return verdict;
  };
  return Object.assign(verify, { asked });
}

describe("the contract", () => {
  it("hashes the same contract alike whatever its key order, and refuses a rule id named twice", () => {
    const { scope, ...rest } = CONTRACT;
    const reordered: Contract = { scope, ...rest };
    expect(contractHash(reordered)).toBe(contractHash(CONTRACT));
    expect(contractHash({ ...CONTRACT, scope: "Cantilevers." })).not.toBe(contractHash(CONTRACT));
    const twice = { ...CONTRACT, rules: [...CONTRACT.rules, { id: "span-rule", statement: "Again." }] };
    expect(() => contractHash(twice)).toThrow("names rule span-rule twice");
  });
});

describe("gate 1, gate", () => {
  it("versions a package by everything the solver reads and the check runs, wherever it is kept", () => {
    const task = pkg();
    const version = (changes: Partial<TaskPackage>) => taskVersion({ ...task, ...changes });
    expect(packageGate(CONTRACT, task)).toEqual({ outcome: "passed" });
    expect(version({ checks: program(["beams"], ["span-rule"]) })).toBe(version({}));
    expect(version({ statement: "Size a beam." })).not.toBe(version({}));
    expect(version({ ruleIds: ["span-rule"] })).not.toBe(version({}));
    const changed = program(["beams"], ["span-rule"], "export const checks = { spans: () => true };");
    expect(version({ checks: changed })).not.toBe(version({}));
    expect(version({ checks: join(root, "nowhere") })).not.toBe(version({}));
  });

  it("refuses a missing part, a rule the contract lacks, and a check program that would pass anything", () => {
    const reason = (changes: Partial<TaskPackage>) => {
      const gate = packageGate(CONTRACT, pkg(changes));
      return gate.outcome === "refused" ? gate.reason : "passed";
    };
    expect(reason({ statement: "  " })).toBe("no statement");
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

describe("gate 3, determinism", () => {
  it("passes when the check passes the accepted answer twice more", async () => {
    const verify = scripted(PASS, PASS);
    expect(await determinismGate(verify, pkg(), { depth: 1 })).toEqual({ outcome: "passed" });
    expect(verify.asked).toEqual([{ depth: 1 }, { depth: 1 }]);
  });

  it("refuses a check that changes its mind", async () => {
    expect(await determinismGate(scripted(PASS, FAIL), pkg(), {})).toEqual({
      outcome: "refused",
      reason: "run 2 failed the accepted answer on spans",
    });
  });
});

describe("gate 4, controls", () => {
  const accepted = { depth: 1, steel: "S355" };
  const controls = [{ depth: 0.5, steel: "S355" }, { depth: 1, steel: "S235" }, { depth: 1 }];

  it("passes three distinct edits the check fails, and names them by their digest", async () => {
    const verify = scripted(FAIL, FAIL, FAIL);
    expect(await controlsGate(verify, pkg(), accepted, controls)).toEqual({
      outcome: "passed",
      controls: hashJsonValue(controls),
    });
    expect(verify.asked).toEqual(controls);
  });

  it("refuses the wrong count, a control that is no edit, and a control the check passes", async () => {
    const refused = async (given: JsonObject[], ...verdicts: Verdict[]) => {
      const gate = await controlsGate(scripted(...verdicts), pkg(), accepted, given);
      return gate.outcome === "passed" ? "passed" : gate.reason;
    };
    expect(await refused(controls.slice(0, 2))).toBe("controls: 2, not 3");
    expect(await refused([...controls.slice(0, 2), { steel: "S355", depth: 1 }])).toBe(
      "a control repeats the accepted answer or another control",
    );
    expect(await refused([...controls.slice(0, 2), controls[0] ?? {}])).toBe(
      "a control repeats the accepted answer or another control",
    );
    expect(await refused(controls, FAIL, PASS)).toBe("the check passed control 2");
  });
});

describe("a broken verifier", () => {
  it("stops the run at the first non-result, whichever gate asks", async () => {
    const stops = "the verifier could not decide beam-01, so the run stops: the wall broke";
    const accepted = { depth: 1 };
    const controls = [{ depth: 0.5 }, { depth: 2 }, {}];
    expect(determinismGate(scripted(LOST, LOST), pkg(), accepted)).rejects.toThrow(stops);
    expect(determinismGate(scripted(PASS, LOST), pkg(), accepted)).rejects.toThrow(stops);
    expect(controlsGate(scripted(FAIL, LOST, LOST), pkg(), accepted, controls)).rejects.toThrow(stops);
  });
});

describe("gate 5, screening", () => {
  const pass: Counted = { outcome: "pass" };
  const fail = (kind: "rejected" | "wall-ended" | "no-answer"): Counted => ({ outcome: "fail", kind });

  it("admits a task either harness fails, and leaves one both pass as too easy", () => {
    expect(screen([pass, pass])).toBe("too-easy");
    expect(screen([pass, fail("rejected")])).toBe("admitted");
    expect(screen([fail("no-answer"), pass])).toBe("admitted");
  });

  it("holds a task whose only fails ended at the wall", () => {
    expect(screen([pass, fail("wall-ended")])).toBe("wall-bound");
    expect(screen([fail("wall-ended"), fail("wall-ended")])).toBe("wall-bound");
    expect(screen([fail("wall-ended"), fail("rejected")])).toBe("admitted");
  });
});

describe("the task states", () => {
  const at = "2026-10-07T00:00:00.000Z";
  const proposed: LogEvent = { at, kind: "task.proposed", data: { version: "v1" } };
  const gate = (number: number, outcome = "passed"): LogEvent => ({
    at,
    kind: "task.gate",
    data: { version: "v1", gate: number, outcome, controls: "digest" },
  });
  const state = (to: string): LogEvent => ({ at, kind: "task.state", data: { version: "v1", state: to } });
  const drawn: LogEvent = { at, kind: "anchor.drawn", data: {} };
  const feasible = [proposed, gate(1), gate(2), gate(3), gate(4)];

  it("holds a proposed task and follows it through screening, scoring and release", () => {
    expect(taskStates([proposed])).toEqual(new Map([["v1", "held"]]));
    expect(taskStates([drawn, ...feasible, state("admitted"), state("released")])).toEqual(
      new Map([["v1", "released"]]),
    );
    expect(taskStates([drawn, ...feasible, state("released")]).get("v1")).toBe("released");
    expect(taskStates([proposed, gate(1), gate(2, "too-hard"), state("too-hard")]).get("v1")).toBe(
      "too-hard",
    );
  });

  it("refuses a history that screens a task short of feasible, or moves one where it cannot go", () => {
    expect(() =>
      taskStates([proposed, gate(1), gate(2), gate(3), gate(4, "refused"), state("admitted")]),
    ).toThrow("task v1 cannot go from held to admitted");
    expect(() => taskStates([drawn, ...feasible, state("released"), state("held")])).toThrow(
      "task v1 cannot go from released to held",
    );
    expect(() => taskStates([state("held")])).toThrow("task v1 is not proposed");
    expect(() => taskStates([proposed, proposed])).toThrow("task v1 is proposed twice");
    expect(() => taskStates([{ at, kind: "task.state", data: { state: "held" } }])).toThrow(
      "task.state names no task version",
    );
  });

  it("refuses a gate 4 pass on no named control set, and a release before the anchor is drawn", () => {
    const unnamed: LogEvent = { at, kind: "task.gate", data: { version: "v1", gate: 4, outcome: "passed" } };
    expect(() => taskStates([proposed, gate(1), gate(2), gate(3), unnamed])).toThrow(
      "task v1 passed gate 4 on no named control set",
    );
    expect(() => taskStates([...feasible, state("released")])).toThrow(
      "task v1 is released before the anchor is drawn",
    );
    expect(() => taskStates([...feasible, state("admitted"), state("released"), drawn])).toThrow(
      "task v1 is released before the anchor is drawn",
    );
  });
});
