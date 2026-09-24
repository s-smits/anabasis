import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectDir, getSessionPath } from "cc-session-io";

import { sessionContinuity } from "../vendor/pi-claude-bridge/session-continuity.ts";

import type { Message as PiMessage } from "@earendil-works/pi-ai";

/**
 * Between two pi turns the bridge has to decide one thing: may this turn resume the
 * Claude Code session the last turn left, or does that session no longer describe pi's
 * history? Resuming keeps the prompt cache warm; resuming the wrong session replays a
 * conversation that did not happen, and the CLI will not say so.
 *
 * The decision is observed here the way the CLI observes it — through the session files
 * on disk — because a returned id that names a file nobody rewrote is the whole claim.
 */

let claudeDir = "";
const projects: string[] = [];

beforeAll(() => {
  claudeDir = mkdtempSync(join(tmpdir(), "pi-bridge-claude-"));
});

afterAll(() => {
  for (const dir of [claudeDir, ...projects]) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-bridge-cwd-"));
  projects.push(cwd);
  return cwd;
}

/** A continuity owner, with the CLI's token budget when given, and a project directory of its
 *  own, so no case sees another's files. */
function bridge(budget?: number) {
  return { continuity: sessionContinuity(claudeDir, budget), cwd: project() };
}

function piUser(text: string): PiMessage {
  return { role: "user", content: text, timestamp: 0 };
}

function piAssistant(text: string): PiMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic",
    provider: "claude-bridge",
    model: "claude-opus-5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

/** One tool call and the result pi holds for it. */
function piCall(name: string, result: string): PiMessage[] {
  // SAFETY: the fixture builds pi's AssistantMessage arm around one tool call.
  const call = {
    ...piAssistant(""),
    content: [{ type: "toolCall", id: name, name, arguments: {} }],
  } as PiMessage;
  const done: PiMessage = {
    role: "toolResult",
    toolCallId: name,
    toolName: name,
    content: [{ type: "text", text: result }],
    isError: false,
    timestamp: 0,
  };
  return [call, done];
}

/** One exchange per pair, so a history of n pairs is 2n prior messages. */
function exchange(n: number): PiMessage[] {
  return Array.from({ length: n }, (_, i) => [piUser(`ask ${i}`), piAssistant(`answer ${i}`)]).flat();
}

function sessionFiles(cwd: string): string[] {
  const dir = getProjectDir(cwd, claudeDir);
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".jsonl")) : [];
}

function sessionText(cwd: string, sessionId: string): string {
  return readFileSync(getSessionPath(sessionId, cwd, claudeDir), "utf8");
}

describe("the first turn", () => {
  it("writes no session when there is nothing to resume from", () => {
    const { continuity, cwd } = bridge();
    expect(continuity.sync([], cwd)).toStrictEqual({ sessionId: null, held: false });
    expect(sessionFiles(cwd)).toStrictEqual([]);
  });

  it("writes the prior conversation into a session the CLI can resume", () => {
    const { continuity, cwd } = bridge();
    const { sessionId } = continuity.sync(exchange(2), cwd);
    expect(sessionId).not.toBeNull();
    expect(sessionFiles(cwd)).toHaveLength(1);
    const text = sessionText(cwd, sessionId!);
    expect(text).toContain("ask 0");
    expect(text).toContain("answer 1");
  });

  it("records the model the turn runs under", () => {
    const { continuity, cwd } = bridge();
    const { sessionId } = continuity.sync(exchange(1), cwd, undefined, "claude-opus-5");
    expect(sessionText(cwd, sessionId!)).toContain("claude-opus-5");
  });

  it("carries the caller's tool names into the replayed history", () => {
    const { continuity, cwd } = bridge();
    const tools = new Map([["truss_solve", "mcp__pi__truss_solve"]]);
    const { sessionId } = continuity.sync(
      [piUser("solve it"), ...piCall("truss_solve", "solved")],
      cwd,
      tools,
    );
    expect(sessionText(cwd, sessionId!)).toContain("mcp__pi__truss_solve");
  });
});

describe("resuming the session the last turn left", () => {
  it("returns the same session untouched when pi's history has not moved", () => {
    const { continuity, cwd } = bridge();
    const first = continuity.sync(exchange(2), cwd);
    const written = sessionText(cwd, first.sessionId!);

    const second = continuity.sync(exchange(2), cwd);
    expect(second.sessionId).toBe(first.sessionId);
    expect(sessionText(cwd, first.sessionId!)).toBe(written);
  });

  it("tolerates the trailing assistant message pi appends after the turn", () => {
    const { continuity, cwd } = bridge();
    const history = exchange(2);
    const first = continuity.sync(history, cwd);
    const written = sessionText(cwd, first.sessionId!);

    // pi appends the answer it just streamed; the CLI already wrote it itself.
    const appended = [...history, piAssistant("the answer just streamed")];
    expect(continuity.sync(appended, cwd).sessionId).toBe(first.sessionId);
    expect(sessionText(cwd, first.sessionId!)).toBe(written);

    // ...and the bridge has counted it, so the next turn at that length still resumes.
    expect(continuity.sync(appended, cwd).sessionId).toBe(first.sessionId);
    expect(sessionText(cwd, first.sessionId!)).toBe(written);
  });

  it("rebuilds when a message the CLI never saw arrived", () => {
    const { continuity, cwd } = bridge();
    const history = exchange(2);
    const first = continuity.sync(history, cwd);

    const withOther = [...history, piUser("another provider took this turn")];
    const second = continuity.sync(withOther, cwd);
    expect(second.sessionId).toBe(first.sessionId);
    expect(sessionText(cwd, first.sessionId!)).toContain("another provider took this turn");
    expect(sessionFiles(cwd)).toHaveLength(1);
  });

  it("rebuilds when more than the one trailing message is missing", () => {
    const { continuity, cwd } = bridge();
    const history = exchange(2);
    const first = continuity.sync(history, cwd);

    const grown = [...history, piAssistant("first"), piAssistant("second")];
    expect(continuity.sync(grown, cwd).sessionId).toBe(first.sessionId);
    expect(sessionText(cwd, first.sessionId!)).toContain("second");
  });

  it("holds the session when the history it is asked about is shorter than its own", () => {
    // An isolated sub-conversation, such as a compact summary, borrows the provider
    // without being the session's continuation. It gets no resume, and the session
    // it did not write stays as it was.
    const { continuity, cwd } = bridge();
    const first = continuity.sync(exchange(3), cwd);
    const written = sessionText(cwd, first.sessionId!);

    expect(continuity.sync(exchange(1), cwd)).toStrictEqual({ sessionId: null, held: true });
    expect(sessionText(cwd, first.sessionId!)).toBe(written);
    expect(sessionFiles(cwd)).toHaveLength(1);
  });
});

describe("a turn that moved to another directory", () => {
  it("does not resume a session belonging to the directory it left", () => {
    // The session file lives under a hash of the project path. Resuming an id from
    // another project asks the CLI for a conversation that is not there.
    const { continuity, cwd } = bridge();
    const first = continuity.sync(exchange(2), cwd);
    const elsewhere = project();

    const second = continuity.sync(exchange(2), elsewhere);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.held).toBe(false);
    expect(sessionFiles(elsewhere)).toHaveLength(1);
    // The directory it left keeps its own session, whole.
    expect(sessionFiles(cwd)).toHaveLength(1);
    expect(sessionText(cwd, first.sessionId!)).toContain("ask 0");
  });
});

describe("a rewrite under a token budget", () => {
  // The bridge passes the CLI's compaction window: pi's history outgrows it while the CLI compacts,
  // and a rewrite carries zero usage, so the CLI would send all of it before it could compact.
  it("keeps the newest messages that fit, behind one note naming how many were left out", () => {
    const { continuity, cwd } = bridge(60);
    const { sessionId } = continuity.sync(exchange(20), cwd);
    const text = sessionText(cwd, sessionId!);
    expect(text).toContain("answer 19");
    expect(text).not.toContain('answer 0"');
    expect(text).toMatch(
      /\[3\d earlier messages of this conversation were left out when its session was rewritten/,
    );
  });

  it("rewrites the whole history when it fits", () => {
    const { continuity, cwd } = bridge(10_000);
    const { sessionId } = continuity.sync(exchange(20), cwd);
    const text = sessionText(cwd, sessionId!);
    expect(text).toContain('answer 0"');
    expect(text).not.toContain("were left out");
  });

  it("keeps the newest message even when it alone is over the budget", () => {
    const { continuity, cwd } = bridge(1);
    const { sessionId } = continuity.sync(exchange(2), cwd);
    const text = sessionText(cwd, sessionId!);
    expect(text).toContain("answer 1");
    expect(text).toContain("[3 earlier messages");
  });
});

describe("an abort when the CLI compacts its own session", () => {
  // The bridge passes a budget exactly when the CLI compacts. Pi then never does, so its history is
  // the whole run while the session the CLI compacted is what the model saw.
  it("forks the stopped session instead of rewriting pi's whole history", () => {
    const { continuity, cwd } = bridge(10_000);
    const first = continuity.sync(exchange(2), cwd);
    const written = sessionText(cwd, first.sessionId!);

    // The CLI took `inspect`'s result; the round then ended on `submit` before its result arrived.
    const delivered = [...exchange(2), piUser("round one"), ...piCall("inspect", "3 files")];
    continuity.advancedTo(delivered.length);
    continuity.aborted();
    const next = continuity.sync([...delivered, ...piCall("submit", "accepted as v3")], cwd);

    expect(next.forkOf).toBe(first.sessionId!);
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(next.carried).toContain("submit: accepted as v3");
    expect(next.carried).not.toContain("3 files");
    expect(sessionFiles(cwd)).toHaveLength(1);
    expect(sessionText(cwd, first.sessionId!)).toBe(written);
  });

  it("resumes the fork afterwards like any session", () => {
    const { continuity, cwd } = bridge(10_000);
    continuity.sync(exchange(2), cwd);
    continuity.aborted();
    const history = [...exchange(2), ...piCall("submit", "accepted")];
    const fork = continuity.sync(history, cwd);

    const answered = [...history, piUser("round two"), piAssistant("done")];
    continuity.settled(fork.sessionId!, answered.length - 1, cwd);
    expect(continuity.sync(answered, cwd)).toStrictEqual({ sessionId: fork.sessionId, held: false });
  });

  it("still rewrites when a steer never reached the session", () => {
    const { continuity, cwd } = bridge(10_000);
    const first = continuity.sync(exchange(2), cwd);

    continuity.rebuildNextTurn();
    continuity.aborted();
    const next = continuity.sync([...exchange(2), piUser("a steer")], cwd);
    expect(next.forkOf).toBeUndefined();
    expect(sessionText(cwd, next.sessionId!)).toContain("a steer");
    expect(next.sessionId).not.toBe(first.sessionId);
  });
});

describe("what the turn tells the bridge afterwards", () => {
  it("rebuilds in place once a steer never reached the session", () => {
    const { continuity, cwd } = bridge();
    const history = exchange(2);
    const first = continuity.sync(history, cwd);

    continuity.rebuildNextTurn();
    const second = continuity.sync(history, cwd);
    expect(second.sessionId).toBe(first.sessionId);
    expect(sessionFiles(cwd)).toHaveLength(1);
  });

  it("takes a fresh id after an abort and leaves the old file to the stopped CLI", () => {
    // The stopped subprocess may still flush an interruption record into its own
    // file; writing this turn's history at that path would race it.
    const { continuity, cwd } = bridge();
    const history = exchange(2);
    const first = continuity.sync(history, cwd);

    continuity.aborted();
    const second = continuity.sync(history, cwd);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(sessionFiles(cwd)).toHaveLength(2);
    expect(existsSync(getSessionPath(first.sessionId!, cwd, claudeDir))).toBe(true);
  });

  it("rebuilds in place after a failure, rather than abandoning the file it wrote", () => {
    // A failed query is not a concurrent writer: the id is still ours, and dropping
    // it would leave the session file behind with nothing able to delete it.
    const { continuity, cwd } = bridge();
    const history = exchange(2);
    const first = continuity.sync(history, cwd);

    continuity.failed();
    const second = continuity.sync(history, cwd);
    expect(second.sessionId).toBe(first.sessionId);
    expect(sessionFiles(cwd)).toHaveLength(1);
  });

  it("still rotates when the failure followed an abort", () => {
    const { continuity, cwd } = bridge();
    const first = continuity.sync(exchange(2), cwd);

    continuity.aborted();
    continuity.failed();
    expect(continuity.sync(exchange(2), cwd).sessionId).not.toBe(first.sessionId);
  });

  it("still owes the rewrite pi asked for while a query ran, after that query settled", () => {
    // A pi compaction during a running query: the file that query leaves holds the history pi has
    // since replaced, and the compacted one is shorter than the count the settle recorded.
    const { continuity, cwd } = bridge();
    const first = continuity.sync(exchange(3), cwd);

    continuity.rebuildNextTurn();
    continuity.settled(first.sessionId!, exchange(4).length, cwd);
    const compacted = [piUser("summary of the first three asks"), ...exchange(4).slice(6)];
    expect(continuity.sync(compacted, cwd)).toStrictEqual({ sessionId: first.sessionId, held: false });
    expect(sessionText(cwd, first.sessionId!)).toContain("summary of the first three asks");
    expect(sessionText(cwd, first.sessionId!)).not.toContain("answer 0");
  });

  it("keeps the session the CLI reported, when it is not the one the bridge wrote", () => {
    const { continuity, cwd } = bridge();
    const history = exchange(2);
    continuity.sync(history, cwd);

    continuity.settled("cli-chose-this-one", history.length, cwd);
    expect(continuity.state()?.sessionId).toBe("cli-chose-this-one");
  });

  it("counts the turn it just delivered, so the next one resumes", () => {
    const { continuity, cwd } = bridge();
    const history = exchange(2);
    const first = continuity.sync(history, cwd);
    const written = sessionText(cwd, first.sessionId!);

    // The CLI wrote this turn into the session itself; the bridge only counts it.
    const delivered = [...history, piUser("and this"), piAssistant("done")];
    continuity.advancedTo(delivered.length);
    expect(continuity.sync(delivered, cwd).sessionId).toBe(first.sessionId);
    expect(sessionText(cwd, first.sessionId!)).toBe(written);
  });

  it("never counts backwards", () => {
    const { continuity, cwd } = bridge();
    const history = exchange(3);
    continuity.sync(history, cwd);

    continuity.advancedTo(2);
    expect(continuity.state()?.cursor).toBe(history.length);
  });

  it("says nothing is held when no turn has run", () => {
    const { continuity } = bridge();
    expect(continuity.state()).toBeNull();
    // The signals a turn sends afterwards have nothing to act on, and do not throw.
    continuity.rebuildNextTurn();
    continuity.aborted();
    continuity.failed();
    continuity.advancedTo(4);
    expect(continuity.state()).toBeNull();
  });
});
