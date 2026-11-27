/**
 * The exam of a campaign opened from a prompt, as files: the draft its log holds, staged as a pack
 * laid out as a stored one is, so every command reads it as it reads a v1 bundle.
 */
import { refuseNamingHome } from "#src/builder/store.ts";
import { type Draft, draftOf } from "#src/examiner/draft.ts";
import { readChecker } from "#src/kernel/acceptance.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read, TRACE_KINDS } from "#src/kernel/log.ts";
import {
  CHECK_PROGRAM_CONTRACT,
  checkProgramVersion,
  HOST_TOOLS_FILE,
  openVerifier,
  readBrief,
} from "#src/kernel/verify.ts";
import { CHECK_BRIEF, EVALUATOR_FILE, TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { toolTreeSearchDirs } from "#src/sandbox/isolation.ts";
import { checkProgram, contractOf, packControls, readPack, toolOnPath } from "../m0/stored-sweep.ts";

interface Staged {
  readonly bundle: string;
  /** Its check program without the tasks and control answers, as a verifier opens it. */
  readonly checks: string;
}

/** How many characters of the draft's digest name its folder. */
const NAMED = 16;

function examStaged(dir: string, draft: Draft): Staged {
  const root = join(dir, "exams", hashJsonValue(draft).slice(0, NAMED));
  return { bundle: join(root, "bundle"), checks: join(root, "checks") };
}

/**
 * For a reader that may write nothing under the campaign's folder (`tools/wri/wri.ts grade`): null
 * where the log drafted no exam, as an old campaign over a stored pack did, and refused where the
 * draft was never staged.
 */
export function stagedExamOf(log: string): Staged | null {
  const draft = draftOf(read(log, TRACE_KINDS));
  if (draft === null) return null;
  const staged = examStaged(dirname(log), draft);
  if (!existsSync(staged.checks)) {
    throw new Error(`the campaign's drafted exam is not staged at ${staged.checks}`);
  }
  return staged;
}

export const exampleId = (index: number): string => `ex-${String(index + 1).padStart(3, "0")}`;

/** Freezes any Examiner-installed `.toolchain/` from `sourceHome` (preserving symlinks) and writes
 *  `.toolchain/host-tools.json` with `origin: "draft"` and the remaining declared host executables,
 *  so `resolveVerifierTool` dispatches to them directly while drafted checks stay `author` under
 *  rule 10 until admitted. */
function sameDir(a: string, b: string): boolean {
  return existsSync(a) && existsSync(b) ? realpathSync(a) === realpathSync(b) : resolve(a) === resolve(b);
}

function stageTools(bundle: string, draft: Draft, sourceHome?: string): void {
  const toolchain = join(bundle, TOOL_TREE_DIR);
  if (sourceHome !== undefined && !sameDir(sourceHome, bundle)) {
    rmSync(toolchain, { recursive: true, force: true });
    const homeTools = join(sourceHome, TOOL_TREE_DIR);
    const homeStat = lstatSync(homeTools, { throwIfNoEntry: false });
    if (homeStat !== undefined) {
      if (!homeStat.isDirectory()) {
        throw new Error(`${TOOL_TREE_DIR} in your drafting home must be a directory, not a file or symlink`);
      }
      cpSync(homeTools, toolchain, { recursive: true, verbatimSymlinks: true });
      refuseNamingHome(toolchain, sourceHome, TOOL_TREE_DIR);
    }
  }
  const binDir = join(toolchain, "bin");
  const binStat = lstatSync(binDir, { throwIfNoEntry: false });
  if (binStat !== undefined && !binStat.isDirectory()) {
    throw new Error(".toolchain/bin in your drafting home must be a directory, not a file or symlink");
  }
  mkdirSync(binDir, { recursive: true });
  const stagedPath = toolTreeSearchDirs(toolchain).join(":");
  const engines = [
    ...new Set([...draft.checks.flatMap(({ tools }) => tools ?? []), ...(draft.objectiveTools ?? [])]),
  ].filter(isSafePathSegment);
  for (const engine of engines) {
    const binEntry = join(binDir, engine);
    const entryStat = lstatSync(binEntry, { throwIfNoEntry: false });
    if (entryStat?.isSymbolicLink() === true && !existsSync(binEntry)) {
      throw new Error(`.toolchain/bin/${engine} is a broken symlink`);
    }
    if (entryStat?.isFile() === true && (entryStat.mode & 0o111) === 0) {
      throw new Error(`.toolchain/bin/${engine} is not executable (run chmod +x)`);
    }
  }
  const hostOnly = engines.filter((engine) => Bun.which(engine, { PATH: stagedPath }) === null);
  const hostFile = join(toolchain, HOST_TOOLS_FILE);
  rmSync(hostFile, { recursive: true, force: true });
  writeFileSync(hostFile, `${capturedJsonStringify({ origin: "draft", tools: hostOnly }, null, 2)}\n`);
}

export function stageExam(dir: string, draft: Draft, sourceHome?: string): Staged {
  const { bundle, checks } = examStaged(dir, draft);
  if (existsSync(checks)) {
    if (sourceHome !== undefined) stageTools(bundle, draft, sourceHome);
    return { bundle, checks };
  }
  const model = join(bundle, "correctness-model");
  mkdirSync(model, { recursive: true });
  stageTools(bundle, draft, sourceHome);
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
          ...keyIfDefined("requiredToolIds", required),
          evidence: { kind: "authored" },
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
 * The acceptance reading every checker is held to, less the faults the operator admits, with the
 * checker and the whole reading a standing draft keeps (`draft.ts`). A check program that does not
 * load or a missing wall is told as a fault too, since the draft's author is in the session and can
 * mend the first. The session reads the draft's shape first (`draftFaults`).
 */
export async function draftReading(dir: string, draft: Draft, width: number, sourceHome?: string) {
  try {
    const { bundle, checks } = stageExam(dir, draft, sourceHome);
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
    // The checker as `openCampaign` opens it, so one frozen here is the one it runs.
    const checker = { contract: contractHash(contract), checks: hashJsonValue(checkProgramVersion(checks)) };
    const faults: readonly string[] = reading.faults;
    return {
      faults,
      read: { checker, reading, checks, contract, tasks: pack.tasks, controls, verify },
    };
  } catch (error) {
    const faults: readonly string[] = [
      `the check program could not be put to its controls: ${errorMessage(error)}`,
    ];
    return { faults };
  }
}
