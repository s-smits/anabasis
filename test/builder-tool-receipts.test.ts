import { expect, it } from "bun:test";
import { BuilderExecutionRecorder } from "../src/author/builder-execution.ts";
import { sessionClock, withCustomToolReceipts } from "../src/author/builder-tool-receipts.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { double, toolDouble } from "./helpers/doubles.ts";

/** The arguments pi would have validated; these tools read none. */
const NO_ARGS = double<never>({});

/** One tool's own result, which the receipt wrapper hands back unchanged. */
const WRITTEN = { content: [{ type: "text" as const, text: "written" }], details: null };

function wrap(execute: () => Promise<JsonValue>, review: () => Promise<string | null>) {
  const recorder = new BuilderExecutionRecorder(Date.now());
  const tools = withCustomToolReceipts(
    [toolDouble({ name: "write", execute }), toolDouble({ name: "read", execute })],
    {
      recorder,
      activeTurn: () => 1,
      checkpoint: () => {},
      closed: () => null,
      events: undefined,
      afterTool: review,
    },
  );
  return { call: (index = 0) => tools[index]!.execute("call", NO_ARGS), recorder };
}

it("coalesces overlapping completions and holds new work until review settles", async () => {
  const mutation = Promise.withResolvers<void>();
  const reviewStarted = Promise.withResolvers<void>();
  const reviewDone = Promise.withResolvers<void>();
  let calls = 0;
  let reviews = 0;
  const { call } = wrap(
    async () => {
      if (++calls === 1) await mutation.promise;
      return { content: [] };
    },
    async () => {
      reviews += 1;
      reviewStarted.resolve();
      await reviewDone.promise;
      return "public advice";
    },
  );
  const held = call();
  await Promise.all([call(1), call(1)]);
  expect(reviews).toBe(0);
  mutation.resolve();
  await reviewStarted.promise;
  const next = call();
  await Promise.resolve();
  expect(calls).toBe(3);
  expect(reviews).toBe(1);
  reviewDone.resolve();
  expect(JSON.stringify(await held)).toContain("public advice");
  await next;
  expect(calls).toBe(4);
});

it("reviews a failed operation and returns advice with the original error as cause", async () => {
  const failure = new Error("original write failure");
  let calls = 0;
  let reviews = 0;
  const { call, recorder } = wrap(
    async () => {
      if (++calls === 1) throw failure;
      return { content: [] };
    },
    async () => (++reviews === 1 ? "recovery advice" : null),
  );
  await expect(call()).rejects.toMatchObject({
    cause: failure,
    message: "original write failure\nrecovery advice",
  });
  expect(reviews).toBe(1);
  expect(JSON.stringify(await call())).not.toContain("recovery advice");
  expect(recorder.finish("turn-bound").customCalls.map((row) => row.dispatchOutcome)).toEqual([
    "threw",
    "returned",
  ]);
});

it("keeps successful and failed tool outcomes when the advisory checkpoint throws", async () => {
  const failure = new Error("original tool failure");
  let calls = 0;
  const { call, recorder } = wrap(
    async () => {
      if (++calls === 2) throw failure;
      return WRITTEN;
    },
    async () => {
      throw new SyntaxError("unfinished brief");
    },
  );
  expect(await call()).toBe(WRITTEN);
  await expect(call()).rejects.toBe(failure);
  expect(recorder.finish("turn-bound").customCalls.map((row) => row.dispatchOutcome)).toEqual([
    "returned",
    "threw",
  ]);
});

it("books a review's time to the review, not to the tool call it follows", async () => {
  const { call, recorder } = wrap(
    async () => WRITTEN,
    async () => {
      await Bun.sleep(60);
      return "public advice";
    },
  );
  await call();
  const record = recorder.finish("turn-bound");
  expect(record.customCalls[0]?.durationMs ?? Infinity).toBeLessThan(40);
  expect(record.authoringReviews).toHaveLength(1);
  expect(record.authoringReviews[0]?.reviewMs ?? 0).toBeGreaterThanOrEqual(50);
});

it("records a review that found nothing, and none for a review that was not due", async () => {
  const silent = wrap(
    async () => WRITTEN,
    async () => "",
  );
  await silent.call();
  expect(silent.recorder.finish("turn-bound").authoringReviews.map((row) => row.adviceChars)).toEqual([0]);
  const notDue = wrap(
    async () => WRITTEN,
    async () => null,
  );
  await notDue.call();
  expect(notDue.recorder.finish("turn-bound").authoringReviews).toEqual([]);
});

it("refuses a call cancelled or outrun by its turn while it waited behind a review", async () => {
  const reviewDone = Promise.withResolvers<void>();
  let turn = 1;
  let calls = 0;
  const recorder = new BuilderExecutionRecorder(Date.now());
  const tools = withCustomToolReceipts(
    [
      toolDouble({
        name: "write",
        execute: async () => {
          calls += 1;
          return WRITTEN;
        },
      }),
    ],
    {
      recorder,
      activeTurn: () => turn,
      checkpoint: () => {},
      closed: () => null,
      events: undefined,
      afterTool: async () => {
        await reviewDone.promise;
        return null;
      },
    },
  );
  const first = tools[0]!.execute("call", NO_ARGS);
  await Promise.resolve();
  const controller = new AbortController();
  const cancelled = tools[0]!.execute("call", NO_ARGS, controller.signal);
  const outrun = tools[0]!.execute("call", NO_ARGS);
  await Promise.resolve();
  expect(calls).toBe(1);
  controller.abort(new Error("turn ended"));
  await expect(cancelled).rejects.toThrow("cancelled before dispatch");
  turn = 2;
  reviewDone.resolve();
  expect(await first).toBe(WRITTEN);
  await expect(outrun).rejects.toThrow("turn 1 closed");
  expect(calls).toBe(1);
  expect(recorder.finish("turn-bound").customCalls.map((row) => row.turn)).toEqual([1]);
});

it("states the session clock once per half hour and not after the build closed", async () => {
  let now = 0;
  let closed: "accepted" | null = null;
  const recorder = new BuilderExecutionRecorder(Date.now());
  const tools = withCustomToolReceipts(
    [toolDouble({ name: "write", execute: async () => ({ content: [] }) })],
    {
      recorder,
      activeTurn: () => 1,
      checkpoint: () => {},
      closed: () => closed,
      events: undefined,
      afterTool: undefined,
      clock: sessionClock(
        () => true,
        () => now,
      ),
    },
  );
  const text = async () => JSON.stringify(await tools[0]!.execute("call", NO_ARGS));
  now = 29 * 60_000;
  expect(await text()).not.toContain("Round clock");
  now = 31 * 60_000;
  expect(await text()).toContain("Round clock: 31 min since this round opened.");
  now = 59 * 60_000;
  expect(await text()).not.toContain("Round clock");
  closed = "accepted";
  now = 95 * 60_000;
  expect(await text()).not.toContain("Round clock");
  expect(recorder.finish("turn-bound").authoringReviews).toEqual([]);
});

it("asks once inside a running turn for authoring when two hours pass without a submit", async () => {
  let now = 0;
  let submitted = false;
  const bash = () =>
    withCustomToolReceipts([toolDouble({ name: "bash", execute: async () => ({ content: [] }) })], {
      recorder: new BuilderExecutionRecorder(Date.now()),
      activeTurn: () => 1,
      checkpoint: () => {},
      closed: () => null,
      events: undefined,
      afterTool: undefined,
      clock: sessionClock(
        () => submitted,
        () => now,
      ),
    })[0]!;
  const tool = bash();
  const text = async () => JSON.stringify(await tool.execute("call", NO_ARGS));
  now = 119 * 60_000;
  expect(await text()).not.toContain("No candidate has been submitted yet");
  now = 121 * 60_000;
  expect(await text()).toContain(
    "No candidate has been submitted yet. Preserve useful environment work, but move to authoring now",
  );
  now = 125 * 60_000;
  expect(await text()).not.toContain("No candidate has been submitted yet");
  // A session that has submitted is past this question, so the notice never fires for it.
  submitted = true;
  const later = bash();
  now = 500 * 60_000;
  expect(JSON.stringify(await later.execute("call", NO_ARGS))).not.toContain("No candidate");
});
