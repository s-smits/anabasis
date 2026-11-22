/**
 * A check program's pack as a campaign stages it (`tools/d2/exam.ts`): its brief, tasks and
 * controls, the contract and public resources it supplies to a solve, and the backends a seat runs on.
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

/** Subset of fields read from a `brief.json`. */
interface PackBrief {
  readonly domain: string;
  /** Domain scope and practitioner conventions when declared (present in prompt-drafted exams from
   *  `tools/d2/exam.ts`, absent in v1 bundle briefs). */
  readonly scope?: string;
  readonly conventions?: string;
  readonly ruleDecisions: readonly (JsonObject & { id: string; statement: string; visibility: string })[];
  readonly truthChecks: readonly { assertion: string; execution: { publicInputPaths: string[] } }[];
  /** Declared optimisation objective, if any (`src/kernel/contract.ts`). */
  readonly objective?: Objective;
  readonly artifactSchema: readonly JsonObject[];
  readonly designRuleConstants: readonly JsonObject[];
  readonly designRuleSets?: readonly JsonObject[];
}

/** Structure of `controls.json`: answers that must pass and perturbations that a named check
 *  must reject. */
interface PackControls {
  readonly accept: readonly { taskId: string; artifact: JsonValue; files?: ControlFile[] }[];
  readonly reject: readonly {
    taskId: string;
    artifact: JsonValue;
    files?: ControlFile[];
    expectedCheckId: string;
  }[];
}

/** Battery files inside a `correctness-model` directory that are excluded when staging checks. */
const BATTERY_FILES = new Set(["tasks.json", "controls.json"]);

/**
 * Copies a bundle's check program to `to` while omitting its battery files (`tasks.json` and
 * `controls.json`, which contain hidden task values and controls). Copies into a sibling `.partial`
 * directory and renames atomically so an interrupted copy never leaves an incomplete check tree
 * that later runs mistake for a staged program. Returns `to`.
 */
export function checkProgram(bundle: string, to: string): string {
  const filter = (path: string) => !BATTERY_FILES.has(basename(path));
  const partial = `${to}.partial`;
  rmSync(partial, { recursive: true, force: true });
  cpSync(join(bundle, "correctness-model"), partial, { recursive: true, filter });
  renameSync(partial, to);
  return to;
}

/** Builds backend options matching the default Claude configuration with state stored in `home`
 *  (campaigns may override the compaction window via `--solver-window` in `tools/d2/setting.ts`).
 *  Uses a 5-minute cache TTL because 99.1% of 110,009 recorded solver turns occurred within five
 *  minutes of the previous turn, whereas the default 1-hour cache writes billed 13% more. */
export function sweepOptions(
  home = homedir(),
  window = SWEEP_COMPACT_WINDOW,
  shutdown?: AbortSignal,
): BackendOptions {
  return {
    claude: { executable: claudeExecutable(), compaction: { window }, home, cacheTtl: "5m", shutdown },
  };
}

/** Resolves a `provider/model` identifier against this host's configured backends. */
export function modelNamed(name: string): Model<Api> {
  const [provider = "", ...id] = name.split("/");
  const model = backends(sweepOptions()).getModel(provider, id.join("/"));
  if (model === undefined) throw new Error(`no backend serves ${name}`);
  return model;
}

/** Reads a pack's brief and task list (including hidden values). */
export function readPack(bundle: string) {
  const read = (file: string): string => readFileSync(join(bundle, file), "utf8");
  return { brief: parseJsonAs<PackBrief>(read(BRIEF_FILE)), tasks: parseJsonAs<Task[]>(read(TASKS_FILE)) };
}

/** Returns a predicate reporting whether a tool ID is available on the bundle's verifier `PATH`. */
export function toolOnPath(bundle: string): (toolId: string) => boolean {
  const path = toolTreeSearchDirs(join(bundle, ".toolchain")).join(":");
  return (toolId) => Bun.which(toolId, { PATH: path }) !== null;
}

/** Reads a pack's accept and reject controls in file order with their author-assigned labels. */
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

/** Builds a `Contract` from a pack brief's public rule decisions and the draft's answer format. */
export function contractOf(brief: PackBrief, answerFormat: JsonValue): Contract {
  return {
    answerFormat,
    conventions: brief.conventions ?? "",
    rules: brief.ruleDecisions.filter((rule) => rule.visibility === "public"),
    scope: brief.scope ?? brief.domain,
    ...keyIfDefined("objective", brief.objective),
  };
}

/** Wraps a v1 task as a `TaskPackage`, attaching the deduplicated rule IDs cited by its family's checks. */
export function packageOf(checks: string, task: Task): TaskPackage {
  const cited = applicableTruthChecks(readBrief(checks), task).flatMap((check) => check.citedDecisionIds);
  return { ...task, ruleIds: [...new Set(cited)], checks };
}

/**
 * Projects a pack brief into the public resources shown to solvers, ported from
 * `7af7315:src/truth/public-resources.ts:118-144` (with row projections from lines 66-111): each
 * row retains only its declared fields in order, omitting absent keys.
 */
export function sweepResources(brief: PackBrief): PublicResource[] {
  const rows = (list: readonly JsonObject[], keys: readonly string[]): JsonObject[] =>
    list.map((row) =>
      Object.fromEntries(keys.flatMap((key) => (row[key] === undefined ? [] : [[key, row[key]]]))),
    );
  const named: [string, JsonValue[]][] = [
    // Include domain scope and conventions when declared (prompt-drafted exams state units and
    // tolerances here; v1 bundles omit both and receive no `public-scope` file).
    [
      "public-scope",
      brief.scope === undefined && brief.conventions === undefined
        ? []
        : [{ domain: brief.domain, scope: brief.scope ?? "", conventions: brief.conventions ?? "" }],
    ],
    // Expose the declared objective alongside the public rules so solvers know what is measured.
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
    // Mirrors `public-resources.ts:113-117` and `66-75`.
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
