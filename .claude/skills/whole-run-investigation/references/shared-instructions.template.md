<!--
The shared instructions every open lane prompt of this investigation carries, whole and verbatim,
in every reading: per-run, cross-run and multi-run. `wri.ts start` filled in the run table; write
the two marked sections before `wri.ts lanes`, and edit any other line you want every lane to read.
Comments like this one are dropped when the prompts are built. A `##` section left blank refuses
`wri.ts lanes`; delete its heading to drop it on purpose. Each run's recorded facts reach its lanes
separately, as `## Run overview`, so do not copy them here.
-->

## Orientation

<!-- AUTHOR: the operator's question, in your own words, and what each reader should look at first.
Orient, never conclude: name the question and where its evidence is, not the answer. At most about
twenty lines. Never quote campaign text. -->

## The moved variable and prior state

<!-- AUTHOR: what changed between these runs and the ones before (source, model, effort, domain),
the earlier findings or fixes this investigation checks, and what would falsify them. Write "none"
when nothing moved. -->

## Runs under review

{runTable}

Each run's source is the commit in its row. Read it in the checkout named for that run, at that
commit; never in the main checkout, whose tree may have moved on.

## Hard rules

- Never quote task content, request text, prompts, review or advice prose, Builder prose, trace text,
  or any domain text from a campaign record. Report counts, ids, digests, paths and line numbers, and
  describe mechanisms in your own abstract words.
- Run no git command inside a campaign workspace: even `git status` writes a lock file.
- Never run a tool with its working directory inside `campaigns/`, and never write there: a tool's
  log or cache lands in its working directory.
- Write your report file early, as soon as you have its heading, and append to it as you go, so an
  interrupted session still leaves its findings.
- You are independent: open no other session's prompt or report and no synthesis of this
  investigation unless your assignment names it as a lead, and do not coordinate with other sessions.
- Read source at the run's own commit, in the checkout named for that run, never in the main checkout.
- The orientation and the moved variable orient and do not conclude: contradict any line of them
  with evidence and report that as the finding.
