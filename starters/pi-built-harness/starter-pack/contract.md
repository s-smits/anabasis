# Authoring reference

Build in this workspace, replacing the placeholders under `agent/` and `correctness-model/`
beside `starter-pack/`. The controller supplies Pi Agent Core, the DraftStore, inspection,
preview and submission.

## Correctness Model contract

`correctness-model/brief.json` declares `"correctnessContract": "check-program/v1"`, non-empty
`decisions` and `gates`, the `artifactSchema`, `joins`, cited `designRuleConstants` and the truth
checks. `correctness-model/evaluator.ts` exports `checks`, mapping every declared check id to a
TypeScript function returning a Boolean or Promise<Boolean>. The controller runs each applicable
check in a fresh confined process and builds the verdict itself.
A false check never stops the others: every applicable check runs.

Each truth check declares `id`, a decidable `assertion`, optionally the public `ruleDecisions` ids
it enforces as `citedDecisionIds` (an undeclared id, or only private ones, is refused), and:

```json
{
  "execution": {
    "families": "all",
    "artifactPaths": ["$.answer"],
    "publicInputPaths": ["$.requirements"],
    "hidden": "none",
    "evidence": {"kind": "authored"}
  },
  "citedDecisionIds": ["answer-rule"]
}
```

- `families` is `"all"` or a non-empty list. Prefer `"all"` and read the family's condition from
  the public task: a check bound to names cannot follow a later broadening of the family set.
- Paths are rooted JSON paths; artifact paths are non-empty. A key that is not a plain name,
  such as a file name with a dot, is quoted: `$.files['main.cpp']`. A function receives `{publicTask,
  artifact, hidden, runtime}` projected to its declared paths and its own hidden row; `runtime`
  is also its second argument.
- `hidden: "required"` demands exactly one `{checkId, expectation}` row on every applicable task;
  `"none"` forbids one. Applicability never depends on that row, and a missing required row
  refuses evaluation.
- Publish each rule in a public `ruleDecisions` row, optionally scoped by `families`: every rule,
  constant, precedence and tolerance a check enforces is public. A private row may describe search
  choices, never an unpublished validity rule. What stays private is how an answer is built: the
  reference answers and a task-specific recipe, such as a search order, an allocation rule, a
  fallback chain or a derivation. Then read the public projection whole — the rule rows, the
  constants, the schema, the operating guide and your tool text together — for that recipe in
  other words. The repair is the recipe removed, never a rule a check enforces taken out of the
  projection.
- A check owning a join lists its `joinIds`.
- Read every value your rule names from the task, at the moment the check runs. A constant written
  into checker source for a value the brief publishes as an input is a defect even when every
  present task publishes the same number: it grades today's battery correctly and silently forbids
  the next one from varying that input. Declaring the path in `publicInputPaths` does not do it;
  the code that decides has to read it.
- A check certifying behaviour on a named resource, such as a pin, a member or a channel, decides
  from the values the answer produces for that resource: a simulated trace of that pin, the
  register writes the build emits for it, the force computed in that member. A library symbol or a
  constant found anywhere in the build proves the answer mentions the resource, not that it
  behaves, and an answer driving the wrong pin carries the same symbols.
- An identifier a check reads, such as a load case, a member or a pin, is bound to what it names
  in the public input: the check finds that geometry or scenario in the task and matches the
  answer's rows to it, so an answer that relabels its members or cases cannot pass on the labels.
- Where the request names several targets, observe that behaviour on each one an established public
  simulator runs, not only the first. A named target nothing can run is an omission: say so in a
  `decisions` row, because a build that merely compiles for it proves no behaviour there.
- Each behavioural obligation names, in a `decisions` row, what observes it: the real compiler for
  building, a simulator or model validated against the target for behaviour (for a microcontroller,
  one the field already uses, such as avr8js or rp2040js, built and smoke-tested through
  `verifier_workshop`), or "not established" where nothing does. An obligation a stand-in of your
  own decides is observed by that stand-in, and the row says so.
- A check comparing what the answer reports about itself with what it is, such as reported sizes
  against measured ones, enforces no rule of the field: an honest answer and a wrong one pass it
  alike. Decide from the measured quantity against the limit the task publishes.
- A multi-file answer is one root with `fileMap: true` and the `files` preset.
- Where a rule turns on a numeric constant, give the check itself, beside `execution`,
  `numericBoundaries: [{publicInputPath, constantName, artifactPath, direction}]`: the task path
  holding the limit, the `designRuleConstants` row naming it, the artifact path reporting the
  bounded value, and `"atMost"` or `"atLeast"`. The limit is read from the task; the row's value
  may say in words where each task states its own, and needs a number only when no task does. The last two are an optional pair, but declare
  them: all four make one public comparison the harness runs on each prepared answer and returns as
  a margin, and a boundary without them is never measured.

```ts
import type { CheckFn } from "@ana/correctness-model-bundle";
export const checks: Record<string, CheckFn> = {
  "answer-rule": ({ artifact, publicTask }) => {
    // Narrow the inputs and implement the domain condition here.
    throw new Error("Implement the declared rule");
  },
};
```

`correctness-model/reference/index.ts` exports `solve(task)`, building a correct artifact from
public task data alone; it cannot import evaluator code or hidden data, and checks cannot call
it. The host runs every reference answer through the same checks as controls and measured cases.

### Artifact schema and what the solver reads

- `artifactSchema` has one `{name, shape, allowedValues?, fileMap?, openMapPaths?}` row per artifact root. The writer and submit schema compile from your accept
  controls: an object admits only the key sets those accepts show. A record keyed by task data,
  such as `{partId: address}`, lists its dotted path in `openMapPaths` (`"$"` for the root) so
  any key is admitted while each value keeps its shape; a declared path no accept reaches is
  refused. Where an accept writes `null` for "does not apply", say so in the brief: a solver left
  to choose may write `""` there instead, and a check reading `null` then fails it.
- `allowedValues` names the only scalars a field takes; submission refuses any other before
  verification. `designRuleConstants` rows are `{name, value, unit?, authority, citation}`, and
  optional `designRuleSets` rows `{name, values, unit?, authority, citation}` publish a permitted
  list.
- Where the schema carries values a check also computes, the tool preparing the answer fills them
  from that same computation: a second one drifts from the model it describes, and the margin the
  solver is shown is then measured on the wrong number.
- The solver's `read_public_resources` returns check assertions with their public input paths,
  public `ruleDecisions`, the `artifactSchema` rows, `designRuleConstants` and `designRuleSets`.
  `decisions`, `gates`, `joins`, private rows and check ids never reach it: a rule stated only
  there is one the solver cannot read.

### Evidence and tools

Evidence is `{"kind":"authored"}` for computation you wrote, including an interpreter running
your own algorithm, with optional `execution.requiredToolIds`; or `{"kind":"external",
"requiredToolIds":[...]}` for an installed domain tool that decides the rule. Declare one list,
never both. Authored execution proves your algorithm even when an installed interpreter runs it;
it does not become independent domain evidence, and a tool call cannot change the mode.

A check calls `runtime.tools.run({toolId, args, files, stdin, timeoutMs})` and never spawns a
process itself. The host supplies the check id, refuses undeclared tool ids, and owns sandbox,
timeout and cleanup. A check that declares required tools, authored or external, passes only after
a completed run of every one of them on that same artifact; a pass without one is
`EXTERNAL_VERDICT_UNGROUNDED`, refused at the gate and a non-result in the battery. A fail stands as
returned, so a check may reject on a precondition before it reaches its tool. Each run gets a
private HOME and TMPDIR and no network, and its wall comes from `agent/config.yaml`. TMPDIR is
the run's working directory. `/tmp` is private on Linux and closed on macOS, even though your shell
can write it there, so point the scratch files of a tool that spells `/tmp` at TMPDIR. The one
thing a run starts with is its user cache directory (`XDG_CACHE_HOME`, `~/Library/Caches` on
macOS): what an earlier `correctness_check` or `submit` stored there for the same tool bytes. A
`harness_trial` or measured run starts from it and stores nothing. So keep a compiler's build cache
there; one under TMPDIR is rebuilt on every run.
- Args carry flags and names; files and stdin carry operands. Omit `stdin` when the command has
  none. A nonzero exit is a completed result for your code to interpret.
- A check decides false only from output its instrument produced. A run the host could not
  complete, such as a missing tool, a refused wall or a timeout, is already a non-result whatever
  the check returns. A tool that starts and exits without printing its result, such as a wrapper
  whose Python environment fails on import, is a completed run, and returning false there records a fail for
  an answer nothing read. Throw instead: a thrown check makes a measured case a non-result, never a
  fail, and at the gate it is a finding on the evaluator.

  ```ts
  const run = await runtime.tools.run({ toolId: "domain-solver", files: { "answer.json": JSON.stringify(artifact) } });
  const line = run.stdout.split("\n").find((row) => row.startsWith("utilisation "));
  if (line === undefined) throw new Error(`domain-solver printed no result (exit ${run.exitCode})`);
  return Number(line.slice("utilisation ".length)) <= 1;
  ```
- A tool a check or the solver runs prints only what its reader needs. The host reads at most
  1 MiB of a check's tool stdout, and a run printing more is a protocol non-result rather than a
  verdict, so the check, and any rehearsal it grades, decides nothing. Write a full dump to a file
  and print the lines the check reads.
- For external evidence, file contents and stdin must be string leaves or JSON of this check's
  declared artifact/public projection, and a request binding no such leaf or naming another
  check's tool is refused. For authored evidence, they may be constructed text,
  including test drivers and private scenarios derived from this check's own operands.
- A driver, fake header, stub library or mocked API standing in for the real platform passes only
  the answers it declares, and the census tests it only on the accepts you give it. So declare the
  real platform's public surface for the target the task names, not only the calls your reference
  makes: its aliases, its helpers and the macros its toolchain defines for that target. Keep the
  stand-in's own state out of the answer's names, in its own namespace or compilation unit, and
  give each such check at least one accept that is not your reference's output but another
  practitioner's answer against the real platform. The cheapest such accept is your reference's
  answer with one identifier it declares renamed, and one value it writes out replaced by the name
  the target predefines for it: the real toolchain gives both the same verdict, so the stand-in
  must too. An answer the real toolchain builds and runs correctly that the stand-in cannot build
  is the stand-in's defect. The recorded shape is a host double of the Arduino headers that fixed a
  display's width at 128, left out `constrain`, declared `min` for one argument type only and
  compiled the sketch's globals into its own driver's translation unit: each defect failed a sketch
  the board's own toolchain builds and runs.
- Declare `hidden: "required"` to receive private cases; the host binds that row to this check
  and records its digest with the tool inputs. Private cases test the published rule within its
  public domain; a published finite answer table cannot establish an unrestricted behaviour rule.
- An output compiled earlier in the same check runs as `toolId: "cell:<relative path>"`,
  attested by the host without replacing the declared tool's evidence.

Install every tool with its cores, packages and data under `.toolchain`, and make it find them
there through a wrapper in `.toolchain/bin` or its config file: each solve case starts in a fresh
private home, so data living only there is fetched again in every case. Programs in
`.toolchain/bin` run by name in the solver's shell too, which lists them. Required tools may also
resolve on the host PATH. Exercise the selected command with its real dependencies through
`correctness_check`; an alternate interpreter proves another condition.

Optional `numbersWithin`, `multisetMatches` and `relationalJoin` helpers come from
`@ana/correctness-model-prims`; use public units and tolerances.

## Task battery and controls

`tasks.json` is an array of `{taskId, family, publicInput, hidden}` with unique task ids that are
safe directory names. Every task has at least one applicable check, every declared public input
path exists on at least one task it applies to, and every required hidden row is `{checkId, expectation}`; tool
checks need no synthetic hidden marker.

`controls.json` is `{accept: [...], reject: [...]}` with at least 5 known-correct and 5
deliberately incorrect rows, each meaningfully different. Every row has `id`, `taskId` and
`artifact`; a reject adds `mutationClass` and `expectedCheckId`, and may override hidden
expectations by check id. Accepts pass under their task's own hidden rows. Build each reject from
the same task's accept with one fact changed so that its expected check fails, choosing the
mutations a careless or dishonest solver would produce in this field. A reject that differs from
its accept in several facts proves nothing about the check it names, since any of them could be
what failed. Give every check at least one such reject, so that each check is seen to say no, and
every limit or clause a check enforces its own reject crossing it: a check holding a cap and a
clearance, whose rejects all break only how the answer reports a value, has never been seen to
enforce either. A join reject carries `targetsJoin` plus `decoyClass`. The census reruns every
control against the submitted tasks and evaluator, so settle limits and checks first.

Calibrate every check in both directions. Rejects are invalid variants it must fail; accepts
include valid variants it must pass, answers obtained independently of your reference, such as
another practitioner's construction or an equivalent spelling of yours. A check that fails a valid
answer is an evaluator defect however many rejects it catches.

## Harness tests

Extend the tracked `correctness-model/harness.test.ts` and `evaluator.test.ts` and run them with
`.toolchain/bun --preserve-symlinks --no-env-file test correctness-model/harness.test.ts correctness-model/evaluator.test.ts`.
The seed's `evaluateCheckProgram` projects inputs and aggregates your checks beside the reference
solve, and its last test runs each accept control through a stub runtime applying the host's
tool-request contract. These prove neither process confinement nor installed tool execution:
supply a `tools.run` double here and let `correctness_check` run the real tool. A skipped
placeholder is missing evidence.

## Agent tool list contract

`agent/tools-spec.json` declares the domain tools the agent receives:

```text
{"presets": [<preset id>], "tools": [{"name": string, "kind": string, "description": string, "conformanceArguments"?: object}], "declined": {<preset id>: <reason>}}
```

- `starter-pack/add-ons.json` lists each add-on and what it adds. Select one of `files` and
  `shell`, since both carry the shell the solver needs: take `files` when the answer is
  files, `shell` otherwise, and record the other in `declined`. `public-data` composes with either
  and is worth taking when a task carries more public data than a solver reads by hand.
- Never list or implement a preset tool, nor a starter tool: `save_candidate`,
  `restore_candidate`, `inspect_draft`, `preview_artifact`, `submit`, `read_public_resources`.
- `kind` is `reader`, `writer`, `artifact-writer` or `advisor`; a row has no other key. Names are
  unique, and two jobs get two tools rather than a `mode` parameter.
- Conformance calls every tool once per task with arguments derived from its schema. When a
  `pattern` or exclusive bound admits no derived value, declare one accepted argument object as
  `conformanceArguments`, for example `{"code": "S355"}`, and keep the schema.
- Control filenames stay examples; submission accepts any safe relative path a solve invents.
  Without `files`, writers must not call `setFile`, `deleteFile` or `replaceFiles`.
- A name or description offering the installed tool, toolchain or compiler identity is refused;
  a version the public task requests is fine.
- Every public requirement the agent must act on stays reachable through the public task, a
  reader, a public method or a draft-derived adviser, and the system prompt's rules on what a
  tool may claim, add and withhold bind every tool here.
- An adviser computes what it returns by the rule its check applies, with every constant, iteration
  count and procedure the public task determines. Approximating a rule you could compute is a
  defect no disclaimer cures: the solver optimises against the number returned, so an adviser
  answering a second-order limit to first order sends every solver over it. Where the public input
  leaves an effect open, name it and its direction in the returned text. A fast screening adviser
  beside a slow exact one is fine; generated tools cannot start processes.

```json
{
  "presets": ["shell"],
  "tools": [
    {"name": "list_staff", "kind": "reader", "description": "Lists this task's staff and shifts with their qualifications."},
    {"name": "record_assignments", "kind": "artifact-writer", "description": "Writes the chosen staff-to-shift assignments into the draft artifact."}
  ]
}
```

## Agent tool code contract

`agent/tools.ts` implements exactly the tools `agent/tools-spec.json` names, each with its
declared description; the probe refuses any difference. It may import `@ana/agent-bundle`,
`@ana/correctness-model-prims`, `@earendil-works/pi-ai` and its own modules under `agent/`.

- Export `createDomainHarness` typed as `DomainHarnessFactory`. It receives the public task
  (`{taskId, family, publicInput}`, `publicInput` typed `unknown`) and returns `{ tools }`, each
  built with `defineDraftTool`. A `writer` or `artifact-writer` sets `executionMode: "sequential"`.
- `run(params, draft)` returns `{ text, details? }`. `text` is all the agent reads and states the
  scope the call checked or changed; `details` reaches only the trace and the host. The
  controller replaces an `artifact-writer`'s parameters and callback with the compiled public
  schema and an exact materialisation: do not call `draft.setArtifact` or keep a second answer
  schema. Prepare nothing and call no `submit` while the harness loads.
- The build check runs every tool once, writers included, with minimal schema-valid arguments
  against the real draft; every non-writer parameter schema must admit one deterministic minimal
  instance. A hand-written `draft` stub accepts calls the real draft refuses.

```ts
import { type DomainHarnessFactory, defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";

export const createDomainHarness: DomainHarnessFactory = (task) => {
  const input = task.publicInput as { staff: Array<{ id: string; qualification: string }> };
  return {
    tools: [
      defineDraftTool({
        name: "list_staff",
        label: "List staff",
        description: "Lists this task's staff and shifts with their qualifications.",
        parameters: Type.Object({}),
        run: () => ({ text: JSON.stringify(input.staff) }),
      }),
      defineDraftTool({
        name: "record_assignments",
        label: "Record assignments",
        description: "Writes the chosen staff-to-shift assignments into the draft artifact.",
        executionMode: "sequential",
        parameters: Type.Object({}),
        run: () => ({ text: "prepared the exact public assignments" }),
      }),
    ],
  };
};
```

## Agent operating guide contract

`agent/BUILT_AGENTS.md` offers domain guidance and is appended to the agent's system prompt once
per task, so keep it short. The system prompt owns the universal rules and
`agent/tools-spec.json` owns what each tool does; the guide explains how tools combine and how
results inform the next decision, for every task in the battery, and leaves the solving method to
the solver. Reusable algorithms are allowed; task identifiers, copied task text, answers, hidden
facts and protected verifier behaviour are not. State rules
and tool behaviour, not how limits were set or how hard the tasks are. A `ruleDecisions` row you
declared private belongs nowhere in this file: writing its recipe here in your own words publishes
it as surely as copying the row.

The solver's shell has no `.toolchain` directory and no workspace: each command runs in a fresh
folder, and what reaches it is the programs in `.toolchain`'s `bin` directories, by name on its
PATH with `.toolchain/bin` first. So the guide names a program by the name that runs it, never a
path into `.toolchain`, a virtualenv to activate or a file under `correctness-model/`. Give a
configured wrapper the tool's own name in `.toolchain/bin`, because the solver calls a tool by that
name, and a raw binary answering to it elsewhere on the PATH runs without your configuration. The
host's `python3` carries no numpy or scipy you can count on, so expose an interpreter whose
libraries a search needs as a program in `.toolchain/bin`.

```markdown
# Operating Guide

## Workflow

Use `list_staff` for the staff and shift qualifications before assigning anyone.
`record_assignments` writes the chosen assignments into the draft; it does not check that every
shift is covered.

## Completion

Recheck affected shifts after changing an assignment.
```
