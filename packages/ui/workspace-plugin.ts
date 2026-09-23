import type { BunPlugin } from "bun";
import { resolve } from "../../src/meta/path.ts";
import { readWorkspace } from "./src/server/readers.js";

export const REPO_ROOT = resolve(Bun.env.ANA_UI_REPO_ROOT ?? resolve(import.meta.dirname, "../.."));
const VIRTUAL_ID = "virtual:ana-workspace";

/**
 * The evidence the page ships with. `bun run build` bakes one workspace read into the bundle as a
 * virtual module, so `dist/` can be archived and opened later with no server behind it and still
 * show the run it was built from. Once it is open the page polls `/api/workspace` for live data,
 * and a refresh that fails sets the error alone: `setWorkspace` in `src/live.ts` runs on success
 * only, which is why a dead server leaves the baked evidence on screen instead of an empty panel.
 * Development through `bunfig.toml` and the static build through `build.ts` both load the module
 * from this one plugin, so neither can end up reading the workspace a different way.
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
