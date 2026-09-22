// Bun discovers this ESM test through the repository's portable .claude entrypoint.
import assert from "../src/meta/assert.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";

import { test } from "bun:test";

const { normalizeReasoningEffort, parseArgs } = await import(
  "../.claude/skills/codex-luna-swarm/scripts/luna-sessions.mjs"
);
const launcherPath = join(import.meta.dir, "../.claude/skills/codex-luna-swarm/scripts/luna-sessions.mjs");
const markdownParserPath = join(dirname(launcherPath), "parse-markdown-tasks.mjs");

const managedStart = "# codex-luna-swarm:start";
const managedEnd = "# codex-luna-swarm:end";
const expectedStopHookCommand =
  'bun "$(git rev-parse --show-toplevel)/.claude/skills/codex-luna-swarm/scripts/luna-sessions.mjs" --stop-hook';

/** Decode both streams once so the assertions below compare text. */
function runText(cmd, options = {}) {
  const result = runSync(cmd, options);
  return { ...result, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
}
const repositoryRoot = join(dirname(launcherPath), "..", "..", "..", "..");
function managedBlock(config) {
  const start = config.indexOf(managedStart);
  const end = config.indexOf(managedEnd, start);
  assert.notEqual(start, -1, "managed Luna hook start marker is present");
  assert.notEqual(end, -1, "managed Luna hook end marker is present");
  return config.slice(start, end + managedEnd.length);
}

function configuredCommand(config) {
  const match = managedBlock(config).match(/^command = '([^']+)'$/m);
  assert.ok(match, "managed Luna hook command is present");
  return match[1];
}

test("accepts high, xhigh, and max while defaulting to max", () => {
  assert.equal(normalizeReasoningEffort(), "max");
  assert.equal(normalizeReasoningEffort("high"), "high");
  assert.equal(normalizeReasoningEffort("xhigh"), "xhigh");
  assert.equal(normalizeReasoningEffort("max"), "max");
  assert.throws(
    () => normalizeReasoningEffort("medium"),
    /--reasoning-effort must be one of high, xhigh, or max/,
  );
  assert.equal(parseArgs(["--reasoning-effort", "high"]).reasoning_effort, "high");
});

test("emits Markdown task names accepted by the launcher manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-task-name-test-"));
  try {
    const input = join(root, "tasks.md");
    const output = join(root, "tasks.json");
    writeFileSync(
      input,
      `# Tasks\n\n## ${"Long repeated heading ".repeat(8)}\n\nInspect it.\n\n## ${"Another long heading ".repeat(8)}\n\nInspect this too.\n`,
    );
    const parsed = runText([
      Bun.argv[0],
      markdownParserPath,
      "--input",
      input,
      "--output",
      output,
      "--expected-count",
      "2",
    ]);
    assert.equal(parsed.exitCode, 0, parsed.stderr);
    const tasks = JSON.parse(readFileSync(output, "utf8"));
    for (const { name } of tasks) assert.match(name, /^[a-z][a-z0-9_]{0,47}$/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("passes the CLI-selected effort to Codex and records it in both receipts", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-sessions-effort-test-"));
  try {
    const workdir = join(root, "workdir");
    const outputDir = join(root, "output");
    const fakeCodex = join(root, "fake-codex");
    const manifestPath = join(root, "manifest.json");
    mkdirSync(workdir);
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env bun
const args = Bun.argv.slice(2);
const reportIndex = args.indexOf("--output-last-message");
if (reportIndex < 0 || !args[reportIndex + 1]) Bun.exit(2);
const reportPath = args[reportIndex + 1];
const reportDir = reportPath.slice(0, reportPath.lastIndexOf("/"));
await Bun.write(reportPath, "test report\\n");
await Bun.write(reportDir + "/fake-codex-args.json", JSON.stringify(args));
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread_test_123" }));
`,
      { mode: 0o700 },
    );
    chmodSync(fakeCodex, 0o700);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        workdir,
        sessions: [{ name: "effort", task: "Return a short test report." }],
      }),
    );

    const result = runText([
      Bun.argv[0],
      launcherPath,
      "--manifest",
      manifestPath,
      "--codex-bin",
      fakeCodex,
      "--output-dir",
      outputDir,
      "--reasoning-effort",
      "xhigh",
      "--launch-only",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);

    const launch = JSON.parse(readFileSync(join(outputDir, "launch.json"), "utf8"));
    const summary = JSON.parse(readFileSync(join(outputDir, "summary.json"), "utf8"));
    const args = JSON.parse(readFileSync(join(outputDir, "fake-codex-args.json"), "utf8"));
    const started = JSON.parse(result.stdout.trim().split("\n")[0]);
    assert.equal(started.reasoningEffort, "xhigh");
    assert.equal(launch.reasoningEffort, "xhigh");
    assert.equal(launch.runtime.bunVersion, Bun.version);
    assert.equal(launch.runtime.nodeVersion, undefined);
    assert.equal(summary.reasoningEffort, "xhigh");
    assert.equal(summary.sessions[0].status, "completed");
    assert.equal(summary.sessions[0].exitCode, 0);
    assert.ok(args.includes('model_reasoning_effort="xhigh"'));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("configures the tracked stop hook exactly as the skill snippet declares", () => {
  const config = readFileSync(join(repositoryRoot, ".codex", "config.toml"), "utf8");
  const snippet = readFileSync(join(dirname(dirname(launcherPath)), "assets", "config.toml.snippet"), "utf8");
  assert.equal(managedBlock(config), managedBlock(snippet));
  assert.equal(configuredCommand(config), expectedStopHookCommand);
});

test("the stop hook lets a nested child Luna session end", () => {
  // Run the launcher through its resolved path. The tracked command locates the repository
  // with `git rev-parse`; this test needs only the hook's nested-session behaviour.
  // Calling it directly also works in a test copy without Git metadata. The previous test
  // checks that the tracked command and installation snippet agree.
  const result = runText([Bun.argv[0], launcherPath, "--stop-hook"], {
    env: { ...Bun.env, CODEX_LUNA_SESSION: "1" },
    input: "{}\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "{}\n");
  assert.equal(result.stderr, "");
});
