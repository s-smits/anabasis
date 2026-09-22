/**
 * Replay the live Main Judge over recorded battery cases of one run, under the current tree's
 * prompt policy and verdict schema. Reads recorded bytes only and writes nothing under campaigns/.
 *
 * On 2026-09-15 this replay refuted its own first prediction in six minutes: both recorded truss
 * disputes chosen as genuine vetoes turned out to be the recorded Judge's arithmetic, and the
 * prompt sentence that came out of it is the recompute rule in judge-prompt-policy.ts. The second
 * position (run 23a1bc-i04) produced the split verdict that bounds what one sample proves.
 *
 *   bun .claude/skills/system-path-simulation/scripts/judge-replay.mts \
 *     --repo /abs/checkout-with-campaigns --slug <slug> --run <runId> \
 *     --task <taskId> [--task <taskId>...] [--repeat <n>] --out /abs/report-dir
 *
 * `--repo` names the checkout whose `campaigns/` holds the run and whose `.env` chain resolves the
 * review slot; the Judge itself runs from this script's own tree, so the prompt under test is the
 * one being changed. Each sample is a fresh Judge session, as in production.
 *
 * Output: `verdicts.json` (schema `judge-replay/v1`), one row per task and sample with the
 * recorded verdict, the replayed verdict, the confirming sample's verdict when a cited fail took one, cited rules, the check ids those rules join to, the
 * rationale and whether the request digest still matches the recording; and `vetoed.json`, the
 * ContestedCase rows for every verifier pass the replay failed with a citation, in the form
 * `review-settle.mts` takes. Exit 2 is a script or position fault; a verdict is never an exit code.
 */
import { existsSync, mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import { TASKS_FILE } from "#src/meta/bundle-layout.ts";
import { CASE_ARTIFACT_FILE, CASE_JUDGE_FILE } from "#src/truth/battery-record.ts";
import { loadRepoEnv } from "#src/backends/env.ts";
import { resolveSlots } from "#src/backends/resolve.ts";
import { judgeSessionFor } from "#src/review/review-session.ts";
import { confirmedDisagreement, judgeSubject } from "#src/truth/judge.ts";
import { judgeBatterySubject } from "#src/truth/judge-phase.ts";
import { judgePublicTaskOf, readValidatedBrief } from "#src/truth/public-resources.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { isBoolean } from "#src/meta/json-shape.ts";
import { JUDGE_PUBLIC_CONTEXT_FILE } from "#src/truth/declared-projection.ts";
import type { ContestedCase } from "#src/analyse/judge-contested.ts";
import { type ExitWith, exitWith, parseOrDie } from "./cli-args.mts";
import { readJsonFile } from "#src/meta/completed-json.ts";

const REPO_ROOT = join(import.meta.dir, "../../../..");

const fail: ExitWith = exitWith("judge-replay");

interface ReplayRow {
  taskId: string;
  sample: number;
  elapsedMs: number;
  digestMatch: boolean | null;
  verifierPass: boolean;
  recordedVerdict: boolean | null;
  verdict: boolean | null;
  confirmation: boolean | null;
  abstained: boolean;
  rules: string[];
  checkIds: string[];
  rationale: string | null;
  error: string | null;
  errorKind: string | null;
}
const rows: ReplayRow[] = [];
const vetoed: ContestedCase[] = [];
function readJson(path: string): any {
  if (!existsSync(path)) fail(`${path}: missing`);
  return readJsonFile(path);
}

const args = parseOrDie(fail, { values: ["repo", "slug", "run", "repeat", "out"], repeatable: ["task"] });
for (const name of ["repo", "slug", "run", "out"]) if (!args.single.has(name)) fail(`--${name} is required`);
for (const name of ["repo", "out"]) {
  if (!isAbsolute(args.single.get(name) ?? "")) fail(`--${name} must be an absolute path`);
}
const repo = args.single.get("repo") ?? "";
const slug = args.single.get("slug") ?? "";
const runId = args.single.get("run") ?? "";
const out = args.single.get("out") ?? "";
const taskIds = args.repeated.get("task") ?? [];
if (taskIds.length === 0) fail("--task is required at least once");
const repeat = Number(args.single.get("repeat") ?? "1");
if (!Number.isInteger(repeat) || repeat < 1) fail("--repeat must be a positive integer");

const versionDir = join(campaignDir(repo, slug), "versions", runId);
const runDir = join(versionDir, "runs", runId);
const brief = readValidatedBrief(versionDir);
if (brief === null) fail(`${versionDir}: brief missing or invalid under the current reader`);
const tasksFile = readJson(join(versionDir, TASKS_FILE));
const tasks: Array<{ taskId: string; family: string }> = Array.isArray(tasksFile)
  ? tasksFile
  : tasksFile.tasks;
const judgeDomain = readJson(join(runDir, JUDGE_PUBLIC_CONTEXT_FILE)).publicDomain;
const checkByAssertion = new Map(brief.truthChecks.map((check) => [check.assertion, check.id] as const));

const review = resolveSlots(repo, slug, loadRepoEnv(repo, Bun.env)).review;
const session = judgeSessionFor(review, REPO_ROOT);
if (session === null) fail("the review slot is off in the named checkout");
console.log(JSON.stringify({ review, pin: session.pin, promptPolicyDigest: session.promptPolicyDigest }));

for (const taskId of taskIds) {
  const task = tasks.find((row) => row.taskId === taskId);
  if (task === undefined) fail(`task ${taskId} is not in tasks.json`);
  const caseDir = join(runDir, "cases", taskId);
  const recorded = readJson(join(caseDir, CASE_JUDGE_FILE));
  const verifierPass: unknown = readJson(join(caseDir, "case-result.json")).pass;
  if (!isBoolean(verifierPass)) fail(`${taskId}: no boolean verifier verdict; production never judges it`);
  // SAFETY: the row comes from the run's own tasks.json, the file judgePublicTaskOf reads in production.
  const judgeTask = judgePublicTaskOf(brief, task as never);
  const subject = judgeBatterySubject({
    taskId,
    judgeDomain,
    judgeTask,
    submittedArtifact: readJson(join(caseDir, CASE_ARTIFACT_FILE)),
    truthOk: verifierPass,
  });
  if (subject === null) fail(`${taskId}: no accepted artifact; production never judges it`);
  for (let sample = 1; sample <= repeat; sample += 1) {
    const started = Date.now();
    const evidence = await judgeSubject(session, subject.request, subject.subjectKind, verifierPass);
    const { rules } = evidence;
    const checkIds = [...new Set(rules.flatMap((rule) => checkByAssertion.get(rule) ?? []))];
    const row: ReplayRow = {
      taskId,
      sample,
      elapsedMs: Date.now() - started,
      // A v2 subject recorded no input digest, so there is nothing to match rather than a mismatch.
      digestMatch:
        recorded.schema !== "judge-subject/v3" || evidence.schema !== "judge-subject/v3"
          ? null
          : recorded.judgeInputDigest === evidence.judgeInputDigest,
      verifierPass,
      recordedVerdict: recorded.verdict,
      verdict: evidence.verdict,
      confirmation: evidence.confirmation?.verdict ?? null,
      abstained: evidence.abstained,
      rules,
      checkIds,
      rationale: evidence.rationale,
      error: evidence.error,
      errorKind: evidence.errorKind ?? null,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    if (verifierPass === true && evidence.verdict === false && confirmedDisagreement(evidence)) {
      const relative = (name: string) =>
        join("campaigns", slug, "versions", runId, "runs", runId, "cases", taskId, name);
      vetoed.push({
        taskId,
        family: task.family,
        judge: false,
        verifier: true,
        rules,
        rationale: evidence.rationale,
        confirmed: true,
        checkIds,
        evidence: relative(CASE_JUDGE_FILE),
        artifact: relative(CASE_ARTIFACT_FILE),
      });
    }
  }
}
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "verdicts.json"),
  JSON.stringify(
    {
      schema: "judge-replay/v1",
      slug,
      runId,
      pin: session.pin,
      promptPolicyDigest: session.promptPolicyDigest,
      rows,
    },
    null,
    2,
  ),
);
writeFileSync(join(out, "vetoed.json"), JSON.stringify(vetoed, null, 2));
console.log(`${rows.length} verdict(s), ${vetoed.length} vetoed row(s) written to ${out}`);
