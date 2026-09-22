# Questions an improvement plan must answer

Load this when the operator asks, after a review, what to change next: "start building out an
improvement plan", "patch what is simple", "did we fix all these problems". The ten questions below
are the ones the operator actually asked across the 2026-08-24 to 2026-08-31 reviews. They are
answered from the archive already written and from Git — none of them needs a new run.

The boundary does not move. WRI stays advisory. These answers are input to
`run-improvement-campaign`, which owns the choice of the next experiment and the authority to
launch it.

## Is there anything here worth planning around

1. **Was this run worth reviewing at all?** Identify a consequential question the available
   evidence can settle. A pre-battery refusal, useful candidate or interrupted repair can expose a
   shared defect without twenty submits or several epochs. A low opportunity count limits claims;
   it does not erase an executed finding. Stop further review when no remaining question can
   change an owner, scope claim or next investigation.

2. **Was the failure the product or its execution environment?** Follow the typed evidence to its owner:
   environment startup, generated build, shared contract, runtime and deliberate interruption are
   different causes. No measured battery establishes no capability denominator, not a launch-path
   diagnosis. Preserve useful candidate evidence before selecting the smallest owning repair.

3. **Is the proposal a real fix, or a new file?** State, for each item, the line that decides
   differently afterwards. "You're only adding prompt-surface.json — how does this suddenly improve
   the system?" is the standing test. An item with no changed decision does not enter the queue.

## Did what we already changed pay

4. **Did the last round of fixes actually work — and which should be reversed?** Name the PR that
   carried each earlier change, the run that would show it working, and what that run showed. Say
   plainly whether its branch had an eligible opportunity and was reached. No opportunity or an
   unreached branch leaves the change unexercised. A reached branch with no observed benefit needs
   a bounded attribution check; propose reversal for demonstrated harm or unnecessary cost, not
   merely an unchanged aggregate score. This is the
   operator's most frequent post-review question and it is asked about specific PR numbers, so
   answer with them.

5. **Did the mechanism we invested in raise the score?** Ask it of the specific mechanism, not of
   the system. Rebuild is the standing example: in run22 the three candidates moved only
   `engines.json` while the task, agent and tool identities stayed byte-identical, and the batteries
   fell 17 → 6 → 2. That changes the measurement and does not prove better solving, and it is evidence against the
   route rather than for it.

6. **Did anything change between rounds?** truss-run1 recorded `candidate-unchanged` twenty-one times
   on one tree across fourteen invocations; run23's final session accepted a tree with
   `changedPaths: []`. Before proposing more freedom or more rounds, say what stops a round that
   changed nothing.

## What is the cheapest way to close it

7. **Can the system fix this itself instead of us paying for another batch?** The operator's
   instinct is leniency — "agents can fix things easily if they see a clear problem". Test it
   against the run: in run23 every round routed blocking feedback to an owner no authoring session can
   write, so seven sessions made 49 submits and 42 were refused without anyone reaching the file.
   Leniency helps only where a writable owner exists; otherwise it buys longer silence.

8. **Can the fix be simulated before it is paid for?** Where `system-path-simulation` can exercise
   the changed path, say so and give the command. The operator asks for a before-and-after
   simulation on nearly every plan.

9. **Did the harness find its own grounding, or was it handed one?** Two recorded failures illustrate this
   question. In w41b the generated tools handed the agent the checker's own simulator, so 150 cases
   passed on the first attempt and no difficulty level found a limit. In other runs the operator removed
   a host pre-check that probed for `arduino-cli` and `pio` by name, because the Builder should
   discover its own tool. Report whether either failure appears in this run.

10. **Does the lesson survive outside this domain?** State each queued fix as the general shape, not
    the instance. `id` versus `deviceId` in w47-sol and the undisclosed `lcd.setCursor` convention
    in run12 are one shape: a checker enforcing a rule the public brief never states. Fix the shape
    once; the instance list is how you check the fix, not what it repairs.

## Standing caution

Review is not free and is easy to add to. In one audited campaign, 351 of 660 turns were review and
exactly two changed a decision. An improvement plan that answers a question by adding another
reviewer should say what it expects that reviewer to change.
