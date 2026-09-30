#!/usr/bin/env bun
// Build one whole-run investigation manifest from a deterministic snapshot and the skill-owned
// lane bodies. `--sessions` selects declared lanes by number or range; `--auto N` groups every
// launchable lane into N contiguous sessions, each isolated lane alone. `--launch` passes the
// completed manifest to the repository Luna launcher.

import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { type CommandArgs, type CommandResult, runCommand } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { hasText } from "#src/meta/text.ts";
import { ANGLE_FILES, GIT_SHA, ISOLATED_ANGLES, MIN_AUTO_SESSIONS } from "./catalogue-shape.ts";
import {
  type AngleSession,
  assertIndexMatchesCatalogue,
  isolatedLaneGate,
  loadSnapshot,
  manifestFail,
} from "./manifest-inputs.ts";
import {
  composeInstructions,
  composeTasks,
  blindSession,
  publicReviewInstructions,
  resolveSessions,
  writeAndDispatch,
} from "./manifest-compose.ts";
import { readSharedInstructions, sharedAuthoredText } from "./shared-instructions.ts";

const HERE = dirname(Bun.fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const USAGE = [
  "usage:",
  "  build-manifest.ts --snapshot <dir> --worktree <dir> --out <dir>",
  "                     [--sessions 1-4,7] [--auto <sessions>] [--notes <file>]",
  "                     [--angles <file>] [--index <file>]",
  "                     [--revision <40-char commit>] [--live] [--title <text>] [--context <file>]",
  "                     [--shared-instructions <shared-instructions.json>] [--web-access]",
  "                     [--transport luna|native] [--effort high|xhigh|max] [--launch [--detach] [--max-active <n>]]",
  `Lanes ${[...ISOLATED_ANGLES.keys()].join(", ")} are isolated: each launches only when its deterministic trigger fired in the snapshot.`,
].join("\n");

/** The launch options, as parsed and before `missingPaths` proves the required ones present. */
interface ManifestOptions {
  transport: string;
  effort: string;
  sessionsSpec: string | null;
  autoCount: number;
  snapshotDir: string | null;
  worktree: string | null;
  notesPath: string | null;
  outDir: string | null;
  launch: boolean;
  detach: boolean;
  maxActive: string | null;
  revision: string | null;
}

interface Catalogue {
  indexPath: string;
  declared: Map<string, AngleSession>;
}

function parseOptions(args: CommandArgs): ManifestOptions {
  const transport = args.value("transport") ?? "luna";
  if (!["luna", "native"].includes(transport)) manifestFail(`invalid transport: ${transport}`);
  const effort = args.value("effort") ?? "max";
  if (!["high", "xhigh", "max"].includes(effort)) manifestFail(`invalid effort: ${effort}`);
  if (args.flag("launch") && transport === "native") {
    manifestFail("--launch is only valid with the luna transport");
  }
  if (args.flag("detach") && (!args.flag("launch") || transport !== "luna")) {
    manifestFail("--detach needs --launch with the luna transport");
  }
  const maxActive = args.value("max-active");
  if (maxActive !== null && (transport !== "luna" || !/^[1-9]\d*$/.test(maxActive))) {
    manifestFail(`--max-active takes a positive count of concurrent Luna sessions, got "${maxActive}"`);
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
    maxActive,
    revision,
  };
}

/** Whether a launch lacks what it cannot start without, which prints the usage and exits 2. */
function missingPaths(options: ManifestOptions): boolean {
  if (
    !hasText(options.snapshotDir) ||
    !hasText(options.worktree) ||
    !hasText(options.outDir) ||
    (!options.autoCount && !hasText(options.sessionsSpec) && !hasText(options.notesPath))
  ) {
    console.error(USAGE);
    return true;
  }
  if (!existsSync(options.worktree)) manifestFail(`--worktree does not exist: ${options.worktree}`);
  if (hasText(options.notesPath) && !existsSync(options.notesPath)) {
    manifestFail(`--notes does not exist: ${options.notesPath}`);
  }
  return false;
}

function loadCatalogue(args: CommandArgs): Catalogue {
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

function printList(state: Catalogue): void {
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

function main(args: CommandArgs): CommandResult {
  const state = loadCatalogue(args);
  if (args.flag("list")) return printList(state);
  const parsed = parseOptions(args);
  // `missingPaths` refuses an absent snapshot, worktree or output path, so the null tests after it
  // only carry that proof into the types.
  const { snapshotDir, worktree, outDir } = parsed;
  if (missingPaths(parsed) || snapshotDir === null || worktree === null || outDir === null) return 2;
  const options = { ...parsed, snapshotDir, worktree, outDir };
  const snapshot = loadSnapshot(resolve(options.snapshotDir), options.worktree);
  if (options.revision !== null && options.revision !== snapshot.status.source.commit) {
    manifestFail(
      `--revision ${options.revision} does not match verified snapshot source ${snapshot.status.source.commit}`,
    );
  }
  const sessionSet = resolveSessions({ ...options, ...state, gate: isolatedLaneGate(snapshot) });
  const runId = snapshot.runId ?? "unknown-run";
  const campaign = snapshot.status.campaign;
  const bun = snapshot.status.runtime?.executable ?? Bun.argv[0] ?? "";
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
  if (authored.orientation !== "" && !hasText(options.notesPath)) {
    sessionSet.orientationText = authored.orientation;
  }
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
  const tasks = composeTasks(
    sessionSet.sessions,
    join(snapshot.dir, "trace-challenge"),
    { campaign, runId, reviewMode },
    options.outDir,
  );
  // All transports prepend one common instruction file. When a blind lane is present, keep that
  // common file free of outcomes and attach the richer context only to the other tasks.
  const blind = sessionSet.sessions.some(blindSession);
  const commonInstructions = blind ? publicReviewInstructions(instructionInput) : instructions;
  if (blind) {
    for (const task of tasks) {
      const session = sessionSet.sessions.find((row) => row.name === task.name);
      // Every task is composed from one session, so `session` is found.
      if (session !== undefined && !blindSession(session)) task.task = `${instructions}\n\n${task.task}`;
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
      join(REPO_ROOT, ".agents", "skills", "codex-luna-swarm", "scripts", "luna-sessions.ts"),
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
        "max-active": "text",
      },
    },
    main,
  );
}
