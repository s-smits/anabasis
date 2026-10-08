// A checker's acceptance on a stand-in: two checks over two families, a verifier that decides from
// the answer alone, and controls labelled as v1's `controls.json` labels them. No wall and no tool
// runs here; the reading is what is under test.
import { describe, expect, it } from "bun:test";
import { acceptance, type Control, type Graded, runControls } from "../src/kernel/acceptance.ts";
import type { Brief, Task, Verifier } from "../src/kernel/verify.ts";
import { asRecord, isNumber } from "../src/meta/json-shape.ts";

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

  it("stops on a control of a task the pack does not hold", async () => {
    const gone: Control = { taskId: "gone", answer: {}, refusedBy: null };
    await expect(runControls(verify, [roof], [gone], 1)).rejects.toThrow("a control names gone");
  });
});
