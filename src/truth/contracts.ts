// Structural import-order gate: capture controller primitives before any loader below can import
// generated source, including direct contracts.ts callers that do not enter through falsify.ts.
import { trustedJsonParse as nativeParse } from "./trusted-runtime.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { isFunction, type OpenRecord } from "../meta/json-shape.ts";
import { harnessSettings } from "./harness-config.ts";
import { join } from "../meta/path.ts";
/**
 * Generated-module export contracts used by the evaluation runner when loading a fingerprinted
 * bundle. This consumer defines the expected interfaces, and the Builder's instructions describe
 * them during authoring. Loading checks the required exports and reports a contract error
 * immediately, so an incompatible module can be repaired before battery measurement begins.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  BUILT_AGENTS_FILE,
  type BuiltStarter,
  type DomainHarnessFactory,
  type DomainToolAuthority,
  createBuiltStarter,
} from "../solve/built-starter.ts";
import { createDraftFileTools } from "../solve/draft-files.ts";
import { typecheckGeneratedModule } from "./generated-module-typecheck.ts";
import type { SubmissionPort } from "../solve/final-submission.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type { VerifierRuntime } from "../verify/verifier-port.ts";
import { type Brief, type ContractFinding, controllerValidatedFindings, throwIfInvalid } from "./brief.ts";
import { loadFailureFinding } from "./load-fault.ts";
import type { BuiltPresetId } from "./built-presets.ts";
import { DATA_FILE, DATA_READER_MODULE } from "./data-session.ts";
import type { CheckRunner, EvaluationRequest } from "./correctness-model-contract.ts";
import { dataTool } from "./data-tool.ts";
import { briefPublicResources, publicResourcesTool, readValidatedBrief } from "./public-resources.ts";
import { publishedMargins } from "./numeric-boundary.ts";
import type { PublishedMargin } from "../solve/published-margin.ts";
import type { PublicTask } from "./task-split.ts";
import { type ToolsSpec, validateToolsSpec } from "./tools-spec.ts";
import {
  bundleEvaluator,
  bundleReferenceSolve,
  REFERENCE_SOLVE_ENTRY,
  REFERENCE_SOLVE_MIGRATION,
} from "./evaluator-process-bundle.ts";
import { evaluateIsolated, evaluatorEnvironmentStop, probeEvaluatorProcess } from "./evaluator-process.ts";
import { validateBrief } from "./brief-validator.ts";
import type { VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { BRIEF_FILE, EVALUATOR_FILE, GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE } from "../meta/bundle-layout.ts";

/** The controller-assembled solve contract. Generated code contributes a DomainHarness only. */
export type Toolset = BuiltStarter;

type BuiltStarterFactory = (
  task: PublicTask<unknown>,
  submission: SubmissionPort,
  publicArtifactSchema: PublicArtifactSchema,
) => Toolset;

const nativeFreeze = Object.freeze.bind(Object);

/**
 * Trusted capabilities assembled outside generated code. The direct Pi path passes these tools
 * beside the generated worker proxies; agent/tools.ts is never imported into this process.
 */
export interface BuiltControllerInterface {
  controllerTools: (task: PublicTask<unknown>) => readonly AgentTool<never>[];
  presets: readonly BuiltPresetId[];
  domainToolAuthorities: readonly DomainToolAuthority[];
  operatingGuide: string;
  /** Derived from the same brief read the public resources come from, so the limits the solver can
   *  read and the limits its prepared answer is measured against are one declaration. */
  publishedMargins: readonly PublishedMargin[];
}

/** The controller-aggregated evaluation result. Generated source exports named boolean checks.
 *  The request is an EvaluationRequest — one shape for every evaluate, always carrying the public
 *  task, so no check is task-blind.
 *  `runtime` is the host-owned capability boundary: external-verifier groundings call
 *  `runtime.tools.run({ toolId, checkId, args, files, stdin })` — the host runs the installed tool
 *  inside a cell holding only the runner-bound artifact and public task (correctnessModel code never
 *  supplies either) and returns exit code and output; a purely intrinsic evaluator ignores it. */
export type EvaluatorFn = (
  request: EvaluationRequest,
  runtime?: VerifierRuntime,
  /** A reject control's declared check, run alone; measured cases never pass it. */
  onlyCheckId?: string,
) => CorrectnessModelResult | Promise<CorrectnessModelResult>;

/** Bound on loading one generated module. Converts a load that never settles (an unresolved
 * top-level await in generated code) into a throw the callers' existing load-failure paths
 * already handle. A synchronous loop in generated top-level code blocks the event loop and
 * cannot be preempted in-process; only a subprocess loader would bound that case. */
const GENERATED_IMPORT_TIMEOUT_MS = 30_000;

function readBuiltToolSelection(slugDir: string) {
  const file = join(slugDir, TOOLS_SPEC_FILE);
  if (!existsSync(file)) throw new Error(`${file} is missing`);
  const parsed: unknown = nativeParse(readFileSync(file, "utf8"));
  throwIfInvalid(validateToolsSpec(parsed), `${file} is invalid`);
  const spec =
    /* SAFETY: throwIfInvalid above returns only when validateToolsSpec reported ok, which it does only for a value carrying the contract. */ parsed as ToolsSpec;
  return {
    presets: spec.presets,
    domainToolAuthorities: spec.tools.map(({ name, kind }) => ({ name, authority: kind })),
  };
}

export async function loadBuiltControllerInterface(slugDir: string): Promise<BuiltControllerInterface> {
  const { presets, domainToolAuthorities } = readBuiltToolSelection(slugDir);
  // Read from the tree the worker is about to bundle, which during measurement is the executed
  // bundleSnapshot. Admission refuses a bundle without a guide, so a missing one is a defect here.
  const guideFile = join(slugDir, BUILT_AGENTS_FILE);
  if (!existsSync(guideFile)) throw new Error(`${guideFile} is missing`);
  const operatingGuide = readFileSync(guideFile, "utf8");
  if ([DATA_FILE, DATA_READER_MODULE].some((name) => existsSync(join(slugDir, "agent", name)))) {
    throw new Error(
      "legacy generated data files are unsupported; query_public_data reads committed public task and resource snapshots",
    );
  }
  const brief = readValidatedBrief(slugDir);
  const resources = brief === null ? [] : briefPublicResources(brief);
  const publicTool = publicResourcesTool(resources);
  const controllerTools = (task: PublicTask<unknown>) =>
    nativeFreeze([
      ...(presets.includes("public-data") ? [dataTool(task, resources)] : []),
      ...(publicTool === null ? [] : [publicTool]),
    ]);
  return {
    controllerTools,
    presets,
    domainToolAuthorities,
    operatingGuide,
    publishedMargins: brief === null ? [] : publishedMargins(brief),
  };
}

async function importGenerated(
  file: string,
  cacheBust?: number,
  timeoutMs = GENERATED_IMPORT_TIMEOUT_MS,
): Promise<OpenRecord> {
  const url = Bun.pathToFileURL(file).href + (cacheBust === undefined ? "" : `?probe=${cacheBust}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      /* SAFETY: a module namespace is a string-keyed object and every export this file reads off it is checked before use. */ import(
        url
      ) as Promise<OpenRecord>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${file} did not finish loading within ${timeoutMs}ms — top-level code in the generated module never completed`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Starter assembly for scripted solver tests. The Pi Built runtime supplies its own per-case
 * generated-tool worker factory instead, so it never imports agent/tools.ts in the controller.
 */
export async function loadBuiltStarterFactory(slugDir: string): Promise<BuiltStarterFactory> {
  const file = join(slugDir, GENERATED_TOOLS_FILE);
  // Read the controller interface before importing generated code. Later changes to its source
  // files cannot change these already-read selections, resources and guide contents
  // (external-verifier-008 hostile review).
  const contract = await loadBuiltControllerInterface(slugDir);
  const mod = await importGenerated(file);
  if (!isFunction(mod.createDomainHarness)) {
    throw new Error(
      `${file} does not export createDomainHarness(task) — the generated Built Harness contract`,
    );
  }
  const generated =
    /* SAFETY: the check above returned when `!isFunction(mod.createDomainHarness)`. */ mod.createDomainHarness as DomainHarnessFactory;
  return (task, submission, publicArtifactSchema) => {
    const draftToolFactories = contract.presets.includes("files")
      ? [
          (draft: Parameters<typeof createDraftFileTools>[0]) =>
            createDraftFileTools(draft, publicArtifactSchema),
        ]
      : [];
    return createBuiltStarter(task, generated, submission, {
      controllerTools: contract.controllerTools(task),
      draftToolFactories,
      domainToolAuthorities: contract.domainToolAuthorities,
      publicArtifactSchema,
      publishedMargins: contract.publishedMargins,
    });
  };
}

/**
 * Load probe for a generated correctness model before adoption, so a broken import is a finding
 * the Builder can repair in the same session rather than a runtime failure during measurement.
 * Typechecking runs first; only a type-correct module is loaded, in a fresh confined process. The
 * bundle cache is keyed by content bytes, so an edited evaluator or helper never reuses a bundle.
 */
export async function probeGeneratedCorrectnessModelModule(
  slugDir: string,
  importTimeoutMs?: number,
  verifierLifetime?: VerifierLifetime,
): Promise<ContractFinding[]> {
  if (!existsSync(join(slugDir, REFERENCE_SOLVE_ENTRY))) {
    return controllerValidatedFindings([
      {
        code: "reference-solve-entry-missing",
        path: REFERENCE_SOLVE_ENTRY,
        detail: REFERENCE_SOLVE_MIGRATION,
      },
    ]);
  }
  const typeFindings = typecheckGeneratedModule(slugDir, "correctness-model");
  if (typeFindings.length > 0) return typeFindings;
  try {
    const value: unknown = nativeParse(readFileSync(join(slugDir, BRIEF_FILE), "utf8"));
    const validation = validateBrief(value);
    if (!validation.ok) return validation.findings;
    // SAFETY: the brief validator has admitted this exact parsed value.
    const brief = value as Brief;
    await bundleReferenceSolve(slugDir);
    const missing = await probeEvaluatorProcess(
      slugDir,
      brief.truthChecks.map((check) => check.id),
      importTimeoutMs,
      verifierLifetime,
    );
    if (missing.length > 0) {
      return controllerValidatedFindings([
        {
          code: "generated-module-contract",
          path: EVALUATOR_FILE,
          detail: `${EVALUATOR_FILE} loads but does not export ${missing.join(", ")} as function(s)`,
        },
      ]);
    }
    return [];
  } catch (error) {
    if (evaluatorEnvironmentStop(error)) throw error;
    const message = errorMessage(error);
    // The load message is public authoring detail; the classification alone does not locate the fault.
    return [
      loadFailureFinding(
        {
          code: "generated-module-load",
          path: EVALUATOR_FILE,
          detail: `${EVALUATOR_FILE} failed to load: ${message}`,
        },
        "generated-correctness-model-load",
      ),
    ];
  }
}

/**
 * Resolve current bundle bytes; every evaluation starts a fresh process.
 *
 * `spend` sees the check id and wall time of each dispatch, including one that threw or reached
 * its wall, because this closure is the only place a single check's own cost is observable: the
 * caller receives one aggregate verdict and the author sees neither. A check id is a public
 * authoring identity and the duration is the candidate's own evaluator running, so an aggregate
 * over a whole corpus may cross to its author.
 */
export async function loadCorrectnessModel(
  slugDir: string,
  verifierLifetime?: VerifierLifetime,
  signal?: AbortSignal,
  spend?: (checkId: string, ms: number) => void,
): Promise<CheckRunner> {
  const bundle = await bundleEvaluator(slugDir);
  const { checkWallMs } = harnessSettings(slugDir);
  return async (checkId, request, runtime) => {
    const startedAt = Date.now();
    try {
      return await evaluateIsolated(bundle, checkId, request, {
        runtime,
        timeoutMs: checkWallMs,
        lifetime: verifierLifetime,
        signal,
      });
    } finally {
      spend?.(checkId, Date.now() - startedAt);
    }
  };
}
