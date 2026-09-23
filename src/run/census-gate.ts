/**
 * The census gate runs over a candidate that has already been fingerprinted, and it is the last
 * thing standing between a build and paid measurement. It counts the tasks against the size the
 * round asked for, executes every control through the host verifier to see whether the declared
 * checks discriminate a correct artifact from a broken one, and runs the F2 reference solve of
 * every authored task.
 *
 * The controls and F2 run beside each other rather than one after the other. Running them in
 * sequence meant a candidate that was wrong in both places learned about the census first, spent a
 * turn repairing it, resubmitted, and only then met F2's rows; running them together means one
 * call reports every blocking row of one tree. Results are written beside the candidate as
 * census.json and returned to the same authoring session as feedback, because a refusal keeps the
 * session and the session is what has to act on it.
 */
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { existsSync, readFileSync, readdirSync } from "../meta/filesystem.ts";
import { join, relative, sep } from "../meta/path.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { BuiltHarness, CampaignFeedback, FeedbackOwner } from "../author/campaign-types.ts";
import { TOOL_NON_RESULT_FILE, toolNonResultCode } from "../author/tool-non-result.ts";
import { type TracePointer, tracePointer } from "../claim/case-record.ts";
import { writeCompleted } from "../meta/completed-json.ts";
import { type ContractFinding, controllerValidatedFindings } from "../truth/brief.ts";
import { TOOL_REFUSED_CODE } from "../truth/grounding-coverage.ts";
import type { ProbeControls, ProbeControlsResult } from "../truth/probes.ts";
import type { PublicControlReceipt } from "../truth/battery-record.ts";
import { REFERENCE_SOLVE_ENTRY } from "../truth/evaluator-process-bundle.ts";
import type { CheckCost, ToolCheckCoverage } from "../truth/grounding-coverage.ts";
import {
  VerifierExecutionNonResult,
  environmentOwnedToolNonResult,
  toolRetryDelay,
} from "../truth/verifier-nonresult.ts";
import type { VerifierExecutionEvidence } from "../verify/verifier-port.ts";
import type { SolvabilityCensusGate } from "./solvability-gate.ts";
import { harnessSettings } from "../truth/harness-config.ts";
import type { SolvabilityStageCache } from "../truth/solvability-stages.ts";
import { VerifierOperationalStop, type VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";
import { CONFORMANCE_FILE } from "../claim/conformance-evidence.ts";

/** The control-census record written beside an iteration's candidate. */
export const CENSUS_FILE = "census.json";

interface CensusGateOptions {
  verifierLifetime?: VerifierLifetime;
  probeControls: ProbeControls;
  /** Required battery size; the census must cover the complete task set. */
  expectedTasks: number;
  /** F2 reference solve of every task, run beside the control census. The same slot also carries
   *  the representation census and the accept-control independence reading, which raise findings
   *  of their own against `brief` and `accept-controls`. Three decisions sit behind one option
   *  because all three need F2's witnesses, and the witnesses exist only while F2 is running. */
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
  /** Advisory rows returned beside the verdict. They do not fail the census, and `blocking` below
   *  keeps only blocking rows, so this field is the one place on disk that records an advisory
   *  screen having fired at all; the rows themselves are returned in-session and then gone. It is
   *  absent, rather than empty, when the gate exited before the screens ran, because a gate that
   *  never reached them says nothing about what they would have found. */
  advisory?: CampaignFeedback[];
  /** Public results of the live control check; hidden values and verifier detail stay private. A
   *  missing list stays missing rather than becoming zero controls, since the two readings differ:
   *  no controls ran and no controls exist are different candidates. */
  controlReceipts?: PublicControlReceipt[];
  /** Per tool-backed check: how often the host ran its tool and how many rejects it blocked. Both
   *  are public counts, and zero runs is the refusal recorded elsewhere rather than a check that
   *  chose not to call its tool. */
  toolCheckCoverage?: ToolCheckCoverage[];
  /** Each check's cost in dispatches, wall time and tool runs. The author reads it back through
   *  `correctness_check`, which is the only point at which a check's own price is visible while
   *  there is still session left to make it cheaper. */
  checkCost?: CheckCost[];
  /** Every blocking row behind a `fail`, by owner and finding codes. `findings` above holds only
   *  the executed control census, and the battery count, reject coverage and F2 rows blocked 44 of
   *  46 recorded census fails on this host while `findings` stayed empty — so without this field
   *  the record of a failed census gave no reason for the failure. */
  blocking: Array<{ owner: FeedbackOwner; claim: string; codes: string[] }>;
  verdict: "pass" | "fail" | { kind: "non-result"; evidence: TracePointer };
  /** The protected non-result file, bound by digest, when an authored tool run failed and the
   *  verdict is an ordinary `fail`. The environment path already binds its evidence through the
   *  verdict pointer; a `fail` carries no pointer, so without this field the non-result file would
   *  merely sit next to census.json with nothing tying the two together. */
  verifierNonResultEvidence?: TracePointer;
};

type EnvironmentEvidence =
  | VerifierExecutionEvidence
  | { kind: "vendor-resolution-broken"; package: string; detail: string }
  | { kind: typeof TOOL_REFUSED_CODE; detail: string };

/** One gate call: what it runs against, and the options the gate was made with. Every settlement
 *  below needs the same fields, so they travel as one value rather than as a parameter prefix
 *  repeated down the chain. */
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
 *  load cannot solve anything. The control census runs the evaluator and never the tools, so it
 *  still runs, and such a candidate gets its discrimination reading instead of nothing at all. */
export interface GateScope {
  referenceSolve: boolean;
}

type CensusStage = "controls" | "reference solve";

/** The longest a cut census waits for its started controls or reference tasks to finish. */
const CENSUS_SETTLE_GRACE_MS = 60_000;

/** What one census attempt finished before a stage failed. The controls and F2 run side by side,
 *  so one of them failing leaves the other's completed rows and receipts in hand; they stay beside
 *  the failure rather than being discarded with their failed sibling. */
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
 *  runs, so a malformed value throws before the session has spent anything on a candidate it will
 *  not be able to census. Returning null leaves the wall to the candidate's own
 *  `gate.census_minutes`, which is the ordinary case. */
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
 *  controls while they are still running and the reference solve otherwise, which is the best
 *  reading available from outside either stage.
 *
 *  Past the wall no stage admits further work, but work already started cannot be recalled, and
 *  that work holds tool cells. `settle` therefore waits a bounded grace for it, so a retry or a
 *  later submit does not run its own tools alongside an abandoned stage's. */
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
 *  rows behind the verdict.
 *
 *  Conformance is written beside it whatever the census verdict, and unconditionally rather than
 *  only on a pass, because the conformance probe ran before this call and does not depend on how
 *  the census ended. A census non-result must not erase evidence that was already complete, and
 *  the reader downstream cannot tell the difference: `assessReadiness` has no way to distinguish
 *  "the tools were never probed" from "the probe succeeded and its file was dropped", so it would
 *  report `conformance-unprobed` for both. Adoption then copies the same file into the retained
 *  product version, which is where `conformance-evidence.ts` reads it from. */
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
 *  settled controls still keep their receipts, coverage and host rows behind it. */
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
 * Nothing else is written, and that is the point. An F2 outage leaves no solvability.json, and
 * `assessReadiness` raises `no-solvability-witness` whenever that evidence is missing, so the
 * absence of the file is what keeps adoption closed. A settlement that helpfully wrote a partial
 * record here would be writing the one thing that lets a candidate through on an outage.
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
    [{ owner: "environment", severity: "blocking", claim, evidence }],
    completed,
    { kind: "non-result", evidence: tracePointer(context.iterationDir, file) },
  );
}

/** The @ana package specifiers a generated directory's own sources quote, node_modules excluded.
 *  Only the packages a bundle actually imports need to resolve, so a bundle that imports none has
 *  no resolution requirement and is not held to one. */
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
 *  on rather than an environment refusal that would end the session. */
function settleShadow(context: CensusContext, dir: string, name: string, shadow: string): CampaignFeedback[] {
  return persistFailure(
    context,
    [
      {
        owner: dir === "agent" ? "tools-spec" : "correctness-model",
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
 * Generated modules must load the controller's own vendor bytes, and two recorded failures shared
 * exactly that condition from opposite directions: run 52's workspace @ana replacements shadowed
 * the vendor links, and run w29's snapshot sat under a campaigns/ symlink whose parent lookup never
 * reached them. Neither was visible from the file tree, so the check asks Bun instead: resolve
 * every @ana package the generated sources import, from the directory that imports it, and compare
 * the entry bytes with the host's own resolution of the same name.
 *
 * Where the resolution points decides the owner, and the two owners cost very different things.
 * Inside the candidate workspace it is the Builder's own stand-in — run50-opus (2026-09-02) pointed
 * tsconfig `paths` at `scratch/shim` after its tests could not load the barrel — and since the
 * remedy is public it becomes a blocking finding the session can repair. Anywhere else, or a
 * resolution that throws, is the environment, which ends the campaign: run50 ended on that terminal
 * after one turn and 29 minutes of authoring, for a defect the Builder could have undone in one
 * command. That asymmetry is why the workspace case is separated out rather than folded into the
 * environment branch.
 */
function settleModuleResolution(context: CensusContext): CampaignFeedback[] | null {
  const { slugDir } = context;
  // Only the @ana packages the controller itself declares are checked here, because only those are
  // the environment's property. An invented or misspelt @ana specifier in generated code is an
  // authoring defect, and it already has a reporter: the module-load probe raises it as a
  // generated-module-load finding, which is the finding the author can act on.
  const host =
    /* SAFETY: the controller's own package.json; only optional `dependencies` is read and its keys are filtered by prefix. */ capturedJsonParse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
  const hostDeclared = new Set(
    Object.keys(host.dependencies ?? {}).filter((name) => name.startsWith("@ana/")),
  );
  for (const dir of ["agent", "correctness-model"]) {
    // Each probe is anchored where the importing code lives rather than at the bundle root,
    // because a root-anchored probe resolves past a package shadowed inside one directory and
    // would report the shadow as healthy.
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
 * many bytes it wrote, and for a `sandbox` outcome the host's own reason, which is host-authored
 * text about the request rather than anything the tool printed. Tool stdout and stderr stay
 * protected, because they are verifier output and rule 4 keeps that away from the author.
 *
 * The cell facts in `advice` are the part the Builder cannot observe from its own session, where
 * the same command works: sol-fix (2026-08-22) spent eight rounds on a tool that needed HOME, a
 * difference invisible from the authoring side. Naming the cell's cwd, TMPDIR, HOME, network and
 * environment variables gives the author the one thing that explains the discrepancy without
 * telling it anything about the artifact under test. A solvability subject is a task id rather
 * than a control id, so only the discrimination phase names its subject here.
 */
export function toolRunFailureDetail(evidence: VerifierExecutionEvidence): string {
  const subject = evidence.phase === "discrimination" ? ` on control "${evidence.subjectId}"` : "";
  const reason =
    evidence.outcome === "sandbox" && evidence.nonResultReason !== undefined
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

/** Which census met the failure. That is host structure rather than anything the verifier printed,
 *  so it crosses to the author freely. This helper deliberately carries nothing else: the outcome
 *  kind, tool and subject travel on the evidence object, and the callers decide separately how much
 *  of it to compose into a claim or a finding detail. */
const censusName = (error: VerifierExecutionNonResult): string =>
  error.evidence.phase === "solvability" ? "solvability census" : "control census";

/**
 * A tool run that started and then failed is the Builder's defect, not the environment's, and the
 * distinction decides whether a campaign continues. Run truss-w37-sol declared
 * `node checker.js contract` and the host ran it in a cell where `checker.js` was never
 * materialised: exit 1, MODULE_NOT_FOUND, no verdict. Run w37-opus met a pre-spawn refusal. Both
 * settled as `environment`, and both ended their campaign with no candidate and no battery — in
 * the opus case discarding two earlier iterations that had produced ordinary repairable findings.
 *
 * The host records the outcome kind itself, so the gate can use it for repair ownership rather
 * than guessing: `timeout` and `crash` mean a tool the evaluator chose ran over inputs the
 * artifact produced and then failed, which the author can act on, while `sandbox` and
 * `verifierUnavailable` mean the OS isolation or the installed tool failed before or around
 * execution and belong to the environment, as `verifier-nonresult.ts` classifies them. A generated
 * tool cannot choose its own host outcome, which is what makes the classification worth trusting.
 */
function settleNonResult(
  context: CensusContext,
  error: VerifierExecutionNonResult,
  completed: Completed,
): CampaignFeedback[] {
  // One file name, shared with the durable per-tool counter that reads this record back in
  // `tool-non-result.ts`, so the writer and its reader cannot drift apart.
  writeCompleted(join(context.iterationDir, TOOL_NON_RESULT_FILE), error.evidence);
  const feedback: CampaignFeedback[] = [
    {
      owner: "correctness-model",
      severity: "blocking",
      // The claim is part of the stall identity, which is why it names the tool and deliberately
      // does not name the outcome kind. A different tool failing is a moved diagnosis and should
      // reset the count; the same tool failing as a crash one round and a timeout the next is not,
      // and an Opus run on 2026-08-22 alternated those two kinds for eleven rounds. Naming the kind
      // here would have made each round look like a fresh diagnosis and let that loop run past the
      // stall ceiling. The Finding code below carries the failure kind, which is a different job.
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

/** A census the wall cut settles like a tool run that timed out, and for the same reason: the
 *  checks and the reference solve are the candidate's own bytes, so the time they take is the
 *  Builder's to cut. Treating it as an environment non-result instead ended truss run 7d433e's
 *  session at its first submit, after two previews had met the same wall with 22 controls and
 *  nothing else wrong with the candidate. Rule 9 puts it the same way: a timeout stays diagnosable
 *  unless the evidence proves the environment owns it. */
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
      owner: "correctness-model",
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
 * the host verifier and, beside them, the F2 reference solve when the scope includes it. The
 * findings go back through the ordinary feedback channel and census.json is written beside the
 * iteration evidence, so what the author is told and what the run records come from one place.
 *
 * Whichever stage fails, the work the other one started drains within the wall's grace before a
 * retry or a settlement. That wait is not tidiness: the next attempt runs its own tools, and an
 * abandoned stage still holding a cell would have it running alongside. Note also that execution
 * records establish what ran and not that the tool was independent of the author — rule 9 keeps
 * those separate, and nothing here upgrades one into the other.
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
      // One fresh execution, and only one: a host refusal is often transient, but repeating it
      // indefinitely would spend the session on an environment that is not coming back.
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

/** The control census's one row: every finding it returned refuses the candidate. */
function controlsRows(findings: ContractFinding[]): CampaignFeedback[] {
  if (findings.length === 0) return [];
  return [
    {
      owner: "correctness-model",
      severity: "blocking",
      claim: `control census against the installed tools returned ${findings.length} finding(s)`,
      evidence: "census gate: executed discrimination evidence (census.json)",
      findings: controllerValidatedFindings(findings),
    },
  ];
}

/** The control findings, with the drift the census observed against the identity captured at submit. */
function controlFindings(harness: BuiltHarness, probe: ProbeControlsResult): ContractFinding[] {
  const captured = harness.conformance?.verifierEnvironmentHash;
  // A census stopped before its controls ran — run 805bcc's evaluator would not load — establishes
  // no identity at all, so an absent hash on either side is silence rather than disagreement.
  if (
    captured === undefined ||
    probe.verifierEnvironmentHash === undefined ||
    probe.verifierEnvironmentHash === captured
  ) {
    return probe.findings;
  }
  return [
    ...probe.findings,
    ...controllerValidatedFindings([
      {
        code: "verifier-condition-drift",
        path: ".toolchain",
        detail:
          "The control census did not establish the installed verifier identity captured at submit; submit again under the current tool condition.",
      },
    ]),
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
  const findings = probe === undefined ? [] : controlFindings(harness, probe);
  // A check that called its tool and met a sandbox or unreadable-tool refusal twice is the
  // environment's non-result under rule 15, not a correctness-model finding: there is nothing in
  // the candidate's bytes for the Builder to repair, so routing it as one would spend an authoring
  // turn on a defect that is not there. It is pulled out of `findings` here and settled below.
  const refusal = findings.find((finding) => finding.code === TOOL_REFUSED_CODE);
  const referenceRows = reference.status === "fulfilled" ? reference.value : [];
  const completed: Completed = {
    ...keyIfDefined("probe", probe),
    rows: [...controlsRows(findings.filter((finding) => finding !== refusal)), ...referenceRows],
  };
  // The controls are checked first, so the failure that gets reported is the earlier stage's and
  // the reference solve's completed rows ride beside it rather than replacing it.
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
  // A row's presence alone does not fail the census, because an advisory finding is a reading and
  // not a refusal: the representation census and the accept-control independence check both report
  // things only the Builder can weigh. So the verdict counts blocking rows, the advisory ones stay
  // in the iteration record for `correctness_check` to count back, and the same treatment applies
  // wherever an advisory row is raised (`solvability-gate.ts` groups its findings the same way).
  const verdict = feedback.some((row) => row.severity === "blocking") ? "fail" : "pass";
  persistCensus(context, feedback, probe, verdict, {
    findings,
    advisory: feedback.filter((row) => row.severity === "advisory"),
  });
  options.verifierLifetime?.assertUsable();
  return { feedback };
}
