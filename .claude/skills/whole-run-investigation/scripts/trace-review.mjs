#!/usr/bin/env bun
// Recorded evidence before interpretation: run every deterministic view for one source-bound run
// and write it to a snapshot directory, which the reviewer reads before launching sessions and
// reconciles every session-reported number against afterwards. Every view is read-only, and the
// outcome CLI takes an absolute campaign path, so a live peer run is read without executing
// anything inside its worktree.

import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { homedir } from "#src/meta/os.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { measuredCheckout, openRecordedRun } from "#skills/main/run.ts";
import { productRoot } from "#src/meta/campaign-root.ts";
import { buildDigest } from "./digest.mjs";
import { buildTimeline } from "./timeline.mjs";
import { buildReviewYield, renderReviewYield } from "./review-yield.mjs";
import { runtimeProcess } from "#src/meta/process.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { buildHarnessEvolution } from "../../final-harness-audit/scripts/harness-versions.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isString } from "#src/meta/json-shape.ts";
import { writeJsonFile } from "#src/meta/completed-json.ts";

const USAGE = `usage: bun run review:collect -- <campaign dir | campaign/controller/<runId>> [--run <runId>] [--repo <measured checkout>] [--out <snapshot dir>] [--cases <n>] [--all]

Point at one folder. The run is the folder's own run, or the campaign's latest opening (--run
selects another). The measured checkout is the current directory or any worktree of this
repository when clean at the run's source commit, otherwise a detached worktree prepared once under
~/.cache/hb4/wri-source. The snapshot lands under ~/.cache/hb4/wri/<runId> unless --out says otherwise.
Collect all standard deterministic views for ONE source-bound run (the default; --all is explicit).
Includes digest, review yield, harness evolution, Builder/tool usage,
outcomes, scan, scorecard, warning observations, all four case partitions and sampled dossiers.
No model calls or automatic product changes. Source-specific missing views remain unavailable.
The private lane 23 trace challenge and optional prose/reference probes keep their own admission.`;

/**
 * One parent identity as a single line. `manifest-inputs.mjs` renders each parent with `String()`,
 * so the projection stays a string here rather than reaching the prompt as `[object Object]`.
 */
function parentLabel(parent) {
  if (parent === null || typeof parent !== "object") return null;
  const commit = isString(parent.commit) ? parent.commit.slice(0, 12) : "unknown-commit";
  const epoch = isString(parent.epoch) ? parent.epoch : "unknown-epoch";
  return `${commit} (epoch ${epoch}, submit #${parent.ordinal ?? "?"}, written ${parent.writtenAt ?? "?"})`;
}

/** The last candidate and last accepted submit, read from the run's own scorecard view, which
 *  resolves them from the Builder execution records; a scorecard without them stays absent. */
function scorecardParents(text) {
  if (text === null) return null;
  try {
    return capturedJsonParse(text)?.reach?.parents ?? null;
  } catch {
    return null;
  }
}

/**
 * The run's accounting as the controller's strict reader states it. `controller` is null when that
 * reader refused the run, and every count is then null with the refusal beside it, rather than a
 * lenient re-read of the same files reporting numbers the controller would not stand behind.
 */
function terminalFacts(opening, controller, controllerError, parents) {
  const recorded = controller?.state === "recorded" ? controller : null;
  const openingUsed = Number.isInteger(opening?.budget?.turnsUsed) ? opening.budget.turnsUsed : null;
  const terminalUsed = recorded?.budget.turnsUsed ?? null;
  const denominator = recorded?.denominator.state === "recorded" ? recorded.denominator : null;
  const rounds = recorded?.iterations.length ?? null;
  const cap = recorded?.terminalReason.match(/round cap (\d+)/)?.[1];
  const budget = recorded?.providerResourceBudget?.terminal ?? null;
  return {
    terminal:
      recorded === null
        ? { state: "unavailable", reason: controllerError ?? `controller evidence ${controller?.state}` }
        : {
            state: "recorded",
            outcome: recorded.outcome,
            abortClause: recorded.abortClause,
            reason: recorded.terminalReason,
            epoch: opening?.epoch?.key ?? null,
            lastIteration: recorded.lastIteration,
            iterations: recorded.iterations.length,
            denominator: recorded.denominator,
            providerBudget:
              budget === null ? null : { cap: budget.cap, used: budget.used, byRole: budget.byRole },
          },
    terminalAccounting: {
      controller:
        controller === null ? { state: "refused", error: controllerError } : { state: controller.state },
      // The opening does not record --max-iterations, so a cap is named only when the terminal says it fired.
      outerCap: cap === undefined ? null : Number(cap),
      completedRounds: rounds,
      authorCalls: {
        budget: recorded === null ? null : (recorded.budget.turnBudget ?? "uncapped"),
        opening: openingUsed,
        terminal: terminalUsed,
        delta: openingUsed !== null && terminalUsed !== null ? terminalUsed - openingUsed : null,
        unit: "completed authoring/session-call attempts",
      },
      counts: {
        raw: denominator?.total ?? null,
        real: denominator === null ? null : denominator.verified + denominator.unaccepted,
        controller: rounds,
        semantics: "raw/real are recorded case counts; controller is completed iteration count",
      },
      parents: {
        lastCandidate: parentLabel(parents?.lastCandidate ?? null),
        // Adoption is not a submit row, so no reader supplies it; it never borrows the last candidate.
        adopted: null,
        accepted: parentLabel(parents?.accepted ?? null),
        source:
          parents === null || parents === undefined
            ? "unavailable: this run's scorecard view carried no reach.parents"
            : "outcome --scorecard reach.parents, from the builder execution records",
        lastControllerIteration: recorded?.lastIteration ?? null,
      },
    },
  };
}

/** The run, its opening and the checkout that measured it, or a refusal naming which one failed. */
function measuredRun(args) {
  const folder = args.positionals[0] ?? args.value("campaign");
  if (folder === null) args.die("name a campaign folder or a campaign/controller/<runId> folder");
  const recorded = openRecordedRun(folder, args.value("run"));
  console.error(`run ${recorded.runId} (${recorded.chosen}) in ${recorded.campaign}`);
  if (recorded.controllerError !== null) {
    console.error(
      `the controller's reader refused this run; terminal accounting will name the refusal: ${recorded.controllerError}`,
    );
  }
  let checkout;
  try {
    checkout = measuredCheckout(recorded.source, { repo: args.value("repo"), cwd: runtimeProcess.cwd() });
  } catch (error) {
    throw new CommandFailure(
      `cannot prove a checkout at ${recorded.source.commit}: ${errorMessage(error)}`,
      2,
    );
  }
  console.error(`measured checkout ${checkout.repo} (${checkout.chosen})`);
  const cli = join(checkout.repo, "tools", "outcome", "cli.ts");
  if (!existsSync(cli)) throw new CommandFailure(`missing tools/outcome/cli.ts under ${checkout.repo}`, 2);
  return { ...recorded, checkout, cli };
}

/** Collect every view for the one selected run, returning 1 when the snapshot is incomplete. */
function collectSnapshot(command) {
  const {
    campaign,
    runId,
    opening,
    openingPath,
    controller,
    controllerError,
    source: openingSource,
    checkout,
    cli,
  } = measuredRun(command);
  const repo = checkout.repo;
  const { commit: repoHead, sourceDigest: observedSourceDigest, dirty: observedDirty } = checkout.observed;
  const openingDigest = new Bun.CryptoHasher("sha256").update(readFileSync(openingPath)).digest("hex");
  const caseLimit = String(command.int("cases") ?? 40);
  const out = resolve(command.value("out") ?? join(homedir(), ".cache", "hb4", "wri", runId));
  const views = [];
  let code = 0;
  mkdirSync(out, { recursive: true });

  const runner = [Bun.argv[0], "--no-env-file"];

  /** One view, in-process or by command: `collect` returns its bytes, a status when the bytes say
   *  so and a console note, and a throw becomes a failed view carrying `failure(error)`. The digest
   *  makes each view reconcilable byte-for-byte against the file it names. */
  function capture(
    { runner: runnerLabel = "in-process", required = true, thrownNote, ...row },
    collect,
    failure,
  ) {
    console.write(`${row.label} ... `);
    let result;
    try {
      result = collect();
    } catch (error) {
      result = { text: failure(error), status: "failed", note: thrownNote };
    }
    const { text, status = "ok", note } = result;
    writeFileSync(join(out, row.file), text);
    views.push({
      ...row,
      status,
      bytes: new TextEncoder().encode(text).byteLength,
      sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
      runner: runnerLabel,
      required,
    });
    if (status === "failed") console.log(`FAILED (${note === undefined ? "" : `${note}, `}captured)`);
    else {
      const line = status === "ok" ? `${text.length} bytes` : status;
      console.log(note === undefined ? line : `${line} (${note})`);
    }
    return status === "ok" ? text : null;
  }

  const commandFailed = (name, args) => (error) =>
    `COMMAND FAILED: ${name} ${args.join(" ")}\n\n${error.stdout ?? ""}\n${error.stderr ?? error.message}`;
  const failedJson = (schema) => (error) =>
    `${JSON.stringify({ schema, state: "failed", reason: errorMessage(error) }, null, 2)}\n`;

  function view(label, args) {
    return capture(
      { label, file: `${label}.txt`, args, runner: runner.join(" ") },
      () => {
        const text = runTextSyncOrThrow([...runner, cli, ...args], {
          cwd: repo,
          maxBuffer: 256 * 1024 * 1024,
        });
        // Clean exit with no output is not a collected fact, so it never reads as "nothing to report".
        return text.trim() === "" ? { text, status: "empty", note: "no output" } : { text };
      },
      commandFailed("outcome", args),
    );
  }

  console.log(`campaign: ${campaign}`);
  console.log(`snapshot: ${out}\n`);

  // The observation stream is optional on historical sources, so an absent one is unsupported.
  capture(
    { label: "timeline", file: "timeline.json", args: ["timeline.mjs:buildTimeline"], required: false },
    () => {
      const timeline = buildTimeline({ campaign: resolve(campaign), runId });
      const text = `${JSON.stringify(timeline, null, 2)}\n`;
      return timeline.state === "recorded" ? { text } : { text, status: "unsupported" };
    },
    () =>
      `${JSON.stringify(
        {
          schema: "wri-run-timeline/v1",
          state: "failed",
          reason: "The observation stream is unreadable or carries a misshapen row; no timing supplied.",
        },
        null,
        2,
      )}\n`,
  );

  // The selector stays singular: a digest for another run is a different evidence identity. The
  // Builder, review-yield and evolution views keep their campaign-wide scope.
  capture(
    { label: "digest", file: "digest.md", args: ["digest.mjs"] },
    () => {
      const text = buildDigest({
        campaign,
        domainsRoot: productRoot(dirname(dirname(resolve(campaign)))),
        runIds: [runId],
      });
      return text.trim() === "" ? { text, status: "empty" } : { text };
    },
    (error) => `DIGEST FAILED\n\n${error.stack ?? error.message}`,
  );

  capture(
    { label: "review-yield", file: "review-yield.json", args: ["review-yield.mjs:buildReviewYield"] },
    () => {
      const report = buildReviewYield(resolve(campaign));
      writeFileSync(join(out, "review-yield.md"), renderReviewYield(report));
      const text = `${JSON.stringify(report, null, 2)}\n`;
      return report.complete ? { text } : { text, status: "failed", note: "component row invalid" };
    },
    failedJson("wri-review-yield-report/v1"),
  );

  capture(
    { label: "harness-evolution", file: "harness-evolution.json", args: ["harness-versions.mjs", "--json"] },
    () => ({
      text: `${JSON.stringify(
        buildHarnessEvolution({
          repoRoot: repo,
          slug: basename(resolve(campaign)),
          campaignDir: resolve(campaign),
        }),
        null,
        2,
      )}\n`,
    }),
    failedJson("harness-evolution/v1"),
  );

  view("builder", [campaign, "--builder"]);

  // Run posture over the selected run's prose, labels and counts only. Required: absent or thin
  // prose records that verdict, and only an integrity failure or a failed command is incomplete.
  // This call is the classifier's only invoker.
  {
    const classifier = join(import.meta.dirname, "..", "classifier", "prose-classify.mjs");
    const args = [resolve(campaign), "--run", runId, "--json"];
    capture(
      {
        label: "prose-posture",
        file: "prose-posture.json",
        args: ["classifier/prose-classify.mjs", ...args],
        runner: runner.join(" "),
        thrownNote: "command failed",
      },
      () => {
        const text = runTextSyncOrThrow([...runner, classifier, ...args], {
          cwd: import.meta.dirname,
          maxBuffer: 64 * 1024 * 1024,
        });
        const result = JSON.parse(text);
        const note =
          result.state === "classified"
            ? `Builder ${result.evidence.builder.grade}/${result.evidence.builder.rows} rows, solver ${result.evidence.solver.grade}/${result.evidence.solver.rows} rows`
            : result.state;
        return result.state === "integrity-failure" ? { text, status: "failed", note } : { text, note };
      },
      commandFailed("prose-classify.mjs", args),
    );
  }

  console.log(`\nrun ${runId}`);
  const metrics = view(`${runId}-default`, [campaign, runId]);
  view(`${runId}-scan`, [campaign, runId, "--scan"]);
  const measuredParents = scorecardParents(view(`${runId}-scorecard`, [campaign, runId, "--scorecard"]));
  const warnings = ["--observations", "--level", "warning", "--limit", "60"];
  view(`${runId}-observations-warning`, [campaign, runId, ...warnings]);
  const caseViews = ["fail", "unaccepted", "non-result", "pass"].map((result) =>
    view(`${runId}-cases-${result}`, [campaign, runId, "--cases", "--result", result, "--limit", caseLimit]),
  );
  // Two dossiers and traces prove per-case reading is possible, which separates "no telemetry"
  // from "nobody looked"; the case-index views feed the ids too, so a failed default view skips none.
  const taskSource = [metrics, ...caseViews].filter((value) => value !== null).join("\n");
  const taskIds = [...new Set([...taskSource.matchAll(/"taskId":\s*"([^"]+)"/g)].map((m) => m[1]))];
  for (const taskId of taskIds.slice(0, 2)) {
    view(`${runId}-case-${taskId}`, [campaign, runId, "--case", taskId]);
    view(`${runId}-trace-${taskId}`, [campaign, runId, "--trace", taskId]);
  }
  if (taskIds.length === 0) {
    console.log("  (no taskId found in the default or case-index views; per-case dossiers skipped)");
  }

  console.log(`\nsnapshot written to ${out}`);
  console.log("Reconcile every session-reported total against these files before acting on it.");

  // A complete manifest proves collection, not reader correctness; the runtime is recorded, not enforced.
  const manifest = {
    schema: "outcome-snapshot-status/v2",
    capturedAt: new Date().toISOString(),
    campaign: resolve(campaign),
    repo,
    runIds: [runId],
    source: {
      ...openingSource,
      openingDigest,
      observed: { commit: repoHead, sourceDigest: observedSourceDigest, dirty: observedDirty },
    },
    opening: { path: openingPath, sha256: openingDigest },
    worktree: { path: repo, head: repoHead, dirty: observedDirty },
    facts: terminalFacts(opening, controller, controllerError, measuredParents),
    runtime: { version: Bun.version, executable: Bun.argv[0] },
    complete: views.every((entry) => entry.status === "ok" || entry.required === false),
    views,
  };
  writeJsonFile(join(out, "snapshot-status.json"), manifest);

  if (!manifest.complete) {
    const failed = views.flatMap((entry) =>
      entry.status !== "ok" && entry.required !== false ? [`${entry.label}:${entry.status}`] : [],
    );
    console.error(`SNAPSHOT INCOMPLETE: ${failed.join(", ")}`);
    code = 1;
  }
  return code;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "trace-review",
      usage: USAGE,
      options: {
        campaign: "text",
        run: "text",
        repo: "text",
        out: "text",
        cases: "int",
        all: "flag",
      },
      positionals: [0, 1],
    },
    collectSnapshot,
  );
}
