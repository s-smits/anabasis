/**
 * F2: runs every authored task's reference solve through the pinned verifier host before adoption,
 * using the same probe the claim writer reruns later.
 *
 * Task ids, per-task check results and tool text are protected: they stay in
 * <iterationDir>/solvability.json. The Builder sees only aggregates over its own declared
 * structures: counts, which declared checks reject and how often, and the input-insensitivity
 * observation. Environment non-results are not product failures.
 *
 * The representation census reuses the passed witnesses without another execution;
 * representation-census.ts decides which of its findings block.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import type { BuiltHarness, CampaignFeedback } from "../author/campaign-types.ts";
import type { SolvabilityCaseEvidence, SolvabilityEvidence } from "../claim/readiness.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { type ContractFinding, controllerValidatedFindings } from "../truth/brief.ts";
import type { BuildDeps } from "../truth/build-deps.ts";
import { type SolvabilityProbeOptions, makeProbeSolvability } from "../truth/solvability.ts";
import { referenceSolveTimedOut } from "../truth/reference-solve.ts";
import type { SolvabilityStageCache } from "../truth/solvability-stages.ts";
import { acceptControlIndependence, acceptIndependenceFeedback } from "./accept-control-independence.ts";
import {
  BLOCKING_CODES,
  type Witness,
  censusRepresentation,
  inputInsensitivity,
} from "./representation-census.ts";
import { loadRecordedTasks } from "./run-driver.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { EVALUATOR_FILE, GENERATED_TOOLS_FILE } from "../meta/bundle-layout.ts";
import { REFERENCE_SOLVE_ENTRY_SOLVE } from "../truth/evaluator-process-bundle.ts";

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

/** The two codes the family-binding census emits (family-binding.ts). */
const FAMILY_BINDING_CODES = new Set(["TASK_FAMILY_UNIVERSAL_WITNESS", "TASK_FAMILY_BINDING_UNPROVEN"]);

type ToolRefusalCode =
  | "solvability-tool-missing"
  | "solvability-tool-self-authored"
  | "solvability-tool-program-argument";

/** Refused self-grounding and tool shapes: code, owner and the claim each row carries. */
const TOOL_REFUSALS: ReadonlyArray<
  readonly [ToolRefusalCode, CampaignFeedback["owner"], (count: number) => string]
> = [
  [
    "solvability-tool-missing",
    "correctness-model",
    (count) =>
      `installed tools: ${count} external check(s) name a tool that resolves nowhere, so the reference solves did not run`,
  ],
  [
    "solvability-tool-self-authored",
    "brief",
    () =>
      "installed tools: an external check is grounded only by a script under the candidate's own tool tree, so a battery would measure that script's agreement with itself",
  ],
  [
    "solvability-tool-program-argument",
    "brief",
    () =>
      "installed tools: an external check hands its program to the tool as an argument, so the attested tool is only an interpreter and a battery would measure the candidate's own checker",
  ],
];

export function makeSolvabilityCensusGate(
  options: SolvabilityProbeOptions = {},
  probe: BuildDeps["probeSolvability"] = makeProbeSolvability(options),
): SolvabilityCensusGate {
  return async (harness, iterationDir, slugDir, stopped = () => false, stages) => {
    // The frozen-source check belongs to the claim writer, not here.
    const probed = await probe({
      slugDir,
      fingerprint: harness.fingerprint,
      // A fresh secret per census; only keyId enters the evidence.
      operandCommitment: {
        key: crypto.getRandomValues(new Uint8Array(32)),
        keyId: `${harness.fingerprint.taskSetHash ?? "unbound"}-adoption-operands`,
      },
      stopped,
      ...keyIfDefined("stages", stages),
    });
    // A cut census writes no solvability.json, which readiness would read as a completed F2.
    if (stopped()) return [];
    const { evidence, findings: probedFindings } = probed;
    const passed = witnessesOf(evidence, slugDir, "passed");
    const representation = censusRepresentation(passed, harness.publicArtifactSchema);
    const independence = acceptControlIndependence(slugDir, passed);
    await Bun.write(
      join(iterationDir, SOLVABILITY_EVIDENCE_FILE),
      capturedJsonStringify(
        {
          evidence,
          findings: probedFindings,
          representation: representation.observations,
          acceptIndependence: independence,
          source: SOURCE_IDENTITY,
        },
        null,
        2,
      ),
    );
    options.verifierLifetime?.assertUsable();
    const toolRefusals = TOOL_REFUSALS.flatMap(([code, owner, claim]) =>
      toolFeedback(probedFindings, code, owner, claim),
    );
    // A tool refusal skipped F2 on purpose, so no census failure is reported beside it.
    if (evidence === null && toolRefusals.length > 0) return toolRefusals;
    const insensitivity = inputInsensitivity(witnessesOf(evidence, slugDir, "failed"));
    return [
      ...censusFeedback(evidence, insensitivity),
      ...representationFeedback(representation.findings),
      ...familyBindingFeedback(probedFindings),
      ...acceptIndependenceFeedback(independence),
      ...toolRefusals,
    ];
  };
}

/** Representation findings grouped into one blocking and one advisory row, so an advisory finding
 *  never inherits a blocking row's effect. */
function representationFeedback(findings: ContractFinding[]): CampaignFeedback[] {
  const severities = [
    { severity: "blocking", rows: findings.filter((f) => BLOCKING_CODES.has(f.code)) },
    { severity: "advisory", rows: findings.filter((f) => !BLOCKING_CODES.has(f.code)) },
  ] as const;
  return severities
    .values()
    .filter(({ rows }) => rows.length > 0)
    .map(
      ({ severity, rows }): CampaignFeedback => ({
        owner: "brief",
        severity,
        claim: `representation census: ${rows.length} artifact schema finding(s) that hold on every authored task`,
        evidence: "pre-adoption representation census over the F2 reference witnesses",
        findings: controllerValidatedFindings(rows),
      }),
    )
    .toArray();
}

/**
 * Routes the family-binding findings to their own `tests`-owned row. They are already aggregates
 * of Builder-authored identities with no task ids. The repair may change the tasks or the
 * correctness check that failed to tell the deliverables apart.
 */
function familyBindingFeedback(findings: readonly ContractFinding[]): CampaignFeedback[] {
  const rows = findings.filter((found) => FAMILY_BINDING_CODES.has(found.code));
  if (rows.length === 0) return [];
  return [
    {
      owner: "tests",
      severity: "blocking",
      claim: `family binding census: ${rows.length} family/families whose accepted deliverables were exchanged between siblings`,
      evidence: PROTECTED_EVIDENCE,
      findings: controllerValidatedFindings(rows),
    },
  ];
}

/**
 * One blocking row per refused tool shape, naming only the adapterId the brief declared, so the
 * cause is visible rather than hidden inside a failure count.
 */
function toolFeedback(
  findings: readonly ContractFinding[],
  code: ToolRefusalCode,
  owner: CampaignFeedback["owner"],
  claim: (count: number) => string,
): CampaignFeedback[] {
  const rows = findings.filter((found) => found.code === code);
  if (rows.length === 0) return [];
  const projected = code.toUpperCase().replaceAll("-", "_");
  return [
    {
      owner,
      severity: "blocking",
      claim: claim(rows.length),
      evidence: PROTECTED_EVIDENCE,
      findings: controllerValidatedFindings(
        rows.map((row) => ({ code: projected, path: row.path, detail: row.detail })),
      ),
    },
  ];
}

/**
 * The F2 witnesses of one status paired with their public input. The representation census reads
 * passed cases; the input-insensitivity check reads failed ones. An unreadable task file yields no
 * witnesses; other gates report it.
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
    const publicInput = publicInputs.get(row.taskId);
    if (publicInput === undefined) continue;
    witnesses.push({ taskId: row.taskId, artifact: row.artifact, publicInput });
  }
  return witnesses;
}

/** Which declared truth-checks reject the reference solve and how often, without task ids. */
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

/** Representation-defect details, deduplicated and without task ids. They come from the submission
 *  path before verification and describe the public authoring interface, so they may cross. */
function representationDefectFeedback(
  cases: readonly SolvabilityCaseEvidence[],
  representationDefects: number,
): CampaignFeedback {
  const detailCounts = new Map<string, number>();
  for (const row of cases) {
    if (row.status !== "failed" || row.failureKind !== "representation-defect") continue;
    const detail =
      row.error ?? "the submission path refused the reference artifact without a recorded public detail";
    detailCounts.set(detail, (detailCounts.get(detail) ?? 0) + 1);
  }
  const ranked = [...detailCounts.entries()].sort(
    ([aDetail, aN], [bDetail, bN]) => bN - aN || compareCodeUnits(aDetail, bDetail),
  );
  const projected = ranked.slice(0, 8);
  const withheld = ranked.length - projected.length;
  return {
    owner: "brief",
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

function censusFeedback(
  evidence: Pick<SolvabilityEvidence, "cases"> | null,
  insensitivity: ContractFinding[],
): CampaignFeedback[] {
  if (evidence === null) {
    return [
      {
        owner: "correctness-model",
        severity: "blocking",
        claim: "solvability census could not execute over the fingerprinted candidate",
        evidence: PROTECTED_EVIDENCE,
        findings: controllerValidatedFindings([
          {
            code: "SOLVABILITY_CENSUS_UNAVAILABLE",
            path: EVALUATOR_FILE,
            detail:
              "the pre-adoption census produced no evidence; the failure record is host-side and protected",
          },
        ]),
      },
    ];
  }
  const { cases } = evidence;
  const representationDefects = cases.filter(
    (row) => row.status === "failed" && row.failureKind === "representation-defect",
  ).length;
  const failed = cases.filter(
    (row) => row.status === "failed" && row.failureKind !== "representation-defect",
  ).length;
  const nonResults = cases.filter((row) => row.status === "non-result").length;
  const feedback: CampaignFeedback[] = [];
  if (nonResults > 0) {
    feedback.push({
      owner: "environment",
      severity: "blocking",
      claim: `solvability census: ${nonResults} of ${cases.length} reference solves ended as environment non-results`,
      evidence: PROTECTED_EVIDENCE,
    });
  }
  if (representationDefects > 0) {
    feedback.push(representationDefectFeedback(cases, representationDefects));
  }
  if (failed > 0) {
    // Named so a slow search is not repaired as a wrong one.
    const timedOut = cases.filter((row) => row.status === "failed" && referenceSolveTimedOut(row)).length;
    const wall =
      timedOut === 0
        ? ""
        : `, and ${timedOut} of those stopped at the per-task reference solve wall before returning an artifact`;
    feedback.push({
      owner: "correctness-model",
      severity: "blocking",
      claim: `solvability census: ${failed} of ${cases.length} authored tasks rejected the candidate's own reference solve`,
      evidence: PROTECTED_EVIDENCE,
      findings: controllerValidatedFindings([
        {
          code: "SOLVABILITY_CENSUS_BLOCKED",
          path: REFERENCE_SOLVE_ENTRY_SOLVE,
          detail: `${failed} of ${cases.length} reference solves failed under the installed tools${wall}; task identities and tool run rows stay in the protected host evidence`,
        },
        ...checkConcentration(cases),
        ...insensitivity,
      ]),
    });
  }
  return feedback;
}
