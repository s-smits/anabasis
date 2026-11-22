/**
 * A check program's pack as a campaign stages it (`tools/d2/exam.ts`): its brief, tasks and
 * controls, the contract and public resources it gives a solve, and the backends a seat runs on.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { claudeExecutable, SWEEP_COMPACT_WINDOW } from "#src/agent/backends/claude.ts";
import { type BackendOptions, backends } from "#src/agent/backends/models.ts";
import type { Control } from "#src/kernel/acceptance.ts";
import { type Contract, type Objective, objectiveLine } from "#src/kernel/contract.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { applicableTruthChecks, readBrief, type Task } from "#src/kernel/verify.ts";
import { BRIEF_FILE, CONTROLS_FILE, TASKS_FILE } from "#src/meta/bundle-layout.ts";
import { cpSync, readFileSync, renameSync, rmSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { type ControlFile, textFiles } from "#src/kernel/answer-files.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, join } from "#src/meta/path.ts";
import { type PublicResource, publicResource } from "#src/tools/answer.ts";
import { toolTreeSearchDirs } from "#src/wall/isolation.ts";

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
  readonly accept: readonly { taskId: string; artifact: JsonValue; files?: ControlFile[] }[];
  readonly reject: readonly {
    taskId: string;
    artifact: JsonValue;
    files?: ControlFile[];
    expectedCheckId: string;
  }[];
}

/** The files of a v1 `correctness-model` that are its battery rather than its check program. */
const BATTERY_FILES = new Set(["tasks.json", "controls.json"]);

/**
 * A v1 bundle's check program, copied to `to` without its battery: the verifier hands a check its
 * whole program, and `tasks.json` and `controls.json` hold every task's hidden values and every
 * control. Returns `to`. The copy is made beside it and renamed into place once whole, so a copy
 * cut short in place leaves no folder that a later run takes for the whole program.
 */
export function checkProgram(bundle: string, to: string): string {
  const filter = (path: string) => !BATTERY_FILES.has(basename(path));
  const partial = `${to}.partial`;
  rmSync(partial, { recursive: true, force: true });
  cpSync(join(bundle, "correctness-model"), partial, { recursive: true, filter });
  renameSync(partial, to);
  return to;
}

/** The backends set as the sweep ran its Claude solves, for a model process keeping its state in
 *  `home`; a campaign's `--solver-window` names another window (`tools/d2/setting.ts`). A solve's
 *  cache lives five minutes: over 110,009 recorded solver turns, 0.9% came more than five minutes
 *  after the one before, and the hour-long writes a login gets by default billed 13% more than
 *  five-minute writes would have. */
export function sweepOptions(
  home = homedir(),
  window = SWEEP_COMPACT_WINDOW,
  shutdown?: AbortSignal,
): BackendOptions {
  return {
    claude: { executable: claudeExecutable(), compaction: { window }, home, cacheTtl: "5m", shutdown },
  };
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
    ...accept.map(({ taskId, artifact, files }) => ({
      taskId,
      answer: artifact,
      refusedBy: null,
      ...keyIfDefined("files", files && textFiles(files)),
    })),
    ...reject.map(({ taskId, artifact, files, expectedCheckId }) => ({
      taskId,
      answer: artifact,
      refusedBy: expectedCheckId,
      ...keyIfDefined("files", files && textFiles(files)),
    })),
  ];
}

/** The contract: the brief's public rule decisions are its rules, and the answer format the draft's. */
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
    // The objective is public with the rules: a solver held to it has to read it.
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
