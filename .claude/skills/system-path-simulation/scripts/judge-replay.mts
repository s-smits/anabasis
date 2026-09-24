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
 * `review-settle.mts` takes. Exit 2 is an argument or position fault, exit 1 a recorded file the
 * strict readers refuse; a verdict is never an exit code.
 */
import { mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join, relative } from "#src/meta/path.ts";
import { CASE_ARTIFACT_FILE, CASE_JUDGE_FILE } from "#src/truth/battery-record.ts";
import { loadRepoEnv } from "#src/backends/env.ts";
import { resolveSlots } from "#src/backends/resolve.ts";
import { judgeSessionFor } from "#src/review/review-session.ts";
import { judgeSubject } from "#src/truth/judge.ts";
import { judgeBatterySubject } from "#src/truth/judge-phase.ts";
import { judgePublicTaskOf, readValidatedBrief } from "#src/truth/public-resources.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { type JsonObject, isBoolean, isRecord } from "#src/meta/json-shape.ts";
import { JUDGE_PUBLIC_CONTEXT_FILE, JUDGE_PUBLIC_CONTEXT_SCHEMA } from "#src/truth/declared-projection.ts";
import type { JudgePublicDomain } from "#src/truth/judge-contract.ts";
import { type ContestedCase, contestedCases, isVetoed } from "#src/analyse/judge-contested.ts";
import { type CommandArgs, type ExitWith, runCommand } from "#skills/main/cli.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { loadRecordedTasks } from "#src/run/run-driver.ts";

const REPO_ROOT = join(import.meta.dir, "../../../..");

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

async function replay(args: CommandArgs): Promise<void> {
  // Annotated, because TypeScript narrows through a `never` call only on an explicitly typed const.
  const die: ExitWith = args.die;
  const readRecord = (path: string): JsonObject => {
    const value = readJsonFile(path);
    if (!isRecord(value)) die(`${path}: not a JSON object`);
    return value;
  };
  const repo = args.required("repo");
  const slug = args.required("slug");
  const runId = args.required("run");
  const out = args.required("out");
  const taskIds = args.list("task");
  if (taskIds.length === 0) die("--task is required at least once");
  const repeat = args.int("repeat") ?? 1;
  if (repeat < 1) die("--repeat must be a positive integer");
  const rows: ReplayRow[] = [];
  const vetoed: ContestedCase[] = [];

  const versionDir = join(campaignDir(repo, slug), "versions", runId);
  const runDir = join(versionDir, "runs", runId);
  const brief = readValidatedBrief(versionDir);
  if (brief === null) die(`${versionDir}: brief missing or invalid under the current reader`);
  const tasks = loadRecordedTasks(versionDir);
  const judgeContext = readRecord(join(runDir, JUDGE_PUBLIC_CONTEXT_FILE));
  if (judgeContext.schema !== JUDGE_PUBLIC_CONTEXT_SCHEMA || !isRecord(judgeContext.publicDomain)) {
    die(`${runDir}: ${JUDGE_PUBLIC_CONTEXT_FILE} is not ${JUDGE_PUBLIC_CONTEXT_SCHEMA}`);
  }
  // SAFETY: the run's own judge context under the schema the Judge phase writes, whose publicDomain field is this type.
  const judgeDomain = judgeContext.publicDomain as unknown as JudgePublicDomain;
  const checkByAssertion = new Map(brief.truthChecks.map((check) => [check.assertion, check.id] as const));

  const review = resolveSlots(repo, slug, loadRepoEnv(repo, Bun.env)).review;
  const session = judgeSessionFor(review, REPO_ROOT);
  if (session === null) die("the review slot is off in the named checkout");
  console.log(JSON.stringify({ review, pin: session.pin, promptPolicyDigest: session.promptPolicyDigest }));

  for (const taskId of taskIds) {
    const task = tasks.find((row) => row.taskId === taskId);
    if (task === undefined) die(`task ${taskId} is not in tasks.json`);
    const caseDir = join(runDir, "cases", taskId);
    const recorded = readRecord(join(caseDir, CASE_JUDGE_FILE));
    const verifierPass = readRecord(join(caseDir, "case-result.json")).pass;
    if (!isBoolean(verifierPass)) die(`${taskId}: no boolean verifier verdict; production never judges it`);
    const judgeTask = judgePublicTaskOf(brief, task);
    const subject = judgeBatterySubject({
      taskId,
      judgeDomain,
      judgeTask,
      submittedArtifact: readJsonFile(join(caseDir, CASE_ARTIFACT_FILE)),
      truthOk: verifierPass,
    });
    if (subject === null) die(`${taskId}: no accepted artifact; production never judges it`);
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
        recordedVerdict: isBoolean(recorded.verdict) ? recorded.verdict : null,
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
      // The controller's own projection and veto test, so a replayed fail counts as a veto exactly
      // when the Epoch Reviewer would be asked to settle it: confirmed, and citing a shown rule.
      const contested = contestedCases(
        [
          {
            taskId,
            family: task.family,
            truthOk: verifierPass,
            judgePath: relative(repo, join(caseDir, CASE_JUDGE_FILE)),
            judgeEvidence: evidence,
            artifactPath: relative(repo, join(caseDir, CASE_ARTIFACT_FILE)),
            failedCheckIds: [],
          },
        ],
        checkByAssertion,
      );
      vetoed.push(...contested.filter(isVetoed));
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
}

if (import.meta.main) {
  await runCommand(
    {
      name: "judge-replay",
      usage:
        "usage: judge-replay.mts --repo /abs/checkout --slug <slug> --run <runId> --task <taskId> [--task <taskId>...] [--repeat <n>] --out /abs/report-dir",
      options: { repo: "abs", slug: "text", run: "text", task: "list", repeat: "int", out: "abs" },
    },
    replay,
  );
}
