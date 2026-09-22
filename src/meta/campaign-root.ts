/**
 * The one owner of where a checkout's controller trees live: `<repoRoot>/campaigns` and
 * `<repoRoot>/domains`.
 *
 * Every campaign path used to be spelled `join(repoRoot, "campaigns", …)` at about forty sites,
 * so moving the tree meant editing each of them. Recorded evidence keeps its relative
 * `campaigns/<project>/…` pointers: those strings are evidence identity, and a reader resolves
 * them against the root this module returns.
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
 * Where a project's product sits when no retained version has been selected: the historical
 * layout, and the fallback every selection path ends at.
 *
 * This is deliberately not `selectedProductDir`. That reader opens the controller ledger and
 * follows the selection row, which is what a caller resolving "the current product" wants; a
 * caller naming the default tree — a trace root it will accept, the candidate list a battery
 * record may live under — wants this one, and asking the ledger there would answer a different
 * question. Both spellings existed as `join(…, "domains", slug)` at four sites, which is how the
 * distinction stayed invisible.
 */
export function defaultProductDir(repoRoot: string, slug: string): string {
  return join(productRoot(repoRoot), slug);
}

/** The product tree of one checkout, one directory per project. */
export function productRoot(repoRoot: string): string {
  return join(repoRoot, "domains");
}
