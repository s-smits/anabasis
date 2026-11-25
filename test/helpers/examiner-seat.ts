// An Examiner session in either mode on the faux provider, shared by the `examine` suites
// (`test/examiner.test.ts`, `test/draft.test.ts`): a temporary campaign with a check program and log,
// and canonical tool calls for each mode.
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
import { keyIfDefined } from "../../src/meta/optional-key.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { present } from "./matchers.ts";

export type Mode = ExamRequest["mode"];
type Requests = { readonly [Each in Mode]: Extract<ExamRequest, { readonly mode: Each }> };

const TOOL_USE = { stopReason: "toolUse" } as const;
export const MODES = ["draft", "write"] as const;
export const KIND = { draft: "draft", write: "exam" } as const;
export const NOTE = "Stacked two requirements.";
/** Repository root under test, which the sandbox boundary blocks from Examiner shell commands. */
export const REPO = resolve(import.meta.dir, "..", "..");
/** Budget footer on the final tool result of each Examiner turn (`src/examiner/session.ts`). */
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
export const EXAMPLE: Task = {
  taskId: "e-1",
  family: "fixture",
  publicInput: { base: 2 },
  hidden: { seed: 5 },
};
const BASES = [2, 3, 4];
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
export const failed = (said: string) => fauxAssistantMessage("", { stopReason: "error", errorMessage: said });
export const bash = (command: string) => call("bash", { command });
/** Task payload formatted for `propose_tasks`; passing a `null` base produces a malformed task that the admission gate refuses. */
export const instance = (base: number | null) => ({
  family: "fixture",
  public_input: base === null ? null : { base },
  hidden: { seed: 1 },
});
export const propose = (...bases: (number | null)[]) => call("propose_tasks", { tasks: bases.map(instance) });
export const draftArgs = (draft: Draft): JsonObject => ({
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
  objective: {
    ...draft.objective,
    ...keyIfDefined("tools", draft.objectiveTools),
  },
});
export const drafted = (draft: Draft) => call("draft_exam", draftArgs(draft));
export const PUT = { draft: drafted(SOUND), write: propose(7) } as const;
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

export function toolOf(opened: { readonly tools: readonly SeatTool[] }, named?: string): SeatTool {
  return present(
    named === undefined ? opened.tools[0] : opened.tools.find(({ name }) => name === named),
    `the seat's ${named ?? "first"} tool`,
  );
}

/**
 * Invokes an Examiner host tool directly, its arguments prepared as pi prepares them (`fromHome`);
 * an asynchronous gate may outlive the call.
 */
export function invoke(tool: SeatTool, callId: string, spelled: JsonObject) {
  const args = tool.prepareArguments?.(spelled) ?? spelled;
  // SAFETY: these host tools use no API operations. Refuse any accidental access beyond `callId`.
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

export function sweep(): void {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * One Examiner session in `mode` in a temporary campaign, on a faux model that replays `responses`
 * and records each request in `sent`; its check program multiplies by seven where the answer is six
 * times the base.
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
    draft: {
      ...common,
      mode: "draft",
      prompt: "A fixture.",
      budget: { modelTurns: 20, minutes: 30, solves: 2 },
      reading: async () => [],
    },
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
    },
  } satisfies Requests;
  return {
    request: requests[mode],
    log,
    program,
    sent,
    /** Logged events of `kind`, less the turn-budget footer (`USED`), which is tested apart. */
    of: (kind: EventKind) =>
      read(log)
        .filter((event) => event.kind === kind)
        .map(({ data }) => (isString(data.text) ? { ...data, text: data.text.replace(USED, "") } : data)),
    versionOf: (taskId: string, base: number) =>
      taskVersion(pack({ taskId, family: "fixture", publicInput: { base }, hidden: { seed: 1 } })),
  };
}
