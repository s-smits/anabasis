/**
 * The one owner of where a checkout's controller trees live: `<repoRoot>/campaigns` and
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

/**
 * Where a project's product sits when no retained version has been selected: the historical layout,
 * and the fallback every selection path ends at.
 *
 * This is deliberately not `selectedProductDir`. That reader opens the controller ledger and
 * follows the selection row, which is what a caller resolving "the current product" wants; a caller
 * naming the default tree — a trace root it will accept, the candidate list a battery record may
 * live under — wants this one, and asking the ledger there would answer a different question.
 * Spelled inline as `join(…, "domains", slug)`, the two are indistinguishable.
 */
export function defaultProductDir(repoRoot: string, slug: string): string {
  return join(productRoot(repoRoot), slug);
}

/** The product tree of one checkout, one directory per project. */
export function productRoot(repoRoot: string): string {
  return join(repoRoot, "domains");
}
