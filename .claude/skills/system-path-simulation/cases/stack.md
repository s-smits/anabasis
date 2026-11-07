# The open stack

Before a landing, the operator may ask for the stack's most important changes to be simulated. Each
runs on a fork of the pull request that makes it, one after another, while the stack's other work
goes on. Each simulation is one of the other cases.

## 1. Choose what to simulate

Read the stack (`bun .claude/skills/stack-pr/scripts/stack.ts`) and its bodies, and take as many
changes as the operator names, two by default, ranked by what they move among the four factors
(`AGENTS.md`, section 1): first what a model seat reads, may do or is held to; then what a
comparison counts or refuses; last readers, tooling and documents, which a replay or test settles.
Simulate only what the pull request left unproved, which is usually what a real model does with it.

## 2. Fork each at its head

```sh
git worktree add --detach ../anabasis-sim<N> <head of #N>
cd ../anabasis-sim<N> && bun install --frozen-lockfile
```

The fork holds everything beneath the pull request, which is what lands with it. Never simulate in
the pull request's own worktree, a run's, or on its branch.

## 3. One prediction file before the first seat

Write every simulation's predictions, seed and line of difference in one file (rule 1). The source
run's own recording at the same position is the before arm: seed from the newest run that stood
there, cut right before the session or ruling in question, and name every other difference, such as
effort or login. Where no recording stands at the commit beneath the change, fork that commit
([before-after](before-after.md)).

## 4. Seat them one after another

One live seat a host at a time, each as one background `live-seat.ts start` on the operator's login,
model and effort (`--login N`), with its source's flags (an Examiner session takes its
`exam.started` limits). The Referee is seated with `scripts/referee-seat.ts` as `start`'s command, on
a seed cut right before the ruling.

## 5. Keep the stack moving

Follow each seat with `live-seat.ts watch --seat <prefix>` in a Monitor or `live-seat.ts due
<prefixes> --hook` as a Stop hook ([live-seat](live-seat.md)). A defect in or below the simulated
pull request is fixed in the commit that brought it, on the operator's word, and the pull requests
above are replayed and pushed with a lease (stack-pr, section 8); rerun the seat at the fix only if
the fix changes what it measures. A finding outside the stack is a new pull request on its top, and
the landing's proof restarts from the lowest moved commit.

## 6. Report each change

One result per change (`SKILL.md`, "The result"), then one line on whether the stack should land as
it is and what was fixed while the seats ran. Trash the forks and seeds (rule 10).
