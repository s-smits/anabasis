# Which rules fix, and which only report

Every `ana` and `anti-slop` rule gates at `error`. **Ten carry an autofixer; the rest intentionally report without fixing.**

## Criteria for an autofixer

A fixer must satisfy all four conditions:
1. **Mechanical fact, not design judgement**: one canonical rewrite visible to the rule (no guessing names or contracts).
2. **Wrong fixes fail loudly at the edited line**: compiler errors are acceptable; silent type widening or semantic drift is disqualifying.
3. **Matches established repository idiom**: verified empirically on the tree.
4. **Preserves the prompt for real repair**: never silence a rule while leaving the underlying smell unaddressed (e.g. hoisting an unnamed table or swapping `setTimeout` for `Bun.sleep(50)`).

## The ten rules that fix

| Rule | Automated edit | Why mechanical |
| --- | --- | --- |
| `no-hand-rolled-error-render` | routes through `errorMessage` / `asError` | single existing owners |
| `no-renaming-temporary` | inlines expression at sole read | pure alias substitution |
| `no-repeated-string-literal` | extracts literal (**test files only**) | test fixtures are file-local; source ownership is a design choice |
| `prefer-const-conditional` | `let` + `if` → `const` ternary / `??` | single init, single branch, no later writes |
| `prefer-find-over-loop` | loop → `find` / `some` / `every` | single conditional return determines method |
| `prefer-key-if-defined` | guarded assignment → `...keyIfDefined("k", v)` | pure read into existing owner |
| `prefer-subpath-import` | relative climb → `#src/...` alias | resolved directly from `package.json` |
| `require-captured-json-runtime` | imports and calls `capturedJsonParse` | single owner and name |
| `require-declarations-first` | hoists types/consts above functions | pure reordering |
| `require-meta-runtime-import` | redirects 7 `node:` builtins to `src/meta` | one-to-one wrappers only |

## Five borderline rules (withheld by policy)

Reversing any of these requires explicit rationale:

| Rule | Feasible edit | Why withheld |
| --- | --- | --- |
| `no-inline-schema-literal` | hoist literal to module scope | hoisting is the moment to name and document the table (criterion 4) |
| `no-single-caller-helper` | inline body at call site | ~300-site prototype yielded unreadable inline expressions |
| `require-safety-comment-for-type-assertion` | insert placeholder `SAFETY:` | defeats verifying the invariant |
| `no-conditional-empty-object-spread` | emit `null` property | omission vs `null` is a contract choice |
| `no-alias-restating-return` | inline return type, delete alias | feasible, not yet motivated by site count |

## Report-only rules (context unavailable per file)

Each states `no fix` in its source (`test/lint-registry.test.ts` enforces this):

- **Type design (8)**: `no-unproven-unknown-parameter`, `no-unknown-returns`, `no-unknown-type-aliases`, `no-unsafe-dictionary-type`, `no-known-value-widening`, `no-widen-then-assert`, `no-chained-type-assertions`, `no-runtime-typeof`.
- **Naming (3)**: `no-thrice-spelled-object`, `no-shape-in-symbol-names`, `no-positional-boolean-parameter`.
- **Structural judgement (10)**: `no-comments`, `no-deep-nesting`, `no-tangled-ternary`, `no-inline-block-reducer`, `no-side-effect-in-predicate`, `no-arms-differing-in-one-term`, `no-hand-rolled-sleep`, `no-single-use-const-chain`, `no-hand-read-argv`, `no-react-effect`.
- **Cross-file changes (5)**: `no-pass-through-wrapper`, `no-lifetime-outside-owner`, `no-module-mocking`, `no-object-parameters`, `no-inline-slop-answer`.
- **Semantic ambiguity (2)**: `no-transposed-argument`, `no-hand-spelled-git`.

## Implicit-state rules (repair is choosing an owner)

- `implicit-state` (`no-coupled-flags`, `no-marker-file-state`, `no-age-based-lock`) and `implicit-state-opinionated` (`max-boolean-fields`, `prefer-state-union`, `no-state-in-names`): choosing the typed state space, owning module or record field violates criterion 1.

## Fixable findings cannot use the ledger

Report-only false positives may be answered once in `tools/oxlint/not-slop.tsv`. Fixable rules are rejected by `bun run not-slop` and `bun run lint`: because `--fix` ignores the ledger, any false positive is a bug in the rule itself.
