/**
 * One Markdown overview of what a finished run actually did: the loop's decisions, each model
 * activity and how often it occurred, the Built agent's tool use, Judge and Guard outcomes, and,
 * when the run captured NODE_V8_COVERAGE, which host functions executed. A commit range turns
 * "did this PR's code run?" into a table.
 *
 *   bun run triage -- --run-dir /abs/run-worktree [--slug s] [--range a..b] [--coverage dir] [--out f.md]
 */
import { writeFileSync } from "../../src/meta/filesystem.ts";
import { basename, resolve } from "../../src/meta/path.ts";
import { type ChangedFn, type FnCount, diffIntersection, readV8Coverage } from "./coverage.ts";
import {
  type ActivityCount,
  type AnalysisEvidence,
  type BatteryInfo,
  runCampaignDir,
  loopNarrative,
  observabilityCensus,
  readAnalysis,
  readBatteries,
  readRunLog,
  toolCallCensus,
} from "./evidence.ts";

interface Args {
  runDir: string;
  slug: string | undefined;
  range: string | undefined;
  coverage: string | undefined;
  out: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const take = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const runDir = take("--run-dir");
  if (runDir === undefined) throw new Error("--run-dir is required");
  return {
    runDir: resolve(runDir),
    slug: take("--slug"),
    range: take("--range"),
    coverage: take("--coverage"),
    out: take("--out"),
  };
}

const fence = (rows: string[]): string[] => ["```text", ...rows, "```"];

/** Double-quoted with its four escapes, which bash and zsh read identically. */
function quoteShell(value: string): string {
  const escaped = value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll('"', String.raw`\"`)
    .replaceAll("$", String.raw`\$`)
    .replaceAll("`", "\\`");
  return `"${escaped}"`;
}

function solLaunchEnvironment(coverageDir: string): string {
  const entries = [
    ["HOME", "/absolute/private-home"],
    ["CODEX_HOME", "/absolute/private-codex-home"],
    ["TMPDIR", "/absolute/private-tmp"],
    ["PATH", "/absolute/pinned-bun:/usr/bin:/bin"],
    ["CODEX_BUILDER_MODEL", "gpt-5.6-sol"],
    ["CODEX_BUILT_MODEL", "gpt-5.6-sol"],
    ["CODEX_REVIEW_MODEL", "gpt-5.6-sol"],
    ["CODEX_BUILDER_REASONING_EFFORT", "high"],
    ["CODEX_BUILT_REASONING_EFFORT", "high"],
    ["CODEX_REVIEW_REASONING_EFFORT", "medium"],
    ["NODE_V8_COVERAGE", coverageDir],
  ];
  return entries.map(([key, value]) => `--env ${quoteShell(`${key}=${value}`)}`).join(" ");
}

function timelineSection(runDir: string): string[] {
  const log = readRunLog(runDir);
  if (log.length === 0) return ["## Timeline", "", "No `[fullrun]` log lines found.", ""];
  const rows = log.map((line, i) => {
    const prev = Date.parse(log[i - 1]?.at ?? line.at);
    const mins = ((Date.parse(line.at) - prev) / 60000).toFixed(1);
    return `${line.at}  (+${mins}m)  ${line.text.slice(0, 150)}`;
  });
  return ["## Timeline (run log)", "", ...fence(rows), ""];
}

function narrativeSection(camp: string): string[] {
  // The level and the state lead each line. Without them a failed step read as a finished one, an
  // opened span as a closed one, and c1d2a7's one error sat in 205 rows of ordinary progress.
  const rows = loopNarrative(camp).map(
    (r) =>
      `${r.level.padEnd(7)} ${r.kind.padEnd(6)} ${`${r.phase}${r.state === "" ? "" : `/${r.state}`}`.padEnd(20)} ${r.summary}`,
  );
  return ["## Controller timeline", "", ...fence(rows), ""];
}

/** A table's header row and the separator its own columns imply, so a column added to one of
 *  them cannot leave the other behind. */
function head(...columns: string[]): [string, string] {
  return [`| ${columns.join(" | ")} |`, `|${"---|".repeat(columns.length)}`];
}

function activitySection(activity: ActivityCount[]): string[] {
  const out = ["## Model activity by phase and role", ""];
  out.push(...head("stream", "kind", "phase", "role", "state", "level", "count"));
  for (const row of activity) {
    out.push(
      `| ${row.file} | ${row.kind} | ${row.phase} | ${row.role} | ${row.state} | ${row.level} | ${row.count} |`,
    );
  }
  out.push("");
  return out;
}

function batterySection(batteries: BatteryInfo[]): string[] {
  const out = ["## Batteries", ""];
  out.push(
    ...head(
      "runId",
      "cases",
      "pass",
      "no truth verdict",
      "non-results",
      "solver turns",
      "tool calls",
      "models",
    ),
  );
  for (const b of batteries) {
    const passed = b.cases.filter((c) => c.pass === true).length;
    const nulls = b.cases.filter((c) => c.truthOk === null).length;
    const nonResults = b.cases.filter((c) => c.nonResult !== null).length;
    const turns = b.cases.reduce((sum, c) => sum + c.turns, 0);
    const calls = b.cases.reduce((sum, c) => sum + c.toolCalls, 0);
    const models = [...b.models.entries()].map(([m, n]) => `${m}×${n}`).join(", ");
    out.push(
      `| ${b.runId} | ${b.cases.length} | ${passed} | ${nulls} | ${nonResults} | ${turns} | ${calls} | ${models} |`,
    );
  }
  out.push("");
  for (const b of batteries) {
    const census = [...toolCallCensus(b.dir).entries()].sort((x, y) => y[1].calls - x[1].calls);
    if (census.length === 0) continue;
    out.push(`### Built-agent tool use: ${b.runId}`, "");
    out.push(...head("tool", "calls", "errors"));
    for (const [tool, c] of census) out.push(`| ${tool} | ${c.calls} | ${c.errors} |`);
    out.push("");
  }
  return out;
}

function analysisSection(a: AnalysisEvidence): string[] {
  const out = ["## Claims", "", ...head("claim", "ok", "score", "model identity", "reasons held")];
  for (const c of a.claims) {
    out.push(
      `| ${c.name} | ${c.ok} | ${c.passed}/${c.n} | ${c.identity} | ${c.clauses.join("; ") || "none"} |`,
    );
  }
  out.push(
    "",
    "## Judge review",
    "",
    ...head("evidence", "decision", "abstained", "reviewed", "contested", "incomplete because"),
  );
  for (const j of a.judges) {
    out.push(
      `| ${j.name} | ${j.decision} | ${j.abstained ?? "—"} | ${j.reviewed} | ${j.contested ?? "—"} | ${j.provisional ?? "—"} |`,
    );
  }
  out.push("");
  return out;
}

function coverageSection(cov: FnCount[] | null, coverageDir: string | undefined, runDir: string): string[] {
  if (cov === null || cov.length === 0) {
    const suggestedCoverageDir = resolve(runDir, ".coverage");
    return [
      "## Host function execution",
      "",
      coverageDir === undefined
        ? `No coverage captured. Use this operator-filled Sol launch template (replace the absolute HOME, CODEX_HOME, TMPDIR and Bun PATH placeholders; it is not ready to execute): \`${solLaunchEnvironment(suggestedCoverageDir)}\`.`
        : `Coverage directory ${coverageDir} held no usable entries.`,
      "",
    ];
  }
  const executed = cov.filter((c) => c.count > 0);
  const byDir = new Map<string, { fns: number; hits: number }>();
  for (const c of cov) {
    const dir = c.file.split("/").slice(0, 2).join("/");
    const row = byDir.get(dir) ?? { fns: 0, hits: 0 };
    row.fns += 1;
    if (c.count > 0) row.hits += 1;
    byDir.set(dir, row);
  }
  const out = ["## Host function execution (V8 coverage)", ""];
  out.push(`${executed.length} of ${cov.length} instrumented functions executed.`, "");
  out.push(...head("module", "functions seen", "executed"));
  for (const [dir, row] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`| ${dir} | ${row.fns} | ${row.hits} |`);
  }
  out.push("", "### Hottest 25 functions", "", ...head("function", "file", "count"));
  for (const c of executed.slice(0, 25)) out.push(`| ${c.name} | ${c.file} | ${c.count} |`);
  out.push("");
  return out;
}

function rangeSection(changed: ChangedFn[], range: string): string[] {
  const out = [`## Did the code changed in ${range} execute?`, ""];
  if (changed.length === 0) return [...out, "The range changed no function under src/ or tools/.", ""];
  out.push(...head("file", "function", "executed"));
  for (const c of changed) {
    const cell =
      c.executed === null ? "unknown (no coverage)" : c.executed === 0 ? "NO" : `yes ×${c.executed}`;
    out.push(`| ${c.file} | ${c.name} | ${cell} |`);
  }
  out.push("");
  return out;
}

const args = parseArgs(Bun.argv.slice(2));
const camp = runCampaignDir(args.runDir, args.slug);
const coveragePath = args.coverage === undefined ? undefined : resolve(args.coverage);
const cov = coveragePath === undefined ? null : readV8Coverage(coveragePath, args.runDir);
const report = [
  `# Run triage: ${basename(camp)}`,
  "",
  `Run checkout \`${args.runDir}\`, generated ${new Date().toISOString()}.`,
  "",
  ...timelineSection(args.runDir),
  ...narrativeSection(camp),
  ...batterySection(readBatteries(args.runDir, camp)),
  ...analysisSection(readAnalysis(camp)),
  ...activitySection(observabilityCensus(camp)),
  ...coverageSection(cov, coveragePath, args.runDir),
  ...(args.range === undefined
    ? []
    : rangeSection(diffIntersection(args.runDir, args.range, cov), args.range)),
  "## Blind spots",
  "",
  "- Coverage sees node processes that inherit NODE_V8_COVERAGE; solver children with a scrubbed environment and non-node correctnessModels never report.",
  "- Evidence counts describe recorded evidence only. Work that a killed process never saved is invisible here.",
  "",
].join("\n");

if (args.out === undefined) console.write(report);
else {
  writeFileSync(resolve(args.out), report);
  console.log(`wrote ${resolve(args.out)} (${report.split("\n").length} lines)`);
}
