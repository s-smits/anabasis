#!/usr/bin/env bun
// Join a completed Luna summary back to the WRI task manifest. This validates collection identity
// and assigned angle headings; it does not adjudicate findings or turn session prose into evidence.

import { sha256, sha256OfFile } from "#src/meta/digest.ts";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { dirname, isAbsolute, join, relative } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { emitReport } from "#skills/main/output.ts";
import { ANGLE_COUNT, angleNumbers, leafPrompt, SHA256 } from "./catalogue-shape.mjs";
import { hasText } from "#src/meta/text.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

/** The record types luna-sessions.mjs writes when it opens and when it drains a collection. */
const SUMMARY_TYPE = "luna_sessions.completed";
const LAUNCH_TYPE = "luna_sessions.launch";

function assignedAngles(task, index) {
  const matches = [...task.matchAll(/^assignedAngles:\s*(.+)$/gm)];
  if (matches.length > 1) throw new Error(`tasks[${index}] declares assignedAngles more than once`);
  if (matches.length === 0) return [];
  const values = matches[0][1].split(",").map((value) => value.trim());
  if (values.some((value) => !/^\d{2}$/.test(value) || Number(value) < 1 || Number(value) > ANGLE_COUNT)) {
    throw new Error(`tasks[${index}] has invalid assignedAngles: ${matches[0][1]}`);
  }
  if (new Set(values).size !== values.length) throw new Error(`tasks[${index}] repeats an assigned angle`);
  return values;
}

function admission(value, index, angles) {
  const row = asRecord(value);
  if (!row) {
    throw new Error(
      `tasks[${index}].admission is missing; progressive disclosure must be recorded in the manifest`,
    );
  }
  if (row.schema !== "wri-progressive-admission/v1") {
    throw new Error(`tasks[${index}].admission schema is unsupported`);
  }
  if (!isString(row.mode) || !["targeted", "exhaustive"].includes(row.mode)) {
    throw new Error(`tasks[${index}].admission.mode must be targeted or exhaustive`);
  }
  if (row.state !== "active") throw new Error(`tasks[${index}] has an inactive progressive admission row`);
  if (!isString(row.identityKey) || row.identityKey.length === 0) {
    throw new Error(`tasks[${index}].admission.identityKey is missing`);
  }
  if (
    !Array.isArray(row.angles) ||
    row.angles.some((angle) => !Number.isInteger(angle) || angle < 1 || angle > ANGLE_COUNT)
  ) {
    throw new Error(`tasks[${index}].admission.angles must contain only integer angles 1-${ANGLE_COUNT}`);
  }
  const expected = angles.map((angle) => Number(angle));
  if (JSON.stringify([...row.angles]) !== JSON.stringify(expected)) {
    throw new Error(`tasks[${index}].admission.angles do not match assignedAngles`);
  }
  if (!(row.trigger === null || isString(row.trigger))) {
    throw new Error(`tasks[${index}].admission.trigger must be text or null`);
  }
  if (row.relation !== undefined && row.relation !== "independent-challenge") {
    throw new Error(`tasks[${index}].admission.relation is unsupported`);
  }
  if (
    row.relation === "independent-challenge" &&
    (!isString(row.challengeId) || row.challengeId.trim().length === 0)
  ) {
    throw new Error(`tasks[${index}].admission.challengeId is required for an independent challenge`);
  }
  return row;
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
    const angles = assignedAngles(row.task, index);
    const admitted = admission(row.admission, index, angles);
    if (admitted.identityKey !== row.name) {
      throw new Error(`tasks[${index}].admission.identityKey must equal task name`);
    }
    return { name: row.name, task: row.task, angles, admission: admitted };
  });
  const modes = new Set(rows.map((row) => row.admission.mode));
  if (modes.size !== 1) throw new Error("tasks.json must use one progressive admission mode");
  if (modes.has("exhaustive")) {
    const admittedAngles = rows.flatMap((row) => row.admission.angles);
    const expected = angleNumbers();
    if (JSON.stringify([...admittedAngles].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
      throw new Error("exhaustive progressive admission must cover every active angle exactly once");
    }
  } else {
    const owners = new Map();
    for (const row of rows) {
      for (const angle of row.admission.angles) {
        const prior = owners.get(angle) ?? [];
        prior.push(row);
        owners.set(angle, prior);
      }
    }
    for (const [angle, ownerRows] of owners) {
      if (ownerRows.length < 2) continue;
      const challengeIds = new Set(ownerRows.map((row) => row.admission.challengeId));
      if (
        ownerRows.some((row) => row.admission.relation !== "independent-challenge") ||
        challengeIds.size !== 1 ||
        challengeIds.has(undefined)
      ) {
        throw new Error(
          `targeted progressive admission assigns angle ${String(angle).padStart(2, "0")} more than once without one independent challenge relation`,
        );
      }
    }
  }
  return rows;
}

function diagnosticCoverageIssues(task, text) {
  const declarations = [...task.matchAll(/^assignedDiagnosticInputs:\s*(.+)$/gm)];
  if (declarations.length === 0) return [];
  if (declarations.length !== 1) return ["assignedDiagnosticInputs is repeated"];
  const expected = declarations[0][1].split(",").map((input) => input.trim());
  if (
    new Set(expected).size !== expected.length ||
    expected.some((input) => !/^[a-z][a-z0-9-]*$/.test(input))
  ) {
    return ["assignedDiagnosticInputs is malformed"];
  }
  const rows = text
    .split(/\r?\n/)
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) =>
      line
        .trim()
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`([^`]+)`$/, "$1")),
    );
  const issues = [];
  for (const input of expected) {
    const matches = rows.filter((row) => row[0] === input);
    if (matches.length !== 1) issues.push(`diagnostic input disposition missing or repeated: ${input}`);
    else if (
      !["investigate", "no-action", "unobservable"].includes(matches[0][1]) ||
      !matches[0][2]?.trim()
    ) {
      issues.push(`diagnostic input needs a valid disposition and reason/evidence: ${input}`);
    }
  }
  return issues;
}

function reportContract(task, text, index) {
  const issues = diagnosticCoverageIssues(task.task, text);
  const headings = [...text.matchAll(/^##\s+angle_(\d{2})\s*$/gim)].map((match) => match[1]);
  const names = [...text.matchAll(/^##\s+(.+?)\s*$/gim)].map((match) => match[1].trim());
  const expected = expectedHeading(task.task, index);
  const unexpected =
    task.angles.length > 0
      ? headings.filter((heading) => !task.angles.includes(heading))
      : names.filter((heading) => heading !== expected);
  const missing =
    task.angles.length > 0
      ? task.angles.filter((angle) => headings.filter((heading) => heading === angle).length !== 1)
      : expected === null || names.filter((heading) => heading === expected).length !== 1
        ? [expected ?? "expected heading"]
        : [];
  if (unexpected.length > 0) {
    issues.push(
      task.angles.length > 0
        ? `out-of-scope angle headings: ${[...new Set(unexpected)].join(", ")}`
        : `out-of-scope report headings: ${[...new Set(unexpected)].join(", ")}`,
    );
  }
  if (missing.length > 0) {
    issues.push(
      task.angles.length > 0
        ? `assigned angle headings missing or repeated: ${missing.join(", ")}`
        : `expected heading missing or repeated: ${missing.join(", ")}`,
    );
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
  let instructionsSha256 = null;
  let promptDigestsBound = false;
  if (input) {
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
          issues.push(
            `launch.sessions[${index}].promptSha256 does not match the exact launcher prompt bytes`,
          );
        }
        const recorded = asRecord(input.tasks[index])?.promptSha256;
        if (recorded !== expectedHash) {
          issues.push(
            `launch input task ${index} promptSha256 does not match the exact launcher prompt bytes`,
          );
        }
      });
      promptDigestsBound = true;
    }
  }
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
      assignedAngles: task.angles,
      reportedAngles: headings,
      status: issues.length === 0 ? "accepted-for-adjudication" : "rejected",
      issues,
      reportPath,
      reportBytes: reportBytes.byteLength,
      reportSha256: hasText(reportPath) ? sha256(reportBytes) : null,
      expectedHeading: task.angles.length > 0 ? null : expectedHeading(task.task, index),
    });
  }
  return {
    schema: "wri-report-validation/v1",
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
      schema: "wri-report-validation/v1",
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
