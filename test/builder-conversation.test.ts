/**
 * One Builder conversation spans the run. A round that settles leaves its session open and the next
 * round configures it rather than opening a new one, which is how the Builder's context survives
 * the measuring and reviewing that happen between rounds.
 *
 * Everything else here is about giving that session up cleanly, because a session held after its
 * round is a conversation the next round would inherit without meaning to. A round that ended
 * without an ending is disposed so the next one opens fresh; the waiting session is disposed when
 * the run closes; a round still in flight at close is disposed when it ends, whatever its ending;
 * and a dispose that throws does not take the close down with it.
 */
import { describe, expect, it } from "bun:test";
import { BuilderConversation, type OpenSession } from "../src/author/builder-conversation.ts";
import type { HostSession, PiTool } from "../src/backends/pi-session.ts";
import { required, scriptedSession, toolDouble } from "./helpers/doubles.ts";

type Recorded = {
  opened: Array<{ tools: readonly PiTool[]; systemPrompt: string }>;
  configured: Array<{ session: number; tools: readonly PiTool[]; systemPrompt: string }>;
  disposed: number[];
  sessions: HostSession[];
};

/** The workspaces three successive rounds author in. */
const ONE = "/runs/one";
const TWO = "/runs/two";
const THREE = "/runs/three";

/** An opener whose sessions record every configure and dispose against their own ordinal. */
function recordingOpener(failDispose = false) {
  const recorded: Recorded = { opened: [], configured: [], disposed: [], sessions: [] };
  const open: OpenSession = async (tools, systemPrompt) => {
    recorded.opened.push({ tools, systemPrompt });
    const ordinal = recorded.sessions.length;
    const session = scriptedSession(
      async () => ({ status: "completed", assistantText: "worked" }),
      () => {
        recorded.disposed.push(ordinal);
        if (failDispose) throw new Error("dispose failed");
      },
      (next, framing) => recorded.configured.push({ session: ordinal, tools: next, systemPrompt: framing }),
    );
    recorded.sessions.push(session);
    return session;
  };
  return { open, recorded };
}

const tool = (name: string) => toolDouble({ name, execute: async () => ({ content: [] }) });
const FIRST = [tool("read")];
const SECOND = [tool("read"), tool("submit")];

describe("BuilderConversation", () => {
  it("opens the first round's session on that round's tools and framing", async () => {
    const { open, recorded } = recordingOpener();
    const conversation = new BuilderConversation();
    const round = await conversation.begin(FIRST, "first framing", ONE, open);

    expect(recorded.opened).toEqual([{ tools: FIRST, systemPrompt: "first framing" }]);
    expect(round.session).toBe(required(recorded.sessions[0], "the opened session"));
    expect(round.openedIn).toBe(ONE);
    expect(round.previous).toBeNull();
    expect(recorded.configured).toEqual([]);
  });

  it("continues a kept session by configuring it, naming the round before and where it opened", async () => {
    const { open, recorded } = recordingOpener();
    const conversation = new BuilderConversation();
    const first = await conversation.begin(FIRST, "first framing", ONE, open);
    await first.end("accepted");
    expect(recorded.disposed).toEqual([]);

    const second = await conversation.begin(SECOND, "second framing", TWO, open);
    expect(recorded.opened).toHaveLength(1);
    expect(second.session).toBe(first.session);
    expect(recorded.configured).toEqual([{ session: 0, tools: SECOND, systemPrompt: "second framing" }]);
    expect(second.openedIn).toBe(ONE);
    expect(second.previous).toEqual({ workspace: ONE, ending: "accepted" });

    await second.end("turn-bound");
    const third = await conversation.begin(FIRST, "third framing", THREE, open);
    expect(third.session).toBe(first.session);
    expect(third.openedIn).toBe(ONE);
    expect(third.previous).toEqual({ workspace: TWO, ending: "turn-bound" });
    expect(recorded.opened).toHaveLength(1);
  });

  it("disposes a round ended without an ending, so the next round opens a fresh session", async () => {
    const { open, recorded } = recordingOpener();
    const conversation = new BuilderConversation();
    const first = await conversation.begin(FIRST, "first framing", ONE, open);
    await first.end(null);
    expect(recorded.disposed).toEqual([0]);

    const second = await conversation.begin(SECOND, "second framing", TWO, open);
    expect(recorded.opened).toEqual([
      { tools: FIRST, systemPrompt: "first framing" },
      { tools: SECOND, systemPrompt: "second framing" },
    ]);
    expect(second.session).not.toBe(first.session);
    expect(second.openedIn).toBe(TWO);
    expect(second.previous).toBeNull();
    expect(recorded.configured).toEqual([]);
  });

  it("disposes the waiting session when the run closes", async () => {
    const { open, recorded } = recordingOpener();
    const conversation = new BuilderConversation();
    const round = await conversation.begin(FIRST, "framing", ONE, open);
    await round.end("terminal-refusal");
    await conversation.close();
    expect(recorded.disposed).toEqual([0]);

    // Nothing waits any more: a later round opens its own session rather than reviving the closed one.
    const later = await conversation.begin(FIRST, "framing", TWO, open);
    expect(later.session).not.toBe(round.session);
    expect(later.previous).toBeNull();
  });

  it("disposes a round still in flight at close when that round ends, whatever its ending", async () => {
    const { open, recorded } = recordingOpener();
    const conversation = new BuilderConversation();
    const round = await conversation.begin(FIRST, "framing", ONE, open);
    await conversation.close();
    expect(recorded.disposed).toEqual([]);

    await round.end("accepted");
    expect(recorded.disposed).toEqual([0]);
    const next = await conversation.begin(SECOND, "framing", TWO, open);
    expect(next.session).not.toBe(round.session);
    expect(recorded.configured).toEqual([]);
  });

  it("closes without throwing when disposing the waiting session fails", async () => {
    const { open, recorded } = recordingOpener(true);
    const conversation = new BuilderConversation();
    const round = await conversation.begin(FIRST, "framing", ONE, open);
    await round.end("accepted");

    await conversation.close();
    expect(recorded.disposed).toEqual([0]);
  });
});
