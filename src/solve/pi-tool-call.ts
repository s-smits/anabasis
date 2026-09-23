import type {
  AgentHarnessTool,
  AgentHarnessToolInvocation,
  AgentToolResult,
  ExecutionToolContext,
} from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/pi-agent-core/harness/context";
import type { TSchema } from "typebox";

/** How one tool call reaches the host: the controller's cancellation, the hook the caller wants
 *  partial results on, and the environment the tool actually runs in. */
type PiToolCall<D> = {
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: ((result: AgentToolResult<D>) => void) | undefined;
  readonly environment: ExecutionToolContext;
};

// Anabasis owns tool-call evidence and does not use Pi's durable AgentHarness session. The native
// read, write, edit and bash tools consult no invocation metadata, so this refuses if a future tool
// does, rather than inventing a durable turn identity or a replay memo for it to read.
function noHarnessSession(): never {
  throw new Error("Anabasis's Pi tool adapter has no durable AgentHarness session");
}
const invocation: AgentHarnessToolInvocation = {
  get invocationId() {
    return noHarnessSession();
  },
  get operationId() {
    return noHarnessSession();
  },
  get turnId() {
    return noHarnessSession();
  },
  getMemo: async () => noHarnessSession(),
  setMemo: async () => noHarnessSession(),
};

/** Bind Pi's native tools to Anabasis's existing AgentTool cancellation and execution environment. */
export function executePiTool<T extends TSchema, D>(
  tool: AgentHarnessTool<ExecutionToolContext, T, D>,
  id: string,
  params: Parameters<AgentHarnessTool<ExecutionToolContext, T, D>["execute"]>[1],
  call: PiToolCall<D>,
): Promise<AgentToolResult<D>> {
  const { signal, onUpdate, environment } = call;
  const context = signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT;
  return tool.execute(
    id,
    params,
    (result) => {
      // Native bash marks periodic output snapshots for Pi's optional recovery journal. Anabasis
      // owns persistence outside this adapter, so the snapshot stays an ordinary progress update.
      onUpdate?.(result);
    },
    environment,
    invocation,
    context,
  );
}
