/**
 * One matching-domain corpus and everything a test needs to run the production verifier over it:
 * the brief and battery, the accept controls, the generated evaluator and tools sources, and a
 * scratch root inside the repository.
 *
 * The evaluator and tools arrive as source text rather than as imported modules, because the
 * runner's whole job is to write them to disk, fingerprint them, load them and execute them; a
 * fixture handed over as an already-imported module would skip the part under test.
 *
 * Ten test files import this, and only five of them are the `verification-runner-*` suite — the
 * others are the battery, discrimination, measure-claim and run-driver files, which want a real
 * corpus more than they want a verification-runner fixture. So treat it as the shared matching
 * corpus, and expect a change here to reach further than its name suggests.
 */

import { type JsonObject, asRecord } from "../../src/meta/json-shape.ts";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { piBuiltSolver } from "../../src/backends/pi-built.ts";
import { fingerprintSlug } from "../../src/claim/fingerprint.ts";
import { builtSolveIsolation } from "../../src/run/built-agent-runtime.ts";
import { compilePublicArtifactSchema } from "../../src/solve/public-artifact-schema.ts";
import type { RunCondition } from "../../src/claim/case-record.ts";
import type { Brief } from "../../src/truth/brief.ts";
import type { VerificationInput } from "../../src/truth/build-deps.ts";
import { type VerificationRunnerOptions, makeVerify } from "../../src/truth/verification-runner.ts";
import { type Toolset } from "../../src/truth/contracts.ts";
import {
  MATCHING_BRIEF,
  MATCHING_REJECTS,
  MATCHING_EVALUATOR_SOURCE,
  MATCHING_REFERENCE_SOURCE,
} from "./matching-fixture.ts";
import type { BuildTask, TaskBattery } from "../../src/truth/tasks.ts";
import { type Solver } from "../../src/truth/solve.ts";
import { double, required } from "./doubles.ts";
import { runtimeProcess } from "../../src/meta/process.ts";

/** The three authored files of a fixture bundle a case may replace. */
interface BundleFiles {
  evaluator?: string;
  tools?: string;
  controls?: { accept: unknown[]; reject: unknown[] };
}

/** The run condition a scripted battery records: the shipping variant with no adviser removed. */
export const SCRIPTED_CONDITION: RunCondition = {
  variant: "shipping",
  advisorsRemoved: [],
  toolInterfaceHash: null,
};
/** The threshold manifest digest a scripted battery records. */
export const SCRIPTED_THRESHOLD_DIGEST = "f".repeat(64);

export const BRIEF: Brief = {
  ...MATCHING_BRIEF,
  artifactSchema: [{ name: "assignments", "shape": "array of {part, slot} binding objects" }],
};

export const TASKS: TaskBattery = {
  tasks: [
    {
      taskId: "t1",
      family: "single-part",
      publicInput: { parts: ["alpha"], bindings: [{ part: "alpha", slot: "s3" }] },
      intendedFeatures: { hiddenChecks: { min: 2, max: 2 }, maxPublicRows: { max: 1 } },
      hidden: [
        { checkId: "parts-assigned", expectation: { parts: ["alpha"] } },
        { checkId: "expected-binding", expectation: { pairs: [["alpha", "s3"]] } },
      ],
    },
    {
      taskId: "t2",
      family: "two-part",
      intendedFeatures: { hiddenChecks: { min: 2, max: 2 }, maxPublicRows: { min: 2, max: 2 } },
      publicInput: {
        parts: ["alpha", "beta"],
        bindings: [
          { part: "alpha", slot: "s3" },
          { part: "beta", slot: "s4" },
        ],
      },
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
      taskId: "t3",
      family: "two-part",
      intendedFeatures: { hiddenChecks: { min: 2, max: 2 }, maxPublicRows: { min: 2, max: 2 } },
      publicInput: {
        parts: ["gamma", "delta"],
        bindings: [
          { part: "gamma", slot: "s5" },
          { part: "delta", slot: "x0" },
        ],
      },
      hidden: [
        { checkId: "parts-assigned", expectation: { parts: ["gamma", "delta"] } },
        {
          checkId: "expected-binding",
          expectation: {
            pairs: [
              ["gamma", "s5"],
              ["delta", "x0"],
            ],
          },
        },
      ],
    },
  ],
};

const [firstTask] = TASKS.tasks;
export const ACCEPTS = [
  {
    id: "a1",
    taskId: "t1",
    // Accepts evaluate under their bound task's hidden expectations, so this artifact carries t1's
    // expected binding (alpha → s3) — an accept that contradicts its own task is a corpus defect.
    artifact: { assignments: [{ part: "alpha", slot: "s3" }] },
    authoredBy: "accept-controls",
  },
];
export const EVALUATOR_SOURCE = MATCHING_EVALUATOR_SOURCE;
export const LAX_EVALUATOR_SOURCE = EVALUATOR_SOURCE;

// The generated domain plugin. The inherited starter supplies DraftStore inspection, preview,
// and the one controller-owned submission path.
export const TOOLS_SOURCE = `
import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

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
        draft.setValue("assignments", [...assignments(draft), { part, slot }]);
        draft.setArtifact({ assignments: assignments(draft) });
        return { text: "bound " + part };
      },
    }),
  ];
  return { tools };
}
`;

export const TOOLS_SPEC = {
  presets: [],
  declined: { files: "fixture without a shell" },
  tools: [
    { name: "declare_part", kind: "writer", description: "Declare a part." },
    { name: "bind_slot", kind: "artifact-writer", description: "Bind and prepare assignments." },
  ],
};

/** The first part of a fixture task. Every task in this file declares at least one, so an empty
 *  list is a broken fixture rather than a case the deliberately wrong-answer path covers. */
export function firstPart(parts: readonly string[]): string {
  const part = parts[0];
  if (part === undefined) throw new Error("fixture task declares no parts");
  return part;
}

/** Whether a control artifact sets `key` to `true`, the one fact each census evaluator below
 *  branches on. EvaluatorFn receives the artifact opaque, so a non-object reads as unset. */
export const controlFlag = (artifact: unknown, key: string): boolean => asRecord(artifact)?.[key] === true;

// Scratch must live INSIDE the repo so generated bundles resolve @ana/* (the vendor/ shims) via
// root node_modules. The unique prefix is ignored by repository scanners, so an overlapping lint
// or interrupted test cannot mistake these generated fixtures for source.
export const SCRATCH_ROOT = mkdtempSync(join(import.meta.dir, ".ana-scratch-"));

/** Each test file registers this in its own afterAll: one scratch root per worker. */
export function removeScratchRoot(): void {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
}
let scratchSeq = 0;
export function scratch(): string {
  const dir = join(SCRATCH_ROOT, `slug-${scratchSeq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A slug whose r-ghost reject contains a valid answer, making discrimination unclaimable.
 *  The early-exit and solver-spend tests share this fixture. */
export function laxVerifierSlug(): string {
  return bundleSlug({
    evaluator: LAX_EVALUATOR_SOURCE,
    controls: {
      accept: ACCEPTS,
      reject: REJECTS.map((control) =>
        control.id === "r-ghost"
          ? { ...control, artifact: { assignments: [{ part: "alpha", slot: "s3" }] } }
          : control,
      ),
    },
  });
}

/** A fresh scratch slug holding the fixture bundle, with any of its three authored files replaced. */
export function bundleSlug(files: BundleFiles = {}): string {
  const slugDir = scratch();
  mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
  mkdirSync(join(slugDir, "agent"), { recursive: true });
  writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), files.evaluator ?? EVALUATOR_SOURCE);
  writeFileSync(join(slugDir, "agent/tools.ts"), files.tools ?? TOOLS_SOURCE);
  writeFileSync(
    join(slugDir, "correctness-model/controls.json"),
    JSON.stringify(files.controls ?? { accept: ACCEPTS, reject: REJECTS }),
  );
  return slugDir;
}

/** makeVerify under the scripted condition every fixture battery records, with the scripted solver
 *  unless the case replaces it. */
export function scriptedVerify(runId: string, overrides: Partial<VerificationRunnerOptions> = {}) {
  return makeVerify({
    solver: scriptedSolver(),
    backendPin: "scripted/none",
    condition: SCRIPTED_CONDITION,
    thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
    capabilities: ["web-search:off"],
    runId,
    ...overrides,
  });
}

/** evaluate() checks the immutable execution snapshot against the fingerprint, so a direct
 *  makeVerify call needs a fingerprint computed from the fixture files. A mismatched hash
 *  refuses execution before the bundle loads. */
export function fingerprintOf(slugDir: string): VerificationInput["fingerprint"] {
  const briefPath = join(slugDir, "correctness-model", "brief.json");
  if (!existsSync(briefPath)) writeFileSync(briefPath, JSON.stringify(BRIEF));
  const specPath = join(slugDir, "agent", "tools-spec.json");
  if (!existsSync(specPath)) writeFileSync(specPath, JSON.stringify(TOOLS_SPEC));
  const guidePath = join(slugDir, "agent", "BUILT_AGENTS.md");
  if (!existsSync(guidePath)) writeFileSync(guidePath, "Assign every part to one slot, then submit.\n");
  // Controls name their tasks by id, so the fingerprinted fixture carries tasks.json beside
  // controls.json, as the production bundle does.
  const tasksPath = join(slugDir, "correctness-model", "tasks.json");
  if (!existsSync(tasksPath)) writeFileSync(tasksPath, JSON.stringify(TASKS.tasks));
  const referencePath = join(slugDir, "correctness-model/reference/index.ts");
  mkdirSync(join(slugDir, "correctness-model/reference"), { recursive: true });
  if (!existsSync(referencePath)) writeFileSync(referencePath, MATCHING_REFERENCE_SOURCE);
  const fingerprint = fingerprintSlug(slugDir);
  if (!fingerprint.ok) {
    throw new Error(`fixture failed the fingerprint: ${JSON.stringify(fingerprint.findings)}`);
  }
  return fingerprint;
}

export const PUBLIC_SCHEMA = compilePublicArtifactSchema(
  [{ name: "assignments" }],
  [{ assignments: [{ part: "alpha", slot: "s1" }] }],
);

/** The battery every grounding case evaluates: one slug, its own directory and the shared tasks. */
export function matchingBattery(slugDir: string) {
  return { slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks: TASKS.tasks };
}

if (firstTask === undefined) throw new Error("fixture battery is empty");
export const FIRST_TASK: BuildTask = firstTask;

// Reject controls exercise membership and binding checks that a presence-only verifier would miss.
// Each names the check it should fail (expectedCheckId), so runControls checks the observed failure
// against that declaration. r-wrongbind retains valid membership but supplies a binding that
// contradicts its hidden expectation. It exercises the hidden comparison path as well as the
// public artifact shape; a control with no hidden operand would not cover that comparison.
export const REJECTS = [
  ...["r-alias", "r-ghost", "r-wrongbind"].map((id) =>
    structuredClone(
      required(
        MATCHING_REJECTS.find((control) => control.id === id),
        id,
      ),
    ),
  ),
  // The two-part family's reject: every family needs one reject naming a check that applies to it.
  // Reject artifacts keep to slots s1/s2/s9. Accept a1 must carry t1's expected binding (s3),
  // so the all-task non-result fixtures key on s4/s5/x0 plus a flubbed t1 submission instead.
  {
    id: "r-alias-two-part",
    taskId: "t2",
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
    hidden: [{ checkId: "parts-assigned", expectation: { parts: ["alpha", "beta"] } }],
  },
  {
    id: "r-wrongbind-two-part",
    taskId: "t2",
    artifact: {
      assignments: [
        { part: "alpha", slot: "s1" },
        { part: "beta", slot: "s2" },
      ],
    },
    mutationClass: "wrong-expectation",
    expectedCheckId: "expected-binding",
    hidden: [
      {
        checkId: "expected-binding",
        expectation: {
          pairs: [
            ["alpha", "s9"],
            ["beta", "s2"],
          ],
        },
      },
    ],
  },
];

export function directPiSlug(): string {
  // Only t1-bound rejects: this fixture's non-overwriting consumers record [FIRST_TASK] batteries,
  // where a t2-bound control would be an unresolved task and the two-part cells do not exist.
  return bundleSlug({
    controls: { accept: ACCEPTS, reject: REJECTS.filter((control) => control.taskId === "t1") },
  });
}

export function directPiSolver(calls: Array<{ id: string; name: string; arguments: JsonObject }>) {
  const model = "faux-eval-production";
  const response = {
    ...fauxAssistantMessage(
      calls.map((call) => fauxToolCall(call.name, call.arguments, { id: call.id })),
      { stopReason: "toolUse", responseId: "pi-eval-result" },
    ),
    responseModel: model,
  };
  return piBuiltSolver(
    {
      profile: {
        provider: "openrouter",
        transport: "openrouter",
        model,
        thinkingLevel: "off",
      },
      auth: async () => ({ type: "api_key", key: "fake-pi-eval-key" }),
      policy: builtSolveIsolation(runtimeProcess.cwd()),
      fakeResponses: [response],
    },
    { maxTurns: 1 },
  );
}

/** Drives the imported toolset through execute(), using scripted calls in place of a model.
 *  "wrong-binding" submits an incorrect assignment for the verifier to reject. "hollow" submits
 *  an empty assignments array; the public schema admits that shape and the verifier decides
 *  whether it satisfies the task. Both use the controller-owned submission path. */
export function scriptedSolver(
  flubTaskIds: ReadonlySet<string> = new Set(),
  flubMode: "wrong-binding" | "hollow" = "wrong-binding",
): Solver {
  let callSeq = 0;
  return async (task, toolset: Toolset) => {
    /* SAFETY: this solver only runs against copies of
       the TASKS fixture at the top of this file, which gives every task exactly this input. */
    const input = task.publicInput as { parts: string[]; bindings: Array<{ part: string; slot: string }> };
    const byName = new Map(toolset.tools.map((t) => [t.name, t]));
    const call = async (name: string, params: JsonObject) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`generated toolset is missing tool "${name}"`);
      // The generated tools declare their own parameter schemas, which this caller does not read.
      await tool.execute(`c${++callSeq}`, double(params));
    };
    for (const part of input.parts) await call("declare_part", { name: part });
    const wrongSlot =
      flubMode === "wrong-binding" && input.parts.length > 0
        ? [{ part: firstPart(input.parts), slot: "flub-wrong-slot" }]
        : [];
    const assignments = flubTaskIds.has(task.taskId) ? wrongSlot : input.bindings;
    await call("bind_slot", { assignments });
    await call("submit", {});
    return { turns: 1, completedTurns: 1, errors: [] };
  };
}
