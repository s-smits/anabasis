/**
 * Every deterministic reader of a campaign's record, run over its log into one folder a campaign, so
 * a person or a session opens a file instead of running eight commands. The operator asked for it on
 * 30 October: the readers run quietly over every run whose log moved, while it runs and after it,
 * and an investigation's `start` runs them too. A folder is replaced whole with what the readers say
 * of the log as it stands, never appended to, so no file in it describes another moment of the log
 * than the rest; a folder whose log, and the commit that reads it, have not moved is left as it is.
 * A reader's code changed without a commit is not seen, so `--force` derives again.
 *
 * The folders sit under the main worktree's `data/derived/`, which git ignores: the readers print
 * hidden values as the log holds them, so they stay on the exam side with the archive. A reader that
 * fails leaves its ending and stderr in its file and is named; the others still run.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe, mainTree } from "#src/meta/git.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { pooled } from "#src/meta/pool.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { runCaptured } from "#src/meta/subprocess.ts";

const SKILLS = ".claude/skills";
const MANIFEST = "manifest.json";
/** Readers at once: the job that runs them shares its host with live campaigns. */
const WIDTH = 4;
const READER_MS = 180_000;

export interface Reader {
  readonly name: string;
  /** The script and its arguments, from the repository's root, for a log's absolute path and the
   *  repository's. */
  readonly args: (log: string, repo: string) => readonly string[];
}

export interface Derived {
  readonly name: string;
  readonly dir: string;
  /** Whether the readers ran this time, rather than a folder for the same log being kept. */
  readonly ran: boolean;
  /** The readers that did not exit 0. */
  readonly failed: readonly string[];
}

/** A skill script that takes the log as its one argument, then `flags`. */
const skillReader = (name: string, script: string, ...flags: string[]): Reader => ({
  name,
  args: (log) => [`${SKILLS}/${script}`, log, ...flags],
});

/** The readers that take one log and print what it holds, calling no model and writing nothing.
 *  `replay.ts` reads one campaign by its folder and name; `table.ts` reads the fleet, and `runs view`
 *  refreshes remote copies, so both are left out. */
export const READERS: readonly Reader[] = [
  { name: "rows", args: (log) => ["tools/wri/wri.ts", "read", "--log", log] },
  skillReader("chain", "harness-audit/scripts/harness-versions.ts", "--blind"),
  { name: "tasks", args: (log) => ["tools/wri/tasks.ts", log] },
  { name: "degradations", args: (log) => ["tools/runs/degradations.ts", log] },
  skillReader("versions", "harness-audit/scripts/harness-versions.ts"),
  skillReader("readings", "comparison-reading/scripts/reading.ts"),
  {
    name: "replay",
    args: (log, repo) => [
      `${SKILLS}/promotion-tuner/scripts/replay.ts`,
      "--tree",
      repo,
      "--logs",
      dirname(dirname(log)),
      "--name",
      basename(dirname(log)),
    ],
  },
  skillReader("draw", "comparison-reading/scripts/draw.ts"),
  skillReader("ending", "campaign-mechanics/scripts/ending.ts"),
  skillReader("conditions", "campaign-mechanics/scripts/conditions.ts"),
  skillReader("builder-view", "design-and-seats/scripts/builder-view.ts"),
  skillReader("examiner-view", "design-and-seats/scripts/examiner-view.ts"),
];

/** Where the folders go, under the main worktree of the repository `repo` lies in. */
export const derivedOf = (repo: string) => join(mainTree(repo), "data", "derived");

function kept(dir: string): { stamp: string; failed: string[] } | null {
  const file = join(dir, MANIFEST);
  if (!existsSync(file)) return null;
  const manifest = asRecord(capturedJsonParse(readFileSync(file, "utf8")));
  const failed = Array.isArray(manifest?.failed) ? manifest.failed.filter(isString) : [];
  return isString(manifest?.stamp) ? { stamp: manifest.stamp, failed } : null;
}

/** The readers' output for the log at `log`, in `<root>/<campaign>/`, one `<reader>.txt` each and a
 *  `manifest.json`. The folder is written beside its place and renamed into it, so a reader of it
 *  never finds half of one derivation and half of another. */
export async function derive(
  log: string,
  {
    root,
    repo,
    force = false,
    readers = READERS,
  }: { root: string; repo: string; force?: boolean; readers?: readonly Reader[] },
): Promise<Derived> {
  const name = basename(dirname(log));
  const dir = join(root, name);
  // What the folder is derived from: the log by its path, size and time, and the commit reading it.
  const { size, lastModified } = Bun.file(log);
  const stamp = JSON.stringify([
    log,
    size,
    lastModified,
    gitMaybe(repo, "rev-parse", "HEAD")?.trim() ?? null,
  ]);
  const before = kept(dir);
  if (!force && before?.stamp === stamp) return { name, dir, ran: false, failed: before.failed };
  const work = join(root, `.${name}.${String(runtimeProcess.pid)}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const endings = await pooled(readers, WIDTH, async (reader) => {
    const ran = await runCaptured([capturedExecPath, ...reader.args(log, repo)], {
      cwd: repo,
      timeout: READER_MS,
    });
    const ok = ran.exitCode === 0;
    const ending = ok
      ? ""
      : `\n-- ${reader.name} ended ${ran.signal ?? `with exit ${String(ran.exitCode)}`}\n`;
    const stderr = ran.stderr.trim() === "" ? "" : `\n-- stderr\n${ran.stderr}`;
    writeFileSync(join(work, `${reader.name}.txt`), `${ran.stdout}${ending}${stderr}`);
    return ok ? [] : [reader.name];
  });
  const failed = endings.flat();
  writeFileSync(
    join(work, MANIFEST),
    `${JSON.stringify({ stamp, failed, at: new Date().toISOString() }, null, 2)}\n`,
  );
  const old = `${work}.old`;
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(work, dir);
  rmSync(old, { recursive: true, force: true });
  return { name, dir, ran: true, failed };
}

/** One line on what a pass derived, the only line a quiet pass prints. */
export function derivedLine(done: readonly Derived[], root: string): string {
  const ran = done.filter((each) => each.ran).length;
  const failed = done.flatMap(({ name, failed: readers }) => readers.map((reader) => `${name}/${reader}`));
  const faults = failed.length === 0 ? "" : `; readers that failed: ${failed.join(", ")}`;
  return `derived ${String(ran)} of ${String(done.length)} campaigns into ${root}, ${String(done.length - ran)} unchanged${faults}`;
}

/** Every reader's file of each folder, under a heading naming the campaign and the reader. */
export function derivedText(done: readonly Derived[], readers: readonly Reader[] = READERS): string {
  return done
    .flatMap(({ name, dir }) =>
      readers.map(({ name: reader }) => {
        const file = join(dir, `${reader}.txt`);
        return `## ${name} · ${reader}\n\n${existsSync(file) ? readFileSync(file, "utf8").trim() : "(not derived)"}\n`;
      }),
    )
    .join("\n");
}
