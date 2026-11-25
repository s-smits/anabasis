<!--
The synthesis session's prompt template. `wri.ts synthesis --out <dir>` renders this file into
<dir>/synthesis-prompt.md, substituting the eight brace-delimited slots and stripping comments. This
template defines the required contents of the synthesis note; the skill's "Vetting" section links
here.
-->
# Whole-run investigation synthesis

You are the sole synthesis session for the investigation under `{out}`. Each lane was analysed by an independent session that saw no other lane's report. Merge those reports into a single note at `{synthesis}`: write its heading first and append each section as it settles. Write no other files, make no commits, and edit no source code.

## The shared instructions every open lane read

{sharedInstructions}

## What the logs hold

```
{overview}
```

## The reports

Read every report marked `ok`, including the `## Checked` section behind any `no finding` verdict; an empty `## Checked` section leaves that lane unsubstantiated, because the collector validates structure only. List every `omitted` lane with its stated reason, placing lanes whose trigger fired first. Record every `missing` or `invalid` report as an explicit gap and never reconstruct it from memory. Beneath each lane, the index lists every finding's id alongside the lane's self-assessment on observation and cause. Treat every report as a lead: re-run the command cited by a confirmed observation before carrying its count forward, and keep any cause marked `plausible` or `unmarked` as plausible (noting what would settle it) unless you verify the owning line in source yourself.

{reports}

## Same-domain version history (weighted by version gap)

Deterministic backtracking of older runs from the same domain (`wri.ts backtrack`), decaying attention weight as release-version gap grows (`direct` and `near` expanded with stored syntheses and `outside-reads.md`; `mid` rolled up by cohort; `distant` collapsed).

{history}

## External benchmark regression analysis (deterministic join)

Deterministic output of `bun run wri regressions` (`<out>/regressions.txt`): paired external benchmark deltas, missed rubric indices/weights, cut flags, inside-vs-outside `.toolchain/bin` invocation counts, and cross-version cohort backtrack stratified by runtime and baseline tier (`bareSolver` vs `baseStarter`).

```
{evalRegressions}
```

## The register of standing findings

Recurring issues observed across repeated investigations and left unresolved, indexed by key. No individual lane was shown this register.

{register}

## What the note requires, in order

0. **Version-over-version progress (same domain).** From the version history above and Lane 2, state explicitly whether the investigated run(s) improved, stayed flat, regressed, or remain unproven against the nearest prior release (`direct` / `near` cohorts, `gap < 2`, high attention), citing matched active hours, `written-after` confirmation, validity room, A/A honesty, repriced `$/promo`, and external `outside-reads.md` scores. State whether the nearest prior release's stored binding constraint moved, and identify any change since that release that regressed or missed its bar. Give `mid` (`2 <= gap < 3`) one trend sentence at most and leave `distant` (`gap >= 3`) collapsed.
0b. **WRI + Eval full triage.** Where external benchmark records exist above, join the external rubric misses, cut flags, unused `.toolchain/bin` tools, and baseline-stratified cohort delta (`builtSolver` vs `bareSolver` or legacy `baseStarter`) directly to the internal WRI lanes (`d-N` exam checks/objective saturation, `x-N` task families, `b-N` Builder guide/tool edits, and `g-N` `written-after` confirmation splits). State in one plain paragraph what failed externally and which internal campaign mechanism caused it; if no external store or paired arm exists (or promotions are below `minPromo`), state the exact readiness status in one sentence.
1. **Whether the reading can be believed.** Provide one row per `comparison.reported` across every campaign, evaluating four links as `holds`, `does not hold`, or `undeterminable` with its event kind and count: (a) the exam measured what was intended (the checker was frozen and read, passes, deliverables and verifier grounding are sound, and rejections in the tally are sound; lanes 4, 11, 16, 17, and 20); (b) the tasks were properly bracketed (the scored set was held out and fixed before the first solve, uninfluenced by comparison outcomes; lanes 5, 7, 9, and 17); (c) the paired arms differed solely in the harness, with no evaluation leakage or sandbox breach (lanes 8, 9, 12, 15, and 19); (d) the statistical reading follows from the pairs at the observed sample size and transfers beyond selecting tasks (lanes 5 and 6). Follow each row with one sentence classifying the reading as believed as written, believed with a named limit, or not believed.
2. **The binding constraint.** Identify the single mechanism that most limits the next round, and explain why it outranks the alternatives.
3. **One merged findings table:** `finding | lanes | standing | campaigns | owner | evidence | outcome`. Merge duplicate findings under the earliest owner so that every finding from every `ok` report appears in exactly one row. `lanes` lists every supporting lane finding by its id from the findings table above (`lane12-misreading1, lane17-leak1`), because independent convergence carries weight and vetting accounts for each entry. `standing` is the matching key from the register above, or `new`; a keyed row cites this investigation's count as its evidence without re-arguing the mechanism. `campaigns` lists every campaign exhibiting the finding, drawn from `Seen in:` lines verified against the logs; when a finding appears in only one campaign, state what distinguishes that campaign from the others. `owner` is exactly one owner from the catalogue's owner table, naming the file for `host` and prompt owners. `evidence` cites an event kind and count, and notes when the cause remains plausible. `outcome` is exactly one of `patch`, `decision`, `prediction`, or `drop`. Rank rows by their impact on the four validity links above, placing `new` rows ahead of keyed rows of equal impact.
4. **Conflicts resolved.** Wherever lanes disagree, cite the log events that settle the conflict, or present both readings alongside the observation that would distinguish them.
5. **Build plan.** Group `patch` rows into clusters touching disjoint files, specifying owner, mechanism, and failing test for each. A `pack/` finding is always a `decision` rather than a patch.
6. **Operator decisions.** List each decision requiring operator authority with the missing evidence, what it changes, and its plan decision number where one exists.
7. **Predictions.** List falsifiable rows for the next round specifying moved variable, claim, direction, and falsifier. Name the `patch` row each prediction tests so a fork's `predictions-<run>.md` can attach it to that pull request.

## Hard rules

- Quote nothing protected by the evaluation boundary: no task text, submitted answer, hidden value, check failure message, prompt text, trace excerpt, or Auditor prose, whether from a log or a report. Cite counts, ids, digests, file paths, and line numbers only.
- Separate every observation from its proposed cause in two distinct sentences.
- Recount every "N of M" figure carried from rows A to F before citing it.
- Treat every Auditor ruling as a single reviewer's reading: state whose count it is before relying on it.
- Never write inside a campaign directory, and start no solve, session, round, or check run.

Once the synthesis note is complete, reply with its file path and one summary line per table row giving the finding and its outcome.
