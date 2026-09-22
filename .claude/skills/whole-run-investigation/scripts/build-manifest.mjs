#!/usr/bin/env bun
// Build one whole-run investigation manifest from a deterministic snapshot and the skill-owned
// session bodies. `--sessions` selects declared sessions by number, range or name; `--auto N` groups all
// semantic angles without crossing the deterministic session boundary. `--launch` passes the
// completed manifest to the repository Luna launcher.

import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { ANGLE_FILES, MIN_AUTO_SESSIONS } from "./catalogue-shape.mjs";
import {
  angleSessions,
  assertIndexMatchesCatalogue,
  defaultReferenceRoot,
  intelligenceSessions,
  loadSnapshot,
  manifestFail,
  referenceIdentity,
  referenceSessionNames,
  retiredAngles,
} from "./manifest-inputs.mjs";
import {
  composeInstructions,
  composeTasks,
  publicOnlySession,
  publicReviewInstructions,
  resolveSessions,
  writeAndDispatch,
} from "./manifest-compose.mjs";
import { readSharedInstructions, sharedAuthoredText } from "./shared-instructions.mjs";

const HERE = dirname(Bun.fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const GIT_SHA = /^[0-9a-f]{40}$/;
const USAGE = [
  "usage:",
  "  build-manifest.mjs --snapshot <dir> --worktree <dir> --out <dir>",
  "                     [--sessions 4,7-9,mechanism] [--auto <sessions>] [--diagnostics] [--notes <file>]",
  "                     [--skill <SKILL.md>] [--angles <file>] [--index <file>]",
  "                     [--revision <40-char commit>] [--live] [--title <text>] [--context <file>]",
  "                     [--shared-instructions <shared-instructions.json>] [--web-access] [--consumer-hardware [--reference <dir>]]",
  "                     [--transport luna|codex|native] [--effort high|xhigh|max] [--stress] [--launch [--detach]]",
].join("\n");

/** @param {string | null} [fallback] */
function arg(name, fallback = null) {
  const index = Bun.argv.indexOf(`--${name}`);
  return index === -1 || index + 1 >= Bun.argv.length ? fallback : Bun.argv[index + 1];
}

const flag = (name) => Bun.argv.includes(`--${name}`);

function parseOptions() {
  const transport = arg("transport", "luna");
  if (!["luna", "codex", "native"].includes(transport)) manifestFail(`invalid transport: ${transport}`);
  const effort = arg("effort", "max");
  if (!["high", "xhigh", "max"].includes(effort)) manifestFail(`invalid effort: ${effort}`);
  if (flag("launch") && transport === "native") {
    manifestFail("--launch is only valid with the luna or codex transport");
  }
  if (flag("detach") && (!flag("launch") || transport !== "luna")) {
    manifestFail("--detach needs --launch with the luna transport");
  }
  const revision = arg("revision");
  if (Bun.argv.filter((value) => value === "--revision").length > 1) {
    manifestFail("--revision may be supplied only once");
  }
  if (revision !== null && !GIT_SHA.test(revision)) {
    manifestFail(`--revision must be one concrete 40-character lowercase commit, got "${revision}"`);
  }
  const sessionsSpec = arg("sessions");
  const autoRaw = arg("auto");
  if (sessionsSpec !== null && autoRaw !== null) {
    manifestFail("--sessions selects sessions and --auto groups every angle; pass one of them");
  }
  const autoCount = autoRaw === null ? 0 : Number(autoRaw);
  if (autoRaw !== null && (!Number.isInteger(autoCount) || autoCount < MIN_AUTO_SESSIONS)) {
    manifestFail(
      `--auto needs at least ${MIN_AUTO_SESSIONS} semantic sessions to preserve isolated lanes and blinded pairs; got "${autoRaw}". Use --sessions for a targeted subset.`,
    );
  }
  return {
    transport,
    effort,
    sessionsSpec,
    autoCount,
    diagnostics: flag("diagnostics"),
    snapshotDir: arg("snapshot"),
    worktree: arg("worktree"),
    notesPath: arg("notes"),
    outDir: arg("out"),
    launch: flag("launch"),
    detach: flag("detach"),
    stress: flag("stress"),
    consumerHardware: flag("consumer-hardware"),
    revision,
  };
}

function validatePaths(options) {
  if (
    !options.snapshotDir ||
    !options.worktree ||
    !options.outDir ||
    (!options.autoCount && !options.sessionsSpec && !options.notesPath && !options.diagnostics)
  ) {
    console.error(USAGE);
    runtimeProcess.exit(2);
  }
  for (const [label, path] of [
    ["--worktree", options.worktree],
    ["--out", options.outDir],
  ]) {
    if (!path.startsWith("/")) manifestFail(`${label} must be an absolute path`);
  }
  if (!existsSync(options.worktree)) manifestFail(`--worktree does not exist: ${options.worktree}`);
  if (options.notesPath && !existsSync(options.notesPath)) {
    manifestFail(`--notes does not exist: ${options.notesPath}`);
  }
}

function loadSkill() {
  const skillPath = resolve(arg("skill", join(HERE, "..", "SKILL.md")));
  if (!existsSync(skillPath)) manifestFail(`no SKILL.md at ${skillPath}`);
  const anglesOverride = arg("angles");
  const anglesPaths = anglesOverride
    ? [resolve(anglesOverride)]
    : ANGLE_FILES.map((file) => join(dirname(skillPath), "references", file));
  for (const path of anglesPaths) if (!existsSync(path)) manifestFail(`no review-angle catalogue at ${path}`);
  const indexPath = resolve(arg("index", join(dirname(skillPath), "references", "session-index.md")));
  if (!existsSync(indexPath)) manifestFail(`no session index at ${indexPath}`);
  const skill = readFileSync(skillPath, "utf8");
  const angles = anglesPaths.map((path) => readFileSync(path, "utf8")).join("\n");
  assertIndexMatchesCatalogue(readFileSync(indexPath, "utf8"), angles);
  return {
    indexPath,
    skill,
    angles,
    declared: new Map([...intelligenceSessions(skill), ...angleSessions(angles)]),
    retired: retiredAngles(skill),
    referenceNames: referenceSessionNames(skill),
  };
}

function printList(state) {
  for (const [name, session] of state.declared) {
    const note = state.referenceNames.has(name) ? "  (needs --consumer-hardware)" : "";
    console.log(`${name.padEnd(34)} ${session.title}${note}`);
  }
  // Guidance goes to stderr so stdout stays the machine-readable list of declared names.
  console.error(`\nOne sentence per session, with its trigger: ${state.indexPath}`);
  console.error(
    "Select with --sessions; `,` separates sessions, `-` is a contiguous angle range and `+` joins angles into one session.",
  );
}

function main() {
  if (flag("help")) {
    console.log(
      `${USAGE}\n--diagnostics selects the two diagnostic lanes, or adds missing ones to --sessions/--auto. It does not launch them without --launch.`,
    );
    return;
  }
  const state = loadSkill();
  if (flag("list")) return printList(state);
  const options = parseOptions();
  validatePaths(options);
  const snapshot = loadSnapshot(resolve(options.snapshotDir), resolve(options.worktree));
  if (options.revision !== null && options.revision !== snapshot.status.source.commit) {
    manifestFail(
      `--revision ${options.revision} does not match verified snapshot source ${snapshot.status.source.commit}`,
    );
  }
  const sessionSet = resolveSessions({ ...options, ...state });
  const runId = snapshot.runId ?? "unknown-run";
  const campaign = snapshot.status.campaign;
  const bun = snapshot.status.runtime?.executable ?? Bun.argv[0];
  const contextPath = arg("context");
  if (contextPath && !existsSync(contextPath)) manifestFail(`--context does not exist: ${contextPath}`);
  const sharedPath = arg("shared-instructions");
  const shared = sharedPath ? readSharedInstructions(sharedPath) : null;
  const authored = sharedAuthoredText(shared);
  // The shared instructions' two authored values stand in for --context and the notes
  // orientation when those were not supplied; explicit files still win.
  const contextText = contextPath ? readFileSync(contextPath, "utf8").trim() : authored.movedVariable;
  if (authored.orientation && !options.notesPath) sessionSet.orientationText = authored.orientation;
  const reference = options.consumerHardware
    ? referenceIdentity(defaultReferenceRoot(arg("reference")))
    : null;
  const instructionInput = {
    ...sessionSet,
    snapshot,
    worktree: options.worktree,
    revision: options.revision ?? snapshot.status.source.commit,
    campaign,
    runId,
    bun,
    bunPin: snapshot.bunPin,
    title: arg("title", `run ${runId}`),
    live: flag("live"),
    webAccess: flag("web-access"),
    contextText,
    shared,
    reference,
    reviewMode: options.autoCount > 0 ? "exhaustive" : "targeted",
  };
  const instructions = composeInstructions(instructionInput);
  const challengeDir = join(snapshot.dir, "trace-challenge");
  const tasks = composeTasks(sessionSet.sessions, sessionSet.seen, state.referenceNames, challengeDir, {
    campaign,
    runId,
    reviewMode: options.autoCount > 0 ? "exhaustive" : "targeted",
  });
  // All transports prepend one common instruction file. When a public-only lane is present,
  // keep that common file public and attach the richer context only to the other tasks.
  const publicOnly = sessionSet.sessions.some(publicOnlySession);
  const commonInstructions = publicOnly ? publicReviewInstructions(instructionInput) : instructions;
  if (publicOnly) {
    for (const task of tasks) {
      const session = sessionSet.sessions.find((row) => row.name === task.name);
      if (!publicOnlySession(session)) task.task = `${instructions}\n\n${task.task}`;
    }
  }
  writeAndDispatch({
    ...options,
    ...sessionSet,
    instructions: commonInstructions,
    tasks,
    bun,
    // WRI_LUNA_LAUNCHER lets a test substitute a fake launcher; the default is the skill transport.
    launcherPath:
      runtimeProcess.env.WRI_LUNA_LAUNCHER ??
      join(REPO_ROOT, ".agents", "skills", "codex-luna-swarm", "scripts", "luna-sessions.mjs"),
    codexLauncherPath: join(
      REPO_ROOT,
      ".claude",
      "skills",
      "codex-luna-swarm",
      "scripts",
      "codex-sessions.mjs",
    ),
  });
}

main();
