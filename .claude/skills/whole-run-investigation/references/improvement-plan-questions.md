# Questions an improvement plan must answer

Load this when the operator asks, after a review, what to change next: "start building out an
improvement plan", "patch what is simple", "did we fix all these problems". The ten questions below
are the ones the operator keeps asking after a review. They are answered from the archive already
written, from the investigation notes under `notes/` and from Git; none of them needs a new run.

The boundary does not move. WRI stays advisory. These answers are input to
`run-improvement-campaign`, which owns the choice of the next experiment and the authority to
launch it. Where a question below names a lane, it means the lane's frozen report in
`luna_syntheses.md`, not a new session.

## Is there anything here worth planning around

1. **Was this run worth reviewing at all?** Identify a consequential question the available
   evidence can settle. A pre-battery refusal, a useful candidate or an interrupted repair can
   expose a shared defect without twenty submits or several epochs. A low opportunity count limits
   claims; it does not erase an executed finding. Stop further review when no remaining question
   can change an owner, a scope claim or the next investigation.

2. **Was the failure the product or its execution environment?** Follow the typed evidence to its
   owner: environment startup, generated build, shared contract, runtime and deliberate
   interruption are different causes. No measured battery establishes no capability denominator,
   not a launch-path diagnosis. Preserve useful candidate evidence before selecting the smallest
   owning repair. Lane 25's failure mechanism and the `walls` lane's classes are where the
   ownership was already read.

3. **Is the proposal a real fix, or a new file?** State, for each item, the line that decides
   differently afterwards. "You're only adding a file — how does this suddenly improve the
   system?" is the standing test. An item with no changed decision does not enter the queue.

## Did what we already changed pay

4. **Did the last round of fixes actually work, and which should be reversed?** Name the PR that
   carried each earlier change, the run that would show it working, and what that run showed. Say
   plainly whether its branch had an eligible opportunity and was reached; lane 21's reach reading
   over the `delta` lane and `UNREACHED CHANGED SAFEGUARDS` answer the second half. No opportunity or an
   unreached branch leaves the change unexercised. A reached branch with no observed benefit needs
   a bounded attribution check; propose reversal for demonstrated harm or unnecessary cost, not
   merely an unchanged aggregate score. This is the operator's most frequent post-review question
   and it is asked about specific PR numbers, so answer with them.

5. **Did the mechanism we invested in raise the score?** Ask it of the specific mechanism, not of
   the system. Rebuild is the standing example: a round whose candidates move only a configuration
   file while the task, agent and tool identities stay byte-identical, and whose batteries then
   fall, has changed the measurement without proving better solving. That is evidence against the
   route rather than for it. Lane 20 owns the attribution of what moved.

6. **Did anything change between rounds?** A tree that records `candidate-unchanged` round after
   round, or a final session that accepts a tree with `changedPaths: []`, has spent rounds on
   nothing. Before proposing more freedom or more rounds, say what stops a round that changed
   nothing; `REPEATED CONDITION` at lane 20 and the `handoff` lane's census table, which lane 17
   reads first, say whether this run had one.

## What is the cheapest way to close it

7. **Can the system fix this itself instead of us paying for another batch?** The operator's
   instinct is leniency: "agents can fix things easily if they see a clear problem". Test it
   against the run. When every round routes blocking feedback to an owner no authoring session can
   write, the sessions keep submitting and the gate keeps refusing without anyone reaching the
   file. Leniency helps only where a writable owner exists; otherwise it buys longer silence. Lane
   14's routing reading and `FINDINGS WITHOUT PROPOSED OWNER` say which case this run is.

8. **Can the fix be simulated before it is paid for?** Where `system-path-simulation` can exercise
   the changed path, say so and give the command. The operator asks for a before-and-after
   simulation on nearly every plan.

9. **Did the harness find its own grounding, or was it handed one?** Two recorded shapes answer
   this question. In one, the generated tools hand the agent the checker's own simulator, so every
   case passes on the first attempt and no battery finds a limit; `CHECK TOOL IN SOLVER TRACE`
   and lane 23 are where it shows, and lane 8 where the brief itself published the recipe. In the other, a host pre-check probes for a named tool before the
   Builder has discovered one, which the operator removed because the Builder should find its own
   tool. Report whether either shape appears in this run.

10. **Does the lesson survive outside this domain?** State each queued fix as the general shape,
    not the instance. A checker enforcing a field name the public brief never states and a checker
    enforcing an undisclosed call convention are one shape: a rule the public brief never
    published. Fix the shape once; the instance list is how you check the fix, not what it
    repairs. Read the earlier notes for the same shape before writing the fix, because the shape
    has usually been named before and the question is why its remedy did not hold.

## Standing caution

Review is not free and is easy to add to. A campaign can spend more than half its turns on review
and have two of them change a decision; the `yield` lane, lane 24 on `REVIEW TURNS EXCEED SOLVER
TURNS` and lane 12 on what the reviewer's duties produced say whether this one did. An improvement plan that answers a question by adding another reviewer
should say what it expects that reviewer to change.
