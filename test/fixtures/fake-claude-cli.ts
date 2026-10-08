// A stand-in for the Claude Code binary, which the Agent SDK runs as `pathToClaudeCodeExecutable`.
// It records what the SDK launched it with, its arguments, its whole environment and every line the
// SDK writes to it, in `$HOME/launch.jsonl`, answers each control request with an empty success, and
// answers each prompt with the recorded stream in `$HOME/replay.jsonl`. HOME is the one place
// it can find both, because the backend hands the CLI no other variable a test could set. It records
// its cwd too.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A line the SDK wrote to the CLI. */
interface Sent {
  type: string;
  request_id?: string;
}

const home = process.env.HOME ?? "";
if (home === "") throw new Error("the fake Claude Code CLI needs HOME");
const launch = join(home, "launch.jsonl");

/** Each line names the launch that wrote it: one a test has ended may still be writing. */
function record(entry: { stdin: Sent } | { argv: string[]; env: NodeJS.ProcessEnv; cwd: string }): void {
  appendFileSync(launch, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
}

function answer(line: string): void {
  // SAFETY: the Agent SDK writes one JSON message per line to the CLI's stdin.
  const message = JSON.parse(line) as Sent;
  record({ stdin: message });
  if (message.type === "control_request") {
    const response = { subtype: "success", request_id: message.request_id, response: {} };
    process.stdout.write(`${JSON.stringify({ type: "control_response", response })}\n`);
  } else if (message.type === "user") {
    process.stdout.write(readFileSync(join(home, "replay.jsonl"), "utf8"));
  }
}

record({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() });
let pending = "";
process.stdin.on("data", (chunk: Buffer) => {
  pending += chunk.toString("utf8");
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) if (line.trim() !== "") answer(line);
});
