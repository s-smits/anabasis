---
name: safeguards
description: "Design, add, read or retire an Anabasis runtime safeguard: a bounded log-only sensor around a measured brittle decision. Use it for a post-run finding, not as a substitute for the owning product fix, verifier, score or launch gate."
---

# Safeguards

Use this skill when a completed run or an owner review has exposed a brittle decision that deserves
a visible runtime signal while its proper fix is being designed. A safeguard is an instrument, not
a new controller. It makes the next occurrence easier to locate without changing what the system
does.

## What exists

One mechanism, end to end:

- `SAFEGUARD_INVENTORY` in `src/meta/safeguard.ts` holds every id as `{ name, introduced }`. The
  name carries an immutable ordinal prefix, such as `40-refused-submit-repeated-code`. A grep for
  `id:` finds nothing — a 2026-08-31 session mis-grepped exactly that.
- `safeguardTriggered(name, detail, context)` appends one bounded line to the run-exclusive
  `campaigns/<project>/safeguards/<runId>/SAFEGUARDS_LOG.txt` and prints the same line to stderr,
  best-effort.
- `bun run outcome -- --safeguards <campaignDir>` reads those logs and returns one row per
  inventory id: `name`, `introduced`, `fired`, `firstFired`, `lastFired`, and the campaigns that
  fired it.

That is the whole authority. A line is a lead. It cannot classify a case, change a terminal or a
route, author a claim or gate a run, and no separate ledger, archive or review component reads it.

It is also the only kind. This section once distinguished runtime safeguards from "campaign
sentinels S1-S5", and the WRI archive carried five of them: `archive-scaffold.mjs` pushed `S1` to
`S5` with every field a constant, and `validate-archive.mjs` refused an archive that lacked them.
Nothing else in the repository ever defined one, so the five rows were identical in every archive,
told no reader anything, and could fail only if someone hand-edited them out. Both sides went on
2026-09-18. Treat a review that names a sentinel as naming nothing, and reconcile firings against
the campaign's own recorded evidence.

## Add a sensor only beside a new component

A safeguard reports whether a newly added branch is observed. A firing does not establish
correctness or useful effect. It is not a companion for every edit (operator decision 2026-09-03):

- **A new component gets one.** A new gate, tool, prompt clause, refusal, reader or route enters as
  a bounded observation of its new decision, where existing evidence leaves that fact unobservable.
  Prefer the existing writer when it already records the decision; do not count it twice. Name
  exactly which branch a firing proves. A refusal sensor measures refusals, not all uses of the
  component: zero refusals cannot establish that the component is unused.
- **Consolidating, simplifying or merging gets none.** Folding two components into one, deleting a
  mechanism, inlining a wrapper or renaming a field measures nothing new. The surviving component
  keeps its sensor and the retired one's sensor goes with it.
- **A rewrite is a new component only where the decision moved.** Keep the old sensor on a branch
  whose predicate did not change; add a new id only for a branch that decides something the old
  one did not.

Observe at the consumer boundary, from the returned or recorded outcome, never from a new
self-reported health flag. Comparing requested against finally offered issue counts after packet
budgeting establishes an omission without copying the budget algorithm or deciding whether a model
would diagnose well.

## Add one useful sensor

Before editing, identify the measured run, exact source revision, decision owner and the smallest
brittle shape. Do not add a speculative watch because a branch looks untidy. Trace:

```text
observed branch -> one bounded call -> stderr + run-local log -> post-run census -> owner
```

The call stays cheap and safe at the point where it is made:

- add a new inventory entry rather than renumbering one: the ordinal is part of the immutable name;
- never reuse or change a name for a different predicate;
- flatten and bound the detail to one line, keeping only public identities such as a task, battery,
  count or ceiling. Never include protected verifier text or secrets;
- pass the controller's existing `SafeguardContext` through the live caller. Do not derive a log
  root from cwd or a battery id; a caller without a resolved context has stderr evidence only;
- swallow an unwritable log directory. The watched decision must not throw, return early, alter its
  kind, change its score or refuse the run because the sensor failed;
- never print to stdout: stdout may be a verifier or child-process wire;
- keep one call per observed occurrence unless the owner has a measured reason to aggregate. No
  watcher loop, retry, scheduler or reader belongs in the runtime path.

Put a short comment at every site naming the immutable id and the run or review it came from. One
sensor may have several sites under one id and predicate. When the product fix is ready, route it
to its owner and remove the sensor as part of that change; do not hide a product change inside a
safeguards edit.

Deterministic checks cover the helper's bounded formatting, its stderr channel and a throw-free
write failure. A unit test that arranges the predicate and asserts its own trigger fires is not
evidence that a live branch reaches it. Use a completed run or a focused system-path simulation for
reachability, and label a simulation as mechanism evidence rather than a live result.

## Read a census

Run the reader once per run against that campaign directory, and record the rows. Read it against
a completed run whose log was bound, from the exact source revision, never a shared working
directory or a stale operator copy: an absent or unbound `SAFEGUARDS_LOG.txt` is not zero firings,
it is inconclusive. Interpret the rows against the unchanged predicate:

| count over the epoch | what it says | action |
| --- | --- | --- |
| no firing | the watched predicate was not observed | ask whether a normal path, a rare refusal or an unreached component explains it |
| some firings | the watched shape occurred | join its outcomes and route the evidenced defect or recording gap |
| frequent firings | the shape may be normal, or a repeated defect | compare intended behaviour with outcomes before consolidating or repairing |

Counts prioritise investigation. They do not choose architecture and they do not prove model
improvement. For a frequent normal outcome, prefer its existing evidence writer over a permanent
duplicate log. For a repeated defect, fix the owning mechanism. Several sensors around one decision
are a reason to look for duplicated authority before adding another. Keep the claim narrow: an
observed packet omission does not mean context caused a wrong diagnosis.

## Retire on evidence the reader produces

Treat a firing as a routed finding, not as success. The owning source team decides whether the
condition becomes a typed evidence row, a real gate or a product repair, and the sensor stays until
that replacement is recorded.

Removal and consolidation are a weekly review, not a step of the per-run loop (operator decision
2026-09-07). A shape may fire once a week, or once across seven four-hour runs, so a sensor quiet
through one run is not yet a candidate.

The easy case needs no quiet observation at all: when the watched mechanism leaves the source, or
its fact gains an authoritative recorded writer, the sensor goes out in that same change, which
names the replacement.

Retiring a merely quiet sensor needs the reviewer to supply what the reader cannot. `fired: 0` on
its own is not evidence, because it does not separate a branch that stayed healthy from one no run
reached. State, for each candidate:

- census output showing zero firings for that id across every campaign that could have fired it,
  not one campaign;
- at least two completed runs, named by run id, whose recorded evidence shows the watched branch
  was reached. The reader cannot derive this, and a guess leaves the row inconclusive;
- the owner's decision and its reason, recorded in the commit that removes the entry.

Without two named reachable runs the row is `no-opportunity` and the sensor stays. A census on
2026-09-18 over every recorded campaign found nine of the fifteen live ids had never fired, and not
one of them could be retired on that fact alone. That is the rule working, not failing.

If a later definition is needed, add a new immutable id and link it as a successor. Never
repurpose, renumber or silently merge an old id: recorded lines carry the old name for ever.
