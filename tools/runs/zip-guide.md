## How to read this bundle

`log.jsonl` is the single source of truth for a campaign run (chronological `{at, kind, data}` events). A missing terminal event indicates an active or forcibly stopped run (the final line may be truncated). Treat `NOTES.md` as informal commentary and verify every count against `log.jsonl`.

**Archive depths**:
- `Light`: behavioural traces and statistical readings, suited to context-bounded review.
- `Medium`: adds verifier check source (`checks/`) and installed harness artefacts for rejection diagnosis.
- `Verbose`: adds repository source at each worktree commit (seat prompts render dynamically in `src/builder/prompt.ts` and `src/solver/prompt.ts`).

**Recommended reading order**:
1. `MANIFEST.json` (`runs`): worktree, commit SHA, and terminal ending (separate code differences by commit first).
2. `task.proposed`, `task.gate`, `task.state`, `task.feasible`: task versions, feasibility records, and optional objective metadata. Older logs use numeric gates (`1` structure, `2` stronger solve/`too-hard`, `3` replay, `4` negative controls, `5` screening -> `admitted` held-out vs `released` practice).
3. `build.started` to `build.finished`: Builder sessions from `parent` harness (`build.turn`, `build.call`, ending, changed or `broken`).
4. `solve.started` to `solve.finished`: rollout outcomes (`pass`, `fail` + kind, `non-result` + kind/reason) and `verdict` (answer plus rejecting checks). Map `condition` to harness digest via `condition.recorded.condition.harness`.
5. `comparison.reported`: pre-registered comparison terms and statistical reading.
6. `states/<digest>/agent/`: frozen harness files (`BUILT_AGENTS.md`, `tools-spec.json`; older logs may contain unused `tools.ts`).
7. `memory/<session>/`: Builder private notes (`MEMORY.md`, legacy `SCRATCHPAD.md`/`scratch/`), kept outside the harness.

**Limits and pitfalls**:
- Starting harnesses are omitted unless saved earlier in the run (infer edits from `build.call`). Check logic is absent below `medium`; rendered prompts are absent below `verbose`.
- **`no-step` does not imply equivalence**: zero `scored` wins, losses, and ties means no held-out tasks were tallied (inspect `target` and `launch-<session>.json`).
- **Universal `no-answer`**: inspect `tools-spec.json` (older runs used `artifact-writer`; current runs read `answer.json`).
- **Non-results**: exclude from pass-rate denominators and capability claims.
- **Wall-clock durations**: check `solve.started.load` and `cores` before comparing timeouts across runs.
- **Wall boundary**: `checks/` (`medium` and above) holds verifier source and must never be shown to a Builder or solver. Runs whose harnesses contain `correctness-model/` operated under a different information boundary.
