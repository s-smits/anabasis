// The pre-commit slop report: the whole-tree scans, narrowed to the lines this commit changes.
//
// `bun run simplify` prints every site in the tree, a census a person reads once and finishes. At
// commit time the question is narrower — did this change add one — and the reader is often an
// agent that sees the hook's output and nothing else. So this prints the sites with a place on a
// changed line, numbered, each with the id `bun run not-slop -- answer` takes; writes the whole
// report, with each shape's argument, into the git directory, where it is never committed; and
// says what to do.
//
// It never refuses a commit. The best measured scan is right about seven times in ten, and the
// census contract is that a heuristic may report and must never block. The lines are read from
// the working tree against HEAD, as the linter before it reads the files, so a partially staged
// file is judged on what is on disk.

import { resolve } from "../../src/meta/path.ts";
import { runTextSyncOrThrow } from "../../src/meta/subprocess.ts";
import { TREE_FINDING_ARGUMENTS, type TreeSite, treeFindings } from "./tree-findings.ts";

/** Sites printed to the terminal before the rest are left to the report. */
const PRINTED = 8;

const git = (args: readonly string[]): string => runTextSyncOrThrow(["git", ...args]);

/** Each changed file's changed lines in the working tree, and whether the file is new. */
function changedLines(): Map<string, { lines: Set<number>; added: boolean }> {
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split("\n").filter(Boolean);
  const added = new Set(git(["diff", "--cached", "--name-only", "--diff-filter=A"]).split("\n"));
  const changed = new Map(staged.map((path) => [path, { lines: new Set<number>(), added: added.has(path) }]));
  if (staged.length === 0) return changed;
  let lines: Set<number> | undefined;
  for (const row of git(["diff", "HEAD", "--unified=0", "--no-color", "--", ...staged]).split("\n")) {
    if (row.startsWith("+++ ")) lines = changed.get(row.slice(4).replace(/^b\//u, ""))?.lines;
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/u.exec(row);
    if (hunk === null || lines === undefined) continue;
    const start = Number(hunk[1]);
    for (let line = start; line < start + Number(hunk[2] ?? 1); line += 1) lines.add(line);
  }
  return changed;
}

/** Whether a site has a place on a line this commit changes, or is about a file it adds. */
function touches(site: TreeSite, changed: ReturnType<typeof changedLines>): boolean {
  if (site.line === 0) return changed.get(site.path)?.added === true;
  return (site.places ?? [{ path: site.path, line: site.line, end: site.line }]).some((place) =>
    [...(changed.get(place.path)?.lines ?? [])].some((line) => place.line <= line && line <= place.end),
  );
}

const where = (site: TreeSite): string => `${site.path}${site.line === 0 ? "" : `:${site.line}`}`;
/** The command that answers a site no, which writes its ledger row. */
const answer = (site: TreeSite): string => `bun run not-slop -- answer ${site.id} "<why it is not slop>"`;

/** The whole report: every touched site with its places and its shape's argument, then the rest. */
function report(touched: readonly TreeSite[], elsewhere: readonly TreeSite[]): string {
  const head = git(["rev-parse", "--short=9", "HEAD"]).trim();
  const sites = touched.map((site, index) =>
    [
      `## ${index + 1}. ${site.kind} — ${where(site)}`,
      "",
      site.detail,
      "",
      ...(site.places === undefined
        ? []
        : [
            `Places: ${site.places.map((place) => `${place.path}:${place.line}–${place.end}`).join(", ")}`,
            "",
          ]),
      `Why this shape is slop: ${TREE_FINDING_ARGUMENTS[site.kind]}`,
      "",
      "Not slop? Answer it with a reason a reviewer can check against the code:",
      "",
      `    ${answer(site)}`,
    ].join("\n"),
  );
  const rest = elsewhere.map((site) => `- ${site.kind} ${where(site)} [${site.id}] ${site.detail}`);
  return [
    `# Slop report, ${new Date().toISOString()}, on HEAD ${head}`,
    "",
    `${touched.length} sites touch the lines this commit changes; ${elsewhere.length} more sit elsewhere in the files it stages.`,
    "",
    ...sites.flatMap((text) => [text, ""]),
    ...(rest.length === 0
      ? []
      : ["## Elsewhere in the staged files, not on a changed line", "", ...rest, ""]),
  ].join("\n");
}

/** What the agent or person committing reads: the sites, where the rest is, and the two answers. */
function message(first: TreeSite, touched: readonly TreeSite[], log: string): string {
  const shown = touched.slice(0, PRINTED).map((site, index) => {
    const detail = site.detail.length > 110 ? `${site.detail.slice(0, 109)}…` : site.detail;
    return `  ${index + 1}. ${site.kind} ${where(site)} [${site.id}]\n     ${detail}`;
  });
  const more = touched.length > PRINTED ? [`  … and ${touched.length - PRINTED} more in the report.`] : [];
  return [
    `slop: ${touched.length} ${touched.length === 1 ? "site touches" : "sites touch"} lines this commit changes. Advisory: the commit is not stopped.`,
    ...shown,
    ...more,
    `Full report, with why each shape counts as slop: ${log}`,
    "Judge each site: these are heuristics, and the best measured is wrong about three times in ten.",
    "Real: fix it before this commit, or amend it after (git commit --amend).",
    "Not slop: answer it with a reason a reviewer can check, and commit the ledger row it writes;",
    "the scans then skip that site here and in bun run simplify. Do not change code only to silence one.",
    `  ${answer(first)}`,
  ].join("\n");
}

const changed = changedLines();
const sites = treeFindings().filter((site) =>
  (site.places ?? [site]).some((place) => changed.has(place.path)),
);
const touched = sites.filter((site) => touches(site, changed));
const [first] = touched;
if (first !== undefined) {
  const log = resolve(git(["rev-parse", "--git-path", "ana/slop-report.md"]).trim());
  await Bun.write(
    log,
    report(
      touched,
      sites.filter((site) => !touched.includes(site)),
    ),
  );
  console.error(message(first, touched, log));
}
