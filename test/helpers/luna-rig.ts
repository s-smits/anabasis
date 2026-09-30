/**
 * A stand-in `codex` for the Luna launcher's tests, and the record of every call it received.
 *
 * The launcher is exercised through its command line only, because that is what every consumer
 * uses: the WRI manifest, the weekly review and a person at a terminal. No real Codex session ever
 * starts: each test passes this script through `--codex-bin`.
 *
 * The script knows a session by the report path the launcher hands it (`<out>/<name>.md`), because
 * a resumed attempt's prompt does not carry the task. Each call runs the next step of that
 * session's plan, repeating the last step once the plan runs out, and appends one line to
 * `calls.jsonl` when it starts and one to `ends.jsonl` when it exits. It ends with
 * `process.exit`: a script that calls a function Bun does not have crashes and prints its own
 * source to stderr, which the launcher would then read as what Codex said.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";
import { scratchDir } from "./scratch.ts";

export const LAUNCHER = join(
  import.meta.dir,
  "../../.claude/skills/codex-luna-swarm/scripts/luna-sessions.ts",
);
export const BUN = runtimeProcess.execPath;

/** What one call of the stand-in does, in this order. */
export interface FakeStep {
  /** Wait until this file exists before doing anything else. */
  waitFor?: string;
  sleepMs?: number;
  /** Print a `thread.started` event naming this thread. */
  thread?: string;
  /** Further events printed to the event log, one JSON line each. */
  events?: object[];
  stderr?: string;
  /** Write this text as the report `--output-last-message` names. */
  report?: string;
  exit?: number;
}

/** One session row as a manifest or a tasks file carries it. `model` is there to be refused. */
export interface SessionRow {
  name: string;
  task: string;
  workdir?: string;
  sandbox?: string;
  ownedPaths?: string[];
  model?: string;
}

/** A manifest's fields besides its sessions. */
export interface ManifestFields {
  instructions?: string;
  instructionsFile?: string;
  sandbox?: string;
}

/** One call as the stand-in recorded it. */
export interface FakeCall {
  name: string;
  attempt: number;
  args: string[];
  cwd: string;
  stdin: string;
  lunaSession: string | null;
  at: number;
}

const FAKE_CODEX = (root: string) => `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const root = ${JSON.stringify(root)};
const args = process.argv.slice(2);
const report = args[args.indexOf("--output-last-message") + 1] ?? "";
const name = report.slice(report.lastIndexOf("/") + 1).replace(/\\.md$/, "");
const stdin = await Bun.stdin.text();
const lines = (file) =>
  existsSync(file) ? readFileSync(file, "utf8").split("\\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const attempt = lines(root + "/calls.jsonl").filter((call) => call.name === name).length;
const plan = JSON.parse(readFileSync(root + "/plan.json", "utf8"))[name] ?? [
  { thread: "thread_" + name + "_0001", report: "report from " + name + "\\n" },
];
const step = plan[Math.min(attempt, plan.length - 1)];
const lunaSession = process.env.CODEX_LUNA_SESSION ?? null;
appendFileSync(root + "/calls.jsonl", JSON.stringify({ name, attempt, args, cwd: process.cwd(), stdin, lunaSession, at: Date.now() }) + "\\n");
if (step.waitFor) while (!existsSync(step.waitFor)) await Bun.sleep(20);
if (step.sleepMs) await Bun.sleep(step.sleepMs);
if (step.thread) console.log(JSON.stringify({ type: "thread.started", thread_id: step.thread }));
for (const event of step.events ?? []) console.log(JSON.stringify(event));
if (step.stderr) console.error(step.stderr);
if (step.report !== undefined) writeFileSync(report, step.report);
appendFileSync(root + "/ends.jsonl", JSON.stringify({ name, attempt, at: Date.now() }) + "\\n");
process.exit(step.exit ?? 0);
`;

/** A step that names a thread, writes a report and exits 0, as a session with no plan does. */
export function done(name: string, step: FakeStep = {}): FakeStep {
  return { thread: `thread_${name}_0001`, report: `report from ${name}\n`, ...step };
}

function jsonLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => parseJsonAs<T>(line));
}

/** A scratch root holding a workdir, the stand-in and its plan, and a not-yet-created output
 *  directory. A step list per session name makes the stand-in succeed, fail or wait on purpose;
 *  a session with no plan does what `done` describes. */
export function lunaRig(prefix: string) {
  const root = realpathSync(scratchDir(prefix));
  const workdir = join(root, "workdir");
  const codex = join(root, "fake-codex");
  const out = join(root, "out");
  mkdirSync(workdir);
  writeFileSync(codex, FAKE_CODEX(root), { mode: 0o700 });
  chmodSync(codex, 0o700);
  writeFileSync(join(root, "plan.json"), "{}");
  return {
    root,
    workdir,
    codex,
    out,
    plan(steps: Record<string, FakeStep[]>): void {
      writeFileSync(join(root, "plan.json"), JSON.stringify(steps));
    },
    /** A manifest file of these sessions under the rig's workdir, plus any top-level fields. */
    manifest(sessions: SessionRow[], fields: ManifestFields = {}): string {
      const path = join(root, "manifest.json");
      writeFileSync(path, JSON.stringify({ workdir, ...fields, sessions }));
      return path;
    },
    calls(): FakeCall[] {
      return jsonLines<FakeCall>(join(root, "calls.jsonl"));
    },
    ends(): { name: string; attempt: number; at: number }[] {
      return jsonLines(join(root, "ends.jsonl"));
    },
    /** The launcher run to completion with the stand-in, and its decoded streams. */
    run(args: readonly string[], env: Record<string, string | undefined> = Bun.env) {
      const result = runSync([BUN, LAUNCHER, ...args], { env });
      return {
        exitCode: result.exitCode,
        stdout: decodeOutput(result.stdout),
        stderr: decodeOutput(result.stderr),
      };
    },
    /** The launcher started in the background, for a test that acts while it runs. */
    start(args: readonly string[], env: Record<string, string | undefined> = Bun.env) {
      const child = Bun.spawn({ cmd: [BUN, LAUNCHER, ...args], env, stdout: "pipe", stderr: "pipe" });
      return {
        child,
        exited: async () => {
          const [code, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
          return { exitCode: code, stdout, stderr };
        },
      };
    },
    /** A JSON file the launcher wrote into its output directory. */
    read<T>(file: string): T {
      return parseJsonAs<T>(readFileSync(join(out, file), "utf8"));
    },
  };
}

/** Poll until `ready` holds, failing the test after `ms`. */
export async function until(ready: () => boolean, what: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}
