/**
 * The two entries of a standalone Built Harness bundle: solve one public task, and check one
 * artifact. Both run the product's own path — `solveCase` with the confined Pi solver, and
 * `gradeCase` with the verifier host — on a bundle directory that carries `agent/` and
 * `correctness-model/` beside a copied `src/`. `bundle-export.ts` writes such a directory; the
 * same functions serve a bundle still inside the repository.
 *
 * Checking writes public verdict fields to stdout: truthOk, pass, the non-result kind, failed
 * check ids, tool identities and the evidence path. Issue text, remedies and tool output are
 * protected verifier material and go only to the evidence file.
 */
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../meta/filesystem.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { sameJsonValue } from "../meta/stable-json.ts";
import { dirname, join, resolve } from "../meta/path.ts";
import { BRIEF_FILE, CONTROLS_FILE } from "../meta/bundle-layout.ts";
import { createSubmissionAuthority } from "../solve/final-submission.ts";
import { compilePublicArtifactSchema } from "../solve/public-artifact-schema.ts";
import { piBuiltReadAllowRoots, piBuiltSolver, resolvePiBuiltRuntime } from "../backends/pi-built.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import { resolveVerifier } from "../truth/verification-registry.ts";
import { CASE_ARTIFACT_FILE, type CaseRecord, SUBMIT_MAX_ATTEMPTS } from "../truth/battery-record.ts";
import { type Brief, externalChecksOf, throwIfInvalid } from "../truth/brief.ts";
import { validateBrief } from "../truth/brief-validator.ts";
import { loadCorrectnessModel } from "../truth/contracts.ts";
import { type ControlCorpus, isControlCorpus } from "../truth/controls.ts";
import { evaluateCheckProgram } from "../truth/predicate.ts";
import { createVerifierLifetime, VerifierOperationalStop } from "../verify/verifier-lifetime.ts";
import { applicableCheckIds } from "../truth/run-controls.ts";
import { builtStarterFactoryForSolver } from "../truth/solve.ts";
import { gradeCase, type SolveCaseEvidence, solveCase, solverBlockerOf } from "../truth/solve-case.ts";
import { commitPublicTask } from "../truth/task-split.ts";
import { type BuildTask, SAFE_TASK_ID } from "../truth/tasks.ts";
import { type PublicTaskVerdict, publicTaskVerdict } from "../truth/verdict-binding.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import { builtSolveIsolation } from "./built-agent-runtime.ts";
import { resolveBuiltSlot } from "./harness-measure.ts";
import { assertSupportedHostRuntime } from "./host-runtime-policy.ts";
import { loadRecordedTasks } from "./run-driver.ts";
import { asError } from "../meta/runtime-values.ts";
import { readJsonFile, writeJsonFile } from "../meta/completed-json.ts";

interface BundleContract {
  brief: Brief;
  corpus: ControlCorpus;
}

/** The complete verdict, issue text included: evidence for the operator, never for stdout. */
interface CheckEvidence {
  record: CaseRecord | null;
  verdict: CorrectnessModelResult | null;
  executionEvidence: ReturnType<VerifierHostHandle["evidence"]>;
  verifierCleanup: { state: "pending"; receiptIds: string[] } | { state: "complete" };
  failure: string | null;
}

interface RunBundleTaskOptions {
  /** Where case evidence and the accepted artifact are written. */
  outDir: string;
  maxTurns?: number;
}

interface RunBundleTaskResult {
  taskId: string;
  accepted: boolean;
  /** The accepted artifact file, or null when no submit was accepted. */
  artifactPath: string | null;
  turns: number;
  evidenceDir: string;
  builtModel: string;
  /** The typed environment blocker of an unaccepted solve, or null when the attempt is the agent's
   *  own. An exported bundle's caller cannot read the grading path, and without this it books a
   *  provider outage as a wrong answer (AGENTS.md rule 6). */
  nonResult: string | null;
}

/** The public projection of one verdict. Check ids are public authoring identities; issue text is
 *  not. */
export interface PublicVerdict extends PublicTaskVerdict {
  /** Digest and source of every external tool that ran. */
  tools: Record<string, { digest: string; source: string }>;
  /** Where the complete verdict, issue text included, was written. */
  evidencePath: string;
}

/** A recorded task or caller-owned task file. Expectations may be inherited only when the entire
 *  public task matches. Solving a new public task needs no answer key; checking it needs explicit
 *  expectations, including an explicit empty array for an entirely public verifier. */
export function resolveTask(bundleDir: string, ref: string, purpose: "solve" | "check" = "solve"): BuildTask {
  const recorded = loadRecordedTasks(bundleDir);
  const filePath = resolve(ref);
  if (!existsSync(filePath)) {
    const task = recorded.find((row) => row.taskId === ref);
    if (task === undefined) {
      throw new Error(`${ref}: neither a task file nor a task id in correctness-model/tasks.json`);
    }
    return task;
  }
  const parsed: unknown = readJsonFile(filePath);
  if (
    !isRecord(parsed) ||
    !isString(parsed.taskId) ||
    !SAFE_TASK_ID.test(parsed.taskId) ||
    !isString(parsed.family) ||
    !("publicInput" in parsed)
  ) {
    throw new Error(`${filePath}: expected {"taskId", "family", "publicInput", "hidden"?}`);
  }
  const same = recorded.find((row) => row.taskId === parsed.taskId);
  const bound =
    same !== undefined &&
    same.family === parsed.family &&
    sameJsonValue(same.publicInput, parsed.publicInput);
  const carried = bound ? same.hidden : undefined;
  const hidden = parsed.hidden === undefined ? carried : parsed.hidden;
  if (
    hidden !== undefined &&
    (!Array.isArray(hidden) ||
      hidden.some((row) => !isRecord(row) || !isString(row.checkId) || !("expectation" in row)))
  ) {
    throw new Error(`${filePath}: hidden must contain {checkId, expectation} rows`);
  }
  if (purpose === "check" && hidden === undefined) {
    throw new Error(
      `${filePath}: checking a new or changed public task requires explicit hidden expectations`,
    );
  }
  const task =
    /* SAFETY: parsed JSON, safe taskId, public fields and every hidden row were checked above. */ {
      taskId: parsed.taskId,
      family: parsed.family,
      publicInput: parsed.publicInput,
      hidden: hidden ?? [],
    } as BuildTask;
  return bound ? { ...same, ...task } : task;
}

export function loadContract(bundleDir: string): BundleContract {
  const briefUnknown = capturedJsonParse(readFileSync(join(bundleDir, BRIEF_FILE), "utf8"));
  throwIfInvalid(validateBrief(briefUnknown), "brief.json");
  const brief =
    /* SAFETY: throwIfInvalid above returns only when validateBrief reported ok, the only proof of this shape. */ briefUnknown as Brief;
  const corpus = capturedJsonParse(readFileSync(join(bundleDir, CONTROLS_FILE), "utf8"));
  if (!isControlCorpus(corpus)) throw new Error("controls.json: expected {accept: [...], reject: [...]}");
  return { brief, corpus };
}

function writeJson(path: string, value: SolveCaseEvidence | CheckEvidence): void {
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFile(path, value);
}

/** Solve one task once through the confined Built solver. No verdict: the artifact is what the
 *  agent submitted, and `checkBundleArtifact` decides. */
export async function runBundleTask(
  bundleDir: string,
  ref: string,
  options: RunBundleTaskOptions,
): Promise<RunBundleTaskResult> {
  assertSupportedHostRuntime();
  const task = resolveTask(bundleDir, ref);
  const { brief, corpus } = loadContract(bundleDir);
  const publicArtifactSchema = compilePublicArtifactSchema(
    brief.artifactSchema,
    corpus.accept.map((row) => row.artifact),
  );
  const slug = bundleSlug(bundleDir);
  const slots = resolveBuiltSlot(bundleDir, slug);
  const isolation = builtSolveIsolation(bundleDir, piBuiltReadAllowRoots(slots));
  const runtime = resolvePiBuiltRuntime(slots, bundleDir, isolation);
  const solver = piBuiltSolver(runtime, { maxTurns: options.maxTurns });
  const createStarter = builtStarterFactoryForSolver(solver);
  if (createStarter === undefined) throw new Error("the Built solver registered no starter factory");
  const evidenceDir = join(options.outDir, "cases", task.taskId);
  const solved = await solveCase(
    {
      createStarter: (publicTask, submission, schema) =>
        createStarter(bundleDir, publicTask, submission, schema),
      solver,
      publicArtifactSchema,
      maxSubmitAttempts: SUBMIT_MAX_ATTEMPTS,
      write: (path: string, value: SolveCaseEvidence) => writeJson(join(options.outDir, path), value),
    },
    task,
  );
  const artifactJson = solved.acceptedSubmit ? (solved.final?.artifactJson ?? null) : null;
  const artifactPath = artifactJson === null ? null : join(evidenceDir, CASE_ARTIFACT_FILE);
  if (artifactPath !== null && artifactJson !== null) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(artifactPath, artifactJson);
  }
  return {
    taskId: task.taskId,
    accepted: solved.acceptedSubmit,
    artifactPath,
    turns: solved.solved.turns,
    evidenceDir,
    builtModel: runtime.profile.model,
    nonResult: solverBlockerOf(solved),
  };
}

/** The bundle's slug: an exported bundle records it, a retained version's fingerprint names its
 *  project (its directory is the run id), and a `domains/` bundle is its directory name. */
export function bundleSlug(bundleDir: string): string {
  for (const file of ["harness.json", "version.json"]) {
    const recorded = join(bundleDir, file);
    const parsed: unknown = existsSync(recorded) ? readJsonFile(recorded) : null;
    const owner = isRecord(parsed) && isRecord(parsed.fingerprint) ? parsed.fingerprint : parsed;
    if (isRecord(owner) && isString(owner.slug)) return owner.slug;
  }
  return bundleDir.split("/").findLast((part) => part !== "") ?? "bundle";
}

/** Run the bundle's correctness model over one artifact, through the same `gradeCase` entry a
 *  measured battery uses. */
export async function checkBundleArtifact(
  bundleDir: string,
  ref: string,
  artifactPath: string,
  outDir: string,
): Promise<PublicVerdict> {
  assertSupportedHostRuntime();
  const task = resolveTask(bundleDir, ref, "check");
  const { brief, corpus } = loadContract(bundleDir);
  const schema = compilePublicArtifactSchema(
    brief.artifactSchema,
    corpus.accept.map((row) => row.artifact),
  );
  const verifierLifetime = createVerifierLifetime({ root: join(outDir, "verifier-lifetime") });
  const evidencePath = join(outDir, `${task.taskId}-verdict.json`);
  let graded: Awaited<ReturnType<typeof gradeCase>> | null = null;
  let verifier: VerifierHostHandle | undefined;
  let failure: Error | null = null;
  try {
    verifierLifetime.recover();
    verifierLifetime.assertUsable();
    const evaluate = evaluateCheckProgram(brief, await loadCorrectnessModel(bundleDir, verifierLifetime));
    const externalChecks = externalChecksOf(brief);
    ({ verifier } = resolveVerifier({
      toolTree: bundleSnapshotToolTree(bundleDir),
      bundleDir,
      toolIds: externalChecks.map((check) => check.adapterId),
      verifierLifetime,
    }));
    const artifactJson = readFileSync(resolve(artifactPath), "utf8");
    const final = createSubmissionAuthority({ maxAttempts: 1, publicArtifactSchema: schema }).acceptArtifact(
      artifactJson,
    );
    const instant = new Date().toISOString();
    graded = await gradeCase(
      {
        brief,
        evaluate,
        verifier,
        verifierLifetime,
        runId: `check-${instant.replace(/[:.]/g, "-")}`,
        externalChecks,
        applicableIds: applicableCheckIds(brief, task),
      },
      {
        task,
        committed: commitPublicTask(task),
        solved: { turns: 0, completedTurns: 0, errors: [] },
        final,
        finalDefect: null,
        acceptedSubmit: final.accepted,
        instants: { startedAt: instant, endedAt: instant },
      },
    );
    const tools: PublicVerdict["tools"] = {};
    for (const [id, entry] of Object.entries(verifier.tools())) {
      tools[id] = { digest: entry.digest, source: entry.source };
    }
    return { ...publicTaskVerdict(task.taskId, graded.record, graded.verdict), tools, evidencePath };
  } catch (error) {
    failure = asError(error);
    throw error;
  } finally {
    let cleanupFailure: Error | null = null;
    try {
      await verifierLifetime.close();
    } catch (error) {
      cleanupFailure = asError(error);
    }
    const pending = verifierLifetime.pendingReceipts();
    cleanupFailure ??= pending.length > 0 ? new VerifierOperationalStop("unsettled-children", pending) : null;
    const recordedFailure = failure ?? cleanupFailure;
    writeJson(evidencePath, {
      record: graded?.record ?? null,
      verdict: graded?.verdict ?? null,
      executionEvidence: verifier?.evidence() ?? [],
      verifierCleanup: pending.length > 0 ? { state: "pending", receiptIds: pending } : { state: "complete" },
      failure: recordedFailure === null ? null : String(recordedFailure),
    });
    // Cleanup uncertainty must refuse an otherwise successful public verdict.
    // eslint-disable-next-line no-unsafe-finally
    if (failure === null && cleanupFailure !== null) throw cleanupFailure;
  }
}
