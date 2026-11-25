/**
 * Same-domain version backtracking for `wri.ts backtrack`, `record.md` and the synthesis prompt.
 * Target runs are set against older runs of the same domain (`domainOf`) and setting, with
 * attention decaying as release distance grows: `direct` (gap < 1) and `near` (gap < 2) runs are
 * expanded with their stored syntheses and `outside-reads.md` rows, `mid` (gap < 3) runs are rolled
 * up by release, and `distant` ones are one count.
 */
import { loadRuns, type Run as SummaryRun } from "#skills/main/runs.ts";
import { LOG_FILE } from "#src/kernel/log.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe, mainTree } from "#src/meta/git.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { compareCodeUnits } from "#src/meta/stable-json.ts";
import { plural } from "#src/meta/text.ts";
import { receipts } from "#tools/runs/receipt.ts";
import { archiveOf, domainOf } from "#tools/runs/registry.ts";
import { type SynthesisRef, synthesesByCampaign } from "./index.ts";
import { ledgerFiles, OUTSIDE, rowsOf } from "./ledger.ts";

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly tag: string;
}

type AttentionTier = "direct" | "near" | "mid" | "distant" | "other-setting";

type Direction = "same" | "older" | "newer";

interface Attention {
  readonly gap: number;
  readonly weight: number;
  readonly tier: AttentionTier;
  readonly samePack: boolean;
  readonly direction: Direction;
}

export interface BacktrackRun {
  readonly name: string;
  readonly domain: string;
  readonly pack: string;
  readonly setting: string;
  readonly commit: string | null;
  readonly releaseTag: string | null;
  readonly releaseLabel: string;
  readonly launched: number;
  readonly activeHours: number;
  readonly live: boolean;
  readonly promotions: number;
  readonly compared: number;
  readonly confirmed: number;
  readonly reads: number;
  readonly afterWins: number;
  readonly afterLosses: number;
  readonly afterTies: number;
  readonly scored: number;
  readonly room: number;
  readonly controls: number;
  readonly aaSteps: number;
  readonly dollars: number;
  readonly repriced: number | null;
  readonly ending: string;
}

export interface OutsideRef {
  readonly status: string;
  readonly summary: string;
}

interface CohortRow {
  readonly releaseLabel: string;
  readonly semver: Semver | null;
  readonly attention: Attention;
  readonly runs: number;
  readonly samePackRuns: number;
  readonly priorPromptRuns: number;
  readonly activeHours: number;
  readonly promotions: number;
  readonly compared: number;
  readonly confirmed: number;
  readonly reads: number;
  readonly afterWins: number;
  readonly afterLosses: number;
  readonly afterTies: number;
  readonly scored: number;
  readonly room: number;
  readonly controls: number;
  readonly aaSteps: number;
  readonly dollars: number;
  readonly repriced: number | null;
}

interface ExpandedPeer {
  readonly run: BacktrackRun;
  readonly attention: Attention;
  readonly synthesis: SynthesisRef | null;
  readonly outside: OutsideRef | null;
}

interface BacktrackReport {
  readonly domain: string;
  readonly pack: string;
  readonly setting: string;
  readonly targetRelease: string;
  readonly targets: readonly BacktrackRun[];
  readonly cohorts: readonly CohortRow[];
  readonly expanded: readonly ExpandedPeer[];
  readonly midConstraints: readonly {
    readonly releaseLabel: string;
    readonly folder: string;
    readonly constraint: string;
  }[];
  readonly distantCount: number;
  readonly distantReleases: readonly string[];
  readonly otherSettingCount: number;
  readonly newerCount: number;
  readonly deltaLines: readonly string[];
}

interface CohortKey {
  readonly semver: Semver | null;
  readonly pack: string;
  readonly setting: string;
}

interface CohortHead {
  readonly releaseLabel: string;
  readonly semver: Semver | null;
  readonly attention: Attention;
}

interface ReleaseRef {
  readonly tag: string | null;
  readonly label: string;
}

const SEMVER_TAG = /\bv(\d+)\.(\d+)\.(\d+)(?:\.\d+)?\b/u;
const DESCRIBED = /^(v\d[^-]*)-(\d+)-g[0-9a-f]+$/u;
const SINCE = "2026-10-01";
const MAJOR_WEIGHT = 10;
const SAME_MINOR_PATCH_STEP = 0.1;
const OLDER_MINOR_PATCH_CAP = 0.1;
const PRIOR_PROMPT_FACTOR = 0.5;
const UNKNOWN_GAP = 3;
const DIRECT_CEILING = 1;
const NEAR_CEILING = 2;
const MID_CEILING = 3;
const TIER_BOUNDS: readonly (readonly [number, AttentionTier])[] = [
  [DIRECT_CEILING, "direct"],
  [NEAR_CEILING, "near"],
  [MID_CEILING, "mid"],
];
const TARGET_ATTENTION: Attention = { gap: 0, weight: 1, tier: "direct", samePack: true, direction: "same" };
const SUMMARY_MAX = 140;
const CONSTRAINT_MAX = 200;

export function parseReleaseTag(text: string | null | undefined): Semver | null {
  if (text === null || text === undefined) return null;
  const match = SEMVER_TAG.exec(text);
  if (match === null) return null;
  const [, majorText = "0", minorText = "0", patchText = "0"] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  return { major, minor, patch, tag: `v${String(major)}.${String(minor)}.${String(patch)}` };
}

function compareSemver(one: Semver, other: Semver): number {
  if (one.major !== other.major) return one.major - other.major;
  if (one.minor !== other.minor) return one.minor - other.minor;
  return one.patch - other.patch;
}

/** Distance from `target` to `other`, monotone in recency: a higher patch on an older minor sits closer. */
export function versionGap(
  target: Semver,
  other: Semver,
): { readonly gap: number; readonly direction: Direction } {
  const order = compareSemver(other, target);
  const direction: Direction = order === 0 ? "same" : order < 0 ? "older" : "newer";
  if (order === 0) return { gap: 0, direction };
  const majorDiff = Math.abs(target.major - other.major);
  const minorDiff = Math.abs(target.minor - other.minor);
  if (majorDiff === 0 && minorDiff === 0) {
    return { gap: Math.min(0.95, Math.abs(target.patch - other.patch) * SAME_MINOR_PATCH_STEP), direction };
  }
  const patchTie =
    direction === "older"
      ? OLDER_MINOR_PATCH_CAP / (1 + other.patch)
      : OLDER_MINOR_PATCH_CAP * (1 - 1 / (1 + other.patch));
  return { gap: majorDiff * MAJOR_WEIGHT + minorDiff + patchTie, direction };
}

/** A run of another setting weighs zero, so cross-setting runs are never pooled into a delta. */
export function attentionOf(target: CohortKey, other: CohortKey): Attention {
  const samePack = other.pack === target.pack;
  if (other.setting !== target.setting) {
    return { gap: Infinity, weight: 0, tier: "other-setting", samePack, direction: "older" };
  }
  const { gap, direction } =
    target.semver !== null && other.semver !== null
      ? versionGap(target.semver, other.semver)
      : { gap: UNKNOWN_GAP, direction: "older" as const };
  const weight = (samePack ? 1 : PRIOR_PROMPT_FACTOR) / (1 + gap);
  const tier: AttentionTier = TIER_BOUNDS.find(([ceiling]) => gap < ceiling)?.[1] ?? "distant";
  return { gap, weight, tier, samePack, direction };
}

function aggregateCohort(head: CohortHead, group: readonly BacktrackRun[], targetPack: string): CohortRow {
  const sum = (of: (run: BacktrackRun) => number) => group.reduce((total, run) => total + of(run), 0);
  const samePackRuns = group.filter((run) => run.pack === targetPack).length;
  const repriced = group.every((run) => run.repriced !== null) ? sum((run) => run.repriced ?? 0) : null;
  return {
    ...head,
    runs: group.length,
    samePackRuns,
    priorPromptRuns: group.length - samePackRuns,
    activeHours: sum((run) => run.activeHours),
    promotions: sum((run) => run.promotions),
    compared: sum((run) => run.compared),
    confirmed: sum((run) => run.confirmed),
    reads: sum((run) => run.reads),
    afterWins: sum((run) => run.afterWins),
    afterLosses: sum((run) => run.afterLosses),
    afterTies: sum((run) => run.afterTies),
    scored: sum((run) => run.scored),
    room: sum((run) => run.room),
    controls: sum((run) => run.controls),
    aaSteps: sum((run) => run.aaSteps),
    dollars: sum((run) => run.dollars),
    repriced,
  };
}

const ratio = (numerator: number, denominator: number): string =>
  denominator === 0
    ? "0/0"
    : `${String(numerator)}/${String(denominator)} (${((numerator / denominator) * 100).toFixed(0)}%)`;

function costPerPromo(row: Pick<CohortRow, "promotions" | "dollars" | "repriced">): string {
  if (row.promotions === 0) return "-";
  const spend = row.repriced ?? row.dollars;
  return `$${String(Math.round(spend / row.promotions))}`;
}

const hoursPerPromo = (row: Pick<CohortRow, "promotions" | "activeHours">): string =>
  row.promotions === 0 ? "-" : `${(row.activeHours / row.promotions).toFixed(1)}h`;

const promosPer100h = (row: Pick<CohortRow, "promotions" | "activeHours">): string =>
  row.activeHours <= 0 ? "-" : ((row.promotions / row.activeHours) * 100).toFixed(1);

function clip(text: string, limit: number): string {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** The target cohort against the nearest older release's cohort, factor by factor. */
function buildDeltaLines(
  targetCohort: CohortRow,
  cohorts: readonly CohortRow[],
  expanded: readonly ExpandedPeer[],
): string[] {
  const nearest = cohorts.find(
    ({ attention }) => attention.direction === "older" && attention.tier !== "distant",
  );
  if (nearest === undefined) {
    return ["Nearest prior release: none under this domain and setting (no cross-version delta available)."];
  }
  const tAfterDenom = targetCohort.afterWins + targetCohort.afterLosses;
  const pAfterDenom = nearest.afterWins + nearest.afterLosses;
  const priorConstraints = expanded
    .filter(
      ({ run, synthesis }) =>
        run.releaseLabel === nearest.releaseLabel && synthesis?.constraint !== null && synthesis !== null,
    )
    .map(({ run, synthesis }) => `${run.name}: ${clip(synthesis?.constraint ?? "", CONSTRAINT_MAX)}`);
  const lines = [
    `Nearest prior release: ${nearest.releaseLabel} (gap ${nearest.attention.gap.toFixed(2)}, weight ${nearest.attention.weight.toFixed(2)}, ${plural(nearest.runs, "run")}${nearest.priorPromptRuns > 0 ? `, ${String(nearest.priorPromptRuns)} prior-prompt` : ""})`,
    `- Supply (validity room): target ${ratio(targetCohort.room, targetCohort.scored)} vs ${nearest.releaseLabel} ${ratio(nearest.room, nearest.scored)}`,
    `- Climb (promos/100 active h | promos/comp): target ${promosPer100h(targetCohort)} (${ratio(targetCohort.promotions, targetCohort.compared)}) vs ${nearest.releaseLabel} ${promosPer100h(nearest)} (${ratio(nearest.promotions, nearest.compared)})`,
    `- Confirmation (confirmed | written-after): target ${ratio(targetCohort.confirmed, targetCohort.reads)} | ${String(targetCohort.afterWins)}-${String(targetCohort.afterLosses)}-${String(targetCohort.afterTies)} (${ratio(targetCohort.afterWins, tAfterDenom)}) vs ${nearest.releaseLabel} ${ratio(nearest.confirmed, nearest.reads)} | ${String(nearest.afterWins)}-${String(nearest.afterLosses)}-${String(nearest.afterTies)} (${ratio(nearest.afterWins, pAfterDenom)})`,
    `- Honesty (A/A steps): target ${ratio(targetCohort.aaSteps, targetCohort.controls)} vs ${nearest.releaseLabel} ${ratio(nearest.aaSteps, nearest.controls)}`,
    `- Economy ($/promo | active h/promo): target ${costPerPromo(targetCohort)} | ${hoursPerPromo(targetCohort)} vs ${nearest.releaseLabel} ${costPerPromo(nearest)} | ${hoursPerPromo(nearest)}`,
  ];
  if (priorConstraints.length > 0) {
    lines.push(`- Prior binding constraint(s) to re-test (${nearest.releaseLabel}):`);
    for (const item of priorConstraints) lines.push(`  - ${item}`);
  }
  return lines;
}

export function buildBacktrack(
  targets: readonly BacktrackRun[],
  peers: readonly BacktrackRun[],
  syntheses: ReadonlyMap<string, SynthesisRef>,
  outside: ReadonlyMap<string, OutsideRef>,
): BacktrackReport {
  const lead = targets[0];
  if (lead === undefined) throw new Error("backtrack requires at least one target campaign");
  const targetNames = new Set(targets.map(({ name }) => name));
  const targetSemver = parseReleaseTag(lead.releaseTag ?? lead.releaseLabel);
  const targetKey: CohortKey = { semver: targetSemver, pack: lead.pack, setting: lead.setting };
  const targetCohort = aggregateCohort(
    { releaseLabel: lead.releaseLabel, semver: targetSemver, attention: TARGET_ATTENTION },
    targets,
    lead.pack,
  );
  const sameDomain = peers.filter((peer) => peer.domain === lead.domain && !targetNames.has(peer.name));
  const grouped = new Map<string, { semver: Semver | null; attention: Attention; runs: BacktrackRun[] }>();
  const expanded: ExpandedPeer[] = [];
  const distantReleases = new Set<string>();
  let [distantCount, otherSettingCount, newerCount] = [0, 0, 0];
  for (const peer of sameDomain) {
    const peerSemver = parseReleaseTag(peer.releaseTag ?? peer.releaseLabel);
    const attention = attentionOf(targetKey, { semver: peerSemver, pack: peer.pack, setting: peer.setting });
    if (attention.tier === "other-setting") {
      otherSettingCount += 1;
      continue;
    }
    if (attention.direction === "newer") {
      newerCount += 1;
      continue;
    }
    if (attention.tier === "distant") {
      distantCount += 1;
      distantReleases.add(peer.releaseLabel);
      continue;
    }
    const existing = grouped.get(peer.releaseLabel);
    if (existing === undefined) {
      grouped.set(peer.releaseLabel, { semver: peerSemver, attention, runs: [peer] });
    } else {
      existing.runs.push(peer);
      if (attention.weight > existing.attention.weight) existing.attention = attention;
    }
    if (attention.tier === "direct" || attention.tier === "near") {
      expanded.push({
        run: peer,
        attention,
        synthesis: syntheses.get(peer.name) ?? null,
        outside: outside.get(peer.name) ?? null,
      });
    }
  }
  const byGap = (a: Attention, b: Attention) => a.gap - b.gap || b.weight - a.weight;
  const cohorts = [...grouped.entries()]
    .map(([releaseLabel, { semver, attention, runs: group }]) =>
      aggregateCohort({ releaseLabel, semver, attention }, group, lead.pack),
    )
    .toSorted((one, other) => byGap(one.attention, other.attention));
  expanded.sort(
    (one, other) => byGap(one.attention, other.attention) || other.run.launched - one.run.launched,
  );
  const midConstraints: { releaseLabel: string; folder: string; constraint: string }[] = [];
  const seenFolders = new Set<string>();
  for (const cohort of cohorts.filter(({ attention }) => attention.tier === "mid")) {
    for (const run of grouped.get(cohort.releaseLabel)?.runs ?? []) {
      const ref = syntheses.get(run.name);
      if (ref?.constraint === null || ref === undefined || seenFolders.has(ref.folder)) continue;
      seenFolders.add(ref.folder);
      midConstraints.push({
        releaseLabel: cohort.releaseLabel,
        folder: ref.folder,
        constraint: clip(ref.constraint, CONSTRAINT_MAX),
      });
    }
  }
  return {
    domain: lead.domain,
    pack: lead.pack,
    setting: lead.setting,
    targetRelease: lead.releaseLabel,
    targets,
    cohorts,
    expanded,
    midConstraints,
    distantCount,
    distantReleases: [...distantReleases].toSorted(compareCodeUnits),
    otherSettingCount,
    newerCount,
    deltaLines: buildDeltaLines(targetCohort, cohorts, expanded),
  };
}

export function formatBacktrack(report: BacktrackReport): string[] {
  const lines: string[] = [
    `# Same-domain version backtracking: ${report.domain} (${report.pack})`,
    "",
    `Target release: ${report.targetRelease} · setting: ${report.setting} · targets: ${report.targets.map(({ name }) => name).join(", ")}`,
    "Attention decays monotonically with release-version gap (`weight = promptFactor / (1 + gap)`): `direct` (gap < 1) & `near` (1 <= gap < 2) expand per-run metrics, syntheses & outside reads; `mid` (2 <= gap < 3) rolls up by cohort; `distant` (gap >= 3) collapses to background.",
    "",
  ];
  const targetRow = aggregateCohort(
    {
      releaseLabel: `TARGET (${report.targetRelease})`,
      semver: parseReleaseTag(report.targetRelease),
      attention: TARGET_ATTENTION,
    },
    report.targets,
    report.pack,
  );
  lines.push(
    "## Release cohorts (same domain & setting, ordered by smallest version gap)",
    "",
    "| cohort | tier | gap | weight | runs | active h | promos/comps | promos/100h | confirmed | written-after | validity room | A/A | $/promo |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- | --- | ---: |",
  );
  for (const row of [targetRow, ...report.cohorts]) {
    const promptNote = row.priorPromptRuns > 0 ? ` (${String(row.priorPromptRuns)} prior-prompt)` : "";
    lines.push(
      `| ${row.releaseLabel}${promptNote} | ${row.attention.tier} | ${row.attention.gap.toFixed(2)} | ${row.attention.weight.toFixed(2)} | ${String(row.runs)} | ${row.activeHours.toFixed(1)} | ${String(row.promotions)}/${String(row.compared)} | ${promosPer100h(row)} | ${String(row.confirmed)}/${String(row.reads)} | ${String(row.afterWins)}-${String(row.afterLosses)}-${String(row.afterTies)} | ${String(row.room)}/${String(row.scored)} | ${String(row.aaSteps)}/${String(row.controls)} | ${costPerPromo(row)} |`,
    );
  }
  lines.push("", "## Delta vs nearest prior release", "", ...report.deltaLines);
  if (report.expanded.length > 0) {
    lines.push(
      "",
      "## Direct & near runs (gap < 2: high attention)",
      "",
      "| run | release | pack | tier | weight | active h | promos/comps | confirmed | written-after | A/A | $ | outside | synthesis |",
      "| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | ---: | --- | --- |",
    );
    for (const { run, attention, synthesis, outside } of report.expanded) {
      const outsideCell =
        outside === null
          ? "none"
          : `${outside.status}${outside.summary === "" ? "" : `: ${outside.summary}`}`;
      const synCell = synthesis === null ? "none" : `\`.ana/wri/${synthesis.folder}/${synthesis.summary}\``;
      lines.push(
        `| ${run.name} | ${run.releaseLabel} | ${run.pack} | ${attention.tier} | ${attention.weight.toFixed(2)} | ${run.activeHours.toFixed(1)} | ${String(run.promotions)}/${String(run.compared)} | ${String(run.confirmed)}/${String(run.reads)} | ${String(run.afterWins)}-${String(run.afterLosses)}-${String(run.afterTies)} | ${String(run.aaSteps)}/${String(run.controls)} | $${String(Math.round(run.repriced ?? run.dollars))} | ${outsideCell} | ${synCell} |`,
      );
    }
    const constraints = report.expanded.flatMap(({ run, synthesis }) =>
      synthesis?.constraint !== null && synthesis !== null
        ? [`- ${run.name} (${run.releaseLabel}): ${clip(synthesis.constraint, CONSTRAINT_MAX)}`]
        : [],
    );
    if (constraints.length > 0) {
      lines.push("", "Stored binding constraints (direct & near runs):", ...constraints);
    }
  }
  if (report.midConstraints.length > 0) {
    lines.push("", "## Mid-gap context (2 <= gap < 3: cohort trend only)");
    for (const { releaseLabel, folder, constraint } of report.midConstraints) {
      lines.push(`- ${releaseLabel} (\`.ana/wri/${folder}/synthesis.md\`): ${constraint}`);
    }
  }
  const footnotes = [
    report.distantCount > 0 &&
      `Distant background (gap >= 3, collapsed): ${plural(report.distantCount, "run")} across ${report.distantReleases.join(", ")}.`,
    report.otherSettingCount > 0 &&
      `Other settings (excluded from causal deltas, AGENTS.md §9): ${plural(report.otherSettingCount, "same-domain run")}.`,
    report.newerCount > 0 &&
      `Newer same-domain runs after ${report.targetRelease}: ${plural(report.newerCount, "run")}.`,
  ].filter((line): line is string => line !== false);
  if (footnotes.length > 0) lines.push("", "## Background & exclusions", "", ...footnotes);
  return lines;
}

function parsedDescribe(line: string): ReleaseRef | null {
  const match = DESCRIBED.exec(line.trim());
  if (match === null) return null;
  const [, tag = "", count = "0"] = match;
  return { tag, label: count === "0" ? tag : `after ${tag}` };
}

function prefetchReleases(
  commits: readonly (string | null)[],
  repo: string,
  cache: Map<string, ReleaseRef | null>,
): void {
  const todo = [
    ...new Set(commits.filter((commit): commit is string => commit !== null && !cache.has(commit))),
  ];
  if (todo.length === 0) return;
  const out = gitMaybe(repo, "describe", "--tags", "--long", "--match", "v[0-9]*", ...todo);
  if (out !== null) {
    const lines = out.trim().split("\n");
    if (lines.length === todo.length) {
      for (const [at, commit] of todo.entries()) cache.set(commit, parsedDescribe(lines[at] ?? ""));
      return;
    }
  }
  for (const commit of todo) {
    const one = gitMaybe(repo, "describe", "--tags", "--long", "--match", "v[0-9]*", commit);
    cache.set(commit, one === null ? null : parsedDescribe(one));
  }
}

function toBacktrackRun(
  run: SummaryRun,
  commit: string | null,
  cache: ReadonlyMap<string, ReleaseRef | null>,
): BacktrackRun {
  const resolved = commit === null ? null : (cache.get(commit) ?? null);
  const tag = resolved?.tag ?? parseReleaseTag(run.release)?.tag ?? null;
  const label = resolved?.label ?? run.release;
  return {
    name: run.name,
    domain: domainOf(run.name),
    pack: run.pack,
    setting: run.setting,
    commit,
    releaseTag: tag,
    releaseLabel: label,
    launched: run.launched,
    activeHours: run.active,
    live: run.live,
    promotions: run.promotions.length,
    compared: run.compared,
    confirmed: run.confirmed,
    reads: run.reads,
    afterWins: run.after.wins,
    afterLosses: run.after.losses,
    afterTies: run.after.ties,
    scored: run.scored,
    room: run.room,
    controls: run.controls,
    aaSteps: run.aaSteps,
    dollars: run.dollars,
    repriced: run.repriced,
    ending: run.ending,
  };
}

function outsideDetailsOf(wriRoot: string): Map<string, OutsideRef> {
  const found = new Map<string, OutsideRef>();
  if (!existsSync(wriRoot)) return found;
  for (const path of ledgerFiles(wriRoot, wriRoot, OUTSIDE)) {
    for (const cells of rowsOf(readFileSync(path, "utf8"), "run")) {
      const name = cells[0]?.trim() ?? "";
      if (name === "") continue;
      const tail = cells.at(-1) ?? "";
      const status = /[a-z]+/u.exec(tail.toLowerCase())?.[0] ?? "unknown";
      const fair = (cells[5] ?? "").trim();
      const summary = fair !== "" && fair !== "none" ? clip(fair, SUMMARY_MAX) : "";
      found.set(name, { status, summary });
    }
  }
  return found;
}

function mappedRuns(
  pairs: readonly (readonly [SummaryRun, string | null])[],
  repo: string,
  cache: Map<string, ReleaseRef | null>,
): BacktrackRun[] {
  const withCommits = pairs.map(
    ([run, logPath]) => [run, logPath === null ? null : (receipts(logPath)[0]?.commit ?? null)] as const,
  );
  prefetchReleases(
    withCommits.map(([, commit]) => commit),
    repo,
    cache,
  );
  return withCommits.map(([run, commit]) => toBacktrackRun(run, commit, cache));
}

/** Reads the local archive only, never SSH or `.env`. */
async function loadDomainArchive(
  domain: string,
  repo: string,
  cache: Map<string, ReleaseRef | null>,
): Promise<BacktrackRun[]> {
  const archive = archiveOf(mainTree(repo));
  if (!existsSync(archive)) return [];
  const loaded = await loadRuns({ home: archive, since: SINCE, names: [domain], repo });
  return mappedRuns(
    loaded.runs
      .filter((run) => domainOf(run.name) === domain)
      .map((run) => {
        const logPath = join(archive, run.host, run.name, LOG_FILE);
        return [run, existsSync(logPath) ? logPath : null] as const;
      }),
    repo,
    cache,
  );
}

export async function backtrackForLogs(logs: readonly string[], repo: string): Promise<string[]> {
  const cache = new Map<string, ReleaseRef | null>();
  const targetPairs: (readonly [SummaryRun, string])[] = [];
  for (const log of logs) {
    const name = basename(dirname(log));
    const loaded = await loadRuns({ home: dirname(dirname(log)), since: "2020-01-01", names: [name], repo });
    const match = loaded.runs.find((run) => run.name === name);
    if (match !== undefined) targetPairs.push([match, log]);
  }
  const targets = mappedRuns(targetPairs, repo, cache);
  const lead = targets[0];
  if (lead === undefined) return ["history: target campaign log could not be folded (rehearsal or empty)"];
  const wriRoot = join(mainTree(repo), ".ana", "wri");
  const peers = await loadDomainArchive(lead.domain, repo, cache);
  if (peers.filter((peer) => !targets.some((target) => target.name === peer.name)).length === 0) {
    return [
      `# Same-domain version backtracking: ${lead.domain} (${lead.pack})`,
      "",
      `Target release: ${lead.releaseLabel} · setting: ${lead.setting} · targets: ${targets.map(({ name }) => name).join(", ")}`,
      `No older same-domain runs found for domain \`${lead.domain}\` in the archive.`,
    ];
  }
  return formatBacktrack(
    buildBacktrack(targets, peers, synthesesByCampaign(wriRoot), outsideDetailsOf(wriRoot)),
  );
}

export async function backtrackForDomain(domain: string, repo: string): Promise<string[]> {
  const cache = new Map<string, ReleaseRef | null>();
  const wriRoot = join(mainTree(repo), ".ana", "wri");
  const all = await loadDomainArchive(domain, repo, cache);
  const newest = all.at(-1);
  if (newest === undefined) return [`history: no archived runs found for domain \`${domain}\``];
  const targets = all.filter(
    (run) =>
      run.releaseLabel === newest.releaseLabel && run.setting === newest.setting && run.pack === newest.pack,
  );
  return formatBacktrack(
    buildBacktrack(targets, all, synthesesByCampaign(wriRoot), outsideDetailsOf(wriRoot)),
  );
}
