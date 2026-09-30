# Preparation validation

Preparation baseline: `318b97cc199918c154b65403b889b4aa9e7267ed`. #111 is open; refresh and refreeze
after it finishes. Neither live construction effects nor fresh solver transfer have been measured.

## Independent local implementations

| Arm | Local commit | Parent | Changed files |
| --- | --- | --- | --- |
| A | `3328bd73b559a7bf6716a513c9819dc2fec161b6` | `318b97cc199918c154b65403b889b4aa9e7267ed` | Builder start prompt, owning prompt test, experimental AGENTS entry |
| B | `67899f2cb7c94951a183cee31d03ac54e94aa1a3` | `318b97cc199918c154b65403b889b4aa9e7267ed` | Rehearsal reminder emission, owning rehearsal tests, experimental AGENTS entry |

These commits exist in the preparation checkout's separate arm branches. They are not shipping
source commits on this PR and have not been pushed as runnable experiments. The patches carry their
complete changes; applying and committing them elsewhere creates new commit identities to record.
The experimental AGENTS entries document the arms; they are not Builder prompt inputs.

## Deterministic checks

- Each patch applies independently to the preparation baseline with `git apply --check`.
- Each intervention was reversed to a clean baseline, verified with `git diff --exit-code`, then
  reapplied before its local commit. Neither arm contains the other. The original model-visible
  text is retained at `ABLATED(shared-margin)` / `ABLATED(examples-reminder)`.
- Formatting, TypeScript checking, strict lint, source policy and complexity policy passed in both
  arm checkouts under the repository gate. Their pre-commit formatting and secret scans passed.
- A's owning prompt/session suites: **53 pass, 0 fail**.
- B's final focused reminder suite: **3 pass, 23 filtered out, 0 fail**. It checks a graded solver
  miss across continued rounds, preserves verdict/count/session state, checks that a not-run call
  consumes no state, and retains the available examples file. It does not certify passing-verdict
  integration on this host.

System-prompt byte counts and SHA256 below use exactly `builderSystemPrompt(true)`, UTF-8, **without
an appended newline**. They are preparation observations, not complete live prompt identities.

| Condition | Bytes | SHA256 |
| --- | --- | --- |
| B0 | 6343 | `a79ab0b58445afce15f38f6965da0950f4972d5d974d9487e8fbff0c92ef9a89` |
| A | 6214 | `99305fe036abff6d44a7dccbc88641f46b1316b9c118ab8d5fd1bb0f08eecbff` |
| B | 6343 | `a79ab0b58445afce15f38f6965da0950f4972d5d974d9487e8fbff0c92ef9a89` |

B changes a later tool result, so an unchanged system-prompt hash is expected; it does not mean an
unchanged overall measurement condition. The full opening/framing/tool identities must be recorded
when the final arms run.

| Patch | SHA256 |
| --- | --- |
| `shared-margin-off.patch` | `444001ac5eef762203cfaed6e15e6be7fdf013b2f07c303b51d1af59ec22c57e` |
| `examples-reminder-off.patch` | `15f190523939604be1c353adce43633a2c44b80e9dff3177babd9f82983c9311` |

Blank context lines in these patches have an omitted space prefix, accepted by `git apply`, so the
stored patch files themselves pass the repository's whitespace check. Code bytes are unaffected.

## Runtime gate limitation

This Linux execution host cannot satisfy the repository's physical confinement canary. Bubblewrap
reports `open /proc/<pid>/ns/ns failed: No such file or directory`; the Built runtime refuses with
`EnvironmentRefusal`. Verifier-dependent rehearsals consequently return `not-run`.

The initial broad B rehearsal suite reported **13 pass, 13 fail**. The failing verifier test
`carries none of the protected classes into either surface of a real failing rehearsal` was rerun
on **unchanged B0** and also failed: expected truth `fail`, received `not-run`. A direct Bubblewrap
canary independently failed on the same namespace route. This establishes a baseline host problem;
it does not prove every integration failure is environmental or that the arm passes elsewhere.

A's full gate and B's broader static gate reached their test stages and encountered repeated runtime
confinement failures. They were interrupted rather than allowed to churn through the same unavailable
capability. **No complete green source gate is claimed.** Run each arm's normal complete gate on a
supported host before publishing it as an experiment or launching it. No isolation control was
disabled, no test expectation was weakened to accept a non-result, and no provider run was launched.

This PR stores reviewable experiments under `docs/`; its live source remains the preparation
baseline. Passing its documentation diff check cannot substitute for validating the applied arms.
