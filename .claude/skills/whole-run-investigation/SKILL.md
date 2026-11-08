---
name: whole-run-investigation
description: "Investigate one campaign or several together from their logs, producing findings with named owners. Use for a run audit, a stalled climb, unexpected failures or doubts about a reading (step, no-step, not-scored). Examine correctness, evaluation validity, exam leakage, task difficulty, promotions, time and cost. This is read-only: start no solve, session or round and change no verdict."
---

# Whole-Run Investigation

A whole-run investigation (WRI) reads one campaign, or several as equals, against the operator's
question, and ends in one vetted synthesis: whether each reading can be believed, what limited it,
and which owner each next change belongs to. It only reads and proposes; the host's verifier keeps
every verdict, and `AGENTS.md` sections 1 to 8 own the rules it reads against.

A deterministic fold of the log gives six rows (the identities every finding binds to) and a set of
triggers. Each trigger opens one of twenty-nine lanes in [the catalogue](references/lanes.md), each
lane is one question answered by an independent session, one session merges the reports, and the
primary vets the result.

## Questions that need no lanes

`--log` takes a path or a campaign's whole name, and `start` and `climb` take several, comma
separated. `accept.ts` and `settle.ts` write to the campaign, so they belong to their own authorised
procedures and never run inside an investigation.

| question | command |
| --- | --- |
| Is a run alive, and what did it last do? | `bun run runs pulse` |
| Is there supply for a comparison? | `bun run runs view <name>` |
| Does the checker stand on fresh controls? | `bun tools/c/accept.ts <the campaign's flags>` |
| What does a repaired checker move? | `bun tools/c/repaired.ts --log <log> --bundle <repaired pack>` |
| What do set-aside rejections read once labelled? | `bun tools/d2/settle.ts <the campaign's flags> --session <id>` |
| Did another model answer any seat? | `bun tools/runs/degradations.ts <name>` (and `data/runs/degradations/`) |
| Which sessions ran, from which parent, with which reading? | `bun tools/wri/wri.ts read --log <log>`, row F and `CHAIN` |
| Did a promotion climb, beside campaigns on the same pack, and did `/tmp` cross between them? | `bun tools/wri/wri.ts climb --log <log>,<log>` |
| How far had each campaign got at each work hour? | `bun tools/wri/wri.ts trajectory --log <log>,<log> [--grades <report>] [--hours 2,4,8]` (a description; rule 1 keeps "better" for a comparison) |
| Did tasks and harnesses grow across campaigns, graded blind? | `bun tools/wri/wri.ts packets --log <log>,<log> --out <dir> --graders 2`, launch its `launch.json`, then `packets --out <dir> --join` and `trajectory --grades <dir>/grades.tsv` |
| What did earlier investigations find? | `bun tools/wri/wri.ts index [--root <dir>] [--out <file>]`, which rewrites `.ana/wri/INDEX.md` and stays under `.ana/` |
| How does this run's cost a promotion compare with its release? | `bun .claude/skills/promotion-tuner/scripts/table.ts --rows groups` (or `--name <part> --rows promotions`) |

## The procedure

Six steps, each gated by the check of the one before. Keep the files in one directory `<dir>`
under `.ana/wri/<date>-<campaign>/` on the central host.

1. **Start.** `wri.ts start --log <log>[,<log>...] --out <dir>` writes the rows and triggers to
   `<dir>/overview.md`, `<dir>/shared-instructions.md` with three sections blank, and the derived
   readers. Name every campaign the question spans; each lane reads all of them and marks each
   finding's `Seen in:`. A log a campaign may still write is refused: stop or pause the run first
   (`bun run runs stop <name> --yes`), or pass `--snapshot`. With
   `bun --env-file=.env.runs tools/wri/wri.ts ... --log <name>`, a remote campaign is fetched into
   `data/runs/<host>/<name>/` (`runs fetch <name>` refreshes it). Where the last receipt names
   another commit, `start` checks it out as `anabasis-wri-<commit>` so lanes can run readers as they
   ran. Later verbs reread the stored paths; a new snapshot is a new investigation.
   *Check:* use the tree the `host-code digest` line names, or mark each source claim as concerning
   another tree (the receipt, not the digest, gives the commit). Settle rows A to F.
2. **Edit the shared instructions** (below). *Check:* no `##` section is blank and the hard rules
   remain.
3. **Build the lanes.** `wri.ts lanes --out <dir> [--lanes 1-4,7] [--agents N]` writes
   `<dir>/lanes/NN-prompt.md` and a manifest: `<dir>/launch.json` the first time, and
   `launch-NN[-NN...].json` by the lanes it built every later time, which the verb names. Without `--lanes` it opens every triggered lane
   and the five standing lanes, and names, without building, each isolated lane whose trigger fired.
   `--agents N` packs whole labels into N sessions of similar summed `Importance:`, and the verb
   prints a suggested N (the most sessions whose lightest weighs at least half the heaviest). A prompt
   built before is kept and left out of the new manifest. *Check:* exit 0; the sessions this call
   built are the count to authorise, and if it built none, launch nothing.
4. **Launch.** Each manifest is a [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) manifest
   (`gpt-sessions.ts --manifest <dir>/launch.json --output-dir <new dir> ...`, on the operator's
   model). A Claude session runs as the `wri-lane` agent type (`.claude/agents/wri-lane.md`,
   `subagent_type: "wri-lane"`), handed only its row's `task` line, all in one message. Its hook
   (`tools/wri/lane-guard.ts`) enforces the hard rules in code. Where the Agent tool lists no
   `wri-lane`, open a session in a worktree at the stack's top; never use `general-purpose`.
   *Check:* each transcript's model, and that each lane ran as `wri-lane`.
5. **Collect.** `wri.ts collect --out <dir>` checks each report's shape and writes `<dir>/reports.md`.
   Read lane 3, then decide lane 4; read lanes 10 and 12, then decide lane 15. Build an isolated lane
   with `wri.ts lanes --out <dir> --lanes 4` (or `15`), launch it alone from its own
   `launch-NN.json`, and collect again. *Check:* `collect` exits 0 (1 while a report is missing or
   invalid, or none is expected). A valid shape is not a sound finding.
6. **Synthesise.** `wri.ts synthesis --out <dir>` renders `<dir>/synthesis-prompt.md`; one session
   writes `<dir>/synthesis.md`, and the primary vets it. *Check:* every consequential claim is marked
   as checked against the log or as resting on one report.

### Commands

Each runs as `bun tools/wri/wri.ts <verb>`; the usage block at the head of `tools/wri/wri.ts` is the
source.

| step | command | writes |
| --- | --- | --- |
| read | `read --log <log>` | nothing: rows, triggers and host line |
| 1 | `start --log <log>[,<log>...] --out <dir> [--snapshot]` | `overview.md`, `shared-instructions.md`, `investigation.json` |
| 3 | `lanes --out <dir> [--lanes 1-4,7] [--agents N]` | `lanes/NN-prompt.md`, `launch.json` |
| 5 | `collect --out <dir>` | `reports.md` |
| 6 | `synthesis --out <dir>` | `synthesis-prompt.md` |
| lanes 1, 4 | `grade --log <log> [--bundle <pack>] --task <taskId> --answer <file>` | nothing: one verdict line (`--bundle` only for a stored pack) |
| any | `derive (--log <log>[,<log>...] \| --all) [--verbose] [--force] [--no-embed]` | `data/derived/<campaign>/`: one file a reader and `manifest.json` |

### The readers, derived

About thirty deterministic readers each map one log to text (`READERS`, `tools/wri/derive.ts`;
`bun run runs pulse` runs the same list). Left out are tools that read no run
(`comparison-reading/scripts/size.ts`, `examiner-complexity/scripts/rungs.ts`,
`system-audit/scripts/recent.ts`), that need more than a campaign
(`examiner-complexity/scripts/grades.ts`, `oracle-handover/scripts/slice.ts`, `tools/c/repaired.ts`,
`tools/runs/search.ts`, `wri.ts grade`), that write (`wri.ts start`, `lanes`, `collect`, `synthesis`,
`index` and `derive`, `wri2p2.ts open`, `tools/c/rejections.ts`, `tools/d2/close.ts`) or that call a
paid model (`system-path-simulation/scripts/live-seat.ts` and `referee-seat.ts`,
`compare-systems/scripts/systems.ts`).
`derive` writes `data/derived/<campaign>/<reader>.txt` in the main worktree, rewriting a folder only
when its log or commit moved, so each folder describes one moment of the log. It prints one line;
`--verbose` prints every file, `--force` rederives after an uncommitted reader change, and
`--no-embed` skips the readers on the local embedding model (`tools/wri/embed.ts`): `restated`, which
groups Referee reasons at cosine 0.93, and `nearness`, which measures how alike tasks read, never
whether they depend. Lanes read these files instead of rerunning readers; the folders hold hidden
values and stay on the exam side.

Two campaigns of one pack, one under a checker and one under its repair, are separate
investigations; lane 1 of the later one joins them.

## Sizing

More campaigns lengthen sessions without adding any. Where the operator names no N, take 2 sessions
for a small run (no promotion, a few hours), 8 for 3 or more promotions and 4 to 6 between, sized by
the largest campaign. With a smaller budget, read groups in dependency order:

1. **Verdicts (1 to 6)**, lane 3 first: until refusals read sound, a win may be a check refusing the
   parent's right answer.
2. **Comparison (17 to 20, 29)**, lane 18 first.
3. **Harness (12 to 16)**, lane 12 first.
4. **Supply (7 to 11), solve (24), economy (25), runs (26).**
5. **Climb (21 to 23, 27, 28)**: open it before anyone is told a campaign improved a harness. Lane 27
   runs from the start.

In a release cycle, launch every lane at once and synthesise from the reports in hand within the
twelve-hour improvement window (run-improvement-campaign). `--lanes` builds a named lane without its
trigger, except an isolated one.

### Report checks

`reportOf` accepts `finding`, `no finding`, `could not read` and `omitted`, and checks the lane
heading, equal counts of `Observation:`, `Cause:`, `Owner:`, `Reverses if:` and `Decision:` lines,
findings only under `finding`, and a catalogue owner. It checks no evidence, so read the `## Checked`
section behind each `no finding`. An open lane may follow a problem past its question or mark itself
`omitted` with a reason; an isolated lane never does.

## Hard rules

### In every lane prompt

[The preset](references/shared-instructions.template.md) carries these, so an edited copy keeps
them unless the primary deletes them.

- **Quote nothing the walls keep apart**: no task text, answer, hidden value, check failure text,
  prompt, trace passage or reviewer prose. Cite event kinds, ids, digests, counts, paths and lines.
- **Never write under a campaign's folder, and never append to a log.**
- **Start no solve, session, round or check run**, except `wri.ts grade` where a lane names it.
- **Open the report early and append findings as they hold.**
- **Stay independent**: no lane opens another's prompt or report.
- **Read source in the tree the campaign's row names**, and say when it is not the tree that ran.

### For the primary

- **Settle rows A to F yourself.**
- **Isolated lanes run alone.** Lanes 4 and 15 freeze a result before reading anything that could
  lead it, so neither gets the orientation, the moved variable or another lane's trigger.
- **No report reaches a Builder, an Examiner or a Referee.** Lanes read hidden values and scored
  traces; a finding handed to a seat that writes the harness or the tasks is the leak lane 12 looks
  for.
- **A `pack/` finding is a decision, never a patch.** It goes to the checker's owner, and a repair is
  another campaign (`accept.ts --freeze`, `repaired.ts`).
- **Verify every session's model from its transcript** before using its report.

## Editing the shared instructions

`<dir>/shared-instructions.md` goes whole into every open lane and the synthesis; an isolated lane
gets only its campaign and hard-rule sections. A blank `##` section refuses `lanes`, and deleting a
heading drops that section on purpose.

| section | written by | holds |
| --- | --- | --- |
| Orientation | the primary | the operator's question and where its evidence is, never the expected answer |
| The moved variable and prior state | the primary | what changed since the previous campaign, earlier findings to check, and what would falsify each; "none" if nothing moved |
| Already read by the primary | the primary | what you already checked, with evidence, so lanes build on it; "nothing" if nothing |
| Campaigns under review | `start` | each campaign, log, size, checkout and host line |
| Hard rules | the preset | the rules above |

A lane told what to find finds it, so an earlier diagnosis is a hypothesis under the prior state,
never a premise in the orientation. In a release cycle the prior state lists every row of each
run's `predictions-<run>.md` (in `.ana/wri/<date>-cycle-<release>/`, run-improvement-campaign step 1)
with its pull request, area labels ("Labels" in [the catalogue](references/lanes.md)), lanes, claim
and falsifier, but not its resolution in `outcomes-<run>.md`, plus the ids the parent iteration did
not hold and its plan's "Intentionally opposed" trade-offs, as the still-missing view of
`wri2p2.ts ledger <dir>` prints them. Step 3 opens every lane a row names with `--lanes`; lanes 4 and 15 get no row.

## Vetting

[The synthesis template](references/synthesis.template.md) owns what the note contains. The primary
then treats it as research, in two acts kept apart:

- **Triage** sorts each finding by kind and owner (host defect, pack, operator decision, prediction,
  already changed at the head) and checks nothing.
- **Vetting** checks a finding against the logs, the source at the head and, where named, the kept
  harnesses and check program, and rules it **confirmed** (recounted here), **plausible** (resting on
  one report) or **refuted**.

Vet every finding, first those that would change code or a decision, and write `<dir>/vetting.md`,
one row a finding with its verdict and what was checked. Never report a triaged finding as vetted.

**Backtrack the predictions first.** In a release cycle, `vetting.md` opens with one row for each id
of every `predictions-<run>.md` (and of a cycle's `Predictions.md` written before 8 November), beside
its `outcomes-<run>.md` row:

- **Resolve it from the logs**: held, falsified or unreached, recounted from the events the row
  names. Lane reports and earlier resolutions are leads.
- **Name the evidence**: whether an event shows the pull request's mechanism ran (`AGENTS.md`
  section 9). A held row whose mechanism never ran is unreached.
- **Treat a falsified row as a finding**: triage it to one owner (the code, the prediction's
  reasoning or the run's condition) and vet it; a confirmed one joins the cycle's plan.
- **Carry an unreached row forward**: say why its trigger never came; the next fork's
  `predictions-<run>.md` carries it under `## Carried`, and the run's still-missing view shows it.

*Check:* `vetting.md` holds as many prediction rows as the ledgers, counted held, falsified and
unreached by area label.

Then vet the synthesis's own findings:

- **Start from the operator's decision** (believe this step, run another round, repair the checker,
  run the Examiner again) and order by it.
- **Read the instrument before the tally.** An unruled rejection sets its task aside, and `counted`
  gives the tally were all to stand; only a person's labels (`tools/d2/settle.ts`) settle it.
- **Read `not-scored` and an empty `no-step` as no test.**
- **Keep observation apart from cause**; lane 4 separates a strict check from an incapable solver.
- **Recount** every "N of M" from the log, and **say whose reading a count is**.
- **Confirm against current source** before a `patch` row becomes work (`AGENTS.md` section 11,
  `stack-pr`).

## Where the detail lives

| file | owns |
| --- | --- |
| [references/lanes.md](references/lanes.md) | the stance, the owner table, the labels, rows A to F and lanes 1 to 29 |
| [references/from-v1.md](references/from-v1.md) | where each of v1's rows and lanes went |
| [references/shared-instructions.template.md](references/shared-instructions.template.md) | the preset every open lane carries |
| [references/synthesis.template.md](references/synthesis.template.md) | the synthesis session's prompt |
| `tools/wri/read.ts` | the fold of a log into rows and triggers |
| `tools/wri/catalogue.ts`, `tools/wri/investigation.ts`, `tools/wri/wri.ts` | the catalogue's parser, the prompts and report check, and the verbs |
