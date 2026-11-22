/**
 * The Starter Pack: the Starter Built Harness, and the account of a harness's files that a Builder
 * is handed beside it.
 *
 * The Starter Built Harness is pi's coding agent as pi releases it, with pi's four coding tools
 * selected, no program, and the starter instructions as its guide. Its two files are there as the
 * places a Builder extends, beside the tool tree it adds. Everything else a solver is given under it is the
 * host's, the same under every harness: the command wall behind the tools, the answer file and
 * `submit`, and the prompt's addendum and environment (`run.ts`, `answer.ts`, `prompt.ts`).
 *
 * It needs nothing from the correctness model. The host seeds the solver's home with the task, the
 * public rules and the contract's answer format, and sends the submitted answer to the verifier.
 *
 * The account, `HARNESS.md`, stands where v1's starter pack carried `contract.md`. A Builder without
 * it wrote three tool files whose only purpose was to print `defineDraftTool`'s source through tool
 * names. The account is the host's and not the harness's: a session is
 * handed it afresh in its home (`src/builder/session.ts`), so it describes the host that will open
 * the harness, whichever harness the session forks.
 * It limits the reminder promise to tools that execute.
 */
import { AGENT_DIR, GUIDE_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { CODING_TOOLS } from "../tools/coding.ts";

/** The guide's last heading, for what holds only for this host's answer; an export stops at it. */
export const HOST_ONLY = "## Validity and score";

/**
 * The Starter's two files: a spec that selects pi's four coding tools, and the starter instructions
 * as its guide, in `EXAMPLE`'s outline with its entries empty. Neither has changed since a harness
 * lost its tool module, so the Starter is the harness it was (`test/starter.test.ts`).
 */
const STARTER = {
  spec: { presets: [...CODING_TOOLS], tools: [] },
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

${HOST_ONLY}
None yet.
`,
};

const CHECKER = "check-rota";

/**
 * The account's worked harness, which a test opens and runs as a solve would: an example that does
 * not open, or a program that does not run, would teach every Builder a shape the host refuses. It
 * is the Starter with one program and a guide of one entry. The program is written without a
 * template string, so that it is printed here as it is installed.
 */
export const EXAMPLE = {
  spec: STARTER.spec,
  programs: {
    [CHECKER]: `#!/usr/bin/env bun
// ${CHECKER} <rota.json> <limits.json>
// Tests a rota against each person's hour limit, one line a person. <limits.json> holds the staff
// and the shifts, alone or as a task's publicInput.
// Exit 0: every limit is met. 1: one is not. 2: it could not run.
import { readFileSync } from "node:fs";

const USAGE = "usage: ${CHECKER} <rota.json> <limits.json>  (staff and shifts, alone or as a task's publicInput)";
const [rota, limits] = process.argv.slice(2);
if (rota === "--help") {
  console.log(USAGE);
  process.exit(0);
}
if (rota === undefined || limits === undefined) {
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

const given = read(limits);
const { staff, shifts } = given.publicInput ?? given;
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
- ${CHECKER} <rota.json> <limits.json>: tests a rota file against each person's hour limit and prints
  one line a person; public/task.json serves as the second file. Exit 0 when every limit is met, 1
  when one is not, 2 when it could not run. It tests the hour limits and no other rule.

## Working with them
A rota that ${CHECKER} passes has still to meet the rules it does not test.

## Domain notes
Hours count by the shift's length in the task, not by its clock times.

${HOST_ONLY}
A rota that leaves a shift of the task unassigned is not valid.
`,
};

/**
 * What a Builder reads of the harness's files, as `HARNESS.md` in its home.
 */
export const HARNESS_ACCOUNT = `# The Built Harness

A solver is pi's coding agent behind a command wall. A harness is what you add to it. The host
reads three things under harness/ and nothing else there, and a section below gives the shape of
each. Code in the guide for the solver to paste is no program: a trace then shows the pasted
code and no name.

## What every solver has, whatever the harness

- One working directory, its home, kept for the whole task. It holds the task as public/task.json,
  each file the task's public input lists under files as that file under public/files/, the
  domain's public rules as files under public/resources/, and the answer's format as
  public/answer-format.json.
- The answer as a file: the solver writes answer.json in its working directory, and submit sends
  it. The host checks the file against the answer format and refuses one that does not follow it,
  with the reason. An accepted submit ends the task and returns no verdict.
- A system prompt in pi's own sections: the tool list and the tools' rules, the duty and the solve
  time, the working directory, and the wall's facts: what a command may write and reach, the size of
  the volume, the command time limits, and the programs you installed, by name.

## agent/tools-spec.json

\`\`\`json
${capturedJsonStringify(EXAMPLE.spec, null, 2)}
\`\`\`

- presets selects pi's coding tools: any of ${CODING_TOOLS.join(", ")}. A solver does not have one you leave out.
- tools is an empty list. The host refuses a harness that lists a tool there: what a harness
  computes is a program.

## .toolchain/

Programs for the solver. Every executable in .toolchain/bin, and in a bin, shims or sbin directory
below it, runs by name in the solver's commands, with .toolchain/bin first on PATH. The tree is
read-only to the solver. What you install for a program to use, an engine or a package, goes in
the tree too. So does a package the solver's own commands import: its python3 is this machine's
unless the tree holds one, and a package that interpreter lacks costs each solve a command to
install before its first use. Outside this host only the tree goes with the harness: an
interpreter or a package the tree names by a path on this machine is not there.

A program of your own keeps to one convention, so that a solver meets the same thing under every
harness:

- Its name says what it does, verb first, in lower case with hyphens: ${CHECKER}, simulate-mix.
- It takes every input as a file named in its arguments, by a path relative to the solver's
  working directory, and opens no file it was not named.
- One that computes also takes what it computes on in a plain form, a CSV file or JSON of the
  values alone, so that it runs on any data of that kind, a task's or not.
- It prints its result to standard output, in lines a solver can read, and what went wrong to
  standard error.
- It exits 0 when it ran and what it tested holds, 1 when it ran and something does not hold, and
  2 when it could not run: a missing file, a bad argument. With --help it prints its usage and
  exits 0.
- It keeps nothing between runs outside the solver's working directory.

.toolchain/bin/${CHECKER}, made executable:

\`\`\`js
${EXAMPLE.programs[CHECKER].trimEnd()}
\`\`\`

## agent/BUILT_AGENTS.md

The operating guide, in words. The solver reads it whole in its system prompt, once per task, as
its project's instructions, under one sentence saying that it cannot override the public task,
tool authority, runtime limits or submission rules. Without the file the solver reads no guide.

Every campaign's first harness, the Starter, carries the starter instructions as this file:

\`\`\`markdown
${STARTER.guide.trimEnd()}
\`\`\`

They are yours to revise, replace or remove, the file included.

A kept harness is also written out and run outside this host, on work that comes as a prompt and
ordinary files: no public/task.json, answer.json or submit is there, and no check or score of this
exam. The guide goes with it as far as the heading "${HOST_ONLY.slice(3)}", under which belongs what
holds only here: what makes an answer to these tasks valid, and what the objective rewards. A guide
without that heading goes whole, under a line that says such things do not hold there.

The host tells the solver its limits and appends how much of them is used to results of tools
that execute. Solvers told in their guide that time was short have submitted answers their own check refused, with most of their time
left. An example guide, with one entry for a program:

\`\`\`markdown
${EXAMPLE.guide.trimEnd()}
\`\`\`
`;

/** Write the Starter Built Harness into `dir`, which is made if it is not there. */
export function writeStarter(dir: string): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(STARTER.spec, null, 2)}\n`);
  writeFileSync(join(dir, AGENT_DIR, GUIDE_FILE), STARTER.guide);
}
