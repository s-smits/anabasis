/** One controller-owned DraftStore, one prepared answer, and one submission check. */
import { capturedJsonStringify, capturedJsonParse } from "../meta/json-runtime.ts";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { sha256 } from "../meta/digest.ts";
import { canonicalJsonCopy as trustedJson } from "../meta/stable-json.ts";
import type { PublicTask } from "../truth/task-split.ts";
import type { ToolKind } from "../truth/tools-spec.ts";
import type { HarnessSettings } from "../truth/harness-config.ts";
import { defineTool, evidenceResult } from "./define-tool.ts";
import { withDraftLease } from "./draft-authority.ts";
import {
  type ArtifactMaterialization,
  type DraftCheckpoint,
  type DraftSnapshot,
  DraftStore,
  fileMapDigest,
} from "./draft-store.ts";
import { type DraftTool, isDraftTool } from "./draft-tool.ts";
import {
  type PublishedMargin,
  WRITER_BINDING_SENTENCE,
  readMargins,
  renderMargins,
} from "./published-margin.ts";
import type { SubmissionPort } from "./final-submission.ts";
import type { PublicArtifactSchema } from "./public-artifact-schema.ts";
import {
  publicArtifactWriterArgumentProblem,
  publicArtifactWriterParameters,
} from "./public-artifact-writer.ts";
import type { GeneratedTaskAccess } from "./task-access-trace.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import { isRecord, type JsonValue } from "../meta/json-shape.ts";

/** Spelled here so the solve module graph does not load the brief reader behind
 *  PUBLIC_RESOURCES_TOOL; a test pins the two names together. */
const BUILT_PUBLIC_RULES_TOOL = "read_public_resources";
export const BUILT_STANDARD_TOOL_NAMES = [
  "save_candidate",
  "restore_candidate",
  "inspect_draft",
  "preview_artifact",
  "submit",
] as const;
/** The Harness Builder's operating guide for this one harness: how the declared tools compose,
 *  which results go stale, what must hold before submission. `builtSystemPrompt` is universal and
 *  the tool rows are per-capability, so nothing else states harness-level policy. Named
 *  BUILT_AGENTS.md rather than AGENTS.md because some Builder backends discover a nested AGENTS.md
 *  while authoring and would follow instructions written for the later Built agent. */
export const BUILT_AGENTS_FILE = "agent/BUILT_AGENTS.md";
/** State precedence between the universal prompt and the Builder-authored guide. The Builder
 *  may revise its solving instructions after measurement, but cannot change task requirements,
 *  tool authority, submission or stopping rules through those instructions. Without this
 *  distinction, a later score could be mistaken for an improvement under the original rules. The
 *  controller supplies this line and includes it with the guide in promptDigest. */
export const BUILT_GUIDE_PREAMBLE =
  "Domain guidance follows; choose your solving method. It cannot override the public task, tool authority, runtime limits, submission rules or stopping rules.";
export const BUILT_NUDGE = "Finish the task with the available tools, then submit your answer.";
/** Used when recording the first-turn prompt identity. `builtFirstTurnPrompt` produces the actual
 *  text, and a test keeps the constant and function aligned. Instructions stay in the system
 *  prompt; the first turn contains only the task id, family, and public input. */
export const BUILT_FIRST_TURN_TEMPLATE = "Task {taskId} (family {family}).\n\nPublic input:\n{publicInput}";
const MODEL_JSON_LIMIT = 12_000;

/** One model-facing tool row: the definition the provider receives, with the registered authority
 *  already folded into the description. `builtAgentInterface` is its only producer, so a reader of a
 *  recorded row sees the text the model saw rather than a second rendering of the same bundle. */
export type BuiltAgentInterfaceTool = Pick<
  AgentTool,
  "name" | "label" | "description" | "parameters" | "executionMode"
>;

export interface BuiltAgentInterface {
  /** The universal prompt with this harness's operating guide appended. One string, so the guide
   *  cannot reach the model by a route `promptDigest` does not cover. */
  systemPrompt: string;
  promptDigest: string;
  /** Over `tools`, so a recorded row set re-derives this digest. */
  toolSchemaDigest: string;
  tools: BuiltAgentInterfaceTool[];
  /** The guide as authored, kept beside the composed prompt so a reader can attribute a prompt
   *  change to the instructions owner without diffing two universal prefixes. Null only for the
   *  preflight contract, which opens no bundle. */
  operatingGuide: string | null;
}

export interface DomainHarness {
  tools: DraftTool[];
}

export type DomainHarnessFactory = (task: PublicTask<unknown>) => DomainHarness;
type DraftToolFactory = (draft: DraftStore) => readonly AgentTool[];
export interface DomainToolAuthority {
  name: string;
  authority: ToolKind;
}

export interface BuiltStarterCheckpoint {
  schema: "built-starter-checkpoint/v2";
  turn: number;
  draftSeq: number;
  draftDigest: string;
  /** Hash only; file contents stay inside the controller-owned DraftStore. */
  fileMapDigest: string;
  artifactWriterNames: string[];
  materialization: ArtifactMaterialization;
}

type RegisteredToolAuthority = ToolKind | "submission";
export interface BuiltStarterRegistration {
  schema: "built-starter-registration/v2";
  tools: Array<{
    name: string;
    owner: "domain" | "controller" | "preset" | "starter";
    authority: RegisteredToolAuthority;
  }>;
  artifactWriterNames: string[];
}

/** One isolation-probe result. A policy denial proves enforcement for that probe; a missing path
 *  or unrelated runtime failure supplies no such proof and must not count as a denial. */
export type GeneratedToolProbeOutcome =
  | { status: "proved"; code: string }
  | { status: "violated"; detail: string }
  | { status: "non-result"; detail: string };

export interface GeneratedToolBoundaryProbe {
  outsideReadRefused: GeneratedToolProbeOutcome;
  outsideWriteRefused: GeneratedToolProbeOutcome;
  credentialEnvironmentAbsent: GeneratedToolProbeOutcome;
  networkRefused: GeneratedToolProbeOutcome;
  subprocessRefused: GeneratedToolProbeOutcome;
  /** The pinned interpreter is the one binary the Darwin launch profile must allow, so this is the
   *  route the OS wall cannot close. It measures the reachable namespace, not a captured handle. */
  runtimeReExecRefused: GeneratedToolProbeOutcome;
}

export interface GeneratedToolWorkerCondition {
  schema: "generated-tool-worker/v3";
  workerInstanceId: string;
  confinedPid: number;
  controllerPid: number;
  sourceDigest: string;
  policyIdentity: string;
  policyHash: string;
  bundleDigest: string;
  registrationDigest: string;
  toolSchemaDigest: string;
  artifactWriterNames: string[];
  probe: GeneratedToolBoundaryProbe;
}

export interface GeneratedToolWorkerEvidence extends GeneratedToolWorkerCondition {
  termination:
    | { status: "normal" }
    | ({
        status: "non-result";
        /** Host-only close timeout after ready and all requests settled; re-attestation can replace it. */
        closeHandshakeTimeout?: true;
      } & BuiltStarterNonResult);
}

export interface BuiltStarterNonResult {
  /** "crash" is generated code dying after the ready handshake — product-owned, never environment. */
  kind: "runtime" | "protocol" | "sandbox" | "crash";
  message: string;
  /** The controller timed out waiting for the ready or close handshake, rather than receiving
   *  a failure from the child. `kind` still identifies the operation; this field records that
   *  the host's wait limit ended it. */
  deadline?: boolean;
}

export interface BuiltStarter {
  readonly tools: readonly AgentTool<never>[];
  checkpoint(turn: number): BuiltStarterCheckpoint;
  materialization(): ArtifactMaterialization;
  registration: BuiltStarterRegistration;
  /** The bundle's operating guide; absent on a starter that opens no bundle. */
  operatingGuide?: string;
  /** The bundle's agent/config.yaml settings; the defaults when absent. */
  settings?: HarnessSettings;
  generatedWorker?: GeneratedToolWorkerCondition;
  /** Present only for a worker opened in conformance trace mode. */
  taskAccess?(): GeneratedTaskAccess | null;
  preparationNonResult?: BuiltStarterNonResult;
  close?(): Promise<GeneratedToolWorkerEvidence>;
}

/** How many candidates a solver may hold at once. A candidate carries its whole draft and any
 *  prepared answer, so this is a memory bound as much as an interface one; six is more distinct
 *  designs than a case has turns to build. */
const SAVED_CANDIDATES_MAX = 6;
type ToolOwner = BuiltStarterRegistration["tools"][number]["owner"];
type ToolBinding = { tool: AgentTool; owner: ToolOwner; authority: RegisteredToolAuthority };

/** What a generated tool is bound against: the task it answers, the authority it was declared
 *  with, the public schema its writes must fit and the margins the domain published. */
type DraftToolContext = {
  readonly task: PublicTask<unknown>;
  readonly declared: readonly DomainToolAuthority[];
  readonly publicArtifactSchema: PublicArtifactSchema | null;
  readonly margins: readonly PublishedMargin[];
};

/** What the controller knows about this harness beyond the task and the generated factory. One
 *  object rather than five trailing positional arguments, so a call site that needs the last of
 *  them does not have to spell the four it does not. */
interface BuiltStarterOptions {
  controllerTools?: readonly AgentTool[];
  draftToolFactories?: readonly DraftToolFactory[];
  domainToolAuthorities?: readonly DomainToolAuthority[];
  publicArtifactSchema?: PublicArtifactSchema | null;
  /** The published comparisons an artifact-writer reports back; see published-margin.ts. */
  publishedMargins?: readonly PublishedMargin[];
}

/** The prompt points one way: prepare something that passes, then widen its worst margin until the
 *  wall. It used to point both ways, adding that a requirement is pass or fail so a checked answer
 *  is done — written for 2026-09-15, when truss solvers spent about 30 minutes a case improving
 *  answers that already passed by 22 per cent on median (21 verified, 0 failed). Two days later the
 *  regime was the opposite: 19 of 23 answers breached a published limit by the numbers they
 *  themselves reported. Stopping early is not the failure mode to guard, and the closing sentence
 *  says to submit once every requirement is met and the margin stops widening; it used to say
 *  "submit it and stop" at the first pass, which cancelled the two sentences before it.
 *
 *  The clauses that used to ask the solver to compare each reported value against each published
 *  limit, and to hold margin on limits its own model only approximates, are gone: `readMargins` now
 *  measures the prepared answer against every complete published boundary and the artifact-writer
 *  returns that table, so what was asked for is computed. The rest is what the solver cannot observe — that the last prepared answer is
 *  submitted at the wall (truss run eaf98f, 2026-09-14), and that a candidate worth keeping should
 *  be saved before the next experiment replaces it: of 2026-09-17's 21 failing cases, 2 shipped an
 *  untouched baseline 4.6 times over its budget (3141.539 kg of 681.6 kg) that the wall then
 *  submitted by default. */
export const builtSystemPrompt = (solveMs: number): string =>
  "Complete the task with the available tools and submit one answer. Choose your approach within the public task's requirements, and read every requirement before you build. " +
  "For source code or files, write complete working files, not fragments or descriptions. " +
  "When a tool or installed program can build, run or test your candidate, do so: a breach it reports is a failed requirement. " +
  "Prepare a candidate as your answer as soon as it meets every requirement you can check, then spend the time that remains widening the worst margin. Save it before you change it, so a change that does not improve it can be undone and what stays prepared at the end is the best candidate you found rather than the last one you tried. If a requirement fails, change the candidate for that reason, with commands you wait for rather than detached jobs; a bounded search over candidates is a sound way to meet a tight limit. " +
  `Keep searching while solve time remains; the case has ${String(Math.round(solveMs / 60_000))} minutes of it, and at the end the last answer an artifact-writer prepared is submitted for you. Submit when the prepared answer meets every requirement and no change you can still make widens its worst margin.`;

export function builtFirstTurnPrompt(
  task: Pick<PublicTask<unknown>, "taskId" | "family" | "publicInput">,
): string {
  return `Task ${task.taskId} (family ${task.family}).\n\nPublic input:\n${capturedJsonStringify(task.publicInput, null, 2)}`;
}
/** The closed roster, stated to the agent that has it. `BUILT_SYSTEM_PROMPT` says "the available
 *  tools" and never names them, so an agent that wants a capability its roster lacks has nothing to
 *  read and guesses instead. On truss-w36-opus the solver made 182 calls to `Monitor`,
 *  `PushNotification` and `bash` — Claude Code tool names absent from every roster — and every one
 *  failed. 153 of them came from the two 7-tool variants; the three full-roster variants of
 *  the same run spent 29 between them (12 tools: 0 and 17; 11 tools: 12). Fewer tools drew more
 *  guesses in that recorded run. Compose the line
 *  from the rows this contract already discloses, so the sentence cannot drift from the roster it
 *  describes. */
function builtRosterLine(rows: readonly BuiltAgentInterfaceTool[]): string {
  const roster = `Your tools this session are exactly: ${rows.map(({ name }) => name).join(", ")}. That list is closed and complete. A name absent from it does not exist here, however plausible it looks; when no tool provides a capability, do the work yourself and continue.`;
  // The first turn carries only the public input; the domain's published rules, schema and
  // constants arrive through this tool, which the prompt otherwise never names.
  return rows.some(({ name }) => name === BUILT_PUBLIC_RULES_TOOL)
    ? `${roster} The published requirements are the public input together with what ${BUILT_PUBLIC_RULES_TOOL} returns; read both before you build.`
    : roster;
}

export function builtAgentInterface(
  tools: readonly AgentTool[],
  registration: BuiltStarterRegistration,
  operatingGuide: string | null,
  solveMs: number,
): BuiltAgentInterface {
  const toolNames = tools.map(({ name }) => name).sort();
  const registeredNames = registration.tools.map(({ name }) => name).sort();
  if (trustedJson(toolNames).bytes !== trustedJson(registeredNames).bytes) {
    throw new Error(
      `Built model contract mismatch: tools [${toolNames.join(", ")}], registration [${registeredNames.join(", ")}]`,
    );
  }
  const authorities = new Map(registration.tools.map(({ name, authority }) => [name, authority]));
  const rows = tools.map(({ name, label, description, parameters, executionMode }) => ({
    name,
    label,
    description: `Role: ${String(authorities.get(name))}. ${description}`,
    parameters,
    ...keyIfDefined("executionMode", executionMode),
  }));
  const universal = `${builtSystemPrompt(solveMs)}\n\n${builtRosterLine(rows)}`;
  const systemPrompt =
    operatingGuide === null ? universal : `${universal}\n\n${BUILT_GUIDE_PREAMBLE}\n\n${operatingGuide}`;
  return {
    systemPrompt,
    promptDigest: sha256(systemPrompt),
    toolSchemaDigest: sha256(trustedJson(rows).bytes),
    tools: rows,
    operatingGuide,
  };
}

export function starterRegistration(tools: BuiltStarterRegistration["tools"]): BuiltStarterRegistration {
  const names = new Set<string>();
  for (const { name } of tools) {
    if (names.has(name)) throw new Error(`Built Harness tool registration refused duplicate name "${name}"`);
    names.add(name);
  }
  const artifactWriterNames = tools
    .filter(({ authority }) => authority === "artifact-writer")
    .map(({ name }) => name)
    .sort();
  return { schema: "built-starter-registration/v2", tools, artifactWriterNames };
}

export const PROBE_KEYS = [
  "outsideReadRefused",
  "outsideWriteRefused",
  "credentialEnvironmentAbsent",
  "networkRefused",
  "subprocessRefused",
  "runtimeReExecRefused",
] as const satisfies readonly (keyof GeneratedToolBoundaryProbe)[];

function probeOutcomeStatus(outcome: unknown): GeneratedToolProbeOutcome["status"] | null {
  if (!isRecord(outcome)) return null;
  const { status } = /* SAFETY: reached only when `!isRecord(outcome)` does not hold. */ outcome as {
    status?: unknown;
  };
  return status === "proved" || status === "violated" || status === "non-result" ? status : null;
}

/** Every probe fact has a recognised status. Shape only: a violated or non-result fact is valid
 *  evidence of an unproven boundary, not proof of one. */
function hasRecognisedProbeOutcomes(probe: unknown): probe is GeneratedToolBoundaryProbe {
  if (!isRecord(probe)) return false;
  const record =
    /* SAFETY: `isRecord` narrowed the value above; the value type is checked per key below. */ probe as Partial<GeneratedToolBoundaryProbe>;
  return PROBE_KEYS.every((key) => probeOutcomeStatus(record[key]) !== null);
}

/** The controller's own reading of the ready frame: every fact is `proved`. The trusted child
 *  already refuses before loading generated code on any other status; this check stands on its
 *  own so a child regression cannot turn a signed ready frame into accepted evidence. */
export function probeProvesBoundary(probe: unknown): probe is GeneratedToolBoundaryProbe {
  return hasRecognisedProbeOutcomes(probe) && PROBE_KEYS.every((key) => probe[key].status === "proved");
}

/** One window onto a value the model reads. A draft or a prepared answer can be larger than a turn
 *  should carry, so a long value arrives as a window rather than a cut: the text names the character
 *  the next window starts at, and `from` takes that number back. These two tools are idempotent, so
 *  the rest is still there to ask for; nothing has to be spilled to a file to stay recoverable. */
function modelView(value: JsonValue | DraftSnapshot, draftSeq: number, from = 0) {
  const complete = trustedJson(value).bytes;
  const start = Math.min(Math.max(0, Math.trunc(from)), complete.length);
  const window = complete.slice(start, start + MODEL_JSON_LIMIT);
  const next = start + window.length;
  const left = complete.length - next;
  const before = start === 0 ? "" : `… (${start} chars before this)\n`;
  const after = left === 0 ? "" : `\n… (${left} chars left; call again with from: ${next})`;
  return {
    text: `${before}${window}${after}`,
    details: {
      draftSeq,
      truncated: left > 0,
      from: start,
      next: left > 0 ? next : null,
      total: complete.length,
    },
  };
}

/** The window control both readers share. Its own description is the only place this bound is
 *  stated: the result text already carries the remedy, so the tool descriptions do not repeat it. */
const WINDOW = Type.Object({
  from: Type.Optional(
    Type.Number({
      minimum: 0,
      description:
        "Character to start reading at. Use the number the previous result named; omit it for the start.",
    }),
  ),
});

/** The one shape a blocked submit returns, whether the draft never reached the door or the
 *  submission port refused the bytes at it. */
function blocked(safeRemedy: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: `Submit blocked: ${safeRemedy}` }], details: null };
}

export function submitMaterializedArtifact(
  materialization: ArtifactMaterialization,
  submission: SubmissionPort,
): AgentToolResult<unknown> {
  if (materialization.state !== "current") {
    const stale = materialization.state === "stale";
    const safeRemedy = stale
      ? "The draft changed after the answer was prepared. Call an artifact-writer again, then submit."
      : "Call an artifact-writer to prepare the exact public answer, then submit again.";
    const refused = submission.reject({
      code: stale ? "draft-materialization-stale" : "draft-unmaterialized",
      safeRemedy,
    });
    return blocked(refused.rejection?.safeRemedy ?? safeRemedy);
  }
  const fact = submission.acceptArtifact(materialization.record.artifactJson);
  return fact.accepted
    ? {
        content: [{ type: "text", text: "Submitted." }],
        details: { artifactDigest: fact.artifactDigest },
        terminate: true,
      }
    : blocked(fact.rejection?.safeRemedy ?? "artifact rejected");
}

function preview(materialization: ArtifactMaterialization, draftSeq: number, from: number | undefined) {
  if (materialization.state === "absent") {
    return { text: "No answer has been prepared. Call an artifact-writer.", details: { draftSeq } };
  }
  if (materialization.state === "stale") {
    return {
      text: "The draft changed after the answer was prepared. Call an artifact-writer again.",
      details: { draftSeq, sourceSeq: materialization.record.sourceSeq },
    };
  }
  return modelView(capturedJsonParse(materialization.record.artifactJson), draftSeq, from);
}

/** One owner for the submit description. `maxAttempts` is a public runtime fact, so the bound
 *  belongs in the text the agent reads. The generated-tool worker child builds its starter with no
 *  submission port and would otherwise register the unbounded sentence; the parent process, which
 *  holds the real port, restates this same text over the child's descriptor. */
export function submitToolDescription(submission: SubmissionPort | null): string {
  return submission === null
    ? "Send the prepared answer."
    : `Send the prepared answer. Up to ${submission.maxAttempts} submit attempts are accepted.`;
}

const CANDIDATE_NAME = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 60, description: "Your own label for this candidate." }),
});

function standardTools(
  draft: DraftStore,
  submission: SubmissionPort | null,
  saved: Map<string, DraftCheckpoint>,
): AgentTool[] {
  const held = () => (saved.size === 0 ? "none" : [...saved.keys()].join(", "));
  return [
    // The solve wall submits the answer an artifact-writer last prepared, and a draft that has
    // moved on from a prepared answer makes that answer stale and unsendable. Without somewhere to
    // put a candidate that already met every requirement, a solver whose next experiment was worse
    // had no route back to it and shipped the worse one. `DraftStore` could already take its own
    // checkpoint; these two tools are what gives that a consumer.
    defineTool({
      name: "save_candidate",
      label: "Save candidate",
      description:
        "Keep the draft and its prepared answer under a name, so a later change can be undone. Saving the same name again replaces it.",
      parameters: CANDIDATE_NAME,
      executionMode: "sequential",
      run: ({ name }) => {
        if (!saved.has(name) && saved.size >= SAVED_CANDIDATES_MAX) {
          return {
            text: `Not saved: ${SAVED_CANDIDATES_MAX} candidates are already held (${held()}). Save over one of those names instead.`,
            details: { saved: [...saved.keys()], stored: false },
          };
        }
        saved.set(name, draft.checkpoint());
        return {
          text: `Saved "${name}". Held: ${held()}.`,
          details: { saved: [...saved.keys()], stored: true },
        };
      },
    }),
    defineTool({
      name: "restore_candidate",
      label: "Restore candidate",
      description:
        "Put the draft and its prepared answer back to a saved candidate. The candidate stays saved.",
      parameters: CANDIDATE_NAME,
      executionMode: "sequential",
      run: ({ name }) => {
        const candidate = saved.get(name);
        if (candidate === undefined) {
          return {
            text: `No candidate named "${name}". Held: ${held()}.`,
            details: { saved: [...saved.keys()], restored: false },
          };
        }
        draft.adopt(candidate);
        return {
          text: `Restored "${name}". Check it before you submit: the answer prepared with it is prepared again.`,
          details: { saved: [...saved.keys()], restored: true, draftSeq: draft.seq },
        };
      },
    }),
    defineTool({
      name: "inspect_draft",
      label: "Inspect draft",
      description:
        "Read working values and files, with prepared-answer status. Use preview_artifact to read the exact answer submit would send.",
      parameters: WINDOW,
      executionMode: "parallel",
      run: ({ from }) =>
        modelView(
          {
            preparedAnswer: draft.artifactMaterialization().state,
            savedCandidates: [...saved.keys()],
            ...draft.snapshot(),
          },
          draft.seq,
          from,
        ),
    }),
    defineTool({
      name: "preview_artifact",
      label: "Preview artifact",
      description: "Show the exact answer submit would send.",
      parameters: WINDOW,
      executionMode: "parallel",
      run: ({ from }) => preview(draft.artifactMaterialization(), draft.seq, from),
    }),
    {
      name: "submit",
      label: "Submit",
      description: submitToolDescription(submission),
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: async () => {
        if (submission === null) throw new Error("the generated-tool worker cannot execute submit");
        return submitMaterializedArtifact(draft.artifactMaterialization(), submission);
      },
    },
  ];
}

function bindDraftTools(
  draft: DraftStore,
  tools: readonly DraftTool[],
  context: DraftToolContext,
): ToolBinding[] {
  const { task, declared, publicArtifactSchema, margins } = context;
  // A generated array can carry own `map`/iterator properties that would run generated code inside
  // this registration walk and let it create binding rows. lockJsonGlobals froze Array.prototype, so
  // this slice is the real one: it reads the elements once into a clean engine array.
  const snapshot: DraftTool[] = Array.prototype.slice.call<readonly DraftTool[], [], DraftTool[]>(tools);
  if (snapshot.some((tool) => !isDraftTool(tool))) {
    throw new Error("createDomainHarness tools must be created with defineDraftTool");
  }
  const actual = snapshot.map(({ name }) => name).sort();
  const expected = declared.map(({ name }) => name).sort();
  if (trustedJson(actual).bytes !== trustedJson(expected).bytes) {
    throw new Error(
      `domain tool mismatch: generated [${actual.join(", ")}], recorded [${expected.join(", ")}]`,
    );
  }
  const authorities = new Map(declared.map(({ name, authority }) => [name, authority]));
  const artifactWriterParameters =
    publicArtifactSchema === null ? null : publicArtifactWriterParameters(publicArtifactSchema);
  return snapshot.map((tool) => {
    const authority =
      /* SAFETY: the mismatch check above threw unless the generated tool names are exactly the recorded declared names, so every name is in the map. */ authorities.get(
        tool.name,
      ) as ToolKind;
    if ((authority === "writer" || authority === "artifact-writer") && tool.executionMode !== "sequential") {
      throw new Error(`registered ${authority} tool "${tool.name}" must use sequential execution`);
    }
    const exactArtifactWriter = authority === "artifact-writer" && publicArtifactSchema !== null;
    const boundTool: AgentTool = {
      ...tool,
      // The host owns this tool's parameters and its execution, and the Builder wrote its
      // description against neither. One truss writer's description ended "It runs no analysis and
      // checks nothing against the published limits" while the bound execute below was returning
      // the published-limit table. The authored sentence stays — it says what the tool is for in
      // the domain's own words — and the host says what runs, at the one place it takes over.
      description: exactArtifactWriter ? `${tool.description} ${WRITER_BINDING_SENTENCE}` : tool.description,
      parameters: exactArtifactWriter
        ? /* SAFETY: exactArtifactWriter can be true only when publicArtifactSchema is non-null,
           which is the same branch that creates artifactWriterParameters above. */ (artifactWriterParameters as AgentTool["parameters"])
        : tool.parameters,
      execute: exactArtifactWriter
        ? async (callId, params, signal) => {
            signal?.throwIfAborted();
            const problem = publicArtifactWriterArgumentProblem(
              publicArtifactSchema,
              // SAFETY: AgentTool arguments cross the generated-worker protocol as JSON values;
              // the exact public schema validator below still refuses every wrong JSON shape.
              params as JsonValue,
            );
            if (problem !== null) {
              throw new Error(
                `tool "${tool.name}" arguments do not match the public artifact schema (${problem})`,
              );
            }
            return await withDraftLease(draft, authority, tool.name, callId, (leased) => {
              leased.setArtifact(params);
              // Measured here rather than at submit: this is the moment the answer becomes the one
              // the wall would send, and a reading returned here costs no submit attempt.
              const readings = readMargins(margins, task.family, task.publicInput, params);
              // The readings ride the trace as well as the text, so a later run can ask whether a
              // solver that was shown a breach then moved off it.
              return evidenceResult({
                text: `Prepared the exact public answer.${renderMargins(readings)}`,
                ...keysIf(readings.length > 0, () => ({ details: { margins: readings } })),
              });
            });
          }
        : async (callId, params, signal, onUpdate) =>
            await withDraftLease(draft, authority, tool.name, callId, (leased) =>
              tool.execute(
                callId,
                /* SAFETY: `never` is the roster's parameter type; the generated tool validates these arguments against its own registered schema. */ params as never,
                leased,
                signal,
                onUpdate,
              ),
            ),
    };
    if (exactArtifactWriter) {
      // A generated argument preparer belongs to its generated schema. Retaining it after the
      // public schema replaces that contract would reopen a transformation before DraftStore.
      delete boundTool.prepareArguments;
    }
    return {
      owner: "domain",
      authority,
      tool: boundTool,
    };
  });
}

/** What each starter-owned tool is registered as. `restore_candidate` moves draft content, so it is
 *  a writer; every other starter tool but `submit` only reads. */
function starterAuthority(name: string): ToolKind | "submission" {
  if (name === "submit") return "submission";
  if (name === "restore_candidate") return "writer";
  return "reader";
}

function presetAuthority(tool: AgentTool): ToolKind {
  if (tool.name === "write" || tool.name === "edit" || tool.name === "materialize_files") {
    return "artifact-writer";
  }
  if (tool.name === "read") return "reader";
  throw new Error(`trusted draft preset tool "${tool.name}" has no authority`);
}

export function createBuiltStarter(
  task: PublicTask<unknown>,
  factory: DomainHarnessFactory,
  submission: SubmissionPort | null,
  options: BuiltStarterOptions = {},
): BuiltStarter {
  const {
    controllerTools = [],
    draftToolFactories = [],
    domainToolAuthorities = [],
    publicArtifactSchema = null,
    publishedMargins = [],
  } = options;
  const rawDraft = new DraftStore();
  const harness = factory(task);
  if (!Array.isArray(harness?.tools)) throw new Error("createDomainHarness must return tools");
  const domainTools = bindDraftTools(rawDraft, harness.tools, {
    task,
    declared: domainToolAuthorities,
    publicArtifactSchema,
    margins: publishedMargins,
  });
  const presets = draftToolFactories
    .flatMap((create) => create(rawDraft))
    .map((tool): ToolBinding => ({ tool, owner: "preset", authority: presetAuthority(tool) }));
  const inherited = standardTools(rawDraft, submission, new Map<string, DraftCheckpoint>());
  const bindings: ToolBinding[] = [
    ...domainTools,
    ...controllerTools.map((tool): ToolBinding => ({ tool, owner: "controller", authority: "reader" })),
    ...presets,
    ...inherited.map(
      (tool): ToolBinding => ({
        tool,
        owner: "starter",
        authority: starterAuthority(tool.name),
      }),
    ),
  ];
  const registration = starterRegistration(
    bindings.map(({ tool, owner, authority }) => ({ name: tool.name, owner, authority })),
  );
  const tools =
    /* SAFETY: `AgentTool<never>` is the roster's common type; each bound tool keeps its own registered parameter schema. */ Object.freeze(
      bindings.map(({ tool }) => tool),
    ) as readonly AgentTool<never>[];
  return {
    tools,
    registration,
    materialization: () => rawDraft.artifactMaterialization(),
    checkpoint: (turn) => {
      if (!Number.isSafeInteger(turn) || turn < 1) {
        throw new Error(`Built Harness checkpoint turn must be a positive safe integer, got ${String(turn)}`);
      }
      const draftCheckpoint = rawDraft.checkpoint();
      return {
        schema: "built-starter-checkpoint/v2",
        turn,
        draftSeq: draftCheckpoint.seq,
        draftDigest: sha256(trustedJson(draftCheckpoint).bytes),
        fileMapDigest: fileMapDigest(draftCheckpoint.snapshot.files ?? {}),
        artifactWriterNames: [...registration.artifactWriterNames],
        materialization: rawDraft.artifactMaterialization(),
      };
    },
  };
}

/** Close probed workers one at a time. Each has a one-second handshake timeout; closing many
 *  together caused timeouts in run truss-opus-20260907T210000000Z-6bf0e9. It opened about
 *  26 workers, nine timed out at once, and the refused candidate's agent bytes were identical
 *  to the ones the same session then submitted and had accepted. */
export async function closeOneAtATime<T>(opened: { close?: () => Promise<T> }[]) {
  const closed: (T | undefined)[] = [];
  for (const toolset of opened) closed.push(await toolset.close?.());
  return closed;
}
