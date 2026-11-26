# Kill clocks: the draft audit and the Examiner conversation

Two mechanisms stay on a clock: each is cut unless the next two fresh campaigns at the stack top show it moving a live decision. The clocks are pre-registered here, before those runs, with the reader that settles each one (rule 13: owner, live reader, decision, evidence, hostile test).

## Draft audit (`src/audit/draft-audit.ts`, `tools/eval/draft.ts`)

- **Decision it must move:** a real check defect fixed before the freeze because a draft audit found it: a `defects` finding (`referee.draft`) whose cited probe or check, re-run by hand on the admitted controls of the draft that stands, shows a wrong answer passing or a right one refused in the refused draft and not in the frozen one.
- **Reader:** `referee.draft` events by verdict; the refused draft in the Examiner's `draft.call` trace (its `draft_exam` arguments and refusal text) beside the `exam.drafted` that stands. A `defects` audit refuses the put, so a later `exam.drafted` alone proves nothing. `replayDraftProbes` outcomes reach the log only as that refusal text; no event carries `stillBroken` or `verifiedFixed`.
- **Cut when:** the two runs together hold 0 such vetted fixes. The draft audit, its prompt section, `replayDraftProbes` and `MAX_DRAFT_AUDITS` then go as one strand.
- **Keep when:** at least one vetted fix.
- **Archive baseline:** 8 `referee.draft` events across 304 archived logs: 5 `defects`, 2 `sound`, 1 `skipped`.

## Examiner conversation (`src/examiner/session.ts:conversing`)

- **Decision it must move:** tasks held by an ask served inside a running conversation (`exam.started.conversation` present) rather than by a fresh session.
- **Reader:** `exam.finished.held` per session after `x-1`, split by `exam.started.conversation`.
- **Cut when:** across the two runs, woken sessions hold no more tasks per session than fresh sessions after `x-1`, and their share of sessions holding nothing is no lower. The comparison is observational: fresh sessions follow a conversation that crashed, was killed or ran out, so it favours conversing. A tie therefore counts against it.
- **Archive baseline:** over 47 archived logs with conversations, 168 woken sessions held 1,573 tasks (9.4 per session) and 28 held none (17%). 62 fresh sessions after `x-1` held 412 (6.6 per session) and 21 held none (34%). Endings: woken 14 crashed and 1 killed; fresh 8 crashed and 7 killed.

## History

- The operator asked for both mechanisms to carry a kill clock: cut each if it still moves 0 live verdicts after the next two fresh runs.
