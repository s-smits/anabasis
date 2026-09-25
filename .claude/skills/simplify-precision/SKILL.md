---
name: simplify-precision
description: Measure and raise the precision of `bun run simplify`, the simplify census, shape by shape. Harvests every recorded census reading and not-slop answer, replays the current scans over history, has blind judges label a seeded sample, scores each shape with a Wilson interval, and tunes a scan's source until the sites it prints are ones a reader would act on (target 0.8). Use when asked how good the census is, why it flags the wrong things, or to tune a tree scan or a staged catcher.
---

# Simplify census precision

The census (`tools/oxlint/simplify-census.ts`) predicts where `/simplify` would cut. The goal
here is **precision**: a printed site should be one a reader acts on. Missing some is cheap. The
target is a point of **0.8 per shape**, with the Wilson lower bound at or above 0.6 once 20 sites
are judged. A shape that cannot reach that is narrowed until it does, or goes to the operator
with its figures.

Recall is out of scope. A shape that is narrowed to fewer, truer sites has improved, even if it
now prints nothing on today's tree. That is where every scan should sit on a clean tree.

## What counts as a label

| source | what it says | weight |
| --- | --- | --- |
| a not-slop ledger row (`tools/oxlint/not-slop.tsv`, either repository) | a reader answered no | a true **no**; also calibrates the judge |
| a blind judge verdict (`labels.tsv`) | would a maintainer make this change, as proposed | the precision figure |
| a scan narrowed by a commit | a class of no, now silent | history, not a label: the site no longer prints |
| a site gone by a later revision | the code changed | never a yes on its own: edits, renames and rewrites also remove sites |

Outcome-based rates are in `tools/oxlint/SHAPE-RULESET.md` ("What the simplify record lets a
deterministic catcher see"). They read 0.15 to 0.55 per visit and 0.7 to 0.9 eventually, and
neither is the reader's judgement. The judge is the measure. The ledger keeps the judge honest.

## The loop

Scripts run with Bun from a worktree whose scans are the rule under test. `S` is a scratch
directory.

1. **Harvest usage.** `bun .claude/skills/simplify-precision/scripts/usage.mts --since <date>
   [--rows] [--answers]` lists every census reading (time, session, findings, shapes) and every
   written not-slop answer across all `~/.claude*` accounts and `~/.codex/sessions`. It takes
   about a minute. Read which shapes readers met, and what they answered no to, before sampling.
   Narrowing history: `git log --format='%h %ad %s' --date=short -- tools/oxlint/tree-*.ts`.
2. **Replay.** Run `precision.mts replay --repo <repo> --out $S/sites.jsonl --every 40 --since
   <date>` for this repository, and again for its sibling: `~/Developer/harness-builder-v4` and
   `~/Developer/anabasis` carry the same scans (`--every 6` for anabasis, a younger history). Each
   row carries the rule digest of the scan sources. Two rules never mix in one file.
   The replay prints what the census would have printed: registers are skipped and `censusReads`
   is applied.
3. **Sample.** Run `precision.mts sample --sites <pooled> --per-shape 16 --seed <n> --out
   $S/round<k>`. It draws unjudged sites, one per id at its oldest revision, into 10-item packets
   and a `manifest.json` that the judges never see. Write down the prediction per shape before the
   verdicts arrive.
4. **Judge.** Launch one read-only subagent per packet, at most eight at once (the operator's
   cap), with [references/judge.md](references/judge.md) as its instruction, the repository path
   and the verdict file. Each writes `verdicts-<n>.tsv`. For the model's view, route through
   `codex-luna-swarm` when Claude allowance is short. To re-judge a round after changing the
   instruction, `sample --again <round>/manifest.json --out <new round>` repacks the same sites
   in the same order; `ingest` under a new `--judge` name adds rows beside the old ones, and
   `score` reads the latest judge per site.
5. **Ingest.** Run `precision.mts ingest --manifest ... --verdicts ... --judge <model>` for each
   verdict file. This appends to `labels.tsv`, and the file is committed with the tuning.
6. **Score.** Run `precision.mts score --sites <pooled> --ledger
   <sibling>/tools/oxlint/not-slop.tsv`, which adds the sibling's answers to this tree's. For each shape it prints the judged yes/n, the
   point, the 95% interval, and how many ledger no rows the judge also answered no. When the judge
   disagrees with the ledger, fix the judge instruction before you read the precision figure.
7. **Tune.** Read the no reasons of the weakest shape (`grep <kind> labels.tsv`). Group them into
   classes and pick the largest class that a syntactic or whole-tree condition can separate.
   Change the scan's source, then add a fixture for the admitted no and for its nearest yes in
   `test/simplify-census.test.ts`.
8. **Measure the candidate.** Replay again from the candidate worktree over the same revisions,
   then run `score --candidate $S/candidate.jsonl`. The line `dropped N (yes a, no b)` is the
   ablation. A condition is kept only when `b` is well above `a`. The v7 lesson in SHAPE-RULESET
   applies: it cost 18 yes for 8 no. The candidate's new sites and the precision you claim come
   from a **fresh** sample drawn after the rule is frozen. Verdicts that shaped a condition cannot
   also confirm it.
9. **Decide per shape.**
   - Point at or above 0.8 with 20 or more judged: keep it as it is.
   - Between 0.6 and 0.8: narrow it again (step 7).
   - Below 0.6 after two narrowings: give the operator the figures and the no classes that no
     condition separates. A scan is never switched off here; a quiet tier was tried on
     2026-09-24 and reverted, because the low figures came from a miscalibrated judge.

   Record the decision and its figures in a dated SHAPE-RULESET.md section. Also update the
   shape's argument in `TREE_FINDING_ARGUMENTS`, which prints above its sites.

## Rules this skill inherits

- AGENTS.md rule 8 governs tuning: change the rule's source so it targets the slop more
  precisely, with a fixture for each side. Never add an `"off"` entry.
- Judges are read-only and blind: no ledger, no later commits, no outcome. They must not edit the
  tree or answer ledger rows.
- A judge's yes understates the operator's. On 2026-09-21 the judge matched 7 of 7 operator no
  answers and 7 of 13 operator yes answers. A judged 0.8 is therefore a floor, not a ceiling.
- A judge reads the rules of the checkout its session opened in, which may be stale. On
  2026-09-24 round 1 was judged under a working-branch AGENTS.md that still said historical
  evidence stays readable, and answered no to 31 of 32 legacy readers the operator had removed.
  The instruction now makes the judge read `origin/main`'s rules and prints each shape's census
  argument at the top of the packet. Re-judged on the same sites (round 1b), the overall
  precision went from 40 of 145 (0.28) to 94 of 144 (0.65). When a figure moves that much,
  suspect the instrument first.
- Replay the current rule over old trees. Sites the rule was already tuned on are in-sample. Say
  so when you report a figure, and prefer sites from revisions after the last narrowing.
- On today's trees the census reads 0 findings: every site is either fixed or answered. A zero
  does not mean the census failed to run. Fresh sites come from new commits, so re-run steps 2 to
  6 with `--since` set to the last labelled date.

## Files

- `scripts/precision.mts`: replay, sample, ingest, score.
- `scripts/usage.mts`: census readings and not-slop answers from every transcript.
- `references/judge.md`: the judge instruction.
- `labels.tsv`: every judged site (`id kind verdict source reason`), appended, never rewritten.
- Figures and decisions per round: the dated sections of `tools/oxlint/SHAPE-RULESET.md`.
