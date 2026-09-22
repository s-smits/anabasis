import index from "./index.html";
import { handleApiRequest } from "./src/server/api.js";
import { REPO_ROOT } from "./workspace-plugin.ts";

/**
 * The live observatory. Bun bundles `index.html` when serving it and reloads the page on edit;
 * the API reads from disk on every request, so a completed campaign step appears on the next
 * refresh. Loopback only: the API has one write, and it is an operator action.
 */
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.PORT ?? 5173),
  development: true,
  routes: {
    "/": index,
    "/api/*": (request) => handleApiRequest(REPO_ROOT, request),
  },
});

console.log(`observatory at ${server.url}`);
