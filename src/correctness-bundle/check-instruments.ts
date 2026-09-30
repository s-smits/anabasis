/**
 * The programs a bundle's checks decide with that the Built shell withholds, as its own `.toolchain`
 * resolves them: the one list the shell closes and the battery's run condition records, so what the
 * solver lost and what the evidence says it lost cannot disagree.
 */
import { basename } from "../meta/path.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { withheldInstrumentPaths } from "../verify/tool-inventory.ts";
import { requiredToolsOf } from "./brief.ts";
import { readValidatedBrief } from "./public-resources.ts";

/** Which check tools a Built shell withholds: those the brief's `checkOnlyTools` names, or every
 *  check's required tool under the operator's strict withheld-instruments condition. */
type InstrumentScope = "check-only" | "every-check-tool";

/** The tools `scope` selects, each where it resolves inside the bundle's tool tree by the path the
 *  verifier's inventory takes. A host-PATH tool is never among them: an interpreter the solver
 *  shares with the checker is not the checker. Empty without a valid brief or a tool tree. */
export function checkInstrumentPaths(slugDir: string, scope: InstrumentScope): string[] {
  const brief = readValidatedBrief(slugDir);
  const ids =
    scope === "every-check-tool"
      ? (brief?.truthChecks ?? []).flatMap((check) => requiredToolsOf(check.execution))
      : (brief?.checkOnlyTools ?? []);
  return withheldInstrumentPaths(ids, bundleSnapshotToolTree(slugDir));
}

/** The same programs by tool id, sorted: a path's last segment is the id the check declared. */
export function checkInstrumentIds(slugDir: string, scope: InstrumentScope): string[] {
  return [...new Set(checkInstrumentPaths(slugDir, scope).map((path) => basename(path)))].sort(
    compareCodeUnits,
  );
}
