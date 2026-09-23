/**
 * The shared matching fixture uses the generated bundle format in a temporary test directory.
 * Driver tests exercise the real fingerprint, snapshot, verification and record paths there.
 * This never touches domains/ or any runs/ tree: those are system outputs (operator decision,
 * 2026-07-26 — tests invoke the system; only its owners write those outputs). Extracted from
 * test/run-driver.test.ts when the M4 entrypoint test became its second consumer.
 */
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { EVALUATOR_CALIBRATION_POLICY } from "../../src/claim/calibration.ts";
import type { Brief } from "../../src/truth/brief.ts";
import type { Toolset } from "../../src/truth/contracts.ts";
import type { Solver } from "../../src/truth/solve.ts";
import type { BuildTask } from "../../src/truth/tasks.ts";
import { double } from "./doubles.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";

export const MATCHING_BRIEF: Brief = {
  slug: "matching",
  domain: "routing",
  correctnessContract: "check-program/v1",
  decisions: ["part placement and slot binding are writer decisions"],
  gates: ["submit blocks on an empty part list"],
  // Both checks decide from a hidden expectation, so nothing the solver reads would state what
  // they demand: the public row carries the rule and the private row keeps the recipe out.
  ruleDecisions: [
    {
      id: "binding-completeness",
      visibility: "public",
      families: ["single-part", "two-part"],
      statement:
        "each declared part appears exactly once in assignments, bound to the slot the task's bindings table names for it",
      publicInputPaths: ["$.parts", "$.bindings"],
    },
    {
      id: "slot-search-order",
      visibility: "private",
      statement: "bind the scarcest slot first, then widen",
    },
  ],
  truthChecks: [
    {
      id: "parts-assigned",
      assertion: "every declared part binds exactly one slot and no assignment names an undeclared part",
      citedDecisionIds: ["binding-completeness"],
      joinIds: ["parts-to-slots"],
      execution: {
        families: "all",
        artifactPaths: ["$.assignments"],
        publicInputPaths: ["$.parts", "$.bindings"],
        hidden: "required",
        evidence: { kind: "authored" },
      },
    },
    {
      id: "expected-binding",
      assertion: "the assignment set matches the task's expected binding set exactly",
      citedDecisionIds: ["binding-completeness"],
      execution: {
        families: "all",
        artifactPaths: ["$.assignments"],
        publicInputPaths: ["$.parts", "$.bindings"],
        hidden: "required",
        evidence: { kind: "authored" },
      },
    },
  ],
  joins: [
    {
      id: "parts-to-slots",
      description: "declared parts joined to slot assignments by exact part id",
      decoyClasses: ["alias-swap", "ghost-entity"],
    },
  ],
  // The binding set is the deliverable a solver must produce anew per task, so the family census
  // moves exactly this root between siblings of one family.
  artifactSchema: [
    { name: "assignments", "shape": "array of {part, slot} binding objects", taskConditioned: true },
  ],
  designRuleConstants: [
    { name: "max-slots-per-part", value: 1, unit: "slot", authority: "domain brief", citation: "s.1" },
  ],
};

/** Each family varies an explicit public axis while preserving both required hidden operands. */
export const MATCHING_TASKS: BuildTask[] = [
  {
    taskId: "t1",
    family: "single-part",
    publicInput: { variant: 1, parts: ["alpha"], bindings: [{ part: "alpha", slot: "s3" }] },
    intendedFeatures: { hiddenChecks: { min: 2, max: 2 }, maxPublicRows: { max: 1 } },
    difficultyAxisPath: "$.variant",
    hidden: [
      { checkId: "parts-assigned", expectation: { parts: ["alpha"] } },
      { checkId: "expected-binding", expectation: { pairs: [["alpha", "s3"]] } },
    ],
  },
  {
    taskId: "t1b",
    family: "single-part",
    publicInput: { variant: 2, parts: ["gamma"], bindings: [{ part: "gamma", slot: "s1" }] },
    intendedFeatures: { hiddenChecks: { min: 2, max: 2 }, maxPublicRows: { max: 1 } },
    difficultyAxisPath: "$.variant",
    hidden: [
      { checkId: "parts-assigned", expectation: { parts: ["gamma"] } },
      { checkId: "expected-binding", expectation: { pairs: [["gamma", "s1"]] } },
    ],
  },
  {
    taskId: "t2",
    family: "two-part",
    publicInput: {
      variant: 1,
      parts: ["alpha", "beta"],
      bindings: [
        { part: "alpha", slot: "s3" },
        { part: "beta", slot: "s4" },
      ],
    },
    intendedFeatures: { hiddenChecks: { min: 2, max: 2 }, maxPublicRows: { min: 2, max: 2 } },
    difficultyAxisPath: "$.variant",
    hidden: [
      { checkId: "parts-assigned", expectation: { parts: ["alpha", "beta"] } },
      {
        checkId: "expected-binding",
        expectation: {
          pairs: [
            ["alpha", "s3"],
            ["beta", "s4"],
          ],
        },
      },
    ],
  },
  {
    taskId: "t2b",
    family: "two-part",
    publicInput: {
      variant: 2,
      parts: ["gamma", "delta"],
      bindings: [
        { part: "gamma", slot: "s5" },
        { part: "delta", slot: "s6" },
      ],
    },
    intendedFeatures: { hiddenChecks: { min: 2, max: 2 }, maxPublicRows: { min: 2, max: 2 } },
    difficultyAxisPath: "$.variant",
    hidden: [
      { checkId: "parts-assigned", expectation: { parts: ["gamma", "delta"] } },
      {
        checkId: "expected-binding",
        expectation: {
          pairs: [
            ["gamma", "s5"],
            ["delta", "s6"],
          ],
        },
      },
    ],
  },
] satisfies BuildTask[];

export const MATCHING_ACCEPTS = [
  // The accept solves its bound task: t2 publicly binds alpha to s3 and beta to s4.
  // Each control belongs to one task.
  // The judge sees {task, artifact} only — an accept contradicting its own task's
  // public binding shares bytes with a reject and forces opposite verdicts on one subject
  // (judge-census simulation, 2026-08-08).
  {
    id: "a1",
    taskId: "t2",
    artifact: {
      assignments: [
        { part: "alpha", slot: "s3" },
        { part: "beta", slot: "s4" },
      ],
    },
    authoredBy: "accept-controls",
  },
  {
    id: "a-single-part",
    taskId: "t1",
    artifact: { assignments: [{ part: "alpha", slot: "s3" }] },
    authoredBy: "accept-controls",
  },
];

export const MATCHING_REJECTS = [
  {
    id: "r-alias",
    taskId: "t1",
    artifact: {
      assignments: [
        { part: "alpha", slot: "s1" },
        { part: "alpha", slot: "s2" },
      ],
    },
    mutationClass: "duplicate-owner",
    targetsJoin: "parts-to-slots",
    decoyClass: "alias-swap",
    expectedCheckId: "parts-assigned",
    hidden: [{ checkId: "parts-assigned", expectation: { parts: ["alpha"] } }],
  },
  {
    id: "r-ghost",
    taskId: "t1",
    artifact: {
      assignments: [
        { part: "ghost", slot: "s9" },
        { part: "alpha", slot: "s1" },
      ],
    },
    mutationClass: "ghost-entity",
    targetsJoin: "parts-to-slots",
    decoyClass: "ghost-entity",
    expectedCheckId: "parts-assigned",
    hidden: [{ checkId: "parts-assigned", expectation: { parts: ["alpha"] } }],
  },
  {
    id: "r-wrongbind",
    taskId: "t1",
    artifact: { assignments: [{ part: "alpha", slot: "s1" }] },
    mutationClass: "wrong-expectation",
    expectedCheckId: "expected-binding",
    hidden: [{ checkId: "expected-binding", expectation: { pairs: [["alpha", "s9"]] } }],
  },
  // The family-discrimination floor needs one reject per task family whose executed blocking
  // failure is exactly its expectedCheckId. The three rejects above all bind to t1 (single-part);
  // this one gives the two-part family its isolation witness. Its artifact contradicts t2's own
  // public binding (beta publicly binds s4, here s9), so a judge given that task can decide it and it
  // never shares bytes with the accept bound to the same task.
  {
    id: "r-wrongbind-two-part",
    taskId: "t2",
    artifact: {
      assignments: [
        { part: "alpha", slot: "s3" },
        { part: "beta", slot: "s9" },
      ],
    },
    mutationClass: "wrong-expectation",
    expectedCheckId: "expected-binding",
    hidden: [
      {
        checkId: "expected-binding",
        expectation: {
          pairs: [
            ["alpha", "s3"],
            ["beta", "s4"],
          ],
        },
      },
    ],
  },
  // The hollow-control minimum requires one reject per family that empties the deliverable. Both
  // keep the artifact structurally valid and remove only the taskConditioned "assignments" root.
  {
    id: "r-hollow-single-part",
    taskId: "t1",
    artifact: { assignments: [] },
    mutationClass: "hollow",
    expectedCheckId: "expected-binding",
    hidden: [{ checkId: "expected-binding", expectation: { pairs: [["alpha", "s3"]] } }],
  },
  {
    id: "r-hollow-two-part",
    taskId: "t2",
    artifact: { assignments: [] },
    mutationClass: "hollow",
    expectedCheckId: "expected-binding",
    hidden: [
      {
        checkId: "expected-binding",
        expectation: {
          pairs: [
            ["alpha", "s3"],
            ["beta", "s4"],
          ],
        },
      },
    ],
  },
  {
    id: "r-ghost-two-part",
    taskId: "t2",
    artifact: {
      assignments: [
        { part: "alpha", slot: "s3" },
        { part: "ghost", slot: "s4" },
      ],
    },
    mutationClass: "ghost-entity",
    expectedCheckId: "parts-assigned",
    hidden: [{ checkId: "parts-assigned", expectation: { parts: ["alpha", "beta"] } }],
  },
];

export const MATCHING_EVALUATOR_SOURCE = `
import type { EvaluationRequest } from "@ana/correctness-model-bundle";
interface SlotBinding { part: string; slot: string }
interface SlotArtifact { assignments: SlotBinding[] }
interface SlotHiddenExpectation { checkId: string; expectation: { parts?: string[]; pairs?: Array<[string, string]> } }
type Request = EvaluationRequest<SlotArtifact, SlotHiddenExpectation[]>;
const same = (a: unknown[], b: unknown[]) => JSON.stringify(a.map(x => JSON.stringify(x)).sort()) === JSON.stringify(b.map(x => JSON.stringify(x)).sort());
export const checks = {
  "parts-assigned": ({artifact, hidden}: Request): boolean => {
    const rows = artifact.assignments;
    return Array.isArray(rows) && (rows.length === 0 || same(rows.map(a => a.part), hidden[0]?.expectation.parts ?? []));
  },
  "expected-binding": ({artifact, hidden}: Request): boolean => {
    const rows = artifact.assignments;
    if (!Array.isArray(rows)) return false;
    const pairs = hidden[0]?.expectation.pairs ?? [];
    // The part-set check owns malformed membership; this check owns completeness and slot values.
    if (rows.length > 0 && !same(rows.map(a => a.part), pairs.map(p => p[0]))) return true;
    return same(rows.map(a => [a.part, a.slot]), pairs);
  },
};
`;

export const MATCHING_REFERENCE_SOURCE = `
import type { PublicTask } from "@ana/correctness-model-bundle";
interface SlotBinding { part: string; slot: string }
export function solve(task: PublicTask<{ parts: string[]; bindings: SlotBinding[] }>) {
  return { assignments: task.publicInput.bindings.map(binding => ({ ...binding })) };
}
`;

export const MATCHING_TOOLS_SOURCE = `
import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "typebox";

export function createDomainHarness(task) {
  const parts = (draft) => draft.getValue("parts") ?? [];
  const assignments = (draft) => draft.getValue("assignments") ?? [];
  const tools = [
    defineDraftTool({
      name: "declare_part", label: "Declare part", description: "declare a part by name",
      parameters: Type.Object({ name: Type.String() }),
      executionMode: "sequential",
      run: ({ name }, draft) => {
        draft.setValue("parts", [...parts(draft), name]);
        return { text: "declared " + name };
      },
    }),
    defineDraftTool({
      name: "bind_slot", label: "Bind slot", description: "bind a declared part to a slot",
      parameters: Type.Object({ part: Type.String(), slot: Type.String() }),
      executionMode: "sequential",
      run: ({ part, slot }, draft) => {
        const next = [...assignments(draft), { part, slot }];
        draft.setValue("assignments", next);
        draft.setArtifact({ assignments: next });
        return { text: "bound " + part };
      },
    }),
    defineDraftTool({
      name: "set_assignments", label: "Set assignments", description: "replace the complete public assignment list",
      parameters: Type.Object({ assignments: Type.Array(Type.Object({ part: Type.String(), slot: Type.String() })) }),
      executionMode: "sequential",
      run: ({ assignments: next }, draft) => {
        draft.setValue("assignments", next);
        draft.setArtifact({ assignments: next });
        return { text: "assignments set" };
      },
    }),
    defineDraftTool({
      name: "hint", label: "Hint", description: "advisory nudge about slot conventions; never mutates state",
      parameters: Type.Object({}),
      run: () => ({ text: "bind each part to the slot its public row names" }),
    }),
  ];
  return { tools };
}
`;

/** The persisted tool-kind spec read by the comparison and generated-tool boundaries. */
export const MATCHING_TOOLS_SPEC = {
  presets: ["shell"],
  tools: [
    { name: "declare_part", kind: "writer", description: "declare a part by name" },
    {
      name: "bind_slot",
      kind: "artifact-writer",
      description: "bind a declared part to a slot",
    },
    {
      name: "set_assignments",
      kind: "artifact-writer",
      description: "replace the complete public assignment list",
    },
    {
      name: "hint",
      kind: "advisor",
      description: "advisory nudge about slot conventions; never mutates state",
    },
  ],
};

/** The operating guide the fixture bundle ships: reusable policy, one stable rule marker, no task. */
export const MATCHING_OPERATING_GUIDE = `# Operating Guide

<!-- rule:understand-before-writing -->
Declare every part before binding a slot to it.
`;

/**
 * Grow the matching controls to the calibration minimum required by authoring sessions.
 *
 * These fixtures use the smallest set that exercises both decoy cases, the joinless
 * obligation, and both task families. A real build authors at least the frozen policy's floor per
 * side, and the sessions hold authors to it, so suites testing loop routing, reuse seeding or epochs
 * pad here instead of each hand-writing twenty near-identical rows. Reading the policy means
 * tightening the floor moves the fixtures with it and no test restates a frozen number.
 *
 * Padding never changes obligation coverage: every padded reject trips `parts-assigned`, which the
 * base corpus already covers, so a candidate deliberately missing `expected-binding` still misses
 * it after padding. A padded accept preserves the bound task's valid assignment and a padded
 * reject carries the hidden row its own check consumes, so each one is genuinely rejected rather
 * than counted as a reject nobody executed.
 */
export function padToCalibrationFloor<T extends { id: string }>(kind: "accept" | "reject", base: T[]): T[] {
  const floor =
    kind === "accept"
      ? EVALUATOR_CALIBRATION_POLICY.minimumKnownPasses
      : EVALUATOR_CALIBRATION_POLICY.minimumKnownFailures;
  const padded = [...base];
  for (let i = padded.length; i < floor; i++) {
    // T is the caller's own accept or reject row; the compiler cannot check a literal against an
    // unresolved type parameter, so the padding shape is stated by the double.
    padded.push(
      double<T>(
        kind === "accept"
          ? { id: `a-pad${i}`, taskId: "t1", artifact: { assignments: [{ part: "alpha", slot: "s3" }] } }
          : {
              id: `r-pad${i}`,
              taskId: "t1",
              artifact: { assignments: [{ part: `pad${i}`, slot: "s1" }] },
              mutationClass: "ghost-entity",
              expectedCheckId: "parts-assigned",
              hidden: [{ checkId: "parts-assigned", expectation: { parts: ["alpha"] } }],
            },
      ),
    );
  }
  return padded;
}

export function writeMatchingSlug(dir: string): void {
  mkdirSync(join(dir, "correctness-model/reference"), { recursive: true });
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "correctness-model/brief.json"), JSON.stringify(MATCHING_BRIEF));
  writeFileSync(join(dir, "correctness-model/evaluator.ts"), MATCHING_EVALUATOR_SOURCE);
  writeFileSync(join(dir, "correctness-model/reference/index.ts"), MATCHING_REFERENCE_SOURCE);
  // Controls refer to task ids, so write the matching tasks alongside them.
  writeFileSync(join(dir, "correctness-model/tasks.json"), JSON.stringify(MATCHING_TASKS));
  writeFileSync(
    join(dir, "correctness-model/controls.json"),
    JSON.stringify({ accept: MATCHING_ACCEPTS, reject: MATCHING_REJECTS }),
  );
  writeFileSync(join(dir, "agent/tools.ts"), MATCHING_TOOLS_SOURCE);
  writeFileSync(join(dir, "agent/BUILT_AGENTS.md"), MATCHING_OPERATING_GUIDE);
}

/** Complete bundle fixture used when a test needs adoption or an immutable snapshot. */
export function writeMatchingBuildFixture(dir: string): void {
  writeMatchingSlug(dir);
  writeFileSync(join(dir, "correctness-model/tasks.json"), JSON.stringify(MATCHING_TASKS));
  writeFileSync(
    join(dir, "correctness-model/controls.json"),
    JSON.stringify({
      accept: padToCalibrationFloor("accept", MATCHING_ACCEPTS),
      reject: padToCalibrationFloor("reject", MATCHING_REJECTS),
    }),
  );
  writeFileSync(join(dir, "agent/tools-spec.json"), JSON.stringify(MATCHING_TOOLS_SPEC));
}

/** Scripted in-process solver: drives the generated toolset like a model would, flubbing the
 *  named tasks (wrong slot) so pass/fail is deterministic. `onToolsetNames` discloses the tool
 *  contract each solve actually received — the ablation warranty reads it. */
/** The first part of a fixture task. Every task in this file declares at least one, so an empty
 *  list is a broken fixture rather than a case the flub path means to cover. */
function firstPart(parts: readonly string[]): string {
  const part = parts[0];
  if (part === undefined) throw new Error("fixture task declares no parts");
  return part;
}

export function scriptedMatchingSolver(
  flubTaskIds: ReadonlySet<string> = new Set(),
  onToolsetNames?: (taskId: string, names: string[]) => void,
  reverseBindingTaskIds: ReadonlySet<string> = new Set(),
): Solver {
  let callSeq = 0;
  return async (task, toolset: Toolset) => {
    /* SAFETY: this solver runs only against the matching battery in this file, whose every task
       carries exactly this public input. */
    const input = task.publicInput as { parts: string[]; bindings: Array<{ part: string; slot: string }> };
    onToolsetNames?.(
      task.taskId,
      toolset.tools.map((t) => t.name),
    );
    const byName = new Map(toolset.tools.map((t) => [t.name, t]));
    const call = async (name: string, params: JsonObject) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`generated toolset is missing tool "${name}"`);
      // The generated tools declare their own parameter schemas, which this caller does not read.
      await tool.execute(`c${++callSeq}`, double(params));
    };
    for (const part of input.parts) await call("declare_part", { name: part });
    const assignments = flubTaskIds.has(task.taskId)
      ? [{ part: firstPart(input.parts), slot: "flub-wrong-slot" }]
      : reverseBindingTaskIds.has(task.taskId)
        ? input.bindings.toReversed()
        : input.bindings;
    // Structured artifact-writer calls use the controller-derived whole public representation;
    // their generated parameters and callbacks are placeholders.
    await call("bind_slot", { assignments });
    await call("submit", {});
    return {
      turns: 1,
      completedTurns: 1,
      errors: [],
      runtimeIdentities: [
        {
          schema: "runtime-model-identity/v2",
          agentRuntime: {
            id: "pi-agent-core",
            version: "test",
            sessionId: `scripted-session-${task.taskId}`,
          },
          provider: {
            id: "openai-codex",
            model: "gpt-5.5",
            resultId: `scripted-result-${task.taskId}`,
            nativeSessionId: null,
          },
        },
      ],
    };
  };
}
