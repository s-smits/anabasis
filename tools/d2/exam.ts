/**
 * The exam of a campaign that opened from a prompt, as files: the draft its log holds, staged as a
 * pack laid out the way a stored one is, so that every command reads it as it reads a v1 bundle.
 *
 * A check that names host/toolchain `tools` (such as `python3`, `bash`, or a domain engine) declares
 * external evidence backed by `.toolchain/bin` wrappers; a check with no tools declares author
 * evidence until admitted by `--admit` or an unattended launch (`tools/d1b/draft.ts`).
 */
import { type Draft, draftOf } from "#src/examiner/draft.ts";
import { readChecker } from "#src/kernel/acceptance.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import { CHECK_PROGRAM_CONTRACT, checkProgramVersion, openVerifier, readBrief } from "#src/kernel/verify.ts";
import { CHECK_BRIEF, EVALUATOR_FILE } from "#src/meta/bundle-layout.ts";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { toolchainPathDirs } from "#src/wall/policy.ts";
import { checkProgram, contractOf, packControls, readPack, toolOnPath } from "../m0/stored-sweep.ts";

/** A draft as a pack on disk. */
interface Staged {
  /** The pack, laid out as a stored bundle is. */
  readonly bundle: string;
  /** Its check program, staged without the tasks and the control answers, as a verifier opens it. */
  readonly checks: string;
}

/** How many characters of the draft's digest name its folder. */
const NAMED = 16;

/** Where `stageExam` stages `draft` under a campaign's folder, whether or not it has. */
function examStaged(dir: string, draft: Draft): Staged {
  const root = join(dir, "exams", hashJsonValue(draft).slice(0, NAMED));
  return { bundle: join(root, "bundle"), checks: join(root, "checks") };
}

/**
 * The exam a campaign's log drafted, where the campaign staged it, for a reader that may write
 * nothing under the campaign's folder (`tools/wri/wri.ts grade`): null where the log drafted no
 * exam, as an old campaign over a stored pack did, and refused where the draft was never staged.
 */
export function stagedExamOf(log: string): Staged | null {
  const draft = draftOf(read(log));
  if (draft === null) return null;
  const staged = examStaged(dirname(log), draft);
  if (!existsSync(staged.checks)) {
    throw new Error(`the campaign's drafted exam is not staged at ${staged.checks}`);
  }
  return staged;
}

/** The id of an example task, by its place in the draft. */
export const exampleId = (index: number): string => `ex-${String(index + 1).padStart(3, "0")}`;

/**
 * Stage a draft under a campaign's folder, and return where. Any plain program name declared by a
 * check or the objective (e.g. `python3`, `bash`, or a domain engine) that resolves on the wall's
 * toolchain search path is wrapped inside `.toolchain/bin` so check cells can run it cleanly.
 */
export function stageExam(dir: string, draft: Draft): Staged {
  const { bundle, checks } = examStaged(dir, draft);
  if (existsSync(checks)) return { bundle, checks };
  const model = join(bundle, "correctness-model");
  const bin = join(bundle, ".toolchain", "bin");
  mkdirSync(model, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const hostPath = toolchainPathDirs().join(":");
  const engines = [
    ...new Set([...draft.checks.flatMap(({ tools }) => tools ?? []), ...(draft.objectiveTools ?? [])]),
  ].filter(isSafePathSegment);
  for (const engine of engines) {
    if (Bun.which(engine, { PATH: hostPath }) === null) continue;
    const wrapper = join(bin, engine);
    // Strip lexical and canonical `.toolchain/bin` from PATH before `exec` so host/wall binaries
    // resolve cleanly even across macOS `/var` -> `/private/var` symlinks.
    writeFileSync(
      wrapper,
      [
        "#!/bin/sh",
        'raw="$(dirname -- "$0")"; self="$(CDPATH= cd -- "$raw" 2>/dev/null && pwd -P)"',
        'rest=""; oldIFS="$IFS"; IFS=:',
        "for d in $PATH; do",
        '  [ -z "$d" ] || [ "$d" = "$raw" ] || [ "$d" = "$self" ] && continue',
        '  [ "$(CDPATH= cd -- "$d" 2>/dev/null && pwd -P)" = "$self" ] && continue',
        '  rest="${rest:+$rest:}$d"',
        "done",
        `IFS="$oldIFS"; PATH="$rest" exec ${engine} "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(wrapper, 0o755);
  }
  const hidden = draft.tasks.some((task) => task.hidden !== null) ? "whole" : "none";
  const brief = {
    correctnessContract: CHECK_PROGRAM_CONTRACT,
    domain: draft.domain,
    scope: draft.scope,
    conventions: draft.conventions,
    ruleDecisions: draft.rules.map((rule) => ({ ...rule, visibility: "public" })),
    truthChecks: draft.checks.map(({ id, rule, assertion, tools }) => {
      const used = (tools ?? []).filter(isSafePathSegment);
      const [first, ...more] = used;
      const required: [string, ...string[]] | undefined = first === undefined ? undefined : [first, ...more];
      return {
        id,
        assertion,
        citedDecisionIds: [rule],
        execution: {
          families: "all",
          artifactPaths: ["$"],
          filePaths: ["$"],
          publicInputPaths: ["$"],
          hidden,
          ...(required === undefined
            ? { evidence: { kind: "authored" } }
            : { requiredToolIds: required, evidence: { kind: "external", requiredToolIds: required } }),
        },
      };
    }),
    ...keyIfDefined("objective", draft.objective),
    ...keyIfDefined(
      "objectiveTools",
      draft.objective !== undefined && draft.objectiveTools !== undefined && draft.objectiveTools.length > 0
        ? [...draft.objectiveTools]
        : undefined,
    ),
    artifactSchema: [],
    designRuleConstants: [],
  };
  const controls = {
    accept: draft.accept.map(({ task, answer, files }) => ({
      taskId: exampleId(task),
      artifact: answer,
      ...keyIfDefined("files", files),
    })),
    reject: draft.reject.map(({ task, answer, files, check }) => ({
      taskId: exampleId(task),
      artifact: answer,
      ...keyIfDefined("files", files),
      expectedCheckId: check,
    })),
  };
  const tasks = draft.tasks.map((task, index) => ({ taskId: exampleId(index), ...task }));
  for (const [file, value] of [
    [CHECK_BRIEF, brief],
    ["tasks.json", tasks],
    ["controls.json", controls],
  ] as const) {
    writeFileSync(join(model, file), `${capturedJsonStringify(value, null, 2)}\n`);
  }
  writeFileSync(join(model, EVALUATOR_FILE), draft.evaluator);
  checkProgram(bundle, checks);
  return { bundle, checks };
}

/**
 * What the host reads of a draft whose shape holds, one sentence a fault: the acceptance reading
 * every checker is held to, less the faults that are the operator's to admit, with the checker
 * read and the whole reading, which a draft that stands keeps as the campaign's (`draft.ts`). A
 * check program that does not load or a wall that is not there stops a verifier, and here that is
 * told as a fault too: the draft's author is in the session and can mend the first. The session
 * reads the draft's shape before it calls this (`draftFaults`), and the reading's notes are left
 * out, since on the reply that ends the session they would carry nothing to a model.
 */
export async function draftReading(dir: string, draft: Draft, width: number) {
  try {
    const { bundle, checks } = stageExam(dir, draft);
    const pack = readPack(bundle);
    const contract = contractOf(pack.brief, draft.answerFormat);
    const controls = packControls(bundle);
    const verify = openVerifier({ checks, tools: join(bundle, ".toolchain") });
    const reading = await readChecker({
      verify,
      brief: readBrief(checks),
      contract,
      tasks: pack.tasks,
      controls,
      found: toolOnPath(bundle),
      width,
    });
    // The checker as a campaign opens it (`openCampaign`), so that one frozen here is the one it runs.
    const checker = { contract: contractHash(contract), checks: hashJsonValue(checkProgramVersion(checks)) };
    const faults: readonly string[] = reading.faults;
    return { faults, read: { checker, reading } };
  } catch (error) {
    const faults: readonly string[] = [
      `the check program could not be put to its controls: ${errorMessage(error)}`,
    ];
    return { faults };
  }
}
