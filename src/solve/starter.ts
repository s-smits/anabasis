/**
 * The Starter Built Harness: Pi with a shell and the tool that writes an answer, and no guide or
 * domain tool yet.
 *
 * Every campaign starts from it (`docs/plan.md`, Terms and Phase 0). The Builder forks it in its
 * first session, since a session copies the harness it starts from whole. It is the first
 * reference harness: a new harness is compared with it until a step is promoted. And it stays the
 * fixed lower reference after that: a step against a promoted reference also needs at least as
 * many wins as losses against the starter (`src/builder/round.ts`). How the starter does by
 * itself, read from the first comparison at several budgets, is what says whether the tasks leave
 * a harness room to add anything.
 *
 * It needs nothing from the correctness model. The host gives its answer writer the contract's
 * answer format, shows the solver the public rules, and sends the submitted answer to the
 * verifier. A solve cannot run with no harness at all, since a harness without an answer writer
 * does not open (`harness.ts`), so the starter is the least one that does. v1's own starter is not
 * used: it was a template for a Builder that also wrote the exam.
 *
 * It is written out in v1's on-disk format like any other harness state, and is named by its digest
 * like any other: the two texts below are the whole of it, so a change to either is another
 * harness, and solves under the old one are not counted for the new. Until 2026-10-09 it was
 * called the minimal baseline, and a campaign started from the stored v1 harness.
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

/** Write the Starter Built Harness into `dir`, which is made if it is not there. */
export function writeStarter(dir: string): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(SPEC, null, 2)}\n`);
  writeFileSync(join(dir, GENERATED_TOOLS_FILE), TOOLS);
}
