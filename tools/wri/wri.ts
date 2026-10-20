/**
 * The whole-run investigation of one campaign, a verb a step. It reads a log and writes only under
 * the investigation's own directory, which belongs under the ignored `.ana/wri/`.
 *
 *   bun tools/wri/wri.ts read --log .ana/d2/truss/log.jsonl
 *   bun tools/wri/wri.ts climb --log .ana/d2/truss/log.jsonl [--with <log>,<log>]
 *   bun tools/wri/wri.ts start --log .ana/d2/truss/log.jsonl --out .ana/wri/20261008-truss [--with <log>,<log>]
 *   bun tools/wri/wri.ts lanes --out .ana/wri/20261008-truss [--lanes 1-4,7]
 *   bun tools/wri/wri.ts collect --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts synthesis --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts grade --log .ana/d2/truss/log.jsonl [--bundle <pack>] --task <taskId> --answer <file>
 *
 * - `climb` prints lane 31's columns for the campaign and every log `--with` names, one row each,
 *   and the paths under the host's `/tmp` one campaign named before another's solve ran them. It
 *   reads the logs as they stand, so it can be run on campaigns still running.
 * - `read` prints the six rows and every trigger with the lane it starts (`tools/wri/read.ts`), and
 *   the host hash of the last condition beside this checkout's, and beside the campaign's own
 *   tree's when this checkout's differs.
 * - `start` writes that as `overview.md`, and the shared instructions with the campaign's row filled
 *   in and two sections left for the primary to write. `--with` names peer campaigns' logs, which a
 *   lane that reads peers (lane 31) is given read the same way, at `lanes` time, and never reviews.
 * - `lanes` builds one prompt per lane, and `launch.json`, one session for each lane it built, in
 *   the manifest codex-gpt-swarm's launcher reads. With no `--lanes` it opens the lanes a trigger
 *   started and the standing ones; an isolated lane is built only when named. A prompt built before
 *   is kept and launched again by nobody: `launch.json` holds only what this call built.
 * - `collect` holds every expected report to its shape and writes `reports.md`. It exits 1 until
 *   every report is there and valid.
 * - `synthesis` renders the synthesis session's prompt over the reports as they stand.
 * - `grade` puts one answer to the campaign's own checker and prints the verdict in one line. It
 *   writes nothing and logs nothing. It needs the pack and its tool tree, and the Mac's verifier wall.
 *   An answer outside a drafted exam's answer format is refused first, as `judge` refuses a
 *   solver's, and no check reads it (`src/solve/run.ts`). The format is the draft's, which the
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
 * repository's worktrees (`runNamed`), as `--with` names peers. No verb starts a solve, a session
 * or a round, and none appends to a log.
 */
import { draftOf } from "#src/examiner/draft.ts";
import { answerFormatFault } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import { openVerifier, spelled } from "#src/kernel/verify.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { codeOf } from "../d2/campaign.ts";
import { receipts } from "../runs/receipt.ts";
import { readNamed } from "../runs/registry.ts";
import { stagedExamOf } from "../d2/exam.ts";
import { readPack } from "../m0/stored-sweep.ts";
import { catalogueText, lanesOf, ownersOf, REFERENCES } from "./catalogue.ts";
import { climbTable, crossings } from "./climb.ts";
import {
  blankSections,
  filled,
  lanePrompt,
  numbersOf,
  reportIndex,
  reportOf,
  selected,
  stem,
} from "./investigation.ts";
import { type Overview, overview, rendered } from "./read.ts";

interface Investigation {
  readonly out: string;
  readonly log: string;
  readonly shared: string;
  readonly seen: Overview;
  readonly peers: readonly string[];
}

const REPO = resolve(import.meta.dir, "..", "..");
const SHARED = "shared-instructions.md";
const USAGE = "usage: bun tools/wri/wri.ts read | climb | start | lanes | collect | synthesis | grade";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    log: { type: "string" },
    out: { type: "string" },
    lanes: { type: "string" },
    bundle: { type: "string" },
    task: { type: "string" },
    answer: { type: "string" },
    with: { type: "string" },
  },
});

/** A log by its path, or a campaign's by the campaign's whole name. */
const logOf = (named: string) => (existsSync(named) ? named : readNamed(named).path);

function needed(name: "log" | "out" | "bundle" | "task" | "answer"): string {
  const value = values[name];
  if (value === undefined) throw new Error(`name --${name}`);
  return name === "log" ? logOf(value) : value;
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
 * digest and names the commit the last launch's receipt holds (`receipts`) beside it.
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
  const tree = resolve(dirname(log), "..", "..", "..");
  return hostOf(tree) === last
    ? said(
        `the last condition's is ${last.slice(0, 8)}, which the campaign's own tree \`${tree}\` holds as it stands, so read source there; this checkout's is ${here.slice(0, 8)}`,
      )
    : said(
        `the last condition's is ${last.slice(0, 8)} and this checkout's is ${here.slice(0, 8)}, so every statement about source is about another tree`,
      );
}

function overviewText(log: string): string {
  return `${rendered(overview(read(log)))}\n\n${hostLine(log)}\n`;
}

function start(): number {
  const [log, out] = [resolve(needed("log")), resolve(needed("out"))];
  if (existsSync(join(out, SHARED))) throw new Error(`${out} already holds ${SHARED}`);
  const peers = (values.with?.split(",") ?? [])
    .filter((each) => each !== "")
    .map((each) => resolve(logOf(each)));
  const absent = peers.filter((peer) => !existsSync(peer));
  if (absent.length > 0) throw new Error(`--with names no log at ${absent.join(", ")}`);
  mkdirSync(join(out, "lanes"), { recursive: true });
  const text = overviewText(log);
  const campaign = [
    "| campaign | log | events | checkout |",
    "| --- | --- | --- | --- |",
    `| ${basename(dirname(log))} | \`${log}\` | ${String(read(log).length)} | \`${REPO}\` |`,
    "",
    text.trim().split("\n").at(-1) ?? "",
  ].join("\n");
  const template = readFileSync(join(REFERENCES, "shared-instructions.template.md"), "utf8");
  // The author's comments stay in the copy: they say what each blank section is for.
  writeFileSync(
    join(out, SHARED),
    template.replace("{campaign}", () => campaign),
  );
  writeFileSync(join(out, "overview.md"), text);
  writeFileSync(join(out, "investigation.json"), `${JSON.stringify({ log, peers }, null, 2)}\n`);
  console.log(text);
  console.log(`wrote ${join(out, SHARED)}: write its two blank sections, then run lanes`);
  return 0;
}

function opened(): Investigation {
  const out = resolve(needed("out"));
  // An investigation started before `--with` holds no peers.
  const { log, peers = [] } = parseJsonAs<{ log: string; peers?: string[] }>(
    readFileSync(join(out, "investigation.json"), "utf8"),
  );
  return { out, log, shared: readFileSync(join(out, SHARED), "utf8"), seen: overview(read(log)), peers };
}

/** Each peer campaign as `read` prints it, under its name and log. Read when the lanes are built,
 *  so a peer still running is read as it stands then. */
function peersText(log: string, peers: readonly string[]): string {
  if (peers.length === 0) return "";
  const overviews = peers.map((peer) =>
    [`### ${basename(dirname(peer))}`, `Log: \`${peer}\``, "```", overviewText(peer).trim(), "```"].join(
      "\n\n",
    ),
  );
  return [climbText(log, peers), ...overviews].join("\n\n");
}

/** The campaign beside its peers, in lane 31's columns, and the `/tmp` paths one named before
 *  another's solve ran them (`tools/wri/climb.ts`). */
function climbText(log: string, peers: readonly string[]): string {
  const campaigns = [log, ...peers].map((each) => ({ name: basename(dirname(each)), events: read(each) }));
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
  const { out, log, shared, seen, peers } = opened();
  const peerOverviews = peersText(log, peers);
  const blank = blankSections(shared);
  if (blank.length > 0) throw new Error(`write these sections of ${SHARED} first: ${blank.join(", ")}`);
  const catalogue = catalogueText();
  const owners = ownersOf(catalogue);
  const named = values.lanes === undefined ? null : numbersOf(values.lanes);
  const { open, isolated, waiting } = selected(lanesOf(catalogue), seen.triggers, named);
  // A prompt already built is kept: a report may have been written against it, and `collect` reads
  // the report and never the prompt, so a rebuilt one would change under it unseen. v1 kept an
  // earlier read's lanes (9762afb0) and bound a report to its prompt's bytes (23bdedb8).
  const asked = [...open, ...isolated];
  const kept = asked.filter((lane) => existsSync(promptPath(out, lane.number)));
  const built = asked.filter((lane) => !kept.includes(lane));
  // Each lane built is one session of `launch.json`, its one line and the report it writes itself,
  // and nothing kept is in it, so its count is the spend (SKILL.md, step 3) and no session is started
  // twice against one prompt. Until 15 October each launch turned a Markdown list into this by hand.
  const sessions = built.map((lane) => {
    const [prompt, report] = [promptPath(out, lane.number), reportPath(out, lane.number)];
    writeFileSync(
      prompt,
      `${lanePrompt({ lane, shared, overview: seen, catalogue, owners, report, peers: peerOverviews })}\n`,
    );
    return {
      name: `lane_${stem(lane.number)}`,
      task: `Read \`${prompt}\` and do exactly what it says.`,
      ownedPaths: [report],
    };
  });
  const launch = join(out, "launch.json");
  if (sessions.length > 0) {
    writeFileSync(
      launch,
      `${JSON.stringify({ workdir: REPO, sandbox: "workspace-write", sessions }, null, 2)}\n`,
    );
  }
  console.log(`${plural(built.length, "lane")} built: ${built.map((lane) => lane.number).join(", ")}`);
  for (const lane of kept) console.log(`lane ${String(lane.number)}: built before, kept`);
  for (const lane of waiting) {
    console.log(
      `lane ${String(lane.number)} has its trigger and runs alone: read what it waits on, then build it with --lanes ${String(lane.number)}`,
    );
  }
  console.log(
    built.length === 0 ? "nothing to launch" : `${launch}: ${plural(built.length, "session")} to launch`,
  );
  return 0;
}

function collected({ out }: Investigation) {
  const catalogue = catalogueText();
  const owners = ownersOf(catalogue);
  return lanesOf(catalogue)
    .filter((lane) => existsSync(promptPath(out, lane.number)))
    .map((lane) => {
      const path = reportPath(out, lane.number);
      return reportOf(lane, existsSync(path) ? readFileSync(path, "utf8") : null, owners);
    });
}

function collect(): number {
  const investigation = opened();
  const reports = collected(investigation);
  const index = reportIndex(reports, (lane) => reportPath(investigation.out, lane));
  writeFileSync(join(investigation.out, "reports.md"), `# Reports\n\n${index}\n`);
  console.log(index);
  const open = reports.filter(({ state }) => state !== "ok").length;
  console.log(open === 0 ? "every report is in" : `${plural(open, "report")} missing or invalid`);
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
      reports: reportIndex(reports, (lane) => reportPath(out, lane)),
      sharedInstructions: shared.replaceAll(/<!--[\s\S]*?-->\n?/g, "").trim(),
    }),
  );
  const gaps = reports.filter(({ state }) => state !== "ok").map(({ lane }) => lane);
  if (gaps.length > 0) console.log(`rendered over gaps: lane ${gaps.join(", ")}`);
  console.log(`One line to hand the session: Read \`${path}\` and do exactly what it says.`);
  return 0;
}

async function grade(): Promise<number> {
  const [log, taskId] = [needed("log"), needed("task")];
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
    console.log(overviewText(needed("log")));
    return 0;
  }
  if (verb === "grade") return grade();
  if (verb === "climb") {
    const peers = (values.with?.split(",") ?? []).filter((each) => each !== "").map(logOf);
    console.log(climbText(needed("log"), peers));
    return 0;
  }
  const step = Object.entries({ start, lanes, collect, synthesis }).find(([name]) => name === verb)?.[1];
  if (step === undefined) throw new Error(USAGE);
  return step();
}

runtimeProcess.exitCode = await main();
