# Walk the layers

**Use this case when:** a condition would measure whether an actor follows an instruction, and no one has yet read the transport, parser, admission, wall and evidence record under that instruction. Run this before `live-segment`, `fullrun-conditions` and the model meta-test in `scenario-stub`; it needs no model.

A model-visible instruction is the top of a stack. Under it sit the transport that carries the
actor's choice, the parser that rebuilds what it declared, the controller that admits it, the OS
wall that runs it, and the record that turns the result into durable evidence. A behaviour condition measures the
top of that stack and reports the sum. When a lower layer cannot carry the instruction, the condition
comes back as a propensity finding — "the model will not do it" — and that finding is false.

This is the recorded failure of this skill, and it cost three prompt versions and two backends. A
Builder was told to acquire and drive a real tool. Every condition wrote a substitute instead. Three
rounds of prompt work followed, each rehearsed live, each reporting the same refusal. The prompt
was never the cause: the parser that rebuilt a submitted engine spec kept six fields and dropped
the two that let an engine read an environment variable or name its own directory, so no real
toolchain could be declared at all and the substitute was the only thing that worked. Reading one
function would have answered in a minute what the conditions answered wrongly over two days.

**Before any live condition on an instruction, write the layer walk.** It is one table, produced before
the predictions and hashed with them:

| Layer | The function and file that carries it | Read? |
|---|---|---|

Start at the instruction's own words and end where the outcome becomes evidence. Every layer gets a
named function in the run tree. A layer you cannot name is a layer you have not checked, and it is
the likeliest place the instruction dies.

Three rules for reading the table:

1. **Read every layer that rebuilds its input.** Any function that constructs a fresh
   object from a parsed one — a registry parser, a projection, a sanitiser, an evidence writer — is
   an allowlist whether or not it is written as one, and what it drops is invisible from above and
   from below. List its output fields against its input fields. Both recorded misses of this skill
   were exactly this shape.
2. **Prove the capability by hand before measuring the propensity.** "Can, when told" is a trap in
   a *model* condition, because a named target turns propensity into capability. It is not a trap when
   you do it yourself, deterministically, with no model in the loop: install the tool, declare it
   the way the instruction says, and drive it through the production exports. That check costs no
   model spend and it is the only thing that separates "the model chose not to" from "the product
   could not". Do it first. A propensity condition launched before it is a guess with a receipt.
3. **Use the real artifact, not a fixture.** A fixture holds still, is small, and writes to nothing.
   The real thing is a 1.8 GB toolchain that rewrites its own index on every invocation. The second
   defect in this pair survived every existing test because each one declared a temp directory that
   nothing was writing to; the wall hashed each declared directory before and after the run
   and refused any difference, so the first real compiler ever pointed at it returned an
   environment fault instead of a verdict. Take the artifact from the domain in the prompt.

Walk the table bottom-up with that artifact — the wall, then admission, then the parser, then the
transport — and stop at the first layer that refuses. Each step is a deterministic call to a named
export; none of it needs a model. A layer walk that clears is a cleared *mechanism*, and the
behaviour condition above it is then worth its cost, because whatever it reports is now about judgment.

**A propensity finding is not reportable until the layer walk under it is clear.** If a condition says
the actor would not do the thing, the walk says whether it could. Report both or neither.

Example 7 in `references/e2e-examples.md` is this walk written out, with the table that was skipped
and the two layers it would have named.

## Finish

Hash the layer table with the predictions. A refusing layer is the finding; stop there and route it to its owner. A clear walk supports running the behaviour condition above it under existing authority and is quoted in that condition's note.

Bind the deciding consumer, not a parallel implementation of it. A generated evaluator's local
rejection can disagree with the production aggregate; exercise the same accepted artifact through
both paths and explain any difference before calling either proof. For feedback, inspect the
delivered and possibly truncated text, then let the next real reader act on it. Assert the finding
or behaviour itself: a temporary directory containing `verifier-required` once made a text assertion
pass without the claimed notice. When a shared owner changes, inspect its direct-build, measurement,
standalone and CLI consumers as applicable; a passing full-run fixture cannot prove unvisited callers.

## Run the real writer against the real reader

When a join crosses a process boundary — a launchd watchdog writing a record the controller later
admits, a bridge writing a message a child parses — the tests on each side tend to fabricate the
other side's bytes, and both stay green while the join is wrong. Walk it by running the real
writer where production runs it: spawn it in a child process (`runSync([process.execPath,
"--no-env-file", "-e", script])` with the writer imported from the exact tree), then hand its
bytes to the real reader in the test process and assert admission, plus one hostile variation the
reader must refuse. On 2026-09-01 this settled the watchdog readiness join for PR #434 in one
test case (`test/full-run-supervision.test.ts`), which is where the condition now lives.
