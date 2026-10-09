/**
 * A v1 cycle sweep as its run left it on disk: `grades/<sweep>/grades.tsv` for the verdicts,
 * `runs/<sweep>/cNN/<task>/result.json` for the solve, and the case's `trace.json` for its turns.
 * The milestone tools test the new host on these stored solves, so no model session is needed.
 *
 * Dollars come two ways. Billed is what v1 recorded Claude Code reporting a turn cost. Metered is
 * this meter's, which charges cached input at the full price. v1's trace keeps each turn's input
 * with its cached part inside and no split, so billed cannot be recomputed from it; metered needs
 * no split, since it charges the classes alike.
 */
import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import { claudeExecutable, SWEEP_COMPACT_WINDOW } from "#src/backends/claude.ts";
import { type BackendOptions, backends } from "#src/backends/models.ts";
import type { Control } from "#src/kernel/acceptance.ts";
import type { Contract } from "#src/kernel/contract.ts";
import { dollars, freezePrices, type PriceTable } from "#src/kernel/meter.ts";
import type { Ending } from "#src/kernel/solve.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { applicableTruthChecks, readBrief, type Task, type Verdict } from "#src/kernel/verify.ts";
import { CONTROLS_FILE } from "#src/meta/bundle-layout.ts";
import { cpSync, existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, join } from "#src/meta/path.ts";
import { type PublicResource, publicResource } from "#src/solve/answer.ts";
import { toolTreeSearchDirs } from "#src/verify/solve-command-isolation.ts";

/** The fields of v1's `cycle-solve/v1` result read here. */
interface StoredSolve {
  readonly provider: string;
  readonly model: string;
  /** Whether the outer timeout ended the run. The harness's own wall, inside it, leaves a turn open. */
  readonly timedOut: boolean;
  readonly answerPresent: boolean;
  readonly answerParses: boolean;
}

/** The fields of v1's `case-trace/v3` trace read here. A turn the wall cut is left `open`, with its
 *  token counts and cost null: Claude Code reports them only when a turn ends. */
type StoredTurn =
  | {
      readonly status: "ended";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly costUsd: number;
    }
  | { readonly status: "open" };

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
  readonly turns: readonly StoredTurn[];
}

/** The parts of v1's `brief.json` read here. */
interface PackBrief {
  readonly domain: string;
  readonly ruleDecisions: readonly (JsonObject & { id: string; statement: string; visibility: string })[];
  readonly truthChecks: readonly { assertion: string; execution: { publicInputPaths: string[] } }[];
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

/** A row and its two dollar readings. */
interface Priced {
  readonly row: Row;
  readonly billed: number;
  readonly metered: number;
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
export interface StoredTool {
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
      turns,
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
 * control. Returns `to`.
 */
export function checkProgram(bundle: string, to: string): string {
  const filter = (path: string) => !BATTERY_FILES.has(basename(path));
  cpSync(join(bundle, "correctness-model"), to, { recursive: true, filter });
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

/** The backends set as the sweep ran its Claude solves, for a model process keeping its state in `home`. */
export function sweepOptions(home = homedir()): BackendOptions {
  return { claude: { executable: claudeExecutable(), compaction: { window: SWEEP_COMPACT_WINDOW }, home } };
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

/**
 * A stored solve's spend: its billed dollars, as v1 recorded them, and its metered ones. Null when a
 * turn never ended, since what it spent was never reported: that solve's cost is unknown, not zero.
 */
function spend(row: Row, prices: PriceTable) {
  const ended = row.turns.filter((turn) => turn.status === "ended");
  if (ended.length < row.turns.length) return null;
  const sum = (field: "inputTokens" | "outputTokens" | "costUsd") =>
    ended.reduce((total, turn) => total + turn[field], 0);
  const tokens = {
    input: sum("inputTokens"),
    cacheRead: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    output: sum("outputTokens"),
  };
  return { billed: sum("costUsd"), metered: dollars(prices, `${row.provider}/${row.model}`, tokens).metered };
}

/** The rows with both dollar readings, and apart from them the rows whose cost was never reported. */
export function pricedRows(rows: readonly Row[]) {
  // The list prices of the models the rows ran.
  const named = new Map(rows.map((row) => [`${row.provider}/${row.model}`, row]));
  const prices = freezePrices([...named.values()].map(rowModel));
  const priced: Priced[] = [];
  const unpriced: Row[] = [];
  for (const row of rows) {
    const spent = spend(row, prices);
    if (spent === null) {
      unpriced.push(row);
    } else {
      priced.push({ row, ...spent });
    }
  }
  return { priced, unpriced };
}

/** A v1 check program's pack: its brief, its tasks and their hidden values, and its controls. */
export function readPack(bundle: string) {
  const read = <T>(file: string) =>
    parseJsonAs<T>(readFileSync(join(bundle, "correctness-model", file), "utf8"));
  return { brief: read<PackBrief>("brief.json"), tasks: read<Task[]>("tasks.json") };
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
    conventions: "",
    rules: brief.ruleDecisions.filter((rule) => rule.visibility === "public"),
    scope: brief.domain,
  };
}

/** A v1 task as a package: its rule ids are those its family's checks cite. */
export function packageOf(checks: string, task: Task): TaskPackage {
  const cited = applicableTruthChecks(readBrief(checks), task).flatMap((check) => check.citedDecisionIds);
  return { ...task, ruleIds: [...new Set(cited)], checks };
}

/**
 * The public resources the sweep's solver read, sed from harness-builder-v4 at 7af7315,
 * `src/truth/public-resources.ts:118-144` with the row projections of lines 66-111: each row is
 * rebuilt from its declared fields alone, in their order, and a field the row lacks is left out.
 */
export function sweepResources(brief: PackBrief): PublicResource[] {
  const rows = (list: readonly JsonObject[], keys: readonly string[]): JsonObject[] =>
    list.map((row) =>
      Object.fromEntries(keys.flatMap((key) => (row[key] === undefined ? [] : [[key, row[key]]]))),
    );
  const named: [string, JsonValue[]][] = [
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
        ["id", "visibility", "statement", "families", "publicInputPaths"],
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
