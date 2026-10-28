import { afterAll, describe, expect, it } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { sit, type Seat } from "../src/agent/session.ts";
import { tracesIn } from "../src/kernel/trace.ts";
import { read } from "../src/kernel/log.ts";
import { text, tool } from "../src/tools/answer.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const home = mkdtempSync(join(tmpdir(), "ana-compaction-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

function session(name: string, options: { failure?: boolean } = {}) {
  const faux = fauxProvider({
    provider: "faux",
    models: [
      {
        id: "compact",
        contextWindow: 45_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const log = join(home, `${name}.jsonl`);
  const summaries: string[] = [];
  const after: string[] = [];
  faux.setResponses(
    Array.from({ length: 50 }, () => (context) => {
      const prompt = JSON.stringify(context);
      if (prompt.includes("context summarization assistant")) {
        summaries.push(prompt);
        return options.failure === true
          ? fauxAssistantMessage("", { stopReason: "error", errorMessage: "summary refused" })
          : fauxAssistantMessage("The earlier steps were completed.");
      }
      after.push(prompt);
      return fauxAssistantMessage(fauxToolCall("look", {}), { stopReason: "toolUse" });
    }),
  );
  const seat: Seat = {
    models: () => models,
    id: name,
    model: faux.getModel(),
    effort: "medium",
    system: "Solve.",
    opening: "Begin.",
    tools: [
      tool({
        name: "look",
        description: "Look.",
        parameters: Type.Object({}),
        execute: async () => text("x".repeat(8_000)),
      }),
    ],
    turns: [],
    stops: [],
    most: 24,
    trace: { log, of: "solve" },
  };
  return { seat, log, summaries, after, faux };
}

describe("durable compaction", () => {
  it("summarises through durable, traces the summary usage and bills it with the turns", async () => {
    const s = session("summarised");
    const sat = await sit(s.seat);
    expect(sat.crash).toBeNull();
    expect(s.summaries.length).toBeGreaterThan(0);
    expect(s.after.some((prompt) => prompt.includes("The earlier steps were completed."))).toBe(true);
    const events = read(s.log);
    const compacted = events.filter(({ kind }) => kind === "solve.compacted");
    expect(compacted.length).toBe(s.summaries.length);
    expect(compacted[0]?.data).toMatchObject({ error: null });
    expect(compacted[0]?.data.usages).toHaveLength(1);
    const billed = tracesIn(events).reduce(
      (sum, part) => sum + (part.part === "call" ? 0 : (part.billed ?? 0)),
      0,
    );
    expect(sat.spent.billed).toBeCloseTo(billed, 8);
  });

  it("retains the billed usage of a failed summary and ends the session as a crash", async () => {
    const s = session("failed", { failure: true });
    const sat = await sit(s.seat);
    expect(s.summaries).toHaveLength(1);
    expect(sat.crash).toContain("summary refused");
    const event = read(s.log).find(({ kind }) => kind === "solve.compacted");
    expect(event?.data.error).toContain("summary refused");
    expect(event?.data.usages).toHaveLength(1);
    expect(sat.spent.tokens.input).toBeGreaterThan(0);
  });

  it("runs the host bound before compaction and makes no summary when it throws", async () => {
    const s = session("bound");
    let checked = 0;
    Object.assign(s.seat, {
      before: () => {
        if (++checked === 15) throw new Error("bound");
      },
    });
    const sat = await sit(s.seat);
    expect(sat.thrown).toBe("bound");
    expect(s.summaries).toHaveLength(0);
    expect(s.faux.state.callCount).toBeLessThan(24);
  });
});
