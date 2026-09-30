// Bun discovers this ESM test through the repository's portable .claude entrypoint.
import assert from "../src/meta/assert.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { double, required } from "./helpers/doubles.ts";
import type { LunaOptions } from "../.claude/skills/codex-luna-swarm/scripts/luna-sessions-manifest.ts";

import { test } from "bun:test";

const { normalizeManifest, normalizeReasoningEffort, quickManifest } = await import(
  "../.claude/skills/codex-luna-swarm/scripts/luna-sessions.ts"
);
const launcherPath = join(import.meta.dir, "../.claude/skills/codex-luna-swarm/scripts/luna-sessions.ts");
const markdownParserPath = join(dirname(launcherPath), "parse-markdown-tasks.ts");

/** The launcher's `launch.json` receipt, as far as these tests read it. */
interface LaunchReceipt {
  reasoningEffort: string;
  runtime: { bunVersion: string; nodeVersion?: string };
}

interface SessionSummary {
  reasoningEffort: string;
  sessions: { name: string; status: string; exitCode: number; failureKind: string | null }[];
}

const BUN = required(Bun.argv[0], "the running bun");
const managedStart = "# codex-luna-swarm:start";
const managedEnd = "# codex-luna-swarm:end";
const expectedStopHookCommand =
  'bun "$(git rev-parse --show-toplevel)/.claude/skills/codex-luna-swarm/scripts/luna-sessions.ts" --stop-hook';

/** Decode both streams once so the assertions below compare text. */
function runText(cmd: string[], options: Parameters<typeof runSync>[1] = {}) {
  const result = runSync(cmd, options);
  return { ...result, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
}
const repositoryRoot = join(dirname(launcherPath), "..", "..", "..", "..");
function managedBlock(config: string) {
  const start = config.indexOf(managedStart);
  const end = config.indexOf(managedEnd, start);
  assert.notEqual(start, -1, "managed Luna hook start marker is present");
  assert.notEqual(end, -1, "managed Luna hook end marker is present");
  return config.slice(start, end + managedEnd.length);
}

function configuredCommand(config: string) {
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
});

// A direct launch's row may own one path, which the WRI hardware lanes use for their scratch.
test("lets a direct-launch row own a path under workspace-write and still refuses anything else", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-quick-"));
  try {
    const scratch = join(root, "scratch");
    mkdirSync(scratch);
    const instructions = join(root, "instructions.md");
    writeFileSync(instructions, "shared\n");
    const manifest = (rows: unknown[]) => {
      const tasks = join(root, "tasks.json");
      writeFileSync(tasks, JSON.stringify(rows));
      return normalizeManifest(
        quickManifest(
          double<LunaOptions>({ tasks_file: tasks, workdir: root, instructions_file: instructions }),
        ),
      );
    };
    const [open, owner] = manifest([
      { name: "a", task: "x" },
      { name: "b", task: "y", workdir: scratch, sandbox: "workspace-write", ownedPaths: [scratch] },
    ]);
    assert.equal(open?.sandbox, "read-only");
    assert.deepEqual(open?.ownedPaths, []);
    assert.equal(owner?.sandbox, "workspace-write");
    assert.deepEqual(owner?.ownedPaths, [scratch]);
    assert.equal(owner?.workdir, realpathSync(scratch));
    assert.throws(
      () => manifest([{ name: "b", task: "y", sandbox: "workspace-write" }]),
      /must declare ownedPaths/,
    );
    assert.throws(() => manifest([{ name: "b", task: "y", model: "other" }]), /unsupported fields: model/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses an unknown or valueless option with exit 2 before launching anything", () => {
  for (const [args, message] of [
    [["--reasoning-effrot", "high"], /luna-sessions: unknown option "--reasoning-effrot"/],
    [["--drain"], /luna-sessions: option "--drain" needs a value/],
  ] satisfies [string[], RegExp][]) {
    const result = runText([BUN, launcherPath, ...args]);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, message);
  }
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
      BUN,
      markdownParserPath,
      "--input",
      input,
      "--output",
      output,
      "--expected-count",
      "2",
    ]);
    assert.equal(parsed.exitCode, 0, parsed.stderr);
    const tasks = parseJsonAs<{ name: string }[]>(readFileSync(output, "utf8"));
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
      BUN,
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

    const launch = parseJsonAs<LaunchReceipt>(readFileSync(join(outputDir, "launch.json"), "utf8"));
    const summary = parseJsonAs<SessionSummary>(readFileSync(join(outputDir, "summary.json"), "utf8"));
    const args = parseJsonAs<string[]>(readFileSync(join(outputDir, "fake-codex-args.json"), "utf8"));
    const started = parseJsonAs<{ reasoningEffort: string }>(
      required(result.stdout.trim().split("\n")[0], "the started line"),
    );
    assert.equal(started.reasoningEffort, "xhigh");
    assert.equal(launch.reasoningEffort, "xhigh");
    assert.equal(launch.runtime.bunVersion, Bun.version);
    assert.equal(launch.runtime.nodeVersion, undefined);
    assert.equal(summary.reasoningEffort, "xhigh");
    assert.equal(summary.sessions[0]?.status, "completed");
    assert.equal(summary.sessions[0]?.exitCode, 0);
    assert.ok(args.includes('model_reasoning_effort="xhigh"'));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("labels a session rate limited from what Codex reported, not from what a command printed", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-sessions-rate-limit-test-"));
  try {
    const workdir = join(root, "workdir");
    const outputDir = join(root, "output");
    const fakeCodex = join(root, "fake-codex");
    const manifestPath = join(root, "manifest.json");
    mkdirSync(workdir);
    // Both sessions fail on "429 Too Many Requests". One read it in a file, which Codex records as a
    // command's output; the other received it from the provider, which Codex records as an error.
    writeFileSync(
      fakeCodex,
      `#!/usr/bin/env bun
const prompt = await Bun.stdin.text();
const text = "429 Too Many Requests";
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread_test_429" }));
console.log(
  JSON.stringify(
    prompt.includes("THROTTLED")
      ? { type: "error", message: text }
      : { type: "item.completed", item: { type: "command_execution", aggregated_output: text } },
  ),
);
process.exit(1);
`,
      { mode: 0o700 },
    );
    chmodSync(fakeCodex, 0o700);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        workdir,
        sessions: [
          { name: "reader", task: "Read a file that quotes a status." },
          { name: "throttled", task: "THROTTLED: meet the refusal." },
        ],
      }),
    );

    const result = runText([
      BUN,
      launcherPath,
      "--manifest",
      manifestPath,
      "--codex-bin",
      fakeCodex,
      "--output-dir",
      outputDir,
      "--launch-only",
    ]);
    // A failed session fails the launch; the completion line counts only the one Codex refused.
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stdout, /"rateLimitedCount":1/);

    const summary = parseJsonAs<SessionSummary>(readFileSync(join(outputDir, "summary.json"), "utf8"));
    const kinds = Object.fromEntries(
      summary.sessions.map((row) => [row.name, [row.status, row.failureKind]]),
    );
    assert.deepEqual(kinds, { reader: ["failed", null], throttled: ["failed", "rate-limit"] });
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
  const result = runText([BUN, launcherPath, "--stop-hook"], {
    env: { ...Bun.env, CODEX_LUNA_SESSION: "1" },
    input: "{}\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "{}\n");
  assert.equal(result.stderr, "");
});
