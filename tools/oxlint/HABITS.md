# Code that passes the first time

Expands `AGENTS.md` §12. Read before editing code; write idiomatic code from the start so strict lint passes cleanly on the first run.

## 12.1 Compiler and formatter

- TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, ES2025 + `NodeNext`.
- Include `.ts` on relative and subpath imports. Inside `src` and `vendor`, use relative imports; elsewhere, imports climbing ≥3 levels use `#src/...`, `#tools/...`, `#skills/...` (`package.json`), while 1–2 levels stay relative.
- Biome formats with 2 spaces, 110-char width, double quotes. Run `bun fmt` (or `bun fmt <paths>`); never format manually or run Bun's built-in formatter.
- `bun run typecheck` (`bun check`) covers `src`, `tools`, `vendor`, `test`, `studies`, `.claude` (including skill scripts tested by `test/skill-scripts.test.ts` and `test/meta-cli.test.ts`).

## 12.2 How lint runs

`bun run lint` runs type-aware Oxlint across `src`, `tools`, `vendor`, `test`, `packages`, `.claude` and `studies` (`--deny-warnings`, `--report-unused-disable-directives`; `packages/ui` runs once `bun run ui:deps` is installed). Four local plugins run alongside built-ins: `ana`, `anti-slop`, `implicit-state` and `implicit-state-opinionated`. Staged rules live in `tools/oxlint/staged-rules.json` (reported by `bun run simplify`, non-gating).

- **Always run strict mode**: `bun run lint -- --strict` (or `ANA_LINT_STRICT=1` / `git config ana.lintStrict true`). Plugin findings fail only in strict mode; CI runs strict mode and `main` must stay at zero.
- Extra args forward to Oxlint. Ten plugin rules carry `[fix]` autofixers (`--fix`); `tools/oxlint/FIXER-DECISIONS.md` documents why others only report.
- Firing rules print before/after example pairs (`meta.docs.examples`, `TREE_FINDING_EXAMPLES` in `tools/oxlint/tree-findings.ts`, checked by `test/rule-examples.test.ts`).
- **Never disable rules**: add no `"off"` entries in `.oxlintrc.json` and no inline `oxlint-disable` for plugin rules (`ana/no-inline-slop-answer`).
- **Every core rule in scope is explicitly decided** in `.oxlintrc.json` or `tools/oxlint/rules-off.tsv` (`off` with rationale or `staged` with site count), enforced by `test/lint-registry.test.ts`.
- **False positives** (`tools/oxlint/not-slop-ledger.ts`):

| Category | Response |
| --- | --- |
| Fixable plugin rule | Fix the rule source (ledger rejects fixable rules) |
| Report-only plugin rule or `tree/` scan | Fix the rule, or record `bun run not-slop -- answer <id> "<verifiable reason>"` |
| Core Oxlint rule | Fix the code, or place an explained `oxlint-disable` (unused directives fail) |

Stale ledger rows fail strict lint; prune with `bun run not-slop -- prune`.

## 12.3 The habits

```ts
// Nullable string/number/boolean are not conditions (typescript/strict-boolean-expressions).
// Plain string, plain number and `Row | undefined` pass as they are.
if (name)      // string | undefined   →  if (hasText(name))        // src/meta/text.ts
if (count)     // number | undefined   →  if ((count ?? 0) !== 0)   // or count !== undefined
if (flag)      // boolean | undefined  →  if (flag === true)
name || "x"    // string | undefined   →  name ?? "x"               // textOr(name, "x") if "" falls back too
if (items.length)              →  if (items.length > 0)     // unicorn/explicit-length-check
if (maybe?.length)             →  if ((maybe?.length ?? 0) > 0)
const n = +text; "" + n; !!x   →  Number(text); String(n); x !== undefined

// Positive case first (unicorn/no-negated-condition, eslint/no-else-return)
if (!ok) { a } else { b }      →  if (ok) { b } else { a }
a !== b ? x : y                →  a === b ? y : x
if (c) { return a } else { return b }   →  if (c) return a;  return b;

// Honest types
x as T                         →  predicate, `satisfies`, or parse; else  // SAFETY: <checked invariant>
x as unknown as T              →  parse at boundary (capturedJsonParse + predicate, parseJsonAs<T>)
value!                         →  guard: if (value === undefined) throw …
typeof x === "string"          →  isString(x)               // src/meta/json-shape.ts
Record<string, unknown>        →  JsonObject, or OpenRecord for open views
function f(input: unknown)     →  declare the type, or prove it in the body
function f(): unknown          →  return the parsed type
function f(options: object)    →  named interface
function close(log, true)      →  close(log, "failed")      // string-literal union

// Single owners in src/meta
JSON.parse(text)               →  capturedJsonParse(text)   // JsonValue until checked
JSON.stringify(v)              →  capturedJsonStringify(v)
e instanceof Error ? e.message : String(e)   →  errorMessage(e)
throw new Error("x")  in catch →  throw new Error("x", { cause })
...(v === undefined ? {} : { k: v })         →  ...keyIfDefined("k", v)
import { readFileSync } from "node:fs"       →  same name from src/meta/filesystem.ts
new Promise((r) => setTimeout(r, ms))        →  Bun.sleep(ms), or wait on the condition

// Arrays & promises
xs.map(f).filter(Boolean)      →  xs.flatMap((x) => f(x) ?? [])
xs.filter(p).length > 0        →  xs.some(p)
xs.some((x) => x === "lit")    →  xs.includes("lit")
xs[xs.length - 1]              →  xs.at(-1)
const ys = xs.reverse()        →  const ys = xs.toReversed()
numbers.sort()                 →  numbers.toSorted((a, b) => a - b)   // string[] sorts bare
for (const x of xs) if (p(x)) return x;      →  return xs.find(p)
for (const k of Object.keys(o)) … o[k]       →  for (const [k, v] of Object.entries(o))
void promise; promise;         →  await it, return it, or .catch it
xs.forEach(async (x) => …)     →  for (const x of xs) await …   // or Promise.all(xs.map(…))
```

Quick checklist:
- Declare in order: imports → types/interfaces → module constants → functions.
- Nesting ≤3 levels (early-return guards do not count); ternaries ≤3 tail-chained branches; ≤5 params; no positional booleans, `object` params, shadowing or param reassignment.
- Inline single-caller micro-helpers, pass-through wrappers and single-use renaming `const`s; hoist repeated literals (≥6 chars ×4) and repeated objects (≥3 props ×3).
- Export only symbols imported elsewhere; avoid "shape" or "legacy" in production identifiers; write no `v1 || v2` fallback shims (except historical log `EVENT_KINDS`, `AGENTS.md` §5).
- Ceilings: ≤800 nonblank lines/file, ≤115 lines/function.
- Before committing: `bun fmt && bun run typecheck && bun run lint -- --strict`, owning tests, `bun run commit:check` (and `bun tools/loc/source-policy.ts` when changing exports or large files). Before handoff: `bun run simplify`.

## 12.4 The `ana` rules

Test files = `test/` or `*.test.*`.

- **Structure**: `require-declarations-first` [fix] (imports/types/consts above functions); `no-inline-schema-literal` (hoist ≥3-entry constant tables; tests exempt); `no-deep-nesting` (depth ≤3; ≤3-statement early-return guards exempt); `no-tangled-ternary` (≤3 tail-chained cases); `no-single-caller-helper` (inline short single-caller private helpers unless caller >115 lines); `no-pass-through-wrapper` (no unchanged-arg forwarding); `no-single-use-const-chain` (collapse ≥3 sequential single-use `const`s); `no-renaming-temporary` [fix] (inline single-use alias unless closure-narrowed); `no-alias-restating-return` (inline single-function return aliases).
- **Branches**: `no-arms-differing-in-one-term` (factor single-term branch diff); `prefer-const-conditional` [fix] (`let` + `if` → `const` ternary / `??`); `no-positional-boolean-parameter` (use string-literal union or row arg; tests, uncalled callbacks and `holds ? [x] : []` exempt); `no-side-effect-in-predicate` (no mutation inside `filter`/`find`/`some`/`every`).
- **Loops & calls**: `prefer-find-over-loop` [fix]; `no-inline-block-reducer` (use `for...of`); `no-transposed-argument` (catches swapped/rotated same-file call args; cross-file checked by `tree/no-transposed-argument`).
- **Repetition & types**: `no-repeated-string-literal` [fix in tests] (≥6 chars ×4, ×10 in tests; literal types/imports/keys exempt); `no-thrice-spelled-object` (≥3 props ×3, ×5 in tests); `no-unproven-unknown-parameter` (validate `unknown` params in body via predicate/parser/`errorMessage`).
- **Owners**: `no-hand-rolled-error-render` [fix]; `require-captured-json-runtime` [fix] (`src`); `require-meta-runtime-import` [fix for 7 wrapped builtins; tests/`.claude` exempt]; `prefer-key-if-defined` [fix]; `no-hand-rolled-sleep`; `no-lifetime-outside-owner` (route process spawn/kill through `stageCommandIsolation` / `killProcessGroup` / `terminateAndReapProcessGroupId`; tests exempt); `no-react-effect` (derive in render, key reset, handlers, `useSyncExternalStore` or `useMountEffect`; tests exempt); `no-inline-slop-answer`; `no-hand-spelled-git` and `no-hand-read-argv` (12.8).

## 12.5 The `anti-slop` rules

- `no-chained-type-assertions` (no `as unknown as T`), `no-conditional-empty-object-spread` (use `keyIfDefined`/`keysIf`), `no-object-parameters`, `no-runtime-typeof` (use `src/meta/json-shape.ts`; `typeof x === "undefined"` allowed), `no-shape-in-symbol-names` (data-literal keys exempt), `no-unsafe-dictionary-type` (no `Record<string, unknown|any>`), `prefer-subpath-import` [fix].
- `no-known-value-widening` (infer or `satisfies`), `no-unknown-returns` & `no-unknown-type-aliases` (never leak `unknown`/`any` outward; `Set<unknown>`, error `cause`, local input-only types exempt), `no-widen-then-assert` (never widen then assert back, assert indexed/lookup results present, or `as Error` caught values).
- `no-module-mocking`: inject interfaces instead of mocking modules, `spyOn` on imports/globals (`Date`, `Math`, `performance`, `crypto`, `Bun`, `process`, `globalThis`), mutating them, or faking timers (`env`, `exitCode`, `execPath`, `console` allowed).
- `require-safety-comment-for-type-assertion`: place `// SAFETY: <verified invariant>` directly above every `as T` (except `as const`).

## 12.6 Core rules that trip most

- `typescript/strict-boolean-expressions`, `typescript/no-floating-promises` (`ignoreVoid: false`), `typescript/no-misused-promises`, `typescript/no-unsafe-*`, `typescript/no-explicit-any`, `typescript/no-non-null-assertion`, `typescript/switch-exhaustiveness-check` (`default` does not satisfy), `typescript/restrict-template-expressions`, `typescript/require-array-sort-compare` (use `compareCodeUnits` for hashed/recorded strings), `typescript/prefer-nullish-coalescing`, `typescript/only-throw-error`.
- `eslint/preserve-caught-error`, `eslint/max-params` (5), `eslint/no-shadow`, `eslint/no-param-reassign`, `eslint/no-else-return`, `eslint/no-empty` (comment empty `catch`), `eslint/no-implicit-coercion`, `eslint/curly`.
- `unicorn/no-negated-condition`, `unicorn/no-lonely-if`, `unicorn/prefer-at`, `unicorn/no-array-reverse`, `unicorn/prefer-set-has`, `unicorn/explicit-length-check`, `import/no-cycle`.

## 12.7 Rule pairs that pull against each other

| Rule pair | Canonical idiom |
| --- | --- |
| Tangled ternary vs negated condition | Extract inner ternary to `const` instead of inverting outer test |
| Single-caller helper vs thrice-spelled object | Inline at 2 uses, extract at 3 |
| Boolean param / `object` param / `max-params` | String-literal union or named options interface |
| Key-if-defined / empty spread / `exactOptionalPropertyTypes` | `keyIfDefined`, `keyIfNotNull` or `keysIf` |
| Strict-boolean vs nullish-coalescing | `(n ?? 0) > 0`, or explicit `!== undefined` when narrowing |
| Renaming temporary vs narrowing | Closure-captured `const` after guard is exempt |
| Deep nesting vs function length | Exhaust early-return guards first, then split function |

## 12.8 The owners in `src/meta`

| Concern | Owner | Key exports |
| --- | --- | --- |
| Files / paths / OS | `filesystem.ts`, `path.ts`, `path-containment.ts`, `path-segment.ts`, `os.ts` | `node:fs` surface, `join`, `containsPath`, `isSafePathSegment`, `tmpdir`, `homedir`, `loadavg`, `availableParallelism` |
| Process / subprocess / git | `process.ts`, `subprocess.ts`, `host-tool.ts`, `git.ts` | `runtimeProcess`, `parseArgs`, `capturedSpawn`, `runSync`, `runTextSyncOrThrow`, `killProcessGroup`, `terminateAndReapProcessGroupId`, `hostTool`, `gitOutput`, `gitText`, `gitMaybe`, `worktrees` |
| JSON & hashing | `json-runtime.ts`, `json-shape.ts`, `stable-json.ts`, `digest.ts` | `capturedJsonParse`, `parseJsonAs<T>`, `capturedJsonStringify`, `JsonValue`, `JsonObject`, `OpenRecord`, `isString`/`isNumber`/`isBoolean`/`isRecord`/`asRecord`/`isFunction`, `stableJson`, `canonicalJson`, `sameJsonValue`, `hashJsonValue`, `compareCodeUnits`, `sha256`, `sha256OfFile` |
| Errors, keys, text, stats | `runtime-values.ts`, `optional-key.ts`, `text.ts`, `bounded-text.ts`, `tally.ts`, `pool.ts` | `errorMessage`, `asError`, `errorCode`, `keyIfDefined`, `keyIfNotNull`, `keysIf`, `hasText`, `textOr`, `plural`, `boundText`, `countBy`, `median`, `pooled` |

Owner-citing `ana` rules:
- `no-hand-read-argv` → `.claude/skills/main/cli.ts` (`runCommand` in skills; `tools/` uses `parseArgs` from `#src/meta/process.ts`).
- `no-hand-spelled-git` → `src/meta/git.ts` (skills, `src`, `tools/runs`, `tools/d2`; `tools/runtime` and tests exempt).
- `no-lifetime-outside-owner` → `stageCommandIsolation` (`src/wall/isolation.ts`), `killProcessGroup` / `terminateAndReapProcessGroupId` (`src/meta/subprocess.ts`).

If a rule cites a moved owner, update the rule in the same change.

## 12.9 The whole-tree scans

`bun run simplify` runs multi-file scans (`tools/oxlint/tree-findings.ts`); `bun run gate` holds unanswered sites at zero (`bun run commit:check` checks changed lines). Answer genuine false positives in the ledger under `tree/<kind>`.

| Kind | Resolution |
| --- | --- |
| `no-unused-module`, `no-test-only-module`, `no-test-only-export` | Delete dead code + test, or wire into live path |
| `no-unused-field`, `no-unused-reexport`, `no-single-reader-export` | Delete dead symbol/branch, or move export into its sole reader |
| `no-duplicate-block`, `no-duplicate-derivation` | Consolidate into or call the single owning function |
| `no-unowned-identity`, `no-unowned-fact` | Declare one shared constant or owning function beside its type |
| `no-superseded-schema-tag`, `no-compatibility-path` | Remove obsolete reader branch |
| `no-stale-reference` | Update path (or cite `<sha>:path` for history); document only live settings |
| `no-scattered-state-literals`, `no-unowned-state-literals`, `no-scattered-enum-literals` | Define union and groupings once in the owning module |
| `no-repeated-external-read` | Read once at common caller and pass down |
| `require-exhaustive-mapping` | Constrain lookup `Map` with `satisfies Record<Union, ...>` |
| `max-filesystem-imports` | Accounting cap: preserve baseline `filesystem.ts` import count (+1 max per change) |

## 12.10 The size policy

`tools/loc/source-policy.ts` enforces ≤800 nonblank lines/file, ≤115 lines/function across `src`, `tools`, `vendor` and `.claude/skills`, `AGENTS.md` ≤24,000 bytes, one-way production→helper dependencies, and unreferenced `export`s in `src`, `tools` and `packages/ui/src` (comment mentions count as readers). `source-policy.json` stays empty. `bun run commit:check`, `bun run gate` and `ci.yml` all run it. No cyclomatic complexity gate exists in v2.

## 12.11 Per-path overrides

`.oxlintrc.json` has two overrides only: `test/**` (`await-thenable`, see `tools/oxlint/rules-off.tsv`) and `tools/oxlint/anti-slop/**` (`default` in exhaustive switches). Never add or widen overrides.

## 12.12 Tests

- Flat `test/` directory (`bun:test`), named after module or property. Titles state observable behaviour.
- Prefer bounded exhaustive checks (state bound in title) and deterministic LCG generative tests (never `Math.random`) over examples (`AGENTS.md` §12). State in the PR which test or mutant fails on revert.
- No module mocks or fixed sleeps: inject interfaces, sync with `Promise.withResolvers()` or deadline polling; never raise timeouts to hide slow tests.
- Deterministic fake seats live in `test/fixtures/`. Lint rules are calibrated on real diffs and the tree (`test/rule-examples.test.ts`), not per-rule unit tests. Test through live entry points to avoid `tree/no-test-only-export`.

## 12.13 Adding or changing a lint rule

- Name rules `no-`, `prefer-`, `require-` or `max-` (same for `tree/`) after the smell, not the mechanism.
- Place in `tools/oxlint/ana/rules/<name>.ts`, register in `tools/oxlint/ana/index.ts`, `tools/oxlint/plugins.ts` (single registry) and `.oxlintrc.json` (`"error"`), with `meta.docs.examples`. `test/lint-registry.test.ts` checks naming, registration, configs, `FIXER-DECISIONS.md` and docs.
- Head comment states the rejected pattern, exemptions and whether it fixes (`no fix` required when non-fixable). Admit a rule only when every flagged site rewrites cleanly under all other rules; test via `bun run lint -c <config>` (never raw `oxlint`, which omits type-aware mode).
- Stage heuristic or unresolved rules in `tools/oxlint/staged-rules.json` (`"warn"`) until sites reach zero, then promote to `.oxlintrc.json` (`"error"`).

## 12.14 Implicit state

Implicit state machines hide behind coupled booleans, ad-hoc string literals, marker files, parsed names or file timestamps, letting readers drift. Give every state one typed owner (discriminated union, phase record or process handle). Both plugins gate in strict mode; multi-file `tree/` checks run under `bun run simplify` (12.9).

**Generic tier** (`bun tools/oxlint/tree-implicit-state.ts <root>` runs on external repos):
- `implicit-state/no-coupled-flags` → replace coupled booleans with a single mode union.
- `implicit-state/no-marker-file-state` → store phase in one record instead of marker-file existence.
- `implicit-state/no-age-based-lock` → check holder liveness (PID, lease, exclusive open) instead of file age.
- Whole-tree: `tree/no-scattered-state-literals`, `tree/no-scattered-enum-literals`, `tree/no-repeated-external-read`, `tree/no-duplicate-derivation`, `tree/require-exhaustive-mapping` (see 12.9).

**Opinionated tier** (`implicit-state-opinionated`, separated for external adoption, equal weight here):
- `implicit-state-opinionated/max-boolean-fields` → >2 required boolean fields or >3 boolean params: use a union.
- `implicit-state-opinionated/prefer-state-union` → independently mutated class booleans or flag derived from two flags: use a union.
- `implicit-state-opinionated/no-state-in-names` → regex capture parsed from a name for logic: store the field on the record.
- Whole-tree: `tree/no-unowned-state-literals` → declare shared literal sets once.
