// A stand-in for the Claude Code binary, run by the Agent SDK as `pathToClaudeCodeExecutable`. It
// records its launch (arguments, environment, cwd and every line the SDK writes) in
// `$HOME/launch.jsonl`, answers control requests with an empty success and prompts with the stream in
// `$HOME/replay.jsonl`; HOME is the one variable a test can set through the backend. Its nth
// `get_usage` is answered by the nth line of `$HOME/usage.jsonl`: `{"error": "<why>"}` refuses it,
// `{"silent": true}` leaves it unanswered. Where `$HOME/outlive` exists it keeps writing under
// `$HOME/Library` until a second after its input closed, as Claude Code outlives its query's close.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Sent {
  type: string;
  request_id?: string;
  request?: { subtype?: string };
}

const home = Bun.env.HOME ?? "";
if (home === "") throw new Error("the fake Claude Code CLI needs HOME");
const launch = join(home, "launch.jsonl");
let usages = 0;
if (existsSync(join(home, "outlive"))) {
  const state = join(home, "Library", "Caches");
  const writing = setInterval(() => {
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "late"), "");
  }, 5);
  process.stdin.on("end", () => setTimeout(() => clearInterval(writing), 1000));
}

/** The scripted answer to this launch's next usage request, an empty success where none is left,
 *  or null where the script leaves it unanswered. */
function usage(): { subtype: "success"; response: unknown } | { subtype: "error"; error: string } | null {
  const script = join(home, "usage.jsonl");
  const line = existsSync(script) ? readFileSync(script, "utf8").split("\n")[usages++] : undefined;
  // SAFETY: a test's own script, one JSON object a line.
  const read = JSON.parse(line === undefined || line.trim() === "" ? "{}" : line) as {
    error?: string;
    silent?: boolean;
  };
  if (read.silent === true) return null;
  return read.error === undefined
    ? { subtype: "success", response: read }
    : { subtype: "error", error: read.error };
}

/** Each line names the launch that wrote it: one a test has ended may still be writing. */
function record(entry: { stdin: Sent } | { argv: string[]; env: NodeJS.ProcessEnv; cwd: string }): void {
  appendFileSync(launch, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
}

function answer(line: string): void {
  // SAFETY: the Agent SDK writes one JSON message per line to the CLI's stdin.
  const message = JSON.parse(line) as Sent;
  record({ stdin: message });
  if (message.type === "control_request") {
    const answered =
      message.request?.subtype === "get_usage" ? usage() : { subtype: "success", response: {} };
    if (answered === null) return;
    const response = { ...answered, request_id: message.request_id };
    process.stdout.write(`${JSON.stringify({ type: "control_response", response })}\n`);
  } else if (message.type === "user") {
    process.stdout.write(readFileSync(join(home, "replay.jsonl"), "utf8"));
  }
}

record({ argv: process.argv.slice(2), env: Bun.env, cwd: process.cwd() });
let pending = "";
process.stdin.on("data", (chunk: Buffer) => {
  pending += chunk.toString("utf8");
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) if (line.trim() !== "") answer(line);
});
