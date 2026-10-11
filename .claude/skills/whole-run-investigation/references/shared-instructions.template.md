<!--
The shared instructions every open lane of this investigation carries, whole. `wri.ts start` filled
in the campaign's row; write the two marked sections before `wri.ts lanes`, and edit any other line
every lane should read. Comments like this one are dropped when the prompts are built. A `##`
section left blank refuses `wri.ts lanes`; delete its heading to drop it on purpose. An isolated
lane is given the campaign's row and the hard rules, and neither of the two sections you write.
-->

## Orientation

<!-- AUTHOR: the operator's question, in your own words, and where its evidence is. Orient, never
conclude: name the question, not the answer you expect. At most about twenty lines. Quote nothing
from the log. -->

## The moved variable and prior state

<!-- AUTHOR: what changed between this campaign and the one before it (the checker, the host's
code, the model, the Builder's or the Examiner's prompt), the earlier findings this investigation
checks, and what would falsify each. Write "none" when nothing moved. An earlier diagnosis goes here
as a hypothesis, never above as a premise. -->

## Campaign under review

{campaign}

The log is the campaign's whole record: one event a line, append-only. Its folder also holds
`checks/`, the check program as it was staged, and `states/`, every harness state by digest. A
round started by `bun run runs launch` left `launch-<session>.json` there as well: the flags it was
given, the commit and the load it started under, with its output beside it. Read all of them; write
to none.

## Hard rules

- Quote nothing the walls keep apart: no task's text, no answer, no hidden value, no check's failure
  text, no prompt, no passage of a trace, no ruling's prose. Report event kinds, solve
  ids, the first eight characters of a version or digest, check ids, counts, paths and line numbers,
  and describe a mechanism in your own words.
- Never write under the campaign's folder, and never append to a log. Open both to read. Scratch
  goes in a temporary directory of your own.
- Run no command with its working directory inside the campaign's folder: a tool's cache or log
  lands where it runs.
- Start no solve, no Builder or Examiner session, no round and no check run. `wri.ts grade` is the
  one exception, where your lane names it, and it writes nothing.
- Write your report early, as soon as you have its first two lines, and append as you go.
- You are independent: open no other lane's prompt or report and no synthesis of this investigation.
- Read source in the checkout the campaign's row names. Where that row says the last condition ran
  under another host hash, every statement you make about source is about this tree and may not be
  what ran: say so beside the statement.
- Your report is for the operator and the primary reviewer. It is never given to a Builder, an
  Examiner or a Referee, and you address none of them.
- The orientation and the moved variable orient and do not conclude: contradict either with
  evidence and report that as the finding.
