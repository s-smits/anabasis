# ADR 0002: OS command wall, Seatbelt/Bubblewrap isolation, and seat roots

## Status

Accepted

## Context

Confined seats (Solver, Builder, Examiner) need host toolchains and optional package-index access while remaining unable to read evaluation secrets (the repository, sibling worktrees, stored packs, host `$HOME`, other seats' roots, or verifier cells) or mutate host state outside their seat root.

## Decisions

1. **Allow-read-by-default with explicit secret denials (`src/sandbox/base.ts`, `src/sandbox/isolation.ts`)**
   Because seats invoke host compilers, interpreters, and system libraries, the wall permits reads by default and denies secret subtrees: the repository, every sibling worktree (preventing cross-worktree `.ana` log reads), stored pack roots, host `$HOME` (rejecting relative `HOME` values in `closedHome`), and `SCRATCH_ROOTS` (`ana-built-bash` and `ana-host`). Runtime prefixes (`nodeRuntimeReadRoots`, `darwinToolchainInstallRoots`, `pinnedPythonDir`) are reopened read-only, with ancestor `file-read-metadata` rules (`traversalMetadataRules`) so `realpath` succeeds without making parent directories listable.

2. **Darwin Seatbelt base, path aliasing, and ancestor relocation (`src/sandbox/seatbelt-base.ts`, `src/sandbox/seatbelt-path-guard.ts`, `src/sandbox/policy.ts`)**
   - Adapted from `@anthropic-ai/sandbox-runtime` (Apache-2.0, commits `f7a0f19fd2` and `295f0e1af832131efe40db22f2c65a57f461d849`).
   - Deliberate departures from upstream: removed per-session random `(with message ...)` log tags so identical policies hash to deterministic profile bytes; omitted unused AppleEvents/MachLookup branches; mapped `network` to `trustd` and `TrustEvaluationAgent` for Go and `/usr/bin/curl` TLS validation; permitted `(allow sysctl*)` for JS/Java runtimes while explicitly denying `(deny process-info* (target others))` to block `sysctl(KERN_PROCARGS2)` argv inspection across seats; restricted move-blocking rules to canonicalised literal paths rather than globs.
   - Because Seatbelt matches path strings rather than inodes, `canonicalForms` expands both lexical and canonical paths (e.g. `/var` and `/private/var`), and `moveBlockingRules` blocks `file-write-unlink` and `file-write-create` on every ancestor (excluding `/`) so a confined process cannot rename an ancestor directory out from under a denial rule.
   - `userTempRules` denies Darwin's shared `DARWIN_USER_TEMP_DIR` as a whole (which `mktemp` and `/usr/bin` shims reset `TMPDIR` to) and permits only top-level regular files plus random-named `mktemp` (`*.XXXXXXXXXX`) and Python `tempfile` (`tmpXXXXXXXX`) subdirectories. Character classes are repeated explicitly because Seatbelt regex syntax lacks counted quantifiers.
   - Active developer tool directories precede `/usr/bin` on `PATH` to bypass `xcrun` shims that reset `TMPDIR`.
   - `PIP_BREAK_SYSTEM_PACKAGES=1` and `UV_LINK_MODE`/relocatable venv settings let confined seats install into their private `HOME` under PEP 668 while keeping frozen `.toolchain/` venvs relocatable.

3. **Linux Bubblewrap posture (`src/sandbox/linux-bwrap.ts`)**
   - Binds host `/` read-only with unprivileged user, IPC, UTS, cgroup, and PID namespaces, dropping all capabilities and mounting fresh `/proc` and `/dev`. Protected directories are overmounted with empty `tmpfs` and protected files (including symlink targets outside denied paths) with read-only `/dev/null`.
   - `--disable-userns` is mandatory and never dropped on older `bwrap` (<0.8.0) because it prevents confined children from nesting user namespaces.
   - Both Darwin and Linux fail closed when an outer sandbox is detected (`surroundingSandbox`), refusing to nest or claim external isolation.
   - When `/etc/resolv.conf` resolves outside standard system roots (e.g. `/run` under `systemd-resolved`), only the resolved file is bound rather than its enclosing directory.

4. **Stable policy hashing and network-reach pinning (`src/sandbox/base.ts`, `src/tools/command.ts`)**
   - `policyHash` includes `network` only when `false` so existing seat policy hashes remain stable.
   - `probeSandbox` uses POSIX `true` rather than `:` because special builtins abort POSIX shells such as `dash` when redirection fails.
   - `probeReach` runs without the harness `.toolchain/` on `PATH` so a candidate cannot contaminate `REACH` or `COMPARISON_REACH`. For comparisons, reach is pinned per `(comparison, policyHash)` so both arms observe identical installer prompt text even if an `unreached` reading expires mid-comparison.

5. **Walled upstream `ExecutionEnv` worker (`src/tools/env.ts`, `src/tools/command.ts`)**
   Every seat file and shell tool executes upstream `pi-durable`'s `NodeExecutionEnv` inside a small worker staged under read-only `kept`, rather than reimplementing filesystem semantics on the host. Commands that bring staged files copy them inside the wall from `kept` into a fresh `TMPDIR` directory so the host never writes into a seat-writable directory susceptible to symlink races. All operations on a seat share a queue because `runSandboxed` reuses one `command.sb` and `leader` file per seat.

6. **Process-owned seat roots and Darwin holder teardown (`src/sandbox/sandbox-root.ts`, `src/meta/holder.ts`, `src/meta/process-table.ts`)**
   - Seat roots carry a sibling `.owner` symlink whose target encodes `<pid> <host> <start>` (atomic write; UTC `ps` with ambient-TZ recognition for pre-UTC locks). `reclaimDead` atomically moves dead claimants' `.owner`, root, and `.host` to private sibling paths before asynchronous deletion so concurrent callers cannot delete a live winner's root.
   - `endHolders` is Darwin's equivalent of PID-namespace teardown: it queries `libproc` (`processTable`) and sends `SIGKILL` to every process whose cwd or executable is inside the canonical root, plus group members and descendants, looping until two consecutive listings find no holders (closing the fork race) or 1 second elapses.
