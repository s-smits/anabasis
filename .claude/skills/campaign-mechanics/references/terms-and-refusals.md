Read this for a campaign's recorded terms, practice release, admission refusals and defaults. It
expands the second half of `AGENTS.md` section 6; the commands are in `campaign-command.md`.

## 6. A campaign's commands (continued)

### What the log records of a campaign's conditions

**The opening** (`campaign.opened`) keeps what a continuation by name needs: the project, total and
reserve, both patiences (`--patience`), the seats, and the move terms as last named (`TERMS`,
`src/campaign/opening.ts`): level, conversation minutes and turns, practice and the promotion cap. A later command inherits them unless a flag records a replacement; terms an older
opening kept that nothing reads are read past. The level is the exception: once a comparison has
begun it is pinned to the level that comparison began at, and a command naming another is refused
before it writes anything (rule 4).

**The project** (`--project`, required, fixed by the opening: `projectOf`) groups campaigns for the
operator's page and changes no decision or message.

**The setting** (`campaign.setting`, `tools/d2/setting.ts`) is the experimental condition, recorded
once by the first command that begins a solve-bearing move (`settingOf`) and never changed: the
solver and its effort, window and limits (`--solver`, `--solver-effort`, `--solver-window`,
`--solve-minutes`, `--solve-model-turns`), `--target` and `--solves`. A conflicting flag is refused,
since no solve on record counts for a different solver. A log with solves from before any setting is
held to its last test-side solves' setting (`firstRecord`). `--solver-window` (300,000 tokens) is
where the solver's backend compacts, so a model served with a 200K context is refused at it.

### Practice release

Practice keeps the Builder supplied with fresh failures, and each release is one task fewer to
score. It is owed after each reading or promotion (`practiceDue`, `src/campaign/decide.ts`) and
released by the host at the moments section 7 names (`releaseOwed`, `tools/d2/campaign-actions.ts`),
never while a comparison is unreported. A task the reference's own rejection left in doubt is never
released (`practicePool`, `poolOf`). The rest go in this order (`releaseOrder`,
`src/kernel/reports.ts`):

1. tasks the reference answered in no solve of two comparisons;
2. half, rounded down and counted with those already released, of the tasks that left the reference
   room in its last reading; the other half stays held;
3. the rest by the contract's draw, including tasks the reference always answers, since a practice
   pass still returns the objective's measure.

The order reads the reference's own solves alone, so which task a candidate won cannot change the
practice set (rule 3). A task scored before its release keeps that comparison's solves on the exam
side; the Builder sees only its practice solves (`practiceRan`, `src/kernel/solves.ts`).

### What refuses a move

Comparison admission (`admission`, `src/campaign/admission.ts`) is asked before a comparison's first
event, whoever started it. It refuses, among others: no held-out task; fewer frontier tasks than a
step needs at the level plus two, one for a task set aside and one for a tie (`held-short`,
`comparisonFloor`); no `--cap`; an unread checker; a cap below what the comparison's test alone
costs at the dollars a solve the log's finished solves billed (`cap-short`), on which the table ends
the campaign on its budget where no comparison is open; and a stopped campaign without
`--past-stop` (`stop.overridden`). Session admission (`admitSession`) asks for a cap, a read checker and the stop
rule, and refuses a `--session` whose Builder started and did not end whole (`spent`,
`src/builder/session.ts`). A move the log shows begun continues without asking, and a rehearsal is
exempt by name. Refusals run in the order admission, terms, stop override, setting.
`bun run runs view` and `rehearse` read and prove these paths.

### Defaults

Owners and edges of the defaults in `AGENTS.md` section 6:

- `--target` and `--solves` live in `SIZE` (`src/kernel/size.ts`); `ROOM` is one constant read by
  the tally, task admission, the frontier and `roomOf`.
- The defect stop is `--defects` of a hand comparison only.
- The reserve (`--reserve`) sits above the most a solve billed under the default limits; for longer
  solves set it near an earlier log's `solve.finished.billed`.
- `--parent latest` and `--reference promoted`.
- A Builder session has 24 practice solves (`--practice-solves`), fewer where the total cannot
  reserve them (`practiceLeft`, `src/builder/tools.ts`); an Examiner session 240 minutes, 200 turns
  and 36 proposals (`tools/d1b/examine.ts`).

An Examiner session finishes when it has supplied the need (`shortOf`, `src/campaign/decide.ts`:
practice and the admission floor before the first comparison, the target after, at least a sweep), when it calls `finish` twice without proposing between, or after spending its
proposals. An early `finish` is declined with the need but no count, since an Examiner told a count
proposes one small batch and stops. The first two endings rest the conversation for the next ask.
