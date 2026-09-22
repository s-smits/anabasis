/**
 * The one pi session every model slot runs on. The Builder and the review slot open it here on the
 * host; the Built worker opens the same PiAgentSession in its confined child (pi-built-child.ts).
 *
 * PiAgentSession is pi coding-agent's own prompt loop (vendor/pi-agent-session): it retries
 * transient provider errors and compacts the context between model calls, so no caller keeps a
 * second retry or compaction rule for a single prompt. A tool result that carries `terminate` ends
 * the prompt after its turn on every slot (`endOnTerminate`). Each harness still owns what
 * surrounds the prompt: its tools, its system prompt, its turn loop and its stop rules.
 *
 * A host session is never stopped between prompts. The Builder's session stays open while the
 * controller measures, reviews and gates, and the next round continues the same conversation with
 * whatever tools and framing that round needs (`configure`).
 */
import { mkdtemp, rm } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { join } from "../meta/path.ts";
import {
  Agent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  DEFAULT_COMPACTION_SETTINGS,
  type FinishTurn,
  convertToLlm,
  estimateContextTokens,
} from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  type RetryPolicy,
  type SystemMessage,
  type Usage,
  cleanupSessionResources,
  contentText,
  toToolDeclaration,
} from "@earendil-works/pi-ai";
import { PiAgentSession, type PiAgentSessionEvent } from "../../vendor/pi-agent-session/agent-session.ts";
import { isRecord } from "../meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../meta/optional-key.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hasText } from "../meta/text.ts";
import {
  type AgentSession,
  type AgentTurnEvent,
  type AgentTurnResult,
  CONTEXT_COMPACT_WINDOW,
  type CompactionRecord,
  type RunTurnOptions,
} from "./backend-types.ts";
import { PI_AGENT_RUNTIME } from "./model-selection.ts";
import {
  type PiModel,
  type PiModelHooks,
  type PiProfile,
  type PiSlotRuntime,
  claudeCliExecutable,
  claudeCompacts,
  fakePiModel,
  openPiModel,
} from "./pi-providers.ts";
import { piTurnUsage } from "./pi-usage.ts";

/** Pi coding-agent's default retry of transient provider errors: three attempts at 2, 4 and 8 s. */
const PI_RETRY: RetryPolicy = { enabled: true, maxRetries: 3, baseDelayMs: 2_000 };

/** A turn with no cap of its own still ends, so a stalled provider cannot hold its caller forever. */
const DEFAULT_TURN_CAP_MS = 3_600_000;

/** How long an interrupted prompt may take to settle before the turn reports it aborted anyway. */
const ABORT_SETTLE_MS = 2_000;

/** A tool result preview: enough of an error for trace-capture's `resultExcerpt`, a line otherwise. */
const ERROR_PREVIEW_CHARS = 2_000;
const RESULT_PREVIEW_CHARS = 200;

/** A tool any slot may register: the Builder's file tools, a review reader's, the Judge's verdict. */
export type PiTool = AgentTool | AgentTool<never>;

/** A host slot's session: the shared turn contract plus a new roster and framing for the next
 *  prompt, which keeps the conversation it has. */
export interface HostSession extends AgentSession {
  /** The id every turn's runtime identity names, fixed when the session opens. */
  readonly sessionId: string;
  configure(tools: readonly PiTool[], systemPrompt: string): void;
}

/** The system-prompt section holding a host session's framing; a later round replaces it by name. */
const FRAMING_SECTION = "framing";

interface HostSessionInput {
  slot: PiSlotRuntime;
  tools: readonly PiTool[];
  systemPrompt: string;
  /** Where the Claude CLI works: the Builder's workspace, else this process's directory. */
  cwd?: string;
  /** Scripted answers in place of the provider, for tests. */
  fakeResponses?: AssistantMessage[];
}

/**
 * A short, whitespace-collapsed preview of a tool result's text, for trace logging only. An
 * overlong preview keeps both ends, because a failing command reports its error last.
 */
function previewText(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  if (limit <= 3) return collapsed.slice(0, limit);
  const head = Math.ceil((limit - 3) / 2);
  return `${collapsed.slice(0, head)} … ${collapsed.slice(collapsed.length - (limit - 3 - head))}`;
}

/**
 * The retry and compaction policy for one slot. Every slot compacts at the shared window: through
 * this session, unless a Claude slot left it to the CLI (`claude-ss`, the default).
 */
export function piSessionPolicy(profile: PiProfile) {
  return {
    retry: PI_RETRY,
    compaction: {
      ...DEFAULT_COMPACTION_SETTINGS,
      enabled: !claudeCompacts(profile),
      window: CONTEXT_COMPACT_WINDOW,
    },
  };
}

/**
 * End a prompt after the turn in which any tool result carried `terminate`: the controller already
 * holds the answer. The turn's other calls still return, and no further provider request follows
 * (pi alone ends only a batch whose every call terminates). On the Claude CLI one query spans the
 * whole prompt and would wait for tool results nothing delivers, so ending also aborts that query.
 */
function endOnTerminate(agent: Agent, transport: PiProfile["transport"]): FinishTurn {
  let terminated = false;
  agent.subscribe((event) => {
    if (event.type !== "tool_execution_end") return;
    const result =
      /* SAFETY: pi emits the executed tool's own AgentToolResult on tool_execution_end; only its terminate flag is read. */ event.result as AgentToolResult<unknown>;
    if (result.terminate === true) terminated = true;
  });
  return ({ message }) => {
    // Error and aborted responses end the run anyway, and pi ignores a decision about them.
    const ends = terminated && message.stopReason !== "error" && message.stopReason !== "aborted";
    terminated = false;
    if (!ends) return undefined;
    if (transport === "claude") agent.abort();
    return { action: "end" };
  };
}

/** One pi Agent over the served model, wrapped in the session loop for its transport. A caller
 *  that seeds its own leading system message passes it as `messages` and an empty prompt. */
export function openPiAgentSession(input: {
  profile: PiProfile;
  model: PiModel;
  systemPrompt: string;
  tools: readonly PiTool[];
  sessionId: string;
  messages?: AgentMessage[];
}): PiAgentSession {
  const agent = new Agent({
    initialState: {
      systemPrompt: input.systemPrompt,
      model: input.model.model,
      thinkingLevel: input.profile.thinkingLevel,
      tools: [...input.tools],
      ...keyIfDefined("messages", input.messages),
    },
    streamFn: input.model.streamFn,
    // Pi's converter sends the compaction summary; the bare default drops that role.
    convertToLlm,
    toolExecution: "sequential",
    sessionId: input.sessionId,
  });
  agent.finishTurn = endOnTerminate(agent, input.profile.transport);
  const session = new PiAgentSession({ agent, ...piSessionPolicy(input.profile) });
  const { historyRewritten } = input.model;
  if (historyRewritten !== undefined) {
    // A pi compaction replaced the history a Claude CLI session holds; its next query takes the new one.
    session.subscribe((event) => {
      if (event.type === "compaction_end" && event.result !== undefined) historyRewritten();
    });
  }
  return session;
}

/** The provider identity an assistant message attests. Pi's requested model is configuration;
 *  only a provider-reported model says what served. */
export function piRuntimeIdentity(
  provider: PiProfile["provider"],
  message: AssistantMessage,
  sessionId: string,
): NonNullable<AgentTurnResult["runtimeIdentity"]> {
  return {
    schema: "runtime-model-identity/v2",
    agentRuntime: { ...PI_AGENT_RUNTIME, sessionId },
    provider: {
      id: provider,
      model: message.responseModel ?? null,
      resultId: message.responseId ?? null,
      nativeSessionId: null,
    },
  };
}

/**
 * What one prompt did, collected from the session's events and forwarded as shared turn events:
 * streamed text, whole messages and reasoning, tool calls, usage and compactions. The Claude CLI
 * answers its builtin search and compacts inside its own loop, so those two arrive through the
 * model hooks instead of the event stream.
 */
export class PiPromptRecord {
  readonly usage: Usage[] = [];
  readonly compactions: CompactionRecord[] = [];
  readonly texts: string[] = [];
  readonly byName: Record<string, number> = {};
  readonly failedByName: Record<string, number> = {};
  /** The last assistant message this prompt ended; a retried attempt is replaced by its retry. */
  last: AssistantMessage | undefined;
  /** The last assistant message that names a served model or response id, so a stopped turn
   *  attests what answered before it. */
  served: AssistantMessage | undefined;
  private compactionEstimate = 0;
  /** The bridge reports each builtin call twice; the trace records it once. */
  private readonly builtins = new Set<string>();

  constructor(
    private readonly emit: (event: AgentTurnEvent) => void,
    private readonly messages: () => readonly AgentMessage[],
  ) {}

  readonly observe = (event: PiAgentSessionEvent): void => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      this.emit({ type: "assistant_text", delta: event.assistantMessageEvent.delta });
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      this.assistantEnded(event.message);
    } else if (event.type === "tool_execution_start") {
      this.tally(this.byName, event.toolName);
      this.emit({
        type: "tool_started",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: isRecord(event.args) ? event.args : {},
      });
    } else if (event.type === "tool_execution_end") {
      this.toolEnded(event);
    } else if (event.type === "compaction_start") {
      this.compactionEstimate = estimateContextTokens([...this.messages()]).tokens;
    } else if (event.type === "compaction_end") {
      this.compactions.push({
        tokensBefore: event.result?.tokensBefore ?? this.compactionEstimate,
        compacted: event.result !== undefined,
      });
      if (event.result?.usage !== undefined) this.usage.push(event.result.usage);
    }
  };

  /** The Claude CLI compacted its own context at the shared window. */
  readonly cliCompaction = (tokensBefore: number): void => {
    this.compactions.push({ tokensBefore, compacted: true });
  };

  /** A CLI-owned builtin never reaches pi's tool events. The host sees the call but not its result,
   *  so it is recorded as a started-and-ended call without error. */
  readonly builtinTool = (call: { name: string; id: string; input: unknown }): void => {
    if (this.builtins.has(call.id)) return;
    this.builtins.add(call.id);
    this.tally(this.byName, call.name);
    const args = isRecord(call.input) ? call.input : {};
    this.emit({ type: "tool_started", toolName: call.name, toolCallId: call.id, args });
    this.emit({ type: "tool_ended", toolName: call.name, toolCallId: call.id, isError: false });
  };

  toolCalls(): NonNullable<AgentTurnResult["toolCalls"]> {
    const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      byName: { ...this.byName },
      failedByName: { ...this.failedByName },
      failed: sum(this.failedByName),
      total: sum(this.byName),
    };
  }

  private assistantEnded(message: AssistantMessage): void {
    this.last = message;
    if (message.responseModel !== undefined || message.responseId !== undefined) this.served = message;
    this.usage.push(message.usage);
    for (const block of message.content) {
      if (block.type === "thinking" && hasText(block.thinking)) {
        this.emit({ type: "reasoning_text", text: block.thinking });
      }
    }
    const text = contentText(message.content);
    if (!hasText(text)) return;
    this.texts.push(text);
    this.emit({ type: "message_text", text });
  }

  private toolEnded(event: Extract<PiAgentSessionEvent, { type: "tool_execution_end" }>): void {
    if (event.isError) this.tally(this.failedByName, event.toolName);
    const result =
      /* SAFETY: pi emits the executed tool's own AgentToolResult on tool_execution_end; only its content is read. */ event.result as AgentToolResult<unknown>;
    const bound = event.isError ? ERROR_PREVIEW_CHARS : RESULT_PREVIEW_CHARS;
    const preview = previewText(contentText(result.content), bound);
    this.emit({
      type: "tool_ended",
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      isError: event.isError,
      ...keyIfDefined("resultPreview", hasText(preview) ? preview : undefined),
    });
  }

  private tally(counts: Record<string, number>, name: string): void {
    counts[name] = (counts[name] ?? 0) + 1;
  }
}

function framingMessage(
  systemPrompt: string,
  tools: readonly PiTool[] | null,
  timestamp: number,
): SystemMessage {
  return {
    role: "system",
    content: "",
    sections: { [FRAMING_SECTION]: systemPrompt },
    ...keysIf(tools !== null && tools.length > 0, () => ({
      toolsAdded: (tools ?? []).map(toToolDeclaration),
    })),
    timestamp,
  };
}

/** How a prompt settled, read from its last assistant message after the session's own retries. */
export function settledStatus(last: AssistantMessage | undefined): AgentTurnResult["status"] {
  if (last === undefined || last.stopReason === "error") return "failed";
  return last.stopReason === "aborted" ? "aborted" : "completed";
}

/** The served model and, for the Claude CLI, the private config directory it keeps its state in, so
 *  the operator's own settings, memory and hooks never reach a slot. */
async function hostModel(input: HostSessionInput, hooks: PiModelHooks) {
  const { profile } = input.slot;
  if (input.fakeResponses !== undefined) {
    return { model: fakePiModel(profile, input.fakeResponses), configDir: null };
  }
  if (profile.transport !== "claude") {
    return { model: await openPiModel(profile, input.slot.auth, null, hooks), configDir: null };
  }
  const configDir = await mkdtemp(join(tmpdir(), "ana-claude-cli-"));
  try {
    const cli = {
      cliPath: claudeCliExecutable(),
      configDir,
      baseEnv: Bun.env,
      ...keyIfDefined("cwd", input.cwd),
    };
    return { model: await openPiModel(profile, input.slot.auth, cli, hooks), configDir };
  } catch (error) {
    await rm(configDir, { recursive: true, force: true });
    throw error;
  }
}

/** Open one host slot's session over the shared provider layer. */
export async function openHostSession(input: HostSessionInput): Promise<HostSession> {
  const { profile } = input.slot;
  let active: PiPromptRecord | null = null;
  const served = await hostModel(input, {
    onCompaction: (tokensBefore) => active?.cliCompaction(tokensBefore),
    onBuiltinTool: (call) => active?.builtinTool(call),
  });
  const sessionId = `pi-${crypto.randomUUID()}`;
  const session = openPiAgentSession({
    profile,
    model: served.model,
    systemPrompt: "",
    tools: input.tools,
    sessionId,
    messages: [framingMessage(input.systemPrompt, input.tools, 0)],
  });

  async function runTurn(options: RunTurnOptions): Promise<AgentTurnResult> {
    if (options.signal?.aborted === true) {
      return { status: "aborted", errorMessages: ["the caller cancelled the turn before it started"] };
    }
    const emit = (event: AgentTurnEvent) => options.onEvent?.(event);
    const record = new PiPromptRecord(emit, () => session.messages);
    active = record;
    const unsubscribe = session.subscribe(record.observe);
    const interrupted = Promise.withResolvers<void>();
    let interrupt: string | null = null;
    const stop = (reason: string) => {
      interrupt ??= reason;
      interrupted.resolve();
      session.abort().catch(() => undefined);
    };
    const capMs =
      options.turnTimeoutMs !== undefined && options.turnTimeoutMs > 0
        ? options.turnTimeoutMs
        : DEFAULT_TURN_CAP_MS;
    const cap = setTimeout(() => stop(`the turn reached its ${String(capMs)} ms cap`), capMs);
    const cancel = () => stop("the caller cancelled the turn");
    options.signal?.addEventListener("abort", cancel, { once: true });
    let thrown: string | null = null;
    emit({ type: "turn_started" });
    const run = session.prompt(options.prompt).catch((error: unknown) => {
      thrown = errorMessage(error);
    });
    try {
      await Promise.race([
        run,
        interrupted.promise.then(() => Promise.race([run, Bun.sleep(ABORT_SETTLE_MS)])),
      ]);
    } finally {
      clearTimeout(cap);
      options.signal?.removeEventListener("abort", cancel);
      unsubscribe();
      active = null;
    }
    return finishTurn(record, { interrupt, thrown, emit, sessionId, provider: profile.provider });
  }

  return {
    backend: profile.transport,
    sessionId,
    runTurn,
    // Pi announces a changed roster to the model itself; a changed framing replaces its section.
    configure(tools, systemPrompt) {
      session.agent.state.tools = [...tools];
      if (systemPrompt === session.systemPrompt) return;
      session.agent.state.messages = [...session.messages, framingMessage(systemPrompt, null, Date.now())];
    },
    async dispose() {
      session.dispose();
      // Release the codex transport's WebSocket and idle timer so they do not hold the process open.
      cleanupSessionResources(sessionId);
      if (served.configDir !== null) await rm(served.configDir, { recursive: true, force: true });
    },
  };
}

/** The turn's one terminal event and its result. An interrupt decides the status; otherwise the
 *  last assistant message does, after the session's own retries. */
function finishTurn(
  record: PiPromptRecord,
  end: {
    interrupt: string | null;
    thrown: string | null;
    emit: (event: AgentTurnEvent) => void;
    sessionId: string;
    provider: PiProfile["provider"];
  },
): AgentTurnResult {
  const { last } = record;
  let status = settledStatus(last);
  if (end.thrown !== null) status = "failed";
  if (end.interrupt !== null) status = "aborted";
  const attested = status === "completed" ? last : record.served;
  const errors = [end.interrupt, end.thrown, last?.errorMessage].filter((text) => hasText(text));
  if (status === "failed" && errors.length === 0) {
    errors.push("the prompt ended without an assistant message");
  }
  const usage = piTurnUsage(record.usage);
  if (status === "failed") {
    end.emit({ type: "turn_failed", errorMessage: errors.join("; "), ...keyIfDefined("usage", usage) });
  } else {
    end.emit({
      type: "turn_ended",
      stopReason: status === "aborted" ? "aborted" : (last?.stopReason ?? "stop"),
      ...keyIfDefined("errorMessage", errors.length > 0 ? errors.join("; ") : undefined),
      ...keyIfDefined("usage", usage),
      ...keysIf(record.compactions.length > 0, () => ({ compactions: [...record.compactions] })),
    });
  }
  return {
    status,
    stopReason: last?.stopReason ?? null,
    ...keyIfDefined("assistantText", record.texts.length > 0 ? record.texts.join("\n") : undefined),
    ...keysIf(errors.length > 0, () => ({ errorMessages: errors })),
    toolCalls: record.toolCalls(),
    ...keysIf(record.compactions.length > 0, () => ({ compactions: [...record.compactions] })),
    ...keysIf(attested !== undefined, () => ({
      runtimeIdentity: piRuntimeIdentity(
        end.provider,
        /* SAFETY: keysIf runs only when attested !== undefined. */ attested as AssistantMessage,
        end.sessionId,
      ),
    })),
  };
}
