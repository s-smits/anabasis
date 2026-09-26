// The gate components a submit or a correctness_check can refuse with, each with the confidence the
// gate audit of 2026-09-25/26 put on it, and the finding codes by which recorded evidence names it.
//
// The priors are judgements, not measurements. `pRight` is how likely a firing refuses something
// actually wrong and `pStall` how likely it blocks a legitimate advance. The bar for a refusal is
// `pRight` at or above `REFUSAL_BAR` with `pStall` near zero, which is the gate audit's own
// question. A readout or advice scores `pStall` 0 by construction, and a component the audit never
// scored carries null rather than a guess.
//
// `codes` are the codes the component emits in source now, and `retired` the ones it emitted
// before the audit narrowed, rewrote or deleted it. The `gates` lane reads runs recorded on both
// sides of the audit, so a retired code still names its component, and `test/wri-gate-rent.test.ts`
// holds both lists to the source in both directions. Lane 27 compares a row's prior against what
// the recorded firings did and says which way the evidence moves it; a changed prior is an edit
// here, dated in `LEDGER_DATE`, with the evidence in the commit.
//
// Codes are matched exactly. A code no row, qualifier or unscored entry names is reported as
// unledgered, which is a gap in this table rather than a verdict on the refusal.

export const LEDGER_DATE = "2026-09-26";
/** The refusal bar the gate audit applied: at least this sure a firing refuses something wrong. */
export const REFUSAL_BAR = 0.98;

/**
 * Codes that ride beside another component's code on the same refusal and add detail to it, each
 * with the components it rides beside. On a receipt that also names one of those components, the
 * qualifier is that component's detail and no firing of its own; anywhere else it is counted
 * under its own row.
 */
export const QUALIFIERS = new Map([
  [
    "tool-timeout",
    { beside: ["CT-3", "GR-2"], reason: "the tool-run detail of a no-verdict or a census wall" },
  ],
  ["SOLVABILITY_CENSUS_BLOCKED", { beside: ["F2-1"], reason: "the census half of an F2 verdict refusal" }],
  [
    "SOLVABILITY_FAILURE_CONCENTRATION",
    { beside: ["F2-1"], reason: "the per-family breakdown of an F2 refusal" },
  ],
  [
    "SOLVABILITY_REPRESENTATION_DEFECT_DETAIL",
    { beside: ["F2-2"], reason: "the per-task detail of a representation defect" },
  ],
  [
    "REFERENCE_SOLVE_IGNORES_PUBLIC_INPUT",
    { beside: ["F2-1"], reason: "the input-blind note beside an F2 verdict refusal" },
  ],
]);

const BRIEF = "brief validation: a brief the pipeline cannot parse stops before any audited gate";
const CONTROLS = "control-corpus validation: the corpus cannot bind to the tasks and checks it names";
const PROBE = "conformance probe: the generated modules or tools cannot load, register or answer";
const SNAPSHOT = "F2 snapshot integrity: the frozen bundle does not match itself, never an author choice";
const BOUNDARY = "author-boundary spelling of an unclassified or unvalidated finding, not a gate";

/** One ledger row: its identity `[code, id, form]`, its priors `[pRight, pStall]`, the codes it
 *  emits now and the codes it emitted before the audit changed it. The form is one of kept,
 *  narrowed, rewritten, deleted, ceiling, readout or pre-audit (removed before the audit scored
 *  it). */
const row = ([code, id, form], [pRight, pStall], codes, basis, retired = []) => ({
  code,
  id,
  form,
  pRight,
  pStall,
  codes,
  retired,
  basis,
});

export const GATE_LEDGER = [
  // SH: bundle and task shape
  row(["SH-1", "bundle-shape", "kept"], [0.98, 0.02], ["shape-mismatch"], "structural contradiction"),
  row(
    ["SH-2", "task-shape", "narrowed"],
    [0.98, 0.02],
    [
      "tasks-shape",
      "tasks-duplicate-id",
      "tasks-id-unsafe",
      "tasks-hidden-operand-missing",
      "tasks-hidden-operand-unexpected",
      "tasks-no-applicable-checks",
      "tasks-public-rule-path-missing",
      "tasks-undeclared-check",
      "tasks-duplicate-expectation-check",
    ],
    "colliding ids and missing operands break later stages; the family-unbound branch was removed",
    ["tasks-check-family-unbound"],
  ),
  row(
    ["SH-3", "task-count", "kept"],
    [0.99, 0.01],
    ["tasks-empty", "tasks-exact-census"],
    "size is a code-owned condition",
  ),
  row(
    ["SH-4", "harness-config", "kept"],
    [0.98, 0.02],
    ["harness-config-invalid", "tools-files-preset-artifact-root"],
    "the host refuses the same walls at run time",
  ),
  row(
    ["SH-5", "tools-spec-structure", "kept"],
    [0.98, 0.02],
    [
      "tools-artifact-writer-missing",
      "tools-name-taken",
      "tools-preset-unknown",
      "tools-reserved-controller-name",
      "tools-shell-preset-overlap",
    ],
    "a roster that cannot register cannot run",
    ["tools-data-reader-state"],
  ),
  row(
    ["SH-6", "accept-schema", "kept"],
    [0.98, 0.01],
    ["controls-accept-off-schema", "controls-accept-public-schema-inconsistent"],
    "an accept off the schema calibrates nothing",
  ),
  row(
    ["SH-7", "experiment-plan-schema", "kept"],
    [0.98, 0.02],
    ["experiment-plan-schema", "experiment-proposal-read", "experiment-proposal-shape"],
    "a plan the controller cannot score",
  ),
  // ID: identity and condition
  row(
    ["ID-1", "tool-identity", "kept"],
    [0.99, 0.01],
    [
      "tool-id-invalid",
      "tool-missing",
      "census-tool-missing",
      "solvability-tool-missing",
      "SOLVABILITY_TOOL_MISSING",
    ],
    "an uninstalled tool cannot run",
  ),
  row(
    ["ID-2", "bundle-walls", "narrowed"],
    [0.98, 0.03],
    [
      "builtin-import",
      "correctness-model-capability-escape",
      "cross-isolation-import",
      "escape-import",
      "key-material-file",
      "missing-bundle",
      "non-regular-entry",
      "unvetted-import",
    ],
    "the walls keep hidden data out of the agent side",
  ),
  row(
    ["ID-3", "condition-identity", "kept"],
    [0.99, 0.01],
    ["generated-toolset-termination", "task-worker-binding-drift", "verifier-condition-drift"],
    "binding is exact; host condition drift now belongs to the environment",
  ),
  // F2: reference solve
  row(
    ["F2-1", "f2-reference-verdict", "kept"],
    [0.97, 0.03],
    [
      "SOLVABILITY_CENSUS_BLOCKED",
      "SOLVABILITY_FAILURE_CONCENTRATION",
      "solvability-failed",
      "solvability-witness-failed",
      "no-solvability-witness",
    ],
    "about 35 recorded firings, each repaired within one or two checks",
  ),
  row(
    ["F2-2", "f2-representation-defect", "narrowed"],
    [0.95, 0.05],
    [
      "SOLVABILITY_REPRESENTATION_DEFECT",
      "SOLVABILITY_REPRESENTATION_DEFECT_DETAIL",
      "solvability-representation-defect",
      "representation-defect",
    ],
    "the removed absence-spelling branch caused the one recorded loop",
  ),
  row(
    ["F2-3", "representation-blocking", "kept"],
    [0.5, 0.4],
    ["REFERENCE_SOLVE_IGNORES_PUBLIC_INPUT"],
    "the audit deleted it as a shape heuristic, but the census still emits the input-blind finding",
    ["ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT", "REFERENCE_ANSWER_SPELLS_ABSENCE"],
  ),
  row(["F2-4", "f2-witness-relay", "rewritten"], [0.98, 0.02], [], "became R1 grounded-verdict", [
    "generated-correctness-model-relay",
    "TASK_FAMILY_BINDING_UNPROVEN",
  ]),
  // CT: controls and census
  row(
    ["CT-1", "expected-check-inapplicable", "kept"],
    [0.99, 0.01],
    ["controls-expected-check-inapplicable"],
    "a reject that cannot fail calibrates nothing",
  ),
  row(
    ["CT-2", "accept-control-rejected", "kept"],
    [0.97, 0.03],
    ["DISCRIMINATION_ACCEPT_REJECTED", "DISCRIMINATION_CONTROL_RECEIPT_INVALID"],
    "29 recorded firings, repaired within one to three checks",
  ),
  row(
    ["CT-3", "controls-no-verdict", "narrowed"],
    [0.9, 0.05],
    ["DISCRIMINATION_PROBE_NO_VERDICT", "DISCRIMINATION_NOT_PROVEN", "verifier-tool-refused", "tool-timeout"],
    "every recorded firing was a timeout, which is sometimes the tool's cost rather than the author's",
  ),
  row(["CT-4", "reject-discrimination", "rewritten"], [0.95, 0.03], [], "became R2"),
  row(
    ["CT-5", "public-rule-control-coverage", "rewritten"],
    [0.9, 0.05],
    [],
    "became R2; the per-cell accept requirement was deleted",
    ["controls-public-rule-negative-missing", "controls-public-rule-positive-missing"],
  ),
  // GR: grounding and tool evidence
  row(
    ["GR-1", "external-result-unbound", "kept"],
    [0.98, 0.02],
    ["EXTERNAL_RESULT_UNBOUND"],
    "a verdict returned before its own tool run finished",
  ),
  row(
    ["GR-2", "tool-environment", "kept"],
    [0.98, 0.01],
    ["SOLVABILITY_CENSUS_UNAVAILABLE", "solvability-non-result", "census-wall-exceeded"],
    "environment-owned; host failures are no longer charged to the author",
  ),
  row(
    ["GR-3", "measure-grounding", "rewritten"],
    [0.98, 0.02],
    ["external-check-tool-unlaunched"],
    "the per-case half became R1",
    ["external-grounding-case-uncovered"],
  ),
  row(["GR-4", "tool-program-argument", "deleted"], [0.3, 0.5], [], "Builders moved to -m and script paths", [
    "solvability-tool-program-argument",
  ]),
  row(["GR-5", "tool-self-authored", "deleted"], [0.4, 0.4], [], "missed the wrapper shape", [
    "solvability-tool-self-authored",
  ]),
  row(["GR-6", "census-inert-tool", "deleted"], [0.7, 0.2], [], "readiness still bounds the claim"),
  row(
    ["GR-7", "census-grounding-owed", "rewritten"],
    [0.85, 0.1],
    [],
    "every recorded firing was a timeout; the zero-run half became R1",
    ["generated-external-grounding-unexecuted"],
  ),
  // BR: brief and operating guide
  row(
    ["BR-1", "operating-guide-retired-tool", "deleted"],
    [0.4, 0.3],
    [],
    "weak witness; solve traces show refused calls",
  ),
  row(
    ["BR-2", "operating-guide-policy", "narrowed"],
    [0.99, 0.01],
    ["operating-guide-shape"],
    "narrowed to an empty or placeholder guide; the cap forced rewording",
    ["operating-guide-task-identifier"],
  ),
  row(["BR-4", "published-rules", "narrowed"], [0.95, 0.03], [], "R3 keeps only the withheld-citation half", [
    "brief-rule-unpublished",
  ]),
  row(
    ["BR-5", "brief-constant-uncited", "deleted"],
    [0.2, 0.3],
    [],
    "a non-empty string proves no sourcing",
    ["brief-constant-uncited"],
  ),
  row(
    ["BR-6", "brief-join-no-decoys", "kept"],
    [0.1, 0.3],
    ["brief-duplicate-decoy-class"],
    "the audit deleted it because nothing reads decoyClasses, but the brief validator still refuses",
  ),
  row(
    ["BR-7", "agent-deciding-computation", "deleted"],
    [0.3, 0.6],
    [],
    "four recorded firings, each dodged by renaming or moving code",
    ["agent-carries-deciding-computation"],
  ),
  // DF: difficulty, task set and admission
  row(
    ["DF-2", "candidate-zero-verified", "readout"],
    [null, 0],
    ["candidate-zero-verified"],
    "a label; the claim refusal holds regardless",
  ),
  row(["DF-3", "repeated-public-condition", "deleted"], [0.05, 0.5], [], "repeat is a legitimate operation", [
    "climb-battery-repeats-history",
  ]),
  row(["DF-4", "product-repair-required", "deleted"], [0.05, 0.6], [], "routing is advice", [
    "experiment-product-repair-required",
  ]),
  row(["DF-5", "task-variation", "deleted"], [0.2, 0.4], [], "declared variation is not demand", [
    "tasks-structural-variation-shortfall",
    "task-curriculum",
  ]),
  // LP: loop ceilings and session
  row(
    ["LP-3", "noop-submit-strike", "ceiling"],
    [0.99, 0.01],
    ["authoring-noop-submit", "authoring-stalled"],
    "the same refused bytes cannot change",
  ),
  row(
    ["LP-4", "unchanged-candidate-strike", "ceiling"],
    [0.97, 0.02],
    ["candidate-unchanged"],
    "a rebuild with nothing new",
  ),
  row(
    ["LP-9", "repeated-findings-stall", "deleted"],
    [0.4, 0.4],
    [],
    "the deepest recorded refused run was 4",
    ["authoring-repeated-findings"],
  ),
  row(["LP-10", "tool-non-result-ceiling", "deleted"], [0.3, 0.5], [], "non-results are the environment's", [
    "tool-non-result-repeat",
    "tool-non-result-ceiling",
  ]),
  row(["LP-11", "preview-attempt-spent", "deleted"], [0.1, 0.7], [], "refused a retry rule 14 requires", [
    "preview-attempt-spent",
  ]),
  // R: the refusals the audit rewrote, under the codes they emit now
  row(
    ["R1", "grounded-verdict", "rewritten"],
    [0.98, 0.02],
    ["EXTERNAL_VERDICT_UNGROUNDED"],
    "one grounding rule across F2, census and battery",
  ),
  row(
    ["R2", "every-check-rejects", "rewritten"],
    [0.95, 0.03],
    ["DISCRIMINATION_REJECT_PASSED", "DISCRIMINATION_CHECK_UNREJECTED"],
    "a reject that passes, or a check no reject names, proves no discrimination",
  ),
  row(
    ["R3", "declared-means-graded", "rewritten"],
    [0.98, 0.02],
    ["brief-artifact-root-unread", "brief-cited-decision-withheld"],
    "a declared root no check reads; a citation the solver cannot read",
  ),
  // Removed before the audit scored them; recorded runs from then still name them.
  row(
    ["PRE-1", "experiment-change-unmoved", "pre-audit"],
    [null, null],
    [],
    "admission refusal, removed before the audit",
    ["experiment-change-unmoved"],
  ),
  row(
    ["PRE-2", "experiment-scope-mismatch", "pre-audit"],
    [null, null],
    [],
    "admission refusal, removed before the audit",
    ["experiment-scope-mismatch"],
  ),
  row(
    ["PRE-3", "transplant-census", "pre-audit"],
    [null, null],
    [],
    "removed 2026-09-25 (AGENTS.md rule 12)",
    ["TASK_FAMILY_UNIVERSAL_WITNESS"],
  ),
];

/**
 * Codes the gate emits that no ledger row scores, each with the reason it is not one. These are
 * validators that come before any audited component: a candidate refused by one of them has no
 * parsed contract for an audited gate to judge, so the audit's question does not apply to them.
 */
export const DELIBERATELY_UNLEDGERED = new Map([
  ...[
    "brief-artifact-field-allowed-values-invalid",
    "brief-artifact-field-unaddressable",
    "brief-check-artifact-root-undeclared",
    "brief-check-join-undeclared",
    "brief-check-path-invalid",
    "brief-decision-undeclared-field",
    "brief-design-rule-constant-name-empty",
    "brief-duplicate-artifact-field",
    "brief-duplicate-check-id",
    "brief-duplicate-decision-id",
    "brief-duplicate-design-rule-constant",
    "brief-duplicate-join-id",
    "brief-no-artifact-schema",
    "brief-no-truth-checks",
    "brief-numeric-boundary-constant-invalid",
    "brief-numeric-boundary-duplicate",
    "unsupported-correctness-contract",
  ].map((code) => [code, BRIEF]),
  ...[
    "controls-accept-duplicate-id",
    "controls-boundary-check-mismatch",
    "controls-boundary-join-witness-overloaded",
    "controls-duplicate-id",
    "controls-hidden-duplicate-check",
    "controls-hidden-on-nonhidden-check",
    "controls-join-check-mismatch",
    "controls-no-accept",
    "controls-reject-unknown-check",
    "controls-unknown-join",
    "controls-unknown-task",
  ].map((code) => [code, CONTROLS]),
  ...[
    "empty-green-submit",
    "generated-correctness-model-throws",
    "generated-module-contract",
    "generated-module-load",
    "generated-module-types",
    "generated-toolset-arguments-invalid",
    "generated-toolset-throws",
    "generated-toolset-unprobed",
    "reference-solve-entry-missing",
    "submit-public-schema-rejected",
    "task-public-path-absent",
    "tools-contract-mismatch",
    "tools-description-drift",
    "vacuous-submitted",
    "solvability-correctnessModel-load",
    "solvability-public-schema-invalid",
  ].map((code) => [code, PROBE]),
  ...[
    "solvability-bundleSnapshot-contract-invalid",
    "solvability-bundleSnapshot-drift",
    "solvability-bundleSnapshot-integrity",
    "solvability-task-set-unbound",
  ].map((code) => [code, SNAPSHOT]),
  ["generated-execution-unclassified", BOUNDARY],
  ["missing-bundle-file", "bundle assembly: a required file is absent, so nothing downstream can run"],
  ["vendor-shadowed", "census gate: a vendored path the toolchain shadows, a host-layout fact"],
]);

/**
 * Components that act on the round or the run rather than on one candidate's bytes, found in the
 * session record or the controller terminal rather than in a finding code. `terminal` is the
 * leading word of the controller's terminal reason; `hold` is the submit receipt's reason.
 */
export const LOOP_LEDGER = [
  {
    ...row(
      ["LP-1", "build-failed-ceiling", "ceiling"],
      [0.9, 0.1],
      [],
      "the held path was the problem; R4 rewrote it",
    ),
    terminal: "build-failed",
  },
  {
    ...row(
      ["LP-2", "environment-blocked-ceiling", "ceiling"],
      [0.99, 0.01],
      [],
      "stop spending on a dead provider",
    ),
    terminal: "environment-blocked",
  },
  {
    ...row(
      ["LP-6", "review-unread-hold", "kept"],
      [0.9, 0.05],
      [],
      "chains of up to 4 holds; consider holding only on blocking findings",
    ),
    hold: "review-unread",
  },
  {
    ...row(["LP-8", "held-candidate-ceiling", "rewritten"], [0.8, 0.2], [], "became R4 held-rounds"),
    terminal: "candidate-held",
  },
  {
    ...row(
      ["DF-6", "off-aim-allowance-stop", "deleted"],
      [0.5, 0.5],
      [],
      "stopped campaigns that might have climbed",
    ),
    terminal: "stopped",
    reason: /off-aim allowance/,
  },
];

const BY_CODE = new Map(
  GATE_LEDGER.flatMap((entry) => [...entry.codes, ...entry.retired].map((code) => [code, entry])),
);

/** The ledger row naming a finding code, current or retired, or null when none does. */
export function componentOf(code) {
  return BY_CODE.get(code) ?? null;
}

/** The loop component a controller terminal reason names, or null. The reason's leading word is
 *  the terminal code (`stopped: …`), and a row with `reason` also requires the text to match. */
export function terminalComponent(reason) {
  if (typeof reason !== "string") return null;
  const code = reason.split(":")[0]?.trim() ?? "";
  return LOOP_LEDGER.find((entry) => entry.terminal === code && (entry.reason?.test(reason) ?? true)) ?? null;
}

export function holdComponent(reason) {
  return LOOP_LEDGER.find((entry) => entry.hold === reason) ?? null;
}

/** Whether a prior clears the refusal bar; null when the audit gave none. */
export function clearsBar(entry) {
  return entry.pRight === null ? null : entry.pRight >= REFUSAL_BAR;
}
