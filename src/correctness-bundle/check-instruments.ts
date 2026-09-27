/**
 * The programs a bundle's checks decide with, as its own `.toolchain` resolves them: the one list
 * the withheld-instruments launch condition closes in the Built shell and records in the battery's
 * run condition, so what the solver lost and what the evidence says it lost cannot disagree.
 */
import { basename } from "../meta/path.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { withheldInstrumentPaths } from "../verify/tool-inventory.ts";
import { requiredToolsOf } from "./brief.ts";
import { readValidatedBrief } from "./public-resources.ts";

/** Every check's required tool that resolves inside the bundle's tool tree, by the path the
 *  verifier's inventory takes. A host-PATH tool is not among them: an interpreter the solver
 *  shares with the checker is not the checker. Empty without a valid brief or a tool tree. */
export function checkInstrumentPaths(slugDir: string): string[] {
  const checks = readValidatedBrief(slugDir)?.truthChecks ?? [];
  return withheldInstrumentPaths(
    checks.flatMap((check) => requiredToolsOf(check.execution)),
    bundleSnapshotToolTree(slugDir),
  );
}

/** The same programs by tool id, sorted: a path's last segment is the id the check declared. */
export function checkInstrumentIds(slugDir: string): string[] {
  return [...new Set(checkInstrumentPaths(slugDir).map((path) => basename(path)))].sort(compareCodeUnits);
}
