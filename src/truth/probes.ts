/**
 * The two authoring-time probes the gate spends before a candidate is admitted: the control census,
 * which runs the declared checks over every task-bound accept and reject and joins the host's own
 * tool-run rows to them, and the conformance probe, which opens every task through every generated
 * tool and reconciles what the worker serves with agent/tools-spec.json.
 *
 * Neither of them decides correctness. They decide whether this candidate's own declared contract
 * holds, and every finding they return routes to one FeedbackOwner in the same session.
 */
import { type BuiltStarter, closeOneAtATime } from "../solve/built-starter.ts";
import { harnessSettings } from "./harness-config.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { evaluatorEnvironmentStop } from "./evaluator-process.ts";
import { CONFORMANCE_PROBE_POLICY } from "../claim/conformance-evidence.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { createSubmissionAuthority, submissionPortOf } from "../solve/final-submission.ts";
import {
  type GeneratedToolWorkerBinding,
  createGeneratedToolStarter,
  generatedToolWorkerBinding,
  generatedToolWorkerMatches,
} from "../solve/generated-tool-worker.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import { createVerifierHost } from "../verify/host.ts";
import { VerifierContractError } from "../../vendor/correctness-model-bundle/contract-error.ts";
import { type ToolInventory, type VerifierHostHandle } from "../verify/verifier-port.ts";
import { verifierEnvironmentHashOfTools } from "./verifier-environment.ts";
import { probeTaskInterpreters } from "./task-interpreter-probe.ts";
import { resolveToolInventory } from "../verify/tool-inventory.ts";
import {
  type CheckCost,
  type ToolCheckCoverage,
  type GroundingFinding,
  type SettledControl,
  checkCostRows,
  // Gate audit 2026-09-25 (docs/gate-audit.md, census-inert-tool): commented out (unsure): a declared tool the census never launched no longer refuses adoption; readiness still names it
  // inertToolFindings,
  rejectsBlockedBy,
  toolCheckCoverage,
  unexecutedGroundingFindings,
} from "./grounding-coverage.ts";
import {
  type Brief,
  externalChecksOf,
  type ContractFinding,
  controllerValidatedFinding,
  controllerValidatedFindings,
  generatedExecutionFinding,
} from "./brief.ts";
import { loadFailureFinding } from "./load-fault.ts";
import {
  servedToolSurfaces,
  terminationFindings,
  toolDescriptionParityFindings,
  workerBindingDriftFindings,
} from "./probe-tool-surface.ts";
import {
  type EvaluatorFn,
  loadBuiltControllerInterface,
  loadCorrectnessModel,
  probeGeneratedCorrectnessModelModule,
} from "./contracts.ts";
import type { ControlCorpus } from "./controls.ts";
import { boundedDraftSummary } from "./draft-summary.ts";
import { SUBMIT_MAX_ATTEMPTS, type ControlReceipt } from "./battery-record.ts";
import { runControls } from "./run-controls.ts";
import { timedOutControls } from "./control-receipts.ts";
import { discriminationDisclosure } from "./discrimination-author-detail.ts";
import { evaluateCheckProgram } from "./predicate.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { readPublicResources } from "./public-resources.ts";
import { commitPublicTask } from "./task-split.ts";
import type { BuildTask } from "./tasks.ts";
import { type ToolsSpec, expectedBuiltToolNames } from "./tools-spec.ts";
import { VerifierExecutionNonResult } from "./verifier-nonresult.ts";
import { BRIEF_FILE, CONTROLS_FILE, EVALUATOR_FILE, GENERATED_TOOLS_FILE } from "../meta/bundle-layout.ts";

export type ProbeControlsResult = {
  verifierEnvironmentHash?: string | null;
  executionEvidence?: import("../verify/verifier-port.ts").VerifierExecutionEvidence[];
  findings: ContractFinding[];
  advisory?: ContractFinding[]; // timed-out controls, read beside the verdict; refuses nothing
  controlReceipts?: ControlReceipt[];
  /** Host tool runs and rejects blocked per declared check, recorded with the census. */
  toolCheckCoverage?: ToolCheckCoverage[];
  /** What each check cost the census, dearest first. Absent when the census never ran a check. */
  checkCost?: CheckCost[];
};

export type ProbeControls = (
  slugDir: string,
  brief: Brief,
  corpus: ControlCorpus,
  tasks: readonly BuildTask[],
  /** True once the census wall has cut the probe. */
  stopped?: () => boolean,
) => Promise<ProbeControlsResult>;

export interface ProbeControlsOptions {
  verifierLifetime?: VerifierLifetime;
  createVerifier?: () => VerifierHostHandle;
}

interface ConformanceProbeResult {
  findings: ContractFinding[];
  worker: GeneratedToolWorkerBinding | null;
  probePolicy: typeof CONFORMANCE_PROBE_POLICY;
}

export function makeProbeControls(options: ProbeControlsOptions = {}): ProbeControls {
  return async (slugDir, brief, corpus, tasks, stopped) => {
    // The author cannot see what one of its checks costs: the gate returns one verdict. Summing
    // the dispatches here is what puts that bill in the same result the author already reads.
    const spend = new Map<string, { evaluations: number; totalMs: number }>();
    let evaluate: EvaluatorFn;
    let verifier: VerifierHostHandle | undefined;
    let externalChecks: ReturnType<typeof externalChecksOf>;
    // Resolved once: every entry hashes its executable, and the host and the identity read one map.
    let inventory: ToolInventory = {};
    try {
      // Typecheck before controls so type-erased API misuse becomes a repairable authoring finding.
      options.verifierLifetime?.assertUsable();
      const moduleFindings = await probeGeneratedCorrectnessModelModule(
        slugDir,
        undefined,
        options.verifierLifetime,
      );
      if (moduleFindings.length > 0) return { findings: moduleFindings };
      evaluate = evaluateCheckProgram(
        brief,
        await loadCorrectnessModel(slugDir, options.verifierLifetime, undefined, (checkId, ms) => {
          const row = spend.get(checkId);
          spend.set(checkId, { evaluations: (row?.evaluations ?? 0) + 1, totalMs: (row?.totalMs ?? 0) + ms });
        }),
      );
    } catch (error) {
      if (evaluatorEnvironmentStop(error)) throw error;
      const message = errorMessage(error);
      return {
        findings: [
          loadFailureFinding(
            { code: "generated-module-load", path: EVALUATOR_FILE, detail: message },
            "generated-correctness-model-load",
          ),
        ],
      };
    }
    try {
      externalChecks = externalChecksOf(brief);
      if (externalChecks.length > 0) {
        // Resolve as measurement does; refuse a lost tool before spending controls on non-results.
        const toolTree = bundleSnapshotToolTree(slugDir);
        const resolved = resolveToolInventory({
          toolIds: externalChecks.map((check) => check.adapterId),
          toolTree,
        });
        inventory = resolved.inventory;
        const unresolved = [...resolved.missing, ...resolved.invalid];
        if (options.createVerifier === undefined && unresolved.length > 0) {
          return {
            findings: [
              controllerValidatedFinding({
                code: "census-tool-missing",
                path: BRIEF_FILE,
                detail: `external-verifier tool(s) ${unresolved.map((id) => `"${id}"`).join(", ")} resolve to no executable under the workspace .toolchain or on the host PATH`,
              }),
            ],
          };
        }
        verifier = (
          options.createVerifier ??
          (() =>
            createVerifierHost({
              inventory,
              toolTree,
              toolRunMs: harnessSettings(slugDir).toolRunMs,
              ...keyIfDefined("lifetime", options.verifierLifetime),
            }))
        )();
      }
      // Controls bind taskId against the caller-supplied census tasks.
      const settled = new Map<string, SettledControl>();
      const execution = await runControls(
        evaluate,
        corpus,
        tasks,
        {
          onSettled: (controlId, observation) => settled.set(controlId, observation),
          brief,
          ...keyIfDefined("verifierLifetime", options.verifierLifetime),
          ...keyIfDefined("stopped", stopped),
        },
        verifier,
      );
      let findings: ContractFinding[] = execution.findings.map((finding) => ({
        code: finding.code,
        path: CONTROLS_FILE,
        detail: finding.message,
        disclosure: discriminationDisclosure(finding),
        ...keyIfDefined("subject", finding.subject),
      }));
      const hostEvidence = verifier?.evidence() ?? [];
      // Record, per declared check, how often the host ran its tool during the census.
      const coverage = toolCheckCoverage({
        externalChecks,
        evidence: hostEvidence,
        rejects: (checkId) => rejectsBlockedBy(execution.controlReceipts, checkId),
      });
      // A throw skips the check's later tool calls, so its declared tools read as never launched.
      if (!execution.controlReceipts.some((receipt) => receipt.nonResultKind === "verifier-throw")) {
        findings = withGroundingFindings(
          findings,
          unexecutedGroundingFindings({
            brief,
            tasks,
            controls: [...corpus.accept, ...corpus.reject],
            settled,
            externalChecks,
            evidence: hostEvidence,
            path: EVALUATOR_FILE,
          }),
          // Gate audit 2026-09-25 (docs/gate-audit.md, census-inert-tool): commented out (unsure): a declared tool the census never launched no longer refuses adoption; readiness still names it
          // inertToolFindings(coverage),
          [...settled].flatMap(([id, row]) => (row.hostNonResult === null ? [] : [id])),
        );
      }
      return {
        findings,
        advisory: timedOutControls(settled, hostEvidence, EVALUATOR_FILE),
        controlReceipts: execution.controlReceipts,
        toolCheckCoverage: coverage,
        checkCost: checkCostRows(spend, hostEvidence),
        executionEvidence: hostEvidence,
        // The declared tool set as resolved above, which is the identity submit hashed: `externalChecksOf`
        // lists every required tool of every check. Hashing only the tools some control happened to
        // run refused every candidate whose controls left one declared tool unrun.
        verifierEnvironmentHash: verifierEnvironmentHashOfTools(inventory),
      };
    } catch (error) {
      if (error instanceof VerifierExecutionNonResult || error instanceof VerifierOperationalStop) {
        throw error;
      }
      const message = errorMessage(error);
      const stack = error instanceof Error ? (error.stack ?? "") : "";
      const stackHead = stack === "" ? "" : ` | ${stack.split("\n").slice(1, 3).join(" ")}`;
      return {
        findings: [
          generatedExecutionFinding(
            {
              code: "generated-correctness-model-throws",
              path: EVALUATOR_FILE,
              detail: `evaluate() threw while verification controls: ${message}${stackHead}`,
            },
            error instanceof VerifierContractError ? error.code : "generated-evaluate-throw",
          ),
        ],
      };
    }
  };
}

/** The grounding rows name the tool and check of an external non-result, so the discrimination
 *  no-verdict row repeats them when they cover every example that reached no verdict. An example
 *  no grounding row names — an authored check's own tool run, say — keeps the no-verdict row, or
 *  the claim would close on a subject nothing reports. */
export function withGroundingFindings(
  findings: ContractFinding[],
  grounding: GroundingFinding[],
  // Gate audit 2026-09-25 (docs/gate-audit.md, census-inert-tool): commented out (unsure): the census no longer joins a never-launched tool's row (`...inert`) to the grounding rows below
  // inert: ContractFinding[],
  noVerdictIds: readonly string[],
): ContractFinding[] {
  const covered = new Set(grounding.flatMap((row) => row.controlIds));
  const repeated = noVerdictIds.length > 0 && noVerdictIds.every((id) => covered.has(id));
  const kept = repeated
    ? findings.filter((finding) => finding.code !== "DISCRIMINATION_PROBE_NO_VERDICT")
    : findings;
  return [
    ...kept,
    ...controllerValidatedFindings(grounding.map(({ code, path, detail }) => ({ code, path, detail }))),
  ];
}

function loadFailureResult(code: string, detail: string): ConformanceProbeResult {
  return {
    findings: [loadFailureFinding({ code, path: GENERATED_TOOLS_FILE, detail }, "generated-toolset-load")],
    worker: null,
    probePolicy: CONFORMANCE_PROBE_POLICY,
  };
}

/** Submit must refuse an empty draft: it may not accept while loading, nor on the probe's own
 *  argument-less call before any writer ran. */
async function submitProbeFindings(
  tools: BuiltStarter["tools"],
  probeAuthority: ReturnType<typeof createSubmissionAuthority>,
): Promise<ContractFinding[]> {
  if (probeAuthority.finalSubmission()?.accepted === true) {
    return [
      {
        code: "vacuous-submitted",
        path: GENERATED_TOOLS_FILE,
        detail:
          "the harness submitted an answer while it was loading, before any tool ran; submit only after the agent creates the artifact",
      },
    ];
  }
  const submitTool = tools.find((tool) => tool.name === "submit");
  if (!submitTool?.execute) return [];
  await submitTool
    .execute(
      "conformance-probe",
      /* SAFETY: `submit` takes no arguments; `never` is the roster's parameter type, not a claim about this value. */ {} as never,
    )
    .catch(() => undefined);
  const submitFact = probeAuthority.finalSubmission();
  if (submitFact?.accepted === true) {
    const summary = boundedDraftSummary(submitFact.artifactJson);
    return [
      controllerValidatedFinding({
        code: "empty-green-submit",
        path: GENERATED_TOOLS_FILE,
        detail: `submit accepted a draft before any writer ran. It must reject an empty draft until the agent creates the artifact (sha256=${submitFact.artifactDigest ?? "unknown"}, shape=${summary})`,
      }),
    ];
  }
  if (submitFact?.rejection?.code === "artifact-public-schema") {
    return [
      controllerValidatedFinding({
        code: "submit-public-schema-rejected",
        path: GENERATED_TOOLS_FILE,
        detail: submitFact.rejection.safeRemedy,
      }),
    ];
  }
  return [];
}

export async function probeConformanceWithEvidence(
  slugDir: string,
  spec: ToolsSpec,
  tasks: readonly BuildTask[],
  publicArtifactSchema: PublicArtifactSchema,
): Promise<ConformanceProbeResult> {
  const sampleTask = tasks[0];
  if (sampleTask === undefined) throw new Error("conformance probe requires at least one task");
  let controllerInterface: Awaited<ReturnType<typeof loadBuiltControllerInterface>>;
  try {
    controllerInterface = await loadBuiltControllerInterface(slugDir);
  } catch (error) {
    const message = errorMessage(error);
    return loadFailureResult("generated-module-load", message);
  }
  const findings: ContractFinding[] = [];
  let worker: GeneratedToolWorkerBinding | null = null;
  let baselineSurfaces: Map<string, string> | null = null;
  const opened: BuiltStarter[] = [];
  const openStarter = async (
    task: BuildTask,
    submission: ReturnType<typeof submissionPortOf>,
    traceTaskAccess = false,
  ) => {
    const committed = commitPublicTask(task);
    const created = await createGeneratedToolStarter({
      slugDir,
      task: committed.view(),
      submission,
      contract: controllerInterface,
      publicArtifactSchema,
      traceTaskAccess,
    });
    opened.push(created);
    if (created.generatedWorker !== undefined) {
      const surfaces = servedToolSurfaces(spec, created.tools);
      if (worker === null) {
        worker = generatedToolWorkerBinding(created.generatedWorker);
        baselineSurfaces = surfaces;
      } else if (!generatedToolWorkerMatches(worker, created.generatedWorker)) {
        findings.push(...workerBindingDriftFindings(task.family, baselineSurfaces, surfaces));
      }
    }
    return created;
  };
  try {
    const probeAuthority = createSubmissionAuthority({
      maxAttempts: SUBMIT_MAX_ATTEMPTS,
      publicArtifactSchema,
    });
    const toolset = await openStarter(sampleTask, submissionPortOf(probeAuthority));
    if (toolset.preparationNonResult !== undefined) {
      return loadFailureResult(
        toolset.preparationNonResult.kind === "sandbox"
          ? "probe-confinement-unavailable"
          : "generated-module-load",
        toolset.preparationNonResult.message,
      );
    }
    const specNames = expectedBuiltToolNames(spec, {
      // Use the same availability check as the tool loader above.
      publicResources: readPublicResources(slugDir).length > 0,
    });
    const builtNames = toolset.tools.map((tool) => tool.name);
    builtNames.sort();
    const contractMismatch =
      specNames.length !== builtNames.length || specNames.some((name, index) => name !== builtNames[index]);
    if (contractMismatch) {
      findings.push(
        controllerValidatedFinding({
          code: "tools-contract-mismatch",
          path: GENERATED_TOOLS_FILE,
          detail: `generated tools [${builtNames.join(", ")}] do not match tools-spec.json [${specNames.join(", ")}]`,
        }),
      );
    }
    findings.push(...toolDescriptionParityFindings(spec, toolset.tools));
    findings.push(...(await submitProbeFindings(toolset.tools, probeAuthority)));
    findings.push(
      ...(await probeTaskInterpreters(
        (task) =>
          openStarter(
            task,
            submissionPortOf(
              createSubmissionAuthority({ maxAttempts: SUBMIT_MAX_ATTEMPTS, publicArtifactSchema }),
            ),
            true,
          ),
        spec,
        tasks,
      )),
    );
  } catch (error) {
    const message = errorMessage(error);
    findings.push(
      controllerValidatedFinding({
        code: "generated-toolset-throws",
        path: GENERATED_TOOLS_FILE,
        detail: `createDomainHarness failed during the public tool check: ${message}`,
      }),
    );
  } finally {
    findings.push(...terminationFindings(await closeOneAtATime(opened)));
  }
  return { findings, worker: findings.length === 0 ? worker : null, probePolicy: CONFORMANCE_PROBE_POLICY };
}
