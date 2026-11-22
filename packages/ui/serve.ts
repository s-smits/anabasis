import index from "./index.html";
import { handleApiRequest, type ServerOptions } from "./src/server/api.ts";
import { existsSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { terminateAndReapProcessGroupId } from "../../src/meta/subprocess.ts";

/**
 * Serves the front-end page and its API on loopback only. Bun bundles `index.html` on demand and
 * reloads the page on edits; the API reads campaign logs on each request so newly appended events
 * appear on the next poll.
 *
 *   bun serve.ts [--exam-side] [--repo <dir>]        PORT changes the port (5173)
 *
 * Every API request requires the bearer token printed at startup, because on macOS a Builder or
 * solver shell can reach loopback ports. The token is generated once and persisted in `.token`
 * beside this file (ignored by Git and excluded by each seat's sandbox alongside the repository)
 * so that server restarts keep open browser tabs authenticated instead of invalidating them.
 * Passing `--exam-side` enables the exam tier, which exposes task text, hidden values, answers,
 * and Referee rulings; run it only where no Builder or solver is active. Passing `--repo <dir>`
 * reads campaigns from `<dir>/.ana/d2/<name>/log.jsonl` (such as a fixture from
 * `test/fixture-campaign.ts` or another checkout) instead of scanning all worktrees of this
 * repository.
 *
 * The entry process supervises a serving child and restarts it whenever `HEAD` moves. A rebase can
 * rewrite many files in a single burst, leaving Bun's file watcher serving a stale module that
 * imports a removed component until the server process is restarted.
 */
/** Environment variable marking the supervised child process that serves HTTP requests. */
const SERVING = "ANA_UI_SERVING";
const MOVED_MS = 2000;

/** Returns the current `HEAD` commit hash, or an empty string if Git cannot resolve it. */
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
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    runtimeProcess.on(signal, () => {
      terminateAndReapProcessGroupId(child.pid).then(leave, leave);
    });
  }
  let head = await headOf();
  for (;;) {
    await Bun.sleep(MOVED_MS);
    const now = await headOf();
    if (now === "" || now === head) continue;
    head = now;
    console.log(`the tree moved to ${now.slice(0, 9)}: serving it afresh`);
    await terminateAndReapProcessGroupId(child.pid);
    child = start();
  }
}
// Exits the serving child when its parent terminates and closes stdin.
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
