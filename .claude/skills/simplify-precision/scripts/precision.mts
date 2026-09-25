/**
 * How often a site `bun run simplify` prints is one a reader would act on, shape by shape.
 *
 *   replay  run this tree's census scans over archived revisions of a repository
 *   sample  draw unjudged sites per shape into blind judge packets
 *   ingest  merge a judge's verdict lines into the label file
 *   score   precision per shape with its Wilson interval, and what a candidate rule removed
 *
 * The rule is the tree this script runs from. A candidate is measured by running `replay` from
 * its worktree over the same revisions and passing both outputs to `score`. Labels outlive the
 * session in `labels.tsv` beside this skill: the copied-block measurement of 2026-09-21 kept its
 * verdicts in a scratch directory, and the next pass could not reuse one of them.
 *
 *   bun .claude/skills/simplify-precision/scripts/precision.mts replay --repo /abs/repo \
 *     --out /abs/sites.jsonl --every 60 --since 2026-08-01
 *   bun .claude/skills/simplify-precision/scripts/precision.mts sample --sites /abs/sites.jsonl \
 *     --per-shape 20 --seed 1 --out /abs/packets
 *   bun .claude/skills/simplify-precision/scripts/precision.mts ingest --manifest /abs/packets/manifest.json \
 *     --verdicts /abs/packets/verdicts-1.tsv --judge opus-5.5
 *   bun .claude/skills/simplify-precision/scripts/precision.mts score --sites /abs/sites.jsonl \
 *     [--candidate /abs/candidate.jsonl] [--ledger /abs/other-repo/tools/oxlint/not-slop.tsv]
 */

import { exitWith, parseCommandOrDie } from "#skills/main/cli.ts";
import { gitOutput } from "#skills/main/git.ts";
import { wilsonInterval } from "#src/claim/estimation.ts";
import { sha256 } from "#src/meta/digest.ts";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { NOT_SLOP_LEDGER, readLedger, TREE_RULE_PREFIX } from "#tools/oxlint/not-slop-ledger.ts";
import { censusReads } from "#tools/oxlint/simplify-census.ts";
import { TREE_FINDING_ARGUMENTS, treeSites } from "#tools/oxlint/tree-findings.ts";

/** One site the census would have printed at one revision. */
export interface ReplayedSite {
  repo: string;
  rev: string;
  date: string;
  /** Digest of the scan sources that produced the row, so two rules are never mixed silently. */
  rule: string;
  kind: string;
  path: string;
  line: number;
  id: string;
  detail: string;
  places: readonly { path: string; line: number; end: number }[];
}

/** One verdict on one site. `ledger` rows are read from a not-slop ledger, never written here. */
export interface Label {
  id: string;
  kind: string;
  verdict: "yes" | "no";
  source: string;
  reason: string;
}

/** The judged set, beside this skill so it survives the session that judged it. */
const LABELS = resolve(import.meta.dir, "../labels.tsv");
const LABEL_HEADER = "id\tkind\tverdict\tsource\treason";

/** Registers are counts, not findings, and the census does not count them either. */
const REGISTERS = new Set(["filesystem-import-budget"]);

/** The scan sources whose bytes are the rule. */
const RULE_FILES = [
  "tools/oxlint/tree-findings.ts",
  "tools/oxlint/tree-closed-set.ts",
  "tools/oxlint/tree-compat-path.ts",
  "tools/oxlint/tree-copied-block.ts",
  "tools/oxlint/tree-identity.ts",
  "tools/oxlint/tree-module.ts",
  "tools/oxlint/tree-schema-tag.ts",
  "tools/oxlint/simplify-census.ts",
];

/** Items per judge packet: small enough that a judge reads each site at its revision. */
const PACKET_SIZE = 10;

/** The question each shape asks a judge. A yes is a change the shape proposes, made as proposed. */
const QUESTIONS = new Map<string, string>(
  Object.entries({
    "copied-block": "Should these copies get one owner (one function or constant both places call)?",
    "identity-without-owner":
      "Should the spellings of this literal read one named constant instead of repeating it?",
    "compatibility-path":
      "Is this code a path that reads or accepts what an older version left behind, which could be deleted outright?",
    "superseded-schema-tag":
      "Should the old version's spelling here go: the reader or writer of that older record removed?",
    "single-reader-export":
      "Should this export move into its one reader, deleting its file, with the result reading better?",
    "test-only-export":
      "Is this export dead in the product, so that it should go, its test deleted with it or pointed at the live code it wraps?",
    "unproduced-set-member": "Should this member be removed from the union, since nothing produces it?",
    "unread-field": "Should this field be removed, since nothing reads it?",
    "orphan-module": "Should this module be deleted, since nothing runs it?",
    "test-only-module": "Should this module be deleted with its tests, since the product never runs it?",
    "rule-without-fixture": "Should this rule get a fixture that makes it report (or be removed)?",
  }),
);

const die = exitWith("precision");

/** Every `--every`th first-parent commit of `--branch` since `--since`, newest first, or `--revs`. */
function revisions(repo: string, values: Readonly<Record<string, string | undefined>>): string[] {
  if (values.revs !== undefined) return values.revs.split(",").filter(Boolean);
  const every = Number(values.every ?? "40");
  const since = values.since === undefined ? [] : [`--since=${values.since}`];
  const log = gitOutput(
    repo,
    "log",
    "--first-parent",
    "--format=%h",
    ...since,
    values.branch ?? "origin/main",
  );
  return log
    .split("\n")
    .filter(Boolean)
    .filter((_, index) => index % every === 0);
}

/** The census scans over one archived revision, as the census would have printed them. */
function replayOne(repo: string, rev: string, rule: string): ReplayedSite[] {
  const dir = mkdtempSync(join(runtimeProcess.env.TMPDIR ?? "/tmp", "census-replay-"));
  const home = runtimeProcess.cwd();
  try {
    runTextSyncOrThrow(["sh", "-c", `git -C '${repo}' archive ${rev} | tar -x -C '${dir}'`]);
    const date = gitOutput(repo, "show", "-s", "--format=%cI", rev).trim();
    runtimeProcess.chdir(dir);
    return treeSites()
      .filter(
        (site) => !REGISTERS.has(site.kind) && censusReads(`${TREE_RULE_PREFIX}${site.kind}`, site.path),
      )
      .map((site) => ({
        repo,
        rev,
        date,
        rule,
        kind: site.kind,
        path: site.path,
        line: site.line,
        id: site.id,
        detail: site.detail,
        places: site.places ?? [{ path: site.path, line: site.line, end: site.line }],
      }));
  } finally {
    runtimeProcess.chdir(home);
    rmSync(dir, { recursive: true, force: true });
  }
}

function replay(values: Readonly<Record<string, string | undefined>>): string {
  const repo = resolve(values.repo ?? die("--repo is required"));
  const out = resolve(values.out ?? die("--out is required"));
  // The rule's identity: the scan sources of the tree this script runs from.
  const root = resolve(import.meta.dir, "../../../..");
  const rule = sha256(RULE_FILES.map((file) => readFileSync(join(root, file), "utf8")).join("\0")).slice(
    0,
    12,
  );
  for (const rev of revisions(repo, values)) {
    const sites = replayOne(repo, rev, rule);
    appendFileSync(out, sites.map((site) => `${capturedJsonStringify(site)}\n`).join(""));
    runtimeProcess.stderr.write(`${rev} ${sites.length} sites (rule ${rule})\n`);
  }
  return `replayed with rule ${rule} into ${out}\n`;
}

export function readSites(path: string): ReplayedSite[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => parseJsonAs<ReplayedSite>(line));
}

/** Each site once, at the oldest revision that printed it: the moment a reader would first meet it. */
export function uniqueSites(sites: readonly ReplayedSite[]): ReplayedSite[] {
  const first = new Map<string, ReplayedSite>();
  for (const site of sites) {
    const seen = first.get(site.id);
    if (seen === undefined || site.date < seen.date) first.set(site.id, site);
  }
  return [...first.values()];
}

export function readLabels(path: string): Label[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [id = "", kind = "", verdict = "", source = "", reason = ""] = line.split("\t");
      if (verdict !== "yes" && verdict !== "no") die(`labels.tsv: verdict "${verdict}" for ${id}`);
      return { id, kind, verdict: verdict === "yes" ? "yes" : "no", source, reason };
    });
}

/** A not-slop ledger's tree rows as `no` labels: an answer a reader wrote down is the calibration. */
function ledgerLabels(path: string): Label[] {
  if (!existsSync(path)) return [];
  return readLedger(readFileSync(path, "utf8"))
    .answers.filter((answer) => answer.rule.startsWith(TREE_RULE_PREFIX))
    .map((answer) => ({
      id: answer.id,
      kind: answer.rule.slice(TREE_RULE_PREFIX.length),
      verdict: "no",
      source: "ledger",
      reason: answer.reason,
    }));
}

/** A deterministic shuffle, so a seed names the draw. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return items
    .map((item) => ({ item, key: next() }))
    .sort((left, right) => left.key - right.key)
    .map((entry) => entry.item);
}

/** One item as a judge reads it: where, at which revision, and the one question. No outcome. */
function packetItem(item: number, site: ReplayedSite): string {
  const places = site.places.map((place) => `${place.path}:${place.line}-${place.end}`).join(", ");
  return [
    `### Item ${item}`,
    "",
    `- repository: ${site.repo}`,
    `- revision: ${site.rev} (read with \`git -C ${site.repo} show ${site.rev}:<path>\`)`,
    `- places: ${places}`,
    `- what the scan saw: ${site.detail}`,
    `- question: ${QUESTIONS.get(site.kind) ?? "Should this be simplified as the detail proposes?"}`,
    "",
  ].join("\n");
}

async function sample(values: Readonly<Record<string, string | undefined>>): Promise<string> {
  const sites = uniqueSites(readSites(values.sites ?? die("--sites is required")));
  const out = resolve(values.out ?? die("--out is required"));
  const perKind = Number(values["per-shape"] ?? "20");
  const seed = Number(values.seed ?? "1");
  // `--again <manifest>` repacks an earlier round's sites for a changed judge instruction, in
  // the same order, so the two instruments read the same items.
  const again = values.again === undefined ? null : readManifest(values.again);
  const judged = new Set(readLabels(LABELS).map((label) => label.id));
  const byKind = Map.groupBy(
    sites.filter((site) => !judged.has(site.id)),
    (site) => site.kind,
  );
  const byId = new Map(sites.map((site) => [site.id, site]));
  const drawn =
    again === null
      ? shuffled(
          [...byKind.values()].flatMap((group) => shuffled(group, seed).slice(0, perKind)),
          seed,
        )
      : Object.values(again).flatMap((entry) => byId.get(entry.id) ?? []);
  const manifest: Record<string, { id: string; kind: string }> = {};
  for (let start = 0; start < drawn.length; start += PACKET_SIZE) {
    const batch = drawn.slice(start, start + PACKET_SIZE);
    const body = batch.map((site, offset) => {
      manifest[String(start + offset + 1)] = { id: site.id, kind: site.kind };
      return packetItem(start + offset + 1, site);
    });
    // `Bun.write` creates the round's directory with its first packet.
    await Bun.write(
      join(out, `packet-${start / PACKET_SIZE + 1}.md`),
      [...packetHead(batch), ...body].join("\n"),
    );
  }
  await Bun.write(join(out, "manifest.json"), `${capturedJsonStringify(manifest, null, 2)}\n`);
  return `${drawn.length} items in ${Math.ceil(drawn.length / PACKET_SIZE)} packets under ${out}\n`;
}

/**
 * What the census prints above each shape's sites, once per shape in the packet. A reader of the
 * census sees this argument before the site; a judge without it answered from the site alone and
 * on 2026-09-24 said no to 31 of 32 legacy readers the operator had removed on use.
 */
function packetHead(batch: readonly ReplayedSite[]): string[] {
  const kinds = [...new Set(batch.map((site) => site.kind))].sort();
  const argument = new Map<string, string>(Object.entries(TREE_FINDING_ARGUMENTS));
  return [
    "## What the census says about each shape in this packet",
    "",
    ...kinds.flatMap((kind) => [`- **${kind}**: ${argument.get(kind) ?? ""}`, ""]),
  ];
}

function readManifest(path: string): Record<string, { id: string; kind: string }> {
  return parseJsonAs<Record<string, { id: string; kind: string }>>(readFileSync(path, "utf8"));
}

function ingest(values: Readonly<Record<string, string | undefined>>): string {
  const manifestPath = values.manifest ?? die("--manifest is required");
  const manifest = readManifest(manifestPath);
  const judge = values.judge ?? die("--judge is required");
  // One verdict per site and judge instruction: a re-judged round adds rows under its own name.
  const known = new Set(readLabels(LABELS).map((label) => `${label.id} ${label.source}`));
  const rows: string[] = [];
  for (const line of readFileSync(values.verdicts ?? die("--verdicts is required"), "utf8").split("\n")) {
    const match = /^(\d+)\t(yes|no)\t(.+)$/u.exec(line.trim());
    const entry = match === null ? undefined : manifest[match[1] ?? ""];
    if (match === null || entry === undefined || known.has(`${entry.id} judge:${judge}`)) continue;
    rows.push(
      [entry.id, entry.kind, match[2], `judge:${judge}`, (match[3] ?? "").replaceAll("\t", " ")].join("\t"),
    );
    known.add(`${entry.id} judge:${judge}`);
  }
  const header = existsSync(LABELS) ? "" : `${LABEL_HEADER}\n`;
  appendFileSync(LABELS, header + rows.map((row) => `${row}\n`).join(""));
  return `${rows.length} verdicts added to ${LABELS}\n`;
}

/** `yes/n`, the point and the 95% interval, or a dash when nothing was judged. */
function rate(yes: number, n: number): string {
  const bounds = wilsonInterval(yes, n);
  if (bounds === null) return "-";
  return `${yes}/${n} ${(yes / n).toFixed(2)} (${bounds.lower.toFixed(2)}-${bounds.upper.toFixed(2)})`;
}

/** Judged precision per shape, the judge's agreement with the ledger, and what a candidate dropped. */
export function scoreTable(
  sites: readonly ReplayedSite[],
  labels: readonly Label[],
  candidate: readonly ReplayedSite[] | null,
): string {
  const verdicts = new Map<string, Label[]>();
  for (const label of labels) verdicts.set(label.id, [...(verdicts.get(label.id) ?? []), label]);
  const judgeVerdict = (id: string): Label | undefined =>
    verdicts.get(id)?.findLast((label) => label.source.startsWith("judge:"));
  const kept = candidate === null ? null : new Set(candidate.map((site) => `${site.rev} ${site.id}`));
  const dropped = new Set(
    kept === null ? [] : sites.flatMap((site) => (kept.has(`${site.rev} ${site.id}`) ? [] : [site.id])),
  );
  const unique = uniqueSites(sites);
  const rows = [...Map.groupBy(unique, (site) => site.kind)].map(([kind, group]) => {
    const judged = group.flatMap((site) => judgeVerdict(site.id) ?? []);
    const yes = judged.filter((label) => label.verdict === "yes").length;
    const ledgerNo = group.filter(
      (site) => verdicts.get(site.id)?.some((label) => label.source === "ledger") === true,
    );
    const agree = ledgerNo.filter((site) => judgeVerdict(site.id)?.verdict === "no").length;
    const gone = group.filter((site) => dropped.has(site.id));
    const goneYes = gone.filter((site) => judgeVerdict(site.id)?.verdict === "yes").length;
    const goneNo = gone.filter((site) => judgeVerdict(site.id)?.verdict === "no").length;
    const change = kept === null ? "" : `  dropped ${gone.length} (yes ${goneYes}, no ${goneNo})`;
    return `${kind.padEnd(24)} ${String(group.length).padStart(5)}  ${rate(yes, judged.length).padEnd(24)} ledger-no judged-no ${agree}/${ledgerNo.length}${change}`;
  });
  const added =
    candidate === null
      ? []
      : uniqueSites(candidate).filter((site) => !new Set(unique.map((each) => each.id)).has(site.id));
  return [
    `${"shape".padEnd(24)} ${"sites".padStart(5)}  judged yes/n P (95%)`,
    ...rows.sort(),
    ...(candidate === null ? [] : [`candidate adds ${added.length} sites no judge has read`]),
  ].join("\n");
}

function score(values: Readonly<Record<string, string | undefined>>, ledgers: readonly string[]): string {
  const sites = readSites(values.sites ?? die("--sites is required"));
  const candidate = values.candidate === undefined ? null : readSites(values.candidate);
  const root = resolve(import.meta.dir, "../../../..");
  const labels = [
    ...readLabels(LABELS),
    ...[join(root, NOT_SLOP_LEDGER), ...ledgers].flatMap((path) => ledgerLabels(path)),
  ];
  return `${scoreTable(sites, labels, candidate)}\n`;
}

async function main(): Promise<void> {
  const parsed = parseCommandOrDie(die, {
    replay: { values: ["repo", "out", "every", "since", "branch", "revs"] },
    sample: { values: ["sites", "per-shape", "seed", "out", "again"] },
    ingest: { values: ["manifest", "verdicts", "judge"] },
    score: { values: ["sites", "candidate"], repeatable: ["ledger"] },
  });
  const single = Object.fromEntries(parsed.single);
  const commands = new Map<string, () => string | Promise<string>>([
    ["replay", () => replay(single)],
    ["sample", () => sample(single)],
    ["ingest", () => ingest(single)],
    ["score", () => score(single, parsed.repeated.get("ledger") ?? [])],
  ]);
  const run = commands.get(parsed.command) ?? die(`no command ${parsed.command}`);
  // `write` on the stream printed nothing from this script; `Bun.write` resolves once stdout has
  // taken the whole string, as simplify-census.ts found.
  await Bun.write(Bun.stdout, await run());
}

if (import.meta.main) await main();
