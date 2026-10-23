import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { read } from "../src/kernel/log.ts";
import { isFunction } from "../src/meta/json-shape.ts";
import { existsSync, mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { type Seat, sit } from "../src/agent/session.ts";
import { ending, text, tool } from "../src/tools/answer.ts";

const scratch = mkdtempSync(join(tmpdir(), "ana-seat-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TOOL_USE = { stopReason: "toolUse" } as const;
const look = fauxAssistantMessage([fauxToolCall("look", {})], TOOL_USE);

/** A seat on the faux provider that answers `responses` in order, with one tool, `look`, whose
 *  every call is pushed to `looked` with the signal it ran under; `sent` holds each context. */
function seated(responses: readonly FauxResponseStep[], over: Partial<Seat> = {}, provider = "faux") {
  const faux = fauxProvider({
    provider,
    models: [
      {
        id: "faux-seat",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  const sent: string[] = [];
  faux.setResponses(
    responses.map(
      (step): FauxResponseStep =>
        isFunction(step)
          ? step
          : (context) => {
              sent.push(JSON.stringify(context));
              return step;
            },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const looked: AbortSignal[] = [];
  const homes: string[] = [];
  const shutdowns: AbortSignal[] = [];
  const looking = tool({
    name: "look",
    description: "Look.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async (_args, _api, context) => {
      const signal = context.abortSignal ?? new AbortController().signal;
      looked.push(signal);
      return text("seen");
    },
  });
  const seat: Seat = {
    models: (home, shutdown) => {
      shutdowns.push(shutdown);
      homes.push(home);
      return models;
    },
    id: `s-${String(homes.length)}-${crypto.randomUUID().slice(0, 8)}`,
    model: faux.getModel(),
    effort: "medium",
    system: "A seat.",
    opening: "Begin.",
    tools: [looking],
    turns: [],
    stops: [],
    ...over,
  };
  return { seat, sent, looked, homes, shutdowns, faux };
}

describe("a seat's session", () => {
  it("ends when its work is over, at its turn cap, or when a stop fires, and a cut one has no crash", async () => {
    const done = seated([look, look, look]);
    Object.assign(done.seat, { over: () => done.seat.turns.length >= 2 });
    const ended = await sit(done.seat);
    expect([done.seat.turns.length, ended.cut, ended.crash]).toEqual([2, false, null]);
    expect(ended.spent.turns).toBe(2);

    const capped = seated([look, look, look, look], { most: 3 });
    await sit(capped.seat);
    expect(capped.seat.turns).toHaveLength(3);

    const kill = new AbortController();
    const killed = seated(
      [
        () => {
          kill.abort();
          return fauxAssistantMessage("", { stopReason: "error", errorMessage: "aborted" });
        },
      ],
      { stops: [kill.signal, undefined] },
    );
    const cut = await sit(killed.seat);
    expect([cut.cut, cut.crash]).toEqual([true, null]);
  });

  it("takes its crash from what threw, or from a last turn the provider failed", async () => {
    const failed = seated([fauxAssistantMessage("", { stopReason: "error", errorMessage: "session limit" })]);
    expect(await sit(failed.seat)).toMatchObject({ cut: false, thrown: null, crash: "session limit" });

    const throwing = seated([look], {
      models: () => {
        throw new Error("no backend");
      },
    });
    expect(await sit(throwing.seat)).toMatchObject({ cut: false, thrown: "no backend", crash: "no backend" });
  });

  it("is prompted again by the seat when a turn ends without a call, and ends where the seat has nothing to say", async () => {
    const said = ["Go on."];
    const s = seated([fauxAssistantMessage("Thinking."), fauxAssistantMessage("Done.")], {
      next: async () => said.shift() ?? null,
    });
    await sit(s.seat);
    expect(s.seat.turns).toHaveLength(2);
    expect(s.sent[1]).toContain("Go on.");
  });

  it("settles its seat's work before the model's process is closed, and removes the scratch home it made", async () => {
    let open: boolean[] = [];
    const s = seated([look, fauxAssistantMessage("Done.")], {
      settle: async () => {
        open = s.shutdowns.map((signal) => !signal.aborted);
      },
    });
    await sit(s.seat);
    expect(open).toEqual([true]);
    expect(s.shutdowns.every((signal) => signal.aborted)).toBe(true);
    expect(s.homes.map(existsSync)).toEqual([false]);

    const own = join(scratch, "own-home");
    const kept = seated([fauxAssistantMessage("Done.")], { home: own });
    await sit(kept.seat);
    expect(kept.homes).toEqual([own]);
  });
});

describe("durable session boundaries", () => {
  it("traces and meters each turn before its tools read the log", async () => {
    const log = join(scratch, "before-tools.jsonl");
    let observed = false;
    const reader = tool({
      name: "look",
      description: "Look.",
      parameters: Type.Object({}),
      execute: async () => {
        const events = read(log);
        expect(events.at(-1)?.kind).toBe("build.turn");
        expect(events.at(-1)?.data.usage).toBeDefined();
        observed = true;
        return text("seen");
      },
    });
    const s = seated([look, fauxAssistantMessage("Done.")], { trace: { log, of: "build" }, tools: [reader] });
    await sit(s.seat);
    expect(observed).toBe(true);
    expect(read(log).map(({ kind }) => kind)).toEqual(["build.turn", "build.call", "build.turn"]);
  });

  it("ends after a round with submit and another call, without another request", async () => {
    let submitted = false;
    const submit = tool({
      name: "submit",
      description: "Submit.",
      parameters: Type.Object({}),
      execute: async () => {
        submitted = true;
        return ending(text("submitted"));
      },
    });
    const s = seated([
      fauxAssistantMessage([fauxToolCall("submit", {}), fauxToolCall("look", {})], TOOL_USE),
      look,
    ]);
    Object.assign(s.seat, { tools: [submit, ...s.seat.tools], over: () => submitted });
    expect(await sit(s.seat)).toMatchObject({ crash: null });
    expect(s.looked).toHaveLength(1);
    expect(s.faux.state.callCount).toBe(1);
  });

  it("makes no request beyond most, including a zero cap", async () => {
    for (const most of [0, 1, 3]) {
      const s = seated([look, look, look, look], { most });
      expect(await sit(s.seat)).toMatchObject({ crash: null });
      expect(s.faux.state.callCount).toBe(most);
    }
  });

  it("ends with thrown when before throws, before a provider or tool runs", async () => {
    const s = seated([look], {
      before: () => {
        throw new Error("seat cap");
      },
    });
    expect(await sit(s.seat)).toMatchObject({ thrown: "seat cap", crash: "seat cap" });
    expect(s.faux.state.callCount).toBe(0);
    expect(s.looked).toEqual([]);
  });

  it("keeps the seat id as the provider session id and the whole untagged system prompt", async () => {
    let sessionId: string | undefined;
    const s = seated([
      (_context, options) => {
        sessionId = options?.sessionId;
        expect(_context.messages.find((message) => message.role === "system")?.content).toBe("A seat.");
        return fauxAssistantMessage("Done.");
      },
    ]);
    await sit(s.seat);
    expect(sessionId).toBe(s.seat.id);
  });
  it("bills a retried attempt on the following turn without counting it as a turn", async () => {
    const log = join(scratch, "retry.jsonl");
    const failed = fauxAssistantMessage("charged partial", {
      stopReason: "error",
      errorMessage: "WebSocket closed 1000",
    });
    const s = seated(
      [failed, fauxAssistantMessage("Done.")],
      { trace: { log, of: "solve" } },
      "openai-codex",
    );
    const sat = await sit(s.seat);
    expect(sat.crash).toBeNull();
    expect(s.faux.state.callCount).toBe(2);
    expect(sat.spent.turns).toBe(1);
    const events = read(log).filter((event) => event.kind === "solve.turn");
    expect(events).toHaveLength(1);
    expect(events[0]?.data.retried).toEqual(["WebSocket closed 1000"]);
    expect(sat.spent.tokens.input).toBeGreaterThan(s.seat.turns[0]?.usage.input ?? 0);
    expect(sat.spent.billed).toBeCloseTo(s.seat.turns[0]?.usage.cost.total ?? 0, 10);
  });

  it("retries a failed attempt on the last turn most allows", async () => {
    const s = seated(
      [fauxAssistantMessage("", { stopReason: "error", errorMessage: "WebSocket closed 1000" }), look],
      { most: 1 },
      "openai-codex",
    );
    expect(await sit(s.seat)).toMatchObject({ crash: null });
    expect(s.faux.state.callCount).toBe(2);
    expect(s.seat.turns).toHaveLength(1);
  });
});

describe("refused durable tool calls", () => {
  it("traces unavailable tools and invalid arguments even though durable bypasses their hooks", async () => {
    const log = join(scratch, "refused-calls.jsonl");
    const phases: string[] = [];
    const required = tool({
      name: "look",
      description: "Look.",
      parameters: Type.Object({ key: Type.String() }),
      execute: async () => {
        throw new Error("invalid arguments reached the tool");
      },
    });
    const s = seated(
      [fauxAssistantMessage([fauxToolCall("absent", {}), fauxToolCall("look", {})], TOOL_USE)],
      {
        tools: [required],
        most: 1,
        trace: { log, of: "solve" },
        onTool: (phase, _id, name) => {
          phases.push(`${phase} ${name}`);
        },
      },
    );
    expect(await sit(s.seat)).toMatchObject({ crash: null });
    const calls = read(log).filter(({ kind }) => kind === "solve.call");
    expect(calls.map(({ data }) => [data.tool, data.isError])).toEqual([
      ["absent", true],
      ["look", true],
    ]);
    expect(phases).toEqual(["start absent", "end absent", "start look", "end look"]);
    expect(s.faux.state.callCount).toBe(1);
  });
});

describe("durable's loop under a seat", () => {
  it("ends on a failure durable does not retry, as the provider's crash", async () => {
    const refused = fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "invalid request: bad schema",
    });
    const s = seated([refused, look], {}, "openai-codex");
    expect(await sit(s.seat)).toMatchObject({
      crash: "invalid request: bad schema",
      thrown: null,
      cut: false,
    });
    expect(s.faux.state.callCount).toBe(1);
    expect(s.looked).toEqual([]);
  });

  it("runs a round's calls one at a time, in the order the model wrote them", async () => {
    const order: string[] = [];
    const slow = tool({
      name: "slow",
      description: "Slow.",
      parameters: Type.Object({ n: Type.Number() }),
      execute: async ({ n }) => {
        order.push(`start ${String(n)}`);
        await Bun.sleep(30 - n * 10);
        order.push(`end ${String(n)}`);
        return text(String(n));
      },
    });
    const s = seated(
      [
        fauxAssistantMessage(
          [0, 1, 2].map((n) => fauxToolCall("slow", { n })),
          TOOL_USE,
        ),
        fauxAssistantMessage("Done."),
      ],
      { tools: [slow] },
    );
    await sit(s.seat);
    expect(order).toEqual(["start 0", "end 0", "start 1", "end 1", "start 2", "end 2"]);
  });

  it("gives the model a tool's throw as an error result and goes on", async () => {
    const log = join(scratch, "tool-threw.jsonl");
    const broken = tool({
      name: "look",
      description: "Look.",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("disk on fire");
      },
    });
    const s = seated([look, fauxAssistantMessage("Done.")], { tools: [broken], trace: { log, of: "build" } });
    expect(await sit(s.seat)).toMatchObject({ crash: null, thrown: null });
    expect(s.faux.state.callCount).toBe(2);
    expect(s.sent[1]).toContain("disk on fire");
    const call = read(log).find(({ kind }) => kind === "build.call");
    expect(call?.data).toMatchObject({ tool: "look", isError: true });
    expect(call?.data.text).toContain("disk on fire");
  });
});

describe("a seat's stops and its neighbours under durable", () => {
  it("aborts a running tool when a stop fires, makes no further request, and reads as cut", async () => {
    const stop = new AbortController();
    let aborted = false;
    const hang = tool({
      name: "look",
      description: "Look.",
      parameters: Type.Object({}),
      execute: async (_args, _api, context) => {
        setTimeout(() => stop.abort(), 20);
        await new Promise<void>((resolve) => context.abortSignal?.addEventListener("abort", () => resolve()));
        aborted = true;
        return text("stopped");
      },
    });
    const s = seated([look, look], { tools: [hang], stops: [stop.signal] });
    expect(await sit(s.seat)).toMatchObject({ cut: true, crash: null });
    expect(aborted).toBe(true);
    expect(s.faux.state.callCount).toBe(1);
    expect(s.shutdowns[0]?.aborted).toBe(true);
  });

  it("makes no request once a tool has spent the seat's work, whatever the round's other calls", async () => {
    let spent = false;
    const spend = tool({
      name: "spend",
      description: "Spend.",
      parameters: Type.Object({}),
      execute: async () => {
        spent = true;
        return text("spent");
      },
    });
    const s = seated([
      fauxAssistantMessage([fauxToolCall("spend", {}), fauxToolCall("look", {})], TOOL_USE),
      look,
    ]);
    Object.assign(s.seat, { tools: [spend, ...s.seat.tools], over: () => spent });
    expect(await sit(s.seat)).toMatchObject({ crash: null, cut: false });
    expect(s.faux.state.callCount).toBe(1);
  });

  it("keeps two seats sitting at once apart: their own session ids, tools and turns", async () => {
    const ids: string[][] = [[], []];
    const pair = [0, 1].map((n) =>
      seated([
        (_context, options) => {
          ids[n]?.push(options?.sessionId ?? "");
          return look;
        },
        (_context, options) => {
          ids[n]?.push(options?.sessionId ?? "");
          return fauxAssistantMessage("Done.");
        },
      ]),
    );
    await Promise.all(pair.map(({ seat }) => sit(seat)));
    for (const [n, { seat, looked }] of pair.entries()) {
      expect(ids[n]).toEqual([seat.id, seat.id]);
      expect(seat.turns).toHaveLength(2);
      expect(looked).toHaveLength(1);
    }
  });
});
