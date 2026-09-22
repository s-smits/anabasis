#!/usr/bin/env bun
import { runtimeProcess } from "#src/meta/process.ts";
import { statSync } from "#src/meta/filesystem.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import {
  MAX_MANIFEST_BYTES,
  absoluteExistingFile,
  normalizeManifest,
  normalizeReasoningEffort,
  parseArgs,
  quickManifest,
  usage,
} from "./luna-sessions-manifest.mjs";
import {
  drainReports,
  registerParentLaunch,
  runLunaSessions,
  sanitizeTerminalText,
  stopHook,
  writeStdout,
} from "./luna-sessions-runtime.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

/** The options that by themselves mean a direct launch rather than a manifest or a drain. */
const QUICK_OPTION_NAMES = ["count", "tasks_file", "workdir", "instructions_file", "task_template"];

async function main(argv) {
  const options = parseArgs(argv);
  if (options.stop_hook) {
    console.log(JSON.stringify(stopHook()));
    return 0;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const usesQuickLaunch = QUICK_OPTION_NAMES.some((name) => options[name] !== undefined);
  const modeCount =
    Number(Boolean(options.manifest)) + Number(Boolean(options.drain)) + Number(usesQuickLaunch);
  if (modeCount !== 1) {
    throw new Error("choose exactly one of --manifest, a direct launch, or --drain");
  }
  if (options.drain) {
    if (
      options.output_dir ||
      options.codex_bin ||
      options.ephemeral ||
      options.launch_only ||
      options.reasoning_effort ||
      options.max_active ||
      options.start_interval_ms
    ) {
      throw new Error("--drain does not accept launch options");
    }
    await drainReports(options.drain, writeStdout);
    return 0;
  }
  let manifest;
  if (options.manifest) {
    if (!isAbsolute(options.manifest)) throw new Error("--manifest must be an absolute path");
    const manifestPath = absoluteExistingFile(options.manifest, "--manifest");
    if (statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
      throw new Error(`--manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    manifest = readJsonFile(manifestPath);
    if (options.max_active !== undefined || options.start_interval_ms !== undefined) {
      manifest = Array.isArray(manifest) ? { sessions: manifest } : { ...manifest };
      if (options.max_active !== undefined) manifest.maxActive = options.max_active;
      if (options.start_interval_ms !== undefined) manifest.startIntervalMs = options.start_interval_ms;
    }
  } else {
    manifest = quickManifest(options);
  }
  const summary = await runLunaSessions(manifest, {
    outputDir: options.output_dir,
    codexBin: options.codex_bin,
    ephemeral: options.ephemeral,
    launchOnly: options.launch_only,
    reasoningEffort: options.reasoning_effort,
    onStart: (launch) => {
      if (!launch.launchOnly) registerParentLaunch(launch);
      console.log(
        JSON.stringify({
          type: "luna_sessions.started",
          outputDir: launch.outputDir,
          sessionCount: launch.sessions.length,
          model: launch.model,
          reasoningEffort: launch.reasoningEffort,
          serviceTier: launch.serviceTier,
          runtime: launch.runtime,
          maxActive: launch.maxActive,
          startIntervalMs: launch.startIntervalMs,
          launchOnly: launch.launchOnly,
        }),
      );
    },
    onSessionFinish: (event) => console.log(JSON.stringify(event)),
  });
  const completedCount = summary.sessions.filter((session) => session.status === "completed").length;
  const rateLimitedCount = summary.sessions.filter((session) => session.failureKind === "rate-limit").length;
  console.log(
    JSON.stringify({
      type: "luna_sessions.completed",
      outputDir: summary.outputDir,
      summaryPath: join(summary.outputDir, "summary.json"),
      completedCount,
      failedCount: summary.sessions.length - completedCount,
      rateLimitedCount,
    }),
  );
  return summary.sessions.every((session) => session.status === "completed") ? 0 : 1;
}

if (import.meta.main) {
  main(Bun.argv.slice(2))
    .then((code) => {
      runtimeProcess.exitCode = code;
    })
    .catch((error) => {
      console.error(sanitizeTerminalText(errorMessage(error)));
      runtimeProcess.exitCode = 1;
    });
}

export {
  drainReports,
  normalizeReasoningEffort,
  normalizeManifest,
  parseArgs,
  quickManifest,
  runLunaSessions,
};
