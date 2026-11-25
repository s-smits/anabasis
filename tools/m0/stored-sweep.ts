/**
 * A check program's pack as a campaign stages it (`tools/d2/exam.ts`): its brief, tasks and
 * controls, the contract and public resources it supplies to a solve, and the backends a seat runs on.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { claudeExecutable, SWEEP_COMPACT_WINDOW } from "#src/agent/backends/claude.ts";
import { type BackendOptions, backends } from "#src/agent/backends/models.ts";
import type { Control, ToolAvailability } from "#src/kernel/acceptance.ts";
import { type Contract, type Objective, objectiveLine } from "#src/kernel/contract.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { applicableTruthChecks, readBrief, resolveVerifierTool, type Task } from "#src/kernel/verify.ts";
import { BRIEF_FILE, CONTROLS_FILE, TASKS_FILE } from "#src/meta/bundle-layout.ts";
import { cpSync, readFileSync, renameSync, rmSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { type ControlFile, textFiles } from "#src/kernel/answer-files.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, join } from "#src/meta/path.ts";
import { type PublicResource, publicResource } from "#src/tools/answer.ts";

interface PackBrief {
  readonly domain: string;
  /** Present in prompt-drafted exams (`tools/d2/exam.ts`), absent in v1 bundle briefs. */
  readonly scope?: string;
  readonly conventions?: string;
  readonly ruleDecisions: readonly (JsonObject & { id: string; statement: string; visibility: string })[];
  readonly truthChecks: readonly { assertion: string; execution: { publicInputPaths: string[] } }[];
  readonly objective?: Objective;
  readonly artifactSchema: readonly JsonObject[];
  readonly designRuleConstants: readonly JsonObject[];
  readonly designRuleSets?: readonly JsonObject[];
}

/** `controls.json`: answers that must pass and perturbations a named check must reject. */
interface PackControls {
  readonly accept: readonly { taskId: string; artifact: JsonValue; files?: ControlFile[] }[];
  readonly reject: readonly {
    taskId: string;
    artifact: JsonValue;
    files?: ControlFile[];
    expectedCheckId: string;
  }[];
}

const BATTERY_FILES = new Set(["tasks.json", "controls.json"]);

/**
 * Copies a bundle's check program to `to` without its battery files, which hold hidden task values
 * and controls. The copy goes to a sibling `.partial` and is renamed, so an interrupted copy never
 * leaves a check tree a later run mistakes for a staged program.
 */
export function checkProgram(bundle: string, to: string): string {
  const filter = (path: string) => !BATTERY_FILES.has(basename(path));
  const partial = `${to}.partial`;
  rmSync(partial, { recursive: true, force: true });
  cpSync(join(bundle, "correctness-model"), partial, { recursive: true, filter });
  renameSync(partial, to);
  return to;
}

/** Backend options as the default Claude configuration, with state in `home` (`--solver-window` in
 *  `tools/d2/setting.ts` overrides the compaction window). The cache TTL is 5 minutes because
 *  nearly every solver turn follows the previous one within five minutes, and the 1-hour cache
 *  writes bill more. */
export function sweepOptions(
  home = homedir(),
  window = SWEEP_COMPACT_WINDOW,
  shutdown?: AbortSignal,
): BackendOptions {
  return {
    claude: { executable: claudeExecutable(), compaction: { window }, home, cacheTtl: "5m", shutdown },
  };
}

export function modelNamed(name: string): Model<Api> {
  const [provider = "", ...id] = name.split("/");
  const model = backends(sweepOptions()).getModel(provider, id.join("/"));
  if (model === undefined) throw new Error(`no backend serves ${name}`);
  return model;
}

export function readPack(bundle: string) {
  const read = (file: string): string => readFileSync(join(bundle, file), "utf8");
  return { brief: parseJsonAs<PackBrief>(read(BRIEF_FILE)), tasks: parseJsonAs<Task[]>(read(TASKS_FILE)) };
}

/** `"pack"` if installed inside `.toolchain/`, `"host"` if forwarded via
 *  `.toolchain/host-tools.json`, or `false`. */
export function toolOnPath(bundle: string): (toolId: string) => ToolAvailability {
  const tools = join(bundle, ".toolchain");
  return (toolId) => resolveVerifierTool(tools, toolId)?.kind ?? false;
}

/** Accept and reject controls in file order, with their author-assigned labels. */
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

export function contractOf(brief: PackBrief, answerFormat: JsonValue): Contract {
  return {
    answerFormat,
    conventions: brief.conventions ?? "",
    rules: brief.ruleDecisions.filter((rule) => rule.visibility === "public"),
    scope: brief.scope ?? brief.domain,
    ...keyIfDefined("objective", brief.objective),
  };
}

/** Wraps a v1 task as a `TaskPackage`, attaching the deduplicated rule IDs its family's checks cite. */
export function packageOf(checks: string, task: Task): TaskPackage {
  const cited = applicableTruthChecks(readBrief(checks), task).flatMap((check) => check.citedDecisionIds);
  return { ...task, ruleIds: [...new Set(cited)], checks };
}

/**
 * The public resources shown to solvers, ported from `7af7315:src/truth/public-resources.ts`: each
 * row keeps only its declared fields, in order, omitting absent keys.
 */
export function sweepResources(brief: PackBrief): PublicResource[] {
  const rows = (list: readonly JsonObject[], keys: readonly string[]): JsonObject[] =>
    list.map((row) =>
      Object.fromEntries(keys.flatMap((key) => (row[key] === undefined ? [] : [[key, row[key]]]))),
    );
  const named: [string, JsonValue[]][] = [
    // Prompt-drafted exams state units and tolerances here; v1 bundles omit both and receive no
    // `public-scope` file.
    [
      "public-scope",
      brief.scope === undefined && brief.conventions === undefined
        ? []
        : [{ domain: brief.domain, scope: brief.scope ?? "", conventions: brief.conventions ?? "" }],
    ],
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
