# Running the lanes as native subagents

Load this when the operator wants the lanes run by Claude subagents in this session instead of Luna
sessions, or when `wri.ts launch` is not the route. `launch` is hard-wired to the Luna transport;
nothing here replaces it, and nothing here changes what a lane is asked or how `finish` reads it.

## The route

1. `read` the run as usual and edit `shared-instructions.json` before any prompt is written.
2. Write one prompt per lane with `build-manifest.ts --transport native` and the same
   `--snapshot`, `--worktree`, `--out <review>/lanes`, `--shared-instructions` and `--effort` that
   `launch` would pass, using `--sessions` as a comma list of single lanes (`--sessions 1,5,8`),
   one for each lane whose trigger fired. `1-38` is refused (the isolated lanes sit inside it) and
   `--auto` writes `lanes_NN_MM.md` files that the pairing script does not read. Never pass
   `--launch`: it is valid only with `--transport luna`. Each `<review>/lanes/prompts/lane_NN.md`
   is a whole prompt: the shared instructions, then the lane.
3. Group the lanes with `scripts/compose-native-pairs.py --lanes <review>/lanes --agents N`, where N
   is the total number of subagents the operator asked for ("use all lanes with 8 subagents" is
   `--agents 8`). `references/lane-groups.json` already says which lanes read the same bytes, as a
   tree of themes, and which lanes always run alone (7, 23, 29, 30, each in its own subagent and
   counted in N); the script prunes lanes that have no prompt, cuts the rest into the remaining groups
   by splitting the largest group in two until N is met (`--components K` instead splits until no
   group holds more than K lanes), prints and writes the plan as
   `<review>/lanes/pairs/groups.json` before composing, and writes one prompt per group under
   `<review>/lanes/pairs/`. `--pairs 1+8,2+34,5` names groups by hand instead. `--sessions` only
   groups contiguous lanes, which is why the script exists. Read the plan, hand each composed
   file to the Agent tool as the whole prompt, and do not write a prompt that says "read these
   files": the subagent then spends its first turns assembling what the script assembles in one second.
   The script exits 1 and names the group when a composed prompt lost the shared instructions (no
   `## Run overview`), an isolated lane's prompt gained them, or a prompt kept a second `Authority`
   paragraph, so read its exit code, not only its table. An isolated lane may share the launch: the
   manifest then puts the blind file first in every prompt and the shared instructions inside each
   open lane's task, and the script cuts them on their own heading, not on `# Your assignment`.
4. The composed Authority paragraph is report only. A native lane's default authority lets it
   commit repairs in its own worktree; withhold that until the primary has adjudicated. It also
   tells the lane to write `owner:` only on a finding's own owner line (see the validator note
   below) and, with `--remote-host`, to read a non-mirrored tree read-only over ssh.
5. Each subagent writes `<review>/lanes/native-output/lane_NN.md` itself. Its reply is a summary;
   the file is the report. `finish` reads the files.

A group of eight lanes or more draws a warning (the reports get thin and the lanes stop being independent); say the effort you wanted: the Agent tool's effort for a
subagent cannot be enforced, so the report says what ran, not what was asked.

## Several runs

When the operator names several runs, or asks which findings recur, one subagent reads its lane
group in every named run (see [Several runs at once](../SKILL.md#several-runs-at-once)). A
subagent's load is lanes times runs: three lanes over three runs is nine, and two over two or two
over four are as valid. Write each run's prompts exactly as above, one review per run; the same
orientation and moved variable written into each run's `shared-instructions.json` render once for
the set, and anything that differs stays under its own run. A probe-tier run is read and given no
prompts. Then:

```text
bun .claude/skills/whole-run-investigation/scripts/wri.ts read <full run id> --out <review A>
bun .claude/skills/whole-run-investigation/scripts/build-manifest.ts --transport native \
  --snapshot <review A>/snapshot --worktree <A's measured checkout> --out <review A>/lanes \
  --shared-instructions <review A>/shared-instructions.json --sessions 1,2,3,... --effort max
  # likewise for each run; a probe-tier run stops after `read`
python3 -I .claude/skills/whole-run-investigation/scripts/compose-native-pairs.py \
  --runs <review A> <review B> <review C> --components 9 --out-dir <multi> [--prior <earlier note>]
  # hand each <multi>/<group>.md to the Agent tool; each writes <multi>/native-output/<group>.md
bun .claude/skills/whole-run-investigation/scripts/validate-reports.ts --groups <multi>/groups.json
```

`--components K` cuts the lane-group tree until each subagent holds at most K lanes times runs, so a
theme stays together while it fits; `--agents N` fixes the count instead. The lanes in `alone`
stay per run, since their evidence boundary or scratch belongs to one run: compose those with
`--lanes`. Each lane names, per run, the trigger it started from, why it has none, and any earlier
report of it under that review, which the subagent reads as a lead, not a receipt. Runs measured at
different commits are named with each commit and checkout, and the subagent reads each run's source
at its own. `--prior` hands over an earlier reading of the same runs to reconcile with after the
sort. Each finding carries `owner:`, `pile:` (`every`, `absent` or `unsaid`) and `outcome:`
(`patch`, `decision`, `prediction` or `drop`), which the validator reads; `finish` does not read a
multi-run review, and the primary's note joins it to the per-run ones.

## What `finish` rejects, learned the hard way

- `validate-reports.ts --tasks` needs an absolute path. A relative one is refused.
- The validator takes the first word after any `owner:` on any line as the finding's owner. A
  sentence such as "the projection owner: add a typed gap" parses as owner `add` and the report is
  refused. Reword the sentence; never rewrite an owner line to satisfy it, and say in the note which
  report was edited and how.
- Each `## lane_NN` needs `### Started from`, `### Evidence read`, `### Findings` and
  `### Not established`, once each, in that order. A lane that finds nothing writes that, with the
  `Not established` list still filled in.
- Dry-run the validator on the partial set before the last report arrives
  (`validate-reports.ts --tasks <abs>/lanes/tasks.json --out <scratch>.json`), so a malformed
  report is found while its author still has context.

## Mirrored runs

A run mirrored from another machine lacks `.oss/` and `workspace/.toolchain`, so every version's
`.toolchain` link dangles by construction. Two consequences. A lane's "toolchain unreadable" is a
mirror fact until a read-only `ls` or `sha256sum` on the origin machine says otherwise, so the
orientation names the host and the lane prompt allows read-only commands there. And a lane that
writes anything there, even a stray `> file` inside an ssh command, has written: forbid redirects
in the prompt, and `ls` the origin's `/private/tmp` after the lanes finish. The primary moves any
stray file to the Trash on that machine and never empties it.

## Before the lanes run: what the primary missed this way last time

These are the omissions that cost a re-launch or a re-read on the first native run
(`standard-sonnetxhh-20261003T164336992Z-d5cfcb1`). Check each before launching.

- **Prompts that assumed the lanes were already composed.** The first plan was 35 single-lane
  prompts "written, nothing launched". A prompt a subagent can run is the composed pair, so compose
  first, then launch; do not report prompts as the deliverable.
- **No decision on grouping before the operator asked.** Group by evidence shared, not by lane
  number: 5 and 33 read the same limits and reference, 35 and 38 the same verified fails. The groups
  for any N are in `references/lane-groups.json`; lane 31 stays out of lane 1's group because lane 1's
  report is one of lane 31's triggers.
- **Prior reviews of the same run.** Check `notes/` and the memory index for an earlier analysis
  (for example one made before the run finished) before you launch. Compare its claims to the
  lanes' only after the lanes are in, with the later analysis the more detailed side.
- **A lane's denominators.** A lane's counts are claims. Recount case partition, review counts and
  every "N of M" the synthesis will lean on from the recorded rows before they enter a note; one
  lane in the last run quoted "10 of 19 reviews incomplete" where the rows say 7 of 18 authoring,
  or 9 incomplete and 1 failed of 24.
- **Reading-dependent fails.** Before calling a verified fail a wrong answer, check whether the
  failing rule's published sentence admits a reading the evaluator does not apply. Lane 38 reads
  this; lane 7, which a missing trigger can leave unlaunched, is the independent check. If lane 7
  did not run, say so as a limit of the note.
- **A snapshot that lost a view.** The `prose-posture` JSON view can crash (Bun SIGABRT) and
  leave `snapshot-status.json` with `complete: false`, while the same classifier's text view in
  `<review>/posture.txt` still completes. Open `posture.txt` before calling posture unobservable
  (last time it was thin, not absent), and carry the thinness under what is not established.
- **A reader's `?` is one battery's gap, not the run's.** Digest block 1 printed `?` for every check
  of the base battery only, because that claim was refused and has no groundings; the later
  batteries printed the real kind. Read each battery's block before generalising from one.

## After adjudication

Triage the confirmed defects against the latest stacked PR state, not the run's source commit.
Fetch first: a stale `origin/<head>` names an old stack. The run's source usually sits a few commits
off the stack head, so `--is-ancestor` answers nothing; `git diff --quiet <stack head> <run source>
-- <owner files>` is how to learn a defect there is still at the stack head. Fork the stack head into a local worktree, read each cluster of
findings there, and append each fix to the open PR that owns the area (never a new stacked PR; never
a push without the operator's word). [The plan questions](improvement-plan-questions.md) ask what
each fix changes; ask the same of every item a triage agent proposes.
