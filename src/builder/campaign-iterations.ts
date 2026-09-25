import { readdirSync, statSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";

// These helpers list iteration directories for callers that inspect campaign history.
// Measured outcomes come from case records, while this module only reports which
// directories exist and follows valid directory symlinks.

/** The settled-iteration record every replay reads from an iteration directory. */
export const ITERATION_FILE = "iteration.json";

/** An iteration directory's ordinal, the number in front of its `NN-<stage>` name, or null for a
 *  directory that is not an iteration. */
export function iterationOrdinal(name: string): number | null {
  const digits = /^(\d+)-/.exec(name)?.[1];
  return digits === undefined ? null : Number(digits);
}

/** The iteration directory names under one epoch, oldest first by ordinal. A numeric order,
 *  because a lexical one puts `100-` before `99-`. */
export function listIterationDirs(epochDir: string): string[] {
  try {
    // Follow symlinks to directories; ignore dangling links.
    return readdirSync(epochDir, { withFileTypes: true })
      .filter((d) => {
        if (iterationOrdinal(d.name) === null) return false;
        if (d.isDirectory()) return true;
        if (!d.isSymbolicLink()) return false;
        try {
          return statSync(join(epochDir, d.name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((d) => d.name)
      .sort((a, b) => (iterationOrdinal(a) ?? 0) - (iterationOrdinal(b) ?? 0));
  } catch {
    return [];
  }
}
