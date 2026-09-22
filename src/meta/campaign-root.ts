/**
 * The one owner of where a checkout's controller trees live: `<repoRoot>/campaigns` and
 * `<repoRoot>/domains`. Recorded evidence keeps relative `campaigns/<project>/…` pointers, which
 * are evidence identity; readers resolve them against this root.
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
 * Where a project's product sits when no retained version has been selected, and the fallback
 * every selection path ends at. Unlike `selectedProductDir`, it does not consult the controller
 * ledger: use it to name the default tree, not the current product.
 */
export function defaultProductDir(repoRoot: string, slug: string): string {
  return join(productRoot(repoRoot), slug);
}

/** The product tree of one checkout, one directory per project. */
export function productRoot(repoRoot: string): string {
  return join(repoRoot, "domains");
}
