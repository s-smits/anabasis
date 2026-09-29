#!/usr/bin/env bun
/**
 * A Claude Code session as the thread state `watch-contract.ts check` reads, for a target that has
 * no Codex thread snapshot to summarise.
 *
 * A waiting session reads as a turn in progress, because it is one: the turn is held open on the
 * operator by a question or a permission prompt. The checker has no word for that, and a message
 * sent to the session meanwhile is queued unread until the operator answers, so `session.waitingFor`
 * is what tells the watcher to go to the operator instead.
 */
import { type ExitWith, exitWith, parseOrDie } from "#skills/main/cli.ts";
import { type ClaudeSession, readClaudeSession } from "#skills/main/session.ts";

const USAGE = [
  "Usage:",
  "  session-state.ts <claude config dir> <session id>",
  "",
  "Prints the session as watch-contract.ts check reads thread state, with the registry record,",
  "the transcript and its quiet seconds under `session`.",
].join("\n");

/**
 * Only an ended process or a recorded idle says the turn is over. A live session whose record holds
 * no status the checker knows, or a session no record names, is not proof of a finished turn, so its
 * turn reads as unknown and the checker inspects it rather than letting it stop.
 */
export function sessionThreadState(session: ClaudeSession) {
  const open = session.live && (session.status === "busy" || session.status === "waiting");
  const ended = session.pid !== null && !session.live;
  const idle = session.live && session.status === "idle";
  return {
    thread: {
      id: session.sessionId,
      hostId: null,
      status: open ? "active" : session.live ? "idle" : "notLoaded",
    },
    latestTurn: { status: open ? "inProgress" : ended || idle ? "completed" : "unknown" },
    session,
  };
}

if (import.meta.main) {
  const die: ExitWith = exitWith("session-state");
  const { flags, positionals } = parseOrDie(die, { flags: ["help"], positionals: 2 });
  if (flags.has("help")) {
    console.log(USAGE);
  } else {
    const [configDir = "", sessionId = ""] = positionals;
    console.log(JSON.stringify(sessionThreadState(readClaudeSession(configDir, sessionId)), null, 2));
  }
}
