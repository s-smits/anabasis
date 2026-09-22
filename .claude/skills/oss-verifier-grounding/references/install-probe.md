# Install probe

Use these checks for "can the Builder install or use this toolchain?", and before or after an
isolation change. `oss-verifier-grounding` chooses the tool; `system-path-simulation` tests whether
a live Builder chooses the proved capability.

A wall argument is settled by running an installer behind it, not by reading the
rules. This probe drives six ecosystems through the two real Builder cells and
reports one line per half. A companion script, `run-tool.mts`, answers the
separate question of whether the verifier host can run an installed tool.

```sh
PATH=/absolute/path/to/bun-bin:/usr/bin:/bin \
  .claude/skills/oss-verifier-grounding/scripts/install-probe/run-checks.sh /abs/work-dir [check...]
```

Sessions default to all six: `python-wheel python-sdist bun cargo binary-tarball
git-make`. Name one or more to run a subset. A full board takes about fifteen
minutes, most of it real downloads.

**The work directory must be readable by both cells**, and which directories
those are is a property of the tree under test. On a tree whose cells read
broadly, `/private/tmp/<name>` is fine. On a tree whose workshop cell denies the
temp roots and whose authoring cell denies `/Users`, no shared staging tree
exists at all, every session reports `Operation not permitted` from `/bin/sh`, and
that is the finding — not six broken sessions. Read the emitted `author.sb` and
`workshop.sb` before arguing with a board: they are right there in the work
directory.

## Why it measures something

The profiles come from `deriveCandidateIsolation` and `candidateIsolationProfile`
in `src/`, emitted by `scripts/install-probe/emit-profiles.mts` over a throwaway fixture repo.
A copy kept inside the skill would drift and then report a wall nobody ships.

Each session has two halves, behind two different walls on purpose:

- **install** runs in the authoring cell, which has the network;
- **verify** runs in the workshop cell, which does not.

A session passes only when the verify half **computes something real offline**. An
import is not enough — a package can import and still fail the moment it is
asked to do arithmetic, which is how two numpy-2 incompatibilities surfaced on
2026-08-19. So `python-wheel` takes a determinant, integrates `sin(x)^2` and
measures a polygon; `bun` installs and compares semver ranges; `cargo` builds `hexyl` and
hexdumps a file; `git-make` compiles cJSON with `cc`.

The run ends with a **network-denial check**: the workshop cell tries to reach pypi.org and must
fail. The script reports any failed request as a refusal, so also establish unconfined network
access before attributing that result to isolation. A successful workshop request shows a broken
wall even when every installation check passed.

## The third question: can the host run the installed tool?

The two cells answer "can it be installed" and "can it compute". Neither answers
"can the product be given it", and that used to be a whole stack: a parser that
rebuilt a submitted engine spec, an admission that pinned the command, and the
verifier's deny-default wall.

On 2026-08-20 the board was green on both halves while two defects sat under it.
The parser kept six fields of a submitted spec and dropped the two a real
toolchain needs — the environment name it reads and the directory its platform
files live in — so a Builder could install anything and declare nothing. Behind
that, the wall compared every declared directory before and after each run
and refused any difference, so even a carried declaration could not survive a
toolchain that touches its own index. The visible symptom was three prompt
versions and two backends reporting that the Builder "will not install a real
tool"; the cause was that it could not.

Since 2026-09-03 there is no declaration to drop. A truth check names a tool by
id, the host resolves it under `.toolchain` or the host path, hashes it, and runs
it. What is left of the third question is one script:

```sh
bun .claude/skills/oss-verifier-grounding/scripts/install-probe/run-tool.mts \
  '{"toolId":"cc","args":["--version"],"toolTree":"/abs/candidate/.toolchain"}'
```

It reports resolution (`resolved`, `toolSource`, `toolDigest`) and the wall's own
outcome (`executed`, `outcome`, `nonResultReason`), plus the same command run
unconfined so a host gap can be distinguished from an isolation refusal. The unconfined comparison
uses the same executable and arguments but does not forward stdin, so it is not an equivalent
input check for commands that require stdin. `test/install-probe.test.ts` exercises both paths.

## Reading the result

`OK` on a session means installed behind one wall and computed behind the other.

`INSTALL-FAIL` and `VERIFY-FAIL` carry the last lines of the failing half.
`UNAVAILABLE` means the host lacks the toolchain — that is a host gap, not a
wall finding, and the cargo session says so explicitly rather than reporting a
rustup shim with no default toolchain as an install failure.

## Three host facts the sessions carry, not wall facts

Each was mistaken for a wall failure once and is now set explicitly, with the
measurement in a comment beside it:

- `SDKROOT` — without it this host's clang cannot find `assert.h`, identically
  unconfined. Naming the SDK is what any Builder compiling from source must do.
- `RUSTUP_HOME` and `PYTHONUSERBASE` — `hostToolchainEnv()` in
  `src/verify/wall-policy.ts` hands the real cells these, pointing at the
  operator's toolchain state. The sessions set `HOME` per cell, so without them
  rustup reads an empty `~/.rustup` and reports "no default is configured" on a
  host that has one.

Before blaming a wall for any session failure, run the same command unconfined. On
2026-08-19 that step is what separated a real regression (`import sympy` broken
by a `/domains/` deny) from two fixture gaps.

## What it does not cover

Whether a Builder *chooses* to install a toolchain. That is a live-runtime
question and belongs to `system-path-simulation`, which runs the production
Builder session over a one-liner. This skill measures capability, not behaviour.

The order between them is not free. Run this probe first: a behaviour condition
launched over an unproven capability reports a propensity finding that is false,
which is exactly what happened over the two defects above. `system-path-simulation`
states the same rule from its side — a propensity finding is not reportable
until the layer walk under it is clear, and this probe is that walk, executed.

## Which tree it measures

The probe always measures the checkout it runs in, because it emits the profiles
from that tree's `src/` and calls that tree's admission and host. Run it inside
the worktree whose wall you mean to judge, and say which revision a reported
board came from — a session board with no revision beside it is not evidence of
anything.

Trees disagree here, and the probe is meant to show it. The full board at
`0639973e1` on 2026-08-20: `python-wheel`, `python-sdist`, the then-current
JavaScript-package session, `binary-tarball` and `git-make` all `OK` on both
halves, `cargo` `UNAVAILABLE` (no toolchain on the host), and the network control
refused. The same board at `142530b46` reaches no half: the cells there share no
readable staging tree. Before calling a board a regression, run it on the tree
you are comparing against.
