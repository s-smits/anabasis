# Code that passes the first time

This guide expands the coding conventions of `AGENTS.md` section 12. Any session that writes code should read it in full before editing; sessions that do not modify source code need not load it. The binding contract remains section 12 of `AGENTS.md`: pass the gate in strict mode, never disable a rule, and follow the habits below.

Most lint findings in this repository are avoidable by writing idiomatic code from the start, eliminating repeated round trips through the linter.

## 12.1 Compiler and formatter

- TypeScript runs in `strict` mode with `noUncheckedIndexedAccess` (indexed reads produce `T | undefined`), `exactOptionalPropertyTypes` (`{ k: undefined }` and `{}` are distinct values), `noUnusedLocals` and `noUnusedParameters`. The compilation target and library are ES2025 with `NodeNext` modules.
- All relative and subpath imports include the `.ts` extension. Files under `src` and `vendor` import one another by relative path. Elsewhere, imports climbing three or more directory levels use the subpath aliases declared in `package.json` (`#src/...`, `#tools/...`, `#skills/...`), whereas imports traversing one or two levels remain relative.
- Biome handles formatting: two spaces, 110-character line width and double quotes. Do not align or wrap lines manually; run `bun fmt`, or `bun fmt <paths>` for targeted files. Using the `fmt` script prevents Bun's built-in formatter (which wraps at 80 columns and rewrites `vendor/`) from running instead.
- `bun run typecheck` (`bun check`) covers all paths in `tsconfig.json`: `src`, `tools`, `vendor`, `test`, `studies` and `.claude`. Skill scripts are subject to typechecking, linting and their owning tests, including `test/skill-scripts.test.ts` and `test/meta-cli.test.ts`.

## 12.2 How lint runs

`bun run lint` runs type-aware Oxlint across `src`, `tools`, `test`, `packages` and `.claude` with `--deny-warnings` and `--report-unused-disable-directives`. `packages/ui` is linted once its dependencies are installed (`bun run ui:deps`), under its own `tsconfig.json` and without disabling any rules; a whole-tree run without UI dependencies skips it and reports doing so. Four repository plugins run alongside Oxlint's built-in rules: `ana`, `anti-slop` and the two tiers of `implicit-state` (12.14). Every enabled rule in `.oxlintrc.json` is an error. Experimental or staged rules reside in `tools/oxlint/staged-rules.json`, which `bun run simplify` executes without gating commits or hooks.

- **Plugin findings fail the run only in strict mode**: invoke `bun run lint -- --strict`, set `ANA_LINT_STRICT=1`, or configure `git config ana.lintStrict true`. A plain run enforces Oxlint's core rules and counts plugin findings without failing. Always work in strict mode: CI runs strict lint, and `main` is expected to report zero findings. Add no new findings, and confirm in your pull request that the strict run is clean.
- Extra CLI arguments pass directly to Oxlint. Ten plugin rules provide autofixers, marked `[fix]` below, which `--fix` applies; `tools/oxlint/FIXER-DECISIONS.md` explains why the remaining rules report without fixing.
- After listing findings, a lint run prints each firing plugin rule once with one or two example pairs: a pattern the rule rejects and an equivalent pattern that satisfies every rule. Each rule stores its pairs in `meta.docs.examples`, and each whole-tree scan stores its pairs in `TREE_FINDING_EXAMPLES` (`tools/oxlint/tree-findings.ts`), which the commit slop report prints in the same format. Every new rule or scan must include example pairs, which `test/rule-examples.test.ts` lints automatically.
- **Never disable a rule**: do not add new `"off"` entries to `.oxlintrc.json` (for the tree, a glob or a file), and do not add `oxlint-disable` comments for plugin rules (`ana/no-inline-slop-answer` rejects them).
- **Every core rule in scope has an explicit decision.** Each rule Oxlint provides in the correctness, suspicious, perf, pedantic, style and restriction categories of the `eslint`, `import`, `node`, `oxc`, `promise`, `typescript` and `unicorn` plugins is either configured at the top level of `.oxlintrc.json` or recorded in `tools/oxlint/rules-off.tsv` as `off` (with a one-sentence rationale) or `staged` (with the remaining site count). `test/lint-registry.test.ts` fails if any rule is unaccounted for, if an enabled rule still has a row, or if a per-path `"off"` override lacks a row. Enabling a rule requires deleting its row.
- **Responding to a false positive** depends on the rule category (`tools/oxlint/not-slop-ledger.ts`):

  | Rule category | Required response |
  | --- | --- |
  | a plugin rule with a fixer | Refine the rule source so the valid pattern passes while existing true positives still fail, verified over real diffs and the tree. The ledger rejects rows for fixable rules |
  | a plugin rule without a fixer, or a `tree/` scan | Refine the rule, or record a site-specific justification: `bun run not-slop -- answer <id> "<a reason a reviewer can check>"` |
  | a core Oxlint rule | Fix the code. Where a genuine exception is a property of the code, place an `oxlint-disable` comment with the rationale beside it; unused directives fail lint |

  Any ledger row whose finding no longer exists fails strict lint; run `bun run not-slop -- prune` to remove stale rows.

## 12.3 The habits

The left column shows the pattern most developers reach for first; the right column shows the form that passes strict lint.

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

In summary:

- **Order file declarations** as imports, then types and interfaces, then module constants, then functions.
- **Limit nesting to three levels.** Use early-return guards and split functions that serve two responsibilities.
- **Keep ternary expressions flat**: at most three branches chained along the tail, with nothing nested inside a condition or first arm. Extract inner conditionals into a `const`.
- **Keep function signatures clean**: at most five parameters, no positional bare booleans, no `object`-typed parameters, no variable shadowing and no parameter reassignment.
- **Avoid single-caller micro-helpers.** Inline non-exported two-statement helpers called once, avoid pass-through wrappers that merely forward arguments, and eliminate single-use temporary `const` bindings that only rename an expression.
- **Assign repeated structures a single owner.** Extract strings of six or more characters repeated four times in a file into a named constant, and extract object literals of three or more properties repeated three times into a helper function.
- **Export only symbols imported elsewhere.** Remove `export` from any symbol with no external reader.
- **Name symbols for their domain role.** Avoid the word "shape" in symbol names (such as `taskShape`) and avoid "legacy" in production identifiers.
- **Avoid backwards-compatibility branches in source**: no `v1 || v2` fallback readers, migration branches or shims. A reader encountering an unsupported format refuses it. Historical log event kinds are the sole exception (`AGENTS.md`, section 5).
- **Respect size ceilings**: at most 800 nonblank lines per file and 115 lines per function.

Before committing, run `bun fmt && bun run typecheck && bun run lint -- --strict`, the owning tests, and `bun run commit:check`. Before handing off work, run `bun run simplify`.

## 12.4 The `ana` rules

A test file is any file under `test/` or matching `*.test.*`. Rule-specific exemptions are documented in each rule's source.

**Structure**

- `require-declarations-first` [fix]: place imports, types and module constants above functions. A constant whose initialiser invokes a function or reads bindings declared later stays in place. Consecutive misplaced declarations emit a single diagnostic and are hoisted together.
- `no-inline-schema-literal`: hoist constant tables of three or more entries built inside a function to module scope under a descriptive name. Test files are exempt.
- `no-deep-nesting`: statements nested four levels deep inside a function fail lint. `if`, loops, `switch` and `catch` increment depth; guard clauses (an `if` without `else`, at most three statements, ending in `return`, `continue`, `break` or `throw`) do not.
- `no-tangled-ternary`: at most three cases, extending strictly along the tail.
- `no-single-caller-helper`: inline non-exported functions with a single caller and a short body (at most two statements and five lines when called in an expression, or three statements and seven lines when called as a statement). Yields if inlining would push the caller past 115 lines.
- `no-pass-through-wrapper`: rejects functions that merely forward their parameters unchanged. Supplying a default, narrowing a type or binding a fixed argument makes it a legitimate wrapper.
- `no-single-use-const-chain`: three or more consecutive `const` bindings where each is read once by the immediately following statement should be combined into a single expression. Comments or explicit type annotations break the chain.
- `no-renaming-temporary` [fix]: a binding such as `const rows = bundle.rows;` read only once below should be replaced by `bundle.rows`. Bindings read inside a closure after a narrowing check are exempt because they preserve TypeScript's narrowing.
- `no-alias-restating-return`: a type alias used solely as the return type of a single function should be inlined as that function's return annotation and deleted.

**Branches**

- `no-arms-differing-in-one-term`: two conditional branches identical except for a single sub-expression should be collapsed into one branch with the condition at that value.
- `prefer-const-conditional` [fix]: rewrite `let x; if (c) x = a; else x = b;` as `const x = c ? a : b`, and rewrite a default followed by an override as `const w = o.w ?? D`.
- `no-positional-boolean-parameter`: use a union of two string literals instead of a bare boolean parameter, or for an exported function take the caller's row (`openingCommand(run)`). Test files, unexported and uncalled callback functions, and booleans whose every read decides only whether anything is yielded (`holds ? [what] : []`, reading at the call site as an `if`) are exempt.
- `no-side-effect-in-predicate`: prohibits mutation inside `filter`, `find`, `some` or `every` callbacks. Deduplicate with `new Map(rows.map((r) => [r.id, r]))` or write an explicit loop.

**Arrays and loops**

- `prefer-find-over-loop` [fix]: applies the loop-to-`find` rewrite from 12.3. The remaining array rewrites in 12.3 are coding habits without a dedicated rule.
- `no-inline-block-reducer`: a `.reduce` callback with an inline block body obscures loop state; write an explicit `for...of` loop instead.

**Calls**

- `no-transposed-argument`: detects arguments named for one another's parameters (two swapped or three or more rotated) against a callee declared in the same file (function, `const`, `this` method, object-literal method or class constructor via `new`). Matches identifiers and trailing property reads whose words start or end with the parameter name (such as `sourcePath` for `source`). A single mismatched argument is ignored. Cross-file calls are checked by the whole-tree scan `tree/no-transposed-argument` under `bun run simplify`. Fix whichever side is wrong.

**Repetition**

- `no-repeated-string-literal` [fix]: strings of six or more characters repeated four times in a file (ten times in a test). Import specifiers, object keys, bare tags, test prose and strings declared as literal types in the same file (which the compiler already verifies) are exempt.
- `no-thrice-spelled-object`: object literals of three or more properties repeated three times in a file (five times in a test).

**Types**

- `no-unproven-unknown-parameter`: any `unknown` parameter must be validated inside the function body via a type predicate, narrowing guard or prover call (`is...`, `as...`, `assert...`, `parse...`, `errorMessage`). Forwarding it directly proves nothing.

**Owners**

- `no-hand-rolled-error-render` [fix]: use `errorMessage(e)` and `asError(e)`.
- `require-captured-json-runtime` [fix]: prohibits ambient `JSON.parse` and `JSON.stringify` under `src`.
- `require-meta-runtime-import` [fix]: prohibits direct `node:` imports outside `src/meta`. Seven builtins have wrappers in `src/meta` and are autofixed: `node:fs`, `node:fs/promises`, `node:path`, `node:os`, `node:net`, `node:module` and `node:assert/strict`. Other builtins (such as `node:crypto`) report without autofix: use an existing `src/meta` helper (such as `sha256`) or add a wrapper there. Tests and `.claude` are exempt.
- `prefer-key-if-defined` [fix]: replace guarded property assignments after an object literal with `...keyIfDefined("k", v)` inside the literal.
- `no-hand-rolled-sleep`: prohibits `setTimeout`-based promises. Wait on the actual condition or use `Bun.sleep`.
- `no-lifetime-outside-owner`: spawning and killing a child process outside `stageCommandIsolation` (`src/wall/isolation.ts`) creates a second owner of process lifetime. Signal processes through `killProcessGroup` or `terminateAndReapProcessGroupId` (`src/meta/subprocess.ts`). Tests are exempt.
- `no-react-effect`: prohibits `useEffect`, `useLayoutEffect` and `useInsertionEffect` in components and hooks. Derive values during render, reset state with `key`, perform side effects in event handlers, use callback refs, subscribe to external stores via `useSyncExternalStore`, or run one-time mount logic through `useMountEffect` (`packages/ui/src/mount.ts`, the sole owner). Tests are exempt.
- `no-inline-slop-answer`: prohibits inline disable comments for plugin rules; use the not-slop ledger instead.
- `no-hand-spelled-git`, `no-hand-read-argv`: detailed in 12.8.

## 12.5 The `anti-slop` rules

- `no-chained-type-assertions`: prohibits double casts such as `x as unknown as T`.
- `no-conditional-empty-object-spread`: prohibits `...(ok ? { k } : {})`; use `keyIfDefined` or `keysIf` instead.
- `no-known-value-widening`: prohibits type annotations wider than the assigned value. Rely on inference or use `satisfies`. An anonymous object type (including a declared return type) counts as wide only if a member is typed `any`, `unknown`, `object` or an open dictionary; explicitly typed members form a valid contract.
- `no-module-mocking`: inject dependencies through explicit interfaces instead of mocking modules. Also rejects `spyOn` on any imported member or on `Date`, `Math`, `performance`, `crypto`, `Bun`, `process` or `globalThis`; rejects assignments, `Object.defineProperty` or `Object.assign` over them in tests; and rejects faked clocks (`setSystemTime(date)`, `useFakeTimers`). Pass a clock, fetcher or command runner as a parameter instead. `env`, `exitCode`, `execPath` and `console` are permitted as process I/O and captured-runtime test boundaries.
- `no-object-parameters`: prohibits parameters typed `object`.
- `no-runtime-typeof`: use the predicates in `src/meta/json-shape.ts`; `typeof x === "undefined"` remains allowed.
- `no-shape-in-symbol-names`: prohibits identifiers containing "shape", "shapes" or "shaped". An object-literal key holding a literal value (such as `{ shape: "object {joints}" }` as a label) represents data and is exempt; a key holding a computed value is not.
- `no-unknown-returns`, `no-unknown-type-aliases`: prohibits leaking `unknown` outward as a return type or behind a type name: aliases of `unknown`, `any` or containers (arrays, tuples, promises, maps) holding them, members of exported interfaces or type literals, public fields of exported classes, members of local types returned by exports, and exported type-parameter defaults. Local input-only types, `Set<unknown>` and error `cause` fields may keep `unknown`.
- `no-unsafe-dictionary-type`: prohibits `Record<string, unknown>` and `Record<string, any>`.
- `no-widen-then-assert`: prohibits widening a known value and subsequently asserting it back. Widening includes `unknown`, `any`, `object`, open dictionaries, `JsonValue` and `JsonObject` reached via annotations, assertions, local functions whose declared return erases the type, or `JSON.parse(JSON.stringify(x))` (including closures over the binding). Preserve the precise type or copy via `structuredClone`. Also prohibits asserting indexed or lookup results (`xs[0]`, `.at(-1)`, `.shift()`, `.find()`, `.get()`) as present: check explicitly, provide a `??` fallback or iterate. Narrow caught exceptions with `instanceof Error` rather than `as`.
- `prefer-subpath-import` [fix]: enforces the subpath aliases from 12.1.
- `require-safety-comment-for-type-assertion`: every `as T` (except `as const`) must carry a comment directly above the assertion or statement explaining the verified invariant:

```ts
// SAFETY: isManifest validated this two lines above.
const manifest = parsed as Manifest;
```

## 12.6 Core rules that trip most

- `typescript/strict-boolean-expressions`: rejects nullable strings, numbers and booleans in conditions; see the rewrites at the top of 12.3.
- `typescript/no-floating-promises` (with `ignoreVoid: false`): `void p` does not satisfy the rule; await, return or attach `.catch`.
- `typescript/no-misused-promises`: rejects async callbacks where synchronous ones are expected.
- `typescript/no-unsafe-*` and `no-explicit-any`: parse untyped values before use.
- `typescript/no-non-null-assertion`: replace `!` with an explicit guard.
- `typescript/switch-exhaustiveness-check`: handle every union member explicitly; a `default` branch does not satisfy exhaustiveness.
- `typescript/restrict-template-expressions`: format objects and arrays before interpolating them into `${}`.
- `typescript/require-array-sort-compare`: supply an explicit comparator for non-string arrays. Whenever string ordering is recorded or hashed, pass `compareCodeUnits`.
- `typescript/prefer-nullish-coalescing`: use `??` whenever the left operand can be null or undefined; `||` is appropriate only when it cannot.
- `typescript/only-throw-error`, `eslint/preserve-caught-error`: throw `Error` instances and preserve `{ cause }`.
- `eslint/max-params` (limit 5), `no-shadow`, `no-param-reassign`, `no-else-return`, `no-empty` (an empty `catch` requires an explanatory comment), `no-implicit-coercion` and `curly` for multi-line bodies.
- `unicorn/no-negated-condition`, `no-lonely-if`, `prefer-at`, `no-array-reverse` (when the return value is used), `prefer-set-has` and `explicit-length-check`.
- `import/no-cycle`: extract shared definitions into a lower-level module imported by both sides.

## 12.7 Rule pairs that pull against each other

Each potentially conflicting pair has a canonical idiom that satisfies both rules.

| Rule pair | Canonical idiom |
| --- | --- |
| Tangled ternary against negated condition | Extract the inner ternary into a `const` instead of inverting the outer test |
| Single-caller helper against thrice-spelled object | Follow the count threshold: inline at two uses, extract at three |
| Boolean parameter, `object` parameter and `max-params` | Use a string-literal union or a named options interface |
| Key-if-defined, empty-object spread and `exactOptionalPropertyTypes` | Use `keyIfDefined`, `keyIfNotNull` or `keysIf` |
| Strict-boolean against nullish-coalescing | Use `(n ?? 0) > 0`, adding an explicit `!== undefined` guard when subsequent lines require narrowing |
| Renaming temporary against type narrowing | A `const` captured in a closure after a guard is exempt; retain it |
| Deep nesting against function length | Early-return guards do not increment nesting depth; once guards are exhausted, split the function |

## 12.8 The owners in `src/meta`

Each runtime boundary has a single authoritative owner in `src/meta`. Import from it and add any missing wrapper beside its peers.

| Concern | Owner | Exports |
| --- | --- | --- |
| Files | `filesystem.ts` | the `node:fs` surface; `mkdir`, `mkdtemp`, `readdir` and `rm` are the promise variants |
| Paths | `path.ts`, `path-containment.ts`, `path-segment.ts` | `join`, `resolve`...; `containsPath`; `isSafePathSegment` |
| Operating system | `os.ts` | `tmpdir`, `homedir`, `loadavg`, `availableParallelism` |
| Process | `process.ts` | `runtimeProcess` in place of `process`, `parseArgs`, `capturedSpawn` |
| Subprocesses | `subprocess.ts` | `runSync`, `runTextSyncOrThrow`, `killProcessGroup`, `terminateAndReapProcessGroupId` |
| Host binaries | `host-tool.ts` | `hostTool("git")` |
| Git | `git.ts` | `gitOutput`, `gitText`, `gitMaybe`, `worktrees` |
| JSON I/O | `json-runtime.ts` | `capturedJsonParse`, `parseJsonAs<T>`, `capturedJsonStringify` |
| JSON types and predicates | `json-shape.ts` | `JsonValue`, `JsonObject`, `OpenRecord`, `isString`, `isNumber`, `isBoolean`, `isRecord`, `asRecord`, `isFunction` |
| Canonical JSON and hashes | `stable-json.ts`, `digest.ts` | `stableJson`, `canonicalJson`, `sameJsonValue`, `hashJsonValue`, `compareCodeUnits`; `sha256`, `sha256OfFile` |
| Caught values | `runtime-values.ts` | `errorMessage`, `asError`, `errorCode` |
| Optional keys | `optional-key.ts` | `keyIfDefined`, `keyIfNotNull`, `keysIf` |
| Text | `text.ts`, `bounded-text.ts` | `hasText`, `textOr`, `plural`; `boundText` |
| Counting and pooling | `tally.ts`, `pool.ts` | `countBy`, `median`; `pooled` |

Three `ana` rules reference specific owners in their diagnostics, all present in this tree:

| Rule | Owner named | Scope and notes |
| --- | --- | --- |
| `no-hand-read-argv` | `.claude/skills/main/cli.ts` | Skill scripts declare a `runCommand` specification read by production's `parseArgs`. Commands under `tools/` fall outside this rule and parse arguments with `parseArgs` from `#src/meta/process.ts` |
| `no-hand-spelled-git` | `src/meta/git.ts` (`gitOutput`, `gitText`, `gitMaybe`) | Applies to skills, `src`, `tools/runs` and `tools/d2`. Landing and gate commands in `tools/runtime`, along with tests, are outside the rule because they inspect exit codes and pipe stdin directly |
| `no-lifetime-outside-owner` | `stageCommandIsolation` (`src/wall/isolation.ts`), `killProcessGroup` and `terminateAndReapProcessGroupId` (`src/meta/subprocess.ts`) | Exempts only the owner and its designated reader |

If a rule ever cites an owner that no longer exists, do not follow a non-existent remedy; update the rule source to the current owner in the same change and validate it across real diffs and the tree (12.2).

## 12.9 The whole-tree scans

`bun run simplify` reports structural smells that span multiple files (`tools/oxlint/tree-findings.ts`, together with the identity, duplicate-block, stale-reference and fact scans). The gate fails while any unanswered site of a listed shape stands, so every commit of a landing passes them; `bun run commit:check` prints findings touching your changed lines. Treat each finding as a diagnostic prompt: fix genuine issues and answer false positives in the ledger under `tree/<kind>`.

| Kind | Resolution |
| --- | --- |
| `no-unused-module`, `no-test-only-module`, `no-test-only-export` | Delete the dead code along with its test, or wire it into a live path |
| `no-unused-field`, `no-unused-reexport` | Delete the symbol together with the branch that populated it |
| `no-single-reader-export` | Move the exported definition into its sole reader |
| `no-duplicate-block` | Consolidate into a single owning function |
| `no-unowned-identity` | Define one shared constant for the identifier |
| `no-unowned-fact` | Define one owning function in the module that owns the value's type |
| `no-superseded-schema-tag`, `no-compatibility-path` | Remove the obsolete reader branch |
| `no-stale-reference` | Update the path to its current location, or cite `<sha>:path` when referring to a historical file; document only settings read by code |
| `no-scattered-state-literals` | Define each state grouping (predicate or table) in the module that owns the state union and call it |
| `no-unowned-state-literals` | Declare the state union once alongside its groupings (opinionated) |
| `no-scattered-enum-literals` | Define each grouping beside the enum set; reported separately because it tracks static kinds rather than mutable states |
| `no-repeated-external-read` | Read the external source once at the common call point and pass the value down |
| `no-duplicate-derivation` | Call the exported function that already computes the fact |
| `require-exhaustive-mapping` | Constrain lookup `Map` entries with `satisfies Record<...>` over the full union |
| `max-filesystem-imports` | Accounting register only: each file preserves its baseline count of `filesystem.ts` imports, and a change adds at most one |

## 12.10 The size policy

`tools/loc/source-policy.ts` enforces ceilings of 800 nonblank lines per file and 115 lines per function across `src`, `tools` and `vendor`, measured after formatting. It also flags any `export` unreferenced by other files (where mentions in comments count as readers). `source-policy.json` holds exceptions and is kept empty.

This script is not wired into package scripts, CI or git hooks, and manual runs may surface pre-existing violations. Hold every new or modified file and function within the ceilings, introduce no new findings, and never add entries to `source-policy.json` to bypass it. There is no cyclomatic complexity gate in v2.

## 12.11 Per-path overrides

`.oxlintrc.json` defines rule overrides for two paths only: `test/**` disables `await-thenable` (for the reason documented in `tools/oxlint/rules-off.tsv`), and `tools/oxlint/anti-slop/**` allows a `default` branch to satisfy switch exhaustiveness. These override lists only shrink: never add files to an override or widen a glob to cover code you are editing.

## 12.12 Tests

- Tests use `bun:test` in a single flat `test/` directory, named after the module they verify (such as `test/condition.test.ts` for `src/kernel/condition.ts`), or after the compartment property they check (`test/decide-explore.test.ts`).
- `AGENTS.md` section 12 establishes the preferred test hierarchy. A bounded exhaustive check enumerates its input space inline and states the bound in its title; a generative test uses a deterministic seeded generator (a linear congruential step, never `Math.random`) and verifies branch coverage.
- State in the pull request which test or mutant fails if the change is reverted.
- Write test titles as complete behavioural statements about the system, for example: "passes the plan's smallest wins at 0.10 and nothing one win short of them".
- Avoid module mocks and fixed sleeps: inject dependencies through interfaces, and synchronise with `Promise.withResolvers()` or deadline-bounded polling. Never raise timeouts to mask slow tests.
- Model seats in tests run against deterministic scripts; `test/fixtures/` contains a fake Claude CLI and recorded SDK streams.
- Lint rules do not have individual test files: they are calibrated against real diffs and the full tree, and `test/rule-examples.test.ts` verifies their printed example pairs.
- A test exercising an export with no production caller triggers `tree/no-test-only-export`; test through the live entry path instead.

## 12.13 Adding or changing a lint rule

Rule names describe what they reject or require, matching ESLint, typescript-eslint and anti-slop conventions: `no-` for disallowed patterns, `prefer-` or `require-` for preferred alternatives, and `max-` for count thresholds (accepting ESLint's `{ max: number }` option where configurable). Name rules for the underlying smell rather than their implementation mechanism or tier; whole-tree scan kinds follow the same convention under `tree/`.

Each rule lives in `tools/oxlint/ana/rules/<name>.ts`, is registered under the same name in `tools/oxlint/ana/index.ts` and `.oxlintrc.json` as `"error"`, and is calibrated over real diffs and the tree rather than unit-tested in isolation. `tools/oxlint/plugins.ts` is the authoritative registry read by all other tools, and `test/lint-registry.test.ts` fails on malformed names, file-to-registration mismatches, unconfigured rules, or stale references in configs, ledgers or documentation.

Every rule's head comment must state the engineering argument: the target pattern, its cost, what was measured and when, every exemption along with the site that motivated it, and whether it autofixes and why. Admit a rule only when every flagged site admits a rewrite that passes all other rules; a rule whose remedy conflicts with another rule will inevitably be bypassed. `tools/oxlint/FIXER-DECISIONS.md` specifies the criteria for autofixers. Always measure rule behaviour with `bun run lint -c <one-rule config>` rather than raw `oxlint`, because omitting type-aware configuration produces false zero counts.

Heuristic rules or rules with unresolved sites in the tree start in `tools/oxlint/staged-rules.json` at `"warn"`, where `bun run simplify` reports their findings without gating. Once all sites are resolved, promote the rule to `.oxlintrc.json` as `"error"`. A gated rule may stage a wider reading the same way behind an option set in the staged config, and the option is removed once the wider reading gates.

## 12.14 Implicit state

An implicit state machine arises when state lacks a single typed owner and is instead reconstructed across coupled booleans, ad-hoc string literals, file existence checks, encoded filenames or file timestamps. Independent readers inevitably drift in how they derive the state, and partial transitions (such as a crash between writes or a slow lock holder exceeding a timeout) produce combinations no branch anticipates. Give every state one authoritative owner: a discriminated union, a single phase record or the lock holder itself.

Both implicit-state plugins gate as errors in `.oxlintrc.json` and fail only in strict mode, like `ana` and `anti-slop`. The `tree/` rows in the tables below span multiple files, so they are whole-tree scans (12.9) that `bun run simplify` reports and the gate holds at zero. Any site whose state genuinely has no alternative representation (such as a ported wire format or a user-supplied name) is recorded in the not-slop ledger.

The generic tier infers structure syntactically, querying the type checker only to determine whether a literal set is mutated; it references no repository-specific module and runs on any TypeScript codebase (`bun tools/oxlint/tree-implicit-state.ts <root>` scans external trees).

| Finding | Resolution |
| --- | --- |
| `implicit-state/no-coupled-flags` | Boolean fields representing one state written together, mutually exclusively, via disjoint comparisons or as opposite literals: replace with a single discriminated mode field |
| `implicit-state/no-marker-file-state` | Process phase inferred from which marker files exist in a directory: store the phase in a single record |
| `implicit-state/no-age-based-lock` | Lock liveness inferred by comparing file age against a constant: query the holder directly (PID, lease or exclusive open) |
| `tree/no-scattered-state-literals` | Define each grouping of a declared union inside its owning module |
| `tree/no-scattered-enum-literals` | Same as above for immutable literal sets (methods, extensions); reported separately |
| `tree/no-repeated-external-read` | Read once where call paths converge and pass the result down |
| `tree/no-duplicate-derivation` | A fact already computed by an exported function re-derived manually elsewhere: call the owner |
| `tree/require-exhaustive-mapping` | A lookup `Map` that omits union members or covers them without type-level enforcement |

The opinionated tier, `implicit-state-opinionated`, encodes conventions suited to a codebase built around a single append-only log and explicit per-entity records, even where other projects might disagree; its head comment documents each stance and its trade-offs. Separating it into its own plugin allows external repositories to adopt the generic tier alone; its rules are labelled opinionated because they have higher false-positive rates on foreign codebases, rather than because they carry less weight here.

| Finding | Resolution |
| --- | --- |
| `implicit-state-opinionated/max-boolean-fields` | More than two required boolean fields on a record, or more than three boolean parameters on a function: model the states as a union |
| `implicit-state-opinionated/prefer-state-union` | Boolean fields mutated independently by class methods, or a flag derived from two other flags on the same record: model the states as a union |
| `implicit-state-opinionated/no-state-in-names` | A regex capture group parsed from a name and used for logic: store the attribute in a field on the record labelled by that name |
| `tree/no-unowned-state-literals` | Identical word-like literals grouped manually across two or more files without a shared declaration: declare the state union once |
