#!/usr/bin/env bun
// Build one whole-run investigation manifest from a deterministic snapshot and the skill-owned
// lane bodies. `--sessions` selects declared lanes by number or range; `--auto N` groups every
// launchable lane into N contiguous sessions, each isolated lane alone. `--launch` passes the
// completed manifest to the repository Luna launcher.

import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { runCommand } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { hasText } from "#src/meta/text.ts";
import {
  ANGLE_FILES,
  GIT_SHA,
  ISOLATED_ANGLES,
  MIN_AUTO_SESSIONS,
  PUBLIC_ONLY_LANE,
  TRACE_CHALLENGE_LANE,
} from "./catalogue-shape.mjs";
import {
  assertIndexMatchesCatalogue,
  isolatedLaneGate,
  loadSnapshot,
  manifestFail,
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
const USAGE = [
  "usage:",
  "  build-manifest.mjs --snapshot <dir> --worktree <dir> --out <dir>",
  "                     [--sessions 1-4,7] [--auto <sessions>] [--notes <file>]",
  "                     [--angles <file>] [--index <file>]",
  "                     [--revision <40-char commit>] [--live] [--title <text>] [--context <file>]",
  "                     [--shared-instructions <shared-instructions.json>] [--web-access]",
  "                     [--transport luna|codex|native] [--effort high|xhigh|max] [--launch [--detach]]",
  `Lanes ${PUBLIC_ONLY_LANE} and ${TRACE_CHALLENGE_LANE} are isolated: they launch only when their deterministic trigger fired in the snapshot.`,
].join("\n");

function parseOptions(args) {
  const transport = args.value("transport") ?? "luna";
  if (!["luna", "codex", "native"].includes(transport)) manifestFail(`invalid transport: ${transport}`);
  const effort = args.value("effort") ?? "max";
  if (!["high", "xhigh", "max"].includes(effort)) manifestFail(`invalid effort: ${effort}`);
  if (args.flag("launch") && transport === "native") {
    manifestFail("--launch is only valid with the luna or codex transport");
  }
  if (args.flag("detach") && (!args.flag("launch") || transport !== "luna")) {
    manifestFail("--detach needs --launch with the luna transport");
  }
  const revision = args.value("revision");
  if (revision !== null && !GIT_SHA.test(revision)) {
    manifestFail(`--revision must be one concrete 40-character lowercase commit, got "${revision}"`);
  }
  const sessionsSpec = args.value("sessions");
  const autoRaw = args.value("auto");
  if (sessionsSpec !== null && autoRaw !== null) {
    manifestFail("--sessions selects lanes and --auto groups every launchable lane; pass one of them");
  }
  const autoCount = autoRaw === null ? 0 : Number(autoRaw);
  if (autoRaw !== null && (!Number.isInteger(autoCount) || autoCount < MIN_AUTO_SESSIONS)) {
    manifestFail(
      `--auto needs at least ${MIN_AUTO_SESSIONS} semantic sessions to seat each isolated lane alone; got "${autoRaw}". Use --sessions for a targeted subset.`,
    );
  }
  return {
    transport,
    effort,
    sessionsSpec,
    autoCount,
    snapshotDir: args.value("snapshot"),
    worktree: args.value("worktree"),
    notesPath: args.value("notes"),
    outDir: args.value("out"),
    launch: args.flag("launch"),
    detach: args.flag("detach"),
    revision,
  };
}

/** Whether a launch lacks what it cannot start without, which prints the usage and exits 2. */
function missingPaths(options) {
  if (
    !options.snapshotDir ||
    !options.worktree ||
    !options.outDir ||
    (!options.autoCount && !options.sessionsSpec && !options.notesPath)
  ) {
    console.error(USAGE);
    return true;
  }
  if (!existsSync(options.worktree)) manifestFail(`--worktree does not exist: ${options.worktree}`);
  if (options.notesPath && !existsSync(options.notesPath)) {
    manifestFail(`--notes does not exist: ${options.notesPath}`);
  }
  return false;
}

function loadCatalogue(args) {
  const references = join(HERE, "..", "references");
  const anglesOverride = args.value("angles");
  const anglesPaths = hasText(anglesOverride)
    ? [resolve(anglesOverride)]
    : ANGLE_FILES.map((file) => join(references, file));
  for (const path of anglesPaths) if (!existsSync(path)) manifestFail(`no review-angle catalogue at ${path}`);
  const indexPath = resolve(args.value("index") ?? join(references, "session-index.md"));
  if (!existsSync(indexPath)) manifestFail(`no session index at ${indexPath}`);
  const angles = anglesPaths.map((path) => readFileSync(path, "utf8")).join("\n");
  return { indexPath, declared: assertIndexMatchesCatalogue(readFileSync(indexPath, "utf8"), angles) };
}

function printList(state) {
  for (const [name, session] of state.declared) {
    const note = ISOLATED_ANGLES.has(session.number)
      ? `  (isolated: ${ISOLATED_ANGLES.get(session.number)}; launches only when its trigger fired)`
      : "";
    console.log(`${name.padEnd(12)} ${session.title}${note}`);
  }
  // Guidance goes to stderr so stdout stays the machine-readable list of declared names.
  console.error(`\nOne sentence per lane, with its trigger: ${state.indexPath}`);
  console.error("Select with --sessions; `,` separates sessions and `-` is a contiguous lane range.");
}

function main(args) {
  const state = loadCatalogue(args);
  if (args.flag("list")) return printList(state);
  const options = parseOptions(args);
  if (missingPaths(options)) return 2;
  const snapshot = loadSnapshot(resolve(options.snapshotDir), options.worktree);
  if (options.revision !== null && options.revision !== snapshot.status.source.commit) {
    manifestFail(
      `--revision ${options.revision} does not match verified snapshot source ${snapshot.status.source.commit}`,
    );
  }
  const sessionSet = resolveSessions({ ...options, ...state, gate: isolatedLaneGate(snapshot) });
  const runId = snapshot.runId ?? "unknown-run";
  const campaign = snapshot.status.campaign;
  const bun = snapshot.status.runtime?.executable ?? Bun.argv[0];
  const contextPath = args.value("context");
  if (hasText(contextPath) && !existsSync(contextPath)) {
    manifestFail(`--context does not exist: ${contextPath}`);
  }
  const sharedPath = args.value("shared-instructions");
  const shared = hasText(sharedPath) ? readSharedInstructions(sharedPath) : null;
  const authored = sharedAuthoredText(shared);
  // The shared instructions' two authored values stand in for --context and the notes
  // orientation when those were not supplied; explicit files still win.
  const contextText = hasText(contextPath)
    ? readFileSync(contextPath, "utf8").trim()
    : authored.movedVariable;
  if (authored.orientation && !hasText(options.notesPath)) sessionSet.orientationText = authored.orientation;
  const reviewMode = options.autoCount > 0 ? "exhaustive" : "targeted";
  const instructionInput = {
    ...sessionSet,
    snapshot,
    worktree: options.worktree,
    revision: options.revision ?? snapshot.status.source.commit,
    campaign,
    runId,
    bun,
    bunPin: snapshot.bunPin,
    title: args.value("title") ?? `run ${runId}`,
    live: args.flag("live"),
    webAccess: args.flag("web-access"),
    contextText,
    shared,
    reviewMode,
  };
  const instructions = composeInstructions(instructionInput);
  const tasks = composeTasks(sessionSet.sessions, join(snapshot.dir, "trace-challenge"), {
    campaign,
    runId,
    reviewMode,
  });
  // All transports prepend one common instruction file. When the public-only lane is present,
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

if (import.meta.main) {
  await runCommand(
    {
      name: "build-manifest",
      usage: USAGE,
      options: {
        snapshot: "text",
        worktree: "abs",
        out: "abs",
        sessions: "text",
        auto: "text",
        notes: "text",
        angles: "text",
        index: "text",
        revision: "text",
        title: "text",
        context: "text",
        "shared-instructions": "text",
        transport: "text",
        effort: "text",
        list: "flag",
        live: "flag",
        "web-access": "flag",
        launch: "flag",
        detach: "flag",
      },
    },
    main,
  );
}
