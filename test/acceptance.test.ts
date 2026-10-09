// A checker's acceptance on a stand-in: two checks over two families, a verifier that decides from
// the answer alone, and controls labelled as v1's `controls.json` labels them. No wall and no tool
// runs here; the reading is what is under test.
import { describe, expect, it } from "bun:test";
import {
  acceptance,
  authoredFaults,
  type Control,
  departure,
  doNothingAnswer,
  doNothingFaults,
  frozenChecker,
  type Graded,
  regraded,
  runControls,
  runDoNothing,
} from "../src/kernel/acceptance.ts";
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

describe("a checker's acceptance", () => {
  it("finds no fault where every control gets its label and every check has refused and passed", async () => {
    const runs = await runControls(verify, [roof, mast], SOUND, 2);
    const { checks, faults } = acceptance(brief, [roof, mast], runs, [], everyTool);
    expect(faults).toEqual([]);
    // `span` applies to the roof task alone: its three controls, one of them refused by it.
    expect(checks).toEqual([
      { id: "mass", instrument: "external", missing: [], passed: 3, refused: 1, named: 1, caught: 1 },
      { id: "span", instrument: "authored", missing: [], passed: 2, refused: 1, named: 1, caught: 1 },
    ]);
  });

  it("names a control that did not get its label, and one answer that got two verdicts", async () => {
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
    const runs = await runControls(once, [roof], controls, 1);
    expect(acceptance(brief, [roof], runs, [], everyTool).faults.slice(0, 3)).toEqual([
      "the accept control of roof-1 did not pass: fail mass",
      "a reject control of roof-1 names span, which did not refuse it: pass",
      "the accept control of roof-1 got two verdicts from one answer: fail mass, then pass",
    ]);
  });

  it("asks that every check be seen to refuse and to pass, and that its tool be there", async () => {
    // One accept control and nothing else: no check has refused anything yet.
    const runs = await runControls(verify, [roof], SOUND.slice(0, 1), 1);
    const bare = acceptance(brief, [roof], runs, [], (tool) => tool !== "fe");
    expect(bare.faults).toEqual([
      "mass names fe, which is not on the verifier's tool path",
      "mass has refused nothing: no control and no stored answer",
      "span has refused nothing: no control and no stored answer",
    ]);
    // A stored answer a check refused shows it can refuse, and still no control names it; a verdict
    // that decided nothing shows nothing of any check.
    const stored: Graded[] = [
      { task: roof, verdict: { kind: "fail", blocking: ["mass", "span"] } },
      { task: roof, verdict: { kind: "non-result", reason: "the wall" } },
    ];
    const seen = acceptance(brief, [roof], runs, stored, everyTool);
    expect(seen.checks.map(({ id, passed, refused }) => [id, passed, refused])).toEqual([
      ["mass", 1, 1],
      ["span", 1, 1],
    ]);
    expect(seen.faults).toEqual([
      "mass has refused no reject control that names it",
      "span has refused no reject control that names it",
    ]);
  });

  it("names a check that could not run as the fault, and asks for no control in its place", async () => {
    // The roof task's short answers break `span` itself: its tool wrote nothing.
    const broken: Verifier = async (task, answer) =>
      isNumber(asRecord(answer)?.span)
        ? { kind: "faulty", check: "span", reason: "the tool wrote nothing" }
        : verify(task, answer);
    const runs = await runControls(broken, [roof, mast], SOUND, 2);
    expect(acceptance(brief, [roof, mast], runs, [], everyTool).faults).toEqual([
      "a reject control of roof-1 names span, which did not refuse it: faulty span: the tool wrote nothing",
      "span could not run on an answer, so what it refuses and passes is not read: the tool wrote nothing",
    ]);
  });

  it("holds a check its author's own computation decides to the operator's word, by name", async () => {
    const runs = await runControls(verify, [roof, mast], SOUND, 2);
    const { checks } = acceptance(brief, [roof, mast], runs, [], everyTool);
    // `mass` is decided by an installed instrument and needs no word; `span` is its author's own.
    expect(authoredFaults(checks, new Set())).toEqual([
      "span is decided by its author's own computation and no installed instrument: it stands on the operator's word alone (--admit span)",
    ]);
    expect(authoredFaults(checks, new Set(["mass"]))).toHaveLength(1);
    expect(authoredFaults(checks, new Set(["span"]))).toEqual([]);
  });

  it("stops on a control of a task the pack does not hold", async () => {
    const gone: Control = { taskId: "gone", answer: {}, refusedBy: null };
    await expect(runControls(verify, [roof], [gone], 1)).rejects.toThrow("a control names gone");
  });
});

describe("the do-nothing answer", () => {
  it("is the smallest value a format's schema allows", () => {
    expect(
      doNothingAnswer({
        type: "object",
        required: ["members", "mass", "name", "ok", "grade", "span"],
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
          optional: { type: "string" },
        },
      }),
    ).toEqual({ members: [{ id: "" }, { id: "" }], mass: 1, name: "xxx", ok: false, grade: "S235", span: 4 });
    expect(doNothingAnswer({ type: "array", items: { type: "number" } })).toEqual([]);
    expect(doNothingAnswer({ type: ["string", "null"] })).toBe("");
    expect(doNothingAnswer({ const: 7 })).toBe(7);
    expect(doNothingAnswer("prose, not a schema")).toBeNull();
  });

  it("must be rejected on every task: a pass is a fault, and so is a check that could not run on it", async () => {
    // This verifier passes an answer with no mass on a mast task, and its span check breaks on a
    // roof task's empty answer.
    const lax: Verifier = async (task, answer) =>
      task.family === "roof" && asRecord(answer)?.span === undefined
        ? { kind: "faulty", check: "span", reason: "no span to read" }
        : verify(task, answer);
    const idle = await runDoNothing(lax, [roof, mast], {}, 2);
    expect(doNothingFaults(idle)).toEqual([
      "the do-nothing answer was not rejected on roof-1: faulty span: no span to read",
      "the do-nothing answer was not rejected on mast-1: pass",
    ]);
    const strict: Verifier = async () => ({ kind: "fail", blocking: ["mass"] });
    expect(doNothingFaults(await runDoNothing(strict, [roof, mast], {}, 2))).toEqual([]);
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
    return isNumber(mass) && mass > 60 ? { kind: "fail", blocking: ["mass"] } : { kind: "pass" };
  };

  it("grades the last verdict of each solve again, and leaves out what no check decided", async () => {
    const events = [
      logged("a", "roof-1", { mass: 50 }, { kind: "non-result", reason: "the wall" }),
      logged("a", "roof-1", { mass: 50 }, { kind: "fail", blocking: ["mass"] }),
      logged("b", "roof-1", { mass: 70 }, { kind: "fail", blocking: ["mass"] }),
      logged("c", "mast-1", { mass: 5 }, { kind: "pass" }),
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
      { solve: "d", task: "roof-1", was: "faulty span: threw", now: "pass" },
      { solve: "gone", task: "hall-1", was: "pass", now: "no task" },
    ]);
  });
});
