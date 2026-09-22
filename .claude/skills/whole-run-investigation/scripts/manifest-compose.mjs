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
import { DIGEST_VERDICTS } from "./catalogue-shape.mjs";

const LAUNCH_RECORD_WAIT_MS = 30_000;
import {
  BLINDED_PAIRS,
  ORIENTATION_HEADING,
  angleSessions,
  factsBlock,
  manifestFail,
  orientationProblems,
  parseSessionSpec,
  parseNotes,
  partitionAngles,
} from "./manifest-inputs.mjs";

import {
  DIAGNOSTIC_INPUTS,
  diagnosticTaskLines,
  snapshotLines,
  reportingLines,
} from "./manifest-reporting.mjs";
import { renderSharedInstructions } from "./shared-instructions.mjs";
import { hasText } from "#src/meta/text.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

const SHA_256 = /^[0-9a-f]{64}$/;

function autoSessions({ autoCount, notesPath, angles, declared }) {
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
  const angleRows = [...angleSessions(angles).values()].sort((a, b) => a.number - b.number);
  const { groups, mixed } = partitionAngles(angleRows, autoCount);
  const pad = (number) => String(number).padStart(2, "0");
  const sessions = groups.map((group, index) => {
    const numbers = group.map((angle) => angle.number);
    const single = group.length === 1 && !mixed;
    const name = single
      ? `angle_${pad(numbers[0])}`
      : mixed
        ? `angles_group${index + 1}of${groups.length}`
        : `angles_${pad(numbers[0])}_${pad(numbers.at(-1))}`;
    const existing = declared.get(name);
    if (existing && existing.kind !== "angle") {
      manifestFail(`auto group name \`${name}\` collides with a declared ${existing.kind} session`);
    }
    const span = mixed ? numbers.map(pad).join(", ") : `${pad(numbers[0])}-${pad(numbers.at(-1))}`;
    return {
      name,
      custom: false,
      title: single ? group[0].title : `angles ${span} (${group.length} standing angles)`,
      direction: "",
      bodyParts: group.map((angle) => angle.body),
      trigger: null,
      angleNumbers: numbers,
    };
  });
  return { sessions, orientations };
}

function customSession(name, note) {
  return {
    name,
    custom: true,
    title: name,
    direction: note,
    bodyParts: [
      "This task has no standing angle body. Stay inside the question above; a section outside it is",
      "out of scope and is dropped during collection.",
    ],
    trigger: null,
  };
}

// `--sessions` selects declared sessions by number, range or name. Notes stay optional: an orientation
// block alone is enough, and a `## <session>` heading adds direction to a session already selected.
function specSessions({ sessionsSpec, notesPath, declared, referenceNames, consumerHardware }) {
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
    const numbers = group.members
      .filter((member) => member.session.kind === "angle")
      .map((member) => member.session.number);
    if (group.members.some((member) => referenceNames.has(member.name)) && !consumerHardware) {
      problems.push(
        `\`${group.name}\` needs --consumer-hardware so the launcher pins the reference revision`,
      );
    }
    const title =
      group.members.length === 1
        ? group.members[0].session.title
        : `angles ${numbers.map((number) => String(number).padStart(2, "0")).join(", ")} (${numbers.length} standing angles)`;
    return {
      name: group.name,
      custom: false,
      title,
      direction: directions.get(group.name) ?? "",
      bodyParts: group.members.map((member) => member.session.body),
      trigger: group.members.length === 1 ? group.members[0].session.trigger : null,
      angleNumbers: numbers.length > 0 ? numbers : undefined,
    };
  });
  return { sessions, orientations, problems };
}

function manualSessions({ notesPath, declared, retired, referenceNames, consumerHardware }) {
  const parsed = parseNotes(resolve(notesPath));
  if (parsed.notes.length === 0) manifestFail("the notes file declares no session heading");
  const sessions = [];
  const problems = [];
  for (const { name, note, custom } of parsed.notes) {
    const session = declared.get(name);
    if (custom) {
      if (session) problems.push(`\`custom:${name}\` collides with the declared session \`${name}\``);
      if (!note.trim()) problems.push(`\`custom:${name}\` has no task text`);
      sessions.push(customSession(name, note));
      continue;
    }
    const row = /^(?:row|angle)_([a-h])$/i.exec(name);
    if (row && retired.has(row[1].toUpperCase())) {
      const retiredRow = retired.get(row[1].toUpperCase());
      problems.push(
        `row ${row[1].toUpperCase()} is settled by deterministic preflight (owner: ${retiredRow.owner})`,
      );
      continue;
    }
    if (!session) {
      problems.push(`unknown session \`${name}\` — run with --list to see the declared names`);
      continue;
    }
    if (!note.trim()) problems.push(`\`${name}\` has no direction under its heading`);
    if (referenceNames.has(name) && !consumerHardware) {
      problems.push(`\`${name}\` needs --consumer-hardware so the launcher pins the reference revision`);
    }
    sessions.push({
      name,
      custom: false,
      title: session.title,
      direction: note,
      bodyParts: [session.body],
      trigger: session.trigger,
      angleNumbers: session.kind === "angle" ? [session.number] : undefined,
    });
  }
  return { sessions, orientations: parsed.orientations, problems };
}

function validateSessionSet({
  sessions,
  orientations,
  problems,
  referenceNames,
  consumerHardware,
  autoCount,
  sessionsSpec,
}) {
  const seen = new Set();
  for (const session of sessions) {
    if (seen.has(session.name)) problems.push(`duplicate session heading: ${session.name}`);
    seen.add(session.name);
  }
  if (consumerHardware && ![...seen].some((name) => referenceNames.has(name))) {
    problems.push("--consumer-hardware was passed but no reference session is launched");
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
  const diagnosticSpec = [...DIAGNOSTIC_INPUTS.keys()].join(",");
  const input =
    requested.diagnostics &&
    !requested.sessionsSpec &&
    !requested.autoCount &&
    (!requested.notesPath || parseNotes(resolve(requested.notesPath)).notes.length === 0)
      ? { ...requested, sessionsSpec: diagnosticSpec }
      : requested;
  const result = input.sessionsSpec
    ? specSessions(input)
    : input.autoCount > 0
      ? autoSessions(input)
      : manualSessions(input);
  if (input.diagnostics) {
    const extra = specSessions({ ...input, sessionsSpec: diagnosticSpec, notesPath: null });
    result.sessions.push(
      ...extra.sessions.filter(
        (session) => !result.sessions.some((existing) => existing.name === session.name),
      ),
    );
    result.problems = [...(result.problems ?? []), ...extra.problems];
  }
  return validateSessionSet({ ...input, ...result, problems: result.problems ?? [] });
}

function referenceLines(reference) {
  if (!reference) return [];
  return [
    "## Reference implementation (consumer hardware)",
    "",
    `The pinned reference tree is \`${reference.root}\` at revision \`${reference.revision}\`` +
      `${reference.dirty ? " (DIRTY at pin time — report this in every reference finding)" : " (clean)"}. ` +
      "Cite this revision; do not re-resolve it. Only reference sessions read this tree. It is " +
      "diagnostic, never authority: a disagreement is a symmetric question and a reason to inspect " +
      "the verifier, never to re-score a case. Reference-derived detail is protected like verifier " +
      "detail and must never be proposed for a Builder, judge or other model-visible text.",
    "",
  ];
}

function admissionLines(sessions, mode) {
  const rows = sessions.map((session) => {
    const angles = session.angleNumbers?.length ? session.angleNumbers.join(",") : "none";
    const trigger = session.trigger ?? "none recorded";
    const reason = session.custom
      ? "directed task"
      : session.angleNumbers?.length
        ? "standing angle"
        : "intelligence task";
    return `- ${session.name}: mode=${mode}; state=active; identity=${session.name}; angles=${angles}; trigger=${trigger}; reason=${reason}`;
  });
  const verdicts = DIGEST_VERDICTS.map(
    (name) =>
      `- ${name}: state=recorded-deterministic; trigger=preflight; reason=settled before model review`,
  );
  return [
    "## Progressive admission and deterministic ledger",
    "",
    `Admission mode: ${mode}. These rows are the launch ledger; do not widen or silently replace them.`,
    "In exhaustive mode every assigned angle must report; its trigger selects depth, not omission.",
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
      ? `- \`${session.name}\` — directed contradiction task (no standing angle)`
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
    ...referenceLines(input.reference),
    "## Assignments in this launch",
    "",
    "Report headings outside your own assignment are invalid and dropped during collection.",
    "",
    ...assignments,
    "",
    ...admissionLines(sessions, input.reviewMode ?? "targeted"),
    ...snapshotLines(snapshot, sessions),
    "",
    ...commandLines(input),
    "",
    ...reportingLines(),
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/** These lanes freeze a public-only judgement before joining outcomes. Shared orientation,
 * scan and even aggregate verdicts are evidence from the other side of that boundary. */
export function publicOnlySession(session) {
  return (
    session.name === "reference_verdict_comparison" ||
    session.angleNumbers?.some((number) => [19, 20, 36].includes(number)) === true
  );
}

export function publicReviewInstructions(input) {
  return [
    "# Independent public-only review",
    "This evidence boundary applies to angles 19, 20, 36 and reference_verdict_comparison; other assignments use their own context below.",
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
    "Freeze the public calculation or valid-alternative corpus and its identities before any permitted later join.",
    "If forbidden information was already exposed, disclose contamination and do not claim a blinded result.",
    `Runtime: Bun ${input.bunPin}, \`${input.bun}\`. Web access: ${input.webAccess ? "available" : "unavailable"}.`,
    ...referenceLines(input.reference),
    "Report only your assigned headings, method, frozen input identities, denominators, findings and limits.",
    "Join recorded verdicts only after freezing the independent result and only when your assignment permits it.",
    "Never quote protected verifier output, private counterexamples or per-task failure locations in the report.",
  ].join("\n");
}

function partnerSessions(sessions) {
  const sessionOfAngle = new Map();
  for (const session of sessions) {
    for (const number of session.angleNumbers ?? []) {
      sessionOfAngle.set(`angle_${String(number).padStart(2, "0")}`, session);
    }
  }
  const partners = new Map();
  for (const [a, b] of BLINDED_PAIRS) {
    const first = sessionOfAngle.get(a);
    const second = sessionOfAngle.get(b);
    if (first && second && first !== second) {
      partners.set(first.name, second.name);
      partners.set(second.name, first.name);
    }
  }
  return partners;
}

function referenceBlindNote(session, seen, referenceNames, partner) {
  const inGroup =
    referenceNames.has(session.name) || [19, 20].some((number) => session.angleNumbers?.includes(number));
  if (!inGroup || ![...seen].some((name) => referenceNames.has(name))) return null;
  const unread = [...seen].filter(
    (name) =>
      name !== session.name &&
      name !== partner &&
      (referenceNames.has(name) || name === "angle_19" || name === "angle_20"),
  );
  return unread.length > 0
    ? `Do not read the output, worktree scratch or report of ${unread.map((name) => `\`${name}\``).join(", ")} ` +
        "before your own report is written; reach the reference comparison separately from their verdicts."
    : null;
}

function taskParts(session) {
  const assignment = [`assignedSession: ${session.name}`];
  assignment.push(...diagnosticTaskLines(session.name));
  if (session.angleNumbers?.length) {
    assignment.push(
      `assignedAngles: ${session.angleNumbers.map((number) => String(number).padStart(2, "0")).join(", ")}`,
    );
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
  if (session.direction && !session.angleNumbers?.length) {
    return [
      ...assignment,
      `expectedHeading: ## ${session.name}`,
      "",
      `Report exactly one section headed \`## ${session.name}\`; headings outside this assignment are dropped during collection.`,
      "",
      session.direction,
      "",
      ...session.bodyParts,
    ];
  }
  if (!session.angleNumbers?.length) {
    return [
      ...assignment,
      "assignmentKind: standing session",
      `expectedHeading: ## ${session.name}`,
      "",
      `Report exactly one section headed \`## ${session.name}\`; headings outside this assignment are dropped during collection.`,
      "",
      ...session.bodyParts,
    ];
  }
  return [
    ...assignment,
    "assignmentKind: grouped semantic review",
    "",
    "Report one clearly separated section per assigned angle, each headed exactly `## angle_NN`",
    "using the two-digit angle numbers below; headings outside your assignment are dropped",
    "during collection.",
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
  if (!existsSync(statusPath)) manifestFail("angle 15 is assigned but its trace-challenge status is missing");
  let status;
  try {
    status = readJsonFile(statusPath);
  } catch (error) {
    manifestFail(`angle 15 trace-challenge status is unreadable: ${error.message}`);
  }
  if (status?.schema !== "whole-run-trace-challenge-status/v1" || status.complete !== true) {
    manifestFail("angle 15 requires a complete whole-run trace-challenge packet");
  }
  if (expected !== null) {
    if (status.campaign !== expected.campaign) {
      manifestFail("angle 15 trace-challenge campaign does not match the canonical campaign path");
    }
    if (status.runId !== expected.runId) {
      manifestFail("angle 15 trace-challenge runId does not match the launch identity");
    }
  }
  if (!SHA_256.test(String(status.telemetrySha256 ?? ""))) {
    manifestFail("angle 15 trace-challenge telemetry has no concrete sha256");
  }
  if (!existsSync(telemetryPath) || !existsSync(packetPath) || !existsSync(promptPath)) {
    manifestFail("angle 15 trace-challenge requires both telemetry and the redacted packet");
  }
  if (status.telemetry !== telemetryPath || status.packet !== packetPath || status.prompt !== promptPath) {
    manifestFail("angle 15 trace-challenge status paths do not name its canonical packet files");
  }
  const telemetry = readFileSync(telemetryPath);
  const actualTelemetry = new Bun.CryptoHasher("sha256").update(telemetry).digest("hex");
  if (actualTelemetry !== status.telemetrySha256) {
    manifestFail("angle 15 trace-challenge telemetry digest does not match its status record");
  }
  if (!SHA_256.test(String(status.packetSha256 ?? ""))) {
    manifestFail("angle 15 trace-challenge packet has no concrete sha256");
  }
  const packet = readFileSync(packetPath);
  const actualPacket = new Bun.CryptoHasher("sha256").update(packet).digest("hex");
  if (actualPacket !== status.packetSha256) {
    manifestFail("angle 15 trace-challenge packet digest does not match its status record");
  }
  return { statusPath, telemetryPath, packetPath, promptPath };
}

/** @param {string | null} [challengeDir]
 *  @param {{ campaign: string, runId: string, reviewMode: string } | null} [challengeIdentity] */
export function composeTasks(sessions, seen, referenceNames, challengeDir = null, challengeIdentity = null) {
  const partners = partnerSessions(sessions);
  const angle15Session = sessions.find((session) => session.angleNumbers?.includes(15));
  const challenge =
    angle15Session === undefined
      ? null
      : challengeDir === null
        ? manifestFail("angle 15 is assigned but no trace-challenge directory was supplied")
        : verifiedTraceChallenge(challengeDir, challengeIdentity);
  const admissionMode = challengeIdentity?.reviewMode ?? "targeted";
  return sessions.map((session) => {
    const publicOnly = publicOnlySession(session);
    const parts = taskParts(publicOnly ? { ...session, direction: "" } : session);
    if (session.trigger && !publicOnly) {
      parts.push("", `Activation trigger recorded for this launch: ${session.trigger}`);
    }
    const partner = partners.get(session.name);
    if (partner) {
      parts.push(
        "",
        `You are the blinded counterpart of \`${partner}\`, which is running now on the same question ` +
          "by a different method. Do not read its output, worktree scratch or report. Derive your " +
          "answer independently; agreement is evidence only when reached separately.",
      );
    }
    const referenceNote = referenceBlindNote(session, seen, referenceNames, partner);
    if (hasText(referenceNote)) parts.push("", referenceNote);
    if (challenge && session === angle15Session) {
      parts.push(
        "",
        `Private angle 15 trace evidence: read \`${challenge.telemetryPath}\`, \`${challenge.packetPath}\` and ` +
          `\`${challenge.promptPath}\` only after checking telemetry and packet sha256 values in \`${challenge.statusPath}\`. ` +
          "This is read-only evidence: never run the trace-challenge writer. The packet is assigned only to angle 15; do not disclose or read it for another session.",
      );
    }
    return {
      name: session.name,
      task: parts.join("\n"),
      admission: {
        schema: "wri-progressive-admission/v1",
        mode: admissionMode,
        state: "active",
        identityKey: session.name,
        angles: [...(session.angleNumbers ?? [])],
        trigger: session.trigger ?? null,
      },
    };
  });
}

function stressArgs(tasks, stress) {
  if (!stress) return [];
  if (tasks.length <= 15) {
    manifestFail("--stress is reserved for an explicitly requested 16-50-session launch");
  }
  if (tasks.length > 50) manifestFail("--stress allows at most 50 sessions");
  console.log("\nexplicit stress launch: the operator supplied --stress for this 16-50-session manifest.");
  return ["--stress"];
}

function writeNativePrompts(outPath, instructions, tasks) {
  const promptsDir = join(outPath, "prompts");
  mkdirSync(promptsDir, { recursive: true });
  for (const task of tasks) {
    writeFileSync(
      join(promptsDir, `${task.name}.md`),
      `${instructions.trimEnd()}\n\n---\n\n# Your assignment\n\n${task.task}\n`,
    );
  }
  console.log(`\nnative transport: ${promptsDir} (${tasks.length} self-contained prompts)`);
}

function lunaArgs({ launcherPath, bun, tasksPath, instructionsPath, worktree, effort, stress, outputDir }) {
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
    ...stress,
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

const leafPrompt = (instructions, task) =>
  `${instructions.trim()}\n\n${task.trim()}\n\nAuthority: read-only. Do not edit files or change external state.`;

export function writeAndDispatch(input) {
  const outPath = resolve(input.outDir);
  const stress = stressArgs(input.tasks, input.stress === true);
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
  const args = lunaArgs({ ...input, tasksPath: launcherTasksPath, instructionsPath, stress, outputDir });
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
    console.error(`build-manifest: launcher failed: ${error.message}`);
    if (existsSync(outputDir) && existsSync(join(outputDir, "launch.json"))) {
      // The launcher may have opened its immutable record before a provider failure. Keep the
      // source/input identity sidecar for an explicit incomplete collection rather than guessing.
      writeFileSync(
        join(outputDir, "wri-launch-input.json"),
        JSON.stringify({ schema: "wri-luna-launch-input/v1", ...identity }, null, 2),
      );
    }
    runtimeProcess.exit(1);
  }
}

/** Bind the launched prompts to the manifest bytes once the launcher has opened its record. */
function writeLaunchInput({ outputDir, workdir, tasksPath, launcherTasksPath, instructionsPath }, input) {
  const hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const promptHash = (task) => hash(new TextEncoder().encode(leafPrompt(input.instructions, task)));
  writeFileSync(
    join(outputDir, "wri-launch-input.json"),
    `${JSON.stringify(
      {
        schema: "wri-luna-launch-input/v1",
        outputDir,
        workdir,
        tasksPath,
        launcherTasksPath,
        tasksSha256: hash(readFileSync(tasksPath)),
        launcherTasksSha256: hash(readFileSync(launcherTasksPath)),
        instructionsPath,
        instructionsSha256: hash(readFileSync(instructionsPath)),
        tasks: input.tasks.map((task) => ({
          name: task.name,
          taskSha256: hash(new TextEncoder().encode(task.task)),
          admissionSha256: hash(new TextEncoder().encode(JSON.stringify(task.admission))),
          promptSha256: promptHash(task.task),
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
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
