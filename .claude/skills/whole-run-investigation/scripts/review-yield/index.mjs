// Review-component yield: did each advisory Review component change a controller decision that
// recorded bytes show? One module per component (Repair Engineer, Progress Guard chain, Judge Prompt
// Maintainer, Epoch Reviewer) returns rows and a verdict; this file joins them into the snapshot
// view `review-yield.json` and a short table the primary reviewer reads before angles 3, 9, 25 and
// 26. It reads campaign JSON only and executes nothing.
import { collect as repairEngineer } from "./repair-engineer.mjs";
import { collect as progressGuard } from "./progress-guard.mjs";
import { collect as judgePromptMaintainer } from "./judge-prompt-maintainer.mjs";
import { collect as epochReviewer } from "./epoch-reviewer.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isString } from "#src/meta/json-shape.ts";

export const REVIEW_YIELD_SCHEMA = "wri-review-yield-report/v1";
const VERDICTS = new Set([
  "no-opportunity",
  "not-consumed",
  "advisory-only",
  "decision-bearing",
  "unobservable",
  "component-absent",
]);
const COMPONENTS = [
  ["repair-engineer", repairEngineer, "angles 3 and 9"],
  ["progress-guard", progressGuard, "row B"],
  ["judge-prompt-maintainer", judgePromptMaintainer, "angle 25"],
  ["epoch-reviewer", epochReviewer, "angle 26"],
];

function counts(summary) {
  const keys = ["iterations", "opportunities", "outputs", "consumed", "changed"];
  const out = {};
  for (const key of keys) out[key] = Number.isInteger(summary?.[key]) ? summary[key] : null;
  return out;
}

/** One component's result, or a typed failure row; a module that throws must not hide the others. */
function componentReport(name, collect, readBy, campaignDir) {
  try {
    const result = collect(campaignDir);
    const verdict = VERDICTS.has(result?.verdict) ? result.verdict : "invalid";
    return {
      component: name,
      readBy,
      status: verdict === "invalid" ? "invalid" : "ok",
      verdict,
      summary: counts(result?.summary),
      reasons: Array.isArray(result?.reasons) ? result.reasons.filter((r) => isString(r)).slice(0, 12) : [],
      runs: Array.isArray(result?.runs) ? result.runs : [],
    };
  } catch (error) {
    return {
      component: name,
      readBy,
      status: "failed",
      verdict: "invalid",
      summary: counts(null),
      reasons: [errorMessage(error)],
      runs: [],
    };
  }
}

export function buildReviewYield(campaignDir) {
  const components = COMPONENTS.map(([name, collect, readBy]) =>
    componentReport(name, collect, readBy, campaignDir),
  );
  return {
    schema: REVIEW_YIELD_SCHEMA,
    campaign: campaignDir,
    components,
    complete: components.every((row) => row.status === "ok"),
  };
}

/** The table the primary reviewer reads: one line per component, counts before verdicts. */
export function renderReviewYield(report) {
  const lines = [
    "| component | read first by | iterations | opportunities | outputs | consumed | changed | verdict |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of report.components) {
    const s = row.summary;
    const cell = (value) => (value === null ? "?" : String(value));
    lines.push(
      `| ${row.component} | ${row.readBy} | ${cell(s.iterations)} | ${cell(s.opportunities)} | ${cell(s.outputs)} | ${cell(s.consumed)} | ${cell(s.changed)} | ${row.status === "ok" ? row.verdict : row.status} |`,
    );
  }
  for (const row of report.components) {
    for (const reason of row.reasons) lines.push(`- ${row.component}: ${reason}`);
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const index = Bun.argv.indexOf("--campaign");
  const campaignDir = index === -1 ? null : (Bun.argv[index + 1] ?? null);
  if (campaignDir === null) {
    console.error("usage: review-yield/index.mjs --campaign <absolute campaign dir> [--json]");
    process.exit(2);
  }
  const report = buildReviewYield(campaignDir);
  console.log(Bun.argv.includes("--json") ? JSON.stringify(report, null, 2) : renderReviewYield(report));
}
