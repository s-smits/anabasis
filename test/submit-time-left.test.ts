// The first submit of a Built solve with a quarter or more of its time left gets the time back
// instead of sending, once; every later submit, and any submit with less time left, sends at once.
// The wall's own submit must always send, or a case that reached the wall would lose its prepared
// answer.

import { describe, expect, it } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { submitTimeLeftNote, withTimeLeftAtSubmit } from "../src/solve/submit-time-left.ts";

const MINUTE = 60_000;
/* SAFETY: `submit` takes no arguments; `never` is the roster's parameter type, not a claim about this value. */
const NO_ARGS = {} as never;
const SOLVE = 120 * MINUTE;

function roster() {
  const sent: string[] = [];
  const tool = (name: string): AgentTool<never> => ({
    name,
    label: name,
    description: name,
    parameters:
      /* SAFETY: `AgentTool<never>` is the Built roster's common type, which types `parameters` as `never`; the schema itself is an empty object. */ Type.Object(
        {},
      ) as never,
    execute: async (callId) => {
      sent.push(`${name}:${callId}`);
      return { content: [{ type: "text", text: "Submitted." }], details: null, terminate: true };
    },
  });
  return {
    sent,
    tools: new Map([
      ["preview_artifact", tool("preview_artifact")],
      ["submit", tool("submit")],
    ]),
  };
}

function clock(startMs: number) {
  let at = startMs;
  return { now: () => at, advance: (ms: number) => void (at += ms) };
}

const text = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map((part) => part.text ?? "").join("");

describe("withTimeLeftAtSubmit", () => {
  it("answers the first early submit with the time left, then sends on the second", async () => {
    const { sent, tools } = roster();
    const time = clock(1_000);
    const wrapped = withTimeLeftAtSubmit(tools, SOLVE, time.now);
    time.advance(35 * MINUTE);
    const first = await wrapped.get("submit")!.execute("c1", NO_ARGS);
    expect(text(first)).toBe(submitTimeLeftNote(85 * MINUTE, SOLVE));
    expect(text(first)).toStartWith("Not sent: 85 of the case's 120 minutes remain");
    expect(first.terminate).toBeUndefined();
    expect(sent).toEqual([]);
    const second = await wrapped.get("submit")!.execute("c2", NO_ARGS);
    expect(text(second)).toBe("Submitted.");
    expect(sent).toEqual(["submit:c2"]);
  });

  it("sends at once when less than a quarter of the time is left, and the note never comes later", async () => {
    const { sent, tools } = roster();
    const time = clock(0);
    const wrapped = withTimeLeftAtSubmit(tools, SOLVE, time.now);
    time.advance(91 * MINUTE);
    expect(text(await wrapped.get("submit")!.execute("late", NO_ARGS))).toBe("Submitted.");
    expect(sent).toEqual(["submit:late"]);
  });

  it("lets the wall's own submit through after the time is spent", async () => {
    const { sent, tools } = roster();
    const time = clock(0);
    const wrapped = withTimeLeftAtSubmit(tools, SOLVE, time.now);
    time.advance(SOLVE + 5_000);
    await wrapped.get("submit")!.execute("solve-wall-t1", NO_ARGS);
    expect(sent).toEqual(["submit:solve-wall-t1"]);
  });

  it("leaves every other tool and the caller's map untouched", async () => {
    const { tools } = roster();
    const wrapped = withTimeLeftAtSubmit(tools, SOLVE, () => 0);
    expect(wrapped.get("preview_artifact")).toBe(tools.get("preview_artifact"));
    expect(wrapped.get("submit")).not.toBe(tools.get("submit"));
    expect(withTimeLeftAtSubmit(new Map(), SOLVE).size).toBe(0);
  });
});
