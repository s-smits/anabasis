# Findings left open at v0.9.3

Status: planned. Each row was found by the pre-landing review of 4 November 2026 (three reviewers,
one slice of the stack each) or while writing #598, and was left as it is so that the release
could land. Each says what would settle it.

## Intended changes

1. **A cap that waits for the owed starter comparison** (review B2, the operator's decision).
   `--promotions 2` ends a campaign before the starter comparison owed after its second promotion,
   so that promotion is never confirmed (`decide`, `src/campaign/decide.ts`, row order). Either let
   the cap end the campaign at its next `compare` instead, or keep it and read confirmation from a
   run let go on.
2. **`refuseRunning` and a peer's copy** (B4, plausible). It matches a running campaign by its exact
   path, and a gathered copy without `observation.json` reads as stopped. A test with a gathered
   copy of a live run would settle it.
3. **"throw where it cannot decide"** (A4, a design trade-off). A check that throws where it cannot
   decide turns an absurd answer into a disputed task instead of a fail. Count disputed tasks a
   comparison across paired drafting seats before changing it.
4. **The index's ending column** (B5, confirmed, reporting only). It reads "no ending" for 139 of
   160 runs, live and stopped alike. Show "live" and "stopped" apart from "ended".
5. **The UI cache's eviction** (C4, confirmed). The test passes on the old code, and nothing tests
   eviction. Write the hostile case.
6. **`sameWindow` sees only two readings** (C7, plausible, #596). A fall between two readings is
   invisible to it. A synthetic usage history would settle it.
7. **Refuse a launch on the week's fit** (#598). The week's fit lowers the cap `runs usage` prints
   and reads "oversubscribed", but `fresh`, `keep`, `continue` and `move` refuse only at the cap.
   Make the fit the cap a launch is refused at, once a week of readings shows the forecast holds.
8. **A Codex subscription** (#598). The `pro100` and `pro200` presets exist but none is active, so
   the Codex login keeps one run a machine. Set `ANA_LOGIN_SUBS` for it once the operator
   activates one.

## How it came to be

On 4 November 2026 three read-only reviewers read the v0.9.3 stack before landing. Confirmed
findings were folded into their commits; these were left open, with the reason in each row. The
operator, setting the subscriptions: "2 active subscriptions for max and 4 for ultra, ofc if we get
close to the end we automatically reduce the avaialbe ones and still call it 'oversubscribed'",
then "we have codex:pro100 and codex:pro200 same 2 and 4" and "but not active rn - didnt active
these subs (yet)". Later that morning the operator asked to "put other things you still want to
build out in backlog.md".
