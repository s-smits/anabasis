// The report contract every lane writes to and the validator reads back, kept beside the snapshot
// and reporting instructions so the composer and the validator cannot drift apart.
import { resolve } from "#src/meta/path.ts";
import { PUBLIC_ONLY_LANE, TRACE_CHALLENGE_LANE } from "./catalogue-shape.mjs";

/** The `###` subsections every lane section carries, each exactly once, in this order. */
export const REPORT_SECTIONS = ["Started from", "Evidence read", "Findings", "Not established"];

/** Owners a finding may name: the controller's closed `FeedbackOwner` set, plus the two the lane
 *  table routes to and the controller cannot (`controller-source`, `judge`). */
export const FINDING_OWNERS = [
  "brief",
  "tests",
  "instructions",
  "tools-spec",
  "accept-controls",
  "controls",
  "correctness-model",
  "fingerprint",
  "environment",
  "controller-source",
  "judge",
];

export function reportSectionLines() {
  return [
    `Under each of your \`## lane_NN\` headings write these \`###\` subsections, each exactly once and in this order: ${REPORT_SECTIONS.map((section) => `\`### ${section}\``).join(", ")}.`,
    "`### Started from` names the deterministic trigger the lane started from, quoted from the assignment.",
    "`### Evidence read` lists every evidence path you read, one per line.",
    "`### Findings` holds either the single word `none` or one entry per finding, each carrying a line",
    `\`owner: <owner>\` where the owner is one of ${FINDING_OWNERS.join(", ")}; an entry without an owner is rejected at collection.`,
    "`### Not established` states what the lane could not settle and why, and is never empty.",
  ];
}

export function snapshotLines(snapshot) {
  return [
    "## Snapshot directory",
    "",
    `\`${snapshot.dir}\` holds these views. The primary reviewer triages every view; lanes read them.`,
    "",
    "| view | captured status |",
    "|---|---|",
    ...snapshot.status.views.map((view) => `| \`${view.file}\` | ${view.status} |`),
    "",
    "An unavailable view is an evidence gap. A readable view is not a clean verdict; inspect its contents.",
    "",
    `If lane ${TRACE_CHALLENGE_LANE} is assigned, its task carries the private trace-challenge path. Other sessions must not read or receive that packet.`,
    ...(snapshot.failedViews.length > 0
      ? [
          "Unavailable views, not empty. Each failed when the snapshot was taken; the captured error is quoted so",
          "you do not spend time rediscovering it. Settle what depends on it from the recorded bytes instead.",
          ...snapshot.failedViews.map((view) => `- \`${view.label}\` (${view.status}): ${view.error}`),
        ]
      : []),
    "",
    `Read the snapshot first, except for lane ${PUBLIC_ONLY_LANE}: it freezes its public-only corpus before reading verdicts or verifier material. Refresh only assigned views.`,
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
    "never a pass. Write one clearly separated section per assigned lane. Each finding carries a",
    "verdict (defect | risk | fine), one owner, an evidence path and a denominator. Never quote",
    "protected verifier detail: stdout/stderr, issue/remedy text, generated counterexamples,",
    "reference artifacts or per-task failure locations. Safe totals and evidence paths only.",
    "",
    ...reportSectionLines(),
    "",
  ];
}
