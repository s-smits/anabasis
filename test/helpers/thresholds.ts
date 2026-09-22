import { existsSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { FROZEN_MANIFEST_PATH, loadFrozenManifest } from "../../src/critic/manifest.ts";

/** A valid frozen policy for fixture repo roots. The significance gate fails closed when the
 *  manifest cannot be read, so a fixture that is not itself testing that refusal must state one.
 *  Guarded so a test that writes its own policy first keeps it. */
export function writeFixtureThresholds(root: string): void {
  const path = join(root, "thresholds.frozen.yaml");
  if (!existsSync(path)) writeFileSync(path, "significanceGate:\n  rule: paired-2-sigma\n  z: 1.96\n");
}

/** The digest a battery recorded under this root's frozen policy carries, as the runner writes it. */
export function fixtureThresholdDigest(root: string): string {
  return loadFrozenManifest(join(root, FROZEN_MANIFEST_PATH)).digest;
}
