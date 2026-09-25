/**
 * The Built solve contract, written from the solver's own boundary: one confined worker, one
 * prompt per turn, one submit gate, one typed outcome.
 *
 * Every case here decides what a measured case is worth — verified, unaccepted or a typed
 * non-result — so each one states a rule a reader of recorded evidence depends on. The generated
 * worker's source policy and OS walls are proved by `generated-worker-sandbox.test.ts` and
 * `solve-sandbox.test.ts`; what this file owns is the loop that spends provider turns and the
 * classification of what it produced.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { type AssistantMessage, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { EnvironmentRefusal } from "../src/backends/environment-refusal.ts";
import { startPiBuiltWorker } from "../src/backends/pi-built-process.ts";
import { type PiBuiltRuntime, piBuiltSolver } from "../src/backends/pi-built.ts";
import { builtSolveIsolation } from "../src/run/built-agent-runtime.ts";
import {
  BUILT_NUDGE,
  builtAgentInterface,
  builtSystemPrompt,
  starterRegistration,
} from "../src/solve/built-starter.ts";
import { BUILT_SHELL_RULES } from "../src/solve/dcg-rules.ts";
import { createSubmissionAuthority, submissionPortOf } from "../src/solve/final-submission.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/truth/harness-config.ts";
import { solverNonResultReason } from "../src/truth/runtime-blocker.ts";
import { builtStarterFactoryForSolver } from "../src/truth/solve.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { double } from "./helpers/doubles.ts";
import { ProviderResourceBudget } from "../src/run/provider-resource-budget.ts";
import { createRunObserver, type RunObserver } from "../src/observe/run-observer.ts";

// Every case here starts a confined worker. The repository already runs one file per core, and
// nested concurrency inside this file starved a worker lifecycle to its wall, so these stay serial.

const TASK = { taskId: "pi-1", family: "direct", publicInput: { answer: "ok" } };
interface FauxRow {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JsonObject }>;
  stopReason?: "stop" | "error" | "aborted";
  errorMessage?: string;
  responseModel?: string;
}

interface SolveOptions {
  maxTurns?: number;
  slug?: string;
  runtime?: Partial<PiBuiltRuntime>;
  budget?: ProviderResourceBudget;
  observer?: RunObserver;
  close?: (solver: ReturnType<typeof piBuiltSolver>) => never;
}

setDefaultTimeout(60_000);

const SCHEMA = compilePublicArtifactSchema([{ name: "answer" }], [{ answer: "ok" }]);

/** One generated harness for the whole file: an artifact-writer, a slow reader for the wall, and a
 *  reader whose own result the worker protocol cannot carry. */
const SLUG = mkdtempSync(join(import.meta.dir, ".ana-scratch-pi-built-solve-"));
mkdirSync(join(SLUG, "agent"));
writeFileSync(
  join(SLUG, "agent", "tools.ts"),
  `import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";
export function createDomainHarness(task) {
  return {
    tools: [
      defineDraftTool({
        name: "write_answer",
        label: "Write answer",
        description: "Write the public answer into the draft.",
        parameters: Type.Object({}),
        executionMode: "sequential",
        run: (_params, draft) => {
          draft.setValue("answer", task.publicInput.answer);
          draft.setArtifact({ answer: draft.getValue("answer") });
          return { text: "answer written" };
        },
      }),
      defineDraftTool({
        name: "slow_read",
        label: "Slow read",
        description: "Read the public answer after half a second.",
        parameters: Type.Object({}),
        executionMode: "sequential",
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { text: task.publicInput.answer };
        },
      }),
      defineDraftTool({
        name: "utilisation",
        label: "Utilisation",
        description: "Divide the load by the capacity the task carries.",
        parameters: Type.Object({}),
        executionMode: "sequential",
        run: () => ({ text: "utilisation computed", details: { ratio: 1 / 0, log: "x".repeat(3_000_000) } }),
      }),
    ],
  };
}
`,
);
writeFileSync(
  join(SLUG, "agent", "tools-spec.json"),
  JSON.stringify({
    presets: [],
    declined: { files: "fixture without a shell" },
    tools: [
      { name: "write_answer", kind: "artifact-writer", description: "Write and prepare the public answer." },
      { name: "slow_read", kind: "reader", description: "Read the public answer slowly." },
      { name: "utilisation", kind: "reader", description: "Report the utilisation of the prepared answer." },
    ],
  }),
);
writeFileSync(join(SLUG, "agent", "BUILT_AGENTS.md"), "Write the answer, then prepare it.\n");
afterAll(() => rmSync(SLUG, { recursive: true, force: true }));

function faux(rows: FauxRow[]): AssistantMessage[] {
  return rows.map((row) => {
    const message = fauxAssistantMessage(
      [
        ...(row.text === undefined ? [] : [{ type: "text" as const, text: row.text }]),
        ...(row.toolCalls ?? []).map((call) => fauxToolCall(call.name, call.arguments, { id: call.id })),
      ],
      {
        stopReason: row.stopReason ?? ((row.toolCalls?.length ?? 0) > 0 ? "toolUse" : "stop"),
        ...keyIfDefined("errorMessage", row.errorMessage),
      },
    );
    return row.responseModel === undefined ? message : { ...message, responseModel: row.responseModel };
  });
}

const call = (id: string, name: string, args: JsonObject = {}): FauxRow => ({
  toolCalls: [{ id, name, arguments: args }],
});
const WRITE = call("write", "write_answer", { answer: "ok" });
const SUBMIT = call("submit", "submit");
// A first submit with most of the solve time left is answered with that time and sends nothing
// (submit-time-left.ts), so a solver that means to send calls it twice.
const SUBMIT_AGAIN = call("submit-again", "submit");

function runtimeFor(rows: FauxRow[], extra: Partial<PiBuiltRuntime> = {}): PiBuiltRuntime {
  return {
    profile: { provider: "openrouter", transport: "openrouter", model: "faux-built", thinkingLevel: "off" },
    auth: async () => ({ type: "api_key", key: "fake-pi-built-test-key" }),
    policy: builtSolveIsolation(runtimeProcess.cwd()),
    fakeResponses: faux(rows),
    ...extra,
  };
}

/** One solve through the production starter factory, exactly as the run driver opens it. */
async function solve(rows: FauxRow[], options: SolveOptions = {}) {
  const solver = piBuiltSolver(runtimeFor(rows, options.runtime ?? {}), {
    maxTurns: options.maxTurns ?? 4,
    observer: options.observer,
    observationPhase: options.observer === undefined ? undefined : "measure-on",
    providerBudget: options.budget,
  });
  const authority = createSubmissionAuthority({ maxAttempts: 3, publicArtifactSchema: SCHEMA });
  const createStarter = builtStarterFactoryForSolver(solver);
  if (createStarter === undefined) throw new Error("the Pi solver carries no production starter factory");
  const toolset = await createStarter(options.slug ?? SLUG, TASK, submissionPortOf(authority), SCHEMA);
  const accepted = () => authority.finalSubmission()?.accepted === true;
  const outcome = await solver(TASK, toolset, accepted);
  return { outcome, accepted: accepted(), solver, toolset };
}

describe("the Built harness instructions", () => {
  // The prompt is a condition identity: two runs are comparable only when it is byte-identical.
  // These assertions name the duties it owes rather than repeating it, so a reworded sentence that
  // keeps every duty is one deliberate digest change here instead of a diff of the whole text.
  it("states the checking duty and the solve wall, and leaves the rest to tools", () => {
    const prompt = builtSystemPrompt(DEFAULT_HARNESS_SETTINGS.solveMs);
    expect(prompt).toContain("a breach it reports is a failed requirement");
    expect(prompt).toContain("widening the worst margin");
    // The wall submits the answer last prepared, so a solver that experimented past its best
    // candidate shipped the worse one. save_candidate and restore_candidate are how it returns.
    expect(prompt).toContain("Save it before you change it");
    expect(prompt).toContain("120 minutes");
    expect(prompt).toContain("Where a requirement is a numeric limit");
    // 19 of 19 recorded truss answers of 2026-09-17 breached a published limit by their own
    // reported numbers. The prompt used to ask the solver to compare each reported value with each
    // published requirement, and to hold margin where its own model only approximated one;
    // readMargins measures that on the prepared answer instead, so the clauses are gone.
    for (const asked of ["keep margin on every limit", "compare each result", "Do not submit an answer"]) {
      expect(prompt).not.toContain(asked);
    }
    // The shell rules belong to the shell's own description, where a guard refusal quotes them.
    for (const rule of BUILT_SHELL_RULES) expect(prompt).not.toContain(rule);
    // Turns are a controller bound the solver cannot count; the wall is the time it can.
    expect(prompt).not.toContain("turns");
  });

  it("names no domain, evaluator or review term", () => {
    const messages = `${builtSystemPrompt(DEFAULT_HARNESS_SETTINGS.solveMs)} ${BUILT_NUDGE}`.toLowerCase();
    for (const forbidden of ["judge", "census", "verifier", "truth", "round", "precision"]) {
      expect(messages).not.toContain(forbidden);
    }
    // The nudge repeats no role the system prompt and the tool roster already state.
    for (const forbidden of ["artifact-writer", "preview"]) {
      expect(BUILT_NUDGE.toLowerCase()).not.toContain(forbidden);
    }
    expect(BUILT_NUDGE).toBe("Finish the task with the available tools, then submit your answer.");
  });
});

describe("the solve loop", () => {
  it("writes, submits and stops without spending a further turn", async () => {
    const { outcome, accepted } = await solve([
      WRITE,
      { text: "draft ready" },
      SUBMIT,
      SUBMIT_AGAIN,
      { text: "must not be reached" },
    ]);
    expect(accepted).toBe(true);
    // A turn is one prompt, however many model calls it takes: the writer and the text it ended
    // with are turn one, both submits are turn two, and the last row is never paid for.
    expect(outcome).toMatchObject({ turns: 2, completedTurns: 2, toolCalls: 3 });
    const submits = outcome.trace?.toolCalls.filter((row) => row.toolName === "submit") ?? [];
    expect(submits.map((row) => row.resultPreview?.slice(0, 9))).toEqual(["Not sent:", "Submitted"]);
    expect(outcome.errors).toEqual([]);
    expect(outcome.nonResult).toBeUndefined();
    expect(outcome.checkpoints).toHaveLength(2);
  });

  it("closes the case span it opened, so the stream says how the case ended", async () => {
    // Run c1d2a7 opened 28 measured-case spans and closed none: every case start reached the
    // stream and no case outcome did, so a reader watching a live battery could not say which
    // case was still running, how any of them settled, or how long one took.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-case-span-")));
    await solve([WRITE, SUBMIT, SUBMIT_AGAIN], { observer: createRunObserver(root, "demo", "run-01") });
    const stream = readFileSync(join(root, "campaigns", "demo", "observability", "run-01.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      // The solver turn's own prompt row carries the same phase name, so the filter is the node kind.
      .filter((row) => row.type === "phase-transition" && row.phase === "measure-on");
    expect(stream.map((row) => [row.state, row.subjectId, row.summary])).toEqual([
      ["started", "pi-1", "Case pi-1 started"],
      ["completed", "pi-1", "Case pi-1 submitted"],
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  // Truss cases irregular-supports-01 and -02 (2026-09-17) failed on turn one after 17 and 21 tool
  // calls, then ended with 11 of 12 turns unused and nothing submitted. The agent keeps its
  // messages and tool results, so one more prompt continues the same solve — and the turn that
  // produced nothing is not one of the solver's turns.
  // The one permitted turn is also the last, so its first submit sends rather than answering with
  // the time left (submit-time-left.ts): a second submit would never get a turn.
  it("retries a failed turn without spending a solving turn", async () => {
    const { outcome, accepted } = await solve(
      [{ stopReason: "error", errorMessage: "the model declined to continue" }, WRITE, SUBMIT],
      { maxTurns: 1 },
    );
    expect(accepted).toBe(true);
    expect(outcome).toMatchObject({ turns: 2, completedTurns: 1, toolCalls: 2 });
  });

  // The session retries a transient provider error inside the prompt, as pi's own loop does, so the
  // solver never sees a failed turn for it and the retried message leaves no trace in the transcript.
  it("retries a transient provider error inside the turn", async () => {
    const { outcome, accepted } = await solve(
      [{ stopReason: "error", errorMessage: "assistant message ended without content" }, WRITE, SUBMIT],
      { maxTurns: 1 },
    );
    expect(accepted).toBe(true);
    expect(outcome).toMatchObject({ turns: 1, completedTurns: 1, toolCalls: 2 });
    expect(outcome.errors).toEqual([]);
  });

  it("records the provider's own words for a turn that did not complete", async () => {
    const { outcome } = await solve(
      [{ stopReason: "error", errorMessage: "the model declined to continue" }, WRITE, SUBMIT],
      { maxTurns: 4 },
    );
    expect(outcome.errors).toContain("turn 1 failed");
    // The synthesised marker alone told the c03 reader nothing about the cause.
    expect(outcome.trace?.turns[0]?.errorMessage).toBe("the model declined to continue");
  });

  // A quota refusal is not transient, so the session does not retry it and the turn fails at once.
  it("ends the solve at a failed turn whose message names the environment", async () => {
    const { outcome, accepted } = await solve(
      [
        { stopReason: "error", errorMessage: "You exceeded your current quota: insufficient_quota" },
        WRITE,
        SUBMIT,
      ],
      { maxTurns: 4 },
    );
    expect(accepted).toBe(false);
    expect(outcome).toMatchObject({ turns: 1, toolCalls: 0 });
    expect(outcome.nonResult).toMatchObject({ kind: "provider" });
  });

  // The login is read at each solve start. A Codex login that expired mid-battery threw out of the
  // solver, which left the case's tool worker open and gave the case no row.
  it("records a login refused at the solve's start as that case's provider non-result", async () => {
    const refused = new EnvironmentRefusal(
      "Codex authentication is unavailable (auth.json access token is expired)",
    );
    const auth = async (): Promise<never> => {
      throw refused;
    };
    const { outcome, accepted } = await solve([WRITE, SUBMIT], { runtime: { auth } });
    expect(accepted).toBe(false);
    expect(outcome.nonResult).toMatchObject({ kind: "provider", message: refused.message });
  });

  it("ends the solve at two failures in a row", async () => {
    const failure = { stopReason: "error" as const, errorMessage: "the model declined to continue" };
    const { outcome, accepted } = await solve([failure, failure, WRITE, SUBMIT], { maxTurns: 4 });
    expect(accepted).toBe(false);
    expect(outcome.completedTurns).toBe(0);
  });

  it("does not prompt again after an aborted turn, and pays for one turn only", async () => {
    const budget = new ProviderResourceBudget(2);
    const { outcome } = await solve(
      [{ text: "stopped", stopReason: "aborted" }, { text: "must not start" }],
      {
        maxTurns: 2,
        budget,
      },
    );
    expect(outcome.turns).toBe(1);
    expect(outcome.completedTurns).toBe(0);
    expect(budget.snapshot().used).toBe(1);
  });

  it("keeps the redacted failed-turn marker the non-result reader classifies", async () => {
    const secret = "fake-pi-built-secret-that-must-not-escape";
    const { outcome } = await solve([{ stopReason: "error", errorMessage: `provider repeated ${secret}` }], {
      maxTurns: 1,
      runtime: { auth: async () => ({ type: "api_key", key: secret }) },
    });
    expect(outcome.errors).toContain("turn 1 failed");
    expect(outcome.errors.join("\n")).toContain("[redacted]");
    expect(outcome.errors.join("\n")).not.toContain(secret);
    expect(
      solverNonResultReason({
        toolCalls: outcome.toolCalls,
        ...keyIfDefined("startedToolCalls", outcome.startedToolCalls),
        acceptedSubmit: false,
        errors: outcome.errors,
        turns: outcome.turns,
        completedTurns: outcome.completedTurns,
      }),
    ).toContain("zero completed tool calls");
  });
});

describe("the whole-solve wall", () => {
  // Truss run 406cca's resilient-bridge-h was cut after 18 traced tool calls and recorded as a
  // runtime non-result with zero tool calls, leaving the difficulty denominator. Running out of
  // time is the attempt's own result, and the answer prepared before the cut is still submitted.
  const busy = Array.from({ length: 40 }, (_, index) => call(`busy-${String(index)}`, "slow_read"));

  it("ends an unsubmitted solve as its own unaccepted attempt, with the calls it made", async () => {
    const { outcome, accepted } = await solve(busy, { maxTurns: 1, runtime: { solveWallMs: 3_000 } });
    expect(accepted).toBe(false);
    expect(outcome.nonResult).toBeUndefined();
    expect(outcome.errors).toEqual(["Pi Built worker exceeded its bounded solve time"]);
    expect(outcome.toolCalls).toBeGreaterThan(0);
    expect(outcome.runtimeBoundary?.modelWorker.termination).toEqual({
      status: "solve-wall",
      message: "Pi Built worker exceeded its bounded solve time",
    });
  });

  it("submits the answer an artifact-writer prepared before the cut", async () => {
    const { accepted, outcome } = await solve([WRITE, ...busy], {
      maxTurns: 1,
      runtime: { solveWallMs: 3_000 },
    });
    expect(accepted).toBe(true);
    expect(outcome.runtimeBoundary?.modelWorker.termination).toMatchObject({ status: "solve-wall" });
  });

  // Run de8b40's canopy-02 completed its first turn, opened a second and met the wall there. The
  // identities travelled only in the worker's `done` message, which a cut solve never sends, so
  // the case recorded one completed turn beside zero identities. The claim reads that pair as an
  // identity defect: it refused the whole battery on `runtime-model-identity-unproven` with three
  // verified passes inside it. A turn is attested by the message that reports it, so a cut costs
  // the attestation of the open turn alone.
  it("attests the turns that completed before the cut", async () => {
    const { outcome } = await solve([{ text: "planning" }, ...busy], {
      maxTurns: 3,
      runtime: { solveWallMs: 3_000 },
    });
    expect(outcome.completedTurns).toBe(1);
    expect(outcome.runtimeIdentities).toHaveLength(1);
  });
});

describe("a tool result the protocol cannot frame", () => {
  // A domain tool returning more than the frame carries used to answer with a protocol
  // non-result, which voided the whole paid case. The call fails; the session does not, and the
  // solver still submits. A non-finite number in the same result is already carried as null.
  it("fails that call and leaves the solve able to submit", async () => {
    const { outcome, accepted } = await solve([call("ratio", "utilisation"), WRITE, SUBMIT, SUBMIT_AGAIN], {
      maxTurns: 4,
    });
    expect(accepted).toBe(true);
    expect(outcome.nonResult).toBeUndefined();
    expect(outcome.toolCalls).toBe(4);
    const failed = outcome.trace?.toolCalls.find((row) => row.toolName === "utilisation");
    expect(failed).toMatchObject({ isError: true });
    expect(failed?.resultExcerpt).toContain("could not be returned");
  });
});

describe("the typed outcome", () => {
  it("refuses an in-process starter before opening a worker", async () => {
    const solver = piBuiltSolver(runtimeFor([{ text: "unused" }]), { maxTurns: 1 });
    const authority = createSubmissionAuthority({ maxAttempts: 3, publicArtifactSchema: SCHEMA });
    const outcome = await solver(
      TASK,
      // SAFETY: the case is exactly that an in-process starter is refused before a worker opens,
      // so the argument is shaped like one and is never used as the confined starter it is not.
      double({ tools: [], registration: starterRegistration([]), checkpoint: () => ({ tools: [] }) }),
      () => authority.finalSubmission()?.accepted === true,
    );
    expect(outcome).toMatchObject({
      turns: 0,
      nonResult: {
        kind: "protocol",
        message: "Pi Built solver requires the confined generated-tool starter",
      },
    });
    expect(outcome.runtimeBoundary).toBeUndefined();
  });

  it.each([
    { kind: "runtime", deadline: true, closeHandshakeTimeout: true, preserves: true },
    { kind: "runtime", deadline: true, preserves: false },
    { kind: "runtime", preserves: false },
    { kind: "sandbox", preserves: false },
    { kind: "protocol", preserves: false },
    { kind: "crash", preserves: false },
  ] as const)(
    "classifies a generated-worker close failure: %j",
    async (failure) => {
      for (const submitted of [true, false]) {
        const solver = piBuiltSolver(runtimeFor([{ text: "done" }]), { maxTurns: 1 });
        const createStarter = builtStarterFactoryForSolver(solver);
        if (createStarter === undefined) {
          throw new Error("the Pi solver carries no production starter factory");
        }
        const authority = createSubmissionAuthority({ maxAttempts: 3, publicArtifactSchema: SCHEMA });
        const toolset = await createStarter(SLUG, TASK, submissionPortOf(authority), SCHEMA);
        const { preserves, ...condition } = failure;
        const outcome = await solver(
          TASK,
          {
            ...toolset,
            close: async () => {
              const evidence = await toolset.close?.();
              if (evidence === undefined) throw new Error("the production starter has no close");
              return {
                ...evidence,
                termination: {
                  status: "non-result",
                  ...condition,
                  message: "generated-tool worker did not close within 1000ms",
                },
              };
            },
          },
          () => submitted,
        );
        expect(outcome.runtimeBoundary?.generatedTools.termination).toMatchObject({
          status: "non-result",
          ...condition,
        });
        // Only the host-marked close handshake timeout preserves accepted work.
        if (submitted && preserves) expect(outcome.nonResult).toBeUndefined();
        else expect(outcome.nonResult).toMatchObject({ kind: condition.kind });
      }
    },
    60_000,
  );

  it("refuses a worker that answers ready for another served model", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-pi-identity-")));
    const source = `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  const end = input.indexOf("\\n");
  if (end < 0) return;
  const start = JSON.parse(input.slice(0, end));
  process.stdout.write(JSON.stringify({
    type: "ready",
    workerInstanceId: start.workerInstanceId,
    pid: process.pid,
    promptDigest: start.contract.promptDigest,
    toolSchemaDigest: start.contract.toolSchemaDigest,
    modelSelection: { resolvedModel: start.profile.model + "-fallback", effort: start.profile.thinkingLevel, source: "faux-provider" },
  }) + "\\n");
});
`;
    const file = join(dir, "worker.cjs");
    writeFileSync(file, source);
    const runtime = runtimeFor([], { fakeResponses: [] });
    try {
      await expect(
        startPiBuiltWorker({
          runtime,
          bundle: {
            dir,
            file,
            digest: new Bun.CryptoHasher("sha256").update(source).digest("hex"),
          },
          start: {
            type: "start",
            profile: runtime.profile,
            credential: await runtime.auth(),
            contract: builtAgentInterface(
              [],
              starterRegistration([]),
              null,
              DEFAULT_HARNESS_SETTINGS.solveMs,
            ),
            prompt: "",
            nudge: "",
            maxTurns: 0,
            fakeResponses: [],
          },
          conditionDigest: "condition",
          tools: new Map(),
          onMessage: () => {},
        }),
      ).rejects.toThrow(/ready evidence did not match/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
