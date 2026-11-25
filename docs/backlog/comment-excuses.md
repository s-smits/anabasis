# Comment-audit excuse backlog (`src/`)

Hacky implementations, upstream private-API mirrors, and compatibility workarounds surfaced while auditing all 2,028 non-exempt comments in `src/`. Each comment has been deleted from source; the items below are staged for operator review before filing as GitHub issues (or fixing directly on the stack).

## 1. Rename misleading `src/agent/backends/scrub-env.ts`

- **Location:** `src/agent/backends/scrub-env.ts` (former header comment lines 1–3)
- **Former excuse:** *"Although this file retains its v1 name, no scrubbing occurs here because child environments are constructed from explicit allow-lists."*
- **Issue:** The file exports only two type aliases (`EnvValues`, `OptionalEnvValues`) and performs no environment scrubbing. Keeping the v1 filename misleads readers about where environment isolation happens.
- **Suggested fix:** Move `EnvValues` and `OptionalEnvValues` into `src/sandbox/policy.ts` (or a dedicated env-types module under `src/agent/backends/`) and update imports.

## 2. Remove duplicated private `pi-durable` retry predicate in `src/agent/session.ts`

- **Location:** `src/agent/session.ts` (former comment lines 349–352, around `attempt` classification in `sessionHooks`)
- **Former excuse:** *"Mirrors `generation.js`'s retry predicate (context overflows are never retried) because `pi-durable` 1.5.2 does not expose its decision."*
- **Issue:** Duplicating an internal predicate from `@earendil-works/pi-durable` creates silent drift whenever `pi-durable` updates its retry rules, causing turn budgets and `retried` trace annotations to disagree with the actual retry loop.
- **Suggested fix:** Expose the retry decision from `pi-durable` upstream, or pin a conformance test against `pi-durable`'s retry behaviour so upgrades fail loudly on drift.

## 3. Remove hardcoded private `pi-durable` truncation constants in `src/tools/answer.ts`

- **Location:** `src/tools/answer.ts` (`RESULT`, former comment lines 80–81)
- **Former excuse:** *"What pi keeps of a tool's result, `DEFAULT_MAX_BYTES` and `DEFAULT_MAX_LINES` of pi-durable's `truncate.js`, which 1.5.2 still keeps private."*
- **Issue:** Hardcoding private upstream limits means Anabasis's spill threshold silently drifts if `pi-durable` changes its truncation bounds.
- **Suggested fix:** Export truncation limits from `@earendil-works/pi-durable` or verify parity in `test/walled-env-conformance.test.ts`.

## 4. Fix 1-hour cache-write billing inside `vendor/pi-claude-bridge` instead of patching in `src/agent/backends/claude.ts`

- **Location:** `src/agent/backends/claude.ts` (`take`, former comment lines 634–635)
- **Former excuse:** *"`pi-claude-bridge` 0.9.1's `updateUsage` leaves pi's hour-long share of the cache writes unset, so pi would bill Claude Code's writes, all of them an hour long, at the five-minute price."*
- **Issue:** Usage accounting is split between `vendor/pi-claude-bridge` and a post-hoc patch in `claude.ts`.
- **Suggested fix:** Patch `updateUsage` in `vendor/pi-claude-bridge` (documenting the local edit per `AGENTS.md` §11) or upstream the fix, then delete the override in `claude.ts`.

## 5. Replace assumptions about minified Claude CLI internals in `src/agent/backends/claude.ts`

- **Location:** `src/agent/backends/claude.ts` (`WINDOW_BOUNDS`, `BARE_WINDOW`, `claudeExecutable`, `claudeEnv`; former comments lines 189–193, 218–222, 247–252, 462–465)
- **Former excuse:** Relied on minified symbol names (`gXe`, `ggt`, `fq`, `XA`, `SV`, `Uf`, `rht`, `hAe`, `UEr`, `x4n`) inspected in bundled CLI `0.3.285` (already stale against installed `@anthropic-ai/claude-agent-sdk` `0.3.311`).
- **Issue:** Undocumented CLI env-var clamping and binary-resolution internals can silently change on SDK bumps.
- **Suggested fix:** Add a model-free contract check verifying `claudeExecutable()` resolution and `DISABLE_AUTO_COMPACT` / window-clamping behaviour against the installed SDK version, and move to public SDK options wherever available.

## 6. Centralise executable-file writing instead of ad-hoc `chmodSync` after `Bun.write`

- **Location:** `src/examiner/shell.ts` (former comment line 134: `chmodSync(runs, 0o755)`)
- **Former excuse:** *"Bun 1.4 writes text at 0644 whatever `mode` its write is given."*
- **Issue:** Callers must remember to follow file writes with `chmodSync(path, 0o755)` whenever creating scripts, risking subtle permission bugs on future sites.
- **Suggested fix:** Add a single `writeExecutableSync(path, content)` helper in `src/meta/filesystem.ts` and route executable script creation through it.

## 7. Centralise provider stringified-JSON tool-argument coercion at the backend boundary

- **Location:** `src/examiner/shell.ts` (`fromHome`, former comment lines 186–187) and `src/meta/json-runtime.ts` (`decodedJsonText`, former comment lines 32–34)
- **Former excuse:** Providers occasionally send stringified JSON (`"null"`, `"{ \"from_file\": ... }"`) for structured tool arguments, patched locally with regex and recursive re-parsing inside Examiner tools.
- **Issue:** Any non-Examiner seat tool receiving stringified JSON arguments from the same provider remains unprotected while Examiner duplicates decoding logic.
- **Suggested fix:** Normalise stringified JSON tool arguments once at the agent backend boundary (`src/agent/`) before tool dispatch, and remove seat-specific workarounds.

## 8. Pin Bun `maxBuffer` exit-code race and `signalCode` coercion in tests

- **Location:** `src/meta/subprocess.ts` (`runSync`, former comments lines 162–167, 173)
- **Former excuse:** Works around a Bun `maxBuffer` race (child exits 0 with truncated output before kill lands) and numeric-vs-string `signalCode`.
- **Issue:** Without a dedicated regression test exercising the truncated-output boundary, future refactors could remove the length-based `cappedAt` check and silently accept truncated command output.
- **Suggested fix:** Ensure a deterministic test in `test/` exercises `cappedAt` when a child hits `maxBuffer` and exits cleanly, and remove the `String(result.signalCode)` coercion once Bun types `signalCode` uniformly.

## 9. Retire legacy `SCRATCHPAD.md` Builder memory fallback

- **Location:** `src/builder/memory.ts` (`HOME_NOTES`, `keptOf`; former comments lines 32–33, 77–79)
- **Former excuse:** *"a session begun on the release before claude-mem's base wrote its notes in `SCRATCHPAD.md` as well, and a stop from this tree would otherwise lose them."*
- **Issue:** Compatibility fallback for a retired filename violates `AGENTS.md` §12 / `tools/oxlint/HABITS.md` §12.3 (no compatibility shims outside log `EVENT_KINDS`).
- **Suggested fix:** Remove `"SCRATCHPAD.md"` from `HOME_NOTES` and simplify `keptOf` to read `MEMORY.md` alone once no active pre-claude-mem sessions remain.

## 10. Protect projected check inputs against in-process mutation in `src/kernel/verify.ts`

- **Location:** `src/kernel/verify.ts` (`projectPaths`, former comment lines 34–35)
- **Former excuse:** *"omitting `structuredClone` because `runCell` serialises projections synchronously to child stdin."*
- **Issue:** `checkEvaluationRequest` is exported and returns shallow references to subtrees of the caller's task/answer objects; any non-serialising caller or test mutating the returned request mutates the caller's original task object.
- **Suggested fix:** Return deep-cloned or deeply frozen projections in `projectPaths` (or restrict `checkEvaluationRequest` to internal cell serialisation).

## 11. Re-evaluate TypeScript `lib` augmentations and `keyed` cast under TypeScript 7

- **Location:** `src/meta/runtime-values.ts` (`ObjectConstructor.create`), `src/meta/json-shape.ts` (`ArrayConstructor.isArray`), `src/meta/optional-key.ts` (`keyed`)
- **Former excuse:** Global interface merges and a local `as Key<K, V>` assertion exist solely to patch `lib.es5.d.ts` `any` returns and computed-key widening.
- **Issue:** Ambient global type augmentations affect every file in the compilation unit and can hide upstream stdlib changes.
- **Suggested fix:** Verify under `typescript@7` whether any augmentation is now redundant and narrow or remove it if standard library types suffice.

## 12. Retire dual `runtime` passing on `request` in `src/kernel/check-child.ts`

- **Location:** `src/kernel/check-child.ts` (`decide`, former comment lines 205–206)
- **Former excuse:** *"As in v1, the port rides on the request too, so a check that destructures it from there reaches the same tools as one that takes it as the second argument."*
- **Issue:** Supporting two calling conventions for check functions complicates the verifier contract and hides which argument owns `runtime`.
- **Suggested fix:** Pass `runtime` exclusively as the second argument `(request, runtime)` once remaining v1 packs are retired or updated.
