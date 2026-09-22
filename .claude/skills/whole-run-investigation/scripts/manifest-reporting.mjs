// Report ownership and instructions, separated from the already-full manifest composer.
import { resolve } from "#src/meta/path.ts";
// The registry of diagnostic lanes and the deterministic views each one owns.
export const DIAGNOSTIC_INPUTS = new Map([
  ["category_and_hook_yield", ["timeline"]],
  ["diagnostic_follow_through", ["scan", "builder", "review-yield"]],
]);

export function diagnosticTaskLines(name) {
  const inputs = DIAGNOSTIC_INPUTS.get(name);
  return inputs
    ? [
        `assignedDiagnosticInputs: ${inputs.join(",")}`,
        "Give every assigned input exactly one table row: | input | disposition | reason and evidence |.",
        "Use the exact input label and investigate, no-action or unobservable. No blank reasons; missing inputs are unobservable, never omitted.",
        "The collector checks coverage only. Justify no-action from contents, and connect each investigation to its consumer and next decision.",
      ]
    : [];
}

export function snapshotLines(snapshot, sessions) {
  const owner = (label) =>
    [...DIAGNOSTIC_INPUTS].find(
      ([session, inputs]) =>
        sessions.some((selected) => selected.name === session) &&
        inputs.some((input) => label === input || label === `${snapshot.runId}-${input}`),
    )?.[0] ?? "primary";
  return [
    "## Snapshot directory",
    "",
    `\`${snapshot.dir}\` holds these views. Every view has one triage owner; shared reading is allowed.`,
    "",
    "| view | captured status | triage owner |",
    "|---|---|---|",
    ...snapshot.status.views.map((view) => `| \`${view.file}\` | ${view.status} | ${owner(view.label)} |`),
    "",
    "The primary records a disposition for every primary-owned view and reconciles the specialists' input dispositions.",
    "An unavailable view is an evidence gap. A readable view is not a clean verdict; inspect its contents.",
    "",
    "If angle 15 is assigned, its task carries the private trace-challenge path. Other sessions must not read or receive that packet.",
    ...(snapshot.failedViews.length > 0
      ? [
          "Unavailable views, not empty. Each failed when the snapshot was taken; the captured error is quoted so",
          "you do not spend time rediscovering it. Settle what depends on it from the recorded bytes instead.",
          ...snapshot.failedViews.map((view) => `- \`${view.label}\` (${view.status}): ${view.error}`),
        ]
      : []),
    "",
    "Read the snapshot first, except for a public-first independent challenge: freeze its public derivation before reading verdicts or verifier material. Refresh only assigned views.",
  ];
}

export function reportingLines() {
  return [
    "## Reporting rules",
    "",
    `Review procedure: \`${resolve(import.meta.dir, "..", "SKILL.md")}\`; the inline assignment carries your selected lane body.`,
    "If skill loading is required, use that procedure, not the product checkout's historical WRI catalogue. Do not repeat primary preflight or read other lane bodies.",
    "",
    "Every total carries its own reported/from denominator. Reconcile hand-derived counts against",
    "the default view; report a disagreement as the finding. Missing stays missing, never zero. Use",
    "the archive states `pending`, `pass`, `fail`, `N/A`, `stale`, `unobservable`; unobservable is",
    "never a pass. Write one clearly separated section per assigned session. Put findings first, each",
    "with verdict (defect | risk | fine), one owner, evidence path and denominator; then what the run",
    "proved, left unproved and what you did not inspect. Never quote protected verifier detail:",
    "stdout/stderr, issue/remedy text, generated counterexamples, reference artifacts or per-task",
    "failure locations. Safe totals and evidence paths only.",
    "",
  ];
}
