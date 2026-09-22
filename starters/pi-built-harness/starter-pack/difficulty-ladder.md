# What easy, medium, hard and frontier look like

None of these six is your domain, and none of them is a domain this loop runs. They are here so
that "harder" means something specific while you author, rather than a bigger number in the same
task. If the domain you were given happens to touch one of them, the rows still describe only the
scale: they name no requirement for you to adopt. **We aim for frontier.**

Four tiers, by what one answer has to hold at once:

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

The report duty is not decoration. It is what stops a wrong answer from looking right: an answer
that states the figure each limit was read against can be checked against its own design, and one
that does not cannot.

Four of the six name the open-source solver that would decide them. That is the altitude to author
at: a tool that scores the solver's design without handing over the design.

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

**Thermodynamic power cycle** — graded by a real property recompute and energy balance (CoolProp).

- easy — choose the boiler pressure so the cycle reaches its net-power target inside the turbine
  inlet-temperature limit, and report both.
- medium — set pressures, temperatures and mass flow so net power, thermal efficiency, the turbine
  exit quality floor and the condenser duty limit hold together, none met at the cost of another,
  and report the governing value for each.
- hard — that, and still hold at the published off-design ambient and with one feedwater heater out
  of service; report the worst condition and what limits it there.
- frontier — that, holding everywhere in the published ambient range rather than at the listed
  off-design point and at every step of the published load ramp rather than at its two ends; report
  the ambient and the step you found worst.

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

## What sets the tier, and what does not

The solver is a capable model with a shell. Anything it can settle by searching, it will search:
it writes its own optimiser, runs it for as long as the wall allows and reads your own published
rules back out of the brief. So the tier is not set by how constrained the search is. It is set by
whether the answer has to be right about something the search cannot enumerate cheaply.

Three changes that feel harder and measure the same:

- **A tighter number on a rule the tasks already had.** The published limit moves, the solver's
  search finds the same kind of answer closer to it, and the reasoning is unchanged.
- **More cases of a rule the tasks already had.** That is coverage. Coverage is worth having and it
  is not a tier.
- **A new rule that only removes candidates.** A clearance, an exclusion volume, a forbidden
  pairing: the solver filters its candidate set and searches what is left. A rule raises the tier
  only when satisfying it spends something the other limits need, so that the answer has to be
  re-planned rather than re-filtered.

What does move it is the second item below: the one answer must survive a *set* of states, so the
solver's search has to run inside that set rather than once at nominal. That is why every
engineering hard row above ends "and still hold with any one X out of service", "at every corner of
the tolerance box", "under a skewed parameter set". The set is what makes enumeration expensive,
and expense is not the point — the point is that the answer that wins at nominal is not the answer
that survives the set, so the solver has to give something up before it knows what it is buying.

The frontier rows take the set back out of the task statement. A named outage, a listed corner and
a supplied skewed parameter set are all still handed over: the solver reads the set off the brief
and checks its answer against each member. Once the set is a region rather than a list, the solver
has to find its own worst case before it can report one, and the verifier searches that region
again rather than replaying a list.

## Where the published number has to sit

A rule is carried by a number, and the number decides whether the rule can be broken at all. Two
ways that goes wrong, both of them leaving a battery that scores high while measuring less than it
names.

**An obligation no admissible design can breach.** Take the answer a solver that ignores the
obligation would produce and read it against every published limit and reporting tolerance. If it
clears them all, the battery verifies that the obligation was performed, not that any decision
turned on it: the demanding method and the cheap one agree inside the tolerance, so no check
separates them. Move the limit to where the two answers differ by more than the tolerance, or stop
naming the obligation.

**A limit read off your own best answer.** Setting each limit to what your own reference search
reached is the right shape — it is the one value you know is attainable — but it inherits that
search's variance. Where the search converged the limit is tight and the task is an optimisation;
where it stopped early the limit is slack and a first reasonable answer clears it, so one family
publishes one obligation at several strengths without saying so. Before the battery goes out, read
each limit against the task inputs that should explain it: two tasks whose inputs sit in the same
range and whose limits differ several-fold differ in search quality, not in demand.

## Every battery after the first

A battery moves the demand or repairs the last measurement. Adding tasks is neither, and neither is
re-running a demand you have already measured: the count a battery returns is what you paid the
round for, and paying it twice for the same count buys nothing.

Growing a probe battery to the full size is not an exception to that. The probe measured the level;
the expansion carries that level onto every new task and moves from there. A full battery authored
at the probe's own demand is the probe again, in more cases.

The same holds between sibling tasks inside one battery. Two tasks of a family that keep the whole
structure — what is bound to what, which states the one answer must clear, which quantity is the
scarce one — and differ only in the magnitudes of the published numbers measure one condition
twice: the plan that wins the first wins the second, so the pair returns one result at the price of
two cases. Vary the input the obligation is carried by, and the pair reports two things.

A family that varies only by magnitude also bounds the next battery. Once the numbers are the only
axis that has ever moved, the only demand left to raise is a number, which is the first of the
three changes that measure the same. Move a structural input between siblings while the battery is
being authored and that axis is still open when the round after it needs one.

## When a battery lands above the aim

Read the hard and frontier rows of all six domains and ask what they carry that your tasks do not.
In every one of them it is the same three things, and a battery that scores near the top is usually
missing the last two:

1. Something finite the requirements share, so meeting one spends what another needs.
2. A set of degraded or adversarial states the same answer must also clear, under which the obvious
   construction is wrong — and in the frontier rows that set is searched rather than listed.
3. A duty to report the value each limit was read against, so a plausible wrong answer is visibly
   wrong.

Check the change you are about to make against the three that measure the same. If it is one of
them, it will not move the score, however much work it is to build. Then check the numbers you
already publish against "Where the published number has to sit": a battery also lands above the aim
when a rule it names cannot be broken as published, and no rule added beside that one fixes it.

## When a battery lands below the aim

The first battery is authored above what you believe the solver handles, so landing here is the
course working: the next batteries come down to the aim. A later battery still below it is not, and
the reason is usually not that the tasks are too hard. Three things read exactly like difficulty
from the outside. Settle them in this order before easing anything:

1. **Could the answer be read?** A rule your checks apply and your brief does not publish fails
   every task, and the count it produces is indistinguishable from a hard battery. Publishing that
   rule is not publishing a way to satisfy it: what decides whether an answer is valid is public,
   and the search order, allocation recipe, fallback chain and hidden tie-break that reach one stay
   yours. The task is exactly as hard after the fix — the solver still has to find the answer, it
   just stops failing a test it could not read.
2. **Could the answer be expressed?** An artifact a correct solver cannot write through the tools
   you gave it is a representation defect, not a hard task. Every accept control is a shape your
   writer produced; a valid answer your writer cannot produce is one you never tested.
3. **Was the same core failing each time?** The same tasks failing in consecutive batteries is a
   stuck path or an unpublished rule. A battery that is genuinely hard fails different tasks.

Only once all three are clear is the battery telling you something about the tasks. Then ease the
whole battery rather than a subset: the distance to the aim is stated in cases, and a change the
solver absorbs in one or two of them will not move it, in this direction any more than in the other.

Easing means giving back one of the three things the hard and frontier rows carry — the finite
thing the requirements share, the set of states the one answer must clear, the duty to report the
value each limit was read against. It does not mean loosening a published number on a rule the
tasks already had. That is the mirror of the first change on the list above, and it moves the count
about as far as tightening one did: a solver that could not plan the answer whole still cannot, and
one that could now clears the looser limit with the design it already had.
