# Cycle ledger template

Keep one `cycle.md`, with `Predictions.md` beside it, in the cycle's folder
`.ana/wri/<YYYY-MM-DD>-cycle-<release>/` ([step 1](../SKILL.md#the-running-window-until-six-promotions-or-twelve-hours-a-run)). [The release cycle](../SKILL.md#the-release-cycle)
owns the order and authority; [Timers](../SKILL.md#timers) owns timer behaviour. This file records
evidence against those steps and supplies no additional authority.

## The word and scope

- Operator's exact word, date, and link to its record.
- Named cycle runs, opening commits, hosts, threshold, and each `--keep` exception.
- Authority for stops, patches, landing and release, with any decision still waiting.
- Fork before a release: link to the operator's recorded word and the named stack top.

## Evidence

| Field | Record |
| --- | --- |
| Progress | Skill step by name, state, time with UTC offset, evidence path or exit code |
| Stops | Closed runs / named cycle runs to stop, excluding `--keep`; list exceptions and unread runs separately |
| Investigation | Links to synthesis, vetting and each finding's evidence and disposition |
| Plan and patches | Owner, hostile test, before-and-after result, commit or PR, checks and exit codes |
| Predictions | A link to `Predictions.md` beside this file, which holds the cycle-wide predictions with their resolutions and links each run's `predictions-<run>.md`, `outcomes-<run>.md` and `still-missing-<run>.md`, the last with its "Intentionally opposed" trade-offs ([step 1](../SKILL.md#the-running-window-until-six-promotions-or-twelve-hours-a-run)) |
| Release | Operator's word, tree-equality proof, land result, merge commit and tag |
| Next cycle | Link to its ledger, authority, named runs and opening commits |

## Timer ledger

| Kind | Record |
| --- | --- |
| Armed timer | Name, id, schedule with UTC offset, purpose and authority link |
| Firing | Time with UTC offset, finding, prediction rows resolved (cycle-wide and each run's outcomes), usefulness, skill step after, timer change |
| Primary log | Dated append-only line for work between firings |
