/**
 * Every deterministic reader of a campaign's record, run over its log into one folder a campaign, so
 * a person or a session opens a file instead of running forty commands. The operator asked for it on
 * 30 October: the readers run quietly over every run whose log moved, while it runs and after it,
 * and an investigation's `start` runs them too. A folder is replaced whole with what the readers say
 * of the log as it stands, never appended to, so no file in it describes another moment of the log
 * than the rest; a folder whose log, and the commit that reads it, have not moved is left as it is.
 * A reader's code changed without a commit is not seen, so `--force` derives again.
 *
 * `READERS` is the one list of them, and `wri.ts reader <name>` prints any one. Most are a function
 * of the log's events, called in this process on one parse of the log: until 11 November each was a
 * command of its own that parsed the log again, and the 27 of them took 277 s on the largest log
 * (96 MB), where one parse takes a fraction of a second. A reader that needs more than the log
 * (a campaign found by its name in the registry, every campaign beside it, the embedding model, or
 * every kept harness) keeps a process of its own, named by its `args`, under a time limit, with no
 * credential in its environment and with `ANA_HOP=1`, under which it reaches no other host.
 * `pass.ts` runs for the pulse those that name a moment (`at`).
 *
 * The folders sit under the main worktree's `data/derived/`, which git ignores: the readers print
 * hidden values as the log holds them, so they stay on the exam side with the archive. A reader that
 * fails leaves its failure in its file and is named; the others still run.
 */
import { conditionLines } from "#skills/campaign-mechanics/scripts/conditions.ts";
import { campaignEnding, endingLines } from "#skills/campaign-mechanics/scripts/ending.ts";
import { drawLines } from "#skills/comparison-reading/scripts/draw.ts";
import { readingLines, ZONE_HEADER, zoneRows } from "#skills/comparison-reading/scripts/reading.ts";
import { starterLines } from "#skills/comparison-reading/scripts/starter-reads.ts";
import { builderTold } from "#skills/design-and-seats/scripts/builder-view.ts";
import { examinerCounts, examinerEach } from "#skills/design-and-seats/scripts/examiner-view.ts";
import { ambitionLines } from "#skills/examiner-complexity/scripts/ambition.ts";
import { csvLines, draftRows as examRows, EXAMS_HEADER } from "#skills/examiner-complexity/scripts/exams.ts";
import { lastHost } from "#src/kernel/condition.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
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
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { pooled } from "#src/meta/pool.ts";
import { capturedExecPath, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { runCaptured } from "#src/meta/subprocess.ts";
import { atCommit } from "#tools/runs/code.ts";
import { degradationLines } from "#tools/runs/degradations.ts";
import { receipts } from "#tools/runs/receipt.ts";
import { CLI, logEvents, readNamed } from "#tools/runs/registry.ts";
import { hostOf } from "#tools/runs/seed.ts";
import { aimRows } from "./aim.ts";
import { answerRows } from "./answers.ts";
import { budgetRows } from "./budget.ts";
import { callRows, sequenceRows } from "./calls.ts";
import { checkRows, programOnDisk } from "./checks.ts";
import { climbText } from "./climb.ts";
import { compactionRows } from "./compactions.ts";
import { draftRows } from "./drafted.ts";
import { epochSpendLines } from "./epoch-spend.ts";
import { indexOf, NO_TRACES } from "./folds.ts";
import { launchLines } from "./launches.ts";
import { nameRows } from "./names.ts";
import { pairRows } from "./pairs.ts";
import { practiceRows } from "./practice.ts";
import { overview, rendered } from "./read.ts";
import { rejectionRows } from "./rejections.ts";
import { routeRows } from "./routes.ts";
import { scoreRows } from "./scores.ts";
import { tasksLines } from "./tasks.ts";
import { waitRows } from "./waits.ts";

/** One parse of a log, which every reader of this process is handed. */
interface Parsed {
  readonly log: string;
  readonly repo: string;
  /** Its whole lines, as `logEvents` reads them. */
  readonly events: readonly LogEvent[];
  /** The same without the seats' turns and calls (`NO_TRACES`), which most readers never read. */
  readonly quiet: readonly LogEvent[];
  /** The log's bytes when it was read, so no more than the events cover. */
  readonly size: number;
}

/** A log and the parse of it, made at the first reader that asks. */
export interface Source {
  readonly log: string;
  readonly repo: string;
  readonly parsed: () => Parsed;
}

interface About {
  readonly name: string;
  /** What its file holds, in a line a lane's prompt prints beside the file's name (`derivedMap`). */
  readonly answers: string;
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

/** A reader called in this process on the parsed log. */
interface InProcess extends About {
  readonly read: (parsed: Parsed) => readonly string[];
}

/** A reader that needs more than the log: its script and arguments, from the repository's root, for
 *  a log's absolute path and the repository's. */
interface OwnProcess extends About {
  readonly args: (log: string, repo: string) => readonly string[];
}

export type Reader = InProcess | OwnProcess;

export interface Derived {
  readonly name: string;
  readonly dir: string;
  /** Whether the readers ran this time, rather than a folder for the same log being kept. */
  readonly ran: boolean;
  /** The readers that failed. */
  readonly failed: readonly string[];
}

const SKILLS = ".claude/skills";
const TUNER = `${SKILLS}/promotion-tuner/scripts`;
const MANIFEST = "manifest.json";
/** Readers of their own process at once: the job that runs them shares its host with live campaigns. */
const WIDTH = 4;
const READER_MS = 180_000;
const REPORTED = "comparison.reported";
const PROMOTED = "harness.promoted";
const ENDED = "campaign.ended";
const EXAMINED = "exam.finished";
const STARTED = "comparison.started";
const BUILT = "build.finished";
/** No call left out, as `calls.ts` reads without a flag. */
const EVERY_CALL = { harness: null, program: null, command: null, output: null };

/** `reader`, run for the pulse too, once an event of `kinds` lies past what it last read; `gist`
 *  as `About.gist` has it. */
const at = <Each extends Reader>(reader: Each, kinds: readonly EventKind[], gist?: RegExp): Each => ({
  ...reader,
  at: kinds,
  ...keyIfDefined("gist", gist),
});

/** The campaign's name, which its log's folder carries. */
const campaignOf = (log: string) => basename(dirname(log));

/** A reader of its own process that names its campaign instead of its log. */
const namedReader = (
  name: string,
  answers: string,
  script: string,
  before: readonly string[],
  after: readonly string[] = [],
): OwnProcess => ({
  name,
  answers,
  args: (log: string) => [script, ...before, campaignOf(log), ...after],
  named: true,
});

/**
 * One line on where the code the campaign last ran under stands: this checkout, or the tree the
 * campaign runs in (`<tree>/.ana/d2/<campaign>/log.jsonl`), which a live campaign keeps unmoved.
 * The condition names that code by a digest of its content, which is no commit: two lanes of
 * 14 October read one digest against a receipt's commit as two trees. So the line calls it a
 * digest and names the commit the last launch's receipt holds (`receipts`) beside it. A snapshot's
 * log lies under the investigation, not the campaign's tree, so the tree `start` checks out at
 * that commit is asked too: on 7 November the esp32 investigation's line called that tree, which
 * held the code that ran, "another tree", and three lanes discounted exact source evidence.
 */
function hostLine(log: string, events: readonly LogEvent[], repo: string): string {
  const last = lastHost(events);
  const here = hostOf(repo) ?? "";
  const launch = receipts(log).at(-1);
  const commit =
    launch === undefined
      ? "; no launch receipt beside the log"
      : `; the last launch's receipt names commit ${launch.commit.slice(0, 8)}${launch.dirty ? ", from a dirty tree" : ""}`;
  const said = (line: string) =>
    `host-code digest (of src, vendor and package.json, not a commit): ${line}${commit}`;
  if (last === undefined) return said(`no condition in the log; this checkout's is ${here.slice(0, 8)}`);
  if (last === here) return said(`the last condition's and this checkout's are both ${here.slice(0, 8)}`);
  const trees = [
    resolve(dirname(log), "..", "..", ".."),
    ...(launch === undefined ? [] : [atCommit(repo, launch.commit)]),
  ];
  const tree = trees.find((each) => hostOf(each) === last);
  return tree === undefined
    ? said(
        `the last condition's is ${last.slice(0, 8)} and this checkout's is ${here.slice(0, 8)}, so every statement about source is about another tree`,
      )
    : said(
        `the last condition's is ${last.slice(0, 8)}, which \`${tree}\` holds as it stands, so read source there; this checkout's is ${here.slice(0, 8)}`,
      );
}

/** The six rows and every trigger with the lane it starts, then the host line (`wri.ts read`). */
export function overviewText(log: string, events: readonly LogEvent[], repo: string): string {
  return `${rendered(overview(events, receipts(log)))}\n\n${hostLine(log, events, repo)}\n`;
}

/** The readers that take one campaign and print what it holds, calling no paid model and writing
 *  nothing of the campaign's, the likeliest news first. Those marked `embeds` run a local model and
 *  keep their vectors in the reader store, and come after all but the readers of kept harnesses, as a
 *  first read is the longest and their news the least likely. Each moment's readers (`at`) come
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
      read: ({ log, events, repo }) => [overviewText(log, events, repo)],
    },
    [REPORTED, PROMOTED, EXAMINED, BUILT, ENDED],
  ),
  at(
    {
      name: "ending",
      answers: "why the campaign stopped, and the move and log line that ended it",
      read: ({ log, events }) => [log, ...endingLines(campaignEnding(events))],
    },
    [BUILT, ENDED],
    /^\d+ events, |patience: /,
  ),
  at(
    {
      name: "readings",
      answers:
        "each comparison's tally, p, wins to spare or losses short, cap, A/A, zone and gap to the best",
      read: ({ events }) => readingLines(events),
    },
    [REPORTED],
  ),
  {
    name: "starter-reads",
    answers: "each starter comparison after a promotion, its tally split by where each task came from",
    read: ({ events }) => starterLines(events),
  },
  {
    name: "degradations",
    answers: "each session or solve a model other than the one asked for served",
    read: ({ log, events }) => [`${campaignOf(log)}: ${degradationLines(events).join("\n")}`],
  },
  at(
    {
      name: "climb",
      answers: "promotions, whether each was confirmed, and the comparisons between them",
      read: ({ log, events }) => [climbText([{ name: campaignOf(log), events }])],
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
        campaignOf(log),
      ],
    },
    [PROMOTED],
  ),
  at(
    {
      name: "conditions",
      answers: "solves by condition and setting, and whether each comparison's sides are comparable",
      read: ({ events }) => conditionLines(events),
    },
    [STARTED],
  ),
  {
    name: "tasks",
    answers: "every scored task as its author wrote it and the comparisons that scored it, no outcome",
    read: ({ events }) => tasksLines(events),
  },
  at(
    {
      name: "draw",
      answers:
        "the held-out pool, the next comparison's draw, admission's floor, the smallest tallies that step",
      read: ({ events }) => drawLines(events),
    },
    [STARTED, EXAMINED],
    /^(held-out pool|next comparison|admission)/,
  ),
  {
    name: "builder-view",
    answers: "what the Builder's next opening would be told",
    read: ({ events }) => builderTold(events),
  },
  {
    name: "examiner-view",
    answers: "what the Examiner's next opening would be told",
    read: ({ events }) => examinerCounts(events),
  },
  at(
    {
      name: "ambition",
      answers:
        "hours, solves and dollars to the first comparison and promotion; each Examiner session's yield",
      read: ({ log, events }) => ambitionLines(campaignOf(log), events),
    },
    [EXAMINED],
  ),
  {
    name: "exams",
    answers: "one row a session and task family: drafts, held, refused, no room, proved",
    read: ({ log, events }) => [EXAMS_HEADER, ...csvLines(campaignOf(log), examRows(events, "grouped"))],
  },
  at(
    {
      name: "zone",
      answers:
        "per comparison, tasks the reference answers never, in some solves or always, and untied by what",
      read: ({ log, events }) => [
        ZONE_HEADER,
        ...zoneRows(campaignOf(log), events).map((row) => row.join("\t")),
      ],
    },
    [REPORTED],
  ),
  at(
    {
      name: "answers",
      answers:
        "per comparison, tasks where a side's passes repeated one answer, and the objective's repeat spread",
      read: ({ quiet }) => answerRows(quiet),
    },
    [REPORTED],
  ),
  {
    name: "waits",
    answers: "per comparison, the median share of a solve spent inside tool calls, by side and ending",
    read: ({ events }) => waitRows(indexOf(events)),
  },
  {
    name: "routes",
    answers: "per comparison, the median calls a pass and the distinct tool orders, by side",
    read: ({ events }) => routeRows(indexOf(events)),
  },
  {
    name: "checks",
    answers: "one row a check: rating, rules, controls, refusals by side and asker, whether it stands",
    read: ({ log, quiet }) => checkRows(quiet, programOnDisk(log)),
  },
  at(
    {
      name: "rejections",
      answers:
        "one row a rejected solve: the refusing checks, the ruling and its probes, a label, what stands",
      read: ({ quiet }) => rejectionRows(quiet),
    },
    [REPORTED],
  ),
  {
    name: "pairs",
    answers:
      "a row a task a comparison: solves, diff, A/A, ratio to best, tie kind; tallies by writer and family",
    read: ({ quiet }) => pairRows(quiet),
  },
  at(
    {
      name: "budget",
      answers: "each comparison side's endings, turns and seconds against the bound, long calls, queue, load",
      read: ({ events }) => budgetRows(indexOf(events)),
    },
    [REPORTED],
  ),
  {
    name: "compactions",
    answers: "each compaction's tokens, seconds, error and priced usages, and each session's sum",
    read: ({ events }) => compactionRows(events),
  },
  {
    name: "launches",
    answers: "each launch beside its stretch of the log: last event, steps left open, killed endings, gap",
    read: ({ log, events }) => launchLines(log, events),
  },
  {
    name: "scores",
    answers:
      "each comparison recounted by task: tallies by measure, A/A halves, a step's removals and writers",
    read: ({ events }) => scoreRows(events),
  },
  {
    name: "aim",
    answers:
      "what each Examiner session could read and wrote, and each side's measures against the author's best",
    read: ({ events }) => aimRows(events),
  },
  at(
    {
      name: "drafted",
      answers:
        "how the exam was drafted: each draft and its faults, the standing draft's counts, admitted checks",
      read: ({ events }) => draftRows(events),
    },
    ["contract.frozen"],
    /^(standing draft|shape faults|checks:)/,
  ),
  {
    name: "wakes",
    answers: "each Examiner session's opening or wake rebuilt by this tree, against the one on record",
    read: ({ events }) => examinerEach(events),
  },
  {
    name: "practice",
    answers: "one row a practice solve: its harness's role, its ending and what the state moved",
    read: ({ events }) => practiceRows(events),
  },
  {
    name: "calls",
    answers: "per harness, side and program: calling solves, calls, errors and non-zero exits",
    read: ({ events }) => callRows(events, EVERY_CALL),
  },
  {
    name: "sequences",
    answers: "test-side passes by family and harness: distinct program sequences and the commonest's share",
    read: ({ events }) => sequenceRows(events, EVERY_CALL),
  },
  {
    name: "epoch-spend",
    answers: "each epoch's billed dollars by role, and what the comparisons it reported billed",
    read: ({ events }) => epochSpendLines(events),
  },
  {
    name: "restated",
    answers: "which Referee reasons say the same thing",
    args: (log) => ["tools/wri/restated.ts", log],
    embeds: true,
  },
  {
    name: "nearness",
    answers: "how alike each session's tasks read to earlier ones: wording, never dependence",
    args: (log) => ["tools/wri/nearness.ts", log],
    embeds: true,
  },
  at(
    {
      name: "names",
      answers: "where a kept harness's own files name a task or copy six words of its public input",
      read: ({ log, events }) => nameRows(events, join(dirname(log), "states")),
    },
    [PROMOTED],
  ),
  {
    name: "versions",
    answers: "each kept harness, its parent, and what moved between them",
    args: (log) => [`${SKILLS}/harness-audit/scripts/harness-versions.ts`, log],
  },
  {
    name: "chain",
    answers: "the harness lineage with outcomes withheld, for a blind review",
    args: (log) => [`${SKILLS}/harness-audit/scripts/harness-versions.ts`, log, "--blind"],
  },
];

/** The list `derive` runs: `--no-embed` takes out the readers that load the model. */
export const readersOf = (flags: { readonly "no-embed"?: boolean | undefined }): readonly Reader[] =>
  flags["no-embed"] === true ? READERS.filter(({ embeds }) => embeds !== true) : READERS;

/** The log at `log`, parsed at the first reader that asks and kept for the rest. */
export function sourceOf(log: string, repo: string): Source {
  let once: Parsed | undefined;
  const parse = (): Parsed => {
    const { size } = Bun.file(log);
    const events = logEvents(log);
    return { log, repo, events, quiet: events.filter(({ kind }) => !NO_TRACES.has(kind)), size };
  };
  return { log, repo, parsed: () => (once ??= parse()) };
}

/** The log the registry gives the campaign `name`, or null where it names none or several. */
function namedLog(name: string, repo: string): string | null {
  try {
    return readNamed(name, repo).path;
  } catch {
    return null;
  }
}

/** What a reader of its own process says of `log`, with its ending and stderr added where it failed. */
async function ownProcess(reader: OwnProcess, { log, repo }: Source, timeout: number) {
  const { PATH, HOME } = runtimeProcess.env;
  const { size } = Bun.file(log);
  const ran = await runCaptured([capturedExecPath, ...reader.args(log, repo)], {
    cwd: repo,
    timeout,
    env: { ...keyIfDefined("PATH", PATH), ...keyIfDefined("HOME", HOME), ANA_HOP: "1" },
  });
  const ok = ran.exitCode === 0;
  const ending = ok ? "" : `\n-- ${reader.name} ended ${ran.signal ?? `with exit ${String(ran.exitCode)}`}\n`;
  const stderr = ran.stderr.trim() === "" ? "" : `\n-- stderr\n${ran.stderr}`;
  return { text: `${ran.stdout}${ending}${stderr}`, ok, cut: ran.signal !== null, size };
}

/** What `reader` says of the log, and the log's bytes it read. A failure ends its text on a line
 *  naming it; `cut` is a reader of its own process its time limit ended, so what it would have said
 *  is unknown. A reader that finds its campaign by name is not run on a log the name does not find,
 *  a snapshot or a second copy: on 10 November six files of a snapshot's folder described the live
 *  log, 294 events on, under the snapshot's name. */
export async function readerOutput(
  reader: Reader,
  source: Source,
  timeout = READER_MS,
): Promise<{ text: string; ok: boolean; cut: boolean; size: number }> {
  if (reader.named === true) {
    const name = campaignOf(source.log);
    const found = namedLog(name, source.repo);
    if (found !== source.log) {
      const text = `not read: ${reader.name} finds a campaign by its name, and ${name} names ${found ?? "no one campaign here"}, not ${source.log}\n`;
      return { text, ok: true, cut: false, size: Bun.file(source.log).size };
    }
  }
  if ("args" in reader) return await ownProcess(reader, source, timeout);
  try {
    const parsed = source.parsed();
    return { text: `${reader.read(parsed).join("\n")}\n`, ok: true, cut: false, size: parsed.size };
  } catch (error) {
    const stack = error instanceof Error ? `${error.stack ?? ""}\n` : "";
    const text = `${stack}-- ${reader.name} failed: ${errorMessage(error)}\n`;
    return { text, ok: false, cut: false, size: Bun.file(source.log).size };
  }
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
  const name = campaignOf(log);
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
  const source = sourceOf(log, repo);
  const ended = new Set<string>();
  const write = async (reader: Reader) => {
    const { text, ok } = await readerOutput(reader, source);
    writeFileSync(join(work, `${reader.name}.txt`), text);
    if (!ok) ended.add(reader.name);
  };
  // The readers of their own process start first and run while this one reads the rest: on the
  // largest log the two that open every kept harness take minutes, and the others take seconds
  // together. A pause before each reader here lets a spawned one's ending start the next.
  const here = async () => {
    for (const reader of readers.filter((each) => !("args" in each))) {
      await Bun.sleep(0);
      await write(reader);
    }
  };
  await Promise.all([
    pooled(
      readers.filter((each) => "args" in each),
      WIDTH,
      write,
    ),
    here(),
  ]);
  const failed = readers.map((reader) => reader.name).filter((reader) => ended.has(reader));
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
  join(root, `${campaignOf(log)}@${hashJsonValue(log).slice(0, 12)}`);

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
