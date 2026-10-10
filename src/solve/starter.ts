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
import { AGENT_DIR, GENERATED_TOOLS_FILE, GUIDE_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { JsonObject } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { CODING_TOOLS } from "./coding-tools.ts";

/**
 * The Starter's two files. Its tools file is the place a harness without the shell adds tools, and
 * says so; under the Starter it adds none. A comment is not in the bundle a harness is named by, so
 * the Starter is the harness it was before the comment was there.
 */
const STARTER = {
  spec: { presets: [...CODING_TOOLS], tools: [] },
  tools: `// Tools of the harness's own, for a harness that leaves the shell out of its presets. While the
// solver has the shell this list stays empty: what the harness computes is a program under
// .toolchain/bin. HARNESS.md, beside harness/, gives both shapes.
import type { DomainHarnessFactory } from "@ana/agent-bundle";

export const createDomainHarness: DomainHarnessFactory = () => ({
  tools: [],
});
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

## Programs
- ${CHECKER} <rota.json>: tests a rota file against each person's hour limit in public/task.json and
  prints one line a person. Exit 0 when every limit is met, 1 when one is not, 2 when it could not
  run. It tests the hour limits and no other rule.

## Working with them
A rota that ${CHECKER} passes has still to meet the rules it does not test.

## Domain notes
Hours count by the shift's length in the task, not by its clock times.
`,
};

/**
 * The account's second example: a harness that leaves the shell out, which is where a tool of the
 * harness's own has a purpose. A test opens it and calls its tool under the wall.
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
 * It gives each part of a harness one purpose. The first truss session shipped its checker three
 * times over: a command-line program, a tool that wrapped it, and a guide that described both; the
 * first buffer session kept its optimiser as a snippet in the guide, which each solver pasted and
 * ran (2026-10-09). Two harnesses built so cannot be read against each other, and a trace shows two
 * ways into one computation. So a computation is a program, the guide is words about the programs,
 * and a tool of the harness's own is for the one case a program cannot serve: a solver without the
 * shell.
 */
export const HARNESS_ACCOUNT = `# The Built Harness

A solver is pi's coding agent behind a command wall. A harness is what you add to it. The host
reads four things under harness/ and nothing else there, and each has one purpose:

| Part | Its one purpose |
|---|---|
| agent/tools-spec.json | Which of pi's coding tools the solver has. |
| .toolchain/ | Every computation the harness adds, as programs the solver runs by name. |
| agent/BUILT_AGENTS.md | Words: what each program is for and how its result is read. |
| agent/tools.ts | Tools of the harness's own, for a harness that leaves the shell out. Empty otherwise. |

Put a computation in one place. While the solver has the shell, that place is a program. A tool
that runs what a program does, or a guide that carries code for the solver to paste, is the same
thing built a second time: the solver then has two ways into it, and a trace no longer shows by
name what was run. check_harness opens the four parts as a solve would, and preview_harness shows
what the solver then reads.

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
or submission rules. Without the file the solver reads no guide, and the harness you start from may
have none. It is words: code the solver would copy out and run is a program. It says nothing of
time or turns: the host tells the solver its limits, and every tool result ends with how much of
them is used. Keep to this outline, with one entry a program, so that one harness's guide can be
read against another's:

\`\`\`markdown
${EXAMPLE.guide.trimEnd()}
\`\`\`

## agent/tools.ts, for a harness without the shell

A harness may leave bash out of its presets, to hold the solver to what the harness gives it. The
solver can then run no program, and tools of the harness's own are how it computes. This is the
one case for them. Such a harness's tools-spec.json and tools.ts:

\`\`\`json
${capturedJsonStringify(WITHOUT_SHELL.spec, null, 2)}
\`\`\`

\`\`\`ts
${WITHOUT_SHELL.tools.trimEnd()}
\`\`\`

- tools-spec.json has one row for each tool tools.ts returns, under the same name and in the same
  order. kind is reader or advisor: a reader returns what the task publishes, an advisor computes
  on what the solver passes it.
- createDomainHarness receives the task's public part, { taskId, family, publicInput }, and returns
  { tools }, each built with defineDraftTool.
- It may import defineDraftTool and the DomainHarnessFactory type from "@ana/agent-bundle", Type
  from "@earendil-works/pi-ai", files under harness/ and packages installed under harness/. An
  import of anything else is refused.
- run(params) returns { text, details? }. text is all the solver reads, at most 64 KB. details
  reaches the trace only. The solver's arguments are checked against parameters before run is called.
- Every call runs alone: a fresh process behind the solver's own command wall, held to a command's
  default time limit, with .toolchain/bin first on PATH. Nothing is kept between calls, neither
  module state nor a file beside the module, and run's second argument is not available. What must
  last is passed as arguments or kept as files in the solver's working directory.
- A name holds at most 128 characters, a label 256 and a description 4,000. No tool takes the name
  of one of the host's: ${CODING_TOOLS.join(", ")} or submit.
`;

/** A harness as this module writes one out. */
interface Written {
  readonly spec: { readonly presets: readonly string[]; readonly tools: readonly JsonObject[] };
  readonly tools: string;
  readonly guide?: string;
  readonly programs?: Readonly<Record<string, string>>;
}

/** Write the Starter Built Harness into `dir`, which is made if it is not there. */
export function writeStarter(dir: string): void {
  writeHarness(dir, STARTER);
}

/** A harness's files, as the host reads them: the two it requires, and a guide and programs where
 *  the harness has them. */
export function writeHarness(dir: string, harness: Written): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(harness.spec, null, 2)}\n`);
  writeFileSync(join(dir, GENERATED_TOOLS_FILE), harness.tools);
  if (harness.guide !== undefined) writeFileSync(join(dir, AGENT_DIR, GUIDE_FILE), harness.guide);
  const bin = join(dir, ".toolchain", "bin");
  for (const [name, source] of Object.entries(harness.programs ?? {})) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, name), source, { mode: 0o755 });
  }
}
