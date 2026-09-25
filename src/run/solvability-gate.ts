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
 *
 */
// Gate audit 2026-09-25 (docs/gate-audit.md, representation-blocking): commented out (unsure): the representation census no longer refuses adoption
//  * The representation census reuses these same witnesses without a second execution, looking for
//  * copied public inputs and repeated absence spellings. Those are two bounded checks, not a general
//  * proof that the tasks require domain skill, and their findings describe authored structures
//  * without quoting protected verifier evidence. BLOCKING_CODES in that module decides which of them
//  * refuse adoption, from its own recorded calibration; this gate only routes them at the severity
//  * they declare.
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
import { type Witness, inputInsensitivity } from "./representation-census.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, representation-blocking): commented out (unsure): the census and its severity set
// import { BLOCKING_CODES, censusRepresentation } from "./representation-census.ts";
import { loadRecordedTasks } from "./run-driver.ts";
import { SOURCE_IDENTITY } from "./source-identity.ts";
import { BRIEF_FILE, EVALUATOR_FILE, GENERATED_TOOLS_FILE } from "../meta/bundle-layout.ts";
import { REFERENCE_SOLVE_ENTRY, REFERENCE_SOLVE_ENTRY_SOLVE } from "../truth/evaluator-process-bundle.ts";

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
    // Gate audit 2026-09-25 (docs/gate-audit.md, representation-blocking): commented out (unsure): the census over the passed witnesses
    // // The compiled public artifact schema goes to the census so its absence rule can tell a
    // // declared closed state ("none" among a field's allowedValues) from an invented sentinel.
    // const representation = censusRepresentation(passed, harness.publicArtifactSchema);
    const independence = acceptControlIndependence(slugDir, passed);
    await Bun.write(
      join(iterationDir, SOLVABILITY_EVIDENCE_FILE),
      capturedJsonStringify(
        {
          evidence,
          findings: probedFindings,
          // Gate audit 2026-09-25 (docs/gate-audit.md, representation-blocking): commented out (unsure): the census's recorded observations
          // representation: representation.observations,
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
    return [
      ...censusFeedback(evidence, insensitivity),
      // Gate audit 2026-09-25 (docs/gate-audit.md, representation-blocking): commented out (unsure): the census's refusal row
      // ...representationFeedback(representation.findings),
      ...acceptIndependenceFeedback(independence),
      ...toolRefusals,
    ];
  };
}

// Gate audit 2026-09-25 (docs/gate-audit.md, representation-blocking): commented out (unsure): the census's refusal row, blocking or advisory by BLOCKING_CODES
// /**
//  * The Builder authors the artifactSchema and the public structures the census compares, so these
//  * findings may describe those observations without quoting protected verifier evidence. They are
//  * grouped by severity so that an advisory finding cannot inherit a blocking row's effect; the
//  * census defines which codes block and this function only applies that classification.
//  *
//  * A blocking finding refuses adoption and returns to the Builder for repair through the submit
//  * path, while advisory findings stay recorded without causing a refusal. Neither is the measured
//  * admission packet that later controller decisions read — that has its own evidence and projection
//  * rules.
//  */
// function representationFeedback(findings: ContractFinding[]): CampaignFeedback[] {
//   const severities = [
//     { severity: "blocking", rows: findings.filter((f) => BLOCKING_CODES.has(f.code)) },
//     { severity: "advisory", rows: findings.filter((f) => !BLOCKING_CODES.has(f.code)) },
//   ] as const;
//   return severities
//     .values()
//     .filter(({ rows }) => rows.length > 0)
//     .map(
//       ({ severity, rows }): CampaignFeedback => ({
//         owner: "brief",
//         severity,
//         claim: `representation census: ${rows.length} artifact schema finding(s) that hold on every authored task`,
//         evidence: "pre-adoption representation census over the F2 reference witnesses",
//         findings: controllerValidatedFindings(rows),
//       }),
//     )
//     .toArray();
// }

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

// Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
// // A check grounded only by a script the author wrote into `.toolchain` measures agreement with
// // that script and nothing else, so a battery that passes every task under one has measured the
// // author against itself. This row and the one below sat beside the missing-tool row in a
// // code-to-owner table; restoring either restores that table.
// [
//   "solvability-tool-self-authored",
//   "brief",
//   () =>
//     "installed tools: an external check is grounded only by a script under the candidate's own tool tree, so a battery would measure that script's agreement with itself",
// ],
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
// [
//   "solvability-tool-program-argument",
//   "brief",
//   () =>
//     "installed tools: an external check hands its program to the tool as an argument, so the attested tool is only an interpreter and a battery would measure the candidate's own checker",
// ],

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

// Gate audit 2026-09-25 (docs/gate-audit.md, f2-reference-verdict): kept: it names which declared checks reject the reference solve, counts over public identities that say where to repair
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

// Gate audit 2026-09-25 (docs/gate-audit.md, f2-representation-defect): kept: a reference answer the writer, DraftStore or submit path cannot carry is a representation defect every solve would meet
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

function censusFeedback(
  evidence: Pick<SolvabilityEvidence, "cases"> | null,
  insensitivity: ContractFinding[],
): CampaignFeedback[] {
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-environment): kept: a census the host could not execute is an environment non-result, never a verdict on the candidate
  if (evidence === null) {
    return [
      {
        owner: EVALUATOR_FILE,
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
    (row) => row.status === "failed" && row.failure === "representation-defect",
  ).length;
  const failed = cases.filter(
    (row) => row.status === "failed" && row.failure !== "representation-defect",
  ).length;
  const nonResults = cases.filter((row) => row.status === "non-result").length;
  const feedback: CampaignFeedback[] = [];
  // Gate audit 2026-09-25 (docs/gate-audit.md, tool-environment): kept: a reference solve the host could not run is an environment non-result, never a verdict on the candidate
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
  // Gate audit 2026-09-25 (docs/gate-audit.md, f2-reference-verdict): kept: a battery the candidate's own reference solve cannot pass would measure the checks rather than the solver
  if (failed > 0) {
    // How many of the failed solves the per-task wall stopped, stated separately so a slow search
    // is not repaired as a wrong one.
    const timedOut = cases.filter((row) => row.status === "failed" && referenceSolveTimedOut(row)).length;
    const wall =
      timedOut === 0
        ? ""
        : `, and ${timedOut} of those stopped at the per-task reference solve wall before returning an artifact`;
    feedback.push({
      owner: REFERENCE_SOLVE_ENTRY,
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
