# What easy, medium, hard and frontier look like

None of these six is your domain, and none of them is a domain this loop runs. They are here so
that "harder" means something specific while you author, rather than a bigger number in the same
task. The rows show the scale and nothing else: they name no requirement for you to adopt. **We aim
for frontier**, and we reach it with what the request's own field demands.

## Four tiers

A tier is what one answer has to hold at once:

- **easy** — choose one thing so a published limit holds inside a stated budget, and report both
  figures you compared. The solver chooses, and one comparison settles it.
- **medium** — three or more published limits holding together, none of them met at the cost of
  another, with the governing value reported for each. The requirements share something finite, so
  the answer has to be planned whole.
- **hard** — all of that at nominal *and* across a whole set of degraded or adversarial states the
  same one answer must clear, with the worst case and where it falls reported. The first competent
  answer is rejected by one of those states, not by arithmetic.
- **frontier** — hard, with the set no longer handed over. Any one of four moves does it: the worst
  case lies somewhere in a continuous or combinatorial region the solver has to search and the
  verifier searches again; the limits that apply follow a class the answer itself declares, so
  there is no fixed number to converge on until the answer picks one; every intermediate state of a
  sequence is bound and an earlier step forecloses a later one; or feasibility is not the bar,
  because a reported margin has to survive its admissible neighbours under a published trade rule.

The report in every row is there so that a wrong answer cannot look right, and it does that only
when a check reads the same figure off the delivered answer — a recomputation over the design, a
build's own sizes, the output the program produces when it runs. A figure checked only against your
own arithmetic over the brief grades the report and leaves the work unread.

## Where the demand comes from

The request names a field, and the field already holds everything the upper tiers need. Its
practitioners share finite things: memory, time, a budget, a catalogue, one interface several parts
must use. Its parts fail in known ways and its inputs arrive malformed. Its standards publish the
classes an answer declares and the limits each class carries. Read the field for those before you
write a rule of your own.

A budget, a degraded state or a report duty the field does not already hold is an invented
requirement, and it costs three ways. You are its only authority, so the solver can read it a way
you never meant, and a battery failing on that reading measures your wording. It measures your rule
rather than the work the request asked for. And the review reads it as tasks that leave the
request's own obligations undemanded, which is a curriculum defect however hard it makes the
battery.

When the answer is a program or a configuration, the tiers keep their meaning and change their
material. The finite thing is a resource the target really has. The degraded states are real faults
of what the program connects to and real malformed input. A harder task asks for more of the
requested capabilities at once, through their real interfaces, so that making one work constrains
how another can. The checks decide from what the built program does, never from how its source is
arranged or from a trace of calls into a stand-in you wrote.

## Six domains

**GP surgery appointments** — no solver; the published rules are the whole truth.

- easy — book the listed patients so clinician hours and room rules hold inside the day's slot
  budget, and report both figures you compared.
- medium — hold the urgent reserve, the break rules and continuity of care together across the
  week, none met at the cost of another, and report the governing value for each.
- hard — that, and still hold them with any one clinician absent and the interpreter session
  withdrawn; report the worst day and what governs it.
- frontier — that, with the absence to survive being any one clinician on any one day rather than a
  named one, and the continuity rule that applies following the care band your own roster assigns
  each patient; report the absence you found to be worst.

**Power distribution feeder** — graded by a real load flow (pandapower `runpp`).

- easy — pick a conductor from the catalogue so the worst bus stays inside the voltage band at the
  stated demand, and report the bus and its value.
- medium — size conductors, transformer tap and shunt compensation so the voltage band, every
  branch's thermal rating and the loss budget hold together, none met at the cost of another, and
  report the governing value for each.
- hard — that, and still hold with any one feeder section out of service; report the worst bus
  under each outage and the section whose loss governs.
- frontier — that, holding at every step of the published switching sequence rather than only in
  the final configuration, with no admissible re-tap improving one reported margin by more than the
  published trade rule allows at another's cost; report the step that governs.

**Byte-stream protocol parser** — graded by compiling the delivered source with the real compiler
and replaying byte streams through the program it builds.

- easy — parse the published request grammar for well-formed input inside the stated buffer size,
  and have the program report the method and body length it read.
- medium — length framing, chunked bodies and pipelined requests all through the one fixed buffer,
  none handled at the cost of another, with the program reporting where each message ends.
- hard — that, and still frame correctly when the published malformed and truncated streams are
  interleaved with valid ones; the program reports the byte at which it refused each bad stream.
- frontier — that, with the stream split into reads wherever the verifier chooses rather than at
  listed offsets, and the header and pipelining limits that apply following the conformance profile
  the program itself declares; report each message boundary, identical under every split.

**Impulsive orbital transfer** — graded by a real two-body propagation of the actual burn vectors.

- easy — choose the two burn magnitudes so the propagated arrival semi-major axis lands inside its
  tolerance within the delta-v budget, and report both.
- medium — place the burns so arrival eccentricity, inclination and the time-of-flight window all
  hold together inside the delta-v budget, none met at the cost of another, and report the achieved
  value for each. The delta-v sum is the proxy; the propagated arrival state is the answer.
- hard — that, and still arrive inside tolerance when the first burn under-delivers by the
  published dispersion; report the worst-case miss and the burn that governs it.
- frontier — that, with each intermediate orbit clearing the published exclusion altitude and no
  burn undoable once made, and the arrival tolerance following the insertion class your own plan
  declares; report the governing limit at every leg.

**Lumped LC impedance match** — graded by a real swept S-parameter computation (scikit-rf).

- easy — choose an L-match meeting the return-loss target at the centre frequency inside the stated
  component count, and report the value you computed.
- medium — choose the ladder so the worst in-band return loss, the component count and the
  realisable component values hold together across the whole band, none met at the cost of another,
  and report the governing frequency for each. A network sized at the centre frequency alone is
  deep there and shallow at the edges.
- hard — that, and still hold at every corner of the published component-tolerance box; report the
  worst case and the frequency it falls at.
- frontier — that, with the tolerance box a continuous region whose interior you search rather than
  a list of corners, and no admissible component substitution improving one reported margin by more
  than the published trade rule allows at another's cost; report the interior point where the match
  is worst.

**Relational index selection** — graded by the database's own planner and timings.

- easy — choose one index so the slow query meets its latency budget inside the stated storage
  allowance, and report both.
- medium — choose the whole index set so every query's latency, the write amplification and the
  storage budget hold together, none met at the cost of another, and report the governing value for
  each.
- hard — that, and still hold under a skewed parameter set and with one index unavailable during a
  rebuild; report the worst plan and the query it belongs to.
- frontier — that, with the skew drawn from anywhere in the published parameter distribution rather
  than one listed set, and the latency budget that applies following the workload class your own
  answer assigns each query; report the parameters you found worst and the query they fall on.

## What moves the tier, and what gives it away

The solver is a capable model with a shell. Anything it can settle by searching, it will search:
it writes its own optimiser, runs it for as long as the wall allows and reads your published rules
back out of the brief. So the tier is set by whether the answer has to be right about something the
search cannot enumerate cheaply, and three changes that feel harder measure exactly the same:

- **A tighter number on a rule the tasks already had.** The solver's search finds the same kind of
  answer closer to the limit, and the reasoning is unchanged.
- **More cases of a rule the tasks already had.** That is coverage, worth having and not a tier.
- **A new rule that only removes candidates.** A clearance, an exclusion, a forbidden pairing: the
  solver filters and searches what is left. A rule raises the tier only when satisfying it spends
  something the other limits need, so the answer has to be re-planned rather than re-filtered.

What does move it is the set. The answer that wins at nominal is not the one that survives the set,
so the solver gives something up before it knows what it is buying; and once the set is a region
rather than a list, the solver has to find its own worst case before it can report one.

Three things you publish can give the tier back without a word of the tasks changing.

**Your tools.** An adviser that reports every margin under the verified model across every listed
state turns any feasible task into iterate-until-clear: propose, read the one failing state, adjust,
ask again. Keep the analysis — a solver without one fails on arithmetic, which measures nothing —
but then the difficulty has to live where that adviser cannot reach: a region the verifier searches
again, a class the answer declares, a sequence whose early steps close later ones. Say in
EXPERIMENT.json which one your tasks rely on. A tool that returns the very value a check compares
against is the reference solve under another name.

**A number no admissible answer can breach.** Take the answer a solver that ignores an obligation
would produce and read it against every published limit and tolerance. If it clears them all, the
battery verifies that the obligation was performed, not that any decision turned on it. Move the
limit to where the demanding answer and the cheap one differ by more than the tolerance, or stop
naming the obligation.

**A number read off your own answer.** Your reference search is the one value you know is
attainable, and it carries that search's variance: tight where it converged, slack where it stopped
early, so one family publishes one obligation at several strengths without saying so. Two tasks
whose inputs sit in the same range and whose limits differ several-fold differ in search quality,
not in demand. And a permitted region centred on your reference's answer publishes that answer
outright: the solver reads the centre and needs no search.

## Reading a measured battery

A battery moves the demand or repairs the last measurement. Adding tasks is neither, and neither is
re-running a demand already measured: the count is what you paid the round for, and paying twice for
it buys nothing. Growing a probe to the full size is no exception — the probe measured the level,
and a full battery authored at its demand is the probe again, in more cases.

The same holds between sibling tasks. Two tasks of a family that keep the whole structure — what is
bound to what, which states the one answer must clear, which quantity is scarce — and differ only in
the magnitudes of the published numbers measure one condition twice: the plan that wins the first
wins the second. Vary the input the obligation is carried by, and the pair reports two things. A
family that varies only by magnitude also bounds the next battery, because the only demand left to
raise is a number; for a program, siblings differ in which parts they combine and how those parts
must cooperate.

## When a battery lands above the aim

Every hard and frontier row carries the same three things, and a battery scoring near the top is
usually missing the last two:

1. Something finite the requirements share, so meeting one spends what another needs.
2. A set of degraded or adversarial states the same answer must also clear, under which the obvious
   construction is wrong — and in the frontier rows that set is searched rather than listed.
3. A duty to report the value each limit was read against, checked against the answer itself.

Find each in the request's field, never in a rule you add to it. If your tasks already carry all
three and still land above the aim, the move left is to take the set out of the task statement and
out of your tools; adding members to a listed set is coverage. If the field genuinely holds none of
the three, say so in EXPERIMENT.json's gap and raise the demand the other way: more of the request's
own capabilities in each task, working through their real interfaces at once. Then check the
numbers you already publish against the two above — a rule that cannot be broken as published keeps
a battery above the aim whatever is added beside it.

## When a battery lands below the aim

The first battery is authored above what you believe the solver handles, so landing here is the
course working. A later battery still below it usually is not, because three things read exactly
like difficulty from the outside. Settle them in this order before easing anything:

1. **Could the answer be read?** A rule your checks apply and your brief does not publish fails
   every task. So does a rule you wrote yourself that a practitioner could read two ways: every
   solver that took the other reading fails it. Publishing what decides validity is not publishing
   the search order, allocation recipe, fallback chain or tie-break that reaches a valid answer.
2. **Could the answer be expressed?** An artifact a correct solver cannot write through the tools
   you gave it is a representation defect, not a hard task. Every accept control is a shape your
   writer produced; a valid answer your writer cannot produce is one you never tested.
3. **Was the same core failing each time?** The same tasks failing in consecutive batteries is a
   stuck path or an unpublished rule. A battery that is genuinely hard fails different tasks.

Only then is the battery telling you about the tasks. Ease the whole battery rather than a subset,
since the distance to the aim is stated in cases, by giving back one of the three things above. It
does not mean loosening a published number on a rule the tasks already had, which moves the count as
little as tightening one did.
