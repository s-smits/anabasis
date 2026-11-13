/**
 * Every deterministic reader of a campaign's record, run over its log into one folder a campaign, so
 * a person or a session opens a file instead of running eight commands. The operator asked for it on
 * 30 October: the readers run quietly over every run whose log moved, while it runs and after it,
 * and an investigation's `start` runs them too. A folder is replaced whole with what the readers say
 * of the log as it stands, never appended to, so no file in it describes another moment of the log
 * than the rest; a folder whose log, and the commit that reads it, have not moved is left as it is.
 * A reader's code changed without a commit is not seen, so `--force` derives again.
 *
 * `READERS` is the one list of them. `pass.ts` runs for the pulse those that name a moment (`at`),
 * a reader at a time, on a log only once one of its moments lies past what it last read: a reader's
 * answer matters at the event it answers, and on the largest closed log (96 MB, measured
 * 10 November) the 27 readers without the embedding model took 277 s against a pass of 30 s. The rest
 * are `derive`'s alone, among them `versions` and `chain`, which open every kept harness beside a log
 * (87 and 169 s there) and come last. A reader runs with no credential in its environment and with `ANA_HOP=1`,
 * under which it reaches no other host.
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
import type { EventKind } from "#src/kernel/log.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { pooled } from "#src/meta/pool.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { runCaptured } from "#src/meta/subprocess.ts";
import { CLI, readNamed } from "#tools/runs/registry.ts";

const SKILLS = ".claude/skills";
const TUNER = `${SKILLS}/promotion-tuner/scripts`;
const MANIFEST = "manifest.json";
/** Readers at once: the job that runs them shares its host with live campaigns. */
const WIDTH = 4;
const READER_MS = 180_000;
const REPORTED = "comparison.reported";
const PROMOTED = "harness.promoted";
const ENDED = "campaign.ended";
const EXAMINED = "exam.finished";

export interface Reader {
  readonly name: string;
  /** What its file holds, in a line a lane's prompt prints beside the file's name (`derivedMap`). */
  readonly answers: string;
  /** The script and its arguments, from the repository's root, for a log's absolute path and the
   *  repository's. */
  readonly args: (log: string, repo: string) => readonly string[];
  /** Whether it reads through the local embedding model, which `derive --no-embed` leaves out. */
  readonly embeds?: boolean;
  /** Whether it finds its campaign by name, so that it reads whichever log the registry gives that
   *  name (`readerOutput`). */
  readonly named?: boolean;
  /** The events whose arrival makes its answer worth a look's lines; a reader without them runs in
   *  `derive` only. */
  readonly at?: readonly EventKind[];
  /** The lines that answer a moment where its text names neither the moment's session nor its
   *  harness. */
  readonly gist?: RegExp;
}

export interface Derived {
  readonly name: string;
  readonly dir: string;
  /** Whether the readers ran this time, rather than a folder for the same log being kept. */
  readonly ran: boolean;
  /** The readers that did not exit 0. */
  readonly failed: readonly string[];
}

/** A script that takes the log as its one argument, then `flags`. */
const logReader = (name: string, answers: string, script: string, ...flags: string[]): Reader => ({
  name,
  answers,
  args: (log) => [script, log, ...flags],
});

/** A skill's script that takes the log as its one argument, then `flags`. */
const skillReader = (name: string, answers: string, script: string, ...flags: string[]): Reader =>
  logReader(name, answers, `${SKILLS}/${script}`, ...flags);

/** A reader that names its campaign instead of its log, found as the registry finds it. */
/** `reader`, run for the pulse too, once an event of `kinds` lies past what it last read; `gist`
 *  as `Reader.gist` has it. */
const at = (reader: Reader, kinds: readonly EventKind[], gist?: RegExp): Reader => ({
  ...reader,
  at: kinds,
  ...keyIfDefined("gist", gist),
});

const namedReader = (
  name: string,
  answers: string,
  script: string,
  before: readonly string[],
  after: readonly string[] = [],
): Reader => ({
  name,
  answers,
  args: (log: string) => [script, ...before, basename(dirname(log)), ...after],
  named: true,
});

/** The readers that take one campaign and print what it holds, calling no paid model and writing
 *  nothing of the campaign's, the likeliest news first. Those marked `embeds` run a local model and
 *  keep their vectors in the reader store, and come after all but the three that open every kept harness,
 *  as a first read is the longest and their news the least likely. Each moment's readers (`at`) come
 *  from what their text says of it; a `gist` stands where, on three closed logs of three domains
 *  (10 November), naming the session or harness found none of the reader's lines: a summary row, a
 *  table's own row. A reader whose text is a block or a table over the whole log (a check's row, a
 *  pair's, a compaction, a launch, a sequence of calls) has no line of one moment and names none,
 *  so only `derive` runs it, as it does `aim` and `epoch-spend`, whose lines of a moment repeat
 *  what `ambition` and `cost` say there. A script that needs more than a campaign
 *  to say anything, reads no run or writes elsewhere is left out, and `whole-run-investigation` names
 *  each. */
export const READERS: readonly Reader[] = [
  at(
    {
      name: "rows",
      answers: "rows A to F and every trigger with its detail (`wri.ts read`)",
      args: (log) => ["tools/wri/wri.ts", "read", "--log", log],
    },
    [REPORTED, PROMOTED, EXAMINED, "build.finished", ENDED],
  ),
  at(
    skillReader(
      "ending",
      "why the campaign stopped, and the move and log line that ended it",
      "campaign-mechanics/scripts/ending.ts",
    ),
    ["build.finished", ENDED],
    /^\d+ events, |patience: /,
  ),
  at(
    skillReader(
      "readings",
      "each comparison's tally, p, wins to spare or losses short, cap, A/A, zone and gap to the best",
      "comparison-reading/scripts/reading.ts",
    ),
    [REPORTED],
  ),
  skillReader(
    "starter-reads",
    "each starter comparison after a promotion, its tally split by where each task came from",
    "comparison-reading/scripts/starter-reads.ts",
  ),
  logReader(
    "degradations",
    "each session or solve a model other than the one asked for served",
    "tools/runs/degradations.ts",
  ),
  at(
    {
      name: "climb",
      answers: "promotions, whether each was confirmed, and the comparisons between them",
      args: (log) => ["tools/wri/wri.ts", "climb", "--log", log],
    },
    [PROMOTED],
    /^\| (?!campaign |---)/,
  ),
  at(
    namedReader(
      "view",
      "`runs view`: each session and comparison, the epochs, the five factors' lines, the table's move",
      CLI,
      ["view"],
    ),
    [ENDED],
    /^(?!reader )\S+ /,
  ),
  at(
    namedReader(
      "loop",
      "the WRI2P2 step this run stands at and what it owes next",
      `${SKILLS}/run-improvement-campaign/scripts/wri2p2.ts`,
      [],
    ),
    [PROMOTED, ENDED],
    /^\S+ · /,
  ),
  at(
    namedReader(
      "source",
      "each launch's commit, whether clean, load, Python, and the flags that differ between launches",
      CLI,
      ["source"],
    ),
    ["campaign.opened"],
    /^run-\d+ /,
  ),
  namedReader("logged", "the log's counts as this tree's folds replay it, in one line", CLI, ["replay"]),
  at(
    namedReader(
      "cost",
      "dollars recorded and repriced, a promotion and a confirmed promotion, on one meter",
      `${TUNER}/table.ts`,
      ["--name"],
      ["--rows", "cost", "--format", "tsv"],
    ),
    [PROMOTED, ENDED],
    /^\S+\t\d{4}-\d\d-\d\d\t/,
  ),
  at(
    namedReader(
      "table",
      "this run's row of the release table: setting, promotions, hours, dollars",
      `${TUNER}/table.ts`,
      ["--name"],
      ["--rows", "runs", "--format", "tsv"],
    ),
    [PROMOTED, ENDED],
    /^(?!run\t)\S+\t/,
  ),
  at(
    {
      name: "replay",
      answers: "each reading again under this tree's promotion rule, with and without the bill",
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
    [PROMOTED],
  ),
  at(
    skillReader(
      "conditions",
      "solves by condition and setting, and whether each comparison's sides are comparable",
      "campaign-mechanics/scripts/conditions.ts",
    ),
    ["comparison.started"],
  ),
  logReader(
    "tasks",
    "every scored task as its author wrote it and the comparisons that scored it, no outcome",
    "tools/wri/tasks.ts",
  ),
  at(
    skillReader(
      "draw",
      "the held-out pool, the next comparison's draw, admission's floor, the smallest tallies that step",
      "comparison-reading/scripts/draw.ts",
    ),
    ["comparison.started", EXAMINED],
    /^(held-out pool|next comparison|admission)/,
  ),
  skillReader(
    "builder-view",
    "what the Builder's next opening would be told",
    "design-and-seats/scripts/builder-view.ts",
  ),
  skillReader(
    "examiner-view",
    "what the Examiner's next opening would be told",
    "design-and-seats/scripts/examiner-view.ts",
  ),
  at(
    skillReader(
      "ambition",
      "hours, solves and dollars to the first comparison and promotion; each Examiner session's yield",
      "examiner-complexity/scripts/ambition.ts",
    ),
    [EXAMINED],
  ),
  skillReader(
    "exams",
    "one row a session and task family: drafts, held, refused, no room, proved",
    "examiner-complexity/scripts/exams.ts",
  ),
  at(
    skillReader(
      "zone",
      "per comparison, tasks the reference answers never, in some solves or always, and untied by what",
      "comparison-reading/scripts/reading.ts",
      "--zone",
    ),
    [REPORTED],
  ),
  at(
    logReader(
      "answers",
      "per comparison, tasks where a side's passes repeated one answer, and the objective's repeat spread",
      "tools/wri/answers.ts",
    ),
    [REPORTED],
  ),
  logReader(
    "waits",
    "per comparison, the median share of a solve spent inside tool calls, by side and ending",
    "tools/wri/waits.ts",
  ),
  logReader(
    "routes",
    "per comparison, the median calls a pass and the distinct tool orders, by side",
    "tools/wri/routes.ts",
  ),
  logReader(
    "checks",
    "one row a check: rating, rules, controls, refusals by side and asker, whether it stands",
    "tools/wri/checks.ts",
  ),
  at(
    logReader(
      "rejections",
      "one row a rejected solve: the refusing checks, the ruling and its probes, a label, what stands",
      "tools/wri/rejections.ts",
    ),
    [REPORTED],
  ),
  logReader(
    "pairs",
    "a row a task a comparison: solves, diff, A/A, ratio to best, tie kind; tallies by writer and family",
    "tools/wri/pairs.ts",
  ),
  at(
    logReader(
      "budget",
      "each comparison side's endings, turns and seconds against the bound, long calls, queue, load",
      "tools/wri/budget.ts",
    ),
    [REPORTED],
  ),
  logReader(
    "compactions",
    "each compaction's tokens, seconds, error and priced usages, and each session's sum",
    "tools/wri/compactions.ts",
  ),
  logReader(
    "launches",
    "each launch beside its stretch of the log: last event, steps left open, killed endings, gap",
    "tools/wri/launches.ts",
  ),
  logReader(
    "scores",
    "each comparison recounted by task: tallies by measure, A/A halves, a step's removals and writers",
    "tools/wri/scores.ts",
  ),
  logReader(
    "aim",
    "what each Examiner session could read and wrote, and each side's measures against the author's best",
    "tools/wri/aim.ts",
  ),
  at(
    logReader(
      "drafted",
      "how the exam was drafted: each draft and its faults, the standing draft's counts, admitted checks",
      "tools/wri/drafted.ts",
    ),
    ["contract.frozen"],
    /^(standing draft|shape faults|checks:)/,
  ),
  skillReader(
    "wakes",
    "each Examiner session's opening or wake rebuilt by this tree, against the one on record",
    "design-and-seats/scripts/examiner-view.ts",
    "--each",
  ),
  logReader(
    "practice",
    "one row a practice solve: its harness's role, its ending and what the state moved",
    "tools/wri/practice.ts",
  ),
  logReader(
    "calls",
    "per harness, side and program: calling solves, calls, errors and non-zero exits",
    "tools/wri/calls.ts",
  ),
  logReader(
    "sequences",
    "test-side passes by family and harness: distinct program sequences and the commonest's share",
    "tools/wri/calls.ts",
    "--sequences",
  ),
  logReader(
    "epoch-spend",
    "each epoch's billed dollars by role, and what the comparisons it reported billed",
    "tools/wri/epoch-spend.ts",
  ),
  {
    ...logReader("restated", "which Referee reasons say the same thing", "tools/wri/restated.ts"),
    embeds: true,
  },
  {
    ...logReader(
      "nearness",
      "how alike each session's tasks read to earlier ones: wording, never dependence",
      "tools/wri/nearness.ts",
    ),
    embeds: true,
  },
  at(
    logReader(
      "names",
      "where a kept harness's own files name a task id, prefix, family or rare identifier",
      "tools/wri/names.ts",
    ),
    [PROMOTED],
  ),
  skillReader(
    "versions",
    "each kept harness, its parent, and what moved between them",
    "harness-audit/scripts/harness-versions.ts",
  ),
  skillReader(
    "chain",
    "the harness lineage with outcomes withheld, for a blind review",
    "harness-audit/scripts/harness-versions.ts",
    "--blind",
  ),
];

/** The list `derive` runs: `--no-embed` takes out the readers that load the model. */
export const readersOf = (flags: { readonly "no-embed"?: boolean | undefined }): readonly Reader[] =>
  flags["no-embed"] === true ? READERS.filter(({ embeds }) => embeds !== true) : READERS;

/** The log the registry gives the campaign `name`, or null where it names none or several. */
function namedLog(name: string, repo: string): string | null {
  try {
    return readNamed(name, repo).path;
  } catch {
    return null;
  }
}

/** What `reader` says of `log`, with its ending and stderr added where it failed. `cut` is a reader
 *  its time limit ended, so what it would have said is unknown. A reader that finds its campaign by
 *  name is not run on a log the name does not find, a snapshot or a second copy: on 10 November six
 *  files of a snapshot's folder described the live log, 294 events on, under the snapshot's name. */
export async function readerOutput(
  reader: Reader,
  log: string,
  repo: string,
  timeout: number,
): Promise<{ text: string; ok: boolean; cut: boolean }> {
  if (reader.named === true) {
    const name = basename(dirname(log));
    const found = namedLog(name, repo);
    if (found !== log) {
      const text = `not read: ${reader.name} finds a campaign by its name, and ${name} names ${found ?? "no one campaign here"}, not ${log}\n`;
      return { text, ok: true, cut: false };
    }
  }
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
  const dir = folderOf(root, log);
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

/** The folder `derive` keeps for the log at `log`, under `root`. */
export const folderOf = (root: string, log: string) =>
  join(root, `${basename(dirname(log))}@${hashJsonValue(log).slice(0, 12)}`);

/** How many lines a derived file holds, or that it was not derived. */
function linesOf(file: string): string {
  if (!existsSync(file)) return "none";
  const text = readFileSync(file, "utf8").trimEnd();
  return text === "" ? "0" : String(text.split("\n").length);
}

/**
 * What each derived file answers, and how many lines it holds for each campaign, as a table for a
 * lane's prompt; "" where no folder of `folders` stands. Between 3 and 10 November the prompt named
 * the folders and no file in them: no lane 20 or lane 29 session opened `answers.txt`, which holds
 * the repeat spread both lanes rebuilt, and no lane 17 session opened `nearness.txt`. A length
 * beside each name lets a session open a short file whole and search a long one.
 */
export function derivedMap(
  folders: readonly { readonly name: string; readonly dir: string }[],
  readers: readonly Reader[] = READERS,
): string {
  const held = folders.filter(({ dir }) => existsSync(dir));
  if (held.length === 0) return "";
  const where = held.map(({ name, dir }) => `\`${name}\` in \`${dir}/\``).join(", ");
  return [
    `Each campaign's folder (${where}) holds one file a reader. The last column is the file's lines${held.length === 1 ? "" : ", a campaign in that order"}.`,
    "",
    "| file | holds | lines |",
    "| --- | --- | --- |",
    ...readers.map(
      ({ name, answers }) =>
        `| \`${name}.txt\` | ${answers} | ${held.map(({ dir }) => linesOf(join(dir, `${name}.txt`))).join(" / ")} |`,
    ),
  ].join("\n");
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
