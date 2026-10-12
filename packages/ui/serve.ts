import index from "./index.html";
import { handleApiRequest, type ServerOptions } from "./src/server/api.ts";
import { resolve } from "../../src/meta/path.ts";
import { parseArgs } from "../../src/meta/process.ts";

/**
 * The page and its API, on the loopback alone. Bun bundles `index.html` when serving it and
 * reloads the page on an edit; the API reads the logs on every request, so a step that lands in a
 * log is on the next poll.
 *
 *   bun serve.ts [--exam-side] [--repo <dir>]        PORT changes the port (5173)
 *
 * Every API request needs the token printed here, which is drawn afresh at each start: on macOS a
 * Builder's or a solver's shell can reach a loopback port. `--exam-side` answers in the exam tier,
 * which shows task text, hidden values, answers and rulings: start it where no Builder or solver
 * runs. `--repo <dir>` reads the campaigns under that one directory, `<dir>/.ana/d2/<name>/log.jsonl`,
 * in place of every worktree of this repository: a fixture's (`test/fixture-campaign.ts`) or another
 * checkout's.
 */
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "exam-side": { type: "boolean", default: false },
    repo: { type: "string" },
  },
});
const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("");
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
