import { afterAll, describe, expect, it } from "bun:test";
import { answerFormatFault, type Contract, contractHash } from "../src/kernel/contract.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import type { Counted } from "../src/kernel/solve.ts";
import {
  controlsGate,
  determinismGate,
  packageGate,
  type RejectControl,
  screen,
  type TaskPackage,
  taskStates,
  taskVersion,
} from "../src/kernel/task.ts";
import type { Task, Verdict, Verifier } from "../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    properties: { depth: { type: "number" }, steel: { type: "string" } },
    required: ["depth"],
    additionalProperties: false,
  },
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
const FAULTY: Verdict = { kind: "faulty", check: "spans", reason: "the check threw: no span" };

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
  const spans = (answer: JsonObject): RejectControl => ({ answer, expectedCheckId: "spans" });
  const answers: JsonObject[] = [{ depth: 0.5, steel: "S355" }, { depth: 1, steel: "S235" }, { depth: 1 }];
  const controls = answers.map(spans);

  it("passes three distinct edits each failed by the check it names, and names them by their digest", async () => {
    const verify = scripted(FAIL, FAIL, FAIL);
    expect(await controlsGate(CONTRACT, verify, pkg(), accepted, controls)).toEqual({
      outcome: "passed",
      controls: hashJsonValue(controls),
    });
    expect(verify.asked).toEqual(answers);
  });

  const refused = async (given: RejectControl[], ...verdicts: Verdict[]) => {
    const gate = await controlsGate(CONTRACT, scripted(...verdicts), pkg(), accepted, given);
    return gate.outcome === "passed" ? "passed" : gate.reason;
  };

  it("refuses the wrong count, a control that is no edit, and a control the check passes", async () => {
    expect(await refused(controls.slice(0, 2))).toBe("controls: 2, not 3");
    expect(await refused([...controls.slice(0, 2), spans({ steel: "S355", depth: 1 })])).toBe(
      "a control repeats the accepted answer or another control",
    );
    expect(await refused([...controls.slice(0, 2), spans(answers[0] ?? {})])).toBe(
      "a control repeats the accepted answer or another control",
    );
    expect(await refused(controls, FAIL, PASS)).toBe("the check passed control 2");
  });

  it("refuses junk the check fails for another reason, and junk outside the format before any check", async () => {
    const other: Verdict = { kind: "fail", blocking: ["loads"] };
    expect(await refused(controls, FAIL, other)).toBe("control 2 failed loads, not spans");
    const junk = [...controls.slice(0, 2), spans({ depth: "deep" })];
    const verify = scripted();
    const gate = await controlsGate(CONTRACT, verify, pkg(), accepted, junk);
    expect(gate).toEqual({ outcome: "refused", reason: "control 3 does not follow the answer format" });
    expect(verify.asked).toEqual([]);
  });
});

describe("a faulty check", () => {
  it("refuses the task at whichever gate meets it, and the run goes on", async () => {
    const accepted = { depth: 1 };
    const controls = [{ depth: 0.5 }, { depth: 2 }, { depth: 3 }].map((answer) => ({
      answer,
      expectedCheckId: "spans",
    }));
    expect(await determinismGate(scripted(PASS, FAULTY), pkg(), accepted)).toEqual({
      outcome: "refused",
      reason: "run 2: check spans: the check threw: no span",
    });
    expect(await controlsGate(CONTRACT, scripted(FAIL, FAULTY), pkg(), accepted, controls)).toEqual({
      outcome: "refused",
      reason: "control 2: check spans: the check threw: no span",
    });
  });
});

describe("a broken verifier", () => {
  it("stops the run at the first non-result, whichever gate asks", async () => {
    const stops = "the verifier could not decide beam-01, so the run stops: the wall broke";
    const accepted = { depth: 1 };
    const controls = [{ depth: 0.5 }, { depth: 2 }, { depth: 3 }].map((answer) => ({
      answer,
      expectedCheckId: "spans",
    }));
    expect(determinismGate(scripted(LOST, LOST), pkg(), accepted)).rejects.toThrow(stops);
    expect(determinismGate(scripted(PASS, LOST), pkg(), accepted)).rejects.toThrow(stops);
    expect(controlsGate(CONTRACT, scripted(FAIL, LOST, LOST), pkg(), accepted, controls)).rejects.toThrow(
      stops,
    );
  });
});

describe("gate 5, screening", () => {
  const pass: Counted = { outcome: "pass" };
  const fail = (kind: "rejected" | "wall-ended" | "no-answer"): Counted => ({ outcome: "fail", kind });

  it("admits a task either harness fails, and leaves one both pass as too easy", () => {
    expect(screen([[pass], [pass]], 1)).toBe("too-easy");
    expect(screen([[pass], [fail("rejected")]], 1)).toBe("admitted");
    expect(screen([[fail("no-answer")], [pass]], 1)).toBe("admitted");
  });

  it("holds a task whose only fails ended at the wall", () => {
    expect(screen([[pass], [fail("wall-ended")]], 1)).toBe("wall-bound");
    expect(screen([[fail("wall-ended")], [fail("wall-ended")]], 1)).toBe("wall-bound");
    expect(screen([[fail("wall-ended")], [fail("rejected")]], 1)).toBe("admitted");
  });

  it("refuses to screen with a broken harness, whose fail says nothing of the task", () => {
    const broken: Counted = { outcome: "fail", kind: "broken-harness", reason: "no tools" };
    expect(() => screen([[pass], [broken]], 1)).toThrow("a broken harness cannot screen a task: no tools");
  });

  it("screens on as many solves and fails as it is asked for, each harness counted alone", () => {
    const [slip, miss] = [fail("rejected"), fail("no-answer")];
    // Decision 26: three solves a harness, two fails by one of them.
    expect(
      screen(
        [
          [pass, slip, pass],
          [pass, pass, slip],
        ],
        2,
      ),
    ).toBe("too-easy");
    expect(
      screen(
        [
          [pass, slip, miss],
          [pass, pass, pass],
        ],
        2,
      ),
    ).toBe("admitted");
    // The harness that reached two fails did so at the wall; the other's one fail does not count.
    const walled = [fail("wall-ended"), fail("wall-ended"), pass];
    expect(screen([walled, [slip, pass, pass]], 2)).toBe("wall-bound");
    expect(() => screen([[pass], [slip]], 2)).toThrow("1 solve(s) of a harness cannot show 2 fail(s)");
  });
});

describe("the task states", () => {
  const at = "2026-10-07T00:00:00.000Z";
  const proposedAs = (version: string): LogEvent => ({ at, kind: "task.proposed", data: { version } });
  const gateAs = (version: string, number: number, outcome = "passed"): LogEvent => ({
    at,
    kind: "task.gate",
    data: { version, gate: number, outcome, controls: "digest" },
  });
  const feasibleAs = (version: string) => [
    proposedAs(version),
    ...[1, 2, 3, 4].map((n) => gateAs(version, n)),
  ];
  const proposed = proposedAs("v1");
  const gate = (number: number, outcome = "passed") => gateAs("v1", number, outcome);
  const state = (to: string): LogEvent => ({ at, kind: "task.state", data: { version: "v1", state: to } });
  const draw = (...tasks: string[]): LogEvent => ({ at, kind: "anchor.drawn", data: { tasks } });
  const drawn = [...feasibleAs("v0"), draw("v0")];
  const feasible = feasibleAs("v1");

  it("holds a proposed task and follows it through screening, scoring and release", () => {
    expect(taskStates([proposed])).toEqual(new Map([["v1", "held"]]));
    expect(taskStates([...drawn, ...feasible, state("admitted"), state("released")])).toEqual(
      new Map([
        ["v0", "held"],
        ["v1", "released"],
      ]),
    );
    expect(taskStates([...drawn, ...feasible, state("released")]).get("v1")).toBe("released");
    expect(taskStates([proposed, gate(1), gate(2, "too-hard"), state("too-hard")]).get("v1")).toBe(
      "too-hard",
    );
  });

  it("refuses a history that screens a task short of feasible, or moves one where it cannot go", () => {
    expect(() =>
      taskStates([proposed, gate(1), gate(2), gate(3), gate(4, "refused"), state("admitted")]),
    ).toThrow("task v1 cannot go from held to admitted");
    expect(() => taskStates([...drawn, ...feasible, state("released"), state("held")])).toThrow(
      "task v1 cannot go from released to held",
    );
    expect(() => taskStates([state("held")])).toThrow("task v1 is not proposed");
    expect(() => taskStates([proposed, proposed])).toThrow("task v1 is proposed twice");
    expect(() => taskStates([{ at, kind: "task.state", data: { state: "held" } }])).toThrow(
      "task.state names no task version",
    );
  });

  it("disputes a feasible task from screening, scoring or practice, and nothing follows a dispute", () => {
    const disputed = (...before: LogEvent[]) =>
      taskStates([...drawn, ...feasible, ...before, state("disputed")]).get("v1");
    expect(disputed()).toBe("disputed");
    expect(disputed(state("admitted"))).toBe("disputed");
    expect(disputed(state("released"))).toBe("disputed");
    expect(() => taskStates([...drawn, ...feasible, state("disputed"), state("admitted")])).toThrow(
      "task v1 cannot go from disputed to admitted",
    );
    expect(() => taskStates([proposed, gate(1), state("disputed")])).toThrow(
      "task v1 cannot go from held to disputed",
    );
  });

  it("refuses gates logged out of order, and any gate after one that did not pass", () => {
    const reversed = [proposed, gate(4), gate(3), gate(2), gate(1), gate(3, "refused"), state("admitted")];
    expect(() => taskStates(reversed)).toThrow("task v1 logs gate 4 out of order, after passing 0");
    expect(() => taskStates([proposed, gate(1), gate(3)])).toThrow(
      "logs gate 3 out of order, after passing 1",
    );
    expect(() => taskStates([proposed, gate(1), gate(2, "refused"), gate(2)])).toThrow(
      "task v1 logs gate 2 after its gates ended",
    );
    expect(() => taskStates([...feasible, gate(5)])).toThrow("logs gate 5 out of order, after passing 4");
    const refusedAt3 = [proposed, gate(1), gate(2), gate(3, "refused")];
    expect(taskStates([...refusedAt3, state("refused")]).get("v1")).toBe("refused");
    expect(() => taskStates([...refusedAt3, state("admitted")])).toThrow("cannot go from held to admitted");
  });

  it("never releases or admits a task the anchor drew, and draws only proposed, feasible tasks", () => {
    expect(() => taskStates([...feasible, draw("v1"), state("released")])).toThrow(
      "task v1 is an anchor task, so it is never released",
    );
    expect(() => taskStates([...drawn, ...feasible, state("released"), draw("v1")])).toThrow(
      "task v1 is drawn after its release",
    );
    expect(() => taskStates([...feasible, draw("v1"), state("admitted")])).toThrow(
      "task v1 is an anchor task, so it is never admitted",
    );
    expect(() => taskStates([...feasible, state("admitted"), draw("v1")])).toThrow(
      "task v1 is drawn after its admission",
    );
    expect(() => taskStates([{ at, kind: "anchor.drawn", data: {} }])).toThrow(
      "anchor.drawn names no task versions",
    );
    expect(() => taskStates([draw("v1")])).toThrow("task v1 is drawn before it is feasible");
    expect(() => taskStates([proposed, gate(1), gate(2, "too-hard"), draw("v1")])).toThrow(
      "task v1 is drawn before it is feasible",
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
    expect(() => taskStates([...feasible, state("admitted"), state("released"), ...drawn])).toThrow(
      "task v1 is released before the anchor is drawn",
    );
  });
});
