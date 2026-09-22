/**
 * Capture and validate a candidate from the Builder's workspace repository (Simple Harness
 * Builder plan, stages 2/3; operator direction 2026-07-26). The Builder writes files through
 * its confined tools. This check records the workspace in Git, fingerprints the bundle,
 * creates an immutable snapshot, and validates the files read from that snapshot.
 * Later adoption gates use those same captured files.
 * Git preserves the Builder's working history; the snapshot and fingerprint identify the
 * candidate being checked. `changedPaths` records the difference from the previous commit
 * so the controller can attribute a repair without telling the Builder how to make it.
 *
 * Capture once and use the same snapshot throughout admission. A refusal still records the
 * working tree in Git, but later gates do not reconstruct the candidate from that history.
 *
 * Reading from disk closed an earlier gap: the old session path validated model text, then
 * reread only the brief and tasks. This check validates all four JSON bundle files.
 * The solver receives public task data separately for each case through commitPublicTask,
 * so there is no generated agent-side copy to become stale or expose hidden data.
 * That design replaced agent/tasks-public.json on 2026-07-28. Every outgoing finding passes
 * through the author projection, which withholds unclassified details by default and
 * preserves the separation between public authoring feedback and protected verifier output.
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
  /** The controller, not a carried draft, enables model-led continuation from an adopted product. */
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
      /** The snapshot's four validated contracts, read once here; every later gate stage consumes
       *  these values instead of parsing the same bytes again. */
      bundle: ValidatedBundle;
      /** What this candidate's declared tools resolve to on this host, each resolved entry whole — the
       *  half of its identity `snapshotId` cannot carry, because the tool tree is machine-local by
       *  construction. Null when the brief grounds no check on a tool, so there is nothing outside
       *  the bytes to move. */
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
  /** Why a required EXPERIMENT.json could not be captured: an admission finding reported beside
   *  the bundle verdict, which the file contract still decides on its own. */
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

/** The two lists a validation pass appends to. They travel together because a finding and the
 *  advisory beside it are written by the same walk. */
type BatteryFindings = {
  readonly findings: ContractFinding[];
  readonly advisories: ContractFinding[];
};

/** The guide enters every case's system prompt; bound its repeated reading cost. The starter
 *  contract states this number to the Builder, and `test/starter-pack.test.ts` holds the two together. */
export const MAX_GUIDE_BYTES = 8_192;

/** Candidate bytes and the installed verifier bytes jointly identify a submission condition: the
 *  key of every remembered gate result, refusal and no-op strike. */
export function conditionKey(candidate: Pick<CandidateSnapshot, "snapshotId" | "engineCondition">): string {
  return [candidate.snapshotId, candidate.engineCondition].filter(Boolean).join("-");
}

/** The four JSON bundle contracts the candidate check reads, all relative to the workspace root.
 *  `BUILT_AGENTS.md` is the fifth read and is handled beside them in `loadValidatedBundle`. */
const CORRECTNESS_MODEL_FILES = [BRIEF_FILE, TASKS_FILE, CONTROLS_FILE] as const;
/** Bytes of a bundle file, or null when it is absent. Reading is separated from deciding what the
 *  absence means: the four JSON contracts and the guide refuse it, and only the guide's own
 *  findings read its bytes. */
function readBundleFile(workspace: string, file: string): string | null {
  try {
    return readFileSync(join(workspace, file), "utf8");
  } catch {
    return null;
  }
}

/** The absence a required bundle file reports, stated once so the guide and the four JSON
 *  contracts refuse a missing file in the same words. */
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
    // Malformed JSON has the absent file's repair: write it again. A thrown parse error names no file.
  }
  findings.push(missingBundleFile(file));
  return undefined;
}

/** A clean load with a missing part is a controller invariant: it throws instead of returning a
 *  finding nobody can repair. */
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
  // Brief diagnostics describe only the Builder-authored public contract. Mark them here so the
  // fail-closed isolation keeps protecting every unrelated or generated finding by default.
  if (result !== null) findings.push(...controllerValidatedFindings(result.findings));
  return result?.ok === true
    ? /* SAFETY: `validateBrief` reported ok, which is the only proof of this shape. */ (raw as Brief)
    : null;
}

/** correctness-model/tasks.json holds the bare task ARRAY; `{tasks: [...]}` is the validator's shape, which
 *  this check supplies. A file that carries the wrapper itself would be validated as a battery whose
 *  one "task" is that object, and the resulting diagnostic quotes back `{"tasks": [...]}` — the very
 *  shape the author just wrote. The file-level check refuses it in terms of the file instead. */
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

/**
 * Code limits the guide's size and refuses placeholders and task-specific advice. The tool list
 * retains advisers, and no repair consumer reads rule markers. Neither tool names nor Markdown
 * formatting decides whether guidance reveals an answer; that remains a semantic review.
 */
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
  // The seed is nonempty and in budget; require the Builder to replace its placeholder.
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

/** Present guide bytes are validated on every path, and a missing guide is a defect. */
function guideFindings(workspace: string, battery: TaskBattery | null): ContractFinding[] {
  const guide = readBundleFile(workspace, BUILT_AGENTS_FILE);
  return guide === null ? [missingBundleFile(BUILT_AGENTS_FILE)] : operatingGuideFindings(guide, battery);
}

/** Mirrors validatedBrief for the tools contract: validate one bundle file, push its findings,
 *  return the parsed value only when it is clean. The public-data pair belongs to this contract,
 *  so its state check lives beside the spec instead of in the caller. */
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

/** Submit-time preset capability (run 8x: a files preset the schema cannot carry surfaced 71
 *  minutes into a paid battery as a worker-start non-result). The rule and its message live with
 *  their owner, draft-files' fileArtifactRootIssue; the candidate check only reports it where the Builder
 *  can repair it in the same session. No accept corpus compiles no schema and stays with the
 *  corpus findings. */
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

/** Shared bundle loading and validation for checkCandidate and loadHarnessSnapshot.
 *  Candidate admission needs the findings and declared tools; loading an adopted harness also
 *  needs the parsed values. Each returned value is non-null only when its file passed
 *  validation, so callers can reuse adopted content without rewriting it. */
/** The task views controls bind to: the validated battery when it exists, else the readable rows
 *  of a still-defective tasks.json, so control findings contract beside battery findings. */
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
  // Without a valid brief the task and control contracts have nothing to check against, but the
  // tools spec, operating guide and controls envelope do not read it: run 766284 (2026-09-16)
  // spent four checks meeting one validator at a time.
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
      // Controls bind battery tasks by taskId. Binding needs only readable rows with string ids,
      // so floor and shape findings contract beside battery findings instead of hiding behind
      // them; candidate validation still refuses on the battery findings themselves.
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
    // The fresh contract compares the kickoff, the brief, the battery and the controls against
    // each other and nothing else runs here, so these diagnostics cross like the three above.
    // Run 36 attempt 3 spent 102 minutes on the two that did not: a 2/20 accept and a 7/20 reject
    // calibration shortfall, each arriving as generated-execution-unclassified.
    findings.push(
      ...controllerValidatedFindings(freshCandidateFindings({ brief, corpus })),
      ...solverShellFindings(toolsSpec),
    );
  }
  return { findings, advisories, brief, battery, corpus, toolsSpec };
}

/** A recorded bundle may carry a declined reason for the solver's shell; a build that authors the
 *  agent may not (operator decision 2026-09-14: 62 truss epochs and the rehearsal of that day
 *  declined it, because the files preset turns draft files into the answer and their answers were
 *  structured records; their solvers then only called their own tools). `shell` gives that shell
 *  beside an artifact-writer. Every truss cycle exported on 2026-09-17 still carried
 *  `presets: []`: the check ran on the first build alone, so a continuation that reopened the
 *  agent inherited the shell-less roster round after round. A task-only round cannot select the
 *  preset itself, and it may not measure around the gap either, so its finding names the scope
 *  that owns the repair. */
/** A task-only round keeps the agent fixed and cannot select the preset, and harder tasks do not
 *  measure past a known product blocker (rule 11), so the one finding names both repairs. */
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
 * Whether the tools the brief names are installed where the host will look, appending any
 * authoring finding it earns. Two outcomes:
 *
 * - a named tool id is not a plain command name, or resolves to no executable under the
 *   workspace `.toolchain` or the host PATH → one bundle finding per tool naming where the host
 *   looked. The refusal keeps the session like any bundle finding; the ordinary no-op resubmit
 *   strikes end it. Accepting would spend the whole census before each run settled as a
 *   non-result, which reads as the domain being ungradable;
 * - every named tool resolved → the candidate evaluates over those exact executables, and the
 *   returned condition digest names every resolved entry whole (null with no tool): a projection
 *   of four fields once left out the interpreter a script runs under. The gate cache, the
 *   remembered preview and the no-op strike all key on it, so an interpreter-only change is a new
 *   condition, as it already was for `verifierEnvironmentHash`.
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
 * Record the working tree, capture the candidate and check its file contract: fingerprint the
 * files, create the immutable bundle snapshot and validate that snapshot. Even a refused candidate
 * remains in the Builder's Git history, and every validity decision reads the same captured bytes;
 * proposal prose carries no progress identity. F2 solvability and the control census run later on
 * the same bundle. The campaign runs those gates; this check establishes candidate identity and
 * validates the file contract.
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
  // All required tools resolve before the candidate can be admitted.
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
