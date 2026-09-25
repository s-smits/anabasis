# Optional worked examples

Use a shape when it helps; none is a domain plan. The exact file contracts are in
[contract.md](contract.md).

## Domain shapes

Two sketches, one per answer shape, naming families, roots, checks, join, controls, tools and
what is published or withheld. The rostering domain below is a third: a structured record with
several valid answers, checked by authored code alone.

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
           adviser lay_out_frame (lays one supplied frame's bytes against the published field
           table and returns each field's value; compares nothing with a candidate)
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
           at it carries targetsBoundary {publicInputPath: "$.ambientTempC",
           constantName: "ampacity-reference-ambient"}
Constant   feeder-cost-budget, the limit each task publishes at $.costBudget
Accepts    the minimal compliant sizing, and one conductor size up still inside the budget
Reject     one line endpoint renamed to a bus no bus row declares, everything else identical;
           mutationClass "ghost-bus", targetsJoin lines-to-buses, decoyClass "ghost-bus",
           expectedCheckId catalogue-conformance
Tools      presets [shell];
           reader list_feeder_inputs; adviser analyse_supplied_network (solves a supplied bus
           and line candidate, returns currents and voltages, compares nothing with the limits);
           artifact-writer record_network
Published  catalogue, derating table, reference ambient, voltage limit and its inclusivity,
           rounding, budget, load cases
Withheld   sizing search order, sequence of conductor changes, tie-break at equal cost
```

Examples of invalid designs: a `report` or `summary` root no check reads; a rule stated only in
`decisions` and then enforced; a check that only compiles, parses or greps submitted source;
twenty-five tasks from one template; a tool that reports the installed toolchain; an adviser that
returns a complete valid answer or the per-check verdict before submit.

## The worked domain

One rostering domain runs through the brief, tasks, controls, evaluator and reference below.

```json
{
  "slug": "duty-roster",
  "domain": "staff rostering",
  "decisions": ["assigning each staff member to a shift is the agent's decision"],
  "gates": ["submit blocks until the assignments have been prepared"],
  "ruleDecisions": [
    {
      "id": "qualification-rule",
      "visibility": "public",
      "families": ["single-shift", "two-shift"],
      "statement": "every declared shift is assigned exactly once to a declared staff member with the matching qualification; a staff member may hold at most one shift; unused staff are allowed; assignment order does not matter",
      "publicInputPaths": ["$.staff", "$.shifts"]
    },
    {
      "id": "scan-order",
      "visibility": "private",
      "statement": "take the shifts in declaration order and give each the first qualified staff member"
    }
  ],
  "truthChecks": [
    {
      "id": "assignments-match",
      "assertion": "every shift has one qualified declared staff member, with no repeated staff or undeclared shifts",
      "citedDecisionIds": ["qualification-rule"],
      "execution": {
        "families": "all",
        "artifactPaths": ["$.assignments"],
        "publicInputPaths": ["$.staff", "$.shifts"],
        "hidden": "none",
        "evidence": {"kind": "authored"}
      },
      "joinIds": ["staff-to-shifts"]
    }
  ],
  "joins": [
    {
      "id": "staff-to-shifts",
      "description": "staff joined to shifts by exact qualification",
      "decoyClasses": ["alias-swap"]
    }
  ],
  "artifactSchema": [{"name": "assignments", "shape": "array of {staffId, shiftId} rows"}],
  "designRuleConstants": [],
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

```json
[
  {
    "taskId": "single-shift-01",
    "family": "single-shift",
    "publicInput": {
      "staff": [{"id": "st-1", "qualification": "day"}, {"id": "st-2", "qualification": "night"}],
      "shifts": [{"id": "sh-1", "qualification": "night"}]
    },
    "hidden": []
  },
  {
    "taskId": "single-shift-02",
    "family": "single-shift",
    "publicInput": {
      "staff": [
        {"id": "st-1", "qualification": "day"},
        {"id": "st-2", "qualification": "day"},
        {"id": "st-3", "qualification": "night"}
      ],
      "shifts": [{"id": "sh-1", "qualification": "night"}]
    },
    "hidden": []
  },
  {
    "taskId": "two-shift-01",
    "family": "two-shift",
    "publicInput": {
      "staff": [
        {"id": "st-1", "qualification": "day"},
        {"id": "st-2", "qualification": "night"},
        {"id": "st-3", "qualification": "cold-store"}
      ],
      "shifts": [{"id": "sh-1", "qualification": "night"}, {"id": "sh-2", "qualification": "cold-store"}]
    },
    "hidden": []
  },
  {
    "taskId": "two-shift-02",
    "family": "two-shift",
    "publicInput": {
      "staff": [
        {"id": "st-2", "qualification": "night"},
        {"id": "st-3", "qualification": "cold-store"},
        {"id": "st-4", "qualification": "night"}
      ],
      "shifts": [{"id": "sh-1", "qualification": "night"}, {"id": "sh-2", "qualification": "cold-store"}]
    },
    "hidden": []
  }
]
```

## Control corpus contract

Abbreviated: a real corpus holds at least 5 accepts and 5 rejects, as contract.md states.

```json
{
  "accept": [
    {
      "id": "accept-canonical",
      "taskId": "single-shift-01",
      "artifact": {"assignments": [{"staffId": "st-2", "shiftId": "sh-1"}]}
    },
    {
      "id": "accept-alternative-staff",
      "taskId": "two-shift-02",
      "artifact": {
        "assignments": [{"staffId": "st-4", "shiftId": "sh-1"}, {"staffId": "st-3", "shiftId": "sh-2"}]
      }
    },
    {
      "id": "accept-canonical-two-shift",
      "taskId": "two-shift-01",
      "artifact": {
        "assignments": [{"staffId": "st-2", "shiftId": "sh-1"}, {"staffId": "st-3", "shiftId": "sh-2"}]
      }
    }
  ],
  "reject": [
    {
      "id": "reject-alias-swap",
      "taskId": "single-shift-01",
      "artifact": {"assignments": [{"staffId": "st-1", "shiftId": "sh-1"}]},
      "mutationClass": "alias-swap",
      "targetsJoin": "staff-to-shifts",
      "decoyClass": "alias-swap",
      "expectedCheckId": "assignments-match"
    },
    {
      "id": "reject-wrong-shift-two-shift",
      "taskId": "two-shift-01",
      "artifact": {
        "assignments": [{"staffId": "st-2", "shiftId": "sh-1"}, {"staffId": "st-3", "shiftId": "sh-1"}]
      },
      "mutationClass": "wrong-shift",
      "expectedCheckId": "assignments-match"
    }
  ]
}
```

## Worked evaluator

```ts
import type { EvaluationRequest } from "@ana/correctness-model-bundle";
interface Assignment { staffId: string; shiftId: string }
interface RosterInput {
  staff: Array<{ id: string; qualification: string }>;
  shifts: Array<{ id: string; qualification: string }>;
}
type Request = EvaluationRequest<{ assignments: Assignment[] }>;
export const checks = {
  "assignments-match": ({artifact, publicTask}: Request): boolean => {
    const input = publicTask.publicInput as RosterInput;
    const rows = artifact.assignments;
    if (!Array.isArray(rows) || rows.length !== input.shifts.length) return false;
    return new Set(rows.map(row => row.shiftId)).size === rows.length &&
      new Set(rows.map(row => row.staffId)).size === rows.length &&
      rows.every(({staffId, shiftId}) => {
        // A scan suits this small roster; index the rows by id for a large one.
        const staff = input.staff.find(row => row.id === staffId);
        const shift = input.shifts.find(row => row.id === shiftId);
        return staff !== undefined && shift !== undefined && staff.qualification === shift.qualification;
      });
  },
};
```

## Worked reference

```ts
import type { ReferenceSolveFn, PublicTask } from "@ana/correctness-model-bundle";
interface RosterInput {
  staff: Array<{ id: string; qualification: string }>;
  shifts: Array<{ id: string; qualification: string }>;
}
export const solve: ReferenceSolveFn = (task: PublicTask<unknown>) => {
  const input = task.publicInput as RosterInput;
  const used = new Set<string>();
  return { assignments: input.shifts.flatMap(shift => {
    const staff = input.staff.find(candidate =>
      candidate.qualification === shift.qualification && !used.has(candidate.id));
    if (staff === undefined) return [];
    used.add(staff.id);
    return [{staffId: staff.id, shiftId: shift.id}];
  }) };
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
