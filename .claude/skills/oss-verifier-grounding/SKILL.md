---
name: oss-verifier-grounding
description: "Select, install, and name the authoritative compiler, simulator, solver, or other external verifier for an Anabasis harness. Use when deciding which practitioner tool to trust, writing the truth check that runs it, or diagnosing verifierUnavailable, timeout, crash or sandbox results. Also owns the install probe, the executable board for what the Builder can install and run behind the real cells and wall. Use harness-contract (discrimination proof) for semantic accept/reject coverage."
---

# External verifier grounding

Find the verifier used by practitioners before writing a local substitute.

This skill owns tool choice, installation, and host execution. It does not decide artifact truth
semantics or prove that the resulting checks discriminate.

## Procedure

1. Name the decision and the tool normally used to make it.
2. Prefer the authoritative implementation or format checker.
3. Test the exact version, entry point, input, exit behaviour, and licence.
4. Keep the check small: write the artifact's own bytes into the cell, run the tool, read its exit code and output. Do not recreate the verifier's reasoning.
5. Run through `runtime.tools.run` with bounded time, output, environment, and filesystem.
6. Bind each call to its case and its `checkId`; the host records the tool identity itself.
7. Install the tool under `.toolchain` so the pin travels with the candidate.

The Builder installs the tool and names it. The host decides which file that name resolves to, and hashes it. A name is not yet a resolved tool.

## One process owner

Verifier processes run only through `src/verify/host.ts`. The runner keeps the host handle. CorrectnessModel bundles receive only the host-provided evaluate-scoped port as `runtime.tools`; they never receive the host handle or import `child_process`.

- Verifiers get an empty environment plus an explicit allowlist.
- Build and eval children inherit a scrubbed environment plus named grants.

## Tool authority

The host resolves every tool ID itself. A check declares its required tool IDs;
`resolveToolInventory` looks them up under the candidate's `.toolchain` tree first and the host
PATH second, hashes each executable and rechecks those bytes before execution. Preserve the
selected command path: two names with identical executable bytes may dispatch differently.
Generated code names `toolId` and `checkId` and supplies bounded arguments. An interpreter running
the Builder's own algorithm remains authored computation, even when the interpreter is installed.

An id outside the resolved inventory is an authoring defect that throws. A tool whose bytes moved
since the candidate snapshot is a `sandbox` non-result, not a verdict. There is no declared engine
registry and no `correctness-model/engines.json`: what a Builder writes cannot attest what runs.

## The cell

Each check gets one private tool directory. `files` and `stdin` must match string leaves or JSON
from that check's declared artifact and public-input projections. A check cannot compile the
submission against a header its author supplied outside those inputs. A tool may read what
an earlier run of the same scope wrote, named
`cell:<path>` — that is how a compiled program is then executed.

| Condition | Outcome |
|---|---|
| ran to exit, any exit code | `executed` — a compiler that rejects the artifact has answered |
| id not installed | `verifierUnavailable` |
| timeout with process-group kill | `timeout` |
| spawn failure | `crash` |
| required isolation missing, or tool bytes moved | `sandbox` |

Read the exit code and output for the answer. A non-result is not an answer; never silently reduce isolation.

Only the host records executed `(checkId, toolId)` bindings. A correctnessModel that starts its own process does not close the external-grounding claim clause.

Naming a tool is not grounding. Three failure patterns dominated the 2026-08-19
campaign census (37,290 `generated-external-grounding-unexecuted` and 25,156
`EXTERNAL_RESULT_UNBOUND` rows; one w26 session repeated the identical 300 rows for six rounds).
In those records, a declared external check with no tool run on an applicable case is
`generated-external-grounding-unexecuted`. A verdict that contradicts the run it received (an
ignored non-zero exit), a run still in flight when evaluate returns, and a `runtimeNonResult` the
host never created are all `EXTERNAL_RESULT_UNBOUND`. These are historical finding names; read the
current host checks for today's refusal codes. Use the run's own result for the check it supports
and await every run before returning.

## Choose a tool by

- authority in the field;
- material semantic coverage;
- repeatability with pinned input and environment;
- a thin complete check;
- isolation with an empty environment and bounded files;
- identifiable version, binary, configuration, and call;
- usable licence.

Reject a syntax-only library when semantic correctness matters. Install the tool under `.toolchain` so the version travels with the candidate.

## Prove

- Compare the check's verdict with the native tool on valid, wrong-but-valid, malformed, and equivalent-valid cases.
- Prove solve code cannot read reference input or raw verifier output.
- State when this is still construction work instead of live integration.

To settle whether the Builder can install a toolchain, and whether the host can then run it, use
the install probe instead of reading the wall rules; see
[references/install-probe.md](references/install-probe.md), `scripts/install-probe/run-checks.sh`
for the two cells and `scripts/install-probe/run-tool.mts` for one tool through the host. It
measures capability on the checkout it runs in, not whether a live Builder chooses that capability,
which belongs to `system-path-simulation`.

Do not replace an authoritative simulator or solver with a regex and call it grounded. Install the
real tool first: the authoring cell has network access and its HOME is `<workspace>/.toolchain/home`
with `.local/bin` and `.cargo/bin` on PATH (`src/builder/bash-install-env.ts`), so `pip`, `uv`,
`cargo` and `bun install` land where the candidate can use them. A refused install or host path is
an environment non-result to report, not permission to write a stand-in: esp32-w34's Builder met a
refused `xcode-select` read, wrote a regex compile simulator over 7 iterations, and that simulator
then failed every case in two batteries. Do not turn a non-result into `ok: false`, expose raw hidden explanations, claim mocks as live use, or leave solver options unpinned.

Return the tool, rejected alternatives, where it is installed, the check that runs it, isolation policy, control results, and any gap between the tested check and the live path.
