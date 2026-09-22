/**
 * The manifest: the routing metadata about one run — which project it is, and how large its
 * battery must be.
 *
 * It carries no tool registry: a run measures with the installed tools the brief's external checks
 * name, resolved from the candidate's `.toolchain` or the host PATH, and the claim records their
 * digests.
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
