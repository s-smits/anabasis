---
name: prompt-surface-census
description: Generate and tune an AST-derived census of model-visible text in TypeScript or JavaScript. Use to map prompts, hooks, tool descriptions and feedback with their selecting conditions, verify delivery boundaries, and investigate prompt simplification. The census maps source candidates; recorded requests establish actual delivery.
---

# Prompt Surface Census

Map what a model could read, then follow the important surfaces to their consumers. Do not add
annotations or context lines to source. An AST match, audience guess or file size is a lead, not
proof of delivery or relevance.

## Establish coverage and generate

Resolve the exact repository and revision. Enumerate its top-level directories and inspect what
the workspace copier, prompt composers and tool loaders deliver. Include seed trees and whole
documents, not only compiled source. A copied test file is model-readable even when the source
walker excludes `.test.` files. Name such files explicitly in `--doc`.

Run the extractor through Bun from a prepared Anabasis checkout: it imports that
repository's filesystem, path and process modules. `--root` may name another target repository,
which must supply `typescript`, `typescript5`, or the compiler API named by `--ts`.

```sh
bun <skill-dir>/scripts/extract-prompt-surface.mjs --help
bun <skill-dir>/scripts/extract-prompt-surface.mjs \
  --root /absolute/repository --dir src,starters,vendor \
  --doc starters,starters/pi-built-harness/correctness-model/harness.test.ts \
  --out /absolute/output/prompt-surface.md \
  --json /absolute/output/prompt-surface.json
```

Prefer the target's reviewed `.prompt-surface.json` when present; explicit flags override it.
Check its `dirs` and `doc` against current delivery before relying on a bare `--root` invocation.
`--doc` accepts comma-separated paths. Directories include `.md/.txt/.json/.yaml/.py/.sh`; an
explicit file is included regardless of extension. Each whole-file surface says
`delivered whole (verify)` until its copy or prepend is checked.

Keep output outside controller-owned product state. `--context` is 0–3 preceding non-empty
code lines, default 3; it affects the report alone. Run one complete census and read its Markdown
before handing it over. Focused `--audience builder` reports can reduce subsequent reading.

## Read and classify

For a policy-alignment audit, read [the aligned policy](references/aligned-policy.md) first and
check each model-visible surface against it. Each item there names the constant that owns its
number; check the surface against that constant, because the reference is itself a copy. A
surface that derives its number from the owner cannot drift, so a literal in a prompt string is
the shape worth reporting even when it is currently right.

Start with counts, audience summary, conditional index, known composers and model-call sites,
tool descriptions, `Not claimed by the vocabulary`, and the JSON's largest holder groups.
Classify related holders together as model-visible, operator-only, structural syntax, diagnostic
output or uncertain. Audience labels are longest-prefix path guesses; verify important claims
at the model request, tool result, hook or receipt boundary.

Tune from observed rows:

- `--vocab 'shape|authorJson|feedback'`: a demonstrated model-visible holder family.
- `--strong 'SYSTEM_CARD|firstTurn'`: exact short holders that must remain visible.
- `--deny 'operatorReceipt|sqlText'`: demonstrated operator-only or structural holders.
- `--miss-chars`: probe below the default when short missed text could matter. A missed string
  below this threshold is absent from both tables. Recheck this edge after relevant source changes.
- `--include-tests`: only for tests in scope; explicitly delivered seed tests still belong in `--doc`.

The classifier first tries the holder's last name segment (`strong`, screaming-case constant,
then vocabulary), then its owner. Local variables can inherit their enclosing prompt function;
call arguments belong to their callee. Deny wins except over strong names. Nested claimed holders
are deduplicated except strong matches. Deny uses the head noun: `promptDigest` is a digest, while
`fileLine` may be live text. A large unnamed group indicates missing holder classification in
the extractor and needs investigation before a coverage claim.

## A delivered surface can still be wrong at the size it is rendered

The census answers "could a model read this". It does not answer "does it read correctly with the
numbers this run produces", and that second question has its own defect class: a template that
interpolates a count and then names the counted thing in the plural regardless.

The sizes these sentences actually reach are small. Eleven such sites were found and fixed on
18 September, and two of them were already rendering in the singular inside existing test fixtures:

```text
the same 1 cases failed in both of the last two batteries    (difficulty note)
1 attempts with no accepted submission, 1 runtime non-results (rebuild advice packet)
context/limits.txt (1 lines, sha256:...)                      (Builder context manifest card)
Offset 5 is beyond end of file (1 lines total)                (Builder read tool)
submit 3 (commit ..., 1 findings)                             (submit refusal, closest tree)
... (1 characters omitted)                                    (harness_trial, correctness_check)
(1 characters remain; call again to continue.)                (review source reader)
1 further admitted finding(s) omitted from this packet        (rebuild advice packet)
```

Find them with an AST-free scan of the producers, then read each hit for whether its count can
actually reach one:

```sh
grep -rnE '\$\{[^{}]*(count|length|total|passes|cases|findings|lines|attempts)[^{}]*\} +[a-z]+s\b' src --include='*.ts'
```

Most hits are safe by construction — a battery floor of five, a constant, a branch only entered
above one — so the scan is a lead list, not a defect list. Three questions settle each one: can the
count be one, is the sentence model-visible, and does a fixture already reach it. A hedged
`finding(s)` spelling is the same defect wearing a disguise and hides a live singular; so does a
verb, as in "1 character **remains**". Pin each fix with a case that reaches exactly one, in the
test file that already covers that renderer.

Save earned tuning in `.prompt-surface.json` only within repository-edit authority:

```json
{
  "dirs": ["src", "starters", "vendor"],
  "doc": ["starters", "starters/pi-built-harness/correctness-model/harness.test.ts"],
  "audiences": { "src/author": "builder", "src/review": "reviewer" },
  "vocab": ["feedback"],
  "strong": ["SYSTEM_CARD"],
  "deny": ["operatorReceipt"]
}
```

Record each deny's reason. Anabasis's current six exclusions are `safeguardTriggered`
(operator log/stderr), `renderPage` (human OAuth page), and `configDenyBlocks`,
`privateKeyDenyRules`, `sbRule`, `roots.map` (OS sandbox policy syntax). Recheck consumers if
their delivery changes. Keep controller refusal/error constructors visible as a group: they
may reach models through a public projection or admitted advice. Trace those paths rather than
assuming every recorded error is private or every refusal safe.

Do not deny rows merely to empty the table. Report every remaining group and uncertainty.
Historical counts are comparisons, not classifications that automatically transfer to new source.

## Verify actual delivery

Follow important candidates into the model request, tool schema/result, hook, steering or review
packet. Prefer a recorded request or receipt for what a model *did* see. The AST cannot reconstruct
generated text, files loaded at runtime, database rows, environment values or indirect data flow.

Use an existing production prompt printer when available. Anabasis provides:

```text
bun .claude/skills/system-path-simulation/scripts/show-prompt-surfaces.mts --surface system
bun .claude/skills/system-path-simulation/scripts/show-prompt-surfaces.mts --surface kickoff
```

These import the run tree's `builderSystemPrompt` and `directKickoff`. Steering depends on the
round and has no argument-free printer; inspect its production composition. State which surfaces
were rendered and which were traced only in source.

An eight-character census content digest covers one holder. It cannot be compared directly with
an assembled `promptDigest`, `systemPromptDigest`, `toolSchemaDigest`, `contextDigest` or
`judgeInputDigest`. Identify the composing rows, and claim a digest match only after reconstructing
the exact recorded bytes.

## Finish at the question's boundary

Regenerate after tuning or edits, read the output and check:

- Known relevant producers appear as candidates or reviewed unclaimed rows.
- Model-readable directories and documents were scanned; deliberate omissions are named.
- Conditional surfaces retain their relevant if/else, ternary, switch, short-circuit and
  try/catch context, with at most three preceding code lines.
- Important audiences and delivery paths are checked, and uncertain groups remain visible.

Report exact candidate, conditional, document and unclaimed counts, paths, tuning and lexical
or runtime limits. Compare with a prior census of the same repository when available; investigate
changed groups before explaining a count change. Source size alone does not establish token cost,
reasoning quality or a capability improvement.

## Simplification investigation

Use [the compact investigation prompt](assets/flow-simplification-investigation.md) with fresh
Markdown/JSON evidence from the exact source under review. Add audience extracts only when useful.
Give a reviewer the worktree and evidence paths; for a reviewer without filesystem access, package
the prompt, census, skill and extractor, plus the repository URL supplied by the operator.

Keep the investigation read-only until changes are authorised. Ask for delivery-boundary checks,
one-owner findings and deletion-first fixes. Verify consequential findings in source. Launch
parallel agents only when requested, through the existing delegation workflow; this skill adds
no transport or automatic model spend.
