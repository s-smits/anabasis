/**
 * Run the live Epoch Reviewer over a recorded battery with vetoed rows to settle, from a scratch
 * copy of the campaign so no review evidence lands under the real campaigns/ and no earlier review
 * of that condition short-circuits the run.
 *
 * The first two launches of this position on 2026-09-15 failed on staging, not on the reviewer:
 * a grepped case-record.jsonl broke the append order, then the claim file was missing. The copy
 * this script makes is the whole set the analysis reader needs: the version tree (symlinks kept,
 * so `.toolchain` still resolves), case-record.jsonl, claims/<runId>.json and the run's isolation
 * probe.
 *
 *   bun .claude/skills/system-path-simulation/scripts/review-settle.mts \
 *     --repo /abs/checkout-with-campaigns --slug <slug> --run <runId> \
 *     --scratch /abs/empty-or-new-dir [--vetoed /abs/vetoed.json]
 *
 * `--vetoed` is the ContestedCase array `judge-replay.mts` writes, or one built by hand from a
 * recorded judge.json; its evidence and artifact paths are repo-root-relative and resolve under the
 * scratch root. It is optional: the run this position most wants to replay is often one with no
 * contested row at all, and requiring a veto excluded those. `--repo` also supplies the review slot
 * through its `.env` chain; the reviewer's orientation, tools and admission run from this script's
 * own tree.
 *
 * The staged copy carries the campaign's `analysis/` directory, because two of the reviewer's
 * rules read it and neither can fire without it: recurrence, which is what lifts a second
 * occurrence of one defect above the first-occurrence advisory floor, and reuse, which refuses a
 * condition an earlier review already read to completion under the same prompt. The standing issue
 * ledger comes from the same directory, so the replayed review can dispute an issue the way
 * production offers it one. A campaign that ended before its analyse step has no such directory;
 * that replay runs with an empty ledger rather than being refused.
 *
 * Output: `<scratch>/<runId>-epoch-review.json`, the EpochReviewEvidence as production would
 * record it, and a summary line with status, reads, findings and disputes. Exit 2 is a script or
 * staging fault; the review's own status is in the evidence, never an exit code.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import { loadRepoEnv } from "#src/backends/env.ts";
import { resolveSlots } from "#src/backends/resolve.ts";
import { deriveIterationAnalysis } from "#src/analyse/iteration-analysis.ts";
import { runEpochReview } from "#src/review/epoch-reviewer.ts";
import { readLatestRebuildAdvice } from "#src/author/rebuild-advice.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { isString } from "#src/meta/json-shape.ts";
import type { ContestedCase } from "#src/analyse/judge-contested.ts";
import { type ExitWith, exitWith, parseOrDie } from "./cli-args.mts";
import { CASE_RECORD_FILE } from "#src/claim/case-record.ts";
import { JUDGE_PUBLIC_CONTEXT_FILE } from "#src/truth/declared-projection.ts";

const fail: ExitWith = exitWith("review-settle");

const args = parseOrDie(fail, { values: ["repo", "slug", "run", "vetoed", "scratch", "request"] });
for (const name of ["repo", "slug", "run", "scratch"]) {
  if (!args.single.has(name)) fail(`--${name} is required`);
}
for (const name of ["repo", "scratch"]) {
  if (!isAbsolute(args.single.get(name) ?? "")) fail(`--${name} must be an absolute path`);
}
if (args.single.has("vetoed") && !isAbsolute(args.single.get("vetoed") ?? "")) {
  fail("--vetoed must be an absolute path");
}
const repo = args.single.get("repo") ?? "";
const slug = args.single.get("slug") ?? "";
const runId = args.single.get("run") ?? "";
const scratch = args.single.get("scratch") ?? "";
const vetoedPath = args.single.get("vetoed") ?? "";
if (vetoedPath !== "" && !existsSync(vetoedPath)) fail(`${vetoedPath}: missing`);
const vetoed: ContestedCase[] = vetoedPath === "" ? [] : JSON.parse(readFileSync(vetoedPath, "utf8"));
if (!Array.isArray(vetoed)) fail(`${vetoedPath}: expected a ContestedCase array`);

// Stage: the version tree, the append-ordered case record, the claim and the isolation probe,
// and `analysis/` when the campaign reached its analyse step. That directory is optional because
// the run this position most wants to replay is often one that ended before it: of 113 recorded
// campaigns on 2026-09-17, nine hold a claim with no `analysis/` at all. Requiring it would refuse
// exactly those, and the standing ledger below already reads as empty when the file is absent.
const source = campaignDir(repo, slug);
const target = campaignDir(scratch, slug);
const staged = [
  [join("versions", runId), true, true],
  [CASE_RECORD_FILE, false, true],
  [join("claims", `${runId}.json`), false, true],
  [`isolation-probe-${runId}.json`, false, true],
  ["analysis", true, false],
] as const;
for (const [rel, directory, required] of staged) {
  if (!existsSync(join(source, rel))) {
    if (required) fail(`${join(source, rel)}: missing; the analysis reader needs it`);
    continue;
  }
  if (existsSync(join(target, rel))) continue;
  mkdirSync(join(target, rel, ".."), { recursive: true });
  cpSync(join(source, rel), join(target, rel), { recursive: directory, verbatimSymlinks: true });
}
const measuredDir = join(target, "versions", runId);
// The Judge's public context is where the operator's verbatim one-liner survives, and it exists
// only when a Judge ran. `--request` supplies it for a battery reviewed without one; without either
// the reviewer is told the request is unavailable, and its request-coverage obligation goes unasked.
const contextPath = join(measuredDir, "runs", runId, JUDGE_PUBLIC_CONTEXT_FILE);
const recordedRequest: unknown = existsSync(contextPath)
  ? JSON.parse(readFileSync(contextPath, "utf8")).publicRequest
  : undefined;
const publicRequest: unknown = args.single.get("request") ?? recordedRequest;
// The packet this battery's own analyse step offered, read through its owner so a foreign schema
// reads as null here exactly as it does in production. A packet with no standing issue is a review
// that cannot dispute anything, which is the wrong condition to replay a dispute rule under.
const priorAdvice = readLatestRebuildAdvice(scratch, slug);

const review = resolveSlots(repo, slug, loadRepoEnv(repo, Bun.env)).review;
console.log(JSON.stringify({ review, staged: target }));
const analysis = deriveIterationAnalysis(scratch, slug, runId, measuredDir);
console.log(
  JSON.stringify({
    cases: analysis.cases.length,
    treeRoot: analysis.treeRoot,
    vetoed: vetoed.map((row) => row.taskId),
    issues: priorAdvice?.issues.length ?? 0,
    request: isString(publicRequest),
  }),
);
const started = Date.now();
const evidence = await runEpochReview({
  repoRoot: scratch,
  slug,
  runId,
  treeRoot: analysis.treeRoot,
  analysis,
  priorAdvice,
  vetoed,
  review,
  publicRequest: isString(publicRequest) ? publicRequest : null,
});
const out = join(scratch, `${runId}-epoch-review.json`);
writeFileSync(out, JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify(
    {
      elapsedMs: Date.now() - started,
      status: evidence.status,
      reason: evidence.reason,
      reads: evidence.reads.length,
      coverage: evidence.coverage,
      findings: evidence.findings,
      disputes: evidence.disputes,
      report: evidence.report,
    },
    null,
    2,
  ),
);
console.log(`evidence written to ${out}`);
