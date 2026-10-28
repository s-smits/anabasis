// A solve's ending, read from what an attempt left behind, in every order the runner settles it;
// then the plan's kill tests end to end on the faux provider, under the real command wall:
// a pass whose trace and meter read back from the log and whose hidden value reaches nothing
// the solver reads, a solve under the Starter with pi's own file tools, the host's limits over the
// harness's, the wall, no answer, the reruns of a provider's failed turn and of moved files, and
// the run stopping on the verifier's non-result.
import { afterAll, describe, expect, it, jest } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type SeatTool, sit } from "../src/agent/session.ts";
import type { Contract } from "../src/kernel/contract.ts";
import { read } from "../src/kernel/log.ts";
import { type Ending, SILENT_SECONDS } from "../src/kernel/solve.ts";
import type { Verdict } from "../src/kernel/verify.ts";
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { NUDGE } from "../src/solver/prompt.ts";
import { judge, type Played, raiseWall, solve, type SolveRequest, timed } from "../src/solver/run.ts";
import { text as toolText, tool as seatTool } from "../src/tools/answer.ts";
import { writeStarter } from "../src/harness/starter.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const CANARY = "hidden-canary-7f3a";
const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    additionalProperties: false,
    properties: { answer: { type: "string" } },
    required: ["answer"],
  },
  conventions: "",
  rules: [],
  scope: "Fixture.",
};
const LIMITS = {
  wallSeconds: 600,
  turns: 20,
  shellDefaultSeconds: 30,
  shellMaxSeconds: 60,
  concurrency: 1,
};
const walled = osIsolationSupport().ok;
const toolUse = { stopReason: "toolUse" } as const;
const scratches: string[] = [];

const PLAYED: Played = {
  crash: null,
  broken: null,
  harness: null,
  turns: [],
  prompts: 1,
  submitted: undefined,
  flagged: undefined,
  wallEnded: false,
  silentSeconds: 0,
  turnsEnded: false,
  moved: false,
  homeBytes: 0,
};
const providerStop = (text: string, errorMessage?: string) =>
  fauxAssistantMessage(text, errorMessage === undefined ? {} : { stopReason: "error", errorMessage });

function attemptEnding(played: Partial<Played>, overrides: Partial<SolveRequest> = {}) {
  return judge({ ...judgement.request, ...overrides }, "t-1-1", { ...PLAYED, ...played });
}

const noWait = async () => {};
afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** A solve of its own: a scratch folder with a copy of the fixture harness and the log, the faux
 *  model scripted with `responses`, and everything that model was sent. */
function setup(responses: FauxResponseStep[], overrides: Partial<SolveRequest> = {}) {
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-solve-run-")));
  scratches.push(scratch);
  cpSync(FIXTURE, join(scratch, "harness"), { recursive: true });
  const sent: string[] = [];
  const faux = fauxProvider({
    models: [
      {
        id: "faux-solver",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  faux.setResponses(
    responses.map((step) =>
      "role" in step
        ? (context) => {
            sent.push(JSON.stringify(context));
            return step;
          }
        : step,
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const log = join(scratch, "log.jsonl");
  const request: SolveRequest = {
    id: `run-${String(runtimeProcess.pid)}-${scratch.slice(-6)}`,
    condition: "c-fixture",
    task: { taskId: "t-1", family: "fixture", publicInput: { base: 7 }, hidden: { expect: CANARY } },
    contract: CONTRACT,
    harness: join(scratch, "harness"),
    resources: [],
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    models: () => models,
    verify: async (_task, answer): Promise<Verdict> =>
      JSON.stringify(answer) === '{"answer":"42"}' ? { kind: "pass" } : { kind: "fail", blocking: ["value"] },
    log,
    repoRoot: scratch,
    ...overrides,
  };
  const events = () => read(log);
  const finished = () => events().filter(({ kind }) => kind === "solve.finished");
  return { scratch, sent, request, events, finished };
}

// Judgement only reads this request and appends verdicts; it never opens the harness or a seat.
const judgement = setup([]);

/** The answer written into its file through the shell, which is all the fixture harness selects:
 *  it is one kept before pi's file tools were a solver's. */
const written = fauxAssistantMessage(
  fauxToolCall("bash", { command: `printf %s '{"answer":"42"}' > answer.json` }),
  toolUse,
);
const answer = [
  fauxAssistantMessage(fauxToolCall("scale_base", { factor: 6 }), toolUse),
  // The harness's own process reads what the host handed it.
  fauxAssistantMessage(fauxToolCall("read_path", { path: "input.json" }), toolUse),
  written,
  fauxAssistantMessage(fauxToolCall("submit", {}), toolUse),
];
/** Searches the solver's home for the canary, spelled so the command itself does not carry it. */
const searchHome = fauxAssistantMessage(
  fauxToolCall("bash", { command: 'grep -rl "hidden-canary-$(echo 7f3a)" "$HOME"; echo "found:$?"' }),
  toolUse,
);

/** Drive the real session hooks on a virtual thirty-minute wall, without an OS wall or a model. */
async function atWall(responses: FauxResponseStep[], tools: SeatTool[] = []) {
  jest.useFakeTimers();
  const wall = raiseWall(30 * 60);
  try {
    const { request, events } = setup(responses);
    const turns: Played["turns"][number][] = [];
    const used = {
      clock: { started: performance.now(), seconds: 30 * 60 },
      turns: () => turns.length,
      modelTurns: undefined,
    };
    const sat = await sit({
      onTurn: wall.onTurn,
      onTool: wall.onTool,
      models: request.models,
      id: request.id,
      model: request.model,
      effort: request.effort,
      system: "A solver.",
      opening: "Begin.",
      tools: tools.map((entry) => timed(entry, used)),
      trace: { log: request.log, of: "solve" },
      turns,
      stops: [wall.signal],
    });
    expect(sat).toMatchObject({ cut: true, thrown: null });
    return {
      ending: await judge(request, request.id, {
        ...PLAYED,
        turns,
        wallEnded: wall.signal.aborted,
        silentSeconds: wall.silentSeconds,
      }),
      events: events(),
    };
  } finally {
    wall.lower();
    jest.useRealTimers();
  }
}

describe("a solve's wall activity", () => {
  it("keeps a tool running through the whole silence threshold as the solver's wall-ended fail", async () => {
    const working = seatTool({
      name: "working",
      description: "Work until the wall.",
      parameters: Type.Object({}),
      execute: async () => {
        jest.advanceTimersByTime(30 * 60_000);
        return toolText("finished");
      },
    });
    const result = await atWall([fauxAssistantMessage(fauxToolCall("working", {}), toolUse)], [working]);
    expect(result.ending).toEqual({ outcome: "fail", kind: "wall-ended" });
  });

  it.each(["unavailable", "invalid arguments"])("keeps %s calls active at the wall", async (refusal) => {
    const required = seatTool({
      name: "required",
      description: "Requires a key.",
      parameters: Type.Object({ key: Type.String() }),
      execute: async () => {
        throw new Error("refused arguments reached the tool");
      },
    });
    const replies: FauxResponseStep[] = Array.from({ length: 14 }, () => () => {
      jest.advanceTimersByTime(2 * 60_000);
      return fauxAssistantMessage(
        fauxToolCall(refusal === "unavailable" ? "absent" : "required", {}),
        toolUse,
      );
    });
    replies.push(() => {
      jest.advanceTimersByTime(2 * 60_000);
      return providerStop("", "aborted at the wall");
    });
    const result = await atWall(replies, [required]);
    expect(result.ending).toEqual({ outcome: "fail", kind: "wall-ended" });
    const calls = result.events.filter(({ kind }) => kind === "solve.call");
    expect(calls).toHaveLength(14);
    expect(calls.every(({ data }) => data.isError === true)).toBe(true);
  });

  it("reads a model producing no completed turn through the whole silence as the provider's non-result", async () => {
    const result = await atWall([
      () => {
        jest.advanceTimersByTime(30 * 60_000);
        return providerStop("", "aborted at the wall");
      },
    ]);
    expect(result.ending).toMatchObject({ outcome: "non-result", kind: "provider" });
    expect("reason" in result.ending && result.ending.reason.match(/\d+/)?.[0]).toBe("30");
    expect(result.events.filter(({ kind }) => kind === "solve.turn")).toHaveLength(0);
  });
});

describe("a solve's ending precedence", () => {
  it("is a kill, then moved files, then a held answer, before the sandbox's crash", async () => {
    const kill = AbortSignal.abort();
    const all = { crash: "the model process died", moved: true, submitted: { answer: "42" } };
    expect(await attemptEnding(all, { kill })).toMatchObject({ kind: "killed" });
    expect(await attemptEnding(all)).toMatchObject({ kind: "moved-files" });
    // Once the host holds the answer, what failed after it is cleanup and voids nothing.
    expect(await attemptEnding({ ...all, moved: false })).toEqual({ outcome: "pass" });
    expect(
      await attemptEnding({ submitted: { answer: "42" }, wallEnded: true, flagged: "malformed" }),
    ).toEqual({ outcome: "pass" });
    expect(await attemptEnding({ flagged: "malformed", crash: "died" })).toEqual({
      outcome: "flagged",
      reason: "malformed",
    });
    expect(await attemptEnding({ ...all, moved: false, submitted: undefined })).toEqual({
      outcome: "non-result",
      kind: "sandbox-crash",
      reason: "the model process died",
    });
  });

  it("orders the wall, turn budget, context and provider endings when no answer is held", async () => {
    const overflow = providerStop("", "prompt is too long: 213462 tokens > 200000 maximum");
    const length = fauxAssistantMessage("", { stopReason: "length" });
    const done = providerStop("I am done.");
    for (const [played, expected] of [
      [
        { wallEnded: true, turns: [overflow] },
        { outcome: "fail", kind: "wall-ended" },
      ],
      [
        { wallEnded: true, silentSeconds: SILENT_SECONDS - 1 },
        { outcome: "fail", kind: "wall-ended" },
      ],
      [{ silentSeconds: SILENT_SECONDS }, { outcome: "fail", kind: "no-answer" }],
      [
        { turnsEnded: true, turns: [done] },
        { outcome: "fail", kind: "turns-ended" },
      ],
      [
        { turnsEnded: true, wallEnded: true },
        { outcome: "fail", kind: "wall-ended" },
      ],
      [
        { turnsEnded: true, turns: [providerStop("", "API Error: 529 overloaded")] },
        { outcome: "non-result", kind: "provider", reason: "API Error: 529 overloaded" },
      ],
      [{ turnsEnded: true, submitted: { answer: "42" } }, { outcome: "pass" }],
      [{ turns: [overflow] }, { outcome: "fail", kind: "context-ended" }],
      [{ turns: [length] }, { outcome: "fail", kind: "context-ended" }],
      [
        { turnsEnded: true, turns: [overflow] },
        { outcome: "fail", kind: "context-ended" },
      ],
      [
        { turnsEnded: true, turns: [length] },
        { outcome: "fail", kind: "context-ended" },
      ],
      [
        { turns: [providerStop("", "overloaded_error")] },
        { outcome: "non-result", kind: "provider", reason: "overloaded_error" },
      ],
      [{ turns: [done] }, { outcome: "fail", kind: "no-answer" }],
    ] satisfies [Partial<Played>, Ending][]) {
      expect(await attemptEnding(played)).toEqual(expected);
    }
    const silent = await attemptEnding({ wallEnded: true, silentSeconds: SILENT_SECONDS });
    expect(silent).toMatchObject({ outcome: "non-result", kind: "provider" });
    expect("reason" in silent && silent.reason.match(/\d+/)?.[0]).toBe("10");
  });
});

// Independent solves run side by side under the real wall, Seatbelt or Bubblewrap.
describe.skipIf(!walled)("a solve under the real wall", () => {
  it.concurrent("passes on a written, submitted answer, its trace and meter read back from the log", async () => {
    const { sent, request, events, finished } = setup([searchHome, ...answer]);
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    expect(events().map(({ kind }) => kind)).toEqual([
      "solve.started",
      ...Array.from({ length: 5 }, () => ["solve.turn", "solve.call"] as const).flat(),
      "verdict",
      "solve.finished",
    ]);
    const calls = events()
      .filter(({ kind }) => kind === "solve.call")
      .map(({ data }) => data);
    expect(calls.map(({ tool, isError }) => [tool, isError])).toEqual([
      ["bash", false],
      ["scale_base", false],
      ["read_path", false],
      ["bash", false],
      ["submit", false],
    ]);
    expect(calls[0]?.text).toContain("found:1");
    // Every result ends with the solve time used, which is all the clock a solver has.
    const scaled = calls[1]?.text;
    if (!isString(scaled)) throw new Error("Missing scale result");
    for (const fact of ["t-1", "fixture", "42"]) expect(scaled).toContain(fact);
    expect(scaled.match(/\b\d+:\d\d\b/g)).toEqual([expect.stringMatching(/^0:\d\d$/), "10:00"]);
    expect(calls[2]?.text).toContain('"publicInput":{"base":7}');
    const [done] = finished();
    // Five turns of the model answered one prompt: the two are counted apart, and a budget read
    // in either is read from its own count (`src/kernel/compare.ts`).
    expect(done?.data.turns).toBe(5);
    expect(done?.data.prompts).toBe(1);
    expect(done?.data.billed).toBeGreaterThan(0);
    expect(done?.data.metered).toBeGreaterThan(0);
    expect(done?.data.harness).toMatch(/^[0-9a-f]{64}$/);
    // A solve's end holds no CPU figure since 2026-10-11: the meter read zero under Bubblewrap.
    expect(done?.data).not.toHaveProperty("cpu");
    const record = (kind: string) => events().find((event) => event.kind === kind)?.data;
    expect(record("solve.started")?.condition).toBe("c-fixture");
    // A solve nobody asked for a comparison names none.
    expect(record("solve.started")).not.toHaveProperty("comparison");
    expect(record("verdict")?.answer).toEqual({ answer: "42" });

    // Exit test 5: the hidden value reaches nothing the solver reads: the prompt, the tool rows,
    // the first turn and every tool result among them, the harness's process, and its home.
    expect(sent.join("\n")).not.toContain(CANARY);
    // Each tool is described in its own words, and the fixture's writer, which took the answer
    // before the answer was a file, is given to no solver.
    expect(sent[0]).toContain('"name":"scale_base"');
    expect(sent[0]).not.toContain("Role: ");
    expect(sent[0]).not.toContain("Records the answer.");
    expect(sent[0]).toContain("answer.json");
    // The fixture selects the shell alone, so pi's file tools and their rules are not in its prompt.
    expect(sent[0]).toContain('"name":"bash"');
    expect(sent[0]).not.toContain("Use read");
  }, 120_000);

  it.concurrent("solves under the Starter with pi's file tools, in one working directory", async () => {
    const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);
    const { scratch, sent, request, events } = setup(
      [
        call("read", { path: "public/task.json" }),
        call("read", { path: "public/answer-format.json" }),
        call("write", { path: "work/answer.py", content: 'print(\'{"answer": "41"}\')\n' }),
        call("edit", { path: "work/answer.py", edits: [{ oldText: "41", newText: "42" }] }),
        // The file a tool wrote is the shell's by the same relative path.
        call("bash", {
          command:
            'python3 work/answer.py > answer.json 2>/dev/null || printf %s \'{"answer":"42"}\' > answer.json; pwd',
        }),
        call("submit", {}),
      ],
      { resources: [{ name: "public rules", content: [{ id: "r1" }], digest: "d" }] },
    );
    rmSync(join(scratch, "harness"), { recursive: true });
    writeStarter(join(scratch, "harness"));
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    const calls = events()
      .filter(({ kind }) => kind === "solve.call")
      .map(({ data }) => data);
    expect(calls.map(({ tool, isError }) => [tool, isError])).toEqual([
      ["read", false],
      ["read", false],
      ["write", false],
      ["edit", false],
      ["bash", false],
      ["submit", false],
    ]);
    expect(calls[0]?.text).toContain('"base": 7');
    expect(calls[1]?.text).toContain('"additionalProperties": false');
    expect(calls[4]?.text).toMatch(/\/home\n+\[Solve time used: 0:\d\d of 10:00\]$/);
    // The Starter adds no tool to pi: its four tools and submit, pi's prompt with the host's part,
    // and the starter instructions as the project's.
    expect(sent[0]).toContain('"name":"submit"');
    expect(sent[0]).toContain("answer.json");
    expect(sent[0]).toContain("1 file");
    expect(sent[0]).toContain("public/resources/");
    for (const seconds of [30, 60]) expect(sent[0]).toContain(`${String(seconds)} seconds`);
    expect(sent[0]).toContain("<project_context>");
  }, 120_000);

  it.concurrent("nudges a model that stops, up to the host's prompts whatever the harness asks", async () => {
    // The cap counts prompts, as v1's maxTurns did: the opening one and one nudge here, each
    // answered by a turn that calls a tool and then stops without submitting.
    const scale = fauxAssistantMessage(fauxToolCall("scale_base", { factor: 1 }), toolUse);
    const stop = fauxAssistantMessage("Done.");
    const { scratch, sent, request, events, finished } = setup([scale, stop, scale, stop, scale, stop], {
      limits: { ...LIMITS, wallSeconds: 300, turns: 2 },
      comparison: "g0",
    });
    writeFileSync(
      join(scratch, "harness", "agent", "config.yaml"),
      "solver:\n  solve_minutes: 999\n  max_turns: 9999\nshell:\n  default_seconds: 900\n  max_seconds: 9000\n",
    );
    expect(await solve(request, noWait)).toEqual({ outcome: "fail", kind: "no-answer" });
    // Two prompts, the cap, and four turns of the model in answer to them.
    expect(finished()[0]?.data).toMatchObject({ turns: 4, prompts: 2 });
    // Each attempt's start names the comparison the solve was made for.
    expect(events().find(({ kind }) => kind === "solve.started")?.data.comparison).toBe("g0");
    expect(sent).toHaveLength(4);
    expect(sent[0]).toContain("5 minutes");
    expect(sent[1]).not.toContain(NUDGE);
    expect(sent[2]).toContain(JSON.stringify(NUDGE));
  }, 120_000);

  it.concurrent("ends flagged once, with no verdict, where the solver says the task is malformed", async () => {
    const reason = "The span is given twice, as 4 m and 5 m.";
    const { events, finished, request, sent } = setup([
      fauxAssistantMessage(
        [fauxToolCall("submit", { malformed: reason }), fauxToolCall("bash", { command: "true" })],
        toolUse,
      ),
    ]);
    expect(await solve(request, noWait)).toEqual({ outcome: "flagged", reason });
    // Not run again as a non-result is, and judged by no check.
    expect(finished()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(events().some(({ kind }) => kind === "verdict")).toBe(false);
  }, 120_000);

  it.concurrent("ends at the model's turns where it is given a number of them, and says each turn", async () => {
    const scale = fauxAssistantMessage(fauxToolCall("scale_base", { factor: 1 }), toolUse);
    const limits = { ...LIMITS, modelTurns: 3 };
    const spent = setup([scale, scale, scale, scale, scale], { limits });
    expect(await solve(spent.request, noWait)).toEqual({ outcome: "fail", kind: "turns-ended" });
    // Three turns and no fourth, though the model went on calling: the opening prompt was enough.
    expect(spent.finished()[0]?.data).toMatchObject({ turns: 3, prompts: 1 });
    expect(spent.sent).toHaveLength(3);
    expect(spent.sent[0]).toContain("10 minutes");
    expect(spent.sent[0]).toContain("3 turns");
    const said = spent
      .events()
      .flatMap(({ kind, data }) => (kind === "solve.call" && isString(data.text) ? [data.text] : []));
    expect(said.map((text) => text.match(/Turn (\d+) of (\d+)/)?.slice(1))).toEqual([
      ["1", "3"],
      ["2", "3"],
      ["3", "3"],
    ]);
    for (const text of said) {
      expect(text.match(/\b\d+:\d\d\b/g)).toEqual([expect.stringMatching(/^0:\d\d$/), "10:00"]);
    }
    // An answer submitted in the last turn is held and judged: the turn's calls run before it ends.
    const last = setup([written, scale, fauxAssistantMessage(fauxToolCall("submit", {}), toolUse)], {
      limits,
    });
    expect(await solve(last.request, noWait)).toEqual({ outcome: "pass" });
    expect(last.finished()[0]?.data).toMatchObject({ turns: 3 });
  }, 120_000);

  it.each(["after shell", "before shell"])(
    "ends on submit %s in the same turn",
    async (order) => {
      const shell = fauxToolCall("bash", { command: `printf %s '{"answer":"42"}' > answer.json` });
      const submit = fauxToolCall("submit", {});
      const responses =
        order === "after shell"
          ? [fauxAssistantMessage([shell, submit], toolUse), written, written]
          : [
              written,
              fauxAssistantMessage([submit, fauxToolCall("bash", { command: "true" })], toolUse),
              written,
            ];
      const { request, sent, finished } = setup(responses);
      expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
      const turns = order === "after shell" ? 1 : 2;
      expect(finished()).toHaveLength(1);
      expect(finished()[0]?.data).toMatchObject({ turns, prompts: 1 });
      expect(sent).toHaveLength(turns);
    },
    120_000,
  );

  it.concurrent("ends wall-ended when the wall falls mid-command", async () => {
    const sleep = fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 20" }), toolUse);
    const { request, events } = setup([sleep, sleep], { limits: { ...LIMITS, wallSeconds: 3 } });
    expect(await solve(request, noWait)).toEqual({ outcome: "fail", kind: "wall-ended" });
    // The wall cut the command it fell in, rather than waiting the 20 s out.
    const call = events().find(({ kind }) => kind === "solve.call");
    expect(call?.data).toMatchObject({ tool: "bash", isError: true });
    expect(call?.data.ms).toBeLessThan(15_000);
  }, 120_000);

  it.concurrent("cuts a command before the solve's end, so the solver can still answer", async () => {
    // A 24-second solve reserves three seconds for an answer after its command is cut.
    const long = fauxAssistantMessage(
      fauxToolCall("bash", { command: "echo began; sleep 50", timeout: 60 }),
      toolUse,
    );
    const submit = fauxAssistantMessage(fauxToolCall("submit", {}), toolUse);
    const { request, events } = setup([long, written, submit], { limits: { ...LIMITS, wallSeconds: 24 } });
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    const [cut] = events().flatMap(({ kind, data }) => (kind === "solve.call" ? [data] : []));
    expect(cut).toMatchObject({ tool: "bash", isError: true });
    expect(cut?.text).toContain("began");
    expect(cut?.text).toMatch(/\b2[01] seconds\b/);
    expect(cut?.text).toMatch(/0:2\d of 0:24/);
  }, 120_000);

  it.concurrent("reruns a failed provider turn three times, then reports it as the provider's non-result", async () => {
    const closed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "WebSocket closed 1000" });
    const { request, finished } = setup([closed, closed, closed, closed]);
    const waits: number[] = [];
    const ending = await solve(request, async (ms) => {
      waits.push(ms);
    });
    expect(ending).toEqual({ outcome: "non-result", kind: "provider", reason: "WebSocket closed 1000" });
    expect(waits).toEqual([30_000, 60_000, 120_000]);
    expect(finished()).toHaveLength(4);
  }, 120_000);

  it.concurrent("waits out repeated named resets without spending a rerun, between ordinary provider failures", async () => {
    const until = Math.ceil(Date.now() / 1000) + 3600;
    const limited = fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: `Claude Code: usage limit (limit reached|${String(until)})`,
    });
    const closed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "WebSocket closed 1000" });
    const { request, finished, events } = setup([
      closed,
      limited,
      limited,
      limited,
      limited,
      closed,
      closed,
      ...answer,
    ]);
    const waits: number[] = [];
    const ending = await solve(request, async (ms) => {
      waits.push(ms);
    });
    expect(ending).toEqual({ outcome: "pass" });
    expect(waits.filter((ms) => ms <= 120_000)).toEqual([30_000, 60_000, 120_000]);
    const waited = events().filter(({ kind }) => kind === "campaign.waited");
    expect(waited).toHaveLength(4);
    expect(
      waited.every(
        ({ data }) => data.for === "provider" && data.until === new Date(until * 1000).toISOString(),
      ),
    ).toBe(true);
    expect(waits.filter((ms) => ms > 120_000).every((ms) => ms > 3_500_000 && ms <= 3_661_000)).toBe(true);
    expect(finished()).toHaveLength(8);
    expect(new Set(finished().map(({ data }) => data.solve)).size).toBe(8);
  }, 120_000);

  it.concurrent("returns the ending when killed in a named-reset wait even when the stub sleep never finishes", async () => {
    const limited = fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: `limit reached|${String(Math.ceil(Date.now() / 1000) + 3600)}`,
    });
    const kill = new AbortController();
    const { request, finished, events } = setup([limited, ...answer]);
    const ending = await solve({ ...request, kill: kill.signal }, async () => {
      kill.abort();
      await Promise.withResolvers<void>().promise;
    });
    expect(ending).toMatchObject({ outcome: "non-result", kind: "provider" });
    expect(events().filter(({ kind }) => kind === "campaign.waited")).toHaveLength(1);
    expect(finished()).toHaveLength(1);
  }, 120_000);

  it.concurrent("starts no rerun once the solve is killed during its wait", async () => {
    const closed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "WebSocket closed 1000" });
    const kill = new AbortController();
    const { request, finished } = setup([closed, closed]);
    const ending = await solve({ ...request, kill: kill.signal }, async () => {
      kill.abort();
    });
    expect(ending).toMatchObject({ outcome: "non-result", kind: "provider" });
    expect(finished()).toHaveLength(1);
  }, 120_000);

  it.concurrent("reruns a solve whose harness files moved, and the rerun counts", async () => {
    // The first attempt's model writes into the harness mid-solve; the second finds it settled.
    let harness = "";
    const move: FauxResponseStep = () => {
      writeFileSync(join(harness, "agent", "planted.ts"), "export {};\n");
      return fauxAssistantMessage("Planted.");
    };
    const { request, finished } = setup([move, ...answer], { limits: { ...LIMITS, turns: 1 } });
    harness = request.harness;
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    expect(finished().map(({ data }) => data.ending)).toEqual([
      { outcome: "non-result", kind: "moved-files", reason: `${harness} changed during the solve` },
      { outcome: "pass" },
    ]);
  }, 120_000);

  it.concurrent("stops the run on the verifier's non-result, once the solve is logged", async () => {
    const { request, finished } = setup(answer, {
      verify: async () => ({ kind: "non-result", reason: "value: the wall broke" }),
    });
    await expect(solve(request, noWait)).rejects.toThrow(/t-1.*value/);
    expect(finished().at(-1)?.data.ending).toMatchObject({ outcome: "non-result", kind: "verifier" });
  }, 120_000);

  it.concurrent("judges an answer whose home cannot be walked, its size unknown", async () => {
    const lock = fauxAssistantMessage(
      fauxToolCall("bash", { command: 'mkdir -p "$HOME/locked/x" && chmod 0 "$HOME/locked"' }),
      toolUse,
    );
    const { request, finished } = setup([lock, ...answer]);
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    expect(finished().map(({ data }) => data.homeBytes)).toEqual([null]);
  }, 120_000);

  it.concurrent("fails a harness whose tools do not bundle once, with no rerun", async () => {
    const { request, finished } = setup([]);
    writeFileSync(join(request.harness, "agent", "tools.ts"), "export const = ;\n");
    expect(await solve(request, noWait)).toMatchObject({ outcome: "fail", kind: "broken-harness" });
    expect(finished().map(({ data }) => data.harness)).toEqual([null]);
  }, 120_000);

  it.concurrent("returns a faulty check's ending once, neither rerun nor stopping the run", async () => {
    const { request, finished } = setup(answer, {
      verify: async () => ({ kind: "faulty", check: "value", reason: "the check threw: x" }),
    });
    expect(await solve(request, noWait)).toMatchObject({ outcome: "non-result", kind: "check" });
    expect(finished()).toHaveLength(1);
  }, 120_000);
});
