import { readdirSync, statSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";

// This helper lists iteration directories for callers that inspect campaign history.
// Measured outcomes come from case records, while this function only reports which
// directories exist and follows valid directory symlinks.

/** The settled-iteration record every replay reads from an iteration directory. */
export const ITERATION_FILE = "iteration.json";

/** Directory names under one campaign, in filesystem order, without checking iteration names. */
export function listIterationDirs(campaignDir: string): string[] {
  try {
    // Follow symlinks to directories; ignore dangling links.
    return readdirSync(campaignDir, { withFileTypes: true })
      .filter((d) => {
        if (d.isDirectory()) return true;
        if (!d.isSymbolicLink()) return false;
        try {
          return statSync(join(campaignDir, d.name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((d) => d.name);
  } catch {
    return [];
  }
}
