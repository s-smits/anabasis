# The open stack

Before a landing or a release, the operator may ask for the stack's most important changes to be
simulated. Each one is simulated on a fork of the pull request that makes it, one after the other,
and the work of the stack goes on while they run. This case is the order of that work. Each
simulation inside it is still one of the other cases.

## 1. Choose what to simulate

Read the stack (`bun .claude/skills/stack-pr/scripts/stack.ts`) and every body on it. Rank the
changes by what they move among the four factors (`AGENTS.md`, section 1), and take as many as the
operator names, two when they name no number:

- first, a change to what a model seat reads, may do or is held to: a prompt, a tool, a gate, the
  Referee's evidence;
- then a change to what a comparison counts or refuses;
- last, a reader, the tooling and the documents, which a replay or a test already settles.

For each, write down what its pull request already proved, a replay or a test, and simulate only
what that left open, which is nearly always what a real model does with the change. A change whose
question a cheaper case answers takes that case and no live seat.

## 2. Fork each at its pull request's head

```sh
git worktree add --detach ../anabasis-sim<N> <head of #N>
cd ../anabasis-sim<N> && bun install --frozen-lockfile
```

The fork holds everything beneath the pull request as well, which is what lands with it. Never
simulate in the pull request's own worktree, in a run's, or on its branch: a seed and its outputs
stay in the fork, which is trashed at the end.

## 3. One prediction file, before the first seat

Write every simulation's predictions in one file before the first one starts (rule 1), each with
its seed and the one line of difference. The source run's own recording of the same position is
the arm at the old code: seed from the newest run whose log stood there (rule 2), cut right before
the session or the ruling in question, and name every other difference from it, such as the effort
or the login the operator asked for. Where no run's recording stands at the commit beneath the
change, the before arm is a fork of that commit ([before-after](before-after.md)).

## 4. Seat them one after the other

Run one live seat at a time on a host, each as one background `live-seat.ts start` on the login,
model and effort the operator named (`--login N`). A seat's flags are its source's: an Examiner
session takes the limits of the `exam.started` it replaces. Two seats side by side share the host's
load and so each other's walls.

The Referee alone is seated with `scripts/referee-seat.ts` as the command `start` runs, on a seed
cut right before the ruling to be asked again. It loads the campaign's code from the fork, so one
copy serves any commit. Each ruling costs a few dollars and well under an hour.

## 5. Keep the stack moving while a seat runs

A seat runs for minutes to hours. Use them:

- Read the seat's events as they land against the predictions, and the source's arm beside them.
  `live-seat.ts watch --seat <prefix>` feeds them to a Monitor; `live-seat.ts due <prefixes> --hook`
  as a Stop hook brings back whatever landed while the turn was on other work, so a fix lower in
  the stack never leaves a seat's gate or ruling unread (`cases/live-seat.md`).
- A defect found in the pull request being simulated, or lower in the stack, is fixed in the
  commit that brought it, on the operator's word for the simulation; replay the pull requests above
  it and push each moved head with a lease (stack-pr, section 8). The seat goes on at the commit it
  started at; run it again at the fix only where the fix changes what it measures.
- A finding outside the stack's changes is a new pull request on its top.
- The landing's proof starts again from the lowest commit a fix moved, and the commits beneath it
  keep their passes.

## 6. Report each change

Give each change its own result (the six parts of `SKILL.md`, "The result"), then one line on
whether the stack should land as it is, and what was fixed in it while the seats ran. Trash the
forks and seeds once nothing reads them (rule 10).
