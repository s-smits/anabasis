Read this for what a launch authorises and how a harness is made. It expands `AGENTS.md` section 3.

## 3. The seats

### What waits for the operator

The seven decisions stay with the operator because someone outside the loop must fix the exam, pay
for it and own what cannot be undone; the operator writes none of the exam. A launch gives three of
them for its campaign, so that it can run unattended to a typed ending: freeze a fault-free exam
(`accept.ts --freeze`), admit every check computed by its author (`--admit-authored`), and promote
the harness the rule names. The owners are `make` in `tools/d2/harness-builder.ts` and `planOf` in
`src/campaign/opening.ts`. `--hitl` hands all three back until `--no-hitl`; any other fault, and
going past the stop rule, take the operator's word each time (`--despite`, `--past-stop`).

### The harness

The four parts are listed in section 3; `HARNESS.md`, given to a Builder, shows each with a worked
example. Programs in `.toolchain/` run by name from the solver's shell, while tools in
`agent/tools.ts` sit beside pi's, each call alone under the wall; the Builder chooses between them,
told what each costs a solve. The digest leaves out `__pycache__` and bytecode
(`src/meta/bundle-layout.ts`), so any other change makes a new harness, and solves under the old one
do not count for it. The starter (`src/harness/starter.ts`) is pi's coding agent as released with a
few revisable guide lines and no domain program.

A larger solve budget narrows the gap a better harness can show, since the solver inside the starter
works out more of the programs itself (section 7, "The budget").
