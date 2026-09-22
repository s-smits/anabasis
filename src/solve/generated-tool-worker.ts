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

/** One side of the binding comparison, recorded so a refusal names the field that moved. */
interface WorkerBindingSide {
  probePolicy: string;
  publicArtifactSchemaHash: string;
  worker: GeneratedToolWorkerBinding | null;
}

export interface GeneratedToolStarterOptions {
  slugDir: string;
  task: PublicTask<unknown>;
  submission: SubmissionPort;
  /** The controller's whole reading of the bundle, passed as one value so the confined worker
   *  receives every field the in-process starter does. */
  contract: BuiltControllerInterface;
  publicArtifactSchema: PublicArtifactSchema;
  workerSupport?: OsIsolationSupport;
  /** The session isolation; without it the shell stays registered but refuses every command. */
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
 * Checks this starter against the build-time identity before the model runs, so a mismatch costs
 * no model turn. A missing receipt (a pre-adoption battery) refuses nothing, and a starter that
 * failed to prepare keeps its own typed non-result.
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
 * The harness's own tools, which alone enter the binding digest; controller, preset and starter
 * tools belong to the controller's source revision. Filtering by the parent's declared names, not
 * child-reported owners, stops generated code relabelling a tool out of the binding.
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
      // The child has no submission port, so the attempt bound is restated here.
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

/** Opens the child with its one start frame. */
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
 * Writes the task and its public resources into the session home, so a driver can read them from
 * files. Both are already in the model's context, so nothing new crosses the wall. Returns the
 * number of resource files written.
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
    // One flat name per resource; a collision gets a numeric suffix rather than overwriting.
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
  // The ready promise may have no caller yet; observe its rejection before close settles it.
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
    // Opened after the worker exists and inside this cleanup scope, so a failure closes the worker.
    // The home lasts the session, so a toolchain one command installs survives to the next.
    if (options.contract.presets.some((preset) => preset === "files" || preset === "shell")) {
      mkdirSync(BUILT_COMMAND_SCRATCH_ROOT, { recursive: true, mode: 0o700 });
      home = mkdtempSync(join(BUILT_COMMAND_SCRATCH_ROOT, "home-"));
    }
    const ready = await client.ready;
    // The shell needs the ready client. The preset decides the tool contract; the isolation decides
    // whether a command may run, so a missing isolation refuses commands without shrinking the roster.
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
