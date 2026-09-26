/**
 * The minimal repository a Builder mount can open: the three authoring barrels, the `src/` trees
 * their read closures are derived from, a campaign epoch directory and a package.json.
 *
 * `builder-tool-mount.test.ts` is the only caller left, and what it wants is a tree real enough
 * for the mounted tools to run against. It does not own isolation behaviour — that belongs to
 * `builder-tools.test.ts` and the `candidate-isolation-*` files, which drive the real walls — so
 * nothing here should grow into a second place where a grant is decided.
 */
import { mkdirSync, realpathSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { campaignBuilderMount } from "../../src/run/builder-runtime.ts";

export function mountRepo(scratchRoot: string, label: string) {
  const root = join(scratchRoot, label);
  mkdirSync(root, { recursive: true });
  const repoRoot = realpathSync.native(root);
  const campaignDir = join(repoRoot, "campaigns", "hw", "epoch-1");
  // All three authoring barrels: the isolation derives a read closure per barrel, so a fixture
  // carrying only agent-bundle no longer describes a repository the Builder can be mounted on.
  for (const dir of ["agent-bundle", "correctness-model-bundle", "correctness-model-prims"]) {
    mkdirSync(join(repoRoot, "vendor", dir), { recursive: true });
  }
  for (const dir of ["solve", "correctness-bundle", "verify"]) {
    mkdirSync(join(repoRoot, "src", dir), { recursive: true });
  }
  mkdirSync(campaignDir, { recursive: true });
  writeFileSync(
    join(repoRoot, "vendor", "agent-bundle", "index.ts"),
    'export { defineTool } from "../../src/solve/define-tool.ts";\n',
  );
  writeFileSync(
    join(repoRoot, "vendor", "correctness-model-bundle", "index.ts"),
    'export { declareTruthChecks } from "./truth-checks.ts";\n',
  );
  writeFileSync(
    join(repoRoot, "vendor", "correctness-model-prims", "index.ts"),
    'export { relationalJoin } from "./relational-join.ts";\n',
  );
  writeFileSync(join(repoRoot, "src", "solve", "define-tool.ts"), "export const defineTool = 1;\n");
  writeFileSync(
    join(repoRoot, "vendor", "correctness-model-bundle", "truth-checks.ts"),
    "export const declareTruthChecks = 1;\n",
  );
  writeFileSync(
    join(repoRoot, "vendor", "correctness-model-prims", "relational-join.ts"),
    "export const relationalJoin = 1;\n",
  );
  writeFileSync(join(repoRoot, "package.json"), "{}\n");
  return {
    repoRoot,
    campaignDir,
    tools: campaignBuilderMount(repoRoot, "hw", campaignDir).tools,
  };
}
