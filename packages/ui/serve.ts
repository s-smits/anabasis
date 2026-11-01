import index from "./index.html";
import { handleApiRequest, type ServerOptions } from "./src/server/api.ts";
import { existsSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { terminateAndReapProcessGroupId } from "../../src/meta/subprocess.ts";

/**
 * The page and its API, on the loopback alone. Bun bundles `index.html` when serving it and
 * reloads the page on an edit; the API reads the logs on every request, so a step that lands in a
 * log is on the next poll.
 *
 *   bun serve.ts [--exam-side] [--repo <dir>]        PORT changes the port (5173)
 *
 * Every API request needs the token printed here: on macOS a Builder's or a solver's shell can
 * reach a loopback port. It is drawn once and kept in `.token` beside this file, which Git ignores
 * and every seat's wall closes with the rest of the repository, so that a restart leaves the open
 * tabs working: drawn at each start, every restart refused them all (30 October). `--exam-side` answers in the exam tier,
 * which shows task text, hidden values, answers and rulings: start it where no Builder or solver
 * runs. `--repo <dir>` reads the campaigns under that one directory, `<dir>/.ana/d2/<name>/log.jsonl`,
 * in place of every worktree of this repository: a fixture's (`test/fixture-campaign.ts`) or another
 * checkout's.
 *
 * It serves from a child of this process and starts a new child whenever the tree's commit moves.
 * Bun's watcher follows each file it bundled, and a rebase rewrites many in one burst: on
 * 31 October, after one, the server went on serving a `moves-list.tsx` that imported a component
 * the rebase had removed, through every reload, until the process was started again (operator).
 */
/** Marks the child that serves, in its environment. */
const SERVING = "ANA_UI_SERVING";
const MOVED_MS = 2_000;

/** The commit the tree stands on, or "" where Git cannot say. */
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
// The child ends with its parent, whose end closes the child's input.
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
