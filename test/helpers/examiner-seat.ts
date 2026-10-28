// One Examiner session of any mode on the faux provider, for the suites that hold `examine`
// (`test/examiner.test.ts`, `test/draft.test.ts`): a scratch campaign with a check program and a
// log, a request of the mode asked for, and what each mode puts.
import {
  createModels,
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { SeatTool } from "../../src/agent/session.ts";
import type { Draft } from "../../src/examiner/draft.ts";
import type { ExamRequest } from "../../src/examiner/session.ts";
import type { Wall } from "../../src/examiner/shell.ts";
import type { Condition } from "../../src/kernel/condition.ts";
import type { Contract } from "../../src/kernel/contract.ts";
import { type EventKind, read } from "../../src/kernel/log.ts";
import { type TaskPackage, taskVersion } from "../../src/kernel/task.ts";
import type { Task } from "../../src/kernel/verify.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { isFunction, isString, type JsonObject } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { present } from "./matchers.ts";

export type Mode = ExamRequest["mode"];
/** A request of each mode. */
type Requests = { readonly [Each in Mode]: Extract<ExamRequest, { readonly mode: Each }> };

const TOOL_USE = { stopReason: "toolUse" } as const;
export const MODES = ["draft", "write"] as const;
/** The log's word for each mode's events, and for what a session of it puts. */
export const KIND = { draft: "draft", write: "exam" } as const;
export const NOTE = "Stacked two requirements.";
/** The repository this suite runs in, which the wall closes to an Examiner's commands. */
export const REPO = resolve(import.meta.dir, "..", "..");
/** The line an Examiner session ends each turn's last tool result with (`sit`, `session.ts`). */
export const USED = /(?:^|\s*\n)Turn \d+ of \d+; \d+ of \d+ minutes? used\.$/;
export const WALL: Wall = { repoRoot: REPO, packRoots: [] };
export const CONTRACT: Contract = {
  answerFormat: {
    type: "object",
    properties: { answer: { type: "string" }, unit: { type: "string" } },
    required: ["answer", "unit"],
  },
  conventions: "SI units.",
  rules: [
    { id: "R1", statement: "The answer is the base times six." },
    { id: "R2", statement: "The unit is the newton." },
  ],
  scope: "Fixture.",
};
export const CHECKS = [
  { id: "check-product", assertion: "The answer is six times the base.", families: "all" as const },
  { id: "check-unit", assertion: "The unit is N.", families: "all" as const },
];
/** The pack's own task, which a writing session is shown and may read whole. */
export const EXAMPLE: Task = {
  taskId: "e-1",
  family: "fixture",
  publicInput: { base: 2 },
  hidden: { seed: 5 },
};
const BASES = [2, 3, 4];
/** A sound draft: one rule, its check, three examples, an accept control each and one reject. */
export const SOUND: Draft = {
  domain: "Fixture products",
  scope: "A task gives a base and asks for six times it.",
  conventions: "The answer is a decimal string without a sign.",
  rules: [
    { id: "R1", statement: "The answer is the base times six.", source: "A fixture: no field states it." },
  ],
  answerFormat: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  checks: [{ id: "check-product", rule: "R1", assertion: "The answer is six times the base." }],
  evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),\n};\n`,
  tasks: BASES.map((base) => ({ family: "fixture", publicInput: { base }, hidden: null })),
  accept: BASES.map((base, task) => ({ task, answer: { answer: String(base * 6) } })),
  reject: [{ task: 0, answer: { answer: "13" }, check: "check-product" }],
};
const LIMITS = { wallSeconds: 600, turns: 12, puts: 4 };
const IDS = { draft: "d-1", write: "x-1" } as const;
const scratches: string[] = [];

export const call = (name: string, args: JsonObject) =>
  fauxAssistantMessage(fauxToolCall(name, args), TOOL_USE);
export const finish = call("finish", { note: NOTE });
/** A turn the provider failed, with what it said. */
export const failed = (said: string) => fauxAssistantMessage("", { stopReason: "error", errorMessage: said });
export const bash = (command: string) => call("bash", { command });
/** An instance as a writing session's tools take it; a null base is one the gate refuses. */
export const instance = (base: number | null) => ({
  family: "fixture",
  public_input: base === null ? null : { base },
  hidden: { seed: 1 },
});
export const propose = (...bases: (number | null)[]) => call("propose_tasks", { tasks: bases.map(instance) });
/** A draft as `draft_exam` takes it. */
export const drafted = (draft: Draft) =>
  call("draft_exam", {
    domain: draft.domain,
    scope: draft.scope,
    conventions: draft.conventions,
    rules: draft.rules.map((rule) => ({ ...rule })),
    answer_format: draft.answerFormat,
    checks: draft.checks.map((check) => ({ ...check })),
    evaluator: draft.evaluator,
    tasks: draft.tasks.map(({ family, publicInput, hidden }) => ({
      family,
      public_input: publicInput,
      hidden,
    })),
    accept_controls: draft.accept.map((control) => ({ ...control })),
    reject_controls: draft.reject.map((control) => ({ ...control })),
  });
/** What a session of each mode puts once: a sound draft, one task. */
export const PUT = { draft: drafted(SOUND), write: propose(7) } as const;
/** A solve's condition, as the launcher records one: the task version, the harness, the test side. */
export const condition = (task: string, harness: string): Condition => ({
  contract: "c1",
  harness,
  task,
  model: "faux/solver",
  effort: "medium",
  prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: harness,
  verifierTools: "t1",
  sandbox: "p1",
  limits: {
    wallSeconds: 600,
    turns: 12,
    shellDefaultSeconds: 30,
    shellMaxSeconds: 60,
    concurrency: 1,
  },
  host: "h",
  side: "test",
});

/** The seat's tool of that name, or its first (the one that proposes tasks) where none is named. */
export function toolOf(opened: { readonly tools: readonly SeatTool[] }, named?: string): SeatTool {
  return present(
    named === undefined ? opened.tools[0] : opened.tools.find(({ name }) => name === named),
    `the seat's ${named ?? "first"} tool`,
  );
}

/** Call only the Examiner's host tools: no Harness operations, and a gate may outlive this call. */
export function invoke(tool: SeatTool, callId: string, args: JsonObject) {
  // SAFETY: these host tools use no API operations. Refuse any accidental access beyond callId.
  const api = new Proxy(
    { callId },
    {
      get: (target, key) => {
        if (key === "callId") return target.callId;
        throw new Error(`the Examiner host tool unexpectedly read api.${String(key)}`);
      },
    },
  ) as ToolExecutionApi;
  return tool.execute(args, api, BACKGROUND_CONTEXT);
}

/** Removes every scratch campaign a suite seated; each suite calls it once, after its cases. */
export function sweep(): void {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * One session of `mode` on a scratch campaign: its request, with a model that gives `responses` in
 * order and puts what it was sent in `sent`, the campaign's log and check program, and the log's
 * events by kind. The check program declares two checks and plants a defect, a product by seven.
 */
export function seat<M extends Mode>(mode: M, responses: readonly FauxResponseStep[]) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-examiner-")));
  scratches.push(scratch);
  const program = join(scratch, "checks");
  const log = join(scratch, "log.jsonl");
  mkdirSync(program);
  const execution = {
    families: "all",
    artifactPaths: ["$.answer"],
    publicInputPaths: ["$.base"],
    hidden: "none",
    evidence: { kind: "authored" },
  };
  writeFileSync(
    join(program, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      truthChecks: [
        { id: "check-product", citedDecisionIds: ["R1"], execution },
        { id: "check-unit", citedDecisionIds: ["R2"], execution },
      ],
    }),
  );
  writeFileSync(
    join(program, "evaluator.ts"),
    `export const checks = { "check-product": (r) => r.artifact.answer === String(r.publicTask.publicInput.base * 7) };\n`,
  );
  const sent: string[] = [];
  const faux = fauxProvider({
    models: [
      {
        id: "faux-examiner",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
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
  const pack = (task: Task): TaskPackage => ({ ...task, ruleIds: ["R1", "R2"], checks: program });
  const common = {
    id: IDS[mode],
    model: faux.getModel(),
    effort: "medium",
    limits: LIMITS,
    models: () => models,
    log,
  } as const;
  const requests = {
    draft: { ...common, mode: "draft", prompt: "A fixture.", reading: async () => [] },
    write: {
      ...common,
      mode: "write",
      contract: CONTRACT,
      checks: CHECKS,
      tasks: [EXAMPLE],
      wanted: 24,
      pack,
      budget: null,
      verify: null,
      probe: null,
    },
  } satisfies Requests;
  return {
    request: requests[mode],
    log,
    program,
    sent,
    /** The events of `kind`. A call's result is read as its tool returned it, without the line
     *  the session ends each turn's last result with, which a case of its own reads (`USED`). */
    of: (kind: EventKind) =>
      read(log)
        .filter((event) => event.kind === kind)
        .map(({ data }) => (isString(data.text) ? { ...data, text: data.text.replace(USED, "") } : data)),
    /** The version of the task a writing session held out under `taskId` from `instance(base)`. */
    versionOf: (taskId: string, base: number) =>
      taskVersion(pack({ taskId, family: "fixture", publicInput: { base }, hidden: { seed: 1 } })),
  };
}
