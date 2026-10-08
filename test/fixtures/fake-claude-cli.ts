// A stand-in for the Claude Code binary, which the Agent SDK runs as `pathToClaudeCodeExecutable`.
// It records what the SDK launched it with, its arguments, its whole environment and every line the
// SDK writes to it, in `$HOME/launch.jsonl`, answers each control request with an empty success, and
// answers each prompt with the recorded stream in `$HOME/replay.jsonl`. HOME is the one place
// it can find both, because the backend hands the CLI no other variable a test could set. It records
// its cwd too.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.HOME ?? "";
if (home === "") throw new Error("the fake Claude Code CLI needs HOME");
const launch = join(home, "launch.jsonl");

function record(entry: string): void {
  appendFileSync(launch, `${entry}\n`);
}

function answer(line: string): void {
  // SAFETY: the Agent SDK writes one JSON message per line to the CLI's stdin.
  const message = JSON.parse(line) as { type: string; request_id?: string };
  record(JSON.stringify({ stdin: message }));
  if (message.type === "control_request") {
    const response = { subtype: "success", request_id: message.request_id, response: {} };
    process.stdout.write(`${JSON.stringify({ type: "control_response", response })}\n`);
  } else if (message.type === "user") {
    process.stdout.write(readFileSync(join(home, "replay.jsonl"), "utf8"));
  }
}

record(JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() }));
let pending = "";
process.stdin.on("data", (chunk: Buffer) => {
  pending += chunk.toString("utf8");
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) if (line.trim() !== "") answer(line);
});
