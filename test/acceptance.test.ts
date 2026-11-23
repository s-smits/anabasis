// Behavioural, boundary, and seeded property-based tests for checker acceptance
// (`src/kernel/acceptance.ts`): control tallies, instruments and admission, do-nothing schemas,
// cross-example and hidden-value probes (`probeReading`), and frozen checker departure.
import { describe, expect, it } from "bun:test";
import {
  AUTHOR,
  authoredFaults,
  type Control,
  departure,
  doNothingFaults,
  type Read,
  readChecker,
  unadmitted,
} from "../src/kernel/acceptance.ts";
import type { Contract } from "../src/kernel/contract.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import {
  applicableTruthChecks,
  type Brief,
  decides,
  type Task,
  type Verdict,
  type Verifier,
} from "../src/kernel/verify.ts";
import { asRecord, isNumber, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { matching } from "./helpers/matchers.ts";

const BRIEF: Brief = {
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
const ROOF: Task = { taskId: "roof-1", family: "roof", publicInput: null, hidden: null };
const MAST: Task = { taskId: "mast-1", family: "mast", publicInput: null, hidden: null };
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

const verify: Verifier = async (task, answer) => {
  const fields = asRecord(answer);
  const heavy = isNumber(fields?.mass) && fields.mass > 10;
  const short = task.family === "roof" && isNumber(fields?.span) && fields.span < 5;
  const blocking = [...(heavy ? ["mass"] : []), ...(short ? ["span"] : [])];
  return blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
};
const passAll: Verifier = async () => ({ kind: "pass" });

const reading = (given: Partial<Read> & Pick<Read, "tasks" | "controls">) =>
  readChecker({
    brief: BRIEF,
    contract: HEAVY,
    verify,
    found: () => true,
    width: 2,
    probes: false,
    ...given,
  });

const readUnder = (answerFormat: JsonObject, checks: Verifier = passAll) =>
  reading({
    contract: { answerFormat, conventions: "", rules: [], scope: "" },
    verify: checks,
    tasks: [ROOF, MAST],
    controls: [],
  });

/** Deterministic LCG for reproducible property tests. */
function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  return {
    int: (bound: number) => Math.floor(next() * bound),
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("empty pick");
      return item;
    },
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i];
        const b = copy[j];
        if (a !== undefined && b !== undefined) {
          copy[i] = b;
          copy[j] = a;
        }
      }
      return copy;
    },
  };
}

describe("control tallies, faults, and instruments", () => {
  it("tallies applicable controls, detects mismatches/flakiness/missing tools, suppresses spurious unrun faults, and rejects unknown tasks", async () => {
    const clean = await reading({ tasks: [ROOF, MAST], controls: SOUND });
    expect(clean.faults).toEqual([]);
    expect(clean.checks).toEqual([
      { id: "mass", instrument: "fe", missing: [], passed: 3, refused: 1, named: 1, caught: 1 },
      { id: "span", instrument: "author", missing: [], passed: 2, refused: 1, named: 1, caught: 1 },
    ]);

    // Unknown taskId in control throws explicitly.
    await expect(
      reading({ tasks: [ROOF], controls: [{ taskId: "ghost-1", answer: { mass: 5 }, refusedBy: null }] }),
    ).rejects.toThrow("ghost-1, which the pack holds no task for");

    // Wrong label, flaky verdict, and accidental refusal without a naming reject control.
    let calls = 0;
    const flaky: Verifier = async (task, answer) =>
      asRecord(answer)?.flaky === true && calls++ === 0
        ? { kind: "fail", blocking: ["mass"] }
        : verify(task, answer);
    const bad = await reading({
      verify: flaky,
      tasks: [ROOF],
      width: 1,
      controls: [
        { taskId: "roof-1", answer: { mass: 50 }, refusedBy: null },
        { taskId: "roof-1", answer: { mass: 5 }, refusedBy: "span" },
        { taskId: "roof-1", answer: { mass: 5, flaky: true }, refusedBy: null },
      ],
    });
    expect(bad.faults).toEqual([
      matching(/accept.*roof-1.*fail mass/u),
      matching(/reject.*roof-1.*span.*: pass$/u),
      matching(/roof-1.*fail mass.*pass$/u),
      matching(/mass.*no reject control/u),
      matching(/span.*refused nothing/u),
    ]);

    // Missing tool + unrun suppression: faulty check emits `missing` + `could not run`, never `refused nothing` / `let nothing pass`.
    const crashing: Verifier = async (_task, answer) =>
      asRecord(answer)?.mass === 5
        ? { kind: "faulty", check: "mass", reason: "segfault" }
        : { kind: "fail", blocking: ["span"] };
    const unrun = await reading({
      tasks: [ROOF],
      controls: [
        { taskId: "roof-1", answer: { mass: 5 }, refusedBy: null },
        { taskId: "roof-1", answer: { mass: 50 }, refusedBy: "span" },
      ],
      verify: crashing,
      found: (tool) => tool !== "fe",
      width: 1,
    });
    expect(unrun.faults.some((f) => f.includes("mass names fe"))).toBe(true);
    expect(unrun.faults.some((f) => f.includes("mass could not run") && f.includes("segfault"))).toBe(true);
    expect(unrun.faults.some((f) => f.includes("mass has refused nothing"))).toBe(false);
    expect(unrun.faults.some((f) => f.includes("mass has let nothing pass"))).toBe(false);
    expect(unrun.faults.some((f) => f.includes("span has let nothing pass"))).toBe(true);
  });

  it("names instruments from declared tools, enforces operator admission, and tracks checker departure", async () => {
    const engined: Brief = {
      ...BRIEF,
      truthChecks: BRIEF.truthChecks.map((check) =>
        check.id === "span"
          ? { ...check, execution: { ...check.execution, requiredToolIds: ["ccx", "gmsh"] } }
          : check,
      ),
    };
    const { checks: withEngines } = await reading({ brief: engined, tasks: [ROOF, MAST], controls: SOUND });
    expect(withEngines.map(({ id, instrument }) => [id, instrument])).toEqual([
      ["mass", "fe"],
      ["span", "ccx, gmsh"],
    ]);
    expect(authoredFaults(withEngines, new Set())).toEqual([]);

    const drafted: Brief = {
      ...BRIEF,
      truthChecks: BRIEF.truthChecks.map((check) => ({
        ...check,
        execution: { ...check.execution, evidence: { kind: "authored" } },
      })),
    };
    const { checks: none } = await reading({ brief: drafted, tasks: [ROOF, MAST], controls: SOUND });
    expect(none.map(({ instrument }) => instrument)).toEqual([AUTHOR, AUTHOR]);
    expect(authoredFaults(none, new Set(["span"]))).toEqual([matching(/mass.*--admit mass/u)]);
    expect(authoredFaults(none, new Set(["mass", "span"]))).toEqual([]);

    const logged = (admitted: string[]): LogEvent => ({
      at: "2026-10-12T00:00:00.000Z",
      kind: "checker.read",
      data: { rows: none.map(({ id, instrument }) => ({ id, instrument })), admitted },
    });
    expect(unadmitted([logged(["span"])])).toEqual(["mass"]);
    expect(unadmitted([logged(["span"]), logged(["mass", "span"])])).toEqual([]);
    expect(unadmitted([logged(["span"])], [])).toEqual(["mass", "span"]);

    const froze = (contract: string, checks: string): LogEvent => ({
      at: "2026-10-08T00:00:00.000Z",
      kind: "contract.frozen",
      data: { contract, checks },
    });
    const own = { contract: "c-1", checks: "p-1" };
    expect(departure([], own)).toBeNull();
    expect(departure([froze("c-1", "p-1")], own)).toBeNull();
    expect(departure([froze("c-1", "p-0")], own)).toMatch(/another check program/u);
    expect(departure([froze("c-0", "p-0")], own)).toMatch(/another contract and check program/u);
  });

  it("reads objective instruments, missing objective tools, drifting values, and faulty objectives", async () => {
    const measured: Brief = { ...BRIEF, objective: { quantity: "mass in kg", direction: "lower" } };
    const weighed: Verifier = async (task, answer) => {
      const verdict = await verify(task, answer);
      const mass = asRecord(answer)?.mass;
      return verdict.kind === "pass" && isNumber(mass) ? { kind: "pass", objective: mass } : verdict;
    };
    const sound = { brief: measured, tasks: [ROOF, MAST], controls: SOUND };
    const { checks, faults } = await reading({ ...sound, verify: weighed });
    expect(faults).toEqual([]);
    expect(checks.at(-1)).toEqual({
      id: "objective",
      instrument: AUTHOR,
      missing: [],
      passed: 2,
      refused: 0,
      named: 0,
      caught: 0,
    });
    expect(authoredFaults(checks, new Set(["span"]))).toEqual([matching(/objective.*--admit objective/u)]);

    // Declared objectiveTools clear authoredFaults when present and fault when missing.
    const toolObj: Brief = { ...measured, objectiveTools: ["python3"] };
    const pyOk = await reading({ ...sound, brief: toolObj, verify: weighed });
    expect(pyOk.checks.at(-1)).toMatchObject({ id: "objective", instrument: "python3", missing: [] });
    expect(authoredFaults(pyOk.checks, new Set(["span"]))).toEqual([]);
    const pyMiss = await reading({
      ...sound,
      brief: toolObj,
      verify: weighed,
      found: (t) => t !== "python3",
    });
    expect(pyMiss.faults).toEqual([matching(/objective names python3.*tool path/u)]);

    // Drifting, unmeasured, and faulty objectives.
    let n = 0;
    const drifting: Verifier = async (t, a) => {
      const v = await weighed(t, a);
      return v.kind === "pass" ? { ...v, objective: ++n } : v;
    };
    expect(
      (
        await reading({
          brief: measured,
          verify: drifting,
          tasks: [ROOF],
          controls: SOUND.slice(0, 1),
          width: 1,
        })
      ).faults[0],
    ).toMatch(/roof-1.*pass 1.*pass 2/u);
    expect((await reading(sound)).faults).toEqual([matching(/objective.*measured nothing/u)]);
    const broken: Verifier = async (t, a) => {
      const v = await verify(t, a);
      return v.kind === "pass" ? { kind: "faulty", check: "objective", reason: "NaN" } : v;
    };
    expect((await reading({ ...sound, verify: broken })).faults).toEqual([
      matching(/roof-1.*faulty objective.*NaN/u),
      matching(/mast-1.*faulty objective.*NaN/u),
      matching(/objective.*not be measured.*NaN/u),
    ]);
  });
});

describe("do-nothing answer and schema synthesis", () => {
  const massField = (field: JsonObject) => ({
    type: "object",
    properties: { mass: field },
    required: ["mass"],
  });

  it("rejects passing/faulty do-nothing answers, notes unformed schemas, and handles primitives and local $ref cycles", async () => {
    const lax: Verifier = async (task, answer) =>
      task.family === "roof" && asRecord(answer)?.span === undefined
        ? { kind: "faulty", check: "span", reason: "no span to read" }
        : verify(task, answer);
    const idleFaults = async (checks: Verifier) =>
      (await readUnder({ type: "object" }, checks)).faults.filter((f) => f.startsWith("the do-nothing"));
    expect(await idleFaults(lax)).toEqual([
      matching(/roof-1.*faulty span.*no span to read/u),
      matching(/mast-1.*pass/u),
    ]);
    expect(await idleFaults(async () => ({ kind: "fail", blocking: ["mass"] }))).toEqual([]);

    // Unformed schema emits a note, not a do-nothing fault.
    const unformed = await readUnder(massField({ type: "string", pattern: "^[0-9]+$" }));
    expect(unformed.rejected).toEqual([]);
    expect(unformed.faults.filter((f) => f.startsWith("the do-nothing"))).toEqual([]);
    expect(unformed.notes).toHaveLength(1);
    expect(unformed.notes[0]).toContain('{"mass":""}');
    expect(unformed.unformed).toContain("pattern");

    // Primitive & combinator schema synthesis table.
    const cases: readonly [JsonObject, JsonValue][] = [
      [massField({ const: "fixed" }), { mass: "fixed" }],
      [massField({ enum: ["a", "b"] }), { mass: "a" }],
      [massField({ anyOf: [{ type: "boolean" }, { type: "string" }] }), { mass: false }],
      [massField({ oneOf: [{ type: "integer", exclusiveMinimum: 4 }] }), { mass: 5 }],
      [massField({ type: ["string", "null"], minLength: 3 }), { mass: "xxx" }],
      [massField({ type: "array", minItems: 2, items: { type: "number", minimum: 7 } }), { mass: [7, 7] }],
      [massField({ type: "unknown" }), { mass: null }],
    ];
    for (const [schema, expected] of cases) {
      expect((await readUnder(schema)).idle).toEqual(expected);
    }

    // Escaped local `$ref` paths, shared sibling refs, recursive local cycle, and non-local `$id` self-ref.
    const cites = { type: "array", items: { type: "string" } };
    for (const $ref of ["#/$defs/ci~1tes~0", "#/$defs/choices/anyOf/0"]) {
      const referred = await readUnder({
        ...massField({
          type: "object",
          required: ["cites", "more"],
          properties: { cites: { $ref }, more: { $ref } },
        }),
        $defs: { "ci/tes~": cites, choices: { anyOf: [cites] } },
      });
      expect([referred.idle, referred.unformed]).toEqual([{ mass: { cites: [], more: [] } }, null]);
    }
    const looped = await readUnder({
      $defs: { node: { $ref: "#/$defs/node" } },
      ...massField({ $ref: "#/$defs/node" }),
    });
    expect([looped.idle, looped.unformed === null]).toEqual([{ mass: null }, false]);
    const named = await readUnder({
      $defs: { node: { $id: "node", $ref: "node" } },
      ...massField({ $ref: "node" }),
    });
    expect(named.unformed === null).toBe(false);
  });
});

describe("cross-example and hidden-value probes (probeReading)", () => {
  const probeBrief: Brief = {
    correctnessContract: "check-program/v1",
    objective: { quantity: "score", direction: "higher" },
    truthChecks: [
      {
        id: "ok",
        citedDecisionIds: ["r1"],
        execution: {
          families: "all",
          artifactPaths: ["$"],
          publicInputPaths: ["$"],
          hidden: "whole",
          evidence: { kind: "authored" },
        },
      },
    ],
  };
  const contract: Contract = {
    answerFormat: { type: "object", required: ["v"], properties: { v: { type: "number" } } },
    conventions: "",
    rules: [],
    scope: "",
  };
  const tasksOf = (hiddens: readonly (JsonValue | null)[]): Task[] =>
    hiddens.map((hidden, i) => ({
      taskId: `ex-00${String(i + 1)}`,
      family: "f",
      publicInput: { id: i + 1 },
      hidden,
    }));
  const baseControls: Control[] = [
    { taskId: "ex-001", answer: { v: 1 }, refusedBy: null },
    { taskId: "ex-002", answer: { v: 2 }, refusedBy: null },
    { taskId: "ex-003", answer: { v: 3 }, refusedBy: null },
    { taskId: "ex-001", answer: { v: 0 }, refusedBy: "ok" },
  ];
  const probeRead = (tasks: Task[], check: Verifier, brief: Brief = probeBrief) =>
    readChecker({
      brief,
      contract,
      verify: check,
      tasks,
      controls: baseControls,
      found: () => true,
      width: 2,
    });

  it("distinguishes full cross-example pass faults from partial-pass notes and cross-example faulty crash notes", async () => {
    // Full pass on every other example -> fault only (never duplicated as partial note).
    const full = await probeRead(tasksOf([null, null, null]), async (_t, a) =>
      asRecord(a)?.v === 0 ? { kind: "fail", blocking: ["ok"] } : { kind: "pass", objective: 1 },
    );
    expect(full.faults.filter((f) => f.includes("passed every other example"))).toHaveLength(3);
    expect(full.notes.filter((n) => n.includes("also passed"))).toEqual([]);

    // Partial cross-example pass -> factual note only, 0 faults.
    const partial = await probeRead(tasksOf([null, null, null]), async (t, a) => {
      const id = asRecord(t.publicInput)?.id;
      const v = asRecord(a)?.v;
      return v === id || (id === 2 && v === 1)
        ? { kind: "pass", objective: 1 }
        : { kind: "fail", blocking: ["ok"] };
    });
    expect(partial.faults).toEqual([]);
    expect(partial.notes).toEqual(["the accept control of ex-001 also passed 1 of 2 other examples"]);

    // Cross-example swap returning `faulty` -> factual note naming task, check, and reason (Hole B).
    const faultySwap = await probeRead(tasksOf([null, null, null]), async (t, a) => {
      const id = asRecord(t.publicInput)?.id;
      const v = asRecord(a)?.v;
      if (v === id) return { kind: "pass", objective: 1 };
      if (id === 2 && v === 1) return { kind: "faulty", check: "ok", reason: "key mismatch" };
      return { kind: "fail", blocking: ["ok"] };
    });
    expect(faultySwap.faults).toEqual([]);
    expect(faultySwap.notes).toEqual([
      "the accept control of ex-001 faulted ok on another example: key mismatch",
    ]);
  });

  it("distinguishes hidden-blind faults, objective-only hidden notes, hidden-sensitive checks, identical hidden, and non-results", async () => {
    const distinct = tasksOf([{ k: 1 }, { k: 2 }, { k: 3 }]);

    // Unread hidden -> fault only (not duplicated as hidden-blind validity note).
    const blind = await probeRead(distinct, async (t, a) =>
      asRecord(a)?.v === asRecord(t.publicInput)?.id
        ? { kind: "pass", objective: 10 }
        : { kind: "fail", blocking: ["ok"] },
    );
    expect(blind.faults).toEqual([matching(/hidden values had no effect/u)]);
    expect(blind.notes).toEqual([]);

    // Hidden read only by objective (both shifted value and objective-only fault) -> factual note, 0 faults.
    const objOnly = await probeRead(distinct, async (t, a) =>
      asRecord(a)?.v === asRecord(t.publicInput)?.id
        ? { kind: "pass", objective: Number(asRecord(t.hidden)?.k ?? 0) * 10 }
        : { kind: "fail", blocking: ["ok"] },
    );
    expect(objOnly.faults).toEqual([]);
    expect(objOnly.notes).toEqual([matching(/only the objective read hidden values/u)]);

    const objThrow = await probeRead(distinct, async (t, a) => {
      const id = asRecord(t.publicInput)?.id;
      if (asRecord(a)?.v !== id) return { kind: "fail", blocking: ["ok"] };
      return asRecord(t.hidden)?.k === id
        ? { kind: "pass", objective: 10 }
        : { kind: "faulty", check: "objective", reason: "wrong hidden schema" };
    });
    expect(objThrow.faults).toEqual([]);
    expect(objThrow.notes).toEqual([matching(/only the objective read hidden values/u)]);

    // Validity check reads hidden -> 0 faults, 0 notes.
    const checkReads = await probeRead(distinct, async (t, a) =>
      asRecord(a)?.v === asRecord(t.hidden)?.k
        ? { kind: "pass", objective: 10 }
        : { kind: "fail", blocking: ["ok"] },
    );
    expect([checkReads.faults, checkReads.notes]).toEqual([[], []]);

    // Identical non-null hidden across all examples -> Hole A factual note, 0 faults.
    const identical = await probeRead(tasksOf([{ k: 1 }, { k: 1 }, { k: 1 }]), async (t, a) =>
      asRecord(a)?.v === asRecord(t.publicInput)?.id
        ? { kind: "pass", objective: 10 }
        : { kind: "fail", blocking: ["ok"] },
    );
    expect(identical.faults).toEqual([]);
    expect(identical.notes).toEqual([matching(/identical hidden values.*could not be probed/u)]);

    // `non-result` during hidden swap is ignored without fabricating a fault or identical-hidden note.
    const nonRes = await probeRead(distinct, async (t, a) => {
      const id = asRecord(t.publicInput)?.id;
      if (asRecord(a)?.v !== id) return { kind: "fail", blocking: ["ok"] };
      return asRecord(t.hidden)?.k === id
        ? { kind: "pass", objective: 10 }
        : { kind: "non-result", reason: "wall timeout" };
    });
    expect([nonRes.faults, nonRes.notes]).toEqual([[], []]);
  });
});

describe("seeded property invariants", () => {
  it("conserves check tallies, preserves admission monotonicity, terminates doNothingAnswer, and is permutation-invariant", async () => {
    const rng = prng(20_261_123);
    const families = ["alpha", "beta", "gamma"] as const;

    // 1. Check-tally conservation + permutation symmetry across 30 random briefs/tasks/controls.
    for (let trial = 0; trial < 30; trial += 1) {
      const checkCount = 1 + rng.int(4);
      const truthChecks: Brief["truthChecks"] = Array.from({ length: checkCount }, (_, i) => ({
        id: `c${String(i)}`,
        citedDecisionIds: ["r1"],
        execution: {
          families: rng.int(2) === 0 ? "all" : [rng.pick(families)],
          artifactPaths: ["$"],
          publicInputPaths: [],
          hidden: "none",
          evidence: rng.int(2) === 0 ? { kind: "authored" } : { kind: "external", requiredToolIds: ["eng"] },
        },
      }));
      const randBrief: Brief = { correctnessContract: "check-program/v1", truthChecks };
      const tasks: Task[] = Array.from({ length: 2 + rng.int(3) }, (_, i) => ({
        taskId: `t-${String(i)}`,
        family: rng.pick(families),
        publicInput: { i },
        hidden: null,
      }));
      const controls: Control[] = Array.from({ length: 2 + rng.int(6) }, (_, i) => ({
        taskId: rng.pick(tasks).taskId,
        answer: { mass: i + 1 },
        refusedBy: rng.int(2) === 0 ? null : rng.pick(truthChecks).id,
      }));
      const failMap = new Map<string, string[]>();
      for (const c of controls) {
        const key = `${c.taskId}:${JSON.stringify(c.answer)}`;
        if (!failMap.has(key)) {
          const blocking = truthChecks
            .filter((chk) => {
              const task = tasks.find((t) => t.taskId === c.taskId);
              return (
                task !== undefined &&
                applicableTruthChecks(randBrief, task).some((a) => a.id === chk.id) &&
                rng.int(3) === 0
              );
            })
            .map((chk) => chk.id);
          failMap.set(key, blocking);
        }
      }
      const detVerify: Verifier = async (task, answer): Promise<Verdict> => {
        const blocking = failMap.get(`${task.taskId}:${JSON.stringify(answer)}`) ?? ["c0"];
        return blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
      };

      const res = await reading({ brief: randBrief, tasks, controls, verify: detVerify });
      const byId = new Map(tasks.map((t) => [t.taskId, t]));
      for (const row of res.checks) {
        const applicableDecided = res.runs.filter(({ taskId, verdicts: [v] }) => {
          const t = byId.get(taskId);
          return (
            t !== undefined && decides(v) && applicableTruthChecks(randBrief, t).some((c) => c.id === row.id)
          );
        }).length;
        expect(row.passed + row.refused).toBe(applicableDecided);
        expect(row.caught).toBeLessThanOrEqual(row.named);
        expect(row.caught).toBeLessThanOrEqual(row.refused);
      }

      // Admission monotonicity.
      const authoredIds = res.checks.filter((c) => c.instrument === AUTHOR).map((c) => c.id);
      const enginedIds = res.checks.filter((c) => c.instrument !== AUTHOR).map((c) => c.id);
      expect(authoredFaults(res.checks, new Set(authoredIds))).toEqual([]);
      expect(authoredFaults(res.checks, new Set(enginedIds))).toEqual(authoredFaults(res.checks, new Set()));
      let prev = authoredFaults(res.checks, new Set()).length;
      const acc = new Set<string>();
      for (const id of res.checks.map((c) => c.id)) {
        acc.add(id);
        const now = authoredFaults(res.checks, acc).length;
        expect(now).toBeLessThanOrEqual(prev);
        prev = now;
      }

      // Permutation symmetry on first 15 trials.
      if (trial < 15) {
        const perm = await reading({
          brief: randBrief,
          tasks: rng.shuffle(tasks),
          controls: rng.shuffle(controls),
          verify: detVerify,
        });
        expect(perm.checks).toEqual(res.checks);
        expect([...perm.faults].toSorted()).toEqual([...res.faults].toSorted());
        expect([...perm.notes].toSorted()).toEqual([...res.notes].toSorted());
      }
    }

    // 2. doNothingAnswer termination & minimalism across 30 random acyclic and cyclic schemas.
    const genSchema = (depth: number): JsonObject => {
      if (depth <= 0) {
        return rng.pick<JsonObject>([
          { type: "string", minLength: rng.int(4) },
          { type: "integer", minimum: rng.int(5) },
          { type: "number", exclusiveMinimum: rng.int(3) },
          { type: "boolean" },
          { const: "k" },
          { enum: [1, 2] },
          { $ref: "#/$defs/self" },
        ]);
      }
      const kind = rng.int(3);
      if (kind === 0) {
        return {
          type: "object",
          required: ["a"],
          properties: { a: genSchema(depth - 1) },
        };
      }
      if (kind === 1) return { type: "array", minItems: rng.int(3), items: genSchema(depth - 1) };
      return { anyOf: [genSchema(depth - 1), { type: "string" }] };
    };
    for (let i = 0; i < 30; i += 1) {
      const schema: JsonObject = {
        type: "object",
        required: ["root"],
        properties: { root: genSchema(2) },
        $defs: { self: rng.int(2) === 0 ? { $ref: "#/$defs/self" } : { type: "string" } },
      };
      const out = await readUnder(schema, async (t) =>
        t.taskId === "roof-1" ? { kind: "fail", blocking: ["mass"] } : { kind: "pass" },
      );
      if (out.unformed === null) {
        expect(out.rejected).toHaveLength(2);
        expect(doNothingFaults(out.rejected)).toHaveLength(
          out.rejected.filter(({ verdict }) => verdict.kind !== "fail").length,
        );
      } else {
        expect(out.rejected).toEqual([]);
      }
    }
  });
});
