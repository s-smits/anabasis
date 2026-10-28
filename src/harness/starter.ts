/**
 * The Starter Pack: the Starter Built Harness, and the account of a harness's files that a Builder
 * is handed beside it.
 *
 * The Starter Built Harness is pi's coding agent as pi releases it, with pi's four coding tools
 * selected, no domain program or tool, and the starter instructions as its guide. Its three files
 * are there as the places a Builder extends. Everything else a solver is given under it is the
 * host's, the same under every harness: the command wall behind the tools, the answer file and
 * `submit`, and the prompt's addendum and environment (`run.ts`, `answer.ts`, `prompt.ts`).
 *
 * Every campaign starts from it (`7f0add79:docs/plan.md`, Terms and Phase 0). The Builder forks it in its
 * first session, since a session copies the harness it starts from whole. It is the first
 * reference harness: a new harness is compared with it until a step is promoted. It still runs in starter comparisons
 * after that: once another harness is promoted, the tasks written for it are read by the
 * starter against it (`src/campaign/decide.ts`). How the starter does by
 * itself, read from the first comparison, is what says whether the tasks leave a harness room to
 * add anything.
 *
 * It needs nothing from the correctness model. The host seeds the solver's home with the task, the
 * public rules and the contract's answer format, and sends the submitted answer to the verifier.
 *
 * The starter instructions (`STARTER.guide`) replace the empty guide of 9 October to 27 October. On
 * 27 October 38 of the 43 guides promoted across the recorded campaigns copied `EXAMPLE`'s outline
 * exactly, so the outline was taught, while the general lines that recurred across domains (what a
 * check establishes, a run that could not run against one that found a fault) were each written
 * afresh, and two campaigns' guides told the solver it need not read the public rules. Systems that
 * evolve a harness from a seed start it with an instruction file of roughly 10 to 200 words
 * (Meta-Harness, Harness², DGM), and in AHE's ablation the evolved prompt alone scored below its
 * seed while the whole evolved harness scored above it. So the starter's guide is short, holds only
 * what is true in every domain, and is the Builder's to revise, replace or remove on the evidence
 * of its practice.
 *
 * It is written out in v1's on-disk format like any other harness state, and is named by its digest
 * like any other: the three files below are the whole of it, so a change to any is another harness,
 * and solves under the old one are not counted for the new.
 *
 * The account, `HARNESS.md`, stands where v1's starter pack carried `contract.md`. A Builder without
 * it wrote three tool files whose only purpose was to print `defineDraftTool`'s source through tool
 * names (9 October). The account is the host's and not the harness's: a session is
 * handed it afresh in its home (`src/builder/session.ts`), so it describes the host that will open
 * the harness, whichever harness the session forks.
 * It distinguishes the temporary working directory of each custom tool call from the solver's
 * persistent home, and limits the reminder promise to tools that execute.
 */
import { AGENT_DIR, GENERATED_TOOLS_FILE, GUIDE_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { CODING_TOOLS } from "../tools/coding.ts";

/**
 * The Starter's three files. Its tools file is the place a harness adds tools of its own, and says
 * so; under the Starter it adds none. A comment is not in the bundle a harness is named by, so a
 * change to the comment leaves the Starter the harness it was. Its guide is the starter
 * instructions, in `EXAMPLE`'s outline with its entries empty.
 */
const STARTER = {
  spec: { presets: [...CODING_TOOLS], tools: [] },
  tools: `// Tools of the harness's own, which the solver has beside pi's coding tools. The Starter adds
// none. A harness adds one with defineDraftTool, and HARNESS.md, beside harness/, gives the shape
// and what a tool costs a solve against a program under .toolchain/bin.
import type { DomainHarnessFactory } from "@ana/agent-bundle";

export const createDomainHarness: DomainHarnessFactory = () => ({
  tools: [],
});
`,
  guide: `# Operating Guide

These are the starter instructions, the same in every domain.

## Programs and tools
None yet.

## Working with them
- A check you run shows only what it tests: the published requirements it does not cover are
  still open.
- A command that could not run has found no requirement broken: its exit code and its error say
  which happened.

## Domain notes
None yet.
`,
};

const CHECKER = "check-rota";
const ADVISOR = {
  name: "count_hours",
  description: "Returns the hours each person works under the assignments passed in.",
};

/**
 * The account's worked harness, which a test opens and runs as a solve would: an example that does
 * not open, or a program that does not run, would teach every Builder a shape the host refuses. It
 * is the Starter with one program and a guide of one entry. The program is written without a
 * template string, so that it is printed here as it is installed.
 */
export const EXAMPLE = {
  spec: STARTER.spec,
  tools: STARTER.tools,
  programs: {
    [CHECKER]: `#!/usr/bin/env bun
// ${CHECKER} <rota.json> [task.json]
// Tests a rota against each person's hour limit, one line a person.
// Exit 0: every limit is met. 1: one is not. 2: it could not run.
import { readFileSync } from "node:fs";

const USAGE = "usage: ${CHECKER} <rota.json> [task.json]  (the task is public/task.json unless named)";
const [rota, task = "public/task.json"] = process.argv.slice(2);
if (rota === "--help") {
  console.log(USAGE);
  process.exit(0);
}
if (rota === undefined) {
  console.error(USAGE);
  process.exit(2);
}

function read(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error("${CHECKER}: cannot read " + file + ": " + error.message);
    process.exit(2);
  }
}

const { staff, shifts } = read(task).publicInput;
const hours = {};
for (const { staff: person, shift } of read(rota).assignments) {
  hours[person] = (hours[person] ?? 0) + (shifts.find(({ id }) => id === shift)?.hours ?? 0);
}
let failed = 0;
for (const { id, maxHours } of staff) {
  const over = (hours[id] ?? 0) - maxHours;
  if (over > 0) failed += 1;
  const state = over > 0 ? "over by " + over : "ok";
  console.log(id + ": " + (hours[id] ?? 0) + " of " + maxHours + " hours, " + state);
}
process.exit(failed === 0 ? 0 : 1);
`,
  },
  guide: `# Operating Guide

## Programs and tools
- ${CHECKER} <rota.json>: tests a rota file against each person's hour limit in public/task.json and
  prints one line a person. Exit 0 when every limit is met, 1 when one is not, 2 when it could not
  run. It tests the hour limits and no other rule.
- ${ADVISOR.name} (a tool, where the harness declares one): ${ADVISOR.description}

## Working with them
A rota that ${CHECKER} passes has still to meet the rules it does not test.

## Domain notes
Hours count by the shift's length in the task, not by its clock times.
`,
};

/**
 * The account's second example: a harness with one tool of its own, shown without the shell so that
 * the tool is the solver's one way to the computation. A test opens it and calls its tool under
 * the wall.
 */
export const WITHOUT_SHELL = {
  spec: {
    presets: CODING_TOOLS.filter((name) => name !== "bash"),
    tools: [{ ...ADVISOR, kind: "advisor" }],
  },
  tools: `import { type DomainHarnessFactory, defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

type Shift = { id: string; hours: number };

export const createDomainHarness: DomainHarnessFactory = (task) => {
  const input = task.publicInput as { shifts: Shift[] };
  return {
    tools: [
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

/**
 * What a Builder reads of the harness's files, as `HARNESS.md` in its home.
 *
 * It gives each part of a harness one purpose. On 9 October one Builder shipped its checker three
 * times over: a command-line program, a tool that wrapped it, and a guide that described both;
 * another kept its optimiser as a snippet in the guide, which each solver pasted and ran. The
 * account states what each route costs a solve and leaves the choice to the Builder: a rule that a
 * computation is a program was a second limit on the Builder in a prompt (`AGENTS.md`, section 2),
 * and in the ten campaigns run under it no harness declared a tool. The guide stays words, since
 * pasted code shows in a trace under no name.
 */
export const HARNESS_ACCOUNT = `# The Built Harness

A solver is pi's coding agent behind a command wall. A harness is what you add to it. The host
reads four things under harness/ and nothing else there, and each has one purpose:

| Part | Its one purpose |
|---|---|
| agent/tools-spec.json | Which of pi's coding tools the solver has. |
| .toolchain/ | Programs, which the solver runs by name from its shell. |
| agent/BUILT_AGENTS.md | Words: what each program and tool is for and how its result is read. |
| agent/tools.ts | Tools of the harness's own, which the solver has beside pi's tools. |

A computation reaches the solver as a program it runs from its shell, as a tool of the harness's
own, or as both. Which, and how many, is yours to choose; the section on agent/tools.ts says what
each costs a solve. Code in the guide for the solver to paste is neither: a trace then shows the
pasted code and no name. check_harness opens the four parts as a solve would, and preview_harness
shows what the solver then reads, its tools among it.

## What every solver has, whatever the harness

- One working directory, its home, kept for the whole task. It holds the task as public/task.json,
  the domain's public rules as files under public/resources/, and the answer's format as
  public/answer-format.json.
- pi's coding tools, as many as the harness selects: read, bash, edit, write.
- The answer as a file: the solver writes answer.json in its working directory, and submit sends
  it. The host checks the file against the answer format and refuses one that does not follow it,
  with the reason. An accepted submit ends the task and returns no verdict. Nothing of the
  harness's takes the answer.
- A system prompt in pi's own sections: the tool list and the tools' rules, the duty and the solve
  time, the working directory, and the wall's facts: what a command may write and reach, the size of
  the volume, the command time limits, and the programs you installed, by name.

## agent/tools-spec.json

\`\`\`json
${capturedJsonStringify(EXAMPLE.spec, null, 2)}
\`\`\`

- presets selects pi's coding tools: any of ${CODING_TOOLS.join(", ")}. A solver does not have one you leave out.
- tools lists the tools agent/tools.ts returns, and is empty while that file's list is.

## .toolchain/

Programs for the solver. Every executable in .toolchain/bin, and in a bin, shims or sbin directory
below it, runs by name in the solver's commands, with .toolchain/bin first on PATH. The solver's
prompt lists the names. The tree is read-only to the solver. What you install for a program to use,
an engine or a package, goes in the tree too.

A program of your own keeps to one convention, so that a solver meets the same thing under every
harness:

- Its name says what it does, verb first, in lower case with hyphens: ${CHECKER}, simulate-mix.
- It takes its input as files named in its arguments, by paths relative to the solver's working
  directory, and reads the task from public/task.json unless another file is named.
- It prints its result to standard output, in lines a solver can read, and what went wrong to
  standard error.
- It exits 0 when it ran and what it tested holds, 1 when it ran and something does not hold, and
  2 when it could not run: a missing file, a bad argument. With --help it prints its usage and
  exits 0.
- It finds its own files from its own path, since the harness runs from another place than your
  home, and keeps nothing between runs outside the solver's working directory.

.toolchain/bin/${CHECKER}, made executable:

\`\`\`js
${EXAMPLE.programs[CHECKER].trimEnd()}
\`\`\`

## agent/BUILT_AGENTS.md

The operating guide. The solver reads it whole in its system prompt, as its project's instructions,
under one sentence saying that it cannot override the public task, tool authority, runtime limits
or submission rules. Without the file the solver reads no guide.

Every campaign's first harness, the Starter, carries the starter instructions as this file:

\`\`\`markdown
${STARTER.guide.trimEnd()}
\`\`\`

They are yours to revise, replace or remove, the file included.

It is words: code the solver would copy out and run is a program. It says nothing of
time or turns: the host tells the solver its limits and appends how much of them is used to results
of tools that execute; argument refusals and unavailable tools carry no reminder. Keep to this
outline, with one entry a program or a tool, so that one harness's
guide can be read against another's:

\`\`\`markdown
${EXAMPLE.guide.trimEnd()}
\`\`\`

## agent/tools.ts

Tools of the harness's own stand beside pi's tools in the solver's list, each under its own name
with the description and the parameter schema you declare. The solver reads them in every turn, as
it reads the guide, and calls one as it calls read or bash. A harness may also leave bash out of
its presets, and the solver then computes through these tools alone. A harness with one tool,
shown without the shell; its tools-spec.json and tools.ts:

\`\`\`json
${capturedJsonStringify(WITHOUT_SHELL.spec, null, 2)}
\`\`\`

\`\`\`ts
${WITHOUT_SHELL.tools.trimEnd()}
\`\`\`

- tools-spec.json has one row for each tool tools.ts returns, under the same name; the order may
  differ. kind is reader or advisor: a reader returns what the task publishes, an advisor computes
  on what the solver passes it.
- createDomainHarness receives the task's public part, { taskId, family, publicInput }, and returns
  { tools }, each built with defineDraftTool.
- It may import defineDraftTool and the DomainHarnessFactory type from "@ana/agent-bundle", Type
  from "@earendil-works/pi-ai", files under harness/ and packages installed under harness/. An
  import of anything else is refused.
- run(params) returns { text, details? }. text is all the solver reads, at most 64 KB. details
  reaches the trace only. The solver's arguments are checked against parameters before run is called.
- Every call runs alone: a fresh process behind the solver's own command wall, held to a command's
  default time limit, with .toolchain/bin first on PATH. Its working directory is a temporary
  directory, not the solver's home. Nothing is kept between calls, neither module state nor a file
  beside the module, and run's second argument is not available. What must last is passed as
  arguments or kept as files using the absolute path to the solver's home, available as HOME.
- A name holds at most 128 characters, a label 256 and a description 4,000. No tool takes the name
  of one of the host's: ${CODING_TOOLS.join(", ")} or submit.

What each route costs a solve, in the tokens the solver reads and writes. A tool's name,
description and schema are in the solver's context on every turn, and a call to it is the
arguments the schema names; what comes back is its text. A program is its name in the prompt and
the guide's line on it, and a call to it is the command the solver types; what comes back is the
command's output, whole unless the command cuts it. A trace names a tool by its name and a program
by its command, and practice reports what each solve read and wrote.
`;

/** Write the Starter Built Harness into `dir`, which is made if it is not there. */
export function writeStarter(dir: string): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(STARTER.spec, null, 2)}\n`);
  writeFileSync(join(dir, GENERATED_TOOLS_FILE), STARTER.tools);
  writeFileSync(join(dir, AGENT_DIR, GUIDE_FILE), STARTER.guide);
}
