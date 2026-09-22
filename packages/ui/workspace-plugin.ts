import type { BunPlugin } from "bun";
import { resolve } from "../../src/meta/path.ts";
import { readWorkspace } from "./src/server/readers.js";

export const REPO_ROOT = resolve(Bun.env.ANA_UI_REPO_ROOT ?? resolve(import.meta.dirname, "../.."));
const VIRTUAL_ID = "virtual:ana-workspace";

/**
 * The bundled evidence snapshot. `bun run build` produces a static page that carries the evidence
 * it was built from, so it can be archived and opened without a server.
 * The page starts with this snapshot, then requests live `/api/workspace` data. A failed refresh
 * leaves the existing evidence visible with an error. The plugin serves development through `bunfig.toml` and builds through
 * `build.ts`, so both read the virtual module from the same reader.
 */
const workspaceEvidence: BunPlugin = {
  name: "ana-workspace-evidence",
  setup(build) {
    build.onResolve({ filter: /^virtual:ana-workspace$/ }, () => ({ path: VIRTUAL_ID, namespace: "ana" }));
    build.onLoad({ filter: /.*/, namespace: "ana" }, () => ({
      contents: `export default ${JSON.stringify(readWorkspace(REPO_ROOT))};`,
      loader: "js",
    }));
  },
};

export default workspaceEvidence;
