# Lane sessions that follow the evidence and choose their lanes

Status: present in source on #580 (3 November 2026): the primary's section in the shared
instructions, a lane prompt that lets a session follow a problem and leave a lane `omitted`, and
`collect` counting omitted lanes apart and naming one whose trigger fired. Not yet exercised: the
jobstat investigation of 3 November was built before it. The pair of investigations under "Limits
known now" is not run.

## The question

An investigation packs its lanes into a few sessions (`--agents N`), and each session works through
every lane it was given, one report a lane, in the catalogue's order. On a short run most lanes
have little to read, while a problem one lane finds often runs past that lane's question. A session
that knows what the primary already settled, may follow a problem where it leads, and may write
only the lanes that matter for the runs it reads should report more of what matters at the same
cost.

## Intended changes

1. **Say what the primary already read.** `shared-instructions.md` gains a section the primary
   writes before `lanes`, after the orientation and the moved variable: the components the primary
   has already investigated (a reader's count, a source path, a mechanism it checked), each with
   its evidence. A lane builds on it or contradicts it with evidence, and does not read it again.
   As with the orientation, it names what was checked and never the answer a lane should reach
   ("A lane told what to find finds it", the skill's "Editing the shared instructions").
2. **Let a session follow a problem.** Where a lane's evidence leads past its question, the session
   follows it and writes the finding under the lane closest to it, or under a section of its own
   named for the owner, with the same five fields. The hard rules stay as they are: nothing that
   crosses a wall is quoted, nothing is written under a campaign's folder, and no solve, session,
   round or check starts.
3. **Let a session choose its lanes.** A session given 12 lanes may write a few of them, the most
   important for the runs under review at the point their logs have reached (a short run with no
   promotion needs other lanes than one past its third). Each lane it leaves out gets a report with the verdict
   `omitted` and one sentence why: its question does not arise in these campaigns, the primary's
   section already settles it, or another lane of the session covers it. `reportOf`
   (`tools/wri/investigation.ts`, `VERDICTS`) accepts the verdict, `collect` counts omitted lanes
   apart from read ones, and the synthesis lists them, so a reader can see what was not read.
4. **What stays as it is.** Lanes 5 and 19 stay isolated: each freezes its result before reading
   anything that could lead it, so neither is given the primary's section or another lane's
   findings. A standing lane may be omitted only with its reason, and the synthesis says which
   standing lanes went unread.

## Limits known now

- The primary's section can anchor every lane on the primary's view, which is the failure the
  orientation's rules guard against. The test is a pair of investigations of one run, one with the
  section and one without, compared on findings confirmed in vetting.
- An omitted lane may be one whose trigger fired. `collect` should say so beside it.

## How it came to be

On 3 November 2026 an investigation of two ESP32 campaigns that had no promotion ran 24 lanes in
2 Opus sessions of 12 lanes each.

- **02:30.** The operator: "for next time: hmm i feel like WRI can be improved by more freely
  allowing the subagent to investigate problems along the way based on the steering / already
  investigated components by the main agent before launching (shared_instructions.md) and that it
  can omit lanes freely during investigation".
- **02:32.** The operator: "that it can just write a few lanes out of all 15 for example if those
  are the most important", "for those Runs", "in this point of time".
