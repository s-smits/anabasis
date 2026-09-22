/**
 * Emit the two real Builder cell profiles for a throwaway fixture repository.
 *
 * The profiles come from `deriveCandidateIsolation` and `candidateIsolationProfile` in `src/`, not
 * from a copy kept here, so a probe run measures the wall the product actually builds. A copy would
 * drift and then report a wall nobody ships.
 */
import { mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { candidateIsolationProfile } from "#src/builder/candidate-isolation-profile.ts";
import { deriveCandidateIsolation } from "#src/builder/candidate-isolation.ts";

const root = resolve(Bun.argv[2] ?? "");
// The derivation reads the three vendor barrels and their one-hop closure, so the fixture carries
// the same shape a real repository has. Anything absent here refuses rather than widening.
const seed = {
  "vendor/agent-bundle/index.ts": 'export { defineTool } from "../../src/solve/define-tool.ts";\n',
  "vendor/correctness-model-bundle/index.ts": 'export { declareTruthChecks } from "./truth-checks.ts";\n',
  "vendor/correctness-model-prims/index.ts": 'export { relationalJoin } from "./relational-join.ts";\n',
  "src/solve/define-tool.ts": "export const defineTool = 1;\n",
  "vendor/correctness-model-bundle/truth-checks.ts": "export const declareTruthChecks = 1;\n",
  "vendor/correctness-model-prims/relational-join.ts": "export const relationalJoin = 1;\n",
  "package.json": "{}\n",
};
if (root === "") throw new Error("usage: emit-profiles.mts <fixture-repo-root>");

for (const [path, body] of Object.entries(seed)) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

const epochDir = join(root, "campaigns", "probe", "epoch-1");
const binding = {
  repoRoot: root,
  slug: "probe",
  epochDir,
  iterationDir: join(epochDir, "01-probe"),
  ossRoot: join(epochDir, ".oss"),
};
for (const dir of [binding.iterationDir, binding.ossRoot, ".tmp", ".home", ".cache"].map((d) =>
  d.startsWith(".") ? join(binding.ossRoot, d) : d,
)) {
  mkdirSync(dir, { recursive: true });
}

const out = dirname(root);
for (const purpose of ["author", "workshop"] as const) {
  const { profile } = candidateIsolationProfile(deriveCandidateIsolation(binding, purpose), "exec");
  writeFileSync(join(out, `${purpose}.sb`), profile);
}
console.log(binding.ossRoot);
