/**
 * `harness_inspect`: the static, read-only view of the candidate the Builder currently holds.
 *
 * The Builder needs to check more than the files it wrote, and two of the things it most needs to
 * see are derived rather than written. The public task projection is computed per case at solve
 * time, so there is no agent-side copy of it to read beforehand; the roster of tool names the
 * generated module must register is composed from the tool specification, the selected presets and
 * the public-resource requirement. The only other way to see either is to spend a submission, which
 * is what this tool exists to save.
 *
 * It composes the owners that already answer those questions — `loadValidatedBundle` for from-disk
 * contract validity, `commitPublicTask` for the projection and its digest, `expectedBuiltToolNames`
 * for the roster, `typecheckGeneratedModule` for the two modules — and reimplements none of them.
 * It deliberately does not run the conformance probe, because that executes generated code, and
 * repeating that execution here would bypass the limits and the reuse the preview cache provides.
 * Inspect reports static contract checks and compilation diagnostics; trial, `correctness_check`
 * and submit own execution. Inspecting commits nothing, adopts nothing, runs no admission gate and
 * consumes no submission attempt.
 *
 * Every candidate view derives from the Builder's own files, so nothing hidden is at risk here by
 * construction: hidden expectations appear as counts because `commitPublicTask` selects public
 * fields rather than deleting hidden ones, findings render through the shared feedback grouping
 * that applies the same author projection submit uses. Recorded history is the context tool's.
 */
import { capturedJsonStringify, capturedJsonParse } from "../meta/json-runtime.ts";
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
import { type AuthorFeedbackQuery, BuilderAuthorFeedback, authorFindingOverview } from "./author-feedback.ts";
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
    Type.Literal("task"),
    Type.Literal("coverage"),
    Type.Literal("feedback"),
  ]),
  taskId: Type.Optional(Type.String()),
  family: Type.Optional(Type.String()),
  group: Type.Optional(
    Type.Number({
      description: "1-based finding group, for feedback only.",
    }),
  ),
  field: Type.Optional(
    Type.Union([Type.Literal("code"), Type.Literal("path"), Type.Literal("detail")], {
      description: "Exact finding field for feedback; defaults to detail when group is supplied.",
    }),
  ),
  /** 1-based family row, public path, or character offset. */
  offset: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number()),
});

/** The two files the Builder writes as code rather than as data. */
const GENERATED_MODULES = [
  { bundle: "agent", rel: GENERATED_TOOLS_FILE },
  { bundle: "correctness-model", rel: EVALUATOR_FILE },
] as const;

interface HarnessInspectBinding {
  /** The Builder's own workspace. The controller binds it; the model cannot name a path. */
  workspace: string;
  /** The exact context the submission check will validate under, so inspect and submit read one
   *  contract. A weaker inspection would be worse than none, because it could report readiness for
   *  a candidate that submit then refuses. */
  context: CandidateCheckContext;
  /** Same-session submit feedback. Optional only for isolated inspection tests. */
  feedback?: BuilderAuthorFeedback;
  /** This round's task count and battery contract, the same bytes the round opened with. Absent
   *  only for isolated inspection tests. */
  contract?: string;
}

type Bundle = ReturnType<typeof loadValidatedBundle>;
type StaticStatus = "static-checks-clear" | "blocked";
/** The model's validated arguments. Each view reads a family, an offset and a limit out of the
 *  same object, so it travels whole rather than as three positional undefineds each. */
type InspectParams = Static<typeof Params>;

/** The tool names agent/tools.ts must register, from the same derivation the conformance probe
 *  compares against at submit time, so a roster that satisfies this one satisfies that one. */
function toolsView(bundle: Bundle) {
  const spec = bundle.toolsSpec;
  if (spec === null) {
    // The findings beside it in readiness say why: a validator finding carries a validator-relative
    // path such as "$" or "tools[0]" rather than a file path, so no filter here could pick them out.
    return {
      toolsSpecValid: false,
      note: "agent/tools-spec.json has not validated yet, so the registered contract cannot be derived",
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

/** Whether the two generated modules compile, by the same `typecheckGeneratedModule` submit runs,
 *  over the model's own file and executing nothing. Its diagnostics are controller-validated and
 *  already cross to the author at submit time, so showing them here moves the moment rather than
 *  the boundary. A module not written yet is absent, not clean. */
function typecheckModules(workspace: string) {
  const modules = GENERATED_MODULES.map(({ bundle, rel }) => {
    const present = existsSync(join(workspace, ...rel.split("/")));
    return { module: rel, present, found: present ? typecheckGeneratedModule(workspace, bundle) : [] };
  });
  return {
    modules: modules.map(({ module, present, found }) => ({ module, present, diagnostics: found.length })),
    findings: modules.flatMap((module) => module.found),
  };
}

/** The installed tools the brief's external-verifier checks name, resolved exactly as the host will
 *  resolve them at submit: the workspace `.toolchain` first, then the host PATH. The Builder can
 *  therefore see before submitting whether a check runs an installed tool or nothing at all, and
 *  from which path it would run. */
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

/** Presence of every file the bundle needs. A file that fails its contract exists, and its findings
 *  name the repair. */
function fileState(workspace: string) {
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
  return { files, missing: Object.keys(files).filter((path) => files[path] !== true) };
}

function rowLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return LIST_WINDOW_ROWS;
  return Math.min(LIST_WINDOW_ROWS, Math.max(1, Math.trunc(limit)));
}

/** Every family with its task count, public-input path count and the first task to rehearse. */
function familyRows(tasks: readonly BuildTask[]) {
  const paths = publicInputPathsByFamily(tasks);
  const samples = new Map<string, string>();
  for (const task of tasks) if (!samples.has(task.family)) samples.set(task.family, task.taskId);
  return [...samples]
    .map(([family, sampleTaskId]) => ({
      family,
      tasks: tasks.filter((task) => task.family === family).length,
      publicInputPaths: paths.get(family)?.size ?? 0,
      sampleTaskId,
    }))
    .sort((left, right) => compareCodeUnits(left.family, right.family));
}

/** One family's task ids and the public-input paths a generated reader or adviser may depend on,
 *  paged by path. Values stay in the task action, so this names ids and paths and nothing else. */
function familyView(rehearsal: Bundle, family: string, { offset, limit }: InspectParams) {
  const tasks: readonly BuildTask[] = rehearsal.battery?.tasks ?? [];
  if (tasks.length === 0) {
    return {
      tasksValid: false,
      note: "correctness-model/tasks.json has not validated yet, so no family can be listed",
    };
  }
  const familyPaths = publicInputPathsByFamily(tasks).get(family);
  if (familyPaths === undefined) throw new Error(`unknown task family: ${family}`);
  const ordered = [...familyPaths].sort(compareCodeUnits);
  const range = windowRange(ordered.length, offset, rowLimit(limit));
  return {
    family,
    taskIds: tasks.flatMap((task) => (task.family === family ? [task.taskId] : [])),
    ...range,
    total: ordered.length,
    publicInputPaths: ordered.slice(range.from - 1, range.to),
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

/** What the static checks found, before any of it is shaped for the page: the files, the merged
 *  validation and module findings, the installed tools, and the two verdicts drawn from them. */
function readinessState(bundle: Bundle, workspace: string, rehearsal: Bundle) {
  const { files, missing } = fileState(workspace);
  const typecheck = typecheckModules(workspace);
  const installedTools = installedToolsView(workspace);
  const modulesClear = typecheck.modules.every((module) => module.present && module.diagnostics === 0);
  const toolsClear = Array.isArray(installedTools) && installedTools.every((tool) => !("missing" in tool));
  const rehearsalReady =
    rehearsal.brief !== null &&
    rehearsal.battery !== null &&
    rehearsal.corpus !== null &&
    rehearsal.toolsSpec !== null &&
    modulesClear &&
    toolsClear;
  const clear = missing.length === 0 && bundle.findings.length === 0 && modulesClear && toolsClear;
  const staticStatus: StaticStatus = clear ? "static-checks-clear" : "blocked";
  return {
    files,
    missing,
    modules: typecheck.modules,
    findings: [...bundle.findings, ...typecheck.findings],
    installedTools,
    rehearsalReady,
    staticStatus,
  };
}

/** The whole static view in one call: files, findings, module compilation, the tool roster, the
 *  installed tools, the brief, the tasks and families, the controls and the trials to start with.
 *  The findings show as previews, and `correctness_check` records them for `feedback` to page
 *  exactly; a named family lists that family's task ids and public-input paths. */
function readinessView(
  bundle: Bundle,
  workspace: string,
  { offset, limit }: InspectParams,
  rehearsal: Bundle,
) {
  const state = readinessState(bundle, workspace, rehearsal);
  const tasks: readonly BuildTask[] = rehearsal.battery?.tasks ?? [];
  const allFamilies = familyRows(tasks);
  const range = windowRange(allFamilies.length, offset, rowLimit(limit));
  const families = allFamilies.slice(range.from - 1, range.to);
  const { brief } = bundle;
  return {
    staticStatus: state.staticStatus,
    files: state.files,
    missing: state.missing,
    findings: authorFindingOverview(state.findings),
    modules: state.modules,
    brief:
      brief === null
        ? null
        : {
            slug: brief.slug,
            artifactFields: brief.artifactSchema.map((field) => field.name),
            truthCheckGroundings: countBy(brief.truthChecks, (check) => check.execution.evidence.kind),
          },
    toolContract: toolsView(bundle),
    installedTools: state.installedTools,
    tasks: {
      count: tasks.length,
      // How many rows each declared check id carries, so a check the brief declares and no task
      // exercises becomes visible. Counts and ids only: the expectation values stay in
      // correctness-model/, where the author cannot read them back out of this view.
      hiddenChecksByCheckId: countBy(
        tasks.flatMap((task) => task.hidden),
        (check) => check.checkId,
      ),
      familiesTotal: allFamilies.length,
      ...range,
      families,
    },
    controls:
      rehearsal.corpus === null
        ? null
        : { accept: rehearsal.corpus.accept.length, reject: rehearsal.corpus.reject.length },
    rehearsalReady: state.rehearsalReady,
    suggestedTrials: families.slice(0, 8).map(({ family, sampleTaskId }) => ({
      family,
      taskId: sampleTaskId,
    })),
    nextAction: readinessNextAction(state.staticStatus, state.rehearsalReady, range.more, range.to + 1),
  };
}

/** The one line a readiness view ends on: what to do next, given what the static checks said and
 *  whether a rehearsal is possible at all. These strings are model-visible, so a changed byte here
 *  is a changed prompt condition and not a wording preference. */
function readinessNextAction(
  staticStatus: StaticStatus,
  rehearsalReady: boolean,
  more: boolean,
  nextOffset: number,
): string {
  const staticChecksClear = staticStatus === "static-checks-clear";
  if (!staticChecksClear && rehearsalReady) {
    return "Run harness_trial on a suggested task for early feedback. Repair the admission findings before correctness_check or submit.";
  }
  if (!staticChecksClear) {
    return `Repair every missing file, installed tool, finding and module diagnostic before trial or submit.${
      more ? ` Then read the remaining families with readiness offset ${nextOffset}.` : ""
    }`;
  }
  if (more) {
    return `Read the remaining families with readiness offset ${nextOffset} before choosing contrasting harness_trial tasks.`;
  }
  return "Use coverage to reconcile public rules, declared check inputs and one-fact controls. Read each suggested task's exact public projection when its values matter, then run harness_trial on contrasting families. Static checks do not establish runtime behaviour or correctness.";
}

function readinessResult(binding: HarnessInspectBinding, params: InspectParams) {
  const { workspace, context } = binding;
  const rehearsal = loadValidatedBundle(workspace, context, "rehearsal");
  if (params.family !== undefined) {
    const view = familyView(rehearsal, params.family, params);
    return {
      text: capturedJsonStringify({ action: params.action, ...view }),
      details: { action: params.action, findings: 0, receipt: { outcome: "completed", findings: 0 } },
    };
  }
  const bundle = loadValidatedBundle(workspace, context, "admission");
  const view = readinessView(bundle, workspace, params, rehearsal);
  const body =
    "files" in view && binding.contract !== undefined ? { ...view, contract: binding.contract } : view;
  const count = view.findings.totalFindings;
  return {
    text: capturedJsonStringify({ action: params.action, ...body }),
    details: {
      action: params.action,
      findings: count,
      receipt: { outcome: view.staticStatus === "blocked" ? "findings" : "clear", findings: count },
    },
  };
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
      "Static, read-only candidate inspection. It does not execute generated tools, conformance, or a verifier. readiness is the whole static view in one call: required files, validation findings and module typecheck diagnostics, the brief, tasks, families, controls, the tool roster agent/tools.ts must register, installed tools and sample trials, so you see what the gate would refuse before a preview runs it; name family to list its task ids and public-input paths. Use coverage to join public rules, check inputs and declared controls, optionally filtered by family; offset and limit page exact text. These declarations do not prove semantic coverage. Use task with taskId or family for the exact task-specific public projection. The solver also reads the public resources (validity assertions, rule decisions, artifact schema, constants and value sets) and the operating guide, so audit the three together: an obligation you enforce but cannot find in any of them is one you enforce in private. Use feedback after correctness_check or submit: it pages every recorded finding, and group and field read one exactly.",
    parameters: Params,
    run: async (params) => {
      // A selector an action cannot honour is refused here, before the validation and tsc work is
      // repeated to produce a result that answers a different question from the one asked.
      if ((params.group !== undefined || params.field !== undefined) && params.action !== "feedback") {
        return {
          text: capturedJsonStringify({
            action: params.action,
            status: "blocked",
            nextAction:
              "Finding selectors page recorded correctness_check and submit findings; repeat with action feedback and the same group and field.",
          }),
          details: {
            action: params.action,
            receipt: { outcome: "blocked", reason: "finding-selector-action" },
          },
        };
      }
      if (params.action === "feedback") {
        return feedbackResult(feedback, {
          ...keyIfDefined("group", params.group),
          ...keyIfDefined("field", params.field),
          ...keyIfDefined("offset", params.offset),
          ...keyIfDefined("limit", params.limit),
        });
      }
      if (params.action === "readiness") return readinessResult(binding, params);
      const bundle = loadValidatedBundle(
        binding.workspace,
        binding.context,
        params.action === "task" ? "rehearsal" : "admission",
      );
      const body = params.action === "task" ? taskView(bundle, params) : coverageView(bundle, params);
      return {
        text: capturedJsonStringify({ action: params.action, ...body }),
        details: {
          action: params.action,
          findings: bundle.findings.length,
          receipt: { outcome: "completed", findings: bundle.findings.length },
        },
      };
    },
  });
}
