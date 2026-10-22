import { afterAll, describe, expect, it } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
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
import { type Seat, sit } from "../src/seat/session.ts";
import { text, tool } from "../src/solve/answer.ts";

const scratch = mkdtempSync(join(tmpdir(), "ana-seat-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TOOL_USE = { stopReason: "toolUse" } as const;
const look = fauxAssistantMessage([fauxToolCall("look", {})], TOOL_USE);

/** A seat on the faux provider that answers `responses` in order, with one tool, `look`, whose
 *  every call is pushed to `looked` with the signal it ran under; `sent` holds each context. */
function seated(responses: readonly FauxResponseStep[], over: Partial<Seat> = {}) {
  const faux = fauxProvider({
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
  const looking: AgentTool = tool({
    name: "look",
    label: "Look",
    description: "Look.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    execute: async (_id, _args, signal = new AbortController().signal) => {
      looked.push(signal);
      return text("seen");
    },
  });
  const seat: Seat = {
    models: (home) => {
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
  return { seat, sent, looked, homes };
}

describe("a seat's session", () => {
  it("ends when its work is over, at its turn cap, or when a stop fires, and a cut one has no crash", async () => {
    let calls = 0;
    const done = seated([look, look, look], { over: () => ++calls >= 2 });
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
        open = s.looked.map((signal) => !signal.aborted);
      },
    });
    await sit(s.seat);
    expect(open).toEqual([true]);
    expect(s.looked.every((signal) => signal.aborted)).toBe(true);
    expect(s.homes.map(existsSync)).toEqual([false]);

    const own = join(scratch, "own-home");
    const kept = seated([fauxAssistantMessage("Done.")], { home: own });
    await sit(kept.seat);
    expect(kept.homes).toEqual([own]);
  });

  it("traces its turns and calls under its kind, metering a turn before its tools run where it meters early", async () => {
    for (const early of [false, true]) {
      const log = join(scratch, `trace-${String(early)}.jsonl`);
      const s = seated([look, fauxAssistantMessage("Done.")], { trace: { log, of: "build" }, early });
      await sit(s.seat);
      const kinds = read(log).map(({ kind }) => kind);
      expect(kinds).toEqual(
        early ? ["build.turn", "build.call", "build.turn"] : ["build.call", "build.turn", "build.turn"],
      );
    }
  });
});
