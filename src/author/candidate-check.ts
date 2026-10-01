/**
 * Captures and validates a candidate from the Builder's workspace repository. The Builder writes
 * its files through confined tools, so what is on disk at submit is the candidate; this check
 * records that working tree in Git, fingerprints the bundle, creates an immutable snapshot and then
 * validates the files read back from that snapshot rather than from the workspace. Every later
 * adoption gate reads those same captured bytes, which is what makes one submit one condition:
 * nothing the Builder does after the capture can move what validation, the census, F2 and
 * measurement each decide. `changedPaths` records the difference from the previous commit, so the
 * controller can attribute a repair without ever telling the Builder how to make it.
 *
 * A refusal still leaves the working tree committed, because Git is the Builder's memory; but no
 * later gate reconstructs a candidate from that history, since only the snapshot has an identity.
 *
 * All four JSON files and the operating guide are validated against the snapshot, not just the
 * brief and the tasks: a contract checked against the workspace is not checked against the bytes
 * that will be measured. The solver receives public task data per case through `commitPublicTask`,
 * so there is no generated agent-side copy that could go stale or carry hidden data.
 *
 * Every outgoing finding passes through the author projection, which withholds unclassified detail
 * by default and so keeps public authoring feedback separate from protected verifier output.
 */
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { readFileSync } from "../meta/filesystem.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { join } from "../meta/path.ts";
import { createBundleSnapshot, bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { type FingerprintEvidence, fingerprintSlug } from "../claim/fingerprint.ts";
import { BUILT_AGENTS_FILE } from "../solve/built-starter.ts";
import { validateBrief } from "../correctness-bundle/brief-validator.ts";
import { HARNESS_CONFIG_FILE, harnessConfigIssue } from "../correctness-bundle/harness-config.ts";
import {
  type Brief,
  requiredToolsOf,
  type ContractFinding,
  controllerValidatedFinding,
  controllerValidatedFindings,
  fieldFinding,
} from "../correctness-bundle/brief.ts";
import { fileArtifactRootIssue } from "../solve/draft-files.ts";
import { loadSolvabilityPublicSchema } from "../correctness-bundle/solvability-artifact-schema.ts";
import { verifierEnvironmentHashOfTools } from "../correctness-bundle/verifier-environment.ts";
import {
  type ControlCorpus,
  isControlCorpus,
  validateControls,
  validateAcceptControls,
} from "../correctness-bundle/controls.ts";
import { type HiddenExpectation, type TaskBattery, validateTasks } from "../correctness-bundle/tasks.ts";
import { type ToolsSpec, normalizeToolsSpec, validateToolsSpec } from "../correctness-bundle/tools-spec.ts";
import { resolveToolInventory, toolTreeDigest } from "../verify/tool-inventory.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { commitAll } from "./domain-repo.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { BRIEF_FILE, CONTROLS_FILE, TASKS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";

/** Paths a guide may name that the solver's shell has no file at: anything inside the tool tree or
 *  the correctness model. Each command runs in a fresh folder holding neither, with the tool tree's
 *  program directories on PATH, so only a program's name reaches it. */
const UNREACHABLE_GUIDE_PATH = /(?:~\/)?\.toolchain\/[^\s`'"()<>[\]]+|\bcorrectness-model\/[^\s`'"()<>[\]]*/g;
/** `.toolchain/bin/<program>` names a program the shell runs by that last segment, which is how the
 *  contract tells the Builder to install one, so the guide naming it that way still names the program. */
const TOOLCHAIN_PROGRAM = /^\.toolchain\/bin\/[^/]+$/;
const LISTED_GUIDE_PATHS = 5;
/** Module files a copy between the two bundles could carry a check's computation in. */
const CODE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

export interface CandidateCheckContext {
  slug: string;
  /** The ask manifest's battery size, when the ask states one; its upper bound when `minTasks`
   *  opens a range instead. A size the round asked for is a measurement condition, so it is
   *  checked rather than clamped. */
  exactTasks?: number;
  /** The smallest accepted size when the round leaves the count to the Builder, which is how a
   *  fresh product's probe batteries are sized: the Builder picks, and the floor keeps the pick
   *  from becoming a battery too small to read. */
  minTasks?: number;
}

export type CandidateCheckOutcome =
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
      /** The snapshot's four validated contracts, read and parsed once here; every later gate stage
       *  consumes these values rather than parsing the same bytes again, so no stage can disagree
       *  with another about what the candidate says. */
      bundle: ValidatedBundle;
      /** What this candidate's declared tools resolve to on this host, each resolved entry whole,
       *  and the content of the tool tree behind them: the half of the submission's identity
       *  `snapshotId` cannot carry, because the tool tree is machine-local and the same bytes
       *  evaluate differently over different executables. Null when the brief grounds no check on a
       *  tool. */
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
 *  advisory beside it are written by the same walk, and separating them would mean walking twice
 *  or threading two sinks through every validator. */
type BatteryFindings = {
  readonly findings: ContractFinding[];
  readonly advisories: ContractFinding[];
};

/** Candidate bytes and the installed verifier bytes jointly identify a submission condition, and
 *  this is the key of every remembered gate result, refusal and no-op strike. Both halves are
 *  needed: the same snapshot over different tools is a different condition, so keying on the
 *  snapshot alone would serve a cached verdict for a gate that never ran over these executables. */
export function conditionKey(candidate: Pick<CandidateSnapshot, "snapshotId" | "engineCondition">): string {
  return [candidate.snapshotId, candidate.engineCondition].filter(Boolean).join("-");
}

/** The correctness-model JSON contracts, relative to the workspace root. `agent/tools-spec.json` is
 *  the fourth JSON file and `agent/BUILT_AGENTS.md` the fifth read; both are handled beside these
 *  in `loadValidatedBundle`, because neither belongs to the correctness model. */
const CORRECTNESS_MODEL_FILES = [BRIEF_FILE, TASKS_FILE, CONTROLS_FILE] as const;

/** Bytes of a bundle file, or null when it is absent or unreadable. Reading is kept separate from
 *  deciding what an absence means, because the four JSON contracts and the guide all refuse a
 *  missing file but only the guide's own findings read its bytes. */
function readBundleFile(workspace: string, file: string): string | null {
  try {
    return readFileSync(join(workspace, file), "utf8");
  } catch {
    return null;
  }
}

/** The absence a required bundle file reports, stated once here so that the guide and the four JSON
 *  contracts all refuse a missing file in the same words. */
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
    // Malformed JSON gets the absent file's finding, because the repair is the same one — write the
    // file again — and a thrown parse error names no file at all.
  }
  findings.push(missingBundleFile(file));
  return undefined;
}

/** Narrows a clean load to its four parts. A load that reported no finding and is still missing a
 *  part is a controller invariant broken, not a candidate defect, so it throws rather than
 *  returning a finding no Builder could act on. */
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
  // Brief diagnostics describe only the Builder-authored public contract, so they are marked
  // author-visible — per producer, so the isolation still fails closed for every other producer.
  if (result !== null) findings.push(...controllerValidatedFindings(result.findings));
  return result?.ok === true
    ? /* SAFETY: `validateBrief` reported ok, which is the only proof of this shape. */ (raw as Brief)
    : null;
}

/** correctness-model/tasks.json holds the bare task array, and `{tasks: [...]}` is the validator's
 *  shape, which this check supplies. A file that carries the wrapper itself would otherwise be
 *  validated as a battery whose single "task" is that object, and the diagnostic would quote back
 *  the very shape the author had just written; the file-level check refuses it as a file instead. */
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
    exactTasks: context.exactTasks ?? null,
    ...keyIfDefined("minTasks", context.minTasks),
  };
  const result = validateTasks(brief, { tasks: raw }, mode === "rehearsal" ? {} : taskContext);
  findings.push(...result.findings);
  advisories.push(...(result.advisories ?? []));
  return result.findings.length === 0
    ? { tasks: /* SAFETY: the check above returned when `raw === undefined`. */ raw as TaskBattery["tasks"] }
    : null;
}

/** The guide's paths the solver's shell cannot open. Advisory: a guide naming one still ships, but
 *  a solver told to run it meets "not found" and falls back to re-implementing what it computes. */
function unreachableGuidePaths(guide: string): ContractFinding[] {
  const paths = [
    ...new Set(
      [...guide.matchAll(UNREACHABLE_GUIDE_PATH)].flatMap(([match]) => {
        const path = match.replace(/[.,;:]+$/, "");
        return TOOLCHAIN_PROGRAM.test(path) ? [] : [path];
      }),
    ),
  ];
  if (paths.length === 0) return [];
  const rest = paths.length - LISTED_GUIDE_PATHS;
  const named = `${paths.slice(0, LISTED_GUIDE_PATHS).join(", ")}${rest > 0 ? ` and ${String(rest)} more` : ""}`;
  return [
    controllerValidatedFinding({
      code: "operating-guide-unreachable-path",
      path: BUILT_AGENTS_FILE,
      detail: `${BUILT_AGENTS_FILE} names ${named}, which the solver's shell has no file at: each command runs in a fresh folder without .toolchain or correctness-model/, and only programs in .toolchain's bin directories reach it, by name. Name the program that runs instead`,
    }),
  ];
}

/** An absent, empty or still-seeded guide is a bundle defect: the agent reads this file before
 *  every task, so a harness without a written one ships a solver that has only its per-tool
 *  descriptions to work from. A path the solver's shell cannot open is an advisory beside it.
 *  Whether the guidance is any good, or says too much, is review's. */
function guideFindings(workspace: string, { findings, advisories }: BatteryFindings): void {
  const guide = readBundleFile(workspace, BUILT_AGENTS_FILE);
  if (guide === null) {
    findings.push(missingBundleFile(BUILT_AGENTS_FILE));
    return;
  }
  const detail =
    guide.trim() === ""
      ? `${BUILT_AGENTS_FILE} is empty — state how this harness's tools compose and what must hold before submission, or the agent reads per-tool descriptions and nothing else`
      : guide.includes("starter-placeholder:")
        ? `${BUILT_AGENTS_FILE} still carries the starter placeholder marker — replace the seeded rules with this domain's operating policy and delete the marker comment`
        : null;
  if (detail !== null) {
    findings.push(
      controllerValidatedFinding({ code: "operating-guide-shape", path: BUILT_AGENTS_FILE, detail }),
    );
  }
  advisories.push(...unreachableGuidePaths(guide));
}

/** Mirrors `validatedBrief` for the tools contract: validate one bundle file, push its findings and
 *  return the parsed value only when it is clean. */
function validatedToolsSpec(raw: unknown, findings: ContractFinding[]): ToolsSpec | null {
  if (raw === undefined) return null;
  const normalized = normalizeToolsSpec(raw);
  const specFindings = validateToolsSpec(normalized.value).findings;
  findings.push(...controllerValidatedFindings(specFindings));
  return specFindings.length === 0
    ? /* SAFETY: `validateToolsSpec` returned no findings, which is the only proof of this shape. */ (normalized.value as ToolsSpec)
    : null;
}

/** Refuses a `files` preset whose artifact schema that preset cannot carry, at submit rather than
 *  at worker start, where the same mismatch surfaces as a non-result an hour into a paid battery
 *  that then measures nothing. The rule and its message live with their owner,
 *  `fileArtifactRootIssue` in draft-files; this check reports it where the Builder can still repair
 *  it in the same session. A bundle with no accept corpus compiles no schema, so there is nothing
 *  to test here and the refusal stays with the corpus findings. */
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

/** A candidate the fingerprint refused, as the findings preview and rehearsal both show. */
export function fingerprintRefusal(
  findings: readonly { code: string; file: string; detail: string }[],
): ContractFinding[] {
  return findings.map((f) => controllerValidatedFinding({ code: f.code, path: f.file, detail: f.detail }));
}

/** Agent code byte-identical to correctness-model code, as `[agent path, correctness-model path]`
 *  pairs. A solver tool running a check's own module can do the check's work, analysing a candidate
 *  or computing what the check expects, which `NO_GRADER_IN_REACH` rules out, since a solver that
 *  can ask the grader passes its batteries whole (AGENTS.md "Goals and the climb"). Equal bytes
 *  are a lead, not the finding: published constants and standard routines are shared legitimately,
 *  and a rewritten expectation model matches no bytes. */
export function agentCheckCodeCopies(
  fingerprint: Pick<FingerprintEvidence, "agentFiles" | "correctnessModelFiles">,
): Array<[string, string]> {
  const checkCode = new Map(
    fingerprint.correctnessModelFiles
      .filter(({ path }) => CODE_FILE.test(path))
      .map(({ path, sha256 }) => [sha256, path]),
  );
  return fingerprint.agentFiles.flatMap(({ path, sha256 }): Array<[string, string]> => {
    const original = checkCode.get(sha256);
    return original === undefined || !CODE_FILE.test(path) ? [] : [[path, original]];
  });
}

/** Each copy as an advisory, never a refusal (operator, 2026-09-30: "simplicity and leniency"): the
 *  Builder reads it in readiness and decides; a paraphrase is review's. */
function agentCopiesOfCheckCode(fingerprint: FingerprintEvidence): ContractFinding[] {
  return agentCheckCodeCopies(fingerprint).map(([path, original]) =>
    controllerValidatedFinding({
      code: "agent-copies-check-code",
      path: `agent/${path}`,
      detail: `agent/${path} is byte-identical to correctness-model/${original}; read it against the publication rule on what the solver's tools may do. Shared published rules, constants and standard computation may stay`,
    }),
  );
}

/** Bundle loading and validation shared by `checkCandidate` and `loadHarnessSnapshot`. Candidate
 *  admission needs the findings and the declared tools; loading an adopted harness needs the parsed
 *  values instead. Each returned value is non-null only when its own file passed validation, which
 *  is what lets a caller reuse adopted content without revalidating or rewriting it. */
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
  // tools spec, the operating guide and the controls envelope do not read the brief at all, so they
  // are still reported: otherwise an author spends one check per validator meeting them in turn.
  if (brief === null) {
    validatedToolsSpec(specRaw, findings);
    if (controlsRaw !== undefined && !isControlCorpus(controlsRaw)) {
      findings.push(
        controllerValidatedFinding(
          fieldFinding(CONTROLS_FILE, '{"accept": [...], "reject": [...]}', controlsRaw),
        ),
      );
    }
    guideFindings(workspace, { findings, advisories });
    return { findings, advisories, brief: null, battery: null, corpus: null, toolsSpec: null };
  }

  const battery = validatedBattery(brief, tasksRaw, context, { findings, advisories }, mode);

  let corpus: ControlCorpus | null = null;
  if (controlsRaw !== undefined) {
    if (isControlCorpus(controlsRaw)) {
      const candidate = controlsRaw;
      // Controls bind battery tasks by taskId, and binding needs only readable rows with string
      // ids, so a control floor or shape finding arrives beside the battery findings rather than
      // hiding behind them for a round. Validation still refuses on the battery findings themselves.
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

  const toolsSpec = validatedToolsSpec(specRaw, findings);
  filesPresetCapabilityCheck(workspace, brief, toolsSpec, findings);
  guideFindings(workspace, { findings, advisories });
  if (mode === "admission") {
    // The fresh contract compares the kickoff, the brief, the battery and the controls against each
    // other and reads nothing else, so its diagnostics are made of author-written material and may
    // cross to the author. Unmarked, a calibration shortfall arrives as
    // generated-execution-unclassified, which tells an author that something is wrong and not what.
    findings.push(...controllerValidatedFindings(freshCandidateFindings({ brief, corpus })));
  }
  return { findings, advisories, brief, battery, corpus, toolsSpec };
}

/**
 * The controller contracts that apply to a fresh build alone, kept together so a continuation
 * round cannot be measured against a rule written for a first one.
 *
 * Every finding this produces survives the author projection, because its caller wraps the whole
 * result in `controllerValidatedFindings`. That is sound only because each producer here compares
 * the brief and the controls against each other and reads no verifier result, counterexample or
 * control artifact. A new producer inherits that marking rather than opting into it, so before
 * adding one, read every finding it can emit and keep its detail to public authoring identities.
 */
export function freshCandidateFindings(loaded: {
  brief: Brief | null;
  corpus: ControlCorpus | null;
}): ContractFinding[] {
  if (loaded.brief === null || loaded.corpus === null) return [];
  try {
    compilePublicArtifactSchema(
      loaded.brief.artifactSchema,
      loaded.corpus.accept.map((accept) => accept.artifact),
    );
    return [];
  } catch (error) {
    return [
      { code: "controls-accept-public-schema-inconsistent", path: "accept", detail: errorMessage(error) },
    ];
  }
}

/**
 * Whether the tools the brief names are installed where the host will look, appending any authoring
 * finding that earns.
 *
 * A named tool id that is not a plain command name, or that resolves to no executable under the
 * workspace `.toolchain` or on the host PATH, produces one bundle finding per tool naming where the
 * host looked. The refusal keeps the session, and the ordinary no-op resubmit strikes end it if
 * nothing changes. Accepting instead would spend the whole census before each run settled as a
 * non-result, which reads from the outside as the domain being ungradable rather than as a tool
 * never having been installed.
 *
 * When every named tool resolves, the candidate is evaluated over those exact executables, and the
 * returned condition digest names every resolved entry whole rather than a projection of a few
 * fields, which would leave out the interpreter a script runs under, and beside them the tool tree's
 * content (`toolTreeDigest`), which a wrapper's own bytes leave out. The gate cache, the remembered
 * preview and the no-op strike all key on this digest, so an interpreter-only change or a repair
 * behind an unchanged wrapper is a new condition, while a tool run that only wrote its own caches
 * is not. `verifierEnvironmentHash` travels between machines, so it keeps the entries alone, each
 * workspace entry with the portable tree digest, which counts every file by its bytes, not by inode.
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
    engineCondition: hashJsonValue({
      tools: Object.values(resolved.inventory).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      tree: toolTree === null ? null : toolTreeDigest(toolTree),
    }),
  };
}

/** Record the working tree, capture the candidate and check its file contract: fingerprint the
 *  files, create the immutable bundle snapshot and validate that snapshot. Even a refused candidate
 *  remains in the Builder's Git history, so nothing an author wrote is lost by being refused, and
 *  every validity decision after this point reads the same captured bytes rather than whatever the
 *  workspace holds by then. F2 solvability and the control census run later on that same bundle;
 *  the campaign owns those gates, while this check establishes identity and the file contract. */
export function checkCandidate(
  workspace: string,
  context: CandidateCheckContext,
  commitMessage = `submit: candidate for validation (${context.slug})`,
): CandidateCheckOutcome {
  const change = commitAll(workspace, commitMessage);
  const fingerprint = fingerprintSlug(workspace, { slug: context.slug });
  if (!fingerprint.ok) {
    return {
      ok: false,
      stage: "bundle",
      findings: fingerprintRefusal(fingerprint.findings),
      commit: change.commit,
    };
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
    return { ok: false, stage: "bundle", findings, commit: change.commit };
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
    advisories: [...loaded.advisories, ...agentCopiesOfCheckCode(fingerprint)],
  };
}
