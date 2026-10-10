/**
 * The whole-run investigation of one campaign, a verb a step. It reads a log and writes only under
 * the investigation's own directory, which belongs under the ignored `.ana/wri/`.
 *
 *   bun tools/wri/wri.ts read --log .ana/d2/truss/log.jsonl
 *   bun tools/wri/wri.ts start --log .ana/d2/truss/log.jsonl --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts lanes --out .ana/wri/20261008-truss [--lanes 1-4,7]
 *   bun tools/wri/wri.ts collect --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts synthesis --out .ana/wri/20261008-truss
 *   bun tools/wri/wri.ts grade --log .ana/d2/truss/log.jsonl [--bundle <pack>] --task <taskId> --answer <file>
 *
 * - `read` prints the six rows and every trigger with the lane it starts (`tools/wri/read.ts`), and
 *   the host hash of the last condition beside this checkout's.
 * - `start` writes that as `overview.md`, and the shared instructions with the campaign's row filled
 *   in and two sections left for the primary to write.
 * - `lanes` builds one prompt per lane and `launch.md`. With no `--lanes` it opens the lanes a
 *   trigger started and the standing ones; an isolated lane is built only when named. A prompt
 *   built before is kept, and `launch.md` lists every prompt that stands, each once.
 * - `collect` holds every expected report to its shape and writes `reports.md`. It exits 1 until
 *   every report is there and valid.
 * - `synthesis` renders the synthesis session's prompt over the reports as they stand.
 * - `grade` puts one answer to the campaign's own checker and prints the verdict in one line. It
 *   writes nothing and logs nothing. It needs the pack and its tool tree, and the Mac's verifier wall.
 *   A campaign over a stored pack names it with `--bundle`, and its checks stand beside the log; a
 *   campaign that drafted its exam names none, and its exam is read where the campaign staged it
 *   (`exams/<digest>/`, `tools/d2/exam.ts`). On 10 October t-10's lane 1 was given `<campaign>/checks`
 *   for a drafted exam and stopped on ENOENT.
 *
 * No verb starts a solve, a session or a round, and none appends to a log.
 */
import { read } from "#src/kernel/log.ts";
import { openVerifier, spelled } from "#src/kernel/verify.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { plural } from "#src/meta/text.ts";
import { treeContent } from "#src/solve/harness.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { stagedExamOf } from "../d2/exam.ts";
import { readPack } from "../m0/stored-sweep.ts";
import { catalogueText, type Lane, lanesOf, ownersOf, REFERENCES } from "./catalogue.ts";
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
}

const REPO = resolve(import.meta.dir, "..", "..");
const SHARED = "shared-instructions.md";
const USAGE = "usage: bun tools/wri/wri.ts read | start | lanes | collect | synthesis | grade";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    log: { type: "string" },
    out: { type: "string" },
    lanes: { type: "string" },
    bundle: { type: "string" },
    task: { type: "string" },
    answer: { type: "string" },
  },
});

function needed(name: "log" | "out" | "bundle" | "task" | "answer"): string {
  const value = values[name];
  if (value === undefined) throw new Error(`name --${name}`);
  return value;
}

/** One line on whether this checkout is the code the campaign last ran under. */
function hostLine(log: string): string {
  const ran = read(log).findLast(({ kind }) => kind === "condition.recorded")?.data.condition;
  const host = asRecord(ran)?.host;
  const last = isString(host) ? host : undefined;
  // The host's code as a condition names it (`tools/d2/campaign.ts`), for this checkout.
  const here = hashJsonValue(["src", "vendor"].map((part) => treeContent(join(REPO, part))));
  if (last === undefined) return `host code: no condition in the log; this checkout is ${here.slice(0, 8)}`;
  return last === here
    ? `host code: the last condition and this checkout are both ${here.slice(0, 8)}`
    : `host code: the last condition ran under ${last.slice(0, 8)} and this checkout is ${here.slice(0, 8)}, so every statement about source is about another tree`;
}

function overviewText(log: string): string {
  return `${rendered(overview(read(log)))}\n\n${hostLine(log)}\n`;
}

function start(): number {
  const [log, out] = [resolve(needed("log")), resolve(needed("out"))];
  if (existsSync(join(out, SHARED))) throw new Error(`${out} already holds ${SHARED}`);
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
  writeFileSync(join(out, "investigation.json"), `${JSON.stringify({ log }, null, 2)}\n`);
  console.log(text);
  console.log(`wrote ${join(out, SHARED)}: write its two blank sections, then run lanes`);
  return 0;
}

function opened(): Investigation {
  const out = resolve(needed("out"));
  const { log } = parseJsonAs<{ log: string }>(readFileSync(join(out, "investigation.json"), "utf8"));
  return { out, log, shared: readFileSync(join(out, SHARED), "utf8"), seen: overview(read(log)) };
}

const promptPath = (out: string, lane: number) => join(out, "lanes", `${stem(lane)}-prompt.md`);
const reportPath = (out: string, lane: number) => join(out, "lanes", `${stem(lane)}-report.md`);

/** One session's entry in `launch.md`. */
function launchEntry(out: string, lane: Lane): string {
  return [
    `## Lane ${String(lane.number)}: ${lane.title}${lane.isolated ? " (alone)" : ""}`,
    `Prompt: \`${promptPath(out, lane.number)}\``,
    `Report: \`${reportPath(out, lane.number)}\``,
    `One line to hand the session: Read \`${promptPath(out, lane.number)}\` and do exactly what it says.`,
  ].join("\n\n");
}

function lanes(): number {
  const { out, shared, seen } = opened();
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
  for (const lane of built) {
    const report = reportPath(out, lane.number);
    writeFileSync(
      promptPath(out, lane.number),
      `${lanePrompt({ lane, shared, overview: seen, catalogue, owners, report })}\n`,
    );
  }
  // The launch list is written whole from the prompts that stand, so a second build cannot list a
  // session twice, and its count stays the spend (SKILL.md, step 3).
  const listed = lanesOf(catalogue).filter((lane) => existsSync(promptPath(out, lane.number)));
  const launch = join(out, "launch.md");
  writeFileSync(launch, `# Launch\n\n${listed.map((lane) => launchEntry(out, lane)).join("\n\n")}\n`);
  console.log(`${plural(built.length, "lane")} built: ${built.map((lane) => lane.number).join(", ")}`);
  for (const lane of kept) console.log(`lane ${String(lane.number)}: built before, kept`);
  for (const lane of waiting) {
    console.log(
      `lane ${String(lane.number)} has its trigger and runs alone: read what it waits on, then build it with --lanes ${String(lane.number)}`,
    );
  }
  console.log(
    `one session per entry of ${launch}, ${String(listed.length)} in all; launch only those built now`,
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
  const tasks = [...writtenTasks(read(log)), ...readPack(bundle).tasks];
  const task = tasks.find((each) => each.taskId === taskId);
  if (task === undefined) throw new Error(`neither the log nor the pack holds task ${taskId}`);
  const verify = openVerifier({ checks, tools: join(bundle, ".toolchain"), packRoots: [bundle] });
  console.log(spelled(await verify(task, capturedJsonParse(readFileSync(needed("answer"), "utf8")))));
  return 0;
}

async function main(): Promise<number> {
  const [verb] = positionals;
  if (verb === "read") {
    console.log(overviewText(needed("log")));
    return 0;
  }
  if (verb === "grade") return grade();
  const step = Object.entries({ start, lanes, collect, synthesis }).find(([name]) => name === verb)?.[1];
  if (step === undefined) throw new Error(USAGE);
  return step();
}

runtimeProcess.exitCode = await main();
