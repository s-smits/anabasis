/**
 * The candidate slug the authoring probes in src/truth/probes.ts run over, and the two-tool
 * generated toolset they conform.
 *
 * This is deliberately not `writeMatchingSlug` from matching-fixture.ts, whose bundle the run
 * driver and the adoption tests share. That one ships four tools, a shell preset and untyped
 * generated source; the conformance probe typechecks what it loads and opens every declared tool
 * on every task, so a fixture it can exercise exhaustively wants exactly two typed tools and no
 * preset. The brief, rejects, evaluator and reference solve are still the matching fixture's, so a
 * change to the domain's meaning reaches both.
 *
 * `probeSlugs` binds the writer and the conformance shorthand to one scratch root, which the
 * caller owns through `scratchDir` and one `afterAll(cleanupScratch)`.
 */
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { compilePublicArtifactSchema } from "../../src/solve/public-artifact-schema.ts";
import type { Brief } from "../../src/truth/brief.ts";
import type { ControlCorpus } from "../../src/truth/controls.ts";
import { probeConformanceWithEvidence } from "../../src/truth/probes.ts";
import type { BuildTask } from "../../src/truth/tasks.ts";
import type { ToolsSpec } from "../../src/truth/tools-spec.ts";
import {
  MATCHING_BRIEF,
  MATCHING_EVALUATOR_SOURCE,
  MATCHING_REFERENCE_SOURCE,
  MATCHING_REJECTS,
} from "./matching-fixture.ts";
import { required } from "./doubles.ts";

export const BRIEF: Brief = structuredClone(MATCHING_BRIEF);

export const TASK: BuildTask = {
  taskId: "t1",
  family: "single-part",
  publicInput: { parts: ["alpha"], bindings: [{ part: "alpha", slot: "s3" }] },
  intendedFeatures: { hiddenChecks: { min: 2, max: 2 }, maxPublicRows: { max: 1 } },
  hidden: [
    { checkId: "parts-assigned", expectation: { parts: ["alpha"] } },
    { checkId: "expected-binding", expectation: { pairs: [["alpha", "s3"]] } },
  ],
} satisfies BuildTask;
export const TASK_TWO: BuildTask = { ...TASK, taskId: "t2", family: "two-part" };

export const ACCEPTS = [
  {
    id: "a1",
    taskId: "t1",
    // Accepts evaluate under the bound task's hidden expectations, so this artifact must satisfy
    // t1's expected-binding row [["alpha", "s3"]].
    artifact: { assignments: [{ part: "alpha", slot: "s3" }] },
    authoredBy: "accept-controls",
  },
];
export const REJECTS = [
  ...["r-alias", "r-ghost", "r-wrongbind"].map((id) =>
    structuredClone(
      required(
        MATCHING_REJECTS.find((control) => control.id === id),
        id,
      ),
    ),
  ),
  // The probe enforces the cell floor: each check applicable to TASK_TWO's family needs one
  // reject of that family failing on it, like the t1 rejects above.
  {
    id: "r-ghost-two-part",
    taskId: "t2",
    artifact: {
      assignments: [
        { part: "ghost", slot: "s9" },
        { part: "alpha", slot: "s1" },
      ],
    },
    mutationClass: "ghost-entity",
    expectedCheckId: "parts-assigned",
    hidden: [{ checkId: "parts-assigned", expectation: { parts: ["alpha"] } }],
  },
  {
    id: "r-wrongbind-two-part",
    taskId: "t2",
    artifact: { assignments: [{ part: "alpha", slot: "s1" }] },
    mutationClass: "wrong-expectation",
    expectedCheckId: "expected-binding",
    hidden: [{ checkId: "expected-binding", expectation: { pairs: [["alpha", "s9"]] } }],
  },
];
export const CORPUS = { accept: ACCEPTS, reject: REJECTS };

export const EVALUATOR_SOURCE = MATCHING_EVALUATOR_SOURCE;

export const TOOLS_SOURCE = `
import { defineDraftTool } from "@ana/agent-bundle";
import type { DraftStore } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

export function createDomainHarness(task) {
  const parts = (draft: DraftStore): string[] => (draft.getValue("parts") as string[] | undefined) ?? [];
  const assignments = (draft: DraftStore): Array<{ part: string; slot: string }> =>
    (draft.getValue("assignments") as Array<{ part: string; slot: string }> | undefined) ?? [];
  const tools = [
    defineDraftTool({
      name: "declare_part", label: "Declare part", description: "declare a part by name",
      parameters: Type.Object({ name: Type.String() }),
      executionMode: "sequential",
      run: ({ name }: { name: string }, draft: DraftStore) => {
        draft.setValue("parts", [...parts(draft), name]);
        return { text: "declared " + name };
      },
    }),
    defineDraftTool({
      name: "bind_slot", label: "Bind slot", description: "bind a declared part to a slot",
      parameters: Type.Object({ part: Type.String(), slot: Type.String() }),
      executionMode: "sequential",
      run: ({ part, slot }: { part: string; slot: string }, draft: DraftStore) => {
        const next = [...assignments(draft), { part, slot }];
        draft.setValue("assignments", next);
        draft.setArtifact({ assignments: next });
        return { text: "bound " + part };
      },
    }),
  ];
  return { tools };
}
`;

export const SPEC: ToolsSpec = {
  presets: [],
  declined: { files: "fixture without a shell" },
  tools: [
    { name: "declare_part", kind: "writer", description: "declare a part by name" },
    // Byte-identical to the description agent/tools.ts serves: conformance requires the two.
    { name: "bind_slot", kind: "artifact-writer", description: "bind a declared part to a slot" },
  ],
};

export const SCHEMA = compilePublicArtifactSchema(
  [{ name: "assignments" }],
  [{ assignments: [{ part: "alpha", slot: "s1" }] }],
);

/** The seven files a candidate slug holds. A case names the ones it varies and the rest stay at
 *  the fixture above, so no case rebuilds the directory to change one of them. */
export interface SlugFacts {
  brief?: Brief;
  evaluator?: string;
  corpus?: ControlCorpus;
  tasks?: readonly BuildTask[];
  tools?: string;
  spec?: ToolsSpec;
}

/** Test shorthand: production consumes the WithEvidence form; these cases read findings only. */
export async function probeConformance(
  ...args: Parameters<typeof probeConformanceWithEvidence>
): Promise<Awaited<ReturnType<typeof probeConformanceWithEvidence>>["findings"]> {
  return (await probeConformanceWithEvidence(...args)).findings;
}

/** The slug writer and the conformance shorthand, both bound to one caller-owned scratch root. */
export function probeSlugs(root: string) {
  const writeSlug = (name: string, facts: SlugFacts = {}): string => {
    const dir = join(root, name);
    mkdirSync(join(dir, "correctness-model/reference"), { recursive: true });
    mkdirSync(join(dir, "agent"), { recursive: true });
    writeFileSync(join(dir, "correctness-model/reference/index.ts"), MATCHING_REFERENCE_SOURCE);
    writeFileSync(join(dir, "correctness-model/brief.json"), JSON.stringify(facts.brief ?? BRIEF));
    writeFileSync(join(dir, "correctness-model/evaluator.ts"), facts.evaluator ?? EVALUATOR_SOURCE);
    writeFileSync(join(dir, "correctness-model/controls.json"), JSON.stringify(facts.corpus ?? CORPUS));
    writeFileSync(join(dir, "correctness-model/tasks.json"), JSON.stringify(facts.tasks ?? [TASK, TASK_TWO]));
    writeFileSync(join(dir, "agent/tools.ts"), facts.tools ?? TOOLS_SOURCE);
    writeFileSync(join(dir, "agent/tools-spec.json"), JSON.stringify(facts.spec ?? SPEC));
    writeFileSync(join(dir, "agent/BUILT_AGENTS.md"), "Assign every part to one slot, then submit.\n");
    return dir;
  };
  /** Write a slug and conform it against the very spec it holds, which is what submit does. */
  const conform = async (
    name: string,
    tasks: readonly BuildTask[],
    facts: SlugFacts & { schema?: typeof SCHEMA } = {},
  ) => {
    const { schema = SCHEMA, ...slug } = facts;
    return await probeConformance(writeSlug(name, slug), slug.spec ?? SPEC, tasks, schema);
  };
  return { writeSlug, conform };
}
