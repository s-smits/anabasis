// A checker's acceptance on a stand-in: two checks over two families, a verifier that decides from
// the answer alone, and controls labelled as v1's `controls.json` labels them. No wall and no tool
// runs here; the reading is what is under test.
import { describe, expect, it } from "bun:test";
import {
  authoredFaults,
  type Control,
  departure,
  type Graded,
  type Read,
  readChecker,
  runControls,
  unadmitted,
  unreadFields,
} from "../src/kernel/acceptance.ts";
import type { Contract } from "../src/kernel/contract.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import type { Brief, Task, Verifier } from "../src/kernel/verify.ts";
import { asRecord, isNumber, type JsonObject } from "../src/meta/json-shape.ts";
import { matching } from "./helpers/matchers.ts";

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
const ignored: Verifier = async () => ({ kind: "pass" });
/** A reading as the acceptance command makes one: the controls put to the checks, nothing stored. */
const reading = (given: Partial<Read> & Pick<Read, "tasks" | "controls">) =>
  readChecker({ brief, contract: HEAVY, verify, stored: [], found: () => true, width: 2, ...given });
/** A reading over two tasks under `answerFormat`, with no control, by checks that pass every
 *  answer unless `checks` says otherwise. */
const readUnder = (answerFormat: JsonObject, checks: Verifier = ignored) => {
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
      matching(/accept.*roof-1.*fail mass/u),
      matching(/reject.*roof-1.*span.*: pass$/u),
      matching(/roof-1.*fail mass.*pass$/u),
      matching(/mass.*no reject control/u),
      matching(/span.*refused nothing/u),
    ]);
  });

  it("asks that every check be seen to refuse and to pass, and that its tool be there", async () => {
    // One accept control and nothing else: no check has refused anything yet.
    const accepted = { tasks: [roof], controls: SOUND.slice(0, 1), width: 1 };
    const bare = await reading({ ...accepted, found: (tool) => tool !== "fe" });
    expect(bare.faults).toEqual([
      matching(/mass.*fe.*tool path/u),
      matching(/mass.*refused nothing/u),
      matching(/span.*refused nothing/u),
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
    expect(seen.faults).toEqual([matching(/mass.*refused nothing/u), matching(/span.*refused nothing/u)]);
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
    expect(authoredFaults(none, new Set(["span"]))).toEqual([matching(/mass.*--admit mass/u)]);
    expect(authoredFaults(none, new Set(["mass", "span"]))).toEqual([]);
    // The log's last reading names what the operator's word is still wanted for.
    const logged = (admitted: string[]): LogEvent => ({
      at: "2026-10-12T00:00:00.000Z",
      kind: "checker.read",
      data: { rows: none.map(({ id, instrument }) => ({ id, instrument })), admitted },
    });
    expect(unadmitted([logged(["span"])])).toEqual(["mass"]);
    expect(unadmitted([logged(["span"]), logged(["mass", "span"])])).toEqual([]);
    // Every check its author decides, admitted or not, for the closing report.
    expect(unadmitted([logged(["span"])], [])).toEqual(["mass", "span"]);
  });
});

describe("the objective's acceptance", () => {
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
    expect(authoredFaults(checks, new Set(["span"]))).toEqual([matching(/objective.*--admit objective/u)]);
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
    expect((await reading(drifted)).faults[0]).toMatch(/roof-1.*pass 1.*pass 2/u);
    // A verifier that measures nothing, or cannot, is a fault of the objective's and of no check.
    expect((await reading(sound)).faults).toEqual([matching(/objective.*measured nothing/u)]);
    const broken: Verifier = async (task, answer) => {
      const verdict = await verify(task, answer);
      return verdict.kind === "pass"
        ? { kind: "faulty", check: "objective", reason: "the objective returned NaN" }
        : verdict;
    };
    expect((await reading({ ...sound, verify: broken })).faults).toEqual([
      matching(/roof-1.*faulty objective.*NaN/u),
      matching(/mast-1.*faulty objective.*NaN/u),
      matching(/objective.*not be measured.*NaN/u),
    ]);
  });
});

describe("the answer's fields", () => {
  const format = (x: JsonObject) => ({ type: "object", required: ["x"], properties: { x } });
  const fields = async (schema: JsonObject, checks: Verifier, controls: Control[]) =>
    unreadFields(checks, [roof], await runControls(checks, [roof], controls, 1), schema, 1);

  it("credits an isolated reject control when both generic range probes pass", async () => {
    const range: Verifier = async (_task, answer) => {
      const x = asRecord(answer)?.x;
      return isNumber(x) && Math.abs(x) <= 10 ? { kind: "pass" } : { kind: "fail", blocking: ["range"] };
    };
    expect(
      await fields(format({ type: "number" }), range, [
        { taskId: roof.taskId, answer: { x: 0 }, refusedBy: null },
        { taskId: roof.taskId, answer: { x: 11 }, refusedBy: "range" },
      ]),
    ).toEqual([]);
  });

  it("does not credit a rejection caused by another field", async () => {
    const schema = {
      type: "object",
      required: ["x", "mass"],
      properties: { x: { type: "number" }, mass: { type: "number" } },
    };
    const faults = await fields(schema, verify, [
      { taskId: roof.taskId, answer: { x: 0, mass: 5 }, refusedBy: null },
      { taskId: roof.taskId, answer: { x: 11, mass: 50 }, refusedBy: "mass" },
    ]);
    expect(faults).toEqual([matching(/field x moved no check/u)]);
  });

  it("reports every unused field the format allows to change", async () => {
    for (const [schema, x, field] of [
      [{ type: "string", enum: ["A", "B"] }, "A", "x"],
      [{ type: "number", minimum: 0, maximum: 0.5 }, 0, "x"],
      [{ type: "array", items: { type: "string", enum: ["A", "B"] } }, ["A"], "x[]"],
    ] satisfies [JsonObject, JsonObject["x"], string][]) {
      const faults = await fields(format(schema), ignored, [
        { taskId: roof.taskId, answer: { x }, refusedBy: null },
      ]);
      expect(faults).toHaveLength(1);
      expect(faults[0]).toContain(`field ${field} moved no check`);
    }
  });

  it("probes the other enumerated value before crediting its check", async () => {
    const seen: JsonObject[] = [];
    const checked: Verifier = async (_task, answer) => {
      const record = asRecord(answer);
      if (record !== null) seen.push(record);
      return record?.x === "A" ? { kind: "pass" } : { kind: "fail", blocking: ["enum"] };
    };
    expect(
      await fields(format({ type: "string", enum: ["A", "B"] }), checked, [
        { taskId: roof.taskId, answer: { x: "A" }, refusedBy: null },
      ]),
    ).toEqual([]);
    expect(seen).toContainEqual({ x: "B" });
  });

  it("leaves a field to the format when no alternative follows it", async () => {
    for (const [schema, x] of [
      [{ const: 0 }, 0],
      [{ enum: [0] }, 0],
      [{ type: "number", minimum: 0, maximum: 0 }, 0],
      [{ type: "string", pattern: "^[AB]$" }, "A"],
    ] satisfies [JsonObject, JsonObject["x"]][]) {
      expect(
        await fields(format(schema), ignored, [{ taskId: roof.taskId, answer: { x }, refusedBy: null }]),
      ).toEqual([]);
    }
  });
});

describe("the do-nothing answer", () => {
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
      matching(/roof-1.*faulty span.*no span to read/u),
      matching(/mast-1.*pass/u),
    ]);
    const strict: Verifier = async () => ({ kind: "fail", blocking: ["mass"] });
    expect(await idleFaults(strict)).toEqual([]);
  });

  const mass = (field: JsonObject) => ({ type: "object", properties: { mass: field }, required: ["mass"] });

  it("lists a do-nothing answer the checks let pass, and one the format refuses, as faults of its own", async () => {
    const passed = await readUnder(mass({ type: "string" }));
    expect(passed.faults.filter((fault) => fault.startsWith("the do-nothing"))).toEqual([
      matching(/roof-1.*pass/u),
      matching(/mast-1.*pass/u),
    ]);
    const unformed = await readUnder(mass({ type: "string", pattern: "^[0-9]+$" }));
    expect(unformed.rejected).toEqual([]);
    // One fault, naming the do-nothing answer and why the format refuses it.
    const [fault, ...more] = unformed.faults.filter((each) => each.startsWith("the do-nothing"));
    expect(more).toEqual([]);
    expect(fault).toContain('{"mass":""}');
    expect(fault).toContain(unformed.unformed ?? "missing");
    expect(unformed.unformed).toContain("pattern");
  });

  it("follows a local reference as the inline schema it points to, and ends on a recursive one", async () => {
    const cites = { type: "array", items: { type: "string" } };
    const inline = await readUnder(mass({ type: "object", required: ["cites"], properties: { cites } }));
    expect(inline.idle).toEqual({ mass: { cites: [] } });
    // An escaped key and an array index, each named by two siblings, which are no cycle.
    for (const $ref of ["#/$defs/ci~1tes~0", "#/$defs/choices/anyOf/0"]) {
      const referred = await readUnder({
        ...mass({
          type: "object",
          required: ["cites", "more"],
          properties: { cites: { $ref }, more: { $ref } },
        }),
        $defs: { "ci/tes~": cites, choices: { anyOf: [cites] } },
      });
      expect([referred.idle, referred.unformed]).toEqual([{ mass: { cites: [], more: [] } }, null]);
    }
    // A node that requires itself has no finite answer: the reference ends in null, which the
    // format refuses as a fault of its own instead of a reading that never returns.
    const looped = await readUnder({
      $defs: { node: { $ref: "#/$defs/node" } },
      ...mass({ $ref: "#/$defs/node" }),
    });
    expect(looped.idle).toEqual({ mass: null });
  });
});

describe("a frozen checker", () => {
  const froze = (contract: string, checks: string): LogEvent => ({
    at: "2026-10-08T00:00:00.000Z",
    kind: "contract.frozen",
    data: { contract, checks },
  });
  const own = { contract: "c-1", checks: "p-1" };

  it("names what of a campaign's checker is not what the log froze", () => {
    expect(departure([], own)).toBeNull();
    expect(departure([froze("c-1", "p-1")], own)).toBeNull();
    expect(departure([froze("c-1", "p-0")], own)).toMatch(/another check program/u);
    expect(departure([froze("c-0", "p-0")], own)).toMatch(/another contract and check program/u);
  });
});
