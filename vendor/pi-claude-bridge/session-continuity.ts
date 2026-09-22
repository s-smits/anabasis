// Which Claude Code session the next pi turn resumes, and what has to be rewritten first.
//
// Pi hands the provider its whole message history on every turn. The CLI, meanwhile,
// keeps a session file it appends to. Continuity is the question of whether those two
// still describe the same conversation: when they do, the turn resumes the session and
// the prompt cache stays warm; when they do not, the file is rewritten from pi's history
// before the turn starts. Resuming a session that drifted replays a conversation that did
// not happen, and the CLI reports nothing.
//
// Injecting only the missing messages was tried and abandoned: it creates a branch that
// `--resume` does not follow. A whole rewrite at the same path is simpler and correct.

import { type Message, createSession, deleteSession, repairToolPairing } from "cc-session-io";
import type { Message as PiMessage } from "@earendil-works/pi-ai";

import { convertPiMessages, messageContentToText } from "./convert.js";
import { capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import { hasText } from "../../src/meta/text.ts";

/** What the last turn left behind, as far as this bridge knows. */
type SessionState = {
  readonly sessionId: string;
  /** How many of pi's messages the session file already holds. */
  readonly cursor: number;
  /** The project directory the session is filed under. */
  readonly cwd: string;
};

export type SyncResult =
  | {
      /** The session this turn resumes, or null when it starts one of its own. */
      readonly sessionId: string | null;
      /** This history is not the session's continuation, so the session was left alone. */
      readonly held: boolean;
      readonly forkOf?: undefined;
      readonly carried?: undefined;
    }
  | {
      readonly sessionId: string;
      readonly held: false;
      /** v4 boundary: the session whose content the CLI resumes under `sessionId`, leaving its file alone. */
      readonly forkOf: string;
      /** v4 boundary: what that session never received, as the text the prompt opens with. */
      readonly carried: string | undefined;
    };

export type SessionContinuity = {
  sync: (
    priorMessages: readonly PiMessage[],
    cwd: string,
    customToolNameToSdk?: Map<string, string>,
    modelId?: string,
  ) => SyncResult;
  state: () => SessionState | null;
  /** The turn settled: this is the session it ended in, and how much of pi it holds. */
  settled: (sessionId: string, cursor: number, cwd: string) => void;
  /** The CLI wrote these messages into the session itself; only the count moves. */
  advancedTo: (cursor: number) => void;
  /** Something pi holds never reached the session — a steer, or a history pi compacted. */
  rebuildNextTurn: () => void;
  /** The turn was aborted. The stopped subprocess may still be writing to its file. */
  aborted: () => void;
  /** The turn failed. The file is still ours to overwrite. */
  failed: () => void;
};

/** Where the session file is written and what the CLI must find in it on the next resume. */
type SessionWrite = {
  readonly cwd: string;
  readonly rotation: "rotate" | "keep";
  readonly customToolNameToSdk?: Map<string, string> | undefined;
  readonly modelId?: string | undefined;
  /** v4 boundary: the CLI config directory the session files live under, the CLI's default when absent. */
  readonly claudeDir: string | undefined;
  /** v4 boundary: the most tokens a rewrite may carry, unbounded when absent. */
  readonly budget: number | undefined;
};

/** Four bytes to a token: the estimate the CLI itself makes for text it holds no usage for. */
const BYTES_PER_TOKEN = 4;

/**
 * v4 boundary: the newest messages that fit `budget` tokens, behind one note saying how many were
 * left out. When the CLI compacts its own context, pi never compacts, so pi's history grows past any
 * window while the context the model actually saw stayed bounded. A rewrite imports zero usage, so
 * the CLI cannot compact before the first request, and a whole history over the model's window
 * fails that request, its retries and every later rewrite. In the live run of 2026-09-22 an abort
 * after two CLI compactions rewrote 48 of pi's entries, about 36k tokens, into the next session.
 */
function withinBudget(messages: Message[], budget: number | undefined): Message[] {
  if (budget === undefined) return messages;
  let start = messages.length;
  for (let tokens = 0; start > 0; start -= 1) {
    tokens += (capturedJsonStringify(messages[start - 1]) ?? "").length / BYTES_PER_TOKEN;
    if (tokens > budget) break;
  }
  if (start === 0) return messages;
  // The newest message stays even when it alone is over the budget: it is what the turn answers.
  const left = Math.min(start, messages.length - 1);
  const note = `[${left} earlier messages of this conversation were left out when its session was rewritten to fit the context window.]`;
  return [{ role: "user", content: note }, ...repairToolPairing(messages.slice(left))];
}

function writeSession(
  state: SessionState | null,
  priorMessages: readonly PiMessage[],
  opening: SessionWrite,
): SessionState {
  const { cwd, rotation, customToolNameToSdk, modelId, claudeDir: dir, budget } = opening;
  // Keeping the id across rewrites keeps log correlation stable, and the CLI re-reads
  // the file on every resume, so it never holds a stale one. It is given up only when
  // another writer may still own the path.
  const keptId = state !== null && rotation === "keep" && state.cwd === cwd ? state.sessionId : null;
  if (keptId !== null) deleteSession(keptId, cwd, dir);
  const session = createSession({
    projectPath: cwd,
    ...(dir === undefined ? {} : { claudeDir: dir }), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
    ...(keptId === null ? {} : { sessionId: keptId }), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
    ...(hasText(modelId) ? { model: modelId } : {}), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
  });
  // Pairing is repaired before import so a tool call the conversion could not carry
  // does not leave its result behind naming nothing.
  const repaired = withinBudget(
    repairToolPairing(convertPiMessages(priorMessages, customToolNameToSdk)),
    budget,
  );
  if (repaired.length > 0) session.importMessages(repaired);
  session.save();
  return { sessionId: session.sessionId, cursor: priorMessages.length, cwd };
}

/** `budget` bounds every rewrite in tokens; the bridge passes the CLI's compaction window, since only
 *  a history the CLI compacts can outgrow it. */
export function sessionContinuity(claudeDir?: string, budget?: number): SessionContinuity {
  let state: SessionState | null = null;
  // Pi rewrote its own history, or a turn left the file in a state we cannot append to.
  let rebuildPending = false;
  // ...and the previous subprocess may still be flushing into that file, so the rewrite
  // takes a fresh id and leaves the old one where the late write can land harmlessly. Without
  // a rewrite, the CLI forks that file to the fresh id itself.
  let rotatePending = false;

  const mark = (rebuild: boolean, rotate: boolean): void => {
    if (state === null) return;
    rebuildPending = rebuildPending || rebuild;
    rotatePending = rotatePending || rotate;
  };

  return {
    state: () => state,

    sync: (priorMessages, cwd, customToolNameToSdk, modelId) => {
      const held = state;
      // A session filed under another directory is not this turn's history: its file
      // lives under a hash of the project path, and resuming it asks the CLI for a
      // conversation that is not there.
      const continues = held !== null && !rebuildPending && held.cwd === cwd;
      if (continues && priorMessages.length >= held.cursor) {
        const missed = priorMessages.slice(held.cursor);
        // v4 boundary: an abort the CLI's own compaction survives (see aborted). The session it
        // compacted, not pi's whole history, is what the model saw: run 08c0f2's second
        // round rewrote pi's history instead and opened at 456,350 tokens with nothing compacted.
        if (rotatePending) {
          rotatePending = false;
          state = { sessionId: crypto.randomUUID(), cursor: priorMessages.length, cwd };
          // The tool results the stopped turn never delivered: a delivered result moves the cursor,
          // so every result past it is one. The CLI recorded the calls themselves before it stopped.
          const results = missed.flatMap((m) =>
            m.role === "toolResult" ? [`${m.toolName}: ${messageContentToText(m.content)}`] : [],
          );
          const carried =
            results.length === 0
              ? undefined
              : `[Your last turn was stopped before these tool results reached you.]\n${results.join("\n")}`;
          return { sessionId: state.sessionId, held: false, forkOf: held.sessionId, carried };
        }
        // Pi appends the assistant message it just streamed after the turn returns;
        // the CLI already wrote that one itself, so one trailing answer is no drift.
        const trailingAnswer = missed.length === 1 && missed[0]?.role === "assistant";
        if (missed.length === 0 || trailingAnswer) {
          if (trailingAnswer) state = { ...held, cursor: priorMessages.length };
          return { sessionId: held.sessionId, held: false };
        }
      }
      // A shorter history is nobody's continuation — an isolated sub-conversation such
      // as a compact summary borrowed the provider. It gets its own session and this
      // one is left exactly as it stands.
      if (continues && priorMessages.length < held.cursor) return { sessionId: null, held: true };
      if (priorMessages.length === 0) return { sessionId: null, held: false };

      state = writeSession(held, priorMessages, {
        cwd,
        rotation: rotatePending ? "rotate" : "keep",
        customToolNameToSdk,
        modelId,
        claudeDir,
        budget,
      });
      rebuildPending = false;
      rotatePending = false;
      return { sessionId: state.sessionId, held: false };
    },

    // v4 boundary: a pending rewrite survives the settle. It was marked while this query ran — a pi
    // compaction or a steer the query never took — so the file the query leaves still lacks it;
    // only the rewrite in sync() clears it.
    settled: (sessionId, cursor, cwd) => {
      state = { sessionId, cursor: Math.max(cursor, state?.cursor ?? 0), cwd };
    },

    // The count only ever grows: a turn that delivered fewer messages than the session
    // already holds has not undone them.
    advancedTo: (cursor) => {
      if (state !== null) state = { ...state, cursor: Math.max(state.cursor, cursor) };
    },

    rebuildNextTurn: () => mark(true, false),
    // v4 boundary: when the CLI compacts (a budget is its window), pi never does, so nothing pi holds
    // needs a rewrite: the next turn forks the stopped session instead.
    aborted: () => mark(budget === undefined, true),
    failed: () => mark(true, false),
  };
}
