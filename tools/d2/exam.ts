/**
 * The exam of a campaign that opened from a prompt, as files: the draft its log holds, staged as a
 * pack laid out the way a stored one is, so that every command reads it as it reads a v1 bundle.
 *
 * A draft is in the log whole (`exam.drafted`, `src/examiner/draft.ts`), and the log is the one
 * store. What is staged here is a view of it, under the draft's own digest: written again from
 * the log whenever it is missing, and never read back as the truth. A campaign whose exam is
 * drafted again before it is frozen stages the new draft beside the old.
 *
 * Every check of a staged exam declares its author's own computation as its evidence. Nothing
 * installs an engine of the field for a campaign, so no check can honestly declare one, and the
 * acceptance reading lists each as a fault until the operator admits it by name
 * (`tools/c/accept.ts`). A check reads the whole answer and the whole public input: the paths a
 * v1 check declared kept a tool's operands inside what the check could read, and these checks
 * run no tool.
 */
import { type Draft, draftFaults } from "#src/examiner/draft.ts";
import { doNothingFaults, readChecker } from "#src/kernel/acceptance.ts";
import { CHECK_PROGRAM_CONTRACT, openVerifier, readBrief } from "#src/kernel/verify.ts";
import { EVALUATOR_FILE } from "#src/meta/bundle-layout.ts";
import { existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { checkProgram, contractOf, packControls, readPack, toolOnPath } from "../m0/stored-sweep.ts";

/** A draft as a pack on disk. */
interface Staged {
  /** The pack, laid out as a stored bundle is. */
  readonly bundle: string;
  /** Its check program, staged without the tasks and the controls, as a verifier opens it. */
  readonly checks: string;
}

/** How many characters of the draft's digest name its folder. */
const NAMED = 16;

/** The id of an example task, by its place in the draft. */
const exampleId = (index: number): string => `ex-${String(index + 1).padStart(3, "0")}`;

/**
 * Stage a draft under a campaign's folder, and return where. The folder is named by the draft's
 * digest, so one draft is staged once, and the check program's copy is made last: a folder that
 * holds it was staged whole.
 */
export function stageExam(dir: string, draft: Draft): Staged {
  const root = join(dir, "exams", hashJsonValue(draft).slice(0, NAMED));
  const bundle = join(root, "bundle");
  const checks = join(root, "checks");
  if (existsSync(checks)) return { bundle, checks };
  const model = join(bundle, "correctness-model");
  mkdirSync(model, { recursive: true });
  mkdirSync(join(bundle, ".toolchain", "bin"), { recursive: true });
  const hidden = draft.tasks.some((task) => task.hidden !== null) ? "required" : "none";
  const write = <T>(file: string, value: T) =>
    writeFileSync(join(model, file), `${capturedJsonStringify(value, null, 2)}\n`);
  write("brief.json", {
    correctnessContract: CHECK_PROGRAM_CONTRACT,
    domain: draft.domain,
    scope: draft.scope,
    conventions: draft.conventions,
    ruleDecisions: draft.rules.map((rule) => ({ ...rule, visibility: "public" })),
    truthChecks: draft.checks.map(({ id, rule, assertion }) => ({
      id,
      assertion,
      citedDecisionIds: [rule],
      execution: {
        families: "all",
        artifactPaths: ["$"],
        publicInputPaths: ["$"],
        hidden,
        evidence: { kind: "authored" },
      },
    })),
    artifactSchema: [],
    designRuleConstants: [],
  });
  write(
    "tasks.json",
    draft.tasks.map((task, index) => ({ taskId: exampleId(index), ...task })),
  );
  write("controls.json", {
    accept: draft.accept.map(({ task, answer }) => ({ taskId: exampleId(task), artifact: answer })),
    reject: draft.reject.map(({ task, answer, check }) => ({
      taskId: exampleId(task),
      artifact: answer,
      expectedCheckId: check,
    })),
  });
  writeFileSync(join(model, EVALUATOR_FILE), draft.evaluator);
  checkProgram(bundle, checks);
  return { bundle, checks };
}

/**
 * What the host reads of a draft without a model, one sentence a fault: its shape, and then the
 * acceptance reading every checker is held to, less the faults that are the operator's to admit.
 * A check program that does not load or a wall that is not there stops a verifier, and here that
 * is told as a fault too: the draft's author is in the session and can mend the first.
 */
export async function draftReading(dir: string, draft: Draft, width: number): Promise<string[]> {
  const unformed = draftFaults(draft);
  if (unformed.length > 0) return unformed;
  try {
    const { bundle, checks } = stageExam(dir, draft);
    const brief = readBrief(checks);
    const pack = readPack(bundle);
    const { seen, rejected } = await readChecker({
      verify: openVerifier({ checks, tools: join(bundle, ".toolchain") }),
      brief,
      contract: contractOf(pack.brief, draft.answerFormat),
      tasks: pack.tasks,
      controls: packControls(bundle),
      stored: [],
      found: toolOnPath(bundle),
      width,
    });
    return [...seen.faults, ...doNothingFaults(rejected)];
  } catch (error) {
    return [`the check program could not be put to its controls: ${errorMessage(error)}`];
  }
}
