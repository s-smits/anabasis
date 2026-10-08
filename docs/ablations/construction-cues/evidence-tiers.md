# Evidence tiers for the construction ablations

The arm table and the three tiers of suspected harm as the session that built the arms derived them on 2026-10-01, from two read-only passes over 79 campaign directories (378 rounds, 329 batteries, 2,332 fresh cases). OBSERVED, HYPOTHESIS and UNAVAILABLE are its own labels. The figures were not re-derived for this document, and the derivation scripts are not in the repository. Read the tiers as confidence in a harm mechanism, not as a measured gain from removing a component.

## The arms, per the task's required fields

| | early-accept | competing-margin | trial-forecast (folded) |
|---|---|---|---|
| Owner | builder-start-prompt.ts, builder-session.ts roundPrompt, builder-tool-receipts.ts sessionClock | builder-start-prompt.ts `INTENT_CLAUSE` | src/builder/harness-trial.ts `trialNextAction` and the tool description |
| Evidence | Never measured. #89 bundled it with witness-budget; #91/#92 stacked arms lost it; all four cues are in the tree. Binding-constraint walk (AGENTS.md entry from ed97e8f6): on truss-26/-29 112 of 134 limits lay within 2% of the witness and 132 of 134 passed; the Builder reached acceptance in 2.4 to 9.7 minutes per task against a 120-minute solve wall. Firmware: 98% of 929 verified solves used < 10% of the wall. | After the depth prescriptions (#54 onward) 83 of 85 recorded batteries passed whole, but 77 of the 85 are Sol on new domains (confounded); carried-unchanged tasks fell 57% to 37% with unchanged outcomes. #102, #103, #105, #106 have no recorded batteries. The one demand that dropped pass rates was interaction inside one shared limit (2026-09-15 truss: 7/20 Sol, 2/23 Opus 5, versus 22/23 for one interaction per task), which the later sentences still carry. | 945 of 994 graded rehearsals passed (4.9% failed); rehearsed task at chance in its battery's solve-time order (mean rank 0.48 against 0.50, AGENTS.md); 29 of 49 failing rehearsals never rehearsed again; Astra loosened limits until the rehearsal passed (mass 2,611 to 8,003, deflection 0.016 to 0.070). |
| Mechanism (hypothesis) | The cues price the witness at whatever the first clear preview held, so the battery's limit sits on the Builder's own weak witness. | The sentence names a route (stack requirements) that Builders read as adding conditions, not depth; removing it leaves the rest of the depth guidance. | "Scores near its size" tells the Builder its battery is easy on one rehearsal, which the data do not support and which makes a pass read as a finish. |
| Prediction (to freeze before launch with `prediction.ts`) | Median Builder minutes to submit rises; share of limits within 2% of the witness falls; no change in validity rate. | First-task demand is lower or unchanged, or unchanged in kind; pass-whole rate unchanged. The informative outcome is "no difference". | Rounds rehearse again after a pass no more or less often; limits are not looser; battery pass-whole rate unchanged. |
| Falsifier | Submit time and witness margin unchanged versus control. | A first task's requirements interact less without the sentence, or a failing arm shows materially lower demand. | Any change in rehearsal behaviour or adoption of easier tasks. |
| Measured outcomes | Validity, supported behavioural coverage, valid-demand failures, solve effort, construction cost, completed batteries. Report instrument defects, publication gaps, wall stops, unresolved cases separately. | same | same |
| Restoration | `rg "ABLATED\(early-accept\)"`, strip prefixes, delete replacement lines, flip the tests back | `rg "ABLATED\(competing-margin\)"` | `rg "ABLATED\(trial-forecast\)"` |

Discovery versus confirmation: arms read on the discovery seed (recorded Opus seed `custom-opus-20260929T145817364Z-a2d0f7-i03`, as in the 2026-09-30 forks). Confirmation needs a different seed and launches only after every arm's source is fixed.

## The three tiers (negative impact on the system)

Measured by two read-only evidence passes over 79 campaign directories (378 rounds, 329 batteries, 2,332 fresh cases). OBSERVED, HYPOTHESIS and UNAVAILABLE are marked as in the agents' reports.

### 95%+

1. **Firmware host stand-in instruments are the whole firmware "limit" signal.** OBSERVED: 32 of 32 verified firmware fails and 17 of 17 partial batteries are defects (S1: 24 stand-in defects, 5 publication gaps, 3 wall timeouts, 0 genuine). Real instruments: 0 fails in 296 cases over 48 batteries; stand-in batteries 32 of 813 (Fisher p = 4.5e-4 on batteries). Half the defects repeat in later batteries in the same campaign (17 of 32: C-11 x6, C-20 x3, C-30 x3, C-6 x2, C-18 x2, C-7 x1), and no settlement ever counted (S6, `notes/firmware-fails-20260930/s6-settled-census.md`). All 8 firmware graduations were triggered by defect partials. Instrument problem, not a prompt arm.
2. **Short walls are read as task limits.** OBSERVED: 5 truss batteries whose only misses were at the wall were zoned on-aim or over-aim with `wallBound` null (4 of them the cb274b short-wall run), and reserve 558542-i10 (5/6, `wallBound=1`, over-aim). The double count in d2439e41 is the same family.
3. **Firmware demand sits far below the wall.** OBSERVED: 912 of 929 verified firmware solves (98%) used < 10% of the 120-minute wall; with a 1-minute wall (cb274b) 129 of 132 still passed; build is 78% of serial firmware round time.
4. **The grader is in the solver's reach on some domains.** OBSERVED: buffer `chem.ts` shared by 16 of 16 versions and the `analyze_formula` adviser runs the published model; reserve `metrics.ts` 29 of 41; firmware fw-34 7a97af-i03 `rules.ts` byte-identical to the agent's. Whether this inflates passes is ~80%: users of grader-like advisers passed 444 of 447, but the removal ablation has only 2 batteries (truss-30 4ec6db), so it is UNAVAILABLE as an arm. Needs a host switch (only `--withhold-instruments` exists today) and a frozen battery, reported separately.

### ~80%

5. **The firmware admission gate costs more than it is shown to buy.** OBSERVED: correctness_check is 31% of firmware Builder time (107.8 h of 347.9 h) and 40 to 42% in the Builder's own accounting; 234 of 1,042 calls were refused (SOLVABILITY_CENSUS_BLOCKED 67, DISCRIMINATION_ACCEPT_REJECTED 46, SOLVABILITY_FAILURE_CONCENTRATION 40, tool-timeout 36); 12 refusals cleared on the same candidate with no edit; 13 lost rounds (3,803 minutes) ended with the gate refused; firmware Opus loses 52% of its hours to rounds that adopt nothing. Whether the gate buys protection is not measured.
6. **Rehearsals carry little information per cost.** OBSERVED: 945 of 994 graded pass; 57% of Sol truss Builder time is rehearsal, which failed 3 of 253; the rehearsal solver almost never fails, so adaptation is rare. The forecast sentences were the trial-forecast arm, folded on 2026-10-07: they are gone from source.
7. **Review money buys no measurable change.** OBSERVED: review is 54% of firmware spend ($1,389 of $2,554); named files change at or below their base rate (evaluator.ts 32 of 45 when named, 50 of 61 when not); next battery partial 15 of 92 after a named file changed, 3 of 14 when it did not, 0 of 29 when nothing was named. HYPOTHESIS: findings follow recurring defect partials.
8. **Judge abstains outside firmware and truss.** OBSERVED: 526 of 545 offered in buffer, conformer, reserve and RNA-seq; firmware 31 contested gave 8 dispositions and none carried checkIds (7643780b fixed the writer since).
9. **The review-unread submit hold produces loops.** OBSERVED: 128 holds in 68 of 377 rounds, 592 Builder minutes (9.9 h by the pipeline count); 26 holds were followed by an identical resubmit that was accepted; 55 chained into another hold. Capped authoring reviews cost 22.3 h.
10. **The demand prescriptions of #54 to #87 did not move outcomes.** OBSERVED: 83 of 85 later batteries passed whole; confounded by domain. HYPOTHESIS that they did nothing (~80%); that they did harm is ~60%.
11. **`examples.md` does nothing measurable.** OBSERVED: 0 of 71 eligible conversations read it after their first graded rehearsal; no link to demand outcomes; the new file (2e00de48) and the #111 trigger (6a275016) postdate every recorded round, so its effect is UNAVAILABLE.
12. **Opus firmware construction is gate-bound.** OBSERVED: 9.4 Builder-hours per battery, 17 of 35 rounds adopted nothing; model and gate are confounded.

### ~60%

13. **887c163e removed the named-simulator pointer.** OBSERVED: Sol stand-in rate 46 of 46 without a named pointer, 39 of 53 with it; HYPOTHESIS that the pointer helped, confounded by continuations in C-25 and C-31. There is no current pointer to ablate: adding one is an ADD after the peer's firmware input patch.
14. **Loosening limits after a failed rehearsal.** OBSERVED in Astra truss (1.6x to 4.4x); at most 28 of 259 truss tasks (10.8%) ended looser than first rehearsed (HYPOTHESIS proxy).
15. **The solvability gates push Builders toward what the census solver already solves.** HYPOTHESIS: 50 census-blocked refusals (792 minutes) and 33 failure-concentration refusals (426 minutes) reject candidates the census solver fails.
16. **The early-accept cues.** HYPOTHESIS from the binding-constraint walk; not measured by a clean arm.

## Not in the first batch, and why

- **carry-none-forward** (climb-readout `noLimitLine`): only informative after the arms.
- **Examples trigger:** nothing recorded postdates 6a275016/2e00de48, so there is no baseline to ablate against.
- **Simulator pointer:** nothing to remove; an ADD.
- **Grounding sources and reviewer; solver advisers on a frozen battery:** need a new host switch and a frozen battery; report separately.
- **Review hold and cadence:** ~80% tier, candidate for batch 2.
- **VERIFICATION_CLAUSE:** inert prose.
