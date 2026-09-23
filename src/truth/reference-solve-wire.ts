/**
 * The two tags on the reference-solve wire, owned once for both of its ends.
 *
 * `reference-solve.ts` spawns `reference-solve-child.ts` and they agree on two strings: the
 * protocol every request and response carries, and the prefix of the single ready line the child
 * writes before it will accept a task. Each end used to declare its own `as const` copy, with
 * nothing but a test holding them together, and a test is the wrong owner for this: bumping the
 * child's `/v3` and leaving the parent alone fails across `solvability-reference-solve.test.ts` and
 * `trusted-runtime.test.ts` with every failure reporting `owner: "bh-correctness-model"`, which
 * routes a controller-side typo to the candidate's correctness model as a
 * `generated-solve-protocol` product defect. With one declaration there is no drift to attribute.
 *
 * Neither end could hold it. The parent's import graph is spawn, bundling and confinement
 * witnessing, which is the whole of what the confined child is meant not to contain; the child
 * binds `Bun.stdin`'s reader at import, which is not something the controller process should
 * evaluate to learn a string. `trusted-runtime.ts` is imported by both but owns captured runtime
 * primitives, and a wire tag is not one.
 */

/** Present on every request and response; a bump makes no earlier child answer a newer parent. */
export const REFERENCE_SOLVE_PROTOCOL = "ana-reference-solve/v3" as const;

/** Prefix of the child's one ready line, followed by the pid the parent witnesses as confined. */
export const REFERENCE_SOLVE_READY = "ana-reference-solve-ready/v3:" as const;
