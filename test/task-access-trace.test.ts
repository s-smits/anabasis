import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { describe, expect, it } from "bun:test";
import { TASK_ACCESS_EVENT_LIMIT, tracePublicTask } from "../src/solve/task-access-trace.ts";
import { createDraftFileTools } from "../src/solve/draft-files.ts";
import { DraftStore } from "../src/solve/draft-store.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";

const task = (publicInput: JsonValue) => ({
  taskId: "t1",
  family: "f1",
  publicInput,
});

/** Read the traced input as the fixture shape supplied by the caller. */
const tracedInput = <T>(traced: { task: { publicInput: unknown } }): T =>
  // SAFETY: tracePublicTask returns a proxy over the object supplied to `task(...)`.
  // Each caller states the shape of the fixture it supplied.
  traced.task.publicInput as T;

describe("tracePublicTask", () => {
  it("transports native file results with absent optional details", async () => {
    const schema = compilePublicArtifactSchema([{ name: "files" }], [{ files: { "a.txt": "one" } }]);
    const tools = createDraftFileTools(new DraftStore(), schema);
    const { materialize } = tracePublicTask(task({}), "traced");
    for (const [name, args] of [
      ["write", { path: "a.txt", content: "one" }],
      ["read", { path: "a.txt" }],
      ["edit", { path: "a.txt", edits: [{ oldText: "one", newText: "two" }] }],
    ] as const) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`missing ${name}`);
      const result = await tool.execute(name, args);
      expect(JSON.stringify(materialize(result))).toBe(JSON.stringify(result));
    }
    expect(materialize({ details: undefined, nested: { absent: undefined } })).toEqual({ nested: {} });
  });

  it("materializes nested public-data proxies without adding transport reads to the trace", () => {
    const traced = tracePublicTask(task({ entrypoints: [{ name: "setup" }, { name: "loop" }] }), "traced");
    const input = tracedInput<{ entrypoints: Array<{ name: string }> }>(traced);
    const result = { content: [{ type: "text", text: "entrypoints" }], details: { rows: input.entrypoints } };
    const before = traced.snapshot();
    const materialized = traced.materialize(result);
    expect(structuredClone(materialized)).toEqual({
      content: [{ type: "text", text: "entrypoints" }],
      details: { rows: [{ name: "setup" }, { name: "loop" }] },
    });
    expect(traced.snapshot()).toEqual(before);
  });

  it.each(["untraced", "traced"] as const)(
    "refuses executable data without invoking it, tracing=%s",
    (trace) => {
      const traced = tracePublicTask(task({ a: 1 }), trace);
      let calls = 0;
      const accessor = {
        get value() {
          calls += 1;
          return 1;
        },
      };
      const proxy = new Proxy(
        {},
        {
          ownKeys() {
            calls += 1;
            return [];
          },
        },
      );
      const cycle: JsonObject = {};
      cycle.self = cycle;
      const extended = Object.assign([1], { extra: undefined });
      for (const value of [accessor, proxy, cycle, { fn: () => 1 }, undefined, [undefined], extended]) {
        expect(() => traced.materialize(value)).toThrow(/generated tool result/);
      }
      expect(calls).toBe(0);
      expect(traced.materialize({ nested: [{ a: 1 }] })).toEqual({ nested: [{ a: 1 }] });
    },
  );

  it.each(["untraced", "traced"] as const)(
    "writes a non-finite number as null, as the tool's JSON text does, tracing=%s",
    (trace) => {
      const traced = tracePublicTask(task({ a: 1 }), trace);
      const result = { details: { utilisation: Number.POSITIVE_INFINITY, rows: [Number.NaN, -Infinity, 2] } };
      expect(traced.materialize(result)).toEqual(JSON.parse(JSON.stringify(result)));
      expect(traced.materialize(result)).toEqual({ details: { utilisation: null, rows: [null, null, 2] } });
    },
  );

  it("returns the untraced task and no snapshot when disabled", () => {
    const subject = task({ a: 1 });
    const traced = tracePublicTask(subject, "untraced");
    expect(traced.task).toBe(subject);
    expect(traced.snapshot()).toBeUndefined();
  });

  it("records each distinct path once per segment, however often it is read", () => {
    const traced = tracePublicTask(task({ rows: [{ x: 1 }, { x: 2 }, { x: 3 }] }), "traced");
    const input = tracedInput<{ rows: Array<{ x: number }> }>(traced);
    for (let pass = 0; pass < 200; pass += 1) {
      for (let index = 0; index < input.rows.length; index += 1) void input.rows[index]?.x;
    }
    const snapshot = traced.snapshot();
    expect(snapshot?.events).toEqual(["$.rows", "$.rows[]", "$.rows[].x"]);
    expect(snapshot?.truncated).toBe(false);
    expect(snapshot?.opaqueCopies).toBe(0);
  });

  it("re-records a path after a snapshot so each tool window attributes its own reads", () => {
    const traced = tracePublicTask(task({ a: 1 }), "traced");
    const input = tracedInput<{ a: number }>(traced);
    void input.a;
    expect(traced.snapshot()?.events).toEqual(["$.a"]);
    void input.a;
    expect(traced.snapshot()?.events).toEqual(["$.a", "$.a"]);
  });

  it("truncates only past the distinct-path limit and counts enumeration as opaque", () => {
    const wide: Record<string, number> = {};
    for (let index = 0; index < TASK_ACCESS_EVENT_LIMIT + 10; index += 1) wide[`k${index}`] = index;
    const traced = tracePublicTask(task(wide), "traced");
    const input = tracedInput<Record<string, number>>(traced);
    for (const key of Object.keys(wide)) void input[key];
    Object.keys(input);
    const snapshot = traced.snapshot();
    expect(snapshot?.events.length).toBe(TASK_ACCESS_EVENT_LIMIT);
    expect(snapshot?.truncated).toBe(true);
    expect(snapshot?.opaqueCopies).toBe(1);
  });
});
