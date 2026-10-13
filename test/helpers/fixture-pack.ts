// The fixture pack a scripted campaign runs over: seven tasks whose answer is the base times six,
// one authored check, and a control of each kind, laid out as a stored sweep and its pack as v1
// left one. Shared by the campaign tests and the climb simulation.
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { cpSync, mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";

export const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const TOOL_USE = { stopReason: "toolUse" } as const;

/** One call of a scripted model: a tool and its arguments, or what makes them when the model is
 *  asked, which may wait on the test. */
export type Step =
  | readonly [string, JsonObject]
  | { readonly wait: () => Promise<readonly [string, JsonObject]> };

/** A fixture task: its answer is six times its base. */
export interface FixtureTask {
  readonly taskId: string;
  readonly family: "fixture";
  readonly publicInput: { readonly base: number };
  readonly hidden: null;
}

/** `count` fixture tasks, bases 2 upwards. */
export const fixtureTasks = (count: number): FixtureTask[] =>
  Array.from({ length: count }, (_, index) => ({
    taskId: `t-${String(index + 1)}`,
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
 *  harness blocked is asked again until its turns end. */
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
  return { model: faux.getModel(), models: () => models };
}

/** A stored sweep and its pack as v1 left one: seven tasks whose answer is the base times six, one
 *  check, and a control of each kind. */
export function layOutPack(
  root: string,
  bundle: string,
  tasks: readonly FixtureTask[],
  fixture: string,
): void {
  const model = join(bundle, "correctness-model");
  mkdirSync(join(root, "grades", "s"), { recursive: true });
  const graded = tasks.map(({ taskId }) => ["1", taskId, "verified-pass", ""].join("\t"));
  writeFileSync(
    join(root, "grades", "s", "grades.tsv"),
    `${["cycle\ttaskId\tkind\tblockingChecks", ...graded].join("\n")}\n`,
  );
  for (const { taskId, publicInput } of tasks) {
    const dir = join(root, "runs", "s", "c01", taskId);
    const caseDir = join(dir, "harness", "cases", taskId);
    mkdirSync(caseDir, { recursive: true });
    mkdirSync(join(dir, "work"), { recursive: true });
    const stored = {
      provider: "claude",
      model: "claude-opus-5-5",
      timedOut: false,
      answerPresent: true,
      answerParses: true,
    };
    writeFileSync(join(dir, "result.json"), JSON.stringify(stored));
    writeFileSync(join(dir, "work", "answer.json"), JSON.stringify({ answer: String(publicInput.base * 6) }));
    const ended = { status: "ended", inputTokens: 1, outputTokens: 1, costUsd: 0.01 };
    writeFileSync(join(caseDir, "trace.json"), JSON.stringify({ turns: [ended] }));
    writeFileSync(
      join(caseDir, "built-runtime.json"),
      JSON.stringify({
        modelWorker: { modelSelection: { effort: "medium" } },
        contractCondition: {
          tools: [{ description: "Role: artifact-writer. Records.", parameters: FORMAT }],
        },
      }),
    );
  }
  cpSync(fixture, join(root, "hb-bundles", "s-c01"), { recursive: true });
  mkdirSync(model, { recursive: true });
  mkdirSync(join(bundle, ".toolchain", "bin"), { recursive: true });
  const execution = {
    families: "all",
    artifactPaths: ["$.answer"],
    publicInputPaths: ["$.base"],
    hidden: "none",
    evidence: { kind: "authored" },
  };
  writeFileSync(
    join(model, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      domain: "Fixture",
      ruleDecisions: [{ id: "R1", statement: "The answer is the base times six.", visibility: "public" }],
      truthChecks: [{ id: "check-product", assertion: "Six times.", citedDecisionIds: ["R1"], execution }],
      artifactSchema: [],
      designRuleConstants: [],
    }),
  );
  writeFileSync(
    join(model, "evaluator.ts"),
    `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),\n};\n`,
  );
  writeFileSync(join(model, "tasks.json"), JSON.stringify(tasks));
  writeFileSync(
    join(model, "controls.json"),
    JSON.stringify({
      accept: tasks.map(({ taskId, publicInput }) => ({
        taskId,
        artifact: { answer: String(publicInput.base * 6) },
      })),
      reject: [{ taskId: "t-1", artifact: { answer: "13" }, expectedCheckId: "check-product" }],
    }),
  );
}
