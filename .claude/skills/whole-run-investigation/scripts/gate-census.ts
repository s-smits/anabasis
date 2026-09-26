// Every recorded run's gate rent and shipping failures, summed across the campaign tree: the
// cross-run view the gate audit (`references/gate-audit.md`) reads before it judges one component.
//
// `gates` answers what one run's refusals cost it. A decision to keep, sharpen or remove a refusal
// needs all runs at once, because one component fires a few times per run and the audit's question
// is its share of true positives over every firing. So this reader runs `buildGateRent` over each
// campaign and groups the episodes the same way, with each session named by its campaign so a
// component's `sessions` count reads as the rounds it fired in. Beside that, what each Builder-
// authored check did to shipping: the measured cases whose verdict it failed, against the cases it
// ran on, because a check that fails correct answers moves a battery as surely as a gate that
// refuses correct candidates holds a round.

import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { productRoot } from "#src/meta/campaign-root.ts";
import { campaignCases, verifiedVerdicts } from "./digest.ts";
import { terminalTraceRoot } from "./trace-challenge.ts";
import {
  buildGateRent,
  componentRows,
  type ComponentRow,
  type Episode,
  type HoldChain,
  type TerminalReading,
} from "./gate-rent.ts";

/** One declared check's measured cases in one campaign, and the ones whose verdict it failed. */
interface ShippingRow {
  campaign: string;
  checkId: string;
  ran: number;
  failed: string[];
}

interface CensusComponent extends ComponentRow {
  runs: number;
  minutesPerRound: number | null;
}

/** A campaign the census could not read whole: no execution record, an unreadable record, or a
 *  case ledger or verdict it could not bind. Its gaps are not zero activity. */
interface CoverageGap {
  campaign: string;
  gaps: string[];
}

interface CensusTerminal extends TerminalReading {
  campaign: string;
  runId: string;
}

export type GateCensusReport = ReturnType<typeof buildGateCensus>;

const GATE_CENSUS_SCHEMA = "wri-gate-census/v2";

/** The runs a campaign opened, oldest first; the last is the one whose terminal is read. */
function runsOf(campaign: string): string[] {
  const controller = join(campaign, "controller");
  if (!existsSync(controller)) return [];
  return readdirSync(controller)
    .filter((runId) => existsSync(join(controller, runId, "opening.json")))
    .toSorted();
}

/**
 * Per declared check, the verified cases it ran on and the ones whose verdict it failed. The cases
 * come from the campaign's case ledger, not from the verdict files on disk: a typed non-result
 * keeps the evaluator's raw verdict for diagnosis, and a battery sits under whichever retained,
 * candidate or promoted tree measured it, so a file scan would count the first and miss the
 * second. The digest's readers decide both, and a case read two ways is one ledger row.
 */
function shippingOf(campaign: string, name: string, domainsRoot: string, checks: Map<string, ShippingRow>) {
  const { selection, traceRoots } = campaignCases({ campaign, domainsRoot });
  const caseRootOf = new Map(selection.rows.map((row) => [row, terminalTraceRoot(row, traceRoots)]));
  const { verdicts, gaps } = verifiedVerdicts(selection.rows, caseRootOf);
  for (const { row, oracle } of verdicts) {
    for (const receipt of Array.isArray(oracle.checkReceipts) ? oracle.checkReceipts : []) {
      if (!isRecord(receipt) || !isString(receipt.checkId)) continue;
      const key = `${name}\u0000${receipt.checkId}`;
      const shipping = checks.get(key) ?? { campaign: name, checkId: receipt.checkId, ran: 0, failed: [] };
      shipping.ran += 1;
      if (receipt.passed === false) shipping.failed.push(`${row.runId}/${row.taskId}`);
      checks.set(key, shipping);
    }
  }
  return [...(selection.refusal === null ? [] : [`case record refused: ${selection.refusal}`]), ...gaps];
}

/** Over the campaign tree `root`, `campaignRoot()` of the main checkout; domain trees sit beside it. */
export function buildGateCensus({
  root,
  domainsRoot = productRoot(dirname(root)),
}: {
  root: string;
  domainsRoot?: string;
}) {
  const episodes: Episode[] = [];
  const holds: HoldChain[] = [];
  const terminals: CensusTerminal[] = [];
  const checks = new Map<string, ShippingRow>();
  const runs = new Map<string, Set<string>>();
  const coverage: CoverageGap[] = [];
  let sessions = 0;
  for (const name of readdirSync(root).toSorted()) {
    const campaign = join(root, name);
    const runId = runsOf(campaign).at(-1);
    if (runId === undefined) continue;
    const report = buildGateRent({ campaign, runId });
    sessions += report.sessions.length;
    const gaps = [
      ...(report.state === "recorded" ? [] : [report.reason ?? report.state]),
      ...report.unreadable,
      ...shippingOf(campaign, name, domainsRoot, checks),
    ];
    if (gaps.length > 0) coverage.push({ campaign: name, gaps });
    for (const episode of report.episodes) {
      episodes.push({ ...episode, where: `${name} ${episode.where}` });
      runs.set(episode.component, new Set([...(runs.get(episode.component) ?? []), name]));
    }
    holds.push(...report.holds.map((chain) => ({ ...chain, where: `${name} ${chain.where}` })));
    terminals.push({ campaign: name, runId, ...report.terminal });
  }
  const components = componentRows(episodes).map(
    (row): CensusComponent => ({
      ...row,
      runs: runs.get(row.key)?.size ?? 0,
      minutesPerRound: sessions === 0 ? null : row.totalMinutes / sessions,
    }),
  );
  return {
    schema: GATE_CENSUS_SCHEMA,
    root,
    campaigns: terminals.length,
    sessions,
    coverage,
    components: components.toSorted((a, b) => b.totalMinutes - a.totalMinutes),
    holds: {
      chains: holds.length,
      holds: holds.reduce((sum, chain) => sum + chain.holds, 0),
      minutes: Math.round(holds.reduce((sum, chain) => sum + chain.waitMs, 0) / 60_000),
    },
    terminals,
    shipping: [...checks.values()]
      .filter((row) => row.failed.length > 0)
      .toSorted((a, b) => b.failed.length - a.failed.length),
    limits: [
      "`repaired` means the bytes moved and the code went away, not that a defect was fixed; whether a firing was a true positive is read from its receipts and the Builder's prose, never from this count.",
      "Minutes per round spreads a component's minutes over every Builder session the census read, so it prices the component against the whole climb rather than against the rounds it fired in; a campaign listed under coverage contributed only what was readable.",
      "A shipping failure names a verified case whose verdict the check failed; a typed non-result is never one, whatever its evaluator returned. Whether the answer was wrong or the check was is the audit's question, answered by re-running the case.",
      "A campaign holding several runs reads the last run's terminal; every run's sessions and episodes count.",
    ],
  };
}

function componentLine(row: CensusComponent): string {
  const name = row.component === null ? `unledgered ${row.codes.join(", ")}` : `${row.component} ${row.id}`;
  const answers = Object.entries(row.answers)
    .map(([kind, n]) => `${kind} ${n}`)
    .join(", ");
  const perRound = row.minutesPerRound === null ? "n/a" : row.minutesPerRound.toFixed(1);
  const cost = `${row.totalMinutes} min (median ${row.medianMinutes ?? "n/a"}), ${perRound} min per round`;
  const reach = `${row.episodes} episodes in ${row.sessions} rounds of ${row.runs} runs, ${row.stalls} stalls`;
  return `  ${name} P(right) ${row.pRight ?? "n/a"}: ${reach}; ${cost}; ${answers}`;
}

function terminalLines(terminals: readonly CensusTerminal[]): string[] {
  const byCode = new Map<string, number>();
  for (const row of terminals) {
    const code =
      row.component === null
        ? ((row.reason ?? row.state).split(":")[0] ?? row.state)
        : `${row.component.code} ${row.component.id}`;
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }
  return [...byCode].map(([code, n]) => `  ${code}: ${n}`);
}

export function renderGateCensus(report: GateCensusReport): string {
  const { holds, coverage } = report;
  const partial =
    coverage.length === 0
      ? ""
      : ` in the readable part of the tree (${coverage.length} campaigns not read whole)`;
  return [
    `gate census over ${report.campaigns} campaigns, ${report.sessions} Builder sessions read (${report.root})`,
    ...(coverage.length === 0
      ? ["coverage: every campaign read whole"]
      : [
          `coverage: PARTIAL, ${coverage.length} of ${report.campaigns} campaigns not read whole; their gaps are not zero activity`,
          ...coverage.flatMap((row) => row.gaps.map((gap) => `  ${row.campaign}: ${gap}`)),
        ]),
    "components, costliest first:",
    ...(report.components.length === 0
      ? [`  no gate component fired${partial}`]
      : report.components.map(componentLine)),
    `review-unread holds: ${holds.holds} in ${holds.chains} chains, ${holds.minutes} min`,
    "terminals:",
    ...terminalLines(report.terminals),
    "shipping failures, per Builder-authored check (failed of ran):",
    ...(report.shipping.length === 0
      ? [`  no verified case failed a declared check${partial}`]
      : report.shipping.map(
          (row) =>
            `  ${row.campaign} ${row.checkId}: ${row.failed.length} of ${row.ran}; ${row.failed.slice(0, 4).join(", ")}`,
        )),
    ...report.limits.map((line) => `limit: ${line}`),
  ].join("\n");
}
