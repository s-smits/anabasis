/**
 * `harness_inspect` — the static, read-only view of the candidate the Builder currently holds.
 *
 * The Builder needs to check more than the files it wrote. This tool exposes two derived views
 * that would otherwise require a submission to inspect. First, it shows what the solver will
 * receive: the public task projection is computed per case at solve time, without an agent-side
 * copy to read beforehand. Second, it lists the tool names the generated module must register,
 * combining the tool specification, selected presets and public-resource requirements.
 * These views let the Builder check its contract before spending a submission attempt.
 *
 * This composes the owners that already answer those questions — `loadValidatedBundle` for
 * from-disk contract validity, `commitPublicTask` for the projection and its digest,
 * `expectedBuiltToolNames` for the roster, `typecheckGeneratedModule` for the two modules — and
 * reimplements none of them. It does not run the conformance probe, which executes generated
 * code; repeated execution here would bypass the limits and reuse provided by the preview cache.
 * Inspect reports static contract checks and compilation diagnostics. Trial, correctness_check
 * and submit own execution. Inspection does not commit or adopt a candidate, run admission gates,
 * or consume a submission attempt.
 *
 * Candidate views derive from the Builder's own files. Hidden expectations appear only as counts:
 * `commitPublicTask` selects public fields rather than deleting hidden ones. Findings render through
 * the shared feedback grouping, which applies the same author projection submit uses. The history action
 * reads controller-verified public history through its bound reader, never an arbitrary path.
 */
import { capturedJsonStringify, capturedJsonParse } from "../meta/json-runtime.ts";
import { sha256 } from "../meta/digest.ts";
import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { countBy } from "../meta/tally.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { resolveToolInventory } from "../verify/tool-inventory.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import { type CandidateCheckContext, loadValidatedBundle } from "../author/candidate-check.ts";
import type { BuilderCustomToolSemantic } from "../author/builder-execution.ts";
import { defineTool } from "../solve/define-tool.ts";
import { BUILT_AGENTS_FILE } from "../solve/built-starter.ts";
import { applicableTruthChecks } from "../truth/brief.ts";
import { typecheckGeneratedModule } from "../truth/generated-module-typecheck.ts";
import { briefPublicResources, publicRuleDecisions } from "../truth/public-resources.ts";
import { commitPublicTask } from "../truth/task-split.ts";
import type { BuildTask } from "../truth/tasks.ts";
import { expectedBuiltToolNames } from "../truth/tools-spec.ts";
import { publicInputPathsByFamily } from "../truth/public-input-paths.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import {
  type AuthorFeedbackQuery,
  BuilderAuthorFeedback,
  authorFindingOverview,
  authorFindingPage,
} from "./author-feedback.ts";
import { characterWindow, LIST_WINDOW_ROWS, windowRange } from "./read-window.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import {
  BRIEF_FILE,
  CONTROLS_FILE,
  EVALUATOR_FILE,
  GENERATED_TOOLS_FILE,
  TASKS_FILE,
  TOOLS_SPEC_FILE,
} from "../meta/bundle-layout.ts";
import { readJsonFile } from "../meta/completed-json.ts";

const Params = Type.Object({
  action: Type.Union([
    Type.Literal("readiness"),
    Type.Literal("summary"),
    Type.Literal("task"),
    Type.Literal("tools"),
    Type.Literal("typecheck"),
    Type.Literal("inventory"),
    Type.Literal("coverage"),
    Type.Literal("feedback"),
    Type.Literal("history"),
  ]),
  runId: Type.Optional(
    Type.String({ description: "Recorded battery id for history; omit to list measured experiments." }),
  ),
  taskId: Type.Optional(Type.String()),
  family: Type.Optional(Type.String()),
  group: Type.Optional(
    Type.Number({
      description: "1-based finding group. Only summary, typecheck and feedback accept finding selectors.",
    }),
  ),
  field: Type.Optional(
    Type.Union([Type.Literal("code"), Type.Literal("path"), Type.Literal("detail")], {
      description:
        "Exact finding field for summary, typecheck or feedback; defaults to detail when group is supplied.",
    }),
  ),
  /** 1-based finding group, task row, public path, or character offset. */
  offset: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number()),
});

/** The two files the Builder writes as code rather than as data. */
const GENERATED_MODULES = [
  { bundle: "agent", rel: GENERATED_TOOLS_FILE },
  { bundle: "correctness-model", rel: EVALUATOR_FILE },
] as const;

export interface HarnessInspectBinding {
  /** The Builder's own workspace. The controller binds it; the model cannot name a path. */
  workspace: string;
  /** The exact context the submission check will validate under, so inspect and submit read one
   *  contract. A weaker inspection could report readiness for a candidate submit would refuse. */
  context: CandidateCheckContext;
  /** Same-session submit feedback. Optional only for isolated inspection tests. */
  feedback?: BuilderAuthorFeedback;
  /** Controller-bound, verified public history only; the model cannot supply a filesystem path. */
  readHistory?: (
    runId: string | undefined,
    taskId: string | undefined,
    offset: number | undefined,
    limit: number | undefined,
  ) => string;
}

type Bundle = ReturnType<typeof loadValidatedBundle>;
/** The model's validated arguments. Four views read a family, an offset and a limit out of the
 *  same object, so it travels whole rather than as three positional undefineds each. */
type InspectParams = Static<typeof Params>;

/** The tool names agent/tools.ts must register, from the same derivation the conformance probe
 *  compares against at submit time. */
function toolsView(bundle: Bundle) {
  const spec = bundle.toolsSpec;
  if (spec === null) {
    // Return the whole finding list: validator findings carry
    // validator-relative paths ("$", "tools[0]"), not file paths, so any filter here would be a
    // guess that silently returns nothing.
    return {
      toolsSpecValid: false,
      note: "agent/tools-spec.json has not validated yet, so the registered contract cannot be derived",
      findings: authorFindingOverview(bundle.findings),
    };
  }
  return {
    toolsSpecValid: true,
    presets: spec.presets,
    declared: spec.tools.map((tool) => ({ name: tool.name, kind: tool.kind })),
    registerExactly: expectedBuiltToolNames(spec, {
      publicResources: bundle.brief !== null && briefPublicResources(bundle.brief).length > 0,
    }),
  };
}

/** The exact public task the solver receives for one case, with its recorded digest. */
function taskView(bundle: Bundle, { taskId, family, offset, limit }: InspectParams) {
  const tasks: readonly BuildTask[] = bundle.battery?.tasks ?? [];
  if (tasks.length === 0) {
    return {
      tasksValid: false,
      note: "correctness-model/tasks.json has not validated yet, so no public projection can be taken",
      findings: authorFindingOverview(bundle.findings),
    };
  }
  const byFamily = family === undefined ? tasks[0] : tasks.find((row) => row.family === family);
  const task = taskId === undefined ? byFamily : tasks.find((row) => row.taskId === taskId);
  if (task === undefined) {
    if (taskId !== undefined) throw new Error(`unknown taskId: ${taskId}`);
    if (family !== undefined) throw new Error(`unknown task family: ${family}`);
    throw new Error("no task is available");
  }
  if (family !== undefined && task.family !== family) {
    throw new Error(
      `taskId ${capturedJsonStringify(task.taskId)} belongs to family ${capturedJsonStringify(task.family)}, not ${capturedJsonStringify(family)}`,
    );
  }
  const committed = commitPublicTask(task);
  const window = characterWindow(committed.publicTaskJson, offset, limit);
  const windowed = offset !== undefined || window.more;
  const base = {
    taskId: task.taskId,
    family: task.family,
    publicTaskDigest: committed.publicTaskDigest,
    hiddenChecks: task.hidden.length,
  };
  if (windowed) {
    return {
      ...base,
      publicTaskBytes: new TextEncoder().encode(committed.publicTaskJson).byteLength,
      publicTaskCharacters: window.total,
      from: window.from,
      to: window.to,
      more: window.more,
      publicTaskText: window.text,
      note: window.more
        ? `the exact public projection is paged; call task again with taskId ${capturedJsonStringify(task.taskId)} and offset ${window.to + 1}`
        : "this page reaches the end of the exact public projection",
    };
  }
  return { ...base, publicTask: capturedJsonParse(committed.publicTaskJson) };
}

/**
 * Whether the two generated modules compile. The summary can only say they exist, so a Builder
 * learned that `correctness-model/evaluator.ts` did not compile by spending a submission on it. This runs the
 * same `typecheckGeneratedModule` submit runs, over the model's own file, and executes nothing: the
 * diagnostics are already controller-validated and already cross to the author at submit time, so
 * inspecting them moves the moment, not the boundary.
 */
function typecheckView(workspace: string, query: AuthorFeedbackQuery) {
  const modules = GENERATED_MODULES.map(({ bundle, rel }) => {
    if (!existsSync(join(workspace, ...rel.split("/")))) return { module: rel, present: false };
    const found = typecheckGeneratedModule(workspace, bundle);
    return { module: rel, present: true, diagnostics: found };
  });
  const findings = modules.flatMap((module) => ("diagnostics" in module ? module.diagnostics : []));
  return {
    modules: modules.map((module) => ({
      module: module.module,
      present: module.present,
      diagnostics: "diagnostics" in module ? module.diagnostics.length : 0,
    })),
    diagnostics: findings.length,
    findings: authorFindingPage(findings, query, "typecheck"),
  };
}

/** The installed tools the brief's external-verifier checks name, resolved exactly as the host
 *  will resolve them at submit: workspace `.toolchain` first, then the host PATH. The Builder sees
 *  before submit whether a check runs an installed tool or nothing at all, and from which path. */
function installedToolsView(workspace: string) {
  const path = join(workspace, BRIEF_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = readJsonFile(path);
    const checks = isRecord(parsed) && Array.isArray(parsed.truthChecks) ? parsed.truthChecks : [];
    const toolIds = [
      ...new Set(
        checks.flatMap((check: unknown) => {
          if (!isRecord(check) || !isRecord(check.execution) || !isRecord(check.execution.evidence)) {
            return [];
          }
          const { evidence } = check.execution;
          const required =
            evidence.kind === "external" ? evidence.requiredToolIds : check.execution.requiredToolIds;
          return Array.isArray(required) ? required.filter(isString) : [];
        }),
      ),
    ].sort(compareCodeUnits);
    if (toolIds.length === 0) return [];
    const resolved = resolveToolInventory({ toolIds, toolTree: bundleSnapshotToolTree(workspace) });
    return toolIds.map((toolId) => {
      const entry = resolved.inventory[toolId];
      if (entry !== undefined) {
        return {
          toolId,
          path: entry.path,
          source: entry.source,
          kind: entry.kind,
          interpreter: entry.interpreter,
          digest: entry.digest,
        };
      }
      return {
        toolId,
        missing: resolved.invalid.includes(toolId)
          ? "not a command name"
          : "no executable under .toolchain or on the host PATH",
      };
    });
  } catch (error) {
    return { invalid: errorMessage(error) };
  }
}

/** Contract state of each validated file, with counts instead of full content. */
function summaryView(bundle: Bundle, workspace: string, query: AuthorFeedbackQuery) {
  const tasks: readonly BuildTask[] = bundle.battery?.tasks ?? [];
  const { brief } = bundle;
  // Presence only: a file that fails its contract exists, and its findings name the repair.
  const files = Object.fromEntries(
    [
      BRIEF_FILE,
      TASKS_FILE,
      CONTROLS_FILE,
      EVALUATOR_FILE,
      TOOLS_SPEC_FILE,
      GENERATED_TOOLS_FILE,
      BUILT_AGENTS_FILE,
    ].map((path) => [path, existsSync(join(workspace, ...path.split("/")))]),
  );
  const missing = Object.keys(files).filter((path) => files[path] !== true);
  const structurallyReady = missing.length === 0 && bundle.findings.length === 0;
  return {
    staticStatus: structurallyReady ? "structurally-ready" : "blocked",
    files,
    missing,
    findings: authorFindingPage(bundle.findings, query),
    brief:
      brief === null
        ? null
        : {
            slug: brief.slug,
            artifactFields: brief.artifactSchema.map((field) => field.name),
            truthCheckGroundings: countBy(brief.truthChecks, (check) => check.execution.evidence.kind),
          },
    tasks: {
      count: tasks.length,
      families: countBy(tasks, (task) => task.family),
      // How many rows each declared check id carries, so a check the brief declares and no task
      // exercises is visible. Counts and ids only — the expectation values stay in correctness-model/.
      hiddenChecksByCheckId: countBy(
        tasks.flatMap((task) => task.hidden),
        (check) => check.checkId,
      ),
    },
    controls:
      bundle.corpus === null
        ? null
        : { accept: bundle.corpus.accept.length, reject: bundle.corpus.reject.length },
    installedTools: installedToolsView(workspace),
    nextAction: structurallyReady
      ? "Run harness_inspect readiness, then harness_trial. Structural readiness does not execute generated tools or establish correctness."
      : "Author any missing file and page through every finding group before typecheck or submit.",
  };
}

function rowLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return LIST_WINDOW_ROWS;
  return Math.min(LIST_WINDOW_ROWS, Math.max(1, Math.trunc(limit)));
}

/** Battery-wide map the one-task inspection could not show: every family, task id and public-input
 *  path the generated readers/advisers may depend on. Values remain in the task action; inventory
 *  reports only public names and paths. */
function inventoryView(bundle: Bundle, { family, offset, limit }: InspectParams) {
  const tasks: readonly BuildTask[] = bundle.battery?.tasks ?? [];
  if (tasks.length === 0) {
    return {
      tasksValid: false,
      note: "correctness-model/tasks.json has not validated yet, so no inventory can be derived",
      findings: authorFindingOverview(bundle.findings),
    };
  }
  const paths = publicInputPathsByFamily(tasks);
  const families = [...paths]
    .map(([name, familyPaths]) => ({
      family: name,
      tasks: tasks.filter((task) => task.family === name).length,
      publicInputPaths: familyPaths.size,
    }))
    .sort((left, right) => compareCodeUnits(left.family, right.family));
  if (family !== undefined) {
    const familyPaths = paths.get(family);
    if (familyPaths === undefined) throw new Error(`unknown task family: ${family}`);
    const ordered = [...familyPaths].sort(compareCodeUnits);
    const range = windowRange(ordered.length, offset, rowLimit(limit));
    return {
      family,
      taskCount: tasks.filter((task) => task.family === family).length,
      ...range,
      total: ordered.length,
      publicInputPaths: ordered.slice(range.from - 1, range.to),
    };
  }
  const range = windowRange(tasks.length, offset, rowLimit(limit));
  return {
    families,
    ...range,
    total: tasks.length,
    tasks: tasks.slice(range.from - 1, range.to).map((task) => ({
      taskId: task.taskId,
      family: task.family,
    })),
    note: "Name family to page its public-input paths; use task to read a selected public value projection.",
  };
}

/** Declarations the Builder must reconcile, not an inferred proof that its code observes them. */
function coverageView(bundle: Bundle, { family, offset, limit }: InspectParams) {
  const { brief, battery, corpus } = bundle;
  if (brief === null || battery === null || corpus === null) {
    return {
      available: false,
      findings: authorFindingOverview(bundle.findings),
      nextAction: "Repair the brief, tasks and controls before inspecting their declared coverage.",
    };
  }
  const tasks = battery.tasks.filter((task) => family === undefined || task.family === family);
  if (family !== undefined && tasks.length === 0) throw new Error(`unknown task family: ${family}`);
  const rules = publicRuleDecisions(brief).map((rule) => ({
    id: rule.id,
    statement: rule.statement,
    families: rule.families ?? null,
    checks: brief.truthChecks
      .filter((check) => check.citedDecisionIds?.includes(rule.id) === true)
      .map((check) => check.id),
  }));
  const checks = brief.truthChecks.map((check) => {
    const taskIds = new Set(
      tasks
        .filter((task) => applicableTruthChecks(brief, task).some((row) => row.id === check.id))
        .map((task) => task.taskId),
    );
    return {
      id: check.id,
      assertion: check.assertion,
      rules: check.citedDecisionIds ?? [],
      artifactPaths: check.execution.artifactPaths,
      publicInputPaths: check.execution.publicInputPaths,
      applicableTasks: taskIds.size,
      accepts: corpus.accept.filter((control) => taskIds.has(control.taskId)).length,
      rejects: corpus.reject
        .filter((control) => control.expectedCheckId === check.id && taskIds.has(control.taskId))
        .map((control) => ({ id: control.id, taskId: control.taskId, mutationClass: control.mutationClass })),
    };
  });
  const page = characterWindow(capturedJsonStringify({ rules, checks }), offset, limit);
  return {
    available: true,
    basis: "declarations-only",
    family: family ?? null,
    from: page.from,
    to: page.to,
    total: page.total,
    more: page.more,
    coverageText: page.text,
    nextAction: page.more
      ? `Continue coverage with the same family selector and offset ${page.to + 1}.`
      : "For every independent public obligation, identify the observation its check reads and the one-fact reject that challenges it. Counts and citations do not prove that the evaluator observes the obligation. Inspect your source and extend your local tests; correctness_check exercises the installed host path.",
  };
}

/** One low-call-cost static pass. It combines the repeated summary, inventory, roster and compile
 *  questions while retaining the narrower actions for paging exact tasks, paths and findings. */
function readinessView(
  bundle: Bundle,
  workspace: string,
  { offset, limit }: InspectParams,
  rehearsal: Bundle,
) {
  const summary = summaryView(bundle, workspace, {});
  const typecheck = typecheckView(workspace, {});
  const tasks: readonly BuildTask[] = rehearsal.battery?.tasks ?? [];
  const paths = publicInputPathsByFamily(tasks);
  const samples = new Map<string, string>();
  for (const task of tasks) if (!samples.has(task.family)) samples.set(task.family, task.taskId);
  const allFamilies = [...samples]
    .map(([family, sampleTaskId]) => ({
      family,
      tasks: tasks.filter((task) => task.family === family).length,
      publicInputPaths: paths.get(family)?.size ?? 0,
      sampleTaskId,
    }))
    .sort((left, right) => compareCodeUnits(left.family, right.family));
  const range = windowRange(allFamilies.length, offset, rowLimit(limit));
  const families = allFamilies.slice(range.from - 1, range.to);
  const modulesClear = typecheck.modules.every((module) => module.present && module.diagnostics === 0);
  const toolsClear =
    Array.isArray(summary.installedTools) && summary.installedTools.every((tool) => !("missing" in tool));
  const rehearsalReady =
    rehearsal.brief !== null &&
    rehearsal.battery !== null &&
    rehearsal.corpus !== null &&
    rehearsal.toolsSpec !== null &&
    modulesClear &&
    toolsClear;
  const staticChecksClear = summary.staticStatus === "structurally-ready" && modulesClear && toolsClear;
  return {
    staticStatus: staticChecksClear ? "static-checks-clear" : "blocked",
    files: summary.files,
    missing: summary.missing,
    validationFindings: summary.findings,
    modules: typecheck.modules,
    moduleFindings: typecheck.findings,
    toolContract: toolsView(bundle),
    installedTools: summary.installedTools,
    taskCoverage: {
      count: tasks.length,
      familiesTotal: allFamilies.length,
      familiesReturned: families.length,
      ...range,
      families,
    },
    rehearsalReady,
    suggestedTrials: families.slice(0, 8).map(({ family, sampleTaskId }) => ({
      family,
      taskId: sampleTaskId,
    })),
    nextAction: readinessNextAction(staticChecksClear, rehearsalReady, range.more, range.to + 1),
  };
}

/** The one line a readiness view ends on: what to do next, given what the static checks said and
 *  whether a rehearsal is possible at all. These four strings are model-visible; they are moved
 *  here unchanged, because a changed byte is a changed prompt condition. */
function readinessNextAction(
  staticChecksClear: boolean,
  rehearsalReady: boolean,
  more: boolean,
  nextOffset: number,
): string {
  if (!staticChecksClear && rehearsalReady) {
    return "Run harness_trial on a suggested task for early feedback. Repair the admission findings before correctness_check or submit.";
  }
  if (!staticChecksClear) {
    return `Repair every missing file, installed tool, validation finding, verifier copy and module diagnostic before trial or submit; use the narrower actions to page exact detail.${
      more ? ` Then read the remaining family samples with readiness offset ${nextOffset}.` : ""
    }`;
  }
  if (more) {
    return `Read the remaining family samples with readiness offset ${nextOffset} before choosing contrasting harness_trial tasks.`;
  }
  return "Use coverage to reconcile public rules, declared check inputs and one-fact controls. Read each suggested task's exact public projection when its values matter, then run harness_trial on contrasting families. Static checks do not establish runtime behaviour or correctness.";
}

/** The view each remaining action reads. The three actions handled before this point return
 *  their own result; these six share one shape, so they share one reader. */
function actionView(
  bundle: Bundle,
  binding: HarnessInspectBinding,
  params: InspectParams,
  query: AuthorFeedbackQuery,
) {
  const { workspace, context } = binding;
  if (params.action === "readiness") {
    return readinessView(bundle, workspace, params, loadValidatedBundle(workspace, context, "rehearsal"));
  }
  if (params.action === "tools") return toolsView(bundle);
  if (params.action === "task") return taskView(bundle, params);
  if (params.action === "inventory") return inventoryView(bundle, params);
  if (params.action === "coverage") return coverageView(bundle, params);
  return summaryView(bundle, workspace, query);
}

function feedbackResult(feedback: BuilderAuthorFeedback, query: AuthorFeedbackQuery) {
  const page = feedback.page(query);
  const findingCount = page.available ? page.totalFindings : 0;
  const found = findingCount === 0 ? "clear" : "findings";
  const receipt: BuilderCustomToolSemantic = {
    outcome: page.available ? found : "blocked",
    findings: findingCount,
  };
  if (!page.available) receipt.reason = "before-submit";
  return {
    text: capturedJsonStringify({ action: "feedback", ...page }),
    details: { action: "feedback", receipt },
  };
}

export function createHarnessInspectTool(binding: HarnessInspectBinding): AgentTool<typeof Params> {
  const feedback = binding.feedback ?? new BuilderAuthorFeedback();
  return defineTool({
    name: "harness_inspect",
    label: "Harness inspect",
    description:
      "Static, read-only candidate inspection. It does not execute generated tools, conformance, or a verifier. Start with readiness to combine required files, paged families, sample trials, tool roster, module typechecks and installed tools, and to see what the gate would refuse before a preview spends the attempt. Use coverage to join public rules, check inputs and declared controls, optionally filtered by family; offset and limit page exact text. These declarations do not prove semantic coverage. Use task with taskId or family for the exact task-specific public projection. The solver also reads the public resources (validity assertions, rule decisions, artifact schema, constants and value sets) and the operating guide, so audit the three together: an obligation you enforce but cannot find in any of them is one you enforce in private. Use feedback after correctness_check or submit findings. Use history to page measured experiments, then runId and optional taskId for older recorded public tasks: read what earlier batteries of this product asked and where they landed before settling what this one demands.",
    parameters: Params,
    run: async (params) => {
      // Recent Sol and Fable runs followed an overview's "same action" hint into readiness
      // and inventory, which silently ignored group. Refuse before repeating validation/tsc.
      if (
        (params.group !== undefined || params.field !== undefined) &&
        !["summary", "typecheck", "feedback"].includes(params.action)
      ) {
        return {
          text: capturedJsonStringify({
            action: params.action,
            status: "blocked",
            nextAction:
              "Finding selectors require summary for validationFindings, typecheck for moduleFindings, or feedback for correctness_check and submit findings. Repeat with that action and the same group and field.",
          }),
          details: {
            action: params.action,
            receipt: { outcome: "blocked", reason: "finding-selector-action" },
          },
        };
      }
      const query: AuthorFeedbackQuery = {
        ...keyIfDefined("group", params.group),
        ...keyIfDefined("field", params.field),
        ...keyIfDefined("offset", params.offset),
        ...keyIfDefined("limit", params.limit),
      };
      if (params.action === "feedback") return feedbackResult(feedback, query);
      if (params.action === "history") {
        // The digest and the page kind make two reads of history distinguishable in the execution
        // record: before them, every history receipt was the same `completed`, so which rows an
        // author had read before it wrote a proposal could not be recovered.
        const text =
          binding.readHistory?.(params.runId, params.taskId, params.offset, params.limit) ??
          capturedJsonStringify({
            action: "history",
            unavailable: "No measured history is bound to this round.",
          });
        return {
          text,
          details: {
            action: "history",
            receipt: {
              outcome: binding.readHistory === undefined ? "blocked" : "completed",
              stage: params.runId === undefined ? "list" : "tasks",
              resultDigest: sha256(text),
            },
          },
        };
      }
      if (params.action === "typecheck") {
        // The bundle is not read here: the two modules compile or do not whatever the JSON says.
        const view = typecheckView(binding.workspace, query);
        return {
          text: capturedJsonStringify({ action: params.action, ...view }),
          details: {
            action: params.action,
            findings: view.diagnostics,
            receipt: {
              outcome: view.diagnostics === 0 ? "clear" : "findings",
              findings: view.diagnostics,
            },
          },
        };
      }
      const bundle = loadValidatedBundle(
        binding.workspace,
        binding.context,
        params.action === "task" ? "rehearsal" : "admission",
      );
      const { findings } = bundle;
      const body = actionView(bundle, binding, params, query);
      const staticStatus = "staticStatus" in body ? body.staticStatus : null;
      return {
        // These views return no action key; add the selected action to their result.
        text: capturedJsonStringify({ action: params.action, ...body }),
        details: {
          action: params.action,
          findings: findings.length,
          receipt: {
            outcome: staticStatus === null ? "completed" : staticStatus === "blocked" ? "findings" : "clear",
            findings: findings.length,
          },
        },
      };
    },
  });
}
