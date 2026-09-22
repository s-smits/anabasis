/** Execute an F2 reference artifact through the production Built Harness submission path. */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Value } from "typebox/value";
import type { SolvabilityCaseEvidence, SolvabilitySubmissionPathEvidence } from "../claim/readiness.ts";
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
import { trustedJsonParse, trustedJsonStringify } from "./trusted-runtime.ts";
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

/** One reference artifact's submission result, before any truth verdict. A failed outcome carries
 *  its whole attribution: owner, kind and author-visible classification. */
export interface SolvabilitySubmissionOutcome {
  artifactJson: string | null;
  submissionPath: SolvabilitySubmissionPathEvidence | null;
  error: string | null;
  authorClassification: GeneratedExecutionClassification | null;
  nonResultKind: SolvabilityCaseEvidence["nonResultKind"];
  failureOwner: SolvabilityCaseEvidence["failureOwner"];
  failureKind: SolvabilityCaseEvidence["failureKind"];
}

/** The attribution an attempt carries until something goes wrong. */
export const UNATTRIBUTED: SolvabilitySubmissionOutcome = {
  artifactJson: null,
  submissionPath: null,
  error: null,
  authorClassification: null,
  nonResultKind: null,
  failureOwner: null,
  failureKind: null,
};

/** No writer types this marker object where a reference answer writes null, so a schema that
 *  accepts it at a null position has not declared that position at all. */
const UNDECLARED_POSITION_PROBE: JsonValue = { "ana-absence-spelling-probe": true };

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
  attribution: Partial<
    Pick<SolvabilitySubmissionOutcome, "failureKind" | "nonResultKind" | "failureOwner">
  > = {},
  artifactJson: string | null = null,
): SolvabilitySubmissionOutcome {
  return {
    ...UNATTRIBUTED,
    failureOwner: "product",
    ...attribution,
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

/** The domain artifact-writers whose parameter schema accepts this artifact. */
function acceptingWriters(starter: BuiltStarter, artifact: Record<string, JsonValue>): AgentTool<never>[] {
  return starter.registration.tools
    .filter(({ owner, authority }) => owner === "domain" && authority === "artifact-writer")
    .map(({ name }) => starter.tools.find((tool) => tool.name === name))
    .filter((tool): tool is AgentTool<never> => tool !== undefined && schemaAccepts(tool, artifact));
}

/**
 * The first position where the writer accepts `""` although the reference answer writes null,
 * giving absence two spellings for the agent to choose between. Only the empty string counts:
 * "n/a" or "none" can be legitimate free text.
 *
 * Each probe replaces one null in a shallow copy along the walked path, so nothing shared is
 * mutated. Array indices collapse to `[]` only in the reported path; deduplication uses the exact
 * position, because a tuple may type its positions differently.
 */
export function absenceSpellingAdmitted(
  tool: AgentTool<never>,
  artifact: Record<string, JsonValue>,
): { path: string } | null {
  const probed = new Set<string>();
  const probe = (
    value: JsonValue,
    path: string,
    exact: string,
    build: (replacement: JsonValue) => Record<string, JsonValue>,
  ): { path: string } | null => {
    if (value === null) {
      if (probed.has(exact)) return null;
      probed.add(exact);
      if (!schemaAccepts(tool, build(""))) return null;
      // A non-strict Check ignores undeclared positions, so "" alone proves nothing. The position
      // is this writer's only when it can also reject there.
      return schemaAccepts(tool, build(UNDECLARED_POSITION_PROBE)) ? null : { path };
    }
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        const hit = probe(item, `${path}[]`, `${exact}[${String(index)}]`, (replacement) =>
          build(value.map((sibling, at) => (at === index ? replacement : sibling))),
        );
        if (hit) return hit;
      }
    } else if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        const hit = probe(child, `${path}.${key}`, `${exact}.${key}`, (replacement) =>
          build({ ...value, [key]: replacement }),
        );
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const [key, child] of Object.entries(artifact)) {
    const hit = probe(child, key, key, (replacement) => ({ ...artifact, [key]: replacement }));
    if (hit) return hit;
  }
  return null;
}

/** Checks every compatible writer for a second spelling of absence before choosing a submission
 *  path, so no alternative path can bypass it. Uses schemas only; no writer runs. */
function absenceSpellingRefusal(starter: BuiltStarter, artifact: Record<string, JsonValue>): string | null {
  for (const tool of acceptingWriters(starter, artifact)) {
    const ambiguous = absenceSpellingAdmitted(tool, artifact);
    if (ambiguous !== null) {
      return (
        `writer "${tool.name}" accepts the empty string at ${ambiguous.path}, where the ` +
        "reference answer writes null — one meaning with two spellings, and the agent chooses which. " +
        "Narrow the writer's parameter schema at that path so null is the only way to state absence, " +
        "for example Type.String({ minLength: 1 }) beside Type.Null()"
      );
    }
  }
  return null;
}

/**
 * Attributes a worker failure. After the ready handshake, a `runtime` or `protocol` failure is the
 * generated code's: a representation defect. `sandbox` stays an environment failure. A controller
 * deadline of any kind is a non-result, since a slow child says nothing about its bytes.
 */
function startedWorkerFailure(failure: BuiltStarterNonResult): SolvabilitySubmissionPathFailure {
  const detail = failure.message;
  if (failure.deadline === true) return { status: "non-result", detail };
  return failure.kind === "protocol" || failure.kind === "runtime"
    ? { status: "representation-defect", detail }
    : { status: "non-result", detail };
}

async function closeFailure(starter: BuiltStarter): Promise<SolvabilitySubmissionPathFailure | null> {
  let evidence: GeneratedToolWorkerEvidence | undefined;
  try {
    evidence = await starter.close?.();
  } catch (error) {
    return { status: "non-result", detail: `submission worker close failed: ${errorMessage(error)}` };
  }
  if (evidence === undefined || evidence.termination.status === "normal") return null;
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
    const accepted = trustedJsonParse(final.artifactJson);
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
  return (await closeFailure(starter)) ?? outcome;
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

/** Only the public JSON artifact enters this confined worker; verifier results, hidden task data
 *  and repair details do not. */
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
  const ambiguous = absenceSpellingRefusal(opened.starter, artifact);
  if (ambiguous !== null) {
    return (await closeFailure(opened.starter)) ?? { status: "representation-defect", detail: ambiguous };
  }
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

/** Serialises, schema-checks, writes, materialises and submits one isolated solve result. */
export async function submitSolvabilityReferenceArtifact(
  options: SolvabilitySubmissionRequest,
): Promise<SolvabilitySubmissionOutcome> {
  const serialized = trustedJsonStringify(options.artifact);
  if (!isString(serialized)) {
    return refusal("solve(task) returned an unserialisable value", "generated-solve-result");
  }
  const artifact = trustedJsonParse(serialized);
  const schemaError = referenceArtifactSchemaError(
    options.publicArtifactSchema,
    options.artifactSchema,
    options.task.taskId,
    artifact,
  );
  if (schemaError !== null) return refusal(schemaError, "generated-solve-result", {}, serialized);
  const representationDefect = { failureKind: "representation-defect" } as const;
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
      { nonResultKind: "submission-path-host", failureOwner: "environment" },
      serialized,
    );
  }
  return refusal(traversed.detail, "generated-toolset-contract", representationDefect, serialized);
}
