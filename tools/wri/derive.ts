/**
 * Every deterministic reader of a campaign's record, run over its log into one folder a campaign, so
 * a person or a session opens a file instead of running eight commands. The operator asked for it on
 * 30 October: the readers run quietly over every run whose log moved, while it runs and after it,
 * and an investigation's `start` runs them too. A folder is replaced whole with what the readers say
 * of the log as it stands, never appended to, so no file in it describes another moment of the log
 * than the rest; a folder whose log, and the commit that reads it, have not moved is left as it is.
 * A reader's code changed without a commit is not seen, so `--force` derives again.
 *
 * `READERS` is the one list of them, and `pass.ts` runs the same list a reader at a time for the
 * pulse (operator, 5 November: "ALL the scripts"). Its order is what a pass reads first: the rows
 * and triggers, then what a reader of a run asks soonest, and last `versions` and `chain`, which open
 * every kept harness beside a log and took 11 and 8 s on a log of 6,905 events against 1.5 s on one
 * of 51,590 (measured 5 November). A reader runs with no credential in its environment and with
 * `ANA_HOP=1`, under which it reaches no other host.
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
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { pooled } from "#src/meta/pool.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { runCaptured } from "#src/meta/subprocess.ts";
import { CLI } from "#tools/runs/registry.ts";

const SKILLS = ".claude/skills";
const TUNER = `${SKILLS}/promotion-tuner/scripts`;
const MANIFEST = "manifest.json";
/** Readers at once: the job that runs them shares its host with live campaigns. */
const WIDTH = 4;
const READER_MS = 180_000;

export interface Reader {
  readonly name: string;
  /** The script and its arguments, from the repository's root, for a log's absolute path and the
   *  repository's. */
  readonly args: (log: string, repo: string) => readonly string[];
  /** Whether it reads through the local embedding model. Its vectors outlast a cut, so a pass gives it
   *  any time left, and `--no-embed` leaves it out. */
  readonly embeds?: boolean;
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

/** A reader that names its campaign instead of its log, found as the registry finds it. */
const namedReader = (
  name: string,
  script: string,
  before: readonly string[],
  after: readonly string[] = [],
) => ({
  name,
  args: (log: string) => [script, ...before, basename(dirname(log)), ...after],
});

/** The readers that take one campaign and print what it holds, calling no paid model and writing
 *  nothing of the campaign's, the likeliest news first. Those marked `embeds` run a local model and
 *  keep their vectors in the reader store, and come after all but the two that open every kept harness,
 *  as a first read is the longest and their news the least likely. A script that needs more than a campaign
 *  to say anything, reads no run or writes elsewhere is left out, and `whole-run-investigation` names
 *  each. */
export const READERS: readonly Reader[] = [
  { name: "rows", args: (log) => ["tools/wri/wri.ts", "read", "--log", log] },
  skillReader("ending", "campaign-mechanics/scripts/ending.ts"),
  skillReader("readings", "comparison-reading/scripts/reading.ts"),
  skillReader("starter-reads", "comparison-reading/scripts/starter-reads.ts"),
  { name: "degradations", args: (log) => ["tools/runs/degradations.ts", log] },
  { name: "climb", args: (log) => ["tools/wri/wri.ts", "climb", "--log", log] },
  skillReader("gap", "comparison-reading/scripts/gap.ts"),
  namedReader("view", CLI, ["view"]),
  namedReader("loop", `${SKILLS}/run-improvement-campaign/scripts/wri2p2.ts`, []),
  namedReader("source", CLI, ["source"]),
  namedReader("logged", CLI, ["replay"]),
  namedReader("cost", `${TUNER}/cost.ts`, ["--name"], ["--format", "tsv"]),
  namedReader("table", `${TUNER}/table.ts`, ["--name"], ["--rows", "runs", "--format", "tsv"]),
  {
    name: "replay",
    args: (log, repo) => [
      `${TUNER}/replay.ts`,
      "--tree",
      repo,
      "--logs",
      dirname(dirname(log)),
      "--name",
      basename(dirname(log)),
    ],
  },
  skillReader("conditions", "campaign-mechanics/scripts/conditions.ts"),
  { name: "tasks", args: (log) => ["tools/wri/tasks.ts", log] },
  skillReader("draw", "comparison-reading/scripts/draw.ts"),
  skillReader("builder-view", "design-and-seats/scripts/builder-view.ts"),
  skillReader("examiner-view", "design-and-seats/scripts/examiner-view.ts"),
  skillReader("ambition", "examiner-complexity/scripts/ambition.ts"),
  skillReader("exams", "examiner-complexity/scripts/exams.ts"),
  skillReader("zone", "examiner-complexity/scripts/zone.ts"),
  { name: "answers", args: (log) => ["tools/wri/answers.ts", log] },
  { name: "waits", args: (log) => ["tools/wri/waits.ts", log] },
  { name: "routes", args: (log) => ["tools/wri/routes.ts", log] },
  { name: "restated", embeds: true, args: (log) => ["tools/wri/restated.ts", log] },
  { name: "nearness", embeds: true, args: (log) => ["tools/wri/nearness.ts", log] },
  skillReader("versions", "harness-audit/scripts/harness-versions.ts"),
  skillReader("chain", "harness-audit/scripts/harness-versions.ts", "--blind"),
];

/** The list a pass or `derive` runs: `--no-embed` takes out the readers that load the model. */
export const readersOf = (noEmbed: boolean): readonly Reader[] =>
  noEmbed ? READERS.filter(({ embeds }) => embeds !== true) : READERS;

/** What `reader` says of `log`, with its ending and stderr added where it failed. `cut` is a reader
 *  its time limit ended, so what it would have said is unknown. */
export async function readerOutput(
  reader: Reader,
  log: string,
  repo: string,
  timeout: number,
): Promise<{ text: string; ok: boolean; cut: boolean }> {
  const { PATH, HOME } = runtimeProcess.env;
  const ran = await runCaptured([capturedExecPath, ...reader.args(log, repo)], {
    cwd: repo,
    timeout,
    env: { ...keyIfDefined("PATH", PATH), ...keyIfDefined("HOME", HOME), ANA_HOP: "1" },
  });
  const ok = ran.exitCode === 0;
  const ending = ok ? "" : `\n-- ${reader.name} ended ${ran.signal ?? `with exit ${String(ran.exitCode)}`}\n`;
  const stderr = ran.stderr.trim() === "" ? "" : `\n-- stderr\n${ran.stderr}`;
  return { text: `${ran.stdout}${ending}${stderr}`, ok, cut: ran.signal !== null };
}

/** Where the folders go, under the main worktree of the repository `repo` lies in. */
export const derivedOf = (repo: string) => join(mainTree(repo), "data", "derived");

function kept(dir: string): { stamp: string; failed: string[] } | null {
  const file = join(dir, MANIFEST);
  if (!existsSync(file)) return null;
  const manifest = asRecord(capturedJsonParse(readFileSync(file, "utf8")));
  const failed = Array.isArray(manifest?.failed) ? manifest.failed.filter(isString) : [];
  return isString(manifest?.stamp) ? { stamp: manifest.stamp, failed } : null;
}

/** The readers' output for the log at `log`, in `<root>/<campaign>@<path>/`, one `<reader>.txt`
 *  each and a `manifest.json`, `<path>` the head of the hash of the log's path. The folder is written
 *  beside its place and renamed into it, so a reader of it never finds half of one derivation and
 *  half of another. A live log, its snapshot and a host's copy share the campaign's name, so the
 *  name alone is no key: until 9 November they shared one folder, and each replaced the other's. */
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
  const dir = join(root, `${name}@${hashJsonValue(log).slice(0, 12)}`);
  // What the folder is derived from: the log by its path, size and time, the commit reading it, and
  // which readers, so a folder written under `--no-embed` does not stand in for a whole one.
  const { size, lastModified } = Bun.file(log);
  const stamp = JSON.stringify([
    log,
    size,
    lastModified,
    gitMaybe(repo, "rev-parse", "HEAD")?.trim() ?? null,
    readers.map((reader) => reader.name),
  ]);
  const before = kept(dir);
  if (!force && before?.stamp === stamp) return { name, dir, ran: false, failed: before.failed };
  const work = join(root, `.${basename(dir)}.${String(runtimeProcess.pid)}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const endings = await pooled(readers, WIDTH, async (reader) => {
    const { text, ok } = await readerOutput(reader, log, repo, READER_MS);
    writeFileSync(join(work, `${reader.name}.txt`), text);
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
