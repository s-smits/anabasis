# Seed a temporary project: the whole runtime

Use this case when the question needs the controller, wall, verifier and durable record together,
or the operator requests a full project simulation. If admission alone decides the question, use
the smaller production Builder campaign in [authoring-comparison](authoring-comparison.md).
A session segment has no full-run selector, measurement or promotion authority.

## Select and freeze the position

Use the recorded opening to identify source, request, context, all executed slot pins and run flags.
Read source at that revision to find the real launch/resume path. State the experimental delta in
one line: replay the measured source, or test a named change with the recorded candidate as its
input. A seed from an older revision is valid input to a newer system when explicitly intended;
running the older system does not exercise the newer fix.

Choose the latest recorded boundary whose output the question does not depend on. A committed
submission or iteration can be recovered later; an uncommitted mid-turn state cannot be recreated
from the commit alone. If a live copy is necessary, verify a stable before/after manifest and label
the captured dirty state. Do not commit the actor's unfinished work merely to tidy the seed.

Keep the original one-liner, task count, public constraints, tests and relevant memory. Record
which history the actor will receive. A fresh project exercises starter construction; an existing
candidate exercises repair or resume. They answer different questions. Let the current controller
select the next move; historical selector labels are not instructions for the current source.

## Prepare one isolated copy

Use the repository worktree helper for the exact source and its dependencies, then
`scripts/seed-campaign.mts --into-root` for the campaign and domain bytes: it removes the copied
controller lock, verifies the selected product through the production reader, lists every symlink
that escapes the copy and every file that still names the source root, and writes `seed.json`.
Copy nothing else by hand.
Do not copy `.env`, `.harness` configuration or credentials from another checkout to make it start.
Resolve run configuration through its owning workflow and report any missing input.

Give each condition its own workspace Git repository, runtime links and writable toolchain. An APFS
copy-on-write clone can avoid duplicating gigabytes, but does not prove isolation. Inspect symlinks,
hardlinks and absolute paths in source and tool configuration; preserve relative links and record
required physical relocations with before/after hashes. Never allow a probe to write through a copy
into the original run. `initWorkspace` or the current production setup owner repoints package scopes;
handwritten links are not equivalent dependency proof.

Verify copied source files, executable identities, tests and task count. If relocations intentionally
change a path, compare the unaffected bytes separately rather than claiming whole-tree equality.
For real-tool questions, exercise a valid and nearest hostile case after the final relocation.

Copied locks and journals refer to the source run, not automatically to the new condition. Use the
current resume/recovery contract on the owned copy; never signal a persisted source PID or remove
the live run's lock. If the intended state cannot be expressed safely through that contract, report
the setup limit instead of rewriting evidence to force startup. Retain the original run's lock
identity and source manifest and check them again after the simulation.

## Launch the actual condition

Derive pins from recorded openings or admitted launch metadata. Inspect only the needed model and
effort values; dumping a whole live process environment can expose credentials. Set every used slot
explicitly through the normal launcher and validate its opening before measurement spend. In the
23 August replay, inherited model pins created a new epoch and discarded the seeded position. The
expected epoch/supersession relationship must follow the experiment's design, not an assumed label.

Use the same one-line request and production flags, changing only the predeclared variable. Retain
the battery's task count: shrinking 25 tasks to 8 once created contradictory authoring requirements
and measured that contradiction for dozens of submissions. Bound iterations or the authorised stage
instead. A model-turn cap is not a wall-time cap; record both when both are part of the condition.

The real launcher constructs the prompts, stage handovers, walls and evidence. Do not add a custom
repair nudge or install a hand-authored domain bundle. Keep source fixed while its condition runs;
write discovered shared-source fixes in another tree and identify any later replay separately.

## Close against bytes and processes

Read the actual candidate/admission, measurement and terminal records, including intermediate rows
that explain the final route. Keep verified, unaccepted and non-result denominators separate. If
the question concerns correctness, add independent valid/equivalent/hostile host probes as described
in [authoring-comparison](authoring-comparison.md); admission and generated controls alone do not
prove domain semantics. Hash the final candidate and relevant toolchain before and after postflight.

Confirm the launcher, backend, verifier and probe descendants have closed, or retain exact unresolved
process identities, cells and receipts. A signal request is not absence proof. Kernel-stuck children
can outlive their launcher; their existence limits process closure without erasing completed cases.
Verify the source run's original lock and bytes remained unchanged.

Report exact source and pins, seed boundary, relocations, actual stages, denominators, independent
probe results, prediction resolutions and closure. A seeded project proves only the path and condition
it executed. A full suite on a later fix is deterministic proof, not live model-outcome proof.
