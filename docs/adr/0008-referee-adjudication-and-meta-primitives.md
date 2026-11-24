# ADR 0008: Referee agreement bars, answer submission, and runtime primitives

## Status

Accepted

## Context

Rejection adjudication, solver answer submission, and shared runtime utilities (`src/meta/`) each carry non-obvious invariants that protect evaluation accuracy, prevent cross-platform drift, and keep host-side tooling reliable.

## Decisions

1. **Referee agreement bars and pass-soundness denominator (`src/referee/agreement.ts`)**
   - A rejection is counted as voided by any Referee ruling other than `earned` (both `check-defect` and `unclear`), because `unclear` sets its task aside identically to `check-defect`. Counting `unclear` as voided prevents a Referee from gaming the voided-earned rate by ruling earned rejections `unclear`.
   - `clears` requires at least `LEAST_LABELS = 30` labelled failures and non-null `caught` and `voided` rates (a set with zero hand-labelled check defects cannot prove defect detection). `unclearReport` emits a non-gating advisory when more than 1/4 (`UNCLEAR_EARNED`) of `unclear` rulings are hand-labelled `earned`.
   - `passAgreement` computes the wrong-pass rate over decided passes (`sound + wrong`), requiring at least `LEAST_PASS_LABELS = 20` decided passes and at most 1/10 wrong so `unclear` passes neither inflate sample size nor dilute the wrong-pass rate.

2. **File-based answer submission and head-tail result spilling (`src/tools/answer.ts`, `src/tools/coding.ts`)**
   - Solvers write `answer.json` directly and invoke `submit`, which captures the file (up to 1 MiB) and deliverables through the host's own Python (`CAPTURER`, bypassing the harness `.toolchain` on `PATH` so one arm's interpreter cannot alter capture) inside a single walled command.
   - `submit` checks only JSON syntax and contract schema (`answerFormat`), revealing nothing hidden; refused submits are uncounted.
   - Seat tool outputs exceeding `RESULT` (~50 KiB / 2,000 lines) spill in full to a uniquely created `.log` file inside the seat's `TMPDIR` (unlinking before exclusive write so a seat-planted symlink cannot redirect host writes) and return a 3:1 head-and-tail excerpt so trailing error summaries remain visible without an extra `read` call.
   - Image reads share one lazy Photon worker across seats so BMP and oversized images are converted/resized identically to pi's coding agent.

3. **Deterministic encoding, prototype safety, and captured globals (`src/meta/`)**
   - `compareCodeUnits` (`src/meta/stable-json.ts`) sorts keys by UTF-16 code unit rather than locale collation so persisted digests match across hosts. `stableJson` omits `undefined` object fields (preserving digests when optional fields are added), whereas `canonicalJson` writes literal `undefined` so truth checks distinguish missing paths from `null`. `requireJsonValue` rejects non-JSON values (functions, symbols) explicitly rather than letting `JSON.stringify` drop them silently.
   - `lockJsonGlobals` (`src/meta/json-runtime.ts`) freezes the `JSON` object graph inside generated-code child processes before importing user/exam code; `capturedExecPath` (`src/meta/process.ts`) and bound `processKill` (`src/meta/subprocess.ts`) capture host globals at controller load.
   - `JSON_PATH_TOKEN` (`src/meta/json-evidence.ts`) accepts quoted bracket keys (`['main.cpp']`) and normalises them as whole tokens so file-map keys containing dots do not split path resolution.
   - `activeDeveloperBinDirs` (`src/meta/host-tool.ts`) resolves Apple developer tools directly on Darwin to bypass `/usr/bin/git` and `/usr/bin/otool` `xcrun` shims.
   - `sshOptions` (`src/meta/ssh.ts`) omits `ControlPath` when the socket path would exceed macOS's 104-byte Unix domain socket limit (accounting for ssh's 17-byte temporary suffix).
   - `pooled` (`src/meta/pool.ts`) runs a shared-iterator work-stealing pool rather than fixed waves so fast solves do not sit idle behind multi-hour stragglers, clamping invalid widths to at least 1 worker.
   - `killProcessGroupId` (`src/meta/subprocess.ts`) signals the process group first and falls back to the PID alone for wrapper children (such as Bubblewrap's init) that do not lead a group.
   - `interruptAndReapProcessGroup` sends `SIGTERM` to the leader first for `graceMs` so coordinators can shut down workers cleanly before group-wide `SIGKILL`.
