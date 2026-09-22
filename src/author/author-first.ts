/**
 * The byte identity of the paths one authoring session owns, which tells an unchanged tree from a
 * repaired one.
 */
import { hashBundle } from "../claim/bundle-hash.ts";
import { existsSync, lstatSync } from "../meta/filesystem.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { join } from "../meta/path.ts";
import { hashJsonValue } from "../meta/stable-json.ts";

interface AuthorFirstRequirement {
  workspace: string;
  paths: readonly string[];
}

export const PRIMARY_AUTHOR_PATHS = ["agent", "correctness-model"] as const;
function pathIdentity(workspace: string, path: string): string {
  const absolute = join(workspace, path);
  if (!existsSync(absolute)) return "missing";
  try {
    const stat = lstatSync(absolute);
    if (stat.isFile()) return `file:${sha256OfFile(absolute)}`;
    if (stat.isDirectory()) return `dir:${hashBundle(absolute).hash}`;
    return `irregular:${stat.mode}:${stat.size}`;
  } catch (cause) {
    return `unreadable:${cause instanceof Error ? cause.name : "unknown"}`;
  }
}

/** Byte identity of only the paths this author must change, including missing-file markers. */
export function authoringIdentity(requirement: AuthorFirstRequirement): string {
  return hashJsonValue(
    requirement.paths.map((path) => ({ path, identity: pathIdentity(requirement.workspace, path) })),
  );
}
