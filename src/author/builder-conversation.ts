/**
 * One Builder conversation per controller run, with each round as its next prompt.
 *
 * This is pi's agent practice. One session holds the transcript, and before each prompt the caller
 * sets the tools and the system prompt that prompt runs with (`HostSession.configure`). The
 * conversation continues for as long as the run has something for it to do, and a round is one such
 * prompt: the Builder builds and submits, the controller then measures, reviews and advises while
 * the session waits rather than stops, and the next round's facts arrive as its next user message.
 * Nothing the Builder read, installed, tried or decided is lost between rounds, and the session's
 * own compaction keeps the transcript inside the model's window.
 *
 * The round's workspace, gates, recorder and submit state all live in its tools, so continuing the
 * session is only a matter of configuring it with the new round's roster. A round whose turn the
 * provider failed after its retries keeps the session too, as a Codex goal survives a failed turn.
 * A round that threw anything else leaves the session in a state nothing has classified, so the
 * next round opens a fresh one, which reads the Builder's notes (builder-memory.ts) exactly as a
 * first round does; a process restart loses the conversation the same way. Nothing here is durable,
 * so nothing here can be damaged.
 */
import type { HostSession, PiTool } from "../backends/pi-session.ts";

/** How a round ended; the next round of the same conversation opens by saying so. */
export type RoundEnding =
  | "accepted"
  | "terminal-refusal"
  | "turn-bound"
  | "no-progress"
  | "budget-limited"
  | "turn-non-result";

/** The round a continued conversation last worked: where, and how it ended. */
export type PreviousRound = { readonly workspace: string; readonly ending: RoundEnding };

/** One round's hold on the conversation. */
export interface ConversationRound {
  readonly session: HostSession;
  /** The workspace the session was opened in, which the transcript pointer names. */
  readonly openedIn: string;
  /** Null when this round opened the session. */
  readonly previous: PreviousRound | null;
  /** An ending keeps the session for the next round; null closes it. */
  end(ending: RoundEnding | null): Promise<void>;
}

/** Open a session on these tools and this system prompt. */
export type OpenSession = (tools: readonly PiTool[], systemPrompt: string) => Promise<HostSession>;

/** A session between rounds, where it was opened and the round that last used it. */
type Waiting = { session: HostSession; openedIn: string; previous: PreviousRound };

export class BuilderConversation {
  private waiting: Waiting | null = null;
  /** Set when the run settles; a round still in flight then closes its session when it ends. */
  private closed = false;

  /** Begin a round: continue the waiting session on this round's tools and framing, or open one. */
  async begin(
    tools: readonly PiTool[],
    systemPrompt: string,
    workspace: string,
    open: OpenSession,
  ): Promise<ConversationRound> {
    const held = this.waiting;
    this.waiting = null;
    if (held !== null) {
      held.session.configure(tools, systemPrompt);
      return this.round(held, workspace);
    }
    const session = await open(tools, systemPrompt);
    return this.round({ session, openedIn: workspace, previous: null }, workspace);
  }

  /** Close the waiting session when the run settles. Best effort: the run is already closing. */
  async close(): Promise<void> {
    const held = this.waiting;
    this.closed = true;
    this.waiting = null;
    await held?.session.dispose().catch(() => undefined);
  }

  private round(
    held: Omit<Waiting, "previous"> & { previous: PreviousRound | null },
    workspace: string,
  ): ConversationRound {
    const { session, openedIn, previous } = held;
    return {
      session,
      openedIn,
      previous,
      end: async (ending) => {
        if (ending === null || this.closed) return session.dispose();
        this.waiting = { session, openedIn, previous: { workspace, ending } };
      },
    };
  }
}
