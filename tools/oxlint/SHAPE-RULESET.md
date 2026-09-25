# The shape ruleset, still to be added

`BASELINE.md` owns the rules that are on. This file owns the ones that are not yet, and it exists
because the question "should we go further?" deserves a measurement rather than a preference.

Every row below was counted on `claude/pythonic-outcome-0920` at `8e1a8d953`, one rule per config
over the lint script's own scope — `src tools vendor starters test packages` — with
`--type-aware` where the rule needs types. Reproduce a row with:

```sh
bun run lint -c <one-rule-config> --format=unix
```

That is the whole recipe since 2026-09-20. `bun run lint` is `tools/runtime/lint.ts`, which carries
the root list, passes `--type-aware` and points oxlint at the native `tsgolint` binary, and it
forwards any extra argument — so a type-aware row and a plain one reproduce the same way.

Run the rule through `bun run lint`, not through `oxlint` directly. A scratch config holds one rule
and nothing else, and a config without `options.typeAware` reports **zero** for a type-aware rule
with no message at all. A census read that way looks like a clean tree. `BASELINE.md` records the
pass where that happened.

The scope gained `.claude` on 2026-09-20, so a row counted before that date and a row counted after
it are over different trees.

Counts are given twice, because the two numbers ask different questions: **src+tools** is the debt
an overhaul has to clear, and **with test** is what the rule costs the day it is registered.

## Where the ruleset stands, 2026-09-20

A reader arriving at this file should not have to read 1,400 lines to learn what is already on.

**52 rules are registered and gating**, 36 in `ana` and 16 in `anti-slop`, every one an `error` in
`.oxlintrc.json`. `tools/oxlint/simplify.json` holds nothing: the staging file that carried each
catcher as a warning while its sites were read is empty, so there is no rule in this repository
that reports without failing a push.

**14 of the 52 carry a fixer. 38 report only.** That ratio is the ruleset's normal mode rather
than an unfinished state, and `tools/oxlint/FIXER-DECISIONS.md` holds the audit: the four
conditions a fixer has to meet, the nine rules whose edit is mechanically available and refused on
purpose, and why the count stops at fourteen. The fourteen are
`declarations-before-the-first-function`, `no-argument-already-carried`, `no-hand-rolled-error-render`,
`no-hand-spelled-tree-root`, `no-renaming-temporary`, `no-repeated-string-literal` (test files only),
`prefer-condition-over-boolean-returns`, `prefer-const-conditional`, `prefer-find-over-loop`,
`prefer-includes-over-some-equals`, `prefer-key-if-defined`, `prefer-some-over-filter-length`,
`require-captured-json-runtime` and `require-meta-runtime-import`.

**Twelve whole-tree shapes** sit beside them, found by `tools/oxlint/tree-findings.ts` and the
`tree-*.ts` scans it calls, for what no per-file rule can express. On 2026-09-21, over the head of
PR #973, `bun run simplify` prints **61 findings across 6 shapes** — 21 `copied-block`, 13
`compatibility-path`, 9 `superseded-schema-tag`, 7 `identity-without-owner`, 6
`single-reader-export`, 5 `unproduced-set-member` — from 1,992 at the first reading. The same
scans, narrowed to the lines a commit changes, print from `.githooks/pre-commit` without refusing
it. `tree/filesystem-import-budget` prints 18 rows beside that total and is declared a register
rather than a finding, because no reading of a row in it is a repair.

**Three size gates** run in `tools/loc`: 800 nonblank lines per file, 115 per function, cyclomatic
complexity below 22, with `complexity-baseline.json` at zero frozen functions. `bun run gate` runs
eight steps — runtime, `format:check`, typecheck, lint, source-policy, complexity, ui, tests.

What shipped on 2026-09-20, with its site count: `curly` (1,470), `declarations-before-the-first-function`
(965), `strict-boolean-expressions` (137 then 187), `no-unnecessary-condition` swept as a defect
hunt without registering the rule (154 of 270), the formatter over 629 files, the `.claude` scope,
`max-params` at 5 (40), `no-hand-rolled-error-render` (91), `no-inline-schema-literal` (5),
`no-repeated-string-literal` in test files (38), the `no-object-parameters` widen (3),
`no-single-use-const-chain` (0, gating from zero), `no-transposed-argument` (0, in place of the
`max-params` rung at 4) and `prefer-key-if-defined` (26 guards under 19 literals, all fixed;
the sweep also settled four debts of `c8851b0ee`: three functions over the complexity ceiling and
`picker.tsx` no longer typechecking without its cast, none of which that commit's gate had run). Each has its own entry below, and each entry
carries the refusals taken at the same sitting — those are the more useful half.

## How a rule earns its place

The test is not "is this rule good". It is:

> **At every site the rule reports, does a spelling exist that passes every other rule in the tree?**

If yes, the strictness is free. The author is pushed towards one shape out of several legal ones,
and a ledger line records the sites that have not moved yet. If no, the rule is not strict; it is
contradictory, and adopting it means a disable directive at every site, which teaches nobody
anything and turns the ledger into noise.

Two sites have already failed this test and are worth remembering, because they are what the
boundary looks like.

`boundedLedgerNote<Row, TaskSet>` in `src/run` is reported by
`typescript/no-unnecessary-type-parameters`, and no spelling satisfies the tree: `unknown` owes a
proof under `ana/unproven-unknown-parameter`, `object` is refused by
`anti-slop/no-object-parameters`, and `JsonValue` needs a cast because the rows are interfaces
without index signatures. Four rules meet there and leave no move. It is ledgered.

`typescript/consistent-return` was removed rather than baselined, for the reason `BASELINE.md`
records: satisfying it at twelve sites means adding a `default` clause, and a `default` clause is
exactly what stops `typescript/switch-exhaustiveness-check` reporting the next member of the union.

The pattern in both is the same, and it is the practical answer to how far this can go. **Rules
about shape — where a declaration sits, how many parameters a function takes, whether a helper has
one caller, whether a ternary nests — always leave a legal move, because the tree has nothing else
to say about shape.** Rules about types at a validation boundary already have three owners
(`unproven-unknown-parameter`, `no-object-parameters`, `no-unknown-union`) working at their limit,
and a fourth collides. So the ruleset can get considerably stricter about shape and should stop
adding owners to the type boundary.

A second question decides whether a rule ships a fixer: **does the report name a decision the
author has to make, or a spelling a machine can make?** Which two words name a boolean's states is
the change itself, so `no-positional-boolean-parameter` has no fixer. Adding a brace is not a
decision, so `curly` should never be applied by hand.

## Part 1 — built-in rules, measured

| rule | configuration | src+tools | with test | verdict |
| --- | --- | --- | --- | --- |
| `no-lonely-if` | — | 0 | 0 | **register now** |
| `no-else-return` | — | 1 | 1 | **register now** |
| `unicorn/prefer-ternary` | — | 1 | 4 | refused 2026-09-20; its one real site moved to `ana` |
| `typescript/prefer-readonly` | — | 24 | 265 | shipped 2026-09-20; re-measured at 2 |
| `unicorn/no-negated-condition` | — | 28 | 35 | registered; re-measured at 0 |
| `no-negated-condition` | — | 28 | 35 | duplicate of the above; take one |
| `max-statements` | `{ max: 25 }` | 53 | 105 | refused 2026-09-20; the two `tools/loc` gates own it |
| `max-depth` | — | 56 | 3 | **refused**: `ana/no-deep-nesting` owns depth |
| `max-params` | `{ max: 5 }` | 99 | 40 | shipped 2026-09-20 in two rungs; the rung at 4 refused the same day |
| `no-nested-ternary` | — | 109 | 136 | refused 2026-09-20; `ana/no-tangled-ternary` shipped at 47 |
| `typescript/no-unnecessary-condition` | — | 222 | 489 | refused; swept as a defect hunt 2026-09-20, 154 of 270 closed |
| `typescript/strict-boolean-expressions` | — | 234 | 542 | shipped 2026-09-20 at 137, then 187 more with `allowNullableString` off |
| `no-continue` | — | 258 | 272 | refuse: contradicts `max-depth` |
| `func-style` | `"declaration"` | 300 | 869 | defer; fixer feasible |
| `curly` | `"multi-line"` | 419 | 505 | shipped 2026-09-20, 921 + 549 sites, `--fix` |
| `curly` | `"multi-or-nest"` | 583 | 685 | refuse the inverse |
| `typescript/explicit-function-return-type` | `{ allowExpressions: true }` | 386 | 1094 | defer |
| `oxc/no-optional-chaining` | — | 991 | 2179 | refuse: a transpilation rule |
| `sort-imports` | — | 1627 | 2825 | refuse: sorts by member syntax |
| `no-ternary` | — | 2156 | 2639 | refuse: contradicts `prefer-ternary` |
| `no-magic-numbers` | — | 2959 | 9193 | refuse: describes the language |

`unicorn/no-for-loop` and `import/order` are not in this oxlint build. A rule the build does not
carry aborts the whole config parse rather than warning, so each candidate was probed alone.

Four more the census counted and nobody read — `require-array-sort-compare` 24,
`no-base-to-string` 17, `restrict-template-expressions` 8, `no-misused-spread` 1 — are refused as a
set on 2026-09-20. All fifty sites are `.mjs`, which is in no typecheck program, so the four report
inference over a tree nothing annotates and none of the fifty is a defect. Typing that tree costs
2,994 checker errors, fifty-four per cent of them one missing `@param`. `BASELINE.md` has the
shapes and the reopening condition. With those four decided, every typescript rule this census has
ever counted has a verdict.

### The four worth an overhaul

`max-params` is the most valuable of them, and the one that looked boxed in and is not:
`anti-slop/no-object-parameters` bans the broad `object` type on a parameter, not a named input
interface, and a named input interface is already the idiom — `candidate-promotion.ts` takes one and
destructures it. So the legal move exists at every site, and it is the move that makes the call site
say what it is passing.

It has a ladder rather than a single count, which is what made it shippable in pieces: **411** sites
at the default of 3, **145** at 4, **40** at 5, **12** at 6, **4** at 7 and **0** at 8. Both rungs
shipped on 2026-09-20 — twelve functions at seven or eight arguments, then twenty-eight at exactly
six. Choosing a rung is not a style preference here: at six positional arguments a call site no
longer says which value is which, and every one of the forty was already passing a record in
pieces. The third rung, at 4, was measured and refused the same day: its 115 sites are real source,
and the transposition the rule proxies for stands at 963 pairs of which only 129 are in
five-parameter functions. `ana/no-transposed-argument` took that class at the call site instead.
`BASELINE.md` has both measurements.

`max-depth` at 56 and `max-statements` at 53 are the two that say a function has stopped being one
piece of work. They are the rules closest to the operator's own preference for larger functions
with a clear purpose, and they do not contradict it: a function may be eighty lines and three
statements deep. What they refuse is a fourth nesting level, which is where a reader stops holding
the conditions in their head. `src/builder` holds 16 of the 56.

`no-nested-ternary` at 109 is two different problems under one count. In a return position —
`return a ? x : b ? y : z` — the nesting is a table written sideways, and the legal move is an
if/else chain or a lookup. In a JSX attribute, which is where 23 of the 109 sit, there is no
statement position to move to, so `packages/ui` wants its own line in the ledger rather than a
rewrite. Re-measured at 193 and refused on 2026-09-20: it bans the three-way comparator every
language writes the same way. `ana/no-tangled-ternary` asks the two narrower questions instead — is
the tail longer than three cases, and did the ternary grow anywhere but the tail — and ships at 47
with a mechanical remedy at every site. `BASELINE.md` has the record, including why inverting the
outer test is not one of those remedies.

`unicorn/no-negated-condition` at 28 is small, mechanical and matches the house style directly: it
reports `if (!ready) { … } else { … }`, and swapping the arms is always legal.

### `strict-boolean-expressions` shipped at 137, 2026-09-20

The prediction here was 234 sites, 102 of them in `src/backends`, cleared one compartment at a
time. The measurement was **868**, and the shape of those 868 is the whole story: 540 are an `any`
in a condition and 533 of those are in untyped `.mjs` and `.js` skill scripts, where the value is
`any` because the file is. No spelling passes at such a site — only typing the file does — so
`allowAny: true` is not a relaxation but the admission test applied. A further 188 are nullable
strings, evenly spread and worth their own rung.

That left **137**, which shipped with the gate at zero. The `src/backends` concentration the row
above predicted was not there either: the 137 spread over 54 files in every root.

The reason to keep it is the one this section always gave — `null` is meaningful state here, and a
falsy check folds it into the empty string — but the pass paid for itself in a way a style rule
does not. Eighteen of the 137 were conditions the type checker had already proved could not change,
including a `throw` that an earlier `throw` had narrowed out of existence and a browser fallback
the DOM types had retired. `BASELINE.md` names six of them.

**The nullable-string rung shipped the same day, at 187.** One shared predicate in
`src/meta/text.ts` — `hasText` for the condition, `textOr` for the `a || b` fallback — carried 184
of them; three sites in two files frozen at their size spell the comparison out, because an import
line is a line. The rung was registered at 188 and measured 185 here, with two more appearing only
after `packages/ui` was given its own `node_modules`: without it `@types/react` does not resolve,
and the type-aware pass both invents findings in that package and hides real ones. `BASELINE.md`
has the reproduce line.

### `no-unnecessary-condition` refused, and the one rule it was hiding — 2026-09-20

222 sites when this was written, **358** under the lint's current scope, of which 20 report a
constant condition: the sub-class this section expected to be "roughly half real dead code". Each
was read. **One** was a defect. Sixteen are the checker being wrong about this tree in four
repeatable ways — a `let` a closure assigns (nine), a `lib.d.ts` type wider than the runtime (two),
a validator over external input (two, the design prior this section already named), and a
deliberate exhaustiveness arm (one) — and two more are `while (true)`, which the rule's own
`allowConstantLoopConditions` option exists for. The fix it asks for, delete the check, is wrong at
every one of the sixteen, so the rule is refused rather than baselined per file.
`BASELINE.md` names every site.

The one defect needed no types at all. In a `.mjs` file `fallback = null` is the only type
information the binding has, so its type *is* `null`; every caller passing a string is invisible and
every condition over it has one answer. `tsconfig.json` includes `.ts` and `.mts` only, so nothing
else in this repository reads those files. That is **`ana/require-type-for-null-default`**, shipped
the same day at 37 sites.

### The refusals, and why they are not cowardice

`no-continue` at 258 would push 258 loop bodies one nesting level deeper, which `max-depth` then
reports. `continue` is the guard clause of a loop, and this tree's whole shape argument is for
guard clauses. The two rules cannot both be right, and `max-depth` is the one that measures the
reader's cost.

`curly: multi-or-nest` at 583 is the inverse of `curly: multi-line` at 419, and the gap between
them is the measure of how mixed the tree is. `multi-line` is the right one: a single-line
`if (x === null) return;` stays legal, and a body that spills to a second line gets braces. Every
site is fixable and none is a decision, so it is one `--fix` commit and never a hand edit. Shipped
on 2026-09-20 at **921** sites, not 505: the counts in this table predate #877, which put `vendor`,
`starters`, `packages` and `.claude` inside the lint scope, and every rule measured before that day
is a floor for the same reason.

`sort-imports` at 1627 sorts by member syntax — all the `import x`, then all the `import { a }` —
which is not what any reader of this tree wants. Grouping by origin is, and `import/order`, which
does that, is not in this build. Leave it.

`no-magic-numbers` at 2959 and `no-ternary` at 2156 are rules about the language, not about this
repository. A rule whose count is in the thousands has stopped describing anything.

`unicorn/prefer-ternary` at 4 was refused on 2026-09-20, and the refusal bought more than the rule
would have. Three of its four sites are `if (c) await A(); else await B();` inside tests, where the
ternary — `await (c ? A() : B())` — reads worse than the two statements it replaces, and the rule
cannot see the difference. The fourth was real: `let profile: string;` followed by an `if`/`else`
assigning it in both arms, in `src/verify/solve-sandbox.ts`. That shape had no owner. It belongs to
the declaration rather than to the `if`, so it went into `ana/prefer-const-conditional`, which
already owned the one-arm spelling with a default, instead of arriving as a fifth built-in with
three sites nobody would fix. A declaration with a default *and* an `else` is left alone, because
that is a dead initialiser and `no-useless-assignment` already owns it; an `else if` chain is three
arms and not a conditional expression. Tree-wide the widened rule reports the same one site, now
fixed, and the three test sites are not reported at all.

Taking that one finding seriously paid a second time. The widened rule reported nothing tree-wide
while its own fixture reported two, and bisecting with a synthetic copy of the real lines found the
cause in the rule this repository had been running for weeks. The refinement guard asks whether the
assigned expression mentions the binding's own name — a value built from the name it replaces is a
refinement, not a decision — and it asked `context.sourceCode.getText`, which returns source
*including comments*. The Seatbelt array in `solve-sandbox.ts` carries the comment *where that
bypass is measured against this profile without these lines*: the word `profile` in a sentence,
silently suppressing the finding about the binding called `profile`. Comments and quoted strings
are now stripped before the test, while a template literal is left intact, because `${name}` inside
one is a real read. How many one-arm sites that defect hid over those weeks cannot be recovered;
the count the rule reports today is the count after the repair. **A rule that reads source text
rather than the AST is reading prose too, and the way that fails is silence.**

## Part 2 — new `ana` rules to write

These do not exist yet. Each is measured with a throwaway script, so treat the counts as accurate
to within the script's parsing and not to the AST.

### `declarations-before-the-first-function` — shipped, 965 sites in 339 files

The operator's shape: every type, interface and module constant at the front of the file, then the
code. What the tree does instead is alternate — a function, the interface it returns, another
function, the union that interface joins — and a reader looking for the shape of
`GeneratedToolStart` has to read the whole file to learn whether it is there.

This entry was written from a throwaway script at **716 sites in 213 files**. The rule measures
**965 in 339**, and it took three measurements to get there, each one a correction of the last:

| measured by | sites | files |
| --- | --- | --- |
| the throwaway script above | 716 | 213 |
| the first rule, position-tested constants | 873 | 304 |
| the rule as shipped | 965 | 339 |

The script under-counted by a fifth; `no-inline-schema-literal` over-counted by a factor of
fourteen from the same kind of script. **A rule is the only thing that counts its own sites**, and
a script that does not implement the rule's conditions is not measuring that rule.

The gap between 873 and 965 is the read test. The first rule admitted a constant only when its
initialiser read an import or one of four collection constructors; the shipped rule asks the
question directly — *can anything change this name between the front of the file and here* — and
answers yes for an import, a function declaration (hoisted), a built-in namespace and any `const`,
`class` or `enum` the file already declares above the first line of code. `const SIZE = TABLE.one`
becomes movable on the pass after `TABLE` moves, which is one reason the fixer runs to
convergence. The pure builders grew the same way, from four constructors to the ones with no
result but their value: `Object.freeze`, `Object.keys`, `Math.max`, `JSON.parse`, `Number(…)`,
`` String.raw`…` ``. `Math.random` and `Date.now` sit in the same namespaces and are absent.

Two refusals came out of reading the 100 sites that widening added, and cost 9 of them back:

- **A narrowed read.** `const runner = Bun.argv[0]` is `string | undefined`; `if (runner ===
  undefined) throw …` is the first line of code; `const bun: string = runner` below it compiles
  only because of that guard. The move is clean at runtime and a type error, which is a false
  positive whatever the runtime says. A read of a name a test above it narrows is barred like an
  unsafe one — and only a name the file itself declares is narrowable, because `if
  (isBoolean(value))` names an imported predicate it merely calls and `if (x === undefined)` names
  a global, and barring later reads of those refused two constants for no reason.
- **A constant standing against module state.** `src/backends/pi-built-child.ts` keeps six `let`s
  and four collections in one block under its bootstrap call. The rule never moves a `let`, so
  hoisting the collections out of the middle left the block worse than it was found. A `const`
  whose immediate neighbour is a module `let` or `var` stays. A blank line between them says the
  author meant two blocks; a comment does not, and two of those six `let`s are documented in
  place. The first cut of this guard walked the whole unbroken run of declarations and refused a
  run of genuine constants that merely ended near a `let` — adjacency is the honest radius.

Not extended to `enum`: five in the tree, and a mechanism that can change at most five decisions
is not worth the branch.

Admission test: passes. Every site has a legal spelling — the declaration at the front of the
file — and the fixer writes it. `BASELINE.md` carries the three fixer defects the sweep found,
one of which detached comments from their declarations across roughly 350 moves in silence.

### `no-single-caller-helper`, with the dial turned up

The rule is registered and its threshold is two statements and five lines. The tree still holds 64
sites at that setting, the compartment passes having taken it down from 308. Turning
the dial:

| `SHORT_BODY` / `SHORT_SPAN` | reports |
| --- | --- |
| 2 / 5 — today | 64 |
| 3 / 7 | 127 |
| 4 / 9 | 224 |
| 6 / 13 | 373 |

This is the price list for "bigger functions with a clearer purpose". Three statements and seven
lines is the setting to aim at: a helper of three lines read from one place is still a name standing
between a reader and the code, and 127 is an overhaul, not a rewrite. Six and thirteen is where a
real abstraction starts getting caught, so that is the wrong end.

Do not raise it until the current 64 are at zero. A threshold change on a rule with outstanding
debt cannot be told apart from the debt.

**What the raise actually cost, 2026-09-20.** The price list above is a flat dial, and a flat dial
was the wrong instrument. 3 / 7 reported 77 on the swept tree, and nine of fourteen sampled had no
call site that could hold the lines: the call was an argument, a property value, a spread or a
concise arrow's body, where the whole body has to read as one term. Making the pair depend on the
call site — 3 / 7 where the call is a statement, 2 / 5 where it is an expression — reported 26, and
three refusals read off those 26 (`using`, `try`, a body that is only `if (…) return a;`) took it
to 17. Queue step 8 has the reading. The general lesson for the other dials in this file: the
number is rarely wrong on its own, and the context the rule already has in hand usually is.

### `no-inline-schema-literal` — shipped, 5 sites in 5 files, gate at zero

A constant flat table built inside a function body, never written to and identical on every call,
belongs at module scope. All five sites were hoisted, so the rule entered the gate holding nothing.
It ships no fixer and will not get one: four of the five hoists renamed the binding and four wrote
the sentence saying what the table holds, neither of which a fixer can do, so the mechanical move
would take the report away and leave the work undone. `BASELINE.md` has the site-by-site table.
Its two conditions, the withdrawals they had to grow to avoid hoisting one actor's turn state into
module scope, and the test-file exemption are in the rule and its fixtures. One thing is not: this
entry claimed **71** sites before the rule existed, from a throwaway script that counted every
literal declaration inside a function, closures and mutation included. A count from a script that
does not implement the rule's conditions is not that rule's count — which is what Part 1 asks of
the built-in rules, and it holds for the `ana` ones too.

### `no-hand-rolled-error-render` — shipped, 91 sites in 63 files, ledger empty

`errorMessage` in `src/meta/runtime-values.ts` already was `cause instanceof Error ? cause.message
: String(cause)`, and the tree spelled those three terms 88 more times, in 63 files, across every
compartment; ten further sites spelled `cause instanceof Error ? cause : new Error(String(cause))`,
which had no owner and has `asError` now. All 91 converted in the same commit, so the rule shipped
holding the whole tree with no ledger block at all. It is the admission test in its strongest form:
the replacement **is** the ternary, so every site the rule reports it also fixes. `packages/ui` and
`starters/` stay outside it, for the reasons in the rule's own comment.

### `eslint/no-shadow` at `hoist: "all"` — refused, 129 sites in 61 files

The rule ships at its default `hoist: "functions"`, which reports a shadow only of a binding
declared *earlier in source order*. Hoisting the module constants on 2026-09-20 made four
pre-existing shadows visible for that reason alone — the shadows had been there all along, and
nothing about the move created them. At `hoist: "all"` the tree measures 128 sites in 61 files.

**Refused, measured 2026-09-20.** The classes were counted, as this entry asked. A shadow costs a
reader something only when both meanings are live at once, and a throwaway scope-walking rule
decided that per site: of 156 shadows in the tree, **155** have no reference to the outer binding
anywhere before the inner scope opens, and the one that does is a function *type* annotation's
parameter name, which binds nothing. So every site the dial adds is a name whose other meaning
begins after this one has finished — the class `hoist: "functions"` exists to leave alone, and at
that default the rule measures 0. The 41 production sites are one concept rebound in a sibling
branch: `range` three times in `harness-inspect.ts`, `task` four times in `bundle-entry.ts`, `kind`
three times in `resolve-side.ts` for the operator, environment and default paths. The rename the
rule asks for is `range2`. `BASELINE.md` carries the table and the reading.

### `no-name-restating-its-type`

`anti-slop/no-shape-in-symbol-names` covers part of this. The remainder is the `Data`, `Info`,
`Result`, `Manager`, `Handler` suffix on a name that has a better one available. **Refused,
measured 2026-09-20**; the count and the reason are with the third tier in Part 5, where this
belongs, because the repair is a name and so it could never have been anything but advisory. In
short: 184 distinct such names in `src` and `tools`, 156 of them the domain term `nonResult` and
its siblings, and the 28 that remain are mostly right. The objection written here first still
stands beneath the measurement — a rule that reports a name without being able to propose a better
one is an opinion with a line number.

## Part 3 — architecture

### The import graph is cyclic, and a layering rule is not admissible today

`src/` has 13 packages, 87 distinct cross-package edges and 1786 cross-package imports. **Twenty
pairs import each other.** The asymmetry in most of them says which direction is the real one:

| pair | imports | back |
| --- | --- | --- |
| `src/run` ↔ `src/truth` | 69 | 8 |
| `src/truth` ↔ `src/verify` | 46 | 1 |
| `src/claim` ↔ `src/truth` | 45 | 10 |
| `src/backends` ↔ `src/run` | 41 | 3 |
| `src/solve` ↔ `src/truth` | 38 | 13 |
| `src/builder` ↔ `src/run` | 26 | 2 |
| `src/author` ↔ `src/gate` | 18 | 2 |

Summed over all twenty pairs, the minority direction is **99 imports**. That is the whole cost of
making the graph acyclic, and it is a bounded number rather than a redesign. Only `src/critic` and
`src/meta` are leaves today; `src/meta` is the shared bottom and 228 of `src/run`'s imports go to
it, which is correct.

So: a `no-restricted-imports` layering matrix is not admissible now — it would report hundreds of
sites with no legal move. A **cycle ban with a per-pair ledger of the minority direction** is
admissible, because each of those 99 imports has a legal move (the symbol moves down to
`src/meta`, or the dependency inverts through a parameter). Write the cycle check as a rule, ledger
the twenty pairs, and let the lists only shrink, exactly as `BASELINE.md` says.

### File size by export count

66 of 510 files export more than eight symbols; `src/solve/built-starter.ts` exports 30,
`src/verify/wall-policy.ts` 24. `tools/loc/source-policy.ts` already holds files at 600 lines,
which is the measure that matters, and an export count is a worse proxy for the same thing. No rule.

## Part 4 — the order, and the stop condition

1. **One commit, no debt.** `no-lonely-if` and `no-else-return` are registered. Done 2026-09-20.
   `unicorn/prefer-ternary` was refused at the same sitting and its one real site widened
   `ana/prefer-const-conditional` instead; the refusals section above says why.
2. **One commit, mechanical.** `curly: "multi-line"` shipped 2026-09-20 under `--fix`, in two
   commits rather than one: 921 sites, then 549 more in `.claude` once #895 put that directory
   under the formatter. Three passes of the fixer, and two hand edits where a brace landed between
   a comment and the line it excused. The `typescript/prefer-readonly` ledger for `test/**` this
   step used to queue was never needed: the rule went in tree-wide with no ledger and step 3
   below records what it actually measures.
3. **One compartment at a time**, the way `src/run` went. Two of the five came off this list on
   2026-09-20 without a compartment pass, because the tree had moved under the table:
   `unicorn/no-negated-condition` was already registered and measures 0, and
   `typescript/prefer-readonly` measures 2 against the 265 in the table above. `max-depth` shipped
   the same day at `{ max: 4 }` and came back out within the hour: `ana/no-deep-nesting` already
   refuses four levels, with a count that excludes guards and `try` blocks, and the three sites the
   crude count reported are the three where the two owners disagree. `BASELINE.md` has the record.
   `max-params` shipped at 6 and then at 5 on the same day (40 sites). `no-nested-ternary` (193)
   and `max-statements` (1674 at the default 10, 364 at 20, 30 at 40) were both refused later that
   day — the first replaced by `ana/no-tangled-ternary` at 47, the second because its findings are
   four fifths skill scripts and test setup and the two `tools/loc` gates already govern function
   size in the roots that matter. `max-params` at 4 was the last thing left here and was refused the
   same day: 115 rewrites across 71 source files for at most thirteen per cent of the class the
   rule proxies for, with `ana/no-transposed-argument` registered in its place. That closes this
   step. Register each with its ledger the day it is measured, so it holds every new file while the
   old ones are cleaned.

   Read a count in the table above before acting on it, not instead of measuring. Four of the five
   rows in this step were wrong by the time they were read: two rules were already satisfied, and
   the two thresholds that matter — `max-depth` and `max-statements` — were tabled at one setting
   and queued at another.
4. **`strict-boolean-expressions`** shipped 2026-09-20 at 137 sites with `allowAny` and
   `allowNullableString` on, then at 187 more with `allowNullableString` off. Not by compartment in
   the end: the 137 were spread over 54 files and went in one commit, because the class of remedy —
   say which of the three states the branch wants — is the same everywhere, and the 187 went the
   same way behind one predicate. The compartment plan was written from a count that turned out to
   be a quarter of the real one and concentrated in a compartment that did not hold it; measure
   before planning the shape of a pass, not only its size. Step done; `allowAny` stays on.
5. **`declarations-before-the-first-function`** with its fixer — shipped 2026-09-20 at 965 sites
   in 339 files, swept in one commit. `no-inline-schema-literal`, which stood behind it here,
   shipped the same day at five sites and did not need the queue.
6. **`no-unnecessary-condition`** as a defect hunt — swept 2026-09-20, and the rule stays refused.
   **270 sites in 141 files** at `780ee9433`, of which this commit closes **152**. A fixer reading
   the rule's own JSON report, `tools/oxlint/unnecessary-condition-fix.ts`, closes 148 of them
   with no checker; a reading of those 148 keeps 113 and takes back 35, so the deterministic half
   supplies **113 of the 152, 74 per cent**, and three quarters of what it proposes survives
   review. The eight sites the sweep left open were read again the same day: two were the same
   dead arm over a two-member union, in a file and in its test, and closing them makes it **154**;
   the other six are admitted, one of them naming a fifth cause — a property narrowed by a guard
   before an `await` and changed by another task during it, which no annotation reaches.
   `BASELINE.md` carries the census, the three transforms, the three refusals the first pass paid
   for, and the causes that keep the rule off.
7. **The cycle ban** — `import/no-cycle` shipped 2026-09-20, registered at zero. The ledger
   said twenty pairs; measured it was **15 reports**, and thirteen of them were one import.
   `session-evidence.ts` reached `BUILDER_CAPABILITY_MODES` through `tools.ts`, which only
   re-exports it from `capability-modes.ts`; pointing that import at the owner dissolved the
   whole `src/builder` component. The other two were a real two-way call between `admission.ts`
   and `candidate-promotion.ts`, settled by moving `evaluationIdentity` to the module that owns
   both halves of what it composes. Lint is no slower for the rule: 2.27 s against 2.34 s.
8. Only then raise `no-single-caller-helper` to 3 / 7, and only from zero — done 2026-09-20, and
   the dial came back conditional. A flat 3 / 7 reported **77** sites, and reading fourteen of
   them found **nine that could not be spelled at the call site at all**: `epochBindingKeys`
   inside a `...spread`, `starterAuthority` and `presetAuthority` inside a `.map` arrow's object
   literal, `bindsProject` and `isRegularFileDeny` inside a `.some` and a `.flatMap` whose bodies
   are expressions, `probeOutcomeStatus` inside an `.every`. The dial was not wrong about the
   size; it was wrong about where the lines would go. So how short is short now depends on where
   the one call stands: a statement call site — its own expression, a `return`'s value, a
   statement-level declarator — takes 3 statements and 7 lines, and an expression call site keeps
   2 and 5. That reports **26**, every one of them spellable.
   Reading those 26 added three refusals that no size dial can see. A body holding `using`
   disposes at the end of its own block, so the same lines in the caller hold the resource open
   for the rest of it. A body holding `try` cannot be an expression at all: JavaScript has no try
   expression, and `symlinkText` inlined is a `let`, a try and a catch inside a loop that already
   holds two of each. And a body that returns before its last statement is not lines to move: a
   `return` belongs to the function that declares it, so the same line at a call site returns from
   the caller, and the inline is a local plus one assignment per escape. `leafCategory` stays where
   it is. That leaves **17**, all sixteen files swept by hand, and the rule measures 0.

   That third refusal was written twice. The first version looked for the shape in front of it — a
   body of `if (…) return a;` lines and a final `return` — and justified itself by naming the two
   rules that refuse every expression form of one, `ana/no-tangled-ternary` on a nested ternary and
   `ana/no-arms-differing-in-one-term` on one assignment per arm. Both were true. Neither was the
   reason, and the rule census that proposed retiring the second of them is what sent us back:
   a refusal resting on two sibling rules is only as durable as the shorter-lived of them.
   `const t = value.trim(); if (t === "") return null; return t.length;` relocates no better and
   the chain predicate admitted it. The wider predicate is found from each `return` upwards to the
   body that holds it, rather than from the body down, because walking down means enumerating every
   statement type that can hold one and being wrong about whichever was forgotten. It earns one
   exemption the narrow one could not: a call that is the caller's own `return` takes the escapes
   exactly as written, so `return helper(x)` is reported where `const x = helper(y)` is not, and
   the call site is now one of three kinds rather than two. Behaviour-neutral on this tree — both
   predicates report 0 — so the fixtures carry it: one body under three call sites, admitted at
   two and reported at the third, and each half of the refusal fails the suite when removed.
   One of the seventeen paid for itself twice: `rejected` in `src/solve/built-starter.ts` was not
   inlined but split. Its caller already built the same `Submit blocked:` result a second time in
   its accept path, so the shared part became `blocked`, with two callers, and the function is
   shorter than before the report.
9. **Narrow `no-single-caller-helper`'s chain exemption** to chains of three or more operands —
   done 2026-09-20. The exemption covered 15 sites, 8 genuine vocabulary chains and 7 two-term
   fallbacks; the seven are inlined and `BASELINE.md` carries the reading. Step 8 then measured
   the 3 / 7 dial against the narrowed exemption and settled it; 4 / 9 stays open, and it was measured as a
   conditional pair on the swept tree, 2026-09-20. Raising both halves, to 4 / 9 and 3 / 7,
   reports **75**; raising only the statement half reports **35**, so the expression half alone
   brings 40. Those 40 are the wrong 40: three statements cannot be an expression, so every one of
   them asks for lines hoisted above the call, which is the shape the pair was introduced to refuse
   one rung earlier. The statement half is the honest question, and reading four of the 35 by hand
   found a prerequisite rather than an answer: `serialise` in `src/backends/codex-tool-payload.ts`
   is a decision chain with a temporary bound between its second guard and its last return,
   unspellable for exactly the reason step 8's third refusal gives and invisible to it, because
   that refusal asked every statement to be a return or a guard.

   **Settled 2026-09-20: the widening shipped and the rung is declined.** Step 8's refusal is now
   "any return before the body's last statement", found from each return upwards, with one
   exemption for the call that is the caller's own `return`. It is behaviour-neutral at the live
   dial, which is why it could never have been measured there, and re-measuring the rung against it
   is what it was for: the statement half falls from **35 to 20** and both halves from 75 to 43. The
   15 that went were false positives the chain predicate had admitted, which is the whole of the
   difference.

   Reading three of the surviving 20 refused the rung. `sanitizeJudgeInput` in `src/truth/judge.ts`
   is two statements under nineteen lines of comment explaining a protected-detail boundary and a
   SAFETY cast; inlining it moves that argument into the middle of its caller. `familyConflict` in
   `src/run/difficulty-select.ts` is four statements under four lines saying why the interval width
   accounts for sample size. And `loginClaude` in `tools/login/cli.ts` demonstrates the harm rather
   than predicting it. Its caller is a three-arm dispatch, and the first arm has already been
   inlined:

   ```ts
   if (command === "codex") {
     // The merged repo env the runtime resolves, so a CODEX_HOME set in an env file lands where
     // the launched backend will read it.
     console.log(`ChatGPT login stored in ${writeCodexAuthJson(await loginOpenAICodex(prompts), loadRepoEnv(repoRoot).env)}`);
   } else if (command === "claude") await loginClaude();
   else if (command === "status") status();
   ```

   Four lines and a comment beside two one-line arms, in a dispatch whose whole readability is that
   its arms look alike. That is the chain-peers argument at a different site: `loginClaude` and
   `status` are a vocabulary the dispatch is written in, exactly as `validBackend` and its nineteen
   peers are the vocabulary of an `&&` chain. **The missing exemption is a call that is the whole
   body of one arm of a decision with `CHAIN_PEERS` arms or more**, and it belongs with the rung,
   not before it: at 3 / 7 the rule reports nothing at all, so shipping it now would be a predicate
   that changes no decision.

   Two of three sampled sites wrong is the reading that settles it. Four statements over nine lines
   is a function, not a name standing in front of a couple of lines, and a dial pushed past its own
   rule's thesis returns noise however many exemptions are stacked behind it. **Reopen only with the
   dispatch-peer exemption written first, and expect roughly 14 genuine sites for it.**

10. **Typecheck the rules this repository writes** — done 2026-09-20, and the exclusion is
    gone rather than narrowed. `tsconfig.json` had excluded `tools/oxlint/**` since 2026-08-13
    for the vendored anti-slop plugin — "upstream compiles it without `noUncheckedIndexedAccess`"
    — and the wildcard outgrew its reason when `ana/` arrived under it. Deleting the whole entry
    brings 63 files into the program: 39 under `ana/` reporting **31 errors in 13 rule files**,
    and 24 under `anti-slop/` reporting **none at all**, so the exemption the wildcard was written
    for had already expired. `BASELINE.md` carries the five causes, the fixes and the proof that
    none of them moved a rule.

11. **Return the outcome instead of capturing a flag** — done 2026-09-20, in four files, and the
    step was a third the size it said it was. TypeScript narrows a flag a callback assigns to its
    initialiser, so a later test of it is unreadable to any type-aware rule, and an explicit
    annotation does not help; `BASELINE.md` carries the probe. Re-measured at this head the class
    is **15 sites in 12 files**, and reading all of them found **6 in 4 files** where a walker
    really does know the outcome and throws it away. Those are fixed. The other nine are four
    different causes that a rule about walkers does not describe, and `BASELINE.md` names each.

    What generalises is not "return a boolean". `src/builder/file-window.ts` held two of the six,
    and the repair there was to delete the callback: `walkBytes` and `walkText` became
    `fileChunks` and `textPieces`, the first generators in `src/`. A `for...of` carries the stop as
    `break`, the handle is released by the loop calling the generator's `return()`, and the
    decoder's flush is skipped on an early stop because a generator that is never resumed never
    reaches it — all three facts the pair of booleans was reconstructing. The other three files
    kept their callbacks and answer instead of assigning: `add` and `walk` in
    `src/review/review-sources.ts` return whether the inventory cap was still open, `append` in
    `vendor/pi-built/jsonl-reader.ts` takes and returns the dropping state, and the redirect
    rewriter in `src/builder/command-guard.ts` collects each dynamic target so the decision about
    what makes one foreign is stated once, after the walk, rather than inside it.

12. **Give `parseJsonAs<T>` an honest return** — refused 2026-09-20, measured. The step asked for
    its 177 call sites in 92 files to be replaced with a parse at the shape the bytes are known to
    have, on the grounds that steps 11 and 12 together are what `no-unnecessary-condition` is
    waiting on. Re-measured with step 11 landed, the rule reports **124** findings: 33 in `.mjs`
    under oxlint's default program, **4** on a binding a `parseJsonAs` asserted, and 87 on causes
    this step does not describe. It closes four of a hundred and twenty-four, and the 33 have no
    affordable fix, so the payoff cannot be collected either way. The construct it removes is also
    the one the `no-unnecessary-type-parameters` refusal defends, and the tree has already adopted
    the honest form at the sites that guard their parse — `parseJsonAs<{ toolId?: unknown }>` and
    `readClaimStages`, which builds its contract from validated pieces. Of the four, one was a real
    gap and is fixed (`readManifest` in `evidence-log.ts` never checked its digest values); three
    are version tripwires over bytes this program wrote itself. `BASELINE.md` reads all four.

13. **Delete the two-tree `ana` override in `.oxlintrc.json`** — the `tools/oxlint/anti-slop` half
    is done, 2026-09-20; the `vendor/pi-claude-bridge` half is still blocked on an open rewrite.
    One override block turned 22 of the 34 `ana` rules off for `tools/oxlint/anti-slop/**` and
    `vendor/pi-claude-bridge/**` together. Removing the whole block and running lint reported
    **five findings**, which is what those twenty-two lines were worth:

    | tree | reports |
    | --- | --- |
    | `vendor/pi-claude-bridge/provider.ts` | `no-deep-nesting` at 295, `prefer-const-conditional` at 535, `no-alias-restating-return` at 81 |
    | `tools/oxlint/anti-slop` | `no-repeated-string-literal` in `shared/dictionary-types.ts`, `no-tangled-ternary` in `rules/no-module-mocking.ts` |

    Three things are wrong with the block beyond its size. It is an enumerated list, so the twelve
    rules not on it already fire on both trees, and any rule written after it was last touched will
    too: `declarations-before-the-first-function`, the largest shape rule in the set, is one of the
    twelve and passes those trees by luck rather than by decision. The two trees are in it for
    different reasons that neither the block nor its absence of a comment distinguishes, and one of
    those reasons is refuted a few hundred lines away — `BASELINE.md` says `vendor/pi-claude-bridge`
    is "in scope on purpose" for `no-single-caller-helper`, while this block turns twenty-one other
    rules off over it. And the question has two owners: the in-rule predicate `isVendoredVerbatim`
    names `tools/oxlint/anti-slop` alone, so a rule that asks the shared helper and a rule that
    relies on the config get different answers about `vendor/pi-claude-bridge`.

    **The anti-slop premise was not real, and it is retired.** `BASELINE.md` called the tree one
    "this repository pins verbatim at a commit", and `isVendoredVerbatim` in
    `ana/shared/file-role.ts` encoded the same claim in three rules' `before` hooks, citing a
    README the directory does not contain. No commit, URL or submodule records a pin anywhere, and
    twenty-two commits touch the tree, including one that gave all sixteen of its rules the
    `fixable` metadata this repository's contract test reads. Both the predicate and the
    `tools/oxlint/anti-slop` half of the block are gone; the section in `BASELINE.md` records what
    the removal cost and what it found.

    **The `vendor/pi-claude-bridge` half stays blocked, not deferred.** All three findings there
    are in `provider.ts`, which `claude/bridge-rewrite-0919` is rewriting. Take it after that
    lands: drop the block, fix the three.

14. **Bring `tools/oxlint` under the formatter** — done 2026-09-20, 50 files reformatted and
    **25 lint errors behind them**. `biome.json` ended its `files.includes` with
    `"!**/tools/oxlint"`, so the whole rule directory — both plugins, every rule, every shared
    module, the fixers and the census — was outside `bun run format` and outside the
    `format:check` step of the gate. Nothing stated why. It was the same shape as item 13 one
    layer out: an exclusion by path with no reason attached, next to a `formatter: { enabled:
    false }` override that names eleven genuinely pinned `vendor/` files one at a time, which is
    what a real pin looks like in this file.

    The visible cost was that `ana` was written with two spaces and `anti-slop` with tabs, in one
    tree under one gate. The cost that mattered is what the reformat then uncovered, because
    three rules that were already registered had never been asked about this directory in the
    shape the formatter puts it in:

    - **`eslint(curly)`, 20 sites.** The setting is `"multi-line"`, and the formatter is the thing
      that makes a statement multi-line. `bun run lint -- --fix` then another `format`; two rounds.
    - **`anti-slop(no-runtime-typeof)`, 3 sites.** `oxlint-disable-next-line` is bound to a line
      and the formatter decides where lines are: rewrapping an expression pushed the `typeof` one
      line below the directive that excused it. Oxlint reports the displacement from both ends, as
      an error at the new line and an unused-directive warning at the old one. The directive now
      sits inside the wrapped expression, immediately above the operator, where a reformat cannot
      separate them.
    - **`ana(no-single-caller-helper)`, 2 sites.** Two helpers folded to within the rule's
      statement count and started reporting. Both inlined.

    Proving the reformat was only a reformat needed more than `git diff -w`, which cannot see past
    a rewrap. Each changed `.ts` file was minified at HEAD and in the tree and the outputs
    compared: 49 of 49 identical. `BASELINE.md` has the method, including the trap that makes a
    default export's binding differ by file name.

The stop condition is the admission test, and it is worth stating plainly so this does not become
an appetite. **Stop adding rules when the next candidate has a site where no legal spelling
exists.** At that point the ruleset is not too strict, it is inconsistent, and the repair is to
remove one of the colliding owners rather than to add a disable directive. That has already
happened twice, both times at the type boundary, and both times the right answer was to remove a
rule.

Everything in Parts 1 to 4 is shape, and shape has room.

## Part 5 — the backlog, kept separate from the queue above

Parts 1 to 4 are rules that have been measured against this tree: every one of them has a site
count and an admission-test verdict. This part is the opposite — work that has been decided on but
not measured, kept here so the queue above stays a list of things ready to do. The first item has
since shipped: its catchers were written report-only, measured against the tree through the census
below, and moved into the gate one group at a time. Two more shipped with it, the formatter and the
`.claude` scope. The last two were deferred until the ledger pass finished; it has, so both were
read again on 2026-09-20 and both were refused, each for a reason that is in its own entry and not
in a preference. Nothing here is now waiting on the pass.

### Catch the simplify skill's judgement statically, one catcher per kind of finding

The operator's framing: the simplify skill is invoked by hand twenty to fifty times a week, and
most of what it finds is not a taste call. It is the same short list of shapes, found again by
reading. Where a shape is complex enough to be worth catching but not mechanical enough for a
fixer, a rule that only reports is still most of the value: it moves the finding from a reading
pass someone has to remember to run, to a line in a lint output.

The unit of work is one catcher per kind of finding the skill makes, derived from the skill's own
sections rather than invented:

- the repository budgets in `.claude/skills/simplify/SKILL.md` — a file's `src/meta/filesystem.ts`
  import count, the five-production-line repair ceiling, the one-new-function ceiling;
- the four "not a finding here" shapes, which are the exemptions any such catcher needs before it
  is admissible: a `boolean | null` tri-state, a re-read that measures a different moment, two
  readers of one file with different contracts, a one-caller helper whose caller would otherwise
  carry a branch the name explains;
- the lifetime rule — process lifetime settled at `spawnCollected` and `stageCommandIsolation`
  rather than at each tool — which is a restricted-import shape;
- the "frozen file is a budget, not a reason for a module" rule, which is a sibling-file heuristic
  against `tools/loc/source-policy.json`.

The first bullet is the one this list cannot deliver as a gating rule, and the reason is worth
writing down rather than leaving on a queue. All three budgets in it are shaped as a difference
between two trees: a file *adds at most one* name from `src/meta/filesystem.ts`, a repair *adds at
most five* production lines, a repair *adds at most one* function. A lint rule reads one tree and
has no "before" to subtract from, so the only thing it can enforce is an absolute ceiling, and an
absolute ceiling answers a different question. 461 files import from `src/meta/filesystem.ts`,
across 457 import statements and 1,779 names, spread continuously from one name (59 files) to
sixteen (1) with the mass at two to four. Any line drawn through that reports the files that
legitimately need the most names, and not one of them is the file the budget is about, which is
whichever file the change in front of you is touching.

Two owners already split it correctly, and this entry exists to say so rather than to propose a
third. The delta belongs to `scripts/measure.py` in the simplify skill, which reads it against the
pre-change ref — the only place the subtraction exists. The standing counts belong to
`filesystem-import-budget` in `tools/oxlint/tree-findings.ts`, which lists every file over six
names and is declared a `TREE_REGISTER_KIND`: a standing register rather than a list to empty,
excluded from the census total for the same reason given here, that no reading of a row in it is
a repair. What is *not* admissible is a gating rule, and neither of the other two budgets has an
owner at all — a repair's production-line and new-function counts are read by `measure.py` and
nowhere else. The twenty-eight catchers came from the other three bullets.

Twenty-eight catchers from this list have now shipped, beside six whole-tree scans that no
per-file rule can express and `unusedExports` in `tools/loc/source-policy.ts`, which was the first
of them. All twenty-eight are registered in `tools/oxlint/ana/index.ts` and all twenty-eight now
gate: each shipped into `tools/oxlint/simplify.json` as a warning, was read over the whole tree,
had its sites either fixed or admitted by an exemption the rule records, and then moved into
`.oxlintrc.json` as an error. `bun run lint` and `bun run gate` enforce the whole set, and
`tools/oxlint/simplify.json` now holds no rules at all. The arc is in "The simplify census" below;
what the census still reports is the six scans.

Two constraints on this, both already established. A rule must pass the admission test in
"How a rule earns its place" before it ships, and a heuristic that cannot pass it is a report-only
rule at most, never a blocking one. And for the Python side of the tree, a fixer is much harder
than a detector; assume detection only there unless a specific fixer is proved out.

### The third tier: shapes worth reporting that nothing can fix — closed 2026-09-20

The operator's framing: the simplify skill turns twenty lines into four, that cannot be done
deterministically, so is there a layer that at least *identifies* the shape and hands the repair to
whoever is reading — a lint error the model fixes by hand, which is fine.

**The answer is that this layer is already the ruleset, not an addition to it.** 37 of the 50
registered rules carry no fixer, and `FIXER-DECISIONS.md` holds the argument they share. `no-positional-boolean-parameter` ships with "there is no fixer;
which two words name the states is the change"; `no-object-parameters` ships with "the repair is an
owner-provided type parsed at its boundary". Both gate. Neither has ever been able to fix anything,
and both have paid for themselves. So the question is not whether to add a report-only tier — it is
that three things about the existing one have never been written down, and that the shapes the
operator is describing were skipped for a reason that does not survive being stated.

**1. The reason those shapes were skipped is wrong.** Detection and repair were treated as one
decision: a shape whose repair needs a name, a consolidation target or an owner was not attempted
at all. But precision of detection and mechanisability of repair are independent, and the second
one has never been a condition of admission — only "How a rule earns its place" is. Every shape
below is measurable without being fixable, and none has been counted against this tree yet. The
first move is a count, report-only, in `tools/oxlint/simplify.json`, exactly as the twenty-eight
catchers went.

- **`no-single-use-const-chain`** — **shipped, gating at zero sites.** The twenty-to-four shape
  stated precisely: a run of `const`s threading one value, each read exactly once, landing in the
  statement below. The repair is the composition; the *names* are the whole judgement, which is why
  no fixer can run. Both dials the queue named were settled by measurement rather than taste. N: at
  three links the tree has no site, at two it has 80, and reading the 80 says why — 60 are a test
  arranging a fixture and reading a result, and twelve of the twenty elsewhere were read one by one
  and are all a name doing work. So two threaded steps are ordinary and three are the shape. The
  explaining-comment exemption went in as predicted, in the one form a rule can decide: the author
  wrote the sentence or they did not. A type annotation ends a run too, but the explicit check for
  it was deleted — no mutation of it changed the fixture and the tree reports the same without it,
  because the read count already skips a name before a colon. Its guards were mutation-tested one
  at a time; five of six break the fixture, and the sixth was the deleted one.
- **`prefer-key-if-defined`** — **shipped with its fixer, 26 guards under 19 literals fixed, gating
  at zero.** The one shape taken straight from the simplify record rather than from taste: two
  passes, `743608504` and `421533e8f`, each folded `if (options.cwd !== undefined) spawnOptions.cwd =
  options.cwd;` back into the literal above it as `...keyIfDefined("cwd", options.cwd)`, and the
  operator's own `src/meta/optional-key.ts` had 290 call sites spelling that fold already. The rule
  reads a run of such guards directly below a `const` object literal: each tests one pure read (a
  name, a member chain, `this.x`, a cast over one) against `undefined` or `null` and assigns that
  read to one static key of the literal's own name. The evidence for the strictness is the 35
  textual matches the tree held: 26 folded, and each of the other nine is a target that came from a
  call, a parameter, `this`, or an object another statement reads between the literal and the
  guard, where the fold would change what runs. One `const` between the literal and a guard is
  inlined when that guard is its only reader (`paste-input.ts` twice), because the literal's own
  properties have already been evaluated when the appended spread runs. A comment inside the guard
  block ends the run, since it has nowhere to go: `evaluator-process.ts:113` folds one of its four
  keys and keeps three below a `SAFETY:` block. The measured cost of the sweep was one helper,
  `completedMessage` in `verifier-workshop.ts`, whose comment said it existed because its caller
  measured 21; two folded guards gave the caller room, `no-single-caller-helper` reported it and it
  was inlined.
- **`no-parallel-bodies`** — two functions in one file whose statement sequences hash equal after
  erasing every identifier and literal. Its text-level half shipped on 2026-09-20 instead:
  `tree/duplicate-run` now counts two runs inside one file, which it had skipped because it read
  the corpus as a set of file pairs. That found three same-file repeats, two of them real and now
  consolidated, and it still cannot see a copy a rename hid — identifiers are not normalised, and
  normalising them is what needs the AST this bullet asks for. Catches the copy that a rename hid from
  `ana/no-repeated-string-literal` and from every text-level scan. The repair is consolidation, and
  what the common function should be called and which term becomes its parameter is judgement.
  `ana/no-arms-differing-in-one-term` is the same shape inside one function, and it gates at zero
  after the dispatch exemption; this is the between-functions version, which is where the mass
  actually is.
- **`no-forwarded-parameter`** — a parameter whose every read is passing it on unchanged, so either
  the caller should pass what the callee needs or this function is a pipe with a name. **Refused,
  measured 2026-09-20 at 2260 sites.** The detector was written and run over the whole corpus with
  proper scope analysis — a parameter is reported when every read reference of it is a bare
  argument to one call. 1159 sites in `src`, 754 in `test`, 267 in `tools`. The top callee is
  `join` at 316 sites, then `JSON.stringify`, `String`, `writeFileSync` and `capturedJsonStringify`,
  which is the refutation in one line: `function claimPath(dir: string) { … join(dir, "claim.json") … }`
  reads `dir` only as an argument, and that is what using a path *is*. The premise is wrong.
  Passing a value to a function is a use of it, so "every read is a forward" describes almost every
  parameter in the tree rather than the threaded dependency the bullet was aimed at, and no cheap
  predicate separates `join(dir, …)` from a config object relayed three levels down. One narrowing
  might carry signal and is **not** queued: a parameter forwarded to a same-file function whose
  parameter at that position is itself forwarded, which is a pipe chain two deep and visible
  without types. It is a different rule from this one and unmeasured.
- **`no-name-restating-its-type`** — already in Part 2, unmeasured there. **Refused, measured
  2026-09-20 at 28 names.** `anti-slop/no-shape-in-symbol-names` covers the part of this worth
  gating; the remainder is the `Data`, `Info`, `Result`, `Manager`, `Handler` suffix. Across `src`
  and `tools` there are 184 distinct such names, and 156 of them are one domain term: `nonResult`,
  `runtimeNonResult`, `hostNonResult`, `preparationNonResult` and their siblings spell the case
  kind this whole system is built on, where `Result` is the word the contract uses and a rename
  would be a defect. What is left is 28 names, most of them also right — `toolResult`, `turnResult`
  and `caseResult` name records this tree really does keep, and `setRequestHandler` is an API it
  does not own. A rule whose whole corpus is 28 sites and whose precision on them is well under
  half is a rename pass someone can do by eye, and the Part 2 objection still stands beneath the
  measurement: it reports a name without being able to propose a better one.

All four shapes this tier named are now decided: two shipped and two are refused with their
measurement. What the pair of refusals has in common is worth keeping, because it is the
shape of the next one. Both were stated as an intuition about *meaning* — a parameter this
function has no business with, a name that says only what its type says — and both turned
out to have no syntactic proxy that is not satisfied by ordinary correct code. That is a
different failure from a shape that is hard to fix, which this tier exists to admit. A
shape enters it by being **countable** first; being unfixable is the second question, not
the first.

Ownership placement — "this function has a better owner somewhere else" — is the one the operator
named that already has an owner: `tree/single-reader-export` in `tools/oxlint/tree-findings.ts`
reports an export whose only reader outside its own file is one other file, which is the static
half of that question. What it cannot see is whether the *right* file is the reader's, and nothing
will; the census prints the row and a reader decides. Three such rows stand today.

**2. An advisory rule's message is its entire product, and the practice is already right — it is
only unwritten.** A fixable rule can afford a mediocre message, because `--fix` and a diff show the
reader what it meant; an advisory rule has only the sentence. The contract that follows is that the
message names the **decision** the reader has to make, not the defect the rule found. Every
advisory message was read on 2026-09-20 against it and every one meets it:
`no-positional-boolean-parameter` ends "take a
union of two string literals that say what the two states are", `no-tangled-ternary` "four cases is
usually a `Map` keyed on what the tests compare", `no-pass-through-wrapper` "call `{{callee}}` at
the sites, or give this one a job — a default, a narrowing, a fixed argument". So this is not a
repair queue; it is a property worth holding, because the next rule written in a hurry is where it
goes. `test/oxlint-rule-contract.test.ts` already asserts that every rule declares a fixer or refuses
one, and it looked like the place to assert that a refusing rule's message carries a remedy clause
as well as a diagnosis. **That test is refused, measured 2026-09-20.** The 37 advisory rules carry
39 messages and all 39 name the remedy, but ten of them name it as a noun phrase rather than an
imperative: `no-tangled-ternary` says "four cases is usually a `Map` keyed on what the tests
compare", `no-side-effect-in-predicate` says "deduplication is `new Map(xs.map(…))`",
`prefer-entries-over-keys-lookup` says "`Object.entries(…)` hands the value over with the key".
A thirty-verb marker list — the most generous mechanical proxy — misses all ten, which is a 26%
false-positive rate against messages that meet the property; loosening it far enough to admit them
admits any second sentence at all. Whether a sentence names a decision is the semantic judgement
this whole part says a rule cannot make, so the property stays a practice that the measurement
above records, held by whoever reviews the next rule. `FIXER-DECISIONS.md` is where that reviewer
reads what the bar is.

**3. An advisory rule needs a stricter false-positive bar than a fixable one, not a looser one.**
The instinct runs the other way: no fixer, so a wrong report costs nothing. It costs a read, and
unlike a fixable rule's report it cannot be checked by running the fixer and reading the diff.
Where a fixable rule can ship at 90% precision and let the diff sort it out, an advisory one should
not ship below the standard in "How a rule earns its place", and a shape that cannot reach it stays
in the census — which is the reason the six tree scans exist and do not gate.

**What is explicitly not in this tier: inventing names.** `BASELINE.md` records the refusal, and
the one exception on the record — the `no-repeated-string-literal` fixer in test files — was
admitted only because the value carries its own name and the file is the constant's home. A
detector may say "this name restates its type"; nothing may choose the replacement.

### The tree is formatted, and the gate keeps it that way — done 2026-09-20

`bun run format` had never been run to completion, so the tree had been written by hand past the
`lineWidth: 110` in `biome.json` since the beginning. Running it rewrote **629 files**. The commit
is whitespace only; everything below is what came with it.

**The size ceilings moved, because the formatter owns line breaks now.** Wrapping a 118-column
line into three adds lines to the function holding it, and `tools/loc/source-policy.ts` counts
nonblank lines. Measured across `src`, `tools` and `vendor`: 77,570 nonblank lines became 84,984,
9.6% more. The ratio is not uniform — per file p50 1.070 and p90 1.330, per function p50 1.045 and
p90 1.425 — so the ceilings took the p90 of the thing each one counts: **600 → 800 per file** and
**80 → 115 per function**. `thresholds.frozen.yaml` carries both, and
`test/frozen-manifest-binding.test.ts` holds them equal to the constants.

Raising `lineWidth` instead was measured and rejected. The findings fall (110 → 43, 120 → 34,
140 → 18, 160 → 13) but the file count rises, because a wider width also joins lines the author
split deliberately; and 96.5% of authored lines were already inside 110, so the width was never
what the tree disagreed with. Complexity is formatter-invariant: `tools/loc/complexity-policy.ts`
exited 0 at every width.

**`bun run gate` runs eight steps now**, with `format:check` second, after `runtime`. It is the
cheapest step and the only one whose failure has a one-command fix. Without it the tree drifts
straight back and the next agent to type `bun run format` mid-pass buries their own diff in 629
files. `biome.json` reads the repository's own ignore file (`vcs.useIgnoreFile`) rather than a
hand-copied list, which is how a run worktree's untracked `campaigns/` stayed out of the gate's
business — the hand-copied list had omitted it.

#### What a reformat breaks, for the next one

Two classes, both worth knowing before a formatter setting is ever changed again.

**A suppression is positional.** `// @ts-expect-error`, `// oxlint-disable-next-line` and a
`/* SAFETY */` justification all bind to what comes next, and the formatter moves what comes next.
Four of them landed away from their construct here; one was a rule defect and was fixed in source
(`require-safety-comment-for-type-assertion` now reads the justification across the parenthesis
beside it), the rest moved with their statement. `// biome-ignore format: <reason>` pins a
construct when the adjacency is genuinely load-bearing — but prefer fixing the reader, below.

**A line scanner is not a syntax reader.** `deriveBundleContract` classified each barrel edge from
the line its `from` sat on. Biome wrapped a long `export type { … } from "…"` across seven lines,
`from` landed on a line carrying no `type`, and an erased edge read as a runtime import into a
protected module: four tests, a hard refusal of a correct contract. It now calls `specifiersIn`,
the syntax-tree reader `src/claim/bundle-validation.ts` already owned for exactly this question.

This did not become a rule, and the measurement says why: of 78 `split("\n")` sites in `src` and
`tools`, that was the only one reading TypeScript syntax from a line. The two that remain —
`tools/oxlint/tree-findings.ts` and `tools/loc/source-policy.ts`, both matching `^export …` —
came through untouched, because biome keeps a declaration's `export` keyword and its name
together and only moves the specifier list of a re-export, which is the one thing neither reads.
One site is a fix, not a rule.

### Run the lint on every commit, not only on every push — refused 2026-09-20

Today `bun run lint` is one of the eight steps `bun run gate` runs, and the gate runs from the
pre-push hook. A commit can therefore carry lint failures for as long as the branch is unpushed,
which is exactly the window in which a compartment pass makes fifty edits. A pre-commit hook
running lint over the staged paths alone would close that window. The ledger pass is finished, so
the entry came due, and the answer is no.

`.githooks/pre-commit` opens by naming its own scope: "Two refusals, both about facts a commit
records permanently: an author who cannot be attributed, and a credential-shaped literal. This is
the last moment either is still cheap to fix." A lint finding is not that. It is repaired by the
next commit at no cost, and the push gate already refuses to publish it, so a third refusal buys
the window between two states that are both private.

What it would cost is specific rather than general. A blocked commit strands work in progress, and
the escape the hook's own text offers — `--no-verify` — is refused outright by the operator's
command guard in the sessions that do most of the committing here, along with
`-c core.hooksPath=/dev/null`. A false positive at commit time would leave an agent unable to
checkpoint at all. The gate's own reading is the counterweight: the census is at zero and every
per-file rule is in the gate, so what this hook would catch is a violation introduced and then
pushed within the same hour, which the push already stops.

### The lint scope now covers `.claude` — done 2026-09-20

`bun run lint` named `src tools vendor starters test packages`, and skill helper scripts under
`.claude/` are source by the working contract — a `.ts`, `.mjs` or `.py` there needs focused checks
and source delivery. No rule had ever been measured against them. The first measurement was **416
findings**; the compartment is at zero and `.claude` is in the scope of `bun run lint`,
`tools/oxlint/simplify-census.ts` and the declaring roots of `tools/oxlint/tree-findings.ts`.
`BASELINE.md` carries the one rule that joined with it and the two defects the pass found.

The scope was not small, and three quarters of it was two shapes: a hand-rolled
`x instanceof Error ? …` where `src/meta/runtime-values.ts` already owns the reader, and a JSON
shape checked with `typeof` where `src/meta/json-shape.ts` owns the predicate. Neither was a
judgement call. What is worth carrying forward is that a compartment outside the gate drifts
towards its own copies of things the tree already owns, and the drift is invisible until the day
the scope widens.

### The authored-code file ceiling stops reading prose — done 2026-09-20

The 800-line ceiling in `tools/loc/source-policy.ts` fired on `BASELINE.md` at 823 nonblank lines,
which is how this section came to exist. The check reads every file under `src`, `tools` and
`vendor`, so Markdown was inside it by accident of the walk rather than by decision. Measured that
day, it bound exactly two files, both the oxlint ledgers — `BASELINE.md` 823 and this file 782 —
and nothing else outside `.ts` under those roots reaches 400 nonblank lines.

The number is the 90th percentile of what `biome format` at lineWidth 110 does to authored code.
Applied to a ledger it asked for one thing: split the record of which rules shipped and which were
refused, at 800 lines, for a reason belonging to neither half. Two files to search and nothing
retired is a gate changing a decision incorrectly, so the check now skips `.md` unless a
`copiedFileLimits` entry names the file, which is a decision rather than the walk.

What bounds these two documents is retiring an entry whose rule is decided and whose mechanism has
left the source — a judgement no line count makes. Revisit if a third Markdown file appears under
those roots, or if either ledger passes about 1,500 lines with its old entries still live.

### Seed a regressions test from the false-positive classes — refused 2026-09-20

Eight false-positive classes were found and patched in the `ana` rules during this pass, each with
a fixture in its rule's own test file. react-doctor keeps these separately, in a
`.regressions.test.ts` beside the rule, so that a rule's own test file stays a statement of what
the rule is for and the regression file stays a list of what it must never do again. The ledger
pass is finished, so the entry came due, and the answer is no.

The fixture format here already does both halves in one assertion. A fixture labels every
declaration `// REPORT <why>` or `// ADMITTED <why>`; `expectedLines` reads the REPORT lines and
the test compares them to everything the rule reported with `toStrictEqual`. An ADMITTED line is
therefore pinned by that same comparison — a rule that starts reporting it fails — and it is
pinned beside the REPORT line it borders, which is where the boundary is legible. Splitting the
two verdicts into two files would copy each fixture's `declare` preamble into both and leave
neither file able to assert "exactly these lines" on its own.

Measured before deciding: all 29 `ana` rules are exercised in test files that carry ADMITTED
fixtures, so there is no rule whose boundary is unpinned and nothing for a separate file to
collect. react-doctor's split pays because its cases are one file each; ours are one fixture per
shape carrying both verdicts, and the exactness is the pin.

### The simplify census

`bun run simplify` prints every report-only finding grouped by shape, largest first, with each
shape's argument once and its sites under it. `--all` lists every site; `bun run simplify -- <name>`
reads one shape.

Nothing the census reports blocks a push, and `tools/oxlint/simplify.json` is loaded by nothing
else, so a catcher moved into `.oxlintrc.json` is moved on purpose.
`test/simplify-census.test.ts` holds the two files apart: every rule
`tools/oxlint/ana/index.ts` registers is named in exactly one of them, never both and never
neither, because a rule in neither reports nothing and nobody notices.

Measured over `src`, `tools`, `vendor`, `starters`, `test` and `packages`, the census opened on
2026-09-20 at **1992 findings across 37 shapes**, reached **92 across 4** the same day, and now
stands at **13 across 4** with one register printed beside them: 7
`tree/identity-without-owner`, 3 `tree/single-reader-export`, 2 `tree/duplicate-run` and 1
`tree/test-only-export`, every one with a written answer below. `tree/rule-without-fixture` is at
zero and stays in the census, because a rule added without a fixture puts it straight back.
The figure moved six times that day for reasons that were not fixes. The `duplicate-run` retuning
three sections down widened its own scan from 2 rows to 31; the two newest scans did not exist when
the earlier counts were taken; teaching the identity scan to read a `join()` call added rows for
names that were always there; and teaching it to skip a literal in a type position took 13 away
again, as did reading the two other shapes the compiler owns — which is the honest reading of a
census that went 1992, 92, 5, 13, 71, 67, 55, 51, 47, 46, 37, 26, 21, 13, whose last five
steps are the owner sweep described below, one more compiler reading and the eight fixtures. A
count is
only comparable against the same set of scans, and the number going up because the tree is read
more closely is the mechanism working, not a regression. The one comparison that means anything is
a single scan run over two trees: with the `join`-aware scan, the tree before the bundle-layout
sweep below carried 60 rows over 208 file-spellings and the tree after it carries 54 over 147; the
type-position skip then took that same tree to 41 over 113, reading a type declaration to 40, and
reading an `as const` block a type is derived from to **37 over 103**.
Every per-file rule is at zero and in the gate — 29 `ana` catchers, none of them set `off`, and
the built-ins beside them — so `tools/oxlint/simplify.json` holds no rules at all. What is left
is the whole-tree scans, which no per-file rule can express and which therefore cannot be
promoted.

Sixteen commits took it down, one group at a time, and the shape of the work was the same every
time: read the whole group, decide it, then either fix every site or change the rule and record
what the change measured. The count after each was 1475, 1164, 608, 578, 308, 260, 232, 206, 184,
159, 47, 34, 21, 2, 0. Two of those steps are a correction rather than a wave of fixes. The 159
was wrong — it counted built-in groups earlier waves had already emptied, and a fresh measurement
before the sleep group put the real figure at 67 — and 308 read as 270 when the next group opened.
A carried number is worth re-measuring before it is used to decide anything.

Roughly half of the 1992 was mechanical, a fixer or one spelling, and it went in the first two
commits. The half that was left is the part worth recording, because in it the rules moved as
often as the source did.

**Nine of the groups needed an exemption before their remaining sites could be read as findings,
and one closed without a line of source changing.** That one was
`no-arms-differing-in-one-term`, 24 sites to 0: the token comparison was finding dispatch — a
callee, a member, a JSX element, an assignment target — and hoisting one of those buys a computed
member or an indirect call. `no-argument-already-carried` went from 24 to 1 once it required the
callee to be declared in the same file, because the fix for the shape is a signature change and
`readSync(handle, chunk, 0, chunk.length, position)` is Node's signature, not this file's.
`prefer-lookup-over-equality-chain` went from 13 to 1 once an arm that reads the subject stopped
counting, because that is a union split and not a table with a hole. In both the last site was a
real finding and was fixed, which is the ordinary end of a group: the exemption takes the sites
the rule should never have claimed, and the source takes the rest.

**Where a rule yielded, the yield is in its doc comment with the count it moved**, so the next
reader gets the measurement and not the conclusion. Where a rule held, the fix is in the source
and the argument is in the commit.

**Two whole-tree scans were arguing something their sites did not support.**
`tree/test-only-export` reported 154 of which 89 were a module calling its own export, and
`tree/single-reader-export` counted a type and a constant as code that could move. Narrowing both
to what they can defend took 330 findings to 59, and both are still in the census rather than the
gate: a scan reads the tree at once and has no per-file rule to become.

The promotion criterion is worth stating once, because getting it wrong cost several attempts:
the evidence for promotion is a clean `bun run lint`, not an emptied census group. The census
reads a narrower scope than the gate, so a group can empty while a site still stands in a tree
only the gate reads.

#### The six tree scans, decided

The scans closed differently from the per-file rules, because a scan reads a relation between
files and most of its sites are a question rather than a defect. Each was read as a group.

`tree/identity-without-owner` is the largest group and the newest, added 2026-09-20. It reports one
name this repository owns — a bundle path, an evidence file, a schema tag — spelled as a literal in
two or more files with no constant naming it. It opened at 60 rows over 208 file-spellings; the
bundle-layout sweep below closed six of them and 61 of the spellings, leaving 54 over 147, and the
type-position skip below took it to **41 over 113**, the type-declaration reading beside it to
**40**, and the typed-block reading after that to **37 over 103**, of which 13 have an owner some
other file declares and 8 of those 13 do not export it. A fifth compiler reading and the owner
sweep below then took it to **7 over 14**.

It exists because the per-file rule beside it cannot see the repeat this tree actually carries.
`ana/no-repeated-string-literal` counts spellings within one file and its floor is four, so
`correctness-model/evaluator.ts` — twelve files, two or three spellings in each — is invisible to it
twelve times over. The rule's own thesis is the argument for the scan: the compiler owns a union
member, so a typo in one of four copies of `"non-result"` is a build failure, while
`correctness-model/evaluator.ts` is characters and a wrong one arrives at a reader as a missing file
rather than as a mistyped name.

A name has two spellings and the scan first saw only one. `join(slugDir, "agent", "tools-spec.json")`
names the same file as `"agent/tools-spec.json"`, and the scan read straight past it: two literals,
neither of them an identity on its own. That blindness hid 22 of the 89 sites the first sweep had to
fix, so the scan now pastes adjacent quoted segments inside a `join(…)` call and reads the result.
Only a `join` call counts. `["agent", "correctness-model"]` is a list of two directories, and
pasting those together would invent a third name that no tree has.

The scan also read 13 rows the compiler already owns, and they went the other way. A literal in a
*type* position — `schema: "control-receipt/v2";` declared as an interface member, or
`Type.Literal("…")` — makes that string the field's type, so every writer assigning it and every
reader comparing against it is checked, and a typo in any copy is a build failure. That is exactly
the argument this scan's own text makes for skipping a bare union tag, applied to a value that
happens to carry a slash. The closing `;` is what separates it from `schema: "control-receipt/v2",`
in an object literal, where nothing checks the characters. All 13 were versioned schema tags, and
the class was checked against a row that stayed: `campaign-opening/v2` is declared into a field
typed `JsonValue`, so no copy of it is checked and it is a true finding.

Reading the tail then corrected the scan three more times. A literal in a `type X = … | "tag" | …`
declaration is a type position as much as a member is, and the member form read straight past it:
`darwin-seatbelt/v1` is an arm of `VerifierSandboxLevel` in `src/verify/verifier-port.ts` and
`DARWIN_SEATBELT_ID` is checked against it wherever the two meet, so that row went the way the other
thirteen did. A row now anchors at a spelling that does *not* declare the name, because the
declaration is the one line with no work to do and a row pointing there sends the reader off to find
the other file. And the detail says whether the owner is **exported**: of the 15 owned rows, 8 name a
private constant — `FROZEN_MANIFEST_PATH` in `src/critic/manifest.ts` is spelled in five files and
exported from none of them — so the repair there is to export it first, and the earlier wording sent
the reader to import something that did not exist. The tail stands at 37 rows: 24 with no owner, 5
with an exported one, 8 with a private one.

The fourth compiler-owned shape had to be measured before it could be read, and the first attempt
at it silenced true findings. `const ISOLATION_FIXTURES = […] as const` beside
`type IsolationFixture = (typeof ISOLATION_FIXTURES)[number]` hands the union to the compiler, and
`{…} satisfies Record<IsolationFixture, …>` checks every key against it — but whether that check
reaches *another* file is the whole question, so it was tested rather than assumed: mistyping
`host-seatbelt-read-deny/v1` in `src/verify/solve-sandbox.ts`, which declares its own constant four
files from the array, fails the build in four places, two of them in tests. Three rows went that
way. Reading `as const` on its own, though, took the tail to 34 and took three *true* findings with
it: nothing derives a type from `EXECUTABLE_ROOTS` in `src/run/source-identity.ts`, so
`thresholds.frozen.yaml` in the other four files is checked by nobody, and the same held for
`case-record.jsonl` across eleven files. The reading therefore requires `satisfies`, or `as const`
with `typeof <NAME>` appearing somewhere in the same file. The block is closed by matching its
opening line's exact indent rather than by counting brackets, because one bracket inside a string
drifts the count and a single drift swallows the rest of the file.

The repair differs by row, which is why the detail says which case it is. `correctness-model/tasks.json`
is spelled in eight files while `TASKS_FILE` in `src/run/experiment-freeze.ts` already names it, and
`.bundle-snapshots` in five while `SNAPSHOT_DIRECTORY` names it: those rows ask for an import.
`case-record.jsonl` in eleven files and `correctness-model/brief.json` in ten have no owner at all,
and those ask the harder question of where the owner goes — which is why this is a census scan and
not a rule. A fixer would answer it with a local constant every time, which is the second copy again
under a name.

Four things are skipped and each is a class rather than an exclusion list entry. A literal under
fifteen characters, or one carrying whitespace, is a word or a sentence rather than a name. One with
neither a slash nor a dot is a bare tag, which is the union member the compiler already owns. One
carrying `${`, `=` or `:` is an interpolation fragment, a configuration assignment or a namespaced
slug — `commit.gpgsign=false` and `inclusionai/ling-3.0-flash:free` are the measured instances, and
neither is a name this tree gets to choose. And a prefix another program, registry or standard owns
— `application/`, `@`, `https://`, `/usr/`, `/private/` — reads against that owner's documentation,
where a local constant reads against nothing. Import and comment lines are skipped too: a specifier
belongs to the module system, and an example in prose is a reading of the name rather than a second
copy of it.

Tests keep spelling the literals, and that is the decision rather than an omission. A fixture that
builds its tree from the same constant as the code under test follows a rename and passes either
way, so the layout would stop being checked by anything at the moment it changed. The scan's
declaring corpus is `src`, `tools`, `packages/ui/src` and `.claude`; `test/` is not in it, and the
sweep below left all 60-odd test spellings alone.

The first group was decided and emptied the same day. Six names — the four `correctness-model/`
files, `agent/tools-spec.json` and `agent/tools.ts` — were spelled at 89 sites in 31 modules, two or
three to a file, which is below `no-repeated-string-literal`'s four-per-file floor at every one of
them: the rule saw a clean tree while the layout was typed out eighty-nine times. `src/meta/bundle-layout.ts`
now owns all six, on the precedent of `campaignRoot()` in `src/meta/campaign-root.ts`, whose own
comment records the same story about forty `join(repoRoot, "campaigns", …)` sites. Three bundle
names were deliberately left where they are — `BUILT_AGENTS_FILE`, `REFERENCE_SOLVE_ENTRY` and
`HARNESS_CONFIG_FILE` each sit in the module that owns their meaning, and moving them would trade
one owner for another rather than remove a second spelling. Four local declarations went: a private
`TOOLS_SPEC_FILE` in `candidate-check.ts`, `GENERATED_TOOLS` in `probes.ts`, `TASKS_FILE` in
`experiment-freeze.ts` and a function-local `const rel` in `contracts.ts` that the scan had reported
as an owner because it could not tell a module constant from a local one.

One spelling of `export` cost five rows before it was caught. Skipping every line starting with
`import` or `export` also skipped `export const TASKS_FILE = "…"`, which is precisely the
declaration the scan looks for, so five owned identities read as unowned. Only a re-export — `export
* from`, `export { … } from` — is the module system's.

The owner sweep took the group from 37 rows to 7, and a fifth compiler reading took five of the
rows it never had to fix. A path an inline `import("…")` in the same file already spells is one
loader's single fact written twice for two consumers: the specifier is for the compiler, the
repository-relative tail for a runtime that resolves it inside another checkout, and TypeScript
cannot take an `import()` type from a runtime string, so the pair has no third spelling to collapse
into. That was 5 of 37 rows, all in one file.

The 25 rows the sweep closed fell into three shapes, and the shape decided the repair. Five already
had an exported owner and asked only for an import — `OPERATOR_BACKENDS_DIR`, `BUILT_AGENTS_FILE`,
`REFERENCE_SOLVE_ENTRY`, `BUILDER_SESSION_EVIDENCE_FILE`. Six had a private one and asked to export
it first: `FROZEN_MANIFEST_PATH` in `src/critic/manifest.ts` was spelled in five files and exported
from none, `.bundle-snapshots` and `.controller.lock` the same way. Fourteen had no owner at all,
and each went to the module that produces the bytes rather than to the first file that reads them —
`case-record.jsonl` onto `src/claim/case-record.ts` beside its schema tag, `conformance.json` onto
`src/claim/conformance-evidence.ts`, `builder-path-record.jsonl` onto the `openPathRecord` that
appends to it, `claude-oauth.json` onto `src/backends/env.ts`, whose loader also reports that file
name as the credential's provenance, and `node_modules/oxlint/bin/oxlint` beside `tsgolintPath()`
in `tools/runtime/lint.ts`, which already resolves the linter's other half. Placing an owner at a
reader would have been the second copy again under a name.

One row needed a module of its own, and it was settled by measurement rather than by argument.
`ana-reference-solve/v3` is the protocol tag on both ends of the reference-solve wire and each end
declared its own `as const` copy, so the pair was held together by a test — and a test is the wrong
owner here. Drifting the child's `/v3` to `/v4` fails 15 of the 20 tests across
`solvability-reference-solve.test.ts` and `trusted-runtime.test.ts`, and every one of those failures
reports `owner: "bh-correctness-model"`: a controller-side typo routed to the candidate's
correctness model as a `generated-solve-protocol` product defect. Neither end could hold the
constant either. The parent's import graph is spawn, bundling and confinement witnessing, which is
the whole of what the confined child is meant not to contain, and the child binds `Bun.stdin`'s
reader at import. `src/truth/reference-solve-wire.ts` holds the two strings and nothing else.

Three rows are **answered no** and stay printed. `packages/ui/src` appears in `EXPORT_ROOTS` in
`tools/loc/source-policy.ts` and in `DECLARING_ROOTS` in `tools/oxlint/tree-findings.ts`: two
policies' own scopes with different contents, where sharing the element would assert an agreement
neither policy makes. `src/meta/json-runtime.ts` is spelled by `stage-run.mts` as a module specifier
handed to a child Bun process running in another checkout, where this tree's renames do not reach —
the same fact the `import()` reading above skips five rows for — while
`require-captured-json-runtime.ts` names it as the module its rule governs. And `scripts/worktree.sh`
is answered no on cost: both spellings are `join(root, …)` calls in skill scripts that share no
module, so the owner would have to be either a controller module a detached launcher should not
load at import or a new module holding one string, and a renamed helper already fails both callers
at once with the path in the message. Five more rows are deferred rather than answered — the
launcher's hard-coded checkout root and three `pi-codex/…` module paths, all four inside the three
files `claude/bridge-rewrite-0919` rewrites.

On 2026-09-22 the operator asked for redundancy to be consolidated, and none of the three stays
printed. `scripts/worktree.sh` had an owner this note missed: `tools/dependency-identity.ts`, the
module the script runs, now exports `WORKTREE_SCRIPT`. The two root lists share one fact, where
authored source lives, so `tools/loc/source-policy.ts` exports `AUTHORED_ROOTS` and the census adds
`.claude` to it. And the `json-runtime.ts` spelling is read as the loader it is: a line handing a
path to `pathToFileURL` is skipped as an inline `import()` is.

`tree/rule-without-fixture` is the other new one, and it asks the one question this
whole file had never asked about itself: which of the rules it argues for still report. A rule is
source, and the only proof that source runs is a fixture that makes it run. The metadata contract
in `test/oxlint-rule-contract.test.ts` reads every rule's declaration — `fixable: "code"` or the
words "no fix" with a reason, and a `fixedSource` fixture behind any declared fixer — and makes no
rule report even once. So a rule that has quietly stopped matching, because an AST field was
renamed under it or an oxlint upgrade stopped handing it a node type, passes that test, reports
nothing, and leaves a gate that reads exactly like a clean tree. That is the same failure the
census exists to catch, one level up.

The measurement was **8 of 49 registered rules**, and it was not evenly spread: all 33 `ana`
rules were named by a fixture and 8 of the 16 `anti-slop` rules were named by nothing under
`test/`. `test/anti-slop-still-reports.test.ts` now names all eight and the group is at **zero**.
Each fixture is the smallest pair that separates the two failures a fixture can catch: the
`// REPORT` line fails a rule that has gone quiet, and the line beside it fails a rule that has
started reporting everything. Those second lines are the part worth reading, because each is the
nearest admitted case rather than an unrelated line — a lazy `.values().filter().map().toArray()`
beside the eager pipeline, a mutating reducer beside the one that copies its accumulator, and
`typeof value === "undefined"` beside the narrowing `typeof`, which is the existence probe the rule
carves out by hand. `no-module-mocking` leaves `vi` undeclared on purpose: the rule reads it as a
global reference, and declaring it in the fixture would give the binding a definition that is not
an import and silence the rule against a test that still passed. The
scan reads the two `tools/oxlint/*/index.ts` registries rather than the rules directories, because
registration is what decides a rule runs — a rule file nobody registers is dead whatever tests it
has, and a registered rule is live whoever wrote it.

That last point is why the scan is exempt from `UNREAD` in `tools/oxlint/simplify-census.ts`, which
otherwise drops every row in `tools/oxlint/anti-slop/` and `vendor/pi-claude-bridge/`. `UNREAD` is
the scope of *taste*: a tree pinned from upstream is not ours to restyle. Coverage is not taste.
Every one of those 16 rules is switched on in `.oxlintrc.json` and fails a push here, so whether it
still reports is a fact about this repository's gate rather than about the vendored tree's style.
Applying `UNREAD` to it would have silenced all eight rows — the exact silence the row describes.

It also settles half of queue item 13 from the other side. That entry could only say the vendored
premise was *unrecorded*: `BASELINE.md` calls `tools/oxlint/anti-slop` a tree "this repository pins
verbatim at a commit" while no commit, URL or submodule says which. The measurement adds that the
premise is not being paid for either. The tree is excluded from the ruleset it hosts, excluded from
the census, and half its rules have no behavioural proof anywhere in this checkout. Whichever way
the pin is decided, those 8 want a fixture before the next oxlint upgrade rather than after it.

**Decided on 2026-09-20: there was no pin.** The tree is in the ruleset it hosts, and the eight
rows are eleven fixtures in `test/anti-slop-still-reports.test.ts` — the count was wrong by three,
which is what a shape asking "does it still report" is for. Only the `UNREAD` reading above
survives unchanged: coverage was never taste, whichever way the pin went.

`tree/filesystem-import-budget` is **not a finding at all** and is printed below the total as a
standing register. The operator's budget is a rule about the delta — a file keeps its count and a
change adds at most one — so a row is the current count and no reading of it is a repair. Counted
as findings its seventeen rows put a permanent floor under a total whose whole point is that it
can reach zero. `TREE_REGISTER_KINDS` in `tools/oxlint/tree-findings.ts` names the kinds that
print apart.

`tree/test-only-export` went from 154 to 1 to 0. The last site was
`refreshOpenAICodexToken`, and it was dead: `storage.ts`'s own doc comment records that a Codex
login is stored as the CLI's `auth.json` and that the CLI refreshes that file itself. Deleting it
took the function's only parameter with it, since the remaining caller always passed the
authorization-code grant, and `test/oauth-login-race.test.ts` now drives the same response check
through `loginOpenAICodex`, which is the path the product takes.

`tree/single-reader-export` went from 58 to 3, and **the rule moved further than the source did**.
Six changes, each measured on the tree before and after:

- The reader must have room under its own ceiling in `tools/loc/source-policy.ts`, including a
  frozen `copiedFileLimits` entry. `src/truth/probes.ts` sits on 436 of 436, so nothing can move
  into it and reporting one asks for a change the gate then refuses. Five of 66.
- The home file must hold exactly one export. A file holding several is a layer, and one of its
  names having a single reader says nothing about where that name belongs —
  `run-triage/evidence.ts` holds eleven exports for `cli.ts`, which is a library and its command.
  Ten of 42. This is also the guard that makes the corpus argument honest: of the 228 net-negative
  source commits since 2026-09-08, **71 deleted a source file**, well under the 86 of 138 the
  original argument counted as helper moves. Most of those moves were inside one file, which is
  `ana/no-single-caller-helper` and already in the gate.
- Home and reader must sit in one directory. Different directories are different areas of this
  tree, and here one of those boundaries is the Builder's file wall: `published-rules.ts` is a
  `src/truth` contract read from `src/author`, and a move would publish a correctness check to the
  sessions it judges.
- A module the reader resolves as a path is a process image, not a helper.
  `evaluator-process-bundle.ts` bundles `"./reference-solve-child.ts"` into its own executable,
  and an entry point cannot move into its launcher. The quoted `./` prefix separates a resolved
  path from a doc comment naming a sibling, which this tree writes everywhere — of fourteen files
  a looser match caught, eleven were prose.
- A name spelled more than once in its own file is used at home, and neither finding survives
  that: the home keeps the original and the reader would get a copy. 89 of the 92 test-only sites
  and 16 of the 60 single-reader sites.

Two sites then answered yes and both deleted a file. `claudeBashPermission` went into
`claude-backend.ts`'s `canUseTool` callback, where the run's safeguard context already is, and
`measureBattery` went back into `harness-measure.ts`, which had imported it while it imported
`HarnessMeasureOptions` back — the split had left a type cycle between two halves of one
entrypoint.

**Three single-reader sites and both `duplicate-run` sites are answered no, and stay printed.**
They are recorded here so the next reader gets the answer rather than the question:

- `ImprovementChart` (`packages/ui/src/views/climb.tsx` → `forge.tsx`) pairs with its sibling
  `climb-data.ts`; the view and its data reader are one unit and the chart belongs beside the
  reader, not inside the page that happens to mount it.
- `PushQueue` (`src/backends/claude-push-queue.ts` → `claude-backend.ts`) is a generic queue with
  no dependency on the backend, and the file records the 2026-08-20 split that created it. Both
  files went on 2026-09-21, when every host slot moved onto the shared pi provider layer.
- `identitiesWithoutOwner` (`tools/oxlint/tree-identity.ts` → `tree-findings.ts`) is one of six
  independent scans, and its home reached 588 of its 600 lines holding all six. The row is the
  scan reading its own split, and the answer is the one the budget forces: a file at its ceiling
  asks for the smaller honest form, and the largest scan — the only one that has to decide what
  counts as a name at all, so the only one carrying its own dials — is the honest cut. Nothing was
  copied and nothing sits outside a count; the two files are 490 and 129 nonblank lines.
- `candidateTools` (`src/solve/draft-candidates.ts` → `built-starter.ts`) is a coherent feature,
  and its reader is already the largest file in `src/solve` at 617 lines. Reversed on 2026-09-20;
  the second reading below says why.
- The two `duplicate-run` pairs are a six-line bundling frame shared by
  `evaluator-process-bundle.ts` and `pi-built.ts`, and a seven-line argument assembly shared by
  the Linux and Darwin verifiers. Both pairs are two platforms or two owners writing the same
  short shape, and joining either would create the cross-tree dependency the scans exist to warn
  about.

Its argument text now states the shape as a question whose yes deletes a file, which is the only
reading that made its sites agree with what this repository's removals actually do. What does not
follow is that a scan whose remaining rows all have a written answer is finished. `duplicate-run`
was at exactly that point on the morning of 2026-09-20, with the two pairs above answered, and
retuning its three knobs took it to 31 rows of which twelve moved code to an owner that already
existed. An answered row says the scan asked everything it can see, and what it can see is a
setting.

#### The same lesson again, from the other side — 2026-09-20, later

Two of the three single-reader rows answered above should never have been asked. The shape sized
the move by the **exported declaration** when the file is what moves — one export, by its own rule,
so the private helpers and the header travel with it. `tree-identity.ts` is a 24-line export inside
211 lines of its own scan and `climb.tsx` a 55-line chart beside the tooltip it renders, and both
are modules in their own right by the shape's own argument. Measuring the home file, after the
single-export check rather than before it, left **5** rows, all small files with a reader in the
same directory, and all five answered no: an approval policy, a queue with no backend dependency,
a JSON-RPC frame classifier, a product-policy boundary, and the file whose first sentence is
"Split from host.ts so the fresh HOME and TMPDIR rule has one owner". `BASELINE.md` has the table
and the three discriminators that were tried against those five and dropped.

So an answered row can be an answer to a question the scan asked wrongly, which is the one failure
mode the sentence above does not cover: a setting decides which rows appear, and it also decides
whether the row in front of you is about what its text says it is.

`tree/identity-without-owner` closed four of its seven the same day. All four were the pi launchers:
`pi-claude.ts` and `pi-codex.ts` are one program with a different credential, and each spelled the
pinned checkout's three module paths into a `join(…)` the compiler never sees. `pi-entry.ts` owns
them now, and the harness-builder root moved to an `HB_ROOT` export on the extension that already
read it five times. The three left are refused in `BASELINE.md`: two skills sharing a script path
with no module between them, one path that is two different facts at two different moments, and two
root lists that are meant to differ.

#### `tree/identity-without-owner` scored against its own record — 2026-09-21

The scan has a record to be scored against: the two commits that opened this shape, `ee766c7e2`
(the per-file rule) and `f72177fa4` (the cross-file scan), each carry the sites a person named by
hand. Replaying the shipped scan over their parent trees found **17 of 31** named values (site
recall 0.54, per-value 0.64 with the per-file rule beside it), and the misses had two causes.

The first was the fifteen-character floor. The record's largest single edit named `RECEIPT`,
`OPENING`, `TERMINAL` and `BATTERY` for `intent.json`, `opening.json`, `terminal.json` and
`battery.json`, every one under the floor. Lowering the floor alone let in `127.0.0.1`,
`../../../..`, `package.json`, a bare `.json` and the dot-directories `.codex`, `.claude` and
`.env`. What separates `opening.json` from those is a stem and an extension, so a short literal
is a name when `FILE_NAME` matches it, at a floor of three files rather than two: two files
agreeing on `index.ts` share a word. `package.json`, `tsconfig.json`, `bun.lock`, `bunfig.toml`,
`.bun-version`, `node_modules` and `README.md` are the toolchain's, and `./`, `../` and `.local/`
are the module system's or XDG's, all in `ownedElsewhere` so the per-file rule answers the same.

The second was `satisfies`. `src/author/feedback-routing.ts` closes its owner-files block with
`satisfies Partial<Record<FeedbackOwner, readonly string[]>>`, which checks the keys and leaves
every value a `string`; the scan read the block as the compiler's and one typed spelling silences
a value tree-wide, so `correctness-model/brief.json` in nineteen other files was invisible — on
the very tree `f72177fa4` was written against. `satisfies` now makes a block typed only when the
type it names does not say `string`; `satisfies readonly Level[]` still does.

With both: per-value recall **0.81** (25 of 31) over the record, and on this head the scan lists
**17 rows** where it listed 3: `battery.json` in 7 files, `auth.json` in 7, `opening.json` and
`iteration.json` in 6, `terminal.json` in 5, `worker.mjs`, `brief.json`, `tasks.json`,
`controls.json`, `judge.json`, `artifact.json`, `census.json`, `backends.json` and `system.sb` in
3 or 4. Read by hand, 13 name one file this repository owns and four of those already have a
private constant. `worker.mjs` looked like three different files and is one: the `naming` of
`buildWorkerBundle`, read back at three call sites. The six remaining misses are three receipts a
person named as one `RECEIPT` record from two or three spellings in one file, which sits below
the per-file floor of four, and three single spellings the per-file rule cannot reach at all.

**The 17 rows, decided — 2026-09-21.** Fourteen were answered by naming the file once in the module
that writes it, and every reader now imports that name: `OPENING_FILE` and `TERMINAL_FILE` in
`src/run/controller-lineage.ts` (the private `OPENING`/`TERMINAL` in `controller-evidence.ts`
went), `BATTERY_FILE`, `CASE_ARTIFACT_FILE` and `CASE_JUDGE_FILE` in `src/truth/battery-record.ts`
beside `batteryPath`, `ITERATION_FILE` in `src/builder/campaign-iterations.ts` (the private copy in
`campaign-memory.ts` went), `CENSUS_FILE` in `src/run/census-gate.ts`, `BACKENDS_FILE` in
`src/run/model-preflight.ts`, `SEATBELT_BASELINE` in `src/verify/wall-policy.ts` and
`CODEX_AUTH_FILE` in `src/backends/login-state.ts`. The bundle names already had owners in
`src/meta/bundle-layout.ts`; six readers spelled them again after `modelDir()` or under
`correctness-model/`, and `basename(TASKS_FILE)` answers those. Two rows were not names to own:
`worker.mjs` is the one file `buildWorkerBundle` writes, so it now returns the path it wrote and
the three callers that recomputed it read the return; and `auth.json` had its owner in
`codexAuthFile(env)`, which `pi-built.ts` and `pi-codex.ts` had each written out again in full,
`homedir` and `isAbsolute` included, so two bodies went with the spelling. `tools-spec.json` in
`tools/outcome/metrics.ts` and `evaluator.ts` in `evaluator-process-bundle.ts` stay: each is one
spelling in one TypeScript file, below every floor, and the owner is a `join` away. After the fix the scan
lists the 3 standing rows it listed before the retuning; 35 files changed and 411 focused tests
passed.

#### `tree/duplicate-run` after the 2026-09-20 retuning, decided

The retuning — the literal normalised on a line with other work in it, a variety guard, and the two
length floors lowered to five lines and four of code — took the scan from 2 sites to 31, and the
answers below took it to 10. The four measurements are in `BASELINE.md`; this is what the sites
turned out to be.

**Thirteen rows were answered by moving code**, each to an owner that already existed nearby:

| what | where it went |
| --- | --- |
| `onlyStatement` ×3 and the statement-list visitor ×2 | `tools/oxlint/ana/shared/statements.ts` |
| the CLI parse preamble ×14, the absolute-path check ×5, the required-option check ×2 | `.claude/skills/main/cli.ts` |
| the folded trace facts ×2, restated a third time in a `.d.mts` | `foldTraceFacts` in `tools/outcome/trace-facts.ts` |
| the case-outcome counts | `OutcomeTally` in `src/claim/case-record.ts`, exported |
| the temporary-then-rename write ×3 | `writeAtomic` in `src/meta/completed-json.ts` |
| the guarded-path decision ×2 | `decideGuardedPaths` in `src/builder/candidate-isolation-runtime.ts` |
| the opening's backend record ×2 | `backendStartupEvidence` in `src/run/model-preflight.ts` |
| the attempt with no verdict ×2 | `noVerdictAttempt` in `src/truth/judge-drivers.ts` |
| the captured `git` command ×4 | `runSyncOrThrow` and `CAPTURE_MAX_BYTES` in `src/meta/subprocess.ts` |
| the per-family counts ×2 | `familyTally` in `src/claim/case-record.ts`, beside `outcomeTally` |

**The last of those moves paid the most, and none of it was the duplication.** The row named a
`git` capture written out in `tools/secrets/scan.ts` and `tools/run-triage/coverage.ts`;
`src/meta/subprocess.ts` already owned the shape. Four copies carried a comment saying the 64 MiB
buffer stops a large working tree from truncating silently at "the 1 MiB default" — that default is
Node's contract, not Bun's. Measured on Bun 1.4.2 there is no cap at all: an 80 MB stdout comes
back whole, so the number was never the thing being defended, and past it Bun stops the child,
which is the loud failure the callers want. Two of the four sites had no cap, one of them running
`ls-files` and `status --porcelain -uall` over a Builder workspace. The owner's error message could
not tell a command stopped at the cap from one that never started — both read `git exited null`
with nothing after the colon — and five further files reached the owner while passing a bare
`"git"`, skipping the `hostTool` resolver that exists because `/usr/bin/git` is an xcrun shim. The
scan reported a duplicated capture. What taking it seriously found was a wrong comment in four
places, a missing limit in two, an error message that named the wrong ending and a missing resolver
in five.

**One was not a duplicate at all, and taking it seriously found a defect.** `regularGuard` in
`command-guard.ts` and `isRegularFileDeny` in `linux-bwrap.ts` were the same four lines with
`lstat`. The bubblewrap one is right — there the question is what the path *is*. The guard asks
what the path *leads to*, and `lstat` answers `false` for every symbolic link, so on a host whose
`dcg` was installed as one, no guard resolved and no destructive command was ever asked about. The
match was real; the conclusion "these are one function" was not, and the third reading — one of
them is wrong — is the one the scan cannot make for you.

**Ten rows stayed printed with the answer written here.** The two the previous pass recorded were
among them, re-derived independently and unchanged. Three of these eight answers were reversed
later the same day, and the second reading below says on what evidence. The bullets stay as they
were written: what a reversal is worth is the reason the first answer looked right.

- The **isolation input** stated by `prepareDarwinSeatbelt`, `prepareLinuxBwrap` and
  `VerifierOsIsolationInput` (two rows). Five common fields at three boundaries, and
  `os-isolation.ts` already imports `linux-bwrap-verifier.ts`, so a shared type needs a third home.
  AGENTS.md asks Darwin Seatbelt and Linux Bubblewrap each to carry their own live proof; a shared
  input type is a step towards treating them as one thing.
- The **platform probe verdict** in `solve-sandbox.ts` and `seatbelt-path-guard.ts` (one row). One
  decision procedure — refused and lifted, refused and not lifted, not refused — with two
  vocabularies. A helper taking three sentences positionally would read worse than the two copies.
- The **worker bundling frame** shared by `evaluator-process-bundle.ts`, `pi-built.ts` and
  `generated-tool-worker-process.ts` (two rows). Six `Bun.build` options; the three agree on all
  six, so there is no drift to fix, and they sit in three trees.
- The **spawn options literal** in `reference-solve.ts`, `host.ts` and
  `generated-tool-worker-process.ts` (two rows). The shared part is the `Bun.spawn` argument; the
  differing part is the typed non-result classification, which AGENTS.md requires each host to own.
  Merging the spawn leaves the substance duplicated.
- The **two calls to `superviseVerifierProcess`** from `reference-solve.ts` and
  `evaluator-process.ts` (one row). This one already has its owner, and the run the scan matched is
  the argument list at its two call sites — five of those lines are the `cancel` closure. The
  callers differ in what they drain and in whether a timeout finishes an outstanding promise, so a
  wrapper taking the difference apart would be a second owner standing in front of the first.
- The **two slot resolvers**, `resolveBuilderSlots` and `resolveBuiltSlot` (one row). One shared
  line, a call to the module that already owns it, and two refusal sentences that are most of the
  content.
- The **two non-result kind sets**, `VERIFIER_EXECUTION_NON_RESULT_KINDS` and
  `ENVIRONMENT_OWNED_NONRESULT_KINDS` (one row). Four members overlap and the difference is the
  decision: `timeout`, `crash` and `protocol` are not environment-owned. Merging destroys what the
  sets are for.

**The per-family row was the one left open, and it closed by asking which count each copy meant.**
`metrics` folded inside a larger pass and `rebuild-advice` built a Map from a reshaped row, and
`src/author` cannot import from `tools/`, so the owner had to be the file both already read:
`familyTally` sits beside `outcomeTally` in `src/claim/case-record.ts` and reuses it, one group per
family. The two copies did not spell `passed` the same way — `metrics` counted the classified
`pass`, `rebuild-advice` counted `truthOk === true` inside its verified branch — and they are the
same set only because a case row carries `pass: acceptedSubmit && truthOk`, which makes the two
coincide exactly where both were looking. Each caller still projects the fields it published, so
neither the operator report nor the advice packet, which is a condition identity, gained `failed`.

**One was a false positive, and the rule moved instead.** `verifier-workshop-tool.ts` and
`harness-inspect.ts` each declare their own `action` enum as a typebox union. The action sets have
nothing in common — five workshop verbs against nine inspect modes — but `Type.Literal(@),` carries
two identifiers, so the literal normalises away and five copies of one line sit inside a seven-line
run. The two lines around them, `const Params = Type.Object({` and `action: Type.Union([`, supplied
exactly the three distinct lines the variety floor asked for.

A fixed floor of three is the wrong shape of guard: it is what a half asks of the shortest run the
scan can report, and less than it asks of every longer one. `DISTINCT_LINE_SHARE = 0.5` replaces
`VARIETY_FLOOR` — more than half of a run has to be lines that differ from each other. A cap on the
most repeated line was measured beside it and drops exactly the same row; nothing separated the
two, on this tree or on a constructed shape, because the shape that would — an alternating mapping,
where no single line is more than half the run — never reaches the predicate at all. `normalised`
collapses a literal only on a line carrying two identifiers, so `case @:` and `return @;` keep
their words and two unrelated mappings share no run to test. The share is kept for being one number
where the cap is a count per line.

**What the answered rows left as work**, in the order they were found:

- Six restatements of the case counts stay as different subsets for different purposes:
  `run-driver.ts` adds `passRate` and drops `failed`; `controller-denominator.ts` deliberately
  carries no `passed`; `claim-write.ts` carries only `verified` and `passed`; `rebuild-advice.ts`
  and `epoch-reviewer.ts` are per-family. One spells the count `passes` where the rest spell it
  `passed`, and spells both inside one file — `src/run/climb-history.ts:55` against its own line
  158 — which read as drift and turned out to be the other way round. `passes` is the estimation
  vocabulary `wilsonInterval(passes, attempts)` and `placeOnBand(passes, n)` speak, and the family
  row is a difficulty row, so `passes` is the right word there and renaming it would move a
  model-visible digest for nothing. The drifting name was its neighbour: the row called the
  difficulty denominator `verified` while `measuredExperiment` builds it by censoring runtime
  non-results and keeping admission-refused attempts as failures. It is `attempts` now, in the
  interface, the two tests and the note the author reads.
- `failed` is derived inside `OutcomeTally` — `verified` counts `pass` and `fail`, `passed` counts
  `pass` — and it stays. It has one consumer, `tools/outcome/scorecard.ts:299`, which prints it for
  an operator, and removing it would move `verified - passed` to that print site. The census rule
  reports one shape restated across owners; a derived field inside the owner is not that, and the
  three readers that do not want it already leave it out by destructuring.
- `required` in `.claude/skills/main/cli.ts` stays local at its 21 call sites — a deliberate no, because the name
  is shorter than the import that would replace it and every script means the same thing by it.

#### Reading the answered rows a second time, 2026-09-20

An answered row is not a closed one. Every answer above was written by someone who had both files
open; the four below were reversed by someone who then opened a third. Each reversal names the fact
the first reading did not have, because that is the part worth keeping — the answers were not
careless, they were made on less.

- The **worker bundling frame** now has an owner: `buildWorkerBundle` in `src/meta/subprocess.ts`,
  called by `pi-built.ts`, `generated-tool-worker-process.ts` and `evaluator-process-bundle.ts`.
  "They sit in three trees" was the cost that decided it, and all three already import from
  `src/meta/`, two of them from that same file. The options are also not defaults: the child is
  spawned by the name `naming` gives it, so a `target`, `format` or `splitting` that drifted in one
  copy would break that one child at runtime with no build error. Seven options, of which `plugins`
  is the only one the three do not share, so it is the only parameter beyond the entry point, the
  output directory and the failure label each error message already carried.
- The **two slot resolvers** now call `requireSlotSupport`, beside the `COMPLETE_INTERFACES` table
  that decides them. "Two refusal sentences that are most of the content" was true and was the
  reason to look again: both sentences restated the table as prose — *pin builder to claude, codex,
  or openrouter* — so a kind gaining a complete interface had to be edited in two more places for
  the refusal to stay true, and neither place is near the table. The reason clause stays with the
  caller, since what an incomplete slot costs differs: a Builder cannot author the bundle, a Built
  battery cannot be verified.
- The **isolation input** is now `VerifierConfinementRequest` in `src/verify/verifier-port.ts`.
  "A shared type needs a third home" assumed three declarations; there are four. The fourth is
  `prepareVerifierReads`, which declares four of the five fields and is called by both mechanisms
  already, so the two walls were sharing a function over these fields while declaring them
  separately. `verifier-port.ts` is the home neither mechanism owns and both import. AGENTS.md asks
  Darwin Seatbelt and Bubblewrap each to carry its own live proof, and that proof is executed
  evidence per platform; agreeing on what a confinement request contains does not weaken it, while
  a field added to one of four copies is a field the other three silently drop.
- `candidateTools` is inlined into `built-starter.ts` and `src/solve/draft-candidates.ts` is
  deleted. "A coherent feature" was checked against the wrong boundary: `built-starter.ts` defined
  two tools inline immediately after spreading `...candidateTools(draft, saved)`, so the split was
  not between a feature and its host but through the middle of one tool list. The ceiling argument
  was measured against 600; `NEW_FILE_CEILING` is 800 and the file holds 707 lines with the two
  tools in it.

**Then the scan had seven rows left, and every one of them was a shape.** Two of the seven were
what the four fixes left behind rather than removed: `resolveBuilderSlots` and `resolveBuiltSlot`
still match, but now on their parameter list alone, and the Darwin and Bubblewrap preparers still
match on the plan object they both return because one type declares it. The other five were the
`Bun.spawn` options literal (two rows), the `superviseVerifierProcess` argument list, the two
non-result kind sets and the platform probe verdict — each answered no twice, by two passes reading
them independently, and for the same reason every time: agreeing on a shape is the shape doing its
job.

So the floor moved rather than the source. `SUBSTANCE_FLOOR` counts the lines of a run that are
code, and "code" meant "not a closing bracket", which let a run reach four on lines no author
chose: a parameter declaration, a bare list entry, a shorthand property, a `? …` continuation. It
now counts lines carrying a call, an assignment or a statement keyword. That withdraws all seven
rows and leaves `tree/duplicate-run` at zero, and the argument for it is what the recorded wins
were made of — the thirteen rows above that moved code to an owner were a `git` capture, a
temporary-then-rename write, a CLI parse preamble, a folded trace fact, four or more calls and
assignments every time.

Zero rows is a setting, not a finished scan, which is the same thing this section said about ten
answered rows. `test/simplify-census.test.ts` holds both halves of the evidence: the `copy-a` and
`copy-b` pair still reports, with its five lines of code unchanged by the new floor, and two pairs
added beside the closers and the import specifiers mirror the real sites the floor now withdraws —
two files naming the same closed vocabulary, and two probes returning the one verdict shape their
declared type gives them. Both were verified to report under the old floor before being written
down.

### `no-repeated-string-literal` reads the test tree, and fixes it there — done 2026-09-20

The rule shipped with a blanket off-switch for test files, on the argument that a suite naming one
fixture in twenty cases is doing its job. The argument is right at three spellings and wrong at
twenty, and the off-switch could not tell them apart. Measured over the whole test corpus at a
floor of 5 there are 225 repeats; the count falls smoothly with the floor — 152 at 6, 100 at 7, 77
at 8, 38 at 10, 23 at 12 — so there is no cliff to read a floor off, and the line has to be argued
rather than found.

The floor is **10**, one dial per role: `REPEAT_FLOOR = { source: 4, test: 10 }`. Below ten, a case
spelling its own fixture is a case that reads alone. At ten the file has a fixture nobody named,
and the recorded instances say so — `"main_synthesis.md"` 26 times in one file, `"agent/tools.ts"`
30, `".launchd"` 25, `"run.log"` 21. All 38 sites are closed in this change.

**The repair is a local constant, and that is why a fixer is admissible here.** In a source file
this rule refuses to fix, because where the constant belongs is the question and a fixer would
answer it with a local one every time. In a test file the local one is the answer: the fixture
belongs to the suite that spells it, and importing the producer's constant instead would cost the
test the rename it exists to catch. The fixer declares the value once after the leading imports and
reads every counted copy back from that name.

It fixed **36 of the 38**, and the two it declined are the two classes it is written to decline: a
value carrying an escape (`"export const a = 1;\n"`) and one starting with a digit
(`"2026-01-01T00:00:00.000Z"`), neither of which turns into a plain identifier. It also declines a
name the file already spells anywhere in its text — over-refusing on purpose, since the cost of
over-refusing is a report an author closes by hand, and the cost of under-refusing is one name with
two meanings.

Two placement facts are pinned by fixtures rather than by care. The anchor is the last import of
the **leading** block, not the last import in the file: `test/outcome-query.test.ts` imports a
helper below its first statement, and a constant inserted after that one is a module constant
declared after the first line of code, which is `declarations-before-the-first-function`'s finding
on the next pass. And nothing is inserted before a first declaration, because that lands between a
doc comment and the declaration it documents — the same comment theft the `declarations` fixer
caused on this branch's parent.

**One prefix list, two scans.** The rule skipped a leading `-` and the identity scan skipped that
plus seventeen prefixes, so a `/usr/bin/…` path repeated inside one file was a finding while the
same path repeated across two files was not. `ownedElsewhere` in
`tools/oxlint/ana/shared/literal-owner.ts` is now the one answer both ask, for the reason
`file-role.ts` gives about paths: two scans deciding the same question separately is how they come
to disagree.

### `no-object-parameters` reads through the shapes that hide the type — done 2026-09-20

The rule refused `input: object` and an alias for it, and stopped there. A parameter hides that
type as easily as it spells it: `rows: object[]`, `pair: [string, object]`, `input: { rows:
object[] }`, `rows: Map<string, object>` and `Money & { census: object | null }` each hand the
callee exactly what `input: object` would, and all five passed a gate that refused the first one.
The search now enters an array, a tuple (in its plain, optional and rest spellings), a `readonly`
operator, a type literal's property and index members, a type reference's arguments and an
intersection, on top of the alias and union it already read.

It stops in two places, and both are the reason rather than an omission. **A function type is not
entered**: a callback's parameters are the callback author's contract with whoever calls it, not
this function's contract with its caller, and the rule already visits every function type and
method signature on its own, so the report belongs at the callback where the repair is rather than
twice. **`WeakMap` and `WeakSet` are exempt**: `WeakMap<object, object>` in `task-access-trace.ts`
maps a traced value to its proxy, where a key has to be an object — `WeakMap<Parsed, Proxy>` would
narrow what the table may hold rather than say anything truer about it.

The tree was at zero under the old reading. The widen found **3 sites in 2 files**, and both are
the kind the old reading could not see. `src/analyse/judge-safeguards.ts` declared
`census: object | null` as a member of the intersection its two sensors take as a parameter, which
is one `object` reaching two consumers; it now says `Pick<BatteryCensus, "runId"> | null`, which is
what the sensors actually read and still fails on a rename of that field. `test/run-triage.test.ts`
took `rows: object[]` in a fixture builder and writes them as JSON; it now takes `JsonValue[]`,
which is the contract the file it writes has. The tree is back at zero.

There is still no fixer, for the reason the rule always gave: the repair is an owner-provided type
parsed at its boundary, so the edit is a new contract in another file and at every call site. Both
repairs above prove it — neither type existed to be substituted in, and choosing `Pick<BatteryCensus,
"runId">` over the whole record is exactly the judgement a fixer would have to make and could not.

`test/no-object-parameters.test.ts` states each position once, 18 reports over 23 declarations, so
the admitted half says where the search stops as plainly as the reported half says where it goes.
`BASELINE.md` also lost a claim in the same change: it said `tools/oxlint/anti-slop/**` is pinned
verbatim at a commit, which `baf6edd7e` had already contradicted by editing eleven of its rules.

### What the two simplify review lanes measured

Two read-only lanes read the recorded simplify invocations — one the session transcripts, one the
138 net-negative commits those invocations produced — to establish which shapes recur. Their
counts are below, each re-measured against this head before being written down, because a lane
report is research and not evidence.

One shape was large enough to ship, and it has: **`export` on a declaration nothing outside its
own file names**. 22 of the 138 commits removed one, about 91 sites between them, and 226 were
still standing here in 142 files. `unusedExports` in `tools/loc/source-policy.ts` now holds the
line; the reasoning about its two roots lists and its textual search is in that function's
comment.

The rest of the lanes' list is smaller on this head than the transcripts suggested, because the
ledger pass and the earlier simplify passes have already taken most of it. Re-measured
2026-09-20 over `src`, `tools`, `vendor`, `test` and `packages`:

| shape | lane sites | now |
| --- | --- | --- |
| a side-effecting `Set` inside `.filter()`, used as a dedupe | 1 | `ana/no-side-effect-in-predicate`, 2 in the census |
| `await new Promise((r) => setTimeout(r, N))` in a test | 1 | `ana/no-hand-rolled-sleep`, 20 |
| `f(x, x.y)` where the callee already holds `x` | 4, in 3 files | `ana/no-argument-already-carried`, 24 |
| a `for … of` whose whole body is one conditional `return` — `find` or `some` | 2, both in `case-record.ts` | `ana/prefer-find-over-loop`, 12 |
| a module doc comment pushed below the first import | 0 | already clean, and no catcher written |

Four of the five were refused at one to four sites and then written anyway, which is worth being
precise about rather than quietly reversing. The bar those verdicts applied is the **gating** bar:
a blocking rule costs a file, a test, a place in the gate's runtime and an argument at every site
it reports, and at four sites it cannot pay for that. A report-only catcher costs the file and the
test and nothing else, so the count that has to clear a bar is not the number of sites but the
number of readings the census saves. The lane counts were also low because a lane reads a sample
and a catcher reads the tree: the same four shapes are at 2, 20, 24 and 12 here.

The nine built-in rules the lanes surfaced have all been through the admission test; the verdicts
and their reasoning are in `BASELINE.md`. Four are on — `unicorn/explicit-length-check`,
`no-useless-assignment`, `import/no-duplicates` and `typescript/no-unnecessary-type-assertion`,
the last of which needed the `import` plugin enabled before oxlint would run it. Three are
refused: `unicorn/consistent-function-scoping` at 193 sites asks for the module-level one-caller
helper `ana/no-single-caller-helper` removes, `unicorn/no-useless-undefined` at 96 asks the tree
to stop writing a value it states on purpose, and `import/first` at 81 reports a re-export placed
above the imports, which is a preference and not a defect.

The last three were measured on 2026-09-20 and two of them are on. `unicorn/prefer-array-find`
reports **3**, every one of them `.filter(pred).at(-1)`, so the repair is `findLast` and not the
`find` its message names; `import/no-cycle` reported **15**, of which a single import through a
re-export hop held 13, and both now sit at zero in the gate. `typescript/prefer-optional-chain` is
refused at **35**: it autofixes 11 and leaves 24, and among those 24 the remedy its message names
is wrong wherever the second clause is itself a null test. `BASELINE.md` has all three readings.

Three more the lanes named report nothing on this head, and oxlint ignores an unknown rule name
silently rather than refusing it, so a zero here does not separate "absent from this build" from
"already clean": `typescript/no-unnecessary-type-conversion`, `eslint/no-useless-return` and
`unicorn/prefer-array-some`.

`no-arms-differing-in-one-term` was written, refused and admitted to the census rather than to the
gate, which is the distinction this part exists to draw — and it has since crossed. The refusal was
that the shape it reports is often the clearer of the two spellings, which was a statement about
what it reported at a four-token floor: 26 sites, each needing a reader. The exemption that settled
it is dispatch. A differing token in callee, member, receiver, constructor, element or
assignment-target position is what the line *does*, and hoisting it costs a computed member or an
indirect call — `(kind === "hardlink" ? fs.linkSync : fs.symlinkSync)(alias, selected)` reads worse
than the two arms it replaces and loses the static access a rename can follow. With that and five
smaller exemptions the rule has no site left in this tree, which is the position
`no-inline-schema-literal` already holds: it enters the gate at zero, costs nothing, and keeps the
shape from arriving. It is `error` in `.oxlintrc.json`, off only in the two-tree override that
queue item 13 owns.

Two review lanes returned a DELETE verdict on it, on the reasonable reading that a rule reporting
nothing gates nothing. That reading predates the dispatch measurement, and a lane report is
research rather than evidence, so the deletion was refused here after reading the rule against the
tree. A zero-site rule whose remaining reports would be true positives is the cheapest gate there
is.


### What the simplify record lets a deterministic catcher see — measured 2026-09-21

The question this pass set out to answer was the one behind the whole census: given every
`/simplify` and ponytail commit this repository has recorded, which of their removals could a
rule or a tree scan have named beforehand, at a precision near 0.8, so that the lint fires where
the person would have gone. The answer is measured below, shape by shape, so nobody re-derives
it. Three shapes clear 0.4 — two of them already gates, the third a word in a name — the shipped
scans sit between 0.2 and 0.32, and nothing else tried clears 0.3. What the record removes is
mechanism — a function, a module, a branch the product no longer needs — and
mechanism has no structural signature this side of reading the code.

**The record.** The 241 commits attributed to recorded simplify and ponytail sessions, 239 with
a parent in this clone, 2026-08-02 to 2026-09-20. Production files only (test/ and
`tools/oxlint/` excluded): **50 344 lines removed, 9 871 added**. Each removed hunk was labelled
by hand-checked regex into eleven shapes: function-deleted 213 (139 in `src`, 32 whole files, 20
`tools`, 13 `vendor`, 9 test), block-replaced-by-call 191, literal-to-constant 61,
function-collapsed 51, let-assigned-later-dropped 42, call-argument-dropped 37, export-dropped
30, for-loop-collapsed 22, try-block-collapsed 15, nullish-default-dropped 8,
adjacent-guards-merged 1.

**The scoring.** A catcher ran over every parent tree. A row is a *hit* when the commit's
parent-side hunks cover its line (±2) or the function it points into was touched or removed.
Precision is reported over rows in files the commit touched — the linter's view when the author
is already in the file — and, where a per-visit number understates a shape that the next pass
takes, as the *eventual* rate over unique rows: how many were gone by the end of the record.
Recall is over the labelled rows of the shape the catcher targets.

**The shipped tree scans, per visit.** `P(all)` is over every row tree-wide; `P(file)` over rows
in touched files.

| kind | rows | in touched files | hits | P(all) | P(file) |
| --- | --- | --- | --- | --- | --- |
| identity-without-owner | 11 019 | 165 | 50 | 0.005 | 0.30 |
| duplicate-run | 5 361 | 62 | 20 | 0.004 | 0.32 |
| filesystem-import-budget | 3 427 | 44 | 9 | 0.003 | 0.21 |
| test-only-export | 777 | 29 | 16 | 0.021 | 0.55 |
| unread-field | 604 | 5 | 1 | 0.002 | 0.20 |
| single-reader-export | 1 476 | 1 | 3 | 0.002 | — |
| rule-without-fixture | 2 348 | 0 | 0 | 0 | — |
| superseded-schema-tag | 3 684 | 60 | 11 | 0.003 | 0.18 |
| orphan-module | 5 | 0 | 0 | — | — |
| test-only-module | 8 | 1 | 0 | — | 0 |
| unproduced-set-member | 1 355 | 20 | 3 | 0.002 | 0.15 |

The identity scan's own record (above) is the exception: 0.81 per-value recall against the two
commits that named the shape, because those commits *were* the shape. Against the whole record
it is one row in three.

**`duplicate-run`, the floors swept.** Recall is over block-replaced-by-call, the shape a
duplicate-run scan exists to catch.

| run | substance | sites | P(file) | recall |
| --- | --- | --- | --- | --- |
| 5 | 4 | 10 722 | 0.21 | 5/191 |
| 4 | 4 | 11 676 | 0.18 | 6/191 |
| 4 | 3 | 31 948 | 0.13 | 9/191 |
| 3 | 3 | 37 862 | 0.12 | 11/191 |
| 3 | 2 | 89 124 | 0.07 | 18/191 |
| 6 | 5 | 5 168 | 0.17 | 4/191 |

Lower floors buy recall at a price no census can pay: the sixth row over the fifth is 84 000
more sites for 13 more hits. The 191 blocks a person replaced by a call were mostly *not*
duplicates of anything; they were bodies whose work an existing helper already did in a different
spelling, which is a reading and not a match.

**Every line class removes at the same rate.** 56 regex classes, removed lines of a class over
lines of that class present in the touched files (hunks under 60 lines; 12 735 removed of
333 503 present): `return … ? … : …` 0.071, `while` 0.069, chained `.call(` 0.068,
`if … continue` 0.065, bare call 0.057, `const x = cond ? a : b` 0.054, `.push(` 0.053,
`if … return` 0.052, `const x = f()` 0.050, everything else 0.03–0.048, `let` 0.033,
`if (!existsSync(` 0.034, `?? default` 0.033. The base is 0.038. A rule that fires on a line's
syntactic class fires at the base rate, whatever the class.

**Function deletion by structure.** 8 865 unambiguously named functions in touched production
files across the parents; 317 deleted (0.036), 1 303 touched (0.147). Deletion rate per bucket:
exported 0.04, private 0.03; `lines ≤ 3` 0.07, `≤ 6` 0.06, `≥ 40` 0.02; one production
reference 0.03, two or more 0.03; single `return` 0.05; arrow 0.05; async 0.03; `try/catch`
0.03; three or more guards 0.03; pass-through body (`return f(...args)`) 0.07 (n = 46); ternary
return 0.07; four or more parameters 0.03. Name prefix `is`/`has` 0.05, `ensure`/`assert`/
`validate` 0.03, `get`/`read`/`load` 0.02, `maybe`/`try`/`safe` 0.06; suffix `Of`/`Or`/`Fallback`
0.05. Two buckets stand out and both are known: *exported with no production reference* 0.29
per visit (n = 90), 0.44 with no test call either (n = 25), which is the `unused-export` gate's
shape; and a name containing `Legacy` or `Compat` 0.24 (n = 29).

By reader class, eventual over unique functions: exported and read by no other file 0.18
(n = 113); read by one test file only 0.19 (n = 149); by one production file 0.09 (n = 447); by
one production and one test file 0.07; by more 0.05; private 0.08 (n = 2 174). The
`test-only-export` scan's 0.55 per visit is the same shape scored by file, not by function.

**Constant-argument parameters.** A parameter every production call passes as the same literal,
or always omits: 11 809 rows over the record, 168 in touched files, the function touched 0.21,
the parameter gone 0.12; eventual per unique parameter 20/75 = 0.27; recall over
call-argument-dropped 1/8. No sub-bucket (omitted or literal, tests vary or agree, no tests)
reaches 0.24. Refused.

**The lexicon.** Removal rate of a production line by word, against the 0.039 base: `migrat`
0.275, `compat` 0.185, `legacy` 0.156, `safeguard`/`old`/`hint`/`fallback` about 0.08, every
other word tried (`deprecated`, `previous`, `historic`, `shim`, `todo`, `bounded`, `advisory`,
`console`, `process.env`, `as` casts, `!` assertions, `typeof` guards, optional fields and
parameters, boolean flags, string unions) at or under 1.5×. Declarations named with
`legacy|compat|migrat|deprecat` in touched files: 43 unique, 19 gone at the child, 0.44 per visit.
That is a census lead, not a rule: two of every five, and the word is already the reason the
author wrote the declaration.

**Whole-module deletion.** 76 production modules were deleted outright; 41 had exactly one
production importer at the parent, which reads like "fold the module into its reader" until the
denominator arrives: 422 unique modules had one importer somewhere in the record and 53 were
deleted, **0.13** eventual against 0.09 for every module. Size (≤ 40 lines 0.14), export count
(one export 0.09) and test importers move nothing. The deleted single-importer modules ran from
4 lines to 473; the big ones were mechanisms leaving, the small ones were inlined, and the
importer count does not tell them apart.

**`let` assigned later.** 42 rows; 14 are `let x: T; try { x = … } catch { return … }`, the
declaration hoisted above a `try` so its value survives the block. Read at the child: 6 went with
their whole function or branch, 5 moved into a helper that owns the `try` (`directories()`
returning `[]` when `readdirSync` throws, `withVerifierLifetime(lifetime, fn)` twice,
`startCallbackServer(...)`, `open(args)`), 2 lost the `catch` outright and 1 lost the mechanism
it guarded. The syntactic shape is real and a rule could name every site; the remedy it could
name — a helper returning the value or the fallback — was the person's answer 5 times in 14.

**Two micro shapes.** `const x = …; return x;` does not occur in any touched parent file and once in the whole head, so there is nothing to catch. `${String(x)}` inside a template: 229 present in touched files, 25 removed, 0.11 — three times the line base and nowhere near a rule.

**`identity-without-owner`, five ways.** The question was whether a different reading of the
same rows reaches 0.7, since the scan itself sits at 0.30 per visit. Five were tried on the 165
rows in touched files, each scored on the line being inside a hunk and on the *remedy* — the
literal's count in that file going down at the child.

1. *Feature buckets* over the row: schema tag 0.53 hit, 0.27 remedy (n = 15); four or more rows
   in one file 0.47 / 0.24 (n = 17); a line under a day old 0.41 / 0.17 (n = 29); an existing
   owner constant makes no difference (0.27 against 0.28 without). Overall 0.28 / 0.10.
2. *Per identity instead of per row*, one unit per commit and literal: 0.28 / 0.10, the same.
3. *Eventual per (file, literal)* by the record head: 42 of 84 gone (0.50), of which 18 with the
   whole file; 26 of 66 (0.39) with the file still there. Of those 26, 20 went because the
   mechanism around them was retired, 5 moved or were renamed, and 1 was consolidated into a
   constant — the scan's own remedy, applied once in 239 commits.
4. *A time split* over the eventual buckets: every bucket at or over 0.7 on the first half of the
   record (to 2026-09-08) collapses on the second — schema tag 0.80 → 0.57, line 7–30 days old
   0.74 → 0.54, no slash in the name 0.86 → 0.30, eight files or fewer outside a skill 0.78 →
   0.34. The early sites have simply had longer to go; the buckets are censoring, not signal.
5. *A sub-shape the record does retire*: a versioned tag spelled after a higher version exists.
   That one is the `superseded-schema-tag` row in the table above and the paragraph below.

So no reading of the identity rows reaches 0.7 out of sample. The scan stays a census row at 0.30
per visit, and its record is what it was: two commits that were the shape, and one row in three
elsewhere.

**`superseded-schema-tag`.** 51 sites over the record, per file and tag: 37 gone by the record
head (0.73; 0.51 with the file still there), 13 removed by a simplify commit, and 13 of the 27
whose file a simplify commit ever touched went with that commit (0.48). Per visit it is 11 of 60
(0.18), because a readable set such as `judge-reviews/v6..v9` is touched many times and survives
each. Exempting a site whose own line spells the latest drops the simplify-removed count from 13
to 6 — `v1 || v2` collapsing to `v2` is exactly the move — so nothing is exempted; tests are left
out, because a fixture holding an old row is the migration's proof. The eventual rate is carried by
the early sites (35 of 47 first seen before 2026-09-09; 2 of the 4 since), which is the same
censoring as tactic 4 above, but this shape has a mechanism the identity rows lack: the writer
moves, the reader lags, and the archive ages out. It is shipped as a census row on that mechanism
and on what it found at 25fb05f74 — two readers the writer left behind, `rebuild-advice/v1` in
current-readers.mjs (the `v2` has been written since f5dfb86a1) and `outcome-snapshot-status/v1`
in select-best-runs.mjs (trace-review.mjs writes `v2`) — not on a 0.7 it does not reach per visit.
Nine rows at head: those two, the readable sets in trace-capture.ts, trace-challenge.mjs and
judge.ts, the type unions in runtime-model-identity.ts and judge-contract.ts, session-transcript's
two writers and builder-tools' named old schema.

**`unproduced-set-member`.** A member of a literal union — a `type` alias or a property's
`"a" | "b"` — that no production file spells on a code line outside its declaration. 16 union and
9 property members at the parents of the 239 commits, comment lines not counted as spellings:
19 of the 25 gone or produced by the record head (0.76; 18 removed, 1 given a producer; 10 of 12
first seen before 2026-09-09, 9 of 13 since), six of the sixteen the members of two difficulty
vocabularies that left with the difficulty path. Simplify itself removed 3 of 20 per visit and 3
of the 8 sites in a file it touched, all three members of one `kind` vocabulary in
src/truth/brief.ts that one commit took at once; the base rate of a produced member in a touched
file is 0.05 for a union and 0.08 for a property. `as const` arrays scored 109 sites at 0.52
eventual and 3 of 139 per visit and are left out: what they hold — bubblewrap paths, JSON-schema
keys, package.json fields — is another program's vocabulary, listed here and produced elsewhere.
Shipped as a census row on the eventual rate and on the six rows standing at 25fb05f74: three
`SessionBuildStage` members no file produces; `plan-exhausted`, a lineage reason AGENTS.md rule 7
still names and `src/run/admission.ts` never writes; `deterministic` of `EvaluatorIndependence` and
`syntax` of `Altitude`, each named in its module's header and produced nowhere. The last two
appeared only once comment lines stopped counting, which is the reading the scan keeps: a comment
names a value, it does not produce one.

**`orphan-module` and `test-only-module`.** A code file under a source root that no file
imports, spawns or names, and a production module whose only readers are tests. Readers are the
whole tree — code, prose, `package.json`, hooks, workflows, SKILL.md lines — with a relative
import resolved and any other spelling of the path or bare basename matched by suffix; a comment
line in code does not count, and a test is not a candidate. The record has no per-visit rate to
give: over 117 sampled first-parent revisions of main, 2026-07-27 to 2026-09-20, the tree held
five orphans and eight test-only modules in all, no simplify commit ever met an orphan, and the
one that touched a test-only module left it standing. What it gives is the eventual rate. Orphan:
5 of 5 resolved by the record head ee766c7e2 (4 deleted, 1 given a reader). Test-only: 6 of 8 (4
deleted, 1 given its production caller, 1 given the SKILL.md line that runs it); the two open
were `src/meta/assert.ts`, imported by four skill tests, and
`src/solve/public-artifact-schema-degeneracy.ts`, imported by two, and this branch has since
deleted the second and named the first in `require-meta-runtime-import`. The base the rates stand
against is the same revisions' deletion rate for a module with one production reader, 0.34, and
with more, 0.28. At five and eight sites the 95% Wilson lower bounds are 0.57 and 0.41; it is the
point estimates that clear 0.6, and the scan is admitted on them and on what a row is — a file
whose reader a person can look for and fail to find — rather than on an interval the sample is
too small to hold. A prose-only module (40 at head, read by a SKILL.md line and nothing else) is
not a kind: it is the shape of every skill script and the record does not remove it. At the
branch head the scan writes no row.

**What this settles.** The union of every rule in the gate, replayed over the parents, flags
touched functions at precision 0.27 and recall 0.39; the base rate is 0.147. The ceiling is not
the rules, it is the record: the dominant removal is a mechanism whose only signature is that the
product stopped needing it, and the structural shapes that *do* predict removal — an export no
other file reads, a value read by tests alone, a name that says `legacy` — are already gates or
census rows. The queue therefore does not carry a "catch simplify at 0.8" item. It carries the
shapes at 0.2–0.55 where they are, in the census, reported once per head and read by a person,
and it treats the next labelled shape that clears 0.6 on this record as the bar for a new scan;
`superseded-schema-tag` and `unproduced-set-member` clear it only as eventual rates and were
admitted on their mechanism and the live defects they found, and `orphan-module` and
`test-only-module` clear it as eventual point estimates at five and eight sites, which the
paragraphs above say plainly. The scripts that produced these numbers are one-off scratch and were not kept; the method above
is enough to reproduce them from `git log --grep=simplify`.

### `copied-block` replaces `duplicate-run`, and a commit reads it — 2026-09-21

**What it is.** `tools/oxlint/tree-copied-block.ts` parses every source file and reads each named
function as a host. A window of up to six consecutive statements is spelled with the names that
host binds and every literal each counted as one token. Imported and module-level names keep their
spelling. Windows with one spelling are one class, taken largest first and grown over every
statement their places still share. A class is reported when it has at least two statements, 64
tokens and three lines at every place, and two or more places that meet all of these:

- the places lie under the authored roots and in the one package holding most of them;
- no place is in a test, fixture, example, template or vendored file;
- no place is in a file marked generated or unchecked;
- the places do not print different words (a table);
- the places are not spread across four or more parallel implementations.

`duplicate-run`, the line-based scan it replaces, was at 0.32 per visit in the table above.

**How it was measured.** The simplify record cannot score this shape. Of 618 simplify strikes
anchored to a line, 26 fall in a file holding a place and 2 overlap one, where chance gives 1.5
(lift 1.29). That is the finding above: the record removes mechanism, and a copy is not what it
removes. The label is a blind judge instead. Eight Opus judges per round are asked "should this get
one owner?" under one instruction file and read each site at its own revision. The judge was
calibrated on rows the operator had answered: 7 of 7 answered no were judged no, and 7 of 13
answered yes were judged yes, so a judge's yes understates the operator's. Items are drawn by seed
from each rule's own report, and intervals are 95% Wilson. Every rule was frozen by digest, and
every prediction was written before its set was cloned or drawn. A rule changed after its verdicts
were read needed a fresh set.

**This repository, where the figure that decides is taken.** The census uses the frozen rule
(v8 below) over every 40th first-parent commit of main since 2026-07-15: 25 revisions and 71
distinct sites. 49 of them carried an earlier verdict. The other 22 were judged fresh.

- The fresh 22: 14 yes, 0.64 (0.43–0.80).
- The whole census: 51 of 71, 0.72 (0.60–0.81).
- The prediction was 0.70 (0.50–0.85) for the fresh 22 and 0.74 for the census.
- The pre-registered local bar was a census point of at least 0.6 with the fresh sites not below
  0.5. It is met.
- Earlier versions of the lineage read 24 of 32 and 25 of 32 on holdouts here, and 35 of 49 over
  never-judged files.

Two shapes account for six of the eight fresh no answers, and neither became a condition. Both
would be fitted on these verdicts, and the second also holds earlier yes answers:

- a frozen legacy validator beside its successor (two);
- two short adjacent branches of one function (four).

**Other TypeScript projects, where it is weaker.** Seven sets of foreign repositories were used,
each judged for a maintainer: one for development and six pre-registered holdouts. On each holdout
the shipped rule of the day read 0.25, 0.41, 0.31, 0.44, 0.28 and 0.28, the last on tldraw,
vercel/ai, vueuse and prisma. v4 pooled over the four sets it had not seen is 42 of 128 (0.33). Those projects
keep copies on purpose: a compiler visitor per node, an SDK package per framework, a driver per
database. A judge's guess at a stranger's taste is an opinion, not a label. The 0.6 bar was never
met abroad, and nothing here claims it.

**What was tried and not kept.** An ablation over all 363 judged sites counted what each condition
alone removed among items every other v4 condition keeps. On fresh sets:

| Condition | Yes removed | No removed |
| --- | --- | --- |
| Example and template paths | 1 | 12 |
| One package | 0 | 3 |
| v6's score | 0 | 7 |
| Token floor | 3 | 8 |

- **v5** added the path and package conditions and read 0.41 against v4's 0.44 on the fifth set.
- **v6** was a logistic score over forty features fitted on five sets. It read 0.31 on the sixth
  and 0.22 on the seventh.
- **v7** replaced v6 with "some literal differs and no loop runs". It read 0.22 on the seventh
  set, and here it cost 18 yes answers against 8 no.

**v8** is v4 plus the parts that removed only no answers on fresh data and cost nothing here:
example and template paths frozen, Deno's `_test.` spelling, the one-package condition, and the
family scan counting source files only. On the 81 judged development sites here v8 equals v4,
62 of 81, because none of its conditions fires on them. The plan, the frozen digests and every
verdict lived in the session's scratch directory; this section is their summary.

**The pre-commit report.** `.githooks/pre-commit` runs `tools/oxlint/staged-slop.ts` after the
linter. It reads the whole-tree scans in about two seconds and keeps the sites with a place on a
line the commit changes against HEAD. For each site it prints a number, the shape, the place, the
detail and a twelve-character id.

The whole report goes to `ana/slop-report.md` under the worktree's git directory, where it is
never committed. It holds each site's places, its shape's argument and the command that answers it.

**The not-slop ledger.** `tools/oxlint/not-slop.tsv` holds every finding a reader judged and
answered no, for both halves of the cleaner: the whole-tree scans and the report-only `ana` and
`anti-slop` rules. It is tab-separated under the header `id rule path answered reason excerpt`,
one sorted row per site, and `.gitattributes` merges it by union, so two branches answering two
sites never conflict. The vocabulary is SARIF's external suppression: a fingerprint, the rule, the
location and a justification, with the date and an excerpt of the hashed text so a row reads
without opening the file.

The id hashes the rule and the path and whitespace-collapsed text of every place the site spans:
for a lint finding, the line the span starts on and the span's first line; for a whole-tree site,
every copy. Lines moving above a site keep its id. An edit to any place gives a new id and brings
the site back for a fresh answer. The first ledger hashed the first place alone, so an answered
copy kept its answer after its second copy changed.

`bun run not-slop -- answer <id> "<reason>"` writes a row for an id the last `bun run lint` or the
whole-tree scans printed. It refuses a reason under three words, a register kind, a core rule
(its exception stays an inline comment with the reason) and a rule with a fixer, whose wrong report
is a defect in the rule (`FIXER-DECISIONS.md`). `bun run lint`, `bun run simplify` and the report
drop every answered site. A row no finding bears out fails `bun run lint`, as an unused disable
comment does, and `bun run not-slop -- prune` removes it.

An inline `oxlint-disable` naming an `ana/` or `anti-slop/` rule is refused by
`ana/no-inline-slop-answer`. The comment was the weaker store: it survives an edit to the line it
excuses, and thirty-one of the forty in the tree on 2026-09-21 gave no reason on the directive. The
migration fixed eleven of the forty, conditional empty-object spreads that `src/meta/optional-key.ts`
already owned, and answered the other twenty-nine in thirty-one rows, since two directives each
silenced two findings.

The step never refuses a commit, and a scan that fails prints one line. That follows the refusal
above: `--no-verify` is refused by the command guard, so a false positive at commit time must not
strand a checkpoint. A heuristic at 0.72 may report and must not block.

### Census precision per shape, judged blind — 2026-09-24

Measured with the `simplify-precision` skill. The current scans were replayed over 31 revisions of
this repository and 9 of anabasis, and seeded samples went to blind Opus 5.5 judges, 10 sites to a
packet, asked whether they would make the change the census proposes.

The first round was judged under a stale AGENTS.md. It read "historical evidence stays readable",
not the no-backwards-compatibility decision, and gave 40 of 145 (0.28). Re-judged on the same sites
with origin/main's rules and each shape's census argument in the packet (round 1b), it gave 94 of
144 (0.65, 95% Wilson 0.57–0.73). The instrument moved that figure, not the scans.

Three narrowings came from the round-1b no answers, each with a fixture on both sides:

| scan | condition | round-1b sites dropped |
| --- | --- | --- |
| single-reader-export | the reader stays under 560 nonblank lines after absorbing the helper | 11 (yes 3, no 5) |
| test-only-module | a script run through `"$ROOT/…"` or an absolute path is read | 4 (yes 0, no 4) |
| copied-block | a place in a file its name marks as legacy goes with that file | 7 (yes 0, no 3) |

The one test-only-module yes it also dropped (prose-classify.mjs at c4ac6003f) was a judging error:
SKILL.md ran it through `$CLASSIFIER/` at that revision. The test-only-export argument now names
the form all 7 of its no answers asked for: drop the wrapper and point its tests at the live
function.

**Holdout, rule frozen at 8721d4ecc, 58 sites no judge had read: 46 yes (0.79, 0.67–0.88).** The
prediction written beforehand was 0.65 to 0.75.

| shape | yes/n |
| --- | --- |
| compatibility-path | 11/12 |
| superseded-schema-tag | 11/12 |
| copied-block | 9/12 |
| identity-without-owner | 9/12 |
| single-reader-export | 3/7 |
| test-only-export | 2/2 |
| unproduced-set-member | 1/1 |

Still open: single-reader-export. Three of its four no answers call the file a cohesive module
with private helpers of its own, and the fourth is a five-line policy function. A condition on
private top-level declarations would separate them. It was shaped on this holdout, so it needs new
sites before it counts. The unread-field, orphan-module, test-only-module and rule-without-fixture
scans had no unjudged sites left in the replay.
