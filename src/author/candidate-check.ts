/**
 * Captures and validates a candidate from the Builder's workspace. The check commits the workspace
 * to Git, fingerprints the bundle, creates an immutable snapshot and validates the files read from
 * that snapshot; every later adoption gate reads the same captured files. `changedPaths` records
 * the difference from the previous commit for attribution.
 *
 * Every outgoing finding passes through the author projection, which withholds unclassified detail
 * by default.
 */
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { join } from "../meta/path.ts";
import { createBundleSnapshot, bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { type FingerprintEvidence, fingerprintSlug } from "../claim/fingerprint.ts";
import { namesTask } from "../meta/identifier-scan.ts";
import { BUILT_AGENTS_FILE } from "../solve/built-starter.ts";
import { validateBrief } from "../truth/brief-validator.ts";
import { HARNESS_CONFIG_FILE, harnessConfigIssue } from "../truth/harness-config.ts";
import {
  type Brief,
  requiredToolsOf,
  type ContractFinding,
  controllerValidatedFinding,
  controllerValidatedFindings,
  fieldFinding,
} from "../truth/brief.ts";
import { fileArtifactRootIssue } from "../solve/draft-files.ts";
import { loadSolvabilityPublicSchema } from "../truth/solvability-artifact-schema.ts";
import { verifierEnvironmentHashOfTools } from "../truth/verifier-environment.ts";
import {
  type ControlCorpus,
  isControlCorpus,
  validateControls,
  validateAcceptControls,
} from "../truth/controls.ts";
import { DATA_FILE, DATA_READER_MODULE } from "../truth/data-session.ts";
import { type HiddenExpectation, type TaskBattery, validateTasks } from "../truth/tasks.ts";
import { type ToolsSpec, normalizeToolsSpec, validateToolsSpec } from "../truth/tools-spec.ts";
import { resolveToolInventory } from "../verify/tool-inventory.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { commitAll } from "./domain-repo.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import { type ExperimentSubmission, captureExperimentSubmission } from "./experiment-proposal.ts";
import { freshCandidateFindings, freshTaskValidationContext } from "./fresh-candidate-contract.ts";
import { BRIEF_FILE, CONTROLS_FILE, TASKS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";

export interface CandidateCheckContext {
  slug: string;
  /** The ask manifest's battery size, when the ask states one; its upper bound when `minTasks`
   *  opens a range. */
  exactTasks?: number;
  /** The smallest accepted size when the round leaves the count to the Builder. */
  minTasks?: number;
  /** Set by the controller when the round must capture an `EXPERIMENT.json`. */
  experimentProposalRequired?: boolean;
}

export type CandidateCheckOutcome = (
  | {
      ok: true;
      fingerprint: FingerprintEvidence;
      commit: string;
      baseCommit: string;
      changedPaths: string[];
      deletedPaths: string[];
      /** Controller-owned committed snapshot used for every acceptance decision. */
      snapshotDir: string;
      snapshotId: string;
      /** The snapshot's four validated contracts, parsed once for every later gate stage. */
      bundle: ValidatedBundle;
      /** Digest of what the declared tools resolve to on this host, which `snapshotId` cannot carry.
       *  Null when no check requires a tool. */
      engineCondition: string | null;
      /** Path-independent identity, retained with adopted conformance for later attribution. */
      verifierEnvironmentHash: string | null;
      /** Gate observations recorded with the acceptance; they refused nothing. */
      advisories: ContractFinding[];
    }
  | {
      ok: false;
      stage: "bundle";
      findings: ContractFinding[];
      commit: string;
    }
) & {
  experimentProposal?: ExperimentSubmission;
  /** Why a required EXPERIMENT.json could not be captured; reported beside, not inside, the bundle
   *  verdict. */
  proposalFindings?: ContractFinding[];
};

/** A captured candidate that passed the bundle contract: the one snapshot every later stage reads. */
export type CandidateSnapshot = Extract<CandidateCheckOutcome, { ok: true }>;

interface BundleLoad {
  findings: ContractFinding[];
  advisories: ContractFinding[];
  brief: Brief | null;
  battery: TaskBattery | null;
  corpus: ControlCorpus | null;
  toolsSpec: ToolsSpec | null;
}

/** A bundle load that refused nothing, with every part present. */
type ValidatedBundle = {
  [Part in "brief" | "battery" | "corpus" | "toolsSpec"]: NonNullable<BundleLoad[Part]>;
};

/** The two lists a validation pass appends to. */
type BatteryFindings = {
  readonly findings: ContractFinding[];
  readonly advisories: ContractFinding[];
};

/** The guide enters every case's system prompt, so its size is bounded. The starter states this
 *  number, and `test/starter-pack.test.ts` keeps the two equal. */
export const MAX_GUIDE_BYTES = 8_192;

/** Candidate bytes plus installed tool identity: the key of every remembered gate result, refusal
 *  and no-op strike. */
export function conditionKey(candidate: Pick<CandidateSnapshot, "snapshotId" | "engineCondition">): string {
  return [candidate.snapshotId, candidate.engineCondition].filter(Boolean).join("-");
}

/** The correctness-model JSON files, relative to the workspace root. */
const CORRECTNESS_MODEL_FILES = [BRIEF_FILE, TASKS_FILE, CONTROLS_FILE] as const;

/** Bytes of a bundle file, or null when it is absent or unreadable. */
function readBundleFile(workspace: string, file: string): string | null {
  try {
    return readFileSync(join(workspace, file), "utf8");
  } catch {
    return null;
  }
}

/** The finding for a missing required bundle file. */
function missingBundleFile(file: string): ContractFinding {
  return controllerValidatedFinding({
    code: "missing-bundle-file",
    path: file,
    detail: `${file} is absent, unreadable or not valid JSON — the bundle contract requires it`,
  });
}

function readJson(workspace: string, file: string, findings: ContractFinding[]): JsonValue | undefined {
  const bytes = readBundleFile(workspace, file);
  try {
    if (bytes !== null) return capturedJsonParse(bytes);
  } catch {
    // Malformed JSON is reported as a missing file: the repair is the same.
  }
  findings.push(missingBundleFile(file));
  return undefined;
}

/** Narrows a clean load; a missing part is a controller defect and throws. */
export function validatedBundle(workspace: string, loaded: BundleLoad): ValidatedBundle {
  const { brief, battery, corpus, toolsSpec } = loaded;
  if (
    loaded.findings.length > 0 ||
    brief === null ||
    battery === null ||
    corpus === null ||
    toolsSpec === null
  ) {
    throw new Error(`${workspace}: a validated snapshot is missing its brief, battery, corpus or tools spec`);
  }
  return { brief, battery, corpus, toolsSpec };
}

function validatedBrief(raw: unknown, findings: ContractFinding[]): Brief | null {
  const result = raw === undefined ? null : validateBrief(raw);
  // Brief diagnostics describe only the public contract, so they may reach the author.
  if (result !== null) findings.push(...controllerValidatedFindings(result.findings));
  return result?.ok === true
    ? /* SAFETY: `validateBrief` reported ok, which is the only proof of this shape. */ (raw as Brief)
    : null;
}

/** tasks.json holds the bare task array; this check wraps it as `{tasks: [...]}` for the validator.
 *  A file that is not an array is refused in terms of the file. */
function validatedBattery(
  brief: Brief,
  raw: unknown,
  context: CandidateCheckContext,
  sink: BatteryFindings,
  mode: "admission" | "rehearsal",
): TaskBattery | null {
  const { findings, advisories } = sink;
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) {
    findings.push(
      controllerValidatedFinding({
        code: "tasks-shape",
        path: TASKS_FILE,
        detail:
          "correctness-model/tasks.json must be a JSON array of task objects — the array is the whole file, with no wrapping object around it",
      }),
    );
    return null;
  }
  const taskContext = {
    ...freshTaskValidationContext(context.exactTasks),
    ...keyIfDefined("minTasks", context.minTasks),
  };
  const result = validateTasks(brief, { tasks: raw }, mode === "rehearsal" ? {} : taskContext);
  // A partial battery still obeys every task's input contract. Coverage belongs to admission.
  if (mode === "rehearsal") {
    result.findings = result.findings.filter(
      (finding) => !["tasks-single-family", "tasks-numeric-boundary-missing"].includes(finding.code),
    );
  }
  findings.push(...result.findings);
  advisories.push(...(result.advisories ?? []));
  return result.findings.length === 0
    ? { tasks: /* SAFETY: the check above returned when `raw === undefined`. */ raw as TaskBattery["tasks"] }
    : null;
}

/** Refuses an empty, oversized or placeholder guide, or one naming a task. Whether guidance reveals
 *  an answer is left to semantic review. */
function operatingGuideFindings(text: string, battery: TaskBattery | null): ContractFinding[] {
  const guideFinding = (detail: string): ContractFinding[] => [
    controllerValidatedFinding({ code: "operating-guide-shape", path: BUILT_AGENTS_FILE, detail }),
  ];
  if (text.trim() === "") {
    return guideFinding(
      `${BUILT_AGENTS_FILE} is empty — state how this harness's tools compose and what must hold before submission, or the agent reads per-tool descriptions and nothing else`,
    );
  }
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_GUIDE_BYTES) {
    return guideFinding(
      `${BUILT_AGENTS_FILE} is ${bytes} bytes and the limit is ${MAX_GUIDE_BYTES} — it is prepended to every case's prompt, so state the harness policy and leave per-tool detail to agent/tools-spec.json`,
    );
  }
  if (text.includes("starter-placeholder:")) {
    return guideFinding(
      `${BUILT_AGENTS_FILE} still carries the starter placeholder marker — replace the seeded rules with this domain's operating policy and delete the marker comment`,
    );
  }
  const named = (battery?.tasks ?? []).map(({ taskId }) => taskId).filter((id) => namesTask(text, id));
  if (named.length > 0) {
    return [
      controllerValidatedFinding({
        code: "operating-guide-task-identifier",
        path: BUILT_AGENTS_FILE,
        detail: `${BUILT_AGENTS_FILE} names ${named.join(", ")} — the guide states policy holding for every task, never advice about one`,
      }),
    ];
  }
  return [];
}

/** Guide findings; a missing guide is a defect. */
function guideFindings(workspace: string, battery: TaskBattery | null): ContractFinding[] {
  const guide = readBundleFile(workspace, BUILT_AGENTS_FILE);
  return guide === null ? [missingBundleFile(BUILT_AGENTS_FILE)] : operatingGuideFindings(guide, battery);
}

/** Validates the tools spec, pushes its findings and returns it only when clean. Also refuses the
 *  generated data-reader files the controller now supplies itself. */
function validatedToolsSpec(workspace: string, raw: unknown, findings: ContractFinding[]): ToolsSpec | null {
  if (raw === undefined) return null;
  const normalized = normalizeToolsSpec(raw);
  if ([DATA_FILE, DATA_READER_MODULE].some((name) => existsSync(join(workspace, "agent", name)))) {
    findings.push(
      controllerValidatedFinding({
        code: "tools-data-reader-state",
        path: "agent",
        detail:
          "Remove legacy generated data files; the controller supplies SQL over the committed public task and domain resources.",
      }),
    );
  }
  const specFindings = validateToolsSpec(normalized.value).findings;
  findings.push(...controllerValidatedFindings(specFindings));
  return specFindings.length === 0
    ? /* SAFETY: `validateToolsSpec` returned no findings, which is the only proof of this shape. */ (normalized.value as ToolsSpec)
    : null;
}

/** Refuses a `files` preset whose artifact schema the files preset cannot carry, at submit rather
 *  than at worker start. The rule lives in `fileArtifactRootIssue`. */
function filesPresetCapabilityCheck(
  workspace: string,
  brief: Brief,
  toolsSpec: ToolsSpec | null,
  findings: ContractFinding[],
): void {
  if (toolsSpec?.presets.includes("files") !== true) return;
  const compiled = loadSolvabilityPublicSchema(workspace, brief.artifactSchema);
  const issue = compiled.ok && compiled.schema !== null ? fileArtifactRootIssue(compiled.schema) : null;
  if (issue !== null) {
    findings.push(
      controllerValidatedFinding({
        code: "tools-files-preset-artifact-root",
        path: TOOLS_SPEC_FILE,
        detail: issue,
      }),
    );
  }
}

/** The task views controls bind to: the validated battery when it exists, else the readable rows
 *  of a still-defective tasks.json, so control findings are reported beside battery findings. */
function bindableTaskViews(
  battery: TaskBattery | null,
  tasksRaw: JsonValue | undefined,
): Array<{
  taskId: string;
  family: string;
  publicInput: unknown;
  hidden?: HiddenExpectation[];
}> | null {
  if (battery !== null) return battery.tasks;
  if (!Array.isArray(tasksRaw)) return null;
  return /* SAFETY: the check above returned when `!Array.isArray(tasksRaw)`. */ (
    tasksRaw as Array<{ taskId?: unknown; family?: unknown; publicInput?: unknown }>
  )
    .filter((row) => isString(row?.taskId))
    .map((row) => ({
      taskId: /* SAFETY: the filter above kept only rows whose `taskId` is a string. */ row.taskId as string,
      family: isString(row.family) ? row.family : "",
      publicInput: row.publicInput,
    }));
}

/** Bundle loading and validation shared by candidate admission and adopted-harness loading. Each
 *  returned value is non-null only when its file passed validation. */
export function loadValidatedBundle(
  workspace: string,
  context: CandidateCheckContext,
  mode: "admission" | "rehearsal" = "admission",
): BundleLoad {
  const findings: ContractFinding[] = [];
  const advisories: ContractFinding[] = [];
  const [briefRaw, tasksRaw, controlsRaw] = CORRECTNESS_MODEL_FILES.map((f) =>
    readJson(workspace, f, findings),
  );
  const specRaw = readJson(workspace, TOOLS_SPEC_FILE, findings);
  const configIssue = harnessConfigIssue(workspace);
  if (configIssue !== null) {
    findings.push(
      controllerValidatedFinding({
        code: "harness-config-invalid",
        path: HARNESS_CONFIG_FILE,
        detail: configIssue,
      }),
    );
  }

  const brief = validatedBrief(briefRaw, findings);
  // Without a valid brief, still report every contract that does not depend on it, so one check
  // surfaces them together.
  if (brief === null) {
    const toolsSpec = validatedToolsSpec(workspace, specRaw, findings);
    if (controlsRaw !== undefined && !isControlCorpus(controlsRaw)) {
      findings.push(
        controllerValidatedFinding(
          fieldFinding(CONTROLS_FILE, '{"accept": [...], "reject": [...]}', controlsRaw),
        ),
      );
    }
    findings.push(...guideFindings(workspace, null));
    if (mode === "admission") findings.push(...solverShellFindings(toolsSpec));
    return { findings, advisories, brief: null, battery: null, corpus: null, toolsSpec: null };
  }

  const battery = validatedBattery(brief, tasksRaw, context, { findings, advisories }, mode);

  let corpus: ControlCorpus | null = null;
  if (controlsRaw !== undefined) {
    if (isControlCorpus(controlsRaw)) {
      const candidate = controlsRaw;
      // Controls bind tasks by taskId, which needs only readable rows, so control findings do not
      // wait for a clean battery.
      const taskViews = bindableTaskViews(battery, tasksRaw);
      const controlFindings =
        mode === "rehearsal"
          ? validateAcceptControls(candidate.accept, brief.artifactSchema).findings
          : taskViews === null
            ? []
            : validateControls(brief, candidate, taskViews).findings;
      findings.push(...controlFindings);
      if (controlFindings.length === 0) corpus = candidate;
    } else {
      findings.push(
        controllerValidatedFinding(
          fieldFinding(CONTROLS_FILE, '{"accept": [...], "reject": [...]}', controlsRaw),
        ),
      );
    }
  }

  const toolsSpec = validatedToolsSpec(workspace, specRaw, findings);
  filesPresetCapabilityCheck(workspace, brief, toolsSpec, findings);
  findings.push(...guideFindings(workspace, battery));
  if (mode === "admission") {
    // The fresh contract compares only author-written files, so its findings may reach the author.
    findings.push(
      ...controllerValidatedFindings(freshCandidateFindings({ brief, corpus })),
      ...solverShellFindings(toolsSpec),
    );
  }
  return { findings, advisories, brief, battery, corpus, toolsSpec };
}

/** Refuses a tools spec that gives the solver no shell (neither `files` nor `shell` preset). A
 *  task-only round cannot select the preset, so the finding also names the product round that can. */
function solverShellFindings(toolsSpec: ToolsSpec | null): ContractFinding[] {
  if (toolsSpec === null || toolsSpec.presets.some((preset) => preset === "files" || preset === "shell")) {
    return [];
  }
  return [
    controllerValidatedFinding({
      code: "tools-default-preset-declined",
      path: "presets",
      detail:
        'the solver needs a shell to compute, search and test its candidate: select "files" (read, write, edit, materialize_files, bash) when the answer is files, or "shell" (bash) beside an artifact-writer. A round of scope "tasks" keeps the agent fixed, so propose a product round that selects the preset',
    }),
  ];
}

/**
 * Resolves the brief's required tools under the workspace `.toolchain` or the host PATH. An invalid
 * or unresolved id adds one bundle finding. The returned condition digest covers every resolved
 * entry whole, so an interpreter-only change is a new condition for the gate cache and strikes.
 */
function candidateToolVerdict(snapshotDir: string, toolIds: readonly string[], findings: ContractFinding[]) {
  if (toolIds.length === 0) return { engineCondition: null, verifierEnvironmentHash: null };
  const toolTree = bundleSnapshotToolTree(snapshotDir);
  const resolved = resolveToolInventory({ toolIds, toolTree });
  for (const id of resolved.invalid) {
    findings.push(
      controllerValidatedFinding({
        code: "tool-id-invalid",
        path: BRIEF_FILE,
        detail: `required tool entry "${id}" is not a command name; use the bare executable name (letters, digits, "_", ".", "+", "-", at most 64 characters) of a tool installed under .toolchain or on the host PATH`,
      }),
    );
  }
  for (const id of resolved.missing) {
    findings.push(
      controllerValidatedFinding({
        code: "tool-missing",
        path: BRIEF_FILE,
        detail: `required tool entry "${id}" resolves to no executable ${toolTree === null ? "(this workspace has no .toolchain tree)" : "under .toolchain (any bin directory)"} or on the host PATH; install the public tool under .toolchain or on the host PATH, or name the installed command`,
      }),
    );
  }
  return {
    verifierEnvironmentHash: verifierEnvironmentHashOfTools(resolved.inventory),
    engineCondition: hashJsonValue(
      Object.values(resolved.inventory).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    ),
  };
}

/**
 * Commits the working tree, fingerprints it, creates the immutable snapshot and validates the file
 * contract on that snapshot. A refused candidate still stays in the Builder's Git history. The
 * campaign runs the later gates on the same snapshot.
 */
export function checkCandidate(
  workspace: string,
  context: CandidateCheckContext,
  commitMessage = `submit: candidate for validation (${context.slug})`,
): CandidateCheckOutcome {
  const change = commitAll(workspace, commitMessage);
  const proposal =
    context.experimentProposalRequired === true ? captureExperimentSubmission(workspace) : undefined;
  const proposalKeys = {
    ...keyIfDefined("experimentProposal", proposal?.ok === true ? proposal.experiment : undefined),
    ...keyIfDefined("proposalFindings", proposal?.ok === false ? proposal.findings : undefined),
  };
  const fingerprint = fingerprintSlug(workspace, { slug: context.slug });
  if (!fingerprint.ok) {
    const findings = fingerprint.findings.map((f) =>
      controllerValidatedFinding({ code: f.code, path: f.file, detail: f.detail }),
    );
    return { ok: false, stage: "bundle", findings, commit: change.commit, ...proposalKeys };
  }
  const snapshot = createBundleSnapshot(workspace, fingerprint);
  const loaded = loadValidatedBundle(snapshot.dir, context);
  const toolFindings: ContractFinding[] = [];
  const requiredToolIds = [
    ...new Set((loaded.brief?.truthChecks ?? []).flatMap((check) => requiredToolsOf(check.execution))),
  ].sort();
  const toolCondition = candidateToolVerdict(snapshot.dir, requiredToolIds, toolFindings);
  const findings = [...loaded.findings, ...toolFindings];
  if (findings.length > 0) {
    return { ok: false, stage: "bundle", findings, commit: change.commit, ...proposalKeys };
  }
  return {
    ok: true,
    fingerprint,
    commit: change.commit,
    baseCommit: change.baseCommit,
    changedPaths: change.changedPaths,
    deletedPaths: change.deletedPaths,
    snapshotDir: snapshot.dir,
    snapshotId: snapshot.id,
    bundle: validatedBundle(snapshot.dir, loaded),
    ...toolCondition,
    advisories: loaded.advisories,
    ...proposalKeys,
  };
}
