# Harness²'s own JobBench prompt text

Harness² describes JobBench to its improvers in five text fields, which its prompts fill as
`{{work}}`, `{{inv_levers}}`, `{{dom_levers}}`, `{{yardstick}}` and `{{domain_guidance}}`
(`h2/prompts.txt`). This file keeps those fields as Harness² wrote them, so that the shared domain
text of the pilot (`jobbench-pilot.md`), which keeps 79% of these words, can be read against its
origin instead of against its own last version.

Source: `google-research/harness2` at `1cfe254e`, `harness2/benchmarks/jobbench.py`
(`JOBBENCH_BASE` and `JOBBENCH_PROFESSIONS`); the fork's copy at `0c121fd` holds the same text.
Copyright 2026 Google LLC, licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). The text below is copied verbatim, the only change
being that each Python string is joined onto one line.

## What one task is told

A task's `domain_guidance` is its profession's lens alone. `domain_of` returns the task's
profession, which no key of `JOBBENCH_DOMAINS` matches, so the domain lens is empty. The lens field
below joins the lenses of the pilot's three professions (biostatisticians, statisticians and social
science research assistants), as the pilot's word count did.

| Field | Words | Pilot's shared text |
| --- | ---: | ---: |
| `work` | 55 | 124 |
| `inv_levers` | 85 | 85 |
| `dom_levers` | 69 | 69 |
| `yardstick` | 33 | 33 |
| `domain_guidance`, three lenses | 72 | 78 |
| all | 314 | 389 |

One task under Harness² reads the four base fields and one lens, about 266 words. The pilot's shared
text grew mainly in `work`, from 55 to 124 words, so that an Anabasis Examiner could draft an exam
from it.

The solver is told none of this. Its base harness is a two-line guide
(`third_party/jb_runner/codex_base_harness/AGENTS.md`, written as `CLAUDE.md` under Claude Code and
kept here as `h2/base/CLAUDE.md`):

```text
Follow the task instructions in the task folder and write the final deliverables to the
specified output directory.
```

## The five fields

### `work`

```text
Professional workplace analysis across occupations. The agent receives a mixed workspace of data, documents, databases, reference material and instructions, then produces one or more immediately usable artifacts such as spreadsheets, reports, reconciliations, plans or technical files. Source fidelity, reproducible computation and professional conventions all matter; prose alone is not a substitute for a requested file.
```

### `inv_levers`

```text
- inventory inputs by format and authority; inspect more than the first obvious file and record how tables, identifiers and versions relate
- use programmatic extraction and calculation for structured data, preserve intermediate counts and assumptions, and reconcile totals before drafting conclusions
- turn the request into an output manifest with exact paths, sheets, columns and sections; write viable artifacts early and improve them incrementally
- reopen every produced file with an independent reader and verify non-empty computed values, formats, formulas, links and cross-file consistency
```

### `dom_levers`

```text
- encode the occupation's decision procedure, source hierarchy, calculation method, standard deliverable structure and quality-control checks—not a task's names or numbers
- distinguish authoritative inputs from derived data and resolve conflicting sources explicitly
- verify standards, regulations, formulas and current reference values from supplied material or an authorised source; expose uncertainty when verification is unavailable
- make every recommendation traceable to a calculation, source location or stated professional rule
```

### `yardstick`

```text
Did the run discover the full workspace, establish source-of-truth relationships, perform calculations reproducibly, satisfy the requested schemas and filenames, preserve traceability, and reopen the final files rather than trusting that a write succeeded?
```

### `domain_guidance`, the three profession lenses

```text
biostatisticians:
PROFESSION LENS — Define cohort, endpoint and denominator; handle missingness, subgroup size, assumptions and sensitivity; make statistical work reproducible and cite supplied guidance precisely.

statisticians:
PROFESSION LENS — Define estimand, population and denominator; inspect distributions and missingness, use the appropriate model, validate assumptions and provide reproducible tables with uncertainty.

social_science_research_assistants:
PROFESSION LENS — Define variables and populations, harmonise identifiers and coding, document imputation or exclusions, run reproducible analysis and separate association from causal claim.
```

## The selector's fields

At `k > 1` a selector chooses among final deliverables. At the pilot's `k = 1` it does not run, and
the improvers read only `domain_word` and `deliverable_word` of these.

```text
domain_word: occupational domain
deliverable_word: work product

selection_checks: Prefer the work product that delivers every requested artifact and schema; uses all material sources with an explicit hierarchy; shows reproducible calculations and denominators; preserves identifiers, units, dates and formulas; supports claims with source locations; and can be used or imported directly without filling blanks or repairing file structure.

selection_lead: COVERAGE OF WHAT WAS NAMED. Count what the instructions explicitly ask to be produced, computed, stated or explained, and pick the candidate that answers the most of those points. A specific value, threshold, category or name that the source supports is worth more than a careful statement that the information was unavailable, and material beyond what was asked costs nothing here -- an omitted requirement is the failure that matters. Verify specifics against `context/source/` and reject the ones it contradicts, but do not prefer vagueness merely because a specific is hard to confirm.
```
