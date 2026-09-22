## Guidelines for this bundle (verbose)

**Choose verbose when** the question is about what the models saw or what the host did at
process level: prompt content and digests, the Builder's authoring tree, every verifier spawn,
and the full session transcripts where the backend kept them. It is the bundle for a prompt or
isolation audit, a reproduction, or an archive. Expect tens of MB and tens of thousands of
files; a bundle of 20 MB or more is verbose by definition.

**Read in this order.** Start with the medium order, then:

1. `observability/<runId>.jsonl`: `hb4-observation/v2` rows. `kind: "generation"` rows carry
   every start prompt the Builder, Built Harness and Judge received in full, with
   `promptDigest`, `contract` and `role`; `span` rows mark phase transitions; `event` rows
   record steering and iteration settlement. Filter by `role` first (`builder`, `built-solver`,
   `battery-case`, `accept-control`, `reject-control`, `bait-control`).
2. `transcripts/`: complete session transcripts with full tool outputs. `claude/<epoch>/` holds
   Claude Code transcripts for Claude-backed Builders; `codex-sessions/` holds Codex rollouts
   only when the frozen `CODEX_HOME` retained them. If the directory is absent, the run recorded
   prompts, reasoning and tool-call previews but not full tool outputs; do not look for them
   elsewhere.
3. `epochs/<epoch>/workspace/`: the Builder's authoring tree at the end of that epoch, with
   `STARTER.md`, generated scripts and the last state of `agent/` and `correctness-model/`.
   Accepted bytes live under `versions/`; the workspace shows what was tried. Binaries under
   `.toolchain/`, `.oss/downloads/`, `.oss/build/` and the `.bundle-snapshots/` copies are
   excluded and named in `MANIFEST.json`.
4. `controller/verifier-lifetime/<process>/`: `intent.json`, `spawned.json` and
   `settlement.json` per verifier process. Join them to a case through the recorded tool run
   ids in `verifier.json`. A settlement without a spawn, or a spawn without a settlement, is a
   process-cleanup fact, not a case outcome.
5. `cases/<case>/built-runtime.json`, `built-registration.json`, `draft-checkpoints.json`:
   the Built Harness runtime identity, its tool registration and every draft it saved.
6. `controller.sqlite`: the controller ledger. Read it with a SQLite client; the JSON files
   beside it are the recorded projection.

**What this bundle cannot answer.** Anything the host never wrote: full tool outputs for a
Codex-backed run whose rollouts were not retained, the contents of excluded binaries, and any
provider-side state. Missing evidence is `unobservable`, not absent behaviour.

**Do not conclude from this bundle** that a prompt change moved a result without matching
`promptDigest` values across the compared conditions, and do not treat the workspace as the
measured product: `versions/<version>/version.json` names the bytes that were measured.
