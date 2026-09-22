# Which rules fix, and which only report

Fifty-four rules are registered: thirty-seven `ana` and seventeen `anti-slop`, every one of them
`error`. **Fifteen carry a fixer. Thirty-nine report and leave the repair to the author.**

That split is not an accident of effort, and it is not a backlog. This file says what a fixer has
to be true of before it ships, which rules pass that test, which ones sit right on the edge and are
refused on purpose, and why the count stops at fifteen rather than climbing to twenty. Each rule's
own doc comment carries its reason in one sentence; this file is the argument they share, so the
next rule author does not re-derive it and does not ship the fixer that makes the ruleset
unenforceable.

## The test a fixer has to pass

All four, not three.

1. **The repair is a fact, not a decision.** A `let` the next `if` decides is a `const` and a
   conditional — there is one answer and the rule can see it. What a hoisted table should be
   *called* is a decision; so is which of three structures replaces a lookup chain. A fixer that
   decides is a fixer that writes the median answer everywhere, which is worse than no answer,
   because nobody comes back to a line that lints clean.

2. **A wrong fix fails loudly, at the line the fix wrote.** `require-captured-json-runtime` and
   `require-meta-runtime-import` both write an import that might be missing a member. That is
   admissible because the miss is a compile error naming the member and the module, on the line
   the fixer just wrote. `no-alias-restating-return` would delete an annotation and let the return
   infer, and an inferred type that is quietly wider than the annotated one compiles. Silence is
   the disqualifier, not risk.

3. **The fixed form is the form the repository already writes.** Measured against the tree, not
   against taste. A fixer is the fastest way to push a house style the house does not have: run it
   once and several hundred sites are in the new shape with no author in the loop.

4. **The fix must not remove the occasion for the repair the report was asking for.** This is the
   one that is easy to miss, because a rule that stops reporting looks like a rule that worked.
   `no-inline-schema-literal` is the clean case: hoisting the literal is mechanical, and hoisting
   it is also the only moment anyone will name the table for what it holds and write the sentence
   saying what it is for. A mechanical hoist leaves `const strings` at module scope, uncommented,
   and silences the rule. Compliance with the letter of it, none of the benefit, and no second
   chance.

## The fifteen that fix

| rule | the edit | why it is a fact |
| --- | --- | --- |
| `declarations-before-the-first-function` | moves type, interface and const declarations above the first function | order, not content; the declaration text is untouched |
| `no-argument-already-carried` | drops the parameter, the argument at every call and rewrites the body's reads | three edits, one shape; scope analysis decides the body half, and six conditions withdraw it |
| `no-hand-rolled-error-render` | routes a caught value through `errorMessage` / `asError` | those two own the decision already |
| `no-hand-spelled-tree-root` | replaces a joined path literal with the owner's call | `campaignRoot()` is the single owner; the literal is the bug |
| `no-renaming-temporary` | substitutes the expression at the one read | a const read once and only renaming is the expression |
| `no-repeated-string-literal` | names the repeat once, **in test files only** | see below — the source half is deliberately refused |
| `prefer-condition-over-boolean-returns` | returns the condition | `if (c) return true; return false` is `return c` |
| `prefer-const-conditional` | `let` plus `if` becomes `const` plus conditional | one initialiser, one branch, no other write |
| `prefer-find-over-loop` | the loop becomes `find`, `some` or `every` | the body is one conditional return; which of the three follows from what it returns |
| `prefer-includes-over-some-equals` | `.some(x => x === lit)` becomes `.includes(lit)` | same semantics, no callback |
| `prefer-key-if-defined` | a run of `if (v !== undefined) o.k = v;` below `const o = {…}` becomes `...keyIfDefined("k", v)` inside the literal | `src/meta/optional-key.ts` already owns the fold at 290 sites; the value is a pure read, so moving it into the literal moves no evaluation, and the helper is picked by the operator (`!== undefined` omits undefined alone, a null test omits both) |
| `prefer-some-over-filter-length` | `filter(...).length > 0` becomes `.some(...)` | same predicate, same answer, one pass |
| `prefer-subpath-import` | `../../../../src/x.ts` becomes `#src/x.ts` | the alias is read off the nearest `package.json`, the manifest that resolves it, so it names the same file and a key it does not map is never written |
| `require-captured-json-runtime` | imports `capturedJsonParse` and calls it | one owner, one name |
| `require-meta-runtime-import` | moves a `node:` import onto the `src/meta` module that wraps it | a table of seven builtins with exactly one wrapper each; anything ambiguous is absent from it |

`no-repeated-string-literal` is the one rule that fixes half of its own findings on purpose. In a
test file the local constant *is* the answer: the fixture belongs to the suite that spells it, and
importing the producer's constant instead would cost the test the rename it exists to catch. In a
source file, where the constant belongs is the whole question, and a fixer would answer it with a
local one every time. So the fixer runs in tests and nowhere else — the same rule, two scopes, one
of them a fact and one a decision.

## On the bridge: nine where the edit is available and refused

These are the ones worth naming, because in every case a fixer is mechanically within reach and the
refusal is a judgement. A future author who writes one of these is not solving an open problem;
they are reversing a decision, and should say so.

| rule | the edit that exists | why it is refused |
| --- | --- | --- |
| `no-inline-schema-literal` | hoist the literal to module scope | the rename and the sentence are the value, and the hoist is the only occasion for them; condition 4 |
| `no-single-caller-helper` | substitute the arguments into the one-`return` body | **written and thrown away.** Mechanically fine — the ranges come from scope analysis — but the result is a longer expression where the author wanted a statement, at three hundred sites. It would have produced exactly the shape the rule exists to remove |
| `require-safety-comment-for-type-assertion` | insert a `SAFETY:` comment | the comment's content is the entire requirement; a generated one satisfies the rule and proves nothing, which is worse than the missing comment |
| `no-property-read-on-function` | delete the read | the read evaluates to `undefined`, so it is evidence a rename went wrong; deleting it deletes the evidence |
| `no-reflect-get`, `no-reflect-apply` | rewrite to `obj[key]` / `fn(...args)` | that keeps the dynamic dispatch and loses the finding. The repair is typed access or a parse, which is the question the reflection dodged |
| `no-conditional-empty-object-spread` | emit the field as `null` | absent or present-and-null is the contract, and the spread is where that decision was avoided |
| `no-alias-restating-return` | delete the alias and the annotation | condition 2: an inferred return is not the annotated one, and a plugin that cannot see types cannot tell the two apart. The pass that measured this rule watched a dropped annotation widen a narrowed `severity` back to `string` |
| `no-array-filter-map` | rewrite to `flatMap` | condition 1 in the ordinary case and condition 3 at the edges: a callback reading its index, or one whose order matters, does not survive the rewrite, and the rule reads the callbacks well enough to ask the question and not well enough to answer it |

`no-repeated-string-literal`'s source half belongs on this list too; it is above because the rule as
a whole ships a fixer.

## The rest: thirty where the rule does not hold the repair

Not borderline. In each of these the missing piece is information the rule has no access to, and
every one of them says so in its own doc comment — `test/oxlint-rule-contract.test.ts` refuses a
rule that neither declares `fixable` nor writes the words. The groups below were re-read against
those sentences on 2026-09-20 and three rules moved, because a group label had been standing in
for a reason the rule states more precisely itself.

- **The repair is a type** (10): `unproven-unknown-parameter`, `no-unknown-union`,
  `no-unknown-returns`, `no-unknown-type-aliases`, `no-unsafe-dictionary-type`,
  `no-known-value-widening`, `no-widen-then-assert`, `no-chained-type-assertions`,
  `require-type-for-null-default`, `no-runtime-typeof`. The `unknown` or the widening is exactly
  the work someone avoided; writing it is the finding. A plugin rule does not read the checker.
- **The repair is a name** (4): `no-thrice-spelled-object`, `no-shape-in-symbol-names`,
  `no-positional-boolean-parameter`, `prefer-entries-over-keys-lookup`. Which two words name the
  states, what the extracted function is called, what the entry's value is called — that is the
  change, not a step towards it.
- **The repair is a structure the rule cannot choose** (9): `no-deep-nesting`, `no-tangled-ternary`,
  `no-inline-block-reducer`, `no-side-effect-in-predicate`, `prefer-lookup-over-equality-chain`,
  `no-reduce-accumulator-copy`, `no-arms-differing-in-one-term`, `no-hand-rolled-sleep`,
  `no-single-use-const-chain`. Each
  offers two or three correct answers — guard clause or extraction, `Record` or `Map` or
  `satisfies`, mutating accumulator or pipeline, and for the sleep either of the two exact waits
  or an admitted real clock — and which one a site wants is the reading.
- **The repair reaches other files** (5): `no-pass-through-wrapper`, `no-lifetime-outside-owner`,
  `no-module-mocking`, `no-object-parameters`, `no-inline-slop-answer`. Deleting the wrapper means
  editing every caller; moving a kill to its owner is two files and usually a deletion; an
  owner-provided parameter type is a new contract in another file and at every call; a disable
  comment's answer moves into a row of `not-slop.tsv`, under an id only a lint run computes and a
  reason only the author can check. A per-file fixer cannot do any of them.
- **The repair changes a semantic the rule can only ask about** (2):
  `prefer-flatmap-over-map-filter` and `no-transposed-argument`. `Boolean` drops `0`, `""` and
  `false` along with `null` and `undefined`, so whether the `?? []` rewrite preserves the site's
  meaning depends on what the map produces. Swapping two crossed arguments back is the same kind
  one step further: the call may be right and the caller's two bindings misnamed, or the
  declaration's order may be the thing to change, and all three repairs are one edit apart. This
  is a real kind and not a small group: the rewrite is available, correct at most sites, and wrong
  at some without anything in the expression saying which.

`no-hand-rolled-sleep` is the one worth reading twice, because it is the shape of a fixer that
looks safe. All eleven sites it keeps took the third answer, so a fixer writing `Bun.sleep` would
have matched the tree everywhere and passed condition 3. It fails condition 4: a `Bun.sleep(50)` is
the same guessed interval, and the rule would have stopped asking about it. Two of the twenty-eight
— `no-runtime-typeof` and `no-shape-in-symbol-names` — name two terms each, a type or a name plus a
reach into other files, and are filed under the one their own sentence makes the object of the
repair.

## Why it stops at fifteen

Two rules moved across on 2026-09-20, and both refusals had named an obstacle that measurement
removed rather than a decision. `require-meta-runtime-import` said a fixer "would produce an import
that does not resolve" — true against a guessed module, false against a table read off `src/meta`.
`no-argument-already-carried` said the fix is a signature change, and then named the shape it could
reach anyway. `prefer-key-if-defined` arrived later the same day as the fourteenth, with the fixer
in its first commit: the owner already existed, two simplify passes (`743608504`, `421533e8f`) had
made the fold by hand, and the strict shape — a pure read, no comment in the block, nothing between
the literal and the guards but a `const` the guard alone reads — is exactly the set of sites where
the edit is a fact. Every one of the remaining thirty-eight was read the same way, and each states a
reason that survives. `no-single-use-const-chain` arrived on 2026-09-20 already refusing: the repair
is the composition, and which two of four steps keep a name is the reading the rule exists to ask
for. `prefer-subpath-import` arrived on 2026-09-21 as the fifteenth, with its fixer as the codemod
that moved 569 imports: the alias names the same file the dots did, so there is nothing to decide.
It moved from `ana` to `anti-slop` the same evening, because nothing in it was this repository's: it
reads the nearest manifest's `imports` as every resolver does, and the trees an exported bundle
copies without them are named in `.oxlintrc.json` as its `relativeOnly` option, which the `ana`
fixers that write imports read too.

**The count of rules is the wrong denominator.** The largest sweep in the set had a fixer and the
second largest deliberately did not. `declarations-before-the-first-function` moved 965
declarations in 339 files, all of it order and none of it content, and the fixer did the whole
sweep. `no-single-caller-helper` is the comparable judgement sweep, and its own doc records what a
fixer would have done there: at about three hundred sites, exactly the shape the rule exists to
remove.

The advisory rules that survive a narrowing pass are mostly small, because the narrowing is what
separates a shape from a preference — `no-tangled-ternary` reads 193 nested ternaries down to the
47 that are genuinely hard to follow, and `no-thrice-spelled-object` clears both its floors at 10.
Fixability is not a function of volume. It is a function of whether the repair is on the page.

## Condition 2 read back over the fixers that shipped, 2026-09-20

The four conditions are a test a fixer passes before it ships. Nothing had read them back over a
fixer already registered, and condition 2 — *a wrong fix fails loudly, at the line the fix wrote* —
is the one that decays, because it is a claim about every input the rule will ever see rather than
about the rule's own source. Thirteen silent rewrites were found and closed, each with the hostile
case in the rule's own fixture.

- **`strict-boolean-fix`, the number kind.** `(n ?? 0) !== 0` is `if (n)` for every number but
  NaN, which is falsy and compares unequal to zero. The spelling that reproduces NaN mentions `n`
  twice and `n` can be a call, so the rewrite is withdrawn and the site reported. `.length` and
  `.size` were promoted to the count kind instead, where NaN was said not to arise; the pass
  below withdrew that too. It compiles either way.
- **`prefer-const-conditional`, two holes.** `?:` is right-associative, so a conditional test
  dropped unparenthesised into another conditional's first position reassociates — the looser-than
  set now carries the whole grammar rather than three of its five members. And the test moves into
  the declaration's own initialiser, so a test reading the name being declared is a temporal dead
  zone error; that site is now passed over.
- **`prefer-find-over-loop`, the subject.** `for (const row of primary ?? fallback)` became
  `primary ?? fallback.find(p)`, which searches the second array alone and type-checks when both
  are the same element type.
- **`no-renaming-temporary`, three positions.** A template literal's words are prose exactly as a
  `"…"` is, and `withoutProse` was leaving whole templates as source, so the name could be
  substituted inside one; the mask now blanks the words and keeps every `${…}`. `{ label }` is the
  key as well as the value, and `reader()` on a binding of `stream.read` calls an unbound function
  where the path itself would bind a receiver. All three are reported and none is rewritten.
- **`declarations-before-the-first-function`, the moved range.** "The declaration's own line"
  reached the next newline, so a second statement written beside it travelled to the front without
  ever being decided. The reset of the effect and guard lists also sat after a `return` in
  `Program:exit`, which leaks one file's offsets into the next file the same instance walks; it is
  a `before` hook now, as `prefer-find-over-loop` already had.
- **`prefer-some-over-filter-length`, the effect test.** `.some` stops at the first match, so the
  rewrite is only sound where the number of calls is unobservable. `mutatingCall` reads six method
  names and its comment claimed `no-param-reassign` and the tree's `const` habit covered the
  assignment case; neither reaches an outer `let`. The report is unchanged, because the text
  cannot tell a write that outlives the walk from a `const` declared inside the predicate and a
  finding a reader cannot act on is worse than a gap. The **fix** now refuses the whole class.

And the loop that drives them. `fix-loop.ts` reverts the working tree whole at the top of every
round, including the first, where there is nothing of its own to revert: it deleted whatever
uncommitted work the tree was carrying. It refuses a dirty tree at the door instead, which is the
only place the operator's bytes and the loop's own are still distinguishable. Its oracle also read
zero findings from a step that had crashed as a clean tree, and zero findings is exactly what
convergence is, so a missing binary ended the loop reporting success.

- **`prefer-condition-over-boolean-returns`, the swallowed comment.** Without an `else` the
  second return is the statement below, so the rewrite reaches past its end — and takes with it
  whatever sits between the two. In this tree that is usually the sentence saying why the guard is
  there. The output compiles and every test passes, so nothing says the prose has gone. This one
  was visible in the rule's **own fixture**, where each case carries a `// REPORT …` marker on the
  guard line: the expected output was written from what the fixer produced, so it expected the
  marker to be absent. One comment is now carried onto the answer. Two would have to be stacked
  above it and indented, and a line comment cannot lead a line that still carries code, so both
  of those are reported and left.

- **Five more of the same kind, found by reading every other fixer for it.** A fix that replaces
  or removes more than one node's worth of text takes the prose written inside that span with it,
  and the eighth case above is only the shape where the fixture happened to show it. Every
  registered fixer was read for the same span, and five do the same thing.
  `prefer-find-over-loop` replaces the whole loop, so a sentence written inside a braced body —
  usually the one explaining the predicate that is about to become an arrow — goes with it.
  `prefer-const-conditional` removes the `if` whole, so a line inside an arm goes; the comment
  *above* the `if` sits outside both edits and was already kept, and only the arms were open.
  `no-argument-already-carried` reaches to a neighbouring argument to take the comma, and so
  reaches over anything written between the two. `prefer-includes-over-some-equals` replaces the
  whole closure with the literal it compared against, so anything written inside it has nowhere
  to sit. `prefer-some-over-filter-length` is the one that needed a narrower answer: the
  predicate travels as its own source text and its comments survive, but the rest of the
  expression is rebuilt from the subject and the operator, so a line beside the `.filter(…)` of a
  wrapped chain is rebuilt away — the span it refuses on is what lies **outside** the predicate,
  not the whole node.

  All five refuse through one predicate. `holdsProse` sits beside `withoutProse` in
  `shared/masked.ts`, the module that already owns the difference between this repository's code
  and its sentences: where the comment has no place on the answer, the rule reports and the author
  makes the edit. Placing it would have been a layout decision in each case, which is condition 1.
  `dropItem` came out shorter for it — three exits computing three spans became one span computed
  once and checked before it is written.

  Three fixers were read and left as they are. `no-renaming-temporary` and `prefer-find-over-loop`
  already carried the sentence for why they remove a node rather than a span, and
  `require-meta-runtime-import`'s `throughLineEnd` stops at the node when a comment trails the
  import, leaving it visible rather than deleting it.

The lesson for the next fixer is condition 2 restated: the compiler is not the oracle. Eleven of
these thirteen produce source that compiles, and eight of those produce source that is also
plausible. The hostile case belongs in the fixture at the same commit as the fix — and an
expectation copied from a fixer's output is not a hostile case, it is a record of the bug.

## Condition 2 again, under five outside readings, 2026-09-20

Five review reports read PR ranges #855 to #935 without a runtime, so none of their
counterexamples was executed; each arrived at the same sentence, which is condition 2 from the
other side: *withhold an automatic fix when equivalence is unproved, and leave the diagnostic
available.* Seven more silent rewrites closed under it. They are a narrower question than the
pass above asked, which was reading for prose inside a replaced span; these are about what the
replacement means.

- **`strict-boolean-fix`, the count that was not one.** The pass above withdrew the number kind
  and kept `.length` and `.size`, on the ground that a count is never negative and never NaN. The
  only thing read was the property's spelling. A declared `{ size?: number }` holding `-1` is
  truthy where `(row.size ?? 0) > 0` is false, with no type in view to say which `size` this is.
  The number kind refuses at the top of `editFor` now, and three rewrites are left.
- **`no-renaming-temporary`, the declarator with a sibling.** The visitor decides one declarator
  and the fix removes the statement holding it, so `const one = input.value, keep = "x";` took
  `keep` away with it — a binding gone and its reader left, which does fail at compile time, and
  only because the sibling happened to be read. Removing the declarator alone leaves its comma to
  place, which is a layout decision under condition 1. Single-declarator declarations only.
- **`shared/masked.ts`, a brace in a sentence.** The pass above taught the mask to blank a
  template's words. It counted braces first and blanked second, so a `{` written in prose opened
  a depth the literal had not, and everything up to the matching brace read back as code — which
  is how a name inside a sentence became substitutable again, in the one module that exists to
  stop exactly that. Checked against the pre-repair file: the new fixture rewrote a word inside a
  template's prose. Words are blanked before braces are counted now.
- **`prefer-some-over-filter-length`, every call.** `.some` stops at the first match, so the
  rewrite needs the predicate's call count to be unobservable, and the pass above decided that
  from six mutating method names. `(row) => recordVisit(row)` holds none of them and writes
  nothing here, and what it does is in another file. A blacklist of spellings cannot prove a call
  free of effects. The fix refuses every call; the report is unchanged.
- **`no-argument-already-carried`, the read that moves.** The dropped argument is evaluated where
  it stands, before everything to its right and before the callee's body. `render(view, view.rows,
  refresh(view))` reads the rows and then refreshes; after the fix the callee reads them, after.
  A body writing the same path does it one step later still: `reset(state, state.count)` whose
  body clears the count returns the caller's count today and zero afterwards. The same program, a
  different answer, at no line a compiler will look at. Both the argument suffix and the body now
  have to hold no call, no assignment and no `await` or `yield`.
- **`declarations-before-the-first-function`, a part of a name.** A `const` binding cannot be
  reassigned, so reading it above the code was already safe; writing through a part of it is not.
  `CONFIG.limit = 2` between the function and `const SIZE = CONFIG.limit` means moving that
  declaration up reads the value before the write. The narrowable set was widened to every value
  binding the file owns and a read taking a part of one is barred — one set rather than two, and
  the same four parameters, which is the limit this tree now holds signatures to.
- **`prefer-condition-over-boolean-returns`, the inferred return.** `if (row.name) return true;
  return false;` becomes `return row.name;`, and with no annotation on the function the return
  type widens from `boolean` to `string | undefined` in silence: this tree runs
  `strict-boolean-expressions` with `allowAny` and carries no `explicit-function-return-type`, so
  neither the compiler nor the linter says anything. The fix needs one of two witnesses now — a
  test that is a boolean by its spelling alone, or a declared `: boolean` return, where a widened
  return is a loud error at the line. `Promise<boolean>` is not the second one, so an `async`
  function keeps its report and loses its fix.
- **`require-meta-runtime-import`, two modules under one name.** `src/meta/filesystem.ts`
  re-exports thirty-five sync names from `node:fs` and takes `mkdir`, `mkdtemp`, `readdir` and
  `rm` from `node:fs/promises` beside them. An import of `rm` from `node:fs` moved onto the
  wrapper therefore became the promise-returning one, and a caller ignoring the result — which is
  what a callback-free `rm` does — ran it unawaited and compiled. The four names are read off the
  owner and refused; everything else in the same import still moves.

Two more in the loop that drives them, where the fixer's own code is the subject.

`revertJournal` walks the journal as the list of edits the file is carrying, adding each skipped
edit's length change to a running distance. After a selective revert that list is stale: the next
revert added the undone edit's change for a change no longer there, and looked for every later
edit in that file at the wrong offset — refused by the text guard for a replacement, unseen for a
deletion. A recorded `start` is a position in the original file whatever else is dropped, so
dropping the undone rows is the whole repair, and two reverts in a row are the same as one naming
both.

The loop's exit went the same way. A round holding nothing new is a fixed point, and that was read
as the tree being one the compiler, the linter and the size policy accept. Those are two claims: a
finding the fixer cannot remove is held on the round it appears and adds no hold after, so a
compiler error the loop never caused reached `converged` and exited zero with the error still in
the tree. `verdict` separates them, `mustRun` refuses to read a non-zero exit from the fixer or
the formatter as a round that found nothing, and the size policy is read from the sentence it
settles on rather than from a status any of its six checks can set.

Pushing the count to twenty means shipping fixers from the bridge list, and each one silences its
rule while leaving the repair undone. A ruleset where a third of the findings are closed by a
fixer that wrote the median answer is not a stricter ruleset — it is a ruleset that stopped being
enforceable, because a clean lint no longer means what it says. **Fifteen is the honest ceiling
under the four conditions, not a target that was missed.**

A report with no fixer is a working outcome and the majority outcome: the author is told exactly
what is wrong and makes the call. That is what these thirty-nine are for.

## A fixer's finding has no answer

A report-only finding a reader judges wrong is answered once in `tools/oxlint/not-slop.tsv`, with
a reason, and every reader of the findings drops it. A finding from one of the fifteen cannot be:
`bun run not-slop` refuses the row, and so does `bun run lint` when it reads one. The ledger stops
a report, not a fix — `--fix` rewrites the site whatever a row says — so a wrong report from a
fixer is a defect in the rule and is repaired in the rule. That is condition 1 read from the other
side: a repair that is a fact has no exception to record.
