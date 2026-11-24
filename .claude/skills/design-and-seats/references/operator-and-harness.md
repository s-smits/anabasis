Read this reference to understand what a campaign launch authorises and how a harness is constructed.
It expands `AGENTS.md` section 3.

## 3. The seats

### What waits for the operator

Seven decisions remain with the operator because an external authority outside the optimisation loop
must fix the evaluation exam, authorise expenditure, and own irreversible actions; the operator
never authors the exam itself. Launching a campaign pre-authorises three of these decisions for that
campaign so it can run unattended to a typed ending: freezing a fault-free exam
(`accept.ts --freeze`), admitting checks computed by their author (`--admit-authored`), and
promoting the harness selected by the promotion rule. These grants are owned by `make` in
`tools/d2/harness-builder.ts` and `planOf` in `src/campaign/opening.ts`. Passing `--hitl` revokes
all three grants until `--no-hitl` is passed. Any other fault, as well as continuing past the stop
rule, requires explicit operator approval on each occasion (`--despite`, `--past-stop`).

### The harness

The three components of a harness are listed in `AGENTS.md` section 3, and `HARNESS.md` (provided to
the Builder) illustrates each with a worked example. Executables placed in `.toolchain/` are invoked
by name from the solver's shell, and a harness whose specification declares a custom tool fails to
open (`openHarness`). The harness digest excludes `__pycache__` and compiled bytecode
(`src/meta/bundle-layout.ts`); any other modification produces a distinct harness identity, so
solves recorded under a previous digest do not carry over. Three solver tiers exist: `bareSolver` is the raw `pi-durable` agent with its four coding tools and
no operating guide or programs (the target external benchmark baseline); `baseStarter` (Starter,
`src/harness/starter.ts`) adds the minimal revisable `BUILT_AGENTS.md` template (and, paired with
Builder-only `HARNESS.md`, forms the Starter Pack). Internally, campaigns compare against both and
every promoted `builtSolver` iteration must at least beat `baseStarter`; externally, transfer is
measured against `bareSolver`.

Increasing the per-solve compute budget narrows the measurable gap between a built harness and the
starter, because the solver under the starter has more turns to reconstruct domain tooling on its
own (section 7, "The budget").
