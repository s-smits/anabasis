/**
 * Assembles one Built starter over the confined generated-tool process. The child owns the
 * DraftStore and generated callbacks; the controller keeps the only submission authority.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { sha256 } from "../meta/digest.ts";
import { sameJsonValue, canonicalJsonCopy as trustedJson } from "../meta/stable-json.ts";
import { controllerToolAuthority } from "../truth/built-presets.ts";
import type { PublicTask } from "../truth/task-split.ts";
import type { OsIsolationSupport } from "../verify/os-isolation.ts";
import type { SolveIsolationPolicy } from "../verify/solve-sandbox.ts";
import { createBuiltBashTool } from "./built-bash.ts";
import { harnessConfigIssue, harnessSettings } from "../truth/harness-config.ts";
import { type PublicBriefResource, readPublicResources } from "../truth/public-resources.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import { BUILT_COMMAND_SCRATCH_ROOT } from "../verify/solve-command-isolation.ts";
import {
  type BuiltStarter,
  type DomainToolAuthority,
  type GeneratedToolWorkerCondition,
  type GeneratedToolWorkerEvidence,
  starterRegistration,
  submitMaterializedArtifact,
  submitToolDescription,
} from "./built-starter.ts";
import type { BuiltControllerInterface } from "../truth/contracts.ts";
import { CONFORMANCE_PROBE_POLICY, type ConformanceEvidence } from "../claim/conformance-evidence.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { fileArtifactRoot, fileArtifactRootIssue } from "./draft-files.ts";
import { fileMapDigest } from "./draft-store.ts";
import type { SubmissionPort } from "./final-submission.ts";
import {
  type WorkerBundle,
  WorkerClient,
  type WorkerReady,
  bundleGeneratedWorker,
} from "./generated-tool-worker-process.ts";
import {
  GENERATED_TOOL_PROTOCOL,
  GeneratedToolWorkerNonResult,
  generatedToolInterface,
} from "./generated-tool-worker-protocol.ts";
import type { PublicArtifactSchema } from "./public-artifact-schema.ts";
import { runtimeProcess } from "../meta/process.ts";
import { GENERATED_TOOLS_FILE } from "../meta/bundle-layout.ts";

export { GeneratedToolWorkerNonResult } from "./generated-tool-worker-protocol.ts";

export interface GeneratedToolWorkerBinding {
  schema: "generated-tool-worker/v3";
  generatedSourceDigest: string;
  workerPolicyIdentity: string;
  registrationDigest: string;
  toolSchemaDigest: string;
  artifactWriterNames: string[];
}

export const WORKER_BINDING_MISMATCH =
  "production generated-tool worker differs from the build-time conformance binding";

/** One side of the binding comparison, written as refusal evidence so the case row names the field that moved. */
interface WorkerBindingSide {
  probePolicy: string;
  publicArtifactSchemaHash: string;
  worker: GeneratedToolWorkerBinding | null;
}

export interface GeneratedToolStarterOptions {
  slugDir: string;
  task: PublicTask<unknown>;
  submission: SubmissionPort;
  /** The controller's whole reading of the bundle: trusted tools, presets, declared domain tool
   *  authorities, operating guide and published limits. It arrives as one value because every
   *  caller had copied the same four fields out of it, and a fifth field added to that reading
   *  then reached the in-process starter while the confined worker silently kept solving without
   *  it (the published-margin review of 2026-09-17). */
  contract: BuiltControllerInterface;
  publicArtifactSchema: PublicArtifactSchema;
  workerSupport?: OsIsolationSupport;
  /** The session isolation this case runs under. The shell derives its command profile from it;
   *  without it the shell remains registered but refuses command execution. */
  sessionIsolation?: SolveIsolationPolicy;
  /** Conformance-only direct reads from task.publicInput. Production solve leaves this false. */
  traceTaskAccess?: boolean;
  /** The measuring run, carried for the shell's own safeguard; absent outside a resolved run. */
  safeguardContext?: SafeguardContext;
}
/** One shared projection for the build-time and production worker identity checks. */
export function generatedToolWorkerBinding(worker: GeneratedToolWorkerCondition): GeneratedToolWorkerBinding {
  return {
    schema: worker.schema,
    generatedSourceDigest: worker.sourceDigest,
    workerPolicyIdentity: worker.policyIdentity,
    registrationDigest: worker.registrationDigest,
    toolSchemaDigest: worker.toolSchemaDigest,
    artifactWriterNames: [...worker.artifactWriterNames],
  };
}

export function generatedToolWorkerMatches(
  binding: GeneratedToolWorkerBinding,
  worker: GeneratedToolWorkerCondition,
): boolean {
  return sameJsonValue(binding, generatedToolWorkerBinding(worker));
}

/**
 * Check this starter against the build-time identity before the model
 * runs. The check used to sit after the solve, so a stale receipt cost a whole paid battery: run
 * w16 (2026-08-14) completed 50 accepted submissions and discarded every one. The worker condition
 * is known as soon as the starter exists, so the refusal costs no model turn.
 *
 * A null/absent receipt is a pre-adoption battery and refuses nothing. A starter that already
 * failed to prepare keeps its own typed non-result — a sandbox or runtime failure is not a
 * binding mismatch.
 */
export function workerBindingRefusal(
  conformance: ConformanceEvidence | null | undefined,
  publicArtifactSchemaHash: string,
  starter: Pick<BuiltStarter, "generatedWorker" | "preparationNonResult">,
): { expected: WorkerBindingSide; observed: WorkerBindingSide } | null {
  if (conformance == null || starter.preparationNonResult !== undefined) return null;
  const expected: WorkerBindingSide = {
    probePolicy: conformance.probePolicy,
    publicArtifactSchemaHash: conformance.publicArtifactSchemaHash,
    worker: conformance.worker,
  };
  const observed: WorkerBindingSide = {
    probePolicy: CONFORMANCE_PROBE_POLICY,
    publicArtifactSchemaHash,
    worker:
      starter.generatedWorker === undefined ? null : generatedToolWorkerBinding(starter.generatedWorker),
  };
  return sameJsonValue(expected, observed) ? null : { expected, observed };
}

/**
 * The tools the harness itself supplies: the binding's subject, selected by the recorded
 * domain-tool declaration the parent already holds. Controller, preset and starter tools are the
 * controller's identity, recorded with the run's source revision. Including them in the
 * harness fingerprint made controller wording affect compatibility: commit 491de81c shortened one
 * controller label and every harness approved before it became unmeasurable, and on run w16 a
 * dependency update changed a preset-path schema with the same result. Filtering by the
 * parent's own declared names, not by child-reported owner rows, also means generated code cannot
 * relabel a tool's owner to pull its schema out of the binding.
 */
function declaredDomainTools(
  declared: readonly DomainToolAuthority[],
  tools: readonly AgentTool<never>[],
): AgentTool<never>[] {
  const domainNames = new Set(declared.map(({ name }) => name));
  return tools.filter(({ name }) => domainNames.has(name));
}

function nonResultStarter(error: GeneratedToolWorkerNonResult): BuiltStarter {
  return {
    tools: [],
    checkpoint: (turn) => ({
      schema: "built-starter-checkpoint/v2",
      turn,
      draftSeq: 0,
      draftDigest: sha256("generated-tool-worker-unavailable"),
      fileMapDigest: fileMapDigest({}),
      artifactWriterNames: [],
      materialization: { state: "absent" },
    }),
    materialization: () => {
      throw error;
    },
    registration: { schema: "built-starter-registration/v2", tools: [], artifactWriterNames: [] },
    preparationNonResult: error.nonResult(),
  };
}

function toolInterface(
  ready: WorkerReady,
  controllerTools: readonly AgentTool[],
  client: WorkerClient,
  submission: SubmissionPort,
) {
  const registration = starterRegistration([
    ...ready.registration.tools.filter(({ owner }) => owner === "domain"),
    ...controllerTools.map(({ name }) => ({
      name,
      owner: "controller" as const,
      authority: controllerToolAuthority(name),
    })),
    ...ready.registration.tools.filter(({ owner }) => owner !== "domain"),
  ]);
  const remote = new Map(ready.tools.map((tool) => [tool.name, tool]));
  const controller = new Map(
    controllerTools.map((tool) => [
      tool.name,
      /* SAFETY: the controller tools are in-process tools whose parameter shape the worker never inspects; `AgentTool<never>` is the roster's common type. */ tool as AgentTool<never>,
    ]),
  );
  const tools = registration.tools.map(({ name }) => {
    const host = controller.get(name);
    if (host) return host;
    const descriptor = remote.get(name);
    if (!descriptor) {
      throw new GeneratedToolWorkerNonResult(
        "protocol",
        `generated-tool worker omitted registered tool "${name}"`,
      );
    }
    const isSubmit = name === "submit";
    return {
      ...descriptor,
      parameters:
        /* SAFETY: `AgentTool<never>` types `parameters` as `never`, so a registered JSON Schema cannot be written under that annotation; the schema itself is unchanged. */ descriptor.parameters as never,
      // The child holds no submission port, so its submit descriptor carries the unbounded text.
      // This process holds the port, and restates the bound from its one owner in built-starter.
      description: isSubmit ? submitToolDescription(submission) : descriptor.description,
      execute: isSubmit
        ? async () => {
            const materialization = await client.materialization();
            return submitMaterializedArtifact(materialization, submission);
          }
        : async (callId: string, args: never) => await client.execute(callId, name, args),
    } satisfies AgentTool<never>;
  });
  return { registration, tools };
}

/** The single start frame a child is opened with: protocol and instance identity, the public task,
 *  the preset selection and the two paths used to probe denied access during startup. */
function startWorkerClient(
  options: GeneratedToolStarterOptions,
  bundle: WorkerBundle,
  workerInstanceId: string,
): WorkerClient {
  return new WorkerClient(
    bundle,
    {
      type: "start",
      protocol: GENERATED_TOOL_PROTOCOL,
      task: options.task,
      presets: [...options.contract.presets],
      domainToolAuthorities: [...options.contract.domainToolAuthorities],
      publishedMargins: [...options.contract.publishedMargins],
      publicArtifactSchema: options.publicArtifactSchema,
      workerInstanceId,
      bundleDigest: bundle.digest,
      deniedReadPath: join(options.slugDir, GENERATED_TOOLS_FILE),
      deniedWritePath: join(bundle.dir, `forbidden-write-${workerInstanceId}`),
      traceTaskAccess: options.traceTaskAccess ?? false,
    },
    options.workerSupport,
  );
}

/**
 * The task and its public resources, written into the session home as files.
 *
 * Both are already in the model's context — the task in its first turn, the resources through their
 * own reader — so this carries nothing new across the wall. It removes the step between having them
 * and computing over them: the shell's own text already advises "a driver you write once and re-run
 * there, reading its inputs from a file", and before this the solver had to retype the inputs into a
 * heredoc to create that file. Returns how many resource files were written, which is all the
 * description needs to name them.
 */
export function seedSessionHome(
  home: string,
  task: PublicTask<unknown>,
  resources: readonly PublicBriefResource[],
): number {
  const root = join(home, "public");
  mkdirSync(join(root, "resources"), { recursive: true });
  const view = { taskId: task.taskId, family: task.family, publicInput: task.publicInput };
  writeFileSync(join(root, "task.json"), `${capturedJsonStringify(view, null, 2)}\n`, "utf8");
  const used = new Set<string>();
  let written = 0;
  for (const resource of resources) {
    // One flat readable name per resource. A name that sanitises onto one already used keeps both
    // files rather than overwriting the earlier one silently.
    const base = resource.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "resource";
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    writeFileSync(
      join(root, "resources", `${name}.json`),
      `${capturedJsonStringify(resource, null, 2)}\n`,
      "utf8",
    );
    written++;
  }
  return written;
}

/** Remove the session home after completion or failure; null means none was opened. */
function discardSessionHome(home: string | null): void {
  if (home !== null) rmSync(home, { recursive: true, force: true });
}

async function closeFailedStarter(
  client: WorkerClient,
  home: string | null,
  error: unknown,
): Promise<BuiltStarter> {
  discardSessionHome(home);
  // A setup failure can close the client before its public ready promise has a caller. Observe
  // that rejection before close settles it, while preserving it for ordinary ready callers.
  void client.ready.catch(() => {});
  await client.close();
  if (error instanceof GeneratedToolWorkerNonResult) return nonResultStarter(error);
  throw error;
}

/** One worker process, store and starter for one case. */
export async function createGeneratedToolStarter(
  options: GeneratedToolStarterOptions,
): Promise<BuiltStarter> {
  // A files preset the schema cannot carry, or a defective agent/config.yaml, ends the case
  // before a worker starts.
  const issue =
    (options.contract.presets.includes("files")
      ? fileArtifactRootIssue(options.publicArtifactSchema)
      : null) ?? harnessConfigIssue(options.slugDir);
  if (issue !== null) return nonResultStarter(new GeneratedToolWorkerNonResult("protocol", issue));
  const settings = harnessSettings(options.slugDir);
  let bundle: WorkerBundle;
  try {
    bundle = await bundleGeneratedWorker(options.slugDir);
  } catch (error) {
    throw new Error(`generated tool worker bundle failed: ${errorMessage(error)}`, { cause: error });
  }
  const workerInstanceId = crypto.randomUUID();
  let client: WorkerClient;
  try {
    client = startWorkerClient(options, bundle, workerInstanceId);
  } catch (error) {
    if (error instanceof GeneratedToolWorkerNonResult) return nonResultStarter(error);
    throw error;
  }
  let home: string | null = null;
  try {
    // Opened after the worker exists, so a worker that never started leaves nothing behind. It stays
    // inside this cleanup scope because its own filesystem failure must close that existing worker.
    // The home belongs to the session rather than to one command: a toolchain one command installs
    // is what the next command compiles with, and the work tree beside it is deleted when a command
    // ends, so an install has nowhere else to survive.
    if (options.contract.presets.some((preset) => preset === "files" || preset === "shell")) {
      mkdirSync(BUILT_COMMAND_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
      home = mkdtempSync(join(BUILT_COMMAND_SCRATCH_ROOT, "home-"));
    }
    const ready = await client.ready;
    // The shell is assembled here rather than passed in: it needs the worker client, which only
    // exists once the child is ready. With the files preset it exchanges that preset's file map;
    // with `shell` it has no draft files to exchange. The preset decides the contract and the isolation decides
    // whether a command may run — a missing isolation refuses the command rather than quietly
    // registering a smaller tool contract than the one conformance certified.
    const shell =
      home === null
        ? []
        : [
            createBuiltBashTool({
              policy: options.sessionIsolation ?? null,
              port: options.contract.presets.includes("files")
                ? {
                    root: fileArtifactRoot(options.publicArtifactSchema),
                    files: () => client.files(),
                    applyFiles: (files) => client.applyFiles(files),
                  }
                : null,
              home,
              publicResourceFiles: seedSessionHome(home, options.task, readPublicResources(options.slugDir)),
              toolTree: bundleSnapshotToolTree(options.slugDir),
              timeouts: settings,
              ...keyIfDefined("safeguardContext", options.safeguardContext),
            }),
          ];
    const { registration, tools } = toolInterface(
      ready,
      [...options.contract.controllerTools(options.task), ...shell],
      client,
      options.submission,
    );
    const evidence = {
      schema: "generated-tool-worker/v3" as const,
      workerInstanceId,
      confinedPid: ready.pid,
      controllerPid: runtimeProcess.pid,
      sourceDigest: bundle.sourceDigest,
      policyIdentity: ready.policyIdentity,
      policyHash: ready.policyHash,
      bundleDigest: bundle.digest,
      registrationDigest: sha256(trustedJson(registration).bytes),
      toolSchemaDigest: sha256(
        trustedJson(
          declaredDomainTools(options.contract.domainToolAuthorities, tools).map(generatedToolInterface),
        ).bytes,
      ),
      artifactWriterNames: [...registration.artifactWriterNames],
      probe: ready.probe,
    };
    return {
      tools: Object.freeze(tools),
      registration,
      operatingGuide: options.contract.operatingGuide,
      settings,
      checkpoint: (turn) => client.checkpoint(turn),
      materialization: () => {
        throw new Error("a remote answer can be prepared only through submit");
      },
      generatedWorker: evidence,
      taskAccess: () => client.taskAccess(),
      close: async (): Promise<GeneratedToolWorkerEvidence> => {
        const termination = await client.close();
        discardSessionHome(home);
        return { ...evidence, termination };
      },
    };
  } catch (error) {
    return await closeFailedStarter(client, home, error);
  }
}
