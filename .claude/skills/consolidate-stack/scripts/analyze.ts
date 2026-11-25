#!/usr/bin/env bun
/**
 * Deterministic overlap, churn, ordering and proof-cache pre-pass for `consolidate-stack`:
 * `analyze.ts [--top <n>] [--limit <n>]`. One lightweight `gh pr list` (`openPulls`, avoiding
 * GraphQL's node overflow on deep stacks) plus local `git diff --numstat` spans surface Mode B
 * churn hotspots (`gross/net >= 1.3x` or `>= 3` PR touches), Mode A zero-rewrite adjacent fold
 * blocks, `gate.ts` `checkerDigest` and `src/wall/linux-bwrap.ts` flags, `not-slop.tsv` ordering
 * edges and tier inversions.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { gitMaybe, gitOutput } from "#src/meta/git.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { NOT_SLOP_LEDGER } from "#tools/oxlint/not-slop-ledger.ts";
import { chains, openPulls, type Pull, ranksOf, trunkHead, trunkOf } from "#tools/runtime/pulls.ts";

const CHURN_RATIO = 1.3;
const HOT_TOUCHES = 3;
const DEFAULT_LIMIT = 15;
const GATE_OWNERS = new Set(["tools/runtime/gate.ts", "tools/runtime/pulls.ts"]);
const LINUX_WALL = "src/wall/linux-bwrap.ts";
const OXLINT_PREFIX = "tools/oxlint/";
const TIER_ORDER = new Map<string, number>([
  ["I0", 0],
  ["I1", 1],
  ["I2", 2],
  ["I3", 3],
]);

interface FileStat {
  readonly adds: number;
  readonly dels: number;
}

interface PullSpan {
  readonly number: number;
  readonly head: string;
  readonly sha: string;
  readonly rank: string;
  readonly draft: boolean;
  readonly commits: number;
  readonly adds: number;
  readonly dels: number;
  readonly files: number;
  readonly flags: readonly string[];
}

interface FileHotspot {
  readonly path: string;
  readonly touches: number;
  readonly gross: number;
  readonly net: number;
  readonly ratio: number;
  readonly prs: readonly number[];
}

interface StackAnalysis {
  readonly trunk: string;
  readonly spans: readonly PullSpan[];
  readonly sides: readonly Pull[];
  readonly totalCommits: number;
  readonly grossLines: number;
  readonly netLines: number;
  readonly hotspots: readonly FileHotspot[];
  readonly modeABlocks: readonly (readonly number[])[];
  readonly warnings: readonly string[];
}

/** Per-path addition and deletion totals from `git diff --numstat`, binaries (`-`) counting as 0.
 */
export function parseNumstat(raw: string): Map<string, FileStat> {
  const found = new Map<string, FileStat>();
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    const [addsText = "", delsText = "", ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (path === "") continue;
    const adds = addsText === "-" ? 0 : Number(addsText);
    const dels = delsText === "-" ? 0 : Number(delsText);
    const prior = found.get(path) ?? { adds: 0, dels: 0 };
    found.set(path, {
      adds: prior.adds + (Number.isFinite(adds) ? adds : 0),
      dels: prior.dels + (Number.isFinite(dels) ? dels : 0),
    });
  }
  return found;
}

const foldBucket = (rank: string): string => (rank === "I0" || rank === "I1" ? "I0/I1" : rank);

function spanFlags(paths: readonly string[]): string[] {
  const flags: string[] = [];
  if (paths.some((path) => GATE_OWNERS.has(path))) flags.push("gate-cache");
  if (paths.includes(LINUX_WALL)) flags.push("linux-ci");
  if (paths.some((path) => path.startsWith(OXLINT_PREFIX) && path.endsWith(".ts"))) flags.push("lint-rule");
  if (paths.includes(NOT_SLOP_LEDGER)) flags.push("not-slop");
  return flags;
}

function collectWarnings(spans: readonly PullSpan[], sides: readonly Pull[]): string[] {
  const warnings: string[] = [];
  const withFlag = (flag: string) =>
    spans.filter(({ flags }) => flags.includes(flag)).map(({ number }) => `#${String(number)}`);
  const gatePrs = withFlag("gate-cache");
  if (gatePrs.length > 0) {
    warnings.push(`checkerDigest: ${gatePrs.join(", ")} touch gate/pulls (invalidates cached passes)`);
  }
  const linuxPrs = withFlag("linux-ci");
  if (linuxPrs.length > 0) {
    warnings.push(`linux-ci: ${linuxPrs.join(", ")} touch ${LINUX_WALL} (dispatch ci.yml linux)`);
  }
  const slopPrs = withFlag("not-slop");
  const rulePrs = withFlag("lint-rule");
  if (slopPrs.length > 0 && rulePrs.length > 0) {
    warnings.push(
      `ledger-order: ${slopPrs.join(", ")} edit not-slop.tsv beside rules ${rulePrs.join(", ")} (hold rows above rule; rebuild via formatLedger / not-slop prune)`,
    );
  }
  if (sides.length > 0) {
    warnings.push(
      `side-prs: ${sides.map(({ number }) => `#${String(number)}`).join(", ")} sit off the main chain (republish.ts skips forks; rebase manually)`,
    );
  }
  const inversions: string[] = [];
  let maxTier = -1;
  for (const span of spans) {
    const tier = TIER_ORDER.get(span.rank);
    if (tier === undefined) continue;
    if (tier < maxTier) inversions.push(`#${String(span.number)}(${span.rank})`);
    if (tier > maxTier) maxTier = tier;
  }
  if (inversions.length > 0) {
    warnings.push(`tier-order: higher-priority PRs above lower tiers: ${inversions.join(", ")}`);
  }
  return warnings;
}

export function analyzeStack(
  pulls: readonly Pull[],
  trunk: string,
  baseSha: string,
  measure: {
    readonly diffNumstat: (from: string, to: string) => string;
    readonly commitCount: (from: string, to: string) => number;
  },
  topNumber: number | null = null,
): StackAnalysis {
  const { stacks, sides } = chains(pulls);
  const full =
    topNumber === null
      ? (stacks[0] ?? [])
      : (stacks.find((line) => line.some((pull) => pull.number === topNumber)) ?? []);
  const cut = topNumber === null ? full.length : full.findIndex((pull) => pull.number === topNumber) + 1;
  const line = cut > 0 ? full.slice(0, cut) : full;

  const touches = new Map<string, { gross: number; prs: number[] }>();
  const spans: PullSpan[] = [];
  let [prevSha, totalCommits, grossLines] = [baseSha, 0, 0];

  for (const pull of line) {
    const stats = parseNumstat(measure.diffNumstat(prevSha, pull.headRefOid));
    const commits = measure.commitCount(prevSha, pull.headRefOid);
    let [adds, dels] = [0, 0];
    for (const [path, stat] of stats) {
      adds += stat.adds;
      dels += stat.dels;
      const entry = touches.get(path) ?? { gross: 0, prs: [] };
      entry.gross += stat.adds + stat.dels;
      entry.prs.push(pull.number);
      touches.set(path, entry);
    }
    const [rank, ...more] = ranksOf(pull);
    spans.push({
      number: pull.number,
      head: pull.headRefName,
      sha: pull.headRefOid.slice(0, 7),
      rank: rank === undefined || more.length > 0 ? "unranked" : rank.slice("importance:".length),
      draft: pull.isDraft,
      commits,
      adds,
      dels,
      files: stats.size,
      flags: spanFlags([...stats.keys()]),
    });
    totalCommits += commits;
    grossLines += adds + dels;
    prevSha = pull.headRefOid;
  }

  const netStats =
    line.length === 0 ? new Map<string, FileStat>() : parseNumstat(measure.diffNumstat(baseSha, prevSha));
  let netLines = 0;
  for (const stat of netStats.values()) netLines += stat.adds + stat.dels;

  const hotspots = [...touches.entries()]
    .flatMap(([path, { gross, prs }]) => {
      if (prs.length < 2) return [];
      const netEntry = netStats.get(path);
      const net = (netEntry?.adds ?? 0) + (netEntry?.dels ?? 0);
      const ratio = gross / Math.max(1, net);
      return ratio >= CHURN_RATIO || prs.length >= HOT_TOUCHES
        ? [{ path, touches: prs.length, gross, net, ratio, prs }]
        : [];
    })
    .toSorted(
      (one, other) =>
        other.ratio - one.ratio || other.gross - one.gross || one.path.localeCompare(other.path),
    );

  const modeABlocks: number[][] = [];
  for (const span of spans) {
    const bucket = foldBucket(span.rank);
    const current = modeABlocks.at(-1);
    const prevSpan =
      current === undefined ? undefined : spans.find(({ number }) => number === current.at(-1));
    if (current !== undefined && prevSpan !== undefined && foldBucket(prevSpan.rank) === bucket) {
      current.push(span.number);
    } else {
      modeABlocks.push([span.number]);
    }
  }

  return {
    trunk,
    spans,
    sides,
    totalCommits,
    grossLines,
    netLines,
    hotspots,
    modeABlocks: modeABlocks.filter((block) => block.length > 1),
    warnings: collectWarnings(spans, sides),
  };
}

export function formatAnalysis(report: StackAnalysis, limit = DEFAULT_LIMIT): string {
  if (report.spans.length === 0) return "consolidate-stack analyze: no open stack found";
  const macroRatio = (report.grossLines / Math.max(1, report.netLines)).toFixed(2);
  const lines = [
    `stack: ${plural(report.spans.length, "PR")}, ${plural(report.totalCommits, "commit")} on ${report.trunk}; gross ${String(report.grossLines)} vs net ${String(report.netLines)} lines (${macroRatio}x)`,
    ...report.spans.map((span) => {
      const tag = span.flags.length === 0 ? "" : ` [${span.flags.join(",")}]`;
      const draft = span.draft ? " draft" : "";
      return `  #${String(span.number)} ${span.rank.padEnd(2)} ${String(span.commits).padStart(2)}c  +${String(span.adds)}/-${String(span.dels)} (${String(span.files)}f)  ${span.sha}${draft}${tag}  ${span.head}`;
    }),
  ];
  if (report.warnings.length > 0) {
    lines.push("warnings:", ...report.warnings.map((warning) => `  - ${warning}`));
  }
  if (report.modeABlocks.length > 0) {
    const blocks = report.modeABlocks.map((block) => block.map((num) => `#${String(num)}`).join("->"));
    lines.push(`mode-A adjacent blocks (0 cache invalidation): ${blocks.join(" | ")}`);
  }
  const shown = report.hotspots.slice(0, limit);
  if (shown.length > 0) {
    lines.push(
      `mode-B churn/overlap hotspots (${String(shown.length)} of ${String(report.hotspots.length)}):`,
    );
    for (const spot of shown) {
      const prs = spot.prs.map((num) => `#${String(num)}`).join(",");
      lines.push(
        `  ${spot.ratio.toFixed(2)}x  ${String(spot.touches)}t  gross ${String(spot.gross)} / net ${String(spot.net)}  ${spot.path}  (${prs})`,
      );
    }
  } else {
    lines.push("mode-B churn/overlap hotspots: none");
  }
  return lines.join("\n");
}

if (import.meta.main) {
  await runCommand(
    {
      name: "analyze",
      usage: "analyze.ts [--top <pr-number>] [--limit <n>]",
      options: { top: "int", limit: "int" },
    },
    (args: CommandArgs) => {
      const root = runtimeProcess.cwd();
      const trunk = trunkOf(root);
      const baseSha = gitMaybe(root, "rev-parse", "--verify", "-q", trunkHead(trunk));
      if (baseSha === null) args.die(`cannot resolve ${trunkHead(trunk)}; run git fetch origin first`, 1);
      const report = analyzeStack(
        openPulls(root),
        trunk,
        baseSha,
        {
          diffNumstat: (from, to) => gitOutput(root, "diff", "--numstat", `${from}..${to}`),
          commitCount: (from, to) => Number(gitOutput(root, "rev-list", "--count", `${from}..${to}`).trim()),
        },
        args.int("top"),
      );
      console.log(formatAnalysis(report, args.int("limit") ?? DEFAULT_LIMIT));
    },
  );
}
