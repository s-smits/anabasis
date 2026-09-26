#!/usr/bin/env bun
import { runtimeProcess } from "#src/meta/process.ts";
import { statSync } from "#src/meta/filesystem.ts";
import { isAbsolute, join } from "#src/meta/path.ts";
import {
  MAX_MANIFEST_BYTES,
  absoluteExistingFile,
  type LunaOptions,
  normalizeManifest,
  normalizeReasoningEffort,
  OPTIONS,
  optionsFrom,
  quickManifest,
  usage,
} from "./luna-sessions-manifest.ts";
import { exitWith, parseOrDie } from "#skills/main/cli.ts";
import {
  drainReports,
  registerParentLaunch,
  runLunaSessions,
  sanitizeTerminalText,
  stopHook,
  writeStdout,
} from "./luna-sessions-runtime.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { asRecord, type JsonObject } from "#src/meta/json-shape.ts";
import { hasText } from "#src/meta/text.ts";

/** The options that by themselves mean a direct launch rather than a manifest or a drain. */
const QUICK_OPTION_NAMES: readonly (keyof LunaOptions)[] = [
  "count",
  "tasks_file",
  "workdir",
  "instructions_file",
  "task_template",
];

async function main(): Promise<number> {
  const options = optionsFrom(parseOrDie(exitWith("luna-sessions"), OPTIONS));
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
  if (hasText(options.drain)) {
    if (
      hasText(options.output_dir) ||
      hasText(options.codex_bin) ||
      options.ephemeral ||
      options.launch_only ||
      hasText(options.reasoning_effort) ||
      hasText(options.max_active) ||
      hasText(options.start_interval_ms)
    ) {
      throw new Error("--drain does not accept launch options");
    }
    await drainReports(options.drain, writeStdout);
    return 0;
  }
  let manifest: unknown;
  if (hasText(options.manifest)) {
    if (!isAbsolute(options.manifest)) throw new Error("--manifest must be an absolute path");
    const manifestPath = absoluteExistingFile(options.manifest, "--manifest");
    if (statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
      throw new Error(`--manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    const recorded = readJsonFile(manifestPath);
    manifest = recorded;
    if (options.max_active !== undefined || options.start_interval_ms !== undefined) {
      const overridden: JsonObject = Array.isArray(recorded)
        ? { sessions: recorded }
        : { ...asRecord(recorded) };
      if (options.max_active !== undefined) overridden.maxActive = options.max_active;
      if (options.start_interval_ms !== undefined) overridden.startIntervalMs = options.start_interval_ms;
      manifest = overridden;
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
  main()
    .then((code) => {
      runtimeProcess.exitCode = code;
    })
    .catch((error) => {
      console.error(sanitizeTerminalText(errorMessage(error)));
      runtimeProcess.exitCode = 1;
    });
}

export { drainReports, normalizeReasoningEffort, normalizeManifest, quickManifest, runLunaSessions };
