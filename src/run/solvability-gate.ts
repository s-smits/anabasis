/**
 * F2 checks every task's solvability before adoption (production connection audit,
 * BUILD-STATE 2026-07-26). In fullrun-live-01, the verifier session solved only
 * battery.tasks[0], while the census checked controls. A candidate whose reference passed
 * only task 1 could therefore be adopted without proving the other tasks solvable. This gate
 * executes every authored task's reference solve through the pinned verifier host (the same
 * makeProbeSolvability the claim writer later runs again) before adoption.
 *
 * The recorded evidence and findings carry task ids, per-task check results and tool
 * text — protected evidence. They persist host-side as <iterationDir>/solvability.json and never
 * enter the returned feedback; the author-visible projection is the aggregate count, the
 * failing-check concentration, and the input-insensitivity observation
 * (representation-census.ts). The projected findings describe Builder-authored structures.
 * Check ids come from the brief's declared truthChecks, which the Builder already knows,
 * so the projection names which checks reject and how often at aggregate
 * level, while the per-task join (which task failed which check), task ids, and tool output
 * stay behind. Run 12 is why the count alone was not enough: two iterations repaired blind
 * against "25 of 25 rejected". Run 14 iteration 1 repeated the class — all 75 check failures
 * inside 3 declared checks, and only the bare count crossed. Environment non-results are owned
 * by the environment and do not count as product failures.
 *
 * The representation census reuses these witnesses without another execution to detect copied
 * public inputs and repeated absence spellings. These are bounded representation checks, not
 * a general proof that tasks require domain skill. Their findings describe authored structures
 * without quoting protected verifier evidence. BLOCKING_CODES in that module determines which
 * findings refuse adoption, based on its recorded calibration; this gate routes those findings
 * using the declared severity.
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
    // A run executes from its own launch worktree; the claim writer owns the frozen-source check.
    const probed = await probe({
      slugDir,
      fingerprint: harness.fingerprint,
      // Run-scoped controller secret, created fresh per census; only keyId enters the evidence.
      operandCommitment: {
        key: crypto.getRandomValues(new Uint8Array(32)),
        keyId: `${harness.fingerprint.taskSetHash ?? "unbound"}-adoption-operands`,
      },
      stopped,
      ...keyIfDefined("stages", stages),
    });
    // A cut census records no witnesses: readiness reads this file as the F2 census that ran.
    if (stopped()) return [];
    const { evidence, findings: probedFindings } = probed;
    // Pass the compiled public artifact schema so the absence rule can distinguish a declared
    // closed state ("none" among a field's allowedValues) from an invented sentinel.
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
    // A declared tool refusal skips F2 deliberately; it is not a second census execution failure.
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

/**
 * The Builder authors artifactSchema and the public structures compared by the census.
 * These findings describe those observations without quoting protected verifier evidence.
 * Group findings by severity, so an advisory finding cannot inherit a blocking row's effect.
 * The census defines which codes block; this function applies that classification.
 *
 * A blocking finding refuses adoption and returns to the Builder for repair through the submit
 * path. Advisory findings remain recorded without causing a refusal. They must not be confused
 * with the measured admission packet used by later controller decisions, which has its own
 * evidence and projection rules. Both kinds retain their declared severity in this packet;
 * this grouping adds no new decision about the candidate.
 */
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
 * The family-binding census arrives on the probe's ordinary findings channel; this routes it to its
 * own packet, because its owner and remedy differ from the per-case census beside it. What crosses
 * is already the aggregate the census composed: family, denominator, the marked root names and the
 * remedy — Builder-authored public identities, with no donor or target task id in any of them.
 *
 * The owner is `tests`: the Builder can author tasks requiring different deliverables or repair
 * a correctness check that failed to distinguish them. The declared repair scope includes the
 * correctness model as well as tasks. This is
 * pre-adoption evidence, so that session is the normal consumer.
 *
 * A `tests` row that later reaches admitted feedback remains a product issue. The default loop
 * reopens authoring from the adopted product and lets the Builder choose the change; accepted
 * bytes determine whether it changed only tasks, corrected evaluation or changed the build.
 * Earlier agent-only repair routing could not resolve this scope because it held task changes
 * on `repair-task-drift`. The recorded owner must therefore retain the full repair scope.
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
 * One blocking row per refused tool shape, naming Builder-authored identities only — the adapterId
 * the brief declared — so it crosses as its own row. A tool that resolves nowhere makes every
 * witness that needs it fail, and the census row above says only "8 of 8 failed under the
 * installed tools"; loop-3 (2026-08-23) spent 26 checks on one refused root nobody could read. A
 * check grounded only by a script the author wrote into `.toolchain` measures agreement with that
 * script (ten truss 25/25 batteries of 4 September 2026). The brief owner can revise the
 * declared evidence and tool choice; tool identity alone does not prove independent semantics.
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
 * The F2 witnesses paired with the public input the agent would have been given, filtered to one
 * status because the two censuses read different subsets: the representation census reads passed
 * cases only — a failed reference solve's artifact is not the known-good shape — while the
 * input-insensitivity check reads failed cases, where the artifact can help explain the failure.
 * A missing or unreadable task file yields no witnesses — the census declines rather than
 * guessing, and the gates that own task-file structure report it.
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
    // did it show", where a `has` followed by a `get` asked the map twice and still returned a type
    // that admitted the missing case.
    const publicInput = publicInputs.get(row.taskId);
    if (publicInput === undefined) continue;
    witnesses.push({ taskId: row.taskId, artifact: row.artifact, publicInput });
  }
  return witnesses;
}

/** Aggregate failing-check concentration: which of the brief's own declared truth-checks reject
 *  the reference solve, and how often. Check names are Builder-authored, so aggregate counts
 *  can identify the affected checks while per-task results remain protected.
 *  The Builder receives no task identities or tool output from this projection. */
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

/** Every representation-defect detail comes off the submission path before verification, classified
 *  generated-toolset-contract: it describes the public authoring interface (writer schema,
 *  DraftStore, submit), which can be reported to the Builder. Run w12 showed why a count was not
 *  enough: iteration 47 cleared its defect in one pass with detail, 48-55 without took eight.
 *  Details are deduplicated with no task identities; the per-task join stays protected. */
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
    // How many failed solves the per-task wall stopped, so a slow search is not repaired as a
    // wrong one.
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
