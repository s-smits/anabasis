# ADR 0007: Content-addressed harness storage, tree stamps, and Builder memory

## Status

Accepted

## Context

Harnesses contain a guide, a tool-selection manifest, and an optional `.toolchain/` directory that can hold hundreds of megabytes of installed interpreters and packages. Opening, hashing, and freezing harnesses runs on every solve and check, so it must remain fast, deterministic, symlink-safe, and backward-compatible with existing harness digests.

## Decisions

1. **Historical digest stability (`src/harness/open.ts`, `NO_TOOLS_MODULE`; `src/meta/bundle-layout.ts`, `BYTECODE`)**
   - `NO_TOOLS_MODULE` preserves the empty-tool-module hash input used by historical kept harnesses so existing conditions and digests keep their exact identity.
   - Python `__pycache__` directories (`BYTECODE`) are excluded from harness digests because bytecode caches hold nothing beyond their adjacent source; standalone `.pyc` files outside `__pycache__` remain included.

2. **Fast stat-keyed tree stamps with racy-window bypass (`src/harness/open.ts`, `treeStamp`, `RACY_MS`, `pathsUnder`)**
   - `keptTreeContent` caches `.toolchain/` SHA-256 trees by `treeStamp`, which includes each entry's `ctime`, `mtime`, `size`, `mode`, and `ino`. Including `ctime` catches same-size rewrites from `tar` or `cp -p` that preserve `mtime`.
   - Entries modified within `RACY_MS` (2000 ms) of `Date.now()` bypass the cache so same-size rewrites inside coarse filesystem timestamp ticks (such as Linux ext4 jiffies) never read stale content.
   - `pathsUnder` walks directories manually without following symlinks because Bun's recursive `readdirSync` enters symlinked directories and can fail with `ELOOP`.

3. **Symlink safety and shared large tool trees (`src/builder/kept.ts`, `src/harness/open.ts`, `src/builder/session.ts`)**
   - `openHarness` verifies that `BUILT_AGENTS.md` and `tools-spec.json` resolve inside the harness root so a symlinked guide or spec cannot trick the host into reading host files outside the wall.
   - `keptTree` refuses a symlinked `.toolchain` directory for the same reason, and `refuseNamingHome` rejects symlinks or executable scripts in a frozen `.toolchain/` that embed the session's ephemeral home path.
   - Tool trees larger than `LINKED_TREE_BYTES` (100 MiB) are deduplicated once under `trees/` and symlinked from `.toolchain` on handovers; unlinked trees from `check_harness` calls are cleaned up by `dropUnlinked`.
   - `layPractice` writes released task JSON files into a fresh sibling directory and atomically renames it into `practice/`, removing any prior directory or planted symlink without following it.

4. **Non-blocking Builder finish and session recovery (`src/builder/session.ts`, `src/builder/tools.ts`, `src/builder/memory.ts`)**
   - Ending a Builder session always freezes whatever `harness/` holds (falling back to the last practised snapshot if the final edit does not open) rather than discarding the session. `finishNotice` warns once on broken, unpractised, or uncompared harnesses and lets a second `finish` proceed.
   - `keepPractised` and `keepCutNotes` salvage the last practised harness snapshot and `MEMORY.md` of an interrupted Builder session so crashes do not force the next session to restart from scratch.
   - Cross-session Builder memory (`builderMemoryBlock`) renders newest sessions first within `CONTEXT_OUTPUT_LIMIT`, placed at the top of the opening message ahead of host statements so older Builder notes never read as overriding current host rules. Single oversized notes retain two-thirds head and one-third tail because Builders vary on whether they prepend or append entries.
   - `keepMemory` checks `lstatSync(...).isFile()` (never following symlinks) and swallows filesystem failures so note-saving never aborts a round.
