/**
 * Ask an already-built Built Harness one or more questions. No Builder, no authoring, no campaign.
 *
 * Every Built Harness bundle keeps the starter-pack layout (`starters/pi-built-harness`):
 * agent/ + <model>/tasks.json + <model>/controls.json, recorded with an optional conformance.json,
 * where <model> is `correctness-model/` (current) or `grader/` (older bundles). `modelDir` names it
 * once for every read and write below. That shared layout is why one wrapper works for every
 * bundle: the pipeline is
 *
 *   select tasks -> derive probe bundle -> measure -> report
 *
 * and only `deriveProbeBundle` knows the layout. Measurement is `measureHarness` from the tree
 * under test — the same function the controller calls for a climb battery — so the solve path,
 * isolation wall and host verifier are the product's own.
 *
 *   bun .claude/skills/harness-query/scripts/harness-query.mts \
 *     --harness domains/<slug> --list
 *   bun .claude/skills/harness-query/scripts/harness-query.mts \
 *     --harness domains/<slug> --task <taskId> --model claude-opus-5 --effort medium
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { basename, join, resolve } from "#src/meta/path.ts";
import { BRIEF_FILE, CONTROLS_FILE, TASKS_FILE } from "#src/meta/bundle-layout.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { type CommandArgs, type CommandSpec, runCommand } from "#skills/main/cli.ts";
import {
  BUNDLE_SNAPSHOT_DIRECTORY,
  EARLIER_BUNDLE_SNAPSHOT_DIRECTORY,
  bundleSnapshotToolTree,
} from "#src/claim/bundle-snapshot.ts";
import { resolveToolInventory } from "#src/verify/tool-inventory.ts";
import { batteryPath, readRecordedBatteryRecord } from "#src/correctness-bundle/battery-record.ts";
import { classifyCaseOutcome, outcomeTally } from "#src/claim/case-record.ts";
import { JUDGE_FLAG_DEFAULTS, type JudgeFlags, judgeProfileFor } from "../judge/judge-option.mts";
import { asRecord, isRecord, isString, jsonKind } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { keyIfNotNull } from "#src/meta/optional-key.ts";
import { CONFORMANCE_FILE } from "#src/claim/conformance-evidence.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

interface Task {
  taskId: string;
  family: string;
  publicInput: JsonValue;
  hidden: JsonValue[];
  level?: number;
}

interface ControlRow {
  id: string;
  taskId?: string | null;
}

interface Controls {
  accept: ControlRow[];
  reject: ControlRow[];
}

interface Options {
  repoRoot: string;
  harnessDir: string;
  taskIds: readonly string[];
  families: readonly string[];
  all: boolean;
  queries: readonly string[];
  queryFile: string | null;
  fit: string;
  list: boolean;
  model: string | null;
  effort: string | null;
  maxTurns: number | null;
  json: boolean;
  /** Which reviewer sees the shipped artifacts, if any; judge/judge-option.mts owns the choice. */
  judge: JudgeFlags;
}

const USAGE = [
  "bun harness-query.mts --harness <dir> [--repo <dir>] [--list]",
  "  [--task <id>]... [--family <name>]... [--all] [--query <text or json>]... [--queries <file>]",
  "  [--fit template|strict|raw] [--model <m>] [--effort <e>] [--max-built-turns <n>] [--json]",
  "  [--judge off|configured] [--judge-model <m>] [--judge-effort <e>]",
].join("\n");

const COMMAND: CommandSpec = {
  name: "harness-query",
  usage: USAGE,
  options: {
    repo: "text",
    harness: "text",
    task: "list",
    family: "list",
    all: "flag",
    query: "list",
    queries: "text",
    fit: "text",
    list: "flag",
    model: "text",
    effort: "text",
    "max-built-turns": "int",
    json: "flag",
    judge: "text",
    "judge-model": "text",
    "judge-effort": "text",
  },
};

function optionsFrom(args: CommandArgs): Options {
  const repoRoot = resolve(args.value("repo") ?? runtimeProcess.cwd());
  const harnessDir = resolve(repoRoot, args.required("harness"));
  // Read before the bundle check, so a malformed count refuses as an argument (exit 2).
  const maxTurns = args.int("max-built-turns");
  if (!existsSync(join(harnessDir, "agent")) || !existsSync(join(harnessDir, modelDir(harnessDir)))) {
    throw new Error(
      `${harnessDir}: not a Built Harness bundle (needs agent/ and correctness-model/ or grader/)`,
    );
  }
  const queryFile = args.value("queries");
  return {
    repoRoot,
    harnessDir,
    taskIds: args.list("task"),
    families: args.list("family"),
    all: args.flag("all"),
    queries: args.list("query"),
    queryFile: queryFile === null ? null : resolve(queryFile),
    fit: args.value("fit") ?? "template",
    list: args.flag("list"),
    model: args.value("model"),
    effort: args.value("effort"),
    maxTurns,
    json: args.flag("json"),
    judge: {
      profile: args.value("judge") ?? JUDGE_FLAG_DEFAULTS.profile,
      model: args.value("judge-model"),
      effort: args.value("judge-effort"),
    },
  };
}

/** The bundle's correctness-model directory name: `grader` only for a bundle that has that
 *  spelling alone. */
function modelDir(dir: string): "correctness-model" | "grader" {
  return !existsSync(join(dir, "correctness-model")) && existsSync(join(dir, "grader"))
    ? "grader"
    : "correctness-model";
}

/** One bundle-layout file under the model directory; the bundle was checked for one at parse time. */
function modelFile(dir: string, file: string): string {
  return join(dir, modelDir(dir), basename(file));
}

function maybeJson(text: string): JsonValue {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/** One CSV line into fields, with doubled quotes inside a quoted field. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push(field);
      field = "";
    } else field += char;
  }
  fields.push(field);
  return fields;
}

/** The shapes people paste, read without a flag to say which: a JSON document, one JSON object
 *  per line, a CSV with a header row, or one plain query per line. */
function readQueryFile(file: string): readonly JsonValue[] {
  const text = readFileSync(file, "utf8").trim();
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed: JsonValue = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // JSONL starts with "{" too; fall through to the per-line reading below.
    }
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const first = lines[0] ?? "";
  const header = csvFields(first);
  if (file.endsWith(".csv") || (header.length > 1 && !first.trim().startsWith("{"))) {
    return lines.slice(1).map((line) => {
      const fields = csvFields(line);
      return Object.fromEntries(header.map((name, index) => [name.trim(), maybeJson(fields[index] ?? "")]));
    });
  }
  return lines.map((line) => maybeJson(line));
}

/** A query row is either a whole task or a bare publicInput that gets wrapped into one. */
function toTask(row: JsonValue, index: number, fallbackFamily: string | undefined): Task {
  const record = asRecord(row);
  if (record !== null && isString(record.taskId) && isString(record.family) && "publicInput" in record) {
    // SAFETY: the three fields `Task` requires were just checked and `hidden` is defaulted here.
    // The rest of a recorded row travels as written, because a bundle task may carry fields this
    // script never reads and the measured harness does.
    return { ...record, hidden: record.hidden ?? [] } as Task;
  }
  if (fallbackFamily === undefined) {
    throw new Error("a bare query row needs --family, or a bundle task to borrow one from");
  }
  return { taskId: `written-${index + 1}`, family: fallbackFamily, publicInput: row, hidden: [] };
}

/**
 * A harness checks the shape it was authored for. A query written as free text, or as an object
 * missing fields, may omit a value the check requires.
 *
 * A written query therefore borrows structure and omitted values from a recorded task in its
 * family: free text replaces the template's text field, an object's fields override the template's.
 * This can satisfy the public schema; it does not establish the new query's expected answer.
 * Hidden expectations remain empty unless supplied. A required hidden operand must refuse when absent.
 *
 * `--fit raw` sends exactly what was written, which is how the harness's own defensiveness gets
 * probed; `--fit strict` refuses a mismatch instead of filling it.
 */
function fitToBundle(task: Task, recordedTasks: Task[], mode: string) {
  if (mode === "raw") return { task, note: "raw" };
  const template =
    recordedTasks.find((row) => row.family === task.family)?.publicInput ?? recordedTasks[0]?.publicInput;
  if (!isRecord(template)) return { task, note: "no structured template in this bundle" };
  const missing = (given: string[]) => Object.keys(template).filter((key) => !given.includes(key));

  if (isRecord(task.publicInput)) {
    const absent = missing(Object.keys(task.publicInput));
    if (absent.length === 0) return { task, note: "matches the bundle shape" };
    if (mode === "strict") {
      throw new Error(`query "${task.taskId}" is missing publicInput fields: ${absent.join(", ")}`);
    }
    return {
      task: { ...task, publicInput: { ...template, ...task.publicInput, ...idField(template, task) } },
      note: `filled from the family template: ${absent.join(", ")}`,
    };
  }

  // The field a free-text query is written into: a named text field when the bundle has one,
  // otherwise the template's first string-valued field.
  const named = ["objective", "request", "prompt", "question", "brief", "goal"].find((name) =>
    isString(template[name]),
  );
  const field = named ?? Object.keys(template).find((key) => isString(template[key]));
  if (mode === "strict" || field === undefined) {
    throw new Error(
      `query "${task.taskId}" is free text but this bundle takes an object with: ${Object.keys(template).join(", ")}`,
    );
  }
  return {
    task: { ...task, publicInput: { ...template, [field]: task.publicInput, ...idField(template, task) } },
    note: `written into "${field}" of the family template`,
  };
}

/** Keep a template's own case identifier from travelling with the borrowed structure. */
function idField(template: JsonObject, task: Task) {
  return "caseId" in template ? { caseId: task.taskId } : {};
}

/** A written query has no controls. Recorded tasks accompany it as anchors so their accept and
 *  reject controls can exercise family discrimination. Use one task when it carries both controls,
 *  two when the bundle put them on different tasks; each costs one extra solve. These controls
 *  calibrate the recorded tasks, not the new query's expected answer. */
function anchorsFor(family: string, recordedTasks: Task[], controls: Controls): Task[] {
  const inFamily = recordedTasks.filter((task) => task.family === family);
  const carries = (rows: ControlRow[]) => (task: Task) => rows.some((row) => row.taskId === task.taskId);
  const both = inFamily.find((task) => carries(controls.accept)(task) && carries(controls.reject)(task));
  if (both !== undefined) return [both];
  const accept = inFamily.find(carries(controls.accept));
  const reject = inFamily.find(carries(controls.reject));
  if (accept === undefined || reject === undefined) {
    throw new Error(
      `family "${family}" has no recorded task carrying an ${accept === undefined ? "accept" : "reject"} control`,
    );
  }
  return [accept, reject];
}

function selectTasks(recordedTasks: Task[], controls: Controls, options: Options): Task[] {
  const rows = [
    ...options.queries.map((query) => maybeJson(query)),
    ...(options.queryFile === null ? [] : readQueryFile(options.queryFile)),
  ];
  if (rows.length > 0) {
    const written = rows.map((row, index) => {
      const wrapped = toTask(row, index, options.families[0] ?? recordedTasks[0]?.family);
      const { task, note } = fitToBundle(wrapped, recordedTasks, options.fit);
      console.log(`  query ${task.taskId}: ${note}`);
      return task;
    });
    // Older bundle generations bind no control to a task; those corpora survive any narrowing and
    // need no anchor. Only a task-bound corpus makes family isolation depend on which tasks run.
    const bound = [...controls.accept, ...controls.reject].some((row) => row.taskId != null);
    const anchors = bound
      ? [...new Set(written.map((task) => task.family))].flatMap((family) =>
          anchorsFor(family, recordedTasks, controls),
        )
      : [];
    return [...anchors, ...written];
  }
  if (options.taskIds.length > 0) {
    return options.taskIds.map((id) => {
      const found = recordedTasks.find((task) => task.taskId === id);
      if (found === undefined) throw new Error(`no recorded task with id ${id}; run --list to see them`);
      return found;
    });
  }
  if (options.families.length > 0) {
    const chosen = recordedTasks.filter((task) => options.families.includes(task.family));
    if (chosen.length === 0) throw new Error(`no recorded task in families ${options.families.join(", ")}`);
    return chosen;
  }
  if (options.all) return recordedTasks;
  throw new Error(
    "name what to invoke: --task <id>, --family <name>, --query <text or json>, --queries <file>, or --all",
  );
}

/** Declared tools that resolve to no executable on this host.
 *
 *  A truth check names the instrument it decides with. The host resolves that id once under the
 *  candidate's `.toolchain` and then the host PATH; when neither holds it, every applicable check
 *  throws and each control comes back `non-result (verifier-throw)`. The battery then refuses at
 *  the control census with `DISCRIMINATION_NOT_PROVEN`, which reads as a bundle defect and is in
 *  fact a missing program: a committed bundle's `.toolchain` is a link into a campaign workspace
 *  that may no longer exist, so a bundle needing `platformio` measures nothing on a host without it
 *  while one needing only `clang++` measures normally.
 *
 *  Naming it before the copy keeps the refusal free: no probe bundle, no solve, no paid turn. */
function unresolvedDeclaredTools(dir: string): string[] {
  let brief: JsonValue;
  try {
    brief = readJsonFile(modelFile(dir, BRIEF_FILE));
  } catch {
    // No readable brief means no declared tools to check; the bundle gates still run below.
    return [];
  }
  const declared = asRecord(brief)?.truthChecks;
  const ids = new Set(
    (Array.isArray(declared) ? declared : []).flatMap((check) => {
      const execution = asRecord(asRecord(check)?.execution);
      // `requiredToolIds` sits on the execution row in older bundles and under `evidence` in
      // `check-program/v1`; read both rather than one.
      const nested = asRecord(execution?.evidence)?.requiredToolIds;
      return [execution?.requiredToolIds, nested]
        .flatMap((source) => (Array.isArray(source) ? source : []))
        .filter(isString);
    }),
  );
  if (ids.size === 0) return [];
  return resolveToolInventory({ toolIds: [...ids], toolTree: bundleSnapshotToolTree(dir) }).missing;
}

/** One digest over the measured agent/ and model bytes, so a later reader can say what ran. */
function bundleDigest(dir: string): string {
  const hash = new Bun.CryptoHasher("sha256");
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${entry}/`);
      else hash.update(`${prefix}${entry}\0`).update(readFileSync(path));
    }
  };
  for (const part of ["agent", modelDir(dir)]) walk(join(dir, part), `${part}/`);
  return hash.digest("hex");
}

/** Replace a file in the probe copy.
 *
 *  A retained version path leaves its product files read-only (0444) and `cpSync` carries that
 *  mode into the copy, so an ordinary write fails with EACCES. The copied directories stay
 *  writable, so removing the file first and writing a fresh one needs no mode change; the
 *  retained bytes are untouched either way. */
function rewriteCopyFile(path: string, text: string): void {
  rmSync(path, { force: true });
  writeFileSync(path, text);
}

/**
 * Copy the bundle into scratch and make the copy self-consistent for the chosen battery. This is
 * the one place that knows the starter-pack layout, and each edit answers one product guard:
 *
 * - the driver refuses supplied tasks that differ from the model directory's tasks.json, so a claim naming the
 *   recorded task-set hash cannot execute an easier battery. The copy's tasks.json becomes the
 *   selection, which gives it its own honest task-set hash.
 * - conformance.json binds the full recorded battery by hash, so a narrowed copy drops it; the claim
 *   then truthfully says conformance-unprobed.
 * - controls are task-bound, and a control naming an absent task makes discrimination unclaimable
 *   before anything is spent, so the corpus keeps only the rows that still bind.
 *
 * The probe never writes into the adopted tree: runs/ land in the copy, and the guards themselves
 * stay untouched in source.
 */
function deriveProbeBundle(
  options: Options,
  runId: string,
  tasks: Task[],
  recordedTasks: Task[],
  controls: Controls,
) {
  const dir = join(options.repoRoot, ".scratch", "harness-query", runId, basename(options.harnessDir));
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(options.harnessDir)) {
    if (
      entry === "runs" ||
      entry === BUNDLE_SNAPSHOT_DIRECTORY ||
      entry === EARLIER_BUNDLE_SNAPSHOT_DIRECTORY
    ) {
      continue;
    }
    cpSync(join(options.harnessDir, entry), join(dir, entry), { recursive: true });
  }
  const narrowed = JSON.stringify(tasks) !== JSON.stringify(recordedTasks);
  if (narrowed) {
    rewriteCopyFile(modelFile(dir, TASKS_FILE), `${JSON.stringify(tasks, null, 2)}\n`);
    rmSync(join(dir, CONFORMANCE_FILE), { force: true });
    const ids = new Set(tasks.map((task) => task.taskId));
    const keep = (rows: ControlRow[]) => rows.filter((row) => row.taskId == null || ids.has(row.taskId));
    rewriteCopyFile(
      modelFile(dir, CONTROLS_FILE),
      `${JSON.stringify({ accept: keep(controls.accept), reject: keep(controls.reject) }, null, 2)}\n`,
    );
  }
  return { dir, narrowed, digest: bundleDigest(dir) };
}

/** The probe's battery through the controller's own recorded-evidence reader, or null when the
 *  battery refused before it wrote one. */
function readBattery(dir: string, runId: string) {
  return existsSync(batteryPath(dir, runId))
    ? readRecordedBatteryRecord(join(dir, "runs", runId), runId)
    : null;
}

function printTaskList(recordedTasks: Task[]): void {
  console.log(`${recordedTasks.length} recorded tasks`);
  for (const task of recordedTasks) {
    const input = asRecord(task.publicInput);
    const keys = input === null ? String(jsonKind(task.publicInput)) : Object.keys(input).join(", ");
    console.log(
      `  ${task.taskId}\n    family ${task.family}${task.level === undefined ? "" : `, level ${task.level}`}` +
        `, ${task.hidden.length} hidden expectations\n    publicInput: ${keys}`,
    );
  }
}

async function main(args: CommandArgs): Promise<void> {
  const options = optionsFrom(args);
  const recordedTasks: Task[] = JSON.parse(readFileSync(modelFile(options.harnessDir, TASKS_FILE), "utf8"));
  if (options.list) return printTaskList(recordedTasks);

  // Resolved and described before the probe copy, so an unknown profile, a missing credential or
  // a misconfigured endpoint refuses here, with nothing derived and no turn spent.
  const source = basename(options.harnessDir);
  const slug = `${source}-probe`;
  const unresolved = unresolvedDeclaredTools(options.harnessDir);
  if (unresolved.length > 0) {
    throw new Error(
      `${options.harnessDir}: declared tool(s) [${unresolved.join(", ")}] resolve to no executable ` +
        `under the bundle's .toolchain or this host's PATH. Every applicable check would throw and ` +
        `every control would record non-result (verifier-throw). Install them, or measure a bundle ` +
        `whose declared tools this host has.`,
    );
  }
  const judgeProfile = await judgeProfileFor(options.judge);
  const judgeLine = judgeProfile.describe({ repoRoot: options.repoRoot, slug });
  const controls: Controls = JSON.parse(readFileSync(modelFile(options.harnessDir, CONTROLS_FILE), "utf8"));
  const tasks = selectTasks(recordedTasks, controls, options);
  const runId = `probe-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const probe = deriveProbeBundle(options, runId, tasks, recordedTasks, controls);

  if (options.model !== null) Bun.env.CLAUDE_BUILT_MODEL = options.model;
  if (options.effort !== null) Bun.env.CLAUDE_BUILT_REASONING_EFFORT = options.effort;

  console.log(
    `harness ${options.harnessDir}\n  probe copy ${probe.dir}\n  bundle sha256 ${probe.digest}` +
      `${probe.narrowed ? " (battery narrowed to the named tasks)" : ""}\n` +
      `  tasks ${tasks.map((task) => task.taskId).join(", ")}\n  runId ${runId}\n` +
      `  ${judgeLine}`,
  );

  const measure = await import(Bun.pathToFileURL(join(options.repoRoot, "src/run/harness-measure.ts")).href);
  try {
    // A probe slug keeps case rows and any claim decision out of the real campaign. The
    // battery runs under the id given here: one battery per measurement, no condition suffix.
    await measure.measureHarness(
      { slug, domain: source, expectedTasks: tasks.length, engineSessions: [] },
      {
        runId,
        judge: await judgeProfile.open({ repoRoot: options.repoRoot, slug }),
        repoRoot: options.repoRoot,
        domainDir: probe.dir,
        tasks,
        ...keyIfNotNull("maxTurns", options.maxTurns),
      },
    );
  } catch (error) {
    // A refused battery states its reason in its own record; print it, because the thrown
    // message alone reads as a script fault when it is usually the product declining to spend.
    const record = readBattery(probe.dir, runId);
    if (record !== null) console.log(`\nbattery: ${record.terminalReason}`);
    throw error;
  }

  // The controller's classifier and tally, so this probe and the battery it rehearses count one
  // case the same way.
  const rows = (readBattery(probe.dir, runId)?.cases ?? []).map((row) => ({
    taskId: row.taskId,
    outcome: classifyCaseOutcome(row),
    nonResultKind: row.runtimeNonResultKind,
  }));
  const tally = outcomeTally(rows.map((row) => row.outcome));
  console.log(
    `\n${tally.passed}/${tally.verified} verified cases passed; ${tally.unaccepted} unaccepted; ${tally.nonResults} non-results`,
  );
  for (const row of rows) {
    const verdict =
      row.outcome === "non-result" ? `non-result (${row.nonResultKind ?? "typed"})` : row.outcome;
    console.log(
      `  ${row.taskId}: ${verdict}\n    artifact ${join(probe.dir, "runs", runId, "cases", row.taskId)}`,
    );
  }
  const report = { runId, harness: options.harnessDir, probe: probe.dir, digest: probe.digest, rows };
  const reportPath = join(probe.dir, "runs", runId, "harness-query.json");
  if (existsSync(join(probe.dir, "runs", runId))) {
    writeJsonFile(reportPath, report);
    console.log(`\nreport ${reportPath}`);
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) await runCommand(COMMAND, main);
