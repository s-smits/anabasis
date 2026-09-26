/**
 * F2 checks every task's solvability before adoption. Solving `battery.tasks[0]` alone while the
 * census checks controls lets a candidate be adopted with the rest of the battery unproven, so this
 * gate runs every authored task's reference solve through the pinned verifier host — the same
 * `makeProbeSolvability` the claim writer runs again later — before adoption.
 *
 * The recorded evidence and findings carry task ids, per-task check results and tool text, all of
 * which are protected. They stay host-side at <iterationDir>/solvability.json and never enter the
 * returned feedback. What the author sees is the aggregate count, the failing-check concentration
 * and the input-insensitivity observation (representation-census.ts), all of which describe
 * Builder-authored structures. Check ids come from the brief's own declared truthChecks, which the
 * Builder already knows, so the projection may name which checks reject and how often at aggregate
 * level while the per-task join — which task failed which check — the task ids and the tool output
 * stay behind.
 *
 * The count alone is not enough, because "25 of 25 rejected" leaves the author repairing blind
 * while every one of those failures may sit inside two or three declared checks. The concentration
 * is what makes the number actionable. Environment non-results belong to the environment and are
 * not counted as product failures.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { BuiltHarness, CampaignFeedback } from "../author/campaign-types.ts";
import type { SolvabilityCaseEvidence, SolvabilityEvidence } from "../claim/readiness.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { type ContractFinding, controllerValidatedFindings } from "../correctness-bundle/brief.ts";
import type { BuildDeps } from "../correctness-bundle/build-deps.ts";
import {
  CASE_CODE,
  type SolvabilityProbeOptions,
  makeProbeSolvability,
} from "../correctness-bundle/solvability.ts";
import { referenceSolveTimedOut } from "../correctness-bundle/reference-solve.ts";
import { applicableCheckIds } from "../correctness-bundle/run-controls.ts";
import { EXTERNAL_VERDICT_UNGROUNDED } from "../correctness-bundle/tool-runs.ts";
import type { SolvabilityStageCache } from "../correctness-bundle/solvability-stages.ts";
import { acceptControlIndependence, acceptIndependenceFeedback } from "./accept-control-independence.ts";
import { type Witness, inputInsensitivity } from "./representation-census.ts";
import { loadRecordedTasks } from "./run-driver.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { BRIEF_FILE, EVALUATOR_FILE, GENERATED_TOOLS_FILE } from "../meta/bundle-layout.ts";
import { WORKSPACE_TOOL_TREE } from "../verify/wall-policy.ts";
import {
  REFERENCE_SOLVE_ENTRY,
  REFERENCE_SOLVE_ENTRY_SOLVE,
} from "../correctness-bundle/evaluator-process-bundle.ts";

/** The iteration-relative census evidence; the gate writes it and `check-tool` reads it. */
export const SOLVABILITY_EVIDENCE_FILE = "solvability.json";

const PROTECTED_EVIDENCE = "pre-adoption solvability census (protected host evidence: solvability.json)";

export type SolvabilityCensusGate = (
  harness: BuiltHarness,
  iterationDir: string,
  slugDir: string,
  /** True once the census wall has cut this census: start no further task and record nothing. */
  stopped?: () => boolean,
  /** The session's remembered stage results (gate/validation-pipeline.ts). */
  stages?: SolvabilityStageCache,
) => Promise<CampaignFeedback[]>;

export function makeSolvabilityCensusGate(
  options: SolvabilityProbeOptions = {},
  probe: BuildDeps["probeSolvability"] = makeProbeSolvability(options),
): SolvabilityCensusGate {
  return async (harness, iterationDir, slugDir, stopped = () => false, stages) => {
    // A run executes from its own launch worktree, so there is nothing to compare against here;
    // the claim writer owns the frozen-source check.
    const probed = await probe({
      slugDir,
      fingerprint: harness.fingerprint,
      // Run-scoped controller secret, created fresh for each census; only the keyId enters the
      // evidence, so the recorded file names the commitment without carrying the key itself.
      operandCommitment: {
        key: crypto.getRandomValues(new Uint8Array(32)),
        keyId: `${harness.fingerprint.taskSetHash ?? "unbound"}-adoption-operands`,
      },
      stopped,
      ...keyIfDefined("stages", stages),
    });
    // A cut census records no witnesses at all, because readiness reads this file as the F2 census
    // that ran: a partial one written here would claim a census the run never finished.
    if (stopped()) return [];
    const { evidence, findings: probedFindings } = probed;
    const passed = witnessesOf(evidence, slugDir, "passed");
    const independence = acceptControlIndependence(slugDir, passed);
    await Bun.write(
      join(iterationDir, SOLVABILITY_EVIDENCE_FILE),
      capturedJsonStringify(
        {
          evidence,
          findings: probedFindings,
          acceptIndependence: independence,
          source: SOURCE_IDENTITY,
        },
        null,
        2,
      ),
    );
    options.verifierLifetime?.assertUsable();
    const toolRefusals = missingToolFeedback(probedFindings);
    // A declared tool refusal skips F2 deliberately, so it is not a second census execution
    // failure and nothing else is reported beside it.
    if (evidence === null && toolRefusals.length > 0) return toolRefusals;
    const insensitivity = inputInsensitivity(witnessesOf(evidence, slugDir, "failed"));
    const suspect = evidence === null ? null : toolsSuspect(evidence, harness, stages);
    return [
      ...censusFeedback(evidence, insensitivity, probedFindings, suspect),
      ...acceptIndependenceFeedback(independence),
      ...toolRefusals,
    ];
  };
}

/**
 * One blocking row for a tool that resolves nowhere, naming Builder-authored identities only — the
 * adapterId the brief declared — so it crosses as its own row. Such a tool makes every witness
 * needing it fail, and the census row above then says only "8 of 8 failed under the installed
 * tools", which an author can spend dozens of checks against without ever reading the refused root.
 */
function missingToolFeedback(findings: readonly ContractFinding[]): CampaignFeedback[] {
  const rows = findings.filter((found) => found.code === "solvability-tool-missing");
  if (rows.length === 0) return [];
  return [
    {
      owner: EVALUATOR_FILE,
      severity: "blocking",
      claim: `installed tools: ${rows.length} external check(s) name a tool that resolves nowhere, so the reference solves did not run`,
      evidence: PROTECTED_EVIDENCE,
      findings: controllerValidatedFindings(
        rows.map((row) => ({ code: "SOLVABILITY_TOOL_MISSING", path: row.path, detail: row.detail })),
      ),
    },
  ];
}

/**
 * The F2 witnesses paired with the public input the agent would have been given, filtered to one
 * status because the two readers take different subsets. The accept-independence reading takes passed
 * cases only, since a failed reference solve's artifact is not the known-good shape, while the
 * input-insensitivity check reads failed cases, where the artifact is what helps explain the
 * failure. A missing or unreadable task file yields no witnesses: the census declines rather than
 * guessing, and the gates that own task-file structure are the ones that report it.
 */
function witnessesOf(
  evidence: Pick<SolvabilityEvidence, "cases"> | null,
  slugDir: string,
  status: "passed" | "failed",
): Witness[] {
  if (evidence === null) return [];
  let publicInputs: Map<string, JsonValue>;
  try {
    publicInputs = new Map(loadRecordedTasks(slugDir).map((task) => [task.taskId, task.publicInput]));
  } catch {
    return [];
  }
  const witnesses: Witness[] = [];
  for (const row of evidence.cases) {
    if (row.status !== status || row.artifact === null) continue;
    // `JsonValue` excludes undefined, so one lookup answers both "is this task recorded" and "what
    // did it show", where a `has` followed by a `get` asked the map twice and still returned a
    // type that admitted the missing case.
    const publicInput = publicInputs.get(row.taskId);
    if (publicInput === undefined) continue;
    witnesses.push({ taskId: row.taskId, artifact: row.artifact, publicInput });
  }
  return witnesses;
}

/** Aggregate failing-check concentration: which of the brief's own declared truth-checks reject
 *  the reference solve, and how often. The check names are Builder-authored, so aggregate counts
 *  can identify the affected checks while the per-task results stay protected. The Builder
 *  receives no task identities and no tool output from this projection. */
function checkConcentration(cases: readonly SolvabilityCaseEvidence[]): ContractFinding[] {
  const counts = new Map<string, number>();
  for (const row of cases) {
    if (row.status !== "failed") continue;
    for (const id of row.failedCheckIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const ranked = [...counts.entries()].sort(([aId, aN], [bId, bN]) => bN - aN || compareCodeUnits(aId, bId));
  return [
    {
      code: "SOLVABILITY_FAILURE_CONCENTRATION",
      path: REFERENCE_SOLVE_ENTRY_SOLVE,
      detail: `reference-solve failures concentrate in ${ranked.length} declared truth-check(s): ${ranked
        .map(([id, n]) => `${id} (${n})`)
        .join(", ")}; the per-task join and tool run rows stay in the protected host evidence`,
    },
  ];
}

/** Every representation-defect detail comes off the submission path before verification and is
 *  classified generated-toolset-contract, because it describes the public authoring interface —
 *  writer schema, DraftStore, submit — which may be reported to the Builder. A bare count is not
 *  enough: with the detail an author clears the defect in one pass, and without it the same defect
 *  survives round after round of guessing. Details are deduplicated and carry no task identities;
 *  the per-task join stays protected. */
function representationDefectFeedback(
  cases: readonly SolvabilityCaseEvidence[],
  representationDefects: number,
): CampaignFeedback {
  const detailCounts = new Map<string, number>();
  for (const row of cases) {
    if (row.status !== "failed" || row.failure !== "representation-defect") continue;
    detailCounts.set(row.error, (detailCounts.get(row.error) ?? 0) + 1);
  }
  const ranked = [...detailCounts.entries()].sort(
    ([aDetail, aN], [bDetail, bN]) => bN - aN || compareCodeUnits(aDetail, bDetail),
  );
  const projected = ranked.slice(0, 8);
  const withheld = ranked.length - projected.length;
  return {
    owner: BRIEF_FILE,
    severity: "blocking",
    claim: `solvability census: ${representationDefects} of ${cases.length} reference artifacts cannot traverse the public writer and submit path`,
    evidence: PROTECTED_EVIDENCE,
    findings: controllerValidatedFindings([
      {
        code: "SOLVABILITY_REPRESENTATION_DEFECT",
        path: GENERATED_TOOLS_FILE,
        detail: `${representationDefects} of ${cases.length} public-valid reference artifacts are not expressible through the declared writer schema, DraftStore materialisation and submit path; task identities and artifact values stay in the protected host evidence${withheld > 0 ? `; ${withheld} further distinct defect(s) beyond the ${projected.length} below stay in the protected host evidence` : ""}`,
      },
      ...projected.map(([detail, count]) => ({
        code: "SOLVABILITY_REPRESENTATION_DEFECT_DETAIL",
        path: GENERATED_TOOLS_FILE,
        detail: `${count} of ${cases.length} reference artifacts: ${detail}`,
      })),
    ]),
  };
}

/** R1 in the reference solve: a pass a check decided without running its required tools is the
 *  evaluator's defect, not the reference's. Each case's sentence names check and tool ids only, so
 *  the distinct sentences cross whole and the task identities stay in the host evidence. */
function ungroundedFeedback(cases: readonly SolvabilityCaseEvidence[]): CampaignFeedback[] {
  const rows = cases.flatMap((row) =>
    row.status === "failed" && row.failure === "ungrounded" ? [row.error] : [],
  );
  if (rows.length === 0) return [];
  const sentences = [...new Set(rows)].sort(compareCodeUnits);
  return [
    {
      owner: EVALUATOR_FILE,
      severity: "blocking",
      claim: `solvability census: ${rows.length} of ${cases.length} reference solves passed a check that never ran its required tools`,
      evidence: PROTECTED_EVIDENCE,
      findings: controllerValidatedFindings(
        sentences.map((detail) => ({ code: EXTERNAL_VERDICT_UNGROUNDED, path: EVALUATOR_FILE, detail })),
      ),
    },
  ];
}

/** The rows the census counts as the reference being rejected: failed, but not on the carry path
 *  or on an ungrounded pass, which have owners of their own. */
function rejected(row: SolvabilityCaseEvidence): boolean {
  return row.status === "failed" && row.failure !== "representation-defect" && row.failure !== "ungrounded";
}

/** A reference answer's identity apart from the installed tools: the correctness model, the full
 *  task and the answer bytes. Null when the answer never reached bytes. */
function referenceKey(evidence: SolvabilityEvidence, row: SolvabilityCaseEvidence): string | null {
  if (row.artifactDigest === null) return null;
  return `${evidence.correctnessModelHash}:${row.fullTaskDigest}:${row.artifactDigest}`;
}

/** Rejected reference answers whose exact bytes passed, over the same correctness model and task,
 *  under a different installed-tool condition earlier in this session. The session then remembers
 *  this census's passes under its own condition. */
function passedUnderOtherTools(evidence: SolvabilityEvidence, memory: Map<string, Set<string>>): number {
  const tools = evidence.verifierEnvironmentHash;
  if (tools === null) return 0;
  let count = 0;
  for (const row of evidence.cases) {
    const key = referenceKey(evidence, row);
    if (key === null) continue;
    const seen = memory.get(key) ?? new Set<string>();
    if (rejected(row) && [...seen].some((condition) => condition !== tools)) count += 1;
    if (row.status === "passed") memory.set(key, seen.add(tools));
  }
  return count;
}

/** The declared truth-checks each battery task is held to. A brief whose contract this reader
 *  cannot resolve yields none, which leaves the every-check reading off rather than guessing. */
function applicableByTask(harness: BuiltHarness): Map<string, string[]> {
  try {
    return new Map(
      harness.battery.tasks.map((task) => [task.taskId, applicableCheckIds(harness.brief, task)]),
    );
  } catch {
    return new Map();
  }
}

/** Whether every applicable check rejected every reference answer while none passed. Checks that
 *  share nothing but the installed tools rarely all reject answers the Builder wrote on purpose,
 *  while a wrapper or interpreter that cannot run inside the verifier wall fails each of them. A
 *  task held to one check says nothing either way, so it keeps the reading off. */
function everyCheckRejected(cases: readonly SolvabilityCaseEvidence[], applicable: Map<string, string[]>) {
  const failed = cases.filter(rejected);
  if (failed.length === 0 || cases.some((row) => row.status === "passed")) return false;
  return failed.every((row) => {
    const checks = applicable.get(row.taskId) ?? [];
    return checks.length > 1 && checks.every((id) => row.failedCheckIds.includes(id));
  });
}

/**
 * Why the installed tools, rather than the reference solve, are the likelier owner of a rejected
 * census, or null when nothing separates them. Of 15 recorded f2-reference-verdict firings, 3 were
 * the candidate's own `.toolchain` that could not run inside the cell (truss-8, -9 and -10, 42
 * minutes): every check rejected every task, the reference bytes were identical before and after,
 * and only the tool condition moved. The row still refuses, since nothing could be verified; it
 * names the owner that can fix it.
 */
function toolsSuspect(
  evidence: SolvabilityEvidence,
  harness: BuiltHarness,
  stages: SolvabilityStageCache | undefined,
): string | null {
  const moved = stages === undefined ? 0 : passedUnderOtherTools(evidence, stages.passedReferences);
  if (moved > 0) {
    return `${moved} rejected reference answer(s) are byte-identical to answers that passed under a different installed-tool condition in this session, over the same correctness model and tasks, so the tools moved and the reference did not`;
  }
  if (everyCheckRejected(evidence.cases, applicableByTask(harness))) {
    return "every declared truth-check that applies rejected every reference answer and none passed, which is how tools that cannot run inside the verifier wall read; run each check's tool under the wall before changing the reference solve";
  }
  return null;
}

/** The rejection row: the reference solve owns it, unless the installed tools are the suspect. The
 *  count, the wall share and the concentration are the same either way. */
function rejectionFeedback(
  cases: readonly SolvabilityCaseEvidence[],
  insensitivity: ContractFinding[],
  suspect: string | null,
): CampaignFeedback {
  const failed = cases.filter(rejected).length;
  // How many of the failed solves the per-task wall stopped, stated separately so a slow search
  // is not repaired as a wrong one.
  const timedOut = cases.filter((row) => row.status === "failed" && referenceSolveTimedOut(row)).length;
  const wall =
    timedOut === 0
      ? ""
      : `, and ${timedOut} of those stopped at the per-task reference solve wall before returning an artifact`;
  const blocked = {
    code: "SOLVABILITY_CENSUS_BLOCKED",
    path: REFERENCE_SOLVE_ENTRY_SOLVE,
    detail: `${failed} of ${cases.length} reference solves failed under the installed tools${wall}; task identities and tool run rows stay in the protected host evidence`,
  };
  const findings = [blocked, ...checkConcentration(cases), ...insensitivity];
  if (suspect === null) {
    return {
      owner: REFERENCE_SOLVE_ENTRY,
      severity: "blocking",
      claim: `solvability census: ${failed} of ${cases.length} authored tasks rejected the candidate's own reference solve`,
      evidence: PROTECTED_EVIDENCE,
      findings: controllerValidatedFindings(findings),
    };
  }
  return {
    owner: EVALUATOR_FILE,
    severity: "blocking",
    claim: `installed tools: ${failed} of ${cases.length} reference solves failed, and the evidence points at the tools the checks run rather than the reference solve`,
    evidence: PROTECTED_EVIDENCE,
    findings: controllerValidatedFindings([
      { code: "SOLVABILITY_INSTALLED_TOOLS_SUSPECT", path: WORKSPACE_TOOL_TREE, detail: suspect },
      ...findings,
    ]),
  };
}

/**
 * A census with no evidence is the candidate's to answer for, whatever stopped it. Every cause that
 * leaves the evidence null — an unbound task set, a snapshot that fails its integrity check or drifts
 * under the census, an evaluator that will not load, a brief and battery that will not parse, an
 * accept corpus whose schema will not compile — either is the candidate's own bytes or cannot be told
 * apart from what its generated code did to the snapshot. Owned by the environment, such a row would
 * end the campaign at submit; owned by the evaluator it costs a strike the Builder answers by
 * changing bytes. The host's own failures surface as per-case non-results below, not as null evidence.
 */
function censusFeedback(
  evidence: Pick<SolvabilityEvidence, "cases"> | null,
  insensitivity: ContractFinding[],
  probed: readonly ContractFinding[],
  suspect: string | null,
): CampaignFeedback[] {
  if (evidence === null) {
    // The finding that stopped it is the last one the probe returned: a load refusal stands alone, and
    // drift follows the per-case findings, whose paths name tasks and so never cross. Its code and
    // path name the requirement that failed; its detail stays protected.
    const cause = probed.at(-1);
    return [
      {
        owner: EVALUATOR_FILE,
        severity: "blocking",
        claim: "solvability census could not execute over the fingerprinted candidate",
        evidence: PROTECTED_EVIDENCE,
        findings: controllerValidatedFindings([
          {
            code: "SOLVABILITY_CENSUS_UNAVAILABLE",
            path: cause?.path ?? EVALUATOR_FILE,
            detail: `the pre-adoption census produced no evidence${cause === undefined ? "" : ` (${cause.code})`}; the failure record is host-side and protected`,
          },
        ]),
      },
    ];
  }
  const { cases } = evidence;
  const representationDefects = cases.filter(
    (row) => row.status === "failed" && row.failure === "representation-defect",
  ).length;
  const nonResults = cases.flatMap((row) => (row.status === "non-result" ? [row.nonResultKind] : []));
  const feedback: CampaignFeedback[] = [];
  if (nonResults.length > 0) {
    // One finding per host kind, so the Builder reads which host step broke rather than a gate that
    // named nothing; the task ids and the host's own text stay in the protected record.
    const kinds = [...new Set(nonResults)].sort(compareCodeUnits);
    feedback.push({
      owner: "environment",
      severity: "blocking",
      claim: `solvability census: ${nonResults.length} of ${cases.length} reference solves ended as environment non-results`,
      evidence: PROTECTED_EVIDENCE,
      findings: controllerValidatedFindings(
        kinds.map((kind) => {
          const count = nonResults.filter((found) => found === kind).length;
          return {
            code: CASE_CODE[kind],
            path: "environment",
            detail: `${count} of ${cases.length} reference solves ended as a ${kind} non-result${kind === "sandbox" ? "" : " on both of their attempts"}, which the host owns; a check of the same bytes runs the census again`,
          };
        }),
      ),
    });
  }
  if (representationDefects > 0) {
    feedback.push(representationDefectFeedback(cases, representationDefects));
  }
  feedback.push(...ungroundedFeedback(cases));
  if (cases.some(rejected)) feedback.push(rejectionFeedback(cases, insensitivity, suspect));
  return feedback;
}
