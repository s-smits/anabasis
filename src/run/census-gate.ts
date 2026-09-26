/**
 * The census gate runs over a fingerprinted candidate, the last thing between a build and paid
 * measurement. It counts the tasks against the size the round asked for, executes every control
 * through the host verifier to see whether the declared checks discriminate a correct artifact
 * from a broken one, and runs the F2 reference solve of every authored task.
 *
 * The controls and F2 run beside each other rather than in sequence, so one call reports every
 * blocking row of one tree; in sequence, a candidate wrong in both places repairs the census,
 * resubmits, and only then meets F2's rows. Results are written beside the candidate as
 * census.json and returned to the same authoring session, because a refusal keeps the session and
 * the session is what has to act on it.
 */
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { existsSync, readFileSync, readdirSync } from "../meta/filesystem.ts";
import { join, relative, sep } from "../meta/path.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { BuiltHarness, CampaignFeedback, FeedbackOwner } from "../author/campaign-types.ts";
import { TOOL_NON_RESULT_FILE, toolNonResultCode } from "../author/tool-non-result.ts";
import { type TracePointer, tracePointer } from "../claim/case-record.ts";
import { writeCompleted } from "../meta/completed-json.ts";
import { type ContractFinding, controllerValidatedFindings } from "../correctness-bundle/brief.ts";
import { TOOL_REFUSED_CODE } from "../correctness-bundle/grounding-coverage.ts";
import type { ProbeControls, ProbeControlsResult } from "../correctness-bundle/probes.ts";
import type { ControlReceipt } from "../correctness-bundle/battery-record.ts";
import { REFERENCE_SOLVE_ENTRY } from "../correctness-bundle/evaluator-process-bundle.ts";
import type { CheckCost, ToolCheckCoverage } from "../correctness-bundle/grounding-coverage.ts";
import {
  VerifierExecutionNonResult,
  environmentOwnedToolNonResult,
  toolRetryDelay,
} from "../correctness-bundle/verifier-nonresult.ts";
import type { VerifierExecutionEvidence } from "../verify/verifier-port.ts";
import type { SubjectCheckRun } from "../verify/correctness-model-result.ts";
import type { SolvabilityCensusGate } from "./solvability-gate.ts";
import { harnessSettings } from "../correctness-bundle/harness-config.ts";
import type { SolvabilityStageCache } from "../correctness-bundle/solvability-stages.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { EVALUATOR_FILE, GENERATED_TOOLS_FILE } from "../meta/bundle-layout.ts";
import { CONFORMANCE_FILE } from "../claim/conformance-evidence.ts";

/** The control-census record written beside an iteration's candidate. */
export const CENSUS_FILE = "census.json";

interface CensusGateOptions {
  verifierLifetime?: VerifierLifetime;
  probeControls: ProbeControls;
  /** Required battery size; the census must cover the complete task set. */
  expectedTasks: number;
  /** F2 reference solve of every task, run beside the control census. The same slot carries the
   *  input-insensitivity observation and the accept-control independence reading, which raise
   *  advisory findings against `brief` and `accept-controls`; all three need F2's witnesses, which
   *  exist only while F2 is running. */
  solvability?: SolvabilityCensusGate;
  /** Wait before the one retry an environment-owned refusal earns; tests pass 0. */
  toolRetryWaitMs?: number;
  /** Census wall in milliseconds; unset reads ANA_CENSUS_WALL_MS, then agent/config.yaml. */
  censusWallMs?: number;
}

type CensusEvidence = {
  executionEvidence?: VerifierExecutionEvidence[];
  acceptControls: number;
  rejectControls: number;
  tasks: number;
  expectedTasks: number;
  findings: ContractFinding[];
  /** Advisory rows returned beside the verdict. They do not fail the census and `blocking` below
   *  keeps only blocking rows, so this is the one place on disk recording that an advisory screen
   *  fired; the rows themselves are returned in-session and then gone. Absent rather than empty
   *  when the gate exited before the screens ran, since that says nothing about what they would
   *  have found. */
  advisory?: CampaignFeedback[];
  /** Public results of the live control check; hidden values and verifier detail stay private. A
   *  missing list stays missing rather than becoming zero controls, because no controls ran and no
   *  controls exist are different candidates. */
  controlReceipts?: ControlReceipt[];
  /** Per tool-backed check: how often the host ran its tool and how many rejects it blocked, both
   *  public counts. Zero runs is the refusal recorded elsewhere, not a check declining to call its
   *  tool. */
  toolCheckCoverage?: ToolCheckCoverage[];
  /** Each check's cost in dispatches, wall time and tool runs. The author reads it back through
   *  `correctness_check`, the only point where a check's price is visible with session left to
   *  cut it. */
  checkCost?: CheckCost[];
  /** One row per check per control attempt, host evidence that no author projection reads. */
  checkRuns?: SubjectCheckRun[];
  /** Every blocking row behind a `fail`, by owner and finding codes. `findings` above holds only
   *  the executed control census, and most fails come from the battery count, reject coverage or
   *  F2 rows while `findings` stays empty, so without this field the record would give no reason
   *  for the failure. */
  blocking: Array<{ owner: FeedbackOwner; claim: string; codes: string[] }>;
  verdict: "pass" | "fail" | { kind: "non-result"; evidence: TracePointer };
  /** The protected non-result file, bound by digest, when an authored tool run failed and the
   *  verdict is an ordinary `fail`. The environment path binds its evidence through the verdict
   *  pointer; a `fail` carries no pointer, so without this the file would sit beside census.json
   *  untied to it. */
  verifierNonResultEvidence?: TracePointer;
};

type EnvironmentEvidence =
  | VerifierExecutionEvidence
  | { kind: "vendor-resolution-broken"; package: string; detail: string }
  | { kind: typeof TOOL_REFUSED_CODE; detail: string };

/** One gate call: what it runs against, and the options the gate was made with. Every settlement
 *  below needs the same fields, so they travel as one value rather than a repeated prefix. */
type CensusContext = {
  options: CensusGateOptions;
  harness: BuiltHarness;
  iterationDir: string;
  slugDir: string;
  stages: SolvabilityStageCache | undefined;
  scope: GateScope;
};

/** What one gate call covers. The validation pipeline sets `referenceSolve` only when conformance
 *  returned no findings, because F2 drives the generated tools and a candidate whose tools did not
 *  load cannot solve anything. The control census runs the evaluator and never the tools, so such
 *  a candidate still gets its discrimination reading. */
export interface GateScope {
  referenceSolve: boolean;
}

type CensusStage = "controls" | "reference solve";

/** The longest a cut census waits for its started controls or reference tasks to finish. */
const CENSUS_SETTLE_GRACE_MS = 60_000;

/** What one census attempt finished before a stage failed. The controls and F2 run side by side,
 *  so one failing leaves the other's rows and receipts in hand; they stay beside the failure
 *  rather than being discarded with their sibling. */
interface Completed {
  probe?: ProbeControlsResult;
  rows: CampaignFeedback[];
}

const NOTHING_COMPLETED: Completed = { rows: [] };

interface CensusFailure {
  failure: unknown;
  completed: Completed;
}

/** The operator's wall override, resolved once when the gate is made rather than when it first
 *  runs, so a malformed value throws before the session spends anything on a candidate it cannot
 *  census. Null leaves the wall to the candidate's own `gate.census_minutes`, the ordinary case. */
function censusWallOverrideMs(explicit: number | undefined): number | null {
  const raw = Bun.env.ANA_CENSUS_WALL_MS;
  if (explicit === undefined && raw === undefined) return null;
  const ms = explicit ?? Number(raw);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(
      `ANA_CENSUS_WALL_MS must be a positive integer of milliseconds, got "${explicit ?? raw}"`,
    );
  }
  return ms;
}

class CensusWallExceeded extends Error {
  constructor(
    readonly wallMs: number,
    readonly stage: CensusStage,
  ) {
    super(`the census did not finish within its ${wallMs}ms wall`);
  }
}

/** One wall per census attempt, raced against each stage that runs tools. The control census and
 *  F2 run at the same time, so the wall cannot simply name the stage it interrupted; it names the
 *  controls while they are still running and the reference solve otherwise.
 *
 *  Past the wall no stage admits further work, but work already started cannot be recalled and it
 *  holds tool cells. `settle` waits a bounded grace for it, so a retry or a later submit does not
 *  run its own tools alongside an abandoned stage's. */
function censusWall(wallMs: number) {
  const running = new Set<CensusStage>();
  let stopped = false;
  const work: Promise<unknown>[] = [];
  const expired = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    stopped = true;
    expired.reject(
      new CensusWallExceeded(
        wallMs,
        running.has("controls") || running.size === 0 ? "controls" : "reference solve",
      ),
    );
  }, wallMs);
  timer.unref();
  // Rejecting between stages must not surface as an unhandled rejection; the next race observes it.
  expired.promise.catch(() => undefined);
  return {
    under: <T>(stage: CensusStage, next: Promise<T>): Promise<T> => {
      running.add(stage);
      const settled = next.finally(() => running.delete(stage));
      work.push(settled.catch(() => undefined));
      return Promise.race([settled, expired.promise]);
    },
    stopped: () => stopped,
    settle: async () => {
      const grace = Promise.withResolvers<void>();
      const graceTimer = setTimeout(grace.resolve, Math.min(wallMs, CENSUS_SETTLE_GRACE_MS));
      await Promise.race([Promise.all(work), grace.promise]);
      clearTimeout(graceTimer);
    },
    clear: () => clearTimeout(timer),
  };
}

/** Every census record, pass or fail: the corpus counts, whatever the controls completed, and the
 *  rows behind the verdict. Conformance is written beside it whatever the verdict, because that
 *  probe ran before this call and does not depend on how the census ended. A census non-result
 *  must not erase complete evidence: `assessReadiness` cannot distinguish "the tools were never
 *  probed" from "the probe succeeded and its file was dropped", and would report
 *  `conformance-unprobed` for both. Adoption copies the file into the retained product version,
 *  where `conformance-evidence.ts` reads it. */
function persistCensus(
  { options, harness, iterationDir }: CensusContext,
  feedback: readonly CampaignFeedback[],
  probe: ProbeControlsResult | undefined,
  verdict: CensusEvidence["verdict"],
  extra: Partial<Pick<CensusEvidence, "findings" | "advisory" | "verifierNonResultEvidence">> = {},
): void {
  writeCompleted(join(iterationDir, CENSUS_FILE), {
    acceptControls: harness.corpus.accept.length,
    rejectControls: harness.corpus.reject.length,
    tasks: harness.battery.tasks.length,
    expectedTasks: options.expectedTasks,
    findings: [],
    ...keyIfDefined("controlReceipts", probe?.controlReceipts),
    ...keyIfDefined("toolCheckCoverage", probe?.toolCheckCoverage),
    ...keyIfDefined("checkCost", probe?.checkCost),
    ...keyIfDefined("checkRuns", probe?.checkRuns),
    ...keyIfDefined("executionEvidence", probe?.executionEvidence),
    blocking: feedback
      .values()
      .filter((row) => row.severity === "blocking")
      .map((row) => ({
        owner: row.owner,
        claim: row.claim,
        codes: (row.findings ?? []).map((finding) => finding.code),
      }))
      .toArray(),
    verdict,
    ...extra,
  });
  if (harness.conformance != null) {
    writeCompleted(join(iterationDir, CONFORMANCE_FILE), harness.conformance);
  }
}

/** A failure row first, then every completed row, so the reason the census stopped leads and the
 *  settled controls keep their receipts, coverage and host rows behind it. */
function persistFailure(
  context: CensusContext,
  failure: CampaignFeedback[],
  { probe, rows }: Completed,
  verdict: CensusEvidence["verdict"],
  extra: Pick<CensusEvidence, "verifierNonResultEvidence"> = {},
): CampaignFeedback[] {
  const feedback = [...failure, ...rows];
  persistCensus(context, feedback, probe, verdict, extra);
  return feedback;
}

/**
 * One settlement for a census the host environment refused: the recorded evidence behind a digest
 * pointer, and a single environment-owned refusal row.
 *
 * Nothing else is written. An F2 outage leaves no solvability.json, and `assessReadiness` raises
 * `no-solvability-witness` whenever that evidence is missing, so the absence of the file keeps
 * adoption closed. Helpfully writing a partial record here would write the one thing that lets a
 * candidate through on an outage.
 */
function settleEnvironment(
  context: CensusContext,
  payload: EnvironmentEvidence,
  claim: string,
  evidence: string,
  completed: Completed = NOTHING_COMPLETED,
): CampaignFeedback[] {
  const file = "environment-non-result.json";
  writeCompleted(join(context.iterationDir, file), payload);
  return persistFailure(
    context,
    [
      {
        owner: "environment",
        severity: "blocking",
        claim,
        evidence,
        // The claim is composed from public identities alone (a declared tool, a control id, a vendor
        // package), so it crosses as the finding's detail under the code naming what the host could not do.
        findings: controllerValidatedFindings([
          {
            code: "kind" in payload ? payload.kind : toolNonResultCode(payload),
            path: "environment",
            detail: claim,
          },
        ]),
      },
    ],
    completed,
    { kind: "non-result", evidence: tracePointer(context.iterationDir, file) },
  );
}

/** The @ana package specifiers a generated directory's own sources quote, node_modules excluded.
 *  Only the packages a bundle imports need to resolve, so a bundle importing none is held to no
 *  resolution requirement. */
function importedAnaPackages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const names = new Set<string>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    if (file.includes(`${sep}node_modules${sep}`)) continue;
    for (const match of readFileSync(file, "utf8").matchAll(/["'](@ana\/[a-z0-9-]+)/g)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** A workspace file shadows a vendored package. The remedy is entirely public — delete the file,
 *  drop the tsconfig `paths` entry — so this is a blocking finding the next authoring turn can act
 *  on, not an environment refusal that would end the session. */
function settleShadow(context: CensusContext, dir: string, name: string, shadow: string): CampaignFeedback[] {
  return persistFailure(
    context,
    [
      {
        owner: dir === "agent" ? GENERATED_TOOLS_FILE : EVALUATOR_FILE,
        severity: "blocking",
        claim: `${dir}: ${name} resolves to the workspace file ${shadow} instead of the vendored package`,
        evidence: "census gate: vendor resolution evidence (census.json)",
        findings: controllerValidatedFindings([
          {
            code: "vendor-shadowed",
            path: dir,
            detail: `${name} must resolve to node_modules/${name}; remove ${shadow} and any tsconfig "paths" or package entry that points ${name} at the workspace`,
          },
        ]),
      },
    ],
    NOTHING_COMPLETED,
    "fail",
  );
}

/**
 * Generated modules must load the controller's own vendor bytes, and that fails from two opposite
 * directions: workspace @ana replacements shadowing the vendor links, and a snapshot under a
 * symlink whose parent lookup never reaches them. Neither is visible from the file tree, so the
 * check asks Bun instead: resolve every @ana package the generated sources import, from the
 * directory that imports it, and compare the entry bytes with the host's own resolution.
 *
 * Where the resolution points decides the owner, and the two cost very different things. Inside
 * the candidate workspace it is the Builder's own stand-in — a tsconfig `paths` entry aimed at a
 * scratch shim — and the public remedy makes it a blocking finding the session repairs in one
 * command. Anywhere else, or a resolution that throws, is the environment, which ends the campaign
 * outright. That asymmetry is why the workspace case is separated out.
 */
function settleModuleResolution(context: CensusContext): CampaignFeedback[] | null {
  const { slugDir } = context;
  // Only the @ana packages the controller itself declares are checked here, because only those are
  // the environment's property. An invented or misspelt @ana specifier in generated code is an
  // authoring defect, and the module-load probe already raises it as a generated-module-load
  // finding the author can act on.
  const host =
    /* SAFETY: the controller's own package.json; only optional `dependencies` is read and its keys are filtered by prefix. */ capturedJsonParse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
  const hostDeclared = new Set(
    Object.keys(host.dependencies ?? {}).filter((name) => name.startsWith("@ana/")),
  );
  for (const dir of ["agent", "correctness-model"]) {
    // Each probe is anchored where the importing code lives rather than at the bundle root: a
    // root-anchored probe resolves past a package shadowed inside one directory and reports the
    // shadow as healthy.
    const anchor = join(slugDir, dir);
    for (const name of importedAnaPackages(join(slugDir, dir)).filter((pkg) => hostDeclared.has(pkg))) {
      let fault: string | null = null;
      try {
        const bundleEntry = Bun.resolveSync(name, anchor);
        if (
          readFileSync(bundleEntry, "utf8") !== readFileSync(Bun.resolveSync(name, import.meta.dir), "utf8")
        ) {
          const inside = relative(slugDir, bundleEntry);
          if (!inside.startsWith("..")) {
            return settleShadow(context, dir, name, inside.split(sep).join("/"));
          }
          fault = `resolves to ${bundleEntry}, which differs from the controller's vendor bytes`;
        }
      } catch (error) {
        fault = errorMessage(error);
      }
      if (fault === null) continue;
      return settleEnvironment(
        context,
        { kind: "vendor-resolution-broken", package: name, detail: fault },
        `control census cannot run: ${name} does not resolve from the bundle snapshot to the controller's vendor bytes`,
        "census gate: vendor resolution evidence (census.json)",
      );
    }
  }
  return null;
}

/**
 * What the author may read about a failed tool run. Two kinds of fact cross: the identities it
 * wrote itself, and what the host measured around the process — how it ended, how long it ran, how
 * many bytes it wrote, and for a `sandbox` or `protocol` outcome the host's own reason, which is
 * host-authored text about the request or the byte counts rather than anything the tool printed. Tool stdout and stderr stay
 * protected as verifier output under rule 4.
 *
 * The cell facts in `advice` are what the Builder cannot observe from its own session, where the
 * same command works: a tool that needs HOME fails here and nowhere the author can see, and a
 * session can spend rounds on that difference. Naming the cell's cwd, TMPDIR, HOME, network and
 * environment variables explains it without saying anything about the artifact under test. A
 * solvability subject is a task id rather than a control id, so only the discrimination phase
 * names its subject here.
 */
export function toolRunFailureDetail(evidence: VerifierExecutionEvidence): string {
  const subject = evidence.phase === "discrimination" ? ` on control "${evidence.subjectId}"` : "";
  const reason =
    (evidence.outcome === "sandbox" || evidence.outcome === "protocol") &&
    evidence.nonResultReason !== undefined
      ? `: ${evidence.nonResultReason}`
      : "";
  const started = evidence.timedOut || evidence.exitCode !== null || evidence.signal !== null;
  const halted = evidence.signal === null ? "never started" : `signal ${evidence.signal}`;
  const ended = evidence.timedOut
    ? "timed out"
    : evidence.exitCode === null
      ? halted
      : `exit ${evidence.exitCode}`;
  const advice = started
    ? ` Cell facts: cwd, TMPDIR and HOME are one private scratch directory holding only the files this evaluate wrote from artifact or public-task bytes, no network, sandbox "${evidence.sandbox}", environment variables received: PATH, TMPDIR, HOME. A tool that works in the authoring session and not here is missing one of those facts or an input file. Give the run every file it reads, a timeoutMs it can finish in, and read its exit code and stderr in the evaluator instead of letting it fail the case.`
    : " The host refused the request before starting a process; change the request the evaluator makes.";
  return `Tool "${evidence.toolId}" (${evidence.toolSource}, run as \`${[evidence.command, ...evidence.args].join(" ")}\`) reached no completed run for check "${evidence.checkId}"${subject} (attempt ${evidence.attempt}): outcome "${evidence.outcome}"${reason}. Process facts: ${ended}, ${evidence.durationMs} ms, ${evidence.stdoutBytes} stdout bytes, ${evidence.stderrBytes} stderr bytes.${advice}`;
}

/** Which census met the failure: host structure rather than anything the verifier printed, so it
 *  crosses to the author freely. It carries nothing else — the outcome kind, tool and subject
 *  travel on the evidence object, and each caller composes what it needs. */
const censusName = (error: VerifierExecutionNonResult): string =>
  error.evidence.phase === "solvability" ? "solvability census" : "control census";

/**
 * A tool run that started and then failed is the Builder's defect, not the environment's, and the
 * distinction decides whether a campaign continues. A declared `node checker.js` in a cell where
 * `checker.js` was never materialised exits 1 with MODULE_NOT_FOUND and no verdict; settling that
 * as `environment` ends the campaign with no candidate and no battery.
 *
 * The host records the outcome kind itself, so the gate uses it for repair ownership rather than
 * guessing: `timeout` and `crash` mean a tool the evaluator chose ran over the artifact's inputs
 * and failed, which the author can act on, while `sandbox` and `verifierUnavailable` mean the OS
 * isolation or the installed tool failed around execution and belong to the environment, as
 * `verifier-nonresult.ts` classifies them. A generated tool cannot choose its own host outcome,
 * which is what makes the classification worth trusting.
 */
function settleNonResult(
  context: CensusContext,
  error: VerifierExecutionNonResult,
  completed: Completed,
): CampaignFeedback[] {
  // One file name, shared with the durable per-tool counter reading this record back in
  // `tool-non-result.ts`, so writer and reader cannot drift apart.
  writeCompleted(join(context.iterationDir, TOOL_NON_RESULT_FILE), error.evidence);
  const feedback: CampaignFeedback[] = [
    {
      owner: EVALUATOR_FILE,
      severity: "blocking",
      // The claim is part of the stall identity, which is why it names the tool and deliberately
      // does not name the outcome kind. A different tool failing is a moved diagnosis and should
      // reset the count; the same tool alternating between a crash and a timeout is not, and
      // naming the kind here would make each such round look like a fresh diagnosis and let the
      // loop run past the stall ceiling. The Finding code below carries the failure kind.
      claim: `${censusName(error)}: runs of tool "${error.evidence.toolId}" reached no completed run`,
      evidence: "census gate: protected verifier non-result evidence (census.json)",
      findings: controllerValidatedFindings([
        {
          code: toolNonResultCode(error.evidence),
          path: EVALUATOR_FILE,
          detail: toolRunFailureDetail(error.evidence),
        },
      ]),
    },
  ];
  return persistFailure(context, feedback, completed, "fail", {
    verifierNonResultEvidence: tracePointer(context.iterationDir, TOOL_NON_RESULT_FILE),
  });
}

function settleToolUnavailable(
  context: CensusContext,
  error: VerifierExecutionNonResult,
  completed: Completed,
): CampaignFeedback[] {
  return settleEnvironment(
    context,
    error.evidence,
    `${censusName(error)} cannot run: the host could not run tool "${error.evidence.toolId}" (${error.evidence.outcome}), twice`,
    "census gate: protected verifier non-result evidence (census.json)",
    completed,
  );
}

/** A census the wall cut settles like a tool run that timed out: the checks and the reference
 *  solve are the candidate's own bytes, so the time they take is the Builder's to cut. Treating it
 *  as an environment non-result instead ends the session at its first submit over a candidate with
 *  nothing else wrong with it. Rule 9 puts it the same way — a timeout stays diagnosable unless
 *  the evidence proves the environment owns it. */
function settleCensusWall(
  context: CensusContext,
  error: CensusWallExceeded,
  completed: Completed,
): CampaignFeedback[] {
  const { harness } = context;
  const minutes = error.wallMs / 60_000;
  const size = `${harness.corpus.accept.length} accept and ${harness.corpus.reject.length} reject examples over ${harness.battery.tasks.length} tasks`;
  const feedback: CampaignFeedback[] = [
    {
      owner: EVALUATOR_FILE,
      severity: "blocking",
      claim: `census wall: the ${error.stage} stage was still running when the census stopped`,
      evidence: "census gate: census wall",
      findings: controllerValidatedFindings([
        {
          code: "census-wall-exceeded",
          path: error.stage === "controls" ? EVALUATOR_FILE : REFERENCE_SOLVE_ENTRY,
          detail: `The census stopped at its ${minutes}-minute wall during the ${error.stage} stage (${size}). Time one example's checks and one reference task, then cut the repeated tool work until the whole run fits with room to spare on a busy host.`,
        },
      ]),
    },
  ];
  return persistFailure(context, feedback, completed, "fail");
}

/**
 * Runs the census on a fingerprinted candidate: module resolution first, then the controls through
 * the host verifier and, beside them, the F2 reference solve when the scope includes it. Findings
 * go back through the ordinary feedback channel and census.json is written beside the iteration
 * evidence, so what the author is told and what the run records come from one place.
 *
 * Whichever stage fails, the work the other started drains within the wall's grace before a retry
 * or a settlement: the next attempt runs its own tools, and an abandoned stage still holding a
 * cell would have it running alongside. Execution records establish what ran, not that the tool
 * was independent of the author.
 */
export function makeCensusGate(
  options: CensusGateOptions,
): (
  harness: BuiltHarness,
  iterationDir: string,
  slugDir: string,
  stages?: SolvabilityStageCache,
  scope?: GateScope,
) => Promise<CampaignFeedback[]> {
  const override = censusWallOverrideMs(options.censusWallMs);
  return async (harness, iterationDir, slugDir, stages, scope = { referenceSolve: true }) => {
    const wallMs = override ?? harnessSettings(slugDir).censusWallMs;
    const context: CensusContext = { options, harness, iterationDir, slugDir, stages, scope };
    for (let attempt = 0; ; attempt += 1) {
      const wall = censusWall(wallMs);
      const outcome = await runCensus(context, wall).catch(
        (cause: unknown): CensusFailure => ({ failure: cause, completed: NOTHING_COMPLETED }),
      );
      wall.clear();
      if (!("failure" in outcome)) return outcome.feedback;
      await wall.settle();
      const settled = settleFailure(context, outcome, attempt === 0 ? "first" : "retried");
      if (settled !== "retry") return settled;
      // One fresh execution, and only one: a host refusal is often transient, but retrying
      // indefinitely spends the session on an environment that is not coming back.
      await toolRetryDelay(options.toolRetryWaitMs);
    }
  };
}

function settleFailure(
  context: CensusContext,
  { failure, completed }: CensusFailure,
  attempt: "first" | "retried",
): CampaignFeedback[] | "retry" {
  if (failure instanceof VerifierOperationalStop) throw failure;
  if (failure instanceof CensusWallExceeded) return settleCensusWall(context, failure, completed);
  context.options.verifierLifetime?.assertUsable();
  if (!(failure instanceof VerifierExecutionNonResult)) throw failure;
  if (!environmentOwnedToolNonResult(failure.evidence.outcome)) {
    return settleNonResult(context, failure, completed);
  }
  return attempt === "first" ? "retry" : settleToolUnavailable(context, failure, completed);
}

/** The control census's rows: every finding it returned refuses the candidate, and the timed-out
 *  controls ride beside them as one advisory row that refuses nothing. */
function controlsRows(findings: ContractFinding[], advisory: ContractFinding[] = []): CampaignFeedback[] {
  const row = (
    severity: CampaignFeedback["severity"],
    rows: ContractFinding[],
    claim: string,
  ): CampaignFeedback[] =>
    rows.length === 0
      ? []
      : [
          {
            owner: EVALUATOR_FILE,
            severity,
            claim,
            evidence: "census gate: executed discrimination evidence (census.json)",
            findings: controllerValidatedFindings(rows),
          },
        ];
  return [
    ...row(
      "blocking",
      findings,
      `control census against the installed tools returned ${findings.length} finding${findings.length === 1 ? "" : "s"}`,
    ),
    ...row("advisory", advisory, "control census examples whose tool run timed out, which refuses nothing"),
  ];
}

/** The drift the census observed against the identity captured at submit. The installed tools
 *  moved under the gate, which says nothing about the candidate's bytes, so the row is the
 *  environment's: a preview is not remembered, and a submit that meets it ends the session as
 *  environment-blocked (`gateTerminalClause`) rather than striking the candidate. */
function driftRows(harness: BuiltHarness, probe: ProbeControlsResult): CampaignFeedback[] {
  const captured = harness.conformance?.verifierEnvironmentHash;
  // A census stopped before its controls ran — an evaluator that would not load, say — establishes
  // no identity at all, so an absent hash on either side is silence rather than disagreement.
  if (
    captured === undefined ||
    probe.verifierEnvironmentHash === undefined ||
    probe.verifierEnvironmentHash === captured
  ) {
    return [];
  }
  return [
    {
      owner: "environment",
      severity: "blocking",
      claim: "the control census ran under a verifier identity other than the one captured at submit",
      evidence: "census gate: executed discrimination evidence (census.json)",
      findings: controllerValidatedFindings([
        {
          code: "verifier-condition-drift",
          path: ".toolchain",
          detail:
            "The installed verifier identity moved between the capture at submit and the control census, so the host's tool condition changed under the gate. A check of the same bytes runs the census again; a submit that ends on this row ends the session as environment-blocked.",
        },
      ]),
    },
  ];
}

async function runCensus(
  context: CensusContext,
  wall: ReturnType<typeof censusWall>,
): Promise<{ feedback: CampaignFeedback[] } | CensusFailure> {
  const { options, harness, iterationDir, slugDir, stages, scope } = context;
  const unresolvable = settleModuleResolution(context);
  if (unresolvable !== null) return { feedback: unresolvable };
  const solvability = scope.referenceSolve ? options.solvability : undefined;
  if (solvability !== undefined) options.verifierLifetime?.assertUsable();
  const [controls, reference] = await Promise.allSettled([
    wall.under(
      "controls",
      options.probeControls(slugDir, harness.brief, harness.corpus, harness.battery.tasks, wall.stopped),
    ),
    solvability === undefined
      ? Promise.resolve([])
      : wall.under("reference solve", solvability(harness, iterationDir, slugDir, wall.stopped, stages)),
  ]);
  const probe = controls.status === "fulfilled" ? controls.value : undefined;
  const findings = probe?.findings ?? [];
  // A check that called its tool and met a sandbox or unreadable-tool refusal twice is the
  // environment's non-result under rule 15, not a correctness-model finding: there is nothing in
  // the candidate's bytes to repair. It is pulled out of `findings` here and settled below.
  const refusal = findings.find((finding) => finding.code === TOOL_REFUSED_CODE);
  const referenceRows = reference.status === "fulfilled" ? reference.value : [];
  const completed: Completed = {
    ...keyIfDefined("probe", probe),
    rows: [
      ...controlsRows(
        findings.filter((finding) => finding.code !== TOOL_REFUSED_CODE),
        probe?.advisory,
      ),
      ...(probe === undefined ? [] : driftRows(harness, probe)),
      ...referenceRows,
    ],
  };
  // The controls are checked first, so the reported failure is the earlier stage's and the
  // reference solve's completed rows ride beside it rather than replacing it.
  if (controls.status === "rejected") return { failure: controls.reason, completed };
  if (reference.status === "rejected") return { failure: reference.reason, completed };
  if (refusal !== undefined) {
    return {
      feedback: settleEnvironment(
        context,
        { kind: TOOL_REFUSED_CODE, detail: refusal.detail },
        `control census cannot run: ${refusal.detail}`,
        "census gate: protected verifier non-result evidence (census.json)",
        completed,
      ),
    };
  }
  const feedback = completed.rows;
  // A row's presence alone does not fail the census: an advisory finding is a reading, not a
  // refusal, and the input-insensitivity observation and accept-control independence check both report
  // things only the Builder can weigh. So the verdict counts blocking rows and the advisory ones
  // stay in the iteration record for `correctness_check`; `solvability-gate.ts` groups the same way.
  const verdict = feedback.some((row) => row.severity === "blocking") ? "fail" : "pass";
  persistCensus(context, feedback, probe, verdict, {
    findings,
    advisory: feedback.filter((row) => row.severity === "advisory"),
  });
  options.verifierLifetime?.assertUsable();
  return { feedback };
}
