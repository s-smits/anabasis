/**
 * The one owner of where v1's controller trees lie in a checkout: `<repoRoot>/campaigns` and
 * `<repoRoot>/domains`.
 *
 * Spelled `join(repoRoot, "campaigns", …)` at each site, moving the tree means editing every one
 * of them, so every module asks here instead. Recorded evidence keeps its relative
 * `campaigns/<project>/…` pointers as they are: those strings are evidence identity, and a reader
 * resolves them against the root this module returns rather than rewriting what was recorded.
 */
import { join } from "./path.ts";

/** The campaign tree of one checkout. */
export function campaignRoot(repoRoot: string): string {
  return join(repoRoot, "campaigns");
}

/** One project's campaign directory under the root. */
export function campaignDir(repoRoot: string, slug: string): string {
  return join(campaignRoot(repoRoot), slug);
}

/** Where a project's product sits in v1's layout, when no retained version has been selected. */
export function defaultProductDir(repoRoot: string, slug: string): string {
  return join(repoRoot, "domains", slug);
}
