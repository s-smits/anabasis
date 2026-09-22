/**
 * Check the fingerprinted candidate's census: required task count, control coverage and
 * discrimination, followed by F2 reference solvability. This gate was extracted from
 * harness-build.ts to keep the checks together while that module handles build orchestration.
 * Results are recorded for the candidate and returned as authoring feedback.
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
import { ADVISORY_DISCRIMINATION_CODES } from "../claim/discrimination-claimability.ts";
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
  /** F2: full-task reference-solve census, run beside the control census. It also
   *  carries the representation census, which reads F2's witnesses and returns `brief` findings
   *  of its own — two decisions behind one slot, because only there are the witnesses in hand. */
  solvability?: SolvabilityCensusGate;
  /** Wait before the one fresh execution an environment-owned refusal earns; tests pass 0. */
  toolRetryWaitMs?: number;
  /** The census wall in milliseconds; unset reads ANA_CENSUS_WALL_MS, then the candidate's agent/config.yaml. */
  censusWallMs?: number;
}

type CensusEvidence = {
  executionEvidence?: VerifierExecutionEvidence[];
  acceptControls: number;
  rejectControls: number;
  tasks: number;
  expectedTasks: number;
  findings: ContractFinding[];
  /** Advisory rows the gate returned beside its verdict: the unpublished-name screen and the
   *  representation census. They reach the Builder in-session and select no owner, so this field
   *  is the only durable trace that a screen fired. Absent when the gate exited before the screen
   *  ran. */
  advisory?: CampaignFeedback[];
  /** Public results from the live control check. Hidden values and verifier detail stay private.
   * A missing list stays missing instead of becoming zero controls. */
  controlReceipts?: PublicControlReceipt[];
  /** Per declared tool-backed check: how often the host ran that tool for it, and how many rejects
   *  the check blocked. Both are public counts; zero runs is the refusal above. */
  toolCheckCoverage?: ToolCheckCoverage[];
  /** What each check cost this census in dispatches, wall time and attested tool runs. The author
   *  reads it back through `correctness_check`, which is the only place a check's own price is
   *  visible while there is still session left to change it. */
  checkCost?: CheckCost[];
  /** Every blocking row behind a `fail`, by owner and public finding codes. `findings` above holds
   *  only the executed control census; the battery count, reject coverage and F2 rows blocked 44
   *  of 46 recorded census fails on this host while `findings` stayed empty, so the fail said nothing. */
  blocking: Array<{ owner: FeedbackOwner; claim: string; codes: string[] }>;
  verdict: "pass" | "fail" | { kind: "non-result"; evidence: TracePointer };
  /** The protected non-result file, bound by digest, when a tool run the author chose failed and
   *  the verdict is an ordinary `fail`. The environment path binds the same file through the
   *  verdict pointer; without this a candidate failure would leave it merely adjacent on disk. */
  verifierNonResultEvidence?: TracePointer;
};

type EnvironmentEvidence =
  | VerifierExecutionEvidence
  | { kind: "vendor-resolution-broken"; package: string; detail: string }
  | { kind: typeof TOOL_REFUSED_CODE; detail: string };

/** One gate call: what it runs against, and the options the gate was made with. Every settlement
 *  below needs the same three of these, so they travel together rather than as a parameter prefix
 *  repeated down the chain. */
type CensusContext = {
  options: CensusGateOptions;
  harness: BuiltHarness;
  iterationDir: string;
  slugDir: string;
  stages: SolvabilityStageCache | undefined;
  scope: GateScope;
};

/** What one gate call covers. A candidate whose generated tools did not load or conform still
 *  gets its control census, which runs the evaluator and never the tools; F2 needs the tools. */
export interface GateScope {
  referenceSolve: boolean;
}

type CensusStage = "controls" | "reference solve";

/** The longest a cut census waits for its started controls or reference tasks to finish. */
const CENSUS_SETTLE_GRACE_MS = 60_000;

/** What one census attempt finished before a stage failed. Its public rows and control receipts
 *  stay beside the failure instead of being discarded with the failed sibling. */
interface Completed {
  probe?: ProbeControlsResult;
  rows: CampaignFeedback[];
}

const NOTHING_COMPLETED: Completed = { rows: [] };

interface CensusFailure {
  failure: unknown;
  completed: Completed;
}

/** The operator's override, resolved once when the gate is made so a malformed value refuses before
 *  any session spends; null leaves the wall to the candidate's `gate.census_minutes`. */
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
 *  F2 run side by side, so the wall names the controls while they are still running and the
 *  reference solve otherwise. At the wall no stage admits a further control or reference task and
 *  none writes evidence; `settle` then waits a bounded grace for the started ones, so the next
 *  submit does not overlap their tool cells. */
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
 *  rows behind the verdict. Conformance is persisted beside it (gap closed 2026-07-26: readiness
 *  could only ever read conformance-unprobed); adoption carries it into the domain tree.
 *  Conformance is independent of the host call, so a later census non-result must not erase its
 *  completed evidence. */
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

/** A failure row first, then every completed row; the settled controls keep their receipts,
 *  coverage and host rows. */
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
 * pointer, and one environment-owned refusal. Nothing else is written, so an F2 outage leaves no
 * solvability.json — which is what keeps adoption closed, readiness requiring that file to exist.
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
 *  Only these need to resolve: a bundle that imports nothing has no resolution requirement. */
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

/**
 * Generated modules must load the controller's own vendor bytes. Two recorded failures share that
 * one condition: run 52's workspace @ana replacements shadowed the vendor links (seven repairs
 * attributed to the Builder), and run w29's snapshot sat under a campaigns/ symlink whose parent
 * lookup never reached them (four repairs). Ask Bun to resolve the packages directly:
 * resolve every @ana package the generated sources import, from the directory that imports it,
 * and compare entry bytes with the host's own resolution.
 *
 * Where resolution points determines the owner. Inside the candidate workspace it is the Builder's
 * own stand-in — run50-opus (2026-09-02) pointed tsconfig `paths` at `scratch/shim` after its
 * tests could not load the barrel — and the remedy is public, so it is a blocking Builder finding
 * that the next authoring turn can act on. Anywhere else, or a resolution that throws, is the
 * environment: the campaign ended after one turn on that terminal in run50, with 29 minutes of
 * authoring behind it, for a defect the Builder could have undone in one command.
 */
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

function settleModuleResolution(context: CensusContext): CampaignFeedback[] | null {
  const { slugDir } = context;
  // Anchor each Bun probe where the importing code lives so a root-anchored probe cannot miss a
  // local package shadow.
  // The @ana packages the controller itself declares. Only these are environment property: an
  // invented or misspelt @ana specifier in generated code is an authoring defect and stays with
  // the generated-module-load finding its own probe raises.
  const host =
    /* SAFETY: the controller's own package.json; only optional `dependencies` is read and its keys are filtered by prefix. */ capturedJsonParse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
  const hostDeclared = new Set(
    Object.keys(host.dependencies ?? {}).filter((name) => name.startsWith("@ana/")),
  );
  for (const dir of ["agent", "correctness-model"]) {
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
 * A tool run that started and then failed is the Builder's defect, not the environment's.
 *
 * Run truss-w37-sol declared `node checker.js contract` and the host ran it in a cell where
 * `checker.js` was never materialised: exit 1, MODULE_NOT_FOUND, no verdict. Run esp32-w37-opus met
 * a pre-spawn refusal. Both settled as `environment` and both ended their campaign with no
 * candidate and no battery — in the opus case discarding two earlier iterations that had produced
 * ordinary repairable findings.
 *
 * The host now records every outcome kind itself, so the gate uses it for repair
 * ownership: `timeout` and `crash` are the run of a tool the evaluator chose over inputs the
 * artifact produced, which the author can act on; `sandbox` and `verifierUnavailable` are the OS
 * isolation or installed tool failing before or around execution, attributed to the environment
 * by verifier-nonresult.ts. Generated tools cannot choose their own host outcome classification.
 */

/** What the author may read about it: the identities it wrote itself and the facts the host
 *  measured around the process — how it ended, how long it ran, how many bytes it wrote, and a
 *  `sandbox` reason, which is host-authored text about the request (a file outside the cell, a
 *  changed tool digest, an unavailable wall). Tool stdout and stderr stay protected with the stderr
 *  tail. The cell facts are what the Builder cannot observe from its own session, where the same
 *  command works (sol-fix 2026-08-22 ran eight rounds on a tool that needed HOME). A solvability
 *  subject is a task id, so only a control names one. */
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

/** Which census met the failure. Host structure, so it crosses to the author; the kind, tool and
 *  subject stay in the evidence. */
const censusName = (error: VerifierExecutionNonResult): string =>
  error.evidence.phase === "solvability" ? "solvability census" : "control census";

/** A tool run that reached no completed run, wherever under this gate it happened. Which census
 *  met it is host structure and crosses; the kind, tool and subject stay in the evidence. */
function settleNonResult(
  context: CensusContext,
  error: VerifierExecutionNonResult,
  completed: Completed,
): CampaignFeedback[] {
  // One name, shared with the durable per-tool counter that reads this record back
  // (tool-non-result.ts): the writer and its reader cannot drift apart.
  writeCompleted(join(context.iterationDir, TOOL_NON_RESULT_FILE), error.evidence);
  const feedback: CampaignFeedback[] = [
    {
      owner: "correctness-model",
      severity: "blocking",
      // The tool is in the claim on purpose and the outcome kind is not: the claim is part of the
      // stall identity. A different tool is a moved diagnosis; the same tool failing as crash one
      // round and timeout the next is not (esp32-opus 2026-08-22 alternated two kinds for eleven
      // rounds), and naming the kind here would have let that loop run past the stall ceiling. The
      // Finding code below groups the failure kind; it is not the stall identity.
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

/** A census the wall cut settles like a tool run that timed out: the candidate's checks and
 *  reference solve are its own bytes, so the time they take is the Builder's to cut. As an
 *  environment non-result it ended truss run 7d433e's session at its first submit, after two
 *  previews had met the same wall with 22 controls and nothing else wrong. A timeout stays
 *  diagnosable unless evidence proves the environment owns it (rule 9). */
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
 * Run the census on a fingerprinted candidate. Check module resolution, then execute the controls
 * through the host verifier and, beside them, the F2 reference solve when the scope includes it.
 * A census refusal no longer skips F2: the author reads every blocking row of one tree in one
 * call instead of meeting F2's rows only after the census is repaired. Persist census.json beside
 * the iteration evidence and return findings through the existing feedback channel. Execution
 * records establish what ran, not tool independence by themselves. Controls and F2 share one
 * failure handling for verifier executions that returned no verdict, and whichever failure is
 * reported, the work either stage started drains within the wall's grace before a retry or a
 * settlement: the next attempt must not overlap an abandoned stage's tool cells.
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
      // One fresh execution may recover a transient host refusal.
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

/** The control census's rows: the findings that refuse the candidate, and beside them the advisory
 *  ones, which report a gap the author may close without failing the gate. */
function controlsRows(findings: ContractFinding[]): CampaignFeedback[] {
  const row = (severity: "blocking" | "advisory", rows: ContractFinding[]): CampaignFeedback[] =>
    rows.length === 0
      ? []
      : [
          {
            owner: "correctness-model",
            severity,
            claim: `control census against the installed tools returned ${rows.length} finding(s)`,
            evidence: "census gate: executed discrimination evidence (census.json)",
            findings: controllerValidatedFindings(rows),
          },
        ];
  return [
    ...row(
      "blocking",
      findings.filter((finding) => !ADVISORY_DISCRIMINATION_CODES.has(finding.code)),
    ),
    ...row(
      "advisory",
      findings.filter((finding) => ADVISORY_DISCRIMINATION_CODES.has(finding.code)),
    ),
  ];
}

/** The control findings, with the drift the census observed against the identity captured at submit. */
function controlFindings(harness: BuiltHarness, probe: ProbeControlsResult): ContractFinding[] {
  const captured = harness.conformance?.verifierEnvironmentHash;
  // A census stopped before its controls (run 805bcc's unloadable evaluator) reports no identity.
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
  // environment's non-result (rule 15), not a correctness-model finding for the Builder to repair.
  const refusal = findings.find((finding) => finding.code === TOOL_REFUSED_CODE);
  const referenceRows = reference.status === "fulfilled" ? reference.value : [];
  const completed: Completed = {
    ...keyIfDefined("probe", probe),
    rows: [...controlsRows(findings.filter((finding) => finding !== refusal)), ...referenceRows],
  };
  // Controls first: the reported failure is the earlier stage's, and the other's rows ride beside it.
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
  // A row's presence alone does not fail the census: advisory findings do not refuse a candidate.
  // Campaign memory keeps blocking rows for later authoring through settleUnresolved, while
  // advisory rows remain in the iteration record and may be returned to the current session;
  // correctness_check reports their count. The representation census uses the same advisory
  // treatment (solvability-gate.ts).
  const verdict = feedback.some((row) => row.severity === "blocking") ? "fail" : "pass";
  persistCensus(context, feedback, probe, verdict, {
    findings,
    advisory: feedback.filter((row) => row.severity === "advisory"),
  });
  options.verifierLifetime?.assertUsable();
  return { feedback };
}
