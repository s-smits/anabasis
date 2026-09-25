// The simplify census: every shape the `/simplify` skill keeps finding, over the whole tree, in
// one reading.
//
// `/simplify` is a reading pass. It finds real removals, and it finds them once, in whichever
// files a reviewer happened to open. Two review lanes measured what it had actually found —
// 628 commits over ten days, 138 of them net-negative, and 20 recorded passes — and most of the
// judgements repeated a small number of shapes. Twenty of those are decidable from the syntax
// alone and are `ana/*` catchers; twelve shapes need the whole tree at once and are found by
// `tree-findings.ts` and the `tree-*.ts` scans beside it, one of them a register rather than a
// list to empty; the rest were already built into oxlint and were simply not switched on.
//
// As of 2026-09-20 all twenty gate from `.oxlintrc.json` and `simplify.json` holds no rules, so
// what this reader still prints is the whole-tree scans, which relate two files and which no
// per-file rule can express. The oxlint half of it is the staging ground the next catcher goes
// through: a shape is named here, measured over the whole tree, and moves to `.oxlintrc.json`
// once its sites are at zero — which is also where it has passed the admission test a gating
// rule has to pass, that at every site it reports a spelling exists satisfying every other rule.
// A heuristic that cannot pass that test may report here, and must never block.
//
// So the output is a census for a person: grouped by shape, largest first, each argument printed
// once with its own sites under it. Read it, decide per group, fix in one go.

import { runtimeProcess } from "../../src/meta/process.ts";
import { oxlintDiagnostics, ruleOf, withSites } from "../runtime/lint.ts";
import { ledgerOnDisk } from "./not-slop-ledger.ts";
import { TREE_FINDING_ARGUMENTS, TREE_REGISTER_KINDS, treeFindings } from "./tree-findings.ts";

/** The lint scope, matching `bun run lint` so the census and the gate see the same files. */
const SCOPE = ["src", "tools", "vendor", "starters", "test", "packages", ".claude"];

/**
 * Trees inside that scope the census does not read, and why.
 *
 * `anti-slop` is vendored verbatim at a pinned commit, and `pi-claude-bridge` is a copy of
 * pi-claude-bridge v0.6.3 whose local changes are marked in place. The gate still lints both. A
 * taste pass over a file we re-copy from upstream pays a merge cost at the next copy and buys
 * nothing, so its sites are noise in a census a person is meant to finish reading.
 *
 * `.oxlintrc.json` names the same two trees in an override that turns the promoted catchers off
 * over them, so the census and the gate agree on where taste applies. They did not always: a
 * group could empty here while a site stood in a tree only the gate read, which is how
 * `prefer-const-conditional` and `no-alias-restating-return` each failed promotion once.
 *
 * oxlint's own `ignorePatterns` cannot do this. Five spellings — `**\/pi-claude-bridge/**`,
 * `vendor/pi-claude-bridge/**`, bare `pi-claude-bridge`, `pi-claude-bridge/` and
 * `/vendor/pi-claude-bridge` — each left all 17 of that tree's sites in the report, whether the
 * directory was walked from `vendor` or named on the command line (measured 2026-09-20, oxlint
 * under `-c` with `--type-aware`). The reader owns its scope instead of declaring it twice.
 */
const UNREAD = ["tools/oxlint/anti-slop/", "vendor/pi-claude-bridge/"];

/**
 * The one shape `UNREAD` does not scope, because it is not a question of taste.
 *
 * Every rule either plugin registers is switched on in `.oxlintrc.json` and fails every strict lint
 * run, whoever wrote the rule file. Whether a fixture still makes one report is therefore a fact
 * about this repository's strict lint rather than about the vendored tree's style, and all eight rows it
 * currently has are in the tree `UNREAD` names. Dropping them would be the same silence the scan
 * exists to catch: a rule that has stopped reporting and a clean tree read identically.
 */
const ALWAYS_READ = "tree/rule-without-fixture";

const CONFIG = "tools/oxlint/simplify.json";

/** The register shapes, spelled as this reader spells a rule. */
const REGISTERS = new Set(TREE_REGISTER_KINDS.map((kind) => `tree/${kind}`));

/** Sites listed under each shape before the rest are summarised, unless `--all` is passed. */
const DEFAULT_SITES = 8;

/** Terminal width the messages are wrapped to. */
const WRAP = 96;

interface Finding {
  /** `ana/no-deep-nesting`, `typescript/no-unnecessary-condition`, or a tree shape's name. */
  rule: string;
  path: string;
  /** 1-based, or 0 for a whole-tree shape that belongs to a file rather than a line. */
  line: number;
  /** The shape's argument, printed once above its sites. Identical across a group. */
  message: string;
  /** What this one site is, when the argument alone does not say it. */
  detail?: string;
}

/** At most this many distinct sentences before a group is read as one argument with a hole. */
const MAX_ARGUMENTS = 6;

/** Every oxlint finding under the census config that the not-slop ledger does not answer. */
async function oxlintFindings(): Promise<Finding[]> {
  const { diagnostics } = await oxlintDiagnostics(["-c", CONFIG, "--type-aware", ...SCOPE]);
  const answered = new Set((await ledgerOnDisk()).answers.map((answer) => answer.id));
  return (await withSites(diagnostics))
    .filter(({ site }) => site === null || !answered.has(site.id))
    .map(({ diagnostic, site }) => {
      const line = diagnostic.labels?.[0]?.span.line ?? 0;
      const finding: Finding = {
        rule: ruleOf(diagnostic),
        path: diagnostic.filename,
        line,
        message: diagnostic.message,
      };
      if (site !== null) finding.detail = `[${site.id}]`;
      return finding;
    });
}

/** Findings by rule, each rule's sites in path order, rules ordered by count. */
/** Whether the census prints a site of this rule at this path. The precision replay reads it too,
 *  so a measured site is one a person was shown. */
export function censusReads(rule: string, path: string): boolean {
  return rule === ALWAYS_READ || !UNREAD.some((tree) => path.startsWith(tree));
}

function grouped(findings: readonly Finding[]): [string, Finding[]][] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) groups.set(finding.rule, [...(groups.get(finding.rule) ?? []), finding]);
  for (const sites of groups.values()) {
    sites.sort((left, right) =>
      left.path === right.path ? left.line - right.line : left.path.localeCompare(right.path),
    );
  }
  return [...groups].sort(
    (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]),
  );
}

/** A message broken at spaces to the terminal width, each line indented. */
function wrapped(text: string, indent: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u)) {
    if (line !== "" && line.length + word.length + 1 > WRAP) {
      lines.push(line);
      line = "";
    }
    line = line === "" ? word : `${line} ${word}`;
  }
  if (line !== "") lines.push(line);
  return lines.map((each) => indent + each).join("\n");
}

/** The summary table: one row per shape, with where its sites are.
 *
 * The bucket is the site's own root directory. It was a fixed `src`, `test` and `ui`, with every
 * path that was neither under `test/` nor under `packages/` counted as `src` — true while the
 * scope was those three. `tools`, `vendor` and `starters` had been reading as `src` since, and
 * when `.claude` joined the scope on 2026-09-20 a group of 31 sites spread across four roots
 * printed `src 31` and sent a reader to a tree holding nine of them. */
function summary(groups: readonly [string, Finding[]][]): string {
  const rows = groups.map(([rule, sites]) => {
    const counts = new Map<string, number>();
    for (const site of sites) {
      const test = site.path.startsWith("test/") || site.path.includes(".test.");
      const root = test ? "test" : (site.path.split("/")[0] ?? "src");
      counts.set(root, (counts.get(root) ?? 0) + 1);
    }
    const where = [...counts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([root, count]) => `${root} ${count}`)
      .join(", ");
    return `${String(sites.length).padStart(6)}  ${where.padEnd(24)}  ${rule}`;
  });
  return [`${"count".padStart(6)}  ${"where".padEnd(24)}  shape`, ...rows].join("\n");
}

/**
 * A shape's sites split by the sentence they carry, largest first, or one block when the sentences
 * are really one argument.
 *
 * A built-in rule can answer several ways under one name: `no-unnecessary-condition` gave six
 * different sentences over 239 sites — an optional chain on a value that is never nullish, two
 * types that cannot overlap, a comparison between two literals — and those were six findings with
 * six different answers, not one group anybody could decide. A catcher that interpolates the name
 * it found writes a different sentence at every site, which is the opposite case: one argument
 * with a hole in it. Above `MAX_ARGUMENTS` distinct sentences the group is the second kind, and
 * the first sentence stands for all of them.
 */
function byMessage(sites: readonly Finding[]): [string, Finding[]][] {
  const blocks = new Map<string, Finding[]>();
  for (const site of sites) blocks.set(site.message, [...(blocks.get(site.message) ?? []), site]);
  if (blocks.size > MAX_ARGUMENTS) return [[sites[0]?.message ?? "", [...sites]]];
  return [...blocks].sort((left, right) => right[1].length - left[1].length);
}

/** A block's sites, with the tail summarised once the limit is reached. */
function siteLines(sites: readonly Finding[], limit: number): string[] {
  const shown = sites.slice(0, limit);
  const rest = sites.length - shown.length;
  return [
    ...shown.map((site) => {
      const at = `${site.path}${site.line === 0 ? "" : `:${site.line}`}`;
      return site.detail === undefined ? `    ${at}` : `    ${at}  ${site.detail}`;
    }),
    ...(rest === 0 ? [] : [`    … and ${rest} more`]),
  ];
}

/** One section per shape: each argument once, then the sites that carry it. */
function section(rule: string, sites: readonly Finding[], limit: number): string {
  const blocks = byMessage(sites);
  const body = blocks.map(([message, block]) => {
    // A block standing for the whole group, or for one site, is its own argument; a group that
    // answers several ways counts each answer, so the section reads as its own table.
    const counted = blocks.length > 1 && block.length > 1;
    const head = counted ? `${String(block.length).padStart(3)}  ${message}` : message;
    return [wrapped(head, "    "), "", ...siteLines(block, limit)].join("\n");
  });
  const count = `${sites.length} ${sites.length === 1 ? "site" : "sites"}`;
  return ["", `${rule}  —  ${count}`, body.join("\n\n")].join("\n");
}

/** The whole-tree scans, as findings, so they read in the same table as the oxlint catchers. */
function wholeTreeFindings(): Finding[] {
  return treeFindings().map((finding) => ({
    rule: `tree/${finding.kind}`,
    path: finding.path,
    line: finding.line,
    message: TREE_FINDING_ARGUMENTS[finding.kind],
    // The id is what `bun run not-slop -- answer` takes for a site answered no.
    detail: `${finding.detail} [${finding.id}]`,
  }));
}

async function main(): Promise<void> {
  const argv = runtimeProcess.argv.slice(2);
  const all = argv.includes("--all");
  const only = argv.find((argument) => !argument.startsWith("--"));
  const limit = all ? Number.MAX_SAFE_INTEGER : DEFAULT_SITES;

  const read = [...(await oxlintFindings()), ...wholeTreeFindings()];
  const findings = read.filter((finding) => censusReads(finding.rule, finding.path));
  const selected = only === undefined ? findings : findings.filter((finding) => finding.rule.includes(only));
  const groups = grouped(selected.filter((finding) => !REGISTERS.has(finding.rule)));
  const registers = grouped(selected.filter((finding) => REGISTERS.has(finding.rule)));
  const total = groups.reduce((count, [, sites]) => count + sites.length, 0);

  // `write` on the stream returns before the bytes leave, and `process.exit` below used to cut
  // the last 200 lines off `--all`. `Bun.write` resolves once stdout has taken the whole string.
  await Bun.write(
    Bun.stdout,
    [
      "",
      `Simplify census — ${total} ${total === 1 ? "finding" : "findings"} across ${groups.length} shapes`,
      only === undefined ? "" : `filtered to shapes matching "${only}"`,
      "",
      summary(groups),
      ...groups.map(([rule, sites]) => section(rule, sites, limit)),
      ...(registers.length === 0
        ? []
        : [
            "",
            "Standing registers, not counted above. Each row is a current count, and the rule it",
            "carries is about the change proposed against it, so the list does not empty.",
            ...registers.map(([rule, sites]) => section(rule, sites, limit)),
          ]),
      "",
      all
        ? "Every site is listed."
        : "Every site: bun run simplify -- --all. One kind: bun run simplify -- <name>.",
      "Nothing here gates. Read a group, decide it as a group, then fix.",
      "",
    ].join("\n"),
  );
}

if (import.meta.main) await main();
