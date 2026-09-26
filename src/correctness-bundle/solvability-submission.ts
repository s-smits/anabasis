/** Execute an F2 reference artifact through the production Built Harness submission path. */
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Value } from "typebox/value";
import type {
  SolvabilityFailure,
  SolvabilityNonResult,
  SolvabilitySubmissionPathEvidence,
} from "../claim/readiness.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import type {
  BuiltStarter,
  BuiltStarterCheckpoint,
  BuiltStarterNonResult,
  GeneratedToolWorkerEvidence,
} from "../solve/built-starter.ts";
import { fileArtifactRoot } from "../solve/draft-files.ts";
import {
  type FinalSubmission,
  createSubmissionAuthority,
  submissionPortOf,
} from "../solve/final-submission.ts";
import {
  type GeneratedToolStarterOptions,
  createGeneratedToolStarter,
} from "../solve/generated-tool-worker.ts";
import type { PublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import type { Brief, GeneratedExecutionClassification } from "./brief.ts";
import { loadBuiltControllerInterface } from "./contracts.ts";
import { referenceArtifactSchemaError } from "./solvability-artifact-schema.ts";
import type { PublicTask } from "./task-split.ts";
import { isFunction, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";

type SolvabilitySubmissionResult =
  | {
      status: "accepted";
      artifactJson: string;
      evidence: SolvabilitySubmissionPathEvidence;
    }
  | { status: "representation-defect"; detail: string }
  | { status: "non-result"; detail: string };
type SolvabilitySubmissionPathFailure = Exclude<SolvabilitySubmissionResult, { status: "accepted" }>;

/** Who a failed attempt belongs to before its answer is checked: a failure the candidate owns, a
 *  host that stopped it, or `null` while nothing has gone wrong or the checks alone will decide. */
export type SolvabilityAttribution =
  | { failure: SolvabilityFailure }
  | { nonResultKind: SolvabilityNonResult };

/** One reference artifact's submission result, before any truth verdict exists. A failed outcome
 *  already carries its whole attribution — kind and the author-visible classification — so a
 *  reader never has to infer who owns the failure from the message text. */
export interface SolvabilitySubmissionOutcome {
  artifactJson: string | null;
  submissionPath: SolvabilitySubmissionPathEvidence | null;
  error: string | null;
  authorClassification: GeneratedExecutionClassification | null;
  attribution: SolvabilityAttribution | null;
}

/** The attribution an attempt carries until something goes wrong. */
export const UNATTRIBUTED: SolvabilitySubmissionOutcome = {
  artifactJson: null,
  submissionPath: null,
  error: null,
  authorClassification: null,
  attribution: null,
};

interface SolvabilitySubmissionRequest {
  slugDir: string;
  task: PublicTask<unknown>;
  artifactSchema: Brief["artifactSchema"];
  publicArtifactSchema: PublicArtifactSchema | null;
  artifact: unknown;
  /** Test override for hosts that cannot nest the production OS wall. Production omits it. */
  createStarter?: (options: GeneratedToolStarterOptions) => Promise<BuiltStarter>;
}
/** The request once the public schema is known to exist and the artifact to be an object. */
type Traversal = Omit<SolvabilitySubmissionRequest, "publicArtifactSchema" | "artifact"> & {
  publicArtifactSchema: PublicArtifactSchema;
  artifact: Record<string, JsonValue>;
};
type ControllerInterface = Awaited<ReturnType<typeof loadBuiltControllerInterface>>;
type OpenedStarter = {
  authority: ReturnType<typeof createSubmissionAuthority>;
  starter: BuiltStarter;
};
type StarterOpener = () => Promise<OpenedStarter>;

function refusal(
  error: string,
  authorClassification: GeneratedExecutionClassification,
  attribution: SolvabilityAttribution | null = null,
  artifactJson: string | null = null,
): SolvabilitySubmissionOutcome {
  return {
    ...UNATTRIBUTED,
    attribution,
    error,
    authorClassification,
    artifactJson,
  };
}

function schemaAccepts(tool: AgentTool<never>, artifact: Record<string, JsonValue>): boolean {
  try {
    return Value.Check(tool.parameters, artifact);
  } catch {
    return false;
  }
}

/** The declared domain artifact-writers whose own parameter schema accepts this artifact. A writer
 *  whose schema refuses the payload can never carry F2. */
function acceptingWriters(starter: BuiltStarter, artifact: Record<string, JsonValue>): AgentTool<never>[] {
  return starter.registration.tools
    .filter(({ owner, authority }) => owner === "domain" && authority === "artifact-writer")
    .map(({ name }) => starter.tools.find((tool) => tool.name === name))
    .filter((tool): tool is AgentTool<never> => tool !== undefined && schemaAccepts(tool, artifact));
}

/**
 * Attribute a worker failure. A child that answered its ready handshake had already installed its
 * isolation before generated code loaded, so a `runtime` or `protocol` failure after that point
 * belongs to the generated factory, its registration or its execution — a product defect, not a host
 * outage. `sandbox` remains an environment failure.
 *
 * A controller deadline is the exception whatever kind it carries, because the clock says only that
 * the child did not answer in time and never that its bytes are wrong. Read as a representation
 * defect, a worker that missed its ready handshake or its close deadline sends the Builder off to
 * repair a writer that passes every task before and after. Those deadlines return an operational
 * non-result instead.
 */
function startedWorkerFailure(failure: BuiltStarterNonResult): SolvabilitySubmissionPathFailure {
  const detail = failure.message;
  if (failure.deadline === true) return { status: "non-result", detail };
  return failure.kind === "protocol" || failure.kind === "runtime"
    ? { status: "representation-defect", detail }
    : { status: "non-result", detail };
}

/** A close-handshake timeout after an accepted submit is cleanup: the host already holds the
 *  bytes, as a battery case does. Every other close failure keeps its type. */
async function closeFailure(
  starter: BuiltStarter,
  accepted = false,
): Promise<SolvabilitySubmissionPathFailure | null> {
  let evidence: GeneratedToolWorkerEvidence | undefined;
  try {
    evidence = await starter.close?.();
  } catch (error) {
    return { status: "non-result", detail: `submission worker close failed: ${errorMessage(error)}` };
  }
  if (evidence === undefined || evidence.termination.status === "normal") return null;
  if (accepted && evidence.termination.closeHandshakeTimeout === true) return null;
  return startedWorkerFailure(evidence.termination);
}

function pathEvidence(
  checkpoint: BuiltStarterCheckpoint,
  writerCalls: Array<{ name: string; callId: string }>,
  final: FinalSubmission,
): SolvabilitySubmissionPathEvidence {
  if (checkpoint.materialization.state !== "current") {
    throw new Error("writer calls did not leave a current DraftStore materialisation");
  }
  if (!final.accepted || final.kind !== "artifact" || final.artifactDigest === null) {
    throw new Error(`submit refused the writer materialisation as ${final.rejection?.code ?? "unaccepted"}`);
  }
  const { record } = checkpoint.materialization;
  if (record.artifactDigest !== final.artifactDigest) {
    throw new Error("submit accepted bytes other than the current DraftStore materialisation");
  }
  return {
    schema: "solvability-submission-path/v1",
    stages: ["writer-tool-schema", "draft-store", "materialise", "submit", "accept"],
    writerCalls,
    draftSeq: checkpoint.draftSeq,
    materialization: {
      writerName: record.writerName,
      callId: record.callId,
      sourceSeq: record.sourceSeq,
      artifactDigest: record.artifactDigest,
    },
    submission: {
      attempts: final.attempts,
      publicArtifactSchemaHash: final.publicArtifactSchemaHash,
      artifactDigest: final.artifactDigest,
    },
  };
}

async function executePath(
  starter: BuiltStarter,
  authority: ReturnType<typeof createSubmissionAuthority>,
  artifact: Record<string, JsonValue>,
  calls: Array<{ tool: AgentTool<never>; name: string; callId: string; args: Record<string, JsonValue> }>,
): Promise<SolvabilitySubmissionResult> {
  let outcome: SolvabilitySubmissionResult;
  try {
    const writerCalls: Array<{ name: string; callId: string }> = [];
    for (const call of calls) {
      if (!isFunction(call.tool.execute)) {
        throw new Error(`registered writer "${call.name}" has no executable implementation`);
      }
      await call.tool.execute(
        call.callId,
        /* SAFETY: a generated writer tool is held as AgentTool<never> because the controller does not model its parameter schema; the arguments are the recorded trace's own call payload. */ call.args as never,
      );
      writerCalls.push({ name: call.name, callId: call.callId });
    }
    const checkpoint = starter.checkpoint(1);
    const submit = starter.tools.find((tool) => tool.name === "submit");
    if (!isFunction(submit?.execute)) throw new Error("the inherited submit tool is absent");
    await submit.execute(
      "f2-submit",
      /* SAFETY: the inherited submit tool takes no argument; `never` is the controller-side parameter type for a schema it does not model. */ {} as never,
    );
    const final = authority.finalSubmission();
    if (final === null) throw new Error("submit produced no accepted artifact bytes");
    if (final.artifactJson === null) throw new Error("submit produced no accepted artifact bytes");
    const accepted = capturedJsonParse(final.artifactJson);
    if (!sameJsonValue(artifact, accepted)) {
      throw new Error("the writer cannot materialise the reference artifact without changing its value");
    }
    outcome = {
      status: "accepted",
      artifactJson: final.artifactJson,
      evidence: pathEvidence(checkpoint, writerCalls, final),
    };
  } catch (error) {
    outcome = { status: "representation-defect", detail: errorMessage(error) };
  }
  return (await closeFailure(starter, outcome.status === "accepted")) ?? outcome;
}

function fileCalls(
  starter: BuiltStarter,
  schema: PublicArtifactSchema,
  artifact: Record<string, JsonValue>,
): Array<{ tool: AgentTool<never>; name: string; callId: string; args: Record<string, JsonValue> }> {
  const root = fileArtifactRoot(schema);
  const files = artifact[root];
  if (!isRecord(files) || Object.values(files).some((value) => !isString(value))) {
    throw new Error(`the files preset cannot express the reference artifact root "${root}"`);
  }
  const write = starter.tools.find((tool) => tool.name === "write");
  const materialise = starter.tools.find((tool) => tool.name === "materialize_files");
  if (write === undefined || materialise === undefined) {
    throw new Error("the files preset omitted write or materialize_files");
  }
  return [
    ...Object.entries(files)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, content], index) => ({
        tool: write,
        name: "write",
        callId: `f2-write-${String(index + 1)}`,
        args: { path, content },
      })),
    {
      tool: materialise,
      name: "materialize_files",
      callId: "f2-materialise-files",
      args: {},
    },
  ];
}

function createStarterOpener(options: Traversal, controller: ControllerInterface): StarterOpener {
  return async () => {
    const authority = createSubmissionAuthority({
      maxAttempts: 1,
      publicArtifactSchema: options.publicArtifactSchema,
    });
    const starter = await (options.createStarter ?? createGeneratedToolStarter)({
      slugDir: options.slugDir,
      task: options.task,
      submission: submissionPortOf(authority),
      contract: controller,
      publicArtifactSchema: options.publicArtifactSchema,
    });
    return { authority, starter };
  };
}

async function openReadyStarter(
  openStarter: StarterOpener,
): Promise<OpenedStarter | SolvabilitySubmissionPathFailure> {
  let opened: OpenedStarter;
  try {
    opened = await openStarter();
  } catch (error) {
    return { status: "representation-defect", detail: errorMessage(error) };
  }
  const unavailable = opened.starter.preparationNonResult;
  if (unavailable === undefined) return opened;
  return (await closeFailure(opened.starter)) ?? startedWorkerFailure(unavailable);
}

async function structuredWriterPath(
  first: OpenedStarter,
  artifact: Record<string, JsonValue>,
  openStarter: StarterOpener,
): Promise<SolvabilitySubmissionResult> {
  let opened = first;
  const candidateNames = acceptingWriters(opened.starter, artifact).map(({ name }) => name);
  if (candidateNames.length === 0) {
    return (
      (await closeFailure(opened.starter)) ?? {
        status: "representation-defect",
        detail: "no declared artifact-writer parameter schema accepts the reference artifact roots",
      }
    );
  }
  let last: SolvabilitySubmissionResult = {
    status: "representation-defect",
    detail: "no artifact-writer materialised the reference artifact",
  };
  for (const [index, candidateName] of candidateNames.entries()) {
    if (index > 0) {
      const reopened = await openReadyStarter(openStarter);
      if ("status" in reopened) return reopened;
      opened = reopened;
    }
    const candidate = opened.starter.tools.find((tool) => tool.name === candidateName);
    if (candidate === undefined) {
      const closed = await closeFailure(opened.starter);
      if (closed !== null) return closed;
      last = {
        status: "representation-defect",
        detail: `artifact-writer "${candidateName}" disappeared from a fresh starter`,
      };
      continue;
    }
    last = await executePath(opened.starter, opened.authority, artifact, [
      { tool: candidate, name: candidate.name, callId: `f2-writer-${String(index + 1)}`, args: artifact },
    ]);
    if (last.status === "accepted" || last.status === "non-result") return last;
  }
  return last;
}

/** Only the public JSON artifact enters this confined worker from the isolated reference solver.
 *  Verifier results, hidden task data and repair details do not cross, which is what keeps an F2 run
 *  from becoming a channel that carries protected detail back to the author. */
async function traverseReferenceArtifact(options: Traversal): Promise<SolvabilitySubmissionResult> {
  let controller: ControllerInterface;
  try {
    controller = await loadBuiltControllerInterface(options.slugDir);
  } catch (error) {
    return { status: "representation-defect", detail: errorMessage(error) };
  }
  const openStarter = createStarterOpener(options, controller);
  const opened = await openReadyStarter(openStarter);
  if ("status" in opened) return opened;
  const { artifact } = options;
  if (!controller.presets.includes("files")) {
    return await structuredWriterPath(opened, artifact, openStarter);
  }
  try {
    return await executePath(
      opened.starter,
      opened.authority,
      artifact,
      fileCalls(opened.starter, options.publicArtifactSchema, artifact),
    );
  } catch (error) {
    return (
      (await closeFailure(opened.starter)) ?? { status: "representation-defect", detail: errorMessage(error) }
    );
  }
}

/** Serialise, public-schema check, write, materialise and submit one isolated solve result. */
export async function submitSolvabilityReferenceArtifact(
  options: SolvabilitySubmissionRequest,
): Promise<SolvabilitySubmissionOutcome> {
  const serialized = capturedJsonStringify(options.artifact);
  if (!isString(serialized)) {
    return refusal("solve(task) returned an unserialisable value", "generated-solve-result");
  }
  const artifact = capturedJsonParse(serialized);
  const schemaError = referenceArtifactSchemaError(
    options.publicArtifactSchema,
    options.artifactSchema,
    options.task.taskId,
    artifact,
  );
  if (schemaError !== null) return refusal(schemaError, "generated-solve-result", null, serialized);
  const representationDefect = { failure: "representation-defect" } as const;
  if (options.publicArtifactSchema === null) {
    return refusal(
      "the recorded accept corpus did not compile a public submission schema",
      "generated-toolset-contract",
      representationDefect,
      serialized,
    );
  }
  if (!isRecord(artifact)) {
    return refusal(
      "the reference artifact root is not an object",
      "generated-toolset-contract",
      representationDefect,
      serialized,
    );
  }
  const traversed = await traverseReferenceArtifact({
    ...options,
    publicArtifactSchema: options.publicArtifactSchema,
    artifact,
  });
  if (traversed.status === "accepted") {
    return { ...UNATTRIBUTED, artifactJson: traversed.artifactJson, submissionPath: traversed.evidence };
  }
  if (traversed.status === "non-result") {
    return refusal(
      traversed.detail,
      "submission-path-host",
      { nonResultKind: "submission-path-host" },
      serialized,
    );
  }
  return refusal(traversed.detail, "generated-toolset-contract", representationDefect, serialized);
}
