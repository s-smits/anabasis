/**
 * An Anabasis harness written out as the tree Claude Code reads, so that a benchmark runner which
 * scores every arm under `claude -p` scores this one the same way. The fork's JobBench runner
 * (`jb_claude_runner.py`, `HARNESS_ENTRIES`) copies `CLAUDE.md`, `.claude/` and `scripts/` of such a
 * tree into each task's workspace, and refuses a tree with no `CLAUDE.md`.
 *
 *   bun studies/shared/claude-export.ts --from <starter | campaign> [--harness <kept>] --into <tree>
 *
 * The harness is found and checked by the owner the study's container bundle uses (`placeHarness`,
 * `bundle.ts`), so the digest and origin a score is read beside are the same. Of its parts:
 * - the guide becomes `CLAUDE.md`, under a note that says what of a campaign's solve is not here:
 *   its task and answer files and `submit`, and, for every harness alike, whatever the guide says of
 *   a limit on turns or time, of checking or submitting an answer, or of scoring;
 * - `.toolchain/` is copied to `scripts/toolchain/`, and its programs run by name as in a campaign,
 *   whose solver is told so and whose guide names each without a folder: `.claude/hooks.json`
 *   holds one `SessionStart` hook, which a rollout's installer writes into the settings Claude
 *   Code reads (`installTree`, `studies/harness2/h2/tree.ts`) and which puts the directories a
 *   solve's shell searches (`toolTreeSearchDirs`, `src/wall/isolation.ts`) on the PATH of every
 *   command after it. A campaign's shell searches them first; here they come behind the machine's
 *   own programs, since a line that put them ahead would hide the machine's openpyxl, docx and
 *   matplotlib behind the harness's Python. The note lists the names by the reader a campaign's
 *   prompt uses (`installedPrograms`, `src/harness/programs.ts`) and says that a name the machine
 *   has too starts the machine's. The note names no interpreter at all, the tool tree's own
 *   `python3` and `pip` left out of its list of programs, since a note that lists an interpreter,
 *   or says the harness's starts by its path, sends a solver to that interpreter, where it meets
 *   modules it lacks. Where the tree holds Python built for another machine, as a reference built
 *   on a Mac does on Linux, its interpreter and compiled distributions are installed again for
 *   this one at the same versions, or the export is refused (`rebuildForeignPython`,
 *   `foreign-python.ts`), and
 *   `export.json` names what was replaced under `rebuilt`;
 * - `agent/tools-spec.json` is dropped, and `agent/tools.ts` where an older kept harness still
 *   holds one: Claude Code has its own tools, and `export.json` lists both.
 * The harness's other files stay under `harness/`, which the runner does not copy, for provenance;
 * its tool tree is not kept there too, since a tree holding it twice makes every copy to another
 * machine carry both.
 *
 * Claude Code is another runtime than the one the harness was built in (pi's tools, an answer file
 * and `submit`), so a score of the export measures the harness after that transfer, and is read so.
 */
import { existsSync, lstatSync, mkdirSync, renameSync, writeFileSync } from "#src/meta/filesystem.ts";
import { GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "#src/meta/bundle-layout.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { tmpdir } from "#src/meta/os.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { dirname, join, relative } from "#src/meta/path.ts";
import { hasWholeToken } from "#src/meta/text.ts";
import { parseArgs } from "#src/meta/process.ts";
import { keyIfNotNull } from "#src/meta/optional-key.ts";
import { openHarness } from "#src/harness/open.ts";
import { type Program, programsOf } from "#src/harness/programs.ts";
import { portableGuide } from "#src/harness/starter.ts";
import { toolTreeSearchDirs } from "#src/wall/isolation.ts";
import { type Place, placeOf } from "#src/harness/place.ts";
import { HARNESS_DIR, HERE, placeHarness, sourceNamed } from "./bundle.ts";
import { packageFolders, type PythonFor, rebuildForeignPython, uvPython } from "./foreign-python.ts";

/** Where the tool tree lands in the exported tree, under the runner's `scripts/` entry. */
export const TOOLCHAIN = "scripts/toolchain";

/** The tree's hooks, which a rollout's installer copies into the settings Claude Code reads. */
const HOOKS = ".claude/hooks.json";

/** The harness's files Claude Code has no reader for. */
const DROPPED = [TOOLS_SPEC_FILE, GENERATED_TOOLS_FILE];

/** Counts the top-level modules of the folders it is given that import, and names those that do not. */
const IMPORTS = `import importlib, pkgutil, sys
names = sorted({m.name for m in pkgutil.iter_modules(sys.argv[1:]) if not m.name.startswith("_")})
bad = []
for name in names:
    try: importlib.import_module(name)
    except BaseException: bad.append(name)
print("IMPORTS", sys.version.split()[0], len(names) - len(bad), len(names), *bad[:5])`;

/** The programs an exported tree's guide may start by name, each with the account it gives of itself
 *  (`programsOf`). An interpreter or installer of the tool tree's own Python is none of them: behind
 *  the machine's on the PATH, its name starts the machine's. */
export const exportedPrograms = (tree: string): Program[] =>
  programsOf(join(tree, TOOLCHAIN)).filter(({ name }) => !/^(?:python|pip)[\d.]*$/u.test(name));

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
  const rawGuide = harness.guide ?? "This harness has no guide of its own.\n";
  // What a guide keeps under its last heading, `HOST_ONLY`, holds only for the exam and stays behind.
  const guide = portableGuide(rawGuide);
  const hostOnly = rawGuide.slice(guide.length);
  // Each program is listed with the first line of its own account, omitting helpers quarantined
  // strictly under `HOST_ONLY` so export does not re-advertise stripped campaign-only tools.
  const programs = exportedPrograms(part).filter(
    ({ name }) => hasWholeToken(guide, name) || !hasWholeToken(hostOnly, name),
  );
  // A harness that keeps its method in packages reaches them in a campaign through its own
  // interpreter, first on that PATH. Here that name starts the machine's, which reads no folder of
  // the tree, so the solver is told where they are and what they were built for, and the rest is its.
  const packages =
    harness.toolTree === null
      ? []
      : (await packageFolders(join(part, TOOLCHAIN))).map(
          ({ site, pythons }) =>
            `\`${join(TOOLCHAIN, site)}\`${pythons.length === 0 ? "" : ` (built for CPython ${pythons.join(" and ")})`}`,
        );
  const note = [
    "# How this harness reaches you",
    "",
    "The guide below was written for another runner, where a task came as `public/task.json`, the answer went into `answer.json` and a `submit` tool sent it. None of those is here: the task prompt is the whole task and says where the deliverable goes, and the files you leave are the answer, whatever the guide says of those three. Whatever it says of a limit on turns or time, of checking or submitting an answer, or of how an answer is scored also belongs to that runner and does not hold here.",
    ...(programs.length === 0
      ? []
      : [
          "",
          `Its programs run by name, as the guide names them; each is listed below with the first line it gives of itself. Their folders (${searched.map((dir) => `\`${dir}\``).join(", ")}) are on your PATH behind this machine's own programs, so a name this machine has too starts this machine's program. This runner has no \`input.json\`, \`public/\` folder or \`answer.json\`, so a program that opens one finds nothing.`,
          "",
          ...programs.map(
            ({ name, account }) => `- ${name}${account === null ? "" : `: ${account.split("\n")[0]}`}`,
          ),
        ]),
    ...(packages.length === 0
      ? []
      : [
          "",
          `The harness also brings Python packages and modules of its own, in ${packages.join(", ")}. No import path here names ${packages.length === 1 ? "that folder" : "those folders"}, and this machine's \`python3\` may be another version than the one they were built for. The whole of \`${TOOLCHAIN}\` is yours to read, run, change and add to, as is which interpreter you run and what you install.`,
        ]),
    "",
  ];
  writeFileSync(join(part, "CLAUDE.md"), `${note.join("\n")}\n${guide}`);
  const record = {
    harness: harness.digest,
    ...origin,
    dropped: DROPPED,
    toolchain: harness.toolTree === null ? null : TOOLCHAIN,
    searched,
    ...keyIfNotNull("rebuilt", rebuilt === null ? null : { for: place.name, ...rebuilt }),
  };
  writeFileSync(join(part, "export.json"), `${capturedJsonStringify(record, null, 2)}\n`);
  renameSync(part, into);
  return record;
}

/**
 * What the exported tree's own `python3` makes of its packages on this machine under `env`, a
 * rollout's environment with the tree's folders behind it as its hook puts them, or null where the
 * tree has no `python3`. Refuses one that cannot start: a reference whose launcher execs its
 * campaign machine's interpreter by path (a `python3.14` under `/opt`, exit 127 on Linux) rolls
 * without its method, and nothing that reads its files sees it. A link to that interpreter is found
 * as the link it is, since one that leads nowhere here is the same defect and no file to
 * `existsSync`. A module that does not import is a condition of the read, said and refused nothing.
 */
export async function ownPython(tree: string, env: Readonly<Record<string, string>>): Promise<string | null> {
  const dirs = toolTreeSearchDirs(join(tree, TOOLCHAIN));
  const python = dirs
    .map((dir) => join(dir, "python3"))
    .find((path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined);
  if (python === undefined) return null;
  const run = (words: readonly string[]) => {
    const ran = runSync([python, "-c", ...words], {
      cwd: tmpdir(),
      env: { ...env, PATH: [env.PATH ?? "", ...dirs].join(":") },
      timeout: 300_000,
    });
    const last = decodeOutput(ran.stderr).trim().split("\n").at(-1) ?? "";
    return {
      out: decodeOutput(ran.stdout),
      why: `exit ${String(ran.exitCode)}: ${last}`,
      ok: ran.exitCode === 0,
    };
  };
  const started = run(["pass"]);
  if (!started.ok) throw new Error(`${relative(tree, python)} cannot start here (${started.why})`);
  const sites = (await packageFolders(join(tree, TOOLCHAIN))).map(({ site }) => join(tree, TOOLCHAIN, site));
  const counted = run([IMPORTS, ...sites]);
  const [, version, ok, of, ...bad] = /^IMPORTS .*$/mu.exec(counted.out)?.[0].split(" ") ?? [];
  if (of === undefined) return `its python3 starts, and the count of its modules ended (${counted.why})`;
  return `its python3 is ${String(version)} and imports ${String(ok)} of ${of} of its modules${bad.length === 0 ? "" : `, not ${bad.join(", ")}`}`;
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
  const source = sourceNamed(values.from, values.harness);
  const place = values.for === undefined ? HERE : placeOf(values.for);
  const record = await exportForClaudeCode(values.into, source, place);
  console.log(`export: ${values.into} is harness ${record.harness}, ${capturedJsonStringify(record)}`);
}

if (import.meta.main) await main(Bun.argv.slice(2));
