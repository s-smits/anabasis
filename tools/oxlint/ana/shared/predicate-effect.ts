/**
 * Whether a predicate can be asked a different number of times without anyone noticing.
 *
 * Two rules need the same answer from opposite sides. `ana/no-side-effect-in-predicate` reports a
 * closure that mutates while it walks; `ana/prefer-some-over-filter-length` may only rewrite
 * `.filter(p).length > 0` into `.some(p)` when it cannot, because `.some` stops at the first
 * match and a closure with an effect then runs fewer times.
 *
 * Six names are the whole of the reported set, and the limit is deliberate. Each one changes a
 * receiver that outlives the walk, which is what makes the number of walks observable, and a
 * call that merely reads is invisible here. Reading the text rather than the tree keeps it to
 * one line per name and costs nothing a reader has to check: the dot is required, so a free
 * `add(x)` says nothing about a collection.
 *
 * An assignment is the other way the count becomes observable — `(row) => { seen += 1; return
 * row.ok; }` counts every element under `.filter` and stops at the first under `.some`. The
 * comment here used to say `no-param-reassign` and the tree's `const` habit covered that, and
 * neither reaches an outer `let`. It is still not reported, because the text cannot tell a
 * write to something that outlives the walk from a `const` declared inside the predicate, and a
 * rule a reader cannot act on is worse than a gap.
 *
 * The rewriting side needs no such balance and asks a stricter question: `writes` refuses a fix
 * wherever an assignment appears, `calls` wherever a call does, and the report stands either way.
 * The two sides therefore disagree on purpose. The report names the six spellings it can explain
 * to a reader; the rewrite refuses everything it cannot prove, which is every call — including
 * the six, since each of them is one.
 */

/** Methods whose receiver is changed by the call, so a predicate holding one has an effect. */
const MUTATIONS = new Set(["add", "set", "delete", "push", "unshift", "clear"]);

/** The first mutating call in this source text, by method name, or null when it holds none. */
export function mutatingCall(text: string): string | null {
  for (const name of MUTATIONS) {
    if (new RegExp(String.raw`\.${name}\s*\(`, "u").test(text)) return name;
  }
  return null;
}

/**
 * Whether the text holds an assignment, an update or a `delete` at all, including a local
 * declaration.
 *
 * Deliberately blunt: `=` that is not a comparison or an arrow, `++` or `--`, and `delete`, which
 * removes a property with neither a call nor an assignment in its spelling — `(row) => delete
 * row.cached` clears every row under `.filter` and the first under `.some`. It decides
 * only whether a rewrite is offered, so a `const` inside a block-bodied predicate costs one
 * unoffered fix and no wrong one. The comparison strip leaves a `<=` or `>=` whose own left
 * neighbour is the same bracket, because that is the tail of `<<=`, `>>=` or `>>>=`, which write.
 */
export function writes(text: string): boolean {
  return /\+\+|--|\bdelete\b|[+\-*/%&|^?]?=(?![=>])/u.test(
    text.replaceAll(/===|!==|=>|(?<![<>])[=!<>]=/gu, ""),
  );
}

/**
 * Whether the text holds a call at all.
 *
 * The one thing in an expression whose effects cannot be read from the expression.
 * `(row) => recordVisit(row)` holds no dotted mutation and no assignment, and still runs once per
 * row under `.filter` and once in total under `.some`; whether anyone notices is `recordVisit`'s
 * business, in another file. A list of mutating spellings cannot prove a call free of effects, so
 * the rewrite refuses every call and the report stands either way.
 *
 * Blunt in the same direction as `writes`: the grouping parentheses in `(a || b) && c` cost one
 * unoffered fix and no wrong one. The caller passes the predicate's **body**, so an arrow's own
 * parameter list — which this tree's formatter always parenthesises — is not in the text.
 */
export function calls(text: string): boolean {
  return text.includes("(");
}
