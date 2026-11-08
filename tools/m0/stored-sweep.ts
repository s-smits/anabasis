/**
 * A v1 cycle sweep as its run left it on disk: `grades/<sweep>/grades.tsv` for the verdicts,
 * `runs/<sweep>/cNN/<task>/result.json` for the solve, and the case's `trace.json` for its turns.
 * The milestone tools test the new host on these stored solves, so no model session is needed.
 */
import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { claudeExecutable, SWEEP_COMPACT_WINDOW } from "#src/agent/backends/claude.ts";
import { type BackendOptions, backends } from "#src/agent/backends/models.ts";
import type { Control } from "#src/kernel/acceptance.ts";
import { type Contract, type Objective, objectiveLine } from "#src/kernel/contract.ts";
import type { Ending } from "#src/kernel/solve.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { applicableTruthChecks, readBrief, type Task, type Verdict } from "#src/kernel/verify.ts";
import { BRIEF_FILE, CONTROLS_FILE, TASKS_FILE } from "#src/meta/bundle-layout.ts";
import { cpSync, existsSync, readFileSync, renameSync, rmSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, join } from "#src/meta/path.ts";
import { type PublicResource, publicResource } from "#src/tools/answer.ts";
import { toolTreeSearchDirs } from "#src/wall/isolation.ts";

/** The fields of v1's `cycle-solve/v1` result read here. */
interface StoredSolve {
  readonly provider: string;
  readonly model: string;
  /** Whether the outer timeout ended the run. The harness's own wall, inside it, leaves a turn open. */
  readonly timedOut: boolean;
  readonly answerPresent: boolean;
  readonly answerParses: boolean;
}

/** The field of v1's `case-trace/v3` trace read here: a turn the wall cut is left `open`. */
interface StoredTurn {
  readonly status: "ended" | "open";
}

interface StoredTrace {
  readonly turns: readonly StoredTurn[];
}

export interface Row extends StoredSolve {
  readonly sweep: string;
  /** `cNN`, as the sweep names the cycle's directory. */
  readonly cycle: string;
  readonly taskId: string;
  /** The solve's directory under `runs/`. */
  readonly solve: string;
  /** v1's verdict, as the new verifier would spell it; null when v1's verifier did not decide. */
  readonly expected: Verdict | null;
  /** How the solve ended, as this host types it. */
  readonly ending: Ending;
}

/** The parts of v1's `brief.json` read here. */
interface PackBrief {
  readonly domain: string;
  /** What a task may ask and what a practitioner takes as given, where the brief says them: an
   *  exam drafted from a prompt does (`tools/d2/exam.ts`), and a v1 bundle's brief does not. */
  readonly scope?: string;
  readonly conventions?: string;
  readonly ruleDecisions: readonly (JsonObject & { id: string; statement: string; visibility: string })[];
  readonly truthChecks: readonly { assertion: string; execution: { publicInputPaths: string[] } }[];
  /** The objective, where the check program declares one (`src/kernel/contract.ts`). */
  readonly objective?: Objective;
  readonly artifactSchema: readonly JsonObject[];
  readonly designRuleConstants: readonly JsonObject[];
  readonly designRuleSets?: readonly JsonObject[];
}

/** v1's `controls.json`: answers the checks must accept, and edits of them that a named check must
 *  refuse. */
interface PackControls {
  readonly accept: readonly { taskId: string; artifact: JsonValue }[];
  readonly reject: readonly { taskId: string; artifact: JsonValue; expectedCheckId: string }[];
}

/** What v1 recorded of a stored solve's starting state (`built-runtime.json`). */
export interface StoredRuntime {
  readonly modelWorker: { modelSelection: { effort: ThinkingLevel } };
  readonly contractCondition: {
    systemPrompt: string;
    tools: StoredTool[];
    firstTurnTemplateDigest: string;
    nudgeDigest: string;
    maxTurns: number;
  };
}

/** One tool as v1 sent it to the model (`BuiltAgentInterfaceTool`, built-starter.ts:83-86). */
interface StoredTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: JsonValue;
  readonly executionMode?: string;
}

/** v1's non-result kinds (the sweep's `grade.py`, `solver_kind`), as this host types them. */
const NON_RESULTS = new Map<string, Extract<Ending, { outcome: "non-result" }>["kind"]>([
  ["non-result:provider", "provider"],
  ["non-result:provider-stall", "provider"],
  ["non-result:built", "sandbox-crash"],
  ["non-result:grader", "verifier"],
]);

/** The files of a v1 `correctness-model` that are its battery rather than its check program. */
const BATTERY_FILES = new Set(["tasks.json", "controls.json"]);

/**
 * Every solve the sweep graded, each typed. v1's verifier decided only some: the rest it graded
 * `unaccepted`, `wall-timeout` or a `non-result:<kind>`, and those are fails and non-results a count
 * by kind must not miss.
 */
export function sweepRows(root: string, sweep: string): Row[] {
  const lines = readFileSync(join(root, "grades", sweep, "grades.tsv"), "utf8")
    .trim()
    .split("\n")
    .slice(1);
  const rows: Row[] = [];
  for (const line of lines) {
    const [number = "", taskId = "", kind = "", blocking = ""] = line.split("\t");
    const expected: Verdict | null =
      kind === "verified-pass"
        ? { kind: "pass" }
        : kind === "verified-fail"
          ? { kind: "fail", blocking: blocking.split(",").filter(Boolean) }
          : null;
    const cycle = `c${number.padStart(2, "0")}`;
    const solve = join(root, "runs", sweep, cycle, taskId);
    const stored = parseJsonAs<StoredSolve>(readFileSync(join(solve, "result.json"), "utf8"));
    const { turns } = parseJsonAs<StoredTrace>(
      readFileSync(join(solve, "harness", "cases", taskId, "trace.json"), "utf8"),
    );
    rows.push({
      ...stored,
      sweep,
      cycle,
      taskId,
      solve,
      expected,
      ending: endingOf(stored, turns, kind, expected),
    });
  }
  return rows;
}

/** A stored solve's ending. v1 recorded no fail kinds, so they are read back from what the solve left. */
function endingOf(
  stored: StoredSolve,
  turns: readonly StoredTurn[],
  kind: string,
  expected: Verdict | null,
): Ending {
  if (kind.startsWith("non-result:")) {
    const typed = NON_RESULTS.get(kind);
    if (typed === undefined) throw new Error(`v1 graded a solve ${kind}, which this reader does not know`);
    return { outcome: "non-result", kind: typed, reason: kind };
  }
  if (expected?.kind === "pass") return { outcome: "pass" };
  if (stored.timedOut || turns.some((turn) => turn.status === "open")) {
    return { outcome: "fail", kind: "wall-ended" };
  }
  if (!stored.answerPresent || !stored.answerParses) return { outcome: "fail", kind: "no-answer" };
  return { outcome: "fail", kind: "rejected" };
}

/**
 * A v1 bundle's check program, copied to `to` without its battery: the verifier hands a check its
 * whole program, and `tasks.json` and `controls.json` hold every task's hidden values and every
 * control. Returns `to`. The copy is made beside it and renamed into place once whole: a campaign
 * stages its checks where none are (`packOpened`, `campaign.ts`), and until 14 October a copy cut
 * short left a folder there that every later run took for the whole program.
 */
export function checkProgram(bundle: string, to: string): string {
  const filter = (path: string) => !BATTERY_FILES.has(basename(path));
  const partial = `${to}.partial`;
  rmSync(partial, { recursive: true, force: true });
  cpSync(join(bundle, "correctness-model"), partial, { recursive: true, filter });
  renameSync(partial, to);
  return to;
}

/**
 * The answer format a solve's record tool took, as v1 recorded it byte for byte in the solve's
 * `built-runtime.json`: the artifact-writer's parameters, which v1 compiled from the brief's prose
 * `artifactSchema` rows (H public-artifact-writer.ts:57-64) and which a v2 contract holds as its
 * answer format.
 */
export function recordedAnswerFormat(row: Row): JsonValue {
  const writer = storedRuntime(row).contractCondition.tools.find((tool) =>
    tool.description.startsWith("Role: artifact-writer."),
  );
  if (writer === undefined) throw new Error(`${row.solve} records no artifact-writer`);
  return writer.parameters;
}

/** What v1 recorded of the solve's starting state. */
export function storedRuntime(row: Row): StoredRuntime {
  return parseJsonAs<StoredRuntime>(
    readFileSync(join(row.solve, "harness", "cases", row.taskId, "built-runtime.json"), "utf8"),
  );
}

/** The answer the solve left, or none when it left no file or one that does not read as JSON. */
export function storedAnswer(row: Row): JsonValue | undefined {
  const path = join(row.solve, "work", "answer.json");
  if (!existsSync(path)) return undefined;
  try {
    return capturedJsonParse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** The backends set as the sweep ran its Claude solves, for a model process keeping its state in
 *  `home`; a campaign's `--solver-window` names another window (`tools/d2/setting.ts`). A solve's
 *  cache lives five minutes: over 110,009 recorded solver turns, 0.9% came more than five minutes
 *  after the one before, and the hour-long writes a login gets by default billed 13% more than
 *  five-minute writes would have (20 October). */
export function sweepOptions(
  home = homedir(),
  window = SWEEP_COMPACT_WINDOW,
  shutdown?: AbortSignal,
): BackendOptions {
  return {
    claude: { executable: claudeExecutable(), compaction: { window }, home, cacheTtl: "5m", shutdown },
  };
}

/** The model a row ran, from the backends this system runs on. */
export function rowModel(row: Row): Model<Api> {
  return modelNamed(`${row.provider}/${row.model}`);
}

/** `provider/model`, as a condition names a model, resolved on this host's backends. */
export function modelNamed(name: string): Model<Api> {
  const [provider = "", ...id] = name.split("/");
  const model = backends(sweepOptions()).getModel(provider, id.join("/"));
  if (model === undefined) throw new Error(`no backend serves ${name}`);
  return model;
}

/** A v1 check program's pack: its brief, its tasks and their hidden values, and its controls. */
export function readPack(bundle: string) {
  const read = (file: string): string => readFileSync(join(bundle, file), "utf8");
  return { brief: parseJsonAs<PackBrief>(read(BRIEF_FILE)), tasks: parseJsonAs<Task[]>(read(TASKS_FILE)) };
}

/** Whether the bundle's tool tree holds a tool on the path a check is given, by its id. */
export function toolOnPath(bundle: string): (toolId: string) => boolean {
  const path = toolTreeSearchDirs(join(bundle, ".toolchain")).join(":");
  return (toolId) => Bun.which(toolId, { PATH: path }) !== null;
}

/** A pack's controls, each with the label its author gave it: the accept controls, then the reject
 *  controls, in the file's order. */
export function packControls(bundle: string): Control[] {
  const { accept, reject } = parseJsonAs<PackControls>(readFileSync(join(bundle, CONTROLS_FILE), "utf8"));
  return [
    ...accept.map(({ taskId, artifact }) => ({ taskId, answer: artifact, refusedBy: null })),
    ...reject.map(({ taskId, artifact, expectedCheckId }) => ({
      taskId,
      answer: artifact,
      refusedBy: expectedCheckId,
    })),
  ];
}

/** The stand-in contract: the brief's public rule decisions are its rules, and its answer format is
 *  the schema the sweep's record tool took (`recordedAnswerFormat`). */
export function contractOf(brief: PackBrief, answerFormat: JsonValue): Contract {
  return {
    answerFormat,
    conventions: brief.conventions ?? "",
    rules: brief.ruleDecisions.filter((rule) => rule.visibility === "public"),
    scope: brief.scope ?? brief.domain,
    ...keyIfDefined("objective", brief.objective),
  };
}

/** A v1 task as a package: its rule ids are those its family's checks cite. */
export function packageOf(checks: string, task: Task): TaskPackage {
  const cited = applicableTruthChecks(readBrief(checks), task).flatMap((check) => check.citedDecisionIds);
  return { ...task, ruleIds: [...new Set(cited)], checks };
}

/**
 * The public resources the sweep's solver read, sed from harness-builder-v4,
 * `7af7315:src/truth/public-resources.ts:118-144` with the row projections of lines 66-111: each row is
 * rebuilt from its declared fields alone, in their order, and a field the row lacks is left out.
 */
export function sweepResources(brief: PackBrief): PublicResource[] {
  const rows = (list: readonly JsonObject[], keys: readonly string[]): JsonObject[] =>
    list.map((row) =>
      Object.fromEntries(keys.flatMap((key) => (row[key] === undefined ? [] : [[key, row[key]]]))),
    );
  const named: [string, JsonValue[]][] = [
    // What a task may ask and what a practitioner takes as given, where the brief says them: an
    // exam drafted from a prompt states its units and tolerances there, and a solver is held to
    // nothing it could not read. A v1 bundle's brief says neither, and gets no such file.
    [
      "public-scope",
      brief.scope === undefined && brief.conventions === undefined
        ? []
        : [{ domain: brief.domain, scope: brief.scope ?? "", conventions: brief.conventions ?? "" }],
    ],
    // The objective is public with the rules: a solver held to it has to read it (10 October).
    [
      "public-objective",
      brief.objective === undefined
        ? []
        : [{ ...brief.objective, statement: objectiveLine(brief.objective) }],
    ],
    [
      "public-validity-rules",
      brief.truthChecks.map((check) => ({
        assertion: check.assertion,
        publicInputPaths: check.execution.publicInputPaths,
      })),
    ],
    // public-resources.ts:113-117 and 66-75.
    [
      "public-rule-decisions",
      rows(
        brief.ruleDecisions.filter((decision) => decision.visibility === "public"),
        ["id", "visibility", "statement", "source", "families", "publicInputPaths"],
      ),
    ],
    [
      "artifact-schema",
      rows(brief.artifactSchema, [
        "name",
        "shape",
        "allowedValues",
        "fileMap",
        "taskConditioned",
        "openMapPaths",
      ]),
    ],
    [
      "design-rule-constants",
      rows(brief.designRuleConstants, ["name", "value", "unit", "authority", "citation"]),
    ],
    [
      "design-rule-sets",
      rows(brief.designRuleSets ?? [], ["name", "values", "unit", "authority", "citation"]),
    ],
  ];
  return named.flatMap(([name, content]) => (content.length > 0 ? [publicResource(name, content)] : []));
}
