
# Hand over one run as a ZIP

Formerly the `archive-run-artifacts` skill; `run-outcome-review` owns it.

Package the complete dedicated run worktree. Prefer a slightly broad archive over selecting a few
summary files: evidence pointers, candidate rounds, Builder workspace commits, and exact source may
all be needed later.

## Resolve the run

1. Find the run with `git worktree list --porcelain` and filename searches. Run worktrees are
   named `ana-run-<run>`; match on the campaign slug inside the tree rather
   than on the directory name.
2. Read the run log (its name is the launcher's free `--log` argument, not a fixed `run<N>.log`),
   `controller/<runId>/opening.json`, `controller/<runId>/terminal.json` and the generated run
   manifests. Confirm the
   project slug, source revision, all round IDs such as `50` and `50-i02`, and every battery run ID.
3. Treat a run with later rounds as one archive. Include the initial domain, campaign candidate,
   claims, analyses, controls, cases, traces, and nested Builder workspace.
4. Do not archive a changing live worktree as final evidence. Wait for a terminal record, or label
   an explicitly requested snapshot as non-terminal.

## Set the archive boundary

Include the whole dedicated run worktree so the ZIP carries:

- the exact tracked source and configuration used by the run;
- `domains/<slug>/` and `campaigns/<slug>/` in full;
- all initial and later iteration evidence, traces, claims, candidate bundle snapshots, and analyses;
- the run log, exit record, launcher, `.harness/backends/<slug>.json`, and the `.launchd/`
  directory holding `<label>.plist`, `<label>.plist.receipt.json` and any timeout receipt
  (`tools/fullrun-launchd.zsh` writes them into the worktree);
- nested campaign `workspace/.git/`, which binds Builder workspace commits.

Exclude only:

- dependency installations such as `node_modules/`;
- the outer worktree's exact top-level `.git` pointer;
- `.env` and `.env.*` files at every depth;
- credentials, private keys, or tokens found under another filename.

Never use a broad `*/.git/*` exclusion: it would remove the nested Builder workspace evidence.
Never add dependency installations merely to make the archive appear self-contained; the lockfile
and exact source are the reproducible inputs.

Before archiving, list environment-like and credential-like filenames without printing their
values. Inspect configuration keys rather than values where possible. If a recorded log itself
contains a credential, stop and report the conflict; do not edit the recorded evidence or distribute
the secret.

## Create the ZIP

Place the ZIP outside the run worktree so it cannot include itself. Resolve explicit absolute
source and destination paths, then check that the destination does not already exist. Do not let
`zip` update an older archive in place.

From the parent directory, archive the single run-worktree folder with `zip -r`. Add exact `-x`
patterns for every discovered dependency and environment path. A typical shape is:

```sh
test ! -e /absolute/output/run50-relevant-files.zip
zip -q -r /absolute/output/run50-relevant-files.zip harness-builder-v4-run50 \
  -x 'harness-builder-v4-run50/node_modules/*' \
     'harness-builder-v4-run50/.git' \
     'harness-builder-v4-run50/.env' \
     'harness-builder-v4-run50/.env.*'
```

Extend the exclusions for any nested dependency or environment paths found during inspection.
Keep the one containing folder so extraction does not scatter files into the destination.

## Verify before handoff

1. Run `unzip -tq <archive>` and require no errors.
2. List entries with `unzip -Z -1 <archive>`. Require zero `node_modules`, `.env*`, outer `.git`,
   credential, and private-key entries.
3. Confirm the launcher, log, exit record, backend pin, source tree, domain run manifests, campaign
   analyses, and every discovered round and battery run are present.
4. Confirm nested `workspace/.git/` entries remain present when the campaign has a Builder
   workspace.
5. Record archive size, entry count, and `shasum -a 256 <archive>`.
6. Return a clickable absolute path and state the exclusions plainly. Do not claim the ZIP is
   complete unless the integrity and entry checks passed.

For example, report that the archive contains both run `50` and climbed candidate `50-i02`, while
the credential-bearing `.env`, installed dependencies, and outer worktree pointer were excluded.
