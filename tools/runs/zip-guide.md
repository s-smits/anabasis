## How to read this bundle

A campaign run is defined by `log.jsonl` (chronological `{at, kind, data}` events). Missing terminal events indicate an active run or a run type without endings (the last line may be truncated). Treat `NOTES.md` as informal and verify claims against `log.jsonl`.

**Bundle levels**:
- `Light`: behaviour and statistical readings (best for context-bounded review).
- `Medium`: adds check source (`checks/`) and installed harness artefacts to diagnose rejections.
- `Verbose`: adds repo source at each worktree commit (prompts render dynamically in `src/builder/prompt.ts` and `src/solver/prompt.ts`).

**Reading order**:
1. `MANIFEST.json` (`runs`): worktree, commit SHA, terminal ending (different commits differ in code first).
2. `task.proposed`, `task.gate`, `task.state`, `task.feasible`: task versions, feasibility and optional objective metadata. Legacy logs use numeric gates (`1` structure, `2` stronger solve/`too-hard`, `3` replay, `4` negative controls, `5` screening → `admitted` held-out vs `released` practice).
3. `build.started`–`build.finished`: Builder session from `parent` harness (`build.turn`, `build.call`, ending, whether changed or `broken`).
4. `solve.started`–`solve.finished`: rollout outcome (`pass`, `fail` + kind, `non-result` + kind/reason) and `verdict` (answer + rejecting checks). Map `condition` to harness via `condition.recorded.condition.harness`.
5. `comparison.reported`: pre-registered test parameters and statistical reading.
6. `states/<digest>/agent/`: frozen harness (`BUILT_AGENTS.md`, `tools-spec.json`; older logs may contain unused `tools.ts`).
7. `memory/<session>/`: Builder private notes (`MEMORY.md`, legacy `SCRATCHPAD.md`/`scratch/`), not part of the harness.

**Limits & pitfalls**:
- Starting harnesses are omitted unless saved earlier in the run (infer edits from `build.call`). Below `medium`, check logic is absent; below `verbose`, prompts are absent.
- **`no-step` ≠ no improvement**: zero `scored` wins/losses/ties means no held-out tasks were scored (check `target` and `launch-<session>.json`).
- **Universal `no-answer`**: check `tools-spec.json` (older runs required `artifact-writer`; current runs read `answer.json`).
- **Non-results**: exclude from pass-rate denominators and capability claims.
- **Wall-clock durations**: check `solve.started.load` and `cores` before comparing timeouts across runs.
- **Wall safety**: `checks/` (`medium`+) contains verifier source—never show it to a Builder or solver. Runs containing `correctness-model/` in a harness had different Builder exposure.
