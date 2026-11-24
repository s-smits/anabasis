/**
 * Deterministic campaign readers (`READERS`, `wri.ts reader <name>`), written atomically into
 * `data/derived/<campaign>@<path>/` (skipped unless log, reading commit, or reader list moved;
 * `--force` re-derives). In-process readers share one parse of the log; external readers (`args`)
 * run bounded with no credentials and `ANA_HOP=1`. `pass.ts` runs `at`-tagged readers for pulse.
 */
import { conditionLines } from "#skills/campaign-mechanics/scripts/conditions.ts";
import { campaignEnding, endingLines } from "#skills/campaign-mechanics/scripts/ending.ts";
import { drawLines } from "#skills/comparison-reading/scripts/draw.ts";
import { readingLines, ZONE_HEADER, zoneRows } from "#skills/comparison-reading/scripts/reading.ts";
import { starterLines } from "#skills/comparison-reading/scripts/starter-reads.ts";
import { formatBuilderView } from "#skills/design-and-seats/scripts/builder-view.ts";
import { examinerCounts, examinerEach } from "#skills/design-and-seats/scripts/examiner-view.ts";
import { ambitionLines } from "#skills/examiner-complexity/scripts/ambition.ts";
import { csvLines, draftRows as examRows, EXAMS_HEADER } from "#skills/examiner-complexity/scripts/exams.ts";
import { lastHost } from "#src/kernel/condition.ts";
import { type EventKind, type LogEvent, TRACE_KINDS } from "#src/kernel/log.ts";
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
import { callRows, sequenceRows } from "./calls.ts";
import { checkRows, programOnDisk } from "./checks.ts";
import { climbText } from "./climb.ts";
import { draftAuditRows, groundingRows, seatSummaryRows, wallAuditRows } from "./components.ts";
import { continuityRows } from "./continuity.ts";
import { deliverableRows } from "./deliverables.ts";
import { diagnosticRows } from "./diagnostics.ts";
import { draftRows } from "./drafted.ts";
import { epochSpendLines } from "./epoch-spend.ts";
import { executionRows } from "./execution.ts";
import { indexOf } from "./folds.ts";
import { gamingRows } from "./gaming.ts";
import { WRI } from "./index.ts";
import { launchLines } from "./launches.ts";
import { nameRows } from "./names.ts";
import { pairRows } from "./pairs.ts";
import { portabilityRows } from "./portability.ts";
import { practiceRows } from "./practice.ts";
import { overview, rendered } from "./read.ts";
import { rejectionRows } from "./rejections.ts";
import { scoreRows } from "./scores.ts";
import { tasksLines } from "./tasks.ts";
import { transferRows } from "./transfer.ts";

/** One parse of a log, which every reader of this process is handed. */
interface Parsed {
  readonly log: string;
  readonly repo: string;
  /** Its whole lines, as `logEvents` reads them. */
  readonly events: readonly LogEvent[];
  /** The same without the seats' turns and calls (`TRACE_KINDS`), which most readers never read. */
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
const FROZEN = "contract.frozen";
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
 * The condition names that code by a digest of its content, which is no commit, and a lane can read
 * one digest against a receipt's commit as two trees. So the line calls it a
 * digest and names the commit the last launch's receipt holds (`receipts`) beside it. A snapshot's
 * log lies under the investigation, not the campaign's tree, so the tree `start` checks out at
 * that commit is asked too, so that the tree that held the code that ran is not called "another
 * tree" and exact source evidence is not discounted.
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

/** Single-campaign read-only readers, likeliest news first (`embeds` run a local model; `at`/`gist`
 *  select moment-level pulse excerpts; whole-log tables stay `derive`-only). */
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
      name: "diagnostics",
      answers:
        "cross-cutting structural warnings: dead harness bins, compaction amnesia, patience burn, validity saturation, step SNR and fragility, Examiner efficiency",
      read: ({ log, events }) => diagnosticRows(events, join(dirname(log), "states")),
    },
    [REPORTED, PROMOTED, EXAMINED, BUILT, ENDED],
    /^\[WARN\]/,
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
  at(
    {
      name: "scores",
      answers:
        "each comparison recounted by task: validity vs objective, A/A halves, answer/objective repetition, practised-family split, and step removals",
      read: ({ events }) => scoreRows(events),
    },
    [REPORTED],
  ),
  at(
    {
      name: "starter-reads",
      answers: "each starter comparison after a promotion, its tally split by where each task came from",
      read: ({ events }) => starterLines(events),
    },
    [REPORTED],
  ),
  at(
    {
      name: "transfer",
      answers:
        "2x2 starter-read matrix (task origin x practised family before promotion), post-promotion batches, and Builder practice/band discipline",
      read: ({ events }) => transferRows(events),
    },
    [REPORTED, PROMOTED],
    /^transfer totals/,
  ),
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
    read: ({ events }) => formatBuilderView(events),
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
      name: "deliverables",
      answers:
        "deliverable file-artifact capture per comparison arm and role, draft file references, cap hits, and file:* Referee probes",
      read: ({ quiet }) => deliverableRows(quiet),
    },
    [REPORTED, FROZEN],
    /^draft deliverables:/,
  ),
  at(
    {
      name: "checks",
      answers:
        "one row a check (instrument, rules, controls, refusals, standings), scored pass rate, and human pass-soundness calibration",
      read: ({ log, quiet }) => checkRows(quiet, programOnDisk(log)),
    },
    [FROZEN],
    /^(checks:|pass soundness:|controls read:|the reading's faults:)/,
  ),
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
      name: "execution",
      answers:
        "per comparison side: endings, turns, wall share, tool errors/non-zero exits, compactions, inside-call wait share, pass routes, long calls, queue and load",
      read: ({ events }) => executionRows(indexOf(events)),
    },
    [REPORTED],
  ),
  at(
    {
      name: "continuity",
      answers:
        "compactions with read_opening recovery, resting Examiner multi-ask conversations, and interrupted Builder handovers",
      read: ({ events }) => continuityRows(events),
    },
    [BUILT, EXAMINED, REPORTED],
  ),
  {
    name: "launches",
    answers: "each launch beside its stretch of the log: last event, steps left open, killed endings, gap",
    read: ({ log, events }) => launchLines(log, events),
  },
  {
    name: "aim",
    answers:
      "each Examiner session's reference, friction, family spread, cost per held task, and each side's measures against the author's best",
    read: ({ events }) => aimRows(events),
  },
  at(
    {
      name: "drafted",
      answers:
        "how the exam was drafted: each draft and its faults, the standing draft's counts, admitted checks",
      read: ({ events }) => draftRows(events),
    },
    [FROZEN],
    /^(standing draft|shape faults|checks:)/,
  ),
  at(
    {
      name: "draft-audit",
      answers:
        "adversarial draft auditor passes (`referee.draft`), finding kinds, refusals, spend/turns, and unverified final-pass cap leaks",
      read: ({ events }) => draftAuditRows(events),
    },
    [FROZEN],
    /^draft-audit:/,
  ),
  at(
    {
      name: "grounding",
      answers:
        "verifier tool provenance (`host-tools.json`, staged `.toolchain/bin/`, author vs admitted checks) and `faulty`/verifier non-result counts",
      read: ({ log, events }) => groundingRows(events, join(dirname(log), "exams")),
    },
    [FROZEN, REPORTED],
    /^grounding:/,
  ),
  at(
    {
      name: "wall-audit",
      answers:
        "runtime cross-seat wall boundary signals in Builder/Examiner traces and cross-arm `solve.finished.network` parity",
      read: ({ events }) => wallAuditRows(events),
    },
    [REPORTED, ENDED],
    /^(wall-audit|network-parity):/,
  ),
  at(
    {
      name: "seats",
      answers:
        "unified per-role agentic component ledger (runs, turns, calls, errors, anomalies, spend share) and post-pause comparison overshoots",
      read: ({ events }) => seatSummaryRows(events),
    },
    [PROMOTED, ENDED],
    /^seats:/,
  ),
  at(
    {
      name: "gaming",
      answers:
        "cross-component reward-hacking and specification-gaming leads across draft, referee.draft, examiner, builder, solver, and referee",
      read: ({ events }) => gamingRows(events),
    },
    [FROZEN, REPORTED, ENDED],
    /^gaming:/,
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
  at(
    {
      name: "epoch-spend",
      answers:
        "each epoch's billed dollars by role, active vs wall hours, billing residual, unpriced compactions, and $/promotion",
      read: ({ events }) => epochSpendLines(events),
    },
    [PROMOTED, ENDED],
    /^economy summary:/,
  ),
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
  at(
    {
      name: "portability",
      answers:
        "static export-readiness audit of each kept harness: host paths, shebangs, bin modes, broken links, exam-key coupling, and guide/tool weight",
      read: ({ log, events }) => portabilityRows(events, join(dirname(log), "states")),
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
  {
    name: "history",
    answers:
      "same-domain version-over-version backtracking weighted by release gap (direct/near runs with stored syntheses & outside reads, mid cohort rollups, distant background)",
    args: (log) => [WRI, "backtrack", "--log", log],
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
    return { log, repo, events, quiet: events.filter(({ kind }) => !TRACE_KINDS.has(kind)), size };
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
 *  a snapshot or a second copy, since its files would describe the live log under the snapshot's
 *  name. */
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
 *  name alone is no key, since each would replace the other's folder. */
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
 * lane's prompt; "" where no folder of `folders` stands. Naming the folders and no file in them
 * leaves lanes rebuilding what a file such as `scores.txt` or `nearness.txt` already holds. A
 * length beside each name lets a session open a short file whole and search a long one.
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
