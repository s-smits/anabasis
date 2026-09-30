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
 * Each case's subject is the one the controller's own Judge review reads (`caseSubjects`): the
 * verifier verdict, the recorded artifact and the checks the verifier failed, through the recorded
 * evidence reader, with the replayed verdict in place of the recorded one. The failed checks are
 * what make a Judge pass of a verifier fail a disputed fail the reviewer settles; a replay that
 * left them out could only ever produce vetoes.
 *
 * Output: `verdicts.json` (schema `judge-replay/v1`), one row per task and sample with the
 * recorded verdict, the replayed verdict, the confirming sample's verdict when a contradiction took
 * one, cited rules, the check ids those rules join to, the rationale and whether the request digest
 * still matches the recording; and `contested.json`, every ContestedCase row the replay produced in
 * either direction, in the form `review-settle.mts --contested` takes. Exit 2 is an argument or
 * position fault, exit 1 a recorded file the strict readers refuse; a verdict is never an exit code.
 */
import { mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { loadRepoEnv } from "#src/backends/env.ts";
import { resolveSlots } from "#src/backends/resolve.ts";
import { credentialProvenance } from "#src/backends/login-state.ts";
import { judgeSessionFor } from "#src/review/review-session.ts";
import { type JudgeSession, type JudgeSubjectEvidence, judgeSubject } from "#src/review/judge.ts";
import { judgeBatterySubject } from "#src/review/judge-phase.ts";
import { judgePublicTaskOf, readValidatedBrief } from "#src/correctness-bundle/public-resources.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { type JsonObject, isBoolean, isRecord } from "#src/meta/json-shape.ts";
import {
  JUDGE_PUBLIC_CONTEXT_FILE,
  JUDGE_PUBLIC_CONTEXT_SCHEMA,
} from "#src/correctness-bundle/declared-projection.ts";
import type { JudgePublicDomain } from "#src/review/judge-contract.ts";
import { type ContestedCase, contestedCases, reviewerContested } from "#src/analyse/judge-contested.ts";
import { caseSubjects } from "#src/analyse/judge-reviews.ts";
import { deriveIterationAnalysis } from "#src/analyse/iteration-analysis.ts";
import { type CommandArgs, type ExitWith, runCommand } from "#skills/main/cli.ts";
import { scrubSessionEnv } from "./session-env.mts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { loadRecordedTasks } from "#src/run/run-driver.ts";

type Sample = {
  taskId: string;
  sample: number;
  started: number;
  verifierPass: boolean;
  recorded: JsonObject;
  evidence: JudgeSubjectEvidence;
};

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

/** The review slot `--repo` resolves, opened at `--repo`. The session's root is only where its
 *  credential resolves; the prompt and schema are this script's own imports. Until 2026-09-29 it
 *  was this script's tree, which in a worktree holds no `.env`, so every sample came back a
 *  transport non-result naming a missing token. */
function openJudge(repo: string, slug: string, die: ExitWith): JudgeSession {
  const repoEnv = loadRepoEnv(repo, Bun.env);
  const review = resolveSlots(repo, slug, repoEnv).review;
  const session = review.enabled ? judgeSessionFor(review, repo) : null;
  if (!review.enabled || session === null) die("the review slot is off in the named checkout");
  const credential = credentialProvenance(review.kind, repoEnv).source;
  if (credential === null) die(`no ${review.kind} credential resolves from ${repo}'s env chain`);
  console.log(
    JSON.stringify({ review, credential, pin: session.pin, promptPolicyDigest: session.promptPolicyDigest }),
  );
  return session;
}

function replayRow(
  { taskId, sample, started, verifierPass, recorded, evidence }: Sample,
  checkByAssertion: ReadonlyMap<string, string>,
): ReplayRow {
  const { rules } = evidence;
  return {
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
    checkIds: [...new Set(rules.flatMap((rule) => checkByAssertion.get(rule) ?? []))],
    rationale: evidence.rationale,
    error: evidence.error,
    errorKind: evidence.errorKind ?? null,
  };
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
  const contested: ContestedCase[] = [];

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
  const subjects = caseSubjects(deriveIterationAnalysis(repo, slug, runId, versionDir), repo);

  const session = openJudge(repo, slug, die);

  for (const taskId of taskIds) {
    const task = tasks.find((row) => row.taskId === taskId);
    if (task === undefined) die(`task ${taskId} is not in tasks.json`);
    const recordedSubject = subjects.find((row) => row.taskId === taskId);
    const verifierPass = recordedSubject?.truthOk;
    if (!isBoolean(verifierPass)) die(`${taskId}: no boolean verifier verdict; production never judges it`);
    const artifactPath = recordedSubject?.artifactPath ?? null;
    const judgePath = recordedSubject?.judgePath ?? null;
    if (recordedSubject === undefined || artifactPath === null || judgePath === null) {
      die(`${taskId}: no recorded artifact and Judge verdict the evidence reader accepts`);
    }
    const recorded = readRecord(join(repo, judgePath));
    const subject = judgeBatterySubject({
      taskId,
      judgeDomain,
      judgeTask: judgePublicTaskOf(brief, task),
      submittedArtifact: readJsonFile(join(repo, artifactPath)),
      truthOk: verifierPass,
    });
    if (subject === null) die(`${taskId}: no accepted artifact; production never judges it`);
    for (let sample = 1; sample <= repeat; sample += 1) {
      const started = Date.now();
      const evidence = await judgeSubject(session, subject.request, subject.subjectKind, verifierPass);
      const row = replayRow({ taskId, sample, started, verifierPass, recorded, evidence }, checkByAssertion);
      rows.push(row);
      console.log(JSON.stringify(row));
      // The controller's own projection over the recorded subject, so a replayed contradiction
      // reaches the Epoch Reviewer exactly as the controller would hand it over.
      contested.push(...contestedCases([{ ...recordedSubject, judgeEvidence: evidence }], checkByAssertion));
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
  writeFileSync(join(out, "contested.json"), JSON.stringify(contested, null, 2));
  const { settle, otherContested } = reviewerContested(contested);
  console.log(
    `${rows.length} verdict(s) and ${contested.length} contested row(s) written to ${out}: ${settle.length} to settle, ${otherContested.length} other`,
  );
}

if (import.meta.main) {
  await runCommand(
    {
      name: "judge-replay",
      usage:
        "usage: judge-replay.mts --repo /abs/checkout --slug <slug> --run <runId> --task <taskId> [--task <taskId>...] [--repeat <n>] --out /abs/report-dir",
      options: { repo: "abs", slug: "text", run: "text", task: "list", repeat: "int", out: "abs" },
    },
    (args) => {
      // The calling session's own variables never reach the judge's CLI (session-env.mts).
      const strippedEnv = scrubSessionEnv();
      if (strippedEnv.length > 0) console.error(`session env: stripped ${strippedEnv.join(" ")}`);
      return replay(args);
    },
  );
}
