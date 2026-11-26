import index from "./index.html";
import { handleApiRequest, type ServerOptions } from "./src/server/api.ts";
import { existsSync, fstatSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { terminateAndReapProcessGroupId } from "../../src/meta/subprocess.ts";

/**
 * Serves the page and its API on loopback only: `bun serve.ts [--exam-side] [--repo <dir>]`, `PORT`
 * changing the port (5173). Every API request needs the token printed at start, since on macOS a
 * seat's shell can reach loopback ports; it persists in `.token` beside this file, ignored by Git
 * and hidden from every seat, so a restart keeps open tabs signed in. `--exam-side` enables the
 * exam tier (task text, hidden values, answers, rulings): run it only where no Builder or solver is
 * active. `--repo <dir>` reads `<dir>/.ana/d2/<name>/log.jsonl` instead of this repository's
 * worktrees. The entry process restarts its serving child whenever `HEAD` moves, since a rebase can
 * leave Bun's watcher serving a stale module.
 */
/** Environment variable marking the supervised child process that serves HTTP requests. */
const SERVING = "ANA_UI_SERVING";
const MOVED_MS = 2000;

async function headOf(): Promise<string> {
  const git = capturedSpawn(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir, stderr: "ignore" });
  return (await new Response(git.stdout).text()).trim();
}

const leave = () => runtimeProcess.exit(0);
if (Bun.env[SERVING] === undefined) {
  const start = () =>
    capturedSpawn([capturedExecPath, ...Bun.argv.slice(1)], {
      env: { ...Bun.env, [SERVING]: "1" },
      stdio: ["pipe", "inherit", "inherit"],
      detached: true,
    });
  let child = start();
  let ending = false;
  const end = () => {
    if (ending) return;
    ending = true;
    terminateAndReapProcessGroupId(child.pid).then(leave, leave);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) runtimeProcess.on(signal, end);
  // A parent holding a pipe to it (Bun's `stdin: "pipe"` is a socket), as the browser tests do, ends it
  // by exiting however it exits; a terminal, `/dev/null` or a closed fd 0 changes nothing.
  try {
    const input = fstatSync(0);
    if (input.isFIFO() || input.isSocket()) Bun.stdin.text().then(end, end);
  } catch {
    // Closed fd 0 (EBADF): treat like `/dev/null` and stay running until signalled.
  }
  let head = await headOf();
  for (;;) {
    await Bun.sleep(MOVED_MS);
    if (ending) continue;
    const now = await headOf();
    if (now === "" || now === head) continue;
    head = now;
    console.log(`the tree moved to ${now.slice(0, 9)}: serving it afresh`);
    await terminateAndReapProcessGroupId(child.pid);
    if (ending) continue;
    child = start();
  }
}
Bun.stdin.text().then(leave, leave);

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "exam-side": { type: "boolean", default: false },
    repo: { type: "string" },
  },
});
const TOKEN_FILE = join(import.meta.dir, ".token");
const keptToken = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : "";
const token = /^[0-9a-f]{48}$/u.test(keptToken)
  ? keptToken
  : Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
if (token !== keptToken) writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
const options: ServerOptions = {
  repo: values.repo === undefined ? resolve(import.meta.dir, "../..") : resolve(values.repo),
  trees: values.repo === undefined ? "worktrees" : "directory",
  token,
  examSide: values["exam-side"],
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.PORT ?? 5173),
  development: true,
  routes: {
    "/": index,
    "/api/*": (request) => handleApiRequest(options, request),
  },
});

const tier = options.examSide ? "the exam side" : "the default tier";
console.log(`anabasis at ${server.url.origin}/?token=${token}`);
const from = options.trees === "directory" ? `, reading the campaigns under ${options.repo}` : "";
console.log(`answering in ${tier}${from}`);
