# Levers: what an iteration can tune

An iteration's plan has two halves. **Repairs** fix a confirmed defect. **Tunings** move a lever
the investigation's evidence points at, even where nothing is broken: a prompt that leaves a seat
short of a fact, a gate that refuses more than it protects, a term that costs power for no honesty.
The operator's word of 4 November: an iteration should "not only fix basic bugs" but "really assess
more deeply how to tune the prompting etc adding prompt feedback or removing strict gates".

Read the table below against the investigation's binding link ("The walk" in `SKILL.md`). For
every lever whose evidence column the run shows, the plan gets one row: tuned, or kept with one
sentence a reviewer can check (simplify, "The disagreement test"). A plan with repairs only names
the three levers that came closest and why each stays.

Four rules hold for every row:

- **Facts, never a course or a target** (`AGENTS.md`, section 2, consequences 1 and 2). Feedback
  added to a seat states what was measured, never what to aim for.
- **Domain-agnostic.** A tuning that helps one pack by naming its field belongs nowhere; a ladder
  rung or a worked example is chosen from a field no live pack uses.
- **The wall holds byte for byte** (rule 3). A change to what a Builder or a solver reads says in
  the pull request how `test/builder.test.ts` and `test/builder-led.test.ts` still hold.
- **Decided by its owner.** Rows marked *operator* are asked with their evidence and a
  recommendation (`AGENTS.md`, section 3); the rest are the iteration's to make.

Before spending on a tuning, prove it at the smallest layer that can decide it
(system-path-simulation): a replay for a reading rule, a rehearsal for a move, a pair of live seats
for a prompt. Then the next fresh run at the pull request's head measures it, with a prediction.

## The exam side: supply

| # | lever | owner | the evidence that selects it | decides |
| --- | --- | --- | --- | --- |
| E1 | The writing prompt's "How hard": what makes a task leave the reference room | `src/examiner/prompt.ts` | the reference valid in every solve; ties on the objective; `TIES BETWEEN VALID ANSWERS` on most tasks | iteration |
| E2 | What the Examiner is told of the reference's outcomes: per-task margins, turns, the objective's spread between its two solves | `heard`, `measuredLine`, `src/examiner/record.ts` | an Examiner session writing again what the reference closed; `OUTCOMES BY SESSION` reading `reference-every` | iteration |
| E3 | The ladder's worked examples and their rungs | `LADDER`, `FIELDS`, `src/examiner/ladder.ts` (examiner-complexity, `rungs.ts`) | blind reach grades under the run's outcomes; tasks graded high that the reference closed | iteration |
| E4 | The drafting prompt's rules on an exam's shape: whether it declares an objective with room, how many families | `src/examiner/draft.ts` | a drafted objective that ties every valid pair; every check decided by its author (`INSTRUMENT AUTHORED`) | iteration |
| E5 | The draft gate's strictness: what refuses a draft, and how many tries | `draftFaults`, `controlFaults`, `src/examiner/draft.ts` | an ending `exam` with nothing compared; a refused draft whose fault a capable model would have handled itself | iteration; removing a refusal names the dishonest reading it no longer prevents |
| E6 | The task gate (`propose_tasks`): what holds a task out on its shape | `refusalOf`, `src/examiner/write.ts` | refusals at `propose_tasks` beside a thin frontier | iteration |
| E7 | When an Examiner session opens and how long it may run, against the clock to the next comparison | `src/campaign/decide.ts` (the `tasks` and `short` rows), session limits | hours to the next comparison beside the tasks it admitted; an Examiner session never finished | iteration, unless it moves a campaign's limits (*operator*) |
| E8 | The comparison floor and the retained share | `comparisonFloor`, `src/campaign/admission.ts`; the draw, `src/kernel/reports.ts` | `no-room` or `short` endings with a frontier just under the floor | *operator* (a term) |

## The build side: climb

| # | lever | owner | the evidence that selects it | decides |
| --- | --- | --- | --- | --- |
| B1 | What the Builder hears of a practice solve: the trace, the ending, the verifier's measure | `src/builder/tools.ts`, `src/builder/past.ts` | practice failures the next harness repeats; a Builder that never read a trace (`SHELL COMMANDS`) | iteration (wall test) |
| B2 | The Builder's opening and the move table's fixed advice | `src/builder/prompt.ts`, `src/campaign/decide.ts` | moves the table did not name (`asked`); a compare of an unchanged harness; idle sessions | iteration |
| B3 | What a Builder carries from earlier sessions and kept harnesses | `src/builder/memory.ts`, `src/builder/kept.ts` | a session undoing what the last one kept; `MEMORY.md` growing without use | iteration |
| B4 | Practice release: how many, which first | `releaseOrder`, `src/kernel/reports.ts` | a Builder starved of failures while held-out tasks have room | *operator* if it moves the half; iteration within it |
| B5 | The Builder session's turns and hours | `tools/d2/harness-builder.ts` | sessions ending at their limit mid-change; most of the clock in one session | *operator* (a limit) |

## The solve

| # | lever | owner | the evidence that selects it | decides |
| --- | --- | --- | --- | --- |
| S1 | The starter: its guide, programs and tools | `src/harness/starter.ts` | the starter failing for want of a generic tool every domain needs | *operator* (what a solver is given) |
| S2 | A solve's limits: turns, minutes, prompts | `LIMITS`, `tools/d2/campaign.ts` | `turns-ended` or `wall-ended` shares on both sides | *operator* |
| S3 | The shell and the wall's grants | `src/tools/command.ts`, `src/wall/` | `sandbox-crash` or `broken-harness` that names a refused path a solve needed | iteration if it widens without opening a protected root (consequence 6) |

## The reading

| # | lever | owner | the evidence that selects it | decides |
| --- | --- | --- | --- | --- |
| R1 | The tally's weights | `WEIGHTS`, `src/kernel/compare.ts` (promotion-tuner replay) | steps carried by the objective while A/A comparisons split on it | *operator*, with the replay |
| R2 | The objective gap floor | `ROOM`, `src/kernel/compare.ts` | the A/A splitting past 1% on many tasks; or real gaps tied under it | *operator*, with the replay |
| R3 | Solves a side and the level | `SIZE`, `src/kernel/size.ts`; `--level` | untied tasks too few for any step at the size (`size.ts`) | *operator* |
| R4 | When the owed starter comparison runs | `heldSince`, `src/campaign/decide.ts` | hours of an epoch spent on confirmation before the next candidate | *operator* (a trade-off) |
| R5 | Improvement and supply patience | `stopRule`, `src/campaign/admission.ts` | endings `stop` while the frontier still grows | *operator* |

## Verdicts

| # | lever | owner | the evidence that selects it | decides |
| --- | --- | --- | --- | --- |
| V1 | The Referee's prompt and the evidence each ruling must carry | `src/referee/referee.ts`, `src/referee/probe.ts` | `unclear` rulings setting tasks aside; refused rulings | iteration |
| V2 | The check-defect stop | `src/campaign/admission.ts` | runs ended `check-defects` on few defects | *operator* (a term) |
| V3 | Admitting authored checks | `tools/c/accept.ts --admit` | checks decided by their author's computation that refuse nothing | *operator* (rule 10) |

## The host and the economy

| # | lever | owner | the evidence that selects it | decides |
| --- | --- | --- | --- | --- |
| H1 | The solve queue's wait for load | `campaign.waited`, the solve queue | waits over 15 minutes; a comparison's hours mostly waiting | iteration for the queue's reading; *operator* for placement |
| H2 | Which seat spends the dollars | `billOf`, `src/kernel/meter.ts`; the seats' prompts | `SPEND LED BY A ROLE`: one seat above two thirds of the bill | iteration (prompt length, tool results); *operator* (model) |
| H3 | What a seat is told at all: prose that repeats, facts no decision reads | every seat's prompt | a prompt that grew across releases with no reading moved (simplify, H6) | iteration: removing a sentence is a tuning too |
