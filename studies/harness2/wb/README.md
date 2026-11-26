# WorkBuddy-Bench study overlay

`run.ts setup` stages two additions into the WorkBuddy-Bench checkout, matching Harness²'s overlay layout (`overlays`, `harness2/install.py`): `configs/harnesses/anabasis-pi/` beside the benchmark's harness configs, and `studies/shared/harbor/pi_agent.py` inside `src/workbuddy_bench/agents/`.

The benchmark tree itself changes in one place (`anabasis-pi-adapter.diff`, applied after Harness²'s `third_party/patches/workbuddy-bench-runtime.diff`): it registers one entry in `HARNESS_ADAPTERS` so `scripts/run.sh` accepts the harness name without touching any other harness. Every arm reaches its model through the same job-private proxy (`model_connection: local_proxy`), which keeps provider credentials on the host and applies the model config parameters to each request.
