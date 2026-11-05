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
 * - the guide becomes `CLAUDE.md`, under a note that says what of a campaign's solve is not here;
 * - `.toolchain/` is copied to `scripts/toolchain/`, and the note names its program directories in
 *   the order a solve's shell searches them (`toolTreeSearchDirs`, `src/wall/isolation.ts`);
 * - `agent/tools-spec.json` and `agent/tools.ts` are dropped: Claude Code has its own tools and no
 *   loader for a harness's, so the note names each declared tool as unavailable, and `export.json`
 *   lists both files.
 * The harness itself stays under `harness/`, which the runner does not copy, for provenance.
 *
 * Claude Code is another runtime than the one the harness was built in (pi's tools, an answer file
 * and `submit`), so a score of the export measures the harness after that transfer, and is read so.
 * Until 3 November the JobBench pilot planned a one-off script in a scratch folder for this.
 */
import { existsSync, cpSync, mkdirSync, renameSync, writeFileSync } from "#src/meta/filesystem.ts";
import { GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "#src/meta/bundle-layout.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { join, relative } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { openHarness } from "#src/harness/open.ts";
import { toolTreeSearchDirs } from "#src/wall/isolation.ts";
import { HARNESS_DIR, placeHarness } from "./bundle.ts";

/** Where the tool tree lands in the exported tree, under the runner's `scripts/` entry. */
const TOOLCHAIN = "scripts/toolchain";

/** The harness's files Claude Code has no reader for. */
const DROPPED = [TOOLS_SPEC_FILE, GENERATED_TOOLS_FILE];

/** The tree `into`, written from `source`. Returns what `export.json` records. */
export async function exportForClaudeCode(
  into: string,
  source: "starter" | { readonly campaign: string; readonly harness?: string },
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
  if (harness.toolTree !== null) cpSync(harness.toolTree, join(part, TOOLCHAIN), { recursive: true });
  const note = [
    "# How this harness reaches you",
    "",
    "The guide below was written for another runner, where a task came as `input.json`, the answer went into `answer.json` and a `submit` tool sent it. None of those is here: the task prompt is the whole task and says where the deliverable goes, and the files you leave are the answer, whatever the guide says of those three.",
    ...(unavailable.length === 0
      ? []
      : [
          "",
          `The guide may name tools of its own: ${unavailable.join(", ")}. They are not available here; use your own tools.`,
        ]),
    ...(searched.length === 0
      ? []
      : [
          "",
          `Its programs are in \`${TOOLCHAIN}/\`. Call one by its path, or begin a command with \`export PATH="${searched.map((dir) => `$PWD/${dir}`).join(":")}:$PATH";\`.`,
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
  };
  writeFileSync(join(part, "export.json"), `${capturedJsonStringify(record, null, 2)}\n`);
  renameSync(part, into);
  return record;
}

async function main(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { from: { type: "string" }, harness: { type: "string" }, into: { type: "string" } },
  });
  if (values.from === undefined || values.into === undefined) throw new Error("name --from and --into");
  if (values.from === "starter" && values.harness !== undefined) {
    throw new Error("--harness names a campaign's kept harness; the starter is one harness");
  }
  const source =
    values.from === "starter"
      ? "starter"
      : { campaign: values.from, ...keyIfDefined("harness", values.harness) };
  const record = await exportForClaudeCode(values.into, source);
  console.log(`export: ${values.into} is harness ${record.harness}, ${capturedJsonStringify(record)}`);
}

if (import.meta.main) await main(Bun.argv.slice(2));
