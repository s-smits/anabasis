// A checker's acceptance on a stand-in: two checks over two families, a verifier that decides from
// the answer alone, and controls labelled as v1's `controls.json` labels them. No wall and no tool
// runs here; the reading is what is under test.
import { describe, expect, it } from "bun:test";
import {
  authoredFaults,
  type Control,
  departure,
  frozenChecker,
  type Graded,
  type Read,
  readChecker,
  regraded,
  runControls,
  unadmitted,
} from "../src/kernel/acceptance.ts";
import type { Contract } from "../src/kernel/contract.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import type { Brief, Task, Verifier } from "../src/kernel/verify.ts";
import { asRecord, isNumber, type JsonObject } from "../src/meta/json-shape.ts";

const brief: Brief = {
  correctnessContract: "check-program/v1",
  truthChecks: [
    {
      id: "mass",
      citedDecisionIds: ["r1"],
      execution: {
        families: "all",
        artifactPaths: ["$"],
        publicInputPaths: [],
        hidden: "none",
        evidence: { kind: "external", requiredToolIds: ["fe"] },
      },
    },
    {
      id: "span",
      citedDecisionIds: ["r2"],
      execution: {
        families: ["roof"],
        artifactPaths: ["$"],
        publicInputPaths: [],
        hidden: "none",
        evidence: { kind: "authored" },
      },
    },
  ],
};
const roof: Task = { taskId: "roof-1", family: "roof", publicInput: null, hidden: null };
const mast: Task = { taskId: "mast-1", family: "mast", publicInput: null, hidden: null };
/** A format whose do-nothing answer, `{ mass: 11 }`, `mass` refuses on every task, so a reading's
 *  faults are its controls' and its checks' alone. */
const HEAVY: Contract = {
  answerFormat: { type: "object", required: ["mass"], properties: { mass: { type: "number", minimum: 11 } } },
  conventions: "",
  rules: [],
  scope: "",
};
const SOUND: Control[] = [
  { taskId: "roof-1", answer: { mass: 5 }, refusedBy: null },
  { taskId: "roof-1", answer: { mass: 50 }, refusedBy: "mass" },
  { taskId: "roof-1", answer: { mass: 5, span: 1 }, refusedBy: "span" },
  { taskId: "mast-1", answer: { mass: 5 }, refusedBy: null },
];

/** Refuses a heavy answer by `mass`, and on a roof task a short one by `span`. */
const verify: Verifier = async (task, answer) => {
  const fields = asRecord(answer);
  const heavy = isNumber(fields?.mass) && fields.mass > 10;
  const short = task.family === "roof" && isNumber(fields?.span) && fields.span < 5;
  const blocking = [...(heavy ? ["mass"] : []), ...(short ? ["span"] : [])];
  return blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
};
const everyTool = () => true;
/** A reading as the acceptance command makes one: the controls put to the checks, nothing stored. */
const reading = (given: Partial<Read> & Pick<Read, "tasks" | "controls">) =>
  readChecker({ brief, contract: HEAVY, verify, stored: [], found: everyTool, width: 2, ...given });
/** A reading over two tasks under `answerFormat`, with no control, by checks that pass every
 *  answer unless `checks` says otherwise. */
const readUnder = (answerFormat: JsonObject, checks: Verifier = async () => ({ kind: "pass" })) => {
  const contract: Contract = { answerFormat, conventions: "", rules: [], scope: "" };
  return reading({ contract, verify: checks, tasks: [roof, mast], controls: [] });
};

describe("a checker's acceptance", () => {
  it("finds no fault where every control gets its label and every check has refused and passed", async () => {
    const { checks, faults } = await reading({ tasks: [roof, mast], controls: SOUND });
    expect(faults).toEqual([]);
    // `span` applies to the roof task alone: its three controls, one of them refused by it.
    expect(checks).toEqual([
      { id: "mass", instrument: "fe", missing: [], passed: 3, refused: 1, named: 1, caught: 1 },
      { id: "span", instrument: "author", missing: [], passed: 2, refused: 1, named: 1, caught: 1 },
    ]);
  });

  it("names a control that did not get its label, one answer that got two verdicts, and a check that refused no reject control naming it", async () => {
    let calls = 0;
    const once: Verifier = async (task, answer) =>
      asRecord(answer)?.flaky === true && calls++ === 0
        ? { kind: "fail", blocking: ["mass"] }
        : verify(task, answer);
    const controls: Control[] = [
      { taskId: "roof-1", answer: { mass: 50 }, refusedBy: null },
      { taskId: "roof-1", answer: { mass: 5 }, refusedBy: "span" },
      { taskId: "roof-1", answer: { mass: 5, flaky: true }, refusedBy: null },
    ];
    const read = await reading({ verify: once, tasks: [roof], controls, width: 1 });
    expect(read.faults).toEqual([
      "the accept control of roof-1 did not pass: fail mass",
      "a reject control of roof-1 names span, which did not refuse it: pass",
      "the accept control of roof-1 got two verdicts from one answer: fail mass, then pass",
      // `mass` refused two accept controls and no control names it.
      "mass has refused no reject control that names it",
      "span has refused nothing in this reading",
    ]);
  });

  it("asks that every check be seen to refuse and to pass, and that its tool be there", async () => {
    // One accept control and nothing else: no check has refused anything yet.
    const accepted = { tasks: [roof], controls: SOUND.slice(0, 1), width: 1 };
    const bare = await reading({ ...accepted, found: (tool) => tool !== "fe" });
    expect(bare.faults).toEqual([
      "mass names fe, which is not on the verifier's tool path",
      "mass has refused nothing in this reading",
      "span has refused nothing in this reading",
    ]);
    // A stored answer a check refused shows it can refuse, read apart from this reading's controls,
    // whose faults it does not clear; a verdict that decided nothing shows nothing of any check.
    const stored: Graded[] = [
      { task: roof, verdict: { kind: "fail", blocking: ["mass", "span"] } },
      { task: roof, verdict: { kind: "non-result", reason: "the wall" } },
    ];
    const seen = await reading({ ...accepted, stored });
    expect(seen.historical.map(({ id, passed, refused }) => [id, passed, refused])).toEqual([
      ["mass", 0, 1],
      ["span", 0, 1],
    ]);
    expect(seen.faults).toEqual([
      "mass has refused nothing in this reading",
      "span has refused nothing in this reading",
    ]);
  });

  it("names a check that could not run as the fault, and asks for no control in its place", async () => {
    // The roof task's short answers break `span` itself: its tool wrote nothing.
    const broken: Verifier = async (task, answer) =>
      isNumber(asRecord(answer)?.span)
        ? { kind: "faulty", check: "span", reason: "the tool wrote nothing" }
        : verify(task, answer);
    expect((await reading({ verify: broken, tasks: [roof, mast], controls: SOUND })).faults).toEqual([
      "a reject control of roof-1 names span, which did not refuse it: faulty span: the tool wrote nothing",
      "span could not run on an answer, so what it refuses and passes is not read: the tool wrote nothing",
    ]);
  });

  it("holds a check its author's own computation decides to the operator's word, by name", async () => {
    const { checks } = await reading({ tasks: [roof, mast], controls: SOUND });
    // `mass` is decided by an installed instrument and needs no word; `span` is its author's own.
    expect(authoredFaults(checks, new Set())).toEqual([
      "span is decided by its author's own computation and no installed instrument: it stands on the operator's word alone (--admit span)",
    ]);
    expect(authoredFaults(checks, new Set(["mass"]))).toHaveLength(1);
    expect(authoredFaults(checks, new Set(["span"]))).toEqual([]);
  });

  it("names a check's instrument by the tool it runs, whatever its brief labels it, and refuses an exam no engine decides until every check is admitted", async () => {
    // buffer-141-m3 (12 October): checks labelled `authored` that ran the pack's engine read as
    // their author's own computation. esp32-141-m3b's draft: nine checks, no tool behind any.
    const engined: Brief = {
      ...brief,
      truthChecks: brief.truthChecks.map((check) =>
        check.id === "span"
          ? { ...check, execution: { ...check.execution, requiredToolIds: ["ccx", "gmsh"] } }
          : check,
      ),
    };
    const sound = { tasks: [roof, mast], controls: SOUND };
    const { checks: read } = await reading({ ...sound, brief: engined });
    expect(read.map(({ id, instrument }) => [id, instrument])).toEqual([
      ["mass", "fe"],
      ["span", "ccx, gmsh"],
    ]);
    expect(authoredFaults(read, new Set())).toEqual([]);
    const drafted: Brief = {
      ...brief,
      truthChecks: brief.truthChecks.map((check) => ({
        ...check,
        execution: { ...check.execution, evidence: { kind: "authored" } },
      })),
    };
    const { checks: none } = await reading({ ...sound, brief: drafted });
    expect(none.map(({ instrument }) => instrument)).toEqual(["author", "author"]);
    expect(authoredFaults(none, new Set(["span"]))).toEqual([
      "mass is decided by its author's own computation and no installed instrument: it stands on the operator's word alone (--admit mass)",
    ]);
    expect(authoredFaults(none, new Set(["mass", "span"]))).toEqual([]);
    // The log's last reading names what the operator's word is still wanted for.
    const logged = (admitted: string[]): LogEvent => ({
      at: "2026-10-12T00:00:00.000Z",
      kind: "checker.read",
      data: { rows: none.map(({ id, instrument }) => ({ id, instrument })), admitted },
    });
    expect(unadmitted([logged(["span"])])).toEqual(["mass"]);
    expect(unadmitted([logged(["span"]), logged(["mass", "span"])])).toEqual([]);
  });

  it("reads the objective as its author's own computation, seen to measure a valid answer or none", async () => {
    const measured: Brief = { ...brief, objective: { quantity: "mass in kg", direction: "lower" } };
    const weighed: Verifier = async (task, answer) => {
      const verdict = await verify(task, answer);
      const mass = asRecord(answer)?.mass;
      return verdict.kind === "pass" && isNumber(mass) ? { kind: "pass", objective: mass } : verdict;
    };
    const sound = { brief: measured, tasks: [roof, mast], controls: SOUND };
    const { checks, faults } = await reading({ ...sound, verify: weighed });
    expect(faults).toEqual([]);
    expect(checks.at(-1)).toEqual({
      id: "objective",
      instrument: "author",
      missing: [],
      passed: 2,
      refused: 0,
      named: 0,
      caught: 0,
    });
    // It waits on the operator's word like a check, under its own name.
    expect(authoredFaults(checks, new Set(["span"]))).toEqual([
      "objective is decided by its author's own computation and no installed instrument: it stands on the operator's word alone (--admit objective)",
    ]);
    expect(authoredFaults(checks, new Set(["span", "objective"]))).toEqual([]);
    // The measure is part of the verdict, so a control measured twice at two values is one answer
    // with two verdicts, as a check that decides twice is.
    let weighings = 0;
    const drifting: Verifier = async (task, answer) => {
      const verdict = await weighed(task, answer);
      weighings += 1;
      return verdict.kind === "pass" ? { ...verdict, objective: weighings } : verdict;
    };
    const drifted = {
      brief: measured,
      verify: drifting,
      tasks: [roof],
      controls: SOUND.slice(0, 1),
      width: 1,
    };
    expect((await reading(drifted)).faults[0]).toBe(
      "the accept control of roof-1 got two verdicts from one answer: pass 1, then pass 2",
    );
    // A verifier that measures nothing, or cannot, is a fault of the objective's and of no check.
    expect((await reading(sound)).faults).toEqual(["objective has measured nothing in this reading"]);
    const broken: Verifier = async (task, answer) => {
      const verdict = await verify(task, answer);
      return verdict.kind === "pass"
        ? { kind: "faulty", check: "objective", reason: "the objective returned NaN" }
        : verdict;
    };
    expect((await reading({ ...sound, verify: broken })).faults).toEqual([
      "the accept control of roof-1 did not pass: faulty objective: the objective returned NaN",
      "the accept control of mast-1 did not pass: faulty objective: the objective returned NaN",
      "objective could not be measured on a valid answer: the objective returned NaN",
    ]);
  });

  it("stops on a control of a task the pack does not hold", async () => {
    const gone: Control = { taskId: "gone", answer: {}, refusedBy: null };
    await expect(runControls(verify, [roof], [gone], 1)).rejects.toThrow("a control names gone");
  });
});

describe("the do-nothing answer", () => {
  it("is the smallest value a format's schema allows", async () => {
    const { idle, unformed } = await readUnder({
      type: "object",
      // `free` is required and given no schema, so nothing says what it holds.
      required: ["members", "mass", "name", "ok", "grade", "span", "list", "either", "seven", "free"],
      properties: {
        members: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string" }, note: { type: "string" } },
          },
        },
        mass: { type: "number", exclusiveMinimum: 0 },
        name: { type: "string", minLength: 3 },
        ok: { type: "boolean" },
        grade: { enum: ["S235", "S355"] },
        span: { anyOf: [{ type: "integer", minimum: 4 }, { type: "null" }] },
        list: { type: "array", items: { type: "number" } },
        either: { type: ["string", "null"] },
        seven: { const: 7 },
        optional: { type: "string" },
      },
    });
    expect(idle).toEqual({
      members: [{ id: "" }, { id: "" }],
      mass: 1,
      name: "xxx",
      ok: false,
      grade: "S235",
      span: 4,
      list: [],
      either: "",
      seven: 7,
      free: null,
    });
    expect(unformed).toBeNull();
  });

  it("must be rejected on every task: a pass is a fault, and so is a check that could not run on it", async () => {
    // This verifier passes an answer with no mass on a mast task, and its span check breaks on a
    // roof task's empty answer.
    const lax: Verifier = async (task, answer) =>
      task.family === "roof" && asRecord(answer)?.span === undefined
        ? { kind: "faulty", check: "span", reason: "no span to read" }
        : verify(task, answer);
    const idleFaults = async (checks: Verifier) =>
      (await readUnder({ type: "object" }, checks)).faults.filter((fault) =>
        fault.startsWith("the do-nothing"),
      );
    expect(await idleFaults(lax)).toEqual([
      "the do-nothing answer was not rejected on roof-1: faulty span: no span to read",
      "the do-nothing answer was not rejected on mast-1: pass",
    ]);
    const strict: Verifier = async () => ({ kind: "fail", blocking: ["mass"] });
    expect(await idleFaults(strict)).toEqual([]);
  });
});

describe("a reading of a checker", () => {
  it("keeps historical verdicts apart from fresh controls and cannot use them to clear a fresh fault", async () => {
    const contract: Contract = { answerFormat: { type: "object" }, conventions: "", rules: [], scope: "" };
    const stored = [{ task: roof, verdict: { kind: "pass" } }] as const;
    const read = await reading({ contract, tasks: [roof], controls: SOUND.slice(1, 2), stored, width: 1 });
    expect(read.checks[0]).toMatchObject({ passed: 0, refused: 1 });
    expect(read.historical[0]).toMatchObject({ passed: 1, refused: 0 });
    expect(read.faults).toContain("mass has let nothing pass in this reading");
  });

  const mass = (field: JsonObject) => ({ type: "object", properties: { mass: field }, required: ["mass"] });

  it("lists a do-nothing answer the checks let pass, and one the format refuses, as faults of its own", async () => {
    const passed = await readUnder(mass({ type: "string" }));
    expect(passed.faults.filter((fault) => fault.startsWith("the do-nothing"))).toEqual([
      "the do-nothing answer was not rejected on roof-1: pass",
      "the do-nothing answer was not rejected on mast-1: pass",
    ]);
    const unformed = await readUnder(mass({ type: "string", pattern: "^[0-9]+$" }));
    expect(unformed.rejected).toEqual([]);
    expect(unformed.faults.filter((fault) => fault.startsWith("the do-nothing"))).toEqual([
      `the do-nothing answer {"mass":""} does not follow the answer format (${unformed.unformed ?? ""}), so no check was seen to refuse it: the host builds it from the schema's types, required properties, minimums, least lengths and counts, first enumerated or constant values and first choices, and reads no other keyword`,
    ]);
    expect(unformed.unformed).toContain("pattern");
  });
});

describe("a frozen checker", () => {
  const froze = (contract: string, checks: string): LogEvent => ({
    at: "2026-10-08T00:00:00.000Z",
    kind: "contract.frozen",
    data: { contract, checks },
  });
  const own = { contract: "c-1", checks: "p-1" };

  it("is the last one the log froze, and none before the operator's word", () => {
    expect(frozenChecker([])).toBeNull();
    expect(departure([], own)).toBeNull();
    expect(frozenChecker([froze("c-0", "p-0"), froze("c-1", "p-1")])).toEqual(own);
    expect(departure([froze("c-1", "p-1")], own)).toBeNull();
  });

  it("names what of a campaign's checker is not what the log froze", () => {
    const repaired = "a changed checker takes a campaign of its own";
    expect(departure([froze("c-1", "p-0")], own)).toBe(`the log froze another check program; ${repaired}`);
    expect(departure([froze("c-0", "p-0")], own)).toBe(
      `the log froze another contract and check program; ${repaired}`,
    );
  });
});

describe("a log's answers under a repaired checker", () => {
  const at = "2026-10-08T00:00:00.000Z";
  const logged = (solve: string, task: string, answer: JsonObject, verdict: JsonObject): LogEvent => ({
    at,
    kind: "verdict",
    data: { solve, task, answer, ...verdict },
  });
  /** The repair: `mass` refuses past 60 and no longer past 10. */
  const repaired: Verifier = async (_task, answer) => {
    const mass = asRecord(answer)?.mass;
    if (isNumber(mass) && mass > 60) return { kind: "fail", blocking: ["mass"] };
    return isNumber(mass) && mass === 7 ? { kind: "pass", objective: 7 } : { kind: "pass" };
  };

  it("grades the last verdict of each solve again, and leaves out what no check decided", async () => {
    const events = [
      logged("a", "roof-1", { mass: 50 }, { kind: "non-result", reason: "the wall" }),
      logged("a", "roof-1", { mass: 50 }, { kind: "fail", blocking: ["mass"] }),
      logged("b", "roof-1", { mass: 70 }, { kind: "fail", blocking: ["mass"] }),
      logged("c", "mast-1", { mass: 5 }, { kind: "pass" }),
      // A measured pass keeps its measure through the regrading: the repair measures the same.
      logged("m", "mast-1", { mass: 7 }, { kind: "pass", objective: 7 }),
      logged("d", "roof-1", { mass: 5 }, { kind: "faulty", check: "span", reason: "threw" }),
      logged("gone", "hall-1", { mass: 5 }, { kind: "pass" }),
      // No check ran on an answer outside the format, and a non-result decided nothing.
      logged("format", "roof-1", { mass: "5" }, { kind: "fail", fault: "mass is no number" }),
      logged("wall", "roof-1", { mass: 5 }, { kind: "non-result", reason: "the wall" }),
    ];
    expect(await regraded(events, [roof, mast], repaired, 2)).toEqual([
      { solve: "a", task: "roof-1", was: "fail mass", now: "pass" },
      { solve: "b", task: "roof-1", was: "fail mass", now: "fail mass" },
      { solve: "c", task: "mast-1", was: "pass", now: "pass" },
      { solve: "m", task: "mast-1", was: "pass 7", now: "pass 7" },
      { solve: "d", task: "roof-1", was: "faulty span: threw", now: "pass" },
      { solve: "gone", task: "hall-1", was: "pass", now: "no task" },
    ]);
  });
});
