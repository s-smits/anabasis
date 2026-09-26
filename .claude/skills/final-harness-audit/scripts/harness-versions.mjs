#!/usr/bin/env bun
/**
 * Every recorded harness version, joined to its authoring and measurement evidence.
 *
 * The authoring sessions commit into one git repo per epoch
 * (campaigns/<slug>/epoch-*<...>/workspace/.git), one commit per recorded iteration. That history
 * supplies the authoring history; saved product manifests supply the execution versions.
 * This script joins each commit to its iteration evidence,
 * its bundleSnapshot fingerprint, the batteries that measured that bundleSnapshot, and those batteries' claims.
 *
 * Read-only: it runs `git log`/`git show` against workspaces and parses JSON evidence. It
 * writes no files and changes no verdicts. Missing facts remain explicit in the report.
 *
 * usage:
 *   bun --no-env-file harness-versions.mjs <slug> [--repo <path>] [--json]
 *   bun --no-env-file harness-versions.mjs <slug> --diff <ordinal|commit>   # name-status + diffstat vs parent
 *   bun --no-env-file harness-versions.mjs <slug> --files <ordinal|commit>  # bundle file sizes at that version
 */
import { runCommand } from "#skills/main/cli.ts";
import { gitText } from "#skills/main/git.ts";
import { campaignEpochs } from "#src/author/campaign-epoch.ts";
import { ITERATION_FILE, listIterationDirs } from "#src/builder/campaign-iterations.ts";
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { fingerprintSlug } from "#src/claim/fingerprint.ts";
import { bundleSnapshotIdOf } from "#src/claim/bundle-snapshot.ts";
import { campaignDir as campaignDirOf, defaultProductDir } from "#src/meta/campaign-root.ts";
import { caseVerdictDefect, classifyCaseOutcome, outcomeTally } from "#src/claim/case-record.ts";
import { readRecordedBatteryRecord } from "#src/correctness-bundle/battery-record.ts";
import { campaignTraceRoots } from "#src/claim/trace-read.ts";
import { savedProductFacts } from "./harness-saved-versions.mjs";
import { checkpointFacts } from "./harness-version-shape.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

export const HARNESS_EVOLUTION_SCHEMA = "harness-evolution/v1";

const SHORT = (sha) => (isString(sha) && sha.length >= 12 ? sha.slice(0, 12) : "absent");

function dirs(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every epoch. An epoch whose workspace repo is gone still yields its
 *  iteration evidence: the versions are then known by their fingerprint with the authoring history
 *  stated absent, instead of the epoch vanishing from the audit. */
function epochsOf(campaignDir) {
  return campaignEpochs(campaignDir).map((name) => {
    const dir = join(campaignDir, name);
    const workspace = join(dir, "workspace");
    return { id: name, dir, workspace, hasRepo: existsSync(join(workspace, ".git")) };
  });
}

/** The iteration evidence of one epoch, keyed by the workspace commit each one completed. */
function iterationsByCommit(epochDir) {
  const byCommit = new Map();
  for (const name of listIterationDirs(epochDir)) {
    const evidence = readJsonFileOrNull(join(epochDir, name, ITERATION_FILE));
    if (evidence === null) continue;
    const commit = evidence.workspaceChange?.commit;
    if (isString(commit)) byCommit.set(commit, evidence);
  }
  return byCommit;
}

/** Every recorded battery in retained products and historical campaign trees, indexed by the
 *  exact bundleSnapshot it measured. A WRI is about the whole controller run; reading only the live
 *  domain tree silently dropped every held candidate from the version ledger. */
function batteriesByBundleSnapshot(repoRoot, slug, campaignDir) {
  const index = new Map();
  const seenRuns = new Map();
  const gaps = [];
  for (const root of new Set([defaultProductDir(repoRoot, slug), ...campaignTraceRoots(campaignDir)])) {
    for (const runId of dirs(join(root, "runs"))) {
      const runDir = join(root, "runs", runId);
      if (!existsSync(join(runDir, "battery.json"))) continue;
      let battery;
      try {
        battery = readRecordedBatteryRecord(runDir, runId);
      } catch (cause) {
        // Refusing to count an unverified battery is the evidence rule; ending the whole audit on it
        // is not (three legacy campaigns printed nothing on 2026-09-05). The rows still print, and
        // the exit code still says a battery was refused.
        console.error(`${runDir}: battery unreadable, not counted: ${errorMessage(cause)}`);
        gaps.push({ runId, path: runDir, reason: "battery unreadable" });
        runtimeProcess.exitCode = 1;
        continue;
      }
      const cap = battery.bundleSnapshot ?? {};
      const key = isString(cap.id) ? cap.id : bundleSnapshotId(cap);
      if (key === null) {
        gaps.push({ runId, path: runDir, reason: "battery has no bundle snapshot" });
        continue;
      }
      const identity = JSON.stringify(battery);
      const seen = seenRuns.get(runId);
      if (seen === identity) continue;
      if (seen !== undefined) {
        gaps.push({ runId, path: runDir, reason: "conflicting copies of battery" });
        index.forEach((rows, id) =>
          index.set(
            id,
            rows.filter((row) => row.runId !== runId),
          ),
        );
        continue;
      }
      seenRuns.set(runId, identity);
      const cases = battery.cases;
      for (const [caseIndex, row] of cases.entries()) {
        const defect = caseVerdictDefect(row);
        if (defect !== null) throw new Error(`${runDir}/battery.json: case ${caseIndex}: ${defect}`);
      }
      const tally = outcomeTally(cases.map(classifyCaseOutcome));
      const claim = readJsonFileOrNull(join(campaignDir, "claims", `${runId}.json`));
      index.set(key, [
        ...(index.get(key) ?? []),
        {
          runId,
          pin: battery.backendPin ?? "absent",
          total: cases.length,
          verified: tally.verified,
          passed: tally.passed,
          unaccepted: tally.unaccepted,
          nonResults: tally.nonResults,
          claim: claim === null ? "no claim evidence" : claim.claim?.ok === true ? "created" : "refused",
        },
      ]);
    }
  }
  return { index, gaps };
}

/** Fingerprint the live domain bytes instead of taking the lexicographically last sidecar. Several
 *  bundle snapshots may survive, and directory order is not adoption evidence. */
function currentBundleSnapshot(repoRoot, slug) {
  const domain = defaultProductDir(repoRoot, slug);
  if (!existsSync(domain)) return { state: "absent", bundleSnapshotId: null, findings: [] };
  const fingerprint = fingerprintSlug(domain, { slug });
  return fingerprint.ok
    ? { state: "recorded", bundleSnapshotId: bundleSnapshotId(fingerprint), findings: [] }
    : {
        state: "unobservable",
        bundleSnapshotId: null,
        findings: fingerprint.findings.map((finding) => finding.code),
      };
}

/** The id the controller files a bundle snapshot under, or null for a record that states no
 *  identity to file. The spelling is `bundleSnapshotIdOf`'s, so a snapshot with no task set joins
 *  the battery that measured it; a local copy spelled that case "?" where the controller writes
 *  "no-tasks", and the two never met. */
function bundleSnapshotId(fingerprint) {
  if (fingerprint === null || fingerprint === undefined) return null;
  const { agentHash, correctnessModelHash, taskSetHash } = fingerprint;
  if (![agentHash, correctnessModelHash].every((hash) => isString(hash) && hash.length >= 16)) return null;
  return bundleSnapshotIdOf({
    agentHash,
    correctnessModelHash,
    taskSetHash: isString(taskSetHash) ? taskSetHash : null,
  });
}

/** One row per version. With a workspace repo, each commit gets a row joined to iteration evidence.
 *  Without that repo, the iteration files are the only surviving records and
 *  each states its own authoring history as absent. */
function versionsOf(campaignDir, batteries) {
  const rows = [];
  for (const epoch of epochsOf(campaignDir)) {
    const iterations = iterationsByCommit(epoch.dir);
    if (!epoch.hasRepo) {
      for (const name of listIterationDirs(epoch.dir)) {
        const iteration = readJsonFileOrNull(join(epoch.dir, name, ITERATION_FILE));
        if (iteration === null) continue;
        const fingerprint = iteration.fingerprint ?? null;
        rows.push({
          epoch: epoch.id,
          commit: iteration.workspaceChange?.commit ?? "absent",
          at: "absent",
          subject: `${name}: ${iteration.outcome ?? "no outcome"} (workspace repo absent — authoring history not on disk)`,
          ordinal: iteration.ordinal ?? null,
          outcome: iteration.outcome ?? "no outcome",
          focusOwner: iteration.focusOwner ?? null,
          findingsHash: iteration.findingsHash ?? null,
          source: iteration.source ?? null,
          sessionAttempts: iteration.attempts ?? null,
          baseCommit: iteration.workspaceChange?.baseCommit ?? null,
          changedPaths: iteration.workspaceChange?.changedPaths ?? [],
          fingerprint:
            fingerprint === null
              ? null
              : {
                  agent: SHORT(fingerprint.agentHash),
                  correctnessModel: SHORT(fingerprint.correctnessModelHash),
                  tasks: SHORT(fingerprint.taskSetHash),
                },
          bundleSnapshotId: bundleSnapshotId(fingerprint),
          diffstat: "",
          historyAbsent: true,
          measuredBy: batteries.get(bundleSnapshotId(fingerprint)) ?? [],
          checkpoint: null,
        });
      }
      continue;
    }
    const log = gitText(epoch.workspace, "log", "--reverse", "--format=%H%x09%at%x09%s").trim();
    let starterCommit = null;
    let previousCheckpoint = null;
    for (const line of log === "" ? [] : log.split("\n")) {
      const [commit, at, subject] = line.split("\t");
      if (subject.startsWith("starter:") || subject.startsWith("rebuild: workspace reset to starter")) {
        starterCommit = commit;
      }
      const iteration = iterations.get(commit) ?? null;
      const fingerprint = iteration?.fingerprint ?? null;
      const key = bundleSnapshotId(fingerprint);
      const stat = gitText(epoch.workspace, "show", "--stat", "--format=", commit).trim().split("\n").at(-1);
      const row = {
        epoch: epoch.id,
        commit,
        at: new Date(Number(at) * 1000).toISOString(),
        subject,
        ordinal: iteration?.ordinal ?? null,
        outcome: iteration?.outcome ?? (subject.startsWith("starter:") ? "starter" : "no iteration evidence"),
        focusOwner: iteration?.focusOwner ?? null,
        findingsHash: iteration?.findingsHash ?? null,
        source: iteration?.source ?? null,
        sessionAttempts: iteration?.attempts ?? null,
        baseCommit: iteration?.workspaceChange?.baseCommit ?? null,
        changedPaths: iteration?.workspaceChange?.changedPaths ?? [],
        fingerprint:
          fingerprint === null
            ? null
            : {
                agent: SHORT(fingerprint.agentHash),
                correctnessModel: SHORT(fingerprint.correctnessModelHash),
                tasks: SHORT(fingerprint.taskSetHash),
              },
        bundleSnapshotId: key,
        diffstat: (stat ?? "").trim(),
        historyAbsent: false,
        measuredBy: key === null ? [] : (batteries.get(key) ?? []),
        checkpoint: /** @type {ReturnType<typeof checkpointFacts> | null} */ (null),
      };
      if (iteration !== null && starterCommit !== null) {
        row.checkpoint = checkpointFacts(epoch.workspace, row, starterCommit, previousCheckpoint);
        previousCheckpoint = row;
      }
      rows.push(row);
    }
  }
  // Authoring may return to an earlier epoch after a rebuild. Mutable campaign-file mtimes
  // cannot order that history; use the commit times already recorded on the version rows.
  // Missing histories stay visible first and never become a purported latest checkpoint.
  // Rows stay grouped by epoch (ordered by each epoch's earliest row): a flat sort printed one
  // epoch under four headers in truss -15, and the audit counts epochs from headers.
  const at = (row) => Date.parse(row.at) || 0;
  const epochStart = new Map();
  for (const row of rows) epochStart.set(row.epoch, Math.min(epochStart.get(row.epoch) ?? Infinity, at(row)));
  return rows.sort(
    (a, b) =>
      epochStart.get(a.epoch) - epochStart.get(b.epoch) || a.epoch.localeCompare(b.epoch) || at(a) - at(b),
  );
}

function printCheckpoint(row) {
  if (row.checkpoint === null) return;
  const productTree = row.checkpoint.productTree;
  const start = row.checkpoint.fromStarter;
  console.log(
    `    product   ${productTree.files} files, ${productTree.nonBlankLines} nonblank lines ` +
      `(code ${productTree.linesByKind.code}, data ${productTree.linesByKind.data}, prose ${productTree.linesByKind.prose})`,
  );
  console.log(
    `    starter delta   +${start.added}/-${start.deleted} lines across ${start.filesChanged} paths`,
  );
  const tasks = row.checkpoint.taskSet;
  if (tasks.state === "recorded") {
    console.log(
      `    tasks   ${tasks.tasks} across ${Object.keys(tasks.families).length} families, ` +
        `${tasks.exactPublicDuplicates.length} exact public duplicate group(s), ` +
        `same-family lexical p90 ${tasks.lexical.p90SameFamilyCosine}`,
    );
  } else console.log(`    tasks   ${tasks.state}: ${tasks.reason}`);
}

function printTable(rows, current) {
  let seenEpoch = null;
  if (rows.length === 0) {
    console.log(
      "no workspace repo for this slug — nothing was authored under campaigns/<slug>/epoch-*/workspace",
    );
    return;
  }
  for (const row of rows) {
    const cap = row.bundleSnapshotId ?? "unrecorded";
    const isAdopted = current.bundleSnapshotId !== null && row.bundleSnapshotId === current.bundleSnapshotId;
    if (row.epoch !== seenEpoch) {
      seenEpoch = row.epoch;
      console.log(`\n=== ${seenEpoch}${row.historyAbsent ? "   (workspace repo absent)" : ""} ===`);
    }
    console.log(
      `\n${row.ordinal === null ? "--" : String(row.ordinal).padStart(2, "0")}  ${SHORT(row.commit)}  ${row.at}  ${row.outcome}${isAdopted ? "   <- ADOPTED TREE" : ""}`,
    );
    console.log(`    ${row.subject}`);
    console.log(`    bundleSnapshot ${cap}`);
    if (row.diffstat !== "") console.log(`    diff    ${row.diffstat}`);
    printCheckpoint(row);
    if (row.sessionAttempts !== null) {
      const sessions = Object.entries(row.sessionAttempts)
        .map(([session, n]) => `${session}:${n}`)
        .join(" ");
      console.log(`    sessions   ${sessions}`);
    }
    if (row.focusOwner !== null) console.log(`    owner   focus=${row.focusOwner}`);
    if (row.measuredBy.length === 0) {
      console.log("    measured  never — this version has no recorded battery");
    } else {
      for (const b of row.measuredBy) {
        console.log(
          `    measured  ${b.runId}  pin ${b.pin}  ${b.passed}/${b.verified} verified ` +
            `(${b.unaccepted} unaccepted, ${b.nonResults} non-result)  claim ${b.claim}`,
        );
      }
    }
  }
  console.log(
    `\n${rows.length} Git versions, ${rows.filter((row) => row.checkpoint !== null).length} iteration checkpoints ` +
      `across ${new Set(rows.map((r) => r.epoch)).size} epoch(s); current bundleSnapshot ` +
      `${current.bundleSnapshotId ?? current.state}`,
  );
}

function resolveCommit(rows, selector) {
  const byOrdinal = rows.find((r) => String(r.ordinal) === String(selector));
  if (byOrdinal !== undefined) return byOrdinal;
  const byCommit = rows.find((r) => r.commit.startsWith(String(selector)));
  if (byCommit !== undefined) return byCommit;
  throw new Error(`no version matches "${selector}" — pass an iteration ordinal or a commit prefix`);
}

const ratio = (numerator, denominator) =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000;

/** The last candidate stays visible even before measurement. These are shape facts, not limits or
 *  quality thresholds: they answer how much was built and how concentrated its public tasks are. */
function latestCheckpointFacts(row) {
  if (row === null) return null;
  const product = row.checkpoint.productTree;
  const taskSet = row.checkpoint.taskSet;
  const largestCode = product.largestCodeFiles[0] ?? null;
  return {
    ordinal: row.ordinal,
    commit: row.commit,
    outcome: row.outcome,
    focusOwner: row.focusOwner,
    findingsHash: row.findingsHash,
    source: row.source,
    measuredBatteries: row.measuredBy.length,
    product: {
      files: product.files,
      bytes: product.bytes,
      nonBlankLines: product.nonBlankLines,
      linesByKind: product.linesByKind,
      byRoot: product.byRoot,
      dataToCodeLineRatio: ratio(product.linesByKind.data, product.linesByKind.code),
      largestCodeFile:
        largestCode === null
          ? null
          : {
              path: largestCode.path,
              nonBlankLines: largestCode.nonBlankLines,
              shareOfCodeLines: ratio(largestCode.nonBlankLines, product.linesByKind.code),
            },
    },
    fromStarter: {
      filesChanged: row.checkpoint.fromStarter.filesChanged,
      added: row.checkpoint.fromStarter.added,
      deleted: row.checkpoint.fromStarter.deleted,
      addedByKind: row.checkpoint.fromStarter.addedByKind,
      deletedByKind: row.checkpoint.fromStarter.deletedByKind,
    },
    taskSet:
      taskSet.state === "recorded"
        ? {
            state: taskSet.state,
            tasks: taskSet.tasks,
            families: taskSet.families,
            publicInputLayouts: taskSet.publicInputLayouts,
            tasksPerPublicInputLayout: ratio(taskSet.tasks, taskSet.publicInputLayouts),
            exactPublicDuplicateGroups: taskSet.exactPublicDuplicates.length,
            medianSameFamilyLexicalCosine: taskSet.lexical.medianSameFamilyCosine,
            p90SameFamilyLexicalCosine: taskSet.lexical.p90SameFamilyCosine,
          }
        : taskSet,
  };
}

function quickRead(versions) {
  const checkpoints = versions.filter((row) => row.checkpoint !== null);
  const measured = checkpoints.filter((row) => row.measuredBy.length > 0);
  const firstMeasured = measured[0] ?? null;
  const last = checkpoints.at(-1) ?? null;
  const growth =
    firstMeasured === null || last === null
      ? null
      : {
          fromOrdinal: firstMeasured.ordinal,
          toOrdinal: last.ordinal,
          nonBlankLines:
            last.checkpoint.productTree.nonBlankLines - firstMeasured.checkpoint.productTree.nonBlankLines,
          codeLines:
            last.checkpoint.productTree.linesByKind.code -
            firstMeasured.checkpoint.productTree.linesByKind.code,
          dataLines:
            last.checkpoint.productTree.linesByKind.data -
            firstMeasured.checkpoint.productTree.linesByKind.data,
        };
  return {
    latestCheckpoint: latestCheckpointFacts(last),
    measuredCheckpoints: measured.map((row) => ({
      ordinal: row.ordinal,
      commit: row.commit,
      bundleSnapshotId: row.bundleSnapshotId,
      productNonBlankLines: row.checkpoint.productTree.nonBlankLines,
      codeLines: row.checkpoint.productTree.linesByKind.code,
      dataLines: row.checkpoint.productTree.linesByKind.data,
      taskCount: row.checkpoint.taskSet.tasks ?? null,
      batteries: row.measuredBy,
    })),
    measuredToLastGrowth: growth,
    taskTransitions: checkpoints
      .filter((row) => row.checkpoint.taskTransition !== null)
      .map((row) => ({
        ordinal: row.ordinal,
        taskSetHash: row.fingerprint?.tasks ?? null,
        exactPublicRepeats: row.checkpoint.taskTransition.exactPublicRepeats,
        currentTasks: row.checkpoint.taskTransition.currentTasks,
        linkKinds: row.checkpoint.taskTransition.linkKinds,
        lexicalCosine: row.checkpoint.taskTransition.linkedLexicalCosine,
        changedPublicInputPaths: row.checkpoint.taskTransition.changedPublicInputPaths,
      })),
  };
}

export function buildHarnessEvolution({ repoRoot, slug, campaignDir }) {
  const batteries = batteriesByBundleSnapshot(repoRoot, slug, campaignDir);
  const versions = versionsOf(campaignDir, batteries.index);
  const saved = savedProductFacts(campaignDir, slug, batteries.index, bundleSnapshotId);
  const current = saved.current ?? currentBundleSnapshot(repoRoot, slug);
  const known = new Set([...versions, ...saved.rows].map((row) => row.bundleSnapshotId));
  const unmatchedBatteries = [...batteries.index]
    .filter(([id]) => !known.has(id))
    .flatMap(([snapshotId, rows]) => rows.map((row) => ({ bundleSnapshotId: snapshotId, ...row })));
  return {
    schema: HARNESS_EVOLUTION_SCHEMA,
    slug,
    campaign: campaignDir,
    current,
    savedVersions: saved.rows,
    evidenceGaps: [...batteries.gaps, ...saved.gaps],
    unmatchedBatteries,
    summary: {
      savedVersions: saved.rows.length,
      measuredSavedVersions: saved.rows.filter((row) => row.measuredBy.length > 0).length,
      measuredBatteries: [...batteries.index.values()].flat().length,
      gitVersions: versions.length,
      iterationCheckpoints: versions.filter((row) => row.checkpoint !== null).length,
      measuredCheckpoints: versions.filter((row) => row.checkpoint !== null && row.measuredBy.length > 0)
        .length,
      epochs: new Set(versions.map((row) => row.epoch)).size,
      resets: versions.filter((row) => row.subject.startsWith("rebuild: workspace reset to starter")).length,
    },
    quickRead: quickRead(versions),
    interpretation: {
      authority: "diagnostic-only",
      complexity: "line growth and churn are product-shape facts, not quality scores",
      similarity: "lexical cosine and public JSON-path movement are suspicion signals, not semantic verdicts",
      protectedDetail: "task comparison excludes hidden expectations and verifier output",
    },
    versions,
  };
}

function main(args) {
  const [slug] = args.positionals;
  const repoRoot = resolve(args.value("repo") ?? runtimeProcess.cwd());
  const campaignDir = resolve(args.value("campaign") ?? campaignDirOf(repoRoot, slug));
  const audit = buildHarnessEvolution({ repoRoot, slug, campaignDir });
  const rows = audit.versions;

  const diff = args.value("diff");
  const files = args.value("files");
  if (diff !== null) {
    const row = resolveCommit(rows, diff);
    const ws = join(campaignDir, row.epoch, "workspace");
    console.log(`# ${row.subject}  (${SHORT(row.commit)})\n`);
    console.log(gitText(ws, "show", "--stat", "--name-status", "--format=", row.commit));
    return;
  }
  if (files !== null) {
    const row = resolveCommit(rows, files);
    const ws = join(campaignDir, row.epoch, "workspace");
    const tree = gitText(ws, "ls-tree", "-r", "--name-only", row.commit).trim().split("\n");
    console.log(`# bundle at ${row.subject} (${SHORT(row.commit)})\n`);
    for (const path of tree) {
      const bytes = gitText(ws, "show", `${row.commit}:${path}`);
      const nonblank = bytes.split("\n").filter((l) => l.trim() !== "").length;
      console.log(`${String(nonblank).padStart(6)}  ${path}`);
    }
    return;
  }
  if (args.flag("json")) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  printTable(rows, audit.current);
  for (const saved of audit.savedVersions) {
    console.log(
      `saved version ${saved.id}: ${saved.state} · bundleSnapshot ${saved.bundleSnapshotId ?? "unresolved"}`,
    );
    for (const battery of saved.measuredBy) {
      console.log(
        `  measured ${battery.runId}: ${battery.passed}/${battery.verified} verified (${battery.unaccepted} unaccepted, ${battery.nonResults} non-result)`,
      );
    }
    for (const finding of saved.findings) console.log(`  gap: ${finding}`);
  }
  console.log(
    `${audit.summary.savedVersions} saved versions, ${audit.summary.measuredBatteries} recorded batteries`,
  );
  for (const battery of audit.unmatchedBatteries) {
    console.log(`unmatched battery: ${battery.runId} · ${battery.bundleSnapshotId}`);
  }
  for (const gap of audit.evidenceGaps) console.log(`evidence gap: ${JSON.stringify(gap)}`);
}

if (import.meta.main) {
  await runCommand(
    {
      name: "harness-versions",
      usage:
        "usage: harness-versions.mjs <slug> [--repo <path>] [--campaign <path>] [--diff N] [--files N] [--json]",
      options: { repo: "text", campaign: "text", diff: "text", files: "text", json: "flag" },
      positionals: 1,
    },
    main,
  );
}
