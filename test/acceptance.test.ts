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
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
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

    // Missing tool and unrun check: a faulty check is named missing and `could not run`, never `refused
    // nothing` or `let nothing pass`.
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

    // Host-forwarded objectiveTools stay author-decided while still faulting when missing; pack-installed engines clear authoredFaults.
    const pyObj: Brief = { ...measured, objectiveTools: ["python3"] };
    const pyHost = await reading({
      ...sound,
      brief: pyObj,
      verify: weighed,
      found: (t) => (t === "python3" ? "host" : "pack"),
    });
    expect(pyHost.checks.at(-1)).toMatchObject({ id: "objective", instrument: AUTHOR, missing: [] });
    expect(authoredFaults(pyHost.checks, new Set(["span"]))).toEqual([
      matching(/objective.*--admit objective/u),
    ]);
    const pyMiss = await reading({
      ...sound,
      brief: pyObj,
      verify: weighed,
      found: (t) => (t === "python3" ? false : "pack"),
    });
    expect(pyMiss.faults).toEqual([matching(/objective names python3.*tool path/u)]);
    const engObj: Brief = { ...measured, objectiveTools: ["ngspice"] };
    const engOk = await reading({ ...sound, brief: engObj, verify: weighed, found: () => "pack" });
    expect(engOk.checks.at(-1)).toMatchObject({ id: "objective", instrument: "ngspice", missing: [] });
    expect(authoredFaults(engOk.checks, new Set(["span"]))).toEqual([]);

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

  it("faults an accept control that passes every other example, and stays silent on a partial or faulting swap", async () => {
    const full = await probeRead(tasksOf([null, null, null]), async (_t, a) =>
      asRecord(a)?.v === 0 ? { kind: "fail", blocking: ["ok"] } : { kind: "pass", objective: 1 },
    );
    expect(full.faults.filter((f) => f.includes("passed every other example"))).toHaveLength(3);
    const verifiers: readonly Verifier[] = [
      async (t, a) => {
        const id = asRecord(t.publicInput)?.id;
        const v = asRecord(a)?.v;
        return v === id || (id === 2 && v === 1)
          ? { kind: "pass", objective: 1 }
          : { kind: "fail", blocking: ["ok"] };
      },
      async (t, a) => {
        const id = asRecord(t.publicInput)?.id;
        const v = asRecord(a)?.v;
        if (v === id) return { kind: "pass", objective: 1 };
        if (id === 2 && v === 1) return { kind: "faulty", check: "ok", reason: "key mismatch" };
        return { kind: "fail", blocking: ["ok"] };
      },
    ];
    for (const check of verifiers) {
      const read = await probeRead(tasksOf([null, null, null]), check);
      expect([read.faults, read.notes]).toEqual([[], []]);
    }
  });

  it("faults hidden values nothing reads, and nothing else: objective-only, check-read, identical, non-result and judge-read swaps", async () => {
    const distinct = tasksOf([{ k: 1 }, { k: 2 }, { k: 3 }]);
    const blind = await probeRead(distinct, async (t, a) =>
      asRecord(a)?.v === asRecord(t.publicInput)?.id
        ? { kind: "pass", objective: 10 }
        : { kind: "fail", blocking: ["ok"] },
    );
    expect(blind.faults).toEqual([matching(/hidden values had no effect/u)]);
    expect(blind.notes).toEqual([]);
    const silent: [Task[], Verifier][] = [
      [
        distinct,
        async (t, a) =>
          asRecord(a)?.v === asRecord(t.publicInput)?.id
            ? { kind: "pass", objective: Number(asRecord(t.hidden)?.k ?? 0) * 10 }
            : { kind: "fail", blocking: ["ok"] },
      ],
      [
        distinct,
        async (t, a) => {
          const id = asRecord(t.publicInput)?.id;
          if (asRecord(a)?.v !== id) return { kind: "fail", blocking: ["ok"] };
          return asRecord(t.hidden)?.k === id
            ? { kind: "pass", objective: 10 }
            : { kind: "faulty", check: "objective", reason: "wrong hidden schema" };
        },
      ],
      [
        distinct,
        async (t, a) =>
          asRecord(a)?.v === asRecord(t.hidden)?.k
            ? { kind: "pass", objective: 10 }
            : { kind: "fail", blocking: ["ok"] },
      ],
      [
        tasksOf([{ k: 1 }, { k: 1 }, { k: 1 }]),
        async (t, a) =>
          asRecord(a)?.v === asRecord(t.publicInput)?.id
            ? { kind: "pass", objective: 10 }
            : { kind: "fail", blocking: ["ok"] },
      ],
      [
        distinct,
        async (t, a) => {
          const id = asRecord(t.publicInput)?.id;
          if (asRecord(a)?.v !== id) return { kind: "fail", blocking: ["ok"] };
          return asRecord(t.hidden)?.k === id
            ? { kind: "pass", objective: 10 }
            : { kind: "non-result", reason: "wall timeout" };
        },
      ],
    ];
    for (const [tasks, check] of silent) {
      const read = await probeRead(tasks, check);
      expect([read.faults, read.notes]).toEqual([[], []]);
    }
    const criterion = "The answer explains each figure it gives in plain words.";
    const judged: Brief = {
      ...probeBrief,
      objective: {
        quantity: "score",
        direction: "higher",
        scale: "unit",
        items: [{ id: "plain", weight: 1, kind: "judge", criterion }],
      },
    };
    const votedOn = await probeRead(
      distinct,
      async (t, a) =>
        asRecord(a)?.v === asRecord(t.publicInput)?.id
          ? { kind: "pass" }
          : { kind: "fail", blocking: ["ok"] },
      judged,
    );
    expect(votedOn.faults).toEqual([]);
  });

  it("faults deliverables nothing reads, and notes a flat rubric item only once a probe has passed", async () => {
    const file = { path: "report.md", base64: "b2s=", text: "ok" };
    const withFiles: Control[] = [
      { taskId: "ex-001", answer: { v: 1 }, files: [file], refusedBy: null },
      { taskId: "ex-002", answer: { v: 2 }, files: [file], refusedBy: null },
      { taskId: "ex-003", answer: { v: 3 }, files: [file], refusedBy: null },
      { taskId: "ex-001", answer: { v: 0 }, files: [file], refusedBy: "ok" },
    ];
    const runWith = (check: Verifier) =>
      readChecker({
        brief: probeBrief,
        contract,
        verify: check,
        tasks: tasksOf([null, null, null]),
        controls: withFiles,
        found: () => true,
        width: 2,
      });
    const blind = await runWith(async (t, a) =>
      asRecord(a)?.v === asRecord(t.publicInput)?.id
        ? { kind: "pass", objective: 10 }
        : { kind: "fail", blocking: ["ok"] },
    );
    expect(blind.faults).toEqual([matching(/deliverable files had no effect/u)]);
    expect(blind.notes).toEqual([]);
    const stripping: readonly Verifier[] = [
      async (t, a, _s, files) =>
        asRecord(a)?.v === asRecord(t.publicInput)?.id
          ? { kind: "pass", objective: (files?.length ?? 0) > 0 ? 10 : 1 }
          : { kind: "fail", blocking: ["ok"] },
      async (t, a, _s, files) =>
        asRecord(a)?.v === asRecord(t.publicInput)?.id && (files?.length ?? 0) > 0
          ? { kind: "pass", objective: 10 }
          : { kind: "fail", blocking: ["ok"] },
      async (t, a, _s, files) => {
        if (asRecord(a)?.v !== asRecord(t.publicInput)?.id) return { kind: "fail", blocking: ["ok"] };
        return (files?.length ?? 0) > 0
          ? { kind: "pass", objective: 10 }
          : { kind: "faulty", check: "ok", reason: "TypeError: missing file" };
      },
    ];
    for (const check of stripping) {
      const read = await runWith(check);
      expect([read.faults, read.notes]).toEqual([[], []]);
    }

    const rubricObjective = {
      quantity: "weighted score",
      direction: "higher" as const,
      scale: "unit" as const,
      items: [
        { id: "accuracy", weight: 3 },
        { id: "flat-item", weight: 1 },
      ],
    };
    const rubricRead = (hiddens: readonly (JsonValue | null)[]) =>
      readChecker({
        brief: { ...probeBrief, objective: rubricObjective },
        contract: { ...contract, objective: rubricObjective },
        verify: async (t, a) => {
          if (asRecord(a)?.v !== asRecord(t.publicInput)?.id) return { kind: "fail", blocking: ["ok"] };
          const hidMatch = asRecord(t.hidden)?.h === asRecord(t.publicInput)?.id;
          const acc = hidMatch ? 0.9 : 0.2;
          const flat = hidMatch ? 1 : 0.995;
          return {
            kind: "pass",
            objective: (3 * acc + flat) / 4,
            scores: { accuracy: acc, "flat-item": flat },
          };
        },
        tasks: tasksOf(hiddens),
        controls: baseControls,
        found: () => true,
        width: 2,
      });
    const probed = await rubricRead([{ h: 1 }, { h: 2 }, { h: 3 }]);
    expect(probed.faults).toEqual([]);
    expect(probed.notes).toEqual([matching(/rubric item flat-item stayed within 1%/u)]);
    // Without hidden values no probe passes, so the three accept controls alone note nothing.
    expect((await rubricRead([null, null, null])).notes).toEqual([]);
  });

  it("names exactly the answer fields no check or objective reads, each changed in every list element", async () => {
    const optional = ["$.note", "$.flags[].ok", "$.flags[].why"] as const;
    const format = {
      type: "object",
      properties: { v: { type: "number" }, note: { type: "string" }, flags: { type: "array" } },
    };
    const answerOf = (v: JsonValue | undefined, note: string): JsonValue => ({
      v: Number(v),
      note,
      flags: [
        { ok: true, why: "a" },
        { ok: false, why: "bc" },
      ],
    });
    const unread = async (
      check: Verifier,
      over: { brief?: Brief; answerFormat?: JsonValue; note?: string } = {},
    ) =>
      (
        await readChecker({
          brief: over.brief ?? probeBrief,
          contract: { ...contract, answerFormat: over.answerFormat ?? format },
          verify: check,
          tasks: tasksOf([null, null, null]),
          controls: [1, 2, 3].map((v) => ({
            taskId: `ex-00${String(v)}`,
            answer: answerOf(v, over.note ?? "seen"),
            refusedBy: null,
          })),
          found: () => true,
          width: 2,
        })
      ).notes
        .filter((note) => note.startsWith("answer fields "))
        .map((note) => note.split(" had no effect")[0]);
    const reads =
      (read: ReadonlySet<string>): Verifier =>
      async (t, a) => {
        const answer = asRecord(a);
        const last = asRecord(Array.isArray(answer?.flags) ? answer.flags.at(-1) : null);
        if (answer?.v !== asRecord(t.publicInput)?.id) return { kind: "fail", blocking: ["ok"] };
        const seen = [answer?.note, last?.ok, last?.why].filter((_, at) => read.has(optional[at] ?? ""));
        return { kind: "pass", objective: capturedJsonStringify(seen).length };
      };
    for (const note of ["seen", ""]) {
      for (const mask of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const read = new Set(optional.filter((_, at) => (mask >> at) % 2 === 1));
        const left = optional.filter((field) => !read.has(field));
        expect(await unread(reads(read), { note })).toEqual(
          left.length === 0 ? [] : [`answer fields ${left.join(", ")}`],
        );
      }
    }
    const judged: Brief = {
      ...probeBrief,
      objective: {
        quantity: "score",
        direction: "higher",
        scale: "unit",
        items: [{ id: "plain", weight: 1, kind: "judge", criterion: "The note explains the flags." }],
      },
    };
    expect(await unread(reads(new Set()), { brief: judged })).toEqual([]);
    const noteAtLeast = (minLength: number) => ({
      ...format,
      properties: { ...format.properties, note: { type: "string", minLength } },
    });
    expect(await unread(reads(new Set()), { answerFormat: noteAtLeast(1) })).toEqual([
      "answer fields $.note, $.flags[].ok, $.flags[].why",
    ]);
    expect(await unread(reads(new Set(["$.note"])), { answerFormat: noteAtLeast(1) })).toEqual([
      "answer fields $.flags[].ok, $.flags[].why",
    ]);
    expect(await unread(reads(new Set()), { answerFormat: noteAtLeast(2) })).toEqual([
      "answer fields $.flags[].ok, $.flags[].why",
    ]);
    const withOptional = {
      ...format,
      properties: { ...format.properties, comment: { type: "string" } },
    };
    expect(await unread(reads(new Set(optional)), { answerFormat: withOptional })).toEqual([
      "answer fields $.comment",
    ]);
  });
});

describe("seeded property invariants", () => {
  it("conserves check tallies, preserves admission monotonicity, terminates doNothingAnswer, and is permutation-invariant", async () => {
    const rng = prng(20_261_123);
    const families = ["alpha", "beta", "gamma"] as const;

    // 1. Check-tally conservation across 30 random briefs, tasks and controls.
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

      // Permutation symmetry, on the first 15 trials.
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

    // 2. doNothingAnswer termination across 30 random schemas, some with a self-cycle in `$defs`.
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
