/**
 * Assemble a seeded-position kickoff from the production assemblers, so a segment or rehearsal
 * never retypes the bytes the paid run will emit.
 *
 * The skill's kickoff rules are structural here rather than remembered:
 *   1. the user request is carried verbatim, under production's own label, through the real
 *      `directKickoff` — a paraphrased prompt makes every finding untransferable;
 *   2. the context manifest comes from the real `prepareUserContext`, so admission rules
 *      (hidden paths, byte caps, binary refusal) match production exactly;
 *   3. the SIMULATED POSITION block is required to disclose the skip — a file that does not
 *      declare itself with that label is refused, because a staged history the actor is meant
 *      to believe produces unreproducible behaviour;
 *   4. contract appendices are appended byte for byte from files the real assembler wrote
 *      (for a climb, the selector's own output) — never retyped.
 *
 * Usage, from the tree whose run you are seeding:
 *
 *   bun .claude/skills/system-path-simulation/scripts/seed-kickoff.mts \
 *     --prompt-file /abs/one-liner.txt \
 *     --context /abs/public-context-dir \
 *     --position-file /abs/simulated-position.txt \
 *     --append-file /abs/difficulty-contract.txt \
 *     --out /abs/scratch/kickoff.txt
 *
 * `--context` and `--append-file` repeat. `--position-file` is optional: without it the output is
 * the exact from-scratch kickoff, useful when the segment starts at the real beginning. The
 * result feeds `run-segment.mts --step builder:/abs/scratch/kickoff.txt`.
 */

import { readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { dirname, resolve } from "#src/meta/path.ts";

import { prepareUserContext } from "#src/builder/user-context.ts";
import { directKickoff } from "#src/run/direct-input.ts";
import { absoluteOption, type ExitWith, exitWith, parseOrDie } from "./cli-args.mts";
import { errorMessage } from "#src/meta/runtime-values.ts";

const die: ExitWith = exitWith("seed-kickoff");

const REPO_ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "../../../..");
const POSITION_LABEL = "SIMULATED POSITION";

const parsed = parseOrDie(die, {
  values: ["prompt-file", "prompt", "position-file", "out"],
  repeatable: ["context", "append-file"],
});
const single = parsed.single;
const contextPaths = [...(parsed.repeated.get("context") ?? [])];
const appendFiles = [...(parsed.repeated.get("append-file") ?? [])];

const absolutePath = absoluteOption(die);

const positionOpening = new RegExp(`^${POSITION_LABEL}(?:[ \\t]*—[^\\r\\n]*)?(?:\\r?\\n|$)`);
function readPath(option: string, path: string): string {
  const absolute = absolutePath(option, path);
  try {
    return readFileSync(absolute, "utf8");
  } catch (error) {
    const detail = errorMessage(error);
    die(`could not read --${option} ${absolute}: ${detail}`);
  }
}

const promptFile = single.get("prompt-file");
const promptInline = single.get("prompt");
if ((promptFile === undefined) === (promptInline === undefined)) {
  die("pass exactly one of --prompt-file <abs> or --prompt <text> — the run's real one-liner, verbatim");
}
const prompt = promptFile === undefined ? (promptInline ?? "") : readPath("prompt-file", promptFile);
if (prompt.trim() === "") {
  die("the prompt is empty — a kickoff without the verbatim user request measures nothing");
}

/** The real admission path: same shared `context/` pickup, same hidden-path and byte-cap refusals. */
const context = prepareUserContext(
  REPO_ROOT,
  contextPaths.map((path) => absolutePath("context", path)),
);

const positionFile = single.get("position-file");
const position = positionFile === undefined ? null : readPath("position-file", positionFile);
if (position !== null && !positionOpening.test(position.trimStart())) {
  die(
    `the position block must open with "${POSITION_LABEL}" — the skip is disclosed, never staged. ` +
      "State the completed stages as fact, where the actor stands, the one step under test, and that the position was seeded.",
  );
}

let kickoff = directKickoff(prompt, context);
if (position !== null) kickoff += `\n\n${position}`;
for (const file of appendFiles) kickoff += `\n\n${readPath("append-file", file)}`;
if (!kickoff.endsWith("\n")) kickoff += "\n";

const out = single.get("out");
if (out === undefined) {
  console.write(kickoff);
} else {
  const outputPath = absolutePath("out", out);
  writeFileSync(outputPath, kickoff);
  console.error(
    `seed-kickoff: wrote ${outputPath} (${kickoff.length} chars, ${context.files.length} context files, ` +
      `${position === null ? "no position block" : "position block present"}, ${appendFiles.length} appendices)`,
  );
}
