/**
 * The manifest: the routing metadata about one run — which project it is, and how large its
 * battery must be.
 *
 * There is deliberately no operator-declared engine registry beside it. A registry keyed by slug
 * would have to be written before the slug exists, and every run makes its slug from the prompt; a
 * flag carrying one is a second hand-written input, which contradicts the one-line-prompt product
 * rule. A run measures with the installed tools the brief's external checks name, resolved from the
 * candidate's `.toolchain` or the host PATH, and the claim records their digests.
 */

export interface AskManifest {
  slug: string;
  domain: string;
  /** The battery size validation enforces (tasks.length === expectedTasks), or its upper bound when
   *  `minTasks` opens a range. */
  expectedTasks: number;
  /** The smallest battery this round accepts, when the Builder may choose the size: the probe round
   *  sets it, and an exact size leaves it absent. */
  minTasks?: number;
}
