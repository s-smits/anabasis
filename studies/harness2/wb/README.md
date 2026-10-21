# What the study adds to WorkBuddy-Bench

`run.ts setup` copies these into the benchmark's checkout, as Harness²'s setup copies its own
runners (`overlays`, `harness2/install.py`): `configs/harnesses/anabasis-pi/` beside the benchmark's
harness configs, and `studies/shared/harbor/pi_agent.py` into `src/workbuddy_bench/agents/`.

It changes the benchmark in one place, as Harness²'s own patch does
(`third_party/patches/workbuddy-bench-runtime.diff`, applied first): `anabasis-pi-adapter.diff`
adds one entry to `HARNESS_ADAPTERS`, since `scripts/run.sh` refuses a `harness.name` it does not
know. The entry is additive and touches no other harness. Every arm then reaches its model
through the same job-private proxy (`model_connection: local_proxy`), which holds the provider's
key on the host and adds the model config's parameters to each request.
