---
name: intelligent-rebase
description: "Check semantic interference when concurrent changes or stacked PRs meet. Use after a merge or rebase, at a stack checkpoint, or when comparing changed source with a live run. Measure overlap and exercise the affected combined path; stack-hop owns publication and failed-checkpoint isolation."
---

# Intelligent rebase

A clean rebase says only that the same lines did not conflict. It does not prove the composed system
still agrees about prompts, tools, traces, evidence, thresholds, or identities. Check one composed
pass:

```text
input assembly → model/tool calls → recorded output → scoring → decision
```

Two cases need this check:

- Two agents changed source: look for semantic interference.
- A change is being compared with a live run: read the opening's frozen source. A newer head in
  another worktree leaves that run's evidence intact and supplies no proof of the new change.
  Never rebase the live tree. If its executed bytes actually drifted, report the recorded refusal
  and affected scope; preserve already-recorded case denominators rather than calling the run lost.

## 1. Measure contact

Use the coupling script for the changed sides. Reuse an earlier result only for the same immutable
sides and script version. A metadata-only change needs ancestry/PR checks, not another simulation.
Run repository commands through `scripts/worktree.sh run <prepared-dir>`; the commands below
show the arguments after that wrapper.

```sh
# what is in flight right now, across every worktree git knows about
bun .claude/skills/intelligent-rebase/scripts/coupling.mts --worktrees --base <base>

# one pair: use this for an actual rebase decision
bun .claude/skills/intelligent-rebase/scripts/coupling.mts --a <base>...<A> --b <base>...<B>

# every pair in a range or chosen set: use this for a busy history
bun .claude/skills/intelligent-rebase/scripts/coupling.mts --review <base>..<head>
bun .claude/skills/intelligent-rebase/scripts/coupling.mts --commits <sha>,<sha>,<sha>
```

Start with `--worktrees` when the other work is unknown. It reports branch, head, ahead/behind, and
dirty files, including dirty source files. Use `--scan` only for separate clones that Git does not
know: it checks `~/.codex/worktrees`, `~/.cursor/worktrees`, `~/.claude/worktrees`,
`<repo>/.claude/worktrees`, or `--scan-dir a,b`. A clone matches by origin URL or shared root
commit. A clone outside the object store must be fetched before comparison.

| Severity | Meaning | Required response |
|---|---|---|
| 6 | one side removed a name the other still uses | repair before composing |
| 5 | same file and exported symbol changed | full simulation |
| 4 | same file, different exports | simulate shared invariants |
| 3 | one side imports an export the other changed | simulate that edge |
| 2 | one side imports the other's namespace | simulate that edge |
| 1 | same file, no export crosses | usually step 4 only |
| 0 | file contact through a hub | weak signal |

Severity 6 is a break rather than a contact: nothing conflicts, so the composition merges clean and
fails later. `--a`/`--b` also print the literals both sides changed — env variable names, record
field keys, policy keys, fixture paths — which is contact no import carries. Both come from text and
both over-report; each row is a lead to confirm in source.

A hub is at or above the run's 90th fan-out percentile. Its edges sort below narrow module edges.
`--review` and `--commits` compare all pairs, not only neighbours. Read grouped contended symbols and
entangled commits before pair rows. No contact still needs the relevant shared-invariant check.
Zero changed exports is a weak signal: internal behaviour can change behind an unchanged export.

## 2. Name owner and stage

For both sides record owner, stage, files, and every downstream-read value changed: record field,
prompt text, schema, threshold, or identity literal. Use the four-owner map: Harness Builder, Built
Harness, measurement controller, review stage.

## 3. Simulate the composed pass

At each stage ask: what does it read, did either side change it, and does the other side still mean
the same thing?

| Stage | Check |
|---|---|
| input assembly | model-visible text and prompt digest |
| context and retrieval | selection, truncation, ordering |
| tool interface | schema, name, availability, prompt description |
| model and config identity | recorded fields that shape results |
| state and handoff schema | field existence and meaning |
| output capture | trace and evidence shape beneath consumers |
| scoring and verification | denominator, exclusions, null handling |
| aggregation | proxy reads still have a producer |
| decision gate | every clause has its recorded input |
| versioning | model-visible change has an identity/version bump |

The usual issue is an edge: one side writes a value the other side reads.

## 4. Check shared invariants

- Prompt digest stability: protected verifier detail must not change model-visible prompt digests.
- Identity bump: prompt, tool schema, or rendering changes update the identity literal.
- Bijection: executable registries and their source owners still match the tree.
- Threshold monotonicity: merged changes do not relax and tighten the same rule inconsistently.
- Denominator and attribution: do not attribute a measurement that mixes task, correctnessModel, policy, or
  denominator changes.
- Ownership: every changed decision still has one source owner.

## 5. Adjudicate and verify

Verify every finding in source or records before patching. Keep this synthesis:

```yaml
rebase_synthesis:
  sides: [<A>, <B>]
  shared_owners:
  interference:            # stage, changed value, invariant
  no_interference:         # checked and clear
  verification:            # full gate and targeted case
  unproven:
```

Exercise the smallest real combined path that could expose the contact; add only its missing
regression. The normal source push supplies one composed gate under `AGENTS.md`. Route a proved
interference to its owning PR and continue authorised work; ask only when the remaining decision
needs unavailable intent or would change a frozen run. Preserve unrelated work and stage named files.

For stack delivery, follow `stack-hop` and its
[publication procedure](../stack-hop/references/stack-publication.md). Keep owner corrections in
their PRs and compose the affected suffix once. The default checkpoint is up to five new owner
changes, with one full gate from the normal multi-ref push at the clean top. Unchanged descendants
do not each need a full gate. A failing checkpoint uses suspect-guided checks and saved-head
bisection there; neither a predicted culprit nor a green descendant proves an intermediate PR.
Retarget/reorder safety belongs to that same procedure. Root adoption remains separate from
publication, and live run trees retain their source and runtime.

## Scope of the script

The graph covers `src`, `tools`, `test`, `vendor`, `packages`, `starters` and `.claude/skills`, over
`.ts`, `.mts`, `.cts`, `.tsx` and their JavaScript spellings; `--root a,b` narrows it. A specifier
resolves relatively, through the root manifest's workspaces (so `@ana/agent-bundle` reaches
`vendor/agent-bundle/index.ts`), and from a `.js` or `.mjs` spelling to the `.ts` or `.mts` file
beside it. It still misses an alias the tsconfig defines, a bare module name, a re-export chain, a
computed specifier, uncommitted sides, N-way interactions and merge commits in a review. Dirty
worktrees appear in `--worktrees` but cannot be diff sides. Three agents need three pairwise runs;
pairwise clean results do not prove the three-way merge.

The rename gap is the one that has bitten. When one branch renames an identifier and the other adds
code using the old name, every three-way merge is clean and the break appears only in typecheck or
tests (2026-08-17, PR #267: `repairOwner: "oracle"` and a `grader/oracle.ts#solve` fixture path, one
push cycle each). `dangling-refs.mts` answers it. For every export one side dropped it finds the
files on the other side that still write the name, and ranks the row by the evidence behind it: 6
when that file imports the name from that exact file or reaches it through a `* as` alias of it, 3
when the remover re-added the name elsewhere and the other side only names it, 2 for a text-only
mention. Within a band, a use the other side introduced outranks one it carried. A local variable of
the same name therefore lands at 2, not at 6.

`--review` and `--commits` run the same scan in the one direction a range has: a later commit that
still imports a name an earlier one removed. On a linear branch that is a commit `git bisect` cannot
build; on a cherry-picked set it is the rename gap again. Only the import-backed band is printed
there, and the extra endpoint reads are skipped entirely when no commit in the range removed an
export. A name reached through a re-export chain or a computed key is still missed in both modes, so
after a rebase across a rename the manual check remains worth its minute:

```sh
git show <lower-commit> --name-only --format=""
rg -n '<old-name>' <changed-paths>
```

`literal-contact.mts` asks the other question the graph cannot: which literals both sides changed.
It reads text, so it covers JSON, YAML, Markdown and Python beside source. A token counts only when
it is shaped like an identity — a separator, an internal capital, or all caps — is not a module
specifier, is carried by at most eight files in total, and is not confined to a file both sides
changed. Narrowest contact prints first: one file on each side is a coupling, twenty files is the
repository's vocabulary. Measured on `origin/main` against `b7d9be2a9`, the unfiltered intersection
returned 240 rows and these rules leave 6.

Each side is one endpoint diff, not a commit-by-commit replay. `--a` and `--b` decide a live rebase;
`--review` is history analysis. The method assumes concurrent authors. On sequential commits it
over-reports because the later author may already have resolved the contact.
