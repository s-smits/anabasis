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

A solver is pi's coding agent behind a command wall. The host reads three paths under harness/:

- **agent/tools-spec.json**: \`${capturedJsonStringify(EXAMPLE.spec)}\` (selects from ${CODING_TOOLS.join(", ")}; keep \`tools: []\`).
- **.toolchain/**: executables in \`.toolchain/bin\` (or nested bin/shims/sbin) run by name first on PATH. If \`.toolchain/env.sh\` exists, BASH_ENV sources it before every command; derive all paths relative to \`\${BASH_SOURCE%/*}\` (never hardcoded home paths) so exports stay self-contained.
- **agent/BUILT_AGENTS.md**: operating guide loaded into every solve's system prompt (cannot override task, tools, limits or submission).

## What every solver receives in campaign tasks

Home contains \`public/task.json\`, \`public/files/\`, \`public/resources/\`, and \`public/answer-format.json\`. The solver writes \`answer.json\` (and any requested \`deliverables/\`) and calls \`submit\`.

## Designing tools that transfer (.toolchain/)

Build small, general, verb-first CLIs (accepting relative file paths, \`--help\`, stdout results, stderr diagnostics, exit 0/1/2) that work on ordinary workspaces outside this host:
- Workspace inspection and extraction across the domain's native input formats.
- Deliverable verification: reopen every produced file with an independent reader to check format integrity, computed values, visual clarity, and requirement completeness across every requested item.
- Independent domain diagnostics, assumption tests and sensitivity checks.
Keep campaign-specific adapters (\`public/task.json\`, \`answer.json\`) strictly separate from general tools, and prune tools that practice traces show sit unused.

Worked program at \`.toolchain/bin/${CHECKER}\` (executable):

\`\`\`js
${EXAMPLE.programs[CHECKER].trimEnd()}
\`\`\`

## Designing agent/BUILT_AGENTS.md

Campaigns start from the Starter guide:

\`\`\`markdown
${STARTER.guide.trimEnd()}
\`\`\`

- **Portable boundary**: external exports keep ONLY text above \`${HOST_ONLY}\` and strip everything below it. Keep the portable section ultra-lean (concise tool usage and high-leverage domain verification habits, never a multi-page checklist—put detailed reference notes in \`.toolchain/\` to read on demand). Put all campaign paths, answer fields, rule IDs, scoring notes and campaign wrappers strictly below \`${HOST_ONLY}\`.
- **Protect solver depth**: give the solver room to use its budget for thorough workspace discovery, standard diagnostics and independently reopening every deliverable.

Worked guide:

\`\`\`markdown
${EXAMPLE.guide.trimEnd()}
\`\`\`
`;

export function portableGuide(guide: string): string {
  const match = HOST_ONLY_LINE.exec(guide);
  return match === null ? guide : guide.slice(0, match.index);
}

export function writeBare(dir: string): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(STARTER.spec, null, 2)}\n`);
}

export function writeStarter(dir: string): void {
  writeBare(dir);
  writeFileSync(join(dir, AGENT_DIR, GUIDE_FILE), STARTER.guide);
}
