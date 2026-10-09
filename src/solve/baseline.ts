/**
 * The minimal baseline: a harness with a shell and the tool that writes the answer, no guide and
 * no domain tool.
 *
 * The plan's first harness has no parent to be compared with, and every later one needs a fixed
 * reference that no screening chose (`docs/plan.md`, Phase 2). The solver with nothing built for it
 * is that reference: the opponent of the first harness, and beside its parent the second opponent
 * of every later one. A solve cannot run with no harness at all, since a harness without an answer
 * writer does not open (`harness.ts`), so the baseline is the least one that does.
 *
 * It is written out in v1's on-disk format like any other harness state, and is named by its digest
 * like any other: the two texts below are the whole of it, so a change to either is another
 * harness, and solves under the old one are not counted for the new.
 */
import { AGENT_DIR, GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";

/** The writer's name and what a solver reads of it. Its parameters are replaced by the contract's
 *  answer format and its own code never runs (`answer.ts`, `recordTool`). */
const WRITER = {
  name: "record_answer",
  description: "Prepare your answer in the domain's answer format. Submit sends the answer last prepared.",
};

const SPEC = { presets: ["shell"], tools: [{ ...WRITER, kind: "artifact-writer" }] };

const TOOLS = `import { type DomainHarnessFactory, defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

export const createDomainHarness: DomainHarnessFactory = () => ({
  tools: [
    defineDraftTool({
      name: ${capturedJsonStringify(WRITER.name)},
      label: "Record answer",
      description: ${capturedJsonStringify(WRITER.description)},
      executionMode: "sequential",
      parameters: Type.Object({}),
      run: () => ({ text: "recorded" }),
    }),
  ],
});
`;

/** Write the baseline harness into `dir`, which is made if it is not there. */
export function writeBaseline(dir: string): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(SPEC, null, 2)}\n`);
  writeFileSync(join(dir, GENERATED_TOOLS_FILE), TOOLS);
}
