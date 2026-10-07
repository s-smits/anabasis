// A solve's ending, read from what an attempt left behind, in every order the runner settles it;
// then the plan's kill tests end to end on the faux provider, under the real command wall and disk
// cap: a pass whose trace and meter read back from the log and whose hidden value reaches nothing
// the solver reads, the host's limits over the harness's, the wall, no answer, the reruns of a
// refusal and of moved files, and the run stopping on the verifier's non-result.
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
import type { Verdict } from "../src/kernel/verify.ts";
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { judge, type Played, solve, type SolveRequest } from "../src/solve/run.ts";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const CANARY = "hidden-canary-7f3a";
const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    additionalProperties: false,
    properties: { answer: { type: "string" } },
    required: ["answer"],
  },
  tools: [],
  install: "",
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
const darwin = runtimeProcess.platform === "darwin";
const noWait = async () => {};
const toolUse = { stopReason: "toolUse" } as const;

const scratches: string[] = [];
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
      typeof step === "function"
        ? step
        : (context: unknown) => {
            sent.push(JSON.stringify(context));
            return step;
          },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const log = join(scratch, "log.jsonl");
  const request: SolveRequest = {
    id: `run-${String(runtimeProcess.pid)}-${scratch.slice(-6)}`,
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

const answer = [
  fauxAssistantMessage(fauxToolCall("scale_base", { factor: 6 }), toolUse),
  // The harness's own process reads what the host handed it.
  fauxAssistantMessage(fauxToolCall("read_path", { path: "input.json" }), toolUse),
  fauxAssistantMessage(fauxToolCall("record_answer", { answer: "42" }), toolUse),
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
    turns: [],
    submitted: undefined,
    wallEnded: false,
    moved: false,
    homeBytes: 0,
  };
  const stop = (text: string, errorMessage?: string) =>
    fauxAssistantMessage(text, errorMessage === undefined ? {} : { stopReason: "error", errorMessage });

  function ending(played: Partial<Played>, overrides: Partial<SolveRequest> = {}) {
    const { request, events } = setup([], overrides);
    return { ending: judge(request, "t-1-1", { ...PLAYED, ...played }), events };
  }

  it("is the sandbox's crash, then a kill, then moved files, before anything the solver did", async () => {
    const kill = AbortSignal.abort();
    const all = { crash: "mount failed", moved: true, submitted: { answer: "42" } };
    expect(await ending(all, { kill }).ending).toEqual({
      outcome: "non-result",
      kind: "sandbox-crash",
      reason: "mount failed",
    });
    expect(await ending({ ...all, crash: null }, { kill }).ending).toMatchObject({ kind: "killed" });
    expect(await ending({ ...all, crash: null }).ending).toMatchObject({ kind: "moved-files" });
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

  it("is the verifier's non-result when the checks cannot decide", async () => {
    const verify = async (): Promise<Verdict> => ({ kind: "non-result", reason: "value: the check threw" });
    expect(await ending({ submitted: { answer: "42" } }, { verify }).ending).toEqual({
      outcome: "non-result",
      kind: "verifier",
      reason: "value: the check threw",
    });
  });

  it("without an answer: the wall, then the context, then a refusal, else no answer", async () => {
    const overflow = stop("", "prompt is too long: 213462 tokens > 200000 maximum");
    expect(await ending({ wallEnded: true, turns: [overflow] }).ending).toMatchObject({ kind: "wall-ended" });
    expect(await ending({ turns: [overflow] }).ending).toEqual({ outcome: "fail", kind: "context-ended" });
    const length = fauxAssistantMessage("", { stopReason: "length" });
    expect(await ending({ turns: [length] }).ending).toMatchObject({ kind: "context-ended" });
    expect(await ending({ turns: [stop("", "overloaded_error")] }).ending).toEqual({
      outcome: "non-result",
      kind: "refusal",
      reason: "overloaded_error",
    });
    expect(await ending({ turns: [stop("I am done.")] }).ending).toEqual({
      outcome: "fail",
      kind: "no-answer",
    });
  });
});

// Each of these mounts a disk image and runs the real wall, so they run side by side.
describe.skipIf(!darwin)("a solve end to end", () => {
  it.concurrent("passes on a recorded, submitted answer, its trace and meter read back from the log", async () => {
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
      ["record_answer", false],
      ["submit", false],
    ]);
    expect(calls[0]?.text).toContain("found:1");
    expect(calls[1]?.text).toBe("t-1 (fixture): 42");
    expect(calls[2]?.text).toContain('"publicInput":{"base":7}');
    const [done] = finished();
    expect(done?.data.turns).toBe(5);
    expect(done?.data.billed).toBeGreaterThan(0);
    expect(done?.data.metered).toBeGreaterThan(0);

    // Exit test 5: the hidden value reaches nothing the solver reads: the prompt, the tool rows,
    // the first turn and every tool result among them, the harness's process, and its home.
    expect(sent.join("\n")).not.toContain(CANARY);
    expect(sent[0]).toContain("Role: reader. Returns the task's base");
    expect(sent[0]).toContain("Role: artifact-writer. Records the answer.");
    expect(sent[0]).toContain("Role: submission.");
  }, 120_000);

  it.concurrent("holds the host's limits whatever the harness's config asks for", async () => {
    const scale = fauxAssistantMessage(fauxToolCall("scale_base", { factor: 1 }), toolUse);
    const { scratch, sent, request, finished } = setup([scale, scale, scale, scale], {
      limits: { ...LIMITS, wallSeconds: 300, turns: 2 },
    });
    writeFileSync(
      join(scratch, "harness", "agent", "config.yaml"),
      "solver:\n  solve_minutes: 999\n  max_turns: 9999\nshell:\n  default_seconds: 900\n  max_seconds: 9000\n",
    );
    expect(await solve(request, noWait)).toEqual({ outcome: "fail", kind: "no-answer" });
    expect(finished()[0]?.data.turns).toBe(2);
    expect(sent[0]).toContain("the case has 5 minutes of it");
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

  it.concurrent("ends no-answer when the model stops without submitting", async () => {
    const { request } = setup([fauxAssistantMessage("I am done.")]);
    expect(await solve(request, noWait)).toEqual({ outcome: "fail", kind: "no-answer" });
  }, 120_000);

  it.concurrent("reruns a provider refusal three times, then reports it as a non-result", async () => {
    const refusal = fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" });
    const { request, finished } = setup([refusal, refusal, refusal, refusal]);
    const waits: number[] = [];
    const ending = await solve(request, async (rerun) => {
      waits.push(rerun);
    });
    expect(ending).toEqual({ outcome: "non-result", kind: "refusal", reason: "overloaded_error" });
    expect(waits).toEqual([1, 2, 3]);
    expect(finished()).toHaveLength(4);
  }, 120_000);

  it.concurrent("reruns a solve whose harness files moved, and the rerun counts", async () => {
    // The first attempt's model writes into the harness mid-solve; the second finds it settled.
    let harness = "";
    const move: FauxResponseStep = () => {
      writeFileSync(join(harness, "agent", "planted.ts"), "export {};\n");
      return fauxAssistantMessage("Planted.");
    };
    const { request, finished } = setup([move, ...answer]);
    harness = request.harness;
    expect(await solve(request, noWait)).toEqual({ outcome: "pass" });
    expect(finished().map(({ data }) => data.ending)).toEqual([
      { outcome: "non-result", kind: "moved-files", reason: `${harness} changed during the solve` },
      { outcome: "pass" },
    ]);
  }, 120_000);

  it.concurrent("stops the run on the verifier's non-result, once the solve is logged", async () => {
    const { request, finished } = setup(answer, {
      verify: async () => ({ kind: "non-result", reason: "value: the check threw" }),
    });
    await expect(solve(request, noWait)).rejects.toThrow(
      "the verifier could not decide t-1, so the run stops: value: the check threw",
    );
    expect(finished().at(-1)?.data.ending).toMatchObject({ outcome: "non-result", kind: "verifier" });
  }, 120_000);
});
