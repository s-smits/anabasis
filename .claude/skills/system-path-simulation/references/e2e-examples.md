# Worked examples

Records of simulations that earned their cost. They exist so the next session can calibrate depth
before writing a script: this is what "deep enough" looked like, and what each one caught.

These are historical examples. Source owns the current exports and signatures; names such as
`fingerprintSlug`, `readDifficultyEvidence`, `admitVerifierProposal` and `climbScopeFeedback` may no
longer exist at the measured revision. Read the current module before adapting an example.

Whole mechanisms moved too. The repair experiment, the Repair Engineer, the Progress Guard and the
paired candidate-versus-current contest were removed on 2026-09-04. An example below that selects a
`repair` move, spends a repair packet or reads a `-repair-on`/`-repair-off` variant records a run
measured before that date. Later source changed the selector again. Check the measured revision for its available moves.

Since 2026-09-11 the one stub of example 1 has an owner in source: `HarnessBuildOptions.builderRuntime`
binds a scripted session into the real build stage, `test/full-run-scripted-loop.test.ts` runs the
whole controller loop through it with no provider, and `scripts/run-condition.mts` runs one real
round over a seeded campaign with each slot live or scripted. Example 8 below is the last condition
built by hand and the reason those exist.

The order below is deliberate: example 1 is the depth bar for a scenario simulation, example 2 for
an end-to-end role-play, example 3 for a live rehearsal. Examples 4 and 5 are the cheap shapes,
kept to show when a scenario is not needed. Example 7 is the one that was skipped: the layer walk
that has to happen before any of the others are worth paying for.

---

## 1. Scenario simulation — the depth bar

**Situation (run 67, 2026-08-05).** "I adopted a 25-task firmware harness and it scored well. The
selector now wants a climb, so I am opening a climb round against my own frozen bundle. Does
climbing actually hold, or does something slip through and spend a paid battery?"

**Real steps invoked, in production order:** `runAuthoringLoop` → `runBuildRound` →
`loadHarnessSnapshot` → the real probe pack (`makeAgentToolsProbes`, including the real conformance
probe) → the real record → the real commit, over a real adopted domain tree copied into scratch.

**Stubbed:** the model turn only. Each scenario supplies the exact JSON a battery session would
have returned. Nothing starts a provider or writes outside its own scratch directory.

**Coverage: eight scenarios, hostile ones first.** This is the part that made it work — the six
benign scenarios confirmed what was already believed and the two adversarial ones found the breaks.

| Scenario | Question |
|---|---|
| `harder-battery` | does a clean climb round record, keep harness identity, re-attest conformance? |
| `same-battery` | does re-authoring the adopted task set terminate, or loop? |
| `level-omitted` | is a battery ignoring the pinned level refused, and does it burn iterations? |
| `adopted-tasks-relabelled` | adopted tasks unchanged except the pinned level: is the stale set caught before spend? |
| `empty-battery` | does a zero-task response refuse instead of silently keeping the adopted set? |
| `short-battery` | does a battery below the ask size refuse, and at which stage? |
| `session-writes-frozen-bundle` | is a session that rewrites `agent/tools.ts` restored before the record? |
| `session-writes-correctness-model` | is a session that rewrites `correctness-model/evaluator.ts` restored before the record? |

**What it caught.** Three breaks, none of which any test or gate held:

1. **Relabelling passes every gate.** The adopted 25 tasks, byte-identical except `level: 1` added,
   were build-admissible: fingerprinted, `taskSetMoved=true`, conformance run over the *original* ids.
   The level byte moves `taskSetHash`, so even a hash-inequality check would not catch it. A climb
   that only relabels was indistinguishable from a real climb and would have spent a full battery.
2. **A repair round inherits the climb's pinned difficulty contract.** On a real tree the decision
   was `repair`, yet the kickoff still carried `{"difficulty":{"currentLevel":null,"nextLevel":1}}`;
   the fresh Builder was never told about levels. Measured against the real validator: 25 of 25
   tasks refused.
3. **Cross-battery saturation was unreachable.** Both saturation findings were gated on
   `levels.length >= 2` *within one battery*, and a one-level climb battery has one level.

**The script.** Reproduced in full because its shape is the transferable part — the scenario table,
the single stubbed `agent` callback, the probe wrapper that counts real calls, and the identity
comparison against a seed record taken before the round.

```ts
/**
 * Throwaway climb simulation for run 67. Deleted after the run.
 *
 * Drives the REAL frozen-climb path — runAuthoringLoop → runBuildRound → loadHarnessSnapshot →
 * real probe pack → real record → real commit — over a REAL adopted domain tree. The only stub is
 * the model turn: each scenario supplies the exact JSON a battery session would return.
 */
const ADOPTED_TASKS: BuildTask[] = JSON.parse(
  readFileSync(join(ADOPTED_SRC, "correctness-model/tasks.json"), "utf8"),
);

/** The real climb kickoff: the ask text plus the difficulty contract, as produced by the
 *  selector over this domain's own recorded tree (example 4 below). */
const KICKOFF = readFileSync(process.argv[2] ?? "", "utf8");
const TARGET_LEVEL = 1;

interface Scenario {
  name: string;
  question: string;
  tasks: BuildTask[] | "adopted" | "empty";
  /** Mutate the workspace inside the session turn, as a real Builder could. */
  duringSession?: (workspace: string) => void;
  expectedTasks?: number;
}

async function run(scenario: Scenario): Promise<Result> {
  const adopted = seedAdopted();               // agent/ and correctness-model/ only, as the climb sees it
  const seed = fingerprintSlug(adopted, { slug: SLUG });
  if (!seed.ok) throw new Error(`adopted tree cannot be fingerprinted: ${JSON.stringify(seed.findings)}`);

  // THE ONE STUB. Everything downstream of this callback is real.
  const agent = async (call: AgentCall): Promise<string> => {
    if (call.role === "tests") {
      scenario.duringSession?.(workspace);
      return JSON.stringify({ tasks });
    }
    return JSON.stringify({});   // benign, so the round under test is the only thing measured
  };

  const outcome = await runAuthoringLoop(
    { campaignDir, slug: SLUG, kickoff: KICKOFF, reuseFrom: adopted,
      expectedTasks: scenario.expectedTasks ?? ADOPTED_TASKS.length },
    {
      agent,
      maxIterations: 2,
      maxAttempts: 1,
      toolsProbes: (slugDir) => {
        const real = makeAgentToolsProbes(slugDir);   // REAL probes, wrapped only to count calls
        return {
          ...(real.load === undefined ? {} : { load: real.load }),
          ...(real.conformance === undefined ? {} : {
            conformance: (spec, probeTasks, schema) => {
              probeCalls += 1;
              conformanceTaskIds = probeTasks.map((task) => task.taskId);
              return real.conformance!(spec, probeTasks, schema);
            },
          }),
        };
      },
      gates: async () => [],
      onPhase: (phase, ok, attempts) => phases.push(`${phase}:${ok ? "ok" : "refused"}:${attempts}`),
    },
  );

  // Did the workspace keep the adopted bytes the climb froze?
  const frozenHeld = (["agent/tools.ts", "correctness-model/evaluator.ts"] as const).every(
    (rel) => readFileSync(join(workspace, rel), "utf8") === readFileSync(join(adopted, rel), "utf8"),
  );
  const fingerprinted = fingerprintSlug(workspace, { slug: SLUG });
  return {
    scenario: scenario.name,
    buildAdmissible: outcome.buildAdmissible,
    frozenHeld,
    identityHeld: fingerprinted.agentHash === seed.agentHash && fingerprinted.correctnessModelHash === seed.correctnessModelHash,
    taskSetMoved: fingerprinted.taskSetHash !== seed.taskSetHash,
    conformanceTaskIds,      // which ids the real conformance probe actually saw
    probeCalls,              // 0 proves a refusal happened before spend
    /* … stages, phases, findings, clauses … */
  };
}
```

**Two artifacts this run produced, and how they were caught.** Both looked like product findings:

- `Cannot find module '@ana/agent-bundle'` — the scratch workspace sat in `/tmp`, so nothing walked
  up to a `node_modules`. Re-seating the scratch tree inside the worktree removed it.
- `level-omitted` appeared to pass. The helper was typed `level: number | null = TARGET_LEVEL`, so
  passing `undefined` triggered the default and shipped the level it claimed to omit. The same pass
  also never supplied `expectedTasks`, which the real caller always supplies.

Neither was reported. The rule they produced is in the skill: name the production caller and
confirm it passes the same arguments your script passed.

---

## 2. End-to-end role-play — play the actor's whole sequence

**Situation (2026-08-07).** "I fetched a checker archive into the workshop cell, compiled it and
smoke-tested it. Now I am proposing it, and the controller is about to replay and pin it. Does a
Builder-recorded verifier proposal admit end to end?"

This one plays the Builder by hand: it issues the exact tool calls, in order, that a Builder
session would issue, then hands over to the controller. No model is involved at all, because the
question was about the *path*, not about what a model would write.

**Real steps invoked, in order:** real seatbelt-walled workshop `fetch` → real `run` × 4 (`mkdir`,
`tar -xzf`, `cc -O2`, `chmod`) → real `run` smoke test piping a wire-protocol request into the
compiled binary → real `propose` tool schema → real `admitVerifierProposal` with the default
`runWalled` → real `createVerifierHost` probing the real compiled C binary.

**Stubbed:** the network fetch only, through a `sourceBroker` returning a locally staged
`tar.gz`. The wall, the compiler, the binary, the wire protocol and the admission replay are all
real.

```ts
/** Throwaway simulation: real workshop → real propose → real admission → real host probe. */
const workshop = createVerifierWorkshop({
  root: ossRoot,
  receiptPath: join(epochDir, "verifier-workshop.jsonl"),
  policy: deriveCandidateWall(binding, "workshop"),   // the REAL wall
  ledger: openPathLedger(epochDir, "sim-builder"),
  sourceBroker: broker,                               // the ONE stub: a locally staged tar.gz
});

const fetched = show("fetch", await workshop.fetch("https://example.com/hemlock-checker.tar.gz"));
const setupCommands = [
  `mkdir -p src bin`,
  `tar -xzf downloads/${archiveSha}.source -C src`,
  `cc -O2 -o bin/verifier src/checker/main.c`,
  `chmod +x bin/verifier`,
];
for (const command of setupCommands) show(`run: ${command.slice(0, 40)}`, await workshop.run(command));
show("smoke", await workshop.run(
  `printf '{"protocol":"ana-verifier/v1","requestId":"smoke-1","artifact":null}' | bin/verifier`));

const proposed = show("propose", await workshop.propose({ /* the real schema, every field */ }));

// Controller side: REAL runWalled, REAL verifier host — no overrides.
const pinned = await admitVerifierProposal({
  repoRoot, slug: "hemlock", epochDir, ossRoot,
  proposalDigest: proposed.result.proposalDigest,
});
if (pinned.identities["hemlock-conformance"]?.engineName !== "sim-checker")
  throw new Error("pinned identity did not come from the compiled binary");
console.log("SIMULATION PASSED");
```

**What it caught: five genuine wall defects**, none reachable by any unit test, because each needed
a real compiler running inside the real sandbox:

1. the xcode-select developer-dir links were denied, so every CommandLineTools shim died as
   `Executable ""`;
2. `xcrun` and `clang` write to the Darwin per-user temp and cache dirs regardless of `TMPDIR`;
3. `clang` needs metadata on its binary's ancestor dirs to realpath itself;
4. `workshopEnvironment` put the CLT `usr/bin` ahead of `/usr/bin`, so direct clang ran without
   `SDKROOT` and could not find `<stdio.h>`;
5. the new `verifier-admission` measured prefix denied the controller's own replay inside its cell.

After the fixes the simulation pinned `engineName: sim-checker` from the compiled binary's own wire
response, with no overrides. The one thing it explicitly did **not** answer, recorded as carried
forward: whether a live Builder writes a valid proposal from the tool schema and prompt alone.

---

## 3. Live rehearsal — real prompts, split across the boundary

**Situation (wave 5, 2026-08-12).** Three commits changed model-visible text. Unit tests prove
delivery, not what a real Builder does with them. "Do the new kernel gates refuse a battery a
practitioner would call sound?"

**Historical setup.** Two detached worktrees at the exact PR head, `.env` symlinked, own
`node_modules`. Current rules prohibit copying or linking configuration from another checkout; use
the owning configuration workflow. The recorded launch used
the real entry with a real one-liner:

```sh
bun run fullrun -- --prompt "seating chart planning for weddings with guest conflict constraints" \
  --expected-tasks 8 --max-iterations 1
```

**The prompts were chosen to split the boundary**, which is the transferable idea:

- A: `seating chart planning for weddings with guest conflict constraints` — naturally a
  collection/subset artifact with many valid answers, stressing non-vacuous counting.
- B: `shortest unique prefix tables for command-line abbreviation` — one derived unique answer,
  stressing the canonical-tie-break uniqueness kinds and the same join from the other side.

**Pre-registered predictions**, written to `notes/rehearsal-wave5-kernel-gates.md` *before* launch,
each with an explicit falsifier, plus a closing list of conditions intentionally left untested
(measured battery outcomes, climb behaviour, judge review, non-claude slots). The stop rule was
named in the note too: the first recorded iteration's conformance, task-quality and F2 receipts.

Two operational facts worth carrying: the per-credential lock refuses a second concurrent
`fullrun`, so run B was launched by a watcher when A completed its record; and the Builder effort default was
`xhigh`, pinned down to `medium` via `CLAUDE_BUILDER_REASONING_EFFORT` after checking the
transport's own vocabulary.

**The cautionary record is 70c.** It answered its question at minute 30 of a round budgeted for
hours: `git status --short` in the epoch workspace showed all seven bundle files modified on a
round whose legal interface was `correctness-model/tasks.json` alone. The operator stopped it there. Everything
after that point would have confirmed a hold the new submit-time closure already prevents. What 70c
should also have done: pass `--expected-tasks 8` to shrink the battery it would have paid for past
the decisive fact.

---

## 3b. Seeding an actor at a later stage — the kickoff itself

When a scenario skips ahead instead of opening from scratch, the seed text is a model-visible
surface and has to be written like one. The shape below mirrors `directKickoff` plus the stage
contract a climb round appends, with the completed stages stated as fact and the skip disclosed.

```text
USER REQUEST (verbatim)
Build a harness for consumer-hardware firmware tasks: select parts from a catalog, wire them, and
write firmware meeting each task's behaviour.

<the real context manifest, from contextManifest(), unedited>

<the real operating instruction directKickoff() appends, unedited>

SIMULATED POSITION — this session was seeded, not lived.
You were in an adopted level-0 harness after researching the domain, authoring the bundle and
scoring 23/25 on 25 tasks. The research and authoring turns were skipped; the workspace you see is
exactly as those completed stages left it.
The controller has now selected an adjacent climb against that frozen bundle.
Under test this round: the only interface you may write is `correctness-model/tasks.json`. Everything under
`agent/` and the rest of `correctness-model/` is frozen.

<the difficulty contract, byte for byte from the selector — never retyped>
```

Four properties make it usable, and dropping any one of them cost a recorded finding:

- the user request is the **real one-liner, verbatim**, so any finding transfers to the paid run;
- the completed stages are stated, so the actor does not re-derive them and spend turns;
- the skip is **disclosed** rather than staged, so the behaviour is reproducible;
- the contract appendix is taken from the real assembler, so the bytes match what production emits.

This is A followed by B, not an assignment to produce C. Put the expected climb response C and its
plausible alternative D only in the hashed prediction note. When the transition sentence is
authored rather than rendered by the real controller, pair this condition with the same seed and contract
without that sentence, then with the smallest legitimate counterfactual B′ whose correct response
changes. If B and B′ produce the same response, the model did not demonstrate that it understood
the transition.

Attribute afterwards. The `SIMULATED POSITION` block is your text, not the product's: if a
behaviour disappears when it is removed, the finding is about your prose. Move it to a different
surface and re-run before reporting.

## 4. Deterministic staging check — when one fact really is one fact

**Question.** After a held repair spends its admission packet, does the disk selector read the
recorded evidence and choose the climb? A wrong answer would launch a paid run into a `measure` round.

**Method.** Copy the campaign and domain state for the slug into a scratch worktree, then run one
throwaway script inside the run tree against the copies. The exported boundaries, from that tree:
`spendAdmission` / `latestAdmission`, `readDifficultyEvidence(domainDir, runPin, claimsDir)`, and
`decideNextMove` / `selectNextMoveFromDisk`.

The script marked the copied packet spent, asserted `latestAdmission` then returned null, read the
difficulty level evidence and printed the decision. Output: action `climb` to L1, rationale "pass-rate interval
floor 0.750 sits above the target ceiling 0.5 … significantly too easy (23/25)", one battery
excluded as recorded under variant repair-off. Verdict: `cleared`.

This script also produced the real kickoff bytes that example 1 consumed as `process.argv[2]` — a
cheap check feeding the expensive scenario is the normal pairing.

## 5. Offline replay — would the shipped check have refused the observed tree?

**Question.** The live 70c Builder modified seven bundle files on a tasks-only round. Does the new
submit-time closure refuse exactly the six frozen interfaces and pass the task set?

```js
import { climbScopeFeedback } from "./src/author/feedback-routing.ts";
const paths = ["agent/BUILT_AGENTS.md","agent/tools-spec.json","agent/tools.ts",
  "correctness-model/brief.json","correctness-model/controls.json","correctness-model/evaluator.ts","correctness-model/tasks.json"];
const fb = climbScopeFeedback(paths, "replay-70c");
console.log(JSON.stringify(fb?.[0]?.findings?.map(f => f.path) ?? null));
```

Output: the six frozen paths, with `correctness-model/tasks.json` absent. This replay replaced the remaining
two thirds of a live rehearsal — the run was stopped instead of spending a 25-case battery to
confirm a hold the closure now prevents.

The pattern generalises: any workspace diff, live or historical, replays through the scope-feedback
functions at no cost. Take `changedPaths` from `git status --short` in the workspace or from
`iteration.json.workspaceChange`.

## 6. Skipping the check on purpose

From the run 72 settlement rehearsal: "I skipped rehearsing the `loopTerminal` boolean continuation
— `test/full-run-loop.test.ts` already pins it, and rehearsing a checked boundary buys nothing."

Recording what you deliberately did not simulate, and why, belongs in the result.

## 7. Layer walk — the two-day propensity finding that was a dropped field

**Question.** The Builder prompt tells the session to acquire the tool its domain really uses and
declare it as a candidate engine. Across three prompt versions and two backends, every session
wrote its own substitute interface instead. Is that a judgment the model makes, or something the
product cannot carry?

**What went wrong first.** The question was answered three times by launching another live condition with
another prompt wording. Each condition cost a full authoring session, each reported the same refusal, and
the reported cause each time was propensity. Nobody read the layer under the instruction.

**Method.** Walk the stack under the instruction bottom-up, with the artifact the prompt actually
implies — here a real firmware toolchain, not a fixture:

| Layer | The function and file that carries it | Read? |
|---|---|---|
| the instruction's words | the acquisition clause in the Builder start prompt | yes |
| the submitted declaration | `correctness-model/engines.json` in the candidate tree | yes |
| the rebuild | `parseCandidateEngineRegistry`, `src/verify/candidate-engine-registry.ts` | **no** |
| admission | `admitEngine`, `src/truth/engine-admission.ts` | no |
| the OS wall | `prepareVerifierReads` / `seatbeltProfile`, `src/verify/darwin-seatbelt.ts` | **no** |
| the evidence record | the case record writer | no |

Two of the six were carrying the failure.

**Layer three.** The rebuild kept six fields of the parsed spec and dropped two: `allowedEnv` and
`sandboxReadRoots`. A real toolchain keeps its platform files in a directory of its own and finds
them through one variable, so an engine that can declare neither cannot drive one however well it
is installed — while a self-written interface compiled by a host compiler needs neither. The
instruction was impossible and the substitute was the only route that worked. Listing the output
fields against the input fields, per rule 1 of the layer walk, takes about a minute.

**Layer five, found only with the real artifact.** With the two fields carried, a hand-driven check
installed `arduino-cli`, declared it, and compiled a sketch through the production exports. It
returned `outcome: "sandbox"`, `engine … sandbox identity changed after its policy-application
canary`. The wall walked and structure-hashed every declared read root before and after the run and
refused any difference. Every existing test passed because each declared a temp directory nothing
was writing to; a 1.8 GB toolchain rewrites its own index on every invocation, so no real compiler
could ever have produced a verdict. This is rule 3: a fixture holds still, the real artifact does
not.

**Result.** Both were source defects, both fixed, and the fix was confirmed the same way it was
found — by hand, with no model in the loop: `"ok": true`, `Sketch uses 924 bytes (2%) of program
storage space`, `outcome: "verdict"`. Only then was a live condition worth launching; it installed a real
36 MB toolchain and a full AVR core within two minutes of starting, against a control condition on the
old code that had written into its own brief that such tools "are not present on the verification
host".

**Verdict.** `refuted` — the propensity finding of all three earlier conditions. The cost of the wrong
answer was two days and five paid sessions; the layer walk that would have prevented it was free.

---

## 8. Seeded controller round: the condition that became the runner

**Situation (2026-09-10, Astra medium, firmware -38).** "The corrected source changes what the
Builder is told after a measured battery: public history across model conditions, and rebuild
advice without private diagnosis prose. Does the real handover reach an adopted-product session,
and does the session's accepted scope bind to what it actually changed?"

**Real steps invoked, in production order:** `selectNextMoveFromDisk` over the original read-only
campaign → `runBuildStep` with its advice and history handover → `buildHarness` →
`productionBuilderRuntime` → `runBuilderCampaign` → the actual submit, census (33 accepts, 39
rejects) and solvability (25 passed, 0 failed) → `publishProductVersion` and selection. Nothing
was stubbed; one thing was redirected: `deps.build` pointed the build destination at a fresh
campaign so the recorded one stayed untouched (7,958 inventoried rows unchanged afterwards).

**What it caught.** Handover and scope binding both held: the actor kept 25 tasks, chose a product
repair, and its accepted scope was `build` with the proposal digest bound to the accepted bytes.
Public history stayed readable from a broken workspace, and a private-only perturbation of the
advice packet left the rendered prompt byte-identical while a public count change moved it. A
postflight panel through the real host accepted the settled ON-precedence rule and its equivalent
Boolean form and rejected the reversed priority on `scenario-behaviour` alone.

**What it cost, which is the point.** The first attempt opened zero provider turns because its
preflight was blocked; the source moved under the staged condition three times, each needing a
re-frozen preregistration; the first prompt projection was captured in a throwaway epoch and then
string-rewritten to the live workspace path; and the helper carried its own seed cloner, product
publisher, `deps.build` interception, wall, `ps` census and host panel. The 8 and 9 September
conditions carried the same pieces again, one of them with a copied toolchain still naming the
original campaign's absolute Python path, which invalidated that condition's finding.

**Where it lives now.** `seed-campaign.mts` owns the clone, the audit and the republication;
`run-condition.mts --builder capture` records the production first prompt for the seeded slug's own
epoch with no rewriting, and `--builder live` runs the same round with the wall and census;
`host-panel.mts` owns the panel. `cases/seeded-condition.md` is the procedure.
