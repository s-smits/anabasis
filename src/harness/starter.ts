import { AGENT_DIR, GUIDE_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { CODING_TOOLS } from "../tools/coding.ts";

export const HOST_ONLY = "## Validity and score";
const HOST_ONLY_LINE = /(?:^|\r?\n)#{1,6}[ \t]+Validity and score[ \t]*(?:#+[ \t]*)?(?=\r?\n|$)/iu;

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
  one line a person. Exit 0 when every limit is met, 1 when one is not, 2 when it could not run. It
  tests the hour limits and no other rule.

## Working with them
A rota that ${CHECKER} passes has still to meet the rules it does not test.

## Domain notes
Hours count by the shift's length in the task, not by its clock times.

${HOST_ONLY}
- Pass public/task.json as <limits.json> to ${CHECKER}.
- A rota that leaves a shift of the task unassigned is not valid.
`,
};

export const HARNESS_ACCOUNT = `# The Built Harness

A solver is pi's coding agent behind a command wall. Your harness is what you add under harness/.
The host reads three paths there and nothing else. Reusable computation belongs in .toolchain/
rather than pasted into the guide, where snippets run anonymously in traces and add clutter to every
solve.

## What every solver receives

- One persistent working directory (its home) containing public/task.json, task files listed in
  publicInput.files under public/files/, public domain rules under public/resources/, and
  public/answer-format.json.
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
solver's commands, with .toolchain/bin first on PATH. The tree is read-only to the solver. Installing
any interpreter, engine, or package your programs or the solver's commands need inside .toolchain/
avoids per-solve installs and keeps external exports self-contained without naming host paths.

General, high-leverage domain operations (parsing inputs, modelling or searching candidates, and
independent checking) transfer cleanly across unseen tasks when they operate on plain data files.
Practice traces show which programs are used and which sit idle in PATH and the guide.

Predictable CLI conventions:

- Verb-first lower-case name with hyphens: ${CHECKER}, simulate-mix.
- Every input passed as a relative file argument; open no unnamed files.
- Programs that compute accept plain data (CSV or JSON of the values alone) so they work on
  ordinary domain workspaces outside this host as well as campaign tasks.
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

Every campaign begins from the Starter guide:

\`\`\`markdown
${STARTER.guide.trimEnd()}
\`\`\`

You may revise, replace, or remove it, including the file itself.

- Exported guide: kept harnesses are exported and run outside this host on ordinary domain
  workspaces where public/task.json, public/files/, public/resources/, answer.json, submit, exam
  rule IDs, and campaign scoring do not exist. Export keeps the guide up to the heading
  "${HOST_ONLY}" and strips everything below it (a guide without that heading is exported whole
  under a host disclaimer). Sections above "${HOST_ONLY}" — Programs and tools, Working with them,
  and Domain notes — therefore apply to general workspaces and ordinary files: how to use your
  programs, reason from first principles, and verify work independently.
- Under "${HOST_ONLY}": campaign-specific workflow belongs strictly under this
  heading — reading public/task.json, public/files/, and public/resources/, checking rules against
  answer.json, campaign scoring notes, and calling submit.
- Conciseness and pruning: every paragraph sits in the system prompt of every solve. Long
  checklists, pasted code, or narrow formulas accumulated from individual practice families crowd
  out reading new tasks and break when an unseen task brings different structure; practice traces
  show which instructions go unused.
- Limits and public documents: the host states the solve's limits and appends usage to executed tool
  results, and guides that prescribe tight turn targets or urgency push solvers to submit
  under-verified work with most of their budget still unused. Skipping public/resources/ or task
  documents leaves published domain rules unread.

Worked guide with one program entry:

\`\`\`markdown
${EXAMPLE.guide.trimEnd()}
\`\`\`
`;

export function portableGuide(guide: string): string {
  const match = HOST_ONLY_LINE.exec(guide);
  return match === null ? guide : guide.slice(0, match.index);
}

export function writeStarter(dir: string): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(STARTER.spec, null, 2)}\n`);
  writeFileSync(join(dir, AGENT_DIR, GUIDE_FILE), STARTER.guide);
}
