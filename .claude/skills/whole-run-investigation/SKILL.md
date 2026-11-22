---
name: whole-run-investigation
description: "Investigate one campaign or several campaigns jointly from their append-only logs, producing findings with named owners. Use for run audits, stalled climbs, unexpected failures, or doubts about a comparison reading (step, no-step, not-scored). Examines correctness, evaluation validity, evaluation-boundary leakage, task difficulty, promotions, compute time, and cost. Read-only: starts no solve, session, or round and modifies no verdict."
---

# Whole-Run Investigation

A whole-run investigation (WRI) examines one campaign, or several campaigns treated as equals, against the operator's question. It concludes with a single vetted synthesis establishing whether each comparison reading is trustworthy, what constrained the campaign, and which owner is responsible for each proposed change. The procedure is strictly read-only: the host's verifier retains all verdicts, and `AGENTS.md` sections 1 to 8 define the invariants under review.

A deterministic fold over the log produces six summary rows (the identities to which every finding binds) and a set of diagnostic triggers. Each trigger opens one of twenty-three lanes in [the catalogue](references/lanes.md). Each lane poses a single question answered by an independent session; a synthesis session merges the lane reports, and the primary reviewer vets the merged findings against the logs and source tree.

## Questions that need no lanes

The `--log` flag accepts either a file path or a full campaign name; `start` and `climb` accept comma-separated lists of campaigns. Because `accept.ts` and `settle.ts` write to the campaign record, they belong to their own authorised procedures and never run during an investigation.

| question | command |
| --- | --- |
| Is a run active, and what was its last recorded event? | `bun run runs pulse` |
| Is there sufficient held-out supply for a comparison? | `bun run runs view <name>` |
| Does the checker pass fresh control checks? | `bun tools/c/accept.ts <the campaign's flags>` |
| How do set-aside rejections read once labelled? | `bun tools/d2/settle.ts <the campaign's flags> --session <id>` |
| Did a different model answer any seat? | `bun tools/runs/degradations.ts <name>` (and `data/runs/degradations/`) |
| Which sessions ran, from which parent harness, and with which reading? | `bun tools/wri/wri.ts read --log <log>`, row F and `CHAIN` |
| Did a promotion climb relative to sibling campaigns on the same pack, and did `/tmp` paths cross between them? | `bun tools/wri/wri.ts climb --log <log>,<log>` |
| How far did each campaign progress at each work hour? | `bun tools/wri/wri.ts trajectory --log <log>,<log> [--grades <report>] [--hours 2,4,8]` (descriptive only; rule 1 reserves "better" for a paired comparison) |
| Did task difficulty and harness quality improve across campaigns under blind grading? | `bun tools/wri/wri.ts packets --log <log>,<log> --out <dir> --graders 2`, launch its `launch.json`, then run `packets --out <dir> --join` and `trajectory --grades <dir>/grades.tsv` |
| What did earlier investigations find? | `bun tools/wri/wri.ts index [--root <dir>] [--out <file>]`, which updates `.ana/wri/INDEX.md` inside `.ana/` |
| How does this run's cost per promotion compare with its release? | `bun .claude/skills/promotion-tuner/scripts/table.ts --name <part> --rows promotions`, read against `trend.ts --pack <pack>` |
| Is this pack's climb faster or slower than in preceding weeks, and does the difference hold? | `bun .claude/skills/promotion-tuner/scripts/trend.ts --pack <pack>` |

## The procedure

The investigation consists of six steps, each gated by the check of the preceding step. Keep all files in a single directory `<dir>` under `.ana/wri/<date>-<campaign>/` on the central host.

1. **Start.** Run `wri.ts start --log <log>[,<log>...] --out <dir>` to write the deterministic rows and triggers to `<dir>/overview.md`, create `<dir>/shared-instructions.md` with three author sections blank, and generate the derived reader outputs. Name every campaign covered by the question; each lane reads all of them and records each finding's `Seen in:` line. Logs that an active campaign may still append to are refused: stop or pause the run first (`bun run runs stop <name> --yes`), or pass `--snapshot`. With `bun --env-file=.env.runs tools/wri/wri.ts ... --log <name>`, a remote campaign is fetched into `data/runs/<host>/<name>/` (`runs fetch <name>` refreshes it). When the last launch receipt names a different commit, `start` checks it out as `anabasis-at-<commit>` so lanes can inspect readers at the exact commit that ran. Later verbs reread the stored paths; a new snapshot starts a new investigation.
   *Check:* inspect the tree named by the `host-code digest` line, or qualify every source claim as referring to another tree (the launch receipt, rather than the digest, identifies the commit). Settle rows A to F before proceeding.
2. **Edit the shared instructions** (see below). *Check:* confirm that no `##` section is blank and that the hard rules remain intact.
3. **Build the lanes.** Run `wri.ts lanes --out <dir> [--lanes 1-4,7] [--agents N] [--high K] [--regroup]` to write `<dir>/lanes/NN-prompt.md`, the shared file read once per session (`<dir>/lanes/shared-<hash>.md`, containing the shared instructions, rows, triggers, precomputed counts, and report format), and a launch manifest (`<dir>/launch.json` on the first call, or `launch-NN[-NN...].json` named after the built lanes on subsequent calls). Without `--lanes`, the command opens every triggered lane and the six standing lanes, and lists any triggered isolated lane without building it. Lanes are packed into `--agents N` sessions (4 by default), with each lane assigned to exactly one session. Area labels stay grouped unless the lightest session would weigh less than three quarters of the heaviest by summed `Importance:`; the command prints each session's weight. Previously generated prompts are retained and omitted from the new manifest. If the operator changes the session count, stop any running sessions and run `lanes --agents N --regroup` to repack all lanes without a completed report into a new manifest while leaving their prompts unchanged. Passing `--high K` assigns `"effort": "high"` to the `K` heaviest sessions and `"medium"` to the rest, overriding the launcher's `--reasoning-effort`; allocate high effort to the groups covering verdicts, comparison reading, and climb (typically a quarter to a half of the sessions). *Check:* confirm exit 0; authorise only the sessions created by this call, and launch nothing if none were built.
4. **Launch.** Each manifest conforms to [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) (`gpt-sessions.ts --manifest <dir>/launch.json --output-dir <new dir> ...`, using the operator's chosen model). Claude sessions run under the `wri-lane` agent type (`.claude/agents/wri-lane.md`, `subagent_type: "wri-lane"`), given only their manifest row's `task` line, all launched in one message. Its hook (`tools/wri/lane-guard.ts`) enforces the hard rules programmatically. If the Agent tool does not expose `wri-lane`, open a session in a worktree at the top of the stack; never fall back to `general-purpose`.
   In the same turn, the primary runs `wri.ts record --out <dir>` to execute the deterministic reads that require no model (`readsOf`, `tools/wri/record.ts`: weekly pack trends, promotions with their cost and post-promotion retention on new tasks, each run's promotions under the current tree's rule, and the cross-investigation ledger of vetted findings). Each output is written under its command in `<dir>/record.md` together with its timestamp, the number of lane reports already written, and its exit code. Completed reads are retained, so a second call reruns only failed commands; vetting recounts against this file, and in an iteration `wri2p2.ts next` requires every read to succeed before the isolated lane runs.
   *Check:* verify each transcript's model, confirm that every lane ran as `wri-lane`, and verify that `record` exits 0 with `read at` lines reporting fewer completed reports than the manifest contains.
5. **Collect.** Run `wri.ts collect --out <dir>` to validate each report's structure and write `<dir>/reports.md`, containing one summary line per lane followed by one line per finding: its id `<lane>.<n>`, the lane's self-assessment (`confirmed`, `plausible`, or `unmarked` if omitted) on both observation and cause, its owner, and its title. When the prior state includes a prediction table, the file ends with each prediction's lane resolutions and any lane that omitted a required line.
   Read lane 5 before deciding on lane 6: lane 6 opens only when lane 5 leaves a check undecided, and an iteration records the reason if it is omitted. Build lane 6 with `wri.ts lanes --out <dir> --lanes 6`, launch it alone from `launch-06.json`, and run `collect` again. *Check:* confirm that `collect` exits 0 (it exits 1 while any expected report is missing or invalid, or when none is expected). Structural validity does not establish soundness.
6. **Synthesise.** Run `wri.ts synthesis --out <dir>` to render `<dir>/synthesis-prompt.md`. A single synthesis session writes `<dir>/synthesis.md`, whose merged table cites every lane finding by `<lane>.<n>` and tags each row with a key from [the register of standing findings](references/standing-findings.md) or `new`. The primary then vets the synthesis. *Check:* confirm that every consequential claim is marked either as verified against the log or as resting on a single report.

### Commands

Every command runs as `bun tools/wri/wri.ts <verb>`; the usage header in `tools/wri/wri.ts` is the authoritative specification.

| step | command | writes |
| --- | --- | --- |
| read | `read --log <log>` | nothing: deterministic rows, triggers, and host line |
| 1 | `start --log <log>[,<log>...] --out <dir> [--snapshot]` | `overview.md`, `shared-instructions.md`, `investigation.json` |
| 3 | `lanes --out <dir> [--lanes 1-4,7] [--agents N] [--high K] [--regroup]` | `lanes/NN-prompt.md`, `lanes/shared-<hash>.md`, `launch.json` |
| 4 | `record --out <dir>` | `record.md`, with each read under its command |
| 5 | `collect --out <dir>` | `reports.md` |
| 6 | `synthesis --out <dir>` | `synthesis-prompt.md` |
| vetting | `findings [--root <dir>] [--window 7] [--until <date>]` | nothing: vetted findings across investigations, comparing the latest window against the preceding one by verdict, standing key, importance, fate, and lane |
| lanes 1, 5, and 6 | `grade --log <log> (--task <taskId> --answer <file> \| --solve <id> \| --answers <dir>) [--set <path>=<json>]...` | nothing: one verdict line per answer, the recorded verdict beside a regraded solve, and with `--set` the same answer with one field modified |
| any | `derive (--log <log>[,<log>...] \| --all) [--verbose] [--force] [--no-embed]` | `data/derived/<campaign>@<path>/` (one folder per log): one file per reader and `manifest.json` |
| any | `reader <name> --log <log>` | nothing: one reader's output, identical to what `derive` writes |

### Derived readers

Deterministic readers map a single log to structured text (`READERS`, `tools/wri/derive.ts`; `bun run runs pulse` executes the same registry), and each entry states in one line what its output contains. Most readers are pure functions over a single parse of the log's events; the remainder (those resolving a campaign by name, running the local embedding model, or inspecting kept harnesses) run in their own process. Run `wri.ts reader <name> --log <log>` to print any single reader.

The shared file distributed to open lanes lists all derived files in a table (one column per campaign with each file's line count) alongside the argument-bearing tools (`## Tools a lane runs` in [the catalogue](references/lanes.md)). Each lane's own prompt also points directly to the derived file containing the underlying rows for each fired trigger (`ROWS`, `tools/wri/investigation.ts`), while reminding the session that the raw record behind every table remains open for direct inspection. Isolated and blind lanes receive none of these derived summaries.

Readers that locate a campaign by name (`view`, `loop`, `source`, `logged`, `cost`, `table`) are skipped on snapshots and duplicate copies, where a name lookup would resolve to a different log; their derived file notes this in one line. The derived set excludes tools that read no run (`comparison-reading/scripts/size.ts`, `examiner-complexity/scripts/grades.ts rungs`, `system-audit/scripts/recent.ts`), tools requiring arguments beyond a campaign (`examiner-complexity/scripts/grades.ts`, `oracle-handover/scripts/slice.ts`, `tools/runs/search.ts`, `wri.ts grade`), mutating tools (`wri.ts start`, `lanes`, `collect`, `synthesis`, `index`, `derive`, `wri2p2.ts open`, `tools/d2/close.ts`), and tools that invoke a paid model (`system-path-simulation/scripts/live-seat.ts`, `compare-systems/scripts/systems.ts`).

`derive` writes to `data/derived/<campaign>@<path>/<reader>.txt` in the main worktree, using one folder per log path so a snapshot and a live log never collide. A folder is regenerated only when its log or commit changes, ensuring each snapshot reflects a consistent point in the log. By default `derive` prints a single summary line; `--verbose` lists every file, `--force` rederives after an uncommitted reader edit, and `--no-embed` skips the local embedding readers (`tools/wri/embed.ts`): `restated` (which clusters Referee reasons at cosine similarity 0.93) and `nearness` (which measures textual similarity across tasks without implying statistical dependence). Lanes should read these derived files rather than recomputing them; because they contain hidden values, they remain strictly on the exam side of the evaluation boundary.

Two campaigns on the same pack, one under an earlier checker and one under its repaired version, belong in separate investigations; lane 1 of the later investigation links them.

## Sizing

Adding more campaigns lengthens each session without increasing the session count. When the operator does not specify `N`, use 2 sessions for a small run (no promotions, a few hours), 8 sessions for 3 or more promotions, and 4 to 6 sessions in between, sized to the largest campaign. Keep each session to roughly eight lanes: packing a dozen or more lanes into one session risks context compaction, which degrades recall sharply (especially when a session reads every lane before writing any reports rather than writing each report as it finishes). Under a tighter compute budget, inspect lane groups in dependency order:

1. **Validity (lanes 1 to 7)**, starting with lane 5: until rejections are verified as sound, an apparent win may reflect a defective check rejecting the reference's valid answer.
2. **Comparison (lanes 8 to 11)**, starting with lane 8.
3. **Harness (lanes 15 and 16)**, starting with lane 15.
4. **Supply (lanes 20 and 21), solve and runs (lane 22), and economy (lane 23).**
5. **Climb (lanes 12 to 14 and 17 to 19)**: complete these before reporting that a campaign improved a harness. Lane 14 opens from the start. In a jobstat iteration, lane 14's grade also determines whether the newest promoted reference is evaluated on the external benchmark, and the iteration's `outside` gate checks whether that evaluation has been recorded (`run-improvement-campaign`, "The outside aim").

During a release cycle, launch all lanes concurrently and synthesise from the completed reports within the twelve-hour improvement window (`run-improvement-campaign`). The `--lanes` flag builds any named lane even without its trigger, except for an isolated lane.

### Report checks

`reportOf` accepts four final verdicts (`finding`, `no finding`, `could not read`, and `omitted`; a report still at its initial `Verdict: pending` is treated as unfinished). It validates the lane heading, a `Prediction <id>: held | falsified | unreached` line for every row of the prior state's prediction table naming the lane, matching counts of `Observation:`, `Cause:`, `Owner:`, `Reverses if:`, and `Decision:` lines, findings present only under `finding`, and owners belonging to the catalogue's owner table. Because `reportOf` checks structure rather than substance, always inspect the `## Checked` section behind any `no finding` verdict. An open lane may follow a defect beyond its initial question or mark itself `omitted` with a justification; an isolated lane may do neither.

## Hard rules

### In every lane prompt

[The template](references/shared-instructions.template.md) embeds these rules, so every edited copy retains them unless the primary removes them.

- **Quote nothing protected by the evaluation boundary**: no task text, submitted answer, hidden value, check failure message, prompt text, trace excerpt, or Referee prose. Cite event kinds, ids, digests, counts, file paths, and line numbers instead.
- **Never write inside a campaign folder, and never append to a log.**
- **Start no solve, session, round, or check run**, except `wri.ts grade` where a lane explicitly permits it.
- **Open each report with its heading and `Verdict: pending` before reading for that lane**, and append findings as they settle, one lane at a time.
- **Preserve independence**: no lane opens another lane's prompt or report.
- **Inspect source code in the tree named by the campaign's row**, and note explicitly when that tree does not match the commit that ran.

### For the primary

- **Settle rows A to F yourself.**
- **Run the isolated lane alone.** Lane 6 must freeze its constructed answers before seeing anything that could bias it, so it receives neither the orientation, the moved variable, nor any other lane's triggers.
- **Never expose a report to a Builder, Examiner, or Referee.** Lane reports contain hidden values and scored-trace evidence; passing a finding to a seat that writes harnesses or tasks introduces the exact evaluation leakage lane 15 guards against.
- **Treat a `pack/` finding as a decision rather than a patch.** Route it to the checker's owner; repairing a checker requires a new campaign (`accept.ts --freeze`).
- **Verify every session's model from its transcript** before relying on its report.

## Editing the shared instructions

`<dir>/shared-instructions.md` is included verbatim in the shared file for open lanes and in the synthesis prompt; an isolated lane receives only its campaign rows and hard rules. Any table under the prior state whose header includes `id` and `lanes` columns is parsed as a prediction table: each named lane receives its assigned rows in its own prompt and must report how often each row's trigger occurred in the log and how often its mechanism's event followed, enabling vetting to assign each change's evidence rung (`AGENTS.md` section 9) from counts. A blank `##` section causes `lanes` to fail; deleting a heading intentionally omits that section.

| section | written by | holds |
| --- | --- | --- |
| Orientation | the primary | the operator's question and where its evidence lives, never the expected answer |
| The moved variable and prior state | the primary | what changed since the previous campaign, earlier findings to recheck, and what would falsify each; write "none" if nothing moved |
| Already read by the primary | the primary | checks already completed with their evidence, so lanes can build on them; write "nothing" if none |
| Campaigns under review | `start` | each campaign's name, log path, size, checkout, and host line |
| Hard rules | the template | the hard rules listed above |

Because a lane told what to find tends to confirm it, place any earlier diagnosis as a falsifiable hypothesis under the prior state rather than as a premise in the orientation. In a release cycle, the prior state lists every row from each run's `predictions-<run>.md` (in `.ana/wri/<date>-cycle-<release>/`, `run-improvement-campaign` step 1) with its pull request, area labels ("Labels" in [the catalogue](references/lanes.md)), lanes, claim, and falsifier, omitting its resolution in `outcomes-<run>.md`. It also includes unheld ids from the parent iteration and the plan's "Intentionally opposed" trade-offs as printed by `wri2p2.ts ledger <dir>`. Step 3 opens every lane named by a prediction row via `--lanes`; lane 6 receives no prediction rows.

## Vetting

[The synthesis template](references/synthesis.template.md) specifies the required structure of the synthesis note. The primary treats the synthesis as research, keeping two stages strictly separate:

- **Triage** copies each row of the synthesis table with its lane findings and standing key, assigns its owner, and performs no independent verification. `record.md` ends with the cross-investigation ledger of vetted findings (`wri.ts findings`), showing how many investigations in the latest week held each standing key compared with the preceding week, and flagging keys held more than once with no repairing row.
- **Vetting** verifies each finding directly against the logs, the source tree at head, and (where relevant) the kept harnesses and check program, ruling it **confirmed** (recounted from source), **plausible** (supported by a single report), or **refuted**.

A finding tagged with a standing key is recounted for the current run without re-arguing the underlying mechanism. When the ledger flags a standing key as recurring without a repair, raise it to the operator once as a decision row in the plan alongside the ledger counts, and do not raise it again while that decision stands. Never present a triaged finding as vetted.

`<dir>/vetting.md` contains a findings table with the following columns (in any order, alongside any additional columns), enforced by an iteration's `vet` gate (`vettingFaults`, `tools/wri/findings.ts`):

| column | holds |
| --- | --- |
| `id` | `vet-<n>` |
| `finding` | a single-line summary stating what was checked |
| `lanes` | every supporting lane finding as `<lane>.<n>`, a lane number covering all of its findings, or `primary` for findings made directly by the primary; every lane finding must appear in at least one row |
| `standing` | a key from the standing-findings register, or `new` |
| `owner` | one owner from the catalogue's owner table |
| `importance` | `I0` to `I3` as defined in `AGENTS.md` section 11 for pull requests; required for every confirmed row |
| `verdict` | `confirmed`, `plausible`, or `refuted` |
| `fate` | required for every confirmed row: `repair` (a row in this plan), `carry` (deferred to a later plan), `operator` (a decision for the operator), or `none`, followed by the reason |

**Backtrack predictions first.** In a release cycle, `vetting.md` begins with one row per id from every `predictions-<run>.md` (and any legacy cycle `Predictions.md`), alongside its `outcomes-<run>.md` entry:

- **Resolve from the logs**: mark each row as held, falsified, or unreached by recounting the events it names. Lane reports and earlier resolutions serve only as leads.
- **Identify the evidence**: state whether an event confirms that the pull request's mechanism actually executed (`AGENTS.md` section 9). A row whose outcome aligned without its mechanism firing is `unreached`.
- **Treat falsified rows as findings**: triage each falsified prediction to a single owner (the code, the prediction's reasoning, or the run's condition) and vet it; confirmed items enter the cycle's plan.
- **Carry unreached rows forward**: explain why the trigger never occurred; the next fork's `predictions-<run>.md` carries it under `## Carried`, and the run's still-missing view tracks it.

*Check:* verify that `vetting.md` contains the same number of prediction rows as the prediction ledgers, tallied as held, falsified, and unreached by area label.

Next, vet the synthesis's own findings:

- **Order by the operator's decision** (whether to trust a step, launch another round, repair the checker, or re-run the Examiner), placing `new` rows ahead of keyed rows of equal consequence.
- **Audit the instrument before the tally.** An unruled rejection sets its task aside, whereas `counted` shows what the tally would read if all rejections stood; only human labels (`tools/d2/settle.ts`) settle the dispute.
- **Treat `not-scored` and an empty `no-step` as no test.**
- **Separate observation from cause**; lane 6 distinguishes an overly strict check from a solver limitation.
- **Recount** every "N of M" figure directly from the log, and **attribute each count to its reader**.
- **Verify against current source** before converting a `patch` row into implementation work (`AGENTS.md` section 11, `stack-pr`).

## Where the detail lives

| file | owns |
| --- | --- |
| [references/lanes.md](references/lanes.md) | the analytical stance, owner table, area labels, deterministic rows A to F, and lanes 1 to 23 |
| [references/from-v1.md](references/from-v1.md) | the mapping from v1 rows and lanes to v2 |
| [references/shared-instructions.template.md](references/shared-instructions.template.md) | the shared prompt template carried by every open lane |
| [references/synthesis.template.md](references/synthesis.template.md) | the synthesis session's prompt template |
| [references/standing-findings.md](references/standing-findings.md) | the register of standing findings, indexed by key, and the entry and exit criteria |
| `tools/wri/record.ts`, `tools/wri/findings.ts` | the primary's deterministic reads run alongside lanes; vetting table validation and the cross-investigation findings ledger |
| `tools/wri/read.ts` | the log fold producing deterministic rows and triggers |
| `tools/wri/catalogue.ts`, `tools/wri/investigation.ts`, `tools/wri/wri.ts` | the catalogue parser, prompt assembly and report validator, and CLI verbs |
