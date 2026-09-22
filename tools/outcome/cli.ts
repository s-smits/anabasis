/**
 * The shared command for read-only reports over a run's recorded evidence.
 *
 * Reports include metrics (default), anomaly scan, campaign scorecard, Harness
 * Builder tool census, cross-campaign Builder tool journeys, searchable cases, one case dossier,
 * searchable lifecycle observations, one raw verified case trace, the validated judge census,
 * and safeguard use. They share readers rather than each opening the campaign differently.
 * Keeping trace inspection here avoids another command with its own reading rules.
 *
 * Everything here prints. Nothing writes run state, makes decisions or sends text to a model.
 * Reports derive from evidence; they do not replace it. A saved report can become stale when
 * its source changes. Redirect stdout when a snapshot is wanted.
 *
 * Unknown flags return an error. Silently dropping an operator's filter would leave later
 * readers guessing which records the report included.
 */
import { join } from "../../src/meta/path.ts";

import { CASE_RECORD_FILE, readCaseRecord } from "../../src/claim/case-record.ts";
import { campaignTraceRoots, readVerifiedTraceUnder } from "../../src/claim/trace-read.ts";
import { OBSERVED_INTERFACES } from "../../src/observe/run-observer.ts";
import { builderToolFindings, builderToolsReport } from "./builder-tools.ts";
import { builderToolJourneysReport } from "./builder-tool-journeys.ts";
import { judgeReport } from "./judge.ts";
import { outcomeReport } from "./metrics.ts";
import {
  type CaseFilters,
  type CaseResult,
  type ObservationFilters,
  caseDossier,
  queryCases,
  queryObservations,
} from "./query.ts";
import { safeguardUsageReport } from "./usage-reader.ts";
import { scanOutcome } from "./scan.ts";
import { campaignScorecard } from "./scorecard.ts";

const USAGE = [
  "usage:",
  "  outcome <campaignDir> <runId> [--bundle <agentDir>]   metrics projection (default)",
  "  outcome <campaignDir> <runId> --scan                  deterministic anomaly findings",
  "  outcome <campaignDir> <runId> --scorecard             evidence-bound campaign scorecard",
  "  outcome <campaignDir> --builder                       Harness Builder tool census",
  "  outcome --builder-journeys <campaignDir[::epoch[::cutoff]]> [...]",
  "                                                       cross-campaign tool intent journeys",
  "  outcome --safeguards <campaignDir> [...]              fired safeguards vs the inventory",
  "  outcome <campaignDir> <runId> --cases [filters]       searchable case index",
  "  outcome <campaignDir> <runId> --case <taskId>         evidence-and-trace dossier",
  "  outcome <campaignDir> <runId> --observations [filters] searchable lifecycle events",
  "  outcome <campaignDir> <runId> --trace <taskId>        one digest-verified case trace",
  "  outcome <campaignDir> <runId> --judge                 validated judge census evidence",
  "",
  "case filters: --result <pass|fail|unaccepted|non-result> --variant <variant> --family <name>",
  "              --tool <name> --telemetry <state> --query <text> --limit <n>",
  "observation filters: --level <level> --contract <name> --type <name> --subject <id>",
  "                     --query <text> --limit <n> [--include-prompts]",
].join("\n");

type Mode =
  | "metrics"
  | "scan"
  | "scorecard"
  | "builder"
  | "builder-journeys"
  | "safeguards"
  | "cases"
  | "case"
  | "observations"
  | "trace"
  | "judge";

interface Args {
  positional: string[];
  bundle: string | null;
  mode: Mode | null;
  target: string | null;
  result: CaseResult | null;
  variant: string | null;
  family: string | null;
  tool: string | null;
  telemetry: CaseFilters["telemetry"];
  query: string | null;
  level: ObservationFilters["level"];
  contract: ObservationFilters["contract"];
  type: string | null;
  subject: string | null;
  limit: number | null;
  includePrompts: boolean;
}

const VALUE_FLAGS = new Set([
  "--bundle",
  "--trace",
  "--case",
  "--result",
  "--variant",
  "--family",
  "--tool",
  "--telemetry",
  "--query",
  "--level",
  "--contract",
  "--type",
  "--subject",
  "--limit",
]);
const MODES = new Map<string, Mode>([
  ["--scan", "scan"],
  ["--scorecard", "scorecard"],
  ["--builder", "builder"],
  ["--builder-journeys", "builder-journeys"],
  ["--safeguards", "safeguards"],
  ["--cases", "cases"],
  ["--observations", "observations"],
  ["--judge", "judge"],
]);

function setMode(args: Args, mode: Mode): void {
  if (args.mode !== null && args.mode !== mode) {
    throw new Error(`choose one outcome mode, received --${args.mode} and --${mode}\n\n${USAGE}`);
  }
  args.mode = mode;
}

function assignValue(args: Args, flag: string, value: string): void {
  if (flag === "--bundle") args.bundle = value;
  else if (flag === "--trace" || flag === "--case") {
    setMode(args, flag === "--trace" ? "trace" : "case");
    args.target = value;
  } else if (flag === "--result") {
    args.result =
      /* SAFETY: `validateArgs` below tests every flag value against its closed set and throws with the usage text before a query runs. */ value as CaseResult;
  } else if (flag === "--variant") args.variant = value;
  else if (flag === "--family") args.family = value;
  else if (flag === "--tool") args.tool = value;
  else if (flag === "--telemetry") {
    args.telemetry =
      /* SAFETY: `validateArgs` below tests every flag value against its closed set and throws with the usage text before a query runs. */ value as CaseFilters["telemetry"];
  } else if (flag === "--query") args.query = value;
  else if (flag === "--level") {
    args.level =
      /* SAFETY: `validateArgs` below tests every flag value against its closed set and throws with the usage text before a query runs. */ value as ObservationFilters["level"];
  } else if (flag === "--contract") {
    args.contract =
      /* SAFETY: `validateArgs` below tests every flag value against its closed set and throws with the usage text before a query runs. */ value as ObservationFilters["contract"];
  } else if (flag === "--type") args.type = value;
  else if (flag === "--subject") args.subject = value;
  else if (flag === "--limit") {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--limit needs a positive integer");
    args.limit = parsed;
  }
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    positional: [],
    bundle: null,
    mode: null,
    target: null,
    result: null,
    variant: null,
    family: null,
    tool: null,
    telemetry: null,
    query: null,
    level: null,
    contract: null,
    type: null,
    subject: null,
    limit: null,
    includePrompts: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const mode = MODES.get(arg);
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value\n\n${USAGE}`);
      assignValue(args, arg, value);
      i += 1;
    } else if (mode !== undefined) {
      setMode(args, mode);
    } else if (arg === "--include-prompts") {
      args.includePrompts = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}\n\n${USAGE}`);
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}

function assertValidFilters(args: Args, mode: Mode): void {
  const caseOnly = [args.result, args.family, args.tool, args.telemetry];
  const observationOnly = [args.level, args.contract, args.type, args.subject];
  if (mode !== "cases" && caseOnly.some((value) => value !== null)) {
    throw new Error(`case filters need --cases\n\n${USAGE}`);
  }
  if (mode !== "observations" && observationOnly.some((value) => value !== null)) {
    throw new Error(`observation filters need --observations\n\n${USAGE}`);
  }
  if (mode !== "observations" && args.includePrompts) {
    throw new Error(`--include-prompts needs --observations\n\n${USAGE}`);
  }
  if (!["cases", "case"].includes(mode) && args.variant !== null) {
    throw new Error(`--variant is only valid with --cases or --case\n\n${USAGE}`);
  }
  if (!["cases", "observations"].includes(mode) && (args.query !== null || args.limit !== null)) {
    throw new Error(`--query and --limit need --cases or --observations\n\n${USAGE}`);
  }
  if (args.bundle !== null && !["metrics", "scan", "scorecard"].includes(mode)) {
    throw new Error(`--bundle needs metrics, --scan, or --scorecard\n\n${USAGE}`);
  }
  assertKnownFilter(args.result, ["pass", "fail", "unaccepted", "non-result"], "case result");
  assertKnownFilter(
    args.telemetry,
    ["recorded", "no-trace-pointer", "trace-missing", "trace-drifted"],
    "telemetry state",
  );
  assertKnownFilter(args.level, ["default", "warning", "error"], "observation level");
  assertKnownFilter(args.contract, OBSERVED_INTERFACES, "observation contract");
}

function assertKnownFilter(value: string | null, known: readonly string[], label: string): void {
  if (value !== null && !known.includes(value)) throw new Error(`unknown ${label} ${value}\n\n${USAGE}`);
}

/** One case's verified trace, through the same digest-bound reader every consumer uses. A
 *  drifted or missing trace prints its typed state instead of whatever bytes share the name. */
function traceOf(campaignDir: string, selector: string, taskId: string): string {
  const rows = readCaseRecord(join(campaignDir, CASE_RECORD_FILE)).map((stored) => stored.row);
  const matches = rows.filter(
    (row) => row.taskId === taskId && (row.runId === selector || row.runId.startsWith(`${selector}-`)),
  );
  if (matches.length === 0) throw new Error(`no case ${taskId} under ${selector} in ${campaignDir}`);
  const roots = campaignTraceRoots(campaignDir);
  return JSON.stringify(
    matches.map((row) => {
      const read = readVerifiedTraceUnder(row, campaignDir, roots);
      return { runId: row.runId, taskId: row.taskId, state: read.state, path: read.path, trace: read.trace };
    }),
    null,
    2,
  );
}

function render(args: Args): string {
  const [campaignDir, selector] = args.positional;
  if (campaignDir === undefined) throw new Error(USAGE);
  const mode = args.mode ?? "metrics";
  assertValidFilters(args, mode);
  if (mode === "builder-journeys") {
    if (args.positional.length === 0) throw new Error(`--builder-journeys needs campaign dirs\n\n${USAGE}`);
    return JSON.stringify(builderToolJourneysReport(args.positional), null, 2);
  }
  if (mode === "safeguards") {
    if (args.positional.length === 0) throw new Error(`--safeguards needs campaign directories\n\n${USAGE}`);
    return JSON.stringify(safeguardUsageReport(args.positional), null, 2);
  }
  if (mode === "builder") {
    if (args.positional.length !== 1) throw new Error(`--builder takes a campaign dir only\n\n${USAGE}`);
    const report = builderToolsReport(campaignDir);
    return JSON.stringify({ ...report, findings: builderToolFindings(report) }, null, 2);
  }
  if (selector === undefined || args.positional.length !== 2) throw new Error(USAGE);
  if (mode === "trace" && args.target !== null) return traceOf(campaignDir, selector, args.target);
  if (mode === "case" && args.target !== null) {
    return JSON.stringify(caseDossier(campaignDir, selector, args.target, args.variant), null, 2);
  }
  if (mode === "cases") {
    const filters: CaseFilters = {
      result: args.result,
      variant: args.variant,
      family: args.family,
      tool: args.tool,
      telemetry: args.telemetry,
      query: args.query,
      limit: args.limit,
    };
    return JSON.stringify(queryCases(campaignDir, selector, filters), null, 2);
  }
  if (mode === "observations") {
    const filters: ObservationFilters = {
      level: args.level,
      contract: args.contract,
      type: args.type,
      subject: args.subject,
      query: args.query,
      includePrompts: args.includePrompts,
      limit: args.limit,
    };
    return JSON.stringify(queryObservations(campaignDir, selector, filters), null, 2);
  }
  if (mode === "judge") return JSON.stringify(judgeReport(campaignDir, selector), null, 2);
  if (mode === "scorecard") {
    return JSON.stringify(campaignScorecard(campaignDir, selector, args.bundle), null, 2);
  }
  const report = outcomeReport(campaignDir, selector, args.bundle);
  return JSON.stringify(mode === "scan" ? scanOutcome(report) : report, null, 2);
}

export function main(argv: readonly string[]): string {
  return render(parseArgs(argv));
}

if (Bun.argv[1] !== undefined && import.meta.url === Bun.pathToFileURL(Bun.argv[1]).href) {
  console.log(main(Bun.argv.slice(2)));
}
