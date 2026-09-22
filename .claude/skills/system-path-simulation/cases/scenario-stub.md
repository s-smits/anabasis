# Simulate a scenario with one stub

**Use this case when:** the question is whether a production path holds end to end when a real actor walks it, and one step — normally the model turn — can be stubbed with the exact bytes it would have returned. Includes the interior-decision rule and the optional model meta-test.

Most questions worth a simulation are not one fact. They are "does this path hold when a real actor
walks it", which one exported call cannot answer.

**Take the situation from a real run where one exists**, by the position section of `SKILL.md`; write it only where
none does. Either way it goes down first, in one or two sentences, in the actor's own voice: what
already happened, where the actor stands, what it is reaching for — "I adopted a 25-task harness at
level 0 and scored 23/25, and the selector now wants a climb against my own frozen bundle." A
scenario written this way names its own steps; "does `admitVerifierProposal` work" does not, and
produces a one-call check that proves nothing about the path.

**Then invoke the real steps, in the order production runs them.** Every defect these simulations
have caught lived *between* two steps. Run 67's climb break — a repair round inheriting the climb's
pinned difficulty contract — was visible only because the decision, the kickoff and the task
validator ran in sequence on one tree. That run predates 2026-09-04, when the repair experiment was
removed; the shape transfers, the move does not.

**Stub exactly one thing, and say which.** The usual stub is the model turn, and it has one interface:
`HarnessBuildOptions.builderRuntime` binds a scripted session (`test/helpers/scripted-builder-runtime.ts`)
into the real build stage, so the script edits the workspace and calls the real `submit` tool and
everything after that call is production. `test/full-run-scripted-loop.test.ts` is the smallest
complete round through that interface; `scripts/run-condition.mts --builder /abs/turn.mts` runs the
same shape over a seeded campaign. Everything else stays real — the loop, the probes, the evidence
record, the verifier host, the wall. The moment a second thing is stubbed, the simulation is
mostly measuring itself.

**Cover the scenario with several outcomes, hostile ones first.** The climb simulation ran eight;
six confirmed what was already believed, and the one where the adopted tasks were merely relabelled
found the break that would have spent a paid battery.

`references/e2e-examples.md` holds worked records of simulations that earned their cost, with the
steps each invoked and what each caught. If your plan is thinner than the thinnest of them — one
call, one assertion, one happy path — either the question was a single fact or the scenario is not
built yet. Re-read the named exports before adapting one: a signature that moved makes the example
a history entry rather than an instruction.

## Read the interior decision, not the exit

A scenario that prints only the top-level result proves reachability, not intent. Pre-register the
branch or value you expect — "the selector proposes climb" — and when the run answers, print the
deciding reader's own rows through the same exports the decision used: what it admitted, what it
excluded, and each exclusion's own sentence. Agreement without the rows is still unverified: the
right exit reached for the wrong interior reason will fail on the next state that separates them.

The recorded case: a probe replayed truss-w30's recorded state through `selectNextMoveFromDisk` and
got `stop: operator-input-required` where a climb was expected. The one-line exit could not say
why. Reading `readClimbBatteries` on the same state gave the interior in full — zero admitted
rows, one battery excluded as the unshipped variant, one excluded because its claim refused
`engine-profile-unpinned` — and that changed the follow-up from a source patch to an operational
fact: no campaign without an operator engine profile can enter the difficulty history, whatever the loop does.
The exit alone would have been reported as "the selector is broken". (That clause and its stop
were removed on 2026-09-02; the reading method is the point of the example.)

Two rules follow. Write the expectation down before the run, with the falsifier ("if it stops
instead, print the exclusion rows before concluding anything"). And when the result surprises,
trace one level down through the run tree's own exports before reporting — the deciding function
is named in the source; call it, do not re-derive its answer from prose.

## Swap the stub for the model: the optional behaviour meta-test

A cleared scripted-stub scenario proves the mechanism — gates, walls, recording, routing. It says
nothing about judgment: which files the model reads, what it concludes, whether its output passes
the admission checks. When the interface under test is a model seat, re-run the same staged scenario with
the one stub replaced by the production session factory and nothing else changed; because the
staging is byte-identical, whatever differs is the model's behaviour.

Preconditions, in order: the mechanism scenario cleared first, since a live turn on a broken execution path
measures that path; ground truth exists as a completed run whose defect the operator side has
byte-verified, and the model sees only what production would show; predictions are pre-registered
with falsifiers phrased as caught / missed / noise.

Adjudicate against the bytes. `caught` needs the mechanism and owner to match the verified defect;
`missed` means the known prompt went unread, judged from the read trail rather than the report;
`noise` is a claim that fails verification. Attribute a miss to prompt text and fix the prompt,
never the adjudication. One turn per question — repeatability belongs to the next paid run.

The first live run of this tier, before the Epoch Reviewer was removed on 2026-09-04: its scripted
scenario cleared 25/25 mechanism checks, and the live turn then overturned an operator-side verifier audit by locating a
correctnessModel branch that contradicted the brief's published lift rule, while missing an entire
walled root that the read trail exposed and one orientation sentence fixed.

## Finish

Print the deciding reader's rows, not only the exit, and resolve every pre-registered branch. A cleared stub scenario is mechanism evidence; the meta-test, when run, is the only judgment evidence it adds.
