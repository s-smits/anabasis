/**
 * The manifest: the routing metadata about one run — which project it is, and how large its
 * battery must be.
 *
 * It once also carried an engine registry. Until 2026-08-19 that registry was a list of sessions
 * read from `asks/<slug>/ask.json`, which could never hold anything: a directory keyed by slug has
 * to be written before the slug exists, and every run makes its slug from the prompt, so the list
 * was always empty. The flag `--engine-profile` replaced it and was never used — 9,220 recorded
 * evidence rows carry no operator registry — and a second hand-written input contradicts the
 * one-line-prompt product rule anyway. Both are gone, and neither name survives anywhere in the
 * tree. A run measures with the installed tools the brief's external checks name, resolved from
 * the candidate's `.toolchain` or the host PATH, and the claim records their digests.
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
