# ADR 0003: Offline verifier cells, checker acceptance, and archive reading

## Status

Accepted

## Context

Check programs grade solver answers against hidden task values and optional deliverables. Checks must see only what their brief declares, run offline in isolation, distinguish check faults from host/verifier non-results, and be calibrated mechanically before an exam is frozen.

## Decisions

1. **Per-check declared input projection (`src/kernel/verify.ts`, `checkEvaluationRequest`, `projectPaths`)**
   Each check receives a freshly projected request containing only its declared public paths, declared deliverable paths, and its own hidden operand (`none`, `required`, or `whole`). Declaring a parent path grants its subtree. A `required` hidden operand that is absent throws immediately rather than silently skipping, distinguishing a broken task from a non-applicable check.

2. **Offline verifier cell and file integrity (`src/kernel/verify.ts`, `src/kernel/check-child.ts`)**
   - Checks execute inside a dedicated offline command wall (`network: false`) under `HOST_SCRATCH_ROOT`. The check program is copied under read-only `kept/program` so no check file can masquerade as `result.json`, and results are written to `result.json` rather than stdout because checks may print arbitrary output.
   - `checkProgramFiles` walks directories in deterministic code-unit order and refuses symlinks or special files so a check program's version hash and cell copy cannot read outside the check directory.
   - Each running check writes a `<slot>.run` marker file removed on completion so a cell-wide timeout caused by a non-yielding synchronous loop attributes fault to the active check rather than reporting a generic verifier crash.
   - Only pre-resolved tools declared in the brief (`cell.tools`) are callable; a tool-local timeout is armed only when explicitly requested so it does not race with `timed()`'s per-check deadline (`PER_CHECK_MS`).

3. **Distinguishing program launch failures from check rejections (`src/kernel/check-child.ts`, `programNeverRan`)**
   A non-zero exit with empty stdout plus either a shell launch-failure signature on exit 126/127 (`SHELL_LAUNCH_FAILURE`) or CPython startup failure (`PYTHON_START_FAILURE`) is classified as a verifier non-result rather than a check failure, while permitting programs that legitimately exit 126 or 127 themselves.

4. **Objective execution order and instrument provenance (`src/kernel/verify.ts`, `src/kernel/acceptance.ts`)**
   - `OBJECTIVE` runs only after every validity check passes, receiving the full answer, deliverables, public task, and hidden values.
   - Under Rule 10, only binaries physically installed in an operator pack's `.toolchain/` qualify as independent instruments (`"pack"`). Drafted-exam binaries and ambient host binaries named in `host-tools.json` resolve as `"host"` and require explicit operator admission (`--admit`). Lexical executable paths are preserved for Python PEP 405 venvs while hashing canonical `realpathSync` targets so binary updates invalidate digests.

5. **Mechanical checker acceptance probes (`src/kernel/acceptance.ts`, `doNothingAnswer`, `probeReading`, `deliverableReading`)**
   - Every check program is tested before acceptance against `doNothingAnswer` (minimal schema-conforming value following local `#` refs), cross-example control swaps, hidden-value swaps, and deliverable removal.
   - Total blindness (all checks and objective insensitive) is a hard fault; validity-only insensitivity when the objective remains sensitive surfaces as a factual note rather than a refusal gate.
   - `answerSchema` (`src/kernel/contract.ts`) compiles via TypeBox's compiled validator (no coercion) and refuses non-object JSON Schemas and unguarded self-referential schemas that would infinite-loop in tail-call engines.

6. **Safe deliverable storage and zip text extraction (`src/kernel/answer-files.ts`, `src/meta/zip.ts`)**
   - Submitted deliverables are capped at 64 files / 16 MiB, validated for relative non-escaping unique paths, and published atomically by SHA-256 digest under `states/deliverables/`.
   - `zipTexts` reads stored and deflated archive members within an inflated byte budget, rejecting archives with duplicate member names (ambiguous across readers) and clamping `inflateRawSync`'s `maxOutputLength` to at least 1 byte because Node/Bun rejects `0` even for empty deflated members. `storedZip` builds real uncompressed zip bytes for control answers so `task.feasible` archives read back identically to solver deliverables.
