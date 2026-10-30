Read this when a design question asks whether code or a model should decide something, or before you
add a limit, a classifier, a grant of the wall or a mechanism. It holds `AGENTS.md` section 2 whole.

## 2. The stance: code owns the conditions, models own the content

From the outside Anabasis v2 is a workflow; inside its steps the agents are free. Most design
questions are settled by asking which side of that split a decision falls on.

| Code decides | A model decides |
| --- | --- |
| Which move may start, and every refusal | What a harness contains, and when to request a campaign tool |
| Every limit of a solve and of a session | How a task is solved |
| The condition a solve runs under, and its identity | What a new task asks, within the contract |
| Whether an answer is valid | Whether a rejection was right (a ruling, with its required evidence) |
| The comparison, the tally and the test | Why a practice solve failed, read from its trace |
| What crosses the wall | Which failure to work on, and what to change |
| The dollar cap and what is charged to it | |
| The log: what is recorded, and its order | |

Code keeps the first column because a model cannot observe those facts, is itself the subject of
the decision, or because the value must be identical on both sides of a comparison. Models keep the
second because code cannot reason about a domain it has never seen. Seven consequences:

1. **Give a model facts, never a course.** The host says what happened: a tally, an ending, a limit
   and how much is used. A model told a course follows it instead of the evidence.
2. **Give an author facts instead of a target.** An author told a zone, a share or a count writes
   towards it, and one told each answer's distance from its limit moves the limits. So the Examiner
   hears what was measured on the reference side, with no number to reach (section 3, "What the
   Examiner reads"), and the solve budget, within which a better method answers what a worse does
   not. Which harness won each task it hears too: the operator accepted on 20 October that it may
   write towards the newest harness, the plainest signal of where the exam has fallen behind.
3. **Keep the Builder free.** It may change or rewrite anything in the harness. One limit stands:
   nothing in a harness answers a particular task, so no part names a task, copies its text or
   holds its answer. A program may search candidates and test them against the public rules; the
   solver writes and submits the answer (`src/builder/prompt.ts`). Add no second limit in a prompt
   or a check: one budget prices whatever a harness does.
4. **Keep code from choosing content just because reasoning about it is hard.** Code may validate a
   declared structure. A classifier in code deciding what a harness or task should contain is a
   model's decision made badly.
5. **Keep conditions out of a model's hands.** A model's reply never sets a score, a limit or an
   identity. The Builder may request a move, and code checks whether it may start. Where a model's
   output feeds a decision (a ruling), code states the evidence it must carry and refuses it
   otherwise.
6. **When in doubt, allow, and allow the whole.** A wall protects three things: the exam side's
   hidden values, the operator's credentials, and each seat's files from the others. Everything
   else is allowed by the simplest rule: reads open with the protected roots closed by name, and
   one root per seat it reads and writes whole, the host's own folder inside it excepted
   (`SolveDirs`, `src/tools/command.ts`). Grant the folder, never subfolders, a path per command or
   a single file: each narrower grant is one more policy to keep true on two operating systems, and
   on the record narrow grants ended solves by the dozen while no wide one leaked a hidden value
   (`7f0add79:docs/plan.md`, rows B10, B12 and B17). Narrow only where two grants collide (two
   solves writing one path in a shared `/tmp`) or the wider one would open a protected thing. Each policy has a wall test once per process (`walledBase`, `probeWall`; section 10).
7. **Take the simple path that reaches most of the result.** Each mechanism makes the next change
   harder to read, prove and undo. Prefer four fifths of the result for a fifth of the code: a
   plain mechanism writing events the readers can count beats a complete one nobody can check, in
   code, prompts, tools and skills alike (rule 13). Never so for the measurement's honesty: the
   wall, terms fixed first, fresh solves, the step test and the rulings (rules 3 to 8) are not
   traded for less code, since a false step costs more than all the code it saved.

