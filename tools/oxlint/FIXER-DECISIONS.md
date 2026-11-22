# Which rules fix, and which only report

Every `ana` and `anti-slop` rule is registered at `error`. **Ten carry an autofixer; the remainder report diagnostics and leave the repair to the author.**

This boundary is a deliberate design choice rather than an unfinished backlog. This document defines the four criteria a fixer must satisfy before shipping, lists the ten rules that meet them, and explains why several borderline rules intentionally withhold autofixing. Each rule's head comment summarises its rationale in one sentence; this file records the shared argument so future rule authors do not re-derive it or ship fixers that undermine the ruleset.

## Criteria for an autofixer

A fixer must satisfy all four conditions.

1. **The repair is a mechanical fact rather than a design decision.** Replacing a `let` immediately assigned in an `if` with a `const` conditional has a single canonical answer visible to the rule. Choosing a descriptive name for a hoisted table is a design decision. A fixer that guesses produces mediocre code everywhere, which is worse than reporting because clean-linting lines rarely receive follow-up edits.

2. **An incorrect fix fails loudly at the edited line.** Both `require-captured-json-runtime` and `require-meta-runtime-import` emit imports that may reference an unexported member. This is acceptable because a missing member produces an immediate compiler error pointing to the exact line written by the fixer. By contrast, a fixer that deletes a type annotation to rely on inference is inadmissible: a silently widened inferred type still compiles. Silent degradation, rather than risk itself, is the disqualifier.

3. **The rewritten form matches the codebase's established idiom.** This is measured empirically against the repository tree rather than personal preference; an autofixer should never impose a style the codebase does not already use.

4. **The fix must preserve the prompt for the actual repair.** A silenced diagnostic looks like a resolved issue. `no-inline-schema-literal` illustrates this clearly: hoisting the literal is mechanical, yet hoisting is also the sole occasion on which the author will name and document the table. An automated hoist leaves an uncommented `const strings` at module scope while silencing the rule.

## The ten rules that fix

| Rule | Automated edit | Why it is a mechanical fact |
| --- | --- | --- |
| `no-hand-rolled-error-render` | routes caught values through `errorMessage` / `asError` | those two helpers already own the behaviour |
| `no-renaming-temporary` | substitutes the expression at its single read site | a `const` read once that only aliases an expression is identical to that expression |
| `no-repeated-string-literal` | extracts the repeated literal once, **in test files only** | see below; source files are deliberately excluded |
| `prefer-const-conditional` | rewrites `let` plus `if` into `const` plus conditional | single initialiser, single branch, no further writes |
| `prefer-find-over-loop` | rewrites the loop into `find`, `some` or `every` | the body is a single conditional return whose return value uniquely determines the method |
| `prefer-key-if-defined` | moves `if (v !== undefined) o.k = v;` statements below `const o = {...}` into `...keyIfDefined("k", v)` inside the literal | `src/meta/optional-key.ts` already owns the pattern, and the value is a pure read so evaluation order is unchanged |
| `prefer-subpath-import` | rewrites `../../../../src/x.ts` to `#src/x.ts` | the alias is resolved from the nearest `package.json`, naming the identical file and never writing an unmapped key |
| `require-captured-json-runtime` | imports and calls `capturedJsonParse` | single owner, single name |
| `require-declarations-first` | hoists type, interface and constant declarations above the first function | reorders declarations without modifying their contents |
| `require-meta-runtime-import` | redirects a `node:` import to its `src/meta` wrapper | restricted to seven builtins with a one-to-one wrapper; ambiguous builtins are excluded |

`no-repeated-string-literal` deliberately fixes only half of its findings. In test files, a file-local constant is the right scope because fixtures belong to the test suite that defines them. In production source files, deciding which module owns the constant is the core design question, and an autofixer would always default to a file-local constant. Accordingly, the fixer runs exclusively in test files.

## Borderline rules: five where a fixer is feasible but withheld

For each rule below, a mechanical edit is straightforward, yet autofixing is withheld by judgement. Anyone adding a fixer for these rules is reversing a deliberate policy and should state the rationale explicitly.

| Rule | Feasible edit | Reason for refusal |
| --- | --- | --- |
| `no-inline-schema-literal` | hoist the literal to module scope | naming and documenting the table is the point of the refactor, and hoisting is the only moment that prompts it (criterion 4) |
| `no-single-caller-helper` | substitute arguments into the single-`return` body | prototyped and discarded: across roughly three hundred sites it produced unwieldy inline expressions where the author intended a clear statement |
| `require-safety-comment-for-type-assertion` | insert a placeholder `SAFETY:` comment | the explanation of the verified invariant is the entire requirement; a generated comment satisfies the rule while verifying nothing |
| `no-conditional-empty-object-spread` | emit the property with value `null` | whether a field is omitted or present-and-null is a contract decision that the spread obscured |
| `no-alias-restating-return` | inline the alias body as the return annotation and delete the alias | unimplemented rather than formally refused; inlining preserves the type cleanly, and no site has yet motivated building it |

## Report-only rules: where the rule lacks information to repair

In every rule below, choosing the correct repair requires context unavailable to a per-file syntax rule. Each rule states this explicitly in its head comment, and `test/lint-registry.test.ts` rejects any rule that neither declares `fixable` nor documents why it does not fix.

- **The repair requires type design** (8): `no-unproven-unknown-parameter`, `no-unknown-returns`, `no-unknown-type-aliases`, `no-unsafe-dictionary-type`, `no-known-value-widening`, `no-widen-then-assert`, `no-chained-type-assertions`, `no-runtime-typeof`. The `unknown` or widened type is precisely the specification work that was deferred, and plugin rules do not query the TypeScript type checker for synthesis.
- **The repair requires naming** (3): `no-thrice-spelled-object`, `no-shape-in-symbol-names`, `no-positional-boolean-parameter`. Selecting the domain terms for two states or naming an extracted helper is the substantive change.
- **The repair requires structural judgement** (9): `no-deep-nesting`, `no-tangled-ternary`, `no-inline-block-reducer`, `no-side-effect-in-predicate`, `no-arms-differing-in-one-term`, `no-hand-rolled-sleep`, `no-single-use-const-chain`, `no-hand-read-argv`, `no-react-effect`. Each admits multiple valid refactors (such as an early-return guard versus helper extraction, a loop versus a pipeline, an event wait versus an explicit clock, or derived render state versus a keyed reset, handler or store subscription), and selecting among them requires reading the intent.
- **The repair spans multiple files** (5): `no-pass-through-wrapper`, `no-lifetime-outside-owner`, `no-module-mocking`, `no-object-parameters`, `no-inline-slop-answer`. Removing a wrapper requires updating every call site; consolidating process termination touches two modules; replacing a mock requires injecting an interface into the code under test; defining an options interface changes every caller's contract; moving an inline suppression into `not-slop.tsv` requires an identifier computed by a lint run. A single-file fixer cannot safely perform any of these.
- **The repair alters semantics the rule can only question** (2): `no-transposed-argument` and `no-hand-spelled-git`. Determining which of two swapped arguments is wrong requires caller intent. Likewise, a hand-rolled git invocation maps to three distinct `src/meta/git.ts` helpers (raw bytes, trimmed text, or nullable output), and invocations reading exit status or passing `cwd` require interpreting what the caller expects.

`no-hand-rolled-sleep` exemplifies a deceptive fixer. Automatically rewriting `setTimeout` promises to `Bun.sleep` would match codebase conventions and satisfy criterion 3, yet it fails criterion 4: `Bun.sleep(50)` retains the same arbitrary polling delay while silencing the rule that prompted replacing it with a real condition wait.

A diagnostic without an autofixer is the normal and intended outcome: the linter identifies the defect precisely and leaves the design judgement to the author.

## Implicit-state rules: the repair is an owner

`implicit-state` (`no-coupled-flags`, `no-marker-file-state`, `no-age-based-lock`) reports diagnostics without autofixing, as stated in each rule's head comment. Every finding identifies state lacking a single typed owner: a discriminated union behind coupled flags, a phase record behind marker files, or a process handle behind an age-based lock. Determining the exact state space and owning module is a design decision inaccessible from syntax alone, violating criterion 1.

`implicit-state-opinionated` (`max-boolean-fields`, `prefer-state-union`, `no-state-in-names`) withholds autofixing for the same reason, reinforced by the fact that its rules encode repository-specific architectural conventions. Deciding which record field should store an attribute previously encoded in a string name is a design choice.

## Fixable findings cannot be suppressed in the ledger

A false positive from a report-only rule may be suppressed once in `tools/oxlint/not-slop.tsv` with a verifiable justification, after which all diagnostic readers ignore it. Findings from the ten fixable rules are ineligible for ledger suppression: both `bun run not-slop` and `bun run lint` reject ledger rows naming a fixable rule. Because `--fix` rewrites matching sites regardless of the ledger, a false positive from a fixable rule is a bug in the rule itself and must be fixed in the rule's source. This is the converse of criterion 1: a mechanical fact has no site-specific exceptions.
