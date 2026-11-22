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

A solver is pi's coding agent behind a command wall. Your harness is what you add under harness/.
The host reads three paths there and nothing else. Put reusable computation in .toolchain/ rather
than pasting code snippets into the guide: pasted code runs anonymously in traces and adds clutter
to every solve.

## What every solver receives

- One persistent working directory (its home) containing public/task.json, task files under
  public/files/, public domain rules under public/resources/, and public/answer-format.json.
- Submission via answer.json and submit: the host checks answer.json against the schema and
  refuses mismatches with the reason. An accepted submit ends the solve and returns no verdict.
- A host system prompt giving its tools, duty, time and turn limits, working directory, wall
  facts, command timeouts, and the names of installed harness programs.

## agent/tools-spec.json

\`\`\`json
${capturedJsonStringify(EXAMPLE.spec, null, 2)}
\`\`\`

- presets selects from ${CODING_TOOLS.join(", ")}. Any omitted tool is unavailable to the solver.
- tools must remain an empty list; executable capabilities belong in .toolchain/.

## .toolchain/

Executables in .toolchain/bin (and any nested bin, shims, or sbin directory) run by name in the
solver's commands, with .toolchain/bin first on PATH. The tree is read-only to the solver. Install
any interpreter, engine, or package your programs or the solver's commands need inside .toolchain/
so solves do not waste turns installing them and external exports stay self-contained without
naming host paths.

Build programs around general, high-leverage domain operations (parsing inputs, modelling or
searching candidates, and checking public rules) that work cleanly on any well-formed task input.
If practice traces show a program is rarely used or does not address a real bottleneck, simplify or
remove it instead of carrying dead tooling in PATH and the guide.

Keep every program to one predictable CLI convention:

- Verb-first lower-case name with hyphens: ${CHECKER}, simulate-mix.
- Every input passed as a relative file argument; open no unnamed files.
- Programs that compute also accept plain data (CSV or JSON of the values alone) so they work on
  ordinary domain inputs outside this host.
- Readable result lines on stdout; diagnostics on stderr.
- Exit 0 when what was tested holds, 1 when something fails, and 2 when the command could not run
  (missing file, bad arguments). Support --help (prints usage and exits 0).
- Stateless outside the solver's working directory.

Worked program at .toolchain/bin/${CHECKER} (executable):

\`\`\`js
${EXAMPLE.programs[CHECKER].trimEnd()}
\`\`\`

## agent/BUILT_AGENTS.md

The operating guide, read whole into the solver's system prompt once per task under a host line
stating that it cannot override the public task, tool authority, runtime limits, or submission
rules. Without this file the solver reads no guide.

Design the guide to sharpen how the solver works on unseen tasks:

- Start from the task itself: orient the solver to read the task's own files and public/resources/
  (never tell it to skip public documents), choose and run your programs, reason through domain
  trade-offs from first principles, and verify its finished answer independently before submitting.
- Keep it short and prune as you iterate: every paragraph sits in the system prompt of every solve.
  Accumulating long checklists or narrow recipes for individual practice families crowds out the
  solver's reading of new tasks and breaks down when an unseen task brings different inputs or
  structure. Cut stale, redundant, or unused instructions when revising.
- Let the host manage time and turn budgets: the host states the solve's limits and appends usage
  to executed tool results. Guides that create urgency or prescribe a tight turn target push
  solvers to submit under-verified answers with most of their budget still unused.

Every campaign begins from the Starter guide:

\`\`\`markdown
${STARTER.guide.trimEnd()}
\`\`\`

You may revise, replace, or remove it, including the file itself.

A kept harness is also exported and run outside this host on ordinary prompts and files, where
public/task.json, answer.json, submit, and exam scoring do not exist. Export keeps the guide up to
the heading "${HOST_ONLY.slice(3)}", where host-specific notes belong: what makes an answer valid
here and how the declared objective is measured under the public rules. A guide without that
heading is exported whole under a host disclaimer.

Worked guide with one program entry:

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
