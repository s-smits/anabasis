/**
 * Which past run to simulate from, read off the run syntheses instead of remembered.
 *
 * `notes/runs/<campaign>/main_synthesis.md` opens with the bound identity (campaign, runId, source
 * revision, slots, outcome, recorded denominator) and `review.json` carries the adjudication. This
 * prints those facts for every reviewed run, plus the one fact the note cannot hold: whether that
 * run's source is an ancestor of the tree you are about to measure, and how many commits lie
 * between them. A defect recorded against a source that is not an ancestor may already be gone;
 * one recorded against an ancestor with zero commits since is the current product.
 *
 * `--component <term>` counts the term's occurrences in each synthesis and its digest, so "which
 * runs saw the engine wall" is a column rather than five file reads. The script ranks nothing:
 * the choice of run is the simulation's first prediction and belongs in the note.
 *
 *   bun .claude/skills/system-path-simulation/scripts/pick-run.mts \
 *     --tree /abs/worktree-under-test [--notes /abs/notes/runs] [--component "engine wall"] [--json]
 */

import { existsSync, readFileSync, readdirSync } from "#src/meta/filesystem.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { gitMaybe } from "#skills/main/git.ts";
import { absoluteOption, type ExitWith, exitWith, parseOrDie } from "#skills/main/cli.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

const die: ExitWith = exitWith("pick-run");

const REPO_ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "../../../..");

const parsed = parseOrDie(die, { values: ["tree", "notes", "component"], flags: ["json"] });

const absolute = absoluteOption(die);

export interface RunFacts {
  campaign: string;
  reviewed: string | null;
  runId: string | null;
  source: string | null;
  outcome: string | null;
  terminalReason: string | null;
  denominator: string | null;
  headings: string[];
  adjudication: string | null;
  resultGroups: JsonObject | null;
  ancestor: boolean | null;
  onMain: boolean | null;
  commitsSince: number | null;
  componentHits: number | null;
}

/** The identity paragraph is prose (newer notes) or a table (older ones), so every field is a
 *  tolerant read and `null` when absent. The run date falls back to the runId's own timestamp. */
const RUN_ID = /fullrun-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/;
const OUTCOME_PATTERNS = [
  /outcome `([^`\d][^`]*)`/,
  /\| Terminal \| `([^`]+)`/,
  /[Tt]erminal:? `([^`\d][^`]*)`/,
  /[Tt]erminal: [^`]{0,40}`([^`\d][^`]*)`/,
  /ended(?: on)? `([^`\d][^`]*)`/,
  /with terminal `([^`\d][^`]*)`/,
];
const DENOMINATOR_PATTERNS = [
  /\| Recorded denominator \| ([^|]+)\|/,
  /Recorded denominator[^.]*\./,
  /recorded (\d+ verified cases)/,
  // Historical synthesis vocabulary remains readable.
  /\| Sealed denominator \| ([^|]+)\|/,
  /Sealed denominator[^.]*\./,
  /Denominators?: ([^.]+)\./,
  /## Denominators ([^.]+)\./,
  /sealed (\d+ verified cases)/,
  /[^.|]*\bdenominator\b[^.|]*\./i,
];

/** One `git` invocation: whether it exited zero, and its trimmed standard output. */
interface GitResult {
  ok: boolean;
  out: string;
}

interface Review {
  adjudication: string | null;
  resultGroups: JsonObject | null;
  sourceRevision: string | null;
}

const NO_REVIEW: Review = { adjudication: null, resultGroups: null, sourceRevision: null };

const runs: RunFacts[] = [];
/** The same check, for an option that has a default when it is not given at all. */
function absoluteOr(option: string, fallback: string): string {
  const value = parsed.single.get(option);
  return value === undefined ? fallback : absolute(option, value);
}

const tree = absoluteOr("tree", REPO_ROOT);
const notes = absoluteOr("notes", join(REPO_ROOT, "notes", "runs"));
const component = parsed.single.get("component") ?? null;
if (!existsSync(notes)) die(`${notes} does not exist`);

function first(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match?.[1] ?? null;
}

/** The syntheses under notes/runs were written by hand over two weeks in at least five shapes
 *  (prose identity line, identity table, bullet list, `Run: … · campaign … · source …`). Each fact
 *  tries the spellings seen there in order; a fact none matches stays null and prints as `?`. */
export function parseSynthesis(
  text: string,
  review: { sourceRevision: string | null },
): Omit<
  RunFacts,
  "campaign" | "ancestor" | "onMain" | "commitsSince" | "componentHits" | "adjudication" | "resultGroups"
> {
  const flat = text.replace(/\s+/g, " ");
  const runId =
    first(flat, /runId `([^`]+)`/) ??
    first(flat, /\| Run \| `([^`]+)`/) ??
    first(flat, new RegExp(`(${RUN_ID.source})`));
  const outcome =
    OUTCOME_PATTERNS.map((pattern) => first(flat, pattern)).find((value) => value !== null) ?? null;
  const denominatorMatch =
    DENOMINATOR_PATTERNS.map((pattern) => pattern.exec(flat)).find((match) => match !== null) ?? null;
  return {
    reviewed:
      first(flat, /Reviewed (\d{4}-\d{2}-\d{2})/) ??
      (runId === null ? null : first(runId, /(\d{4}-\d{2}-\d{2})/)),
    runId,
    source: first(flat, /[Ss]ource[^`]{0,12}`([0-9a-f]{7,40})`/) ?? review.sourceRevision,
    outcome,
    terminalReason: first(flat, /terminalReason `([^`]+)`/),
    denominator:
      denominatorMatch === null ? null : (denominatorMatch[1] ?? denominatorMatch[0]).trim().slice(0, 160),
    headings: text
      .matchAll(/^## (.+)$/gm)
      .map((row) => row[1] ?? "")
      .filter((heading) => heading !== "")
      .toArray(),
  };
}

function git(args: string[]): GitResult {
  const out = gitMaybe(tree, ...args);
  return { ok: out !== null, out: out ?? "" };
}

/** Reports ancestry against local HEAD and origin/main. These facts alone do not establish a
 * squash merge or equivalent source; inspect the relevant diff when ancestry is absent. */
function ancestry(source: string | null): Pick<RunFacts, "ancestor" | "onMain" | "commitsSince"> {
  if (source === null) return { ancestor: null, onMain: null, commitsSince: null };
  const known = git(["cat-file", "-e", `${source}^{commit}`]);
  if (!known.ok) return { ancestor: null, onMain: null, commitsSince: null };
  const onMain = git(["rev-parse", "--verify", "-q", "origin/main^{commit}"]).ok
    ? git(["merge-base", "--is-ancestor", source, "origin/main"]).ok
    : null;
  const isAncestor = git(["merge-base", "--is-ancestor", source, "HEAD"]).ok;
  if (!isAncestor) return { ancestor: false, onMain, commitsSince: null };
  const count = git(["rev-list", "--count", `${source}..HEAD`]);
  return { ancestor: true, onMain, commitsSince: count.ok ? Number(count.out) : null };
}

function countHits(dir: string, term: string): number {
  let hits = 0;
  const needle = term.toLowerCase();
  for (const name of ["main_synthesis.md", "digest.md", "luna_syntheses.md"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const haystack = readFileSync(path, "utf8").toLowerCase();
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      hits += 1;
      at = haystack.indexOf(needle, at + needle.length);
    }
  }
  return hits;
}

function readReview(dir: string): Review {
  const path = join(dir, "review.json");
  if (!existsSync(path)) return NO_REVIEW;
  try {
    const review = asRecord(readJsonFile(path));
    if (review === null) return NO_REVIEW;
    return {
      adjudication: isString(review.adjudication) ? review.adjudication : null,
      resultGroups: asRecord(review.resultGroups),
      sourceRevision: isString(review.sourceRevision)
        ? (/^[0-9a-f]{7,40}/.exec(review.sourceRevision)?.[0] ?? null)
        : null,
    };
  } catch {
    return NO_REVIEW;
  }
}

for (const campaign of readdirSync(notes).sort()) {
  const dir = join(notes, campaign);
  const synthesis = join(dir, "main_synthesis.md");
  if (!existsSync(synthesis)) continue;
  const review = readReview(dir);
  const facts = parseSynthesis(readFileSync(synthesis, "utf8"), review);
  // A synthesis that opens with prose may keep its identity line in the digest or the session
  // archive; those two are read only for the facts the synthesis itself does not state.
  for (const sibling of ["digest.md", "luna_syntheses.md"]) {
    if (facts.runId !== null && facts.source !== null) break;
    const path = join(dir, sibling);
    if (!existsSync(path)) continue;
    const more = parseSynthesis(readFileSync(path, "utf8"), review);
    facts.runId ??= more.runId;
    facts.reviewed ??= more.reviewed;
    facts.source ??= more.source;
  }
  runs.push({
    campaign,
    ...facts,
    adjudication: review.adjudication,
    resultGroups: review.resultGroups,
    ...ancestry(facts.source),
    componentHits: component === null ? null : countHits(dir, component),
  });
}
runs.sort(
  (a, b) => (b.reviewed ?? "").localeCompare(a.reviewed ?? "") || a.campaign.localeCompare(b.campaign),
);

if (parsed.flags.has("json")) {
  console.log(JSON.stringify({ tree, notes, component, runs }, null, 2));
} else {
  const head = `tree ${tree} (HEAD ${git(["rev-parse", "--short", "HEAD"]).out})`;
  console.log(head);
  for (const run of runs) {
    const main = run.onMain === null ? "" : run.onMain ? " (on origin/main)" : " (not on origin/main either)";
    const anc =
      run.ancestor === null
        ? "source unknown here"
        : run.ancestor
          ? `ancestor, ${run.commitsSince} commit(s) since`
          : `NOT an ancestor${main}`;
    const hits = run.componentHits === null ? "" : ` hits(${component}) ${run.componentHits}`;
    console.log(
      `${run.reviewed ?? "????-??-??"} ${run.campaign}: source ${(run.source ?? "?").slice(0, 9)} ${anc}; outcome ${run.outcome ?? "?"}${run.terminalReason === null ? "" : ` (${run.terminalReason})`}${hits}`,
    );
    if (run.denominator !== null) console.log(`  ${run.denominator}`);
    if (run.adjudication !== null) {
      console.log(`  adjudication ${run.adjudication} ${JSON.stringify(run.resultGroups ?? {})}`);
    }
  }
  if (runs.length === 0) console.log("no reviewed run under " + notes);
}
