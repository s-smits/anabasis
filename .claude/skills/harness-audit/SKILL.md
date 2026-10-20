---
name: harness-audit
description: "The harnesses a campaign keeps, read outside a run: which there are and where each came from, what each is made of and what moved from its parent, what each was measured to be, trying one on a task, the audit before a promotion and the blind review at a handover, whether a part earns its place, and changing what makes a harness or what a seat is told about one. Use when the operator asks which harness is current, what a Builder changed, whether a harness is ready to promote or hand over, to run a kept harness on a task, or to change the harness contract. Reading one run is whole-run-investigation's, wording a claim attribution-and-proof's."
---

# Harness audit

A campaign keeps every harness a session froze under its digest, in `states/` beside its log
(`tools/d2/campaign.ts`). The log says how each came to be there and what measured it:
`harness.version` (the session, its parent and its note), `harness.imported`, `harness.promoted`,
and each comparison's start and report. This skill reads the two together. Its script writes
nothing of the campaign's, starts no solve and calls no model; the commands it names that solve are
marked, and each needs the operator's word (`AGENTS.md`, section 10).

| The question | Read |
| --- | --- |
| Which harnesses, where each came from, what measured it | `harness-versions.ts` |
| What moved from a parent to its child | `harness-versions.ts --diff`, and lane 13 for what it means |
| How one runs on a task | [Trying a kept harness](#trying-a-kept-harness) |
| Ready to promote, or to hand over | [Before a promotion](#before-a-promotion) and [At a handover](#at-a-handover) |
| Which part of a harness did it | a checkpoint against `programs-of:<digest>`, worded by [attribution-and-proof](../attribution-and-proof/SKILL.md) |
| Whether a part earns its place | [From recorded use](#whether-a-part-earns-its-place) |
| A change to what makes a harness, or to what a seat is told | [The contract](#the-contract) |

## The versions

```sh
bun .claude/skills/harness-audit/scripts/harness-versions.ts --name <campaign> [--json]
bun .claude/skills/harness-audit/scripts/harness-versions.ts --log <log> [--json]
bun .claude/skills/harness-audit/scripts/harness-versions.ts --name <campaign> --diff <harness> [--against <harness>]
```

A harness is named as the campaign's commands name one (`keptAs`): `starter`, `promoted`, `latest`
or a whole digest, or its unambiguous letter from `namesOf`; `--log` reads a log copied out of its
campaign, with its `states/` beside it. The list gives each harness the log names or the folder
keeps, the starter first:

- **whether it opens as kept.** Every command that hands a harness to a solve opens it first and
  refuses one that opens as another digest: a state that lost its tool tree when its campaign was
  moved had two solves paid for under its name. The list says it of every state at once.
- **how it was made**: the session and the parent it froze from, with the length of its note; an
  import and where from; the starter as this checkout writes it; or no record. A harness with no
  record is a stored sweep's first parent, which stands in the sweep's root and is not kept here, a
  starter written by another checkout, since a change to the Starter's parts changes its digest,
  or a `programs-of` control, which no event records. Say which; do not rebuild a missing state.
- **its roles**, `starter`, `reference` and `latest`, each naming the starter until something else
  holds it.
- **its parts**: nonblank lines of the guide and of `agent/tools.ts`, the presets and the tools the
  spec declares, the files and size of `.toolchain` and whether it is a link, and other files.
  `agent/config.yaml` is ignored; a module may import other files under the harness.
- **what measured it**: each session that started from it, with its practice solves and counted
  fails, and each comparison it stood in, on which side, against what, and how it read, with its
  tally. The fold is `campaignOf` (`src/builder/handover.ts`), the one the view and the campaign
  command read.

`--diff` counts what moved, part by part, against the parent the log records or `--against`:
lines added and removed in the guide and the tools module, tools added and removed in the spec,
files added, removed and changed in the tool tree and under which folders, and other files by path.
It quotes no line, and neither does anything written from it (lane 13). It takes no control: the
command that compares one makes it.

## Trying a kept harness

- **One task, as handed over.** `bun tools/d2/close.ts --name <campaign> --to <folder outside the
  repository> --solve <task id>` writes the handover and solves that task under the harness from the
  folder it wrote, with the campaign's solver and checks, in a log of its own (`handover/log.jsonl`)
  that no reading counts. Name a released task. It is a solve: the operator's word.
- **Two harnesses on the same tasks.** `bun tools/d2/checkpoint.ts` with `--reference` and `--new`,
  through [run-management](../run-management/SKILL.md). `programs-of:<harness>` on either side separates the
  installed programs from the guide and the tools.
- **Another question needs its own campaign.** The `--solve` flag names an existing task id;
  it does not fit a new question into a recorded task.

## Before a promotion

The campaign promotes automatically unless `--hitl` is set (`AGENTS.md`, section 3). For a
manual promotion, put these in front of the operator.

1. **The rule.** `bun tools/d2/promote.ts --name <campaign> --harness <digest>`, without `--yes`,
   prints the comparisons the harness was the new side of and asks `unpromoted`: one comparison
   against the current reference read `step`. It records nothing. `--yes` records the promotion;
   `--despite "<why>"` with it records the operator's exception to the rule.
2. **The state.** The list: it opens as kept, its line back to the starter, each session's practice
   and each comparison's tally. Every comparison the promotion would rest on names this digest as
   its new side.
3. **What moved since the reference.** `--diff <digest> --against promoted` counts the whole change
   a promotion makes, which can span several sessions. Attributing a gain to one part requires a
   checkpoint against `programs-of:<digest>` (`AGENTS.md`, section 9).
4. **What it measured.** Lane 31 of [whole-run-investigation](../whole-run-investigation/SKILL.md)
   reads a promotion's rule, what its step measured and the climb after it; lanes 13 to 16 read
   the change, the guide's truth, check mirroring and the finish. Open them when a reading is in
   doubt, not as a ritual.

## At a handover

`bun tools/d2/close.ts --name <campaign> --to <folder>` writes `harness/`, the reference harness
opened there as kept, `RULES.md`, the domain's public contract, and `REPORT.md`, the closing report.
Without `--solve` it calls no model. Then arrange a blind review:

- Hand an independent reviewer `harness/` and `RULES.md` and nothing else: not `REPORT.md`, the
  log, a reading, the operator's diagnosis, an expected fix or an earlier review. A Codex reviewer
  is one read-only row through [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md), with the folder as
  its workdir.
- Ask neutrally: the structure; whether `tools-spec.json` has one row for each tool `tools.ts`
  returns, under the same name and in the same order; whether the guide's account of each program
  and tool matches what is there; stale or duplicate files; a launcher or a link that names a path
  outside the folder; anything that answers a particular task: a part that names a task, copies its
  text or holds its answer (`AGENTS.md`, section 2); obvious missing parts. A search that tests its
  candidates against the public rules and reports which meet them is allowed since 20 October
  (`src/builder/prompt.ts`).
- Record the digest and the folder beside the review. The review is advisory: it decides no
  promotion, reading or claim. A harness promoted after it is another handover and another review.

## Whether a part earns its place

A program, a tool or a guide line is read from what solves under it did: their `solve.call` rows,
which lane 14 counts. Count use over the solves where the need arose and the part was there; a
missing record is unknown, never zero. A successful call is not a valid answer, a failed answer
does not say which part failed it, and a shell command alone is no reason for a tool.

| Decision | The evidence for it |
| --- | --- |
| enrich a part | repeated work fits its purpose, and a richer result closes the gap |
| add one | a recurring job has no adequate owner, and a compact interface helps |
| consolidate | parts keep needing the same inputs, or force a hand-off that could be avoided |
| describe | the capability is there, but its purpose, inputs or limits are unclear |
| remove | it has no distinct purpose, and its work is done elsewhere |
| keep | it saves useful work, serves a rare real need, or the shell already does |

What a harness holds is the Builder's to choose (`AGENTS.md`, section 2, rule 3). The table reads
what a Builder did, and it grounds a change to the Starter or to the account a Builder is handed,
which waits for the operator's word ([run-improvement-campaign](../run-improvement-campaign/SKILL.md), Rules).

## The contract

| What | Owner | What holds it |
| --- | --- | --- |
| what opens as a harness, and its digest | `src/solve/harness.ts`, `openHarness` | `test/harness-tools.test.ts` |
| the Starter, and the generated `HARNESS.md` a Builder is handed | `writeStarter`, `HARNESS_ACCOUNT` in `src/solve/starter.ts`; written by `src/builder/session.ts` | `test/starter.test.ts`: the worked harness opens as printed |
| installed program names and their accounts | `installedPrograms`, `programsOf` in `src/solve/programs.ts` | `test/programs.test.ts` |
| what a Builder is told | `src/builder/prompt.ts` | `test/builder.test.ts`, "what crosses to the Builder" |
| what a solver is told | `src/solve/prompt.ts` | `test/solver-prompt.test.ts` |
| what the Examiner and the Referee are told | `src/examiner/prompt.ts`, `src/review/referee.ts` | `test/examiner.test.ts`, `test/review.test.ts` |

`HARNESS.md` is generated in the Builder's home, not a repository file. Its four parts are
`agent/tools-spec.json`, `.toolchain/`, `agent/BUILT_AGENTS.md` and `agent/tools.ts`. Read their
purposes in `AGENTS.md`, section 3, and their shapes in `HARNESS_ACCOUNT` before changing them.
`installedPrograms` lists executable names in the command's search directories, taking the first
of each name. `programsOf` adds accounts from file heads without running the programs.

For a change to this contract, follow `AGENTS.md` sections 2 and 8 for authority and the wall,
section 12 for checks, and section 9 for what those checks prove. Read the parser, tool, wall or
limit that carries an instruction before changing its wording.
