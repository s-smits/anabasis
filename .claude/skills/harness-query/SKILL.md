---
name: harness-query
description: Invoke an already-built Built Harness on one or more queries, without building a new one. Use when the operator points at a domain bundle and asks to run a task, a family, or a query they wrote, through it.
---

# Harness query

Use this when a Built Harness already exists and the operator wants to see it answer something.
It builds nothing: no Builder session, no campaign, no adoption decision. Making a new harness is
`bun run fullrun -- --prompt "..."`, a different and much larger spend.

## How it works

Every bundle keeps the starter-pack layout (`starters/pi-built-harness`): `agent/` plus
`correctness-model/tasks.json` and `correctness-model/controls.json`, recorded by an optional
`conformance.json`. Bundles recorded before 2026-08-20 spell the model directory `grader/`; the
script reads either. Because the layout is shared, one wrapper serves every bundle. The script
runs four steps:

1. **select** the tasks — recorded ones you name, or written queries wrapped into task shape;
2. **derive** a probe bundle — a copy in `.scratch/harness-query/<runId>/` made self-consistent
   for exactly that battery;
3. **measure** through `measureHarness` from the tree under test, `shipping-only`, judge off —
   the same function the controller calls for a climb battery, so the solve path, isolation wall
   and host verifier are the product's own;
4. **report** per-case verdicts, the artifact paths, and `harness-query.json`.

Only step 2 knows the bundle layout. Three product guards would otherwise refuse a narrowed
battery, and the derivation answers each honestly instead of weakening a check: the copy's
`tasks.json` becomes the selection (its own honest task-set hash), `conformance.json` is dropped
(the claim then says `conformance-unprobed`), and the control corpus keeps only rows bound to
tasks that still run. The adopted tree is never written to; the guards stay untouched in source.

**Which harness.** Name a bundle by its adopted version (`campaigns/<campaign>/versions/<name>`),
not by an epoch commit: a Builder session's gate commits usually carry the harness it started
with. The adopted versions are the directories under `campaigns/<campaign>/versions/`; order
them by recorded commit time, never by directory mtime. An adopted version whose `.toolchain` link dangles (the epoch trees were
removed on 15 September for the truss project) cannot be selected by the product until the tool
tree is back.

## Usage

Find the bundle (a directory with `agent/` and `correctness-model/`, or `grader/` in older
bundles, usually `domains/<slug>/`), then list —
free, no model turn:

```sh
bun .claude/skills/harness-query/scripts/harness-query.mts \
  --harness domains/<slug> --list
```

Read each task's `publicInput` keys before writing a query: most bundles take a structured object,
not free text. Then invoke — an unnamed selection is refused rather than spending the whole
battery by accident:

```sh
bun .claude/skills/harness-query/scripts/harness-query.mts \
  --harness domains/<slug> --task <taskId> --model claude-opus-5 --effort medium
```

Selectors: `--task <id>` (repeatable), `--family <name>`, `--all`, `--query <text or json>`
(repeatable), `--queries <file>`. Pins: `--model`, `--effort`, `--max-built-turns`. `--json` prints the
machine-readable report. Run the helper through a prepared checkout's `scripts/worktree.sh run`,
using the repository's pinned Bun, so the dynamic import binds the tree under test.

## The judge

The battery runs with no reviewer unless `--judge` names one, and each backend lives in its own
file under `judge/`, so switching is a flag rather than an edit:

| `--judge` | reviewer | spend |
| --- | --- | --- |
| `off` (default) | none; the battery records `judge:"off"` | none |
| `configured` | the repository's own review slot, resolved exactly as a real battery resolves it | that account's credential |

`--judge-model` and `--judge-effort` name the reviewer; `judge/README.md` describes both backends.
Judge verdicts stay advisory here as everywhere: the host verifier decides each pass, and this
skill writes no claim.

Measured: one recorded task of `consumer-hardware-f8714546` on `claude-opus-5` at medium effort took
43 seconds and returned 1/1 graded pass.

## Written queries

`--queries <file>` reads the shapes people paste, without a format flag: a JSON array or object,
one JSON object per line, a CSV with a header row, or one plain query per line. A row may be a
whole task (`taskId`, `family`, `publicInput`, `hidden`) or a bare `publicInput`, which gets a
generated id, the family from `--family` or the bundle's first task, and no hidden expectations.

A harness checks the shape it was authored for, so a written query is fitted to that shape before
it runs. It borrows the structure and omitted values from a recorded task in its family:
free text goes into the template's text field (`objective` and similar, or the first string field),
an object's own fields override the template's, and a template `caseId` is replaced by the query's
own id. What was filled is printed before the run.

`--fit` chooses the behaviour: `template` (default, as above), `strict` (refuse a query that does
not already match, naming the fields it lacks), and `raw` (send exactly what was written). Use
`raw` to probe how the harness behaves on an input nobody authored — that is what surfaced the
oracle defect below — and `template` when you want the query answered.

A written query has no controls, so recorded tasks accompany it as anchors. The script selects
one task carrying both accept and reject controls, or two when those controls belong to different
tasks. Each anchor costs an extra solve. These controls exercise the recorded task; they do not
calibrate the new query's expected answer.

Shaping can satisfy the input schema; it does not establish correctness or answerability. Measured on 2026-08-14: the
ESP32 plane-radar query above was written into the `objective` of a desktop-parts task and passed
2/2, but the artifact it produced was a desktop build — cpu, board, ram, gpu, psu — because the
template's catalog, requirements and rules are what the agent actually solves against. The
injected text moved almost nothing. Read a templated pass as "the harness completed its own kind
of task", never as "the harness answered my question".

That is the honest limit of this skill: a harness is a domain and its grader together, so a query
outside that domain has no gradeable meaning inside it. To get a real answer to an out-of-domain
question, build a harness for that domain with `bun run fullrun`.

State the evidence limit plainly. Written queries default to `hidden: []`. Under the current
`check-program/v1` contract, a required hidden operand that is missing refuses execution; it does
not remove that check from the denominator. Older bundles used different applicability rules. In one
historical run the anchor failed against its hidden expectations while the written query returned
`{"ok": true, "issues": []}` — same harness, same model, one verdict carries discrimination and
the other does not. When the question is "can this harness do the job", use recorded tasks; use
written queries to see behaviour on a shape nobody authored.

## Expect a first refusal on an unfamiliar bundle

The Harness Builder authors each bundle, and the layout details drift between generations: one
bundle binds every control to a task, an older one binds none; hidden expectations, families and
input shapes all vary. So a first invocation of a bundle generation this script has not seen may
be refused. That is the working loop, not a fault:

1. run it; if it throws, read the message and the record it points at
   (`runs/<runId>/battery.json` in the probe copy holds `terminalReason` and findings);
2. compare what the guard expected against what this bundle's model files actually hold —
   the mismatch is always visible in those bytes;
3. adapt the derivation or selection in the script (`deriveProbeBundle` and `selectTasks` are the
   two places), keeping the rule: make the probe copy honest, never weaken a product guard;
4. rerun. Selection mistakes cost nothing — the product refuses before any model turn is spent.

Two adaptations are already built in from bundles measured so far: a task-bound control corpus is
narrowed with the battery and written queries get recorded anchor tasks, while a task-unbound corpus
(older generation) is carried whole and needs no anchor.

One drift the script cannot bend around: a brief written in an older predicate vocabulary (for
example a `controlReference` field the current validator refuses) fails validation before any
turn is spent. Rewriting the brief would change the grader, so do not. Either point `--repo` at
the source generation that adopted the bundle, or pick a bundle the current tree accepts —
check `correctnessContract` and the declared check inputs in the brief. The absence of one retired
field does not establish compatibility with the current contract.

One drift that is not the bundle's fault: its declared tools may not exist here. Every committed
bundle links `.toolchain` into a campaign workspace that has since been removed, so tool
resolution falls through to the host PATH. A bundle whose checks name only `clang++` measures
normally; one naming `platformio` resolves nothing, every applicable check throws, and the
control census records 29 of 29 controls as `non-result (verifier-throw)` and refuses with
`DISCRIMINATION_NOT_PROVEN`. That reads as a bundle defect and is a missing program. The script
now names the unresolved tool ids and refuses first, before the probe copy and before any turn.
Install the tool or measure a bundle whose declared tools this host has.

Recorded bundles written before the solve-side package was renamed to `@ana/agent-bundle` kept
the old specifier, so `fingerprintSlug` refused every one of them with `unvetted-import` before a
turn was spent. Those bundles were rewritten in place on 18 September rather than shimmed at read
time, so the name on disk is the name that resolves. The guard keeps its full strength: a bundle
importing anything outside the vetted list still refuses, as it should.

## Spend and evidence

The Built slot spends turns, the judge spends them only when `--judge` names one, and no Builder
session exists. All three slots are still resolved, so `backends.json` names them — catalogue resolution, not spend. Before
running, check that no live `fullrun` spends the same credential; running both starves them.

Expect the claim to be refused on a narrowed battery (`TRUTH_CHECK_NEVER_FIRED` and similar): one
task does not exercise every truth check, and that is correct. The result is the per-case verdict,
never a claim, an improvement, a climb or a promotion. The controller owns `domains/` and
`campaigns/`; do not hand-edit what this writes.
