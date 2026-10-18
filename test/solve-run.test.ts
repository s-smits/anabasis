// A solve's ending, read from what an attempt left behind, in every order the runner settles it;
// then the plan's kill tests end to end on the faux provider, under the real command wall and disk
// cap: a pass whose trace and meter read back from the log and whose hidden value reaches nothing
// the solver reads, a solve under the Starter with pi's own file tools, the host's limits over the
// harness's, the wall, no answer, the reruns of a provider's failed turn and of moved files, and
// the run stopping on the verifier's non-result.
import { afterAll, describe, expect, it } from "bun:test";
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { Contract } from "../src/kernel/contract.ts";
import { read } from "../src/kernel/log.ts";
import { passed } from "../src/kernel/solves.ts";
import type { Verdict } from "../src/kernel/verify.ts";
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { NUDGE } from "../src/solve/prompt.ts";
import { judge, type Played, solve, type SolveRequest } from "../src/solve/run.ts";
import { writeStarter } from "../src/solve/starter.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";

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
  diskBytes: 64 * 1024 * 1024,
};
const walled = osIsolationSupport().ok;
const toolUse = { stopReason: "toolUse" } as const;
const scratches: string[] = [];

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

describe("an attempt's ending", () => {
  const PLAYED: Played = {
    crash: null,
    broken: null,
    harness: null,
    turns: [],
    prompts: 1,
    submitted: undefined,
    flagged: undefined,
    wallEnded: false,
    turnsEnded: false,
    moved: false,
    homeBytes: 0,
    summaries: [],
  };
  const stop = (text: string, errorMessage?: string) =>
    fauxAssistantMessage(text, errorMessage === undefined ? {} : { stopReason: "error", errorMessage });

  function ending(played: Partial<Played>, overrides: Partial<SolveRequest> = {}) {
    const { request, events } = setup([], overrides);
    return { ending: judge(request, "t-1-1", { ...PLAYED, ...played }), events };
  }

  it("is a kill, then moved files, then a held answer, before the sandbox's crash", async () => {
    const kill = AbortSignal.abort();
    const all = { crash: "the model process died", moved: true, submitted: { answer: "42" } };
    expect(await ending(all, { kill }).ending).toMatchObject({ kind: "killed" });
    expect(await ending(all).ending).toMatchObject({ kind: "moved-files" });
    // Once the host holds the answer, what failed after it is cleanup and voids nothing.
    expect(await ending({ ...all, moved: false }).ending).toEqual({ outcome: "pass" });
    expect(await ending({ ...all, moved: false, submitted: undefined }).ending).toEqual({
      outcome: "non-result",
      kind: "sandbox-crash",
      reason: "the model process died",
    });
  });

  it("is flagged where the solver said the task is malformed, after an answer and before a crash", async () => {
    const flagged = { flagged: "the span is given twice, as 4 m and 5 m", crash: "the model process died" };
    expect(await ending(flagged).ending).toEqual({ outcome: "flagged", reason: flagged.flagged });
    expect(await ending({ ...flagged, submitted: { answer: "42" } }).ending).toEqual({ outcome: "pass" });
    // Its own outcome, and in every tally the flagging side's fail.
    expect(passed({ ending: { outcome: "flagged", reason: flagged.flagged } })).toBe(false);
  });

  it("judges a submitted answer even when the wall fell after it, and logs the verdict", async () => {
    const { ending: settled, events } = ending({ submitted: { answer: "41" }, wallEnded: true });
    expect(await settled).toEqual({ outcome: "fail", kind: "rejected" });
    expect(events().map(({ kind, data }) => [kind, data.kind])).toEqual([["verdict", "fail"]]);
    expect(await ending({ submitted: { answer: "42" } }).ending).toEqual({ outcome: "pass" });
  });

  it("rejects an answer off the contract's format without running a check", async () => {
    let checked = false;
    const verify = async (): Promise<Verdict> => {
      checked = true;
      return { kind: "pass" };
    };
    const { ending: settled, events } = ending({ submitted: { answer: 42 } }, { verify });
    expect(await settled).toEqual({ outcome: "fail", kind: "rejected" });
    expect(checked).toBe(false);
    expect(events()[0]?.data.fault).toBeString();
  });

  it("is the verifier's non-result when the checks cannot decide, and the check's when one is faulty", async () => {
    const lost = async (): Promise<Verdict> => ({ kind: "non-result", reason: "value: the wall broke" });
    expect(await ending({ submitted: { answer: "42" } }, { verify: lost }).ending).toEqual({
      outcome: "non-result",
      kind: "verifier",
      reason: "value: the wall broke",
    });
    const faulty = async (): Promise<Verdict> => ({
      kind: "faulty",
      check: "value",
      reason: "the check threw: x",
    });
    expect(await ending({ submitted: { answer: "42" } }, { verify: faulty }).ending).toEqual({
      outcome: "non-result",
      kind: "check",
      reason: "value: the check threw: x",
    });
  });

  it("without an answer: the wall, the model's turns, the context, a provider failure, else no answer", async () => {
    const overflow = stop("", "prompt is too long: 213462 tokens > 200000 maximum");
    expect(await ending({ wallEnded: true, turns: [overflow] }).ending).toMatchObject({ kind: "wall-ended" });
    // A solve given a number of model turns that used them all ended there, whatever its last turn
    // was; one that submitted in its last turn is judged on the answer.
    expect(await ending({ turnsEnded: true, turns: [stop("I am done.")] }).ending).toEqual({
      outcome: "fail",
      kind: "turns-ended",
    });
    expect(await ending({ turnsEnded: true, wallEnded: true }).ending).toMatchObject({ kind: "wall-ended" });
    // A last allowed turn the provider failed is the provider's, and no loss of the solver's.
    expect(await ending({ turnsEnded: true, turns: [stop("", "API Error: 529 overloaded")] }).ending).toEqual(
      {
        outcome: "non-result",
        kind: "provider",
        reason: "API Error: 529 overloaded",
      },
    );
    expect(await ending({ turnsEnded: true, submitted: { answer: "42" } }).ending).toEqual({
      outcome: "pass",
    });
    expect(await ending({ turns: [overflow] }).ending).toEqual({ outcome: "fail", kind: "context-ended" });
    const length = fauxAssistantMessage("", { stopReason: "length" });
    expect(await ending({ turns: [length] }).ending).toMatchObject({ kind: "context-ended" });
    expect(await ending({ turns: [stop("", "overloaded_error")] }).ending).toEqual({
      outcome: "non-result",
      kind: "provider",
      reason: "overloaded_error",
    });
    expect(await ending({ turns: [stop("I am done.")] }).ending).toEqual({
      outcome: "fail",
      kind: "no-answer",
    });
  });

  it("is the harness's own fail when its tools could not be bundled or listed", async () => {
    expect(await ending({ broken: "harness bundle failed", wallEnded: true }).ending).toEqual({
      outcome: "fail",
      kind: "broken-harness",
      reason: "harness bundle failed",
    });
  });
});

// Each of these runs the real wall, Seatbelt or Bubblewrap, and on macOS mounts a disk image, so
// they run side by side.
describe.skipIf(!walled)("a solve end to end", () => {
  it.concurrent("passes on a written, submitted answer, its trace and meter read back from the log", async () => {
    const { sent, request, events, finished } = setup([searchHome, ...answer]);
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    expect(events().map(({ kind }) => kind)).toEqual([
      "solve.started",
      ...Array.from({ length: 5 }, () => ["solve.call", "solve.turn"] as const).flat(),
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
    expect(calls[1]?.text).toMatch(/^t-1 \(fixture\): 42\n\[Solve time used: 0:\d\d of 10:00\]$/);
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
    expect(sent[0]).toContain('"description":"Returns the task\'s base multiplied by a factor."');
    expect(sent[0]).not.toContain("Role: ");
    expect(sent[0]).not.toContain("Records the answer.");
    expect(sent[0]).toContain("Send answer.json from your working directory as your answer.");
    // The fixture selects the shell alone, so pi's file tools and their rules are not in its prompt.
    expect(sent[0]).toContain(
      String.raw`<tools>\n- bash: Execute bash commands (ls, grep, find, etc.)\n- submit: `,
    );
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
    // The Starter adds nothing to pi: its four tools and submit, and pi's prompt with the host's part.
    expect(sent[0]).toContain("You are an expert coding assistant operating inside pi");
    expect(sent[0]).toContain("- submit: Send answer.json as your answer, which ends the task");
    expect(sent[0]).toContain("in the 1 file under public/resources/; read both before you build.");
    expect(sent[0]).toContain(
      "- A command runs for at most 30 seconds unless it names a longer timeout, and 60 seconds is the longest it may name.",
    );
    expect(sent[0]).not.toContain("<project_context>");
  }, 120_000);

  it.concurrent("ends no-answer at one prompt, with no nudge", async () => {
    const { request, sent, finished } = setup([fauxAssistantMessage("I am done.")], {
      limits: { ...LIMITS, turns: 1 },
    });
    expect(await solve(request, noWait)).toEqual({ outcome: "fail", kind: "no-answer" });
    expect(finished()[0]?.data).toMatchObject({ turns: 1, prompts: 1 });
    expect(sent).toHaveLength(1);
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
    expect(sent[0]).toContain("The case has 5 minutes of solve time, and every tool result ends with");
    expect(sent[1]).not.toContain(NUDGE);
    expect(sent[2]).toContain(JSON.stringify(NUDGE));
  }, 120_000);

  it.concurrent("ends flagged once, with no verdict, where the solver says the task is malformed", async () => {
    const reason = "The span is given twice, as 4 m and 5 m.";
    const { events, finished, request } = setup([
      fauxAssistantMessage(fauxToolCall("submit", { malformed: reason }), toolUse),
    ]);
    expect(await solve(request, noWait)).toEqual({ outcome: "flagged", reason });
    // Not run again as a non-result is, and judged by no check.
    expect(finished()).toHaveLength(1);
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
    expect(spent.sent[0]).toContain(
      "The case has 10 minutes of solve time and 3 turns of yours, a turn being one reply of yours with the tool calls in it. Every tool result ends with how much of both is used. Nothing is submitted for you when either runs out: an answer you have not submitted by then is lost.",
    );
    const said = spent
      .events()
      .flatMap(({ kind, data }) => (kind === "solve.call" && isString(data.text) ? [data.text] : []));
    expect(
      said.map((text) =>
        text
          .split("\n")
          .at(-1)
          ?.replace(/0:\d\d/, "0:00"),
      ),
    ).toEqual([
      "[Solve time used: 0:00 of 10:00. Turn 1 of 3]",
      "[Solve time used: 0:00 of 10:00. Turn 2 of 3]",
      "[Solve time used: 0:00 of 10:00. Turn 3 of 3]",
    ]);
    // An answer submitted in the last turn is held and judged: the turn's calls run before it ends.
    const last = setup([written, scale, fauxAssistantMessage(fauxToolCall("submit", {}), toolUse)], {
      limits,
    });
    expect(await solve(last.request, noWait)).toEqual({ outcome: "pass" });
    expect(last.finished()[0]?.data).toMatchObject({ turns: 3 });
  }, 120_000);

  it.concurrent("ends on a submit sent in the same turn as a shell call", async () => {
    // pi ends its loop on a turn only where every call returned `terminate`, which a shell call never
    // does: until 12 October the model was asked again after its answer was in.
    const both = fauxAssistantMessage(
      [
        fauxToolCall("bash", { command: `printf %s '{"answer":"42"}' > answer.json` }),
        fauxToolCall("submit", {}),
      ],
      toolUse,
    );
    const scale = fauxAssistantMessage(fauxToolCall("scale_base", { factor: 1 }), toolUse);
    const { request, sent, finished } = setup([both, scale, scale]);
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    expect(finished()[0]?.data).toMatchObject({ turns: 1, prompts: 1 });
    expect(sent).toHaveLength(1);
  }, 120_000);

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
    // Forty seconds of solve, of which the last five are kept back: a command that asked for a
    // minute is handed back with them in hand, and the answer written after it is judged.
    const long = fauxAssistantMessage(
      fauxToolCall("bash", { command: "echo began; sleep 50", timeout: 60 }),
      toolUse,
    );
    const submit = fauxAssistantMessage(fauxToolCall("submit", {}), toolUse);
    const { request, events } = setup([long, written, submit], { limits: { ...LIMITS, wallSeconds: 40 } });
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    const [cut] = events().flatMap(({ kind, data }) => (kind === "solve.call" ? [data] : []));
    expect(cut).toMatchObject({ tool: "bash", isError: true });
    expect(cut?.text).toMatch(
      /^began\n\n\nCommand timed out after 3\d seconds\n\nThe command was cut because the solve's time is nearly up, so that its result reaches you while you can still act on it\.\n\n\[Solve time used: 0:3\d of 0:40\]$/,
    );
  }, 120_000);

  it.concurrent("reruns a failed provider turn three times, then reports it as the provider's non-result", async () => {
    const closed = fauxAssistantMessage("", { stopReason: "error", errorMessage: "WebSocket closed 1000" });
    const { request, finished } = setup([closed, closed, closed, closed]);
    const waits: number[] = [];
    const ending = await solve(request, async (rerun) => {
      waits.push(rerun);
    });
    expect(ending).toEqual({ outcome: "non-result", kind: "provider", reason: "WebSocket closed 1000" });
    expect(waits).toEqual([1, 2, 3]);
    expect(finished()).toHaveLength(4);
  }, 120_000);

  it.concurrent("returns a provider limit that names its reset at once, for the campaign to wait out", async () => {
    const limited = fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "Claude Code: usage limit (limit reached|1791811800)",
    });
    const { request, finished } = setup([limited, limited]);
    const waits: number[] = [];
    const ending = await solve(request, async (rerun) => {
      waits.push(rerun);
    });
    expect(ending).toMatchObject({ outcome: "non-result", kind: "provider" });
    expect(waits).toEqual([]);
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
    await expect(solve(request, noWait)).rejects.toThrow(
      "the verifier could not decide t-1, so the run stops: value: the wall broke",
    );
    expect(finished().at(-1)?.data.ending).toMatchObject({ outcome: "non-result", kind: "verifier" });
  }, 120_000);

  it.concurrent("judges an answer held before the model process crashed", async () => {
    // Submit beside a call that does not end the batch, so the loop asks for one more turn, and the
    // model process dies on it.
    const submit = fauxAssistantMessage(
      [fauxToolCall("submit", {}), fauxToolCall("bash", { command: "true" })],
      toolUse,
    );
    const { request, finished } = setup([written, submit]);
    const models = request.models("");
    const stream = models.streamSimple.bind(models);
    let requests = 0;
    models.streamSimple = (model, context, options) => {
      requests += 1;
      if (requests === 3) throw new Error("the model process died");
      return stream(model, context, options);
    };
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    expect(finished()).toHaveLength(1);
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
