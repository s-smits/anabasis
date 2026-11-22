// The fixture exam a scripted campaign runs over: tasks whose answer is the base times six, one
// authored check, and a control of each kind, as the campaign's log drafted it. Shared by the
// campaign tests and the climb simulation.
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { Draft } from "../../src/examiner/draft.ts";
import { append, LOG_FILE } from "../../src/kernel/log.ts";
import { mkdirSync } from "../../src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "../../src/meta/json-runtime.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";
import { exampleId } from "../../tools/d2/exam.ts";

export const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const TOOL_USE = { stopReason: "toolUse" } as const;

/** The words a fixture campaign opens from, and who solves under it. */
export const OPENED_FROM = [
  "--prompt",
  "Multiply a base by six.",
  "--solver",
  "claude/claude-opus-5-5",
] as const;
const SOLVER = { model: "claude/claude-opus-5-5", effort: "medium" };

/** One call of a scripted model: a tool and its arguments, or what makes them when the model is
 *  asked, which may wait on the test. */
export type Step =
  | readonly [string, JsonObject]
  | { readonly wait: () => Promise<readonly [string, JsonObject]> };

/** A fixture task: its answer is six times its base, under the id its place in the draft gives it. */
export interface FixtureTask {
  readonly taskId: string;
  readonly family: "fixture";
  readonly publicInput: { readonly base: number };
  readonly hidden: null;
}

/** `count` fixture tasks, bases 2 upwards. */
export const fixtureTasks = (count: number): FixtureTask[] =>
  Array.from({ length: count }, (_, index) => ({
    taskId: exampleId(index),
    family: "fixture",
    publicInput: { base: index + 2 },
    hidden: null,
  }));

/** The pack's controls, as a rehearsal's solves are scripted from them. */
export const gradedOf = (tasks: readonly FixtureTask[]) =>
  tasks.map(({ taskId, publicInput }) => ({
    taskId,
    answer: { answer: String(publicInput.base * 6) },
    refusedBy: null,
  }));

/** A model that makes `calls` in order, a turn each, and then says it holds no further call as
 *  often as `asked`: a faux provider asked past its responses waits, and a solve whose submit the
 *  harness blocked is asked again until its turns end. It takes no `rest`: a script holds no call
 *  for a later ask, so an Examiner seated on one ends where its work is done (`conversing`). */
export function scriptedModel(calls: readonly Step[], asked = 0) {
  const faux = fauxProvider({
    models: [
      { id: "script", contextWindow: 200_000, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
    ],
  });
  faux.setResponses([
    ...calls.map((call) =>
      "wait" in call
        ? async () => {
            const [name, args] = await call.wait();
            return fauxAssistantMessage(fauxToolCall(name, args), TOOL_USE);
          }
        : fauxAssistantMessage(fauxToolCall(call[0], call[1]), TOOL_USE),
    ),
    ...Array.from({ length: asked }, () => fauxAssistantMessage("The script holds no further call.")),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  return { model: faux.getModel(), models: () => models, rest: undefined };
}

/** The exam a fixture campaign drafted: one check, the tasks as its examples, an accept control
 *  for each of the first `answered` and one reject control. */
export const fixtureDraft = (tasks: readonly FixtureTask[], answered = tasks.length): Draft => ({
  domain: "Fixture products",
  scope: "A task gives a base and asks for six times it.",
  conventions: "The answer is a decimal string without a sign.",
  rules: [
    { id: "R1", statement: "The answer is the base times six.", source: "A fixture: no field states it." },
  ],
  answerFormat: FORMAT,
  checks: [{ id: "check-product", rule: "R1", assertion: "The answer is six times the base." }],
  evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),\n};\n`,
  tasks: tasks.map(({ family, publicInput, hidden }) => ({ family, publicInput, hidden })),
  accept: tasks
    .slice(0, answered)
    .map(({ publicInput }, task) => ({ task, answer: { answer: String(publicInput.base * 6) } })),
  reject: [{ task: 0, answer: { answer: "13" }, check: "check-product" }],
  unmeasured: "A fixture: every task has one product, and no product is better than another.",
});

/** A campaign's folder holding the fixture exam its log drafted, as a campaign that opened from
 *  `OPENED_FROM` holds one once its first draft stood: its opening, then the draft. */
export function layOutPack(folder: string, tasks: readonly FixtureTask[], answered?: number): void {
  layOutDraft(folder, fixtureDraft(tasks, answered));
}

/** A campaign's folder holding `draft` as the exam its log drafted, after its opening. */
export function layOutDraft(folder: string, draft: Draft): void {
  mkdirSync(folder, { recursive: true });
  append(join(folder, LOG_FILE), "campaign.opened", { prompt: OPENED_FROM[1], solver: SOLVER });
  append(join(folder, LOG_FILE), "exam.drafted", {
    session: "d-1",
    draft: parseJsonAs<JsonObject>(capturedJsonStringify(draft)),
  });
}
