/**
 * An Anabasis harness written out as the tree Claude Code reads, so that a benchmark runner which
 * scores every arm under `claude -p` scores this one the same way. The fork's JobBench runner
 * (`jb_claude_runner.py`, `HARNESS_ENTRIES`) copies `CLAUDE.md`, `.claude/` and `scripts/` of such a
 * tree into each task's workspace, and refuses a tree with no `CLAUDE.md`.
 *
 *   bun studies/shared/claude-export.ts --from <starter | campaign> [--harness <kept>] --into <tree>
 *
 * The harness is found and checked by the owner the study's container bundle uses (`placeHarness`,
 * `bundle.ts`), so the digest and origin a score is read beside are the same. Of its four parts:
 * - the guide becomes `CLAUDE.md`, under a note that says what of a campaign's solve is not here:
 *   its task and answer files and `submit`, and, for every harness alike, whatever the guide says of
 *   a limit on turns or time, of checking or submitting an answer, or of scoring;
 * - `.toolchain/` is copied to `scripts/toolchain/`, and its programs run by name as in a campaign,
 *   whose solver is told so and whose guide names each without a folder: `.claude/hooks.json`
 *   holds one `SessionStart` hook, which a rollout's installer writes into the settings Claude
 *   Code reads (`installTree`, `studies/harness2/h2/tree.ts`) and which puts the directories a
 *   solve's shell searches (`toolTreeSearchDirs`, `src/wall/isolation.ts`) on the PATH of every
 *   command after it. A campaign's shell searches them first; here they come behind the machine's
 *   own programs, since the 9 November pilot's line that put them ahead hid the machine's
 *   openpyxl, docx and matplotlib behind the harness's Python. The note lists the names by the
 *   reader a campaign's prompt uses (`installedPrograms`, `src/harness/programs.ts`) and says
 *   that a name the machine has too starts the machine's. Until 17 November nothing put them on
 *   the PATH, and no rollout of twelve named one of a reference's five programs. A note of that
 *   day that listed every file of those directories as a program to run by its path, the
 *   interpreters among them, and left the machine's `python3` out sent a solver to the harness's
 *   interpreter first: a rollout met a module that interpreter lacks in four tasks of four,
 *   against one of four the day before. The note names no interpreter at all, the tool tree's
 *   own `python3` and `pip` left out of its list of programs: one that said
 *   the harness's starts by its path was followed by a command on that interpreter, most often a
 *   rollout's second, in 9 of 16 rollouts, each meeting a module it lacks. Where the tree holds Python built for another machine, as a reference built on a Mac does on Linux,
 *   its interpreter and compiled distributions are installed again for this one at the same
 *   versions, or the export is refused (`rebuildForeignPython`, `foreign-python.ts`), and
 *   `export.json` names what was replaced under `rebuilt`;
 * - `agent/tools-spec.json` and `agent/tools.ts` are dropped: Claude Code has its own tools and no
 *   loader for a harness's, so the note names each declared tool as unavailable, and `export.json`
 *   lists both files.
 * The harness's other files stay under `harness/`, which the runner does not copy, for provenance;
 * its tool tree is there no longer, since until 17 November a tree held it twice (17,111 of a
 * reference's 34,265 entries) and every copy to another machine carried both.
 *
 * Claude Code is another runtime than the one the harness was built in (pi's tools, an answer file
 * and `submit`), so a score of the export measures the harness after that transfer, and is read so.
 * Until 3 November the JobBench pilot planned a one-off script in a scratch folder for this.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "#src/meta/filesystem.ts";
import { GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "#src/meta/bundle-layout.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { dirname, join, relative } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { keyIfDefined, keyIfNotNull } from "#src/meta/optional-key.ts";
import { openHarness } from "#src/harness/open.ts";
import { installedPrograms } from "#src/harness/programs.ts";
import { toolTreeSearchDirs } from "#src/wall/isolation.ts";
import { HARNESS_DIR, HERE, type Place, placeHarness, placeOf } from "./bundle.ts";
import { type PythonFor, rebuildForeignPython, uvPython } from "./foreign-python.ts";

/** Where the tool tree lands in the exported tree, under the runner's `scripts/` entry. */
export const TOOLCHAIN = "scripts/toolchain";

/** The tree's hooks, which a rollout's installer copies into the settings Claude Code reads. */
const HOOKS = ".claude/hooks.json";

/** The harness's files Claude Code has no reader for. */
const DROPPED = [TOOLS_SPEC_FILE, GENERATED_TOOLS_FILE];

/** The tree `into`, written from `source` for programs that run on `place`, the machine that will
 *  roll it: this one unless `--for` names another. Returns what `export.json` records. */
export async function exportForClaudeCode(
  into: string,
  source: "starter" | { readonly campaign: string; readonly harness?: string },
  place: Place = HERE,
  python: PythonFor = uvPython(place),
) {
  if (existsSync(into)) throw new Error(`${into} is there already; an export is made once`);
  // Built beside its place and renamed into it whole, as `bundleArm` builds a mount.
  const part = `${into}.part-${String(process.pid)}-${String(Date.now())}`;
  mkdirSync(part, { recursive: true });
  const origin = await placeHarness(join(part, HARNESS_DIR), source);
  const harness = await openHarness(join(part, HARNESS_DIR));
  const unavailable = [...harness.kinds.keys()].toSorted();
  const searched =
    harness.toolTree === null
      ? []
      : toolTreeSearchDirs(harness.toolTree).map((dir) =>
          join(TOOLCHAIN, relative(harness.toolTree ?? "", dir)),
        );
  // Moved out of the copy `placeHarness` made, so a tree holds its programs once and every link as it was.
  if (harness.toolTree !== null) {
    mkdirSync(dirname(join(part, TOOLCHAIN)), { recursive: true });
    renameSync(harness.toolTree, join(part, TOOLCHAIN));
  }
  const rebuilt = await rebuildForeignPython(join(part, TOOLCHAIN), place, python);
  if (searched.length > 0) {
    // Claude Code runs what a `SessionStart` hook appends to `CLAUDE_ENV_FILE` before each command.
    const behind = searched.map((dir) => `$CLAUDE_PROJECT_DIR/${dir}`).join(":");
    const command = `echo "export PATH=\\"\\$PATH:${behind}\\"" >> "$CLAUDE_ENV_FILE"`;
    const hooks = { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } };
    mkdirSync(dirname(join(part, HOOKS)), { recursive: true });
    writeFileSync(join(part, HOOKS), `${capturedJsonStringify(hooks, null, 2)}\n`);
  }
  // An interpreter or installer of the tool tree's own Python is no program of the harness, and
  // behind the machine's on the PATH its name starts the machine's.
  const programs =
    searched.length === 0
      ? []
      : installedPrograms(join(part, TOOLCHAIN)).filter((name) => !/^(?:python|pip)[\d.]*$/u.test(name));
  const note = [
    "# How this harness reaches you",
    "",
    "The guide below was written for another runner, where a task came as `input.json`, the answer went into `answer.json` and a `submit` tool sent it. None of those is here: the task prompt is the whole task and says where the deliverable goes, and the files you leave are the answer, whatever the guide says of those three. Whatever it says of a limit on turns or time, of checking or submitting an answer, or of how an answer is scored also belongs to that runner and does not hold here.",
    ...(unavailable.length === 0
      ? []
      : [
          "",
          `The guide may name tools of its own: ${unavailable.join(", ")}. They are not available here; use your own tools.`,
        ]),
    ...(programs.length === 0
      ? []
      : [
          "",
          `Its programs run by name, as the guide names them: ${programs.join(", ")}. Their folders (${searched.map((dir) => `\`${dir}\``).join(", ")}) are on your PATH behind this machine's own programs, so a name this machine has too starts this machine's program. Those written for that runner's files (they open \`input.json\` or a \`public/\` folder, or check \`answer.json\`) find none of them here.`,
        ]),
    "",
  ];
  const guide = harness.guide ?? "This harness has no guide of its own.\n";
  writeFileSync(join(part, "CLAUDE.md"), `${note.join("\n")}\n${guide}`);
  const record = {
    harness: harness.digest,
    ...origin,
    dropped: DROPPED,
    unavailable,
    toolchain: harness.toolTree === null ? null : TOOLCHAIN,
    searched,
    ...keyIfNotNull("rebuilt", rebuilt === null ? null : { for: place.name, ...rebuilt }),
  };
  writeFileSync(join(part, "export.json"), `${capturedJsonStringify(record, null, 2)}\n`);
  renameSync(part, into);
  return record;
}

async function main(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      from: { type: "string" },
      harness: { type: "string" },
      into: { type: "string" },
      for: { type: "string" },
    },
  });
  if (values.from === undefined || values.into === undefined) throw new Error("name --from and --into");
  if (values.from === "starter" && values.harness !== undefined) {
    throw new Error("--harness names a campaign's kept harness; the starter is one harness");
  }
  const source =
    values.from === "starter"
      ? "starter"
      : { campaign: values.from, ...keyIfDefined("harness", values.harness) };
  const place = values.for === undefined ? HERE : placeOf(values.for);
  const record = await exportForClaudeCode(values.into, source, place);
  console.log(`export: ${values.into} is harness ${record.harness}, ${capturedJsonStringify(record)}`);
}

if (import.meta.main) await main(Bun.argv.slice(2));
