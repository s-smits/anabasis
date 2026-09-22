# The override lists in `.oxlintrc.json`

Each block in `overrides` that turns one rule `"off"` for a list of files is that rule's debt on
the day it was turned on: the files that already broke it. The rule holds every other file in the
repository from that moment, including every new one.

**The lists only shrink.** A file is never added to one. An overhaul that clears a file deletes
its line, and the rule then holds that file too. This is the same contract as
`tools/loc/complexity-baseline.json`, which `--write-baseline` may only make smaller.

The alternative was to leave a rule unregistered until its overhaul finished, and it is worse: an
unregistered rule holds nothing, so the pattern keeps arriving in new files while the old ones are
being cleaned. A rule with a 35-file exemption is already holding the other 470.

Three entries here are not debt and will not shrink to nothing, because the rule is wrong about
this repository rather than the repository being wrong:

- `typescript/await-thenable` is off under `test/**`. Bun declares `expect(...).rejects` and
  `.resolves` without a Thenable type, so all 215 reports were `await expect(...)` and none was a
  defect. The rule still holds `src`, where it found nothing.
- `typescript/switch-exhaustiveness-check` is configured differently under
  `tools/oxlint/anti-slop/**`, which arrived as a vendored tree and is edited here as needed. The
  entry used to say the tree is pinned verbatim at a commit; the repository's own history already
  contradicted that — `baf6edd7e` edited eleven of its rules — and `no-object-parameters` was
  widened again on 2026-09-20. The configuration difference stands on its own: these files are
  written against an AST the checker does not type, so the exhaustiveness rule reads unions it
  cannot see the arms of.
- `typescript/require-array-sort-compare` and `typescript/no-misused-spread` are off under
  `**/*.mjs` and `**/*.js`. Both read the checker, and `tsconfig.json` covers no `.js` or `.mjs`
  file, so both see `any` and fail closed. All 25 reports were wrong: 24 `.sort()` calls on sets of
  ids, families, paths and rule names, and one spread of a ledger row that is an object. The
  spelling the sort rule asks for — an explicit `(a, b) => (a < b ? -1 : a > b ? 1 : 0)` — is what
  the default comparator already does for strings, so following it at 24 sites adds noise and no
  proof. Both rules still hold every typed file, where 176 bare `.sort()` calls pass because the
  checker can see they sort strings.

Eight entries that were a rule losing to a stricter one are gone, because the rule now measures
what it is losing to. `ana/no-single-caller-helper` reads its caller before reporting: if the
inlined lines put that caller over the 80 nonblank lines in `tools/loc/source-policy.ts`, or its
branch count at the 22 in `tools/loc/complexity-policy.ts`, the helper keeps its name and nothing
is reported. A caller at either ceiling has no legal spelling that also absorbs a helper, so the
report asked for a file that could not pass the gate; that is the admission test in
`SHAPE-RULESET.md` failing at a site, and the rule yields at the site rather than being baselined
per file. Twelve reports across `src/author`, `src/backends`, `src/builder`, `src/solve`,
`src/truth` and `vendor/pi-claude-bridge` went that way, and no site that should report stopped
reporting: the whole-tree A/B with the ledger block emptied read 41 before and 28 after.

Two details of that measurement are worth keeping. The line ceiling reads the **outermost**
enclosing function, because that is the one `source-policy.ts` measures — `piBuiltSolver` is 80
lines, while the arrow that holds both its calls is 54, and reading the inner one exempted
nothing. The branch count reads the **innermost**, because `eslint/complexity` attributes each
branch to its nearest function, and it counts `?.` — `relocateToolLauncher` measures 21 there and
16 without its five optional accesses.

Four single-file entries became an inline disable that says at the site why the rule is wrong
there, which is where a reader meets it. `typescript/unbound-method` reports `draft-authority.ts`,
where the proxy reads a member off the prototype descriptor and hands it to `nativeApply` with an
explicit receiver — the remedy the rule names — so there is no spelling that both binds the
receiver and never reads it unbound; and its test, which detaches a method on purpose to prove
the lease ignores falsified identity. `eslint/no-extend-native` reports the test that pollutes
`Object.prototype` to prove DraftStore ignores inherited properties, with a `finally` that removes
it. `eslint/no-unmodified-loop-condition` reports the prompt stream's wait, whose two flags are
set by the producer that also resumes it; the same rule already carried two inline disables of
that shape in `src/author` and `src/backends`, so this is the third of a known class.

Three rules were removed rather than baselined.

`oxc/no-map-spread`: its 49 sites were all `xs.map((x) => ({ ...x, field }))`, the immutable update
this tree is built on; the rule is about the property copies that costs, which is not a trade this
code wants to reconsider at 49 sites.

`typescript/consistent-return`: all 17 sites were false positives, and following twelve of them
would have broken a rule this repository relies on. Those twelve — `fixedProductBoundary`,
`toolNonResultCode`, `bandReading` and nine more — are exhaustive switches over a discriminated
union with no `default`. TypeScript already proves they return, since each is declared to return a
string and compiles. Satisfying `consistent-return` means adding a `default` clause or a trailing
throw, and a `default` clause is exactly what stops `typescript/switch-exhaustiveness-check`
reporting the next case someone adds to the union. The other five are React effects that return a
cleanup on one path and nothing on another, which is the `void | Destructor` contract React
declares. A rule whose only reports are wrong, and whose repair disables a rule that is right, is
not debt.

`typescript/no-unnecessary-type-parameters`: its nine sites were the same construct, and the rule
is right that the parameter carries no inference — that is what the construct is for. A caller
declares the contract it is reading bytes or a fixture under, and the function asserts to it once:
`parseJsonAs<T>`, `recordedJson<T>`, `double<T>`, `frozenSection<T>`, `sanitized<T>`,
`tracedInput<T>`. Removing the parameter leaves `unknown`, which `ana/unproven-unknown-parameter`
reports, or moves the assertion to every call site, where each one needs a SAFETY comment under
`anti-slop/no-chained-type-assertions`. The rule asks at all nine sites for a spelling another rule
refuses, which is the admission test failing everywhere the rule fires. The one site that looked
like real slop — `boundedLedgerNote<Row, TaskSet>`, whose parameters only reach `.length` and a
null test — cannot drop them either: its rows are production interfaces, and an interface is not
assignable to `JsonValue` for want of an index signature.

**This file is under the 800-line ceiling as well, and it only grows.** Once a rung has shipped —
the rule registered, its sites fixed, its traps written into the rule's own comment and fixtures —
its section here stops changing a decision. Shorten the ledger from the oldest end rather than put
it on the ignore list; `SHAPE-RULESET.md` lost two shipped `ana` entries that way on 2026-09-20.

## Four rules admitted, three refused, 2026-09-20

`unicorn/explicit-length-check` (15 sites), `eslint/no-useless-assignment` (5),
`import/no-duplicates` (4, after 32 same-kind duplicates were merged) and
`typescript/no-unnecessary-type-assertion` (39) are on. The last needed the import plugin enabled
and two inline disables, both stating the same thing at the site: the compiler requires the
assertion oxlint's type-aware pass reads as a no-op, and the rule yields to the compiler. The
other 37 assertions are gone, and so are the fifteen SAFETY comments that explained them.

Three were refused after measurement.

`unicorn/consistent-function-scoping`: 193 sites, and what it asks for at each is a module-level
function with one caller. `ana/no-single-caller-helper` exists to remove exactly that. The
admission test fails at every site, and the direction it pushes — a local closure of one or two
lines hoisted beside eleven others at the top of the file — is the opposite of the one this
repository has been moving in all pass.

`unicorn/no-useless-undefined`: 96 sites, nearly all `.catch(() => undefined)` and
`return ok(undefined)`. The spelling it asks for is `.catch(() => {})` and `ok()`, which hide a
value the code states on purpose. This tree treats `null` and `undefined` as meaningful state and
writes them out; the rule is written for a codebase that does not.

`eslint/import-first`: 81 sites, every one of them a `export { … } from` line placed above the
imports rather than an import placed below something else. Several modules lead with their
re-export deliberately. No other rule objects to either order, so the rule is measuring a
preference, not a defect. `eslint/no-duplicate-imports` was refused with it: 57 of its 89 reports
were a deliberate `import type` beside a value import of the same module, which it cannot tell
apart. `import/no-duplicates` can, and is the rule that shipped.

## `.claude` joins the lint scope, and one rule joins with it, 2026-09-20

`bun run lint` and `tools/oxlint/simplify-census.ts` now name `.claude` beside
`src tools vendor starters test packages`, and `tools/oxlint/tree-findings.ts` declares over it.
The first measurement of that compartment was 416 findings and it is now at zero.

`eslint/no-undef` is registered under `**/*.mjs`, `**/*.js`, with the `builtin`, `node` and `es2024`
environments and one global for `Bun`. It costs nothing today — zero sites across the whole scope —
and it is on for what it catches rather than for what it removed. Two defects in this pass were one
shape: a rename applied to a declaration and to some of its uses.

- `validate-reports.mjs` renamed `expected` to `expectedHash` and left one `recorded !== expected`
  behind. Nothing declares `expected` in that module, so the launch-binding check threw on every
  run, and `wri-report-validation` caught it.
- `archive-shape.mjs` renamed an inner `identity` to `tierIdentity` and left two `identity[key]`
  reads behind. That name resolves to the module's own exported `identity` function, so both reads
  were `undefined` and the validator refused every well-formed safeguard reconciliation. Twenty-
  three tests caught it.

`no-undef` catches the first and not the second, and `tsc` catches neither, because `tsconfig.json`
covers no `.js` or `.mjs` file. Whether to cover them was measured rather than assumed. `checkJs`
over `.claude/skills/**/*.{mjs,js}` at this repository's settings reports **3,776 errors**, 1,883 of
them a parameter with no annotation. At the loosest settings that still typecheck anything it is
**258**, of which 206 are `Property 'x' does not exist on type 'JsonValue'` — a field read off
`readJson`, which is what these scripts exist to do. Neither number buys the second defect at a
price worth paying, so the skill scripts stay untyped.

## `ana/no-property-read-on-function`, for the half of a rename that still resolves, 2026-09-20

The second defect above is the one that stays quiet, and buying it with types was refused on the
numbers. It is decidable from the syntax instead. A property read off a function the same file
declares is `undefined`, always, and no file in this repository had a reason to write one: the rule
reports **zero sites** across `src tools vendor starters test packages .claude`.

References come from scope analysis, so a shadowed name is a different variable and never reaches
the declaration it hides. That is the rule's precision and also its honesty about when it helps:
on the commit before the rename, `archive-shape.mjs` had an inner `identity` and the rule would
have been silent, because the code was right. It speaks at the moment the shadow goes.

Two things are admitted. A function's own properties — `name`, `length`, `call`, `apply`, `bind`,
`prototype`, `constructor`, `toString` — are real reads. And one assignment anywhere in the file to
a property of that function, `handler.schema = …`, exempts it entirely: the module is using it as a
namespace, and the rule cannot tell which reads that was for.

Between this and `eslint/no-undef` both halves of a half-applied rename are now caught in an
untyped file: the use that resolves to nothing, and the use that resolves to the wrong thing.

Writing the test found a third defect, in `test/helpers/oxlint-rule-fixture.ts`. It kept only the
oxlint rows whose path matched `[^/:]+\.tsx?:`, so a fixture staged at a `.mjs` path matched no row,
came back empty and passed — asking the rule nothing. Every rule test in the repository was
reachable only at `.ts`, on the day a tree of `.mjs` scripts joined the lint scope. The filter is
now built from the path the helper actually staged, so it cannot fall behind it again.

## `tree/duplicate-run` reaches a repeat that differs in one word, 2026-09-20

The scan compared lines for identity after stripping comments, blanks, indentation, imports and
closing punctuation. On the same day, twelve copies of a `die` helper were consolidated by hand and
this scan had reported none of them: four lines of code, differing in one string literal, so they
failed the length floor twice over and the identity test as well. Three knobs moved, each measured
against the whole scope.

**Normalising the literal.** Replacing every string with `@` alone reported 121 sites. Sampling them
showed nearly every one was a union type, an argument array or a `case`/`return` mapping — lists of
*distinct* literals, which collapse into long runs of identical `@` lines precisely because they are
the opposite of a repeat. The normalisation was then restricted to a line with other work in it
(more than one identifier), which took it to 17. That is better but not the fix, and the two
examples fall the opposite way from how they read. `Type.Literal("x"),` carries `Type` and
`Literal`, so it is normalised, and nine of them are nine identical lines. `case "timeout":` and
`return "tool-timeout";` are separate lines in this tree, one identifier each, so their words are
kept and two unrelated mappings match on nothing at all. The identifier test settles the mapping
and leaves the vocabulary standing.

**The variety floor.** A run has to contain three lines distinct from each other. This is what
separates the vocabulary the identifier test leaves standing: a list is one line repeated, a
duplicate is several different lines repeated together. With it, the scan reported 6.

**The length floors.** Six lines and five of code had been set by an earlier measurement, which put
a four-line `isFile` below them and called that right. That call is now reversed: a four-line helper
with a named owner available is a question worth asking, and the closing braces it was grouped with
are excluded by `CLOSING_PUNCTUATION` rather than by length. Five and four report 31 sites.

Five of the 31 were sampled and all five were real: `onlyStatement` written twice in two lint rules;
two slot resolvers in `harness-measure.ts` and `harness-build.ts` differing only in `"built"` against
`"builder"`; a case-count shape declared in two files; `isFile` open-coded in `linux-bwrap.ts` and
`command-guard.ts` while `src/meta/filesystem.ts` owns the readers; and the CLI preamble shared by
`review-settle.mts` and `judge-replay.mts`. The group spreads over `.claude` 5, `src` 17, `tools` 9.

The census summary's `where` column reported all 31 as `src`. It bucketed into a fixed `src`, `test`
and `ui`, counting anything outside `test/` and `packages/` as `src` — true when the scope was those
three, wrong for `tools`, `vendor` and `starters` ever since, and actively misleading once `.claude`
joined. It now names the site's own root.

## The variety floor becomes a share, 2026-09-20

The tuning above left the group at 12 sites and one of them was a false positive of exactly the
kind the floor was there to stop. `verifier-workshop-tool.ts:10` and `harness-inspect.ts:55` declare
two unrelated typebox parameter enums — five workshop actions against nine inspect modes — and share
a seven-line run: `const Params = Type.Object({`, `action: Type.Union([`, and five
`Type.Literal(@),`. Three distinct lines out of seven, so a floor of three passed it. Three is what
a half asks of the shortest run this scan can report and less than it asks of every longer one, and
this run sits in that gap.

`DISTINCT_LINE_SHARE = 0.5` replaces the floor: more than half of a run has to be lines that differ.
At four lines of code, the shortest run reported, it asks for the same three the floor asked for; at
seven it asks for four, and the pair goes. Three predicates were measured over the whole scope:

| predicate | sites |
| --- | --- |
| at least three distinct lines | 12 |
| more than half the lines distinct | 11 |
| no line more than half the run | 11 |
| both of the last two | 11 |

All three drop that one row and nothing else. Nothing on this tree told them apart, and nothing
constructed did either. The shape that would separate a share from a cap is an alternating mapping —
four `case` lines and four `return` lines, where no single line is more than half the run and the
run is a vocabulary all the same. Put through the scan as two unrelated files it produces no finding
at all: `normalised` collapses a literal only on a line carrying two identifiers, so `case @:` and
`return @;` keep their words, the two files share no run, and the predicate is never reached. The
share is kept because it is one number where the cap is a count per line, not because it was shown
to be the better of the two.

`test/simplify-census.test.ts` carries both shapes. The enum is the case that falls. The mapping is
there to hold the identifier condition rather than the share: loosening it would make two unrelated
mappings match, and that test is where it would show.

## The length floor counts lines that do something, 2026-09-20

The four knobs above left `tree/duplicate-run` at ten rows, thirteen of the original set having been
answered by moving code. Four more of the ten were answered the same way later that day
— a worker bundling frame, two slot resolvers, a confinement request declared four times and a
tool list split through its middle — and the scan then stood at seven. Every one of the seven was a
shape rather than a repeat: two exported functions agreeing on a parameter list, three copies of a
`Bun.spawn` options literal, two vocabularies of the same non-result kinds, the verdict two platform
probes return, the plan object the Darwin and Bubblewrap preparers both build, and the argument list
at the two call sites of `superviseVerifierProcess`. Each had been answered no twice, by two passes
reading them independently.

`SUBSTANCE_FLOOR` counts the lines of a run that are code, and "code" meant "not a closing bracket".
That let a run reach four on lines no author chose: `repoRoot: string,`, `"provider",`, `refused,`,
`? liftedSucceeded`. Two predicates were measured against the whole scope, beside the cheaper knob
of asking for a longer run:

| floor | sites |
| --- | --- |
| not a closing bracket, four of them | 7 |
| not a closing bracket, six of them | 2 |
| a call or an assignment, four of them | 0 |
| a call, an assignment or a statement keyword, four of them | 0 |

The length floor is the wrong axis and the two rows it keeps say so: they are the parameter list and
the returned plan object, the two least like a repeat of anything in the group. It also undoes a
call this file recorded four sections above, where a four-line `isFile` with a named owner was
reversed into a question worth asking. What separates a repeat from an agreement is not how long the
run is but whether its lines do anything, and the recorded wins agree — the thirteen rows that moved
code to an owner were a `git` capture, a temporary-then-rename write, a CLI parse preamble and a
folded trace fact, four or more calls and assignments every time.

The last two rows of the table report the same zero on this tree, so nothing here separated them.
The statement keywords are kept because the census fixture does: `copy-a` and `copy-b` share
`return kept;`, which carries no call and no assignment, and dropping the clause reads that line as
shape and the pair as four lines of code rather than five. A predicate that calls a bare `return`
nothing is wrong whether or not this tree currently holds a pair that proves it.

`test/simplify-census.test.ts` gained two pairs beside the closing-punctuation and import-specifier
ones already there, each mirroring a site this floor withdraws: two files naming the same closed
vocabulary, and two probes returning the one verdict shape their declared type gives them. Both were
checked to report under the old floor before they were written down, so the fixture holds the
negative case and not merely the current answer.

## `prefer-const-conditional` reads both arms, and stops reading comments, 2026-09-20

`unicorn/prefer-ternary` was measured at 4 sites and refused: three are `if (c) await A(); else
await B();` in tests, where the ternary reads worse. The fourth was a real finding this tree owned
nowhere — a declaration with no value decided in both arms of the next `if`. The shape belongs to
the declaration, so `ana/prefer-const-conditional` widened to take it rather than a built-in
arriving with three sites nobody would fix.

| spelling | before | after | owner of the "no" |
| --- | --- | --- | --- |
| `let x = D; if (c) x = A;` | report | report | — |
| `let x: T; if (c) x = A; else x = B;` | — | report | — |
| `let x = D; if (c) x = A; else x = B;` | — | — | `no-useless-assignment`: `D` is dead |
| `let x: T; if (c) x = A;` | — | — | the other path leaves `x` undefined |
| `let x: T; if (c) …; else if (d) …; else …;` | — | — | three arms is not a conditional |

The widening then reported **0 sites tree-wide while its own fixture reported 2**, which is the part
worth keeping. Bisecting with a synthetic shape beside a verbatim copy of the real lines put the
cause in the guard the rule had been running with since it shipped: a value built from the name it
replaces is a refinement rather than a decision, and the guard tested that by searching
`context.sourceCode.getText(right)` for the name. `getText` returns source, comments included. The
Seatbelt array in `src/verify/solve-sandbox.ts` carries the comment *where that bypass is measured
against this profile without these lines* — the word `profile` in a sentence — and it suppressed the
finding about the binding called `profile`. Comments and single- and double-quoted strings are
stripped before the test now; a template literal is left intact, because `${name}` inside one is a
real read and the text around it is not worth a parser.

That defect predates the widening and silenced the one-arm spelling too, so the rule's counts
before today are floors, not measurements. The count after the repair is 1 site, in
`solve-sandbox.ts`, fixed in the same commit; `bun run lint` is at zero.

Three fixture functions joined `test/simplify-catchers-shape.test.ts` — no default with both arms,
one arm only, and an else-if chain — and the existing `bothArms` comment was relabelled, because it
had claimed two arms were "a different finding with a different answer" when the answer was simply a
dead initialiser that a second rule owns.

## `curly: "multi-line"` at 921 then 549 sites, two commits, two hand edits, 2026-09-20

A body on the same line as its keyword stays unbraced, so `if (x === null) return;` is untouched;
a body that spills to the next line gets braces, because an unbraced statement under a multi-line
head is where a second statement gets added by accident.

| keyword | sites |
| --- | --- |
| `if` | 748 |
| `for-of` | 161 |
| `for` | 8 |
| `else` | 4 |

The table counts `src tools vendor starters test packages`. Part 1's table says 505, measured
before #877 widened the lint scope, and every count taken before that day is a floor for the same
reason. `.claude` is the second commit below and is not in the 921.

`--fix` needs three passes, not one: the fixer braces the outer statement and reports the inner one
next time, so `for (…)\n  for (…)\n    stmt;` settles on the third run. What it cannot do is notice
a comment it has orphaned. In `vendor/pi-claude-bridge/turn-translation.ts` the opening brace landed
between a `SAFETY:` comment and the assertion it justifies, and
`anti-slop/require-safety-comment-for-type-assertion` then reported the site the comment was written
for. That was the one hand edit, and it reads better than the original: the comment now sits inside
the block, on the line above the assertion.

### The second commit: `.claude`, and why the first one missed it

The first commit braced 921 sites and touched no file under `.claude`, and the `bun run lint` that
preceded its push printed nothing and exited 0. The push gate then failed on 87 `eslint(curly)` rows
in `.claude`, which is the same rule over the same tree. Both readings were honest; they were not
the same command.

`bun run lint`, `test`, `typecheck`, `secrets` and `gate` are routed to the shared M1 runner by a
Zsh function and by `~/.local/bin/bun`, a PATH shim that covers non-interactive shells such as
`scripts/worktree.sh run`. The runner restated the oxlint command with its own path list and never
gained `.claude` when #877 added it, so it linted six directories and exited 0. oxlint prints
nothing on a clean run, so a narrowed scope is indistinguishable from a pass. The gate re-enters
through the real `bun` — the runner exports `HB4_M1_RUNNER_ACTIVE` before it calls `bash
tools/gate.sh`, which disables further routing — so the gate saw the rows the pre-push check could
not. The runner's `lint`, `typecheck` and `secrets` lanes now call `bun run <task>`, the way its
`test` lane already did after restating dropped `--path-ignore-patterns` once before. Proof: on the
same tree the routed lint went from 0 rows and exit 0 to 549 rows and exit 1.

549, not 87, because #895 put `.claude` under `biome format` first. Biome breaks
`if (cond) return someLongExpression;` across two lines when it exceeds `lineWidth` 110, and
`curly: multi-line` braces exactly that shape. A formatter and this rule therefore compound: the
directory that had never been formatted produced six times the sites once it was. That is the
argument for keeping one scope for both tools rather than two.

The lesson generalises past this rule: **a lint invocation is only evidence when its exit code and
its path list are both checked.** `simplify`'s own note from 2026-09-15 said silent output is not a
pass; this adds that a non-silent command can still be the wrong command.

### The size budget

`src/builder/tools.ts` went from 397 to 403 nonblank lines and its copied-file limit rose with it.
Six closing braces and no code: the same re-measure `f45fa64be` made when `biome format` took over
the line breaks. The other five limits in `tools/loc/source-policy.json` carry stale headroom —
`judge.ts` is 201 against 298, `host.ts` 868 against 1149 — and none of them is a `stale-copy-limit`
finding, because each still binds through the 115-line function check rather than the file ceiling.
Tightening them is a separate pass; a mechanical commit stays mechanical.

## `prefer-readonly` shipped and `max-depth` refused, 2026-09-20

Both were queued in Part 4 step 3 behind a compartment pass and a `test/**` ledger. Measured against
the tree on the day, `typescript/prefer-readonly` is **2** sites and `eslint/max-depth` at the
default of 4 is **3**; the table in `SHAPE-RULESET.md` said 265 and 56. The `max-depth` gap is the
setting — 56 was measured at `{ max: 3 }`, which is 80 today — and the `prefer-readonly` gap has no
established cause beyond the tree having moved. A queued count is a lead, not a measurement.

`prefer-readonly` reports both members of `PushQueue`, which are mutated with `push` and `shift` and
never reassigned. `readonly` on an array field says exactly that and nothing more. It is registered.

### `max-depth` was registered, its three sites were fixed, and then it came back out

`ana/no-deep-nesting` already refuses a function at four levels, and it counts them with a model
this repository worked out and wrote down: a guard is not a level, a `try` block is not a level, a
`catch` is, a `switch` counts once rather than once per case, and a nested function resets. Each of
those clauses is in the rule's header beside the sites that produced it.

`eslint/max-depth` counts every block. Registering it adds no rule the tree did not have; it adds a
**second owner** with a cruder count, and the three sites it reported are exactly the three where
the two owners disagree. One of them, `cleanStaleTempRootScratch`, is named in `no-deep-nesting`'s
own header as a false report the careful count was written to avoid: it "opens a directory inside a
`try` inside a `try` and is then two levels deep". The remedy the crude count wanted there — split
the `try`, hoist a `let`, count the stat failure separately — is longer than what it replaced, and
the considered rule had already decided that shape was fine.

So the registration is withdrawn, and with it the two edits whose only driver was the crude count:
`src/run/census-gate.ts` and `src/meta/temp-scratch-clean.ts` are back to the bodies they had.
`mutation-adjudicate.mjs` keeps its rewrite, because it stands without the rule: the three lcov line
kinds are mutually exclusive prefixes, so the body is one guard chain rather than a compound `if`
with a branch inside it.

**The rule this leaves.** Zero debt is not an argument for registering a rule. A rule earns its
place by changing a decision that no existing owner already makes, and the question to ask at
registration is not "how many sites" but "which owner already reports this shape, and does it
disagree". Where the two disagree and the existing owner is the considered one, the new rule is
reporting the remedy as the defect. `no-continue` was refused here for a related reason — it would
push 258 loop bodies one level deeper, which is what `no-deep-nesting` exists to stop.

`max-depth` at `{ max: 3 }` (80 sites today) is not a rung in the queue either, for the same reason:
the queue entry was written before `no-deep-nesting` existed, and a third setting of a duplicated
count settles nothing. What is worth measuring instead is whether `no-deep-nesting` should apply to
`vendor/pi-claude-bridge/**` and `tools/oxlint/anti-slop/**`, where it is currently off.

## `max-params` at 6, twelve sites, 2026-09-20

The rule has a ladder, not a count: **411** sites at oxlint's default of 3, **145** at 4, **40** at
5, **12** at 6, **4** at 7 and **0** at 8. That is why it shipped in rungs rather than as one
overhaul. This is the rung at 6 — the twelve functions taking seven or eight arguments.

The admission test passes at every site because `anti-slop/no-object-parameters` bans the broad
`object` type on a parameter, not a named input interface, and the named interface is already the
file-local idiom: `pi-built-process.ts` has `settleWorker(input: WorkerCompletion, code)` three
functions above one of the sites. Each fix names the record the function was already being passed in
pieces, and the type stays unexported unless another file needs it — `tools/loc/source-policy.ts`
reported all four that did not.

| site | became |
| --- | --- |
| `startPiBuiltWorker` (8) | `PiBuiltWorkerOpening`: runtime, bundle, start, digest and the three hooks |
| `receiveWorkerMessage` (8) | `WorkerBinding` + the line; the binding is fixed for the worker's life |
| `withCustomToolReceipts` (8) | `tools` + `BuilderToolReceiptSession` |
| the `spawn` method (8) | `ToolLaunch`: where it runs, what it runs, the wall it runs under |
| `workerEvents` (7) | `BuiltTurnRecord` + one observation pair |
| `exhaustedOutcome` / `completedOutcome` (7 each) | `BuiltCaseEvidence`; they differed in one argument of seven |
| `recordAllowedPaths` (7) | `IsolatedRunEvidence`: what the OS did |
| `promoteCandidate` (7) | `PromotionInputs`, replacing three trailing defaults |
| `runUnderLock` (7) | `LockedRun`, the whole call |
| `evaluateIsolated` (7) | `EvaluatorHost`, the four host-side controls |
| `settledToolResult` (7) | `ToolRunWall`: the clock and the plan that must still hold |

Two things the pass turned up.

**The pair that differed in one argument.** `exhaustedOutcome` and `completedOutcome` took seven
arguments each and shared six of them. That is the shape `ana/no-arms-differing-in-one-term` exists
for, and the parameter count is what made it visible: with the shared six behind one record, the two
functions read as the two ways a solve ends rather than as two long lists to compare by eye.

**Naming a parameter can collide.** Calling the new record `dispatch` in `pi-built-process.ts` tripped
`eslint/no-shadow` against a local `const dispatch` further down. The fix is a name, not an
exception, but it is worth knowing that a mechanical parameter rewrite meets the other rules on the
way in.

**Rung 5 next**, at 40 sites. Two of them are in the same file this pass touched — `invoke` and
`receiver` in `evaluator-process.ts`, both at exactly 6 — which is the usual sign that the rung
above was the right place to stop rather than the end of the work.

## `max-params` at 5, twenty-eight sites, 2026-09-20

The rung below 6, taken the same day. Every one of the 28 was at exactly 6 — no sevens or eights
survived the rung above — so the ladder's steps are real steps rather than an artefact of counting.
Afterwards: **0** at 5, **115** at 4, **384** at 3.

**Bundle the tail, not the whole list, when the tail already had defaults.** Six of the sites ended
in optional or defaulted parameters (`spawnCollected`, `recordFindingTool`,
`readPublicExperimentHistory`, `analysePair`, `builtBatteryRuntime`, `piBuiltSolver`). Taking only
those into one record with a `{}` default left every short call untouched: of roughly ninety
`recordFindingTool` calls in the review tests, only 48 passed a fifth argument and needed an edit.
Where the six were peers instead — `readEvidencePage(repoRoot, project, runId, offset, query,
category)` — one whole record is right, because that is the call site the rule is actually about.

**Three name collisions in forty rewrites.** After `dispatch` in the rung above, `invocation`
shadowed a module-level `const invocation` in `pi-tool-call.ts`, and `hops` collided with a field
the function returns in `coupling.mts`. The remedy names a thing the file often already names. The
compiler and `no-shadow` catch every one, so a mechanical pass is safe — it is just not free of
naming.

**Five of the 28 were test-table callbacks, which is a different shape.** Their arity comes from the
data table above them, not from a call site, so the admission test has to be asked of the table:

- `test/turn-usage.test.ts` called `usage(100, 40, 64, 8, 212, 0.0123)`. Six bare numbers is the
  clearest single illustration of what the rule is for; the counts are now one named record and the
  price stays its own argument.
- `test/launch-run.test.js` rows carried five long strings positionally. Each row became
  `["launchd", { service, running, notRunning, absent, foreign }]`, which keeps `%s` in the test
  title working and names the columns.
- `test/experiment-intent.e2e.test.ts` and its tool variant destructured six columns only to
  re-assemble them for `checkIntent`, which destructures the row itself. The row now travels whole.

**Bun's `each` callback carries a trailing `done`.** `(...row) => checkIntent(adopted, row)` looks
like the obvious fix and does not compile: the rest parameter captures seven elements, not six. That
is why the rows are wrapped as `[row[0], row]` — the first element still feeds `%s`, and the second
is the row the helper wants. Proved with a two-row scratch test before the e2e files were touched,
because those files build an adopted product before they assert anything.

Eight new types had to drop their `export` again; `tools/loc/source-policy.ts` named all eight.

**Rung 4 is 115 sites** — `src` 71, `.claude` 25, `test` 14, `tools` 4, `vendor` 1 — which is five
times this pass and a genuine overhaul rather than a rung. Measure whether the admission test still
passes there before registering it: at four arguments the named-record remedy starts competing with
functions that legitimately take four peers.

## `ana/no-tangled-ternary`, forty-seven sites, 2026-09-20

The nested-ternary question, asked three times. `eslint/no-nested-ternary` reports **193**;
`unicorn/no-nested-ternary` reports a different 193 and wants parentheses the formatter then
removes, so its gate can never reach zero. The rule that shipped reports **47** and every one of
them has a mechanical remedy.

Both built-ins refuse `left < right ? -1 : left > right ? 1 : 0`. That is what a comparator looks
like in every language that has ternaries, and a rule that bans it is describing the language rather
than this repository. So the shipped rule asks two narrower questions:

- **How long is the tail.** `a ? x : b ? y : z` is three cases and reads fine. Four is where the
  last value is only reachable by holding three rejected conditions in mind, and four is what the
  rule reports — 17 sites. The remedy is usually the `Map` the conditions were spelling out
  (`test/replay-cli.test.ts`, `test/verifier-lifetime.test.ts`, `source-delta.mjs`) or a function
  whose branches return (`discriminationOf`, `bandZone`, `accessKind`, `censusDecision`,
  `reservedName`, `adjudicate`).
- **Where it grew.** A ternary in the *test* or *consequent* of another is reported at any length —
  31 sites, all in the consequent, none in the test. There the `:` closing the outer ternary belongs
  to a condition several tokens back, and the remedy is one `const` above naming the inner decision.

**The admission test rejected the obvious remedy.** "Invert the outer test" turns
`a ? (b ? x : y) : z` into `!a ? z : b ? x : y`, which is a clean tail — and
`unicorn/no-negated-condition`, which is on, reports both `!a ? …` and `a !== b ? …` in a ternary
test. The two rules would have traded findings forever. An `if` guard with no `else` is not
reported, which is why "a function whose branches return" is a remedy and "invert the test" is not.
That interaction is written into the rule's own doc comment, because the next reader will think of
the inversion first.

Breakdown of the 48 before the taste-rule override, which drops the one site in
`tools/oxlint/anti-slop/**`: `src` 24, `.claude` 11, `test` 6, `packages` 6, `tools` 1.

**The test-position branch reports nothing today and stays.** The rule's claim is that a ternary may
grow along its tail and nowhere else. Dropping the branch because no site currently trips it would
make the rule say something narrower than it means, and the first site to appear would appear
unopposed.

**Two findings arrived from other rules during the pass.** `leafCategory` came out at two statements
and `ana/no-single-caller-helper` took it straight back — it went to three by testing `null` on its
own line, which also reads better. `reservedName(name, preset, names.has(tool.name))` tripped
`ana/no-positional-boolean-parameter`; the third parameter is now
`"listed-twice" | "first-listing"`. Both are the ruleset checking the remedy, which is the point of
asking the admission test at every site rather than once.

Extracting `aggregateDecision` out of `src/claim/judge.ts` also made that file's entry in
`tools/loc/source-policy.json` stale — 205 nonblank lines, no function over 115 — and the copy-limit
gate says so out loud. The entry is gone rather than re-frozen at a lower number.

## `max-statements` refused, 2026-09-20

Measured at 30 statements: 30 sites — `.claude` 18, `test` 8, `src` 3, `vendor` 1. At 40 it is in
single digits. The distribution is the refusal: the long functions are in skill scripts and test
setup, where a long body is a script reading top to bottom, and `src` has almost none. A rule whose
findings are four fifths outside the tree it is meant to shape is measuring the wrong thing.

The line count already has an owner that does this better. `tools/loc/source-policy.ts` holds new
functions at 115 lines, and `tools/loc/complexity-policy.ts` holds every function below cyclomatic
22 and 80 nonblank lines. Those two read the same functions and disagree with `max-statements` on
which ones matter: functions over 115 lines are `src` 6, `tools` 3, `vendor` 1, `test` 153,
`.claude` 19, `packages` 4 — the same skew, already handled by a gate that knows which roots it
governs. A third owner counting statements would report a fourth list and change no decision.

## The lint step no longer needs a Node binary, 2026-09-20

The first version of this section said the type-aware rules had been unreachable. That was wrong,
and how it was wrong is the more useful half of the entry — it is recorded below. `.oxlintrc.json`
has carried `options.typeAware` all along, so every type-aware rule in the config was already
running on every push.

What the lint step really carried was a hidden dependency on Node:

```text
env: node: No such file or directory
Error running tsgolint: "exit status: exit status: 127"
```

oxlint runs the type-aware rules in a child process, `tsgolint`, and looks for it at
`node_modules/.bin/tsgolint`. That entry is a `#!/usr/bin/env node` shim. The linter itself is a
native executable — `node_modules/@oxlint-tsgolint/<platform>-<arch>/tsgolint` — and the shim is the
only thing between it and a Node binary. Reproduce it by taking `node` off PATH:

```sh
env PATH=/usr/bin:/bin bun node_modules/oxlint/bin/oxlint -c .oxlintrc.json src   # exit 1
```

It exits 1 rather than skipping the rules, so nothing was ever silently unlinted. But it means the
lint step passed on this machine only because a shell-scoped version manager had left a `node` on
PATH, and a detached `env -i` launch — how `tools/fullrun-launchd.zsh` starts a paid run — carries
no such thing. A gate that passes or fails on which shell started it is not a gate.

`OXLINT_TSGOLINT_PATH` (found in the strings of the oxlint native binding) points oxlint straight
at the executable and skips the shim. `bun run lint` is now `tools/runtime/lint.ts`, which resolves
the platform package with `Bun.resolveSync`, reports the missing package by name if the install
does not carry it, and spawns oxlint with that variable set. With `node` stripped from PATH it now
exits 0, and a fixture holding one nullable boolean in a condition still reports — the rules run,
they are not quietly absent. `test/runtime-lint.test.ts` imports the same resolver, for the same
reason: before, that test passed or failed on the invoking shell too.

### How the wrong reading happened, and the trap it leaves behind

A single rule is measured with a scratch config holding that rule alone. A scratch config does not
carry `options.typeAware`, and oxlint reports **zero** for a type-aware rule under such a config
without saying why — no warning, no "0 rules", just an empty result. Reading that empty result
against the repository's own config, which does carry the option, produced the conclusion that the
rules were off everywhere.

So `tools/runtime/lint.ts` passes `--type-aware` as well, although the config already sets it. For
the ordinary run the flag changes nothing. It is there so that `bun run lint -c <one-rule-config>`
— the measuring recipe in `SHAPE-RULESET.md` — cannot return a silent zero. A flag repeated once
costs less than a census that reads as an empty tree.

## `typescript/strict-boolean-expressions`, one hundred and thirty-seven sites, 2026-09-20

Raw, with no options, the rule reports **868**. That number is not the rule's opinion of this tree:

| class | count | where |
| --- | --- | --- |
| `any` in a condition | 540 | `.mjs` 510, `.js` 23, `.ts` 7 — by root, `.claude` 510, `test` 28, `src` 2 |
| nullable string | 188 | `src` 107, `.claude` 50, `vendor` 17, `packages` 8, `test` 5, `tools` 1 |
| everything else | 137 | the rung that shipped |

**`allowAny: true`, because 533 of the 540 are in files that have no types at all.** A condition in
an untyped `.mjs` skill script is `any` because the whole file is, so the only spelling that passes
is to type the script. The rule would be measuring the absence of JSDoc, which `checkJs` already
governs, and it would be measuring it almost entirely in one root. That fails the admission test:
no legal spelling exists at the site, only at the file.

**`allowNullableString: true` for now, because 188 sites is a rung of its own** and it is evenly
spread — `src` holds 107 of them, so unlike the `any` class it is a real property of the tree. The
remedy there is one shared predicate rather than 188 inline `!== undefined && !== ""` expansions,
and that is a separate change with its own argument. Recorded below as the next rung.

### What the 137 were

| class | count | remedy |
| --- | --- | --- |
| nullable boolean | 92 | `x === true`, or `x !== true` where a `!` was consumed |
| inconsistent union | 15 | the comparison the branch actually wants |
| nullable number | 12 | `(n ?? 0) > 0`, or `!== undefined &&` before the comparison |
| object, always truthy | 11 | a guard the checker had already proved dead |
| nullish, always falsy | 7 | the same, from the other side |

The 92 went through a script over the reported spans; the other 45 were read one at a time. Two
traps made the scripted part less mechanical than it looks, and both are worth knowing before the
next type-aware rule is cleared this way.

**The reported span is the operand, not the condition.** At a negated site it sits directly after
the `!` — `if (!descriptor.enumerable)` reports `descriptor.enumerable` — so replacing the span with
`span === true` yields `!x === true`, which parses as `(!x) === true` and inverts the meaning. The
fix consumes the `!` and emits `x !== true`.

**Sixteen spans were the enclosing call, not the nullable value.** When an array predicate returns
`boolean | undefined`, the rule reports the whole `.filter(…)` or `.some(…)` expression, so a span
rewrite produces `expect(rows.filter((r) => r.pass) === true)`. The remedy is inside the callback.
Nine of the sixteen were that; the other seven were genuinely nullable calls in a condition, made so
by an optional chain (`measured?.some(…)`), where appending to the span was right. The two cases
are told apart by whether the span is itself in a conditional position, which a script cannot see
from a line and column.

### What the pass found that style rules do not

Eighteen of the 137 were conditions the type checker had already proved could not change. Six of
them are worth naming, because each is a check somebody wrote on purpose and the checker had
quietly retired:

- **`src/backends/oauth/callback-flow.ts`.** `manualError` is assigned inside a `.catch` callback
  and read twice: once after the browser race settles, once after `await manualPromise`. The first
  read throws, which narrows the variable to `undefined` for everything after it, so the checker
  proved the second read dead — while at runtime the callback assigns between the two. Both reads
  now go through one closure, where the declared type survives. This is the find of the pass: a
  re-check the type system had ruled out and the runtime had not.
- **`packages/ui/src/components/primitives.tsx`.** `navigator.clipboard` is non-nullable in the DOM
  types, so the fallback branch was dead — and it is the branch that makes the copy button work
  over plain HTTP. The fact is now in the annotation.
- **`.claude/skills/whole-run-investigation/scripts/archive-shape.mjs`.** `pattern = null` with no
  JSDoc infers the type `null`, so `pattern.test(value)` was unreachable and every caller passing a
  `RegExp` was invisible. One `@param` restores it.
- **`.claude/skills/whole-run-investigation/scripts/manifest-compose.mjs`** and
  **`.claude/skills/zip-run/scripts/zip-run.mjs`**, the same shape on `expected = null` and on four
  fields of an `args` object initialised to `null`.
- **`test/campaign-status.test.mjs`.** `if (nonResult)` over an element of a `[string, boolean]`
  tuple, where the checker sees `string | boolean`. It was
  `.claude/skills/run-improvement-campaign/scripts/status.test.mjs` when this was written, and
  moved in `094d1306e`, which gave each skill suite its own file under `test/`.

The remaining twelve are `vendor/pi-claude-bridge` reading SDK payload fields the SDK types promise
are present, and two array reads that `located()` can miss with `-1`. Those guards are real; the
annotation now says so.

### The next rung

**188 sites at `allowNullableString: false`** — `src` 107, `.claude` 50, `vendor` 17, `packages` 8,
`test` 5, `tools` 1. Reproduce with `allowNullableString` set to `false` and `allowAny` left on.
Expect one shared predicate rather than 188 expansions of `x !== undefined && x !== ""`, because
that expression appearing 188 times is the argument for naming it once.

**`typescript/no-unnecessary-condition` re-measures at 358** on this tree, down from the 489 in
`SHAPE-RULESET.md` because this pass removed some of the same dead conditions from the other side.
It stays queued behind the rung above, and still as a defect hunt with a reason on each line.

### One finding came back from another rule

Turning `else if (args.target !== null) usage(…)` into an `if`/`else` chain gave
`unicorn/no-negated-condition` a site it had not had before. Swapping the arms — `=== null` assigns,
`else` refuses — reads better than what was there. The same exchange happened twice in the ternary
pass, and it is the reason for asking the admission test at every site rather than once per rule:
the remedy is what the other rules judge, not the finding.

## The chain exemption asks for peers now, seven sites, 2026-09-20

`ana/no-single-caller-helper` let a call keep its name whenever any ancestor up to the enclosing
function was a `LogicalExpression`. The written reason is peers: `builder-execution-current.ts`
holds twenty predicates of one shape, each read once, each an operand of a long `&&`, and
substituting one body into a thirty-term chain leaves that term spelled differently from its
nineteen neighbours. Two-term `a || b` and `x ?? f()` have no such neighbour — the other term is
usually a literal — and the exemption covered them anyway.

Measured before the change: 15 sites exempt, 8 chains of three or more and 7 of two. Requiring
three operands keeps all three sites in the file the paragraph names and reports the seven:
`flagValue`, `hostPathDirs`, `remainingBuilderTurnMs`, `isTruthyFlag`, `builtDefaultEffort`,
`stamp` and `cliOwnsTool`. The eighth, `defaultOpenRouterModel`, surfaced a rung earlier when the
nullable-string pass rewrote its `||` and is already inlined.

Two of the seven are worth knowing, because they are the shape that will come back. `hostPathDirs`
and `isTruthyFlag` are two-statement bodies read from the lazy side of `??` and `||`, so inlining
them hoists a `const` above the operator and makes that work eager. Both were still the better
spelling — a `PATH` split and a `trim().toLowerCase()` cost nothing, and `isTruthyFlag` inlines
into a five-term chain, which is the vocabulary shape the exemption is for. A body that is not one
expression **and** whose eager evaluation would cost something is the case that would earn a second
exemption; it did not appear here, so none was written.

## The nullable-string rung, one hundred and eighty-seven sites, 2026-09-20

`allowNullableString` came off. The rung above recorded 188 sites; this tree measured **185**, and
**187** once `packages/ui` had its dependencies (below). One shared predicate carried 184 of them:

```ts
/** True when a string is present and holds something other than the empty string. */
export function hasText(value: string | null | undefined): value is string;
/** `value` when it holds text, else `fallback` — the `value || fallback` that meant "blank is unset". */
export function textOr(value: string | null | undefined, fallback: string): string;
```

`hasText(x)` is exactly `Boolean(x)` for a string, so the exchange is behaviour-preserving at every
site, and it narrows, so it also serves where the old condition guarded a use. `textOr` is the
`a || b` half: 23 of the sites were fallbacks, not conditions, and expanding those in place would
have produced `x !== undefined && x !== "" ? x : y` twenty-three times.

The admission test was asked on a sample of 20 before the rung was registered, because the whole
question is whether `""` is reachable. At about 12 of the 20 it plainly is: an environment variable
set to blank arrives as `""` and survives `.trim()`, `searchParams.get("code")` returns `""` for
`?code=`, and a model can send `""` for a required tool argument. At the rest the empty string is
unreachable today and the predicate costs nothing to read. That is the rung: not a bug hunt, a line
that says which of the two nothings it means.

### What a mechanical span rewrite could not do

159 sites were wrapped by a script over oxlint's JSON spans, 26 by hand. The script reads bytes,
because `offset` counts bytes and this tree is full of em dashes — a character-indexed first
version corrupted every span in every file containing one. The 26 it left are the two shapes a span
rewrite cannot see: a value position (`a || b`, where the fix is `textOr`, not a wrap) and a span
that is not the whole condition.

### A local binding collided with the shared name

`vendor/pi-claude-bridge/convert.ts` already had the concept, as `let hasText = false` two lines
under what became a call to the imported `hasText`. The wrap produced a file that type-checks as a
boolean being called, and `eslint(no-shadow)` reported it before `tsc` did. The local flag is now
`carriedText`. Worth remembering when a codemod introduces a name: the tree may already use it for
something else, and the collision is silent at the point of insertion.

### Two files at a frozen size refused the import line

`src/builder/tools.ts` is held at 403 nonblank lines and `src/truth/probes.ts` at 436 in
`tools/loc/source-policy.json`. An import line is a line, and both went one over. Three conditions
in those two files therefore spell the comparison out instead of importing the predicate. That is
the frozen limit working as intended — it asks for the smaller honest form, and here the smaller
honest form is the one that adds nothing to the file.

### A type-aware census in a tree without its workspace packages is not a census

`packages/ui` keeps its own `bun.lock` and its own `node_modules`, and `scripts/worktree.sh setup`
does not create it. In a tree without it, `@types/react` does not resolve, every React type in
those files degrades to an error type, and the type-aware pass reports things that are not there:

```text
packages/ui/src/components/primitives.tsx:12:4  no-redundant-type-constituents:
  'HTMLAttributes<HTMLSpanElement>' is an 'error' type that acts as 'any'
packages/ui/src/components/picker.tsx:65:32  no-unnecessary-type-assertion: unnecessary
```

Neither file was in the diff; `picker.tsx` is not touched by this change at all. One
`bun install --frozen-lockfile --cwd packages/ui` and both disappeared — and two **real**
nullable-string sites appeared in their place, in `App.tsx` and `views/current-run.tsx`, which the
absent types had been hiding. So the failure is two-sided: it invents findings and conceals them.
Check `packages/ui/node_modules` exists before reading a type-aware number, the same way
`BASELINE.md` already says to run the rule through `bun run lint` rather than bare `oxlint`.

### `ana/no-single-caller-helper` gained a site, and its exemption is four times its reason

`defaultOpenRouterModel` in `src/backends/openrouter-backend.ts` has had one caller for as long as
it has existed. It went unreported because that call sat inside a `||`, and the rule exempts any
use below a `LogicalExpression`. Rewriting `deps.model?.trim() || defaultOpenRouterModel()` as
`textOr(…)` took the call out of the chain and the rule reported it at once. It is inlined here.

The exemption's stated reason is `tools/outcome/builder-execution-current.ts`: twenty one-line
predicates, each read once, each an operand of a long `&&`, which are a vocabulary rather than
hidden lines. Measured on this tree, the exemption hides **15** sites, and only 3 of them are in
that file. Requiring the enclosing chain to hold **three or more operands** — so a two-term `a || b`
fallback stops qualifying — leaves 8 exempt, including all three the doc names, and reports 7:

```text
src/verify/tool-inventory.ts             hostPathDirs
src/author/builder-session.ts            remainingBuilderTurnMs
src/backends/codex-app-server.ts         isTruthyFlag
src/backends/pi-built.ts                 builtDefaultEffort
tools/harness/cli.ts                     stamp
vendor/pi-claude-bridge/provider.ts      cliOwnsTool
.claude/skills/test-impact-and-consolidation/scripts/case-census.mjs   flagValue
```

That is the next rung, and it is a rule change rather than a threshold: `chainTerm` walks to the
outermost enclosing chain and counts its leaf operands.

Two things to settle while making it. `isVendoredVerbatim` is gone as of 2026-09-20 — it read as
"vendor" and meant `tools/oxlint/anti-slop` alone, and the premise under it was never true; both
trees are in scope for this rule now, and the anti-slop sites it was hiding are swept. And
`provider.ts` is held at 728 lines in `copiedFileLimits`,
which the rule does not read: it charges each report against the 115-line function ceiling and
complexity 22, the two ceilings its doc names, and not against a file frozen at its size. Inlining
into such a file fails the gate the same way, which is the admission test failing at one site. This
pass hit that from the other direction — `src/builder/tools.ts` and `src/truth/probes.ts` had no
room for an import line, three sections above.

### The next rung after that

`typescript/no-unnecessary-condition` at 358, read one site at a time in the section below.

## `typescript/no-unnecessary-condition` refused at 358, one rule shipped instead, 2026-09-20

The census over the whole lint scope, by message: 168 unnecessary optional chains on a non-nullish
value (src 63, tools 61, test 20, `.claude` 15, vendor 9), 109 comparisons whose two sides have no
overlap, 60 comparisons between literal values (`.claude` 34, src 18, tools 3, test 3, vendor 2), 8
always-falsy conditions, 8 always-truthy, 5 always-nullish.

The **20 constant-condition** sites — the always-truthy, always-falsy and always-nullish rows — are
what the rule exists for, and each was read. **One** was a defect. Sixteen are the checker being
wrong about this tree, in four repeatable ways.

**A `let` a closure assigns — nine.** Control-flow analysis does not follow an assignment made
inside a callback, so a flag set in a `forEach` or a stream handler reads as never-assigned at the
`if` below it. `src/builder/file-window.ts:166` and `:193`, `src/truth/verification-runner.ts:494`
and `:497`, `src/builder/command-guard.ts:245`, `src/review/review-sources.ts:70`,
`tools/runtime/test-suite.ts:348`, `test/read-root-attestation.test.ts:26`. Deleting any of those
checks changes what the program does.

**`lib.d.ts` promises more than the runtime keeps — two.** `JSON.stringify` is declared to return
`string` and returns `undefined` for `undefined` or a function (`src/meta/json-runtime.ts:45`); a
`RegExpMatchArray` indexes as `string`, and an optional group that did not participate is
`undefined` (`tools/oxlint/ana/rules/tree-findings.ts:223`).

**A validator over external input — two.** `src/meta/file-map.ts:27` and
`src/claim/usage-reader.ts:39`. The declared type is the promise and the check is what makes it one;
AGENTS.md rule 8 says so in as many words, and deleting the check deletes the guarantee.

**A deliberate exhaustiveness check — one.** `src/backends/model-preflight.ts:98` is the arm that
exists so that widening a closed union fails the build.

Two of the rest are `while (true)`, which the rule's own `allowConstantLoopConditions` option exists
for and this build does not expose.

Sixteen of twenty, and the fix the rule asks for — delete the check — is wrong at every one. That
fails the admission test outright, so it is refused as a gate rule rather than baselined per file.
Two things would reopen it: `allowConstantLoopConditions`, and a checker that follows an assignment
through a closure.

### The defect it did find has its own rule, and that rule needs no types

The one real finding was `.mjs`: a parameter defaulted to `null` whose caller passes a string. In an
unchecked JavaScript file the default is the **only** type information the binding carries, so the
parameter's type *is* `null`, the type with one value. Every other value a caller passes is
invisible, and every condition over it has one answer. That is how the strict-boolean pass found
three dead branches — `archive-shape.mjs`, `manifest-compose.mjs` and `zip-run.mjs` each took a
`RegExp` on a parameter defaulted to `null`, and the branch that used it was unreachable for the
whole of the checker's reading.

`tsconfig.json` includes `src/**/*.ts`, `tools/**/*.ts`, `test/**/*.ts`, `.claude/**/*.ts` and
`.claude/**/*.mts`. The `.mjs` tree is in no program at all, so the type-aware lint pass is the only
reader these files have.

**`ana/require-type-for-null-default`** is that reading made cheap, and it is pure syntax, which is
why it can run where the type-aware rules are least useful. **37 sites, every one `.mjs` and every
one under `.claude`**, fixed here. Two shapes:

- a parameter, including one a destructuring pattern introduces — 22 sites, one
  `@param {string | null} [fallback]` each;
- a property of an object literal the same file later assigns — 15 sites. `{ campaign: null }`
  beside `values.campaign = value` types the property `null` and makes the assignment invisible, so
  `values.campaign === null` is again a comparison with one answer. A literal whose `null` is the
  value it keeps is exactly typed already and is not reported.

Both declarations are admitted for a property: a `@type` over the literal, and a cast on the one
value. The cast is what scales — `select-best-runs.mjs` builds a settings record of twelve
properties of which five are `null`, and annotating the object means restating the seven the author
never had to write down. Four sites took the `@type`, over the two three-property literals that hold
them; eleven took a cast.

Two `.ts` parameters have the same syntax and are not reported. `toolTree = null` in `built-bash.ts`
and `publicArtifactSchema = null` in `built-starter.ts` are destructured out of an annotated options
type, which is where their types come from. A TypeScript file can annotate, so the rule stays out of
one.

The JSDoc test is loose on purpose: a block that opens a `@param {` or `@type {` and mentions the
name counts as a declaration. Reading it tighter would mean parsing nested brace types to admit
`@param {{terminal: Terminal|null}} [options]`, and an author who names the parameter inside a type
tag has answered the question the rule asks. `verifiedTraceChallenge` in `manifest-compose.mjs`
already carried exactly that line and went unreported, which is the check on the check.

### The rung after this one

`ana/no-single-caller-helper` at 3 statements / 7 lines (74 sites), then 4 / 9 (187). `max-params`
at 4 (115 sites). And four typescript rules registered nowhere, measured here for the first time:
`require-array-sort-compare` 24, `no-base-to-string` 17, `restrict-template-expressions` 10,
`no-misused-spread` 1 — adjudicated in the next section.

## The last four unadjudicated typescript rules, refused on one measurement, 2026-09-20

`require-array-sort-compare` (24), `no-base-to-string` (17), `restrict-template-expressions` (8)
and `no-misused-spread` (1) were the four the previous census had counted and nobody had read.
Re-measured on `094d1306e`: fifty sites, and **every one of them is a `.mjs` file** — forty-nine
under `.claude`, and one in `test/` only because `test/campaign-status.test.mjs` moved there from
`.claude` earlier in this stack. Not one is in `src/`, `tools/`, `packages/` or `vendor/`.
(`restrict-template-expressions` was 10 in the earlier count and is 8 now; two of its sites went
out with the strict-boolean and nullable-string passes.)

That distribution is the whole finding. These rules are not reading the code. They are reading what
the checker can infer about code that carries no annotations, and `.mjs` is in no typecheck program
at all.

### The twenty-four sorts are twenty-four string sorts

`require-array-sort-compare` has `ignoreStringArrays` on by default, so a `string[]` never reports.
All twenty-four report, and all twenty-four sort strings:

| shape | sites |
| --- | --- |
| `[...aSet].sort()` over safeguard ids, clause names, caller ids | 9 |
| `[...map.keys()].sort()` over file and surface names | 5 |
| `[...new Set(rows.map((r) => r.field))].sort()` | 4 |
| an array the file collects, then sorts — rule ids, clause prefixes, walked paths | 3 |
| `[...map.entries()].sort()` over `[id, count]` pairs | 2 |
| `rows.map((r) => r.path).sort()` | 1 |

The Sets and Maps are filled from JSON in unchecked JavaScript, so their element type is not
`string` to the checker even though it is `string` at every call — `select-best-runs.mjs` even
filters with `isString` immediately before the sort the rule complains about. The two
`entries()` sorts compare `"id,count"` lexicographically; the ids are unique map keys, so the
comparison never reaches the count and the order is by id. Correct, if oblique — and the compare
function the rule asks for changes no output at any of the twenty-four.

### The other three are the same class from a different angle

`${ledger}` in `watch-contract.mjs` destructures `[["closures", CLOSURE_STATUSES], …]`, whose
inferred element type is `string | Set<string>`; `ledger` is a string at every iteration, and five
of the eight `restrict-template-expressions` sites are that one binding used five times.
`${detail(now)}` in `watch.mjs` destructures `BUILDER_LIMITS` the same way. `String(a.at)` in
`timeline.mjs` and `String(session.exitCode)` in `validate-reports.mjs` are the defensive `String(…)`
an author already wrote around a JSON value — `no-base-to-string` reporting a `String()` call is the
rule arguing with the fix for itself. `{...row}` in `prediction.mjs` spreads a ledger row the
unannotated reader types loosely enough for `no-misused-spread` to suspect an array.

### What it would cost to make the checker right instead

The honest alternative to refusing the rules is to type the tree they are reading, so the inference
they depend on is worth something. Measured: `tsconfig.json` plus `allowJs`, `checkJs` and
`.claude/skills/**/*.mjs` in `include`, on `10de83e75`:

```text
2994 errors across 97 files
1605  TS7006  Parameter 'row' implicitly has an 'any' type
 344  TS7005  Variable implicitly has an 'any[]' type
 340  TS2339  Property does not exist on type '{ _: never[] }'
 140  TS7031  Binding element implicitly has an 'any' type
  64  TS18047 possibly 'null'
```

Worst files: `manifest-inputs.mjs` 160, `manifest-compose.mjs` 133, `extract-prompt-surface.mjs`
129, `status.mjs` 113, `prose-classify.mjs` 98.

Fifty-four per cent of it is one demand — `noImplicitAny` asking for a `@param` on every parameter
in the tree — and the repository has never made that demand of `.mjs`. So the four rules sample a
population nothing type-checks and nothing intends to, at fifty sites with no defect among them.
Refused as a set, recorded here once rather than as four entries.

### The reopening condition

These four go back on the table the day `.claude/skills/**/*.mjs` enters the typecheck program.
`ana/require-type-for-null-default` is the first payment towards that, and it is deliberately
syntax-only: it asks for the one declaration that is *always* wrong to omit, and it keeps working
whatever the checker can infer around it. Count the remaining `TS7006` before proposing the rest.

With these adjudicated, every typescript rule the census has ever counted now has a decision.

## `ana/declarations-before-the-first-function`, 965 sites, 2026-09-20

Every type, interface and module constant at the front of the file, then the code. 965 sites in
339 files: 549 types and interfaces, 416 constants. By root, `src` 561, `test` 212, `.claude` 102,
`tools` 69, `packages` 11, `vendor` 9, `starters` 1. The worst files were
`src/solve/built-starter.ts` at 25, `src/builder/command-guard.ts` 18,
`src/review/epoch-review-findings.ts` 15 and `src/verify/host.ts` 14, each of them an alternation:
a function, the interface it returns, another function, the union that interface joins. A reader
looking for the shape of `GeneratedToolStart` had to read the whole file to learn whether it was
there.

### Three measurements, each one a correction of the last

| measured by | sites | files |
| --- | --- | --- |
| the throwaway script in `SHAPE-RULESET.md` | 716 | 213 |
| the first rule, which tested a constant's position | 873 | 304 |
| the rule as shipped | 965 | 339 |

The script under-counted by a fifth. `no-inline-schema-literal` over-counted by a factor of
fourteen from the same kind of script a week earlier — the error has no favoured direction, which
is the point. **A rule is the only thing that counts its own sites**, and a script that does not
implement the rule's conditions is not measuring that rule.

### What moves, and what stays

A `type` and an `interface` move unconditionally: both are erased before anything runs, so their
position is a reading decision and nothing else. A `const` has an initialisation order to break,
so it moves only when hoisting it cannot be observed. That is two questions, and the rule asks
both.

**Does the initialiser do anything?** A call, `new`, `await`, a tagged template, an assignment or
an update says yes, unless it is one of the builders with no result but its value: `Set`, `Map`,
`WeakSet`, `WeakMap`, `RegExp`, `URL`; `Object.freeze`, `Object.keys`, `Object.entries`,
`Array.from`, `Math.max`, `JSON.parse`, `Number("3")`, `` String.raw`…` ``. `Math.random` and
`Date.now` sit in those same namespaces and are absent, and `new Date()` reads the clock.

**Does it read a name whose value depends on where the read happens?** A name is safe when nothing
can change it between the front of the file and here: an import, a function declaration (hoisted,
so it exists before any statement runs), a built-in namespace, and any `const`, `class` or `enum`
the file already declares above the first line of code. A module `let`, a `var` and a `const`
still sitting below the code are not. `const SIZE = LATER.one` is therefore movable on the pass
after `LATER` moves, which is one of the reasons the fixer runs to convergence.

The first rule asked the position question instead — a constant declared after any runnable
statement was refused — and that refused `export const TABLE: Record<string, number> = { one: 1 }`
for standing below a function it has nothing to do with. Purity is the property the argument
actually rests on; testing it directly deleted two fields and an index scan from the rule and
found 92 more sites.

### Two refusals, found by reading what the widening caught

The widening added 100 sites. Reading them gave back 9:

1. **A narrowed read.** `const runner = Bun.argv[0]` is `string | undefined`; `if (runner ===
   undefined) throw …` is the file's first line of code; and `const bun: string = runner` below it
   compiles only because of that guard. Hoisting it is a clean runtime move and a type error,
   which is a false positive whatever the runtime says. So a read of a name some test above it
   narrows is barred exactly like an unsafe one. Only a name the file itself declares is
   narrowable: `if (isBoolean(value))` names an imported predicate it merely calls and `if (x ===
   undefined)` names a global, and barring later reads of those refused two constants for nothing.

2. **A constant standing against module state.** `src/backends/pi-built-child.ts` keeps six `let`s
   and four collections in one block under its bootstrap call. The rule never moves a `let`, so
   hoisting the collections out of the middle of that block left it worse than it was found. A
   `const` whose immediate neighbour is a module `let` or `var` now stays. A blank line between
   them says the author meant two blocks, and a comment does not — two of those six `let`s are
   documented in place. The first cut of this guard walked the whole unbroken run of declarations,
   and refused a run of genuine constants that merely ended near a `let`: in the rule's own
   fixture it silenced three of five expected reports. Adjacency is the honest radius.

Not extended to `enum`: there are five in the tree, and a mechanism that can change at most five
decisions is not worth the branch.

### A third widening: a name the file erases, 2026-09-20

The safe-name set above holds imports, function declarations, built-in namespaces and the file's
own `const`, `class` and `enum` declared above the code. It did not hold a `type` or an `interface`
the file declares, and that barred every constant whose initialiser names one. `const BY_LATE = new
Map<string, Late>()` reads `Late`, `Late` is declared in this file, and the rule treated that read
exactly like a read of a module `let`.

A type name has no value to read. It is erased before anything runs, so where the read happens
cannot change what it yields, and the question the rule asks — can hoisting this be observed —
has the same answer for every type in the tree. Adding `TSTypeAliasDeclaration` and
`TSInterfaceDeclaration` to the set surfaced **8** sites the rule had been silent about, all of
them true, all taken by the fixer: `LISTINGS_BY_POLICY`, `DIGEST_BY_METADATA`, `UNRESPONSIVE_GUARDS`,
`solverStarterFactories`, `SUPPORT_BY_RUNTIME`, `children`, `bundleCache` and `contractProbeRuntime`.

`enum` stays out, and the fixture now carries both cases beside each other: `const FROM_ENUM =
Mode.One` is a read of a real value and stays where it is, while the constant reading a local
interface moves. Both tests fail with the widening reverted. The line is the same one the paragraph
above draws for a different reason, and the two readings agree — which is the check worth having,
since an erased name and a five-member mechanism are not the same argument.

### Three defects in the fixer, and the one that should not have been findable by hand

The fixer is the reason the rule is worth having: 965 hand moves would not have happened, and the
part a hand edit gets wrong is the comment. It took three corrections, and a full-tree sweep was
thrown away and redone after each.

1. **The comment beside the line above was carried off.** `getCommentsBefore` answers with the
   comment that *trails* the previous statement's line, because it does sit before this one. So
   moving `const B` out of

   ```ts
   const A = 1; // why A is 1
   const B = 2;
   ```

   took `// why A is 1` with it and left `A` bare. The guard is that a comment with no newline
   between it and the previous statement's end belongs to that statement.

2. **The blank line under a declaration was dropped.** The move took the declaration's own line
   and left the blank line that separated it behind, which closes no gap at the old site and packs
   the front of the file into one wall: the first sweep came out 660 lines shorter than it went
   in, and `src/verify/host.ts` had an interface body abutting the constant above it. The move
   carries the author's spacing now, and adds none where there was none. The final sweep changed
   339 source files and **every one of them is net zero lines**.

3. **Two call sites passed a number where the parameter had become a node.**
   `withLeadingComments` took a numeric floor, then took the previous statement itself for defect
   1 above; the two calls kept passing `body[index - 1]?.end ?? 0`. `previous?.end` on a number is
   `undefined`, so the floor silently became 0 and the guard from defect 1 never fired. **
   `tsconfig.json` excludes `tools/oxlint/**`, so no rule in this directory is typechecked** — the
   one class of defect the repository catches everywhere else went straight through, and it cost
   two debugging rounds and a discarded 306-file sweep to find by hand. That exclusion is now its
   own backlog entry in `SHAPE-RULESET.md`; it is the cheapest unbought check in the tree.

One hypothesis along the way was wrong and is recorded because it was briefly written into the
source: the mangling was first blamed on a two-element fix array being applied item by item.
Replacing it with a single `replaceTextRange` changed nothing, so that claim was false. The atomic
form was kept anyway — it cannot half-apply and needs no assumption about the order the host
applies a fix array in — but the comment above it now says only that.

### Convergence

Overlapping fixes land one per pass, so the sweep runs until the count stops moving: 627, 430,
304, 213, 152, 109, 76, 56, 43, 34, 29, 25, 21, 17, 13, 11, 9, 7, 6, 5, 4, 3, 2, 1, 0 — 25 passes.
The tail is the dependent constants: each `const SIZE = TABLE.one` waits for its `TABLE`. Relative
order is preserved throughout, because every declaration lands immediately above the first line of
code and the first line of code does not move, so a dependency that moved on an earlier pass is
still above its dependent.

### What the sweep surfaced elsewhere

`eslint/no-shadow` reported four sites after the hoist that it had never reported before:
`corpus` and `seen` in two `system-path-simulation` scripts and `runtime` in the starter's
evaluator test, each a module declaration shadowed by a parameter or a local of the same name. The
shadows are real and were there all along. The rule defaults to `hoist: "functions"`, which
reports a shadow only of a binding declared *earlier in source order*, so moving the declaration
above the function is what made them visible. That is a leniency in `no-shadow`, not fallout from
this pass; the four are renamed (`declared`, `recorded`, `noRuntime`), and whether to set
`hoist: "all"` is a separate measurement with its own backlog entry.

## Typechecking the rules this repository writes, 2026-09-20

`tsconfig.json` excluded `tools/oxlint/**`. The entry was written on 2026-08-13 for the vendored
anti-slop plugin, which upstream compiles without `noUncheckedIndexedAccess`, and the wildcard
outgrew its reason when this repository's own `ana/` rules arrived underneath it. Deleting the
entry puts 63 files into the program — 39 under `ana/`, 24 under `anti-slop/` — and the vendored
half compiles clean, so the exemption had expired some time ago and nobody had re-measured it.
The repository's own half reported **31 errors in 13 of the 33 rule files**.

### One misconception, not thirty-one problems

| code | count | what it was |
| --- | --- | --- |
| TS18047 | 14 | a possibly-null AST field read without a guard |
| TS2345 / TS2322 | 8 | the same value passed or assigned where non-null was required |
| TS2694 | 3 | `ESTree.Property` and `ESTree.Pattern`, which do not exist |
| TS2339 | 3 | a property read off a union a failed narrowing never split |
| TS2379 | 2 | `exactOptionalPropertyTypes` refusing an explicit `undefined` |

Counting error codes overstates the work by about half. The 31 are 24 edits across 5 causes, and
the largest cause is a single wrong belief: **oxlint spells an absent node `null`, and five rules
tested for `undefined`.** `no-repeated-string-literal` opened with `if (parent === undefined)
return true;` — a comparison that is never true, because `parent` is `Node` everywhere except on
`Program`, where it is `null`. That one dead line produced seven of the fourteen TS18047s, and
its neighbours' `parent.key` produced a TS2339 on top, because a read of a possibly-null value
loses the discriminant narrowing that would have given `parent` a `key` at all.

This is the reason a codemod was the wrong tool. A script that silences "possibly null" inserts a
guard or an optional chain; here that would have left the dead `=== undefined` standing and added
a second test beside it, which is the `no-widen-then-assert` shape this ruleset already refuses.
The correct edit was to change the comparison, and no fixer working from the diagnostic could
know that.

### The two that were not cosmetic

`no-pass-through-wrapper` declares its subject `ESTree.Function`, and oxlint's `Function` is the
three declaration forms alone — `FunctionType` is `"FunctionDeclaration" | "FunctionExpression" |
"TSDeclareFunction" | "TSEmptyBodyFunctionExpression"`. The rule has an `ArrowFunctionExpression`
visitor, so its own type said it does not handle the case it handles. The repair is a two-arm
alias, not an assertion.

Four rules read `.body` off a function without checking it: `no-hand-rolled-sleep`,
`no-side-effect-in-predicate`, `no-inline-block-reducer` and `no-single-caller-helper`. A
`declare function` has no body, so each of those was a `TypeError` waiting for the first file
that held one. None had been hit, which is why none had been found.

### Proof that no rule moved

Fixture tests prove fixtures. The behavioural question is whether the thirteen rules report the
same sites, and the swept tree cannot answer it: those rules cleaned it, so a census returns 4.
The corpus is `aee23b35a`, the commit before four of them were written and swept, linted twice
with the same oxlint and the same paths, changing only the absolute plugin specifier between the
two versions. Both report **77 sites, byte-identical after sorting**. Formatting, lint, the
source-policy and complexity gates and the thirteen rules' own 36 fixture tests all pass.

## Sweeping `no-unnecessary-condition` as a defect hunt, 2026-09-20

The rule is refused as a gate, for the reasons the section above records. Queue step 6 kept it as a
one-off defect hunt, and this is that hunt: **270 sites in 141 files** at `780ee9433`, measured
after the parent commits put `vendor/**`, `starters/**` and this repository's own lint rules inside
`tsconfig.json`. Any earlier census is a different number over a different program.

| the rule's wording | sites |
| --- | --- |
| unnecessary optional chain on a non-nullish value | 141 |
| the types have no overlap | 75 |
| comparison between literal values | 35 |
| always falsy | 8 |
| always truthy | 6 |
| always nullish | 5 |

This commit closes **152** of the 270 and leaves 118.

### A fixer does not need a checker

The rule ships no fixer, and the reason usually given is that deciding which arm of a dead
condition survives needs type information. That is true of the decision and false of the edit. The
rule has already done the type analysis; a fixer built from its report only has to **find the
syntax the verdict is about**, which is a parse. `tools/oxlint/unnecessary-condition-fix.ts` is
that fixer: `typescript5`, no type checker, three transforms.

| transform | what it does |
| --- | --- |
| chain | `a?.b` to `a.b`, `a?.()` to `a()`, `a?.[i]` to `a[i]` |
| nullish | `a ?? b` to `a` |
| fold | `x === null \|\| x === undefined` to `x === null` |

**Read the JSON report, not the unix one.** The unix line gives a start column, and several nodes
start there: in `a?.b?.()` the column of `a` belongs to `a`, to `a?.b` and to the whole call, each
of which would have a different `?.` removed. The JSON span gives offset *and* length, so exactly
one node matches. Guessing from the column removed the wrong `?.` at 4 sites and produced 22 type
errors. Two conversions are needed either way: oxlint counts UTF-8 bytes where TypeScript counts
UTF-16 units, and a comparison operand's span carries its leading trivia.

The fold needs a constant, and "no overlap" supplies one: if two types do not overlap then `===` is
always false and `!==` always true, whatever the operands, so a dead operand of an `&&` or an `||`
folds away without reading intent. It is confined to comparisons against `null` and `undefined`. A
dead comparison against a **domain literal** reads identically and is refused: those sites are
validators over a value an `as` asserted into shape — dead to the type, live at runtime — and
deleting the check would leave the lie standing.

One transform was tried and withdrawn: swapping `x === undefined` for `x === null`. Over 23 sites
it cleared 4, and everywhere else the value is neither, so the comparison stays dead either way.

### The first pass was wrong, and only the gate said so

Run without refusals, the fixer landed **179 edits**. The tree typechecked clean and linted clean.
The composed gate then failed **44 tests of 3837**, and **32 of the 44 came from 12 edits in six
`.mjs` files** — files whose verdicts this same day's notes, two sections down, had already proved
are judged against a different program. The finding was written before the fixer acted against it.

Repairing those 44 would have left the class. Reading all 179 edits instead took back **59 of them
across 38 files**. Three of the four members of the class are mechanical, and the fixer now refuses
them outright:

- **Outside the type program.** A type-aware verdict over a file `tsconfig.json` does not name is
  computed against a *default* program, without `strict`, `noUncheckedIndexedAccess` or
  `exactOptionalPropertyTypes`, under which almost every guard looks unnecessary. The refusal reads
  `tsconfig.json`'s own file set rather than a list of suffixes, so it follows the program rather
  than a guess about it. 34 sites.
- **A vendored tree.** A copy held at a pinned upstream commit pays a merge cost for every local
  edit, and the edit has no owner here. `vendor/`, `third_party/` and `node_modules/` segments are
  refused and `--skip=<prefix>` adds more. `tools/oxlint/simplify-census.ts` already held the same
  judgement for the same two trees. 15 sites.
- **A commented statement.** A comment names the run, the invariant or the rejected alternative a
  line exists for; the simplify contract in `AGENTS.md` says so in as many words. If someone wrote
  one over the statement holding the site, the site is a judgement rather than a typo. It is the
  bluntest of the three and it is the one that catches `tools/replay/cli.ts`, where the comment
  above the line says which of two spellings older records use. 21 sites held back.

The fourth member is not mechanical, because **the type itself is the lie**: `row?.taskId` over
bytes `parseJsonAs<T>` asserted into shape; `JSON.stringify(x)` declared to return `string` when it
returns `undefined` for `undefined`; `globalThis.Bun` declared always present inside the one
function whose job is to report a non-Bun runtime; `Subprocess.exitCode` declared `number` when a
signal kill makes it `null`; a captured `let` narrowed where the closure is written and read where
it runs. No parse sees any of these, and no refusal can be written for them.

### What a deterministic pass is worth, measured

The fixer with all three refusals was replayed against the same census on a clean `780ee9433`, and
that automatic-only tree was typechecked and run through the whole suite:

| | first pass | with the three refusals |
| --- | --- | --- |
| edits landed | 179 | 148 in 88 files |
| sites closed | — | 148 of 270 |
| type errors | 0 | 2, both `TS6133` |
| tests failed | 44 of 3837 | **14 of 3799** |
| a reader keeps | 120 | 113 |
| a reader takes back | 59 | 35 |

Of the 148 edits, **100 are byte-identical to what the hand pass committed**; 12 more differ only
by a parenthesis the tool leaves behind, which `bun run format` removes, so they arrive at the same
bytes through the gate the push already runs; 35 a reader takes back; 1 is undecidable by textual
comparison. The two remaining type errors are the same leftover in another form: a fold removed the
last read of a name and the tool does not delete the declaration with it.

**Nine of the 14 failures come from one edit the reader kept.** Dropping `?.` from
`outcome.iterations?.at(-1)` in `src/run/full-run-build-step.ts` is correct — every real producer
supplies `iterations`, and `BuildOutcome` is derived from that producer's return type — and it
fails five battery-sizing tests, three next-move tests and one promotion test because their build
doubles omit the field. The doubles were the defect; this commit completes them. The other five
failures are three edits the reader did take back: `capturedJsonStringify`'s `?? "undefined"`,
where the honest repair is the function's return type; `harness?.tools` in `built-starter.ts`,
where the harness is Builder-authored; and two in the host runtime policy.

So the honest reading of a deterministic pass over a rule with no fixer: it produces **113 of the
152 removals this commit makes, 74 per cent**, and **76 per cent of what it proposes survives a
reading**. A quarter of its output has to come back, and no cheaper signal than reading finds
which quarter — the typecheck is clean and the suite catches 5 of the 35. The 39 removals it
cannot reach are hand work of a different kind: seven exhaustive if-chains converted to a `switch`
whose `default` keeps the original refusal, eight dead guards in this repository's own lint rules,
`capturedJsonStringify` given a return type that admits `undefined`, and sites whose honest repair
is at an assertion rather than at the condition.

### Why the rule stays refused: four causes, each proved

**A type-aware verdict over a file the tsconfig does not name is not a fact about this tree.**
oxlint builds a *default* program for such a file, without `strict`, `noUncheckedIndexedAccess` or
`exactOptionalPropertyTypes`. The proof is one file written twice, byte for byte:

    const rows = ["a"];
    const first = rows[0];
    export const probe = first === undefined ? "absent" : first;

As `.mts`, which `tsconfig.json` names, the rule reports nothing. As `.mjs`, which it does not, the
rule calls the guard dead, because in that program `rows[0]` is `string`. That is 34 of the 270,
and it is also, on the evidence, why five type-aware rules were already switched off for
`**/*.mjs` in two separate override blocks with no reason recorded. Those two blocks are now one,
with this note as the reason. `packages/**` is left alone: the same argument applies to it, but
whether each of those five rules is off for this reason or because the files are plain JavaScript
was never written down, and guessing would trade one unrecorded decision for another.

**A boolean a callback assigns is narrowed to its initialiser.** TypeScript's control flow does not
know `forEach` invokes its argument, so after

    let stopped = false;
    rows.forEach(() => { stopped = true; });

`stopped` is `false` and every later test of it is reported. Thirteen sites. The usual workaround,
an explicit `: boolean` annotation, was tried and **does not work** — the probe reports the
annotated form exactly as it reports the bare one. Each site needs its walker to return the outcome
instead of capturing a flag, which is a better shape and a real change to eleven files.

### What the eleven files turned out to be, 2026-09-20

The step was written from that count without reading the sites. Read at `4bf40ee2c` the class is
**15 sites in 12 files**, and only **6 in 4 files** are a walker that knows the outcome and throws
it away. Those are fixed; the other nine are four causes a rule about walkers does not describe,
which is why the count was three times the work.

| where | sites | reading |
| --- | --- | --- |
| `src/builder/file-window.ts` | 2 | fixed — the callbacks are gone, see below |
| `vendor/pi-built/jsonl-reader.ts` | 2 | fixed — `append` takes and returns the dropping state |
| `src/builder/command-guard.ts` | 1 | fixed — the rewriter collects targets, the decision reads them |
| `src/review/review-sources.ts` | 1 | fixed — `add` and `walk` answer whether the cap is still open |
| `src/truth/verification-runner.ts` | 3 | **no outcome to return.** `gradingStarted` and `gradingStopped` are one phase's lifecycle, set by a per-case callback a bounded-concurrency pool invokes. The pool has no single outcome to hand back, and the phase lines are the point |
| `src/verify/host.ts` | 1 | a different cause: `scope.closed` is narrowed by a guard before an `await` and changed by another task during it, the fifth cause this file already records |
| `tools/runtime/test-suite.ts` | 1 | `walled` is set by a `setInterval` tick. A timer has no return path at all |
| `vendor/pi-claude-bridge/prompt-stream.ts` | 1 | in the tree `claude/bridge-rewrite-0919` is rewriting; take it there |
| `tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts` | 1 | not this class: the rule is reporting `while (true)` |
| `test/read-root-attestation.test.ts` | 1 | a hostile-fixture flag the test body sets, which is what a fixture is |
| `.claude/skills/prompt-surface-census/scripts/extract-prompt-surface.mjs` | 1 | `.mjs`, so the default-program cause above |

**What generalises is not "return a boolean".** `file-window.ts` held two of the six and the repair
there was to delete the callback. `walkBytes` and `walkText` became `fileChunks` and `textPieces`,
the first generators in `src/`, and three separate pieces of bookkeeping went with them: the stop is
a `break`, the file handle is closed by the loop calling the generator's `return()`, and the
decoder's flush is skipped after an early stop because a generator that is never resumed never
reaches it. `walkText` had been reconstructing all three from one captured boolean. The three
remaining files keep their callbacks and answer instead of assigning, which is the cheaper form of
the same move.

One hostile test came with it, because the descriptor release moved from a callback's `return false`
to the `for...of` protocol and no behavioural test can see it: 64 early-stopped pages and 64 refused
binary scans leave the process's open-descriptor count unchanged. Removing `closeSync` from the
generator's `finally` fails it.

**A validator over bytes an assertion already claimed is dead to the checker and live at runtime.**
`parseJsonAs<T>` asserts the caller's contract onto unverified bytes, so a schema check right after
it compares two identical literal types:

    const parsed = parseJsonAs<RebuildAdvicePacket>(readFileSync(path, "utf8"));
    return parsed.schema === REBUILD_ADVICE_SCHEMA ? parsed : null;

Twenty-three sites, and the guard is correct in every one — it is the only runtime protection those
readers have. The owner is `parseJsonAs`, which has **177 call sites in 92 files**, and working
rule 8 already states the contract it breaks: raw uncertainty belongs at the validation boundary.
Five of the twenty-three are in `vendor/pi-claude-bridge`, where the same shape guards a provider
stream whose SDK types promise fields the wire does not always carry.

**A captured `let` is narrowed where the closure is created, not where it runs.** In
`src/backends/oauth/callback-flow.ts` a binding is declared, assigned, and read inside
`close: () => bound?.stop(true)`; where the arrow is written the assignment has not happened, so
the rule reads the guard as dead. The closure runs later, when it is not. No workaround exists.

Four false-positive classes of this size against a handful of open findings is not a gate that pays
rent, and the operator's standing rule is to widen rather than wall. The two large causes are
queued as their own work; the rule can be reconsidered once either clears.

### The second look at the eight, 2026-09-20

The section above left eight sites open and worth reading again. Two were defects and are now
closed, so the sweep's 152 becomes 154 and 116 remain. Six are admitted, and one of those names a
cause the four above do not.

**The two defects are the same defect twice.** `ToolInterface` has exactly two members, and both
`src/run/builder-runtime.ts` and `test/builder-tool-mount.test.ts` projected it through a
three-arm chain: test one kind, test the other, fall back to `[]`. After the first test the second
compares a literal with itself, and the `[]` arm cannot be reached. Dropping the dead test is not
only shorter — it is the safer of the two shapes, because a third member would then fail to
compile at `config.tools.dynamicTools`, where the fallback would have quietly handed the evidence
writer an empty roster. The test had the same chain with the arms in the other order, which is how
a shape like this survives: the copy makes it look intentional.

**`generated-tool-worker-child.ts:224` and `:239` are the `lib.d.ts` class, second instance.**
`Subprocess.exitCode` is declared `number | null` and `SyncSubprocess.exitCode` is declared
`number`, and the runtime makes no such distinction: a synchronous child killed by SIGTERM reports
`exitCode: null`, `success: false` and `signalCode: "SIGTERM"`, measured on Bun 1.4.2. Those two
guards are the OS wall's own case — a spawn the boundary killed — so the operand the checker calls
impossible is the one the probe exists for.

**`src/verify/host.ts:756` is a fifth cause: a property narrowed before an `await`.** Line 638
tests `scope.closed` and returns; TypeScript carries that narrowing across the `await` on line 754,
so `!scope.closed` at 756 reads as always true. Another task closes the scope during the wait —
line 873 keeps the comment saying so — and this is the check that stops a run that outlived its
scope from binding evidence. Unlike the callback-assigned `let`, no annotation and no rewrite of
this file changes the reading: the narrowing is correct at the point it is made and wrong at the
point it is used, and only the `await` between them says so.

**`test/verification-runner-census.test.ts:273` holds a property in place.** `subjectKind` has one
member because rule 9 removed the Judge control census, so inside `!== "battery-case"` the value
can only be `undefined` and the `?? "?"` is dead. That is the assertion, not a redundancy: the test
is what fails on the day a control subject reaches the Judge again.

**`vendor/pi-claude-bridge/turn-translation.ts:238` is vendored.** The rule's own fixer refuses
that tree for the merge cost it would pay, and reading it by hand reaches the same answer.

### The residual read out, 2026-09-20

The subsections above closed 154 of the 270 and left 116 standing behind five named causes, each
cause read off a handful of sites. The `parseJsonAs` step, further down this file, re-measured the
rule on the head carrying every commit since: **124 findings**, of which 33 are `.mjs` judged
against a default program and 11 are `vendor/pi-claude-bridge`, the two classes the fixer already
refuses by prefix. The **80** in the typed tree were then read one at a time, which no pass here
had done — the sweep characterised the class from eight sites and the fixer's replay from its own
edits.

There is no sixth cause in them. The largest single spelling is the AST parent: `ts.Node.parent`
and an oxlint node's `parent` are both declared required and are both undefined at the root, which
is **10 of the 80 across five files**, two of them inside `unnecessary-condition-fix.ts` — the
fixer this rule's own sweep wrote. The rest divide between a value the runtime supplies read
through the type a parse promised — `row?.schema`, `manifest.schema !== "product-version/v1"`,
`field.fileMap !== true`, one validator per trust boundary — and the library types already named
here: `match.index`, `globalThis.Bun`, `JSON.stringify`, `Subprocess.exitCode`,
`navigator.clipboard`, and an index signature this tree reads without `noUncheckedIndexedAccess`.

**No defect is left in the residual.** The one it still held was `readManifest` in
`src/claim/evidence-log.ts`, and the `parseJsonAs` step reached it by reading four sites rather
than eighty. That is the whole yield of this rule on this tree: 270 sites, three defects, every one
of them found by a reader, none by the gate the rule would have been. The hunt is finished; a later
census of the same rule is a new program, not an open item.

## How close a deterministic fixer gets to a hand sweep, 2026-09-20

The section above measured one fixer against one hand sweep and got 74 per cent. The question it
leaves is whether that number is a property of fixers or a property of that rule. So the same
measurement was repeated on a second rule with the opposite standing —
`typescript/strict-boolean-expressions`, which is **in** the gate, where every site has to be
repaired and every rewrite preserves the condition — and the two answers are not close to each
other.

### The measurement

The rule was registered in two commits: `6cd889345` turned it on with `allowNullableString: true`,
and `5f96df649` turned that allowance off and named the blank-or-absent test once, as `hasText` and
`textOr` in `src/meta/text.ts`. The initial state is their parent, `81b4c35d2`, where the final
options report **327 distinct sites in 119 files**. The end state is `5f96df649`, where the rule
is green. Closure is measured by re-running the census over the swept tree rather than by counting
what the tool says it wrote, because those are two different claims and only the first is the one
anybody cares about.

`tools/oxlint/strict-boolean-fix.ts` reads the rule's own JSON report and applies five transforms.
The report's wording names the offending type, and the rewrite follows from the wording alone:

| wording | condition | value |
| --- | --- | --- |
| nullable boolean | `x === true` | — |
| nullable number | `(n ?? 0) !== 0` | — |
| nullable number, over `.length` or `.size` | `(n ?? 0) > 0` | — |
| nullable string | `hasText(s)` | `s \|\| b` becomes `textOr(s, b)` |
| nullable string, where no import may be added | `(s ?? "") !== ""` | — |

Every one of those is the original truthiness test for both spellings of nothing, so the fixer
never has to know whether a value is `null` or `undefined`. The predicate is a command-line
parameter rather than a built-in name, because the tool has to outlive this tree.

The last two rows are the same transform choosing its spelling by what the site can carry. A count
cannot be negative, so `> 0` is the same test as `!== 0` and does not attract
`unicorn/no-negated-condition`, whose own fixer rewrites `!== 0` inside a ternary as `=== 0` with
the arms swapped — equivalent, lint-clean, and not what anybody wrote. And a file that cannot take
an import is not a file that cannot be fixed: `(s ?? "") !== ""` is what the helper does.

### What the numbers are

| | sites |
| --- | --- |
| census at `81b4c35d2` | 327 |
| closed automatically | 271 (83 per cent) |
| remaining after the run | 56 |

| | landed edits |
| --- | --- |
| byte-identical to `5f96df649` after `bun run format` | 265 (98 per cent) |
| the reader wrote it differently, all six equivalent | 6 |
| wrong | 0 |

The tree the tool leaves passes `bun run typecheck`, `bun run lint`, source-policy, complexity and
the suite: **3805 pass, 0 fail**. One lint finding is left over and it is one the hand commit also
had to settle: `defaultOpenRouterModel` had a single caller all along and was exempt from
`ana/no-single-caller-helper` only because the call sat inside a `||` the fixer removed.

The six disagreements are worth naming because none of them is a defect. Two are in
`.claude/skills/launch-run/scripts/launch.ts`, where the reader used `hasText(routed)` and the tool
kept the `routed !== ""` already written, which the rule never reported. One is
`vendor/pi-claude-bridge/convert.ts`, where the tool spells the predicate out because the file
binds that name already and the reader instead renamed the local to `carriedText` — two reasonable
answers to the same collision. One is a sibling site the reader renamed as well. Two the reader
restructured for a reason that has nothing to do with the rule.

### A fixer needs no checker to propose and one to verify

The first run produced 26 type errors, and the honest reading is that a parse cannot see everything
a rewrite disturbs. Four classes came out of it, three of them refusals a parse can make:

- **A predicate call is two candidates.** `rows.filter(cb)` is a conditional position, and the span
  oxlint reports covers the whole call, not the callback's returned expression. Which one the
  verdict is about depends on where the call sits: read as a condition it is the condition, read as
  a value the rewrite belongs in the callback. Guessing wrongly produced
  `measured?.some((row) => (row.severity === "blocking") === true)` where the reader wrote
  `measured?.some(...) === true`.
- **A value is not a condition.** `result.status || result.signal || "unknown"` inside a template
  literal is a fallback chain, not a test, and the condition transforms turn it into a boolean. The
  compiler accepted `command failed (true)` because a template literal takes anything;
  `test/bun-spawn-sync.test.ts` caught it. Only the fallback transform is valid in a value
  position, and everything else there is hand work.
- **A name already taken.** `vendor/pi-claude-bridge/convert.ts` binds `hasText` as a local
  boolean, so the import would have collided and the call would have meant something else. This
  one stopped being a refusal once the predicate had a spelling that needs no import.
- **`(n ?? 0) !== 0` does not narrow `n`.** It is exactly the original test, and a later unguarded
  use of `n` stops compiling. Nothing in the report says whether such a use follows.

Only the last cannot be decided before the edit, so the tool is driven in a loop: apply, format,
`oxlint --fix`, then read `tsc`, `oxlint` and `tools/loc/source-policy.ts`; hold every line they
complain about; revert the tree and run again. Each round starts from the same clean tree and the
same census, so offsets never go stale and the held set only grows. It converges in **three
rounds**, holding 11 lines.

That loop is `tools/oxlint/fix-loop.ts`, and it knows nothing about any rule. It speaks the
two-argument fixer CLI this directory already uses, so it drives either fixer here and anything
written next. Of the two halves of this work it is the durable one: the per-rule transforms are a
one-off, because once a rule is in the gate its sites never accumulate again, while the loop is
what makes the next one-off safe.

The oracle has to be the whole gate and not just the type checker, and the size policy is the
reason. Two files, `src/builder/tools.ts` and `src/truth/probes.ts`, sit at a frozen size in
`tools/loc/source-policy.json`, where the one added import line is the whole cost. A file like
that is not held — the edits were not wrong — it is **constrained**, and the fixer is told it may
not grow. What to do then is the fixer's business, and this one writes the predicate out inline,
which is exactly what the reader did by hand in both files. `tools.ts` fits that way and closes.
`probes.ts` does not, even inline, so the round after that the loop skips it whole; the reader had
to drop a four-line reflowed ternary from the same file to make room. Constrain first and skip
only if constraining was not enough: the tree is better off untouched only in the case where the
smaller form still does not fit.

### A refusal follows the risk of the transform, not the name of the rule

`unnecessary-condition-fix.ts` pays for three refusals: a file outside the tsconfig program, a
vendored tree, a commented statement. None of them carries over here, and the reason is the whole
finding. Those three stop a **wrong edit**: removing a guard changes behaviour, so a verdict from a
degraded program, a tree with no local owner or a line someone thought worth a comment is a reason
to stop. Every rewrite here preserves the condition exactly, so none of those is a risk — and the
rule is in the gate, so a refusal would only leave the tree red. Carried over unexamined they
refused 89 of the 329 sites and bought nothing.

The refusals that pay here are about **position**: a value read as a value, a span that names two
candidate expressions, a guard whose neighbour already tests the same thing. Those are properties
of where the edit lands, which is exactly what a parse can see. Two of the original five were not
refusals at all on inspection — a bound name and a frozen file size both say only that no import
may be added, and the predicate has a spelling for that.

The last one is worth its own line because it is the one case where a correct edit is still the
wrong edit. `if (outcome.status && outcome.status !== 0)` rewrites to
`if ((outcome.status ?? 0) !== 0 && outcome.status !== 0)`, which is right, redundant, and a
`no-unnecessary-condition` finding the next time the gate runs. The reader kept one of the two
tests. Which one survives is a reader's call, so the site is left whole — detected by the sibling
conjunct being a comparison whose own left side is the same text, which is what separates it from
`a && a.b`, where the guard is doing real work. It fires four times.

### Four points on one curve

| rule | how the fixer is built | closed automatically | agreement with the reader |
| --- | --- | --- | --- |
| `ana/declarations-before-the-first-function` | the rule carries its own fixer | 965 of 965 | by construction |
| `typescript/strict-boolean-expressions` | external, report-driven, verify loop | 271 of 327, 83 per cent | 265 of 271, 98 per cent |
| `typescript/no-unnecessary-condition` | external, report-driven, no loop | 148 of 270 proposed | 113 of 152, 74 per cent |
| `ana/no-tangled-ternary` | not attempted | the move is mechanical | 9 of 59, see below |

The spread is not about how clever each fixer is. It is about what the edit has to decide. Where
the repair is named by the rule — move a declaration, add a brace — the rule should carry it, and
`tools/oxlint/ana/shared/import-fix.ts` already sets that pattern. Where the repair is a
behaviour-preserving rewrite the report's wording determines, a report-driven fixer with the gate
as its oracle reaches four sites in five and agrees with a reader on almost all of them. Where the
repair changes behaviour and the rule's verdict rests on a type that may be lying, a quarter of
what the fixer proposes has to come back out, and that quarter is the reason the rule is refused as
a gate at all.

The residue in the middle two rows is the same shape in both sweeps: 15 sites where a union has
inconsistent truthiness, 11 where an object is always truthy, 7 where a nullish value is always
falsy. Those ask which reading the author meant, and no amount of tuning turns that into a parse.

### What a second pass of tuning bought

The figures above are the tuned ones. The first version of this measurement refused two things it
did not have to refuse, and wrote four edits it should not have written. Repairing all three is
the whole difference between the two runs, and the size of that difference is the useful result:

| | first pass | tuned |
| --- | --- | --- |
| closed | 270 | 271 |
| byte-identical to the reader | 263 of 270, 97 per cent | 265 of 271, 98 per cent |
| refusal classes | 5 | 4 |
| rounds to converge | 2 | 3 |

**Coverage did not move and form did.** Going after the two unnecessary refusals opened ten sites
and the honest escalation closed six of them; the new refusal gave three back. From 83 per cent
the residue is judgement — which arm of an always-truthy object survives, what a union was meant
to mean — and tuning does not reach it. What tuning reached was the shape of the answer: two
ternaries no longer come back arm-swapped through another rule's fixer, four sites no longer ship
a redundant conjunct for the next gate run to find, and two refusals that were really one missing
spelling are gone. That is worth having and it is not more automation.

The corollary is a rule for the next fixer. Measure closure against a re-run census, not against
what the tool reports; the two disagreed here by nine sites, because the same span can carry more
than one diagnostic and a formatter closes a few on its own.

The last row is a different limit and the more interesting one, because the transform there is
**entirely** mechanical and a fixer would still be the wrong answer. `72278b854` repaired 59 hunks
in 43 files: 38 hoisted the inner ternary to a named `const`, 12 lifted the cascade into a named
function, 7 were rewritten in place and 2 lost the ternary altogether. So **50 of the 59 repairs,
85 per cent, invent a name** — `refusal`, `byFamily`, `readinessNextAction` — and the hoist that
carries the name is three lines of codemod. A fixer would close every site and produce 50 names
like `inner1`, which is worse for a reader than the tangle the rule exists to remove. Closure rate
and agreement rate come apart here: the structure is free and the whole value is in the part a
parse cannot supply. That is the test to apply before writing the next fixer — not "can the edit be
made mechanically" but "is the mechanical part the part that was worth doing".

## Applying that test to all forty-nine rules, 2026-09-20

The sentence above was written about one rule. Reading every rule against it took an afternoon
and changed six of them, so the reading is worth recording — mostly because two of the answers
already in the tree were wrong, and twenty-two rules had no answer at all.

### What the count was

Forty-nine rules, thirty-three `ana` and sixteen `anti-slop`. Four carried a fix. A loose grep for
`fix:` suggested five to ten, which is the first thing to distrust: `fixable: "code"` in the
metadata **and** a `fix` in the report are both required, and oxlint drops a `fix` from a rule that
did not declare itself fixable without saying anything. The rule keeps reporting, the sweep keeps
passing, and nothing is ever rewritten.

Two of those four fixers had no test. One of them is the reordering pass that swept 965 sites.

Ten carry a fix now, each with a fixture asserting its swept source, and the remaining thirty-nine
say in their own doc comment that they do not and why.

### The six that gained one

| rule | what it rewrites |
| --- | --- |
| `prefer-some-over-filter-length` | `xs.filter(p).length > 0` → `xs.some(p)`, where the predicate is written out and provably has no effect |
| `prefer-condition-over-boolean-returns` | `if (c) return true; return false;` → `return c;`, that order only |
| `no-hand-rolled-error-render` | both ternaries → `errorMessage(x)` or `asError(x)`, with the import placed |
| `prefer-const-conditional` | a `let` both arms of the next `if` assign → one `const` and a conditional |
| `no-renaming-temporary` | the expression back at its one reader, declaration removed |
| `prefer-find-over-loop` | a written-out search → `find`, `some`, `every`, or `if (xs.some(…)) return;` |

### Two refusals were dead text

`no-hand-rolled-error-render` said "there is no fixer, because the fix needs an import the plugin
cannot place". `shared/import-fix.ts` places one, and `require-captured-json-runtime` had been
proving it for a week. The sentence had outlived its obstacle and nobody reread it.

`prefer-find-over-loop` said "a fixer that guesses `find` where the author wanted `some` would be
rewriting the return type". The rule does not guess: `method()` reads the answer off the `return`,
and a loop returning the element cannot be `some`. The sentence described a fixer nobody had
tried to write.

Both are the same failure, and it is a reading failure rather than an engineering one. A refusal
is a claim about the world at the moment it was written, and the moment passes. That is why every
refusal now has to carry its reason in the same sentence: a reason can be checked against the
tree, and "there is no fixer" cannot.

### Four reasons that hold

**The edit is not in this file.** `no-pass-through-wrapper` deletes a name, which means editing
every caller — and the callers are the finding. `require-meta-runtime-import` needs to know which
`src/meta` module re-exports the name, or that none does and one must be written.
`no-argument-already-carried` changes a signature. `no-shape-in-symbol-names` renames a symbol
everywhere it is spelled.

**The edit invents a name.** `no-repeated-string-literal` needs the constant's name,
`no-thrice-spelled-object` a function and its parameter list, `prefer-lookup-over-equality-chain`
the table's name and home, `no-deep-nesting` the extracted function's. Measured on
`no-tangled-ternary`: 50 of 59 hunks invent one. The name is what a reader gets out of the
finding, so a fixer produces the compliance and throws away the benefit.

That reason was checked against the tree on 2026-09-20 and half of it did not survive, which is
the whole point of writing reasons down instead of verdicts. Inventing a name is only the work
when *where the name goes* is open. `no-repeated-string-literal` in a test file has nowhere else
to put it — the fixture belongs to the suite — and the value itself is the name: `"agent/tools.ts"`
is `AGENT_TOOLS_TS` and a reader gains nothing from being asked. So the rule now fixes test files
and refuses source, and its sweep closed **36 of 38** sites; the two it left are a value with an
escape in it and one starting with a digit, neither of which is an identifier. The other three
rules in this paragraph keep the reason, because each of them has to choose a home as well as a
name. Where a value carries its own name, a fixer is admissible; where it names a thing that lives
somewhere else, it is not.

**The edit is a type nobody has written.** The whole `unknown` family, `require-type-for-null-default`,
`no-unsafe-dictionary-type`, `no-known-value-widening`. Each of these reports that a type is
missing; the missing type is the work. `no-alias-restating-return` is the subtle one:
`ReturnType<typeof f>` cannot be `f`'s own annotation, so the edit is to delete the annotation and
let the return infer, and an inferred return type is not the annotated one.

**The mechanical part is not the part worth doing.** `no-hand-rolled-sleep`'s repair is to wait on
the condition the sleep stood in for. `no-side-effect-in-predicate`'s is to take the effect out of
the walk. `require-safety-comment-for-type-assertion`'s content *is* the requirement; a generated
comment would satisfy the rule and prove nothing, which is worse than the missing one.

The last candidate closed against its own sweep. `no-inline-schema-literal` hoists a constant
table out of a function body, which looked mechanical enough to be the next fixer written. Its
hand sweep is one commit, `0741eb48d`, and it hoisted all five sites the tree held. Reading that
commit settles it:

| site | inline | at module scope | a casing rule reaches | comment added |
| --- | --- | --- | --- | --- |
| `path-record.ts` | `strings` | `REQUIRED_STRINGS` | `STRINGS` | yes |
| `luna-sessions.mjs` | `quickOptionNames` | `QUICK_OPTION_NAMES` | `QUICK_OPTION_NAMES` | yes |
| `wall-policy.ts` | `runData` | `RUN_DATA_NAMES` | `RUN_DATA` | yes |
| `prose-classify.mjs` | `outcomes` | `CASE_OUTCOMES` | `OUTCOMES` | yes |
| `archive-scaffold.mjs` | `stateOf` | `LANE_STATES` | `STATE_OF` | no |

One name in five, and four sentences no fixer can write. It is not a near miss: the rename is the
hoist. A name that reads well beside the one function using it — `strings`, `outcomes`, `stateOf`
— says nothing at the top of a file, which is the whole reason the rule wants the table there. A
mechanical hoist would leave `const strings` at module scope with no comment and stop the rule
reporting, so the site would never be looked at again. It belongs under **the edit invents a
name**, and the rule now says so.

### Three things writing six fixers settled

**Edit the two statements, not the span between them.** Every one of these rewrites replaces a
statement and removes or rewrites another, and the first spelling — `replaceTextRange([a.start,
b.end])` — swallows whatever is written in between. A trailing `// why` on the declaration line
was enough to catch it, in a fixture, on the first run. Two edits cost one line and keep every
comment where its author put it.

**Mask comments and quoted strings before finding a name in text.** `shared/masked.ts` replaces
each with spaces of equal length, so an offset into the masked text is an offset into the source.
`no-renaming-temporary` needs this to place a fix and `prefer-const-conditional` needed it to
suppress a false one — the same reader from opposite sides, which is the second shared module this
pass produced. The first was `shared/predicate-effect.ts`, where
`prefer-some-over-filter-length` may only rewrite what `no-side-effect-in-predicate` would not
report.

**A fix that needs a name from another module rides on every diagnostic.** Already recorded for
`require-captured-json-runtime`; it held again here. oxlint drops a fix overlapping one it applied,
so a single carrier is lost exactly when it is the one dropped. Two names in one file arrive over
two passes and land in one import statement.

### The contract is now a test

`test/oxlint-rule-contract.test.ts` holds three things, none of which fails loudly on its own:

- every rule declares `fixable: "code"` or writes the words "no fix" and the reason beside them;
- `fixable: "code"` and a `fix` in the report agree, because oxlint drops the mismatch in silence;
- every fixer has a fixture calling `fixedSource`, because a report is read by a person and a fix
  writes source nobody looks at again.

The third is the one that pays. A wrong report is found the day it fires. A wrong fix is found
whenever someone next reads the line it rewrote, which for a 965-site sweep is never.

### The 3 / 7 rung on `ana/no-single-caller-helper`, 2026-09-20

The queue said "raise the dial to 3 / 7, and only from zero". Both conditions held — the tree
measured 0 at the shipped 2 / 5 — and the raise still failed on its first reading. 77 sites, and
of the fourteen read one by one, **nine had no call site that could hold the lines**. They were
all the same mistake in the dial: it counted the body and never looked at where the one call
stood.

| call site | example | what inlining would have produced |
| --- | --- | --- |
| `...spread` in an object literal | `epochBindingKeys` (`full-run-build-step.ts:264`) | a spread of a conditional expression built from two statements |
| arrow body inside `.map(…)` | `starterAuthority`, `presetAuthority` (`built-starter.ts:625`, `:631`) | a three-arm `if` chain, and a `throw`, inside a `.map` callback's object literal |
| `.flatMap(…)` arrow | `isRegularFileDeny` (`linux-bwrap.ts:466`) | a try/catch where the callback needs an expression |
| `.every(…)` argument | `probeOutcomeStatus` (`built-starter.ts:315`) | a guard chain plus a SAFETY assertion inside a predicate |

So the pair became conditional on the site. A call standing as a statement — its own expression,
a `return`'s value, the initialiser of a statement-level declarator — takes the statements as
statements and affords 3 of them over a 7-line span. A call inside an expression has to hold the
whole body as one term and keeps 2 and 5. A `for` header is a declarator too and is not a place to
put lines, so it reads as an expression site. That reported **26**.

Reading those 26 produced three refusals a size dial cannot express, and they are the part worth
keeping:

- **`using`.** It disposes at the end of the block that declares it. `admissionPayload`
  (`src/run/admission.ts:137`) opens the controller ledger, reads one string and closes it at its
  return; the same three lines in `readAdmission` hold the ledger for the rest of that function.
  Refused at any size.
- **`try`.** JavaScript has no try expression, so a body that catches is the one shape a call site
  cannot spell. `symlinkText` (`src/verify/exact-read-attestation.ts:115`) returns a decoded link
  or throws a refusal; inlined into the loop at `:192` it is a `let`, a try and a catch inside a
  loop that already holds two of each.
- **A decision chain.** A body that is nothing but `if (…) return a;` lines and a final `return z`
  has no spelling *this ruleset* accepts: a nested ternary trips `ana/no-tangled-ternary`, and one
  assignment per arm trips `ana/no-arms-differing-in-one-term`. `leafCategory`
  (`src/truth/draft-summary.ts:6`) is three of them, and every legal form of it inside
  `boundedDraftSummary` is refused by one of this repository's own rules.

That left **17**, swept by hand across sixteen files, and the rule measures 0.

Two of the seventeen changed more than their own lines. `capLedgerNote`
(`src/run/climb-ledger-note.ts:334`) opened with `if (note.length <= MAX) return note;`, which its
only call site had already tested three lines earlier — the inline dropped a dead guard the rule
was not looking for. And `rejected` (`src/solve/built-starter.ts:375`) was not inlined but split:
its caller built the same `Submit blocked:` result a second time in the accept path, so the shared
half became `blocked` with two callers, and `submitMaterializedArtifact` came out shorter than it
went in. A rule that asks "why does this name exist" gets answers the rule did not ask for.

**What generalises.** The dial was not wrong about the size. It was wrong about the context, and
the context was already in the rule's hand — the parent chain of the one call. Every other flat
number in this ruleset should be read the same way before it is turned up.

### The scope audit, 2026-09-20

Every rule was run over the files the lint configuration leaves out — 162 of them — to find out
whether the path sets are decisions or omissions. They report **54**, and 48 of those are two rules.
Both exclusions are right, which is the useful result: the ruleset's scope is not where the debt is.

| rule | off-scope reports | where | verdict |
| --- | --- | --- | --- |
| `anti-slop/no-runtime-typeof` | 20 | all `.mjs` | keep out |
| `ana/require-meta-runtime-import` | 28 | 20 `.ts`, 8 `.mjs`, all `.claude/skills` | keep out |
| six others | 6 | vendored and anti-slop trees | already named |

`no-runtime-typeof` asks a file to parse its input at the I/O boundary and branch on the domain
value instead of on `typeof`. That asks for a type to hold the parsed contract, and a `.mjs` file
has none, so the rule is off for `**/*.mjs` and `**/*.js`. The reason was already measured and
written down above.

`require-meta-runtime-import` was the finding. Its exemption for `.claude` lived in
`.oxlintrc.json`, invisible from the rule, and the rule's own test said in so many words that "the
two exemptions are the whole rule" while a third silenced 28 sites in nine skill scripts. The
exemption is right — a skill script runs on the operator's machine, outside every wall the
controller imposes, so its `node:` import is not a second door into an isolation that exists, and
routing it through `src/meta` would grow that owner with re-exports only tooling needs. It now sits
in the rule's `before` with that reason in the doc header, `repoRelative` learned `.claude` as a
root so the predicate can name it, and the override is gone from the configuration. Removing the
predicate reports the 28 again, which is how the exemption was proved load-bearing rather than
decorative.

**What generalises.** An exemption in the configuration is an exemption no reader of the rule can
review, and a rule's own test will happily describe a scope the rule does not have. Where a rule
has a reason of its own for not looking at a tree, the reason and the predicate belong in the rule;
the configuration keeps the exclusions that are about the language or the checker, like `.mjs`,
where no single rule owns the argument.

## The last three built-in rules the lanes named, 2026-09-20

Two review lanes listed nine built-in rules worth measuring. Six had verdicts; these three did not,
because the counts written down for them were wrong in every case. Measured at this head over
`src`, `tools`, `vendor`, `starters`, `test`, `packages` and `.claude`:

| rule | recorded | measured | verdict |
| --- | --- | --- | --- |
| `unicorn/prefer-array-find` | 4, and separately "reports nothing" | **3** | on, at zero |
| `import/no-cycle` | 2 | **15** | on, at zero |
| `typescript/prefer-optional-chain` | 49, all in `src` | **35**, none in `src` alone | refused |

### `prefer-array-find`: the message names the wrong method

All three sites are `.filter(pred).at(-1)` — the **last** match, not the first — and the rule's
message is "Prefer `find` over filtering and accessing the first result". Applied literally it
changes behaviour at every site it reports here; the repair is `findLast`. The rule offers no
autofix, confirmed by running `--fix` and reading an empty diff, so the wrong remedy is never
applied mechanically, but a model reading the message would apply it. Three sites, all `.claude`
skill scripts: `compare-conditions.mts` taking the last non-empty path segment, `prose-input.mjs`
taking the newest run opened before a timestamp, `timeline.mjs` taking the phase in force at a
moment. The rule is `error` and the tree is at zero.

### `no-cycle`: thirteen of fifteen were one import

Fifteen cycle reports, in two clusters. The `src/builder` cluster was thirteen of them across
seven files — `candidate-isolation.ts`, `candidate-isolation-runtime.ts`,
`candidate-isolation-profile.ts`, `path-record.ts`, `session-evidence.ts`, `tools.ts`,
`bash-install-env.ts`, `tool-write.ts` — and the whole strongly connected component was held
together by one line: `session-evidence.ts` imported `BUILDER_CAPABILITY_MODES` from `tools.ts`,
which only re-exports it from `capability-modes.ts`. Pointing that import at the owner removed
thirteen reports and changed nothing else.

The remaining two were a real two-way dependency: `admission.ts` called `evaluationIdentity` from
`candidate-promotion.ts`, and `candidate-promotion.ts` called `admissionPointerPayload` from
`admission.ts`. `evaluationIdentity` is composed of `fingerprintSlug` and `batteryHash`, both
defined in `src/claim/fingerprint.ts`, and three modules outside promotion wanted it. It moved
there with `EvaluationIdentity` and `taskSetDigest`, which is where a reader would look for it
anyway. No new module, and `candidate-promotion.ts` got shorter.

**What generalises.** A cycle rule is not a style rule: what it found was a file importing through
a re-export hop instead of from the owner, and a reader that had been parked in the first module
that happened to need it. Both are things a reader would want fixed without knowing the word
"cycle". The rule is `error`, the tree is at zero, and the lint step is no slower for it
(2.27 s against 2.34 s before, which is noise).

### `prefer-optional-chain`: refused, because its remedy is conditional

35 sites. `--fix` takes 11 of them, all the `&&` direction — `x !== null && x.p === v` becomes
`x?.p === v` — and every one of those is correct and reads better. The other 24 are the `||`
direction and the rule reports them with the same message and no fix. There the remedy is only
sometimes right:

- `node === null || node.type !== "Foo"` → `node?.type !== "Foo"` is equivalent, because a missing
  node is one way of not being a `Foo`. Seventeen sites read like this.
- `final === null || final.artifactJson === null` → `final?.artifactJson === null` is **not**
  equivalent: a missing `final` yields `undefined`, and `undefined === null` is false, so the guard
  stops firing. The correct spelling needs `== null`. Seven sites read like this, including
  `experiment-freeze.ts`, `solvability-submission.ts`, `judge-safeguards.ts` and both
  `declarator === null || declarator.init === null` chains in the anti-slop rules.
- one of those seventeen, `path !== null && path.includes(".") ? path : null`, still comes out
  worse: the optional chain yields `boolean | undefined`, so the ternary condition stops saying
  what it tests.

One further collision settles it. The autofix rewrote
`plain !== null && plain.schema === BUILDER_EXECUTION_SCHEMA` in
`tools/outcome/builder-execution-current.ts`, and the full lint then failed on
`ana/unproven-unknown-parameter`: the explicit `!== null` was the proof that the `unknown` arriving
at that boundary had been narrowed, and the optional chain erased it. That edit was reverted. A
built-in style rule whose fix removes a proof one of this tree's own rules requires is not a gate
this tree can register.

So: refused. Ten of the eleven autofixes were kept — they are correct and they read better — and
the eleventh is the one above. Those ten are now un-gated, which is the honest state: the shape may
come back and nothing will stop it. The tree is at 25.

**What generalises.** Three rules, three wrong counts and two wrong messages. A rule's advertised
remedy is a claim about the reported site, not about the shape, and a rule that cannot tell a null
test from a kind test will name the same remedy for both. The rules worth registering here were the
two that came out at zero after a real repair; the one worth refusing was the one that would have
left a standing argument at every future site.

## Reading the simplify census as a group, 2026-09-20

The census prints and gates nothing, so a row is worth exactly its answer. This pass answered every
row it carried: four were fixed, ten are refused with the reason written down, and one of the fixes
exposed a defect in a fixer's own revert that three tests and a live sweep had not.

### `tree/single-reader-export` was sizing the wrong thing

The shape asks whether one file's single export belongs in its only reader, and a yes deletes a
file. It sized that move by the **exported declaration** and checked the reader's remaining room
against it. The file is what moves: it holds one export, by the shape's own rule, so its private
helpers, its imports and its header travel with it. Measuring the declaration misread two of the
three rows the scan then carried — `tools/oxlint/tree-identity.ts` is a 24-line export inside 211
lines of its own scan, and `packages/ui/src/views/climb.tsx` a 55-line chart beside the private
tooltip it renders. Both read as helpers under the old measurement; both are what the shape's own
argument calls a module in its own right.

Measuring the home file, and doing it after the single-export check so the second question is asked
of something that can answer it, left 5 rows. Every one is a small file with its reader in the same
directory, and every one is answered **no**:

| what | its only reader | why it stays |
| --- | --- | --- |
| `codexApprovalDecision`, `src/backends/approval-gate.ts` | `codex-app-server.ts` | the file is the policy — every native approval request is declined — under fifteen lines of protocol reasoning about which `requestApproval` methods codex-cli 0.153 still sends. Inside the connection loop that decision reads as transport |
| `PushQueue`, `src/backends/claude-push-queue.ts` | `claude-backend.ts` | a queue with no dependency on the backend; the file records the 2026-08-20 split that made it |
| `classifyCodexAppServerMessage`, `src/backends/codex-app-server-protocol.ts` | `codex-app-server.ts` | the one place that decides what a JSON-RPC frame is, `id: 0` included. That is the protocol, not the connection that speaks it |
| `fixedProductBoundary`, `src/run/fixed-product-policy.ts` | `full-run-build-step.ts` | a declared invocation boundary with an exhaustive switch over `NextMove`. Moving a refusal into the step it refuses makes that step its own owner |
| `engineCellEnv`, `src/verify/engine-cell-env.ts` | `host.ts` | its first sentence is "Split from host.ts so the fresh HOME and TMPDIR rule has one owner", and that rule is an isolation guarantee |

Three discriminators were tried against those five and all three were dropped: the header naming
its reader, the export name matching the filename, and the file carrying a module header. The last
one silences all five and would silence a genuinely movable file just as fast, because this tree
writes a header on nearly everything. The scan is right to ask; the answers belong here, not in
the scan.

The first three rows went on 2026-09-21 with the Codex app-server and Claude SDK backends they
served, when every host slot moved onto the shared pi provider layer. The last two stand.

### `tree/identity-without-owner`: four fixed, three refused

Seven names spelled in two files each with no constant naming either copy.

**Fixed, all in the pi launchers under `.claude/skills/run-cycles/scripts/inference/launcher/`.**
`pi-claude.ts` and `pi-codex.ts` differ in their credential and their argv defaults and in nothing
else: each reached into the pinned `./pi-codex` checkout for the same three modules, replaced
`AuthStorage` with an in-memory store, called `setupCli()` and handed its arguments to `main()`.
Those specifiers are assembled with `join()` at runtime, so TypeScript checks none of them, and a
file moved inside the checkout would have broken both at a point each only reaches after it has
already read a credential. `pi-entry.ts` now owns the checkout, the directory it sits in and that
four-line start; each launcher lost eleven lines and kept only what makes it itself. The fourth
name is the harness-builder checkout, `PI_CLAUDE_HB_ROOT` with the same absolute default in two
files: `claude-bridge-extension.ts` reads it five times and is the module about that checkout, so
it exports `HB_ROOT` and the launcher imports it — no third module, and the launcher already named
that file by path to pass it to pi.

**Refused, three:**

- `scripts/worktree.sh` in `launch-run/scripts/launch.ts` and `system-path-simulation/scripts/
  stage-run.mts`. Two skills, no shared module between them, and the only candidate owner is `src/`
  — which never runs the script, it only tells the operator to. An exported constant in product
  source so that two tooling scripts can share a twenty-character relative path is plumbing that
  pays no rent.
- `src/meta/json-runtime.ts` in `stage-run.mts` and in the `MODULE` constant of
  `ana/rules/require-captured-json-runtime.ts`. The same characters, two different facts at two
  different moments: one is the module a lint rule enforces imports of in *this* tree, the other is
  a module of whatever vintage the measured checkout is — the file three lines above it says so,
  "a checkout from before the launch file was split still owns the parser". Sharing a constant
  would bind a historical path to a rule's subject, and `MODULE` is rightly not exported.
- `packages/ui/src` in `EXPORT_ROOTS` (`tools/loc/source-policy.ts`) and `DECLARING_ROOTS`
  (`tools/oxlint/tree-findings.ts`). Two deliberately different root lists that happen to share
  three members; there is no one fact to own, and joining them would make one tool's policy a
  consequence of the other's.

### `tree/duplicate-run`: one fixed, two refused

The fixed row is the two fixers' tails, and it only became visible once `fixer-source.ts` existed
— see below. The two that stay:

- `linux-bwrap.ts:291` and `darwin-seatbelt.ts:193` are the unavailable-wall return shape with two
  guards that name their own platform. Two platforms writing the same short answer.
- `generated-tool-worker-protocol.ts:251` repeats `:228`, inside one file: `tool_result` and
  `request_error` both declare `requestId`, `checkpoint` and `taskAccess` inside their own
  `strict({…})`. A wire message states its whole shape on purpose. Factoring the three shared
  fields out would make adding a field to one message add it silently to the other, which is the
  defect the per-message `strict` exists to prevent.

### One owner for what both fixers do outside their own rule

`strict-boolean-fix.ts` and `unnecessary-condition-fix.ts` are one program with a different edit
function, and they had each grown a private copy of everything around that function: the UTF-8 to
UTF-16 offset table, the exact-span node lookup, the banner skip in front of oxlint's JSON, the
site conversion, the apply loop, the journal's filename, its write and its revert, the message
normalisation, and finally the whole run summary. `fixer-source.ts` owns all of it. The two fixers
went from 883 lines to 630 and the owner is 265, of which the header and the interface docs are
about a third; the win is one owner for nine facts, not a line count.

Two of those facts were only findable **after** the fold. Folding `applyEdits` removed a latent
defect in `unnecessary-condition-fix.ts`, which wrote an empty file for any path it held no parse
for. And the summary only showed up as a `tree/duplicate-run` row once the surrounding code stopped
differing, which is the scan's own argument running forwards: a match is the question worth asking,
and the question could not be asked while five other copies were in the way.

### The defect the live run found: a journal reverts against a file that has moved

`revertJournal` put each edit back at the offset the journal recorded. Those offsets are positions
in the file as the fixer **found** it, and the file on disk is the file as the fixer **left** it,
so within one file the two agree only at the first edit — every later one sits further along by
however much the edits below it changed the length. Reverting highest-offset-first, which is right
for *applying* against original offsets, does not fix this: at that moment every lower edit is
still landed.

It was found by running the rebuilt `unnecessary-condition-fix.ts` over a real 22-diagnostic
report, reading the eight edits it landed and handing them all back. `tools/oxlint/tree-identity.ts`
came back as
`line.slice((match.index) + m ?? 0atch[0].length)`: two ` ?? 0` deletions in one file, the second
put back five characters late, inside the identifier beside it. Nothing caught it, because the
guard asks whether the landed text is still at that position and **a deletion's landed text is the
empty string**, which is present everywhere.

The walk is now lowest-offset-first carrying a running distance: an edit put back restores the
original length and leaves the distance alone, and an edit left in place carries its own landed
delta forward. That last part is also what makes `--revert <journal> <path:line>` correct for the
first time — the unselected edits used to be filtered out before the walk, taking their deltas with
them. Two tests came with it, both on the seven-edit strict-boolean fixture: a whole journal must
restore the original bytes exactly, and one named line must go back while the rest of the sweep,
including the inserted import, stays as it landed. Both fail with the arithmetic reverted, and the
live eight-edit case now round-trips to a byte-identical tree.

A deletion's guard is still vacuous, and the doc on the function says so. What protects it now is
the arithmetic, which is a weaker guarantee than a text match and the honest description of it.

## Retiring the anti-slop exclusion, seventeen sites, 2026-09-20

Queue item 13, the `tools/oxlint/anti-slop` half. One override block in `.oxlintrc.json` turned 22
of the 34 `ana` rules off over two trees at once, and a predicate in `ana/shared/file-role.ts`
named `isVendoredVerbatim` turned three more off over one of them. Both rested on the same claim,
which its own doc stated: `tools/oxlint/anti-slop` is "pinned verbatim at a commit, as its own
README asks".

**There is no README, and there is no pin.** The directory holds `index.ts`, `rules` and `shared`
and nothing else. No commit message, URL, submodule or lockfile entry anywhere in the repository
records an upstream, and twenty-two commits have edited the tree — one of them adding the `fixable`
metadata that `test/oxlint-rule-contract.test.ts` reads, which is this repository's own contract
and not an upstream's. So the tree is ours, and the exclusion was the last thing between it and
the ruleset.

### What the removal cost: seventeen sites, all swept

Measured by making the predicate return `false` and dropping `tools/oxlint/anti-slop/**` from the
block:

| rule | sites | how |
| --- | --- | --- |
| `declarations-before-the-first-function` | 8 | the rule's own fixer, five passes |
| `no-single-caller-helper` | 9 | by hand, below |
| `no-repeated-string-literal` | 1 | `OPEN_DICTIONARY`, written once |
| `no-tangled-ternary` | 1 | `no-module-mocking`'s computed-member branch |
| `no-positional-boolean-parameter` | 0 | the third predicate user had nothing to report |

The fixer takes **one site per file per pass**: each edit invalidates the offsets of the ones below
it in the same file, so eight sites across two files needed five runs of `bun run lint -- --fix`.
That is not a defect — the loop is cheap and the alternative is offset arithmetic inside the
fixer — but it is worth knowing before reading a single pass as a complete sweep.

One real limitation showed up in the same run, and it is about comments rather than offsets. The
fixer carries a declaration's leading block comment with it, which is right: a doc belongs to the
thing it documents. But a `// --- section ---` divider immediately above a constant is not a doc
for that constant, it is a heading for the code below, and moving the constant to the front of the
file took three of them with it. `dictionary-types.ts` ended with `is this key broad?`,
`does this expression state its own type?` and `is this certainly an object?` stacked at the top
labelling nothing, and the three sections they named unlabelled. Put back by hand. Teaching the
fixer to distinguish them is possible — a line comment separated from the declaration by a blank
line is a divider — but it is one file's worth of damage against a rule that reports 965 sites, so
the honest note is: read a declarations sweep's diff for moved headings.

Two of the nine single-caller findings were the same helper written three times.
`typeReferenceName` — the identifier a type reference names, or null where it is qualified — sat in
`shared/type-alias-resolution.ts` with one caller, in `shared/dictionary-types.ts` with three, and
in `rules/no-unsafe-dictionary-type.ts` with one. Both importers already import from the shared
module, so it is exported there and the two copies are gone. The rule found a triplication by
asking a question about one of the copies.

The other seven are the ordinary case, and two of them are worth naming because the repair was not
"move the lines" but "move the reason". `identityKeyed` in `no-object-parameters.ts` carried a
six-line doc explaining why `WeakMap<object, object>` is the correct type rather than an unread
input; that paragraph now sits at the `TSTypeReference` branch that acts on it, which is where a
reader meets the decision. Same for `contained` and the tuple branch. The rule charges a helper's
leading comment to the caller's line budget precisely so this is the outcome, and both callers had
the room.

### What it found: three rules with no test at all

`test/anti-slop-still-reports.test.ts` existed for exactly this failure — a rule that has quietly
stopped matching passes the contract test, reports nothing, and leaves a gate reading like a clean
tree. Its doc said "the eight `anti-slop` rules no other fixture makes report", and named the
pinned-upstream premise as the reason it was needed at all.

It was wrong by three. `no-chained-type-assertions`, `no-shape-in-symbol-names` and
`no-unknown-returns` are each `error` in `.oxlintrc.json`, each fail a push, and had no behavioural
test anywhere in this tree. All three now have the same minimal pair as the other eight, and all
sixteen anti-slop rules are covered. The premise that kept them untested is the one this item
retired.

One of the three found something on the way in: the fixture constant was first called
`SHAPE_IN_NAME`, and `no-shape-in-symbol-names` reported it twice on the real tree — the rule
working, in the same commit that first tested it.

### What is left

The `vendor/pi-claude-bridge` half of the block stays. Its three findings —
`no-deep-nesting` at `provider.ts:295`, `prefer-const-conditional` at 535,
`no-alias-restating-return` at 81 — are all in the file `claude/bridge-rewrite-0919` is rewriting,
and fixing them here would collide with it.

And a second exclusion over the same tree came into view while reading this one:
`biome.json` ends its `files.includes` with `"!**/tools/oxlint"`, so **the whole rule directory,
both plugins, is outside the formatter**. That is why `ana` is written with two spaces and
`anti-slop` with tabs, in one tree, under one gate. It is a separate item — queue step 14 — because
bringing it in is a mechanical reformat of every file here and does not belong in a diff about
what the rules say. Taken the same day; the section below it says what the reformat cost.

## Bringing `tools/oxlint` under the formatter, 2026-09-20

Queue step 14, and the second half of what item 13 found. `biome.json` ended its `files.includes`
with `"!**/tools/oxlint"`, so the whole rule directory — both plugins, every rule, every shared
module, the fixers and the census — sat outside `bun run format` and outside the `format:check`
step of the gate. Nothing stated why. Dropping the one entry brings 75 files into the formatter's
scope, 50 of which it rewrites.

### Proving the reformat was a reformat

`git diff -w` is not enough here: biome rewraps lines, and `-w` only ignores whitespace *within* a
line. Normalising further — strip all whitespace, then strip a comma before a closing bracket —
brought 36 files down to 10, and the remaining ten differed only in added parentheses and braces,
which is the same argument one level weaker.

The check that settles it compiles both versions. Each changed `.ts` file was built through
`Bun.build` with `minify: { whitespace: true, syntax: true, identifiers: false }` at HEAD and in
the working tree, and the two outputs compared: **49 of 49 identical**. `simplify.json` parses to
the same data. Nothing but `biome.json` itself changed meaning.

One trap in doing it that way. The first run reported one file differing, `anti-slop/index.ts`,
and the difference was `old_default` against `new_default` — Bun derives the name of a default
export's binding from the file name, and the harness had written the two versions as `old__*.ts`
and `new__*.ts` in one scratch directory. Write them under the same name in two directories.

### What the reformat then broke: 25 errors in three classes

All 25 were in `tools/oxlint`, and each class is a real interaction rather than a rough edge.

**`eslint(curly)`, 20 sites.** The registered setting is `"multi-line"`: braces are required once
the statement spans lines. The formatter is exactly the thing that makes a statement span lines,
so a single-line `if (x) return null;` over 110 columns becomes a two-line `if` the rule then
rejects. Every one taken by `bun run lint -- --fix`, followed by another `format` pass, because
the fix writes `{return null;}` on one line and the formatter opens it out. Two rounds settled it.

**`anti-slop(no-runtime-typeof)`, 3 sites, with 2 unused-directive warnings beside them.** This is
the one worth remembering: **`oxlint-disable-next-line` is bound to a line, and the formatter
decides where lines are.** Both sites had the directive above a `return` or a `const`, with the
`typeof` on the same line; the formatter wrapped the expression in parentheses and pushed the
`typeof` down one line, so the directive excused a line with nothing on it and the operator below
it reported. Oxlint says so twice over — the error at the new line and "Unused oxlint-disable
directive" at the old one, which together read as a displacement rather than a new defect.

The repair is to put the directive *inside* the wrapped expression, immediately above the operator
it excuses:

```ts
  return (
    // oxlint-disable-next-line anti-slop/no-runtime-typeof
    typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"
  );
```

That position is stable under reformatting, because a comment forces the break it sits on. The
directive above the `return` was not.

**`ana(no-single-caller-helper)`, 2 sites.** `isDictionaryAccumulatorTarget` in
`no-known-value-widening.ts` and `intersectionUnsafeValue` in `dictionary-types.ts` were each
folded to within the rule's statement count by the reformat, so a rule that had been on all along
began reporting. Both inlined, both docs moved to the branch that acts on them. The second lost a
`members.length > 0 &&` guard on the way in: `[].every(…)` is `true`, so the guard's only effect
was to return `null` where `members[0] ?? null` already returns `null`.

### The genuine pin is an override, and always was

`biome.json` already carries a `formatter: { enabled: false }` override naming eleven
`vendor/pi-claude-bridge` and `vendor/pi-built` files one at a time. That is what a real pin looks
like in this file: written down, per file, visible in the block that states it. The
`tools/oxlint` entry was in `files.includes`, which removes a path from biome's world entirely —
the same shape as the `.oxlintrc.json` block item 13 removed, one layer out and with no reason
attached.

### What did not move

`source-policy` and `complexity-policy` both pass unchanged: the reformat splits lines, and the
ceilings were already raised to 800 and 115 on 2026-09-20 for exactly that reason. The simplify
census is unchanged at 10 rows. 49 tests across the ten owning oxlint files pass, including
`oxlint-fixers`, whose fixture strings are compared byte for byte and whose fixers write into this
directory.

## `max-params` at 4 refused, and the class it stood for measured, 2026-09-20

The last rung in the queue, and the one that does not pay. The two above it shipped the same day —
twelve functions at seven or eight arguments, then twenty-eight at exactly six — and after them the
ladder reads **0** at 5, **115** at 4, **384** at 3. All 115 are at exactly five parameters: 71 in
`src`, 25 in `.claude`, 14 in `test`, 4 in `tools`, 1 in `vendor`. That is real source rather than
the skill-script tail `max-statements` was refused on, so this rung could not be waved away on
where its sites live. It had to be asked what it is for.

**The rung has no fixer and never could have one.** The remedy is to name a record and choose which
parameters it holds, and both halves are decisions. That is why the two rungs above went in by
hand, and why three of their forty rewrites collided with an existing name on the way in.

**What the rule stands for is the silent transposition**: two parameters of one type, passed the
wrong way round and accepted by the compiler because both sides are `string`. A long parameter list
is a proxy for that — easy to pass wrongly — and a proxy can be measured against the thing it
proxies for. A throwaway oxlint plugin rule over `src tools vendor starters test packages .claude`
counted every pair of parameters in one function declaring the same type text: **963 pairs**, 733
of them adjacent and 230 apart.

| the function's parameter count | transposable pairs |
| --- | --- |
| 2 | 274 |
| 3 | 298 |
| 4 | 262 |
| 5 | 129 |

786 of the 963 are `string`, 78 `number`, 15 `unknown`, 8 `boolean`, and the rest a tail of named
types.

The rung reaches the bottom row alone. Bundling a five-parameter function's tail into a named
record does remove that function's pairs — the fields are named at the call site and cannot be
crossed — so the rung is worth **at most 129 of 963, thirteen per cent**, for 115 rewrites across
71 source files. It leaves 262 pairs one rung below it, in four-parameter functions it never looks
at, and it can never reach the largest shape of all: `wilsonInterval(successes, n)` and
`compareCodeUnits(left, right)` take two parameters each, 274 pairs are that shape, and no
parameter ceiling touches one of them. Refused.

**What went in instead.** `ana/no-transposed-argument` decides the call rather than the signature.
It reports `writeRound(runId, campaignId)` against `writeRound(campaignId: string, runId: string)`:
both arguments carry the callee's own parameter names, in the other order, which states the mistake
twice. One name out of place is a coincidence at a call site; two, crossed, is the defect. A pair
whose declared types differ does not compile and needs no rule.

Its bound is the linter's rather than a choice. An oxlint plugin rule sees one file, so the callee
has to be declared where it is called. Within that bound it examines **530** argument pairs — the
callee in view, both parameters declaring one type, both arguments bare identifiers — and reports
none of them. Zero today, the same standing as `ana/no-property-read-on-function`: the rule is
registered for the shape it holds out of every file written from here, and
`test/no-transposed-argument.test.ts` is the only thing proving it still reports at all.

**The zero was checked past that bound, because a rule's own limit is a bad reason to believe it.**
A second throwaway rule emitted every signature carrying a same-typed pair and every call passing
two or more named arguments, and the two were joined outside the linter: **570 signatures under 536
distinct names against 4,718 call sites**, with no same-file restriction. Crossed calls: **none**.
Six calls put one argument in another same-typed parameter's slot, and all six are correct —
`directDirectory(parent, campaign)` asks whether `parent` is a direct child of `campaign`,
`covers(deny, root)` drops a deny that contains a scratch root, `bindMeasurement(runId, id)` binds
a battery to a product version, and the three in tests pass one value twice or name a saturated
family. So the rule's zero is the tree's zero, not its blind spot, and the defect it holds out is
one this tree has not yet made.

**No fixer, and not a close call.** Swapping the two arguments back is one edit and three readings:
the call may be wrong, the caller's two bindings may be misnamed, or the declaration's order may be
the thing to change. All three repairs are one edit apart and nothing in the expression says which.
`FIXER-DECISIONS.md` files it beside `prefer-flatmap-over-map-filter`, under the repair that
changes a semantic the rule can only ask about.

## `parseJsonAs` at 177 call sites refused, one site fixed, 2026-09-20

The queue's last open step asked for `parseJsonAs<T>` to be given an honest return, or for its
**177 call sites in 92 files** to be replaced with a parse at the shape the bytes are known to
have. Its stated payoff was that "steps 11 and 12 together are what `no-unnecessary-condition` is
waiting on". Measured against that payoff it does not pay, and the measurement is what settles it.

**The rule was re-measured with the step-11 work landed.** Turning
`typescript/no-unnecessary-condition` on over the whole tree today reports **124** findings, down
from the 270 the sweep started at. Of those:

| cause | findings |
| --- | --- |
| `.mjs`, judged under oxlint's default program | 33 |
| a guard on a binding a `parseJsonAs` in the same function asserted | 4 |
| everything else | 87 |

Step 12 closes four of a hundred and twenty-four. The 33 are the cause with no affordable fix —
typing that tree costs 2,994 checker errors, fifty-four per cent of them one missing `@param` — so
the rule stays refused whatever happens to `parseJsonAs`, and the 87 are causes it does not
describe. The payoff cannot be collected.

**The construct it asks to remove is one this file defends four hundred lines above.** The
`typescript/no-unnecessary-type-parameters` refusal names `parseJsonAs<T>`, `recordedJson<T>`,
`double<T>`, `frozenSection<T>`, `sanitized<T>` and `tracedInput<T>` as one construct: a caller
declares the contract it is reading bytes under, and the function asserts to it once. Removing the
parameter leaves `unknown`, which `ana/unproven-unknown-parameter` reports, and moving the
assertion to the call site needs a SAFETY comment there under
`anti-slop/no-chained-type-assertions`. Step 12 asks for the second of those, 177 times.

**And the tree already adopted the honest form where it matters.** A reader that guards its parse
mostly declares the guarded fields `unknown` and lets the guard do the narrowing —
`parseJsonAs<{ domain?: unknown; kickoffHash?: unknown }>` in `campaign-memory.ts`,
`<{ toolId?: unknown }>` in `tool-non-result.ts`, `<{ taskId?: unknown; publicTask?: unknown }>` in
`climb-ledger-note.ts`. `readClaimStages` goes one better and builds its contract out of validated
pieces with no assertion at all. That is what step 12 describes, arrived at site by site, which is
why only four sites are left for it to find.

### The four, read

**`src/claim/evidence-log.ts` — fixed.** `readManifest` is the one where the guard's absence from
the checker was hiding a real gap. Its own comment states the reason it exists: "a plausible
`files` map with a missing or unknown schemaVersion could be treated as evidence under rules the
reader has never validated (2026-08-03 evidence-reader audit)". It checked the schema and that
`files` is an object, and never checked the values. A `files` entry holding a number reached
`sha256(bytes) !== expected` as a non-string and came back as one changed file, rather than as a
manifest this reader cannot read. It now parses `JsonValue` and builds the manifest from validated
rows; a row it cannot read is `run-unrecorded`, which is the refusal the comment already promised.
Two hostile cases in `test/evidence-log.test.ts` fail when either guard is weakened to a `continue`.

**`src/truth/reference-solve-child.ts` and `src/truth/evaluator-process-child.ts` — admitted.**
Both read a protocol message from the parent process that spawned them, over a pipe the host owns.
`request.protocol !== PROTOCOL` and `row.type === "start"` are version tripwires over bytes this
program wrote itself, not validation of untrusted input, and the writer is one build away from the
reader.

**`src/author/rebuild-advice.ts` — admitted.** `readLatestRebuildAdvice` guards a seven-field
nested packet — `families[]`, `issues[]`, `findings[]`, `judge` — on its `schema` field, because a
packet another schema wrote is a different fact and every consumer already spells that as null.
The guard earned itself: throwing instead killed the first analyse step of all 47 recorded
campaigns when this file moved `families` out of `battery`. A validating reader for that packet is
a great deal more than one checker finding is worth, and the bytes' writer is this same controller.

**What is left of the step is a habit, not a rule.** A parse whose result is guarded should declare
the guarded fields `unknown`, or build its contract from validated pieces. A lint rule for it would
report all four sites and be right about one, which is the admission test failing three times out
of four.

## `eslint/no-shadow` at `hoist: "all"` refused, 129 sites read, 2026-09-20

The rule is registered at its default `hoist: "functions"` and measures **0**. The queue asked
whether to turn the dial to `all`, which also reports a shadow of a binding declared *later* in the
file, and said the answer needed measuring: "a shadow of a binding declared later in the file is a
genuine reading hazard, but 128 sites is a rename pass and some of them will be a parameter that
legitimately carries the name of the thing it is handed. Count the classes before deciding."

At `hoist: "all"` the tree reports **129 sites in 61 files**: 77 in `.claude/skills`, 41 in `src`,
`tools` and `packages`, 11 in `test`.

### What makes a shadow a hazard, and how often that holds here

A shadow costs a reader something only when both meanings are live at once — when the name means
one thing above the inner scope, another inside it, and the first thing again below. If the outer
binding is not read anywhere before the inner scope opens, the reader never holds two meanings; the
name simply has a second, unrelated job further down the file.

That is decidable without a checker, so it was decided. A throwaway `ana` rule walked every scope,
found every binding shadowing one in an enclosing scope, and recorded whether the outer binding is
referenced before the inner scope starts and after it ends. It reports 156 shadows — more than the
linter's 129, because it also sees a name bound in type position — and the split is not close:

| outer binding read before the inner scope | read after it | shadows |
| --- | --- | --- |
| no | yes | 155 |
| yes | yes | 1 |

The single exception is `test/build-manifest.test.ts:171`, and it is not one: `amend(change:
(status: Status) => void)` names the parameter of a function *type*, which binds nothing at
runtime and shadows nothing a reader must track.

So every site the dial adds is the same class — a name whose other meaning begins after this one
has finished. That is exactly the class `hoist: "functions"` exists to leave alone, and the tree's
own evidence says the default is the right setting.

### The 41 production sites, read

They are one concept rebound in a sibling branch, over and over. `range` is
`windowRange(…, offset, rowLimit(limit))` three times in `harness-inspect.ts`, once per listing.
`task` is the resolved task four times in `bundle-entry.ts`. `kind` is the resolved backend kind
three times in `resolve-side.ts`, once each for the operator file, the environment variable and the
unconfigured default. `executed` is the stage record at four points of one promise pipeline in
`validation-pipeline.ts`. `evidence` is the promotion record in both arms of
`candidate-promotion.ts`. `toolsSpec` and `findings` are the same two values on the two paths
through `candidate-check.ts`.

The rename the rule asks for at those sites is `range2`. Writing it would make the code worse and
the diff would be 129 lines of it, 77 of them in skill scripts — the same shape that refused
`max-statements` earlier today, where four fifths of the findings were skill scripts and test
setup.

**Refused.** The hazard the dial is aimed at is already owned: a shadow of a binding declared
earlier is what the default setting reports, and there are none. Reopen it only with a measurement
showing a site where the outer binding is live on both sides — the probe above is the instrument,
and it found none in production.

## The owed retirement pass, taken as a claim check, 2026-09-20

`tools/loc/source-policy.ts` excludes Markdown from the 800-line authored-code ceiling and says
why: the number is derived from what `biome format` does to authored code and says nothing about
how long a decision ledger should be, and a second file would give a reader two places to search
while retiring nothing. What bounds these ledgers instead is "retiring an entry whose rule is
decided and whose mechanism has left the source", and the comment leaves that owed, to "the next
reader who opens either ledger for an unrelated reason". This is that reader.

The judgement half of the pass — is this entry still worth keeping — a scan cannot make. The
factual half it can: **an entry whose mechanism has left the source names something the tree no
longer carries.** So every backticked token in the three ledgers was extracted and tested against
`git ls-files` and against the concatenated source of every root, by kind: a rule name against
`.oxlintrc.json` and the rule files, a path against the tracked set, a camelCase identifier
against the source text. 4,378 lines of ledger, and the result is:

| kind of claim | checked | naming something absent |
| --- | --- | --- |
| `ana/…` and `anti-slop/…` rule names | every mention | **0** |
| file paths | every mention | 11, of which **1** is stale |
| camelCase identifiers | every mention | 40, of which **0** are stale |

The one stale claim is fixed above: the `require-type-for-null-default` census named
`.claude/skills/run-improvement-campaign/scripts/status.test.mjs`, which `094d1306e` moved to
`test/campaign-status.test.mjs` when each skill suite got its own file under `test/`. The finding
itself still holds at the new path, `=== true` and all.

The other 50 are the scan being blunt rather than the ledger being wrong, and they are worth
naming so the next reader does not re-derive them. Ten of the eleven paths are not tree paths at
all: `lib.d.ts` and `.d.mts` are the language's own files and a suffix, `conformance.json`,
`claude-oauth.json` and `auth.json` are written at runtime and never tracked, and
`src/solve/draft-candidates.ts` is named twice by an entry that exists to record its deletion. All
40 identifiers are option names rather than source names — `allowAny`, `allowNullableString`,
`allowConstantLoopConditions`, `checkJs`, `ignoreStringArrays` — or names a pass removed, which is
the entry's subject.

**So the pass is not owed on the evidence a scan can produce, and the two triggers the source
comment set for itself have still not fired**: there is no fourth Markdown file, and the growth is
current work rather than the same entries persisting. What a scan cannot see is whether a decided
entry still earns its lines, and that is worth doing when a reader is next slowed down by one
rather than on a line count. The method above is cheap to re-run and is the part worth keeping.

### The eight lane DELETE verdicts are not recoverable, and need no recovery

Two review lanes read all 49 rules earlier in the same session and returned 35 KEEP, 8 DELETE and
6 RETUNE, with all eight deletions in rules 1 to 19. Only one of the eight survives in a readable
form — `no-arms-differing-in-one-term`, refused in `SHAPE-RULESET.md` because the dispatch
exemption post-dates the lane reports. The block naming the other seven was a teammate message
that this session's record does not carry; searching it recovers the totals and two KEEP rows and
nothing else.

That closes the item rather than leaving it open. A lane report is research, and AGENTS.md says to
check any required finding against the source before acting on it — so a verdict nobody can read
is not a pending decision. Every one of the 51 registered rules already carries a site count and
an admission verdict in these ledgers, which is the record a deletion would have to argue against.
If a rule should go, the argument is available from the tree at any time and does not depend on
recovering a lost message.

## Fourteen built-in rules and a pre-commit hook, 2026-09-20

Registered at `error`: `eslint/no-empty`, `eslint/no-fallthrough`, `eslint/no-implicit-coercion`,
`eslint/no-param-reassign`, `typescript/no-array-delete`, `typescript/no-deprecated`,
`typescript/no-explicit-any`, `typescript/no-for-in-array`, `typescript/no-non-null-assertion`,
`typescript/only-throw-error`, `typescript/prefer-optional-chain`,
`typescript/prefer-promise-reject-errors`, `typescript/restrict-plus-operands` and the five
`typescript/no-unsafe-*` rules (`argument`, `assignment`, `call`, `member-access`, `return`).

Measured over the whole lint scope before any override, the five `no-unsafe-*` rules reported
18,135 sites and `no-non-null-assertion` 235; in `src`, `tools`, `vendor` and `starters` together
the six report 42. The rest lives in `test/**`, the `.mjs` and `.js` scripts, `packages/ui` and
the operator scripts under `.claude/`, all of which read JSON they wrote themselves. Those four
areas switch the six off, and `no-explicit-any` with them for tests, scripts and `.claude/`; the
production trees keep every rule. With the overrides in place the census was 185, and every site
was fixed by hand rather than disabled:

| rule | sites | what the fix was |
| --- | --- | --- |
| `no-unsafe-assignment` | 38 | `unknown` at the boundary, then a guard (`plainRecord`, `isString`, `AgentToolResult<unknown>`) |
| `prefer-optional-chain` | 24 | `--fix`, two reverted where the chain left an unproven `unknown` |
| `no-empty` | 23 | a one-line comment naming why the catch is empty |
| `no-unsafe-member-access` | 20 | as for assignment |
| `no-non-null-assertion` | 16 | `runtimeProcess.execPath` for `Bun.argv[0]!`; `entries()` for indexed loops |
| `no-explicit-any` | 15 | `Model<Api>`, `AgentTool` without its `any` argument |
| `no-param-reassign` | 14 | a renamed parameter and one `const` |
| `no-unsafe-return` / `-argument` / `-call` | 21 | as for assignment |
| `no-deprecated` | 6 | `db.run` for `db.exec`; `phaseModifier` for `isTypeOnly`; one disable on the low-level `Server` chosen on purpose |
| `restrict-plus-operands` | 5 | `isNumber` before `+`; a `number[]` sum so the accumulator is not `JsonValue` |
| `only-throw-error` | 1 | `asError` |

Five of the new rules reported nothing on this tree — `no-fallthrough`, `no-for-in-array`,
`no-array-delete`, `no-implicit-coercion` and `prefer-promise-reject-errors` — and stay on as
guards. `Object.create(null)` sites moved to one owner, `ownKeyRecord<T>()` in
`src/meta/runtime-values.ts`, because every one of them was the same `no-unsafe-assignment`.

Two fixes interacted: an autofixed `plain?.schema === …` on a `plainRecord` result trips
`ana/unproven-unknown-parameter`, while the `plain !== null && plain.schema` it replaced trips
`prefer-optional-chain`. An early `if (plain === null) return false;` satisfies both, and the
`test/runtime-lint.test.ts` fixture now expects `no-unsafe-assignment` beside
`no-restricted-properties` on its `JSON.parse` line.

`.githooks/pre-commit` now runs `biome format` and `bun run lint` over the staged `.ts`, `.tsx`,
`.js` and `.mjs` files, through `ANA_LINT_PATHS` in `tools/runtime/lint.ts`, before the secret
scan. The pre-push gate is unchanged; the hook is the same check one file early.
