# Code that passes the first time

The habits of `AGENTS.md` section 12, moved here on 11 October (`7f0add79:docs/simplify.md`, T1): a
session that writes no code does not read them, and one that does reads them whole before its
first line. The contract itself is the ten lines of section 12 there: the gate, strict mode, never
turn a rule off, and this file.

Most lint findings here are preventable by habit. This file is the habit: write to it from the
first line, and the round trip through the linter mostly disappears.

## 12.1 Compiler and formatter

- TypeScript, `strict`, with `noUncheckedIndexedAccess` (an indexed read is `T | undefined`),
  `exactOptionalPropertyTypes` (`{ k: undefined }` and `{}` are different values),
  `noUnusedLocals` and `noUnusedParameters`. Target and library ES2025, modules NodeNext.
- Imports carry the `.ts` extension. Files under `src` and `vendor` import one another by
  relative path. Elsewhere an import that climbs three or more directories uses the aliases of
  `package.json` (`#src/…`, `#tools/…`, `#skills/…`), and one or two levels stay relative.
- Biome formats: two spaces, width 110, double quotes. Do not align or wrap by hand; run
  `bun run format`, or `bun run format -- <paths>` for only those files.
- `bun run typecheck` (`bun check`) covers the paths in `tsconfig.json`: `src`, `tools`,
  `vendor`, `test`, `studies` and `.claude`. Skill scripts receive typechecking, lint and their
  owning tests, including `test/skill-scripts.test.ts` and `test/meta-cli.test.ts`.

## 12.2 How lint runs

`bun run lint` runs Oxlint over `src`, `tools`, `test`, `packages` and `.claude` with
`--deny-warnings` and `--report-unused-disable-directives`, type-aware. `packages/ui` is linted
once its own dependencies are installed (`bun run ui:deps`), under its own `tsconfig.json` and
with no rule turned off for it; a whole-tree run without them leaves it out and says so. Four repository plugins ride along: `ana`,
`anti-slop` and the two tiers of `implicit-state` (12.14). Every enabled rule in `.oxlintrc.json`
is an error. A rule still being settled sits in `tools/oxlint/staged-rules.json` instead, which
`bun run simplify` runs and no lint or hook gates on.

- **Plugin findings fail the run only in strict mode**: `bun run lint -- --strict`,
  `ANA_LINT_STRICT=1`, or a clone with `git config ana.lintStrict true`. A plain run holds you to
  Oxlint's own rules and counts the rest. Work in strict mode: CI's lint step is strict, and a
  strict run at `main` reports nothing on 11 October. The 11 findings that stood from PR #80 were
  cleared on 10 October, one answered in the ledger; the merge of #189 to #220 brought three
  more (two assertions in `test/wri-read.test.ts`, `.toolchain` spelled five times in
  `src/builder/tools.ts`), fixed on 11 October. Add none, and say in your pull request that the
  strict run is clean.
- Extra arguments go to Oxlint. Ten rules carry a fixer, marked [fix] below, which Oxlint's
  `--fix` applies; `tools/oxlint/FIXER-DECISIONS.md` says why the others report only.
- After its findings, a run prints each plugin rule that fired once, with one or two pairs: a
  shape the rule reports and one that passes it and every other rule. A rule keeps its pairs in
  its own `meta.docs.examples`, and a tree scan in `TREE_FINDING_EXAMPLES`
  (`tools/oxlint/tree-findings.ts`), which the commit's slop report prints the same way. A new
  rule or scan brings its pairs, and `test/rule-examples.test.ts` lints every one.
- **Never turn a rule off**: no new `"off"` in `.oxlintrc.json`, for the tree, a glob or a file,
  and no `oxlint-disable` comment for a plugin rule (`ana/no-inline-slop-answer` refuses it).
- **Every core rule in scope is decided.** Each rule Oxlint offers in the correctness, suspicious,
  perf, pedantic, style and restriction categories of the `eslint`, `import`, `node`, `oxc`,
  `promise`, `typescript` and `unicorn` plugins is configured at the top level of `.oxlintrc.json`,
  or is a row of `tools/oxlint/rules-off.tsv`: `off` with the one sentence that keeps it off, or
  `staged` with the count still to fix. `test/oxlint-ledger.test.ts` fails on a rule that is
  neither, on a row for a rule that is on, and on an `"off"` for some files without its row. A
  commit that turns a rule on removes its row.
- **When a finding is wrong about a site**, the answer depends on the rule
  (`tools/oxlint/not-slop-ledger.ts`):

  | The rule is | The answer |
  | --- | --- |
  | a plugin rule with a fixer | Tune the rule's source, so that the legitimate shape passes and every case it caught still fails, with a fixture for each side. The ledger refuses these rules |
  | a plugin rule without a fixer, or a `tree/` scan | Tune the rule, or answer the site: `bun run not-slop -- answer <id> "<a reason a reviewer can check>"` |
  | a core Oxlint rule | Fix the code. An exception is a fact about the code, written beside it as an `oxlint-disable` comment with the reason; an unused one fails the lint |

  A ledger row that no longer names a finding fails a strict lint, and `bun run not-slop -- prune`
  removes it.

## 12.3 The habits

The left column is what the hand writes first. The right column is what passes.

```ts
// A nullable string, number or boolean is no condition (typescript/strict-boolean-expressions).
// A plain string, a plain number and `Row | undefined` pass as they are.
if (name)      // string | undefined   →  if (hasText(name))        // src/meta/text.ts
if (count)     // number | undefined   →  if ((count ?? 0) !== 0)   // or count !== undefined
if (flag)      // boolean | undefined  →  if (flag === true)
name || "x"    // string | undefined   →  name ?? "x"               // textOr(name, "x") if "" falls back too
if (items.length)              →  if (items.length > 0)     // unicorn/explicit-length-check
if (maybe?.length)             →  if ((maybe?.length ?? 0) > 0)
const n = +text; "" + n; !!x   →  Number(text); String(n); x !== undefined

// The positive case first (unicorn/no-negated-condition, eslint/no-else-return)
if (!ok) { a } else { b }      →  if (ok) { b } else { a }
a !== b ? x : y                →  a === b ? y : x
if (c) { return a } else { return b }   →  if (c) return a;  return b;

// Types stay honest
x as T                         →  a predicate, `satisfies`, or a parse; else  // SAFETY: <what you checked>
x as unknown as T              →  parse at the boundary (capturedJsonParse + a predicate, parseJsonAs<T>)
value!                         →  a guard: if (value === undefined) throw …
typeof x === "string"          →  isString(x)               // src/meta/json-shape.ts
Record<string, unknown>        →  JsonObject, or OpenRecord for an open view
function f(input: unknown)     →  declare the type, or prove it in the body
function f(): unknown          →  return the parsed type
function f(options: object)    →  a named interface
function close(log, true)      →  close(log, "failed")      // a union of two string literals

// JSON, errors, optional keys, the runtime: each has one owner in src/meta
JSON.parse(text)               →  capturedJsonParse(text)   // JsonValue until checked
JSON.stringify(v)              →  capturedJsonStringify(v)
e instanceof Error ? e.message : String(e)   →  errorMessage(e)
throw new Error("x")  in catch →  throw new Error("x", { cause })
...(v === undefined ? {} : { k: v })         →  ...keyIfDefined("k", v)
import { readFileSync } from "node:fs"       →  the same name from src/meta/filesystem.ts
new Promise((r) => setTimeout(r, ms))        →  Bun.sleep(ms), or wait on the condition

// Arrays
xs.map(f).filter(Boolean)      →  xs.flatMap((x) => f(x) ?? [])
xs.filter(p).length > 0        →  xs.some(p)
xs.some((x) => x === "lit")    →  xs.includes("lit")
xs[xs.length - 1]              →  xs.at(-1)
const ys = xs.reverse()        →  const ys = xs.toReversed()
numbers.sort()                 →  numbers.toSorted((a, b) => a - b)   // a string[] sorts bare
for (const x of xs) if (p(x)) return x;      →  return xs.find(p)
for (const k of Object.keys(o)) … o[k]       →  for (const [k, v] of Object.entries(o))

// Promises
void promise; promise;         →  await it, return it, or .catch it
xs.forEach(async (x) => …)     →  for (const x of xs) await …   // or Promise.all(xs.map(…))
```

And in words:

- **Lay a file out** as imports, then types and interfaces, then module constants, then functions.
- **Nest at most three deep.** Guard and return early; split a function that does two things.
- **A ternary has at most three cases along its tail**, with nothing nested in a test or a first
  arm. Name the inner one in a `const`.
- **A function takes at most five parameters**, none a bare boolean, none typed `object`. It
  shadows no outer name and reassigns no parameter.
- **Write no helper for one caller.** A non-exported function of two statements with one caller
  is inlined; a function that only forwards its parameters is a second name; a `const` that
  renames an expression and is read once is that expression.
- **Give a repeated thing one owner.** A string of six or more characters spelled four times in a
  file becomes a named constant; an object literal of three or more properties spelled three times
  becomes one function.
- **Export only what another file imports.** A name with no reader outside its file loses its
  `export`.
- **Name things for their role.** No name carries the word "shape" (`taskShape`), and no
  production name carries "legacy".
- **Keep no compatibility path** in source: no `v1 || v2` reader, no migration branch, no shim. A
  reader that meets an older version refuses it. The log's event kinds are the one exception
  (`AGENTS.md`, section 5).
- **Sizes**: a file at most 800 nonblank lines, a function at most 115.

Before a commit: `bun run format && bun run typecheck && bun run lint -- --strict`, the nearby
tests, then `bun run commit:check`. Before handing back: `bun run simplify`.

## 12.4 The `ana` rules

A test file is anything under `test/` or named `*.test.*`. Exemptions live inside each rule.

**Structure**

- `require-declarations-first` [fix]: imports, types, module constants, then
  functions. A constant whose initialiser calls something or reads below stays where it is.
  Declarations that follow one another are one report, and the fix moves the run whole.
- `no-inline-schema-literal`: a table of three or more constant entries built inside a function
  moves to module scope under a name. Tests are exempt.
- `no-deep-nesting`: a statement four levels inside its function is an error. `if`, loops,
  `switch` and `catch` count. A guard does not: an `if` without `else`, of at most three
  statements, that ends in `return`, `continue`, `break` or `throw`.
- `no-tangled-ternary`: at most three cases, growing along the tail only.
- `no-single-caller-helper`: inline a non-exported function with one caller and a short body: at
  most two statements and five lines where it is called in an expression, three and seven where
  the call is a statement. It yields where the inline would push the caller past 115 lines.
- `no-pass-through-wrapper`: a body that only forwards its parameters. Adding a default, a
  narrowing or a fixed argument makes it a real function.
- `no-single-use-const-chain`: three or more `const`s, each read once by the next statement, are
  one expression. A comment or a type annotation ends the chain.
- `no-renaming-temporary` [fix]: `const rows = bundle.rows;` read once below is `bundle.rows`. A
  binding read inside a closure, after the function has tested that path, is exempt: it keeps
  the narrowing.
- `no-alias-restating-return`: a type alias used only as one function's return type is that
  function's annotation: write the alias's body there and delete the alias.

**Branches**

- `no-arms-differing-in-one-term`: two arms that are the same text but for one value are one arm
  with the condition at that value.
- `prefer-const-conditional` [fix]: `let x; if (c) x = a; else x = b;` is `const x = c ? a : b`.
  A default followed by an override is `const w = o.w ?? D`.
- `no-positional-boolean-parameter`: take a union of two string literals. Tests are exempt, and so
  is a function the file never calls or exports and only hands on as a callback.
- `no-side-effect-in-predicate`: no mutation inside a `filter`, `find`, `some` or `every`
  callback. Deduplicate with `new Map(rows.map((r) => [r.id, r]))`, or write the loop.

**Arrays and loops**

- `prefer-find-over-loop` [fix]: the loop rewrite of 12.3. The other array rewrites there are
  habits with no rule.
- `no-inline-block-reducer`: a `.reduce` with an inline block body is a hidden loop. Write the
  `for…of`.

**Calls**

- `no-transposed-argument`: arguments named for one another's parameters, two swapped or three
  or more rotated, against a callee this file declares (a function, a `const`, a `this` method,
  an object literal's method or a class's constructor under `new`). A name is an identifier or
  the property ending a member read, and it matches when its words begin or end with the
  parameter's (`sourcePath` for `source`). One name out of place is not reported. A call into
  another file is the tree scan of the same name, `tree/no-transposed-argument`, which
  `bun run simplify` prints. Fix whichever side is wrong.

**Repetition**

- `no-repeated-string-literal` [fix]: six or more characters, four spellings in a file (ten in a
  test). Import sources, object keys and bare tags are exempt, and so are a test's prose and a
  spelling the file itself declares as a literal type, which the compiler holds its copies to.
- `no-thrice-spelled-object`: three or more properties, three spellings (five in a test).

**Types**

- `no-unproven-unknown-parameter`: an `unknown` parameter is proved in the body, by a predicate, a
  narrowing guard or a hand-off to a prover (`is…`, `as…`, `assert…`, `parse…`, `errorMessage`).
  Passing it straight on proves nothing.

**Owners**

- `no-hand-rolled-error-render` [fix]: `errorMessage(e)` and `asError(e)`.
- `require-captured-json-runtime` [fix]: in `src`, no ambient `JSON.parse` or `JSON.stringify`.
- `require-meta-runtime-import` [fix]: no `node:` import outside `src/meta`. Seven have a wrapper
  there, and the fixer moves them: `node:fs`, `node:fs/promises`, `node:path`, `node:os`,
  `node:net`, `node:module` and `node:assert/strict`. Any other, `node:crypto` for one, is
  reported with no fix: use what `src/meta` already offers (`sha256` for a hash), or add a
  wrapper there. Tests and `.claude` are exempt.
- `prefer-key-if-defined` [fix]: `...keyIfDefined("k", v)` inside the literal, in place of a
  guarded assignment after it.
- `no-hand-rolled-sleep`: no `setTimeout` promise. Wait on the condition, or `Bun.sleep`.
- `no-lifetime-outside-owner`: a file that spawns a child and kills it is a second owner of
  process lifetime beside `stageCommandIsolation` (`src/wall/isolation.ts`).
  Signal through `killProcessGroup` or `terminateAndReapProcessGroupId`
  (`src/meta/subprocess.ts`). Tests are exempt.
- `no-react-effect`: no `useEffect`, `useLayoutEffect` or `useInsertionEffect`, in a component
  or a hook. Derive during render, reset with `key`, act in the handler, use a callback ref, hold
  an external system as a store read through `useSyncExternalStore`, or act once as a keyed
  component mounts through `useMountEffect`, whose file (`packages/ui/src/mount.ts`) is the one
  owner. Tests are exempt.
- `no-inline-slop-answer`: no disable comment for a plugin rule. Use the ledger.
- `no-hand-spelled-git`, `no-hand-read-argv`: see 12.8.

## 12.5 The `anti-slop` rules

- `no-chained-type-assertions`: no `x as unknown as T`.
- `no-conditional-empty-object-spread`: no `...(ok ? { k } : {})`. Use `keyIfDefined` or `keysIf`.
- `no-known-value-widening`: no annotation wider than the value states. Keep the inference, or use
  `satisfies`. An anonymous object type, a declared return type among them, is wide only through a
  member typed `any`, `unknown`, `object` or an open dictionary; one that states each member's type
  is a contract and passes.
- `no-module-mocking`: inject through a real interface. It also reports a `spyOn` over a member of
  any import or of `Date`, `Math`, `performance`, `crypto`, `Bun`, `process` or `globalThis`; in a
  test, an assignment, `Object.defineProperty` or `Object.assign` over one; and a faked clock
  (`setSystemTime(date)`, `useFakeTimers`). Hand the code a clock, a fetcher or the command it calls
  instead. `env`, `exitCode`, `execPath` and `console` pass: input, output, the wall's own test of
  the captured runtime, and output a test only observes.
- `no-object-parameters`: no parameter typed `object`.
- `no-runtime-typeof`: the predicates of `src/meta/json-shape.ts`. `typeof x === "undefined"` is
  allowed.
- `no-shape-in-symbol-names`: no name with the word "shape", "shapes" or "shaped" in it. An
  object-literal key that holds a literal (`{ shape: "object {joints}" }`, a count's label) spells
  data and is exempt; a key holding a computed value is not.
- `no-unknown-returns`, `no-unknown-type-aliases`: no `unknown` going out, as a return type or
  behind a name: an alias of `unknown`, `any` or an array, tuple, promise or map value of them, a
  member of an exported interface or type literal, a public field of an exported class, a member of
  a local type an export returns, or an exported type parameter's default. A local type an export
  only takes in, a `Set<unknown>`, and a `cause` keep `unknown`.
- `no-unsafe-dictionary-type`: no `Record<string, unknown>` or `Record<string, any>`.
- `no-widen-then-assert`: do not widen a known value and assert it back. Wide is `unknown`, `any`,
  `object`, an open dictionary, `JsonValue` or `JsonObject`, reached by an annotation, an
  assertion, a local function whose declared return erases what it returns, or
  `JSON.parse(JSON.stringify(x))`; a closure over the `const` is the same flow. Give the value or
  the function its precise type, or copy with `structuredClone`. Nor assert an element read
  (`xs[0]`, `.at(-1)`, `.shift()`, `.find()`, `.get()`) present: check it, fall back with `??` or
  iterate. Narrow a caught value with `instanceof Error` rather than `as`.
- `prefer-subpath-import` [fix]: the aliases of 12.1.
- `require-safety-comment-for-type-assertion`: every `as T` except `as const` carries a comment
  directly before the assertion or its statement, stating the invariant you checked:

```ts
// SAFETY: isManifest validated this two lines above.
const manifest = parsed as Manifest;
```

## 12.6 Core rules that trip most

- `typescript/strict-boolean-expressions`: a nullable string, number or boolean in a condition.
  The rewrites head 12.3.
- `typescript/no-floating-promises` with `ignoreVoid: false`: `void p` does not satisfy it.
- `typescript/no-misused-promises`: no async callback where a sync one is expected.
- `typescript/no-unsafe-*` and `no-explicit-any`: parse `any` before use.
- `typescript/no-non-null-assertion`: guard.
- `typescript/switch-exhaustiveness-check`: name every member of the union. A `default` does not
  satisfy it.
- `typescript/restrict-template-expressions`: no object or array inside `${}`. Render it first.
- `typescript/require-array-sort-compare`: a comparator for anything but strings. Where the order
  of strings is recorded or hashed, pass `compareCodeUnits`, as the source does.
- `typescript/prefer-nullish-coalescing`: `??` wherever the left side can be null or undefined.
  `||` survives only where it cannot.
- `typescript/only-throw-error`, `eslint/preserve-caught-error`: throw `Error`s, with the cause.
- `eslint/max-params` 5, `no-shadow`, `no-param-reassign`, `no-else-return`, `no-empty` (an empty
  `catch` needs a comment), `no-implicit-coercion`, `curly` for a body that spans lines.
- `unicorn/no-negated-condition`, `no-lonely-if`, `prefer-at`, `no-array-reverse` (where the
  result is used), `prefer-set-has`, `explicit-length-check`.
- `import/no-cycle`: move the shared piece down into a module both sides import.

## 12.7 Rule pairs that pull against each other

Each pair has one spelling that satisfies both.

| The pair | The spelling |
| --- | --- |
| Tangled ternary against negated condition | Name the inner ternary in a `const`. Do not invert the outer test |
| Single-caller helper against thrice-spelled object | By count: at two uses inline, at three extract |
| Boolean parameter, `object` parameter and `max-params` | A string-literal union, or a named interface |
| Key-if-defined, empty-object spread and `exactOptionalPropertyTypes` | `keyIfDefined`, `keyIfNotNull` or `keysIf` |
| Strict-boolean against nullish-coalescing | `(n ?? 0) > 0`, with a `!== undefined` guard where later lines need the narrowing |
| Renaming temporary against a narrowing | A `const` read in a closure below a guard is exempt. Keep it |
| Deep nesting against function length | A guard is free for depth. When guards run out, split the function |

## 12.8 The owners in `src/meta`

Each runtime surface has one owner. Import from it; add a missing member beside the others.

| Need | Owner | Names |
| --- | --- | --- |
| Files | `filesystem.ts` | the `node:fs` surface; `mkdir`, `mkdtemp`, `readdir` and `rm` are the promise versions |
| Paths | `path.ts`, `path-containment.ts`, `path-segment.ts` | `join`, `resolve`…; `containsPath`; `isSafePathSegment` |
| The OS | `os.ts` | `tmpdir`, `homedir`, `loadavg`, `availableParallelism` |
| The process | `process.ts` | `runtimeProcess` in place of `process`, `parseArgs`, `capturedSpawn` |
| Subprocesses | `subprocess.ts` | `runSync`, `runTextSyncOrThrow`, `killProcessGroup`, `terminateAndReapProcessGroupId` |
| Host binaries | `host-tool.ts` | `hostTool("git")` |
| Git | `git.ts` | `gitOutput`, `gitText`, `gitMaybe`, `worktrees` |
| JSON in and out | `json-runtime.ts` | `capturedJsonParse`, `parseJsonAs<T>`, `capturedJsonStringify` |
| JSON types and predicates | `json-shape.ts` | `JsonValue`, `JsonObject`, `OpenRecord`, `isString`, `isNumber`, `isBoolean`, `isRecord`, `asRecord`, `isFunction` |
| Canonical JSON and hashes | `stable-json.ts`, `digest.ts` | `stableJson`, `canonicalJson`, `sameJsonValue`, `hashJsonValue`, `compareCodeUnits`; `sha256`, `sha256OfFile` |
| Caught values | `runtime-values.ts` | `errorMessage`, `asError`, `errorCode` |
| Optional keys | `optional-key.ts` | `keyIfDefined`, `keyIfNotNull`, `keysIf` |
| Text | `text.ts`, `bounded-text.ts` | `hasText`, `textOr`, `plural`; `boundText` |
| Counting and pooling | `tally.ts`, `pool.ts` | `countBy`, `median`; `pooled` |

Three `ana` rules name owners in their messages. Since 10 October every one they name is in this
tree. Two more were removed: `no-hand-read-controller-evidence` named a v1 run's `opening.json` and
`terminal.json`, and a v2 run is its log, opened through `tools/runs/`; `no-hand-spelled-tree-root`
named `6c88e73dd:src/meta/campaign-root.ts` for v1's `campaigns/` and `domains/` trees, and v2 keeps a
campaign under `.ana/d2/<name>` (15 October):

| Rule | It names | Here |
| --- | --- | --- |
| `no-hand-read-argv` | `.claude/skills/main/cli.ts` | Present. A skill script declares a `runCommand` spec, or passes its arguments to `parseOrDie`. The commands under `tools/` are outside the rule and parse with `parseArgs` from `#src/meta/process.ts` |
| `no-hand-spelled-git` | `src/meta/git.ts` (`gitOutput`, `gitText`, `gitMaybe`), from skills, `src`, `tools/runs` and `tools/d2` | Present. Until 15 October the owner was `e3dfa9eb8:.claude/skills/main/git.ts`, which production cannot import, and `tools/runs` and `tools/d2` spelled git at five sites. The landing and gate commands of `tools/runtime`, and tests, are outside the rule: they read exit codes and feed input |
| `no-lifetime-outside-owner` | `stageCommandIsolation` (`src/wall/isolation.ts`), `killProcessGroup` and `terminateAndReapProcessGroupId` (`src/meta/subprocess.ts`) | Present. The owner and its reader are the two files the rule exempts |

If a rule reports on your code and names an owner that is absent, do not obey a remedy that
does not exist. Retune the rule's source to v2's owner with a fixture for each side, in the same
change, as 12.2 allows.

## 12.9 The whole-tree scans

`bun run simplify` prints shapes that span files (`tools/oxlint/tree-findings.ts`, with the identity,
copied-block, stale-reference and fact scans beside it). They report and
never block; `bun run commit:check` prints the ones on your changed lines. Treat each row as a
question, repair the true ones, and answer a false one in the ledger as `tree/<kind>`.

| Kind | Repair |
| --- | --- |
| `no-unused-module`, `no-test-only-module`, `no-test-only-export` | Delete the code with its test, or wire it into a live path |
| `no-unused-field`, `no-unused-reexport` | Delete it, with the branch that handled it |
| `no-single-reader-export` | Move the one export into its one reader |
| `no-duplicate-block` | One owner for the block |
| `no-unowned-identity` | One constant for the name |
| `no-unowned-fact` | One function for the fact, in the module that owns the value's type |
| `no-superseded-schema-tag`, `no-compatibility-path` | Drop the old reader |
| `no-stale-reference` | Point a path at where the thing lives now, or cite it as `<sha>:path` in a record of its time; document only a setting some code reads |
| `no-scattered-state-literals` | Name each grouping in the owner of the states (a predicate or a table) and call it |
| `no-unowned-state-literals` | Declare the states once, with their groupings beside them (opinionated) |
| `no-scattered-enum-literals` | Name each grouping beside the set; it names kinds rather than states, so it is reported apart |
| `no-repeated-external-read` | Read once where the call paths join and pass the answer on |
| `no-duplicate-derivation` | Call the exported function that already returns the fact |
| `require-exhaustive-mapping` | Say which set a lookup `Map` maps (`satisfies Record<…>` on its entries) |
| `max-filesystem-imports` | None. It is a register: a file keeps its count of `filesystem.ts` imports, and a change adds at most one |

## 12.10 The size policy

`tools/loc/source-policy.ts` holds a file to 800 nonblank lines and a function to 115, over `src`,
`tools` and `vendor`, measured after formatting. It also reports an `export` that no other file
names, where a name spelled in a comment counts as a reader. `source-policy.json` lists
exceptions and is empty.

At PR #80 no package script, CI job or hook runs it, and run by hand it reports findings of all
three kinds in the existing tree: files over 800 lines, functions over 115, and unused exports.
Hold every new or rewritten file and function to the ceilings, add no finding, and do not add an
entry to `source-policy.json` to pass. There is no complexity gate in v2.

## 12.11 Per-path overrides

`.oxlintrc.json` changes the rules on two paths. `test/**` turns off `await-thenable`, for the
reason its row in `tools/oxlint/rules-off.tsv` gives, and `tools/oxlint/anti-slop/**` lets a
`default` arm make a `switch` exhaustive. Two blocks that named trees v2 does not have,
`**/src/backends/oauth/**` and `packages/ui/**`, went on 10 October. These lists only shrink:
never add a file to one, and never widen a glob to take in the file you are editing.

## 12.12 Tests

- `bun:test`, in `test/`, one flat directory, named for the module they hold:
  `test/compare.test.ts` for `src/kernel/compare.ts`.
- Keep the positive case and the nearest hostile case in the smallest owning file. Add the case
  that is missing, and say in the pull request that the test fails when the change is removed.
- A test's name is a sentence about the system: "passes the plan's smallest wins at 0.10 and
  nothing one win short of them".
- No module mocks; inject through an interface. No fixed sleeps; wait on
  `Promise.withResolvers()` or poll with a deadline. Do not raise a timeout to hide a slow test.
- A model seat in a test is a script. `test/fixtures/` holds a fake Claude CLI and recorded SDK
  streams.
- A lint rule's fixture marks every declaration `// REPORT <why>` or `// ADMITTED <why>`
  (`test/helpers/oxlint-rule-fixture.ts`), so one text states both halves of the rule.
- A test that proves an export nothing else calls is what `tree/no-test-only-export` reports. Test
  the live path.

## 12.13 Adding or changing a lint rule

A rule's name says what it rejects or asks for, as ESLint, typescript-eslint and anti-slop name
theirs: `no-` for a pattern refused, `prefer-` or `require-` for the alternative asked for, and
`max-` for a count, which takes ESLint's `{ max: number }` where it has an option. Name it no more
specifically than the smell and never by its mechanism or tier; a whole-tree scan's kind follows
the same pattern under `tree/`. The rule lives in `tools/oxlint/ana/rules/<name>.ts`, is
registered under that name in `tools/oxlint/ana/index.ts` and in `.oxlintrc.json` as `"error"`,
and has a fixture test; `tools/oxlint/plugins.ts` is the record every other list of rules reads,
and `test/rule-names.test.ts` fails on a name off the pattern, a file and a registration that
differ, a rule no config runs or no test names, and a config entry, ledger row or document that
names a rule that does not exist. Its head comment carries the
argument: the shape, its cost, what was measured and when, each exemption with the site that
forced it, and whether it fixes and why. A rule enters only when, at every site it reports, some
spelling passes every other rule; a rule whose remedy another rule refuses ends up switched off.
`tools/oxlint/FIXER-DECISIONS.md` states when a rule may carry a fixer, and a rule's
measurements go in its head comment and its commit. Measure through
`bun run lint -c <one-rule config>`, never raw `oxlint`: a config without the type-aware option
reports zero and says nothing.

A rule that is a heuristic, or that still has sites in the tree, starts in
`tools/oxlint/staged-rules.json` at `"warn"` instead: `bun run simplify` prints its sites and
nothing gates on them. It moves to `.oxlintrc.json` as an error once no site of it stands.
A gated rule can stage a wider reading the same way: `ana/no-positional-boolean-parameter`
gates with its default and is staged with `widen: ["flags", "bindings"]`, Foxglove's further
readings of a boolean parameter, until their sites are settled.

## 12.14 Implicit state

An implicit state machine is a state with no one typed owner, spread over booleans, string
literals each reader spells by hand, which files exist, what a name encodes or how old a file is.
Readers re-derive it their own way and drift, and a transition between two of them (a crash
between two writes, a slow holder past a threshold) lands in a state no branch expects. Give it
one owner: a union, one record of a process's phase, the holder itself for a lock.

Both tiers gate as errors in `.oxlintrc.json` and, like `ana` and `anti-slop`, fail only a strict
run. The `tree/` rows of the two tables below span files, so they are whole-tree scans (12.9) that
`bun run simplify` reports and no lint gates on. A site whose state has no other place to live, such
as a ported serialisation format or a fact kept only in a name a person types, is answered in the
not-slop ledger.

The generic tier infers its structure from syntax, asking the compiler only whether a literal set
is ever written where a value changes; it names no module of this repository and runs on any
TypeScript tree; `bun tools/oxlint/tree-implicit-state.ts <root>` scans a foreign one.

| Finding | Repair |
| --- | --- |
| `implicit-state/no-coupled-flags` | Fields of one state written together, at most one set each time, computed by comparisons that cannot both hold, or written as opposite literals: hold the mode in one discriminated field |
| `implicit-state/no-marker-file-state` | A phase read from which files exist in one folder: one record of the phase |
| `implicit-state/no-age-based-lock` | A file's age against a constant as the holder's liveness: ask the holder (a pid, a lease, an exclusive open) |
| `tree/no-scattered-state-literals` | Name each grouping of a declared union in its owner |
| `tree/no-scattered-enum-literals` | The same, for a set no update ever writes (a method, an extension): reported apart |
| `tree/no-repeated-external-read` | Read once where the call paths join |
| `tree/no-duplicate-derivation` | A fact an exported function returns, spelled again by hand in another file: call the owner |
| `tree/require-exhaustive-mapping` | A lookup `Map` that leaves part of a declared set out, or maps all of it with no type holding it there |

The opinionated tier, `implicit-state-opinionated`, holds the stances that are right for a
codebase that keeps one log and a record beside each name and contested elsewhere; its head comment
names each stance and where it is contested. It is a separate plugin so that another tree can take
the generic tier alone, and its rules are opinionated because they report more wrongly on foreign
repositories, not because they matter less here.

| Finding | Repair |
| --- | --- |
| `implicit-state-opinionated/max-boolean-fields` | More than two required boolean members on one record, or more than three boolean parameters on one function: name the states as a union |
| `implicit-state-opinionated/prefer-state-union` | Boolean fields a class's methods move at different times, or a flag derived from two others of one record: name the states as a union |
| `implicit-state-opinionated/no-state-in-names` | A captured group of a pattern applied to a name and read back: keep the fact in a field of the record the name labels |
| `tree/no-unowned-state-literals` | The same word-like literals grouped by hand in two or more files and declared nowhere: declare the states once |
