// How a generated-tool worker's run ends, and who owns the ending.
//
// Every case the controller schedules is paid for, so the difference between "the candidate's
// code crashed" and "the host waited too long" decides whether a battery reports a capability
// result or a typed non-result. The worker process module carried these judgements inline in a
// 45-line close method, mixed with the writes, kills and timers that surround them, and nothing
// in the suite reached them: the whole 554-line module had no test file naming it.
//
// The rules under test, each of which a reader of the old method had to reconstruct:
//
//   a worker that never reached its ready handshake owns no product failure, whatever it exits
//   with — the candidate's code had not started;
//   a non-zero exit *after* the handshake is the candidate's crash, and "crash" is the one kind
//   AGENTS.md forbids assigning to the environment;
//   a signal is not an exit code. Under Bubblewrap it arrives wrapped inside one, and reading it
//   as a code would report a killed worker as a crashing one;
//   a close the host's own wall ended carries `deadline`, so a reader can tell a wait limit from
//   a reported failure.

import { describe, expect, it } from "bun:test";
import {
  closeRefusal,
  exitOwner,
  exitTermination,
  readyTimeoutCause,
} from "../src/solve/generated-tool-worker-termination.ts";

describe("what stops a close from being an ordinary one", () => {
  it("lets a ready worker with nothing in flight close normally", () => {
    expect(closeRefusal("done", 0)).toBeNull();
  });

  it("refuses a close before the ready handshake, which the host owns", () => {
    const cause = closeRefusal("pending", 0);
    expect(cause).toMatchObject({ kind: "runtime" });
    expect(cause?.message).toContain("before its ready handshake");
  });

  it("refuses a close with a request still in flight, which the protocol owns", () => {
    expect(closeRefusal("done", 1)).toMatchObject({ kind: "protocol" });
  });

  it("names the unready worker before the pending request, since it explains the request too", () => {
    expect(closeRefusal("pending", 2)?.kind).toBe("runtime");
  });
});

describe("the ending a child's exit describes", () => {
  it("calls a zero exit normal, and carries no cause", () => {
    expect(exitTermination("closed", { code: 0, signal: null }, "done")).toEqual({ status: "normal" });
  });

  it("calls a non-zero exit after the handshake a crash, which is product-owned", () => {
    expect(exitTermination("closed", { code: 3, signal: null }, "done")).toMatchObject({
      status: "non-result",
      kind: "crash",
    });
  });

  it("keeps the broader runtime kind before the handshake, since no candidate code ran", () => {
    expect(exitTermination("closed", { code: 3, signal: null }, "pending")).toMatchObject({
      kind: "runtime",
    });
  });

  it("keeps the broader runtime kind for a signal, even after the handshake", () => {
    // A signalled worker was stopped, not broken by its own code. Reporting SIGKILL as a
    // crash would put a host or operator kill on the candidate's record.
    expect(exitTermination("closed", { code: null, signal: "SIGKILL" }, "done")).toMatchObject({
      kind: "runtime",
    });
  });

  it("reports the signal, not the code, when the child was signalled", () => {
    const end = exitTermination("closed", { code: null, signal: "SIGTERM" }, "done");
    if (end.status !== "non-result") throw new Error("expected a non-result");
    expect(end.message).toContain("SIGTERM");
  });

  it("carries the prefix the caller chose, so a close reads differently from a prior exit", () => {
    const end = exitTermination("had already exited", { code: 9, signal: null }, "done");
    if (end.status !== "non-result") throw new Error("expected a non-result");
    expect(end.message).toBe("generated-tool worker had already exited with 9");
  });

  it("marks no exit as a deadline, since the child answered", () => {
    const end = exitTermination("closed", { code: 1, signal: null }, "done");
    if (end.status !== "non-result") throw new Error("expected a non-result");
    expect(end.deadline).toBeUndefined();
  });
});

describe("a child that exited while the controller still expected it", () => {
  // The close path and the stream watcher ask the same question about different moments, so
  // they read one rule: a worker that dies mid-run is only a crash once it was ready.
  it("owns a mid-run non-zero exit as a crash once the worker was ready", () => {
    expect(exitOwner("done", { code: 1 })).toBe("crash");
  });

  it("leaves a mid-run exit with the host before the handshake", () => {
    expect(exitOwner("pending", { code: 1 })).toBe("runtime");
  });
});

describe("a startup the host gave up waiting for", () => {
  it("blames the host while the walls were still going up", () => {
    const cause = readyTimeoutCause("pending", 30_000);
    expect(cause).toMatchObject({ kind: "runtime", deadline: true });
    expect(cause.message).toContain("before its ready handshake");
  });

  it("points at the candidate's loading once its walls are installed", () => {
    const cause = readyTimeoutCause("installed", 30_000);
    expect(cause.message).toContain("loading the candidate harness");
    expect(cause.message).toContain("30000ms");
  });

  it("does not call the candidate's slow load a host deadline", () => {
    // The host did stop waiting, but the wait it lost was on candidate code. Marking it
    // `deadline` would let an environment reader claim a case the product owns.
    expect(readyTimeoutCause("installed", 30_000).deadline).toBeUndefined();
  });
});

describe("every cause names the subject", () => {
  it("prefixes each message with the worker, so a log line stands alone", () => {
    const causes = [
      closeRefusal("pending", 0)?.message,
      closeRefusal("done", 1)?.message,
      readyTimeoutCause("installed", 1).message,
      readyTimeoutCause("pending", 1).message,
    ];
    for (const message of causes) expect(message).toMatch(/^generated-tool worker /);
  });
});
