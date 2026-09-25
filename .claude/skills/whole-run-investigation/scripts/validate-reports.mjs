#!/usr/bin/env bun
// Join a completed Luna summary back to the WRI task manifest. This validates collection identity,
// assigned lane headings and the report sections each lane owes; it does not adjudicate findings or
// turn session prose into evidence.

import { sha256, sha256OfFile } from "#src/meta/digest.ts";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { dirname, isAbsolute, join, relative } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { emitReport } from "#skills/main/output.ts";
import { ANGLE_COUNT, ISOLATED_ANGLES, angleNumbers, leafPrompt, SHA256 } from "./catalogue-shape.mjs";
import { FINDING_OWNERS, REPORT_SECTIONS } from "./manifest-reporting.mjs";
import { hasText } from "#src/meta/text.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

/** The record types luna-sessions.mjs writes when it opens and when it drains a collection. */
const SUMMARY_TYPE = "luna_sessions.completed";
const LAUNCH_TYPE = "luna_sessions.launch";
const ADMISSION_SCHEMA = "wri-progressive-admission/v2";
const RECEIPT_SCHEMA = "wri-report-validation/v2";

function assignedLanes(task, index) {
  const matches = [...task.matchAll(/^assignedLanes:\s*(.+)$/gm)];
  if (matches.length > 1) throw new Error(`tasks[${index}] declares assignedLanes more than once`);
  if (matches.length === 0) return [];
  const values = matches[0][1].split(",").map((value) => value.trim());
  if (values.some((value) => !/^\d{2}$/.test(value) || Number(value) < 1 || Number(value) > ANGLE_COUNT)) {
    throw new Error(`tasks[${index}] has invalid assignedLanes: ${matches[0][1]}`);
  }
  if (new Set(values).size !== values.length) throw new Error(`tasks[${index}] repeats an assigned lane`);
  return values;
}

function admission(value, index, lanes) {
  const row = asRecord(value);
  if (!row) {
    throw new Error(
      `tasks[${index}].admission is missing; progressive disclosure must be recorded in the manifest`,
    );
  }
  if (row.schema !== ADMISSION_SCHEMA) {
    throw new Error(`tasks[${index}].admission schema must be ${ADMISSION_SCHEMA}; received ${row.schema}`);
  }
  if (!isString(row.mode) || !["targeted", "exhaustive"].includes(row.mode)) {
    throw new Error(`tasks[${index}].admission.mode must be targeted or exhaustive`);
  }
  if (row.state !== "active") throw new Error(`tasks[${index}] has an inactive progressive admission row`);
  if (!isString(row.identityKey) || row.identityKey.length === 0) {
    throw new Error(`tasks[${index}].admission.identityKey is missing`);
  }
  if (
    !Array.isArray(row.lanes) ||
    row.lanes.some((lane) => !Number.isInteger(lane) || lane < 1 || lane > ANGLE_COUNT)
  ) {
    throw new Error(`tasks[${index}].admission.lanes must contain only integer lanes 1-${ANGLE_COUNT}`);
  }
  const expected = lanes.map((lane) => Number(lane));
  if (JSON.stringify([...row.lanes]) !== JSON.stringify(expected)) {
    throw new Error(`tasks[${index}].admission.lanes do not match assignedLanes`);
  }
  if (
    !Array.isArray(row.triggers) ||
    row.triggers.length !== row.lanes.length ||
    row.triggers.some((trigger) => !isString(trigger) || trigger.trim().length === 0)
  ) {
    throw new Error(`tasks[${index}].admission.triggers must name one trigger per assigned lane`);
  }
  return row;
}

/** Exhaustive admission covers every open lane exactly once and each isolated lane at most once;
 *  targeted admission only forbids assigning one lane twice. */
function checkLaneCoverage(rows) {
  const admitted = rows.flatMap((row) => row.admission.lanes);
  const repeated = admitted.filter((lane, position) => admitted.indexOf(lane) !== position);
  if (repeated.length > 0) {
    throw new Error(
      `progressive admission assigns lane ${String(repeated[0]).padStart(2, "0")} more than once`,
    );
  }
  if (rows[0].admission.mode !== "exhaustive") return;
  const open = angleNumbers().filter((lane) => !ISOLATED_ANGLES.has(lane));
  const missing = open.filter((lane) => !admitted.includes(lane));
  if (missing.length > 0) {
    throw new Error(
      `exhaustive progressive admission must cover every open lane exactly once; missing ${missing.map((lane) => String(lane).padStart(2, "0")).join(", ")}`,
    );
  }
}

function taskRows(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("tasks.json must contain at least one task");
  }
  const seen = new Set();
  const rows = tasks.map((value, index) => {
    const row = asRecord(value);
    if (!row) throw new Error(`tasks[${index}] must be an object`);
    if (!isString(row.name) || !/^[a-z][a-z0-9_]{0,47}$/.test(row.name)) {
      throw new Error(`tasks[${index}].name is invalid`);
    }
    if (seen.has(row.name)) throw new Error(`duplicate task name: ${row.name}`);
    seen.add(row.name);
    if (!isString(row.task) || row.task.trim().length === 0) throw new Error(`tasks[${index}].task is empty`);
    const lanes = assignedLanes(row.task, index);
    const admitted = admission(row.admission, index, lanes);
    if (admitted.identityKey !== row.name) {
      throw new Error(`tasks[${index}].admission.identityKey must equal task name`);
    }
    return { name: row.name, task: row.task, lanes, admission: admitted };
  });
  const modes = new Set(rows.map((row) => row.admission.mode));
  if (modes.size !== 1) throw new Error("tasks.json must use one progressive admission mode");
  checkLaneCoverage(rows);
  return rows;
}

/** The `###` subsections of one `## <heading>` section, keyed by title, with their bodies. */
function subsections(sectionText) {
  const found = new Map();
  for (const match of sectionText.matchAll(/^###\s+(.+?)\s*$/gm)) {
    const title = match[1].trim();
    const start = match.index + match[0].length;
    const rest = sectionText.slice(start);
    const next = /^###\s/m.exec(rest);
    const body = (next ? rest.slice(0, next.index) : rest).trim();
    found.set(title, [...(found.get(title) ?? []), body]);
  }
  return found;
}

/** What one lane section owes: every report section exactly once, in order and non-empty, and a
 *  `Findings` body that is either `none` or entries each naming one admitted owner. */
function sectionIssues(heading, sectionText) {
  const issues = [];
  const found = subsections(sectionText);
  const order = [...sectionText.matchAll(/^###\s+(.+?)\s*$/gm)].map((match) => match[1].trim());
  for (const section of REPORT_SECTIONS) {
    const bodies = found.get(section) ?? [];
    if (bodies.length !== 1) {
      issues.push(`${heading}: section \`### ${section}\` missing or repeated`);
      continue;
    }
    if (bodies[0].length === 0) issues.push(`${heading}: section \`### ${section}\` is empty`);
  }
  const expectedOrder = REPORT_SECTIONS.filter((section) => found.has(section));
  const actualOrder = order.filter((section) => REPORT_SECTIONS.includes(section));
  if (JSON.stringify(expectedOrder) !== JSON.stringify(actualOrder)) {
    issues.push(`${heading}: report sections are out of order`);
  }
  const findings = found.get("Findings")?.[0];
  if (findings !== undefined && findings.length > 0 && findings !== "none") {
    const owners = [...findings.matchAll(/^\s*(?:[-*]\s*)?owner:\s*(.+?)\s*$/gm)].map((match) => match[1]);
    if (owners.length === 0) issues.push(`${heading}: findings name no owner`);
    for (const owner of owners) {
      if (!FINDING_OWNERS.includes(owner)) {
        issues.push(`${heading}: finding owner \`${owner}\` is not one of ${FINDING_OWNERS.join(", ")}`);
      }
    }
  }
  return issues;
}

/** The text under each `## <name>` heading, in report order, with repeats kept as repeats. */
function topSections(text) {
  const matches = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].filter((match) => !match[0].startsWith("###"));
  return matches.map((match, position) => {
    const start = match.index + match[0].length;
    const end = position + 1 < matches.length ? matches[position + 1].index : text.length;
    return { name: match[1].trim(), body: text.slice(start, end) };
  });
}

function reportContract(task, text, index) {
  const sections = topSections(text);
  const names = sections.map((section) => section.name);
  const headings = names.flatMap((name) => /^lane_(\d{2})$/.exec(name)?.[1] ?? []);
  const expected = expectedHeading(task.task, index);
  const issues = [];
  const unexpected =
    task.lanes.length > 0
      ? headings.filter((heading) => !task.lanes.includes(heading))
      : names.filter((heading) => heading !== expected);
  const missing =
    task.lanes.length > 0
      ? task.lanes.filter((lane) => headings.filter((heading) => heading === lane).length !== 1)
      : expected === null || names.filter((heading) => heading === expected).length !== 1
        ? [expected ?? "expected heading"]
        : [];
  if (unexpected.length > 0) {
    issues.push(
      task.lanes.length > 0
        ? `out-of-scope lane headings: ${[...new Set(unexpected)].join(", ")}`
        : `out-of-scope report headings: ${[...new Set(unexpected)].join(", ")}`,
    );
  }
  if (missing.length > 0) {
    issues.push(
      task.lanes.length > 0
        ? `assigned lane headings missing or repeated: ${missing.join(", ")}`
        : `expected heading missing or repeated: ${missing.join(", ")}`,
    );
  }
  const owed = task.lanes.length > 0 ? task.lanes.map((lane) => `lane_${lane}`) : [expected];
  for (const section of sections) {
    if (owed.includes(section.name)) issues.push(...sectionIssues(`## ${section.name}`, section.body));
  }
  return { issues, headings };
}

function expectedHeading(task, index) {
  const matches = [...task.matchAll(/^expectedHeading:\s*##\s+(.+?)\s*$/gim)];
  if (matches.length > 1) throw new Error(`tasks[${index}] declares expectedHeading more than once`);
  return matches.length === 0 ? null : matches[0][1].trim();
}

/** Whether `rows` name exactly the tasks, in the tasks' order. */
function sameNames(rows, tasks) {
  const names = rows.map((row) => asRecord(row)?.name);
  return names.length === tasks.length && names.every((name, index) => name === tasks[index].name);
}

/** What the launch input beside the launcher's record binds: the task, launcher and instruction
 *  digests, and each session's prompt digest against the exact leaf prompt bytes. */
function inputBinding(input, tasks, taskBytes, tasksPath, sessions) {
  const issues = [];
  let instructionsSha256 = null;
  let promptDigestsBound = false;
  if (isString(input.tasksPath) && isAbsolute(input.tasksPath) && existsSync(input.tasksPath)) {
    if (realpathSync(input.tasksPath) !== realpathSync(tasksPath)) {
      issues.push("launch input tasksPath differs from supplied tasks.json path");
    }
    const actual = sha256OfFile(input.tasksPath);
    if (input.tasksSha256 !== actual) issues.push("launch input task digest differs from tasks.json");
    if (actual !== sha256(taskBytes)) {
      issues.push("launch input tasksPath bytes differ from supplied tasks.json");
    }
  } else {
    issues.push("launch input tasksPath is absent or unreadable");
  }
  if (
    isString(input.launcherTasksPath) &&
    isAbsolute(input.launcherTasksPath) &&
    existsSync(input.launcherTasksPath)
  ) {
    const launcherBytes = readFileSync(input.launcherTasksPath);
    if (input.launcherTasksSha256 !== sha256(launcherBytes)) {
      issues.push("launch input launcher task digest is stale");
    }
    try {
      const launcherTasks = capturedJsonParse(launcherBytes.toString("utf8"));
      if (
        !Array.isArray(launcherTasks) ||
        JSON.stringify(launcherTasks) !==
          JSON.stringify(tasks.map((task) => ({ name: task.name, task: task.task })))
      ) {
        issues.push("launcher task bytes differ from the WRI task projection");
      }
    } catch (error) {
      issues.push(`launcher task file is not valid JSON: ${errorMessage(error)}`);
    }
  }
  if (
    isString(input.instructionsPath) &&
    isAbsolute(input.instructionsPath) &&
    existsSync(input.instructionsPath)
  ) {
    instructionsSha256 = sha256OfFile(input.instructionsPath);
    if (input.instructionsSha256 !== instructionsSha256) {
      issues.push("launch input instruction digest is stale");
    }
  } else {
    issues.push("launch input instructionsPath is absent or unreadable");
  }
  if (isString(input.workdir)) {
    if (!isAbsolute(input.workdir)) issues.push("launch input workdir is not absolute");
    sessions.forEach((session, index) => {
      if (asRecord(session)?.workdir !== input.workdir) {
        issues.push(`launch.sessions[${index}].workdir differs from the recorded launch workdir`);
      }
    });
  }
  if (Array.isArray(input.tasks)) {
    if (!sameNames(input.tasks, tasks)) {
      issues.push("launch input task order/identity differs from supplied tasks");
    }
    input.tasks.forEach((value, index) => {
      const task = asRecord(value);
      if (!task) {
        issues.push(`launch input task ${index} is not an object`);
        return;
      }
      if (!SHA256.test(String(task.taskSha256 ?? ""))) {
        issues.push(`launch input task ${index} has no exact task digest`);
      } else if (task.taskSha256 !== sha256(new TextEncoder().encode(tasks[index]?.task ?? ""))) {
        issues.push(`launch input task ${index} digest differs from supplied task bytes`);
      }
      if (!SHA256.test(String(task.admissionSha256 ?? ""))) {
        issues.push(`launch input task ${index} has no exact admission digest`);
      } else if (
        task.admissionSha256 !== sha256(new TextEncoder().encode(JSON.stringify(tasks[index]?.admission)))
      ) {
        issues.push(`launch input task ${index} admission digest differs from supplied admission ledger`);
      }
    });
  }
  if (
    instructionsSha256 !== null &&
    input.instructionsSha256 === instructionsSha256 &&
    Array.isArray(input.tasks)
  ) {
    const instructions = readFileSync(input.instructionsPath).toString("utf8").trim();
    const promptHash = (task) => sha256(new TextEncoder().encode(leafPrompt(instructions, task)));
    sessions.forEach((session, index) => {
      const expectedHash = promptHash(tasks[index].task);
      if (asRecord(session)?.promptSha256 !== expectedHash) {
        issues.push(`launch.sessions[${index}].promptSha256 does not match the exact launcher prompt bytes`);
      }
      const recorded = asRecord(input.tasks[index])?.promptSha256;
      if (recorded !== expectedHash) {
        issues.push(`launch input task ${index} promptSha256 does not match the exact launcher prompt bytes`);
      }
    });
    promptDigestsBound = true;
  }
  return { issues, instructionsSha256, promptDigestsBound };
}

function launchBinding(outputDir, tasks, taskBytes, summary, tasksPath) {
  const launchPath = join(outputDir, "launch.json");
  if (!existsSync(launchPath) || !statSync(launchPath).isFile()) {
    return {
      state: "invalid",
      issues: ["launch.json is absent, so the reports' prompt identity cannot be bound"],
      promptDigestsBound: false,
    };
  }
  const launchBytes = readFileSync(launchPath);
  let launch;
  try {
    launch = asRecord(capturedJsonParse(launchBytes.toString("utf8")));
  } catch (error) {
    return {
      state: "invalid",
      issues: [`launch.json is not valid JSON: ${errorMessage(error)}`],
      promptDigestsBound: false,
    };
  }
  const issues = [];
  if (!launch || launch.type !== LAUNCH_TYPE || !Array.isArray(launch.sessions)) {
    issues.push("launch.json is not a Luna launch record");
  }
  if (launch) {
    let launchOutput = null;
    try {
      if (isString(launch.outputDir) && isAbsolute(launch.outputDir)) {
        launchOutput = realpathSync(launch.outputDir);
      }
    } catch {
      // The stable mismatch below reports an absent or stale output identity.
    }
    if (launchOutput !== outputDir) issues.push("launch.json outputDir differs from summary outputDir");
  }
  const sessions = launch?.sessions ?? [];
  if (!sameNames(sessions, tasks)) {
    issues.push("launch session order/identity differs from tasks");
  }
  sessions.forEach((session, index) => {
    const row = asRecord(session);
    if (!row) {
      issues.push(`launch.sessions[${index}] is not an object`);
      return;
    }
    if (!isString(row.workdir) || !isAbsolute(row.workdir)) {
      issues.push(`launch.sessions[${index}].workdir is not absolute`);
    }
    if (row.sandbox !== "read-only") issues.push(`launch.sessions[${index}].sandbox must be read-only`);
    if (!Array.isArray(row.ownedPaths) || row.ownedPaths.length > 0) {
      issues.push(`launch.sessions[${index}].ownedPaths must be an empty array`);
    }
    if (!SHA256.test(String(row.promptSha256 ?? ""))) {
      issues.push(`launch.sessions[${index}].promptSha256 is missing or invalid`);
    }
  });
  // manifest-compose writes the launch input beside the launcher's record, which carries none.
  let input = null;
  let inputPath = null;
  const sidecarPath = join(outputDir, "wri-launch-input.json");
  if (existsSync(sidecarPath) && statSync(sidecarPath).isFile()) {
    try {
      input = asRecord(readJsonFile(sidecarPath));
      inputPath = sidecarPath;
    } catch (error) {
      return {
        state: "invalid",
        issues: [`wri-launch-input.json is not valid JSON: ${errorMessage(error)}`],
        promptDigestsBound: false,
      };
    }
  }
  const bound = input
    ? inputBinding(input, tasks, taskBytes, tasksPath, sessions)
    : { issues: [], instructionsSha256: null, promptDigestsBound: false };
  issues.push(...bound.issues);
  const { instructionsSha256, promptDigestsBound } = bound;
  const complete = input && promptDigestsBound ? "bound" : "incomplete";
  return {
    state: issues.length === 0 ? complete : "invalid",
    reason: input ? null : "launch.json has prompt hashes but no original task/instruction digest record",
    issues,
    launchPath,
    launchSha256: sha256(launchBytes),
    inputPath,
    tasksSha256: sha256(taskBytes),
    instructionsSha256,
    promptDigestsBound,
    summaryType: summary.type,
  };
}

function containedReport(outputDir, path) {
  if (!isString(path) || !isAbsolute(path) || !existsSync(path) || !statSync(path).isFile()) return null;
  const actual = realpathSync(path);
  const rel = relative(outputDir, actual);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? actual : null;
}

function validate(paths) {
  const taskBytes = readFileSync(paths.tasksPath);
  const summaryBytes = readFileSync(paths.summaryPath);
  const tasks = taskRows(capturedJsonParse(taskBytes.toString("utf8")));
  const summary = asRecord(capturedJsonParse(summaryBytes.toString("utf8")));
  if (!summary || summary.type !== SUMMARY_TYPE || !Array.isArray(summary.sessions)) {
    throw new Error("summary.json is not a completed Luna summary");
  }
  if (!isString(summary.outputDir) || !isAbsolute(summary.outputDir)) {
    throw new Error("summary.outputDir must be an absolute directory");
  }
  const outputDir = realpathSync(summary.outputDir);
  if (realpathSync(dirname(paths.summaryPath)) !== outputDir) {
    throw new Error("summary.json is not inside its recorded outputDir");
  }
  const rows = [];
  const launch = launchBinding(outputDir, tasks, taskBytes, summary, paths.tasksPath);
  if (!sameNames(summary.sessions, tasks)) {
    const names = summary.sessions.map((session) => asRecord(session)?.name);
    throw new Error(
      `summary session order/identity differs from tasks: expected ${tasks.map((task) => task.name).join(", ")}; received ${names.join(", ")}`,
    );
  }
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const session = asRecord(summary.sessions[index]);
    if (!session) throw new Error(`summary session ${index} is not an object`);
    const issues = [];
    if (session.status !== "completed" || session.exitCode !== 0) {
      issues.push(
        `terminal status is ${session.status ?? "missing"} with exitCode ${String(session.exitCode)}`,
      );
    }
    const reportPath = containedReport(outputDir, session.reportPath);
    if (!hasText(reportPath)) issues.push("reportPath is missing, not a regular file, or outside outputDir");
    let reportBytes = new Uint8Array();
    let headings = [];
    if (hasText(reportPath)) {
      reportBytes = readFileSync(reportPath);
      if (reportBytes.byteLength === 0) issues.push("report is empty");
      const checked = reportContract(task, reportBytes.toString("utf8"), index);
      headings = checked.headings;
      issues.push(...checked.issues);
    }
    rows.push({
      name: task.name,
      assignedLanes: task.lanes,
      reportedLanes: headings,
      status: issues.length === 0 ? "accepted-for-adjudication" : "rejected",
      issues,
      reportPath,
      reportBytes: reportBytes.byteLength,
      reportSha256: hasText(reportPath) ? sha256(reportBytes) : null,
      expectedHeading: task.lanes.length > 0 ? null : expectedHeading(task.task, index),
    });
  }
  return {
    schema: RECEIPT_SCHEMA,
    tasksPath: paths.tasksPath,
    tasksSha256: sha256(taskBytes),
    summaryPath: paths.summaryPath,
    summarySha256: sha256(summaryBytes),
    outputDir,
    launchBinding: launch,
    complete: launch.state !== "invalid" && rows.every((row) => row.status === "accepted-for-adjudication"),
    rows,
  };
}

/** The receipt always lands at `--out` (beside the summary by default), even for a collection that
 *  could not be validated (exit 2), and the console names it; an incomplete one exits 1. */
function validateCommand(args) {
  const summaryPath = args.required("summary");
  const paths = {
    tasksPath: args.required("tasks"),
    summaryPath,
    outPath: args.value("out") ?? join(dirname(summaryPath), "wri-report-validation.json"),
  };
  mkdirSync(dirname(paths.outPath), { recursive: true });
  let result;
  try {
    result = validate(paths);
  } catch (error) {
    const message = errorMessage(error);
    writeJsonFile(paths.outPath, {
      schema: RECEIPT_SCHEMA,
      tasksPath: paths.tasksPath,
      summaryPath: paths.summaryPath,
      complete: false,
      launchBinding: { state: "invalid", reason: message, promptDigestsBound: false },
      rows: [],
      issues: [message],
    });
    throw new CommandFailure(message, 2);
  }
  emitReport(result, { json: false, out: paths.outPath, render: () => paths.outPath });
  return result.complete ? 0 : 1;
}

await runCommand(
  {
    name: "validate-reports",
    usage:
      "usage: bun validate-reports.mjs --tasks <abs tasks.json> --summary <abs summary.json> [--out <abs file>]",
    options: { tasks: "abs", summary: "abs", out: "abs" },
  },
  validateCommand,
);
