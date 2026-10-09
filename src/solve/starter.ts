/**
 * The Starter Pack: the Starter Built Harness, and the account of a harness's files that a Builder
 * is handed beside it.
 *
 * The Starter Built Harness is pi's coding agent as pi releases it and nothing more: pi's four
 * coding tools selected, no guide and no domain tool. It is the empty harness, and its two files
 * are there as the places a Builder extends. Everything else a solver is given under it is the
 * host's, the same under every harness: the command wall behind the tools, the answer file and
 * `submit`, and the prompt's addendum and environment (`run.ts`, `answer.ts`, `prompt.ts`).
 *
 * Every campaign starts from it (`docs/plan.md`, Terms and Phase 0). The Builder forks it in its
 * first session, since a session copies the harness it starts from whole. It is the first
 * reference harness: a new harness is compared with it until a step is promoted. And it stays the
 * fixed lower reference after that: a step against a promoted reference also needs at least as
 * many wins as losses against the starter (`src/builder/round.ts`). How the starter does by
 * itself, read from the first comparison at several budgets, is what says whether the tasks leave
 * a harness room to add anything.
 *
 * It needs nothing from the correctness model. The host seeds the solver's home with the task, the
 * public rules and the contract's answer format, and sends the submitted answer to the verifier.
 *
 * It is written out in v1's on-disk format like any other harness state, and is named by its digest
 * like any other: the two files below are the whole of it, so a change to either is another
 * harness, and solves under the old one are not counted for the new. Until 2026-10-09 it selected
 * the shell alone and declared one tool, an artifact-writer that took the answer as its arguments,
 * and v1's draft tools stood beside it (`answer.ts`).
 *
 * The account, `HARNESS.md`, is what v1's starter pack carried as `contract.md` and v2 left out. A
 * Builder then had the starter's one tool as its whole account of the tool interface: the first
 * buffer session wrote three tool files whose only purpose was to print `defineDraftTool`'s source
 * through tool names (2026-10-09). The account is the host's and not the harness's: a session is
 * handed it afresh in its home (`src/builder/session.ts`), so it describes the host that will open
 * the harness, whichever harness the session forks.
 */
import { AGENT_DIR, GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { CODING_TOOLS } from "./coding-tools.ts";

const STARTER = {
  spec: { presets: [...CODING_TOOLS], tools: [] },
  tools: `import type { DomainHarnessFactory } from "@ana/agent-bundle";

export const createDomainHarness: DomainHarnessFactory = () => ({
  tools: [],
});
`,
};

const READER = {
  name: "list_staff",
  description: "Lists this task's staff with their contract hours, and its shifts with their times.",
};
const ADVISOR = {
  name: "count_hours",
  description: "Returns the hours each person works under the assignments passed in.",
};

/** The account's worked harness, which a test opens as a solve would: an example that does not
 *  open would teach every Builder a shape the host refuses. */
export const EXAMPLE = {
  spec: {
    presets: [...CODING_TOOLS],
    tools: [
      { ...READER, kind: "reader" },
      { ...ADVISOR, kind: "advisor" },
    ],
  },
  tools: `import { type DomainHarnessFactory, defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

type Shift = { id: string; hours: number };

export const createDomainHarness: DomainHarnessFactory = (task) => {
  const input = task.publicInput as { staff: unknown[]; shifts: Shift[] };
  return {
    tools: [
      defineDraftTool({
        name: ${capturedJsonStringify(READER.name)},
        label: "List staff",
        description: ${capturedJsonStringify(READER.description)},
        parameters: Type.Object({}),
        run: () => ({ text: JSON.stringify(input) }),
      }),
      defineDraftTool({
        name: ${capturedJsonStringify(ADVISOR.name)},
        label: "Count hours",
        description: ${capturedJsonStringify(ADVISOR.description)},
        parameters: Type.Object({
          assignments: Type.Array(Type.Object({ staff: Type.String(), shift: Type.String() })),
        }),
        run: ({ assignments }) => {
          const hours: Record<string, number> = {};
          for (const { staff, shift } of assignments) {
            hours[staff] = (hours[staff] ?? 0) + (input.shifts.find(({ id }) => id === shift)?.hours ?? 0);
          }
          return { text: JSON.stringify(hours) };
        },
      }),
    ],
  };
};
`,
};

/** What a Builder reads of the harness's files, as `HARNESS.md` in its home. */
export const HARNESS_ACCOUNT = `# The Built Harness

A solver is pi's coding agent behind a command wall. A harness is what you add to it. The host
reads four things under harness/ and nothing else there: agent/tools-spec.json, agent/tools.ts,
agent/BUILT_AGENTS.md and .toolchain/. check_harness opens them as a solve would.

## What every solver has, whatever the harness

- One working directory, its home, kept for the whole task. It holds the task as public/task.json,
  the domain's public rules as files under public/resources/, and the answer's format as
  public/answer-format.json.
- pi's coding tools, as many as the harness selects: read, bash, edit, write.
- The answer as a file: the solver writes answer.json in its working directory, and submit sends
  it. The host checks the file against the answer format and refuses one that does not follow it,
  with the reason. An accepted submit ends the task and returns no verdict. No harness tool takes
  the answer.
- A system prompt in pi's own sections: the tool list and the tools' rules, the duty and the solve
  time, the working directory, and the wall's facts: what a command may write and reach, the size of
  the volume, the command time limits, and the programs you installed, by name.

## agent/tools-spec.json

\`\`\`json
${capturedJsonStringify(EXAMPLE.spec, null, 2)}
\`\`\`

- presets selects pi's coding tools: any of ${CODING_TOOLS.join(", ")}. A solver does not have one you leave out.
- tools has one row for each tool agent/tools.ts returns, under the same name.
- kind is reader or advisor, and says what a tool is for: a reader returns what the task publishes,
  an advisor computes on what the solver passes it. tools may be empty.

## agent/tools.ts

\`\`\`ts
${EXAMPLE.tools.trimEnd()}
\`\`\`

- createDomainHarness receives the task's public part, { taskId, family, publicInput }, and returns
  { tools }, each built with defineDraftTool. The names must be exactly those tools-spec.json lists.
- It may import defineDraftTool and the DomainHarnessFactory type from "@ana/agent-bundle", Type from
  "@earendil-works/pi-ai", files under harness/ and packages installed under harness/. An import of
  anything else is refused.
- run(params) returns { text, details? }. text is all the solver reads, at most 64 KB. details
  reaches the trace only. The solver's arguments are checked against parameters before run is called.
- Every call runs alone: a fresh process behind the solver's own command wall, held to a command's
  default time limit. Nothing is kept between calls, neither module state nor a file beside the
  module, and run's second argument is not available. What must last is passed as arguments or kept
  as files in the solver's home, which process.env.HOME names.
- A tool may run an installed program by name, as a command would: .toolchain/bin is first on PATH.
- A name holds at most 128 characters, a label 256 and a description 4,000. No tool takes the name
  of one of the host's: ${CODING_TOOLS.join(", ")} or submit.

## agent/BUILT_AGENTS.md

The operating guide. The solver reads it whole in its system prompt, as its project's instructions,
under one sentence saying that it cannot override the public task, tool authority, runtime limits
or submission rules. Without the file the solver reads no guide.

## .toolchain/

Programs for the solver. Every executable in .toolchain/bin, and in a bin, shims or sbin directory
below it, runs by name in the solver's commands and in your tools, with .toolchain/bin first on
PATH. The solver's prompt lists the names. The tree is read-only to the solver.
`;

/** Write the Starter Built Harness into `dir`, which is made if it is not there. */
export function writeStarter(dir: string): void {
  writeHarness(dir, STARTER);
}

/** A harness's two required files, as the host reads them. */
export function writeHarness(dir: string, harness: typeof STARTER | typeof EXAMPLE): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(harness.spec, null, 2)}\n`);
  writeFileSync(join(dir, GENERATED_TOOLS_FILE), harness.tools);
}
