/**
 * The whole-run investigation of one campaign, a verb a step. It reads a log and writes only under
 * the investigation's own directory, which belongs under the ignored `.ana/wri/`.
 *
 *   bun tools/wri/wri.ts read --log .ana/d2/truss/log.jsonl
 *   bun tools/wri/wri.ts climb --log .ana/d2/truss/log.jsonl[,<log>,<log>]
 *   bun tools/wri/wri.ts trajectory --log <log>[,<log>...] [--grades <report>[,<report>]] [--hours 2,4,8]
 *   bun tools/wri/wri.ts packets --log <log>,<log>[,...] --out <dir> [--graders 2]
 *   bun tools/wri/wri.ts packets --out <dir> --join
 *   bun tools/wri/wri.ts start --log .ana/d2/truss/log.jsonl[,<log>,<log>] --out .ana/wri/20261008-truss [--snapshot]
 *   bun tools/wri/wri.ts lanes --out .ana/wri/20261008-truss [--lanes 1-4,7] [--agents 3]
 *   bun tools/wri/wri.ts collect --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts synthesis --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts grade --log .ana/d2/truss/log.jsonl [--bundle <pack>] --task <taskId> --answer <file>
 *   bun tools/wri/wri.ts derive (--log <log>[,<log>...] | --all) [--verbose] [--force] [--no-embed]
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
 *   reads: one session a lane it built, or with `--agents N` the lanes packed by label into N
 *   sessions, a label never split and the sessions near one another in importance, and each
 *   isolated lane a session of its own. With no `--lanes` it opens the lanes a trigger
 *   started and the standing ones; an isolated lane is built only when named. A prompt built before
 *   is kept and launched again by nobody: `launch.json` holds only what this call built.
 * - `collect` holds every expected report to its shape and writes `reports.md`. It exits 1 until
 *   every report is there and valid.
 * - `synthesis` renders the synthesis session's prompt over the reports as they stand.
 * - `derive` runs every deterministic reader of one log over it (`READERS`, `tools/wri/derive.ts`)
 *   into the main worktree's `data/derived/<campaign>@<path>/`, one folder a log path and one file
 *   a reader, replacing the folder whole where the log or the reading commit moved. It prints one line; `--verbose` prints every
 *   file as well, for a session that wants to read them all. `--all` takes every campaign this
 *   machine reads (`readable`, `tools/runs/registry.ts`), which is how a job keeps them current.
 *   `start` derives its logs the same way, quietly, and names the folders in the instructions.
 * - `index` reads every investigation under `--root` (the main worktree's `.ana/wri/` by default)
 *   and writes one page over them to `--out` (`<root>/INDEX.md`): a row a folder, newest first,
 *   then each campaign group's binding constraints in time order, each cycle folder and prediction
 *   ledger there and in the main checkout's `notes/`, and each campaign whose log moved in the last
 *   fourteen days, then each pull request a `plan.md` or a fork's `forkedPR<N>` names, with its forks'
 *   per-run ledgers read (`tools/wri/index.ts`). It prints each section's row count and how many
 *   folders it read whole, in part or not at all, and never the page, which holds hidden values.
 * - `grade` puts one answer to the campaign's own checker and prints the verdict in one line. It
 *   writes nothing and logs nothing. It needs the pack and its tool tree, and the Mac's verifier wall.
 *   An answer outside a drafted exam's answer format is refused first, as `judge` refuses a
 *   solver's, and no check reads it (`src/solver/run.ts`). The format is the draft's, which the
 *   campaign's contract holds (`packOpened`, `tools/d2/campaign.ts`). Until 20 October grade put
 *   every answer to the checks alone, and a lane of buffer-fresh-opus-forkedPR223_v0_5_4-r3's
 *   investigation, probing through it, read the evaluator's leniency on keys the format refuses as
 *   a gap of the exam, where the host refuses such an answer before any check: none of the
 *   campaign's 2,480 verdicts held a format fault. A stored pack's format is read from its sweep,
 *   which grade is not given, so its answers are put to the checks alone, and grade says so.
 *   A campaign over a stored pack names it with `--bundle`, and its checks stand beside the log; a
 *   campaign that drafted its exam names none, and its exam is read where the campaign staged it
 *   (`exams/<digest>/`, `tools/d2/exam.ts`). On 10 October t-10's lane 1 was given `<campaign>/checks`
 *   for a drafted exam and stopped on ENOENT.
 *
 * A log is named by its path or, since 15 October, by its campaign's whole name in any of the
 * repository's worktrees (`runNamed`). No verb starts a solve, a session
 * or a round, and none appends to a log.
 */
import { draftOf } from "#src/examiner/draft.ts";
import { answerFormatFault } from "#src/kernel/contract.ts";
import { LOG_FILE, read } from "#src/kernel/log.ts";
import { openVerifier, spelled } from "#src/kernel/verify.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { gitMaybe, gitText, mainTree } from "#src/meta/git.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { codeOf } from "../d2/campaign.ts";
import { installAt } from "../runs/code.ts";
import { receipts } from "../runs/receipt.ts";
import { isCampaign, processes, readable, type Running } from "../runs/registry.ts";
import { stillRunning } from "../runs/diagnosis.ts";
import { snapshotCampaign } from "../runs/seed.ts";
import { type Derived, derive, derivedLine, derivedOf, derivedText, readersOf } from "./derive.ts";
import { logAcross } from "../runs/snapshots.ts";
import { stagedExamOf } from "../d2/exam.ts";
import { readPack } from "../m0/stored-sweep.ts";
import { catalogueText, lanesOf, ownersOf, REFERENCES } from "./catalogue.ts";
import { climbTable, crossings } from "./climb.ts";
import {
  blankSections,
  type Campaign,
  filled,
  lanePrompt,
  numbersOf,
  reportIndex,
  reportOf,
  selected,
  sessionsOf,
  stem,
  suggestedSessions,
  weightOf,
} from "./investigation.ts";
import { INVESTIGATION, investigationIndex, REPORTS, SHARED } from "./index.ts";
import { overview, rendered } from "./read.ts";
import { buildPackets, joinPackets } from "./packets.ts";
import { gradesIn, HOURS, trajectoryText } from "./trajectory.ts";

interface Investigation {
  readonly out: string;
  readonly shared: string;
  readonly campaigns: readonly Campaign[];
}

const REPO = resolve(import.meta.dir, "..", "..");
const USAGE =
  "usage: bun tools/wri/wri.ts read | climb | trajectory | start | lanes | collect | synthesis | grade | derive | index";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    log: { type: "string" },
    out: { type: "string" },
    root: { type: "string" },
    lanes: { type: "string" },
    agents: { type: "string" },
    bundle: { type: "string" },
    task: { type: "string" },
    answer: { type: "string" },
    all: { type: "boolean" },
    verbose: { type: "boolean" },
    force: { type: "boolean" },
    "no-embed": { type: "boolean" },
    snapshot: { type: "boolean" },
    grades: { type: "string" },
    graders: { type: "string" },
    join: { type: "boolean" },
    hours: { type: "string" },
  },
});

/** Every log `--log` names, comma-separated. */
const resolvedLogs = await Promise.all(
  (values.log ?? "")
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

function needed(name: "log" | "out" | "bundle" | "task" | "answer"): string {
  const value = values[name];
  if (value === undefined) throw new Error(`name --${name}`);
  return value;
}

/** The host's code as a condition names it (`codeOf`), for a tree that holds it. */
function hostOf(tree: string): string | undefined {
  const parts = ["src", "vendor", "package.json"].map((part) => join(tree, part));
  return parts.every((part) => existsSync(part)) ? codeOf(tree).host : undefined;
}

/**
 * One line on where the code the campaign last ran under stands: this checkout, or the tree the
 * campaign runs in (`<tree>/.ana/d2/<campaign>/log.jsonl`), which a live campaign keeps unmoved.
 * The condition names that code by a digest of its content, which is no commit: two lanes of
 * 14 October read one digest against a receipt's commit as two trees. So the line calls it a
 * digest and names the commit the last launch's receipt holds (`receipts`) beside it. A snapshot's
 * log lies under the investigation, not the campaign's tree, so the tree `sourceTree` checks out at
 * that commit is asked too: on 7 November the esp32 investigation's line called that tree, which
 * held the code that ran, "another tree", and three lanes discounted exact source evidence.
 */
function hostLine(log: string): string {
  const ran = read(log).findLast(({ kind }) => kind === "condition.recorded")?.data.condition;
  const host = asRecord(ran)?.host;
  const last = isString(host) ? host : undefined;
  const here = hostOf(REPO) ?? "";
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
    ...(launch === undefined ? [] : [wriTree(launch.commit)]),
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

/**
 * A tree at the commit the campaign's last launch ran, with its dependencies installed, beside the
 * main checkout, where this checkout's code differs from the code the campaign last ran under. On
 * 4 November buffer583's own tree held no dependencies, so two lanes ran the Examiner's view from
 * this checkout's code instead, and the primary had checked the run's commit out by hand. Null
 * where the code matches, no receipt names a commit, or this repository does not hold it.
 */
function sourceTree(log: string): string | null {
  const ran = asRecord(read(log).findLast(({ kind }) => kind === "condition.recorded")?.data.condition)?.host;
  const commit = receipts(log).at(-1)?.commit;
  if (
    commit === undefined ||
    ran === hostOf(REPO) ||
    gitMaybe(REPO, "cat-file", "-e", `${commit}^{commit}`) === null
  ) {
    return null;
  }
  const tree = wriTree(commit);
  if (!existsSync(tree)) gitText(REPO, "worktree", "add", "-q", "--detach", tree, commit);
  if (!existsSync(join(tree, "node_modules"))) installAt(tree, commit);
  return tree;
}

/** Where `sourceTree` checks out a launch's commit, beside the main checkout. */
function wriTree(commit: string): string {
  return join(dirname(mainTree(REPO)), `anabasis-wri-${commit.slice(0, 9)}`);
}

function overviewText(log: string): string {
  return `${rendered(overview(read(log), receipts(log)))}\n\n${hostLine(log)}\n`;
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
  // Each launch's tree first, so that the host line can name it.
  const trees = logs.flatMap((log) => {
    const tree = sourceTree(log);
    return tree === null
      ? []
      : [
          `- ${nameOf(log)}: the code its last launch ran is checked out at \`${tree}\`, its dependencies installed. Read source there, and run a reader there (\`cd ${tree} && bun tools/...\`) to see what it printed at that commit; the derived files below come from this checkout's code.`,
        ];
  });
  const texts = logs.map(overviewText);
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
  const campaigns = logs.map((log) => ({
    name: nameOf(log, logs),
    log,
    overview: overview(read(log), receipts(log)),
  }));
  return { out, shared: readFileSync(join(out, SHARED), "utf8"), campaigns };
}

/** The campaigns in lane 22's columns, and the `/tmp` paths one named before another's solve ran
 *  them (`tools/wri/climb.ts`). */
function climbText(logs: readonly string[]): string {
  const campaigns = logs.map((each) => ({ name: nameOf(each), events: read(each) }));
  const { left, scratch } = crossings(campaigns);
  return [
    "### The climb, side by side",
    climbTable(campaigns),
    "### Solves that named what another campaign's session left under `/tmp`",
    left.length > 0 ? left.map((line) => `- ${line}`).join("\n") : "None.",
    `And ${scratch}.`,
  ].join("\n\n");
}

const promptPath = (out: string, lane: number) => join(out, "lanes", `${stem(lane)}-prompt.md`);
const reportPath = (out: string, lane: number) => join(out, "lanes", `${stem(lane)}-report.md`);

function lanes(): number {
  const { out, shared, campaigns } = opened();
  refuseRunning(campaigns.map(({ log }) => log));
  const climb = campaigns.length > 1 ? climbText(campaigns.map(({ log }) => log)) : "";
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
  // earlier read's lanes (9762afb0) and bound a report to its prompt's bytes (23bdedb8).
  const asked = [...open, ...isolated];
  const kept = asked.filter((lane) => existsSync(promptPath(out, lane.number)));
  const built = asked.filter((lane) => !kept.includes(lane));
  // With `--agents N` the lanes built go to that many sessions of `launch.json`, whole labels
  // packed by importance (`sessionsOf`), each session reading its prompts in turn and writing their
  // reports itself; without it each lane is a session. Nothing kept is in it, so its count is the
  // spend (SKILL.md, step 3) and no session is started twice against one prompt. Until 15 October
  // each launch turned a Markdown list into this by hand, and until 1 November it held one session
  // a lane, which the operator asked to set by the number of subagents instead.
  const count = values.agents === undefined ? null : Number(values.agents);
  if (count !== null && (!Number.isInteger(count) || count < 1)) {
    throw new Error(`--agents ${String(values.agents)}: name a whole number from 1`);
  }
  for (const lane of built) {
    const report = reportPath(out, lane.number);
    writeFileSync(
      promptPath(out, lane.number),
      `${lanePrompt({ lane, shared, campaigns, catalogue, owners, report, climb })}\n`,
    );
  }
  const groups = count === null ? built.map((lane) => [lane]) : sessionsOf(built, count);
  const sessions = groups.map((group) => {
    const labels = [...new Set(group.map((lane) => lane.label))];
    const [first] = group;
    const prompts = group.map((lane) => `\`${promptPath(out, lane.number)}\``).join(", then ");
    return {
      name:
        group.length === 1 && first !== undefined
          ? `lane_${stem(first.number)}`
          : labels.join("_").slice(0, 48),
      task:
        group.length === 1
          ? `Read ${prompts} and do exactly what it says.`
          : `Read ${prompts}, one at a time, and do exactly what each says: each lane writes its own report.`,
      ownedPaths: group.map((lane) => reportPath(out, lane.number)),
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
    ? join(out, `launch-${built.map((lane) => stem(lane.number)).join("-")}.json`)
    : first;
  if (sessions.length > 0) {
    writeFileSync(
      launch,
      `${JSON.stringify({ workdir: REPO, sandbox: "workspace-write", search: false, sessions }, null, 2)}\n`,
    );
  }
  console.log(`${plural(built.length, "lane")} built: ${built.map((lane) => lane.number).join(", ")}`);
  for (const [index, group] of (count === null ? [] : groups).entries()) {
    console.log(
      `session ${sessions[index]?.name ?? ""}: lanes ${group.map((lane) => lane.number).join(", ")}, weight ${weightOf(group).toFixed(1)}`,
    );
  }
  const packed = groups.filter((group) => group.some((lane) => !lane.isolated)).length;
  if (count !== null && packed < count) {
    console.log(
      `${plural(packed, "session")} of open lanes, not ${String(count)}: a label is never split; without --agents each lane is a session`,
    );
  }
  if (built.some((lane) => !lane.isolated)) {
    console.log(
      `suggested: --agents ${String(suggestedSessions(built))}, the most sessions whose lightest weighs at least half the heaviest`,
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

function collected({ out, campaigns }: Investigation) {
  const catalogue = catalogueText();
  const owners = ownersOf(catalogue);
  return lanesOf(catalogue)
    .filter((lane) => existsSync(promptPath(out, lane.number)))
    .map((lane) => {
      const path = reportPath(out, lane.number);
      const names = campaigns.map(({ name }) => name);
      return reportOf(lane, existsSync(path) ? readFileSync(path, "utf8") : null, owners, names);
    });
}

function collect(): number {
  const investigation = opened();
  const reports = collected(investigation);
  const index = reportIndex(reports, (lane) => reportPath(investigation.out, lane), investigation.campaigns);
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
      reports: reportIndex(reports, (lane) => reportPath(out, lane), investigation.campaigns),
      sharedInstructions: shared.replaceAll(/<!--[\s\S]*?-->\n?/g, "").trim(),
    }),
  );
  const gaps = reports.filter(({ state }) => state !== "ok").map(({ lane }) => lane);
  if (gaps.length > 0) console.log(`rendered over gaps: lane ${gaps.join(", ")}`);
  console.log(`One line to hand the session: Read \`${path}\` and do exactly what it says.`);
  return 0;
}

async function grade(): Promise<number> {
  const [log, taskId] = [oneLog(), needed("task")];
  // The pack and the check program: the stored pack `--bundle` names, whose checks the campaign
  // staged beside its log, or the exam the log drafted, where the campaign staged it.
  const staged = values.bundle === undefined ? stagedExamOf(log) : null;
  if (values.bundle === undefined && staged === null) {
    throw new Error("name --bundle: the campaign drafted no exam of its own, so its pack is a stored one");
  }
  const { bundle, checks } = staged ?? { bundle: needed("bundle"), checks: join(dirname(log), "checks") };
  // The tasks an Examiner wrote are in the log and in no pack.
  const events = read(log);
  const tasks = [...writtenTasks(events), ...readPack(bundle).tasks];
  const task = tasks.find((each) => each.taskId === taskId);
  if (task === undefined) throw new Error(`neither the log nor the pack holds task ${taskId}`);
  const answer = capturedJsonParse(readFileSync(needed("answer"), "utf8"));
  // The format first, as the host holds a solver's answer to it before any check reads it (`judge`).
  const answerFormat = draftOf(events)?.answerFormat;
  const fault = answerFormat === undefined ? null : answerFormatFault(answerFormat, answer);
  if (fault !== null) {
    console.log(`fail format: ${fault}`);
    return 0;
  }
  if (answerFormat === undefined) {
    console.error(
      "the answer format of a stored pack is read from its sweep, which grade is not given: not held to it",
    );
  }
  const verify = openVerifier({ checks, tools: join(bundle, ".toolchain"), packRoots: [bundle] });
  console.log(spelled(await verify(task, answer)));
  return 0;
}

async function main(): Promise<number> {
  const [verb] = positionals;
  if (verb === "read") {
    console.log(overviewText(oneLog()));
    return 0;
  }
  if (verb === "grade") return grade();
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
    console.log(climbText(resolvedLogs));
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
