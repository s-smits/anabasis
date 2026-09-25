/** Confined Built worker: the shared pi session over the shared provider layer, with the Built
 *  harness's own turn loop and no Anabasis decision authority. */
import type { JsonValue } from "../meta/json-shape.ts";
import { keysIf, keyIfDefined } from "../meta/optional-key.ts";
import { mkdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import type { PiAgentSession } from "../../vendor/pi-agent-session/agent-session.ts";
import { attachJsonlLineReader, serializeJsonLine } from "../../vendor/pi-built/jsonl.ts";
import type { BuiltAgentInterface } from "../solve/built-starter.ts";
import type { AgentTurnEvent, AgentTurnResult, CompactionRecord, TurnUsage } from "./backend-types.ts";
import type { ModelSelectionEvidence } from "./model-selection.ts";
import {
  type ClaudeCli,
  type PiCredential,
  type PiProfile,
  fakePiModel,
  openPiModel,
} from "./pi-providers.ts";
import { PiPromptRecord, openPiAgentSession, piRuntimeIdentity, settledStatus } from "./pi-session.ts";
import { piTurnUsage } from "./pi-usage.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { runtimeProcess } from "../meta/process.ts";
import { runtimeNonResultReason } from "../truth/runtime-blocker.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hasText } from "../meta/text.ts";
import { boundText } from "../meta/bounded-text.ts";

/** The child receives exactly what `builtAgentInterface` produced, under the same type rather than
 *  a re-spelling of it, so the recorded evidence, the worker protocol and the repair packet all
 *  describe the same bytes. */
type PiBuiltInterface = BuiltAgentInterface;
export interface PiBuiltStart {
  type: "start";
  workerInstanceId: string;
  profile: PiProfile;
  credential: PiCredential;
  contract: PiBuiltInterface;
  prompt: string;
  nudge: string;
  maxTurns: number;
  fakeResponses?: AssistantMessage[];
  /** Host-resolved absolute path to the aliased Agent SDK's bundled Claude CLI binary. The claude
   *  transport needs it because the esbuild bundle breaks the SDK's own relative discovery of it.
   *  Kept out of `conditionDigest`: a machine path is not a run condition, and including it would
   *  make two identical runs on two machines look like different conditions. */
  claudeCliPath?: string;
}
export type PiBuiltParentMessage =
  | PiBuiltStart
  | { type: "turn_permit"; turn: number }
  | { type: "tool_result"; id: string; ok: boolean; result?: AgentToolResult<unknown>; error?: string }
  | { type: "close" };
export type PiBuiltChildMessage =
  | {
      type: "ready";
      workerInstanceId: string;
      pid: number;
      promptDigest: string;
      toolSchemaDigest: string;
      modelSelection: ModelSelectionEvidence;
    }
  | { type: "turn_start"; turn: number; prompt: string }
  | { type: "turn_permit_request"; turn: number }
  | {
      type: "turn_end";
      turn: number;
      status: "completed" | "failed" | "aborted";
      /** The provider's or worker's own words for a turn that did not complete. The parent records
       *  it in the trace, where the synthesised marker that stood here before said nothing at all
       *  about the cause. */
      errorMessage?: string;
      usage?: TurnUsage;
      compactions?: CompactionRecord[];
      /** The provider identity of a completed turn. It rides the turn that produced it, so a solve
       *  whose last turn never closes still attests the turns that did. `done` is the one message a
       *  wall-cut solve never sends, so carrying the identities only there leaves a case reporting
       *  one completed turn and zero identities, which refuses its battery's whole claim on
       *  `runtime-model-identity-unproven`. Absent on a failed or aborted turn. */
      identity?: NonNullable<AgentTurnResult["runtimeIdentity"]>;
    }
  | { type: "event"; event: AgentTurnEvent }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, JsonValue> }
  | {
      type: "done";
      turns: number;
      errors: string[];
      toolCalls: { total: number; failed: number; byName: Record<string, number> };
    }
  | { type: "closing" }
  | { type: "fatal"; kind: "provider" | "runtime" | "protocol"; error: string };

const pending = new Map<
  string,
  { resolve(value: AgentToolResult<unknown>): void; reject(error: Error): void }
>();

/** The three states one Built turn can end in — one spelling for the wire row and the loop. */
type BuiltTurnStatus = Extract<PiBuiltChildMessage, { type: "turn_end" }>["status"];

/** A second failure in a row ends the solve: one more prompt does not repair a broken session. */
const MAX_CONSECUTIVE_TURN_FAILURES = 2;

type RuntimeIdentities = NonNullable<Extract<PiBuiltChildMessage, { type: "turn_end" }>["identity"]>[];

interface PromptedTurn {
  status: BuiltTurnStatus;
  identity: RuntimeIdentities[number] | null;
  usage: TurnUsage | undefined;
  compactions: CompactionRecord[];
}

registerBunOAuthFlows();

let secret = "";
let session: PiAgentSession | null = null;
let accepted = false;
let currentTurn = 0;
/** The running turn's record, which the Claude CLI's compaction and builtin-search hooks write to. */
let activeRecord: PiPromptRecord | null = null;
const solveCalls: Extract<PiBuiltChildMessage, { type: "done" }>["toolCalls"] = {
  total: 0,
  failed: 0,
  byName: {},
};
const turnPermits = new Map<number, ReturnType<typeof Promise.withResolvers<void>>>();

function send(message: PiBuiltChildMessage): void {
  runtimeProcess.stdout.write(serializeJsonLine(message));
}

function safeError(cause: unknown): string {
  const text = errorMessage(cause);
  return boundText(secret ? text.replaceAll(secret, "[redacted]") : text, 800).shown;
}

function credentialSecret(credential: PiCredential): string {
  if (credential.type === "bearer") return credential.token;
  if (credential.type === "oauth") return credential.access;
  return credential.key ?? "";
}

/** The Claude CLI for this worker. Its config directory is per worker instance because the cwd is
 *  the process-wide worker bundle directory: concurrent cases would otherwise share one
 *  CLAUDE_CONFIG_DIR and race on the CLI's own state files. The generated-tool worker names its
 *  denied-write path the same way, from the same instance id. */
function claudeCli(start: PiBuiltStart): ClaudeCli | null {
  if (start.profile.transport !== "claude") return null;
  if (!hasText(start.claudeCliPath)) {
    throw new Error("Claude transport requires the host-resolved Claude CLI path");
  }
  const configDir = join(runtimeProcess.cwd(), `claude-bridge-config-${start.workerInstanceId}`);
  mkdirSync(configDir, { recursive: true });
  return { cliPath: start.claudeCliPath, configDir, baseEnv: Bun.env, claudeCodePreset: true };
}

async function servedModel(start: PiBuiltStart) {
  if (start.fakeResponses !== undefined) return fakePiModel(start.profile, start.fakeResponses);
  return openPiModel(start.profile, async () => start.credential, claudeCli(start), {
    onCompaction: (tokensBefore) => activeRecord?.cliCompaction(tokensBefore),
    onBuiltinTool: (call) => activeRecord?.builtinTool(call),
  });
}

function proxyTools(start: PiBuiltStart): AgentTool[] {
  return start.contract.tools.map((tool) => ({
    ...tool,
    execute: (id, args) =>
      new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({
          type: "tool_call",
          id,
          name: tool.name,
          arguments:
            /* SAFETY: the wire frame carries tool arguments as free JSON; the host tool validates them against its own registered schema. */ args as Record<
              string,
              JsonValue
            >,
        });
      }),
  }));
}

/** Whether another prompt may follow this turn. An abort was decided by the host or the provider,
 *  so re-prompting it would pay for a turn nobody asked for. A single failure is different: the
 *  agent keeps its messages and tool results, so the next prompt continues the same solve where it
 *  stopped. Without that, a case whose first turn fails after a dozen useful tool calls ends with
 *  every remaining turn unused and nothing submitted. A recognised provider or sandbox message
 *  still ends the solve, because that failure repeats and the case is a non-result either way. The
 *  switch is exhaustive, so a new status has to be decided here rather than falling into one of
 *  these answers. */
function turnContinues(
  status: BuiltTurnStatus,
  failure: string | null,
  consecutiveFailures: number,
): boolean {
  switch (status) {
    case "completed":
      return true;
    case "failed":
      return (
        consecutiveFailures < MAX_CONSECUTIVE_TURN_FAILURES && runtimeNonResultReason([failure]) === null
      );
    case "aborted":
      return false;
  }
}

async function requestTurnPermit(turn: number): Promise<void> {
  const permit = Promise.withResolvers<void>();
  turnPermits.set(turn, permit);
  send({ type: "turn_permit_request", turn });
  await permit.promise;
  turnPermits.delete(turn);
}

/** One prompted turn through the session, which retries transient provider errors and compacts
 *  between model calls itself. A completed turn contributes a runtime identity; a turn that did not
 *  complete appends the provider's or worker's own message to `errors` before the loop's marker. */
async function promptTurn(
  active: PiAgentSession,
  message: PiBuiltStart,
  context: { sessionId: string; prompt: string; errors: string[] },
): Promise<PromptedTurn> {
  const record = new PiPromptRecord(
    (event) => send({ type: "event", event }),
    () => active.messages,
  );
  activeRecord = record;
  const unsubscribe = active.subscribe(record.observe);
  let thrown: string | null = null;
  try {
    await active.prompt(context.prompt);
  } catch (error) {
    thrown = safeError(error);
  } finally {
    unsubscribe();
    activeRecord = null;
  }
  // The worker-wide tally a `done` frame reports, summed over the turns that settled.
  const calls = record.toolCalls();
  solveCalls.total += calls.total;
  solveCalls.failed += calls.failed;
  for (const [name, count] of Object.entries(calls.byName)) {
    solveCalls.byName[name] = (solveCalls.byName[name] ?? 0) + count;
  }
  const { last } = record;
  const status: BuiltTurnStatus = thrown === null ? settledStatus(last) : "failed";
  if (thrown !== null) context.errors.push(thrown);
  else if (last === undefined) context.errors.push("Pi Built worker completed without an assistant message");
  if (thrown === null && hasText(last?.errorMessage)) context.errors.push(safeError(last.errorMessage));
  return {
    status,
    identity:
      status === "completed" && last !== undefined
        ? piRuntimeIdentity(message.profile.provider, last, context.sessionId)
        : null,
    usage: piTurnUsage(record.usage),
    compactions: record.compactions,
  };
}

async function openWorker(message: PiBuiltStart): Promise<void> {
  if (session) throw new Error("Pi Built worker initialized twice");
  secret = credentialSecret(message.credential);
  const model = await servedModel(message);
  const sessionId = `pi-built-${runtimeProcess.pid}-${Date.now()}`;
  const active = openPiAgentSession({
    profile: message.profile,
    model,
    systemPrompt: message.contract.systemPrompt,
    tools: proxyTools(message),
    sessionId,
  });
  session = active;
  send({
    type: "ready",
    workerInstanceId: message.workerInstanceId,
    pid: runtimeProcess.pid,
    promptDigest: message.contract.promptDigest,
    toolSchemaDigest: message.contract.toolSchemaDigest,
    modelSelection: model.modelSelection,
  });
  const identities: RuntimeIdentities = [];
  const errors: string[] = [];
  let turns = 0;
  let consecutiveFailures = 0;
  // The cap counts the turns the solver was actually given, and a turn that did not complete gave
  // it nothing, so a case whose first turn fails does not spend its whole allowance on that turn.
  // Two failures in a row still end the solve, so retries can never outnumber the solving turns.
  // oxlint-disable-next-line eslint/no-unmodified-loop-condition -- `accepted` is set by the parent's `submit` result in the message handler below, which the rule cannot see from this loop.
  while (identities.length < message.maxTurns && !accepted) {
    turns += 1;
    currentTurn = turns;
    const errorsBefore = errors.length;
    const prompt = turns === 1 ? message.prompt : message.nudge;
    await requestTurnPermit(currentTurn);
    send({ type: "turn_start", turn: currentTurn, prompt });
    const turn = await promptTurn(active, message, { sessionId, prompt, errors });
    const { status, identity } = turn;
    if (identity !== null) identities.push(identity);
    const failure = status === "completed" ? null : (errors[errorsBefore] ?? null);
    if (status !== "completed") errors.push(`turn ${currentTurn} ${status}`);
    consecutiveFailures = status === "failed" ? consecutiveFailures + 1 : 0;
    send({
      type: "turn_end",
      turn: currentTurn,
      status,
      ...keyIfDefined("errorMessage", failure ?? undefined),
      ...keyIfDefined("usage", turn.usage),
      ...keysIf(turn.compactions.length > 0, () => ({ compactions: turn.compactions })),
      ...keyIfDefined("identity", identity ?? undefined),
    });
    if (!turnContinues(status, failure, consecutiveFailures)) break;
  }
  send({ type: "done", turns, errors, toolCalls: solveCalls });
}

async function handle(message: PiBuiltParentMessage): Promise<void> {
  if (message.type === "start") return openWorker(message);
  if (message.type === "turn_permit") {
    const permit = turnPermits.get(message.turn);
    if (permit === undefined) {
      throw new Error(`Pi Built worker received unknown turn permit ${String(message.turn)}`);
    }
    permit.resolve();
    return;
  }
  if (message.type === "close") {
    if (pending.size > 0) throw new Error("Pi Built worker closed with pending tool calls");
    send({ type: "closing" });
    setImmediate(() => runtimeProcess.exit(0));
    return;
  }
  const call = pending.get(message.id);
  if (!call) throw new Error(`Pi Built worker received unknown tool result ${message.id}`);
  pending.delete(message.id);
  if (message.ok && message.result) {
    if (message.result.terminate === true) accepted = true;
    call.resolve(message.result);
  } else {
    call.reject(new Error(message.error ?? "controller tool failed"));
  }
}

void attachJsonlLineReader(Bun.stdin.stream(), (line) => {
  try {
    const message = parseJsonAs<PiBuiltParentMessage>(line);
    void handle(message).catch((error) =>
      send({
        type: "fatal",
        kind: message.type === "start" ? "provider" : "protocol",
        error: safeError(error),
      }),
    );
  } catch {
    send({ type: "fatal", kind: "protocol", error: "Pi Built worker received malformed JSONL" });
  }
}).catch((error) => send({ type: "fatal", kind: "protocol", error: safeError(error) }));
