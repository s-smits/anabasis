/**
 * The whole-run investigation of one campaign, a verb a step. It reads a log and writes only under
 * the investigation's own directory, which belongs under the ignored `.ana/wri/`.
 *
 *   bun tools/wri/wri.ts read --log .ana/d2/truss/log.jsonl      (or `read <log | campaign folder | name>`)
 *   bun tools/wri/wri.ts climb --log .ana/d2/truss/log.jsonl[,<log>,<log>]
 *   bun tools/wri/wri.ts trajectory --log <log>[,<log>...] [--grades <report>[,<report>]] [--hours 2,4,8]
 *   bun tools/wri/wri.ts packets --log <log>,<log>[,...] --out <dir> [--graders 2]
 *   bun tools/wri/wri.ts packets --out <dir> --join
 *   bun tools/wri/wri.ts start --log .ana/d2/truss/log.jsonl[,<log>,<log>] --out .ana/wri/20261008-truss [--snapshot]
 *   bun tools/wri/wri.ts lanes --out .ana/wri/20261008-truss [--lanes 1-4,7] [--agents 3] [--regroup]
 *   bun tools/wri/wri.ts collect --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts synthesis --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts grade --log .ana/d2/truss/log.jsonl [--bundle <pack>] --task <taskId> --answer <file> [--set <path>=<json>]...
 *   bun tools/wri/wri.ts grade --log <log> [--bundle <pack>] --solve <id> [--set <path>=<json>]...
 *   bun tools/wri/wri.ts grade --log <log> [--bundle <pack>] --answers <dir>
 *   bun tools/wri/wri.ts derive (--log <log>[,<log>...] | --all) [--verbose] [--force] [--no-embed]
 *   bun tools/wri/wri.ts reader <name> --log <log>
 *   bun tools/wri/wri.ts index [--root <dir>] [--out <file>]
 *
 * - `climb` prints lane 22's columns for every log `--log` names, one row each, and the paths
 *   under the host's `/tmp` one campaign named before another's solve ran them. It reads the logs as they stand, so it can be run on campaigns still running.
 * - `trajectory` prints how far each campaign had got at each work hour, on the rulers its runs
 *   share (`tools/wri/trajectory.ts`), with lane 27's blind grades where `--grades` names them.
 * - `packets` writes lane 27's blind packets for several graders across campaigns, and with `--join`
 *   reads their reports into `grades.tsv` for `trajectory --grades` (`tools/wri/packets.ts`).
 * - `read` prints the six rows and every trigger with the lane it starts (`tools/wri/read.ts`), and
 *   the host hash of the last condition beside this checkout's, and beside the campaign's own
 *   tree's when this checkout's differs.
 * - `start` writes that as `overview.md`, and the shared instructions with each campaign's row
 *   filled in and three sections left for the primary to write. `--log` names one campaign or several,
 *   which the investigation reads as equals: every lane reads every one, and opens where a trigger
 *   fired on any of them (`tools/wri/investigation.ts`). It refuses a log a campaign may still
 *   write; with `--snapshot` it reads a frozen copy of each such log instead, under
 *   `<out>/snapshot/<name>/` (`snapshotCampaign`, `tools/runs/seed.ts`), and every later verb reads
 *   that copy.
 * - `lanes` builds one prompt per lane, and `launch.json`, the manifest codex-gpt-swarm's launcher
 *   reads: the lanes it built packed into `--agents N` sessions (4 by default, one a lane where
 *   fewer), each lane in exactly one, a label kept whole unless the lightest session would weigh
 *   under three quarters of the heaviest, and each isolated lane a session of its own. With no `--lanes` it opens the lanes a trigger
 *   started and the standing ones; an isolated lane is built only when named. A prompt built before
 *   is kept and launched again by nobody: `launch.json` holds only what this call built. With
 *   `--regroup` the lanes built before whose report is not yet written are packed again with the
 *   new ones into a new manifest, their prompts unchanged, for a new `--agents N`; the caller must
 *   first stop every session still working on those prompts, since the new manifest starts them
 *   again. With `--high K` the K heaviest sessions carry `"effort": "high"` and the rest `"medium"`,
 *   which the launcher takes over its `--reasoning-effort`. `lanes` creates `<out>/lanes` where it is missing.
 * - `collect` holds every expected report to its shape and writes `reports.md`. It exits 1 until
 *   every report is there and valid.
 * - `synthesis` renders the synthesis session's prompt over the reports as they stand.
 * - `derive` runs every deterministic reader of one log over it (`READERS`, `tools/wri/derive.ts`)
 *   into the main worktree's `data/derived/<campaign>@<path>/`, one folder a log path and one file
 *   a reader, replacing the folder whole where the log or the reading commit moved. It prints one line; `--verbose` prints every
 *   file as well, for a session that wants to read them all. `--all` takes every campaign this
 *   machine reads (`readable`, `tools/runs/registry.ts`), which is how a job keeps them current.
 *   `start` derives its logs the same way, quietly, and names the folders in the instructions.
 * - `reader` prints what one of those readers says of one log, the text `derive` writes to its
 *   file, and exits 1 where it failed.
 * - `index` reads every investigation under `--root` (the main worktree's `.ana/wri/` by default)
 *   and writes one page over them to `--out` (`<root>/INDEX.md`): a row a folder, newest first,
 *   then each campaign group's binding constraints in time order, each cycle folder and prediction
 *   ledger there and in the main checkout's `notes/`, and each campaign whose log moved in the last
 *   fourteen days, then each pull request a `plan.md` or a fork's `forkedPR<N>` names, with its forks'
 *   per-run ledgers read (`tools/wri/index.ts`). It prints each section's row count and how many
 *   folders it read whole, in part or not at all, and never the page, which holds hidden values.
 * - `grade` puts answers to the campaign's own checker and prints each verdict in one line, with the
 *   command that repeats it: one file against `--task`, the answer a solve's verdict holds (`--solve`,
 *   beside the recorded verdict), either with fields replaced (`--set`, which refuses a path the answer
 *   lacks and a change of JSON type), or every file of a folder (`--answers`) with each one's sha256
 *   (`tools/wri/grade.ts`). It writes nothing and logs nothing.
 *
 * A log is named by its path or, since 15 October, by its campaign's whole name in any of the
 * repository's worktrees (`runNamed`). No verb starts a solve, a session
 * or a round, and none appends to a log.
 */
import { LOG_FILE, read } from "#src/kernel/log.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { mainTree } from "#src/meta/git.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { plural } from "#src/meta/text.ts";
import { treeAt } from "../runs/code.ts";
import { lastHost } from "#src/kernel/condition.ts";
import { receipts } from "../runs/receipt.ts";
import { isCampaign, processes, readable, type Running } from "../runs/registry.ts";
import { stillRunning } from "../runs/diagnosis.ts";
import { hostOf, snapshotCampaign } from "../runs/seed.ts";
import {
  type Derived,
  derive,
  derivedLine,
  derivedMap,
  derivedOf,
  derivedText,
  folderOf,
  overviewText,
  READERS,
  readerOutput,
  readersOf,
  sourceOf,
} from "./derive.ts";
import { logAcross } from "../runs/snapshots.ts";
import { catalogueText, lanesOf, ownersOf, REFERENCES } from "./catalogue.ts";
import { climbText } from "./climb.ts";
import {
  blankSections,
  type Campaign,
  filled,
  lanePrompt,
  movedTo,
  numbersOf,
  reportIndex,
  reportOf,
  reportPath,
  selected,
  sessionsOf,
  sharedPrompt,
  stem,
  weightOf,
} from "./investigation.ts";
import { INVESTIGATION, investigationIndex, REPORTS, SHARED } from "./index.ts";
import { overview } from "./read.ts";
import { buildPackets, joinPackets } from "./packets.ts";
import { gradesIn, HOURS, trajectoryText } from "./trajectory.ts";
import { grade } from "./grade.ts";

interface Investigation {
  readonly out: string;
  readonly shared: string;
  readonly campaigns: readonly Campaign[];
}

const REPO = resolve(import.meta.dir, "..", "..");
const USAGE =
  "usage: bun tools/wri/wri.ts read | climb | trajectory | start | lanes | collect | synthesis | grade | derive | reader | index";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    log: { type: "string" },
    out: { type: "string" },
    root: { type: "string" },
    lanes: { type: "string" },
    agents: { type: "string" },
    high: { type: "string" },
    regroup: { type: "boolean" },
    bundle: { type: "string" },
    task: { type: "string" },
    answer: { type: "string" },
    solve: { type: "string" },
    set: { type: "string", multiple: true },
    answers: { type: "string" },
    all: { type: "boolean" },
    verbose: { type: "boolean" },
    force: { type: "boolean" },
    "no-embed": { type: "boolean" },
    snapshot: { type: "boolean" },
    grades: { type: "string" },
    graders: { type: "string" },
    join: { type: "boolean" },
    hours: { type: "string" },
    help: { type: "boolean" },
  },
});

/** Every log `--log` names, comma-separated, or the ones written after the verb where it names
 *  none, as the other readers take them; `reader`'s own positional is the reader's name. */
const namedLogs = values.log ?? (positionals[0] === "reader" ? "" : positionals.slice(1).join(","));
const resolvedLogs = await Promise.all(
  namedLogs
    .split(",")
    .filter((each) => each !== "")
    .map(async (each) => resolve(await logAcross(each))),
);
/** A campaign's name, and its copy's host folder where two `logs` share the name (27 October). */
const nameOf = (log: string, logs: readonly string[] = resolvedLogs) => {
  const name = basename(dirname(log));
  const shared = logs.filter((each) => basename(dirname(each)) === name).length > 1;
  return shared ? `${name}@${basename(dirname(dirname(log)))}` : name;
};

function oneLog(): string {
  const [log] = resolvedLogs;
  if (log === undefined || resolvedLogs.length !== 1) throw new Error("name one --log");
  return log;
}

function needed(name: "log" | "out"): string {
  const value = name === "log" ? namedLogs || undefined : values.out;
  if (value === undefined) throw new Error(`name --${name}`);
  return value;
}

/** The folders `derive` keeps for `logs`, written or kept as they stand, and the line it prints. */
async function derived(logs: readonly string[]): Promise<{ done: Derived[]; line: string }> {
  const root = derivedOf(REPO);
  const done: Derived[] = [];
  // One campaign at a time: the job that runs this shares its host with live campaigns.
  const readers = readersOf(values);
  for (const log of logs) {
    done.push(await derive(log, { root, repo: REPO, force: values.force === true, readers }));
  }
  return { done, line: derivedLine(done, root) };
}

async function deriveStep(): Promise<number> {
  const logs =
    values.all === true
      ? readable(REPO)
          .filter((run) => isCampaign(run) && run.seed !== true)
          .map(({ path }) => path)
      : resolvedLogs;
  if (logs.length === 0) throw new Error("name --log or --all");
  const { done, line } = await derived(logs);
  if (values.verbose === true) console.log(derivedText(done));
  console.log(line);
  return done.some(({ failed }) => failed.length > 0) ? 1 : 0;
}

/** What the reader `name` says of the one log `--log` names, as `derive` writes it to its file. */
async function oneReader(name: string | undefined): Promise<number> {
  const reader = READERS.find((each) => each.name === name);
  if (reader === undefined) {
    throw new Error(`name a reader: ${READERS.map((each) => each.name).join(", ")}`);
  }
  const { text, ok } = await readerOutput(reader, sourceOf(oneLog(), REPO));
  runtimeProcess.stdout.write(text);
  return ok ? 0 : 1;
}

/** The logs among `logs` that a campaign may still write: a log the registry does not list has no
 *  campaign command writing it. */
function liveOf(logs: readonly string[], running: readonly Running[]): string[] {
  const known = readable(REPO);
  return logs.filter((log) => {
    const run = known.find(({ path }) => path === log);
    return run !== undefined && stillRunning(run, running);
  });
}

/**
 * Refuse an investigation of a campaign that may still write its log. The operator's rule of 3
 * November: every lane reads one sheet, so no finding is about events that arrived after another
 * lane read the log. `start --snapshot` reads a frozen copy of each live one instead (4 November).
 */
function refuseRunning(logs: readonly string[], running = processes()): void {
  const live = liveOf(logs, running);
  if (live.length === 0) return;
  const names = live.map((log) => nameOf(log)).join(", ");
  throw new Error(
    `${names} may still write its log: pass --snapshot to read a frozen copy while it runs, or stop it first (\`bun run runs stop <name> --yes\`), so every lane reads one log`,
  );
}

/** Each log, a live one replaced by its frozen copy under `<out>/snapshot/<name>/` (`snapshotCampaign`). */
function frozen(logs: readonly string[], out: string, running: readonly Running[]): string[] {
  const live = new Set(liveOf(logs, running));
  return logs.map((log) => {
    if (!live.has(log)) return log;
    const to = join(out, "snapshot", nameOf(log));
    const { events } = snapshotCampaign(dirname(log), to);
    console.log(`${nameOf(log)}: froze ${String(events)} events into ${to}`);
    return join(to, LOG_FILE);
  });
}

async function start(): Promise<number> {
  needed("log");
  const out = resolve(needed("out"));
  // Every refusal before anything is written: a snapshot is a copy of the run's folder, and until
  // 9 November a log named twice was refused only after it was made.
  if (existsSync(join(out, SHARED))) throw new Error(`${out} already holds ${SHARED}`);
  if (new Set(resolvedLogs.map((log) => nameOf(log))).size < resolvedLogs.length) {
    throw new Error("--log names a log twice");
  }
  const running = processes();
  const logs = values.snapshot === true ? frozen(resolvedLogs, out, running) : resolvedLogs;
  refuseRunning(logs, running);
  mkdirSync(join(out, "lanes"), { recursive: true });
  const { done, line } = await derived(logs);
  // Each launch's tree first, so that the host line can name it: a tree at the commit the last
  // launch ran (`treeAt`), where this checkout's code differs from the code the campaign last ran.
  const here = hostOf(REPO);
  const trees = logs.flatMap((log) => {
    const commit = receipts(log).at(-1)?.commit;
    const tree = commit === undefined || lastHost(read(log)) === here ? null : treeAt(REPO, commit);
    return tree === null
      ? []
      : [
          `- ${nameOf(log)}: the code its last launch ran is checked out at \`${tree}\`, its dependencies installed. Read source there, and run a reader there (\`cd ${tree} && bun tools/...\`) to see what it printed at that commit; the derived files below come from this checkout's code.`,
        ];
  });
  const texts = logs.map((log) => overviewText(log, read(log), REPO));
  const campaigns = [
    "| campaign | log | events | checkout |",
    "| --- | --- | --- | --- |",
    ...logs.map((log) => `| ${nameOf(log)} | \`${log}\` | ${String(read(log).length)} | \`${REPO}\` |`),
    "",
    ...texts.map((text, index) => {
      const host = text.trim().split("\n").at(-1) ?? "";
      return logs.length === 1 ? host : `- ${nameOf(logs[index] ?? "")}: ${host}`;
    }),
    "",
    ...(trees.length > 0 ? [...trees, ""] : []),
    `Every deterministic reader's output for each campaign, as the log stood at this start, is in its folder: ${done.map(({ dir }) => `\`${dir}/\``).join(", ")}, one \`<reader>.txt\` a reader (\`wri.ts derive\`). Read those files before running a reader yourself.`,
  ].join("\n");
  const template = readFileSync(join(REFERENCES, "shared-instructions.template.md"), "utf8");
  const text =
    logs.length === 1
      ? texts.join("")
      : texts.map((each, index) => `## ${nameOf(logs[index] ?? "")}\n\n${each}`).join("\n");
  writeFileSync(join(out, "overview.md"), text);
  writeFileSync(join(out, INVESTIGATION), `${JSON.stringify({ logs }, null, 2)}\n`);
  // The shared instructions last, since a start refuses a folder that holds them: until 9 November
  // they came first, and a start that failed after them left a folder no start or later verb could
  // read. The author's comments stay in the copy: they say what each blank section is for.
  writeFileSync(
    join(out, SHARED),
    template.replace("{campaigns}", () => campaigns),
  );
  console.log(text);
  console.log(line);
  console.log(`wrote ${join(out, SHARED)}: write its three blank sections, then run lanes`);
  return 0;
}

/** The investigation `start` wrote, each campaign read as its log stands now. */
function opened(): Investigation {
  const out = resolve(needed("out"));
  const { logs } = parseJsonAs<{ logs: string[] }>(readFileSync(join(out, INVESTIGATION), "utf8"));
  const campaigns = logs.map((stored) => {
    const log = existsSync(stored) ? stored : movedTo(stored, readable(REPO).filter(isCampaign));
    if (log !== stored) console.log(`${nameOf(stored, logs)}: its stored log is gone, read from ${log}`);
    return { name: nameOf(stored, logs), log, overview: overview(read(log), receipts(log)) };
  });
  // The instructions name each log where `start` found it; a prompt built now names where it stands.
  const shared = campaigns.reduce(
    (text, { log }, index) => text.replaceAll(logs[index] ?? log, log),
    readFileSync(join(out, SHARED), "utf8"),
  );
  return { out, shared, campaigns };
}

/** The campaigns of `logs` side by side in lane 22's columns (`tools/wri/climb.ts`). */
const climbOf = (logs: readonly string[]) =>
  climbText(logs.map((log) => ({ name: nameOf(log), events: read(log) })));

const promptPath = (out: string, lane: number) => join(out, "lanes", `${stem(lane)}-prompt.md`);

function lanes(): number {
  const { out, shared, campaigns } = opened();
  refuseRunning(campaigns.map(({ log }) => log));
  const climb = campaigns.length > 1 ? climbOf(campaigns.map(({ log }) => log)) : "";
  const blank = blankSections(shared);
  if (blank.length > 0) throw new Error(`write these sections of ${SHARED} first: ${blank.join(", ")}`);
  const catalogue = catalogueText();
  const owners = ownersOf(catalogue);
  const named = values.lanes === undefined ? null : numbersOf(values.lanes);
  const { open, isolated, waiting } = selected(
    lanesOf(catalogue),
    campaigns.flatMap(({ overview: { triggers } }) => triggers),
    named,
  );
  // A prompt already built is kept: a report may have been written against it, and `collect` reads
  // the report and never the prompt, so a rebuilt one would change under it unseen. v1 kept an
  // earlier read's lanes (9762afb0) and bound a report to its prompt's bytes (23bdedb8). With
  // `--regroup` a kept prompt with no report yet is launched again, its bytes untouched: on 9 November
  // the operator changed the number of groups after a build, and regrouping took a sibling folder.
  const asked = [...open, ...isolated];
  const kept = asked.filter(
    (lane) =>
      existsSync(promptPath(out, lane.number)) &&
      (values.regroup !== true || existsSync(reportPath(out, lane.number))),
  );
  const launched = asked.filter((lane) => !kept.includes(lane));
  const built = launched.filter((lane) => !existsSync(promptPath(out, lane.number)));
  // The lanes launched go to `--agents N` sessions of `launch.json`, four by default, packed by
  // importance (`sessionsOf`), each session reading its prompts in turn and writing their reports
  // itself. Nothing kept is in it, so its count is the spend (SKILL.md, step 3) and no session is
  // started twice against one prompt, where a regroup's caller stopped the old ones. Until 15
  // October each launch turned a Markdown list into this by hand, until 1 November it held one
  // session a lane, and until 9 November that stayed the default without `--agents`.
  const count = Number(values.agents ?? 4);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--agents ${String(values.agents)}: name a whole number from 1`);
  }
  mkdirSync(join(out, "lanes"), { recursive: true });
  // What `start` derived for each log, as the folders stand now.
  const root = derivedOf(REPO);
  const files = derivedMap(campaigns.map(({ name, log }) => ({ name, dir: folderOf(root, log) })));
  // What every open lane shares is one file, named by its bytes: a later build under edited
  // instructions writes another beside it, and no prompt built before points at text that moved.
  const parts = { shared, campaigns, catalogue, owners, derived: files };
  const every = `${sharedPrompt(parts)}\n`;
  const common = join(out, "lanes", `shared-${hashJsonValue(every).slice(0, 8)}.md`);
  if (built.some((lane) => !lane.isolated && !lane.blind)) writeFileSync(common, every);
  for (const lane of built) {
    const report = reportPath(out, lane.number);
    writeFileSync(promptPath(out, lane.number), `${lanePrompt({ ...parts, lane, report, climb, common })}\n`);
  }
  const groups = sessionsOf(launched, count);
  // `--high K` gives the K heaviest sessions high reasoning and the rest medium (operator, 9
  // November: "medium or high based on complexity of the group"); without it the launch's effort holds.
  const high = values.high === undefined ? null : Number(values.high);
  if (high !== null && (!Number.isInteger(high) || high < 0 || high > groups.length)) {
    throw new Error(`--high ${String(values.high)}: name a whole number from 0 to ${String(groups.length)}`);
  }
  const heaviest = new Set(
    groups.toSorted((one, other) => weightOf(other) - weightOf(one)).slice(0, high ?? 0),
  );
  const effortOf = (group: (typeof groups)[number]) =>
    high === null ? {} : { effort: heaviest.has(group) ? "high" : "medium" };
  const sessions = groups.map((group) => {
    const labels = [...new Set(group.map((lane) => lane.label))];
    // A label may be split across sessions, so a session's first lane keeps its name unique.
    const lead = stem(Math.min(...group.map((lane) => lane.number)));
    const prompts = group.map((lane) => `\`${promptPath(out, lane.number)}\``).join(", then ");
    return {
      name: group.length === 1 ? `lane_${lead}` : `${labels.join("_").slice(0, 44)}_${lead}`,
      task:
        group.length === 1
          ? `Read ${prompts} and do exactly what it says.`
          : // One lane at a time: the skill's "Sizing" gives what reading them together lost.
            `Read ${prompts}, one at a time, and do exactly what each says: read a lane's evidence and write its report before you open the next prompt.`,
      ownedPaths: group.map((lane) => reportPath(out, lane.number)),
      ...effortOf(group),
    };
  });
  // A lane reads campaign logs, which hold hidden values, so its sessions search nothing: a query
  // leaves the machine (`AGENTS.md`, section 5). Every other Codex launch searches by default.
  // Every build after the first has a manifest of its own beside the first's, named by its lanes, so
  // no session a manifest launched loses the manifest that owes its report: on 4 November building
  // lane 19 alone wrote over buffer583's five grouped sessions, and until 9 November a later build of
  // open lanes still wrote over `launch.json`.
  const first = join(out, "launch.json");
  const launch = existsSync(first)
    ? join(out, `launch-${launched.map((lane) => stem(lane.number)).join("-")}.json`)
    : first;
  if (sessions.length > 0) {
    writeFileSync(
      launch,
      `${JSON.stringify({ workdir: REPO, sandbox: "workspace-write", search: false, sessions }, null, 2)}\n`,
    );
  }
  console.log(`${plural(built.length, "lane")} built: ${built.map((lane) => lane.number).join(", ")}`);
  for (const [index, group] of groups.entries()) {
    console.log(
      `session ${sessions[index]?.name ?? ""}: lanes ${group.map((lane) => lane.number).join(", ")}, weight ${weightOf(group).toFixed(1)}${high === null ? "" : `, ${effortOf(group).effort ?? ""} effort`}`,
    );
  }
  for (const lane of kept) console.log(`lane ${String(lane.number)}: built before, kept`);
  for (const lane of waiting) {
    console.log(
      `lane ${String(lane.number)} has its trigger and runs alone: read what it waits on, then build it with --lanes ${String(lane.number)}`,
    );
  }
  console.log(
    sessions.length === 0
      ? "nothing to launch"
      : `${launch}: ${plural(sessions.length, "session")} to launch`,
  );
  return 0;
}

function collected({ out, campaigns, shared }: Investigation) {
  const catalogue = catalogueText();
  const owners = ownersOf(catalogue);
  return lanesOf(catalogue)
    .filter((lane) => existsSync(promptPath(out, lane.number)))
    .map((lane) => {
      const path = reportPath(out, lane.number);
      const names = campaigns.map(({ name }) => name);
      return reportOf(lane, existsSync(path) ? readFileSync(path, "utf8") : null, owners, names, shared);
    });
}

function collect(): number {
  const investigation = opened();
  const reports = collected(investigation);
  const { out, campaigns, shared } = investigation;
  const index = reportIndex(reports, (lane) => reportPath(out, lane), campaigns, shared);
  writeFileSync(join(investigation.out, REPORTS), `# Reports\n\n${index}\n`);
  console.log(index);
  const open = reports.filter(({ state }) => state !== "ok").length;
  const omitted = reports.filter(({ verdict }) => verdict === "omitted").length;
  console.log(
    `${open === 0 ? "every report is in" : `${plural(open, "report")} missing or invalid`}; ${String(reports.length - omitted)} read, ${String(omitted)} omitted`,
  );
  return open === 0 && reports.length > 0 ? 0 : 1;
}

function synthesis(): number {
  const investigation = opened();
  const { out, shared } = investigation;
  const reports = collected(investigation);
  const template = readFileSync(join(REFERENCES, "synthesis.template.md"), "utf8");
  const path = join(out, "synthesis-prompt.md");
  writeFileSync(
    path,
    filled(template, {
      out,
      synthesis: join(out, "synthesis.md"),
      overview: readFileSync(join(out, "overview.md"), "utf8").trim(),
      reports: reportIndex(reports, (lane) => reportPath(out, lane), investigation.campaigns, shared),
      sharedInstructions: shared.replaceAll(/<!--[\s\S]*?-->\n?/g, "").trim(),
    }),
  );
  const gaps = reports.filter(({ state }) => state !== "ok").map(({ lane }) => lane);
  if (gaps.length > 0) console.log(`rendered over gaps: lane ${gaps.join(", ")}`);
  console.log(`One line to hand the session: Read \`${path}\` and do exactly what it says.`);
  return 0;
}

async function main(): Promise<number> {
  const [verb] = positionals;
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }
  if (verb === "read") {
    const log = oneLog();
    console.log(overviewText(log, read(log), REPO));
    return 0;
  }
  if (verb === "reader") return await oneReader(positionals[1]);
  if (verb === "grade") {
    const { bundle, task, answer, solve, set = [], answers } = values;
    return grade({ log: oneLog(), bundle, task, answer, solve, set, answers });
  }
  if (verb === "derive") return deriveStep();
  if (verb === "index") {
    const checkout = mainTree(REPO);
    const root = resolve(values.root ?? join(checkout, ".ana", "wri"));
    const out = resolve(values.out ?? join(root, "INDEX.md"));
    const { text, parsed, rows } = investigationIndex(root, {
      notes: join(checkout, "notes"),
      runs: readable(REPO),
      now: Date.now(),
    });
    writeFileSync(out, text);
    const how = Object.entries(parsed).map(([way, count]) => `${String(count)} ${way}`);
    console.log(
      `wrote ${out}: ${plural(rows.investigations, "investigation")} (${how.join(", ")}), ${plural(rows.ledgers, "ledger folder")}, ${plural(rows.runs, "recent campaign")}, ${plural(rows.pulls, "pull request")}`,
    );
    return 0;
  }
  if (verb === "climb") {
    needed("log");
    console.log(climbOf(resolvedLogs));
    return 0;
  }
  if (verb === "trajectory") {
    needed("log");
    const campaigns = resolvedLogs.map((log) => ({ name: nameOf(log), log, events: read(log) }));
    const text = trajectoryText(campaigns, {
      grades:
        values.grades === undefined
          ? null
          : gradesIn(
              values.grades
                .split(",")
                .map((file) => readFileSync(file, "utf8"))
                .join("\n"),
            ),
      hours: values.hours?.split(",").map(Number) ?? HOURS,
    });
    console.log(text);
    return 0;
  }
  if (verb === "packets") {
    needed("out");
    const out = values.out ?? "";
    const lines =
      values.join === true
        ? joinPackets(out, read)
        : buildPackets(
            resolvedLogs.map((log) => ({ name: nameOf(log), log, events: read(log) })),
            out,
            Number(values.graders ?? 2),
          );
    console.log(lines.join("\n"));
    return 0;
  }
  const step = Object.entries({ start, lanes, collect, synthesis }).find(([name]) => name === verb)?.[1];
  if (step === undefined) throw new Error(USAGE);
  return step();
}

runtimeProcess.exitCode = await main();
