# Optional worked examples

Use a shape when it helps; none is a domain plan. The exact file contracts are in
[contract.md](contract.md).

## Domain shapes

Two sketches, one per answer shape, naming families, roots, checks, join, controls, tools and
what is published or withheld. The ward rostering domain below is a third: a structured record on
which several published rules act under one budget, with many valid answers, checked by authored
code alone.

**Source code in a file map, checked by an installed tool.** Request: "writes C libraries for
parsing binary telemetry frames".

```text
Families   fixed-header decode | TLV payloads | CRC-guarded frames | reassembly across buffers |
           endianness variants. Left out: frame encryption and authentication.
Root       files {fileMap: true}, holding the entrypoint the task names.
Checks     target-compiles     external ["cc"]; cites compile-contract (entrypoint, C17, signatures)
           decode-behaviour    external ["cc"]; compiles, then runs cell:build/driver on each
                               published scenario's stdin; cites decode-contract, scenario-contract
           malformed-rejection external ["cc"]; hostile frames yield the published error code
           reassembly-state    external ["cc"]; chunked delivery; cites chunk-contract
Join       scenario-to-executed-output, owned by decode-behaviour,
           decoyClasses ["output-replays-call-counter", "case-id-lookalike"]
Accepts    one table-driven decoder and one switch-based decoder for the same task
Reject     the driver prints a fixed output sequence off a call counter and ignores stdin;
           mutationClass "output-replays-call-counter", expectedCheckId decode-behaviour
Tools      presets ["files"]; reader describe_frame_contract (layout, scenarios, error codes);
           the shell's cc builds the solver's own test drivers on frames it writes itself
Published  entrypoint, standard, signatures, byte order, output format, error codes, scenarios
Withheld   parsing strategy, table layout, buffer management order
```

**A structured numeric record, checked by authored code and an installed tool.** Request: "sizes
radial low-voltage distribution feeders".

```text
Families   residential radial | industrial feeder with motor inrush | mixed feeder with PV
           backfeed | long rural feeder governed by voltage drop. Left out: harmonics, protection.
Root       network: buses, lines with a catalogue conductor id and length,
           the reported total cost. Every check reads under it.
Checks     catalogue-conformance authored; every line names one published conductor and copies
                                 its published ampacity and impedance; cites catalogue-rule
           thermal-limit         external ["python3"]; args ["-m", "<installed load-flow cli>"],
                                 stdin the canonical artifact JSON; line current <= ampacity x
                                 published derating; on the check beside execution,
                                 numericBoundaries [{publicInputPath: "$.ambientTempC",
                                   constantName: "ampacity-reference-ambient"}]
           voltage-limit         external ["python3"]; every bus >= published minimum p.u.
           cost-budget           authored; sum of length x published price, half-up to 2 dp;
                                 numericBoundaries [{publicInputPath: "$.costBudget",
                                   constantName: "feeder-cost-budget",
                                   artifactPath: "$.network.totalCost", direction: "atMost"}]
Join       lines-to-buses, owned by catalogue-conformance,
           decoyClasses ["ghost-bus", "alias-swap-conductor-id"]
Constant   ampacity-reference-ambient = 30 degC, authority IEC 60364-5-52 Table B.52.14; a reject
           at it names thermal-limit as its expectedCheckId
Constant   feeder-cost-budget, the limit each task publishes at $.costBudget
Accepts    the minimal compliant sizing, and one conductor size up still inside the budget
Reject     one line endpoint renamed to a bus no bus row declares, everything else identical;
           mutationClass "ghost-bus", targetsJoin lines-to-buses, decoyClass "ghost-bus",
           expectedCheckId catalogue-conformance
Tools      presets [shell] with an interpreter carrying the field's numerical libraries;
           reader list_feeder_inputs; adviser total_network (a candidate's line lengths and cost);
           artifact-writer record_network. The load flow the limit checks run is the solver's
Published  catalogue, derating table, reference ambient, voltage limit and its inclusivity,
           rounding, budget, load cases
Withheld   sizing search order, sequence of conductor changes, tie-break at equal cost
```

Examples of invalid designs: a `report` or `summary` root no check reads; a rule stated only in
`decisions` and then enforced; a check that only compiles, parses or greps submitted source; a
tool that reports the installed toolchain; an adviser that returns a complete valid answer; an
adviser, program or guide line that runs a check's analysis for the solver.

## A target the solver does not reliably meet

A task that asks for one published rule is transcription, and a reference that replays a stored
answer does not change that: the blind solver reaches the author's own answer on most tasks, well
inside its wall, because the search that found that answer is one the solver can run too. What it
does not reliably meet is demand: several published requirements acting together on one answer under
one shared limit, so that meeting one spends the margin another needs, with the way to meet them
together withheld. A first battery can already hold a family that only a real search over its
interacting requirements meets. Five constructions may help; none is required, and another method is
as welcome.

- **A demand the battery does not yet make.** Change what a task asks the solver to reason about,
  not only where its numbers sit: requirements that pull against each other so the answer built one
  rule at a time fails, published scenarios under which a different answer works, outputs or states
  that must agree after the same step, or a trade-off no direct formula settles, so candidates have
  to be searched. Publish every requirement and withhold only how your reference meets them
  together. Take each from what the request's field already holds. It fails when the answer that
  met the old task still meets the new one, or when the requirement is one the field would not hold.
- **The work at the size and in the environment the field works in.** A small copy of the field's
  work can be easy because its difficulty lives in what the copy left out: the full-size instance,
  the real library, device or dataset, the rest of the system the piece runs inside. Author the task
  at the size practitioners face, run the solve and the checks on the field's own tools rather than
  a stand-in you wrote for them, and check the behaviour of what was delivered there. The round
  tally gives the largest share of the solve wall any pass took; a pass that used a few minutes of
  it was a small job, whatever the task looks like on paper. A stand-in that differs from the real
  tool makes a pass meaningless and a fail your harness's defect. It fails when the full-size task
  is the small one repeated, adding time but no decision.
- **A planted design.** Choose a design first, derive the requirements from it and publish only the
  requirements. It fails when the derived requirements point straight back at the planted design,
  when many simpler answers meet them too, or when they are requirements the field would not hold.
- **A search past the solver's wall.** Run an offline search far longer than one solve may take,
  keep its best incumbents, and store the best as the answer `reference/` replays, which F2 admits
  as it admits any stored answer. Use this to propose the next task; fresh solver attempts establish
  its difficulty. It fails when the long search finds nothing a short one does not.
- **An answer the field already recorded.** Take a task whose answer the field has recorded, such as
  a merged fix or a published result, and store that answer as the one `reference/` replays. You need
  not find it yourself, and the solver cannot reach it by rerunning your search. It fails when the
  public task does not decide the recorded answer, so a different valid answer would be refused, or
  when the solver can find the recorded answer where the field published it.

The last three set where a limit or a stored answer sits, and each combines with the first two.

Some changes look harder and are not. Moving a limit or a magnitude while the method that passed
still meets it, adding tasks, families or conditions that method also settles, a rule the task does
not publish, and a limit no answer meets all leave the solver's method untouched, or make the check
rather than the solver the thing that fails.

`harness_trial` estimates how reliably the solver meets a task; it does not veto one. A limit some
blind solves meet and others miss is a task the battery can measure, not one to discard. A trial can
take an hour and can come back `not-run`, so it is a sample you may buy, not a step you owe.

## The worked domain

One ward rostering domain runs through the brief, tasks, controls, evaluator and reference below.
Four published rules act on one roster: every shift covered by a member of staff holding its
qualification, a minimum rest between any two shifts one person works, each contract's minimum and
maximum hours, and one wage budget. The families differ by which of those rules interact, not by
size:

```text
open-cover        No one has guaranteed hours and the budget sits well above the cheapest roster,
                  so the rules can be met one at a time. The first-legal answer, which takes the
                  shifts in order and gives each the first listed member of staff who is qualified
                  and keeps rest and their cap, passes.
skill-rest        The budget leaves little room for agency cover, and rest decides which
                  charge-qualified staff can still take the next charge shift. The first-legal
                  answer spends a charge nurse on a ward shift early and pays the agency later,
                  failing one week on the budget; in the other week a different roster works and
                  it passes.
guaranteed-hours  Contract minimums join the other three. Ward-only staff with a minimum need the
                  ward shifts, rest decides which charge shifts the two charge nurses can pair,
                  and the budget sits less than one cheapest shift above the best roster the
                  reference finds, so every roster that pays the agency or leaves a minimum unmet
                  fails. Neither the first-legal answer nor the same answer trying the cheapest
                  staff first meets a task here.
```

The last family is built to be the hardest, by a property of its tasks: minimum hours force named staff
onto shifts while rest and the scarce charge qualification decide which shifts they can pair, and
the budget sits less than one cheapest shift above the best roster the reference finds, so no rule
can be settled on its own and only a search over whole rosters meets the budget.

Everything a check enforces is published: the four rules, the rest constant and its authority, the
inclusive comparisons and the whole-hour times. What stays private is how the reference builds a
roster: the order it takes shifts, the order it tries staff, its tie-break and its bound.

The tasks are small so the conflict can be read by hand. In `guaranteed-hours-01` only two shifts
need the ward qualification, and st-2, who holds nothing else, is guaranteed sixteen hours, so st-2
needs both of them. The four charge shifts then fall to st-1, also guaranteed sixteen hours, and
st-3; rest decides how the two can share them, since the second day's late and night shifts cannot
go to one person, and paying the agency for any of them breaks the budget. The first-legal answer
gives the first ward shift to st-1, the first qualified staff member listed. It meets cover, rest
and the budget and leaves st-2 at eight hours, so only `hours-within-contract` refuses it.

Small does not mean hard. At this size a shell enumerates every roster, so the example shows how the
rules act together on one roster, not how hard that is; a battery keeps the same interactions at the
size the field rosters, such as a ward's four weeks. How hard a family is gets measured against the
solver, never claimed. A very hard family must still be one the published rules decide: the
reference reads only the public task and meets every limit through the same checks, and accepts it
did not produce show that the rules, not its recipe, admit them. Before you measure, answer your own
tasks the way a careful reader would, one rule at a time, and put that answer through your checks;
where it passes every task, the requirements do not yet act together.

```json
{
  "slug": "duty-roster",
  "domain": "ward staff rostering",
  "decisions": [
    "which staff member works each shift is the agent's decision",
    "the evaluator recomputes cover, rest, contract hours and wage cost from the rows and the task; no installed tool observes them"
  ],
  "gates": ["submit blocks until the assignments have been prepared"],
  "ruleDecisions": [
    {"id": "cover-rule", "visibility": "public",
     "statement": "every declared shift has exactly one row, naming a declared staff member whose qualifications include the shift's qualification; one staff member may work several shifts; unused staff are allowed; row order does not matter", "publicInputPaths": ["$.staff", "$.shifts"]},
    {"id": "rest-rule", "visibility": "public",
     "statement": "for any two shifts one staff member works, the later start minus the earlier end is at least $.minRestHours, equal passing, so overlapping shifts fail; times are whole hours from the roster's start", "publicInputPaths": ["$.shifts", "$.minRestHours"]},
    {"id": "contract-hours-rule", "visibility": "public",
     "statement": "each declared staff member's rostered hours, the sum of end minus start over their shifts, lie between their minHours and maxHours inclusive, so a staff member with minHours above zero must be rostered", "publicInputPaths": ["$.staff", "$.shifts"]},
    {"id": "wage-budget-rule", "visibility": "public",
     "statement": "the roster's wage cost, the sum over its rows of the shift's hours times the staff member's hourlyRate, is at most $.wageBudget, equal passing; every value is a whole number, so nothing is rounded", "publicInputPaths": ["$.staff", "$.shifts", "$.wageBudget"]},
    {"id": "search-order", "visibility": "private",
     "statement": "take the shifts with the fewest qualified staff first and try staff cheapest first, earlier-listed on a tie; cut a branch when it breaks rest or a cap, when unmet minimum hours exceed the hours left, or when its cost plus the cheapest cover of the remaining shifts reaches the best roster found"}
  ],
  "truthChecks": [
    {"id": "assignments-match", "citedDecisionIds": ["cover-rule"],
     "assertion": "every declared shift is covered once by a declared staff member holding its qualification",
     "execution": {"families": "all", "artifactPaths": ["$.assignments"], "hidden": "none",
       "publicInputPaths": ["$.staff", "$.shifts"], "evidence": {"kind": "authored"}},
     "joinIds": ["staff-to-shifts"]},
    {"id": "rest-respected", "citedDecisionIds": ["rest-rule"],
     "assertion": "no staff member works two shifts closer together than the published minimum rest",
     "execution": {"families": "all", "artifactPaths": ["$.assignments"], "hidden": "none",
       "publicInputPaths": ["$.staff", "$.shifts", "$.minRestHours"], "evidence": {"kind": "authored"}},
     "numericBoundaries": [{"publicInputPath": "$.minRestHours", "constantName": "minimum-daily-rest"}]},
    {"id": "hours-within-contract", "citedDecisionIds": ["contract-hours-rule"],
     "assertion": "every staff member's rostered hours lie within their contract's minimum and maximum",
     "execution": {"families": "all", "artifactPaths": ["$.assignments"], "hidden": "none",
       "publicInputPaths": ["$.staff", "$.shifts"], "evidence": {"kind": "authored"}}},
    {"id": "wage-budget", "citedDecisionIds": ["wage-budget-rule"],
     "assertion": "the roster's wage cost is within the task's budget",
     "execution": {"families": "all", "artifactPaths": ["$.assignments"], "hidden": "none",
       "publicInputPaths": ["$.staff", "$.shifts", "$.wageBudget"], "evidence": {"kind": "authored"}},
     "numericBoundaries": [{"publicInputPath": "$.wageBudget", "constantName": "wage-budget"}]}
  ],
  "joins": [
    {"id": "staff-to-shifts", "decoyClasses": ["alias-swap", "ghost-staff"],
     "description": "each row's staff id and shift id bound to the declared staff member and shift they name"}
  ],
  "artifactSchema": [{"name": "assignments", "shape": "array of {staffId, shiftId} rows"}],
  "designRuleConstants": [
    {"name": "minimum-daily-rest", "value": 11, "unit": "h",
     "authority": "Directive 2003/88/EC", "citation": "Article 3, minimum daily rest of 11 consecutive hours"},
    {"name": "wage-budget", "value": "stated by each task at $.wageBudget", "unit": "currency units",
     "authority": "the ward's approved staffing budget", "citation": "each task's $.wageBudget"}
  ],
  "correctnessContract": "check-program/v1"
}
```

### The file-map brief contract

```json
{
  "slug": "starter-file-map",
  "domain": "command-line tools",
  "decisions": ["module layout and helper structure are writer decisions"],
  "gates": ["submit blocks on a missing entrypoint"],
  "ruleDecisions": [
    {
      "id": "case-contract",
      "visibility": "public",
      "families": ["command-line"],
      "statement": "running the entrypoint the task names on each public case's stdin must print that case's expected stdout exactly, with a trailing newline and exit status 0",
      "publicInputPaths": ["$.cases", "$.entrypoint"]
    }
  ],
  "truthChecks": [
    {
      "id": "public-cases-pass",
      "assertion": "the submitted program produces the required output for every public case",
      "citedDecisionIds": ["case-contract"],
      "execution": {
        "families": "all",
        "artifactPaths": ["$.files"],
        "publicInputPaths": ["$.cases", "$.entrypoint"],
        "hidden": "none",
        "evidence": {"kind": "external", "requiredToolIds": ["python3"]}
      },
      "joinIds": ["cases-to-source-behaviour"]
    }
  ],
  "joins": [
    {
      "id": "cases-to-source-behaviour",
      "description": "submitted source behaviour joined to each public case by exact case id",
      "decoyClasses": ["case-id-lookalike", "source-ignores-case"]
    }
  ],
  "artifactSchema": [
    {
      "name": "files",
      "shape": "map of safe relative POSIX paths to file contents, including the main.py entrypoint",
      "fileMap": true
    }
  ],
  "designRuleConstants": [],
  "correctnessContract": "check-program/v1"
}
```

## Task battery contract

Five tasks over three days. Times are whole hours from the roster's start and every shift is eight
hours long, so eleven hours of rest rules out a late shift followed by the next day's early one.

```json
[
  {"taskId": "open-cover-01", "family": "open-cover", "hidden": [], "publicInput": {
    "minRestHours": 11, "wageBudget": 1750, "staff": [
      {"id": "st-1", "qualifications": ["ward", "charge"], "hourlyRate": 34, "minHours": 0, "maxHours": 24},
      {"id": "st-2", "qualifications": ["ward"], "hourlyRate": 28, "minHours": 0, "maxHours": 24},
      {"id": "st-3", "qualifications": ["ward", "charge"], "hourlyRate": 30, "minHours": 0, "maxHours": 16},
      {"id": "st-4", "qualifications": ["ward"], "hourlyRate": 26, "minHours": 0, "maxHours": 16},
      {"id": "st-5", "qualifications": ["ward", "charge"], "hourlyRate": 58, "minHours": 0, "maxHours": 40}
    ], "shifts": [
      {"id": "sh-1", "qualification": "charge", "start": 7, "end": 15}, {"id": "sh-2", "qualification": "ward", "start": 7, "end": 15},
      {"id": "sh-3", "qualification": "charge", "start": 31, "end": 39}, {"id": "sh-4", "qualification": "ward", "start": 31, "end": 39},
      {"id": "sh-5", "qualification": "ward", "start": 55, "end": 63}, {"id": "sh-6", "qualification": "ward", "start": 63, "end": 71}
    ]
  }},
  {"taskId": "skill-rest-01", "family": "skill-rest", "hidden": [], "publicInput": {
    "minRestHours": 11, "wageBudget": 1590, "staff": [
      {"id": "st-1", "qualifications": ["ward", "charge"], "hourlyRate": 34, "minHours": 0, "maxHours": 24},
      {"id": "st-2", "qualifications": ["ward"], "hourlyRate": 28, "minHours": 0, "maxHours": 24},
      {"id": "st-3", "qualifications": ["ward", "charge"], "hourlyRate": 30, "minHours": 0, "maxHours": 16},
      {"id": "st-4", "qualifications": ["ward"], "hourlyRate": 26, "minHours": 0, "maxHours": 16},
      {"id": "st-5", "qualifications": ["ward", "charge"], "hourlyRate": 58, "minHours": 0, "maxHours": 40}
    ], "shifts": [
      {"id": "sh-1", "qualification": "ward", "start": 7, "end": 15}, {"id": "sh-2", "qualification": "charge", "start": 15, "end": 23},
      {"id": "sh-3", "qualification": "charge", "start": 23, "end": 31}, {"id": "sh-4", "qualification": "ward", "start": 39, "end": 47},
      {"id": "sh-5", "qualification": "ward", "start": 55, "end": 63}, {"id": "sh-6", "qualification": "charge", "start": 63, "end": 71}
    ]
  }},
  {"taskId": "skill-rest-02", "family": "skill-rest", "hidden": [], "publicInput": {
    "minRestHours": 11, "wageBudget": 1590, "staff": [
      {"id": "st-1", "qualifications": ["ward", "charge"], "hourlyRate": 34, "minHours": 0, "maxHours": 24},
      {"id": "st-2", "qualifications": ["ward"], "hourlyRate": 28, "minHours": 0, "maxHours": 24},
      {"id": "st-3", "qualifications": ["ward", "charge"], "hourlyRate": 30, "minHours": 0, "maxHours": 16},
      {"id": "st-4", "qualifications": ["ward"], "hourlyRate": 26, "minHours": 0, "maxHours": 16},
      {"id": "st-5", "qualifications": ["ward", "charge"], "hourlyRate": 58, "minHours": 0, "maxHours": 40}
    ], "shifts": [
      {"id": "sh-1", "qualification": "ward", "start": 7, "end": 15}, {"id": "sh-2", "qualification": "charge", "start": 15, "end": 23},
      {"id": "sh-3", "qualification": "charge", "start": 31, "end": 39}, {"id": "sh-4", "qualification": "ward", "start": 39, "end": 47},
      {"id": "sh-5", "qualification": "charge", "start": 55, "end": 63}, {"id": "sh-6", "qualification": "ward", "start": 63, "end": 71}
    ]
  }},
  {"taskId": "guaranteed-hours-01", "family": "guaranteed-hours", "hidden": [], "publicInput": {
    "minRestHours": 11, "wageBudget": 1670, "staff": [
      {"id": "st-1", "qualifications": ["ward", "charge"], "hourlyRate": 34, "minHours": 16, "maxHours": 24},
      {"id": "st-2", "qualifications": ["ward"], "hourlyRate": 28, "minHours": 16, "maxHours": 24},
      {"id": "st-3", "qualifications": ["ward", "charge"], "hourlyRate": 30, "minHours": 8, "maxHours": 16},
      {"id": "st-4", "qualifications": ["ward"], "hourlyRate": 26, "minHours": 0, "maxHours": 16},
      {"id": "st-5", "qualifications": ["ward", "charge"], "hourlyRate": 58, "minHours": 0, "maxHours": 40}
    ], "shifts": [
      {"id": "sh-1", "qualification": "ward", "start": 7, "end": 15}, {"id": "sh-2", "qualification": "charge", "start": 15, "end": 23},
      {"id": "sh-3", "qualification": "charge", "start": 39, "end": 47}, {"id": "sh-4", "qualification": "charge", "start": 47, "end": 55},
      {"id": "sh-5", "qualification": "ward", "start": 55, "end": 63}, {"id": "sh-6", "qualification": "charge", "start": 63, "end": 71}
    ]
  }},
  {"taskId": "guaranteed-hours-02", "family": "guaranteed-hours", "hidden": [], "publicInput": {
    "minRestHours": 11, "wageBudget": 1670, "staff": [
      {"id": "st-1", "qualifications": ["ward", "charge"], "hourlyRate": 34, "minHours": 16, "maxHours": 24},
      {"id": "st-2", "qualifications": ["ward"], "hourlyRate": 28, "minHours": 16, "maxHours": 24},
      {"id": "st-3", "qualifications": ["ward", "charge"], "hourlyRate": 30, "minHours": 8, "maxHours": 16},
      {"id": "st-4", "qualifications": ["ward"], "hourlyRate": 26, "minHours": 0, "maxHours": 16},
      {"id": "st-5", "qualifications": ["ward", "charge"], "hourlyRate": 58, "minHours": 0, "maxHours": 40}
    ], "shifts": [
      {"id": "sh-1", "qualification": "ward", "start": 7, "end": 15}, {"id": "sh-2", "qualification": "charge", "start": 15, "end": 23},
      {"id": "sh-3", "qualification": "ward", "start": 31, "end": 39}, {"id": "sh-4", "qualification": "charge", "start": 39, "end": 47},
      {"id": "sh-5", "qualification": "charge", "start": 55, "end": 63}, {"id": "sh-6", "qualification": "charge", "start": 63, "end": 71}
    ]
  }}
]
```

## Control corpus contract

Each reject is an accept of the same task with one fact changed. `reject-first-legal-greedy` is the
roster the first-legal answer builds, one row away from `accept-guaranteed-hours`. It passes every
check but `hours-within-contract`: meeting cover, rest and the budget one shift at a time spent the
margin st-2's minimum hours needed.

```json
{
  "accept": [
    {"id": "accept-open-cover-first-legal", "taskId": "open-cover-01", "artifact": {"assignments": [
      {"staffId": "st-1", "shiftId": "sh-1"}, {"staffId": "st-2", "shiftId": "sh-2"}, {"staffId": "st-1", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-1", "shiftId": "sh-5"}, {"staffId": "st-2", "shiftId": "sh-6"}
    ]}},
    {"id": "accept-skill-rest-cheapest", "taskId": "skill-rest-01", "artifact": {"assignments": [
      {"staffId": "st-4", "shiftId": "sh-1"}, {"staffId": "st-1", "shiftId": "sh-2"}, {"staffId": "st-3", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-4", "shiftId": "sh-5"}, {"staffId": "st-3", "shiftId": "sh-6"}
    ]}},
    {"id": "accept-skill-rest-agency-within-budget", "taskId": "skill-rest-01", "artifact": {"assignments": [
      {"staffId": "st-4", "shiftId": "sh-1"}, {"staffId": "st-3", "shiftId": "sh-2"}, {"staffId": "st-5", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-4", "shiftId": "sh-5"}, {"staffId": "st-3", "shiftId": "sh-6"}
    ]}},
    {"id": "accept-skill-rest-second-week", "taskId": "skill-rest-02", "artifact": {"assignments": [
      {"staffId": "st-4", "shiftId": "sh-1"}, {"staffId": "st-1", "shiftId": "sh-2"}, {"staffId": "st-3", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-3", "shiftId": "sh-5"}, {"staffId": "st-4", "shiftId": "sh-6"}
    ]}},
    {"id": "accept-guaranteed-hours", "taskId": "guaranteed-hours-01", "artifact": {"assignments": [
      {"staffId": "st-2", "shiftId": "sh-1"}, {"staffId": "st-3", "shiftId": "sh-2"}, {"staffId": "st-1", "shiftId": "sh-3"},
      {"staffId": "st-3", "shiftId": "sh-4"}, {"staffId": "st-2", "shiftId": "sh-5"}, {"staffId": "st-1", "shiftId": "sh-6"}
    ]}},
    {"id": "accept-guaranteed-hours-reordered", "taskId": "guaranteed-hours-02", "artifact": {"assignments": [
      {"staffId": "st-1", "shiftId": "sh-6"}, {"staffId": "st-3", "shiftId": "sh-5"}, {"staffId": "st-1", "shiftId": "sh-4"},
      {"staffId": "st-2", "shiftId": "sh-3"}, {"staffId": "st-1", "shiftId": "sh-2"}, {"staffId": "st-2", "shiftId": "sh-1"}
    ]}}
  ],
  "reject": [
    {"id": "reject-alias-swap", "taskId": "skill-rest-01", "artifact": {"assignments": [
      {"staffId": "st-4", "shiftId": "sh-1"}, {"staffId": "st-2", "shiftId": "sh-2"}, {"staffId": "st-3", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-4", "shiftId": "sh-5"}, {"staffId": "st-3", "shiftId": "sh-6"}
    ]}, "mutationClass": "alias-swap", "targetsJoin": "staff-to-shifts", "decoyClass": "alias-swap", "expectedCheckId": "assignments-match"},
    {"id": "reject-shift-uncovered", "taskId": "open-cover-01", "artifact": {"assignments": [
      {"staffId": "st-1", "shiftId": "sh-1"}, {"staffId": "st-2", "shiftId": "sh-2"}, {"staffId": "st-1", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-1", "shiftId": "sh-5"}
    ]}, "mutationClass": "shift-uncovered", "expectedCheckId": "assignments-match"},
    {"id": "reject-shift-twice", "taskId": "open-cover-01", "artifact": {"assignments": [
      {"staffId": "st-1", "shiftId": "sh-1"}, {"staffId": "st-2", "shiftId": "sh-2"}, {"staffId": "st-1", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-1", "shiftId": "sh-5"}, {"staffId": "st-2", "shiftId": "sh-6"},
      {"staffId": "st-4", "shiftId": "sh-6"}
    ]}, "mutationClass": "shift-covered-twice", "expectedCheckId": "assignments-match"},
    {"id": "reject-ghost-staff", "taskId": "open-cover-01", "artifact": {"assignments": [
      {"staffId": "st-1", "shiftId": "sh-1"}, {"staffId": "st-6", "shiftId": "sh-2"}, {"staffId": "st-1", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-1", "shiftId": "sh-5"}, {"staffId": "st-2", "shiftId": "sh-6"}
    ]}, "mutationClass": "ghost-staff", "targetsJoin": "staff-to-shifts", "decoyClass": "ghost-staff", "expectedCheckId": "assignments-match"},
    {"id": "reject-late-then-early", "taskId": "skill-rest-01", "artifact": {"assignments": [
      {"staffId": "st-4", "shiftId": "sh-1"}, {"staffId": "st-1", "shiftId": "sh-2"}, {"staffId": "st-3", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-2", "shiftId": "sh-5"}, {"staffId": "st-3", "shiftId": "sh-6"}
    ]}, "mutationClass": "late-then-early", "expectedCheckId": "rest-respected"},
    {"id": "reject-first-legal-greedy", "taskId": "guaranteed-hours-01", "artifact": {"assignments": [
      {"staffId": "st-1", "shiftId": "sh-1"}, {"staffId": "st-3", "shiftId": "sh-2"}, {"staffId": "st-1", "shiftId": "sh-3"},
      {"staffId": "st-3", "shiftId": "sh-4"}, {"staffId": "st-2", "shiftId": "sh-5"}, {"staffId": "st-1", "shiftId": "sh-6"}
    ]}, "mutationClass": "first-legal-greedy", "expectedCheckId": "hours-within-contract"},
    {"id": "reject-over-contract", "taskId": "skill-rest-02", "artifact": {"assignments": [
      {"staffId": "st-3", "shiftId": "sh-1"}, {"staffId": "st-1", "shiftId": "sh-2"}, {"staffId": "st-3", "shiftId": "sh-3"},
      {"staffId": "st-2", "shiftId": "sh-4"}, {"staffId": "st-3", "shiftId": "sh-5"}, {"staffId": "st-4", "shiftId": "sh-6"}
    ]}, "mutationClass": "over-contract", "expectedCheckId": "hours-within-contract"},
    {"id": "reject-agency-over-budget", "taskId": "guaranteed-hours-01", "artifact": {"assignments": [
      {"staffId": "st-2", "shiftId": "sh-1"}, {"staffId": "st-3", "shiftId": "sh-2"}, {"staffId": "st-1", "shiftId": "sh-3"},
      {"staffId": "st-5", "shiftId": "sh-4"}, {"staffId": "st-2", "shiftId": "sh-5"}, {"staffId": "st-1", "shiftId": "sh-6"}
    ]}, "mutationClass": "agency-cover", "expectedCheckId": "wage-budget"}
  ]
}
```

## Worked evaluator

```ts
import type { EvaluationRequest } from "@ana/correctness-model-bundle";
interface Assignment { staffId: string; shiftId: string }
interface Staff { id: string; qualifications: string[]; hourlyRate: number; minHours: number; maxHours: number }
interface Shift { id: string; qualification: string; start: number; end: number }
interface RosterInput { staff: Staff[]; shifts: Shift[]; minRestHours: number; wageBudget: number }
type Request = EvaluationRequest<{ assignments: Assignment[] }>;
const hours = (shift: Shift) => shift.end - shift.start;

/** The rows bound to the staff member and shift each names, or null when a row names neither. */
function roster({artifact, publicTask}: Request) {
  const input = publicTask.publicInput as RosterInput;
  if (!Array.isArray(artifact.assignments)) return null;
  const rows = artifact.assignments.map(({staffId, shiftId}) => ({
    staff: input.staff.find(row => row.id === staffId),
    shift: input.shifts.find(row => row.id === shiftId),
  }));
  if (!rows.every(row => row.staff !== undefined && row.shift !== undefined)) return null;
  const worked = (person: Staff) => rows.filter(row => row.staff === person).map(row => row.shift!);
  return { input, rows: rows as Array<{ staff: Staff; shift: Shift }>, worked };
}

export const checks = {
  "assignments-match": (request: Request): boolean => {
    const found = roster(request);
    if (found === null) return false;
    const ids = found.rows.map(row => row.shift.id);
    return ids.length === found.input.shifts.length && new Set(ids).size === ids.length &&
      found.rows.every(row => row.staff.qualifications.includes(row.shift.qualification));
  },
  "rest-respected": (request: Request): boolean => {
    const found = roster(request);
    return found !== null && found.input.staff.every(person => {
      const shifts = found.worked(person).toSorted((a, b) => a.start - b.start);
      return shifts.every((shift, i) => i === 0 || shift.start - shifts[i - 1]!.end >= found.input.minRestHours);
    });
  },
  "hours-within-contract": (request: Request): boolean => {
    const found = roster(request);
    return found !== null && found.input.staff.every(person => {
      const total = found.worked(person).reduce((sum, shift) => sum + hours(shift), 0);
      return total >= person.minHours && total <= person.maxHours;
    });
  },
  "wage-budget": (request: Request): boolean => {
    const found = roster(request);
    return found !== null &&
      found.rows.reduce((sum, row) => sum + hours(row.shift) * row.staff.hourlyRate, 0) <= found.input.wageBudget;
  },
};
```

## Worked reference

```ts
import type { ReferenceSolveFn, PublicTask } from "@ana/correctness-model-bundle";
interface Staff { id: string; qualifications: string[]; hourlyRate: number; minHours: number; maxHours: number }
interface Shift { id: string; qualification: string; start: number; end: number }
interface RosterInput { staff: Staff[]; shifts: Shift[]; minRestHours: number; wageBudget: number }

/** The cheapest roster meeting cover, rest and contract hours, found by branch and bound. */
export const solve: ReferenceSolveFn = (task: PublicTask<unknown>) => {
  const input = task.publicInput as RosterInput;
  const hours = (shift: Shift) => shift.end - shift.start;
  const able = (shift: Shift) => input.staff
    .filter(person => person.qualifications.includes(shift.qualification))
    .toSorted((a, b) => a.hourlyRate - b.hourlyRate);
  const order = input.shifts.toSorted((a, b) => able(a).length - able(b).length);
  const cheapest = order.map((_, i) => order.slice(i)
    .reduce((sum, shift) => sum + hours(shift) * (able(shift)[0]?.hourlyRate ?? Infinity), 0));
  const hoursLeft = order.map((_, i) => order.slice(i).reduce((sum, shift) => sum + hours(shift), 0));
  const worked = new Map(input.staff.map(person => [person.id, [] as Shift[]]));
  const total = (id: string) => worked.get(id)!.reduce((sum, shift) => sum + hours(shift), 0);
  const owed = () => input.staff.reduce((sum, person) => sum + Math.max(0, person.minHours - total(person.id)), 0);
  const rested = (id: string, shift: Shift) => worked.get(id)!.every(other =>
    shift.start - other.end >= input.minRestHours || other.start - shift.end >= input.minRestHours);
  const chosen: string[] = [];
  const best = { cost: Infinity, staff: [] as string[] };
  const search = (i: number, cost: number): void => {
    if (cost + (cheapest[i] ?? 0) >= best.cost || owed() > (hoursLeft[i] ?? 0)) return;
    if (i === order.length) return void Object.assign(best, { cost, staff: [...chosen] });
    const shift = order[i]!;
    for (const person of able(shift)) {
      if (!rested(person.id, shift) || total(person.id) + hours(shift) > person.maxHours) continue;
      worked.get(person.id)!.push(shift);
      chosen.push(person.id);
      search(i + 1, cost + hours(shift) * person.hourlyRate);
      worked.get(person.id)!.pop();
      chosen.pop();
    }
  };
  search(0, 0);
  return { assignments: best.staff.map((staffId, i) => ({ staffId, shiftId: order[i]!.id })) };
};
```

### Installed tools

The file-map check runs the submitted entrypoint on each public case. The host owns the
non-result even if the program returns false after observing it.

```ts
let passed = true;
for (const testCase of publicInput.cases) {
  const run = await runtime.tools.run({
    toolId: "python3",
    args: [publicInput.entrypoint],
    files: artifact.files,
    stdin: testCase.stdin,
  });
  if (run.nonResult !== null || run.exitCode !== 0 || run.stdout !== testCase.stdout) passed = false;
}
return passed;
```
