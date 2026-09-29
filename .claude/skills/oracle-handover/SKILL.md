---
name: oracle-handover
description: "Hand a question to an outside Oracle model (GPT-5.5 Pro or whichever the operator names) as one task document plus one zip. The Oracle reads GitHub and the harness-builder-v4 history; the zip carries what it cannot fetch: run traces via zip-run, patches for unpublished commits, notes, ledgers, predictions and plans. Use for \"oracle prompt\", \"prompt for GPT-5 Pro\", \"zip the traces for the oracle\", or the retired gpt-5-pro-appender."
---

# Oracle handover

An Oracle is an outside model the operator consults on a question this repository cannot settle
from its own evidence: a design dilemma, a disputed reading of a run, a doubt about whether the
climb is measuring anything. It is not part of the loop. It sets no score, and its answer is
research that a session checks against the source before anything acts on it.

The Oracle can read the public repository at any published commit, and the full earlier history
beside it. What it cannot read is everything this checkout holds locally: controller output under
`campaigns/`, the ignored `notes/`, commits that were never pushed, and the measured source of a
run launched from a local compose. So a handover is two files. One is a task document, which the
operator pastes as the message. The other is a zip, which the operator attaches. The document cites
code by commit and path, and the zip carries only what GitHub cannot serve.

This skill replaces the user-level `gpt-5-pro-appender`, retired on 2026-09-28. That skill copied
source into one long Markdown file. Copying was the right call when the reading model had no
repository access. With access, a SHA and a path say the same thing without drifting, and the size
budget goes on the traces instead, which the Oracle cannot get anywhere else. The appender's
copying mechanism survives below for a reader that has no access.

## Resolve what GitHub can serve

Run `git fetch origin` first. Then take every commit you intend to cite and ask whether it is
published, with `git branch -r --contains <sha>` or `gh api repos/s-smits/anabasis/commits/<sha>`.
A cited SHA the Oracle cannot open sends it off to reconstruct the tree from prose, and it will
guess.

A run's measured source is often unpublished, because runs launch from a local compose of the
stack. The first thing to try is a published commit whose product tree matches: an empty
`git diff --stat <measured> <published> -- src starters tools vendor` means the Oracle can read the
measured product there. Cite both commits and name the difference. On 2026-09-28 the four f0fb83
runs had been measured at fc2e73d7, which was never pushed, and its product tree equalled the PR #45
head d6c1ecdd; the whole-tree difference was 15 lines of AGENTS.md. When no published commit
matches, the patches carry the difference.

## Build the bundle from the helpers that exist

Work in `<scratchpad>/oracle-<yyyymmdd>-<topic>/`. Each directory is made by a command the
repository already owns, so building a bundle means running those commands, not writing a
collector.

| directory | what it holds | made by |
| --- | --- | --- |
| `runs/` | one zip per run | `bun .claude/skills/zip-run/scripts/zip-run.ts <run worktree> --medium --out runs/<runId>-medium.zip` ([zip-run](../zip-run/SKILL.md)) |
| `patches/` | every commit the Oracle cannot fetch | `git diff <published> <local>`, `git format-patch -o patches/<name> <range>`, `git log --format='%h %s' <range>` |
| `wri/` | a whole-run investigation's brief and lane files, when one was read | `bun .claude/skills/whole-run-investigation/scripts/wri.ts read … --out` ([whole-run-investigation](../whole-run-investigation/SKILL.md)) |
| `notes/` | state folders, `notes/gate-audit-ledger/`, `notes/climb-rewrite-ledger/`, `notes/predictions/`, earlier handovers | `rsync -a`, leaving out drafts and raw probe dumps |
| `plans/` | each epoch's `EXPERIMENT.json` | copied from `campaigns/<c>/epoch-*/workspace/`, because zip-run keeps workspace files for `--verbose` |
| `watch/` | the campaign watcher's log and state, if one ran | copied from where `campaign.ts --state` wrote them ([run-improvement-campaign](../run-improvement-campaign/SKILL.md)) |

**Why medium.** `--medium` is the Oracle's default. It is the level that carries each case's trace,
its verifier output and the whole correctness model, and those are exactly what the Oracle cannot
reach anywhere else. Pick `--light` for a run only when the question is about its rounds and not
its cases. The [zip-run](../zip-run/SKILL.md) table sizes the levels.

**Re-zip last.** Take the zips after the last event the document cites. A zip taken before a claim
lands does not contain it: the first truss-sol zip of 2026-09-28 was taken a minute before the i05
claim and lacked it.

**Predictions.** `bun .claude/skills/run-improvement-campaign/scripts/prediction.ts list` gives a
readable view of the frozen ledgers. Ship the `.jsonl` too, because the digests are what prove a
prediction was frozen before its evidence.

**Secrets.** Before zipping, grep the tree for credential prefixes (`sk-ant-`, `ghp_`) and for
credential variable names carrying a value (`CLAUDE_CODE_OAUTH_TOKEN`, `OPENROUTER_API_KEY`).
zip-run already leaves out `auth.json`. Never copy a `.env`.

**The zip.** Put the task document at the root as `REVIEW.md`. Zip the directory with
`ditto -c -k --norsrc --noextattr --keepParent <dir> <dir>.zip`. Without the two flags, `ditto`
adds a `._` sidecar beside every file, which doubles the file count and means nothing to the
Oracle. Check the result with `unzip -tq`. Keep the whole under 20 MB: zip-run calls a run bundle
of that size verbose, and a verbose handover means the level was chosen wrong. Save a copy of the
document as `notes/oracle-handover-<yyyymmdd>-<topic>.md`, so the next handover can see what was
asked before.

## Write the document as the task, not as a draft

The Oracle reads one pasted document with no covering context. Anything that makes it look like a
prompt under construction gives the Oracle a second plausible job, which is critiquing the prompt.
On 2026-08-15 a file that opened with `# Prompt for GPT-5 Pro: …` and "You are GPT-5 Pro acting
as…" got back a question asking whether to execute the prompt or improve it first. So:

- Title the document after the work, such as `# Review: <subject>` or `# Design: <subject>`.
- Open with the instruction in the first sentence, then close the second reading: "This document is
  the task, not a draft to critique: do not suggest changes to its wording or framing, and do not
  ask which mode to work in."
- Never tell the model its own name or vendor.
- Name headers after the work: `## Deliver this`, `## Answer in this shape`.

The document runs in this order:

1. **The question and the decision it changes.** One paragraph.
2. **What you can read.** The repository URL `https://github.com/s-smits/anabasis` and the history
   `https://github.com/s-smits/harness-builder-v4`. A table of every cited SHA, saying what it is
   and whether it is published. Then one line per zip directory. Point at `AGENTS.md` at a cited
   commit for how the system works, rather than writing a second manual.
3. **What happened.** Recorded facts only, each with its path in the zip or on GitHub, and each
   with its three denominators kept apart: verified, unaccepted and non-result.
4. **What I doubt.** Keep this apart from the facts. For each doubt, give what you believe, why,
   what would refute it and where the Oracle should look. Say plainly that the premise may be
   rejected. A doubt is worth listing when its answer would change what happens next. Do not say
   which side the operator favours.
5. **Deliver this.** For each finding: the owner (a bundle file from `BUNDLE_FILES`,
   `controller-source` or `environment`), the evidence path, a falsifier and a confidence. Then what
   could not be established from the bundle.

## When the reader has no repository access

Fall back to the retired appender's mechanism, and copy the exact source into the document:

- **What to copy:** whole files when they are small or central, and `sed -n '<a>,<b>p'` ranges
  otherwise.
- **How to present each block:** a short title, its `Path: path:<a>-<b>` line, and a
  language-tagged fence.
- **What to check afterwards:** run `wc -l`, `sed -n '1,120p'` and
  ``rg -n '^## |^Path:|^```'`` over the result. These show that the headers, paths and fences
  landed.

## What may cross, and what may not come back

Rule 4 of `AGENTS.md` is about what reaches models inside the loop: the Builder, the Main Judge,
the diagnosis reader, the advice packet and every authoring prompt. The Oracle is none of those. It
is an operator-side analyst, and the operator has sent it `--medium` bundles, which carry verifier
output, traces and hidden expectations. That happened on 2026-09-27, and again on 2026-09-28 with
"zip latest traces to accompany".

The exposure runs the other way. An Oracle answer may quote a failing location or a reference
value, so it never reaches a model-visible surface, whether directly or through a paraphrase: not a
Builder prompt, a starter, a fixture, a reviewer orientation, or an Epoch Reviewer or WRI lane 7 or
23 packet. Those isolated lanes keep their own evidence paths. A handover goes to the Oracle, never
to them.

## Deliver, send and retrieve

Finish with four things in the reply:
- the absolute bundle directory;
- the zip path, its size and its file count;
- the path of `REVIEW.md`;
- one paragraph telling the operator how to present the handover.

That paragraph says to attach the zip, to paste `REVIEW.md` as the message, and which commits the
Oracle should open first. When the operator is on another device, send both files with
`SendUserFile`. Uploading is the operator's action; this skill produces local files and stops
there.

When the answer comes back, save it as `notes/oracle-<yyyymmdd>-<topic>-response.md`. Source-check
every claim that would change a decision before acting on it, and keep its disagreements and its
omissions. A response is neither a verifier verdict nor launch authority.
