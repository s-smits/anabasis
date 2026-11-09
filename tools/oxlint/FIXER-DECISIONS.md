# Which rules fix, and which only report

Thirty-eight rules are registered: twenty-eight `ana` and ten `anti-slop`, every one of them
`error`. **Ten carry a fixer. Twenty-eight report and leave the repair to the author.**

That split is not an accident of effort, and it is not a backlog. This file says what a fixer has
to be true of before it ships, which rules pass that test, and which ones sit right on the edge and
are refused on purpose. Each rule's own doc comment carries its reason in one sentence; this file is
the argument they share, so the next rule author does not re-derive it and does not ship the fixer
that makes the ruleset unenforceable.

## The test a fixer has to pass

All four, not three.

1. **The repair is a fact, not a decision.** A `let` the next `if` decides is a `const` and a
   conditional: there is one answer and the rule can see it. What a hoisted table should be
   *called* is a decision. A fixer that decides writes the median answer everywhere, which is worse
   than no answer, because nobody comes back to a line that lints clean.

2. **A wrong fix fails loudly, at the line the fix wrote.** `require-captured-json-runtime` and
   `require-meta-runtime-import` both write an import that might be missing a member. That is
   admissible because the miss is a compile error naming the member and the module, on the line
   the fixer just wrote. A fix that deleted an annotation and let the return infer would not be:
   an inferred type that is quietly wider than the annotated one compiles. Silence is the
   disqualifier, not risk.

3. **The fixed form is the form the repository already writes.** Measured against the tree, not
   against taste. A fixer is the fastest way to push a house style the house does not have.

4. **The fix must not remove the occasion for the repair the report was asking for.** A rule that
   stops reporting looks like a rule that worked. `no-inline-schema-literal` is the clean case:
   hoisting the literal is mechanical, and hoisting it is also the only moment anyone will name the
   table for what it holds. A mechanical hoist leaves `const strings` at module scope, uncommented,
   and silences the rule.

## The ten that fix

| rule | the edit | why it is a fact |
| --- | --- | --- |
| `declarations-before-the-first-function` | moves type, interface and const declarations above the first function | order, not content; the declaration text is untouched |
| `no-hand-rolled-error-render` | routes a caught value through `errorMessage` / `asError` | those two own the decision already |
| `no-renaming-temporary` | substitutes the expression at the one read | a const read once and only renaming is the expression |
| `no-repeated-string-literal` | names the repeat once, **in test files only** | see below; the source half is deliberately refused |
| `prefer-const-conditional` | `let` plus `if` becomes `const` plus conditional | one initialiser, one branch, no other write |
| `prefer-find-over-loop` | the loop becomes `find`, `some` or `every` | the body is one conditional return; which of the three follows from what it returns |
| `prefer-key-if-defined` | a run of `if (v !== undefined) o.k = v;` below `const o = {…}` becomes `...keyIfDefined("k", v)` inside the literal | `src/meta/optional-key.ts` already owns the fold; the value is a pure read, so moving it into the literal moves no evaluation |
| `prefer-subpath-import` | `../../../../src/x.ts` becomes `#src/x.ts` | the alias is read off the nearest `package.json`, so it names the same file and a key it does not map is never written |
| `require-captured-json-runtime` | imports `capturedJsonParse` and calls it | one owner, one name |
| `require-meta-runtime-import` | moves a `node:` import onto the `src/meta` module that wraps it | a table of seven builtins with exactly one wrapper each; anything ambiguous is absent from it |

`no-repeated-string-literal` fixes half of its own findings on purpose. In a test file the local
constant *is* the answer: the fixture belongs to the suite that spells it. In a source file, where
the constant belongs is the whole question, and a fixer would answer it with a local one every
time. So the fixer runs in tests and nowhere else.

## On the bridge: five where the edit is available and refused

In every case a fixer is mechanically within reach and the refusal is a judgement. An author who
writes one of these is reversing a decision, and should say so.

| rule | the edit that exists | why it is refused |
| --- | --- | --- |
| `no-inline-schema-literal` | hoist the literal to module scope | the rename and the sentence are the value, and the hoist is the only occasion for them; condition 4 |
| `no-single-caller-helper` | substitute the arguments into the one-`return` body | written and thrown away: at three hundred sites it produced a longer expression where the author wanted a statement, the shape the rule exists to remove |
| `require-safety-comment-for-type-assertion` | insert a `SAFETY:` comment | the comment's content is the entire requirement; a generated one satisfies the rule and proves nothing |
| `no-conditional-empty-object-spread` | emit the field as `null` | absent or present-and-null is the contract, and the spread is where that decision was avoided |
| `no-alias-restating-return` | write the alias's body as the annotation and delete the alias | not written yet rather than refused; the inline edit keeps the type, and no site has asked for it |

## The rest: twenty-three where the rule does not hold the repair

In each of these the missing piece is information the rule has no access to, and every one says
so in its own doc comment: `test/oxlint-rule-contract.test.ts` refuses a rule that neither declares
`fixable` nor writes the words.

- **The repair is a type** (8): `unproven-unknown-parameter`, `no-unknown-returns`,
  `no-unknown-type-aliases`, `no-unsafe-dictionary-type`, `no-known-value-widening`,
  `no-widen-then-assert`, `no-chained-type-assertions`, `no-runtime-typeof`. The `unknown` or the widening is exactly the work someone avoided; writing
  it is the finding. A plugin rule does not read the checker.
- **The repair is a name** (3): `no-thrice-spelled-object`, `no-shape-in-symbol-names`,
  `no-positional-boolean-parameter`. Which two words name the states, or what the extracted
  function is called, is the change.
- **The repair is a structure the rule cannot choose** (9): `no-deep-nesting`,
  `no-tangled-ternary`, `no-inline-block-reducer`, `no-side-effect-in-predicate`,
  `no-arms-differing-in-one-term`, `no-hand-rolled-sleep`, `no-single-use-const-chain`,
  `no-hand-read-argv`, `no-react-effect`. Each offers two or three correct answers (a guard clause
  or an extraction, a mutating accumulator or a pipeline, one of the two exact waits or an admitted
  real clock, a render, a `key`, a handler or a subscription), and which one a site wants is the
  reading.
- **The repair reaches other files** (5): `no-pass-through-wrapper`, `no-lifetime-outside-owner`,
  `no-module-mocking`, `no-object-parameters`, `no-inline-slop-answer`. Deleting the wrapper means
  editing every caller; moving a kill to its owner is two files; an injected interface replaces
  the mock in the code under test; an owner-provided parameter type is a new contract at every call; a disable comment's answer moves into a row of `not-slop.tsv`, under an id only a lint
  run computes. A per-file fixer cannot do any of them.
- **The repair changes a semantic the rule can only ask about** (2): `no-transposed-argument`
  and `no-hand-spelled-git`. Which of two crossed arguments is wrong is the caller's to say. A
  hand-spelled git call has three owner answers (exact bytes, trimmed text, or null where "no" is
  an answer), and a call reading the exit status or passing `cwd` needs a reading of which it meant.

`no-hand-rolled-sleep` is the shape of a fixer that looks safe. A fixer writing `Bun.sleep` would
have matched the tree everywhere and passed condition 3. It fails condition 4: a `Bun.sleep(50)` is
the same guessed interval, and the rule would have stopped asking about it.

A report with no fixer is a working outcome and the majority outcome: the author is told exactly
what is wrong and makes the call.

## The implicit-state rules: the repair is an owner

`implicit-state` (`excessive-bools`, `files-as-phase`, `mtime-as-lock`) reports and never fixes,
and each rule says so in its head comment. Every finding asks for an owner of a state that has
none: the union the flags stand for, the record of a process's phase, the holder of a lock. Which
states exist and where their owner lives is a design the rule cannot read off the syntax, so no
edit is correct by construction (condition 1 fails at once).

## A fixer's finding has no answer

A report-only finding a reader judges wrong is answered once in `tools/oxlint/not-slop.tsv`, with
a reason, and every reader of the findings drops it. A finding from one of the ten cannot be:
`bun run not-slop` refuses the row, and so does `bun run lint` when it reads one. The ledger stops
a report, not a fix (`--fix` rewrites the site whatever a row says), so a wrong report from a
fixer is a defect in the rule and is repaired in the rule. That is condition 1 read from the other
side: a repair that is a fact has no exception to record.
