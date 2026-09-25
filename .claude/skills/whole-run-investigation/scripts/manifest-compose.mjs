import { sha256, sha256OfFile } from "#src/meta/digest.ts";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { CommandFailure } from "#skills/main/cli.ts";
import {
  DIGEST_VERDICTS,
  ISOLATED_ANGLES,
  FIX_AUTHORITY,
  leafPrompt,
  PUBLIC_ONLY_LANE,
  SHA256 as SHA_256,
  TRACE_CHALLENGE_LANE,
} from "./catalogue-shape.mjs";
import {
  ORIENTATION_HEADING,
  deterministicRowProblem,
  factsBlock,
  manifestFail,
  orientationProblems,
  parseNotes,
  parseSessionSpec,
  partitionAngles,
  sessionGroupName,
} from "./manifest-inputs.mjs";
import { reportingLines, snapshotLines } from "./manifest-reporting.mjs";
import { renderSharedInstructions } from "./shared-instructions.mjs";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

const LAUNCH_RECORD_WAIT_MS = 30_000;
const ISOLATION_RULE =
  "You are an isolated lane: do not read another session's output, worktree scratch or report, " +
  "and derive your answer independently; agreement is evidence only when reached separately.";

const pad = (number) => String(number).padStart(2, "0");

/** The refusal an isolated lane earns when it is selected before its deterministic trigger fired. */
function untriggeredProblem(lane, gate) {
  const state = gate.get(lane.number);
  if (!ISOLATED_ANGLES.has(lane.number) || state.fired) return null;
  return `isolated-lane-untriggered: lane ${lane.number} ${ISOLATED_ANGLES.get(lane.number)} and launches only when its trigger fired; ${state.reason}`;
}

function laneSession(name, lanes, direction = "") {
  return {
    name,
    custom: false,
    title:
      lanes.length === 1
        ? lanes[0].title
        : `lanes ${pad(lanes[0].number)}-${pad(lanes.at(-1).number)} (${lanes.length} standing lanes)`,
    direction,
    bodyParts: lanes.map((lane) => lane.body),
    lanes: lanes.map((lane) => ({ number: lane.number, trigger: lane.trigger })),
  };
}

function autoSessions({ autoCount, notesPath, declared, gate }) {
  let orientations = [];
  if (notesPath) {
    const parsed = parseNotes(resolve(notesPath));
    if (parsed.notes.length > 0) {
      manifestFail("--auto takes notes carrying only `## orientation`; drop --auto for per-session headings");
    }
    orientations = parsed.orientations;
  } else {
    console.error(
      "build-manifest: no orientation supplied; sessions orient only from verified controller facts",
    );
  }
  const lanes = [...declared.values()].sort((a, b) => a.number - b.number);
  const launchable = lanes.filter((lane) => {
    const problem = untriggeredProblem(lane, gate);
    if (problem !== null) console.error(`build-manifest: ${problem}`);
    return problem === null;
  });
  const sessions = partitionAngles(launchable, autoCount).map((group) =>
    laneSession(sessionGroupName(group.map((lane) => ({ name: lane.name, session: lane }))), group),
  );
  return { sessions, orientations };
}

function customSession(name, note) {
  return {
    name,
    custom: true,
    title: name,
    direction: note,
    bodyParts: [
      "This task has no standing lane body. Stay inside the question above; a section outside it is",
      "out of scope and is dropped during collection.",
    ],
    lanes: [],
  };
}

// `--sessions` selects declared lanes by number or range. Notes stay optional: an orientation block
// alone is enough, and a `## <session>` heading adds direction to a session already selected.
function specSessions({ sessionsSpec, notesPath, declared, gate }) {
  const { groups, problems } = parseSessionSpec(sessionsSpec, declared);
  let orientations = [];
  const directions = new Map();
  if (notesPath) {
    const parsed = parseNotes(resolve(notesPath));
    orientations = parsed.orientations;
    for (const { name, note, custom } of parsed.notes) {
      if (custom) {
        problems.push(`\`custom:${name}\` needs the notes path without --sessions`);
        continue;
      }
      directions.set(name, note);
    }
  }
  const selected = new Set(groups.map((group) => group.name));
  for (const name of directions.keys()) {
    if (!selected.has(name)) {
      problems.push(`the notes give direction to \`${name}\`, which --sessions did not select`);
    }
  }
  const sessions = groups.map((group) => {
    const lanes = group.members.map((member) => member.session);
    for (const lane of lanes) {
      const problem = untriggeredProblem(lane, gate);
      if (problem !== null) problems.push(problem);
    }
    return laneSession(group.name, lanes, directions.get(group.name) ?? "");
  });
  return { sessions, orientations, problems };
}

function manualSessions({ notesPath, declared, gate }) {
  const parsed = parseNotes(resolve(notesPath));
  if (parsed.notes.length === 0) manifestFail("the notes file declares no session heading");
  const sessions = [];
  const problems = [];
  for (const { name, note, custom } of parsed.notes) {
    const session = declared.get(name);
    if (custom) {
      if (session) problems.push(`\`custom:${name}\` collides with the declared lane \`${name}\``);
      if (!note.trim()) problems.push(`\`custom:${name}\` has no task text`);
      sessions.push(customSession(name, note));
      continue;
    }
    const rowProblem = deterministicRowProblem(name);
    if (rowProblem !== null) {
      problems.push(rowProblem);
      continue;
    }
    if (!session) {
      problems.push(`unknown lane \`${name}\` — run with --list to see the declared names`);
      continue;
    }
    if (!note.trim()) problems.push(`\`${name}\` has no direction under its heading`);
    const untriggered = untriggeredProblem(session, gate);
    if (untriggered !== null) problems.push(untriggered);
    sessions.push(laneSession(name, [session], note));
  }
  return { sessions, orientations: parsed.orientations, problems };
}

function validateSessionSet({ sessions, orientations, problems, autoCount, sessionsSpec }) {
  const seen = new Set();
  for (const session of sessions) {
    if (seen.has(session.name)) problems.push(`duplicate session heading: ${session.name}`);
    seen.add(session.name);
  }
  const orientationIssues = orientationProblems(orientations);
  let orientationText;
  if (orientationIssues.length === 0) orientationText = orientations[0].text;
  else if ((autoCount > 0 || sessionsSpec) && orientations.length === 0) {
    orientationText =
      "No reviewer orientation was supplied. Orient only from the verified controller facts below.";
  } else problems.push(...orientationIssues);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`build-manifest: ${problem}`);
    runtimeProcess.exit(2);
  }
  return { sessions, seen, orientationText };
}

export function resolveSessions(requested) {
  if (requested.declared.has(ORIENTATION_HEADING)) {
    manifestFail(`this tree declares the reserved session name \`${ORIENTATION_HEADING}\``);
  }
  const result = requested.sessionsSpec
    ? specSessions(requested)
    : requested.autoCount > 0
      ? autoSessions(requested)
      : manualSessions(requested);
  return validateSessionSet({ ...requested, ...result, problems: result.problems ?? [] });
}

function admissionLines(sessions, mode) {
  const rows = sessions.map((session) => {
    const lanes = session.lanes.length > 0 ? session.lanes.map((lane) => lane.number).join(",") : "none";
    const reason = session.custom ? "directed task" : "standing lane";
    return `- ${session.name}: mode=${mode}; state=active; identity=${session.name}; lanes=${lanes}; reason=${reason}`;
  });
  const verdicts = DIGEST_VERDICTS.map(
    (name) =>
      `- ${name}: state=recorded-deterministic; trigger=preflight; reason=settled before model review`,
  );
  return [
    "## Progressive admission and deterministic ledger",
    "",
    `Admission mode: ${mode}. These rows are the launch ledger; do not widen or silently replace them.`,
    "In exhaustive mode every assigned lane must report; its trigger selects depth, not omission.",
    ...rows,
    "",
    "Digest verdicts are deterministic rows, not model assignments:",
    ...verdicts,
    "",
  ];
}

function commandLines({ webAccess, bun, bunPin, worktree, campaign, runId }) {
  return [
    "## Transport capabilities",
    "",
    webAccess
      ? "This transport has web access."
      : "This transport has no web access: `public_source` is a product capability, not a session " +
        "capability. Do not spend wall time rediscovering that limit.",
    "",
    "## Commands",
    "",
    `Bun ${bunPin}: \`${bun}\``,
    "",
    `From \`${worktree}\`:`,
    "",
    "```text",
    `${bun} --no-env-file tools/outcome/cli.ts ${campaign} ${runId} [flags]`,
    `${bun} --no-env-file tools/outcome/cli.ts ${campaign} --builder`,
    `${bun} --no-env-file .claude/skills/final-harness-audit/scripts/harness-versions.mjs`,
    `${bun} --no-env-file .claude/skills/attribution-and-proof/scripts/inspect-solvability.mjs`,
    "```",
    "",
    "Useful flags: `--scan`; `--scorecard`; `--cases --result <kind>`; `--cases --family <name>`;",
    "`--case <taskId>`; `--trace <taskId>`; `--observations --level warning`; `--judge`. The scan",
    "reports and never gates. The two helper scripts replace manual re-derivation.",
  ];
}

export function composeInstructions(input) {
  const { snapshot, sessions } = input;
  const assignments = sessions.map((session) =>
    session.custom
      ? `- \`${session.name}\` — directed contradiction task (no standing lane)`
      : `- \`${session.name}\` — assignedSession: ${session.title}`,
  );
  const lines = [
    `# Whole-run investigation — ${input.title}`,
    "",
    "You are one independent leaf session, with no delegation, coordination or launcher authority.",
    `Repository worktree: \`${input.worktree}\` at source \`${input.revision}\`. Campaign: \`${input.campaign}\`.`,
    `Run ID: \`${input.runId}\`. Do not write, commit or launch anything; never touch \`.controller.lock\`;`,
    "generated output under `campaigns/` or `domains/` is immutable. Evidence outranks prose. A",
    "started run is not a completed run.",
    "",
    input.live
      ? `This run was live at \`${snapshot.status.capturedAt}\`. Every count is partial. Label each ` +
        "conclusion `current`, `deferred` or `stale`, and bind it to a source SHA, bundle hash, " +
        "evidence ID or snapshot time."
      : `Snapshot captured \`${snapshot.status.capturedAt}\`.`,
    "",
    "## Orientation",
    "",
    "The reviewer's reading of this run, from the same snapshot. It orients and does not conclude:",
    "contradict any line with evidence and report that as the finding.",
    "",
    input.orientationText,
    "",
    "## Controller facts, already verified (do not rediscover; disagreement is a finding)",
    "",
    factsBlock(snapshot),
    "",
    ...(input.shared
      ? [
          "## Run overview (recorded bytes rendered from shared-instructions.json; the primary may have edited it)",
          "",
          renderSharedInstructions(input.shared),
          "",
        ]
      : []),
    input.contextText
      ? ["## The moved variable and prior state", "", input.contextText, ""].join("\n")
      : "The moved variable for this run was not supplied to the launcher. Do not infer it from\n" +
        "evidence; treat it as an open identity question.\n",
    "## Assignments in this launch",
    "",
    "Report headings outside your own assignment are invalid and dropped during collection.",
    "",
    ...assignments,
    "",
    ...admissionLines(sessions, input.reviewMode ?? "targeted"),
    ...snapshotLines(snapshot),
    "",
    ...commandLines(input),
    "",
    ...reportingLines(),
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/** The public-only lane freezes its judgement before joining outcomes. Shared orientation, scan and
 *  even aggregate verdicts are evidence from the other side of that boundary. */
export function publicOnlySession(session) {
  return session.lanes.some((lane) => lane.number === PUBLIC_ONLY_LANE);
}

export function publicReviewInstructions(input) {
  return [
    "# Independent public-only review",
    `This evidence boundary applies to lane ${PUBLIC_ONLY_LANE}; other assignments use their own context below.`,
    `Measured source: \`${input.revision}\` in \`${input.worktree}\`.`,
    `Campaign: \`${input.campaign}\`; run: \`${input.runId}\`.`,
    `Capture: \`${input.snapshot.status.capturedAt}\`.`,
    "Authority: read-only, no delegation or product launches. Never change recorded evidence or controller locks.",
    "Before freezing your result, read only the original request and configured model identities from opening.json,",
    "public rules and public task inputs, public agent tools, and accepted artifact bytes selected independently",
    "of their verdicts. Select all available artifacts or a public-family sample fixed before reading outcomes.",
    "Do not read shared instructions, orientation, prior syntheses, scan, digest, case verdicts, controls,",
    "hidden expectations, evaluator/reference implementation, private traces or another reviewer's reports.",
    "Inspect only public fields when a storage file also contains protected fields; prefer recorded public-task.json.",
    "Freeze the public corpus of valid alternatives and plausibly wrong artifacts, with its identities, before any permitted later join.",
    "If forbidden information was already exposed, disclose contamination and do not claim a blinded result.",
    `Runtime: Bun ${input.bunPin}, \`${input.bun}\`. Web access: ${input.webAccess ? "available" : "unavailable"}.`,
    "Report only your assigned headings, method, frozen input identities, denominators, findings and limits.",
    "Join recorded verdicts only after freezing the independent result and only when your assignment permits it.",
    "Never quote protected verifier output, private counterexamples or per-task failure locations in the report.",
    ...reportingLines(),
  ].join("\n");
}

function taskParts(session) {
  const assignment = [`assignedSession: ${session.name}`];
  if (session.lanes.length > 0) {
    assignment.push(`assignedLanes: ${session.lanes.map((lane) => pad(lane.number)).join(", ")}`);
    for (const lane of session.lanes) {
      assignment.push(`startsFrom: lane ${pad(lane.number)}: ${lane.trigger}`);
    }
  }
  if (session.custom) {
    return [
      ...assignment,
      "assignmentKind: directed contradiction task",
      `expectedHeading: ## ${session.name}`,
      "",
      `Report exactly one section headed \`## ${session.name}\`; headings outside this assignment are dropped during collection.`,
      "",
      session.direction,
    ];
  }
  return [
    ...assignment,
    "assignmentKind: grouped semantic review",
    "",
    "Report one clearly separated section per assigned lane, each headed exactly `## lane_NN`",
    "using the two-digit lane numbers above; headings outside your assignment are dropped",
    "during collection. Quote the `startsFrom:` line of each lane under its `### Started from`.",
    "",
    ...(session.direction ? [session.direction, ""] : []),
    session.bodyParts.join("\n\n"),
  ];
}

/** @param {{ campaign: string, runId: string } | null} [expected] */
function verifiedTraceChallenge(challengeDir, expected = null) {
  const statusPath = join(challengeDir, "trace-challenge-status.json");
  const telemetryPath = join(challengeDir, "trace-telemetry.json");
  const packetPath = join(challengeDir, "trace-challenge-packet.json");
  const promptPath = join(challengeDir, "trace-challenge-prompt.md");
  if (!existsSync(statusPath)) {
    manifestFail(`lane ${TRACE_CHALLENGE_LANE} is assigned but its trace-challenge status is missing`);
  }
  let status;
  try {
    status = readJsonFile(statusPath);
  } catch (error) {
    manifestFail(`lane ${TRACE_CHALLENGE_LANE} trace-challenge status is unreadable: ${error.message}`);
  }
  if (status?.schema !== "whole-run-trace-challenge-status/v1" || status.complete !== true) {
    manifestFail(`lane ${TRACE_CHALLENGE_LANE} requires a complete whole-run trace-challenge packet`);
  }
  if (expected !== null) {
    if (status.campaign !== expected.campaign) {
      manifestFail(
        `lane ${TRACE_CHALLENGE_LANE} trace-challenge campaign does not match the canonical campaign path`,
      );
    }
    if (status.runId !== expected.runId) {
      manifestFail(`lane ${TRACE_CHALLENGE_LANE} trace-challenge runId does not match the launch identity`);
    }
  }
  if (!SHA_256.test(String(status.telemetrySha256 ?? ""))) {
    manifestFail(`lane ${TRACE_CHALLENGE_LANE} trace-challenge telemetry has no concrete sha256`);
  }
  if (!existsSync(telemetryPath) || !existsSync(packetPath) || !existsSync(promptPath)) {
    manifestFail(
      `lane ${TRACE_CHALLENGE_LANE} trace-challenge requires both telemetry and the redacted packet`,
    );
  }
  if (status.telemetry !== telemetryPath || status.packet !== packetPath || status.prompt !== promptPath) {
    manifestFail(
      `lane ${TRACE_CHALLENGE_LANE} trace-challenge status paths do not name its canonical packet files`,
    );
  }
  if (sha256(readFileSync(telemetryPath)) !== status.telemetrySha256) {
    manifestFail(
      `lane ${TRACE_CHALLENGE_LANE} trace-challenge telemetry digest does not match its status record`,
    );
  }
  if (!SHA_256.test(String(status.packetSha256 ?? ""))) {
    manifestFail(`lane ${TRACE_CHALLENGE_LANE} trace-challenge packet has no concrete sha256`);
  }
  if (sha256(readFileSync(packetPath)) !== status.packetSha256) {
    manifestFail(
      `lane ${TRACE_CHALLENGE_LANE} trace-challenge packet digest does not match its status record`,
    );
  }
  return { statusPath, telemetryPath, packetPath, promptPath };
}

/** The isolation rules an isolated lane's task carries, one per lane, beside its lane body. */
function isolationLines(session, challenge) {
  const numbers = session.lanes.map((lane) => lane.number);
  const lines = [];
  if (numbers.some((number) => ISOLATED_ANGLES.has(number))) lines.push("", ISOLATION_RULE);
  if (numbers.includes(TRACE_CHALLENGE_LANE)) {
    lines.push(
      "",
      `Private lane ${TRACE_CHALLENGE_LANE} trace evidence: read \`${challenge.telemetryPath}\`, \`${challenge.packetPath}\` and ` +
        `\`${challenge.promptPath}\` only after checking telemetry and packet sha256 values in \`${challenge.statusPath}\`. ` +
        `This is read-only evidence: never run the trace-challenge writer. The packet is assigned only to lane ${TRACE_CHALLENGE_LANE}; do not disclose or read it for another session.`,
    );
  }
  if (numbers.includes(PUBLIC_ONLY_LANE)) {
    lines.push(
      "",
      `Lane ${PUBLIC_ONLY_LANE} freezes its public-only corpus of valid alternatives and plausibly wrong artifacts, with ` +
        "their identities, before reading any verdict, verifier source, control, hidden expectation or " +
        "other lane's report; only then run the corpus through the recorded verifier and report the 2x2.",
    );
  }
  return lines;
}

/** @param {string | null} [challengeDir]
 *  @param {{ campaign: string, runId: string, reviewMode: string } | null} [challengeIdentity] */
export function composeTasks(sessions, challengeDir = null, challengeIdentity = null) {
  const traceSession = sessions.find((session) =>
    session.lanes.some((lane) => lane.number === TRACE_CHALLENGE_LANE),
  );
  const challenge =
    traceSession === undefined
      ? null
      : challengeDir === null
        ? manifestFail(
            `lane ${TRACE_CHALLENGE_LANE} is assigned but no trace-challenge directory was supplied`,
          )
        : verifiedTraceChallenge(challengeDir, challengeIdentity);
  const admissionMode = challengeIdentity?.reviewMode ?? "targeted";
  return sessions.map((session) => {
    const parts = taskParts(publicOnlySession(session) ? { ...session, direction: "" } : session);
    parts.push(...isolationLines(session, challenge));
    return {
      name: session.name,
      task: parts.join("\n"),
      admission: {
        schema: "wri-progressive-admission/v2",
        mode: admissionMode,
        state: "active",
        identityKey: session.name,
        lanes: session.lanes.map((lane) => lane.number),
        triggers: session.lanes.map((lane) => lane.trigger),
      },
    };
  });
}

function writeNativePrompts(outPath, instructions, tasks) {
  const promptsDir = join(outPath, "prompts");
  mkdirSync(promptsDir, { recursive: true });
  for (const task of tasks) {
    writeFileSync(
      join(promptsDir, `${task.name}.md`),
      `${instructions.trimEnd()}\n\n---\n\n# Your assignment\n\n${task.task}\n\n${FIX_AUTHORITY}\n`,
    );
  }
  console.log(`\nnative transport: ${promptsDir} (${tasks.length} self-contained prompts)`);
}

function lunaArgs({ launcherPath, bun, tasksPath, instructionsPath, worktree, effort, outputDir }) {
  return [
    bun,
    "--no-env-file",
    launcherPath,
    "--tasks-file",
    tasksPath,
    "--instructions-file",
    instructionsPath,
    "--workdir",
    worktree,
    "--output-dir",
    outputDir,
    "--reasoning-effort",
    effort,
  ];
}

/** Codex transport from Claude Code: one self-contained prompt per lane, detached past the Bash
 *  tool's 600 s wall by codex-sessions.mjs, so the reviewer writes no instruction packet by hand. */
function writeCodexTasks(outPath, instructions, tasks) {
  const codexTasksPath = join(outPath, "codex-tasks.json");
  const rows = tasks.map(({ name, task }) => ({ name, task: leafPrompt(instructions, task) }));
  writeJsonFile(codexTasksPath, rows);
  return codexTasksPath;
}

export function writeAndDispatch(input) {
  const outPath = resolve(input.outDir);
  mkdirSync(outPath, { recursive: true });
  const instructionsPath = join(outPath, "instructions.md");
  const tasksPath = join(outPath, "tasks.json");
  const launcherTasksPath = join(outPath, "luna-tasks.json");
  writeFileSync(instructionsPath, `${input.instructions.trimEnd()}\n`);
  writeJsonFile(tasksPath, input.tasks);
  // The WRI manifest carries its admission ledger, while the Luna launcher intentionally accepts
  // only its small {name, task} transport shape. Bind the two by the sidecar below rather than
  // weakening the launcher schema with review-only metadata.
  writeJsonFile(
    launcherTasksPath,
    input.tasks.map(({ name, task }) => ({ name, task })),
  );
  const authored =
    input.orientationText.length + input.sessions.reduce((sum, session) => sum + session.direction.length, 0);
  const total = input.tasks.reduce((sum, task) => sum + task.task.length, 0) + input.instructions.length;
  console.log(`instructions: ${instructionsPath}`);
  console.log(`tasks:        ${tasksPath}  (${input.tasks.length} sessions)`);
  console.log(
    `authored:     ${authored} of ${total} chars (${((authored / total) * 100).toFixed(1)}% written by hand)`,
  );
  if (input.transport === "native") {
    writeNativePrompts(outPath, input.instructions, input.tasks);
    return;
  }
  if (input.transport === "codex") {
    const codexTasksPath = writeCodexTasks(outPath, input.instructions, input.tasks);
    const outputDir = join(outPath, "codex-output");
    const args = [
      input.bun,
      "--no-env-file",
      input.codexLauncherPath,
      "launch",
      "--tasks-file",
      codexTasksPath,
      "--out-dir",
      outputDir,
      "--workdir",
      input.worktree,
      "--model",
      "gpt-5.6-luna",
      "--effort",
      input.effort,
    ];
    console.log(`\nlaunch:\n${args.join(" ")}`);
    if (!input.launch) return;
    if (!existsSync(input.codexLauncherPath)) manifestFail(`no codex launcher at ${input.codexLauncherPath}`);
    console.log(runTextSyncOrThrow(args).trimEnd());
    return;
  }
  const outputDir = join(outPath, "luna-output");
  const args = lunaArgs({ ...input, tasksPath: launcherTasksPath, instructionsPath, outputDir });
  console.log(`\nlaunch:\n${args.slice(0, 3).join(" ")} ${args.slice(3).join(" ")}`);
  if (!input.launch) return;
  if (!existsSync(input.launcherPath)) manifestFail(`no Luna launcher at ${input.launcherPath}`);
  const identity = { outputDir, workdir: input.worktree, tasksPath, launcherTasksPath, instructionsPath };
  if (input.detach) {
    detachLauncher(args, outPath, outputDir);
    writeLaunchInput(identity, input);
    return;
  }
  try {
    console.log(runTextSyncOrThrow(args).trimEnd());
    if (existsSync(join(outputDir, "launch.json"))) writeLaunchInput(identity, input);
  } catch (error) {
    if (existsSync(join(outputDir, "launch.json"))) {
      // The launcher may have opened its immutable record before a provider failure. Keep the
      // source/input identity sidecar for an explicit incomplete collection rather than guessing.
      writeJsonFile(join(outputDir, "wri-launch-input.json"), {
        schema: "wri-luna-launch-input/v1",
        ...identity,
      });
    }
    throw new CommandFailure(`launcher failed: ${error.message}`);
  }
}

/** Bind the launched prompts to the manifest bytes once the launcher has opened its record. */
function writeLaunchInput({ outputDir, workdir, tasksPath, launcherTasksPath, instructionsPath }, input) {
  const promptHash = (task) => sha256(new TextEncoder().encode(leafPrompt(input.instructions, task)));
  writeJsonFile(join(outputDir, "wri-launch-input.json"), {
    schema: "wri-luna-launch-input/v1",
    outputDir,
    workdir,
    tasksPath,
    launcherTasksPath,
    tasksSha256: sha256OfFile(tasksPath),
    launcherTasksSha256: sha256OfFile(launcherTasksPath),
    instructionsPath,
    instructionsSha256: sha256OfFile(instructionsPath),
    tasks: input.tasks.map((task) => ({
      name: task.name,
      taskSha256: sha256(new TextEncoder().encode(task.task)),
      admissionSha256: sha256(new TextEncoder().encode(JSON.stringify(task.admission))),
      promptSha256: promptHash(task.task),
    })),
  });
}

/** Start the launcher in a process that outlives this command (a Bash tool call ends at 600 s
 *  while a Luna sweep runs for an hour) and wait only for its launch record. */
function detachLauncher(args, outPath, outputDir) {
  const logPath = join(outPath, "launcher.log");
  const fd = openSync(logPath, "a", 0o600);
  let child;
  try {
    child = Bun.spawn({
      cmd: args,
      cwd: outPath,
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
      env: runtimeProcess.env,
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
  writeFileSync(join(outPath, "launcher.pid"), `${child.pid}\n`);
  const launchPath = join(outputDir, "launch.json");
  const deadline = Date.now() + LAUNCH_RECORD_WAIT_MS;
  while (!existsSync(launchPath)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      manifestFail(
        `launcher pid ${child.pid} wrote no launch record within ${LAUNCH_RECORD_WAIT_MS} ms; read ${logPath}`,
      );
    }
    Bun.sleepSync(250);
  }
  console.log(`\ndetached launcher pid ${child.pid}; log ${logPath}`);
  console.log(
    `sessions finish as luna_session.finished lines; luna_sessions.completed writes ${join(outputDir, "summary.json")}`,
  );
}
